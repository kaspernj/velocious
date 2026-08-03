// @ts-check

import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import {describe, expect, it} from "../../src/testing/test.js"
import TestRunner from "../../src/testing/test-runner.js"

describe("TestRunner beforeAll/afterAll", {databaseCleaning: {transaction: true}}, () => {
  it("does not hold a database lease around the whole suite", async () => {
    const environmentHandler = new EnvironmentHandlerNode()

    class LeaseTrackingConfiguration extends Configuration {
      activeLeaseScopes = 0

      /** @template T @param {?} optionsOrCallback - Connection options or callback. @param {?} [callback] - Connection callback. @returns {Promise<T>} Callback result. */
      async ensureConnections(optionsOrCallback, callback) {
        const actualCallback = typeof optionsOrCallback === "function" ? optionsOrCallback : callback

        if (!actualCallback) throw new Error("Expected an ensureConnections callback")

        this.activeLeaseScopes++

        try {
          return await actualCallback({})
        } finally {
          this.activeLeaseScopes--
        }
      }
    }

    const configuration = new LeaseTrackingConfiguration({
      database: {test: {}},
      directory: process.cwd(),
      environment: "test",
      environmentHandler,
      initializeModels: async () => {},
      locale: "en",
      localeFallbacks: {en: ["en"]},
      locales: ["en"]
    })

    class LeaseInspectingTestRunner extends TestRunner {
      /** @returns {Promise<void>} Resolves after checking suite-level connection ownership. */
      async runTests() {
        expect(configuration.activeLeaseScopes).toBe(0)
      }
    }

    const testRunner = new LeaseInspectingTestRunner({configuration, testFiles: []})

    await testRunner.run()
  })

  it("runs beforeAll/afterAll once per scope", async () => {
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

    let parentBeforeAll = 0
    let parentAfterAll = 0
    let childBeforeAll = 0
    let childAfterAll = 0

    const tests = {
      args: {},
      afterAlls: [{callback: async () => { parentAfterAll++ }}],
      afterEaches: [],
      beforeAlls: [{callback: async () => { parentBeforeAll++ }}],
      beforeEaches: [],
      subs: {
        "child": {
          args: {},
          afterAlls: [{callback: async () => { childAfterAll++ }}],
          afterEaches: [],
          beforeAlls: [{callback: async () => { childBeforeAll++ }}],
          beforeEaches: [],
          subs: {},
          tests: {
            "runs once": {
              args: {},
              function: async () => {}
            }
          }
        }
      },
      tests: {
        "parent test": {
          args: {},
          function: async () => {}
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

    expect(parentBeforeAll).toBe(1)
    expect(parentAfterAll).toBe(1)
    expect(childBeforeAll).toBe(1)
    expect(childAfterAll).toBe(1)
  })

  it("skips beforeAll/afterAll when all tests are filtered out", async () => {
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
    const testRunner = new TestRunner({configuration, includeTags: ["fast"], testFiles: []})

    let beforeAllRuns = 0
    let afterAllRuns = 0

    const tests = {
      args: {},
      afterAlls: [{callback: async () => { afterAllRuns++ }}],
      afterEaches: [],
      beforeAlls: [{callback: async () => { beforeAllRuns++ }}],
      beforeEaches: [],
      subs: {},
      tests: {
        "slow test": {
          args: {tags: ["slow"]},
          function: async () => {}
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

    expect(beforeAllRuns).toBe(0)
    expect(afterAllRuns).toBe(0)
    expect(testRunner.getExecutedTestsCount()).toBe(0)
  })

  it("runs afterAll when beforeAll throws", async () => {
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

    let afterAllRuns = 0
    const tests = {
      args: {},
      afterAlls: [{callback: async () => { afterAllRuns++ }}],
      afterEaches: [],
      beforeAlls: [{callback: async () => { throw new Error("boom") }}],
      beforeEaches: [],
      subs: {},
      tests: {
        "never runs": {
          args: {},
          function: async () => {}
        }
      }
    }

    await expect(async () => {
      await testRunner.runTests({
        afterEaches: [],
        beforeEaches: [],
        tests,
        descriptions: [],
        indentLevel: 0
      })
    }).toThrowError("boom")

    expect(afterAllRuns).toBe(1)
  })

  it("runs active afterAll hooks once when interrupted", async () => {
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

    let afterAllRuns = 0
    let beforeAllStarted
    const beforeAllStartedPromise = new Promise((resolve) => { beforeAllStarted = resolve })
    let allowBeforeAllFinish
    const beforeAllBlocker = new Promise((resolve) => { allowBeforeAllFinish = resolve })

    const tests = {
      args: {},
      afterAlls: [{callback: async () => { afterAllRuns++ }}],
      afterEaches: [],
      beforeAlls: [{
        callback: async () => {
          beforeAllStarted()
          await beforeAllBlocker
        }
      }],
      beforeEaches: [],
      subs: {},
      tests: {
        "runs after resume": {
          args: {},
          function: async () => {}
        }
      }
    }

    const runPromise = testRunner.runTests({
      afterEaches: [],
      beforeEaches: [],
      tests,
      descriptions: [],
      indentLevel: 0
    })

    await beforeAllStartedPromise
    await testRunner.runAfterAllsForActiveScopes()
    allowBeforeAllFinish()
    await runPromise

    expect(afterAllRuns).toBe(1)
  })
})
