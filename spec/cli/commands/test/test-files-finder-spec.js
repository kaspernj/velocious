import TestFilesFinder from "../../../../src/testing/test-files-finder.js"

describe("Cli - Commands - test - TestFilesFinder", () => {
  it("finds the correct test files", async () => {
    const testFilesFinder = new TestFilesFinder({directory: process.cwd(), processArgs: ["test"]})
    const testFiles = await testFilesFinder.findTestFiles()

    const sampleTestFilePath = `${process.cwd()}/spec/cli/commands/destroy/migration-spec.js`

    expect(testFiles.includes(sampleTestFilePath)).toBe(true)
  })
})
