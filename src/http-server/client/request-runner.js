// @ts-check

import BacktraceCleaner from "../../utils/backtrace-cleaner.js"
import ensureError from "../../utils/ensure-error.js"
import EventEmitter from "../../utils/event-emitter.js"
import Logger from "../../logger.js"
import Response from "./response.js"
import RoutesResolver from "../../routes/resolver.js"

/**
 * @param {string | undefined} line - Potential header line.
 * @returns {boolean} - Whether the line is a stack frame.
 */
function stackFrameLine(line) {
  if (!line) return false

  return /^at\s+/u.test(line.trim())
}

/**
 * @param {Error} error - Error to format for logging.
 * @param {string | undefined} cleanedStackWithHeader - Cleaned stack with header line.
 * @returns {string} - Error summary line with type information.
 */
function requestErrorSummary(error, cleanedStackWithHeader) {
  const stackHeader = cleanedStackWithHeader?.split("\n")[0]?.trim()

  if (stackHeader && !stackFrameLine(stackHeader)) return stackHeader

  const errorCode = typeof /** @type {any} */ (error).code === "string"
    ? /** @type {any} */ (error).code
    : undefined
  const errorMessage = error.message || String(error)

  if (errorCode) return `${error.name} [${errorCode}]: ${errorMessage}`

  return `${error.name}: ${errorMessage}`
}

/**
 * @param {Error} error - Error to format for logging.
 * @returns {{
 *   errorSummary: string,
 *   cleanedBacktrace: string | undefined,
 * }} - Log details.
 */
function requestErrorLogDetails(error) {
  const cleanedStackWithHeader = BacktraceCleaner.getCleanedStack(error)
  const errorSummary = requestErrorSummary(error, cleanedStackWithHeader)
  const cleanedBacktrace = BacktraceCleaner.getCleanedStack(error, {includeErrorHeader: false}) || cleanedStackWithHeader

  return {errorSummary, cleanedBacktrace}
}

/**
 * @param {{
 *   errorSummary: string,
 *   cleanedBacktrace: string | undefined,
 * }} logDetails - Log details.
 * @returns {string} - Single request error log message.
 */
function requestErrorLogMessage(logDetails) {
  if (!logDetails.cleanedBacktrace) {
    return `Error while running request: ${logDetails.errorSummary}`
  }

  return `Error while running request: ${logDetails.errorSummary}\nCleaned backtrace:\n${logDetails.cleanedBacktrace}`
}

/**
 * @param {Response} response - Response object.
 * @returns {string} - Response body type for logging.
 */
function responseBodyTypeForLog(response) {
  if (response.getFilePath()) return "file"

  try {
    return typeof response.getBody()
  } catch {
    return "unset"
  }
}

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
      await this.logger.debug(() => ["Run request lifecycle", {
        httpMethod: request.httpMethod(),
        httpVersion: request.httpVersion(),
        origin: request.origin(),
        path: request.path(),
        remoteAddress: request.remoteAddress()
      }])
      // Before we checked if the sec-fetch-mode was "cors", but it seems the sec-fetch-mode isn't always present
      await this.logger.debug(() => ["Run CORS", {httpMethod: request.httpMethod(), secFetchMode: request.header("sec-fetch-mode")}])

      const cors = configuration.getCors()

      if (cors) {
        await cors({request, response})
        await this.logger.debug(() => ["CORS handler done", {
          httpMethod: request.httpMethod(),
          path: request.path(),
          responseStatusCode: response.getStatusCode()
        }])
      }

      if (request.httpMethod() == "OPTIONS" && request.header("sec-fetch-mode") == "cors") {
        response.setStatus(200)
        response.setBody("")
        await this.logger.debug(() => ["Handled preflight OPTIONS request", {
          path: request.path(),
          responseStatusCode: response.getStatusCode()
        }])
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
          // Keep Promise.race here to allow dynamic timeout updates.
          await Promise.race([resolvePromise, timeoutPromise])
          await this.logger.debug(() => ["Routes resolver done", {
            httpMethod: request.httpMethod(),
            path: request.path(),
            responseStatusCode: response.getStatusCode(),
            hasFilePath: Boolean(response.getFilePath()),
            bodyType: responseBodyTypeForLog(response)
          }])
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
      const logDetails = requestErrorLogDetails(error)

      await this.logger.error(() => requestErrorLogMessage(logDetails))

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

    await this.logger.debug(() => ["Request runner done", {
      httpMethod: request.httpMethod(),
      path: request.path(),
      responseStatusCode: response.getStatusCode()
    }])
    this.state = "done"
    this.events.emit("done", this)
  }
}
