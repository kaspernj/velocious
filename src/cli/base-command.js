import restArgsError from "../utils/rest-args-error.js"

/**
 * @typedef {object} VelociousCliCommandArgs
 * @property {import("../configuration.js").default} [configuration] - Configuration instance for the CLI.
 * @property {Record<string, any>} [parsedProcessArgs] - Parsed CLI arguments.
 * @property {string[]} [processArgs] - Raw CLI arguments array.
 * @property {boolean} [testing] - Whether the CLI is running in test mode.
 */

export default class VelociousCliBaseCommand {
  /**
   * @param {object} args
   * @param {VelociousCliCommandArgs} args.args
   * @param {import("./index.js").default} args.cli
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

  /** @returns {string} - Result.  */
  directory() { return this.getConfiguration().getDirectory() }

  /**
   * @abstract
   * @returns {Promise<any>} - Result.
   */
  execute() {
    throw new Error("execute not implemented")
  }

  /**
   * @returns {import("../configuration.js").default} - Result.
   */
  getConfiguration() { return this._configuration }

  /** @returns {import("../environment-handlers/base.js").default} - Result.  */
  getEnvironmentHandler() { return this._environmentHandler }

  /**
   * @abstract
   * @returns {Promise<void>} - Result.
   */
  async initialize() {
    // Do nothing
  }
}
