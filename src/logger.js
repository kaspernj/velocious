// @ts-check

import Configuration from "./configuration.js"
import LoggerConsoleOutput from "./logger/outputs/console-output.js"
import LoggerFileOutput from "./logger/outputs/file-output.js"
import {formatValue} from "./utils/format-value.js"
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
 * Format a single value for inclusion in a log message.
 * @param {any} value - Value to format.
 * @returns {string} - String representation.
 */
function formatPart(value) {
  if (value instanceof Error) {
    return `${value.message}\n${value.stack}`
  }

  if (typeof value === "object") {
    return formatValue(value)
  }

  return String(value)
}

/**
 * Formats the user-supplied messages into a single string.
 *
 * If the first message is a string containing printf-style format
 * specifiers (`%s`, `%d`, `%j`, `%o`, `%O`, or `%%`), the remaining
 * messages are interpolated into it in order (like `console.log` /
 * `util.format`). Any leftover messages are appended with a space
 * separator. Otherwise, all parts are joined with spaces.
 *
 * @param {Array<any>} messages - User-supplied message parts.
 * @returns {string} - The formatted user message.
 */
function formatUserMessages(messages) {
  if (messages.length === 0) return ""

  const first = messages[0]

  if (typeof first === "string" && /%[sdjoO%]/.test(first)) {
    let argIndex = 1
    const formatted = first.replace(/%[sdjoO%]/g, (match) => {
      if (match === "%%") return "%"
      if (argIndex >= messages.length) return match

      const value = messages[argIndex]

      argIndex += 1

      if (match === "%d") {
        // Match util.format: never throw for non-coercible values — yield "NaN" instead.
        // Number(Symbol()) throws, so catch and fall back.
        try {
          return String(Number(value))
        } catch {
          return "NaN"
        }
      }
      if (match === "%j" || match === "%o" || match === "%O") return formatValue(value)

      return formatPart(value)
    })

    let message = formatted

    for (let index = argIndex; index < messages.length; index += 1) {
      message += ` ${formatPart(messages[index])}`
    }

    return message
  }

  let message = ""

  for (let index = 0; index < messages.length; index += 1) {
    if (index > 0) message += " "
    message += formatPart(messages[index])
  }

  return message
}

/**
 * Converts a logger subject and message parts into a single log line.
 *
 * @param {string} subject - Logger subject / category prefix.
 * @param {...any} messages - User-supplied message parts (supports printf-style format specifiers on the first part).
 * @returns {string} - The formatted log line.
 */
function messagesToMessage(subject, ...messages) {
  const userMessage = formatUserMessages(messages)

  if (!subject) return userMessage
  if (!userMessage) return String(subject)

  return `${subject} ${userMessage}`
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
 * @param {LogLevel} args.level - Level.
 * @param {import("./configuration-types.js").LoggingOutputConfig[]} args.outputs - Output configurations.
 * @param {import("./configuration-types.js").LoggingConfiguration} args.loggingConfiguration - Logging configuration.
 * @param {boolean} [args.debugFlag] - Whether debug flag.
 * @returns {import("./configuration-types.js").LoggingOutputConfig[]} - Outputs enabled for the level.
 */
function enabledOutputConfigs({level, outputs, loggingConfiguration, debugFlag}) {
  return outputs.filter((outputConfig) => {
    if (!outputConfig || !outputConfig.output || typeof outputConfig.output.write !== "function") return false

    return isOutputLevelAllowed({level, outputConfig, loggingConfiguration, debugFlag})
  })
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
  const enabledOutputs = enabledOutputConfigs({
    level,
    outputs,
    loggingConfiguration: resolvedLoggingConfiguration,
    debugFlag
  })

  if (enabledOutputs.length === 0) return

  const writes = []
  /** @type {Array<any> | undefined} */
  let resolvedMessages
  /** @type {string | undefined} */
  let message
  /** @type {import("./configuration-types.js").LoggingOutputPayload | null} */
  let payload = null

  for (const outputConfig of enabledOutputs) {
    if (!payload) {
      resolvedMessages = functionOrMessages(...messages)
      message = messagesToMessage(subject, ...resolvedMessages)
      // subject is the first positional arg, then the user messages
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
      this._subject = object || "EmptyString"
    } else {
      this._object = object
      this._subject = object.constructor.name || "UnknownClass"
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
   * @param {LogLevel} level - Level.
   * @returns {boolean} - Whether any configured output emits this level.
   */
  isLevelEnabled(level) {
    const configuration = this._safeConfiguration()
    const loggingConfiguration = this._loggingConfiguration || resolveLoggingConfiguration(configuration)
    const outputs = resolveLoggingOutputs({loggingConfiguration, configuration})

    return enabledOutputConfigs({
      level,
      outputs,
      loggingConfiguration,
      debugFlag: this._debug
    }).length > 0
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
