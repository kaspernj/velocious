import BaseCommand from "../../../base-command.js";
export default class DbTenantsDrop extends BaseCommand {
    /**
     * Drops the tenant database/schema for every listed tenant through the provider's
     * `dropDatabase` hook, or the framework default when the provider defines none.
     * @returns {Promise<{identifier: string, tenantCount: number} | void>} - Result in test mode.
     */
    execute(): Promise<{
        identifier: string;
        tenantCount: number;
    } | void>;
}
//# sourceMappingURL=drop.d.ts.map