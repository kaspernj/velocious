export default class VelociousDatabaseDriversPgsqlStructureSql {
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
    /**
     * Runs column definition.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} column - Column.
     * @returns {string | null} - The column definition.
     */
    _columnDefinition(column: Record<string, ReturnType<typeof JSON.parse>>): string | null;
}
//# sourceMappingURL=structure-sql.d.ts.map