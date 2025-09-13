import BaseColumn from "../base-column.js"

export default class VelociousDatabaseDriversSqliteColumn extends BaseColumn {
  constructor({column, driver}) {
    super()
    this.column = column
    this.driver = driver
  }

  getName() {
    if (!this.column.name) {
      throw new Error("No name given for SQLite column")
    }

    return this.column.name
  }

  getType() {
    const match = this.column.type.match(/(.*)\((\d+)\)$/)

    if (match) {
      return match[1].toLowerCase()
    }

    return this.column.type.toLowerCase()
  }
}
