// @ts-check
import Configuration from "../configuration.js";
import TableData from "../database/table-data/index.js";
/**
 * Allocation queues per database+table, serializing insert/last-insert-id
 * pairs across all allocator instances in this process.
 * @type {Map<string, Promise<void>>}
 */
const allocationQueues = new Map();
/**
 * Allocates monotonically increasing server sync sequences from an
 * AUTO_INCREMENT id table: every allocation inserts a row and returns the
 * driver's last-insert id, so sequences stay unique and increasing across
 * processes sharing the same database.
 *
 * Backed by an auto-created `velocious_server_sequences` table on the
 * configured database, with a process-local memory counter fallback when no
 * database is configured (mirroring the sync scope store). Apps with an
 * existing sequence table (for example a bare `id`-only AUTO_INCREMENT table)
 * point `tableName` at it and pass `insertData: {}` to insert empty rows.
 */
export default class ServerSequenceAllocator {
    /**
     * Creates a server sequence allocator.
     * @param {object} [args] - Options.
     * @param {import("../configuration.js").default} [args.configuration] - Configuration owning the database. Defaults to the current configuration, resolved lazily per allocation.
     * @param {string} [args.databaseIdentifier] - Database identifier.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} [args.insertData] - Row payload inserted per allocation. Defaults to `{created_at: new Date()}` matching the auto-created table; pass `{}` for bare id-only tables.
     * @param {string} [args.tableName] - Sequence table name.
     */
    constructor({ configuration, databaseIdentifier = "default", insertData, tableName = "velocious_server_sequences" } = {}) {
        this.configuration = configuration;
        this.databaseIdentifier = databaseIdentifier;
        this.insertData = insertData;
        this.tableName = tableName;
        this._memorySequence = 0;
        this._isReady = false;
        this._transactionalReadinessPending = false;
        /** @type {Promise<void> | null} */
        this._readyPromise = null;
    }
    /**
     * Allocates the next monotonically increasing sequence.
     *
     * Allocations serialize through a module-level queue per database+table so
     * parallel `next()` calls - including calls from other allocator instances
     * sharing the same table and connection - cannot interleave their insert
     * and last-insert-id reads and hand out duplicate sequences.
     * @param {{connection?: import("../database/drivers/base.js").default}} [options] - Explicit record-owned connection.
     * @returns {Promise<number>} Next sequence value.
     */
    async next({ connection } = {}) {
        const queueKey = `${this.databaseIdentifier}::${this.tableName}`;
        const previousAllocation = allocationQueues.get(queueKey) ?? Promise.resolve();
        const allocation = previousAllocation.then(() => this._allocateNext(connection));
        allocationQueues.set(queueKey, allocation.then(() => undefined, () => undefined));
        return await allocation;
    }
    /**
     * Allocates for a record while preserving allocator routing and operation ownership.
     * @param {import("../database/record/index.js").default} record - Record receiving the sequence.
     * @returns {Promise<number>} Next sequence value.
     */
    async _nextForRecord(record) {
        const operation = record.databaseOperation();
        if (!operation)
            return await this.next();
        const ModelClass = record.getModelClass();
        if (this._getConfiguration() !== ModelClass._getConfiguration()) {
            throw new Error("Server sequence allocator belongs to another Velocious configuration");
        }
        const modelDatabaseIdentifier = ModelClass.getDatabaseIdentifier();
        if (this.databaseIdentifier !== modelDatabaseIdentifier) {
            throw new Error(`Server sequence allocator uses database ${JSON.stringify(this.databaseIdentifier)}, not operation model database ${JSON.stringify(modelDatabaseIdentifier)}`);
        }
        const operationScope = operation.forModel(ModelClass);
        return await this.next({ connection: operationScope.driver });
    }
    /**
     * Ensures the backing table exists.
     * @param {import("../database/drivers/base.js").default} [connection] - Explicit record-owned connection.
     * @returns {Promise<void>} Resolves when ready.
     */
    async ensureReady(connection) {
        if (this._isReady)
            return;
        if (this._usesMemoryStorage()) {
            this._isReady = true;
            return;
        }
        if (this._readyPromise)
            return await this._readyPromise;
        this._readyPromise = this._withDb(async (db) => {
            const created = await this._ensureSequencesTable(db);
            // DDL joins any transaction already open on this connection (the mixin's
            // beforeCreate allocation always runs inside the record save transaction),
            // and on transactional-DDL databases (MSSQL, PostgreSQL, SQLite) a rollback
            // of that outer transaction removes the just-created table again. Keep
            // readiness pending for every later allocation in that same transaction;
            // otherwise its table-exists check would incorrectly cache readiness before
            // the outer transaction commits.
            if (created && db.insideTransaction()) {
                this._transactionalReadinessPending = true;
                void db.transactionCompletion().then(() => {
                    // The transaction may have committed or rolled back. Re-check once
                    // on the next allocation, then cache the durable outcome normally.
                    this._isReady = false;
                    this._transactionalReadinessPending = false;
                });
            }
            if (!db.insideTransaction() || (!created && !this._transactionalReadinessPending)) {
                this._isReady = true;
                this._transactionalReadinessPending = false;
            }
        }, connection);
        try {
            await this._readyPromise;
        }
        finally {
            if (!this._isReady)
                this._readyPromise = null;
        }
    }
    /**
     * Allocates one sequence value after queueing.
     * @param {import("../database/drivers/base.js").default} [connection] - Explicit record-owned connection.
     * @returns {Promise<number>} Allocated sequence value.
     */
    async _allocateNext(connection) {
        await this.ensureReady(connection);
        if (this._usesMemoryStorage()) {
            return ++this._memorySequence;
        }
        return await this._withDb(async (db) => {
            // The allocated id must be returned by the insert statement itself (OUTPUT
            // INSERTED/RETURNING), like the record create path does: MSSQL's
            // SCOPE_IDENTITY() only sees inserts from the same batch/scope, so reading
            // the last-insert id as a separate query always returns NULL there. Drivers
            // without insert-returning support (older SQLite) keep the reliable
            // connection-scoped last-insert-id fallback.
            const insertSql = db.insertSql({
                data: this._insertPayload(),
                returnLastInsertedColumnNames: ["id"],
                tableName: this.tableName
            });
            const insertResult = await db.query(insertSql);
            const insertedId = Array.isArray(insertResult) ? insertResult[0]?.id : undefined;
            if (insertedId !== undefined && insertedId !== null)
                return Number(insertedId);
            return Number(await db.lastInsertID());
        }, connection);
    }
    /**
     * Builds the row payload inserted per allocation.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} Insert payload.
     */
    _insertPayload() {
        return this.insertData ?? { created_at: new Date() };
    }
    /**
     * Resolves the configuration owning the sequence table.
     * @returns {import("../configuration.js").default} Resolved configuration.
     */
    _getConfiguration() {
        return this.configuration ?? Configuration.current();
    }
    /**
     * Whether the allocator runs without a configured database.
     * @returns {boolean} Whether memory storage is used.
     */
    _usesMemoryStorage() {
        try {
            return !this._getConfiguration().getDatabaseConfiguration()[this.databaseIdentifier];
        }
        catch {
            return true;
        }
    }
    /**
     * Runs a callback with a database connection.
     * @template Result
     * @param {(db: import("../database/drivers/base.js").default) => Promise<Result>} callback - Database callback.
     * @param {import("../database/drivers/base.js").default} [connection] - Explicit record-owned connection.
     * @returns {Promise<Result>} Callback result.
     */
    async _withDb(callback, connection) {
        if (connection)
            return await callback(connection);
        return await this._getConfiguration().ensureConnections({ databaseIdentifiers: [this.databaseIdentifier], name: "Server sequence allocator" }, async (dbs) => {
            const db = dbs[this.databaseIdentifier];
            if (!db)
                throw new Error(`No database connection available for identifier: ${this.databaseIdentifier}`);
            return await callback(db);
        });
    }
    /**
     * Ensures the sequences table exists.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<boolean>} Whether the table had to be created.
     */
    async _ensureSequencesTable(db) {
        if (await db.tableExists(this.tableName))
            return false;
        const table = new TableData(this.tableName, { ifNotExists: true });
        table.bigint("id", { autoIncrement: true, null: false, primaryKey: true });
        table.datetime("created_at", { null: false });
        await db.createTable(table);
        return true;
    }
}
/**
 * Wires server sequencing onto a sync model class: registers a beforeCreate
 * lifecycle callback assigning the next sequence when the record has none, and
 * defines an `advance<Column>()` instance method (when the model does not
 * already define one) that re-sequences the record through the allocator.
 *
 * The sequence is always written through the model's generated typed setter
 * (for example `setServerSequence`), so the model must expose the generated
 * `set<Column>`/`has<Column>` accessors for the column.
 * @template {typeof import("../database/record/index.js").default} TModelClass
 * @param {TModelClass} ModelClass - Sync model class to sequence.
 * @param {object} args - Options.
 * @param {ServerSequenceAllocator} args.allocator - Allocator providing sequence values.
 * @param {string} [args.column] - Sequence attribute name.
 * @returns {TModelClass} The given model class.
 */
export function withServerSequence(ModelClass, { allocator, column = "serverSequence" }) {
    if (!(allocator instanceof ServerSequenceAllocator)) {
        throw new Error(`withServerSequence requires a ServerSequenceAllocator, got: ${String(allocator)}`);
    }
    const upperColumn = `${column.charAt(0).toUpperCase()}${column.slice(1)}`;
    const advanceMethodName = `advance${upperColumn}`;
    const hasMethodName = `has${upperColumn}`;
    const setterMethodName = `set${upperColumn}`;
    // Narrows the prototype to dynamic method access for the configured column name.
    const prototype = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (ModelClass.prototype);
    if (typeof prototype[setterMethodName] != "function" || typeof prototype[hasMethodName] != "function") {
        throw new Error(`withServerSequence requires generated ${setterMethodName} and ${hasMethodName} accessors on ${ModelClass.name}`);
    }
    if (typeof prototype[advanceMethodName] != "function") {
        /**
         * Assigns the next server-side sequence.
         * @this {import("../database/record/index.js").default & Record<string, ReturnType<typeof JSON.parse>>}
         * @returns {Promise<void>}
         */
        prototype[advanceMethodName] = async function advanceServerSequenceThroughAllocator() {
            this[setterMethodName](await allocator._nextForRecord(this));
        };
    }
    ModelClass.beforeCreate(async (record) => {
        // Narrows the record to dynamic method access for the configured column name.
        const dynamicRecord = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ ( /** @type {ReturnType<typeof JSON.parse>} */(record));
        if (dynamicRecord[hasMethodName]())
            return;
        await dynamicRecord[advanceMethodName]();
    });
    return ModelClass;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VydmVyLXNlcXVlbmNlLWFsbG9jYXRvci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9zeW5jL3NlcnZlci1zZXF1ZW5jZS1hbGxvY2F0b3IuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sYUFBYSxNQUFNLHFCQUFxQixDQUFBO0FBQy9DLE9BQU8sU0FBUyxNQUFNLGlDQUFpQyxDQUFBO0FBRXZEOzs7O0dBSUc7QUFDSCxNQUFNLGdCQUFnQixHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7QUFFbEM7Ozs7Ozs7Ozs7O0dBV0c7QUFDSCxNQUFNLENBQUMsT0FBTyxPQUFPLHVCQUF1QjtJQUMxQzs7Ozs7OztPQU9HO0lBQ0gsWUFBWSxFQUFDLGFBQWEsRUFBRSxrQkFBa0IsR0FBRyxTQUFTLEVBQUUsVUFBVSxFQUFFLFNBQVMsR0FBRyw0QkFBNEIsRUFBQyxHQUFHLEVBQUU7UUFDcEgsSUFBSSxDQUFDLGFBQWEsR0FBRyxhQUFhLENBQUE7UUFDbEMsSUFBSSxDQUFDLGtCQUFrQixHQUFHLGtCQUFrQixDQUFBO1FBQzVDLElBQUksQ0FBQyxVQUFVLEdBQUcsVUFBVSxDQUFBO1FBQzVCLElBQUksQ0FBQyxTQUFTLEdBQUcsU0FBUyxDQUFBO1FBQzFCLElBQUksQ0FBQyxlQUFlLEdBQUcsQ0FBQyxDQUFBO1FBQ3hCLElBQUksQ0FBQyxRQUFRLEdBQUcsS0FBSyxDQUFBO1FBQ3JCLElBQUksQ0FBQyw4QkFBOEIsR0FBRyxLQUFLLENBQUE7UUFDM0MsbUNBQW1DO1FBQ25DLElBQUksQ0FBQyxhQUFhLEdBQUcsSUFBSSxDQUFBO0lBQzNCLENBQUM7SUFFRDs7Ozs7Ozs7O09BU0c7SUFDSCxLQUFLLENBQUMsSUFBSSxDQUFDLEVBQUMsVUFBVSxFQUFDLEdBQUcsRUFBRTtRQUMxQixNQUFNLFFBQVEsR0FBRyxHQUFHLElBQUksQ0FBQyxrQkFBa0IsS0FBSyxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUE7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LDREQUE0RCxDQUFDLEVBQUMsNENBQTZDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQTtRQUUxSSxJQUFJLGFBQWEsQ0FBQyxhQUFhLENBQUMsRUFBRTtZQUFFLE9BQU07UUFFMUMsTUFBTSxhQUFhLENBQUMsaUJBQWlCLENBQUMsRUFBRSxDQUFBO0lBQzFDLENBQUMsQ0FBQyxDQUFBO0lBRUYsT0FBTyxVQUFVLENBQUE7QUFDbkIsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgQ29uZmlndXJhdGlvbiBmcm9tIFwiLi4vY29uZmlndXJhdGlvbi5qc1wiXG5pbXBvcnQgVGFibGVEYXRhIGZyb20gXCIuLi9kYXRhYmFzZS90YWJsZS1kYXRhL2luZGV4LmpzXCJcblxuLyoqXG4gKiBBbGxvY2F0aW9uIHF1ZXVlcyBwZXIgZGF0YWJhc2UrdGFibGUsIHNlcmlhbGl6aW5nIGluc2VydC9sYXN0LWluc2VydC1pZFxuICogcGFpcnMgYWNyb3NzIGFsbCBhbGxvY2F0b3IgaW5zdGFuY2VzIGluIHRoaXMgcHJvY2Vzcy5cbiAqIEB0eXBlIHtNYXA8c3RyaW5nLCBQcm9taXNlPHZvaWQ+Pn1cbiAqL1xuY29uc3QgYWxsb2NhdGlvblF1ZXVlcyA9IG5ldyBNYXAoKVxuXG4vKipcbiAqIEFsbG9jYXRlcyBtb25vdG9uaWNhbGx5IGluY3JlYXNpbmcgc2VydmVyIHN5bmMgc2VxdWVuY2VzIGZyb20gYW5cbiAqIEFVVE9fSU5DUkVNRU5UIGlkIHRhYmxlOiBldmVyeSBhbGxvY2F0aW9uIGluc2VydHMgYSByb3cgYW5kIHJldHVybnMgdGhlXG4gKiBkcml2ZXIncyBsYXN0LWluc2VydCBpZCwgc28gc2VxdWVuY2VzIHN0YXkgdW5pcXVlIGFuZCBpbmNyZWFzaW5nIGFjcm9zc1xuICogcHJvY2Vzc2VzIHNoYXJpbmcgdGhlIHNhbWUgZGF0YWJhc2UuXG4gKlxuICogQmFja2VkIGJ5IGFuIGF1dG8tY3JlYXRlZCBgdmVsb2Npb3VzX3NlcnZlcl9zZXF1ZW5jZXNgIHRhYmxlIG9uIHRoZVxuICogY29uZmlndXJlZCBkYXRhYmFzZSwgd2l0aCBhIHByb2Nlc3MtbG9jYWwgbWVtb3J5IGNvdW50ZXIgZmFsbGJhY2sgd2hlbiBub1xuICogZGF0YWJhc2UgaXMgY29uZmlndXJlZCAobWlycm9yaW5nIHRoZSBzeW5jIHNjb3BlIHN0b3JlKS4gQXBwcyB3aXRoIGFuXG4gKiBleGlzdGluZyBzZXF1ZW5jZSB0YWJsZSAoZm9yIGV4YW1wbGUgYSBiYXJlIGBpZGAtb25seSBBVVRPX0lOQ1JFTUVOVCB0YWJsZSlcbiAqIHBvaW50IGB0YWJsZU5hbWVgIGF0IGl0IGFuZCBwYXNzIGBpbnNlcnREYXRhOiB7fWAgdG8gaW5zZXJ0IGVtcHR5IHJvd3MuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFNlcnZlclNlcXVlbmNlQWxsb2NhdG9yIHtcbiAgLyoqXG4gICAqIENyZWF0ZXMgYSBzZXJ2ZXIgc2VxdWVuY2UgYWxsb2NhdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IFthcmdzLmNvbmZpZ3VyYXRpb25dIC0gQ29uZmlndXJhdGlvbiBvd25pbmcgdGhlIGRhdGFiYXNlLiBEZWZhdWx0cyB0byB0aGUgY3VycmVudCBjb25maWd1cmF0aW9uLCByZXNvbHZlZCBsYXppbHkgcGVyIGFsbG9jYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5kYXRhYmFzZUlkZW50aWZpZXJdIC0gRGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IFthcmdzLmluc2VydERhdGFdIC0gUm93IHBheWxvYWQgaW5zZXJ0ZWQgcGVyIGFsbG9jYXRpb24uIERlZmF1bHRzIHRvIGB7Y3JlYXRlZF9hdDogbmV3IERhdGUoKX1gIG1hdGNoaW5nIHRoZSBhdXRvLWNyZWF0ZWQgdGFibGU7IHBhc3MgYHt9YCBmb3IgYmFyZSBpZC1vbmx5IHRhYmxlcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLnRhYmxlTmFtZV0gLSBTZXF1ZW5jZSB0YWJsZSBuYW1lLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2NvbmZpZ3VyYXRpb24sIGRhdGFiYXNlSWRlbnRpZmllciA9IFwiZGVmYXVsdFwiLCBpbnNlcnREYXRhLCB0YWJsZU5hbWUgPSBcInZlbG9jaW91c19zZXJ2ZXJfc2VxdWVuY2VzXCJ9ID0ge30pIHtcbiAgICB0aGlzLmNvbmZpZ3VyYXRpb24gPSBjb25maWd1cmF0aW9uXG4gICAgdGhpcy5kYXRhYmFzZUlkZW50aWZpZXIgPSBkYXRhYmFzZUlkZW50aWZpZXJcbiAgICB0aGlzLmluc2VydERhdGEgPSBpbnNlcnREYXRhXG4gICAgdGhpcy50YWJsZU5hbWUgPSB0YWJsZU5hbWVcbiAgICB0aGlzLl9tZW1vcnlTZXF1ZW5jZSA9IDBcbiAgICB0aGlzLl9pc1JlYWR5ID0gZmFsc2VcbiAgICB0aGlzLl90cmFuc2FjdGlvbmFsUmVhZGluZXNzUGVuZGluZyA9IGZhbHNlXG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+IHwgbnVsbH0gKi9cbiAgICB0aGlzLl9yZWFkeVByb21pc2UgPSBudWxsXG4gIH1cblxuICAvKipcbiAgICogQWxsb2NhdGVzIHRoZSBuZXh0IG1vbm90b25pY2FsbHkgaW5jcmVhc2luZyBzZXF1ZW5jZS5cbiAgICpcbiAgICogQWxsb2NhdGlvbnMgc2VyaWFsaXplIHRocm91Z2ggYSBtb2R1bGUtbGV2ZWwgcXVldWUgcGVyIGRhdGFiYXNlK3RhYmxlIHNvXG4gICAqIHBhcmFsbGVsIGBuZXh0KClgIGNhbGxzIC0gaW5jbHVkaW5nIGNhbGxzIGZyb20gb3RoZXIgYWxsb2NhdG9yIGluc3RhbmNlc1xuICAgKiBzaGFyaW5nIHRoZSBzYW1lIHRhYmxlIGFuZCBjb25uZWN0aW9uIC0gY2Fubm90IGludGVybGVhdmUgdGhlaXIgaW5zZXJ0XG4gICAqIGFuZCBsYXN0LWluc2VydC1pZCByZWFkcyBhbmQgaGFuZCBvdXQgZHVwbGljYXRlIHNlcXVlbmNlcy5cbiAgICogQHBhcmFtIHt7Y29ubmVjdGlvbj86IGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fX0gW29wdGlvbnNdIC0gRXhwbGljaXQgcmVjb3JkLW93bmVkIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IE5leHQgc2VxdWVuY2UgdmFsdWUuXG4gICAqL1xuICBhc3luYyBuZXh0KHtjb25uZWN0aW9ufSA9IHt9KSB7XG4gICAgY29uc3QgcXVldWVLZXkgPSBgJHt0aGlzLmRhdGFiYXNlSWRlbnRpZmllcn06OiR7dGhpcy50YWJsZU5hbWV9YFxuICAgIGNvbnN0IHByZXZpb3VzQWxsb2NhdGlvbiA9IGFsbG9jYXRpb25RdWV1ZXMuZ2V0KHF1ZXVlS2V5KSA/PyBQcm9taXNlLnJlc29sdmUoKVxuICAgIGNvbnN0IGFsbG9jYXRpb24gPSBwcmV2aW91c0FsbG9jYXRpb24udGhlbigoKSA9PiB0aGlzLl9hbGxvY2F0ZU5leHQoY29ubmVjdGlvbikpXG5cbiAgICBhbGxvY2F0aW9uUXVldWVzLnNldChxdWV1ZUtleSwgYWxsb2NhdGlvbi50aGVuKCgpID0+IHVuZGVmaW5lZCwgKCkgPT4gdW5kZWZpbmVkKSlcblxuICAgIHJldHVybiBhd2FpdCBhbGxvY2F0aW9uXG4gIH1cblxuICAvKipcbiAgICogQWxsb2NhdGVzIGZvciBhIHJlY29yZCB3aGlsZSBwcmVzZXJ2aW5nIGFsbG9jYXRvciByb3V0aW5nIGFuZCBvcGVyYXRpb24gb3duZXJzaGlwLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSByZWNvcmQgLSBSZWNvcmQgcmVjZWl2aW5nIHRoZSBzZXF1ZW5jZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gTmV4dCBzZXF1ZW5jZSB2YWx1ZS5cbiAgICovXG4gIGFzeW5jIF9uZXh0Rm9yUmVjb3JkKHJlY29yZCkge1xuICAgIGNvbnN0IG9wZXJhdGlvbiA9IHJlY29yZC5kYXRhYmFzZU9wZXJhdGlvbigpXG5cbiAgICBpZiAoIW9wZXJhdGlvbikgcmV0dXJuIGF3YWl0IHRoaXMubmV4dCgpXG5cbiAgICBjb25zdCBNb2RlbENsYXNzID0gcmVjb3JkLmdldE1vZGVsQ2xhc3MoKVxuXG4gICAgaWYgKHRoaXMuX2dldENvbmZpZ3VyYXRpb24oKSAhPT0gTW9kZWxDbGFzcy5fZ2V0Q29uZmlndXJhdGlvbigpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJTZXJ2ZXIgc2VxdWVuY2UgYWxsb2NhdG9yIGJlbG9uZ3MgdG8gYW5vdGhlciBWZWxvY2lvdXMgY29uZmlndXJhdGlvblwiKVxuICAgIH1cblxuICAgIGNvbnN0IG1vZGVsRGF0YWJhc2VJZGVudGlmaWVyID0gTW9kZWxDbGFzcy5nZXREYXRhYmFzZUlkZW50aWZpZXIoKVxuXG4gICAgaWYgKHRoaXMuZGF0YWJhc2VJZGVudGlmaWVyICE9PSBtb2RlbERhdGFiYXNlSWRlbnRpZmllcikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBTZXJ2ZXIgc2VxdWVuY2UgYWxsb2NhdG9yIHVzZXMgZGF0YWJhc2UgJHtKU09OLnN0cmluZ2lmeSh0aGlzLmRhdGFiYXNlSWRlbnRpZmllcil9LCBub3Qgb3BlcmF0aW9uIG1vZGVsIGRhdGFiYXNlICR7SlNPTi5zdHJpbmdpZnkobW9kZWxEYXRhYmFzZUlkZW50aWZpZXIpfWApXG4gICAgfVxuXG4gICAgY29uc3Qgb3BlcmF0aW9uU2NvcGUgPSBvcGVyYXRpb24uZm9yTW9kZWwoTW9kZWxDbGFzcylcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLm5leHQoe2Nvbm5lY3Rpb246IG9wZXJhdGlvblNjb3BlLmRyaXZlcn0pXG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyB0aGUgYmFja2luZyB0YWJsZSBleGlzdHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IFtjb25uZWN0aW9uXSAtIEV4cGxpY2l0IHJlY29yZC1vd25lZCBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgd2hlbiByZWFkeS5cbiAgICovXG4gIGFzeW5jIGVuc3VyZVJlYWR5KGNvbm5lY3Rpb24pIHtcbiAgICBpZiAodGhpcy5faXNSZWFkeSkgcmV0dXJuXG5cbiAgICBpZiAodGhpcy5fdXNlc01lbW9yeVN0b3JhZ2UoKSkge1xuICAgICAgdGhpcy5faXNSZWFkeSA9IHRydWVcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmICh0aGlzLl9yZWFkeVByb21pc2UpIHJldHVybiBhd2FpdCB0aGlzLl9yZWFkeVByb21pc2VcblxuICAgIHRoaXMuX3JlYWR5UHJvbWlzZSA9IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IGNyZWF0ZWQgPSBhd2FpdCB0aGlzLl9lbnN1cmVTZXF1ZW5jZXNUYWJsZShkYilcblxuICAgICAgLy8gRERMIGpvaW5zIGFueSB0cmFuc2FjdGlvbiBhbHJlYWR5IG9wZW4gb24gdGhpcyBjb25uZWN0aW9uICh0aGUgbWl4aW4nc1xuICAgICAgLy8gYmVmb3JlQ3JlYXRlIGFsbG9jYXRpb24gYWx3YXlzIHJ1bnMgaW5zaWRlIHRoZSByZWNvcmQgc2F2ZSB0cmFuc2FjdGlvbiksXG4gICAgICAvLyBhbmQgb24gdHJhbnNhY3Rpb25hbC1EREwgZGF0YWJhc2VzIChNU1NRTCwgUG9zdGdyZVNRTCwgU1FMaXRlKSBhIHJvbGxiYWNrXG4gICAgICAvLyBvZiB0aGF0IG91dGVyIHRyYW5zYWN0aW9uIHJlbW92ZXMgdGhlIGp1c3QtY3JlYXRlZCB0YWJsZSBhZ2Fpbi4gS2VlcFxuICAgICAgLy8gcmVhZGluZXNzIHBlbmRpbmcgZm9yIGV2ZXJ5IGxhdGVyIGFsbG9jYXRpb24gaW4gdGhhdCBzYW1lIHRyYW5zYWN0aW9uO1xuICAgICAgLy8gb3RoZXJ3aXNlIGl0cyB0YWJsZS1leGlzdHMgY2hlY2sgd291bGQgaW5jb3JyZWN0bHkgY2FjaGUgcmVhZGluZXNzIGJlZm9yZVxuICAgICAgLy8gdGhlIG91dGVyIHRyYW5zYWN0aW9uIGNvbW1pdHMuXG4gICAgICBpZiAoY3JlYXRlZCAmJiBkYi5pbnNpZGVUcmFuc2FjdGlvbigpKSB7XG4gICAgICAgIHRoaXMuX3RyYW5zYWN0aW9uYWxSZWFkaW5lc3NQZW5kaW5nID0gdHJ1ZVxuXG4gICAgICAgIHZvaWQgZGIudHJhbnNhY3Rpb25Db21wbGV0aW9uKCkudGhlbigoKSA9PiB7XG4gICAgICAgICAgLy8gVGhlIHRyYW5zYWN0aW9uIG1heSBoYXZlIGNvbW1pdHRlZCBvciByb2xsZWQgYmFjay4gUmUtY2hlY2sgb25jZVxuICAgICAgICAgIC8vIG9uIHRoZSBuZXh0IGFsbG9jYXRpb24sIHRoZW4gY2FjaGUgdGhlIGR1cmFibGUgb3V0Y29tZSBub3JtYWxseS5cbiAgICAgICAgICB0aGlzLl9pc1JlYWR5ID0gZmFsc2VcbiAgICAgICAgICB0aGlzLl90cmFuc2FjdGlvbmFsUmVhZGluZXNzUGVuZGluZyA9IGZhbHNlXG4gICAgICAgIH0pXG4gICAgICB9XG5cbiAgICAgIGlmICghZGIuaW5zaWRlVHJhbnNhY3Rpb24oKSB8fCAoIWNyZWF0ZWQgJiYgIXRoaXMuX3RyYW5zYWN0aW9uYWxSZWFkaW5lc3NQZW5kaW5nKSkge1xuICAgICAgICB0aGlzLl9pc1JlYWR5ID0gdHJ1ZVxuICAgICAgICB0aGlzLl90cmFuc2FjdGlvbmFsUmVhZGluZXNzUGVuZGluZyA9IGZhbHNlXG4gICAgICB9XG4gICAgfSwgY29ubmVjdGlvbilcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLl9yZWFkeVByb21pc2VcbiAgICB9IGZpbmFsbHkge1xuICAgICAgaWYgKCF0aGlzLl9pc1JlYWR5KSB0aGlzLl9yZWFkeVByb21pc2UgPSBudWxsXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEFsbG9jYXRlcyBvbmUgc2VxdWVuY2UgdmFsdWUgYWZ0ZXIgcXVldWVpbmcuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IFtjb25uZWN0aW9uXSAtIEV4cGxpY2l0IHJlY29yZC1vd25lZCBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSBBbGxvY2F0ZWQgc2VxdWVuY2UgdmFsdWUuXG4gICAqL1xuICBhc3luYyBfYWxsb2NhdGVOZXh0KGNvbm5lY3Rpb24pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KGNvbm5lY3Rpb24pXG5cbiAgICBpZiAodGhpcy5fdXNlc01lbW9yeVN0b3JhZ2UoKSkge1xuICAgICAgcmV0dXJuICsrdGhpcy5fbWVtb3J5U2VxdWVuY2VcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4ge1xuICAgICAgLy8gVGhlIGFsbG9jYXRlZCBpZCBtdXN0IGJlIHJldHVybmVkIGJ5IHRoZSBpbnNlcnQgc3RhdGVtZW50IGl0c2VsZiAoT1VUUFVUXG4gICAgICAvLyBJTlNFUlRFRC9SRVRVUk5JTkcpLCBsaWtlIHRoZSByZWNvcmQgY3JlYXRlIHBhdGggZG9lczogTVNTUUwnc1xuICAgICAgLy8gU0NPUEVfSURFTlRJVFkoKSBvbmx5IHNlZXMgaW5zZXJ0cyBmcm9tIHRoZSBzYW1lIGJhdGNoL3Njb3BlLCBzbyByZWFkaW5nXG4gICAgICAvLyB0aGUgbGFzdC1pbnNlcnQgaWQgYXMgYSBzZXBhcmF0ZSBxdWVyeSBhbHdheXMgcmV0dXJucyBOVUxMIHRoZXJlLiBEcml2ZXJzXG4gICAgICAvLyB3aXRob3V0IGluc2VydC1yZXR1cm5pbmcgc3VwcG9ydCAob2xkZXIgU1FMaXRlKSBrZWVwIHRoZSByZWxpYWJsZVxuICAgICAgLy8gY29ubmVjdGlvbi1zY29wZWQgbGFzdC1pbnNlcnQtaWQgZmFsbGJhY2suXG4gICAgICBjb25zdCBpbnNlcnRTcWwgPSBkYi5pbnNlcnRTcWwoe1xuICAgICAgICBkYXRhOiB0aGlzLl9pbnNlcnRQYXlsb2FkKCksXG4gICAgICAgIHJldHVybkxhc3RJbnNlcnRlZENvbHVtbk5hbWVzOiBbXCJpZFwiXSxcbiAgICAgICAgdGFibGVOYW1lOiB0aGlzLnRhYmxlTmFtZVxuICAgICAgfSlcbiAgICAgIGNvbnN0IGluc2VydFJlc3VsdCA9IGF3YWl0IGRiLnF1ZXJ5KGluc2VydFNxbClcbiAgICAgIGNvbnN0IGluc2VydGVkSWQgPSBBcnJheS5pc0FycmF5KGluc2VydFJlc3VsdCkgPyBpbnNlcnRSZXN1bHRbMF0/LmlkIDogdW5kZWZpbmVkXG5cbiAgICAgIGlmIChpbnNlcnRlZElkICE9PSB1bmRlZmluZWQgJiYgaW5zZXJ0ZWRJZCAhPT0gbnVsbCkgcmV0dXJuIE51bWJlcihpbnNlcnRlZElkKVxuXG4gICAgICByZXR1cm4gTnVtYmVyKGF3YWl0IGRiLmxhc3RJbnNlcnRJRCgpKVxuICAgIH0sIGNvbm5lY3Rpb24pXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSByb3cgcGF5bG9hZCBpbnNlcnRlZCBwZXIgYWxsb2NhdGlvbi5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gSW5zZXJ0IHBheWxvYWQuXG4gICAqL1xuICBfaW5zZXJ0UGF5bG9hZCgpIHtcbiAgICByZXR1cm4gdGhpcy5pbnNlcnREYXRhID8/IHtjcmVhdGVkX2F0OiBuZXcgRGF0ZSgpfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBjb25maWd1cmF0aW9uIG93bmluZyB0aGUgc2VxdWVuY2UgdGFibGUuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IFJlc29sdmVkIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBfZ2V0Q29uZmlndXJhdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5jb25maWd1cmF0aW9uID8/IENvbmZpZ3VyYXRpb24uY3VycmVudCgpXG4gIH1cblxuICAvKipcbiAgICogV2hldGhlciB0aGUgYWxsb2NhdG9yIHJ1bnMgd2l0aG91dCBhIGNvbmZpZ3VyZWQgZGF0YWJhc2UuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSBXaGV0aGVyIG1lbW9yeSBzdG9yYWdlIGlzIHVzZWQuXG4gICAqL1xuICBfdXNlc01lbW9yeVN0b3JhZ2UoKSB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiAhdGhpcy5fZ2V0Q29uZmlndXJhdGlvbigpLmdldERhdGFiYXNlQ29uZmlndXJhdGlvbigpW3RoaXMuZGF0YWJhc2VJZGVudGlmaWVyXVxuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIHRydWVcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBhIGNhbGxiYWNrIHdpdGggYSBkYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAdGVtcGxhdGUgUmVzdWx0XG4gICAqIEBwYXJhbSB7KGRiOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCkgPT4gUHJvbWlzZTxSZXN1bHQ+fSBjYWxsYmFjayAtIERhdGFiYXNlIGNhbGxiYWNrLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBbY29ubmVjdGlvbl0gLSBFeHBsaWNpdCByZWNvcmQtb3duZWQgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVzdWx0Pn0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgX3dpdGhEYihjYWxsYmFjaywgY29ubmVjdGlvbikge1xuICAgIGlmIChjb25uZWN0aW9uKSByZXR1cm4gYXdhaXQgY2FsbGJhY2soY29ubmVjdGlvbilcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9nZXRDb25maWd1cmF0aW9uKCkuZW5zdXJlQ29ubmVjdGlvbnMoe2RhdGFiYXNlSWRlbnRpZmllcnM6IFt0aGlzLmRhdGFiYXNlSWRlbnRpZmllcl0sIG5hbWU6IFwiU2VydmVyIHNlcXVlbmNlIGFsbG9jYXRvclwifSwgYXN5bmMgKGRicykgPT4ge1xuICAgICAgY29uc3QgZGIgPSBkYnNbdGhpcy5kYXRhYmFzZUlkZW50aWZpZXJdXG5cbiAgICAgIGlmICghZGIpIHRocm93IG5ldyBFcnJvcihgTm8gZGF0YWJhc2UgY29ubmVjdGlvbiBhdmFpbGFibGUgZm9yIGlkZW50aWZpZXI6ICR7dGhpcy5kYXRhYmFzZUlkZW50aWZpZXJ9YClcblxuICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKGRiKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyB0aGUgc2VxdWVuY2VzIHRhYmxlIGV4aXN0cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gV2hldGhlciB0aGUgdGFibGUgaGFkIHRvIGJlIGNyZWF0ZWQuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlU2VxdWVuY2VzVGFibGUoZGIpIHtcbiAgICBpZiAoYXdhaXQgZGIudGFibGVFeGlzdHModGhpcy50YWJsZU5hbWUpKSByZXR1cm4gZmFsc2VcblxuICAgIGNvbnN0IHRhYmxlID0gbmV3IFRhYmxlRGF0YSh0aGlzLnRhYmxlTmFtZSwge2lmTm90RXhpc3RzOiB0cnVlfSlcblxuICAgIHRhYmxlLmJpZ2ludChcImlkXCIsIHthdXRvSW5jcmVtZW50OiB0cnVlLCBudWxsOiBmYWxzZSwgcHJpbWFyeUtleTogdHJ1ZX0pXG4gICAgdGFibGUuZGF0ZXRpbWUoXCJjcmVhdGVkX2F0XCIsIHtudWxsOiBmYWxzZX0pXG5cbiAgICBhd2FpdCBkYi5jcmVhdGVUYWJsZSh0YWJsZSlcblxuICAgIHJldHVybiB0cnVlXG4gIH1cbn1cblxuLyoqXG4gKiBXaXJlcyBzZXJ2ZXIgc2VxdWVuY2luZyBvbnRvIGEgc3luYyBtb2RlbCBjbGFzczogcmVnaXN0ZXJzIGEgYmVmb3JlQ3JlYXRlXG4gKiBsaWZlY3ljbGUgY2FsbGJhY2sgYXNzaWduaW5nIHRoZSBuZXh0IHNlcXVlbmNlIHdoZW4gdGhlIHJlY29yZCBoYXMgbm9uZSwgYW5kXG4gKiBkZWZpbmVzIGFuIGBhZHZhbmNlPENvbHVtbj4oKWAgaW5zdGFuY2UgbWV0aG9kICh3aGVuIHRoZSBtb2RlbCBkb2VzIG5vdFxuICogYWxyZWFkeSBkZWZpbmUgb25lKSB0aGF0IHJlLXNlcXVlbmNlcyB0aGUgcmVjb3JkIHRocm91Z2ggdGhlIGFsbG9jYXRvci5cbiAqXG4gKiBUaGUgc2VxdWVuY2UgaXMgYWx3YXlzIHdyaXR0ZW4gdGhyb3VnaCB0aGUgbW9kZWwncyBnZW5lcmF0ZWQgdHlwZWQgc2V0dGVyXG4gKiAoZm9yIGV4YW1wbGUgYHNldFNlcnZlclNlcXVlbmNlYCksIHNvIHRoZSBtb2RlbCBtdXN0IGV4cG9zZSB0aGUgZ2VuZXJhdGVkXG4gKiBgc2V0PENvbHVtbj5gL2BoYXM8Q29sdW1uPmAgYWNjZXNzb3JzIGZvciB0aGUgY29sdW1uLlxuICogQHRlbXBsYXRlIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IFRNb2RlbENsYXNzXG4gKiBAcGFyYW0ge1RNb2RlbENsYXNzfSBNb2RlbENsYXNzIC0gU3luYyBtb2RlbCBjbGFzcyB0byBzZXF1ZW5jZS5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAqIEBwYXJhbSB7U2VydmVyU2VxdWVuY2VBbGxvY2F0b3J9IGFyZ3MuYWxsb2NhdG9yIC0gQWxsb2NhdG9yIHByb3ZpZGluZyBzZXF1ZW5jZSB2YWx1ZXMuXG4gKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuY29sdW1uXSAtIFNlcXVlbmNlIGF0dHJpYnV0ZSBuYW1lLlxuICogQHJldHVybnMge1RNb2RlbENsYXNzfSBUaGUgZ2l2ZW4gbW9kZWwgY2xhc3MuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB3aXRoU2VydmVyU2VxdWVuY2UoTW9kZWxDbGFzcywge2FsbG9jYXRvciwgY29sdW1uID0gXCJzZXJ2ZXJTZXF1ZW5jZVwifSkge1xuICBpZiAoIShhbGxvY2F0b3IgaW5zdGFuY2VvZiBTZXJ2ZXJTZXF1ZW5jZUFsbG9jYXRvcikpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYHdpdGhTZXJ2ZXJTZXF1ZW5jZSByZXF1aXJlcyBhIFNlcnZlclNlcXVlbmNlQWxsb2NhdG9yLCBnb3Q6ICR7U3RyaW5nKGFsbG9jYXRvcil9YClcbiAgfVxuXG4gIGNvbnN0IHVwcGVyQ29sdW1uID0gYCR7Y29sdW1uLmNoYXJBdCgwKS50b1VwcGVyQ2FzZSgpfSR7Y29sdW1uLnNsaWNlKDEpfWBcbiAgY29uc3QgYWR2YW5jZU1ldGhvZE5hbWUgPSBgYWR2YW5jZSR7dXBwZXJDb2x1bW59YFxuICBjb25zdCBoYXNNZXRob2ROYW1lID0gYGhhcyR7dXBwZXJDb2x1bW59YFxuICBjb25zdCBzZXR0ZXJNZXRob2ROYW1lID0gYHNldCR7dXBwZXJDb2x1bW59YFxuXG4gIC8vIE5hcnJvd3MgdGhlIHByb3RvdHlwZSB0byBkeW5hbWljIG1ldGhvZCBhY2Nlc3MgZm9yIHRoZSBjb25maWd1cmVkIGNvbHVtbiBuYW1lLlxuICBjb25zdCBwcm90b3R5cGUgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKE1vZGVsQ2xhc3MucHJvdG90eXBlKVxuXG4gIGlmICh0eXBlb2YgcHJvdG90eXBlW3NldHRlck1ldGhvZE5hbWVdICE9IFwiZnVuY3Rpb25cIiB8fCB0eXBlb2YgcHJvdG90eXBlW2hhc01ldGhvZE5hbWVdICE9IFwiZnVuY3Rpb25cIikge1xuICAgIHRocm93IG5ldyBFcnJvcihgd2l0aFNlcnZlclNlcXVlbmNlIHJlcXVpcmVzIGdlbmVyYXRlZCAke3NldHRlck1ldGhvZE5hbWV9IGFuZCAke2hhc01ldGhvZE5hbWV9IGFjY2Vzc29ycyBvbiAke01vZGVsQ2xhc3MubmFtZX1gKVxuICB9XG5cbiAgaWYgKHR5cGVvZiBwcm90b3R5cGVbYWR2YW5jZU1ldGhvZE5hbWVdICE9IFwiZnVuY3Rpb25cIikge1xuICAgIC8qKlxuICAgICAqIEFzc2lnbnMgdGhlIG5leHQgc2VydmVyLXNpZGUgc2VxdWVuY2UuXG4gICAgICogQHRoaXMge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0ICYgUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fVxuICAgICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgICAqL1xuICAgIHByb3RvdHlwZVthZHZhbmNlTWV0aG9kTmFtZV0gPSBhc3luYyBmdW5jdGlvbiBhZHZhbmNlU2VydmVyU2VxdWVuY2VUaHJvdWdoQWxsb2NhdG9yKCkge1xuICAgICAgdGhpc1tzZXR0ZXJNZXRob2ROYW1lXShhd2FpdCBhbGxvY2F0b3IuX25leHRGb3JSZWNvcmQodGhpcykpXG4gICAgfVxuICB9XG5cbiAgTW9kZWxDbGFzcy5iZWZvcmVDcmVhdGUoYXN5bmMgKHJlY29yZCkgPT4ge1xuICAgIC8vIE5hcnJvd3MgdGhlIHJlY29yZCB0byBkeW5hbWljIG1ldGhvZCBhY2Nlc3MgZm9yIHRoZSBjb25maWd1cmVkIGNvbHVtbiBuYW1lLlxuICAgIGNvbnN0IGR5bmFtaWNSZWNvcmQgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChyZWNvcmQpKVxuXG4gICAgaWYgKGR5bmFtaWNSZWNvcmRbaGFzTWV0aG9kTmFtZV0oKSkgcmV0dXJuXG5cbiAgICBhd2FpdCBkeW5hbWljUmVjb3JkW2FkdmFuY2VNZXRob2ROYW1lXSgpXG4gIH0pXG5cbiAgcmV0dXJuIE1vZGVsQ2xhc3Ncbn1cbiJdfQ==