// @ts-check

import QueryBase from "./base.js"

/**
 * RemoveIndexBaseArgsType type.
 * @typedef {object} RemoveIndexBaseArgsType
 * @property {import("../drivers/base.js").default} driver - Database driver used to generate SQL.
 * @property {string} name - Index name to drop.
 * @property {string} tableName - Name of the table the index belongs to.
 */

export default class VelociousDatabaseQueryRemoveIndexBase extends QueryBase {
  /**
   * Runs constructor.
   * @param {RemoveIndexBaseArgsType} args - Options object.
   */
  constructor({driver, name, tableName}) {
    super({driver})
    this.name = name
    this.tableName = tableName
  }

  /**
   * Runs to sqls.
   * @returns {Promise<string[]>} - Resolves with SQL statements.
   */
  async toSQLs() {
    const databaseType = this.getDriver().getType()
    const options = this.getOptions()
    let sql = `DROP INDEX ${options.quoteIndexName(this.name)}`

    if (databaseType == "mssql" || databaseType == "mysql") {
      sql += ` ON ${options.quoteTableName(this.tableName)}`
    }

    return [sql]
  }
}
