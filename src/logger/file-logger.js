// @ts-check

import BaseLogger from "./base-logger.js"
import LoggerFileOutput from "./outputs/file-output.js"

/** File logger configuration wrapper. */
export default class FileLogger extends BaseLogger {
  /**
   * @param {object} args - Options object.
   * @param {string} args.path - File path to write to.
   * @param {Array<"debug-low-level" | "debug" | "info" | "warn" | "error">} [args.levels] - Levels to emit.
   */
  constructor({path, levels}) {
    super()
    this.path = path
    this.levels = levels
  }

  /**
   * @param {object} args - Options object.
   * @param {import("../configuration.js").default | undefined} [args.configuration] - Configuration instance.
   * @returns {import("../configuration-types.js").LoggingOutputConfig} - Output config.
   */
  toOutputConfig({configuration} = {}) {
    return {
      output: new LoggerFileOutput({
        configuration,
        getConfiguration: () => configuration,
        filePath: this.path
      }),
      levels: this.levels
    }
  }
}
