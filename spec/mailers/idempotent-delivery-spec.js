// @ts-check

import fs from "fs/promises"
import os from "os"
import path from "path"
import BackgroundJobsMain from "../../src/background-jobs/main.js"
import BackgroundJobsStore from "../../src/background-jobs/store.js"
import Configuration from "../../src/configuration.js"
import SingleMultiUsePool from "../../src/database/pool/single-multi-use.js"
import SqliteDriver from "../../src/database/drivers/sqlite/index.js"
import NodeEnvironmentHandler from "../../src/environment-handlers/node.js"
import VelociousMailer, {deliverPayload} from "../../src/mailer.js"
import ResendSmtpMailerBackend from "../../src/mailer/backends/resend-smtp.js"

class OperationMailer extends VelociousMailer {
  /**
   * @param {object} args - Mail values.
   * @param {string} [args.body] - Rendered body.
   * @param {string} [args.from] - Sender.
   * @param {Record<string, string>} [args.headers] - Custom headers.
   * @param {string} [args.replyTo] - Reply-to.
   * @param {string} [args.subject] - Subject.
   * @param {string} [args.to] - Recipient.
   * @returns {import("../../src/mailer/delivery.js").default} - Delivery.
   */
  notice({body = "Original body", from = "sender@example.com", headers = {"X-Trace": "original"}, replyTo = "reply@example.com", subject = "Original subject", to = "recipient@example.com"} = {}) {
    this.assignView({body})
    return this.mail({actionName: "notice", from, headers, replyTo, subject, to})
  }
}

/** @returns {import("../../src/configuration-types.js").MailerBackend} - Capable no-network backend. */
function capableBackend() {
  return {
    deliver: async () => null,
    deliveryIdempotencyCapability: () => ({providerKind: "test-provider", retentionMs: 60_000})
  }
}

describe("Mailers - idempotent delivery", {databaseCleaning: {transaction: true}}, () => {
  /** @type {Configuration | null} */
  let configuration = null
  /** @type {string | null} */
  let directory = null
  /** @type {BackgroundJobsMain | null} */
  let main = null
  /** @type {Configuration | null} */
  let previousConfiguration = null
  /** @type {BackgroundJobsStore | null} */
  let store = null

  beforeEach(async () => {
    previousConfiguration = Configuration.current()
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-idempotent-mail-"))
    const viewDirectory = path.join(directory, "src", "mailers", "operation")

    await fs.mkdir(viewDirectory, {recursive: true})
    await fs.mkdir(path.join(directory, "db"), {recursive: true})
    await fs.writeFile(path.join(viewDirectory, "notice.ejs"), "<p><%= body %></p>")

    configuration = new Configuration({
      database: {
        development: {
          default: {
            driver: SqliteDriver,
            migrations: false,
            name: "idempotent-mail-spec",
            poolType: SingleMultiUsePool,
            type: "sqlite"
          }
        }
      },
      directory,
      environment: "development",
      environmentHandler: new NodeEnvironmentHandler(),
      initializeModels: async () => {},
      locale: () => "en",
      localeFallbacks: {},
      locales: ["en"],
      mailerBackend: capableBackend()
    })
    configuration.setCurrent()
    main = new BackgroundJobsMain({closeDatabaseConnectionsOnStop: false, configuration, host: "127.0.0.1", port: 0})
    await main.start()
    configuration.setBackgroundJobsConfig({host: "127.0.0.1", port: main.getPort()})
    store = new BackgroundJobsStore({configuration})
    await store.clearAll()
  })

  afterEach(async () => {
    await main?.stop()
    await configuration?.closeDatabaseConnections()
    previousConfiguration?.setCurrent()
    if (directory) await fs.rm(directory, {force: true, recursive: true})
  })

  it("persists one immutable mail operation and replays to the original native job", async () => {
    if (!configuration || !store) throw new Error("Expected mail test setup")
    const deliveryOperation = {id: "project-command:123", idempotency: "required"}
    const firstJobId = await new OperationMailer({configuration}).notice().deliverLater({deliveryOperation})
    const replayJobId = await new OperationMailer({configuration}).notice().deliverLater({deliveryOperation})

    expect(replayJobId).toEqual(firstJobId)
    expect(typeof firstJobId).toEqual("string")

    const job = await store.getJob(/** @type {string} */ (firstJobId))

    if (!job) throw new Error("Expected persisted mail delivery job")
    const payload = /** @type {import("../../src/mailer.js").MailerDeliveryPayload} */ (job.args[0])
    const rows = await store._withDb(async (db) => await db.newQuery().from("mailer_delivery_operations").results())

    expect(payload.deliveryOperation).toMatchObject({
      id: "project-command:123",
      idempotency: "required",
      providerKind: "test-provider",
      providerRetentionMs: 60_000
    })
    expect(payload.deliveryOperation?.payloadDigest).toMatch(/^sha256:v1:[a-f0-9]{64}$/)
    expect(rows).toMatchObject([{
      background_job_id: firstJobId,
      first_attempt_started_at_ms: null,
      operation_id: "project-command:123",
      payload_digest: payload.deliveryOperation?.payloadDigest,
      provider_kind: "test-provider",
      provider_retention_ms: 60_000
    }])
  })

  it("rejects recipient-visible payload changes under one operation id", async () => {
    if (!configuration) throw new Error("Expected mail test setup")
    const deliveryOperation = {id: "project-command:changed", idempotency: "required"}

    await new OperationMailer({configuration}).notice().deliverLater({deliveryOperation})

    const changedDeliveries = [
      new OperationMailer({configuration}).notice({to: "changed-recipient@example.com"}),
      new OperationMailer({configuration}).notice({from: "changed-sender@example.com"}),
      new OperationMailer({configuration}).notice({subject: "Changed subject"}),
      new OperationMailer({configuration}).notice({body: "Changed body"}),
      new OperationMailer({configuration}).notice({replyTo: "changed-reply@example.com"}),
      new OperationMailer({configuration}).notice({headers: {"X-Trace": "changed"}})
    ]

    for (const delivery of changedDeliveries) {
      await expect(async () => await delivery.deliverLater({deliveryOperation})).toThrow(/operation.*different|idempotency key.*different/i)
    }
  })

  it("freezes backend sender defaults into the immutable payload", async () => {
    if (!configuration || !store) throw new Error("Expected mail test setup")
    let defaultFrom = "first-default@example.com"

    configuration.setMailerBackend({
      deliver: async () => null,
      deliveryIdempotencyCapability: () => ({providerKind: "test-provider", retentionMs: 60_000}),
      prepareDeliveryOperationPayload: ({payload}) => ({...payload, from: payload.from || defaultFrom})
    })
    const deliveryOperation = {id: "default-from:1", idempotency: "required"}
    const jobId = await new OperationMailer({configuration}).notice({from: ""}).deliverLater({deliveryOperation})
    const job = await store.getJob(/** @type {string} */ (jobId))

    if (!job) throw new Error("Expected persisted mail delivery job")
    expect(/** @type {import("../../src/mailer.js").MailerDeliveryPayload} */ (job.args[0]).from).toEqual("first-default@example.com")

    defaultFrom = "changed-default@example.com"
    await expect(async () => await new OperationMailer({configuration}).notice({from: ""}).deliverLater({deliveryOperation}))
      .toThrow(/operation.*different|idempotency key.*different/i)
  })

  it("fails unsupported required delivery before durable enqueue or backend I/O", async () => {
    if (!configuration || !store) throw new Error("Expected mail test setup")
    let networkAttempts = 0

    configuration.setMailerBackend({deliver: async () => { networkAttempts += 1 }})

    await expect(async () => await new OperationMailer({configuration}).notice().deliverLater({
      deliveryOperation: {id: "unsupported:1", idempotency: "required"}
    })).toThrow(/does not support|required.*idempotency/i)

    expect(networkAttempts).toEqual(0)
    expect(await store.countJobs({jobName: "MailDeliveryJob"})).toEqual(0)
  })

  it("rejects an unsafe provider operation id before durable enqueue", async () => {
    if (!configuration || !store) throw new Error("Expected mail test setup")

    configuration.setMailerBackend(new ResendSmtpMailerBackend({
      connectionOptions: {host: "127.0.0.1", port: 1, secure: false}
    }))

    await expect(async () => await new OperationMailer({configuration}).notice().deliverLater({
      deliveryOperation: {id: "project-command:unsafe\r\nInjected: true", idempotency: "required"}
    })).toThrow(/control characters/i)

    expect(await store.countJobs({jobName: "MailDeliveryJob"})).toEqual(0)
  })

  it("revalidates provider compatibility before every attempt", async () => {
    if (!configuration || !store) throw new Error("Expected mail test setup")
    const jobId = await new OperationMailer({configuration}).notice().deliverLater({
      deliveryOperation: {id: "backend-change:1", idempotency: "required"}
    })
    const job = await store.getJob(/** @type {string} */ (jobId))
    const payload = /** @type {import("../../src/mailer.js").MailerDeliveryPayload} */ (job?.args[0])
    let networkAttempts = 0

    configuration.setMailerBackend({deliver: async () => { networkAttempts += 1 }})

    await expect(async () => await deliverPayload(payload)).toThrow(/does not support|required.*idempotency/i)
    expect(networkAttempts).toEqual(0)

    configuration.setMailerBackend(undefined)
    await expect(async () => await deliverPayload(payload)).toThrow(/does not support|required.*idempotency/i)
    expect(networkAttempts).toEqual(0)
  })

  it("preserves legacy at-least-once enqueue behavior", async () => {
    if (!configuration || !store) throw new Error("Expected mail test setup")
    const firstJobId = await new OperationMailer({configuration}).notice().deliverLater()
    const secondJobId = await new OperationMailer({configuration}).notice().deliverLater()

    expect(secondJobId).not.toEqual(firstJobId)
    expect(await store.countJobs({jobName: "MailDeliveryJob"})).toEqual(2)
    expect((await store.getJob(/** @type {string} */ (firstJobId)))?.maxRetries).toEqual(10)
  })
})
