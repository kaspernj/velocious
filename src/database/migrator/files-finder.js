import fs from "node:fs/promises"
import * as inflection from "inflection"

import restArgsError from "../../utils/rest-args-error.js"

export default class VelociousDatabaseMigratorFilesFinder {
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

  }
}
