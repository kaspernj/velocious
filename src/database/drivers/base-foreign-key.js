// @ts-check

import TableForeignKey from "../table-data/table-foreign-key.js"

export default class VelociousDatabaseDriversBaseForeignKey {
  /** @type {import("./base-table.js").default | undefined} */
  table = undefined

  /**
   * @param {object} data
   */
  constructor(data) {
    this.data = data
  }

  /**
   * @interface
   * @returns {string}
   */
  getColumnName() {
    throw new Error(`'getColumnName' not implemented`)
  }

  /**
   * @returns {import("./base.js").default}
   */
  getDriver() {
    return this.getTable().getDriver()
  }

  /**
   * @interface
   * @returns {string}
   */
  getName() {
    throw new Error(`'getName' not implemented`)
  }

  /**
   * @returns {import("../query-parser/options.js").default}
   */
  getOptions() {
    return this.getDriver().options()
  }

  /**
   * @interface
   * @returns {string}
   */
  getReferencedColumnName() {
    throw new Error(`'getReferencedColumnName' not implemented`)
  }

  /**
   * @interface
   * @returns {string}
   */
  getReferencedTableName() {
    throw new Error(`'getReferencedTableName' not implemented`)
  }

  /**
   * @returns {import("./base-table.js").default}
   */
  getTable() {
    if (!this.table) throw new Error("No table set on column")

    return this.table
  }

  /**
   * @interface
   * @returns {string}
   */
  getTableName() {
    throw new Error("'getTableName' not implemented")
  }

  /**
   * @returns {TableForeignKey}
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
