// @ts-check

/**
 * LoggingOutputPayload type.
 * @typedef {import("../../configuration-types.js").LoggingOutputPayload} LoggingOutputPayload */

/** Logger array output. */
export default class LoggerArrayOutput {
  _limit = 2000
  /**
 * Levels.
 * @type {import("../../configuration-types.js").LogLevel[]} */
  levels = ["debug", "info", "warn", "error"]
  /**
 * Logs.
 * @type {LoggingOutputPayload[]} */
  _logs = []

  /**
 * Runs constructor.
   * @param {object} [args] - Options object.
   * @param {number} [args.limit] - Max number of log entries to keep.
   */
  constructor({limit = 2000} = {}) {
    const normalizedLimit = typeof limit === "number" && Number.isFinite(limit) ? limit : 2000
    this._limit = normalizedLimit
  }

  /**
 * Runs write.
 * @param {LoggingOutputPayload} payload - Log payload. */
  async write({level, message, subject, timestamp}) {
    if (this._limit <= 0) return

    this._logs.push({level, message, subject, timestamp})

    if (this._logs.length > this._limit) {
      this._logs.splice(0, this._logs.length - this._limit)
    }
  }

  /**
 * Runs get logs.
 * @returns {LoggingOutputPayload[]} - Stored log entries. */
  getLogs() {
    return this._logs.slice()
  }
}
