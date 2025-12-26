// @ts-check

import BaseRoute from "./base-route.js"

export default class VelociousBasicRoute extends BaseRoute {
  /** @param {string} name */
  get(name) {
    const GetRoute = VelociousBasicRoute.GetRouteType
    const route = new GetRoute({name})

    this.routes.push(route)
  }

  /**
   * @param {object} args
   * @param {Record<string, any>} args.params
   * @param {string} args.path
   * @param {import("../http-server/client/request.js").default} args.request
   * @returns {{restPath: string} | undefined} - Result.
   */
  matchWithPath({params, path, request}) { // eslint-disable-line no-unused-vars
    throw new Error(`No 'matchWithPath' implemented on ${this.constructor.name}`)
  }

  /**
   * @param {string} name
   * @param {function(import("./namespace-route.js").default) : void} callback
   * @returns {void} - Result.
   */
  namespace(name, callback) {
    const NamespaceRoute = VelociousBasicRoute.NameSpaceRouteType

    if (!NamespaceRoute) throw new Error("No NamespaceRoute registered")

    const route = new NamespaceRoute({name})

    this.routes.push(route)

    if (callback) {
      callback(route)
    }
  }

  /**
   * @param {string} name
   * @returns {void} - Result.
   */
  post(name) {
    const PostRoute = VelociousBasicRoute.PostRouteType

    if (!PostRoute) throw new Error("No PostRoute registered")

    const route = new PostRoute({name})

    this.routes.push(route)
  }

  /**
   * @param {string} name
   * @param {function(import("./resource-route.js").default) : void} [callback]
   * @returns {void} - Result.
   */
  resources(name, callback) {
    const ResourceRoute = VelociousBasicRoute.ResourceRouteType

    if (!ResourceRoute) throw new Error("No ResourceRoute registered")

    const route = new ResourceRoute({name})

    this.routes.push(route)

    if (callback) {
      callback(route)
    }
  }
}
