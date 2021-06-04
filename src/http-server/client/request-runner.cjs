const EventEmitter = require("events")
const logger = require("../../logger.cjs")
const Response = require("./response.cjs")
const RoutesResolver = require("../../routes/resolver.cjs")

module.exports = class VelociousHttpServerClientRequestRunner {
  events = new EventEmitter()

  constructor({configuration, request}) {
    if (!configuration) throw new Error("No configuration given")
    if (!request) throw new Error("No request given")

    this.configuration = configuration
    this.request = request
    this.response = new Response({configuration})
  }

  async run() {
    if (!this.request) throw new Error("No request?")

    logger(this, "Run request")

    const routesResolver = new RoutesResolver({
      configuration: this.configuration,
      request: this.request,
      response: this.response
    })

    await routesResolver.resolve()
    this.events.emit("done", this)
  }
}
