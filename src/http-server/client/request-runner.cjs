const EventEmitter = require("events")
const logger = require("../../logger.cjs")
const Response = require("./response.cjs")
const RoutesResolver = require("../../routes/resolver.cjs")

module.exports = class VelociousHttpServerClientRequestRunner {
  events = new EventEmitter()

  constructor({debug, request}) {
    this.debug = debug
    this.request = request
    this.response = new Response({debug})
  }

  run() {
    const routesResolver = new RoutesResolver({
      request: this.request,
      response: this.response
    })

    routesResolver.resolve()

    this.response.addHeader("Content-Type", "application/json")
    this.response.setBody(JSON.stringify({firstName: "Kasper"}))

    logger(this, "Run request :-)")

    this.events.emit("done", this)
  }
}
