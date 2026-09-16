// @ts-check

import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import {
  TestProfiler as PackageTestProfiler,
  TestSuiteSplitter as PackageTestSuiteSplitter,
  canonicalTimingManifestPath as packageCanonicalTimingManifestPath,
  compareTimingManifestPaths as packageCompareTimingManifestPaths,
  formatTestProfileSummary as packageFormatTestProfileSummary,
  mergeTestProfileTimingManifests as packageMergeTestProfileTimingManifests,
  normalizeExamplePatterns as packageNormalizeExamplePatterns,
  timingManifestFileSetHash as packageTimingManifestFileSetHash,
  timingManifestFromProfile as packageTimingManifestFromProfile,
  validateTimingManifest as packageValidateTimingManifest,
  writeTestProfileOutputs as packageWriteTestProfileOutputs,
  writeTimingManifest as packageWriteTimingManifest
} from "@velocious/testing/node"
import { validateTestActivityName as packageValidateTestActivityName } from "@velocious/testing/profiling"

import { describe, expect, it } from "../../src/testing/test.js"
import { validateTestActivityName } from "../../src/testing/test-profile-activity.js"
import {
  formatTestProfileSummary,
  timingManifestFromProfile,
  writeTestProfileOutputs,
  writeTimingManifest
} from "../../src/testing/test-profile-output.js"
import TestProfiler from "../../src/testing/test-profiler.js"
import TestSuiteSplitter from "../../src/testing/test-suite-splitter.js"
import { normalizeExamplePatterns } from "../../src/testing/test-filter-parser.js"
import {
  canonicalTimingManifestPath,
  compareTimingManifestPaths,
  mergeTestProfileTimingManifests,
  timingManifestFileSetHash,
  validateTimingManifest
} from "../../src/testing/timing-manifest.js"
import { buildTestingConfiguration } from "../helpers/testing-runner-parity.js"

const repositoryDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..")

/**
 * @param {object} args - Profile overrides.
 * @param {number} args.groupNumber - One-indexed shard number.
 * @param {Record<string, number>} args.timingManifest - Shard timing map.
 * @param {"passed" | "no-tests" | "failed"} [args.status] - Profile status.
 * @returns {ReturnType<typeof JSON.parse>} - Minimal rich profile.
 */
function profile({groupNumber, timingManifest, status = "passed"}) {
  const fileCount = Object.keys(timingManifest).length

  return {
    schema: "velocious.test-profile",
    schemaVersion: 1,
    status,
    counts: status === "no-tests"
      ? {discovered: 0, executed: 0, failed: 0, passed: 0, attempts: 0}
      : {discovered: fileCount, executed: fileCount, failed: status === "failed" ? 1 : 0, passed: status === "passed" ? fileCount : 0, attempts: fileCount},
    files: [],
    tests: [],
    selection: {
      discoveredFileCount: 2,
      excludeTagCount: 0,
      fileCount,
      focused: false,
      hasExampleFilters: false,
      hasLineFilters: false,
      includeTagCount: 0,
      pathBase: "configuration-directory",
      shard: {groups: 4, groupNumber},
      testFileSetHash: timingManifestFileSetHash(["spec/a-spec.js", "spec/b-spec.js"])
    },
    timingManifest
  }
}

describe("@velocious/testing infrastructure adoption", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("pins the corrected public registry artifact without alternate sources", async () => {
    const packageLock = JSON.parse(await fs.readFile(path.join(repositoryDirectory, "package-lock.json"), "utf8"))
    const installed = packageLock.packages["node_modules/@velocious/testing"]

    expect(installed.version).toBe("0.0.17")
    expect(installed.resolved).toBe("https://registry.npmjs.org/@velocious/testing/-/testing-0.0.17.tgz")
    expect(installed.integrity).toBe("sha512-cb+G5oxi2HJNd6Vv8tfVi0JRAerlW5M/QcmQWdhaLHY7vQe8BmGSRj2sDMCvN2quR4yghiXgiVnnZIHzfPWCYQ==")
  })

  it("re-exports package-owned generic behavior through compatibility paths", () => {
    expect(TestSuiteSplitter).toBe(PackageTestSuiteSplitter)
    expect(normalizeExamplePatterns).toBe(packageNormalizeExamplePatterns)
    expect(canonicalTimingManifestPath).toBe(packageCanonicalTimingManifestPath)
    expect(compareTimingManifestPaths).toBe(packageCompareTimingManifestPaths)
    expect(validateTimingManifest).toBe(packageValidateTimingManifest)
    expect(timingManifestFileSetHash).toBe(packageTimingManifestFileSetHash)
    expect(mergeTestProfileTimingManifests).toBe(packageMergeTestProfileTimingManifests)
    expect(formatTestProfileSummary).toBe(packageFormatTestProfileSummary)
    expect(timingManifestFromProfile).toBe(packageTimingManifestFromProfile)
    expect(writeTestProfileOutputs).toBe(packageWriteTestProfileOutputs)
    expect(writeTimingManifest).toBe(packageWriteTimingManifest)
    expect(validateTestActivityName).toBe(packageValidateTestActivityName)
  })

  it("keeps only the Velocious async-context adapter around the package profiler", () => {
    const profiler = new TestProfiler({
      configuration: buildTestingConfiguration(),
      projectDirectory: repositoryDirectory
    })

    expect(profiler).toBeInstanceOf(PackageTestProfiler)
  })

  it("forms a deterministic complete four-way partition with missing timing fallback", () => {
    const testFiles = [
      "/project/spec/system/a-spec.js",
      "/project/spec/controller/b-spec.js",
      "/project/spec/utils/c-spec.js",
      "/project/spec/frontend-models/d.browser-spec.js",
      "/project/spec/utils/e-spec.js"
    ]
    const partition = Array.from({length: 4}, (_, index) => new TestSuiteSplitter({
      groups: 4,
      groupNumber: index + 1,
      testFiles: [...testFiles].reverse(),
      baseDirectory: "/project",
      timingManifest: {"spec/system/a-spec.js": 2}
    }).getGroupFiles())
    const repeated = Array.from({length: 4}, (_, index) => new TestSuiteSplitter({
      groups: 4,
      groupNumber: index + 1,
      testFiles,
      baseDirectory: "/project",
      timingManifest: {"spec/system/a-spec.js": 2}
    }).getGroupFiles())

    expect(partition).toEqual(repeated)
    expect(partition.flat().sort()).toEqual([...testFiles].sort())
    expect(new Set(partition.flat()).size).toBe(testFiles.length)
  })

  it("accepts only safe empty shards and rejects failed timing history", async () => {
    const inputs = [
      {profile: profile({groupNumber: 1, timingManifest: {"spec/a-spec.js": 10}}), source: "one.json"},
      {profile: profile({groupNumber: 2, timingManifest: {"spec/b-spec.js": 20}}), source: "two.json"},
      {profile: profile({groupNumber: 3, timingManifest: {}, status: "no-tests"}), source: "three.json"},
      {profile: profile({groupNumber: 4, timingManifest: {}, status: "no-tests"}), source: "four.json"}
    ]

    expect(mergeTestProfileTimingManifests(inputs)).toEqual({"spec/a-spec.js": 10, "spec/b-spec.js": 20})
    await expect(() => mergeTestProfileTimingManifests([
      {...inputs[0], profile: profile({groupNumber: 1, timingManifest: {"spec/a-spec.js": 10}, status: "failed"})},
      ...inputs.slice(1)
    ])).toThrow(/passed status/)
  })
})
