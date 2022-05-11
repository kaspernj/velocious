import {digg, digs} from "diggerize"

export default class VelociousRoutesResolver {
  constructor({configuration, request, response, routes}) {
    if (!configuration) throw new Error("No configuration given")
    if (!request) throw new Error("No request given")
    if (!response) throw new Error("No response given")

    this.configuration = configuration
    this.params = {}
    this.request = request
    this.response = response
  }

  resolve() {
    let currentRoute = digg(this, "configuration", "routes", "rootRoute")
    let currentPath = this.request.path()

    const matchResult = this.matchPathWithRoutes(currentRoute, currentPath)

    if (!matchResult) throw new Error(`Couldn't match a route with the given path: ${currentPath}`)

    if (this.params.action && this.params.controller) {
      const controllerPath = `${digg(this, "configuration", "directory")}/src/routes/${digg(this, "params", "controller")}/controller`
      const controllerClass = require(controllerPath)
      const controllerInstance = new controllerClass({
        configuration: this.configuration,
        params: this.params,
        request: this.request,
        response: this.response
      })

      controllerInstance[this.params.action]()

      return
    }

    throw new Error(`Matched the route but didn't know what to do with it: ${currentPath}`)
  }

  matchPathWithRoutes(route, path) {
    const pathWithoutSlash = path.replace(/^\//, "")

    for (const subRoute of route.routes) {
      const matchResult = subRoute.matchWithPath({
        params: this.params,
        path: pathWithoutSlash
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
