export default class VelociousDatabaseQueryJoinBase {
  getOptions() {
    return this.query.driver.options()
  }

  toSql() {
    throw new Error("'toSql' wasn't implemented")
  }
}
