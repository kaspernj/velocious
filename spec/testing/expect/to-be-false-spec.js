// @ts-check

import {describe, expect, it} from "../../../src/testing/test.js"

describe("Expect#toBeFalse", () => {
  it("passes when the value is false", () => {
    expect(false).toBeFalse()
  })

  it("fails when the value is not false", async () => {
    await expect(() => {
      expect(true).toBeFalse()
    }).toThrowError("true wasn't expected be false")
  })
})
