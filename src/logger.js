// @ts-check

import Configuration from "./configuration.js"
import restArgsError from "./utils/rest-args-error.js"

/** @typedef {"debug-low-level" | "debug" | "info" | "warn" | "error"} LogLevel */

const DEFAULT_LOGGING_CONFIGURATION = {
  console: true,
  file: false,
  /** @type {LogLevel[]} */
  levels: ["info", "warn", "error"]
}

const LEVEL_ORDER = ["debug-low-level", "debug", "info", "warn", "error"]

/**
 * @param {string} message - Message text.
 * @returns {Promise<void>} - Resolves when complete.
 */
function consoleLog(message) {
  return new Promise((resolve) => {
    if (process.stdout) {
      process.stdout.write(`${message}\n`, "utf8", () => resolve())
    } else {
      console.log(message)
      resolve()
    }
  })
}

/**
 * @param {string} message - Message text.
 * @returns {Promise<void>} - Resolves when complete.
 */
function consoleError(message) {
  return new Promise((resolve) => {
    if (process.stderr) {
      process.stderr.write(`${message}\n`, "utf8", () => resolve())
    } else {
      console.error(message)
      resolve()
    }
  })
}

/**
 * @param {string} message - Message text.
 * @returns {Promise<void>} - Resolves when complete.
 */
function consoleWarn(message) {
  return new Promise((resolve) => {
    if (process.stderr) {
      process.stderr.write(`${message}\n`, "utf8", () => resolve())
    } else {
      console.warn(message)
      resolve()
    }
  })
}

/**
 * @param {...any|function() : Array<any>} messages - Messages.
 * @returns {Array<any>} - Either the function result or the messages
 */
function functionOrMessages(...messages) {
  if (messages.length === 1 && typeof messages[0] == "function") {
    const result = messages[0]()
    messages = Array.isArray(result) ? result : [result]
  }

  return messages
}

/**
 * Converts multiple message parts into a single string.
 * @param {...any} messages - Parts to combine into a message
 * @returns {string} - The messages to message.
 */
function messagesToMessage(...messages) {
  let message = ""

  for (const messagePartIndex in messages) {
    const messagePart = messages[messagePartIndex]

    if (Number(messagePartIndex) > 0) {
      message += " "
    }

    if (typeof messagePart == "object") {
      message += JSON.stringify(messagePart)
    } else {
      message += messagePart
    }
  }

  return message
}

/**
 * @param {import("./configuration.js").default | undefined} configuration - Configuration instance.
 * @returns {Required<Pick<import("./configuration-types.js").LoggingConfiguration, "console" | "file" | "levels">> & Partial<Pick<import("./configuration-types.js").LoggingConfiguration, "filePath">>} - The logging configuration.
 */
/**
 * @param {import("./configuration.js").default | undefined} configuration - Configuration instance.
 * @returns {Required<Pick<import("./configuration-types.js").LoggingConfiguration, "console" | "file" | "levels">> & Partial<Pick<import("./configuration-types.js").LoggingConfiguration, "filePath">>} - The logging configuration.
 */
function resolveLoggingConfiguration(configuration) {
  if (configuration && typeof configuration.getLoggingConfiguration === "function") {
    return configuration.getLoggingConfiguration()
  }

  return DEFAULT_LOGGING_CONFIGURATION
}

/**
 * @param {object} args - Options object.
 * @param {LogLevel} args.level - Level.
 * @param {Required<Pick<import("./configuration-types.js").LoggingConfiguration, "console" | "file" | "levels">> & Partial<Pick<import("./configuration-types.js").LoggingConfiguration, "filePath">>} args.loggingConfiguration - Logging configuration.
 * @param {boolean} [args.debugFlag] - Whether debug flag.
 * @returns {boolean} - Whether level allowed.
 */
function isLevelAllowed({level, loggingConfiguration, debugFlag}) {
  const allowedLevels = loggingConfiguration.levels || DEFAULT_LOGGING_CONFIGURATION.levels

  if (allowedLevels.includes(level)) return true

  if (debugFlag && LEVEL_ORDER.indexOf(level) >= LEVEL_ORDER.indexOf("debug")) return true

  return false
}

class Logger {
  /**
   * @param {string | object} object - Object.
   * @param {object} args - Options object.
   * @param {import("./configuration.js").default} [args.configuration] - Configuration instance.
   * @param {boolean} [args.debug] - Whether debug.
   * @param {import("./configuration-types.js").LoggingConfiguration} [args.loggingConfiguration] - Logging configuration.
   */
  constructor(object, {configuration, debug = false, loggingConfiguration, ...restArgs} = {}) {
    restArgsError(restArgs)

    this._debug = debug
    this._configuration = configuration
    this._loggingConfiguration = loggingConfiguration

    if (typeof object == "string") {
      this._subject = object
    } else {
      this._object = object
      this._subject = object.constructor.name
    }

    if (!this._subject) {
      throw new Error(`No subject given`)
    }
  }

  /**
   * @returns {import("./configuration.js").default} - The configuration.
   */
  getConfiguration() {
    if (!this._configuration) {
      const objectWithConfig = /** @type {{configuration?: import("./configuration.js").default}} */ (this._object)
      this._configuration = objectWithConfig?.configuration || Configuration.current()
    }

    return this._configuration
  }

  /**
   * @returns {import("./configuration.js").default | undefined} - The safe configuration.
   */
  _safeConfiguration() {
    try {
      return this.getConfiguration()
    } catch {
      return undefined
    }
  }

  /**
   * @param {any[]} messages - Messages.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async debug(...messages) {
    await this._write({level: "debug", messages})
  }

  /**
   * @param {any[]} messages - Messages.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async info(...messages) {
    await this._write({level: "info", messages})
  }

  /**
   * @param {any[]} messages - Messages.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async debugLowLevel(...messages) {
    await this._write({level: "debug-low-level", messages})
  }

  /**
   * @param {any[]} messages - Messages.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async log(...messages) {
    await this._write({level: "info", messages})
  }

  /**
   * @param {any[]} messages - Messages.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async error(...messages) {
    await this._write({level: "error", messages})
  }

  /**
   * @param {boolean} newValue - New value.
   * @returns {void} - No return value.
   */
  setDebug(newValue) {
    this._debug = newValue
  }

  /**
   * @type {(...args: Parameters<typeof functionOrMessages>) => Promise<void>}
   */
  async warn(...messages) {
    await this._write({level: "warn", messages})
  }

  /**
   * @param {object} args - Options object.
   * @param {LogLevel} args.level - Level.
   * @param {Parameters<typeof functionOrMessages>} args.messages - Messages.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _write({level, messages}) {
    const resolvedMessages = functionOrMessages(...messages)
    const message = messagesToMessage(this._subject, ...resolvedMessages)
    const configuration = this._safeConfiguration()
    const loggingConfiguration = /** @type {Required<Pick<import("./configuration-types.js").LoggingConfiguration, "console" | "file" | "levels">> & Partial<Pick<import("./configuration-types.js").LoggingConfiguration, "filePath">>} */ (
      this._loggingConfiguration || resolveLoggingConfiguration(configuration)
    )
    const shouldLog = isLevelAllowed({level, loggingConfiguration, debugFlag: this._debug})

    if (!shouldLog) return
    const writes = []

    if (loggingConfiguration.console !== false) {
      if (level === "error") {
        writes.push(consoleError(message))
      } else if (level === "warn") {
        writes.push(consoleWarn(message))
      } else {
        writes.push(consoleLog(message))
      }
    }

    if (loggingConfiguration.file !== false && loggingConfiguration.filePath && configuration) {
      const environmentHandler = configuration.getEnvironmentHandler?.()

      if (environmentHandler?.writeLogToFile) {
        writes.push(environmentHandler.writeLogToFile({
          filePath: loggingConfiguration.filePath,
          message
        }))
      }
    }

    if (writes.length === 1) {
      await writes[0]
    } else if (writes.length > 1) {
      await Promise.all(writes)
    }
  }
}

export {Logger}

/**
 * @param {any} object - Object.
 * @param {...Parameters<typeof functionOrMessages>} messages - forwarded args
 */
/**
 * @param {object} object - Log subject.
 * @param {...Parameters<typeof functionOrMessages>} messages - forwarded args
 */
export default async function logger(object, ...messages) {
  const objectWithConfig = /** @type {{constructor: {name: string}, configuration?: import("./configuration.js").default}} */ (object)
  const className = objectWithConfig.constructor.name
  let configuration = objectWithConfig.configuration

  if (!configuration) {
    try {
      configuration = Configuration.current()
    } catch {
      // Ignore missing configuration
    }
  }

  const loggingConfiguration = resolveLoggingConfiguration(configuration)
  /** @type {LogLevel} */
  const level = "debug"

  if (!isLevelAllowed({level, loggingConfiguration, debugFlag: configuration?.debug || false})) return

  const message = messagesToMessage(className, ...functionOrMessages(...messages))
  const writes = []

  if (loggingConfiguration.console !== false) {
    writes.push(consoleLog(message))
  }

  if (loggingConfiguration.file !== false && loggingConfiguration.filePath && configuration) {
    const environmentHandler = configuration.getEnvironmentHandler?.()

    if (environmentHandler?.writeLogToFile) {
      writes.push(environmentHandler.writeLogToFile({
        filePath: loggingConfiguration.filePath,
        message
      }))
    }
  }

  if (writes.length === 1) {
    await writes[0]
  } else if (writes.length > 1) {
    await Promise.all(writes)
  }
}

