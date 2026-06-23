// @ts-check

const ECDSA_P256_SHA256_ALGORITHM = "ECDSA-P256-SHA256"
const ECDSA_P256_SHA256_SIGNATURE_PREFIX = "ecdsa-p256-sha256-"

/**
 * JSON Web Key used by the sync signing helpers.
 * @typedef {JsonWebKey} SyncJsonWebKey
 */

/**
 * Backend-signed device certificate payload.
 * @typedef {object} DeviceCertificatePayload
 * @property {string} actorDeviceId - Device id allowed to sign mutations.
 * @property {string} actorUserId - User id represented by the device.
 * @property {string} certificateId - Certificate id.
 * @property {SyncJsonWebKey} devicePublicKey - Device public key peers/backends use to verify mutations.
 * @property {string} expiresAt - ISO timestamp after which the certificate is invalid.
 * @property {string} issuedAt - ISO timestamp when the backend issued the certificate.
 */

/**
 * Backend-signed device certificate envelope.
 * @typedef {object} DeviceCertificate
 * @property {"ECDSA-P256-SHA256"} algorithm - Signature algorithm.
 * @property {DeviceCertificatePayload} certificate - Certificate payload.
 * @property {string} signature - Backend signature over the certificate payload.
 */

/**
 * Sync mutation payload signed by a device.
 * @typedef {object} SyncMutation
 * @property {string} actorDeviceId - Device that signed the mutation.
 * @property {string} actorUserId - User represented by the signing device.
 * @property {Record<string, import("../configuration-types.js").FrontendModelSyncJsonValue>} [attributes] - Model attributes for CRUD mutations.
 * @property {string | number | null} [baseVersion] - Base server/client version.
 * @property {string} clientMutationId - Device-local idempotency id.
 * @property {string} [command] - Domain command name for command mutations.
 * @property {string} model - Sync model/resource name.
 * @property {string} occurredAt - ISO timestamp when the mutation occurred.
 * @property {string} offlineGrantId - Offline grant id authorizing the mutation.
 * @property {string} operation - CRUD operation or command operation.
 * @property {Record<string, import("../configuration-types.js").FrontendModelSyncJsonValue>} [payload] - Domain command payload.
 * @property {string} policyHash - Sync policy hash the mutation was checked against.
 */

/**
 * Device-signed mutation envelope.
 * @typedef {object} SignedSyncMutation
 * @property {"ECDSA-P256-SHA256"} algorithm - Signature algorithm.
 * @property {DeviceCertificate} deviceCertificate - Backend-signed device certificate.
 * @property {SyncMutation} mutation - Mutation payload.
 * @property {string} signature - Device signature over the mutation envelope.
 */

/**
 * Generates an ECDSA P-256 keypair exported as JWKs.
 * @returns {Promise<{privateKey: SyncJsonWebKey, publicKey: SyncJsonWebKey}>} - Exported keypair.
 */
export async function generateSyncSigningKeyPair() {
  const keyPair = await cryptoSubtle().generateKey(
    {name: "ECDSA", namedCurve: "P-256"},
    true,
    ["sign", "verify"]
  )

  return {
    privateKey: await cryptoSubtle().exportKey("jwk", keyPair.privateKey),
    publicKey: await cryptoSubtle().exportKey("jwk", keyPair.publicKey)
  }
}

/**
 * Creates a backend-signed device certificate.
 * @param {object} args - Arguments.
 * @param {SyncJsonWebKey} args.backendPrivateKey - Backend private signing key.
 * @param {DeviceCertificatePayload} args.certificate - Certificate payload.
 * @returns {Promise<DeviceCertificate>} - Signed certificate.
 */
export async function createDeviceCertificate({backendPrivateKey, certificate}) {
  const normalizedCertificate = normalizeDeviceCertificatePayload(certificate)

  return {
    algorithm: ECDSA_P256_SHA256_ALGORITHM,
    certificate: normalizedCertificate,
    signature: await signStableJson({
      privateKey: backendPrivateKey,
      value: deviceCertificateSignatureValue(normalizedCertificate)
    })
  }
}

/**
 * Verifies a backend-signed device certificate.
 * @param {object} args - Arguments.
 * @param {SyncJsonWebKey} args.backendPublicKey - Backend public key.
 * @param {DeviceCertificate} args.certificate - Signed certificate.
 * @param {Date} [args.now] - Verification time. Defaults to current time.
 * @returns {Promise<DeviceCertificatePayload>} - Verified certificate payload.
 */
export async function verifyDeviceCertificate({backendPublicKey, certificate, now = new Date()}) {
  const normalizedCertificate = normalizeDeviceCertificate(certificate)
  const verified = await verifyStableJsonSignature({
    publicKey: backendPublicKey,
    signature: normalizedCertificate.signature,
    value: deviceCertificateSignatureValue(normalizedCertificate.certificate)
  })

  if (!verified) throw new Error("Device certificate signature did not match")
  assertNotExpired({expiresAt: normalizedCertificate.certificate.expiresAt, label: "Device certificate", now})

  return normalizedCertificate.certificate
}

/**
 * Creates a device-signed mutation envelope.
 * @param {object} args - Arguments.
 * @param {DeviceCertificate} args.deviceCertificate - Backend-signed device certificate.
 * @param {SyncJsonWebKey} args.devicePrivateKey - Device private signing key.
 * @param {SyncMutation} args.mutation - Mutation payload.
 * @returns {Promise<SignedSyncMutation>} - Signed mutation.
 */
export async function createSignedMutation({deviceCertificate, devicePrivateKey, mutation}) {
  const normalizedDeviceCertificate = normalizeDeviceCertificate(deviceCertificate)
  const normalizedMutation = normalizeSyncMutation(mutation)

  assertMutationMatchesCertificate({certificate: normalizedDeviceCertificate.certificate, mutation: normalizedMutation})

  return {
    algorithm: ECDSA_P256_SHA256_ALGORITHM,
    deviceCertificate: normalizedDeviceCertificate,
    mutation: normalizedMutation,
    signature: await signStableJson({
      privateKey: devicePrivateKey,
      value: signedMutationSignatureValue({
        deviceCertificate: normalizedDeviceCertificate,
        mutation: normalizedMutation
      })
    })
  }
}

/**
 * Verifies a signed sync mutation and its device certificate.
 * @param {object} args - Arguments.
 * @param {SyncJsonWebKey} args.backendPublicKey - Backend public key used to verify the device certificate.
 * @param {Date} [args.now] - Verification time. Defaults to current time.
 * @param {SignedSyncMutation} args.signedMutation - Signed mutation envelope.
 * @returns {Promise<SyncMutation>} - Verified mutation payload.
 */
export async function verifySignedMutation({backendPublicKey, now = new Date(), signedMutation}) {
  const normalizedSignedMutation = normalizeSignedSyncMutation(signedMutation)
  const certificatePayload = await verifyDeviceCertificate({
    backendPublicKey,
    certificate: normalizedSignedMutation.deviceCertificate,
    now
  })

  assertMutationMatchesCertificate({certificate: certificatePayload, mutation: normalizedSignedMutation.mutation})

  const verified = await verifyStableJsonSignature({
    publicKey: certificatePayload.devicePublicKey,
    signature: normalizedSignedMutation.signature,
    value: signedMutationSignatureValue({
      deviceCertificate: normalizedSignedMutation.deviceCertificate,
      mutation: normalizedSignedMutation.mutation
    })
  })

  if (!verified) throw new Error("Sync mutation signature did not match")

  return normalizedSignedMutation.mutation
}

/**
 * Returns the replay/idempotency key for a signed mutation.
 * @param {{mutation: {actorDeviceId?: unknown, actorUserId?: unknown, clientMutationId?: unknown}}} signedMutation - Signed mutation-like object.
 * @returns {string} - Idempotency key.
 */
export function mutationIdempotencyKey(signedMutation) {
  const mutation = signedMutation.mutation

  return [
    requiredString(mutation.actorUserId, "actorUserId"),
    requiredString(mutation.actorDeviceId, "actorDeviceId"),
    requiredString(mutation.clientMutationId, "clientMutationId")
  ].join(":")
}

/**
 * Builds the stable value signed by backend device certificates.
 * @param {DeviceCertificatePayload} certificate - Certificate payload.
 * @returns {Record<string, import("../configuration-types.js").FrontendModelSyncJsonValue>} - Stable signature value.
 */
function deviceCertificateSignatureValue(certificate) {
  return {
    algorithm: ECDSA_P256_SHA256_ALGORITHM,
    certificate: /** @type {Record<string, import("../configuration-types.js").FrontendModelSyncJsonValue>} */ (deterministicJsonObject({label: "certificate", value: certificate}))
  }
}

/**
 * Builds the stable value signed by sync mutations.
 * @param {object} args - Arguments.
 * @param {DeviceCertificate} args.deviceCertificate - Device certificate.
 * @param {SyncMutation} args.mutation - Mutation payload.
 * @returns {Record<string, import("../configuration-types.js").FrontendModelSyncJsonValue>} - Stable signature value.
 */
function signedMutationSignatureValue({deviceCertificate, mutation}) {
  return {
    algorithm: ECDSA_P256_SHA256_ALGORITHM,
    deviceCertificate: /** @type {Record<string, import("../configuration-types.js").FrontendModelSyncJsonValue>} */ (deterministicJsonObject({label: "deviceCertificate", value: deviceCertificate})),
    mutation: /** @type {Record<string, import("../configuration-types.js").FrontendModelSyncJsonValue>} */ (deterministicJsonObject({label: "mutation", value: mutation}))
  }
}

/**
 * Signs a deterministic JSON value with ECDSA P-256/SHA-256.
 * @param {object} args - Arguments.
 * @param {SyncJsonWebKey} args.privateKey - Private JWK.
 * @param {unknown} args.value - Value to sign.
 * @returns {Promise<string>} - Prefixed base64url signature.
 */
async function signStableJson({privateKey, value}) {
  const key = await cryptoSubtle().importKey("jwk", privateKey, {name: "ECDSA", namedCurve: "P-256"}, false, ["sign"])
  const signature = await cryptoSubtle().sign({hash: "SHA-256", name: "ECDSA"}, key, /** @type {BufferSource} */ (utf8(stableJsonStringify(value))))

  return `${ECDSA_P256_SHA256_SIGNATURE_PREFIX}${base64UrlEncode(new Uint8Array(signature))}`
}

/**
 * Verifies a deterministic JSON value with ECDSA P-256/SHA-256.
 * @param {object} args - Arguments.
 * @param {SyncJsonWebKey} args.publicKey - Public JWK.
 * @param {string} args.signature - Prefixed base64url signature.
 * @param {unknown} args.value - Value to verify.
 * @returns {Promise<boolean>} - Whether the signature matches.
 */
async function verifyStableJsonSignature({publicKey, signature, value}) {
  const key = await cryptoSubtle().importKey("jwk", publicKey, {name: "ECDSA", namedCurve: "P-256"}, false, ["verify"])
  const signatureBytes = base64UrlDecode(signatureWithoutPrefix(signature))

  return await cryptoSubtle().verify({hash: "SHA-256", name: "ECDSA"}, key, /** @type {BufferSource} */ (signatureBytes), /** @type {BufferSource} */ (utf8(stableJsonStringify(value))))
}

/**
 * Normalizes a signed device certificate envelope.
 * @param {DeviceCertificate} certificate - Signed certificate.
 * @returns {DeviceCertificate} - Normalized certificate.
 */
function normalizeDeviceCertificate(certificate) {
  if (!certificate || typeof certificate !== "object" || Array.isArray(certificate)) throw new Error("Expected device certificate object")
  if (certificate.algorithm !== ECDSA_P256_SHA256_ALGORITHM) throw new Error(`Unsupported device certificate algorithm '${String(certificate.algorithm)}'`)

  return {
    algorithm: certificate.algorithm,
    certificate: normalizeDeviceCertificatePayload(certificate.certificate),
    signature: normalizeSignature(certificate.signature, "device certificate signature")
  }
}

/**
 * Normalizes a device certificate payload.
 * @param {DeviceCertificatePayload} certificate - Certificate payload.
 * @returns {DeviceCertificatePayload} - Normalized certificate payload.
 */
function normalizeDeviceCertificatePayload(certificate) {
  if (!certificate || typeof certificate !== "object" || Array.isArray(certificate)) throw new Error("Expected device certificate payload object")

  return {
    actorDeviceId: requiredString(certificate.actorDeviceId, "actorDeviceId"),
    actorUserId: requiredString(certificate.actorUserId, "actorUserId"),
    certificateId: requiredString(certificate.certificateId, "certificateId"),
    devicePublicKey: normalizeJwk(certificate.devicePublicKey, "devicePublicKey"),
    expiresAt: isoDateString(new Date(requiredString(certificate.expiresAt, "expiresAt")), "expiresAt"),
    issuedAt: isoDateString(new Date(requiredString(certificate.issuedAt, "issuedAt")), "issuedAt")
  }
}

/**
 * Normalizes a signed sync mutation envelope.
 * @param {SignedSyncMutation} signedMutation - Signed mutation.
 * @returns {SignedSyncMutation} - Normalized signed mutation.
 */
function normalizeSignedSyncMutation(signedMutation) {
  if (!signedMutation || typeof signedMutation !== "object" || Array.isArray(signedMutation)) throw new Error("Expected signed sync mutation object")
  if (signedMutation.algorithm !== ECDSA_P256_SHA256_ALGORITHM) throw new Error(`Unsupported sync mutation algorithm '${String(signedMutation.algorithm)}'`)

  return {
    algorithm: signedMutation.algorithm,
    deviceCertificate: normalizeDeviceCertificate(signedMutation.deviceCertificate),
    mutation: normalizeSyncMutation(signedMutation.mutation),
    signature: normalizeSignature(signedMutation.signature, "sync mutation signature")
  }
}

/**
 * Normalizes a sync mutation payload.
 * @param {SyncMutation} mutation - Mutation payload.
 * @returns {SyncMutation} - Normalized mutation payload.
 */
function normalizeSyncMutation(mutation) {
  if (!mutation || typeof mutation !== "object" || Array.isArray(mutation)) throw new Error("Expected sync mutation object")

  /** @type {SyncMutation} */
  const normalized = {
    actorDeviceId: requiredString(mutation.actorDeviceId, "actorDeviceId"),
    actorUserId: requiredString(mutation.actorUserId, "actorUserId"),
    clientMutationId: requiredString(mutation.clientMutationId, "clientMutationId"),
    model: requiredString(mutation.model, "model"),
    occurredAt: isoDateString(new Date(requiredString(mutation.occurredAt, "occurredAt")), "occurredAt"),
    offlineGrantId: requiredString(mutation.offlineGrantId, "offlineGrantId"),
    operation: requiredString(mutation.operation, "operation"),
    policyHash: requiredString(mutation.policyHash, "policyHash")
  }

  if (mutation.attributes !== undefined) normalized.attributes = deterministicJsonObject({label: "attributes", value: mutation.attributes})
  if (mutation.baseVersion !== undefined) normalized.baseVersion = /** @type {string | number | null} */ (deterministicJson({label: "baseVersion", value: mutation.baseVersion}))
  if (mutation.command !== undefined) normalized.command = requiredString(mutation.command, "command")
  if (mutation.payload !== undefined) normalized.payload = deterministicJsonObject({label: "payload", value: mutation.payload})

  return normalized
}

/**
 * Asserts that mutation actor fields match the certificate actor.
 * @param {object} args - Arguments.
 * @param {DeviceCertificatePayload} args.certificate - Device certificate payload.
 * @param {SyncMutation} args.mutation - Mutation payload.
 * @returns {void} - No return value.
 */
function assertMutationMatchesCertificate({certificate, mutation}) {
  if (mutation.actorDeviceId !== certificate.actorDeviceId || mutation.actorUserId !== certificate.actorUserId) {
    throw new Error("Sync mutation actor does not match device certificate")
  }
}

/**
 * Asserts a timestamp is not expired.
 * @param {object} args - Arguments.
 * @param {string} args.expiresAt - Expiry timestamp.
 * @param {string} args.label - Error label.
 * @param {Date} args.now - Verification time.
 * @returns {void} - No return value.
 */
function assertNotExpired({expiresAt, label, now}) {
  if (Number.isNaN(now.getTime())) throw new Error("Invalid sync verification time")
  if (new Date(expiresAt).getTime() <= now.getTime()) throw new Error(`${label} expired`)
}

/**
 * Normalizes a JSON Web Key object.
 * @param {SyncJsonWebKey} key - JWK.
 * @param {string} label - Key label.
 * @returns {SyncJsonWebKey} - Normalized JWK.
 */
function normalizeJwk(key, label) {
  const normalized = deterministicJsonObject({label, value: key})

  return /** @type {SyncJsonWebKey} */ (normalized)
}

/**
 * Normalizes a prefixed signature string.
 * @param {unknown} signature - Signature value.
 * @param {string} label - Error label.
 * @returns {string} - Signature string.
 */
function normalizeSignature(signature, label) {
  if (typeof signature !== "string" || !signature.startsWith(ECDSA_P256_SHA256_SIGNATURE_PREFIX)) throw new Error(`Expected ${label}`)

  return signature
}

/**
 * Removes the signature prefix.
 * @param {string} signature - Prefixed signature.
 * @returns {string} - Base64url signature body.
 */
function signatureWithoutPrefix(signature) {
  return signature.slice(ECDSA_P256_SHA256_SIGNATURE_PREFIX.length)
}

/**
 * Requires a non-empty string field.
 * @param {unknown} value - Value.
 * @param {string} name - Field name.
 * @returns {string} - String value.
 */
function requiredString(value, name) {
  if (typeof value !== "string" || value.length < 1) throw new Error(`Expected sync ${name}`)

  return value
}

/**
 * Normalizes a Date to an ISO timestamp.
 * @param {Date} date - Date value.
 * @param {string} label - Field label.
 * @returns {string} - ISO timestamp.
 */
function isoDateString(date, label) {
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid sync ${label}`)

  return date.toISOString()
}

/**
 * Returns encoded UTF-8 bytes for a string.
 * @param {string} value - String value.
 * @returns {Uint8Array} - UTF-8 bytes.
 */
function utf8(value) {
  return new TextEncoder().encode(value)
}

/**
 * Returns WebCrypto subtle API.
 * @returns {SubtleCrypto} - SubtleCrypto implementation.
 */
function cryptoSubtle() {
  if (!globalThis.crypto?.subtle) throw new Error("WebCrypto subtle API is required for sync signing")

  return globalThis.crypto.subtle
}

/**
 * Base64url-encodes bytes.
 * @param {Uint8Array} bytes - Bytes.
 * @returns {string} - Base64url string.
 */
function base64UrlEncode(bytes) {
  let binary = ""

  for (const byte of bytes) binary += String.fromCharCode(byte)

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")
}

/**
 * Base64url-decodes bytes.
 * @param {string} value - Base64url string.
 * @returns {Uint8Array} - Bytes.
 */
function base64UrlDecode(value) {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=")
  const binary = atob(base64)

  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

/**
 * Stable JSON stringifier with sorted object keys.
 * @param {unknown} value - Value.
 * @returns {string} - JSON string.
 */
function stableJsonStringify(value) {
  return JSON.stringify(deterministicJson({label: "root", value}))
}

/**
 * Normalizes a value as a JSON object.
 * @param {object} args - Arguments.
 * @param {string} args.label - Diagnostic label.
 * @param {unknown} args.value - Value.
 * @returns {Record<string, import("../configuration-types.js").FrontendModelSyncJsonValue>} - JSON object.
 */
function deterministicJsonObject({label, value}) {
  const normalized = deterministicJson({label, value})

  if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) throw new Error(`Expected sync ${label} object`)

  return /** @type {Record<string, import("../configuration-types.js").FrontendModelSyncJsonValue>} */ (normalized)
}

/**
 * Normalizes deterministic JSON with sorted object keys.
 * @param {object} args - Arguments.
 * @param {string} args.label - Diagnostic label.
 * @param {unknown} args.value - Value.
 * @returns {import("../configuration-types.js").FrontendModelSyncJsonValue} - Normalized JSON value.
 */
function deterministicJson({label, value}) {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value

  if (Array.isArray(value)) return value.map((entry, index) => deterministicJson({label: `${label}/${index}`, value: entry}))

  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    /** @type {Record<string, import("../configuration-types.js").FrontendModelSyncJsonValue>} */
    const normalized = {}

    for (const key of Object.keys(value).sort()) {
      const childValue = /** @type {Record<string, unknown>} */ (value)[key]

      if (childValue === undefined) continue
      normalized[key] = deterministicJson({label: `${label}/${key}`, value: childValue})
    }

    return normalized
  }

  throw new Error(`Sync ${label} must be deterministic JSON`)
}
