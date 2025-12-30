// @ts-check

import {describe, expect, it} from "../../../src/testing/test.js"

describe("Expect#toBeNull", () => {
  it("passes when the value is null", () => {
    expect(null).toBeNull()
  })

  it("fails when the value is not null", async () => {
    await expect(() => {
      expect(0).toBeNull()
    }).toThrowError("0 wasn't expected be null")
  })
})
