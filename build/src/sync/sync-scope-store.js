// @ts-check
import TableData from "../database/table-data/index.js";
import UUID from "pure-uuid";
import { scopeKey } from "./query-scope.js";
import stableJsonStringify from "./stable-json.js";
/**
 * @typedef {object} SyncScopeRow
 * @property {Record<string, ReturnType<typeof JSON.parse>>} conditions - Scope attribute conditions.
 * @property {string | null} cursorPayload - Persisted cursor JSON payload.
 * @property {string} id - Scope row id.
 * @property {string | null} resourceType - Scope resource/model name, or null for the all-types (user) scope.
 * @property {string} scopeDigest - Fixed-size deterministic digest of the canonical scope key.
 * @property {string} state - Scope state ("active" or "removed").
 * @property {string} storeIdentity - Physical store identity owning this row.
 */
const TABLE_NAME = "velocious_sync_scopes";
const SCOPE_DIGEST_PREFIX = "velocious-sync-scope:";
/**
 * Digests a serialized scope into a fixed-size deterministic key, so scope
 * identities with long condition values fit an indexed string column.
 * @param {import("./sync-client-types.js").SerializedSyncScope} scope - Serialized sync scope.
 * @returns {string} Deterministic UUIDv5 digest of the canonical scope key.
 */
function scopeDigestForScope(scope) {
    return new UUID(5, "ns:URL", `${SCOPE_DIGEST_PREFIX}${scopeKey(scope)}`).format();
}
/**
 * Framework-owned local persistence for declared sync scopes and their cursors.
 *
 * Backed by an auto-created `velocious_sync_scopes` table on the configured
 * database, with a process-local memory fallback when no database is
 * configured (mirroring the server change-feed store).
 */
export default class SyncScopeStore {
    /**
     * Creates a sync scope store.
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
        /** @type {Map<string, SyncScopeRow>} */
        this._memoryScopes = new Map();
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
            const tableReadyPromise = this._ensureScopesTable(db);
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
        this._readyPromise = this._ensureScopesTable(db).then(() => {
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
     * Finds or creates the scope row for a serialized scope, reactivating removed scopes.
     * @param {import("./sync-client-types.js").SerializedSyncScope} scope - Serialized sync scope.
     * @returns {Promise<SyncScopeRow>} Persisted scope row.
     */
    async findOrCreateScope(scope) {
        await this.ensureReady();
        const digest = scopeDigestForScope(scope);
        if (this._usesMemoryStorage()) {
            const existingScope = this._memoryScopes.get(digest);
            if (existingScope) {
                if (existingScope.state !== "active")
                    existingScope.state = "active";
                return existingScope;
            }
            const newScope = {
                conditions: scope.conditions,
                cursorPayload: null,
                id: new UUID(4).format(),
                resourceType: scope.resourceType ?? null,
                scopeDigest: digest,
                state: "active",
                storeIdentity: this.storeIdentity
            };
            this._memoryScopes.set(digest, newScope);
            return newScope;
        }
        return await this._withDb(async (db) => {
            const existingRow = await this._rowByScopeDigest(db, digest);
            if (existingRow) {
                if (existingRow.state !== "active") {
                    await db.update({ conditions: { id: existingRow.id }, data: { state: "active", updated_at: new Date() }, tableName: TABLE_NAME });
                    existingRow.state = "active";
                }
                return existingRow;
            }
            await db.insert({
                tableName: TABLE_NAME,
                data: {
                    conditions_json: stableJsonStringify(scope.conditions),
                    created_at: new Date(),
                    cursor_json: null,
                    id: new UUID(4).format(),
                    // The all-types (user) scope has no resource type; the column is non-null, so it
                    // stores as an empty string and normalizes back to null on read.
                    resource_type: scope.resourceType ?? "",
                    scope_digest: digest,
                    state: "active",
                    updated_at: new Date()
                }
            });
            const createdRow = await this._rowByScopeDigest(db, digest);
            if (!createdRow)
                throw new Error("Failed to persist sync scope");
            return createdRow;
        });
    }
    /**
     * Returns all active scope rows.
     * @returns {Promise<SyncScopeRow[]>} Active scope rows.
     */
    async activeScopes() {
        await this.ensureReady();
        if (this._usesMemoryStorage()) {
            return [...this._memoryScopes.values()].filter((scope) => scope.state === "active");
        }
        return await this._withDb(async (db) => {
            const rows = /** @type {Array<Record<string, ReturnType<typeof JSON.parse>>>} */ (await db
                .newQuery()
                .from(TABLE_NAME)
                .where({ state: "active" })
                .order("created_at ASC")
                .results());
            return rows.map((row) => this._normalizeScopeRow(row));
        });
    }
    /**
     * Loads the persisted cursor payload for a scope row.
     * @param {SyncScopeRow} scopeRow - Scope row.
     * @returns {Promise<string | null>} Cursor JSON payload.
     */
    async loadCursor(scopeRow) {
        this._assertScopeRow(scopeRow);
        await this.ensureReady();
        if (this._usesMemoryStorage()) {
            const currentScope = this._memoryScopes.get(scopeRow.scopeDigest);
            return currentScope?.id === scopeRow.id ? currentScope.cursorPayload : null;
        }
        return await this._withDb(async (db) => {
            const row = await this._rowByScopeDigest(db, scopeRow.scopeDigest);
            return row?.id === scopeRow.id ? row.cursorPayload : null;
        });
    }
    /**
     * Persists the acknowledged cursor for a scope row.
     * @param {SyncScopeRow} scopeRow - Scope row.
     * @param {import("./sync-api-client-types.js").SyncCursor} cursor - Acknowledged cursor.
     * @returns {Promise<void>}
     */
    async saveCursor(scopeRow, cursor) {
        this._assertScopeRow(scopeRow);
        if (!cursor)
            return;
        await this.ensureReady();
        const cursorPayload = JSON.stringify(cursor);
        if (this._usesMemoryStorage()) {
            const memoryScope = this._memoryScopes.get(scopeRow.scopeDigest);
            if (!memoryScope)
                throw new Error(`No sync scope found for: ${scopeRow.scopeDigest}`);
            if (memoryScope.id !== scopeRow.id || memoryScope.state !== "active")
                return;
            memoryScope.cursorPayload = cursorPayload;
            return;
        }
        await this._withDb(async (db) => {
            await db.update({
                conditions: { id: scopeRow.id, scope_digest: scopeRow.scopeDigest, state: "active" },
                data: { cursor_json: cursorPayload, updated_at: new Date() },
                tableName: TABLE_NAME
            });
        });
    }
    /**
     * Deactivates the scope row for a serialized scope.
     * @param {import("./sync-client-types.js").SerializedSyncScope} scope - Serialized sync scope.
     * @returns {Promise<void>}
     */
    async deactivate(scope) {
        await this.ensureReady();
        const digest = scopeDigestForScope(scope);
        if (this._usesMemoryStorage()) {
            const memoryScope = this._memoryScopes.get(digest);
            if (memoryScope)
                memoryScope.state = "removed";
            return;
        }
        await this._withDb(async (db) => {
            await db.update({ conditions: { scope_digest: digest }, data: { state: "removed", updated_at: new Date() }, tableName: TABLE_NAME });
        });
    }
    /**
     * Atomically deactivates selected scopes, clears their cursors and rotates
     * their row identities. A cursor save carrying a pre-reset row identity can
     * therefore never repopulate the reset scope. The optional cleanup hook runs
     * inside the same database transaction, allowing an app to purge the local
     * rows owned by those scopes without a cursor/cache split.
     * @param {import("./sync-client-types.js").SerializedSyncScope[]} scopes - Selected scopes to reset.
     * @param {object} [options] - Reset options.
     * @param {(args: {connection: import("../database/drivers/base.js").default | null, scopes: import("./sync-client-types.js").SerializedSyncScope[]}) => Promise<void> | void} [options.cleanup] - App-owned local-row cleanup hook.
     * @returns {Promise<void>}
     */
    async reset(scopes, { cleanup } = {}) {
        if (!Array.isArray(scopes) || scopes.length === 0)
            throw new Error("SyncScopeStore.reset requires at least one serialized scope");
        if (cleanup !== undefined && typeof cleanup !== "function")
            throw new Error("SyncScopeStore.reset cleanup must be a function");
        await this.ensureReady();
        const uniqueScopes = [...new Map(scopes.map((scope) => [scopeDigestForScope(scope), scope])).values()];
        if (this._usesMemoryStorage()) {
            if (cleanup)
                await cleanup({ connection: null, scopes: uniqueScopes });
            for (const scope of uniqueScopes)
                this._resetMemoryScope(scope);
            return;
        }
        await this._withDb(async (db) => {
            await db.transaction(async () => {
                if (cleanup)
                    await cleanup({ connection: db, scopes: uniqueScopes });
                for (const scope of uniqueScopes)
                    await this._resetDatabaseScope({ db, scope });
            });
        });
    }
    /**
     * Resets one memory-backed scope while preserving repeated-reset idempotence.
     * @param {import("./sync-client-types.js").SerializedSyncScope} scope - Scope to reset.
     * @returns {void}
     */
    _resetMemoryScope(scope) {
        const digest = scopeDigestForScope(scope);
        const memoryScope = this._memoryScopes.get(digest);
        if (!memoryScope || (memoryScope.state === "removed" && memoryScope.cursorPayload === null))
            return;
        this._memoryScopes.set(digest, {
            ...memoryScope,
            cursorPayload: null,
            id: new UUID(4).format(),
            state: "removed"
        });
    }
    /**
     * Resets one database-backed scope while preserving repeated-reset idempotence.
     * @param {{db: import("../database/drivers/base.js").default, scope: import("./sync-client-types.js").SerializedSyncScope}} args - Database and scope.
     * @returns {Promise<void>}
     */
    async _resetDatabaseScope({ db, scope }) {
        const digest = scopeDigestForScope(scope);
        const existingRow = await this._rowByScopeDigest(db, digest);
        if (!existingRow || (existingRow.state === "removed" && existingRow.cursorPayload === null))
            return;
        await db.update({
            conditions: { id: existingRow.id, scope_digest: digest },
            data: { cursor_json: null, id: new UUID(4).format(), state: "removed", updated_at: new Date() },
            tableName: TABLE_NAME
        });
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
            return await this.tenantHandle.databaseOperation({ databaseIdentifier: this.databaseIdentifier, name: "Tenant sync scope store" }, async (operation) => {
                return await callback(operation.connection());
            });
        }
        return await this.configuration.ensureConnections({ databaseIdentifiers: [this.databaseIdentifier], name: "Sync scope store" }, async (dbs) => {
            const db = dbs[this.databaseIdentifier];
            if (!db)
                throw new Error(`No database connection available for identifier: ${this.databaseIdentifier}`);
            return await callback(db);
        });
    }
    /**
     * Ensures the scopes table exists.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @returns {Promise<boolean>} Whether the table had to be created.
     */
    async _ensureScopesTable(db) {
        if (await db.tableExists(TABLE_NAME))
            return false;
        const table = new TableData(TABLE_NAME, { ifNotExists: true });
        table.string("id", { null: false, primaryKey: true });
        table.string("scope_digest", { index: true, null: false });
        table.string("resource_type", { index: true, null: false });
        table.text("conditions_json", { null: false });
        table.text("cursor_json", { null: true });
        table.string("state", { index: true, null: false });
        table.datetime("created_at", { null: false });
        table.datetime("updated_at", { null: false });
        await db.createTable(table);
        return true;
    }
    /**
     * Resolves a scope row by its digest.
     * @param {import("../database/drivers/base.js").default} db - Database connection.
     * @param {string} digest - Fixed-size scope digest.
     * @returns {Promise<SyncScopeRow | null>} Scope row or null.
     */
    async _rowByScopeDigest(db, digest) {
        const rows = /** @type {Array<Record<string, ReturnType<typeof JSON.parse>>>} */ (await db
            .newQuery()
            .from(TABLE_NAME)
            .where({ scope_digest: digest })
            .limit(1)
            .results());
        return rows[0] ? this._normalizeScopeRow(rows[0]) : null;
    }
    /**
     * Normalizes a raw scope table row.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} row - Raw table row.
     * @returns {SyncScopeRow} Normalized scope row.
     */
    _normalizeScopeRow(row) {
        return {
            conditions: /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (JSON.parse(String(row.conditions_json))),
            cursorPayload: row.cursor_json === null || row.cursor_json === undefined ? null : String(row.cursor_json),
            id: String(row.id),
            resourceType: String(row.resource_type) === "" ? null : String(row.resource_type),
            scopeDigest: String(row.scope_digest),
            state: String(row.state),
            storeIdentity: this.storeIdentity
        };
    }
    /**
     * Rejects passing a scope row captured from another physical store.
     * @param {SyncScopeRow} scopeRow - Scope row to validate.
     * @returns {void}
     */
    _assertScopeRow(scopeRow) {
        if (scopeRow.storeIdentity !== this.storeIdentity) {
            throw new Error("Sync scope row belongs to another physical tenant database");
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3luYy1zY29wZS1zdG9yZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9zeW5jL3N5bmMtc2NvcGUtc3RvcmUuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sU0FBUyxNQUFNLGlDQUFpQyxDQUFBO0FBQ3ZELE9BQU8sSUFBSSxNQUFNLFdBQVcsQ0FBQTtBQUU1QixPQUFPLEVBQUMsUUFBUSxFQUFDLE1BQU0sa0JBQWtCLENBQUE7QUFDekMsT0FBTyxtQkFBbUIsTUFBTSxrQkFBa0IsQ0FBQTtBQUVsRDs7Ozs7Ozs7O0dBU0c7QUFDSCxNQUFNLFVBQVUsR0FBRyx1QkFBdUIsQ0FBQTtBQUMxQyxNQUFNLG1CQUFtQixHQUFHLHVCQUF1QixDQUFBO0FBRW5EOzs7OztHQUtHO0FBQ0gsU0FBUyxtQkFBbUIsQ0FBQyxLQUFLO0lBQ2hDLE9BQU8sSUFBSSxJQUFJLENBQUMsQ0FBQyxFQUFFLFFBQVEsRUFBRSxHQUFHLG1CQUFtQixHQUFHLFFBQVEsQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDLENBQUMsTUFBTSxFQUFFLENBQUE7QUFDbkYsQ0FBQztBQUVEOzs7Ozs7R0FNRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8sY0FBYztJQUNqQzs7Ozs7O09BTUc7SUFDSCxZQUFZLEVBQUMsYUFBYSxFQUFFLGtCQUFrQixHQUFHLFNBQVMsRUFBRSxZQUFZLEVBQUM7UUFDdkUsSUFBSSxZQUFZO1lBQUUsWUFBWSxDQUFDLG1CQUFtQixDQUFDLGFBQWEsQ0FBQyxDQUFBO1FBRWpFLElBQUksQ0FBQyxhQUFhLEdBQUcsYUFBYSxDQUFBO1FBQ2xDLElBQUksQ0FBQyxrQkFBa0IsR0FBRyxrQkFBa0IsQ0FBQTtRQUM1QyxJQUFJLENBQUMsWUFBWSxHQUFHLFlBQVksQ0FBQTtRQUNoQyxJQUFJLENBQUMsYUFBYSxHQUFHLFlBQVk7WUFDL0IsQ0FBQyxDQUFDLFlBQVksQ0FBQyxnQkFBZ0IsQ0FBQyxrQkFBa0Is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QixPQUFPO1lBQ0wsVUFBVSxFQUFFLDREQUE0RCxDQUFDLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsR0FBRyxDQUFDLGVBQWUsQ0FBQyxDQUFDLENBQUM7WUFDbEgsYUFBYSxFQUFFLEdBQUcsQ0FBQyxXQUFXLEtBQUssSUFBSSxJQUFJLEdBQUcsQ0FBQyxXQUFXLEtBQUssU0FBUyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsV0FBVyxDQUFDO1lBQ3pHLEVBQUUsRUFBRSxNQUFNLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQztZQUNsQixZQUFZLEVBQUUsTUFBTSxDQUFDLEdBQUcsQ0FBQyxhQUFhLENBQUMsS0FBSyxFQUFFLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxhQUFhLENBQUM7WUFDakYsV0FBVyxFQUFFLE1BQU0sQ0FBQyxHQUFHLENBQUMsWUFBWSxDQUFDO1lBQ3JDLEtBQUssRUFBRSxNQUFNLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQztZQUN4QixhQUFhLEVBQUUsSUFBSSxDQUFDLGFBQWE7U0FDbEMsQ0FBQTtJQUNILENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsZUFBZSxDQUFDLFFBQVE7UUFDdEIsSUFBSSxRQUFRLENBQUMsYUFBYSxLQUFLLElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQztZQUNsRCxNQUFNLElBQUksS0FBSyxDQUFDLDREQUE0RCxDQUFDLENBQUE7UUFDL0UsQ0FBQztJQUNILENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgVGFibGVEYXRhIGZyb20gXCIuLi9kYXRhYmFzZS90YWJsZS1kYXRhL2luZGV4LmpzXCJcbmltcG9ydCBVVUlEIGZyb20gXCJwdXJlLXV1aWRcIlxuXG5pbXBvcnQge3Njb3BlS2V5fSBmcm9tIFwiLi9xdWVyeS1zY29wZS5qc1wiXG5pbXBvcnQgc3RhYmxlSnNvblN0cmluZ2lmeSBmcm9tIFwiLi9zdGFibGUtanNvbi5qc1wiXG5cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gU3luY1Njb3BlUm93XG4gKiBAcHJvcGVydHkge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY29uZGl0aW9ucyAtIFNjb3BlIGF0dHJpYnV0ZSBjb25kaXRpb25zLlxuICogQHByb3BlcnR5IHtzdHJpbmcgfCBudWxsfSBjdXJzb3JQYXlsb2FkIC0gUGVyc2lzdGVkIGN1cnNvciBKU09OIHBheWxvYWQuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gaWQgLSBTY29wZSByb3cgaWQuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IG51bGx9IHJlc291cmNlVHlwZSAtIFNjb3BlIHJlc291cmNlL21vZGVsIG5hbWUsIG9yIG51bGwgZm9yIHRoZSBhbGwtdHlwZXMgKHVzZXIpIHNjb3BlLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHNjb3BlRGlnZXN0IC0gRml4ZWQtc2l6ZSBkZXRlcm1pbmlzdGljIGRpZ2VzdCBvZiB0aGUgY2Fub25pY2FsIHNjb3BlIGtleS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBzdGF0ZSAtIFNjb3BlIHN0YXRlIChcImFjdGl2ZVwiIG9yIFwicmVtb3ZlZFwiKS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBzdG9yZUlkZW50aXR5IC0gUGh5c2ljYWwgc3RvcmUgaWRlbnRpdHkgb3duaW5nIHRoaXMgcm93LlxuICovXG5jb25zdCBUQUJMRV9OQU1FID0gXCJ2ZWxvY2lvdXNfc3luY19zY29wZXNcIlxuY29uc3QgU0NPUEVfRElHRVNUX1BSRUZJWCA9IFwidmVsb2Npb3VzLXN5bmMtc2NvcGU6XCJcblxuLyoqXG4gKiBEaWdlc3RzIGEgc2VyaWFsaXplZCBzY29wZSBpbnRvIGEgZml4ZWQtc2l6ZSBkZXRlcm1pbmlzdGljIGtleSwgc28gc2NvcGVcbiAqIGlkZW50aXRpZXMgd2l0aCBsb25nIGNvbmRpdGlvbiB2YWx1ZXMgZml0IGFuIGluZGV4ZWQgc3RyaW5nIGNvbHVtbi5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5TZXJpYWxpemVkU3luY1Njb3BlfSBzY29wZSAtIFNlcmlhbGl6ZWQgc3luYyBzY29wZS5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IERldGVybWluaXN0aWMgVVVJRHY1IGRpZ2VzdCBvZiB0aGUgY2Fub25pY2FsIHNjb3BlIGtleS5cbiAqL1xuZnVuY3Rpb24gc2NvcGVEaWdlc3RGb3JTY29wZShzY29wZSkge1xuICByZXR1cm4gbmV3IFVVSUQoNSwgXCJuczpVUkxcIiwgYCR7U0NPUEVfRElHRVNUX1BSRUZJWH0ke3Njb3BlS2V5KHNjb3BlKX1gKS5mb3JtYXQoKVxufVxuXG4vKipcbiAqIEZyYW1ld29yay1vd25lZCBsb2NhbCBwZXJzaXN0ZW5jZSBmb3IgZGVjbGFyZWQgc3luYyBzY29wZXMgYW5kIHRoZWlyIGN1cnNvcnMuXG4gKlxuICogQmFja2VkIGJ5IGFuIGF1dG8tY3JlYXRlZCBgdmVsb2Npb3VzX3N5bmNfc2NvcGVzYCB0YWJsZSBvbiB0aGUgY29uZmlndXJlZFxuICogZGF0YWJhc2UsIHdpdGggYSBwcm9jZXNzLWxvY2FsIG1lbW9yeSBmYWxsYmFjayB3aGVuIG5vIGRhdGFiYXNlIGlzXG4gKiBjb25maWd1cmVkIChtaXJyb3JpbmcgdGhlIHNlcnZlciBjaGFuZ2UtZmVlZCBzdG9yZSkuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFN5bmNTY29wZVN0b3JlIHtcbiAgLyoqXG4gICAqIENyZWF0ZXMgYSBzeW5jIHNjb3BlIHN0b3JlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIG93bmluZyB0aGUgZGF0YWJhc2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5kYXRhYmFzZUlkZW50aWZpZXJdIC0gRGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi90ZW5hbnRzL3RlbmFudC1oYW5kbGUuanNcIikuZGVmYXVsdH0gW2FyZ3MudGVuYW50SGFuZGxlXSAtIEltbXV0YWJsZSB0ZW5hbnQgaGFuZGxlIG93bmluZyB0aGUgcGh5c2ljYWwgc3RvcmUuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Y29uZmlndXJhdGlvbiwgZGF0YWJhc2VJZGVudGlmaWVyID0gXCJkZWZhdWx0XCIsIHRlbmFudEhhbmRsZX0pIHtcbiAgICBpZiAodGVuYW50SGFuZGxlKSB0ZW5hbnRIYW5kbGUuYXNzZXJ0Q29uZmlndXJhdGlvbihjb25maWd1cmF0aW9uKVxuXG4gICAgdGhpcy5jb25maWd1cmF0aW9uID0gY29uZmlndXJhdGlvblxuICAgIHRoaXMuZGF0YWJhc2VJZGVudGlmaWVyID0gZGF0YWJhc2VJZGVudGlmaWVyXG4gICAgdGhpcy50ZW5hbnRIYW5kbGUgPSB0ZW5hbnRIYW5kbGVcbiAgICB0aGlzLnN0b3JlSWRlbnRpdHkgPSB0ZW5hbnRIYW5kbGVcbiAgICAgID8gdGVuYW50SGFuZGxlLmRhdGFiYXNlSWRlbnRpdHkoZGF0YWJhc2VJZGVudGlmaWVyKVxuICAgICAgOiBgY29uZmlndXJhdGlvbjoke2RhdGFiYXNlSWRlbnRpZmllcn1gXG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBTeW5jU2NvcGVSb3c+fSAqL1xuICAgIHRoaXMuX21lbW9yeVNjb3BlcyA9IG5ldyBNYXAoKVxuICAgIHRoaXMuX2lzUmVhZHkgPSBmYWxzZVxuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPiB8IG51bGx9ICovXG4gICAgdGhpcy5fcmVhZHlQcm9taXNlID0gbnVsbFxuICAgIC8qKiBAdHlwZSB7V2Vha01hcDxpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCwge2NvbXBsZXRpb246IFByb21pc2U8dm9pZD4sIHByb21pc2U6IFByb21pc2U8dm9pZD59Pn0gKi9cbiAgICB0aGlzLl90cmFuc2FjdGlvblJlYWR5UHJvbWlzZXMgPSBuZXcgV2Vha01hcCgpXG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyB0aGUgYmFja2luZyB0YWJsZSBleGlzdHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyB3aGVuIHJlYWR5LlxuICAgKi9cbiAgYXN5bmMgZW5zdXJlUmVhZHkoKSB7XG4gICAgaWYgKHRoaXMuX2lzUmVhZHkpIHJldHVyblxuXG4gICAgaWYgKHRoaXMuX3VzZXNNZW1vcnlTdG9yYWdlKCkpIHtcbiAgICAgIHRoaXMuX2lzUmVhZHkgPSB0cnVlXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLl93aXRoRGIoYXN5bmMgKGRiKSA9PiBhd2FpdCB0aGlzLl9lbnN1cmVSZWFkeVdpdGhEYihkYikpXG4gIH1cblxuICAvKipcbiAgICogQ29vcmRpbmF0ZXMgZHVyYWJsZSBhbmQgdHJhbnNhY3Rpb24tbG9jYWwgcmVhZGluZXNzIG9uIG9uZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyB3aGVuIHRoaXMgY2FsbGVyIGNhbiB1c2UgdGhlIHRhYmxlLlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZVJlYWR5V2l0aERiKGRiKSB7XG4gICAgaWYgKHRoaXMuX2lzUmVhZHkpIHJldHVyblxuXG4gICAgY29uc3QgdHJhbnNhY3Rpb25Db21wbGV0aW9uID0gZGIuaW5zaWRlVHJhbnNhY3Rpb24oKSA/IGRiLnRyYW5zYWN0aW9uQ29tcGxldGlvbigpIDogbnVsbFxuICAgIGNvbnN0IHRyYW5zYWN0aW9uUmVhZHkgPSB0aGlzLl90cmFuc2FjdGlvblJlYWR5UHJvbWlzZXMuZ2V0KGRiKVxuXG4gICAgaWYgKHRyYW5zYWN0aW9uQ29tcGxldGlvbiAmJiB0cmFuc2FjdGlvblJlYWR5Py5jb21wbGV0aW9uID09PSB0cmFuc2FjdGlvbkNvbXBsZXRpb24pIHtcbiAgICAgIGF3YWl0IHRyYW5zYWN0aW9uUmVhZHkucHJvbWlzZVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKHRoaXMuX3JlYWR5UHJvbWlzZSkge1xuICAgICAgY29uc3QgcmVhZHlQcm9taXNlID0gdGhpcy5fcmVhZHlQcm9taXNlXG5cbiAgICAgIGF3YWl0IHJlYWR5UHJvbWlzZVxuICAgICAgaWYgKHRoaXMuX3JlYWR5UHJvbWlzZSA9PT0gcmVhZHlQcm9taXNlKSB0aGlzLl9yZWFkeVByb21pc2UgPSBudWxsXG4gICAgICBpZiAodGhpcy5faXNSZWFkeSkgcmV0dXJuXG5cbiAgICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKHRyYW5zYWN0aW9uQ29tcGxldGlvbikge1xuICAgICAgY29uc3QgdGFibGVSZWFkeVByb21pc2UgPSB0aGlzLl9lbnN1cmVTY29wZXNUYWJsZShkYilcbiAgICAgIGNvbnN0IHRyYW5zYWN0aW9uUmVhZHlQcm9taXNlID0gdGFibGVSZWFkeVByb21pc2UudGhlbigoKSA9PiB1bmRlZmluZWQpXG5cbiAgICAgIGNvbnN0IGR1cmFibGVSZWFkeVByb21pc2UgPSB0YWJsZVJlYWR5UHJvbWlzZS50aGVuKGFzeW5jIChjcmVhdGVkKSA9PiB7XG4gICAgICAgIGlmICghY3JlYXRlZCkge1xuICAgICAgICAgIHRoaXMuX2lzUmVhZHkgPSB0cnVlXG4gICAgICAgICAgcmV0dXJuXG4gICAgICAgIH1cblxuICAgICAgICBhd2FpdCB0cmFuc2FjdGlvbkNvbXBsZXRpb25cbiAgICAgIH0pXG5cbiAgICAgIHRoaXMuX3RyYW5zYWN0aW9uUmVhZHlQcm9taXNlcy5zZXQoZGIsIHtjb21wbGV0aW9uOiB0cmFuc2FjdGlvbkNvbXBsZXRpb24sIHByb21pc2U6IHRyYW5zYWN0aW9uUmVhZHlQcm9taXNlfSlcbiAgICAgIHRoaXMuX3JlYWR5UHJvbWlzZSA9IGR1cmFibGVSZWFkeVByb21pc2VcbiAgICAgIGF3YWl0IHRyYW5zYWN0aW9uUmVhZHlQcm9taXNlXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0aGlzLl9yZWFkeVByb21pc2UgPSB0aGlzLl9lbnN1cmVTY29wZXNUYWJsZShkYikudGhlbigoKSA9PiB7XG4gICAgICB0aGlzLl9pc1JlYWR5ID0gdHJ1ZVxuICAgIH0pXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5fcmVhZHlQcm9taXNlXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGlmICghdGhpcy5faXNSZWFkeSkgdGhpcy5fcmVhZHlQcm9taXNlID0gbnVsbFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBGaW5kcyBvciBjcmVhdGVzIHRoZSBzY29wZSByb3cgZm9yIGEgc2VyaWFsaXplZCBzY29wZSwgcmVhY3RpdmF0aW5nIHJlbW92ZWQgc2NvcGVzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU2VyaWFsaXplZFN5bmNTY29wZX0gc2NvcGUgLSBTZXJpYWxpemVkIHN5bmMgc2NvcGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFN5bmNTY29wZVJvdz59IFBlcnNpc3RlZCBzY29wZSByb3cuXG4gICAqL1xuICBhc3luYyBmaW5kT3JDcmVhdGVTY29wZShzY29wZSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgY29uc3QgZGlnZXN0ID0gc2NvcGVEaWdlc3RGb3JTY29wZShzY29wZSlcblxuICAgIGlmICh0aGlzLl91c2VzTWVtb3J5U3RvcmFnZSgpKSB7XG4gICAgICBjb25zdCBleGlzdGluZ1Njb3BlID0gdGhpcy5fbWVtb3J5U2NvcGVzLmdldChkaWdlc3QpXG5cbiAgICAgIGlmIChleGlzdGluZ1Njb3BlKSB7XG4gICAgICAgIGlmIChleGlzdGluZ1Njb3BlLnN0YXRlICE9PSBcImFjdGl2ZVwiKSBleGlzdGluZ1Njb3BlLnN0YXRlID0gXCJhY3RpdmVcIlxuXG4gICAgICAgIHJldHVybiBleGlzdGluZ1Njb3BlXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IG5ld1Njb3BlID0ge1xuICAgICAgICBjb25kaXRpb25zOiBzY29wZS5jb25kaXRpb25zLFxuICAgICAgICBjdXJzb3JQYXlsb2FkOiBudWxsLFxuICAgICAgICBpZDogbmV3IFVVSUQoNCkuZm9ybWF0KCksXG4gICAgICAgIHJlc291cmNlVHlwZTogc2NvcGUucmVzb3VyY2VUeXBlID8/IG51bGwsXG4gICAgICAgIHNjb3BlRGlnZXN0OiBkaWdlc3QsXG4gICAgICAgIHN0YXRlOiBcImFjdGl2ZVwiLFxuICAgICAgICBzdG9yZUlkZW50aXR5OiB0aGlzLnN0b3JlSWRlbnRpdHlcbiAgICAgIH1cblxuICAgICAgdGhpcy5fbWVtb3J5U2NvcGVzLnNldChkaWdlc3QsIG5ld1Njb3BlKVxuXG4gICAgICByZXR1cm4gbmV3U2NvcGVcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3QgZXhpc3RpbmdSb3cgPSBhd2FpdCB0aGlzLl9yb3dCeVNjb3BlRGlnZXN0KGRiLCBkaWdlc3QpXG5cbiAgICAgIGlmIChleGlzdGluZ1Jvdykge1xuICAgICAgICBpZiAoZXhpc3RpbmdSb3cuc3RhdGUgIT09IFwiYWN0aXZlXCIpIHtcbiAgICAgICAgICBhd2FpdCBkYi51cGRhdGUoe2NvbmRpdGlvbnM6IHtpZDogZXhpc3RpbmdSb3cuaWR9LCBkYXRhOiB7c3RhdGU6IFwiYWN0aXZlXCIsIHVwZGF0ZWRfYXQ6IG5ldyBEYXRlKCl9LCB0YWJsZU5hbWU6IFRBQkxFX05BTUV9KVxuICAgICAgICAgIGV4aXN0aW5nUm93LnN0YXRlID0gXCJhY3RpdmVcIlxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGV4aXN0aW5nUm93XG4gICAgICB9XG5cbiAgICAgIGF3YWl0IGRiLmluc2VydCh7XG4gICAgICAgIHRhYmxlTmFtZTogVEFCTEVfTkFNRSxcbiAgICAgICAgZGF0YToge1xuICAgICAgICAgIGNvbmRpdGlvbnNfanNvbjogc3RhYmxlSnNvblN0cmluZ2lmeShzY29wZS5jb25kaXRpb25zKSxcbiAgICAgICAgICBjcmVhdGVkX2F0OiBuZXcgRGF0ZSgpLFxuICAgICAgICAgIGN1cnNvcl9qc29uOiBudWxsLFxuICAgICAgICAgIGlkOiBuZXcgVVVJRCg0KS5mb3JtYXQoKSxcbiAgICAgICAgICAvLyBUaGUgYWxsLXR5cGVzICh1c2VyKSBzY29wZSBoYXMgbm8gcmVzb3VyY2UgdHlwZTsgdGhlIGNvbHVtbiBpcyBub24tbnVsbCwgc28gaXRcbiAgICAgICAgICAvLyBzdG9yZXMgYXMgYW4gZW1wdHkgc3RyaW5nIGFuZCBub3JtYWxpemVzIGJhY2sgdG8gbnVsbCBvbiByZWFkLlxuICAgICAgICAgIHJlc291cmNlX3R5cGU6IHNjb3BlLnJlc291cmNlVHlwZSA/PyBcIlwiLFxuICAgICAgICAgIHNjb3BlX2RpZ2VzdDogZGlnZXN0LFxuICAgICAgICAgIHN0YXRlOiBcImFjdGl2ZVwiLFxuICAgICAgICAgIHVwZGF0ZWRfYXQ6IG5ldyBEYXRlKClcbiAgICAgICAgfVxuICAgICAgfSlcblxuICAgICAgY29uc3QgY3JlYXRlZFJvdyA9IGF3YWl0IHRoaXMuX3Jvd0J5U2NvcGVEaWdlc3QoZGIsIGRpZ2VzdClcblxuICAgICAgaWYgKCFjcmVhdGVkUm93KSB0aHJvdyBuZXcgRXJyb3IoXCJGYWlsZWQgdG8gcGVyc2lzdCBzeW5jIHNjb3BlXCIpXG5cbiAgICAgIHJldHVybiBjcmVhdGVkUm93XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGFsbCBhY3RpdmUgc2NvcGUgcm93cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8U3luY1Njb3BlUm93W10+fSBBY3RpdmUgc2NvcGUgcm93cy5cbiAgICovXG4gIGFzeW5jIGFjdGl2ZVNjb3BlcygpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGlmICh0aGlzLl91c2VzTWVtb3J5U3RvcmFnZSgpKSB7XG4gICAgICByZXR1cm4gWy4uLnRoaXMuX21lbW9yeVNjb3Blcy52YWx1ZXMoKV0uZmlsdGVyKChzY29wZSkgPT4gc2NvcGUuc3RhdGUgPT09IFwiYWN0aXZlXCIpXG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IHtcbiAgICAgIGNvbnN0IHJvd3MgPSAvKiogQHR5cGUge0FycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59ICovIChhd2FpdCBkYlxuICAgICAgICAubmV3UXVlcnkoKVxuICAgICAgICAuZnJvbShUQUJMRV9OQU1FKVxuICAgICAgICAud2hlcmUoe3N0YXRlOiBcImFjdGl2ZVwifSlcbiAgICAgICAgLm9yZGVyKFwiY3JlYXRlZF9hdCBBU0NcIilcbiAgICAgICAgLnJlc3VsdHMoKSlcblxuICAgICAgcmV0dXJuIHJvd3MubWFwKChyb3cpID0+IHRoaXMuX25vcm1hbGl6ZVNjb3BlUm93KHJvdykpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBMb2FkcyB0aGUgcGVyc2lzdGVkIGN1cnNvciBwYXlsb2FkIGZvciBhIHNjb3BlIHJvdy5cbiAgICogQHBhcmFtIHtTeW5jU2NvcGVSb3d9IHNjb3BlUm93IC0gU2NvcGUgcm93LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmcgfCBudWxsPn0gQ3Vyc29yIEpTT04gcGF5bG9hZC5cbiAgICovXG4gIGFzeW5jIGxvYWRDdXJzb3Ioc2NvcGVSb3cpIHtcbiAgICB0aGlzLl9hc3NlcnRTY29wZVJvdyhzY29wZVJvdylcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGlmICh0aGlzLl91c2VzTWVtb3J5U3RvcmFnZSgpKSB7XG4gICAgICBjb25zdCBjdXJyZW50U2NvcGUgPSB0aGlzLl9tZW1vcnlTY29wZXMuZ2V0KHNjb3BlUm93LnNjb3BlRGlnZXN0KVxuXG4gICAgICByZXR1cm4gY3VycmVudFNjb3BlPy5pZCA9PT0gc2NvcGVSb3cuaWQgPyBjdXJyZW50U2NvcGUuY3Vyc29yUGF5bG9hZCA6IG51bGxcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4ge1xuICAgICAgY29uc3Qgcm93ID0gYXdhaXQgdGhpcy5fcm93QnlTY29wZURpZ2VzdChkYiwgc2NvcGVSb3cuc2NvcGVEaWdlc3QpXG5cbiAgICAgIHJldHVybiByb3c/LmlkID09PSBzY29wZVJvdy5pZCA/IHJvdy5jdXJzb3JQYXlsb2FkIDogbnVsbFxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUGVyc2lzdHMgdGhlIGFja25vd2xlZGdlZCBjdXJzb3IgZm9yIGEgc2NvcGUgcm93LlxuICAgKiBAcGFyYW0ge1N5bmNTY29wZVJvd30gc2NvcGVSb3cgLSBTY29wZSByb3cuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9zeW5jLWFwaS1jbGllbnQtdHlwZXMuanNcIikuU3luY0N1cnNvcn0gY3Vyc29yIC0gQWNrbm93bGVkZ2VkIGN1cnNvci5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBzYXZlQ3Vyc29yKHNjb3BlUm93LCBjdXJzb3IpIHtcbiAgICB0aGlzLl9hc3NlcnRTY29wZVJvdyhzY29wZVJvdylcbiAgICBpZiAoIWN1cnNvcikgcmV0dXJuXG5cbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJlYWR5KClcblxuICAgIGNvbnN0IGN1cnNvclBheWxvYWQgPSBKU09OLnN0cmluZ2lmeShjdXJzb3IpXG5cbiAgICBpZiAodGhpcy5fdXNlc01lbW9yeVN0b3JhZ2UoKSkge1xuICAgICAgY29uc3QgbWVtb3J5U2NvcGUgPSB0aGlzLl9tZW1vcnlTY29wZXMuZ2V0KHNjb3BlUm93LnNjb3BlRGlnZXN0KVxuXG4gICAgICBpZiAoIW1lbW9yeVNjb3BlKSB0aHJvdyBuZXcgRXJyb3IoYE5vIHN5bmMgc2NvcGUgZm91bmQgZm9yOiAke3Njb3BlUm93LnNjb3BlRGlnZXN0fWApXG4gICAgICBpZiAobWVtb3J5U2NvcGUuaWQgIT09IHNjb3BlUm93LmlkIHx8IG1lbW9yeVNjb3BlLnN0YXRlICE9PSBcImFjdGl2ZVwiKSByZXR1cm5cblxuICAgICAgbWVtb3J5U2NvcGUuY3Vyc29yUGF5bG9hZCA9IGN1cnNvclBheWxvYWRcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuX3dpdGhEYihhc3luYyAoZGIpID0+IHtcbiAgICAgIGF3YWl0IGRiLnVwZGF0ZSh7XG4gICAgICAgIGNvbmRpdGlvbnM6IHtpZDogc2NvcGVSb3cuaWQsIHNjb3BlX2RpZ2VzdDogc2NvcGVSb3cuc2NvcGVEaWdlc3QsIHN0YXRlOiBcImFjdGl2ZVwifSxcbiAgICAgICAgZGF0YToge2N1cnNvcl9qc29uOiBjdXJzb3JQYXlsb2FkLCB1cGRhdGVkX2F0OiBuZXcgRGF0ZSgpfSxcbiAgICAgICAgdGFibGVOYW1lOiBUQUJMRV9OQU1FXG4gICAgICB9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogRGVhY3RpdmF0ZXMgdGhlIHNjb3BlIHJvdyBmb3IgYSBzZXJpYWxpemVkIHNjb3BlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU2VyaWFsaXplZFN5bmNTY29wZX0gc2NvcGUgLSBTZXJpYWxpemVkIHN5bmMgc2NvcGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgZGVhY3RpdmF0ZShzY29wZSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUmVhZHkoKVxuXG4gICAgY29uc3QgZGlnZXN0ID0gc2NvcGVEaWdlc3RGb3JTY29wZShzY29wZSlcblxuICAgIGlmICh0aGlzLl91c2VzTWVtb3J5U3RvcmFnZSgpKSB7XG4gICAgICBjb25zdCBtZW1vcnlTY29wZSA9IHRoaXMuX21lbW9yeVNjb3Blcy5nZXQoZGlnZXN0KVxuXG4gICAgICBpZiAobWVtb3J5U2NvcGUpIG1lbW9yeVNjb3BlLnN0YXRlID0gXCJyZW1vdmVkXCJcblxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4ge1xuICAgICAgYXdhaXQgZGIudXBkYXRlKHtjb25kaXRpb25zOiB7c2NvcGVfZGlnZXN0OiBkaWdlc3R9LCBkYXRhOiB7c3RhdGU6IFwicmVtb3ZlZFwiLCB1cGRhdGVkX2F0OiBuZXcgRGF0ZSgpfSwgdGFibGVOYW1lOiBUQUJMRV9OQU1FfSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIEF0b21pY2FsbHkgZGVhY3RpdmF0ZXMgc2VsZWN0ZWQgc2NvcGVzLCBjbGVhcnMgdGhlaXIgY3Vyc29ycyBhbmQgcm90YXRlc1xuICAgKiB0aGVpciByb3cgaWRlbnRpdGllcy4gQSBjdXJzb3Igc2F2ZSBjYXJyeWluZyBhIHByZS1yZXNldCByb3cgaWRlbnRpdHkgY2FuXG4gICAqIHRoZXJlZm9yZSBuZXZlciByZXBvcHVsYXRlIHRoZSByZXNldCBzY29wZS4gVGhlIG9wdGlvbmFsIGNsZWFudXAgaG9vayBydW5zXG4gICAqIGluc2lkZSB0aGUgc2FtZSBkYXRhYmFzZSB0cmFuc2FjdGlvbiwgYWxsb3dpbmcgYW4gYXBwIHRvIHB1cmdlIHRoZSBsb2NhbFxuICAgKiByb3dzIG93bmVkIGJ5IHRob3NlIHNjb3BlcyB3aXRob3V0IGEgY3Vyc29yL2NhY2hlIHNwbGl0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU2VyaWFsaXplZFN5bmNTY29wZVtdfSBzY29wZXMgLSBTZWxlY3RlZCBzY29wZXMgdG8gcmVzZXQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbb3B0aW9uc10gLSBSZXNldCBvcHRpb25zLlxuICAgKiBAcGFyYW0geyhhcmdzOiB7Y29ubmVjdGlvbjogaW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQgfCBudWxsLCBzY29wZXM6IGltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU2VyaWFsaXplZFN5bmNTY29wZVtdfSkgPT4gUHJvbWlzZTx2b2lkPiB8IHZvaWR9IFtvcHRpb25zLmNsZWFudXBdIC0gQXBwLW93bmVkIGxvY2FsLXJvdyBjbGVhbnVwIGhvb2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgcmVzZXQoc2NvcGVzLCB7Y2xlYW51cH0gPSB7fSkge1xuICAgIGlmICghQXJyYXkuaXNBcnJheShzY29wZXMpIHx8IHNjb3Blcy5sZW5ndGggPT09IDApIHRocm93IG5ldyBFcnJvcihcIlN5bmNTY29wZVN0b3JlLnJlc2V0IHJlcXVpcmVzIGF0IGxlYXN0IG9uZSBzZXJpYWxpemVkIHNjb3BlXCIpXG4gICAgaWYgKGNsZWFudXAgIT09IHVuZGVmaW5lZCAmJiB0eXBlb2YgY2xlYW51cCAhPT0gXCJmdW5jdGlvblwiKSB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jU2NvcGVTdG9yZS5yZXNldCBjbGVhbnVwIG11c3QgYmUgYSBmdW5jdGlvblwiKVxuXG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSZWFkeSgpXG5cbiAgICBjb25zdCB1bmlxdWVTY29wZXMgPSBbLi4ubmV3IE1hcChzY29wZXMubWFwKChzY29wZSkgPT4gW3Njb3BlRGlnZXN0Rm9yU2NvcGUoc2NvcGUpLCBzY29wZV0pKS52YWx1ZXMoKV1cblxuICAgIGlmICh0aGlzLl91c2VzTWVtb3J5U3RvcmFnZSgpKSB7XG4gICAgICBpZiAoY2xlYW51cCkgYXdhaXQgY2xlYW51cCh7Y29ubmVjdGlvbjogbnVsbCwgc2NvcGVzOiB1bmlxdWVTY29wZXN9KVxuXG4gICAgICBmb3IgKGNvbnN0IHNjb3BlIG9mIHVuaXF1ZVNjb3BlcykgdGhpcy5fcmVzZXRNZW1vcnlTY29wZShzY29wZSlcblxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5fd2l0aERiKGFzeW5jIChkYikgPT4ge1xuICAgICAgYXdhaXQgZGIudHJhbnNhY3Rpb24oYXN5bmMgKCkgPT4ge1xuICAgICAgICBpZiAoY2xlYW51cCkgYXdhaXQgY2xlYW51cCh7Y29ubmVjdGlvbjogZGIsIHNjb3BlczogdW5pcXVlU2NvcGVzfSlcblxuICAgICAgICBmb3IgKGNvbnN0IHNjb3BlIG9mIHVuaXF1ZVNjb3BlcykgYXdhaXQgdGhpcy5fcmVzZXREYXRhYmFzZVNjb3BlKHtkYiwgc2NvcGV9KVxuICAgICAgfSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc2V0cyBvbmUgbWVtb3J5LWJhY2tlZCBzY29wZSB3aGlsZSBwcmVzZXJ2aW5nIHJlcGVhdGVkLXJlc2V0IGlkZW1wb3RlbmNlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU2VyaWFsaXplZFN5bmNTY29wZX0gc2NvcGUgLSBTY29wZSB0byByZXNldC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfcmVzZXRNZW1vcnlTY29wZShzY29wZSkge1xuICAgIGNvbnN0IGRpZ2VzdCA9IHNjb3BlRGlnZXN0Rm9yU2NvcGUoc2NvcGUpXG4gICAgY29uc3QgbWVtb3J5U2NvcGUgPSB0aGlzLl9tZW1vcnlTY29wZXMuZ2V0KGRpZ2VzdClcblxuICAgIGlmICghbWVtb3J5U2NvcGUgfHwgKG1lbW9yeVNjb3BlLnN0YXRlID09PSBcInJlbW92ZWRcIiAmJiBtZW1vcnlTY29wZS5jdXJzb3JQYXlsb2FkID09PSBudWxsKSkgcmV0dXJuXG5cbiAgICB0aGlzLl9tZW1vcnlTY29wZXMuc2V0KGRpZ2VzdCwge1xuICAgICAgLi4ubWVtb3J5U2NvcGUsXG4gICAgICBjdXJzb3JQYXlsb2FkOiBudWxsLFxuICAgICAgaWQ6IG5ldyBVVUlEKDQpLmZvcm1hdCgpLFxuICAgICAgc3RhdGU6IFwicmVtb3ZlZFwiXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNldHMgb25lIGRhdGFiYXNlLWJhY2tlZCBzY29wZSB3aGlsZSBwcmVzZXJ2aW5nIHJlcGVhdGVkLXJlc2V0IGlkZW1wb3RlbmNlLlxuICAgKiBAcGFyYW0ge3tkYjogaW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQsIHNjb3BlOiBpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlNlcmlhbGl6ZWRTeW5jU2NvcGV9fSBhcmdzIC0gRGF0YWJhc2UgYW5kIHNjb3BlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIF9yZXNldERhdGFiYXNlU2NvcGUoe2RiLCBzY29wZX0pIHtcbiAgICBjb25zdCBkaWdlc3QgPSBzY29wZURpZ2VzdEZvclNjb3BlKHNjb3BlKVxuICAgIGNvbnN0IGV4aXN0aW5nUm93ID0gYXdhaXQgdGhpcy5fcm93QnlTY29wZURpZ2VzdChkYiwgZGlnZXN0KVxuXG4gICAgaWYgKCFleGlzdGluZ1JvdyB8fCAoZXhpc3RpbmdSb3cuc3RhdGUgPT09IFwicmVtb3ZlZFwiICYmIGV4aXN0aW5nUm93LmN1cnNvclBheWxvYWQgPT09IG51bGwpKSByZXR1cm5cblxuICAgIGF3YWl0IGRiLnVwZGF0ZSh7XG4gICAgICBjb25kaXRpb25zOiB7aWQ6IGV4aXN0aW5nUm93LmlkLCBzY29wZV9kaWdlc3Q6IGRpZ2VzdH0sXG4gICAgICBkYXRhOiB7Y3Vyc29yX2pzb246IG51bGwsIGlkOiBuZXcgVVVJRCg0KS5mb3JtYXQoKSwgc3RhdGU6IFwicmVtb3ZlZFwiLCB1cGRhdGVkX2F0OiBuZXcgRGF0ZSgpfSxcbiAgICAgIHRhYmxlTmFtZTogVEFCTEVfTkFNRVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogV2hldGhlciB0aGUgc3RvcmUgcnVucyB3aXRob3V0IGEgY29uZmlndXJlZCBkYXRhYmFzZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IFdoZXRoZXIgbWVtb3J5IHN0b3JhZ2UgaXMgdXNlZC5cbiAgICovXG4gIF91c2VzTWVtb3J5U3RvcmFnZSgpIHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuICF0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RGF0YWJhc2VDb25maWd1cmF0aW9uKClbdGhpcy5kYXRhYmFzZUlkZW50aWZpZXJdXG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGEgY2FsbGJhY2sgd2l0aCBhIGRhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEB0ZW1wbGF0ZSBSZXN1bHRcbiAgICogQHBhcmFtIHsoZGI6IGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0KSA9PiBQcm9taXNlPFJlc3VsdD59IGNhbGxiYWNrIC0gRGF0YWJhc2UgY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlc3VsdD59IENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIF93aXRoRGIoY2FsbGJhY2spIHtcbiAgICBpZiAodGhpcy50ZW5hbnRIYW5kbGUpIHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLnRlbmFudEhhbmRsZS5kYXRhYmFzZU9wZXJhdGlvbih7ZGF0YWJhc2VJZGVudGlmaWVyOiB0aGlzLmRhdGFiYXNlSWRlbnRpZmllciwgbmFtZTogXCJUZW5hbnQgc3luYyBzY29wZSBzdG9yZVwifSwgYXN5bmMgKG9wZXJhdGlvbikgPT4ge1xuICAgICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2sob3BlcmF0aW9uLmNvbm5lY3Rpb24oKSlcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5lbnN1cmVDb25uZWN0aW9ucyh7ZGF0YWJhc2VJZGVudGlmaWVyczogW3RoaXMuZGF0YWJhc2VJZGVudGlmaWVyXSwgbmFtZTogXCJTeW5jIHNjb3BlIHN0b3JlXCJ9LCBhc3luYyAoZGJzKSA9PiB7XG4gICAgICBjb25zdCBkYiA9IGRic1t0aGlzLmRhdGFiYXNlSWRlbnRpZmllcl1cblxuICAgICAgaWYgKCFkYikgdGhyb3cgbmV3IEVycm9yKGBObyBkYXRhYmFzZSBjb25uZWN0aW9uIGF2YWlsYWJsZSBmb3IgaWRlbnRpZmllcjogJHt0aGlzLmRhdGFiYXNlSWRlbnRpZmllcn1gKVxuXG4gICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soZGIpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBFbnN1cmVzIHRoZSBzY29wZXMgdGFibGUgZXhpc3RzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSBXaGV0aGVyIHRoZSB0YWJsZSBoYWQgdG8gYmUgY3JlYXRlZC5cbiAgICovXG4gIGFzeW5jIF9lbnN1cmVTY29wZXNUYWJsZShkYikge1xuICAgIGlmIChhd2FpdCBkYi50YWJsZUV4aXN0cyhUQUJMRV9OQU1FKSkgcmV0dXJuIGZhbHNlXG5cbiAgICBjb25zdCB0YWJsZSA9IG5ldyBUYWJsZURhdGEoVEFCTEVfTkFNRSwge2lmTm90RXhpc3RzOiB0cnVlfSlcblxuICAgIHRhYmxlLnN0cmluZyhcImlkXCIsIHtudWxsOiBmYWxzZSwgcHJpbWFyeUtleTogdHJ1ZX0pXG4gICAgdGFibGUuc3RyaW5nKFwic2NvcGVfZGlnZXN0XCIsIHtpbmRleDogdHJ1ZSwgbnVsbDogZmFsc2V9KVxuICAgIHRhYmxlLnN0cmluZyhcInJlc291cmNlX3R5cGVcIiwge2luZGV4OiB0cnVlLCBudWxsOiBmYWxzZX0pXG4gICAgdGFibGUudGV4dChcImNvbmRpdGlvbnNfanNvblwiLCB7bnVsbDogZmFsc2V9KVxuICAgIHRhYmxlLnRleHQoXCJjdXJzb3JfanNvblwiLCB7bnVsbDogdHJ1ZX0pXG4gICAgdGFibGUuc3RyaW5nKFwic3RhdGVcIiwge2luZGV4OiB0cnVlLCBudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuZGF0ZXRpbWUoXCJjcmVhdGVkX2F0XCIsIHtudWxsOiBmYWxzZX0pXG4gICAgdGFibGUuZGF0ZXRpbWUoXCJ1cGRhdGVkX2F0XCIsIHtudWxsOiBmYWxzZX0pXG5cbiAgICBhd2FpdCBkYi5jcmVhdGVUYWJsZSh0YWJsZSlcblxuICAgIHJldHVybiB0cnVlXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYSBzY29wZSByb3cgYnkgaXRzIGRpZ2VzdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZGlnZXN0IC0gRml4ZWQtc2l6ZSBzY29wZSBkaWdlc3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFN5bmNTY29wZVJvdyB8IG51bGw+fSBTY29wZSByb3cgb3IgbnVsbC5cbiAgICovXG4gIGFzeW5jIF9yb3dCeVNjb3BlRGlnZXN0KGRiLCBkaWdlc3QpIHtcbiAgICBjb25zdCByb3dzID0gLyoqIEB0eXBlIHtBcnJheTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAqLyAoYXdhaXQgZGJcbiAgICAgIC5uZXdRdWVyeSgpXG4gICAgICAuZnJvbShUQUJMRV9OQU1FKVxuICAgICAgLndoZXJlKHtzY29wZV9kaWdlc3Q6IGRpZ2VzdH0pXG4gICAgICAubGltaXQoMSlcbiAgICAgIC5yZXN1bHRzKCkpXG5cbiAgICByZXR1cm4gcm93c1swXSA/IHRoaXMuX25vcm1hbGl6ZVNjb3BlUm93KHJvd3NbMF0pIDogbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZXMgYSByYXcgc2NvcGUgdGFibGUgcm93LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gcm93IC0gUmF3IHRhYmxlIHJvdy5cbiAgICogQHJldHVybnMge1N5bmNTY29wZVJvd30gTm9ybWFsaXplZCBzY29wZSByb3cuXG4gICAqL1xuICBfbm9ybWFsaXplU2NvcGVSb3cocm93KSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGNvbmRpdGlvbnM6IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoSlNPTi5wYXJzZShTdHJpbmcocm93LmNvbmRpdGlvbnNfanNvbikpKSxcbiAgICAgIGN1cnNvclBheWxvYWQ6IHJvdy5jdXJzb3JfanNvbiA9PT0gbnVsbCB8fCByb3cuY3Vyc29yX2pzb24gPT09IHVuZGVmaW5lZCA/IG51bGwgOiBTdHJpbmcocm93LmN1cnNvcl9qc29uKSxcbiAgICAgIGlkOiBTdHJpbmcocm93LmlkKSxcbiAgICAgIHJlc291cmNlVHlwZTogU3RyaW5nKHJvdy5yZXNvdXJjZV90eXBlKSA9PT0gXCJcIiA/IG51bGwgOiBTdHJpbmcocm93LnJlc291cmNlX3R5cGUpLFxuICAgICAgc2NvcGVEaWdlc3Q6IFN0cmluZyhyb3cuc2NvcGVfZGlnZXN0KSxcbiAgICAgIHN0YXRlOiBTdHJpbmcocm93LnN0YXRlKSxcbiAgICAgIHN0b3JlSWRlbnRpdHk6IHRoaXMuc3RvcmVJZGVudGl0eVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZWplY3RzIHBhc3NpbmcgYSBzY29wZSByb3cgY2FwdHVyZWQgZnJvbSBhbm90aGVyIHBoeXNpY2FsIHN0b3JlLlxuICAgKiBAcGFyYW0ge1N5bmNTY29wZVJvd30gc2NvcGVSb3cgLSBTY29wZSByb3cgdG8gdmFsaWRhdGUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX2Fzc2VydFNjb3BlUm93KHNjb3BlUm93KSB7XG4gICAgaWYgKHNjb3BlUm93LnN0b3JlSWRlbnRpdHkgIT09IHRoaXMuc3RvcmVJZGVudGl0eSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiU3luYyBzY29wZSByb3cgYmVsb25ncyB0byBhbm90aGVyIHBoeXNpY2FsIHRlbmFudCBkYXRhYmFzZVwiKVxuICAgIH1cbiAgfVxufVxuIl19