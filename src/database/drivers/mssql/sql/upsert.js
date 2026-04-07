// @ts-check

import UpsertBase from "../../../query/upsert-base.js"

export default class VelociousDatabaseConnectionDriversMssqlSqlUpsert extends UpsertBase {
  toSql() {
    const sourceColumnsSql = this.dataColumns().map((columnName) => {
      return `${this.formatColumnValue(columnName)} AS ${this.quotedColumn(columnName)}`
    }).join(", ")
    const conflictSql = this.conflictColumns.map((columnName) => {
      return `target.${this.quotedColumn(columnName)} = source.${this.quotedColumn(columnName)}`
    }).join(" AND ")
    const updateSql = this.updateColumns.map((columnName) => {
      return `${this.quotedColumn(columnName)} = source.${this.quotedColumn(columnName)}`
    }).join(", ")
    const insertColumnsSql = this.dataColumns().map((columnName) => this.quotedColumn(columnName)).join(", ")
    const insertValuesSql = this.dataColumns().map((columnName) => `source.${this.quotedColumn(columnName)}`).join(", ")

    return `MERGE ${this.quotedTableName()} AS target USING (SELECT ${sourceColumnsSql}) AS source ON ${conflictSql} WHEN MATCHED THEN UPDATE SET ${updateSql} WHEN NOT MATCHED THEN INSERT (${insertColumnsSql}) VALUES (${insertValuesSql});`
  }
}
