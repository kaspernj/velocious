// @ts-check

import {describe, expect, it} from "../../../src/testing/test.js"

describe("Expect#toBeTrue", () => {
  it("passes when the value is true", () => {
    expect(true).toBeTrue()
  })

  it("fails when the value is not true", async () => {
    await expect(() => {
      expect(false).toBeTrue()
    }).toThrowError("false wasn't expected be true")
  })
})
