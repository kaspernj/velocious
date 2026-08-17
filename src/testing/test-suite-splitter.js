// @ts-check

import path from "path"
import restArgsError from "../utils/rest-args-error.js"
import { canonicalTimingManifestPath } from "./timing-manifest.js"

/**
 * SplitterFileEntry type.
 * @typedef {object} SplitterFileEntry
 * @property {string} filePath - Absolute file path.
 * @property {number} weight - Computed weight for load balancing.
 */

/**
 * GroupBucket type.
 * @typedef {object} GroupBucket
 * @property {number} totalWeight - Accumulated weight.
 * @property {string[]} files - Files assigned to this group.
 */

/** Default weight for a regular test file. */
const DEFAULT_WEIGHT = 1

/**
 * Weight multipliers by spec directory name.
 * Heavier test types get higher weights so greedy distribution balances wall-clock time.
 * @type {Record<string, number>}
 */
const DIRECTORY_WEIGHTS = {
  system: 20,
  "frontend-models": 10,
  controller: 3
}

/** Extra multiplier applied to browser spec files on top of directory weight. */
const BROWSER_SPEC_MULTIPLIER = 2

/**
 * Splits a list of test files into balanced groups using a greedy load-balancing algorithm.
 * Modeled after test_suite_splitter for RSpec.
 */
export default class TestSuiteSplitter {
  /**
   * Runs constructor.
   * @param {object} args - Options.
   * @param {number} args.groups - Total number of groups.
   * @param {number} args.groupNumber - Which group to return (1-indexed).
   * @param {string[]} args.testFiles - All discovered test file paths.
   * @param {string} [args.baseDirectory] - Base directory for relative path computation.
   * @param {ReturnType<typeof JSON.parse>} [args.timingManifest] - Relative test paths mapped to durations.
   */
  constructor({groups, groupNumber, testFiles, baseDirectory, timingManifest, ...restArgs}) {
    restArgsError(restArgs)

    if (!Number.isInteger(groups) || groups < 1) {
      throw new Error(`--groups must be a positive integer, got: ${groups}`)
    }

    if (!Number.isInteger(groupNumber) || groupNumber < 1 || groupNumber > groups) {
      throw new Error(`--group-number must be between 1 and ${groups}, got: ${groupNumber}`)
    }

    this._groups = groups
    this._groupNumber = groupNumber
    this._testFiles = testFiles
    this._baseDirectory = baseDirectory || process.cwd()
    this._timingManifest = this.normalizeTimingManifest(timingManifest)
  }

  /**
   * Returns the test files assigned to this group.
   * @returns {string[]} - File paths for the requested group.
   */
  getGroupFiles() {
    const weighted = this.computeWeightedFiles()
    const sorted = this.sortByWeightDescending(weighted)
    const buckets = this.distributeGreedily(sorted)

    return buckets[this._groupNumber - 1].files
  }

  /**
   * Computes weight for each test file based on directory type and file suffix.
   * @returns {SplitterFileEntry[]} - Weighted file entries.
   */
  computeWeightedFiles() {
    return this._testFiles.map((filePath) => ({
      filePath,
      weight: this.computeWeight(filePath)
    }))
  }

  /**
   * Computes the weight for a single file.
   * @param {string} filePath - Absolute file path.
   * @returns {number} - Weight value.
   */
  computeWeight(filePath) {
    const duration = this.timingManifestDuration(filePath)

    if (duration !== undefined && duration > 0) {
      return duration
    }

    const relativePath = this.normalizeRelativePath(path.relative(this._baseDirectory, filePath))
    let weight = DEFAULT_WEIGHT

    // Extract the type directory from the relative path.
    // Matches both "spec/system/..." (base is project root) and "system/..." (base is spec/ itself).
    const specDirMatch = relativePath.match(/^(?:(?:spec|__tests__|tests)\/)?([^/]+)\//)

    if (specDirMatch) {
      const dirName = specDirMatch[1]

      if (DIRECTORY_WEIGHTS[dirName] !== undefined) {
        weight = DIRECTORY_WEIGHTS[dirName]
      }
    }

    // Browser spec files are heavier
    if (filePath.endsWith(".browser-spec.js") || filePath.endsWith(".browser-spec.mjs")) {
      weight *= BROWSER_SPEC_MULTIPLIER
    }

    return weight
  }

  /**
   * Keeps only usable positive finite duration entries keyed by normalized relative path.
   * @param {ReturnType<typeof JSON.parse>} timingManifest - Parsed timing manifest.
   * @returns {Record<string, number>} - Valid normalized duration weights.
   */
  normalizeTimingManifest(timingManifest) {
    /** @type {Record<string, number>} */
    const normalized = {}

    if (!timingManifest || typeof timingManifest !== "object" || Array.isArray(timingManifest)) {
      return normalized
    }

    for (const [filePath, duration] of Object.entries(timingManifest)) {
      if (typeof duration !== "number" || !Number.isFinite(duration) || duration < 0) continue

      try {
        normalized[this.normalizeRelativePath(filePath)] = duration
      } catch (error) {
        if (!(error instanceof Error)) throw error
      }
    }

    return normalized
  }

  /**
   * Normalizes a relative test path to the manifest's portable slash format.
   * @param {string} filePath - Relative test path.
   * @returns {string} - Normalized relative test path.
   */
  normalizeRelativePath(filePath) {
    return canonicalTimingManifestPath(filePath)
  }

  /**
   * Returns the first manifest entry matching a discovered test file.
   * @param {string} filePath - Absolute test file path.
   * @returns {number | undefined} - Recorded duration, including zero.
   */
  timingManifestDuration(filePath) {
    for (const manifestPath of this.timingManifestPaths(filePath)) {
      if (Object.hasOwn(this._timingManifest, manifestPath)) return this._timingManifest[manifestPath]
    }

    return undefined
  }

  /**
   * Returns compatible manifest keys for one discovered file.
   * @param {string} filePath - Absolute test file path.
   * @returns {string[]} - Canonical keys in matching priority order.
   */
  timingManifestPaths(filePath) {
    const relativePath = this.normalizeRelativePath(path.relative(this._baseDirectory, filePath))
    const projectRelativePath = this.normalizeRelativePath(path.join(path.basename(this._baseDirectory), relativePath))

    return relativePath === projectRelativePath ? [relativePath] : [relativePath, projectRelativePath]
  }

  /**
   * Summarizes timing-history coverage for the complete discovered suite.
   * @returns {{heuristicFiles: number, measuredFiles: number, staleEntries: number}} - Compact coverage counts.
   */
  getTimingManifestCoverage() {
    const matchedManifestPaths = new Set()
    let measuredFiles = 0

    for (const filePath of this._testFiles) {
      let matchedDuration

      for (const manifestPath of this.timingManifestPaths(filePath)) {
        if (!Object.hasOwn(this._timingManifest, manifestPath)) continue

        matchedManifestPaths.add(manifestPath)
        matchedDuration = this._timingManifest[manifestPath]
        break
      }

      if (matchedDuration !== undefined && matchedDuration > 0) measuredFiles++
    }

    return {
      heuristicFiles: this._testFiles.length - measuredFiles,
      measuredFiles,
      staleEntries: Object.keys(this._timingManifest).length - matchedManifestPaths.size
    }
  }

  /**
   * Sorts files by weight descending, then by path for determinism.
   * @param {SplitterFileEntry[]} files - Weighted files.
   * @returns {SplitterFileEntry[]} - Sorted files.
   */
  sortByWeightDescending(files) {
    return [...files].sort((a, b) => {
      if (b.weight !== a.weight) {
        return b.weight - a.weight
      }

      return a.filePath.localeCompare(b.filePath)
    })
  }

  /**
   * Distributes files greedily into N balanced groups.
   * Each file is assigned to the group with the least accumulated weight.
   * @param {SplitterFileEntry[]} sortedFiles - Files sorted by weight descending.
   * @returns {GroupBucket[]} - Array of group buckets.
   */
  distributeGreedily(sortedFiles) {
    /**
     * Buckets.
     * @type {GroupBucket[]} */
    const buckets = []

    for (let i = 0; i < this._groups; i++) {
      buckets.push({totalWeight: 0, files: []})
    }

    for (const entry of sortedFiles) {
      const lightest = this.findLightestBucket(buckets)

      lightest.files.push(entry.filePath)
      lightest.totalWeight += entry.weight
    }

    return buckets
  }

  /**
   * Finds the bucket with the least accumulated weight.
   * Ties are broken by bucket index (earlier bucket wins) for determinism.
   * @param {GroupBucket[]} buckets - Group buckets.
   * @returns {GroupBucket} - The lightest bucket.
   */
  findLightestBucket(buckets) {
    let lightest = buckets[0]

    for (let i = 1; i < buckets.length; i++) {
      if (buckets[i].totalWeight < lightest.totalWeight) {
        lightest = buckets[i]
      }
    }

    return lightest
  }
}
