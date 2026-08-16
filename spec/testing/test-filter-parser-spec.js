// @ts-check

import { parseFilters } from "../../src/testing/test-filter-parser.js"
import { describe, expect, it } from "../../src/testing/test.js"

describe("parseFilters", {databaseCleaning: {transaction: true}}, () => {
  describe("group splitting flags", () => {
    it("parses and strips a timing manifest path", () => {
      const result = parseFilters(["test", "--groups=4", "--group-number=2", "--timing-manifest", "tmp/timings.json", "spec/testing/"])

      expect(result.timingManifestPath).toBe("tmp/timings.json")
      expect(result.filteredProcessArgs).toEqual(["test", "spec/testing/"])
    })

    it("parses a timing manifest path with equals syntax", () => {
      const result = parseFilters(["test", "--timing-manifest=tmp/timings.json"])

      expect(result.timingManifestPath).toBe("tmp/timings.json")
    })

    it("parses --groups and --group-number with = syntax", () => {
      const result = parseFilters(["test", "--groups=4", "--group-number=2"])

      expect(result.groups).toBe(4)
      expect(result.groupNumber).toBe(2)
    })

    it("parses --groups and --group-number with space syntax", () => {
      const result = parseFilters(["test", "--groups", "6", "--group-number", "3"])

      expect(result.groups).toBe(6)
      expect(result.groupNumber).toBe(3)
    })

    it("returns undefined for groups when not specified", () => {
      const result = parseFilters(["test", "--tag", "fast"])

      expect(result.groups).toBe(undefined)
      expect(result.groupNumber).toBe(undefined)
    })

    it("strips group flags from filteredProcessArgs", () => {
      const result = parseFilters(["test", "--groups=4", "--group-number=2", "spec/testing/"])

      expect(result.filteredProcessArgs).toEqual(["test", "spec/testing/"])
    })

    it("combines group flags with tag flags", () => {
      const result = parseFilters(["test", "--groups=3", "--group-number=1", "--tag", "fast", "--exclude-tag", "slow"])

      expect(result.groups).toBe(3)
      expect(result.groupNumber).toBe(1)
      expect(result.includeTags).toEqual(["fast"])
      expect(result.excludeTags).toEqual(["slow"])
    })
  })

  describe("profiling flags", () => {
    it("parses profile outputs with separate and equals values", () => {
      const result = parseFilters([
        "test",
        "--profile",
        "--profile-json",
        "tmp/profile.json",
        "--timing-manifest-output=tmp/timings.json",
        "spec/testing/"
      ])

      expect(result.profile).toBe(true)
      expect(result.profileJsonPath).toBe("tmp/profile.json")
      expect(result.timingManifestOutputPath).toBe("tmp/timings.json")
      expect(result.filteredProcessArgs).toEqual(["test", "spec/testing/"])
    })

    it("leaves profiling flags after -- untouched", () => {
      const result = parseFilters(["test", "--", "--profile", "--profile-json=tmp/profile.json"])

      expect(result.profile).toBe(false)
      expect(result.profileJsonPath).toBe(undefined)
      expect(result.filteredProcessArgs).toEqual(["test", "--", "--profile", "--profile-json=tmp/profile.json"])
    })

    it("rejects missing manifest and profiling output values", async () => {
      await expect(() => parseFilters(["test", "--timing-manifest"])).toThrow(/--timing-manifest requires a path/)
      await expect(() => parseFilters(["test", "--profile-json"])).toThrow(/--profile-json requires a path/)
      await expect(() => parseFilters(["test", "--profile-json="])).toThrow(/--profile-json requires a path/)
      await expect(() => parseFilters(["test", "--timing-manifest-output", "--profile"])).toThrow(/--timing-manifest-output requires a path/)
    })
  })
})
