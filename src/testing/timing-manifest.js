// @ts-check

import sha256Hex from "../utils/sha256-hex.js"

/** @typedef {Record<string, number>} TimingManifest */

/**
 * ValidatedProfileShard type.
 * @typedef {object} ValidatedProfileShard
 * @property {number} discoveredFileCount - Complete pre-shard file count.
 * @property {number} fileCount - Selected post-shard file count.
 * @property {number} groupNumber - One-indexed shard number.
 * @property {number} groups - Complete shard count.
 * @property {string} pathBase - Profiling path-base semantics.
 * @property {string} testFileSetHash - Complete canonical file-set identity.
 * @property {TimingManifest} timingManifest - Canonical shard timing map.
 */

/**
 * TestProfileTimingManifestInput type.
 * @typedef {object} TestProfileTimingManifestInput
 * @property {ReturnType<typeof JSON.parse>} profile - Parsed rich test profile.
 * @property {string} source - Human-readable input source for validation errors.
 */

/**
 * Canonicalizes a timing-manifest path relative to its profiling base.
 * @param {string} filePath - Candidate relative path.
 * @returns {string} - Portable canonical path.
 */
export function canonicalTimingManifestPath(filePath) {
  if (typeof filePath !== "string" || filePath.length === 0) {
    throw new Error("Timing manifest keys must be non-empty relative paths")
  }

  const portablePath = filePath.replaceAll("\\", "/")

  if (portablePath.startsWith("/") || /^[A-Za-z]:/.test(portablePath)) {
    throw new Error(`Timing manifest key must be a relative path: ${filePath}`)
  }

  const segments = []

  for (const segment of portablePath.split("/")) {
    if (!segment || segment === ".") continue

    if (segment === "..") {
      if (segments.length === 0) {
        throw new Error(`Timing manifest key must be a non-escaping relative path: ${filePath}`)
      }

      segments.pop()
      continue
    }

    segments.push(segment)
  }

  if (segments.length === 0) {
    throw new Error(`Timing manifest key must be a non-empty relative path: ${filePath}`)
  }

  return segments.join("/")
}

/**
 * Compares timing-manifest paths by JavaScript code units without locale rules.
 * @param {string} filePathA - First path.
 * @param {string} filePathB - Second path.
 * @returns {number} - Negative, zero, or positive ordering result.
 */
export function compareTimingManifestPaths(filePathA, filePathB) {
  if (filePathA === filePathB) return 0

  return filePathA < filePathB ? -1 : 1
}

/**
 * Validates and sorts a plain timing manifest.
 * @param {ReturnType<typeof JSON.parse>} timingManifest - Parsed timing manifest.
 * @param {{source?: string}} [options] - Validation context.
 * @returns {TimingManifest} - Canonical sorted timing manifest.
 */
export function validateTimingManifest(timingManifest, {source = "timing manifest"} = {}) {
  if (!timingManifest || typeof timingManifest !== "object" || Array.isArray(timingManifest)) {
    throw new Error(`${source} must be a plain JSON object mapping relative paths to durations`)
  }

  /** @type {Map<string, {duration: number, originalPath: string}>} */
  const entries = new Map()

  for (const [originalPath, duration] of Object.entries(timingManifest)) {
    if (typeof duration !== "number" || !Number.isFinite(duration) || duration < 0) {
      throw new Error(`${source} has an invalid duration for ${originalPath}`)
    }

    const canonicalPath = canonicalTimingManifestPath(originalPath)
    const existing = entries.get(canonicalPath)

    if (existing) {
      throw new Error(`${source} has a normalized path collision between ${existing.originalPath} and ${originalPath}`)
    }

    entries.set(canonicalPath, {duration, originalPath})
  }

  return Object.fromEntries(
    [...entries.entries()]
      .sort(([filePathA], [filePathB]) => compareTimingManifestPaths(filePathA, filePathB))
      .map(([filePath, entry]) => [filePath, entry.duration])
  )
}

/**
 * Returns an opaque deterministic identity for a complete canonical test-file set.
 * @param {string[]} filePaths - Paths relative to one profiling base.
 * @returns {string} - SHA-256 file-set identity.
 */
export function timingManifestFileSetHash(filePaths) {
  const pathManifest = Object.fromEntries(filePaths.map((filePath) => [filePath, 0]))
  const canonicalPaths = Object.keys(validateTimingManifest(pathManifest, {source: "test file set"}))
  const identity = `velocious.test-file-set.v1\0${canonicalPaths.join("\0")}`

  return `sha256:${sha256Hex(identity)}`
}

/**
 * Validates that a parsed JSON value is a non-array object.
 * @param {ReturnType<typeof JSON.parse>} value - Candidate object.
 * @param {string} message - Validation error message.
 * @returns {void}
 */
function assertJsonObject(value, message) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message)
}

/**
 * Requires unfiltered, non-focused profile selection metadata.
 * @param {ReturnType<typeof JSON.parse>} selection - Rich profile selection.
 * @param {string} source - Input source.
 * @returns {void}
 */
function assertCompleteSelection(selection, source) {
  if (selection.focused !== false) throw new Error(`${source} must not be a focused test profile`)

  const selectionFilters = [
    [selection.includeTagCount, 0],
    [selection.excludeTagCount, 0],
    [selection.hasExampleFilters, false],
    [selection.hasLineFilters, false]
  ]

  if (selectionFilters.some(([value, expected]) => value !== expected)) {
    throw new Error(`${source} must not be a filtered test profile`)
  }
}

/**
 * Validates shard numbering metadata.
 * @param {ReturnType<typeof JSON.parse>} shard - Candidate shard selection.
 * @param {string} source - Input source.
 * @returns {{groupNumber: number, groups: number}} - Validated shard numbers.
 */
function validatedShardNumbers(shard, source) {
  assertJsonObject(shard, `${source} is missing shard metadata`)

  if (!Number.isInteger(shard.groups) || shard.groups < 1) {
    throw new Error(`${source} has an invalid shard group count`)
  }

  if (!Number.isInteger(shard.groupNumber) || shard.groupNumber < 1 || shard.groupNumber > shard.groups) {
    throw new Error(`${source} has an invalid shard number`)
  }

  return {groupNumber: shard.groupNumber, groups: shard.groups}
}

/**
 * Validates a non-negative integer selection count.
 * @param {ReturnType<typeof JSON.parse>} value - Candidate count.
 * @param {string} message - Validation error message.
 * @returns {number} - Validated count.
 */
function validatedSelectionCount(value, message) {
  if (!Number.isInteger(value) || value < 0) throw new Error(message)

  return value
}

/**
 * Validates the selection identity used across shard profiles.
 * @param {ReturnType<typeof JSON.parse>} selection - Rich profile selection.
 * @param {string} source - Input source.
 * @returns {{pathBase: string, testFileSetHash: string}} - Validated identity.
 */
function validatedSelectionIdentity(selection, source) {
  if (!["configuration-directory", "test-directory"].includes(selection.pathBase)) {
    throw new Error(`${source} has an invalid timing manifest path base`)
  }

  if (typeof selection.testFileSetHash !== "string" || !/^sha256:[a-f0-9]{64}$/.test(selection.testFileSetHash)) {
    throw new Error(`${source} has an invalid test file set identity`)
  }

  return {pathBase: selection.pathBase, testFileSetHash: selection.testFileSetHash}
}

/**
 * Validates one rich profile and returns its aggregation contract.
 * @param {TestProfileTimingManifestInput} input - Profile input.
 * @returns {ValidatedProfileShard} - Validated shard contract.
 */
function validatedProfileShard(input) {
  const {profile, source} = input

  assertJsonObject(profile, `${source} must be a rich Velocious test profile`)

  if (profile.schema !== "velocious.test-profile" || profile.schemaVersion !== 1) {
    throw new Error(`${source} has an incompatible Velocious test profile schema`)
  }

  if (profile.status !== "passed") throw new Error(`${source} must have passed status for timing aggregation`)

  const selection = profile.selection

  assertJsonObject(selection, `${source} is missing test profile selection metadata`)
  assertCompleteSelection(selection, source)
  const {groupNumber, groups} = validatedShardNumbers(selection.shard, source)
  const discoveredFileCount = validatedSelectionCount(
    selection.discoveredFileCount,
    `${source} has an invalid pre-shard discovered file count`
  )
  const fileCount = validatedSelectionCount(
    selection.fileCount,
    `${source} has an invalid post-shard file count`
  )
  const {pathBase, testFileSetHash} = validatedSelectionIdentity(selection, source)

  const timingManifest = validateTimingManifest(profile.timingManifest, {source: `${source} timing manifest`})

  if (Object.keys(timingManifest).length !== fileCount) {
    throw new Error(`${source} timing manifest does not match its post-shard file count`)
  }

  return {
    discoveredFileCount,
    fileCount,
    groupNumber,
    groups,
    pathBase,
    testFileSetHash,
    timingManifest
  }
}

/**
 * Requires one shard to describe the same complete selection as the first.
 * @param {ValidatedProfileShard} shard - Candidate shard.
 * @param {ValidatedProfileShard} expected - First shard contract.
 * @param {string} source - Candidate source.
 * @returns {void}
 */
function assertCompatibleShard(shard, expected, source) {
  if (shard.groups !== expected.groups) throw new Error(`${source} has a different shard group count`)
  if (shard.pathBase !== expected.pathBase) throw new Error(`${source} has a different timing manifest path base`)
  if (shard.discoveredFileCount !== expected.discoveredFileCount) throw new Error(`${source} has a different discovered file count`)
  if (shard.testFileSetHash !== expected.testFileSetHash) throw new Error(`${source} has a different test file set identity`)
}

/**
 * Adds one validated shard timing map without allowing duplicate canonical keys.
 * @param {object} args - Merge state.
 * @param {Map<string, {duration: number, source: string}>} args.mergedEntries - Destination timing entries.
 * @param {ValidatedProfileShard} args.shard - Candidate shard.
 * @param {string} args.source - Candidate source.
 * @returns {void}
 */
function mergeShardTimingManifest({mergedEntries, shard, source}) {
  for (const [filePath, duration] of Object.entries(shard.timingManifest)) {
    const existingEntry = mergedEntries.get(filePath)

    if (existingEntry) {
      throw new Error(`Duplicate timing path ${filePath} in ${existingEntry.source} and ${source}`)
    }

    mergedEntries.set(filePath, {duration, source})
  }
}

/**
 * Merges a complete compatible set of rich Velocious shard profiles.
 * @param {TestProfileTimingManifestInput[]} inputs - Parsed profile documents and sources.
 * @returns {TimingManifest} - Complete sorted plain timing manifest.
 */
export function mergeTestProfileTimingManifests(inputs) {
  if (inputs.length === 0) throw new Error("At least one rich test profile is required")

  const shards = inputs.map((input) => validatedProfileShard(input))
  const expected = shards[0]
  /** @type {Map<number, string>} */
  const shardSources = new Map()
  /** @type {Map<string, {duration: number, source: string}>} */
  const mergedEntries = new Map()
  let selectedFileCount = 0

  for (let index = 0; index < shards.length; index++) {
    const shard = shards[index]
    const source = inputs[index].source

    assertCompatibleShard(shard, expected, source)

    const existingShardSource = shardSources.get(shard.groupNumber)

    if (existingShardSource) {
      throw new Error(`Duplicate shard ${shard.groupNumber} in ${existingShardSource} and ${source}`)
    }

    shardSources.set(shard.groupNumber, source)
    selectedFileCount += shard.fileCount
    mergeShardTimingManifest({mergedEntries, shard, source})
  }

  const missingShardNumbers = []

  for (let groupNumber = 1; groupNumber <= expected.groups; groupNumber++) {
    if (!shardSources.has(groupNumber)) missingShardNumbers.push(groupNumber)
  }

  if (missingShardNumbers.length > 0) {
    throw new Error(`Missing shard profiles: ${missingShardNumbers.join(", ")}`)
  }

  if (selectedFileCount !== expected.discoveredFileCount || mergedEntries.size !== expected.discoveredFileCount) {
    throw new Error("Merged timing manifest does not cover the complete file universe")
  }

  const merged = Object.fromEntries(
    [...mergedEntries].map(([filePath, entry]) => [filePath, entry.duration])
  )

  if (timingManifestFileSetHash(Object.keys(merged)) !== expected.testFileSetHash) {
    throw new Error("Merged timing manifest does not match the complete file universe")
  }

  return validateTimingManifest(merged, {source: "merged timing manifest"})
}
