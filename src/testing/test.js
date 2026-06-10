// @ts-check

import path from "path"
import {fileURLToPath} from "url"
import EventEmitter from "../utils/event-emitter.js"
import Expect from "./expect.js"
import {arrayContaining, objectContaining} from "./expect-utils.js"

/**
 * Tests.
 * @type {import("./test-runner.js").TestsArgument} */
const tests = {
  /**
 * Documents this API.
 * @type {import("./test-runner.js").AfterBeforeEachCallbackObjectType[]} */
  afterEaches: [],
  /**
 * Documents this API.
 * @type {import("./test-runner.js").BeforeAfterAllCallbackObjectType[]} */
  afterAlls: [],
  args: {},

  /**
 * Documents this API.
 * @type {import("./test-runner.js").BeforeAfterAllCallbackObjectType[]} */
  beforeAlls: [],
  /**
 * Documents this API.
 * @type {import("./test-runner.js").AfterBeforeEachCallbackObjectType[]} */
  beforeEaches: [],
  filePath: undefined,
  line: undefined,
  subs: {},
  tests: {}
}

const testEvents = new EventEmitter()

let currentPath = [tests]

/**
 * Runs capture location.
 * @returns {{filePath?: string, line?: number}} - Location.
 */
function captureLocation() {
  const error = new Error()
  const stack = typeof error.stack === "string" ? error.stack.split("\n") : []

  for (const line of stack) {
    const trimmed = line.trim()

    if (!trimmed.includes("at")) continue
    if (trimmed.includes("/src/testing/test.js")) continue

    const match = trimmed.match(/(?:\(|\s)(file:\/\/.*?|\/.*?):(\d+):(\d+)\)?$/)

    if (!match) continue

    const rawPath = match[1]
    const lineNumber = Number(match[2])
    const filePath = rawPath.startsWith("file://")
      ? fileURLToPath(rawPath)
      : rawPath

    return {
      filePath: path.resolve(filePath),
      line: Number.isFinite(lineNumber) ? lineNumber : undefined
    }
  }

  return {}
}

/**
 * Runs normalize tags.
 * @param {string[] | string | undefined} tags - Tags.
 * @returns {string[]} - Normalized tags.
 */
function normalizeTags(tags) {
  if (!tags) return []

  const values = []
  const rawTags = Array.isArray(tags) ? tags : [tags]

  for (const rawTag of rawTags) {
    if (rawTag === undefined || rawTag === null) continue

    const parts = String(rawTag).split(",")

    for (const part of parts) {
      const trimmed = part.trim()

      if (trimmed) values.push(trimmed)
    }
  }

  return Array.from(new Set(values))
}

/**
 * Test config.
 * @type {VelociousTestConfig} */
const testConfig = {
  consoleOutput: "failure",
  failedConsoleOutputMaxLines: 200,
  excludeTags: [],
  defaultTimeoutSeconds: 60
}

/**
 * Runs configure tests.
 * @param {object} args - Options.
 * @param {"failure" | "live"} [args.consoleOutput] - Console output mode.
 * @param {string[] | string} [args.excludeTags] - Tags to exclude.
 * @param {number} [args.defaultTimeoutSeconds] - Default timeout in seconds.
 * @param {number} [args.failedConsoleOutputMaxLines] - Maximum failed console lines to print inline.
 * @returns {void}
 */
function configureTests({consoleOutput, excludeTags, defaultTimeoutSeconds, failedConsoleOutputMaxLines} = {}) {
  if (excludeTags !== undefined) {
    testConfig.excludeTags = normalizeTags(excludeTags)
  }

  if (consoleOutput !== undefined) {
    if (consoleOutput !== "failure" && consoleOutput !== "live") {
      throw new Error(`Invalid consoleOutput config: ${consoleOutput}`)
    }

    testConfig.consoleOutput = consoleOutput
  }

  if (typeof defaultTimeoutSeconds === "number") {
    testConfig.defaultTimeoutSeconds = defaultTimeoutSeconds
  }

  if (typeof failedConsoleOutputMaxLines === "number") {
    testConfig.failedConsoleOutputMaxLines = failedConsoleOutputMaxLines
  }
}

/**
 * Runs merge test args.
 * @param {Record<string, ?>} baseArgs - Base args.
 * @param {Record<string, ?>} extraArgs - Extra args.
 * @returns {Record<string, ?>} - Merged args.
 */
function mergeTestArgs(baseArgs, extraArgs) {
  const merged = Object.assign({}, baseArgs, extraArgs)
  const mergedTags = [...normalizeTags(baseArgs?.tags), ...normalizeTags(extraArgs?.tags)]

  if (mergedTags.length > 0) {
    merged.tags = Array.from(new Set(mergedTags))
  } else if ("tags" in merged) {
    delete merged.tags
  }

  return merged
}

/**
 * Runs before each.
 * @param {import("./test-runner.js").AfterBeforeEachCallbackType} callback - Callback function.
 * @returns {void} - No return value.
 */
function beforeEach(callback) {
  const currentTest = currentPath[currentPath.length - 1]

  currentTest.beforeEaches.push({callback})
}

/**
 * Runs before all.
 * @param {import("./test-runner.js").BeforeAfterAllCallbackType} callback - Callback function.
 * @returns {void} - No return value.
 */
function beforeAll(callback) {
  const currentTest = currentPath[currentPath.length - 1]

  currentTest.beforeAlls.push({callback})
}

/**
 * Runs after each.
 * @param {import("./test-runner.js").AfterBeforeEachCallbackType} callback - Callback function.
 * @returns {void} - No return value.
 */
function afterEach(callback) {
  const currentTest = currentPath[currentPath.length - 1]

  currentTest.afterEaches.push({callback})
}

/**
 * Runs after all.
 * @param {import("./test-runner.js").BeforeAfterAllCallbackType} callback - Callback function.
 * @returns {void} - No return value.
 */
function afterAll(callback) {
  const currentTest = currentPath[currentPath.length - 1]

  currentTest.afterAlls.push({callback})
}


/**
 * Runs describe.
 * @param {string} description - Description.
 * @param {object|(() => (void|Promise<void>))} arg1 - Arg1.
 * @param {undefined|(() => (void|Promise<void>))} [arg2] - Arg2.
 * @returns {Promise<void>} - Resolves when complete.
 */
async function describe(description, arg1, arg2) {
  /**
 * Documents this API.
 * @type {Record<string, ?>} */
  let testArgs, testFunction

  if (typeof arg2 == "function") {
    testFunction = arg2
    testArgs = arg1
  } else if (typeof arg1 == "function") {
    testFunction = arg1
    testArgs = {}
  } else {
    throw new Error(`Invalid arguments for describe: ${arg1}, ${arg2}`)
  }

  const currentTest = currentPath[currentPath.length - 1]
  const newTestArgs = mergeTestArgs(currentTest.args, testArgs)

  if (description in currentTest.subs) {
    throw new Error(`Duplicate test description: ${description}`)
  }

  const location = captureLocation()
  const newTestData = {
    afterEaches: [],
    afterAlls: [],
    args: newTestArgs,
    beforeAlls: [],
    beforeEaches: [],
    filePath: location.filePath,
    line: location.line,
    subs: {},
    tests: {}
  }

  currentTest.subs[description] = newTestData
  currentPath.push(newTestData)

  try {
    await testFunction()
  } finally {
    currentPath.pop()
  }
}

/**
 * Runs expect.
 * @param {?} arg - Arg.
 * @returns {Expect} - The expect.
 */
function expect(arg) {
  return new Expect(arg)
}

expect.objectContaining = objectContaining
expect.arrayContaining = arrayContaining

/**
 * Runs it.
 * @param {string} description - Description.
 * @param {object|(() => (void|Promise<void>))} arg1 - Arg1.
 * @param {undefined|(() => (void|Promise<void>))} [arg2] - Arg2.
 * @returns {void} - No return value.
 */
function it(description, arg1, arg2) {
  const currentTest = currentPath[currentPath.length - 1]
  /**
 * Documents this API.
 * @type {Record<string, ?>} */
  let testArgs

  /**
 * Documents this API.
 * @type {() => (void|Promise<void>)} */
  let testFunction

  if (typeof arg1 == "function") {
    testFunction = /**
 * Documents this API.
 * @type {() => (void|Promise<void>)} */ (arg1)
    testArgs = {}
  } else if (typeof arg2 == "function") {
    testFunction = /**
 * Documents this API.
 * @type {() => (void|Promise<void>)} */ (arg2)
    testArgs = arg1
  } else {
    throw new Error(`Invalid arguments for it: ${description}, ${arg1}`)
  }

  const newTestArgs = mergeTestArgs(currentTest.args, testArgs)

  const location = captureLocation()

  currentTest.tests[description] = {
    args: newTestArgs,
    function: testFunction,
    filePath: location.filePath,
    line: location.line
  }
}

/**
 * Runs fit.
 * @param {string} description - Description.
 * @param {object|(() => (void|Promise<void>))} arg1 - Arg1.
 * @param {undefined|(() => (void|Promise<void>))} [arg2] - Arg2.
 * @returns {void} - No return value.
 */
function fit(description, arg1, arg2) {
  /**
 * Documents this API.
 * @type {Record<string, ?>} */
  let testArgs

  /**
 * Documents this API.
 * @type {() => (void|Promise<void>)} */
  let testFunction

  if (typeof arg1 == "function") {
    testFunction = /**
 * Documents this API.
 * @type {() => (void|Promise<void>)} */ (arg1)
    testArgs = {focus: true}
  } else if (typeof arg2 == "function") {
    testFunction = /**
 * Documents this API.
 * @type {() => (void|Promise<void>)} */ (arg2)
    testArgs = Object.assign({focus: true}, arg1)
  } else {
    throw new Error(`Invalid arguments for it: ${description}, ${arg1}`)
  }

  return it(description, testArgs, testFunction)
}

// Make the methods global so they can be used in test files
globalThis.afterEach = afterEach
globalThis.afterAll = afterAll
globalThis.beforeEach = beforeEach
globalThis.beforeAll = beforeAll
globalThis.describe = describe
globalThis.expect = expect
globalThis.it = it
globalThis.fit = fit
globalThis.testEvents = testEvents
globalThis.configureTests = configureTests

export {afterAll, afterEach, beforeAll, beforeEach, configureTests, describe, expect, fit, it, arrayContaining, objectContaining, testConfig, testEvents, tests}
/**
 * VelociousTestConfig type.
 * @typedef {object} VelociousTestConfig
 * @property {"failure" | "live"} consoleOutput - Console output mode.
 * @property {string[]} excludeTags - Tags excluded by default.
 * @property {number} defaultTimeoutSeconds - Default timeout in seconds.
 * @property {number} failedConsoleOutputMaxLines - Maximum failed console lines to print inline.
 */
