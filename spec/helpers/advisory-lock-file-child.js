// @ts-check

// Child-process helper for the advisory-lock file-tier specs: acquires one
// file lock via the shared backend, prints "acquired", then follows a tiny
// line protocol on stdin:
//   "increment"  → 10 slow read-modify-write increments of <directory>/counter
//                  under the lock, print "increments-done", release, exit
//   "release"    → release the lock and exit
//   "hold"       → keep holding (renewing the lease) until killed

import {fileURLToPath} from "node:url"
import AdvisoryLockFileBackend from "../../src/database/advisory-lock-file-backend.js"
import fs from "node:fs/promises"
import path from "node:path"
import readline from "node:readline"

export const advisoryLockFileChildPath = fileURLToPath(import.meta.url)

async function run() {
const [directory, lockName, leaseMsRaw, renewIntervalMsRaw] = process.argv.slice(2)

const backend = new AdvisoryLockFileBackend({
  directory,
  leaseMs: Number(leaseMsRaw),
  renewIntervalMs: Number(renewIntervalMsRaw)
})

const acquired = await backend.acquire(lockName, {timeoutMs: 15_000})

if (!acquired) {
  console.error("child: failed to acquire lock")
  process.exit(2)
}

console.log("acquired")

const lines = readline.createInterface({input: process.stdin})

for await (const line of lines) {
  if (line === "release") {
    await backend.release(lockName)
    console.log("released")
    lines.close()
    process.exit(0)
  }

  if (line === "hold") continue

  if (line === "increment") {
    const counterPath = path.join(directory, "counter")

    for (let index = 0; index < 10; index++) {
      const raw = await fs.readFile(counterPath, "utf8")
      await new Promise((resolve) => setTimeout(resolve, 20))
      await fs.writeFile(counterPath, String(Number(raw) + 1))
    }

    console.log("increments-done")
    await backend.release(lockName)
    lines.close()
    process.exit(0)
  }
}
}

if (process.env.VELOCIOUS_ADVISORY_LOCK_FILE_CHILD === "1") await run()
