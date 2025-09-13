import BaseColumnsIndex from "../base-columns-index.js"
import {digg} from "diggerize"

export default class VelociousDatabaseDriversMysqlColumn extends BaseColumnsIndex {
  constructor(table, data) {
    super()
    this.data = data
    this.table = table
  }
}
