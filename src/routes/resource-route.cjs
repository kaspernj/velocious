const BaseRoute = require("./base-route.cjs")

module.exports = class VelociousRouteResourceRoute extends BaseRoute {
  constructor({name}) {
    super()
    this.name = name
  }
}
