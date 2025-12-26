// @ts-check

import GetRoute from "./get-route.js" // eslint-disable-line no-unused-vars
import NameSpaceRoute from "./namespace-route.js" // eslint-disable-line no-unused-vars
import PostRoute from "./post-route.js" // eslint-disable-line no-unused-vars
import RootRoute from "./root-route.js"
import ResourceRoute from "./resource-route.js" // eslint-disable-line no-unused-vars

export default class VelociousRoutes {
  rootRoute = new RootRoute()

  /**
   * @param {function(import("./root-route.js").default) : void} callback
   * @returns {void} - Result.
   */
  draw(callback) {
    callback(this.rootRoute)
  }
}
