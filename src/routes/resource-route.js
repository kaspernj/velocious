// @ts-check

import BaseRoute from "./base-route.js"
import BasicRoute from "./basic-route.js"
import escapeStringRegexp from "escape-string-regexp"
import restArgsError from "../utils/rest-args-error.js"

class VelociousRouteResourceRoute extends BasicRoute {
  /**
   * @param {object} args
   * @param {string} args.name
   */
  constructor({name, ...restArgs}) {
    super()
    restArgsError(restArgs)
    this.name = name
    this.regExp = new RegExp(`^(${escapeStringRegexp(name)})(.*)$`)
  }

  /**
   * @param {object} args
   * @param {Record<string, any>} args.params
   * @param {string} args.path
   * @param {import("../http-server/client/request.js").default} args.request
   * @returns {{restPath: string} | undefined}
   */
  matchWithPath({params, path, request}) {
    const match = path.match(this.regExp)

    if (match) {
      const [_beginnigSlash, _matchedName, restPath] = match // eslint-disable-line no-unused-vars

      let action = "index"
      let subRoutesMatchesRestPath = false

      for (const route of this.routes) {
        if (route.matchWithPath({params, path: restPath, request})) {
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

BaseRoute.registerRouteResourceType(VelociousRouteResourceRoute)

export default VelociousRouteResourceRoute
