// @ts-check

import { execFile, spawn } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "../../../src/testing/test.js"

const execFileAsync = promisify(execFile)
const repositoryDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const dummyDirectory = path.join(repositoryDirectory, "spec", "dummy")
const cliPath = path.join(repositoryDirectory, "bin", "velocious.js")

/**
 * Creates an ignored dummy-app temporary directory for CLI fixture files and outputs.
 * @param {string} prefix - Directory prefix.
 * @returns {Promise<string>} - Absolute temporary directory.
 */
async function makeTestDirectory(prefix) {
  const temporaryRoot = path.join(dummyDirectory, "tmp")

  await fs.mkdir(temporaryRoot, {recursive: true})
  return await fs.mkdtemp(path.join(temporaryRoot, prefix))
}

/**
 * Writes a temporary test entry and returns its dummy-project-relative path.
 * @param {string} directory - Temporary directory.
 * @param {string} fileName - Fixture filename.
 * @param {string} source - Fixture source.
 * @returns {Promise<string>} - Portable project-relative path.
 */
async function writeTestFixture(directory, fileName, source) {
  const filePath = path.join(directory, fileName)

  await fs.writeFile(filePath, source, "utf8")
  return path.relative(dummyDirectory, filePath).replaceAll(path.sep, "/")
}

/**
 * @param {string[]} args - Test command arguments after `test`.
 * @returns {Promise<{code: number, stderr: string, stdout: string}>} - Child result.
 */
async function runTestCommand(args) {
  const environment = {
    ...process.env,
    MSSQL_SA_PASSWORD: process.env.MSSQL_SA_PASSWORD || "test-password",
    VELOCIOUS_DISABLE_MSSQL: "1"
  }

  delete environment.VELOCIOUS_TEST_DIR

  try {
    const {stderr, stdout} = await execFileAsync(process.execPath, [cliPath, "test", ...args], {
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

/**
 * Starts a test command and interrupts it once its test body reports readiness.
 * @param {string[]} args - Test command arguments after `test`.
 * @param {string} readyOutput - Output proving the test lifecycle is active.
 * @returns {Promise<{code: number, stderr: string, stdout: string}>} - Interrupted child result.
 */
async function runInterruptedTestCommand(args, readyOutput) {
  const environment = {
    ...process.env,
    MSSQL_SA_PASSWORD: process.env.MSSQL_SA_PASSWORD || "test-password",
    VELOCIOUS_DISABLE_MSSQL: "1"
  }

  delete environment.VELOCIOUS_TEST_DIR

  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, "test", ...args], {
      cwd: dummyDirectory,
      env: environment
    })
    let signalSent = false
    let stderr = ""
    let stdout = ""

    child.stderr.on("data", (chunk) => { stderr += chunk.toString() })
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString()

      if (!signalSent && stdout.includes(readyOutput)) {
        signalSent = true
        child.kill("SIGINT")
      }
    })
    child.once("error", reject)
    child.once("close", (code) => {
      if (!signalSent) {
        reject(new Error(`Test command exited before emitting ${JSON.stringify(readyOutput)}`))
        return
      }

      resolve({code: code ?? 1, stderr, stdout})
    })
  })
}

describe("test profile CLI integration", () => {
  it("writes pass profile and manifest outputs and prints the compact summary", async () => {
    const directory = await makeTestDirectory("velocious-profile-cli-pass-")
    const profilePath = path.join(directory, "profile.json")
    const manifestPath = path.join(directory, "timings.json")

    try {
      const testPath = await writeTestFixture(directory, "pass.fixture.js", `
        import { describe, it } from "velocious/build/src/testing/test.js"
        describe("profile CLI pass fixture", () => { it("passes", async () => {}) })
      `)
      const result = await runTestCommand([
        "--profile-json",
        profilePath,
        `--timing-manifest-output=${manifestPath}`,
        testPath
      ])
      const profile = JSON.parse(await fs.readFile(profilePath, "utf8"))
      const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"))

      expect(result.code).toBe(0)
      expect(result.stdout.includes("Test profile")).toBe(true)
      expect(profile.status).toBe("passed")
      expect(profile.counts).toEqual({attempts: 1, discovered: 1, executed: 1, failed: 0, passed: 1})
      expect(profile.selection.fileCount).toBe(1)
      expect(profile.phases.discovery.count).toBe(1)
      expect(profile.phases.imports.count).toBe(1)
      expect(Object.keys(manifest)).toEqual([testPath])
      expect(profile.timingManifest).toEqual(manifest)
    } finally {
      await fs.rm(directory, {force: true, recursive: true})
    }
  })

  it("assigns imported helper declarations and inherited hook costs to the entry file", async () => {
    const directory = await makeTestDirectory("velocious-profile-cli-owner-")
    const profilePath = path.join(directory, "profile.json")
    const manifestPath = path.join(directory, "timings.json")

    try {
      await writeTestFixture(directory, "helper-definitions.js", `
        import { beforeEach, describe, it } from "velocious/build/src/testing/test.js"
        describe("profile helper-owned declarations", () => {
          beforeEach(async () => {})
          it("belongs to its importing entry file", async () => {})
        })
      `)
      const entryPath = await writeTestFixture(directory, "helper-owned.fixture.js", `
        import "./helper-definitions.js"
      `)
      const result = await runTestCommand([
        `--profile-json=${profilePath}`,
        `--timing-manifest-output=${manifestPath}`,
        entryPath
      ])
      const profile = JSON.parse(await fs.readFile(profilePath, "utf8"))
      const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"))
      const beforeEachSpan = profile.tests[0].attempts[0].spans.find((span) => span.phase === "beforeEach")

      expect(result.code).toBe(0)
      expect(Object.keys(manifest)).toEqual([entryPath])
      expect(profile.files.map((file) => file.path)).toEqual([entryPath])
      expect(profile.tests[0].attempts.length).toBe(1)
      expect(beforeEachSpan.file).toBe(entryPath)
      expect(profile.timingManifest).toEqual(manifest)
    } finally {
      await fs.rm(directory, {force: true, recursive: true})
    }
  })

  it("finalizes failure and focused profiles before their non-zero exits", async () => {
    const directory = await makeTestDirectory("velocious-profile-cli-outcomes-")

    try {
      const failurePath = path.join(directory, "failure.json")
      const focusedPath = path.join(directory, "focused.json")
      const failureTestPath = await writeTestFixture(directory, "fail.fixture.js", `
        import { describe, it } from "velocious/build/src/testing/test.js"
        describe("profile CLI failure fixture", () => {
          it("fails", async () => { throw new Error("fixture failure must not enter profile JSON") })
        })
      `)
      const focusedTestPath = await writeTestFixture(directory, "focused.fixture.js", `
        import { describe, fit } from "velocious/build/src/testing/test.js"
        describe("profile CLI focused fixture", () => { fit("is focused", async () => {}) })
      `)
      const failure = await runTestCommand([`--profile-json=${failurePath}`, failureTestPath])
      const focused = await runTestCommand([`--profile-json=${focusedPath}`, focusedTestPath])
      const failureProfile = JSON.parse(await fs.readFile(failurePath, "utf8"))
      const focusedProfile = JSON.parse(await fs.readFile(focusedPath, "utf8"))

      expect(failure.code).toBe(1)
      expect(focused.code).toBe(1)
      expect(failureProfile.status).toBe("failed")
      expect(failureProfile.counts.failed).toBe(1)
      expect(focusedProfile.status).toBe("focused")
      expect(focusedProfile.selection.focused).toBe(true)
      expect(JSON.stringify(failureProfile).includes("fixture failure")).toBe(false)
    } finally {
      await fs.rm(directory, {force: true, recursive: true})
    }
  })

  it("counts tests once when successful bodies have failing cleanup and retries", async () => {
    const directory = await makeTestDirectory("velocious-profile-cli-cleanup-counts-")
    const failureProfilePath = path.join(directory, "failure-profile.json")
    const retryProfilePath = path.join(directory, "retry-profile.json")

    try {
      const failureTestPath = await writeTestFixture(directory, "cleanup-failure.fixture.js", `
        import { afterEach, describe, it } from "velocious/build/src/testing/test.js"
        describe("profile cleanup failure", () => {
          afterEach(async () => { throw new Error("expected cleanup failure") })
          it("has a successful body", async () => {})
        })
      `)
      const retryTestPath = await writeTestFixture(directory, "cleanup-retry.fixture.js", `
        import { afterEach, describe, it } from "velocious/build/src/testing/test.js"
        describe("profile cleanup retry", () => {
          let cleanupCount = 0
          afterEach(async () => {
            cleanupCount++
            if (cleanupCount === 1) throw new Error("expected retry cleanup failure")
          })
          it("retries a successful body", {retry: 1}, async () => {})
        })
      `)
      const failureResult = await runTestCommand([`--profile-json=${failureProfilePath}`, failureTestPath])
      const retryResult = await runTestCommand([`--profile-json=${retryProfilePath}`, retryTestPath])
      const failureProfile = JSON.parse(await fs.readFile(failureProfilePath, "utf8"))
      const retryProfile = JSON.parse(await fs.readFile(retryProfilePath, "utf8"))

      expect(failureResult.code).toBe(1)
      expect(retryResult.code).toBe(0)
      expect(failureProfile.counts).toEqual({attempts: 1, discovered: 1, executed: 1, failed: 1, passed: 0})
      expect(retryProfile.counts).toEqual({attempts: 2, discovered: 1, executed: 1, failed: 0, passed: 1})
    } finally {
      await fs.rm(directory, {force: true, recursive: true})
    }
  })

  it("finalizes no-tests and import-error profiles when output remains possible", async () => {
    const directory = await makeTestDirectory("velocious-profile-cli-errors-")

    try {
      const noTestsPath = path.join(directory, "no-tests.json")
      const importErrorPath = path.join(directory, "import-error.json")
      const noTestsTestPath = await writeTestFixture(directory, "empty.fixture.js", "export {}\n")
      const importErrorTestPath = await writeTestFixture(
        directory,
        "import-error.fixture.js",
        'throw new Error("fixture import error must not enter profile JSON")\n'
      )
      const noTests = await runTestCommand([`--profile-json=${noTestsPath}`, noTestsTestPath])
      const importError = await runTestCommand([`--profile-json=${importErrorPath}`, importErrorTestPath])
      const noTestsProfile = JSON.parse(await fs.readFile(noTestsPath, "utf8"))
      const importErrorProfile = JSON.parse(await fs.readFile(importErrorPath, "utf8"))

      expect(noTests.code).toBe(1)
      expect(importError.code).toBe(1)
      expect(noTestsProfile.status).toBe("no-tests")
      expect(noTestsProfile.counts.executed).toBe(0)
      expect(importErrorProfile.status).toBe("error")
      expect(JSON.stringify(importErrorProfile).includes("fixture import error")).toBe(false)
    } finally {
      await fs.rm(directory, {force: true, recursive: true})
    }
  })

  it("closes the active attempt and spans at the signal interruption boundary", async () => {
    const directory = await makeTestDirectory("velocious-profile-cli-interrupt-")
    const profilePath = path.join(directory, "interrupted.json")
    const readyOutput = "VELOCIOUS_PROFILE_INTERRUPT_READY"

    try {
      const testPath = await writeTestFixture(directory, "interrupted.fixture.js", `
        import { configureTests, describe, it } from "velocious/build/src/testing/test.js"
        configureTests({consoleOutput: "live"})
        describe("profile CLI interruption fixture", () => {
          it("is interrupted", async () => {
            console.log("${readyOutput}")
            await new Promise(() => {})
          })
        })
      `)
      const result = await runInterruptedTestCommand([`--profile-json=${profilePath}`, testPath], readyOutput)
      const profile = JSON.parse(await fs.readFile(profilePath, "utf8"))
      const attempt = profile.tests[0].attempts[0]
      const file = profile.files.find((profileFile) => profileFile.path === testPath)

      expect(result.code).toBe(130)
      expect(profile.status).toBe("interrupted")
      expect(attempt.status).toBe("interrupted")
      expect(attempt.durationMs).toBeGreaterThan(0)
      expect(attempt.spans.every((span) => span.durationMs > 0)).toBe(true)
      expect(file.attemptsMs).toBe(attempt.durationMs)
      expect(profile.timingManifest[testPath]).toBe(file.totalMs)
    } finally {
      await fs.rm(directory, {force: true, recursive: true})
    }
  })
})
