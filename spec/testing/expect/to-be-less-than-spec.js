// @ts-check

import {describe, expect, it} from "../../../src/testing/test.js"

describe("Expect#toBeLessThan", () => {
  it("passes when the value is less than the expected", () => {
    expect(2).toBeLessThan(3)
  })

  it("fails when the value is greater than or equal to the expected", async () => {
    await expect(() => {
      expect(3).toBeLessThan(3)
    }).toThrowError("3 wasn't expected to be greater than or equal to 3")
  })

  it("fails when negated and the value is less than the expected", async () => {
    await expect(() => {
      expect(2).not.toBeLessThan(3)
    }).toThrowError("2 was unexpected to be less than 3")
  })
})
