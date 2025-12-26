// @ts-check

import escapeStringRegexp from "escape-string-regexp"

import BaseRoute from "./base-route.js"
import restArgsError from "../utils/rest-args-error.js"

class VelociousRouteGetRoute extends BaseRoute {
  /**
   * @param {object} args - Options object.
   * @param {string} args.name - Name.
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
   * @param {object} args - Options object.
   * @param {Record<string, any>} args.params - Parameters object.
   * @param {string} args.path - Path.
   * @param {import("../http-server/client/request.js").default} args.request - Request object.
   * @returns {{restPath: string} | undefined} - REST path metadata for this route.
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
