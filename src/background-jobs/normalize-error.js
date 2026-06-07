// @ts-check

/**
 * @param {unknown} error - Error input.
 * @returns {string} - Normalized error string.
 */
export default function normalizeBackgroundJobError(error) {
  if (error instanceof Error) return error.stack || error.message
  if (typeof error === "string") return error

  return stringifyUnknownError(error)
}

/**
 * @param {unknown} error - Error input.
 * @returns {string} - Stringified error.
 */
function stringifyUnknownError(error) {
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}
