// @ts-check

import {fork} from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {fileURLToPath} from "node:url"
import BackgroundJobsStore from "../../src/background-jobs/store.js"
import Configuration from "../../src/configuration.js"
import AsyncTrackedMultiConnectionPool from "../../src/database/pool/async-tracked-multi-connection.js"
import SqliteDriver from "../../src/database/drivers/sqlite/index.js"
import NodeEnvironmentHandler from "../../src/environment-handlers/node.js"
import waitForEvent from "../../src/testing/wait-for-event.js"

const CHILD_PATH = fileURLToPath(new URL("../helpers/idempotent-enqueue-sqlite-child.js", import.meta.url))

/**
 * Narrows a child IPC message.
 * @param {ReturnType<typeof JSON.parse>} message - IPC value.
 * @returns {{error?: string, jobId?: string, type?: string}} - Message record.
 */
function messageRecord(message) {
  if (!message || typeof message !== "object") return {}

  return /** @type {{error?: string, jobId?: string, type?: string}} */ (message)
}

/**
 * Waits for a typed child message.
 * @param {import("node:child_process").ChildProcess} child - Child process.
 * @param {string} type - Expected message type.
 * @returns {Promise<ReturnType<typeof messageRecord>>} - Matching record.
 */
async function waitForChildMessage(child, type) {
  /** @type {ReturnType<typeof messageRecord> | undefined} */
  let matched

  try {
    await waitForEvent(child, "message", {
      filter: (message) => {
        const record = messageRecord(message)

        if (record.type !== type) return false
        matched = record
        return true
      },
      timeoutMs: 5000
    })
  } catch (error) {
    throw new Error(`Waiting for child message ${type} failed (exitCode=${child.exitCode}, signal=${child.signalCode})`, {cause: error})
  }

  if (!matched) throw new Error(`Child emitted ${type} without a record`)
  return matched
}

/**
 * Stops one retained race-fixture process without masking the test outcome.
 * @param {import("node:child_process").ChildProcess} child - Child process.
 * @returns {Promise<void>} - Resolves after exit.
 */
async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exitPromise = waitForEvent(child, "exit", {timeoutMs: 5000})

  child.kill()
  await exitPromise
}

describe("Background jobs - cross-process SQLite idempotent enqueue", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("converges two coordinated first enqueues on one durable owner", async () => {
    const previousConfiguration = Configuration.current()
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-idempotent-enqueue-process-"))
    const configuration = new Configuration({
      database: {
        test: {
          default: {
            driver: SqliteDriver,
            migrations: false,
            name: "idempotent-enqueue-process-race",
            poolType: AsyncTrackedMultiConnectionPool,
            type: "sqlite"
          }
        }
      },
      directory,
      environment: "test",
      environmentHandler: new NodeEnvironmentHandler(),
      initializeModels: async () => {},
      locale: () => "en",
      localeFallbacks: {},
      locales: ["en"]
    })
    const store = new BackgroundJobsStore({configuration})
    const children = [0, 1].map(() => fork(CHILD_PATH, [], {
      env: {VELOCIOUS_IDEMPOTENT_ENQUEUE_SQLITE_DIRECTORY: directory},
      stdio: ["ignore", "inherit", "inherit", "ipc"]
    }))

    try {
      configuration.setCurrent()
      await store.clearAll()
      await Promise.all(children.map(async (child) => await waitForChildMessage(child, "initialized")))

      const readyPromises = children.map(async (child) => await waitForChildMessage(child, "ready-to-claim"))

      for (const child of children) child.send({type: "enqueue"})
      await Promise.all(readyPromises)

      const outcomePromises = children.map(async (child) => await waitForChildMessage(child, "outcome"))

      for (const child of children) child.send({type: "claim"})
      const outcomes = await Promise.all(outcomePromises)
      const ownershipRows = await store._withDb(async (db) => await db.newQuery().from("background_job_idempotency_keys").results())
      const jobIds = outcomes.map((outcome) => outcome.jobId).filter((jobId) => jobId !== undefined)

      expect({
        errors: outcomes.map((outcome) => outcome.error).filter((error) => error !== undefined),
        jobCount: await store.countJobs({jobName: "CrossProcessIdempotentJob"}),
        jobIds: [...new Set(jobIds)],
        ownershipCount: ownershipRows.length,
        returnedJobCount: jobIds.length
      }).toEqual({
        errors: [],
        jobCount: 1,
        jobIds: [jobIds[0]],
        ownershipCount: 1,
        returnedJobCount: 2
      })
    } finally {
      await Promise.all(children.map(stopChild))
      await configuration.closeDatabaseConnections()
      previousConfiguration.setCurrent()
      await fs.rm(directory, {force: true, recursive: true})
    }
  })
})
