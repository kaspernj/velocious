import QueryBase from "./base.js";
import TableData from "../table-data/index.js";
export default class VelociousDatabaseQueryCreateTableBase extends QueryBase {
    ifNotExists: boolean | undefined;
    indexInCreateTable: boolean;
    tableData: TableData;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("../drivers/base.js").default} args.driver - Database driver instance.
     * @param {boolean} [args.ifNotExists] - Whether if not exists.
     * @param {boolean} [args.indexInCreateTable] - Whether index in create table.
     * @param {TableData} args.tableData - Table data.
     */
    constructor({ driver, ifNotExists, indexInCreateTable, tableData }: {
        driver: import("../drivers/base.js").default;
        ifNotExists?: boolean;
        indexInCreateTable?: boolean;
        tableData: TableData;
    });
    /**
     * Runs to sql.
     * @returns {Promise<string[]>} - Resolves with SQL statements.
     */
    toSql(): Promise<string[]>;
}
//# sourceMappingURL=create-table-base.d.ts.map