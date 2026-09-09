import QueryBase from "./base.js";
export default class VelociousDatabaseQueryDeleteBase extends QueryBase {
    conditions: Record<string, any>;
    tableName: string;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.conditions - Conditions.
     * @param {import("../drivers/base.js").default} args.driver - Database driver instance.
     * @param {string} args.tableName - Table name.
     */
    constructor({ conditions, driver, tableName }: {
        conditions: Record<string, ReturnType<typeof JSON.parse>>;
        driver: import("../drivers/base.js").default;
        tableName: string;
    });
}
//# sourceMappingURL=delete-base.d.ts.map