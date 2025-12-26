// @ts-check

import FromBase from "./from-base.js"

export default class VelociousDatabaseQueryFromTable extends FromBase {
  /**
   * @param {string} tableName - Table name.
   */
  constructor(tableName) {
    super()
    this.tableName = tableName
  }

  toSql() {
    return [this.getOptions().quoteTableName(this.tableName)]
  }
}
