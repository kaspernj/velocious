// @ts-check

import BaseColumnsIndex from "../base-columns-index.js"
import TableIndex from "../../table-data/table-index.js"

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
  /**
   * Runs constructor.
   * @param {import("../base-table.js").default} table - Table.
   * @param {PgsqlColumnsIndexDataType} data - Grouped index metadata.
   */
  constructor(table, data) {
    super(table, data)
    this.indexData = data
  }

  /**
   * Runs get column names.
   * @returns {string[]} - Ordered index column names.
   */
  getColumnNames() { return this.indexData.columnNames }

  /**
   * Runs get table data index.
   * @returns {TableIndex} - Table-data index.
   */
  getTableDataIndex() {
    return new TableIndex(this.getColumnNames(), {
      name: this.getName(),
      unique: this.isUnique()
    })
  }
}
