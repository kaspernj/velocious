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
   * @returns {string[]}
   */
  getColumnNames() { throw new Error("'getColumnNames' not implemented") }

  /**
   * @returns {import("./base.js").default}
   */
  getDriver() {
    return this.getTable().getDriver()
  }

  /**
   * @returns {string}
   */
  getName()  {
    return digg(this, "data", "index_name")
  }

  /**
   * @returns {import("../query-parser/options.js").default}
   */
  getOptions() {
    return this.getDriver().options()
  }

  /**
   * @returns {import("./base-table.js").default}
   */
  getTable() {
    if (!this.table) throw new Error("No table set on column")

    return this.table
  }

  /**
   * @abstract
   * @returns {import("../table-data/table-index.js").default}
   */
  getTableDataIndex() {
    throw new Error("'getTableDataIndex' not implemented")
  }

  /**
   * @returns {boolean}
   */
  isPrimaryKey() {
    return digg(this, "data", "is_primary_key")
  }

  /**
   * @returns {boolean}
   */
  isUnique() {
    return digg(this, "data", "is_unique")
  }
}
