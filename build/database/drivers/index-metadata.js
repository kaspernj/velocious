// @ts-check

import { forcedBoolean, forcedString } from "typanic"

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
export function normalizeIndexMetadataRow(row) {
  return {
    column_name: forcedString(row.column_name, "index column_name"),
    index_name: forcedString(row.index_name, "index index_name"),
    is_primary_key: forcedBoolean(row.is_primary_key, "index is_primary_key"),
    is_unique: forcedBoolean(row.is_unique, "index is_unique"),
    table_name: forcedString(row.table_name, "index table_name")
  }
}
