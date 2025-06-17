import Column from "./column.js"
import {digg} from "diggerize"
import ForeignKey from "./foreign-key.js"

export default class VelociousDatabaseDriversSqliteTable {
  constructor({driver, row}) {
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

  getName = () => digg(this, "row", "name")
}
