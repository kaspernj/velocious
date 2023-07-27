import BaseCommand from "../../base-command.mjs"
import {digg} from "diggerize"
import fs from "node:fs/promises"

export default class DbMigrate extends BaseCommand {
  async execute() {
    const projectPath = digg(this.configuration, "directory")
    const migrationsPath = `${projectPath}/src/database/migrations`
    const files = await fs.readdir(migrationsPath)

    console.log({files, migrationsPath})

    throw new Error("stub")
  }
}
