// @ts-check

import {anythingDifferent} from "set-state-compare/build/diff-utils.js"

/**
 * Runs object containing.
 * @param {ReturnType<typeof JSON.parse>} value - Value.
 * @returns {{__velociousMatcher: string, value: ReturnType<typeof JSON.parse>}} - Matcher wrapper.
 */
function objectContaining(value) {
  if (value === null || typeof value !== "object") {
    throw new Error(`Expected object but got ${typeof value}`)
  }

  return {
    __velociousMatcher: "objectContaining",
    value
  }
}

/**
 * Runs array containing.
 * @param {ReturnType<typeof JSON.parse>} value - Value.
 * @returns {{__velociousMatcher: string, value: ReturnType<typeof JSON.parse>}} - Matcher wrapper.
 */
function arrayContaining(value) {
  if (!Array.isArray(value)) {
    throw new Error(`Expected array but got ${typeof value}`)
  }

  return {
    __velociousMatcher: "arrayContaining",
    value
  }
}

/**
 * Runs is object like.
 * @param {ReturnType<typeof JSON.parse>} value - Value.
 * @returns {boolean} - Whether object-like.
 */
function isObjectLike(value) {
  return value !== null && typeof value === "object"
}

/**
 * Runs is array containing.
 * @param {ReturnType<typeof JSON.parse>} value - Value.
 * @returns {boolean} - Whether arrayContaining matcher.
 */
function isArrayContaining(value) {
  return !!value && typeof value === "object" && (/** @type {ReturnType<typeof JSON.parse>} */ (value)).__velociousMatcher === "arrayContaining"
}

/**
 * Runs is object containing.
 * @param {ReturnType<typeof JSON.parse>} value - Value.
 * @returns {boolean} - Whether objectContaining matcher.
 */
function isObjectContaining(value) {
  return !!value && typeof value === "object" && (/** @type {ReturnType<typeof JSON.parse>} */ (value)).__velociousMatcher === "objectContaining"
}

/**
 * Runs is plain object.
 * @param {ReturnType<typeof JSON.parse>} value - Value.
 * @returns {boolean} - Whether plain object.
 */
function isPlainObject(value) {
  if (!value || typeof value !== "object") return false

  const prototype = Object.getPrototypeOf(value)

  return prototype === Object.prototype || prototype === null
}

/**
 * Runs values equal.
 * @param {ReturnType<typeof JSON.parse>} actual - Actual value.
 * @param {ReturnType<typeof JSON.parse>} expected - Expected value.
 * @returns {boolean} - Whether values are equal.
 */
function valuesEqual(actual, expected) {
  if (actual instanceof Date && expected instanceof Date) {
    return actual.getTime() === expected.getTime()
  }

  if (actual instanceof RegExp && expected instanceof RegExp) {
    return actual.source === expected.source && actual.flags === expected.flags
  }

  return Object.is(actual, expected)
}

/**
 * Runs collect match differences.
 * @param {ReturnType<typeof JSON.parse>} actual - Actual value.
 * @param {ReturnType<typeof JSON.parse>} expected - Expected value.
 * @param {string} path - Path.
 * @param {Record<string, Array<ReturnType<typeof JSON.parse>>>} differences - Differences.
 * @returns {void} - No return value.
 */
function collectMatchDifferences(actual, expected, path, differences) {
  if (isObjectContaining(expected)) {
    collectMatchDifferences(actual, /** @type {ReturnType<typeof JSON.parse>} */ (expected).value, path, differences)
    return
  }

  if (isArrayContaining(expected)) {
    const {matches} = matchArrayContaining(actual, /** @type {Array<ReturnType<typeof JSON.parse>>} */ (/** @type {ReturnType<typeof JSON.parse>} */ (expected).value))

    if (!matches) {
      differences[path || "$"] = [expected, actual]
    }

    return
  }

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      differences[path || "$"] = [expected, actual]
      return
    }

    for (let i = 0; i < expected.length; i++) {
      const nextPath = `${path}[${i}]`
      collectMatchDifferences(actual[i], expected[i], nextPath, differences)
    }

    return
  }

  if (isPlainObject(expected)) {
    if (!isObjectLike(actual)) {
      differences[path || "$"] = [expected, actual]
      return
    }

    const expectedObject = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (expected)
    const actualObject = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (actual)

    for (const key of Object.keys(expectedObject)) {
      const nextPath = path ? `${path}.${key}` : key

      if (!Object.prototype.hasOwnProperty.call(actualObject, key)) {
        differences[nextPath] = [expectedObject[key], undefined]
        continue
      }

      collectMatchDifferences(actualObject[key], expectedObject[key], nextPath, differences)
    }

    return
  }

  if (!valuesEqual(actual, expected)) {
    differences[path || "$"] = [expected, actual]
  }
}

/**
 * Runs match object.
 * @param {ReturnType<typeof JSON.parse>} actual - Actual value.
 * @param {Record<string, ReturnType<typeof JSON.parse>> | Array<ReturnType<typeof JSON.parse>>} expected - Expected value.
 * @returns {{matches: boolean, differences: Record<string, Array<ReturnType<typeof JSON.parse>>>}} - Match result.
 */
function matchObject(actual, expected) {
  /**
   * Differences.
   * @type {Record<string, Array<ReturnType<typeof JSON.parse>>>} */
  const differences = {}

  collectMatchDifferences(actual, expected, "", differences)

  return {
    matches: Object.keys(differences).length === 0,
    differences
  }
}

/**
 * Runs match array containing.
 * @param {ReturnType<typeof JSON.parse>} actual - Actual value.
 * @param {Array<ReturnType<typeof JSON.parse>>} expected - Expected values.
 * @returns {{matches: boolean, differences: Record<string, Array<ReturnType<typeof JSON.parse>>>}} - Match result.
 */
function matchArrayContaining(actual, expected) {
  /**
   * Differences.
   * @type {Record<string, Array<ReturnType<typeof JSON.parse>>>} */
  const differences = {}

  if (!Array.isArray(actual)) {
    differences["$"] = [expected, actual]
    return {matches: false, differences}
  }

  const usedIndexes = new Set()

  for (const expectedItem of expected) {
    let matchedIndex = -1

    for (let i = 0; i < actual.length; i++) {
      if (usedIndexes.has(i)) continue

      if (isObjectContaining(expectedItem)) {
        const {matches} = matchObject(actual[i], /** @type {ReturnType<typeof JSON.parse>} */ (expectedItem).value)
        if (matches) {
          matchedIndex = i
          break
        }
        continue
      }

      if (isArrayContaining(expectedItem)) {
        const {matches} = matchArrayContaining(actual[i], /** @type {ReturnType<typeof JSON.parse>} */ (expectedItem).value)
        if (matches) {
          matchedIndex = i
          break
        }
        continue
      }

      if (!anythingDifferent(actual[i], expectedItem)) {
        matchedIndex = i
        break
      }
    }

    if (matchedIndex >= 0) {
      usedIndexes.add(matchedIndex)
    } else {
      differences["$"] = [expected, actual]
      break
    }
  }

  return {
    matches: Object.keys(differences).length === 0,
    differences
  }
}

export {
  arrayContaining,
  isArrayContaining,
  isObjectContaining,
  matchArrayContaining,
  matchObject,
  objectContaining
}
