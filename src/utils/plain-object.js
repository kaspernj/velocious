// @ts-check

/**
 * Detect plain object literals without accepting arrays or class instances.
 * @param {?} value - Candidate value.
 * @returns {value is Record<string, ?>} - Whether value is a plain object.
 */
export default function isPlainObject(value) {
  if (Object.prototype.toString.call(value) !== "[object Object]") return false

  const prototype = Object.getPrototypeOf(value)

  return prototype === Object.prototype || prototype === null
}
