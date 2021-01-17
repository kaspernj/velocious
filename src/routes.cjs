const Route = require("./route.cjs")

module.exports = class VelociousRoutes {
  constructor() {
    this.routes = []
  }

  get(path, args) {
    const route = new Route({path, args})

    this.routes = route
  }
}
