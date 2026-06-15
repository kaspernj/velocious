// @ts-check

import {addTrackedStackToError} from "../utils/with-tracked-stack.js"
import fs from "node:fs/promises"
import path from "path"
import {format} from "node:util"
import Application from "../../src/application.js"
import BacktraceCleaner from "../utils/backtrace-cleaner-node.js"
import RequestClient from "./request-client.js"
import picocolors from "picocolors"
import restArgsError from "../utils/rest-args-error.js"
import {testConfig, testEvents, tests} from "./test.js"
import {pathToFileURL} from "url"
import {clearDeliveries} from "../mailer.js"

/**
 * Runs run with timeout.
 * @param {Promise<?> | ?} promise - Promise or value.
 * @param {number} timeoutMs - Timeout in milliseconds.
 * @param {string} testDescription - Test description.
 * @returns {Promise<?>} - Resolves or rejects based on timeout or promise result.
 */
function runWithTimeout(promise, timeoutMs, testDescription) {
  const timeoutSeconds = (timeoutMs / 1000).toFixed(3).replace(/\.?0+$/, "")
  const timeoutError = new Error(`Timed out after ${timeoutSeconds}s: ${testDescription}`)

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(timeoutError), timeoutMs)

    Promise.resolve(promise).then((result) => {
      clearTimeout(timeout)
      resolve(result)
    }).catch((error) => {
      clearTimeout(timeout)
      reject(error)
    })
  })
}

/**
 * ConsoleMethodName type.
 * @typedef {"log" | "info" | "warn" | "error" | "debug"} ConsoleMethodName */

/**
 * Captured console methods.
 * @type {ConsoleMethodName[]} */
const CAPTURED_CONSOLE_METHODS = ["log", "info", "warn", "error", "debug"]

/**
 * AttemptConsoleOutput type.
 * @typedef {object} AttemptConsoleOutput
 * @property {number} attemptNumber - Attempt number.
 * @property {string} output - Captured console output.
 */

/**
 * Runs to file slug.
 * @param {string} value - Value to sanitize.
 * @returns {string} - Slug-safe value.
 */
function toFileSlug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "failed-test"
}

/**
 * TestArgs type.
 * @typedef {object} TestArgs
 * @property {Application} [application] - Application instance for integration tests.
 * @property {RequestClient} [client] - HTTP client for request tests.
 * @property {object} [databaseCleaning] - Database cleanup options for tests.
 * @property {boolean} [databaseCleaning.transaction] - Use transactions to rollback between tests.
 * @property {boolean} [databaseCleaning.truncate] - Truncate tables between tests.
 * @property {boolean} [focus] - Whether this test is focused.
 * @property {() => (void|Promise<void>)} [function] - Test callback function.
 * @property {number} [retry] - Number of retries when a test fails.
 * @property {string[] | string} [tags] - Tags for filtering.
 * @property {number} [timeoutSeconds] - Timeout in seconds for the test.
 * @property {string} [type] - Test type identifier.
 */

/**
 * TestData type.
 * @typedef {object} TestData
 * @property {TestArgs} args - Arguments passed to the test.
 * @property {string} [filePath] - Source file path.
 * @property {number} [line] - Source line number.
 * @property {function(TestArgs) : (void|Promise<void>)} function - Test callback to execute.
 */

/**
 * FailedTestDetail type.
 * @typedef {object} FailedTestDetail
 * @property {string} fullDescription - Full test description.
 * @property {string} [filePath] - Source file path.
 * @property {number} [line] - Source line number.
 * @property {?} error - Failure error.
 * @property {string} [consoleOutput] - Captured console output while test ran.
 * @property {string} [consoleLogPath] - Saved console log path.
 */

/**
 * ActiveAfterAllScopeEntry type.
 * @typedef {object} ActiveAfterAllScopeEntry
 * @property {TestsArgument} tests - Scope test tree.
 * @property {boolean} afterAllsRun - Whether cleanup hooks have run.
 */

/**
 * Defines this typedef.
 * @typedef {function({configuration: import("../configuration.js").default, testArgs: TestArgs, testData: TestData}) : (void|Promise<void>)} AfterBeforeEachCallbackType
 */

/**
 * AfterBeforeEachCallbackObjectType type.
 * @typedef {object} AfterBeforeEachCallbackObjectType
 * @property {AfterBeforeEachCallbackType} callback - Hook callback to execute.
 */

/**
 * Defines this typedef.
 * @typedef {function({configuration: import("../configuration.js").default}) : (void|Promise<void>)} BeforeAfterAllCallbackType
 */

/**
 * BeforeAfterAllCallbackObjectType type.
 * @typedef {object} BeforeAfterAllCallbackObjectType
 * @property {BeforeAfterAllCallbackType} callback - Hook callback to execute.
 */

/**
 * TestsArgument type.
 * @typedef {object} TestsArgument
 * @property {Record<string, TestData>} args - Arguments keyed by test description.
 * @property {boolean} [anyTestsFocussed] - Whether any tests in the tree are focused.
 * @property {AfterBeforeEachCallbackObjectType[]} afterEaches - After-each hooks for this scope.
 * @property {BeforeAfterAllCallbackObjectType[]} afterAlls - After-all hooks for this scope.
 * @property {BeforeAfterAllCallbackObjectType[]} beforeAlls - Before-all hooks for this scope.
 * @property {AfterBeforeEachCallbackObjectType[]} beforeEaches - Before-each hooks for this scope.
 * @property {string} [filePath] - Source file path.
 * @property {number} [line] - Source line number.
 * @property {Record<string, TestData>} tests - A unique identifier for the node.
 * @property {Record<string, TestsArgument>} subs - Optional child nodes. Each item is another `Node`, allowing recursion.
 */

export default class TestRunner {
  /**
   * Narrows the runtime value to the documented type.
   * @type {ActiveAfterAllScopeEntry[]} */
  _activeAfterAllScopes

  /**
   * Narrows the runtime value to the documented type.
   * @type {FailedTestDetail[]} */
  _failedTestDetails

  /**
   * Runs constructor.
   * @param {object} args - Options object.
   * @param {import("../configuration.js").default} args.configuration - Configuration instance.
   * @param {string[] | string} [args.excludeTags] - Tags to exclude.
   * @param {string[] | string} [args.includeTags] - Tags to include.
   * @param {Array<string>} args.testFiles - Test files.
   * @param {Record<string, number[]>} [args.lineFilters] - Line filters by file.
   * @param {RegExp[]} [args.examplePatterns] - Example patterns.
   */
  constructor({configuration, excludeTags, includeTags, testFiles, lineFilters, examplePatterns, ...restArgs}) {
    restArgsError(restArgs)

    if (!configuration) throw new Error("configuration is required")

    this._configuration = configuration
    this._excludeTags = this.normalizeTags(excludeTags)
    this._excludeTagSet = new Set(this._excludeTags)
    this._includeTags = this.normalizeTags(includeTags)
    this._includeTagSet = new Set(this._includeTags)
    this._testFiles = testFiles
    this._lineFilters = lineFilters || {}
    this._examplePatterns = examplePatterns || []

    this._failedTests = 0
    this._successfulTests = 0
    this._testsCount = 0
    this._activeAfterAllScopes = []
    this._failedTestDetails = []
  }

  /**
   * Runs get configuration.
   * @returns {import("../configuration.js").default} - The configuration.
   */
  getConfiguration() { return this._configuration }

  /**
   * Runs get test files.
   * @returns {string[]} - The test files.
   */
  getTestFiles() { return this._testFiles }

  /**
   * Runs get line filters.
   * @returns {Record<string, number[]>} - Line filters.
   */
  getLineFilters() { return this._lineFilters }

  /**
   * Runs get example patterns.
   * @returns {RegExp[]} - Example patterns.
   */
  getExamplePatterns() { return this._examplePatterns }

  /**
   * Runs normalize tags.
   * @param {string[] | string | undefined} tags - Tags.
   * @returns {string[]} - Normalized tags.
   */
  normalizeTags(tags) {
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
   * Runs has tag.
   * @param {TestArgs} testArgs - Test args.
   * @param {string} tag - Tag to check for.
   * @returns {boolean} - Whether tag is present.
   */
  hasTag(testArgs, tag) {
    return this.normalizeTags(testArgs?.tags).includes(tag)
  }

  /**
   * Runs is browser test mode.
   * @returns {boolean} - Whether running browser tests.
   */
  isBrowserTestMode() {
    return process.env.VELOCIOUS_BROWSER_TESTS === "true"
  }

  /**
   * Runs run with dummy if needed.
   * @param {TestArgs} testArgs - Test args.
   * @param {() => Promise<void>} callback - Callback to run.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async runWithDummyIfNeeded(testArgs, callback) {
    if (!this.hasTag(testArgs, "dummy")) {
      await callback()
      return
    }

    if (this.isBrowserTestMode()) {
      await this.runBrowserDummy(callback)
      return
    }

    await this.runNodeDummy(callback)
  }

  /**
   * Runs run node dummy.
   * @param {() => Promise<void>} callback - Callback to run.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async runNodeDummy(callback) {
    const dummyPath = process.env.VELOCIOUS_DUMMY_PATH || this.defaultDummyPath()
    const dummyImport = await import(pathToFileURL(dummyPath).href)
    const Dummy = dummyImport.default

    if (!Dummy?.run) {
      throw new Error(`Dummy helper not found at ${dummyPath}`)
    }

    await Dummy.run(callback)
  }

  /**
   * Runs default dummy path.
   * @returns {string} - Default dummy helper path.
   */
  defaultDummyPath() {
    const cwd = path.resolve(process.cwd())
    const normalized = cwd.split(path.sep).join("/")

    if (normalized.endsWith("/spec/dummy")) {
      return path.join(cwd, "index.js")
    }

    return path.join(cwd, "spec/dummy/index.js")
  }

  /**
   * Runs run browser dummy.
   * @param {() => Promise<void>} callback - Callback to run.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async runBrowserDummy(callback) {
    await this.getConfiguration().ensureConnections({name: "Test runner browser dummy"}, async (dbs) => {
      await this.truncateDatabases(dbs)

      try {
        await callback()
      } finally {
        await this.truncateDatabases(dbs)
      }
    })
  }

  /**
   * Runs truncate databases.
   * @param {Record<string, import("../database/drivers/base.js").default>} dbs - Database connections.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async truncateDatabases(dbs) {
    for (const identifier of Object.keys(dbs)) {
      await dbs[identifier].truncateAllTables()
    }
  }

  /**
   * Runs get exclude tag set.
   * @returns {Set<string>} - Exclude tag set.
   */
  getExcludeTagSet() {
    /**
     * Config tags.
     * @type {string[]} */
    const configTags = Array.isArray(testConfig.excludeTags) ? testConfig.excludeTags : []

    return new Set([...this._excludeTags, ...configTags])
  }

  /**
   * Runs has matching tag.
   * @param {string[] | string | undefined} testTags - Test tags.
   * @param {Set<string>} tagSet - Tag set.
   * @returns {boolean} - Whether any tags match.
   */
  hasMatchingTag(testTags, tagSet) {
    if (!tagSet.size) return false

    const normalized = this.normalizeTags(testTags)

    for (const tag of normalized) {
      if (tagSet.has(tag)) return true
    }

    return false
  }

  /**
   * Runs has runnable tests.
   * @param {TestsArgument} tests - Tests.
   * @param {string[]} [descriptions] - Description stack.
   * @param {boolean} [lineMatchedInScope] - Whether line matched in scope.
   * @returns {boolean} - Whether any tests in this scope will run.
   */
  hasRunnableTests(tests, descriptions = [], lineMatchedInScope = false) {
    for (const testDescription in tests.tests) {
      const testData = tests.tests[testDescription]
      const testArgs = /**
                        * Narrows the runtime value to the documented type.
                        * @type {TestArgs} */ (Object.assign({}, testData.args))
      const includeByLine = lineMatchedInScope || this.matchesLineFilter(testData)

      if (this._onlyFocussed && !testArgs.focus) continue
      if (this.shouldSkipTest(testArgs, testData, testDescription, descriptions, includeByLine)) continue

      return true
    }

    for (const subDescription in tests.subs) {
      const subTest = tests.subs[subDescription]
      const scopeLineMatch = lineMatchedInScope || this.matchesLineFilter(subTest)
      const nextDescriptions = descriptions.concat([subDescription])

      if (this._onlyFocussed && !subTest.anyTestsFocussed) continue
      if (this.hasRunnableTests(subTest, nextDescriptions, scopeLineMatch)) return true
    }

    return false
  }

  /**
   * Runs should skip test.
   * @param {TestArgs} testArgs - Test args.
   * @param {TestData} testData - Test data.
   * @param {string} testDescription - Test description.
   * @param {string[]} descriptions - Description stack.
   * @param {boolean} lineMatchedInScope - Whether line matched in scope.
   * @returns {boolean} - Whether the test should be skipped.
   */
  shouldSkipTest(testArgs, testData, testDescription, descriptions, lineMatchedInScope) {
    if (this.hasMatchingTag(testArgs.tags, this.getExcludeTagSet())) return true

    if (this._includeTagSet.size > 0 && !testArgs.focus) {
      if (!this.hasMatchingTag(testArgs.tags, this._includeTagSet)) return true
    }

    if (this.getExamplePatterns().length > 0) {
      const fullDescription = this.buildFullDescription(descriptions, testDescription)
      const matches = this.getExamplePatterns().some((pattern) => {
        pattern.lastIndex = 0
        return pattern.test(fullDescription)
      })

      if (!matches) return true
    }

    const lineFilters = this.getLineFilters()

    if (Object.keys(lineFilters).length > 0) {
      if (!lineMatchedInScope && !this.matchesLineFilter(testData)) return true
    }

    return false
  }

  /**
   * Runs matches line filter.
   * @param {TestData | TestsArgument} entry - Test entry.
   * @returns {boolean} - Whether line filter matches entry.
   */
  matchesLineFilter(entry) {
    if (!entry || !entry.filePath || !entry.line) return false

    const filePath = path.resolve(entry.filePath)
    const lines = this.getLineFilters()[filePath]

    if (!lines || lines.length === 0) return false

    return lines.includes(entry.line)
  }

  /**
   * Runs build full description.
   * @param {string[]} descriptions - Description stack.
   * @param {string} testDescription - Test description.
   * @returns {string} - Full description.
   */
  buildFullDescription(descriptions, testDescription) {
    const parts = descriptions.concat([testDescription])

    return parts.join(" ").trim()
  }

  /**
   * Runs application.
   * @returns {Promise<Application>} - Resolves with the application.
   */
  async application() {
    if (!this._application) {
      this._application = new Application({
        configuration: this.getConfiguration(),
        httpServer: {port: 31006},
        type: "test-runner"
      })

      await this._application.initialize()
      await this._application.startHttpServer()
    }

    return this._application
  }

  /**
   * Runs request client.
   * @returns {Promise<RequestClient>} - Resolves with the request client.
   */
  async requestClient() {
    if (!this._requestClient) {
      this._requestClient = new RequestClient()
    }

    return this._requestClient
  }

  /**
   * Runs import test files.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async importTestFiles() {
    await this.getConfiguration().getEnvironmentHandler().importTestFiles(this.getTestFiles())
  }

  /**
   * Runs is failed.
   * @returns {boolean} - Whether failed.
   */
  isFailed() { return this._failedTests !== undefined && this._failedTests > 0 }

  /**
   * Runs get failed tests.
   * @returns {number} - The failed tests.
   */
  getFailedTests() {
    if (this._failedTests === undefined) throw new Error("Tests hasn't been run yet")

    return this._failedTests
  }

  /**
   * Runs get failed test details.
   * @returns {FailedTestDetail[]} - Failed test details.
   */
  getFailedTestDetails() {
    return this._failedTestDetails
  }

  /**
   * Runs persist failed test console outputs to assets.
   * @param {object} [args] - Options object.
   * @param {string} [args.assetsPath] - Assets directory path.
   * @returns {Promise<string[]>} - Written log file paths.
   */
  async persistFailedTestConsoleOutputsToAssets({assetsPath = path.join(process.cwd(), "tmp/screenshots")} = {}) {
    const failedTestDetails = this.getFailedTestDetails()
    const writtenLogPaths = []
    let createdDirectory = false

    for (let index = 0; index < failedTestDetails.length; index++) {
      const failedTestDetail = failedTestDetails[index]
      const consoleOutput = failedTestDetail.consoleOutput

      if (!consoleOutput) continue

      if (!createdDirectory) {
        await fs.mkdir(assetsPath, {recursive: true})
        createdDirectory = true
      }

      const now = new Date()
      const timestamp = [
        String(now.getFullYear()),
        String(now.getMonth() + 1).padStart(2, "0"),
        String(now.getDate()).padStart(2, "0"),
        String(now.getHours()).padStart(2, "0"),
        String(now.getMinutes()).padStart(2, "0"),
        String(now.getSeconds()).padStart(2, "0"),
        String(now.getMilliseconds()).padStart(3, "0")
      ].join("")
      const slug = toFileSlug(failedTestDetail.fullDescription)
      const fileName = `${timestamp}-${String(index + 1).padStart(2, "0")}-${slug}.console.log`
      const filePath = path.join(assetsPath, fileName)

      await fs.writeFile(filePath, consoleOutput, "utf8")
      failedTestDetail.consoleLogPath = filePath
      writtenLogPaths.push(filePath)
    }

    return writtenLogPaths
  }

  /**
   * Runs get successful tests.
   * @returns {number} - The successful tests.
   */
  getSuccessfulTests() {
    if (this._successfulTests === undefined) throw new Error("Tests hasn't been run yet")

    return this._successfulTests
  }

  /**
   * Runs get tests count.
   * @returns {number} - The tests count.
   */
  getTestsCount() {
    if (this._testsCount === undefined) throw new Error("Tests hasn't been run yet")

    return this._testsCount
  }

  /**
   * Runs get executed tests count.
   * @returns {number} - The executed tests count.
   */
  getExecutedTestsCount() {
    if (this._successfulTests === undefined || this._failedTests === undefined) {
      throw new Error("Tests hasn't been run yet")
    }

    return this._successfulTests + this._failedTests
  }

  /**
   * Runs prepare.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async prepare() {
    this.anyTestsFocussed = false
    this._failedTests = 0
    this._successfulTests = 0
    this._testsCount = 0
    this._failedTestDetails = []
    await this.importTestFiles()
    await this.analyzeTests(tests)
    this._onlyFocussed = this.anyTestsFocussed

    const testingConfigPath = this.getConfiguration().getTesting()

    if (testingConfigPath) {
      await this.getConfiguration().getEnvironmentHandler().importTestingConfigPath()
    }
  }

  /**
   * Runs are any tests focussed.
   * @returns {boolean} - Whether any tests focussed.
   */
  areAnyTestsFocussed() {
    if (this.anyTestsFocussed === undefined) {
      throw new Error("Hasn't been detected yet")
    }

    return this.anyTestsFocussed
  }

  /**
   * Runs run.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async run() {
    await this.getConfiguration().ensureConnections({name: "Test runner suite"}, async () => {
      await this.runTests({
        afterEaches: [],
        beforeEaches: [],
        tests,
        descriptions: [],
        indentLevel: 0
      })
    })
  }

  /**
   * Runs run after alls for active scopes.
   * @returns {Promise<void>} - Resolves when cleanup hooks finish.
   */
  async runAfterAllsForActiveScopes() {
    const scopes = [...this._activeAfterAllScopes].reverse()

    for (const scope of scopes) {
      await this.runAfterAllsForScope(scope)
    }

    this._activeAfterAllScopes = []
  }

  /**
   * Runs analyze tests.
   * @param {TestsArgument} tests - Tests.
   * @returns {{anyTestsFocussed: boolean}} - Whether any tests in the tree are focused.
   */
  analyzeTests(tests) {
    let anyTestsFocussedFound = false

    for (const testDescription in tests.tests) {
      const testData = tests.tests[testDescription]
      const testArgs = Object.assign({}, testData.args)

      this._testsCount++

      if (testArgs.focus) {
        anyTestsFocussedFound = true
        this.anyTestsFocussed = true
      }
    }

    for (const subDescription in tests.subs) {
      const subTest = tests.subs[subDescription]
      const {anyTestsFocussed} = this.analyzeTests(subTest)

      if (anyTestsFocussed) {
        anyTestsFocussedFound = true
      }

      subTest.anyTestsFocussed = anyTestsFocussed
    }

    return {anyTestsFocussed: anyTestsFocussedFound}
  }

  /**
   * Runs run tests.
   * @param {object} args - Options object.
   * @param {Array<AfterBeforeEachCallbackObjectType>} args.afterEaches - After eaches.
   * @param {Array<AfterBeforeEachCallbackObjectType>} args.beforeEaches - Before eaches.
   * @param {TestsArgument} args.tests - Tests.
   * @param {string[]} args.descriptions - Descriptions.
   * @param {number} args.indentLevel - Indent level.
   * @param {boolean} [args.lineMatchedInScope] - Whether line matched in scope.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async runTests({afterEaches, beforeEaches, tests, descriptions, indentLevel, lineMatchedInScope = false}) {
    const leftPadding = " ".repeat(indentLevel * 2)
    const newAfterEaches = [...afterEaches, ...tests.afterEaches]
    const newBeforeEaches = [...beforeEaches, ...tests.beforeEaches]
    const scopeLineMatch = lineMatchedInScope || this.matchesLineFilter(tests)
    const shouldRunAnyTests = this.hasRunnableTests(tests, descriptions, scopeLineMatch)

    if (!shouldRunAnyTests) return

    /** @type {ActiveAfterAllScopeEntry} */
    const scopeEntry = {tests, afterAllsRun: false}
    this._activeAfterAllScopes.push(scopeEntry)

    try {
      for (const beforeAllData of tests.beforeAlls || []) {
        await beforeAllData.callback({configuration: this.getConfiguration()})
      }

      for (const testDescription in tests.tests) {
        const testData = tests.tests[testDescription]
        const testArgs = /**
                          * Narrows the runtime value to the documented type.
                          * @type {TestArgs} */ (Object.assign({}, testData.args))
        const includeByLine = scopeLineMatch || this.matchesLineFilter(testData)

        if (this._onlyFocussed && !testArgs.focus) continue
        if (this.shouldSkipTest(testArgs, testData, testDescription, descriptions, includeByLine)) continue

        if (testArgs.type == "model" || testArgs.type == "request") {
          testArgs.application = await this.application()
        }

        if (testArgs.type == "request") {
          testArgs.client = await this.requestClient()
        }

        const retryCount = typeof testArgs.retry === "number" && Number.isFinite(testArgs.retry)
          ? Math.max(0, Math.floor(testArgs.retry))
          : 0
        const configTimeoutSeconds = typeof testConfig.defaultTimeoutSeconds === "number" ? testConfig.defaultTimeoutSeconds : undefined
        const timeoutSeconds = typeof testArgs.timeoutSeconds === "number" ? testArgs.timeoutSeconds : configTimeoutSeconds
        const useTimeout = typeof timeoutSeconds === "number" && Number.isFinite(timeoutSeconds) && timeoutSeconds > 0
        const timeoutMs = useTimeout ? timeoutSeconds * 1000 : undefined
        let retriesUsed = 0
        let attemptNumber = 1
        /**
         * Attempt console outputs.
         * @type {AttemptConsoleOutput[]} */
        const attemptConsoleOutputs = []

        console.log(`${leftPadding}it ${testDescription}`)

        while (true) {
          let shouldRetry = false
          /**
           * Defines caughtError.
           * @type {?} */
          let caughtError
          /**
           * Defines failedError.
           * @type {?} */
          let failedError
          /**
           * Defines lastError.
           * @type {?} */
          let lastError
          let willRetry = false
          const stopConsoleCapture = this.startConsoleCapture({
            passthrough: testConfig.consoleOutput === "live"
          })

          try {
            // Run the whole per-test lifecycle (dummy/server startup, connection
            // acquisition, beforeEach hooks, the test body and afterEach hooks) as
            // one promise so the timeout below can cover all of it.
            const testLifecycle = this.runWithDummyIfNeeded(testArgs, async () => {
              // Pin one connection per test so beforeEach, the test body and afterEach
              // all run on the SAME connection. This is required for transaction-based
              // database cleaning (beforeEach starts a transaction, afterEach rolls it
              // back). ensureConnections reuses the suite-level pinned connection while
              // it is healthy and transparently re-establishes a per-test pin if an
              // earlier spec closed the suite connection (which would otherwise leave a
              // stale async-context pin and force every later test onto a fresh checkout,
              // breaking isolation).
              await this.getConfiguration().ensureConnections({name: `Test: ${testDescription}`}, async () => {
                try {
                  clearDeliveries()
                  for (const beforeEachData of newBeforeEaches) {
                    await beforeEachData.callback({configuration: this.getConfiguration(), testArgs, testData})
                  }

                  await testData.function(testArgs)
                  this._successfulTests++
                } finally {
                  for (const afterEachData of newAfterEaches) {
                    await afterEachData.callback({configuration: this.getConfiguration(), testArgs, testData})
                  }
                }
              })
            })

            // Time out the ENTIRE lifecycle, not just the test body. A hang in any
            // phase — a connection checkout that never resolves, a beforeEach/afterEach
            // waiting on a lock, or dummy server startup — would otherwise stall the
            // whole run indefinitely (until CI kills the build) instead of failing the
            // single offending test.
            if (useTimeout && timeoutMs !== undefined) {
              await runWithTimeout(testLifecycle, timeoutMs, testDescription)
            } else {
              await testLifecycle
            }
          } catch (error) {
            caughtError = error
            lastError = error
            willRetry = retriesUsed < retryCount

            if (willRetry) {
              retriesUsed++
            }

            if (willRetry) {
              shouldRetry = true
            } else {
              failedError = error
            }
          } finally {
            const consoleOutput = stopConsoleCapture()

            if (consoleOutput) {
              attemptConsoleOutputs.push({attemptNumber, output: consoleOutput})
            }
          }

          if (caughtError !== undefined) {
            await this.emitEvent("testAttemptFailed", {
              configuration: this.getConfiguration(),
              descriptions,
              error: caughtError,
              attemptNumber,
              nextAttempt: willRetry ? attemptNumber + 1 : undefined,
              retriesUsed,
              retryCount,
              testArgs,
              testData,
              testDescription,
              testRunner: this,
              willRetry
            })
          }

          if (shouldRetry) {
            console.warn(picocolors.red(`${leftPadding}  Retrying (${retriesUsed}/${retryCount}) after error: ${lastError instanceof Error ? lastError.message : String(lastError)}`))
            await this.emitEvent("testRetrying", {
              configuration: this.getConfiguration(),
              descriptions,
              error: lastError,
              nextAttempt: attemptNumber + 1,
              retriesUsed,
              retryCount,
              testArgs,
              testData,
              testDescription,
              testRunner: this
            })
          }

          if (attemptNumber > 1) {
            await this.emitEvent("testRetried", {
              configuration: this.getConfiguration(),
              descriptions,
              error: lastError,
              attemptNumber,
              retriesUsed,
              retryCount,
              testArgs,
              testData,
              testDescription,
              testRunner: this
            })
          }

          attemptNumber++

          if (shouldRetry) continue

          if (failedError) {
            const consoleOutput = this.buildConsoleOutput(attemptConsoleOutputs)

            if (failedError instanceof Error) {
              console.error(picocolors.red(`${leftPadding}  Test failed: ${failedError.message}`))
              addTrackedStackToError(failedError)

              const backtraceCleaner = new BacktraceCleaner(failedError)
              const cleanedStack = backtraceCleaner.getCleanedStack()
              const stackLines = cleanedStack?.split("\n")

              if (stackLines) {
                for (const stackLine of stackLines) {
                  console.error(picocolors.red(`${leftPadding}  ${stackLine}`))
                }
              }
            } else {
              console.error(picocolors.red(`${leftPadding}  Test failed with a ${typeof failedError}: ${String(failedError)}`))
            }

            this.printFailedConsoleOutput({consoleOutput, leftPadding})
            this._failedTests++
            this._failedTestDetails.push({
              fullDescription: this.buildFullDescription(descriptions, testDescription),
              filePath: testData.filePath,
              line: testData.line,
              error: failedError,
              consoleOutput: consoleOutput || undefined
            })

            await this.emitEvent("testFailed", {
              configuration: this.getConfiguration(),
              descriptions,
              error: failedError,
              testArgs,
              testData,
              testDescription,
              testRunner: this
            })

            this.printRerunCommand({descriptions, testDescription, testData, leftPadding})
          }

          break
        }
      }

      for (const subDescription in tests.subs) {
        const subTest = tests.subs[subDescription]
        const newDecriptions = descriptions.concat([subDescription])
        const childScopeLineMatch = scopeLineMatch || this.matchesLineFilter(subTest)

        if (!this._onlyFocussed || subTest.anyTestsFocussed) {
          console.log(`${leftPadding}${subDescription}`)
          await this.runTests({
            afterEaches: newAfterEaches,
            beforeEaches: newBeforeEaches,
            tests: subTest,
            descriptions: newDecriptions,
            indentLevel: indentLevel + 1,
            lineMatchedInScope: childScopeLineMatch
          })
        }
      }
    } finally {
      await this.runAfterAllsForScope(scopeEntry)
      const scopeIndex = this._activeAfterAllScopes.indexOf(scopeEntry)

      if (scopeIndex >= 0) {
        this._activeAfterAllScopes.splice(scopeIndex, 1)
      }
    }
  }

  /**
   * Runs run after alls for scope.
   * @param {ActiveAfterAllScopeEntry} scopeEntry - Scope entry.
   * @returns {Promise<void>} - Resolves when scope cleanup finishes.
   */
  async runAfterAllsForScope(scopeEntry) {
    if (scopeEntry.afterAllsRun) return

    scopeEntry.afterAllsRun = true

    for (const afterAllData of scopeEntry.tests.afterAlls || []) {
      await afterAllData.callback({configuration: this.getConfiguration()})
    }
  }

  /**
   * Runs emit event.
   * @param {string} eventName - Event name.
   * @param {object} payload - Event payload.
   * @returns {Promise<void>} - Resolves when all listeners complete.
   */
  async emitEvent(eventName, payload) {
    const listeners = testEvents.listeners(eventName)

    for (const listener of listeners) {
      await listener(payload)
    }
  }

  /**
   * Runs print rerun command.
   * @param {object} args - Options object.
   * @param {string[]} args.descriptions - Description stack.
   * @param {string} args.testDescription - Test description.
   * @param {TestData} args.testData - Test data.
   * @param {string} args.leftPadding - Left padding.
   * @returns {void} - No return value.
   */
  printRerunCommand({descriptions, testDescription, testData, leftPadding}) {
    const rerun = this.buildRerunCommand({descriptions, testDescription, testData})

    if (rerun) {
      console.error(`${leftPadding}  Re-run: ${rerun}`)
    }
  }

  /**
   * Runs build rerun command.
   * @param {object} args - Options object.
   * @param {string[]} args.descriptions - Description stack.
   * @param {string} args.testDescription - Test description.
   * @param {TestData} args.testData - Test data.
   * @returns {string | undefined} - Rerun command.
   */
  buildRerunCommand({descriptions, testDescription, testData}) {
    const baseCommand = "npx velocious test"
    const filePath = testData.filePath
    const line = testData.line

    if (filePath && line) {
      const relativePath = path.relative(process.cwd(), filePath)
      return `${baseCommand} ${relativePath}:${line}`
    }

    const fullDescription = this.buildFullDescription(descriptions, testDescription)

    if (fullDescription) {
      return `${baseCommand} --example ${JSON.stringify(fullDescription)}`
    }

    return undefined
  }

  /**
   * Runs build console output.
   * @param {AttemptConsoleOutput[]} attemptConsoleOutputs - Attempt output entries.
   * @returns {string} - Combined console output.
   */
  buildConsoleOutput(attemptConsoleOutputs) {
    if (attemptConsoleOutputs.length === 0) return ""
    if (attemptConsoleOutputs.length === 1) return attemptConsoleOutputs[0].output

    return attemptConsoleOutputs.map((attemptConsoleOutput) => {
      return `--- Attempt ${attemptConsoleOutput.attemptNumber} ---\n${attemptConsoleOutput.output}`
    }).join("\n")
  }

  /**
   * Runs get failed console output max lines.
   * @returns {number} - Maximum failed console lines.
   */
  getFailedConsoleOutputMaxLines() {
    const maxLines = testConfig.failedConsoleOutputMaxLines

    if (typeof maxLines !== "number" || !Number.isFinite(maxLines)) return 200

    return Math.max(0, Math.floor(maxLines))
  }

  /**
   * Runs truncate failed console output lines.
   * @param {string} consoleOutput - Console output.
   * @returns {string[]} - Lines for inline output.
   */
  truncateFailedConsoleOutputLines(consoleOutput) {
    const lines = consoleOutput.split("\n")
    const maxLines = this.getFailedConsoleOutputMaxLines()

    if (maxLines === 0) return []
    if (lines.length <= maxLines) return lines

    const omittedLines = lines.length - maxLines
    const plural = omittedLines === 1 ? "" : "s"

    return [
      `... ${omittedLines} console output line${plural} omitted ...`,
      ...lines.slice(-maxLines)
    ]
  }

  /**
   * Runs print failed console output.
   * @param {object} args - Options object.
   * @param {string} args.consoleOutput - Console output.
   * @param {string} args.leftPadding - Left padding.
   * @returns {void} - No return value.
   */
  printFailedConsoleOutput({consoleOutput, leftPadding}) {
    if (testConfig.consoleOutput !== "failure") return
    if (!consoleOutput) return

    const lines = this.truncateFailedConsoleOutputLines(consoleOutput)

    if (lines.length === 0) return

    console.error(picocolors.red(`${leftPadding}  Console output:`))

    for (const line of lines) {
      console.error(picocolors.red(`${leftPadding}    ${line}`))
    }
  }

  /**
   * Runs start console capture.
   * @param {object} [args] - Options object.
   * @param {boolean} [args.passthrough] - Whether to pass through to the original console.
   * @returns {() => string} - Stops the capture and returns captured text.
   */
  startConsoleCapture({passthrough = false} = {}) {
    /**
     * Lines.
     * @type {string[]} */
    const lines = []
    /**
     * Console object.
     * @type {Record<ConsoleMethodName, (...args: Array<?>) => void>} */
    const consoleObject = /**
                           * Narrows the runtime value to the documented type.
                           * @type {Record<ConsoleMethodName, (...args: Array<?>) => void>} */ (console)
    /**
     * Original console methods.
     * @type {Record<ConsoleMethodName, (...args: Array<?>) => void>} */
    const originalConsoleMethods = {
      debug: consoleObject.debug.bind(console),
      error: consoleObject.error.bind(console),
      info: consoleObject.info.bind(console),
      log: consoleObject.log.bind(console),
      warn: consoleObject.warn.bind(console)
    }
    let stopped = false
    let outputText = ""

    for (const methodName of CAPTURED_CONSOLE_METHODS) {
      consoleObject[methodName] = (...args) => {
        lines.push(`[${new Date().toISOString()}] [${methodName}] ${format(...args)}`)

        if (passthrough) {
          originalConsoleMethods[methodName](...args)
        }
      }
    }

    return () => {
      if (!stopped) {
        stopped = true

        for (const methodName of CAPTURED_CONSOLE_METHODS) {
          consoleObject[methodName] = originalConsoleMethods[methodName]
        }

        outputText = lines.join("\n")
      }

      return outputText
    }
  }
}
