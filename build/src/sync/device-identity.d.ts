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
export type SyncJsonWebKey = import("node:crypto").webcrypto.JsonWebKey;
export type DeviceCertificatePayload = {
    /**
     * - Device id allowed to sign mutations.
     */
    actorDeviceId: string;
    /**
     * - User id represented by the device.
     */
    actorUserId: string;
    /**
     * - Certificate id.
     */
    certificateId: string;
    /**
     * - Device public key peers/backends use to verify mutations.
     */
    devicePublicKey: SyncJsonWebKey;
    /**
     * - ISO timestamp after which the certificate is invalid.
     */
    expiresAt: string;
    /**
     * - ISO timestamp when the backend issued the certificate.
     */
    issuedAt: string;
};
export type DeviceCertificate = {
    /**
     * - Signature algorithm.
     */
    algorithm: "ECDSA-P256-SHA256";
    /**
     * - Certificate payload.
     */
    certificate: DeviceCertificatePayload;
    /**
     * - Backend signature over the certificate payload.
     */
    signature: string;
};
export type SyncMutation = {
    /**
     * - Device that signed the mutation.
     */
    actorDeviceId: string;
    /**
     * - User represented by the signing device.
     */
    actorUserId: string;
    /**
     * - Model attributes for CRUD mutations.
     */
    attributes?: Record<string, import("../configuration-types.js").FrontendModelSyncJsonValue>;
    /**
     * - Base server/client version.
     */
    baseVersion?: string | number | null;
    /**
     * - Device-local idempotency id.
     */
    clientMutationId: string;
    /**
     * - Domain command name for command mutations.
     */
    command?: string;
    /**
     * - Sync model/resource name.
     */
    model: string;
    /**
     * - ISO timestamp when the mutation occurred.
     */
    occurredAt: string;
    /**
     * - Offline grant id authorizing the mutation.
     */
    offlineGrantId: string;
    /**
     * - CRUD operation or command operation.
     */
    operation: string;
    /**
     * - Domain command payload.
     */
    payload?: Record<string, import("../configuration-types.js").FrontendModelSyncJsonValue>;
    /**
     * - Sync policy hash the mutation was checked against.
     */
    policyHash: string;
};
export type SignedSyncMutation = {
    /**
     * - Signature algorithm.
     */
    algorithm: "ECDSA-P256-SHA256";
    /**
     * - Backend-signed device certificate.
     */
    deviceCertificate: DeviceCertificate;
    /**
     * - Mutation payload.
     */
    mutation: SyncMutation;
    /**
     * - Device signature over the mutation envelope.
     */
    signature: string;
};
/**
 * Generates an ECDSA P-256 keypair exported as JWKs.
 * @returns {Promise<{privateKey: SyncJsonWebKey, publicKey: SyncJsonWebKey}>} - Exported keypair.
 */
export declare function generateSyncSigningKeyPair(): Promise<{
    privateKey: SyncJsonWebKey;
    publicKey: SyncJsonWebKey;
}>;
/**
 * Creates a backend-signed device certificate.
 * @param {object} args - Arguments.
 * @param {SyncJsonWebKey} args.backendPrivateKey - Backend private signing key.
 * @param {DeviceCertificatePayload} args.certificate - Certificate payload.
 * @returns {Promise<DeviceCertificate>} - Signed certificate.
 */
export declare function createDeviceCertificate({ backendPrivateKey, certificate }: {
    backendPrivateKey: SyncJsonWebKey;
    certificate: DeviceCertificatePayload;
}): Promise<DeviceCertificate>;
/**
 * Verifies a backend-signed device certificate.
 * @param {object} args - Arguments.
 * @param {SyncJsonWebKey} args.backendPublicKey - Backend public key.
 * @param {DeviceCertificate} args.certificate - Signed certificate.
 * @param {Date} [args.now] - Verification time. Defaults to current time.
 * @returns {Promise<DeviceCertificatePayload>} - Verified certificate payload.
 */
export declare function verifyDeviceCertificate({ backendPublicKey, certificate, now }: {
    backendPublicKey: SyncJsonWebKey;
    certificate: DeviceCertificate;
    now?: Date;
}): Promise<DeviceCertificatePayload>;
/**
 * Creates a device-signed mutation envelope.
 * @param {object} args - Arguments.
 * @param {DeviceCertificate} args.deviceCertificate - Backend-signed device certificate.
 * @param {SyncJsonWebKey} args.devicePrivateKey - Device private signing key.
 * @param {SyncMutation} args.mutation - Mutation payload.
 * @returns {Promise<SignedSyncMutation>} - Signed mutation.
 */
export declare function createSignedMutation({ deviceCertificate, devicePrivateKey, mutation }: {
    deviceCertificate: DeviceCertificate;
    devicePrivateKey: SyncJsonWebKey;
    mutation: SyncMutation;
}): Promise<SignedSyncMutation>;
/**
 * Verifies a signed sync mutation and its device certificate.
 * @param {object} args - Arguments.
 * @param {SyncJsonWebKey} args.backendPublicKey - Backend public key used to verify the device certificate.
 * @param {Date} [args.now] - Verification time. Defaults to current time.
 * @param {SignedSyncMutation} args.signedMutation - Signed mutation envelope.
 * @returns {Promise<SyncMutation>} - Verified mutation payload.
 */
export declare function verifySignedMutation({ backendPublicKey, now, signedMutation }: {
    backendPublicKey: SyncJsonWebKey;
    now?: Date;
    signedMutation: SignedSyncMutation;
}): Promise<SyncMutation>;
/**
 * Returns the replay/idempotency key for a signed mutation.
 * @param {{mutation: {actorDeviceId?: unknown, actorUserId?: unknown, clientMutationId?: unknown}}} signedMutation - Signed mutation-like object.
 * @returns {string} - Idempotency key.
 */
export declare function mutationIdempotencyKey(signedMutation: {
    mutation: {
        actorDeviceId?: unknown;
        actorUserId?: unknown;
        clientMutationId?: unknown;
    };
}): string;
//# sourceMappingURL=device-identity.d.ts.map