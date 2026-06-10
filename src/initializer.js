// @ts-check

import restArgsError from "./utils/rest-args-error.js"

export default class VelociousInitializer {
  /**
 * Runs constructor.
   * @param {object} args - Options object.
   * @param {import("./configuration.js").default} args.configuration - Configuration instance.
   * @param {string} args.type - Type identifier.
   */
  constructor({configuration, type, ...restArgs}) {
    restArgsError(restArgs)

    this._configuration = configuration
    this._type = type
  }

  /**
 * Runs get configuration.
   * @returns {import("./configuration.js").default} - The configuration.
   */
  getConfiguration() { return this._configuration }

  /**
 * Runs get type.
   * @returns {string} - The type.
   */
  getType() { return this._type }

  /**
 * Runs run.
   * @abstract
   * @returns {Promise<void>} - Resolves when complete.
   */
  run() {
    throw new Error(`'run' hasn't been implemented on ${this.constructor.name})`)
  }
}
