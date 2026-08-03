// @ts-check

import SyncEnvelopeReplayService from "./sync-envelope-replay-service.js"
import {verifyOfflineGrant} from "./offline-grant.js"
import {mutationIdempotencyKey, verifySignedMutation} from "./device-identity.js"
import VelociousError from "../velocious-error.js"

/**
 * @typedef {import("./device-identity.js").SignedSyncMutation} SignedSyncMutation
 * @typedef {import("./offline-grant.js").SignedOfflineGrant} SignedOfflineGrant
 */

/**
 * Sync-envelope replay service that authenticates via backend-signed device
 * certificates and signed offline grants instead of online session tokens.
 *
 * This is the generic Velocious primitive for long-offline and peer-forwarded
 * mutations: the HTTP uploader may differ from the mutation actor, but replay
 * authority is derived from the signed envelope and grant, not the uploader's
 * session.
 */
export default class SignedSyncEnvelopeReplayService extends SyncEnvelopeReplayService {
  /**
   * Creates a signed sync-envelope replay service.
   * @param {object} args - Constructor arguments.
   * @param {import("./device-identity.js").SyncJsonWebKey} args.backendPublicKey - Backend public key used to verify device certificates.
   * @param {Array<import("./offline-grant.js").OfflineGrantSigningKey>} [args.offlineGrantSigningKeys] - Offline-grant verification keys.
   * @param {(userId: string) => Promise<{id: () => string} | null>} [args.actorLookup] - Optional lookup from grant user id to an actor object with an `id()` method. Defaults to a wrapper around the grant user id.
   * @param {Record<string, ?>} [args.rest] - Remaining arguments forwarded to {@link SyncEnvelopeReplayService}.
   */
  constructor({backendPublicKey, offlineGrantSigningKeys, actorLookup, ...rest}) {
    super({
      actorForeignKeyColumn: "authenticationTokenId",
      ...rest
    })

    if (!backendPublicKey) throw new Error("SignedSyncEnvelopeReplayService requires backendPublicKey")

    this.backendPublicKey = backendPublicKey
    this.offlineGrantSigningKeys = offlineGrantSigningKeys || []
    this.actorLookup = actorLookup || null
  }

  /**
   * Verifies signed mutations and then runs the generic replay loop over the
   * derived sync envelopes. Verified actor and derived syncs are kept in the
   * request-local `requestState` object so concurrent replay calls on one
   * service instance cannot cross their authentication state.
   * @param {Record<string, ?>} params - Request params.
   * @param {Record<string, ?>} [requestState] - Request-local state shared with the base replay hooks.
   * @returns {Promise<{syncs: Array<Record<string, ?>>}>} Replay response.
   */
  async replay(params, requestState = {}) {
    const verified = await this.verifyAndTransformSignedReplay(params)

    requestState.signedReplayActor = verified.actor
    requestState.signedReplaySyncs = verified.syncs

    const result = await super.replay(params, requestState)

    return {
      syncs: result.syncs.map((syncResponse, index) => {
        const {id: _id, ...rest} = syncResponse
        const idempotencyKey = verified.syncs[index]?.idempotencyKey

        return idempotencyKey ? {...rest, idempotencyKey} : syncResponse
      })
    }
  }

  /**
   * Returns the verified actor prepared during {@link SignedSyncEnvelopeReplayService#replay}.
   * @param {Record<string, ?>} _params - Request params.
   * @param {Record<string, ?>} requestState - Request-local state.
   * @returns {Promise<{authenticated: true, actor: ?} | {authenticated: false, errorCode: string, errorMessage: string}>} Auth result.
   */
  async authenticateReplay(_params, requestState) {
    const actor = requestState?.signedReplayActor

    if (!actor) {
      return {
        authenticated: false,
        errorCode: "missing-signed-replay",
        errorMessage: "Expected a pre-verified signed replay"
      }
    }

    return {actor, authenticated: true}
  }

  /**
   * Returns the sync envelopes derived from the verified signed mutations.
   * @param {Record<string, ?>} _params - Request params.
   * @param {Record<string, ?>} requestState - Request-local state.
   * @returns {Array<Record<string, ?>>} Sync envelopes.
   */
  replaySyncs(_params, requestState) {
    return requestState?.signedReplaySyncs || []
  }

  /**
   * Verifies every signed mutation, its offline grant, and the actor/grant
   * consistency, then transforms the envelopes into the sync format the base
   * replay service understands.
   * @param {Record<string, ?>} params - Request params.
   * @returns {Promise<{actor: ?, syncs: Array<Record<string, ?>>}>} Verified actor and derived syncs.
   */
  async verifyAndTransformSignedReplay(params) {
    const rawEntries = Array.isArray(params.signedMutations) ? params.signedMutations : []

    if (rawEntries.length === 0) {
      throw VelociousError.safe("Expected signed mutations.", {code: "missing-signed-mutations"})
    }

    /** @type {string | null} */
    let grantUserId = null
    /** @type {string | null} */
    let grantDeviceId = null
    /** @type {string | null} */
    let grantId = null
    /** @type {Array<Record<string, ?>>} */
    const syncs = []

    for (const rawEntry of rawEntries) {
      if (!rawEntry || typeof rawEntry !== "object") {
        throw VelociousError.safe("Invalid signed mutation entry.", {code: "invalid-signed-mutation-entry"})
      }

      const signedMutation = /** @type {SignedSyncMutation} */ (rawEntry.signedMutation)
      const signedOfflineGrant = /** @type {SignedOfflineGrant} */ (rawEntry.signedOfflineGrant)

      if (!signedMutation || !signedOfflineGrant) {
        throw VelociousError.safe("Expected signed mutation and signed offline grant.", {code: "incomplete-signed-mutation"})
      }

      const mutation = await verifySignedMutation({
        backendPublicKey: this.backendPublicKey,
        signedMutation
      })
      const offlineGrant = await verifyOfflineGrant({
        signedGrant: signedOfflineGrant,
        signingKeys: this.offlineGrantSigningKeys
      })

      if (mutation.actorUserId !== offlineGrant.userId) {
        throw VelociousError.safe("Mutation actor does not match offline grant.", {code: "actor-grant-mismatch"})
      }

      if (mutation.actorDeviceId !== offlineGrant.deviceId) {
        throw VelociousError.safe("Mutation device does not match offline grant.", {code: "device-grant-mismatch"})
      }

      if (mutation.offlineGrantId !== offlineGrant.grantId) {
        throw VelociousError.safe("Mutation grant id does not match offline grant.", {code: "grant-id-mismatch"})
      }

      if (grantUserId === null) {
        grantUserId = offlineGrant.userId
        grantDeviceId = offlineGrant.deviceId
        grantId = offlineGrant.grantId
      } else if (
        grantUserId !== offlineGrant.userId ||
        grantDeviceId !== offlineGrant.deviceId ||
        grantId !== offlineGrant.grantId
      ) {
        throw VelociousError.safe("All signed mutations in a batch must share actor, device, and grant.", {code: "mixed-signed-replay-batch"})
      }

      if (!this.grantAuthorizesMutation({grant: offlineGrant, mutation})) {
        throw VelociousError.safe(`Offline grant does not authorize ${mutation.model}.${mutation.operation}.`, {code: "offline-grant-denied"})
      }

      const sync = this.syncFromSignedMutation({mutation})
      const idempotencyKey = mutationIdempotencyKey({mutation})

      syncs.push({...sync, id: idempotencyKey, idempotencyKey})
    }

    if (!grantUserId) {
      throw VelociousError.safe("Could not resolve signed replay actor.", {code: "missing-signed-replay-actor"})
    }

    if (this.actorLookup) {
      const lookedUpActor = await this.actorLookup(grantUserId)

      if (!lookedUpActor) {
        throw VelociousError.safe("Signed replay actor not found.", {code: "signed-replay-actor-missing"})
      }

      return {actor: lookedUpActor, syncs}
    }

    return {actor: {id: () => grantUserId}, syncs}
  }

  /**
   * Checks whether the offline grant authorizes the mutation's model/operation.
   * @param {{grant: import("./offline-grant.js").OfflineGrant, mutation: import("./device-identity.js").SyncMutation}} args - Authorization args.
   * @returns {boolean} Whether authorized.
   */
  grantAuthorizesMutation({grant, mutation}) {
    const resourceGrant = grant.resources[mutation.model]

    if (!resourceGrant) return false
    if (resourceGrant === true) return true
    if (Array.isArray(resourceGrant) && resourceGrant.includes(mutation.operation)) return true
    if (typeof resourceGrant === "object" && resourceGrant !== null && !Array.isArray(resourceGrant)) {
      const operations = resourceGrant.operations

      if (Array.isArray(operations) && operations.includes(mutation.operation)) return true
    }

    return false
  }

  /**
   * Transforms a verified signed mutation into a generic sync envelope.
   * @param {{mutation: import("./device-identity.js").SyncMutation}} args - Transform args.
   * @returns {Record<string, ?>} Sync envelope.
   */
  syncFromSignedMutation({mutation}) {
    const operation = mutation.operation
    const attributes = mutation.attributes || {}
    const payload = mutation.payload || {}
    let resourceId
    let data

    if (operation === "create") {
      resourceId = String(attributes.id)
      data = {...attributes}
    } else if (operation === "update") {
      resourceId = String(payload.id)
      data = {...attributes}
    } else {
      // Domain commands carry their target identity in `payload.id`.
      resourceId = String(payload.id)
      data = {...payload}
      delete data.id
    }

    return {
      clientUpdatedAt: mutation.occurredAt,
      data,
      resourceId,
      resourceType: mutation.model,
      syncType: operation
    }
  }
}
