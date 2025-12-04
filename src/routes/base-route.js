import GetRoute from "./get-route.js"
import NamespaceRoute from "./namespace-route.js"
import PostRoute from "./post-route.js"
import ResourceRoute from "./resource-route.js"

var VelociousBaseRoute

export function initBaseRoute() {
  if (VelociousBaseRoute) return

  VelociousBaseRoute = class VelociousBaseRoute {
    routes = []

    /**
     * @param {string} name
     * @param {object} args
     */
    get(name, args) {
      const route = new GetRoute({name, args})

      this.routes.push(route)
    }

    /**
     * @interface
     * @param {string} _path
     */
    matchWithPath(_path) { // eslint-disable-line no-unused-vars
      throw new Error(`No 'matchWithPath' implemented on ${this.constructor.name}`)
    }

    /**
     * @param {string} name
     * @param {function(NamespaceRoute) : void} callback
     * @returns {void}
     */
    namespace(name, callback) {
      const route = new NamespaceRoute({name})

      this.routes.push(route)

      if (callback) {
        callback(route)
      }
    }

    /**
     * @param {string} name
     * @param {object} args
     * @returns {void}
     */
    post(name, args) {
      const route = new PostRoute({name, args})

      this.routes.push(route)
    }

    /**
     * @param {string} name
     * @param {function(ResourceRoute) : void} callback
     * @returns {void}
     */
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
