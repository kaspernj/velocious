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
   * @interface
   * @returns {Promise<CommandFileObjectType[]>}
   */
  async findCommands() { throw new Error("findCommands not implemented") }

  /**
   * @interface
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
      args: command.args
    })

    return await newCommand.execute()
  }

  /**
   * @interface
   * @returns {Promise<string>}
   */
  getVelociousPath() { throw new Error("getVelociousPath not implemented") }

  /**
   * @interface
   * @returns {Promise<import("../routes/index.js").default>}
   */
  async importApplicationRoutes() { throw new Error("importApplicationRoutes not implemented") }

  /**
   * @interface
   * @param {string[]} _testFiles
   * @returns {Promise<void>}
   */
  importTestFiles(_testFiles) { throw new Error("'importTestFiles' not implemented") } // eslint-disable-line no-unused-vars

  /**
   * @interface
   * @returns {Promise<void>}
   */
  importTestingConfigPath() { throw new Error(`'importTestingConfigPath' not implemented`) }

  /**
   * @param {object} args
   * @param {string[]} args.commandParts
   * @returns {Promise<import ("../cli/base-command.js").default>}
   * @interface
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
}
