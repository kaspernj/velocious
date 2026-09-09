// @ts-check

/** Stable framework error for a database pool checkout that exceeded its wait limit. */
export default class DatabasePoolCheckoutTimeoutError extends Error {
  /**
   * Builds a database pool checkout timeout error.
   * @param {string} message - Detailed sanitized pool timeout message.
   * @param {{cause?: unknown}} [args] - Error options.
   */
  constructor(message, {cause} = {}) {
    super(message, cause === undefined ? undefined : {cause})

    this.name = "DatabasePoolCheckoutTimeoutError"
    this.code = "VELOCIOUS_DATABASE_POOL_CHECKOUT_TIMEOUT"
  }
}
