// @ts-check

import TableColumn from "../table-data/table-column.js"
import TableData from "../table-data/index.js"

export default class VelociousDatabaseDriversBaseColumn {
  /** @type {import("./base-table.js").default | undefined} */
  table = undefined

  /**
   * @abstract
   * @returns {boolean} - Result.
   */
  getAutoIncrement() {
    throw new Error("getAutoIncrement not implemented")
  }

  /**
   * @abstract
   * @returns {any} - Result.
   */
  getDefault() {
    throw new Error("getDefault not implemented")
  }

  /**
   * @param {string} indexName
   * @returns {Promise<import("./base-columns-index.js").default | undefined>} - Result.
   */
  async getIndexByName(indexName) {
    const indexes = await this.getIndexes()
    const index = indexes.find((index) => index.getName() == indexName)

    return index
  }

  /**
   * @param {boolean} nullable Whether the column should be nullable or not.
   * @returns {Promise<void>} - Result.
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
   * @returns {import("./base.js").default} - Result.
   */
  getDriver() {
    return this.getTable().getDriver()
  }

  /**
   * @abstract
   * @returns {Promise<Array<import("./base-columns-index.js").default>>} - Result.
   */
  getIndexes() {
    throw new Error("getIndexes not implemented")
  }

  /**
   * @abstract
   * @returns {number | undefined} - Result.
   */
  getMaxLength() {
    throw new Error("getMaxLength not implemented")
  }

  /**
   * @abstract
   * @returns {string} - Result.
   */
  getName() {
    throw new Error("getName not implemented")
  }

  /**
   * @abstract
   * @returns {boolean} - Result.
   */
  getNull() {
    throw new Error("getNull not implemented")
  }

  /**
   * @returns {import("../query-parser/options.js").default} - Result.
   */
  getOptions() {
    return this.getDriver().options()
  }

  /**
   * @abstract
   * @returns {boolean} - Result.
   */
  getPrimaryKey() {
    throw new Error("getPrimaryKey not implemented")
  }

  /**
   * @returns {import("./base-table.js").default} - Result.
   */
  getTable() {
    if (!this.table) throw new Error("No table set on column")

    return this.table
  }

  /**
   * @returns {TableColumn} The table column data for this column. This is used for altering tables and such.
   */
  getTableDataColumn() {
    return new TableColumn(this.getName(), {
      autoIncrement: this.getAutoIncrement(),
      default: this.getDefault(),
      isNewColumn: false,
      maxLength: this.getMaxLength(),
      null: this.getNull(),
      primaryKey: this.getPrimaryKey(),
      type: this.getType()
    })
  }

  /**
   * @abstract
   * @returns {string} - Result.
   */
  getType() {
    throw new Error("getType not implemented")
  }
}
