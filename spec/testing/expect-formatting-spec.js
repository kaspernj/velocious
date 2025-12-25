// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"

/**
 * @param {() => void} callback
 * @returns {Error}
 */
function captureError(callback) {
  try {
    callback()
  } catch (error) {
    // @ts-ignore
    return error
  }

  throw new Error("Expected callback to throw")
}

describe("Expect formatting", async () => {
  it("prints minified plain objects and handles circular references", () => {
    /** @type {any} */
    const circular = {foo: "bar"}
    circular.self = circular

    const error = captureError(() => expect(circular).toBe({expected: true}))

    expect(error.message).toBe('{"foo":"bar","self":"[Circular]"} wasn\'t expected be {"expected":true}')
  })

  it("prints arrays minified and guards against depth overflow", () => {
    /** @type {any[]} */
    const circularArray = [1]
    circularArray.push(circularArray)

    /** @type {any} */
    const deep = {value: 0}
    deep.child = {value: 1, child: {value: 2, child: {value: 3, child: {value: 4, child: {value: 5, child: {value: 6}}}}}}
    circularArray.push(deep)

    const error = captureError(() => expect(circularArray).toBe([1]))

    expect(error.message).toContain("[Circular]")
    expect(error.message).toContain("[MaxDepth]")
  })

  it("uses constructor names for custom classes", () => {
    class CustomThing {}

    const error = captureError(() => expect(new CustomThing()).toBeInstanceOf(Array))

    expect(error.message).toBe("Expected CustomThing to be a Array but it wasn't")
  })
})
