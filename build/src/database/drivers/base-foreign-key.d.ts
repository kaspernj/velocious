import TableForeignKey from "../table-data/table-foreign-key.js";
export default class VelociousDatabaseDriversBaseForeignKey {
    data: Record<string, any>;
    /**
     * Table.
     * @type {import("./base-table.js").default | undefined} */
    table: import("./base-table.js").default | undefined;
    /**
     * Runs constructor.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} data - Data payload.
     */
    constructor(data: Record<string, ReturnType<typeof JSON.parse>>);
    /**
     * Runs get column name.
     * @abstract
     * @returns {string} - The column name.
     */
    getColumnName(): string;
    /**
     * Runs get driver.
     * @returns {import("./base.js").default} - The driver.
     */
    getDriver(): import("./base.js").default;
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
     * Runs get referenced column name.
     * @abstract
     * @returns {string} - The referenced column name.
     */
    getReferencedColumnName(): string;
    /**
     * Runs get referenced table name.
     * @abstract
     * @returns {string} - The referenced table name.
     */
    getReferencedTableName(): string;
    /**
     * Runs get table.
     * @returns {import("./base-table.js").default} - The table.
     */
    getTable(): import("./base-table.js").default;
    /**
     * Runs get table name.
     * @abstract
     * @returns {string} - The table name.
     */
    getTableName(): string;
    /**
     * Runs get table data foreign key.
     * @returns {TableForeignKey} - The table data foreign key.
     */
    getTableDataForeignKey(): TableForeignKey;
}
//# sourceMappingURL=base-foreign-key.d.ts.map