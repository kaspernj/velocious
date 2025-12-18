// @ts-check

import ejs from "ejs"
import {incorporate} from "incorporator"
import * as inflection from "inflection"
import {Logger} from "./logger.js"
import restArgsError from "./utils/rest-args-error.js"

export default class VelociousController {
  /**
   * @param {string} methodName
   * @returns {void}
   */
  static beforeAction(methodName) {
    if (!this._beforeActions) {
      /** @type {Array<string>}  */
      this._beforeActions = []
    }

    this._beforeActions.push(methodName)
  }

  /**
   * @param {object} args
   * @param {string} args.action
   * @param {import("./configuration.js").default} args.configuration
   * @param {string} args.controller
   * @param {object} args.params
   * @param {import("./http-server/client/request.js").default} args.request
   * @param {import("./http-server/client/response.js").default} args.response
   * @param {string} args.viewPath
   */
  constructor({action, configuration, controller, params, request, response, viewPath}) {
    if (!action) throw new Error("No action given")
    if (!configuration) throw new Error("No configuration given")
    if (!controller) throw new Error("No controller given")
    if (!params) throw new Error("No params given")
    if (!request) throw new Error("No request given")
    if (!response) throw new Error("No response given")
    if (!viewPath) throw new Error("No viewPath given")

    this._action = action
    this._controller = controller
    this._configuration = configuration
    this.logger = new Logger(this)
    this._params = params
    this._request = request
    this._response = response
    this.viewParams = {}
    this._viewPath = viewPath
  }

  /** @returns {string} */
  getAction() { return this._action }

  /** @returns {import("./configuration.js").default} */
  getConfiguration() { return this._configuration }

  /** @returns {Record<string, any>} */
  getParams() { return this._params }

  /** @returns {import("./http-server/client/request.js").default} */
  getRequest() { return this._request }

  /**
   * @private
   * @returns {typeof VelociousController}
   */
  _getControllerClass() {
    const controllerClass = /** @type {typeof VelociousController} */ (this.constructor)

    return controllerClass
  }

  async _runBeforeCallbacks() {
    await this.logger.debug("_runBeforeCallbacks")

    let currentControllerClass = this._getControllerClass()

    while (currentControllerClass) {
      await this.logger.debug(`Running callbacks for ${currentControllerClass.name}`)

      const beforeActions = currentControllerClass._beforeActions

      if (beforeActions) {
        for (const beforeActionName of beforeActions) {
          const beforeAction = currentControllerClass.prototype[beforeActionName]

          if (!beforeAction) throw new Error(`No such before action: ${beforeActionName}`)

          const boundBeforeAction = beforeAction.bind(this)

          await boundBeforeAction()
        }
      }

      currentControllerClass = Object.getPrototypeOf(currentControllerClass)

      if (!currentControllerClass?.name?.endsWith("Controller")) break
    }

    await this.logger.debug("After runBeforeCallbacks")
  }

  /**
   * @returns {object}
   */
  params() { return this._params }

  /**
   * @param {object} [args]
   * @param {object} [args.json]
   * @param {number | string} [args.status]
   * @returns {Promise<void>}
   */
  async render({json, status, ...restArgs} = {}) {
    restArgsError(restArgs)

    if (json) {
      return this.renderJsonArg(json)
    }

    if (status) {
      this._response.setStatus(status)
    }

    return await this.renderView()
  }

  /** @param {object} json */
  renderJsonArg(json) {
    const body = JSON.stringify(json)

    this._response.setHeader("Content-Type", "application/json; charset=UTF-8")
    this._response.setBody(body)
  }

  renderView() {
    return new Promise((resolve, reject) => {
      const viewPath = `${this._viewPath}/${inflection.dasherize(inflection.underscore(this._action))}.ejs`
      const {viewParams} = this
      const actualViewParams = incorporate({controller: this}, viewParams)

      ejs.renderFile(viewPath, actualViewParams, {}, (err, str) => {
        if (err) {
          reject(err)
        } else {
          this._response.setHeader("Content-Type", "text/html; charset=UTF-8")
          this._response.setBody(str)

          resolve(null)
        }
      })
    })
  }

  renderText() {
    throw new Error("renderText stub")
  }

  /** @returns {import("./http-server/client/request.js").default} */
  request() { return this._request }

  /** @returns {import("./http-server/client/response.js").default} */
  response() { return this._response }
}
