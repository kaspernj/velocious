import BaseTable from "../base-table.js"
import Column from "./column.js"
import ForeignKey from "./foreign-key.js"

export default class VelociousDatabaseDriversPgsqlTable extends BaseTable {
  constructor(driver, data) {
    super()
    this.data = data
    this.driver = driver
  }

  async getColumns() {
    const result = await this.driver.query(`SELECT * FROM information_schema.columns WHERE table_catalog = CURRENT_DATABASE() AND table_schema = 'public' AND table_name = '${this.getName()}'`)
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
        tc.table_name = ${this.driver.quote(this.getName())}
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
    return this.data.table_name
  }
}
