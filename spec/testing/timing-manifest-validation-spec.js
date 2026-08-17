// @ts-check

import { describe, expect, it } from "../../src/testing/test.js"
import {
  canonicalTimingManifestPath,
  timingManifestFileSetHash,
  validateTimingManifest
} from "../../src/testing/timing-manifest.js"

describe("timing manifest validation", () => {
  it("canonicalizes portable relative paths and preserves sorted non-negative durations", () => {
    expect(validateTimingManifest({})).toEqual({})
    expect(validateTimingManifest({
      "spec\\models\\task-spec.js": 0,
      "./spec//controllers/./tasks-spec.js": 12.345
    }, {source: "timings.json"})).toEqual({
      "spec/controllers/tasks-spec.js": 12.345,
      "spec/models/task-spec.js": 0
    })
  })

  it("rejects invalid roots paths durations and normalized collisions", async () => {
    for (const invalidRoot of [null, [], "timings"]) {
      await expect(() => validateTimingManifest(invalidRoot, {source: "timings.json"})).toThrow(/plain JSON object/)
    }

    for (const invalidPath of ["", "/spec/task-spec.js", "C:spec/task-spec.js", "C:\\spec\\task-spec.js", "../spec/task-spec.js", "spec/../../task-spec.js"]) {
      await expect(() => canonicalTimingManifestPath(invalidPath)).toThrow(/relative path/)
    }

    for (const invalidDuration of [-1, "12", null, Infinity]) {
      await expect(() => validateTimingManifest({"spec/task-spec.js": invalidDuration}, {source: "timings.json"})).toThrow(/duration/)
    }

    await expect(() => validateTimingManifest({
      "./spec/task-spec.js": 1,
      "spec\\task-spec.js": 2
    }, {source: "timings.json"})).toThrow(/collision/)
  })

  it("hashes a canonical file universe independently of input path order and spelling", () => {
    const firstHash = timingManifestFileSetHash(["spec\\b-spec.js", "./spec/a-spec.js"])
    const secondHash = timingManifestFileSetHash(["spec/a-spec.js", "spec/b-spec.js"])

    expect(firstHash).toBe(secondHash)
    expect(firstHash).toMatch(/^sha256:[a-f0-9]{64}$/)
  })
})
