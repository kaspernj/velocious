const FromBase = require("./from-base.cjs")

module.exports = class VelociousDatabaseQueryFromTable extends FromBase {
  constructor({tableName}) {
    super()
    this.tableName = tableName
  }

  toSql() {
    return this.getOptions().quoteTableName(this.tableName)
  }
}
