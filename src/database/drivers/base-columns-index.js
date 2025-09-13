import { digg } from "diggerize"

export default class VelociousDatabaseDriversBaseColumnsIndex {
  constructor(table, data) {
    this.data = data
    this.table = table
  }

  getDriver() {
    return this.getTable().getDriver()
  }

  getName()  {
    return digg(this, "data", "index_name")
  }

  getOptions() {
    return this.getDriver().options()
  }

  getTable() {
    if (!this.table) throw new Error("No table set on column")

    return this.table
  }

  isPrimaryKey() {
    return digg(this, "data", "is_primary_key")
  }

  isUnique() {
    return digg(this, "data", "is_unique")
  }
}
