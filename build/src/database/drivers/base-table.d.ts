import TableData from "../table-data/index.js";
export default class VelociousDatabaseDriversBaseTable {
    /**
     * Driver.
     * @type {import("./base.js").default | undefined} */
    driver: import("./base.js").default | undefined;
    /**
     * Runs get column by name.
     * @param {string} columnName - Column name.
     * @returns {Promise<import("./base-column.js").default | undefined>} - Resolves with the column by name.
     */
    getColumnByName(columnName: string): Promise<import("./base-column.js").default | undefined>;
    /**
     * Runs get column by name or fail.
     * @param {string} columnName - Column name.
     * @returns {Promise<import("./base-column.js").default>} - Resolves with the column by name or fail.
     */
    getColumnByNameOrFail(columnName: string): Promise<import("./base-column.js").default>;
    /**
     * Runs get columns.
     * @abstract
     * @returns {Promise<Array<import("./base-column.js").default>>} - Resolves with the columns.
     */
    getColumns(): Promise<Array<import("./base-column.js").default>>;
    /**
     * Runs get driver.
     * @returns {import("./base.js").default} - The driver.
     */
    getDriver(): import("./base.js").default;
    /**
     * Runs get foreign keys.
     * @abstract
     * @returns {Promise<import("./base-foreign-key.js").default[]>} - Resolves with the foreign keys.
     */
    getForeignKeys(): Promise<import("./base-foreign-key.js").default[]>;
    /**
     * Runs get indexes.
     * @abstract
     * @returns {Promise<import("./base-columns-index.js").default[]>} - Resolves with the indexes.
     */
    getIndexes(): Promise<import("./base-columns-index.js").default[]>;
    /**
     * Runs get name.
     * @abstract
     * @returns {string} - The name.
     */
    getName(): string;
    /**
     * Runs get options.
     * @returns {import("../query-parser/options.js").default} - The options options.
     */
    getOptions(): import("../query-parser/options.js").default;
    /**
     * Runs get table data.
     * @returns {Promise<TableData>} - Resolves with the table data.
     */
    getTableData(): Promise<TableData>;
    /**
     * Runs rows count.
     * @returns {Promise<number>} - Resolves with the rows count.
     */
    rowsCount(): Promise<number>;
    /**
     * Runs truncate.
     * @param {{cascade: boolean}} [args] - Truncate options.
     * @returns {Promise<Array<Record<string, ReturnType<typeof JSON.parse>>>>} - Resolves with the truncate.
     */
    truncate(args?: {
        cascade: boolean;
    }): Promise<Array<Record<string, ReturnType<typeof JSON.parse>>>>;
}
//# sourceMappingURL=base-table.d.ts.map