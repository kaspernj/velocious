import BaseCommand from "../../../../../../cli/base-command.js"
import fs from "fs/promises"
import path from "path"
import splitSqlStatements from "../../../../../../utils/split-sql-statements.js"

/** Node CLI command for loading DB structure SQL files. */
export default class DbSchemaLoad extends BaseCommand {
  /** @returns {Promise<void>} */
  async execute() {
    await this.getConfiguration().ensureConnections(async (dbs) => {
      const dbDir = path.join(this.directory(), "db")

      for (const identifier of Object.keys(dbs)) {
        const db = dbs[identifier]
        const structureFilePath = path.join(dbDir, `structure-${identifier}.sql`)
        const structureSql = await fs.readFile(structureFilePath, "utf8")

        await this.loadStructureSql({db, structureSql})
      }
    })
  }

  /**
   * @param {object} args - Options object.
   * @param {import("../../../../../../database/drivers/base.js").default} args.db - Database connection.
   * @param {string} args.structureSql - Structure SQL to load.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async loadStructureSql({db, structureSql}) {
    const statements = splitSqlStatements(structureSql)

    if (statements.length == 0) return

    const executableConnection = this.executableConnection(db)

    await db.disableForeignKeys()

    try {
      if (executableConnection) {
        await executableConnection.exec(structureSql)
      } else {
        for (const statement of statements) {
          await db.query(statement)
        }
      }
    } finally {
      await db.enableForeignKeys()
    }
  }

  /**
   * @param {import("../../../../../../database/drivers/base.js").default} db - Database connection.
   * @returns {{exec: (sql: string) => Promise<unknown>} | undefined} - Connection with exec support.
   */
  executableConnection(db) {
    const dbWithConnection = /** @type {import("../../../../../../database/drivers/base.js").default & {connection?: unknown}} */ (db)
    const connection = dbWithConnection.connection

    if (connection && typeof connection == "object" && "exec" in connection && typeof connection.exec == "function") {
      return /** @type {{exec: (sql: string) => Promise<unknown>}} */ (connection)
    }
  }
}
