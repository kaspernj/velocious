const {digg} = require("@kaspernj/object-digger")

module.exports = function log(object, ...messages) {
  if (object.debug) {
    const className = digg(object, "constructor", "name")

    console.log(className, ...messages)
  }
}
