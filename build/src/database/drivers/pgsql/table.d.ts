import BaseTable from "../base-table.js";
import Column from "./column.js";
import ColumnsIndex from "./columns-index.js";
import ForeignKey from "./foreign-key.js";
export type PgsqlGroupedIndexDataType = {
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
 * PgsqlGroupedIndexDataType type.
 * @typedef {object} PgsqlGroupedIndexDataType
 * @property {string[]} columnNames - Ordered index column names.
 * @property {string} index_name - Index name.
 * @property {boolean} is_primary_key - Whether the index is primary.
 * @property {boolean} is_unique - Whether the index is unique.
 * @property {string} table_name - Table name.
 */
/**
 * Groups ordered PostgreSQL index rows into one metadata value per index.
 * @param {import("../index-metadata.js").IndexMetadataType[]} indexRows - Ordered index metadata rows.
 * @returns {PgsqlGroupedIndexDataType[]} - Grouped index metadata.
 */
export declare function groupPgsqlIndexRows(indexRows: import("../index-metadata.js").IndexMetadataType[]): PgsqlGroupedIndexDataType[];
export default class VelociousDatabaseDriversPgsqlTable extends BaseTable {
    data: Record<string, string>;
    driver: import("../base.js").default;
    /**
     * Runs constructor.
     * @param {import("../base.js").default} driver - Database driver instance.
     * @param {Record<string, string>} data - Data payload.
     */
    constructor(driver: import("../base.js").default, data: Record<string, string>);
    getColumns(): Promise<Column[]>;
    getForeignKeys(): Promise<ForeignKey[]>;
    getIndexes(): Promise<ColumnsIndex[]>;
    /**
     * Runs get name.
     * @returns {string} - The table name.
     */
    getName(): string;
}
//# sourceMappingURL=table.d.ts.map