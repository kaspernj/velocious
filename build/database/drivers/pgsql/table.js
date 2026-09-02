// @ts-check

import BaseTable from "../base-table.js"
import Column from "./column.js"
import ColumnsIndex from "./columns-index.js"
import ForeignKey from "./foreign-key.js"
import { normalizeIndexMetadataRow } from "../index-metadata.js"

/**
 * PgsqlGroupedIndexDataType type.
 * @typedef {object} PgsqlGroupedIndexDataType
 * @property {string[]} columnNames - Ordered index column names.
 * @property {string} index_name - Index name.
 * @property {boolean} is_primary_key - Whether the index is primary.
 * @property {boolean} is_unique - Whether the index is unique.
 * @property {string} table_name - Table name.
 */

/**
 * Groups ordered PostgreSQL index rows into one metadata value per index.
 * @param {import("../index-metadata.js").IndexMetadataType[]} indexRows - Ordered index metadata rows.
 * @returns {PgsqlGroupedIndexDataType[]} - Grouped index metadata.
 */
export function groupPgsqlIndexRows(indexRows) {
  /** @type {Map<string, PgsqlGroupedIndexDataType>} */
  const indexDataByName = new Map()
  /** @type {PgsqlGroupedIndexDataType[]} */
  const groupedIndexData = []

  for (const indexRow of indexRows) {
    const existingIndexData = indexDataByName.get(indexRow.index_name)

    if (existingIndexData) {
      existingIndexData.columnNames.push(indexRow.column_name)
      continue
    }

    const indexData = {
      columnNames: [indexRow.column_name],
      index_name: indexRow.index_name,
      is_primary_key: indexRow.is_primary_key,
      is_unique: indexRow.is_unique,
      table_name: indexRow.table_name
    }

    indexDataByName.set(indexRow.index_name, indexData)
    groupedIndexData.push(indexData)
  }

  return groupedIndexData
}

export default class VelociousDatabaseDriversPgsqlTable extends BaseTable {
  /**
   * Runs constructor.
   * @param {import("../base.js").default} driver - Database driver instance.
   * @param {Record<string, string>} data - Data payload.
   */
  constructor(driver, data) {
    super()
    this.data = data
    this.driver = driver
  }

  async getColumns() {
    return await this.getDriver()._cachedTableSchemaMetadata(this.getName(), "columns", async () => {
      const result = await this.driver.query(`
        SELECT
          columns.*,
          CASE WHEN key_column_usage.column_name IS NOT NULL THEN 1 ELSE 0 END AS is_primary_key,
          col_description((columns.table_schema || '.' || columns.table_name)::regclass, columns.ordinal_position) AS column_comment

        FROM
          information_schema.columns AS columns

        LEFT JOIN information_schema.table_constraints AS table_constraints ON
          table_constraints.table_name = columns.table_name AND
          table_constraints.table_schema = columns.table_schema AND
          table_constraints.constraint_type = 'PRIMARY KEY'

        LEFT JOIN information_schema.key_column_usage AS key_column_usage ON
          key_column_usage.constraint_name = table_constraints.constraint_name AND
          key_column_usage.table_schema = table_constraints.table_schema AND
          key_column_usage.table_name = columns.table_name AND
          key_column_usage.column_name = columns.column_name

        WHERE
          columns.table_catalog = CURRENT_DATABASE() AND
          columns.table_schema = 'public' AND
          columns.table_name = '${this.getName()}'
      `)
      const columns = []

      for (const data of result) {
        const column = new Column(this, data)

        columns.push(column)
      }

      return columns
    })
  }

  async getForeignKeys() {
    return await this.getDriver()._cachedTableSchemaMetadata(this.getName(), "foreignKeys", async () => {
      const sql = `
        SELECT
          tc.constraint_name,
          tc.table_name,
          kcu.column_name,
          ccu.table_name AS foreign_table_name,
          ccu.column_name AS foreign_column_name

        FROM
          information_schema.table_constraints AS tc

        JOIN information_schema.key_column_usage AS kcu ON
          tc.constraint_name = kcu.constraint_name

        JOIN information_schema.constraint_column_usage AS ccu
          ON ccu.constraint_name = tc.constraint_name

        WHERE
          constraint_type = 'FOREIGN KEY' AND
          tc.table_catalog = CURRENT_DATABASE() AND
          tc.table_name = ${this.getDriver().quote(this.getName())}
      `

      const foreignKeyRows = await this.getDriver().query(sql)
      const foreignKeys = []

      for (const foreignKeyRow of foreignKeyRows) {
        const foreignKey = new ForeignKey(foreignKeyRow)

        foreignKeys.push(foreignKey)
      }

      return foreignKeys
    })
  }

  async getIndexes() {
    return await this.getDriver()._cachedTableSchemaMetadata(this.getName(), "indexes", async () => {
      const options = this.getOptions()

      const indexesRows = await this.getDriver().query(`
        SELECT
          index_attribute.attname AS column_name,
          pg_index.indexrelid::regclass AS index_name,
          pg_class.relname AS table_name,
          pg_index.indisprimary AS is_primary_key,
          pg_index.indisunique AS is_unique
        FROM pg_index
        JOIN pg_class ON pg_class.oid = pg_index.indrelid
        JOIN LATERAL unnest(pg_index.indkey) WITH ORDINALITY AS index_columns(attribute_number, ordinal_position) ON true
        JOIN pg_attribute AS index_attribute ON index_attribute.attrelid = pg_class.oid AND index_attribute.attnum = index_columns.attribute_number
        WHERE
          pg_class.relname = ${options.quote(this.getName())} AND
          index_columns.ordinal_position <= pg_index.indnkeyatts
        ORDER BY
          pg_index.indexrelid,
          index_columns.ordinal_position
      `)

      const indexes = []

      const indexRows = indexesRows.map((indexRow) => normalizeIndexMetadataRow(indexRow))

      for (const indexData of groupPgsqlIndexRows(indexRows)) {
        const columnsIndex = new ColumnsIndex(this, indexData)

        indexes.push(columnsIndex)
      }

      return indexes
    })
  }

  /**
   * Runs get name.
   * @returns {string} - The table name.
   */
  getName() {
    return this.data.table_name
  }
}
