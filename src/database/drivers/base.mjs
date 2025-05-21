import Query from "../query/index"
import Handler from "../handler"

export default class VelociousDatabaseDriversBase {
  constructor(args) {
    this._args = args
  }

  async createTable(...args) {
    const sql = this.createTableSql(...args)

    await this.query(sql)
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

  async insert(...args) {
    const sql = this.insertSql(...args)

    await this.query(sql)
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

  async update(...args) {
    const sql = this.updateSql(...args)

    await this.query(sql)
  }
}
