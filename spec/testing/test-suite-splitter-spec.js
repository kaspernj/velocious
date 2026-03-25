// @ts-check

import TestSuiteSplitter from "../../src/testing/test-suite-splitter.js"
import {describe, expect, it} from "../../src/testing/test.js"

describe("TestSuiteSplitter", () => {
  it("distributes files across groups with no duplicates and no missing files", () => {
    const testFiles = [
      "/project/spec/database/migrations-spec.js",
      "/project/spec/database/model-spec.js",
      "/project/spec/controller/routes-spec.js",
      "/project/spec/utils/string-spec.js",
      "/project/spec/utils/logger-spec.js",
      "/project/spec/frontend-models/base-spec.js",
      "/project/spec/frontend-models/query.browser-spec.js"
    ]

    const allFiles = []

    for (let groupNumber = 1; groupNumber <= 3; groupNumber++) {
      const splitter = new TestSuiteSplitter({
        groups: 3,
        groupNumber,
        testFiles,
        baseDirectory: "/project"
      })

      allFiles.push(...splitter.getGroupFiles())
    }

    const sorted = [...allFiles].sort()
    const expectedSorted = [...testFiles].sort()

    expect(sorted).toEqual(expectedSorted)
  })

  it("returns all files when groups is 1", () => {
    const testFiles = [
      "/project/spec/database/migrations-spec.js",
      "/project/spec/utils/string-spec.js"
    ]

    const splitter = new TestSuiteSplitter({
      groups: 1,
      groupNumber: 1,
      testFiles,
      baseDirectory: "/project"
    })

    const result = splitter.getGroupFiles()
    const sorted = [...result].sort()
    const expectedSorted = [...testFiles].sort()

    expect(sorted).toEqual(expectedSorted)
  })

  it("assigns heavier files to balance group weights", () => {
    const testFiles = [
      "/project/spec/frontend-models/heavy.browser-spec.js",
      "/project/spec/utils/light-a-spec.js",
      "/project/spec/utils/light-b-spec.js",
      "/project/spec/utils/light-c-spec.js"
    ]

    const splitter1 = new TestSuiteSplitter({
      groups: 2,
      groupNumber: 1,
      testFiles,
      baseDirectory: "/project"
    })

    const splitter2 = new TestSuiteSplitter({
      groups: 2,
      groupNumber: 2,
      testFiles,
      baseDirectory: "/project"
    })

    const group1 = splitter1.getGroupFiles()
    const group2 = splitter2.getGroupFiles()

    // The browser-spec file (weight 20) should be alone or with fewer files
    // The light files (weight 1 each) should be grouped together
    expect(group1.length + group2.length).toBe(4)

    // No duplicates
    const allFiles = [...group1, ...group2]
    const uniqueFiles = new Set(allFiles)

    expect(uniqueFiles.size).toBe(4)
  })

  it("is deterministic across multiple runs", () => {
    const testFiles = [
      "/project/spec/database/a-spec.js",
      "/project/spec/database/b-spec.js",
      "/project/spec/controller/c-spec.js",
      "/project/spec/utils/d-spec.js",
      "/project/spec/frontend-models/e-spec.js"
    ]

    const results = []

    for (let run = 0; run < 3; run++) {
      const splitter = new TestSuiteSplitter({
        groups: 2,
        groupNumber: 1,
        testFiles,
        baseDirectory: "/project"
      })

      results.push(splitter.getGroupFiles())
    }

    expect(results[0]).toEqual(results[1])
    expect(results[1]).toEqual(results[2])
  })

  it("returns empty array when no files match this group", () => {
    const testFiles = ["/project/spec/utils/only-spec.js"]

    const splitter = new TestSuiteSplitter({
      groups: 3,
      groupNumber: 3,
      testFiles,
      baseDirectory: "/project"
    })

    // With 1 file and 3 groups, only group 1 gets the file
    const group3 = splitter.getGroupFiles()

    // Group 3 should be empty since there's only 1 file
    expect(group3).toEqual([])
  })

  it("throws when groups is less than 1", () => {
    expect(() => {
      new TestSuiteSplitter({groups: 0, groupNumber: 1, testFiles: []})
    }).toThrow(/--groups must be a positive integer/)
  })

  it("throws when groupNumber is out of range", () => {
    expect(() => {
      new TestSuiteSplitter({groups: 3, groupNumber: 4, testFiles: []})
    }).toThrow(/--group-number must be between 1 and 3/)
  })

  it("throws when groupNumber is less than 1", () => {
    expect(() => {
      new TestSuiteSplitter({groups: 3, groupNumber: 0, testFiles: []})
    }).toThrow(/--group-number must be between 1 and 3/)
  })

  it("applies higher weight to browser spec files", () => {
    const splitter = new TestSuiteSplitter({
      groups: 1,
      groupNumber: 1,
      testFiles: [
        "/project/spec/frontend-models/query.browser-spec.js",
        "/project/spec/utils/helper-spec.js"
      ],
      baseDirectory: "/project"
    })

    // browser-spec under frontend-models: 10 * 2 = 20
    // regular spec under utils: 1
    const weighted = splitter.computeWeightedFiles()

    const browserEntry = weighted.find((entry) => entry.filePath.includes("browser-spec"))
    const regularEntry = weighted.find((entry) => entry.filePath.includes("helper-spec"))

    expect(browserEntry.weight).toBe(20)
    expect(regularEntry.weight).toBe(1)
  })

  it("applies directory-based weight for controller specs", () => {
    const splitter = new TestSuiteSplitter({
      groups: 1,
      groupNumber: 1,
      testFiles: ["/project/spec/controller/routes-spec.js"],
      baseDirectory: "/project"
    })

    const weighted = splitter.computeWeightedFiles()

    expect(weighted[0].weight).toBe(3)
  })

  it("applies directory-based weight for system specs", () => {
    const splitter = new TestSuiteSplitter({
      groups: 1,
      groupNumber: 1,
      testFiles: ["/project/spec/system/login-spec.js"],
      baseDirectory: "/project"
    })

    const weighted = splitter.computeWeightedFiles()

    expect(weighted[0].weight).toBe(20)
  })
})
