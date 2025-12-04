export default class VelociousEnvironmentHandlerBase {
  /**
   * @param {import("../cli/base-command.js").default} _command
   * @returns {Promise<void>}
   */
  async cliCommandsGenerateBaseModels(_command) { // eslint-disable-line no-unused-vars
    throw new Error("cliCommandsGenerateBaseModels not implemented")
  }

  /**
   * @param {import("../cli/base-command.js").default} _command
   * @returns {Promise<void>}
   */
  async cliCommandsInit(_command) { // eslint-disable-line no-unused-vars
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
   */
  async findCommands() { throw new Error("findCommands not implemented") }

  /**
   * @interface
   */
  async findMigrations() { throw new Error("findMigrations not implemneted") }

  /**
   * @template T extends import("../cli/base-command.js").default
   * @param {T} command
   * @param {typeof T} CommandClass
   * @returns {any}
   */
  async forwardCommand(command, CommandClass) {
    const newCommand = new CommandClass({
      args: command.args
    })

    return await newCommand.execute()
  }

  /**
   * @interface
   */
  async getVelociousPath() { throw new Error("getVelociousPath not implemented") }

  /**
   * @interface
   */
  async importApplicationRoutes() { throw new Error("importApplicationRoutes not implemented") }

  /**
   * @param {object} args
   * @param {string[]} args.commandParts
   * @interface
   */
  async requireCommand({commandParts}) { throw new Error("requireCommand not implemented") } // eslint-disable-line no-unused-vars

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
