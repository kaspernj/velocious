// @ts-check

import {normalizeSqlStatement} from "../structure-sql/utils.js"

export default class VelociousDatabaseDriversPgsqlStructureSql {
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
    const rows = await driver.query("SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_type, table_name")
    const statements = []

    for (const row of rows) {
      const tableName = row.table_name || row.TABLE_NAME
      const tableType = row.table_type || row.TABLE_TYPE

      if (!tableName || !tableType) continue

      if (tableType == "BASE TABLE") {
        const columns = await driver.query(`SELECT column_name, data_type, is_nullable, column_default, character_maximum_length, numeric_precision, numeric_scale FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${driver.quote(tableName)} ORDER BY ordinal_position`)
        const primaryKeys = await driver.query(`SELECT kcu.column_name FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public' AND tc.table_name = ${driver.quote(tableName)} ORDER BY kcu.ordinal_position`)
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
        const viewRows = await driver.query(`SELECT pg_get_viewdef(${driver.quoteTable(tableName)}::regclass, true) AS viewdef`)
        const viewDef = viewRows?.[0]?.viewdef || viewRows?.[0]?.VIEWDEF

        if (!viewDef) continue

        statements.push(normalizeSqlStatement(`CREATE VIEW ${driver.quoteTable(tableName)} AS ${viewDef}`))
      }
    }

    if (statements.length == 0) return null

    return `${statements.join("\n\n")}\n`
  }

  /**
   * @param {Record<string, any>} column
   * @returns {string | null}
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

    if (dataType == "character varying" && charLength) {
      typeSql = `varchar(${charLength})`
    } else if (dataType == "character" && charLength) {
      typeSql = `char(${charLength})`
    } else if (dataType == "numeric" && numericPrecision) {
      if (numericScale) {
        typeSql = `numeric(${numericPrecision}, ${numericScale})`
      } else {
        typeSql = `numeric(${numericPrecision})`
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
