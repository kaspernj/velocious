// @ts-check

import {formatValue, minifiedStringify} from "./format-value.js"
import {anythingDifferent} from "set-state-compare/build/diff-utils.js"
import restArgsError from "../utils/rest-args-error.js"

/** @type {import("./test-runner.js").TestsArgument} */
const tests = {
  /** @type {import("./test-runner.js").AfterBeforeEachCallbackObjectType[]} */
  afterEaches: [],
  args: {},

  /** @type {import("./test-runner.js").AfterBeforeEachCallbackObjectType[]} */
  beforeEaches: [],
  subs: {},
  tests: {}
}

let currentPath = [tests]

/**
 * @param {import("./test-runner.js").AfterBeforeEachCallbackType} callback - Callback function.
 * @returns {void} - No return value.
 */
function beforeEach(callback) {
  const currentTest = currentPath[currentPath.length - 1]

  currentTest.beforeEaches.push({callback})
}

/**
 * @param {import("./test-runner.js").AfterBeforeEachCallbackType} callback - Callback function.
 * @returns {void} - No return value.
 */
function afterEach(callback) {
  const currentTest = currentPath[currentPath.length - 1]

  currentTest.afterEaches.push({callback})
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
   * @param {unknown} object - Object.
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
   * @param {unknown} result - Result.
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
   * @param {unknown} valueToContain - Value to contain.
   * @returns {void} - No return value.
   */
  toContain(valueToContain) {
    if (this._not) throw new Error("not stub")

    if (typeof this._object == "string") {
      if (!this._object.includes(String(valueToContain))) {
        const objectPrint = formatValue(this._object)
        const valuePrint = formatValue(valueToContain)

        throw new Error(`${objectPrint} doesn't contain ${valuePrint}`)
      }
      return
    }

    if (!Array.isArray(this._object)) {
      throw new Error(`Expected array or string but got ${typeof this._object}`)
    }

    if (!this._object.includes(valueToContain)) {
      const objectPrint = formatValue(this._object)
      const valuePrint = formatValue(valueToContain)

      throw new Error(`${objectPrint} doesn't contain ${valuePrint}`)
    }
  }

  /**
   * @param {unknown} result - Result.
   * @returns {void} - No return value.
   */
  toEqual(result) {
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

    if (this._not) {
      if (match) {
        const objectPrint = formatValue(this._object)

        throw new Error(`${objectPrint} shouldn't match ${regex}`)
      }
    } else {
      if (!match) {
        const objectPrint = formatValue(this._object)

        throw new Error(`${objectPrint} didn't match ${regex}`)
      }
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
   * @returns {Promise<unknown>} - Resolves with the execute.
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
   * @param {Record<string, unknown>} result - Result.
   * @returns {void} - No return value.
   */
  toHaveAttributes(result) {
    if (this._not) throw new Error("not stub")

    /** @type {Record<string, unknown[]>} */
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
  const newTestArgs = Object.assign({}, currentTest.args, testArgs)

  if (description in currentTest.subs) {
    throw new Error(`Duplicate test description: ${description}`)
  }

  const newTestData = {afterEaches: [], args: newTestArgs, beforeEaches: [], subs: {}, tests: {}}

  currentTest.subs[description] = newTestData
  currentPath.push(newTestData)

  try {
    await testFunction()
  } finally {
    currentPath.pop()
  }
}

/**
 * @param {unknown} arg - Arg.
 * @returns {Expect} - The expect.
 */
function expect(arg) {
  return new Expect(arg)
}

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

  const newTestArgs = Object.assign({}, currentTest.args, testArgs)

  currentTest.tests[description] = {args: newTestArgs, function: testFunction}
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
globalThis.beforeEach = beforeEach
globalThis.describe = describe
globalThis.expect = expect
globalThis.it = it
globalThis.fit = fit

export {afterEach, beforeEach, describe, expect, fit, it, tests}
