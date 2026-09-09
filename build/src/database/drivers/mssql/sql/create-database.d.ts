import CreateDatabaseBase from "../../../query/create-database-base.js";
export default class VelociousDatabaseConnectionDriversMssqlSqlCreateDatabase extends CreateDatabaseBase {
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("../../base.js").default} args.driver - Database driver instance.
     * @param {string} args.databaseName - Database name.
     * @param {boolean} [args.ifNotExists] - Whether if not exists.
     */
    constructor({ driver, databaseName, ifNotExists }: {
        driver: import("../../base.js").default;
        databaseName: string;
        ifNotExists?: boolean;
    });
    toSql(): string[];
}
//# sourceMappingURL=create-database.d.ts.map