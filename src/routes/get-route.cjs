const BaseRoute = require("./base-route.cjs")
const escapeStringRegexp = require("escape-string-regexp")

module.exports = class VelociousRouteGetRoute extends BaseRoute {
  constructor({name}) {
    super()
    this.name = name
    this.regExp = new RegExp(`^(${escapeStringRegexp(name)})(.*)$`)
  }

  matchWithPath(path) {
    if (path.match(this.regExp)) {
      const [_beginnigSlash, _matchedName, restPath] = match

      return {restPath}
    }
  }
}
