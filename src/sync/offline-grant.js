// @ts-check

const OFFLINE_GRANT_SIGNATURE_ALGORITHM = "HS256"
const OFFLINE_GRANT_SIGNATURE_PREFIX = "hmac-sha256-"

/**
 * Signed offline grant envelope.
 * @typedef {object} SignedOfflineGrant
 * @property {"HS256"} algorithm - Signature algorithm.
 * @property {OfflineGrant} grant - Signed grant payload.
 * @property {string} keyId - Signing key id.
 * @property {string} signature - Hex HMAC signature with a hmac-sha256 prefix.
 */

/**
 * Backend-issued offline grant payload.
 * @typedef {object} OfflineGrant
 * @property {string} deviceId - Device id allowed to use the grant.
 * @property {string} expiresAt - ISO timestamp after which replay must reject the grant.
 * @property {string} grantId - Stable grant id.
 * @property {string} issuedAt - ISO timestamp when the backend issued the grant.
 * @property {Record<string, import("../configuration-types.js").FrontendModelSyncJsonValue>} resources - Sync manifest/materialized resource metadata.
 * @property {Record<string, import("../configuration-types.js").FrontendModelSyncJsonValue>} scopes - Materialized grant scopes.
 * @property {string} userId - Actor user id allowed to use the grant.
 */

/**
 * Offline grant signing key.
 * @typedef {object} OfflineGrantSigningKey
 * @property {boolean} [current] - Whether this is the active key for new grants.
 * @property {string} id - Public key id included in signed grant envelopes.
 * @property {string} secret - Private HMAC secret. Never expose this to clients.
 */

/**
 * Creates a signed offline grant envelope.
 * @param {object} args - Arguments.
 * @param {OfflineGrant} args.grant - Grant payload.
 * @param {OfflineGrantSigningKey} args.signingKey - Current signing key.
 * @returns {Promise<SignedOfflineGrant>} - Signed grant envelope.
 */
export async function createOfflineGrant({grant, signingKey}) {
  const normalizedGrant = normalizeOfflineGrant(grant)
  const normalizedSigningKey = normalizeOfflineGrantSigningKey(signingKey)
  const signatureInput = offlineGrantSignatureInput({
    algorithm: OFFLINE_GRANT_SIGNATURE_ALGORITHM,
    grant: normalizedGrant,
    keyId: normalizedSigningKey.id
  })

  return {
    algorithm: OFFLINE_GRANT_SIGNATURE_ALGORITHM,
    grant: normalizedGrant,
    keyId: normalizedSigningKey.id,
    signature: await hmacSha256Hex({message: signatureInput, secret: normalizedSigningKey.secret})
  }
}

/**
 * Verifies a signed offline grant and returns the trusted grant payload.
 * @param {object} args - Arguments.
 * @param {Date} [args.now] - Verification time. Defaults to current time.
 * @param {SignedOfflineGrant} args.signedGrant - Signed grant envelope.
 * @param {OfflineGrantSigningKey[]} args.signingKeys - Candidate verification keys.
 * @returns {Promise<OfflineGrant>} - Verified grant payload.
 */
export async function verifyOfflineGrant({now = new Date(), signedGrant, signingKeys}) {
  const normalizedSignedGrant = normalizeSignedOfflineGrant(signedGrant)

  if (normalizedSignedGrant.algorithm !== OFFLINE_GRANT_SIGNATURE_ALGORITHM) {
    throw new Error(`Unsupported offline grant signature algorithm '${normalizedSignedGrant.algorithm}'`)
  }

  const signingKey = signingKeys
    .map((key) => normalizeOfflineGrantSigningKey(key))
    .find((key) => key.id === normalizedSignedGrant.keyId)

  if (!signingKey) throw new Error(`No offline grant signing key for key id '${normalizedSignedGrant.keyId}'`)

  const expectedSignature = await hmacSha256Hex({
    message: offlineGrantSignatureInput(normalizedSignedGrant),
    secret: signingKey.secret
  })

  if (expectedSignature !== normalizedSignedGrant.signature) {
    throw new Error("Offline grant signature did not match")
  }

  if (Number.isNaN(now.getTime())) throw new Error("Invalid offline grant verification time")
  if (new Date(normalizedSignedGrant.grant.expiresAt).getTime() <= now.getTime()) throw new Error("Offline grant expired")

  return normalizedSignedGrant.grant
}

/**
 * Builds a signed grant from bootstrap request inputs.
 * @param {object} args - Arguments.
 * @param {string} args.deviceId - Device id.
 * @param {string | undefined} [args.grantId] - Optional deterministic grant id for tests/custom callers.
 * @param {number | undefined} [args.grantTtlMs] - Grant TTL in milliseconds.
 * @param {Date} args.now - Issue time.
 * @param {Record<string, import("../configuration-types.js").FrontendModelSyncJsonValue>} args.resources - Resource sync manifest.
 * @param {Record<string, import("../configuration-types.js").FrontendModelSyncJsonValue>} args.scopes - Grant scopes.
 * @param {OfflineGrantSigningKey} args.signingKey - Current signing key.
 * @param {string} args.userId - Actor user id.
 * @returns {Promise<SignedOfflineGrant>} - Signed grant.
 */
export async function createOfflineGrantFromBootstrap({deviceId, grantId, grantTtlMs, now, resources, scopes, signingKey, userId}) {
  const issuedAt = isoDateString(now, "issuedAt")
  const ttlMs = grantTtlMs === undefined ? 24 * 60 * 60 * 1000 : grantTtlMs

  if (!Number.isInteger(ttlMs) || ttlMs <= 0) throw new Error("Offline grant TTL must be a positive integer number of milliseconds")

  return await createOfflineGrant({
    grant: {
      deviceId,
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
      grantId: grantId || randomGrantId(),
      issuedAt,
      resources,
      scopes,
      userId
    },
    signingKey
  })
}

/**
 * Normalizes signed grant signature input.
 * @param {{algorithm: "HS256", grant: OfflineGrant, keyId: string}} signedGrant - Grant signature fields.
 * @returns {string} - Stable signature input.
 */
function offlineGrantSignatureInput(signedGrant) {
  return stableJsonStringify({
    algorithm: signedGrant.algorithm,
    grant: signedGrant.grant,
    keyId: signedGrant.keyId
  })
}

/**
 * Normalizes a signed offline grant envelope.
 * @param {SignedOfflineGrant} signedGrant - Signed grant.
 * @returns {SignedOfflineGrant} - Normalized signed grant.
 */
function normalizeSignedOfflineGrant(signedGrant) {
  if (!signedGrant || typeof signedGrant !== "object" || Array.isArray(signedGrant)) throw new Error("Expected signed offline grant object")
  if (signedGrant.algorithm !== OFFLINE_GRANT_SIGNATURE_ALGORITHM) throw new Error(`Unsupported offline grant signature algorithm '${String(signedGrant.algorithm)}'`)
  if (typeof signedGrant.keyId !== "string" || signedGrant.keyId.length < 1) throw new Error("Expected offline grant key id")
  if (typeof signedGrant.signature !== "string" || !signedGrant.signature.match(/^hmac-sha256-[a-f0-9]{64}$/)) throw new Error("Expected offline grant signature")

  return {
    algorithm: signedGrant.algorithm,
    grant: normalizeOfflineGrant(signedGrant.grant),
    keyId: signedGrant.keyId,
    signature: signedGrant.signature
  }
}

/**
 * Normalizes an offline grant payload.
 * @param {OfflineGrant} grant - Grant payload.
 * @returns {OfflineGrant} - Normalized grant payload.
 */
function normalizeOfflineGrant(grant) {
  if (!grant || typeof grant !== "object" || Array.isArray(grant)) throw new Error("Expected offline grant object")

  return {
    deviceId: requiredString(grant.deviceId, "deviceId"),
    expiresAt: isoDateString(new Date(requiredString(grant.expiresAt, "expiresAt")), "expiresAt"),
    grantId: requiredString(grant.grantId, "grantId"),
    issuedAt: isoDateString(new Date(requiredString(grant.issuedAt, "issuedAt")), "issuedAt"),
    resources: deterministicJsonObject({label: "resources", value: grant.resources}),
    scopes: deterministicJsonObject({label: "scopes", value: grant.scopes}),
    userId: requiredString(grant.userId, "userId")
  }
}

/**
 * Normalizes an offline grant signing key.
 * @param {OfflineGrantSigningKey} signingKey - Signing key.
 * @returns {OfflineGrantSigningKey} - Normalized signing key.
 */
export function normalizeOfflineGrantSigningKey(signingKey) {
  if (!signingKey || typeof signingKey !== "object" || Array.isArray(signingKey)) throw new Error("Expected offline grant signing key object")

  return {
    current: signingKey.current === true,
    id: requiredString(signingKey.id, "signingKey.id"),
    secret: requiredString(signingKey.secret, "signingKey.secret")
  }
}

/**
 * Returns the current key used to sign new grants.
 * @param {OfflineGrantSigningKey[]} signingKeys - Configured signing keys.
 * @returns {OfflineGrantSigningKey} - Current signing key.
 */
export function currentOfflineGrantSigningKey(signingKeys) {
  const normalizedKeys = signingKeys.map((key) => normalizeOfflineGrantSigningKey(key))
  const currentKeys = normalizedKeys.filter((key) => key.current === true)

  if (normalizedKeys.length < 1) throw new Error("At least one offline grant signing key is required")
  if (currentKeys.length > 1) throw new Error("Only one offline grant signing key can be current")

  return currentKeys[0] || normalizedKeys[0]
}

/**
 * Signs a message using HMAC-SHA256 and returns a prefixed hex signature.
 * @param {object} args - Arguments.
 * @param {string} args.message - Message to sign.
 * @param {string} args.secret - HMAC secret.
 * @returns {Promise<string>} - Prefixed hex signature.
 */
async function hmacSha256Hex({message, secret}) {
  const cryptoProvider = globalThis.crypto

  if (!cryptoProvider?.subtle) throw new Error("WebCrypto subtle API is required for offline grant signing")

  const key = await cryptoProvider.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    {hash: "SHA-256", name: "HMAC"},
    false,
    ["sign"]
  )
  const signature = await cryptoProvider.subtle.sign("HMAC", key, new TextEncoder().encode(message))

  return `${OFFLINE_GRANT_SIGNATURE_PREFIX}${hex(new Uint8Array(signature))}`
}

/**
 * Converts bytes to lower-case hex.
 * @param {Uint8Array} bytes - Bytes.
 * @returns {string} - Hex string.
 */
function hex(bytes) {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

/**
 * Requires a non-empty string field.
 * @param {unknown} value - Value.
 * @param {string} name - Field name.
 * @returns {string} - String value.
 */
function requiredString(value, name) {
  if (typeof value !== "string" || value.length < 1) throw new Error(`Expected offline grant ${name}`)

  return value
}

/**
 * Normalizes a Date to an ISO timestamp.
 * @param {Date} date - Date value.
 * @param {string} label - Field label.
 * @returns {string} - ISO timestamp.
 */
function isoDateString(date, label) {
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid offline grant ${label}`)

  return date.toISOString()
}

/**
 * Generates a fallback random grant id.
 * @returns {string} - Grant id.
 */
function randomGrantId() {
  return globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `grant-${Date.now()}-${Math.random().toString(16).slice(2)}`
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

  if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) throw new Error(`Expected offline grant ${label} object`)

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

  if (Array.isArray(value)) {
    return value.map((entry, index) => deterministicJson({label: `${label}/${index}`, value: entry}))
  }

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

  throw new Error(`Offline grant ${label} must be deterministic JSON`)
}
