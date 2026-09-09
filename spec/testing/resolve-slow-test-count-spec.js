// @ts-check

import {resolveSlowTestCount} from "../../src/environment-handlers/node/cli/commands/test.js"
import {describe, expect, it} from "../../src/testing/test.js"

describe("resolveSlowTestCount", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("defaults to 10 when the env value is unset", () => {
    expect(resolveSlowTestCount(undefined)).toEqual(10)
  })

  it("uses a provided positive count", () => {
    expect(resolveSlowTestCount("20")).toEqual(20)
  })

  it("disables the report for 0", () => {
    expect(resolveSlowTestCount("0")).toEqual(0)
  })

  it("floors positive values, and clamps negatives/unparseable values to 0 (disabled)", () => {
    expect(resolveSlowTestCount("4.9")).toEqual(4)
    expect(resolveSlowTestCount("-3")).toEqual(0)
    expect(resolveSlowTestCount("abc")).toEqual(0)
  })
})
