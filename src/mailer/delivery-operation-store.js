// @ts-check

import BackgroundJobsStore from "../background-jobs/store.js"
import VelociousError from "../velocious-error.js"
import {
  MAIL_DELIVERY_OPERATIONS_TABLE,
  mailDeliveryOperationKey,
  validateAttemptPayload
} from "./delivery-operation.js"

/**
 * Durable first-attempt and retention guard for required mail operations.
 */
export default class MailerDeliveryOperationStore {
  /**
   * Creates a durable mail-operation state guard.
   * @param {object} args - Store input.
   * @param {import("../configuration.js").default} args.configuration - Active configuration.
   * @param {() => number} [args.clock] - Explicit clock dependency.
   */
  constructor({configuration, clock = () => Date.now()}) {
    this.backgroundJobsStore = new BackgroundJobsStore({configuration})
    this.clock = clock
  }

  /**
   * Atomically starts the provider retention clock once and rejects expired attempts.
   * @param {object} args - Attempt input.
   * @param {import("./index.js").MailerDeliveryIdempotencyCapability} args.capability - Current backend capability.
   * @param {import("./index.js").MailerDeliveryPayload} args.payload - Persisted payload.
   * @returns {Promise<{expiresAtMs: number, firstAttemptStartedAtMs: number}>} - Attempt window.
   */
  async beginAttempt({capability, payload}) {
    const operation = validateAttemptPayload({capability, payload})
    const nowMs = this.clock()

    if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new Error("Mailer delivery operation clock must return a non-negative safe integer")

    await this.backgroundJobsStore.ensureReady()

    return await this.backgroundJobsStore._withDb(async (db) => {
      return await db.transaction(async () => {
        const operationKey = mailDeliveryOperationKey(operation.id)

        // A value-preserving structured update obtains the row's write lock on
        // every driver before we inspect or initialize the one-shot timestamp.
        await db.update({
          tableName: MAIL_DELIVERY_OPERATIONS_TABLE,
          data: {operation_key: operationKey},
          conditions: {operation_key: operationKey}
        })
        let row = await this._operationRow(db, operation.id)

        if (!row) throw new Error("Required mail delivery operation is not durably registered")
        this._validateRow({operation, row})

        let firstAttemptStartedAtMs = numberOrNull(row.first_attempt_started_at_ms)

        if (firstAttemptStartedAtMs === null) {
          await db.update({
            tableName: MAIL_DELIVERY_OPERATIONS_TABLE,
            data: {first_attempt_started_at_ms: nowMs},
            conditions: {operation_key: operationKey}
          })
          row = await this._operationRow(db, operation.id)
          firstAttemptStartedAtMs = row ? numberOrNull(row.first_attempt_started_at_ms) : null

          if (firstAttemptStartedAtMs === null) throw new Error("Failed to durably start mail delivery provider retention")
        }

        const expiresAtMs = firstAttemptStartedAtMs + operation.providerRetentionMs

        if (nowMs >= expiresAtMs) {
          throw VelociousError.safe("The required mail delivery idempotency window expired before another attempt.", {
            code: "mail-delivery-idempotency-expired",
            details: {
              expiresAtMs,
              firstAttemptStartedAtMs,
              operationId: operation.id,
              providerKind: operation.providerKind
            }
          })
        }

        return {expiresAtMs, firstAttemptStartedAtMs}
      })
    })
  }

  /**
   * Loads one operation by its fixed-size digest key.
   * @param {import("../database/drivers/base.js").default} db - Database connection.
   * @param {string} operationId - Operation id.
   * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>> | null>} - Row or null.
   */
  async _operationRow(db, operationId) {
    const rows = await db
      .newQuery()
      .from(MAIL_DELIVERY_OPERATIONS_TABLE)
      .where({operation_key: mailDeliveryOperationKey(operationId)})
      .limit(1)
      .results()

    return rows[0] ? /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (rows[0]) : null
  }

  /**
   * Validates immutable durable fields without including mail content in failures.
   * @param {object} args - Validation input.
   * @param {import("./index.js").MailerDeliveryOperation} args.operation - Persisted payload operation.
   * @param {Record<string, ReturnType<typeof JSON.parse>>} args.row - Durable operation row.
   * @returns {void}
   */
  _validateRow({operation, row}) {
    const matches = String(row.operation_id) === operation.id
      && String(row.payload_digest) === operation.payloadDigest
      && String(row.provider_kind) === operation.providerKind
      && numberOrNull(row.provider_retention_ms) === operation.providerRetentionMs

    if (!matches) {
      throw VelociousError.safe("The durable mail delivery operation does not match the persisted payload or provider.", {
        code: "mail-delivery-idempotency-conflict"
      })
    }
  }
}

/**
 * Normalizes a database integer.
 * @param {ReturnType<typeof JSON.parse>} value - Database value.
 * @returns {number | null} - Number or null.
 */
function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null
  const number = Number(value)

  return Number.isNaN(number) ? null : number
}
