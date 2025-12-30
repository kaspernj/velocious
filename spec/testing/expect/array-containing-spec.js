// @ts-check

import {describe, expect, it} from "../../../src/testing/test.js"

describe("Expect.arrayContaining", () => {
  it("matches array subsets in toEqual", () => {
    expect([1, 2, 3]).toEqual(expect.arrayContaining([2, 3]))
  })

  it("matches nested objectContaining items", () => {
    expect([{id: 1}, {id: 2, name: "ok"}]).toEqual(expect.arrayContaining([expect.objectContaining({id: 2})]))
  })

  it("fails when the subset does not match", async () => {
    await expect(() => {
      expect([1, 2, 3]).toEqual(expect.arrayContaining([2, 4]))
    }).toThrowError('Expected [1,2,3] to match [2,4] (diff: {"$":[[2,4],[1,2,3]]})')
  })

  it("fails with not when the subset matches", async () => {
    await expect(() => {
      expect([1, 2, 3]).not.toEqual(expect.arrayContaining([1]))
    }).toThrowError("Expected [1,2,3] not to match [1]")
  })

  it("throws when the matcher argument is not an array", async () => {
    await expect(() => {
      expect.arrayContaining("nope")
    }).toThrowError("Expected array but got string")
  })
})
