import BaseCommand from "../../base-command.mjs"
import DatabasePool from "../../../database/pool/index.mjs"
import {digg} from "diggerize"

export default class DbCreate extends BaseCommand{
  async execute() {
    const databasePool = DatabasePool.current()
    const newConfiguration = Object.assign({}, databasePool.getConfiguration())
    const databaseName = digg(newConfiguration, "database")

    // Use a database known to exist. Since we are creating the database, it shouldn't actually exist which would make connecting fail.
    newConfiguration.database = newConfiguration.useDatabase || "mysql"

    const databaseConnection = await databasePool.spawnConnectionWithConfiguration(newConfiguration)

    await databaseConnection.connect()

    const sql = databaseConnection.createDatabaseSql(databaseName, {ifNotExists: true})

    if (this.args.testing) {
      return {databaseName, sql}
    }

    await databaseConnection.query(sql)
    await databaseConnection.close()
  }
}
