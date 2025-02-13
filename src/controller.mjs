import {digg, digs} from "diggerize"
import ejs from "ejs"

export default class VelociousController {
  constructor({configuration, params, request, response}) {
    if (!configuration) throw new Error("No configuration given")
    if (!params) throw new Error("No params given")
    if (!request) throw new Error("No request given")
    if (!response) throw new Error("No response given")

    this._configuration = configuration
    this._params = params
    this._request = request
    this._response = response
    this.viewParams = {}
  }

  params = () => this._params

  render(args = {}) {
    if (args.json) {
      return this.renderJsonArg(args)
    }

    return this.renderView()
  }

  renderJsonArg(args) {
    const body = JSON.stringify(args.json)

    this._response.addHeader("Content-Type", "application/json")
    this._response.setBody(body)
  }

  renderView() {
    return new Promise((resolve, reject) => {
      const actionName = digg(this, "_params", "action")
      const controllerName = digg(this, "_params", "controller")
      const directory = digg(this, "_configuration").getDirectory()
      const viewPath = `${directory}/src/routes/${controllerName}/${actionName}.ejs`
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
