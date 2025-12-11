/**
 * @typedef {object} CreateIndexSqlArgs
 * @property {Array<string | import("./../table-data/table-column.js").default>} columns
 * @property {boolean} [ifNotExists]
 * @property {string} [name]
 * @property {boolean} [unique]
 * @property {string} tableName
 */
/**
 * @typedef {object} DropTableSqlArgsType
 * @property {boolean} [cascade]
 * @property {boolean} [ifExists]
 */
/**
 * @typedef {object} DeleteSqlArgsType
 * @property {string} tableName
 * @property {{[key: string]: any}} conditions
 */
/**
 * @typedef {object} InsertSqlArgsType
 * @property {Array} [columns]
 * @property {{[key: string]: any}} [data]
 * @property {boolean} [multiple]
 * @property {boolean} [returnLastInsertedColumnNames]
 * @property {Array} [rows]
 * @property {string} tableName
 */
/**
 * @typedef {Record<string, any>} QueryRowType
 * @typedef {Array<QueryRowType>} QueryResultType
 */

import {Logger} from "../../logger.js"
import Query from "../query/index.js"
import Handler from "../handler.js"
import Mutex from "epic-locks/src/mutex.js"
import strftime from "strftime"
import UUID from "pure-uuid"
import TableData from "../table-data/index.js"
import TableColumn from "../table-data/table-column.js"
import TableForeignKey from "../table-data/table-foreign-key.js"
import wait from "awaitery/src/wait.js"

export default class VelociousDatabaseDriversBase {
  /** @type {number | undefined} */
  idSeq = undefined

  /**
   * @param {object} config
   * @param {import("../../configuration.js").default} configuration
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
   * @param {string} tableName
   * @param {string} columnName
   * @param {string} referencedTableName
   * @param {string} referencedColumnName
   * @param {object} args
   * @returns {Promise<void>}
   */
  async addForeignKey(tableName, columnName, referencedTableName, referencedColumnName, args) {
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

    const alterTableSQLs = await this.alterTableSql(tableData)

    for (const alterTableSQL of alterTableSQLs) {
      await this.query(alterTableSQL)
    }
  }

  /**
   * @interface
   * @param {import("../table-data/index.js").default} _tableData
   * @returns {Promise<string[]>}
   */
  alterTableSql(_tableData) { // eslint-disable-line no-unused-vars
    throw new Error("alterTableSql not implemented")
  }

  /**
   * @interface
   * @returns {Promise<void>}
   */
  connect() {
    throw new Error("'connect' not implemented")
  }

  /**
   * @interface
   * @param {CreateIndexSqlArgs} indexData
   * @returns {string}
   */
  createIndexSql(indexData) { // eslint-disable-line no-unused-vars
    throw new Error("'createIndexSql' not implemented")
  }

  /**
   * @param {...Parameters<this["createTableSql"]>} args
   * @returns {void}
   */
  async createTable(...args) {
    const sqls = this.createTableSql(...args)

    for (const sql of sqls) {
      await this.query(sql)
    }
  }

  /**
   * @interface
   * @param {import("../table-data/index.js").default} tableData
   * @returns {string[]}
   */
  createTableSql(tableData) { // eslint-disable-line no-unused-vars
    throw new Error("'createTableSql' not implemented")
  }

  /**
   * @param {DeleteSqlArgsType} args
   * @returns {void}
   */
  async delete(args) {
    const sql = this.deleteSql(args)

    await this.query(sql)
  }

  /**
   * @interface
   * @param {DeleteSqlArgsType} args
   * @returns {string}
   */
  deleteSql(args) { // eslint-disable-line no-unused-vars
    throw new Error(`'deleteSql' not implemented`)
  }

  /**
   * @param {string} tableName
   * @param {DropTableSqlArgsType} [args]
   * @returns {string}
   */
  async dropTable(tableName, args) {
    const sqls = this.dropTableSql(tableName, args)

    for (const sql of sqls) {
      await this.query(sql)
    }
  }

  /**
   * @interface
   * @param {string} tableName
   * @param {DropTableSqlArgsType} [args]
   * @returns {string}
   */
  dropTableSql(tableName, args) { // eslint-disable-line no-unused-vars
    throw new Error("dropTableSql not implemented")
  }

  /**
   * @returns {object}
   */
  getArgs() {
    return this._args
  }

  /**
   * @returns {import("../../configuration.js").default}
   */
  getConfiguration() {
    if (!this.configuration) throw new Error("No configuration set")

    return this.configuration
  }

  /**
   * @returns {number | undefined}
   */
  getIdSeq() {
    return this.idSeq
  }

  /**
   * @interface
   * @returns {Array<import("./base-table.js").default>}
   */
  getTables() {
    throw new Error(`${this.constructor.name}#getTables not implemented`)
  }

  async getTableByName(name, args) {
    const tables = await this.getTables()
    const table = tables.find((table) => table.getName() == name)

    if (!table && args?.throwError !== false) throw new Error(`Couldn't find a table by that name: ${name}`)

    return table
  }

  /**
   * @interface
   * @returns {string}
   */
  getType() {
    throw new Error("'type' not implemented")
  }

  /**
   * @param {InsertSqlArgsType} args
   * @returns {Promise<void>}
   */
  async insert(args) {
    const sql = this.insertSql(args)

    await this.query(sql)
  }

  /**
   * @interface
   * @param {InsertSqlArgsType} args
   * @returns {string}
   */
  insertSql(args) { // eslint-disable-line no-unused-vars
    throw new Error("'insertSql' not implemented")
  }

  /**
   * @interface
   * @returns {Promise<number>}
   */
  lastInsertID() {
    throw new Error(`${this.constructor.name}#lastInsertID not implemented`)
  }

  _convertValue(value) {
    if (value instanceof Date) {
      return strftime("%F %T.%L", value)
    }

    return value
  }

  /**
   * @interface
   * @returns {import("../query-parser/options.js").default}
   */
  options() {
    throw new Error("'options' not implemented.")
  }

  /**
   * @param {string} value
   * @returns {string}
   */
  quote(value) {
    if (typeof value == "number") return value

    const escapedValue = this.escape(value)
    const result = `"${escapedValue}"`

    return result
  }

  /**
   * @param {string} columnName
   * @returns {string}
   */
  quoteColumn(columnName) {
    return this.options().quoteColumnName(columnName)
  }

  /**
   * @param {string} columnName
   * @returns {string}
   */
  quoteIndex(columnName) {
    return this.options().quoteIndexName(columnName)
  }

  /**
   * @param {string} tableName
   * @returns {string}
   */
  quoteTable(tableName) {
    return this.options().quoteTableName(tableName)
  }

  /**
   * @returns {Query}
   */
  newQuery() {
    const handler = new Handler()

    return new Query({
      driver: this,
      handler
    })
  }

  /**
   * @param {string} tableName
   * @returns {Promise<Array>}
   */
  async select(tableName) {
    const query = this.newQuery()

    const sql = query
      .from(tableName)
      .toSql()

    return await this.query(sql)
  }

  /**
   * @param {number | undefined} newIdSeq
   * @returns {void}
   */
  setIdSeq(newIdSeq) {
    this.idSeq = newIdSeq
  }

  /**
   * @interface
   * @returns {boolean}
   */
  shouldSetAutoIncrementWhenPrimaryKey() {
    throw new Error(`'shouldSetAutoIncrementWhenPrimaryKey' not implemented`)
  }

  /**
   * @param {string} tableName
   * @returns {Promise<boolean>}
   */
  async tableExists(tableName) {
    const tables = await this.getTables()
    const table = tables.find((table) => table.getName() == tableName)

    if (table) return true

    return false
  }

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
      this.logger.debug("Transaction error", error.message)

      if (savePointStarted) {
        this.logger.debug("Rollback savepoint", savePointName)
        await this.rollbackSavePoint(savePointName)
      }

      if (transactionStarted) {
        this.logger.debug("Rollback transaction")
        await this.rollbackTransaction()
      }

      throw error
    }

    return result
  }

  /**
   * @returns {Promise<void>}
   */
  async startTransaction() {
    await this._transactionsActionsMutex.sync(async () => {
      await this._startTransactionAction()
      this._transactionsCount++
    })
  }

  /**
   * @returns {Promise<void>}
   */
  async _startTransactionAction() {
    await this.query("BEGIN TRANSACTION")
  }

  /**
   * @returns {Promise<void>}
   */
  async commitTransaction() {
    await this._transactionsActionsMutex.sync(async () => {
      await this._commitTransactionAction()
      this._transactionsCount--
    })
  }

  /**
   * @returns {Promise<void>}
   */
  async _commitTransactionAction() {
    await this.query("COMMIT")
  }

  /**
   * @param {string} sql
   * @returns {Promise<QueryResultType>}
   */
  async query(sql) {
    let tries = 0

    while(tries < 5) {
      tries++

      try {
        return await this._queryActual(sql)
      } catch (error) {
        if (tries < 5 && this.retryableDatabaseError(error)) {
          await wait(100)
          this.logger.warn(`Retrying query because failed with: ${error.stack}`)
          // Retry
        } else {
          throw error
        }
      }
    }
  }

  /**
   * @interface
   * @param {Query} _query
   * @returns {string}
   */
  queryToSql(_query) { throw new Error("queryToSql not implemented") } // eslint-disable-line no-unused-vars

  /**
   * @interface
   * @param {Error} _error
   * @returns {boolean}
   */
  retryableDatabaseError(_error) { // eslint-disable-line no-unused-vars
    return false
  }

  /**
   * @returns {Promise<void>}
   */
  async rollbackTransaction() {
    await this._transactionsActionsMutex.sync(async () => {
      await this._rollbackTransactionAction()
      this._transactionsCount--
    })
  }

  /**
   * @returns {Promise<void>}
   */
  async _rollbackTransactionAction() {
    await this.query("ROLLBACK")
  }

  /**
   * @returns {string}
   */
  generateSavePointName() {
    return `sp${new UUID(4).format().replaceAll("-", "")}`
  }

  /**
   * @param {string} savePointName
   * @returns {Promise<void>}
   */
  async startSavePoint(savePointName) {
    await this._transactionsActionsMutex.sync(async () => {
      await this._startSavePointAction(savePointName)
    })
  }

  /**
   * @param {string} savePointName
   * @returns {Promise<void>}
   */
  async _startSavePointAction(savePointName) {
    await this.query(`SAVEPOINT ${savePointName}`)
  }

  /**
   * @param {string} tableName
   * @param {string} oldColumnName
   * @param {string} newColumnName
   * @returns {Promise<void>}
   */
  async renameColumn(tableName, oldColumnName, newColumnName) {
    const tableColumn = new TableColumn(oldColumnName)

    tableColumn.setNewName(newColumnName)

    const tableData = new TableData(tableName)

    tableData.addColumn(tableColumn)

    const alterTableSQLs = await this.alterTableSql(tableData)

    for (const alterTableSQL of alterTableSQLs) {
      await this.query(alterTableSQL)
    }
  }

  /**
   * @param {string} savePointName
   * @returns {Promise<void>}
   */
  async releaseSavePoint(savePointName) {
    await this._transactionsActionsMutex.sync(async () => {
      await this._releaseSavePointAction(savePointName)
    })
  }

  /**
   * @param {string} savePointName
   * @returns {Promise<void>}
   */
  async _releaseSavePointAction(savePointName) {
    await this.query(`RELEASE SAVEPOINT ${savePointName}`)
  }

  /**
   * @param {string} savePointName
   * @returns {Promise<void>}
   */
  async rollbackSavePoint(savePointName) {
    await this._transactionsActionsMutex.sync(async () => {
      await this._rollbackSavePointAction(savePointName)
    })
  }

  /**
   * @param {string} savePointName
   * @returns {Promise<void>}
   */
  async _rollbackSavePointAction(savePointName) {
    await this.query(`ROLLBACK TO SAVEPOINT ${savePointName}`)
  }

  /**
   * @returns {Promise<void>}
   */
  async truncateAllTables() {
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
   * @param {object} args
   * @param {object} args.conditions
   * @param {object} args.data
   * @param {string} args.tableName
   * @returns {Promise<void>}
   */
  async update(...args) {
    const sql = this.updateSql(...args)

    await this.query(sql)
  }

  /**
   * @param {function() : void} callback
   * @returns {Promise<any>}
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
