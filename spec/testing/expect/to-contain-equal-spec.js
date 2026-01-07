// @ts-check

import {describe, expect, it} from "../../../src/testing/test.js"

describe("Expect#toContainEqual", () => {
  it("passes when the array contains an equal value", () => {
    expect([{id: 1}, {id: 2}]).toContainEqual({id: 2})
  })

  it("fails when the array does not contain an equal value", async () => {
    await expect(() => {
      expect([{id: 1}]).toContainEqual({id: 2})
    }).toThrowError("[{\"id\":1}] doesn't contain {\"id\":2}")
  })

  it("fails when negated and the array contains an equal value", async () => {
    await expect(() => {
      expect([{id: 1}]).not.toContainEqual({id: 1})
    }).toThrowError("[{\"id\":1}] was unexpected to contain {\"id\":1}")
  })
})
