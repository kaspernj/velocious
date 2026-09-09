import BaseColumnsIndex from "../base-columns-index.js";
import TableIndex from "../../table-data/table-index.js";
export type PgsqlColumnsIndexDataType = {
    /**
     * - Ordered index column names.
     */
    columnNames: string[];
    /**
     * - Index name.
     */
    index_name: string;
    /**
     * - Whether the index is primary.
     */
    is_primary_key: boolean;
    /**
     * - Whether the index is unique.
     */
    is_unique: boolean;
    /**
     * - Table name.
     */
    table_name: string;
};
/**
 * PgsqlColumnsIndexDataType type.
 * @typedef {object} PgsqlColumnsIndexDataType
 * @property {string[]} columnNames - Ordered index column names.
 * @property {string} index_name - Index name.
 * @property {boolean} is_primary_key - Whether the index is primary.
 * @property {boolean} is_unique - Whether the index is unique.
 * @property {string} table_name - Table name.
 */
export default class VelociousDatabaseDriversPgsqlColumn extends BaseColumnsIndex {
    indexData: PgsqlColumnsIndexDataType;
    /**
     * Runs constructor.
     * @param {import("../base-table.js").default} table - Table.
     * @param {PgsqlColumnsIndexDataType} data - Grouped index metadata.
     */
    constructor(table: import("../base-table.js").default, data: PgsqlColumnsIndexDataType);
    /**
     * Runs get column names.
     * @returns {string[]} - Ordered index column names.
     */
    getColumnNames(): string[];
    /**
     * Runs get table data index.
     * @returns {TableIndex} - Table-data index.
     */
    getTableDataIndex(): TableIndex;
}
//# sourceMappingURL=columns-index.d.ts.map