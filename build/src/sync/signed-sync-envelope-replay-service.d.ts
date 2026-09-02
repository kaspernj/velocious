import SyncEnvelopeReplayService from "./sync-envelope-replay-service.js";
export type SignedSyncMutation = import("./device-identity.js").SignedSyncMutation;
export type SignedOfflineGrant = import("./offline-grant.js").SignedOfflineGrant;
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
    abilityFactory: ((args: {
        actor: ReturnType<typeof JSON.parse>;
        configuration: import("../configuration.js").default | null;
        grant: import("./offline-grant.js").OfflineGrant;
    }) => Promise<import("../authorization/ability.js").default | null> | import("../authorization/ability.js").default | null) | null;
    backendPublicKey: import("node:crypto").webcrypto.JsonWebKey;
    offlineGrantSigningKeys: import("./offline-grant.js").OfflineGrantSigningKey[];
    actorLookup: ((userId: string) => Promise<{
        id: () => string;
    } | null>) | null;
    /**
     * Creates a signed sync-envelope replay service.
     * @param {object} args - Constructor arguments.
     * @param {import("./device-identity.js").SyncJsonWebKey} args.backendPublicKey - Backend public key used to verify device certificates.
     * @param {Array<import("./offline-grant.js").OfflineGrantSigningKey>} [args.offlineGrantSigningKeys] - Offline-grant verification keys.
     * @param {(userId: string) => Promise<{id: () => string} | null>} [args.actorLookup] - Optional lookup from grant user id to an actor object with an `id()` method. Defaults to a wrapper around the grant user id.
     * @param {(args: {actor: ReturnType<typeof JSON.parse>, configuration: import("../configuration.js").default | null, grant: import("./offline-grant.js").OfflineGrant}) => Promise<import("../authorization/ability.js").default | null> | import("../authorization/ability.js").default | null} [args.abilityFactory] - Builds the actor/grant-scoped ability used to authorize routed resources. Required for routed signed replay; without it every routed sync fails closed.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} [args.rest] - Remaining arguments forwarded to {@link SyncEnvelopeReplayService}.
     */
    constructor({ abilityFactory, backendPublicKey, offlineGrantSigningKeys, actorLookup, ...rest }: {
        backendPublicKey: import("./device-identity.js").SyncJsonWebKey;
        offlineGrantSigningKeys?: Array<import("./offline-grant.js").OfflineGrantSigningKey>;
        actorLookup?: (userId: string) => Promise<{
            id: () => string;
        } | null>;
        abilityFactory?: (args: {
            actor: ReturnType<typeof JSON.parse>;
            configuration: import("../configuration.js").default | null;
            grant: import("./offline-grant.js").OfflineGrant;
        }) => Promise<import("../authorization/ability.js").default | null> | import("../authorization/ability.js").default | null;
        rest?: Record<string, ReturnType<typeof JSON.parse>>;
    });
    /**
     * Verifies signed mutations and then runs the generic replay loop over the
     * derived sync envelopes. Verified actor, grant, and derived syncs are kept
     * in the request-local `requestState` object so concurrent replay calls on
     * one service instance cannot cross their authentication state.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} params - Request params.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} [requestState] - Request-local state shared with the base replay hooks.
     * @returns {Promise<{syncs: Array<Record<string, ReturnType<typeof JSON.parse>>>}>} Replay response.
     */
    replay(params: Record<string, ReturnType<typeof JSON.parse>>, requestState?: Record<string, ReturnType<typeof JSON.parse>>): Promise<{
        syncs: Array<Record<string, ReturnType<typeof JSON.parse>>>;
    }>;
    /**
     * Returns the verified actor prepared during {@link SignedSyncEnvelopeReplayService#replay}.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} _params - Request params.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} requestState - Request-local state.
     * @returns {Promise<{authenticated: true, actor: ReturnType<typeof JSON.parse>} | {authenticated: false, errorCode: string, errorMessage: string}>} Auth result.
     */
    authenticateReplay(_params: Record<string, ReturnType<typeof JSON.parse>>, requestState: Record<string, ReturnType<typeof JSON.parse>>): Promise<{
        authenticated: true;
        actor: ReturnType<typeof JSON.parse>;
    } | {
        authenticated: false;
        errorCode: string;
        errorMessage: string;
    }>;
    /**
     * Returns the sync envelopes derived from the verified signed mutations.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} _params - Request params.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} requestState - Request-local state.
     * @returns {Array<Record<string, ReturnType<typeof JSON.parse>>>} Sync envelopes.
     */
    replaySyncs(_params: Record<string, ReturnType<typeof JSON.parse>>, requestState: Record<string, ReturnType<typeof JSON.parse>>): Array<Record<string, ReturnType<typeof JSON.parse>>>;
    /**
     * Builds the replay context carrying the verified signed actor and grant
     * (with its scopes) plus the offline runtime marker, so resource hooks and
     * ability factories authorize against the signer instead of the uploader.
     * @param {{actor: ReturnType<typeof JSON.parse>, params: Record<string, ReturnType<typeof JSON.parse>>, requestState: Record<string, ReturnType<typeof JSON.parse>>}} args - Actor, request params, and request-local state.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} Replay context.
     */
    buildReplayContext({ actor, requestState }: {
        actor: ReturnType<typeof JSON.parse>;
        params: Record<string, ReturnType<typeof JSON.parse>>;
        requestState: Record<string, ReturnType<typeof JSON.parse>>;
    }): Promise<Record<string, ReturnType<typeof JSON.parse>>>;
    /**
     * Derives the routed-resource ability from the verified signed actor and
     * grant through the configured `abilityFactory`. The constructor-wide
     * uploader ability is never used for signed replay: without a factory (or a
     * factory result) every routed sync fails closed with a client-safe error.
     * @param {{actor: ReturnType<typeof JSON.parse>, context: Record<string, ReturnType<typeof JSON.parse>>}} args - Verified actor and replay context.
     * @returns {Promise<{ability: import("../authorization/ability.js").default, abilityContext: Record<string, ReturnType<typeof JSON.parse>>}>} Scoped ability and resource context.
     */
    replayAbilityFor({ actor, context }: {
        actor: ReturnType<typeof JSON.parse>;
        context: Record<string, ReturnType<typeof JSON.parse>>;
    }): Promise<{
        ability: import("../authorization/ability.js").default;
        abilityContext: Record<string, ReturnType<typeof JSON.parse>>;
    }>;
    /**
     * Verifies every signed mutation, its offline grant, and the actor/grant
     * consistency, then transforms the envelopes into the sync format the base
     * replay service understands.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} params - Request params.
     * @returns {Promise<{actor: ReturnType<typeof JSON.parse>, grant: import("./offline-grant.js").OfflineGrant, syncs: Array<Record<string, ReturnType<typeof JSON.parse>>>}>} Verified actor, common grant, and derived syncs.
     */
    verifyAndTransformSignedReplay(params: Record<string, ReturnType<typeof JSON.parse>>): Promise<{
        actor: ReturnType<typeof JSON.parse>;
        grant: import("./offline-grant.js").OfflineGrant;
        syncs: Array<Record<string, ReturnType<typeof JSON.parse>>>;
    }>;
    /**
     * Validates a mutation against the current sync manifest: the model and the
     * operation must be enabled, and the mutation's policy hash must match the
     * current manifest policy hash.
     * @param {{mutation: import("./device-identity.js").SyncMutation, syncManifest: Record<string, import("../configuration-types.js").NormalizedFrontendModelResourceSyncConfiguration>}} args - Validation args.
     * @returns {void} Throws a client-safe error when the current policy denies the mutation.
     */
    validateCurrentSyncPolicy({ mutation, syncManifest }: {
        mutation: import("./device-identity.js").SyncMutation;
        syncManifest: Record<string, import("../configuration-types.js").NormalizedFrontendModelResourceSyncConfiguration>;
    }): void;
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
    validateGrantAgainstSyncPolicy({ mutation, offlineGrant, syncManifest }: {
        mutation: import("./device-identity.js").SyncMutation;
        offlineGrant: import("./offline-grant.js").OfflineGrant;
        syncManifest: Record<string, import("../configuration-types.js").NormalizedFrontendModelResourceSyncConfiguration>;
    }): void;
    /**
     * Transforms a verified signed mutation into a generic sync envelope.
     * @param {{mutation: import("./device-identity.js").SyncMutation}} args - Transform args.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} Sync envelope.
     */
    syncFromSignedMutation({ mutation }: {
        mutation: import("./device-identity.js").SyncMutation;
    }): Record<string, ReturnType<typeof JSON.parse>>;
}
//# sourceMappingURL=signed-sync-envelope-replay-service.d.ts.map