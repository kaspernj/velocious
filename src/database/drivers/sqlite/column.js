import {digg} from "diggerize"
import BaseColumn from "../base-column.js"
import ColumnsIndex from "./columns-index.js"

export default class VelociousDatabaseDriversSqliteColumn extends BaseColumn {
  constructor({column, driver, table}) {
    super()
    this.column = column
    this.driver = driver
    this.table = table
  }

  async getIndexes() {
    const table = this.getTable()
    const rows = await this.getDriver().query(`PRAGMA index_list(${this.getOptions().quoteTableName(table.getName())})`)
    const indexes = []

    for (const row of rows) {
      const columnsIndex = new ColumnsIndex(table, row)
      const indexMasterData = await this.getDriver().query(`SELECT * FROM sqlite_master WHERE type = 'index' AND name = ${this.getOptions().quote(columnsIndex.getName())}`)

      columnsIndex.columnNames = this._parseColumnsFromSQL(indexMasterData[0].sql)

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

  getDefault() {
    return digg(this, "column", "dflt_value")
  }

  getName() {
    const name = digg(this, "column", "name")

    if (!name) throw new Error("No name given for SQLite column")

    return name
  }

  getMaxLength() {
    const columnType = digg(this, "column", "type")
    const match = columnType.match(/(.*)\((\d+)\)$/)

    if (match) {
      return parseInt(match[2])
    }
  }

  getNull() {
    const notNullValue = digg(this, "column", "notnull")

    if (notNullValue === 1) {
      return false
    } else {
      return true
    }
  }

  getType() {
    const columnType = digg(this, "column", "type")
    const match = columnType.match(/(.*)\((\d+)\)$/)

    if (match) {
      return match[1].toLowerCase()
    }

    return columnType.toLowerCase()
  }
}
