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

  async configuration() {

  }

  async requestClient() {
    if (!this._requestClient) {
      this._requestClient = new RequestClient()
    }

    return this._requestClient
  }

  async importTestFiles() {
    for (const testFile of this.testFiles) {
      const importTestFile = await import(testFile)
    }
  }

  async run() {
    await this.importTestFiles()
    await this.runTests(tests, [], 0)
  }

  async runTests(tests, descriptions, indentLevel) {
    const leftPadding = " ".repeat(indentLevel * 2)

    for (const testDescription in tests.tests) {
      const testData = tests.tests[testDescription]
      const testArgs = Object.assign({}, testData.args)
      const testName = descriptions.concat([`it ${testDescription}`]).join(" - ")

      if (testArgs.type == "request") {
        testArgs.application = await this.application()
        testArgs.client = await this.requestClient()
      }

      console.log(`${leftPadding}it ${testDescription}`)

      try {
        await testData.function(testArgs)
      } catch (error) {
        console.error(`${leftPadding}  Test failed: ${error.message}`)
      }
    }

    for (const subDescription in tests.subs) {
      const subTest = tests.subs[subDescription]
      const newDecriptions = descriptions.concat([subDescription])

      console.log(`${leftPadding}${subDescription}`)

      await this.runTests(subTest, newDecriptions, indentLevel + 1)
    }
  }
}
