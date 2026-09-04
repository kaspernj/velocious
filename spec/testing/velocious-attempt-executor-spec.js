// @ts-check

import {createTestContext} from "@velocious/testing"
import VelociousAttemptExecutor from "../../src/testing/velocious-attempt-executor.js"
import TestProfiler from "../../src/testing/test-profiler.js"
import { describe, expect, it } from "../../src/testing/test.js"
import { buildTestingRunner } from "../helpers/testing-runner-parity.js"

class ConsoleOrderProfiler extends TestProfiler {
  /**
   * @param {object} args - Profiler arguments.
   * @param {import("../../src/configuration.js").default} args.configuration - Test configuration.
   * @param {(...args: Array<ReturnType<typeof JSON.parse>>) => void} args.originalConsoleLog - Console method captured before the attempt.
   */
  constructor({configuration, originalConsoleLog}) {
    super({configuration, projectDirectory: process.cwd()})
    this.originalConsoleLog = originalConsoleLog
    this.consoleRestoredBeforeFinish = false
  }

  /** @param {import("../../src/testing/test-profiler.js").TestProfileAttemptHandle} handle @param {import("../../src/testing/test-profiler.js").TestProfileAttemptStatus} status */
  finishAttempt(handle, status) {
    this.consoleRestoredBeforeFinish = console.log === this.originalConsoleLog
    super.finishAttempt(handle, status)
  }
}

/**
 * @param {object} args - Attempt fixture.
 * @param {() => (void | Promise<void>)} args.body - Test callback.
 * @param {import("@velocious/testing/runner").TestContext} args.context - Package context.
 * @param {Array<(args: ReturnType<typeof JSON.parse>) => (void | Promise<void>)} [args.beforeEach] - Setup hooks.
 * @param {Array<(args: ReturnType<typeof JSON.parse>) => (void | Promise<void>)} [args.afterEach] - Cleanup hooks.
 * @returns {{suite: import("@velocious/testing/runner").SuiteDeclaration, test: import("@velocious/testing/runner").TestDeclaration}}
 */
function declareAttempt({body, context, beforeEach = [], afterEach = []}) {
  context.describe("adapter", {databaseCleaning: {transaction: false, truncate: false}}, () => {
    for (const hook of beforeEach) context.beforeEach(hook)
    for (const hook of afterEach) context.afterEach(hook)
    context.it("one attempt", body)
  })
  const suite = context.registry.suites[0]
  const test = suite.tests[0]
  return {suite, test}
}

describe("VelociousAttemptExecutor", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("disables non-positive and non-finite timeout values", () => {
    const context = createTestContext()
    const testRunner = buildTestingRunner({context})
    const executor = new VelociousAttemptExecutor({testRunner})

    expect(executor.normalizeTimeoutMs(1000)).toBe(1000)
    expect(executor.normalizeTimeoutMs(0)).toBeUndefined()
    expect(executor.normalizeTimeoutMs(-1)).toBeUndefined()
    expect(executor.normalizeTimeoutMs(Number.NaN)).toBeUndefined()
    expect(executor.normalizeTimeoutMs(Number.POSITIVE_INFINITY)).toBeUndefined()
  })

  it("runs exactly one package attempt with legacy hook arguments", async () => {
    const context = createTestContext()
    const testRunner = buildTestingRunner({context})
    const executor = new VelociousAttemptExecutor({testRunner})
    const order = []
    const hookArguments = []
    let callbackArgument
    const {suite, test} = declareAttempt({
      context,
      beforeEach: [async (args) => { order.push("beforeEach"); hookArguments.push(args) }],
      body: async (testArgs) => { order.push("body"); callbackArgument = testArgs },
      afterEach: [async (args) => { order.push("afterEach"); hookArguments.push(args) }]
    })

    testRunner.analyzeDeclarations()
    const compatibility = await testRunner.testCompatibility(test)
    await executor.execute({
      afterEach: suite.hooks.afterEach,
      args: [compatibility.testArgs],
      attemptNumber: 1,
      beforeEach: suite.hooks.beforeEach,
      context,
      defaultExecute: async () => {},
      fullName: "adapter one attempt",
      suite,
      test,
      timeoutMs: 1000
    })

    expect(order).toEqual(["beforeEach", "body", "afterEach"])
    expect(callbackArgument).toBe(compatibility.testArgs)
    expect(hookArguments.map((args) => Object.keys(args).sort())).toEqual([
      ["configuration", "testArgs", "testData"],
      ["configuration", "testArgs", "testData"]
    ])
    expect(hookArguments.every((args) => args.testArgs === compatibility.testArgs)).toBeTrue()
    expect(hookArguments.every((args) => args.testData === compatibility.testData)).toBeTrue()
    expect(testRunner.attemptOutcome(test, 1)?.failed).toBeFalse()
  })

  it("retains falsy lifecycle failures and still runs cleanup hooks", async () => {
    const context = createTestContext()
    const testRunner = buildTestingRunner({context})
    const executor = new VelociousAttemptExecutor({testRunner})
    const bodyFailure = null
    const cleanupFailure = false
    let cleanupRuns = 0
    const {suite, test} = declareAttempt({
      context,
      body: async () => { throw bodyFailure },
      afterEach: [async () => {
        cleanupRuns++
        throw cleanupFailure
      }]
    })

    testRunner.analyzeDeclarations()
    const compatibility = await testRunner.testCompatibility(test)
    let caughtError
    try {
      await executor.execute({
        afterEach: suite.hooks.afterEach,
        args: [compatibility.testArgs],
        attemptNumber: 1,
        beforeEach: suite.hooks.beforeEach,
        context,
        defaultExecute: async () => {},
        fullName: "adapter one attempt",
        suite,
        test,
        timeoutMs: 1000
      })
    } catch (error) {
      caughtError = error
    }

    expect(cleanupRuns).toBe(1)
    expect(caughtError).toBeInstanceOf(AggregateError)
    expect(caughtError.errors).toEqual([bodyFailure, cleanupFailure])
    expect(testRunner.attemptOutcome(test, 1)?.failed).toBeTrue()
    expect(testRunner.attemptOutcome(test, 1)?.error).toBe(caughtError)
  })

  it("finalizes the profiler after the framework lifecycle settles", async () => {
    const context = createTestContext()
    const testRunner = buildTestingRunner({context})
    const profiler = new ConsoleOrderProfiler({
      configuration: testRunner.getConfiguration(),
      originalConsoleLog: console.log
    })
    testRunner._profiler = profiler
    const executor = new VelociousAttemptExecutor({testRunner})
    const {suite, test} = declareAttempt({context, body: async () => {}})

    testRunner.analyzeDeclarations()
    const compatibility = await testRunner.testCompatibility(test)
    await executor.execute({
      afterEach: [],
      args: [compatibility.testArgs],
      attemptNumber: 1,
      beforeEach: [],
      context,
      defaultExecute: async () => {},
      fullName: "adapter one attempt",
      suite,
      test,
      timeoutMs: 1000
    })

    expect(profiler.consoleRestoredBeforeFinish).toBeTrue()
  })
})
