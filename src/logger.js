import {digg} from "diggerize"

export default function log(object, ...messages) {
  if (!object.configuration) console.error(`No configuration on ${object.constructor.name}`)

  if (object.configuration?.debug) {
    if (!object.constructor.name) {
      throw new Error(`No constructor name for object`)
    }

    const className = object.constructor.name

    console.log(className, ...messages)
  }
}
