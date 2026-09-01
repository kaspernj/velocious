import TableColumn from "../table-data/table-column.js";
export default class VelociousDatabaseDriversBaseColumn {
    /**
     * Table.
     * @type {import("./base-table.js").default | undefined} */
    table: import("./base-table.js").default | undefined;
    /**
     * Runs get auto increment.
     * @abstract
     * @returns {boolean} - Whether auto increment.
     */
    getAutoIncrement(): boolean;
    /**
     * Runs get default.
     * @abstract
     * @returns {ReturnType<typeof JSON.parse>} - The default.
     */
    getDefault(): ReturnType<typeof JSON.parse>;
    /**
     * Runs get index by name.
     * @param {string} indexName - Index name.
     * @returns {Promise<import("./base-columns-index.js").default | undefined>} - Resolves with the index by name.
     */
    getIndexByName(indexName: string): Promise<import("./base-columns-index.js").default | undefined>;
    /**
     * Runs change nullable.
     * @param {boolean} nullable Whether the column should be nullable or not.
     * @returns {Promise<void>} - Resolves when complete.
     */
    changeNullable(nullable: boolean): Promise<void>;
    /**
     * Runs get driver.
     * @returns {import("./base.js").default} - The driver.
     */
    getDriver(): import("./base.js").default;
    /**
     * Runs get indexes.
     * @abstract
     * @returns {Promise<Array<import("./base-columns-index.js").default>>} - Resolves with the indexes.
     */
    getIndexes(): Promise<Array<import("./base-columns-index.js").default>>;
    /**
     * Runs get max length.
     * @abstract
     * @returns {number | undefined} - The max length.
     */
    getMaxLength(): number | undefined;
    /**
     * Runs get notes.
     * @returns {string | undefined} - The notes.
     */
    getNotes(): string | undefined;
    /**
     * Runs get name.
     * @abstract
     * @returns {string} - The name.
     */
    getName(): string;
    /**
     * Runs get null.
     * @abstract
     * @returns {boolean} - Whether null.
     */
    getNull(): boolean;
    /**
     * Runs get options.
     * @returns {import("../query-parser/options.js").default} - The options options.
     */
    getOptions(): import("../query-parser/options.js").default;
    /**
     * Runs get primary key.
     * @abstract
     * @returns {boolean} - Whether primary key.
     */
    getPrimaryKey(): boolean;
    /**
     * Runs get table.
     * @returns {import("./base-table.js").default} - The table.
     */
    getTable(): import("./base-table.js").default;
    /**
     * Runs get table data column.
     * @returns {TableColumn} The table column data for this column. This is used for altering tables and such.
     */
    getTableDataColumn(): TableColumn;
    /**
     * Runs get type hint from notes.
     * @returns {string | undefined} - The type hint from notes.
     */
    getTypeHintFromNotes(): string | undefined;
    /**
     * Runs get type.
     * @abstract
     * @returns {string} - The type.
     */
    getType(): string;
}
//# sourceMappingURL=base-column.d.ts.map