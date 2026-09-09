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
// @ts-check
const OFFLINE_GRANT_SIGNATURE_ALGORITHM = "HS256";
const OFFLINE_GRANT_SIGNATURE_PREFIX = "hmac-sha256-";
/**
 * Creates a signed offline grant envelope.
 * @param {object} args - Arguments.
 * @param {OfflineGrant} args.grant - Grant payload.
 * @param {OfflineGrantSigningKey} args.signingKey - Current signing key.
 * @returns {Promise<SignedOfflineGrant>} - Signed grant envelope.
 */
export async function createOfflineGrant({ grant, signingKey }) {
    const normalizedGrant = normalizeOfflineGrant(grant);
    const normalizedSigningKey = normalizeOfflineGrantSigningKey(signingKey);
    const signatureInput = offlineGrantSignatureInput({
        algorithm: OFFLINE_GRANT_SIGNATURE_ALGORITHM,
        grant: normalizedGrant,
        keyId: normalizedSigningKey.id
    });
    return {
        algorithm: OFFLINE_GRANT_SIGNATURE_ALGORITHM,
        grant: normalizedGrant,
        keyId: normalizedSigningKey.id,
        signature: await hmacSha256Hex({ message: signatureInput, secret: normalizedSigningKey.secret })
    };
}
/**
 * Verifies a signed offline grant and returns the trusted grant payload.
 * @param {object} args - Arguments.
 * @param {Date} [args.now] - Verification time. Defaults to current time.
 * @param {SignedOfflineGrant} args.signedGrant - Signed grant envelope.
 * @param {OfflineGrantSigningKey[]} args.signingKeys - Candidate verification keys.
 * @returns {Promise<OfflineGrant>} - Verified grant payload.
 */
export async function verifyOfflineGrant({ now = new Date(), signedGrant, signingKeys }) {
    const normalizedSignedGrant = normalizeSignedOfflineGrant(signedGrant);
    if (normalizedSignedGrant.algorithm !== OFFLINE_GRANT_SIGNATURE_ALGORITHM) {
        throw new Error(`Unsupported offline grant signature algorithm '${normalizedSignedGrant.algorithm}'`);
    }
    const signingKey = signingKeys
        .map((key) => normalizeOfflineGrantSigningKey(key))
        .find((key) => key.id === normalizedSignedGrant.keyId);
    if (!signingKey)
        throw new Error(`No offline grant signing key for key id '${normalizedSignedGrant.keyId}'`);
    const expectedSignature = await hmacSha256Hex({
        message: offlineGrantSignatureInput(normalizedSignedGrant),
        secret: signingKey.secret
    });
    if (expectedSignature !== normalizedSignedGrant.signature) {
        throw new Error("Offline grant signature did not match");
    }
    if (Number.isNaN(now.getTime()))
        throw new Error("Invalid offline grant verification time");
    if (new Date(normalizedSignedGrant.grant.expiresAt).getTime() <= now.getTime())
        throw new Error("Offline grant expired");
    return normalizedSignedGrant.grant;
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
export async function createOfflineGrantFromBootstrap({ deviceId, grantId, grantTtlMs, now, resources, scopes, signingKey, userId }) {
    const issuedAt = isoDateString(now, "issuedAt");
    const ttlMs = grantTtlMs === undefined ? 24 * 60 * 60 * 1000 : grantTtlMs;
    if (!Number.isInteger(ttlMs) || ttlMs <= 0)
        throw new Error("Offline grant TTL must be a positive integer number of milliseconds");
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
    });
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
    });
}
/**
 * Normalizes a signed offline grant envelope.
 * @param {SignedOfflineGrant} signedGrant - Signed grant.
 * @returns {SignedOfflineGrant} - Normalized signed grant.
 */
function normalizeSignedOfflineGrant(signedGrant) {
    if (!signedGrant || typeof signedGrant !== "object" || Array.isArray(signedGrant))
        throw new Error("Expected signed offline grant object");
    if (signedGrant.algorithm !== OFFLINE_GRANT_SIGNATURE_ALGORITHM)
        throw new Error(`Unsupported offline grant signature algorithm '${String(signedGrant.algorithm)}'`);
    if (typeof signedGrant.keyId !== "string" || signedGrant.keyId.length < 1)
        throw new Error("Expected offline grant key id");
    if (typeof signedGrant.signature !== "string" || !signedGrant.signature.match(/^hmac-sha256-[a-f0-9]{64}$/))
        throw new Error("Expected offline grant signature");
    return {
        algorithm: signedGrant.algorithm,
        grant: normalizeOfflineGrant(signedGrant.grant),
        keyId: signedGrant.keyId,
        signature: signedGrant.signature
    };
}
/**
 * Normalizes an offline grant payload.
 * @param {OfflineGrant} grant - Grant payload.
 * @returns {OfflineGrant} - Normalized grant payload.
 */
function normalizeOfflineGrant(grant) {
    if (!grant || typeof grant !== "object" || Array.isArray(grant))
        throw new Error("Expected offline grant object");
    return {
        deviceId: requiredString(grant.deviceId, "deviceId"),
        expiresAt: isoDateString(new Date(requiredString(grant.expiresAt, "expiresAt")), "expiresAt"),
        grantId: requiredString(grant.grantId, "grantId"),
        issuedAt: isoDateString(new Date(requiredString(grant.issuedAt, "issuedAt")), "issuedAt"),
        resources: deterministicJsonObject({ label: "resources", value: grant.resources }),
        scopes: deterministicJsonObject({ label: "scopes", value: grant.scopes }),
        userId: requiredString(grant.userId, "userId")
    };
}
/**
 * Normalizes an offline grant signing key.
 * @param {OfflineGrantSigningKey} signingKey - Signing key.
 * @returns {OfflineGrantSigningKey} - Normalized signing key.
 */
export function normalizeOfflineGrantSigningKey(signingKey) {
    if (!signingKey || typeof signingKey !== "object" || Array.isArray(signingKey))
        throw new Error("Expected offline grant signing key object");
    return {
        current: signingKey.current === true,
        id: requiredString(signingKey.id, "signingKey.id"),
        secret: requiredString(signingKey.secret, "signingKey.secret")
    };
}
/**
 * Returns the current key used to sign new grants.
 * @param {OfflineGrantSigningKey[]} signingKeys - Configured signing keys.
 * @returns {OfflineGrantSigningKey} - Current signing key.
 */
export function currentOfflineGrantSigningKey(signingKeys) {
    const normalizedKeys = signingKeys.map((key) => normalizeOfflineGrantSigningKey(key));
    const currentKeys = normalizedKeys.filter((key) => key.current === true);
    if (normalizedKeys.length < 1)
        throw new Error("At least one offline grant signing key is required");
    if (currentKeys.length > 1)
        throw new Error("Only one offline grant signing key can be current");
    return currentKeys[0] || normalizedKeys[0];
}
/**
 * Signs a message using HMAC-SHA256 and returns a prefixed hex signature.
 * @param {object} args - Arguments.
 * @param {string} args.message - Message to sign.
 * @param {string} args.secret - HMAC secret.
 * @returns {Promise<string>} - Prefixed hex signature.
 */
async function hmacSha256Hex({ message, secret }) {
    const cryptoProvider = globalThis.crypto;
    if (!cryptoProvider?.subtle)
        throw new Error("WebCrypto subtle API is required for offline grant signing");
    const key = await cryptoProvider.subtle.importKey("raw", new TextEncoder().encode(secret), { hash: "SHA-256", name: "HMAC" }, false, ["sign"]);
    const signature = await cryptoProvider.subtle.sign("HMAC", key, new TextEncoder().encode(message));
    return `${OFFLINE_GRANT_SIGNATURE_PREFIX}${hex(new Uint8Array(signature))}`;
}
/**
 * Converts bytes to lower-case hex.
 * @param {Uint8Array} bytes - Bytes.
 * @returns {string} - Hex string.
 */
function hex(bytes) {
    return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
/**
 * Requires a non-empty string field.
 * @param {unknown} value - Value.
 * @param {string} name - Field name.
 * @returns {string} - String value.
 */
function requiredString(value, name) {
    if (typeof value !== "string" || value.length < 1)
        throw new Error(`Expected offline grant ${name}`);
    return value;
}
/**
 * Normalizes a Date to an ISO timestamp.
 * @param {Date} date - Date value.
 * @param {string} label - Field label.
 * @returns {string} - ISO timestamp.
 */
function isoDateString(date, label) {
    if (Number.isNaN(date.getTime()))
        throw new Error(`Invalid offline grant ${label}`);
    return date.toISOString();
}
/**
 * Generates a fallback random grant id.
 * @returns {string} - Grant id.
 */
function randomGrantId() {
    return globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `grant-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
/**
 * Stable JSON stringifier with sorted object keys.
 * @param {unknown} value - Value.
 * @returns {string} - JSON string.
 */
function stableJsonStringify(value) {
    return JSON.stringify(deterministicJson({ label: "root", value }));
}
/**
 * Normalizes a value as a JSON object.
 * @param {object} args - Arguments.
 * @param {string} args.label - Diagnostic label.
 * @param {unknown} args.value - Value.
 * @returns {Record<string, import("../configuration-types.js").FrontendModelSyncJsonValue>} - JSON object.
 */
function deterministicJsonObject({ label, value }) {
    const normalized = deterministicJson({ label, value });
    if (!normalized || typeof normalized !== "object" || Array.isArray(normalized))
        throw new Error(`Expected offline grant ${label} object`);
    return /** @type {Record<string, import("../configuration-types.js").FrontendModelSyncJsonValue>} */ (normalized);
}
/**
 * Normalizes deterministic JSON with sorted object keys.
 * @param {object} args - Arguments.
 * @param {string} args.label - Diagnostic label.
 * @param {unknown} args.value - Value.
 * @returns {import("../configuration-types.js").FrontendModelSyncJsonValue} - Normalized JSON value.
 */
function deterministicJson({ label, value }) {
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean")
        return value;
    if (Array.isArray(value)) {
        return value.map((entry, index) => deterministicJson({ label: `${label}/${index}`, value: entry }));
    }
    if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
        /** @type {Record<string, import("../configuration-types.js").FrontendModelSyncJsonValue>} */
        const normalized = {};
        for (const key of Object.keys(value).sort()) {
            const childValue = /** @type {Record<string, unknown>} */ (value)[key];
            if (childValue === undefined)
                continue;
            normalized[key] = deterministicJson({ label: `${label}/${key}`, value: childValue });
        }
        return normalized;
    }
    throw new Error(`Offline grant ${label} must be deterministic JSON`);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib2ZmbGluZS1ncmFudC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9zeW5jL29mZmxpbmUtZ3JhbnQuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7Ozs7Ozs7R0FPRztBQUNIOzs7Ozs7Ozs7O0dBVUc7QUFDSDs7Ozs7O0dBTUc7QUFDSCxZQUFZO0FBRVosTUFBTSxpQ0FBaUMsR0FBRyxPQUFPLENBQUE7QUFDakQsTUFBTSw4QkFBOEIsR0FBRyxjQUFjLENBQUE7QUFFckQ7Ozs7OztHQU1HO0FBQ0gsTUFBTSxDQUFDLEtBQUssVUFBVSxrQkFBa0IsQ0FBQyxFQUFDLEtBQUssRUFBRSxVQUFVLEVBQUM7SUFDMUQsTUFBTSxlQUFlLEdBQUcscUJBQXFCLENBQUMsS0FBSyxDQUFDLENBQUE7SUFDcEQsTUFBTSxvQkFBb0IsR0FBRywrQkFBK0IsQ0FBQyxVQUFVLENBQUMsQ0FBQTtJQUN4RSxNQUFNLGNBQWMsR0FBRywwQkFBMEIsQ0FBQztRQUNoRCxTQUFTLEVBQUUsaUNBQWlDO1FBQzVDLEtBQUssRUFBRSxlQUFlO1FBQ3RCLEtBQUssRUFBRSxvQkFBb0IsQ0FBQyxFQUFFO0tBQy9CLENBQUMsQ0FBQTtJQUVGLE9BQU87UUFDTCxTQUFTLEVBQUUsaUNBQWlDO1FBQzVDLEtBQUssRUFBRSxlQUFlO1FBQ3RCLEtBQUssRUFBRSxvQkFBb0IsQ0FBQyxFQUFFO1FBQzlCLFNBQVMsRUFBRSxNQUFNLGFBQWEsQ0FBQyxFQUFDLE9BQU8sRUFBRSxjQUFjLEVBQUUsTUFBTSxFQUFFLG9CQUFvQixDQUFDLE1BQU0sRUFBQyxDQUFDO0tBQy9GLENBQUE7QUFDSCxDQUFDO0FBRUQ7Ozs7Ozs7R0FPRztBQUNILE1BQU0sQ0FBQyxLQUFLLFVBQVUsa0JBQWtCLENBQUMsRUFBQyxHQUFHLEdBQUcsSUFBSSxJQUFJLEVBQUUsRUFBRSxXQUFXLEVBQUUsV0FBVyxFQUFDO0lBQ25GLE1BQU0scUJBQXFCLEdBQUcsMkJBQTJCLENBQUMsV0FB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QUFJLEtBQUssRUFBRSxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQUMsQ0FBQyxDQUFDLENBQUE7SUFDbkcsQ0FBQztJQUVELElBQUksS0FBSyxJQUFJLE9BQU8sS0FBSyxLQUFLLFFBQVEsSUFBSSxNQUFNLENBQUMsY0FBYyxDQUFDLEtBQUssQ0FBQyxLQUFLLE1BQU0sQ0FBQyxTQUFTLEVBQUUsQ0FBQztRQUM1Riw2RkFBNkY7UUFDN0YsTUFBTSxVQUFVLEdBQUcsRUFBRSxDQUFBO1FBRXJCLEtBQUssTUFBTSxHQUFHLElBQUksTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQyxJQUFJLEVBQUUsRUFBRSxDQUFDO1lBQzVDLE1BQU0sVUFBVSxHQUFHLHNDQUFzQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUE7WUFFdEUsSUFBSSxVQUFVLEtBQUssU0FBUztnQkFBRSxTQUFRO1lBQ3RDLFVBQVUsQ0FBQyxHQUFHLENBQUMsR0FBRyxpQkFBaUIsQ0FBQyxFQUFDLEtBQUssRUFBRSxHQUFHLEtBQUssSUFBSSxHQUFHLEVBQUUsRUFBRSxLQUFLLEVBQUUsVUFBVSxFQUFDLENBQUMsQ0FBQTtRQUNwRixDQUFDO1FBRUQsT0FBTyxVQUFVLENBQUE7SUFDbkIsQ0FBQztJQUVELE1BQU0sSUFBSSxLQUFLLENBQUMsaUJBQWlCLEtBQUssNkJBQTZCLENBQUMsQ0FBQTtBQUN0RSxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBTaWduZWQgb2ZmbGluZSBncmFudCBlbnZlbG9wZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFNpZ25lZE9mZmxpbmVHcmFudFxuICogQHByb3BlcnR5IHtcIkhTMjU2XCJ9IGFsZ29yaXRobSAtIFNpZ25hdHVyZSBhbGdvcml0aG0uXG4gKiBAcHJvcGVydHkge09mZmxpbmVHcmFudH0gZ3JhbnQgLSBTaWduZWQgZ3JhbnQgcGF5bG9hZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBrZXlJZCAtIFNpZ25pbmcga2V5IGlkLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHNpZ25hdHVyZSAtIEhleCBITUFDIHNpZ25hdHVyZSB3aXRoIGEgaG1hYy1zaGEyNTYgcHJlZml4LlxuICovXG4vKipcbiAqIEJhY2tlbmQtaXNzdWVkIG9mZmxpbmUgZ3JhbnQgcGF5bG9hZC5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IE9mZmxpbmVHcmFudFxuICogQHByb3BlcnR5IHtzdHJpbmd9IGRldmljZUlkIC0gRGV2aWNlIGlkIGFsbG93ZWQgdG8gdXNlIHRoZSBncmFudC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBleHBpcmVzQXQgLSBJU08gdGltZXN0YW1wIGFmdGVyIHdoaWNoIHJlcGxheSBtdXN0IHJlamVjdCB0aGUgZ3JhbnQuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gZ3JhbnRJZCAtIFN0YWJsZSBncmFudCBpZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBpc3N1ZWRBdCAtIElTTyB0aW1lc3RhbXAgd2hlbiB0aGUgYmFja2VuZCBpc3N1ZWQgdGhlIGdyYW50LlxuICogQHByb3BlcnR5IHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxTeW5jSnNvblZhbHVlPn0gcmVzb3VyY2VzIC0gU3luYyBtYW5pZmVzdC9tYXRlcmlhbGl6ZWQgcmVzb3VyY2UgbWV0YWRhdGEuXG4gKiBAcHJvcGVydHkge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFN5bmNKc29uVmFsdWU+fSBzY29wZXMgLSBNYXRlcmlhbGl6ZWQgZ3JhbnQgc2NvcGVzLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHVzZXJJZCAtIEFjdG9yIHVzZXIgaWQgYWxsb3dlZCB0byB1c2UgdGhlIGdyYW50LlxuICovXG4vKipcbiAqIE9mZmxpbmUgZ3JhbnQgc2lnbmluZyBrZXkuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBPZmZsaW5lR3JhbnRTaWduaW5nS2V5XG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFtjdXJyZW50XSAtIFdoZXRoZXIgdGhpcyBpcyB0aGUgYWN0aXZlIGtleSBmb3IgbmV3IGdyYW50cy5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBpZCAtIFB1YmxpYyBrZXkgaWQgaW5jbHVkZWQgaW4gc2lnbmVkIGdyYW50IGVudmVsb3Blcy5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBzZWNyZXQgLSBQcml2YXRlIEhNQUMgc2VjcmV0LiBOZXZlciBleHBvc2UgdGhpcyB0byBjbGllbnRzLlxuICovXG4vLyBAdHMtY2hlY2tcblxuY29uc3QgT0ZGTElORV9HUkFOVF9TSUdOQVRVUkVfQUxHT1JJVEhNID0gXCJIUzI1NlwiXG5jb25zdCBPRkZMSU5FX0dSQU5UX1NJR05BVFVSRV9QUkVGSVggPSBcImhtYWMtc2hhMjU2LVwiXG5cbi8qKlxuICogQ3JlYXRlcyBhIHNpZ25lZCBvZmZsaW5lIGdyYW50IGVudmVsb3BlLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gKiBAcGFyYW0ge09mZmxpbmVHcmFudH0gYXJncy5ncmFudCAtIEdyYW50IHBheWxvYWQuXG4gKiBAcGFyYW0ge09mZmxpbmVHcmFudFNpZ25pbmdLZXl9IGFyZ3Muc2lnbmluZ0tleSAtIEN1cnJlbnQgc2lnbmluZyBrZXkuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxTaWduZWRPZmZsaW5lR3JhbnQ+fSAtIFNpZ25lZCBncmFudCBlbnZlbG9wZS5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGNyZWF0ZU9mZmxpbmVHcmFudCh7Z3JhbnQsIHNpZ25pbmdLZXl9KSB7XG4gIGNvbnN0IG5vcm1hbGl6ZWRHcmFudCA9IG5vcm1hbGl6ZU9mZmxpbmVHcmFudChncmFudClcbiAgY29uc3Qgbm9ybWFsaXplZFNpZ25pbmdLZXkgPSBub3JtYWxpemVPZmZsaW5lR3JhbnRTaWduaW5nS2V5KHNpZ25pbmdLZXkpXG4gIGNvbnN0IHNpZ25hdHVyZUlucHV0ID0gb2ZmbGluZUdyYW50U2lnbmF0dXJlSW5wdXQoe1xuICAgIGFsZ29yaXRobTogT0ZGTElORV9HUkFOVF9TSUdOQVRVUkVfQUxHT1JJVEhNLFxuICAgIGdyYW50OiBub3JtYWxpemVkR3JhbnQsXG4gICAga2V5SWQ6IG5vcm1hbGl6ZWRTaWduaW5nS2V5LmlkXG4gIH0pXG5cbiAgcmV0dXJuIHtcbiAgICBhbGdvcml0aG06IE9GRkxJTkVfR1JBTlRfU0lHTkFUVVJFX0FMR09SSVRITSxcbiAgICBncmFudDogbm9ybWFsaXplZEdyYW50LFxuICAgIGtleUlkOiBub3JtYWxpemVkU2lnbmluZ0tleS5pZCxcbiAgICBzaWduYXR1cmU6IGF3YWl0IGhtYWNTaGEyNTZIZXgoe21lc3NhZ2U6IHNpZ25hdHVyZUlucHV0LCBzZWNyZXQ6IG5vcm1hbGl6ZWRTaWduaW5nS2V5LnNlY3JldH0pXG4gIH1cbn1cblxuLyoqXG4gKiBWZXJpZmllcyBhIHNpZ25lZCBvZmZsaW5lIGdyYW50IGFuZCByZXR1cm5zIHRoZSB0cnVzdGVkIGdyYW50IHBheWxvYWQuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAqIEBwYXJhbSB7RGF0ZX0gW2FyZ3Mubm93XSAtIFZlcmlmaWNhdGlvbiB0aW1lLiBEZWZhdWx0cyB0byBjdXJyZW50IHRpbWUuXG4gKiBAcGFyYW0ge1NpZ25lZE9mZmxpbmVHcmFudH0gYXJncy5zaWduZWRHcmFudCAtIFNpZ25lZCBncmFudCBlbnZlbG9wZS5cbiAqIEBwYXJhbSB7T2ZmbGluZUdyYW50U2lnbmluZ0tleVtdfSBhcmdzLnNpZ25pbmdLZXlzIC0gQ2FuZGlkYXRlIHZlcmlmaWNhdGlvbiBrZXlzLlxuICogQHJldHVybnMge1Byb21pc2U8T2ZmbGluZUdyYW50Pn0gLSBWZXJpZmllZCBncmFudCBwYXlsb2FkLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gdmVyaWZ5T2ZmbGluZUdyYW50KHtub3cgPSBuZXcgRGF0ZSgpLCBzaWduZWRHcmFudCwgc2lnbmluZ0tleXN9KSB7XG4gIGNvbnN0IG5vcm1hbGl6ZWRTaWduZWRHcmFudCA9IG5vcm1hbGl6ZVNpZ25lZE9mZmxpbmVHcmFudChzaWduZWRHcmFudClcblxuICBpZiAobm9ybWFsaXplZFNpZ25lZEdyYW50LmFsZ29yaXRobSAhPT0gT0ZGTElORV9HUkFOVF9TSUdOQVRVUkVfQUxHT1JJVEhNKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBVbnN1cHBvcnRlZCBvZmZsaW5lIGdyYW50IHNpZ25hdHVyZSBhbGdvcml0aG0gJyR7bm9ybWFsaXplZFNpZ25lZEdyYW50LmFsZ29yaXRobX0nYClcbiAgfVxuXG4gIGNvbnN0IHNpZ25pbmdLZXkgPSBzaWduaW5nS2V5c1xuICAgIC5tYXAoKGtleSkgPT4gbm9ybWFsaXplT2ZmbGluZUdyYW50U2lnbmluZ0tleShrZXkpKVxuICAgIC5maW5kKChrZXkpID0+IGtleS5pZCA9PT0gbm9ybWFsaXplZFNpZ25lZEdyYW50LmtleUlkKVxuXG4gIGlmICghc2lnbmluZ0tleSkgdGhyb3cgbmV3IEVycm9yKGBObyBvZmZsaW5lIGdyYW50IHNpZ25pbmcga2V5IGZvciBrZXkgaWQgJyR7bm9ybWFsaXplZFNpZ25lZEdyYW50LmtleUlkfSdgKVxuXG4gIGNvbnN0IGV4cGVjdGVkU2lnbmF0dXJlID0gYXdhaXQgaG1hY1NoYTI1NkhleCh7XG4gICAgbWVzc2FnZTogb2ZmbGluZUdyYW50U2lnbmF0dXJlSW5wdXQobm9ybWFsaXplZFNpZ25lZEdyYW50KSxcbiAgICBzZWNyZXQ6IHNpZ25pbmdLZXkuc2VjcmV0XG4gIH0pXG5cbiAgaWYgKGV4cGVjdGVkU2lnbmF0dXJlICE9PSBub3JtYWxpemVkU2lnbmVkR3JhbnQuc2lnbmF0dXJlKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiT2ZmbGluZSBncmFudCBzaWduYXR1cmUgZGlkIG5vdCBtYXRjaFwiKVxuICB9XG5cbiAgaWYgKE51bWJlci5pc05hTihub3cuZ2V0VGltZSgpKSkgdGhyb3cgbmV3IEVycm9yKFwiSW52YWxpZCBvZmZsaW5lIGdyYW50IHZlcmlmaWNhdGlvbiB0aW1lXCIpXG4gIGlmIChuZXcgRGF0ZShub3JtYWxpemVkU2lnbmVkR3JhbnQuZ3JhbnQuZXhwaXJlc0F0KS5nZXRUaW1lKCkgPD0gbm93LmdldFRpbWUoKSkgdGhyb3cgbmV3IEVycm9yKFwiT2ZmbGluZSBncmFudCBleHBpcmVkXCIpXG5cbiAgcmV0dXJuIG5vcm1hbGl6ZWRTaWduZWRHcmFudC5ncmFudFxufVxuXG4vKipcbiAqIEJ1aWxkcyBhIHNpZ25lZCBncmFudCBmcm9tIGJvb3RzdHJhcCByZXF1ZXN0IGlucHV0cy5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuZGV2aWNlSWQgLSBEZXZpY2UgaWQuXG4gKiBAcGFyYW0ge3N0cmluZyB8IHVuZGVmaW5lZH0gW2FyZ3MuZ3JhbnRJZF0gLSBPcHRpb25hbCBkZXRlcm1pbmlzdGljIGdyYW50IGlkIGZvciB0ZXN0cy9jdXN0b20gY2FsbGVycy5cbiAqIEBwYXJhbSB7bnVtYmVyIHwgdW5kZWZpbmVkfSBbYXJncy5ncmFudFR0bE1zXSAtIEdyYW50IFRUTCBpbiBtaWxsaXNlY29uZHMuXG4gKiBAcGFyYW0ge0RhdGV9IGFyZ3Mubm93IC0gSXNzdWUgdGltZS5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsU3luY0pzb25WYWx1ZT59IGFyZ3MucmVzb3VyY2VzIC0gUmVzb3VyY2Ugc3luYyBtYW5pZmVzdC5cbiAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsU3luY0pzb25WYWx1ZT59IGFyZ3Muc2NvcGVzIC0gR3JhbnQgc2NvcGVzLlxuICogQHBhcmFtIHtPZmZsaW5lR3JhbnRTaWduaW5nS2V5fSBhcmdzLnNpZ25pbmdLZXkgLSBDdXJyZW50IHNpZ25pbmcga2V5LlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MudXNlcklkIC0gQWN0b3IgdXNlciBpZC5cbiAqIEByZXR1cm5zIHtQcm9taXNlPFNpZ25lZE9mZmxpbmVHcmFudD59IC0gU2lnbmVkIGdyYW50LlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gY3JlYXRlT2ZmbGluZUdyYW50RnJvbUJvb3RzdHJhcCh7ZGV2aWNlSWQsIGdyYW50SWQsIGdyYW50VHRsTXMsIG5vdywgcmVzb3VyY2VzLCBzY29wZXMsIHNpZ25pbmdLZXksIHVzZXJJZH0pIHtcbiAgY29uc3QgaXNzdWVkQXQgPSBpc29EYXRlU3RyaW5nKG5vdywgXCJpc3N1ZWRBdFwiKVxuICBjb25zdCB0dGxNcyA9IGdyYW50VHRsTXMgPT09IHVuZGVmaW5lZCA/IDI0ICogNjAgKiA2MCAqIDEwMDAgOiBncmFudFR0bE1zXG5cbiAgaWYgKCFOdW1iZXIuaXNJbnRlZ2VyKHR0bE1zKSB8fCB0dGxNcyA8PSAwKSB0aHJvdyBuZXcgRXJyb3IoXCJPZmZsaW5lIGdyYW50IFRUTCBtdXN0IGJlIGEgcG9zaXRpdmUgaW50ZWdlciBudW1iZXIgb2YgbWlsbGlzZWNvbmRzXCIpXG5cbiAgcmV0dXJuIGF3YWl0IGNyZWF0ZU9mZmxpbmVHcmFudCh7XG4gICAgZ3JhbnQ6IHtcbiAgICAgIGRldmljZUlkLFxuICAgICAgZXhwaXJlc0F0OiBuZXcgRGF0ZShub3cuZ2V0VGltZSgpICsgdHRsTXMpLnRvSVNPU3RyaW5nKCksXG4gICAgICBncmFudElkOiBncmFudElkIHx8IHJhbmRvbUdyYW50SWQoKSxcbiAgICAgIGlzc3VlZEF0LFxuICAgICAgcmVzb3VyY2VzLFxuICAgICAgc2NvcGVzLFxuICAgICAgdXNlcklkXG4gICAgfSxcbiAgICBzaWduaW5nS2V5XG4gIH0pXG59XG5cbi8qKlxuICogTm9ybWFsaXplcyBzaWduZWQgZ3JhbnQgc2lnbmF0dXJlIGlucHV0LlxuICogQHBhcmFtIHt7YWxnb3JpdGhtOiBcIkhTMjU2XCIsIGdyYW50OiBPZmZsaW5lR3JhbnQsIGtleUlkOiBzdHJpbmd9fSBzaWduZWRHcmFudCAtIEdyYW50IHNpZ25hdHVyZSBmaWVsZHMuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIFN0YWJsZSBzaWduYXR1cmUgaW5wdXQuXG4gKi9cbmZ1bmN0aW9uIG9mZmxpbmVHcmFudFNpZ25hdHVyZUlucHV0KHNpZ25lZEdyYW50KSB7XG4gIHJldHVybiBzdGFibGVKc29uU3RyaW5naWZ5KHtcbiAgICBhbGdvcml0aG06IHNpZ25lZEdyYW50LmFsZ29yaXRobSxcbiAgICBncmFudDogc2lnbmVkR3JhbnQuZ3JhbnQsXG4gICAga2V5SWQ6IHNpZ25lZEdyYW50LmtleUlkXG4gIH0pXG59XG5cbi8qKlxuICogTm9ybWFsaXplcyBhIHNpZ25lZCBvZmZsaW5lIGdyYW50IGVudmVsb3BlLlxuICogQHBhcmFtIHtTaWduZWRPZmZsaW5lR3JhbnR9IHNpZ25lZEdyYW50IC0gU2lnbmVkIGdyYW50LlxuICogQHJldHVybnMge1NpZ25lZE9mZmxpbmVHcmFudH0gLSBOb3JtYWxpemVkIHNpZ25lZCBncmFudC5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplU2lnbmVkT2ZmbGluZUdyYW50KHNpZ25lZEdyYW50KSB7XG4gIGlmICghc2lnbmVkR3JhbnQgfHwgdHlwZW9mIHNpZ25lZEdyYW50ICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkoc2lnbmVkR3JhbnQpKSB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RlZCBzaWduZWQgb2ZmbGluZSBncmFudCBvYmplY3RcIilcbiAgaWYgKHNpZ25lZEdyYW50LmFsZ29yaXRobSAhPT0gT0ZGTElORV9HUkFOVF9TSUdOQVRVUkVfQUxHT1JJVEhNKSB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIG9mZmxpbmUgZ3JhbnQgc2lnbmF0dXJlIGFsZ29yaXRobSAnJHtTdHJpbmcoc2lnbmVkR3JhbnQuYWxnb3JpdGhtKX0nYClcbiAgaWYgKHR5cGVvZiBzaWduZWRHcmFudC5rZXlJZCAhPT0gXCJzdHJpbmdcIiB8fCBzaWduZWRHcmFudC5rZXlJZC5sZW5ndGggPCAxKSB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RlZCBvZmZsaW5lIGdyYW50IGtleSBpZFwiKVxuICBpZiAodHlwZW9mIHNpZ25lZEdyYW50LnNpZ25hdHVyZSAhPT0gXCJzdHJpbmdcIiB8fCAhc2lnbmVkR3JhbnQuc2lnbmF0dXJlLm1hdGNoKC9eaG1hYy1zaGEyNTYtW2EtZjAtOV17NjR9JC8pKSB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RlZCBvZmZsaW5lIGdyYW50IHNpZ25hdHVyZVwiKVxuXG4gIHJldHVybiB7XG4gICAgYWxnb3JpdGhtOiBzaWduZWRHcmFudC5hbGdvcml0aG0sXG4gICAgZ3JhbnQ6IG5vcm1hbGl6ZU9mZmxpbmVHcmFudChzaWduZWRHcmFudC5ncmFudCksXG4gICAga2V5SWQ6IHNpZ25lZEdyYW50LmtleUlkLFxuICAgIHNpZ25hdHVyZTogc2lnbmVkR3JhbnQuc2lnbmF0dXJlXG4gIH1cbn1cblxuLyoqXG4gKiBOb3JtYWxpemVzIGFuIG9mZmxpbmUgZ3JhbnQgcGF5bG9hZC5cbiAqIEBwYXJhbSB7T2ZmbGluZUdyYW50fSBncmFudCAtIEdyYW50IHBheWxvYWQuXG4gKiBAcmV0dXJucyB7T2ZmbGluZUdyYW50fSAtIE5vcm1hbGl6ZWQgZ3JhbnQgcGF5bG9hZC5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplT2ZmbGluZUdyYW50KGdyYW50KSB7XG4gIGlmICghZ3JhbnQgfHwgdHlwZW9mIGdyYW50ICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkoZ3JhbnQpKSB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RlZCBvZmZsaW5lIGdyYW50IG9iamVjdFwiKVxuXG4gIHJldHVybiB7XG4gICAgZGV2aWNlSWQ6IHJlcXVpcmVkU3RyaW5nKGdyYW50LmRldmljZUlkLCBcImRldmljZUlkXCIpLFxuICAgIGV4cGlyZXNBdDogaXNvRGF0ZVN0cmluZyhuZXcgRGF0ZShyZXF1aXJlZFN0cmluZyhncmFudC5leHBpcmVzQXQsIFwiZXhwaXJlc0F0XCIpKSwgXCJleHBpcmVzQXRcIiksXG4gICAgZ3JhbnRJZDogcmVxdWlyZWRTdHJpbmcoZ3JhbnQuZ3JhbnRJZCwgXCJncmFudElkXCIpLFxuICAgIGlzc3VlZEF0OiBpc29EYXRlU3RyaW5nKG5ldyBEYXRlKHJlcXVpcmVkU3RyaW5nKGdyYW50Lmlzc3VlZEF0LCBcImlzc3VlZEF0XCIpKSwgXCJpc3N1ZWRBdFwiKSxcbiAgICByZXNvdXJjZXM6IGRldGVybWluaXN0aWNKc29uT2JqZWN0KHtsYWJlbDogXCJyZXNvdXJjZXNcIiwgdmFsdWU6IGdyYW50LnJlc291cmNlc30pLFxuICAgIHNjb3BlczogZGV0ZXJtaW5pc3RpY0pzb25PYmplY3Qoe2xhYmVsOiBcInNjb3Blc1wiLCB2YWx1ZTogZ3JhbnQuc2NvcGVzfSksXG4gICAgdXNlcklkOiByZXF1aXJlZFN0cmluZyhncmFudC51c2VySWQsIFwidXNlcklkXCIpXG4gIH1cbn1cblxuLyoqXG4gKiBOb3JtYWxpemVzIGFuIG9mZmxpbmUgZ3JhbnQgc2lnbmluZyBrZXkuXG4gKiBAcGFyYW0ge09mZmxpbmVHcmFudFNpZ25pbmdLZXl9IHNpZ25pbmdLZXkgLSBTaWduaW5nIGtleS5cbiAqIEByZXR1cm5zIHtPZmZsaW5lR3JhbnRTaWduaW5nS2V5fSAtIE5vcm1hbGl6ZWQgc2lnbmluZyBrZXkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVPZmZsaW5lR3JhbnRTaWduaW5nS2V5KHNpZ25pbmdLZXkpIHtcbiAgaWYgKCFzaWduaW5nS2V5IHx8IHR5cGVvZiBzaWduaW5nS2V5ICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkoc2lnbmluZ0tleSkpIHRocm93IG5ldyBFcnJvcihcIkV4cGVjdGVkIG9mZmxpbmUgZ3JhbnQgc2lnbmluZyBrZXkgb2JqZWN0XCIpXG5cbiAgcmV0dXJuIHtcbiAgICBjdXJyZW50OiBzaWduaW5nS2V5LmN1cnJlbnQgPT09IHRydWUsXG4gICAgaWQ6IHJlcXVpcmVkU3RyaW5nKHNpZ25pbmdLZXkuaWQsIFwic2lnbmluZ0tleS5pZFwiKSxcbiAgICBzZWNyZXQ6IHJlcXVpcmVkU3RyaW5nKHNpZ25pbmdLZXkuc2VjcmV0LCBcInNpZ25pbmdLZXkuc2VjcmV0XCIpXG4gIH1cbn1cblxuLyoqXG4gKiBSZXR1cm5zIHRoZSBjdXJyZW50IGtleSB1c2VkIHRvIHNpZ24gbmV3IGdyYW50cy5cbiAqIEBwYXJhbSB7T2ZmbGluZUdyYW50U2lnbmluZ0tleVtdfSBzaWduaW5nS2V5cyAtIENvbmZpZ3VyZWQgc2lnbmluZyBrZXlzLlxuICogQHJldHVybnMge09mZmxpbmVHcmFudFNpZ25pbmdLZXl9IC0gQ3VycmVudCBzaWduaW5nIGtleS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGN1cnJlbnRPZmZsaW5lR3JhbnRTaWduaW5nS2V5KHNpZ25pbmdLZXlzKSB7XG4gIGNvbnN0IG5vcm1hbGl6ZWRLZXlzID0gc2lnbmluZ0tleXMubWFwKChrZXkpID0+IG5vcm1hbGl6ZU9mZmxpbmVHcmFudFNpZ25pbmdLZXkoa2V5KSlcbiAgY29uc3QgY3VycmVudEtleXMgPSBub3JtYWxpemVkS2V5cy5maWx0ZXIoKGtleSkgPT4ga2V5LmN1cnJlbnQgPT09IHRydWUpXG5cbiAgaWYgKG5vcm1hbGl6ZWRLZXlzLmxlbmd0aCA8IDEpIHRocm93IG5ldyBFcnJvcihcIkF0IGxlYXN0IG9uZSBvZmZsaW5lIGdyYW50IHNpZ25pbmcga2V5IGlzIHJlcXVpcmVkXCIpXG4gIGlmIChjdXJyZW50S2V5cy5sZW5ndGggPiAxKSB0aHJvdyBuZXcgRXJyb3IoXCJPbmx5IG9uZSBvZmZsaW5lIGdyYW50IHNpZ25pbmcga2V5IGNhbiBiZSBjdXJyZW50XCIpXG5cbiAgcmV0dXJuIGN1cnJlbnRLZXlzWzBdIHx8IG5vcm1hbGl6ZWRLZXlzWzBdXG59XG5cbi8qKlxuICogU2lnbnMgYSBtZXNzYWdlIHVzaW5nIEhNQUMtU0hBMjU2IGFuZCByZXR1cm5zIGEgcHJlZml4ZWQgaGV4IHNpZ25hdHVyZS5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubWVzc2FnZSAtIE1lc3NhZ2UgdG8gc2lnbi5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnNlY3JldCAtIEhNQUMgc2VjcmV0LlxuICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gLSBQcmVmaXhlZCBoZXggc2lnbmF0dXJlLlxuICovXG5hc3luYyBmdW5jdGlvbiBobWFjU2hhMjU2SGV4KHttZXNzYWdlLCBzZWNyZXR9KSB7XG4gIGNvbnN0IGNyeXB0b1Byb3ZpZGVyID0gZ2xvYmFsVGhpcy5jcnlwdG9cblxuICBpZiAoIWNyeXB0b1Byb3ZpZGVyPy5zdWJ0bGUpIHRocm93IG5ldyBFcnJvcihcIldlYkNyeXB0byBzdWJ0bGUgQVBJIGlzIHJlcXVpcmVkIGZvciBvZmZsaW5lIGdyYW50IHNpZ25pbmdcIilcblxuICBjb25zdCBrZXkgPSBhd2FpdCBjcnlwdG9Qcm92aWRlci5zdWJ0bGUuaW1wb3J0S2V5KFxuICAgIFwicmF3XCIsXG4gICAgbmV3IFRleHRFbmNvZGVyKCkuZW5jb2RlKHNlY3JldCksXG4gICAge2hhc2g6IFwiU0hBLTI1NlwiLCBuYW1lOiBcIkhNQUNcIn0sXG4gICAgZmFsc2UsXG4gICAgW1wic2lnblwiXVxuICApXG4gIGNvbnN0IHNpZ25hdHVyZSA9IGF3YWl0IGNyeXB0b1Byb3ZpZGVyLnN1YnRsZS5zaWduKFwiSE1BQ1wiLCBrZXksIG5ldyBUZXh0RW5jb2RlcigpLmVuY29kZShtZXNzYWdlKSlcblxuICByZXR1cm4gYCR7T0ZGTElORV9HUkFOVF9TSUdOQVRVUkVfUFJFRklYfSR7aGV4KG5ldyBVaW50OEFycmF5KHNpZ25hdHVyZSkpfWBcbn1cblxuLyoqXG4gKiBDb252ZXJ0cyBieXRlcyB0byBsb3dlci1jYXNlIGhleC5cbiAqIEBwYXJhbSB7VWludDhBcnJheX0gYnl0ZXMgLSBCeXRlcy5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gSGV4IHN0cmluZy5cbiAqL1xuZnVuY3Rpb24gaGV4KGJ5dGVzKSB7XG4gIHJldHVybiBBcnJheS5mcm9tKGJ5dGVzKS5tYXAoKGJ5dGUpID0+IGJ5dGUudG9TdHJpbmcoMTYpLnBhZFN0YXJ0KDIsIFwiMFwiKSkuam9pbihcIlwiKVxufVxuXG4vKipcbiAqIFJlcXVpcmVzIGEgbm9uLWVtcHR5IHN0cmluZyBmaWVsZC5cbiAqIEBwYXJhbSB7dW5rbm93bn0gdmFsdWUgLSBWYWx1ZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gRmllbGQgbmFtZS5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU3RyaW5nIHZhbHVlLlxuICovXG5mdW5jdGlvbiByZXF1aXJlZFN0cmluZyh2YWx1ZSwgbmFtZSkge1xuICBpZiAodHlwZW9mIHZhbHVlICE9PSBcInN0cmluZ1wiIHx8IHZhbHVlLmxlbmd0aCA8IDEpIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgb2ZmbGluZSBncmFudCAke25hbWV9YClcblxuICByZXR1cm4gdmFsdWVcbn1cblxuLyoqXG4gKiBOb3JtYWxpemVzIGEgRGF0ZSB0byBhbiBJU08gdGltZXN0YW1wLlxuICogQHBhcmFtIHtEYXRlfSBkYXRlIC0gRGF0ZSB2YWx1ZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBsYWJlbCAtIEZpZWxkIGxhYmVsLlxuICogQHJldHVybnMge3N0cmluZ30gLSBJU08gdGltZXN0YW1wLlxuICovXG5mdW5jdGlvbiBpc29EYXRlU3RyaW5nKGRhdGUsIGxhYmVsKSB7XG4gIGlmIChOdW1iZXIuaXNOYU4oZGF0ZS5nZXRUaW1lKCkpKSB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgb2ZmbGluZSBncmFudCAke2xhYmVsfWApXG5cbiAgcmV0dXJuIGRhdGUudG9JU09TdHJpbmcoKVxufVxuXG4vKipcbiAqIEdlbmVyYXRlcyBhIGZhbGxiYWNrIHJhbmRvbSBncmFudCBpZC5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gR3JhbnQgaWQuXG4gKi9cbmZ1bmN0aW9uIHJhbmRvbUdyYW50SWQoKSB7XG4gIHJldHVybiBnbG9iYWxUaGlzLmNyeXB0bz8ucmFuZG9tVVVJRCA/IGdsb2JhbFRoaXMuY3J5cHRvLnJhbmRvbVVVSUQoKSA6IGBncmFudC0ke0RhdGUubm93KCl9LSR7TWF0aC5yYW5kb20oKS50b1N0cmluZygxNikuc2xpY2UoMil9YFxufVxuXG4vKipcbiAqIFN0YWJsZSBKU09OIHN0cmluZ2lmaWVyIHdpdGggc29ydGVkIG9iamVjdCBrZXlzLlxuICogQHBhcmFtIHt1bmtub3dufSB2YWx1ZSAtIFZhbHVlLlxuICogQHJldHVybnMge3N0cmluZ30gLSBKU09OIHN0cmluZy5cbiAqL1xuZnVuY3Rpb24gc3RhYmxlSnNvblN0cmluZ2lmeSh2YWx1ZSkge1xuICByZXR1cm4gSlNPTi5zdHJpbmdpZnkoZGV0ZXJtaW5pc3RpY0pzb24oe2xhYmVsOiBcInJvb3RcIiwgdmFsdWV9KSlcbn1cblxuLyoqXG4gKiBOb3JtYWxpemVzIGEgdmFsdWUgYXMgYSBKU09OIG9iamVjdC5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubGFiZWwgLSBEaWFnbm9zdGljIGxhYmVsLlxuICogQHBhcmFtIHt1bmtub3dufSBhcmdzLnZhbHVlIC0gVmFsdWUuXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsU3luY0pzb25WYWx1ZT59IC0gSlNPTiBvYmplY3QuXG4gKi9cbmZ1bmN0aW9uIGRldGVybWluaXN0aWNKc29uT2JqZWN0KHtsYWJlbCwgdmFsdWV9KSB7XG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSBkZXRlcm1pbmlzdGljSnNvbih7bGFiZWwsIHZhbHVlfSlcblxuICBpZiAoIW5vcm1hbGl6ZWQgfHwgdHlwZW9mIG5vcm1hbGl6ZWQgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShub3JtYWxpemVkKSkgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBvZmZsaW5lIGdyYW50ICR7bGFiZWx9IG9iamVjdGApXG5cbiAgcmV0dXJuIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsU3luY0pzb25WYWx1ZT59ICovIChub3JtYWxpemVkKVxufVxuXG4vKipcbiAqIE5vcm1hbGl6ZXMgZGV0ZXJtaW5pc3RpYyBKU09OIHdpdGggc29ydGVkIG9iamVjdCBrZXlzLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy5sYWJlbCAtIERpYWdub3N0aWMgbGFiZWwuXG4gKiBAcGFyYW0ge3Vua25vd259IGFyZ3MudmFsdWUgLSBWYWx1ZS5cbiAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxTeW5jSnNvblZhbHVlfSAtIE5vcm1hbGl6ZWQgSlNPTiB2YWx1ZS5cbiAqL1xuZnVuY3Rpb24gZGV0ZXJtaW5pc3RpY0pzb24oe2xhYmVsLCB2YWx1ZX0pIHtcbiAgaWYgKHZhbHVlID09PSBudWxsIHx8IHR5cGVvZiB2YWx1ZSA9PT0gXCJzdHJpbmdcIiB8fCB0eXBlb2YgdmFsdWUgPT09IFwibnVtYmVyXCIgfHwgdHlwZW9mIHZhbHVlID09PSBcImJvb2xlYW5cIikgcmV0dXJuIHZhbHVlXG5cbiAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgcmV0dXJuIHZhbHVlLm1hcCgoZW50cnksIGluZGV4KSA9PiBkZXRlcm1pbmlzdGljSnNvbih7bGFiZWw6IGAke2xhYmVsfS8ke2luZGV4fWAsIHZhbHVlOiBlbnRyeX0pKVxuICB9XG5cbiAgaWYgKHZhbHVlICYmIHR5cGVvZiB2YWx1ZSA9PT0gXCJvYmplY3RcIiAmJiBPYmplY3QuZ2V0UHJvdG90eXBlT2YodmFsdWUpID09PSBPYmplY3QucHJvdG90eXBlKSB7XG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxTeW5jSnNvblZhbHVlPn0gKi9cbiAgICBjb25zdCBub3JtYWxpemVkID0ge31cblxuICAgIGZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKHZhbHVlKS5zb3J0KCkpIHtcbiAgICAgIGNvbnN0IGNoaWxkVmFsdWUgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSAqLyAodmFsdWUpW2tleV1cblxuICAgICAgaWYgKGNoaWxkVmFsdWUgPT09IHVuZGVmaW5lZCkgY29udGludWVcbiAgICAgIG5vcm1hbGl6ZWRba2V5XSA9IGRldGVybWluaXN0aWNKc29uKHtsYWJlbDogYCR7bGFiZWx9LyR7a2V5fWAsIHZhbHVlOiBjaGlsZFZhbHVlfSlcbiAgICB9XG5cbiAgICByZXR1cm4gbm9ybWFsaXplZFxuICB9XG5cbiAgdGhyb3cgbmV3IEVycm9yKGBPZmZsaW5lIGdyYW50ICR7bGFiZWx9IG11c3QgYmUgZGV0ZXJtaW5pc3RpYyBKU09OYClcbn1cbiJdfQ==