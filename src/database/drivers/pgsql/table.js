import Column from "./column.js"
import ForeignKey from "./foreign-key.js"

export default class VelociousDatabaseDriversPgsqlTable {
  constructor(driver, data) {
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
      SELECT TABLE_NAME, COLUMN_NAME, CONSTRAINT_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
      FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
      WHERE
        REFERENCED_TABLE_SCHEMA = (SELECT DATABASE()) AND
        TABLE_NAME = ${this.driver.quote(this.getName())}
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
