// @ts-check

/**
 * @typedef {object} CreateIndexSqlArgs
 * @property {Array<string | import("./../table-data/table-column.js").default>} columns - Columns to include in the index.
 * @property {boolean} [ifNotExists] - Skip creation if the index already exists.
 * @property {string} [name] - Explicit index name to use.
 * @property {boolean} [unique] - Whether the index should enforce uniqueness.
 * @property {string} tableName - Name of the table to add the index to.
 */
/**
 * @typedef {object} DropTableSqlArgsType
 * @property {boolean} [cascade] - Whether dependent objects should be dropped too.
 * @property {boolean} [ifExists] - Skip dropping if the table does not exist.
 */
/**
 * @typedef {object} DeleteSqlArgsType
 * @property {string} tableName - Table name to delete from.
 * @property {{[key: string]: any}} conditions - Conditions used to build the delete WHERE clause.
 */
/**
 * @typedef {object} InsertSqlArgsType
 * @property {string[]} [columns] - Column names for `rows` inserts.
 * @property {{[key: string]: any}} [data] - Column/value pairs for a single-row insert.
 * @property {boolean} [multiple] - Whether this insert should be treated as multi-row.
 * @property {string[]} [returnLastInsertedColumnNames] - Column names to return after insert.
 * @property {Array<Array<any>>} [rows] - Row values for a multi-row insert.
 * @property {string} tableName - Table name to insert into.
 */
/**
 * @typedef {Record<string, any>} QueryRowType
 * @typedef {Array<QueryRowType>} QueryResultType
 */
/**
 * @typedef {object}UpdateSqlArgsType
 * @property {object} conditions - Conditions used to build the update WHERE clause.
 * @property {object} data - Column/value pairs to update.
 * @property {string} tableName - Table name to update.
 */

import {Logger} from "../../logger.js"
import Query from "../query/index.js"
import Handler from "../handler.js"
import Mutex from "epic-locks/build/mutex.js"
import strftime from "strftime"
import UUID from "pure-uuid"
import TableData from "../table-data/index.js"
import TableColumn from "../table-data/table-column.js"
import TableForeignKey from "../table-data/table-foreign-key.js"
import wait from "awaitery/build/wait.js"

export default class VelociousDatabaseDriversBase {
  /** @type {number | undefined} */
  idSeq = undefined

  /**
   * @param {import("../../configuration-types.js").DatabaseConfigurationType} config - Configuration object.
   * @param {import("../../configuration.js").default} configuration - Configuration instance.
   */
  constructor(config, configuration) {
    this._args = config
    this.configuration = configuration
    this.mutex = new Mutex() // Can be used to lock this instance for exclusive use
    this.logger = new Logger(this)
    this._transactionsCount = 0
    this._transactionsActionsMutex = new Mutex()
  }

  /**
   * @param {string} tableName - Table name.
   * @param {string} columnName - Column name.
   * @param {string} referencedTableName - Referenced table name.
   * @param {string} referencedColumnName - Referenced column name.
   * @param {object} args - Options object.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async addForeignKey(tableName, columnName, referencedTableName, referencedColumnName, args) {
    this._assertNotReadOnly()
    const tableForeignKeyArgs = Object.assign(
      {
        columnName,
        tableName,
        referencedColumnName,
        referencedTableName
      },
      args
    )
    const tableForeignKey = new TableForeignKey(tableForeignKeyArgs)
    const tableData = new TableData(tableName)

    tableData.addForeignKey(tableForeignKey)

    const alterTableSQLs = await this.alterTableSQLs(tableData)

    for (const alterTableSQL of alterTableSQLs) {
      await this.query(alterTableSQL)
    }
  }

  /**
   * @abstract
   * @param {import("../table-data/index.js").default} _tableData - Table data.
   * @returns {Promise<string[]>} - Resolves with SQL statements.
   */
  alterTableSQLs(_tableData) { // eslint-disable-line no-unused-vars
    throw new Error("alterTableSQLs not implemented")
  }

  /**
   * @abstract
   * @returns {Promise<void>} - Resolves when complete.
   */
  connect() {
    throw new Error("'connect' not implemented")
  }

  /**
   * Optional close hook for database drivers.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async close() {
    // No-op by default
  }

  /**
   * Optional disconnect hook for database drivers.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async disconnect() {
    // No-op by default
  }

  /**
   * @abstract
   * @param {string} databaseName - Database name.
   * @param {object} [args] - Options object.
   * @param {boolean} [args.ifNotExists] - Whether if not exists.
   * @returns {string[]} - SQL statements.
   */
  createDatabaseSql(databaseName, args) { throw new Error("'createDatabaseSql' not implemented") } // eslint-disable-line no-unused-vars

  /**
   * @abstract
   * @param {CreateIndexSqlArgs} indexData - Index data.
   * @returns {Promise<string[]>} - Resolves with SQL statements.
   */
  async createIndexSQLs(indexData) { // eslint-disable-line no-unused-vars
    throw new Error("'createIndexSQLs' not implemented")
  }

  /**
   * @param {import("../table-data/index.js").default} tableData - Table data.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async createTable(tableData) {
    this._assertNotReadOnly()
    const sqls = await this.createTableSql(tableData)

    for (const sql of sqls) {
      await this.query(sql)
    }
  }

  /**
   * @abstract
   * @param {import("../table-data/index.js").default} tableData - Table data.
   * @returns {Promise<string[]>} - Resolves with SQL statements.
   */
  async createTableSql(tableData) { // eslint-disable-line no-unused-vars
    throw new Error("'createTableSql' not implemented")
  }

  /**
   * @param {DeleteSqlArgsType} args - Options object.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async delete(args) {
    this._assertNotReadOnly()
    const sql = this.deleteSql(args)

    await this.query(sql)
  }

  /**
   * @abstract
   * @param {DeleteSqlArgsType} args - Options object.
   * @returns {string} - SQL string.
   */
  deleteSql(args) { // eslint-disable-line no-unused-vars
    throw new Error(`'deleteSql' not implemented`)
  }

  /**
   * @param {string} tableName - Table name.
   * @param {DropTableSqlArgsType} [args] - Options object.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async dropTable(tableName, args) {
    this._assertNotReadOnly()
    const sqls = await this.dropTableSQLs(tableName, args)

    for (const sql of sqls) {
      await this.query(sql)
    }
  }

  /**
   * @abstract
   * @param {string} tableName - Table name.
   * @param {DropTableSqlArgsType} [args] - Options object.
   * @returns {Promise<string[]>} - Resolves with SQL statements.
   */
  async dropTableSQLs(tableName, args) { // eslint-disable-line no-unused-vars
    throw new Error("dropTableSQLs not implemented")
  }

  /**
   * @abstract
   * @param {any} value - Value to use.
   * @returns {any} - The escape.
   */
  escape(value) { // eslint-disable-line no-unused-vars
    throw new Error("'escape' not implemented")
  }

  /**
   * @returns {import("../../configuration-types.js").DatabaseConfigurationType} - The args.
   */
  getArgs() {
    return this._args
  }

  /**
   * @returns {import("../../configuration.js").default} - The configuration.
   */
  getConfiguration() {
    if (!this.configuration) throw new Error("No configuration set")

    return this.configuration
  }

  /**
   * @returns {number | undefined} - The id seq.
   */
  getIdSeq() {
    return this.idSeq
  }

  /**
   * @abstract
   * @returns {Promise<Array<import("./base-table.js").default>>} - Resolves with the tables.
   */
  getTables() {
    throw new Error(`${this.constructor.name}#getTables not implemented`)
  }

  /**
   * @returns {Promise<string | null>} - Resolves with SQL string.
   */
  async structureSql() {
    return null
  }

  /**
   * @param {string} name - Name.
   * @param {object} [args] - Options object.
   * @param {boolean} args.throwError - Whether throw error.
   * @returns {Promise<import("./base-table.js").default | undefined>} - Resolves with the table by name.
   */
  async getTableByName(name, args) {
    const tables = await this.getTables()
    const tableNames = []
    let table

    for (const candidate of tables) {
      const candidateName = candidate.getName()

      if (candidateName == name) {
        table = candidate
        break
      }

      tableNames.push(candidateName)
    }

    if (!table && args?.throwError !== false) throw new Error(`Couldn't find a table by that name "${name}" in: ${tableNames.join(", ")}`)

    return table
  }

  /**
   * @param {string} name - Name.
   * @returns {Promise<import("./base-table.js").default>} - Resolves with the table by name or fail.
   */
  async getTableByNameOrFail(name) {
    return await this.getTableByName(name, {throwError: true})
  }

  /**
   * @abstract
   * @returns {string} - The type.
   */
  getType() {
    throw new Error("'type' not implemented")
  }

  /**
   * @param {InsertSqlArgsType} args - Options object.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async insert(args) {
    this._assertNotReadOnly()
    const sql = this.insertSql(args)

    await this.query(sql)
  }

  /**
   * @param {string} tableName - Table name.
   * @param {Array<string>} columns - Column names.
   * @param {Array<Array<unknown>>} rows - Rows to insert.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async insertMultiple(tableName, columns, rows) {
    this._assertNotReadOnly()

    const sql = this.insertSql({columns, tableName, rows})

    await this.query(sql)
  }

  /**
   * @abstract
   * @param {InsertSqlArgsType} args - Options object.
   * @returns {string} - SQL string.
   */
  insertSql(args) { // eslint-disable-line no-unused-vars
    throw new Error("'insertSql' not implemented")
  }

  /**
   * @abstract
   * @returns {Promise<number>} - Resolves with the last insert id.
   */
  lastInsertID() {
    throw new Error(`${this.constructor.name}#lastInsertID not implemented`)
  }

  /**
   * @param {any} value - Value to use.
   * @returns {any} - The convert value.
   */
  _convertValue(value) {
    if (typeof value === "boolean") {
      return value ? 1 : 0
    }

    if (value instanceof Date) {
      return strftime("%F %T.%L", value)
    }

    return value
  }

  /**
   * @abstract
   * @returns {import("../query-parser/options.js").default} - The options options.
   */
  options() {
    throw new Error("'options' not implemented.")
  }

  /**
   * @param {any} value - Value to use.
   * @returns {number | string} - The quote.
   */
  quote(value) {
    if (typeof value == "number") return value

    const escapedValue = this.escape(value)
    const result = `"${escapedValue}"`

    return result
  }

  /**
   * @param {string} columnName - Column name.
   * @returns {string} - The quote column.
   */
  quoteColumn(columnName) {
    return this.options().quoteColumnName(columnName)
  }

  /**
   * @param {string} columnName - Column name.
   * @returns {string} - The quote index.
   */
  quoteIndex(columnName) {
    return this.options().quoteIndexName(columnName)
  }

  /**
   * @param {string} tableName - Table name.
   * @returns {string} - The quote table.
   */
  quoteTable(tableName) {
    return this.options().quoteTableName(tableName)
  }

  /**
   * @param {any} value - Value from database.
   * @returns {any} - Normalized value.
   */

  /**
   * @returns {Query} - The new query.
   */
  newQuery() {
    const handler = new Handler()

    return new Query({
      driver: this,
      handler
    })
  }

  /**
   * @param {string} tableName - Table name.
   * @returns {Promise<QueryResultType>} - Resolves with the select.
   */
  async select(tableName) {
    const query = this.newQuery()

    const sql = query
      .from(tableName)
      .toSql()

    return await this.query(sql)
  }

  /**
   * @param {number | undefined} newIdSeq - New id seq.
   * @returns {void} - No return value.
   */
  setIdSeq(newIdSeq) {
    this.idSeq = newIdSeq
  }

  /**
   * @abstract
   * @returns {boolean} - Whether set auto increment when primary key.
   */
  shouldSetAutoIncrementWhenPrimaryKey() {
    throw new Error(`'shouldSetAutoIncrementWhenPrimaryKey' not implemented`)
  }

  /**
   * @returns {boolean} - Whether supports default primary key uuid.
   */
  supportsDefaultPrimaryKeyUUID() { return false }

  /**
   * @abstract
   * @returns {boolean} - Whether supports insert into returning.
   */
  supportsInsertIntoReturning() { return false }

  /**
   * @param {string} tableName - Table name.
   * @returns {Promise<boolean>} - Resolves with Whether table exists.
   */
  async tableExists(tableName) {
    const tables = await this.getTables()
    const table = tables.find((table) => table.getName() == tableName)

    if (table) return true

    return false
  }

  /**
   * @param {() => Promise<void>} callback - Callback function.
   * @returns {Promise<any>} - Resolves with the transaction.
   */
  async transaction(callback) {
    const savePointName = this.generateSavePointName()
    let transactionStarted = false
    let savePointStarted = false

    if (this._transactionsCount == 0) {
      this.logger.debug("Start transaction")
      await this.startTransaction()
      transactionStarted = true
    } else {
      this.logger.debug("Start savepoint", savePointName)
      await this.startSavePoint(savePointName)
      savePointStarted = true
    }

    let result

    try {
      result = await callback()

      if (savePointStarted) {
        this.logger.debug("Release savepoint", savePointName)
        await this.releaseSavePoint(savePointName)
      }

      if (transactionStarted) {
        this.logger.debug("Commit transaction")
        await this.commitTransaction()
      }
    } catch (error) {
      if (error instanceof Error) {
        this.logger.debug("Transaction error", error.message)
      } else {
        this.logger.debug("Transaction error", error)
      }

      let transactionRolledBack = false

      if (savePointStarted) {
        this.logger.debug("Rollback savepoint", savePointName)
        try {
          await this.rollbackSavePoint(savePointName)
        } catch (savePointError) {
          const message = savePointError instanceof Error ? savePointError.message : `${savePointError}`

          // MySQL sometimes drops savepoints unexpectedly; fall back to rolling back the full transaction
          if (message.includes("SAVEPOINT") || message.includes("ER_SP_DOES_NOT_EXIST")) {
            this.logger.debug("Savepoint rollback failed; rolling back entire transaction instead")
            await this.rollbackTransaction()
            transactionRolledBack = true
          } else {
            throw savePointError
          }
        }
      }

      if (transactionStarted && !transactionRolledBack) {
        this.logger.debug("Rollback transaction")
        await this.rollbackTransaction()
      }

      throw error
    }

    return result
  }

  /**
   * @returns {Promise<void>} - Resolves when complete.
   */
  async startTransaction() {
    await this._transactionsActionsMutex.sync(async () => {
      await this._startTransactionAction()
      this._transactionsCount++
    })
  }

  /**
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _startTransactionAction() {
    await this.query("BEGIN TRANSACTION")
  }

  /**
   * @returns {Promise<void>} - Resolves when complete.
   */
  async commitTransaction() {
    await this._transactionsActionsMutex.sync(async () => {
      await this._commitTransactionAction()
      this._transactionsCount--
    })
  }

  /**
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _commitTransactionAction() {
    await this.query("COMMIT")
  }

  /**
   * @param {string} sql - SQL string.
   * @returns {Promise<QueryResultType>} - Resolves with the query.
   */
  async query(sql) {
    this._assertWritableQuery(sql)

    let tries = 0

    while(tries < 5) {
      tries++

      try {
        return await this._queryActual(sql)
      } catch (error) {
        if (error instanceof Error && tries < 5 && this.retryableDatabaseError(error)) {
          await wait(100)
          this.logger.warn(`Retrying query because failed with: ${error.stack}`)
          // Retry
        } else {
          throw error
        }
      }
    }

    throw new Error("'query' unexpected came here")
  }

  /**
   * @abstract
   * @param {string} sql - SQL string.
   * @returns {Promise<QueryResultType>} - Resolves with the query actual.
   */
  _queryActual(sql) { // eslint-disable-line no-unused-vars
    throw new Error(`queryActual not implemented`)
  }

  /**
   * @abstract
   * @param {Query} _query - Query instance.
   * @returns {string} - SQL string.
   */
  queryToSql(_query) { throw new Error("queryToSql not implemented") } // eslint-disable-line no-unused-vars

  /**
   * @param {Error} _error - Error instance.
   * @returns {boolean} - Whether retryable database error.
   */
  retryableDatabaseError(_error) { // eslint-disable-line no-unused-vars
    return false
  }

  /**
   * @param {string} sql - SQL string.
   * @returns {void} - No return value.
   */
  _assertWritableQuery(sql) {
    if (!this.isReadOnly()) return
    if (!this._sqlLooksLikeWrite(sql)) return

    throw new Error("Database is read-only")
  }

  /**
   * @returns {void} - No return value.
   */
  _assertNotReadOnly() {
    if (this.isReadOnly()) {
      throw new Error("Database is read-only")
    }
  }

  /**
   * @param {string} sql - SQL string.
   * @returns {boolean} - SQL representation.
   */
  _sqlLooksLikeWrite(sql) {
    const normalized = sql.trim().toLowerCase()

    if (!normalized) return false

    if (
      normalized.startsWith("select") ||
      normalized.startsWith("show") ||
      normalized.startsWith("pragma") ||
      normalized.startsWith("explain") ||
      normalized.startsWith("describe")
    ) {
      return false
    }

    if (normalized.startsWith("with")) {
      const withMatch = normalized.match(/^\s*with[\s\S]+?\)\s*(select|insert|update|delete|merge|replace)\b/)

      if (withMatch) {
        return withMatch[1] !== "select"
      }

      return false
    }

    const keywordMatch = normalized.match(/^\s*(\w+)/)
    const keyword = keywordMatch ? keywordMatch[1] : ""

    return [
      "insert",
      "update",
      "delete",
      "create",
      "alter",
      "drop",
      "truncate",
      "merge",
      "replace"
    ].includes(keyword)
  }

  /** @returns {boolean} - Whether read only.  */
  isReadOnly() {
    return Boolean(this.getArgs().readOnly)
  }

  /**
   * @returns {Promise<void>} - Resolves when complete.
   */
  async rollbackTransaction() {
    await this._transactionsActionsMutex.sync(async () => {
      await this._rollbackTransactionAction()
      this._transactionsCount--
    })
  }

  /**
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _rollbackTransactionAction() {
    await this.query("ROLLBACK")
  }

  /**
   * @returns {string} - The generate save point name.
   */
  generateSavePointName() {
    return `sp${new UUID(4).format().replaceAll("-", "")}`
  }

  /**
   * @param {string} savePointName - Save point name.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async startSavePoint(savePointName) {
    await this._transactionsActionsMutex.sync(async () => {
      await this._startSavePointAction(savePointName)
    })
  }

  /**
   * @param {string} savePointName - Save point name.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _startSavePointAction(savePointName) {
    await this.query(`SAVEPOINT ${savePointName}`)
  }

  /**
   * @param {string} tableName - Table name.
   * @param {string} oldColumnName - Previous column name.
   * @param {string} newColumnName - New column name.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async renameColumn(tableName, oldColumnName, newColumnName) {
    this._assertNotReadOnly()
    const tableColumn = new TableColumn(oldColumnName)

    tableColumn.setNewName(newColumnName)

    const tableData = new TableData(tableName)

    tableData.addColumn(tableColumn)

    const alterTableSQLs = await this.alterTableSQLs(tableData)

    for (const alterTableSQL of alterTableSQLs) {
      await this.query(alterTableSQL)
    }
  }

  /**
   * @param {string} savePointName - Save point name.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async releaseSavePoint(savePointName) {
    await this._transactionsActionsMutex.sync(async () => {
      await this._releaseSavePointAction(savePointName)
    })
  }

  /**
   * @param {string} savePointName - Save point name.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _releaseSavePointAction(savePointName) {
    try {
      await this.query(`RELEASE SAVEPOINT ${savePointName}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : `${error}`

      // Savepoint may already be gone if the database rolled back automatically
      if (message.toLowerCase().includes("savepoint") && message.toLowerCase().includes("does not exist")) {
        this.logger.debug(`Release savepoint ignored because it no longer exists: ${savePointName}`)
        return
      }

      throw error
    }
  }

  /**
   * @param {string} savePointName - Save point name.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async rollbackSavePoint(savePointName) {
    await this._transactionsActionsMutex.sync(async () => {
      await this._rollbackSavePointAction(savePointName)
    })
  }

  /**
   * @param {string} savePointName - Save point name.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _rollbackSavePointAction(savePointName) {
    await this.query(`ROLLBACK TO SAVEPOINT ${savePointName}`)
  }

  /**
   * @returns {Promise<void>} - Resolves when complete.
   */
  async truncateAllTables() {
    this._assertNotReadOnly()
    await this.withDisabledForeignKeys(async () => {
      let tries = 0

      while(tries <= 5) {
        tries++

        const tables = await this.getTables()
        const truncateErrors = []

        for (const table of tables) {
          if (table.getName() != "schema_migrations") {
            try {
              await table.truncate({cascade: true})
            } catch (error) {
              console.error(error)
              truncateErrors.push(error)
            }
          }
        }

        if (truncateErrors.length == 0) {
          break
        } else if (tries <= 5) {
          // Retry
        } else {
          throw truncateErrors[0]
        }
      }
    })
  }

  /**
   * @param {UpdateSqlArgsType} args - Options object.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async update(args) {
    this._assertNotReadOnly()
    const sql = this.updateSql(args)

    await this.query(sql)
  }

  /**
   * @abstract
   * @param {UpdateSqlArgsType} args - Options object.
   * @returns {string} - SQL string.
   */
  updateSql(args) { // eslint-disable-line no-unused-vars
    throw new Error("'disableForeignKeys' not implemented")
  }

  /**
   * @abstract
   * @returns {Promise<void>} - Resolves when complete.
   */
  disableForeignKeys() {
    throw new Error("'disableForeignKeys' not implemented")
  }

  /**
   * @abstract
   * @returns {Promise<void>} - Resolves when complete.
   */
  enableForeignKeys() {
    throw new Error("'enableForeignKeys' not implemented")
  }

  /**
   * @param {function() : void} callback - Callback function.
   * @returns {Promise<any>} - Resolves with the with disabled foreign keys.
   */
  async withDisabledForeignKeys(callback) {
    await this.disableForeignKeys()

    try {
      return await callback()
    } finally {
      await this.enableForeignKeys()
    }
  }
}
