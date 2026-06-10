// @ts-check

import {digg} from "diggerize"

export default class VelociousDatabaseDriversBaseColumnsIndex {
  /**
   * Runs constructor.
   * @param {import("./base-table.js").default} table - Table.
   * @param {object} data - Data payload.
   */
  constructor(table, data) {
    this.data = data
    this.table = table
  }

  /**
   * Runs get column names.
   * @abstract
   * @returns {string[]} - The column names.
   */
  getColumnNames() { throw new Error("'getColumnNames' not implemented") }

  /**
   * Runs get driver.
   * @returns {import("./base.js").default} - The driver.
   */
  getDriver() {
    return this.getTable().getDriver()
  }

  /**
   * Runs get name.
   * @returns {string} - The name.
   */
  getName()  {
    return digg(this, "data", "index_name")
  }

  /**
   * Runs get options.
   * @returns {import("../query-parser/options.js").default} - The options options.
   */
  getOptions() {
    return this.getDriver().options()
  }

  /**
   * Runs get table.
   * @returns {import("./base-table.js").default} - The table.
   */
  getTable() {
    if (!this.table) throw new Error("No table set on column")

    return this.table
  }

  /**
   * Runs get table data index.
   * @abstract
   * @returns {import("../table-data/table-index.js").default} - The table data index.
   */
  getTableDataIndex() {
    throw new Error("'getTableDataIndex' not implemented")
  }

  /**
   * Runs is primary key.
   * @returns {boolean} - Whether primary key.
   */
  isPrimaryKey() {
    return digg(this, "data", "is_primary_key")
  }

  /**
   * Runs is unique.
   * @returns {boolean} - Whether unique.
   */
  isUnique() {
    return digg(this, "data", "is_unique")
  }
}
