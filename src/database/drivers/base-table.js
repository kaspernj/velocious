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

  async truncate() {
    await this.getDriver().query(`TRUNCATE TABLE ${this.getOptions().quoteTableName(this.getName())}`)
  }
}
