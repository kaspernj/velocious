import BaseTable from "../base-table.js"
import Column from "./column.js"
import ColumnsIndex from "./columns-index.js"
import ForeignKey from "./foreign-key.js"

export default class VelociousDatabaseDriversSqliteTable extends BaseTable {
  constructor({driver, row}) {
    super()
    this.driver = driver
    this.row = row
  }

  async getColumns() {
    const result = await this.driver.query(`PRAGMA table_info('${this.getName()}')`)
    const columns = []

    for (const columnData of result) {
      const column = new Column({column: columnData, driver: this.driver, table: this})

      columns.push(column)
    }

    return columns
  }

  async getForeignKeys() {
    const foreignKeysData = await this.driver.query(`SELECT * FROM pragma_foreign_key_list(${this.driver.quote(this.getName())})`)
    const foreignKeys = []

    for (const foreignKeyData of foreignKeysData) {
      const foreignKey = new ForeignKey(foreignKeyData, {tableName: this.getName()})

      foreignKeys.push(foreignKey)
    }

    return foreignKeys
  }

  async getIndexes() {
    const rows = await this.getDriver().query(`PRAGMA index_list(${this.getOptions().quoteTableName(this.getName())})`)
    const indexes = []

    for (const row of rows) {
      const columnsIndex = new ColumnsIndex(this, row)
      const indexMasterData = await this.getDriver().query(`SELECT * FROM sqlite_master WHERE type = 'index' AND name = ${this.getOptions().quote(columnsIndex.getName())}`)

      columnsIndex.data.columnNames = this._parseColumnsFromSQL(indexMasterData[0].sql)

      indexes.push(columnsIndex)
    }

    return indexes
  }

  _parseColumnsFromSQL(sql) {
    const columnsSQLMatch = sql.match(/\((.+?)\)/)
    const columnsSQL = columnsSQLMatch[1].split(",")
    const columnNames = []

    for (const column of columnsSQL) {
      const matchTicks = column.match(/`(.+)`/)
      const matchQuotes = column.match(/"(.+)"/)

      if (matchTicks) {
        columnNames.push(matchTicks[1])
      } else if (matchQuotes) {
        columnNames.push(matchQuotes[1])
      } else{
        throw new Error(`Couldn't parse column part: ${column}`)
      }
    }

    return columnNames
  }

  getName() {
    if (!this.row.name) {
      throw new Error("No name given for SQLite table")
    }

    return this.row.name
  }
}
