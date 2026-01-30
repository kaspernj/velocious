// @ts-check

/** @typedef {import("../../configuration-types.js").LoggingOutputPayload} LoggingOutputPayload */

/** Logger console output. */
export default class LoggerConsoleOutput {
  /** @param {LoggingOutputPayload} payload - Log payload. */
  async write({level, message}) {
    if (level === "error") {
      console.error(message)
      return
    }

    if (level === "warn") {
      console.warn(message)
      return
    }

    if (level === "debug" || level === "debug-low-level") {
      const debugLogger = typeof console.debug === "function" ? console.debug : console.log
      debugLogger(message)
      return
    }

    console.log(message)
  }
}
