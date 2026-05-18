// @ts-check

import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {format} from "node:util"
import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import {configureTests, describe, expect, it, testConfig, testEvents} from "../../src/testing/test.js"
import TestRunner from "../../src/testing/test-runner.js"

describe("TestRunner events", () => {
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const buildTestRunner = () => {
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

    return new TestRunner({configuration, testFiles: []})
  }
  const runTestRunner = async (testRunner, tests) => {
    await testRunner.runTests({
      afterEaches: [],
      beforeEaches: [],
      tests,
      descriptions: [],
      indentLevel: 0
    })
  }
  const captureConsole = async (callback) => {
    /** @type {Array<{methodName: string, output: string}>} */
    const entries = []
    const originalConsoleMethods = {
      debug: console.debug,
      error: console.error,
      info: console.info,
      log: console.log,
      warn: console.warn
    }

    for (const methodName of Object.keys(originalConsoleMethods)) {
      console[methodName] = (...args) => {
        entries.push({methodName, output: format(...args)})
        originalConsoleMethods[methodName](...args)
      }
    }

    try {
      await callback()
    } finally {
      for (const methodName of Object.keys(originalConsoleMethods)) {
        console[methodName] = originalConsoleMethods[methodName]
      }
    }

    return entries
  }

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

  it("emits and waits for testAttemptFailed for every failed attempt", async () => {
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
    const attemptFailedEvents = []
    let firstAttemptFailureHandled = false
    const handler = async (payload) => {
      attemptFailedEvents.push(payload)

      if (payload.attemptNumber === 1) {
        await delay(20)
        firstAttemptFailureHandled = true
      }
    }

    testEvents.on("testAttemptFailed", handler)

    try {
      let attempts = 0
      const tests = {
        args: {},
        afterEaches: [],
        beforeEaches: [],
        subs: {},
        tests: {
          "fails twice": {
            args: {retry: 1},
            function: async () => {
              attempts++

              if (attempts === 2) {
                expect(firstAttemptFailureHandled).toBe(true)
              }

              throw new Error(`boom ${attempts}`)
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
      testEvents.off("testAttemptFailed", handler)
    }

    expect(attemptFailedEvents.length).toBe(2)
    expect(attemptFailedEvents[0].testDescription).toBe("fails twice")
    expect(attemptFailedEvents[0].attemptNumber).toBe(1)
    expect(attemptFailedEvents[0].retriesUsed).toBe(1)
    expect(attemptFailedEvents[0].retryCount).toBe(1)
    expect(attemptFailedEvents[0].nextAttempt).toBe(2)
    expect(attemptFailedEvents[0].willRetry).toBe(true)
    expect(attemptFailedEvents[0].error.message).toBe("boom 1")
    expect(attemptFailedEvents[0].testRunner).toBe(testRunner)
    expect(attemptFailedEvents[1].attemptNumber).toBe(2)
    expect(attemptFailedEvents[1].retriesUsed).toBe(1)
    expect(attemptFailedEvents[1].retryCount).toBe(1)
    expect(attemptFailedEvents[1].nextAttempt).toBeUndefined()
    expect(attemptFailedEvents[1].willRetry).toBe(false)
    expect(attemptFailedEvents[1].error.message).toBe("boom 2")
    expect(attemptFailedEvents[1].testRunner).toBe(testRunner)
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

  it("does not print passing test console output by default", async () => {
    const previousConsoleOutput = testConfig.consoleOutput

    configureTests({consoleOutput: "failure"})

    try {
      const testRunner = buildTestRunner()
      const tests = {
        args: {},
        afterEaches: [],
        afterAlls: [],
        beforeAlls: [],
        beforeEaches: [],
        subs: {},
        tests: {
          "passes quietly": {
            args: {},
            function: async () => {
              console.log("hidden passing console output")
            }
          }
        }
      }

      const entries = await captureConsole(async () => {
        await runTestRunner(testRunner, tests)
      })
      const output = entries.map((entry) => entry.output).join("\n")

      expect(testRunner.getSuccessfulTests()).toBe(1)
      expect(output).not.toContain("hidden passing console output")
    } finally {
      configureTests({consoleOutput: previousConsoleOutput})
    }
  })

  it("prints failing test console output by default", async () => {
    const previousConsoleOutput = testConfig.consoleOutput

    configureTests({consoleOutput: "failure"})

    try {
      const testRunner = buildTestRunner()
      const tests = {
        args: {},
        afterEaches: [],
        afterAlls: [],
        beforeAlls: [],
        beforeEaches: [],
        subs: {},
        tests: {
          "fails with output": {
            args: {},
            function: async () => {
              console.info("visible failing console output")
              throw new Error("boom")
            }
          }
        }
      }

      const entries = await captureConsole(async () => {
        await runTestRunner(testRunner, tests)
      })
      const output = entries.map((entry) => entry.output).join("\n")
      const failedDetails = testRunner.getFailedTestDetails()

      expect(output).toContain("Console output:")
      expect(output).toContain("visible failing console output")
      expect(failedDetails.length).toBe(1)
      expect(failedDetails[0].consoleOutput).toContain("visible failing console output")
    } finally {
      configureTests({consoleOutput: previousConsoleOutput})
    }
  })

  it("keeps live console passthrough available", async () => {
    const previousConsoleOutput = testConfig.consoleOutput

    configureTests({consoleOutput: "live"})

    try {
      const testRunner = buildTestRunner()
      const tests = {
        args: {},
        afterEaches: [],
        afterAlls: [],
        beforeAlls: [],
        beforeEaches: [],
        subs: {},
        tests: {
          "passes live": {
            args: {},
            function: async () => {
              console.log("live passing console output")
            }
          }
        }
      }

      const entries = await captureConsole(async () => {
        await runTestRunner(testRunner, tests)
      })
      const output = entries.map((entry) => entry.output).join("\n")

      expect(testRunner.getSuccessfulTests()).toBe(1)
      expect(output).toContain("live passing console output")
    } finally {
      configureTests({consoleOutput: previousConsoleOutput})
    }
  })

  it("discards retry attempt console output when a retry passes", async () => {
    const previousConsoleOutput = testConfig.consoleOutput

    configureTests({consoleOutput: "failure"})

    try {
      const testRunner = buildTestRunner()
      let attempts = 0
      const tests = {
        args: {},
        afterEaches: [],
        afterAlls: [],
        beforeAlls: [],
        beforeEaches: [],
        subs: {},
        tests: {
          "retries into success": {
            args: {retry: 1},
            function: async () => {
              attempts++
              console.log(`hidden retry console output ${attempts}`)
              if (attempts === 1) throw new Error("boom")
            }
          }
        }
      }

      const entries = await captureConsole(async () => {
        await runTestRunner(testRunner, tests)
      })
      const output = entries.map((entry) => entry.output).join("\n")

      expect(testRunner.getSuccessfulTests()).toBe(1)
      expect(testRunner.getFailedTestDetails().length).toBe(0)
      expect(output).not.toContain("hidden retry console output")
    } finally {
      configureTests({consoleOutput: previousConsoleOutput})
    }
  })

  it("prints attempt failure listener console output when a retry passes", async () => {
    const previousConsoleOutput = testConfig.consoleOutput
    const handler = (payload) => {
      console.log(`retry lifecycle output attempt ${payload.attemptNumber} retry ${payload.willRetry}`)
    }

    configureTests({consoleOutput: "failure"})

    try {
      const testRunner = buildTestRunner()
      let attempts = 0
      const tests = {
        args: {},
        afterEaches: [],
        afterAlls: [],
        beforeAlls: [],
        beforeEaches: [],
        subs: {},
        tests: {
          "retries after listener output": {
            args: {retry: 1},
            function: async () => {
              attempts++
              console.log(`hidden test attempt output ${attempts}`)
              if (attempts === 1) throw new Error("boom")
            }
          }
        }
      }

      testEvents.on("testAttemptFailed", handler)

      const entries = await captureConsole(async () => {
        await runTestRunner(testRunner, tests)
      })
      const output = entries.map((entry) => entry.output).join("\n")

      expect(testRunner.getSuccessfulTests()).toBe(1)
      expect(output).toContain("retry lifecycle output attempt 1 retry true")
      expect(output).not.toContain("hidden test attempt output")
    } finally {
      testEvents.off("testAttemptFailed", handler)
      configureTests({consoleOutput: previousConsoleOutput})
    }
  })

  it("truncates inline failed test console output", async () => {
    const previousConsoleOutput = testConfig.consoleOutput
    const previousFailedConsoleOutputMaxLines = testConfig.failedConsoleOutputMaxLines

    configureTests({consoleOutput: "failure", failedConsoleOutputMaxLines: 2})

    try {
      const testRunner = buildTestRunner()
      const tests = {
        args: {},
        afterEaches: [],
        afterAlls: [],
        beforeAlls: [],
        beforeEaches: [],
        subs: {},
        tests: {
          "fails with long output": {
            args: {},
            function: async () => {
              console.log("console line 1")
              console.log("console line 2")
              console.log("console line 3")
              console.log("console line 4")
              throw new Error("boom")
            }
          }
        }
      }

      const entries = await captureConsole(async () => {
        await runTestRunner(testRunner, tests)
      })
      const output = entries.map((entry) => entry.output).join("\n")
      const failedDetails = testRunner.getFailedTestDetails()

      expect(output).toContain("2 console output lines omitted")
      expect(output).toContain("console line 3")
      expect(output).toContain("console line 4")
      expect(output).not.toContain("console line 1")
      expect(failedDetails[0].consoleOutput).toContain("console line 1")
    } finally {
      configureTests({
        consoleOutput: previousConsoleOutput,
        failedConsoleOutputMaxLines: previousFailedConsoleOutputMaxLines
      })
    }
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

  it("updates failed counters before testFailed listeners run", async () => {
    const environmentHandler = new EnvironmentHandlerNode()
    const configuration = new Configuration({
      database: {test: {}},
      directory: process.cwd(),
      environmentHandler,
      initializeModels: async () => {},
      environment: "test",
      locale: "en",
      localeFallbacks: {en: ["en"]},
      locales: ["en"]
    })
    const testRunner = new TestRunner({configuration, testFiles: []})
    let failedCountInEvent
    let failedDetailsInEvent
    const handler = () => {
      failedCountInEvent = testRunner.getFailedTests()
      failedDetailsInEvent = testRunner.getFailedTestDetails().length
      throw new Error("testFailed-listener-error")
    }

    testEvents.on("testFailed", handler)

    try {
      /** @type {Error | undefined} */
      let thrownError
      const tests = {
        args: {},
        afterEaches: [],
        beforeEaches: [],
        subs: {},
        tests: {
          "fails once": {
            args: {},
            function: async () => {
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
      } catch (error) {
        thrownError = /** @type {Error} */ (error)
      }

      expect(thrownError).toBeDefined()
      expect(thrownError.message).toBe("testFailed-listener-error")
      expect(failedCountInEvent).toBe(1)
      expect(failedDetailsInEvent).toBe(1)
      expect(testRunner.getFailedTests()).toBe(1)
      expect(testRunner.getFailedTestDetails().length).toBe(1)
    } finally {
      testEvents.off("testFailed", handler)
    }
  })
})
