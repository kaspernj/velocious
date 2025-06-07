import FromBase from "./from-base.js"

export default class VelociousDatabaseQueryFromTable extends FromBase {
  constructor({driver, tableName}) {
    super({driver})
    this.tableName = tableName
  }

  toSql() {
    return this.getOptions().quoteTableName(this.tableName)
  }
}
