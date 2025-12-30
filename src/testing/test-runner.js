// @ts-check

import {addTrackedStackToError} from "../utils/with-tracked-stack.js"
import Application from "../../src/application.js"
import BacktraceCleaner from "../utils/backtrace-cleaner.js"
import RequestClient from "./request-client.js"
import restArgsError from "../utils/rest-args-error.js"
import {testConfig, testEvents, tests} from "./test.js"

/**
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
 * @property {string} [type] - Test type identifier.
 */

/**
 * @typedef {object} TestData
 * @property {TestArgs} args - Arguments passed to the test.
 * @property {function(TestArgs) : (void|Promise<void>)} function - Test callback to execute.
 */

/**
 * @typedef {function({configuration: import("../configuration.js").default, testArgs: TestArgs, testData: TestData}) : (void|Promise<void>)} AfterBeforeEachCallbackType
 */

/**
 * @typedef {object} AfterBeforeEachCallbackObjectType
 * @property {AfterBeforeEachCallbackType} callback - Hook callback to execute.
 */

/**
 * @typedef {function({configuration: import("../configuration.js").default}) : (void|Promise<void>)} BeforeAfterAllCallbackType
 */

/**
 * @typedef {object} BeforeAfterAllCallbackObjectType
 * @property {BeforeAfterAllCallbackType} callback - Hook callback to execute.
 */

/**
 * @typedef {object} TestsArgument
 * @property {Record<string, TestData>} args - Arguments keyed by test description.
 * @property {boolean} [anyTestsFocussed] - Whether any tests in the tree are focused.
 * @property {AfterBeforeEachCallbackObjectType[]} afterEaches - After-each hooks for this scope.
 * @property {BeforeAfterAllCallbackObjectType[]} afterAlls - After-all hooks for this scope.
 * @property {BeforeAfterAllCallbackObjectType[]} beforeAlls - Before-all hooks for this scope.
 * @property {AfterBeforeEachCallbackObjectType[]} beforeEaches - Before-each hooks for this scope.
 * @property {Record<string, TestData>} tests - A unique identifier for the node.
 * @property {Record<string, TestsArgument>} subs - Optional child nodes. Each item is another `Node`, allowing recursion.
 */

export default class TestRunner {
  /**
   * @param {object} args - Options object.
   * @param {import("../configuration.js").default} args.configuration - Configuration instance.
   * @param {string[] | string} [args.excludeTags] - Tags to exclude.
   * @param {string[] | string} [args.includeTags] - Tags to include.
   * @param {Array<string>} args.testFiles - Test files.
   */
  constructor({configuration, excludeTags, includeTags, testFiles, ...restArgs}) {
    restArgsError(restArgs)

    if (!configuration) throw new Error("configuration is required")

    this._configuration = configuration
    this._excludeTags = this.normalizeTags(excludeTags)
    this._excludeTagSet = new Set(this._excludeTags)
    this._includeTags = this.normalizeTags(includeTags)
    this._includeTagSet = new Set(this._includeTags)
    this._testFiles = testFiles

    this._failedTests = 0
    this._successfulTests = 0
    this._testsCount = 0
  }

  /**
   * @returns {import("../configuration.js").default} - The configuration.
   */
  getConfiguration() { return this._configuration }

  /**
   * @returns {string[]} - The test files.
   */
  getTestFiles() { return this._testFiles }

  /**
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
   * @returns {Set<string>} - Exclude tag set.
   */
  getExcludeTagSet() {
    const configTags = Array.isArray(testConfig.excludeTags) ? testConfig.excludeTags : []

    return new Set([...this._excludeTags, ...configTags])
  }

  /**
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
   * @param {TestsArgument} tests - Tests.
   * @returns {boolean} - Whether any tests in this scope will run.
   */
  hasRunnableTests(tests) {
    for (const testDescription in tests.tests) {
      const testData = tests.tests[testDescription]
      const testArgs = /** @type {TestArgs} */ (Object.assign({}, testData.args))

      if (this._onlyFocussed && !testArgs.focus) continue
      if (this.shouldSkipTest(testArgs)) continue

      return true
    }

    for (const subDescription in tests.subs) {
      const subTest = tests.subs[subDescription]

      if (this._onlyFocussed && !subTest.anyTestsFocussed) continue
      if (this.hasRunnableTests(subTest)) return true
    }

    return false
  }

  /**
   * @param {TestArgs} testArgs - Test args.
   * @returns {boolean} - Whether the test should be skipped.
   */
  shouldSkipTest(testArgs) {
    if (this.hasMatchingTag(testArgs.tags, this.getExcludeTagSet())) return true

    if (this._includeTagSet.size > 0 && !testArgs.focus) {
      if (!this.hasMatchingTag(testArgs.tags, this._includeTagSet)) return true
    }

    return false
  }

  /**
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
   * @returns {Promise<RequestClient>} - Resolves with the request client.
   */
  async requestClient() {
    if (!this._requestClient) {
      this._requestClient = new RequestClient()
    }

    return this._requestClient
  }

  /**
   * @returns {Promise<void>} - Resolves when complete.
   */
  async importTestFiles() {
    await this.getConfiguration().getEnvironmentHandler().importTestFiles(this.getTestFiles())
  }

  /**
   * @returns {boolean} - Whether failed.
   */
  isFailed() { return this._failedTests !== undefined && this._failedTests > 0 }

  /**
   * @returns {number} - The failed tests.
   */
  getFailedTests() {
    if (this._failedTests === undefined) throw new Error("Tests hasn't been run yet")

    return this._failedTests
  }

  /**
   * @returns {number} - The successful tests.
   */
  getSuccessfulTests() {
    if (this._successfulTests === undefined) throw new Error("Tests hasn't been run yet")

    return this._successfulTests
  }

  /**
   * @returns {number} - The tests count.
   */
  getTestsCount() {
    if (this._testsCount === undefined) throw new Error("Tests hasn't been run yet")

    return this._testsCount
  }

  /**
   * @returns {number} - The executed tests count.
   */
  getExecutedTestsCount() {
    if (this._successfulTests === undefined || this._failedTests === undefined) {
      throw new Error("Tests hasn't been run yet")
    }

    return this._successfulTests + this._failedTests
  }

  /**
   * @returns {Promise<void>} - Resolves when complete.
   */
  async prepare() {
    this.anyTestsFocussed = false
    this._failedTests = 0
    this._successfulTests = 0
    this._testsCount = 0
    await this.importTestFiles()
    await this.analyzeTests(tests)
    this._onlyFocussed = this.anyTestsFocussed

    const testingConfigPath = this.getConfiguration().getTesting()

    if (testingConfigPath) {
      await this.getConfiguration().getEnvironmentHandler().importTestingConfigPath()
    }
  }

  /**
   * @returns {boolean} - Whether any tests focussed.
   */
  areAnyTestsFocussed() {
    if (this.anyTestsFocussed === undefined) {
      throw new Error("Hasn't been detected yet")
    }

    return this.anyTestsFocussed
  }

  /**
   * @returns {Promise<void>} - Resolves when complete.
   */
  async run() {
    await this.getConfiguration().ensureConnections(async () => {
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
   * @param {object} args - Options object.
   * @param {Array<AfterBeforeEachCallbackObjectType>} args.afterEaches - After eaches.
   * @param {Array<AfterBeforeEachCallbackObjectType>} args.beforeEaches - Before eaches.
   * @param {TestsArgument} args.tests - Tests.
   * @param {string[]} args.descriptions - Descriptions.
   * @param {number} args.indentLevel - Indent level.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async runTests({afterEaches, beforeEaches, tests, descriptions, indentLevel}) {
    const leftPadding = " ".repeat(indentLevel * 2)
    const newAfterEaches = [...afterEaches, ...tests.afterEaches]
    const newBeforeEaches = [...beforeEaches, ...tests.beforeEaches]
    const shouldRunAnyTests = this.hasRunnableTests(tests)

    if (!shouldRunAnyTests) return

    for (const beforeAllData of tests.beforeAlls || []) {
      await beforeAllData.callback({configuration: this.getConfiguration()})
    }

    for (const testDescription in tests.tests) {
      const testData = tests.tests[testDescription]
      const testArgs = /** @type {TestArgs} */ (Object.assign({}, testData.args))

      if (this._onlyFocussed && !testArgs.focus) continue
      if (this.shouldSkipTest(testArgs)) continue

      if (testArgs.type == "model" || testArgs.type == "request") {
        testArgs.application = await this.application()
      }

      if (testArgs.type == "request") {
        testArgs.client = await this.requestClient()
      }

      console.log(`${leftPadding}it ${testDescription}`)

      const retryCount = typeof testArgs.retry === "number" && Number.isFinite(testArgs.retry)
        ? Math.max(0, Math.floor(testArgs.retry))
        : 0
      let retriesUsed = 0

      while (true) {
        let shouldRetry = false
        /** @type {unknown} */
        let failedError

        try {
          for (const beforeEachData of newBeforeEaches) {
            await beforeEachData.callback({configuration: this.getConfiguration(), testArgs, testData})
          }

          await testData.function(testArgs)
          this._successfulTests++
        } catch (error) {
          if (retriesUsed < retryCount) {
            retriesUsed++
            shouldRetry = true
          } else {
            failedError = error
          }
        } finally {
          for (const afterEachData of newAfterEaches) {
            await afterEachData.callback({configuration: this.getConfiguration(), testArgs, testData})
          }
        }

        if (shouldRetry) continue

        if (failedError) {
          this._failedTests++

          if (failedError instanceof Error) {
            console.error(`${leftPadding}  Test failed:`, failedError.message)
            addTrackedStackToError(failedError)

            const backtraceCleaner = new BacktraceCleaner(failedError)
            const cleanedStack = backtraceCleaner.getCleanedStack()
            const stackLines = cleanedStack?.split("\n")

            if (stackLines) {
              for (const stackLine of stackLines) {
                console.error(`${leftPadding}  ${stackLine}`)
              }
            }
          } else {
            console.error(`${leftPadding}  Test failed with a ${typeof failedError}:`, failedError)
          }

          testEvents.emit("testFailed", {
            configuration: this.getConfiguration(),
            descriptions,
            error: failedError,
            testArgs,
            testData,
            testDescription,
            testRunner: this
          })
        }

        break
      }
    }

    for (const subDescription in tests.subs) {
      const subTest = tests.subs[subDescription]
      const newDecriptions = descriptions.concat([subDescription])

      if (!this._onlyFocussed || subTest.anyTestsFocussed) {
        console.log(`${leftPadding}${subDescription}`)
        await this.runTests({
          afterEaches: newAfterEaches,
          beforeEaches: newBeforeEaches,
          tests: subTest,
          descriptions: newDecriptions,
          indentLevel: indentLevel + 1
        })
      }
    }

    for (const afterAllData of tests.afterAlls || []) {
      await afterAllData.callback({configuration: this.getConfiguration()})
    }
  }
}
