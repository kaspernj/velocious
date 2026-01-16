// @ts-check

import BaseCommand from "../../../../cli/base-command.js"
import picocolors from "picocolors"
import TestFilesFinder from "../../../../testing/test-files-finder.js"
import TestRunner from "../../../../testing/test-runner.js"
import {normalizeExamplePatterns, parseFilters} from "../../../../testing/test-filter-parser.js"

export default class VelociousCliCommandsTest extends BaseCommand {
  async execute() {
    this.getConfiguration().setEnvironment("test")

    let directory
    const directories = []

    if (process.env.VELOCIOUS_TEST_DIR) {
      directory = process.env.VELOCIOUS_TEST_DIR
      directories.push(process.env.VELOCIOUS_TEST_DIR)
    } else {
      directory = this.directory()
      directories.push(`${this.directory()}/__tests__`)
      directories.push(`${this.directory()}/tests`)
      directories.push(`${this.directory()}/spec`)
    }

    const {includeTags, excludeTags, examplePatterns, filteredProcessArgs} = parseFilters(this.processArgs || [])
    const testFilesFinder = new TestFilesFinder({directory, directories, processArgs: filteredProcessArgs})
    const testFiles = await testFilesFinder.findTestFiles()
    const testRunner = new TestRunner({
      configuration: this.getConfiguration(),
      excludeTags,
      includeTags,
      testFiles,
      lineFilters: testFilesFinder.getLineFiltersByFile(),
      examplePatterns: normalizeExamplePatterns(examplePatterns)
    })
    let signalHandled = false

    const handleSignal = async (signal) => {
      if (signalHandled) return
      signalHandled = true
      console.error(`\nReceived ${signal}, running afterAll hooks before exit...`)

      try {
        await testRunner.runAfterAllsForActiveScopes()
      } catch (error) {
        console.error("Failed while running afterAll hooks:", error)
      } finally {
        process.exit(130)
      }
    }

    process.once("SIGINT", () => { void handleSignal("SIGINT") })
    process.once("SIGTERM", () => { void handleSignal("SIGTERM") })

    await testRunner.prepare()

    if (testRunner.getTestsCount() === 0) {
      throw new Error(`${testRunner.getTestsCount()} tests was found in ${testFiles.length} file(s)`)
    }

    await testRunner.run()

    const executedTests = testRunner.getExecutedTestsCount()

    const lineFilters = testRunner.getLineFilters()
    const hasLineFilters = Object.keys(lineFilters).length > 0
    const hasExampleFilters = examplePatterns.length > 0
    const hasTagFilters = includeTags.length > 0 || excludeTags.length > 0

    if ((hasTagFilters || hasLineFilters || hasExampleFilters) && executedTests === 0) {
      console.error(picocolors.red("\nNo tests matched the provided filters"))
      process.exit(1)
    }

    if (testRunner.isFailed()) {
      const failedTests = testRunner.getFailedTestDetails()

      if (failedTests.length > 0) {
      console.error(picocolors.red("\nFailed tests:"))

        for (const failed of failedTests) {
          const location = failed.filePath && failed.line
            ? ` (${failed.filePath}:${failed.line})`
            : ""
          console.error(picocolors.red(`- ${failed.fullDescription}${location}`))
        }
      }

      console.error(picocolors.red(`\nTest run failed with ${testRunner.getFailedTests()} failed tests and ${testRunner.getSuccessfulTests()} successfull`))
      process.exit(1)
    } else if (testRunner.areAnyTestsFocussed()) {
      console.error(picocolors.red(`\nFocussed run with ${testRunner.getFailedTests()} failed tests and ${testRunner.getSuccessfulTests()} successfull`))
      process.exit(1)
    } else {
      console.log(picocolors.green(`\nTest run succeeded with ${testRunner.getSuccessfulTests()} successful tests`))
      process.exit(0)
    }
  }
}
