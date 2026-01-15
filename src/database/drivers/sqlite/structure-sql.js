// @ts-check

import {normalizeSqlStatement} from "../structure-sql/utils.js"

export default class VelociousDatabaseDriversSqliteStructureSql {
  /**
   * @param {object} args - Options object.
   * @param {import("../base.js").default} args.driver - Database driver instance.
   */
  constructor({driver}) {
    this.driver = driver
  }

  /**
   * @returns {Promise<string | null>} - Resolves with SQL string.
   */
  async toSql() {
    const {driver} = this
    const rows = await driver.query("SELECT type, sql, name FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY name")
    const tables = []
    const views = []
    const indexes = []
    const triggers = []
    const others = []

    for (const row of rows) {
      const rawSql = row.sql || row.SQL
      const rawType = row.type || row.TYPE
      const statement = rawSql ? normalizeSqlStatement(String(rawSql)) : ""

      if (!statement) continue

      const normalizedType = rawType ? String(rawType).toLowerCase() : ""

      if (normalizedType === "table") {
        tables.push(statement)
      } else if (normalizedType === "view") {
        views.push(statement)
      } else if (normalizedType === "index") {
        indexes.push(statement)
      } else if (normalizedType === "trigger") {
        triggers.push(statement)
      } else {
        others.push(statement)
      }
    }

    const statements = [...tables, ...views, ...indexes, ...triggers, ...others]

    if (statements.length == 0) return null

    return `${statements.join("\n\n")}\n`
  }
}
