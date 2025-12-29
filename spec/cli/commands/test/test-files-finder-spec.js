// @ts-check

import fs from "fs/promises"
import os from "os"
import path from "path"
import TestFilesFinder from "../../../../src/testing/test-files-finder.js"

describe("Cli - Commands - test - TestFilesFinder", () => {
  it("finds the correct test files", async () => {
    const directory = await fs.realpath(`${process.cwd()}/../..`)
    const testFilesFinder = new TestFilesFinder({directory, processArgs: ["test"]})
    const testFiles = await testFilesFinder.findTestFiles()
    const sampleTestFilePath = `${directory}/spec/cli/commands/destroy/migration-spec.js`

    expect(testFiles).toContain(sampleTestFilePath)
  })

  it("finds test files in a directory argument without a trailing slash", async () => {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-test-files-"))

    try {
      const specDir = path.join(tempDirectory, "spec")
      const nestedDir = path.join(specDir, "nested")
      const testFile = path.join(specDir, "sample-spec.js")
      const nestedFile = path.join(nestedDir, "nested-test.js")

      await fs.mkdir(nestedDir, {recursive: true})
      await fs.writeFile(testFile, "")
      await fs.writeFile(nestedFile, "")

      const testFilesFinder = new TestFilesFinder({directory: tempDirectory, processArgs: ["test", "spec"]})
      const testFiles = await testFilesFinder.findTestFiles()

      expect(testFiles).toContain(testFile)
      expect(testFiles).toContain(nestedFile)
    } finally {
      await fs.rm(tempDirectory, {recursive: true, force: true})
    }
  })

  it("accepts an absolute file argument", async () => {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-test-files-"))

    try {
      const specDir = path.join(tempDirectory, "spec")
      const testFile = path.join(specDir, "absolute-spec.js")
      const otherFile = path.join(specDir, "other-spec.js")

      await fs.mkdir(specDir, {recursive: true})
      await fs.writeFile(testFile, "")
      await fs.writeFile(otherFile, "")

      const testFilesFinder = new TestFilesFinder({directory: tempDirectory, processArgs: ["test", testFile]})
      const testFiles = await testFilesFinder.findTestFiles()

      expect(testFiles).toEqual([testFile])
    } finally {
      await fs.rm(tempDirectory, {recursive: true, force: true})
    }
  })
})
