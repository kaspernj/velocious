import BaseCommand from "../../base-command.mjs"
import {digg} from "diggerize"
import fs from "node:fs/promises"

export default class DbMigrate extends BaseCommand {
  async execute() {
    const projectPath = digg(this.configuration, "directory")
    const migrationsPath = `${projectPath}/src/database/migrations`

    console.log({projectPath, migrationsPath})

    const files = await fs.readdir(migrationsPath)

    console.debug({files, migrationsPath})
    console.warn("stub")
  }
}
