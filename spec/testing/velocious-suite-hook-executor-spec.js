// @ts-check

import {createTestContext} from "@velocious/testing"
import VelociousSuiteHookExecutor from "../../src/testing/velocious-suite-hook-executor.js"
import { describe, expect, it } from "../../src/testing/test.js"
import { buildTestingRunner } from "../helpers/testing-runner-parity.js"

describe("VelociousSuiteHookExecutor", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("passes only configuration through the package hook callback", async () => {
    const context = createTestContext()
    const testRunner = buildTestingRunner({context})
    const executor = new VelociousSuiteHookExecutor({testRunner})
    let hookArguments

    context.describe("suite", () => {
      context.beforeAll((args) => { hookArguments = args })
      context.it("test", () => {})
    })
    testRunner.analyzeDeclarations()
    const suite = context.registry.suites[0]
    const hook = suite.hooks.beforeAll[0]

    await executor.execute({
      context,
      defaultExecute: async (args = []) => await hook.callback(...args),
      fullName: "suite",
      hook,
      phase: "beforeAll",
      suite,
      timeoutMs: 1000
    })

    expect(Object.keys(hookArguments)).toEqual(["configuration"])
    expect(hookArguments.configuration).toBe(testRunner.getConfiguration())
  })
})
