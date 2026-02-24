// @ts-check

import Configuration from "./configuration.js"
import LoggerConsoleOutput from "./logger/outputs/console-output.js"
import LoggerFileOutput from "./logger/outputs/file-output.js"
import restArgsError from "./utils/rest-args-error.js"

/** @typedef {"debug-low-level" | "debug" | "info" | "warn" | "error"} LogLevel */

const DEFAULT_LOGGING_CONFIGURATION = {
  console: true,
  file: false,
  /** @type {LogLevel[]} */
  levels: ["info", "warn", "error"]
}

/** @type {LogLevel[]} */
const LEVEL_ORDER = ["debug-low-level", "debug", "info", "warn", "error"]

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
 * @returns {Required<Pick<import("./configuration-types.js").LoggingConfiguration, "console" | "file" | "levels">> & Partial<Pick<import("./configuration-types.js").LoggingConfiguration, "filePath" | "outputs">>} - The logging configuration.
 */
function resolveLoggingConfiguration(configuration) {
  const debugEnabled = configuration?.debug === true
  if (configuration && typeof configuration.getLoggingConfiguration === "function") {
    const resolved = configuration.getLoggingConfiguration()

    if (debugEnabled) {
      return {
        ...resolved,
        console: true,
        levels: LEVEL_ORDER
      }
    }

    return resolved
  }

  if (debugEnabled) {
    return {
      ...DEFAULT_LOGGING_CONFIGURATION,
      console: true,
      levels: LEVEL_ORDER
    }
  }

  return DEFAULT_LOGGING_CONFIGURATION
}

/**
 * @param {object} args - Options object.
 * @param {LogLevel} args.level - Level.
 * @param {LogLevel[]} args.allowedLevels - Allowed levels.
 * @param {boolean} [args.debugFlag] - Whether debug flag.
 * @returns {boolean} - Whether level allowed.
 */
function isLevelAllowed({level, allowedLevels, debugFlag}) {
  if (allowedLevels.includes(level)) return true

  if (debugFlag && LEVEL_ORDER.indexOf(level) >= LEVEL_ORDER.indexOf("debug")) return true

  return false
}

/**
 * @param {object} args - Options object.
 * @param {import("./configuration-types.js").LoggingConfiguration} args.loggingConfiguration - Logging configuration.
 * @param {import("./configuration.js").default | undefined} args.configuration - Configuration instance.
 * @returns {import("./configuration-types.js").LoggingOutputConfig[]} - Logging outputs.
 */
function resolveLoggingOutputs({loggingConfiguration, configuration}) {
  if (Array.isArray(loggingConfiguration.outputs)) return loggingConfiguration.outputs

  if (Array.isArray(loggingConfiguration.loggers)) {
    /** @type {import("./configuration-types.js").LoggingOutputConfig[]} */
    const loggerOutputs = []

    for (const logger of loggingConfiguration.loggers) {
      if (!logger) continue

      const loggerConfig = /** @type {any} */ (logger)

      if (typeof loggerConfig.toOutputConfig === "function") {
        loggerOutputs.push(loggerConfig.toOutputConfig({configuration}))
        continue
      }

      if (loggerConfig.output && typeof loggerConfig.output.write === "function") {
        loggerOutputs.push({
          output: loggerConfig.output,
          levels: loggerConfig.levels
        })
        continue
      }

      if (typeof loggerConfig.write === "function") {
        loggerOutputs.push({
          output: loggerConfig,
          levels: loggerConfig.levels
        })
        continue
      }

      const loggerName = loggerConfig?.constructor?.name || "UnknownLogger"
      throw new Error(`Logger must implement toOutputConfig or write: ${loggerName}`)
    }

    return loggerOutputs
  }

  /** @type {import("./configuration-types.js").LoggingOutputConfig[]} */
  const outputs = []
  if (loggingConfiguration.console !== false) {
    outputs.push({
      output: new LoggerConsoleOutput(),
      levels: loggingConfiguration.levels
    })
  }

  if (loggingConfiguration.file !== false && loggingConfiguration.filePath) {
    outputs.push({
      output: new LoggerFileOutput({
        configuration,
        getConfiguration: () => configuration,
        filePath: loggingConfiguration.filePath
      }),
      levels: loggingConfiguration.levels
    })
  }

  return outputs
}

/**
 * @param {object} args - Options object.
 * @param {LogLevel} args.level - Level.
 * @param {import("./configuration-types.js").LoggingOutputConfig} args.outputConfig - Output configuration.
 * @param {import("./configuration-types.js").LoggingConfiguration} args.loggingConfiguration - Logging configuration.
 * @param {boolean} [args.debugFlag] - Whether debug flag.
 * @returns {boolean} - Whether output should log.
 */
function isOutputLevelAllowed({level, outputConfig, loggingConfiguration, debugFlag}) {
  if (Array.isArray(outputConfig.levels)) {
    return isLevelAllowed({level, allowedLevels: outputConfig.levels, debugFlag: false})
  }

  if (Array.isArray(outputConfig.output?.levels)) {
    return isLevelAllowed({level, allowedLevels: outputConfig.output.levels, debugFlag: false})
  }

  const allowedLevels = loggingConfiguration.levels || DEFAULT_LOGGING_CONFIGURATION.levels

  return isLevelAllowed({level, allowedLevels, debugFlag})
}

/**
 * @param {object} args - Options object.
 * @param {string} args.subject - Log subject.
 * @param {LogLevel} args.level - Level.
 * @param {Parameters<typeof functionOrMessages>} args.messages - Messages.
 * @param {import("./configuration.js").default | undefined} args.configuration - Configuration instance.
 * @param {import("./configuration-types.js").LoggingConfiguration | undefined} args.loggingConfiguration - Logging configuration.
 * @param {boolean} [args.debugFlag] - Whether debug flag.
 * @returns {Promise<void>} - Resolves when complete.
 */
async function writeLog({subject, level, messages, configuration, loggingConfiguration, debugFlag}) {
  const resolvedLoggingConfiguration = loggingConfiguration || resolveLoggingConfiguration(configuration)
  const outputs = resolveLoggingOutputs({loggingConfiguration: resolvedLoggingConfiguration, configuration})

  if (outputs.length === 0) return

  const writes = []
  /** @type {Array<any> | undefined} */
  let resolvedMessages
  /** @type {string | undefined} */
  let message
  /** @type {import("./configuration-types.js").LoggingOutputPayload | null} */
  let payload = null

  for (const outputConfig of outputs) {
    if (!outputConfig || !outputConfig.output || typeof outputConfig.output.write !== "function") continue
    if (!isOutputLevelAllowed({level, outputConfig, loggingConfiguration: resolvedLoggingConfiguration, debugFlag})) continue

    if (!payload) {
      resolvedMessages = functionOrMessages(...messages)
      message = messagesToMessage(subject, ...resolvedMessages)
      payload = {
        level,
        message,
        subject,
        timestamp: new Date()
      }
    }

    writes.push(outputConfig.output.write(payload))
  }

  if (writes.length === 1) {
    await writes[0]
  } else if (writes.length > 1) {
    await Promise.all(writes)
  }
}

export default class Logger {
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
    const configuration = this._safeConfiguration()
    const loggingConfiguration = this._loggingConfiguration || resolveLoggingConfiguration(configuration)

    await writeLog({
      subject: this._subject,
      level,
      messages,
      configuration,
      loggingConfiguration,
      debugFlag: this._debug
    })
  }
}
