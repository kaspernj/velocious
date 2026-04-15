// @ts-check

/**
 * @typedef {object} DropDatabaseArgsType
 * @property {import("../drivers/base.js").default} driver - Database driver used to generate SQL.
 * @property {string} databaseName - Name of the database to drop.
 * @property {boolean} [ifExists] - Skip drop if the database does not exist.
 */

import QueryBase from "./base.js"

export default class VelociousDatabaseQueryDropDatabaseBase extends QueryBase {
  /**
   * @param {DropDatabaseArgsType} args - Options object.
   */
  constructor({driver, databaseName, ifExists}) {
    super({driver})
    this.databaseName = databaseName
    this.ifExists = ifExists
  }

  /**
   * @returns {string[]} - SQL statements.
   */
  toSql() {
    const {databaseName} = this
    let sql = "DROP DATABASE"

    if (this.ifExists) sql += " IF EXISTS"

    sql += ` ${this.getOptions().quoteDatabaseName(databaseName)}`

    return [sql]
  }
}
