// @ts-check

import BaseColumn from "../base-column.js"
import ColumnsIndex from "./columns-index.js"
import {digg} from "diggerize"

export default class VelociousDatabaseDriversMysqlColumn extends BaseColumn {
  /**
   * @param {import("../base-table.js").default} table - Table.
   * @param {Record<string, any>} data - Data payload.
   */
  constructor(table, data) {
    super()
    this.data = data
    this.table = table
  }

  getAutoIncrement() { return digg(this, "data", "Extra").includes("auto_increment") }

  async getIndexes() {
    const options = this.getOptions()
    const sql = `
      SELECT
        TABLE_SCHEMA,
        TABLE_NAME,
        INDEX_NAME AS index_name,
        COLUMN_NAME,
        SEQ_IN_INDEX,
        NON_UNIQUE,
        INDEX_TYPE
      FROM INFORMATION_SCHEMA.STATISTICS
      WHERE
        TABLE_SCHEMA = DATABASE() AND
        TABLE_NAME = ${options.quote(this.table.getName())} AND
        COLUMN_NAME = ${options.quote(this.getName())}
    `
    const indexesRows = await this.getDriver().query(sql)
    const indexes = []

    for (const indexRow of indexesRows) {
      if (indexRow.NON_UNIQUE == 1) {
        indexRow.is_unique = false
      } else {
        indexRow.is_unique = true
      }

      if (indexRow.index_name == "PRIMARY") {
        indexRow.is_primary_key = true
      } else {
        indexRow.is_primary_key = false
      }

      const index = new ColumnsIndex(this.getTable(), indexRow)

      indexes.push(index)
    }

    return indexes
  }

  getDefault() { return digg(this, "data", "Default") }

  getMaxLength() {
    const type = digg(this, "data", "Type")
    const match = type.match(/\((\d+)\)$/)

    if (match) {
      const maxLength = parseInt(match[1])

      return maxLength
    }
  }

  getName() { return digg(this, "data", "Field") }
  getNotes() { return digg(this, "data", "Comment") || undefined }

  getNull() {
    const nullValue = digg(this, "data", "Null")

    if (nullValue == "NO") {
      return false
    } else if (nullValue == "YES") {
      return true
    } else {
      throw new Error(`Unknown null value: ${nullValue}`)
    }
  }

  getPrimaryKey() { return digg(this, "data", "Key") == "PRI" }

  getType() {
    const typeHint = this.getTypeHintFromNotes()

    if (typeHint == "boolean") return "boolean"

    const type = digg(this, "data", "Type")
    const tinyintMatch = type.match(/^tinyint\((\d+)\)/i)

    if (tinyintMatch && tinyintMatch[1] == "1") return "boolean"

    if (type.match(/^[a-z]+$/i)) {
      return type.toLowerCase()
    }

    const match = type.match(/^([a-z]+)(?:\((\d+)\))?/i)

    if (!match) throw new Error(`Couldn't match column type from: ${type}`)

    return match[1].toLowerCase()
  }
}
