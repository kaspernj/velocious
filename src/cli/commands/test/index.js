import BaseCommand from "../../base-command.js"
import TestFilesFinder from "./test-files-finder.js"
import TestRunner from "./test-runner.js"

export default class VelociousCliCommandsInit extends BaseCommand {
  async execute() {
    const testFilesFinder = new TestFilesFinder({directory: this.directory(), processArgs: this.processArgs})
    const testFiles = await testFilesFinder.findTestFiles()

    const testRunner = new TestRunner(testFiles)

    await testRunner.run()
  }
}
