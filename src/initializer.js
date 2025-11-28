import restArgsError from "./utils/rest-args-error.js"

export default class VelociousInitializer {
  /**
   * @param {Object} args
   * @param {import("./configuration.js").default} args.configuration
   * @param {string} args.type
   */
  constructor({configuration, type, ...restArgs}) {
    restArgsError(restArgs)

    this._configuration = configuration
    this._type = type
  }

  /**
   * @returns {import("./configuration.js").default}
   */
  getConfiguration() { return this._configuration }

  /**
   * @returns {string}
   */
  getType() { return this._type }

  run() {
    throw new Error(`'run' hasn't been implemented on ${this.constructor.name})`)
  }
}
