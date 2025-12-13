// @ts-check

import {digg} from "diggerize"

export default class VelociousRoutesAppRoutes {
  /**
   * @param {import("../configuration.js").default} configuration
   * @returns {Promise<import("./index.js").default>}
   */
  static async getRoutes(configuration) {
    // Every client need to make their own routes because they probably can't be shared across different worker threads
    const routesImport = await configuration.getEnvironmentHandler().importApplicationRoutes()

    return digg(routesImport, "routes")
  }
}
