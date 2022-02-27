module.exports = class VelociousDatabaseQuerySelectBase {
  getOptions() {
    return this.query.driver.options()
  }

  toSql() {
    throw new Error("'toSql' wasn't implemented")
  }
}
