import restArgsError from "../utils/rest-args-error.js"

/**
 * VelociousCliCommandArgs type.
 * @typedef {object} VelociousCliCommandArgs
 * @property {import("../configuration.js").default} [configuration] - Configuration instance for the CLI.
 * @property {Record<string, string | number | boolean | undefined>} [parsedProcessArgs] - Parsed CLI arguments.
 * @property {string[]} [processArgs] - Raw CLI arguments array.
 * @property {boolean} [testing] - Whether the CLI is running in test mode.
 */

export default class VelociousCliBaseCommand {
  /**
   * Runs constructor.
   * @param {object} args - Options object.
   * @param {VelociousCliCommandArgs} args.args - Options object.
   * @param {import("./index.js").default} args.cli - Cli.
   */
  constructor({args = {}, cli, ...restArgs}) {
    restArgsError(restArgs)

    if (!args.configuration) throw new Error("configuration argument is required")

    this.args = args
    this.cli = cli
    this._configuration = args.configuration
    this._environmentHandler = args.configuration.getEnvironmentHandler()
    this.processArgs = args.processArgs
  }

  /**
   * Runs directory.
   * @returns {string} - The directory.
   */
  directory() { return this.getConfiguration().getDirectory() }

  /**
   * Runs execute.
   * @abstract
   * @returns {Promise<?>} - Resolves with the execute.
   */
  execute() {
    throw new Error("execute not implemented")
  }

  /**
   * Runs get configuration.
   * @returns {import("../configuration.js").default} - The configuration.
   */
  getConfiguration() { return this._configuration }

  /**
   * Runs get environment handler.
   * @returns {import("../environment-handlers/base.js").default} - The environment handler.
   */
  getEnvironmentHandler() { return this._environmentHandler }

  /**
   * Runs initialize.
   * @abstract
   * @returns {Promise<void>} - Resolves when complete.
   */
  async initialize() {
    // Do nothing
  }
}

