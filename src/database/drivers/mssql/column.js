import BaseColumn from "../base-column.js"
import ColumnsIndex from "./columns-index.js"
import {digg} from "diggerize"

export default class VelociousDatabaseDriversMssqlColumn extends BaseColumn {
  constructor(table, data) {
    super()
    this.data = data
    this.table = table
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
        sys.tables.name = ${options.quote(this.getTable().getName())} AND
        sys.columns.name = ${options.quote(this.getName())}
      ORDER BY
        sys.indexes.name,
        sys.index_columns.key_ordinal
    `

    const rows = await this.getDriver().query(sql)
    const indexes = []

    for (const row of rows) {
      const index = new ColumnsIndex(this.getTable(), row)

      indexes.push(index)
    }

    return indexes
  }

  getName() {
    return digg(this, "data", "COLUMN_NAME")
  }
}
