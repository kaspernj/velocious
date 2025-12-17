// @ts-check

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
 * @param {import("./test-runner.js").AfterBeforeEachCallbackType} callback
 * @returns {void}
 */
function beforeEach(callback) {
  const currentTest = currentPath[currentPath.length - 1]

  currentTest.beforeEaches.push({callback})
}

/**
 * @param {import("./test-runner.js").AfterBeforeEachCallbackType} callback
 * @returns {void}
 */
function afterEach(callback) {
  const currentTest = currentPath[currentPath.length - 1]

  currentTest.afterEaches.push({callback})
}

class BaseExpect {
  /**
   * @abstract
   * @returns {Promise<void>}
   */
  async runBefore() { /* do nothing */ }

  /**
   * @abstract
   * @returns {Promise<void>}
   */
  async runAfter() { /* do nothing */ }
}

class ExpectToChange extends BaseExpect {
  /**
   * @param {object} args
   * @param {function(): Promise<number>} args.changeCallback
   * @param {Expect} args.expect
   */
  constructor({changeCallback, expect, ...restArgs}) {
    super()
    restArgsError(restArgs)

    this.expect = expect
    this.changeCallback = changeCallback
  }

  /**
   * @param {number} count
   * @returns {Expect}
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
   * @returns {Promise<void>}
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
   * @param {any} object
   */
  constructor(object) {
    super()
    this._object = object

    /** @type {Array<Expect | ExpectToChange>} */
    this.expectations = []
  }

  /**
   * @param {function(): Promise<number>} changeCallback
   * @returns {ExpectToChange}
   */
  andChange(changeCallback) {
    return this.toChange(changeCallback)
  }

  /**
   * @returns {this}
   */
  get not() {
    this._not = true

    return this
  }

  /**
   * @param {any} result
   * @returns {void}
   */
  toBe(result) {
    if (this._not) {
      if (this._object === result) {
        throw new Error(`${this._object} was unexpected not to be ${result}`)
      }
    } else {
      if (this._object !== result) {
        throw new Error(`${this._object} wasn't expected be ${result}`)
      }
    }
  }

  /**
   * @returns {void}
   */
  toBeDefined() {
    if (this._not) {
      if (this._object !== undefined) {
        throw new Error(`${this._object} wasn´t expected to be defined`)
      }
    } else {
      if (this._object === undefined) {
        throw new Error(`${this._object} wasn't expected be undefined`)
      }
    }
  }

  /**
   * @param {Function} klass
   * @returns {void}
   */
  toBeInstanceOf(klass) {
    if (!(this._object instanceof klass)) {
      throw new Error(`Expected ${this._object?.constructor?.name || "null"} to be a ${klass.name} but it wasn't`)
    }
  }

  /**
   * @returns {void}
   */
  toBeFalse() {
    this.toBe(false)
  }

  /**
   * @returns {void}
   */
  toBeUndefined() {
    this.toBe(undefined)
  }

  /**
   * @returns {void}
   */
  toBeTrue() {
    this.toBe(true)
  }

  /**
   * @param {function(): Promise<number>} changeCallback
   * @returns {ExpectToChange}
   */
  toChange(changeCallback) {
    if (this._not) throw new Error("not stub")

    const expectToChange = new ExpectToChange({changeCallback, expect: this})

    this.expectations.push(expectToChange)

    return expectToChange
  }

  /**
   * @param {any} valueToContain
   * @returns {void}
   */
  toContain(valueToContain) {
    if (this._not) throw new Error("not stub")

    if (!this._object.includes(valueToContain)) {
      throw new Error(`${this._object} doesn't contain ${valueToContain}`)
    }
  }

  /**
   * @param {any} result
   * @returns {void}
   */
  toEqual(result) {
    if (this._not) {
      if (typeof this._object == "object" && typeof result == "object") {
        if (!anythingDifferent(this._object, result)) {
          throw new Error(`${this._object} was unexpected equal to ${result}`)
        }
      } else {
        if (this._object == result) {
          throw new Error(`${this._object} was unexpected equal to ${result}`)
        }
      }
    } else {
      if (typeof this._object == "object" && typeof result == "object") {
        if (anythingDifferent(this._object, result)) {
          throw new Error(`${JSON.stringify(this._object)} wasn't equal to ${JSON.stringify(result)}`)
        }
      } else {
        if (this._object != result) {
          throw new Error(`${this._object} wasn't equal to ${result}`)
        }
      }
    }
  }

  /**
   * @param {RegExp} regex
   * @returns {void}
   */
  toMatch(regex) {
    const match = this._object.match(regex)

    if (this._not) {
      if (match) {
        throw new Error(`${this._object} shouldn't match ${regex}`)
      }
    } else {
      if (!match) {
        throw new Error(`${this._object} didn't match ${regex}`)
      }
    }
  }

  /**
   * @template T extends Error
   * @param {string|T} expectedError
   * @returns {Promise<void>}
   */
  async toThrowError(expectedError) {
    if (this._not) throw new Error("not stub")

    let failedError

    try {
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
   * @returns {Promise<any>}
   */
  async execute() {
    for (const expectation of this.expectations) {
      await expectation.runBefore()
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
   * @param {Record<string, any>} result
   * @returns {void}
   */
  toHaveAttributes(result) {
    if (this._not) throw new Error("not stub")

    /** @type {Record<string, any[]>} */
    const differences = {}

    for (const key in result) {
      const value = result[key]

      if (!(key in this._object)) throw new Error(`${this._object.constructor.name} doesn't respond to ${key}`)

      const objectValue = this._object[key]()

      if (value != objectValue) {
        differences[key] = [value, objectValue]
      }
    }

    if (Object.keys(differences).length > 0) {
      throw new Error(`Object had differet values: ${JSON.stringify(differences)}`)
    }
  }
}

/**
 * @param {string} description
 * @param {object|(() => Promise<void>)} arg1
 * @param {undefined|(() => Promise<void>)} [arg2]
 * @returns {Promise<void>}
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
 * @param {any} arg
 * @returns {Expect}
 */
function expect(arg) {
  return new Expect(arg)
}

/**
 * @param {string} description
 * @param {object|(() => Promise<void>)} arg1
 * @param {undefined|(() => Promise<void>)} [arg2]
 * @returns {void}
 */
function it(description, arg1, arg2) {
  const currentTest = currentPath[currentPath.length - 1]
  let testArgs

  /** @type {() => Promise<void>} */
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
 * @param {string} description
 * @param {object|(() => Promise<void>)} arg1
 * @param {undefined|(() => Promise<void>)} [arg2]
 * @returns {void}
 */
function fit(description, arg1, arg2) {
  let testArgs

  /** @type {() => Promise<void>} */
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
