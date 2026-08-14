// @ts-check

import BackgroundJobsStore from "../../src/background-jobs/store.js"
import MailerDeliveryOperationStore from "../../src/mailer/delivery-operation-store.js"
import {mailDeliveryOperationKey, prepareRequiredDeliveryPayload} from "../../src/mailer/delivery-operation.js"
import ResendSmtpMailerBackend from "../../src/mailer/backends/resend-smtp.js"
import {deliverPayload} from "../../src/mailer.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import {startFakeSmtpServer} from "../helpers/fake-smtp-server.js"

const capability = {providerKind: "test-provider", retentionMs: 60_000}

/** @returns {import("../../src/mailer.js").MailerDeliveryPayload} - Base payload. */
function payload() {
  return {
    action: "notice",
    from: "sender@example.com",
    headers: {"X-Trace": "stable"},
    html: "<p>Stable body</p>",
    mailer: "OperationStoreSpecMailer",
    replyTo: "reply@example.com",
    subject: "Stable subject",
    to: "recipient@example.com"
  }
}

describe("Mailer delivery operation store", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  /** @type {BackgroundJobsStore | null} */
  let backgroundStore = null

  beforeEach(async () => {
    dummyConfiguration.setCurrent()
    backgroundStore = new BackgroundJobsStore({configuration: dummyConfiguration})
    await backgroundStore.clearAll()
  })

  afterEach(async () => {
    await backgroundStore?.clearAll()
  })

  it("starts retention at the first provider attempt rather than enqueue time", async () => {
    if (!backgroundStore) throw new Error("Expected background store")
    const persistedPayload = prepareRequiredDeliveryPayload({
      capability,
      deliveryOperation: {id: "queue-delay:1", idempotency: "required"},
      payload: payload()
    })
    const jobId = await backgroundStore.enqueue({
      args: [persistedPayload],
      jobName: "MailDeliveryJob",
      options: {idempotencyKey: "queue-delay:1"}
    })
    let nowMs = 500_000
    const operationStore = new MailerDeliveryOperationStore({configuration: dummyConfiguration, clock: () => nowMs})

    await operationStore.beginAttempt({capability, payload: persistedPayload})

    const rows = await backgroundStore._withDb(async (db) => await db.newQuery().from("mailer_delivery_operations").results())

    expect(rows).toMatchObject([{background_job_id: jobId, first_attempt_started_at_ms: 500_000}])

    nowMs = 559_999
    await operationStore.beginAttempt({capability, payload: persistedPayload})
  })

  it("fails closed at retention expiry while preserving the original first-attempt time", async () => {
    if (!backgroundStore) throw new Error("Expected background store")
    const persistedPayload = prepareRequiredDeliveryPayload({
      capability,
      deliveryOperation: {id: "expiry:1", idempotency: "required"},
      payload: payload()
    })

    await backgroundStore.enqueue({args: [persistedPayload], jobName: "MailDeliveryJob", options: {idempotencyKey: "expiry:1"}})

    let nowMs = 10_000
    const operationStore = new MailerDeliveryOperationStore({configuration: dummyConfiguration, clock: () => nowMs})

    await operationStore.beginAttempt({capability, payload: persistedPayload})
    nowMs = 70_000

    let error = /** @type {import("../../src/velocious-error.js").default | null} */ (null)

    try {
      await operationStore.beginAttempt({capability, payload: persistedPayload})
    } catch (newError) {
      error = /** @type {import("../../src/velocious-error.js").default} */ (newError)
    }

    expect(error?.code).toEqual("mail-delivery-idempotency-expired")
    expect(error?.safeToExpose).toEqual(true)

    const rows = await backgroundStore._withDb(async (db) => await db.newQuery().from("mailer_delivery_operations").results())

    expect(rows).toMatchObject([{first_attempt_started_at_ms: 10_000}])
  })

  it("rejects changed persisted payload content before an attempt", async () => {
    if (!backgroundStore) throw new Error("Expected background store")
    const persistedPayload = prepareRequiredDeliveryPayload({
      capability,
      deliveryOperation: {id: "attempt-mismatch:1", idempotency: "required"},
      payload: payload()
    })

    await backgroundStore.enqueue({args: [persistedPayload], jobName: "MailDeliveryJob", options: {idempotencyKey: "attempt-mismatch:1"}})
    const operationStore = new MailerDeliveryOperationStore({configuration: dummyConfiguration, clock: () => 100})

    await expect(async () => await operationStore.beginAttempt({
      capability,
      payload: {...persistedPayload, subject: "Changed after enqueue"}
    })).toThrow(/payload.*different|digest.*match/i)
  })

  it("opens no TCP connection once the provider retention window is expired", async () => {
    if (!backgroundStore) throw new Error("Expected background store")
    const fakeServer = await startFakeSmtpServer({requireAuth: false})
    const previousBackend = dummyConfiguration.getMailerBackend()

    try {
      const backend = new ResendSmtpMailerBackend({
        connectionOptions: {host: "127.0.0.1", ignoreTLS: true, port: fakeServer.port, secure: false}
      })
      const resendCapability = backend.deliveryIdempotencyCapability()
      const persistedPayload = prepareRequiredDeliveryPayload({
        capability: resendCapability,
        deliveryOperation: {id: "expired-no-network:1", idempotency: "required"},
        payload: payload()
      })

      await backgroundStore.enqueue({
        args: [persistedPayload],
        jobName: "MailDeliveryJob",
        options: {idempotencyKey: "expired-no-network:1"}
      })
      await backgroundStore._withDb(async (db) => {
        await db.update({
          tableName: "mailer_delivery_operations",
          data: {first_attempt_started_at_ms: 1},
          conditions: {operation_key: mailDeliveryOperationKey("expired-no-network:1")}
        })
      })
      dummyConfiguration.setMailerBackend(backend)

      let error = /** @type {import("../../src/velocious-error.js").default | null} */ (null)

      try {
        await deliverPayload(persistedPayload)
      } catch (newError) {
        error = /** @type {import("../../src/velocious-error.js").default} */ (newError)
      }

      expect(error?.code).toEqual("mail-delivery-idempotency-expired")
      expect(fakeServer.commands).toEqual([])
      expect(fakeServer.messages).toEqual([])
    } finally {
      dummyConfiguration.setMailerBackend(previousBackend)
      await fakeServer.close()
    }
  })
})
