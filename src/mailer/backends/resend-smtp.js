// @ts-check

import SmtpMailerBackend from "./smtp.js"
import VelociousError from "../../velocious-error.js"
import {deliveryOperationFromPayload} from "../delivery-operation.js"

const PROVIDER_KIND = "resend-smtp"
const RETENTION_MS = 24 * 60 * 60 * 1000
const IDEMPOTENCY_HEADER = "Resend-Idempotency-Key"

/**
 * Checks whether a value contains an SMTP header control character.
 * @param {string} value - Header value.
 * @returns {boolean} - Whether a control character is present.
 */
function containsHeaderValueControlCharacter(value) {
  for (const character of value) {
    const codePoint = character.charCodeAt(0)

    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) return true
  }

  return false
}

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
   * Validates Resend's documented length and SMTP header-value safety contract.
   * @param {object} args - Validation input.
   * @param {import("../index.js").MailerDeliveryOperationRequest | import("../index.js").MailerDeliveryOperation} args.deliveryOperation - Operation.
   * @param {import("../index.js").MailerDeliveryPayload} args.payload - Rendered or persisted mail payload.
   * @returns {void}
   */
  validateDeliveryOperation({deliveryOperation, payload}) {
    if (
      typeof deliveryOperation.id !== "string" ||
      deliveryOperation.id.length < 1 ||
      deliveryOperation.id.length > 256 ||
      containsHeaderValueControlCharacter(deliveryOperation.id)
    ) {
      throw VelociousError.safe("Resend idempotency keys must contain between 1 and 256 characters without control characters.", {
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
