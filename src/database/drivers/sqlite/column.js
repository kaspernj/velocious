export default class VelociousDatabaseDriversSqliteColumn {
  constructor({column, driver}) {
    this.column = column
    this.driver = driver
  }

  getName() {
    if (!this.column.name) {
      throw new Error("No name given for SQLite column")
    }

    return this.column.name
  }
}
