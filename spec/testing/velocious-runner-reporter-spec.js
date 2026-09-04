// @ts-check

import VelociousRunnerReporter from "../../src/testing/velocious-runner-reporter.js"
import { describe, expect, it, testEvents } from "../../src/testing/test.js"
import { buildTestingRunner } from "../helpers/testing-runner-parity.js"

describe("VelociousRunnerReporter", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("awaits legacy events in order and preserves raw failure identity", async () => {
    const testRunner = buildTestingRunner()
    const reporter = new VelociousRunnerReporter({testRunner})
    const order = []
    const failure = new Error("attempt failed")
    const handlers = new Map()

    for (const eventName of ["testAttemptFailed", "testRetrying", "testRetried"]) {
      const handler = async (payload) => {
        order.push(`${eventName}:start`)
        await Promise.resolve()
        order.push(`${eventName}:end`)
        expect(payload.error).toBe(failure)
      }

      handlers.set(eventName, handler)
      testEvents.on(eventName, handler)
    }

    try {
      await reporter.reportAttempt({
        attemptConsoleOutputs: [],
        attemptNumber: 2,
        descriptions: ["adapter"],
        error: failure,
        failed: true,
        leftPadding: "",
        retriesUsed: 1,
        retryCount: 2,
        testArgs: {},
        testData: {args: {}, function: async () => {}},
        testDescription: "reports",
        willRetry: true
      })
    } finally {
      for (const [eventName, handler] of handlers) testEvents.off(eventName, handler)
    }

    expect(order).toEqual([
      "testAttemptFailed:start", "testAttemptFailed:end",
      "testRetrying:start", "testRetrying:end",
      "testRetried:start", "testRetried:end"
    ])
    expect(testRunner.getSuccessfulTests()).toBe(0)
    expect(testRunner.getFailedTests()).toBe(0)
  })

  it("projects final falsy failures into failed results", async () => {
    const testRunner = buildTestingRunner()
    const reporter = new VelociousRunnerReporter({testRunner})
    const failedEvents = []
    const handler = (payload) => failedEvents.push(payload)

    testEvents.on("testFailed", handler)

    try {
      await reporter.reportAttempt({
        attemptConsoleOutputs: [],
        attemptNumber: 1,
        descriptions: [],
        error: undefined,
        failed: true,
        leftPadding: "",
        retriesUsed: 0,
        retryCount: 0,
        testArgs: {},
        testData: {args: {}, filePath: "falsy-spec.js", line: 12, function: async () => {}},
        testDescription: "throws undefined",
        willRetry: false
      })
    } finally {
      testEvents.off("testFailed", handler)
    }

    expect(testRunner.getFailedTests()).toBe(1)
    expect(testRunner.getSuccessfulTests()).toBe(0)
    expect(testRunner.getFailedTestDetails()[0].error).toBeUndefined()
    expect(failedEvents.length).toBe(1)
    expect(failedEvents[0].error).toBeUndefined()
  })
})
