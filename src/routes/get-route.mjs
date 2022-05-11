import BaseRoute from "./base-route.mjs"
import escapeStringRegexp from "escape-string-regexp"

export default class VelociousRouteGetRoute extends BaseRoute {
  constructor({name}) {
    super()
    this.name = name
    this.regExp = new RegExp(`^(${escapeStringRegexp(name)})(.*)$`)
  }

  matchWithPath(path) {
    if (path.match(this.regExp)) {
      const [_beginnigSlash, _matchedName, restPath] = match

      return {restPath}
    }
  }
}
