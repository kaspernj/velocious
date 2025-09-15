import BaseColumn from "../base-column.js"
import ColumnsIndex from "./columns-index.js"
import {digg} from "diggerize"

export default class VelociousDatabaseDriversPgsqlColumn extends BaseColumn {
  constructor(table, data) {
    super()
    this.data = data
    this.table = table
  }

  async getIndexes() {
    const options = this.getOptions()

    const indexesRows = await this.table.getDriver().query(`
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
        pg_attribute.attname = ${options.quote(this.getName())} AND
        pg_class.relname = ${options.quote(this.getTable().getName())}
    `)

    const indexes = []

    for (const indexRow of indexesRows) {
      const columnsIndex = new ColumnsIndex(this.getTable(), indexRow)

      indexes.push(columnsIndex)
    }

    return indexes
  }

  getDefault() {
    return digg(this, "data", "column_default")
  }

  getMaxLength() {
    return digg(this, "data", "character_maximum_length")
  }

  getName() {
    return digg(this, "data", "column_name")
  }

  getNull() {
    const nullValue = digg(this, "data", "is_nullable")

    if (nullValue == "NO") {
      return false
    } else {
      return true
    }
  }

  getType() {
    return digg(this, "data", "data_type")
  }
}
