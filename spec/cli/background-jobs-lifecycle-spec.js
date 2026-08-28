// @ts-check

import { spawn } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { connectGenerationPeer, startGenerationMain } from "../helpers/background-jobs-generation-harness.js"
import releaseLifecyclePaths from "../helpers/release-lifecycle-paths.js"
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

describe("Background jobs lifecycle CLI", () => {
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
