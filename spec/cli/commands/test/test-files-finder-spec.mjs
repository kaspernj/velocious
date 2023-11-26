import TestFilesFinder from "../../../../src/cli/commands/test/test-files-finder.mjs"

describe("Cli - Commands - test - TestFilesFinder", () => {
  it("finds the correct test files", async () => {
    const testFilesFinder = new TestFilesFinder({directory: process.cwd(), processArgs: ["test"]})
    const testFiles = await testFilesFinder.findTestFiles()

    const sampleTestFilePath = `${process.cwd()}/spec/cli/commands/destroy/migration-spec.mjs`

    expect(testFiles.includes(sampleTestFilePath)).toBe(true)
  })
})
