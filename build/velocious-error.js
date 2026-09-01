// @ts-check

/** Framework error with optional client-safe message exposure flag. */
export default class VelociousError extends Error {
  /**
   * Runs constructor.
   * @param {string} message - Error message.
   * @param {object} [args] - Options.
   * @param {ReturnType<typeof JSON.parse>} [args.cause] - Error cause.
   * @param {string} [args.code] - Optional error code.
   * @param {import("./configuration-types.js").ClientErrorPayloadReporterPayload} [args.details] - Structured client-safe error details.
   * @param {"application_error" | "authorization_error" | "record_not_found" | "validation_error"} [args.errorType] - Stable client-facing error category.
   * @param {boolean} [args.safeToExpose] - Whether the message is safe to return to clients.
   */
  constructor(message, args = {}) {
    const {cause, code, details, errorType, safeToExpose = false} = args

    super(message, {cause})

    this.name = "VelociousError"
    this.code = code
    this.details = details
    this.errorType = errorType
    this.safeToExpose = safeToExpose
  }

  /**
   * Runs safe.
   * @param {string} message - Error message.
   * @param {object} [args] - Options.
   * @param {ReturnType<typeof JSON.parse>} [args.cause] - Error cause.
   * @param {string} [args.code] - Optional error code.
   * @param {import("./configuration-types.js").ClientErrorPayloadReporterPayload} [args.details] - Structured client-safe error details.
   * @param {"application_error" | "authorization_error" | "record_not_found" | "validation_error"} [args.errorType] - Stable client-facing error category.
   * @returns {VelociousError} - Client-safe error instance.
   */
  static safe(message, args = {}) {
    return new VelociousError(message, {...args, safeToExpose: true})
  }
}
