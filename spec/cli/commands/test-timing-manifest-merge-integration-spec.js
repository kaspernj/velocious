// @ts-check

import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "../../../src/testing/test.js"
import { timingManifestFileSetHash } from "../../../src/testing/timing-manifest.js"

const execFileAsync = promisify(execFile)
const repositoryDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const dummyDirectory = path.join(repositoryDirectory, "spec", "dummy")
const cliPath = path.join(repositoryDirectory, "bin", "velocious.js")

/**
 * Runs one isolated dummy-app CLI child sequentially.
 * @param {string[]} args - Complete CLI command arguments.
 * @param {{testDirectory?: string}} [options] - Child environment options.
 * @returns {Promise<{code: number, stderr: string, stdout: string}>} - Child result.
 */
async function runCli(args, {testDirectory} = {}) {
  const environment = {...process.env, MSSQL_SA_PASSWORD: process.env.MSSQL_SA_PASSWORD || "test-password", VELOCIOUS_DISABLE_MSSQL: "1"}

  if (testDirectory) {
    environment.VELOCIOUS_TEST_DIR = testDirectory
  } else {
    delete environment.VELOCIOUS_TEST_DIR
  }

  try {
    const {stderr, stdout} = await execFileAsync(process.execPath, [cliPath, ...args], {
      cwd: dummyDirectory,
      env: environment
    })

    return {code: 0, stderr, stdout}
  } catch (error) {
    const childError = /** @type {Error & {code?: number, stderr?: string, stdout?: string}} */ (error)

    return {
      code: typeof childError.code === "number" ? childError.code : 1,
      stderr: childError.stderr || "",
      stdout: childError.stdout || ""
    }
  }
}

describe("test timing manifest merge CLI integration", () => {
  it("profiles two shards, safely merges them, and consumes the complete manifest on the next cycle", async () => {
    const temporaryRoot = path.join(dummyDirectory, "tmp")

    await fs.mkdir(temporaryRoot, {recursive: true})
    const directory = await fs.mkdtemp(path.join(temporaryRoot, "velocious-timing-cycle-"))
    const profile1Path = path.join(directory, "profile-1.json")
    const profile2Path = path.join(directory, "profile-2.json")
    const manifestPath = path.join(directory, "timings.json")

    try {
      const testPaths = []

      for (const fileName of ["a.fixture.js", "b.fixture.js"]) {
        const filePath = path.join(directory, fileName)

        await fs.writeFile(filePath, `
          import { describe, it } from "velocious/build/src/testing/test.js"
          describe("timing cycle ${fileName}", () => { it("passes", async () => {}) })
        `, "utf8")
        testPaths.push(path.relative(dummyDirectory, filePath).replaceAll(path.sep, "/"))
      }

      const firstShard = await runCli([
        "test", "--groups=2", "--group-number=1", `--profile-json=${profile1Path}`, ...testPaths
      ])
      const secondShard = await runCli([
        "test", "--groups=2", "--group-number=2", `--profile-json=${profile2Path}`, ...testPaths
      ])

      expect(firstShard.code).toBe(0)
      expect(secondShard.code).toBe(0)

      await fs.writeFile(manifestPath, "existing output\n", "utf8")
      const incompleteMerge = await runCli([
        "test:timing-manifest:merge", "--output", manifestPath, profile1Path
      ])

      expect(incompleteMerge.code).toBe(1)
      expect(incompleteMerge.stderr).toMatch(/missing shard/i)
      expect(await fs.readFile(manifestPath, "utf8")).toBe("existing output\n")

      const merge = await runCli([
        "test:timing-manifest:merge", `--output=${manifestPath}`, profile2Path, profile1Path
      ])
      const manifestContent = await fs.readFile(manifestPath, "utf8")
      const manifest = JSON.parse(manifestContent)

      expect(merge.code).toBe(0)
      expect(merge.stdout).toMatch(/Merged 2 test profile shards/)
      expect(Object.keys(manifest)).toEqual([...testPaths].sort())
      expect(manifestContent.endsWith("\n")).toBe(true)
      expect(manifestContent.startsWith("{\n  \"")).toBe(true)

      for (const groupNumber of [1, 2]) {
        const nextCycle = await runCli([
          "test",
          "--groups=2",
          `--group-number=${groupNumber}`,
          `--timing-manifest=${manifestPath}`,
          ...testPaths
        ])

        expect(nextCycle.code).toBe(0)
        expect(nextCycle.stdout).toMatch(/Timing manifest coverage: measured=2 heuristic=0 stale=0/)
      }
    } finally {
      await fs.rm(directory, {force: true, recursive: true})
    }
  })

  it("uses VELOCIOUS_TEST_DIR as the explicit profiling path base", async () => {
    const temporaryRoot = path.join(dummyDirectory, "tmp")

    await fs.mkdir(temporaryRoot, {recursive: true})
    const directory = await fs.mkdtemp(path.join(temporaryRoot, "velocious-timing-test-base-"))
    const testPath = path.join(directory, "base.fixture.js")
    const profilePath = path.join(directory, "profile.json")

    try {
      await fs.writeFile(testPath, `
        import { describe, it } from "velocious/build/src/testing/test.js"
        describe("test directory timing base", () => { it("passes", async () => {}) })
      `, "utf8")
      const result = await runCli(["test", `--profile-json=${profilePath}`, testPath], {testDirectory: directory})
      const profile = JSON.parse(await fs.readFile(profilePath, "utf8"))

      expect(result.code).toBe(0)
      expect(profile.selection.pathBase).toBe("test-directory")
      expect(profile.selection.discoveredFileCount).toBe(1)
      expect(profile.selection.fileCount).toBe(1)
      expect(profile.selection.testFileSetHash).toBe(timingManifestFileSetHash(["base.fixture.js"]))
      expect(Object.keys(profile.timingManifest)).toEqual(["base.fixture.js"])
    } finally {
      await fs.rm(directory, {force: true, recursive: true})
    }
  })

  it("records configured tag exclusions so strict aggregation rejects the filtered profile", async () => {
    const temporaryRoot = path.join(dummyDirectory, "tmp")

    await fs.mkdir(temporaryRoot, {recursive: true})
    const directory = await fs.mkdtemp(path.join(temporaryRoot, "velocious-timing-config-tags-"))
    const testPath = path.join(directory, "configured-exclusion.fixture.js")
    const profilePath = path.join(directory, "profile.json")
    const manifestPath = path.join(directory, "timings.json")

    try {
      await fs.writeFile(testPath, `
        import { configureTests, describe, it } from "velocious/build/src/testing/test.js"
        configureTests({excludeTags: ["timing-excluded"]})
        describe("configured exclusion timing profile", () => {
          it("is excluded", {tags: ["timing-excluded"]}, async () => {})
          it("still runs an unfiltered test", async () => {})
        })
      `, "utf8")
      const profileResult = await runCli([
        "test", "--groups=1", "--group-number=1", `--profile-json=${profilePath}`, testPath
      ])
      const profile = JSON.parse(await fs.readFile(profilePath, "utf8"))
      const mergeResult = await runCli([
        "test:timing-manifest:merge", `--output=${manifestPath}`, profilePath
      ])

      expect(profileResult.code).toBe(0)
      expect(profile.selection.excludeTagCount).toBe(1)
      expect(mergeResult.code).toBe(1)
      expect(mergeResult.stderr).toMatch(/filtered test profile/i)
      await expect(() => fs.access(manifestPath)).toThrow()
    } finally {
      await fs.rm(directory, {force: true, recursive: true})
    }
  })

  it("validates an explicit timing manifest even without sharding", async () => {
    const temporaryRoot = path.join(dummyDirectory, "tmp")

    await fs.mkdir(temporaryRoot, {recursive: true})
    const directory = await fs.mkdtemp(path.join(temporaryRoot, "velocious-timing-unsharded-input-"))
    const testPath = path.join(directory, "pass.fixture.js")
    const malformedPath = path.join(directory, "malformed.json")
    const missingPath = path.join(directory, "missing.json")

    try {
      await fs.writeFile(testPath, `
        import { describe, it } from "velocious/build/src/testing/test.js"
        describe("unsharded timing input", () => { it("passes", async () => {}) })
      `, "utf8")
      await fs.writeFile(malformedPath, "not json", "utf8")
      const missingResult = await runCli(["test", `--timing-manifest=${missingPath}`, testPath])
      const malformedResult = await runCli(["test", `--timing-manifest=${malformedPath}`, testPath])

      expect(missingResult.code).toBe(1)
      expect(missingResult.stderr).toMatch(/read timing manifest/i)
      expect(malformedResult.code).toBe(1)
      expect(malformedResult.stderr).toMatch(/parse timing manifest/i)
    } finally {
      await fs.rm(directory, {force: true, recursive: true})
    }
  })
})
