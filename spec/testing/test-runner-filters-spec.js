// @ts-check

import path from "path"
import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import {describe, expect, it} from "../../src/testing/test.js"
import TestRunner from "../../src/testing/test-runner.js"

function buildConfiguration() {
  const environmentHandler = new EnvironmentHandlerNode()

  return new Configuration({
    database: {test: {}},
    directory: process.cwd(),
    environment: "test",
    environmentHandler,
    initializeModels: async () => {},
    locale: "en",
    localeFallbacks: {en: ["en"]},
    locales: ["en"]
  })
}

describe("TestRunner filters", () => {
  it("filters by example patterns", async () => {
    const configuration = buildConfiguration()
    const testRunner = new TestRunner({
      configuration,
      examplePatterns: [new RegExp("Parent Child")],
      testFiles: []
    })

    let ran = false
    const tests = {
      args: {},
      afterEaches: [],
      afterAlls: [],
      beforeAlls: [],
      beforeEaches: [],
      subs: {
        "Parent": {
          args: {},
          afterEaches: [],
          afterAlls: [],
          beforeAlls: [],
          beforeEaches: [],
          subs: {},
          tests: {
            "Child": {
              args: {},
              function: async () => { ran = true }
            }
          }
        }
      },
      tests: {
        "Other": {
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

    expect(ran).toBeTrue()
  })

  it("filters by file line", async () => {
    const configuration = buildConfiguration()
    const filePath = path.resolve("spec/testing/sample-spec.js")
    const testRunner = new TestRunner({
      configuration,
      lineFilters: {[filePath]: [20]},
      testFiles: []
    })

    let matched = 0
    const tests = {
      args: {},
      afterEaches: [],
      afterAlls: [],
      beforeAlls: [],
      beforeEaches: [],
      subs: {},
      tests: {
        "match": {
          args: {},
          filePath,
          line: 20,
          function: async () => { matched += 1 }
        },
        "miss": {
          args: {},
          filePath,
          line: 30,
          function: async () => { matched += 10 }
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

    expect(matched).toBe(1)
  })
})
