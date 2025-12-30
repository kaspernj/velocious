// @ts-check

import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import {describe, expect, it, testEvents} from "../../src/testing/test.js"
import TestRunner from "../../src/testing/test-runner.js"

describe("TestRunner events", () => {
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  it("emits testFailed with test details", async () => {
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

    testEvents.on("testFailed", handler)

    try {
      const tests = {
        args: {},
        afterEaches: [],
        beforeEaches: [],
        subs: {},
        tests: {
          "fails once": {
            args: {retry: 0},
            function: async () => {
              throw new Error("boom")
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
    }

    expect(eventPayload).toBeDefined()
    expect(eventPayload.testDescription).toBe("fails once")
    expect(eventPayload.testArgs.retry).toBe(0)
    expect(eventPayload.testRunner).toBe(testRunner)
    expect(eventPayload.error.message).toBe("boom")
  })

  it("waits for async testFailed handlers", async () => {
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

    let handlerCompleted = false
    const handler = async () => {
      await delay(20)
      handlerCompleted = true
    }

    testEvents.on("testFailed", handler)

    try {
      const tests = {
        args: {},
        afterEaches: [],
        beforeEaches: [],
        subs: {},
        tests: {
          "fails once": {
            args: {retry: 0},
            function: async () => {
              throw new Error("boom")
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
    }

    expect(handlerCompleted).toBe(true)
  })
})
