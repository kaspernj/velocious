// @ts-check

import BaseRoute from "./base-route.js"
import BasicRoute from "./basic-route.js"
import escapeStringRegexp from "escape-string-regexp"
import * as inflection from "inflection"
import restArgsError from "../utils/rest-args-error.js"
import singularizeModelName from "../utils/singularize-model-name.js"

class VelociousRouteResourceRoute extends BasicRoute {
  /**
   * @param {object} args - Options object.
   * @param {string} args.name - Name.
   */
  constructor({name, ...restArgs}) {
    super()
    restArgsError(restArgs)
    this.name = name
    this.regExp = new RegExp(`^(${escapeStringRegexp(name)})(.*)$`)
    /** @type {Set<string>} */
    this.collectionRouteNames = new Set()
  }

  /**
   * @param {string} name - Name.
   * @param {{on?: "member" | "collection"}} [options] - Route options for scope.
   */
  get(name, options = {}) {
    const {on, ...restArgs} = options || {}

    restArgsError(restArgs)

    if (on && on !== "member" && on !== "collection") {
      throw new Error(`Unknown 'on' value: ${on}`)
    }

    if (on === "collection") {
      this.collectionRouteNames.add(name)
    }

    super.get(name)
  }

  /**
   * @param {string} name - Name.
   * @param {{on?: "member" | "collection"}} [options] - Route options for scope.
   */
  post(name, options = {}) {
    const {on, ...restArgs} = options || {}

    restArgsError(restArgs)

    if (on && on !== "member" && on !== "collection") {
      throw new Error(`Unknown 'on' value: ${on}`)
    }

    if (on === "collection") {
      this.collectionRouteNames.add(name)
    }

    super.post(name)
  }

  getHumanPaths() {
    return [
      {method: "GET", action: "index", path: this.name},
      {method: "POST", action: "create", path: this.name},
      {method: "GET", action: "show", path: `${this.name}/\${id}`},
      {method: "DELETE", action: "destroy", path: `${this.name}/\${id}`}
    ]
  }

  /**
   * @param {object} args - Options object.
   * @param {Record<string, any>} args.params - Parameters object.
   * @param {string} args.path - Path.
   * @param {import("../http-server/client/request.js").default | import("../http-server/client/websocket-request.js").default} args.request - Request object.
   * @returns {{restPath: string} | undefined} - REST path metadata for this route.
   */
  matchWithPath({params, path, request}) {
    const match = path.match(this.regExp)

    if (match) {
      const [_beginnigSlash, _matchedName, restPath] = match // eslint-disable-line no-unused-vars

      let action
      const controllerName = params.controller ? `${params.controller}/${this.name}` : this.name
      const normalizedRestPath = restPath.replace(/^\//, "")
      let nextRestPath = normalizedRestPath

      params.controller = controllerName

      if (normalizedRestPath.length === 0) {
        if (request.httpMethod() == "DELETE") {
          action = "delete"
        } else if (request.httpMethod() == "POST") {
          action = "create"
        } else {
          action = "index"
        }
        nextRestPath = ""
      } else {
        const [collectionCandidate] = normalizedRestPath.split("/")

        if (this.collectionRouteNames.has(collectionCandidate)) {
          nextRestPath = normalizedRestPath
        } else {
          const idMatch = normalizedRestPath.match(/^([^/?]+)(?:\?[^/]*)?(?:\/(.*))?$/)

          if (idMatch) {
            const singularName = singularizeModelName(this.name)
            const singularAttributeName = inflection.camelize(inflection.underscore(singularName), true)
            const idVarName = `${singularAttributeName}Id`
            const recordId = idMatch[1]
            const remainingPath = idMatch[2]

            params[idVarName] = recordId
            params.id = recordId

            if (remainingPath && remainingPath.length > 0) {
              nextRestPath = remainingPath
            } else if (request.httpMethod() == "DELETE") {
              action = "delete"
              nextRestPath = ""
            } else if (request.httpMethod() == "POST") {
              action = "create"
              nextRestPath = ""
            } else {
              action = "show"
              nextRestPath = ""
            }
          }
        }
      }

      if (action) {
        params.action = action
      }

      return {restPath: nextRestPath}
    }
  }
}

BaseRoute.registerRouteResourceType(VelociousRouteResourceRoute)

export default VelociousRouteResourceRoute

