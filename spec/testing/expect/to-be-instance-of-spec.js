// @ts-check

import {describe, expect, it} from "../../../src/testing/test.js"

describe("Expect#toBeInstanceOf", () => {
  it("passes when the value is an instance of the class", () => {
    expect([]).toBeInstanceOf(Array)
  })

  it("fails when the value is not an instance of the class", async () => {
    await expect(() => {
      expect({}).toBeInstanceOf(Array)
    }).toThrowError("Expected {} to be a Array but it wasn't")
  })
})
