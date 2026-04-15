// @ts-check

/**
 * @typedef {object} CreateDatabaseArgsType
 * @property {import("../drivers/base.js").default} driver - Database driver used to generate SQL.
 * @property {string} databaseName - Name of the database to create.
 * @property {boolean} [ifNotExists] - Skip creation if the database already exists.
 * @property {string} [databaseCharset] - Database-default character set (driver-specific; currently used by mysql).
 * @property {string} [databaseCollation] - Database-default collation (driver-specific; currently used by mysql).
 */

import QueryBase from "./base.js"

export default class VelociousDatabaseQueryCreateDatabaseBase extends QueryBase {
  /**
   * @param {CreateDatabaseArgsType} args - Options object.
   */
  constructor({driver, databaseName, ifNotExists, databaseCharset, databaseCollation}) {
    super({driver})
    this.databaseName = databaseName
    this.ifNotExists = ifNotExists
    this.databaseCharset = databaseCharset
    this.databaseCollation = databaseCollation
  }

  /**
   * @returns {string[]} - SQL statements.
   */
  toSql() {
    const {databaseName} = this
    let sql = "CREATE DATABASE"

    if (this.ifNotExists) sql += " IF NOT EXISTS"

    sql += ` ${this.getOptions().quoteDatabaseName(databaseName)}`

    return [sql]
  }
}
