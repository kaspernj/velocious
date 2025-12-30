// @ts-check

import {describe, expect, it} from "../../../src/testing/test.js"

describe("Expect#toBeTruthy", () => {
  it("passes when the value is truthy", () => {
    expect("hello").toBeTruthy()
    expect(1).toBeTruthy()
  })

  it("fails when the value is falsy", async () => {
    await expect(() => {
      expect(0).toBeTruthy()
    }).toThrowError("0 wasn't expected to be truthy")
  })

  it("fails when used with not and the value is truthy", async () => {
    await expect(() => {
      expect("hello").not.toBeTruthy()
    }).toThrowError("hello was unexpected to be truthy")
  })
})
