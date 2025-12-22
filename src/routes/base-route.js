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

  /** @param {typeof import("./get-route.js").default} RouteClass */
  static registerRouteGetType(RouteClass) {
    this.GetRouteType = RouteClass
  }

  /** @param {typeof import("./namespace-route.js").default} RouteClass */
  static registerRouteNamespaceType(RouteClass) {
    this.NameSpaceRouteType = RouteClass
  }

  /** @param {typeof import("./post-route.js").default} RouteClass */
  static registerRoutePostType(RouteClass) {
    this.PostRouteType = RouteClass
  }

  /** @param {typeof import("./resource-route.js").default} RouteClass */
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
   * @param {string} name
   */
  get(name) { throw new Error("'get' not implemented") } // eslint-disable-line no-unused-vars

  /**
   * @abstract
   * @returns {Array<{action: string, method: string, path: string}>}
   */
  getHumanPaths() { throw new Error(`'getHumanPaths' not implemented for ${this.constructor.name}`) }

  /** @returns {Array<VelociousBaseRoute>} */
  getSubRoutes() { return this.routes }

  /**
   * @param {object} args
   * @param {Record<string, any>} args.params
   * @param {string} args.path
   * @param {import("../http-server/client/request.js").default} args.request
   * @returns {{restPath: string} | undefined}
   */
  matchWithPath({params, path, request}) { // eslint-disable-line no-unused-vars
    throw new Error(`No 'matchWithPath' implemented on ${this.constructor.name}`)
  }

  /**
   * @abstract
   * @param {string} name
   * @param {function(import("./namespace-route.js").default) : void} callback
   * @returns {void}
   */
  namespace(name, callback) { throw new Error("'namespace' not implemented") } // eslint-disable-line no-unused-vars

  /**
   * @abstract
   * @param {string} name
   * @returns {void}
   */
  post(name) { throw new Error("'post' not implemented") } // eslint-disable-line no-unused-vars

  /**
   * @abstract
   * @param {string} name
   * @param {function(import("./resource-route.js").default) : void} callback
   * @returns {void}
   */
  resources(name, callback) { throw new Error("'resources' not implemented") } // eslint-disable-line no-unused-vars
}
