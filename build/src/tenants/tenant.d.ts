import TenantHandle from "./tenant-handle.js";
/**
 * Apartment-style runtime façade for multi-tenant apps. A "tenant" is whatever descriptor
 * object the app's `tenantDatabaseResolver` understands (an account, a project, …); this
 * class is the single discoverable home for switching into a tenant's context, reading the
 * current one, iterating every tenant of a database identifier, and dropping a tenant's
 * database. Switching delegates to {@link Current} (which owns the async-context tenant
 * state) and additionally runs the callback inside `ensureConnections`, initializing registered
 * tenant-switched models whose tables exist before the callback runs. Entering a tenant therefore
 * makes its database immediately queryable — the apartment-style "switch" semantics — without
 * the caller establishing connections or model metadata itself; iteration and drop drive the
 * app's tenant database provider hooks.
 */
export default class Tenant {
    /**
     * Captures an immutable tenant/database handle for explicit browser/native
     * ORM operations. Physical database configurations are resolved now and are
     * never recomputed from later ambient tenant changes.
     * @param {object} tenant - Ordinary or null-prototype JSON-compatible descriptor understood by the app's tenant database resolver.
     * @param {import("../configuration.js").default} [configuration] - Owning configuration.
     * @returns {TenantHandle} - Immutable captured handle.
     */
    static handle(tenant: object, configuration?: import("../configuration.js").default): TenantHandle;
    /**
     * Runs `callback` with `tenant` as the current tenant, restoring the previous tenant after.
     * The callback runs inside `ensureConnections`, so every database identifier the tenant
     * activates (the global database plus the tenant's database) has a checked-out connection
     * available for the callback's duration. Registered tenant-switched models whose tables exist
     * are initialized before the callback runs, so switching into a tenant makes it queryable
     * without the caller wiring up connections or model metadata. Already-checked-out connections
     * and in-progress model initialization promises are reused. The callback receives the active
     * connections keyed by identifier, the same as `ensureConnections`.
     * @template T
     * @param {object} tenant Descriptor understood by the app's tenantDatabaseResolver.
     * @param {(connections: Record<string, import("../database/drivers/base.js").default>) => Promise<T>} callback - Operation to run with the tenant's active connections.
     * @returns {Promise<T>} - Callback result from within the tenant context.
     */
    static with<T>(tenant: object, callback: (connections: Record<string, import("../database/drivers/base.js").default>) => Promise<T>): Promise<T>;
    /**
     * Initializes registered tenant-switched models whose tables exist in the
     * current tenant before runtime callbacks can build synchronous query scopes.
     * Models for absent optional tables remain deferred until they are used.
     * @param {import("../configuration.js").default} configuration - Current configuration.
     * @returns {Promise<void>} - Resolves when available tenant models are initialized.
     */
    static _ensureCurrentTenantModelsInitialized(configuration: import("../configuration.js").default): Promise<void>;
    /**
     * The current tenant descriptor, or undefined when running outside any tenant context.
     * @returns {Record<string, unknown> | undefined} - Current async-context tenant descriptor, if any.
     */
    static current(): Record<string, unknown> | undefined;
    /**
     * Lists the tenants for a database identifier through the provider and runs `callback`
     * within each tenant's context, optionally filtered and several at a time. Like
     * {@link Tenant.with}, the callback runs inside `ensureConnections` after available
     * tenant-switched models are initialized, so each tenant's database is queryable without the
     * caller wiring up connections or model metadata. Returns how many tenants the callback ran
     * for (after filtering).
     * @param {{identifier: string, callback: (args: {databaseConfiguration: import("../configuration-types.js").DatabaseConfigurationType, tenant: ReturnType<typeof JSON.parse>}) => Promise<void>, parallel?: number, filter?: (tenant: ReturnType<typeof JSON.parse>) => boolean, configuration?: import("../configuration.js").default}} args - Tenant database identifier, per-tenant operation, filtering, and concurrency settings.
     * @returns {Promise<number>} - Number of processed tenants.
     */
    static each({ identifier, callback, parallel, filter, configuration }: {
        identifier: string;
        callback: (args: {
            databaseConfiguration: import("../configuration-types.js").DatabaseConfigurationType;
            tenant: ReturnType<typeof JSON.parse>;
        }) => Promise<void>;
        parallel?: number;
        filter?: (tenant: ReturnType<typeof JSON.parse>) => boolean;
        configuration?: import("../configuration.js").default;
    }): Promise<number>;
    /**
     * Runs one aggregate query across many tenant databases and returns the merged result. The
     * tenants may be co-located on the default server or spread across other servers, and can be
     * created or dropped at runtime; the live tenant list is resolved (from `tenants` or the
     * provider's `listTenants`), grouped by server, aggregated with a single cross-database
     * `UNION ALL` where the driver supports it (MySQL/MSSQL) or one query per tenant otherwise
     * (PostgreSQL/SQLite), and merged with each aggregate's own operation. The caller writes only one
     * per-tenant subquery and declares the key columns and aggregates; see
     * {@link import("./tenant-aggregator.js").TenantAggregateOptions}.
     * @param {import("./tenant-aggregator.js").TenantAggregateOptions} options - Aggregate configuration.
     * @returns {Promise<Array<Record<string, ReturnType<typeof JSON.parse>>>>} - One merged row per distinct key-column combination.
     */
    static aggregateAcross(options: import("./tenant-aggregator.js").TenantAggregateOptions): Promise<Array<Record<string, ReturnType<typeof JSON.parse>>>>;
    /**
     * Drops one tenant's database/schema through the provider's `dropDatabase` hook.
     * @param {{identifier: string, tenant: object, configuration?: import("../configuration.js").default}} args - Tenant descriptor and database identifier to drop.
     * @returns {Promise<void>}
     */
    static drop({ identifier, tenant, configuration }: {
        identifier: string;
        tenant: object;
        configuration?: import("../configuration.js").default;
    }): Promise<void>;
}
//# sourceMappingURL=tenant.d.ts.map