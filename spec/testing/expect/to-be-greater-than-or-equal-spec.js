// @ts-check

import {describe, expect, it} from "../../../src/testing/test.js"

describe("Expect#toBeGreaterThanOrEqual", () => {
  it("passes when the value is greater than or equal to the expected", () => {
    expect(3).toBeGreaterThanOrEqual(3)
    expect(4).toBeGreaterThanOrEqual(3)
  })

  it("fails when the value is less than the expected", async () => {
    await expect(() => {
      expect(2).toBeGreaterThanOrEqual(3)
    }).toThrowError("2 wasn't expected to be less than 3")
  })

  it("fails when negated and the value is greater than or equal to the expected", async () => {
    await expect(() => {
      expect(3).not.toBeGreaterThanOrEqual(3)
    }).toThrowError("3 was unexpected to be greater than or equal to 3")
  })
})
