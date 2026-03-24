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

  it("supports negated contains checks", async () => {
    expect([1, 2, 3]).not.toContain(4)
    expect("hello").not.toContain("world")

    await expect(() => {
      expect([1, 2, 3]).not.toContain(2)
    }).toThrowError("[1,2,3] was unexpected to contain 2")
  })
})
