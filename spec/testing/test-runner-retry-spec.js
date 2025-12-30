// @ts-check

import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import {describe, expect, it} from "../../src/testing/test.js"
import TestRunner from "../../src/testing/test-runner.js"

describe("TestRunner retry", () => {
  it("retries a failing test until it succeeds", async () => {
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

    let attempts = 0
    const tests = {
      args: {},
      afterEaches: [],
      beforeEaches: [],
      subs: {},
      tests: {
        "retries until it passes": {
          args: {retry: 2},
          function: async () => {
            attempts++

            if (attempts < 3) {
              throw new Error("flaky")
            }
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

    expect(attempts).toBe(3)
    expect(testRunner.getSuccessfulTests()).toBe(1)
    expect(testRunner.getFailedTests()).toBe(0)
  })
})
