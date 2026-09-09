export type TableIndexArgsType = {
    /**
     * - Explicit index name.
     */
    name?: string;
    /**
     * - Whether the index should be unique.
     */
    unique?: boolean;
};
/**
 * TableIndexArgsType type.
 * @typedef {object} TableIndexArgsType
 * @property {string} [name] - Explicit index name.
 * @property {boolean} [unique] - Whether the index should be unique.
 */
export default class TableIndex {
    args: TableIndexArgsType | undefined;
    columns: (string | import("./table-column.js").default)[];
    /**
     * Runs constructor.
     * @param {Array<string | import("./table-column.js").default>} columns - Column names.
     * @param {TableIndexArgsType} [args] - Options object.
     */
    constructor(columns: Array<string | import("./table-column.js").default>, args?: TableIndexArgsType);
    /**
     * Runs get columns.
     * @returns {Array<string | import("./table-column.js").default>} - The columns.
     */
    getColumns(): Array<string | import("./table-column.js").default>;
    /**
     * Runs get name.
     * @returns {string | undefined} - The name.
     */
    getName(): string | undefined;
    /**
     * Runs get unique.
     * @returns {boolean} - Whether unique.
     */
    getUnique(): boolean;
}
//# sourceMappingURL=table-index.d.ts.map