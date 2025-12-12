// @ts-check

/**
 * @typedef {object} CreateDatabaseArgsType
 * @property {import("../drivers/base.js").default} driver
 * @property {string} databaseName
 * @property {boolean} [ifNotExists]
 */

import QueryBase from "./base.js"

export default class VelociousDatabaseQueryCreateDatabaseBase extends QueryBase {
  /**
   * @param {CreateDatabaseArgsType} args
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
