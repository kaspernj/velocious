// @ts-check

import TableColumn from "../table-data/table-column.js"
import TableData from "../table-data/index.js"

export default class VelociousDatabaseDriversBaseColumn {
  /** @type {import("./base-table.js").default | undefined} */
  table = undefined

  /**
   * @abstract
   * @returns {boolean} - Whether auto increment.
   */
  getAutoIncrement() {
    throw new Error("getAutoIncrement not implemented")
  }

  /**
   * @abstract
   * @returns {any} - The default.
   */
  getDefault() {
    throw new Error("getDefault not implemented")
  }

  /**
   * @param {string} indexName - Index name.
   * @returns {Promise<import("./base-columns-index.js").default | undefined>} - Resolves with the index by name.
   */
  async getIndexByName(indexName) {
    const indexes = await this.getIndexes()
    const index = indexes.find((index) => index.getName() == indexName)

    return index
  }

  /**
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
   * @returns {import("./base.js").default} - The driver.
   */
  getDriver() {
    return this.getTable().getDriver()
  }

  /**
   * @abstract
   * @returns {Promise<Array<import("./base-columns-index.js").default>>} - Resolves with the indexes.
   */
  getIndexes() {
    throw new Error("getIndexes not implemented")
  }

  /**
   * @abstract
   * @returns {number | undefined} - The max length.
   */
  getMaxLength() {
    throw new Error("getMaxLength not implemented")
  }

  /**
   * @abstract
   * @returns {string} - The name.
   */
  getName() {
    throw new Error("getName not implemented")
  }

  /**
   * @abstract
   * @returns {boolean} - Whether null.
   */
  getNull() {
    throw new Error("getNull not implemented")
  }

  /**
   * @returns {import("../query-parser/options.js").default} - The options options.
   */
  getOptions() {
    return this.getDriver().options()
  }

  /**
   * @abstract
   * @returns {boolean} - Whether primary key.
   */
  getPrimaryKey() {
    throw new Error("getPrimaryKey not implemented")
  }

  /**
   * @returns {import("./base-table.js").default} - The table.
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
   * @returns {string} - The type.
   */
  getType() {
    throw new Error("getType not implemented")
  }
}

