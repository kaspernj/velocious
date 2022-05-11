import FromBase from "./from-base.mjs"

export default class VelociousDatabaseQueryFromTable extends FromBase {
  constructor({tableName}) {
    super()
    this.tableName = tableName
  }

  toSql() {
    return this.getOptions().quoteTableName(this.tableName)
  }
}
