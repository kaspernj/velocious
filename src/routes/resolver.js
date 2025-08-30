import {digg, digs} from "diggerize"
import {fileURLToPath} from "url"
import fs from "fs/promises"
import {dirname} from "path"

export default class VelociousRoutesResolver {
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
    let currentRoute = digg(this, "configuration", "routes", "rootRoute")
    let currentPath = this.request.path()
    let viewPath

    const matchResult = this.matchPathWithRoutes(currentRoute, currentPath)
    let action = this.params.action
    let controller = this.params.controller

    if (!matchResult) {
      const __filename = fileURLToPath(import.meta.url)
      const __dirname = dirname(__filename)

      controller = "errors"
      controllerPath = "./built-in/errors/controller.js"
      action = "notFound"
      viewPath = await fs.realpath(`${__dirname}/built-in/errors`) // eslint-disable-line no-undef
    } else if (action) {
      if (!controller) controller = "_root"

      controllerPath = `${this.configuration.getDirectory()}/src/routes/${controller}/controller.js`
      viewPath = `${this.configuration.getDirectory()}/src/routes/${controller}`
    } else {
      throw new Error(`Matched the route but didn't know what to do with it: ${currentPath} (action: ${action}, controller: ${controller}, params: ${JSON.stringify(this.params)})`)
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

    await this.configuration.getDatabasePool().withConnection(async () => {
      await controllerInstance._runBeforeCallbacks()
      await controllerInstance[action]()
    })
  }

  matchPathWithRoutes(route, path) {
    const pathWithoutSlash = path.replace(/^\//, "")

    for (const subRoute of route.routes) {
      const matchResult = subRoute.matchWithPath({
        params: this.params,
        path: pathWithoutSlash,
        request: this.request
      })

      if (!matchResult) continue

      const {restPath} = digs(matchResult, "restPath")

      if (restPath) {
        return this.matchPathWithRoutes(subRoute, restPath)
      }

      return matchResult
    }
  }
}
