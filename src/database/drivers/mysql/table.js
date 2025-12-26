// @ts-check

import BaseTable from "../base-table.js"
import Column from "./column.js"
import ColumnsIndex from "./columns-index.js"
import ForeignKey from "./foreign-key.js"

export default class VelociousDatabaseDriversMysqlTable extends BaseTable {
  /**
   * @param {import("../base.js").default} driver - Database driver instance.
   * @param {Record<string, string>} data - Data payload.
   */
  constructor(driver, data) {
    super()
    this.data = data
    this.driver = driver
  }

  async getColumns() {
    const result = await this.driver.query(`SHOW FULL COLUMNS FROM \`${this.getName()}\``)
    const columns = []

    for (const data of result) {
      const column = new Column(this, data)

      columns.push(column)
    }

    return columns
  }

  async getForeignKeys() {
    const sql = `
      SELECT TABLE_NAME, COLUMN_NAME, CONSTRAINT_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
      FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
      WHERE
        REFERENCED_TABLE_SCHEMA = (SELECT DATABASE()) AND
        TABLE_NAME = ${this.driver.quote(this.getName())}
    `

    const foreignKeyRows = await this.driver.query(sql)
    const foreignKeys = []

    for (const foreignKeyRow of foreignKeyRows) {
      const foreignKey = new ForeignKey(foreignKeyRow)

      foreignKeys.push(foreignKey)
    }

    return foreignKeys
  }

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
        TABLE_NAME = ${options.quote(this.getName())}
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

      const index = new ColumnsIndex(this, indexRow)

      indexes.push(index)
    }

    return indexes
  }

  /** @returns {string} - The table name. */
  getName() {
    return /** @type {string} */ (Object.values(this.data)[0])
  }
}
