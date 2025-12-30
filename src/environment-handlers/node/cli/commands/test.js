// @ts-check

import BaseCommand from "../../../../cli/base-command.js"
import TestFilesFinder from "../../../../testing/test-files-finder.js"
import TestRunner from "../../../../testing/test-runner.js"
import path from "path"

const INCLUDE_TAG_FLAGS = new Set(["--tag", "--include-tag", "-t"])
const EXCLUDE_TAG_FLAGS = new Set(["--exclude-tag", "--skip-tag", "-x"])

/**
 * @param {string | undefined} value - Tag argument value.
 * @returns {string[]} - Tags list.
 */
function splitTags(value) {
  if (!value) return []

  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
}

/**
 * @param {string[]} processArgs - Process args.
 * @returns {{includeTags: string[], excludeTags: string[], filteredProcessArgs: string[]}} - Parsed tags and process args.
 */
function parseTagFilters(processArgs) {
  const includeTags = []
  const excludeTags = []
  const filteredProcessArgs = processArgs.length > 0 ? [processArgs[0]] : []
  let inRestArgs = false

  for (let i = 1; i < processArgs.length; i++) {
    const arg = processArgs[i]

    if (arg === "--") {
      inRestArgs = true
      filteredProcessArgs.push(arg)
      continue
    }

    if (!inRestArgs) {
      if (INCLUDE_TAG_FLAGS.has(arg)) {
        const nextValue = processArgs[i + 1]

        if (nextValue && !nextValue.startsWith("-")) {
          includeTags.push(...splitTags(nextValue))
          i++
        }
        continue
      }

      if (EXCLUDE_TAG_FLAGS.has(arg)) {
        const nextValue = processArgs[i + 1]

        if (nextValue && !nextValue.startsWith("-")) {
          excludeTags.push(...splitTags(nextValue))
          i++
        }
        continue
      }

      if (arg.startsWith("--tag=")) {
        includeTags.push(...splitTags(arg.slice("--tag=".length)))
        continue
      }

      if (arg.startsWith("--include-tag=")) {
        includeTags.push(...splitTags(arg.slice("--include-tag=".length)))
        continue
      }

      if (arg.startsWith("--exclude-tag=")) {
        excludeTags.push(...splitTags(arg.slice("--exclude-tag=".length)))
        continue
      }

      if (arg.startsWith("--skip-tag=")) {
        excludeTags.push(...splitTags(arg.slice("--skip-tag=".length)))
        continue
      }
    }

    filteredProcessArgs.push(arg)
  }

  return {
    includeTags: Array.from(new Set(includeTags)),
    excludeTags: Array.from(new Set(excludeTags)),
    filteredProcessArgs
  }
}

export default class VelociousCliCommandsTest extends BaseCommand {
  async execute() {
    this.getConfiguration().setEnvironment("test")

    let directory
    const directories = []
    const testDirectories = this.getConfiguration().getTestDirectories()

    if (process.env.VELOCIOUS_TEST_DIR) {
      directory = process.env.VELOCIOUS_TEST_DIR
      directories.push(process.env.VELOCIOUS_TEST_DIR)
    } else if (testDirectories && testDirectories.length > 0) {
      directory = this.getConfiguration().getDirectory()
      for (const testDirectory of testDirectories) {
        directories.push(path.isAbsolute(testDirectory) ? testDirectory : `${directory}/${testDirectory}`)
      }
    } else {
      directory = this.directory()
      directories.push(`${this.directory()}/__tests__`)
      directories.push(`${this.directory()}/tests`)
      directories.push(`${this.directory()}/spec`)
    }

    const {includeTags, excludeTags, filteredProcessArgs} = parseTagFilters(this.processArgs || [])
    const testFilesFinder = new TestFilesFinder({directory, directories, processArgs: filteredProcessArgs})
    const testFiles = await testFilesFinder.findTestFiles()
    const testRunner = new TestRunner({configuration: this.getConfiguration(), excludeTags, includeTags, testFiles})

    await testRunner.prepare()

    if (testRunner.getTestsCount() === 0) {
      throw new Error(`${testRunner.getTestsCount()} tests was found in ${testFiles.length} file(s)`)
    }

    await testRunner.run()

    const executedTests = testRunner.getExecutedTestsCount()

    if ((includeTags.length > 0 || excludeTags.length > 0) && executedTests === 0) {
      console.error("\nNo tests matched the provided tag filters")
      process.exit(1)
    }

    if (testRunner.isFailed()) {
      console.error(`\nTest run failed with ${testRunner.getFailedTests()} failed tests and ${testRunner.getSuccessfulTests()} successfull`)
      process.exit(1)
    } else if (testRunner.areAnyTestsFocussed()) {
      console.error(`\nFocussed run with ${testRunner.getFailedTests()} failed tests and ${testRunner.getSuccessfulTests()} successfull`)
      process.exit(1)
    } else {
      console.log(`\nTest run succeeded with ${testRunner.getSuccessfulTests()} successful tests`)
      process.exit(0)
    }
  }
}
