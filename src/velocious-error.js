// @ts-check

/** Framework error with optional client-safe message exposure flag. */
export default class VelociousError extends Error {
  /**
   * @param {string} message - Error message.
   * @param {object} [args] - Options.
   * @param {unknown} [args.cause] - Error cause.
   * @param {string} [args.code] - Optional error code.
   * @param {boolean} [args.safeToExpose] - Whether the message is safe to return to clients.
   */
  constructor(message, args = {}) {
    const {cause, code, safeToExpose = false} = args

    super(message, {cause})

    this.name = "VelociousError"
    this.code = code
    this.safeToExpose = safeToExpose
  }

  /**
   * @param {string} message - Error message.
   * @param {object} [args] - Options.
   * @param {unknown} [args.cause] - Error cause.
   * @param {string} [args.code] - Optional error code.
   * @returns {VelociousError} - Client-safe error instance.
   */
  static safe(message, args = {}) {
    return new VelociousError(message, {...args, safeToExpose: true})
  }
}
