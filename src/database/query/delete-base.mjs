export default class VelociousDatabaseQueryDeleteBase {
  constructor({conditions, driver, tableName}) {
    this.conditions = conditions
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
