const {digg} = require("@kaspernj/object-digger")
const RequestParser = require("./request-parser.cjs")

module.exports = class VelociousHttpServerClientRequest {
  constructor() {
    this.requestParser = new RequestParser()
  }

  feed(data) {
    this.requestParser.feed(data)
  }

  httpMethod() {
    return digg(this, "requestParser", "httpMethod")
  }

  host() {
    return digg(this, "requestParser", "headersByName", "host")
  }

  path() {
    return digg(this, "requestParser", "path")
  }
}
