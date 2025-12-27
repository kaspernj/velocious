// @ts-check

export default class VelociousBaseRoute {
  /** @type {typeof import("./get-route.js").default} */
  static GetRouteType

  /** @type {typeof import("./namespace-route.js").default} */
  static NameSpaceRouteType

  /** @type {typeof import("./post-route.js").default} */
  static PostRouteType

  /** @type {typeof import("./resource-route.js").default} */
  static ResourceRouteType

  /** @param {typeof import("./get-route.js").default} RouteClass - Route class to register. */
  static registerRouteGetType(RouteClass) {
    this.GetRouteType = RouteClass
  }

  /** @param {typeof import("./namespace-route.js").default} RouteClass - Route class to register. */
  static registerRouteNamespaceType(RouteClass) {
    this.NameSpaceRouteType = RouteClass
  }

  /** @param {typeof import("./post-route.js").default} RouteClass - Route class to register. */
  static registerRoutePostType(RouteClass) {
    this.PostRouteType = RouteClass
  }

  /** @param {typeof import("./resource-route.js").default} RouteClass - Route class to register. */
  static registerRouteResourceType(RouteClass) {
    this.ResourceRouteType = RouteClass
  }

  /** @type {Array<VelociousBaseRoute>} */
  routes = []

  constructor() {
    // Nothing
  }

  /**
   * @abstract
   * @param {string} name - Name.
   */
  get(name) { throw new Error("'get' not implemented") } // eslint-disable-line no-unused-vars

  /**
   * @abstract
   * @returns {Array<{action: string, method: string, path: string}>} - Route definitions for this resource.
   */
  getHumanPaths() { throw new Error(`'getHumanPaths' not implemented for ${this.constructor.name}`) }

  /** @returns {Array<VelociousBaseRoute>} - The sub routes.  */
  getSubRoutes() { return this.routes }

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
   * @abstract
   * @param {string} name - Name.
   * @param {function(import("./namespace-route.js").default) : void} callback - Callback function.
   * @returns {void} - No return value.
   */
  namespace(name, callback) { throw new Error("'namespace' not implemented") } // eslint-disable-line no-unused-vars

  /**
   * @abstract
   * @param {string} name - Name.
   * @returns {void} - No return value.
   */
  post(name) { throw new Error("'post' not implemented") } // eslint-disable-line no-unused-vars

  /**
   * @abstract
   * @param {string} name - Name.
   * @param {function(import("./resource-route.js").default) : void} callback - Callback function.
   * @returns {void} - No return value.
   */
  resources(name, callback) { throw new Error("'resources' not implemented") } // eslint-disable-line no-unused-vars
}

