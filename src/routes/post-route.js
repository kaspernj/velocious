// @ts-check

import BaseRoute from "./base-route.js"
import escapeStringRegexp from "escape-string-regexp"
import restArgsError from "../utils/rest-args-error.js"

class VelociousRoutePostRoute extends BaseRoute {
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
    return [{
      method: "POST", action: this.name, path: this.name}
    ]
  }

  /**
   * @param {object} args - Options object.
   * @param {Record<string, unknown>} args.params - Parameters object.
   * @param {string} args.path - Path.
   * @param {import("../http-server/client/request.js").default | import("../http-server/client/websocket-request.js").default} args.request - Request object.
   * @returns {{restPath: string} | undefined} - REST path metadata for this route.
   */
  matchWithPath({params, path, request}) { // eslint-disable-line no-unused-vars
    const match = path.match(this.regExp)

    if (match) {
      const [_beginnigSlash, _matchedName, restPath] = match // eslint-disable-line no-unused-vars

      params.action = this.name

      return {restPath}
    }
  }
}

BaseRoute.registerRoutePostType(VelociousRoutePostRoute)

export default VelociousRoutePostRoute
