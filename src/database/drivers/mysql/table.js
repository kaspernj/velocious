import Column from "./column.js"

export default class VelociousDatabaseDriversMysqlTable {
  constructor(driver, data) {
    this.data = data
    this.driver = driver
  }

  async getColumns() {
    const result = await this.driver.query(`SHOW FULL COLUMNS FROM \`${this.getName()}\``)
    const columns = []

    for (const data of result) {
      const column = new Column(this, data)

      columns.push(column)
    }

    return columns
  }

  getName() {
    return Object.values(this.data)[0]
  }
}
