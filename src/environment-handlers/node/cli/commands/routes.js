import * as inflection from "inflection"

import Application from "../../../../application.js"
import BaseCommand from "../../../../cli/base-command.js"

export default class VelociousCliCommandsServer extends BaseCommand{
  output = ""

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
   * @param {import("../../../../routes/base-route.js").default} route
   * @returns {void}
   */
  printRoutes(route, level = 0) {
    const prefix = "  ".repeat(level)

    for (const routeData of route.getHumanPaths()) {
      this.log(`${prefix}${routeData.method} ${routeData.path}${routeData.action ? ` -> ${inflection.camelize(routeData.action.replaceAll("-", "_"), true)}` : ""}`)
    }

    for (const subRoute of route.getSubRoutes()) {
      this.printRoutes(subRoute, level + 1)
    }
  }

  log(content) {
    if (this.cli.getTesting()) {
      this.output += `${content}\n`
    } else {
      console.log(content)
    }
  }
}
