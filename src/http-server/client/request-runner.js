import EventEmitter from "events"
import logger from "../../logger.js"
import Response from "./response.js"
import RoutesResolver from "../../routes/resolver.js"

export default class VelociousHttpServerClientRequestRunner {
  events = new EventEmitter()

  constructor({configuration, request}) {
    if (!configuration) throw new Error("No configuration given")
    if (!request) throw new Error("No request given")

    this.configuration = configuration
    this.request = request
    this.response = new Response({configuration})
    this.state = "running"
  }

  getState = () => this.state

  async run() {
    const {configuration, request, response} = this

    if (!request) throw new Error("No request?")

    try {
      if (request.httpMethod() == "OPTIONS" && request.header("sec-fetch-mode") == "cors") {
        await logger(this, () => ["Run CORS", {httpMethod: request.httpMethod(), secFetchMode: request.header("sec-fetch-mode")}])
        await configuration.cors({request, response})
      } else {
        await logger(this, "Run request")
        const routesResolver = new RoutesResolver({configuration, request, response})

        await routesResolver.resolve()
      }
    } catch (error) {
      await logger(this, `Error while running request: ${error.message}`)

      response.setStatus(500)
      response.setErrorBody(error)
    }

    this.state = "done"
    this.events.emit("done", this)
  }
}
