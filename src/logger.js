// @ts-check

import Configuration from "./configuration.js"
import restArgsError from "./utils/rest-args-error.js"

const DEFAULT_LOGGING_CONFIGURATION = {
  console: true,
  file: false
}

/**
 * @param {string} message
 * @returns {Promise<void>}
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
 * @param {string} message
 * @returns {Promise<void>}
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
 * @param {string} message
 * @returns {Promise<void>}
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
 * @param {...any|function() : Array<any>} messages
 * @returns {Array<any>} - Either the function result or the messages
 */
function functionOrMessages(...messages) {
  if (messages.length === 1 && typeof messages[0] == "function") {
    messages = messages[0]()
  }

  return messages
}

/**
 * Converts multiple message parts into a single string.
 * @param {...any} messages - Parts to combine into a message
 * @returns {string}
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
 * @param {import("./configuration.js").default | undefined} configuration
 * @returns {Required<Pick<import("./configuration-types.js").LoggingConfiguration, "console" | "file">> & Partial<Pick<import("./configuration-types.js").LoggingConfiguration, "filePath">>}
 */
function resolveLoggingConfiguration(configuration) {
  if (configuration && typeof configuration.getLoggingConfiguration === "function") {
    return configuration.getLoggingConfiguration()
  }

  return DEFAULT_LOGGING_CONFIGURATION
}

class Logger {
  /**
   * @param {any} object
   * @param {object} args
   * @param {import("./configuration.js").default} [args.configuration]
   * @param {boolean} [args.debug]
   */
  constructor(object, {configuration, debug = false, ...restArgs} = {}) {
    restArgsError(restArgs)

    this._debug = debug
    this._configuration = configuration

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
   * @returns {import("./configuration.js").default}
   */
  getConfiguration() {
    if (!this._configuration) {
      this._configuration = this._object?.configuration || Configuration.current()
    }

    return this._configuration
  }

  /**
   * @returns {import("./configuration.js").default | undefined}
   */
  _safeConfiguration() {
    try {
      return this.getConfiguration()
    } catch {
      return undefined
    }
  }

  /**
   * @param {any[]} messages
   * @returns {Promise<void>}
   */
  async debug(...messages) {
    const configuration = this._safeConfiguration()

    if (this._debug || configuration?.debug) {
      await this.log(...messages)
    }
  }

  /**
   * @param {any[]} messages
   * @returns {Promise<void>}
   */
  async log(...messages) {
    await this._write({level: "log", messages})
  }

  /**
   * @param {any[]} messages
   * @returns {Promise<void>}
   */
  async error(...messages) {
    await this._write({level: "error", messages})
  }

  /**
   * @param {boolean} newValue
   * @returns {void}
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
   * @param {object} args
   * @param {"error" | "log" | "warn"} args.level
   * @param {Parameters<typeof functionOrMessages>} args.messages
   * @returns {Promise<void>}
   */
  async _write({level, messages}) {
    const resolvedMessages = functionOrMessages(...messages)
    const message = messagesToMessage(this._subject, ...resolvedMessages)
    const configuration = this._safeConfiguration()
    const loggingConfiguration = resolveLoggingConfiguration(configuration)
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
 * @param {any} object
 * @param {...Parameters<typeof functionOrMessages>} messages - forwarded args
 */
export default async function logger(object, ...messages) {
  const className = object.constructor.name
  let configuration = object.configuration

  if (!configuration) {
    try {
      configuration = Configuration.current()
    } catch {
      // Ignore missing configuration
    }
  }

  if (configuration?.debug) {
    const loggingConfiguration = resolveLoggingConfiguration(configuration)
    const message = messagesToMessage(className, ...functionOrMessages(...messages))
    const writes = []

    if (loggingConfiguration.console !== false) {
      writes.push(consoleLog(message))
    }

    if (loggingConfiguration.file !== false && loggingConfiguration.filePath) {
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
