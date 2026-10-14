// @ts-check

import restArgsError from "../utils/rest-args-error.js"

/**
 * Catch-all route options.
 * @typedef {object} CatchAllRouteOptions
 * @property {string} [controller] - Controller name unmatched requests resolve to.
 * @property {string} [action] - Action name unmatched requests resolve to.
 */

/**
 * Application-declared catch-all route created with `route.catchAll(...)` in
 * the routes file. It is not a path matcher: the resolver applies it only
 * when no other route in the tree matched, replacing the built-in errors
 * not-found response with the application's own controller/action (for
 * example a JSON error envelope) without hand-wiring a route resolver hook.
 */
export default class VelociousRouteCatchAllRoute {
  /**
   * Controller name unmatched requests resolve to.
   * @type {string} */
  controller

  /**
   * Action name unmatched requests resolve to.
   * @type {string} */
  action

  /**
   * Runs constructor.
   * @param {CatchAllRouteOptions} [options] - Catch-all options.
   */
  constructor({controller = "_root", action = "notFound", ...restArgs} = {}) {
    restArgsError(restArgs)

    if (typeof controller !== "string" || controller.length < 1) {
      throw new Error(`Expected catch-all 'controller' to be a non-empty string, got: ${String(controller)}`)
    }

    if (typeof action !== "string" || action.length < 1) {
      throw new Error(`Expected catch-all 'action' to be a non-empty string, got: ${String(action)}`)
    }

    this.controller = controller
    this.action = action
  }

  /**
   * Runs get human paths.
   * @returns {Array<{action: string | null, method: string, path: string}>} - Route definitions for this route.
   */
  getHumanPaths() {
    return [
      {method: "ANY", action: this.action, path: "*"}
    ]
  }
}
