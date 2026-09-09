import QueryBase from "./base.js";
import TableData from "../table-data/index.js";
export default class VelociousDatabaseQueryAlterTableBase extends QueryBase {
    tableData: TableData;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("../drivers/base.js").default} args.driver - Database driver instance.
     * @param {TableData} args.tableData - Table data.
     */
    constructor({ driver, tableData, ...restArgs }: {
        driver: import("../drivers/base.js").default;
        tableData: TableData;
    });
    /**
     * Runs to sqls.
     * @returns {Promise<string[]>} - Resolves with SQL statements.
     */
    toSQLs(): Promise<string[]>;
    /**
     * Runs get drop foreign key sql.
     * @param {import("../table-data/table-foreign-key.js").default} foreignKey - Foreign key to drop.
     * @returns {string} - SQL fragment that removes the foreign key.
     */
    getDropForeignKeySQL(foreignKey: import("../table-data/table-foreign-key.js").default): string;
}
//# sourceMappingURL=alter-table-base.d.ts.map