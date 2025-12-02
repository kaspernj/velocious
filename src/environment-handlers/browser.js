import Base from "./base.js"
import {digg} from "diggerize"
import * as inflection from "inflection"
import restArgsError from "../utils/rest-args-error.js"

export default class VelociousEnvironmentsHandlerBrowser extends Base {
  /**
   * @param {object} args
   * @param {function() : void} args.migrationsRequireContextCallback
   */
  constructor({migrationsRequireContextCallback, ...restArgs} = {}) {
    super()
    restArgsError(restArgs)

    this.migrationsRequireContextCallback = migrationsRequireContextCallback
  }

  async cliCommandsMigrationGenerate(_command) { // eslint-disable-line no-unused-vars
    throw new Error("Unsupported on browser")
  }

  async cliCommandsMigrationDestroy(_command) { // eslint-disable-line no-unused-vars
    throw new Error("Unsupported on browser")
  }

  async cliCommandsModelGenerate(_command) { // eslint-disable-line no-unused-vars
    throw new Error("Unsupported on browser")
  }

  /**
   * @returns {object}
   */
  migrationsRequireContext() {
    const migrationsRequireContextCallback = digg(this, "migrationsRequireContextCallback")

    if (!migrationsRequireContextCallback) throw new Error("migrationsRequireContextCallback is required")

    this._migrationsRequireContextResult ||= migrationsRequireContextCallback()

    return this._migrationsRequireContextResult
  }

  /**
   * @returns {Promise<Array<{name: string, file: string}>>}
   */
  findCommands() {
    this._findCommandsResult = this._actualFindCommands()

    return this._findCommandsResult
  }

  _findCommandsRequireContext() {
    this.findCommandsRequireContextResult ||= require.context("../cli/commands", true, /\.js$/)

    return this.findCommandsRequireContextResult
  }

  _actualFindCommands() {
    const commandFiles = this._findCommandsRequireContext()
    const commands = []

    for (const aFilePath of commandFiles.keys()) {
      const aFilePathParts = aFilePath.split("/")
      const lastPart = aFilePathParts[aFilePathParts.length - 1]
      let name

      if (lastPart == "index.js") {
        name = aFilePathParts[aFilePathParts.length - 2]
      } else {
        name = lastPart.replace(".js", "")
      }

      commands.push({name, file: aFilePath})
    }

    return commands
  }

  /**
   * @param {Array<string>} commandParts
   * @template T extends import("./base-command.js").default
   * @returns {Promise<T>}
   */
  async requireCommand({commandParts, ...restArgs}) {
    restArgsError(restArgs)

    let filePath = "."

    for (let commandPart of commandParts) {
      if (commandPart == "d") commandPart = "destroy"
      if (commandPart == "g") commandPart = "generate"
      if (commandPart == "s") commandPart = "server"

      filePath += `/${commandPart}`
    }

    const filePaths = []

    filePaths.push(`${filePath}/index.js`)
    filePath += ".js"
    filePaths.push(filePath)

    const commandsRequireContext = await this._findCommandsRequireContext()
    let commandClassImport

    for (const aFilePath of filePaths) {
      commandClassImport = commandsRequireContext(aFilePath)

      if (commandClassImport) {
        break
      }
    }

    if (!commandClassImport) {
      throw new Error(`Unknown command: ${commandParts.join(":")}. Possible commands: ${commandsRequireContext.keys()}`)
    }

    const CommandClass = commandClassImport.default

    return CommandClass
  }

  /**
   * @returns {Promise<Array<{name: string, file: string}>>}
   */
  async findMigrations() {
    const migrationsRequireContext = await this.migrationsRequireContext()
    const files = migrationsRequireContext
      .keys()
      .map((file) => {
        // "13,14" because somes "require-context"-npm-module deletes first character!?
        const match = file.match(/(\d{13,14})-(.+)\.js$/)

        if (!match) return null

        // Fix require-context-npm-module deletes first character
        let fileName = file
        let dateNumber = match[1]

        if (dateNumber.length == 13) {
          dateNumber = `2${dateNumber}`
          fileName = `2${fileName}`
        }

        // Parse regex
        const date = parseInt(dateNumber)
        const migrationName = match[2]
        const migrationClassName = inflection.camelize(migrationName.replaceAll("-", "_"))

        return {
          file: fileName,
          fullPath: file,
          date,
          migrationClassName
        }
      })
      .filter((migration) => Boolean(migration))
      .sort((migration1, migration2) => migration1.date - migration2.date)

    return files
  }

  /**
   * @param {string} filePath
   * @template T extends import("../migration/index.js").default
   * @returns {Promise<T>}
   */
  requireMigration = async (filePath) => {
    if (!filePath) throw new Error("filePath is required")

    const migrationsRequireContext = await this.migrationsRequireContext()
    const migrationImport = migrationsRequireContext(filePath)

    if (!migrationImport) throw new Error(`Migration file ${filePath} not found`)

    const migrationImportDefault = migrationImport.default

    if (!migrationImportDefault) throw new Error("Migration file must export a default migration class")
    if (typeof migrationImportDefault !== "function") throw new Error("Migration default export isn't a function (should be a class which is a function in JS)")

    return migrationImportDefault
  }
}
