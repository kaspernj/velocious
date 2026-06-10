// @ts-check

import GetRoute from "./get-route.js" // eslint-disable-line no-unused-vars
import NameSpaceRoute from "./namespace-route.js" // eslint-disable-line no-unused-vars
import PostRoute from "./post-route.js" // eslint-disable-line no-unused-vars
import RootRoute from "./root-route.js"
import ResourceRoute from "./resource-route.js" // eslint-disable-line no-unused-vars

export default class VelociousRoutes {
  rootRoute = new RootRoute()

  /**
   * Runs draw.
   * @param {function(import("./root-route.js").default) : void} callback - Callback function.
   * @returns {void} - No return value.
   */
  draw(callback) {
    callback(this.rootRoute)
  }

  /**
   * Collects all `route.mount(...)` registrations across the route tree so the
   * configuration can apply them when the routes are set.
   * @returns {Array<{mountable: {mountInto: (args: object) => void}, options: Record<string, ?>}>} - Declared mounts.
   */
  getMounts() {
    /**
     * Collected.
      @type {Array<{mountable: {mountInto: (args: object) => void}, options: Record<string, ?>}>} */
    const collected = []

    /**
     * Visit.
     * @param {import("./base-route.js").default} route - Route to visit.
     */
    const visit = (route) => {
      if (typeof route.getMounts === "function") {
        collected.push(...route.getMounts())
      }

      for (const subRoute of route.getSubRoutes()) {
        visit(subRoute)
      }
    }

    visit(this.rootRoute)

    return collected
  }
}
