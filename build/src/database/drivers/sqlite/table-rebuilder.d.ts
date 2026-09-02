import TableData from "../../table-data/index.js";
/**
 * Emits the SQL sequence for SQLite's "rebuild" approach to schema changes.
 *
 * SQLite cannot add/drop foreign-key constraints, drop columns on older
 * versions, change column types, or add CHECK constraints via ALTER TABLE.
 * The standard workaround (https://sqlite.org/lang_altertable.html) is to
 * create a new table with the desired schema, copy rows over, drop the
 * original, and rename the replacement.
 *
 * Caller passes the desired final schema; this class handles the mechanical
 * sequence (CREATE temp / INSERT...SELECT / DROP / RENAME / recreate
 * indexes). Caller is responsible for any FK toggling or transaction setup
 * around the returned SQL — `PRAGMA foreign_keys` is connection-scoped and
 * cannot be flipped inside a transaction, so wrapping policy is left to the
 * caller (see `sql/alter-table.js`).
 */
export default class VelociousDatabaseDriversSqliteTableRebuilder {
    driver: import("../base.js").default;
    originalTableName: string;
    targetTableData: TableData;
    columnPairs: [string, string][];
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("../base.js").default} args.driver - Database driver instance.
     * @param {string} args.originalTableName - Name of the existing table to rebuild.
     * @param {TableData} args.targetTableData - Desired final schema (columns + foreign keys + indexes). The instance's name is overwritten internally during emission.
     * @param {Array<[string, string]>} args.columnPairs - Pairs of [oldColumnName, newColumnName] describing how rows from the original table should populate the rebuilt table.
     */
    constructor({ driver, originalTableName, targetTableData, columnPairs, ...restArgs }: {
        driver: import("../base.js").default;
        originalTableName: string;
        targetTableData: TableData;
        columnPairs: Array<[string, string]>;
    });
    /**
     * Runs to sqls.
     * @returns {Promise<string[]>} - Resolves with SQL statements to execute in order.
     */
    toSQLs(): Promise<string[]>;
}
//# sourceMappingURL=table-rebuilder.d.ts.map