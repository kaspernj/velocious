// @ts-check

import process from "node:process"
import BackgroundJobsStore from "../../src/background-jobs/store.js"
import Configuration from "../../src/configuration.js"
import AsyncTrackedMultiConnectionPool from "../../src/database/pool/async-tracked-multi-connection.js"
import SqliteDriver from "../../src/database/drivers/sqlite/index.js"
import NodeEnvironmentHandler from "../../src/environment-handlers/node.js"

const directory = process.env.VELOCIOUS_IDEMPOTENT_ENQUEUE_SQLITE_DIRECTORY

if (!directory) throw new Error("Missing SQLite race fixture directory")
if (!process.send) throw new Error("SQLite race fixture requires an IPC channel")

const send = process.send.bind(process)
/** @type {Set<string>} */
const pendingCommands = new Set()
/** @type {Map<string, () => void>} */
const commandResolvers = new Map()

process.on("message", (message) => {
  if (!message || typeof message !== "object" || !("type" in message) || typeof message.type !== "string") return
  const resolve = commandResolvers.get(message.type)

  if (resolve) {
    commandResolvers.delete(message.type)
    resolve()
  } else {
    pendingCommands.add(message.type)
  }
})

/**
 * Waits for one parent command.
 * @param {string} type - Expected command type.
 * @returns {Promise<void>} - Resolves when received.
 */
async function waitForParent(type) {
  if (pendingCommands.delete(type)) return

  await new Promise((resolve) => commandResolvers.set(type, () => resolve(undefined)))
}

class CoordinatedBackgroundJobsStore extends BackgroundJobsStore {
  _raceFixtureReady = false

  /**
   * Avoids a second schema-readiness write before the coordinated ownership race.
   * @returns {Promise<void>} - Resolves when ready.
   */
  async ensureReady() {
    if (this._raceFixtureReady) return
    await super.ensureReady()
    this._raceFixtureReady = true
  }

  /**
   * Pauses after the owning transaction's initial missing-owner read.
   * @param {import("../../src/database/drivers/base.js").default} db - Transaction connection.
   * @param {Record<string, ReturnType<typeof JSON.parse>>} ownership - Ownership row.
   * @returns {Promise<{created: boolean, row: Record<string, ReturnType<typeof JSON.parse>>}>} - Claim result.
   */
  async _claimIdempotencyOwnership(db, ownership) {
    send({type: "ready-to-claim"})
    await waitForParent("claim")

    return await super._claimIdempotencyOwnership(db, ownership)
  }
}

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
const store = new CoordinatedBackgroundJobsStore({configuration})
const request = {
  args: [{projectId: 42, taskId: 7}],
  jobName: "CrossProcessIdempotentJob",
  options: {executionMode: "inline", idempotencyKey: "cross-process:42:7", maxRetries: 3}
}

try {
  configuration.setCurrent()
  await store.ensureReady()
  send({type: "initialized"})
  await waitForParent("enqueue")

  try {
    const jobId = await store.enqueue(request)

    send({jobId, type: "outcome"})
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] : String(error)

    send({error: message, type: "outcome"})
  }

  await waitForParent("close")
} finally {
  await configuration.closeDatabaseConnections()
}
