export type SyncAppliedSequenceRow = {
    /**
     * - Resource identifier the change applied to.
     */
    resourceId: string;
    /**
     * - Resource/model name the change applied to.
     */
    resourceType: string;
    /**
     * - Highest applied server sequence for the resource.
     */
    serverSequence: number;
    /**
     * - Physical store identity owning this row.
     */
    storeIdentity: string;
};
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
    configuration: import("../configuration.js").default;
    databaseIdentifier: string;
    tenantHandle: import("../tenants/tenant-handle.js").default | undefined;
    storeIdentity: string;
    /** @type {Map<string, number>} */
    _memorySequences: Map<string, number>;
    /** @type {Map<string, Promise<void>>} */
    _writeQueues: Map<string, Promise<void>>;
    _isReady: boolean;
    /** @type {Promise<void> | null} */
    _readyPromise: Promise<void> | null;
    /** @type {WeakMap<import("../database/drivers/base.js").default, {completion: Promise<void>, promise: Promise<void>}>} */
    _transactionReadyPromises: WeakMap<import("../database/drivers/base.js").default, {
        completion: Promise<void>;
        promise: Promise<void>;
    }>;
    /**
     * Creates an applied-sequence store.
     * @param {object} args - Options.
     * @param {import("../configuration.js").default} args.configuration - Configuration owning the database.
     * @param {string} [args.databaseIdentifier] - Database identifier.
     * @param {import("../tenants/tenant-handle.js").default} [args.tenantHandle] - Immutable tenant handle owning the physical store.
     */
    constructor({ configuration, databaseIdentifier, tenantHandle }: {
        configuration: import("../configuration.js").default;
        databaseIdentifier?: string;
        tenantHandle?: import("../tenants/tenant-handle.js").default;
    });
    /**
     * Ensures the backing table exists.
     * @returns {Promise<void>} Resolves when ready.
     */
    ensureReady(): Promise<void>;
    /**
     * Returns the highest server sequence already applied to a record.
     * @param {{resourceType: string, resourceId: string}} identity - Resource identity.
     * @returns {Promise<number | null>} Applied sequence, or null when none is recorded.
     */
    lastAppliedSequence(identity: {
        resourceType: string;
        resourceId: string;
    }): Promise<number | null>;
    /**
     * Records a successfully applied server sequence for a record, keeping only
     * the highest value. Writes for the same record are serialized in-process so
     * concurrent pull/realtime applies cannot move the watermark backwards.
     * @param {{resourceType: string, resourceId: string, serverSequence: number}} args - Applied change identity and sequence.
     * @returns {Promise<void>} Resolves when recorded.
     */
    recordAppliedSequence({ resourceId, resourceType, serverSequence }: {
        resourceType: string;
        resourceId: string;
        serverSequence: number;
    }): Promise<void>;
    /**
     * Applies one serialized watermark write.
     * @param {{identity: {resourceType: string, resourceId: string}, key: string, serverSequence: number}} args - Write args.
     * @returns {Promise<void>} Resolves when written.
     */
    _recordSequential({ identity, key, serverSequence }: {
        identity: {
            resourceType: string;
            resourceId: string;
        };
        key: string;
        serverSequence: number;
    }): Promise<void>;
    /**
     * Coordinates durable and transaction-local readiness on one connection.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<void>} Resolves when this caller can use the table.
     */
    _ensureReadyWithDb(db: import("../database/drivers/base.js").default): Promise<void>;
    /**
     * Whether the store runs without a configured database.
     * @returns {boolean} Whether memory storage is used.
     */
    _usesMemoryStorage(): boolean;
    /**
     * Runs a callback with a database connection.
     * @template Result
     * @param {(db: import("../database/drivers/base.js").default) => Promise<Result>} callback - Database callback.
     * @returns {Promise<Result>} Callback result.
     */
    _withDb<Result>(callback: (db: import("../database/drivers/base.js").default) => Promise<Result>): Promise<Result>;
    /**
     * Ensures the applied-sequences table exists.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<boolean>} Whether the table had to be created.
     */
    _ensureTable(db: import("../database/drivers/base.js").default): Promise<boolean>;
    /**
     * Resolves the stored row for one resource identity.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {{resourceType: string, resourceId: string}} identity - Resource identity.
     * @returns {Promise<SyncAppliedSequenceRow | null>} Stored row, or null.
     */
    _rowByResource(db: import("../database/drivers/base.js").default, identity: {
        resourceType: string;
        resourceId: string;
    }): Promise<SyncAppliedSequenceRow | null>;
}
//# sourceMappingURL=sync-applied-sequence-store.d.ts.map