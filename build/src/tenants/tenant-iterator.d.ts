/**
 * Runs a callback once within each tenant's context for a tenant database identifier,
 * optionally several tenants at a time. Each tenant is entered with `runWithTenant`, and a
 * tenant whose database identifier is inactive throws rather than running the callback
 * against the wrong connection. When iterating in parallel the per-tenant failures are
 * collected and rethrown together as an `AggregateError` so one bad tenant does not hide the
 * others. This is the iteration engine shared by the `db:tenants:*` CLI commands and the
 * runtime tenant façade; the caller is responsible for producing the tenant list.
 */
export default class TenantIterator {
    configuration: import("../configuration.js").default;
    identifier: string;
    parallelCount: number;
    /**
     * Creates an iterator bound to a configuration and tenant database identifier.
     * @param {{configuration: import("../configuration.js").default, identifier: string, parallelCount?: number}} args - Tenant configuration, database identifier, and concurrency limit.
     */
    constructor({ configuration, identifier, parallelCount }: {
        configuration: import("../configuration.js").default;
        identifier: string;
        parallelCount?: number;
    });
    /**
     * Runs `callback` within each tenant's context and returns how many tenants were processed.
     * @param {Array<ReturnType<typeof JSON.parse>>} tenants - Tenant descriptors to enter and process.
     * @param {(args: {databaseConfiguration: import("../configuration-types.js").DatabaseConfigurationType, tenant: ReturnType<typeof JSON.parse>}) => Promise<void>} callback - Per-tenant operation receiving the active database configuration.
     * @returns {Promise<number>} - Number of processed tenants.
     */
    run(tenants: Array<ReturnType<typeof JSON.parse>>, callback: (args: {
        databaseConfiguration: import("../configuration-types.js").DatabaseConfigurationType;
        tenant: ReturnType<typeof JSON.parse>;
    }) => Promise<void>): Promise<number>;
    /**
     * Enters one tenant's context and runs the callback, asserting the database is active first.
     * @param {{callback: (args: {databaseConfiguration: import("../configuration-types.js").DatabaseConfigurationType, tenant: ReturnType<typeof JSON.parse>}) => Promise<void>, tenant: ReturnType<typeof JSON.parse>}} args - Tenant descriptor and operation to run in its context.
     * @returns {Promise<void>}
     */
    runTenantCallback({ callback, tenant }: {
        callback: (args: {
            databaseConfiguration: import("../configuration-types.js").DatabaseConfigurationType;
            tenant: ReturnType<typeof JSON.parse>;
        }) => Promise<void>;
        tenant: ReturnType<typeof JSON.parse>;
    }): Promise<void>;
    /**
     * Builds a human-readable label for a tenant for use in error messages.
     * @param {ReturnType<typeof JSON.parse>} tenant - Tenant descriptor to identify in an error.
     * @returns {string} - Human-readable tenant label.
     */
    static tenantLabel(tenant: ReturnType<typeof JSON.parse>): string;
}
//# sourceMappingURL=tenant-iterator.d.ts.map