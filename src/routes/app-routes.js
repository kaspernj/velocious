import {digg} from "diggerize"

export default class VelociousRoutesAppRoutes {
  static async getRoutes(configuration) {
    // Every client need to make their own routes because they probably can't be shared across different worker threads
    const routesImport = await import(`${configuration.getDirectory()}/src/config/routes.js`)

    return digg(routesImport, "default", "routes")
  }
}
