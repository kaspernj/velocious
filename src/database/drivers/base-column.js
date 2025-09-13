export default class VelociousDatabaseDriversBaseColumn {
  async getIndexByName(indexName) {
    const indexes = await this.getIndexes()
    const index = indexes.find((index) => index.getName() == indexName)

    return index
  }

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
