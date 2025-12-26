// @ts-check

import Base from "./base.js"
import CliCommandsDestroyMigration from "./node/cli/commands/destroy/migration.js"
import CliCommandsInit from "./node/cli/commands/init.js"
import CliCommandsGenerateBaseModels from "./node/cli/commands/generate/base-models.js"
import CliCommandsGenerateMigration from "./node/cli/commands/generate/migration.js"
import CliCommandsGenerateModel from "./node/cli/commands/generate/model.js"
import CliCommandsRoutes from "./node/cli/commands/routes.js"
import CliCommandsServer from "./node/cli/commands/server.js"
import CliCommandsTest from "./node/cli/commands/test.js"
import {dirname} from "path"
import {fileURLToPath} from "url"
import fs from "fs/promises"
import * as inflection from "inflection"
import path from "path"

export default class VelociousEnvironmentHandlerNode extends Base{
  /** @type {import("./base.js").CommandFileObjectType[] | undefined} */
  _findCommandsResult = undefined

  /**
   * @returns {Promise<Array<import("./base.js").CommandFileObjectType>>} - Resolves with the commands.
   */
  async findCommands() {
    this._findCommandsResult ||= await this._actualFindCommands()

    if (!this._findCommandsResult) throw new Error("Could not get commands")

    return this._findCommandsResult
  }

  async _actualFindCommands() {
    const basePath = await this.getBasePath()
    const commandFiles = fs.glob(`${basePath}/src/cli/commands/**/*.js`)
    const commands = []

    for await (const aFilePath of commandFiles) {
      const aFilePathParts = aFilePath.split("/")
      const commandPathLocation = aFilePathParts.indexOf("commands") + 1
      const lastPart = aFilePathParts[aFilePathParts.length - 1]
      let name, paths

      if (lastPart == "index.js") {
        name = aFilePathParts[aFilePathParts.length - 2]
        paths = aFilePathParts.slice(commandPathLocation, -2)
      } else {
        name = lastPart.replace(".js", "")
        paths = aFilePathParts.slice(commandPathLocation, -1)
      }

      const commandName = `${paths.join(":")}${paths.length > 0 ? ":" : ""}${name}`

      commands.push({name: commandName, file: aFilePath})
    }

    return commands
  }

  /**
   * @param {import("../cli/base-command.js").default} command - Command.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async cliCommandsInit(command) {
    return await this.forwardCommand(command, CliCommandsInit)
  }

  /**
   * @param {import("../cli/base-command.js").default} command - Command.
   * @returns {Promise<any>} - Resolves with the cli commands migration generate.
   */
  async cliCommandsMigrationGenerate(command) {
    return await this.forwardCommand(command, CliCommandsGenerateMigration)
  }

  /**
   * @param {import("../cli/base-command.js").default} command - Command.
   * @returns {Promise<any>} - Resolves with the cli commands migration destroy.
   */
  async cliCommandsMigrationDestroy(command) {
    return await this.forwardCommand(command, CliCommandsDestroyMigration)
  }

  /**
   * @param {import("../cli/base-command.js").default} command - Command.
   * @returns {Promise<any>} - Resolves with the cli commands generate base models.
   */
  async cliCommandsGenerateBaseModels(command) {
    return await this.forwardCommand(command, CliCommandsGenerateBaseModels)
  }

  /**
   * @param {import("../cli/base-command.js").default} command - Command.
   * @returns {Promise<any>} - Resolves with the cli commands generate model.
   */
  async cliCommandsGenerateModel(command) {
    return await this.forwardCommand(command, CliCommandsGenerateModel)
  }

  /**
   * @param {import("../cli/base-command.js").default} command - Command.
   * @returns {Promise<any>} - Resolves with the cli commands routes.
   */
  async cliCommandsRoutes(command) {
    return await this.forwardCommand(command, CliCommandsRoutes)
  }

  /**
   * @param {import("../cli/base-command.js").default} command - Command.
   * @returns {Promise<any>} - Resolves with the cli commands server.
   */
  async cliCommandsServer(command) {
    return await this.forwardCommand(command, CliCommandsServer)
  }

  /**
   * @param {import("../cli/base-command.js").default} command - Command.
   * @returns {Promise<any>} - Resolves with the cli commands test.
   */
  async cliCommandsTest(command) {
    return await this.forwardCommand(command, CliCommandsTest)
  }

  /**
   * @param {object} args - Options object.
   * @param {string[]} args.commandParts - Command parts.
   * @returns {Promise<typeof import ("../cli/base-command.js").default>} - Resolves with the require command.
   */
  async requireCommand({commandParts}) {
    const commands = await this.findCommands()
    const command = commands.find((aCommand) => aCommand.name === commandParts.join(":"))

    if (!command) {
      const possibleCommands = commands.map(aCommand => aCommand.name)

      throw new Error(`Unknown command: ${commandParts.join(":")} which should have been one of: ${possibleCommands.sort().join(", ")}`)
    }

    const commandClassImport = await import(command.file)
    const CommandClass = commandClassImport.default

    return CommandClass
  }

  /**
   * @returns {Promise<Array<import("./base.js").MigrationObjectType>>} - Resolves with the migrations.
   */
  async findMigrations() {
    const migrationsPath = `${this.getConfiguration().getDirectory()}/src/database/migrations`
    const glob = await fs.glob(`${migrationsPath}/**/*.js`)
    let files = []

    for await (const fullPath of glob) {
      const file = await path.basename(fullPath)

      const match = file.match(/^(\d{14})-(.+)\.js$/)

      if (!match) continue

      const date = parseInt(match[1])
      const migrationName = match[2]
      const migrationClassName = inflection.camelize(migrationName.replaceAll("-", "_"))

      files.push({
        file,
        fullPath: `${migrationsPath}/${file}`,
        date,
        migrationClassName
      })
    }

    files = files.sort((migration1, migration2) => migration1.date - migration2.date)

    return files
  }

  /**
   * @returns {Promise<import("../routes/index.js").default>} - Resolves with the import application routes.
   */
  async importApplicationRoutes() {
    const routesImport = await import(`${this.getConfiguration().getDirectory()}/src/config/routes.js`)

    return routesImport.default
  }

  /**
   * @returns {Promise<string>} - Resolves with the velocious path.
   */
  async getVelociousPath() {
    if (!this._velociousPath) {
      const __filename = fileURLToPath(import.meta.url)
      const __dirname = dirname(__filename)

      this._velociousPath = await fs.realpath(`${__dirname}/../..`)
    }

    return this._velociousPath
  }

  /**
   * @param {string[]} testFiles - Test files.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async importTestFiles(testFiles) {
    for (const testFile of testFiles) {
      await import(testFile)
    }
  }

  /**
   * @param {object} args - Options object.
   * @param {import("../configuration.js").default} args.configuration - Configuration instance.
   * @returns {string} - The default log directory.
   */
  getDefaultLogDirectory({configuration}) {
    return path.join(configuration.getDirectory(), "log")
  }

  /**
   * @param {object} args - Options object.
   * @param {import("../configuration.js").default} args.configuration - Configuration instance.
   * @param {string | undefined} args.directory - Directory path.
   * @param {string} args.environment - Environment.
   * @returns {string | undefined} - The log file path.
   */
  getLogFilePath({configuration, directory, environment}) {
    const actualDirectory = directory || configuration?.getDirectory?.()

    if (!actualDirectory) return undefined

    return path.join(actualDirectory, `${environment}.log`)
  }

  /**
   * @param {object} args - Options object.
   * @param {string} args.filePath - File path.
   * @param {string} args.message - Message text.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async writeLogToFile({filePath, message}) {
    await fs.mkdir(path.dirname(filePath), {recursive: true})
    await fs.appendFile(filePath, `${message}\n`, "utf8")
  }

  async importTestingConfigPath() {
    const testingConfigPath = this.getConfiguration().getTesting()

    await import(testingConfigPath)
  }

  /**
   * @param {string} filePath - File path.
   * @returns {Promise<import("../database/migration/index.js").default>} - Resolves with the require migration.
   */
  async requireMigration(filePath) {
    const migrationImport = await import(filePath)
    const migrationImportDefault = migrationImport.default

    if (!migrationImportDefault) throw new Error("Migration file must export a default migration class")
    if (typeof migrationImportDefault !== "function") throw new Error("Migration default export isn't a function (should be a class which is a function in JS)")

    return migrationImportDefault
  }

  async getBasePath() {
    const __filename = fileURLToPath(import.meta.url)
    const basePath = await fs.realpath(`${dirname(__filename)}/../..`)

    return basePath
  }

  /**
   * @param {object} args - Options object.
   * @param {Record<string, import("../database/drivers/base.js").default>} args.dbs - Dbs.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async afterMigrations({dbs}) {
    const dbDir = path.join(this.getConfiguration().getDirectory(), "db")
    const structureSqlByIdentifier = await this._structureSqlByIdentifier({dbs})

    await fs.mkdir(dbDir, {recursive: true})

    for (const identifier of Object.keys(structureSqlByIdentifier)) {
      const structureSql = structureSqlByIdentifier[identifier]

      if (!structureSql) continue

      const filePath = path.join(dbDir, `structure-${identifier}.sql`)

      await fs.writeFile(filePath, structureSql)
    }
  }

  /**
   * @param {object} args - Options object.
   * @param {Record<string, import("../database/drivers/base.js").default>} args.dbs - Dbs.
   * @returns {Promise<Record<string, string>>} - Resolves with SQL string.
   */
  async _structureSqlByIdentifier({dbs}) {
    const sqlByIdentifier = /** @type {Record<string, string>} */ ({})

    for (const identifier of Object.keys(dbs)) {
      const db = dbs[identifier]

      if (typeof db.structureSql !== "function") continue

      const structureSql = await db.structureSql()

      if (structureSql) {
        sqlByIdentifier[identifier] = structureSql
      }
    }

    return sqlByIdentifier
  }
}
