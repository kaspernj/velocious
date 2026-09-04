// @ts-check

import { execFile } from "node:child_process"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { forcedString } from "typanic"

import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import TestRunner from "../../src/testing/test-runner.js"
import repoRoot from "./repo-root.js"

/**
 * @typedef {object} TestingRunnerOptions
 * @property {string[] | string} [excludeTags] - Tags excluded from the run.
 * @property {RegExp[]} [examplePatterns] - Full-name filters for the run.
 * @property {string[] | string} [includeTags] - Tags included in the run.
 * @property {Record<string, number[]>} [lineFilters] - Declaration lines included in the run.
 */

const execFileAsync = promisify(execFile)

/** @returns {Configuration} - Minimal framework configuration for runner characterization. */
export function buildTestingConfiguration() {
  return new Configuration({
    database: {test: {}},
    directory: repoRoot(),
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    initializeModels: async () => {},
    locale: "en",
    localeFallbacks: {en: ["en"]},
    locales: ["en"]
  })
}

/**
 * @param {TestingRunnerOptions} [options] - Selection options for the runner.
 * @returns {TestRunner} - Isolated legacy runner.
 */
export function buildTestingRunner(options = {}) {
  return new TestRunner({
    configuration: buildTestingConfiguration(),
    testFiles: [],
    ...options
  })
}

/**
 * @param {Partial<import("../../src/testing/test-runner.js").TestsArgument>} [overrides] - Scope values to override.
 * @returns {import("../../src/testing/test-runner.js").TestsArgument} - Complete legacy test scope.
 */
export function testingScope(overrides = {}) {
  return {
    afterAlls: [],
    afterEaches: [],
    args: {},
    beforeAlls: [],
    beforeEaches: [],
    subs: {},
    tests: {},
    ...overrides
  }
}

/**
 * @param {TestRunner} testRunner - Runner to execute.
 * @param {import("../../src/testing/test-runner.js").TestsArgument} scope - Scope to execute.
 * @returns {Promise<void>} - Resolves when the scope and its cleanup settle.
 */
export async function runTestingScope(testRunner, scope) {
  await testRunner.runTests({
    afterEaches: [],
    beforeEaches: [],
    descriptions: [],
    indentLevel: 0,
    tests: scope
  })
}

/**
 * @param {string[]} argumentsList - Probe mode and mode-specific arguments.
 * @returns {Promise<string>} - Trimmed probe output.
 */
export async function runTestingPackageIdentityProbe(argumentsList) {
  const fixturePath = new URL("../testing/fixtures/testing-package/identity-probe.js", import.meta.url)
  const result = await execFileAsync(process.execPath, [fileURLToPath(fixturePath), ...argumentsList], {encoding: "utf8"})

  return forcedString(result.stdout, "identity probe stdout").trim()
}
