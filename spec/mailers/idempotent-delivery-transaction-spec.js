// @ts-check

import fs from "fs/promises"
import os from "os"
import path from "path"
import BackgroundJobsStore from "../../src/background-jobs/store.js"
import Configuration from "../../src/configuration.js"
import AsyncTrackedMultiConnectionPool from "../../src/database/pool/async-tracked-multi-connection.js"
import SqliteDriver from "../../src/database/drivers/sqlite/index.js"
import NodeEnvironmentHandler from "../../src/environment-handlers/node.js"
import ResendSmtpMailerBackend from "../../src/mailer/backends/resend-smtp.js"
import {mailDeliveryOperationKey, prepareRequiredDeliveryPayload} from "../../src/mailer/delivery-operation.js"
import {deliverPayload} from "../../src/mailer.js"
import {startFakeSmtpServer} from "../helpers/fake-smtp-server.js"

/** @returns {import("../../src/mailer.js").MailerDeliveryPayload} - Stable payload. */
function payload() {
  return {
    action: "notice",
    from: "sender@example.com",
    headers: {"X-Trace": "transactional"},
    html: "<p>Transactional delivery</p>",
    mailer: "TransactionalDeliveryMailer",
    replyTo: "reply@example.com",
    subject: "Transactional delivery",
    to: "recipient@example.com"
  }
}

describe("Mailers - required delivery in a caller transaction", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("fails closed before provider I/O when its durable marker would belong to an outer transaction", async () => {
    const previousConfiguration = Configuration.current()
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-mail-transaction-"))
    const fakeServer = await startFakeSmtpServer({requireAuth: false})
    const backend = new ResendSmtpMailerBackend({
      connectionOptions: {host: "127.0.0.1", ignoreTLS: true, port: fakeServer.port, secure: false}
    })
    const configuration = new Configuration({
      database: {
        development: {
          default: {
            driver: SqliteDriver,
            migrations: false,
            name: "mail-transaction",
            poolType: AsyncTrackedMultiConnectionPool,
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
      mailerBackend: backend
    })
    const store = new BackgroundJobsStore({configuration})
    const capability = backend.deliveryIdempotencyCapability()
    const persistedPayload = prepareRequiredDeliveryPayload({
      capability,
      deliveryOperation: {id: "caller-transaction:1", idempotency: "required"},
      payload: payload()
    })
    const rollback = new Error("Expected outer rollback")
    /** @type {import("../../src/velocious-error.js").default | null} */
    let deliveryError = null

    try {
      configuration.setCurrent()
      await store.clearAll()
      await store.enqueue({
        args: [persistedPayload],
        jobName: "MailDeliveryJob",
        options: {idempotencyKey: "caller-transaction:1"}
      })

      await configuration.withConnections({databaseIdentifiers: ["default"], name: "Transactional mail delivery spec"}, async (dbs) => {
        try {
          await dbs.default.transaction(async () => {
            try {
              await deliverPayload(persistedPayload)
            } catch (error) {
              deliveryError = /** @type {import("../../src/velocious-error.js").default} */ (error)
            }

            throw rollback
          })
        } catch (error) {
          expect(error).toEqual(rollback)
        }
      })

      const rows = await store._withDb(async (db) => await db
        .newQuery()
        .from("mailer_delivery_operations")
        .where({operation_key: mailDeliveryOperationKey("caller-transaction:1")})
        .results())

      expect({
        errorCode: deliveryError?.code,
        marker: rows[0]?.first_attempt_started_at_ms,
        providerCommandCount: fakeServer.commands.length,
        providerMessageCount: fakeServer.messages.length,
        safeToExpose: deliveryError?.safeToExpose
      }).toEqual({
        errorCode: "mail-delivery-idempotency-transaction-active",
        marker: null,
        providerCommandCount: 0,
        providerMessageCount: 0,
        safeToExpose: true
      })
    } finally {
      await configuration.closeDatabaseConnections()
      previousConfiguration.setCurrent()
      await fakeServer.close()
      await fs.rm(directory, {force: true, recursive: true})
    }
  })
})
