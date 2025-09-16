import Configuration from "./configuration.js"

function consoleLog(message) {
  return new Promise((resolve) => {
    process.stdout.write(`${message}\n`, "utf8", resolve)
  })
}

function consoleError(message) {
  return new Promise((resolve) => {
    process.stderr.write(`${message}\n`, "utf8", resolve)
  })
}

function consoleWarn(message) {
  return new Promise((resolve) => {
    process.stderr.write(`${message}\n`, "utf8", resolve)
  })
}

function functionOrMessages(messages) {
  if (messages.length === 1 && typeof messages[0] == "function") {
    messages = messages[0]()
  }

  return messages
}

function messagesToMessage(...messages) {
  let message = ""

  for (const messagePartIndex in messages) {
    const messagePart = messages[messagePartIndex]

    if (messagePartIndex > 0) {
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
  constructor(object) {
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

  getConfiguration() {
    if (!this._configuration) {
      this._configuration = this._object?.configuration || Configuration.current()
    }

    return this._configuration
  }

  async debug(...messages) {
    if (this.getConfiguration()?.debug) {
      await this.log(...messages)
    }
  }

  async log(...messages) {
    await consoleLog(messagesToMessage(this._subject, ...functionOrMessages(messages)))
  }

  async error(...messages) {
    await consoleError(messagesToMessage(this._subject, ...functionOrMessages(messages)))
  }

  async error(...messages) {
    await consoleWarn(messagesToMessage(this._subject, ...functionOrMessages(messages)))
  }
}

export {Logger}

export default async function logger(object, ...messages) {
  const className = object.constructor.name
  const configuration = object.configuration || Configuration.current()

  if (configuration.debug) {
    await consoleLog(messagesToMessage(className, ...functionOrMessages(messages)))
  }
}
