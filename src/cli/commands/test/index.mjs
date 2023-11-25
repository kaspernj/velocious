import BaseCommand from "../../base-command.mjs"
import TestFilesFinder from "./test-files-finder.mjs"
import TestRunner from "./test-runner.mjs"

export default class VelociousCliCommandsInit extends BaseCommand {
  async execute() {
    const testFilesFinder = new TestFilesFinder({directory: this.directory(), processArgs: this.processArgs})
    const testFiles = await testFilesFinder.findTestFiles()

    const testRunner = new TestRunner(testFiles)

    await testRunner.run()
  }
}
