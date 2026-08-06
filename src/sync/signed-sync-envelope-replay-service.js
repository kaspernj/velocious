// @ts-check

import SyncEnvelopeReplayService from "./sync-envelope-replay-service.js"
import {frontendModelSyncManifestForBackendProjects} from "../frontend-models/resource-definition.js"
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
 *
 * Every mutation is validated against the current sync manifest (the same
 * contract as the controller's sync replay endpoint): the model and operation
 * must be enabled in the current manifest, the grant resource entry must be
 * enabled and list the operation, and the grant policy hash must equal both the
 * mutation policy hash and the current manifest policy hash. Routed resources
 * are authorized through an actor/grant-scoped ability built by the configured
 * `abilityFactory`; without one, routed signed replay fails closed.
 */
export default class SignedSyncEnvelopeReplayService extends SyncEnvelopeReplayService {
  /**
   * Creates a signed sync-envelope replay service.
   * @param {object} args - Constructor arguments.
   * @param {import("./device-identity.js").SyncJsonWebKey} args.backendPublicKey - Backend public key used to verify device certificates.
   * @param {Array<import("./offline-grant.js").OfflineGrantSigningKey>} [args.offlineGrantSigningKeys] - Offline-grant verification keys.
   * @param {(userId: string) => Promise<{id: () => string} | null>} [args.actorLookup] - Optional lookup from grant user id to an actor object with an `id()` method. Defaults to a wrapper around the grant user id.
   * @param {(args: {actor: ReturnType<typeof JSON.parse>, configuration: import("../configuration.js").default | null, grant: import("./offline-grant.js").OfflineGrant}) => Promise<import("../authorization/ability.js").default | null> | import("../authorization/ability.js").default | null} [args.abilityFactory] - Builds the actor/grant-scoped ability used to authorize routed resources. Required for routed signed replay; without it every routed sync fails closed.
   * @param {Record<string, ReturnType<typeof JSON.parse>>} [args.rest] - Remaining arguments forwarded to {@link SyncEnvelopeReplayService}.
   */
  constructor({abilityFactory, backendPublicKey, offlineGrantSigningKeys, actorLookup, ...rest}) {
    super({
      actorForeignKeyColumn: "authenticationTokenId",
      ...rest
    })

    if (!backendPublicKey) throw new Error("SignedSyncEnvelopeReplayService requires backendPublicKey")

    this.abilityFactory = abilityFactory || null
    this.backendPublicKey = backendPublicKey
    this.offlineGrantSigningKeys = offlineGrantSigningKeys || []
    this.actorLookup = actorLookup || null
  }

  /**
   * Verifies signed mutations and then runs the generic replay loop over the
   * derived sync envelopes. Verified actor, grant, and derived syncs are kept
   * in the request-local `requestState` object so concurrent replay calls on
   * one service instance cannot cross their authentication state.
   * @param {Record<string, ReturnType<typeof JSON.parse>>} params - Request params.
   * @param {Record<string, ReturnType<typeof JSON.parse>>} [requestState] - Request-local state shared with the base replay hooks.
   * @returns {Promise<{syncs: Array<Record<string, ReturnType<typeof JSON.parse>>>}>} Replay response.
   */
  async replay(params, requestState = {}) {
    const verified = await this.verifyAndTransformSignedReplay(params)

    requestState.signedReplayActor = verified.actor
    requestState.signedReplayGrant = verified.grant
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
   * @param {Record<string, ReturnType<typeof JSON.parse>>} _params - Request params.
   * @param {Record<string, ReturnType<typeof JSON.parse>>} requestState - Request-local state.
   * @returns {Promise<{authenticated: true, actor: ReturnType<typeof JSON.parse>} | {authenticated: false, errorCode: string, errorMessage: string}>} Auth result.
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
   * @param {Record<string, ReturnType<typeof JSON.parse>>} _params - Request params.
   * @param {Record<string, ReturnType<typeof JSON.parse>>} requestState - Request-local state.
   * @returns {Array<Record<string, ReturnType<typeof JSON.parse>>>} Sync envelopes.
   */
  replaySyncs(_params, requestState) {
    return requestState?.signedReplaySyncs || []
  }

  /**
   * Builds the replay context carrying the verified signed actor and grant
   * (with its scopes) plus the offline runtime marker, so resource hooks and
   * ability factories authorize against the signer instead of the uploader.
   * @param {{actor: ReturnType<typeof JSON.parse>, params: Record<string, ReturnType<typeof JSON.parse>>, requestState: Record<string, ReturnType<typeof JSON.parse>>}} args - Actor, request params, and request-local state.
   * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} Replay context.
   */
  async buildReplayContext({actor, requestState}) {
    const grant = /** @type {import("./offline-grant.js").OfflineGrant | undefined} */ (requestState?.signedReplayGrant)

    return {
      currentUser: actor,
      offlineGrant: grant,
      offlineGrantScopes: grant?.scopes || {},
      resourceRuntime: "offline"
    }
  }

  /**
   * Derives the routed-resource ability from the verified signed actor and
   * grant through the configured `abilityFactory`. The constructor-wide
   * uploader ability is never used for signed replay: without a factory (or a
   * factory result) every routed sync fails closed with a client-safe error.
   * @param {{actor: ReturnType<typeof JSON.parse>, context: Record<string, ReturnType<typeof JSON.parse>>}} args - Verified actor and replay context.
   * @returns {Promise<{ability: import("../authorization/ability.js").default, abilityContext: Record<string, ReturnType<typeof JSON.parse>>}>} Scoped ability and resource context.
   */
  async replayAbilityFor({actor, context}) {
    const grant = /** @type {import("./offline-grant.js").OfflineGrant} */ (context.offlineGrant)
    const ability = this.abilityFactory
      ? await this.abilityFactory({actor, configuration: this.configuration, grant})
      : null

    if (!ability) {
      throw VelociousError.safe("Signed sync replay requires an actor/grant-scoped abilityFactory.", {code: "signed-replay-ability-missing"})
    }

    return {ability, abilityContext: context}
  }

  /**
   * Verifies every signed mutation, its offline grant, and the actor/grant
   * consistency, then transforms the envelopes into the sync format the base
   * replay service understands.
   * @param {Record<string, ReturnType<typeof JSON.parse>>} params - Request params.
   * @returns {Promise<{actor: ReturnType<typeof JSON.parse>, grant: import("./offline-grant.js").OfflineGrant, syncs: Array<Record<string, ReturnType<typeof JSON.parse>>>}>} Verified actor, common grant, and derived syncs.
   */
  async verifyAndTransformSignedReplay(params) {
    const rawEntries = Array.isArray(params.signedMutations) ? params.signedMutations : []

    if (rawEntries.length === 0) {
      throw VelociousError.safe("Expected signed mutations.", {code: "missing-signed-mutations"})
    }

    const syncManifest = this.configuration
      ? frontendModelSyncManifestForBackendProjects(this.configuration.getBackendProjects())
      : {}

    /** @type {string | null} */
    let grantUserId = null
    /** @type {string | null} */
    let grantDeviceId = null
    /** @type {string | null} */
    let grantId = null
    /** @type {import("./offline-grant.js").OfflineGrant | null} */
    let commonGrant = null
    /** @type {Array<Record<string, ReturnType<typeof JSON.parse>>>} */
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
        commonGrant = offlineGrant
      } else if (
        grantUserId !== offlineGrant.userId ||
        grantDeviceId !== offlineGrant.deviceId ||
        grantId !== offlineGrant.grantId
      ) {
        throw VelociousError.safe("All signed mutations in a batch must share actor, device, and grant.", {code: "mixed-signed-replay-batch"})
      }

      this.validateCurrentSyncPolicy({mutation, syncManifest})
      this.validateGrantAgainstSyncPolicy({mutation, offlineGrant, syncManifest})

      const sync = this.syncFromSignedMutation({mutation})
      const idempotencyKey = mutationIdempotencyKey({mutation})

      syncs.push({...sync, id: idempotencyKey, idempotencyKey})
    }

    if (!grantUserId || !commonGrant) {
      throw VelociousError.safe("Could not resolve signed replay actor.", {code: "missing-signed-replay-actor"})
    }

    if (this.actorLookup) {
      const lookedUpActor = await this.actorLookup(grantUserId)

      if (!lookedUpActor) {
        throw VelociousError.safe("Signed replay actor not found.", {code: "signed-replay-actor-missing"})
      }

      return {actor: lookedUpActor, grant: commonGrant, syncs}
    }

    return {actor: {id: () => grantUserId}, grant: commonGrant, syncs}
  }

  /**
   * Validates a mutation against the current sync manifest: the model and the
   * operation must be enabled, and the mutation's policy hash must match the
   * current manifest policy hash.
   * @param {{mutation: import("./device-identity.js").SyncMutation, syncManifest: Record<string, import("../configuration-types.js").NormalizedFrontendModelResourceSyncConfiguration>}} args - Validation args.
   * @returns {void} Throws a client-safe error when the current policy denies the mutation.
   */
  validateCurrentSyncPolicy({mutation, syncManifest}) {
    const syncResource = syncManifest[mutation.model]

    if (!syncResource) {
      throw VelociousError.safe(`Sync replay model is not enabled: ${mutation.model}.`, {code: "sync-replay-model-not-enabled"})
    }

    if (!syncResource.operations.includes(mutation.operation)) {
      throw VelociousError.safe(`Sync replay operation is not enabled for ${mutation.model}: ${mutation.operation}.`, {code: "sync-replay-operation-not-enabled"})
    }

    if (syncResource.policyHash !== mutation.policyHash) {
      throw VelociousError.safe(`Sync replay policy hash mismatch for ${mutation.model}.`, {code: "sync-replay-policy-hash-mismatch"})
    }
  }

  /**
   * Validates the verified offline grant against the current sync policy, the
   * same contract as the controller's sync replay endpoint: the grant resource
   * entry must be a normalized manifest entry (enabled with an operations list
   * and the current policy hash), it must list the mutation operation, and its
   * policy hash must equal both the mutation and current manifest hashes.
   * Legacy array/true grant-resource shortcuts are not the bootstrap contract
   * and never authorize a mutation.
   * @param {{mutation: import("./device-identity.js").SyncMutation, offlineGrant: import("./offline-grant.js").OfflineGrant, syncManifest: Record<string, import("../configuration-types.js").NormalizedFrontendModelResourceSyncConfiguration>}} args - Validation args.
   * @returns {void} Throws a client-safe error when the grant does not authorize the mutation.
   */
  validateGrantAgainstSyncPolicy({mutation, offlineGrant, syncManifest}) {
    const grantResource = /** @type {Record<string, ReturnType<typeof JSON.parse>> | undefined} */ (offlineGrant.resources[mutation.model])
    const grantOperations = Array.isArray(grantResource?.operations) ? grantResource.operations : []
    const grantPolicyHash = grantResource?.policyHash

    if (!grantResource || grantResource.enabled !== true) {
      throw VelociousError.safe(`Offline grant does not authorize ${mutation.model}.`, {code: "offline-grant-denied"})
    }

    if (!grantOperations.includes(mutation.operation)) {
      throw VelociousError.safe(`Offline grant does not authorize ${mutation.model}: ${mutation.operation}.`, {code: "offline-grant-denied"})
    }

    if (grantPolicyHash !== mutation.policyHash || grantPolicyHash !== syncManifest[mutation.model]?.policyHash) {
      throw VelociousError.safe(`Offline grant policy hash mismatch for ${mutation.model}.`, {code: "offline-grant-policy-hash-mismatch"})
    }

    if (!offlineGrant.scopes || typeof offlineGrant.scopes !== "object" || Array.isArray(offlineGrant.scopes)) {
      throw VelociousError.safe("Offline grant scopes are invalid.", {code: "offline-grant-scopes-invalid"})
    }
  }

  /**
   * Transforms a verified signed mutation into a generic sync envelope.
   * @param {{mutation: import("./device-identity.js").SyncMutation}} args - Transform args.
   * @returns {Record<string, ReturnType<typeof JSON.parse>>} Sync envelope.
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
      baseVersion: mutation.baseVersion,
      clientMutationId: mutation.clientMutationId,
      clientUpdatedAt: mutation.occurredAt,
      data,
      resourceId,
      resourceType: mutation.model,
      syncType: operation
    }
  }
}
