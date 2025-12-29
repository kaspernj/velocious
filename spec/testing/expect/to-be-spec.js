// @ts-check

import {describe, expect, it} from "../../../src/testing/test.js"

describe("Expect#toBe", () => {
  it("passes when values are strictly equal", () => {
    expect(3).toBe(3)
  })

  it("fails when values differ", async () => {
    await expect(() => {
      expect(3).toBe(4)
    }).toThrowError("3 wasn't expected be 4")
  })

  it("supports not", async () => {
    await expect(() => {
      expect(3).not.toBe(3)
    }).toThrowError("3 was unexpected not to be 3")
  })
})
