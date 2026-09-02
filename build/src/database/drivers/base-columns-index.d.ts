export default class VelociousDatabaseDriversBaseColumnsIndex {
    data: object;
    table: import("./base-table.js").default;
    /**
     * Runs constructor.
     * @param {import("./base-table.js").default} table - Table.
     * @param {object} data - Data payload.
     */
    constructor(table: import("./base-table.js").default, data: object);
    /**
     * Runs get column names.
     * @abstract
     * @returns {string[]} - The column names.
     */
    getColumnNames(): string[];
    /**
     * Runs get driver.
     * @returns {import("./base.js").default} - The driver.
     */
    getDriver(): import("./base.js").default;
    /**
     * Runs get name.
     * @returns {string} - The name.
     */
    getName(): string;
    /**
     * Runs get options.
     * @returns {import("../query-parser/options.js").default} - The options options.
     */
    getOptions(): import("../query-parser/options.js").default;
    /**
     * Runs get table.
     * @returns {import("./base-table.js").default} - The table.
     */
    getTable(): import("./base-table.js").default;
    /**
     * Runs get table data index.
     * @abstract
     * @returns {import("../table-data/table-index.js").default} - The table data index.
     */
    getTableDataIndex(): import("../table-data/table-index.js").default;
    /**
     * Runs is primary key.
     * @returns {boolean} - Whether primary key.
     */
    isPrimaryKey(): boolean;
    /**
     * Runs is unique.
     * @returns {boolean} - Whether unique.
     */
    isUnique(): boolean;
}
//# sourceMappingURL=base-columns-index.d.ts.map