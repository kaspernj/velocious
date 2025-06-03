import BaseCommand from "../../base-command.mjs"
import {dirname} from "path"
import {fileURLToPath} from "url"
import fileExists from "../../../utils/file-exists.mjs"
import fs from "node:fs/promises"
import * as inflection from "inflection"
import strftime from "strftime"

export default class DbGenerateMigration extends BaseCommand {
  async execute() {
    const migrationName = this.processArgs[1]
    const migrationNameCamelized = inflection.camelize(migrationName.replaceAll("-", "_"))
    const date = new Date()
    const migrationNumber = strftime("%Y%m%d%H%M%S")
    const migrationFileName = `${migrationNumber}-${migrationName}.mjs`
    const __filename = fileURLToPath(`${import.meta.url}/../../..`)
    const __dirname = dirname(__filename)
    const templateFilePath = `${__dirname}/templates/generate-migration.mjs`
    const migrationContentBuffer = await fs.readFile(templateFilePath)
    const migrationContent = migrationContentBuffer.toString().replaceAll("__MIGRATION_NAME__", migrationNameCamelized)
    const migrationDir = `${process.cwd()}/src/database/migrations`
    const migrationPath = `${migrationDir}/${migrationFileName}`

    if (this.args.testing) {
      return {date, migrationContent, migrationName, migrationNameCamelized, migrationNumber, migrationPath}
    } else {
      if (!await fileExists(migrationDir)) {
        await fs.mkdir(migrationDir, {recursive: true})
      }

      await fs.writeFile(migrationPath, migrationContent)

      console.log(`create src/database/migrations/${migrationFileName}`)
    }
  }
}
