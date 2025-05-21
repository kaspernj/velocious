import {digg} from "diggerize"

export default class VelociousDatabaseDriversSqliteTable {
  constructor(row) {
    this.row = row
  }

  getName = () => digg(this, "row", "name")
}
