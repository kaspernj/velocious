// @ts-check

import {describe, expect, it} from "../../../src/testing/test.js"

describe("Expect#toThrowError", () => {
  it("passes when the error message matches", async () => {
    await expect(() => {
      throw new Error("boom")
    }).toThrowError("boom")
  })

  it("fails when the error message differs", async () => {
    await expect(async () => {
      await expect(() => {
        throw new Error("boom")
      }).toThrowError("nope")
    }).toThrowError("Expected to fail with 'nope' but failed with 'boom'")
  })
})
