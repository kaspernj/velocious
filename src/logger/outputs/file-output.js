// @ts-check

/** @typedef {import("../../configuration-types.js").LoggingOutputPayload} LoggingOutputPayload */

/** Logger file output. */
export default class LoggerFileOutput {
  _configuration = undefined
  _filePath = undefined

  /**
   * @param {object} args - Options object.
   * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
   * @param {string} args.filePath - File path.
   */
  constructor({configuration, filePath}) {
    this._configuration = configuration
    this._filePath = filePath
  }

  /** @param {LoggingOutputPayload} payload - Log payload. */
  async write({message}) {
    if (!this._filePath) return

    const configuration = this._configuration

    if (!configuration || typeof configuration.getEnvironmentHandler !== "function") return

    const environmentHandler = configuration.getEnvironmentHandler()

    if (!environmentHandler || typeof environmentHandler.writeLogToFile !== "function") return

    await environmentHandler.writeLogToFile({
      filePath: this._filePath,
      message
    })
  }
}
