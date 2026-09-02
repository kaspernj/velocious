export default class VelociousDatabaseDriversSqliteStructureSql {
    driver: import("../base.js").default;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("../base.js").default} args.driver - Database driver instance.
     */
    constructor({ driver }: {
        driver: import("../base.js").default;
    });
    /**
     * Runs to sql.
     * @returns {Promise<string | null>} - Resolves with SQL string.
     */
    toSql(): Promise<string | null>;
}
//# sourceMappingURL=structure-sql.d.ts.map