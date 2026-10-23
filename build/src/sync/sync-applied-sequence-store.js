// @ts-check
import TableData from "../database/table-data/index.js";
import TableIndex from "../database/table-data/table-index.js";
import UUID from "pure-uuid";
/**
 * @typedef {object} SyncAppliedSequenceRow
 * @property {string} resourceId - Resource identifier the change applied to.
 * @property {string} resourceType - Resource/model name the change applied to.
 * @property {number} serverSequence - Highest applied server sequence for the resource.
 * @property {string} storeIdentity - Physical store identity owning this row.
 */
const TABLE_NAME = "velocious_sync_applied_sequences";
const IDENTITY_INDEX_NAME = "index_velocious_sync_applied_sequences_on_identity";
/**
 * Builds the stable in-memory key for one resource identity.
 * @param {{resourceType: string, resourceId: string}} args - Resource identity.
 * @returns {string} Memory key.
 */
function memoryKey({ resourceId, resourceType }) {
    return `${resourceType}:${resourceId}`;
}
/**
 * Framework-owned local bookkeeping of the newest server change sequence
 * already applied to each record.
 *
 * The server change feed is at-least-once: a realtime push does not advance a
 * pull cursor, so the next pull re-delivers the same `serverSequence`, and a
 * resumed page can repeat a row. Applying such a duplicate after a newer local
 * provisional write used to let the older server payload win. Tracking the
 * highest applied sequence per record makes the applier idempotent: a change at
 * or below the recorded sequence is skipped, while any higher sequence still
 * applies.
 *
 * Backed by an auto-created `velocious_sync_applied_sequences` table on the
 * configured database, with a process-local memory fallback when no database is
 * configured (mirroring the scope store).
 */
export default class SyncAppliedSequenceStore {
    /**
     * Creates an applied-sequence store.
     * @param {object} args - Options.
     * @param {import("../configuration.js").default} args.configuration - Configuration owning the database.
     * @param {string} [args.databaseIdentifier] - Database identifier.
     * @param {import("../tenants/tenant-handle.js").default} [args.tenantHandle] - Immutable tenant handle owning the physical store.
     */
    constructor({ configuration, databaseIdentifier = "default", tenantHandle }) {
        if (tenantHandle)
            tenantHandle.assertConfiguration(configuration);
        this.configuration = configuration;
        this.databaseIdentifier = databaseIdentifier;
        this.tenantHandle = tenantHandle;
        this.storeIdentity = tenantHandle
            ? tenantHandle.databaseIdentity(databaseIdentifier)
            : `configuration:${databaseIdentifier}`;
        /** @type {Map<string, number>} */
        this._memorySequences = new Map();
        /** @type {Map<string, Promise<void>>} */
        this._writeQueues = new Map();
        this._isReady = false;
        /** @type {Promise<void> | null} */
        this._readyPromise = null;
        /** @type {WeakMap<import("../database/drivers/base.js").default, {completion: Promise<void>, promise: Promise<void>}>} */
        this._transactionReadyPromises = new WeakMap();
    }
    /**
     * Ensures the backing table exists.
     * @returns {Promise<void>} Resolves when ready.
     */
    async ensureReady() {
        if (this._isReady)
            return;
        if (this._usesMemoryStorage()) {
            this._isReady = true;
            return;
        }
        await this._withDb(async (db) => await this._ensureReadyWithDb(db));
    }
    /**
     * Returns the highest server sequence already applied to a record.
     * @param {{resourceType: string, resourceId: string}} identity - Resource identity.
     * @returns {Promise<number | null>} Applied sequence, or null when none is recorded.
     */
    async lastAppliedSequence(identity) {
        await this.ensureReady();
        if (this._usesMemoryStorage()) {
            return this._memorySequences.get(memoryKey(identity)) ?? null;
        }
        return await this._withDb(async (db) => {
            const row = await this._rowByResource(db, identity);
            return row ? row.serverSequence : null;
        });
    }
    /**
     * Records a successfully applied server sequence for a record, keeping only
     * the highest value. Writes for the same record are serialized in-process so
     * concurrent pull/realtime applies cannot move the watermark backwards.
     * @param {{resourceType: string, resourceId: string, serverSequence: number}} args - Applied change identity and sequence.
     * @returns {Promise<void>} Resolves when recorded.
     */
    async recordAppliedSequence({ resourceId, resourceType, serverSequence }) {
        await this.ensureReady();
        const identity = { resourceId, resourceType };
        const key = memoryKey(identity);
        const previousWrite = this._writeQueues.get(key) || Promise.resolve();
        const write = previousWrite
            .then(async () => await this._recordSequential({ identity, key, serverSequence }))
            .finally(() => {
            if (this._writeQueues.get(key) === write)
                this._writeQueues.delete(key);
        });
        this._writeQueues.set(key, write);
        await write;
    }
    /**
     * Applies one serialized watermark write.
     * @param {{identity: {resourceType: string, resourceId: string}, key: string, serverSequence: number}} args - Write args.
     * @returns {Promise<void>} Resolves when written.
     */
    async _recordSequential({ identity, key, serverSequence }) {
        const currentSequence = await this.lastAppliedSequence(identity);
        if (currentSequence !== null && currentSequence >= serverSequence)
            return;
        if (this._usesMemoryStorage()) {
            this._memorySequences.set(key, serverSequence);
            return;
        }
        await this._withDb(async (db) => {
            await db.upsert({
                conflictColumns: ["resource_type", "resource_id"],
                data: {
                    created_at: new Date(),
                    id: new UUID(4).format(),
                    resource_id: identity.resourceId,
                    resource_type: identity.resourceType,
                    server_sequence: serverSequence,
                    updated_at: new Date()
                },
                tableName: TABLE_NAME,
                updateColumns: ["server_sequence", "updated_at"]
            });
        });
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
            const tableReadyPromise = this._ensureTable(db);
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
        this._readyPromise = this._ensureTable(db).then(() => {
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
     * Whether the store runs without a configured database.
     * @returns {boolean} Whether memory storage is used.
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
     * Runs a callback with a database connection.
     * @template Result
     * @param {(db: import("../database/drivers/base.js").default) => Promise<Result>} callback - Database callback.
     * @returns {Promise<Result>} Callback result.
     */
    async _withDb(callback) {
        if (this.tenantHandle) {
            return await this.tenantHandle.databaseOperation({ databaseIdentifier: this.databaseIdentifier, name: "Tenant sync applied-sequence store" }, async (operation) => {
                return await callback(operation.connection());
            });
        }
        return await this.configuration.ensureConnections({ databaseIdentifiers: [this.databaseIdentifier], name: "Sync applied-sequence store" }, async (dbs) => {
            const db = dbs[this.databaseIdentifier];
            if (!db)
                throw new Error(`No database connection available for identifier: ${this.databaseIdentifier}`);
            return await callback(db);
        });
    }
    /**
     * Ensures the applied-sequences table exists.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<boolean>} Whether the table had to be created.
     */
    async _ensureTable(db) {
        if (await db.tableExists(TABLE_NAME))
            return false;
        const table = new TableData(TABLE_NAME, { ifNotExists: true });
        table.string("id", { null: false, primaryKey: true });
        table.string("resource_type", { null: false });
        table.string("resource_id", { null: false });
        table.bigint("server_sequence", { null: false });
        table.datetime("created_at", { null: false });
        table.datetime("updated_at", { null: false });
        table.addIndex(new TableIndex(["resource_type", "resource_id"], { name: IDENTITY_INDEX_NAME, unique: true }));
        await db.createTable(table);
        return true;
    }
    /**
     * Resolves the stored row for one resource identity.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {{resourceType: string, resourceId: string}} identity - Resource identity.
     * @returns {Promise<SyncAppliedSequenceRow | null>} Stored row, or null.
     */
    async _rowByResource(db, identity) {
        const rows = /** @type {Array<Record<string, ReturnType<typeof JSON.parse>>>} */ (await db
            .newQuery()
            .from(TABLE_NAME)
            .where({ resource_id: identity.resourceId, resource_type: identity.resourceType })
            .limit(1)
            .results());
        const row = rows[0];
        if (!row)
            return null;
        return {
            resourceId: String(row.resource_id),
            resourceType: String(row.resource_type),
            serverSequence: Number(row.server_sequence),
            storeIdentity: this.storeIdentity
        };
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3luYy1hcHBsaWVkLXNlcXVlbmNlLXN0b3JlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3N5bmMvc3luYy1hcHBsaWVkLXNlcXVlbmNlLXN0b3JlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLFNBQVMsTUFBTSxpQ0FBaUMsQ0FBQTtBQUN2RCxPQUFPLFVBQVUsTUFBTSx1Q0FBdUMsQ0FBQTtBQUM5RCxPQUFPLElBQUksTUFBTSxXQUFXLENBQUE7QUFFNUI7Ozs7OztHQU1HO0FBQ0gsTUFBTSxVQUFVLEdBQUcsa0NBQWtDLENBQUE7QUFDckQsTUFBTSxtQkFBbUIsR0FBRyxvREFBb0QsQ0FBQTtBQUVoRjs7OztHQUlHO0FBQ0gsU0FBUyxTQUFTLENBQUMsRUFBQyxVQUFVLEVBQUUsWUFBWSxFQUFDO0lBQzNDLE9BQU8sR0FBRyxZQUFZLElBQUksVUFBVSxFQUFFLENBQUE7QUFDeEMsQ0FBQztBQUVEOzs7Ozs7Ozs7Ozs7Ozs7R0FlRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8sd0JBQXdCO0lBQzNDOzs7Ozs7T0FNRztJQUNILFlBQVksRUFBQyxhQUFhLEVBQUUsa0JBQWtCLEdBQUcsU0FBUyxFQUFFLFlBQVksRUFBQztRQUN2RSxJQUFJLFlBQVk7WUFBRSxZQUFZLENBQUMsbUJBQW1CLENBQUMsYUFBYSxDQUFDLENBQUE7UUFFakUsSUFBSSxDQUFDLGFBQWEsR0FBRyxhQUFhLENBQUE7UUFDbEMsSUFBSSxDQUFDLGtCQUFrQixHQUFHLGtCQUFrQixDQUFBO1FBQzVDLElBQUksQ0FBQyxZQUFZLEdBQUcsWUFBWSxDQUFBO1FBQ2hDLElBQUksQ0FBQyxhQUFhLEdBQUcsWUFBWTtZQUMvQixDQUFDLENBQUMsWUFBWSxDQUFDLGdCQUFnQixDQUFDLGtCQUFrQixDQUFDO1lBQ25ELENBQUMsQ0FBQyxpQkFBaUIsa0JBQWtCLEVBQUUsQ0FBQTtRQUN6QyxrQ0FBa0M7UUFDbEMsSUFBSSxDQUFDLGdCQUFnQixHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7UUFDakMseUNBQXlDO1FBQ3pDLElBQUksQ0FBQyxZQUFZLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQTtRQUM3QixJQUFJLENBQUMsUUFBUSxHQUFHLEtBQUssQ0FBQTtRQUNyQixtQ0FBbUM7UUFDbkMsSUFBSSxDQUFDLGFBQWEsR0FBRyxJQUFJLENBQUE7UUFDekIsMEhBQTBIO1FBQzFILElBQUksQ0FBQyx5QkFBeUIsR0FBRyxJQUFJLE9BQU8sRUFBRSxDQUFBO0lBQ2hELENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLLENBQUMsV0FBVztRQUNmLElBQUksSUFBSSxDQUFDLFFBQVE7WUFBRSxPQUFNO1FBRXpCLElBQUksSUFBSSxDQUFDLGtCQUFrQixFQUFFLEVBQUUsQ0FBQztZQUM5QixJQUFJLENBQUMsUUFBUSxHQUFHLElBQUksQ0FBQTtZQUNwQixPQUFNO1FBQ1IsQ0FBQztRQUVELE1BQU0sSUFBSSxDQUFDLE9BQU8sQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEVBQUUsQ0FBQyxNQUFNLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFBO0lBQ3JFLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLG1CQUFtQixDQUFDLFFBQVE7UUFDaEMsTUFBTSxJQUFJLENBQUMsV0FBVyxFQUFFLENBQUE7UUFFeEIsSUFBSSxJQUFJLENBQUMsa0JBQWtCLEVBQUUsRUFBRSxDQUFDO1lBQzlCLE9BQU8sSUFBSSxDQUFDLGdCQUFnQixDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUMsUUFBUSxDQUFDLENBQUMsSUFBSSxJQUFJLENBQUE7UUFDL0QsQ0FBQztRQUVELE9BQU8sTUFBTSxJQUFJLENBQUMsT0FBTyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsRUFBRTtZQUNyQyxNQUFNLEdBQUcsR0FBRyxNQUFNLElBQUksQ0FBQyxjQUFjLENBQUMsRUFBRSxFQUFFLFFBQVEsQ0FBQyxDQUFBO1lBRW5ELE9BQU8sR0FBRyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsY0FBYyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUE7UUFDeEMsQ0FBQyxDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsS0FBSyxDQUFDLHFCQUFxQixDQUFDLEVBQUMsVUFBVSxFQUFFLFlBQVksRUFBRSxjQUFjLEVBQUM7UUFDcEUsTUFBTSxJQUFJLENBQUMsV0FBVyxFQUFFLENBQUE7UUFFeEIsTUFBTSxRQUFRLEdBQUcsRUFBQyxVQUFVLEVBQUUsWUFBWSxFQUFDLENBQUE7UUFDM0MsTUFBTSxHQUFHLEdBQUcsU0FBUyxDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBQy9CLE1BQU0sYUFBYSxHQUFHLElBQUksQ0FBQyxZQUFZLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxJQUFJLE9BQU8sQ0FBQyxPQUFPLEVBQUUsQ0FBQTtRQUNyRSxNQUFNLEtBQUssR0FBRyxhQUFhO2FBQ3hCLElBQUksQ0FBQyxLQUFLLElBQUksRUFBRSxDQUFDLE1BQU0sSUFBSSxDQUFDLGlCQUFpQixDQUFDLEVBQUMsUUFBUSxFQUFFLEdBQUcsRUFBRSxjQUFjLEVBQUMsQ0FBQyxDQUFDO2FBQy9FLE9BQU8sQ0FBQyxHQUFHLEVBQUU7WUFDWixJQUFJLElBQUksQ0FBQyxZQUFZLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxLQUFLLEtBQUs7Z0JBQUUsSUFBSSxDQUFDLFlBQVksQ0FBQyxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUE7UUFDekUsQ0FBQyxDQUFDLENBQUE7UUFFSixJQUFJLENBQUMsWUFBWSxDQUFDLEdBQUcsQ0FBQyxHQUFHLEVBQUUsS0FBSyxDQUFDLENBQUE7UUFDakMsTUFBTSxLQUFLLENBQUE7SUFDYixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxpQkFBaUIsQ0FBQyxFQUFDLFFBQVEsRUFBRSxHQUFHLEVBQUUsY0FBYyxFQUFDO1FBQ3JELE1BQU0sZUFBZSxHQUFHLE1BQU0sSUFBSSxDQUFDLG1CQUFtQixDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBRWhFLElBQUksZUFBZSxLQUFLLElBQUksSUFBSSxlQUFlLElBQUksY0FBYztZQUFFLE9BQU07UUFFekUsSUFBSSxJQUFJLENBQUMsa0JBQWtCLEVBQUUsRUFBRSxDQUFDO1lBQzlCLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxHQUFHLENBQUMsR0FBRyxFQUFFLGNBQWMsQ0FBQyxDQUFBO1lBQzlDLE9BQU07UUFDUixDQUFDO1FBRUQsTUFBTSxJQUFJLENBQUMsT0FBTyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsRUFBRTtZQUM5QixNQUFNLEVBQUUsQ0FBQyxNQUFNLENBQUM7Z0JBQ2QsZUFBZSxFQUFFLENBQUMsZUFBZSxFQUFFLGFBQWEsQ0FBQztnQkFDakQsSUFBSSxFQUFFO29CQUNKLFVBQVUsRUFBRSxJQUFJLElBQUksRUFBRTtvQkFDdEIsRUFBRSxFQUFFLElBQUksSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sRUFBRTtvQkFDeEIsV0FBVyxFQUFFLFFBQVEsQ0FBQyxVQUFVO29CQUNoQyxhQUFhLEVBQUUsUUFBUSxDQUFDLFlBQVk7b0JBQ3BDLGVBQWUsRUFBRSxjQUFjO29CQUMvQixVQUFVLEVBQUUsSUFBSSxJQUFJLEVBQUU7aUJBQ3ZCO2dCQUNELFNBQVMsRUFBRSxVQUFVO2dCQUNyQixhQUFhLEVBQUUsQ0FBQyxpQkFBaUIsRUFBRSxZQUFZLENBQUM7YUFDakQsQ0FBQyxDQUFBO1FBQ0osQ0FBQyxDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxrQkFBa0IsQ0FBQyxFQUFFO1FBQ3pCLElBQUksSUFBSSxDQUFDLFFBQVE7WUFBRSxPQUFNO1FBRXpCLE1BQU0scUJBQXFCLEdBQUcsRUFBRSxDQUFDLGlCQUFpQixFQUFFLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxxQkFBcUIsRUFBRSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUE7UUFDeEYsTUFBTSxnQkFBZ0IsR0FBRyxJQUFJLENBQUMseUJBQXlCLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxDQUFBO1FBRS9ELElBQUkscUJBQXFCLElBQUksZ0JBQWdCLEVBQUUsVUFBVSxLQUFLLHFCQUFxQixFQUFFLENBQUM7WUFDcEYsTUFBTSxnQkFBZ0IsQ0FBQyxPQUFPLENBQUE7WUFDOUIsT0FBTTtRQUNSLENBQUM7UUFFRCxJQUFJLElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQztZQUN2QixNQUFNLFlBQVksR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFBO1lBRXZDLE1BQU0sWUFBWSxDQUFBO1lBQ2xCLElBQUksSUFBSSxDQUFDLGFBQWEsS0FBSyxZQUFZO2dCQUFFLElBQUksQ0FBQyxhQUFhLEdBQUcsSUFBSSxDQUFBO1lBQ2xFLElBQUksSUFBSSxDQUFDLFFBQVE7Z0JBQUUsT0FBTTtZQUV6QixNQUFNLElBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQTtZQUN4QixPQUFNO1FBQ1IsQ0FBQztRQUVELElBQUkscUJBQXFCLEVBQUUsQ0FBQztZQUMxQixNQUFNLGlCQUFpQixHQUFHLElBQUksQ0FBQyxZQUFZLENBQUMsRUFBRSxDQUFDLENBQUE7WUFDL0MsTUFBTSx1QkFBdUIsR0FBRyxpQkFBaUIsQ0FBQyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUMsU0FBUyxDQUFDLENBQUE7WUFFdkUsTUFBTSxtQkFBbUIsR0FBRyxpQkFBaUIsQ0FBQyxJQUFJLENBQUMsS0FBSyxFQUFFLE9BQU8sRUFBRSxFQUFFO2dCQUNuRSxJQUFJLENBQUMsT0FBTyxFQUFFLENBQUM7b0JBQ2IsSUFBSSxDQUFDLFFBQVEsR0FBRyxJQUFJLENBQUE7b0JBQ3BCLE9BQU07Z0JBQ1IsQ0FBQztnQkFFRCxNQUFNLHFCQUFxQixDQUFBO1lBQzdCLENBQUMsQ0FBQyxDQUFBO1lBRUYsSUFBSSxDQUFDLHlCQUF5QixDQUFDLEdBQUcsQ0FBQyxFQUFFLEVBQUUsRUFBQyxVQUFVLEVBQUUscUJBQXFCLEVBQUUsT0FBTyxFQUFFLHVCQUF1QixFQUFDLENBQUMsQ0FBQTtZQUM3RyxJQUFJLENBQUMsYUFBYSxHQUFHLG1CQUFtQixDQUFBO1lBQ3hDLE1BQU0sdUJBQXVCLENBQUE7WUFDN0IsT0FBTTtRQUNSLENBQUM7UUFFRCxJQUFJLENBQUMsYUFBYSxHQUFHLElBQUksQ0FBQyxZQUFZLENBQUMsRUFBRSxDQUFDLENBQUMsSUFBSSxDQUFDLEdBQUcsRUFBRTtZQUNuRCxJQUFJLENBQUMsUUFBUSxHQUFHLElBQUksQ0FBQTtRQUN0QixDQUFDLENBQUMsQ0FBQTtRQUVGLElBQUksQ0FBQztZQUNILE1BQU0sSUFBSSxDQUFDLGFBQWEsQ0FBQTtRQUMxQixDQUFDO2dCQUFTLENBQUM7WUFDVCxJQUFJLENBQUMsSUFBSSxDQUFDLFFBQVE7Z0JBQUUsSUFBSSxDQUFDLGFBQWEsR0FBRyxJQUFJLENBQUE7UUFDL0MsQ0FBQztJQUNILENBQUM7SUFFRDs7O09BR0c7SUFDSCxrQkFBa0I7UUFDaEIsSUFBSSxDQUFDO1lBQ0gsT0FBTyxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsd0JBQXdCLEVBQUUsQ0FBQyxJQUFJLENBQUMsa0JBQWtCLENBQUMsQ0FBQTtRQUNoRixDQUFDO1FBQUMsTUFBTSxDQUFDO1lBQ1AsT0FBTyxJQUFJLENBQUE7UUFDYixDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsS0FBSyxDQUFDLE9BQU8sQ0FBQyxRQUFRO1FBQ3BCLElBQUksSUFBSSxDQUFDLFlBQVksRUFBRSxDQUFDO1lBQ3RCLE9BQU8sTUFBTSxJQUFJLENBQUMsWUFBWSxDQUFDLGlCQUFpQixDQUFDLEVBQUMsa0JBQWtCLEVBQUUsSUFBSSxDQUFDLGtCQUFrQixFQUFFLElBQUksRUFBRSxvQ0FBb0MsRUFBQyxFQUFFLEtBQUssRUFBRSxTQUFTLEVBQUUsRUFBRTtnQkFDOUosT0FBTyxNQUFNLFFBQVEsQ0FBQyxTQUFTLENBQUMsVUFBVSxFQUFFLENBQUMsQ0FBQTtZQUMvQyxDQUFDLENBQUMsQ0FBQTtRQUNKLENBQUM7UUFFRCxPQUFPLE1BQU0sSUFBSSxDQUFDLGFBQWEsQ0FBQyxpQkFBaUIsQ0FBQyxFQUFDLG1CQUFtQixFQUFFLENBQUMsSUFBSSxDQUFDLGtCQUFrQixDQUFDLEVBQUUsSUFBSSxFQUFFLDZCQUE2QixFQUFDLEVBQUUsS0FBSyxFQUFFLEdBQUcsRUFBRSxFQUFFO1lBQ3JKLE1BQU0sRUFBRSxHQUFHLEdBQUcsQ0FBQyxJQUFJLENBQUMsa0JBQWtCLENBQUMsQ0FBQTtZQUV2QyxJQUFJLENBQUMsRUFBRTtnQkFBRSxNQUFNLElBQUksS0FBSyxDQUFDLG9EQUFvRCxJQUFJLENBQUMsa0JBQWtCLEVBQUUsQ0FBQyxDQUFBO1lBRXZHLE9BQU8sTUFBTSxRQUFRLENBQUMsRUFBRSxDQUFDLENBQUE7UUFDM0IsQ0FBQyxDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxZQUFZLENBQUMsRUFBRTtRQUNuQixJQUFJLE1BQU0sRUFBRSxDQUFDLFdBQVcsQ0FBQyxVQUFVLENBQUM7WUFBRSxPQUFPLEtBQUssQ0FBQTtRQUVsRCxNQUFNLEtBQUssR0FBRyxJQUFJLFNBQVMsQ0FBQyxVQUFVLEVBQUUsRUFBQyxXQUFXLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQTtRQUU1RCxLQUFLLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRSxFQUFDLElBQUksRUFBRSxLQUFLLEVBQUUsVUFBVSxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7UUFDbkQsS0FBSyxDQUFDLE1BQU0sQ0FBQyxlQUFlLEVBQUUsRUFBQyxJQUFJLEVBQUUsS0FBSyxFQUFDLENBQUMsQ0FBQTtRQUM1QyxLQUFLLENBQUMsTUFBTSxDQUFDLGFBQWEsRUFBRSxFQUFDLElBQUksRUFBRSxLQUFLLEVBQUMsQ0FBQyxDQUFBO1FBQzFDLEtBQUssQ0FBQyxNQUFNLENBQUMsaUJBQWlCLEVBQUUsRUFBQyxJQUFJLEVBQUUsS0FBSyxFQUFDLENBQUMsQ0FBQTtRQUM5QyxLQUFLLENBQUMsUUFBUSxDQUFDLFlBQVksRUFBRSxFQUFDLElBQUksRUFBRSxLQUFLLEVBQUMsQ0FBQyxDQUFBO1FBQzNDLEtBQUssQ0FBQyxRQUFRLENBQUMsWUFBWSxFQUFFLEVBQUMsSUFBSSxFQUFFLEtBQUssRUFBQyxDQUFDLENBQUE7UUFDM0MsS0FBSyxDQUFDLFFBQVEsQ0FBQyxJQUFJLFVBQVUsQ0FBQyxDQUFDLGVBQWUsRUFBRSxhQUFhLENBQUMsRUFBRSxFQUFDLElBQUksRUFBRSxtQkFBbUIsRUFBRSxNQUFNLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQyxDQUFBO1FBRTNHLE1BQU0sRUFBRSxDQUFDLFdBQVcsQ0FBQyxLQUFLLENBQUMsQ0FBQTtRQUUzQixPQUFPLElBQUksQ0FBQTtJQUNiLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILEtBQUssQ0FBQyxjQUFjLENBQUMsRUFBRSxFQUFFLFFBQVE7UUFDL0IsTUFBTSxJQUFJLEdBQUcsbUVBQW1FLENBQUMsQ0FBQyxNQUFNLEVBQUU7YUFDdkYsUUFBUSxFQUFFO2FBQ1YsSUFBSSxDQUFDLFVBQVUsQ0FBQzthQUNoQixLQUFLLENBQUMsRUFBQyxXQUFXLEVBQUUsUUFBUSxDQUFDLFVBQVUsRUFBRSxhQUFhLEVBQUUsUUFBUSxDQUFDLFlBQVksRUFBQyxDQUFDO2FBQy9FLEtBQUssQ0FBQyxDQUFDLENBQUM7YUFDUixPQUFPLEVBQUUsQ0FBQyxDQUFBO1FBRWIsTUFBTSxHQUFHLEdBQUcsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFBO1FBRW5CLElBQUksQ0FBQyxHQUFHO1lBQUUsT0FBTyxJQUFJLENBQUE7UUFFckIsT0FBTztZQUNMLFVBQVUsRUFBRSxNQUFNLENBQUMsR0FBRyxDQUFDLFdBQVcsQ0FBQztZQUNuQyxZQUFZLEVBQUUsTUFBTSxDQUFDLEdBQUcsQ0FBQyxhQUFhLENBQUM7WUFDdkMsY0FBYyxFQUFFLE1BQU0sQ0FBQyxHQUFHLENBQUMsZUFBZSxDQUFDO1lBQzNDLGFBQWEsRUFBRSxJQUFJLENBQUMsYUFBYTtTQUNsQyxDQUFBO0lBQ0gsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBUYWJsZURhdGEgZnJvbSBcIi4uL2RhdGFiYXNlL3RhYmxlLWRhdGEvaW5kZXguanNcIlxuaW1wb3J0IFRhYmxlSW5kZXggZnJvbSBcIi4uL2RhdGFiYXNlL3RhYmxlLWRhdGEvdGFibGUtaW5kZXguanNcIlxuaW1wb3J0IFVVSUQgZnJvbSBcInB1cmUtdXVpZFwiXG5cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gU3luY0FwcGxpZWRTZXF1ZW5jZVJvd1xuICogQHByb3BlcnR5IHtzdHJpbmd9IHJlc291cmNlSWQgLSBSZXNvdXJjZSBpZGVudGlmaWVyIHRoZSBjaGFuZ2UgYXBwbGllZCB0by5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSByZXNvdXJjZVR5cGUgLSBSZXNvdXJjZS9tb2RlbCBuYW1lIHRoZSBjaGFuZ2UgYXBwbGllZCB0by5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBzZXJ2ZXJTZXF1ZW5jZSAtIEhpZ2hlc3QgYXBwbGllZCBzZXJ2ZXIgc2VxdWVuY2UgZm9yIHRoZSByZXNvdXJjZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBzdG9yZUlkZW50aXR5IC0gUGh5c2ljYWwgc3RvcmUgaWRlbnRpdHkgb3duaW5nIHRoaXMgcm93LlxuICovXG5jb25zdCBUQUJMRV9OQU1FID0gXCJ2ZWxvY2lvdXNfc3luY19hcHBsaWVkX3NlcXVlbmNlc1wiXG5jb25zdCBJREVOVElUWV9JTkRFWF9OQU1FID0gXCJpbmRleF92ZWxvY2lvdXNfc3luY19hcHBsaWVkX3NlcXVlbmNlc19vbl9pZGVudGl0eVwiXG5cbi8qKlxuICogQnVpbGRzIHRoZSBzdGFibGUgaW4tbWVtb3J5IGtleSBmb3Igb25lIHJlc291cmNlIGlkZW50aXR5LlxuICogQHBhcmFtIHt7cmVzb3VyY2VUeXBlOiBzdHJpbmcsIHJlc291cmNlSWQ6IHN0cmluZ319IGFyZ3MgLSBSZXNvdXJjZSBpZGVudGl0eS5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IE1lbW9yeSBrZXkuXG4gKi9cbmZ1bmN0aW9uIG1lbW9yeUtleSh7cmVzb3VyY2VJZCwgcmVzb3VyY2VUeXBlfSkge1xuICByZXR1cm4gYCR7cmVzb3VyY2VUeXBlfToke3Jlc291cmNlSWR9YFxufVxuXG4vKipcbiAqIEZyYW1ld29yay1vd25lZCBsb2NhbCBib29ra2VlcGluZyBvZiB0aGUgbmV3ZXN0IHNlcnZlciBjaGFuZ2Ugc2VxdWVuY2VcbiAqIGFscmVhZHkgYXBwbGllZCB0byBlYWNoIHJlY29yZC5cbiAqXG4gKiBUaGUgc2VydmVyIGNoYW5nZSBmZWVkIGlzIGF0LWxlYXN0LW9uY2U6IGEgcmVhbHRpbWUgcHVzaCBkb2VzIG5vdCBhZHZhbmNlIGFcbiAqIHB1bGwgY3Vyc29yLCBzbyB0aGUgbmV4dCBwdWxsIHJlLWRlbGl2ZXJzIHRoZSBzYW1lIGBzZXJ2ZXJTZXF1ZW5jZWAsIGFuZCBhXG4gKiByZXN1bWVkIHBhZ2UgY2FuIHJlcGVhdCBhIHJvdy4gQXBwbHlpbmcgc3VjaCBhIGR1cGxpY2F0ZSBhZnRlciBhIG5ld2VyIGxvY2FsXG4gKiBwcm92aXNpb25hbCB3cml0ZSB1c2VkIHRvIGxldCB0aGUgb2xkZXIgc2VydmVyIHBheWxvYWQgd2luLiBUcmFja2luZyB0aGVcbiAqIGhpZ2hlc3QgYXBwbGllZCBzZXF1ZW5jZSBwZXIgcmVjb3JkIG1ha2VzIHRoZSBhcHBsaWVyIGlkZW1wb3RlbnQ6IGEgY2hhbmdlIGF0XG4gKiBvciBiZWxvdyB0aGUgcmVjb3JkZWQgc2VxdWVuY2UgaXMgc2tpcHBlZCwgd2hpbGUgYW55IGhpZ2hlciBzZXF1ZW5jZSBzdGlsbFxuICogYXBwbGllcy5cbiAqXG4gKiBCYWNrZWQgYnkgYW4gYXV0by1jcmVhdGVkIGB2ZWxvY2lvdXNfc3luY19hcHBsaWVkX3NlcXVlbmNlc2AgdGFibGUgb24gdGhlXG4gKiBjb25maWd1cmVkIGRhdGFiYXNlLCB3aXRoIGEgcHJvY2Vzcy1sb2NhbCBtZW1vcnkgZmFsbGJhY2sgd2hlbiBubyBkYXRhYmFzZSBpc1xuICogY29uZmlndXJlZCAobWlycm9yaW5nIHRoZSBzY29wZSBzdG9yZSkuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFN5bmNBcHBsaWVkU2VxdWVuY2VTdG9yZSB7XG4gIC8qKlxuICAgKiBDcmVhdGVzIGFuIGFwcGxpZWQtc2VxdWVuY2Ugc3RvcmUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGFyZ3MuY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gb3duaW5nIHRoZSBkYXRhYmFzZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmRhdGFiYXNlSWRlbnRpZmllcl0gLSBEYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3RlbmFudHMvdGVuYW50LWhhbmRsZS5qc1wiKS5kZWZhdWx0fSBbYXJncy50ZW5hbnRIYW5kbGVdIC0gSW1tdXRhYmxlIHRlbmFudCBoYW5kbGUgb3duaW5nIHRoZSBwaHlzaWNhbCBzdG9yZS5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtjb25maWd1cmF0aW9uLCBkYXRhYmFzZUlkZW50aWZpZXIgPSBcImRlZmF1bHRcIiwgdGVuYW50SGFuZGxlfSkge1xuICAgIGlmICh0ZW5hbnRIYW5kbGUpIHRlbmFudEhhbmRsZS5hc3NlcnRDb25maWd1cmF0aW9uKGNvbmZpZ3VyYXRpb24pXG5cbiAgICB0aGlzLmNvbmZpZ3VyYXRpb24gPSBjb25maWd1cmF0aW9uXG4gICAgdGhpcy5kYXRhYmFzZUlkZW50aWZpZXIgPSBkYXRhYmFzZUlkZW50aWZpZXJcbiAgICB0aGlzLnRlbmFudEhhbmRsZSA9IHRlbmFudEhhbmRsZVxuICAgIHRoaXMuc3RvcmVJZGVudGl0eSA9IHRlbmFudEhhbmRsZVxuICAgICAgPyB0ZW5hbnRIYW5kbGUuZGF0YWJhc2VJZGVudGl0eShkYXRhYmFzZUlkZW50aWZpZXIpXG4gICAgICA6IGBjb25maWd1cmF0aW9uOiR7ZGF0YWJhc2VJZGVudGlmaWVyfWBcbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIG51bWJlcj59ICovXG4gICAgdGhpcy5fbWVtb3J5U2VxdWVuY2VzID0gbmV3IE1hcCgpXG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBQcm9taXNlPHZvaWQ+Pn0gKi9cbiAgICB0aGlzLl93cml0ZVF1ZXVlcyA9IG5ldyBNYXAoKVxuICAgIHRoaXMuX2lzUmVhZHkgPSBmYWxzZVxuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPiB8IG51bGx9ICovXG4gICAgdGhpcy5fcmVhZHlQcm9taXNlID0gbnVsbFxuICAgIC8qKiBAdHlwZSB7V2Vha01hcDxpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCwge2NvbXBsZXRpb246IFByb21pc2U8dm9pZD4sIHByb21pc2U6IFByb21pc2U8dm9pZD59Pn0gKi9cbiAgICB0aGlzLl90cmFuc2FjdGlvblJlYWR5UHJvbWlzZXMgPSBuZXcgV2Vha01hcCgpXG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyB0aGUgYmFja2luZyB0YWJsZSBleGlzdHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyB3aGVuIHJlYWR5LlxuICAgKi9cbiAgYXN5bmMgZW5zdXJlUmVhZHkoKSB7XG4gICAgaWYgKHRoaXMuX2lzUmVhZHkpIHJldHVyblxuXG4gICAgaWYgKHRoaXMuX3VzZXNNZW1vcnlTdG9yYWdlKCkpIHtcbiAgICAgIHRoaXMuX2lzUmVhZHkgPSB0cnVlXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiBhd2FpdCB0aGlzLl9lbnN1cmVSZWFkeVdpdGhEYihkYikpXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgaGlnaGVzdCBzZXJ2ZXIgc2VxdWVuY2UgYWxyZWFkeSBhcHBsaWVkIHRvIGEgcmVjb3JkLlxuICAgKiBAcGFyYW0ge3tyZXNvdXJjZVR5cGU6IHN0cmluZywgcmVzb3VyY2VJZDogc3RyaW5nfX0gaWRlbnRpdHkgLSBSZXNvdXJjZSBpZGVudGl0eS5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyIHwgbnVsbD59IEFwcGxpZWQgc2VxdWVuY2UsIG9yIG51bGwgd2hlbiBub25lIGlzIHJlY29yZGVkLlxuICAgKi9cbiAgYXN5bmMgbGFzdEFwcGxpZWRTZXF1ZW5jZShpZGVudGl0eSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgaWYgKHRoaXMuX3VzZXNNZW1vcnlTdG9yYWdlKCkpIHtcbiAgICAgIHJldHVybiB0aGlzLl9tZW1vcnlTZXF1ZW5jZXMuZ2V0KG1lbW9yeUtleShpZGVudGl0eSkpID8/IG51bGxcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3Qgcm93ID0gYXdhaXQgdGhpcy5fcm93QnlSZXNvdXJjZShkYiwgaWRlbnRpdHkpXG5cbiAgICAgIHJldHVybiByb3cgPyByb3cuc2VydmVyU2VxdWVuY2UgOiBudWxsXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmRzIGEgc3VjY2Vzc2Z1bGx5IGFwcGxpZWQgc2VydmVyIHNlcXVlbmNlIGZvciBhIHJlY29yZCwga2VlcGluZyBvbmx5XG4gICAqIHRoZSBoaWdoZXN0IHZhbHVlLiBXcml0ZXMgZm9yIHRoZSBzYW1lIHJlY29yZCBhcmUgc2VyaWFsaXplZCBpbi1wcm9jZXNzIHNvXG4gICAqIGNvbmN1cnJlbnQgcHVsbC9yZWFsdGltZSBhcHBsaWVzIGNhbm5vdCBtb3ZlIHRoZSB3YXRlcm1hcmsgYmFja3dhcmRzLlxuICAgKiBAcGFyYW0ge3tyZXNvdXJjZVR5cGU6IHN0cmluZywgcmVzb3VyY2VJZDogc3RyaW5nLCBzZXJ2ZXJTZXF1ZW5jZTogbnVtYmVyfX0gYXJncyAtIEFwcGxpZWQgY2hhbmdlIGlkZW50aXR5IGFuZCBzZXF1ZW5jZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIHdoZW4gcmVjb3JkZWQuXG4gICAqL1xuICBhc3luYyByZWNvcmRBcHBsaWVkU2VxdWVuY2Uoe3Jlc291cmNlSWQsIHJlc291cmNlVHlwZSwgc2VydmVyU2VxdWVuY2V9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICBjb25zdCBpZGVudGl0eSA9IHtyZXNvdXJjZUlkLCByZXNvdXJjZVR5cGV9XG4gICAgY29uc3Qga2V5ID0gbWVtb3J5S2V5KGlkZW50aXR5KVxuICAgIGNvbnN0IHByZXZpb3VzV3JpdGUgPSB0aGlzLl93cml0ZVF1ZXVlcy5nZXQoa2V5KSB8fCBQcm9taXNlLnJlc29sdmUoKVxuICAgIGNvbnN0IHdyaXRlID0gcHJldmlvdXNXcml0ZVxuICAgICAgLnRoZW4oYXN5bmMgKCkgPT4gYXdhaXQgdGhpcy5fcmVjb3JkU2VxdWVudGlhbCh7aWRlbnRpdHksIGtleSwgc2VydmVyU2VxdWVuY2V9KSlcbiAgICAgIC5maW5hbGx5KCgpID0+IHtcbiAgICAgICAgaWYgKHRoaXMuX3dyaXRlUXVldWVzLmdldChrZXkpID09PSB3cml0ZSkgdGhpcy5fd3JpdGVRdWV1ZXMuZGVsZXRlKGtleSlcbiAgICAgIH0pXG5cbiAgICB0aGlzLl93cml0ZVF1ZXVlcy5zZXQoa2V5LCB3cml0ZSlcbiAgICBhd2FpdCB3cml0ZVxuICB9XG5cbiAgLyoqXG4gICAqIEFwcGxpZXMgb25lIHNlcmlhbGl6ZWQgd2F0ZXJtYXJrIHdyaXRlLlxuICAgKiBAcGFyYW0ge3tpZGVudGl0eToge3Jlc291cmNlVHlwZTogc3RyaW5nLCByZXNvdXJjZUlkOiBzdHJpbmd9LCBrZXk6IHN0cmluZywgc2VydmVyU2VxdWVuY2U6IG51bWJlcn19IGFyZ3MgLSBXcml0ZSBhcmdzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgd2hlbiB3cml0dGVuLlxuICAgKi9cbiAgYXN5bmMgX3JlY29yZFNlcXVlbnRpYWwoe2lkZW50aXR5LCBrZXksIHNlcnZlclNlcXVlbmNlfSkge1xuICAgIGNvbnN0IGN1cnJlbnRTZXF1ZW5jZSA9IGF3YWl0IHRoaXMubGFzdEFwcGxpZWRTZXF1ZW5jZShpZGVudGl0eSlcblxuICAgIGlmIChjdXJyZW50U2VxdWVuY2UgIT09IG51bGwgJiYgY3VycmVudFNlcXVlbmNlID49IHNlcnZlclNlcXVlbmNlKSByZXR1cm5cblxuICAgIGlmICh0aGlzLl91c2VzTWVtb3J5U3RvcmFnZSgpKSB7XG4gICAgICB0aGlzLl9tZW1vcnlTZXF1ZW5jZXMuc2V0KGtleSwgc2VydmVyU2VxdWVuY2UpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiB7XG4gICAgICBhd2FpdCBkYi51cHNlcnQoe1xuICAgICAgICBjb25mbGljdENvbHVtbnM6IFtcInJlc291cmNlX3R5cGVcIiwgXCJyZXNvdXJjZV9pZFwiXSxcbiAgICAgICAgZGF0YToge1xuICAgICAgICAgIGNyZWF0ZWRfYXQ6IG5ldyBEYXRlKCksXG4gICAgICAgICAgaWQ6IG5ldyBVVUlEKDQpLmZvcm1hdCgpLFxuICAgICAgICAgIHJlc291cmNlX2lkOiBpZGVudGl0eS5yZXNvdXJjZUlkLFxuICAgICAgICAgIHJlc291cmNlX3R5cGU6IGlkZW50aXR5LnJlc291cmNlVHlwZSxcbiAgICAgICAgICBzZXJ2ZXJfc2VxdWVuY2U6IHNlcnZlclNlcXVlbmNlLFxuICAgICAgICAgIHVwZGF0ZWRfYXQ6IG5ldyBEYXRlKClcbiAgICAgICAgfSxcbiAgICAgICAgdGFibGVOYW1lOiBUQUJMRV9OQU1FLFxuICAgICAgICB1cGRhdGVDb2x1bW5zOiBbXCJzZXJ2ZXJfc2VxdWVuY2VcIiwgXCJ1cGRhdGVkX2F0XCJdXG4gICAgICB9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQ29vcmRpbmF0ZXMgZHVyYWJsZSBhbmQgdHJhbnNhY3Rpb24tbG9jYWwgcmVhZGluZXNzIG9uIG9uZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyB3aGVuIHRoaXMgY2FsbGVyIGNhbiB1c2UgdGhlIHRhYmxlLlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZVJlYWR5V2l0aERiKGRiKSB7XG4gICAgaWYgKHRoaXMuX2lzUmVhZHkpIHJldHVyblxuXG4gICAgY29uc3QgdHJhbnNhY3Rpb25Db21wbGV0aW9uID0gZGIuaW5zaWRlVHJhbnNhY3Rpb24oKSA/IGRiLnRyYW5zYWN0aW9uQ29tcGxldGlvbigpIDogbnVsbFxuICAgIGNvbnN0IHRyYW5zYWN0aW9uUmVhZHkgPSB0aGlzLl90cmFuc2FjdGlvblJlYWR5UHJvbWlzZXMuZ2V0KGRiKVxuXG4gICAgaWYgKHRyYW5zYWN0aW9uQ29tcGxldGlvbiAmJiB0cmFuc2FjdGlvblJlYWR5Py5jb21wbGV0aW9uID09PSB0cmFuc2FjdGlvbkNvbXBsZXRpb24pIHtcbiAgICAgIGF3YWl0IHRyYW5zYWN0aW9uUmVhZHkucHJvbWlzZVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKHRoaXMuX3JlYWR5UHJvbWlzZSkge1xuICAgICAgY29uc3QgcmVhZHlQcm9taXNlID0gdGhpcy5fcmVhZHlQcm9taXNlXG5cbiAgICAgIGF3YWl0IHJlYWR5UHJvbWlzZVxuICAgICAgaWYgKHRoaXMuX3JlYWR5UHJvbWlzZSA9PT0gcmVhZHlQcm9taXNlKSB0aGlzLl9yZWFkeVByb21pc2UgPSBudWxsXG4gICAgICBpZiAodGhpcy5faXNSZWFkeSkgcmV0dXJuXG5cbiAgICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKHRyYW5zYWN0aW9uQ29tcGxldGlvbikge1xuICAgICAgY29uc3QgdGFibGVSZWFkeVByb21pc2UgPSB0aGlzLl9lbnN1cmVUYWJsZShkYilcbiAgICAgIGNvbnN0IHRyYW5zYWN0aW9uUmVhZHlQcm9taXNlID0gdGFibGVSZWFkeVByb21pc2UudGhlbigoKSA9PiB1bmRlZmluZWQpXG5cbiAgICAgIGNvbnN0IGR1cmFibGVSZWFkeVByb21pc2UgPSB0YWJsZVJlYWR5UHJvbWlzZS50aGVuKGFzeW5jIChjcmVhdGVkKSA9PiB7XG4gICAgICAgIGlmICghY3JlYXRlZCkge1xuICAgICAgICAgIHRoaXMuX2lzUmVhZHkgPSB0cnVlXG4gICAgICAgICAgcmV0dXJuXG4gICAgICAgIH1cblxuICAgICAgICBhd2FpdCB0cmFuc2FjdGlvbkNvbXBsZXRpb25cbiAgICAgIH0pXG5cbiAgICAgIHRoaXMuX3RyYW5zYWN0aW9uUmVhZHlQcm9taXNlcy5zZXQoZGIsIHtjb21wbGV0aW9uOiB0cmFuc2FjdGlvbkNvbXBsZXRpb24sIHByb21pc2U6IHRyYW5zYWN0aW9uUmVhZHlQcm9taXNlfSlcbiAgICAgIHRoaXMuX3JlYWR5UHJvbWlzZSA9IGR1cmFibGVSZWFkeVByb21pc2VcbiAgICAgIGF3YWl0IHRyYW5zYWN0aW9uUmVhZHlQcm9taXNlXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0aGlzLl9yZWFkeVByb21pc2UgPSB0aGlzLl9lbnN1cmVUYWJsZShkYikudGhlbigoKSA9PiB7XG4gICAgICB0aGlzLl9pc1JlYWR5ID0gdHJ1ZVxuICAgIH0pXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5fcmVhZHlQcm9taXNlXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGlmICghdGhpcy5faXNSZWFkeSkgdGhpcy5fcmVhZHlQcm9taXNlID0gbnVsbFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIHRoZSBzdG9yZSBydW5zIHdpdGhvdXQgYSBjb25maWd1cmVkIGRhdGFiYXNlLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gV2hldGhlciBtZW1vcnkgc3RvcmFnZSBpcyB1c2VkLlxuICAgKi9cbiAgX3VzZXNNZW1vcnlTdG9yYWdlKCkge1xuICAgIHRyeSB7XG4gICAgICByZXR1cm4gIXRoaXMuY29uZmlndXJhdGlvbi5nZXREYXRhYmFzZUNvbmZpZ3VyYXRpb24oKVt0aGlzLmRhdGFiYXNlSWRlbnRpZmllcl1cbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiB0cnVlXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYSBjYWxsYmFjayB3aXRoIGEgZGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHRlbXBsYXRlIFJlc3VsdFxuICAgKiBAcGFyYW0geyhkYjogaW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQpID0+IFByb21pc2U8UmVzdWx0Pn0gY2FsbGJhY2sgLSBEYXRhYmFzZSBjYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVzdWx0Pn0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgX3dpdGhEYihjYWxsYmFjaykge1xuICAgIGlmICh0aGlzLnRlbmFudEhhbmRsZSkge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMudGVuYW50SGFuZGxlLmRhdGFiYXNlT3BlcmF0aW9uKHtkYXRhYmFzZUlkZW50aWZpZXI6IHRoaXMuZGF0YWJhc2VJZGVudGlmaWVyLCBuYW1lOiBcIlRlbmFudCBzeW5jIGFwcGxpZWQtc2VxdWVuY2Ugc3RvcmVcIn0sIGFzeW5jIChvcGVyYXRpb24pID0+IHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKG9wZXJhdGlvbi5jb25uZWN0aW9uKCkpXG4gICAgICB9KVxuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24uZW5zdXJlQ29ubmVjdGlvbnMoe2RhdGFiYXNlSWRlbnRpZmllcnM6IFt0aGlzLmRhdGFiYXNlSWRlbnRpZmllcl0sIG5hbWU6IFwiU3luYyBhcHBsaWVkLXNlcXVlbmNlIHN0b3JlXCJ9LCBhc3luYyAoZGJzKSA9PiB7XG4gICAgICBjb25zdCBkYiA9IGRic1t0aGlzLmRhdGFiYXNlSWRlbnRpZmllcl1cblxuICAgICAgaWYgKCFkYikgdGhyb3cgbmV3IEVycm9yKGBObyBkYXRhYmFzZSBjb25uZWN0aW9uIGF2YWlsYWJsZSBmb3IgaWRlbnRpZmllcjogJHt0aGlzLmRhdGFiYXNlSWRlbnRpZmllcn1gKVxuXG4gICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soZGIpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBFbnN1cmVzIHRoZSBhcHBsaWVkLXNlcXVlbmNlcyB0YWJsZSBleGlzdHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IFdoZXRoZXIgdGhlIHRhYmxlIGhhZCB0byBiZSBjcmVhdGVkLlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZVRhYmxlKGRiKSB7XG4gICAgaWYgKGF3YWl0IGRiLnRhYmxlRXhpc3RzKFRBQkxFX05BTUUpKSByZXR1cm4gZmFsc2VcblxuICAgIGNvbnN0IHRhYmxlID0gbmV3IFRhYmxlRGF0YShUQUJMRV9OQU1FLCB7aWZOb3RFeGlzdHM6IHRydWV9KVxuXG4gICAgdGFibGUuc3RyaW5nKFwiaWRcIiwge251bGw6IGZhbHNlLCBwcmltYXJ5S2V5OiB0cnVlfSlcbiAgICB0YWJsZS5zdHJpbmcoXCJyZXNvdXJjZV90eXBlXCIsIHtudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuc3RyaW5nKFwicmVzb3VyY2VfaWRcIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5iaWdpbnQoXCJzZXJ2ZXJfc2VxdWVuY2VcIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5kYXRldGltZShcImNyZWF0ZWRfYXRcIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5kYXRldGltZShcInVwZGF0ZWRfYXRcIiwge251bGw6IGZhbHNlfSlcbiAgICB0YWJsZS5hZGRJbmRleChuZXcgVGFibGVJbmRleChbXCJyZXNvdXJjZV90eXBlXCIsIFwicmVzb3VyY2VfaWRcIl0sIHtuYW1lOiBJREVOVElUWV9JTkRFWF9OQU1FLCB1bmlxdWU6IHRydWV9KSlcblxuICAgIGF3YWl0IGRiLmNyZWF0ZVRhYmxlKHRhYmxlKVxuXG4gICAgcmV0dXJuIHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgc3RvcmVkIHJvdyBmb3Igb25lIHJlc291cmNlIGlkZW50aXR5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7e3Jlc291cmNlVHlwZTogc3RyaW5nLCByZXNvdXJjZUlkOiBzdHJpbmd9fSBpZGVudGl0eSAtIFJlc291cmNlIGlkZW50aXR5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxTeW5jQXBwbGllZFNlcXVlbmNlUm93IHwgbnVsbD59IFN0b3JlZCByb3csIG9yIG51bGwuXG4gICAqL1xuICBhc3luYyBfcm93QnlSZXNvdXJjZShkYiwgaWRlbnRpdHkpIHtcbiAgICBjb25zdCByb3dzID0gLyoqIEB0eXBlIHtBcnJheTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAqLyAoYXdhaXQgZGJcbiAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAuZnJvbShUQUJMRV9OQU1FKVxuICAgICAgLndoZXJlKHtyZXNvdXJjZV9pZDogaWRlbnRpdHkucmVzb3VyY2VJZCwgcmVzb3VyY2VfdHlwZTogaWRlbnRpdHkucmVzb3VyY2VUeXBlfSlcbiAgICAgIC5saW1pdCgxKVxuICAgICAgLnJlc3VsdHMoKSlcblxuICAgIGNvbnN0IHJvdyA9IHJvd3NbMF1cblxuICAgIGlmICghcm93KSByZXR1cm4gbnVsbFxuXG4gICAgcmV0dXJuIHtcbiAgICAgIHJlc291cmNlSWQ6IFN0cmluZyhyb3cucmVzb3VyY2VfaWQpLFxuICAgICAgcmVzb3VyY2VUeXBlOiBTdHJpbmcocm93LnJlc291cmNlX3R5cGUpLFxuICAgICAgc2VydmVyU2VxdWVuY2U6IE51bWJlcihyb3cuc2VydmVyX3NlcXVlbmNlKSxcbiAgICAgIHN0b3JlSWRlbnRpdHk6IHRoaXMuc3RvcmVJZGVudGl0eVxuICAgIH1cbiAgfVxufVxuIl19