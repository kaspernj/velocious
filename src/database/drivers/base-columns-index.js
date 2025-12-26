// @ts-check

import {digg} from "diggerize"

export default class VelociousDatabaseDriversBaseColumnsIndex {
  /**
   * @param {import("./base-table.js").default} table
   * @param {object} data
   */
  constructor(table, data) {
    this.data = data
    this.table = table
  }

  /**
   * @abstract
   * @returns {string[]} - Result.
   */
  getColumnNames() { throw new Error("'getColumnNames' not implemented") }

  /**
   * @returns {import("./base.js").default} - Result.
   */
  getDriver() {
    return this.getTable().getDriver()
  }

  /**
   * @returns {string} - Result.
   */
  getName()  {
    return digg(this, "data", "index_name")
  }

  /**
   * @returns {import("../query-parser/options.js").default} - Result.
   */
  getOptions() {
    return this.getDriver().options()
  }

  /**
   * @returns {import("./base-table.js").default} - Result.
   */
  getTable() {
    if (!this.table) throw new Error("No table set on column")

    return this.table
  }

  /**
   * @abstract
   * @returns {import("../table-data/table-index.js").default} - Result.
   */
  getTableDataIndex() {
    throw new Error("'getTableDataIndex' not implemented")
  }

  /**
   * @returns {boolean} - Result.
   */
  isPrimaryKey() {
    return digg(this, "data", "is_primary_key")
  }

  /**
   * @returns {boolean} - Result.
   */
  isUnique() {
    return digg(this, "data", "is_unique")
  }
}
