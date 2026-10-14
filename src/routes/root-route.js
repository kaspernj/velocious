// @ts-check

import BasicRoute from "./basic-route.js"
import CatchAllRoute from "./catch-all-route.js"

export default class VelociousRootRoute extends BasicRoute {
  /**
   * Application catch-all route declared with `route.catchAll(...)`, or null
   * when the application did not declare one.
   * @type {CatchAllRoute | null} */
  catchAllRoute = null

  /**
   * Runs catch all. Declares the application's catch-all route: unmatched
   * requests resolve to the given controller/action instead of the built-in
   * errors not-found response.
   * @param {import("./catch-all-route.js").CatchAllRouteOptions} [options] - Catch-all options.
   * @returns {void} - No return value.
   */
  catchAll(options = {}) {
    if (this.catchAllRoute) throw new Error("Only one catchAll route can be declared")

    this.catchAllRoute = new CatchAllRoute(options)
  }

  getHumanPaths() {
    /** @type {Array<{action: string | null, method: string, path: string}>} */
    const humanPaths = [
      {method: "GET", action: "index", path: "/"}
    ]

    if (this.catchAllRoute) humanPaths.push(...this.catchAllRoute.getHumanPaths())

    return humanPaths
  }
}
