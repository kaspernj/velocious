// @ts-check

import fs from "node:fs/promises"
import path from "node:path"
import {build} from "esbuild"
import SystemTest from "system-testing/build/system-test.js"
import configurationResolver from "../src/configuration-resolver.js"
import TestFilesFinder from "../src/testing/test-files-finder.js"
import TestRunner from "../src/testing/test-runner.js"
import {normalizeExamplePatterns, parseFilters} from "../src/testing/test-filter-parser.js"

const rootDir = process.cwd()
const distDir = path.join(rootDir, "dist")
const entryFile = path.join(rootDir, "src/testing/browser-test-app.js")
const defaultBrowserPattern = /\.browser-(spec|test)\.(m|)js$/

/**
 * @param {string} filePath - File path.
 * @returns {boolean} - Whether file matches browser test pattern.
 */
function isBrowserTestFile(filePath) {
  const customPattern = process.env.VELOCIOUS_BROWSER_TEST_PATTERN
  const pattern = customPattern ? new RegExp(customPattern) : defaultBrowserPattern
  return pattern.test(path.basename(filePath))
}

/**
 * @returns {Promise<void>} - Resolves when the browser test app is built.
 */
async function buildBrowserTestApp() {
  await fs.rm(distDir, {recursive: true, force: true})
  await fs.mkdir(distDir, {recursive: true})

  await build({
    entryPoints: [entryFile],
    bundle: true,
    format: "esm",
    outdir: distDir,
    platform: "browser",
    target: "es2020",
    logLevel: "silent",
    sourcemap: true
  })

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Velocious Browser Tests</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/browser-test-app.js"></script>
  </body>
</html>
`

  await fs.writeFile(path.join(distDir, "index.html"), html, "utf8")
}

/**
 * @returns {Promise<import("../src/configuration.js").default>} - The configuration.
 */
async function resolveConfiguration() {
  const configDirectory = process.env.VELOCIOUS_TEST_CONFIG_DIR
    ? path.resolve(process.env.VELOCIOUS_TEST_CONFIG_DIR)
    : path.join(rootDir, "spec/dummy")

  const configuration = await configurationResolver({directory: configDirectory})
  configuration.setCurrent()

  return configuration
}

/**
 * @param {string[]} processArgs - Process args.
 * @returns {Promise<{testFiles: string[], lineFilters: Record<string, number[]>, includeTags: string[], excludeTags: string[], examplePatterns: RegExp[]}>} - Test data.
 */
async function resolveTests(processArgs) {
  const directory = process.env.VELOCIOUS_TEST_DIR
    ? path.resolve(process.env.VELOCIOUS_TEST_DIR)
    : rootDir
  const directories = process.env.VELOCIOUS_TEST_DIR
    ? [directory]
    : [`${rootDir}/__tests__`, `${rootDir}/tests`, `${rootDir}/spec`]

  const {includeTags, excludeTags, examplePatterns, filteredProcessArgs} = parseFilters(processArgs)
  const testFilesFinder = new TestFilesFinder({
    directory,
    directories,
    processArgs: filteredProcessArgs
  })
  const testFiles = await testFilesFinder.findTestFiles()
  const browserTestFiles = testFiles.filter((file) => isBrowserTestFile(file))

  if (browserTestFiles.length === 0) {
    throw new Error("No browser tests matched. Use *.browser-test.js or *.browser-spec.js (override with VELOCIOUS_BROWSER_TEST_PATTERN).")
  }

  return {
    testFiles: browserTestFiles,
    lineFilters: testFilesFinder.getLineFiltersByFile(),
    includeTags,
    excludeTags,
    examplePatterns: normalizeExamplePatterns(examplePatterns)
  }
}

async function main() {
  const processArgs = ["test:browser", ...process.argv.slice(2)]

  process.env.SYSTEM_TEST_HOST ||= "dist"

  await buildBrowserTestApp()

  const configuration = await resolveConfiguration()
  const {testFiles, lineFilters, includeTags, excludeTags, examplePatterns} = await resolveTests(processArgs)
  const testRunner = new TestRunner({
    configuration,
    excludeTags,
    includeTags,
    testFiles,
    lineFilters,
    examplePatterns
  })
  const systemTest = SystemTest.current({debug: process.env.SYSTEM_TEST_DEBUG === "true"})

  await systemTest.start()

  try {
    await testRunner.prepare()

    if (testRunner.getTestsCount() === 0) {
      throw new Error(`${testRunner.getTestsCount()} tests was found in ${testFiles.length} file(s)`)
    }

    await testRunner.run()

    const executedTests = testRunner.getExecutedTestsCount()
    const hasLineFilters = Object.keys(testRunner.getLineFilters()).length > 0
    const hasExampleFilters = examplePatterns.length > 0
    const hasTagFilters = includeTags.length > 0 || excludeTags.length > 0

    if ((hasTagFilters || hasLineFilters || hasExampleFilters) && executedTests === 0) {
      console.error("\nNo tests matched the provided filters")
      process.exitCode = 1
      return
    }

    if (testRunner.isFailed()) {
      const failedTests = testRunner.getFailedTestDetails()

      if (failedTests.length > 0) {
        console.error("\nFailed tests:")

        for (const failed of failedTests) {
          const location = failed.filePath && failed.line
            ? ` (${failed.filePath}:${failed.line})`
            : ""
          console.error(`- ${failed.fullDescription}${location}`)
        }
      }

      console.error(`\nTest run failed with ${testRunner.getFailedTests()} failed tests and ${testRunner.getSuccessfulTests()} successfull`)
      process.exitCode = 1
    } else if (testRunner.areAnyTestsFocussed()) {
      console.error(`\nFocussed run with ${testRunner.getFailedTests()} failed tests and ${testRunner.getSuccessfulTests()} successfull`)
      process.exitCode = 1
    } else {
      console.log(`\nTest run succeeded with ${testRunner.getSuccessfulTests()} successful tests`)
    }
  } finally {
    await systemTest.stop()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
