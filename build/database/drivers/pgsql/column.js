// @ts-check

import BaseColumn from "../base-column.js"
import {digg} from "diggerize"

export default class VelociousDatabaseDriversPgsqlColumn extends BaseColumn {
  /**
   * Runs constructor.
   * @param {import("../base-table.js").default} table - Table.
   * @param {Record<string, ReturnType<typeof JSON.parse>>} data - Data payload.
   */
  constructor(table, data) {
    super()
    this.data = data
    this.table = table
  }

  getAutoIncrement() {
    return this.getDefault() == `nextval('${this.getTable().getName()}_${this.getName()}_seq'::regclass)`
  }

  getPrimaryKey() {
    return digg(this, "data", "is_primary_key") === 1
  }

  async getIndexes() {
    const indexes = await this.getTable().getIndexes()

    return indexes.filter((index) => index.getColumnNames().includes(this.getName()))
  }

  getDefault() {
    return digg(this, "data", "column_default")
  }

  /**
   * Returns the concrete PostgreSQL type name used in SQL casts.
   * @returns {string} - Schema-qualified domain or UDT name, or the ordinary data type.
   */
  getDatabaseType() {
    const domainName = this.data.domain_name
    const domainSchema = this.data.domain_schema
    const dataType = this.data.data_type
    const udtName = this.data.udt_name
    const udtSchema = this.data.udt_schema

    if (typeof domainName === "string" && typeof domainSchema === "string") {
      return `${this.getDriver().quoteColumn(domainSchema)}.${this.getDriver().quoteColumn(domainName)}`
    }

    if ((dataType === "USER-DEFINED" || dataType === "ARRAY") && typeof udtName === "string" && typeof udtSchema === "string") {
      return `${this.getDriver().quoteColumn(udtSchema)}.${this.getDriver().quoteColumn(udtName)}`
    }

    return this.getType()
  }

  getMaxLength() {
    return digg(this, "data", "character_maximum_length")
  }

  getName() {
    return digg(this, "data", "column_name")
  }

  getNotes() {
    return digg(this, "data", "column_comment") || undefined
  }

  getNull() {
    const nullValue = digg(this, "data", "is_nullable")

    if (nullValue == "NO") {
      return false
    } else {
      return true
    }
  }

  getType() {
    const typeHint = this.getTypeHintFromNotes()

    if (typeHint == "boolean") return "boolean"

    return digg(this, "data", "data_type")
  }
}
