export type IndexMetadataType = {
    /**
     * - Index column name.
     */
    column_name: string;
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
 * IndexMetadataType type.
 * @typedef {object} IndexMetadataType
 * @property {string} column_name - Index column name.
 * @property {string} index_name - Index name.
 * @property {boolean} is_primary_key - Whether the index is primary.
 * @property {boolean} is_unique - Whether the index is unique.
 * @property {string} table_name - Table name.
 */
/**
 * Normalizes one untrusted database index metadata row.
 * @param {import("./base.js").QueryRowType} row - Database index metadata row.
 * @returns {IndexMetadataType} - Validated index metadata.
 */
export declare function normalizeIndexMetadataRow(row: import("./base.js").QueryRowType): IndexMetadataType;
//# sourceMappingURL=index-metadata.d.ts.map