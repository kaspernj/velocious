// @ts-check

import {createTestContext} from "@velocious/testing"
import VelociousRunnerReporter from "../../src/testing/velocious-runner-reporter.js"
import { describe, expect, it, testEvents } from "../../src/testing/test.js"
import { buildTestingRunner } from "../helpers/testing-runner-parity.js"

/** @param {import("@velocious/testing/runner").TestContext} context @param {object} [options] */
function declareTest(context, options = {}) {
  context.describe("adapter", () => {
    context.it("reports", options, () => {})
  })
  return context.registry.suites[0].tests[0]
}

describe("VelociousRunnerReporter", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("awaits legacy attempt events in order and preserves raw failure identity", async () => {
    const context = createTestContext()
    const testRunner = buildTestingRunner({context})
    const reporter = new VelociousRunnerReporter({testRunner})
    const test = declareTest(context, {retry: 2})
    const order = []
    const failure = new Error("attempt failed")
    const handlers = new Map()

    testRunner.analyzeDeclarations()
    testRunner.recordAttemptOutcome(test, 2, {abortRemainingTests: false, error: failure, failed: true})
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
      await reporter.onEvent({protocolMajor: 1, timestamp: 0, type: "test:start", fullName: "adapter reports"})
      await reporter.onEvent({
        protocolMajor: 1,
        timestamp: 0,
        type: "attempt:finish",
        fullName: "adapter reports",
        attempt: {attemptNumber: 2, durationMs: 1, consoleOutput: "", error: {name: "Error", message: failure.message}}
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
    const context = createTestContext()
    const testRunner = buildTestingRunner({context})
    const reporter = new VelociousRunnerReporter({testRunner})
    const test = declareTest(context)
    const failedEvents = []
    const handler = (payload) => failedEvents.push(payload)

    testRunner.analyzeDeclarations()
    testRunner.recordAttemptOutcome(test, 1, {abortRemainingTests: false, error: undefined, failed: true})
    testEvents.on("testFailed", handler)

    try {
      await reporter.onEvent({protocolMajor: 1, timestamp: 0, type: "test:start", fullName: "adapter reports"})
      await reporter.onEvent({
        protocolMajor: 1,
        timestamp: 0,
        type: "attempt:finish",
        fullName: "adapter reports",
        attempt: {attemptNumber: 1, durationMs: 1, consoleOutput: "", error: {name: "Error", message: "undefined"}}
      })
      await reporter.onEvent({
        protocolMajor: 1,
        timestamp: 0,
        type: "test:finish",
        test: {
          fullName: "adapter reports",
          status: "failed",
          attempts: [{attemptNumber: 1, durationMs: 1, consoleOutput: "", error: {name: "Error", message: "undefined"}}],
          location: {},
          error: {name: "Error", message: "undefined"}
        }
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
