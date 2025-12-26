// @ts-check

import BaseTable from "../base-table.js"
import Column from "./column.js"
import ColumnsIndex from "./columns-index.js"
import {digg} from "diggerize"
import ForeignKey from "./foreign-key.js"

export default class VelociousDatabaseDriversMssqlTable extends BaseTable {
  /**
   * @param {import("../base.js").default} driver
   * @param {Record<string, any>} data
   */
  constructor(driver, data) {
    super()
    this.data = data
    this.driver = driver
  }

  async getColumns() {
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
  }

  async getForeignKeys() {
    const sql = `
      SELECT
          fk.name AS ForeignKeyName,
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
      ORDER BY ForeignKeyName, ParentTable, ReferencedTable;
    `

    const foreignKeyRows = await this.driver.query(sql)
    const foreignKeys = []

    for (const foreignKeyRow of foreignKeyRows) {
      const foreignKey = new ForeignKey(foreignKeyRow)

      foreignKeys.push(foreignKey)
    }

    return foreignKeys
  }

  async getIndexes() {
    const options = this.getOptions()
    const sql = `
      SELECT
        sys.tables.name AS TableName,
        sys.columns.name AS ColumnName,
        sys.indexes.name AS index_name,
        sys.indexes.type_desc AS IndexType,
        sys.index_columns.is_included_column AS IsIncludedColumn,
        sys.indexes.is_unique,
        sys.indexes.is_primary_key,
        sys.indexes.is_unique_constraint
      FROM sys.indexes
      INNER JOIN sys.index_columns ON sys.indexes.object_id = sys.index_columns.object_id AND sys.indexes.index_id = sys.index_columns.index_id
      INNER JOIN sys.columns ON sys.index_columns.object_id = sys.columns.object_id AND sys.index_columns.column_id = sys.columns.column_id
      INNER JOIN sys.tables ON sys.indexes.object_id = sys.tables.object_id
      WHERE
        sys.tables.name = ${options.quote(this.getName())}
      ORDER BY
        sys.indexes.name,
        sys.index_columns.key_ordinal
    `

    const rows = await this.getDriver().query(sql)
    const indexes = []

    for (const row of rows) {
      const index = new ColumnsIndex(this, row)

      indexes.push(index)
    }

    return indexes
  }

  getName() {
    return digg(this.data, "TABLE_NAME")
  }

  /**
   * @param {{cascade: boolean}} [args]
   * @returns {Promise<Array<Record<string, any>>>} - Result.
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
