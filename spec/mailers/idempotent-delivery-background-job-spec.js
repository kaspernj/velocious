// @ts-check

import fs from "fs/promises"
import os from "os"
import path from "path"
import {pathToFileURL} from "url"
import timeout from "awaitery/build/timeout.js"
import BackgroundJobsMain from "../../src/background-jobs/main.js"
import BackgroundJobsStore from "../../src/background-jobs/store.js"
import BackgroundJobsWorker from "../../src/background-jobs/worker.js"
import Configuration from "../../src/configuration.js"
import VelociousMailer from "../../src/mailer.js"
import {startFakeSmtpServer} from "../helpers/fake-smtp-server.js"

const velociousDirectory = path.resolve(import.meta.dirname, "../..")

class CrashWindowMailer extends VelociousMailer {
  /** @returns {import("../../src/mailer/delivery.js").default} - Delivery. */
  notice() {
    return this.mail({
      actionName: "notice",
      from: "sender@example.com",
      headers: {"X-Trace": "crash-window"},
      subject: "Crash window subject",
      to: "recipient@example.com"
    })
  }
}

/**
 * Waits for one persisted job state without a timing sleep.
 * @param {object} args - Wait input.
 * @param {string} args.jobId - Job id.
 * @param {(job: import("../../src/background-jobs/types.js").BackgroundJobRow) => boolean} args.predicate - Completion predicate.
 * @param {BackgroundJobsStore} args.store - Store.
 * @returns {Promise<import("../../src/background-jobs/types.js").BackgroundJobRow>} - Matching job.
 */
async function waitForJob({jobId, predicate, store}) {
  /** @type {import("../../src/background-jobs/types.js").BackgroundJobRow | null} */
  let matchingJob = null

  await timeout({timeout: 5000}, async () => {
    while (!matchingJob) {
      const job = await store.getJob(jobId)

      if (job && predicate(job)) {
        matchingJob = job
      } else {
        await new Promise((resolve) => setImmediate(resolve))
      }
    }
  })

  if (!matchingJob) throw new Error(`Expected background job state: ${jobId}`)
  return matchingJob
}

describe("Mailers - idempotent delivery background job crash window", {databaseCleaning: {transaction: true}}, () => {
  it("suppresses provider-visible duplication when a pooled runner exits after DATA acceptance", async () => {
    const fakeServer = await startFakeSmtpServer({idempotencyHeader: "Resend-Idempotency-Key", requireAuth: false})
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-mail-crash-window-"))
    const markerPath = path.join(directory, "first-provider-attempt-accepted")
    const previousConfiguration = Configuration.current()
    const previousSharedTransactionBroker = process.env.VELOCIOUS_TEST_SHARED_TRANSACTION_BROKER
    /** @type {BackgroundJobsMain | null} */
    let main = null
    /** @type {BackgroundJobsWorker | null} */
    let worker = null
    /** @type {Configuration | null} */
    let configuration = null

    try {
      delete process.env.VELOCIOUS_TEST_SHARED_TRANSACTION_BROKER
      await fs.mkdir(path.join(directory, "db"), {recursive: true})
      await fs.mkdir(path.join(directory, "src", "config"), {recursive: true})
      await fs.mkdir(path.join(directory, "src", "mailers", "crash-window"), {recursive: true})
      await fs.writeFile(path.join(directory, "src", "mailers", "crash-window", "notice.ejs"), "<p>Crash window body</p>")

      const backendPath = path.join(directory, "src", "config", "crash-once-resend-backend.js")
      const configurationPath = path.join(directory, "src", "config", "configuration.js")

      await fs.writeFile(backendPath, `
import fs from "node:fs/promises"
import {ResendSmtpMailerBackend} from ${JSON.stringify(pathToFileURL(path.join(velociousDirectory, "src", "mailer.js")).href)}

export default class CrashOnceResendBackend extends ResendSmtpMailerBackend {
  async deliver(args) {
    await super.deliver(args)

    try {
      await fs.access(${JSON.stringify(markerPath)})
    } catch (error) {
      if (error?.code !== "ENOENT") throw error
      await fs.writeFile(${JSON.stringify(markerPath)}, "accepted")
      process.exit(75)
    }
  }
}
`)
      await fs.writeFile(configurationPath, `
import Configuration from ${JSON.stringify(pathToFileURL(path.join(velociousDirectory, "src", "configuration.js")).href)}
import NodeEnvironmentHandler from ${JSON.stringify(pathToFileURL(path.join(velociousDirectory, "src", "environment-handlers", "node.js")).href)}
import SqliteDriver from ${JSON.stringify(pathToFileURL(path.join(velociousDirectory, "src", "database", "drivers", "sqlite", "index.js")).href)}
import AsyncTrackedMultiConnectionPool from ${JSON.stringify(pathToFileURL(path.join(velociousDirectory, "src", "database", "pool", "async-tracked-multi-connection.js")).href)}
import CrashOnceResendBackend from "./crash-once-resend-backend.js"

export default new Configuration({
  database: {development: {default: {
    driver: SqliteDriver,
    migrations: false,
    name: "mail-crash-window",
    pool: {checkoutTimeoutMillis: 100, max: 1},
    poolType: AsyncTrackedMultiConnectionPool,
    type: "sqlite"
  }}},
  directory: ${JSON.stringify(directory)},
  environment: "development",
  environmentHandler: new NodeEnvironmentHandler(),
  initializeModels: async () => {},
  locale: () => "en",
  localeFallbacks: {},
  locales: ["en"],
  mailerBackend: new CrashOnceResendBackend({
    connectionOptions: {host: "127.0.0.1", ignoreTLS: true, port: ${fakeServer.port}, secure: false}
  })
})
`)

      configuration = (await import(pathToFileURL(configurationPath).href)).default
      configuration.setCurrent()
      main = new BackgroundJobsMain({closeDatabaseConnectionsOnStop: false, configuration, host: "127.0.0.1", port: 0})
      await main.start()
      configuration.setBackgroundJobsConfig({host: "127.0.0.1", port: main.getPort()})
      const store = new BackgroundJobsStore({configuration})

      await store.clearAll()

      worker = new BackgroundJobsWorker({
        closeDatabaseConnectionsOnStop: false,
        configuration,
        pooledRunnerConcurrency: 1,
        pooledRunnerCount: 1
      })
      await worker.start()

      const jobId = await new CrashWindowMailer({configuration}).notice().deliverLater({
        deliveryOperation: {id: "crash-window:provider-accepted", idempotency: "required"}
      })

      if (typeof jobId !== "string") throw new Error("Expected native mail job id")

      await timeout({timeout: 2000}, async () => await fakeServer.quitReceived)
      await waitForJob({jobId, predicate: (job) => job.status === "queued" && job.attempts === 1, store})

      await store._withDb(async (db) => {
        await db.update({tableName: "background_jobs", data: {scheduled_at_ms: 0}, conditions: {id: jobId}})
      })
      await main._drain()

      const completed = await waitForJob({jobId, predicate: (job) => job.status === "completed", store})
      const operationRows = await store._withDb(async (db) => await db.newQuery().from("mailer_delivery_operations").results())

      expect(completed.attempts).toEqual(1)
      expect(fakeServer.messages.length).toEqual(2)
      expect(fakeServer.messages[1]).toEqual(fakeServer.messages[0])
      expect(fakeServer.providerVisibleMessages.length).toEqual(1)
      expect(operationRows).toMatchObject([{
        background_job_id: jobId,
        operation_id: "crash-window:provider-accepted",
        provider_kind: "resend-smtp"
      }])
      expect(Number(/** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (operationRows[0]).first_attempt_started_at_ms) > 0).toEqual(true)
    } finally {
      await worker?.stop({timeoutMs: 2000})
      await main?.stop()
      await configuration?.closeDatabaseConnections()
      if (previousSharedTransactionBroker === undefined) {
        delete process.env.VELOCIOUS_TEST_SHARED_TRANSACTION_BROKER
      } else {
        process.env.VELOCIOUS_TEST_SHARED_TRANSACTION_BROKER = previousSharedTransactionBroker
      }
      previousConfiguration.setCurrent()
      await fakeServer.close()
      await fs.rm(directory, {force: true, recursive: true})
    }
  })
})
