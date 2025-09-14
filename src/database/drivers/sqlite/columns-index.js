import BaseColumnsIndex from "../base-columns-index.js"
import {digg} from "diggerize"

export default class VelociousDatabaseDriversSqliteColumn extends BaseColumnsIndex {
  constructor(table, data) {
    super()
    this.data = data
    this.table = table
  }

  getName() {
    return digg(this, "data", "name")
  }

  isPrimaryKey() {
    return false
  }

  isUnique() {
    return digg(this, "data", "unique") == 1
  }
}
