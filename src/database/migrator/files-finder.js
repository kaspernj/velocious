// @ts-check

import fs from "fs/promises"
import * as inflection from "inflection"

import restArgsError from "../../utils/rest-args-error.js"

export default class VelociousDatabaseMigratorFilesFinder {
  /**
   * @param {object} args - Options object.
   * @param {string} args.path - Path.
   */
  constructor({path, ...restArgs}) {
    restArgsError(restArgs)

    if (!path) throw new Error("No path given")

    this.path = path
  }

  /**
   * @returns {Promise<Array<import("./types.js").MigrationObjectType>>} - Resolves with the files.
   */
  async findFiles() {
    let files = await fs.readdir(this.path)

    /** @type {import("./types.js").MigrationObjectType[]} */
    let result = []

    for (const file of files) {
      const match = file.match(/^(\d{14})-(.+)\.js$/)

      if (!match) continue

      const date = parseInt(match[1])
      const migrationName = match[2]
      const migrationClassName = inflection.camelize(migrationName.replaceAll("-", "_"))

      result.push({
        file,
        fullPath: `${this.path}/${file}`,
        date,
        migrationClassName
      })
    }

    result = result.sort((migration1, migration2) => migration1.date - migration2.date)

    return result
  }
}
