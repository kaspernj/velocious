// @ts-check

import TableForeignKey from "../table-data/table-foreign-key.js"

export default class VelociousDatabaseDriversBaseForeignKey {
  /** @type {import("./base-table.js").default | undefined} */
  table = undefined

  /**
   * @param {Record<string, unknown>} data - Data payload.
   */
  constructor(data) {
    this.data = data
  }

  /**
   * @abstract
   * @returns {string} - The column name.
   */
  getColumnName() {
    throw new Error(`'getColumnName' not implemented`)
  }

  /**
   * @returns {import("./base.js").default} - The driver.
   */
  getDriver() {
    return this.getTable().getDriver()
  }

  /**
   * @abstract
   * @returns {string} - The name.
   */
  getName() {
    throw new Error(`'getName' not implemented`)
  }

  /**
   * @returns {import("../query-parser/options.js").default} - The options options.
   */
  getOptions() {
    return this.getDriver().options()
  }

  /**
   * @abstract
   * @returns {string} - The referenced column name.
   */
  getReferencedColumnName() {
    throw new Error(`'getReferencedColumnName' not implemented`)
  }

  /**
   * @abstract
   * @returns {string} - The referenced table name.
   */
  getReferencedTableName() {
    throw new Error(`'getReferencedTableName' not implemented`)
  }

  /**
   * @returns {import("./base-table.js").default} - The table.
   */
  getTable() {
    if (!this.table) throw new Error("No table set on column")

    return this.table
  }

  /**
   * @abstract
   * @returns {string} - The table name.
   */
  getTableName() {
    throw new Error("'getTableName' not implemented")
  }

  /**
   * @returns {TableForeignKey} - The table data foreign key.
   */
  getTableDataForeignKey() {
    return new TableForeignKey({
      columnName: this.getColumnName(),
      name: this.getName(),
      tableName: this.getTableName(),
      referencedColumnName: this.getReferencedColumnName(),
      referencedTableName: this.getReferencedTableName()
    })
  }
}
