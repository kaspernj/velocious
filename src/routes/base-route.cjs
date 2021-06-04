module.exports = class VelociousBaseRoute {
  routes = []

  get(path, args) {
    const GetRoute = require("./get-route.cjs")
    const route = new GetRoute({path, args})

    this.routes.push(route)
  }

  resources(name, callback) {
    const ResourceRoute = require("./resource-route.cjs")
    const route = new ResourceRoute({name: name})

    this.routes.push(route)

    if (callback) {
      callback(route)
    }
  }
}
