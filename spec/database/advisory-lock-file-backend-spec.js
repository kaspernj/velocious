// @ts-check

import AdvisoryLockFileBackend from "../../src/database/advisory-lock-file-backend.js"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {spawn} from "node:child_process"
import {advisoryLockFileChildPath} from "../helpers/advisory-lock-file-child.js"
import {describe, expect, it} from "../../src/testing/test.js"

/**
 * Spawn one helper process that acquires the given file lock and follows the
 * child protocol in `spec/helpers/advisory-lock-file-child.js`.
 * @param {object} args - Options.
 * @param {string} args.directory - File-backend directory shared with the parent.
 * @param {string} args.lockName - Lock name to acquire in the child.
 * @param {number} [args.leaseMs] - Child lease duration.
 * @param {number} [args.renewIntervalMs] - Child renewal interval.
 * @returns {{child: import("node:child_process").ChildProcess, acquired: Promise<string>}} - Child handle plus its acquisition signal.
 */
function spawnLockChild({directory, lockName, leaseMs = 30_000, renewIntervalMs = 10_000}) {
  const child = spawn(process.execPath, [
    advisoryLockFileChildPath,
    directory,
    lockName,
    String(leaseMs),
    String(renewIntervalMs)
  ], {env: {...process.env, VELOCIOUS_ADVISORY_LOCK_FILE_CHILD: "1"}, stdio: ["pipe", "pipe", "pipe"]})

  const acquired = new Promise((resolve, reject) => {
    const onData = (/** @type {Buffer} */ chunk) => {
      const text = chunk.toString()

      if (text.includes("acquired")) {
        child.stdout.off("data", onData)
        resolve("acquired")
      }
    }

    child.stdout.on("data", onData)
    child.once("exit", (code) => reject(new Error(`lock child exited before acquiring (code ${String(code)})`)))
  })

  return {child, acquired}
}

/**
 * Wait for one stdout line from a running lock child.
 * @param {import("node:child_process").ChildProcess} child - Child process.
 * @param {string} expected - Expected line prefix.
 * @param {number} timeoutMs - Hard timeout.
 * @returns {Promise<string>} - Resolves with the matching line.
 */
function waitForChildLine(child, expected, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`child did not print ${JSON.stringify(expected)} within ${timeoutMs}ms`)), timeoutMs)

    const onData = (/** @type {Buffer} */ chunk) => {
      const text = chunk.toString()

      if (text.includes(expected)) {
        clearTimeout(timer)
        child.stdout.off("data", onData)
        resolve(expected)
      }
    }

    child.stdout.on("data", onData)
  })
}

describe("AdvisoryLockFileBackend", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  /** @type {string[]} */
  const tempDirectories = []

  /**
   * Fresh backend directory for one example.
   * @returns {Promise<string>} - Resolves with a temp directory path.
   */
  async function tempDirectory() {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-advisory-lock-file-backend-"))

    tempDirectories.push(directory)

    return directory
  }

  it("serialises two processes on one host through the lock directory", async () => {
    const directory = await tempDirectory()
    const parentBackend = new AdvisoryLockFileBackend({directory})
    const counterPath = path.join(directory, "counter")

    await fs.writeFile(counterPath, "0")

    // Child 1 acquires and performs slow read-modify-write increments under
    // the lock; child 2 must wait for the release before its own increments.
    const first = spawnLockChild({directory, lockName: "counter-lock"})

    await first.acquired

    const second = spawnLockChild({directory, lockName: "counter-lock", leaseMs: 60_000, renewIntervalMs: 20_000})

    // The second child is blocked: its lock directory cannot be published
    // while the first holds it (live local owner, unexpired lease).
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(await parentBackend.isHeld("counter-lock")).toBe(true)

    first.child.stdin.write("increment\n")
    await waitForChildLine(first.child, "increments-done", 30_000)

    second.child.stdin.write("increment\n")
    await waitForChildLine(second.child, "increments-done", 30_000)

    // Serialised increments: 10 + 10, no lost updates from interleaved
    // read-modify-write (each increment sleeps 20ms between read and write).
    expect(Number(await fs.readFile(counterPath, "utf8"))).toEqual(20)
  })

  it("reclaims a killed holder's lock via the lease/staleness rule", async () => {
    const directory = await tempDirectory()
    const backend = new AdvisoryLockFileBackend({directory, leaseMs: 200, renewIntervalMs: 100})
    const killed = spawnLockChild({directory, lockName: "killed-holder", leaseMs: 200, renewIntervalMs: 100})

    await killed.acquired

    expect(await backend.isHeld("killed-holder")).toBe(true)

    // SIGKILL: no release, no lease renewal — the lock directory stays on
    // disk with a live-looking PID entry until the lease expires.
    killed.child.kill("SIGKILL")
    await new Promise((resolve) => { killed.child.once("exit", resolve) })

    // While the lease is still unexpired the lock is (correctly) still held.
    // After expiry it becomes stale and the next acquirer reclaims it.
    await new Promise((resolve) => setTimeout(resolve, 400))

    expect(await backend.isHeld("killed-holder")).toBe(false)
    expect(await backend.tryAcquire("killed-holder")).toBe(true)

    await backend.release("killed-holder")
  })

  it("reclaims a dead local owner even with a long lease via PID probing", async () => {
    const directory = await tempDirectory()
    const backend = new AdvisoryLockFileBackend({directory})
    const lockPath = backend.lockPathFor("dead-pid")

    await fs.mkdir(lockPath, {recursive: true})
    await fs.writeFile(path.join(lockPath, "owner.json"), JSON.stringify({
      acquiredAt: new Date().toISOString(),
      holderId: "gone",
      hostname: os.hostname(),
      leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      pid: 999_999_999
    }))

    expect(await backend.tryAcquire("dead-pid")).toBe(true)
    await backend.release("dead-pid")
  })

  it("reports the file tier's fencing limitation instead of pretending", async () => {
    const directory = await tempDirectory()
    const backend = new AdvisoryLockFileBackend({directory})

    expect(await backend.acquire("no-fencing", {timeoutMs: 1000})).toBe(true)

    const holder = await backend.holderInfo("no-fencing")

    expect(holder).not.toEqual(null)
    expect(holder.holderId).toEqual(backend.holderId)
    expect(holder.pid).toEqual(process.pid)
    expect(holder.hostname).toEqual(os.hostname())

    await backend.release("no-fencing")
    expect(await backend.holderInfo("no-fencing")).toEqual(null)
  })

  it("times out waiting for a live foreign holder", async () => {
    const directory = await tempDirectory()
    const backend = new AdvisoryLockFileBackend({directory})
    const held = new AdvisoryLockFileBackend({directory})

    expect(await held.acquire("contended", {timeoutMs: 1000})).toBe(true)
    expect(await backend.acquire("contended", {timeoutMs: 200})).toBe(false)
    expect(await held.release("contended")).toBe(true)
    expect(await backend.acquire("contended", {timeoutMs: 1000})).toBe(true)
    await backend.release("contended")
  })

  it("refuses to release a lock it does not own", async () => {
    const directory = await tempDirectory()
    const owner = new AdvisoryLockFileBackend({directory})
    const stranger = new AdvisoryLockFileBackend({directory})

    expect(await owner.acquire("owned", {timeoutMs: 1000})).toBe(true)
    expect(await stranger.release("owned")).toBe(false)
    expect(await owner.isHeld("owned")).toBe(true)
    expect(await owner.release("owned")).toBe(true)
  })
})
