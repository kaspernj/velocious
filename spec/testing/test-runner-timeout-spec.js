// @ts-check

import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import {configureTests, describe, expect, it, testConfig, testEvents} from "../../src/testing/test.js"
import TestRunner from "../../src/testing/test-runner.js"

describe("TestRunner timeouts", {databaseCleaning: {transaction: true}}, () => {
  const delay = (ms) => new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)

    // The body is meant to be aborted by the per-test timeout; unref so the
    // abandoned timer never keeps the process alive after the test completes.
    if (typeof timer.unref === "function") timer.unref()
  })

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
              await delay(5000)
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
              await delay(5000)
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
})
