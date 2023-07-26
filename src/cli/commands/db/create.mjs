import DatabasePool from "../../../database/pool/index.mjs"
import {digg} from "diggerize"

export default class DbCreate {
  constructor(args) {
    if (!args) throw new Error("No 'args' given")

    this.args = args
  }

  async initialize() {
    const database = DatabasePool.current()

    await database.connect()
    this.databaseConnection = database.singleConnection()
  }

  async execute() {
    const databaseName = digg(this.databaseConnection.getArgs(), "database")
    const sql = this.databaseConnection.createDatabaseSql(databaseName, {ifNotExists: true})

    if (this.args.testing) {
      return {databaseName, sql}
    }

    await this.databaseConnection.query(sql)
  }
}
