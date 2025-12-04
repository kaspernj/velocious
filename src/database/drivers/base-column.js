import TableColumn from "../table-data/table-column.js"
import TableData from "../table-data/index.js"

export default class VelociousDatabaseDriversBaseColumn {
  /**
   * @interface
   * @returns {boolean}
   */
  getAutoIncrement() {
    throw new Error("getAutoIncrement not implemented")
  }

  /**
   * @returns {any}
   */
  getDefault() {
    throw new Error("getDefault not implemented")
  }

  /**
   * @param {string} indexName
   * @returns {Promise<import('../table-data/table-index.js').default>}
   */
  async getIndexByName(indexName) {
    const indexes = await this.getIndexes()
    const index = indexes.find((index) => index.getName() == indexName)

    return index
  }

  /**
   * @param {boolean} nullable Whether the column should be nullable or not.
   * @returns {Promise<void>}
   */
  async changeNullable(nullable) {
    const tableData = new TableData(this.getTable().getName())
    const column = this.getTableDataColumn()

    column.setNull(nullable)

    tableData.addColumn(column)

    const sqls = await this.getDriver().alterTableSql(tableData)

    for (const sql of sqls) {
      await this.getDriver().query(sql)
    }
  }

  /**
   * @returns {import("./base.js").default}
   */
  getDriver() {
    return this.getTable().getDriver()
  }

  /**
   * @interface
   * @returns {Promise<Array<import("./base-columns-index.js").default>>}
   */
  getIndexes() {
    throw new Error("getIndexes not implemented")
  }

  /**
   * @interface
   * @returns {number}
   */
  getMaxLength() {
    throw new Error("getMaxLength not implemented")
  }

  /**
   * @interface
   * @returns {string}
   */
  getName() {
    throw new Error("getName not implemented")
  }

  /**
   * @interface
   * @returns {boolean}
   */
  getNull() {
    throw new Error("getNull not implemented")
  }

  /**
   * @returns {import("../query-parser/options.js").default}
   */
  getOptions() {
    return this.getDriver().options()
  }

  /**
   * @interface
   * @returns {boolean}
   */
  getPrimaryKey() {
    throw new Error("getPrimaryKey not implemented")
  }

  /**
   * @returns {import("./base-table.js").default}
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
   * @interface
   * @returns {string}
   */
  getType() {
    throw new Error("getType not implemented")
  }
}
