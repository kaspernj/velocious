// @ts-check

import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import {describe, expect, it} from "../../src/testing/test.js"
import TestRunner from "../../src/testing/test-runner.js"

describe("TestRunner beforeAll/afterAll", () => {
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
})
