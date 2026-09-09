export type ServerChangeFeedEntry = {
    /**
     * - Signed mutation actor device id when available.
     */
    actorDeviceId: string | null;
    /**
     * - Signed mutation actor user id when available.
     */
    actorUserId: string | null;
    /**
     * - Serialized mutation attributes.
     */
    attributes: Record<string, ReturnType<typeof JSON.parse>> | null;
    /**
     * - Server change creation timestamp.
     */
    createdAt: string;
    /**
     * - Server change id.
     */
    id: string;
    /**
     * - Mutation idempotency key when available.
     */
    idempotencyKey: string | null;
    /**
     * - Frontend model name.
     */
    model: string;
    /**
     * - Mutation operation.
     */
    operation: string;
    /**
     * - Serialized mutation payload.
     */
    payload: Record<string, ReturnType<typeof JSON.parse>> | null;
    /**
     * - Changed record id when known.
     */
    recordId: string | null;
    /**
     * - Command response payload.
     */
    response: Record<string, ReturnType<typeof JSON.parse>> | null;
    /**
     * - Offline grant scope.
     */
    scope: Record<string, ReturnType<typeof JSON.parse>> | null;
    /**
     * - Monotonic server sequence.
     */
    serverSequence: number;
};
export type ServerChangeFeedRow = {
    /**
     * - Actor device id.
     */
    actor_device_id: string | null;
    /**
     * - Actor user id.
     */
    actor_user_id: string | null;
    /**
     * - Attributes JSON.
     */
    attributes_json: string | null;
    /**
     * - Creation time.
     */
    created_at: Date | string;
    /**
     * - Entry id.
     */
    id: string;
    /**
     * - Mutation idempotency key.
     */
    idempotency_key: string | null;
    /**
     * - Frontend model name.
     */
    model: string;
    /**
     * - Mutation operation.
     */
    operation: string;
    /**
     * - Mutation payload JSON.
     */
    payload_json: string | null;
    /**
     * - Record id.
     */
    record_id: string | null;
    /**
     * - Response JSON.
     */
    response_json: string | null;
    /**
     * - Scope JSON.
     */
    scope_json: string | null;
    /**
     * - Server sequence.
     */
    server_sequence: number | string;
};
/**
 * Shared server change-feed store for a configuration.
 * @param {import("../configuration.js").default} configuration - Configuration.
 * @returns {ServerChangeFeedStore} - Store.
 */
export declare function serverChangeFeedStoreForConfiguration(configuration: import("../configuration.js").default): ServerChangeFeedStore;
export default class ServerChangeFeedStore {
    configuration: import("../configuration.js").default;
    databaseIdentifier: string;
    retentionSize: number;
    /** @type {ServerChangeFeedEntry[]} */
    _memoryChanges: ServerChangeFeedEntry[];
    _memorySequence: number;
    _isReady: boolean;
    /** @type {Promise<void> | null} */
    _readyPromise: Promise<void> | null;
    /** @type {WeakMap<import("../database/drivers/base.js").default, {completion: Promise<void>, promise: Promise<void>}>} */
    _transactionReadyPromises: WeakMap<import("../database/drivers/base.js").default, {
        completion: Promise<void>;
        promise: Promise<void>;
    }>;
    /**
     * Runs constructor.
     * @param {object} args - Options.
     * @param {import("../configuration.js").default} args.configuration - Configuration.
     * @param {string} [args.databaseIdentifier] - Database identifier.
     * @param {number} [args.retentionSize] - Number of feed entries to retain.
     */
    constructor({ configuration, databaseIdentifier, retentionSize }: {
        configuration: import("../configuration.js").default;
        databaseIdentifier?: string;
        retentionSize?: number;
    });
    /**
     * Ensures the backing table exists.
     * @returns {Promise<void>} - Resolves when ready.
     */
    ensureReady(): Promise<void>;
    /**
     * Coordinates durable and transaction-local readiness on one connection.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<void>} Resolves when this caller can use the table.
     */
    _ensureReadyWithDb(db: import("../database/drivers/base.js").default): Promise<void>;
    /**
     * Appends a change and assigns the next server sequence.
     * @param {Omit<ServerChangeFeedEntry, "createdAt" | "id" | "serverSequence"> & {createdAt?: string, id?: string}} change - Change payload.
     * @returns {Promise<ServerChangeFeedEntry>} - Persisted change.
     */
    append(change: Omit<ServerChangeFeedEntry, "createdAt" | "id" | "serverSequence"> & {
        createdAt?: string;
        id?: string;
    }): Promise<ServerChangeFeedEntry>;
    /**
     * Returns current latest server sequence.
     * @returns {Promise<number>} - Latest sequence.
     */
    latestSequence(): Promise<number>;
    /**
     * Returns oldest retained server sequence.
     * @returns {Promise<number | null>} - Oldest retained sequence.
     */
    oldestSequence(): Promise<number | null>;
    /**
     * Returns ordered changes after a cursor.
     * @param {object} args - Arguments.
     * @param {number} args.afterSequence - Exclusive lower bound.
     * @param {number} [args.limit] - Maximum number of changes.
     * @param {number} [args.upToSequence] - Inclusive upper bound.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} [args.scope] - Caller sync scope.
     * @returns {Promise<{changes: ServerChangeFeedEntry[], hasMore: boolean, nextSequence: number, oldestSequence: number | null, snapshotRequired: boolean, upToSequence: number}>} - Ordered page.
     */
    changesAfter({ afterSequence, limit, scope, upToSequence }: {
        afterSequence: number;
        limit?: number;
        upToSequence?: number;
        scope?: Record<string, ReturnType<typeof JSON.parse>>;
    }): Promise<{
        changes: ServerChangeFeedEntry[];
        hasMore: boolean;
        nextSequence: number;
        oldestSequence: number | null;
        snapshotRequired: boolean;
        upToSequence: number;
    }>;
    /**
     * Ensures schema is still present.
     * @returns {Promise<boolean>} - Whether ready.
     */
    _schemaReady(): Promise<boolean>;
    /**
     * Ensures changes table exists.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<boolean>} - Whether the table had to be created.
     */
    _ensureChangesTable(db: import("../database/drivers/base.js").default): Promise<boolean>;
    /**
     * Resolves a persisted change by id.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {string} id - Entry id.
     * @returns {Promise<ServerChangeFeedEntry | null>} - Entry or null.
     */
    _changeById(db: import("../database/drivers/base.js").default, id: string): Promise<ServerChangeFeedEntry | null>;
    /**
     * Resolves current latest sequence without readiness checks.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<number>} - Latest sequence.
     */
    _latestSequence(db: import("../database/drivers/base.js").default): Promise<number>;
    /**
     * Resolves current oldest sequence without readiness checks.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<number | null>} - Oldest sequence.
     */
    _oldestSequence(db: import("../database/drivers/base.js").default): Promise<number | null>;
    /**
     * Prunes old retained changes.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {number} latestSequence - Latest sequence after append.
     * @returns {Promise<void>} - Resolves when complete.
     */
    _pruneRetainedChanges(db: import("../database/drivers/base.js").default, latestSequence: number): Promise<void>;
    /**
     * Normalizes a change row.
     * @param {ServerChangeFeedRow} row - Raw database row.
     * @returns {ServerChangeFeedEntry} - Normalized change.
     */
    _normalizeChangeRow(row: ServerChangeFeedRow): ServerChangeFeedEntry;
    /**
     * Whether this store should use process-local memory because no database identifier is configured.
     * @returns {boolean} - Whether memory storage is active.
     */
    _usesMemoryStorage(): boolean;
    /**
     * Appends a process-local memory entry when no database is configured.
     * @param {Omit<ServerChangeFeedEntry, "serverSequence">} change - Change payload.
     * @returns {ServerChangeFeedEntry} - Appended entry.
     */
    _appendMemory(change: Omit<ServerChangeFeedEntry, "serverSequence">): ServerChangeFeedEntry;
    /**
     * Returns a process-local memory change page.
     * @param {object} args - Arguments.
     * @param {number} args.afterSequence - Exclusive lower bound.
     * @param {number} args.limit - Page size.
     * @param {number} [args.upToSequence] - Inclusive upper bound.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} [args.scope] - Caller sync scope.
     * @returns {{changes: ServerChangeFeedEntry[], hasMore: boolean, nextSequence: number, oldestSequence: number | null, snapshotRequired: boolean, upToSequence: number}} - Ordered page.
     */
    _memoryChangesAfter({ afterSequence, limit, scope, upToSequence }: {
        afterSequence: number;
        limit: number;
        upToSequence?: number;
        scope?: Record<string, ReturnType<typeof JSON.parse>>;
    }): {
        changes: ServerChangeFeedEntry[];
        hasMore: boolean;
        nextSequence: number;
        oldestSequence: number | null;
        snapshotRequired: boolean;
        upToSequence: number;
    };
    /**
     * Runs with db.
     * @param {(db: import("../database/drivers/base.js").default) => Promise<ReturnType<typeof JSON.parse>>} callback - Callback.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Callback result.
     */
    _withDb(callback: (db: import("../database/drivers/base.js").default) => Promise<ReturnType<typeof JSON.parse>>): Promise<ReturnType<typeof JSON.parse>>;
}
//# sourceMappingURL=server-change-feed.d.ts.map