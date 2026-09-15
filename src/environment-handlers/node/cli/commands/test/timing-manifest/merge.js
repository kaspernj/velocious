// @ts-check

import BaseCommand from "../../../../../../cli/base-command.js"
import { parseTimingManifestMergeArguments as parsePackageTimingManifestMergeArguments } from "@velocious/testing/node"
import fs from "node:fs/promises"
import { writeTimingManifest } from "../../../../../../testing/test-profile-output.js"
import { mergeTestProfileTimingManifests } from "../../../../../../testing/timing-manifest.js"

/**
 * @typedef {object} TimingManifestMergeArguments
 * @property {string[]} inputPaths - Rich profile input paths.
 * @property {string} outputPath - Plain timing manifest output path.
 */

/** Node implementation for timing-manifest aggregation. */
export default class TestTimingManifestMerge extends BaseCommand {
  /**
   * Runs execute.
   * @returns {Promise<Record<string, number>>} - Complete merged timing manifest.
   */
  async execute() {
    const {inputPaths, outputPath} = parseTimingManifestMergeArguments(this.processArgs || [], process.cwd())
    const inputs = []

    for (const inputPath of inputPaths) {
      let content

      try {
        content = await fs.readFile(inputPath, "utf8")
      } catch (error) {
        throw new Error(`Failed to read test profile: ${inputPath}`, {cause: error})
      }

      let profile

      try {
        profile = JSON.parse(content)
      } catch (error) {
        throw new Error(`Failed to parse test profile: ${inputPath}`, {cause: error})
      }

      inputs.push({profile, source: inputPath})
    }

    const timingManifest = mergeTestProfileTimingManifests(inputs)

    await writeTimingManifest({outputPath, timingManifest})
    console.log(`Merged ${inputPaths.length} test profile shards into ${outputPath} (${Object.keys(timingManifest).length} files)`)

    return timingManifest
  }
}

/**
 * Parses strict merge arguments and resolves their paths.
 * @param {string[]} processArgs - Raw CLI arguments, including command name.
 * @param {string} cwd - Command working directory.
 * @returns {TimingManifestMergeArguments} - Validated resolved paths.
 */
export function parseTimingManifestMergeArguments(processArgs, cwd) {
  return parsePackageTimingManifestMergeArguments(processArgs.slice(1), {cwd})
}
