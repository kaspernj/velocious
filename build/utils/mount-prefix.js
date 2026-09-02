// @ts-check

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
 * Extracts the request sub-path under a normalized mount prefix, or null when
 * the path is outside the mount. A root mount (`/`) treats the whole path as
 * the sub-path.
 * @param {object} args - Options.
 * @param {string} args.prefix - Normalized mount prefix.
 * @param {string} args.path - Request path without query string.
 * @returns {string | null} - Sub-path ("/" for the bare prefix) or null.
 */
export function mountSubPath({prefix, path}) {
  if (prefix === "/") return path
  if (path === prefix) return "/"
  if (path.startsWith(`${prefix}/`)) return path.slice(prefix.length)

  return null
}
