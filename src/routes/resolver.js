// @ts-check

import {dirname} from "path"
import {fileURLToPath} from "url"
import fs from "fs/promises"
import * as inflection from "inflection"
import {Logger} from "../logger.js"
import UploadedFile from "../http-server/client/uploaded-file/uploaded-file.js"
import ensureError from "../utils/ensure-error.js"

export default class VelociousRoutesResolver {
  /** @type {Logger | undefined} */
  logger

  /**
   * @param {object} args - Options object.
   * @param {import("../configuration.js").default} args.configuration - Configuration instance.
   * @param {import("../http-server/client/request.js").default | import("../http-server/client/websocket-request.js").default} args.request - Request object.
   * @param {import("../http-server/client/response.js").default} args.response - Response object.
   */
  constructor({configuration, request, response}) {
    if (!configuration) throw new Error("No configuration given")
    if (!request) throw new Error("No request given")
    if (!response) throw new Error("No response given")

    this.configuration = configuration
    this.params = request.params()
    this.request = request
    this.response = response
  }

  async resolve() {
    let controllerPath
    let currentRoute = this.configuration.routes.rootRoute
    const rawPath = this.request.path()
    const currentPath = rawPath.split("?")[0]
    let viewPath

    const matchResult = this.matchPathWithRoutes(currentRoute, currentPath)
    const actionParam = this.params.action
    const controllerParam = this.params.controller
    const actionValue = typeof actionParam == "string" ? actionParam : (Array.isArray(actionParam) ? actionParam[0] : undefined)
    let action = typeof actionValue == "string" ? inflection.camelize(actionValue.replaceAll("-", "_"), true) : undefined
    let controller = typeof controllerParam == "string" ? controllerParam : (Array.isArray(controllerParam) ? controllerParam[0] : undefined)

    if (!matchResult) {
      const __filename = fileURLToPath(import.meta.url)
      const __dirname = dirname(__filename)
      const requestedPath = currentPath.replace(/^\//, "") || "_root"
      const attemptedControllerPath = `${this.configuration.getDirectory()}/src/routes/${requestedPath}/controller.js`

      await (this.logger || new Logger("RoutesResolver", {configuration: this.configuration})).warn(`No route matched for ${rawPath}. Tried controller at ${attemptedControllerPath}`)

      controller = "errors"
      controllerPath = "./built-in/errors/controller.js"
      action = "notFound"
      viewPath = await fs.realpath(`${__dirname}/built-in/errors`)
    } else if (action) {
      if (!controller) controller = "_root"

      controllerPath = `${this.configuration.getDirectory()}/src/routes/${controller}/controller.js`
      viewPath = `${this.configuration.getDirectory()}/src/routes/${controller}`
    } else {
      throw new Error(`Matched the route but didn't know what to do with it: ${rawPath} (action: ${action}, controller: ${controller}, params: ${JSON.stringify(this.params)})`)
    }

    const controllerClassImport = await import(controllerPath)
    const controllerClass = controllerClassImport.default
    const controllerInstance = new controllerClass({
      action,
      configuration: this.configuration,
      controller,
      params: this.params,
      request: this.request,
      response: this.response,
      viewPath
    })

    if (!(action in controllerInstance)) {
      throw new Error(`Missing action on controller: ${controller}#${action}`)
    }

    this.logger ||= new Logger(controllerClass.name, {configuration: this.configuration})

    await this._logActionStart({action, controllerClass})

    try {
      await this.configuration.ensureConnections(async () => {
        await controllerInstance._runBeforeCallbacks()
        await controllerInstance[action]()
      })
    } catch (error) {
      const ensuredError = ensureError(error)
      const errorContext = {
        action,
        controller,
        httpMethod: this.request.httpMethod(),
        path: this.request.path(),
        stage: "controller-action"
      }

      const errorWithContext = /** @type {{velociousContext?: object}} */ (ensuredError)

      errorWithContext.velociousContext = {
        ...(errorWithContext.velociousContext || {}),
        controllerAction: errorContext
      }

      throw ensuredError
    }
  }

  /**
   * @param {import("./base-route.js").default} route - Route.
   * @param {string} path - Path.
   * @returns {{restPath: string} | undefined} - REST path metadata for this route.
   */
  matchPathWithRoutes(route, path) {
    const pathWithoutSlash = path.replace(/^\//, "").split("?")[0]

    for (const subRoute of route.routes) {
      const matchResult = subRoute.matchWithPath({
        params: this.params,
        path: pathWithoutSlash,
        request: this.request
      })

      if (!matchResult) continue

      const {restPath} = matchResult

      if (restPath) {
        return this.matchPathWithRoutes(subRoute, restPath)
      }

      return matchResult
    }
  }

  /**
   * @param {object} args - Options object.
   * @param {string} args.action - Action.
   * @param {typeof import("../controller.js").default} args.controllerClass - Controller class.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _logActionStart({action, controllerClass}) {
    const request = this.request
    const timestamp = this._formatTimestamp(new Date())
    const remoteAddress = request.remoteAddress?.() || request.header("x-forwarded-for") || "unknown"
    const loggedParams = /** @type {Record<string, unknown>} */ (this._sanitizeParamsForLogging(this.params))

    delete loggedParams.action
    delete loggedParams.controller

    await this.logger.info(() => `Started ${request.httpMethod()} "${request.path()}" for ${remoteAddress} at ${timestamp}`)
    await this.logger.info(() => `Processing by ${controllerClass.name}#${action}`)
    await this.logger.info(() => [`  Parameters:`, loggedParams])
  }

  /**
   * @param {Date} date - Date value.
   * @returns {string} - The timestamp.
   */
  _formatTimestamp(date) {
    /**
     * @param {number} num - Num.
     * @returns {string} - The pad.
     */
    const pad = (num) => String(num).padStart(2, "0")
    const year = date.getFullYear()
    const month = pad(date.getMonth() + 1)
    const day = pad(date.getDate())
    const hours = pad(date.getHours())
    const minutes = pad(date.getMinutes())
    const seconds = pad(date.getSeconds())
    const offsetMinutes = date.getTimezoneOffset()
    const offsetSign = offsetMinutes > 0 ? "-" : "+"
    const offsetTotalMinutes = Math.abs(offsetMinutes)
    const offsetHours = pad(Math.floor(offsetTotalMinutes / 60))
    const offsetRemainingMinutes = pad(offsetTotalMinutes % 60)

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds} ${offsetSign}${offsetHours}${offsetRemainingMinutes}`
  }

  /**
   * @param {any} value - Value to use.
   * @returns {any} - The sanitize params for logging.
   */
  _sanitizeParamsForLogging(value) {
    if (value instanceof UploadedFile) {
      return {
        className: value.constructor.name,
        filename: value.filename(),
        size: value.size()
      }
    }

    if (Array.isArray(value)) {
      return value.map((item) => this._sanitizeParamsForLogging(item))
    }

    if (value && typeof value === "object") {
      /** @type {Record<string, any>} */
      const result = {}

      for (const key of Object.keys(value)) {
        result[key] = this._sanitizeParamsForLogging(value[key])
      }

      return result
    }

    return value
  }
}

