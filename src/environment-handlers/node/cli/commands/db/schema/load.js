import BaseCommand from "../../../../../../cli/base-command.js"
import fs from "fs/promises"
import path from "path"
import StructureSqlLoader from "../../../../../../database/structure-sql-loader.js"

/** Node CLI command for loading DB structure SQL files. */
export default class DbSchemaLoad extends BaseCommand {
  /**
   * Runs execute.
   * @returns {Promise<void>} */
  async execute() {
    await this.getConfiguration().ensureConnections({name: "DB schema load"}, async (dbs) => {
      const dbDir = path.join(this.directory(), "db")
      const loader = new StructureSqlLoader()

      for (const identifier of Object.keys(dbs)) {
        const db = dbs[identifier]
        const structureFilePath = path.join(dbDir, `structure-${identifier}.sql`)
        const structureSql = await fs.readFile(structureFilePath, "utf8")

        await loader.load({db, structureSql})
      }
    })
  }
}
