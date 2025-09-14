import {digg} from "diggerize"

export default class VelociousDatabaseDriversBaseTable {
  async getColumnByName(columnName) {
    const columnes = await this.getColumns()
    const column = columnes.find((column) => column.getName() == columnName)

    return column
  }

  getDriver() {
    if (!this.driver) throw new Error("No driver set on table")

    return this.driver
  }

  getOptions() {
    return this.getDriver().options()
  }

  async rowsCount() {
    const result = await this.getDriver().query(`SELECT COUNT(*) AS count FROM ${this.getOptions().quoteTableName(this.getName())}`)

    return digg(result, 0, "count")
  }

  async truncate(args) {
    let sql = `TRUNCATE TABLE ${this.getOptions().quoteTableName(this.getName())}`

    if (args?.cascade && this.getDriver().getType() == "pgsql") {
      sql += " CASCADE"
    }

    await this.getDriver().query(sql)
  }
}
