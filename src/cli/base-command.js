import restArgsError from "../utils/rest-args-error.js"

export default class VelociousCliBaseCommand {
  /**
   * @param {object} args
   * @param {object} args.args
   * @param {import("./index.js").default} args.cli
   */
  constructor({args = {}, cli, ...restArgs}) {
    restArgsError(restArgs)

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

  /**
   * @template T extends import("../environment-handlers/base.js").default
   * @returns {T}
   */
  getEnvironmentHandler() { return this._environmentHandler }

  /**
   * @abstract
   * @returns {Promise<void>}
   */
  async initialize() {
    // Do nothing
  }
}
