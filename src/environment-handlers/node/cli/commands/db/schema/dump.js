import BaseCommand from "../../../../../../cli/base-command.js"
import fileExists from "../../../../../../utils/file-exists.js"
import path from "path"

/** Node CLI command for dumping DB structure SQL files. */
export default class DbSchemaDump extends BaseCommand {
  /** @returns {Promise<void>} */
  async execute() {
    await this.getConfiguration().ensureConnections(async (dbs) => {
      const shouldGenerate = await this.shouldGenerateStructureSql({dbs})

      if (!shouldGenerate) return

      await this.getEnvironmentHandler().afterMigrations({dbs})
    })
  }

  /**
   * @param {object} args - Options object.
   * @param {Record<string, import("../../../../../../database/drivers/base.js").default>} args.dbs - Active DB connections by identifier.
   * @returns {Promise<boolean>} - Whether structure SQL should be generated.
   */
  async shouldGenerateStructureSql({dbs}) {
    if (!this.getConfiguration().shouldWriteStructureSql()) return false

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
