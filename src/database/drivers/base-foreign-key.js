import TableForeignKey from "../table-data/table-foreign-key.js"

export default class VelociousDatabaseDriversBaseForeignKey {
  constructor(data) {
    this.data = data
  }

  getDriver() {
    return this.getTable().getDriver()
  }

  /**
   * @returns {import("../query-parser/options.js").default}
   */
  getOptions() {
    return this.getDriver().options()
  }

  getTable() {
    if (!this.table) throw new Error("No table set on column")

    return this.table
  }

  getTableDataForeignKey() {
    return new TableForeignKey({
      columnName: this.getColumnName(),
      name: this.getName(),
      tableName: this.getTableName(),
      referencedColumnName: this.getReferencedColumnName(),
      referencedTableName: this.getReferencedTableName()
    })
  }
}
