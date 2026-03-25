// @ts-check

import {parseFilters} from "../../src/testing/test-filter-parser.js"
import {describe, expect, it} from "../../src/testing/test.js"

describe("parseFilters", () => {
  describe("group splitting flags", () => {
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
})
