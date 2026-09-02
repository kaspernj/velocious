// @ts-check

import restArgsError from "./utils/rest-args-error.js"

export default class VelociousInitializer {
  /**
   * Runs constructor.
   * @param {object} args - Options object.
   * @param {import("./configuration.js").default} args.configuration - Configuration instance.
   * @param {import("./configuration-types.js").ApplicationProcessContext} [args.processContext] - Framework-owned application process context.
   * @param {string} args.type - Type identifier.
   */
  constructor({configuration, processContext, type, ...restArgs}) {
    restArgsError(restArgs)

    this._configuration = configuration
    this._processContext = processContext
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
   * Gets the immutable context for this application process lifecycle.
   * @returns {import("./configuration-types.js").ApplicationProcessContext} - Shared process context.
   */
  getProcessContext() {
    if (!this._processContext) throw new Error("Application process context is only available to framework-run initializers")

    return this._processContext
  }

  /**
   * Runs run.
   * @abstract
   * @returns {Promise<void>} - Resolves when complete.
   */
  run() {
    throw new Error(`'run' hasn't been implemented on ${this.constructor.name})`)
  }

  /**
   * Tears down application-owned process resources.
   * @returns {Promise<void>} - Resolves after optional application cleanup.
   */
  async teardown() {}
}
