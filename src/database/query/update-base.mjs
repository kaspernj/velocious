export default class VelociousDatabaseQueryUpdateBase {
  constructor({conditions, data, driver, tableName}) {
    this.conditions = conditions
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
