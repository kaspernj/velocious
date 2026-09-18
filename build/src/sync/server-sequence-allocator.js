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
            if (!created) {
                if (!this._transactionalReadinessPending)
                    this._isReady = true;
                return;
            }
            if (db.insideTransaction()) {
                this._transactionalReadinessPending = true;
                void db.transactionCompletion().then(() => {
                    // The transaction may have committed or rolled back. Re-check once
                    // on the next allocation, then cache the durable outcome normally.
                    this._isReady = false;
                    this._transactionalReadinessPending = false;
                });
            }
            else {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VydmVyLXNlcXVlbmNlLWFsbG9jYXRvci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9zeW5jL3NlcnZlci1zZXF1ZW5jZS1hbGxvY2F0b3IuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sYUFBYSxNQUFNLHFCQUFxQixDQUFBO0FBQy9DLE9BQU8sU0FBUyxNQUFNLGlDQUFpQyxDQUFBO0FBRXZEOzs7O0dBSUc7QUFDSCxNQUFNLGdCQUFnQixHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7QUFFbEM7Ozs7Ozs7Ozs7O0dBV0c7QUFDSCxNQUFNLENBQUMsT0FBTyxPQUFPLHVCQUF1QjtJQUMxQzs7Ozs7OztPQU9HO0lBQ0gsWUFBWSxFQUFDLGFBQWEsRUFBRSxrQkFBa0IsR0FBRyxTQUFTLEVBQUUsVUFBVSxFQUFFLFNBQVMsR0FBRyw0QkFBNEIsRUFBQyxHQUFHLEVBQUU7UUFDcEgsSUFBSSxDQUFDLGFBQWEsR0FBRyxhQUFhLENBQUE7UUFDbEMsSUFBSSxDQUFDLGtCQUFrQixHQUFHLGtCQUFrQixDQUFBO1FBQzVDLElBQUksQ0FBQyxVQUFVLEdBQUcsVUFBVSxDQUFBO1FBQzVCLElBQUksQ0FBQyxTQUFTLEdBQUcsU0FBUyxDQUFBO1FBQzFCLElBQUksQ0FBQyxlQUFlLEdBQUcsQ0FBQyxDQUFBO1FBQ3hCLElBQUksQ0FBQyxRQUFRLEdBQUcsS0FBSyxDQUFBO1FBQ3JCLElBQUksQ0FBQyw4QkFBOEIsR0FBRyxLQUFLLENBQUE7UUFDM0MsbUNBQW1DO1FBQ25DLElBQUksQ0FBQyxhQUFhLEdBQUcsSUFBSSxDQUFBO0lBQzNCLENBQUM7SUFFRDs7Ozs7Ozs7O09BU0c7SUFDSCxLQUFLLENBQUMsSUFBSSxDQUFDLEVBQUMsVUFBVSxFQUFDLEdBQUcsRUFBRTtRQUMxQixNQUFNLFFBQVEsR0FBRyxHQUFHLElBQUksQ0FBQyxrQkFBa0IsS0FBSyxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUE7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RTtRQUM5RSxNQUFNLGFBQWEsR0FBRyw0REFBNEQsQ0FBQyxFQUFDLDRDQUE2QyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUE7UUFFMUksSUFBSSxhQUFhLENBQUMsYUFBYSxDQUFDLEVBQUU7WUFBRSxPQUFNO1FBRTFDLE1BQU0sYUFBYSxDQUFDLGlCQUFpQixDQUFDLEVBQUUsQ0FBQTtJQUMxQyxDQUFDLENBQUMsQ0FBQTtJQUVGLE9BQU8sVUFBVSxDQUFBO0FBQ25CLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IENvbmZpZ3VyYXRpb24gZnJvbSBcIi4uL2NvbmZpZ3VyYXRpb24uanNcIlxuaW1wb3J0IFRhYmxlRGF0YSBmcm9tIFwiLi4vZGF0YWJhc2UvdGFibGUtZGF0YS9pbmRleC5qc1wiXG5cbi8qKlxuICogQWxsb2NhdGlvbiBxdWV1ZXMgcGVyIGRhdGFiYXNlK3RhYmxlLCBzZXJpYWxpemluZyBpbnNlcnQvbGFzdC1pbnNlcnQtaWRcbiAqIHBhaXJzIGFjcm9zcyBhbGwgYWxsb2NhdG9yIGluc3RhbmNlcyBpbiB0aGlzIHByb2Nlc3MuXG4gKiBAdHlwZSB7TWFwPHN0cmluZywgUHJvbWlzZTx2b2lkPj59XG4gKi9cbmNvbnN0IGFsbG9jYXRpb25RdWV1ZXMgPSBuZXcgTWFwKClcblxuLyoqXG4gKiBBbGxvY2F0ZXMgbW9ub3RvbmljYWxseSBpbmNyZWFzaW5nIHNlcnZlciBzeW5jIHNlcXVlbmNlcyBmcm9tIGFuXG4gKiBBVVRPX0lOQ1JFTUVOVCBpZCB0YWJsZTogZXZlcnkgYWxsb2NhdGlvbiBpbnNlcnRzIGEgcm93IGFuZCByZXR1cm5zIHRoZVxuICogZHJpdmVyJ3MgbGFzdC1pbnNlcnQgaWQsIHNvIHNlcXVlbmNlcyBzdGF5IHVuaXF1ZSBhbmQgaW5jcmVhc2luZyBhY3Jvc3NcbiAqIHByb2Nlc3NlcyBzaGFyaW5nIHRoZSBzYW1lIGRhdGFiYXNlLlxuICpcbiAqIEJhY2tlZCBieSBhbiBhdXRvLWNyZWF0ZWQgYHZlbG9jaW91c19zZXJ2ZXJfc2VxdWVuY2VzYCB0YWJsZSBvbiB0aGVcbiAqIGNvbmZpZ3VyZWQgZGF0YWJhc2UsIHdpdGggYSBwcm9jZXNzLWxvY2FsIG1lbW9yeSBjb3VudGVyIGZhbGxiYWNrIHdoZW4gbm9cbiAqIGRhdGFiYXNlIGlzIGNvbmZpZ3VyZWQgKG1pcnJvcmluZyB0aGUgc3luYyBzY29wZSBzdG9yZSkuIEFwcHMgd2l0aCBhblxuICogZXhpc3Rpbmcgc2VxdWVuY2UgdGFibGUgKGZvciBleGFtcGxlIGEgYmFyZSBgaWRgLW9ubHkgQVVUT19JTkNSRU1FTlQgdGFibGUpXG4gKiBwb2ludCBgdGFibGVOYW1lYCBhdCBpdCBhbmQgcGFzcyBgaW5zZXJ0RGF0YToge31gIHRvIGluc2VydCBlbXB0eSByb3dzLlxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBTZXJ2ZXJTZXF1ZW5jZUFsbG9jYXRvciB7XG4gIC8qKlxuICAgKiBDcmVhdGVzIGEgc2VydmVyIHNlcXVlbmNlIGFsbG9jYXRvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBbYXJncy5jb25maWd1cmF0aW9uXSAtIENvbmZpZ3VyYXRpb24gb3duaW5nIHRoZSBkYXRhYmFzZS4gRGVmYXVsdHMgdG8gdGhlIGN1cnJlbnQgY29uZmlndXJhdGlvbiwgcmVzb2x2ZWQgbGF6aWx5IHBlciBhbGxvY2F0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuZGF0YWJhc2VJZGVudGlmaWVyXSAtIERhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBbYXJncy5pbnNlcnREYXRhXSAtIFJvdyBwYXlsb2FkIGluc2VydGVkIHBlciBhbGxvY2F0aW9uLiBEZWZhdWx0cyB0byBge2NyZWF0ZWRfYXQ6IG5ldyBEYXRlKCl9YCBtYXRjaGluZyB0aGUgYXV0by1jcmVhdGVkIHRhYmxlOyBwYXNzIGB7fWAgZm9yIGJhcmUgaWQtb25seSB0YWJsZXMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy50YWJsZU5hbWVdIC0gU2VxdWVuY2UgdGFibGUgbmFtZS5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtjb25maWd1cmF0aW9uLCBkYXRhYmFzZUlkZW50aWZpZXIgPSBcImRlZmF1bHRcIiwgaW5zZXJ0RGF0YSwgdGFibGVOYW1lID0gXCJ2ZWxvY2lvdXNfc2VydmVyX3NlcXVlbmNlc1wifSA9IHt9KSB7XG4gICAgdGhpcy5jb25maWd1cmF0aW9uID0gY29uZmlndXJhdGlvblxuICAgIHRoaXMuZGF0YWJhc2VJZGVudGlmaWVyID0gZGF0YWJhc2VJZGVudGlmaWVyXG4gICAgdGhpcy5pbnNlcnREYXRhID0gaW5zZXJ0RGF0YVxuICAgIHRoaXMudGFibGVOYW1lID0gdGFibGVOYW1lXG4gICAgdGhpcy5fbWVtb3J5U2VxdWVuY2UgPSAwXG4gICAgdGhpcy5faXNSZWFkeSA9IGZhbHNlXG4gICAgdGhpcy5fdHJhbnNhY3Rpb25hbFJlYWRpbmVzc1BlbmRpbmcgPSBmYWxzZVxuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPiB8IG51bGx9ICovXG4gICAgdGhpcy5fcmVhZHlQcm9taXNlID0gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIEFsbG9jYXRlcyB0aGUgbmV4dCBtb25vdG9uaWNhbGx5IGluY3JlYXNpbmcgc2VxdWVuY2UuXG4gICAqXG4gICAqIEFsbG9jYXRpb25zIHNlcmlhbGl6ZSB0aHJvdWdoIGEgbW9kdWxlLWxldmVsIHF1ZXVlIHBlciBkYXRhYmFzZSt0YWJsZSBzb1xuICAgKiBwYXJhbGxlbCBgbmV4dCgpYCBjYWxscyAtIGluY2x1ZGluZyBjYWxscyBmcm9tIG90aGVyIGFsbG9jYXRvciBpbnN0YW5jZXNcbiAgICogc2hhcmluZyB0aGUgc2FtZSB0YWJsZSBhbmQgY29ubmVjdGlvbiAtIGNhbm5vdCBpbnRlcmxlYXZlIHRoZWlyIGluc2VydFxuICAgKiBhbmQgbGFzdC1pbnNlcnQtaWQgcmVhZHMgYW5kIGhhbmQgb3V0IGR1cGxpY2F0ZSBzZXF1ZW5jZXMuXG4gICAqIEBwYXJhbSB7e2Nvbm5lY3Rpb24/OiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH19IFtvcHRpb25zXSAtIEV4cGxpY2l0IHJlY29yZC1vd25lZCBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSBOZXh0IHNlcXVlbmNlIHZhbHVlLlxuICAgKi9cbiAgYXN5bmMgbmV4dCh7Y29ubmVjdGlvbn0gPSB7fSkge1xuICAgIGNvbnN0IHF1ZXVlS2V5ID0gYCR7dGhpcy5kYXRhYmFzZUlkZW50aWZpZXJ9Ojoke3RoaXMudGFibGVOYW1lfWBcbiAgICBjb25zdCBwcmV2aW91c0FsbG9jYXRpb24gPSBhbGxvY2F0aW9uUXVldWVzLmdldChxdWV1ZUtleSkgPz8gUHJvbWlzZS5yZXNvbHZlKClcbiAgICBjb25zdCBhbGxvY2F0aW9uID0gcHJldmlvdXNBbGxvY2F0aW9uLnRoZW4oKCkgPT4gdGhpcy5fYWxsb2NhdGVOZXh0KGNvbm5lY3Rpb24pKVxuXG4gICAgYWxsb2NhdGlvblF1ZXVlcy5zZXQocXVldWVLZXksIGFsbG9jYXRpb24udGhlbigoKSA9PiB1bmRlZmluZWQsICgpID0+IHVuZGVmaW5lZCkpXG5cbiAgICByZXR1cm4gYXdhaXQgYWxsb2NhdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIEFsbG9jYXRlcyBmb3IgYSByZWNvcmQgd2hpbGUgcHJlc2VydmluZyBhbGxvY2F0b3Igcm91dGluZyBhbmQgb3BlcmF0aW9uIG93bmVyc2hpcC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gcmVjb3JkIC0gUmVjb3JkIHJlY2VpdmluZyB0aGUgc2VxdWVuY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IE5leHQgc2VxdWVuY2UgdmFsdWUuXG4gICAqL1xuICBhc3luYyBfbmV4dEZvclJlY29yZChyZWNvcmQpIHtcbiAgICBjb25zdCBvcGVyYXRpb24gPSByZWNvcmQuZGF0YWJhc2VPcGVyYXRpb24oKVxuXG4gICAgaWYgKCFvcGVyYXRpb24pIHJldHVybiBhd2FpdCB0aGlzLm5leHQoKVxuXG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IHJlY29yZC5nZXRNb2RlbENsYXNzKClcblxuICAgIGlmICh0aGlzLl9nZXRDb25maWd1cmF0aW9uKCkgIT09IE1vZGVsQ2xhc3MuX2dldENvbmZpZ3VyYXRpb24oKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiU2VydmVyIHNlcXVlbmNlIGFsbG9jYXRvciBiZWxvbmdzIHRvIGFub3RoZXIgVmVsb2Npb3VzIGNvbmZpZ3VyYXRpb25cIilcbiAgICB9XG5cbiAgICBjb25zdCBtb2RlbERhdGFiYXNlSWRlbnRpZmllciA9IE1vZGVsQ2xhc3MuZ2V0RGF0YWJhc2VJZGVudGlmaWVyKClcblxuICAgIGlmICh0aGlzLmRhdGFiYXNlSWRlbnRpZmllciAhPT0gbW9kZWxEYXRhYmFzZUlkZW50aWZpZXIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgU2VydmVyIHNlcXVlbmNlIGFsbG9jYXRvciB1c2VzIGRhdGFiYXNlICR7SlNPTi5zdHJpbmdpZnkodGhpcy5kYXRhYmFzZUlkZW50aWZpZXIpfSwgbm90IG9wZXJhdGlvbiBtb2RlbCBkYXRhYmFzZSAke0pTT04uc3RyaW5naWZ5KG1vZGVsRGF0YWJhc2VJZGVudGlmaWVyKX1gKVxuICAgIH1cblxuICAgIGNvbnN0IG9wZXJhdGlvblNjb3BlID0gb3BlcmF0aW9uLmZvck1vZGVsKE1vZGVsQ2xhc3MpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5uZXh0KHtjb25uZWN0aW9uOiBvcGVyYXRpb25TY29wZS5kcml2ZXJ9KVxuICB9XG5cbiAgLyoqXG4gICAqIEVuc3VyZXMgdGhlIGJhY2tpbmcgdGFibGUgZXhpc3RzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBbY29ubmVjdGlvbl0gLSBFeHBsaWNpdCByZWNvcmQtb3duZWQgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIHdoZW4gcmVhZHkuXG4gICAqL1xuICBhc3luYyBlbnN1cmVSZWFkeShjb25uZWN0aW9uKSB7XG4gICAgaWYgKHRoaXMuX2lzUmVhZHkpIHJldHVyblxuXG4gICAgaWYgKHRoaXMuX3VzZXNNZW1vcnlTdG9yYWdlKCkpIHtcbiAgICAgIHRoaXMuX2lzUmVhZHkgPSB0cnVlXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAodGhpcy5fcmVhZHlQcm9taXNlKSByZXR1cm4gYXdhaXQgdGhpcy5fcmVhZHlQcm9taXNlXG5cbiAgICB0aGlzLl9yZWFkeVByb21pc2UgPSB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiB7XG4gICAgICBjb25zdCBjcmVhdGVkID0gYXdhaXQgdGhpcy5fZW5zdXJlU2VxdWVuY2VzVGFibGUoZGIpXG5cbiAgICAgIC8vIERETCBqb2lucyBhbnkgdHJhbnNhY3Rpb24gYWxyZWFkeSBvcGVuIG9uIHRoaXMgY29ubmVjdGlvbiAodGhlIG1peGluJ3NcbiAgICAgIC8vIGJlZm9yZUNyZWF0ZSBhbGxvY2F0aW9uIGFsd2F5cyBydW5zIGluc2lkZSB0aGUgcmVjb3JkIHNhdmUgdHJhbnNhY3Rpb24pLFxuICAgICAgLy8gYW5kIG9uIHRyYW5zYWN0aW9uYWwtRERMIGRhdGFiYXNlcyAoTVNTUUwsIFBvc3RncmVTUUwsIFNRTGl0ZSkgYSByb2xsYmFja1xuICAgICAgLy8gb2YgdGhhdCBvdXRlciB0cmFuc2FjdGlvbiByZW1vdmVzIHRoZSBqdXN0LWNyZWF0ZWQgdGFibGUgYWdhaW4uIEtlZXBcbiAgICAgIC8vIHJlYWRpbmVzcyBwZW5kaW5nIGZvciBldmVyeSBsYXRlciBhbGxvY2F0aW9uIGluIHRoYXQgc2FtZSB0cmFuc2FjdGlvbjtcbiAgICAgIC8vIG90aGVyd2lzZSBpdHMgdGFibGUtZXhpc3RzIGNoZWNrIHdvdWxkIGluY29ycmVjdGx5IGNhY2hlIHJlYWRpbmVzcyBiZWZvcmVcbiAgICAgIC8vIHRoZSBvdXRlciB0cmFuc2FjdGlvbiBjb21taXRzLlxuICAgICAgaWYgKCFjcmVhdGVkKSB7XG4gICAgICAgIGlmICghdGhpcy5fdHJhbnNhY3Rpb25hbFJlYWRpbmVzc1BlbmRpbmcpIHRoaXMuX2lzUmVhZHkgPSB0cnVlXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICBpZiAoZGIuaW5zaWRlVHJhbnNhY3Rpb24oKSkge1xuICAgICAgICB0aGlzLl90cmFuc2FjdGlvbmFsUmVhZGluZXNzUGVuZGluZyA9IHRydWVcblxuICAgICAgICB2b2lkIGRiLnRyYW5zYWN0aW9uQ29tcGxldGlvbigpLnRoZW4oKCkgPT4ge1xuICAgICAgICAgIC8vIFRoZSB0cmFuc2FjdGlvbiBtYXkgaGF2ZSBjb21taXR0ZWQgb3Igcm9sbGVkIGJhY2suIFJlLWNoZWNrIG9uY2VcbiAgICAgICAgICAvLyBvbiB0aGUgbmV4dCBhbGxvY2F0aW9uLCB0aGVuIGNhY2hlIHRoZSBkdXJhYmxlIG91dGNvbWUgbm9ybWFsbHkuXG4gICAgICAgICAgdGhpcy5faXNSZWFkeSA9IGZhbHNlXG4gICAgICAgICAgdGhpcy5fdHJhbnNhY3Rpb25hbFJlYWRpbmVzc1BlbmRpbmcgPSBmYWxzZVxuICAgICAgICB9KVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhpcy5faXNSZWFkeSA9IHRydWVcbiAgICAgICAgdGhpcy5fdHJhbnNhY3Rpb25hbFJlYWRpbmVzc1BlbmRpbmcgPSBmYWxzZVxuICAgICAgfVxuICAgIH0sIGNvbm5lY3Rpb24pXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5fcmVhZHlQcm9taXNlXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGlmICghdGhpcy5faXNSZWFkeSkgdGhpcy5fcmVhZHlQcm9taXNlID0gbnVsbFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBBbGxvY2F0ZXMgb25lIHNlcXVlbmNlIHZhbHVlIGFmdGVyIHF1ZXVlaW5nLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBbY29ubmVjdGlvbl0gLSBFeHBsaWNpdCByZWNvcmQtb3duZWQgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gQWxsb2NhdGVkIHNlcXVlbmNlIHZhbHVlLlxuICAgKi9cbiAgYXN5bmMgX2FsbG9jYXRlTmV4dChjb25uZWN0aW9uKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeShjb25uZWN0aW9uKVxuXG4gICAgaWYgKHRoaXMuX3VzZXNNZW1vcnlTdG9yYWdlKCkpIHtcbiAgICAgIHJldHVybiArK3RoaXMuX21lbW9yeVNlcXVlbmNlXG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IHtcbiAgICAgIC8vIFRoZSBhbGxvY2F0ZWQgaWQgbXVzdCBiZSByZXR1cm5lZCBieSB0aGUgaW5zZXJ0IHN0YXRlbWVudCBpdHNlbGYgKE9VVFBVVFxuICAgICAgLy8gSU5TRVJURUQvUkVUVVJOSU5HKSwgbGlrZSB0aGUgcmVjb3JkIGNyZWF0ZSBwYXRoIGRvZXM6IE1TU1FMJ3NcbiAgICAgIC8vIFNDT1BFX0lERU5USVRZKCkgb25seSBzZWVzIGluc2VydHMgZnJvbSB0aGUgc2FtZSBiYXRjaC9zY29wZSwgc28gcmVhZGluZ1xuICAgICAgLy8gdGhlIGxhc3QtaW5zZXJ0IGlkIGFzIGEgc2VwYXJhdGUgcXVlcnkgYWx3YXlzIHJldHVybnMgTlVMTCB0aGVyZS4gRHJpdmVyc1xuICAgICAgLy8gd2l0aG91dCBpbnNlcnQtcmV0dXJuaW5nIHN1cHBvcnQgKG9sZGVyIFNRTGl0ZSkga2VlcCB0aGUgcmVsaWFibGVcbiAgICAgIC8vIGNvbm5lY3Rpb24tc2NvcGVkIGxhc3QtaW5zZXJ0LWlkIGZhbGxiYWNrLlxuICAgICAgY29uc3QgaW5zZXJ0U3FsID0gZGIuaW5zZXJ0U3FsKHtcbiAgICAgICAgZGF0YTogdGhpcy5faW5zZXJ0UGF5bG9hZCgpLFxuICAgICAgICByZXR1cm5MYXN0SW5zZXJ0ZWRDb2x1bW5OYW1lczogW1wiaWRcIl0sXG4gICAgICAgIHRhYmxlTmFtZTogdGhpcy50YWJsZU5hbWVcbiAgICAgIH0pXG4gICAgICBjb25zdCBpbnNlcnRSZXN1bHQgPSBhd2FpdCBkYi5xdWVyeShpbnNlcnRTcWwpXG4gICAgICBjb25zdCBpbnNlcnRlZElkID0gQXJyYXkuaXNBcnJheShpbnNlcnRSZXN1bHQpID8gaW5zZXJ0UmVzdWx0WzBdPy5pZCA6IHVuZGVmaW5lZFxuXG4gICAgICBpZiAoaW5zZXJ0ZWRJZCAhPT0gdW5kZWZpbmVkICYmIGluc2VydGVkSWQgIT09IG51bGwpIHJldHVybiBOdW1iZXIoaW5zZXJ0ZWRJZClcblxuICAgICAgcmV0dXJuIE51bWJlcihhd2FpdCBkYi5sYXN0SW5zZXJ0SUQoKSlcbiAgICB9LCBjb25uZWN0aW9uKVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyB0aGUgcm93IHBheWxvYWQgaW5zZXJ0ZWQgcGVyIGFsbG9jYXRpb24uXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IEluc2VydCBwYXlsb2FkLlxuICAgKi9cbiAgX2luc2VydFBheWxvYWQoKSB7XG4gICAgcmV0dXJuIHRoaXMuaW5zZXJ0RGF0YSA/PyB7Y3JlYXRlZF9hdDogbmV3IERhdGUoKX1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgY29uZmlndXJhdGlvbiBvd25pbmcgdGhlIHNlcXVlbmNlIHRhYmxlLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBSZXNvbHZlZCBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgX2dldENvbmZpZ3VyYXRpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMuY29uZmlndXJhdGlvbiA/PyBDb25maWd1cmF0aW9uLmN1cnJlbnQoKVxuICB9XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgdGhlIGFsbG9jYXRvciBydW5zIHdpdGhvdXQgYSBjb25maWd1cmVkIGRhdGFiYXNlLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gV2hldGhlciBtZW1vcnkgc3RvcmFnZSBpcyB1c2VkLlxuICAgKi9cbiAgX3VzZXNNZW1vcnlTdG9yYWdlKCkge1xuICAgIHRyeSB7XG4gICAgICByZXR1cm4gIXRoaXMuX2dldENvbmZpZ3VyYXRpb24oKS5nZXREYXRhYmFzZUNvbmZpZ3VyYXRpb24oKVt0aGlzLmRhdGFiYXNlSWRlbnRpZmllcl1cbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiB0cnVlXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYSBjYWxsYmFjayB3aXRoIGEgZGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHRlbXBsYXRlIFJlc3VsdFxuICAgKiBAcGFyYW0geyhkYjogaW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQpID0+IFByb21pc2U8UmVzdWx0Pn0gY2FsbGJhY2sgLSBEYXRhYmFzZSBjYWxsYmFjay5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gW2Nvbm5lY3Rpb25dIC0gRXhwbGljaXQgcmVjb3JkLW93bmVkIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlc3VsdD59IENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIF93aXRoRGIoY2FsbGJhY2ssIGNvbm5lY3Rpb24pIHtcbiAgICBpZiAoY29ubmVjdGlvbikgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKGNvbm5lY3Rpb24pXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fZ2V0Q29uZmlndXJhdGlvbigpLmVuc3VyZUNvbm5lY3Rpb25zKHtkYXRhYmFzZUlkZW50aWZpZXJzOiBbdGhpcy5kYXRhYmFzZUlkZW50aWZpZXJdLCBuYW1lOiBcIlNlcnZlciBzZXF1ZW5jZSBhbGxvY2F0b3JcIn0sIGFzeW5jIChkYnMpID0+IHtcbiAgICAgIGNvbnN0IGRiID0gZGJzW3RoaXMuZGF0YWJhc2VJZGVudGlmaWVyXVxuXG4gICAgICBpZiAoIWRiKSB0aHJvdyBuZXcgRXJyb3IoYE5vIGRhdGFiYXNlIGNvbm5lY3Rpb24gYXZhaWxhYmxlIGZvciBpZGVudGlmaWVyOiAke3RoaXMuZGF0YWJhc2VJZGVudGlmaWVyfWApXG5cbiAgICAgIHJldHVybiBhd2FpdCBjYWxsYmFjayhkYilcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIEVuc3VyZXMgdGhlIHNlcXVlbmNlcyB0YWJsZSBleGlzdHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IFdoZXRoZXIgdGhlIHRhYmxlIGhhZCB0byBiZSBjcmVhdGVkLlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZVNlcXVlbmNlc1RhYmxlKGRiKSB7XG4gICAgaWYgKGF3YWl0IGRiLnRhYmxlRXhpc3RzKHRoaXMudGFibGVOYW1lKSkgcmV0dXJuIGZhbHNlXG5cbiAgICBjb25zdCB0YWJsZSA9IG5ldyBUYWJsZURhdGEodGhpcy50YWJsZU5hbWUsIHtpZk5vdEV4aXN0czogdHJ1ZX0pXG5cbiAgICB0YWJsZS5iaWdpbnQoXCJpZFwiLCB7YXV0b0luY3JlbWVudDogdHJ1ZSwgbnVsbDogZmFsc2UsIHByaW1hcnlLZXk6IHRydWV9KVxuICAgIHRhYmxlLmRhdGV0aW1lKFwiY3JlYXRlZF9hdFwiLCB7bnVsbDogZmFsc2V9KVxuXG4gICAgYXdhaXQgZGIuY3JlYXRlVGFibGUodGFibGUpXG5cbiAgICByZXR1cm4gdHJ1ZVxuICB9XG59XG5cbi8qKlxuICogV2lyZXMgc2VydmVyIHNlcXVlbmNpbmcgb250byBhIHN5bmMgbW9kZWwgY2xhc3M6IHJlZ2lzdGVycyBhIGJlZm9yZUNyZWF0ZVxuICogbGlmZWN5Y2xlIGNhbGxiYWNrIGFzc2lnbmluZyB0aGUgbmV4dCBzZXF1ZW5jZSB3aGVuIHRoZSByZWNvcmQgaGFzIG5vbmUsIGFuZFxuICogZGVmaW5lcyBhbiBgYWR2YW5jZTxDb2x1bW4+KClgIGluc3RhbmNlIG1ldGhvZCAod2hlbiB0aGUgbW9kZWwgZG9lcyBub3RcbiAqIGFscmVhZHkgZGVmaW5lIG9uZSkgdGhhdCByZS1zZXF1ZW5jZXMgdGhlIHJlY29yZCB0aHJvdWdoIHRoZSBhbGxvY2F0b3IuXG4gKlxuICogVGhlIHNlcXVlbmNlIGlzIGFsd2F5cyB3cml0dGVuIHRocm91Z2ggdGhlIG1vZGVsJ3MgZ2VuZXJhdGVkIHR5cGVkIHNldHRlclxuICogKGZvciBleGFtcGxlIGBzZXRTZXJ2ZXJTZXF1ZW5jZWApLCBzbyB0aGUgbW9kZWwgbXVzdCBleHBvc2UgdGhlIGdlbmVyYXRlZFxuICogYHNldDxDb2x1bW4+YC9gaGFzPENvbHVtbj5gIGFjY2Vzc29ycyBmb3IgdGhlIGNvbHVtbi5cbiAqIEB0ZW1wbGF0ZSB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBUTW9kZWxDbGFzc1xuICogQHBhcmFtIHtUTW9kZWxDbGFzc30gTW9kZWxDbGFzcyAtIFN5bmMgbW9kZWwgY2xhc3MgdG8gc2VxdWVuY2UuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gKiBAcGFyYW0ge1NlcnZlclNlcXVlbmNlQWxsb2NhdG9yfSBhcmdzLmFsbG9jYXRvciAtIEFsbG9jYXRvciBwcm92aWRpbmcgc2VxdWVuY2UgdmFsdWVzLlxuICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmNvbHVtbl0gLSBTZXF1ZW5jZSBhdHRyaWJ1dGUgbmFtZS5cbiAqIEByZXR1cm5zIHtUTW9kZWxDbGFzc30gVGhlIGdpdmVuIG1vZGVsIGNsYXNzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gd2l0aFNlcnZlclNlcXVlbmNlKE1vZGVsQ2xhc3MsIHthbGxvY2F0b3IsIGNvbHVtbiA9IFwic2VydmVyU2VxdWVuY2VcIn0pIHtcbiAgaWYgKCEoYWxsb2NhdG9yIGluc3RhbmNlb2YgU2VydmVyU2VxdWVuY2VBbGxvY2F0b3IpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGB3aXRoU2VydmVyU2VxdWVuY2UgcmVxdWlyZXMgYSBTZXJ2ZXJTZXF1ZW5jZUFsbG9jYXRvciwgZ290OiAke1N0cmluZyhhbGxvY2F0b3IpfWApXG4gIH1cblxuICBjb25zdCB1cHBlckNvbHVtbiA9IGAke2NvbHVtbi5jaGFyQXQoMCkudG9VcHBlckNhc2UoKX0ke2NvbHVtbi5zbGljZSgxKX1gXG4gIGNvbnN0IGFkdmFuY2VNZXRob2ROYW1lID0gYGFkdmFuY2Uke3VwcGVyQ29sdW1ufWBcbiAgY29uc3QgaGFzTWV0aG9kTmFtZSA9IGBoYXMke3VwcGVyQ29sdW1ufWBcbiAgY29uc3Qgc2V0dGVyTWV0aG9kTmFtZSA9IGBzZXQke3VwcGVyQ29sdW1ufWBcblxuICAvLyBOYXJyb3dzIHRoZSBwcm90b3R5cGUgdG8gZHluYW1pYyBtZXRob2QgYWNjZXNzIGZvciB0aGUgY29uZmlndXJlZCBjb2x1bW4gbmFtZS5cbiAgY29uc3QgcHJvdG90eXBlID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChNb2RlbENsYXNzLnByb3RvdHlwZSlcblxuICBpZiAodHlwZW9mIHByb3RvdHlwZVtzZXR0ZXJNZXRob2ROYW1lXSAhPSBcImZ1bmN0aW9uXCIgfHwgdHlwZW9mIHByb3RvdHlwZVtoYXNNZXRob2ROYW1lXSAhPSBcImZ1bmN0aW9uXCIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYHdpdGhTZXJ2ZXJTZXF1ZW5jZSByZXF1aXJlcyBnZW5lcmF0ZWQgJHtzZXR0ZXJNZXRob2ROYW1lfSBhbmQgJHtoYXNNZXRob2ROYW1lfSBhY2Nlc3NvcnMgb24gJHtNb2RlbENsYXNzLm5hbWV9YClcbiAgfVxuXG4gIGlmICh0eXBlb2YgcHJvdG90eXBlW2FkdmFuY2VNZXRob2ROYW1lXSAhPSBcImZ1bmN0aW9uXCIpIHtcbiAgICAvKipcbiAgICAgKiBBc3NpZ25zIHRoZSBuZXh0IHNlcnZlci1zaWRlIHNlcXVlbmNlLlxuICAgICAqIEB0aGlzIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCAmIFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn1cbiAgICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICAgKi9cbiAgICBwcm90b3R5cGVbYWR2YW5jZU1ldGhvZE5hbWVdID0gYXN5bmMgZnVuY3Rpb24gYWR2YW5jZVNlcnZlclNlcXVlbmNlVGhyb3VnaEFsbG9jYXRvcigpIHtcbiAgICAgIHRoaXNbc2V0dGVyTWV0aG9kTmFtZV0oYXdhaXQgYWxsb2NhdG9yLl9uZXh0Rm9yUmVjb3JkKHRoaXMpKVxuICAgIH1cbiAgfVxuXG4gIE1vZGVsQ2xhc3MuYmVmb3JlQ3JlYXRlKGFzeW5jIChyZWNvcmQpID0+IHtcbiAgICAvLyBOYXJyb3dzIHRoZSByZWNvcmQgdG8gZHluYW1pYyBtZXRob2QgYWNjZXNzIGZvciB0aGUgY29uZmlndXJlZCBjb2x1bW4gbmFtZS5cbiAgICBjb25zdCBkeW5hbWljUmVjb3JkID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAocmVjb3JkKSlcblxuICAgIGlmIChkeW5hbWljUmVjb3JkW2hhc01ldGhvZE5hbWVdKCkpIHJldHVyblxuXG4gICAgYXdhaXQgZHluYW1pY1JlY29yZFthZHZhbmNlTWV0aG9kTmFtZV0oKVxuICB9KVxuXG4gIHJldHVybiBNb2RlbENsYXNzXG59XG4iXX0=