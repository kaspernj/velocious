// @ts-check

import path from "path"
import restArgsError from "../utils/rest-args-error.js"

/**
 * @typedef {object} SplitterFileEntry
 * @property {string} filePath - Absolute file path.
 * @property {number} weight - Computed weight for load balancing.
 */

/**
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
   * @param {object} args - Options.
   * @param {number} args.groups - Total number of groups.
   * @param {number} args.groupNumber - Which group to return (1-indexed).
   * @param {string[]} args.testFiles - All discovered test file paths.
   * @param {string} [args.baseDirectory] - Base directory for relative path computation.
   */
  constructor({groups, groupNumber, testFiles, baseDirectory, ...restArgs}) {
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
    const relativePath = path.relative(this._baseDirectory, filePath).split(path.sep).join("/")
    let weight = DEFAULT_WEIGHT

    // Extract the first directory under spec/ (e.g., "spec/database/..." → "database")
    const specDirMatch = relativePath.match(/^(?:spec|__tests__|tests)\/([^/]+)\//)

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
    /** @type {GroupBucket[]} */
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
