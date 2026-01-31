// @ts-check

/**
 * Base logger interface for custom logger implementations.
 */
export default class BaseLogger {
  /**
   * Convert the logger into an output config.
   * @param {object} args - Options object.
   * @param {import("../configuration.js").default | undefined} [args.configuration] - Configuration instance.
   * @returns {import("../configuration-types.js").LoggingOutputConfig} - Output config.
   */
  toOutputConfig(args) {
    void args
    if (typeof this.write !== "function") {
      throw new Error("BaseLogger#write must be implemented")
    }

    return {
      output: this,
      levels: /** @type {any} */ (this).levels
    }
  }

  /**
   * Write a log payload.
   * @param {import("../configuration-types.js").LoggingOutputPayload} payload - Log payload.
   * @returns {Promise<void> | void} - Resolves when complete.
   */
  write(payload) {
    void payload
    throw new Error("BaseLogger#write must be implemented")
  }
}
