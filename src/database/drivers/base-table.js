// @ts-check

import {digg} from "diggerize"
import TableData from "../table-data/index.js"

export default class VelociousDatabaseDriversBaseTable {
  /** @type {import("./base.js").default | undefined} */
  driver = undefined

  /**
   * @param {string} columnName
   * @returns {Promise<import("./base-column.js").default | undefined>} - Result.
   */
  async getColumnByName(columnName) {
    const columnes = await this.getColumns()
    const column = columnes.find((column) => column.getName() == columnName)

    return column
  }

  /**
   * @param {string} columnName
   * @returns {Promise<import("./base-column.js").default>} - Result.
   */
  async getColumnByNameOrFail(columnName) {
    const column = await this.getColumnByName(columnName)

    if (!column) throw new Error(`Couldn't find a column by that name "${columnName}"`)

    return column
  }

  /**
   * @abstract
   * @returns {Promise<Array<import("./base-column.js").default>>} - Result.
   */
  getColumns() {
    throw new Error("getColumns not implemented")
  }

  /**
   * @returns {import("./base.js").default} - Result.
   */
  getDriver() {
    if (!this.driver) throw new Error("No driver set on table")

    return this.driver
  }

  /**
   * @abstract
   * @returns {Promise<import("./base-foreign-key.js").default[]>} - Result.
   */
  getForeignKeys() {
    throw new Error("'getForeignKeys' not implemented")
  }

  /**
   * @abstract
   * @returns {Promise<import("./base-columns-index.js").default[]>} - Result.
   */
  getIndexes() {
    throw new Error("'getForeignKeys' not implemented")
  }

  /**
   * @abstract
   * @returns {string} - Result.
   */
  getName() {
    throw new Error("getName not implemented")
  }

  /**
   * @returns {import("../query-parser/options.js").default} - Result.
   */
  getOptions() {
    return this.getDriver().options()
  }

  /**
   * @returns {Promise<TableData>} - Result.
   */
  async getTableData() {
    const tableData = new TableData(this.getName())
    const tableDataColumns = []

    for (const column of await this.getColumns()) {
      const tableDataColumn = column.getTableDataColumn()

      tableData.addColumn(tableDataColumn)
      tableDataColumns.push(tableDataColumn)
    }

    for (const foreignKey of await this.getForeignKeys()) {
      tableData.addForeignKey(foreignKey.getTableDataForeignKey())

      const tableDataColumn = tableDataColumns.find((tableDataColumn) => tableDataColumn.getName() == foreignKey.getColumnName())

      if (!tableDataColumn) throw new Error(`Couldn't find table data column for foreign key: ${foreignKey.getColumnName()}`)

      tableDataColumn.setForeignKey(foreignKey)
    }

    for (const index of await this.getIndexes()) {
      tableData.addIndex(index.getTableDataIndex())
    }

    return tableData
  }

  /**
   * @returns {Promise<number>} - Result.
   */
  async rowsCount() {
    const result = await this.getDriver().query(`SELECT COUNT(*) AS count FROM ${this.getOptions().quoteTableName(this.getName())}`)

    return digg(result, 0, "count")
  }

  /**
   * @param {{cascade: boolean}} [args]
   * @returns {Promise<Array<Record<string, any>>>} - Result.
   */
  async truncate(args) {
    this.getDriver()._assertNotReadOnly()
    const databaseType = this.getDriver().getType()
    let sql

    if (databaseType == "sqlite") {
      sql = `DELETE FROM ${this.getOptions().quoteTableName(this.getName())}`
    } else {
      sql = `TRUNCATE TABLE ${this.getOptions().quoteTableName(this.getName())}`

      if (args?.cascade && databaseType == "pgsql") {
        sql += " CASCADE"
      }
    }

    return await this.getDriver().query(sql)
  }
}
