// @ts-check

/**
 * @typedef {object} CommandFileObjectType
 * @property {string} name - Command name.
 * @property {string} file - Command file path.
 */

/**
 * @typedef {object} MigrationObjectType
 * @property {number} date - Migration timestamp parsed from filename.
 * @property {string} [fullPath] - Absolute path to the migration file.
 * @property {string} migrationClassName - Exported migration class name.
 * @property {string} file - Migration filename.
 */

export default class VelociousEnvironmentHandlerBase {
  /**
   * @param {number} _offsetMinutes - Offset in minutes (Date#getTimezoneOffset).
   * @param {() => Promise<any>} callback - Callback to run.
   * @returns {Promise<any>} - Result of the callback.
   */
  async runWithTimezoneOffset(_offsetMinutes, callback) {
    if (!this.configuration) throw new Error("Configuration hasn't been set")

    const previousOffsetMinutes = this.configuration._timezoneOffsetMinutes

    this.configuration._timezoneOffsetMinutes = _offsetMinutes

    try {
      return await callback()
    } finally {
      this.configuration._timezoneOffsetMinutes = previousOffsetMinutes
    }
  }

  /**
   * @param {number} _offsetMinutes - Offset in minutes (Date#getTimezoneOffset).
   * @returns {void} - No return value.
   */
  setTimezoneOffset(_offsetMinutes) {
    if (!this.configuration) throw new Error("Configuration hasn't been set")

    this.configuration._timezoneOffsetMinutes = _offsetMinutes
  }

  /**
   * @param {import("../configuration.js").default | undefined} configuration - Configuration instance.
   * @returns {number} - Offset in minutes.
   */
  getTimezoneOffsetMinutes(configuration) {
    const activeConfiguration = configuration || this.configuration

    if (!activeConfiguration) throw new Error("Configuration hasn't been set")

    if (typeof activeConfiguration._timezoneOffsetMinutes === "number") {
      return activeConfiguration._timezoneOffsetMinutes
    }

    return activeConfiguration.getTimezoneOffsetMinutes()
  }

  /**
   * @param {import("../authorization/ability.js").default | undefined} ability - Ability to set for callback scope.
   * @param {() => Promise<any>} callback - Callback.
   * @returns {Promise<any>} - Callback result.
   */
  async runWithAbility(ability, callback) {
    this._currentAbility = ability

    try {
      return await callback()
    } finally {
      this._currentAbility = undefined
    }
  }

  /**
   * @param {import("../authorization/ability.js").default | undefined} ability - Ability to set.
   * @returns {void} - No return value.
   */
  setCurrentAbility(ability) {
    this._currentAbility = ability
  }

  /**
   * @returns {import("../authorization/ability.js").default | undefined} - Current ability.
   */
  getCurrentAbility() {
    return this._currentAbility
  }
  /**
   * @param {import("../cli/base-command.js").default} _command - Command.
   * @returns {Promise<unknown>} - Resolves with the command result.
   */
  async cliCommandsGenerateBaseModels(_command) { // eslint-disable-line no-unused-vars
    throw new Error("cliCommandsGenerateBaseModels not implemented")
  }

  /**
   * @param {import("../cli/base-command.js").default} _command - Command.
   * @returns {Promise<unknown>} - Resolves with the command result.
   */
  async cliCommandsGenerateFrontendModels(_command) { // eslint-disable-line no-unused-vars
    throw new Error("cliCommandsGenerateFrontendModels not implemented")
  }

  /**
   * @param {import("../cli/base-command.js").default} command - Command.
   * @returns {Promise<unknown>} - Resolves with the command result.
   */
  async cliCommandsInit(command) { // eslint-disable-line no-unused-vars
    throw new Error("cliCommandsInit not implemented")
  }

  /**
   * @param {import("../cli/base-command.js").default} _command - Command.
   * @returns {Promise<unknown>} - Resolves with the command result.
   */
  async cliCommandsMigrationGenerate(_command) { // eslint-disable-line no-unused-vars
    throw new Error("cliCommandsMigrationGenerate not implemented")
  }

  /**
   * @param {import("../cli/base-command.js").default} _command - Command.
   * @returns {Promise<unknown>} - Resolves with the command result.
   */
  async cliCommandsMigrationDestroy(_command) { // eslint-disable-line no-unused-vars
    throw new Error("cliCommandsMigrationDestroy not implemented")
  }

  /**
   * @param {import("../cli/base-command.js").default} _command - Command.
   * @returns {Promise<unknown>} - Resolves with the command result.
   */
  async cliCommandsGenerateModel(_command) { // eslint-disable-line no-unused-vars
    throw new Error("cliCommandsGenerateModel not implemented")
  }

  /**
   * @abstract
   * @param {import("../cli/base-command.js").default} _command - Command.
   * @returns {Promise<unknown>} - Resolves with the command result.
   */
  async cliCommandsRoutes(_command) { // eslint-disable-line no-unused-vars
    throw new Error("cliCommandsRoutes not implemented")
  }

  /**
   * @param {import("../cli/base-command.js").default} _command - Command.
   * @returns {Promise<unknown>} - Resolves with the command result.
   */
  async cliCommandsConsole(_command) { // eslint-disable-line no-unused-vars
    throw new Error("cliCommandsConsole not implemented")
  }

  /**
   * @param {import("../cli/base-command.js").default} _command - Command.
   * @returns {Promise<unknown>} - Resolves with the command result.
   */
  async cliCommandsServer(_command) { // eslint-disable-line no-unused-vars
    throw new Error("cliCommandsServer not implemented")
  }

  /**
   * @param {import("../cli/base-command.js").default} _command - Command.
   * @returns {Promise<unknown>} - Resolves with the command result.
   */
  async cliCommandsTest(_command) { // eslint-disable-line no-unused-vars
    throw new Error("cliCommandsTest not implemented")
  }

  /**
   * @param {import("../cli/base-command.js").default} _command - Command.
   * @returns {Promise<unknown>} - Resolves with the command result.
   */
  async cliCommandsBackgroundJobsMain(_command) { // eslint-disable-line no-unused-vars
    throw new Error("cliCommandsBackgroundJobsMain not implemented")
  }

  /**
   * @param {import("../cli/base-command.js").default} _command - Command.
   * @returns {Promise<unknown>} - Resolves with the command result.
   */
  async cliCommandsBackgroundJobsWorker(_command) { // eslint-disable-line no-unused-vars
    throw new Error("cliCommandsBackgroundJobsWorker not implemented")
  }

  /**
   * @param {import("../cli/base-command.js").default} _command - Command.
   * @returns {Promise<unknown>} - Resolves with the command result.
   */
  async cliCommandsBackgroundJobsRunner(_command) { // eslint-disable-line no-unused-vars
    throw new Error("cliCommandsBackgroundJobsRunner not implemented")
  }

  /**
   * @param {import("../cli/base-command.js").default} _command - Command.
   * @returns {Promise<unknown>} - Resolves with the command result.
   */
  async cliCommandsDbSchemaDump(_command) { // eslint-disable-line no-unused-vars
    throw new Error("cliCommandsDbSchemaDump not implemented")
  }

  /**
   * @param {import("../cli/base-command.js").default} _command - Command.
   * @returns {Promise<unknown>} - Resolves with the command result.
   */
  async cliCommandsDbSeed(_command) { // eslint-disable-line no-unused-vars
    throw new Error("cliCommandsDbSeed not implemented")
  }

  /**
   * @param {import("../cli/base-command.js").default} _command - Command.
   * @returns {Promise<unknown>} - Resolves with the command result.
   */
  async cliCommandsRunner(_command) { // eslint-disable-line no-unused-vars
    throw new Error("cliCommandsRunner not implemented")
  }

  /**
   * @abstract
   * @returns {Promise<CommandFileObjectType[]>} - Resolves with the commands.
   */
  async findCommands() { throw new Error("findCommands not implemented") }

  /**
   * @abstract
   * @returns {Promise<Array<MigrationObjectType>>} - Resolves with the migrations.
   */
  async findMigrations() { throw new Error("findMigrations not implemneted") }

  /**
   * @param {import("../cli/base-command.js").default} command - Command.
   * @param {typeof import("../cli/base-command.js").default} CommandClass - Command class.
   * @returns {Promise<unknown>} - Resolves with the command result.
   */
  async forwardCommand(command, CommandClass) {
    const newCommand = new CommandClass({
      args: command.args,
      cli: command.cli
    })

    return await newCommand.execute()
  }

  /**
   * @abstract
   * @returns {Promise<string>} - Resolves with the velocious path.
   */
  getVelociousPath() { throw new Error("getVelociousPath not implemented") }

  /**
   * @abstract
   * @returns {Promise<import("../routes/index.js").default>} - Resolves with the import application routes.
   */
  async importApplicationRoutes() { throw new Error("importApplicationRoutes not implemented") }

  /**
   * @abstract
   * @param {string[]} _testFiles - Test files.
   * @returns {Promise<void>} - Resolves when complete.
   */
  importTestFiles(_testFiles) { throw new Error("'importTestFiles' not implemented") } // eslint-disable-line no-unused-vars

  /**
   * @abstract
   * @returns {Promise<void>} - Resolves when complete.
   */
  importTestingConfigPath() { throw new Error(`'importTestingConfigPath' not implemented`) }

  /**
   * @param {object} args - Options object.
   * @param {Record<string, import("../database/drivers/base.js").default>} args.dbs - Dbs.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async afterMigrations(args) { // eslint-disable-line no-unused-vars
    return
  }

  /**
   * @abstract
   * @param {object} args - Options object.
   * @param {string[]} args.commandParts - Command parts.
   * @returns {Promise<typeof import ("../cli/base-command.js").default>} - Resolves with the require command.
   */
  async requireCommand({commandParts}) { throw new Error("'requireCommand' not implemented") } // eslint-disable-line no-unused-vars

  /**
   * @param {object} newArgs - New args.
   * @returns {void} - No return value.
   */
  setArgs(newArgs) { this.args = newArgs }

  /**
   * @param {import("../configuration.js").default} newConfiguration - New configuration.
   * @returns {void} - No return value.
   */
  setConfiguration(newConfiguration) { this.configuration = newConfiguration }

  /**
   * @returns {import("../configuration.js").default} - The configuration.
   */
  getConfiguration() {
    if (!this.configuration) throw new Error("Configuration hasn't been set")

    return this.configuration
  }

  /**
   * @param {string[]} newProcessArgs - New process args.
   * @returns {void} - No return value.
   */
  setProcessArgs(newProcessArgs) { this.processArgs = newProcessArgs }

  /**
   * @param {object} _args - Options object.
   * @param {import("../configuration.js").default} _args.configuration - Configuration instance.
   * @returns {string | undefined} - The default log directory.
   */
  getDefaultLogDirectory(_args) { // eslint-disable-line no-unused-vars
    return undefined
  }

  /**
   * @param {object} _args - Options object.
   * @param {import("../configuration.js").default} _args.configuration - Configuration instance.
   * @param {string | undefined} _args.directory - Directory path.
   * @param {string} _args.environment - Environment.
   * @returns {string | undefined} - The log file path.
   */
  getLogFilePath(_args) { // eslint-disable-line no-unused-vars
    return undefined
  }

  /**
   * @param {object} _args - Options object.
   * @param {string} _args.filePath - File path.
   * @param {string} _args.message - Message text.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async writeLogToFile(_args) { // eslint-disable-line no-unused-vars
    return
  }
}
