import BaseColumnsIndex from "../base-columns-index.js"
import {digg} from "diggerize"

export default class VelociousDatabaseDriversPgsqlColumn extends BaseColumnsIndex {
  constructor(table, data) {
    super()
    this.data = data
    this.table = table
  }
}
