import restArgsError from "../utils/rest-args-error.js"

/**
 * @typedef {object} VelociousCliCommandArgs
 * @property {import("../configuration.js").default} [configuration]
 * @property {Record<string, any>} [parsedProcessArgs]
 * @property {string[]} [processArgs]
 * @property {boolean} [testing]
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

  /** @returns {string} */
  directory() { return this.getConfiguration().getDirectory() }

  /**
   * @abstract
   * @returns {Promise<any>}
   */
  execute() {
    throw new Error("execute not implemented")
  }

  /**
   * @returns {import("../configuration.js").default}
   */
  getConfiguration() { return this._configuration }

  /** @returns {import("../environment-handlers/base.js").default} */
  getEnvironmentHandler() { return this._environmentHandler }

  /**
   * @abstract
   * @returns {Promise<void>}
   */
  async initialize() {
    // Do nothing
  }
}
