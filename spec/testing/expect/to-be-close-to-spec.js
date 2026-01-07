// @ts-check

import {describe, expect, it} from "../../../src/testing/test.js"

describe("Expect#toBeCloseTo", () => {
  it("passes when the value is close to the expected", () => {
    expect(0.2 + 0.1).toBeCloseTo(0.3)
  })

  it("fails when the value is not close to the expected", async () => {
    await expect(() => {
      expect(0.31).toBeCloseTo(0.3, 2)
    }).toThrowError("0.31 wasn't expected to be close to 0.3")
  })

  it("fails when negated and the value is close to the expected", async () => {
    await expect(() => {
      expect(0.304).not.toBeCloseTo(0.3, 2)
    }).toThrowError("0.304 was unexpected to be close to 0.3")
  })
})
