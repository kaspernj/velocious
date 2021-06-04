const EventEmitter = require("events")
const logger = require("../../logger.cjs")
const Response = require("./response.cjs")
const Routes = require("../../routes/index.cjs")
const RoutesResolver = require("../../routes/resolver.cjs")

module.exports = class VelociousHttpServerClientRequestRunner {
  events = new EventEmitter()

  constructor({debug, request, routes}) {
    if (!request) throw new Error("No request given")
    if (!routes) throw new Error("No routes given")
    if (!(routes instanceof Routes)) throw new Error(`Given routes wasn't an instance of Routes: ${routes.constructor.name}`)

    this.debug = debug
    this.request = request
    this.response = new Response({debug})
    this.routes = routes
  }

  run() {
    if (!this.request) throw new Error("No request?")

    const routesResolver = new RoutesResolver({
      request: this.request,
      response: this.response,
      routes: this.routes
    })

    routesResolver.resolve()

    this.response.addHeader("Content-Type", "application/json")
    this.response.setBody(JSON.stringify({firstName: "Kasper"}))

    logger(this, "Run request :-)")

    this.events.emit("done", this)
  }
}
