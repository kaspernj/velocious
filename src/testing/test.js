import {anythingDifferent} from "set-state-compare/src/diff-utils.js"
import restArgsError from "../utils/rest-args-error.js"

const tests = {
  afterEaches: [],
  args: {},
  beforeEaches: [],
  subs: {},
  tests: {}
}

let currentPath = [tests]

function beforeEach(callback) {
  const currentTest = currentPath[currentPath.length - 1]

  currentTest.beforeEaches.push({callback})
}

function afterEach(callback) {
  const currentTest = currentPath[currentPath.length - 1]

  currentTest.afterEaches.push({callback})
}

class ExpectToChange {
  constructor({changeCallback, expect, ...restArgs}) {
    restArgsError(restArgs)

    this.expect = expect
    this.changeCallback = changeCallback
  }

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

  async execute() {
    const difference = this.newCount - this.oldCount

    if (difference != this.count) {
      throw new Error(`Expected to change by ${this.count} but changed by ${difference}`)
    }
  }
}

class Expect {
  constructor(object) {
    this._object = object
    this.expectations = []
  }

  andChange(...args) {
    return this.toChange(...args)
  }

  get not() {
    this._not = true

    return this
  }

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

  toBeInstanceOf(klass) {
    if (!(this._object instanceof klass)) {
      throw new Error(`Expected ${this._object?.constructor?.name || "null"} to be a ${klass.name} but it wasn't`)
    }
  }

  toBeFalse() {
    this.toBe(false)
  }

  toBeUndefined() {
    this.toBe(undefined)
  }

  toBeTrue() {
    this.toBe(true)
  }

  toChange(changeCallback) {
    if (this._not) throw new Error("not stub")

    const expectToChange = new ExpectToChange({changeCallback, expect: this})

    this.expectations.push(expectToChange)

    return expectToChange
  }

  toContain(valueToContain) {
    if (this._not) throw new Error("not stub")

    if (!this._object.includes(valueToContain)) {
      throw new Error(`${this._object} doesn't contain ${valueToContain}`)
    }
  }

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
    } else {
      failedErrorMessage = failedError.message
    }

    if (typeof expectedError == "string") {
      expectedErrorMessage = expectedError
    } else {
      expectedErrorMessage = expectedError.message
    }

    if (failedErrorMessage != expectedErrorMessage) {
      throw new Error(`Expected to fail with '${expectedErrorMessage}' but failed with '${failedErrorMessage}'`)
    }
  }

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

  toHaveAttributes(result) {
    if (this._not) throw new Error("not stub")

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

function expect(arg) {
  return new Expect(arg)
}

function it(description, arg1, arg2) {
  const currentTest = currentPath[currentPath.length - 1]
  let testArgs, testFunction

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

function fit(description, arg1, arg2) {
  let testArgs, testFunction

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

export {describe, expect, fit, it, tests}
