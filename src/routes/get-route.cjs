const BaseRoute = require("./base-route.cjs")

module.exports = class VelociousRouteGetRoute extends BaseRoute {
  constructor({name}) {
    super()
    this.name = name
  }
}
