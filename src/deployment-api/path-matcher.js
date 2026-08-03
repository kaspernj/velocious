// @ts-check

import {mountSubPath} from "../utils/mount-prefix.js"

/**
 * @typedef {object} DeploymentApiMatch
 * @property {string} action - Controller action to run.
 * @property {Record<string, string>} params - Extra params extracted from the path.
 */

/**
 * Matches an incoming request against the deployment API routes that live
 * under the mount prefix. Returns the controller action plus any extracted
 * params, or null when the path/method isn't part of the deployment API.
 * @param {object} args - Options.
 * @param {string} args.prefix - Normalized mount prefix.
 * @param {string} args.path - Request path without query string.
 * @param {string} args.method - HTTP method.
 * @returns {DeploymentApiMatch | null} - Matched action or null.
 */
export function matchDeploymentApiPath({prefix, path, method}) {
  const subPath = mountSubPath({prefix, path})

  if (subPath === null) return null

  if (method === "POST" && subPath === "/runs") return {action: "create", params: {}}

  if (method === "GET") {
    const runMatch = subPath.match(/^\/runs\/([^/]+)$/)

    if (runMatch) {
      let id

      try {
        id = decodeURIComponent(runMatch[1])
      } catch {
        return null
      }

      return {action: "show", params: {id}}
    }
  }

  return null
}
