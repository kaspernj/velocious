// @ts-check

import CreateIndexBase from "../../query/create-index-base.js"
import restArgsError from "../../../utils/rest-args-error.js"
import TableData from "../../table-data/index.js"

/**
 * Emits the SQL sequence for SQLite's "rebuild" approach to schema changes.
 *
 * SQLite cannot add/drop foreign-key constraints, drop columns on older
 * versions, change column types, or add CHECK constraints via ALTER TABLE.
 * The standard workaround (https://sqlite.org/lang_altertable.html) is to
 * create a new table with the desired schema, copy rows over, drop the
 * original, and rename the replacement.
 *
 * Caller passes the desired final schema; this class handles the mechanical
 * sequence (CREATE temp / INSERT...SELECT / DROP / RENAME / recreate
 * indexes). Caller is responsible for any FK toggling or transaction setup
 * around the returned SQL — `PRAGMA foreign_keys` is connection-scoped and
 * cannot be flipped inside a transaction, so wrapping policy is left to the
 * caller (see `sql/alter-table.js`).
 */
export default class VelociousDatabaseDriversSqliteTableRebuilder {
  /**
   * @param {object} args - Options object.
   * @param {import("../base.js").default} args.driver - Database driver instance.
   * @param {string} args.originalTableName - Name of the existing table to rebuild.
   * @param {TableData} args.targetTableData - Desired final schema (columns + foreign keys + indexes). The instance's name is overwritten internally during emission.
   * @param {Array<[string, string]>} args.columnPairs - Pairs of [oldColumnName, newColumnName] describing how rows from the original table should populate the rebuilt table.
   */
  constructor({driver, originalTableName, targetTableData, columnPairs, ...restArgs}) {
    restArgsError(restArgs)

    if (!(targetTableData instanceof TableData)) throw new Error("Invalid target table data was given")

    this.driver = driver
    this.originalTableName = originalTableName
    this.targetTableData = targetTableData
    this.columnPairs = columnPairs
  }

  /**
   * @returns {Promise<string[]>} - Resolves with SQL statements to execute in order.
   */
  async toSQLs() {
    const driver = this.driver
    const options = driver.options()
    const originalTableName = this.originalTableName
    const tempTableName = `${originalTableName}_velocious_rebuild`
    const targetTableData = this.targetTableData
    const previousTargetName = targetTableData.getName()

    targetTableData.setName(tempTableName)

    let createTableSQLs

    try {
      createTableSQLs = await driver.createTableSql(targetTableData)
    } finally {
      targetTableData.setName(previousTargetName)
    }

    const newColumnsSQL = this.columnPairs.map(([, newName]) => options.quoteColumnName(newName)).join(", ")
    const oldColumnsSQL = this.columnPairs.map(([oldName]) => options.quoteColumnName(oldName)).join(", ")

    const sqls = []

    for (const sql of createTableSQLs) sqls.push(sql)

    if (this.columnPairs.length > 0) {
      sqls.push(
        `INSERT INTO ${options.quoteTableName(tempTableName)} (${newColumnsSQL}) ` +
        `SELECT ${oldColumnsSQL} FROM ${options.quoteTableName(originalTableName)}`
      )
    }

    sqls.push(`DROP TABLE ${options.quoteTableName(originalTableName)}`)
    sqls.push(`ALTER TABLE ${options.quoteTableName(tempTableName)} RENAME TO ${options.quoteTableName(originalTableName)}`)

    for (const tableDataIndex of targetTableData.getIndexes()) {
      const createIndexSQLs = await new CreateIndexBase({
        columns: tableDataIndex.getColumns(),
        driver,
        name: tableDataIndex.getName(),
        tableName: originalTableName,
        unique: tableDataIndex.getUnique()
      }).toSQLs()

      for (const sql of createIndexSQLs) sqls.push(sql)
    }

    return sqls
  }
}
