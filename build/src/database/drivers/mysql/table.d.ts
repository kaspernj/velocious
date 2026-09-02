import BaseTable from "../base-table.js";
import Column from "./column.js";
import ColumnsIndex from "./columns-index.js";
import ForeignKey from "./foreign-key.js";
export default class VelociousDatabaseDriversMysqlTable extends BaseTable {
    data: Record<string, string>;
    driver: import("../base.js").default;
    /**
     * Runs constructor.
     * @param {import("../base.js").default} driver - Database driver instance.
     * @param {Record<string, string>} data - Data payload.
     */
    constructor(driver: import("../base.js").default, data: Record<string, string>);
    getColumns(): Promise<Column[]>;
    getForeignKeys(): Promise<ForeignKey[]>;
    getIndexes(): Promise<ColumnsIndex[]>;
    /**
     * Runs get name.
     * @returns {string} - The table name.
     */
    getName(): string;
}
//# sourceMappingURL=table.d.ts.map