import restArgsError from "../utils/rest-args-error.js"

/**
 * @typedef {object} VelociousCliCommandArgs
 * @property {import("../configuration.js").default} [configuration] - Configuration instance for the CLI.
 * @property {Record<string, string | number | boolean | undefined>} [parsedProcessArgs] - Parsed CLI arguments.
 * @property {string[]} [processArgs] - Raw CLI arguments array.
 * @property {boolean} [testing] - Whether the CLI is running in test mode.
 */

export default class VelociousCliBaseCommand {
  /**
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

  /** @returns {string} - The directory.  */
  directory() { return this.getConfiguration().getDirectory() }

  /**
   * @abstract
   * @returns {Promise<any>} - Resolves with the execute.
   */
  execute() {
    throw new Error("execute not implemented")
  }

  /**
   * @returns {import("../configuration.js").default} - The configuration.
   */
  getConfiguration() { return this._configuration }

  /** @returns {import("../environment-handlers/base.js").default} - The environment handler.  */
  getEnvironmentHandler() { return this._environmentHandler }

  /**
   * @abstract
   * @returns {Promise<void>} - Resolves when complete.
   */
  async initialize() {
    // Do nothing
  }
}

