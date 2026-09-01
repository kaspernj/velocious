// @ts-check

import UpsertBase from "../../../query/upsert-base.js"

export default class VelociousDatabaseConnectionDriversMysqlSqlUpsert extends UpsertBase {
  toSql() {
    const updateSql = this.updateColumns.map((columnName) => {
      return `${this.quotedColumn(columnName)} = VALUES(${this.quotedColumn(columnName)})`
    }).join(", ")

    return `INSERT INTO ${this.quotedTableName()} (${this.quotedInsertColumnsSql()}) VALUES (${this.quotedInsertValuesSql()}) ON DUPLICATE KEY UPDATE ${updateSql}`
  }
}
