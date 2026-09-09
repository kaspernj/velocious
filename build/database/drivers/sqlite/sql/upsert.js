// @ts-check

import UpsertBase from "../../../query/upsert-base.js"

export default class VelociousDatabaseConnectionDriversSqliteSqlUpsert extends UpsertBase {
  toSql() {
    const conflictSql = this.conflictColumns.map((columnName) => this.quotedColumn(columnName)).join(", ")
    const updateSql = this.updateColumns.map((columnName) => {
      return `${this.quotedColumn(columnName)} = excluded.${this.quotedColumn(columnName)}`
    }).join(", ")

    return `INSERT INTO ${this.quotedTableName()} (${this.quotedInsertColumnsSql()}) VALUES (${this.quotedInsertValuesSql()}) ON CONFLICT (${conflictSql}) DO UPDATE SET ${updateSql}`
  }
}
