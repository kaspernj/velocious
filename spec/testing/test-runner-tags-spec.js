// @ts-check

import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import {configureTests, describe, expect, it} from "../../src/testing/test.js"
import TestRunner from "../../src/testing/test-runner.js"

/**
 * @param {object} [options] - Options.
 * @returns {TestRunner} - Test runner.
 */
function buildTestRunner(options = {}) {
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

  return new TestRunner({configuration, testFiles: [], ...options})
}

describe("TestRunner tags", () => {
  it("skips tests with excluded tags", async () => {
    const testRunner = buildTestRunner({excludeTags: ["slow"]})
    const counts = {fast: 0, slow: 0, untagged: 0}

    const tests = {
      args: {},
      afterEaches: [],
      beforeEaches: [],
      subs: {},
      tests: {
        "fast test": {
          args: {tags: ["fast"]},
          function: async () => { counts.fast++ }
        },
        "slow test": {
          args: {tags: ["slow"]},
          function: async () => { counts.slow++ }
        },
        "untagged test": {
          args: {},
          function: async () => { counts.untagged++ }
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

    expect(counts.fast).toBe(1)
    expect(counts.slow).toBe(0)
    expect(counts.untagged).toBe(1)
    expect(testRunner.getSuccessfulTests()).toBe(2)
  })

  it("includes tagged tests and focused tests when include tags are set", async () => {
    const testRunner = buildTestRunner({includeTags: ["fast"]})
    const counts = {fast: 0, slow: 0, focused: 0}

    const tests = {
      args: {},
      afterEaches: [],
      beforeEaches: [],
      subs: {},
      tests: {
        "fast test": {
          args: {tags: ["fast"]},
          function: async () => { counts.fast++ }
        },
        "slow test": {
          args: {tags: ["slow"]},
          function: async () => { counts.slow++ }
        },
        "focused test": {
          args: {focus: true},
          function: async () => { counts.focused++ }
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

    expect(counts.fast).toBe(1)
    expect(counts.slow).toBe(0)
    expect(counts.focused).toBe(1)
    expect(testRunner.getSuccessfulTests()).toBe(2)
  })

  it("excludes tagged tests even when focused", async () => {
    const testRunner = buildTestRunner({excludeTags: ["skip"], includeTags: ["fast"]})
    const counts = {focused: 0, fast: 0}

    const tests = {
      args: {},
      afterEaches: [],
      beforeEaches: [],
      subs: {},
      tests: {
        "focused skip test": {
          args: {focus: true, tags: ["skip"]},
          function: async () => { counts.focused++ }
        },
        "fast test": {
          args: {tags: ["fast"]},
          function: async () => { counts.fast++ }
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

    expect(counts.focused).toBe(0)
    expect(counts.fast).toBe(1)
    expect(testRunner.getSuccessfulTests()).toBe(1)
  })

  it("tracks zero executed tests when tag filters skip everything", async () => {
    const testRunner = buildTestRunner({includeTags: ["fast"]})
    let runs = 0

    const tests = {
      args: {},
      afterEaches: [],
      beforeEaches: [],
      subs: {},
      tests: {
        "slow test": {
          args: {tags: ["slow"]},
          function: async () => { runs++ }
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

    expect(runs).toBe(0)
    expect(testRunner.getExecutedTestsCount()).toBe(0)
    expect(testRunner.getSuccessfulTests()).toBe(0)
    expect(testRunner.getFailedTests()).toBe(0)
  })

  it("excludes tags configured in the testing config", async () => {
    configureTests({excludeTags: ["mssql"]})

    try {
      const testRunner = buildTestRunner()
      const counts = {mssql: 0, untagged: 0}

      const tests = {
        args: {},
        afterEaches: [],
        beforeEaches: [],
        subs: {},
        tests: {
          "mssql test": {
            args: {tags: ["mssql"]},
            function: async () => { counts.mssql++ }
          },
          "untagged test": {
            args: {},
            function: async () => { counts.untagged++ }
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

      expect(counts.mssql).toBe(0)
      expect(counts.untagged).toBe(1)
      expect(testRunner.getSuccessfulTests()).toBe(1)
    } finally {
      configureTests({excludeTags: []})
    }
  })
})
