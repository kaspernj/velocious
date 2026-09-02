// @ts-check

import fs from "node:fs/promises"
import path from "node:path"
import {fileURLToPath, pathToFileURL} from "node:url"

import {defaultTestContext, waitForEvent as packageWaitForEvent} from "@velocious/testing"
import {build} from "esbuild"

import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import {describe, expect, it, tests, waitForEvent as facadeWaitForEvent} from "../../src/testing/test.js"
import TestRunner from "../../src/testing/test-runner.js"

const repositoryDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..")

/**
 * Counts tests in a Velocious test tree.
 * @param {import("../../src/testing/test-runner.js").TestsArgument} testTree - Test tree.
 * @returns {number} - Number of registered tests.
 */
function countTests(testTree) {
  return Object.keys(testTree.tests).length + Object.values(testTree.subs)
    .reduce((count, nestedTests) => count + countTests(nestedTests), 0)
}

/** @returns {Configuration} - Minimal runner configuration. */
function buildConfiguration() {
  return new Configuration({
    database: {test: {}},
    directory: repositoryDirectory,
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    initializeModels: async () => {},
    locale: "en",
    localeFallbacks: {en: ["en"]},
    locales: ["en"]
  })
}

describe("@velocious/testing integration", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("exports the package waitForEvent through the Velocious testing facade", () => {
    expect(facadeWaitForEvent).toEqual(packageWaitForEvent)
  })

  it("uses the exact package version as a runtime dependency", async () => {
    const packageJson = JSON.parse(await fs.readFile(path.join(repositoryDirectory, "package.json"), "utf8"))

    expect(packageJson.dependencies["@velocious/testing"]).toEqual("0.0.2")
    expect(packageJson.devDependencies["@velocious/testing"]).toEqual(undefined)
  })

  it("discovers tests imported from the public package with inherited options", async () => {
    const temporaryDirectory = path.join(repositoryDirectory, "tmp")

    await fs.mkdir(temporaryDirectory, {recursive: true})

    const fixtureDirectory = await fs.mkdtemp(path.join(temporaryDirectory, "public-testing-package-"))
    const fixturePath = path.join(fixtureDirectory, "imported-test.js")
    const suiteName = `public package fixture ${path.basename(fixtureDirectory)}`
    const originalTestCount = countTests(tests)

    await fs.writeFile(fixturePath, `
      import {describe, it} from "@velocious/testing"

      describe(${JSON.stringify(suiteName)}, {retries: 2, tags: "suite", timeoutMs: 1000, type: "model"}, () => {
        it("is visible to the Velocious runner", {retries: 3, tags: "test", timeoutMs: 2000}, () => {})

        describe("nested suite", {tags: "nested suite", type: "request"}, () => {
          it("inherits nested options", {tags: "nested test", timeoutMs: 3000}, () => {})
        })
      })
    `)

    defaultTestContext.reset()

    try {
      const testRunner = new TestRunner({
        configuration: buildConfiguration(),
        testFiles: [pathToFileURL(fixturePath).href]
      })

      await testRunner.prepare()

      const importedSuite = tests.subs[suiteName]
      const importedTest = importedSuite?.tests["is visible to the Velocious runner"]
      const nestedTest = importedSuite?.subs["nested suite"]?.tests["inherits nested options"]

      expect(testRunner.getTestsCount()).toEqual(originalTestCount + 2)
      expect(importedTest?.filePath).toEqual(fixturePath)
      expect(importedTest?.args).toEqual({
        databaseCleaning: {transaction: true},
        retries: 3,
        retry: 3,
        tags: ["suite", "test"],
        timeoutMs: 2000,
        timeoutSeconds: 2,
        type: "model"
      })
      expect(nestedTest?.args).toEqual({
        databaseCleaning: {transaction: true},
        retries: 2,
        retry: 2,
        tags: ["suite", "nested suite", "nested test"],
        timeoutMs: 3000,
        timeoutSeconds: 3,
        type: "request"
      })
    } finally {
      delete tests.subs[suiteName]
      defaultTestContext.reset()
      await fs.rm(fixtureDirectory, {recursive: true})
    }
  })

  it("bundles the package root import for browsers without Node built-ins or raw import.meta", async () => {
    const result = await build({
      bundle: true,
      format: "esm",
      logLevel: "silent",
      metafile: true,
      platform: "browser",
      stdin: {
        contents: 'import {waitForEvent} from "@velocious/testing"; globalThis.waitForEvent = waitForEvent',
        loader: "js",
        resolveDir: repositoryDirectory,
        sourcefile: "testing-package-browser-bundle-entry.js"
      },
      write: false
    })

    if (!result.metafile) throw new Error("Expected esbuild metafile")
    if (!result.outputFiles || !result.outputFiles[0]) throw new Error("Expected esbuild output")

    const inputs = Object.keys(result.metafile.inputs)
    const output = result.outputFiles[0].text

    expect(inputs.some((input) => input.startsWith("node:"))).toEqual(false)
    expect(output.includes("import.meta")).toEqual(false)
  })
})
