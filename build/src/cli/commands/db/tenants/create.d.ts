import BaseCommand from "../../../base-command.js";
export default class DbTenantsCreate extends BaseCommand {
    /**
     * Runs execute.
     * @returns {Promise<{identifier: string, tenantCount: number} | void>} - Result in test mode.
     */
    execute(): Promise<{
        identifier: string;
        tenantCount: number;
    } | void>;
}
//# sourceMappingURL=create.d.ts.map