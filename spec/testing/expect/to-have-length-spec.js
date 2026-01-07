// @ts-check

import {describe, expect, it} from "../../../src/testing/test.js"

describe("Expect#toHaveLength", () => {
  it("passes when the value has the expected length", () => {
    expect([1, 2, 3]).toHaveLength(3)
    expect("abc").toHaveLength(3)
  })

  it("fails when the value does not have the expected length", async () => {
    await expect(() => {
      expect([1]).toHaveLength(2)
    }).toThrowError("[1] wasn't expected to have length 2")
  })

  it("fails when negated and the value has the expected length", async () => {
    await expect(() => {
      expect([1]).not.toHaveLength(1)
    }).toThrowError("[1] was unexpected to have length 1")
  })
})
