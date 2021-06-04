module.exports = class VelociousBaseRoute {
  routes = []

  get(name, args) {
    const GetRoute = require("./get-route.cjs")
    const route = new GetRoute({name, args})

    this.routes.push(route)
  }

  matchWithPath(_path) {
    throw new Error(`No 'matchWithPath' implemented on ${this.constructor.name}`)
  }

  resources(name, callback) {
    const ResourceRoute = require("./resource-route.cjs")
    const route = new ResourceRoute({name})

    this.routes.push(route)

    if (callback) {
      callback(route)
    }
  }
}
