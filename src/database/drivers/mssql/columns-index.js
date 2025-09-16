import BaseColumnsIndex from "../base-columns-index.js"

export default class VelociousDatabaseDriversMssqlColumnsIndex extends BaseColumnsIndex {
  constructor(table, data) {
    super()
    this.data = data
    this.table = table
  }
}
