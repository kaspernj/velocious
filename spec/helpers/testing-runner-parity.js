// @ts-check

import { execFile } from "node:child_process"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { forcedString } from "typanic"

import TestRunner from "../../src/testing/test-runner.js"
import buildTestingConfiguration from "./testing-configuration.js"

/**
 * @typedef {object} TestingRunnerOptions
 * @property {import("@velocious/testing/runner").TestContext} [context] - Isolated package context.
 * @property {string[] | string} [excludeTags] - Tags excluded from the run.
 * @property {RegExp[]} [examplePatterns] - Full-name filters for the run.
 * @property {string[] | string} [includeTags] - Tags included in the run.
 * @property {Record<string, number[]>} [lineFilters] - Declaration lines included in the run.
 */

export {default as buildTestingConfiguration} from "./testing-configuration.js"

const execFileAsync = promisify(execFile)

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
