// @ts-check

import {describe, expect, it} from "../../../src/testing/test.js"

describe("Expect#toBeUndefined", () => {
  it("passes when the value is undefined", () => {
    expect(undefined).toBeUndefined()
  })

  it("fails when the value is defined", async () => {
    await expect(() => {
      expect(null).toBeUndefined()
    }).toThrowError("null wasn't expected be undefined")
  })
})
