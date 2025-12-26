// @ts-check

import {normalizeSqlStatement} from "../structure-sql/utils.js"

export default class VelociousDatabaseDriversSqliteStructureSql {
  /**
   * @param {object} args
   * @param {import("../base.js").default} args.driver
   */
  constructor({driver}) {
    this.driver = driver
  }

  /**
   * @returns {Promise<string | null>} - Resolves with SQL string.
   */
  async toSql() {
    const {driver} = this
    const rows = await driver.query("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type, name")
    const statements = rows
      .map((row) => row.sql)
      .filter((statement) => Boolean(statement))
      .map((statement) => normalizeSqlStatement(statement))
      .filter((statement) => Boolean(statement))

    if (statements.length == 0) return null

    return `${statements.join("\n\n")}\n`
  }
}
