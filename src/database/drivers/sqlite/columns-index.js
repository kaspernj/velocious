import BaseColumnsIndex from "../base-columns-index.js"
import {digg} from "diggerize"
import TableIndex from "../../table-data/table-index.js"

export default class VelociousDatabaseDriversSqliteColumnsIndex extends BaseColumnsIndex {
  constructor(table, data) {
    super()
    this.data = data
    this.table = table
  }

  getColumnNames() {
    return digg(this, "data", "columnNames")
  }

  getName() {
    return digg(this, "data", "name")
  }

  getTableDataIndex() {
    return new TableIndex(this.getColumnNames(), {
      name: this.getName(),
      unique: this.isUnique()
    })
  }

  isPrimaryKey() {
    return false
  }

  isUnique() {
    return digg(this, "data", "unique") == 1
  }
}
