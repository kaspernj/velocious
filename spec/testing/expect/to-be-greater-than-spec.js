// @ts-check

import {describe, expect, it} from "../../../src/testing/test.js"

describe("Expect#toBeGreaterThan", () => {
  it("passes when the value is greater than the expected", () => {
    expect(4).toBeGreaterThan(3)
  })

  it("fails when the value is less than or equal to the expected", async () => {
    await expect(() => {
      expect(3).toBeGreaterThan(3)
    }).toThrowError("3 wasn't expected to be less than or equal to 3")
  })

  it("fails when negated and the value is greater than the expected", async () => {
    await expect(() => {
      expect(4).not.toBeGreaterThan(3)
    }).toThrowError("4 was unexpected to be greater than 3")
  })
})
