export default class TenantMigrationPendingInspector {
    configuration: import("../../configuration.js").default;
    identifier: string;
    migrationVersions: string[];
    tenants: any[];
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
     * @param {string} args.identifier - Tenant database identifier.
     * @param {number[]} args.migrationVersions - Applicable migration versions.
     * @param {Array<ReturnType<typeof JSON.parse>>} args.tenants - Existing tenant descriptors.
     */
    constructor({ configuration, identifier, migrationVersions, tenants, ...restArgs }: {
        configuration: import("../../configuration.js").default;
        identifier: string;
        migrationVersions: number[];
        tenants: Array<ReturnType<typeof JSON.parse>>;
    });
    /**
     * Reads every existing tenant ledger and reports aggregate pending state.
     * @returns {Promise<{hasPendingMigrations: boolean, identifier: string, migrationCount: number, pendingTenantCount: number, tenantCount: number}>} - Deploy preflight result.
     */
    inspect(): Promise<{
        hasPendingMigrations: boolean;
        identifier: string;
        migrationCount: number;
        pendingTenantCount: number;
        tenantCount: number;
    }>;
    /**
     * Reads one tenant's existing migration ledger without preparing or changing it.
     * @param {ReturnType<typeof JSON.parse>} tenant - Tenant descriptor.
     * @returns {Promise<boolean>} - Whether the tenant has an applicable pending migration.
     */
    tenantHasPendingMigrations(tenant: ReturnType<typeof JSON.parse>): Promise<boolean>;
}
//# sourceMappingURL=migration-pending-inspector.d.ts.map