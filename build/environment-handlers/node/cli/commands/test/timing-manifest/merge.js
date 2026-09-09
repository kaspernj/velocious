// @ts-check

import BaseCommand from "../../../../../../cli/base-command.js"
import fs from "node:fs/promises"
import path from "node:path"
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
 * Recognizes one output option spelling.
 * @param {string} argument - Current argument.
 * @param {string | undefined} nextArgument - Following argument.
 * @returns {{matched: boolean, skipNext: boolean, value: string | undefined}} - Parsed output option.
 */
function timingManifestOutputArgument(argument, nextArgument) {
  if (argument === "--output") {
    return {matched: true, skipNext: true, value: nextArgument}
  }

  if (argument.startsWith("--output=")) {
    return {matched: true, skipNext: false, value: argument.slice("--output=".length)}
  }

  return {matched: false, skipNext: false, value: undefined}
}

/**
 * Parses strict merge arguments and resolves their paths.
 * @param {string[]} processArgs - Raw CLI arguments, including command name.
 * @param {string} cwd - Command working directory.
 * @returns {TimingManifestMergeArguments} - Validated resolved paths.
 */
export function parseTimingManifestMergeArguments(processArgs, cwd) {
  const commandName = processArgs[0] || "test:timing-manifest:merge"
  const inputPaths = []
  let outputPath

  for (let index = 1; index < processArgs.length; index++) {
    const argument = processArgs[index]
    const outputArgument = timingManifestOutputArgument(argument, processArgs[index + 1])

    if (outputArgument.matched) {
      if (!outputArgument.value || outputArgument.value.startsWith("-")) throw new Error("Missing value for --output")
      if (outputPath) throw new Error("--output may only be provided once")
      outputPath = path.resolve(cwd, outputArgument.value)
      if (outputArgument.skipNext) index++
      continue
    }

    if (argument.startsWith("-")) throw new Error(`Unknown argument for ${commandName}: ${argument}`)
    inputPaths.push(path.resolve(cwd, argument))
  }

  if (!outputPath) throw new Error("--output is required")
  if (inputPaths.length === 0) throw new Error("At least one rich test profile input is required")

  const uniqueInputPaths = new Set(inputPaths)

  if (uniqueInputPaths.size !== inputPaths.length) throw new Error("Each rich test profile input must be provided once")
  if (uniqueInputPaths.has(outputPath)) throw new Error("Timing manifest output must not overwrite an input profile")

  return {inputPaths, outputPath}
}
