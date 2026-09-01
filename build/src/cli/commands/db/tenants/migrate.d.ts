import BaseCommand from "../../../base-command.js";
export default class DbTenantsMigrate extends BaseCommand {
    /**
     * Runs execute.
     * @returns {Promise<{identifier: string, migrationCount: number, tenantCount: number} | void>} - Result in test mode.
     */
    execute(): Promise<{
        identifier: string;
        migrationCount: number;
        tenantCount: number;
    } | void>;
}
//# sourceMappingURL=migrate.d.ts.map