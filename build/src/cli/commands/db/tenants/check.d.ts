import BaseCommand from "../../../base-command.js";
export default class DbTenantsCheck extends BaseCommand {
    /**
     * Runs execute.
     * @returns {Promise<{identifier: string, tenantCount: number} | void>} - Result in test mode.
     */
    execute(): Promise<{
        identifier: string;
        tenantCount: number;
    } | void>;
}
//# sourceMappingURL=check.d.ts.map