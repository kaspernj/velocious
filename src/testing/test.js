// @ts-check

import {formatValue, minifiedStringify} from "./format-value.js"
import path from "path"
import {fileURLToPath} from "url"
import {anythingDifferent} from "set-state-compare/build/diff-utils.js"
import EventEmitter from "../utils/event-emitter.js"
import restArgsError from "../utils/rest-args-error.js"

/** @type {import("./test-runner.js").TestsArgument} */
const tests = {
  /** @type {import("./test-runner.js").AfterBeforeEachCallbackObjectType[]} */
  afterEaches: [],
  /** @type {import("./test-runner.js").BeforeAfterAllCallbackObjectType[]} */
  afterAlls: [],
  args: {},

  /** @type {import("./test-runner.js").BeforeAfterAllCallbackObjectType[]} */
  beforeAlls: [],
  /** @type {import("./test-runner.js").AfterBeforeEachCallbackObjectType[]} */
  beforeEaches: [],
  filePath: undefined,
  line: undefined,
  subs: {},
  tests: {}
}

const testEvents = new EventEmitter()

let currentPath = [tests]

/**
 * @returns {{filePath?: string, line?: number}} - Location.
 */
function captureLocation() {
  const error = new Error()
  const stack = typeof error.stack === "string" ? error.stack.split("\n") : []

  for (const line of stack) {
    const trimmed = line.trim()

    if (!trimmed.includes("at")) continue
    if (trimmed.includes("/src/testing/test.js")) continue

    const match = trimmed.match(/(?:\(|\s)(file:\/\/.*?|\/.*?):(\d+):(\d+)\)?$/)

    if (!match) continue

    const rawPath = match[1]
    const lineNumber = Number(match[2])
    const filePath = rawPath.startsWith("file://")
      ? fileURLToPath(rawPath)
      : rawPath

    return {
      filePath: path.resolve(filePath),
      line: Number.isFinite(lineNumber) ? lineNumber : undefined
    }
  }

  return {}
}

/**
 * @param {string[] | string | undefined} tags - Tags.
 * @returns {string[]} - Normalized tags.
 */
function normalizeTags(tags) {
  if (!tags) return []

  const values = []
  const rawTags = Array.isArray(tags) ? tags : [tags]

  for (const rawTag of rawTags) {
    if (rawTag === undefined || rawTag === null) continue

    const parts = String(rawTag).split(",")

    for (const part of parts) {
      const trimmed = part.trim()

      if (trimmed) values.push(trimmed)
    }
  }

  return Array.from(new Set(values))
}

const testConfig = {
  excludeTags: [],
  defaultTimeoutSeconds: 60
}

/**
 * @param {object} args - Options.
 * @param {string[] | string} [args.excludeTags] - Tags to exclude.
 * @param {number} [args.defaultTimeoutSeconds] - Default timeout in seconds.
 * @returns {void}
 */
function configureTests({excludeTags, defaultTimeoutSeconds} = {}) {
  testConfig.excludeTags = normalizeTags(excludeTags)
  if (typeof defaultTimeoutSeconds === "number") {
    testConfig.defaultTimeoutSeconds = defaultTimeoutSeconds
  }
}

/**
 * @param {Record<string, any>} baseArgs - Base args.
 * @param {Record<string, any>} extraArgs - Extra args.
 * @returns {Record<string, any>} - Merged args.
 */
function mergeTestArgs(baseArgs, extraArgs) {
  const merged = Object.assign({}, baseArgs, extraArgs)
  const mergedTags = [...normalizeTags(baseArgs?.tags), ...normalizeTags(extraArgs?.tags)]

  if (mergedTags.length > 0) {
    merged.tags = Array.from(new Set(mergedTags))
  } else if ("tags" in merged) {
    delete merged.tags
  }

  return merged
}

/**
 * @param {import("./test-runner.js").AfterBeforeEachCallbackType} callback - Callback function.
 * @returns {void} - No return value.
 */
function beforeEach(callback) {
  const currentTest = currentPath[currentPath.length - 1]

  currentTest.beforeEaches.push({callback})
}

/**
 * @param {import("./test-runner.js").BeforeAfterAllCallbackType} callback - Callback function.
 * @returns {void} - No return value.
 */
function beforeAll(callback) {
  const currentTest = currentPath[currentPath.length - 1]

  currentTest.beforeAlls.push({callback})
}

/**
 * @param {import("./test-runner.js").AfterBeforeEachCallbackType} callback - Callback function.
 * @returns {void} - No return value.
 */
function afterEach(callback) {
  const currentTest = currentPath[currentPath.length - 1]

  currentTest.afterEaches.push({callback})
}

/**
 * @param {import("./test-runner.js").BeforeAfterAllCallbackType} callback - Callback function.
 * @returns {void} - No return value.
 */
function afterAll(callback) {
  const currentTest = currentPath[currentPath.length - 1]

  currentTest.afterAlls.push({callback})
}

class BaseExpect {
  /**
   * @abstract
   * @returns {Promise<void>} - Resolves when complete.
   */
  async runBefore() { /* do nothing */ }

  /**
   * @abstract
   * @returns {Promise<void>} - Resolves when complete.
   */
  async runAfter() { /* do nothing */ }
}

class ExpectToChange extends BaseExpect {
  /**
   * @param {object} args - Options object.
   * @param {function(): Promise<number>} args.changeCallback - Change callback.
   * @param {Expect} args.expect - Expect.
   */
  constructor({changeCallback, expect, ...restArgs}) {
    super()
    restArgsError(restArgs)

    this.expect = expect
    this.changeCallback = changeCallback
  }

  /**
   * @param {number} count - Count value.
   * @returns {Expect} - The by.
   */
  by(count) {
    this.count = count

    return this.expect
  }

  async runBefore() {
    this.oldCount = await this.changeCallback()
  }

  async runAfter() {
    this.newCount = await this.changeCallback()
  }

  /**
   * @returns {Promise<void>} - Resolves when complete.
   */
  async execute() {
    if (this.newCount === undefined || this.oldCount === undefined) {
      throw new Error("ExpectToChange not executed properly")
    }

    const difference = this.newCount - this.oldCount

    if (difference != this.count) {
      throw new Error(`Expected to change by ${this.count} but changed by ${difference}`)
    }
  }
}

class Expect extends BaseExpect {
  /**
   * @param {any} object - Object.
   */
  constructor(object) {
    super()
    this._object = object

    /** @type {Array<Expect | ExpectToChange>} */
    this.expectations = []
  }

  /**
   * @param {function(): Promise<number>} changeCallback - Change callback.
   * @returns {ExpectToChange} - The and change.
   */
  andChange(changeCallback) {
    return this.toChange(changeCallback)
  }

  /**
   * @returns {this} - A value.
   */
  get not() {
    this._not = true

    return this
  }

  /**
   * @param {any} result - Result.
   * @returns {void} - No return value.
   */
  toBe(result) {
    if (this._not) {
      if (this._object === result) {
        const objectPrint = formatValue(this._object)
        const resultPrint = formatValue(result)

        throw new Error(`${objectPrint} was unexpected not to be ${resultPrint}`)
      }
    } else {
      if (this._object !== result) {
        const objectPrint = formatValue(this._object)
        const resultPrint = formatValue(result)

        throw new Error(`${objectPrint} wasn't expected be ${resultPrint}`)
      }
    }
  }

  /**
   * @param {number} result - Result.
   * @returns {void} - No return value.
   */
  toBeLessThanOrEqual(result) {
    if (typeof this._object !== "number" || typeof result !== "number") {
      throw new Error(`Expected numbers but got ${typeof this._object} and ${typeof result}`)
    }

    if (this._not) {
      if (this._object <= result) {
        const objectPrint = formatValue(this._object)
        const resultPrint = formatValue(result)

        throw new Error(`${objectPrint} was unexpected to be less than or equal to ${resultPrint}`)
      }
    } else {
      if (this._object > result) {
        const objectPrint = formatValue(this._object)
        const resultPrint = formatValue(result)

        throw new Error(`${objectPrint} wasn't expected to be greater than ${resultPrint}`)
      }
    }
  }

  /**
   * @param {number} result - Result.
   * @returns {void} - No return value.
   */
  toBeGreaterThan(result) {
    if (typeof this._object !== "number" || typeof result !== "number") {
      throw new Error(`Expected numbers but got ${typeof this._object} and ${typeof result}`)
    }

    if (this._not) {
      if (this._object > result) {
        const objectPrint = formatValue(this._object)
        const resultPrint = formatValue(result)

        throw new Error(`${objectPrint} was unexpected to be greater than ${resultPrint}`)
      }
    } else {
      if (this._object <= result) {
        const objectPrint = formatValue(this._object)
        const resultPrint = formatValue(result)

        throw new Error(`${objectPrint} wasn't expected to be less than or equal to ${resultPrint}`)
      }
    }
  }

  /**
   * @returns {void} - No return value.
   */
  toBeDefined() {
    if (this._not) {
      if (this._object !== undefined) {
        const objectPrint = formatValue(this._object)

        throw new Error(`${objectPrint} wasn´t expected to be defined`)
      }
    } else {
      if (this._object === undefined) {
        const objectPrint = formatValue(this._object)

        throw new Error(`${objectPrint} wasn't expected be undefined`)
      }
    }
  }

  /**
   * @param {new (...args: unknown[]) => unknown} klass - Class constructor to check against.
   * @returns {void} - No return value.
   */
  toBeInstanceOf(klass) {
    if (!(this._object instanceof klass)) {
      const objectPrint = formatValue(this._object)

      throw new Error(`Expected ${objectPrint} to be a ${klass.name} but it wasn't`)
    }
  }

  /**
   * @returns {void} - No return value.
   */
  toBeFalse() {
    this.toBe(false)
  }

  /**
   * @returns {void} - No return value.
   */
  toBeNull() {
    this.toBe(null)
  }

  /**
   * @returns {void} - No return value.
   */
  toBeUndefined() {
    this.toBe(undefined)
  }

  /**
   * @returns {void} - No return value.
   */
  toBeTrue() {
    this.toBe(true)
  }

  /**
   * @returns {void} - No return value.
   */
  toBeTruthy() {
    const objectPrint = formatValue(this._object)

    if (this._not) {
      if (this._object) {
        throw new Error(`${objectPrint} was unexpected to be truthy`)
      }
    } else {
      if (!this._object) {
        throw new Error(`${objectPrint} wasn't expected to be truthy`)
      }
    }
  }

  /**
   * @param {function(): Promise<number>} changeCallback - Change callback.
   * @returns {ExpectToChange} - The change.
   */
  toChange(changeCallback) {
    if (this._not) throw new Error("not stub")

    const expectToChange = new ExpectToChange({changeCallback, expect: this})

    this.expectations.push(expectToChange)

    return expectToChange
  }

  /**
   * @param {any} valueToContain - Value to contain.
   * @returns {void} - No return value.
   */
  toContain(valueToContain) {
    if (this._not) throw new Error("not stub")

    if (typeof this._object == "string") {
      if (!this._object.includes(String(valueToContain))) {
        const objectPrint = minifiedStringify(this._object)
        const valuePrint = typeof valueToContain == "string"
          ? minifiedStringify(valueToContain)
          : formatValue(valueToContain)

        throw new Error(`${objectPrint} doesn't contain ${valuePrint}`)
      }
      return
    }

    if (!Array.isArray(this._object)) {
      throw new Error(`Expected array or string but got ${typeof this._object}`)
    }

    if (!this._object.includes(valueToContain)) {
      const objectPrint = formatValue(this._object)
      const valuePrint = typeof valueToContain == "string"
        ? minifiedStringify(valueToContain)
        : formatValue(valueToContain)

      throw new Error(`${objectPrint} doesn't contain ${valuePrint}`)
    }
  }

  /**
   * @param {any} result - Result.
   * @returns {void} - No return value.
   */
  toEqual(result) {
    if (this._object instanceof Set && result instanceof Set) {
      const objectPrint = formatValue(this._object)
      const resultPrint = formatValue(result)
      const actualItems = Array.from(this._object)
      const expectedItems = Array.from(result)
      const missingItems = expectedItems.filter((expectedItem) => {
        return !actualItems.some((actualItem) => !anythingDifferent(actualItem, expectedItem))
      })
      const unexpectedItems = actualItems.filter((actualItem) => {
        return !expectedItems.some((expectedItem) => !anythingDifferent(actualItem, expectedItem))
      })
      const isEqual = missingItems.length === 0 && unexpectedItems.length === 0

      if (this._not) {
        if (isEqual) {
          throw new Error(`${objectPrint} was unexpected equal to ${resultPrint}`)
        }
      } else if (!isEqual) {
        const missingStrings = missingItems.map((item) => minifiedStringify(item))
        const unexpectedStrings = unexpectedItems.map((item) => minifiedStringify(item))
        const diffParts = []

        if (missingStrings.length > 0) diffParts.push(`missing ${missingStrings.join(", ")}`)
        if (unexpectedStrings.length > 0) diffParts.push(`unexpected ${unexpectedStrings.join(", ")}`)

        const diffMessage = diffParts.length > 0 ? ` (diff: ${diffParts.join("; ")})` : ""

        throw new Error(`${objectPrint} wasn't equal to ${resultPrint}${diffMessage}`)
      }

      return
    }

    if (isObjectContaining(result)) {
      const expectedValue = /** @type {any} */ (result).value
      const {matches, differences} = matchObject(this._object, expectedValue)
      const objectPrint = formatValue(this._object)
      const expectedPrint = formatValue(expectedValue)

      if (this._not) {
        if (matches) {
          throw new Error(`Expected ${objectPrint} not to match ${expectedPrint}`)
        }
      } else if (!matches) {
        const diffPrint = Object.keys(differences).length > 0 ? ` (diff: ${minifiedStringify(differences)})` : ""

        throw new Error(`Expected ${objectPrint} to match ${expectedPrint}${diffPrint}`)
      }

      return
    }

    if (isArrayContaining(result)) {
      const expectedValue = /** @type {any[]} */ (/** @type {any} */ (result).value)
      const {matches, differences} = matchArrayContaining(this._object, expectedValue)
      const objectPrint = formatValue(this._object)
      const expectedPrint = formatValue(expectedValue)

      if (this._not) {
        if (matches) {
          throw new Error(`Expected ${objectPrint} not to match ${expectedPrint}`)
        }
      } else if (!matches) {
        const diffPrint = Object.keys(differences).length > 0 ? ` (diff: ${minifiedStringify(differences)})` : ""

        throw new Error(`Expected ${objectPrint} to match ${expectedPrint}${diffPrint}`)
      }

      return
    }

    if (this._not) {
      if (typeof this._object == "object" && typeof result == "object") {
        if (!anythingDifferent(this._object, result)) {
          const objectPrint = formatValue(this._object)
          const resultPrint = formatValue(result)

          throw new Error(`${objectPrint} was unexpected equal to ${resultPrint}`)
        }
      } else {
        if (this._object == result) {
          const objectPrint = formatValue(this._object)
          const resultPrint = formatValue(result)

          throw new Error(`${objectPrint} was unexpected equal to ${resultPrint}`)
        }
      }
    } else {
      if (typeof this._object == "object" && typeof result == "object") {
        if (anythingDifferent(this._object, result)) {
          const objectPrint = formatValue(this._object)
          const resultPrint = formatValue(result)

          if (Array.isArray(this._object) && Array.isArray(result)) {
            const actualStrings = this._object.map((item) => minifiedStringify(item))
            const expectedStrings = result.map((item) => minifiedStringify(item))

            const missingItems = expectedStrings.filter((item) => !actualStrings.includes(item))
            const unexpectedItems = actualStrings.filter((item) => !expectedStrings.includes(item))

            const diffParts = []

            if (missingItems.length > 0) diffParts.push(`missing ${missingItems.join(", ")}`)
            if (unexpectedItems.length > 0) diffParts.push(`unexpected ${unexpectedItems.join(", ")}`)

            const diffMessage = diffParts.length > 0 ? ` (diff: ${diffParts.join("; ")})` : ""

            throw new Error(`${objectPrint} wasn't equal to ${resultPrint}${diffMessage}`)
          }

          throw new Error(`${objectPrint} wasn't equal to ${resultPrint}`)
        }
      } else {
        if (this._object != result) {
          const objectPrint = formatValue(this._object)
          const resultPrint = formatValue(result)

          throw new Error(`${objectPrint} wasn't equal to ${resultPrint}`)
        }
      }
    }
  }

  /**
   * @param {RegExp} regex - Regex.
   * @returns {void} - No return value.
   */
  toMatch(regex) {
    if (typeof this._object !== "string") {
      throw new Error(`Expected string but got ${typeof this._object}`)
    }

    const match = this._object.match(regex)
    const objectPrint = minifiedStringify(this._object)

    if (this._not) {
      if (match) {
        throw new Error(`${objectPrint} shouldn't match ${regex}`)
      }
    } else {
      if (!match) {
        throw new Error(`${objectPrint} didn't match ${regex}`)
      }
    }
  }

  /**
   * @param {Record<string, any> | any[]} expected - Expected partial object.
   * @returns {void} - No return value.
   */
  toMatchObject(expected) {
    if (expected === null || typeof expected !== "object") {
      throw new Error(`Expected object but got ${typeof expected}`)
    }

    const {matches, differences} = matchObject(this._object, expected)
    const objectPrint = formatValue(this._object)
    const expectedPrint = formatValue(expected)

    if (this._not) {
      if (matches) {
        throw new Error(`Expected ${objectPrint} not to match ${expectedPrint}`)
      }
    } else if (!matches) {
      const diffPrint = Object.keys(differences).length > 0 ? ` (diff: ${minifiedStringify(differences)})` : ""

      throw new Error(`Expected ${objectPrint} to match ${expectedPrint}${diffPrint}`)
    }
  }

  /**
   * @template T extends Error
   * @param {string|T} expectedError - Expected error.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async toThrowError(expectedError) {
    if (this._not) throw new Error("not stub")

    let failedError

    try {
      if (typeof this._object !== "function") {
        throw new Error(`Expected function but got ${typeof this._object}`)
      }

      await this._object()
    } catch (error) {
      failedError = error
    }

    if (!failedError) throw new Error("Expected to fail but didn't")

    let expectedErrorMessage, failedErrorMessage

    if (typeof failedError == "string") {
      failedErrorMessage = failedError
    } else if (failedError instanceof Error) {
      failedErrorMessage = failedError.message
    } else {
      failedErrorMessage = String(failedError)
    }

    if (typeof expectedError == "string") {
      expectedErrorMessage = expectedError
    } else if (expectedError instanceof Error) {
      expectedErrorMessage = expectedError.message
    } else {
      expectedErrorMessage = String(expectedError)
    }

    if (failedErrorMessage != expectedErrorMessage) {
      throw new Error(`Expected to fail with '${expectedErrorMessage}' but failed with '${failedErrorMessage}'`)
    }
  }

  /**
   * @returns {Promise<any>} - Resolves with the execute.
   */
  async execute() {
    for (const expectation of this.expectations) {
      await expectation.runBefore()
    }

    if (typeof this._object !== "function") {
      throw new Error(`Expected function but got ${typeof this._object}`)
    }

    const result = await this._object()

    for (const expectation of this.expectations) {
      await expectation.runAfter()
    }

    for (const expectation of this.expectations) {
      await expectation.execute()
    }

    return result
  }

  /**
   * @param {Record<string, any>} result - Result.
   * @returns {void} - No return value.
   */
  toHaveAttributes(result) {
    if (this._not) throw new Error("not stub")

    /** @type {Record<string, any[]>} */
    const differences = {}
    const objectAsRecord = /** @type {Record<string, unknown>} */ (this._object)

    for (const key in result) {
      const value = result[key]

      if (!(key in objectAsRecord)) throw new Error(`${this._object.constructor.name} doesn't respond to ${key}`)

      const objectValue = /** @type {() => unknown} */ (objectAsRecord[key])()

      if (value != objectValue) {
        differences[key] = [value, objectValue]
      }
    }

    if (Object.keys(differences).length > 0) {
      throw new Error(`Object had differet values: ${minifiedStringify(differences)}`)
    }
  }
}

/**
 * @param {unknown} value - Value.
 * @returns {{__velociousMatcher: string, value: unknown}} - Matcher wrapper.
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
 * @param {unknown} value - Value.
 * @returns {{__velociousMatcher: string, value: unknown}} - Matcher wrapper.
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
 * @param {unknown} value - Value.
 * @returns {boolean} - Whether object-like.
 */
function isObjectLike(value) {
  return value !== null && typeof value === "object"
}

/**
 * @param {unknown} value - Value.
 * @returns {boolean} - Whether arrayContaining matcher.
 */
function isArrayContaining(value) {
  return !!value && typeof value === "object" && (/** @type {any} */ (value)).__velociousMatcher === "arrayContaining"
}

/**
 * @param {unknown} value - Value.
 * @returns {boolean} - Whether objectContaining matcher.
 */
function isObjectContaining(value) {
  return !!value && typeof value === "object" && (/** @type {any} */ (value)).__velociousMatcher === "objectContaining"
}

/**
 * @param {unknown} value - Value.
 * @returns {boolean} - Whether plain object.
 */
function isPlainObject(value) {
  if (!value || typeof value !== "object") return false

  const prototype = Object.getPrototypeOf(value)

  return prototype === Object.prototype || prototype === null
}

/**
 * @param {unknown} actual - Actual value.
 * @param {unknown} expected - Expected value.
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
 * @param {unknown} actual - Actual value.
 * @param {unknown} expected - Expected value.
 * @param {string} path - Path.
 * @param {Record<string, unknown[]>} differences - Differences.
 * @returns {void} - No return value.
 */
function collectMatchDifferences(actual, expected, path, differences) {
  if (isObjectContaining(expected)) {
    collectMatchDifferences(actual, /** @type {any} */ (expected).value, path, differences)
    return
  }

  if (isArrayContaining(expected)) {
    const {matches} = matchArrayContaining(actual, /** @type {any[]} */ (/** @type {any} */ (expected).value))

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

    for (const key of Object.keys(expected)) {
      const nextPath = path ? `${path}.${key}` : key

      if (!Object.prototype.hasOwnProperty.call(/** @type {Record<string, unknown>} */ (actual), key)) {
        differences[nextPath] = [expected[key], undefined]
        continue
      }

      collectMatchDifferences(actual[key], expected[key], nextPath, differences)
    }

    return
  }

  if (!valuesEqual(actual, expected)) {
    differences[path || "$"] = [expected, actual]
  }
}

/**
 * @param {unknown} actual - Actual value.
 * @param {Record<string, any> | any[]} expected - Expected value.
 * @returns {{matches: boolean, differences: Record<string, unknown[]>}} - Match result.
 */
function matchObject(actual, expected) {
  /** @type {Record<string, unknown[]>} */
  const differences = {}

  collectMatchDifferences(actual, expected, "", differences)

  return {
    matches: Object.keys(differences).length === 0,
    differences
  }
}

/**
 * @param {unknown} actual - Actual value.
 * @param {any[]} expected - Expected values.
 * @returns {{matches: boolean, differences: Record<string, unknown[]>}} - Match result.
 */
function matchArrayContaining(actual, expected) {
  /** @type {Record<string, unknown[]>} */
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
        const {matches} = matchObject(actual[i], /** @type {any} */ (expectedItem).value)
        if (matches) {
          matchedIndex = i
          break
        }
        continue
      }

      if (isArrayContaining(expectedItem)) {
        const {matches} = matchArrayContaining(actual[i], /** @type {any} */ (expectedItem).value)
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

/**
 * @param {string} description - Description.
 * @param {object|(() => (void|Promise<void>))} arg1 - Arg1.
 * @param {undefined|(() => (void|Promise<void>))} [arg2] - Arg2.
 * @returns {Promise<void>} - Resolves when complete.
 */
async function describe(description, arg1, arg2) {
  let testArgs, testFunction

  if (typeof arg2 == "function") {
    testFunction = arg2
    testArgs = arg1
  } else if (typeof arg1 == "function") {
    testFunction = arg1
    testArgs = {}
  } else {
    throw new Error(`Invalid arguments for describe: ${arg1}, ${arg2}`)
  }

  const currentTest = currentPath[currentPath.length - 1]
  const newTestArgs = mergeTestArgs(currentTest.args, testArgs)

  if (description in currentTest.subs) {
    throw new Error(`Duplicate test description: ${description}`)
  }

  const location = captureLocation()
  const newTestData = {
    afterEaches: [],
    afterAlls: [],
    args: newTestArgs,
    beforeAlls: [],
    beforeEaches: [],
    filePath: location.filePath,
    line: location.line,
    subs: {},
    tests: {}
  }

  currentTest.subs[description] = newTestData
  currentPath.push(newTestData)

  try {
    await testFunction()
  } finally {
    currentPath.pop()
  }
}

/**
 * @param {any} arg - Arg.
 * @returns {Expect} - The expect.
 */
function expect(arg) {
  return new Expect(arg)
}

expect.objectContaining = objectContaining
expect.arrayContaining = arrayContaining

/**
 * @param {string} description - Description.
 * @param {object|(() => (void|Promise<void>))} arg1 - Arg1.
 * @param {undefined|(() => (void|Promise<void>))} [arg2] - Arg2.
 * @returns {void} - No return value.
 */
function it(description, arg1, arg2) {
  const currentTest = currentPath[currentPath.length - 1]
  let testArgs

  /** @type {() => (void|Promise<void>)} */
  let testFunction

  if (typeof arg1 == "function") {
    testFunction = arg1
    testArgs = {}
  } else if (typeof arg2 == "function") {
    testFunction = arg2
    testArgs = arg1
  } else {
    throw new Error(`Invalid arguments for it: ${description}, ${arg1}`)
  }

  const newTestArgs = mergeTestArgs(currentTest.args, testArgs)

  const location = captureLocation()

  currentTest.tests[description] = {
    args: newTestArgs,
    function: testFunction,
    filePath: location.filePath,
    line: location.line
  }
}

/**
 * @param {string} description - Description.
 * @param {object|(() => (void|Promise<void>))} arg1 - Arg1.
 * @param {undefined|(() => (void|Promise<void>))} [arg2] - Arg2.
 * @returns {void} - No return value.
 */
function fit(description, arg1, arg2) {
  let testArgs

  /** @type {() => (void|Promise<void>)} */
  let testFunction

  if (typeof arg1 == "function") {
    testFunction = arg1
    testArgs = {focus: true}
  } else if (typeof arg2 == "function") {
    testFunction = arg2
    testArgs = Object.assign({focus: true}, arg1)
  } else {
    throw new Error(`Invalid arguments for it: ${description}, ${arg1}`)
  }

  return it(description, testArgs, testFunction)
}

// Make the methods global so they can be used in test files
globalThis.afterEach = afterEach
globalThis.afterAll = afterAll
globalThis.beforeEach = beforeEach
globalThis.beforeAll = beforeAll
globalThis.describe = describe
globalThis.expect = expect
globalThis.it = it
globalThis.fit = fit
globalThis.testEvents = testEvents
globalThis.configureTests = configureTests

export {afterAll, afterEach, beforeAll, beforeEach, configureTests, describe, expect, fit, it, arrayContaining, objectContaining, testConfig, testEvents, tests}
