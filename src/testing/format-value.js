// @ts-check

const MAX_STRINGIFY_DEPTH = 5

/**
 * @param {any} value - Value to use.
 * @returns {boolean} - Whether plain object.
 */
function isPlainObject(value) {
  if (!value || typeof value != "object") return false

  const prototype = Object.getPrototypeOf(value)

  return prototype === Object.prototype || prototype === null
}

/**
 * Minified stringify with circular and depth protection.
 * @param {any} value - Value to use.
 * @returns {string} - The minified stringify.
 */
function minifiedStringify(value) {
  const seen = new WeakSet()

  /**
   * @param {any} current - Current.
   * @param {number} depth - Depth.
   * @returns {any} - The serialize.
   */
  function serialize(current, depth) {
    if (depth > MAX_STRINGIFY_DEPTH) return "[MaxDepth]"
    if (!current || typeof current != "object") return current

    if (seen.has(current)) return "[Circular]"

    if (!isPlainObject(current) && !Array.isArray(current)) {
      return current.constructor?.name || Object.prototype.toString.call(current)
    }

    seen.add(current)

    if (Array.isArray(current)) {
      return current.map(value => serialize(value, depth + 1))
    }

    /** @type {Record<string, any>} */
    const output = {}

    for (const key of Object.keys(current)) {
      output[key] = serialize(current[key], depth + 1)
    }

    return output
  }

  try {
    return JSON.stringify(serialize(value, 0))
  } catch {
    return String(value)
  }
}

/**
 * @param {any} value - Value to use.
 * @returns {string} - The value.
 */
function formatValue(value) {
  if (value === undefined) return "undefined"
  if (value === null) return "null"
  if (typeof value == "string") return value
  if (typeof value == "number" || typeof value == "boolean" || typeof value == "bigint") return String(value)
  if (typeof value == "symbol") return value.toString()
  if (typeof value == "function") return value.name || "function"

  if (Array.isArray(value) || isPlainObject(value)) {
    return minifiedStringify(value)
  }

  if (value && typeof value == "object") {
    const constructorName = value.constructor?.name

    if (constructorName) return constructorName
  }

  return String(value)
}

export {formatValue, minifiedStringify}
