// @ts-check

import {describe, expect, it} from "../../../src/testing/test.js"

describe("Expect#toChange", () => {
  it("passes when the change count matches", async () => {
    let count = 1

    await expect(() => {
      count += 2
    }).toChange(() => count).by(2).execute()
  })

  it("fails when the change count differs", async () => {
    let count = 0

    await expect(async () => {
      await expect(() => {
        count += 1
      }).toChange(() => count).by(2).execute()
    }).toThrowError("Expected to change by 2 but changed by 1")
  })
})
