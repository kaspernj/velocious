import Query from "../query/index.js"
import Handler from "../handler.js"

export default class VelociousDatabaseDriversBase {
  constructor(args) {
    this._args = args
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

  async update(...args) {
    const sql = this.updateSql(...args)

    await this.query(sql)
  }
}
