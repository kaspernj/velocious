// @ts-check

import CreateDatabaseBase from "../../../query/create-database-base.js"

const IDENTIFIER_PATTERN = /^[A-Za-z0-9_]+$/

/**
 * @param {string} field - Field name (for error messages).
 * @param {string} value - Identifier value.
 * @returns {string} - Same value, validated.
 */
function validateCharsetOrCollation(field, value) {
  if (!IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`Invalid ${field} value: ${JSON.stringify(value)} — expected [A-Za-z0-9_]+`)
  }

  return value
}

export default class VelociousDatabaseConnectionDriversMysqlSqlCreateDatabase extends CreateDatabaseBase {
  /**
   * @returns {string[]} - SQL statements.
   */
  toSql() {
    const options = this.getOptions()
    let sql = "CREATE DATABASE"

    if (this.ifNotExists) sql += " IF NOT EXISTS"

    sql += ` ${options.quoteDatabaseName(this.databaseName)}`

    if (this.charset) sql += ` CHARACTER SET ${validateCharsetOrCollation("charset", this.charset)}`
    if (this.collation) sql += ` COLLATE ${validateCharsetOrCollation("collation", this.collation)}`

    return [sql]
  }
}
