// @ts-check

import BaseColumn from "../base-column.js"
import {digg} from "diggerize"

export default class VelociousDatabaseDriversMssqlColumn extends BaseColumn {
  /**
   * Runs constructor.
   * @param {import("../base-table.js").default} table - Table.
   * @param {Record<string, ?>} data - Data payload.
   */
  constructor(table, data) {
    super()
    this.data = data
    this.table = table
  }

  getAutoIncrement() { return digg(this, "data", "isIdentity") === 1 }

  async getIndexes() {
    const indexes = await this.getTable().getIndexes()

    return indexes.filter((index) => index.getColumnNames().includes(this.getName()))
  }

  getDefault() { return digg(this, "data", "COLUMN_DEFAULT") }
  getMaxLength() { return digg(this, "data", "CHARACTER_MAXIMUM_LENGTH") }
  getName() { return digg(this, "data", "COLUMN_NAME") }

  getNull() {
    const nullValue = digg(this, "data", "IS_NULLABLE")

    if (nullValue == "NO") {
      return false
    } else {
      return true
    }
  }

  getPrimaryKey() { return digg(this, "data", "isIdentity") === 1 }
  getType() { return digg(this, "data", "DATA_TYPE") }
}
