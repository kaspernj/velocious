// @ts-check

import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
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

  it("emits testRetrying before a retry attempt", async () => {
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

    /** @type {any[]} */
    const retryingEvents = []
    const handler = (payload) => {
      retryingEvents.push(payload)
    }

    testEvents.on("testRetrying", handler)

    try {
      let attempts = 0
      const tests = {
        args: {},
        afterEaches: [],
        beforeEaches: [],
        subs: {},
        tests: {
          "retries once": {
            args: {retry: 1},
            function: async () => {
              attempts++
              if (attempts === 1) throw new Error("boom")
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
      testEvents.off("testRetrying", handler)
    }

    expect(retryingEvents.length).toBe(1)
    expect(retryingEvents[0].testDescription).toBe("retries once")
    expect(retryingEvents[0].retriesUsed).toBe(1)
    expect(retryingEvents[0].retryCount).toBe(1)
    expect(retryingEvents[0].nextAttempt).toBe(2)
    expect(retryingEvents[0].error.message).toBe("boom")
    expect(retryingEvents[0].testRunner).toBe(testRunner)
  })

  it("emits testRetried after a retry attempt", async () => {
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

    /** @type {any[]} */
    const retriedEvents = []
    const handler = (payload) => {
      retriedEvents.push(payload)
    }

    testEvents.on("testRetried", handler)

    try {
      let attempts = 0
      const tests = {
        args: {},
        afterEaches: [],
        beforeEaches: [],
        subs: {},
        tests: {
          "retries once": {
            args: {retry: 1},
            function: async () => {
              attempts++
              if (attempts === 1) throw new Error("boom")
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
      testEvents.off("testRetried", handler)
    }

    expect(retriedEvents.length).toBe(1)
    expect(retriedEvents[0].testDescription).toBe("retries once")
    expect(retriedEvents[0].attemptNumber).toBe(2)
    expect(retriedEvents[0].retriesUsed).toBe(1)
    expect(retriedEvents[0].retryCount).toBe(1)
    expect(retriedEvents[0].error).toBeUndefined()
    expect(retriedEvents[0].testRunner).toBe(testRunner)
  })

  it("collects failed test details for summary output", async () => {
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

    const tests = {
      args: {},
      afterEaches: [],
      afterAlls: [],
      beforeAlls: [],
      beforeEaches: [],
      subs: {},
      tests: {
        "fails once": {
          args: {},
          filePath: "/tmp/sample-spec.js",
          line: 42,
          function: async () => {
            console.log("console output from failing test")
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

    const failedDetails = testRunner.getFailedTestDetails()

    expect(failedDetails.length).toBe(1)
    expect(failedDetails[0].fullDescription).toBe("fails once")
    expect(failedDetails[0].filePath).toBe("/tmp/sample-spec.js")
    expect(failedDetails[0].line).toBe(42)
    expect(failedDetails[0].consoleOutput).toContain("console output from failing test")
  })

  it("persists failed test console output to an assets path", async () => {
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
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-test-runner-"))
    const assetsPath = path.join(tempDirectory, "assets")

    const tests = {
      args: {},
      afterEaches: [],
      afterAlls: [],
      beforeAlls: [],
      beforeEaches: [],
      subs: {},
      tests: {
        "fails once": {
          args: {},
          filePath: "/tmp/sample-spec.js",
          line: 42,
          function: async () => {
            console.log("console output written to file")
            throw new Error("boom")
          }
        }
      }
    }

    try {
      await testRunner.runTests({
        afterEaches: [],
        beforeEaches: [],
        tests,
        descriptions: [],
        indentLevel: 0
      })

      const writtenPaths = await testRunner.persistFailedTestConsoleOutputsToAssets({assetsPath})

      expect(writtenPaths.length).toBe(1)

      const fileContent = await fs.readFile(writtenPaths[0], "utf8")
      const failedDetails = testRunner.getFailedTestDetails()

      expect(fileContent).toContain("console output written to file")
      expect(failedDetails[0].consoleLogPath).toBe(writtenPaths[0])
    } finally {
      await fs.rm(tempDirectory, {recursive: true, force: true})
    }
  })
})
