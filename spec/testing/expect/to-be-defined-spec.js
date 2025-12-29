// @ts-check

import {describe, expect, it} from "../../../src/testing/test.js"

describe("Expect#toBeDefined", () => {
  it("passes when the value is defined", () => {
    expect("value").toBeDefined()
  })

  it("fails when the value is undefined", async () => {
    await expect(() => {
      expect(undefined).toBeDefined()
    }).toThrowError("undefined wasn't expected be undefined")
  })
})
