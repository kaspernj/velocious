import BaseCommand from "../../base-command.mjs"
import {digg} from "diggerize"
import fs from "node:fs/promises"

export default class DbMigrate extends BaseCommand {
  async execute() {
    const projectPath = digg(this.configuration, "directory")
    const migrationsPath = `${projectPath}/src/database/migrations`
    let files = await fs.readdir(migrationsPath)

    files = files
      .map((file) => {
        const match = file.match(/^(\d{14})-/)

        if (!match) return null

        const date = parseInt(match[1])

        return {file, date}
      })
      .filter((file) => Boolean(file))
      .sort((file1, file2) => file1.date - file2.date)

    console.debug({files, migrationsPath})
    console.warn("stub")
  }
}
