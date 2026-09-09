import BaseCommand from "../../../../base-command.js";
export default class DbTenantsMigrationsPending extends BaseCommand {
    /**
     * Reports aggregate tenant migration state as one machine-readable JSON object.
     * @returns {Promise<{hasPendingMigrations: boolean, identifier: string, migrationCount: number, pendingTenantCount: number, tenantCount: number}>} - Deploy preflight result.
     */
    execute(): Promise<{
        hasPendingMigrations: boolean;
        identifier: string;
        migrationCount: number;
        pendingTenantCount: number;
        tenantCount: number;
    }>;
}
//# sourceMappingURL=pending.d.ts.map