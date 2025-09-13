import BaseTable from "../base-table.js"
import Column from "./column.js"
import ForeignKey from "./foreign-key.js"

export default class VelociousDatabaseDriversSqliteTable extends BaseTable {
  constructor({driver, row}) {
    super()
    this.driver = driver
    this.row = row
  }

  async getColumns() {
    const result = await this.driver.query(`PRAGMA table_info('${this.getName()}')`)
    const columns = []

    for (const columnData of result) {
      const column = new Column({column: columnData, driver: this.driver, table: this})

      columns.push(column)
    }

    return columns
  }

  async getForeignKeys() {
    const foreignKeysData = await this.driver.query(`SELECT * FROM pragma_foreign_key_list(${this.driver.quote(this.getName())})`)
    const foreignKeys = []

    for (const foreignKeyData of foreignKeysData) {
      const foreignKey = new ForeignKey(foreignKeyData, {tableName: this.getName()})

      foreignKeys.push(foreignKey)
    }

    return foreignKeys
  }

  getName() {
    if (!this.row.name) {
      throw new Error("No name given for SQLite table")
    }

    return this.row.name
  }
}
