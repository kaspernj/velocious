import BaseCommand from "../../../../../../cli/base-command.js"
import commandArguments from "../../../../../../cli/command-arguments.js"
import DatabaseGenerationContext from "../../../../../../database/generation-context.js"
import fileExists from "../../../../../../utils/file-exists.js"
import path from "path"

/** Node CLI command for dumping DB structure SQL files. */
export default class DbSchemaDump extends BaseCommand {
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

      await context.run({name: "DB selected tenant schema dump", callback: async (db) => {
        const dbs = {[context.databaseIdentifier()]: db}
        const shouldGenerate = await this.shouldGenerateStructureSql({dbs})

        if (!shouldGenerate) return

        await this.getEnvironmentHandler().afterMigrations({dbs, reason: "schemaDump"})
      }})
      return
    }

    await this.getConfiguration().ensureConnections({name: "DB schema dump"}, async (dbs) => {
      const shouldGenerate = await this.shouldGenerateStructureSql({dbs})

      if (!shouldGenerate) return

      await this.getEnvironmentHandler().afterMigrations({dbs, reason: "schemaDump"})
    })
  }

  /**
   * Runs should generate structure sql.
   * @param {object} args - Options object.
   * @param {Record<string, import("../../../../../../database/drivers/base.js").default>} args.dbs - Active DB connections by identifier.
   * @returns {Promise<boolean>} - Whether structure SQL should be generated.
   */
  async shouldGenerateStructureSql({dbs}) {
    if (!this.getConfiguration().shouldWriteStructureSql({reason: "schemaDump"})) return false

    const dbDir = path.join(this.directory(), "db")

    for (const identifier of Object.keys(dbs)) {
      const db = dbs[identifier]

      if (typeof db.structureSql !== "function") continue

      const structureFilePath = path.join(dbDir, `structure-${identifier}.sql`)

      if (!await fileExists(structureFilePath)) return true
    }

    return false
  }
}
