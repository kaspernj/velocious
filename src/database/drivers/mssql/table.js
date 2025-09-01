import Column from "./column.js"
import {digg} from "diggerize"
import ForeignKey from "./foreign-key.js"

export default class VelociousDatabaseDriversMssqlTable {
  constructor(driver, data) {
    this.data = data
    this.driver = driver
  }

  async getColumns() {
    const result = await this.driver.query(`SELECT [COLUMN_NAME] FROM [INFORMATION_SCHEMA].[COLUMNS] WHERE [TABLE_NAME] = ${this.driver.quote(this.getName())}`)
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

  getName() {
    return digg(this.data, "TABLE_NAME")
  }
}
