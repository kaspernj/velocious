import BaseCommand from "../../../../../cli/base-command.js"
import fs from "fs/promises"

export default class DbDestroyMigration extends BaseCommand {
  async execute() {
    const migrationName = this.processArgs[1]
    const migrationDir = `${this.getConfiguration().getDirectory()}/src/database/migrations`
    const migrationFiles = await fs.readdir(migrationDir)
    const destroyed = []

    for (const migrationFile of migrationFiles) {
      const match = migrationFile.match(/^(\d{14})-(.+)\.js$/)

      if (!match) {
        continue
      }

      const fileName = match[2]

      if (fileName != migrationName) continue

      const fullFilePath = `${migrationDir}/${migrationFile}`
      destroyed.push(fileName)

      if (!this.args.testing) {
        console.log(`Destroy src/database/migrations/${migrationFile}`)
        await fs.unlink(fullFilePath)
      }
    }

    if (this.args.testing) {
      return {destroyed}
    }
  }
}
