// @ts-check

import {normalizeCreateStatement, normalizeSqlStatement} from "../structure-sql/utils.js"

export default class VelociousDatabaseDriversMssqlStructureSql {
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
    const rows = await driver.query("SELECT TABLE_NAME AS table_name, TABLE_TYPE AS table_type FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'dbo' ORDER BY TABLE_TYPE, TABLE_NAME")
    const statements = []

    for (const row of rows) {
      const tableName = row.table_name || row.TABLE_NAME
      const tableType = row.table_type || row.TABLE_TYPE

      if (!tableName || !tableType) continue

      if (tableType == "BASE TABLE") {
        const columns = await driver.query(`SELECT COLUMN_NAME AS column_name, DATA_TYPE AS data_type, IS_NULLABLE AS is_nullable, COLUMN_DEFAULT AS column_default, CHARACTER_MAXIMUM_LENGTH AS character_maximum_length, NUMERIC_PRECISION AS numeric_precision, NUMERIC_SCALE AS numeric_scale FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = ${driver.quote(tableName)} ORDER BY ORDINAL_POSITION`)
        const primaryKeys = await driver.query(`SELECT kcu.COLUMN_NAME AS column_name FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY' AND tc.TABLE_SCHEMA = 'dbo' AND tc.TABLE_NAME = ${driver.quote(tableName)} ORDER BY kcu.ORDINAL_POSITION`)
        const columnSql = columns
          .map((column) => this._columnDefinition(column))
          .filter((column) => Boolean(column))
        const primaryKeyColumns = primaryKeys
          .map((primaryKeyRow) => primaryKeyRow.column_name || primaryKeyRow.COLUMN_NAME)
          .filter((column) => Boolean(column))

        if (primaryKeyColumns.length > 0) {
          columnSql.push(`PRIMARY KEY (${primaryKeyColumns.map((name) => driver.quoteColumn(name)).join(", ")})`)
        }

        if (columnSql.length == 0) continue

        statements.push(normalizeSqlStatement(`CREATE TABLE ${driver.quoteTable(tableName)} (${columnSql.join(", ")})`))
      } else if (tableType == "VIEW") {
        const viewRows = await driver.query(`SELECT m.definition AS definition FROM sys.sql_modules m JOIN sys.objects o ON m.object_id = o.object_id WHERE o.type = 'V' AND o.name = ${driver.quote(tableName)}`)
        const viewDef = viewRows?.[0]?.definition || viewRows?.[0]?.DEFINITION

        if (!viewDef) continue

        const createStatement = normalizeCreateStatement({
          db: driver,
          statement: viewDef,
          objectName: tableName,
          type: "VIEW"
        })

        statements.push(normalizeSqlStatement(createStatement))
      }
    }

    if (statements.length == 0) return null

    return `${statements.join("\n\n")}\n`
  }

  /**
   * @param {Record<string, any>} column - Column.
   * @returns {string | null} - The column definition.
   */
  _columnDefinition(column) {
    const {driver} = this
    const columnName = column.column_name || column.COLUMN_NAME
    const dataType = column.data_type || column.DATA_TYPE

    if (!columnName || !dataType) return null

    let typeSql = dataType
    const charLength = column.character_maximum_length || column.CHARACTER_MAXIMUM_LENGTH
    const numericPrecision = column.numeric_precision || column.NUMERIC_PRECISION
    const numericScale = column.numeric_scale || column.NUMERIC_SCALE

    if ((dataType == "varchar" || dataType == "nvarchar" || dataType == "char" || dataType == "nchar")) {
      if (charLength == -1) {
        typeSql = `${dataType}(max)`
      } else if (charLength) {
        typeSql = `${dataType}(${charLength})`
      }
    } else if ((dataType == "decimal" || dataType == "numeric") && numericPrecision) {
      if (numericScale != null) {
        typeSql = `${dataType}(${numericPrecision}, ${numericScale})`
      } else {
        typeSql = `${dataType}(${numericPrecision})`
      }
    }

    const parts = [`${driver.quoteColumn(columnName)} ${typeSql}`]
    const defaultValue = column.column_default || column.COLUMN_DEFAULT

    if (defaultValue) parts.push(`DEFAULT ${defaultValue}`)

    const isNullable = column.is_nullable || column.IS_NULLABLE

    if (isNullable == "NO") parts.push("NOT NULL")

    return parts.join(" ")
  }
}
