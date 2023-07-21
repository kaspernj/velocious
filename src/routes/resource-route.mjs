import BaseRoute, {initBaseRoute} from "./base-route.mjs"
import escapeStringRegexp from "escape-string-regexp"

initBaseRoute()

export default class VelociousRouteResourceRoute extends BaseRoute {
  constructor({name}) {
    super()
    this.name = name
    this.regExp = new RegExp(`^(${escapeStringRegexp(name)})(.*)$`)
  }

  matchWithPath({params, path, request}) {
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
        if (request.httpMethod() == "POST") {
          action = "create"
        } else if (restPath.match(/\/(.+)/)) {
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
