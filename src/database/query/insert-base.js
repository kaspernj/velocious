export default class VelociousDatabaseQueryInsertBase {
  constructor({driver, tableName, data}) {
    if (!driver) throw new Error("No driver given to insert base")
    if (!tableName) throw new Error(`Invalid table name given to insert base: ${tableName}`)
    if (!data) throw new Error("No data given to insert base")

    this.data = data
    this.driver = driver
    this.tableName = tableName
  }

  getOptions() {
    return this.driver.options()
  }

  toSql() {
    throw new Error("'toSql' wasn't implemented")
  }
}
