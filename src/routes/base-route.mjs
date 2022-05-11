export default class VelociousBaseRoute {
  routes = []

  get(name, args) {
    import GetRoute from "./get-route.mjs"
    const route = new GetRoute({name, args})

    this.routes.push(route)
  }

  matchWithPath(_path) {
    throw new Error(`No 'matchWithPath' implemented on ${this.constructor.name}`)
  }

  resources(name, callback) {
    import ResourceRoute from "./resource-route.mjs"
    const route = new ResourceRoute({name})

    this.routes.push(route)

    if (callback) {
      callback(route)
    }
  }
}
