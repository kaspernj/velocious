// @ts-check

import AlterTableBase from "../../../query/alter-table-base.js"

export default class VelociousDatabaseConnectionDriversMysqlSqlAlterTable extends AlterTableBase {
  /**
   * @returns {Promise<string[]>} - Resolves with SQL statements.
   */
  async toSQLs() {
    const sqls = await super.toSQLs()

    if (!this.onlyAddsColumns()) return sqls

    return sqls.map((sql) => `${sql}, ALGORITHM=INPLACE`)
  }

  /**
   * @returns {boolean} - Whether this ALTER only adds columns.
   */
  onlyAddsColumns() {
    const columns = this.tableData.getColumns()

    if (columns.length == 0) return false
    if (this.tableData.getForeignKeys().some((foreignKey) => foreignKey.getIsNewForeignKey())) return false

    return columns.every((column) => column.isNewColumn() && !column.getDropColumn() && !column.getNewName())
  }
}
