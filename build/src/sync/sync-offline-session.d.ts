export type SyncOfflineDeviceIdentity = {
    /**
     * - Backend-signed device certificate.
     */
    certificate: import("./device-identity.js").DeviceCertificate;
    /**
     * - Device private signing key (JWK).
     */
    privateKey: import("./device-identity.js").SyncJsonWebKey;
};
export type SyncOfflineReplayResult = {
    /**
     * - Records left in `conflict`.
     */
    conflictCount: number;
    /**
     * - Records still pending (blocked dependencies or unacknowledged).
     */
    pendingCount: number;
    /**
     * - Records the backend rejected.
     */
    rejectedCount: number;
    /**
     * - Per-mutation mapped results in replay order.
     */
    results: Array<{
        clientMutationId: string;
        idempotencyKey: string;
        mutation: import("./device-identity.js").SyncMutation;
        recordId: string;
        serverResult: Record<string, ReturnType<typeof JSON.parse>> | null;
        status: import("./local-mutation-log.js").LocalMutationStatus;
    }>;
    /**
     * - Records acknowledged by the backend.
     */
    syncedCount: number;
};
export type SyncOfflineSessionSummary = {
    /**
     * - Certificate device identity.
     */
    actorDeviceId: string;
    /**
     * - Certificate user identity.
     */
    actorUserId: string;
    /**
     * - Live grant expiry.
     */
    expiresAt: string;
    /**
     * - Live grant id.
     */
    grantId: string;
};
/**
 * Stored device signing identity: the backend-signed certificate plus the
 * device private key matching the certificate's public key.
 * @typedef {object} SyncOfflineDeviceIdentity
 * @property {import("./device-identity.js").DeviceCertificate} certificate - Backend-signed device certificate.
 * @property {import("./device-identity.js").SyncJsonWebKey} privateKey - Device private signing key (JWK).
 */
/**
 * Result of one offline session replay pass over the durable mutation logs.
 * @typedef {object} SyncOfflineReplayResult
 * @property {number} conflictCount - Records left in `conflict`.
 * @property {number} pendingCount - Records still pending (blocked dependencies or unacknowledged).
 * @property {number} rejectedCount - Records the backend rejected.
 * @property {Array<{clientMutationId: string, idempotencyKey: string, mutation: import("./device-identity.js").SyncMutation, recordId: string, serverResult: Record<string, ReturnType<typeof JSON.parse>> | null, status: import("./local-mutation-log.js").LocalMutationStatus}>} results - Per-mutation mapped results in replay order.
 * @property {number} syncedCount - Records acknowledged by the backend.
 */
/**
 * Session summary returned by start/refresh.
 * @typedef {object} SyncOfflineSessionSummary
 * @property {string} actorDeviceId - Certificate device identity.
 * @property {string} actorUserId - Certificate user identity.
 * @property {string} expiresAt - Live grant expiry.
 * @property {string} grantId - Live grant id.
 */
/**
 * Framework-owned long-offline session behind SyncClient: device identity
 * lifecycle, backend-issued offline grants, mutation signing, signed replay,
 * and peer bundle transfer. SyncClient owns the public API; this class owns the
 * session state. The app only provides durable storage adapters, the
 * enrollment hook, and the grant scopes callback.
 */
export default class SyncOfflineSession {
    authenticationToken: () => string | Promise<string>;
    config: import("../configuration-types.js").NormalizedVelociousSyncClientOfflineConfiguration;
    mutationLogs: import("./local-mutation-log.js").default[];
    post: (path: string, payload: Record<string, ReturnType<typeof JSON.parse>>, options?: {
        signal?: AbortSignal;
    }) => Promise<ReturnType<typeof JSON.parse>>;
    /** @type {SyncOfflineDeviceIdentity | null} */
    _identity: SyncOfflineDeviceIdentity | null;
    /** @type {Map<string, import("./offline-grant.js").SignedOfflineGrant>} */
    _grants: Map<string, import("./offline-grant.js").SignedOfflineGrant>;
    _grantsLoaded: boolean;
    /** @type {import("./offline-grant.js").SignedOfflineGrant | null} */
    _activeGrant: import("./offline-grant.js").SignedOfflineGrant | null;
    /** @type {Record<string, import("../configuration-types.js").NormalizedFrontendModelResourceSyncConfiguration> | null} */
    _syncManifest: Record<string, import("../configuration-types.js").NormalizedFrontendModelResourceSyncConfiguration> | null;
    /** @type {Promise<SyncOfflineSessionSummary> | null} */
    _startPromise: Promise<SyncOfflineSessionSummary> | null;
    /** @type {Promise<SyncOfflineReplayResult> | null} */
    _replayPromise: Promise<SyncOfflineReplayResult> | null;
    /**
     * Builds an offline session from the normalized `sync.client.offline` block.
     * @param {object} args - Session args.
     * @param {() => string | Promise<string>} args.authenticationToken - Resolves the auth token sent with bootstrap/replay requests.
     * @param {import("../configuration-types.js").NormalizedVelociousSyncClientOfflineConfiguration} args.config - Normalized offline configuration.
     * @param {Array<import("./local-mutation-log.js").default>} args.mutationLogs - Durable local mutation logs the session signs, replays, resigns, and exports.
     * @param {(path: string, payload: Record<string, ReturnType<typeof JSON.parse>>, options?: {signal?: AbortSignal}) => Promise<ReturnType<typeof JSON.parse>>} args.post - Framework POSTer over the configured transport.
     */
    constructor({ authenticationToken, config, mutationLogs, post }: {
        authenticationToken: () => string | Promise<string>;
        config: import("../configuration-types.js").NormalizedVelociousSyncClientOfflineConfiguration;
        mutationLogs: Array<import("./local-mutation-log.js").default>;
        post: (path: string, payload: Record<string, ReturnType<typeof JSON.parse>>, options?: {
            signal?: AbortSignal;
        }) => Promise<ReturnType<typeof JSON.parse>>;
    });
    /**
     * Whether the session currently has a usable device identity and live grant.
     * @returns {boolean} - Whether the session is active.
     */
    isActive(): boolean;
    /**
     * Resolves the device signing identity (generating and enrolling a key pair
     * when the app-owned storage has none) and bootstraps a live offline grant.
     * Idempotent and single-flighted: concurrent starts share one bootstrap.
     * @returns {Promise<SyncOfflineSessionSummary>} - Session summary.
     */
    start(): Promise<SyncOfflineSessionSummary>;
    /**
     * Drops the in-memory session (identity and grants stay in the app-owned
     * durable storage; pending mutations stay in the durable mutation logs).
     * @returns {Promise<void>} - Resolves after the session is dropped.
     */
    stop(): Promise<void>;
    /**
     * Runs one start attempt: identity first, then grant bootstrap.
     * @returns {Promise<SyncOfflineSessionSummary>} - Session summary.
     */
    _startSession(): Promise<SyncOfflineSessionSummary>;
    /**
     * Returns the current session summary.
     * @returns {SyncOfflineSessionSummary} - Session summary.
     */
    sessionSummary(): SyncOfflineSessionSummary;
    /**
     * Resolves the device identity: load it from the app-owned storage, or
     * generate a key pair, run the app-owned enrollment hook, verify the returned
     * certificate against the configured backend public key, and store it.
     * @returns {Promise<SyncOfflineDeviceIdentity>} - Device signing identity.
     */
    _ensureIdentity(): Promise<SyncOfflineDeviceIdentity>;
    /**
     * Verifies a stored/enrolled certificate against the configured backend
     * public key (when one is configured) and returns the identity.
     * @param {SyncOfflineDeviceIdentity} identity - Candidate identity.
     * @returns {Promise<SyncOfflineDeviceIdentity>} - Verified identity.
     */
    _verifiedIdentity(identity: SyncOfflineDeviceIdentity): Promise<SyncOfflineDeviceIdentity>;
    /**
     * Loads app-retained grants once so a restarted device can still replay
     * mutations that were signed under an older grant (peer-forwarded mutations
     * keep the grant their original signer used).
     * @returns {Promise<void>} - Resolves after retention is loaded.
     */
    _loadRetainedGrants(): Promise<void>;
    /**
     * Returns the active grant when it is still live, otherwise null. Expiry is
     * checked by timestamp only: the grant's HMAC signature is backend-only and
     * can never be verified on the device.
     * @param {Date} [now] - Check time.
     * @returns {import("./offline-grant.js").SignedOfflineGrant | null} - Live grant or null.
     */
    _liveGrant(now?: Date): import("./offline-grant.js").SignedOfflineGrant | null;
    /**
     * Ensures a live grant exists, bootstrapping a new one when the current grant
     * is missing or expired. A refreshed grant re-signs this device's pending
     * records so the backend always sees the grant an intent is replayed under.
     * @returns {Promise<import("./offline-grant.js").SignedOfflineGrant>} - Live grant.
     */
    _ensureLiveGrant(): Promise<import("./offline-grant.js").SignedOfflineGrant>;
    /**
     * Requests a fresh offline grant from the built-in sync bootstrap endpoint
     * and retains it under its grant id together with the sync manifest whose
     * policy hashes mutations are signed against.
     * @returns {Promise<import("./offline-grant.js").SignedOfflineGrant>} - Newly issued grant.
     */
    bootstrapGrant(): Promise<import("./offline-grant.js").SignedOfflineGrant>;
    /**
     * Forces a grant refresh: bootstrap a new grant and re-sign this device's
     * pending records under it.
     * @returns {Promise<SyncOfflineSessionSummary>} - Refreshed session summary.
     */
    refreshGrant(): Promise<SyncOfflineSessionSummary>;
    /**
     * Re-signs this device's still-pending records under a new grant. Safe
     * because the replay idempotency key is
     * `actorUserId:actorDeviceId:clientMutationId` and never carries the grant
     * id. Records signed by another device (peer-forwarded mutations) keep their
     * original signed envelope and original grant - they must always replay with
     * the grant their signer used.
     * @param {import("./offline-grant.js").SignedOfflineGrant} signedGrant - Grant the records are re-signed under.
     * @returns {Promise<void>} - Resolves after pending records are re-signed.
     */
    _resignPendingRecords(signedGrant: import("./offline-grant.js").SignedOfflineGrant): Promise<void>;
    /**
     * Checks whether a log record was signed/queued by this device's identity
     * (or has no identity yet and can adopt it).
     * @param {import("./local-mutation-log.js").LocalMutationLogRecord} record - Durable record.
     * @returns {boolean} - Whether the record belongs to this device.
     */
    _isOwnRecord(record: import("./local-mutation-log.js").LocalMutationLogRecord): boolean;
    /**
     * Signs one mutation payload with the device key under the live grant,
     * filling the actor/grant/policy-hash identity from the session.
     * @param {Omit<import("./device-identity.js").SyncMutation, "actorDeviceId" | "actorUserId" | "offlineGrantId" | "policyHash">} mutation - Mutation payload to sign (the session supplies the rotating identity fields).
     * @returns {Promise<import("./device-identity.js").SignedSyncMutation>} - Signed mutation envelope.
     */
    signMutation(mutation: Omit<import("./device-identity.js").SyncMutation, "actorDeviceId" | "actorUserId" | "offlineGrantId" | "policyHash">): Promise<import("./device-identity.js").SignedSyncMutation>;
    /**
     * Returns the grant a new mutation is signed under: the live grant when one
     * exists, otherwise the newest retained grant (queueing stays possible while
     * offline - the replay pass refreshes the grant and re-signs the pending
     * records), and only bootstraps when no grant has ever been retained.
     * @returns {Promise<import("./offline-grant.js").SignedOfflineGrant>} - Grant to sign under.
     */
    _grantForSigning(): Promise<import("./offline-grant.js").SignedOfflineGrant>;
    /**
     * Returns the policy hash the live session's sync manifest carries for one model.
     * @param {string} model - Model/resource name.
     * @returns {string} - Policy hash.
     */
    policyHashFor(model: string): string;
    /**
     * Drains the durable mutation logs through the built-in signed replay
     * endpoint. Pending records are batched, each signed mutation travels with
     * the signed grant it was signed under, and per-mutation results are mapped
     * back onto the log records as synced/conflict/rejected.
     * @param {object} [options] - Replay options.
     * @param {number} [options.batchSize] - Max mutations per request.
     * @param {AbortSignal} [options.signal] - Lifecycle cancellation signal.
     * @returns {Promise<SyncOfflineReplayResult>} - Mapped replay result.
     */
    replayPending(options?: {
        batchSize?: number;
        signal?: AbortSignal;
    }): Promise<SyncOfflineReplayResult>;
    /**
     * Runs one signed replay pass.
     * @param {object} options - Pass options.
     * @param {number} [options.batchSize] - Max mutations per request.
     * @param {AbortSignal} [options.signal] - Lifecycle cancellation signal.
     * @returns {Promise<SyncOfflineReplayResult>} - Mapped replay result.
     */
    _replayPass({ batchSize, signal }?: {
        batchSize?: number;
        signal?: AbortSignal;
    }): Promise<SyncOfflineReplayResult>;
    /**
     * Builds one signed replay mutation: the signed envelope plus the signed
     * grant the mutation was signed under. Fails closed when the session does
     * not retain that grant.
     * @param {import("./local-mutation-log.js").LocalMutationLogRecord} record - Durable record.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Replay mutation payload.
     */
    _replayMutation(record: import("./local-mutation-log.js").LocalMutationLogRecord): Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * Normalizes a signed replay response into results keyed by idempotency key.
     * @param {ReturnType<typeof JSON.parse>} response - Raw replay response.
     * @returns {Map<string, Record<string, ReturnType<typeof JSON.parse>>>} - Results by idempotency key.
     */
    _replayResultsById(response: ReturnType<typeof JSON.parse>): Map<string, Record<string, ReturnType<typeof JSON.parse>>>;
    /**
     * Exports the durable non-terminal mutations of every session log as one
     * signed peer bundle.
     * @param {object} [options] - Export options.
     * @param {import("./local-mutation-log.js").LocalMutationStatus[]} [options.statuses] - Statuses to export.
     * @param {() => Date} [options.now] - Export clock.
     * @returns {Promise<import("./peer-mutation-bundle.js").PeerMutationBundle>} - Signed peer bundle.
     */
    exportBundle(options?: {
        statuses?: import("./local-mutation-log.js").LocalMutationStatus[];
        now?: () => Date;
    }): Promise<import("./peer-mutation-bundle.js").PeerMutationBundle>;
    /**
     * Imports a peer bundle: every entry is verified against the configured
     * backend public key before it is appended to a local mutation log. Entries
     * already present by idempotency key are skipped as duplicates.
     * @param {object} args - Import args.
     * @param {import("./peer-mutation-bundle.js").PeerMutationBundle} args.bundle - Peer bundle to import.
     * @param {Array<import("./offline-grant.js").SignedOfflineGrant>} [args.signedOfflineGrants] - Grants the peer signed its mutations under. They are retained so imported mutations replay with the grant their signer used.
     * @param {import("./local-mutation-log.js").default} [args.mutationLog] - Target log. Defaults to the first session log.
     * @returns {Promise<import("./peer-mutation-bundle.js").PeerMutationBundleImportResult>} - Import result.
     */
    importBundle({ bundle, mutationLog, signedOfflineGrants }: {
        bundle: import("./peer-mutation-bundle.js").PeerMutationBundle;
        signedOfflineGrants?: Array<import("./offline-grant.js").SignedOfflineGrant>;
        mutationLog?: import("./local-mutation-log.js").default;
    }): Promise<import("./peer-mutation-bundle.js").PeerMutationBundleImportResult>;
    /**
     * Persists retained grants through the optional app-owned grant storage.
     * @returns {Promise<void>} - Resolves after retention is persisted.
     */
    _persistGrants(): Promise<void>;
    /**
     * Returns the session clock.
     * @returns {Date} - Current time.
     */
    _now(): Date;
    /**
     * Returns the device identity or fails closed.
     * @returns {SyncOfflineDeviceIdentity} - Device identity.
     */
    _requireIdentity(): SyncOfflineDeviceIdentity;
    /**
     * Returns the live grant or fails closed.
     * @returns {import("./offline-grant.js").SignedOfflineGrant} - Live grant.
     */
    _requireLiveGrant(): import("./offline-grant.js").SignedOfflineGrant;
}
//# sourceMappingURL=sync-offline-session.d.ts.map