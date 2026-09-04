// @ts-check

import path from "node:path"

import { describe, expect, it, testEvents, tests as registeredTests } from "../../src/testing/test.js"
import {
  buildTestingRunner,
  runTestingScope,
  testingScope
} from "../helpers/testing-runner-parity.js"

describe("testing package runner parity", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("preserves focus and tag selection semantics", async () => {
    const includedCalls = []
    const includedScope = testingScope({
      tests: {
        "fast test": {args: {tags: ["fast"]}, function: async () => { includedCalls.push("fast") }},
        "smoke test": {args: {tags: ["smoke"]}, function: async () => { includedCalls.push("smoke") }},
        "unmatched test": {args: {tags: ["slow"]}, function: async () => { includedCalls.push("unmatched") }}
      }
    })

    await runTestingScope(buildTestingRunner({includeTags: ["fast", "smoke"]}), includedScope)

    expect(includedCalls).toEqual(["fast", "smoke"])

    const focusedCalls = []
    const focusedScope = testingScope({
      subs: {
        "focused suite": testingScope({
          anyTestsFocussed: true,
          args: {focus: true},
          tests: {
            "suite child": {args: {focus: true}, function: async () => { focusedCalls.push("suite") }}
          }
        })
      },
      tests: {
        "included but not focused": {
          args: {tags: ["included"]},
          function: async () => { focusedCalls.push("ordinary") }
        },
        "focused without included tag": {
          args: {focus: true},
          function: async () => { focusedCalls.push("focused") }
        },
        "focused but excluded": {
          args: {focus: true, tags: ["blocked"]},
          function: async () => { focusedCalls.push("excluded") }
        }
      }
    })
    const registrationName = "testing package runner focus parity fixture"
    const focusedRunner = buildTestingRunner({excludeTags: ["blocked"], includeTags: ["included"]})

    registeredTests.subs[registrationName] = focusedScope

    try {
      await focusedRunner.prepare()
      await runTestingScope(focusedRunner, focusedScope)
    } finally {
      delete registeredTests.subs[registrationName]
    }

    expect(focusedCalls).toEqual(["focused", "suite"])
  })

  it("matches line filters at either suite or test declarations", async () => {
    const filePath = path.resolve("spec/testing/fixtures/testing-package/line-filter-fixture.js")
    const suiteCalls = []
    const suiteScope = testingScope({
      subs: {
        selected: testingScope({
          filePath,
          line: 10,
          tests: {
            first: {args: {}, filePath, line: 11, function: async () => { suiteCalls.push("first") }},
            second: {args: {}, filePath, line: 12, function: async () => { suiteCalls.push("second") }}
          }
        })
      }
    })

    await runTestingScope(buildTestingRunner({lineFilters: {[filePath]: [10]}}), suiteScope)

    expect(suiteCalls).toEqual(["first", "second"])

    const testCalls = []
    const testScope = testingScope({
      tests: {
        selected: {args: {}, filePath, line: 20, function: async () => { testCalls.push("selected") }},
        skipped: {args: {}, filePath, line: 21, function: async () => { testCalls.push("skipped") }}
      }
    })

    await runTestingScope(buildTestingRunner({lineFilters: {[filePath]: [20]}}), testScope)

    expect(testCalls).toEqual(["selected"])
  })

  it("repeats the complete per-test lifecycle and preserves hook arguments across retries", async () => {
    const testRunner = buildTestingRunner()
    const configuration = testRunner.getConfiguration()
    const order = []
    const suiteHookArguments = []
    const testHookArguments = []
    const callbackArguments = []
    let attempts = 0
    const scope = testingScope({
      afterAlls: [{callback: async (args) => {
        order.push("afterAll")
        suiteHookArguments.push(args)
      }}],
      afterEaches: [{callback: async (args) => {
        order.push(`afterEach ${attempts}`)
        testHookArguments.push(args)
      }}],
      beforeAlls: [{callback: async (args) => {
        order.push("beforeAll")
        suiteHookArguments.push(args)
      }}],
      beforeEaches: [{callback: async (args) => {
        order.push(`beforeEach ${attempts + 1}`)
        testHookArguments.push(args)
      }}],
      tests: {
        retries: {
          args: {retry: 1},
          function: async (testArgs) => {
            attempts++
            order.push(`test ${attempts}`)
            callbackArguments.push(testArgs)

            if (attempts === 1) throw new Error("retry once")
          }
        }
      }
    })
    const testData = scope.tests.retries

    await runTestingScope(testRunner, scope)

    expect(order).toEqual([
      "beforeAll",
      "beforeEach 1", "test 1", "afterEach 1",
      "beforeEach 2", "test 2", "afterEach 2",
      "afterAll"
    ])
    expect(suiteHookArguments.map((args) => Object.keys(args).sort())).toEqual([
      ["configuration"],
      ["configuration"]
    ])
    expect(suiteHookArguments.every((args) => args.configuration === configuration)).toBeTrue()
    expect(testHookArguments.map((args) => Object.keys(args).sort())).toEqual([
      ["configuration", "testArgs", "testData"],
      ["configuration", "testArgs", "testData"],
      ["configuration", "testArgs", "testData"],
      ["configuration", "testArgs", "testData"]
    ])
    expect(testHookArguments.every((args) => args.configuration === configuration)).toBeTrue()
    expect(testHookArguments.every((args) => args.testData === testData)).toBeTrue()
    expect(testHookArguments.every((args) => args.testArgs === callbackArguments[0])).toBeTrue()
    expect(callbackArguments.length).toBe(2)
    expect(callbackArguments[1]).toBe(callbackArguments[0])
    expect(callbackArguments[0].retry).toBe(1)
    expect(testRunner.getSuccessfulTests()).toBe(1)
    expect(testRunner.getFailedTests()).toBe(0)
  })

  it("runs teardown after setup failures and aggregates teardown failures", async () => {
    const setupOrder = []
    const setupScope = testingScope({
      afterAlls: [{callback: async () => { setupOrder.push("afterAll") }}],
      beforeAlls: [{callback: async () => {
        setupOrder.push("beforeAll")
        throw new Error("setup failed")
      }}],
      subs: {
        child: testingScope({
          tests: {
            descendant: {args: {}, function: async () => { setupOrder.push("descendant") }}
          }
        })
      },
      tests: {
        direct: {args: {}, function: async () => { setupOrder.push("direct") }}
      }
    })

    await expect(async () => {
      await runTestingScope(buildTestingRunner(), setupScope)
    }).toThrowError("setup failed")
    expect(setupOrder).toEqual(["beforeAll", "afterAll"])

    const teardownOrder = []
    const teardownScope = testingScope({
      afterAlls: [
        {callback: async () => {
          teardownOrder.push("framework teardown")
          throw new Error("framework teardown failed")
        }},
        {callback: async () => {
          teardownOrder.push("user teardown")
          throw new Error("user teardown failed")
        }}
      ],
      tests: {
        passing: {args: {}, function: async () => { teardownOrder.push("test") }}
      }
    })
    let teardownError

    try {
      await runTestingScope(buildTestingRunner(), teardownScope)
    } catch (error) {
      teardownError = error
    }

    expect(teardownError).toBeInstanceOf(AggregateError)
    expect(teardownError.errors.map((error) => error.message)).toEqual([
      "user teardown failed",
      "framework teardown failed"
    ])
    expect(teardownOrder).toEqual(["test", "user teardown", "framework teardown"])
  })

  it("awaits legacy event listeners in lifecycle order", async () => {
    const order = []
    const handlers = new Map()

    for (const eventName of ["testAttemptFailed", "testRetrying", "testRetried", "testFailed"]) {
      const handler = async () => {
        order.push(`${eventName}:start`)
        await Promise.resolve()
        order.push(`${eventName}:end`)
      }

      handlers.set(eventName, handler)
      testEvents.on(eventName, handler)
    }

    let attempts = 0
    const scope = testingScope({
      afterEaches: [{callback: async () => { order.push(`afterEach:${attempts}`) }}],
      tests: {
        failing: {
          args: {retry: 1},
          function: async () => {
            attempts++
            order.push(`test:${attempts}`)
            throw new Error(`failure ${attempts}`)
          }
        }
      }
    })

    try {
      await runTestingScope(buildTestingRunner(), scope)
    } finally {
      for (const [eventName, handler] of handlers) testEvents.off(eventName, handler)
    }

    expect(order).toEqual([
      "test:1", "afterEach:1",
      "testAttemptFailed:start", "testAttemptFailed:end",
      "testRetrying:start", "testRetrying:end",
      "test:2", "afterEach:2",
      "testAttemptFailed:start", "testAttemptFailed:end",
      "testRetried:start", "testRetried:end",
      "testFailed:start", "testFailed:end"
    ])
  })

  it("preserves falsy body failures when cleanup also fails", async () => {
    const cases = [undefined, null, false, 0, ""]
    const scope = testingScope({
      afterEaches: [{callback: async () => { throw new Error("cleanup failed") }}]
    })

    for (let index = 0; index < cases.length; index++) {
      const value = cases[index]

      scope.tests[`throw ${index}`] = {
        args: {},
        function: async () => { throw value }
      }
      scope.tests[`reject ${index}`] = {
        args: {},
        function: async () => await Promise.reject(value)
      }
    }

    const testRunner = buildTestingRunner()

    await runTestingScope(testRunner, scope)

    expect(testRunner.getFailedTests()).toBe(cases.length * 2)

    const failedDetails = testRunner.getFailedTestDetails()

    for (let index = 0; index < failedDetails.length; index++) {
      const failure = failedDetails[index].error

      expect(failure).toBeInstanceOf(AggregateError)
      expect(failure.errors[0]).toBe(cases[Math.floor(index / 2)])
      expect(failure.errors[1].message).toBe("cleanup failed")
    }
  })
})
