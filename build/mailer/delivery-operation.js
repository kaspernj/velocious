// @ts-check

import {createHash} from "crypto"
import VelociousError from "../velocious-error.js"
import stableJsonStringify from "../utils/stable-json.js"

export const MAIL_DELIVERY_JOB_NAME = "MailDeliveryJob"
export const MAIL_DELIVERY_OPERATIONS_TABLE = "mailer_delivery_operations"
const PAYLOAD_DIGEST_FORMAT = "velocious-mail-delivery-payload-v1"

/**
 * Reads and validates a backend's provider idempotency capability.
 * @param {object} args - Capability input.
 * @param {import("../configuration-types.js").MailerBackend | undefined} args.backend - Configured backend.
 * @param {import("./index.js").MailerDeliveryOperationRequest | import("./index.js").MailerDeliveryOperation} args.deliveryOperation - Required operation.
 * @param {import("./index.js").MailerDeliveryPayload} args.payload - Rendered or persisted payload.
 * @returns {import("./index.js").MailerDeliveryIdempotencyCapability} - Capability.
 */
export function requireDeliveryIdempotencyCapability({backend, deliveryOperation, payload}) {
  if (!backend || typeof backend.deliveryIdempotencyCapability !== "function") {
    throw VelociousError.safe("The configured mailer backend does not support required provider idempotency.", {
      code: "mail-delivery-idempotency-unsupported"
    })
  }

  const capability = backend.deliveryIdempotencyCapability()

  if (!capability || typeof capability.providerKind !== "string" || capability.providerKind.length === 0) {
    throw new Error("Mailer backend delivery idempotency capability requires a non-empty providerKind")
  }
  if (!Number.isSafeInteger(capability.retentionMs) || capability.retentionMs <= 0) {
    throw new Error("Mailer backend delivery idempotency capability requires a positive safe-integer retentionMs")
  }

  if (typeof backend.validateDeliveryOperation === "function") {
    backend.validateDeliveryOperation({deliveryOperation, payload})
  }

  return capability
}

/**
 * Normalizes one public required operation into immutable payload metadata.
 * @param {object} args - Preparation input.
 * @param {import("./index.js").MailerDeliveryIdempotencyCapability} args.capability - Backend capability.
 * @param {import("./index.js").MailerDeliveryOperationRequest} args.deliveryOperation - Public operation request.
 * @param {import("./index.js").MailerDeliveryPayload} args.payload - Rendered payload.
 * @returns {import("./index.js").MailerDeliveryPayload} - Payload with immutable operation metadata.
 */
export function prepareRequiredDeliveryPayload({capability, deliveryOperation, payload}) {
  validateDeliveryOperationRequest(deliveryOperation)
  const payloadDigest = mailDeliveryPayloadDigest({operationId: deliveryOperation.id, payload})

  return {
    ...payload,
    deliveryOperation: {
      id: deliveryOperation.id,
      idempotency: "required",
      payloadDigest,
      providerKind: capability.providerKind,
      providerRetentionMs: capability.retentionMs
    }
  }
}

/**
 * Builds the versioned digest for every recipient-visible/provider-relevant payload field.
 * @param {object} args - Digest input.
 * @param {string} args.operationId - Stable operation id.
 * @param {import("./index.js").MailerDeliveryPayload} args.payload - Rendered payload.
 * @returns {string} - Versioned SHA-256 digest.
 */
export function mailDeliveryPayloadDigest({operationId, payload}) {
  const canonicalPayload = {
    action: payload.action,
    bcc: payload.bcc ?? null,
    cc: payload.cc ?? null,
    format: PAYLOAD_DIGEST_FORMAT,
    from: payload.from ?? null,
    headers: canonicalHeaders(payload.headers),
    html: payload.html,
    mailer: payload.mailer,
    operationId,
    replyTo: payload.replyTo ?? null,
    subject: payload.subject,
    to: payload.to
  }
  const digest = createHash("sha256").update(stableJsonStringify(canonicalPayload)).digest("hex")

  return `sha256:v1:${digest}`
}

/**
 * Extracts validated persisted operation metadata from a payload.
 * @param {import("./index.js").MailerDeliveryPayload} payload - Mail payload.
 * @returns {import("./index.js").MailerDeliveryOperation | null} - Operation or null.
 */
export function deliveryOperationFromPayload(payload) {
  const operation = payload.deliveryOperation

  if (!operation) return null
  if (operation.idempotency !== "required") throw new Error("Persisted mail delivery operation idempotency must be required")
  if (typeof operation.id !== "string" || operation.id.length === 0) throw new Error("Persisted mail delivery operation requires an id")
  if (typeof operation.payloadDigest !== "string" || !operation.payloadDigest.startsWith("sha256:v1:")) throw new Error("Persisted mail delivery operation requires a versioned payload digest")
  if (typeof operation.providerKind !== "string" || operation.providerKind.length === 0) throw new Error("Persisted mail delivery operation requires a provider kind")
  if (!Number.isSafeInteger(operation.providerRetentionMs) || operation.providerRetentionMs <= 0) throw new Error("Persisted mail delivery operation requires a positive retention")

  return operation
}

/**
 * Extracts a built-in mail operation from generic job arguments.
 * @param {string} jobName - Job class name.
 * @param {Array<ReturnType<typeof JSON.parse>>} args - Job arguments.
 * @returns {{operation: import("./index.js").MailerDeliveryOperation, payload: import("./index.js").MailerDeliveryPayload} | null} - Mail operation input.
 */
export function mailDeliveryOperationForJob(jobName, args) {
  if (jobName !== MAIL_DELIVERY_JOB_NAME || !args[0] || typeof args[0] !== "object" || Array.isArray(args[0])) return null

  const payload = /** @type {import("./index.js").MailerDeliveryPayload} */ (args[0])
  const operation = deliveryOperationFromPayload(payload)

  return operation ? {operation, payload} : null
}

/**
 * Fixed-size primary key for a potentially long operation id.
 * @param {string} operationId - Operation id.
 * @returns {string} - SHA-256 operation key.
 */
export function mailDeliveryOperationKey(operationId) {
  return createHash("sha256").update(`velocious-mail-delivery-operation:${operationId}`).digest("hex")
}

/**
 * Validates provider compatibility and payload integrity before an attempt.
 * @param {object} args - Validation input.
 * @param {import("./index.js").MailerDeliveryIdempotencyCapability} args.capability - Current backend capability.
 * @param {import("./index.js").MailerDeliveryPayload} args.payload - Persisted payload.
 * @returns {import("./index.js").MailerDeliveryOperation} - Persisted operation.
 */
export function validateAttemptPayload({capability, payload}) {
  const operation = deliveryOperationFromPayload(payload)

  if (!operation) throw new Error("Expected a persisted mail delivery operation")
  if (operation.providerKind !== capability.providerKind || operation.providerRetentionMs !== capability.retentionMs) {
    throw VelociousError.safe("The configured mailer backend no longer matches the required delivery operation provider.", {
      code: "mail-delivery-idempotency-provider-mismatch"
    })
  }

  const currentDigest = mailDeliveryPayloadDigest({operationId: operation.id, payload})

  if (currentDigest !== operation.payloadDigest) {
    throw VelociousError.safe("The persisted mail delivery payload digest does not match its required operation.", {
      code: "mail-delivery-idempotency-payload-mismatch"
    })
  }

  return operation
}

/**
 * Validates the public operation shape without accepting future semantics silently.
 * @param {import("./index.js").MailerDeliveryOperationRequest} deliveryOperation - Public operation.
 * @returns {void}
 */
function validateDeliveryOperationRequest(deliveryOperation) {
  if (!deliveryOperation || typeof deliveryOperation !== "object" || Array.isArray(deliveryOperation)) {
    throw VelociousError.safe("deliveryOperation must be an object.", {code: "mail-delivery-operation-invalid"})
  }
  if (typeof deliveryOperation.id !== "string" || deliveryOperation.id.length === 0) {
    throw VelociousError.safe("deliveryOperation.id must be a non-empty string.", {code: "mail-delivery-operation-invalid"})
  }
  if (deliveryOperation.idempotency !== "required") {
    throw VelociousError.safe('deliveryOperation.idempotency must be "required".', {code: "mail-delivery-operation-invalid"})
  }

  const keys = Object.keys(deliveryOperation)

  if (keys.some((key) => key !== "id" && key !== "idempotency")) {
    throw VelociousError.safe("deliveryOperation contains unsupported fields.", {code: "mail-delivery-operation-invalid"})
  }
}

/**
 * Canonicalizes case-insensitive custom headers without exposing values.
 * @param {Record<string, string> | undefined} headers - Custom headers.
 * @returns {Array<[string, string]>} - Sorted header pairs.
 */
function canonicalHeaders(headers) {
  if (!headers) return []

  const pairs = Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value])
  const names = new Set()

  for (const [name] of pairs) {
    if (names.has(name)) {
      throw VelociousError.safe("Mail headers contain duplicate case-insensitive names.", {code: "mail-delivery-headers-invalid"})
    }
    names.add(name)
  }

  return /** @type {Array<[string, string]>} */ (pairs.sort(([left], [right]) => left.localeCompare(right)))
}
