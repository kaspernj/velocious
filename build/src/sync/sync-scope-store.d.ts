export type SyncScopeRow = {
    /**
     * - Scope attribute conditions.
     */
    conditions: Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * - Persisted cursor JSON payload.
     */
    cursorPayload: string | null;
    /**
     * - Scope row id.
     */
    id: string;
    /**
     * - Scope resource/model name, or null for the all-types (user) scope.
     */
    resourceType: string | null;
    /**
     * - Fixed-size deterministic digest of the canonical scope key.
     */
    scopeDigest: string;
    /**
     * - Scope state ("active" or "removed").
     */
    state: string;
    /**
     * - Physical store identity owning this row.
     */
    storeIdentity: string;
};
/**
 * Framework-owned local persistence for declared sync scopes and their cursors.
 *
 * Backed by an auto-created `velocious_sync_scopes` table on the configured
 * database, with a process-local memory fallback when no database is
 * configured (mirroring the server change-feed store).
 */
export default class SyncScopeStore {
    configuration: import("../configuration.js").default;
    databaseIdentifier: string;
    tenantHandle: import("../tenants/tenant-handle.js").default | undefined;
    storeIdentity: string;
    /** @type {Map<string, SyncScopeRow>} */
    _memoryScopes: Map<string, SyncScopeRow>;
    _isReady: boolean;
    /** @type {Promise<void> | null} */
    _readyPromise: Promise<void> | null;
    /** @type {WeakMap<import("../database/drivers/base.js").default, {completion: Promise<void>, promise: Promise<void>}>} */
    _transactionReadyPromises: WeakMap<import("../database/drivers/base.js").default, {
        completion: Promise<void>;
        promise: Promise<void>;
    }>;
    /**
     * Creates a sync scope store.
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
     * Coordinates durable and transaction-local readiness on one connection.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<void>} Resolves when this caller can use the table.
     */
    _ensureReadyWithDb(db: import("../database/drivers/base.js").default): Promise<void>;
    /**
     * Finds or creates the scope row for a serialized scope, reactivating removed scopes.
     * @param {import("./sync-client-types.js").SerializedSyncScope} scope - Serialized sync scope.
     * @returns {Promise<SyncScopeRow>} Persisted scope row.
     */
    findOrCreateScope(scope: import("./sync-client-types.js").SerializedSyncScope): Promise<SyncScopeRow>;
    /**
     * Returns all active scope rows.
     * @returns {Promise<SyncScopeRow[]>} Active scope rows.
     */
    activeScopes(): Promise<SyncScopeRow[]>;
    /**
     * Loads the persisted cursor payload for a scope row.
     * @param {SyncScopeRow} scopeRow - Scope row.
     * @returns {Promise<string | null>} Cursor JSON payload.
     */
    loadCursor(scopeRow: SyncScopeRow): Promise<string | null>;
    /**
     * Persists the acknowledged cursor for a scope row.
     * @param {SyncScopeRow} scopeRow - Scope row.
     * @param {import("./sync-api-client-types.js").SyncCursor} cursor - Acknowledged cursor.
     * @returns {Promise<void>}
     */
    saveCursor(scopeRow: SyncScopeRow, cursor: import("./sync-api-client-types.js").SyncCursor): Promise<void>;
    /**
     * Deactivates the scope row for a serialized scope.
     * @param {import("./sync-client-types.js").SerializedSyncScope} scope - Serialized sync scope.
     * @returns {Promise<void>}
     */
    deactivate(scope: import("./sync-client-types.js").SerializedSyncScope): Promise<void>;
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
     * Ensures the scopes table exists.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<boolean>} Whether the table had to be created.
     */
    _ensureScopesTable(db: import("../database/drivers/base.js").default): Promise<boolean>;
    /**
     * Resolves a scope row by its digest.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {string} digest - Fixed-size scope digest.
     * @returns {Promise<SyncScopeRow | null>} Scope row or null.
     */
    _rowByScopeDigest(db: import("../database/drivers/base.js").default, digest: string): Promise<SyncScopeRow | null>;
    /**
     * Normalizes a raw scope table row.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} row - Raw table row.
     * @returns {SyncScopeRow} Normalized scope row.
     */
    _normalizeScopeRow(row: Record<string, ReturnType<typeof JSON.parse>>): SyncScopeRow;
    /**
     * Rejects passing a scope row captured from another physical store.
     * @param {SyncScopeRow} scopeRow - Scope row to validate.
     * @returns {void}
     */
    _assertScopeRow(scopeRow: SyncScopeRow): void;
}
//# sourceMappingURL=sync-scope-store.d.ts.map