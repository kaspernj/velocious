export default class VelociousDatabaseDriversMysqlStructureSql {
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
     * Orders tables so referenced tables are created before their dependents.
     * @param {object} args - Options object.
     * @param {Array<Record<string, ReturnType<typeof JSON.parse>>>} args.foreignKeyRows - Foreign key metadata rows.
     * @param {string[]} args.tableNames - Base table names in their existing order.
     * @returns {string[]} - Ordered table names.
     */
    _orderBaseTables({ foreignKeyRows, tableNames }: {
        foreignKeyRows: Array<Record<string, ReturnType<typeof JSON.parse>>>;
        tableNames: string[];
    }): string[];
    /**
     * Runs is maria db.
     * @returns {Promise<boolean>} - Resolves with Whether maria db.
     */
    _isMariaDb(): Promise<boolean>;
    /**
     * Runs mysql create statement.
     * @param {Record<string, ReturnType<typeof JSON.parse>> | undefined} row - Row data.
     * @returns {string | null} - SQL string.
     */
    _mysqlCreateStatement(row: Record<string, ReturnType<typeof JSON.parse>> | undefined): string | null;
    /**
     * Runs strip auto increment.
     * @param {string} statement - Statement.
     * @returns {string} - Statement without auto increment.
     */
    _stripAutoIncrement(statement: string): string;
}
//# sourceMappingURL=structure-sql.d.ts.map