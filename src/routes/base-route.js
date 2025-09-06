import GetRoute from "./get-route.js"
import PostRoute from "./post-route.js"
import ResourceRoute from "./resource-route.js"

var VelociousBaseRoute

export function initBaseRoute() {
  if (VelociousBaseRoute) return

  VelociousBaseRoute = class VelociousBaseRoute {
    routes = []

    get(name, args) {
      const route = new GetRoute({name, args})

      this.routes.push(route)
    }

    matchWithPath(_path) {
      throw new Error(`No 'matchWithPath' implemented on ${this.constructor.name}`)
    }

    post(name, args) {
      const route = new PostRoute({name, args})

      this.routes.push(route)
    }

    resources(name, callback) {
      const route = new ResourceRoute({name})

      this.routes.push(route)

      if (callback) {
        callback(route)
      }
    }
  }
}

export {VelociousBaseRoute as default}
