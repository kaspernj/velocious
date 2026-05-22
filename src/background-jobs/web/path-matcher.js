// @ts-check

/**
 * @typedef {object} JobsApiMatch
 * @property {string} action - Controller action to run.
 * @property {Record<string, string>} params - Extra params extracted from the path.
 */

/**
 * Normalizes a mount prefix: ensures a leading slash and strips any trailing
 * slash so `/velocious/jobs/` and `/velocious/jobs` behave identically.
 * @param {string} at - Raw mount prefix.
 * @returns {string} - Normalized prefix.
 */
export function normalizeMountPrefix(at) {
  if (typeof at !== "string" || !at.startsWith("/")) {
    throw new Error(`mount requires an 'at' path starting with '/', got: ${String(at)}`)
  }

  if (at.length > 1 && at.endsWith("/")) {
    return at.slice(0, -1)
  }

  return at
}

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
  if (path !== prefix && !path.startsWith(`${prefix}/`)) return null

  const subPath = path.slice(prefix.length) || "/"

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
