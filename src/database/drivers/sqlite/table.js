import Column from "./column.js"
import {digg} from "diggerize"

export default class VelociousDatabaseDriversSqliteTable {
  constructor({driver, row}) {
    this.driver = driver
    this.row = row
  }

  getColumns = async () => {
    const result = await this.driver.query(`PRAGMA table_info('${this.getName()}')`)
    const columns = []

    for (const columnData of result) {
      const column = new Column({column: columnData, driver: this.driver, table: this})

      columns.push(column)
    }

    return columns
  }

  getName = () => digg(this, "row", "name")
}
