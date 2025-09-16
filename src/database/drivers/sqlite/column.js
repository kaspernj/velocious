import {digg} from "diggerize"
import BaseColumn from "../base-column.js"

export default class VelociousDatabaseDriversSqliteColumn extends BaseColumn {
  constructor({column, driver, table}) {
    super()
    this.column = column
    this.driver = driver
    this.table = table
  }

  getAutoIncrement() { return this.getPrimaryKey() }

  async getIndexes() {
    const indexes = await this.getTable().getIndexes()
    const indexesForColumn = indexes.filter((index) => index.getColumnNames().includes(this.getName()))

    return indexesForColumn
  }

  getDefault() { return digg(this, "column", "dflt_value") }

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

  getPrimaryKey() { return digg(this, "column", "pk") == 1 }

  getType() {
    const columnType = digg(this, "column", "type")
    const match = columnType.match(/(.*)\((\d+)\)$/)

    if (match) {
      return match[1].toLowerCase()
    }

    return columnType.toLowerCase()
  }
}
