import TableColumn from "../table-data/table-column.js"
import TableData from "../table-data/index.js"

export default class VelociousDatabaseDriversBaseColumn {
  async getIndexByName(indexName) {
    const indexes = await this.getIndexes()
    const index = indexes.find((index) => index.getName() == indexName)

    return index
  }

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

  getDriver() {
    return this.getTable().getDriver()
  }

  getOptions() {
    return this.getDriver().options()
  }

  getTable() {
    if (!this.table) throw new Error("No table set on column")

    return this.table
  }

  getTableDataColumn() {
    return new TableColumn(this.getName(), {
      default: this.getDefault(),
      isNewColumn: false,
      maxLength: this.getMaxLength(),
      null: this.getNull(),
      type: this.getType()
    })
  }
}
