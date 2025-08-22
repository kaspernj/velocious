import {digs} from "diggerize"
import ejs from "ejs"
import * as inflection from "inflection"
import restArgsError from "./utils/rest-args-error.js"

export default class VelociousController {
  static beforeAction(methodName) {
    if (!this._beforeActions) this._beforeActions = []

    this._beforeActions.push(methodName)
  }

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
    this._params = params
    this._request = request
    this._response = response
    this.viewParams = {}
    this._viewPath = viewPath
  }

  async _runBeforeCallbacks() {
    console.log("_runBeforeCallbacks", {className: this.constructor.name})

    let currentControllerClass = this.constructor

    while (currentControllerClass) {
      const beforeActions = currentControllerClass._beforeActions

      if (!beforeActions) continue

      for (const beforeActionName of beforeActions) {
        const beforeAction = currentControllerClass.prototype[beforeActionName]

        if (!beforeAction) throw new Error(`No such before action: ${beforeActionName}`)

        const boundBeforeAction = beforeAction.bind(this)

        await boundBeforeAction()
      }

      currentControllerClass = Object.getPrototypeOf(currentControllerClass)
    }

    console.log("After runBeforeCallbacks")
  }

  params = () => this._params

  render({json, status, ...restArgs} = {}) {
    restArgsError(restArgs)

    if (json) {
      return this.renderJsonArg(json)
    }

    if (status) {
      this._response.setStatus(status)
    }

    return this.renderView()
  }

  renderJsonArg(json) {
    const body = JSON.stringify(json)

    this._response.addHeader("Content-Type", "application/json")
    this._response.setBody(body)
  }

  renderView() {
    return new Promise((resolve, reject) => {
      const viewPath = `${this._viewPath}/${inflection.dasherize(inflection.underscore(this._action))}.ejs`
      const {viewParams} = digs(this, "viewParams")

      ejs.renderFile(viewPath, viewParams, {}, (err, str) => {
        if (err) {
          reject(err)
        } else {
          this._response.addHeader("Content-Type", "text/html")
          this._response.setBody(str)

          resolve()
        }
      })
    })
  }

  renderText() {
    throw new Error("renderText stub")
  }

  request() {
    return this._request
  }

  response() {
    return this._response
  }
}
