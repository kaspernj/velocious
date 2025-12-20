// @ts-check

import Configuration from "./configuration.js"
import restArgsError from "./utils/rest-args-error.js"

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

    if (typeof messagePartIndex == "number" && messagePartIndex > 0) {
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

class Logger {
  /**
   * @param {any} object
   * @param {object} args
   * @param {boolean} args.debug
   */
  constructor(object, {debug, ...restArgs} = {debug: false}) {
    restArgsError(restArgs)

    this._debug = debug

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
   * @param {any[]} messages
   * @returns {Promise<void>}
   */
  async debug(...messages) {
    if (this._debug || this.getConfiguration()?.debug) {
      await this.log(...messages)
    }
  }

  /**
   * @param {any[]} messages
   * @returns {Promise<void>}
   */
  async log(...messages) {
    await consoleLog(messagesToMessage(this._subject, ...functionOrMessages(...messages)))
  }

  /**
   * @param {any[]} messages
   * @returns {Promise<void>}
   */
  async error(...messages) {
    await consoleError(messagesToMessage(this._subject, ...functionOrMessages(...messages)))
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
    await consoleWarn(messagesToMessage(this._subject, ...functionOrMessages(...messages)))
  }
}

export {Logger}

/**
 * @param {any} object
 * @param {...Parameters<typeof functionOrMessages>} messages - forwarded args
 */
export default async function logger(object, ...messages) {
  const className = object.constructor.name
  const configuration = object.configuration || Configuration.current()

  if (configuration.debug) {
    await consoleLog(messagesToMessage(className, ...functionOrMessages(...messages)))
  }
}
