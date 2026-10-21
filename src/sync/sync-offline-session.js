// @ts-check

import {
  createSignedMutation,
  generateSyncSigningKeyPair,
  mutationIdempotencyKey,
  verifyDeviceCertificate
} from "./device-identity.js"
import {exportPeerMutationBundle, importPeerMutationBundle} from "./peer-mutation-bundle.js"
import {replayResultLocalStatus} from "./conflict-strategy.js"

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
  constructor({authenticationToken, config, mutationLogs, post}) {
    if (!Array.isArray(mutationLogs) || mutationLogs.length === 0) throw new Error("SyncOfflineSession requires at least one mutation log")

    this.authenticationToken = authenticationToken
    this.config = config
    this.mutationLogs = mutationLogs
    this.post = post

    /** @type {SyncOfflineDeviceIdentity | null} */
    this._identity = null
    /** @type {Map<string, import("./offline-grant.js").SignedOfflineGrant>} */
    this._grants = new Map()
    this._grantsLoaded = false
    /** @type {import("./offline-grant.js").SignedOfflineGrant | null} */
    this._activeGrant = null
    /** @type {Record<string, import("../configuration-types.js").NormalizedFrontendModelResourceSyncConfiguration> | null} */
    this._syncManifest = null
    /** @type {Promise<SyncOfflineSessionSummary> | null} */
    this._startPromise = null
    /** @type {Promise<SyncOfflineReplayResult> | null} */
    this._replayPromise = null
  }

  /**
   * Whether the session currently has a usable device identity and live grant.
   * @returns {boolean} - Whether the session is active.
   */
  isActive() {
    return Boolean(this._identity && this._liveGrant())
  }

  /**
   * Resolves the device signing identity (generating and enrolling a key pair
   * when the app-owned storage has none) and bootstraps a live offline grant.
   * Idempotent and single-flighted: concurrent starts share one bootstrap.
   * @returns {Promise<SyncOfflineSessionSummary>} - Session summary.
   */
  async start() {
    if (this._identity && this._liveGrant()) return this.sessionSummary()

    if (!this._startPromise) {
      this._startPromise = this._startSession().then((summary) => {
        this._startPromise = null

        return summary
      }, (error) => {
        this._startPromise = null

        throw error
      })
    }

    return await this._startPromise
  }

  /**
   * Drops the in-memory session (identity and grants stay in the app-owned
   * durable storage; pending mutations stay in the durable mutation logs).
   * @returns {Promise<void>} - Resolves after the session is dropped.
   */
  async stop() {
    if (this._replayPromise) await this._replayPromise.catch(() => undefined)

    this._identity = null
    this._activeGrant = null
    this._syncManifest = null
    this._grantsLoaded = false
  }

  /**
   * Runs one start attempt: identity first, then grant bootstrap.
   * @returns {Promise<SyncOfflineSessionSummary>} - Session summary.
   */
  async _startSession() {
    await this._ensureIdentity()
    await this._loadRetainedGrants()
    await this._ensureLiveGrant()

    return this.sessionSummary()
  }

  /**
   * Returns the current session summary.
   * @returns {SyncOfflineSessionSummary} - Session summary.
   */
  sessionSummary() {
    const identity = this._requireIdentity()
    const grant = this._requireLiveGrant()

    return {
      actorDeviceId: identity.certificate.certificate.actorDeviceId,
      actorUserId: identity.certificate.certificate.actorUserId,
      expiresAt: grant.grant.expiresAt,
      grantId: grant.grant.grantId
    }
  }

  /**
   * Resolves the device identity: load it from the app-owned storage, or
   * generate a key pair, run the app-owned enrollment hook, verify the returned
   * certificate against the configured backend public key, and store it.
   * @returns {Promise<SyncOfflineDeviceIdentity>} - Device signing identity.
   */
  async _ensureIdentity() {
    if (this._identity) return this._identity

    const stored = await this.config.deviceIdentityStorage.load()

    if (stored) {
      this._identity = await this._verifiedIdentity(stored)

      return this._identity
    }

    const keyPair = await generateSyncSigningKeyPair()
    const certificate = await this.config.enrollDevice({
      configuration: this.config.configuration,
      publicKey: keyPair.publicKey
    })
    const identity = await this._verifiedIdentity({certificate, privateKey: keyPair.privateKey})

    await this.config.deviceIdentityStorage.save(/** @type {SyncOfflineDeviceIdentity} */ (cloneJson(identity, "device identity")))

    this._identity = identity

    return identity
  }

  /**
   * Verifies a stored/enrolled certificate against the configured backend
   * public key (when one is configured) and returns the identity.
   * @param {SyncOfflineDeviceIdentity} identity - Candidate identity.
   * @returns {Promise<SyncOfflineDeviceIdentity>} - Verified identity.
   */
  async _verifiedIdentity(identity) {
    if (!identity || typeof identity !== "object" || Array.isArray(identity)) {
      throw new Error("sync.client.offline device identity storage must provide {certificate, privateKey} or null")
    }
    if (!identity.certificate || !identity.privateKey) throw new Error("sync.client.offline device identity requires a certificate and a privateKey")

    if (this.config.backendPublicKey) {
      await verifyDeviceCertificate({
        backendPublicKey: this.config.backendPublicKey,
        certificate: identity.certificate
      })
    }

    return identity
  }

  /**
   * Loads app-retained grants once so a restarted device can still replay
   * mutations that were signed under an older grant (peer-forwarded mutations
   * keep the grant their original signer used).
   * @returns {Promise<void>} - Resolves after retention is loaded.
   */
  async _loadRetainedGrants() {
    if (this._grantsLoaded) return

    this._grantsLoaded = true
    if (!this.config.grantStorage) return

    const retained = await this.config.grantStorage.load()

    if (!Array.isArray(retained)) throw new Error("sync.client.offline grantStorage.load must resolve an array of signed offline grants")

    for (const signedGrant of retained) {
      if (!signedGrant || typeof signedGrant !== "object" || !signedGrant.grant || typeof signedGrant.grant.grantId !== "string") continue

      this._grants.set(signedGrant.grant.grantId, signedGrant)
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
    if (!this._activeGrant) return null
    if (new Date(this._activeGrant.grant.expiresAt).getTime() <= now.getTime()) return null

    return this._activeGrant
  }

  /**
   * Ensures a live grant exists, bootstrapping a new one when the current grant
   * is missing or expired. A refreshed grant re-signs this device's pending
   * records so the backend always sees the grant an intent is replayed under.
   * @returns {Promise<import("./offline-grant.js").SignedOfflineGrant>} - Live grant.
   */
  async _ensureLiveGrant() {
    const live = this._liveGrant()

    if (live) return live

    const granted = await this.bootstrapGrant()

    await this._resignPendingRecords(granted)

    return granted
  }

  /**
   * Requests a fresh offline grant from the built-in sync bootstrap endpoint
   * and retains it under its grant id together with the sync manifest whose
   * policy hashes mutations are signed against.
   * @returns {Promise<import("./offline-grant.js").SignedOfflineGrant>} - Newly issued grant.
   */
  async bootstrapGrant() {
    const identity = await this._ensureIdentity()
    const authenticationToken = await this.authenticationToken()
    const scopes = await this.config.grantScopes({configuration: this.config.configuration})

    if (!scopes || typeof scopes !== "object" || Array.isArray(scopes)) throw new Error("sync.client.offline.grantScopes must resolve a plain object of grant scopes")

    const response = await this.post(this.config.bootstrapPath, {
      authenticationToken,
      deviceId: identity.certificate.certificate.actorDeviceId,
      scopes
    })

    if (!response || typeof response !== "object" || Array.isArray(response)) {
      throw new Error(`Sync offline bootstrap did not return a response object (${this.config.bootstrapPath})`)
    }

    const responseRecord = /** @type {Record<string, unknown>} */ (response)
    const signedGrant = /** @type {import("./offline-grant.js").SignedOfflineGrant | undefined} */ (responseRecord.offlineGrant)

    if (!signedGrant || typeof signedGrant !== "object" || !signedGrant.grant || typeof signedGrant.grant.grantId !== "string") {
      throw new Error(`Sync offline bootstrap did not return a signed offline grant (${this.config.bootstrapPath})`)
    }

    const manifest = /** @type {Record<string, import("../configuration-types.js").NormalizedFrontendModelResourceSyncConfiguration> | undefined} */ (responseRecord.syncManifest)

    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
      throw new Error(`Sync offline bootstrap did not return a sync manifest (${this.config.bootstrapPath})`)
    }

    this._grants.set(signedGrant.grant.grantId, signedGrant)
    this._activeGrant = signedGrant
    this._syncManifest = manifest
    await this._persistGrants()

    return signedGrant
  }

  /**
   * Forces a grant refresh: bootstrap a new grant and re-sign this device's
   * pending records under it.
   * @returns {Promise<SyncOfflineSessionSummary>} - Refreshed session summary.
   */
  async refreshGrant() {
    await this._ensureIdentity()
    await this._loadRetainedGrants()

    const granted = await this.bootstrapGrant()

    await this._resignPendingRecords(granted)

    return this.sessionSummary()
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
    this._requireIdentity()

    for (const mutationLog of this.mutationLogs) {
      for (const record of await mutationLog.pendingRecords()) {
        if (!this._isOwnRecord(record)) continue
        if (record.mutation.offlineGrantId === signedGrant.grant.grantId && record.signedMutation) continue

        const signedMutation = await this.signMutation(record.mutation)

        await mutationLog.updateMutation({id: record.id, mutation: signedMutation.mutation, signedMutation})
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
    const identity = this._requireIdentity()

    if (record.signedMutation) {
      return record.signedMutation.mutation.actorDeviceId === identity.certificate.certificate.actorDeviceId &&
        record.signedMutation.mutation.actorUserId === identity.certificate.certificate.actorUserId
    }

    return !record.mutation.actorDeviceId || (
      record.mutation.actorDeviceId === identity.certificate.certificate.actorDeviceId &&
      record.mutation.actorUserId === identity.certificate.certificate.actorUserId
    )
  }

  /**
   * Signs one mutation payload with the device key under the live grant,
   * filling the actor/grant/policy-hash identity from the session.
   * @param {Omit<import("./device-identity.js").SyncMutation, "actorDeviceId" | "actorUserId" | "offlineGrantId" | "policyHash">} mutation - Mutation payload to sign (the session supplies the rotating identity fields).
   * @returns {Promise<import("./device-identity.js").SignedSyncMutation>} - Signed mutation envelope.
   */
  async signMutation(mutation) {
    const identity = await this._ensureIdentity()
    const grant = await this._grantForSigning()

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
    })
  }

  /**
   * Returns the grant a new mutation is signed under: the live grant when one
   * exists, otherwise the newest retained grant (queueing stays possible while
   * offline - the replay pass refreshes the grant and re-signs the pending
   * records), and only bootstraps when no grant has ever been retained.
   * @returns {Promise<import("./offline-grant.js").SignedOfflineGrant>} - Grant to sign under.
   */
  async _grantForSigning() {
    const live = this._liveGrant()

    if (live) return live
    if (this._activeGrant) return this._activeGrant

    await this._loadRetainedGrants()

    const retained = Array.from(this._grants.values()).sort((left, right) => new Date(right.grant.issuedAt).getTime() - new Date(left.grant.issuedAt).getTime())

    if (retained.length > 0) {
      this._activeGrant = retained[0]

      return this._activeGrant
    }

    return await this.bootstrapGrant()
  }

  /**
   * Returns the policy hash the live session's sync manifest carries for one model.
   * @param {string} model - Model/resource name.
   * @returns {string} - Policy hash.
   */
  policyHashFor(model) {
    const manifest = this._syncManifest || this._activeGrant?.grant.resources

    if (!manifest) throw new Error("Sync offline session has no sync manifest - call startOfflineSession() first")

    const entry = /** @type {Record<string, unknown> | undefined} */ (manifest[model])
    const policyHash = entry && typeof entry === "object" && !Array.isArray(entry) ? /** @type {Record<string, unknown>} */ (entry).policyHash : undefined

    if (typeof policyHash !== "string" || policyHash.length === 0) {
      throw new Error(`Sync offline session has no policy hash for model '${model}' - is it sync-enabled on the backend?`)
    }

    return policyHash
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
    if (this._replayPromise) return await this._replayPromise

    this._replayPromise = this._replayPass(options).finally(() => {
      this._replayPromise = null
    })

    return await this._replayPromise
  }

  /**
   * Runs one signed replay pass.
   * @param {object} options - Pass options.
   * @param {number} [options.batchSize] - Max mutations per request.
   * @param {AbortSignal} [options.signal] - Lifecycle cancellation signal.
   * @returns {Promise<SyncOfflineReplayResult>} - Mapped replay result.
   */
  async _replayPass({batchSize, signal} = {}) {
    throwIfAborted(signal)

    if (!this.isActive()) await this.start()

    const maxBatchSize = typeof batchSize === "number" && batchSize >= 1 ? Math.floor(batchSize) : 100
    /** @type {SyncOfflineReplayResult["results"]} */
    const results = []
    let syncedCount = 0
    let conflictCount = 0
    let rejectedCount = 0

    for (let pass = 0; pass < 10; pass += 1) {
      throwIfAborted(signal)
      await this._ensureLiveGrant()

      /** @type {Array<{mutationLog: import("./local-mutation-log.js").default, record: import("./local-mutation-log.js").LocalMutationLogRecord}>} */
      const entries = []

      for (const mutationLog of this.mutationLogs) {
        for (const record of await mutationLog.pendingRecords()) {
          if (!record.signedMutation) continue
          // A record can only replay with the grant it was signed under. Records
          // whose grant the session does not retain (e.g. peer imports without
          // their signer's grant) stay pending instead of blocking the batch.
          if (!this._grants.has(record.mutation.offlineGrantId)) continue

          entries.push({mutationLog, record})
        }
      }

      if (entries.length === 0) break

      const batch = entries.slice(0, maxBatchSize)
      const authenticationToken = await this.authenticationToken()
      const mutations = batch.map((entry) => this._replayMutation(entry.record))
      const response = await this.post(this.config.replayPath, {authenticationToken, mutations}, {signal})

      throwIfAborted(signal)

      const resultsByIdempotencyKey = this._replayResultsById(response)

      for (const {mutationLog, record} of batch) {
        throwIfAborted(signal)
        const idempotencyKey = mutationIdempotencyKey(/** @type {import("./device-identity.js").SignedSyncMutation} */ (record.signedMutation))
        const result = resultsByIdempotencyKey.get(idempotencyKey)

        if (!result) throw new Error(`Signed sync replay response is missing a result for mutation ${record.mutation.clientMutationId}`)

        const status = replayResultLocalStatus(/** @type {Record<string, import("./conflict-strategy.js").SyncJsonValue>} */ (result))
        const serverResult = cloneJson(result, "sync replay result")
        const updated = await mutationLog.updateStatus({
          id: record.id,
          status,
          syncResult: /** @type {Record<string, import("../frontend-models/base.js").FrontendModelTransportValue>} */ (serverResult)
        })

        results.push({
          clientMutationId: record.mutation.clientMutationId,
          idempotencyKey,
          mutation: /** @type {import("./device-identity.js").SyncMutation} */ (cloneJson(record.mutation, "mutation")),
          recordId: updated.id,
          serverResult,
          status: updated.status
        })

        if (updated.status === "synced") syncedCount += 1
        if (updated.status === "conflict") conflictCount += 1
        if (updated.status === "rejected") rejectedCount += 1
      }
    }

    let pendingCount = 0

    for (const mutationLog of this.mutationLogs) {
      pendingCount += (await mutationLog.pendingRecords()).length
    }

    return {conflictCount, pendingCount, rejectedCount, results, syncedCount}
  }

  /**
   * Builds one signed replay mutation: the signed envelope plus the signed
   * grant the mutation was signed under. Fails closed when the session does
   * not retain that grant.
   * @param {import("./local-mutation-log.js").LocalMutationLogRecord} record - Durable record.
   * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Replay mutation payload.
   */
  _replayMutation(record) {
    const signedMutation = /** @type {import("./device-identity.js").SignedSyncMutation} */ (record.signedMutation)
    const signedGrant = this._grants.get(signedMutation.mutation.offlineGrantId)

    if (!signedGrant) throw new Error(`Sync offline session has no retained grant '${signedMutation.mutation.offlineGrantId}' for mutation ${signedMutation.mutation.clientMutationId}`)

    return {...cloneJson(signedMutation, "signed mutation"), signedOfflineGrant: cloneJson(signedGrant, "signed offline grant")}
  }

  /**
   * Normalizes a signed replay response into results keyed by idempotency key.
   * @param {ReturnType<typeof JSON.parse>} response - Raw replay response.
   * @returns {Map<string, Record<string, ReturnType<typeof JSON.parse>>>} - Results by idempotency key.
   */
  _replayResultsById(response) {
    if (!response || typeof response !== "object" || Array.isArray(response)) throw new Error("Signed sync replay response must be an object")

    const responseRecord = /** @type {Record<string, unknown>} */ (response)

    if (responseRecord.status === "error") throw new Error(typeof responseRecord.errorMessage === "string" ? responseRecord.errorMessage : "Signed sync replay failed")
    if (!Array.isArray(responseRecord.results)) throw new Error("Signed sync replay response is missing results")

    /** @type {Map<string, Record<string, ReturnType<typeof JSON.parse>>>} */
    const byKey = new Map()

    for (const result of responseRecord.results) {
      if (!result || typeof result !== "object" || Array.isArray(result)) continue

      const resultRecord = /** @type {Record<string, unknown>} */ (result)

      if (typeof resultRecord.idempotencyKey !== "string") continue

      byKey.set(resultRecord.idempotencyKey, /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (resultRecord))
    }

    return byKey
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
    const identity = await this._ensureIdentity()
    /** @type {import("./peer-mutation-bundle.js").PeerMutationBundle["mutations"]} */
    const mutations = []
    let bundle = null

    for (const mutationLog of this.mutationLogs) {
      const logBundle = await exportPeerMutationBundle({
        deviceCertificate: identity.certificate,
        devicePrivateKey: identity.privateKey,
        mutationLog,
        ...options
      })

      if (!bundle) bundle = logBundle
      else mutations.push(...logBundle.mutations)
    }

    if (!bundle) {
      throw new Error("Sync offline session export produced no bundle")
    }

    bundle.mutations = mutations.length > 0 ? [...bundle.mutations, ...mutations].sort((left, right) => (left.localSequence || 0) - (right.localSequence || 0)) : bundle.mutations

    return bundle
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
  async importBundle({bundle, mutationLog, signedOfflineGrants = []}) {
    if (!this.config.backendPublicKey) throw new Error("sync.client.offline.backendPublicKey is required to import a peer mutation bundle")
    if (!Array.isArray(signedOfflineGrants)) throw new Error("sync offline import signedOfflineGrants must be an array of signed offline grants")

    for (const signedGrant of signedOfflineGrants) {
      if (!signedGrant || typeof signedGrant !== "object" || !signedGrant.grant || typeof signedGrant.grant.grantId !== "string") {
        throw new Error("sync offline import requires signed offline grant envelopes with grant payloads")
      }

      this._grants.set(signedGrant.grant.grantId, signedGrant)
    }

    if (signedOfflineGrants.length > 0) await this._persistGrants()

    return await importPeerMutationBundle({
      backendPublicKey: this.config.backendPublicKey,
      bundle,
      mutationLog: mutationLog || this.mutationLogs[0]
    })
  }

  /**
   * Persists retained grants through the optional app-owned grant storage.
   * @returns {Promise<void>} - Resolves after retention is persisted.
   */
  async _persistGrants() {
    if (!this.config.grantStorage) return

    await this.config.grantStorage.save(Array.from(this._grants.values()))
  }

  /**
   * Returns the session clock.
   * @returns {Date} - Current time.
   */
  _now() {
    return this.config.now()
  }

  /**
   * Returns the device identity or fails closed.
   * @returns {SyncOfflineDeviceIdentity} - Device identity.
   */
  _requireIdentity() {
    if (!this._identity) throw new Error("Sync offline session has no device identity - call startOfflineSession() first")

    return this._identity
  }

  /**
   * Returns the live grant or fails closed.
   * @returns {import("./offline-grant.js").SignedOfflineGrant} - Live grant.
   */
  _requireLiveGrant() {
    const grant = this._liveGrant()

    if (!grant) throw new Error("Sync offline session has no live offline grant - call startOfflineSession() or refreshOfflineGrant()")

    return grant
  }
}

/**
 * Clones a JSON object.
 * @param {unknown} value - Value.
 * @param {string} label - Diagnostic label.
 * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Cloned object.
 */
function cloneJson(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Expected sync offline ${label} object`)

  return /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (JSON.parse(JSON.stringify(value)))
}

/**
 * Throws the exact abort reason at lifecycle boundaries.
 * @param {AbortSignal | undefined} signal - Lifecycle signal.
 * @returns {void} - No return value.
 */
function throwIfAborted(signal) {
  if (!signal?.aborted) return

  throw signal.reason instanceof Error ? signal.reason : new Error("Sync offline replay aborted")
}
