import * as inflection from "inflection"

import Application from "../../../../application.js"
import BaseCommand from "../../../../cli/base-command.js"

export default class VelociousCliCommandsServer extends BaseCommand{
  output = ""

  /**
   * @param {string} actionName - Raw route action name.
   * @returns {string} - Normalized method name.
   */
  normalizeActionName(actionName) {
    return inflection.camelize(actionName.replaceAll("-", "_").replaceAll("/", "_"), true)
  }

  async execute() {
    const application = new Application({
      configuration: this.getConfiguration(),
      type: "server"
    })
    await application.initialize()
    const routes = this.getConfiguration().getRoutes()

    this.printRoutes(routes.rootRoute)

    return {output: this.output}
  }

  /**
   * @param {import("../../../../routes/base-route.js").default} route - Route.
   * @param {number} [level] - Level.
   * @returns {void} - No return value.
   */
  printRoutes(route, level = 0) {
    const prefix = "  ".repeat(level)

    for (const routeData of route.getHumanPaths()) {
      this.log(`${prefix}${routeData.method} ${routeData.path}${routeData.action ? ` -> ${this.normalizeActionName(routeData.action)}` : ""}`)
    }

    for (const subRoute of route.getSubRoutes()) {
      this.printRoutes(subRoute, level + 1)
    }
  }

  /**
   * @param {string} content - Content.
   * @returns {void} - No return value.
   */
  log(content) {
    if (this.cli.getTesting()) {
      this.output += `${content}\n`
    } else {
      console.log(content)
    }
  }
}
