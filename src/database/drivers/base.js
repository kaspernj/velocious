import {Logger} from "../../logger.js"
import Query from "../query/index.js"
import Handler from "../handler.js"
import strftime from "strftime"
import UUID from "pure-uuid"
import TableData from "../table-data/index.js"
import TableColumn from "../table-data/table-column.js"
import TableForeignKey from "../table-data/table-foreign-key.js"
import {Mutex} from "async-mutex"

export default class VelociousDatabaseDriversBase {
  constructor(config, configuration) {
    this._args = config
    this.configuration = configuration
    this.logger = new Logger(this)
    this._transactionsCount = 0
    this._transactionsActionsMutex = new Mutex()
  }

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

  async createTable(...args) {
    const sqls = this.createTableSql(...args)

    for (const sql of sqls) {
      await this.query(sql)
    }
  }

  async delete(...args) {
    const sql = this.deleteSql(...args)

    await this.query(sql)
  }

  async dropTable(...args) {
    const sqls = this.dropTableSql(...args)

    for (const sql of sqls) {
      await this.query(sql)
    }
  }

  getArgs() {
    return this._args
  }

  getConfiguration() {
    if (!this.configuration) throw new Error("No configuration set")

    return this.configuration
  }

  getIdSeq() {
    return this.idSeq
  }

  getTables() {
    throw new Error(`${this.constructor.name}#getTables not implemented`)
  }

  async getTableByName(name, args) {
    const tables = await this.getTables()
    const table = tables.find((table) => table.getName() == name)

    if (!table && args?.throwError !== false) throw new Error(`Couldn't find a table by that name: ${name}`)

    return table
  }

  async insert(...args) {
    const sql = this.insertSql(...args)

    await this.query(sql)
  }

  lastInsertID() {
    throw new Error(`${this.constructor.name}#lastInsertID not implemented`)
  }

  _convertValue(value) {
    if (value instanceof Date) {
      return strftime("%F %T.%L", value)
    }

    return value
  }

  quote(value) {
    if (typeof value == "number") return value

    const escapedValue = this.escape(value)
    const result = `"${escapedValue}"`

    return result
  }

  quoteColumn(columnName) {
    return this.options().quoteColumnName(columnName)
  }

  quoteIndex(columnName) {
    return this.options().quoteIndexName(columnName)
  }

  quoteTable(tableName) {
    return this.options().quoteColumnName(tableName)
  }

  newQuery() {
    const handler = new Handler()

    return new Query({
      driver: this,
      handler
    })
  }

  async select(tableName) {
    const query = this.newQuery()

    const sql = query
      .from(tableName)
      .toSql()

    return await this.query(sql)
  }

  setIdSeq(id) {
    this.idSeq = id
  }

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

  async startTransaction() {
    await this._transactionsActionsMutex.runExclusive(async () => {
      await this._startTransactionAction()
      this._transactionsCount++
    })
  }

  async _startTransactionAction() {
    await this.query("BEGIN TRANSACTION")
  }

  async commitTransaction() {
    await this._transactionsActionsMutex.runExclusive(async () => {
      await this._commitTransactionAction()
      this._transactionsCount--
    })
  }

  async _commitTransactionAction() {
    await this.query("COMMIT")
  }

  async rollbackTransaction() {
    await this._transactionsActionsMutex.runExclusive(async () => {
      await this._rollbackTransactionAction()
      this._transactionsCount--
    })
  }

  async _rollbackTransactionAction() {
    await this.query("ROLLBACK")
  }

  generateSavePointName() {
    return `sp${new UUID(4).format().replaceAll("-", "")}`
  }

  async startSavePoint(savePointName) {
    await this._transactionsActionsMutex.runExclusive(async () => {
      await this._startSavePointAction(savePointName)
    })
  }

  async _startSavePointAction(savePointName) {
    await this.query(`SAVEPOINT ${savePointName}`)
  }

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

  async releaseSavePoint(savePointName) {
    await this._transactionsActionsMutex.runExclusive(async () => {
      this._releaseSavePointAction(savePointName)
    })
  }

  async _releaseSavePointAction(savePointName) {
    await this.query(`RELEASE SAVEPOINT ${savePointName}`)
  }

  async rollbackSavePoint(savePointName) {
    await this._transactionsActionsMutex.runExclusive(async () => {
      await this._rollbackSavePointAction(savePointName)
    })
  }

  async _rollbackSavePointAction(savePointName) {
    await this.query(`ROLLBACK TO SAVEPOINT ${savePointName}`)
  }

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

  async update(...args) {
    const sql = this.updateSql(...args)

    await this.query(sql)
  }

  async withDisabledForeignKeys(callback) {
    await this.disableForeignKeys()

    try {
      return await callback()
    } finally {
      await this.enableForeignKeys()
    }
  }
}
