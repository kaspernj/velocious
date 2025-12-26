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
   * @param {import("../cli/base-command.js").default} _command - Command.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async cliCommandsGenerateBaseModels(_command) { // eslint-disable-line no-unused-vars
    throw new Error("cliCommandsGenerateBaseModels not implemented")
  }

  /**
   * @param {import("../cli/base-command.js").default} command - Command.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async cliCommandsInit(command) { // eslint-disable-line no-unused-vars
    throw new Error("cliCommandsInit not implemented")
  }

  /**
   * @param {import("../cli/base-command.js").default} _command - Command.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async cliCommandsMigrationGenerate(_command) { // eslint-disable-line no-unused-vars
    throw new Error("cliCommandsMigrationGenerate not implemented")
  }

  /**
   * @param {import("../cli/base-command.js").default} _command - Command.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async cliCommandsMigrationDestroy(_command) { // eslint-disable-line no-unused-vars
    throw new Error("cliCommandsMigrationDestroy not implemented")
  }

  /**
   * @param {import("../cli/base-command.js").default} _command - Command.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async cliCommandsGenerateModel(_command) { // eslint-disable-line no-unused-vars
    throw new Error("cliCommandsGenerateModel not implemented")
  }

  /**
   * @abstract
   * @param {import("../cli/base-command.js").default} _command - Command.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async cliCommandsRoutes(_command) { // eslint-disable-line no-unused-vars
    throw new Error("cliCommandsRoutes not implemented")
  }

  /**
   * @param {import("../cli/base-command.js").default} _command - Command.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async cliCommandsServer(_command) { // eslint-disable-line no-unused-vars
    throw new Error("cliCommandsServer not implemented")
  }

  /**
   * @param {import("../cli/base-command.js").default} _command - Command.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async cliCommandsTest(_command) { // eslint-disable-line no-unused-vars
    throw new Error("cliCommandsTest not implemented")
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
