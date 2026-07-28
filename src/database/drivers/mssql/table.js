// @ts-check

import BaseTable from "../base-table.js"
import Column from "./column.js"
import ColumnsIndex from "./columns-index.js"
import {digg} from "diggerize"
import ForeignKey from "./foreign-key.js"
import { normalizeIndexMetadataRow } from "../index-metadata.js"

/**
 * MssqlGroupedIndexDataType type.
 * @typedef {object} MssqlGroupedIndexDataType
 * @property {string[]} columnNames - Ordered index column names.
 * @property {string} index_name - Index name.
 * @property {boolean} is_primary_key - Whether the index is primary.
 * @property {boolean} is_unique - Whether the index is unique.
 * @property {string} table_name - Table name.
 */

/**
 * Groups ordered SQL Server index rows into one metadata value per index.
 * @param {import("../index-metadata.js").IndexMetadataType[]} indexRows - Ordered index metadata rows.
 * @returns {MssqlGroupedIndexDataType[]} - Grouped index metadata.
 */
export function groupMssqlIndexRows(indexRows) {
  /** @type {Map<string, MssqlGroupedIndexDataType>} */
  const indexDataByName = new Map()
  /** @type {MssqlGroupedIndexDataType[]} */
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

export default class VelociousDatabaseDriversMssqlTable extends BaseTable {
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
          *,
          COLUMNPROPERTY(object_id(TABLE_SCHEMA + '.' + TABLE_NAME), COLUMN_NAME, 'IsIdentity') AS isIdentity
        FROM [INFORMATION_SCHEMA].[COLUMNS]
        WHERE [TABLE_NAME] = ${this.driver.quote(this.getName())}
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
            fk.name AS CONSTRAINT_NAME,
            tp.name AS ParentTable,
            ref.name AS ReferencedTable,
            cp.name AS ParentColumn,
            cref.name AS ReferencedColumn,
            tp.name AS TableName
        FROM sys.foreign_keys fk
        INNER JOIN sys.foreign_key_columns fkc
            ON fkc.constraint_object_id = fk.object_id
        INNER JOIN sys.tables tp
            ON fkc.parent_object_id = tp.object_id
        INNER JOIN sys.columns cp
            ON fkc.parent_object_id = cp.object_id
            AND fkc.parent_column_id = cp.column_id
        INNER JOIN sys.tables ref
            ON fkc.referenced_object_id = ref.object_id
        INNER JOIN sys.columns cref
            ON fkc.referenced_object_id = cref.object_id
            AND fkc.referenced_column_id = cref.column_id
        WHERE tp.name = ${this.driver.quote(this.getName())}
        ORDER BY CONSTRAINT_NAME, ParentTable, ReferencedTable;
      `

      const foreignKeyRows = await this.driver.query(sql)
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
      const sql = `
        SELECT
          sys.tables.name AS table_name,
          sys.columns.name AS column_name,
          sys.indexes.name AS index_name,
          sys.indexes.is_unique,
          sys.indexes.is_primary_key
        FROM sys.indexes
        INNER JOIN sys.index_columns ON sys.indexes.object_id = sys.index_columns.object_id AND sys.indexes.index_id = sys.index_columns.index_id
        INNER JOIN sys.columns ON sys.index_columns.object_id = sys.columns.object_id AND sys.index_columns.column_id = sys.columns.column_id
        INNER JOIN sys.tables ON sys.indexes.object_id = sys.tables.object_id
        WHERE
          sys.tables.name = ${options.quote(this.getName())} AND
          sys.index_columns.is_included_column = 0
        ORDER BY
          sys.indexes.name,
          sys.index_columns.key_ordinal
      `

      const rows = await this.getDriver().query(sql)
      const indexes = []
      const indexRows = rows.map((row) => normalizeIndexMetadataRow(row))

      for (const indexData of groupMssqlIndexRows(indexRows)) {
        const index = new ColumnsIndex(this, indexData)

        indexes.push(index)
      }

      return indexes
    })
  }

  /**
   * Runs get name.
   * @returns {string} - The table name.
   */
  getName() {
    return /** @type {string} */ (digg(this.data, "TABLE_NAME"))
  }

  /**
   * Runs truncate.
   * @param {{cascade: boolean}} [args] - Truncate options.
   * @returns {Promise<Array<Record<string, ?>>>} - Resolves with the truncate.
   */
  async truncate(args) { // eslint-disable-line no-unused-vars
    this.getDriver()._assertNotReadOnly()
    try {
      return await this.getDriver().query(`TRUNCATE TABLE ${this.getOptions().quoteTableName(this.getName())}`)
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Query failed 'Cannot truncate table")) {
        // Truncate table is really buggy for some reason - fall back to delete all rows instead
        return await this.getDriver().query(`DELETE FROM ${this.getOptions().quoteTableName(this.getName())}`)
      } else {
        throw error
      }
    }
  }
}
