const Routes = require("./routes/index.cjs")

module.exports = class VelociousConfiguration {
  constructor({debug, directory}) {
    if (!directory) throw new Error("No directory given")

    // Every client need to make their own routes because they probably can't be shared across different worker threads
    const {routes} = require(`${directory}/src/routes.cjs`)

    this.debug = debug
    this.directory = directory
    this.routes = routes
  }
}
