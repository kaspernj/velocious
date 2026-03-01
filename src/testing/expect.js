// @ts-check

import {formatValue, minifiedStringify} from "./format-value.js"
import {anythingDifferent} from "set-state-compare/build/diff-utils.js"
import BaseExpect from "./base-expect.js"
import ExpectToChange from "./expect-to-change.js"
import {
  isArrayContaining,
  isObjectContaining,
  matchArrayContaining,
  matchObject
} from "./expect-utils.js"

export default class Expect extends BaseExpect {
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
  toBeLessThan(result) {
    if (typeof this._object !== "number" || typeof result !== "number") {
      throw new Error(`Expected numbers but got ${typeof this._object} and ${typeof result}`)
    }

    if (this._not) {
      if (this._object < result) {
        const objectPrint = formatValue(this._object)
        const resultPrint = formatValue(result)

        throw new Error(`${objectPrint} was unexpected to be less than ${resultPrint}`)
      }
    } else {
      if (this._object >= result) {
        const objectPrint = formatValue(this._object)
        const resultPrint = formatValue(result)

        throw new Error(`${objectPrint} wasn't expected to be greater than or equal to ${resultPrint}`)
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
   * @param {number} result - Result.
   * @returns {void} - No return value.
   */
  toBeGreaterThanOrEqual(result) {
    if (typeof this._object !== "number" || typeof result !== "number") {
      throw new Error(`Expected numbers but got ${typeof this._object} and ${typeof result}`)
    }

    if (this._not) {
      if (this._object >= result) {
        const objectPrint = formatValue(this._object)
        const resultPrint = formatValue(result)

        throw new Error(`${objectPrint} was unexpected to be greater than or equal to ${resultPrint}`)
      }
    } else {
      if (this._object < result) {
        const objectPrint = formatValue(this._object)
        const resultPrint = formatValue(result)

        throw new Error(`${objectPrint} wasn't expected to be less than ${resultPrint}`)
      }
    }
  }

  /**
   * @param {number} result - Result.
   * @param {number} [precision] - Decimal precision.
   * @returns {void} - No return value.
   */
  toBeCloseTo(result, precision = 2) {
    if (typeof this._object !== "number" || typeof result !== "number") {
      throw new Error(`Expected numbers but got ${typeof this._object} and ${typeof result}`)
    }

    if (typeof precision !== "number" || !Number.isFinite(precision)) {
      throw new Error(`Expected precision to be a number but got ${typeof precision}`)
    }

    const tolerance = 0.5 * Math.pow(10, -precision)
    const diff = Math.abs(this._object - result)
    const isClose = diff <= tolerance

    if (this._not) {
      if (isClose) {
        const objectPrint = formatValue(this._object)
        const resultPrint = formatValue(result)

        throw new Error(`${objectPrint} was unexpected to be close to ${resultPrint}`)
      }
    } else {
      if (!isClose) {
        const objectPrint = formatValue(this._object)
        const resultPrint = formatValue(result)

        throw new Error(`${objectPrint} wasn't expected to be close to ${resultPrint}`)
      }
    }
  }

  /**
   * @param {number} result - Expected length.
   * @returns {void} - No return value.
   */
  toHaveLength(result) {
    if (typeof result !== "number") {
      throw new Error(`Expected length number but got ${typeof result}`)
    }

    if (this._object === null || this._object === undefined || typeof this._object.length !== "number") {
      throw new Error(`Expected value with length but got ${typeof this._object}`)
    }

    const objectPrint = formatValue(this._object)
    const resultPrint = formatValue(result)
    const lengthValue = this._object.length

    if (this._not) {
      if (lengthValue === result) {
        throw new Error(`${objectPrint} was unexpected to have length ${resultPrint}`)
      }
    } else if (lengthValue !== result) {
      throw new Error(`${objectPrint} wasn't expected to have length ${resultPrint}`)
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
    if (typeof this._object == "string") {
      const matches = this._object.includes(String(valueToContain))
      const objectPrint = minifiedStringify(this._object)
      const valuePrint = typeof valueToContain == "string"
        ? minifiedStringify(valueToContain)
        : formatValue(valueToContain)

      if (this._not) {
        if (matches) {
          throw new Error(`${objectPrint} was unexpected to contain ${valuePrint}`)
        }
      } else if (!matches) {
        throw new Error(`${objectPrint} doesn't contain ${valuePrint}`)
      }

      return
    }

    if (!Array.isArray(this._object)) {
      throw new Error(`Expected array or string but got ${typeof this._object}`)
    }

    const matches = this._object.includes(valueToContain)
    const objectPrint = formatValue(this._object)
    const valuePrint = typeof valueToContain == "string"
      ? minifiedStringify(valueToContain)
      : formatValue(valueToContain)

    if (this._not) {
      if (matches) {
        throw new Error(`${objectPrint} was unexpected to contain ${valuePrint}`)
      }
    } else if (!matches) {
      throw new Error(`${objectPrint} doesn't contain ${valuePrint}`)
    }
  }

  /**
   * @param {any} valueToContain - Value to contain.
   * @returns {void} - No return value.
   */
  toContainEqual(valueToContain) {
    if (!Array.isArray(this._object)) {
      throw new Error(`Expected array but got ${typeof this._object}`)
    }

    const matches = this._object.some((item) => !anythingDifferent(item, valueToContain))
    const objectPrint = formatValue(this._object)
    const valuePrint = typeof valueToContain == "string"
      ? minifiedStringify(valueToContain)
      : formatValue(valueToContain)

    if (this._not) {
      if (matches) {
        throw new Error(`${objectPrint} was unexpected to contain ${valuePrint}`)
      }
    } else if (!matches) {
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
   * @param {string|RegExp|Error|((new (...args: unknown[]) => Error))} [expected] - Expected error.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async toThrow(expected) {
    if (typeof this._object !== "function") {
      throw new Error(`Expected function but got ${typeof this._object}`)
    }

    let failedError

    try {
      await this._object()
    } catch (error) {
      failedError = error
    }

    const objectPrint = formatValue(this._object)

    if (this._not) {
      if (failedError) {
        throw new Error(`${objectPrint} was unexpected to throw`)
      }

      return
    }

    if (!failedError) throw new Error("Expected to fail but didn't")
    if (expected === undefined) return

    const failedErrorMessage = failedError instanceof Error ? failedError.message : String(failedError)
    const failedErrorName = failedError instanceof Error ? failedError.name : typeof failedError

    if (expected instanceof RegExp) {
      if (!expected.test(failedErrorMessage)) {
        throw new Error(`Expected to fail with message matching ${expected} but failed with '${failedErrorMessage}'`)
      }

      return
    }

    if (typeof expected === "function" && (expected.prototype instanceof Error || expected === Error)) {
      if (!(failedError instanceof expected)) {
        throw new Error(`Expected to throw ${expected.name} but threw ${failedErrorName}`)
      }

      return
    }

    let expectedMessage

    if (typeof expected === "string") {
      expectedMessage = expected
    } else if (expected instanceof Error) {
      expectedMessage = expected.message
    } else {
      expectedMessage = String(expected)
    }

    if (failedErrorMessage != expectedMessage) {
      throw new Error(`Expected to fail with '${expectedMessage}' but failed with '${failedErrorMessage}'`)
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
