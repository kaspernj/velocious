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
}
