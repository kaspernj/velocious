import BaseCommand from "../../../../../../cli/base-command.js"
import commandArguments from "../../../../../../cli/command-arguments.js"
import DatabaseGenerationContext from "../../../../../../database/generation-context.js"
import fs from "fs/promises"
import path from "path"
import StructureSqlLoader from "../../../../../../database/structure-sql-loader.js"

/** Node CLI command for loading DB structure SQL files. */
export default class DbSchemaLoad extends BaseCommand {
  /**
   * Runs execute.
   * @returns {Promise<void>} */
  async execute() {
    const parsedArguments = commandArguments({
      definition: {valueOptions: ["--tenant"]},
      processArgs: this.processArgs || []
    })
    const tenantDatabaseIdentifier = parsedArguments.tenant

    if (typeof tenantDatabaseIdentifier === "string") {
      const context = await DatabaseGenerationContext.resolve({
        configuration: this.getConfiguration(),
        databaseIdentifier: tenantDatabaseIdentifier
      })

      await context.run({name: "DB selected tenant schema load", callback: async (db) => {
        await this.loadStructureSql({db, identifier: context.databaseIdentifier()})
      }})
      return
    }

    await this.getConfiguration().ensureConnections({name: "DB schema load"}, async (dbs) => {
      for (const identifier of Object.keys(dbs)) {
        await this.loadStructureSql({db: dbs[identifier], identifier})
      }
    })
  }

  /**
   * Loads one identifier's explicit structure file into one selected connection.
   * @param {object} args - Load arguments.
   * @param {import("../../../../../../database/drivers/base.js").default} args.db - Target connection.
   * @param {string} args.identifier - Logical database identifier used in the file name.
   * @returns {Promise<void>} - Resolves after loading.
   */
  async loadStructureSql({db, identifier}) {
    const dbDir = path.join(this.directory(), "db")
    const loader = new StructureSqlLoader()
    const structureFilePath = path.join(dbDir, `structure-${identifier}.sql`)
    const structureSql = await fs.readFile(structureFilePath, "utf8")

    await loader.load({db, structureSql})
  }
}
