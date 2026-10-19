// Worker for the concurrent attachment-schema-bootstrap regression spec.
//
// All workers wait on a shared wall-clock barrier, then bootstrap the schema at the same
// instant. Each is a SEPARATE process, so the in-process `_readyPromise` guard cannot
// serialise them — which is exactly the cross-process race under test.
//
// Progress is appended to a shared trace file because the framework's test runner captures
// only stdout from children.
import configuration from "../../dummy/src/config/configuration.js"
import RecordAttachmentsStore from "../../../src/database/record/attachments/store.js"
import fs from "node:fs"

const index = process.argv[2] || "0"
const startAt = Number(process.argv[3] || "0")
const traceFile = process.argv[4]

/** Appends a line to the shared trace file. */
function trace(message) {
  fs.appendFileSync(traceFile, `${Date.now()} [w${index}] ${message}\n`)
}

/** Sleeps until a wall-clock instant. */
async function waitUntil(targetMs) {
  for (;;) {
    const remaining = targetMs - Date.now()

    if (remaining <= 0) return
    await new Promise((resolve) => setTimeout(resolve, Math.min(remaining, 25)))
  }
}

try {
  await configuration.initializeDatabasePool()

  // Everyone waits for the same instant so the create attempts genuinely overlap.
  await waitUntil(startAt)
  trace("create start")

  const store = new RecordAttachmentsStore({configuration, databaseIdentifier: "default"})

  await store.ensureReady()

  trace("create done")
  await configuration.closeDatabaseConnections()
  process.exit(0)
} catch (error) {
  trace(`FAILED: ${error instanceof Error ? error.message : error}`)
  console.error(`[worker ${index}] FAILED: ${error instanceof Error ? error.stack : error}`)
  try {
    await configuration.closeDatabaseConnections()
  } catch (closeError) {
    trace(`close failed: ${closeError instanceof Error ? closeError.message : closeError}`)
  }
  process.exit(1)
}