import Query from "../query/index.js"
import Handler from "../handler.js"
import {v4 as uuidv4} from "uuid"

export default class VelociousDatabaseDriversBase {
  constructor(config, configuration) {
    this._args = config
    this.configuration = configuration
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

  async select(tableName) {
    const handler = new Handler()
    const query = new Query({
      driver: this,
      handler
    })

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

  async startTransaction() {
    return await this.query("BEGIN TRANSACTION")
  }

  async transaction(callback) {
    const savePointName = `sp${uuidv4().replaceAll("-", "")}`
    let transactionStarted = false

    if (this._transactionsCount == 0) {
      await this.startTransaction()
      transactionStarted = true
      this._transactionsCount++
    }

    await this.query(`SAVEPOINT ${savePointName}`)

    let result

    try {
      result = await callback()

      await this.query(`RELEASE SAVEPOINT ${savePointName}`)

      if (transactionStarted) {
        await this.query("COMMIT")
        this._transactionsCount--
      }
    } catch (error) {
      await this.query(`ROLLBACK TO SAVEPOINT ${savePointName}`)

      if (transactionStarted) {
        await this.query("ROLLBACK")
        this._transactionsCount--
      }

      throw error
    }

    return result
  }

  async update(...args) {
    const sql = this.updateSql(...args)

    await this.query(sql)
  }
}
