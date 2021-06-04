const {digg} = require("@kaspernj/object-digger")
const Routes = require("./index.cjs")

module.exports = class VelociousRoutesResolver {
  constructor({request, response, routes}) {
    if (!request) throw new Error("No request given")
    if (!response) throw new Error("No response given")
    if (!routes) throw new Error("No routes given")
    if (!(routes instanceof Routes)) throw new Error(`Given routes wasn't an instance of Routes: ${routes.constructor.name}`)

    this.request = request
    this.response = response
    this.routes = routes
  }

  resolve() {
    let currentRoute = digg(this, "routes", "rootRoute")
    let currentPath = this.request.path()

    console.log({ currentPath, currentRoute })

    throw new Error("stub")
  }
}
