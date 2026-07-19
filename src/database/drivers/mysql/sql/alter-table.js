// @ts-check

import AlterTableBase from "../../../query/alter-table-base.js"
import TableColumn from "../../../table-data/table-column.js"

export default class VelociousDatabaseConnectionDriversMysqlSqlAlterTable extends AlterTableBase {
  /**
   * Builds MySQL ALTER TABLE statements, adding indexes atomically with columns.
   * @returns {Promise<string[]>} - Resolves with SQL statements.
   */
  async toSQLs() {
    const sqls = await super.toSQLs()
    const indexes = this.tableData.getIndexes()

    if (indexes.length === 0) return sqls
    if (sqls.length !== 1) throw new Error("Expected one MySQL ALTER TABLE statement when adding indexes")

    const options = this.getOptions()
    let sql = sqls[0]

    for (const index of indexes) {
      sql += ", ADD"

      if (index.getUnique()) sql += " UNIQUE"

      sql += " INDEX"

      const indexName = index.getName()

      if (typeof indexName === "string") {
        sql += ` ${options.quoteIndexName(indexName)}`
      }

      sql += " ("
      sql += index
        .getColumns()
        .map((column) => {
          const columnName = column instanceof TableColumn ? column.getName() : column

          return options.quoteColumnName(columnName)
        })
        .join(", ")
      sql += ")"
    }

    return [sql]
  }
}
