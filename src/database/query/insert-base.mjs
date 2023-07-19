export default class VelociousDatabaseQueryInsert {
  constructor({driver, tableName, data}) {
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
