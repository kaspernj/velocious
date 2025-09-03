import {Logger} from "../../logger.js"
import Query from "../query/index.js"
import Handler from "../handler.js"
import {v4 as uuidv4} from "uuid"

export default class VelociousDatabaseDriversBase {
  constructor(config, configuration) {
    this._args = config
    this.configuration = configuration
    this.logger = new Logger(this)
    this._transactionsCount = 0
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

  getConfiguration = () => this.configuration

  getIdSeq() {
    return this.idSeq
  }

  getTables() {
    throw new Error(`${this.constructor.name}#getTables not implemented`)
  }

  async getTableByName(name) {
    const tables = await this.getTables()
    const table = tables.find((table) => table.getName() == name)

    if (!table) throw new Error(`Couldn't find a table by that name: ${name}`)

    return table
  }

  async insert(...args) {
    const sql = this.insertSql(...args)

    await this.query(sql)
  }

  lastInsertID() {
    throw new Error(`${this.constructor.name}#lastInsertID not implemented`)
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
      this._transactionsCount++
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
        this._transactionsCount--
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
        this._transactionsCount--
      }

      throw error
    }

    return result
  }

  async startTransaction() {
    return await this.query("BEGIN TRANSACTION")
  }

  async commitTransaction() {
    await this.query("COMMIT")
  }

  async rollbackTransaction() {
    await this.query("ROLLBACK")
  }

  generateSavePointName() {
    return `sp${uuidv4().replaceAll("-", "")}`
  }

  async startSavePoint(savePointName) {
    await this.query(`SAVEPOINT ${savePointName}`)
  }

  async releaseSavePoint(savePointName) {
    await this.query(`RELEASE SAVEPOINT ${savePointName}`)
  }

  async rollbackSavePoint(savePointName) {
    await this.query(`ROLLBACK TO SAVEPOINT ${savePointName}`)
  }

  async update(...args) {
    const sql = this.updateSql(...args)

    await this.query(sql)
  }
}
