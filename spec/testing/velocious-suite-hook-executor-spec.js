// @ts-check

import VelociousSuiteHookExecutor from "../../src/testing/velocious-suite-hook-executor.js"
import { describe, expect, it } from "../../src/testing/test.js"
import { buildTestingRunner } from "../helpers/testing-runner-parity.js"

describe("VelociousSuiteHookExecutor", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("passes only configuration to setup and runs all teardown in reverse order", async () => {
    const testRunner = buildTestingRunner()
    const executor = new VelociousSuiteHookExecutor({testRunner})
    const order = []
    const hookArguments = []
    const firstCleanupError = new Error("first cleanup failed")
    const secondCleanupError = new Error("second cleanup failed")
    const beforeAlls = [{callback: async (args) => {
      order.push("setup")
      hookArguments.push(args)
    }}]
    const afterAlls = [
      {callback: async (args) => {
        order.push("first cleanup")
        hookArguments.push(args)
        throw firstCleanupError
      }},
      {callback: async (args) => {
        order.push("second cleanup")
        hookArguments.push(args)
        throw secondCleanupError
      }}
    ]

    await executor.runBeforeAlls({hooks: beforeAlls})
    let cleanupError

    try {
      await executor.runAfterAlls({hooks: afterAlls})
    } catch (error) {
      cleanupError = error
    }

    expect(order).toEqual(["setup", "second cleanup", "first cleanup"])
    expect(hookArguments.map((args) => Object.keys(args))).toEqual([
      ["configuration"],
      ["configuration"],
      ["configuration"]
    ])
    expect(hookArguments.every((args) => args.configuration === testRunner.getConfiguration())).toBeTrue()
    expect(cleanupError).toBeInstanceOf(AggregateError)
    expect(cleanupError.errors).toEqual([secondCleanupError, firstCleanupError])
  })
})
