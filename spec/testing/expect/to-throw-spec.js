// @ts-check

import {describe, expect, it} from "../../../src/testing/test.js"

describe("Expect#toThrow", () => {
  it("passes when the function throws", async () => {
    await expect(() => {
      throw new Error("boom")
    }).toThrow()
  })

  it("supports matching error messages", async () => {
    await expect(() => {
      throw new Error("boom")
    }).toThrow("boom")
  })

  it("supports matching error message regex", async () => {
    await expect(() => {
      throw new Error("boom")
    }).toThrow(/boo/)
  })

  it("supports matching error classes", async () => {
    await expect(() => {
      throw new TypeError("boom")
    }).toThrow(TypeError)
  })

  it("fails when the function does not throw", async () => {
    await expect(async () => {
      await expect(() => {}).toThrow()
    }).toThrowError("Expected to fail but didn't")
  })

  it("fails when negated and the function throws", async () => {
    function boom() {
      throw new Error("boom")
    }

    await expect(async () => {
      await expect(boom).not.toThrow()
    }).toThrowError("boom was unexpected to throw")
  })
})
