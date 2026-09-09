// @ts-check

import {mountSubPath, normalizeMountPrefix} from "../../utils/mount-prefix.js"

/**
 * @typedef {object} JobsApiMatch
 * @property {string} action - Controller action to run.
 * @property {Record<string, string>} params - Extra params extracted from the path.
 */
export {normalizeMountPrefix}

/**
 * Matches an incoming request against the read-only jobs API routes that live
 * under the mount prefix. Returns the controller action plus any extracted
 * params, or null when the path/method isn't part of the jobs API.
 * @param {object} args - Options.
 * @param {string} args.prefix - Normalized mount prefix.
 * @param {string} args.path - Request path without query string.
 * @param {string} args.method - HTTP method.
 * @returns {JobsApiMatch | null} - Matched action or null.
 */
export function matchJobsApiPath({prefix, path, method}) {
  const subPath = mountSubPath({prefix, path})

  if (subPath === null) return null

  if (method === "GET" && subPath === "/api/health") return {action: "health", params: {}}
  if (method === "GET" && subPath === "/api/stats") return {action: "stats", params: {}}
  if (method === "GET" && subPath === "/api/schedule") return {action: "schedule", params: {}}
  if (method === "GET" && subPath === "/api/jobs") return {action: "index", params: {}}

  if (method === "GET") {
    const jobMatch = subPath.match(/^\/api\/jobs\/([^/]+)$/)

    if (jobMatch) {
      let id

      try {
        id = decodeURIComponent(jobMatch[1])
      } catch {
        return null
      }

      return {action: "show", params: {id}}
    }
  }

  return null
}
