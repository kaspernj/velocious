import BaseCommand from "../base-command.js"
import TestFilesFinder from "../../testing/test-files-finder.js"
import TestRunner from "../../testing/test-runner.js"

export default class VelociousCliCommandsInit extends BaseCommand {
  async execute() {
    const testFilesFinder = new TestFilesFinder({directory: this.directory(), processArgs: this.processArgs})
    const testFiles = await testFilesFinder.findTestFiles()
    const testRunner = new TestRunner({configuration: this.configuration, testFiles})

    await testRunner.run()
  }
}
