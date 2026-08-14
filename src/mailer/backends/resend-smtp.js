// @ts-check

import SmtpMailerBackend from "./smtp.js"
import VelociousError from "../../velocious-error.js"
import {deliveryOperationFromPayload} from "../delivery-operation.js"

const PROVIDER_KIND = "resend-smtp"
const RETENTION_MS = 24 * 60 * 60 * 1000
const IDEMPOTENCY_HEADER = "Resend-Idempotency-Key"

/**
 * Keeps the provider-owned operation header out of caller payloads.
 * @param {import("../index.js").MailerDeliveryPayload} payload - Mail payload.
 * @returns {void}
 */
function rejectReservedHeaderOverride(payload) {
  if (Object.keys(payload.headers || {}).some((name) => name.toLowerCase() === IDEMPOTENCY_HEADER.toLowerCase())) {
    throw VelociousError.safe(`Reserved mail header ${IDEMPOTENCY_HEADER} is owned by ResendSmtpMailerBackend required delivery operations.`, {
      code: "mail-delivery-idempotency-header-reserved"
    })
  }
}

/**
 * Resend SMTP transport with Resend's documented 24-hour idempotency header.
 */
export default class ResendSmtpMailerBackend extends SmtpMailerBackend {
  /**
   * Resolves the SMTP sender before it becomes part of the immutable digest.
   * @param {object} args - Preparation input.
   * @param {import("../index.js").MailerDeliveryPayload} args.payload - Rendered payload.
   * @returns {import("../index.js").MailerDeliveryPayload} - Provider-ready payload.
   */
  prepareDeliveryOperationPayload({payload}) {
    const from = payload.from || this.defaultFrom

    if (!from) {
      throw VelociousError.safe("Required Resend mail delivery needs a from address.", {
        code: "mail-delivery-from-missing"
      })
    }

    return {...payload, from}
  }

  /**
   * Advertises the provider-specific guarantee used by required operations.
   * @returns {import("../index.js").MailerDeliveryIdempotencyCapability} - Capability.
   */
  deliveryIdempotencyCapability() {
    return {providerKind: PROVIDER_KIND, retentionMs: RETENTION_MS}
  }

  /**
   * Validates Resend's documented 1-256 character operation key contract.
   * @param {object} args - Validation input.
   * @param {import("../index.js").MailerDeliveryOperationRequest | import("../index.js").MailerDeliveryOperation} args.deliveryOperation - Operation.
   * @param {import("../index.js").MailerDeliveryPayload} args.payload - Rendered or persisted mail payload.
   * @returns {void}
   */
  validateDeliveryOperation({deliveryOperation, payload}) {
    if (typeof deliveryOperation.id !== "string" || deliveryOperation.id.length < 1 || deliveryOperation.id.length > 256) {
      throw VelociousError.safe("Resend idempotency keys must contain between 1 and 256 characters.", {
        code: "mail-delivery-idempotency-key-invalid"
      })
    }

    rejectReservedHeaderOverride(payload)
  }

  /**
   * Injects the framework-owned Resend operation header before generic SMTP serialization.
   * @param {object} args - Delivery args.
   * @param {import("../index.js").MailerDeliveryPayload} args.payload - Mail payload.
   * @param {import("../../configuration.js").default} [args.configuration] - Active configuration.
   * @returns {Promise<void>} - Resolves when accepted and shut down.
   */
  async deliver({payload, configuration}) {
    const headers = payload.headers || {}

    if (payload.deliveryOperation) {
      this.validateDeliveryOperation({deliveryOperation: payload.deliveryOperation, payload})
    } else {
      rejectReservedHeaderOverride(payload)
    }
    const operation = deliveryOperationFromPayload(payload)

    if (!operation) {
      await super.deliver({payload, configuration})
      return
    }

    await super.deliver({
      configuration,
      payload: {
        ...payload,
        headers: {...headers, [IDEMPOTENCY_HEADER]: operation.id}
      }
    })
  }
}
