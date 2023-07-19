import EventEmitter from "events"
import logger from "../../logger.mjs"
import Response from "./response.mjs"
import RoutesResolver from "../../routes/resolver.mjs"

export default class VelociousHttpServerClientRequestRunner {
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
