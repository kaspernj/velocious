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
   * @returns {Promise<Array<import("./base.js").CommandFileObjectType>>}
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
   * @param {import("../cli/base-command.js").default} command
   * @returns {Promise<void>}
   */
  async cliCommandsInit(command) {
    return await this.forwardCommand(command, CliCommandsInit)
  }

  /**
   * @param {import("../cli/base-command.js").default} command
   * @returns {Promise<any>}
   */
  async cliCommandsMigrationGenerate(command) {
    return await this.forwardCommand(command, CliCommandsGenerateMigration)
  }

  /**
   * @param {import("../cli/base-command.js").default} command
   * @returns {Promise<any>}
   */
  async cliCommandsMigrationDestroy(command) {
    return await this.forwardCommand(command, CliCommandsDestroyMigration)
  }

  /**
   * @param {import("../cli/base-command.js").default} command
   * @returns {Promise<any>}
   */
  async cliCommandsGenerateBaseModels(command) {
    return await this.forwardCommand(command, CliCommandsGenerateBaseModels)
  }

  /**
   * @param {import("../cli/base-command.js").default} command
   * @returns {Promise<any>}
   */
  async cliCommandsGenerateModel(command) {
    return await this.forwardCommand(command, CliCommandsGenerateModel)
  }

  /**
   * @param {import("../cli/base-command.js").default} command
   * @returns {Promise<any>}
   */
  async cliCommandsRoutes(command) {
    return await this.forwardCommand(command, CliCommandsRoutes)
  }

  /**
   * @param {import("../cli/base-command.js").default} command
   * @returns {Promise<any>}
   */
  async cliCommandsServer(command) {
    return await this.forwardCommand(command, CliCommandsServer)
  }

  /**
   * @param {import("../cli/base-command.js").default} command
   * @returns {Promise<any>}
   */
  async cliCommandsTest(command) {
    return await this.forwardCommand(command, CliCommandsTest)
  }

  /**
   * @param {object} args
   * @param {string[]} args.commandParts
   * @returns {Promise<typeof import ("../cli/base-command.js").default>}
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
   * @returns {Promise<Array<import("./base.js").MigrationObjectType>>}
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
   * @returns {Promise<import("../routes/index.js").default>}
   */
  async importApplicationRoutes() {
    const routesImport = await import(`${this.getConfiguration().getDirectory()}/src/config/routes.js`)

    return routesImport.default
  }

  /**
   * @returns {Promise<string>}
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
   * @param {string[]} testFiles
   * @returns {Promise<void>}
   */
  async importTestFiles(testFiles) {
    for (const testFile of testFiles) {
      await import(testFile)
    }
  }

  async importTestingConfigPath() {
    const testingConfigPath = this.getConfiguration().getTesting()

    await import(testingConfigPath)
  }

  /**
   * @param {string} filePath
   * @returns {Promise<import("../database/migration/index.js").default>}
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
}
