import QueryBase from "./base.js";
export default class VelociousDatabaseQueryDropTableBase extends QueryBase {
    cascade: boolean | undefined;
    ifExists: boolean | undefined;
    tableName: string;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {boolean} [args.cascade] - Whether cascade.
     * @param {import("./../drivers/base.js").default} args.driver - Database driver instance.
     * @param {boolean} [args.ifExists] - Whether if exists.
     * @param {string} args.tableName - Table name.
     */
    constructor({ cascade, driver, ifExists, tableName, ...restArgs }: {
        cascade?: boolean;
        driver: import("./../drivers/base.js").default;
        ifExists?: boolean;
        tableName: string;
    });
    /**
     * Runs to sqls.
     * @returns {Promise<string[]>} - Resolves with SQL statements.
     */
    toSQLs(): Promise<string[]>;
}
//# sourceMappingURL=drop-table-base.d.ts.map