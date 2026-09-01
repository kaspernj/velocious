import BaseCommand from "../../base-command.js";
export default class DbBaseCommand extends BaseCommand {
    /**
     * Narrows the runtime value to the documented type.
     * @type {import("../../../database/drivers/base.js").default | undefined} */
    databaseConnection: import("../../../database/drivers/base.js").default | undefined;
    /**
     * Narrows the runtime value to the documented type.
     * @type {Array<object> | undefined} */
    result: Array<object> | undefined;
    /**
     * Runs with direct database connection.
     * @param {object} driverConfiguration - Driver configuration.
     * @param {() => Promise<void>} callback - Callback to run while the connection is open.
     * @returns {Promise<void>} - Resolves when complete.
     */
    withDirectDatabaseConnection(driverConfiguration: object, callback: () => Promise<void>): Promise<void>;
    /**
     * Runs get database connection.
     * @returns {import("../../../database/drivers/base.js").default} - Active database connection.
     */
    getDatabaseConnection(): import("../../../database/drivers/base.js").default;
    /**
     * Runs query or collect sqls.
     * @param {string[]} sqls - SQL statements.
     * @param {(sql: string) => object} resultEntryForSql - Test result entry builder.
     * @returns {Promise<void>} - Resolves when SQLs have been collected or executed.
     */
    queryOrCollectSqls(sqls: string[], resultEntryForSql: (sql: string) => object): Promise<void>;
    /**
     * Runs collect sql results.
     * @param {string[]} sqls - SQL statements.
     * @param {(sql: string) => object} resultEntryForSql - Test result entry builder.
     * @returns {void}
     */
    collectSqlResults(sqls: string[], resultEntryForSql: (sql: string) => object): void;
    /**
     * Runs query sqls.
     * @param {string[]} sqls - SQL statements.
     * @returns {Promise<void>} - Resolves when complete.
     */
    querySqls(sqls: string[]): Promise<void>;
}
//# sourceMappingURL=base-command.d.ts.map