// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import AsyncTrackedMultiConnection from "../../src/database/pool/async-tracked-multi-connection.js"

describe("TestRunner dummy connection scope", {
  databaseCleaning: {transaction: false, truncate: false},
  tags: ["dummy"]
}, () => {
  it("does not pin configured connections around transaction-disabled test callbacks", () => {
    const pool = dummyConfiguration.getDatabasePool("default")

    if (!(pool instanceof AsyncTrackedMultiConnection)) return

    expect(pool.getCurrentContextConnection()).toBeUndefined()
  })
})
