import Base from "./base.js"
import * as inflection from "inflection"
import restArgsError from "../utils/rest-args-error.js"
import {Logger} from "../logger.js"

/**
 * @typedef {(id: string) => {default: typeof import("../database/migration/index.js").default}} MigrationsRequireContextIDFunctionType
 * @typedef {MigrationsRequireContextIDFunctionType & {
 *   keys: () => string[],
 *   id: string
 * }} MigrationsRequireContextType
 */

/**
 * @typedef {(id: string) => {default: typeof import("../cli/base-command.js").default}} CommandsRequireContextIDFunctionType
 * @typedef {CommandsRequireContextIDFunctionType & {
 *   keys: () => string[],
 *   id: string
 * }} CommandsRequireContextType
 */

export default class VelociousEnvironmentsHandlerBrowser extends Base {
  /** @type {CommandsRequireContextType | undefined} */
  findCommandsRequireContextResult = undefined

  /** @type {MigrationsRequireContextType | undefined} */
  _migrationsRequireContextResult = undefined

  /**
   * @param {object} args - Options object.
   * @param {() => Promise<MigrationsRequireContextType>} [args.migrationsRequireContextCallback] - Migrations require context callback.
   */
  constructor({migrationsRequireContextCallback, ...restArgs} = {}) {
    super()
    restArgsError(restArgs)

    this.migrationsRequireContextCallback = migrationsRequireContextCallback
    this.logger = new Logger(this)
  }

  /**
   * @returns {Promise<MigrationsRequireContextType>} - Resolves with the migrations require context.
   */
  async migrationsRequireContext() {
    const {migrationsRequireContextCallback} = this

    if (!migrationsRequireContextCallback) throw new Error("migrationsRequireContextCallback is required")

    this._migrationsRequireContextResult ||= await migrationsRequireContextCallback()

    return this._migrationsRequireContextResult
  }

  /**
   * @returns {Promise<Array<import("./base.js").CommandFileObjectType>>} - Resolves with the commands.
   */
  async findCommands() {
    this._findCommandsResult = this._actualFindCommands()

    return this._findCommandsResult
  }

  /**
   * @returns {CommandsRequireContextType} - The commands require context.
   */
  _findCommandsRequireContext() {
    // @ts-expect-error
    this.findCommandsRequireContextResult ||= /** @type {CommandsRequireContextType} */ (require.context("../cli/commands", true, /\.js$/))

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
   * @param {object} args - Options object.
   * @param {Array<string>} args.commandParts - Command parts.
   * @returns {Promise<typeof import("../cli/base-command.js").default>} - Resolves with the require command.
   */
  async requireCommand({commandParts}) {
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
   * @returns {Promise<Array<import("./base.js").MigrationObjectType>>} - Resolves with the migrations.
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
   * @param {string} filePath - File path.
   * @returns {Promise<typeof import("../database/migration/index.js").default>} - Resolves with the require migration.
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

  /**
   * @param {object} args - Options object.
   * @param {Record<string, import("../database/drivers/base.js").default>} args.dbs - Dbs.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async afterMigrations({dbs}) {
    const structureSql = await this._sqliteStructureSql({dbs})

    if (!structureSql) return

    await this.logger.debug(() => ["structure.sql:", structureSql])
  }

  /**
   * @param {object} args - Options object.
   * @param {Record<string, import("../database/drivers/base.js").default>} args.dbs - Dbs.
   * @returns {Promise<string | null>} - Resolves with SQL string.
   */
  async _sqliteStructureSql({dbs}) {
    const sqliteIdentifiers = Object.keys(dbs)
      .filter((identifier) => this.getConfiguration().getDatabaseType(identifier) == "sqlite")

    if (sqliteIdentifiers.length == 0) return null

    const sections = []

    for (const identifier of sqliteIdentifiers) {
      const db = dbs[identifier]
      const structureSql = typeof db.structureSql === "function" ? await db.structureSql() : null
      const trimmedSql = structureSql?.trimEnd()

      if (!trimmedSql) continue

      if (sqliteIdentifiers.length > 1) {
        sections.push(`-- ${identifier}`)
      }

      sections.push(trimmedSql)
    }

    if (sections.length == 0) return null

    return `${sections.join("\n\n")}\n`
  }
}
