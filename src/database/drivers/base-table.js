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

  /**
   * @returns {import("../query-parser/options.js").default}
   */
  getOptions() {
    return this.getDriver().options()
  }

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
