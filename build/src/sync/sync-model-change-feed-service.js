// @ts-check
import VelociousError from "../velocious-error.js";
import { declaredSyncScopeAttributes } from "./sync-scope-attributes.js";
import { decodeReplayPersistedData } from "./sync-replay-persisted-data.js";
/**
 * Generic cursor-paginated change feed over an app-owned sync/change model.
 *
 * Apps provide the model and optional scoping/serialization hooks. Velocious owns
 * cursor parsing, snapshot high-water resolution, stable ordering, page limits,
 * and response shape for `/velocious/sync/changes` style endpoints.
 */
export default class SyncModelChangeFeedService {
    /**
     * Creates a generic sync-model change-feed service.
     * @param {object} args - Service arguments.
     * @param {typeof import("../database/record/index.js").default} args.modelClass - Sync/change model class.
     * @param {Record<string, unknown>} args.params - Request params.
     * @param {number} [args.defaultLimit] - Default page size.
     * @param {number} [args.maxLimit] - Maximum page size.
     * @param {(record: ReturnType<typeof JSON.parse>) => Record<string, unknown>} [args.serializeRecord] - Record serializer.
     * @param {(args: {query: import("../database/query/model-class-query.js").default}) => void} [args.scopeQuery] - Applies app-owned visibility scope.
     */
    constructor({ defaultLimit = 1000, maxLimit = 1000, modelClass, params, scopeQuery, serializeRecord }) {
        this.defaultLimit = defaultLimit;
        this.maxLimit = maxLimit;
        this.modelClass = modelClass;
        this.params = params;
        this.scopeQuery = scopeQuery || null;
        this.serializeRecord = serializeRecord || ((record) => this.defaultSerializeRecord(record));
    }
    /**
     * Builds a stable change-feed page. The additive `total` is the scope's pending
     * change count from the request cursor to the snapshot bound (a COUNT, not a
     * materialized read), so a client can render a "synced of total" progress bar;
     * older clients ignore it.
     * @returns {Promise<{status: string, nextCursor: {id: string, serverSequence: number, updatedAt: string} | null, syncs: Array<Record<string, unknown>>, total: number, upToCursor: {id: string, serverSequence: number, updatedAt: string} | null}>} Change-feed page result.
     */
    async changes() {
        const limit = this.normalizedLimit(this.params.limit);
        const upToCursor = await this.resolveUpToCursor();
        if (!upToCursor)
            return { status: "success", nextCursor: null, syncs: [], total: 0, upToCursor: null };
        const total = await this.totalPendingChanges({ upToCursor });
        const query = this.pageQuery({ limit, upToCursor });
        const records = await query.toArray();
        const nextCursor = records.length > 0 ? this.cursorForRecord(records[records.length - 1]) : upToCursor;
        return {
            status: "success",
            nextCursor,
            syncs: records.map((record) => this.serializeRecord(record)),
            total,
            upToCursor
        };
    }
    /**
     * Normalizes the requested page limit.
     * @param {unknown} value - Raw limit param.
     * @returns {number} Normalized page limit.
     */
    normalizedLimit(value) {
        if (value === undefined || value === null || value === "")
            return this.defaultLimit;
        const limit = Number(value);
        if (!Number.isSafeInteger(limit) || limit <= 0) {
            throw VelociousError.safe("Sync changes limit must be a positive integer.", { code: "sync-invalid-changes-limit" });
        }
        return Math.min(limit, this.maxLimit);
    }
    /**
     * Parses an optional positive integer cursor field.
     * @param {unknown} value - Raw integer param.
     * @param {string} name - Param name for error messages.
     * @returns {number | null} Positive integer value, or null when omitted.
     */
    optionalPositiveIntegerParam(value, name) {
        if (value === undefined || value === null || value === "")
            return null;
        const integer = Number(value);
        if (!Number.isSafeInteger(integer) || integer <= 0) {
            throw VelociousError.safe(`${name} must be a positive integer.`, { code: "sync-invalid-changes-cursor" });
        }
        return integer;
    }
    /**
     * Resolves the high-water cursor that bounds the current feed page.
     * @returns {Promise<{id: string, serverSequence: number, updatedAt: string} | null>} Snapshot upper-bound cursor.
     */
    async resolveUpToCursor() {
        const upToServerSequence = this.optionalPositiveIntegerParam(this.params.upToServerSequence, "upToServerSequence");
        if (upToServerSequence !== null && typeof this.params.upToUpdatedAt === "string" && typeof this.params.upToId === "string") {
            return { id: this.params.upToId, serverSequence: upToServerSequence, updatedAt: this.params.upToUpdatedAt };
        }
        if (typeof this.params.upToUpdatedAt === "string" && typeof this.params.upToId === "string") {
            const upToRecord = await this.modelClass.findBy({ id: this.params.upToId });
            if (upToRecord)
                return this.cursorForRecord(upToRecord);
        }
        const query = this.scopedQuery();
        const table = query.driver.quoteTable(this.modelClass.tableName());
        const serverSequenceColumn = query.driver.quoteColumn("server_sequence");
        const latestRecords = await query
            .order(`${table}.${serverSequenceColumn} DESC`)
            .limit(1)
            .toArray();
        if (latestRecords.length === 0)
            return null;
        return this.cursorForRecord(latestRecords[0]);
    }
    /**
     * Builds the ordered and cursor-filtered page query.
     * @param {{limit: number, upToCursor: {id: string, serverSequence: number, updatedAt: string}}} args - Page query args.
     * @returns {import("../database/query/model-class-query.js").default} Page query.
     */
    pageQuery({ limit, upToCursor }) {
        const query = this.cursorFilteredQuery({ upToCursor });
        const driver = query.driver;
        const serverSequenceColumn = `${driver.quoteTable(this.modelClass.tableName())}.${driver.quoteColumn("server_sequence")}`;
        return query
            .order(`${serverSequenceColumn} ASC`)
            .limit(limit);
    }
    /**
     * Counts the scope's pending change rows from the request cursor to the snapshot
     * bound without materializing them, so the client can render a stable "of Y"
     * progress denominator.
     * @param {{upToCursor: {id: string, serverSequence: number, updatedAt: string}}} args - Count args.
     * @returns {Promise<number>} Pending change count from the request cursor.
     */
    async totalPendingChanges({ upToCursor }) {
        return await this.cursorFilteredQuery({ upToCursor }).count();
    }
    /**
     * Builds a scoped query with the snapshot upper bound and after-cursor filters
     * applied, but without ordering or a page limit. Shared by the page read and the
     * total-count so both count the same set of rows.
     * @param {{upToCursor: {id: string, serverSequence: number, updatedAt: string}}} args - Filter args.
     * @returns {import("../database/query/model-class-query.js").default} Cursor-filtered query.
     */
    cursorFilteredQuery({ upToCursor }) {
        const query = this.scopedQuery();
        const driver = query.driver;
        const table = driver.quoteTable(this.modelClass.tableName());
        const serverSequenceColumn = `${table}.${driver.quoteColumn("server_sequence")}`;
        const updatedAtColumn = `${table}.${driver.quoteColumn("updated_at")}`;
        const idColumn = `${table}.${driver.quoteColumn("id")}`;
        query.where(`${serverSequenceColumn} <= ${driver.quote(upToCursor.serverSequence)}`);
        const afterServerSequence = this.optionalPositiveIntegerParam(this.params.afterServerSequence, "afterServerSequence");
        if (afterServerSequence !== null) {
            query.where(`${serverSequenceColumn} > ${driver.quote(afterServerSequence)}`);
        }
        else if (typeof this.params.afterUpdatedAt === "string" && this.params.afterUpdatedAt !== "") {
            const isPagingExistingSnapshot = typeof this.params.upToUpdatedAt === "string" && this.params.upToUpdatedAt !== "" && typeof this.params.upToId === "string" && this.params.upToId !== "";
            if (isPagingExistingSnapshot && typeof this.params.afterId === "string" && this.params.afterId !== "") {
                query.where(`(${updatedAtColumn} > ${driver.quote(this.params.afterUpdatedAt)} OR (${updatedAtColumn} = ${driver.quote(this.params.afterUpdatedAt)} AND ${idColumn} > ${driver.quote(this.params.afterId)}))`);
            }
            else {
                query.where(`${updatedAtColumn} >= ${driver.quote(this.params.afterUpdatedAt)}`);
            }
        }
        return query;
    }
    /**
     * Builds a base query with app-owned scope applied.
     * @returns {import("../database/query/model-class-query.js").default} Scoped base query.
     */
    scopedQuery() {
        const query = this.modelClass.where({});
        if (this.scopeQuery)
            this.scopeQuery({ query });
        return query;
    }
    /**
     * Serializes a record into a transport cursor.
     * @param {ReturnType<typeof JSON.parse>} record - Sync/change record.
     * @returns {{id: string, serverSequence: number, updatedAt: string}} Cursor for row.
     */
    cursorForRecord(record) {
        return { id: String(this.recordValue(record, "id")), serverSequence: Number(this.recordValue(record, "serverSequence")), updatedAt: this.isoDate(this.recordValue(record, "updatedAt")) };
    }
    /**
     * Serializes a record using the standard sync envelope shape plus the sync
     * model's declared scope-partition attributes (`static syncScopeAttributes`),
     * each emitted under its own attribute name. Models declaring no scope
     * attributes keep the deprecated 1.0.503 wire and emit `eventId`. Keys are
     * sorted so a declared `["eventId"]` partition stays byte-identical with the
     * 1.0.503 wire.
     * @param {ReturnType<typeof JSON.parse>} record - Sync/change record.
     * @returns {Record<string, unknown>} Default serialized row.
     */
    defaultSerializeRecord(record) {
        const scopeAttributes = declaredSyncScopeAttributes(this.modelClass);
        /** @type {Record<string, unknown>} */
        const serialized = {
            data: this.recordData(record),
            id: this.recordValue(record, "id"),
            resourceId: this.recordValue(record, "resourceId"),
            resourceType: this.recordValue(record, "resourceType"),
            serverSequence: this.recordValue(record, "serverSequence"),
            syncType: this.recordValue(record, "syncType"),
            updatedAt: this.isoDate(this.recordValue(record, "updatedAt"))
        };
        for (const scopeAttribute of scopeAttributes || ["eventId"]) {
            serialized[scopeAttribute] = this.recordValue(record, scopeAttribute);
        }
        return Object.fromEntries(Object.entries(serialized).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey)));
    }
    /**
     * Reads and parses the record data payload.
     * @param {ReturnType<typeof JSON.parse>} record - Sync/change record.
     * @returns {unknown} Parsed data value.
     */
    recordData(record) {
        const data = this.recordValue(record, "data");
        if (data === "" || data === null || data === undefined)
            return null;
        return decodeReplayPersistedData(data).payload;
    }
    /**
     * Reads a value from either a record accessor method or plain property.
     * @param {ReturnType<typeof JSON.parse>} record - Sync/change record.
     * @param {string} name - Camel-cased value/method name.
     * @returns {unknown} Record value.
     */
    recordValue(record, name) {
        if (!record || typeof record !== "object") {
            throw new Error("Sync changes row must be an object.");
        }
        const recordObject = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (record);
        const method = recordObject[name];
        const value = typeof method === "function" ? method.call(record) : method;
        if (value === undefined) {
            throw new Error(`Sync changes row is missing ${name}.`);
        }
        return value;
    }
    /**
     * Converts a date-like value to an ISO string.
     * @param {Date | string | null | undefined | unknown} value - Date value.
     * @returns {string} ISO date.
     */
    isoDate(value) {
        const date = value instanceof Date ? value : new Date(typeof value === "string" || typeof value === "number" ? value : 0);
        if (Number.isNaN(date.getTime())) {
            throw VelociousError.safe("Sync changes row has an invalid updated_at value.", { code: "sync-invalid-changes-row" });
        }
        return date.toISOString();
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3luYy1tb2RlbC1jaGFuZ2UtZmVlZC1zZXJ2aWNlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3N5bmMvc3luYy1tb2RlbC1jaGFuZ2UtZmVlZC1zZXJ2aWNlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLGNBQWMsTUFBTSx1QkFBdUIsQ0FBQTtBQUVsRCxPQUFPLEVBQUMsMkJBQTJCLEVBQUMsTUFBTSw0QkFBNEIsQ0FBQTtBQUN0RSxPQUFPLEVBQUMseUJBQXlCLEVBQUMsTUFBTSxpQ0FBaUMsQ0FBQTtBQUV6RTs7Ozs7O0dBTUc7QUFDSCxNQUFNLENBQUMsT0FBTyxPQUFPLDBCQUEwQjtJQUM3Qzs7Ozs7Ozs7O09BU0c7SUFDSCxZQUFZLEVBQUMsWUFBWSxHQUFHLElBQUksRUFBRSxRQUFRLEdBQUcsSUFBSSxFQUFFLFVBQVUsRUFBRSxNQUFNLEVBQUUsVUFBVSxFQUFFLGVBQWUsRUFBQztRQUNqRyxJQUFJLENBQUMsWUFBWSxHQUFHLFlBQVksQ0FBQTtRQUNoQyxJQUFJLENBQUMsUUFBUSxHQUFHLFFBQVEsQ0FBQTtRQUN4QixJQUFJLENBQUMsVUFBVSxHQUFHLFVBQVUsQ0FBQTtRQUM1QixJQUFJLENBQUMsTUFBTSxHQUFHLE1BQU0sQ0FBQTtRQUNwQixJQUFJLENBQUMsVUFBVSxHQUFHLFVBQVUsSUFBSSxJQUFJLENBQUE7UUFDcEMsSUFBSSxDQUFDLGVBQWUsR0FBRyxlQUFlLElBQUksQ0FBQyxDQUFDLE1BQU0sRUFBRSxFQUFFLENBQUMsSUFBSSxDQUFDLHNCQUFzQixDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUE7SUFDN0YsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILEtBQUssQ0FBQyxPQUFPO1FBQ1gsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLGVBQWUsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFBO1FBQ3JELE1BQU0sVUFBVSxHQUFHLE1BQU0s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SUFBSSxFQUFFLDBCQUEwQixFQUFDLENBQUMsQ0FBQTtRQUNwSCxDQUFDO1FBRUQsT0FBTyxJQUFJLENBQUMsV0FBVyxFQUFFLENBQUE7SUFDM0IsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBWZWxvY2lvdXNFcnJvciBmcm9tIFwiLi4vdmVsb2Npb3VzLWVycm9yLmpzXCJcblxuaW1wb3J0IHtkZWNsYXJlZFN5bmNTY29wZUF0dHJpYnV0ZXN9IGZyb20gXCIuL3N5bmMtc2NvcGUtYXR0cmlidXRlcy5qc1wiXG5pbXBvcnQge2RlY29kZVJlcGxheVBlcnNpc3RlZERhdGF9IGZyb20gXCIuL3N5bmMtcmVwbGF5LXBlcnNpc3RlZC1kYXRhLmpzXCJcblxuLyoqXG4gKiBHZW5lcmljIGN1cnNvci1wYWdpbmF0ZWQgY2hhbmdlIGZlZWQgb3ZlciBhbiBhcHAtb3duZWQgc3luYy9jaGFuZ2UgbW9kZWwuXG4gKlxuICogQXBwcyBwcm92aWRlIHRoZSBtb2RlbCBhbmQgb3B0aW9uYWwgc2NvcGluZy9zZXJpYWxpemF0aW9uIGhvb2tzLiBWZWxvY2lvdXMgb3duc1xuICogY3Vyc29yIHBhcnNpbmcsIHNuYXBzaG90IGhpZ2gtd2F0ZXIgcmVzb2x1dGlvbiwgc3RhYmxlIG9yZGVyaW5nLCBwYWdlIGxpbWl0cyxcbiAqIGFuZCByZXNwb25zZSBzaGFwZSBmb3IgYC92ZWxvY2lvdXMvc3luYy9jaGFuZ2VzYCBzdHlsZSBlbmRwb2ludHMuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFN5bmNNb2RlbENoYW5nZUZlZWRTZXJ2aWNlIHtcbiAgLyoqXG4gICAqIENyZWF0ZXMgYSBnZW5lcmljIHN5bmMtbW9kZWwgY2hhbmdlLWZlZWQgc2VydmljZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBTZXJ2aWNlIGFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWxDbGFzcyAtIFN5bmMvY2hhbmdlIG1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSBhcmdzLnBhcmFtcyAtIFJlcXVlc3QgcGFyYW1zLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuZGVmYXVsdExpbWl0XSAtIERlZmF1bHQgcGFnZSBzaXplLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MubWF4TGltaXRdIC0gTWF4aW11bSBwYWdlIHNpemUuXG4gICAqIEBwYXJhbSB7KHJlY29yZDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4pID0+IFJlY29yZDxzdHJpbmcsIHVua25vd24+fSBbYXJncy5zZXJpYWxpemVSZWNvcmRdIC0gUmVjb3JkIHNlcmlhbGl6ZXIuXG4gICAqIEBwYXJhbSB7KGFyZ3M6IHtxdWVyeTogaW1wb3J0KFwiLi4vZGF0YWJhc2UvcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdH0pID0+IHZvaWR9IFthcmdzLnNjb3BlUXVlcnldIC0gQXBwbGllcyBhcHAtb3duZWQgdmlzaWJpbGl0eSBzY29wZS5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtkZWZhdWx0TGltaXQgPSAxMDAwLCBtYXhMaW1pdCA9IDEwMDAsIG1vZGVsQ2xhc3MsIHBhcmFtcywgc2NvcGVRdWVyeSwgc2VyaWFsaXplUmVjb3JkfSkge1xuICAgIHRoaXMuZGVmYXVsdExpbWl0ID0gZGVmYXVsdExpbWl0XG4gICAgdGhpcy5tYXhMaW1pdCA9IG1heExpbWl0XG4gICAgdGhpcy5tb2RlbENsYXNzID0gbW9kZWxDbGFzc1xuICAgIHRoaXMucGFyYW1zID0gcGFyYW1zXG4gICAgdGhpcy5zY29wZVF1ZXJ5ID0gc2NvcGVRdWVyeSB8fCBudWxsXG4gICAgdGhpcy5zZXJpYWxpemVSZWNvcmQgPSBzZXJpYWxpemVSZWNvcmQgfHwgKChyZWNvcmQpID0+IHRoaXMuZGVmYXVsdFNlcmlhbGl6ZVJlY29yZChyZWNvcmQpKVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBhIHN0YWJsZSBjaGFuZ2UtZmVlZCBwYWdlLiBUaGUgYWRkaXRpdmUgYHRvdGFsYCBpcyB0aGUgc2NvcGUncyBwZW5kaW5nXG4gICAqIGNoYW5nZSBjb3VudCBmcm9tIHRoZSByZXF1ZXN0IGN1cnNvciB0byB0aGUgc25hcHNob3QgYm91bmQgKGEgQ09VTlQsIG5vdCBhXG4gICAqIG1hdGVyaWFsaXplZCByZWFkKSwgc28gYSBjbGllbnQgY2FuIHJlbmRlciBhIFwic3luY2VkIG9mIHRvdGFsXCIgcHJvZ3Jlc3MgYmFyO1xuICAgKiBvbGRlciBjbGllbnRzIGlnbm9yZSBpdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8e3N0YXR1czogc3RyaW5nLCBuZXh0Q3Vyc29yOiB7aWQ6IHN0cmluZywgc2VydmVyU2VxdWVuY2U6IG51bWJlciwgdXBkYXRlZEF0OiBzdHJpbmd9IHwgbnVsbCwgc3luY3M6IEFycmF5PFJlY29yZDxzdHJpbmcsIHVua25vd24+PiwgdG90YWw6IG51bWJlciwgdXBUb0N1cnNvcjoge2lkOiBzdHJpbmcsIHNlcnZlclNlcXVlbmNlOiBudW1iZXIsIHVwZGF0ZWRBdDogc3RyaW5nfSB8IG51bGx9Pn0gQ2hhbmdlLWZlZWQgcGFnZSByZXN1bHQuXG4gICAqL1xuICBhc3luYyBjaGFuZ2VzKCkge1xuICAgIGNvbnN0IGxpbWl0ID0gdGhpcy5ub3JtYWxpemVkTGltaXQodGhpcy5wYXJhbXMubGltaXQpXG4gICAgY29uc3QgdXBUb0N1cnNvciA9IGF3YWl0IHRoaXMucmVzb2x2ZVVwVG9DdXJzb3IoKVxuXG4gICAgaWYgKCF1cFRvQ3Vyc29yKSByZXR1cm4ge3N0YXR1czogXCJzdWNjZXNzXCIsIG5leHRDdXJzb3I6IG51bGwsIHN5bmNzOiBbXSwgdG90YWw6IDAsIHVwVG9DdXJzb3I6IG51bGx9XG5cbiAgICBjb25zdCB0b3RhbCA9IGF3YWl0IHRoaXMudG90YWxQZW5kaW5nQ2hhbmdlcyh7dXBUb0N1cnNvcn0pXG4gICAgY29uc3QgcXVlcnkgPSB0aGlzLnBhZ2VRdWVyeSh7bGltaXQsIHVwVG9DdXJzb3J9KVxuICAgIGNvbnN0IHJlY29yZHMgPSBhd2FpdCBxdWVyeS50b0FycmF5KClcbiAgICBjb25zdCBuZXh0Q3Vyc29yID0gcmVjb3Jkcy5sZW5ndGggPiAwID8gdGhpcy5jdXJzb3JGb3JSZWNvcmQocmVjb3Jkc1tyZWNvcmRzLmxlbmd0aCAtIDFdKSA6IHVwVG9DdXJzb3JcblxuICAgIHJldHVybiB7XG4gICAgICBzdGF0dXM6IFwic3VjY2Vzc1wiLFxuICAgICAgbmV4dEN1cnNvcixcbiAgICAgIHN5bmNzOiByZWNvcmRzLm1hcCgocmVjb3JkKSA9PiB0aGlzLnNlcmlhbGl6ZVJlY29yZChyZWNvcmQpKSxcbiAgICAgIHRvdGFsLFxuICAgICAgdXBUb0N1cnNvclxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBOb3JtYWxpemVzIHRoZSByZXF1ZXN0ZWQgcGFnZSBsaW1pdC5cbiAgICogQHBhcmFtIHt1bmtub3dufSB2YWx1ZSAtIFJhdyBsaW1pdCBwYXJhbS5cbiAgICogQHJldHVybnMge251bWJlcn0gTm9ybWFsaXplZCBwYWdlIGxpbWl0LlxuICAgKi9cbiAgbm9ybWFsaXplZExpbWl0KHZhbHVlKSB7XG4gICAgaWYgKHZhbHVlID09PSB1bmRlZmluZWQgfHwgdmFsdWUgPT09IG51bGwgfHwgdmFsdWUgPT09IFwiXCIpIHJldHVybiB0aGlzLmRlZmF1bHRMaW1pdFxuXG4gICAgY29uc3QgbGltaXQgPSBOdW1iZXIodmFsdWUpXG5cbiAgICBpZiAoIU51bWJlci5pc1NhZmVJbnRlZ2VyKGxpbWl0KSB8fCBsaW1pdCA8PSAwKSB7XG4gICAgICB0aHJvdyBWZWxvY2lvdXNFcnJvci5zYWZlKFwiU3luYyBjaGFuZ2VzIGxpbWl0IG11c3QgYmUgYSBwb3NpdGl2ZSBpbnRlZ2VyLlwiLCB7Y29kZTogXCJzeW5jLWludmFsaWQtY2hhbmdlcy1saW1pdFwifSlcbiAgICB9XG5cbiAgICByZXR1cm4gTWF0aC5taW4obGltaXQsIHRoaXMubWF4TGltaXQpXG4gIH1cblxuICAvKipcbiAgICogUGFyc2VzIGFuIG9wdGlvbmFsIHBvc2l0aXZlIGludGVnZXIgY3Vyc29yIGZpZWxkLlxuICAgKiBAcGFyYW0ge3Vua25vd259IHZhbHVlIC0gUmF3IGludGVnZXIgcGFyYW0uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gUGFyYW0gbmFtZSBmb3IgZXJyb3IgbWVzc2FnZXMuXG4gICAqIEByZXR1cm5zIHtudW1iZXIgfCBudWxsfSBQb3NpdGl2ZSBpbnRlZ2VyIHZhbHVlLCBvciBudWxsIHdoZW4gb21pdHRlZC5cbiAgICovXG4gIG9wdGlvbmFsUG9zaXRpdmVJbnRlZ2VyUGFyYW0odmFsdWUsIG5hbWUpIHtcbiAgICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCB8fCB2YWx1ZSA9PT0gbnVsbCB8fCB2YWx1ZSA9PT0gXCJcIikgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IGludGVnZXIgPSBOdW1iZXIodmFsdWUpXG5cbiAgICBpZiAoIU51bWJlci5pc1NhZmVJbnRlZ2VyKGludGVnZXIpIHx8IGludGVnZXIgPD0gMCkge1xuICAgICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShgJHtuYW1lfSBtdXN0IGJlIGEgcG9zaXRpdmUgaW50ZWdlci5gLCB7Y29kZTogXCJzeW5jLWludmFsaWQtY2hhbmdlcy1jdXJzb3JcIn0pXG4gICAgfVxuXG4gICAgcmV0dXJuIGludGVnZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgaGlnaC13YXRlciBjdXJzb3IgdGhhdCBib3VuZHMgdGhlIGN1cnJlbnQgZmVlZCBwYWdlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7aWQ6IHN0cmluZywgc2VydmVyU2VxdWVuY2U6IG51bWJlciwgdXBkYXRlZEF0OiBzdHJpbmd9IHwgbnVsbD59IFNuYXBzaG90IHVwcGVyLWJvdW5kIGN1cnNvci5cbiAgICovXG4gIGFzeW5jIHJlc29sdmVVcFRvQ3Vyc29yKCkge1xuICAgIGNvbnN0IHVwVG9TZXJ2ZXJTZXF1ZW5jZSA9IHRoaXMub3B0aW9uYWxQb3NpdGl2ZUludGVnZXJQYXJhbSh0aGlzLnBhcmFtcy51cFRvU2VydmVyU2VxdWVuY2UsIFwidXBUb1NlcnZlclNlcXVlbmNlXCIpXG5cbiAgICBpZiAodXBUb1NlcnZlclNlcXVlbmNlICE9PSBudWxsICYmIHR5cGVvZiB0aGlzLnBhcmFtcy51cFRvVXBkYXRlZEF0ID09PSBcInN0cmluZ1wiICYmIHR5cGVvZiB0aGlzLnBhcmFtcy51cFRvSWQgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgIHJldHVybiB7aWQ6IHRoaXMucGFyYW1zLnVwVG9JZCwgc2VydmVyU2VxdWVuY2U6IHVwVG9TZXJ2ZXJTZXF1ZW5jZSwgdXBkYXRlZEF0OiB0aGlzLnBhcmFtcy51cFRvVXBkYXRlZEF0fVxuICAgIH1cblxuICAgIGlmICh0eXBlb2YgdGhpcy5wYXJhbXMudXBUb1VwZGF0ZWRBdCA9PT0gXCJzdHJpbmdcIiAmJiB0eXBlb2YgdGhpcy5wYXJhbXMudXBUb0lkID09PSBcInN0cmluZ1wiKSB7XG4gICAgICBjb25zdCB1cFRvUmVjb3JkID0gYXdhaXQgdGhpcy5tb2RlbENsYXNzLmZpbmRCeSh7aWQ6IHRoaXMucGFyYW1zLnVwVG9JZH0pXG5cbiAgICAgIGlmICh1cFRvUmVjb3JkKSByZXR1cm4gdGhpcy5jdXJzb3JGb3JSZWNvcmQodXBUb1JlY29yZClcbiAgICB9XG5cbiAgICBjb25zdCBxdWVyeSA9IHRoaXMuc2NvcGVkUXVlcnkoKVxuICAgIGNvbnN0IHRhYmxlID0gcXVlcnkuZHJpdmVyLnF1b3RlVGFibGUodGhpcy5tb2RlbENsYXNzLnRhYmxlTmFtZSgpKVxuICAgIGNvbnN0IHNlcnZlclNlcXVlbmNlQ29sdW1uID0gcXVlcnkuZHJpdmVyLnF1b3RlQ29sdW1uKFwic2VydmVyX3NlcXVlbmNlXCIpXG4gICAgY29uc3QgbGF0ZXN0UmVjb3JkcyA9IGF3YWl0IHF1ZXJ5XG4gICAgICAub3JkZXIoYCR7dGFibGV9LiR7c2VydmVyU2VxdWVuY2VDb2x1bW59IERFU0NgKVxuICAgICAgLmxpbWl0KDEpXG4gICAgICAudG9BcnJheSgpXG5cbiAgICBpZiAobGF0ZXN0UmVjb3Jkcy5sZW5ndGggPT09IDApIHJldHVybiBudWxsXG5cbiAgICByZXR1cm4gdGhpcy5jdXJzb3JGb3JSZWNvcmQobGF0ZXN0UmVjb3Jkc1swXSlcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIG9yZGVyZWQgYW5kIGN1cnNvci1maWx0ZXJlZCBwYWdlIHF1ZXJ5LlxuICAgKiBAcGFyYW0ge3tsaW1pdDogbnVtYmVyLCB1cFRvQ3Vyc29yOiB7aWQ6IHN0cmluZywgc2VydmVyU2VxdWVuY2U6IG51bWJlciwgdXBkYXRlZEF0OiBzdHJpbmd9fX0gYXJncyAtIFBhZ2UgcXVlcnkgYXJncy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHR9IFBhZ2UgcXVlcnkuXG4gICAqL1xuICBwYWdlUXVlcnkoe2xpbWl0LCB1cFRvQ3Vyc29yfSkge1xuICAgIGNvbnN0IHF1ZXJ5ID0gdGhpcy5jdXJzb3JGaWx0ZXJlZFF1ZXJ5KHt1cFRvQ3Vyc29yfSlcbiAgICBjb25zdCBkcml2ZXIgPSBxdWVyeS5kcml2ZXJcbiAgICBjb25zdCBzZXJ2ZXJTZXF1ZW5jZUNvbHVtbiA9IGAke2RyaXZlci5xdW90ZVRhYmxlKHRoaXMubW9kZWxDbGFzcy50YWJsZU5hbWUoKSl9LiR7ZHJpdmVyLnF1b3RlQ29sdW1uKFwic2VydmVyX3NlcXVlbmNlXCIpfWBcblxuICAgIHJldHVybiBxdWVyeVxuICAgICAgLm9yZGVyKGAke3NlcnZlclNlcXVlbmNlQ29sdW1ufSBBU0NgKVxuICAgICAgLmxpbWl0KGxpbWl0KVxuICB9XG5cbiAgLyoqXG4gICAqIENvdW50cyB0aGUgc2NvcGUncyBwZW5kaW5nIGNoYW5nZSByb3dzIGZyb20gdGhlIHJlcXVlc3QgY3Vyc29yIHRvIHRoZSBzbmFwc2hvdFxuICAgKiBib3VuZCB3aXRob3V0IG1hdGVyaWFsaXppbmcgdGhlbSwgc28gdGhlIGNsaWVudCBjYW4gcmVuZGVyIGEgc3RhYmxlIFwib2YgWVwiXG4gICAqIHByb2dyZXNzIGRlbm9taW5hdG9yLlxuICAgKiBAcGFyYW0ge3t1cFRvQ3Vyc29yOiB7aWQ6IHN0cmluZywgc2VydmVyU2VxdWVuY2U6IG51bWJlciwgdXBkYXRlZEF0OiBzdHJpbmd9fX0gYXJncyAtIENvdW50IGFyZ3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IFBlbmRpbmcgY2hhbmdlIGNvdW50IGZyb20gdGhlIHJlcXVlc3QgY3Vyc29yLlxuICAgKi9cbiAgYXN5bmMgdG90YWxQZW5kaW5nQ2hhbmdlcyh7dXBUb0N1cnNvcn0pIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5jdXJzb3JGaWx0ZXJlZFF1ZXJ5KHt1cFRvQ3Vyc29yfSkuY291bnQoKVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBhIHNjb3BlZCBxdWVyeSB3aXRoIHRoZSBzbmFwc2hvdCB1cHBlciBib3VuZCBhbmQgYWZ0ZXItY3Vyc29yIGZpbHRlcnNcbiAgICogYXBwbGllZCwgYnV0IHdpdGhvdXQgb3JkZXJpbmcgb3IgYSBwYWdlIGxpbWl0LiBTaGFyZWQgYnkgdGhlIHBhZ2UgcmVhZCBhbmQgdGhlXG4gICAqIHRvdGFsLWNvdW50IHNvIGJvdGggY291bnQgdGhlIHNhbWUgc2V0IG9mIHJvd3MuXG4gICAqIEBwYXJhbSB7e3VwVG9DdXJzb3I6IHtpZDogc3RyaW5nLCBzZXJ2ZXJTZXF1ZW5jZTogbnVtYmVyLCB1cGRhdGVkQXQ6IHN0cmluZ319fSBhcmdzIC0gRmlsdGVyIGFyZ3MuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0fSBDdXJzb3ItZmlsdGVyZWQgcXVlcnkuXG4gICAqL1xuICBjdXJzb3JGaWx0ZXJlZFF1ZXJ5KHt1cFRvQ3Vyc29yfSkge1xuICAgIGNvbnN0IHF1ZXJ5ID0gdGhpcy5zY29wZWRRdWVyeSgpXG4gICAgY29uc3QgZHJpdmVyID0gcXVlcnkuZHJpdmVyXG4gICAgY29uc3QgdGFibGUgPSBkcml2ZXIucXVvdGVUYWJsZSh0aGlzLm1vZGVsQ2xhc3MudGFibGVOYW1lKCkpXG4gICAgY29uc3Qgc2VydmVyU2VxdWVuY2VDb2x1bW4gPSBgJHt0YWJsZX0uJHtkcml2ZXIucXVvdGVDb2x1bW4oXCJzZXJ2ZXJfc2VxdWVuY2VcIil9YFxuICAgIGNvbnN0IHVwZGF0ZWRBdENvbHVtbiA9IGAke3RhYmxlfS4ke2RyaXZlci5xdW90ZUNvbHVtbihcInVwZGF0ZWRfYXRcIil9YFxuICAgIGNvbnN0IGlkQ29sdW1uID0gYCR7dGFibGV9LiR7ZHJpdmVyLnF1b3RlQ29sdW1uKFwiaWRcIil9YFxuXG4gICAgcXVlcnkud2hlcmUoYCR7c2VydmVyU2VxdWVuY2VDb2x1bW59IDw9ICR7ZHJpdmVyLnF1b3RlKHVwVG9DdXJzb3Iuc2VydmVyU2VxdWVuY2UpfWApXG5cbiAgICBjb25zdCBhZnRlclNlcnZlclNlcXVlbmNlID0gdGhpcy5vcHRpb25hbFBvc2l0aXZlSW50ZWdlclBhcmFtKHRoaXMucGFyYW1zLmFmdGVyU2VydmVyU2VxdWVuY2UsIFwiYWZ0ZXJTZXJ2ZXJTZXF1ZW5jZVwiKVxuXG4gICAgaWYgKGFmdGVyU2VydmVyU2VxdWVuY2UgIT09IG51bGwpIHtcbiAgICAgIHF1ZXJ5LndoZXJlKGAke3NlcnZlclNlcXVlbmNlQ29sdW1ufSA+ICR7ZHJpdmVyLnF1b3RlKGFmdGVyU2VydmVyU2VxdWVuY2UpfWApXG4gICAgfSBlbHNlIGlmICh0eXBlb2YgdGhpcy5wYXJhbXMuYWZ0ZXJVcGRhdGVkQXQgPT09IFwic3RyaW5nXCIgJiYgdGhpcy5wYXJhbXMuYWZ0ZXJVcGRhdGVkQXQgIT09IFwiXCIpIHtcbiAgICAgIGNvbnN0IGlzUGFnaW5nRXhpc3RpbmdTbmFwc2hvdCA9IHR5cGVvZiB0aGlzLnBhcmFtcy51cFRvVXBkYXRlZEF0ID09PSBcInN0cmluZ1wiICYmIHRoaXMucGFyYW1zLnVwVG9VcGRhdGVkQXQgIT09IFwiXCIgJiYgdHlwZW9mIHRoaXMucGFyYW1zLnVwVG9JZCA9PT0gXCJzdHJpbmdcIiAmJiB0aGlzLnBhcmFtcy51cFRvSWQgIT09IFwiXCJcblxuICAgICAgaWYgKGlzUGFnaW5nRXhpc3RpbmdTbmFwc2hvdCAmJiB0eXBlb2YgdGhpcy5wYXJhbXMuYWZ0ZXJJZCA9PT0gXCJzdHJpbmdcIiAmJiB0aGlzLnBhcmFtcy5hZnRlcklkICE9PSBcIlwiKSB7XG4gICAgICAgIHF1ZXJ5LndoZXJlKGAoJHt1cGRhdGVkQXRDb2x1bW59ID4gJHtkcml2ZXIucXVvdGUodGhpcy5wYXJhbXMuYWZ0ZXJVcGRhdGVkQXQpfSBPUiAoJHt1cGRhdGVkQXRDb2x1bW59ID0gJHtkcml2ZXIucXVvdGUodGhpcy5wYXJhbXMuYWZ0ZXJVcGRhdGVkQXQpfSBBTkQgJHtpZENvbHVtbn0gPiAke2RyaXZlci5xdW90ZSh0aGlzLnBhcmFtcy5hZnRlcklkKX0pKWApXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBxdWVyeS53aGVyZShgJHt1cGRhdGVkQXRDb2x1bW59ID49ICR7ZHJpdmVyLnF1b3RlKHRoaXMucGFyYW1zLmFmdGVyVXBkYXRlZEF0KX1gKVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBxdWVyeVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBhIGJhc2UgcXVlcnkgd2l0aCBhcHAtb3duZWQgc2NvcGUgYXBwbGllZC5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2RhdGFiYXNlL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHR9IFNjb3BlZCBiYXNlIHF1ZXJ5LlxuICAgKi9cbiAgc2NvcGVkUXVlcnkoKSB7XG4gICAgY29uc3QgcXVlcnkgPSB0aGlzLm1vZGVsQ2xhc3Mud2hlcmUoe30pXG5cbiAgICBpZiAodGhpcy5zY29wZVF1ZXJ5KSB0aGlzLnNjb3BlUXVlcnkoe3F1ZXJ5fSlcblxuICAgIHJldHVybiBxdWVyeVxuICB9XG5cbiAgLyoqXG4gICAqIFNlcmlhbGl6ZXMgYSByZWNvcmQgaW50byBhIHRyYW5zcG9ydCBjdXJzb3IuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHJlY29yZCAtIFN5bmMvY2hhbmdlIHJlY29yZC5cbiAgICogQHJldHVybnMge3tpZDogc3RyaW5nLCBzZXJ2ZXJTZXF1ZW5jZTogbnVtYmVyLCB1cGRhdGVkQXQ6IHN0cmluZ319IEN1cnNvciBmb3Igcm93LlxuICAgKi9cbiAgY3Vyc29yRm9yUmVjb3JkKHJlY29yZCkge1xuICAgIHJldHVybiB7aWQ6IFN0cmluZyh0aGlzLnJlY29yZFZhbHVlKHJlY29yZCwgXCJpZFwiKSksIHNlcnZlclNlcXVlbmNlOiBOdW1iZXIodGhpcy5yZWNvcmRWYWx1ZShyZWNvcmQsIFwic2VydmVyU2VxdWVuY2VcIikpLCB1cGRhdGVkQXQ6IHRoaXMuaXNvRGF0ZSh0aGlzLnJlY29yZFZhbHVlKHJlY29yZCwgXCJ1cGRhdGVkQXRcIikpfVxuICB9XG5cbiAgLyoqXG4gICAqIFNlcmlhbGl6ZXMgYSByZWNvcmQgdXNpbmcgdGhlIHN0YW5kYXJkIHN5bmMgZW52ZWxvcGUgc2hhcGUgcGx1cyB0aGUgc3luY1xuICAgKiBtb2RlbCdzIGRlY2xhcmVkIHNjb3BlLXBhcnRpdGlvbiBhdHRyaWJ1dGVzIChgc3RhdGljIHN5bmNTY29wZUF0dHJpYnV0ZXNgKSxcbiAgICogZWFjaCBlbWl0dGVkIHVuZGVyIGl0cyBvd24gYXR0cmlidXRlIG5hbWUuIE1vZGVscyBkZWNsYXJpbmcgbm8gc2NvcGVcbiAgICogYXR0cmlidXRlcyBrZWVwIHRoZSBkZXByZWNhdGVkIDEuMC41MDMgd2lyZSBhbmQgZW1pdCBgZXZlbnRJZGAuIEtleXMgYXJlXG4gICAqIHNvcnRlZCBzbyBhIGRlY2xhcmVkIGBbXCJldmVudElkXCJdYCBwYXJ0aXRpb24gc3RheXMgYnl0ZS1pZGVudGljYWwgd2l0aCB0aGVcbiAgICogMS4wLjUwMyB3aXJlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSByZWNvcmQgLSBTeW5jL2NoYW5nZSByZWNvcmQuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn0gRGVmYXVsdCBzZXJpYWxpemVkIHJvdy5cbiAgICovXG4gIGRlZmF1bHRTZXJpYWxpemVSZWNvcmQocmVjb3JkKSB7XG4gICAgY29uc3Qgc2NvcGVBdHRyaWJ1dGVzID0gZGVjbGFyZWRTeW5jU2NvcGVBdHRyaWJ1dGVzKHRoaXMubW9kZWxDbGFzcylcbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSAqL1xuICAgIGNvbnN0IHNlcmlhbGl6ZWQgPSB7XG4gICAgICBkYXRhOiB0aGlzLnJlY29yZERhdGEocmVjb3JkKSxcbiAgICAgIGlkOiB0aGlzLnJlY29yZFZhbHVlKHJlY29yZCwgXCJpZFwiKSxcbiAgICAgIHJlc291cmNlSWQ6IHRoaXMucmVjb3JkVmFsdWUocmVjb3JkLCBcInJlc291cmNlSWRcIiksXG4gICAgICByZXNvdXJjZVR5cGU6IHRoaXMucmVjb3JkVmFsdWUocmVjb3JkLCBcInJlc291cmNlVHlwZVwiKSxcbiAgICAgIHNlcnZlclNlcXVlbmNlOiB0aGlzLnJlY29yZFZhbHVlKHJlY29yZCwgXCJzZXJ2ZXJTZXF1ZW5jZVwiKSxcbiAgICAgIHN5bmNUeXBlOiB0aGlzLnJlY29yZFZhbHVlKHJlY29yZCwgXCJzeW5jVHlwZVwiKSxcbiAgICAgIHVwZGF0ZWRBdDogdGhpcy5pc29EYXRlKHRoaXMucmVjb3JkVmFsdWUocmVjb3JkLCBcInVwZGF0ZWRBdFwiKSlcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IHNjb3BlQXR0cmlidXRlIG9mIHNjb3BlQXR0cmlidXRlcyB8fCBbXCJldmVudElkXCJdKSB7XG4gICAgICBzZXJpYWxpemVkW3Njb3BlQXR0cmlidXRlXSA9IHRoaXMucmVjb3JkVmFsdWUocmVjb3JkLCBzY29wZUF0dHJpYnV0ZSlcbiAgICB9XG5cbiAgICByZXR1cm4gT2JqZWN0LmZyb21FbnRyaWVzKE9iamVjdC5lbnRyaWVzKHNlcmlhbGl6ZWQpLnNvcnQoKFtsZWZ0S2V5XSwgW3JpZ2h0S2V5XSkgPT4gbGVmdEtleS5sb2NhbGVDb21wYXJlKHJpZ2h0S2V5KSkpXG4gIH1cblxuICAvKipcbiAgICogUmVhZHMgYW5kIHBhcnNlcyB0aGUgcmVjb3JkIGRhdGEgcGF5bG9hZC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gcmVjb3JkIC0gU3luYy9jaGFuZ2UgcmVjb3JkLlxuICAgKiBAcmV0dXJucyB7dW5rbm93bn0gUGFyc2VkIGRhdGEgdmFsdWUuXG4gICAqL1xuICByZWNvcmREYXRhKHJlY29yZCkge1xuICAgIGNvbnN0IGRhdGEgPSB0aGlzLnJlY29yZFZhbHVlKHJlY29yZCwgXCJkYXRhXCIpXG5cbiAgICBpZiAoZGF0YSA9PT0gXCJcIiB8fCBkYXRhID09PSBudWxsIHx8IGRhdGEgPT09IHVuZGVmaW5lZCkgcmV0dXJuIG51bGxcbiAgICByZXR1cm4gZGVjb2RlUmVwbGF5UGVyc2lzdGVkRGF0YShkYXRhKS5wYXlsb2FkXG4gIH1cblxuICAvKipcbiAgICogUmVhZHMgYSB2YWx1ZSBmcm9tIGVpdGhlciBhIHJlY29yZCBhY2Nlc3NvciBtZXRob2Qgb3IgcGxhaW4gcHJvcGVydHkuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHJlY29yZCAtIFN5bmMvY2hhbmdlIHJlY29yZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBDYW1lbC1jYXNlZCB2YWx1ZS9tZXRob2QgbmFtZS5cbiAgICogQHJldHVybnMge3Vua25vd259IFJlY29yZCB2YWx1ZS5cbiAgICovXG4gIHJlY29yZFZhbHVlKHJlY29yZCwgbmFtZSkge1xuICAgIGlmICghcmVjb3JkIHx8IHR5cGVvZiByZWNvcmQgIT09IFwib2JqZWN0XCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlN5bmMgY2hhbmdlcyByb3cgbXVzdCBiZSBhbiBvYmplY3QuXCIpXG4gICAgfVxuXG4gICAgY29uc3QgcmVjb3JkT2JqZWN0ID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChyZWNvcmQpXG4gICAgY29uc3QgbWV0aG9kID0gcmVjb3JkT2JqZWN0W25hbWVdXG4gICAgY29uc3QgdmFsdWUgPSB0eXBlb2YgbWV0aG9kID09PSBcImZ1bmN0aW9uXCIgPyBtZXRob2QuY2FsbChyZWNvcmQpIDogbWV0aG9kXG5cbiAgICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBTeW5jIGNoYW5nZXMgcm93IGlzIG1pc3NpbmcgJHtuYW1lfS5gKVxuICAgIH1cblxuICAgIHJldHVybiB2YWx1ZVxuICB9XG5cbiAgLyoqXG4gICAqIENvbnZlcnRzIGEgZGF0ZS1saWtlIHZhbHVlIHRvIGFuIElTTyBzdHJpbmcuXG4gICAqIEBwYXJhbSB7RGF0ZSB8IHN0cmluZyB8IG51bGwgfCB1bmRlZmluZWQgfCB1bmtub3dufSB2YWx1ZSAtIERhdGUgdmFsdWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IElTTyBkYXRlLlxuICAgKi9cbiAgaXNvRGF0ZSh2YWx1ZSkge1xuICAgIGNvbnN0IGRhdGUgPSB2YWx1ZSBpbnN0YW5jZW9mIERhdGUgPyB2YWx1ZSA6IG5ldyBEYXRlKHR5cGVvZiB2YWx1ZSA9PT0gXCJzdHJpbmdcIiB8fCB0eXBlb2YgdmFsdWUgPT09IFwibnVtYmVyXCIgPyB2YWx1ZSA6IDApXG5cbiAgICBpZiAoTnVtYmVyLmlzTmFOKGRhdGUuZ2V0VGltZSgpKSkge1xuICAgICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShcIlN5bmMgY2hhbmdlcyByb3cgaGFzIGFuIGludmFsaWQgdXBkYXRlZF9hdCB2YWx1ZS5cIiwge2NvZGU6IFwic3luYy1pbnZhbGlkLWNoYW5nZXMtcm93XCJ9KVxuICAgIH1cblxuICAgIHJldHVybiBkYXRlLnRvSVNPU3RyaW5nKClcbiAgfVxufVxuIl19