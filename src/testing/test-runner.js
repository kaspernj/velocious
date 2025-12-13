// @ts-check

import {addTrackedStackToError} from "../utils/with-tracked-stack.js"
import Application from "../../src/application.js"
import BacktraceCleaner from "../utils/backtrace-cleaner.js"
import RequestClient from "./request-client.js"
import restArgsError from "../utils/rest-args-error.js"
import {tests} from "./test.js"

/**
 * @typedef {object} TestArgs
 * @property {Application} [application]
 * @property {RequestClient} [client]
 * @property {boolean} [focus]
 * @property {() => Promise<void>} [function]
 * @property {string} [type]
 */

/**
 * @typedef {object} TestData
 * @property {TestArgs} args
 * @property {function(TestArgs) : Promise<void>} function
 */

/**
 * @typedef {function({configuration: import("../configuration.js").default, testArgs: TestArgs, testData: TestData}) : Promise<void>} AfterBeforeEachCallbackType
 */

/**
 * @typedef {object} AfterBeforeEachCallbackObjectType
 * @property {AfterBeforeEachCallbackType} callback
 */

/**
 * @typedef {object} TestsArgument
 * @property {Record<string, TestData>} args
 * @property {boolean} [anyTestsFocussed]
 * @property {AfterBeforeEachCallbackObjectType[]} afterEaches
 * @property {AfterBeforeEachCallbackObjectType[]} beforeEaches
 * @property {Record<string, TestData>} tests - A unique identifier for the node.
 * @property {Record<string, TestsArgument>} subs - Optional child nodes. Each item is another `Node`, allowing recursion.
 */

export default class TestRunner {
  /**
   * @param {object} args
   * @param {import("../configuration.js").default} args.configuration
   * @param {Array<string>} args.testFiles
   */
  constructor({configuration, testFiles, ...restArgs}) {
    restArgsError(restArgs)

    if (!configuration) throw new Error("configuration is required")

    this._configuration = configuration
    this._testFiles = testFiles

    this._failedTests = 0
    this._successfulTests = 0
    this._testsCount = 0
  }

  /**
   * @returns {import("../configuration.js").default}
   */
  getConfiguration() { return this._configuration }

  /**
   * @returns {string[]}
   */
  getTestFiles() { return this._testFiles }

  /**
   * @returns {Promise<Application>}
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
   * @returns {Promise<RequestClient>}
   */
  async requestClient() {
    if (!this._requestClient) {
      this._requestClient = new RequestClient()
    }

    return this._requestClient
  }

  /**
   * @returns {Promise<void>}
   */
  async importTestFiles() {
    await this.getConfiguration().getEnvironmentHandler().importTestFiles(this.getTestFiles())
  }

  /**
   * @returns {boolean}
   */
  isFailed() { return this._failedTests !== undefined && this._failedTests > 0 }

  /**
   * @returns {number}
   */
  getFailedTests() {
    if (this._failedTests === undefined) throw new Error("Tests hasn't been run yet")

    return this._failedTests
  }

  /**
   * @returns {number}
   */
  getSuccessfulTests() {
    if (this._successfulTests === undefined) throw new Error("Tests hasn't been run yet")

    return this._successfulTests
  }

  /**
   * @returns {number}
   */
  getTestsCount() {
    if (this._testsCount === undefined) throw new Error("Tests hasn't been run yet")

    return this._testsCount
  }

  /**
   * @returns {Promise<void>}
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
   * @returns {boolean}
   */
  areAnyTestsFocussed() {
    if (this.anyTestsFocussed === undefined) {
      throw new Error("Hasn't been detected yet")
    }

    return this.anyTestsFocussed
  }

  /**
   * @returns {Promise<void>}
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
   * @param {TestsArgument} tests
   * @returns {{anyTestsFocussed: boolean}}
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
   * @param {object} args
   * @param {Array<AfterBeforeEachCallbackObjectType>} args.afterEaches
   * @param {Array<AfterBeforeEachCallbackObjectType>} args.beforeEaches
   * @param {TestsArgument} args.tests
   * @param {string[]} args.descriptions
   * @param {number} args.indentLevel
   * @returns {Promise<void>}
   */
  async runTests({afterEaches, beforeEaches, tests, descriptions, indentLevel}) {
    const leftPadding = " ".repeat(indentLevel * 2)
    const newAfterEaches = [...afterEaches, ...tests.afterEaches]
    const newBeforeEaches = [...beforeEaches, ...tests.beforeEaches]

    for (const testDescription in tests.tests) {
      const testData = tests.tests[testDescription]
      const testArgs = /** @type {TestArgs} */ (Object.assign({}, testData.args))

      if (this._onlyFocussed && !testArgs.focus) continue

      if (testArgs.type == "model" || testArgs.type == "request") {
        testArgs.application = await this.application()
      }

      if (testArgs.type == "request") {
        testArgs.client = await this.requestClient()
      }

      console.log(`${leftPadding}it ${testDescription}`)

      try {
        for (const beforeEachData of newBeforeEaches) {
          await beforeEachData.callback({configuration: this.getConfiguration(), testArgs, testData})
        }

        await testData.function(testArgs)
        this._successfulTests++
      } catch (error) {
        this._failedTests++

        if (error instanceof Error) {
          console.error(`${leftPadding}  Test failed:`, error.message)
          addTrackedStackToError(error)

          const backtraceCleaner = new BacktraceCleaner(error)
          const cleanedStack = backtraceCleaner.getCleanedStack()
          const stackLines = cleanedStack?.split("\n")

          if (stackLines) {
            for (const stackLine of stackLines) {
              console.error(`${leftPadding}  ${stackLine}`)
            }
          }
        } else {
          console.error(`${leftPadding}  Test failed with a ${typeof error}:`, error)
        }
      } finally {
        for (const afterEachData of newAfterEaches) {
          await afterEachData.callback({configuration: this.getConfiguration(), testArgs, testData})
        }
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
  }
}
