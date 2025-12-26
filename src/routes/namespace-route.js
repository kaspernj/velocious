// @ts-check

import restArgsError from "../utils/rest-args-error.js"
import BaseRoute from "./base-route.js"
import BasicRoute from "./basic-route.js"
import escapeStringRegexp from "escape-string-regexp"

class VelociousRouteNamespaceRoute extends BasicRoute {
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
      {method: "GET", action: null, path: this.name}
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

      params.controller = this.name

      return {restPath}
    }
  }
}

BaseRoute.registerRouteNamespaceType(VelociousRouteNamespaceRoute)

export default VelociousRouteNamespaceRoute
