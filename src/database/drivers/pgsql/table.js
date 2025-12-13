// @ts-check

import BaseTable from "../base-table.js"
import Column from "./column.js"
import ColumnsIndex from "./columns-index.js"
import ForeignKey from "./foreign-key.js"

export default class VelociousDatabaseDriversPgsqlTable extends BaseTable {
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
        columns.*,
        CASE WHEN key_column_usage.column_name IS NOT NULL THEN 1 ELSE 0 END AS is_primary_key

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
  }

  async getForeignKeys() {
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
  }

  async getIndexes() {
    const options = this.getOptions()

    const indexesRows = await this.getDriver().query(`
      SELECT
        pg_attribute.attname AS column_name,
        pg_index.indexrelid::regclass as index_name,
        pg_class.relnamespace::regnamespace as schema_name,
        pg_class.relname as table_name,
        pg_index.indisprimary as is_primary_key,
        pg_index.indisunique as is_unique
      FROM pg_index
      JOIN pg_class ON pg_class.oid = pg_index.indrelid
      JOIN pg_attribute ON pg_attribute.attrelid = pg_class.oid AND pg_attribute.attnum = ANY(pg_index.indkey)
      WHERE
        pg_class.relname = ${options.quote(this.getName())}
    `)

    const indexes = []

    for (const indexRow of indexesRows) {
      const columnsIndex = new ColumnsIndex(this, indexRow)

      indexes.push(columnsIndex)
    }

    return indexes
  }

  getName() {
    return this.data.table_name
  }
}
