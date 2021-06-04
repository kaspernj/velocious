const {digg} = require("@kaspernj/object-digger")

module.exports = function log(object, ...messages) {
  if (!object.configuration) console.error(`No configuration on ${object.constructor.name}`)

  if (object.configuration?.debug) {
    const className = digg(object, "constructor", "name")

    console.log(className, ...messages)
  }
}
