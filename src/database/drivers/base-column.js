// @ts-check

import TableColumn from "../table-data/table-column.js"
import TableData from "../table-data/index.js"

export default class VelociousDatabaseDriversBaseColumn {
  /**
   * Table.
   * @type {import("./base-table.js").default | undefined} */
  table = undefined

  /**
   * Runs get auto increment.
   * @abstract
   * @returns {boolean} - Whether auto increment.
   */
  getAutoIncrement() {
    throw new Error("getAutoIncrement not implemented")
  }

  /**
   * Runs get default.
   * @abstract
   * @returns {?} - The default.
   */
  getDefault() {
    throw new Error("getDefault not implemented")
  }

  /**
   * Runs get index by name.
   * @param {string} indexName - Index name.
   * @returns {Promise<import("./base-columns-index.js").default | undefined>} - Resolves with the index by name.
   */
  async getIndexByName(indexName) {
    const indexes = await this.getIndexes()
    const index = indexes.find((index) => index.getName() == indexName)

    return index
  }

  /**
   * Runs change nullable.
   * @param {boolean} nullable Whether the column should be nullable or not.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async changeNullable(nullable) {
    const tableData = new TableData(this.getTable().getName())
    const column = this.getTableDataColumn()

    column.setNull(nullable)

    tableData.addColumn(column)

    const sqls = await this.getDriver().alterTableSQLs(tableData)

    for (const sql of sqls) {
      await this.getDriver().query(sql)
    }
  }

  /**
   * Runs get driver.
   * @returns {import("./base.js").default} - The driver.
   */
  getDriver() {
    return this.getTable().getDriver()
  }

  /**
   * Runs get indexes.
   * @abstract
   * @returns {Promise<Array<import("./base-columns-index.js").default>>} - Resolves with the indexes.
   */
  getIndexes() {
    throw new Error("getIndexes not implemented")
  }

  /**
   * Runs get max length.
   * @abstract
   * @returns {number | undefined} - The max length.
   */
  getMaxLength() {
    throw new Error("getMaxLength not implemented")
  }

  /**
   * Runs get notes.
   * @returns {string | undefined} - The notes.
   */
  getNotes() {
    return undefined
  }

  /**
   * Runs get name.
   * @abstract
   * @returns {string} - The name.
   */
  getName() {
    throw new Error("getName not implemented")
  }

  /**
   * Runs get null.
   * @abstract
   * @returns {boolean} - Whether null.
   */
  getNull() {
    throw new Error("getNull not implemented")
  }

  /**
   * Runs get options.
   * @returns {import("../query-parser/options.js").default} - The options options.
   */
  getOptions() {
    return this.getDriver().options()
  }

  /**
   * Runs get primary key.
   * @abstract
   * @returns {boolean} - Whether primary key.
   */
  getPrimaryKey() {
    throw new Error("getPrimaryKey not implemented")
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
   * Runs get table data column.
   * @returns {TableColumn} The table column data for this column. This is used for altering tables and such.
   */
  getTableDataColumn() {
    return new TableColumn(this.getName(), {
      autoIncrement: this.getAutoIncrement(),
      default: this.getDefault(),
      isNewColumn: false,
      maxLength: this.getMaxLength(),
      notes: this.getNotes(),
      null: this.getNull(),
      primaryKey: this.getPrimaryKey(),
      type: this.getType()
    })
  }

  /**
   * Runs get type hint from notes.
   * @returns {string | undefined} - The type hint from notes.
   */
  getTypeHintFromNotes() {
    const notes = this.getNotes()

    if (!notes || typeof notes != "string") return

    const match = notes.match(/velocious:type=([a-z0-9_-]+)/i)

    if (!match) return

    return match[1].toLowerCase()
  }

  /**
   * Runs get type.
   * @abstract
   * @returns {string} - The type.
   */
  getType() {
    throw new Error("getType not implemented")
  }
}
