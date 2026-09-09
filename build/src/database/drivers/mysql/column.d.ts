import BaseColumn from "../base-column.js";
import ColumnsIndex from "./columns-index.js";
export default class VelociousDatabaseDriversMysqlColumn extends BaseColumn {
    data: Record<string, any>;
    table: import("../base-table.js").default;
    /**
     * Runs constructor.
     * @param {import("../base-table.js").default} table - Table.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} data - Data payload.
     */
    constructor(table: import("../base-table.js").default, data: Record<string, ReturnType<typeof JSON.parse>>);
    getAutoIncrement(): any;
    getIndexes(): Promise<ColumnsIndex[]>;
    getDefault(): any;
    getMaxLength(): number | undefined;
    getName(): any;
    getNotes(): any;
    getNull(): boolean;
    getPrimaryKey(): boolean;
    getType(): any;
}
//# sourceMappingURL=column.d.ts.map