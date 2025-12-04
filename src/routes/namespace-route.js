import restArgsError from "../utils/rest-args-error.js"
import BaseRoute, {initBaseRoute} from "./base-route.js"
import escapeStringRegexp from "escape-string-regexp"

initBaseRoute()

export default class VelociousRouteNamespaceRoute extends BaseRoute {
  constructor({name, ...restArgs}) {
    super()
    restArgsError(restArgs)
    this.name = name
    this.regExp = new RegExp(`^(${escapeStringRegexp(name)})(.*)$`)
  }

  matchWithPath({params, path}) {
    const match = path.match(this.regExp)

    if (match) {
      const [_beginnigSlash, _matchedName, restPath] = match // eslint-disable-line no-unused-vars

      params.controller = this.name

      return {restPath}
    }
  }
}
