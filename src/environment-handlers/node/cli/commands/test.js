// @ts-check

import BaseCommand from "../../../../cli/base-command.js"
import TestFilesFinder from "../../../../testing/test-files-finder.js"
import TestRunner from "../../../../testing/test-runner.js"

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

    const testFilesFinder = new TestFilesFinder({directory, directories, processArgs: this.processArgs})
    const testFiles = await testFilesFinder.findTestFiles()
    const testRunner = new TestRunner({configuration: this.getConfiguration(), testFiles})

    await testRunner.prepare()

    if (testRunner.getTestsCount() === 0) {
      throw new Error(`${testRunner.getTestsCount()} tests was found in ${testFiles.length} file(s)`)
    }

    await testRunner.run()

    if (testRunner.isFailed()) {
      console.error(`\nTest run failed with ${testRunner.getFailedTests()} failed tests and ${testRunner.getSuccessfulTests()} successfull`)
      process.exit(1)
    } else if (testRunner.areAnyTestsFocussed()) {
      console.error(`\nFocussed run with ${testRunner.getFailedTests()} failed tests and ${testRunner.getSuccessfulTests()} successfull`)
      process.exit(1)
    } else {
      console.log(`\nTest run succeeded with ${testRunner.getSuccessfulTests()} successful tests`)
      process.exit(0)
    }
  }
}
