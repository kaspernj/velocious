/**
 * @typedef {object} AddRouteOptions
 * @property {Record<string, any>} [params] - Static params to merge for matched route.
 * @property {[typeof import("../controller.js").default, string]} to - Controller class and action tuple.
 * @property {string} [viewPath] - Optional view path for controllers using renderView().
 */

/** Lightweight plugin route DSL for route-hook backed endpoints. */
export default class PluginRoutes {
  /**
   * @param {object} args - Options object.
   * @param {import("../configuration.js").default} args.configuration - Configuration instance.
   */
  constructor(args) {
    const {configuration} = args

    if (!configuration) throw new Error("No configuration given")

    this.configuration = configuration
  }

  /**
   * @param {string} routePath - Route path.
   * @param {AddRouteOptions} options - Route options.
   * @returns {void} - No return value.
   */
  get(routePath, options) {
    this.addRoute("GET", routePath, options)
  }

  /**
   * @param {string} routePath - Route path.
   * @param {AddRouteOptions} options - Route options.
   * @returns {void} - No return value.
   */
  post(routePath, options) {
    this.addRoute("POST", routePath, options)
  }

  /**
   * @param {"GET" | "POST"} method - HTTP method.
   * @param {string} routePath - Route path.
   * @param {AddRouteOptions} options - Route options.
   * @returns {void} - No return value.
   */
  addRoute(method, routePath, options) {
    if (typeof routePath !== "string" || !routePath.startsWith("/")) {
      throw new Error(`Expected route path to be a string starting with '/', got: ${String(routePath)}`)
    }

    const to = options?.to
    const staticParams = options?.params
    const viewPath = options?.viewPath
    const controllerClass = to?.[0]
    const action = to?.[1]

    if (typeof action !== "string" || action.length < 1) {
      throw new Error(`Expected route action to be a non-empty string, got: ${String(action)}`)
    }

    if (typeof controllerClass !== "function") {
      throw new Error(`Expected route controller class in 'to: [ControllerClass, action]', got: ${String(controllerClass)}`)
    }

    const controllerName = typeof controllerClass.name === "string" && controllerClass.name.length > 0
      ? controllerClass.name
      : "pluginController"

    if (viewPath !== undefined && typeof viewPath !== "string") {
      throw new Error(`Expected route viewPath to be a string when provided, got: ${String(viewPath)}`)
    }

    this.configuration.addRouteResolverHook(({currentPath, request}) => {
      if (request.httpMethod() !== method) return null
      const matchedParams = this.matchPath(routePath, currentPath)

      if (!matchedParams) return null

      return {
        action,
        controller: controllerName,
        controllerClass,
        params: {
          ...(staticParams || {}),
          ...matchedParams
        },
        viewPath: viewPath || `${this.configuration.getDirectory()}/src/routes`
      }
    })
  }

  /**
   * @param {string} routePath - Route pattern.
   * @param {string} currentPath - Current request path.
   * @returns {Record<string, string> | null} - Matched params or null.
   */
  matchPath(routePath, currentPath) {
    const routeSegments = routePath.replace(/^\/+|\/+$/g, "").split("/")
    const currentSegments = currentPath.replace(/^\/+|\/+$/g, "").split("/")

    if (routePath === "/") {
      return currentPath === "/" ? {} : null
    }

    if (routeSegments.length !== currentSegments.length) return null

    /** @type {Record<string, string>} */
    const params = {}

    for (let index = 0; index < routeSegments.length; index += 1) {
      const routeSegment = routeSegments[index]
      const currentSegment = currentSegments[index]

      if (routeSegment.startsWith(":")) {
        const key = routeSegment.slice(1)

        if (!key) return null

        try {
          params[key] = decodeURIComponent(currentSegment)
        } catch {
          return null
        }

        continue
      }

      if (routeSegment !== currentSegment) return null
    }

    return params
  }
}
