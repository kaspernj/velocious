// @ts-check

/** @typedef {import("../../configuration-types.js").LoggingOutputPayload} LoggingOutputPayload */

/** Logger file output. */
export default class LoggerFileOutput {
  /** @type {import("../../configuration.js").default | undefined} */
  _configuration = undefined
  /** @type {string | undefined} */
  _filePath = undefined
  /** @type {(() => import("../../configuration.js").default | undefined) | undefined} */
  _getConfiguration = undefined

  /**
   * @param {object} args - Options object.
   * @param {import("../../configuration.js").default} [args.configuration] - Configuration instance.
   * @param {() => import("../../configuration.js").default | undefined} [args.getConfiguration] - Configuration resolver.
   * @param {string} args.filePath - File path.
   */
  constructor({configuration, getConfiguration, filePath}) {
    this._configuration = configuration
    this._getConfiguration = getConfiguration
    this._filePath = filePath
  }

  /** @param {LoggingOutputPayload} payload - Log payload. */
  async write({message}) {
    if (!this._filePath) return

    const configuration = this._configuration || this._getConfiguration?.()

    if (!configuration || typeof configuration.getEnvironmentHandler !== "function") return

    const environmentHandler = configuration.getEnvironmentHandler()

    if (!environmentHandler || typeof environmentHandler.writeLogToFile !== "function") return

    await environmentHandler.writeLogToFile({
      filePath: this._filePath,
      message
    })
  }
}
