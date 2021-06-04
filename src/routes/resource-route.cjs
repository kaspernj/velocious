const BaseRoute = require("./base-route.cjs")
const escapeStringRegexp = require("escape-string-regexp")

module.exports = class VelociousRouteResourceRoute extends BaseRoute {
  constructor({name}) {
    super()
    this.name = name
    this.regExp = new RegExp(`^(${escapeStringRegexp(name)})(.*)$`)
  }

  matchWithPath({params, path}) {
    const match = path.match(this.regExp)

    if (match) {
      const [_beginnigSlash, _matchedName, restPath] = match

      let action = "index"
      let subRoutesMatchesRestPath = false

      for (const route of this.routes) {
        if (route.matchWithPath(restPath)) {
          subRoutesMatchesRestPath = true
        }
      }

      if (!subRoutesMatchesRestPath) {
        if (restPath.match(/\/(.+)/)) {
          // TODO: This should change the action to "show" and set the "resource_name_id" in params.
          action = "show"
        }
      }

      params.action = action
      params.controller = this.name

      return {restPath}
    }
  }
}
