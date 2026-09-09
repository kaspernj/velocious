// @ts-check

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  configureTests,
  defaultTestContext,
  describe,
  fdescribe,
  fit,
  it,
  test,
  waitForEvent,
  xdescribe,
  xit,
  xtest
} from "@velocious/testing"
import EventEmitter from "../utils/event-emitter.js"
import Expect from "./expect.js"
import {arrayContaining, objectContaining} from "./expect-utils.js"

/** @typedef {(typeof defaultTestContext.registry.suites)[number]} PackageSuiteDeclaration */

/**
 * VelociousTestConfig type.
 * @typedef {object} VelociousTestConfig
 * @property {"failure" | "live"} consoleOutput - Console output mode.
 * @property {string[]} excludeTags - Tags excluded by default.
 * @property {number} defaultTimeoutSeconds - Default timeout in seconds.
 * @property {number} failedConsoleOutputMaxLines - Maximum failed console lines to print inline.
 */

/**
 * Runs expect.
 * @param {ReturnType<typeof JSON.parse>} arg - Arg.
 * @returns {Expect} - The expect.
 */
function expect(arg) {
  return new Expect(arg)
}

expect.objectContaining = objectContaining
expect.arrayContaining = arrayContaining

/** Velocious-owned awaited compatibility events. */
const testEvents = new EventEmitter()

/**
 * Detaches and freezes declaration metadata exposed by the compatibility view.
 * @param {ReturnType<typeof JSON.parse>} value - Package declaration value.
 * @returns {ReturnType<typeof JSON.parse>} - Immutable detached value.
 */
function readOnlySnapshot(value) {
  if (Array.isArray(value)) return Object.freeze(value.map((entry) => readOnlySnapshot(entry)))
  if (value === null || typeof value !== "object") return value

  /** @type {Record<string, ReturnType<typeof JSON.parse>>} */
  const projectedValue = {}

  for (const [key, entry] of Object.entries(value)) projectedValue[key] = readOnlySnapshot(entry)

  return Object.freeze(projectedValue)
}

/**
 * Backward-compatible view of the package configuration.
 * @type {VelociousTestConfig}
 */
const testConfig = {
  get consoleOutput() { return defaultTestContext.config.consoleOutput },
  set consoleOutput(value) { defaultTestContext.configureTests({consoleOutput: value}) },
  get excludeTags() { return defaultTestContext.config.excludeTags },
  set excludeTags(value) { defaultTestContext.configureTests({excludeTags: value}) },
  get defaultTimeoutSeconds() { return defaultTestContext.config.defaultTimeoutMs / 1000 },
  set defaultTimeoutSeconds(value) { defaultTestContext.configureTests({defaultTimeoutSeconds: value}) },
  get failedConsoleOutputMaxLines() { return defaultTestContext.config.failedConsoleOutputMaxLines },
  set failedConsoleOutputMaxLines(value) { defaultTestContext.configureTests({failedConsoleOutputMaxLines: value}) }
}

/**
 * Projects one package suite into the deprecated legacy inspection shape.
 * The returned objects are snapshots and never participate in execution.
 * @param {PackageSuiteDeclaration} suite - Package declaration.
 * @returns {import("./test-runner.js").TestsArgument} - Read-only compatibility snapshot.
 */
function projectSuite(suite) {
  /** @type {Record<string, import("./test-runner.js").TestData>} */
  const projectedTests = {}
  /** @type {Record<string, import("./test-runner.js").TestsArgument>} */
  const projectedSuites = {}

  for (const declaration of suite.tests) {
    const mutableArgs = {...declaration.options}

    if (mutableArgs.retry === undefined && typeof mutableArgs.retries === "number") mutableArgs.retry = mutableArgs.retries
    if (mutableArgs.timeoutSeconds === undefined && typeof mutableArgs.timeoutMs === "number") mutableArgs.timeoutSeconds = mutableArgs.timeoutMs / 1000
    projectedTests[declaration.name] = Object.freeze({
      args: readOnlySnapshot(mutableArgs),
      filePath: declaration.location.filePath,
      function: declaration.callback,
      line: declaration.location.line
    })
  }

  for (const child of suite.suites) projectedSuites[child.name] = projectSuite(child)

  const projection = {
    afterAlls: Object.freeze(suite.hooks.afterAll.map((hook) => Object.freeze({callback: hook.callback}))),
    afterEaches: Object.freeze(suite.hooks.afterEach.map((hook) => Object.freeze({callback: hook.callback}))),
    args: readOnlySnapshot(suite.options),
    beforeAlls: Object.freeze(suite.hooks.beforeAll.map((hook) => Object.freeze({callback: hook.callback}))),
    beforeEaches: Object.freeze(suite.hooks.beforeEach.map((hook) => Object.freeze({callback: hook.callback}))),
    filePath: suite.location.filePath,
    line: suite.location.line,
    subs: Object.freeze(projectedSuites),
    tests: Object.freeze(projectedTests)
  }

  // Narrows the immutable snapshot to the historical inspection contract.
  return /** @type {import("./test-runner.js").TestsArgument} */ (Object.freeze(projection))
}

/**
 * Deprecated read-only declaration projection. Package declarations in
 * defaultTestContext are the sole execution source.
 */
/** @type {import("./test-runner.js").BeforeAfterAllCallbackObjectType[]} */
const emptyAfterAlls = []
/** @type {import("./test-runner.js").AfterBeforeEachCallbackObjectType[]} */
const emptyAfterEaches = []
/** @type {import("./test-runner.js").BeforeAfterAllCallbackObjectType[]} */
const emptyBeforeAlls = []
/** @type {import("./test-runner.js").AfterBeforeEachCallbackObjectType[]} */
const emptyBeforeEaches = []
const defaultTestArguments = {databaseCleaning: {transaction: true}}

Object.freeze(emptyAfterAlls)
Object.freeze(emptyAfterEaches)
Object.freeze(emptyBeforeAlls)
Object.freeze(emptyBeforeEaches)
Object.freeze(defaultTestArguments.databaseCleaning)
Object.freeze(defaultTestArguments)

const testsProjection = {
  get afterAlls() { return emptyAfterAlls },
  get afterEaches() { return emptyAfterEaches },
  get args() { return defaultTestArguments },
  get beforeAlls() { return emptyBeforeAlls },
  get beforeEaches() { return emptyBeforeEaches },
  get filePath() { return undefined },
  get line() { return undefined },
  get subs() {
    /** @type {Record<string, import("./test-runner.js").TestsArgument>} */
    const projectedSuites = {}

    for (const suite of defaultTestContext.registry.suites) {
      if (suite.name === "") {
        for (const childSuite of suite.suites) projectedSuites[childSuite.name] = projectSuite(childSuite)
      } else {
        projectedSuites[suite.name] = projectSuite(suite)
      }
    }

    return Object.freeze(projectedSuites)
  },
  get tests() {
    /** @type {Record<string, import("./test-runner.js").TestData>} */
    const projectedTests = {}

    for (const suite of defaultTestContext.registry.suites) {
      if (suite.name !== "") continue

      Object.assign(projectedTests, projectSuite(suite).tests)
    }

    return Object.freeze(projectedTests)
  }
}
/** @type {import("./test-runner.js").TestsArgument} */
const tests = testsProjection
Object.freeze(tests)

// Make the compatibility facade global so existing test files remain source-compatible.
Object.assign(globalThis, {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  configureTests,
  describe,
  expect,
  fdescribe,
  fit,
  it,
  test,
  testEvents,
  xdescribe,
  xit,
  xtest
})

export {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  configureTests,
  describe,
  expect,
  fdescribe,
  fit,
  it,
  test,
  xdescribe,
  xit,
  xtest,
  arrayContaining,
  objectContaining,
  testConfig,
  testEvents,
  tests,
  waitForEvent
}
