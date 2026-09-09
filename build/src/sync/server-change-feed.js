// @ts-check
import { randomUUID } from "crypto";
import TableData from "../database/table-data/index.js";
import stableJsonStringify from "./stable-json.js";
/**
 * @typedef {object} ServerChangeFeedEntry
 * @property {string | null} actorDeviceId - Signed mutation actor device id when available.
 * @property {string | null} actorUserId - Signed mutation actor user id when available.
 * @property {Record<string, ReturnType<typeof JSON.parse>> | null} attributes - Serialized mutation attributes.
 * @property {string} createdAt - Server change creation timestamp.
 * @property {string} id - Server change id.
 * @property {string | null} idempotencyKey - Mutation idempotency key when available.
 * @property {string} model - Frontend model name.
 * @property {string} operation - Mutation operation.
 * @property {Record<string, ReturnType<typeof JSON.parse>> | null} payload - Serialized mutation payload.
 * @property {string | null} recordId - Changed record id when known.
 * @property {Record<string, ReturnType<typeof JSON.parse>> | null} response - Command response payload.
 * @property {Record<string, ReturnType<typeof JSON.parse>> | null} scope - Offline grant scope.
 * @property {number} serverSequence - Monotonic server sequence.
 */
/**
 * @typedef {object} ServerChangeFeedRow
 * @property {string | null} actor_device_id - Actor device id.
 * @property {string | null} actor_user_id - Actor user id.
 * @property {string | null} attributes_json - Attributes JSON.
 * @property {Date | string} created_at - Creation time.
 * @property {string} id - Entry id.
 * @property {string | null} idempotency_key - Mutation idempotency key.
 * @property {string} model - Frontend model name.
 * @property {string} operation - Mutation operation.
 * @property {string | null} payload_json - Mutation payload JSON.
 * @property {string | null} record_id - Record id.
 * @property {string | null} response_json - Response JSON.
 * @property {string | null} scope_json - Scope JSON.
 * @property {number | string} server_sequence - Server sequence.
 */
const DEFAULT_RETENTION_SIZE = 10000;
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 1000;
const TABLE_NAME = "frontend_model_sync_changes";
const stores = new WeakMap();
/**
 * Shared server change-feed store for a configuration.
 * @param {import("../configuration.js").default} configuration - Configuration.
 * @returns {ServerChangeFeedStore} - Store.
 */
export function serverChangeFeedStoreForConfiguration(configuration) {
    let store = stores.get(configuration);
    if (!store) {
        store = new ServerChangeFeedStore({ configuration });
        stores.set(configuration, store);
    }
    return store;
}
export default class ServerChangeFeedStore {
    /**
     * Runs constructor.
     * @param {object} args - Options.
     * @param {import("../configuration.js").default} args.configuration - Configuration.
     * @param {string} [args.databaseIdentifier] - Database identifier.
     * @param {number} [args.retentionSize] - Number of feed entries to retain.
     */
    constructor({ configuration, databaseIdentifier = "default", retentionSize }) {
        const syncConfiguration = configuration.getSyncConfiguration();
        this.configuration = configuration;
        this.databaseIdentifier = databaseIdentifier;
        this.retentionSize = retentionSize || syncConfiguration.changeFeedRetentionSize || DEFAULT_RETENTION_SIZE;
        /** @type {ServerChangeFeedEntry[]} */
        this._memoryChanges = [];
        this._memorySequence = 0;
        this._isReady = false;
        /** @type {Promise<void> | null} */
        this._readyPromise = null;
        /** @type {WeakMap<import("../database/drivers/base.js").default, {completion: Promise<void>, promise: Promise<void>}>} */
        this._transactionReadyPromises = new WeakMap();
    }
    /**
     * Ensures the backing table exists.
     * @returns {Promise<void>} - Resolves when ready.
     */
    async ensureReady() {
        if (this._usesMemoryStorage()) {
            this._isReady = true;
            return;
        }
        if (await this._schemaReady())
            return;
        this.configuration.setCurrent();
        await this._withDb(async (db) => await this._ensureReadyWithDb(db));
    }
    /**
     * Coordinates durable and transaction-local readiness on one connection.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<void>} Resolves when this caller can use the table.
     */
    async _ensureReadyWithDb(db) {
        if (this._isReady)
            return;
        const transactionCompletion = db.insideTransaction() ? db.transactionCompletion() : null;
        const transactionReady = this._transactionReadyPromises.get(db);
        if (transactionCompletion && transactionReady?.completion === transactionCompletion) {
            await transactionReady.promise;
            return;
        }
        if (this._readyPromise) {
            const readyPromise = this._readyPromise;
            await readyPromise;
            if (this._readyPromise === readyPromise)
                this._readyPromise = null;
            if (this._isReady)
                return;
            await this.ensureReady();
            return;
        }
        if (transactionCompletion) {
            const tableReadyPromise = this._ensureChangesTable(db);
            const transactionReadyPromise = tableReadyPromise.then(() => undefined);
            const durableReadyPromise = tableReadyPromise.then(async (created) => {
                if (!created) {
                    this._isReady = true;
                    return;
                }
                await transactionCompletion;
            });
            this._transactionReadyPromises.set(db, { completion: transactionCompletion, promise: transactionReadyPromise });
            this._readyPromise = durableReadyPromise;
            await transactionReadyPromise;
            return;
        }
        this._readyPromise = this._ensureChangesTable(db).then(() => {
            this._isReady = true;
        });
        try {
            await this._readyPromise;
        }
        finally {
            if (!this._isReady)
                this._readyPromise = null;
        }
    }
    /**
     * Appends a change and assigns the next server sequence.
     * @param {Omit<ServerChangeFeedEntry, "createdAt" | "id" | "serverSequence"> & {createdAt?: string, id?: string}} change - Change payload.
     * @returns {Promise<ServerChangeFeedEntry>} - Persisted change.
     */
    async append(change) {
        await this.ensureReady();
        const id = change.id || randomUUID();
        const createdAt = change.createdAt || new Date().toISOString();
        if (this._usesMemoryStorage())
            return this._appendMemory({ ...change, createdAt, id });
        return await this._withDb(async (db) => {
            await db.insert({
                tableName: TABLE_NAME,
                data: {
                    actor_device_id: change.actorDeviceId,
                    actor_user_id: change.actorUserId,
                    attributes_json: JSON.stringify(change.attributes || null),
                    created_at: new Date(createdAt),
                    id,
                    idempotency_key: change.idempotencyKey,
                    model: change.model,
                    operation: change.operation,
                    payload_json: JSON.stringify(change.payload || null),
                    record_id: change.recordId === null || change.recordId === undefined ? null : String(change.recordId),
                    response_json: JSON.stringify(change.response || null),
                    scope_json: stableJsonStringify(change.scope || null)
                }
            });
            const row = await this._changeById(db, id);
            if (!row)
                throw new Error("Failed to persist server change-feed entry");
            await this._pruneRetainedChanges(db, row.serverSequence);
            return row;
        });
    }
    /**
     * Returns current latest server sequence.
     * @returns {Promise<number>} - Latest sequence.
     */
    async latestSequence() {
        await this.ensureReady();
        if (this._usesMemoryStorage())
            return this._memorySequence;
        return await this._withDb(async (db) => {
            const rows = await db
                .newQuery()
                .from(TABLE_NAME)
                .order("server_sequence DESC")
                .limit(1)
                .results();
            const row = /** @type {{server_sequence?: number | string} | undefined} */ (rows[0]);
            return row ? Number(row.server_sequence) : 0;
        });
    }
    /**
     * Returns oldest retained server sequence.
     * @returns {Promise<number | null>} - Oldest retained sequence.
     */
    async oldestSequence() {
        await this.ensureReady();
        if (this._usesMemoryStorage())
            return this._memoryChanges[0]?.serverSequence || null;
        return await this._withDb(async (db) => await this._oldestSequence(db));
    }
    /**
     * Returns ordered changes after a cursor.
     * @param {object} args - Arguments.
     * @param {number} args.afterSequence - Exclusive lower bound.
     * @param {number} [args.limit] - Maximum number of changes.
     * @param {number} [args.upToSequence] - Inclusive upper bound.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} [args.scope] - Caller sync scope.
     * @returns {Promise<{changes: ServerChangeFeedEntry[], hasMore: boolean, nextSequence: number, oldestSequence: number | null, snapshotRequired: boolean, upToSequence: number}>} - Ordered page.
     */
    async changesAfter({ afterSequence, limit = DEFAULT_PAGE_SIZE, scope, upToSequence }) {
        await this.ensureReady();
        const pageSize = normalizeLimit(limit);
        if (this._usesMemoryStorage())
            return this._memoryChangesAfter({ afterSequence, limit: pageSize, scope, upToSequence });
        return await this._withDb(async (db) => {
            const latestSequence = typeof upToSequence === "number" ? upToSequence : await this._latestSequence(db);
            const oldestSequence = await this._oldestSequence(db);
            const snapshotRequired = afterSequence > 0 && oldestSequence !== null && oldestSequence > afterSequence + 1;
            if (snapshotRequired) {
                return {
                    changes: [],
                    hasMore: false,
                    nextSequence: afterSequence,
                    oldestSequence,
                    snapshotRequired: true,
                    upToSequence: latestSequence
                };
            }
            const rows = /** @type {ServerChangeFeedRow[]} */ (await db
                .newQuery()
                .from(TABLE_NAME)
                .where(`server_sequence > ${db.quote(afterSequence)}`)
                .where(`server_sequence <= ${db.quote(latestSequence)}`)
                .where(scope === undefined ? "1 = 1" : { scope_json: stableJsonStringify(scope) })
                .order("server_sequence ASC")
                .limit(pageSize + 1)
                .results());
            const hasMore = rows.length > pageSize;
            const pageRows = rows.slice(0, pageSize);
            const changes = pageRows.map((row) => this._normalizeChangeRow(row));
            const lastChange = changes[changes.length - 1];
            return {
                changes,
                hasMore,
                nextSequence: lastChange ? lastChange.serverSequence : afterSequence,
                oldestSequence,
                snapshotRequired: false,
                upToSequence: latestSequence
            };
        });
    }
    /**
     * Ensures schema is still present.
     * @returns {Promise<boolean>} - Whether ready.
     */
    async _schemaReady() {
        if (this._usesMemoryStorage())
            return this._isReady;
        if (!this._isReady)
            return false;
        if (await this._withDb(async (db) => await db.tableExists(TABLE_NAME)))
            return true;
        this._isReady = false;
        this._readyPromise = null;
        return false;
    }
    /**
     * Ensures changes table exists.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<boolean>} - Whether the table had to be created.
     */
    async _ensureChangesTable(db) {
        if (await db.tableExists(TABLE_NAME))
            return false;
        const table = new TableData(TABLE_NAME, { ifNotExists: true });
        table.integer("server_sequence", { autoIncrement: true, null: false, primaryKey: true });
        table.string("id", { index: true, null: false });
        table.string("model", { index: true, null: false });
        table.string("operation", { null: false });
        table.string("record_id", { index: true, null: true });
        table.text("payload_json", { null: true });
        table.text("attributes_json", { null: true });
        table.string("idempotency_key", { index: true, null: true });
        table.string("actor_user_id", { index: true, null: true });
        table.string("actor_device_id", { index: true, null: true });
        table.text("scope_json", { null: true });
        table.text("response_json", { null: true });
        table.datetime("created_at", { index: true, null: false });
        await db.createTable(table);
        return true;
    }
    /**
     * Resolves a persisted change by id.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {string} id - Entry id.
     * @returns {Promise<ServerChangeFeedEntry | null>} - Entry or null.
     */
    async _changeById(db, id) {
        const rows = /** @type {ServerChangeFeedRow[]} */ (await db
            .newQuery()
            .from(TABLE_NAME)
            .where({ id })
            .limit(1)
            .results());
        return rows[0] ? this._normalizeChangeRow(rows[0]) : null;
    }
    /**
     * Resolves current latest sequence without readiness checks.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<number>} - Latest sequence.
     */
    async _latestSequence(db) {
        const rows = /** @type {Array<{server_sequence?: number | string}>} */ (await db
            .newQuery()
            .from(TABLE_NAME)
            .order("server_sequence DESC")
            .limit(1)
            .results());
        return rows[0] ? Number(rows[0].server_sequence) : 0;
    }
    /**
     * Resolves current oldest sequence without readiness checks.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<number | null>} - Oldest sequence.
     */
    async _oldestSequence(db) {
        const rows = /** @type {Array<{server_sequence?: number | string}>} */ (await db
            .newQuery()
            .from(TABLE_NAME)
            .order("server_sequence ASC")
            .limit(1)
            .results());
        return rows[0] ? Number(rows[0].server_sequence) : null;
    }
    /**
     * Prunes old retained changes.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {number} latestSequence - Latest sequence after append.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async _pruneRetainedChanges(db, latestSequence) {
        if (!Number.isInteger(this.retentionSize) || this.retentionSize < 1)
            return;
        const pruneBeforeOrAt = latestSequence - this.retentionSize;
        if (pruneBeforeOrAt < 1)
            return;
        const rows = /** @type {Array<{id: string}>} */ (await db
            .newQuery()
            .from(TABLE_NAME)
            .where(`server_sequence <= ${db.quote(pruneBeforeOrAt)}`)
            .results());
        for (const row of rows) {
            await db.delete({ conditions: { id: row.id }, tableName: TABLE_NAME });
        }
    }
    /**
     * Normalizes a change row.
     * @param {ServerChangeFeedRow} row - Raw database row.
     * @returns {ServerChangeFeedEntry} - Normalized change.
     */
    _normalizeChangeRow(row) {
        const createdAtValue = row.created_at;
        return {
            actorDeviceId: row.actor_device_id || null,
            actorUserId: row.actor_user_id || null,
            attributes: parseJsonOrNull(row.attributes_json),
            createdAt: createdAtValue instanceof Date ? createdAtValue.toISOString() : new Date(createdAtValue).toISOString(),
            id: row.id,
            idempotencyKey: row.idempotency_key || null,
            model: row.model,
            operation: row.operation,
            payload: parseJsonOrNull(row.payload_json),
            recordId: row.record_id || null,
            response: parseJsonOrNull(row.response_json),
            scope: parseJsonOrNull(row.scope_json),
            serverSequence: Number(row.server_sequence)
        };
    }
    /**
     * Whether this store should use process-local memory because no database identifier is configured.
     * @returns {boolean} - Whether memory storage is active.
     */
    _usesMemoryStorage() {
        try {
            return !this.configuration.getDatabaseConfiguration()[this.databaseIdentifier];
        }
        catch {
            return true;
        }
    }
    /**
     * Appends a process-local memory entry when no database is configured.
     * @param {Omit<ServerChangeFeedEntry, "serverSequence">} change - Change payload.
     * @returns {ServerChangeFeedEntry} - Appended entry.
     */
    _appendMemory(change) {
        const entry = /** @type {ServerChangeFeedEntry} */ ({
            actorDeviceId: change.actorDeviceId,
            actorUserId: change.actorUserId,
            attributes: change.attributes || null,
            createdAt: change.createdAt,
            id: change.id,
            idempotencyKey: change.idempotencyKey,
            model: change.model,
            operation: change.operation,
            payload: change.payload || null,
            recordId: change.recordId === null || change.recordId === undefined ? null : String(change.recordId),
            response: change.response || null,
            scope: change.scope || null,
            serverSequence: ++this._memorySequence
        });
        this._memoryChanges.push(entry);
        if (this._memoryChanges.length > this.retentionSize)
            this._memoryChanges.splice(0, this._memoryChanges.length - this.retentionSize);
        return entry;
    }
    /**
     * Returns a process-local memory change page.
     * @param {object} args - Arguments.
     * @param {number} args.afterSequence - Exclusive lower bound.
     * @param {number} args.limit - Page size.
     * @param {number} [args.upToSequence] - Inclusive upper bound.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} [args.scope] - Caller sync scope.
     * @returns {{changes: ServerChangeFeedEntry[], hasMore: boolean, nextSequence: number, oldestSequence: number | null, snapshotRequired: boolean, upToSequence: number}} - Ordered page.
     */
    _memoryChangesAfter({ afterSequence, limit, scope, upToSequence }) {
        const latestSequence = typeof upToSequence === "number" ? upToSequence : this._memorySequence;
        const oldestSequence = this._memoryChanges[0]?.serverSequence || null;
        const snapshotRequired = afterSequence > 0 && oldestSequence !== null && oldestSequence > afterSequence + 1;
        if (snapshotRequired) {
            return { changes: [], hasMore: false, nextSequence: afterSequence, oldestSequence, snapshotRequired: true, upToSequence: latestSequence };
        }
        const rows = this._memoryChanges.filter((change) => {
            return change.serverSequence > afterSequence && change.serverSequence <= latestSequence && scopesEqual(change.scope, scope);
        });
        const hasMore = rows.length > limit;
        const changes = rows.slice(0, limit);
        const lastChange = changes[changes.length - 1];
        return { changes, hasMore, nextSequence: lastChange ? lastChange.serverSequence : afterSequence, oldestSequence, snapshotRequired: false, upToSequence: latestSequence };
    }
    /**
     * Runs with db.
     * @param {(db: import("../database/drivers/base.js").default) => Promise<ReturnType<typeof JSON.parse>>} callback - Callback.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Callback result.
     */
    async _withDb(callback) {
        return await this.configuration.ensureConnections({ databaseIdentifiers: [this.databaseIdentifier], name: "Server change-feed store" }, async (dbs) => {
            const db = dbs[this.databaseIdentifier];
            if (!db)
                throw new Error(`No database connection available for identifier: ${this.databaseIdentifier}`);
            return await callback(db);
        });
    }
}
/**
 * Normalizes page limit.
 * @param {ReturnType<typeof JSON.parse>} limit - Requested limit.
 * @returns {number} - Page size.
 */
function normalizeLimit(limit) {
    if (typeof limit === "number" && Number.isInteger(limit) && limit > 0)
        return Math.min(limit, MAX_PAGE_SIZE);
    if (typeof limit === "string" && /^\d+$/.test(limit))
        return Math.min(Number(limit), MAX_PAGE_SIZE);
    return DEFAULT_PAGE_SIZE;
}
/**
 * Parses JSON-ish values.
 * @param {ReturnType<typeof JSON.parse>} value - JSON string.
 * @returns {ReturnType<typeof JSON.parse>} - Parsed value.
 */
function parseJsonOrNull(value) {
    if (typeof value !== "string" || value.length < 1)
        return null;
    return JSON.parse(value);
}
/**
 * Compares sync scopes by stable JSON representation.
 * @param {Record<string, ReturnType<typeof JSON.parse>> | null} changeScope - Persisted change scope.
 * @param {Record<string, ReturnType<typeof JSON.parse>> | undefined} requestedScope - Caller scope.
 * @returns {boolean} - Whether the change is visible for the requested scope.
 */
function scopesEqual(changeScope, requestedScope) {
    if (requestedScope === undefined)
        return true;
    return stableJsonStringify(changeScope || null) === stableJsonStringify(requestedScope);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VydmVyLWNoYW5nZS1mZWVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3N5bmMvc2VydmVyLWNoYW5nZS1mZWVkLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUMsVUFBVSxFQUFDLE1BQU0sUUFBUSxDQUFBO0FBQ2pDLE9BQU8sU0FBUyxNQUFNLGlDQUFpQyxDQUFBO0FBQ3ZELE9BQU8sbUJBQW1CLE1BQU0sa0JBQWtCLENBQUE7QUFFbEQ7Ozs7Ozs7Ozs7Ozs7OztHQWVHO0FBQ0g7Ozs7Ozs7Ozs7Ozs7OztHQWVHO0FBQ0gsTUFBTSxzQkFBc0IsR0FBRyxLQUFLLENBQUE7QUFDcEMsTUFBTSxpQkFBaUIsR0FBRyxHQUFHLENBQUE7QUFDN0IsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFBO0FBQzFCLE1BQU0sVUFBVSxHQUFHLDZCQUE2QixDQUFBO0FBQ2hELE1BQU0sTUFBTSxHQUFHLElBQUksT0FBTyxFQUFFLENBQUE7QUFFNUI7Ozs7R0FJRztBQUNILE1BQU0sVUFBVSxxQ0FBcUMsQ0FBQyxhQUFhO0lBQ2pFLElBQUksS0FBSyxHQUFHLE1BQU0sQ0FBQyxHQUFHLENBQUMsYUFBYSxDQUFDLENBQUE7SUFFckMsSUFBSSxDQUFDLEtBQUssRUFBRSxDQUFDO1FBQ1gsS0FBSyxHQUFHLElBQUkscUJBQXFCLENBQUMsRUFBQyxhQUFhLEVBQUMsQ0FBQyxDQUFBO1FBQ2xELE1BQU0sQ0FBQyxHQUFHLENBQUMsYUFBYSxFQUFFLEtBQUssQ0FBQyxDQUFBO0lBQ2xDLENBQUM7SUFFRCxPQUFPLEtBQUssQ0FBQTtBQUNkLENBQUM7QUFFRCxNQUFNLENBQUMsT0FBTyxPQUFPLHFCQUFxQjtJQUN4Qzs7Ozs7O09BTUc7SUFDSCxZQUFZLEVBQUMsYUFBYSxFQUFFLGtCQUFrQixHQUFHLFNBQVMsRUFBRSxhQUFhLEVBQUM7UUFDeEUsTUFBTSxpQkFBaUIsR0FBRyxhQUFhLENBQUMsb0JBQW9C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a1xuXG5pbXBvcnQge3JhbmRvbVVVSUR9IGZyb20gXCJjcnlwdG9cIlxuaW1wb3J0IFRhYmxlRGF0YSBmcm9tIFwiLi4vZGF0YWJhc2UvdGFibGUtZGF0YS9pbmRleC5qc1wiXG5pbXBvcnQgc3RhYmxlSnNvblN0cmluZ2lmeSBmcm9tIFwiLi9zdGFibGUtanNvbi5qc1wiXG5cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gU2VydmVyQ2hhbmdlRmVlZEVudHJ5XG4gKiBAcHJvcGVydHkge3N0cmluZyB8IG51bGx9IGFjdG9yRGV2aWNlSWQgLSBTaWduZWQgbXV0YXRpb24gYWN0b3IgZGV2aWNlIGlkIHdoZW4gYXZhaWxhYmxlLlxuICogQHByb3BlcnR5IHtzdHJpbmcgfCBudWxsfSBhY3RvclVzZXJJZCAtIFNpZ25lZCBtdXRhdGlvbiBhY3RvciB1c2VyIGlkIHdoZW4gYXZhaWxhYmxlLlxuICogQHByb3BlcnR5IHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBudWxsfSBhdHRyaWJ1dGVzIC0gU2VyaWFsaXplZCBtdXRhdGlvbiBhdHRyaWJ1dGVzLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGNyZWF0ZWRBdCAtIFNlcnZlciBjaGFuZ2UgY3JlYXRpb24gdGltZXN0YW1wLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGlkIC0gU2VydmVyIGNoYW5nZSBpZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgbnVsbH0gaWRlbXBvdGVuY3lLZXkgLSBNdXRhdGlvbiBpZGVtcG90ZW5jeSBrZXkgd2hlbiBhdmFpbGFibGUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gbW9kZWwgLSBGcm9udGVuZCBtb2RlbCBuYW1lLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IG9wZXJhdGlvbiAtIE11dGF0aW9uIG9wZXJhdGlvbi5cbiAqIEBwcm9wZXJ0eSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgbnVsbH0gcGF5bG9hZCAtIFNlcmlhbGl6ZWQgbXV0YXRpb24gcGF5bG9hZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgbnVsbH0gcmVjb3JkSWQgLSBDaGFuZ2VkIHJlY29yZCBpZCB3aGVuIGtub3duLlxuICogQHByb3BlcnR5IHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBudWxsfSByZXNwb25zZSAtIENvbW1hbmQgcmVzcG9uc2UgcGF5bG9hZC5cbiAqIEBwcm9wZXJ0eSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgbnVsbH0gc2NvcGUgLSBPZmZsaW5lIGdyYW50IHNjb3BlLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IHNlcnZlclNlcXVlbmNlIC0gTW9ub3RvbmljIHNlcnZlciBzZXF1ZW5jZS5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBTZXJ2ZXJDaGFuZ2VGZWVkUm93XG4gKiBAcHJvcGVydHkge3N0cmluZyB8IG51bGx9IGFjdG9yX2RldmljZV9pZCAtIEFjdG9yIGRldmljZSBpZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgbnVsbH0gYWN0b3JfdXNlcl9pZCAtIEFjdG9yIHVzZXIgaWQuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IG51bGx9IGF0dHJpYnV0ZXNfanNvbiAtIEF0dHJpYnV0ZXMgSlNPTi5cbiAqIEBwcm9wZXJ0eSB7RGF0ZSB8IHN0cmluZ30gY3JlYXRlZF9hdCAtIENyZWF0aW9uIHRpbWUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gaWQgLSBFbnRyeSBpZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgbnVsbH0gaWRlbXBvdGVuY3lfa2V5IC0gTXV0YXRpb24gaWRlbXBvdGVuY3kga2V5LlxuICogQHByb3BlcnR5IHtzdHJpbmd9IG1vZGVsIC0gRnJvbnRlbmQgbW9kZWwgbmFtZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBvcGVyYXRpb24gLSBNdXRhdGlvbiBvcGVyYXRpb24uXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IG51bGx9IHBheWxvYWRfanNvbiAtIE11dGF0aW9uIHBheWxvYWQgSlNPTi5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgbnVsbH0gcmVjb3JkX2lkIC0gUmVjb3JkIGlkLlxuICogQHByb3BlcnR5IHtzdHJpbmcgfCBudWxsfSByZXNwb25zZV9qc29uIC0gUmVzcG9uc2UgSlNPTi5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgbnVsbH0gc2NvcGVfanNvbiAtIFNjb3BlIEpTT04uXG4gKiBAcHJvcGVydHkge251bWJlciB8IHN0cmluZ30gc2VydmVyX3NlcXVlbmNlIC0gU2VydmVyIHNlcXVlbmNlLlxuICovXG5jb25zdCBERUZBVUxUX1JFVEVOVElPTl9TSVpFID0gMTAwMDBcbmNvbnN0IERFRkFVTFRfUEFHRV9TSVpFID0gMTAwXG5jb25zdCBNQVhfUEFHRV9TSVpFID0gMTAwMFxuY29uc3QgVEFCTEVfTkFNRSA9IFwiZnJvbnRlbmRfbW9kZWxfc3luY19jaGFuZ2VzXCJcbmNvbnN0IHN0b3JlcyA9IG5ldyBXZWFrTWFwKClcblxuLyoqXG4gKiBTaGFyZWQgc2VydmVyIGNoYW5nZS1mZWVkIHN0b3JlIGZvciBhIGNvbmZpZ3VyYXRpb24uXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24uXG4gKiBAcmV0dXJucyB7U2VydmVyQ2hhbmdlRmVlZFN0b3JlfSAtIFN0b3JlLlxuICovXG5leHBvcnQgZnVuY3Rpb24gc2VydmVyQ2hhbmdlRmVlZFN0b3JlRm9yQ29uZmlndXJhdGlvbihjb25maWd1cmF0aW9uKSB7XG4gIGxldCBzdG9yZSA9IHN0b3Jlcy5nZXQoY29uZmlndXJhdGlvbilcblxuICBpZiAoIXN0b3JlKSB7XG4gICAgc3RvcmUgPSBuZXcgU2VydmVyQ2hhbmdlRmVlZFN0b3JlKHtjb25maWd1cmF0aW9ufSlcbiAgICBzdG9yZXMuc2V0KGNvbmZpZ3VyYXRpb24sIHN0b3JlKVxuICB9XG5cbiAgcmV0dXJuIHN0b3JlXG59XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFNlcnZlckNoYW5nZUZlZWRTdG9yZSB7XG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuZGF0YWJhc2VJZGVudGlmaWVyXSAtIERhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5yZXRlbnRpb25TaXplXSAtIE51bWJlciBvZiBmZWVkIGVudHJpZXMgdG8gcmV0YWluLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2NvbmZpZ3VyYXRpb24sIGRhdGFiYXNlSWRlbnRpZmllciA9IFwiZGVmYXVsdFwiLCByZXRlbnRpb25TaXplfSkge1xuICAgIGNvbnN0IHN5bmNDb25maWd1cmF0aW9uID0gY29uZmlndXJhdGlvbi5nZXRTeW5jQ29uZmlndXJhdGlvbigpXG5cbiAgICB0aGlzLmNvbmZpZ3VyYXRpb24gPSBjb25maWd1cmF0aW9uXG4gICAgdGhpcy5kYXRhYmFzZUlkZW50aWZpZXIgPSBkYXRhYmFzZUlkZW50aWZpZXJcbiAgICB0aGlzLnJldGVudGlvblNpemUgPSByZXRlbnRpb25TaXplIHx8IHN5bmNDb25maWd1cmF0aW9uLmNoYW5nZUZlZWRSZXRlbnRpb25TaXplIHx8IERFRkFVTFRfUkVURU5USU9OX1NJWkVcbiAgICAvKiogQHR5cGUge1NlcnZlckNoYW5nZUZlZWRFbnRyeVtdfSAqL1xuICAgIHRoaXMuX21lbW9yeUNoYW5nZXMgPSBbXVxuICAgIHRoaXMuX21lbW9yeVNlcXVlbmNlID0gMFxuICAgIHRoaXMuX2lzUmVhZHkgPSBmYWxzZVxuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPiB8IG51bGx9ICovXG4gICAgdGhpcy5fcmVhZHlQcm9taXNlID0gbnVsbFxuICAgIC8qKiBAdHlwZSB7V2Vha01hcDxpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCwge2NvbXBsZXRpb246IFByb21pc2U8dm9pZD4sIHByb21pc2U6IFByb21pc2U8dm9pZD59Pn0gKi9cbiAgICB0aGlzLl90cmFuc2FjdGlvblJlYWR5UHJvbWlzZXMgPSBuZXcgV2Vha01hcCgpXG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyB0aGUgYmFja2luZyB0YWJsZSBleGlzdHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcmVhZHkuXG4gICAqL1xuICBhc3luYyBlbnN1cmVSZWFkeSgpIHtcbiAgICBpZiAodGhpcy5fdXNlc01lbW9yeVN0b3JhZ2UoKSkge1xuICAgICAgdGhpcy5faXNSZWFkeSA9IHRydWVcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChhd2FpdCB0aGlzLl9zY2hlbWFSZWFkeSgpKSByZXR1cm5cblxuICAgIHRoaXMuY29uZmlndXJhdGlvbi5zZXRDdXJyZW50KClcbiAgICBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiBhd2FpdCB0aGlzLl9lbnN1cmVSZWFkeVdpdGhEYihkYikpXG4gIH1cblxuICAvKipcbiAgICogQ29vcmRpbmF0ZXMgZHVyYWJsZSBhbmQgdHJhbnNhY3Rpb24tbG9jYWwgcmVhZGluZXNzIG9uIG9uZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyB3aGVuIHRoaXMgY2FsbGVyIGNhbiB1c2UgdGhlIHRhYmxlLlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZVJlYWR5V2l0aERiKGRiKSB7XG4gICAgaWYgKHRoaXMuX2lzUmVhZHkpIHJldHVyblxuXG4gICAgY29uc3QgdHJhbnNhY3Rpb25Db21wbGV0aW9uID0gZGIuaW5zaWRlVHJhbnNhY3Rpb24oKSA/IGRiLnRyYW5zYWN0aW9uQ29tcGxldGlvbigpIDogbnVsbFxuICAgIGNvbnN0IHRyYW5zYWN0aW9uUmVhZHkgPSB0aGlzLl90cmFuc2FjdGlvblJlYWR5UHJvbWlzZXMuZ2V0KGRiKVxuXG4gICAgaWYgKHRyYW5zYWN0aW9uQ29tcGxldGlvbiAmJiB0cmFuc2FjdGlvblJlYWR5Py5jb21wbGV0aW9uID09PSB0cmFuc2FjdGlvbkNvbXBsZXRpb24pIHtcbiAgICAgIGF3YWl0IHRyYW5zYWN0aW9uUmVhZHkucHJvbWlzZVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKHRoaXMuX3JlYWR5UHJvbWlzZSkge1xuICAgICAgY29uc3QgcmVhZHlQcm9taXNlID0gdGhpcy5fcmVhZHlQcm9taXNlXG5cbiAgICAgIGF3YWl0IHJlYWR5UHJvbWlzZVxuICAgICAgaWYgKHRoaXMuX3JlYWR5UHJvbWlzZSA9PT0gcmVhZHlQcm9taXNlKSB0aGlzLl9yZWFkeVByb21pc2UgPSBudWxsXG4gICAgICBpZiAodGhpcy5faXNSZWFkeSkgcmV0dXJuXG5cbiAgICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKHRyYW5zYWN0aW9uQ29tcGxldGlvbikge1xuICAgICAgY29uc3QgdGFibGVSZWFkeVByb21pc2UgPSB0aGlzLl9lbnN1cmVDaGFuZ2VzVGFibGUoZGIpXG4gICAgICBjb25zdCB0cmFuc2FjdGlvblJlYWR5UHJvbWlzZSA9IHRhYmxlUmVhZHlQcm9taXNlLnRoZW4oKCkgPT4gdW5kZWZpbmVkKVxuXG4gICAgICBjb25zdCBkdXJhYmxlUmVhZHlQcm9taXNlID0gdGFibGVSZWFkeVByb21pc2UudGhlbihhc3luYyAoY3JlYXRlZCkgPT4ge1xuICAgICAgICBpZiAoIWNyZWF0ZWQpIHtcbiAgICAgICAgICB0aGlzLl9pc1JlYWR5ID0gdHJ1ZVxuICAgICAgICAgIHJldHVyblxuICAgICAgICB9XG5cbiAgICAgICAgYXdhaXQgdHJhbnNhY3Rpb25Db21wbGV0aW9uXG4gICAgICB9KVxuXG4gICAgICB0aGlzLl90cmFuc2FjdGlvblJlYWR5UHJvbWlzZXMuc2V0KGRiLCB7Y29tcGxldGlvbjogdHJhbnNhY3Rpb25Db21wbGV0aW9uLCBwcm9taXNlOiB0cmFuc2FjdGlvblJlYWR5UHJvbWlzZX0pXG4gICAgICB0aGlzLl9yZWFkeVByb21pc2UgPSBkdXJhYmxlUmVhZHlQcm9taXNlXG4gICAgICBhd2FpdCB0cmFuc2FjdGlvblJlYWR5UHJvbWlzZVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdGhpcy5fcmVhZHlQcm9taXNlID0gdGhpcy5fZW5zdXJlQ2hhbmdlc1RhYmxlKGRiKS50aGVuKCgpID0+IHtcbiAgICAgIHRoaXMuX2lzUmVhZHkgPSB0cnVlXG4gICAgfSlcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLl9yZWFkeVByb21pc2VcbiAgICB9IGZpbmFsbHkge1xuICAgICAgaWYgKCF0aGlzLl9pc1JlYWR5KSB0aGlzLl9yZWFkeVByb21pc2UgPSBudWxsXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEFwcGVuZHMgYSBjaGFuZ2UgYW5kIGFzc2lnbnMgdGhlIG5leHQgc2VydmVyIHNlcXVlbmNlLlxuICAgKiBAcGFyYW0ge09taXQ8U2VydmVyQ2hhbmdlRmVlZEVudHJ5LCBcImNyZWF0ZWRBdFwiIHwgXCJpZFwiIHwgXCJzZXJ2ZXJTZXF1ZW5jZVwiPiAmIHtjcmVhdGVkQXQ/OiBzdHJpbmcsIGlkPzogc3RyaW5nfX0gY2hhbmdlIC0gQ2hhbmdlIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFNlcnZlckNoYW5nZUZlZWRFbnRyeT59IC0gUGVyc2lzdGVkIGNoYW5nZS5cbiAgICovXG4gIGFzeW5jIGFwcGVuZChjaGFuZ2UpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGNvbnN0IGlkID0gY2hhbmdlLmlkIHx8IHJhbmRvbVVVSUQoKVxuICAgIGNvbnN0IGNyZWF0ZWRBdCA9IGNoYW5nZS5jcmVhdGVkQXQgfHwgbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG5cbiAgICBpZiAodGhpcy5fdXNlc01lbW9yeVN0b3JhZ2UoKSkgcmV0dXJuIHRoaXMuX2FwcGVuZE1lbW9yeSh7Li4uY2hhbmdlLCBjcmVhdGVkQXQsIGlkfSlcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiB7XG4gICAgICBhd2FpdCBkYi5pbnNlcnQoe1xuICAgICAgICB0YWJsZU5hbWU6IFRBQkxFX05BTUUsXG4gICAgICAgIGRhdGE6IHtcbiAgICAgICAgICBhY3Rvcl9kZXZpY2VfaWQ6IGNoYW5nZS5hY3RvckRldmljZUlkLFxuICAgICAgICAgIGFjdG9yX3VzZXJfaWQ6IGNoYW5nZS5hY3RvclVzZXJJZCxcbiAgICAgICAgICBhdHRyaWJ1dGVzX2pzb246IEpTT04uc3RyaW5naWZ5KGNoYW5nZS5hdHRyaWJ1dGVzIHx8IG51bGwpLFxuICAgICAgICAgIGNyZWF0ZWRfYXQ6IG5ldyBEYXRlKGNyZWF0ZWRBdCksXG4gICAgICAgICAgaWQsXG4gICAgICAgICAgaWRlbXBvdGVuY3lfa2V5OiBjaGFuZ2UuaWRlbXBvdGVuY3lLZXksXG4gICAgICAgICAgbW9kZWw6IGNoYW5nZS5tb2RlbCxcbiAgICAgICAgICBvcGVyYXRpb246IGNoYW5nZS5vcGVyYXRpb24sXG4gICAgICAgICAgcGF5bG9hZF9qc29uOiBKU09OLnN0cmluZ2lmeShjaGFuZ2UucGF5bG9hZCB8fCBudWxsKSxcbiAgICAgICAgICByZWNvcmRfaWQ6IGNoYW5nZS5yZWNvcmRJZCA9PT0gbnVsbCB8fCBjaGFuZ2UucmVjb3JkSWQgPT09IHVuZGVmaW5lZCA/IG51bGwgOiBTdHJpbmcoY2hhbmdlLnJlY29yZElkKSxcbiAgICAgICAgICByZXNwb25zZV9qc29uOiBKU09OLnN0cmluZ2lmeShjaGFuZ2UucmVzcG9uc2UgfHwgbnVsbCksXG4gICAgICAgICAgc2NvcGVfanNvbjogc3RhYmxlSnNvblN0cmluZ2lmeShjaGFuZ2Uuc2NvcGUgfHwgbnVsbClcbiAgICAgICAgfVxuICAgICAgfSlcblxuICAgICAgY29uc3Qgcm93ID0gYXdhaXQgdGhpcy5fY2hhbmdlQnlJZChkYiwgaWQpXG4gICAgICBpZiAoIXJvdykgdGhyb3cgbmV3IEVycm9yKFwiRmFpbGVkIHRvIHBlcnNpc3Qgc2VydmVyIGNoYW5nZS1mZWVkIGVudHJ5XCIpXG5cbiAgICAgIGF3YWl0IHRoaXMuX3BydW5lUmV0YWluZWRDaGFuZ2VzKGRiLCByb3cuc2VydmVyU2VxdWVuY2UpXG5cbiAgICAgIHJldHVybiByb3dcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgY3VycmVudCBsYXRlc3Qgc2VydmVyIHNlcXVlbmNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIExhdGVzdCBzZXF1ZW5jZS5cbiAgICovXG4gIGFzeW5jIGxhdGVzdFNlcXVlbmNlKCkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgaWYgKHRoaXMuX3VzZXNNZW1vcnlTdG9yYWdlKCkpIHJldHVybiB0aGlzLl9tZW1vcnlTZXF1ZW5jZVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYlxuICAgICAgICAubmV3UXVlcnkoKVxuICAgICAgICAuZnJvbShUQUJMRV9OQU1FKVxuICAgICAgICAub3JkZXIoXCJzZXJ2ZXJfc2VxdWVuY2UgREVTQ1wiKVxuICAgICAgICAubGltaXQoMSlcbiAgICAgICAgLnJlc3VsdHMoKVxuICAgICAgY29uc3Qgcm93ID0gLyoqIEB0eXBlIHt7c2VydmVyX3NlcXVlbmNlPzogbnVtYmVyIHwgc3RyaW5nfSB8IHVuZGVmaW5lZH0gKi8gKHJvd3NbMF0pXG5cbiAgICAgIHJldHVybiByb3cgPyBOdW1iZXIocm93LnNlcnZlcl9zZXF1ZW5jZSkgOiAwXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIG9sZGVzdCByZXRhaW5lZCBzZXJ2ZXIgc2VxdWVuY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlciB8IG51bGw+fSAtIE9sZGVzdCByZXRhaW5lZCBzZXF1ZW5jZS5cbiAgICovXG4gIGFzeW5jIG9sZGVzdFNlcXVlbmNlKCkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgaWYgKHRoaXMuX3VzZXNNZW1vcnlTdG9yYWdlKCkpIHJldHVybiB0aGlzLl9tZW1vcnlDaGFuZ2VzWzBdPy5zZXJ2ZXJTZXF1ZW5jZSB8fCBudWxsXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4gYXdhaXQgdGhpcy5fb2xkZXN0U2VxdWVuY2UoZGIpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgb3JkZXJlZCBjaGFuZ2VzIGFmdGVyIGEgY3Vyc29yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MuYWZ0ZXJTZXF1ZW5jZSAtIEV4Y2x1c2l2ZSBsb3dlciBib3VuZC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmxpbWl0XSAtIE1heGltdW0gbnVtYmVyIG9mIGNoYW5nZXMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy51cFRvU2VxdWVuY2VdIC0gSW5jbHVzaXZlIHVwcGVyIGJvdW5kLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gW2FyZ3Muc2NvcGVdIC0gQ2FsbGVyIHN5bmMgc2NvcGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHtjaGFuZ2VzOiBTZXJ2ZXJDaGFuZ2VGZWVkRW50cnlbXSwgaGFzTW9yZTogYm9vbGVhbiwgbmV4dFNlcXVlbmNlOiBudW1iZXIsIG9sZGVzdFNlcXVlbmNlOiBudW1iZXIgfCBudWxsLCBzbmFwc2hvdFJlcXVpcmVkOiBib29sZWFuLCB1cFRvU2VxdWVuY2U6IG51bWJlcn0+fSAtIE9yZGVyZWQgcGFnZS5cbiAgICovXG4gIGFzeW5jIGNoYW5nZXNBZnRlcih7YWZ0ZXJTZXF1ZW5jZSwgbGltaXQgPSBERUZBVUxUX1BBR0VfU0laRSwgc2NvcGUsIHVwVG9TZXF1ZW5jZX0pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGNvbnN0IHBhZ2VTaXplID0gbm9ybWFsaXplTGltaXQobGltaXQpXG5cbiAgICBpZiAodGhpcy5fdXNlc01lbW9yeVN0b3JhZ2UoKSkgcmV0dXJuIHRoaXMuX21lbW9yeUNoYW5nZXNBZnRlcih7YWZ0ZXJTZXF1ZW5jZSwgbGltaXQ6IHBhZ2VTaXplLCBzY29wZSwgdXBUb1NlcXVlbmNlfSlcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBsYXRlc3RTZXF1ZW5jZSA9IHR5cGVvZiB1cFRvU2VxdWVuY2UgPT09IFwibnVtYmVyXCIgPyB1cFRvU2VxdWVuY2UgOiBhd2FpdCB0aGlzLl9sYXRlc3RTZXF1ZW5jZShkYilcbiAgICAgIGNvbnN0IG9sZGVzdFNlcXVlbmNlID0gYXdhaXQgdGhpcy5fb2xkZXN0U2VxdWVuY2UoZGIpXG4gICAgICBjb25zdCBzbmFwc2hvdFJlcXVpcmVkID0gYWZ0ZXJTZXF1ZW5jZSA+IDAgJiYgb2xkZXN0U2VxdWVuY2UgIT09IG51bGwgJiYgb2xkZXN0U2VxdWVuY2UgPiBhZnRlclNlcXVlbmNlICsgMVxuXG4gICAgICBpZiAoc25hcHNob3RSZXF1aXJlZCkge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGNoYW5nZXM6IFtdLFxuICAgICAgICAgIGhhc01vcmU6IGZhbHNlLFxuICAgICAgICAgIG5leHRTZXF1ZW5jZTogYWZ0ZXJTZXF1ZW5jZSxcbiAgICAgICAgICBvbGRlc3RTZXF1ZW5jZSxcbiAgICAgICAgICBzbmFwc2hvdFJlcXVpcmVkOiB0cnVlLFxuICAgICAgICAgIHVwVG9TZXF1ZW5jZTogbGF0ZXN0U2VxdWVuY2VcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBjb25zdCByb3dzID0gLyoqIEB0eXBlIHtTZXJ2ZXJDaGFuZ2VGZWVkUm93W119ICovIChhd2FpdCBkYlxuICAgICAgICAubmV3UXVlcnkoKVxuICAgICAgICAuZnJvbShUQUJMRV9OQU1FKVxuICAgICAgICAud2hlcmUoYHNlcnZlcl9zZXF1ZW5jZSA+ICR7ZGIucXVvdGUoYWZ0ZXJTZXF1ZW5jZSl9YClcbiAgICAgICAgLndoZXJlKGBzZXJ2ZXJfc2VxdWVuY2UgPD0gJHtkYi5xdW90ZShsYXRlc3RTZXF1ZW5jZSl9YClcbiAgICAgICAgLndoZXJlKHNjb3BlID09PSB1bmRlZmluZWQgPyBcIjEgPSAxXCIgOiB7c2NvcGVfanNvbjogc3RhYmxlSnNvblN0cmluZ2lmeShzY29wZSl9KVxuICAgICAgICAub3JkZXIoXCJzZXJ2ZXJfc2VxdWVuY2UgQVNDXCIpXG4gICAgICAgIC5saW1pdChwYWdlU2l6ZSArIDEpXG4gICAgICAgIC5yZXN1bHRzKCkpXG4gICAgICBjb25zdCBoYXNNb3JlID0gcm93cy5sZW5ndGggPiBwYWdlU2l6ZVxuICAgICAgY29uc3QgcGFnZVJvd3MgPSByb3dzLnNsaWNlKDAsIHBhZ2VTaXplKVxuICAgICAgY29uc3QgY2hhbmdlcyA9IHBhZ2VSb3dzLm1hcCgocm93KSA9PiB0aGlzLl9ub3JtYWxpemVDaGFuZ2VSb3cocm93KSlcbiAgICAgIGNvbnN0IGxhc3RDaGFuZ2UgPSBjaGFuZ2VzW2NoYW5nZXMubGVuZ3RoIC0gMV1cblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgY2hhbmdlcyxcbiAgICAgICAgaGFzTW9yZSxcbiAgICAgICAgbmV4dFNlcXVlbmNlOiBsYXN0Q2hhbmdlID8gbGFzdENoYW5nZS5zZXJ2ZXJTZXF1ZW5jZSA6IGFmdGVyU2VxdWVuY2UsXG4gICAgICAgIG9sZGVzdFNlcXVlbmNlLFxuICAgICAgICBzbmFwc2hvdFJlcXVpcmVkOiBmYWxzZSxcbiAgICAgICAgdXBUb1NlcXVlbmNlOiBsYXRlc3RTZXF1ZW5jZVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyBzY2hlbWEgaXMgc3RpbGwgcHJlc2VudC5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciByZWFkeS5cbiAgICovXG4gIGFzeW5jIF9zY2hlbWFSZWFkeSgpIHtcbiAgICBpZiAodGhpcy5fdXNlc01lbW9yeVN0b3JhZ2UoKSkgcmV0dXJuIHRoaXMuX2lzUmVhZHlcbiAgICBpZiAoIXRoaXMuX2lzUmVhZHkpIHJldHVybiBmYWxzZVxuICAgIGlmIChhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiBhd2FpdCBkYi50YWJsZUV4aXN0cyhUQUJMRV9OQU1FKSkpIHJldHVybiB0cnVlXG5cbiAgICB0aGlzLl9pc1JlYWR5ID0gZmFsc2VcbiAgICB0aGlzLl9yZWFkeVByb21pc2UgPSBudWxsXG5cbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBFbnN1cmVzIGNoYW5nZXMgdGFibGUgZXhpc3RzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgdGhlIHRhYmxlIGhhZCB0byBiZSBjcmVhdGVkLlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZUNoYW5nZXNUYWJsZShkYikge1xuICAgIGlmIChhd2FpdCBkYi50YWJsZUV4aXN0cyhUQUJMRV9OQU1FKSkgcmV0dXJuIGZhbHNlXG5cbiAgICBjb25zdCB0YWJsZSA9IG5ldyBUYWJsZURhdGEoVEFCTEVfTkFNRSwge2lmTm90RXhpc3RzOiB0cnVlfSlcblxuICAgIHRhYmxlLmludGVnZXIoXCJzZXJ2ZXJfc2VxdWVuY2VcIiwge2F1dG9JbmNyZW1lbnQ6IHRydWUsIG51bGw6IGZhbHNlLCBwcmltYXJ5S2V5OiB0cnVlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJpZFwiLCB7aW5kZXg6IHRydWUsIG51bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJtb2RlbFwiLCB7aW5kZXg6IHRydWUsIG51bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJvcGVyYXRpb25cIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJyZWNvcmRfaWRcIiwge2luZGV4OiB0cnVlLCBudWxsOiB0cnVlfSlcbiAgICB0YWJsZS50ZXh0KFwicGF5bG9hZF9qc29uXCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS50ZXh0KFwiYXR0cmlidXRlc19qc29uXCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJpZGVtcG90ZW5jeV9rZXlcIiwge2luZGV4OiB0cnVlLCBudWxsOiB0cnVlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJhY3Rvcl91c2VyX2lkXCIsIHtpbmRleDogdHJ1ZSwgbnVsbDogdHJ1ZX0pXG4gICAgdGFibGUuc3RyaW5nKFwiYWN0b3JfZGV2aWNlX2lkXCIsIHtpbmRleDogdHJ1ZSwgbnVsbDogdHJ1ZX0pXG4gICAgdGFibGUudGV4dChcInNjb3BlX2pzb25cIiwge251bGw6IHRydWV9KVxuICAgIHRhYmxlLnRleHQoXCJyZXNwb25zZV9qc29uXCIsIHtudWxsOiB0cnVlfSlcbiAgICB0YWJsZS5kYXRldGltZShcImNyZWF0ZWRfYXRcIiwge2luZGV4OiB0cnVlLCBudWxsOiBmYWxzZX0pXG5cbiAgICBhd2FpdCBkYi5jcmVhdGVUYWJsZSh0YWJsZSlcblxuICAgIHJldHVybiB0cnVlXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYSBwZXJzaXN0ZWQgY2hhbmdlIGJ5IGlkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBpZCAtIEVudHJ5IGlkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxTZXJ2ZXJDaGFuZ2VGZWVkRW50cnkgfCBudWxsPn0gLSBFbnRyeSBvciBudWxsLlxuICAgKi9cbiAgYXN5bmMgX2NoYW5nZUJ5SWQoZGIsIGlkKSB7XG4gICAgY29uc3Qgcm93cyA9IC8qKiBAdHlwZSB7U2VydmVyQ2hhbmdlRmVlZFJvd1tdfSAqLyAoYXdhaXQgZGJcbiAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAuZnJvbShUQUJMRV9OQU1FKVxuICAgICAgLndoZXJlKHtpZH0pXG4gICAgICAubGltaXQoMSlcbiAgICAgIC5yZXN1bHRzKCkpXG5cbiAgICByZXR1cm4gcm93c1swXSA/IHRoaXMuX25vcm1hbGl6ZUNoYW5nZVJvdyhyb3dzWzBdKSA6IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBjdXJyZW50IGxhdGVzdCBzZXF1ZW5jZSB3aXRob3V0IHJlYWRpbmVzcyBjaGVja3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBMYXRlc3Qgc2VxdWVuY2UuXG4gICAqL1xuICBhc3luYyBfbGF0ZXN0U2VxdWVuY2UoZGIpIHtcbiAgICBjb25zdCByb3dzID0gLyoqIEB0eXBlIHtBcnJheTx7c2VydmVyX3NlcXVlbmNlPzogbnVtYmVyIHwgc3RyaW5nfT59ICovIChhd2FpdCBkYlxuICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgIC5mcm9tKFRBQkxFX05BTUUpXG4gICAgICAub3JkZXIoXCJzZXJ2ZXJfc2VxdWVuY2UgREVTQ1wiKVxuICAgICAgLmxpbWl0KDEpXG4gICAgICAucmVzdWx0cygpKVxuXG4gICAgcmV0dXJuIHJvd3NbMF0gPyBOdW1iZXIocm93c1swXS5zZXJ2ZXJfc2VxdWVuY2UpIDogMFxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGN1cnJlbnQgb2xkZXN0IHNlcXVlbmNlIHdpdGhvdXQgcmVhZGluZXNzIGNoZWNrcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXIgfCBudWxsPn0gLSBPbGRlc3Qgc2VxdWVuY2UuXG4gICAqL1xuICBhc3luYyBfb2xkZXN0U2VxdWVuY2UoZGIpIHtcbiAgICBjb25zdCByb3dzID0gLyoqIEB0eXBlIHtBcnJheTx7c2VydmVyX3NlcXVlbmNlPzogbnVtYmVyIHwgc3RyaW5nfT59ICovIChhd2FpdCBkYlxuICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgIC5mcm9tKFRBQkxFX05BTUUpXG4gICAgICAub3JkZXIoXCJzZXJ2ZXJfc2VxdWVuY2UgQVNDXCIpXG4gICAgICAubGltaXQoMSlcbiAgICAgIC5yZXN1bHRzKCkpXG5cbiAgICByZXR1cm4gcm93c1swXSA/IE51bWJlcihyb3dzWzBdLnNlcnZlcl9zZXF1ZW5jZSkgOiBudWxsXG4gIH1cblxuICAvKipcbiAgICogUHJ1bmVzIG9sZCByZXRhaW5lZCBjaGFuZ2VzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBsYXRlc3RTZXF1ZW5jZSAtIExhdGVzdCBzZXF1ZW5jZSBhZnRlciBhcHBlbmQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfcHJ1bmVSZXRhaW5lZENoYW5nZXMoZGIsIGxhdGVzdFNlcXVlbmNlKSB7XG4gICAgaWYgKCFOdW1iZXIuaXNJbnRlZ2VyKHRoaXMucmV0ZW50aW9uU2l6ZSkgfHwgdGhpcy5yZXRlbnRpb25TaXplIDwgMSkgcmV0dXJuXG5cbiAgICBjb25zdCBwcnVuZUJlZm9yZU9yQXQgPSBsYXRlc3RTZXF1ZW5jZSAtIHRoaXMucmV0ZW50aW9uU2l6ZVxuICAgIGlmIChwcnVuZUJlZm9yZU9yQXQgPCAxKSByZXR1cm5cblxuICAgIGNvbnN0IHJvd3MgPSAvKiogQHR5cGUge0FycmF5PHtpZDogc3RyaW5nfT59ICovIChhd2FpdCBkYlxuICAgICAgLm5ld1F1ZXJ5KClcbiAgICAgIC5mcm9tKFRBQkxFX05BTUUpXG4gICAgICAud2hlcmUoYHNlcnZlcl9zZXF1ZW5jZSA8PSAke2RiLnF1b3RlKHBydW5lQmVmb3JlT3JBdCl9YClcbiAgICAgIC5yZXN1bHRzKCkpXG5cbiAgICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XG4gICAgICBhd2FpdCBkYi5kZWxldGUoe2NvbmRpdGlvbnM6IHtpZDogcm93LmlkfSwgdGFibGVOYW1lOiBUQUJMRV9OQU1FfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplcyBhIGNoYW5nZSByb3cuXG4gICAqIEBwYXJhbSB7U2VydmVyQ2hhbmdlRmVlZFJvd30gcm93IC0gUmF3IGRhdGFiYXNlIHJvdy5cbiAgICogQHJldHVybnMge1NlcnZlckNoYW5nZUZlZWRFbnRyeX0gLSBOb3JtYWxpemVkIGNoYW5nZS5cbiAgICovXG4gIF9ub3JtYWxpemVDaGFuZ2VSb3cocm93KSB7XG4gICAgY29uc3QgY3JlYXRlZEF0VmFsdWUgPSByb3cuY3JlYXRlZF9hdFxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGFjdG9yRGV2aWNlSWQ6IHJvdy5hY3Rvcl9kZXZpY2VfaWQgfHwgbnVsbCxcbiAgICAgIGFjdG9yVXNlcklkOiByb3cuYWN0b3JfdXNlcl9pZCB8fCBudWxsLFxuICAgICAgYXR0cmlidXRlczogcGFyc2VKc29uT3JOdWxsKHJvdy5hdHRyaWJ1dGVzX2pzb24pLFxuICAgICAgY3JlYXRlZEF0OiBjcmVhdGVkQXRWYWx1ZSBpbnN0YW5jZW9mIERhdGUgPyBjcmVhdGVkQXRWYWx1ZS50b0lTT1N0cmluZygpIDogbmV3IERhdGUoY3JlYXRlZEF0VmFsdWUpLnRvSVNPU3RyaW5nKCksXG4gICAgICBpZDogcm93LmlkLFxuICAgICAgaWRlbXBvdGVuY3lLZXk6IHJvdy5pZGVtcG90ZW5jeV9rZXkgfHwgbnVsbCxcbiAgICAgIG1vZGVsOiByb3cubW9kZWwsXG4gICAgICBvcGVyYXRpb246IHJvdy5vcGVyYXRpb24sXG4gICAgICBwYXlsb2FkOiBwYXJzZUpzb25Pck51bGwocm93LnBheWxvYWRfanNvbiksXG4gICAgICByZWNvcmRJZDogcm93LnJlY29yZF9pZCB8fCBudWxsLFxuICAgICAgcmVzcG9uc2U6IHBhcnNlSnNvbk9yTnVsbChyb3cucmVzcG9uc2VfanNvbiksXG4gICAgICBzY29wZTogcGFyc2VKc29uT3JOdWxsKHJvdy5zY29wZV9qc29uKSxcbiAgICAgIHNlcnZlclNlcXVlbmNlOiBOdW1iZXIocm93LnNlcnZlcl9zZXF1ZW5jZSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogV2hldGhlciB0aGlzIHN0b3JlIHNob3VsZCB1c2UgcHJvY2Vzcy1sb2NhbCBtZW1vcnkgYmVjYXVzZSBubyBkYXRhYmFzZSBpZGVudGlmaWVyIGlzIGNvbmZpZ3VyZWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgbWVtb3J5IHN0b3JhZ2UgaXMgYWN0aXZlLlxuICAgKi9cbiAgX3VzZXNNZW1vcnlTdG9yYWdlKCkge1xuICAgIHRyeSB7XG4gICAgICByZXR1cm4gIXRoaXMuY29uZmlndXJhdGlvbi5nZXREYXRhYmFzZUNvbmZpZ3VyYXRpb24oKVt0aGlzLmRhdGFiYXNlSWRlbnRpZmllcl1cbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiB0cnVlXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEFwcGVuZHMgYSBwcm9jZXNzLWxvY2FsIG1lbW9yeSBlbnRyeSB3aGVuIG5vIGRhdGFiYXNlIGlzIGNvbmZpZ3VyZWQuXG4gICAqIEBwYXJhbSB7T21pdDxTZXJ2ZXJDaGFuZ2VGZWVkRW50cnksIFwic2VydmVyU2VxdWVuY2VcIj59IGNoYW5nZSAtIENoYW5nZSBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7U2VydmVyQ2hhbmdlRmVlZEVudHJ5fSAtIEFwcGVuZGVkIGVudHJ5LlxuICAgKi9cbiAgX2FwcGVuZE1lbW9yeShjaGFuZ2UpIHtcbiAgICBjb25zdCBlbnRyeSA9IC8qKiBAdHlwZSB7U2VydmVyQ2hhbmdlRmVlZEVudHJ5fSAqLyAoe1xuICAgICAgYWN0b3JEZXZpY2VJZDogY2hhbmdlLmFjdG9yRGV2aWNlSWQsXG4gICAgICBhY3RvclVzZXJJZDogY2hhbmdlLmFjdG9yVXNlcklkLFxuICAgICAgYXR0cmlidXRlczogY2hhbmdlLmF0dHJpYnV0ZXMgfHwgbnVsbCxcbiAgICAgIGNyZWF0ZWRBdDogY2hhbmdlLmNyZWF0ZWRBdCxcbiAgICAgIGlkOiBjaGFuZ2UuaWQsXG4gICAgICBpZGVtcG90ZW5jeUtleTogY2hhbmdlLmlkZW1wb3RlbmN5S2V5LFxuICAgICAgbW9kZWw6IGNoYW5nZS5tb2RlbCxcbiAgICAgIG9wZXJhdGlvbjogY2hhbmdlLm9wZXJhdGlvbixcbiAgICAgIHBheWxvYWQ6IGNoYW5nZS5wYXlsb2FkIHx8IG51bGwsXG4gICAgICByZWNvcmRJZDogY2hhbmdlLnJlY29yZElkID09PSBudWxsIHx8IGNoYW5nZS5yZWNvcmRJZCA9PT0gdW5kZWZpbmVkID8gbnVsbCA6IFN0cmluZyhjaGFuZ2UucmVjb3JkSWQpLFxuICAgICAgcmVzcG9uc2U6IGNoYW5nZS5yZXNwb25zZSB8fCBudWxsLFxuICAgICAgc2NvcGU6IGNoYW5nZS5zY29wZSB8fCBudWxsLFxuICAgICAgc2VydmVyU2VxdWVuY2U6ICsrdGhpcy5fbWVtb3J5U2VxdWVuY2VcbiAgICB9KVxuXG4gICAgdGhpcy5fbWVtb3J5Q2hhbmdlcy5wdXNoKGVudHJ5KVxuICAgIGlmICh0aGlzLl9tZW1vcnlDaGFuZ2VzLmxlbmd0aCA+IHRoaXMucmV0ZW50aW9uU2l6ZSkgdGhpcy5fbWVtb3J5Q2hhbmdlcy5zcGxpY2UoMCwgdGhpcy5fbWVtb3J5Q2hhbmdlcy5sZW5ndGggLSB0aGlzLnJldGVudGlvblNpemUpXG5cbiAgICByZXR1cm4gZW50cnlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGEgcHJvY2Vzcy1sb2NhbCBtZW1vcnkgY2hhbmdlIHBhZ2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5hZnRlclNlcXVlbmNlIC0gRXhjbHVzaXZlIGxvd2VyIGJvdW5kLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5saW1pdCAtIFBhZ2Ugc2l6ZS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLnVwVG9TZXF1ZW5jZV0gLSBJbmNsdXNpdmUgdXBwZXIgYm91bmQuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBbYXJncy5zY29wZV0gLSBDYWxsZXIgc3luYyBzY29wZS5cbiAgICogQHJldHVybnMge3tjaGFuZ2VzOiBTZXJ2ZXJDaGFuZ2VGZWVkRW50cnlbXSwgaGFzTW9yZTogYm9vbGVhbiwgbmV4dFNlcXVlbmNlOiBudW1iZXIsIG9sZGVzdFNlcXVlbmNlOiBudW1iZXIgfCBudWxsLCBzbmFwc2hvdFJlcXVpcmVkOiBib29sZWFuLCB1cFRvU2VxdWVuY2U6IG51bWJlcn19IC0gT3JkZXJlZCBwYWdlLlxuICAgKi9cbiAgX21lbW9yeUNoYW5nZXNBZnRlcih7YWZ0ZXJTZXF1ZW5jZSwgbGltaXQsIHNjb3BlLCB1cFRvU2VxdWVuY2V9KSB7XG4gICAgY29uc3QgbGF0ZXN0U2VxdWVuY2UgPSB0eXBlb2YgdXBUb1NlcXVlbmNlID09PSBcIm51bWJlclwiID8gdXBUb1NlcXVlbmNlIDogdGhpcy5fbWVtb3J5U2VxdWVuY2VcbiAgICBjb25zdCBvbGRlc3RTZXF1ZW5jZSA9IHRoaXMuX21lbW9yeUNoYW5nZXNbMF0/LnNlcnZlclNlcXVlbmNlIHx8IG51bGxcbiAgICBjb25zdCBzbmFwc2hvdFJlcXVpcmVkID0gYWZ0ZXJTZXF1ZW5jZSA+IDAgJiYgb2xkZXN0U2VxdWVuY2UgIT09IG51bGwgJiYgb2xkZXN0U2VxdWVuY2UgPiBhZnRlclNlcXVlbmNlICsgMVxuXG4gICAgaWYgKHNuYXBzaG90UmVxdWlyZWQpIHtcbiAgICAgIHJldHVybiB7Y2hhbmdlczogW10sIGhhc01vcmU6IGZhbHNlLCBuZXh0U2VxdWVuY2U6IGFmdGVyU2VxdWVuY2UsIG9sZGVzdFNlcXVlbmNlLCBzbmFwc2hvdFJlcXVpcmVkOiB0cnVlLCB1cFRvU2VxdWVuY2U6IGxhdGVzdFNlcXVlbmNlfVxuICAgIH1cblxuICAgIGNvbnN0IHJvd3MgPSB0aGlzLl9tZW1vcnlDaGFuZ2VzLmZpbHRlcigoY2hhbmdlKSA9PiB7XG4gICAgICByZXR1cm4gY2hhbmdlLnNlcnZlclNlcXVlbmNlID4gYWZ0ZXJTZXF1ZW5jZSAmJiBjaGFuZ2Uuc2VydmVyU2VxdWVuY2UgPD0gbGF0ZXN0U2VxdWVuY2UgJiYgc2NvcGVzRXF1YWwoY2hhbmdlLnNjb3BlLCBzY29wZSlcbiAgICB9KVxuICAgIGNvbnN0IGhhc01vcmUgPSByb3dzLmxlbmd0aCA+IGxpbWl0XG4gICAgY29uc3QgY2hhbmdlcyA9IHJvd3Muc2xpY2UoMCwgbGltaXQpXG4gICAgY29uc3QgbGFzdENoYW5nZSA9IGNoYW5nZXNbY2hhbmdlcy5sZW5ndGggLSAxXVxuXG4gICAgcmV0dXJuIHtjaGFuZ2VzLCBoYXNNb3JlLCBuZXh0U2VxdWVuY2U6IGxhc3RDaGFuZ2UgPyBsYXN0Q2hhbmdlLnNlcnZlclNlcXVlbmNlIDogYWZ0ZXJTZXF1ZW5jZSwgb2xkZXN0U2VxdWVuY2UsIHNuYXBzaG90UmVxdWlyZWQ6IGZhbHNlLCB1cFRvU2VxdWVuY2U6IGxhdGVzdFNlcXVlbmNlfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd2l0aCBkYi5cbiAgICogQHBhcmFtIHsoZGI6IGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0KSA9PiBQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY2FsbGJhY2sgLSBDYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIF93aXRoRGIoY2FsbGJhY2spIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLmVuc3VyZUNvbm5lY3Rpb25zKHtkYXRhYmFzZUlkZW50aWZpZXJzOiBbdGhpcy5kYXRhYmFzZUlkZW50aWZpZXJdLCBuYW1lOiBcIlNlcnZlciBjaGFuZ2UtZmVlZCBzdG9yZVwifSwgYXN5bmMgKGRicykgPT4ge1xuICAgICAgY29uc3QgZGIgPSBkYnNbdGhpcy5kYXRhYmFzZUlkZW50aWZpZXJdXG5cbiAgICAgIGlmICghZGIpIHRocm93IG5ldyBFcnJvcihgTm8gZGF0YWJhc2UgY29ubmVjdGlvbiBhdmFpbGFibGUgZm9yIGlkZW50aWZpZXI6ICR7dGhpcy5kYXRhYmFzZUlkZW50aWZpZXJ9YClcblxuICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKGRiKVxuICAgIH0pXG4gIH1cbn1cblxuLyoqXG4gKiBOb3JtYWxpemVzIHBhZ2UgbGltaXQuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBsaW1pdCAtIFJlcXVlc3RlZCBsaW1pdC5cbiAqIEByZXR1cm5zIHtudW1iZXJ9IC0gUGFnZSBzaXplLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVMaW1pdChsaW1pdCkge1xuICBpZiAodHlwZW9mIGxpbWl0ID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0ludGVnZXIobGltaXQpICYmIGxpbWl0ID4gMCkgcmV0dXJuIE1hdGgubWluKGxpbWl0LCBNQVhfUEFHRV9TSVpFKVxuICBpZiAodHlwZW9mIGxpbWl0ID09PSBcInN0cmluZ1wiICYmIC9eXFxkKyQvLnRlc3QobGltaXQpKSByZXR1cm4gTWF0aC5taW4oTnVtYmVyKGxpbWl0KSwgTUFYX1BBR0VfU0laRSlcblxuICByZXR1cm4gREVGQVVMVF9QQUdFX1NJWkVcbn1cblxuLyoqXG4gKiBQYXJzZXMgSlNPTi1pc2ggdmFsdWVzLlxuICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBKU09OIHN0cmluZy5cbiAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBQYXJzZWQgdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIHBhcnNlSnNvbk9yTnVsbCh2YWx1ZSkge1xuICBpZiAodHlwZW9mIHZhbHVlICE9PSBcInN0cmluZ1wiIHx8IHZhbHVlLmxlbmd0aCA8IDEpIHJldHVybiBudWxsXG5cbiAgcmV0dXJuIEpTT04ucGFyc2UodmFsdWUpXG59XG5cbi8qKlxuICogQ29tcGFyZXMgc3luYyBzY29wZXMgYnkgc3RhYmxlIEpTT04gcmVwcmVzZW50YXRpb24uXG4gKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IG51bGx9IGNoYW5nZVNjb3BlIC0gUGVyc2lzdGVkIGNoYW5nZSBzY29wZS5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgdW5kZWZpbmVkfSByZXF1ZXN0ZWRTY29wZSAtIENhbGxlciBzY29wZS5cbiAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGNoYW5nZSBpcyB2aXNpYmxlIGZvciB0aGUgcmVxdWVzdGVkIHNjb3BlLlxuICovXG5mdW5jdGlvbiBzY29wZXNFcXVhbChjaGFuZ2VTY29wZSwgcmVxdWVzdGVkU2NvcGUpIHtcbiAgaWYgKHJlcXVlc3RlZFNjb3BlID09PSB1bmRlZmluZWQpIHJldHVybiB0cnVlXG5cbiAgcmV0dXJuIHN0YWJsZUpzb25TdHJpbmdpZnkoY2hhbmdlU2NvcGUgfHwgbnVsbCkgPT09IHN0YWJsZUpzb25TdHJpbmdpZnkocmVxdWVzdGVkU2NvcGUpXG59XG4iXX0=