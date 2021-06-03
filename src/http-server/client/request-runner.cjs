const EventEmitter = require("events")
const Response = require("./response.cjs")

const logger = require("../../logger.cjs")

module.exports = class VelociousHttpServerClientRequestRunner {
  events = new EventEmitter()

  constructor({debug, request}) {
    this.debug = debug
    this.request = request
    this.response = new Response({debug})
  }

  run() {
    this.response.addHeader("Content-Type", "application/json")
    this.response.setBody(JSON.stringify({firstName: "Kasper"}))

    logger(this, "Run request :-)")

    this.events.emit("done", this)
  }
}
