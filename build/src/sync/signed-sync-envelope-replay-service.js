// @ts-check
import SyncEnvelopeReplayService from "./sync-envelope-replay-service.js";
import { frontendModelSyncManifestForBackendProjects } from "../frontend-models/resource-definition.js";
import { verifyOfflineGrant } from "./offline-grant.js";
import { mutationIdempotencyKey, verifySignedMutation } from "./device-identity.js";
import VelociousError from "../velocious-error.js";
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
    constructor({ abilityFactory, backendPublicKey, offlineGrantSigningKeys, actorLookup, ...rest }) {
        super({
            actorForeignKeyColumn: "authenticationTokenId",
            ...rest
        });
        if (!backendPublicKey)
            throw new Error("SignedSyncEnvelopeReplayService requires backendPublicKey");
        this.abilityFactory = abilityFactory || null;
        this.backendPublicKey = backendPublicKey;
        this.offlineGrantSigningKeys = offlineGrantSigningKeys || [];
        this.actorLookup = actorLookup || null;
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
        const verified = await this.verifyAndTransformSignedReplay(params);
        requestState.signedReplayActor = verified.actor;
        requestState.signedReplayGrant = verified.grant;
        requestState.signedReplaySyncs = verified.syncs;
        const result = await super.replay(params, requestState);
        return {
            syncs: result.syncs.map((syncResponse, index) => {
                const { id: _id, ...rest } = syncResponse;
                const idempotencyKey = verified.syncs[index]?.idempotencyKey;
                return idempotencyKey ? { ...rest, idempotencyKey } : syncResponse;
            })
        };
    }
    /**
     * Returns the verified actor prepared during {@link SignedSyncEnvelopeReplayService#replay}.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} _params - Request params.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} requestState - Request-local state.
     * @returns {Promise<{authenticated: true, actor: ReturnType<typeof JSON.parse>} | {authenticated: false, errorCode: string, errorMessage: string}>} Auth result.
     */
    async authenticateReplay(_params, requestState) {
        const actor = requestState?.signedReplayActor;
        if (!actor) {
            return {
                authenticated: false,
                errorCode: "missing-signed-replay",
                errorMessage: "Expected a pre-verified signed replay"
            };
        }
        return { actor, authenticated: true };
    }
    /**
     * Returns the sync envelopes derived from the verified signed mutations.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} _params - Request params.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} requestState - Request-local state.
     * @returns {Array<Record<string, ReturnType<typeof JSON.parse>>>} Sync envelopes.
     */
    replaySyncs(_params, requestState) {
        return requestState?.signedReplaySyncs || [];
    }
    /**
     * Builds the replay context carrying the verified signed actor and grant
     * (with its scopes) plus the offline runtime marker, so resource hooks and
     * ability factories authorize against the signer instead of the uploader.
     * @param {{actor: ReturnType<typeof JSON.parse>, params: Record<string, ReturnType<typeof JSON.parse>>, requestState: Record<string, ReturnType<typeof JSON.parse>>}} args - Actor, request params, and request-local state.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} Replay context.
     */
    async buildReplayContext({ actor, requestState }) {
        const grant = /** @type {import("./offline-grant.js").OfflineGrant | undefined} */ (requestState?.signedReplayGrant);
        return {
            currentUser: actor,
            offlineGrant: grant,
            offlineGrantScopes: grant?.scopes || {},
            resourceRuntime: "offline"
        };
    }
    /**
     * Derives the routed-resource ability from the verified signed actor and
     * grant through the configured `abilityFactory`. The constructor-wide
     * uploader ability is never used for signed replay: without a factory (or a
     * factory result) every routed sync fails closed with a client-safe error.
     * @param {{actor: ReturnType<typeof JSON.parse>, context: Record<string, ReturnType<typeof JSON.parse>>}} args - Verified actor and replay context.
     * @returns {Promise<{ability: import("../authorization/ability.js").default, abilityContext: Record<string, ReturnType<typeof JSON.parse>>}>} Scoped ability and resource context.
     */
    async replayAbilityFor({ actor, context }) {
        const grant = /** @type {import("./offline-grant.js").OfflineGrant} */ (context.offlineGrant);
        const ability = this.abilityFactory
            ? await this.abilityFactory({ actor, configuration: this.configuration, grant })
            : null;
        if (!ability) {
            throw VelociousError.safe("Signed sync replay requires an actor/grant-scoped abilityFactory.", { code: "signed-replay-ability-missing" });
        }
        return { ability, abilityContext: context };
    }
    /**
     * Verifies every signed mutation, its offline grant, and the actor/grant
     * consistency, then transforms the envelopes into the sync format the base
     * replay service understands.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} params - Request params.
     * @returns {Promise<{actor: ReturnType<typeof JSON.parse>, grant: import("./offline-grant.js").OfflineGrant, syncs: Array<Record<string, ReturnType<typeof JSON.parse>>>}>} Verified actor, common grant, and derived syncs.
     */
    async verifyAndTransformSignedReplay(params) {
        const rawEntries = Array.isArray(params.signedMutations) ? params.signedMutations : [];
        if (rawEntries.length === 0) {
            throw VelociousError.safe("Expected signed mutations.", { code: "missing-signed-mutations" });
        }
        const syncManifest = this.configuration
            ? frontendModelSyncManifestForBackendProjects(this.configuration.getBackendProjects())
            : {};
        /** @type {string | null} */
        let grantUserId = null;
        /** @type {string | null} */
        let grantDeviceId = null;
        /** @type {string | null} */
        let grantId = null;
        /** @type {import("./offline-grant.js").OfflineGrant | null} */
        let commonGrant = null;
        /** @type {Array<Record<string, ReturnType<typeof JSON.parse>>>} */
        const syncs = [];
        for (const rawEntry of rawEntries) {
            if (!rawEntry || typeof rawEntry !== "object") {
                throw VelociousError.safe("Invalid signed mutation entry.", { code: "invalid-signed-mutation-entry" });
            }
            const signedMutation = /** @type {SignedSyncMutation} */ (rawEntry.signedMutation);
            const signedOfflineGrant = /** @type {SignedOfflineGrant} */ (rawEntry.signedOfflineGrant);
            if (!signedMutation || !signedOfflineGrant) {
                throw VelociousError.safe("Expected signed mutation and signed offline grant.", { code: "incomplete-signed-mutation" });
            }
            const mutation = await verifySignedMutation({
                backendPublicKey: this.backendPublicKey,
                signedMutation
            });
            const offlineGrant = await verifyOfflineGrant({
                signedGrant: signedOfflineGrant,
                signingKeys: this.offlineGrantSigningKeys
            });
            if (mutation.actorUserId !== offlineGrant.userId) {
                throw VelociousError.safe("Mutation actor does not match offline grant.", { code: "actor-grant-mismatch" });
            }
            if (mutation.actorDeviceId !== offlineGrant.deviceId) {
                throw VelociousError.safe("Mutation device does not match offline grant.", { code: "device-grant-mismatch" });
            }
            if (mutation.offlineGrantId !== offlineGrant.grantId) {
                throw VelociousError.safe("Mutation grant id does not match offline grant.", { code: "grant-id-mismatch" });
            }
            if (grantUserId === null) {
                grantUserId = offlineGrant.userId;
                grantDeviceId = offlineGrant.deviceId;
                grantId = offlineGrant.grantId;
                commonGrant = offlineGrant;
            }
            else if (grantUserId !== offlineGrant.userId ||
                grantDeviceId !== offlineGrant.deviceId ||
                grantId !== offlineGrant.grantId) {
                throw VelociousError.safe("All signed mutations in a batch must share actor, device, and grant.", { code: "mixed-signed-replay-batch" });
            }
            this.validateCurrentSyncPolicy({ mutation, syncManifest });
            this.validateGrantAgainstSyncPolicy({ mutation, offlineGrant, syncManifest });
            const sync = this.syncFromSignedMutation({ mutation });
            const idempotencyKey = mutationIdempotencyKey({ mutation });
            syncs.push({ ...sync, id: idempotencyKey, idempotencyKey });
        }
        if (!grantUserId || !commonGrant) {
            throw VelociousError.safe("Could not resolve signed replay actor.", { code: "missing-signed-replay-actor" });
        }
        if (this.actorLookup) {
            const lookedUpActor = await this.actorLookup(grantUserId);
            if (!lookedUpActor) {
                throw VelociousError.safe("Signed replay actor not found.", { code: "signed-replay-actor-missing" });
            }
            return { actor: lookedUpActor, grant: commonGrant, syncs };
        }
        return { actor: { id: () => grantUserId }, grant: commonGrant, syncs };
    }
    /**
     * Validates a mutation against the current sync manifest: the model and the
     * operation must be enabled, and the mutation's policy hash must match the
     * current manifest policy hash.
     * @param {{mutation: import("./device-identity.js").SyncMutation, syncManifest: Record<string, import("../configuration-types.js").NormalizedFrontendModelResourceSyncConfiguration>}} args - Validation args.
     * @returns {void} Throws a client-safe error when the current policy denies the mutation.
     */
    validateCurrentSyncPolicy({ mutation, syncManifest }) {
        const syncResource = syncManifest[mutation.model];
        if (!syncResource) {
            throw VelociousError.safe(`Sync replay model is not enabled: ${mutation.model}.`, { code: "sync-replay-model-not-enabled" });
        }
        if (!syncResource.operations.includes(mutation.operation)) {
            throw VelociousError.safe(`Sync replay operation is not enabled for ${mutation.model}: ${mutation.operation}.`, { code: "sync-replay-operation-not-enabled" });
        }
        if (syncResource.policyHash !== mutation.policyHash) {
            throw VelociousError.safe(`Sync replay policy hash mismatch for ${mutation.model}.`, { code: "sync-replay-policy-hash-mismatch" });
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
    validateGrantAgainstSyncPolicy({ mutation, offlineGrant, syncManifest }) {
        const grantResource = /** @type {Record<string, ReturnType<typeof JSON.parse>> | undefined} */ (offlineGrant.resources[mutation.model]);
        const grantOperations = Array.isArray(grantResource?.operations) ? grantResource.operations : [];
        const grantPolicyHash = grantResource?.policyHash;
        if (!grantResource || grantResource.enabled !== true) {
            throw VelociousError.safe(`Offline grant does not authorize ${mutation.model}.`, { code: "offline-grant-denied" });
        }
        if (!grantOperations.includes(mutation.operation)) {
            throw VelociousError.safe(`Offline grant does not authorize ${mutation.model}: ${mutation.operation}.`, { code: "offline-grant-denied" });
        }
        if (grantPolicyHash !== mutation.policyHash || grantPolicyHash !== syncManifest[mutation.model]?.policyHash) {
            throw VelociousError.safe(`Offline grant policy hash mismatch for ${mutation.model}.`, { code: "offline-grant-policy-hash-mismatch" });
        }
        if (!offlineGrant.scopes || typeof offlineGrant.scopes !== "object" || Array.isArray(offlineGrant.scopes)) {
            throw VelociousError.safe("Offline grant scopes are invalid.", { code: "offline-grant-scopes-invalid" });
        }
    }
    /**
     * Transforms a verified signed mutation into a generic sync envelope.
     * @param {{mutation: import("./device-identity.js").SyncMutation}} args - Transform args.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} Sync envelope.
     */
    syncFromSignedMutation({ mutation }) {
        const operation = mutation.operation;
        const attributes = mutation.attributes || {};
        const payload = mutation.payload || {};
        let resourceId;
        let data;
        if (operation === "create") {
            resourceId = String(attributes.id);
            data = { ...attributes };
        }
        else if (operation === "update") {
            resourceId = String(payload.id);
            data = { ...attributes };
        }
        else {
            // Domain commands carry their target identity in `payload.id`.
            resourceId = String(payload.id);
            data = { ...payload };
            delete data.id;
        }
        return {
            baseVersion: mutation.baseVersion,
            clientMutationId: mutation.clientMutationId,
            clientUpdatedAt: mutation.occurredAt,
            data,
            resourceId,
            resourceType: mutation.model,
            syncType: operation
        };
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2lnbmVkLXN5bmMtZW52ZWxvcGUtcmVwbGF5LXNlcnZpY2UuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvc3luYy9zaWduZWQtc3luYy1lbnZlbG9wZS1yZXBsYXktc2VydmljZS5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyx5QkFBeUIsTUFBTSxtQ0FBbUMsQ0FBQTtBQUN6RSxPQUFPLEVBQUMsMkNBQTJDLEVBQUMsTUFBTSwyQ0FBMkMsQ0FBQTtBQUNyRyxPQUFPLEVBQUMsa0JBQWtCLEVBQUMsTUFBTSxvQkFBb0IsQ0FBQTtBQUNyRCxPQUFPLEVBQUMsc0JBQXNCLEVBQUUsb0JBQW9CLEVBQUMsTUFBTSxzQkFBc0IsQ0FBQTtBQUNqRixPQUFPLGNBQWMsTUFBTSx1QkFBdUIsQ0FBQTtBQUVsRDs7O0dBR0c7QUFFSDs7Ozs7Ozs7Ozs7Ozs7OztHQWdCRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8sK0JBQWdDLFNBQVEseUJBQXlCO0lBQ3BGOzs7Ozs7OztPQVFHO0lBQ0gsWUFBWSxFQUFDLGNBQWMsRUFBRSxnQkFBZ0IsRUFBRSx1QkFBdUIsRUFBRSxXQUFXLEVBQUUsR0FBRyxJQUFJLEVBQUM7UUFDM0YsS0FBSyxDQUFDO1lBQ0oscUJBQXFCLEVBQUUsdUJBQXVCO1lBQzlDLEdBQUcsSUFBSTtTQUNSLENBQUMsQ0FBQTtRQUVGLElBQUksQ0FBQyxnQkFBZ0I7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLDJEQUEyRCxDQUFDLENBQUE7UUFFbkcsSUFBSSxDQUFDLGNBQWMsR0FBRyxjQUFjLElBQUksSUFBSSxDQUFBO1FBQzVDLElBQUksQ0FBQyxnQkFBZ0IsR0FBRyxnQkFBZ0IsQ0FBQTtRQUN4QyxJQUFJLENBQUMsdUJBQXVCLEdBQUcsdUJBQXVCLElBQUksRUFBRSxDQUFBO1FBQzVELElBQUksQ0FBQyxXQUFXLEdBQUcsV0FBVyxJQUFJLElBQUksQ0FBQTtJQUN4QyxDQUFDO0lB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O1lBQy9CLElBQUksR0FBRyxFQUFDLEdBQUcsT0FBTyxFQUFDLENBQUE7WUFDbkIsT0FBTyxJQUFJLENBQUMsRUFBRSxDQUFBO1FBQ2hCLENBQUM7UUFFRCxPQUFPO1lBQ0wsV0FBVyxFQUFFLFFBQVEsQ0FBQyxXQUFXO1lBQ2pDLGdCQUFnQixFQUFFLFFBQVEsQ0FBQyxnQkFBZ0I7WUFDM0MsZUFBZSxFQUFFLFFBQVEsQ0FBQyxVQUFVO1lBQ3BDLElBQUk7WUFDSixVQUFVO1lBQ1YsWUFBWSxFQUFFLFFBQVEsQ0FBQyxLQUFLO1lBQzVCLFFBQVEsRUFBRSxTQUFTO1NBQ3BCLENBQUE7SUFDSCxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IFN5bmNFbnZlbG9wZVJlcGxheVNlcnZpY2UgZnJvbSBcIi4vc3luYy1lbnZlbG9wZS1yZXBsYXktc2VydmljZS5qc1wiXG5pbXBvcnQge2Zyb250ZW5kTW9kZWxTeW5jTWFuaWZlc3RGb3JCYWNrZW5kUHJvamVjdHN9IGZyb20gXCIuLi9mcm9udGVuZC1tb2RlbHMvcmVzb3VyY2UtZGVmaW5pdGlvbi5qc1wiXG5pbXBvcnQge3ZlcmlmeU9mZmxpbmVHcmFudH0gZnJvbSBcIi4vb2ZmbGluZS1ncmFudC5qc1wiXG5pbXBvcnQge211dGF0aW9uSWRlbXBvdGVuY3lLZXksIHZlcmlmeVNpZ25lZE11dGF0aW9ufSBmcm9tIFwiLi9kZXZpY2UtaWRlbnRpdHkuanNcIlxuaW1wb3J0IFZlbG9jaW91c0Vycm9yIGZyb20gXCIuLi92ZWxvY2lvdXMtZXJyb3IuanNcIlxuXG4vKipcbiAqIEB0eXBlZGVmIHtpbXBvcnQoXCIuL2RldmljZS1pZGVudGl0eS5qc1wiKS5TaWduZWRTeW5jTXV0YXRpb259IFNpZ25lZFN5bmNNdXRhdGlvblxuICogQHR5cGVkZWYge2ltcG9ydChcIi4vb2ZmbGluZS1ncmFudC5qc1wiKS5TaWduZWRPZmZsaW5lR3JhbnR9IFNpZ25lZE9mZmxpbmVHcmFudFxuICovXG5cbi8qKlxuICogU3luYy1lbnZlbG9wZSByZXBsYXkgc2VydmljZSB0aGF0IGF1dGhlbnRpY2F0ZXMgdmlhIGJhY2tlbmQtc2lnbmVkIGRldmljZVxuICogY2VydGlmaWNhdGVzIGFuZCBzaWduZWQgb2ZmbGluZSBncmFudHMgaW5zdGVhZCBvZiBvbmxpbmUgc2Vzc2lvbiB0b2tlbnMuXG4gKlxuICogVGhpcyBpcyB0aGUgZ2VuZXJpYyBWZWxvY2lvdXMgcHJpbWl0aXZlIGZvciBsb25nLW9mZmxpbmUgYW5kIHBlZXItZm9yd2FyZGVkXG4gKiBtdXRhdGlvbnM6IHRoZSBIVFRQIHVwbG9hZGVyIG1heSBkaWZmZXIgZnJvbSB0aGUgbXV0YXRpb24gYWN0b3IsIGJ1dCByZXBsYXlcbiAqIGF1dGhvcml0eSBpcyBkZXJpdmVkIGZyb20gdGhlIHNpZ25lZCBlbnZlbG9wZSBhbmQgZ3JhbnQsIG5vdCB0aGUgdXBsb2FkZXInc1xuICogc2Vzc2lvbi5cbiAqXG4gKiBFdmVyeSBtdXRhdGlvbiBpcyB2YWxpZGF0ZWQgYWdhaW5zdCB0aGUgY3VycmVudCBzeW5jIG1hbmlmZXN0ICh0aGUgc2FtZVxuICogY29udHJhY3QgYXMgdGhlIGNvbnRyb2xsZXIncyBzeW5jIHJlcGxheSBlbmRwb2ludCk6IHRoZSBtb2RlbCBhbmQgb3BlcmF0aW9uXG4gKiBtdXN0IGJlIGVuYWJsZWQgaW4gdGhlIGN1cnJlbnQgbWFuaWZlc3QsIHRoZSBncmFudCByZXNvdXJjZSBlbnRyeSBtdXN0IGJlXG4gKiBlbmFibGVkIGFuZCBsaXN0IHRoZSBvcGVyYXRpb24sIGFuZCB0aGUgZ3JhbnQgcG9saWN5IGhhc2ggbXVzdCBlcXVhbCBib3RoIHRoZVxuICogbXV0YXRpb24gcG9saWN5IGhhc2ggYW5kIHRoZSBjdXJyZW50IG1hbmlmZXN0IHBvbGljeSBoYXNoLiBSb3V0ZWQgcmVzb3VyY2VzXG4gKiBhcmUgYXV0aG9yaXplZCB0aHJvdWdoIGFuIGFjdG9yL2dyYW50LXNjb3BlZCBhYmlsaXR5IGJ1aWx0IGJ5IHRoZSBjb25maWd1cmVkXG4gKiBgYWJpbGl0eUZhY3RvcnlgOyB3aXRob3V0IG9uZSwgcm91dGVkIHNpZ25lZCByZXBsYXkgZmFpbHMgY2xvc2VkLlxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBTaWduZWRTeW5jRW52ZWxvcGVSZXBsYXlTZXJ2aWNlIGV4dGVuZHMgU3luY0VudmVsb3BlUmVwbGF5U2VydmljZSB7XG4gIC8qKlxuICAgKiBDcmVhdGVzIGEgc2lnbmVkIHN5bmMtZW52ZWxvcGUgcmVwbGF5IHNlcnZpY2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQ29uc3RydWN0b3IgYXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZGV2aWNlLWlkZW50aXR5LmpzXCIpLlN5bmNKc29uV2ViS2V5fSBhcmdzLmJhY2tlbmRQdWJsaWNLZXkgLSBCYWNrZW5kIHB1YmxpYyBrZXkgdXNlZCB0byB2ZXJpZnkgZGV2aWNlIGNlcnRpZmljYXRlcy5cbiAgICogQHBhcmFtIHtBcnJheTxpbXBvcnQoXCIuL29mZmxpbmUtZ3JhbnQuanNcIikuT2ZmbGluZUdyYW50U2lnbmluZ0tleT59IFthcmdzLm9mZmxpbmVHcmFudFNpZ25pbmdLZXlzXSAtIE9mZmxpbmUtZ3JhbnQgdmVyaWZpY2F0aW9uIGtleXMuXG4gICAqIEBwYXJhbSB7KHVzZXJJZDogc3RyaW5nKSA9PiBQcm9taXNlPHtpZDogKCkgPT4gc3RyaW5nfSB8IG51bGw+fSBbYXJncy5hY3Rvckxvb2t1cF0gLSBPcHRpb25hbCBsb29rdXAgZnJvbSBncmFudCB1c2VyIGlkIHRvIGFuIGFjdG9yIG9iamVjdCB3aXRoIGFuIGBpZCgpYCBtZXRob2QuIERlZmF1bHRzIHRvIGEgd3JhcHBlciBhcm91bmQgdGhlIGdyYW50IHVzZXIgaWQuXG4gICAqIEBwYXJhbSB7KGFyZ3M6IHthY3RvcjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGNvbmZpZ3VyYXRpb246IGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdCB8IG51bGwsIGdyYW50OiBpbXBvcnQoXCIuL29mZmxpbmUtZ3JhbnQuanNcIikuT2ZmbGluZUdyYW50fSkgPT4gUHJvbWlzZTxpbXBvcnQoXCIuLi9hdXRob3JpemF0aW9uL2FiaWxpdHkuanNcIikuZGVmYXVsdCB8IG51bGw+IHwgaW1wb3J0KFwiLi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHQgfCBudWxsfSBbYXJncy5hYmlsaXR5RmFjdG9yeV0gLSBCdWlsZHMgdGhlIGFjdG9yL2dyYW50LXNjb3BlZCBhYmlsaXR5IHVzZWQgdG8gYXV0aG9yaXplIHJvdXRlZCByZXNvdXJjZXMuIFJlcXVpcmVkIGZvciByb3V0ZWQgc2lnbmVkIHJlcGxheTsgd2l0aG91dCBpdCBldmVyeSByb3V0ZWQgc3luYyBmYWlscyBjbG9zZWQuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBbYXJncy5yZXN0XSAtIFJlbWFpbmluZyBhcmd1bWVudHMgZm9yd2FyZGVkIHRvIHtAbGluayBTeW5jRW52ZWxvcGVSZXBsYXlTZXJ2aWNlfS5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHthYmlsaXR5RmFjdG9yeSwgYmFja2VuZFB1YmxpY0tleSwgb2ZmbGluZUdyYW50U2lnbmluZ0tleXMsIGFjdG9yTG9va3VwLCAuLi5yZXN0fSkge1xuICAgIHN1cGVyKHtcbiAgICAgIGFjdG9yRm9yZWlnbktleUNvbHVtbjogXCJhdXRoZW50aWNhdGlvblRva2VuSWRcIixcbiAgICAgIC4uLnJlc3RcbiAgICB9KVxuXG4gICAgaWYgKCFiYWNrZW5kUHVibGljS2V5KSB0aHJvdyBuZXcgRXJyb3IoXCJTaWduZWRTeW5jRW52ZWxvcGVSZXBsYXlTZXJ2aWNlIHJlcXVpcmVzIGJhY2tlbmRQdWJsaWNLZXlcIilcblxuICAgIHRoaXMuYWJpbGl0eUZhY3RvcnkgPSBhYmlsaXR5RmFjdG9yeSB8fCBudWxsXG4gICAgdGhpcy5iYWNrZW5kUHVibGljS2V5ID0gYmFja2VuZFB1YmxpY0tleVxuICAgIHRoaXMub2ZmbGluZUdyYW50U2lnbmluZ0tleXMgPSBvZmZsaW5lR3JhbnRTaWduaW5nS2V5cyB8fCBbXVxuICAgIHRoaXMuYWN0b3JMb29rdXAgPSBhY3Rvckxvb2t1cCB8fCBudWxsXG4gIH1cblxuICAvKipcbiAgICogVmVyaWZpZXMgc2lnbmVkIG11dGF0aW9ucyBhbmQgdGhlbiBydW5zIHRoZSBnZW5lcmljIHJlcGxheSBsb29wIG92ZXIgdGhlXG4gICAqIGRlcml2ZWQgc3luYyBlbnZlbG9wZXMuIFZlcmlmaWVkIGFjdG9yLCBncmFudCwgYW5kIGRlcml2ZWQgc3luY3MgYXJlIGtlcHRcbiAgICogaW4gdGhlIHJlcXVlc3QtbG9jYWwgYHJlcXVlc3RTdGF0ZWAgb2JqZWN0IHNvIGNvbmN1cnJlbnQgcmVwbGF5IGNhbGxzIG9uXG4gICAqIG9uZSBzZXJ2aWNlIGluc3RhbmNlIGNhbm5vdCBjcm9zcyB0aGVpciBhdXRoZW50aWNhdGlvbiBzdGF0ZS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHBhcmFtcyAtIFJlcXVlc3QgcGFyYW1zLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gW3JlcXVlc3RTdGF0ZV0gLSBSZXF1ZXN0LWxvY2FsIHN0YXRlIHNoYXJlZCB3aXRoIHRoZSBiYXNlIHJlcGxheSBob29rcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8e3N5bmNzOiBBcnJheTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fT59IFJlcGxheSByZXNwb25zZS5cbiAgICovXG4gIGFzeW5jIHJlcGxheShwYXJhbXMsIHJlcXVlc3RTdGF0ZSA9IHt9KSB7XG4gICAgY29uc3QgdmVyaWZpZWQgPSBhd2FpdCB0aGlzLnZlcmlmeUFuZFRyYW5zZm9ybVNpZ25lZFJlcGxheShwYXJhbXMpXG5cbiAgICByZXF1ZXN0U3RhdGUuc2lnbmVkUmVwbGF5QWN0b3IgPSB2ZXJpZmllZC5hY3RvclxuICAgIHJlcXVlc3RTdGF0ZS5zaWduZWRSZXBsYXlHcmFudCA9IHZlcmlmaWVkLmdyYW50XG4gICAgcmVxdWVzdFN0YXRlLnNpZ25lZFJlcGxheVN5bmNzID0gdmVyaWZpZWQuc3luY3NcblxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHN1cGVyLnJlcGxheShwYXJhbXMsIHJlcXVlc3RTdGF0ZSlcblxuICAgIHJldHVybiB7XG4gICAgICBzeW5jczogcmVzdWx0LnN5bmNzLm1hcCgoc3luY1Jlc3BvbnNlLCBpbmRleCkgPT4ge1xuICAgICAgICBjb25zdCB7aWQ6IF9pZCwgLi4ucmVzdH0gPSBzeW5jUmVzcG9uc2VcbiAgICAgICAgY29uc3QgaWRlbXBvdGVuY3lLZXkgPSB2ZXJpZmllZC5zeW5jc1tpbmRleF0/LmlkZW1wb3RlbmN5S2V5XG5cbiAgICAgICAgcmV0dXJuIGlkZW1wb3RlbmN5S2V5ID8gey4uLnJlc3QsIGlkZW1wb3RlbmN5S2V5fSA6IHN5bmNSZXNwb25zZVxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgdmVyaWZpZWQgYWN0b3IgcHJlcGFyZWQgZHVyaW5nIHtAbGluayBTaWduZWRTeW5jRW52ZWxvcGVSZXBsYXlTZXJ2aWNlI3JlcGxheX0uXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBfcGFyYW1zIC0gUmVxdWVzdCBwYXJhbXMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSByZXF1ZXN0U3RhdGUgLSBSZXF1ZXN0LWxvY2FsIHN0YXRlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7YXV0aGVudGljYXRlZDogdHJ1ZSwgYWN0b3I6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB8IHthdXRoZW50aWNhdGVkOiBmYWxzZSwgZXJyb3JDb2RlOiBzdHJpbmcsIGVycm9yTWVzc2FnZTogc3RyaW5nfT59IEF1dGggcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgYXV0aGVudGljYXRlUmVwbGF5KF9wYXJhbXMsIHJlcXVlc3RTdGF0ZSkge1xuICAgIGNvbnN0IGFjdG9yID0gcmVxdWVzdFN0YXRlPy5zaWduZWRSZXBsYXlBY3RvclxuXG4gICAgaWYgKCFhY3Rvcikge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgYXV0aGVudGljYXRlZDogZmFsc2UsXG4gICAgICAgIGVycm9yQ29kZTogXCJtaXNzaW5nLXNpZ25lZC1yZXBsYXlcIixcbiAgICAgICAgZXJyb3JNZXNzYWdlOiBcIkV4cGVjdGVkIGEgcHJlLXZlcmlmaWVkIHNpZ25lZCByZXBsYXlcIlxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB7YWN0b3IsIGF1dGhlbnRpY2F0ZWQ6IHRydWV9XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgc3luYyBlbnZlbG9wZXMgZGVyaXZlZCBmcm9tIHRoZSB2ZXJpZmllZCBzaWduZWQgbXV0YXRpb25zLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gX3BhcmFtcyAtIFJlcXVlc3QgcGFyYW1zLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gcmVxdWVzdFN0YXRlIC0gUmVxdWVzdC1sb2NhbCBzdGF0ZS5cbiAgICogQHJldHVybnMge0FycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IFN5bmMgZW52ZWxvcGVzLlxuICAgKi9cbiAgcmVwbGF5U3luY3MoX3BhcmFtcywgcmVxdWVzdFN0YXRlKSB7XG4gICAgcmV0dXJuIHJlcXVlc3RTdGF0ZT8uc2lnbmVkUmVwbGF5U3luY3MgfHwgW11cbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIHJlcGxheSBjb250ZXh0IGNhcnJ5aW5nIHRoZSB2ZXJpZmllZCBzaWduZWQgYWN0b3IgYW5kIGdyYW50XG4gICAqICh3aXRoIGl0cyBzY29wZXMpIHBsdXMgdGhlIG9mZmxpbmUgcnVudGltZSBtYXJrZXIsIHNvIHJlc291cmNlIGhvb2tzIGFuZFxuICAgKiBhYmlsaXR5IGZhY3RvcmllcyBhdXRob3JpemUgYWdhaW5zdCB0aGUgc2lnbmVyIGluc3RlYWQgb2YgdGhlIHVwbG9hZGVyLlxuICAgKiBAcGFyYW0ge3thY3RvcjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIHBhcmFtczogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCByZXF1ZXN0U3RhdGU6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn19IGFyZ3MgLSBBY3RvciwgcmVxdWVzdCBwYXJhbXMsIGFuZCByZXF1ZXN0LWxvY2FsIHN0YXRlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSBSZXBsYXkgY29udGV4dC5cbiAgICovXG4gIGFzeW5jIGJ1aWxkUmVwbGF5Q29udGV4dCh7YWN0b3IsIHJlcXVlc3RTdGF0ZX0pIHtcbiAgICBjb25zdCBncmFudCA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9vZmZsaW5lLWdyYW50LmpzXCIpLk9mZmxpbmVHcmFudCB8IHVuZGVmaW5lZH0gKi8gKHJlcXVlc3RTdGF0ZT8uc2lnbmVkUmVwbGF5R3JhbnQpXG5cbiAgICByZXR1cm4ge1xuICAgICAgY3VycmVudFVzZXI6IGFjdG9yLFxuICAgICAgb2ZmbGluZUdyYW50OiBncmFudCxcbiAgICAgIG9mZmxpbmVHcmFudFNjb3BlczogZ3JhbnQ/LnNjb3BlcyB8fCB7fSxcbiAgICAgIHJlc291cmNlUnVudGltZTogXCJvZmZsaW5lXCJcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRGVyaXZlcyB0aGUgcm91dGVkLXJlc291cmNlIGFiaWxpdHkgZnJvbSB0aGUgdmVyaWZpZWQgc2lnbmVkIGFjdG9yIGFuZFxuICAgKiBncmFudCB0aHJvdWdoIHRoZSBjb25maWd1cmVkIGBhYmlsaXR5RmFjdG9yeWAuIFRoZSBjb25zdHJ1Y3Rvci13aWRlXG4gICAqIHVwbG9hZGVyIGFiaWxpdHkgaXMgbmV2ZXIgdXNlZCBmb3Igc2lnbmVkIHJlcGxheTogd2l0aG91dCBhIGZhY3RvcnkgKG9yIGFcbiAgICogZmFjdG9yeSByZXN1bHQpIGV2ZXJ5IHJvdXRlZCBzeW5jIGZhaWxzIGNsb3NlZCB3aXRoIGEgY2xpZW50LXNhZmUgZXJyb3IuXG4gICAqIEBwYXJhbSB7e2FjdG9yOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgY29udGV4dDogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fX0gYXJncyAtIFZlcmlmaWVkIGFjdG9yIGFuZCByZXBsYXkgY29udGV4dC5cbiAgICogQHJldHVybnMge1Byb21pc2U8e2FiaWxpdHk6IGltcG9ydChcIi4uL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0LCBhYmlsaXR5Q29udGV4dDogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fT59IFNjb3BlZCBhYmlsaXR5IGFuZCByZXNvdXJjZSBjb250ZXh0LlxuICAgKi9cbiAgYXN5bmMgcmVwbGF5QWJpbGl0eUZvcih7YWN0b3IsIGNvbnRleHR9KSB7XG4gICAgY29uc3QgZ3JhbnQgPSAvKiogQHR5cGUge2ltcG9ydChcIi4vb2ZmbGluZS1ncmFudC5qc1wiKS5PZmZsaW5lR3JhbnR9ICovIChjb250ZXh0Lm9mZmxpbmVHcmFudClcbiAgICBjb25zdCBhYmlsaXR5ID0gdGhpcy5hYmlsaXR5RmFjdG9yeVxuICAgICAgPyBhd2FpdCB0aGlzLmFiaWxpdHlGYWN0b3J5KHthY3RvciwgY29uZmlndXJhdGlvbjogdGhpcy5jb25maWd1cmF0aW9uLCBncmFudH0pXG4gICAgICA6IG51bGxcblxuICAgIGlmICghYWJpbGl0eSkge1xuICAgICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShcIlNpZ25lZCBzeW5jIHJlcGxheSByZXF1aXJlcyBhbiBhY3Rvci9ncmFudC1zY29wZWQgYWJpbGl0eUZhY3RvcnkuXCIsIHtjb2RlOiBcInNpZ25lZC1yZXBsYXktYWJpbGl0eS1taXNzaW5nXCJ9KVxuICAgIH1cblxuICAgIHJldHVybiB7YWJpbGl0eSwgYWJpbGl0eUNvbnRleHQ6IGNvbnRleHR9XG4gIH1cblxuICAvKipcbiAgICogVmVyaWZpZXMgZXZlcnkgc2lnbmVkIG11dGF0aW9uLCBpdHMgb2ZmbGluZSBncmFudCwgYW5kIHRoZSBhY3Rvci9ncmFudFxuICAgKiBjb25zaXN0ZW5jeSwgdGhlbiB0cmFuc2Zvcm1zIHRoZSBlbnZlbG9wZXMgaW50byB0aGUgc3luYyBmb3JtYXQgdGhlIGJhc2VcbiAgICogcmVwbGF5IHNlcnZpY2UgdW5kZXJzdGFuZHMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBwYXJhbXMgLSBSZXF1ZXN0IHBhcmFtcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8e2FjdG9yOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgZ3JhbnQ6IGltcG9ydChcIi4vb2ZmbGluZS1ncmFudC5qc1wiKS5PZmZsaW5lR3JhbnQsIHN5bmNzOiBBcnJheTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fT59IFZlcmlmaWVkIGFjdG9yLCBjb21tb24gZ3JhbnQsIGFuZCBkZXJpdmVkIHN5bmNzLlxuICAgKi9cbiAgYXN5bmMgdmVyaWZ5QW5kVHJhbnNmb3JtU2lnbmVkUmVwbGF5KHBhcmFtcykge1xuICAgIGNvbnN0IHJhd0VudHJpZXMgPSBBcnJheS5pc0FycmF5KHBhcmFtcy5zaWduZWRNdXRhdGlvbnMpID8gcGFyYW1zLnNpZ25lZE11dGF0aW9ucyA6IFtdXG5cbiAgICBpZiAocmF3RW50cmllcy5sZW5ndGggPT09IDApIHtcbiAgICAgIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoXCJFeHBlY3RlZCBzaWduZWQgbXV0YXRpb25zLlwiLCB7Y29kZTogXCJtaXNzaW5nLXNpZ25lZC1tdXRhdGlvbnNcIn0pXG4gICAgfVxuXG4gICAgY29uc3Qgc3luY01hbmlmZXN0ID0gdGhpcy5jb25maWd1cmF0aW9uXG4gICAgICA/IGZyb250ZW5kTW9kZWxTeW5jTWFuaWZlc3RGb3JCYWNrZW5kUHJvamVjdHModGhpcy5jb25maWd1cmF0aW9uLmdldEJhY2tlbmRQcm9qZWN0cygpKVxuICAgICAgOiB7fVxuXG4gICAgLyoqIEB0eXBlIHtzdHJpbmcgfCBudWxsfSAqL1xuICAgIGxldCBncmFudFVzZXJJZCA9IG51bGxcbiAgICAvKiogQHR5cGUge3N0cmluZyB8IG51bGx9ICovXG4gICAgbGV0IGdyYW50RGV2aWNlSWQgPSBudWxsXG4gICAgLyoqIEB0eXBlIHtzdHJpbmcgfCBudWxsfSAqL1xuICAgIGxldCBncmFudElkID0gbnVsbFxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9vZmZsaW5lLWdyYW50LmpzXCIpLk9mZmxpbmVHcmFudCB8IG51bGx9ICovXG4gICAgbGV0IGNvbW1vbkdyYW50ID0gbnVsbFxuICAgIC8qKiBAdHlwZSB7QXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gKi9cbiAgICBjb25zdCBzeW5jcyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IHJhd0VudHJ5IG9mIHJhd0VudHJpZXMpIHtcbiAgICAgIGlmICghcmF3RW50cnkgfHwgdHlwZW9mIHJhd0VudHJ5ICE9PSBcIm9iamVjdFwiKSB7XG4gICAgICAgIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoXCJJbnZhbGlkIHNpZ25lZCBtdXRhdGlvbiBlbnRyeS5cIiwge2NvZGU6IFwiaW52YWxpZC1zaWduZWQtbXV0YXRpb24tZW50cnlcIn0pXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHNpZ25lZE11dGF0aW9uID0gLyoqIEB0eXBlIHtTaWduZWRTeW5jTXV0YXRpb259ICovIChyYXdFbnRyeS5zaWduZWRNdXRhdGlvbilcbiAgICAgIGNvbnN0IHNpZ25lZE9mZmxpbmVHcmFudCA9IC8qKiBAdHlwZSB7U2lnbmVkT2ZmbGluZUdyYW50fSAqLyAocmF3RW50cnkuc2lnbmVkT2ZmbGluZUdyYW50KVxuXG4gICAgICBpZiAoIXNpZ25lZE11dGF0aW9uIHx8ICFzaWduZWRPZmZsaW5lR3JhbnQpIHtcbiAgICAgICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShcIkV4cGVjdGVkIHNpZ25lZCBtdXRhdGlvbiBhbmQgc2lnbmVkIG9mZmxpbmUgZ3JhbnQuXCIsIHtjb2RlOiBcImluY29tcGxldGUtc2lnbmVkLW11dGF0aW9uXCJ9KVxuICAgICAgfVxuXG4gICAgICBjb25zdCBtdXRhdGlvbiA9IGF3YWl0IHZlcmlmeVNpZ25lZE11dGF0aW9uKHtcbiAgICAgICAgYmFja2VuZFB1YmxpY0tleTogdGhpcy5iYWNrZW5kUHVibGljS2V5LFxuICAgICAgICBzaWduZWRNdXRhdGlvblxuICAgICAgfSlcbiAgICAgIGNvbnN0IG9mZmxpbmVHcmFudCA9IGF3YWl0IHZlcmlmeU9mZmxpbmVHcmFudCh7XG4gICAgICAgIHNpZ25lZEdyYW50OiBzaWduZWRPZmZsaW5lR3JhbnQsXG4gICAgICAgIHNpZ25pbmdLZXlzOiB0aGlzLm9mZmxpbmVHcmFudFNpZ25pbmdLZXlzXG4gICAgICB9KVxuXG4gICAgICBpZiAobXV0YXRpb24uYWN0b3JVc2VySWQgIT09IG9mZmxpbmVHcmFudC51c2VySWQpIHtcbiAgICAgICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShcIk11dGF0aW9uIGFjdG9yIGRvZXMgbm90IG1hdGNoIG9mZmxpbmUgZ3JhbnQuXCIsIHtjb2RlOiBcImFjdG9yLWdyYW50LW1pc21hdGNoXCJ9KVxuICAgICAgfVxuXG4gICAgICBpZiAobXV0YXRpb24uYWN0b3JEZXZpY2VJZCAhPT0gb2ZmbGluZUdyYW50LmRldmljZUlkKSB7XG4gICAgICAgIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoXCJNdXRhdGlvbiBkZXZpY2UgZG9lcyBub3QgbWF0Y2ggb2ZmbGluZSBncmFudC5cIiwge2NvZGU6IFwiZGV2aWNlLWdyYW50LW1pc21hdGNoXCJ9KVxuICAgICAgfVxuXG4gICAgICBpZiAobXV0YXRpb24ub2ZmbGluZUdyYW50SWQgIT09IG9mZmxpbmVHcmFudC5ncmFudElkKSB7XG4gICAgICAgIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoXCJNdXRhdGlvbiBncmFudCBpZCBkb2VzIG5vdCBtYXRjaCBvZmZsaW5lIGdyYW50LlwiLCB7Y29kZTogXCJncmFudC1pZC1taXNtYXRjaFwifSlcbiAgICAgIH1cblxuICAgICAgaWYgKGdyYW50VXNlcklkID09PSBudWxsKSB7XG4gICAgICAgIGdyYW50VXNlcklkID0gb2ZmbGluZUdyYW50LnVzZXJJZFxuICAgICAgICBncmFudERldmljZUlkID0gb2ZmbGluZUdyYW50LmRldmljZUlkXG4gICAgICAgIGdyYW50SWQgPSBvZmZsaW5lR3JhbnQuZ3JhbnRJZFxuICAgICAgICBjb21tb25HcmFudCA9IG9mZmxpbmVHcmFudFxuICAgICAgfSBlbHNlIGlmIChcbiAgICAgICAgZ3JhbnRVc2VySWQgIT09IG9mZmxpbmVHcmFudC51c2VySWQgfHxcbiAgICAgICAgZ3JhbnREZXZpY2VJZCAhPT0gb2ZmbGluZUdyYW50LmRldmljZUlkIHx8XG4gICAgICAgIGdyYW50SWQgIT09IG9mZmxpbmVHcmFudC5ncmFudElkXG4gICAgICApIHtcbiAgICAgICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShcIkFsbCBzaWduZWQgbXV0YXRpb25zIGluIGEgYmF0Y2ggbXVzdCBzaGFyZSBhY3RvciwgZGV2aWNlLCBhbmQgZ3JhbnQuXCIsIHtjb2RlOiBcIm1peGVkLXNpZ25lZC1yZXBsYXktYmF0Y2hcIn0pXG4gICAgICB9XG5cbiAgICAgIHRoaXMudmFsaWRhdGVDdXJyZW50U3luY1BvbGljeSh7bXV0YXRpb24sIHN5bmNNYW5pZmVzdH0pXG4gICAgICB0aGlzLnZhbGlkYXRlR3JhbnRBZ2FpbnN0U3luY1BvbGljeSh7bXV0YXRpb24sIG9mZmxpbmVHcmFudCwgc3luY01hbmlmZXN0fSlcblxuICAgICAgY29uc3Qgc3luYyA9IHRoaXMuc3luY0Zyb21TaWduZWRNdXRhdGlvbih7bXV0YXRpb259KVxuICAgICAgY29uc3QgaWRlbXBvdGVuY3lLZXkgPSBtdXRhdGlvbklkZW1wb3RlbmN5S2V5KHttdXRhdGlvbn0pXG5cbiAgICAgIHN5bmNzLnB1c2goey4uLnN5bmMsIGlkOiBpZGVtcG90ZW5jeUtleSwgaWRlbXBvdGVuY3lLZXl9KVxuICAgIH1cblxuICAgIGlmICghZ3JhbnRVc2VySWQgfHwgIWNvbW1vbkdyYW50KSB7XG4gICAgICB0aHJvdyBWZWxvY2lvdXNFcnJvci5zYWZlKFwiQ291bGQgbm90IHJlc29sdmUgc2lnbmVkIHJlcGxheSBhY3Rvci5cIiwge2NvZGU6IFwibWlzc2luZy1zaWduZWQtcmVwbGF5LWFjdG9yXCJ9KVxuICAgIH1cblxuICAgIGlmICh0aGlzLmFjdG9yTG9va3VwKSB7XG4gICAgICBjb25zdCBsb29rZWRVcEFjdG9yID0gYXdhaXQgdGhpcy5hY3Rvckxvb2t1cChncmFudFVzZXJJZClcblxuICAgICAgaWYgKCFsb29rZWRVcEFjdG9yKSB7XG4gICAgICAgIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoXCJTaWduZWQgcmVwbGF5IGFjdG9yIG5vdCBmb3VuZC5cIiwge2NvZGU6IFwic2lnbmVkLXJlcGxheS1hY3Rvci1taXNzaW5nXCJ9KVxuICAgICAgfVxuXG4gICAgICByZXR1cm4ge2FjdG9yOiBsb29rZWRVcEFjdG9yLCBncmFudDogY29tbW9uR3JhbnQsIHN5bmNzfVxuICAgIH1cblxuICAgIHJldHVybiB7YWN0b3I6IHtpZDogKCkgPT4gZ3JhbnRVc2VySWR9LCBncmFudDogY29tbW9uR3JhbnQsIHN5bmNzfVxuICB9XG5cbiAgLyoqXG4gICAqIFZhbGlkYXRlcyBhIG11dGF0aW9uIGFnYWluc3QgdGhlIGN1cnJlbnQgc3luYyBtYW5pZmVzdDogdGhlIG1vZGVsIGFuZCB0aGVcbiAgICogb3BlcmF0aW9uIG11c3QgYmUgZW5hYmxlZCwgYW5kIHRoZSBtdXRhdGlvbidzIHBvbGljeSBoYXNoIG11c3QgbWF0Y2ggdGhlXG4gICAqIGN1cnJlbnQgbWFuaWZlc3QgcG9saWN5IGhhc2guXG4gICAqIEBwYXJhbSB7e211dGF0aW9uOiBpbXBvcnQoXCIuL2RldmljZS1pZGVudGl0eS5qc1wiKS5TeW5jTXV0YXRpb24sIHN5bmNNYW5pZmVzdDogUmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Ob3JtYWxpemVkRnJvbnRlbmRNb2RlbFJlc291cmNlU3luY0NvbmZpZ3VyYXRpb24+fX0gYXJncyAtIFZhbGlkYXRpb24gYXJncy5cbiAgICogQHJldHVybnMge3ZvaWR9IFRocm93cyBhIGNsaWVudC1zYWZlIGVycm9yIHdoZW4gdGhlIGN1cnJlbnQgcG9saWN5IGRlbmllcyB0aGUgbXV0YXRpb24uXG4gICAqL1xuICB2YWxpZGF0ZUN1cnJlbnRTeW5jUG9saWN5KHttdXRhdGlvbiwgc3luY01hbmlmZXN0fSkge1xuICAgIGNvbnN0IHN5bmNSZXNvdXJjZSA9IHN5bmNNYW5pZmVzdFttdXRhdGlvbi5tb2RlbF1cblxuICAgIGlmICghc3luY1Jlc291cmNlKSB7XG4gICAgICB0aHJvdyBWZWxvY2lvdXNFcnJvci5zYWZlKGBTeW5jIHJlcGxheSBtb2RlbCBpcyBub3QgZW5hYmxlZDogJHttdXRhdGlvbi5tb2RlbH0uYCwge2NvZGU6IFwic3luYy1yZXBsYXktbW9kZWwtbm90LWVuYWJsZWRcIn0pXG4gICAgfVxuXG4gICAgaWYgKCFzeW5jUmVzb3VyY2Uub3BlcmF0aW9ucy5pbmNsdWRlcyhtdXRhdGlvbi5vcGVyYXRpb24pKSB7XG4gICAgICB0aHJvdyBWZWxvY2lvdXNFcnJvci5zYWZlKGBTeW5jIHJlcGxheSBvcGVyYXRpb24gaXMgbm90IGVuYWJsZWQgZm9yICR7bXV0YXRpb24ubW9kZWx9OiAke211dGF0aW9uLm9wZXJhdGlvbn0uYCwge2NvZGU6IFwic3luYy1yZXBsYXktb3BlcmF0aW9uLW5vdC1lbmFibGVkXCJ9KVxuICAgIH1cblxuICAgIGlmIChzeW5jUmVzb3VyY2UucG9saWN5SGFzaCAhPT0gbXV0YXRpb24ucG9saWN5SGFzaCkge1xuICAgICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShgU3luYyByZXBsYXkgcG9saWN5IGhhc2ggbWlzbWF0Y2ggZm9yICR7bXV0YXRpb24ubW9kZWx9LmAsIHtjb2RlOiBcInN5bmMtcmVwbGF5LXBvbGljeS1oYXNoLW1pc21hdGNoXCJ9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBWYWxpZGF0ZXMgdGhlIHZlcmlmaWVkIG9mZmxpbmUgZ3JhbnQgYWdhaW5zdCB0aGUgY3VycmVudCBzeW5jIHBvbGljeSwgdGhlXG4gICAqIHNhbWUgY29udHJhY3QgYXMgdGhlIGNvbnRyb2xsZXIncyBzeW5jIHJlcGxheSBlbmRwb2ludDogdGhlIGdyYW50IHJlc291cmNlXG4gICAqIGVudHJ5IG11c3QgYmUgYSBub3JtYWxpemVkIG1hbmlmZXN0IGVudHJ5IChlbmFibGVkIHdpdGggYW4gb3BlcmF0aW9ucyBsaXN0XG4gICAqIGFuZCB0aGUgY3VycmVudCBwb2xpY3kgaGFzaCksIGl0IG11c3QgbGlzdCB0aGUgbXV0YXRpb24gb3BlcmF0aW9uLCBhbmQgaXRzXG4gICAqIHBvbGljeSBoYXNoIG11c3QgZXF1YWwgYm90aCB0aGUgbXV0YXRpb24gYW5kIGN1cnJlbnQgbWFuaWZlc3QgaGFzaGVzLlxuICAgKiBMZWdhY3kgYXJyYXkvdHJ1ZSBncmFudC1yZXNvdXJjZSBzaG9ydGN1dHMgYXJlIG5vdCB0aGUgYm9vdHN0cmFwIGNvbnRyYWN0XG4gICAqIGFuZCBuZXZlciBhdXRob3JpemUgYSBtdXRhdGlvbi5cbiAgICogQHBhcmFtIHt7bXV0YXRpb246IGltcG9ydChcIi4vZGV2aWNlLWlkZW50aXR5LmpzXCIpLlN5bmNNdXRhdGlvbiwgb2ZmbGluZUdyYW50OiBpbXBvcnQoXCIuL29mZmxpbmUtZ3JhbnQuanNcIikuT2ZmbGluZUdyYW50LCBzeW5jTWFuaWZlc3Q6IFJlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTm9ybWFsaXplZEZyb250ZW5kTW9kZWxSZXNvdXJjZVN5bmNDb25maWd1cmF0aW9uPn19IGFyZ3MgLSBWYWxpZGF0aW9uIGFyZ3MuXG4gICAqIEByZXR1cm5zIHt2b2lkfSBUaHJvd3MgYSBjbGllbnQtc2FmZSBlcnJvciB3aGVuIHRoZSBncmFudCBkb2VzIG5vdCBhdXRob3JpemUgdGhlIG11dGF0aW9uLlxuICAgKi9cbiAgdmFsaWRhdGVHcmFudEFnYWluc3RTeW5jUG9saWN5KHttdXRhdGlvbiwgb2ZmbGluZUdyYW50LCBzeW5jTWFuaWZlc3R9KSB7XG4gICAgY29uc3QgZ3JhbnRSZXNvdXJjZSA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgdW5kZWZpbmVkfSAqLyAob2ZmbGluZUdyYW50LnJlc291cmNlc1ttdXRhdGlvbi5tb2RlbF0pXG4gICAgY29uc3QgZ3JhbnRPcGVyYXRpb25zID0gQXJyYXkuaXNBcnJheShncmFudFJlc291cmNlPy5vcGVyYXRpb25zKSA/IGdyYW50UmVzb3VyY2Uub3BlcmF0aW9ucyA6IFtdXG4gICAgY29uc3QgZ3JhbnRQb2xpY3lIYXNoID0gZ3JhbnRSZXNvdXJjZT8ucG9saWN5SGFzaFxuXG4gICAgaWYgKCFncmFudFJlc291cmNlIHx8IGdyYW50UmVzb3VyY2UuZW5hYmxlZCAhPT0gdHJ1ZSkge1xuICAgICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShgT2ZmbGluZSBncmFudCBkb2VzIG5vdCBhdXRob3JpemUgJHttdXRhdGlvbi5tb2RlbH0uYCwge2NvZGU6IFwib2ZmbGluZS1ncmFudC1kZW5pZWRcIn0pXG4gICAgfVxuXG4gICAgaWYgKCFncmFudE9wZXJhdGlvbnMuaW5jbHVkZXMobXV0YXRpb24ub3BlcmF0aW9uKSkge1xuICAgICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShgT2ZmbGluZSBncmFudCBkb2VzIG5vdCBhdXRob3JpemUgJHttdXRhdGlvbi5tb2RlbH06ICR7bXV0YXRpb24ub3BlcmF0aW9ufS5gLCB7Y29kZTogXCJvZmZsaW5lLWdyYW50LWRlbmllZFwifSlcbiAgICB9XG5cbiAgICBpZiAoZ3JhbnRQb2xpY3lIYXNoICE9PSBtdXRhdGlvbi5wb2xpY3lIYXNoIHx8IGdyYW50UG9saWN5SGFzaCAhPT0gc3luY01hbmlmZXN0W211dGF0aW9uLm1vZGVsXT8ucG9saWN5SGFzaCkge1xuICAgICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShgT2ZmbGluZSBncmFudCBwb2xpY3kgaGFzaCBtaXNtYXRjaCBmb3IgJHttdXRhdGlvbi5tb2RlbH0uYCwge2NvZGU6IFwib2ZmbGluZS1ncmFudC1wb2xpY3ktaGFzaC1taXNtYXRjaFwifSlcbiAgICB9XG5cbiAgICBpZiAoIW9mZmxpbmVHcmFudC5zY29wZXMgfHwgdHlwZW9mIG9mZmxpbmVHcmFudC5zY29wZXMgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShvZmZsaW5lR3JhbnQuc2NvcGVzKSkge1xuICAgICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShcIk9mZmxpbmUgZ3JhbnQgc2NvcGVzIGFyZSBpbnZhbGlkLlwiLCB7Y29kZTogXCJvZmZsaW5lLWdyYW50LXNjb3Blcy1pbnZhbGlkXCJ9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBUcmFuc2Zvcm1zIGEgdmVyaWZpZWQgc2lnbmVkIG11dGF0aW9uIGludG8gYSBnZW5lcmljIHN5bmMgZW52ZWxvcGUuXG4gICAqIEBwYXJhbSB7e211dGF0aW9uOiBpbXBvcnQoXCIuL2RldmljZS1pZGVudGl0eS5qc1wiKS5TeW5jTXV0YXRpb259fSBhcmdzIC0gVHJhbnNmb3JtIGFyZ3MuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IFN5bmMgZW52ZWxvcGUuXG4gICAqL1xuICBzeW5jRnJvbVNpZ25lZE11dGF0aW9uKHttdXRhdGlvbn0pIHtcbiAgICBjb25zdCBvcGVyYXRpb24gPSBtdXRhdGlvbi5vcGVyYXRpb25cbiAgICBjb25zdCBhdHRyaWJ1dGVzID0gbXV0YXRpb24uYXR0cmlidXRlcyB8fCB7fVxuICAgIGNvbnN0IHBheWxvYWQgPSBtdXRhdGlvbi5wYXlsb2FkIHx8IHt9XG4gICAgbGV0IHJlc291cmNlSWRcbiAgICBsZXQgZGF0YVxuXG4gICAgaWYgKG9wZXJhdGlvbiA9PT0gXCJjcmVhdGVcIikge1xuICAgICAgcmVzb3VyY2VJZCA9IFN0cmluZyhhdHRyaWJ1dGVzLmlkKVxuICAgICAgZGF0YSA9IHsuLi5hdHRyaWJ1dGVzfVxuICAgIH0gZWxzZSBpZiAob3BlcmF0aW9uID09PSBcInVwZGF0ZVwiKSB7XG4gICAgICByZXNvdXJjZUlkID0gU3RyaW5nKHBheWxvYWQuaWQpXG4gICAgICBkYXRhID0gey4uLmF0dHJpYnV0ZXN9XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIERvbWFpbiBjb21tYW5kcyBjYXJyeSB0aGVpciB0YXJnZXQgaWRlbnRpdHkgaW4gYHBheWxvYWQuaWRgLlxuICAgICAgcmVzb3VyY2VJZCA9IFN0cmluZyhwYXlsb2FkLmlkKVxuICAgICAgZGF0YSA9IHsuLi5wYXlsb2FkfVxuICAgICAgZGVsZXRlIGRhdGEuaWRcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgYmFzZVZlcnNpb246IG11dGF0aW9uLmJhc2VWZXJzaW9uLFxuICAgICAgY2xpZW50TXV0YXRpb25JZDogbXV0YXRpb24uY2xpZW50TXV0YXRpb25JZCxcbiAgICAgIGNsaWVudFVwZGF0ZWRBdDogbXV0YXRpb24ub2NjdXJyZWRBdCxcbiAgICAgIGRhdGEsXG4gICAgICByZXNvdXJjZUlkLFxuICAgICAgcmVzb3VyY2VUeXBlOiBtdXRhdGlvbi5tb2RlbCxcbiAgICAgIHN5bmNUeXBlOiBvcGVyYXRpb25cbiAgICB9XG4gIH1cbn1cbiJdfQ==