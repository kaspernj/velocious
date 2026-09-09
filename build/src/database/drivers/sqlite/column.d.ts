import BaseColumn from "../base-column.js";
export default class VelociousDatabaseDriversSqliteColumn extends BaseColumn {
    column: Record<string, any>;
    driver: import("../base.js").default;
    table: import("../base-table.js").default;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.column - Column.
     * @param {import("../base.js").default} args.driver - Database driver instance.
     * @param {import("../base-table.js").default} args.table - Table.
     */
    constructor({ column, driver, table }: {
        column: Record<string, ReturnType<typeof JSON.parse>>;
        driver: import("../base.js").default;
        table: import("../base-table.js").default;
    });
    getAutoIncrement(): boolean;
    getIndexes(): Promise<import("../base-columns-index.js").default[]>;
    getDefault(): any;
    getName(): any;
    getMaxLength(): number | undefined;
    getNull(): boolean;
    getPrimaryKey(): boolean;
    getType(): any;
}
//# sourceMappingURL=column.d.ts.map