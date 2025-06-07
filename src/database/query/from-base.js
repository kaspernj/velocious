export default class VelociousDatabaseQueryFromBase {
  getOptions() {
    return this.query.getOptions()
  }

  toSql() {
    throw new Error("'toSql' wasn't implemented")
  }
}
