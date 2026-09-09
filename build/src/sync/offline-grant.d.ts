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
export type SignedOfflineGrant = {
    /**
     * - Signature algorithm.
     */
    algorithm: "HS256";
    /**
     * - Signed grant payload.
     */
    grant: OfflineGrant;
    /**
     * - Signing key id.
     */
    keyId: string;
    /**
     * - Hex HMAC signature with a hmac-sha256 prefix.
     */
    signature: string;
};
export type OfflineGrant = {
    /**
     * - Device id allowed to use the grant.
     */
    deviceId: string;
    /**
     * - ISO timestamp after which replay must reject the grant.
     */
    expiresAt: string;
    /**
     * - Stable grant id.
     */
    grantId: string;
    /**
     * - ISO timestamp when the backend issued the grant.
     */
    issuedAt: string;
    /**
     * - Sync manifest/materialized resource metadata.
     */
    resources: Record<string, import("../configuration-types.js").FrontendModelSyncJsonValue>;
    /**
     * - Materialized grant scopes.
     */
    scopes: Record<string, import("../configuration-types.js").FrontendModelSyncJsonValue>;
    /**
     * - Actor user id allowed to use the grant.
     */
    userId: string;
};
export type OfflineGrantSigningKey = {
    /**
     * - Whether this is the active key for new grants.
     */
    current?: boolean;
    /**
     * - Public key id included in signed grant envelopes.
     */
    id: string;
    /**
     * - Private HMAC secret. Never expose this to clients.
     */
    secret: string;
};
/**
 * Creates a signed offline grant envelope.
 * @param {object} args - Arguments.
 * @param {OfflineGrant} args.grant - Grant payload.
 * @param {OfflineGrantSigningKey} args.signingKey - Current signing key.
 * @returns {Promise<SignedOfflineGrant>} - Signed grant envelope.
 */
export declare function createOfflineGrant({ grant, signingKey }: {
    grant: OfflineGrant;
    signingKey: OfflineGrantSigningKey;
}): Promise<SignedOfflineGrant>;
/**
 * Verifies a signed offline grant and returns the trusted grant payload.
 * @param {object} args - Arguments.
 * @param {Date} [args.now] - Verification time. Defaults to current time.
 * @param {SignedOfflineGrant} args.signedGrant - Signed grant envelope.
 * @param {OfflineGrantSigningKey[]} args.signingKeys - Candidate verification keys.
 * @returns {Promise<OfflineGrant>} - Verified grant payload.
 */
export declare function verifyOfflineGrant({ now, signedGrant, signingKeys }: {
    now?: Date;
    signedGrant: SignedOfflineGrant;
    signingKeys: OfflineGrantSigningKey[];
}): Promise<OfflineGrant>;
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
export declare function createOfflineGrantFromBootstrap({ deviceId, grantId, grantTtlMs, now, resources, scopes, signingKey, userId }: {
    deviceId: string;
    grantId?: string | undefined;
    grantTtlMs?: number | undefined;
    now: Date;
    resources: Record<string, import("../configuration-types.js").FrontendModelSyncJsonValue>;
    scopes: Record<string, import("../configuration-types.js").FrontendModelSyncJsonValue>;
    signingKey: OfflineGrantSigningKey;
    userId: string;
}): Promise<SignedOfflineGrant>;
/**
 * Normalizes an offline grant signing key.
 * @param {OfflineGrantSigningKey} signingKey - Signing key.
 * @returns {OfflineGrantSigningKey} - Normalized signing key.
 */
export declare function normalizeOfflineGrantSigningKey(signingKey: OfflineGrantSigningKey): OfflineGrantSigningKey;
/**
 * Returns the current key used to sign new grants.
 * @param {OfflineGrantSigningKey[]} signingKeys - Configured signing keys.
 * @returns {OfflineGrantSigningKey} - Current signing key.
 */
export declare function currentOfflineGrantSigningKey(signingKeys: OfflineGrantSigningKey[]): OfflineGrantSigningKey;
//# sourceMappingURL=offline-grant.d.ts.map