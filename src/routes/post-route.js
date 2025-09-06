import BaseRoute, {initBaseRoute} from "./base-route.js"
import escapeStringRegexp from "escape-string-regexp"

initBaseRoute()

export default class VelociousRoutePostRoute extends BaseRoute {
  constructor({name}) {
    super()
    this.name = name
    this.regExp = new RegExp(`^(${escapeStringRegexp(name)})(.*)$`)
  }

  matchWithPath({params, path}) {
    const match = path.match(this.regExp)

    if (match) {
      const [_beginnigSlash, _matchedName, restPath] = match

      params.action = this.name

      return {restPath}
    }
  }
}
