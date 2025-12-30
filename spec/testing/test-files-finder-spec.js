// @ts-check

import path from "path"
import TestFilesFinder from "../../src/testing/test-files-finder.js"
import {describe, expect, it} from "../../src/testing/test.js"

describe("testing - test files finder", async () => {
  it("accepts file args that include the base directory name", async () => {
    const directory = path.resolve(process.cwd(), "..")
    const testFilesFinder = new TestFilesFinder({
      directory,
      directories: [directory],
      processArgs: ["test", "spec/routes/resolver-logging-spec.js"]
    })

    const testFiles = await testFilesFinder.findTestFiles()
    const expectedPath = path.resolve(directory, "routes/resolver-logging-spec.js")

    expect(testFiles).toContain(expectedPath)
  })
})
