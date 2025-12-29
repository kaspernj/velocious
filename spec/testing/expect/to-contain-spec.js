// @ts-check

import {describe, expect, it} from "../../../src/testing/test.js"

describe("Expect#toContain", () => {
  it("passes for arrays and strings that contain the value", () => {
    expect([1, 2, 3]).toContain(2)
    expect("hello").toContain("ell")
  })

  it("fails when the value is not contained", async () => {
    await expect(() => {
      expect("hello").toContain("world")
    }).toThrowError('"hello" doesn\'t contain "world"')
  })
})
