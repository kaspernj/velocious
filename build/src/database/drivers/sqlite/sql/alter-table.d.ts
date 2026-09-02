import AlterTableBase from "../../../query/alter-table-base.js";
import Logger from "../../../../logger.js";
import TableData from "../../../table-data/index.js";
import TableForeignKey from "../../../table-data/table-foreign-key.js";
export default class VelociousDatabaseConnectionDriversSqliteSqlAlterTable extends AlterTableBase {
    logger: Logger;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("../../base.js").default} args.driver - Database driver instance.
     * @param {import("../../../table-data/index.js").default} args.tableData - Table data.
     */
    constructor({ driver, tableData, ...restArgs }: {
        driver: import("../../base.js").default;
        tableData: import("../../../table-data/index.js").default;
    });
    /**
     * Runs to sqls.
     * @returns {Promise<string[]>} - Resolves with SQL statements.
     */
    toSQLs(): Promise<string[]>;
    /**
     * Merges the current schema with the alter request to produce the desired final schema
     * and the column copy plan.
     * @param {TableData} currentTableData - Current schema as introspected from the database.
     * @param {TableData} alterTableData - Alter request: new columns (`isNewColumn`), renames (`newName`), drops (`dropColumn`), modifies, and new foreign keys.
     * @returns {{targetTableData: TableData, columnPairs: Array<[string, string]>}} - The merged target schema and the [oldName, newName] pairs for INSERT...SELECT.
     */
    _buildTargetSchema(currentTableData: TableData, alterTableData: TableData): {
        targetTableData: TableData;
        columnPairs: Array<[string, string]>;
    };
    /**
     * Returns the foreign key with its column name updated when the column was renamed in the
     * alter request. SQLite re-creates the constraint inside the rebuilt CREATE TABLE, so a
     * stale column name there would reference a column that no longer exists.
     * @param {TableForeignKey} foreignKey - Foreign key to evaluate.
     * @param {Map<string, string>} columnRenames - Map of old → new column names from the alter request.
     * @returns {TableForeignKey} - The original foreign key, or a fresh instance with the renamed column.
     */
    _renameForeignKeyColumn(foreignKey: TableForeignKey, columnRenames: Map<string, string>): TableForeignKey;
}
//# sourceMappingURL=alter-table.d.ts.map