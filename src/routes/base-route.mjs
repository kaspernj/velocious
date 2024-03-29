import GetRoute from "./get-route.mjs"
import ResourceRoute from "./resource-route.mjs"

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
