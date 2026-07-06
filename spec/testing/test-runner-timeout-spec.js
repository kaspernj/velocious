// @ts-check

import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import {configureTests, describe, expect, it, testConfig, testEvents} from "../../src/testing/test.js"
import TestRunner from "../../src/testing/test-runner.js"
import wait from "awaitery/build/wait.js"

describe("TestRunner timeouts", {databaseCleaning: {transaction: true}}, () => {

  it("times out tests using the configured default", async () => {
    const previousTimeoutSeconds = testConfig.defaultTimeoutSeconds
    const environmentHandler = new EnvironmentHandlerNode()
    const configuration = new Configuration({
      database: {test: {}},
      directory: process.cwd(),
      environment: "test",
      environmentHandler,
      initializeModels: async () => {},
      locale: "en",
      localeFallbacks: {en: ["en"]},
      locales: ["en"]
    })
    const testRunner = new TestRunner({configuration, testFiles: []})

    /** @type {any} */
    let eventPayload
    const handler = (payload) => {
      eventPayload = payload
    }

    configureTests({defaultTimeoutSeconds: 0.01})
    testEvents.on("testFailed", handler)

    try {
      const tests = {
        args: {},
        afterEaches: [],
        beforeEaches: [],
        subs: {},
        tests: {
          "uses default timeout": {
            args: {},
            function: async () => {
              await wait(5000)
            }
          }
        }
      }

      await testRunner.runTests({
        afterEaches: [],
        beforeEaches: [],
        tests,
        descriptions: [],
        indentLevel: 0
      })
    } finally {
      testEvents.off("testFailed", handler)
      configureTests({defaultTimeoutSeconds: previousTimeoutSeconds})
    }

    expect(eventPayload).toBeDefined()
    expect(eventPayload.error.message).toContain("Timed out after 0.01s")
  })

  it("honors per-test timeout overrides", async () => {
    const previousTimeoutSeconds = testConfig.defaultTimeoutSeconds
    const environmentHandler = new EnvironmentHandlerNode()
    const configuration = new Configuration({
      database: {test: {}},
      directory: process.cwd(),
      environment: "test",
      environmentHandler,
      initializeModels: async () => {},
      locale: "en",
      localeFallbacks: {en: ["en"]},
      locales: ["en"]
    })
    const testRunner = new TestRunner({configuration, testFiles: []})

    /** @type {any} */
    let eventPayload
    const handler = (payload) => {
      eventPayload = payload
    }

    configureTests({defaultTimeoutSeconds: 1})
    testEvents.on("testFailed", handler)

    try {
      const tests = {
        args: {},
        afterEaches: [],
        beforeEaches: [],
        subs: {},
        tests: {
          "uses override timeout": {
            args: {timeoutSeconds: 0.005},
            function: async () => {
              await wait(5000)
            }
          }
        }
      }

      await testRunner.runTests({
        afterEaches: [],
        beforeEaches: [],
        tests,
        descriptions: [],
        indentLevel: 0
      })
    } finally {
      testEvents.off("testFailed", handler)
      configureTests({defaultTimeoutSeconds: previousTimeoutSeconds})
    }

    expect(eventPayload).toBeDefined()
    expect(eventPayload.error.message).toContain("Timed out after 0.005s")
  })

  it("waits for a timed-out test's afterEach cleanup to run before starting the next test", async () => {
    const previousTimeoutSeconds = testConfig.defaultTimeoutSeconds
    const environmentHandler = new EnvironmentHandlerNode()
    const configuration = new Configuration({
      database: {test: {}},
      directory: process.cwd(),
      environment: "test",
      environmentHandler,
      initializeModels: async () => {},
      locale: "en",
      localeFallbacks: {en: ["en"]},
      locales: ["en"]
    })
    const testRunner = new TestRunner({configuration, testFiles: []})

    // Records the exact ordering of the timed-out test's body/cleanup relative to
    // the next test's body. When runWithTimeout abandons the lifecycle, the shared
    // per-suite connection is left mid-transaction; the afterEach (which for
    // transaction-based cleaning rolls that transaction back) MUST run before the
    // next test's body, or the next test's startTransaction() implicitly commits
    // the timed-out test's rows and poisons the rest of the shard.
    /** @type {string[]} */
    const order = []

    configureTests({defaultTimeoutSeconds: 1})

    try {
      const tests = {
        args: {},
        afterEaches: [{callback: async () => { order.push("afterEach") }}],
        beforeEaches: [],
        subs: {},
        tests: {
          // Times out at 100ms but its body finishes at 150ms — inside the
          // settlement grace (== the test's own timeout budget) — so the runner
          // can wait for the abandoned lifecycle's afterEach to land.
          "times out but keeps running": {
            args: {timeoutSeconds: 0.1},
            function: async () => {
              order.push("slow-body-start")
              await wait(150)
              order.push("slow-body-end")
            }
          },
          "runs after the timed-out test": {
            args: {},
            function: async () => {
              order.push("next-body")
            }
          }
        }
      }

      await testRunner.runTests({
        afterEaches: [],
        beforeEaches: [],
        tests,
        descriptions: [],
        indentLevel: 0
      })
    } finally {
      configureTests({defaultTimeoutSeconds: previousTimeoutSeconds})
    }

    // The timed-out test's body finishes and its afterEach cleanup lands BEFORE
    // the next test's body runs. Without the fix the runner proceeds to the next
    // test immediately on timeout, so "next-body" would appear before the
    // timed-out test's "slow-body-end"/"afterEach".
    expect(order).toEqual(["slow-body-start", "slow-body-end", "afterEach", "next-body", "afterEach"])
  })
})
