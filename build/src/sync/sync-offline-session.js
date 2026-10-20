// @ts-check
import { createSignedMutation, generateSyncSigningKeyPair, mutationIdempotencyKey, verifyDeviceCertificate } from "./device-identity.js";
import { exportPeerMutationBundle, importPeerMutationBundle } from "./peer-mutation-bundle.js";
import { replayResultLocalStatus } from "./conflict-strategy.js";
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
    /**
     * Builds an offline session from the normalized `sync.client.offline` block.
     * @param {object} args - Session args.
     * @param {() => string | Promise<string>} args.authenticationToken - Resolves the auth token sent with bootstrap/replay requests.
     * @param {import("../configuration-types.js").NormalizedVelociousSyncClientOfflineConfiguration} args.config - Normalized offline configuration.
     * @param {Array<import("./local-mutation-log.js").default>} args.mutationLogs - Durable local mutation logs the session signs, replays, resigns, and exports.
     * @param {(path: string, payload: Record<string, ReturnType<typeof JSON.parse>>, options?: {signal?: AbortSignal}) => Promise<ReturnType<typeof JSON.parse>>} args.post - Framework POSTer over the configured transport.
     */
    constructor({ authenticationToken, config, mutationLogs, post }) {
        if (!Array.isArray(mutationLogs) || mutationLogs.length === 0)
            throw new Error("SyncOfflineSession requires at least one mutation log");
        this.authenticationToken = authenticationToken;
        this.config = config;
        this.mutationLogs = mutationLogs;
        this.post = post;
        /** @type {SyncOfflineDeviceIdentity | null} */
        this._identity = null;
        /** @type {Map<string, import("./offline-grant.js").SignedOfflineGrant>} */
        this._grants = new Map();
        this._grantsLoaded = false;
        /** @type {import("./offline-grant.js").SignedOfflineGrant | null} */
        this._activeGrant = null;
        /** @type {Record<string, import("../configuration-types.js").NormalizedFrontendModelResourceSyncConfiguration> | null} */
        this._syncManifest = null;
        /** @type {Promise<SyncOfflineSessionSummary> | null} */
        this._startPromise = null;
        /** @type {Promise<SyncOfflineReplayResult> | null} */
        this._replayPromise = null;
    }
    /**
     * Whether the session currently has a usable device identity and live grant.
     * @returns {boolean} - Whether the session is active.
     */
    isActive() {
        return Boolean(this._identity && this._liveGrant());
    }
    /**
     * Resolves the device signing identity (generating and enrolling a key pair
     * when the app-owned storage has none) and bootstraps a live offline grant.
     * Idempotent and single-flighted: concurrent starts share one bootstrap.
     * @returns {Promise<SyncOfflineSessionSummary>} - Session summary.
     */
    async start() {
        if (this._identity && this._liveGrant())
            return this.sessionSummary();
        if (!this._startPromise) {
            this._startPromise = this._startSession().then((summary) => {
                this._startPromise = null;
                return summary;
            }, (error) => {
                this._startPromise = null;
                throw error;
            });
        }
        return await this._startPromise;
    }
    /**
     * Drops the in-memory session (identity and grants stay in the app-owned
     * durable storage; pending mutations stay in the durable mutation logs).
     * @returns {Promise<void>} - Resolves after the session is dropped.
     */
    async stop() {
        if (this._replayPromise)
            await this._replayPromise.catch(() => undefined);
        this._identity = null;
        this._activeGrant = null;
        this._syncManifest = null;
        this._grantsLoaded = false;
    }
    /**
     * Runs one start attempt: identity first, then grant bootstrap.
     * @returns {Promise<SyncOfflineSessionSummary>} - Session summary.
     */
    async _startSession() {
        await this._ensureIdentity();
        await this._loadRetainedGrants();
        await this._ensureLiveGrant();
        return this.sessionSummary();
    }
    /**
     * Returns the current session summary.
     * @returns {SyncOfflineSessionSummary} - Session summary.
     */
    sessionSummary() {
        const identity = this._requireIdentity();
        const grant = this._requireLiveGrant();
        return {
            actorDeviceId: identity.certificate.certificate.actorDeviceId,
            actorUserId: identity.certificate.certificate.actorUserId,
            expiresAt: grant.grant.expiresAt,
            grantId: grant.grant.grantId
        };
    }
    /**
     * Resolves the device identity: load it from the app-owned storage, or
     * generate a key pair, run the app-owned enrollment hook, verify the returned
     * certificate against the configured backend public key, and store it.
     * @returns {Promise<SyncOfflineDeviceIdentity>} - Device signing identity.
     */
    async _ensureIdentity() {
        if (this._identity)
            return this._identity;
        const stored = await this.config.deviceIdentityStorage.load();
        if (stored) {
            this._identity = await this._verifiedIdentity(stored);
            return this._identity;
        }
        const keyPair = await generateSyncSigningKeyPair();
        const certificate = await this.config.enrollDevice({
            configuration: this.config.configuration,
            publicKey: keyPair.publicKey
        });
        const identity = await this._verifiedIdentity({ certificate, privateKey: keyPair.privateKey });
        await this.config.deviceIdentityStorage.save(/** @type {SyncOfflineDeviceIdentity} */ (cloneJson(identity, "device identity")));
        this._identity = identity;
        return identity;
    }
    /**
     * Verifies a stored/enrolled certificate against the configured backend
     * public key (when one is configured) and returns the identity.
     * @param {SyncOfflineDeviceIdentity} identity - Candidate identity.
     * @returns {Promise<SyncOfflineDeviceIdentity>} - Verified identity.
     */
    async _verifiedIdentity(identity) {
        if (!identity || typeof identity !== "object" || Array.isArray(identity)) {
            throw new Error("sync.client.offline device identity storage must provide {certificate, privateKey} or null");
        }
        if (!identity.certificate || !identity.privateKey)
            throw new Error("sync.client.offline device identity requires a certificate and a privateKey");
        if (this.config.backendPublicKey) {
            await verifyDeviceCertificate({
                backendPublicKey: this.config.backendPublicKey,
                certificate: identity.certificate
            });
        }
        return identity;
    }
    /**
     * Loads app-retained grants once so a restarted device can still replay
     * mutations that were signed under an older grant (peer-forwarded mutations
     * keep the grant their original signer used).
     * @returns {Promise<void>} - Resolves after retention is loaded.
     */
    async _loadRetainedGrants() {
        if (this._grantsLoaded)
            return;
        this._grantsLoaded = true;
        if (!this.config.grantStorage)
            return;
        const retained = await this.config.grantStorage.load();
        if (!Array.isArray(retained))
            throw new Error("sync.client.offline grantStorage.load must resolve an array of signed offline grants");
        for (const signedGrant of retained) {
            if (!signedGrant || typeof signedGrant !== "object" || !signedGrant.grant || typeof signedGrant.grant.grantId !== "string")
                continue;
            this._grants.set(signedGrant.grant.grantId, signedGrant);
        }
    }
    /**
     * Returns the active grant when it is still live, otherwise null. Expiry is
     * checked by timestamp only: the grant's HMAC signature is backend-only and
     * can never be verified on the device.
     * @param {Date} [now] - Check time.
     * @returns {import("./offline-grant.js").SignedOfflineGrant | null} - Live grant or null.
     */
    _liveGrant(now = this._now()) {
        if (!this._activeGrant)
            return null;
        if (new Date(this._activeGrant.grant.expiresAt).getTime() <= now.getTime())
            return null;
        return this._activeGrant;
    }
    /**
     * Ensures a live grant exists, bootstrapping a new one when the current grant
     * is missing or expired. A refreshed grant re-signs this device's pending
     * records so the backend always sees the grant an intent is replayed under.
     * @returns {Promise<import("./offline-grant.js").SignedOfflineGrant>} - Live grant.
     */
    async _ensureLiveGrant() {
        const live = this._liveGrant();
        if (live)
            return live;
        const granted = await this.bootstrapGrant();
        await this._resignPendingRecords(granted);
        return granted;
    }
    /**
     * Requests a fresh offline grant from the built-in sync bootstrap endpoint
     * and retains it under its grant id together with the sync manifest whose
     * policy hashes mutations are signed against.
     * @returns {Promise<import("./offline-grant.js").SignedOfflineGrant>} - Newly issued grant.
     */
    async bootstrapGrant() {
        const identity = await this._ensureIdentity();
        const authenticationToken = await this.authenticationToken();
        const scopes = await this.config.grantScopes({ configuration: this.config.configuration });
        if (!scopes || typeof scopes !== "object" || Array.isArray(scopes))
            throw new Error("sync.client.offline.grantScopes must resolve a plain object of grant scopes");
        const response = await this.post(this.config.bootstrapPath, {
            authenticationToken,
            deviceId: identity.certificate.certificate.actorDeviceId,
            scopes
        });
        if (!response || typeof response !== "object" || Array.isArray(response)) {
            throw new Error(`Sync offline bootstrap did not return a response object (${this.config.bootstrapPath})`);
        }
        const responseRecord = /** @type {Record<string, unknown>} */ (response);
        const signedGrant = /** @type {import("./offline-grant.js").SignedOfflineGrant | undefined} */ (responseRecord.offlineGrant);
        if (!signedGrant || typeof signedGrant !== "object" || !signedGrant.grant || typeof signedGrant.grant.grantId !== "string") {
            throw new Error(`Sync offline bootstrap did not return a signed offline grant (${this.config.bootstrapPath})`);
        }
        const manifest = /** @type {Record<string, import("../configuration-types.js").NormalizedFrontendModelResourceSyncConfiguration> | undefined} */ (responseRecord.syncManifest);
        if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
            throw new Error(`Sync offline bootstrap did not return a sync manifest (${this.config.bootstrapPath})`);
        }
        this._grants.set(signedGrant.grant.grantId, signedGrant);
        this._activeGrant = signedGrant;
        this._syncManifest = manifest;
        await this._persistGrants();
        return signedGrant;
    }
    /**
     * Forces a grant refresh: bootstrap a new grant and re-sign this device's
     * pending records under it.
     * @returns {Promise<SyncOfflineSessionSummary>} - Refreshed session summary.
     */
    async refreshGrant() {
        await this._ensureIdentity();
        await this._loadRetainedGrants();
        const granted = await this.bootstrapGrant();
        await this._resignPendingRecords(granted);
        return this.sessionSummary();
    }
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
    async _resignPendingRecords(signedGrant) {
        this._requireIdentity();
        for (const mutationLog of this.mutationLogs) {
            for (const record of await mutationLog.pendingRecords()) {
                if (!this._isOwnRecord(record))
                    continue;
                if (record.mutation.offlineGrantId === signedGrant.grant.grantId && record.signedMutation)
                    continue;
                const signedMutation = await this.signMutation(record.mutation);
                await mutationLog.updateMutation({ id: record.id, mutation: signedMutation.mutation, signedMutation });
            }
        }
    }
    /**
     * Checks whether a log record was signed/queued by this device's identity
     * (or has no identity yet and can adopt it).
     * @param {import("./local-mutation-log.js").LocalMutationLogRecord} record - Durable record.
     * @returns {boolean} - Whether the record belongs to this device.
     */
    _isOwnRecord(record) {
        const identity = this._requireIdentity();
        if (record.signedMutation) {
            return record.signedMutation.mutation.actorDeviceId === identity.certificate.certificate.actorDeviceId &&
                record.signedMutation.mutation.actorUserId === identity.certificate.certificate.actorUserId;
        }
        return !record.mutation.actorDeviceId || (record.mutation.actorDeviceId === identity.certificate.certificate.actorDeviceId &&
            record.mutation.actorUserId === identity.certificate.certificate.actorUserId);
    }
    /**
     * Signs one mutation payload with the device key under the live grant,
     * filling the actor/grant/policy-hash identity from the session.
     * @param {Omit<import("./device-identity.js").SyncMutation, "actorDeviceId" | "actorUserId" | "offlineGrantId" | "policyHash">} mutation - Mutation payload to sign (the session supplies the rotating identity fields).
     * @returns {Promise<import("./device-identity.js").SignedSyncMutation>} - Signed mutation envelope.
     */
    async signMutation(mutation) {
        const identity = await this._ensureIdentity();
        const grant = await this._grantForSigning();
        return await createSignedMutation({
            deviceCertificate: identity.certificate,
            devicePrivateKey: identity.privateKey,
            mutation: {
                ...mutation,
                actorDeviceId: identity.certificate.certificate.actorDeviceId,
                actorUserId: identity.certificate.certificate.actorUserId,
                offlineGrantId: grant.grant.grantId,
                policyHash: this.policyHashFor(mutation.model)
            }
        });
    }
    /**
     * Returns the grant a new mutation is signed under: the live grant when one
     * exists, otherwise the newest retained grant (queueing stays possible while
     * offline - the replay pass refreshes the grant and re-signs the pending
     * records), and only bootstraps when no grant has ever been retained.
     * @returns {Promise<import("./offline-grant.js").SignedOfflineGrant>} - Grant to sign under.
     */
    async _grantForSigning() {
        const live = this._liveGrant();
        if (live)
            return live;
        if (this._activeGrant)
            return this._activeGrant;
        await this._loadRetainedGrants();
        const retained = Array.from(this._grants.values()).sort((left, right) => new Date(right.grant.issuedAt).getTime() - new Date(left.grant.issuedAt).getTime());
        if (retained.length > 0) {
            this._activeGrant = retained[0];
            return this._activeGrant;
        }
        return await this.bootstrapGrant();
    }
    /**
     * Returns the policy hash the live session's sync manifest carries for one model.
     * @param {string} model - Model/resource name.
     * @returns {string} - Policy hash.
     */
    policyHashFor(model) {
        const manifest = this._syncManifest || this._activeGrant?.grant.resources;
        if (!manifest)
            throw new Error("Sync offline session has no sync manifest - call startOfflineSession() first");
        const entry = /** @type {Record<string, unknown> | undefined} */ (manifest[model]);
        const policyHash = entry && typeof entry === "object" && !Array.isArray(entry) ? /** @type {Record<string, unknown>} */ (entry).policyHash : undefined;
        if (typeof policyHash !== "string" || policyHash.length === 0) {
            throw new Error(`Sync offline session has no policy hash for model '${model}' - is it sync-enabled on the backend?`);
        }
        return policyHash;
    }
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
    async replayPending(options = {}) {
        if (this._replayPromise)
            return await this._replayPromise;
        this._replayPromise = this._replayPass(options).finally(() => {
            this._replayPromise = null;
        });
        return await this._replayPromise;
    }
    /**
     * Runs one signed replay pass.
     * @param {object} options - Pass options.
     * @param {number} [options.batchSize] - Max mutations per request.
     * @param {AbortSignal} [options.signal] - Lifecycle cancellation signal.
     * @returns {Promise<SyncOfflineReplayResult>} - Mapped replay result.
     */
    async _replayPass({ batchSize, signal } = {}) {
        throwIfAborted(signal);
        if (!this.isActive())
            await this.start();
        const maxBatchSize = typeof batchSize === "number" && batchSize >= 1 ? Math.floor(batchSize) : 100;
        /** @type {SyncOfflineReplayResult["results"]} */
        const results = [];
        let syncedCount = 0;
        let conflictCount = 0;
        let rejectedCount = 0;
        for (let pass = 0; pass < 10; pass += 1) {
            throwIfAborted(signal);
            await this._ensureLiveGrant();
            /** @type {Array<{mutationLog: import("./local-mutation-log.js").default, record: import("./local-mutation-log.js").LocalMutationLogRecord}>} */
            const entries = [];
            for (const mutationLog of this.mutationLogs) {
                for (const record of await mutationLog.pendingRecords()) {
                    if (!record.signedMutation)
                        continue;
                    // A record can only replay with the grant it was signed under. Records
                    // whose grant the session does not retain (e.g. peer imports without
                    // their signer's grant) stay pending instead of blocking the batch.
                    if (!this._grants.has(record.mutation.offlineGrantId))
                        continue;
                    entries.push({ mutationLog, record });
                }
            }
            if (entries.length === 0)
                break;
            const batch = entries.slice(0, maxBatchSize);
            const authenticationToken = await this.authenticationToken();
            const mutations = batch.map((entry) => this._replayMutation(entry.record));
            const response = await this.post(this.config.replayPath, { authenticationToken, mutations }, { signal });
            throwIfAborted(signal);
            const resultsByIdempotencyKey = this._replayResultsById(response);
            for (const { mutationLog, record } of batch) {
                throwIfAborted(signal);
                const idempotencyKey = mutationIdempotencyKey(/** @type {import("./device-identity.js").SignedSyncMutation} */ (record.signedMutation));
                const result = resultsByIdempotencyKey.get(idempotencyKey);
                if (!result)
                    throw new Error(`Signed sync replay response is missing a result for mutation ${record.mutation.clientMutationId}`);
                const status = replayResultLocalStatus(/** @type {Record<string, import("./conflict-strategy.js").SyncJsonValue>} */ (result));
                const serverResult = cloneJson(result, "sync replay result");
                const updated = await mutationLog.updateStatus({
                    id: record.id,
                    status,
                    syncResult: /** @type {Record<string, import("../frontend-models/base.js").FrontendModelTransportValue>} */ (serverResult)
                });
                results.push({
                    clientMutationId: record.mutation.clientMutationId,
                    idempotencyKey,
                    mutation: /** @type {import("./device-identity.js").SyncMutation} */ (cloneJson(record.mutation, "mutation")),
                    recordId: updated.id,
                    serverResult,
                    status: updated.status
                });
                if (updated.status === "synced")
                    syncedCount += 1;
                if (updated.status === "conflict")
                    conflictCount += 1;
                if (updated.status === "rejected")
                    rejectedCount += 1;
            }
        }
        let pendingCount = 0;
        for (const mutationLog of this.mutationLogs) {
            pendingCount += (await mutationLog.pendingRecords()).length;
        }
        return { conflictCount, pendingCount, rejectedCount, results, syncedCount };
    }
    /**
     * Builds one signed replay mutation: the signed envelope plus the signed
     * grant the mutation was signed under. Fails closed when the session does
     * not retain that grant.
     * @param {import("./local-mutation-log.js").LocalMutationLogRecord} record - Durable record.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Replay mutation payload.
     */
    _replayMutation(record) {
        const signedMutation = /** @type {import("./device-identity.js").SignedSyncMutation} */ (record.signedMutation);
        const signedGrant = this._grants.get(signedMutation.mutation.offlineGrantId);
        if (!signedGrant)
            throw new Error(`Sync offline session has no retained grant '${signedMutation.mutation.offlineGrantId}' for mutation ${signedMutation.mutation.clientMutationId}`);
        return { ...cloneJson(signedMutation, "signed mutation"), signedOfflineGrant: cloneJson(signedGrant, "signed offline grant") };
    }
    /**
     * Normalizes a signed replay response into results keyed by idempotency key.
     * @param {ReturnType<typeof JSON.parse>} response - Raw replay response.
     * @returns {Map<string, Record<string, ReturnType<typeof JSON.parse>>>} - Results by idempotency key.
     */
    _replayResultsById(response) {
        if (!response || typeof response !== "object" || Array.isArray(response))
            throw new Error("Signed sync replay response must be an object");
        const responseRecord = /** @type {Record<string, unknown>} */ (response);
        if (responseRecord.status === "error")
            throw new Error(typeof responseRecord.errorMessage === "string" ? responseRecord.errorMessage : "Signed sync replay failed");
        if (!Array.isArray(responseRecord.results))
            throw new Error("Signed sync replay response is missing results");
        /** @type {Map<string, Record<string, ReturnType<typeof JSON.parse>>>} */
        const byKey = new Map();
        for (const result of responseRecord.results) {
            if (!result || typeof result !== "object" || Array.isArray(result))
                continue;
            const resultRecord = /** @type {Record<string, unknown>} */ (result);
            if (typeof resultRecord.idempotencyKey !== "string")
                continue;
            byKey.set(resultRecord.idempotencyKey, /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (resultRecord));
        }
        return byKey;
    }
    /**
     * Exports the durable non-terminal mutations of every session log as one
     * signed peer bundle.
     * @param {object} [options] - Export options.
     * @param {import("./local-mutation-log.js").LocalMutationStatus[]} [options.statuses] - Statuses to export.
     * @param {() => Date} [options.now] - Export clock.
     * @returns {Promise<import("./peer-mutation-bundle.js").PeerMutationBundle>} - Signed peer bundle.
     */
    async exportBundle(options = {}) {
        const identity = await this._ensureIdentity();
        /** @type {import("./peer-mutation-bundle.js").PeerMutationBundle["mutations"]} */
        const mutations = [];
        let bundle = null;
        for (const mutationLog of this.mutationLogs) {
            const logBundle = await exportPeerMutationBundle({
                deviceCertificate: identity.certificate,
                devicePrivateKey: identity.privateKey,
                mutationLog,
                ...options
            });
            if (!bundle)
                bundle = logBundle;
            else
                mutations.push(...logBundle.mutations);
        }
        if (!bundle) {
            throw new Error("Sync offline session export produced no bundle");
        }
        bundle.mutations = mutations.length > 0 ? [...bundle.mutations, ...mutations].sort((left, right) => (left.localSequence || 0) - (right.localSequence || 0)) : bundle.mutations;
        return bundle;
    }
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
    async importBundle({ bundle, mutationLog, signedOfflineGrants = [] }) {
        if (!this.config.backendPublicKey)
            throw new Error("sync.client.offline.backendPublicKey is required to import a peer mutation bundle");
        if (!Array.isArray(signedOfflineGrants))
            throw new Error("sync offline import signedOfflineGrants must be an array of signed offline grants");
        for (const signedGrant of signedOfflineGrants) {
            if (!signedGrant || typeof signedGrant !== "object" || !signedGrant.grant || typeof signedGrant.grant.grantId !== "string") {
                throw new Error("sync offline import requires signed offline grant envelopes with grant payloads");
            }
            this._grants.set(signedGrant.grant.grantId, signedGrant);
        }
        if (signedOfflineGrants.length > 0)
            await this._persistGrants();
        return await importPeerMutationBundle({
            backendPublicKey: this.config.backendPublicKey,
            bundle,
            mutationLog: mutationLog || this.mutationLogs[0]
        });
    }
    /**
     * Persists retained grants through the optional app-owned grant storage.
     * @returns {Promise<void>} - Resolves after retention is persisted.
     */
    async _persistGrants() {
        if (!this.config.grantStorage)
            return;
        await this.config.grantStorage.save(Array.from(this._grants.values()));
    }
    /**
     * Returns the session clock.
     * @returns {Date} - Current time.
     */
    _now() {
        return this.config.now();
    }
    /**
     * Returns the device identity or fails closed.
     * @returns {SyncOfflineDeviceIdentity} - Device identity.
     */
    _requireIdentity() {
        if (!this._identity)
            throw new Error("Sync offline session has no device identity - call startOfflineSession() first");
        return this._identity;
    }
    /**
     * Returns the live grant or fails closed.
     * @returns {import("./offline-grant.js").SignedOfflineGrant} - Live grant.
     */
    _requireLiveGrant() {
        const grant = this._liveGrant();
        if (!grant)
            throw new Error("Sync offline session has no live offline grant - call startOfflineSession() or refreshOfflineGrant()");
        return grant;
    }
}
/**
 * Clones a JSON object.
 * @param {unknown} value - Value.
 * @param {string} label - Diagnostic label.
 * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Cloned object.
 */
function cloneJson(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error(`Expected sync offline ${label} object`);
    return /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (JSON.parse(JSON.stringify(value)));
}
/**
 * Throws the exact abort reason at lifecycle boundaries.
 * @param {AbortSignal | undefined} signal - Lifecycle signal.
 * @returns {void} - No return value.
 */
function throwIfAborted(signal) {
    if (!signal?.aborted)
        return;
    throw signal.reason instanceof Error ? signal.reason : new Error("Sync offline replay aborted");
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3luYy1vZmZsaW5lLXNlc3Npb24uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvc3luYy9zeW5jLW9mZmxpbmUtc2Vzc2lvbi5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxFQUNMLG9CQUFvQixFQUNwQiwwQkFBMEIsRUFDMUIsc0JBQXNCLEVBQ3RCLHVCQUF1QixFQUN4QixNQUFNLHNCQUFzQixDQUFBO0FBQzdCLE9BQU8sRUFBQyx3QkFBd0IsRUFBRSx3QkFBd0IsRUFBQyxNQUFNLDJCQUEyQixDQUFBO0FBQzVGLE9BQU8sRUFBQyx1QkFBdUIsRUFBQyxNQUFNLHdCQUF3QixDQUFBO0FBRTlEOzs7Ozs7R0FNRztBQUNIOzs7Ozs7OztHQVFHO0FBQ0g7Ozs7Ozs7R0FPRztBQUVIOzs7Ozs7R0FNRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8sa0JBQWtCO0lBQ3JDOzs7Ozs7O09BT0c7SUFDSCxZQUFZLEVBQUMsbUJBQW1CLEVBQUUsTUFBTSxFQUFFLFlBQVksRUFBRSxJQUFJLEVBQUM7UUFDM0QsSUFBSSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsWUFBWSxDQUFDLElBQUksWUFBWSxDQUFDLE1BQU0sS0FBSyxDQUFDO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyx1REFBdUQsQ0FBQyxDQUFBO1FBRXZJLElBQUksQ0FBQyxtQkFBbUIsR0FBRyxtQkFBbUIsQ0FBQTtRQUM5QyxJQUFJLENBQUMsTUFBTSxHQUFHLE1BQU0sQ0FBQTtRQUNwQixJQUFJLENBQUMsWUFBWSxHQUFHLFlBQVksQ0FBQTtRQUNoQyxJQUFJLENBQUMsSUFBSSxHQUFHLElBQUksQ0FBQTtRQUVoQiwrQ0FBK0M7UUFDL0MsSUFBSSxDQUFDLFNBQVMsR0FBRyxJQUFJLENBQUE7UUFDckIsMkVBQTJFO1FBQzNFLElBQUksQ0FBQyxPQUFPLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQTtRQUN4QixJQUFJLENBQUMsYUFB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SUFDZCxDQUFDO0NBQ0Y7QUFFRDs7Ozs7R0FLRztBQUNILFNBQVMsU0FBUyxDQUFDLEtBQUssRUFBRSxLQUFLO0lBQzdCLElBQUksQ0FBQyxLQUFLLElBQUksT0FBTyxLQUFLLEtBQUssUUFBUSxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDO1FBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyx5QkFBeUIsS0FBSyxTQUFTLENBQUMsQ0FBQTtJQUV6SCxPQUFPLDREQUE0RCxDQUFDLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQTtBQUN6RyxDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILFNBQVMsY0FBYyxDQUFDLE1BQU07SUFDNUIsSUFBSSxDQUFDLE1BQU0sRUFBRSxPQUFPO1FBQUUsT0FBTTtJQUU1QixNQUFNLE1BQU0sQ0FBQyxNQUFNLFlBQVksS0FBSyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxJQUFJLEtBQUssQ0FBQyw2QkFBNkIsQ0FBQyxDQUFBO0FBQ2pHLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHtcbiAgY3JlYXRlU2lnbmVkTXV0YXRpb24sXG4gIGdlbmVyYXRlU3luY1NpZ25pbmdLZXlQYWlyLFxuICBtdXRhdGlvbklkZW1wb3RlbmN5S2V5LFxuICB2ZXJpZnlEZXZpY2VDZXJ0aWZpY2F0ZVxufSBmcm9tIFwiLi9kZXZpY2UtaWRlbnRpdHkuanNcIlxuaW1wb3J0IHtleHBvcnRQZWVyTXV0YXRpb25CdW5kbGUsIGltcG9ydFBlZXJNdXRhdGlvbkJ1bmRsZX0gZnJvbSBcIi4vcGVlci1tdXRhdGlvbi1idW5kbGUuanNcIlxuaW1wb3J0IHtyZXBsYXlSZXN1bHRMb2NhbFN0YXR1c30gZnJvbSBcIi4vY29uZmxpY3Qtc3RyYXRlZ3kuanNcIlxuXG4vKipcbiAqIFN0b3JlZCBkZXZpY2Ugc2lnbmluZyBpZGVudGl0eTogdGhlIGJhY2tlbmQtc2lnbmVkIGNlcnRpZmljYXRlIHBsdXMgdGhlXG4gKiBkZXZpY2UgcHJpdmF0ZSBrZXkgbWF0Y2hpbmcgdGhlIGNlcnRpZmljYXRlJ3MgcHVibGljIGtleS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFN5bmNPZmZsaW5lRGV2aWNlSWRlbnRpdHlcbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi9kZXZpY2UtaWRlbnRpdHkuanNcIikuRGV2aWNlQ2VydGlmaWNhdGV9IGNlcnRpZmljYXRlIC0gQmFja2VuZC1zaWduZWQgZGV2aWNlIGNlcnRpZmljYXRlLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuL2RldmljZS1pZGVudGl0eS5qc1wiKS5TeW5jSnNvbldlYktleX0gcHJpdmF0ZUtleSAtIERldmljZSBwcml2YXRlIHNpZ25pbmcga2V5IChKV0spLlxuICovXG4vKipcbiAqIFJlc3VsdCBvZiBvbmUgb2ZmbGluZSBzZXNzaW9uIHJlcGxheSBwYXNzIG92ZXIgdGhlIGR1cmFibGUgbXV0YXRpb24gbG9ncy5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFN5bmNPZmZsaW5lUmVwbGF5UmVzdWx0XG4gKiBAcHJvcGVydHkge251bWJlcn0gY29uZmxpY3RDb3VudCAtIFJlY29yZHMgbGVmdCBpbiBgY29uZmxpY3RgLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IHBlbmRpbmdDb3VudCAtIFJlY29yZHMgc3RpbGwgcGVuZGluZyAoYmxvY2tlZCBkZXBlbmRlbmNpZXMgb3IgdW5hY2tub3dsZWRnZWQpLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IHJlamVjdGVkQ291bnQgLSBSZWNvcmRzIHRoZSBiYWNrZW5kIHJlamVjdGVkLlxuICogQHByb3BlcnR5IHtBcnJheTx7Y2xpZW50TXV0YXRpb25JZDogc3RyaW5nLCBpZGVtcG90ZW5jeUtleTogc3RyaW5nLCBtdXRhdGlvbjogaW1wb3J0KFwiLi9kZXZpY2UtaWRlbnRpdHkuanNcIikuU3luY011dGF0aW9uLCByZWNvcmRJZDogc3RyaW5nLCBzZXJ2ZXJSZXN1bHQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IG51bGwsIHN0YXR1czogaW1wb3J0KFwiLi9sb2NhbC1tdXRhdGlvbi1sb2cuanNcIikuTG9jYWxNdXRhdGlvblN0YXR1c30+fSByZXN1bHRzIC0gUGVyLW11dGF0aW9uIG1hcHBlZCByZXN1bHRzIGluIHJlcGxheSBvcmRlci5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBzeW5jZWRDb3VudCAtIFJlY29yZHMgYWNrbm93bGVkZ2VkIGJ5IHRoZSBiYWNrZW5kLlxuICovXG4vKipcbiAqIFNlc3Npb24gc3VtbWFyeSByZXR1cm5lZCBieSBzdGFydC9yZWZyZXNoLlxuICogQHR5cGVkZWYge29iamVjdH0gU3luY09mZmxpbmVTZXNzaW9uU3VtbWFyeVxuICogQHByb3BlcnR5IHtzdHJpbmd9IGFjdG9yRGV2aWNlSWQgLSBDZXJ0aWZpY2F0ZSBkZXZpY2UgaWRlbnRpdHkuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gYWN0b3JVc2VySWQgLSBDZXJ0aWZpY2F0ZSB1c2VyIGlkZW50aXR5LlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGV4cGlyZXNBdCAtIExpdmUgZ3JhbnQgZXhwaXJ5LlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGdyYW50SWQgLSBMaXZlIGdyYW50IGlkLlxuICovXG5cbi8qKlxuICogRnJhbWV3b3JrLW93bmVkIGxvbmctb2ZmbGluZSBzZXNzaW9uIGJlaGluZCBTeW5jQ2xpZW50OiBkZXZpY2UgaWRlbnRpdHlcbiAqIGxpZmVjeWNsZSwgYmFja2VuZC1pc3N1ZWQgb2ZmbGluZSBncmFudHMsIG11dGF0aW9uIHNpZ25pbmcsIHNpZ25lZCByZXBsYXksXG4gKiBhbmQgcGVlciBidW5kbGUgdHJhbnNmZXIuIFN5bmNDbGllbnQgb3ducyB0aGUgcHVibGljIEFQSTsgdGhpcyBjbGFzcyBvd25zIHRoZVxuICogc2Vzc2lvbiBzdGF0ZS4gVGhlIGFwcCBvbmx5IHByb3ZpZGVzIGR1cmFibGUgc3RvcmFnZSBhZGFwdGVycywgdGhlXG4gKiBlbnJvbGxtZW50IGhvb2ssIGFuZCB0aGUgZ3JhbnQgc2NvcGVzIGNhbGxiYWNrLlxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBTeW5jT2ZmbGluZVNlc3Npb24ge1xuICAvKipcbiAgICogQnVpbGRzIGFuIG9mZmxpbmUgc2Vzc2lvbiBmcm9tIHRoZSBub3JtYWxpemVkIGBzeW5jLmNsaWVudC5vZmZsaW5lYCBibG9jay5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBTZXNzaW9uIGFyZ3MuXG4gICAqIEBwYXJhbSB7KCkgPT4gc3RyaW5nIHwgUHJvbWlzZTxzdHJpbmc+fSBhcmdzLmF1dGhlbnRpY2F0aW9uVG9rZW4gLSBSZXNvbHZlcyB0aGUgYXV0aCB0b2tlbiBzZW50IHdpdGggYm9vdHN0cmFwL3JlcGxheSByZXF1ZXN0cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRWZWxvY2lvdXNTeW5jQ2xpZW50T2ZmbGluZUNvbmZpZ3VyYXRpb259IGFyZ3MuY29uZmlnIC0gTm9ybWFsaXplZCBvZmZsaW5lIGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7QXJyYXk8aW1wb3J0KFwiLi9sb2NhbC1tdXRhdGlvbi1sb2cuanNcIikuZGVmYXVsdD59IGFyZ3MubXV0YXRpb25Mb2dzIC0gRHVyYWJsZSBsb2NhbCBtdXRhdGlvbiBsb2dzIHRoZSBzZXNzaW9uIHNpZ25zLCByZXBsYXlzLCByZXNpZ25zLCBhbmQgZXhwb3J0cy5cbiAgICogQHBhcmFtIHsocGF0aDogc3RyaW5nLCBwYXlsb2FkOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIG9wdGlvbnM/OiB7c2lnbmFsPzogQWJvcnRTaWduYWx9KSA9PiBQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5wb3N0IC0gRnJhbWV3b3JrIFBPU1RlciBvdmVyIHRoZSBjb25maWd1cmVkIHRyYW5zcG9ydC5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHthdXRoZW50aWNhdGlvblRva2VuLCBjb25maWcsIG11dGF0aW9uTG9ncywgcG9zdH0pIHtcbiAgICBpZiAoIUFycmF5LmlzQXJyYXkobXV0YXRpb25Mb2dzKSB8fCBtdXRhdGlvbkxvZ3MubGVuZ3RoID09PSAwKSB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jT2ZmbGluZVNlc3Npb24gcmVxdWlyZXMgYXQgbGVhc3Qgb25lIG11dGF0aW9uIGxvZ1wiKVxuXG4gICAgdGhpcy5hdXRoZW50aWNhdGlvblRva2VuID0gYXV0aGVudGljYXRpb25Ub2tlblxuICAgIHRoaXMuY29uZmlnID0gY29uZmlnXG4gICAgdGhpcy5tdXRhdGlvbkxvZ3MgPSBtdXRhdGlvbkxvZ3NcbiAgICB0aGlzLnBvc3QgPSBwb3N0XG5cbiAgICAvKiogQHR5cGUge1N5bmNPZmZsaW5lRGV2aWNlSWRlbnRpdHkgfCBudWxsfSAqL1xuICAgIHRoaXMuX2lkZW50aXR5ID0gbnVsbFxuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgaW1wb3J0KFwiLi9vZmZsaW5lLWdyYW50LmpzXCIpLlNpZ25lZE9mZmxpbmVHcmFudD59ICovXG4gICAgdGhpcy5fZ3JhbnRzID0gbmV3IE1hcCgpXG4gICAgdGhpcy5fZ3JhbnRzTG9hZGVkID0gZmFsc2VcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vb2ZmbGluZS1ncmFudC5qc1wiKS5TaWduZWRPZmZsaW5lR3JhbnQgfCBudWxsfSAqL1xuICAgIHRoaXMuX2FjdGl2ZUdyYW50ID0gbnVsbFxuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Ob3JtYWxpemVkRnJvbnRlbmRNb2RlbFJlc291cmNlU3luY0NvbmZpZ3VyYXRpb24+IHwgbnVsbH0gKi9cbiAgICB0aGlzLl9zeW5jTWFuaWZlc3QgPSBudWxsXG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPFN5bmNPZmZsaW5lU2Vzc2lvblN1bW1hcnk+IHwgbnVsbH0gKi9cbiAgICB0aGlzLl9zdGFydFByb21pc2UgPSBudWxsXG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPFN5bmNPZmZsaW5lUmVwbGF5UmVzdWx0PiB8IG51bGx9ICovXG4gICAgdGhpcy5fcmVwbGF5UHJvbWlzZSA9IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIHRoZSBzZXNzaW9uIGN1cnJlbnRseSBoYXMgYSB1c2FibGUgZGV2aWNlIGlkZW50aXR5IGFuZCBsaXZlIGdyYW50LlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBzZXNzaW9uIGlzIGFjdGl2ZS5cbiAgICovXG4gIGlzQWN0aXZlKCkge1xuICAgIHJldHVybiBCb29sZWFuKHRoaXMuX2lkZW50aXR5ICYmIHRoaXMuX2xpdmVHcmFudCgpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBkZXZpY2Ugc2lnbmluZyBpZGVudGl0eSAoZ2VuZXJhdGluZyBhbmQgZW5yb2xsaW5nIGEga2V5IHBhaXJcbiAgICogd2hlbiB0aGUgYXBwLW93bmVkIHN0b3JhZ2UgaGFzIG5vbmUpIGFuZCBib290c3RyYXBzIGEgbGl2ZSBvZmZsaW5lIGdyYW50LlxuICAgKiBJZGVtcG90ZW50IGFuZCBzaW5nbGUtZmxpZ2h0ZWQ6IGNvbmN1cnJlbnQgc3RhcnRzIHNoYXJlIG9uZSBib290c3RyYXAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFN5bmNPZmZsaW5lU2Vzc2lvblN1bW1hcnk+fSAtIFNlc3Npb24gc3VtbWFyeS5cbiAgICovXG4gIGFzeW5jIHN0YXJ0KCkge1xuICAgIGlmICh0aGlzLl9pZGVudGl0eSAmJiB0aGlzLl9saXZlR3JhbnQoKSkgcmV0dXJuIHRoaXMuc2Vzc2lvblN1bW1hcnkoKVxuXG4gICAgaWYgKCF0aGlzLl9zdGFydFByb21pc2UpIHtcbiAgICAgIHRoaXMuX3N0YXJ0UHJvbWlzZSA9IHRoaXMuX3N0YXJ0U2Vzc2lvbigpLnRoZW4oKHN1bW1hcnkpID0+IHtcbiAgICAgICAgdGhpcy5fc3RhcnRQcm9taXNlID0gbnVsbFxuXG4gICAgICAgIHJldHVybiBzdW1tYXJ5XG4gICAgICB9LCAoZXJyb3IpID0+IHtcbiAgICAgICAgdGhpcy5fc3RhcnRQcm9taXNlID0gbnVsbFxuXG4gICAgICAgIHRocm93IGVycm9yXG4gICAgICB9KVxuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9zdGFydFByb21pc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBEcm9wcyB0aGUgaW4tbWVtb3J5IHNlc3Npb24gKGlkZW50aXR5IGFuZCBncmFudHMgc3RheSBpbiB0aGUgYXBwLW93bmVkXG4gICAqIGR1cmFibGUgc3RvcmFnZTsgcGVuZGluZyBtdXRhdGlvbnMgc3RheSBpbiB0aGUgZHVyYWJsZSBtdXRhdGlvbiBsb2dzKS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIHNlc3Npb24gaXMgZHJvcHBlZC5cbiAgICovXG4gIGFzeW5jIHN0b3AoKSB7XG4gICAgaWYgKHRoaXMuX3JlcGxheVByb21pc2UpIGF3YWl0IHRoaXMuX3JlcGxheVByb21pc2UuY2F0Y2goKCkgPT4gdW5kZWZpbmVkKVxuXG4gICAgdGhpcy5faWRlbnRpdHkgPSBudWxsXG4gICAgdGhpcy5fYWN0aXZlR3JhbnQgPSBudWxsXG4gICAgdGhpcy5fc3luY01hbmlmZXN0ID0gbnVsbFxuICAgIHRoaXMuX2dyYW50c0xvYWRlZCA9IGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBvbmUgc3RhcnQgYXR0ZW1wdDogaWRlbnRpdHkgZmlyc3QsIHRoZW4gZ3JhbnQgYm9vdHN0cmFwLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxTeW5jT2ZmbGluZVNlc3Npb25TdW1tYXJ5Pn0gLSBTZXNzaW9uIHN1bW1hcnkuXG4gICAqL1xuICBhc3luYyBfc3RhcnRTZXNzaW9uKCkge1xuICAgIGF3YWl0IHRoaXMuX2Vuc3VyZUlkZW50aXR5KClcbiAgICBhd2FpdCB0aGlzLl9sb2FkUmV0YWluZWRHcmFudHMoKVxuICAgIGF3YWl0IHRoaXMuX2Vuc3VyZUxpdmVHcmFudCgpXG5cbiAgICByZXR1cm4gdGhpcy5zZXNzaW9uU3VtbWFyeSgpXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgY3VycmVudCBzZXNzaW9uIHN1bW1hcnkuXG4gICAqIEByZXR1cm5zIHtTeW5jT2ZmbGluZVNlc3Npb25TdW1tYXJ5fSAtIFNlc3Npb24gc3VtbWFyeS5cbiAgICovXG4gIHNlc3Npb25TdW1tYXJ5KCkge1xuICAgIGNvbnN0IGlkZW50aXR5ID0gdGhpcy5fcmVxdWlyZUlkZW50aXR5KClcbiAgICBjb25zdCBncmFudCA9IHRoaXMuX3JlcXVpcmVMaXZlR3JhbnQoKVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGFjdG9yRGV2aWNlSWQ6IGlkZW50aXR5LmNlcnRpZmljYXRlLmNlcnRpZmljYXRlLmFjdG9yRGV2aWNlSWQsXG4gICAgICBhY3RvclVzZXJJZDogaWRlbnRpdHkuY2VydGlmaWNhdGUuY2VydGlmaWNhdGUuYWN0b3JVc2VySWQsXG4gICAgICBleHBpcmVzQXQ6IGdyYW50LmdyYW50LmV4cGlyZXNBdCxcbiAgICAgIGdyYW50SWQ6IGdyYW50LmdyYW50LmdyYW50SWRcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIGRldmljZSBpZGVudGl0eTogbG9hZCBpdCBmcm9tIHRoZSBhcHAtb3duZWQgc3RvcmFnZSwgb3JcbiAgICogZ2VuZXJhdGUgYSBrZXkgcGFpciwgcnVuIHRoZSBhcHAtb3duZWQgZW5yb2xsbWVudCBob29rLCB2ZXJpZnkgdGhlIHJldHVybmVkXG4gICAqIGNlcnRpZmljYXRlIGFnYWluc3QgdGhlIGNvbmZpZ3VyZWQgYmFja2VuZCBwdWJsaWMga2V5LCBhbmQgc3RvcmUgaXQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFN5bmNPZmZsaW5lRGV2aWNlSWRlbnRpdHk+fSAtIERldmljZSBzaWduaW5nIGlkZW50aXR5LlxuICAgKi9cbiAgYXN5bmMgX2Vuc3VyZUlkZW50aXR5KCkge1xuICAgIGlmICh0aGlzLl9pZGVudGl0eSkgcmV0dXJuIHRoaXMuX2lkZW50aXR5XG5cbiAgICBjb25zdCBzdG9yZWQgPSBhd2FpdCB0aGlzLmNvbmZpZy5kZXZpY2VJZGVudGl0eVN0b3JhZ2UubG9hZCgpXG5cbiAgICBpZiAoc3RvcmVkKSB7XG4gICAgICB0aGlzLl9pZGVudGl0eSA9IGF3YWl0IHRoaXMuX3ZlcmlmaWVkSWRlbnRpdHkoc3RvcmVkKVxuXG4gICAgICByZXR1cm4gdGhpcy5faWRlbnRpdHlcbiAgICB9XG5cbiAgICBjb25zdCBrZXlQYWlyID0gYXdhaXQgZ2VuZXJhdGVTeW5jU2lnbmluZ0tleVBhaXIoKVxuICAgIGNvbnN0IGNlcnRpZmljYXRlID0gYXdhaXQgdGhpcy5jb25maWcuZW5yb2xsRGV2aWNlKHtcbiAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuY29uZmlnLmNvbmZpZ3VyYXRpb24sXG4gICAgICBwdWJsaWNLZXk6IGtleVBhaXIucHVibGljS2V5XG4gICAgfSlcbiAgICBjb25zdCBpZGVudGl0eSA9IGF3YWl0IHRoaXMuX3ZlcmlmaWVkSWRlbnRpdHkoe2NlcnRpZmljYXRlLCBwcml2YXRlS2V5OiBrZXlQYWlyLnByaXZhdGVLZXl9KVxuXG4gICAgYXdhaXQgdGhpcy5jb25maWcuZGV2aWNlSWRlbnRpdHlTdG9yYWdlLnNhdmUoLyoqIEB0eXBlIHtTeW5jT2ZmbGluZURldmljZUlkZW50aXR5fSAqLyAoY2xvbmVKc29uKGlkZW50aXR5LCBcImRldmljZSBpZGVudGl0eVwiKSkpXG5cbiAgICB0aGlzLl9pZGVudGl0eSA9IGlkZW50aXR5XG5cbiAgICByZXR1cm4gaWRlbnRpdHlcbiAgfVxuXG4gIC8qKlxuICAgKiBWZXJpZmllcyBhIHN0b3JlZC9lbnJvbGxlZCBjZXJ0aWZpY2F0ZSBhZ2FpbnN0IHRoZSBjb25maWd1cmVkIGJhY2tlbmRcbiAgICogcHVibGljIGtleSAod2hlbiBvbmUgaXMgY29uZmlndXJlZCkgYW5kIHJldHVybnMgdGhlIGlkZW50aXR5LlxuICAgKiBAcGFyYW0ge1N5bmNPZmZsaW5lRGV2aWNlSWRlbnRpdHl9IGlkZW50aXR5IC0gQ2FuZGlkYXRlIGlkZW50aXR5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxTeW5jT2ZmbGluZURldmljZUlkZW50aXR5Pn0gLSBWZXJpZmllZCBpZGVudGl0eS5cbiAgICovXG4gIGFzeW5jIF92ZXJpZmllZElkZW50aXR5KGlkZW50aXR5KSB7XG4gICAgaWYgKCFpZGVudGl0eSB8fCB0eXBlb2YgaWRlbnRpdHkgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShpZGVudGl0eSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcInN5bmMuY2xpZW50Lm9mZmxpbmUgZGV2aWNlIGlkZW50aXR5IHN0b3JhZ2UgbXVzdCBwcm92aWRlIHtjZXJ0aWZpY2F0ZSwgcHJpdmF0ZUtleX0gb3IgbnVsbFwiKVxuICAgIH1cbiAgICBpZiAoIWlkZW50aXR5LmNlcnRpZmljYXRlIHx8ICFpZGVudGl0eS5wcml2YXRlS2V5KSB0aHJvdyBuZXcgRXJyb3IoXCJzeW5jLmNsaWVudC5vZmZsaW5lIGRldmljZSBpZGVudGl0eSByZXF1aXJlcyBhIGNlcnRpZmljYXRlIGFuZCBhIHByaXZhdGVLZXlcIilcblxuICAgIGlmICh0aGlzLmNvbmZpZy5iYWNrZW5kUHVibGljS2V5KSB7XG4gICAgICBhd2FpdCB2ZXJpZnlEZXZpY2VDZXJ0aWZpY2F0ZSh7XG4gICAgICAgIGJhY2tlbmRQdWJsaWNLZXk6IHRoaXMuY29uZmlnLmJhY2tlbmRQdWJsaWNLZXksXG4gICAgICAgIGNlcnRpZmljYXRlOiBpZGVudGl0eS5jZXJ0aWZpY2F0ZVxuICAgICAgfSlcbiAgICB9XG5cbiAgICByZXR1cm4gaWRlbnRpdHlcbiAgfVxuXG4gIC8qKlxuICAgKiBMb2FkcyBhcHAtcmV0YWluZWQgZ3JhbnRzIG9uY2Ugc28gYSByZXN0YXJ0ZWQgZGV2aWNlIGNhbiBzdGlsbCByZXBsYXlcbiAgICogbXV0YXRpb25zIHRoYXQgd2VyZSBzaWduZWQgdW5kZXIgYW4gb2xkZXIgZ3JhbnQgKHBlZXItZm9yd2FyZGVkIG11dGF0aW9uc1xuICAgKiBrZWVwIHRoZSBncmFudCB0aGVpciBvcmlnaW5hbCBzaWduZXIgdXNlZCkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHJldGVudGlvbiBpcyBsb2FkZWQuXG4gICAqL1xuICBhc3luYyBfbG9hZFJldGFpbmVkR3JhbnRzKCkge1xuICAgIGlmICh0aGlzLl9ncmFudHNMb2FkZWQpIHJldHVyblxuXG4gICAgdGhpcy5fZ3JhbnRzTG9hZGVkID0gdHJ1ZVxuICAgIGlmICghdGhpcy5jb25maWcuZ3JhbnRTdG9yYWdlKSByZXR1cm5cblxuICAgIGNvbnN0IHJldGFpbmVkID0gYXdhaXQgdGhpcy5jb25maWcuZ3JhbnRTdG9yYWdlLmxvYWQoKVxuXG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHJldGFpbmVkKSkgdGhyb3cgbmV3IEVycm9yKFwic3luYy5jbGllbnQub2ZmbGluZSBncmFudFN0b3JhZ2UubG9hZCBtdXN0IHJlc29sdmUgYW4gYXJyYXkgb2Ygc2lnbmVkIG9mZmxpbmUgZ3JhbnRzXCIpXG5cbiAgICBmb3IgKGNvbnN0IHNpZ25lZEdyYW50IG9mIHJldGFpbmVkKSB7XG4gICAgICBpZiAoIXNpZ25lZEdyYW50IHx8IHR5cGVvZiBzaWduZWRHcmFudCAhPT0gXCJvYmplY3RcIiB8fCAhc2lnbmVkR3JhbnQuZ3JhbnQgfHwgdHlwZW9mIHNpZ25lZEdyYW50LmdyYW50LmdyYW50SWQgIT09IFwic3RyaW5nXCIpIGNvbnRpbnVlXG5cbiAgICAgIHRoaXMuX2dyYW50cy5zZXQoc2lnbmVkR3JhbnQuZ3JhbnQuZ3JhbnRJZCwgc2lnbmVkR3JhbnQpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGFjdGl2ZSBncmFudCB3aGVuIGl0IGlzIHN0aWxsIGxpdmUsIG90aGVyd2lzZSBudWxsLiBFeHBpcnkgaXNcbiAgICogY2hlY2tlZCBieSB0aW1lc3RhbXAgb25seTogdGhlIGdyYW50J3MgSE1BQyBzaWduYXR1cmUgaXMgYmFja2VuZC1vbmx5IGFuZFxuICAgKiBjYW4gbmV2ZXIgYmUgdmVyaWZpZWQgb24gdGhlIGRldmljZS5cbiAgICogQHBhcmFtIHtEYXRlfSBbbm93XSAtIENoZWNrIHRpbWUuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL29mZmxpbmUtZ3JhbnQuanNcIikuU2lnbmVkT2ZmbGluZUdyYW50IHwgbnVsbH0gLSBMaXZlIGdyYW50IG9yIG51bGwuXG4gICAqL1xuICBfbGl2ZUdyYW50KG5vdyA9IHRoaXMuX25vdygpKSB7XG4gICAgaWYgKCF0aGlzLl9hY3RpdmVHcmFudCkgcmV0dXJuIG51bGxcbiAgICBpZiAobmV3IERhdGUodGhpcy5fYWN0aXZlR3JhbnQuZ3JhbnQuZXhwaXJlc0F0KS5nZXRUaW1lKCkgPD0gbm93LmdldFRpbWUoKSkgcmV0dXJuIG51bGxcblxuICAgIHJldHVybiB0aGlzLl9hY3RpdmVHcmFudFxuICB9XG5cbiAgLyoqXG4gICAqIEVuc3VyZXMgYSBsaXZlIGdyYW50IGV4aXN0cywgYm9vdHN0cmFwcGluZyBhIG5ldyBvbmUgd2hlbiB0aGUgY3VycmVudCBncmFudFxuICAgKiBpcyBtaXNzaW5nIG9yIGV4cGlyZWQuIEEgcmVmcmVzaGVkIGdyYW50IHJlLXNpZ25zIHRoaXMgZGV2aWNlJ3MgcGVuZGluZ1xuICAgKiByZWNvcmRzIHNvIHRoZSBiYWNrZW5kIGFsd2F5cyBzZWVzIHRoZSBncmFudCBhbiBpbnRlbnQgaXMgcmVwbGF5ZWQgdW5kZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vb2ZmbGluZS1ncmFudC5qc1wiKS5TaWduZWRPZmZsaW5lR3JhbnQ+fSAtIExpdmUgZ3JhbnQuXG4gICAqL1xuICBhc3luYyBfZW5zdXJlTGl2ZUdyYW50KCkge1xuICAgIGNvbnN0IGxpdmUgPSB0aGlzLl9saXZlR3JhbnQoKVxuXG4gICAgaWYgKGxpdmUpIHJldHVybiBsaXZlXG5cbiAgICBjb25zdCBncmFudGVkID0gYXdhaXQgdGhpcy5ib290c3RyYXBHcmFudCgpXG5cbiAgICBhd2FpdCB0aGlzLl9yZXNpZ25QZW5kaW5nUmVjb3JkcyhncmFudGVkKVxuXG4gICAgcmV0dXJuIGdyYW50ZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXF1ZXN0cyBhIGZyZXNoIG9mZmxpbmUgZ3JhbnQgZnJvbSB0aGUgYnVpbHQtaW4gc3luYyBib290c3RyYXAgZW5kcG9pbnRcbiAgICogYW5kIHJldGFpbnMgaXQgdW5kZXIgaXRzIGdyYW50IGlkIHRvZ2V0aGVyIHdpdGggdGhlIHN5bmMgbWFuaWZlc3Qgd2hvc2VcbiAgICogcG9saWN5IGhhc2hlcyBtdXRhdGlvbnMgYXJlIHNpZ25lZCBhZ2FpbnN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL29mZmxpbmUtZ3JhbnQuanNcIikuU2lnbmVkT2ZmbGluZUdyYW50Pn0gLSBOZXdseSBpc3N1ZWQgZ3JhbnQuXG4gICAqL1xuICBhc3luYyBib290c3RyYXBHcmFudCgpIHtcbiAgICBjb25zdCBpZGVudGl0eSA9IGF3YWl0IHRoaXMuX2Vuc3VyZUlkZW50aXR5KClcbiAgICBjb25zdCBhdXRoZW50aWNhdGlvblRva2VuID0gYXdhaXQgdGhpcy5hdXRoZW50aWNhdGlvblRva2VuKClcbiAgICBjb25zdCBzY29wZXMgPSBhd2FpdCB0aGlzLmNvbmZpZy5ncmFudFNjb3Blcyh7Y29uZmlndXJhdGlvbjogdGhpcy5jb25maWcuY29uZmlndXJhdGlvbn0pXG5cbiAgICBpZiAoIXNjb3BlcyB8fCB0eXBlb2Ygc2NvcGVzICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkoc2NvcGVzKSkgdGhyb3cgbmV3IEVycm9yKFwic3luYy5jbGllbnQub2ZmbGluZS5ncmFudFNjb3BlcyBtdXN0IHJlc29sdmUgYSBwbGFpbiBvYmplY3Qgb2YgZ3JhbnQgc2NvcGVzXCIpXG5cbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMucG9zdCh0aGlzLmNvbmZpZy5ib290c3RyYXBQYXRoLCB7XG4gICAgICBhdXRoZW50aWNhdGlvblRva2VuLFxuICAgICAgZGV2aWNlSWQ6IGlkZW50aXR5LmNlcnRpZmljYXRlLmNlcnRpZmljYXRlLmFjdG9yRGV2aWNlSWQsXG4gICAgICBzY29wZXNcbiAgICB9KVxuXG4gICAgaWYgKCFyZXNwb25zZSB8fCB0eXBlb2YgcmVzcG9uc2UgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShyZXNwb25zZSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgU3luYyBvZmZsaW5lIGJvb3RzdHJhcCBkaWQgbm90IHJldHVybiBhIHJlc3BvbnNlIG9iamVjdCAoJHt0aGlzLmNvbmZpZy5ib290c3RyYXBQYXRofSlgKVxuICAgIH1cblxuICAgIGNvbnN0IHJlc3BvbnNlUmVjb3JkID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn0gKi8gKHJlc3BvbnNlKVxuICAgIGNvbnN0IHNpZ25lZEdyYW50ID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuL29mZmxpbmUtZ3JhbnQuanNcIikuU2lnbmVkT2ZmbGluZUdyYW50IHwgdW5kZWZpbmVkfSAqLyAocmVzcG9uc2VSZWNvcmQub2ZmbGluZUdyYW50KVxuXG4gICAgaWYgKCFzaWduZWRHcmFudCB8fCB0eXBlb2Ygc2lnbmVkR3JhbnQgIT09IFwib2JqZWN0XCIgfHwgIXNpZ25lZEdyYW50LmdyYW50IHx8IHR5cGVvZiBzaWduZWRHcmFudC5ncmFudC5ncmFudElkICE9PSBcInN0cmluZ1wiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFN5bmMgb2ZmbGluZSBib290c3RyYXAgZGlkIG5vdCByZXR1cm4gYSBzaWduZWQgb2ZmbGluZSBncmFudCAoJHt0aGlzLmNvbmZpZy5ib290c3RyYXBQYXRofSlgKVxuICAgIH1cblxuICAgIGNvbnN0IG1hbmlmZXN0ID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRGcm9udGVuZE1vZGVsUmVzb3VyY2VTeW5jQ29uZmlndXJhdGlvbj4gfCB1bmRlZmluZWR9ICovIChyZXNwb25zZVJlY29yZC5zeW5jTWFuaWZlc3QpXG5cbiAgICBpZiAoIW1hbmlmZXN0IHx8IHR5cGVvZiBtYW5pZmVzdCAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KG1hbmlmZXN0KSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBTeW5jIG9mZmxpbmUgYm9vdHN0cmFwIGRpZCBub3QgcmV0dXJuIGEgc3luYyBtYW5pZmVzdCAoJHt0aGlzLmNvbmZpZy5ib290c3RyYXBQYXRofSlgKVxuICAgIH1cblxuICAgIHRoaXMuX2dyYW50cy5zZXQoc2lnbmVkR3JhbnQuZ3JhbnQuZ3JhbnRJZCwgc2lnbmVkR3JhbnQpXG4gICAgdGhpcy5fYWN0aXZlR3JhbnQgPSBzaWduZWRHcmFudFxuICAgIHRoaXMuX3N5bmNNYW5pZmVzdCA9IG1hbmlmZXN0XG4gICAgYXdhaXQgdGhpcy5fcGVyc2lzdEdyYW50cygpXG5cbiAgICByZXR1cm4gc2lnbmVkR3JhbnRcbiAgfVxuXG4gIC8qKlxuICAgKiBGb3JjZXMgYSBncmFudCByZWZyZXNoOiBib290c3RyYXAgYSBuZXcgZ3JhbnQgYW5kIHJlLXNpZ24gdGhpcyBkZXZpY2Unc1xuICAgKiBwZW5kaW5nIHJlY29yZHMgdW5kZXIgaXQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFN5bmNPZmZsaW5lU2Vzc2lvblN1bW1hcnk+fSAtIFJlZnJlc2hlZCBzZXNzaW9uIHN1bW1hcnkuXG4gICAqL1xuICBhc3luYyByZWZyZXNoR3JhbnQoKSB7XG4gICAgYXdhaXQgdGhpcy5fZW5zdXJlSWRlbnRpdHkoKVxuICAgIGF3YWl0IHRoaXMuX2xvYWRSZXRhaW5lZEdyYW50cygpXG5cbiAgICBjb25zdCBncmFudGVkID0gYXdhaXQgdGhpcy5ib290c3RyYXBHcmFudCgpXG5cbiAgICBhd2FpdCB0aGlzLl9yZXNpZ25QZW5kaW5nUmVjb3JkcyhncmFudGVkKVxuXG4gICAgcmV0dXJuIHRoaXMuc2Vzc2lvblN1bW1hcnkoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlLXNpZ25zIHRoaXMgZGV2aWNlJ3Mgc3RpbGwtcGVuZGluZyByZWNvcmRzIHVuZGVyIGEgbmV3IGdyYW50LiBTYWZlXG4gICAqIGJlY2F1c2UgdGhlIHJlcGxheSBpZGVtcG90ZW5jeSBrZXkgaXNcbiAgICogYGFjdG9yVXNlcklkOmFjdG9yRGV2aWNlSWQ6Y2xpZW50TXV0YXRpb25JZGAgYW5kIG5ldmVyIGNhcnJpZXMgdGhlIGdyYW50XG4gICAqIGlkLiBSZWNvcmRzIHNpZ25lZCBieSBhbm90aGVyIGRldmljZSAocGVlci1mb3J3YXJkZWQgbXV0YXRpb25zKSBrZWVwIHRoZWlyXG4gICAqIG9yaWdpbmFsIHNpZ25lZCBlbnZlbG9wZSBhbmQgb3JpZ2luYWwgZ3JhbnQgLSB0aGV5IG11c3QgYWx3YXlzIHJlcGxheSB3aXRoXG4gICAqIHRoZSBncmFudCB0aGVpciBzaWduZXIgdXNlZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL29mZmxpbmUtZ3JhbnQuanNcIikuU2lnbmVkT2ZmbGluZUdyYW50fSBzaWduZWRHcmFudCAtIEdyYW50IHRoZSByZWNvcmRzIGFyZSByZS1zaWduZWQgdW5kZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHBlbmRpbmcgcmVjb3JkcyBhcmUgcmUtc2lnbmVkLlxuICAgKi9cbiAgYXN5bmMgX3Jlc2lnblBlbmRpbmdSZWNvcmRzKHNpZ25lZEdyYW50KSB7XG4gICAgdGhpcy5fcmVxdWlyZUlkZW50aXR5KClcblxuICAgIGZvciAoY29uc3QgbXV0YXRpb25Mb2cgb2YgdGhpcy5tdXRhdGlvbkxvZ3MpIHtcbiAgICAgIGZvciAoY29uc3QgcmVjb3JkIG9mIGF3YWl0IG11dGF0aW9uTG9nLnBlbmRpbmdSZWNvcmRzKCkpIHtcbiAgICAgICAgaWYgKCF0aGlzLl9pc093blJlY29yZChyZWNvcmQpKSBjb250aW51ZVxuICAgICAgICBpZiAocmVjb3JkLm11dGF0aW9uLm9mZmxpbmVHcmFudElkID09PSBzaWduZWRHcmFudC5ncmFudC5ncmFudElkICYmIHJlY29yZC5zaWduZWRNdXRhdGlvbikgY29udGludWVcblxuICAgICAgICBjb25zdCBzaWduZWRNdXRhdGlvbiA9IGF3YWl0IHRoaXMuc2lnbk11dGF0aW9uKHJlY29yZC5tdXRhdGlvbilcblxuICAgICAgICBhd2FpdCBtdXRhdGlvbkxvZy51cGRhdGVNdXRhdGlvbih7aWQ6IHJlY29yZC5pZCwgbXV0YXRpb246IHNpZ25lZE11dGF0aW9uLm11dGF0aW9uLCBzaWduZWRNdXRhdGlvbn0pXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrcyB3aGV0aGVyIGEgbG9nIHJlY29yZCB3YXMgc2lnbmVkL3F1ZXVlZCBieSB0aGlzIGRldmljZSdzIGlkZW50aXR5XG4gICAqIChvciBoYXMgbm8gaWRlbnRpdHkgeWV0IGFuZCBjYW4gYWRvcHQgaXQpLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vbG9jYWwtbXV0YXRpb24tbG9nLmpzXCIpLkxvY2FsTXV0YXRpb25Mb2dSZWNvcmR9IHJlY29yZCAtIER1cmFibGUgcmVjb3JkLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSByZWNvcmQgYmVsb25ncyB0byB0aGlzIGRldmljZS5cbiAgICovXG4gIF9pc093blJlY29yZChyZWNvcmQpIHtcbiAgICBjb25zdCBpZGVudGl0eSA9IHRoaXMuX3JlcXVpcmVJZGVudGl0eSgpXG5cbiAgICBpZiAocmVjb3JkLnNpZ25lZE11dGF0aW9uKSB7XG4gICAgICByZXR1cm4gcmVjb3JkLnNpZ25lZE11dGF0aW9uLm11dGF0aW9uLmFjdG9yRGV2aWNlSWQgPT09IGlkZW50aXR5LmNlcnRpZmljYXRlLmNlcnRpZmljYXRlLmFjdG9yRGV2aWNlSWQgJiZcbiAgICAgICAgcmVjb3JkLnNpZ25lZE11dGF0aW9uLm11dGF0aW9uLmFjdG9yVXNlcklkID09PSBpZGVudGl0eS5jZXJ0aWZpY2F0ZS5jZXJ0aWZpY2F0ZS5hY3RvclVzZXJJZFxuICAgIH1cblxuICAgIHJldHVybiAhcmVjb3JkLm11dGF0aW9uLmFjdG9yRGV2aWNlSWQgfHwgKFxuICAgICAgcmVjb3JkLm11dGF0aW9uLmFjdG9yRGV2aWNlSWQgPT09IGlkZW50aXR5LmNlcnRpZmljYXRlLmNlcnRpZmljYXRlLmFjdG9yRGV2aWNlSWQgJiZcbiAgICAgIHJlY29yZC5tdXRhdGlvbi5hY3RvclVzZXJJZCA9PT0gaWRlbnRpdHkuY2VydGlmaWNhdGUuY2VydGlmaWNhdGUuYWN0b3JVc2VySWRcbiAgICApXG4gIH1cblxuICAvKipcbiAgICogU2lnbnMgb25lIG11dGF0aW9uIHBheWxvYWQgd2l0aCB0aGUgZGV2aWNlIGtleSB1bmRlciB0aGUgbGl2ZSBncmFudCxcbiAgICogZmlsbGluZyB0aGUgYWN0b3IvZ3JhbnQvcG9saWN5LWhhc2ggaWRlbnRpdHkgZnJvbSB0aGUgc2Vzc2lvbi5cbiAgICogQHBhcmFtIHtPbWl0PGltcG9ydChcIi4vZGV2aWNlLWlkZW50aXR5LmpzXCIpLlN5bmNNdXRhdGlvbiwgXCJhY3RvckRldmljZUlkXCIgfCBcImFjdG9yVXNlcklkXCIgfCBcIm9mZmxpbmVHcmFudElkXCIgfCBcInBvbGljeUhhc2hcIj59IG11dGF0aW9uIC0gTXV0YXRpb24gcGF5bG9hZCB0byBzaWduICh0aGUgc2Vzc2lvbiBzdXBwbGllcyB0aGUgcm90YXRpbmcgaWRlbnRpdHkgZmllbGRzKS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi9kZXZpY2UtaWRlbnRpdHkuanNcIikuU2lnbmVkU3luY011dGF0aW9uPn0gLSBTaWduZWQgbXV0YXRpb24gZW52ZWxvcGUuXG4gICAqL1xuICBhc3luYyBzaWduTXV0YXRpb24obXV0YXRpb24pIHtcbiAgICBjb25zdCBpZGVudGl0eSA9IGF3YWl0IHRoaXMuX2Vuc3VyZUlkZW50aXR5KClcbiAgICBjb25zdCBncmFudCA9IGF3YWl0IHRoaXMuX2dyYW50Rm9yU2lnbmluZygpXG5cbiAgICByZXR1cm4gYXdhaXQgY3JlYXRlU2lnbmVkTXV0YXRpb24oe1xuICAgICAgZGV2aWNlQ2VydGlmaWNhdGU6IGlkZW50aXR5LmNlcnRpZmljYXRlLFxuICAgICAgZGV2aWNlUHJpdmF0ZUtleTogaWRlbnRpdHkucHJpdmF0ZUtleSxcbiAgICAgIG11dGF0aW9uOiB7XG4gICAgICAgIC4uLm11dGF0aW9uLFxuICAgICAgICBhY3RvckRldmljZUlkOiBpZGVudGl0eS5jZXJ0aWZpY2F0ZS5jZXJ0aWZpY2F0ZS5hY3RvckRldmljZUlkLFxuICAgICAgICBhY3RvclVzZXJJZDogaWRlbnRpdHkuY2VydGlmaWNhdGUuY2VydGlmaWNhdGUuYWN0b3JVc2VySWQsXG4gICAgICAgIG9mZmxpbmVHcmFudElkOiBncmFudC5ncmFudC5ncmFudElkLFxuICAgICAgICBwb2xpY3lIYXNoOiB0aGlzLnBvbGljeUhhc2hGb3IobXV0YXRpb24ubW9kZWwpXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBncmFudCBhIG5ldyBtdXRhdGlvbiBpcyBzaWduZWQgdW5kZXI6IHRoZSBsaXZlIGdyYW50IHdoZW4gb25lXG4gICAqIGV4aXN0cywgb3RoZXJ3aXNlIHRoZSBuZXdlc3QgcmV0YWluZWQgZ3JhbnQgKHF1ZXVlaW5nIHN0YXlzIHBvc3NpYmxlIHdoaWxlXG4gICAqIG9mZmxpbmUgLSB0aGUgcmVwbGF5IHBhc3MgcmVmcmVzaGVzIHRoZSBncmFudCBhbmQgcmUtc2lnbnMgdGhlIHBlbmRpbmdcbiAgICogcmVjb3JkcyksIGFuZCBvbmx5IGJvb3RzdHJhcHMgd2hlbiBubyBncmFudCBoYXMgZXZlciBiZWVuIHJldGFpbmVkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL29mZmxpbmUtZ3JhbnQuanNcIikuU2lnbmVkT2ZmbGluZUdyYW50Pn0gLSBHcmFudCB0byBzaWduIHVuZGVyLlxuICAgKi9cbiAgYXN5bmMgX2dyYW50Rm9yU2lnbmluZygpIHtcbiAgICBjb25zdCBsaXZlID0gdGhpcy5fbGl2ZUdyYW50KClcblxuICAgIGlmIChsaXZlKSByZXR1cm4gbGl2ZVxuICAgIGlmICh0aGlzLl9hY3RpdmVHcmFudCkgcmV0dXJuIHRoaXMuX2FjdGl2ZUdyYW50XG5cbiAgICBhd2FpdCB0aGlzLl9sb2FkUmV0YWluZWRHcmFudHMoKVxuXG4gICAgY29uc3QgcmV0YWluZWQgPSBBcnJheS5mcm9tKHRoaXMuX2dyYW50cy52YWx1ZXMoKSkuc29ydCgobGVmdCwgcmlnaHQpID0+IG5ldyBEYXRlKHJpZ2h0LmdyYW50Lmlzc3VlZEF0KS5nZXRUaW1lKCkgLSBuZXcgRGF0ZShsZWZ0LmdyYW50Lmlzc3VlZEF0KS5nZXRUaW1lKCkpXG5cbiAgICBpZiAocmV0YWluZWQubGVuZ3RoID4gMCkge1xuICAgICAgdGhpcy5fYWN0aXZlR3JhbnQgPSByZXRhaW5lZFswXVxuXG4gICAgICByZXR1cm4gdGhpcy5fYWN0aXZlR3JhbnRcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5ib290c3RyYXBHcmFudCgpXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgcG9saWN5IGhhc2ggdGhlIGxpdmUgc2Vzc2lvbidzIHN5bmMgbWFuaWZlc3QgY2FycmllcyBmb3Igb25lIG1vZGVsLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbW9kZWwgLSBNb2RlbC9yZXNvdXJjZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFBvbGljeSBoYXNoLlxuICAgKi9cbiAgcG9saWN5SGFzaEZvcihtb2RlbCkge1xuICAgIGNvbnN0IG1hbmlmZXN0ID0gdGhpcy5fc3luY01hbmlmZXN0IHx8IHRoaXMuX2FjdGl2ZUdyYW50Py5ncmFudC5yZXNvdXJjZXNcblxuICAgIGlmICghbWFuaWZlc3QpIHRocm93IG5ldyBFcnJvcihcIlN5bmMgb2ZmbGluZSBzZXNzaW9uIGhhcyBubyBzeW5jIG1hbmlmZXN0IC0gY2FsbCBzdGFydE9mZmxpbmVTZXNzaW9uKCkgZmlyc3RcIilcblxuICAgIGNvbnN0IGVudHJ5ID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IHVuZGVmaW5lZH0gKi8gKG1hbmlmZXN0W21vZGVsXSlcbiAgICBjb25zdCBwb2xpY3lIYXNoID0gZW50cnkgJiYgdHlwZW9mIGVudHJ5ID09PSBcIm9iamVjdFwiICYmICFBcnJheS5pc0FycmF5KGVudHJ5KSA/IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59ICovIChlbnRyeSkucG9saWN5SGFzaCA6IHVuZGVmaW5lZFxuXG4gICAgaWYgKHR5cGVvZiBwb2xpY3lIYXNoICE9PSBcInN0cmluZ1wiIHx8IHBvbGljeUhhc2gubGVuZ3RoID09PSAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFN5bmMgb2ZmbGluZSBzZXNzaW9uIGhhcyBubyBwb2xpY3kgaGFzaCBmb3IgbW9kZWwgJyR7bW9kZWx9JyAtIGlzIGl0IHN5bmMtZW5hYmxlZCBvbiB0aGUgYmFja2VuZD9gKVxuICAgIH1cblxuICAgIHJldHVybiBwb2xpY3lIYXNoXG4gIH1cblxuICAvKipcbiAgICogRHJhaW5zIHRoZSBkdXJhYmxlIG11dGF0aW9uIGxvZ3MgdGhyb3VnaCB0aGUgYnVpbHQtaW4gc2lnbmVkIHJlcGxheVxuICAgKiBlbmRwb2ludC4gUGVuZGluZyByZWNvcmRzIGFyZSBiYXRjaGVkLCBlYWNoIHNpZ25lZCBtdXRhdGlvbiB0cmF2ZWxzIHdpdGhcbiAgICogdGhlIHNpZ25lZCBncmFudCBpdCB3YXMgc2lnbmVkIHVuZGVyLCBhbmQgcGVyLW11dGF0aW9uIHJlc3VsdHMgYXJlIG1hcHBlZFxuICAgKiBiYWNrIG9udG8gdGhlIGxvZyByZWNvcmRzIGFzIHN5bmNlZC9jb25mbGljdC9yZWplY3RlZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IFtvcHRpb25zXSAtIFJlcGxheSBvcHRpb25zLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW29wdGlvbnMuYmF0Y2hTaXplXSAtIE1heCBtdXRhdGlvbnMgcGVyIHJlcXVlc3QuXG4gICAqIEBwYXJhbSB7QWJvcnRTaWduYWx9IFtvcHRpb25zLnNpZ25hbF0gLSBMaWZlY3ljbGUgY2FuY2VsbGF0aW9uIHNpZ25hbC5cbiAgICogQHJldHVybnMge1Byb21pc2U8U3luY09mZmxpbmVSZXBsYXlSZXN1bHQ+fSAtIE1hcHBlZCByZXBsYXkgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgcmVwbGF5UGVuZGluZyhvcHRpb25zID0ge30pIHtcbiAgICBpZiAodGhpcy5fcmVwbGF5UHJvbWlzZSkgcmV0dXJuIGF3YWl0IHRoaXMuX3JlcGxheVByb21pc2VcblxuICAgIHRoaXMuX3JlcGxheVByb21pc2UgPSB0aGlzLl9yZXBsYXlQYXNzKG9wdGlvbnMpLmZpbmFsbHkoKCkgPT4ge1xuICAgICAgdGhpcy5fcmVwbGF5UHJvbWlzZSA9IG51bGxcbiAgICB9KVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3JlcGxheVByb21pc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG9uZSBzaWduZWQgcmVwbGF5IHBhc3MuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBvcHRpb25zIC0gUGFzcyBvcHRpb25zLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW29wdGlvbnMuYmF0Y2hTaXplXSAtIE1heCBtdXRhdGlvbnMgcGVyIHJlcXVlc3QuXG4gICAqIEBwYXJhbSB7QWJvcnRTaWduYWx9IFtvcHRpb25zLnNpZ25hbF0gLSBMaWZlY3ljbGUgY2FuY2VsbGF0aW9uIHNpZ25hbC5cbiAgICogQHJldHVybnMge1Byb21pc2U8U3luY09mZmxpbmVSZXBsYXlSZXN1bHQ+fSAtIE1hcHBlZCByZXBsYXkgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgX3JlcGxheVBhc3Moe2JhdGNoU2l6ZSwgc2lnbmFsfSA9IHt9KSB7XG4gICAgdGhyb3dJZkFib3J0ZWQoc2lnbmFsKVxuXG4gICAgaWYgKCF0aGlzLmlzQWN0aXZlKCkpIGF3YWl0IHRoaXMuc3RhcnQoKVxuXG4gICAgY29uc3QgbWF4QmF0Y2hTaXplID0gdHlwZW9mIGJhdGNoU2l6ZSA9PT0gXCJudW1iZXJcIiAmJiBiYXRjaFNpemUgPj0gMSA/IE1hdGguZmxvb3IoYmF0Y2hTaXplKSA6IDEwMFxuICAgIC8qKiBAdHlwZSB7U3luY09mZmxpbmVSZXBsYXlSZXN1bHRbXCJyZXN1bHRzXCJdfSAqL1xuICAgIGNvbnN0IHJlc3VsdHMgPSBbXVxuICAgIGxldCBzeW5jZWRDb3VudCA9IDBcbiAgICBsZXQgY29uZmxpY3RDb3VudCA9IDBcbiAgICBsZXQgcmVqZWN0ZWRDb3VudCA9IDBcblxuICAgIGZvciAobGV0IHBhc3MgPSAwOyBwYXNzIDwgMTA7IHBhc3MgKz0gMSkge1xuICAgICAgdGhyb3dJZkFib3J0ZWQoc2lnbmFsKVxuICAgICAgYXdhaXQgdGhpcy5fZW5zdXJlTGl2ZUdyYW50KClcblxuICAgICAgLyoqIEB0eXBlIHtBcnJheTx7bXV0YXRpb25Mb2c6IGltcG9ydChcIi4vbG9jYWwtbXV0YXRpb24tbG9nLmpzXCIpLmRlZmF1bHQsIHJlY29yZDogaW1wb3J0KFwiLi9sb2NhbC1tdXRhdGlvbi1sb2cuanNcIikuTG9jYWxNdXRhdGlvbkxvZ1JlY29yZH0+fSAqL1xuICAgICAgY29uc3QgZW50cmllcyA9IFtdXG5cbiAgICAgIGZvciAoY29uc3QgbXV0YXRpb25Mb2cgb2YgdGhpcy5tdXRhdGlvbkxvZ3MpIHtcbiAgICAgICAgZm9yIChjb25zdCByZWNvcmQgb2YgYXdhaXQgbXV0YXRpb25Mb2cucGVuZGluZ1JlY29yZHMoKSkge1xuICAgICAgICAgIGlmICghcmVjb3JkLnNpZ25lZE11dGF0aW9uKSBjb250aW51ZVxuICAgICAgICAgIC8vIEEgcmVjb3JkIGNhbiBvbmx5IHJlcGxheSB3aXRoIHRoZSBncmFudCBpdCB3YXMgc2lnbmVkIHVuZGVyLiBSZWNvcmRzXG4gICAgICAgICAgLy8gd2hvc2UgZ3JhbnQgdGhlIHNlc3Npb24gZG9lcyBub3QgcmV0YWluIChlLmcuIHBlZXIgaW1wb3J0cyB3aXRob3V0XG4gICAgICAgICAgLy8gdGhlaXIgc2lnbmVyJ3MgZ3JhbnQpIHN0YXkgcGVuZGluZyBpbnN0ZWFkIG9mIGJsb2NraW5nIHRoZSBiYXRjaC5cbiAgICAgICAgICBpZiAoIXRoaXMuX2dyYW50cy5oYXMocmVjb3JkLm11dGF0aW9uLm9mZmxpbmVHcmFudElkKSkgY29udGludWVcblxuICAgICAgICAgIGVudHJpZXMucHVzaCh7bXV0YXRpb25Mb2csIHJlY29yZH0pXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKGVudHJpZXMubGVuZ3RoID09PSAwKSBicmVha1xuXG4gICAgICBjb25zdCBiYXRjaCA9IGVudHJpZXMuc2xpY2UoMCwgbWF4QmF0Y2hTaXplKVxuICAgICAgY29uc3QgYXV0aGVudGljYXRpb25Ub2tlbiA9IGF3YWl0IHRoaXMuYXV0aGVudGljYXRpb25Ub2tlbigpXG4gICAgICBjb25zdCBtdXRhdGlvbnMgPSBiYXRjaC5tYXAoKGVudHJ5KSA9PiB0aGlzLl9yZXBsYXlNdXRhdGlvbihlbnRyeS5yZWNvcmQpKVxuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLnBvc3QodGhpcy5jb25maWcucmVwbGF5UGF0aCwge2F1dGhlbnRpY2F0aW9uVG9rZW4sIG11dGF0aW9uc30sIHtzaWduYWx9KVxuXG4gICAgICB0aHJvd0lmQWJvcnRlZChzaWduYWwpXG5cbiAgICAgIGNvbnN0IHJlc3VsdHNCeUlkZW1wb3RlbmN5S2V5ID0gdGhpcy5fcmVwbGF5UmVzdWx0c0J5SWQocmVzcG9uc2UpXG5cbiAgICAgIGZvciAoY29uc3Qge211dGF0aW9uTG9nLCByZWNvcmR9IG9mIGJhdGNoKSB7XG4gICAgICAgIHRocm93SWZBYm9ydGVkKHNpZ25hbClcbiAgICAgICAgY29uc3QgaWRlbXBvdGVuY3lLZXkgPSBtdXRhdGlvbklkZW1wb3RlbmN5S2V5KC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9kZXZpY2UtaWRlbnRpdHkuanNcIikuU2lnbmVkU3luY011dGF0aW9ufSAqLyAocmVjb3JkLnNpZ25lZE11dGF0aW9uKSlcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gcmVzdWx0c0J5SWRlbXBvdGVuY3lLZXkuZ2V0KGlkZW1wb3RlbmN5S2V5KVxuXG4gICAgICAgIGlmICghcmVzdWx0KSB0aHJvdyBuZXcgRXJyb3IoYFNpZ25lZCBzeW5jIHJlcGxheSByZXNwb25zZSBpcyBtaXNzaW5nIGEgcmVzdWx0IGZvciBtdXRhdGlvbiAke3JlY29yZC5tdXRhdGlvbi5jbGllbnRNdXRhdGlvbklkfWApXG5cbiAgICAgICAgY29uc3Qgc3RhdHVzID0gcmVwbGF5UmVzdWx0TG9jYWxTdGF0dXMoLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL2NvbmZsaWN0LXN0cmF0ZWd5LmpzXCIpLlN5bmNKc29uVmFsdWU+fSAqLyAocmVzdWx0KSlcbiAgICAgICAgY29uc3Qgc2VydmVyUmVzdWx0ID0gY2xvbmVKc29uKHJlc3VsdCwgXCJzeW5jIHJlcGxheSByZXN1bHRcIilcbiAgICAgICAgY29uc3QgdXBkYXRlZCA9IGF3YWl0IG11dGF0aW9uTG9nLnVwZGF0ZVN0YXR1cyh7XG4gICAgICAgICAgaWQ6IHJlY29yZC5pZCxcbiAgICAgICAgICBzdGF0dXMsXG4gICAgICAgICAgc3luY1Jlc3VsdDogLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9mcm9udGVuZC1tb2RlbHMvYmFzZS5qc1wiKS5Gcm9udGVuZE1vZGVsVHJhbnNwb3J0VmFsdWU+fSAqLyAoc2VydmVyUmVzdWx0KVxuICAgICAgICB9KVxuXG4gICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgY2xpZW50TXV0YXRpb25JZDogcmVjb3JkLm11dGF0aW9uLmNsaWVudE11dGF0aW9uSWQsXG4gICAgICAgICAgaWRlbXBvdGVuY3lLZXksXG4gICAgICAgICAgbXV0YXRpb246IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9kZXZpY2UtaWRlbnRpdHkuanNcIikuU3luY011dGF0aW9ufSAqLyAoY2xvbmVKc29uKHJlY29yZC5tdXRhdGlvbiwgXCJtdXRhdGlvblwiKSksXG4gICAgICAgICAgcmVjb3JkSWQ6IHVwZGF0ZWQuaWQsXG4gICAgICAgICAgc2VydmVyUmVzdWx0LFxuICAgICAgICAgIHN0YXR1czogdXBkYXRlZC5zdGF0dXNcbiAgICAgICAgfSlcblxuICAgICAgICBpZiAodXBkYXRlZC5zdGF0dXMgPT09IFwic3luY2VkXCIpIHN5bmNlZENvdW50ICs9IDFcbiAgICAgICAgaWYgKHVwZGF0ZWQuc3RhdHVzID09PSBcImNvbmZsaWN0XCIpIGNvbmZsaWN0Q291bnQgKz0gMVxuICAgICAgICBpZiAodXBkYXRlZC5zdGF0dXMgPT09IFwicmVqZWN0ZWRcIikgcmVqZWN0ZWRDb3VudCArPSAxXG4gICAgICB9XG4gICAgfVxuXG4gICAgbGV0IHBlbmRpbmdDb3VudCA9IDBcblxuICAgIGZvciAoY29uc3QgbXV0YXRpb25Mb2cgb2YgdGhpcy5tdXRhdGlvbkxvZ3MpIHtcbiAgICAgIHBlbmRpbmdDb3VudCArPSAoYXdhaXQgbXV0YXRpb25Mb2cucGVuZGluZ1JlY29yZHMoKSkubGVuZ3RoXG4gICAgfVxuXG4gICAgcmV0dXJuIHtjb25mbGljdENvdW50LCBwZW5kaW5nQ291bnQsIHJlamVjdGVkQ291bnQsIHJlc3VsdHMsIHN5bmNlZENvdW50fVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBvbmUgc2lnbmVkIHJlcGxheSBtdXRhdGlvbjogdGhlIHNpZ25lZCBlbnZlbG9wZSBwbHVzIHRoZSBzaWduZWRcbiAgICogZ3JhbnQgdGhlIG11dGF0aW9uIHdhcyBzaWduZWQgdW5kZXIuIEZhaWxzIGNsb3NlZCB3aGVuIHRoZSBzZXNzaW9uIGRvZXNcbiAgICogbm90IHJldGFpbiB0aGF0IGdyYW50LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vbG9jYWwtbXV0YXRpb24tbG9nLmpzXCIpLkxvY2FsTXV0YXRpb25Mb2dSZWNvcmR9IHJlY29yZCAtIER1cmFibGUgcmVjb3JkLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlcGxheSBtdXRhdGlvbiBwYXlsb2FkLlxuICAgKi9cbiAgX3JlcGxheU11dGF0aW9uKHJlY29yZCkge1xuICAgIGNvbnN0IHNpZ25lZE11dGF0aW9uID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuL2RldmljZS1pZGVudGl0eS5qc1wiKS5TaWduZWRTeW5jTXV0YXRpb259ICovIChyZWNvcmQuc2lnbmVkTXV0YXRpb24pXG4gICAgY29uc3Qgc2lnbmVkR3JhbnQgPSB0aGlzLl9ncmFudHMuZ2V0KHNpZ25lZE11dGF0aW9uLm11dGF0aW9uLm9mZmxpbmVHcmFudElkKVxuXG4gICAgaWYgKCFzaWduZWRHcmFudCkgdGhyb3cgbmV3IEVycm9yKGBTeW5jIG9mZmxpbmUgc2Vzc2lvbiBoYXMgbm8gcmV0YWluZWQgZ3JhbnQgJyR7c2lnbmVkTXV0YXRpb24ubXV0YXRpb24ub2ZmbGluZUdyYW50SWR9JyBmb3IgbXV0YXRpb24gJHtzaWduZWRNdXRhdGlvbi5tdXRhdGlvbi5jbGllbnRNdXRhdGlvbklkfWApXG5cbiAgICByZXR1cm4gey4uLmNsb25lSnNvbihzaWduZWRNdXRhdGlvbiwgXCJzaWduZWQgbXV0YXRpb25cIiksIHNpZ25lZE9mZmxpbmVHcmFudDogY2xvbmVKc29uKHNpZ25lZEdyYW50LCBcInNpZ25lZCBvZmZsaW5lIGdyYW50XCIpfVxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZXMgYSBzaWduZWQgcmVwbGF5IHJlc3BvbnNlIGludG8gcmVzdWx0cyBrZXllZCBieSBpZGVtcG90ZW5jeSBrZXkuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHJlc3BvbnNlIC0gUmF3IHJlcGxheSByZXNwb25zZS5cbiAgICogQHJldHVybnMge01hcDxzdHJpbmcsIFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gUmVzdWx0cyBieSBpZGVtcG90ZW5jeSBrZXkuXG4gICAqL1xuICBfcmVwbGF5UmVzdWx0c0J5SWQocmVzcG9uc2UpIHtcbiAgICBpZiAoIXJlc3BvbnNlIHx8IHR5cGVvZiByZXNwb25zZSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHJlc3BvbnNlKSkgdGhyb3cgbmV3IEVycm9yKFwiU2lnbmVkIHN5bmMgcmVwbGF5IHJlc3BvbnNlIG11c3QgYmUgYW4gb2JqZWN0XCIpXG5cbiAgICBjb25zdCByZXNwb25zZVJlY29yZCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59ICovIChyZXNwb25zZSlcblxuICAgIGlmIChyZXNwb25zZVJlY29yZC5zdGF0dXMgPT09IFwiZXJyb3JcIikgdGhyb3cgbmV3IEVycm9yKHR5cGVvZiByZXNwb25zZVJlY29yZC5lcnJvck1lc3NhZ2UgPT09IFwic3RyaW5nXCIgPyByZXNwb25zZVJlY29yZC5lcnJvck1lc3NhZ2UgOiBcIlNpZ25lZCBzeW5jIHJlcGxheSBmYWlsZWRcIilcbiAgICBpZiAoIUFycmF5LmlzQXJyYXkocmVzcG9uc2VSZWNvcmQucmVzdWx0cykpIHRocm93IG5ldyBFcnJvcihcIlNpZ25lZCBzeW5jIHJlcGxheSByZXNwb25zZSBpcyBtaXNzaW5nIHJlc3VsdHNcIilcblxuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gKi9cbiAgICBjb25zdCBieUtleSA9IG5ldyBNYXAoKVxuXG4gICAgZm9yIChjb25zdCByZXN1bHQgb2YgcmVzcG9uc2VSZWNvcmQucmVzdWx0cykge1xuICAgICAgaWYgKCFyZXN1bHQgfHwgdHlwZW9mIHJlc3VsdCAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHJlc3VsdCkpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IHJlc3VsdFJlY29yZCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59ICovIChyZXN1bHQpXG5cbiAgICAgIGlmICh0eXBlb2YgcmVzdWx0UmVjb3JkLmlkZW1wb3RlbmN5S2V5ICE9PSBcInN0cmluZ1wiKSBjb250aW51ZVxuXG4gICAgICBieUtleS5zZXQocmVzdWx0UmVjb3JkLmlkZW1wb3RlbmN5S2V5LCAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHJlc3VsdFJlY29yZCkpXG4gICAgfVxuXG4gICAgcmV0dXJuIGJ5S2V5XG4gIH1cblxuICAvKipcbiAgICogRXhwb3J0cyB0aGUgZHVyYWJsZSBub24tdGVybWluYWwgbXV0YXRpb25zIG9mIGV2ZXJ5IHNlc3Npb24gbG9nIGFzIG9uZVxuICAgKiBzaWduZWQgcGVlciBidW5kbGUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbb3B0aW9uc10gLSBFeHBvcnQgb3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2xvY2FsLW11dGF0aW9uLWxvZy5qc1wiKS5Mb2NhbE11dGF0aW9uU3RhdHVzW119IFtvcHRpb25zLnN0YXR1c2VzXSAtIFN0YXR1c2VzIHRvIGV4cG9ydC5cbiAgICogQHBhcmFtIHsoKSA9PiBEYXRlfSBbb3B0aW9ucy5ub3ddIC0gRXhwb3J0IGNsb2NrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3BlZXItbXV0YXRpb24tYnVuZGxlLmpzXCIpLlBlZXJNdXRhdGlvbkJ1bmRsZT59IC0gU2lnbmVkIHBlZXIgYnVuZGxlLlxuICAgKi9cbiAgYXN5bmMgZXhwb3J0QnVuZGxlKG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGlkZW50aXR5ID0gYXdhaXQgdGhpcy5fZW5zdXJlSWRlbnRpdHkoKVxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9wZWVyLW11dGF0aW9uLWJ1bmRsZS5qc1wiKS5QZWVyTXV0YXRpb25CdW5kbGVbXCJtdXRhdGlvbnNcIl19ICovXG4gICAgY29uc3QgbXV0YXRpb25zID0gW11cbiAgICBsZXQgYnVuZGxlID0gbnVsbFxuXG4gICAgZm9yIChjb25zdCBtdXRhdGlvbkxvZyBvZiB0aGlzLm11dGF0aW9uTG9ncykge1xuICAgICAgY29uc3QgbG9nQnVuZGxlID0gYXdhaXQgZXhwb3J0UGVlck11dGF0aW9uQnVuZGxlKHtcbiAgICAgICAgZGV2aWNlQ2VydGlmaWNhdGU6IGlkZW50aXR5LmNlcnRpZmljYXRlLFxuICAgICAgICBkZXZpY2VQcml2YXRlS2V5OiBpZGVudGl0eS5wcml2YXRlS2V5LFxuICAgICAgICBtdXRhdGlvbkxvZyxcbiAgICAgICAgLi4ub3B0aW9uc1xuICAgICAgfSlcblxuICAgICAgaWYgKCFidW5kbGUpIGJ1bmRsZSA9IGxvZ0J1bmRsZVxuICAgICAgZWxzZSBtdXRhdGlvbnMucHVzaCguLi5sb2dCdW5kbGUubXV0YXRpb25zKVxuICAgIH1cblxuICAgIGlmICghYnVuZGxlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jIG9mZmxpbmUgc2Vzc2lvbiBleHBvcnQgcHJvZHVjZWQgbm8gYnVuZGxlXCIpXG4gICAgfVxuXG4gICAgYnVuZGxlLm11dGF0aW9ucyA9IG11dGF0aW9ucy5sZW5ndGggPiAwID8gWy4uLmJ1bmRsZS5tdXRhdGlvbnMsIC4uLm11dGF0aW9uc10uc29ydCgobGVmdCwgcmlnaHQpID0+IChsZWZ0LmxvY2FsU2VxdWVuY2UgfHwgMCkgLSAocmlnaHQubG9jYWxTZXF1ZW5jZSB8fCAwKSkgOiBidW5kbGUubXV0YXRpb25zXG5cbiAgICByZXR1cm4gYnVuZGxlXG4gIH1cblxuICAvKipcbiAgICogSW1wb3J0cyBhIHBlZXIgYnVuZGxlOiBldmVyeSBlbnRyeSBpcyB2ZXJpZmllZCBhZ2FpbnN0IHRoZSBjb25maWd1cmVkXG4gICAqIGJhY2tlbmQgcHVibGljIGtleSBiZWZvcmUgaXQgaXMgYXBwZW5kZWQgdG8gYSBsb2NhbCBtdXRhdGlvbiBsb2cuIEVudHJpZXNcbiAgICogYWxyZWFkeSBwcmVzZW50IGJ5IGlkZW1wb3RlbmN5IGtleSBhcmUgc2tpcHBlZCBhcyBkdXBsaWNhdGVzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEltcG9ydCBhcmdzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vcGVlci1tdXRhdGlvbi1idW5kbGUuanNcIikuUGVlck11dGF0aW9uQnVuZGxlfSBhcmdzLmJ1bmRsZSAtIFBlZXIgYnVuZGxlIHRvIGltcG9ydC5cbiAgICogQHBhcmFtIHtBcnJheTxpbXBvcnQoXCIuL29mZmxpbmUtZ3JhbnQuanNcIikuU2lnbmVkT2ZmbGluZUdyYW50Pn0gW2FyZ3Muc2lnbmVkT2ZmbGluZUdyYW50c10gLSBHcmFudHMgdGhlIHBlZXIgc2lnbmVkIGl0cyBtdXRhdGlvbnMgdW5kZXIuIFRoZXkgYXJlIHJldGFpbmVkIHNvIGltcG9ydGVkIG11dGF0aW9ucyByZXBsYXkgd2l0aCB0aGUgZ3JhbnQgdGhlaXIgc2lnbmVyIHVzZWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9sb2NhbC1tdXRhdGlvbi1sb2cuanNcIikuZGVmYXVsdH0gW2FyZ3MubXV0YXRpb25Mb2ddIC0gVGFyZ2V0IGxvZy4gRGVmYXVsdHMgdG8gdGhlIGZpcnN0IHNlc3Npb24gbG9nLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3BlZXItbXV0YXRpb24tYnVuZGxlLmpzXCIpLlBlZXJNdXRhdGlvbkJ1bmRsZUltcG9ydFJlc3VsdD59IC0gSW1wb3J0IHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGltcG9ydEJ1bmRsZSh7YnVuZGxlLCBtdXRhdGlvbkxvZywgc2lnbmVkT2ZmbGluZUdyYW50cyA9IFtdfSkge1xuICAgIGlmICghdGhpcy5jb25maWcuYmFja2VuZFB1YmxpY0tleSkgdGhyb3cgbmV3IEVycm9yKFwic3luYy5jbGllbnQub2ZmbGluZS5iYWNrZW5kUHVibGljS2V5IGlzIHJlcXVpcmVkIHRvIGltcG9ydCBhIHBlZXIgbXV0YXRpb24gYnVuZGxlXCIpXG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHNpZ25lZE9mZmxpbmVHcmFudHMpKSB0aHJvdyBuZXcgRXJyb3IoXCJzeW5jIG9mZmxpbmUgaW1wb3J0IHNpZ25lZE9mZmxpbmVHcmFudHMgbXVzdCBiZSBhbiBhcnJheSBvZiBzaWduZWQgb2ZmbGluZSBncmFudHNcIilcblxuICAgIGZvciAoY29uc3Qgc2lnbmVkR3JhbnQgb2Ygc2lnbmVkT2ZmbGluZUdyYW50cykge1xuICAgICAgaWYgKCFzaWduZWRHcmFudCB8fCB0eXBlb2Ygc2lnbmVkR3JhbnQgIT09IFwib2JqZWN0XCIgfHwgIXNpZ25lZEdyYW50LmdyYW50IHx8IHR5cGVvZiBzaWduZWRHcmFudC5ncmFudC5ncmFudElkICE9PSBcInN0cmluZ1wiKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcInN5bmMgb2ZmbGluZSBpbXBvcnQgcmVxdWlyZXMgc2lnbmVkIG9mZmxpbmUgZ3JhbnQgZW52ZWxvcGVzIHdpdGggZ3JhbnQgcGF5bG9hZHNcIilcbiAgICAgIH1cblxuICAgICAgdGhpcy5fZ3JhbnRzLnNldChzaWduZWRHcmFudC5ncmFudC5ncmFudElkLCBzaWduZWRHcmFudClcbiAgICB9XG5cbiAgICBpZiAoc2lnbmVkT2ZmbGluZUdyYW50cy5sZW5ndGggPiAwKSBhd2FpdCB0aGlzLl9wZXJzaXN0R3JhbnRzKClcblxuICAgIHJldHVybiBhd2FpdCBpbXBvcnRQZWVyTXV0YXRpb25CdW5kbGUoe1xuICAgICAgYmFja2VuZFB1YmxpY0tleTogdGhpcy5jb25maWcuYmFja2VuZFB1YmxpY0tleSxcbiAgICAgIGJ1bmRsZSxcbiAgICAgIG11dGF0aW9uTG9nOiBtdXRhdGlvbkxvZyB8fCB0aGlzLm11dGF0aW9uTG9nc1swXVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUGVyc2lzdHMgcmV0YWluZWQgZ3JhbnRzIHRocm91Z2ggdGhlIG9wdGlvbmFsIGFwcC1vd25lZCBncmFudCBzdG9yYWdlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciByZXRlbnRpb24gaXMgcGVyc2lzdGVkLlxuICAgKi9cbiAgYXN5bmMgX3BlcnNpc3RHcmFudHMoKSB7XG4gICAgaWYgKCF0aGlzLmNvbmZpZy5ncmFudFN0b3JhZ2UpIHJldHVyblxuXG4gICAgYXdhaXQgdGhpcy5jb25maWcuZ3JhbnRTdG9yYWdlLnNhdmUoQXJyYXkuZnJvbSh0aGlzLl9ncmFudHMudmFsdWVzKCkpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIHNlc3Npb24gY2xvY2suXG4gICAqIEByZXR1cm5zIHtEYXRlfSAtIEN1cnJlbnQgdGltZS5cbiAgICovXG4gIF9ub3coKSB7XG4gICAgcmV0dXJuIHRoaXMuY29uZmlnLm5vdygpXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgZGV2aWNlIGlkZW50aXR5IG9yIGZhaWxzIGNsb3NlZC5cbiAgICogQHJldHVybnMge1N5bmNPZmZsaW5lRGV2aWNlSWRlbnRpdHl9IC0gRGV2aWNlIGlkZW50aXR5LlxuICAgKi9cbiAgX3JlcXVpcmVJZGVudGl0eSgpIHtcbiAgICBpZiAoIXRoaXMuX2lkZW50aXR5KSB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jIG9mZmxpbmUgc2Vzc2lvbiBoYXMgbm8gZGV2aWNlIGlkZW50aXR5IC0gY2FsbCBzdGFydE9mZmxpbmVTZXNzaW9uKCkgZmlyc3RcIilcblxuICAgIHJldHVybiB0aGlzLl9pZGVudGl0eVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGxpdmUgZ3JhbnQgb3IgZmFpbHMgY2xvc2VkLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9vZmZsaW5lLWdyYW50LmpzXCIpLlNpZ25lZE9mZmxpbmVHcmFudH0gLSBMaXZlIGdyYW50LlxuICAgKi9cbiAgX3JlcXVpcmVMaXZlR3JhbnQoKSB7XG4gICAgY29uc3QgZ3JhbnQgPSB0aGlzLl9saXZlR3JhbnQoKVxuXG4gICAgaWYgKCFncmFudCkgdGhyb3cgbmV3IEVycm9yKFwiU3luYyBvZmZsaW5lIHNlc3Npb24gaGFzIG5vIGxpdmUgb2ZmbGluZSBncmFudCAtIGNhbGwgc3RhcnRPZmZsaW5lU2Vzc2lvbigpIG9yIHJlZnJlc2hPZmZsaW5lR3JhbnQoKVwiKVxuXG4gICAgcmV0dXJuIGdyYW50XG4gIH1cbn1cblxuLyoqXG4gKiBDbG9uZXMgYSBKU09OIG9iamVjdC5cbiAqIEBwYXJhbSB7dW5rbm93bn0gdmFsdWUgLSBWYWx1ZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBsYWJlbCAtIERpYWdub3N0aWMgbGFiZWwuXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIENsb25lZCBvYmplY3QuXG4gKi9cbmZ1bmN0aW9uIGNsb25lSnNvbih2YWx1ZSwgbGFiZWwpIHtcbiAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgc3luYyBvZmZsaW5lICR7bGFiZWx9IG9iamVjdGApXG5cbiAgcmV0dXJuIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeSh2YWx1ZSkpKVxufVxuXG4vKipcbiAqIFRocm93cyB0aGUgZXhhY3QgYWJvcnQgcmVhc29uIGF0IGxpZmVjeWNsZSBib3VuZGFyaWVzLlxuICogQHBhcmFtIHtBYm9ydFNpZ25hbCB8IHVuZGVmaW5lZH0gc2lnbmFsIC0gTGlmZWN5Y2xlIHNpZ25hbC5cbiAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAqL1xuZnVuY3Rpb24gdGhyb3dJZkFib3J0ZWQoc2lnbmFsKSB7XG4gIGlmICghc2lnbmFsPy5hYm9ydGVkKSByZXR1cm5cblxuICB0aHJvdyBzaWduYWwucmVhc29uIGluc3RhbmNlb2YgRXJyb3IgPyBzaWduYWwucmVhc29uIDogbmV3IEVycm9yKFwiU3luYyBvZmZsaW5lIHJlcGxheSBhYm9ydGVkXCIpXG59XG4iXX0=