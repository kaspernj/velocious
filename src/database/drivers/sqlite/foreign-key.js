// @ts-check

import BaseForeignKey from "../base-foreign-key.js"
import {digg} from "diggerize"

export default class VelociousDatabaseDriversSqliteForeignKey extends BaseForeignKey {
  /**
   * @param {Record<string, any>} data
   * @param {object} args
   * @param {string} args.tableName
   */
  constructor(data, {tableName}) {
    super(data)
    this.tableName = tableName
  }

  getColumnName() { return digg(this, "data", "from") }
  getName() { return `${this.getTableName()}_${this.getColumnName()}_${this.data.id}` }
  getTableName() { return digg(this, "tableName") }
  getReferencedColumnName() { return digg(this, "data", "to") }
  getReferencedTableName() { return digg(this, "data", "table") }
}
