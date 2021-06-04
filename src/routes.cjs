const Route = require("./route.cjs")

module.exports = class VelociousRoutes {
  constructor() {
    this.routes = []
  }

  draw(callback) {
    callback(this)
  }

  get(path, args) {
    const route = new Route({path, args})

    this.routes = route
  }

  resources(name, callback) {
    if (callback) {
      callback()
    }
  }
}
