import BaseRoute, {initBaseRoute} from "./base-route.js"
import escapeStringRegexp from "escape-string-regexp"
import restArgsError from "../utils/rest-args-error.js"

initBaseRoute()

export default class VelociousRouteResourceRoute extends BaseRoute {
  constructor({name, ...restArgs}) {
    super()
    restArgsError(restArgs)
    this.name = name
    this.regExp = new RegExp(`^(${escapeStringRegexp(name)})(.*)$`)
  }

  matchWithPath({params, path, request}) {
    const match = path.match(this.regExp)

    if (match) {
      const [_beginnigSlash, _matchedName, restPath] = match // eslint-disable-line no-unused-vars

      let action = "index"
      let subRoutesMatchesRestPath = false

      for (const route of this.routes) {
        if (route.matchWithPath({path: restPath})) {
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
