// @ts-check

import BacktraceCleaner from "../../utils/backtrace-cleaner.js"
import ensureError from "../../utils/ensure-error.js"
import EventEmitter from "../../utils/event-emitter.js"
import {Logger} from "../../logger.js"
import Response from "./response.js"
import RoutesResolver from "../../routes/resolver.js"

export default class VelociousHttpServerClientRequestRunner {
  events = new EventEmitter()

  /**
   * @param {object} args - Options object.
   * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
   * @param {import("./request.js").default | import("./websocket-request.js").default} args.request - Request object.
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
        const startTimeMs = Date.now()
        let timeoutId
        let timeoutReject
        let timedOut = false

        const setRequestTimeoutSeconds = (timeoutSeconds) => {
          if (timeoutId) {
            clearTimeout(timeoutId)
            timeoutId = undefined
          }

          if (typeof timeoutSeconds !== "number" || !Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
            return
          }

          const timeoutMs = timeoutSeconds * 1000
          const elapsedMs = Date.now() - startTimeMs
          const remainingMs = timeoutMs - elapsedMs

          if (remainingMs <= 0) {
            timeoutReject?.(new Error(`Request timed out after ${timeoutSeconds}s`))
            return
          }

          timeoutId = setTimeout(() => {
            timeoutReject?.(new Error(`Request timed out after ${timeoutSeconds}s`))
          }, remainingMs)
        }

        const timeoutPromise = new Promise((_, reject) => {
          timeoutReject = (error) => {
            timedOut = true
            reject(error)
          }
        })

        response.setRequestTimeoutMsChangeHandler((timeoutSeconds) => {
          setRequestTimeoutSeconds(timeoutSeconds)
        })

        setRequestTimeoutSeconds(configuration.getRequestTimeoutMs?.())

        let resolvePromise

        try {
          resolvePromise = routesResolver.resolve()
          await Promise.race([resolvePromise, timeoutPromise])
        } catch (error) {
          if (timedOut && resolvePromise) {
            void resolvePromise.catch((resolveError) => {
              this.logger.warn(() => ["Request finished after timeout", resolveError])
            })
          }
          throw error
        } finally {
          if (timeoutId) clearTimeout(timeoutId)
        }
      }
    } catch (e) {
      const error = ensureError(e)
      const errorWithContext = /** @type {{velociousContext?: object}} */ (error)
      const errorContext = errorWithContext.velociousContext || {stage: "request-runner"}

      await this.logger.error(() => `Error while running request: ${BacktraceCleaner.getCleanedStack(error)}`)

      const errorPayload = {
        context: errorContext,
        error,
        request,
        response
      }

      configuration.getErrorEvents().emit("framework-error", errorPayload)
      configuration.getErrorEvents().emit("all-error", {
        ...errorPayload,
        errorType: "framework-error"
      })

      response.setStatus(500)
      response.setErrorBody(error)
    }

    this.state = "done"
    this.events.emit("done", this)
  }
}
