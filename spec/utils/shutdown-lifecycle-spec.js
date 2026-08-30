// @ts-check

import { runShutdownSteps } from "../../src/utils/shutdown-lifecycle.js"
import { describe, expect, it } from "../../src/testing/test.js"

describe("Shutdown lifecycle aggregation", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("retains an empty aggregate failure and attempts later steps", async () => {
    const emptyAggregate = new AggregateError([], "empty aggregate failure")
    let laterStepRan = false
    let shutdownError

    try {
      await runShutdownSteps({
        message: "shutdown failed",
        steps: [
          () => { throw emptyAggregate },
          () => { laterStepRan = true }
        ]
      })
    } catch (error) {
      shutdownError = error
    }

    expect(shutdownError).toBe(emptyAggregate)
    expect(laterStepRan).toBe(true)
  })
})
