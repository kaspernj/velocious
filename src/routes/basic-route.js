// @ts-check

import BaseRoute from "./base-route.js"

export default class VelociousBasicRoute extends BaseRoute {
  /** @param {string} name - Route name. */
  get(name) {
    const GetRoute = VelociousBasicRoute.GetRouteType
    const route = new GetRoute({name})

    this.routes.push(route)
  }

  /**
   * @param {object} args - Options object.
   * @param {Record<string, any>} args.params - Parameters object.
   * @param {string} args.path - Path.
   * @param {import("../http-server/client/request.js").default | import("../http-server/client/websocket-request.js").default} args.request - Request object.
   * @returns {{restPath: string} | undefined} - REST path metadata for this route.
   */
  matchWithPath({params, path, request}) { // eslint-disable-line no-unused-vars
    throw new Error(`No 'matchWithPath' implemented on ${this.constructor.name}`)
  }

  /**
   * @param {string} name - Name.
   * @param {function(import("./namespace-route.js").default) : void} callback - Callback function.
   * @returns {void} - No return value.
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
   * @param {string} name - Name.
   * @returns {void} - No return value.
   */
  post(name) {
    const PostRoute = VelociousBasicRoute.PostRouteType

    if (!PostRoute) throw new Error("No PostRoute registered")

    const route = new PostRoute({name})

    this.routes.push(route)
  }

  /**
   * @param {string} name - Name.
   * @param {function(import("./resource-route.js").default) : void} [callback] - Callback function.
   * @returns {void} - No return value.
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

