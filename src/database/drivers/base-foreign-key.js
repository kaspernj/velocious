// @ts-check

import TableForeignKey from "../table-data/table-foreign-key.js"

export default class VelociousDatabaseDriversBaseForeignKey {
  /**
   * Table.
    @type {import("./base-table.js").default | undefined} */
  table = undefined

  /**
   * Runs constructor.
   * @param {Record<string, ?>} data - Data payload.
   */
  constructor(data) {
    this.data = data
  }

  /**
   * Runs get column name.
   * @abstract
   * @returns {string} - The column name.
   */
  getColumnName() {
    throw new Error(`'getColumnName' not implemented`)
  }

  /**
   * Runs get driver.
   * @returns {import("./base.js").default} - The driver.
   */
  getDriver() {
    return this.getTable().getDriver()
  }

  /**
   * Runs get name.
   * @abstract
   * @returns {string} - The name.
   */
  getName() {
    throw new Error(`'getName' not implemented`)
  }

  /**
   * Runs get options.
   * @returns {import("../query-parser/options.js").default} - The options options.
   */
  getOptions() {
    return this.getDriver().options()
  }

  /**
   * Runs get referenced column name.
   * @abstract
   * @returns {string} - The referenced column name.
   */
  getReferencedColumnName() {
    throw new Error(`'getReferencedColumnName' not implemented`)
  }

  /**
   * Runs get referenced table name.
   * @abstract
   * @returns {string} - The referenced table name.
   */
  getReferencedTableName() {
    throw new Error(`'getReferencedTableName' not implemented`)
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
   * Runs get table name.
   * @abstract
   * @returns {string} - The table name.
   */
  getTableName() {
    throw new Error("'getTableName' not implemented")
  }

  /**
   * Runs get table data foreign key.
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

