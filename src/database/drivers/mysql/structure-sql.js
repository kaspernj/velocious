// @ts-check

import {normalizeSqlStatement} from "../structure-sql/utils.js"

export default class VelociousDatabaseDriversMysqlStructureSql {
  /**
   * @param {object} args
   * @param {import("../base.js").default} args.driver
   */
  constructor({driver}) {
    this.driver = driver
  }

  /**
   * @returns {Promise<string | null>}
   */
  async toSql() {
    const {driver} = this
    const isMariaDb = await this._isMariaDb()
    const rows = await driver.query("SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_type, table_name")
    const statements = []

    for (const row of rows) {
      const tableName = row.table_name || row.TABLE_NAME
      const tableType = row.table_type || row.TABLE_TYPE

      if (!tableName || !tableType) continue

      if (tableType == "BASE TABLE") {
        const createRows = await driver.query(`SHOW CREATE TABLE ${driver.quoteTable(tableName)}`)
        const createStatement = this._mysqlCreateStatement(createRows?.[0])

        if (createStatement) statements.push(normalizeSqlStatement(createStatement))
      } else if (tableType == "VIEW" || (isMariaDb && tableType == "SYSTEM VIEW")) {
        const createRows = await driver.query(`SHOW CREATE VIEW ${driver.quoteTable(tableName)}`)
        const createStatement = this._mysqlCreateStatement(createRows?.[0])

        if (createStatement) statements.push(normalizeSqlStatement(createStatement))
      }
    }

    if (statements.length == 0) return null

    return `${statements.join("\n\n")}\n`
  }

  /**
   * @returns {Promise<boolean>}
   */
  async _isMariaDb() {
    const {driver} = this
    const rows = await driver.query("SELECT VERSION() AS version")
    const version = rows?.[0]?.version || rows?.[0]?.VERSION

    if (!version) return false

    return String(version).toLowerCase().includes("mariadb")
  }

  /**
   * @param {Record<string, any> | undefined} row
   * @returns {string | null}
   */
  _mysqlCreateStatement(row) {
    if (!row) return null

    for (const key of Object.keys(row)) {
      if (key.toLowerCase().startsWith("create ")) {
        return row[key]
      }
    }

    return null
  }
}
