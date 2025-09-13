import BaseColumn from "../base-column.js"
import {digg} from "diggerize"

export default class VelociousDatabaseDriversMysqlColumn extends BaseColumn {
  constructor(table, data) {
    super()
    this.data = data
    this.table = table
  }

  getName = () => digg(this, "data", "Field")
}
