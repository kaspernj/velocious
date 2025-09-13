export default class VelociousDatabaseDriversBaseColumnsIndex {
  getDriver() {
    return this.getTable().getDriver()
  }

  getOptions() {
    return this.getDriver().options()
  }

  getTable() {
    if (!this.table) throw new Error("No table set on column")

    return this.table
  }
}
