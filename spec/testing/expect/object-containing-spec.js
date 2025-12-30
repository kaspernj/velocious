// @ts-check

import {describe, expect, it} from "../../../src/testing/test.js"

describe("Expect.objectContaining", () => {
  it("matches object subsets in toEqual", () => {
    const actual = {a: 1, b: 2}

    expect(actual).toEqual(expect.objectContaining({a: 1}))
  })

  it("fails when the subset does not match", async () => {
    await expect(() => {
      expect({a: 1, b: 2}).toEqual(expect.objectContaining({a: 2}))
    }).toThrowError('Expected {"a":1,"b":2} to match {"a":2} (diff: {"a":[2,1]})')
  })

  it("fails with not when the subset matches", async () => {
    await expect(() => {
      expect({a: 1, b: 2}).not.toEqual(expect.objectContaining({a: 1}))
    }).toThrowError('Expected {"a":1,"b":2} not to match {"a":1}')
  })

  it("throws when the matcher argument is not an object", async () => {
    await expect(() => {
      expect.objectContaining(5)
    }).toThrowError("Expected object but got number")
  })
})
