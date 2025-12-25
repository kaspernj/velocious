// @ts-check

import BacktraceCleaner from "../../utils/backtrace-cleaner.js"
import ensureError from "../../utils/ensure-error.js"
import EventEmitter from "events"
import {Logger} from "../../logger.js"
import Response from "./response.js"
import RoutesResolver from "../../routes/resolver.js"

export default class VelociousHttpServerClientRequestRunner {
  events = new EventEmitter()

  /**
   * @param {object} args
   * @param {import("../../configuration.js").default} args.configuration
   * @param {any} args.request
   */
  constructor({configuration, request}) {
    if (!configuration) throw new Error("No configuration given")
    if (!request) throw new Error("No request given")

    this.logger = new Logger(this)
    this.configuration = configuration
    this.request = request
    this.response = new Response({configuration})
    this.state = "running"
  }

  getRequest() { return this.request }
  getState() { return this.state }

  async run() {
    const {configuration, request, response} = this

    if (!request) throw new Error("No request?")

    try {
      // Before we checked if the sec-fetch-mode was "cors", but it seems the sec-fetch-mode isn't always present
      await this.logger.debug(() => ["Run CORS", {httpMethod: request.httpMethod(), secFetchMode: request.header("sec-fetch-mode")}])

      const cors = configuration.getCors()

      if (cors) {
        await cors({request, response})
      }

      if (request.httpMethod() == "OPTIONS" && request.header("sec-fetch-mode") == "cors") {
        response.setStatus(200)
        response.setBody("")
      } else {
        await this.logger.debug("Run request")
        const routesResolver = new RoutesResolver({configuration, request, response})

        await routesResolver.resolve()
      }
    } catch (e) {
      const error = ensureError(e)

      await this.logger.error(() => `Error while running request: ${BacktraceCleaner.getCleanedStack(error)}`)

      response.setStatus(500)
      response.setErrorBody(error)
    }

    this.state = "done"
    this.events.emit("done", this)
  }
}
