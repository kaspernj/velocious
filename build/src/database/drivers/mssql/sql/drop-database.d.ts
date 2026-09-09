import DropDatabaseBase from "../../../query/drop-database-base.js";
export default class VelociousDatabaseConnectionDriversMssqlSqlDropDatabase extends DropDatabaseBase {
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("../../base.js").default} args.driver - Database driver instance.
     * @param {string} args.databaseName - Database name.
     * @param {boolean} [args.ifExists] - Whether if exists.
     */
    constructor({ driver, databaseName, ifExists }: {
        driver: import("../../base.js").default;
        databaseName: string;
        ifExists?: boolean;
    });
    toSql(): string[];
}
//# sourceMappingURL=drop-database.d.ts.map