// @ts-check

import {describe, expect, it} from "../../../src/testing/test.js"

describe("Expect#toBeLessThanOrEqual", () => {
  it("passes when the value is less than or equal to the expected", () => {
    expect(2).toBeLessThanOrEqual(3)
    expect(3).toBeLessThanOrEqual(3)
  })

  it("fails when the value is greater than the expected", async () => {
    await expect(() => {
      expect(4).toBeLessThanOrEqual(3)
    }).toThrowError("4 wasn't expected to be greater than 3")
  })
})
