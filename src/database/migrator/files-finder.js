import fs from "fs/promises"
import * as inflection from "inflection"

import restArgsError from "../../utils/rest-args-error.js"

export default class VelociousDatabaseMigratorFilesFinder {
  /**
   * @param {Object} args
   * @param {string} args.path
   */
  constructor({path, ...restArgs}) {
    restArgsError(restArgs)

    if (!path) throw new Error("No path given")

    this.path = path
  }

  /**
   * @returns {Promise<Array<{
   *   file: string,
   *   fullPath: string,
   *   date: number,
   *   migrationClassName: string
   * }}
   */
  async findFiles() {
    let files = await fs.readdir(this.path)

    files = files
      .map((file) => {
        const match = file.match(/^(\d{14})-(.+)\.js$/)

        if (!match) return null

        const date = parseInt(match[1])
        const migrationName = match[2]
        const migrationClassName = inflection.camelize(migrationName.replaceAll("-", "_"))

        return {
          file,
          fullPath: `${this.path}/${file}`,
          date,
          migrationClassName
        }
      })
      .filter((migration) => Boolean(migration))
      .sort((migration1, migration2) => migration1.date - migration2.date)

    return files
  }
}
