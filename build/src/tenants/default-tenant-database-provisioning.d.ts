/**
 * Creates the tenant database for one tenant.
 * @param {{configuration: import("../configuration.js").default, databaseConfiguration: import("../configuration-types.js").DatabaseConfigurationType, identifier?: string, tenant: ReturnType<typeof JSON.parse>}} args - Provisioning arguments.
 * @returns {Promise<void>} - Resolves once the tenant database exists.
 */
export declare function createTenantDatabase({ configuration, databaseConfiguration, identifier, tenant }: {
    configuration: import("../configuration.js").default;
    databaseConfiguration: import("../configuration-types.js").DatabaseConfigurationType;
    identifier?: string;
    tenant: ReturnType<typeof JSON.parse>;
}): Promise<void>;
/**
 * Drops the tenant database for one tenant. Uses `DROP DATABASE IF EXISTS`, so it
 * is a safe no-op for a tenant that was never fully provisioned.
 * @param {{configuration: import("../configuration.js").default, databaseConfiguration: import("../configuration-types.js").DatabaseConfigurationType}} args - Provisioning arguments.
 * @returns {Promise<void>} - Resolves once the tenant database is gone.
 */
export declare function dropTenantDatabase({ configuration, databaseConfiguration }: {
    configuration: import("../configuration.js").default;
    databaseConfiguration: import("../configuration-types.js").DatabaseConfigurationType;
}): Promise<void>;
//# sourceMappingURL=default-tenant-database-provisioning.d.ts.map