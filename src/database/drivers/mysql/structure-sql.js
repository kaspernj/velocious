// @ts-check

import {normalizeSqlStatement} from "../structure-sql/utils.js"

export default class VelociousDatabaseDriversMysqlStructureSql {
  /**
   * Runs constructor.
   * @param {object} args - Options object.
   * @param {import("../base.js").default} args.driver - Database driver instance.
   */
  constructor({driver}) {
    this.driver = driver
  }

  /**
   * Runs to sql.
   * @returns {Promise<string | null>} - Resolves with SQL string.
   */
  async toSql() {
    const {driver} = this
    const isMariaDb = await this._isMariaDb()
    const rows = await driver.query("SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_type, table_name")
    const foreignKeyRows = await driver.query("SELECT table_name, referenced_table_name FROM information_schema.key_column_usage WHERE table_schema = DATABASE() AND referenced_table_schema = DATABASE() AND referenced_table_name IS NOT NULL")
    const baseTableNames = []
    const views = []
    const statements = []

    for (const row of rows) {
      const tableNameValue = row.table_name || row.TABLE_NAME
      const tableTypeValue = row.table_type || row.TABLE_TYPE
      const tableName = tableNameValue ? String(tableNameValue) : ""
      const tableType = tableTypeValue ? String(tableTypeValue) : ""

      if (!tableName || !tableType) continue

      if (tableType == "BASE TABLE") {
        baseTableNames.push(tableName)
      } else if (tableType == "VIEW" || (isMariaDb && tableType == "SYSTEM VIEW")) {
        views.push(tableName)
      }
    }

    for (const tableName of this._orderBaseTables({foreignKeyRows, tableNames: baseTableNames})) {
      const createRows = await driver.query(`SHOW CREATE TABLE ${driver.quoteTable(tableName)}`)
      const rawCreateStatement = this._mysqlCreateStatement(createRows?.[0])
      const createStatement = rawCreateStatement ? this._stripAutoIncrement(rawCreateStatement) : null

      if (createStatement) statements.push(normalizeSqlStatement(createStatement))
    }

    for (const tableName of views) {
      const createRows = await driver.query(`SHOW CREATE VIEW ${driver.quoteTable(tableName)}`)
      const createStatement = this._mysqlCreateStatement(createRows?.[0])

      if (createStatement) statements.push(normalizeSqlStatement(createStatement))
    }

    if (statements.length == 0) return null

    return `${statements.join("\n\n")}\n`
  }

  /**
   * Orders tables so referenced tables are created before their dependents.
   * @param {object} args - Options object.
   * @param {Array<Record<string, ?>>} args.foreignKeyRows - Foreign key metadata rows.
   * @param {string[]} args.tableNames - Base table names in their existing order.
   * @returns {string[]} - Ordered table names.
   */
  _orderBaseTables({foreignKeyRows, tableNames}) {
    const pendingTableNames = new Set(tableNames)
    /** @type {Record<string, Set<string>>} */
    const dependenciesByTableName = {}
    const orderedTableNames = []

    for (const tableName of tableNames) {
      dependenciesByTableName[tableName] = new Set()
    }

    for (const row of foreignKeyRows) {
      const tableNameValue = row.table_name || row.TABLE_NAME
      const referencedTableNameValue = row.referenced_table_name || row.REFERENCED_TABLE_NAME
      const tableName = tableNameValue ? String(tableNameValue) : ""
      const referencedTableName = referencedTableNameValue ? String(referencedTableNameValue) : ""

      if (!pendingTableNames.has(tableName) || !pendingTableNames.has(referencedTableName)) continue

      dependenciesByTableName[tableName].add(referencedTableName)
    }

    while (pendingTableNames.size > 0) {
      const nextTableName = tableNames.find((tableName) => {
        if (!pendingTableNames.has(tableName)) return false

        return Array.from(dependenciesByTableName[tableName]).every((dependencyTableName) => !pendingTableNames.has(dependencyTableName))
      })

      if (!nextTableName) {
        for (const tableName of tableNames) {
          if (pendingTableNames.has(tableName)) orderedTableNames.push(tableName)
        }

        break
      }

      orderedTableNames.push(nextTableName)
      pendingTableNames.delete(nextTableName)
    }

    return orderedTableNames
  }

  /**
   * Runs is maria db.
   * @returns {Promise<boolean>} - Resolves with Whether maria db.
   */
  async _isMariaDb() {
    const {driver} = this
    const rows = await driver.query("SELECT VERSION() AS version")
    const version = rows?.[0]?.version || rows?.[0]?.VERSION

    if (!version) return false

    return String(version).toLowerCase().includes("mariadb")
  }

  /**
   * Runs mysql create statement.
   * @param {Record<string, ?> | undefined} row - Row data.
   * @returns {string | null} - SQL string.
   */
  _mysqlCreateStatement(row) {
    if (!row) return null

    for (const key of Object.keys(row)) {
      if (key.toLowerCase().startsWith("create ")) {
        return String(row[key])
      }
    }

    return null
  }

  /**
   * Runs strip auto increment.
   * @param {string} statement - Statement.
   * @returns {string} - Statement without auto increment.
   */
  _stripAutoIncrement(statement) {
    return statement
      .replace(/\sAUTO_INCREMENT\s*=\s*\d+/gi, "")
      .replace(/\s{2,}/g, " ")
  }
}
