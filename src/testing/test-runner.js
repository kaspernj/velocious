import {addTrackedStackToError} from "../utils/with-tracked-stack.js"
import Application from "../../src/application.js"
import BacktraceCleaner from "../utils/backtrace-cleaner.js"
import RequestClient from "./request-client.js"
import {tests} from "./test.js"

export default class TestRunner {
  constructor({configuration, testFiles}) {
    this.configuration = configuration
    this.testFiles = testFiles
  }

  async application() {
    if (!this._application) {
      this._application = new Application({
        configuration: this.configuration,
        databases: {
          default: {
            host: "mysql",
            username: "user",
            password: ""
          }
        },
        httpServer: {port: 31006}
      })

      await this._application.initialize()
      await this._application.startHttpServer()
    }

    return this._application
  }

  async requestClient() {
    if (!this._requestClient) {
      this._requestClient = new RequestClient()
    }

    return this._requestClient
  }

  async importTestFiles() {
    for (const testFile of this.testFiles) {
      await import(testFile)
    }
  }

  isFailed() {
    return this._failedTests > 0
  }

  getFailedTests() {
    return this._failedTests
  }

  getSuccessfulTests() {
    return this._successfulTests
  }

  getTestsCount() {
    return this._testsCount
  }

  async prepare() {
    this.anyTestsFocussed = false
    this._failedTests = 0
    this._successfulTests = 0
    this._testsCount = 0
    await this.importTestFiles()
    await this.analyzeTests(tests)
    this._onlyFocussed = this.anyTestsFocussed

    const testingConfigPath = this.configuration.getTesting()

    if (testingConfigPath) {
      await import(testingConfigPath)
    }
  }

  areAnyTestsFocussed() {
    if (this.anyTestsFocussed === undefined) {
      throw new Error("Hasn't been detected yet")
    }

    return this.anyTestsFocussed
  }

  async run() {
    await this.configuration.ensureConnections(async () => {
      await this.runTests({
        afterEaches: [],
        beforeEaches: [],
        tests,
        descriptions: [],
        indentLevel: 0
      })
    })
  }

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

  async runTests({afterEaches, beforeEaches, tests, descriptions, indentLevel}) {
    const leftPadding = " ".repeat(indentLevel * 2)
    const newAfterEaches = [...afterEaches, ...tests.afterEaches]
    const newBeforeEaches = [...beforeEaches, ...tests.beforeEaches]

    for (const testDescription in tests.tests) {
      const testData = tests.tests[testDescription]
      const testArgs = Object.assign({}, testData.args)

      if (this._onlyFocussed && !testArgs.focus) continue

      if (testArgs.type == "request") {
        testArgs.application = await this.application()
        testArgs.client = await this.requestClient()
      }

      console.log(`${leftPadding}it ${testDescription}`)

      try {
        for (const beforeEachData of newBeforeEaches) {
          await beforeEachData.callback({testArgs, testData})
        }

        await testData.function(testArgs)
        this._successfulTests++
      } catch (error) {
        this._failedTests++

        console.error(`${leftPadding}  Test failed: ${error.message}`)
        addTrackedStackToError(error)

        const backtraceCleaner = new BacktraceCleaner(error)
        const cleanedStack = backtraceCleaner.getCleanedStack()
        const stackLines = cleanedStack.split("\n")

        for (const stackLine of stackLines) {
          console.error(`${leftPadding}  ${stackLine}`)
        }
      } finally {
        for (const afterEachData of newAfterEaches) {
          await afterEachData.callback({testArgs, testData})
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
