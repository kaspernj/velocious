import BaseColumn from "../base-column.js";
export default class VelociousDatabaseDriversPgsqlColumn extends BaseColumn {
    data: Record<string, any>;
    table: import("../base-table.js").default;
    /**
     * Runs constructor.
     * @param {import("../base-table.js").default} table - Table.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} data - Data payload.
     */
    constructor(table: import("../base-table.js").default, data: Record<string, ReturnType<typeof JSON.parse>>);
    getAutoIncrement(): boolean;
    getPrimaryKey(): boolean;
    getIndexes(): Promise<import("../base-columns-index.js").default[]>;
    getDefault(): any;
    /**
     * Returns the concrete PostgreSQL type name used in SQL casts.
     * @returns {string} - Schema-qualified domain or UDT name, or the ordinary data type.
     */
    getDatabaseType(): string;
    getMaxLength(): any;
    getName(): any;
    getNotes(): any;
    getNull(): boolean;
    getType(): any;
}
//# sourceMappingURL=column.d.ts.map