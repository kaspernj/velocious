import Configuration from "./configuration.js"

function consoleLog(message) {
  return new Promise((resolve) => {
    process.stdout.write(message, "utf8", resolve)
  })
}

export default async function log(object, ...messages) {
  let configuration

  if (object.configuration) {
    configuration = object.configuration
  } else {
    configuration = Configuration.current()
  }

  if (configuration?.debug) {
    try {
      if (!object.constructor.name) {
        throw new Error(`No constructor name for object`)
      }

      const className = object.constructor.name

      if (messages.length === 1 && typeof messages[0] == "function") {
        messages = messages[0]()
      }

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

      await consoleLog(`${className} ${message}\n`)
    } catch (error) {
      console.error(`ERROR ${error.message}`)
    }
  }
}
