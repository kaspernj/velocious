import {digg} from "diggerize"

export default class VelociousDatabaseDriversMssqlColumn {
  constructor(table, data) {
    this.data = data
    this.table = table
  }

  getName = () => digg(this, "data", "COLUMN_NAME")
}
