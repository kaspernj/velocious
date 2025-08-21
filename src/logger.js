export default function log(object, ...messages) {
  if (!object.configuration) console.error(`No configuration on ${object.constructor.name}`)

  if (object.configuration?.debug) {
    try {
      if (!object.constructor.name) {
        throw new Error(`No constructor name for object`)
      }

      const className = object.constructor.name

      if (messages.length === 1 && typeof messages[0] == "function") {
        messages = messages[0]()
      }

      console.log(className, ...messages)
    } catch (error) {
      console.error(`ERROR ${error.message}`)
    }
  }
}
