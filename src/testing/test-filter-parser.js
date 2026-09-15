// @ts-check

import {
  extractTestCliArguments,
  normalizeExamplePatterns
} from "@velocious/testing/node"

/**
 * @typedef {object} ParseFiltersResult
 * @property {string[]} includeTags - Tags to include.
 * @property {string[]} excludeTags - Tags to exclude.
 * @property {string[]} examplePatterns - Example name patterns.
 * @property {string[]} filteredProcessArgs - Remaining process args with package-owned flags removed.
 * @property {number | undefined} groups - Total number of groups for test splitting.
 * @property {number | undefined} groupNumber - Which group to run (1-indexed).
 * @property {boolean} profile - Whether test profiling is enabled.
 * @property {string | undefined} profileJsonPath - Rich profile output path.
 * @property {string | undefined} timingManifestPath - JSON timing manifest path.
 * @property {string | undefined} timingManifestOutputPath - Timing manifest output path.
 * @property {number | undefined} retries - Default retry count.
 * @property {string[]} setupFiles - Setup files imported before test files.
 * @property {number | undefined} timeoutMs - Default lifecycle timeout.
 */

export { normalizeExamplePatterns }

/**
 * Preserves the Velocious parser result while delegating package-owned option parsing.
 * @param {string[]} processArgs - Raw process arguments including the command name.
 * @returns {ParseFiltersResult} - Package options and downstream process arguments.
 */
export function parseFilters(processArgs) {
  const {options, remainingArguments} = extractTestCliArguments(processArgs)

  return {
    includeTags: options.includeTags,
    excludeTags: options.excludeTags,
    examplePatterns: options.examples,
    filteredProcessArgs: remainingArguments,
    groups: options.groups,
    groupNumber: options.groupNumber,
    profile: options.profile === true,
    profileJsonPath: options.profileJsonPath,
    timingManifestPath: options.timingManifestPath,
    timingManifestOutputPath: options.timingManifestOutputPath,
    retries: options.retries,
    setupFiles: options.setupFiles,
    timeoutMs: options.timeoutMs
  }
}
