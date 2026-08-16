// @ts-check

import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import { describe, expect, it } from "../../src/testing/test.js"
import TestProfiler from "../../src/testing/test-profiler.js"
import { formatTestProfileSummary, writeTestProfileOutputs } from "../../src/testing/test-profile-output.js"
import TestSuiteSplitter from "../../src/testing/test-suite-splitter.js"

function buildProfile() {
  const configuration = new Configuration({
    database: {test: {}},
    directory: process.cwd(),
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    initializeModels: async () => {},
    locale: "en",
    localeFallbacks: {en: ["en"]},
    locales: ["en"]
  })
  const profiler = new TestProfiler({
    configuration,
    projectDirectory: process.cwd(),
    selection: {fileCount: 2, hasExampleFilters: false, includeTagCount: 0, excludeTagCount: 0, shard: {groups: 2, groupNumber: 1}}
  })

  profiler.addFileDuration("spec/z-profile-spec.js", "imports", 9.87654)
  profiler.addFileDuration("spec/a-profile-spec.js", "imports", 4.32109)

  return profiler.finish({
    counts: {discovered: 2, executed: 2, failed: 0, passed: 2},
    focused: false,
    status: "passed"
  })
}

describe("test profile output", () => {
  it("atomically writes deterministic rich JSON and a splitter-compatible sorted manifest", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-profile-output-"))
    const profileJsonPath = path.join(directory, "nested", "profile.json")
    const timingManifestOutputPath = path.join(directory, "nested", "timings.json")

    try {
      const profile = buildProfile()

      await writeTestProfileOutputs({profile, profileJsonPath, timingManifestOutputPath})

      const profileContent = await fs.readFile(profileJsonPath, "utf8")
      const manifestContent = await fs.readFile(timingManifestOutputPath, "utf8")
      const writtenProfile = JSON.parse(profileContent)
      const manifest = JSON.parse(manifestContent)

      expect(profileContent.endsWith("\n")).toBe(true)
      expect(manifestContent).toBe('{' + '\n  "spec/a-profile-spec.js": 4.321,' + '\n  "spec/z-profile-spec.js": 9.877' + '\n}\n')
      expect(writtenProfile.schema).toBe("velocious.test-profile")
      expect(writtenProfile.schemaVersion).toBe(1)
      expect(writtenProfile.selection.shard).toEqual({groups: 2, groupNumber: 1})
      expect(writtenProfile.timingManifest).toEqual(manifest)

      const splitter = new TestSuiteSplitter({
        baseDirectory: process.cwd(),
        groupNumber: 1,
        groups: 2,
        testFiles: [
          path.join(process.cwd(), "spec/z-profile-spec.js"),
          path.join(process.cwd(), "spec/a-profile-spec.js")
        ],
        timingManifest: manifest
      })

      expect(splitter.computeWeightedFiles().map((entry) => entry.weight)).toEqual([9.877, 4.321])
      expect((await fs.readdir(path.join(directory, "nested"))).sort()).toEqual(["profile.json", "timings.json"])
    } finally {
      await fs.rm(directory, {force: true, recursive: true})
    }
  })

  it("rejects forbidden sensitive fields before writing and propagates write failures", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-profile-privacy-"))
    const profileJsonPath = path.join(directory, "profile.json")
    const blockedParent = path.join(directory, "blocked")

    try {
      const unsafeProfile = {...buildProfile(), sql: "SELECT secret_value FROM credentials"}

      await expect(() => writeTestProfileOutputs({profile: unsafeProfile, profileJsonPath})).toThrow(/forbidden profile field/i)
      await expect(() => fs.access(profileJsonPath)).toThrow()
      await fs.writeFile(blockedParent, "not a directory", "utf8")
      await expect(() => writeTestProfileOutputs({
        profile: buildProfile(),
        profileJsonPath: path.join(blockedParent, "profile.json")
      })).toThrow()
    } finally {
      await fs.rm(directory, {force: true, recursive: true})
    }
  })

  it("formats a compact fixed-width phase table, pool summary, and output paths", () => {
    const profile = buildProfile()
    profile.pools = [{
      identifier: "default",
      connectionCreation: {count: 2, failedCount: 0, totalMs: 3, maxMs: 2},
      checkoutWait: {count: 1, totalMs: 4, maxMs: 4},
      checkoutTimeoutCount: 0,
      idleReap: {count: 1, failedCount: 0, totalMs: 2, maxMs: 2, disposalCount: 1},
      peakLiveConnections: 2
    }]

    const summary = formatTestProfileSummary(profile, {
      profileJsonPath: "/workspace/tmp/profile.json",
      timingManifestOutputPath: "/workspace/tmp/timings.json"
    })
    const lines = summary.split("\n")

    expect(lines[0]).toBe("Test profile")
    expect(lines[1]).toBe("Phase                          Count      Real ms       CPU ms")
    expect(lines.some((line) => line.includes("runner overhead"))).toBe(true)
    expect(lines.some((line) => line.includes("Pool default"))).toBe(true)
    expect(lines.some((line) => line.includes("Rich JSON: /workspace/tmp/profile.json"))).toBe(true)
    expect(lines.some((line) => line.includes("Timing manifest: /workspace/tmp/timings.json"))).toBe(true)
  })
})
