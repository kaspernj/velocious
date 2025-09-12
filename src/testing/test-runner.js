import Application from "../../src/application.js"
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
    return this.failedTests > 0
  }

  async run() {
    this.failedTests = 0
    this.successfulTests = 0
    await this.importTestFiles()
    this.onlyFocussed = this.areAnyTestsFocussed(tests)
    await this.runTests(tests, [], 0)
  }

  areAnyTestsFocussed(tests) {
    for (const testDescription in tests.tests) {
      const testData = tests.tests[testDescription]
      const testArgs = Object.assign({}, testData.args)

      if (testArgs.focus) {
        return true
      }
    }

    for (const subDescription in tests.subs) {
      const subTest = tests.subs[subDescription]
      const result = this.areAnyTestsFocussed(subTest)

      if (result) return true
    }

    return false
  }

  async runTests(tests, descriptions, indentLevel) {
    const leftPadding = " ".repeat(indentLevel * 2)

    for (const testDescription in tests.tests) {
      const testData = tests.tests[testDescription]
      const testArgs = Object.assign({}, testData.args)

      if (this.onlyFocussed && !testArgs.focus) continue

      if (testArgs.type == "request") {
        testArgs.application = await this.application()
        testArgs.client = await this.requestClient()
      }

      console.log(`${leftPadding}it ${testDescription}`)

      try {
        await testData.function(testArgs)
        this.successfulTests++
      } catch (error) {
        this.failedTests++

        // console.error(`${leftPadding}  Test failed: ${error.message}`)
        console.error(error.stack)
      }
    }

    await this.configuration.withConnections(async () => {
      for (const subDescription in tests.subs) {
        const subTest = tests.subs[subDescription]
        const newDecriptions = descriptions.concat([subDescription])

        if (!this.onlyFocussed || this.areAnyTestsFocussed(subTest)) {
          console.log(`${leftPadding}${subDescription}`)
          await this.runTests(subTest, newDecriptions, indentLevel + 1)
        }
      }
    })
  }
}
