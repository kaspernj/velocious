// @ts-check

import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import {describe, expect, it} from "../../src/testing/test.js"
import TestRunner from "../../src/testing/test-runner.js"
import {resolveSlowTestCount} from "../../src/environment-handlers/node/cli/commands/test.js"

function buildConfiguration() {
  return new Configuration({
    database: {test: {}},
    directory: process.cwd(),
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    initializeModels: async () => {},
    locale: "en",
    localeFallbacks: {en: ["en"]},
    locales: ["en"]
  })
}

describe("TestRunner slowest tests", {databaseCleaning: {transaction: true}}, () => {
  it("returns recorded tests sorted slowest-first and limited", () => {
    const testRunner = new TestRunner({configuration: buildConfiguration(), testFiles: []})

    testRunner._testDurations = [
      {fullDescription: "fast", filePath: "a.js", line: 1, durationMs: 5},
      {fullDescription: "slowest", filePath: "b.js", line: 2, durationMs: 300},
      {fullDescription: "medium", filePath: "c.js", line: 3, durationMs: 50}
    ]

    const slowest = testRunner.getSlowestTests(2)

    expect(slowest.map((test) => test.fullDescription)).toEqual(["slowest", "medium"])
    expect(slowest.length).toEqual(2)
  })

  it("returns every recorded test, still slowest-first, when the limit is 0", () => {
    const testRunner = new TestRunner({configuration: buildConfiguration(), testFiles: []})

    testRunner._testDurations = [
      {fullDescription: "a", filePath: "a.js", line: 1, durationMs: 5},
      {fullDescription: "b", filePath: "b.js", line: 2, durationMs: 10}
    ]

    expect(testRunner.getSlowestTests(0).map((test) => test.fullDescription)).toEqual(["b", "a"])
  })

  it("does not mutate the recorded durations array", () => {
    const testRunner = new TestRunner({configuration: buildConfiguration(), testFiles: []})

    testRunner._testDurations = [
      {fullDescription: "a", filePath: "a.js", line: 1, durationMs: 5},
      {fullDescription: "b", filePath: "b.js", line: 2, durationMs: 10}
    ]

    testRunner.getSlowestTests(1)

    expect(testRunner._testDurations.map((test) => test.fullDescription)).toEqual(["a", "b"])
  })

  it("records a duration, description and location for every test run through runTests", async () => {
    const testRunner = new TestRunner({configuration: buildConfiguration(), testFiles: []})
    const tests = {
      args: {},
      afterEaches: [],
      beforeEaches: [],
      subs: {},
      tests: {
        "first recorded test": {args: {}, function: async () => {}, filePath: "integration.js", line: 1},
        "second recorded test": {args: {}, function: async () => {}, filePath: "integration.js", line: 2}
      }
    }

    await testRunner.runTests({afterEaches: [], beforeEaches: [], tests, descriptions: [], indentLevel: 0})

    const recorded = testRunner.getSlowestTests()

    expect(recorded.length).toEqual(2)
    expect(recorded.map((test) => test.fullDescription).sort()).toEqual(["first recorded test", "second recorded test"])
    expect(recorded.every((test) => typeof test.durationMs === "number" && test.durationMs >= 0)).toEqual(true)
    expect(recorded.every((test) => test.filePath === "integration.js")).toEqual(true)
  })
})

describe("resolveSlowTestCount", () => {
  it("defaults to 10 when the env value is unset", () => {
    expect(resolveSlowTestCount(undefined)).toEqual(10)
  })

  it("uses a provided positive count", () => {
    expect(resolveSlowTestCount("20")).toEqual(20)
  })

  it("disables the report for 0", () => {
    expect(resolveSlowTestCount("0")).toEqual(0)
  })

  it("floors positive values, and clamps negatives/unparseable values to 0 (disabled)", () => {
    expect(resolveSlowTestCount("4.9")).toEqual(4)
    expect(resolveSlowTestCount("-3")).toEqual(0)
    expect(resolveSlowTestCount("abc")).toEqual(0)
  })
})
