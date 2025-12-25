// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"

describe("Expect#toEqual", () => {
  it("reports missing and unexpected array items on failure", async () => {
    await expect(() => {
      expect(["a", "b"]).toEqual(["a", "c"])
    }).toThrowError('["a","b"] wasn\'t equal to ["a","c"] (diff: missing "c"; unexpected "b")')
  })
})
