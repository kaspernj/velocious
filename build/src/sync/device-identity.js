/**
 * JSON Web Key used by the sync signing helpers.
 * @typedef {import("node:crypto").webcrypto.JsonWebKey} SyncJsonWebKey
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
// @ts-check
const ECDSA_P256_SHA256_ALGORITHM = "ECDSA-P256-SHA256";
const ECDSA_P256_SHA256_SIGNATURE_PREFIX = "ecdsa-p256-sha256-";
/**
 * Generates an ECDSA P-256 keypair exported as JWKs.
 * @returns {Promise<{privateKey: SyncJsonWebKey, publicKey: SyncJsonWebKey}>} - Exported keypair.
 */
export async function generateSyncSigningKeyPair() {
    const keyPair = await cryptoSubtle().generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    return {
        privateKey: await cryptoSubtle().exportKey("jwk", keyPair.privateKey),
        publicKey: await cryptoSubtle().exportKey("jwk", keyPair.publicKey)
    };
}
/**
 * Creates a backend-signed device certificate.
 * @param {object} args - Arguments.
 * @param {SyncJsonWebKey} args.backendPrivateKey - Backend private signing key.
 * @param {DeviceCertificatePayload} args.certificate - Certificate payload.
 * @returns {Promise<DeviceCertificate>} - Signed certificate.
 */
export async function createDeviceCertificate({ backendPrivateKey, certificate }) {
    const normalizedCertificate = normalizeDeviceCertificatePayload(certificate);
    return {
        algorithm: ECDSA_P256_SHA256_ALGORITHM,
        certificate: normalizedCertificate,
        signature: await signStableJson({
            privateKey: backendPrivateKey,
            value: deviceCertificateSignatureValue(normalizedCertificate)
        })
    };
}
/**
 * Verifies a backend-signed device certificate.
 * @param {object} args - Arguments.
 * @param {SyncJsonWebKey} args.backendPublicKey - Backend public key.
 * @param {DeviceCertificate} args.certificate - Signed certificate.
 * @param {Date} [args.now] - Verification time. Defaults to current time.
 * @returns {Promise<DeviceCertificatePayload>} - Verified certificate payload.
 */
export async function verifyDeviceCertificate({ backendPublicKey, certificate, now = new Date() }) {
    const normalizedCertificate = normalizeDeviceCertificate(certificate);
    const verified = await verifyStableJsonSignature({
        publicKey: backendPublicKey,
        signature: normalizedCertificate.signature,
        value: deviceCertificateSignatureValue(normalizedCertificate.certificate)
    });
    if (!verified)
        throw new Error("Device certificate signature did not match");
    assertNotExpired({ expiresAt: normalizedCertificate.certificate.expiresAt, label: "Device certificate", now });
    return normalizedCertificate.certificate;
}
/**
 * Creates a device-signed mutation envelope.
 * @param {object} args - Arguments.
 * @param {DeviceCertificate} args.deviceCertificate - Backend-signed device certificate.
 * @param {SyncJsonWebKey} args.devicePrivateKey - Device private signing key.
 * @param {SyncMutation} args.mutation - Mutation payload.
 * @returns {Promise<SignedSyncMutation>} - Signed mutation.
 */
export async function createSignedMutation({ deviceCertificate, devicePrivateKey, mutation }) {
    const normalizedDeviceCertificate = normalizeDeviceCertificate(deviceCertificate);
    const normalizedMutation = normalizeSyncMutation(mutation);
    assertMutationMatchesCertificate({ certificate: normalizedDeviceCertificate.certificate, mutation: normalizedMutation });
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
    };
}
/**
 * Verifies a signed sync mutation and its device certificate.
 * @param {object} args - Arguments.
 * @param {SyncJsonWebKey} args.backendPublicKey - Backend public key used to verify the device certificate.
 * @param {Date} [args.now] - Verification time. Defaults to current time.
 * @param {SignedSyncMutation} args.signedMutation - Signed mutation envelope.
 * @returns {Promise<SyncMutation>} - Verified mutation payload.
 */
export async function verifySignedMutation({ backendPublicKey, now = new Date(), signedMutation }) {
    const normalizedSignedMutation = normalizeSignedSyncMutation(signedMutation);
    const certificatePayload = await verifyDeviceCertificate({
        backendPublicKey,
        certificate: normalizedSignedMutation.deviceCertificate,
        now
    });
    assertMutationMatchesCertificate({ certificate: certificatePayload, mutation: normalizedSignedMutation.mutation });
    const verified = await verifyStableJsonSignature({
        publicKey: certificatePayload.devicePublicKey,
        signature: normalizedSignedMutation.signature,
        value: signedMutationSignatureValue({
            deviceCertificate: normalizedSignedMutation.deviceCertificate,
            mutation: normalizedSignedMutation.mutation
        })
    });
    if (!verified)
        throw new Error("Sync mutation signature did not match");
    return normalizedSignedMutation.mutation;
}
/**
 * Returns the replay/idempotency key for a signed mutation.
 * @param {{mutation: {actorDeviceId?: unknown, actorUserId?: unknown, clientMutationId?: unknown}}} signedMutation - Signed mutation-like object.
 * @returns {string} - Idempotency key.
 */
export function mutationIdempotencyKey(signedMutation) {
    const mutation = signedMutation.mutation;
    return [
        requiredString(mutation.actorUserId, "actorUserId"),
        requiredString(mutation.actorDeviceId, "actorDeviceId"),
        requiredString(mutation.clientMutationId, "clientMutationId")
    ].join(":");
}
/**
 * Builds the stable value signed by backend device certificates.
 * @param {DeviceCertificatePayload} certificate - Certificate payload.
 * @returns {Record<string, import("../configuration-types.js").FrontendModelSyncJsonValue>} - Stable signature value.
 */
function deviceCertificateSignatureValue(certificate) {
    return {
        algorithm: ECDSA_P256_SHA256_ALGORITHM,
        certificate: /** @type {Record<string, import("../configuration-types.js").FrontendModelSyncJsonValue>} */ (deterministicJsonObject({ label: "certificate", value: certificate }))
    };
}
/**
 * Builds the stable value signed by sync mutations.
 * @param {object} args - Arguments.
 * @param {DeviceCertificate} args.deviceCertificate - Device certificate.
 * @param {SyncMutation} args.mutation - Mutation payload.
 * @returns {Record<string, import("../configuration-types.js").FrontendModelSyncJsonValue>} - Stable signature value.
 */
function signedMutationSignatureValue({ deviceCertificate, mutation }) {
    return {
        algorithm: ECDSA_P256_SHA256_ALGORITHM,
        deviceCertificate: /** @type {Record<string, import("../configuration-types.js").FrontendModelSyncJsonValue>} */ (deterministicJsonObject({ label: "deviceCertificate", value: deviceCertificate })),
        mutation: /** @type {Record<string, import("../configuration-types.js").FrontendModelSyncJsonValue>} */ (deterministicJsonObject({ label: "mutation", value: mutation }))
    };
}
/**
 * Signs a deterministic JSON value with ECDSA P-256/SHA-256.
 * @param {object} args - Arguments.
 * @param {SyncJsonWebKey} args.privateKey - Private JWK.
 * @param {unknown} args.value - Value to sign.
 * @returns {Promise<string>} - Prefixed base64url signature.
 */
async function signStableJson({ privateKey, value }) {
    const key = await cryptoSubtle().importKey("jwk", privateKey, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    const signature = await cryptoSubtle().sign({ hash: "SHA-256", name: "ECDSA" }, key, /** @type {Uint8Array<ArrayBuffer>} */ (utf8(stableJsonStringify(value))));
    return `${ECDSA_P256_SHA256_SIGNATURE_PREFIX}${base64UrlEncode(new Uint8Array(signature))}`;
}
/**
 * Verifies a deterministic JSON value with ECDSA P-256/SHA-256.
 * @param {object} args - Arguments.
 * @param {SyncJsonWebKey} args.publicKey - Public JWK.
 * @param {string} args.signature - Prefixed base64url signature.
 * @param {unknown} args.value - Value to verify.
 * @returns {Promise<boolean>} - Whether the signature matches.
 */
async function verifyStableJsonSignature({ publicKey, signature, value }) {
    const key = await cryptoSubtle().importKey("jwk", publicKey, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const signatureBytes = base64UrlDecode(signatureWithoutPrefix(signature));
    return await cryptoSubtle().verify({ hash: "SHA-256", name: "ECDSA" }, key, /** @type {Uint8Array<ArrayBuffer>} */ (signatureBytes), /** @type {Uint8Array<ArrayBuffer>} */ (utf8(stableJsonStringify(value))));
}
/**
 * Normalizes a signed device certificate envelope.
 * @param {DeviceCertificate} certificate - Signed certificate.
 * @returns {DeviceCertificate} - Normalized certificate.
 */
function normalizeDeviceCertificate(certificate) {
    if (!certificate || typeof certificate !== "object" || Array.isArray(certificate))
        throw new Error("Expected device certificate object");
    if (certificate.algorithm !== ECDSA_P256_SHA256_ALGORITHM)
        throw new Error(`Unsupported device certificate algorithm '${String(certificate.algorithm)}'`);
    return {
        algorithm: certificate.algorithm,
        certificate: normalizeDeviceCertificatePayload(certificate.certificate),
        signature: normalizeSignature(certificate.signature, "device certificate signature")
    };
}
/**
 * Normalizes a device certificate payload.
 * @param {DeviceCertificatePayload} certificate - Certificate payload.
 * @returns {DeviceCertificatePayload} - Normalized certificate payload.
 */
function normalizeDeviceCertificatePayload(certificate) {
    if (!certificate || typeof certificate !== "object" || Array.isArray(certificate))
        throw new Error("Expected device certificate payload object");
    return {
        actorDeviceId: requiredString(certificate.actorDeviceId, "actorDeviceId"),
        actorUserId: requiredString(certificate.actorUserId, "actorUserId"),
        certificateId: requiredString(certificate.certificateId, "certificateId"),
        devicePublicKey: normalizeJwk(certificate.devicePublicKey, "devicePublicKey"),
        expiresAt: isoDateString(new Date(requiredString(certificate.expiresAt, "expiresAt")), "expiresAt"),
        issuedAt: isoDateString(new Date(requiredString(certificate.issuedAt, "issuedAt")), "issuedAt")
    };
}
/**
 * Normalizes a signed sync mutation envelope.
 * @param {SignedSyncMutation} signedMutation - Signed mutation.
 * @returns {SignedSyncMutation} - Normalized signed mutation.
 */
function normalizeSignedSyncMutation(signedMutation) {
    if (!signedMutation || typeof signedMutation !== "object" || Array.isArray(signedMutation))
        throw new Error("Expected signed sync mutation object");
    if (signedMutation.algorithm !== ECDSA_P256_SHA256_ALGORITHM)
        throw new Error(`Unsupported sync mutation algorithm '${String(signedMutation.algorithm)}'`);
    return {
        algorithm: signedMutation.algorithm,
        deviceCertificate: normalizeDeviceCertificate(signedMutation.deviceCertificate),
        mutation: normalizeSyncMutation(signedMutation.mutation),
        signature: normalizeSignature(signedMutation.signature, "sync mutation signature")
    };
}
/**
 * Normalizes a sync mutation payload.
 * @param {SyncMutation} mutation - Mutation payload.
 * @returns {SyncMutation} - Normalized mutation payload.
 */
function normalizeSyncMutation(mutation) {
    if (!mutation || typeof mutation !== "object" || Array.isArray(mutation))
        throw new Error("Expected sync mutation object");
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
    };
    if (mutation.attributes !== undefined)
        normalized.attributes = deterministicJsonObject({ label: "attributes", value: mutation.attributes });
    if (mutation.baseVersion !== undefined)
        normalized.baseVersion = /** @type {string | number | null} */ (deterministicJson({ label: "baseVersion", value: mutation.baseVersion }));
    if (mutation.command !== undefined)
        normalized.command = requiredString(mutation.command, "command");
    if (mutation.payload !== undefined)
        normalized.payload = deterministicJsonObject({ label: "payload", value: mutation.payload });
    return normalized;
}
/**
 * Asserts that mutation actor fields match the certificate actor.
 * @param {object} args - Arguments.
 * @param {DeviceCertificatePayload} args.certificate - Device certificate payload.
 * @param {SyncMutation} args.mutation - Mutation payload.
 * @returns {void} - No return value.
 */
function assertMutationMatchesCertificate({ certificate, mutation }) {
    if (mutation.actorDeviceId !== certificate.actorDeviceId || mutation.actorUserId !== certificate.actorUserId) {
        throw new Error("Sync mutation actor does not match device certificate");
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
function assertNotExpired({ expiresAt, label, now }) {
    if (Number.isNaN(now.getTime()))
        throw new Error("Invalid sync verification time");
    if (new Date(expiresAt).getTime() <= now.getTime())
        throw new Error(`${label} expired`);
}
/**
 * Normalizes a JSON Web Key object.
 * @param {SyncJsonWebKey} key - JWK.
 * @param {string} label - Key label.
 * @returns {SyncJsonWebKey} - Normalized JWK.
 */
function normalizeJwk(key, label) {
    const normalized = deterministicJsonObject({ label, value: key });
    return /** @type {SyncJsonWebKey} */ (normalized);
}
/**
 * Normalizes a prefixed signature string.
 * @param {unknown} signature - Signature value.
 * @param {string} label - Error label.
 * @returns {string} - Signature string.
 */
function normalizeSignature(signature, label) {
    if (typeof signature !== "string" || !signature.startsWith(ECDSA_P256_SHA256_SIGNATURE_PREFIX))
        throw new Error(`Expected ${label}`);
    return signature;
}
/**
 * Removes the signature prefix.
 * @param {string} signature - Prefixed signature.
 * @returns {string} - Base64url signature body.
 */
function signatureWithoutPrefix(signature) {
    return signature.slice(ECDSA_P256_SHA256_SIGNATURE_PREFIX.length);
}
/**
 * Requires a non-empty string field.
 * @param {unknown} value - Value.
 * @param {string} name - Field name.
 * @returns {string} - String value.
 */
function requiredString(value, name) {
    if (typeof value !== "string" || value.length < 1)
        throw new Error(`Expected sync ${name}`);
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
        throw new Error(`Invalid sync ${label}`);
    return date.toISOString();
}
/**
 * Returns encoded UTF-8 bytes for a string.
 * @param {string} value - String value.
 * @returns {Uint8Array} - UTF-8 bytes.
 */
function utf8(value) {
    return new TextEncoder().encode(value);
}
/**
 * Returns WebCrypto subtle API.
 * @returns {SubtleCrypto} - SubtleCrypto implementation.
 */
function cryptoSubtle() {
    if (!globalThis.crypto?.subtle)
        throw new Error("WebCrypto subtle API is required for sync signing");
    return globalThis.crypto.subtle;
}
/**
 * Base64url-encodes bytes.
 * @param {Uint8Array} bytes - Bytes.
 * @returns {string} - Base64url string.
 */
function base64UrlEncode(bytes) {
    let binary = "";
    for (const byte of bytes)
        binary += String.fromCharCode(byte);
    return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
/**
 * Base64url-decodes bytes.
 * @param {string} value - Base64url string.
 * @returns {Uint8Array} - Bytes.
 */
function base64UrlDecode(value) {
    const base64 = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(base64);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
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
        throw new Error(`Expected sync ${label} object`);
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
    if (Array.isArray(value))
        return value.map((entry, index) => deterministicJson({ label: `${label}/${index}`, value: entry }));
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
    throw new Error(`Sync ${label} must be deterministic JSON`);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGV2aWNlLWlkZW50aXR5LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3N5bmMvZGV2aWNlLWlkZW50aXR5LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBOzs7R0FHRztBQUNIOzs7Ozs7Ozs7R0FTRztBQUNIOzs7Ozs7R0FNRztBQUNIOzs7Ozs7Ozs7Ozs7Ozs7R0FlRztBQUNIOzs7Ozs7O0dBT0c7QUFDSCxZQUFZO0FBRVosTUFBTSwyQkFBMkIsR0FBRyxtQkFBbUIsQ0FBQTtBQUN2RCxNQUFNLGtDQUFrQyxHQUFHLG9CQUFvQixDQUFBO0FBRS9EOzs7R0FHRztBQUNILE1BQU0sQ0FBQyxLQUFLLFVBQVUsMEJBQTBCO0lBQzlDLE1BQU0sT0FBTyxHQUFHLE1BQU0sWUFBWSxFQUFFLENBQUMsV0FBVyxDQUM5QyxFQUFDLElBQUksRUFBRSxPQUFPLEVBQUUsVUFBVSxFQUFFLE9BQU8sRUFBQyxFQUNwQyxJQUFJLEVBQ0osQ0FBQyxNQUFNLEVBQUUsUUFBUSxDQUFDLENBQ25CLENBQUE7SUFFRCxPQUFPO1FBQ0wsVUFBVSxFQUFFLE1BQU0sWUFBWSxFQUFFLENBQUMsU0FBUyxDQUFDLEtBQUssRUFBRSxPQUFPLENBQUMsVUFBVSxDQUFDO1FBQ3JFLFNBQVMsRUFBRSxNQUFNLFlBQVksRUFBRSxDQUFDLFNBQVMsQ0FBQyxLQUFLLEVBQUUsT0FBTyxDQUFDLFNBQVMsQ0FBQztLQUNwRSxDQUFBO0FBQ0gsQ0FBQztBQUVEOzs7Ozs7R0FNRztBQUNILE1BQU0sQ0FBQyxLQUFLLFVBQVUsdUJBQXVCLENBQUMsRUFBQyxpQkFBaUIsRUFBRSxXQUFXLEVBQUM7SUFDNUUsTUFBTSxxQkFBcUIsR0FBRyxpQ0FBaUMsQ0FBQyxXQUFXLENBQUMsQ0FBQTtJQUU1RSxPQUFPO1FBQ0wsU0FBUyxFQUFFLDJCQUEyQjtRQUN0QyxXQUFXLEVBQUUscUJBQXFCO1FBQ2xDLFNBQVMsRUFBRSxNQUFNLGNBQWMsQ0FBQztZQUM5QixVQUFVLEVB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QU0sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUMsSUFBSSxFQUFFLEVBQUUsQ0FBQztZQUM1QyxNQUFNLFVBQVUsR0FBRyxzQ0FBc0MsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFBO1lBRXRFLElBQUksVUFBVSxLQUFLLFNBQVM7Z0JBQUUsU0FBUTtZQUN0QyxVQUFVLENBQUMsR0FBRyxDQUFDLEdBQUcsaUJBQWlCLENBQUMsRUFBQyxLQUFLLEVBQUUsR0FBRyxLQUFLLElBQUksR0FBRyxFQUFFLEVBQUUsS0FBSyxFQUFFLFVBQVUsRUFBQyxDQUFDLENBQUE7UUFDcEYsQ0FBQztRQUVELE9BQU8sVUFBVSxDQUFBO0lBQ25CLENBQUM7SUFFRCxNQUFNLElBQUksS0FBSyxDQUFDLFFBQVEsS0FBSyw2QkFBNkIsQ0FBQyxDQUFBO0FBQzdELENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEpTT04gV2ViIEtleSB1c2VkIGJ5IHRoZSBzeW5jIHNpZ25pbmcgaGVscGVycy5cbiAqIEB0eXBlZGVmIHtpbXBvcnQoXCJub2RlOmNyeXB0b1wiKS53ZWJjcnlwdG8uSnNvbldlYktleX0gU3luY0pzb25XZWJLZXlcbiAqL1xuLyoqXG4gKiBCYWNrZW5kLXNpZ25lZCBkZXZpY2UgY2VydGlmaWNhdGUgcGF5bG9hZC5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IERldmljZUNlcnRpZmljYXRlUGF5bG9hZFxuICogQHByb3BlcnR5IHtzdHJpbmd9IGFjdG9yRGV2aWNlSWQgLSBEZXZpY2UgaWQgYWxsb3dlZCB0byBzaWduIG11dGF0aW9ucy5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBhY3RvclVzZXJJZCAtIFVzZXIgaWQgcmVwcmVzZW50ZWQgYnkgdGhlIGRldmljZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBjZXJ0aWZpY2F0ZUlkIC0gQ2VydGlmaWNhdGUgaWQuXG4gKiBAcHJvcGVydHkge1N5bmNKc29uV2ViS2V5fSBkZXZpY2VQdWJsaWNLZXkgLSBEZXZpY2UgcHVibGljIGtleSBwZWVycy9iYWNrZW5kcyB1c2UgdG8gdmVyaWZ5IG11dGF0aW9ucy5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBleHBpcmVzQXQgLSBJU08gdGltZXN0YW1wIGFmdGVyIHdoaWNoIHRoZSBjZXJ0aWZpY2F0ZSBpcyBpbnZhbGlkLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGlzc3VlZEF0IC0gSVNPIHRpbWVzdGFtcCB3aGVuIHRoZSBiYWNrZW5kIGlzc3VlZCB0aGUgY2VydGlmaWNhdGUuXG4gKi9cbi8qKlxuICogQmFja2VuZC1zaWduZWQgZGV2aWNlIGNlcnRpZmljYXRlIGVudmVsb3BlLlxuICogQHR5cGVkZWYge29iamVjdH0gRGV2aWNlQ2VydGlmaWNhdGVcbiAqIEBwcm9wZXJ0eSB7XCJFQ0RTQS1QMjU2LVNIQTI1NlwifSBhbGdvcml0aG0gLSBTaWduYXR1cmUgYWxnb3JpdGhtLlxuICogQHByb3BlcnR5IHtEZXZpY2VDZXJ0aWZpY2F0ZVBheWxvYWR9IGNlcnRpZmljYXRlIC0gQ2VydGlmaWNhdGUgcGF5bG9hZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBzaWduYXR1cmUgLSBCYWNrZW5kIHNpZ25hdHVyZSBvdmVyIHRoZSBjZXJ0aWZpY2F0ZSBwYXlsb2FkLlxuICovXG4vKipcbiAqIFN5bmMgbXV0YXRpb24gcGF5bG9hZCBzaWduZWQgYnkgYSBkZXZpY2UuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBTeW5jTXV0YXRpb25cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBhY3RvckRldmljZUlkIC0gRGV2aWNlIHRoYXQgc2lnbmVkIHRoZSBtdXRhdGlvbi5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBhY3RvclVzZXJJZCAtIFVzZXIgcmVwcmVzZW50ZWQgYnkgdGhlIHNpZ25pbmcgZGV2aWNlLlxuICogQHByb3BlcnR5IHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxTeW5jSnNvblZhbHVlPn0gW2F0dHJpYnV0ZXNdIC0gTW9kZWwgYXR0cmlidXRlcyBmb3IgQ1JVRCBtdXRhdGlvbnMuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IG51bWJlciB8IG51bGx9IFtiYXNlVmVyc2lvbl0gLSBCYXNlIHNlcnZlci9jbGllbnQgdmVyc2lvbi5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBjbGllbnRNdXRhdGlvbklkIC0gRGV2aWNlLWxvY2FsIGlkZW1wb3RlbmN5IGlkLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtjb21tYW5kXSAtIERvbWFpbiBjb21tYW5kIG5hbWUgZm9yIGNvbW1hbmQgbXV0YXRpb25zLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IG1vZGVsIC0gU3luYyBtb2RlbC9yZXNvdXJjZSBuYW1lLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IG9jY3VycmVkQXQgLSBJU08gdGltZXN0YW1wIHdoZW4gdGhlIG11dGF0aW9uIG9jY3VycmVkLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IG9mZmxpbmVHcmFudElkIC0gT2ZmbGluZSBncmFudCBpZCBhdXRob3JpemluZyB0aGUgbXV0YXRpb24uXG4gKiBAcHJvcGVydHkge3N0cmluZ30gb3BlcmF0aW9uIC0gQ1JVRCBvcGVyYXRpb24gb3IgY29tbWFuZCBvcGVyYXRpb24uXG4gKiBAcHJvcGVydHkge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFN5bmNKc29uVmFsdWU+fSBbcGF5bG9hZF0gLSBEb21haW4gY29tbWFuZCBwYXlsb2FkLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHBvbGljeUhhc2ggLSBTeW5jIHBvbGljeSBoYXNoIHRoZSBtdXRhdGlvbiB3YXMgY2hlY2tlZCBhZ2FpbnN0LlxuICovXG4vKipcbiAqIERldmljZS1zaWduZWQgbXV0YXRpb24gZW52ZWxvcGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBTaWduZWRTeW5jTXV0YXRpb25cbiAqIEBwcm9wZXJ0eSB7XCJFQ0RTQS1QMjU2LVNIQTI1NlwifSBhbGdvcml0aG0gLSBTaWduYXR1cmUgYWxnb3JpdGhtLlxuICogQHByb3BlcnR5IHtEZXZpY2VDZXJ0aWZpY2F0ZX0gZGV2aWNlQ2VydGlmaWNhdGUgLSBCYWNrZW5kLXNpZ25lZCBkZXZpY2UgY2VydGlmaWNhdGUuXG4gKiBAcHJvcGVydHkge1N5bmNNdXRhdGlvbn0gbXV0YXRpb24gLSBNdXRhdGlvbiBwYXlsb2FkLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHNpZ25hdHVyZSAtIERldmljZSBzaWduYXR1cmUgb3ZlciB0aGUgbXV0YXRpb24gZW52ZWxvcGUuXG4gKi9cbi8vIEB0cy1jaGVja1xuXG5jb25zdCBFQ0RTQV9QMjU2X1NIQTI1Nl9BTEdPUklUSE0gPSBcIkVDRFNBLVAyNTYtU0hBMjU2XCJcbmNvbnN0IEVDRFNBX1AyNTZfU0hBMjU2X1NJR05BVFVSRV9QUkVGSVggPSBcImVjZHNhLXAyNTYtc2hhMjU2LVwiXG5cbi8qKlxuICogR2VuZXJhdGVzIGFuIEVDRFNBIFAtMjU2IGtleXBhaXIgZXhwb3J0ZWQgYXMgSldLcy5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHtwcml2YXRlS2V5OiBTeW5jSnNvbldlYktleSwgcHVibGljS2V5OiBTeW5jSnNvbldlYktleX0+fSAtIEV4cG9ydGVkIGtleXBhaXIuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBnZW5lcmF0ZVN5bmNTaWduaW5nS2V5UGFpcigpIHtcbiAgY29uc3Qga2V5UGFpciA9IGF3YWl0IGNyeXB0b1N1YnRsZSgpLmdlbmVyYXRlS2V5KFxuICAgIHtuYW1lOiBcIkVDRFNBXCIsIG5hbWVkQ3VydmU6IFwiUC0yNTZcIn0sXG4gICAgdHJ1ZSxcbiAgICBbXCJzaWduXCIsIFwidmVyaWZ5XCJdXG4gIClcblxuICByZXR1cm4ge1xuICAgIHByaXZhdGVLZXk6IGF3YWl0IGNyeXB0b1N1YnRsZSgpLmV4cG9ydEtleShcImp3a1wiLCBrZXlQYWlyLnByaXZhdGVLZXkpLFxuICAgIHB1YmxpY0tleTogYXdhaXQgY3J5cHRvU3VidGxlKCkuZXhwb3J0S2V5KFwiandrXCIsIGtleVBhaXIucHVibGljS2V5KVxuICB9XG59XG5cbi8qKlxuICogQ3JlYXRlcyBhIGJhY2tlbmQtc2lnbmVkIGRldmljZSBjZXJ0aWZpY2F0ZS5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICogQHBhcmFtIHtTeW5jSnNvbldlYktleX0gYXJncy5iYWNrZW5kUHJpdmF0ZUtleSAtIEJhY2tlbmQgcHJpdmF0ZSBzaWduaW5nIGtleS5cbiAqIEBwYXJhbSB7RGV2aWNlQ2VydGlmaWNhdGVQYXlsb2FkfSBhcmdzLmNlcnRpZmljYXRlIC0gQ2VydGlmaWNhdGUgcGF5bG9hZC5cbiAqIEByZXR1cm5zIHtQcm9taXNlPERldmljZUNlcnRpZmljYXRlPn0gLSBTaWduZWQgY2VydGlmaWNhdGUuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBjcmVhdGVEZXZpY2VDZXJ0aWZpY2F0ZSh7YmFja2VuZFByaXZhdGVLZXksIGNlcnRpZmljYXRlfSkge1xuICBjb25zdCBub3JtYWxpemVkQ2VydGlmaWNhdGUgPSBub3JtYWxpemVEZXZpY2VDZXJ0aWZpY2F0ZVBheWxvYWQoY2VydGlmaWNhdGUpXG5cbiAgcmV0dXJuIHtcbiAgICBhbGdvcml0aG06IEVDRFNBX1AyNTZfU0hBMjU2X0FMR09SSVRITSxcbiAgICBjZXJ0aWZpY2F0ZTogbm9ybWFsaXplZENlcnRpZmljYXRlLFxuICAgIHNpZ25hdHVyZTogYXdhaXQgc2lnblN0YWJsZUpzb24oe1xuICAgICAgcHJpdmF0ZUtleTogYmFja2VuZFByaXZhdGVLZXksXG4gICAgICB2YWx1ZTogZGV2aWNlQ2VydGlmaWNhdGVTaWduYXR1cmVWYWx1ZShub3JtYWxpemVkQ2VydGlmaWNhdGUpXG4gICAgfSlcbiAgfVxufVxuXG4vKipcbiAqIFZlcmlmaWVzIGEgYmFja2VuZC1zaWduZWQgZGV2aWNlIGNlcnRpZmljYXRlLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gKiBAcGFyYW0ge1N5bmNKc29uV2ViS2V5fSBhcmdzLmJhY2tlbmRQdWJsaWNLZXkgLSBCYWNrZW5kIHB1YmxpYyBrZXkuXG4gKiBAcGFyYW0ge0RldmljZUNlcnRpZmljYXRlfSBhcmdzLmNlcnRpZmljYXRlIC0gU2lnbmVkIGNlcnRpZmljYXRlLlxuICogQHBhcmFtIHtEYXRlfSBbYXJncy5ub3ddIC0gVmVyaWZpY2F0aW9uIHRpbWUuIERlZmF1bHRzIHRvIGN1cnJlbnQgdGltZS5cbiAqIEByZXR1cm5zIHtQcm9taXNlPERldmljZUNlcnRpZmljYXRlUGF5bG9hZD59IC0gVmVyaWZpZWQgY2VydGlmaWNhdGUgcGF5bG9hZC5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHZlcmlmeURldmljZUNlcnRpZmljYXRlKHtiYWNrZW5kUHVibGljS2V5LCBjZXJ0aWZpY2F0ZSwgbm93ID0gbmV3IERhdGUoKX0pIHtcbiAgY29uc3Qgbm9ybWFsaXplZENlcnRpZmljYXRlID0gbm9ybWFsaXplRGV2aWNlQ2VydGlmaWNhdGUoY2VydGlmaWNhdGUpXG4gIGNvbnN0IHZlcmlmaWVkID0gYXdhaXQgdmVyaWZ5U3RhYmxlSnNvblNpZ25hdHVyZSh7XG4gICAgcHVibGljS2V5OiBiYWNrZW5kUHVibGljS2V5LFxuICAgIHNpZ25hdHVyZTogbm9ybWFsaXplZENlcnRpZmljYXRlLnNpZ25hdHVyZSxcbiAgICB2YWx1ZTogZGV2aWNlQ2VydGlmaWNhdGVTaWduYXR1cmVWYWx1ZShub3JtYWxpemVkQ2VydGlmaWNhdGUuY2VydGlmaWNhdGUpXG4gIH0pXG5cbiAgaWYgKCF2ZXJpZmllZCkgdGhyb3cgbmV3IEVycm9yKFwiRGV2aWNlIGNlcnRpZmljYXRlIHNpZ25hdHVyZSBkaWQgbm90IG1hdGNoXCIpXG4gIGFzc2VydE5vdEV4cGlyZWQoe2V4cGlyZXNBdDogbm9ybWFsaXplZENlcnRpZmljYXRlLmNlcnRpZmljYXRlLmV4cGlyZXNBdCwgbGFiZWw6IFwiRGV2aWNlIGNlcnRpZmljYXRlXCIsIG5vd30pXG5cbiAgcmV0dXJuIG5vcm1hbGl6ZWRDZXJ0aWZpY2F0ZS5jZXJ0aWZpY2F0ZVxufVxuXG4vKipcbiAqIENyZWF0ZXMgYSBkZXZpY2Utc2lnbmVkIG11dGF0aW9uIGVudmVsb3BlLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gKiBAcGFyYW0ge0RldmljZUNlcnRpZmljYXRlfSBhcmdzLmRldmljZUNlcnRpZmljYXRlIC0gQmFja2VuZC1zaWduZWQgZGV2aWNlIGNlcnRpZmljYXRlLlxuICogQHBhcmFtIHtTeW5jSnNvbldlYktleX0gYXJncy5kZXZpY2VQcml2YXRlS2V5IC0gRGV2aWNlIHByaXZhdGUgc2lnbmluZyBrZXkuXG4gKiBAcGFyYW0ge1N5bmNNdXRhdGlvbn0gYXJncy5tdXRhdGlvbiAtIE11dGF0aW9uIHBheWxvYWQuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxTaWduZWRTeW5jTXV0YXRpb24+fSAtIFNpZ25lZCBtdXRhdGlvbi5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGNyZWF0ZVNpZ25lZE11dGF0aW9uKHtkZXZpY2VDZXJ0aWZpY2F0ZSwgZGV2aWNlUHJpdmF0ZUtleSwgbXV0YXRpb259KSB7XG4gIGNvbnN0IG5vcm1hbGl6ZWREZXZpY2VDZXJ0aWZpY2F0ZSA9IG5vcm1hbGl6ZURldmljZUNlcnRpZmljYXRlKGRldmljZUNlcnRpZmljYXRlKVxuICBjb25zdCBub3JtYWxpemVkTXV0YXRpb24gPSBub3JtYWxpemVTeW5jTXV0YXRpb24obXV0YXRpb24pXG5cbiAgYXNzZXJ0TXV0YXRpb25NYXRjaGVzQ2VydGlmaWNhdGUoe2NlcnRpZmljYXRlOiBub3JtYWxpemVkRGV2aWNlQ2VydGlmaWNhdGUuY2VydGlmaWNhdGUsIG11dGF0aW9uOiBub3JtYWxpemVkTXV0YXRpb259KVxuXG4gIHJldHVybiB7XG4gICAgYWxnb3JpdGhtOiBFQ0RTQV9QMjU2X1NIQTI1Nl9BTEdPUklUSE0sXG4gICAgZGV2aWNlQ2VydGlmaWNhdGU6IG5vcm1hbGl6ZWREZXZpY2VDZXJ0aWZpY2F0ZSxcbiAgICBtdXRhdGlvbjogbm9ybWFsaXplZE11dGF0aW9uLFxuICAgIHNpZ25hdHVyZTogYXdhaXQgc2lnblN0YWJsZUpzb24oe1xuICAgICAgcHJpdmF0ZUtleTogZGV2aWNlUHJpdmF0ZUtleSxcbiAgICAgIHZhbHVlOiBzaWduZWRNdXRhdGlvblNpZ25hdHVyZVZhbHVlKHtcbiAgICAgICAgZGV2aWNlQ2VydGlmaWNhdGU6IG5vcm1hbGl6ZWREZXZpY2VDZXJ0aWZpY2F0ZSxcbiAgICAgICAgbXV0YXRpb246IG5vcm1hbGl6ZWRNdXRhdGlvblxuICAgICAgfSlcbiAgICB9KVxuICB9XG59XG5cbi8qKlxuICogVmVyaWZpZXMgYSBzaWduZWQgc3luYyBtdXRhdGlvbiBhbmQgaXRzIGRldmljZSBjZXJ0aWZpY2F0ZS5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICogQHBhcmFtIHtTeW5jSnNvbldlYktleX0gYXJncy5iYWNrZW5kUHVibGljS2V5IC0gQmFja2VuZCBwdWJsaWMga2V5IHVzZWQgdG8gdmVyaWZ5IHRoZSBkZXZpY2UgY2VydGlmaWNhdGUuXG4gKiBAcGFyYW0ge0RhdGV9IFthcmdzLm5vd10gLSBWZXJpZmljYXRpb24gdGltZS4gRGVmYXVsdHMgdG8gY3VycmVudCB0aW1lLlxuICogQHBhcmFtIHtTaWduZWRTeW5jTXV0YXRpb259IGFyZ3Muc2lnbmVkTXV0YXRpb24gLSBTaWduZWQgbXV0YXRpb24gZW52ZWxvcGUuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxTeW5jTXV0YXRpb24+fSAtIFZlcmlmaWVkIG11dGF0aW9uIHBheWxvYWQuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiB2ZXJpZnlTaWduZWRNdXRhdGlvbih7YmFja2VuZFB1YmxpY0tleSwgbm93ID0gbmV3IERhdGUoKSwgc2lnbmVkTXV0YXRpb259KSB7XG4gIGNvbnN0IG5vcm1hbGl6ZWRTaWduZWRNdXRhdGlvbiA9IG5vcm1hbGl6ZVNpZ25lZFN5bmNNdXRhdGlvbihzaWduZWRNdXRhdGlvbilcbiAgY29uc3QgY2VydGlmaWNhdGVQYXlsb2FkID0gYXdhaXQgdmVyaWZ5RGV2aWNlQ2VydGlmaWNhdGUoe1xuICAgIGJhY2tlbmRQdWJsaWNLZXksXG4gICAgY2VydGlmaWNhdGU6IG5vcm1hbGl6ZWRTaWduZWRNdXRhdGlvbi5kZXZpY2VDZXJ0aWZpY2F0ZSxcbiAgICBub3dcbiAgfSlcblxuICBhc3NlcnRNdXRhdGlvbk1hdGNoZXNDZXJ0aWZpY2F0ZSh7Y2VydGlmaWNhdGU6IGNlcnRpZmljYXRlUGF5bG9hZCwgbXV0YXRpb246IG5vcm1hbGl6ZWRTaWduZWRNdXRhdGlvbi5tdXRhdGlvbn0pXG5cbiAgY29uc3QgdmVyaWZpZWQgPSBhd2FpdCB2ZXJpZnlTdGFibGVKc29uU2lnbmF0dXJlKHtcbiAgICBwdWJsaWNLZXk6IGNlcnRpZmljYXRlUGF5bG9hZC5kZXZpY2VQdWJsaWNLZXksXG4gICAgc2lnbmF0dXJlOiBub3JtYWxpemVkU2lnbmVkTXV0YXRpb24uc2lnbmF0dXJlLFxuICAgIHZhbHVlOiBzaWduZWRNdXRhdGlvblNpZ25hdHVyZVZhbHVlKHtcbiAgICAgIGRldmljZUNlcnRpZmljYXRlOiBub3JtYWxpemVkU2lnbmVkTXV0YXRpb24uZGV2aWNlQ2VydGlmaWNhdGUsXG4gICAgICBtdXRhdGlvbjogbm9ybWFsaXplZFNpZ25lZE11dGF0aW9uLm11dGF0aW9uXG4gICAgfSlcbiAgfSlcblxuICBpZiAoIXZlcmlmaWVkKSB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jIG11dGF0aW9uIHNpZ25hdHVyZSBkaWQgbm90IG1hdGNoXCIpXG5cbiAgcmV0dXJuIG5vcm1hbGl6ZWRTaWduZWRNdXRhdGlvbi5tdXRhdGlvblxufVxuXG4vKipcbiAqIFJldHVybnMgdGhlIHJlcGxheS9pZGVtcG90ZW5jeSBrZXkgZm9yIGEgc2lnbmVkIG11dGF0aW9uLlxuICogQHBhcmFtIHt7bXV0YXRpb246IHthY3RvckRldmljZUlkPzogdW5rbm93biwgYWN0b3JVc2VySWQ/OiB1bmtub3duLCBjbGllbnRNdXRhdGlvbklkPzogdW5rbm93bn19fSBzaWduZWRNdXRhdGlvbiAtIFNpZ25lZCBtdXRhdGlvbi1saWtlIG9iamVjdC5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gSWRlbXBvdGVuY3kga2V5LlxuICovXG5leHBvcnQgZnVuY3Rpb24gbXV0YXRpb25JZGVtcG90ZW5jeUtleShzaWduZWRNdXRhdGlvbikge1xuICBjb25zdCBtdXRhdGlvbiA9IHNpZ25lZE11dGF0aW9uLm11dGF0aW9uXG5cbiAgcmV0dXJuIFtcbiAgICByZXF1aXJlZFN0cmluZyhtdXRhdGlvbi5hY3RvclVzZXJJZCwgXCJhY3RvclVzZXJJZFwiKSxcbiAgICByZXF1aXJlZFN0cmluZyhtdXRhdGlvbi5hY3RvckRldmljZUlkLCBcImFjdG9yRGV2aWNlSWRcIiksXG4gICAgcmVxdWlyZWRTdHJpbmcobXV0YXRpb24uY2xpZW50TXV0YXRpb25JZCwgXCJjbGllbnRNdXRhdGlvbklkXCIpXG4gIF0uam9pbihcIjpcIilcbn1cblxuLyoqXG4gKiBCdWlsZHMgdGhlIHN0YWJsZSB2YWx1ZSBzaWduZWQgYnkgYmFja2VuZCBkZXZpY2UgY2VydGlmaWNhdGVzLlxuICogQHBhcmFtIHtEZXZpY2VDZXJ0aWZpY2F0ZVBheWxvYWR9IGNlcnRpZmljYXRlIC0gQ2VydGlmaWNhdGUgcGF5bG9hZC5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxTeW5jSnNvblZhbHVlPn0gLSBTdGFibGUgc2lnbmF0dXJlIHZhbHVlLlxuICovXG5mdW5jdGlvbiBkZXZpY2VDZXJ0aWZpY2F0ZVNpZ25hdHVyZVZhbHVlKGNlcnRpZmljYXRlKSB7XG4gIHJldHVybiB7XG4gICAgYWxnb3JpdGhtOiBFQ0RTQV9QMjU2X1NIQTI1Nl9BTEdPUklUSE0sXG4gICAgY2VydGlmaWNhdGU6IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsU3luY0pzb25WYWx1ZT59ICovIChkZXRlcm1pbmlzdGljSnNvbk9iamVjdCh7bGFiZWw6IFwiY2VydGlmaWNhdGVcIiwgdmFsdWU6IGNlcnRpZmljYXRlfSkpXG4gIH1cbn1cblxuLyoqXG4gKiBCdWlsZHMgdGhlIHN0YWJsZSB2YWx1ZSBzaWduZWQgYnkgc3luYyBtdXRhdGlvbnMuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAqIEBwYXJhbSB7RGV2aWNlQ2VydGlmaWNhdGV9IGFyZ3MuZGV2aWNlQ2VydGlmaWNhdGUgLSBEZXZpY2UgY2VydGlmaWNhdGUuXG4gKiBAcGFyYW0ge1N5bmNNdXRhdGlvbn0gYXJncy5tdXRhdGlvbiAtIE11dGF0aW9uIHBheWxvYWQuXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsU3luY0pzb25WYWx1ZT59IC0gU3RhYmxlIHNpZ25hdHVyZSB2YWx1ZS5cbiAqL1xuZnVuY3Rpb24gc2lnbmVkTXV0YXRpb25TaWduYXR1cmVWYWx1ZSh7ZGV2aWNlQ2VydGlmaWNhdGUsIG11dGF0aW9ufSkge1xuICByZXR1cm4ge1xuICAgIGFsZ29yaXRobTogRUNEU0FfUDI1Nl9TSEEyNTZfQUxHT1JJVEhNLFxuICAgIGRldmljZUNlcnRpZmljYXRlOiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFN5bmNKc29uVmFsdWU+fSAqLyAoZGV0ZXJtaW5pc3RpY0pzb25PYmplY3Qoe2xhYmVsOiBcImRldmljZUNlcnRpZmljYXRlXCIsIHZhbHVlOiBkZXZpY2VDZXJ0aWZpY2F0ZX0pKSxcbiAgICBtdXRhdGlvbjogLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxTeW5jSnNvblZhbHVlPn0gKi8gKGRldGVybWluaXN0aWNKc29uT2JqZWN0KHtsYWJlbDogXCJtdXRhdGlvblwiLCB2YWx1ZTogbXV0YXRpb259KSlcbiAgfVxufVxuXG4vKipcbiAqIFNpZ25zIGEgZGV0ZXJtaW5pc3RpYyBKU09OIHZhbHVlIHdpdGggRUNEU0EgUC0yNTYvU0hBLTI1Ni5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICogQHBhcmFtIHtTeW5jSnNvbldlYktleX0gYXJncy5wcml2YXRlS2V5IC0gUHJpdmF0ZSBKV0suXG4gKiBAcGFyYW0ge3Vua25vd259IGFyZ3MudmFsdWUgLSBWYWx1ZSB0byBzaWduLlxuICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gLSBQcmVmaXhlZCBiYXNlNjR1cmwgc2lnbmF0dXJlLlxuICovXG5hc3luYyBmdW5jdGlvbiBzaWduU3RhYmxlSnNvbih7cHJpdmF0ZUtleSwgdmFsdWV9KSB7XG4gIGNvbnN0IGtleSA9IGF3YWl0IGNyeXB0b1N1YnRsZSgpLmltcG9ydEtleShcImp3a1wiLCBwcml2YXRlS2V5LCB7bmFtZTogXCJFQ0RTQVwiLCBuYW1lZEN1cnZlOiBcIlAtMjU2XCJ9LCBmYWxzZSwgW1wic2lnblwiXSlcbiAgY29uc3Qgc2lnbmF0dXJlID0gYXdhaXQgY3J5cHRvU3VidGxlKCkuc2lnbih7aGFzaDogXCJTSEEtMjU2XCIsIG5hbWU6IFwiRUNEU0FcIn0sIGtleSwgLyoqIEB0eXBlIHtVaW50OEFycmF5PEFycmF5QnVmZmVyPn0gKi8gKHV0Zjgoc3RhYmxlSnNvblN0cmluZ2lmeSh2YWx1ZSkpKSlcblxuICByZXR1cm4gYCR7RUNEU0FfUDI1Nl9TSEEyNTZfU0lHTkFUVVJFX1BSRUZJWH0ke2Jhc2U2NFVybEVuY29kZShuZXcgVWludDhBcnJheShzaWduYXR1cmUpKX1gXG59XG5cbi8qKlxuICogVmVyaWZpZXMgYSBkZXRlcm1pbmlzdGljIEpTT04gdmFsdWUgd2l0aCBFQ0RTQSBQLTI1Ni9TSEEtMjU2LlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gKiBAcGFyYW0ge1N5bmNKc29uV2ViS2V5fSBhcmdzLnB1YmxpY0tleSAtIFB1YmxpYyBKV0suXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zaWduYXR1cmUgLSBQcmVmaXhlZCBiYXNlNjR1cmwgc2lnbmF0dXJlLlxuICogQHBhcmFtIHt1bmtub3dufSBhcmdzLnZhbHVlIC0gVmFsdWUgdG8gdmVyaWZ5LlxuICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgc2lnbmF0dXJlIG1hdGNoZXMuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHZlcmlmeVN0YWJsZUpzb25TaWduYXR1cmUoe3B1YmxpY0tleSwgc2lnbmF0dXJlLCB2YWx1ZX0pIHtcbiAgY29uc3Qga2V5ID0gYXdhaXQgY3J5cHRvU3VidGxlKCkuaW1wb3J0S2V5KFwiandrXCIsIHB1YmxpY0tleSwge25hbWU6IFwiRUNEU0FcIiwgbmFtZWRDdXJ2ZTogXCJQLTI1NlwifSwgZmFsc2UsIFtcInZlcmlmeVwiXSlcbiAgY29uc3Qgc2lnbmF0dXJlQnl0ZXMgPSBiYXNlNjRVcmxEZWNvZGUoc2lnbmF0dXJlV2l0aG91dFByZWZpeChzaWduYXR1cmUpKVxuXG4gIHJldHVybiBhd2FpdCBjcnlwdG9TdWJ0bGUoKS52ZXJpZnkoe2hhc2g6IFwiU0hBLTI1NlwiLCBuYW1lOiBcIkVDRFNBXCJ9LCBrZXksIC8qKiBAdHlwZSB7VWludDhBcnJheTxBcnJheUJ1ZmZlcj59ICovIChzaWduYXR1cmVCeXRlcyksIC8qKiBAdHlwZSB7VWludDhBcnJheTxBcnJheUJ1ZmZlcj59ICovICh1dGY4KHN0YWJsZUpzb25TdHJpbmdpZnkodmFsdWUpKSkpXG59XG5cbi8qKlxuICogTm9ybWFsaXplcyBhIHNpZ25lZCBkZXZpY2UgY2VydGlmaWNhdGUgZW52ZWxvcGUuXG4gKiBAcGFyYW0ge0RldmljZUNlcnRpZmljYXRlfSBjZXJ0aWZpY2F0ZSAtIFNpZ25lZCBjZXJ0aWZpY2F0ZS5cbiAqIEByZXR1cm5zIHtEZXZpY2VDZXJ0aWZpY2F0ZX0gLSBOb3JtYWxpemVkIGNlcnRpZmljYXRlLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVEZXZpY2VDZXJ0aWZpY2F0ZShjZXJ0aWZpY2F0ZSkge1xuICBpZiAoIWNlcnRpZmljYXRlIHx8IHR5cGVvZiBjZXJ0aWZpY2F0ZSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KGNlcnRpZmljYXRlKSkgdGhyb3cgbmV3IEVycm9yKFwiRXhwZWN0ZWQgZGV2aWNlIGNlcnRpZmljYXRlIG9iamVjdFwiKVxuICBpZiAoY2VydGlmaWNhdGUuYWxnb3JpdGhtICE9PSBFQ0RTQV9QMjU2X1NIQTI1Nl9BTEdPUklUSE0pIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgZGV2aWNlIGNlcnRpZmljYXRlIGFsZ29yaXRobSAnJHtTdHJpbmcoY2VydGlmaWNhdGUuYWxnb3JpdGhtKX0nYClcblxuICByZXR1cm4ge1xuICAgIGFsZ29yaXRobTogY2VydGlmaWNhdGUuYWxnb3JpdGhtLFxuICAgIGNlcnRpZmljYXRlOiBub3JtYWxpemVEZXZpY2VDZXJ0aWZpY2F0ZVBheWxvYWQoY2VydGlmaWNhdGUuY2VydGlmaWNhdGUpLFxuICAgIHNpZ25hdHVyZTogbm9ybWFsaXplU2lnbmF0dXJlKGNlcnRpZmljYXRlLnNpZ25hdHVyZSwgXCJkZXZpY2UgY2VydGlmaWNhdGUgc2lnbmF0dXJlXCIpXG4gIH1cbn1cblxuLyoqXG4gKiBOb3JtYWxpemVzIGEgZGV2aWNlIGNlcnRpZmljYXRlIHBheWxvYWQuXG4gKiBAcGFyYW0ge0RldmljZUNlcnRpZmljYXRlUGF5bG9hZH0gY2VydGlmaWNhdGUgLSBDZXJ0aWZpY2F0ZSBwYXlsb2FkLlxuICogQHJldHVybnMge0RldmljZUNlcnRpZmljYXRlUGF5bG9hZH0gLSBOb3JtYWxpemVkIGNlcnRpZmljYXRlIHBheWxvYWQuXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZURldmljZUNlcnRpZmljYXRlUGF5bG9hZChjZXJ0aWZpY2F0ZSkge1xuICBpZiAoIWNlcnRpZmljYXRlIHx8IHR5cGVvZiBjZXJ0aWZpY2F0ZSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KGNlcnRpZmljYXRlKSkgdGhyb3cgbmV3IEVycm9yKFwiRXhwZWN0ZWQgZGV2aWNlIGNlcnRpZmljYXRlIHBheWxvYWQgb2JqZWN0XCIpXG5cbiAgcmV0dXJuIHtcbiAgICBhY3RvckRldmljZUlkOiByZXF1aXJlZFN0cmluZyhjZXJ0aWZpY2F0ZS5hY3RvckRldmljZUlkLCBcImFjdG9yRGV2aWNlSWRcIiksXG4gICAgYWN0b3JVc2VySWQ6IHJlcXVpcmVkU3RyaW5nKGNlcnRpZmljYXRlLmFjdG9yVXNlcklkLCBcImFjdG9yVXNlcklkXCIpLFxuICAgIGNlcnRpZmljYXRlSWQ6IHJlcXVpcmVkU3RyaW5nKGNlcnRpZmljYXRlLmNlcnRpZmljYXRlSWQsIFwiY2VydGlmaWNhdGVJZFwiKSxcbiAgICBkZXZpY2VQdWJsaWNLZXk6IG5vcm1hbGl6ZUp3ayhjZXJ0aWZpY2F0ZS5kZXZpY2VQdWJsaWNLZXksIFwiZGV2aWNlUHVibGljS2V5XCIpLFxuICAgIGV4cGlyZXNBdDogaXNvRGF0ZVN0cmluZyhuZXcgRGF0ZShyZXF1aXJlZFN0cmluZyhjZXJ0aWZpY2F0ZS5leHBpcmVzQXQsIFwiZXhwaXJlc0F0XCIpKSwgXCJleHBpcmVzQXRcIiksXG4gICAgaXNzdWVkQXQ6IGlzb0RhdGVTdHJpbmcobmV3IERhdGUocmVxdWlyZWRTdHJpbmcoY2VydGlmaWNhdGUuaXNzdWVkQXQsIFwiaXNzdWVkQXRcIikpLCBcImlzc3VlZEF0XCIpXG4gIH1cbn1cblxuLyoqXG4gKiBOb3JtYWxpemVzIGEgc2lnbmVkIHN5bmMgbXV0YXRpb24gZW52ZWxvcGUuXG4gKiBAcGFyYW0ge1NpZ25lZFN5bmNNdXRhdGlvbn0gc2lnbmVkTXV0YXRpb24gLSBTaWduZWQgbXV0YXRpb24uXG4gKiBAcmV0dXJucyB7U2lnbmVkU3luY011dGF0aW9ufSAtIE5vcm1hbGl6ZWQgc2lnbmVkIG11dGF0aW9uLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVTaWduZWRTeW5jTXV0YXRpb24oc2lnbmVkTXV0YXRpb24pIHtcbiAgaWYgKCFzaWduZWRNdXRhdGlvbiB8fCB0eXBlb2Ygc2lnbmVkTXV0YXRpb24gIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShzaWduZWRNdXRhdGlvbikpIHRocm93IG5ldyBFcnJvcihcIkV4cGVjdGVkIHNpZ25lZCBzeW5jIG11dGF0aW9uIG9iamVjdFwiKVxuICBpZiAoc2lnbmVkTXV0YXRpb24uYWxnb3JpdGhtICE9PSBFQ0RTQV9QMjU2X1NIQTI1Nl9BTEdPUklUSE0pIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgc3luYyBtdXRhdGlvbiBhbGdvcml0aG0gJyR7U3RyaW5nKHNpZ25lZE11dGF0aW9uLmFsZ29yaXRobSl9J2ApXG5cbiAgcmV0dXJuIHtcbiAgICBhbGdvcml0aG06IHNpZ25lZE11dGF0aW9uLmFsZ29yaXRobSxcbiAgICBkZXZpY2VDZXJ0aWZpY2F0ZTogbm9ybWFsaXplRGV2aWNlQ2VydGlmaWNhdGUoc2lnbmVkTXV0YXRpb24uZGV2aWNlQ2VydGlmaWNhdGUpLFxuICAgIG11dGF0aW9uOiBub3JtYWxpemVTeW5jTXV0YXRpb24oc2lnbmVkTXV0YXRpb24ubXV0YXRpb24pLFxuICAgIHNpZ25hdHVyZTogbm9ybWFsaXplU2lnbmF0dXJlKHNpZ25lZE11dGF0aW9uLnNpZ25hdHVyZSwgXCJzeW5jIG11dGF0aW9uIHNpZ25hdHVyZVwiKVxuICB9XG59XG5cbi8qKlxuICogTm9ybWFsaXplcyBhIHN5bmMgbXV0YXRpb24gcGF5bG9hZC5cbiAqIEBwYXJhbSB7U3luY011dGF0aW9ufSBtdXRhdGlvbiAtIE11dGF0aW9uIHBheWxvYWQuXG4gKiBAcmV0dXJucyB7U3luY011dGF0aW9ufSAtIE5vcm1hbGl6ZWQgbXV0YXRpb24gcGF5bG9hZC5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplU3luY011dGF0aW9uKG11dGF0aW9uKSB7XG4gIGlmICghbXV0YXRpb24gfHwgdHlwZW9mIG11dGF0aW9uICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkobXV0YXRpb24pKSB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RlZCBzeW5jIG11dGF0aW9uIG9iamVjdFwiKVxuXG4gIC8qKiBAdHlwZSB7U3luY011dGF0aW9ufSAqL1xuICBjb25zdCBub3JtYWxpemVkID0ge1xuICAgIGFjdG9yRGV2aWNlSWQ6IHJlcXVpcmVkU3RyaW5nKG11dGF0aW9uLmFjdG9yRGV2aWNlSWQsIFwiYWN0b3JEZXZpY2VJZFwiKSxcbiAgICBhY3RvclVzZXJJZDogcmVxdWlyZWRTdHJpbmcobXV0YXRpb24uYWN0b3JVc2VySWQsIFwiYWN0b3JVc2VySWRcIiksXG4gICAgY2xpZW50TXV0YXRpb25JZDogcmVxdWlyZWRTdHJpbmcobXV0YXRpb24uY2xpZW50TXV0YXRpb25JZCwgXCJjbGllbnRNdXRhdGlvbklkXCIpLFxuICAgIG1vZGVsOiByZXF1aXJlZFN0cmluZyhtdXRhdGlvbi5tb2RlbCwgXCJtb2RlbFwiKSxcbiAgICBvY2N1cnJlZEF0OiBpc29EYXRlU3RyaW5nKG5ldyBEYXRlKHJlcXVpcmVkU3RyaW5nKG11dGF0aW9uLm9jY3VycmVkQXQsIFwib2NjdXJyZWRBdFwiKSksIFwib2NjdXJyZWRBdFwiKSxcbiAgICBvZmZsaW5lR3JhbnRJZDogcmVxdWlyZWRTdHJpbmcobXV0YXRpb24ub2ZmbGluZUdyYW50SWQsIFwib2ZmbGluZUdyYW50SWRcIiksXG4gICAgb3BlcmF0aW9uOiByZXF1aXJlZFN0cmluZyhtdXRhdGlvbi5vcGVyYXRpb24sIFwib3BlcmF0aW9uXCIpLFxuICAgIHBvbGljeUhhc2g6IHJlcXVpcmVkU3RyaW5nKG11dGF0aW9uLnBvbGljeUhhc2gsIFwicG9saWN5SGFzaFwiKVxuICB9XG5cbiAgaWYgKG11dGF0aW9uLmF0dHJpYnV0ZXMgIT09IHVuZGVmaW5lZCkgbm9ybWFsaXplZC5hdHRyaWJ1dGVzID0gZGV0ZXJtaW5pc3RpY0pzb25PYmplY3Qoe2xhYmVsOiBcImF0dHJpYnV0ZXNcIiwgdmFsdWU6IG11dGF0aW9uLmF0dHJpYnV0ZXN9KVxuICBpZiAobXV0YXRpb24uYmFzZVZlcnNpb24gIT09IHVuZGVmaW5lZCkgbm9ybWFsaXplZC5iYXNlVmVyc2lvbiA9IC8qKiBAdHlwZSB7c3RyaW5nIHwgbnVtYmVyIHwgbnVsbH0gKi8gKGRldGVybWluaXN0aWNKc29uKHtsYWJlbDogXCJiYXNlVmVyc2lvblwiLCB2YWx1ZTogbXV0YXRpb24uYmFzZVZlcnNpb259KSlcbiAgaWYgKG11dGF0aW9uLmNvbW1hbmQgIT09IHVuZGVmaW5lZCkgbm9ybWFsaXplZC5jb21tYW5kID0gcmVxdWlyZWRTdHJpbmcobXV0YXRpb24uY29tbWFuZCwgXCJjb21tYW5kXCIpXG4gIGlmIChtdXRhdGlvbi5wYXlsb2FkICE9PSB1bmRlZmluZWQpIG5vcm1hbGl6ZWQucGF5bG9hZCA9IGRldGVybWluaXN0aWNKc29uT2JqZWN0KHtsYWJlbDogXCJwYXlsb2FkXCIsIHZhbHVlOiBtdXRhdGlvbi5wYXlsb2FkfSlcblxuICByZXR1cm4gbm9ybWFsaXplZFxufVxuXG4vKipcbiAqIEFzc2VydHMgdGhhdCBtdXRhdGlvbiBhY3RvciBmaWVsZHMgbWF0Y2ggdGhlIGNlcnRpZmljYXRlIGFjdG9yLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gKiBAcGFyYW0ge0RldmljZUNlcnRpZmljYXRlUGF5bG9hZH0gYXJncy5jZXJ0aWZpY2F0ZSAtIERldmljZSBjZXJ0aWZpY2F0ZSBwYXlsb2FkLlxuICogQHBhcmFtIHtTeW5jTXV0YXRpb259IGFyZ3MubXV0YXRpb24gLSBNdXRhdGlvbiBwYXlsb2FkLlxuICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICovXG5mdW5jdGlvbiBhc3NlcnRNdXRhdGlvbk1hdGNoZXNDZXJ0aWZpY2F0ZSh7Y2VydGlmaWNhdGUsIG11dGF0aW9ufSkge1xuICBpZiAobXV0YXRpb24uYWN0b3JEZXZpY2VJZCAhPT0gY2VydGlmaWNhdGUuYWN0b3JEZXZpY2VJZCB8fCBtdXRhdGlvbi5hY3RvclVzZXJJZCAhPT0gY2VydGlmaWNhdGUuYWN0b3JVc2VySWQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jIG11dGF0aW9uIGFjdG9yIGRvZXMgbm90IG1hdGNoIGRldmljZSBjZXJ0aWZpY2F0ZVwiKVxuICB9XG59XG5cbi8qKlxuICogQXNzZXJ0cyBhIHRpbWVzdGFtcCBpcyBub3QgZXhwaXJlZC5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuZXhwaXJlc0F0IC0gRXhwaXJ5IHRpbWVzdGFtcC5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmxhYmVsIC0gRXJyb3IgbGFiZWwuXG4gKiBAcGFyYW0ge0RhdGV9IGFyZ3Mubm93IC0gVmVyaWZpY2F0aW9uIHRpbWUuXG4gKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIGFzc2VydE5vdEV4cGlyZWQoe2V4cGlyZXNBdCwgbGFiZWwsIG5vd30pIHtcbiAgaWYgKE51bWJlci5pc05hTihub3cuZ2V0VGltZSgpKSkgdGhyb3cgbmV3IEVycm9yKFwiSW52YWxpZCBzeW5jIHZlcmlmaWNhdGlvbiB0aW1lXCIpXG4gIGlmIChuZXcgRGF0ZShleHBpcmVzQXQpLmdldFRpbWUoKSA8PSBub3cuZ2V0VGltZSgpKSB0aHJvdyBuZXcgRXJyb3IoYCR7bGFiZWx9IGV4cGlyZWRgKVxufVxuXG4vKipcbiAqIE5vcm1hbGl6ZXMgYSBKU09OIFdlYiBLZXkgb2JqZWN0LlxuICogQHBhcmFtIHtTeW5jSnNvbldlYktleX0ga2V5IC0gSldLLlxuICogQHBhcmFtIHtzdHJpbmd9IGxhYmVsIC0gS2V5IGxhYmVsLlxuICogQHJldHVybnMge1N5bmNKc29uV2ViS2V5fSAtIE5vcm1hbGl6ZWQgSldLLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVKd2soa2V5LCBsYWJlbCkge1xuICBjb25zdCBub3JtYWxpemVkID0gZGV0ZXJtaW5pc3RpY0pzb25PYmplY3Qoe2xhYmVsLCB2YWx1ZToga2V5fSlcblxuICByZXR1cm4gLyoqIEB0eXBlIHtTeW5jSnNvbldlYktleX0gKi8gKG5vcm1hbGl6ZWQpXG59XG5cbi8qKlxuICogTm9ybWFsaXplcyBhIHByZWZpeGVkIHNpZ25hdHVyZSBzdHJpbmcuXG4gKiBAcGFyYW0ge3Vua25vd259IHNpZ25hdHVyZSAtIFNpZ25hdHVyZSB2YWx1ZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBsYWJlbCAtIEVycm9yIGxhYmVsLlxuICogQHJldHVybnMge3N0cmluZ30gLSBTaWduYXR1cmUgc3RyaW5nLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVTaWduYXR1cmUoc2lnbmF0dXJlLCBsYWJlbCkge1xuICBpZiAodHlwZW9mIHNpZ25hdHVyZSAhPT0gXCJzdHJpbmdcIiB8fCAhc2lnbmF0dXJlLnN0YXJ0c1dpdGgoRUNEU0FfUDI1Nl9TSEEyNTZfU0lHTkFUVVJFX1BSRUZJWCkpIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgJHtsYWJlbH1gKVxuXG4gIHJldHVybiBzaWduYXR1cmVcbn1cblxuLyoqXG4gKiBSZW1vdmVzIHRoZSBzaWduYXR1cmUgcHJlZml4LlxuICogQHBhcmFtIHtzdHJpbmd9IHNpZ25hdHVyZSAtIFByZWZpeGVkIHNpZ25hdHVyZS5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gQmFzZTY0dXJsIHNpZ25hdHVyZSBib2R5LlxuICovXG5mdW5jdGlvbiBzaWduYXR1cmVXaXRob3V0UHJlZml4KHNpZ25hdHVyZSkge1xuICByZXR1cm4gc2lnbmF0dXJlLnNsaWNlKEVDRFNBX1AyNTZfU0hBMjU2X1NJR05BVFVSRV9QUkVGSVgubGVuZ3RoKVxufVxuXG4vKipcbiAqIFJlcXVpcmVzIGEgbm9uLWVtcHR5IHN0cmluZyBmaWVsZC5cbiAqIEBwYXJhbSB7dW5rbm93bn0gdmFsdWUgLSBWYWx1ZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gRmllbGQgbmFtZS5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU3RyaW5nIHZhbHVlLlxuICovXG5mdW5jdGlvbiByZXF1aXJlZFN0cmluZyh2YWx1ZSwgbmFtZSkge1xuICBpZiAodHlwZW9mIHZhbHVlICE9PSBcInN0cmluZ1wiIHx8IHZhbHVlLmxlbmd0aCA8IDEpIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgc3luYyAke25hbWV9YClcblxuICByZXR1cm4gdmFsdWVcbn1cblxuLyoqXG4gKiBOb3JtYWxpemVzIGEgRGF0ZSB0byBhbiBJU08gdGltZXN0YW1wLlxuICogQHBhcmFtIHtEYXRlfSBkYXRlIC0gRGF0ZSB2YWx1ZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBsYWJlbCAtIEZpZWxkIGxhYmVsLlxuICogQHJldHVybnMge3N0cmluZ30gLSBJU08gdGltZXN0YW1wLlxuICovXG5mdW5jdGlvbiBpc29EYXRlU3RyaW5nKGRhdGUsIGxhYmVsKSB7XG4gIGlmIChOdW1iZXIuaXNOYU4oZGF0ZS5nZXRUaW1lKCkpKSB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgc3luYyAke2xhYmVsfWApXG5cbiAgcmV0dXJuIGRhdGUudG9JU09TdHJpbmcoKVxufVxuXG4vKipcbiAqIFJldHVybnMgZW5jb2RlZCBVVEYtOCBieXRlcyBmb3IgYSBzdHJpbmcuXG4gKiBAcGFyYW0ge3N0cmluZ30gdmFsdWUgLSBTdHJpbmcgdmFsdWUuXG4gKiBAcmV0dXJucyB7VWludDhBcnJheX0gLSBVVEYtOCBieXRlcy5cbiAqL1xuZnVuY3Rpb24gdXRmOCh2YWx1ZSkge1xuICByZXR1cm4gbmV3IFRleHRFbmNvZGVyKCkuZW5jb2RlKHZhbHVlKVxufVxuXG4vKipcbiAqIFJldHVybnMgV2ViQ3J5cHRvIHN1YnRsZSBBUEkuXG4gKiBAcmV0dXJucyB7U3VidGxlQ3J5cHRvfSAtIFN1YnRsZUNyeXB0byBpbXBsZW1lbnRhdGlvbi5cbiAqL1xuZnVuY3Rpb24gY3J5cHRvU3VidGxlKCkge1xuICBpZiAoIWdsb2JhbFRoaXMuY3J5cHRvPy5zdWJ0bGUpIHRocm93IG5ldyBFcnJvcihcIldlYkNyeXB0byBzdWJ0bGUgQVBJIGlzIHJlcXVpcmVkIGZvciBzeW5jIHNpZ25pbmdcIilcblxuICByZXR1cm4gZ2xvYmFsVGhpcy5jcnlwdG8uc3VidGxlXG59XG5cbi8qKlxuICogQmFzZTY0dXJsLWVuY29kZXMgYnl0ZXMuXG4gKiBAcGFyYW0ge1VpbnQ4QXJyYXl9IGJ5dGVzIC0gQnl0ZXMuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIEJhc2U2NHVybCBzdHJpbmcuXG4gKi9cbmZ1bmN0aW9uIGJhc2U2NFVybEVuY29kZShieXRlcykge1xuICBsZXQgYmluYXJ5ID0gXCJcIlxuXG4gIGZvciAoY29uc3QgYnl0ZSBvZiBieXRlcykgYmluYXJ5ICs9IFN0cmluZy5mcm9tQ2hhckNvZGUoYnl0ZSlcblxuICByZXR1cm4gYnRvYShiaW5hcnkpLnJlcGxhY2VBbGwoXCIrXCIsIFwiLVwiKS5yZXBsYWNlQWxsKFwiL1wiLCBcIl9cIikucmVwbGFjZUFsbChcIj1cIiwgXCJcIilcbn1cblxuLyoqXG4gKiBCYXNlNjR1cmwtZGVjb2RlcyBieXRlcy5cbiAqIEBwYXJhbSB7c3RyaW5nfSB2YWx1ZSAtIEJhc2U2NHVybCBzdHJpbmcuXG4gKiBAcmV0dXJucyB7VWludDhBcnJheX0gLSBCeXRlcy5cbiAqL1xuZnVuY3Rpb24gYmFzZTY0VXJsRGVjb2RlKHZhbHVlKSB7XG4gIGNvbnN0IGJhc2U2NCA9IHZhbHVlLnJlcGxhY2VBbGwoXCItXCIsIFwiK1wiKS5yZXBsYWNlQWxsKFwiX1wiLCBcIi9cIikucGFkRW5kKE1hdGguY2VpbCh2YWx1ZS5sZW5ndGggLyA0KSAqIDQsIFwiPVwiKVxuICBjb25zdCBiaW5hcnkgPSBhdG9iKGJhc2U2NClcblxuICByZXR1cm4gVWludDhBcnJheS5mcm9tKGJpbmFyeSwgKGNoYXIpID0+IGNoYXIuY2hhckNvZGVBdCgwKSlcbn1cblxuLyoqXG4gKiBTdGFibGUgSlNPTiBzdHJpbmdpZmllciB3aXRoIHNvcnRlZCBvYmplY3Qga2V5cy5cbiAqIEBwYXJhbSB7dW5rbm93bn0gdmFsdWUgLSBWYWx1ZS5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gSlNPTiBzdHJpbmcuXG4gKi9cbmZ1bmN0aW9uIHN0YWJsZUpzb25TdHJpbmdpZnkodmFsdWUpIHtcbiAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KGRldGVybWluaXN0aWNKc29uKHtsYWJlbDogXCJyb290XCIsIHZhbHVlfSkpXG59XG5cbi8qKlxuICogTm9ybWFsaXplcyBhIHZhbHVlIGFzIGEgSlNPTiBvYmplY3QuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmxhYmVsIC0gRGlhZ25vc3RpYyBsYWJlbC5cbiAqIEBwYXJhbSB7dW5rbm93bn0gYXJncy52YWx1ZSAtIFZhbHVlLlxuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFN5bmNKc29uVmFsdWU+fSAtIEpTT04gb2JqZWN0LlxuICovXG5mdW5jdGlvbiBkZXRlcm1pbmlzdGljSnNvbk9iamVjdCh7bGFiZWwsIHZhbHVlfSkge1xuICBjb25zdCBub3JtYWxpemVkID0gZGV0ZXJtaW5pc3RpY0pzb24oe2xhYmVsLCB2YWx1ZX0pXG5cbiAgaWYgKCFub3JtYWxpemVkIHx8IHR5cGVvZiBub3JtYWxpemVkICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkobm9ybWFsaXplZCkpIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgc3luYyAke2xhYmVsfSBvYmplY3RgKVxuXG4gIHJldHVybiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFN5bmNKc29uVmFsdWU+fSAqLyAobm9ybWFsaXplZClcbn1cblxuLyoqXG4gKiBOb3JtYWxpemVzIGRldGVybWluaXN0aWMgSlNPTiB3aXRoIHNvcnRlZCBvYmplY3Qga2V5cy5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubGFiZWwgLSBEaWFnbm9zdGljIGxhYmVsLlxuICogQHBhcmFtIHt1bmtub3dufSBhcmdzLnZhbHVlIC0gVmFsdWUuXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsU3luY0pzb25WYWx1ZX0gLSBOb3JtYWxpemVkIEpTT04gdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIGRldGVybWluaXN0aWNKc29uKHtsYWJlbCwgdmFsdWV9KSB7XG4gIGlmICh2YWx1ZSA9PT0gbnVsbCB8fCB0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIgfHwgdHlwZW9mIHZhbHVlID09PSBcIm51bWJlclwiIHx8IHR5cGVvZiB2YWx1ZSA9PT0gXCJib29sZWFuXCIpIHJldHVybiB2YWx1ZVxuXG4gIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkgcmV0dXJuIHZhbHVlLm1hcCgoZW50cnksIGluZGV4KSA9PiBkZXRlcm1pbmlzdGljSnNvbih7bGFiZWw6IGAke2xhYmVsfS8ke2luZGV4fWAsIHZhbHVlOiBlbnRyeX0pKVxuXG4gIGlmICh2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09IFwib2JqZWN0XCIgJiYgT2JqZWN0LmdldFByb3RvdHlwZU9mKHZhbHVlKSA9PT0gT2JqZWN0LnByb3RvdHlwZSkge1xuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsU3luY0pzb25WYWx1ZT59ICovXG4gICAgY29uc3Qgbm9ybWFsaXplZCA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IGtleSBvZiBPYmplY3Qua2V5cyh2YWx1ZSkuc29ydCgpKSB7XG4gICAgICBjb25zdCBjaGlsZFZhbHVlID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn0gKi8gKHZhbHVlKVtrZXldXG5cbiAgICAgIGlmIChjaGlsZFZhbHVlID09PSB1bmRlZmluZWQpIGNvbnRpbnVlXG4gICAgICBub3JtYWxpemVkW2tleV0gPSBkZXRlcm1pbmlzdGljSnNvbih7bGFiZWw6IGAke2xhYmVsfS8ke2tleX1gLCB2YWx1ZTogY2hpbGRWYWx1ZX0pXG4gICAgfVxuXG4gICAgcmV0dXJuIG5vcm1hbGl6ZWRcbiAgfVxuXG4gIHRocm93IG5ldyBFcnJvcihgU3luYyAke2xhYmVsfSBtdXN0IGJlIGRldGVybWluaXN0aWMgSlNPTmApXG59XG4iXX0=