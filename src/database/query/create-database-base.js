// @ts-check

import QueryBase from "./base.js"

export default class VelociousDatabaseQueryCreateDatabaseBase extends QueryBase {
  /**
   * @param {object} args
   * @param {import("../drivers/base.js").default} args.driver
   * @param {string} args.databaseName
   * @param {boolean} [args.ifNotExists]
   */
  constructor({driver, databaseName, ifNotExists}) {
    super({driver})
    this.databaseName = databaseName
    this.ifNotExists = ifNotExists
  }

  /**
   * @returns {string[]}
   */
  toSql() {
    const {databaseName} = this
    let sql = "CREATE DATABASE"

    if (this.ifNotExists) sql += " IF NOT EXISTS"

    sql += ` ${this.getOptions().quoteDatabaseName(databaseName)}`

    return [sql]
  }
}
