const {digg} = require("diggerize")
const RequestParser = require("./request-parser.cjs")

module.exports = class VelociousHttpServerClientRequest {
  constructor({configuration}) {
    this.configuration = configuration
    this.requestParser = new RequestParser({configuration})
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
