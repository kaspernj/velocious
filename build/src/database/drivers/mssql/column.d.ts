import BaseColumn from "../base-column.js";
export default class VelociousDatabaseDriversMssqlColumn extends BaseColumn {
    data: Record<string, any>;
    table: import("../base-table.js").default;
    /**
     * Runs constructor.
     * @param {import("../base-table.js").default} table - Table.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} data - Data payload.
     */
    constructor(table: import("../base-table.js").default, data: Record<string, ReturnType<typeof JSON.parse>>);
    getAutoIncrement(): boolean;
    getIndexes(): Promise<import("../base-columns-index.js").default[]>;
    getDefault(): any;
    getMaxLength(): any;
    getName(): any;
    getNull(): boolean;
    getPrimaryKey(): boolean;
    getType(): any;
}
//# sourceMappingURL=column.d.ts.map