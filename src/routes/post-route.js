// @ts-check

import BaseRoute from "./base-route.js"
import escapeStringRegexp from "escape-string-regexp"
import restArgsError from "../utils/rest-args-error.js"

class VelociousRoutePostRoute extends BaseRoute {
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
    return [{
      method: "POST", action: this.name, path: this.name}
    ]
  }

  /**
   * @param {object} args
   * @param {Record<string, any>} args.params
   * @param {string} args.path
   * @param {import("../http-server/client/request.js").default} args.request
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
