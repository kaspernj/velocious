// @ts-check

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

  /**
   * @param {import("../../src/testing/test-profiler.js").TestProfileAttemptHandle} handle - Attempt handle.
   * @param {import("../../src/testing/test-profiler.js").TestProfileAttemptStatus} status - Attempt status.
   * @returns {void}
   */
  finishAttempt(handle, status) {
    this.consoleRestoredBeforeFinish = console.log === this.originalConsoleLog
    super.finishAttempt(handle, status)
  }
}

describe("VelociousAttemptExecutor", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("runs exactly one complete attempt with legacy hook arguments", async () => {
    const testRunner = buildTestingRunner()
    const executor = new VelociousAttemptExecutor({testRunner})
    const order = []
    const hookArguments = []
    const testArgs = {databaseCleaning: {transaction: false, truncate: false}, retry: 3}
    const testData = {
      args: testArgs,
      function: async (callbackArgs) => {
        order.push("body")
        expect(callbackArgs).toBe(testArgs)
      }
    }

    const result = await executor.execute({
      afterEaches: [{callback: async (args) => {
        order.push("afterEach")
        hookArguments.push(args)
      }}],
      attemptNumber: 1,
      beforeEaches: [{callback: async (args) => {
        order.push("beforeEach")
        hookArguments.push(args)
      }}],
      descriptions: ["adapter"],
      testArgs,
      testData,
      testDescription: "one attempt"
    })

    expect(order).toEqual(["beforeEach", "body", "afterEach"])
    expect(hookArguments.map((args) => Object.keys(args).sort())).toEqual([
      ["configuration", "testArgs", "testData"],
      ["configuration", "testArgs", "testData"]
    ])
    expect(hookArguments.every((args) => args.configuration === testRunner.getConfiguration())).toBeTrue()
    expect(hookArguments.every((args) => args.testArgs === testArgs)).toBeTrue()
    expect(hookArguments.every((args) => args.testData === testData)).toBeTrue()
    expect(result.failed).toBeFalse()
  })

  it("retains falsy lifecycle failures and still runs cleanup hooks", async () => {
    const testRunner = buildTestingRunner()
    const executor = new VelociousAttemptExecutor({testRunner})
    const bodyFailure = null
    const cleanupFailure = false
    let bodyRuns = 0
    let cleanupRuns = 0
    const testArgs = {databaseCleaning: {transaction: false, truncate: false}}
    const testData = {
      args: testArgs,
      function: async () => {
        bodyRuns++
        throw bodyFailure
      }
    }

    const result = await executor.execute({
      afterEaches: [{callback: async () => {
        cleanupRuns++
        throw cleanupFailure
      }}],
      attemptNumber: 1,
      beforeEaches: [],
      descriptions: [],
      testArgs,
      testData,
      testDescription: "falsy failures"
    })

    expect(bodyRuns).toBe(1)
    expect(cleanupRuns).toBe(1)
    expect(result.failed).toBeTrue()
    expect(result.error).toBeInstanceOf(AggregateError)
    expect(result.error.errors).toEqual([bodyFailure, cleanupFailure])
  })

  it("restores console capture before profiler finalization", async () => {
    const testRunner = buildTestingRunner()
    const profiler = new ConsoleOrderProfiler({
      configuration: testRunner.getConfiguration(),
      originalConsoleLog: console.log
    })
    testRunner._profiler = profiler
    const executor = new VelociousAttemptExecutor({testRunner})
    const testArgs = {databaseCleaning: {transaction: false, truncate: false}}
    const testData = {args: testArgs, function: async () => {}}

    await executor.execute({
      afterEaches: [],
      attemptNumber: 1,
      beforeEaches: [],
      descriptions: [],
      testArgs,
      testData,
      testDescription: "console ordering"
    })

    expect(profiler.consoleRestoredBeforeFinish).toBeTrue()
  })
})
