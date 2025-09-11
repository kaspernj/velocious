import BaseCommand from "../base-command.js"
import TestFilesFinder from "../../testing/test-files-finder.js"
import TestRunner from "../../testing/test-runner.js"

export default class VelociousCliCommandsInit extends BaseCommand {
  async execute() {
    const testFilesFinder = new TestFilesFinder({directory: this.directory(), processArgs: this.processArgs})
    const testFiles = await testFilesFinder.findTestFiles()
    const testRunner = new TestRunner({configuration: this.configuration, testFiles})

    await testRunner.run()

    if (testRunner.isFailed()) {
      console.error(`Test run failed with ${testRunner.failedTests} failed tests and ${testRunner.successfulTests} successfull`)
      process.exit(-1)
    } else {
      console.log(`Test run succeeded with ${testRunner.successfulTests} successful tests`)
      process.exit(1)
    }
  }
}
