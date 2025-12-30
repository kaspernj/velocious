// @ts-check

import {describe, expect, it} from "../../../src/testing/test.js"

describe("Expect#toMatch", () => {
  it("passes when the string matches the regex", () => {
    expect("hello").toMatch(/ell/)
  })

  it("fails when the string does not match the regex", async () => {
    await expect(() => {
      expect("hello").toMatch(/world/)
    }).toThrowError('"hello" didn\'t match /world/')
  })
})
