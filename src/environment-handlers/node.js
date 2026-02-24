// @ts-check

import Base from "./base.js"
import CliCommandsDestroyMigration from "./node/cli/commands/destroy/migration.js"
import CliCommandsInit from "./node/cli/commands/init.js"
import CliCommandsGenerateBaseModels from "./node/cli/commands/generate/base-models.js"
import CliCommandsGenerateFrontendModels from "./node/cli/commands/generate/frontend-models.js"
import CliCommandsGenerateMigration from "./node/cli/commands/generate/migration.js"
import CliCommandsGenerateModel from "./node/cli/commands/generate/model.js"
import CliCommandsRoutes from "./node/cli/commands/routes.js"
import CliCommandsServer from "./node/cli/commands/server.js"
import CliCommandsTest from "./node/cli/commands/test.js"
import CliCommandsBackgroundJobsMain from "./node/cli/commands/background-jobs-main.js"
import CliCommandsBackgroundJobsWorker from "./node/cli/commands/background-jobs-worker.js"
import CliCommandsBackgroundJobsRunner from "./node/cli/commands/background-jobs-runner.js"
import CliCommandsConsole from "./node/cli/commands/console.js"
import CliCommandsDbSchemaDump from "./node/cli/commands/db/schema/dump.js"
import CliCommandsDbSeed from "./node/cli/commands/db/seed.js"
import CliCommandsRunner from "./node/cli/commands/runner.js"
import CliCommandsRunScript from "./node/cli/commands/run-script.js"
import {dirname} from "path"
import {fileURLToPath} from "url"
import fs from "fs/promises"
import * as inflection from "inflection"
import path from "path"
import {AsyncLocalStorage as NodeAsyncLocalStorage} from "node:async_hooks"
import toImportSpecifier from "../utils/to-import-specifier.js"

/** @typedef {{ability?: import("../authorization/ability.js").default, offsetMinutes: number}} TimezoneStore */

export default class VelociousEnvironmentHandlerNode extends Base{
  /** @type {import("node:async_hooks").AsyncLocalStorage<TimezoneStore> | undefined} */
  _timezoneAsyncLocalStorage = NodeAsyncLocalStorage ? new NodeAsyncLocalStorage() : undefined

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

  /**
   * @param {number} offsetMinutes - Offset in minutes (Date#getTimezoneOffset).
   * @param {() => Promise<any>} callback - Callback to run.
   * @returns {Promise<any>} - Result of the callback.
   */
  async runWithTimezoneOffset(offsetMinutes, callback) {
    if (!this._timezoneAsyncLocalStorage) {
      return await callback()
    }

    const existingStore = this._timezoneAsyncLocalStorage.getStore()

    return await this._timezoneAsyncLocalStorage.run({
      ability: existingStore?.ability,
      offsetMinutes
    }, callback)
  }

  /**
   * @param {number} offsetMinutes - Offset in minutes (Date#getTimezoneOffset).
   * @returns {void} - No return value.
   */
  setTimezoneOffset(offsetMinutes) {
    if (!this._timezoneAsyncLocalStorage) return

    const store = this._timezoneAsyncLocalStorage.getStore()

    if (store) {
      store.offsetMinutes = offsetMinutes
    } else {
      const existingStore = this._timezoneAsyncLocalStorage.getStore()

      this._timezoneAsyncLocalStorage.enterWith({
        ability: existingStore?.ability,
        offsetMinutes
      })
    }
  }

  /**
   * @param {import("../configuration.js").default | undefined} configuration - Configuration instance.
   * @returns {number} - Offset in minutes.
   */
  getTimezoneOffsetMinutes(configuration) {
    if (this._timezoneAsyncLocalStorage) {
      const store = this._timezoneAsyncLocalStorage.getStore()

      if (store && typeof store.offsetMinutes === "number") {
        return store.offsetMinutes
      }
    }

    return super.getTimezoneOffsetMinutes(configuration)
  }

  /**
   * @param {import("../authorization/ability.js").default | undefined} ability - Ability to set for callback scope.
   * @param {() => Promise<any>} callback - Callback.
   * @returns {Promise<any>} - Callback result.
   */
  async runWithAbility(ability, callback) {
    if (!this._timezoneAsyncLocalStorage) {
      return await super.runWithAbility(ability, callback)
    }

    const existingStore = this._timezoneAsyncLocalStorage.getStore()

    return await this._timezoneAsyncLocalStorage.run({
      ability,
      offsetMinutes: existingStore?.offsetMinutes ?? this.getTimezoneOffsetMinutes(this.getConfiguration())
    }, callback)
  }

  /**
   * @param {import("../authorization/ability.js").default | undefined} ability - Ability to set.
   * @returns {void} - No return value.
   */
  setCurrentAbility(ability) {
    if (!this._timezoneAsyncLocalStorage) {
      super.setCurrentAbility(ability)
      return
    }

    const existingStore = this._timezoneAsyncLocalStorage.getStore()

    if (existingStore) {
      existingStore.ability = ability
    } else {
      this._timezoneAsyncLocalStorage.enterWith({
        ability,
        offsetMinutes: this.getTimezoneOffsetMinutes(this.getConfiguration())
      })
    }
  }

  /**
   * @returns {import("../authorization/ability.js").default | undefined} - Current ability.
   */
  getCurrentAbility() {
    if (!this._timezoneAsyncLocalStorage) {
      return super.getCurrentAbility()
    }

    return this._timezoneAsyncLocalStorage.getStore()?.ability
  }

  /**
   * @returns {Promise<Array<import("./base.js").CommandFileObjectType>>} - Resolves with discovered command files.
   */
  async _actualFindCommands() {
    const basePath = await this.getBasePath()
    const commandFiles = fs.glob(`${basePath}/src/cli/commands/**/*.js`)
    const commands = []

    for await (const aFilePath of commandFiles) {
      const commandName = this.commandNameFromFilePath(aFilePath)

      commands.push({name: commandName, file: aFilePath})
    }

    return commands
  }

  /**
   * @param {string} filePath - Full command file path.
   * @returns {string} - Parsed command name.
   */
  commandNameFromFilePath(filePath) {
    const aFilePathParts = filePath.split(/[\\/]/)
    const commandPathLocation = aFilePathParts.indexOf("commands")

    if (commandPathLocation === -1) {
      throw new Error(`Could not parse command file path: ${filePath}`)
    }

    const commandParts = aFilePathParts.slice(commandPathLocation + 1)
    const lastPart = commandParts[commandParts.length - 1]
    let name, paths

    if (lastPart == "index.js") {
      name = commandParts[commandParts.length - 2]
      paths = commandParts.slice(0, -2)
    } else {
      name = lastPart.replace(".js", "")
      paths = commandParts.slice(0, -1)
    }

    return `${paths.join(":")}${paths.length > 0 ? ":" : ""}${name}`
  }

  /**
   * @param {import("../cli/base-command.js").default} command - Command.
   * @returns {Promise<unknown>} - Resolves with the command result.
   */
  async cliCommandsInit(command) {
    return await this.forwardCommand(command, CliCommandsInit)
  }

  /**
   * @param {import("../cli/base-command.js").default} command - Command.
   * @returns {Promise<unknown>} - Resolves with the command result.
   */
  async cliCommandsMigrationGenerate(command) {
    return await this.forwardCommand(command, CliCommandsGenerateMigration)
  }

  /**
   * @param {import("../cli/base-command.js").default} command - Command.
   * @returns {Promise<unknown>} - Resolves with the command result.
   */
  async cliCommandsMigrationDestroy(command) {
    return await this.forwardCommand(command, CliCommandsDestroyMigration)
  }

  /**
   * @param {import("../cli/base-command.js").default} command - Command.
   * @returns {Promise<unknown>} - Resolves with the command result.
   */
  async cliCommandsGenerateBaseModels(command) {
    return await this.forwardCommand(command, CliCommandsGenerateBaseModels)
  }

  /**
   * @param {import("../cli/base-command.js").default} command - Command.
   * @returns {Promise<unknown>} - Resolves with the command result.
   */
  async cliCommandsGenerateFrontendModels(command) {
    return await this.forwardCommand(command, CliCommandsGenerateFrontendModels)
  }

  /**
   * @param {import("../cli/base-command.js").default} command - Command.
   * @returns {Promise<unknown>} - Resolves with the command result.
   */
  async cliCommandsGenerateModel(command) {
    return await this.forwardCommand(command, CliCommandsGenerateModel)
  }

  /**
   * @param {import("../cli/base-command.js").default} command - Command.
   * @returns {Promise<unknown>} - Resolves with the command result.
   */
  async cliCommandsRoutes(command) {
    return await this.forwardCommand(command, CliCommandsRoutes)
  }

  /**
   * @param {import("../cli/base-command.js").default} command - Command.
   * @returns {Promise<unknown>} - Resolves with the command result.
   */
  async cliCommandsConsole(command) {
    return await this.forwardCommand(command, CliCommandsConsole)
  }

  /**
   * @param {import("../cli/base-command.js").default} command - Command.
   * @returns {Promise<unknown>} - Resolves with the command result.
   */
  async cliCommandsServer(command) {
    return await this.forwardCommand(command, CliCommandsServer)
  }

  /**
   * @param {import("../cli/base-command.js").default} command - Command.
   * @returns {Promise<unknown>} - Resolves with the command result.
   */
  async cliCommandsTest(command) {
    return await this.forwardCommand(command, CliCommandsTest)
  }

  /**
   * @param {import("../cli/base-command.js").default} command - Command.
   * @returns {Promise<unknown>} - Resolves with the command result.
   */
  async cliCommandsBackgroundJobsMain(command) {
    return await this.forwardCommand(command, CliCommandsBackgroundJobsMain)
  }

  /**
   * @param {import("../cli/base-command.js").default} command - Command.
   * @returns {Promise<unknown>} - Resolves with the command result.
   */
  async cliCommandsBackgroundJobsWorker(command) {
    return await this.forwardCommand(command, CliCommandsBackgroundJobsWorker)
  }

  /**
   * @param {import("../cli/base-command.js").default} command - Command.
   * @returns {Promise<unknown>} - Resolves with the command result.
   */
  async cliCommandsBackgroundJobsRunner(command) {
    return await this.forwardCommand(command, CliCommandsBackgroundJobsRunner)
  }

  /**
   * @param {import("../cli/base-command.js").default} command - Command.
   * @returns {Promise<unknown>} - Resolves with the command result.
   */
  async cliCommandsDbSchemaDump(command) {
    return await this.forwardCommand(command, CliCommandsDbSchemaDump)
  }

  /**
   * @param {import("../cli/base-command.js").default} command - Command.
   * @returns {Promise<unknown>} - Resolves with the command result.
   */
  async cliCommandsDbSeed(command) {
    return await this.forwardCommand(command, CliCommandsDbSeed)
  }

  /**
   * @param {import("../cli/base-command.js").default} command - Command.
   * @returns {Promise<unknown>} - Resolves with the command result.
   */
  async cliCommandsRunner(command) {
    return await this.forwardCommand(command, CliCommandsRunner)
  }

  /**
   * @param {import("../cli/base-command.js").default} command - Command.
   * @returns {Promise<unknown>} - Resolves with the command result.
   */
  async cliCommandsRunScript(command) {
    return await this.forwardCommand(command, CliCommandsRunScript)
  }

  /**
   * @param {object} args - Options object.
   * @param {string[]} args.commandParts - Command parts.
   * @returns {Promise<typeof import ("../cli/base-command.js").default>} - Resolves with the require command.
   */
  async requireCommand({commandParts}) {
    const commands = await this.findCommands()
    const commandName = commandParts.join(":")
    const command = commands.find((aCommand) => aCommand.name === commandName)

    if (!command) {
      const possibleCommands = commands.map(aCommand => aCommand.name)

      throw new Error(`Unknown command: ${commandParts.join(":")} which should have been one of: ${possibleCommands.sort().join(", ")}`)
    }

    const commandClassImport = await import(toImportSpecifier(command.file))
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
    const routesImport = await import(toImportSpecifier(`${this.getConfiguration().getDirectory()}/src/config/routes.js`))

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
      await import(toImportSpecifier(testFile))
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

    if (!testingConfigPath) return

    const testingImport = await import(toImportSpecifier(testingConfigPath))
    const testingDefault = testingImport.default

    if (!testingDefault) throw new Error("Testing config must export a default function")
    if (typeof testingDefault !== "function") throw new Error("Testing config default export isn't a function")

    const result = await testingDefault()

    if (typeof result === "function") {
      await result()
    }
  }

  /**
   * @param {string} filePath - File path.
   * @returns {Promise<import("../database/migration/index.js").default>} - Resolves with the require migration.
   */
  async requireMigration(filePath) {
    const migrationImport = await import(toImportSpecifier(filePath))
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
    const configuration = this.getConfiguration()

    if (!configuration.shouldWriteStructureSql()) return

    const dbDir = path.join(configuration.getDirectory(), "db")
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
