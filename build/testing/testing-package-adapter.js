// @ts-check

import {defaultTestContext} from "@velocious/testing"

/** @typedef {(typeof defaultTestContext.registry.suites)[number]} TestingPackageSuite */

/** @type {WeakSet<TestingPackageSuite>} */
const synchronizedSuites = new WeakSet()

/**
 * Converts public-package declaration options to the legacy runner contract.
 * @param {TestingPackageSuite["options"]} options - Public declaration options.
 * @returns {import("./test-runner.js").TestArgs} - Velocious runner arguments.
 */
function runnerArguments(options) {
  const args = {...options}

  if (args.retry === undefined && typeof args.retries === "number") args.retry = args.retries
  if (args.timeoutSeconds === undefined && typeof args.timeoutMs === "number") {
    args.timeoutSeconds = args.timeoutMs / 1000
  }

  return args
}

/**
 * Converts one public package suite to the Velocious runner's tree shape.
 * @param {TestingPackageSuite} suite - Public suite declaration.
 * @returns {import("./test-runner.js").TestsArgument} - Velocious test tree.
 */
function runnerSuite(suite) {
  /** @type {Record<string, import("./test-runner.js").TestData>} */
  const suiteTests = {}
  /** @type {Record<string, import("./test-runner.js").TestsArgument>} */
  const nestedSuites = {}

  for (const test of suite.tests) {
    suiteTests[test.name] = {
      args: runnerArguments(test.options),
      filePath: test.location.filePath,
      function: test.callback,
      line: test.location.line
    }
  }

  for (const nestedSuite of suite.suites) nestedSuites[nestedSuite.name] = runnerSuite(nestedSuite)

  return {
    afterAlls: suite.hooks.afterAll.map((hook) => ({callback: hook.callback})),
    afterEaches: suite.hooks.afterEach.map((hook) => ({callback: hook.callback})),
    args: runnerArguments(suite.options),
    beforeAlls: suite.hooks.beforeAll.map((hook) => ({callback: hook.callback})),
    beforeEaches: suite.hooks.beforeEach.map((hook) => ({callback: hook.callback})),
    filePath: suite.location.filePath,
    line: suite.location.line,
    subs: nestedSuites,
    tests: suiteTests
  }
}

/**
 * Makes newly imported public-package suites visible to the Velocious runner.
 * @param {import("./test-runner.js").TestsArgument} tests - Velocious root test tree.
 * @returns {void}
 */
export function synchronizeTestingPackageTests(tests) {
  for (const suite of defaultTestContext.registry.suites) {
    if (synchronizedSuites.has(suite)) continue
    if (tests.subs[suite.name]) throw new Error(`Duplicate test description: ${suite.name}`)

    tests.subs[suite.name] = runnerSuite(suite)
    synchronizedSuites.add(suite)
  }
}
