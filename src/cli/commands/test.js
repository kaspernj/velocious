import BaseCommand from "../base-command.js"
import TestFilesFinder from "../../testing/test-files-finder.js"
import TestRunner from "../../testing/test-runner.js"

export default class VelociousCliCommandsTest extends BaseCommand {
  async execute() {
    const directory = process.env.VELOCIOUS_TEST_DIR || this.directory()
    const testFilesFinder = new TestFilesFinder({directory, processArgs: this.processArgs})
    const testFiles = await testFilesFinder.findTestFiles()
    const testRunner = new TestRunner({configuration: this.configuration, testFiles})

    await testRunner.prepare()

    if (testRunner.getTestsCount() === 0) {
      throw new Error("No tests has been found")
    }

    await testRunner.run()

    if (testRunner.isFailed()) {
      console.error(`\nTest run failed with ${testRunner.getFailedTests()} failed tests and ${testRunner.getSuccessfulTests()} successfull`)
      process.exit(1)
    } else {
      console.log(`\nTest run succeeded with ${testRunner.getSuccessfulTests()} successful tests`)
      process.exit(0)
    }
  }
}
