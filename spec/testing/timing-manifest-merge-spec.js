// @ts-check

import { describe, expect, it } from "../../src/testing/test.js"
import {
  mergeTestProfileTimingManifests,
  timingManifestFileSetHash
} from "../../src/testing/timing-manifest.js"

const allFiles = ["spec/a-spec.js", "spec/b-spec.js"]
const suiteHash = timingManifestFileSetHash(allFiles)

/**
 * @param {object} args - Profile overrides.
 * @param {number} args.groupNumber - One-indexed shard number.
 * @param {Record<string, number>} args.timingManifest - Shard timing map.
 * @param {number} [args.groups] - Total shard count.
 * @param {string} [args.pathBase] - Profile path base.
 * @param {string} [args.status] - Profile status.
 * @param {boolean} [args.focused] - Focused selection state.
 * @param {number} [args.includeTagCount] - Include-tag count.
 * @param {boolean} [args.hasLineFilters] - Line-filter state.
 * @param {string} [args.testFileSetHash] - Complete suite hash.
 * @param {number} [args.discoveredFileCount] - Pre-shard file count.
 * @returns {ReturnType<typeof JSON.parse>} - Rich profile fixture.
 */
function profile({
  groupNumber,
  timingManifest,
  groups = 2,
  pathBase = "configuration-directory",
  status = "passed",
  focused = false,
  includeTagCount = 0,
  hasLineFilters = false,
  testFileSetHash = suiteHash,
  discoveredFileCount = 2
}) {
  return {
    schema: "velocious.test-profile",
    schemaVersion: 1,
    status,
    selection: {
      discoveredFileCount,
      excludeTagCount: 0,
      fileCount: Object.keys(timingManifest).length,
      focused,
      hasExampleFilters: false,
      hasLineFilters,
      includeTagCount,
      pathBase,
      shard: {groups, groupNumber},
      testFileSetHash
    },
    timingManifest
  }
}

describe("timing manifest profile aggregation", () => {
  it("merges a complete compatible shard set into one sorted plain manifest", () => {
    const merged = mergeTestProfileTimingManifests([
      {profile: profile({groupNumber: 2, timingManifest: {"spec/b-spec.js": 20}}), source: "shard-2.json"},
      {profile: profile({groupNumber: 1, timingManifest: {"./spec/a-spec.js": 10}}), source: "shard-1.json"}
    ])

    expect(merged).toEqual({"spec/a-spec.js": 10, "spec/b-spec.js": 20})
  })

  it("rejects non-passing focused and filtered profiles", async () => {
    const invalidProfiles = [
      profile({groupNumber: 1, timingManifest: {"spec/a-spec.js": 10}, status: "failed"}),
      profile({groupNumber: 1, timingManifest: {"spec/a-spec.js": 10}, focused: true}),
      profile({groupNumber: 1, timingManifest: {"spec/a-spec.js": 10}, includeTagCount: 1}),
      profile({groupNumber: 1, timingManifest: {"spec/a-spec.js": 10}, hasLineFilters: true})
    ]

    for (const invalidProfile of invalidProfiles) {
      await expect(() => mergeTestProfileTimingManifests([
        {profile: invalidProfile, source: "shard-1.json"},
        {profile: profile({groupNumber: 2, timingManifest: {"spec/b-spec.js": 20}}), source: "shard-2.json"}
      ])).toThrow(/passed|focused|filtered/)
    }
  })

  it("rejects incomplete duplicate and incompatible shard sets", async () => {
    const shard1 = profile({groupNumber: 1, timingManifest: {"spec/a-spec.js": 10}})

    await expect(() => mergeTestProfileTimingManifests([{profile: shard1, source: "shard-1.json"}])).toThrow(/missing shard/i)
    await expect(() => mergeTestProfileTimingManifests([
      {profile: shard1, source: "shard-1.json"},
      {profile: profile({groupNumber: 1, timingManifest: {"spec/b-spec.js": 20}}), source: "duplicate-shard.json"}
    ])).toThrow(/duplicate shard/i)
    await expect(() => mergeTestProfileTimingManifests([
      {profile: shard1, source: "shard-1.json"},
      {profile: profile({groupNumber: 2, timingManifest: {"spec/b-spec.js": 20}, pathBase: "test-directory"}), source: "shard-2.json"}
    ])).toThrow(/path base/)
    await expect(() => mergeTestProfileTimingManifests([
      {profile: shard1, source: "shard-1.json"},
      {profile: profile({groupNumber: 2, timingManifest: {"spec/b-spec.js": 20}, testFileSetHash: timingManifestFileSetHash(["spec/a-spec.js", "spec/c-spec.js"])}), source: "shard-2.json"}
    ])).toThrow(/file set/)
    await expect(() => mergeTestProfileTimingManifests([
      {profile: shard1, source: "shard-1.json"},
      {profile: profile({groupNumber: 2, timingManifest: {"spec/a-spec.js": 20}}), source: "shard-2.json"}
    ])).toThrow(/duplicate timing path/i)
    await expect(() => mergeTestProfileTimingManifests([
      {profile: shard1, source: "shard-1.json"},
      {profile: profile({groupNumber: 2, timingManifest: {"spec/c-spec.js": 20}}), source: "shard-2.json"}
    ])).toThrow(/complete file universe/i)
  })
})
