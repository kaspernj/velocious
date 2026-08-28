// @ts-check

import { spawn } from "node:child_process"
import timeout from "awaitery/build/timeout.js"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { connectGenerationPeer, startGenerationMain } from "../helpers/background-jobs-generation-harness.js"
import releaseLifecyclePaths from "../helpers/release-lifecycle-paths.js"
import stalledSocketServer from "../helpers/stalled-socket-server.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import { describe, expect, it } from "../../src/testing/test.js"

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const cliEntryPath = path.join(repositoryRoot, "bin", "velocious.js")

/**
 * Runs one real lifecycle CLI process.
 * @param {string[]} args - Command arguments.
 * @returns {Promise<{code: number | null, stderr: string, stdout: string}>} - Process result.
 */
async function runCli(args) {
  const child = spawn(process.execPath, [cliEntryPath, ...args], {
    cwd: dummyConfiguration.getDirectory(),
    env: {...process.env, VELOCIOUS_ENV: "test"},
    stdio: ["ignore", "pipe", "pipe"]
  })
  let stdout = ""
  let stderr = ""
  child.stdout.setEncoding("utf8")
  child.stderr.setEncoding("utf8")
  child.stdout.on("data", (chunk) => { stdout += chunk })
  child.stderr.on("data", (chunk) => { stderr += chunk })

  return await new Promise((resolve, reject) => {
    child.once("error", reject)
    child.once("close", (code) => resolve({code, stderr, stdout}))
  })
}

/**
 * Starts a real main CLI, observes its listening boundary, and terminates it.
 * @param {string[]} args - Main command arguments.
 * @param {NodeJS.ProcessEnv} environment - Child environment.
 * @returns {Promise<{code: number | null, listening: boolean, stderr: string, stdout: string}>} - Main result.
 */
async function runMainCli(args, environment) {
  const child = spawn(process.execPath, [cliEntryPath, ...args], {
    cwd: dummyConfiguration.getDirectory(),
    env: environment,
    stdio: ["ignore", "pipe", "pipe"]
  })
  let stdout = ""
  let stderr = ""
  let observedListening = false
  /** @type {() => void} */
  let resolveListening = () => {}
  const listening = new Promise((resolve) => { resolveListening = resolve })
  child.stdout.setEncoding("utf8")
  child.stderr.setEncoding("utf8")
  child.stdout.on("data", (chunk) => {
    stdout += chunk
    if (stdout.includes("Background jobs main listening")) {
      observedListening = true
      resolveListening()
    }
  })
  child.stderr.on("data", (chunk) => { stderr += chunk })
  const closed = new Promise((resolve, reject) => {
    child.once("error", reject)
    child.once("close", (code) => resolve({code, outcome: "closed"}))
  })

  try {
    const outcome = await timeout({errorMessage: "Background jobs main CLI did not settle", timeout: 2000}, async () => {
      return await Promise.race([listening.then(() => ({code: null, outcome: "listening"})), closed])
    })
    if (outcome.outcome === "listening") child.kill("SIGTERM")
    const result = outcome.outcome === "closed" ? outcome : await closed

    return {code: result.code, listening: observedListening, stderr, stdout}
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM")
  }
}

describe("Background jobs lifecycle CLI", () => {
  it("exits nonzero after one bounded request to a stalled lifecycle socket", async () => {
    const paths = await releaseLifecyclePaths()
    const stalled = await stalledSocketServer({socketPath: paths.socketPath})

    try {
      const resultPromise = runCli([
        "background-jobs:retire",
        "--generation",
        "release-stalled-cli",
        "--socket",
        paths.socketPath,
        "--timeout-ms",
        "25"
      ])
      await timeout({errorMessage: "Lifecycle CLI never sent its single request", timeout: 2000}, async () => await stalled.requestReceived)
      const result = await resultPromise

      expect(result.code).toEqual(1)
      expect(result.stderr).toMatch(/retire.*release-stalled-cli.*25ms/)
      await timeout({errorMessage: "Timed-out lifecycle CLI socket stayed open", timeout: 250}, async () => await stalled.connectionClosed)
      expect(stalled.requestCount()).toEqual(1)
    } finally {
      await stalled.close()
      await fs.rm(paths.directory, {recursive: true})
    }
  })

  it("starts an explicit active recovery main over an ID-only environment", async () => {
    const environment = {
      ...process.env,
      MSSQL_SA_PASSWORD: process.env.MSSQL_SA_PASSWORD || "unused-for-sqlite-focused-tests",
      VELOCIOUS_BACKGROUND_JOBS_GENERATION_ID: "release-cli-recovery",
      VELOCIOUS_BACKGROUND_JOBS_PORT: "0",
      VELOCIOUS_DISABLE_MSSQL: "1",
      VELOCIOUS_ENV: "test"
    }
    delete environment.VELOCIOUS_BACKGROUND_JOBS_INITIAL_GENERATION_STATE
    delete environment.VELOCIOUS_BACKGROUND_JOBS_LIFECYCLE_SOCKET_PATH
    const result = await runMainCli([
      "background-jobs-main",
      "--generation",
      "release-cli-recovery",
      "--initial-generation-state",
      "active"
    ], environment)

    expect(result.listening).toEqual(true)
    expect(result.code).toEqual(0)
    expect(result.stderr).toEqual("")
  })

  it("acknowledges idempotent activation and retirement and exits with truthful status", async () => {
    const paths = await releaseLifecyclePaths()
    const {main} = await startGenerationMain({
      generationId: "release-cli",
      initialGenerationState: "candidate",
      lifecycleSocketPath: paths.socketPath
    })
    const workerPeer = await connectGenerationPeer(main.getPort())

    try {
      const activationArgs = ["background-jobs:activate", "--generation", "release-cli", "--socket", paths.socketPath]
      expect(await runCli(activationArgs)).toMatchObject({code: 0, stderr: ""})
      expect(await runCli(activationArgs)).toMatchObject({code: 0, stderr: ""})
      expect(main.getLifecycleState()).toEqual("active")

      const mismatch = await runCli(["background-jobs:retire", "--generation", "release-other", "--socket", paths.socketPath])
      expect(mismatch.code).toEqual(1)
      expect(mismatch.stderr).toMatch(/Background jobs lifecycle generation mismatch/)
      expect(mismatch.stderr).toMatch(/lifecycle-control-server/)
      expect(main.getLifecycleState()).toEqual("active")

      workerPeer.jsonSocket.send({
        type: "hello",
        role: "worker",
        generationId: "release-cli",
        workerId: "release-cli:49b70c09-7fcf-40ae-b89a-598216013fde",
        supportsHandoffIdReporting: true,
        supportsHeartbeat: true
      })
      expect(await workerPeer.nextMessage()).toMatchObject({type: "generation-accepted"})

      const retirement = await runCli(["background-jobs:retire", "--generation", "release-cli", "--socket", paths.socketPath])
      expect(retirement).toMatchObject({code: 0, stderr: ""})
      expect(await workerPeer.nextMessage()).toEqual({type: "retire", generationId: "release-cli"})
      expect(main.getLifecycleState()).toEqual("retired")
      expect(main.server?.listening).toEqual(true)
      await workerPeer.close()
      await main.waitUntilStopped()
      expect(main.getLifecycleState()).toEqual("stopped")
      await expect(async () => await fs.lstat(paths.socketPath)).toThrow(/ENOENT/)
    } finally {
      await workerPeer.close()
      await main.stop()
      await fs.rm(paths.directory, {recursive: true})
    }
  })

  it("exits nonzero for missing lifecycle identity without contacting a main", async () => {
    const missing = await runCli(["background-jobs:activate"])

    expect(missing.code).toEqual(1)
    expect(missing.stderr).toMatch(/requires generationId/)
  })
})
