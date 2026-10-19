// REGRESSION TEST (written BEFORE the fix).
//
// Two+ independent processes bootstrap attachment schema against one fresh database at the
// same instant — the CI topology that crashes with MSSQL 1913 ("an index or statistics with
// name 'index_on_record_type' already exists on table 'velocious_attachments'").
//
// Why this exercises the real defect:
//   - real child PROCESSES, so the in-process `_readyPromise` guard cannot serialise them
//   - a shared wall-clock barrier, so they collide instead of drifting apart
//   - the parent drops the table, THEN releases the barrier, so every worker races to create
//
// A green result only counts if the workers actually overlapped; the spec asserts that too,
// so it cannot pass vacuously.
import {spawn} from "node:child_process"
import {fileURLToPath} from "node:url"
import path from "node:path"
import fs from "node:fs"
import os from "node:os"

const WORKER_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "attachments-concurrent-ready-worker.js")
const DROP_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "drop-attachments.js")
const CONCURRENCY = 4
const START_DELAY_MS = 2500

describe("Record - attachments concurrent schema bootstrap", {tags: ["dummy"]}, () => {
  it("bootstraps the attachments schema when several processes race to create it", async () => {
    const runDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "attachments-race-"))
    const traceFile = path.join(runDirectory, "trace.log")
    const startAt = Date.now() + START_DELAY_MS

    fs.writeFileSync(traceFile, "")

    // Drop in a separate process BEFORE the barrier, so every worker truly races to CREATE.
    const dropped = await runChild([DROP_PATH], {index: -1})

    if (dropped.code !== 0) {
      throw new Error(`failed to reset attachments table: ${dropped.stderr.slice(-1200)}`)
    }

    const results = await Promise.all(
      Array.from({length: CONCURRENCY}, (_, index) => runWorker({index, startAt, traceFile}))
    )

    const trace = fs.readFileSync(traceFile, "utf8")
    const failures = results.filter((result) => result.code !== 0)

    if (failures.length > 0) {
      const details = failures
        .map((failure) => `--- worker ${failure.index} exit ${failure.code} ---\n${failure.stderr.slice(-1500)}`)
        .join("\n")

      throw new Error(
        `${failures.length}/${CONCURRENCY} workers failed concurrent attachment schema bootstrap.\n\n` +
        `TRACE:\n${trace}\n\n${details}`
      )
    }

    // Guard against a vacuous green: prove the workers really raced.
    const creations = trace.split("\n").filter((line) => line.includes("create start")).length

    if (creations < CONCURRENCY) {
      throw new Error(
        `Expected all ${CONCURRENCY} workers to reach schema creation, saw ${creations}. ` +
        `The race was not exercised, so a pass means nothing.\n\nTRACE:\n${trace}`
      )
    }

    expect(failures.length).toEqual(0)
  })
})

/**
 * Spawns one worker that waits for the shared barrier before bootstrapping the schema.
 * @param {{index: number, startAt: number, traceFile: string}} args - Worker options.
 * @returns {Promise<{index: number, code: number, stdout: string, stderr: string}>} - Result.
 */
function runWorker({index, startAt, traceFile}) {
  return runChild([WORKER_PATH, String(index), String(startAt), traceFile], {index})
}

/**
 * Runs a child node process and collects its output.
 * @param {string[]} args - Script path followed by arguments.
 * @param {{index: number}} options - Worker identity for error reporting.
 * @returns {Promise<{index: number, code: number, stdout: string, stderr: string}>} - Result.
 */
function runChild(args, {index}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      // Child processes do not inherit the runner's resolved environment, and the dummy app
      // declares only a `test` database.
      env: {...process.env, VELOCIOUS_ENV: "test", NODE_ENV: "test"},
      stdio: ["ignore", "pipe", "pipe"]
    })

    let stdout = ""
    let stderr = ""

    child.stdout.on("data", (chunk) => { stdout += chunk.toString() })
    child.stderr.on("data", (chunk) => { stderr += chunk.toString() })
    child.on("close", (code) => resolve({index, code: code ?? 1, stdout, stderr}))
  })
}