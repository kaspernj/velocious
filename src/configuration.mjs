export default class VelociousConfiguration {
  static current() {
    if (!global.velociousConfiguration) throw new Error("A Velocious configuration hasn't been set")

    return global.velociousConfiguration
  }

  constructor({debug, directory}) {
    if (!directory) throw new Error("No directory given")

    // Every client need to make their own routes because they probably can't be shared across different worker threads
    const {routes} = require(`${directory}/src/config/routes`)

    this.debug = debug
    this.directory = directory
    this.routes = routes
  }
}
