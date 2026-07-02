// @ts-check

/**
 * Serializes a JSON-compatible value with recursively sorted object keys, so
 * equal values always produce byte-identical strings (used for sync scope and
 * change-feed identity comparisons).
 * @param {?} value - JSON-compatible value.
 * @returns {string} - Stable JSON string.
 */
export default function stableJsonStringify(value) {
  return JSON.stringify(stableJsonValue(value))
}

/**
 * Produces a recursively key-sorted JSON value.
 * @param {?} value - JSON-compatible value.
 * @returns {?} - Stable JSON-compatible value.
 */
function stableJsonValue(value) {
  if (Array.isArray(value)) return value.map((item) => stableJsonValue(item))
  if (!value || typeof value !== "object") return value

  return Object.keys(value).sort().reduce((memo, key) => {
    memo[key] = stableJsonValue(value[key])

    return memo
  }, /** @type {Record<string, ?>} */ ({}))
}
