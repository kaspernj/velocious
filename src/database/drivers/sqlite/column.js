// @ts-check

import {digg} from "diggerize"
import BaseColumn from "../base-column.js"

export default class VelociousDatabaseDriversSqliteColumn extends BaseColumn {
  /**
   * @param {object} args - Options object.
   * @param {Record<string, any>} args.column - Column.
   * @param {import("../base.js").default} args.driver - Database driver instance.
   * @param {import("../base-table.js").default} args.table - Table.
   */
  constructor({column, driver, table}) {
    super()
    this.column = column
    this.driver = driver
    this.table = table
  }

  getAutoIncrement() {
    // SQLite only auto-increments when the primary key is the special INTEGER type.
    return this.getPrimaryKey() && this.getType() == "integer"
  }

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

