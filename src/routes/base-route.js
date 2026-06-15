// @ts-check

export default class VelociousBaseRoute {
  /**
   * Narrows the runtime value to the documented type.
   * @type {typeof import("./get-route.js").default} */
  static GetRouteType

  /**
   * Narrows the runtime value to the documented type.
   * @type {typeof import("./namespace-route.js").default} */
  static NameSpaceRouteType

  /**
   * Narrows the runtime value to the documented type.
   * @type {typeof import("./post-route.js").default} */
  static PostRouteType

  /**
   * Narrows the runtime value to the documented type.
   * @type {typeof import("./resource-route.js").default} */
  static ResourceRouteType

  /**
   * Runs register route get type.
   * @param {typeof import("./get-route.js").default} RouteClass - Route class to register.
   */
  static registerRouteGetType(RouteClass) {
    this.GetRouteType = RouteClass
  }

  /**
   * Runs register route namespace type.
   * @param {typeof import("./namespace-route.js").default} RouteClass - Route class to register.
   */
  static registerRouteNamespaceType(RouteClass) {
    this.NameSpaceRouteType = RouteClass
  }

  /**
   * Runs register route post type.
   * @param {typeof import("./post-route.js").default} RouteClass - Route class to register.
   */
  static registerRoutePostType(RouteClass) {
    this.PostRouteType = RouteClass
  }

  /**
   * Runs register route resource type.
   * @param {typeof import("./resource-route.js").default} RouteClass - Route class to register.
   */
  static registerRouteResourceType(RouteClass) {
    this.ResourceRouteType = RouteClass
  }

  /**
   * Routes.
   * @type {Array<VelociousBaseRoute>} */
  routes = []

  /**
   * Mounts.
   * @type {Array<{mountable: {mountInto: (args: object) => void}, options: Record<string, ?>}>} */
  mounts = []

  constructor() {
    // Nothing
  }

  /**
   * Runs get mounts.
   * @returns {Array<{mountable: {mountInto: (args: object) => void}, options: Record<string, ?>}>} - Mounts declared on this route.
   */
  getMounts() { return this.mounts }

  /**
   * Runs get.
   * @abstract
   * @param {string} name - Name.
   */
  get(name) { throw new Error("'get' not implemented") } // eslint-disable-line no-unused-vars

  /**
   * Runs get human paths.
   * @abstract
   * @returns {Array<{action: string | null, method: string, path: string}>} - Route definitions for this resource.
   */
  getHumanPaths() { throw new Error(`'getHumanPaths' not implemented for ${this.constructor.name}`) }

  /**
   * Runs get sub routes.
   * @returns {Array<VelociousBaseRoute>} - The sub routes.
   */
  getSubRoutes() { return this.routes }

  /**
   * Runs match with path.
   * @param {object} args - Options object.
   * @param {Record<string, ?>} args.params - Parameters object.
   * @param {string} args.path - Path.
   * @param {import("../http-server/client/request.js").default | import("../http-server/client/websocket-request.js").default} args.request - Request object.
   * @returns {{restPath: string} | undefined} - REST path metadata for this route.
   */
  matchWithPath({params, path, request}) { // eslint-disable-line no-unused-vars
    throw new Error(`No 'matchWithPath' implemented on ${this.constructor.name}`)
  }

  /**
   * Runs namespace.
   * @abstract
   * @param {string} name - Name.
   * @param {function(import("./namespace-route.js").default) : void} callback - Callback function.
   * @returns {void} - No return value.
   */
  namespace(name, callback) { throw new Error("'namespace' not implemented") } // eslint-disable-line no-unused-vars

  /**
   * Runs post.
   * @abstract
   * @param {string} name - Name.
   * @returns {void} - No return value.
   */
  post(name) { throw new Error("'post' not implemented") } // eslint-disable-line no-unused-vars

  /**
   * Runs resources.
   * @abstract
   * @param {string} name - Name.
   * @param {function(import("./resource-route.js").default) : void} callback - Callback function.
   * @returns {void} - No return value.
   */
  resources(name, callback) { throw new Error("'resources' not implemented") } // eslint-disable-line no-unused-vars
}
