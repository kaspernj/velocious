// @ts-check

import escapeStringRegexp from "escape-string-regexp"

import BaseRoute from "./base-route.js"
import restArgsError from "../utils/rest-args-error.js"

class VelociousRouteGetRoute extends BaseRoute {
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

  getHumanPaths() {
    return [
      {method: "GET", action: this.name, path: this.name}
    ]
  }

  /**
   * @param {object} args
   * @param {Record<string, any>} args.params
   * @param {string} args.path
   * @param {import("../http-server/client/request.js").default} args.request
   * @returns {{restPath: string} | undefined} - Result.
   */
  matchWithPath({params, path, request}) { // eslint-disable-line no-unused-vars
    const match = path.match(this.regExp)

    if (match) {
      const [_beginnigSlash, _matchedName, restPath] = match // eslint-disable-line no-unused-vars

      // Prevent partial prefix matches (e.g., "params" matching "params-with-query")
      if (restPath && !restPath.startsWith("/")) return

      params.action = this.name

      return {restPath}
    }
  }
}

BaseRoute.registerRouteGetType(VelociousRouteGetRoute)

export default VelociousRouteGetRoute
