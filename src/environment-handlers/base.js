// @ts-check

/**
 * @typedef {object} CommandFileObjectType
 * @property {string} name
 * @property {string} file
 */

/**
 * @typedef {object} MigrationObjectType
 * @property {number} date
 * @property {string} [fullPath]
 * @property {string} migrationClassName
 * @property {string} file
 */

export default class VelociousEnvironmentHandlerBase {
  /**
   * @param {import("../cli/base-command.js").default} _command
   * @returns {Promise<void>}
   */
  async cliCommandsGenerateBaseModels(_command) { // eslint-disable-line no-unused-vars
    throw new Error("cliCommandsGenerateBaseModels not implemented")
  }

  /**
   * @param {import("../cli/base-command.js").default} command
   * @returns {Promise<void>}
   */
  async cliCommandsInit(command) { // eslint-disable-line no-unused-vars
    throw new Error("cliCommandsInit not implemented")
  }

  /**
   * @param {import("../cli/base-command.js").default} _command
   * @returns {Promise<void>}
   */
  async cliCommandsMigrationGenerate(_command) { // eslint-disable-line no-unused-vars
    throw new Error("cliCommandsMigrationGenerate not implemented")
  }

  /**
   * @param {import("../cli/base-command.js").default} _command
   * @returns {Promise<void>}
   */
  async cliCommandsMigrationDestroy(_command) { // eslint-disable-line no-unused-vars
    throw new Error("cliCommandsMigrationDestroy not implemented")
  }

  /**
   * @param {import("../cli/base-command.js").default} _command
   * @returns {Promise<void>}
   */
  async cliCommandsGenerateModel(_command) { // eslint-disable-line no-unused-vars
    throw new Error("cliCommandsGenerateModel not implemented")
  }

  /**
   * @abstract
   * @param {import("../cli/base-command.js").default} _command
   * @returns {Promise<void>}
   */
  async cliCommandsRoutes(_command) { // eslint-disable-line no-unused-vars
    throw new Error("cliCommandsRoutes not implemented")
  }

  /**
   * @param {import("../cli/base-command.js").default} _command
   * @returns {Promise<void>}
   */
  async cliCommandsServer(_command) { // eslint-disable-line no-unused-vars
    throw new Error("cliCommandsServer not implemented")
  }

  /**
   * @param {import("../cli/base-command.js").default} _command
   * @returns {Promise<void>}
   */
  async cliCommandsTest(_command) { // eslint-disable-line no-unused-vars
    throw new Error("cliCommandsTest not implemented")
  }

  /**
   * @abstract
   * @returns {Promise<CommandFileObjectType[]>}
   */
  async findCommands() { throw new Error("findCommands not implemented") }

  /**
   * @abstract
   * @returns {Promise<Array<MigrationObjectType>>}
   */
  async findMigrations() { throw new Error("findMigrations not implemneted") }

  /**
   * @param {import("../cli/base-command.js").default} command
   * @param {typeof import("../cli/base-command.js").default} CommandClass
   * @returns {Promise<any>}
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
   * @returns {Promise<string>}
   */
  getVelociousPath() { throw new Error("getVelociousPath not implemented") }

  /**
   * @abstract
   * @returns {Promise<import("../routes/index.js").default>}
   */
  async importApplicationRoutes() { throw new Error("importApplicationRoutes not implemented") }

  /**
   * @abstract
   * @param {string[]} _testFiles
   * @returns {Promise<void>}
   */
  importTestFiles(_testFiles) { throw new Error("'importTestFiles' not implemented") } // eslint-disable-line no-unused-vars

  /**
   * @abstract
   * @returns {Promise<void>}
   */
  importTestingConfigPath() { throw new Error(`'importTestingConfigPath' not implemented`) }

  /**
   * @param {object} args
   * @param {Record<string, import("../database/drivers/base.js").default>} args.dbs
   * @returns {Promise<void>}
   */
  async afterMigrations(args) { // eslint-disable-line no-unused-vars
    return
  }

  /**
   * @abstract
   * @param {object} args
   * @param {string[]} args.commandParts
   * @returns {Promise<typeof import ("../cli/base-command.js").default>}
   */
  async requireCommand({commandParts}) { throw new Error("'requireCommand' not implemented") } // eslint-disable-line no-unused-vars

  /**
   * @param {object} newArgs
   * @returns {void}
   */
  setArgs(newArgs) { this.args = newArgs }

  /**
   * @param {import("../configuration.js").default} newConfiguration
   * @returns {void}
   */
  setConfiguration(newConfiguration) { this.configuration = newConfiguration }

  /**
   * @returns {import("../configuration.js").default}
   */
  getConfiguration() {
    if (!this.configuration) throw new Error("Configuration hasn't been set")

    return this.configuration
  }

  /**
   * @param {string[]} newProcessArgs
   * @returns {void}
   */
  setProcessArgs(newProcessArgs) { this.processArgs = newProcessArgs }

  /**
   * @param {object} _args
   * @param {import("../configuration.js").default} _args.configuration
   * @returns {string | undefined}
   */
  getDefaultLogDirectory(_args) { // eslint-disable-line no-unused-vars
    return undefined
  }

  /**
   * @param {object} _args
   * @param {import("../configuration.js").default} _args.configuration
   * @param {string | undefined} _args.directory
   * @param {string} _args.environment
   * @returns {string | undefined}
   */
  getLogFilePath(_args) { // eslint-disable-line no-unused-vars
    return undefined
  }

  /**
   * @param {object} _args
   * @param {string} _args.filePath
   * @param {string} _args.message
   * @returns {Promise<void>}
   */
  async writeLogToFile(_args) { // eslint-disable-line no-unused-vars
    return
  }
}
