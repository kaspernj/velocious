// @ts-check

import BaseLogger from "./base-logger.js"
import LoggerConsoleOutput from "./outputs/console-output.js"

/** Console logger configuration wrapper. */
export default class ConsoleLogger extends BaseLogger {
  /**
   * @param {object} [args] - Options object.
   * @param {Array<"debug-low-level" | "debug" | "info" | "warn" | "error">} [args.levels] - Levels to emit.
   */
  constructor({levels} = {}) {
    super()
    this.levels = levels
  }

  /**
   * @returns {import("../configuration-types.js").LoggingOutputConfig} - Output config.
   */
  toOutputConfig() {
    return {
      output: new LoggerConsoleOutput(),
      levels: this.levels
    }
  }
}
