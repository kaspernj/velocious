import {digg} from "diggerize"
import TableData from "../table-data/index.js"

export default class VelociousDatabaseDriversBaseTable {
  async getColumnByName(columnName) {
    const columnes = await this.getColumns()
    const column = columnes.find((column) => column.getName() == columnName)

    return column
  }

  getDriver() {
    if (!this.driver) throw new Error("No driver set on table")

    return this.driver
  }

  getOptions() {
    return this.getDriver().options()
  }

  async getTableData() {
    const tableData = new TableData(this.getName())

    for (const column of await this.getColumns()) {
      tableData.addColumn(column.getTableDataColumn())
    }

    for (const index of await this.getIndexes()) {
      tableData.addIndex(index.getTableDataIndex())
    }

    return tableData
  }

  async rowsCount() {
    const result = await this.getDriver().query(`SELECT COUNT(*) AS count FROM ${this.getOptions().quoteTableName(this.getName())}`)

    return digg(result, 0, "count")
  }

  async truncate(args) {
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

    await this.getDriver().query(sql)
  }
}
