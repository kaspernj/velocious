import fs from "fs/promises"
import TestFilesFinder from "../../../../src/testing/test-files-finder.js"

describe("Cli - Commands - test - TestFilesFinder", () => {
  it("finds the correct test files", async () => {
    const directory = await fs.realpath(`${process.cwd()}/../..`)
    const testFilesFinder = new TestFilesFinder({directory, processArgs: ["test"]})
    const testFiles = await testFilesFinder.findTestFiles()
    const sampleTestFilePath = `${directory}/spec/cli/commands/destroy/migration-spec.js`

    expect(testFiles).toContain(sampleTestFilePath)
  })
})
