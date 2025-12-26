// @ts-check

import restArgsError from "../utils/rest-args-error.js"
import BaseRoute from "./base-route.js"
import BasicRoute from "./basic-route.js"
import escapeStringRegexp from "escape-string-regexp"

class VelociousRouteNamespaceRoute extends BasicRoute {
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
      {method: "GET", action: null, path: this.name}
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

      params.controller = this.name

      return {restPath}
    }
  }
}

BaseRoute.registerRouteNamespaceType(VelociousRouteNamespaceRoute)

export default VelociousRouteNamespaceRoute
