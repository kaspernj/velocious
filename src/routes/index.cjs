const RootRoute = require("./root-route.cjs")

module.exports = class VelociousRoutes {
  rootRoute = new RootRoute()

  draw(callback) {
    callback(this.rootRoute)
  }
}
