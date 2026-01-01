// @ts-check

import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import {configureTests, describe, expect, it, testConfig, testEvents} from "../../src/testing/test.js"
import TestRunner from "../../src/testing/test-runner.js"

describe("TestRunner timeouts", () => {
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  it("times out tests using the configured default", async () => {
    const previousTimeoutMs = testConfig.defaultTimeoutMs
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

    configureTests({defaultTimeoutMs: 10})
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
              await delay(20)
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
      configureTests({defaultTimeoutMs: previousTimeoutMs})
    }

    expect(eventPayload).toBeDefined()
    expect(eventPayload.error.message).toContain("Timed out after 10ms")
  })

  it("honors per-test timeout overrides", async () => {
    const previousTimeoutMs = testConfig.defaultTimeoutMs
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

    configureTests({defaultTimeoutMs: 1000})
    testEvents.on("testFailed", handler)

    try {
      const tests = {
        args: {},
        afterEaches: [],
        beforeEaches: [],
        subs: {},
        tests: {
          "uses override timeout": {
            args: {timeoutMs: 5},
            function: async () => {
              await delay(20)
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
      configureTests({defaultTimeoutMs: previousTimeoutMs})
    }

    expect(eventPayload).toBeDefined()
    expect(eventPayload.error.message).toContain("Timed out after 5ms")
  })
})
