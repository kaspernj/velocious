import BaseTable from "../base-table.js";
import ColumnsIndex from "./columns-index.js";
import ForeignKey from "./foreign-key.js";
export default class VelociousDatabaseDriversSqliteTable extends BaseTable {
    driver: import("../base.js").default;
    row: Record<string, string | number | null>;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("../base.js").default} args.driver - Database driver instance.
     * @param {Record<string, string | number | null>} args.row - Row data.
     */
    constructor({ driver, row }: {
        driver: import("../base.js").default;
        row: Record<string, string | number | null>;
    });
    /**
     * Runs get columns.
     * @returns {Promise<Array<import("../base-column.js").default>>} - Resolves with the columns.
     */
    getColumns(): Promise<Array<import("../base-column.js").default>>;
    getForeignKeys(): Promise<ForeignKey[]>;
    getIndexes(): Promise<ColumnsIndex[]>;
    /**
     * Runs parse columns from sql.
     * @param {string} sql - SQL string.
     * @returns {string[]} - SQL statements.
     */
    _parseColumnsFromSQL(sql: string): string[];
    /**
     * Runs get name.
     * @returns {string} - The table name.
     */
    getName(): string;
}
//# sourceMappingURL=table.d.ts.map