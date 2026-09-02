// @ts-check
import { deliverDeclaredBroadcasts, upsertSyncRow } from "./sync-change-fanout.js";
import { markServerApply } from "./sync-publish-suppression.js";
import { resolveFrontendModelResourceClass } from "../frontend-models/resource-definition.js";
import { resolveSyncConflict } from "./conflict-strategy.js";
import SyncReplayUpsertApplier from "./sync-replay-upsert-applier.js";
import stableJsonStringify from "./stable-json.js";
import sha256Hex from "../utils/sha256-hex.js";
import { decodeReplayPersistedData, serializeReplayPersistedData } from "./sync-replay-persisted-data.js";
import { ValidationError } from "../database/record/index.js";
import VelociousError from "../velocious-error.js";
/**
 * Resolved routed-resource registration for one replay resource type.
 * @typedef {object} SyncReplayResourceRegistration
 * @property {string} modelName - Effective frontend model name.
 * @property {import("../configuration-types.js").FrontendModelResourceClassType} resourceClass - Routed resource class.
 * @property {import("../configuration-types.js").NormalizedFrontendModelResourceConfiguration | null} resourceConfiguration - Normalized resource configuration when registry-resolved.
 */
/**
 * @typedef {object} SyncReplayMutation
 * @property {string | number | null} [baseVersion] - Base server/client version observed by the client.
 * @property {string} [clientMutationId] - Original client mutation id from the signed envelope.
 * @property {Date} clientUpdatedAt - Client-side mutation timestamp.
 * @property {Record<string, ReturnType<typeof JSON.parse>>} data - Parsed mutation payload.
 * @property {ReturnType<typeof JSON.parse>} id - Client sync row id for per-sync responses.
 * @property {string} resourceId - Resource id as a string.
 * @property {string} resourceType - Resource/model name.
 * @property {string} serializedData - JSON serialized mutation payload.
 * @property {string} syncType - Sync operation type.
 */
/**
 * One declarative broadcast fanned out after a mutation applies.
 * @typedef {object} SyncReplayBroadcast
 * @property {string | ((args: Record<string, ReturnType<typeof JSON.parse>>) => string)} channel - Channel name or resolver.
 * @property {(args: Record<string, ReturnType<typeof JSON.parse>>) => Record<string, ReturnType<typeof JSON.parse>>} broadcastParams - Channel routing params.
 * @property {(args: Record<string, ReturnType<typeof JSON.parse>>) => ReturnType<typeof JSON.parse>} body - Broadcast body.
 * @property {(args: Record<string, ReturnType<typeof JSON.parse>>) => boolean} [when] - Optional gate; skipped when it returns false.
 */
/**
 * Replays client sync envelopes through project supplied authentication,
 * authorization, application, and persistence hooks.
 *
 * This is intentionally transport/model agnostic: Velocious owns the generic
 * replay loop, normalization, stale-client comparison, and per-sync result
 * shape while each app owns its token lookup, model handlers, and
 * domain authorization rules.
 */
export default class SyncEnvelopeReplayService {
    /**
     * Creates a sync envelope replay service.
     *
     * When a sync model is given, `findExistingReplaySync` and
     * `persistReplayMutation` get model-backed default implementations. The sync
     * model must expose `findBy`/`create` statics plus instance
     * `assign`/`save`/`clientUpdatedAt` and `advanceServerSequence` (the
     * change-feed sequence contract), and the actor returned from
     * `authenticateReplay` must expose an `id()` method.
     * @param {object} [args] - Constructor arguments.
     * @param {{debug?: (...args: Array<unknown>) => void, warn?: (...args: Array<unknown>) => void}} [args.logger] - Logger used for normalization warnings.
     * @param {ReturnType<typeof JSON.parse>} [args.syncModel] - Sync/change model enabling model-backed default hooks.
     * @param {string} [args.actorForeignKeyColumn] - Sync model column linking rows to the replay actor.
     * @param {ReturnType<typeof JSON.parse>} [args.authenticationTokenModel] - Token model enabling the default token-lookup authenticateReplay.
     * @param {string} [args.authenticationTokenColumn] - Token model column holding the token. Defaults to "token".
     * @param {string} [args.authenticationTokenParam] - Request param carrying the token. Defaults to "authenticationToken".
     * @param {Record<string, ((args: Record<string, ReturnType<typeof JSON.parse>>) => Promise<ReturnType<typeof JSON.parse>>) | ConstructorParameters<typeof SyncReplayUpsertApplier>[0]>} [args.applyHandlers] - Per-resourceType apply handlers (functions or declarative upsert-applier specs) enabling the default applyReplayMutation dispatch. Deprecated: prefer resource routing via `configuration`/`resourceTypeOverrides`; applyHandlers remain for released adopters and will be removed after their migration.
     * @param {(args: Record<string, ReturnType<typeof JSON.parse>>) => Record<string, ReturnType<typeof JSON.parse>>} [args.persistExtraAttributes] - Extra attributes merged into the model-backed persisted row (e.g. an event scope column).
     * @param {(args: {mutation: ReturnType<typeof JSON.parse>, applyResult: ReturnType<typeof JSON.parse>}) => ReturnType<typeof JSON.parse>} [args.persistSerializedData] - Overrides the persisted data payload (object results are JSON stringified).
     * @param {(broadcast: {channel: string, params: Record<string, ReturnType<typeof JSON.parse>>, body: ReturnType<typeof JSON.parse>}) => Promise<void>} [args.broadcaster] - Delivers declarative broadcasts. Required when broadcasts are configured.
     * @param {SyncReplayBroadcast[]} [args.broadcasts] - Broadcasts fanned out by the default afterReplayMutation.
     * @param {import("../configuration.js").default} [args.configuration] - Configuration whose frontend-model registry routes mutations to resource classes.
     * @param {{strategy?: "optimisticVersion" | "serverWins", versionAttribute: string} | null} [args.conflictStrategy] - Optional base-version conflict detection for routed upserts. Only `optimisticVersion` and `serverWins` are supported for backend replay because the server does not have the client's base snapshot. When `strategy` is omitted it defaults to `optimisticVersion`, matching `resolveSyncConflict` and normalized resource config. When configured, a mutation whose baseVersion does not match the current server versionAttribute is rejected with a structured conflict result instead of being applied.
     * @param {Record<string, import("../configuration-types.js").FrontendModelResourceClassType | string>} [args.resourceTypeOverrides] - Per-resourceType routing overrides: a resource class, or a string alias resolved through the registry.
     * @param {import("../authorization/ability.js").default} [args.ability] - Ability scoping routed record lookups and create membership checks.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} [args.abilityContext] - Ability context passed to routed resources.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} [args.locals] - Locals passed to routed resources.
     */
    constructor(args = {}) {
        this.logger = args.logger || console;
        this.syncModel = args.syncModel || null;
        this.actorForeignKeyColumn = args.actorForeignKeyColumn || "authentication_token_id";
        this.authenticationTokenModel = args.authenticationTokenModel || null;
        this.authenticationTokenColumn = args.authenticationTokenColumn || "token";
        this.authenticationTokenParam = args.authenticationTokenParam || "authenticationToken";
        this.persistExtraAttributes = args.persistExtraAttributes || null;
        this.persistSerializedData = args.persistSerializedData || null;
        this.broadcaster = args.broadcaster || null;
        this.broadcasts = args.broadcasts || null;
        this.applyHandlers = args.applyHandlers ? this.builtApplyHandlers(args.applyHandlers) : null;
        this.configuration = args.configuration || null;
        this.conflictStrategy = args.conflictStrategy || null;
        this.resourceTypeOverrides = args.resourceTypeOverrides || null;
        this.ability = args.ability || null;
        this.abilityContext = args.abilityContext || null;
        this.locals = args.locals || null;
        /** @type {Map<string, SyncReplayResourceRegistration | null>} */
        this._replayResourceRegistrations = new Map();
        if (args.actorForeignKeyColumn !== undefined && (typeof args.actorForeignKeyColumn !== "string" || args.actorForeignKeyColumn.length < 1)) {
            throw new Error(`actorForeignKeyColumn must be a non-blank string, got: ${String(args.actorForeignKeyColumn)}`);
        }
        if (this.broadcasts && !this.broadcaster) {
            throw new Error("SyncEnvelopeReplayService broadcasts require a broadcaster option delivering them");
        }
        if (this.conflictStrategy) {
            const supportedConflictStrategies = new Set(["optimisticVersion", "serverWins"]);
            if (!this.conflictStrategy.versionAttribute || typeof this.conflictStrategy.versionAttribute !== "string") {
                throw new Error("SyncEnvelopeReplayService conflictStrategy requires a non-blank versionAttribute");
            }
            if (this.conflictStrategy.strategy !== undefined && !supportedConflictStrategies.has(this.conflictStrategy.strategy)) {
                throw new Error(`Unsupported sync conflict strategy for backend replay: ${this.conflictStrategy.strategy}. Only optimisticVersion and serverWins are supported.`);
            }
        }
    }
    /**
     * Wraps declarative apply-handler specs in upsert appliers.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} applyHandlers - Raw apply handlers.
     * @returns {Record<string, (args: Record<string, ReturnType<typeof JSON.parse>>) => Promise<ReturnType<typeof JSON.parse>>>} Callable handlers by resource type.
     */
    builtApplyHandlers(applyHandlers) {
        return Object.fromEntries(Object.entries(applyHandlers).map(([resourceType, handler]) => {
            if (typeof handler === "function")
                return [resourceType, handler];
            const applier = new SyncReplayUpsertApplier(handler);
            return [resourceType, (/** @type {Record<string, ReturnType<typeof JSON.parse>>} */ applyArgs) => applier.apply(/** @type {ReturnType<typeof JSON.parse>} */ (applyArgs))];
        }));
    }
    /**
     * Replays a sync batch.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} params - Request params carrying authentication and syncs.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} [requestState] - Request-local state passed to authentication/sync extraction hooks; subclasses may use this to share pre-computed per-request data without instance mutation.
     * @returns {Promise<{syncs: Array<Record<string, ReturnType<typeof JSON.parse>>>, status?: string, errorCode?: string, errorMessage?: string}>} Replay response.
     */
    async replay(params, requestState = {}) {
        const actorResult = await this.authenticateReplay(params, requestState);
        if (!actorResult.authenticated) {
            return {
                syncs: [],
                status: "error",
                errorCode: actorResult.errorCode,
                errorMessage: actorResult.errorMessage
            };
        }
        const syncResponses = [];
        const context = await this.buildReplayContext({ actor: actorResult.actor, params, requestState });
        for (const rawSync of this.replaySyncs(params, requestState)) {
            const normalizedResult = this.normalizeReplaySync(rawSync);
            if (!normalizedResult.ok) {
                syncResponses.push(normalizedResult.response);
                continue;
            }
            const mutation = normalizedResult.mutation;
            const accessResult = await this.authorizeReplayMutation({ actor: actorResult.actor, context, mutation });
            if (!accessResult.allowed) {
                syncResponses.push({
                    id: mutation.id,
                    syncState: "failed",
                    reason: accessResult.reason || "access-denied"
                });
                continue;
            }
            const existingSync = await this.findExistingReplaySync({ actor: actorResult.actor, context, mutation });
            const shouldApply = await this.shouldApplyReplayMutation({ actor: actorResult.actor, context, existingSync, mutation });
            const duplicate = !shouldApply && this.isDuplicateReplayMutation({ existingSync, mutation });
            /** @type {ReturnType<typeof JSON.parse>} */
            let applyResult;
            try {
                applyResult = shouldApply
                    ? await this.applyReplayMutation({ actor: actorResult.actor, context, existingSync, mutation })
                    : await this.skippedReplayMutation({ actor: actorResult.actor, context, existingSync, mutation });
            }
            catch (error) {
                // Client-safe apply failures (schema validation, model validation,
                // authorization denials, unknown resource types) fail this sync and
                // keep the batch going; unexpected errors keep propagating.
                if (error instanceof VelociousError && error.safeToExpose) {
                    syncResponses.push({
                        id: mutation.id,
                        syncState: "failed",
                        reason: error.code || "apply-failed",
                        message: error.message
                    });
                    continue;
                }
                throw error;
            }
            if (applyResult && applyResult.status === "conflict") {
                syncResponses.push({
                    conflict: applyResult.conflict,
                    id: mutation.id,
                    syncState: "conflict"
                });
                continue;
            }
            await this.persistReplayMutation({ actor: actorResult.actor, context, existingSync, applyResult, mutation, shouldApply });
            await this.afterReplayMutation({ actor: actorResult.actor, context, existingSync, applyResult, mutation, shouldApply });
            /** @type {Record<string, ReturnType<typeof JSON.parse>>} */
            const successfulResponse = { id: mutation.id, syncState: duplicate ? "duplicate" : "successful" };
            const persistedReplayMetadata = duplicate ? this.replayPersistedMetadata(existingSync) : null;
            if (persistedReplayMetadata) {
                successfulResponse.serverVersion = persistedReplayMetadata.acknowledgementVersion;
            }
            else if (this.conflictStrategy && mutation.baseVersion !== undefined && applyResult?.record) {
                successfulResponse.serverVersion = normalizeConflictValue(applyResult.record.readAttribute(this.conflictStrategy.versionAttribute));
            }
            syncResponses.push(successfulResponse);
        }
        return { syncs: syncResponses };
    }
    /**
     * Authenticates the sync batch actor.
     *
     * Defaults to a token-model lookup when `authenticationTokenModel` is
     * configured; otherwise apps override this hook.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} params - Request params.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} [_requestState] - Request-local state populated by subclasses before the base replay loop runs.
     * @returns {Promise<{authenticated: true, actor: ReturnType<typeof JSON.parse>} | {authenticated: false, errorCode: string, errorMessage: string}>} Auth result.
     */
    async authenticateReplay(params, _requestState) {
        if (!this.authenticationTokenModel) {
            throw new Error("SyncEnvelopeReplayService.authenticateReplay must be implemented (or configure authenticationTokenModel)");
        }
        const token = params[this.authenticationTokenParam];
        if (!token) {
            return { authenticated: false, errorCode: "missing-authentication-token", errorMessage: "Missing authentication token" };
        }
        const actor = await this.authenticationTokenModel.findBy({ [this.authenticationTokenColumn]: token });
        if (!actor) {
            return { authenticated: false, errorCode: "invalid-authentication-token", errorMessage: "Invalid authentication token" };
        }
        return { actor, authenticated: true };
    }
    /**
     * Builds per-batch mutable context for caches shared across sync items.
     * @param {{actor: ReturnType<typeof JSON.parse>, params: Record<string, ReturnType<typeof JSON.parse>>, requestState: Record<string, ReturnType<typeof JSON.parse>>}} _args - Actor, request params, and request-local state.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} Replay context.
     */
    async buildReplayContext(_args) {
        return {};
    }
    /**
     * Returns raw sync entries from request params.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} params - Request params.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} [_requestState] - Request-local state populated by subclasses before the base replay loop runs.
     * @returns {Array<ReturnType<typeof JSON.parse>>} Raw sync entries.
     */
    replaySyncs(params, _requestState) {
        return Array.isArray(params.syncs) ? params.syncs : [];
    }
    /**
     * Normalizes one sync entry.
     * @param {ReturnType<typeof JSON.parse>} rawSync - Raw sync entry.
     * @returns {{ok: true, mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation} | {ok: false, response: Record<string, ReturnType<typeof JSON.parse>>}} Normalized mutation or failed response.
     */
    normalizeReplaySync(rawSync) {
        if (!rawSync || typeof rawSync !== "object" || Array.isArray(rawSync)) {
            return { ok: false, response: { id: undefined, syncState: "failed", reason: "invalid-sync" } };
        }
        const sync = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (rawSync);
        const { clientMutationId, clientUpdatedAt, data, id, resourceId, resourceType, syncType } = sync;
        if (typeof resourceType !== "string" || resourceType.length < 1 || resourceId === undefined || resourceId === null || typeof syncType !== "string" || syncType.length < 1) {
            return { ok: false, response: { id, syncState: "failed", reason: "invalid-resource-id" } };
        }
        const resourceIdString = String(resourceId);
        let clientUpdatedAtDate = typeof clientUpdatedAt === "string" || clientUpdatedAt instanceof Date ? new Date(clientUpdatedAt) : new Date();
        if (Number.isNaN(clientUpdatedAtDate.getTime()))
            clientUpdatedAtDate = new Date();
        const normalizedDataResult = this.normalizeReplaySyncData({ data, id, resourceId: resourceIdString, resourceType });
        if (!normalizedDataResult.ok)
            return normalizedDataResult;
        return {
            ok: true,
            mutation: {
                baseVersion: sync.baseVersion,
                clientMutationId,
                clientUpdatedAt: clientUpdatedAtDate,
                data: normalizedDataResult.data,
                id,
                resourceId: resourceIdString,
                resourceType,
                serializedData: JSON.stringify(normalizedDataResult.data),
                syncType
            }
        };
    }
    /**
     * Normalizes one sync data payload.
     * @param {{data: ReturnType<typeof JSON.parse>, id: ReturnType<typeof JSON.parse>, resourceId: string, resourceType: string}} args - Sync payload normalization arguments.
     * @returns {{ok: true, data: Record<string, ReturnType<typeof JSON.parse>>} | {ok: false, response: Record<string, ReturnType<typeof JSON.parse>>}} Normalized payload or failed response.
     */
    normalizeReplaySyncData({ data, id, resourceId, resourceType }) {
        if (data === undefined || data === null)
            return { ok: true, data: {} };
        if (typeof data === "string") {
            try {
                const parsedData = JSON.parse(data);
                if (!parsedData || typeof parsedData !== "object" || Array.isArray(parsedData))
                    return { ok: true, data: {} };
                return { ok: true, data: /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (parsedData) };
            }
            catch (error) {
                this.logger.warn?.("Invalid sync data JSON", { error, id, resourceId, resourceType });
                return { ok: false, response: { id, syncState: "failed", reason: "invalid-data" } };
            }
        }
        if (typeof data !== "object" || Array.isArray(data))
            return { ok: true, data: {} };
        return { ok: true, data: JSON.parse(JSON.stringify(data)) };
    }
    /**
     * Authorizes one normalized mutation.
     * @param {{actor: ReturnType<typeof JSON.parse>, context: Record<string, ReturnType<typeof JSON.parse>>, mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation}} _args - Actor, batch context, and mutation.
     * @returns {Promise<{allowed: boolean, reason?: string}>} Access result.
     */
    async authorizeReplayMutation(_args) {
        return { allowed: true };
    }
    /**
     * Loads the previously stored sync/change row for stale-client comparison.
     *
     * Defaults to a sync-model lookup by actor and resource identity when a sync
     * model is configured; otherwise apps override this hook.
     * @param {{actor: ReturnType<typeof JSON.parse>, context: Record<string, ReturnType<typeof JSON.parse>>, mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation}} args - Actor, batch context, and mutation.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} Existing sync row.
     */
    async findExistingReplaySync({ actor, mutation }) {
        if (!this.syncModel)
            return null;
        return await this.syncModel.findBy({
            [this.actorForeignKeyColumn]: this.replayActorId(actor),
            resource_id: mutation.resourceId,
            resource_type: mutation.resourceType
        });
    }
    /**
     * Resolves the persisted actor id used by model-backed default hooks.
     * @param {ReturnType<typeof JSON.parse>} actor - Actor returned from authenticateReplay.
     * @returns {ReturnType<typeof JSON.parse>} Actor id.
     */
    replayActorId(actor) {
        if (!actor || typeof actor !== "object" || typeof actor.id !== "function") {
            throw new Error("SyncEnvelopeReplayService model-backed defaults require an actor with an id() method from authenticateReplay");
        }
        return actor.id();
    }
    /**
     * Returns whether a normalized mutation should be applied to domain models.
     * @param {{actor: ReturnType<typeof JSON.parse>, context: Record<string, ReturnType<typeof JSON.parse>>, existingSync: ReturnType<typeof JSON.parse>, mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation}} args - Actor, batch context, existing sync row, and mutation.
     * @returns {Promise<boolean>} Whether to apply the mutation.
     */
    async shouldApplyReplayMutation({ existingSync, mutation }) {
        const existingClientUpdatedAt = this.existingReplaySyncClientUpdatedAt(existingSync);
        return !existingClientUpdatedAt || mutation.clientUpdatedAt > existingClientUpdatedAt;
    }
    /**
     * Resolves the client timestamp from an existing sync row.
     * @param {ReturnType<typeof JSON.parse>} existingSync - Existing sync row.
     * @returns {Date | null} Existing client timestamp.
     */
    existingReplaySyncClientUpdatedAt(existingSync) {
        if (!existingSync || typeof existingSync !== "object")
            return null;
        const syncRecord = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (existingSync);
        const value = typeof syncRecord.clientUpdatedAt === "function"
            ? syncRecord.clientUpdatedAt()
            : syncRecord.clientUpdatedAt;
        if (value instanceof Date)
            return value;
        if (typeof value !== "string")
            return null;
        const parsedValue = new Date(value);
        return Number.isNaN(parsedValue.getTime()) ? null : parsedValue;
    }
    /**
     * Checks whether a skipped mutation exactly matches the persisted replay row.
     * Older distinct mutations retain the established successful stale-skip response.
     * @param {{existingSync: ReturnType<typeof JSON.parse>, mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation}} args - Existing row and incoming mutation.
     * @returns {boolean} Whether this is a duplicate replay.
     */
    isDuplicateReplayMutation({ existingSync, mutation }) {
        if (!existingSync)
            return false;
        const metadata = this.replayPersistedMetadata(existingSync);
        if (metadata) {
            return metadata.clientMutationId === String(mutation.clientMutationId || mutation.id)
                && metadata.payloadFingerprint === sha256Hex(mutation.serializedData);
        }
        const existingClientUpdatedAt = this.existingReplaySyncClientUpdatedAt(existingSync);
        const existingData = this.replaySyncRecordValue(existingSync, "data");
        const existingSyncType = this.replaySyncRecordValue(existingSync, "syncType");
        const serializedExistingData = typeof existingData === "string" ? existingData : JSON.stringify(existingData);
        return existingClientUpdatedAt?.getTime() === mutation.clientUpdatedAt.getTime()
            && serializedExistingData === mutation.serializedData
            && existingSyncType === mutation.syncType;
    }
    /**
     * Reads a model-backed sync-row value through its accessor or plain property.
     * @param {ReturnType<typeof JSON.parse>} syncRecord - Existing sync row.
     * @param {string} attributeName - Attribute name.
     * @returns {ReturnType<typeof JSON.parse>} Stored value.
     */
    replaySyncRecordValue(syncRecord, attributeName) {
        const record = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (syncRecord);
        const value = record[attributeName];
        return typeof value === "function" ? value.call(syncRecord) : value;
    }
    /**
     * Reads durable replay acknowledgement metadata from a model-backed sync row.
     * @param {ReturnType<typeof JSON.parse>} syncRecord - Existing sync row.
     * @returns {{acknowledgementVersion: string | number | null, clientMutationId: string, payloadFingerprint: string} | null} Persisted metadata.
     */
    replayPersistedMetadata(syncRecord) {
        if (!syncRecord)
            return null;
        return decodeReplayPersistedData(this.replaySyncRecordValue(syncRecord, "data")).metadata;
    }
    /**
     * Applies one normalized mutation to domain models.
     *
     * Dispatches through the configured apply-handler registry first (compat
     * precedence); mutations without a matching handler fall through to
     * resource routing when a configuration or resourceTypeOverrides are
     * configured, and otherwise fail loudly.
     * @param {{actor: ReturnType<typeof JSON.parse>, context: Record<string, ReturnType<typeof JSON.parse>>, existingSync: ReturnType<typeof JSON.parse>, mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation}} args - Actor, batch context, existing sync row, and mutation.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} Project-specific apply result.
     */
    async applyReplayMutation(args) {
        if (this.applyHandlers) {
            const applyHandler = this.applyHandlers[args.mutation.resourceType];
            if (applyHandler)
                return await applyHandler(args);
            if (!this.routingConfigured())
                throw new Error(`No sync apply handler registered for: ${args.mutation.resourceType}`);
        }
        if (this.routingConfigured())
            return await this.applyRoutedReplayMutation(args);
        return null;
    }
    /**
     * Returns whether resource routing is configured on this service.
     * @returns {boolean} Whether mutations route to frontend-model resources.
     */
    routingConfigured() {
        return Boolean(this.configuration || this.resourceTypeOverrides);
    }
    /**
     * Resolves the routed resource registration for a resource type, memoized
     * per replay service. Overrides win over the configuration registry; string
     * overrides are aliases resolved through the registry.
     * @param {string} resourceType - Mutation resource type.
     * @returns {SyncReplayResourceRegistration | null} Resolved registration or null when unroutable.
     */
    replayResourceRegistration(resourceType) {
        const memoizedRegistration = this._replayResourceRegistrations.get(resourceType);
        if (memoizedRegistration !== undefined)
            return memoizedRegistration;
        const registration = this.resolveReplayResourceRegistration(resourceType);
        this._replayResourceRegistrations.set(resourceType, registration);
        return registration;
    }
    /**
     * Uncached routed-resource resolution behind {@link SyncEnvelopeReplayService#replayResourceRegistration}.
     * @param {string} resourceType - Mutation resource type.
     * @returns {SyncReplayResourceRegistration | null} Resolved registration or null when unroutable.
     */
    resolveReplayResourceRegistration(resourceType) {
        const override = this.resourceTypeOverrides?.[resourceType];
        if (override && typeof override !== "string") {
            return { modelName: resourceType, resourceClass: override, resourceConfiguration: null };
        }
        const registryResourceType = typeof override === "string" ? override : resourceType;
        if (!this.configuration)
            return null;
        const resolvedRegistration = resolveFrontendModelResourceClass({ configuration: this.configuration, resourceType: registryResourceType });
        if (!resolvedRegistration)
            return null;
        return {
            modelName: resolvedRegistration.modelName,
            resourceClass: resolvedRegistration.resourceClass,
            resourceConfiguration: resolvedRegistration.resourceConfiguration
        };
    }
    /**
     * Resolves the ability and resource context used to authorize routed
     * resources. Defaults to the constructor-wide ability/abilityContext;
     * subclasses (signed replay) override this to derive authorization from a
     * verified actor/grant instead of uploader-global state.
     * @param {{actor: ReturnType<typeof JSON.parse>, context: Record<string, ReturnType<typeof JSON.parse>>}} _args - Replay actor and batch context.
     * @returns {Promise<{ability: import("../authorization/ability.js").default | undefined, abilityContext: Record<string, ReturnType<typeof JSON.parse>>}>} Ability and resource context.
     */
    async replayAbilityFor(_args) {
        return { ability: this.ability || undefined, abilityContext: this.abilityContext || {} };
    }
    /**
     * Builds the routed resource instance handling one mutation.
     * @param {object} args - Options.
     * @param {ReturnType<typeof JSON.parse>} args.actor - Replay actor.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.context - Replay context.
     * @param {import("./sync-envelope-replay-service.js").SyncReplayMutation} args.mutation - Normalized replay mutation.
     * @param {SyncReplayResourceRegistration} args.registration - Resolved resource registration.
     * @returns {Promise<import("../frontend-model-resource/base-resource.js").default>} Routed resource instance.
     */
    async buildReplayResource({ actor, context, mutation, registration }) {
        const ResourceClass = registration.resourceClass;
        const { ability, abilityContext } = await this.replayAbilityFor({ actor, context });
        return new ResourceClass({
            ability,
            context: abilityContext,
            locals: { ...(this.locals || {}), ...(this.configuration ? { configuration: this.configuration } : {}) },
            modelName: registration.modelName,
            params: mutation.data,
            ...(registration.resourceConfiguration ? { resourceConfiguration: registration.resourceConfiguration } : {})
        });
    }
    /**
     * Applies one mutation through its routed frontend-model resource:
     * authorization, ability-scoped record lookup, schema normalization and
     * assign/save for updates, save-then-check membership creates, destroys for
     * deletes, and the resource's afterSyncApply tail. Client-safe failures
     * throw safe errors that fail the single sync.
     * @param {{actor: ReturnType<typeof JSON.parse>, context: Record<string, ReturnType<typeof JSON.parse>>, existingSync: ReturnType<typeof JSON.parse>, mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation}} args - Actor, batch context, existing sync row, and mutation.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} Apply result with record, created/deleted flags, and afterSyncApply extras.
     */
    async applyRoutedReplayMutation({ actor, context, existingSync, mutation }) {
        const registration = this.replayResourceRegistration(mutation.resourceType);
        if (!registration) {
            throw VelociousError.safe(`Unknown sync resource type: ${mutation.resourceType}.`, { code: "unknown-resource-type" });
        }
        const resource = await this.buildReplayResource({ actor, context, mutation, registration });
        const customApplyResult = await resource.applySync({ context, existingSync, mutation });
        if (customApplyResult !== null)
            return customApplyResult;
        const authorization = await resource.authorizeSyncMutation({ context, mutation });
        if (!authorization.allowed) {
            throw VelociousError.safe(`Sync mutation denied for: ${mutation.resourceType}.`, { code: authorization.reason || "access-denied" });
        }
        if (mutation.syncType === "delete")
            return await this.applyRoutedReplayDelete({ mutation, resource });
        const commandApplyResult = await this.applyRoutedReplayCommand({ context, mutation, resource });
        if (commandApplyResult !== null)
            return commandApplyResult;
        return await this.applyRoutedReplayUpsert({ context, mutation, resource });
    }
    /**
     * Dispatches a routed sync mutation whose syncType matches a resource-declared
     * custom command. Returns null when the mutation is not a command so the
     * caller can fall through to the default upsert path.
     * @param {{context: Record<string, ReturnType<typeof JSON.parse>>, mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation, resource: import("../frontend-model-resource/base-resource.js").default}} args - Command dispatch args.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>> | null>} Command apply result or null.
     */
    async applyRoutedReplayCommand({ context, mutation, resource }) {
        const commandConfig = this.resourceCommandConfig(resource);
        const commandMethodName = this.commandMethodNameForSyncType({ commandConfig, syncType: mutation.syncType });
        if (!commandMethodName)
            return null;
        const commandMethod = resource.resourceMethod(commandMethodName);
        if (!commandMethod) {
            throw VelociousError.safe(`Sync command handler missing for: ${mutation.resourceType}.${mutation.syncType}.`, { code: "sync-command-handler-missing" });
        }
        const args = this.commandArgsForMutation({ commandConfig, commandMethodName, mutation });
        const result = await commandMethod.method.call(commandMethod.resource, args);
        const afterExtras = await resource.afterSyncApply({ context, created: false, mutation, record: null });
        const resultObject = result && typeof result === "object" && !Array.isArray(result) ? result : {};
        return { commandResult: result, created: false, deleted: false, record: null, ...resultObject, ...afterExtras };
    }
    /**
     * Resolves the custom-command configuration declared on a routed resource.
     * @param {import("../frontend-model-resource/base-resource.js").default} resource - Routed resource instance.
     * @returns {{collectionCommands: Record<string, string>, memberCommands: Record<string, string>}} Command config.
     */
    resourceCommandConfig(resource) {
        const config = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (resource.resourceConfigurationValue || {});
        return {
            collectionCommands: config.collectionCommands || {},
            memberCommands: config.memberCommands || {}
        };
    }
    /**
     * Resolves the resource method name for a syncType when it names a declared
     * custom command.
     * @param {{commandConfig: {collectionCommands: Record<string, string>, memberCommands: Record<string, string>}, syncType: string}} args - Lookup args.
     * @returns {string | null} Method name or null.
     */
    commandMethodNameForSyncType({ commandConfig, syncType }) {
        if (commandConfig.memberCommands[syncType])
            return syncType;
        if (commandConfig.collectionCommands[syncType])
            return syncType;
        return null;
    }
    /**
     * Builds the arguments object passed to a resource command method. Member
     * commands receive the envelope's resourceId as `id`; the envelope identity
     * is assigned after the payload so a payload `id` can never retarget the
     * command away from the resource the authorization hooks approved.
     * @param {{commandConfig: {collectionCommands: Record<string, string>, memberCommands: Record<string, string>}, commandMethodName: string, mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation}} args - Args builder args.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} Command method arguments.
     */
    commandArgsForMutation({ commandConfig, commandMethodName, mutation }) {
        const isMember = commandConfig.memberCommands[commandMethodName] !== undefined;
        if (isMember) {
            return { ...mutation.data, id: mutation.resourceId };
        }
        return { ...mutation.data };
    }
    /**
     * Applies a routed delete mutation. The record is marked as a server apply
     * for the duration of the replay-owned destroy - an active SyncPublisher
     * never publishes the replayed delete a second time (the replay owns its
     * own persist and broadcasts), while later server-side writes to the same
     * instance publish normally again.
     * @param {object} args - Options.
     * @param {import("./sync-envelope-replay-service.js").SyncReplayMutation} args.mutation - Normalized replay mutation.
     * @param {import("../frontend-model-resource/base-resource.js").default} args.resource - Routed resource instance.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} Apply result with the deleted flag.
     */
    async applyRoutedReplayDelete({ mutation, resource }) {
        const ModelClass = resource.modelClass();
        const runDelete = async () => {
            const record = await resource.findSyncRecord({ forDelete: true, mutation });
            if (!record)
                return { created: false, deleted: false, record: null };
            const conflictResult = await this.routedReplayConflictResult({ attributes: {}, existingRecord: record, mutation, resource });
            if (conflictResult)
                return conflictResult;
            const releaseServerApply = markServerApply(record);
            try {
                await record.destroy();
            }
            finally {
                releaseServerApply();
            }
            return { created: false, deleted: true, record };
        };
        if (!this.conflictStrategy)
            return await runDelete();
        return await ModelClass.withAdvisoryLock(syncReplayConflictLockName({ resourceId: mutation.resourceId, resourceType: mutation.resourceType }), runDelete, { dedicatedConnection: true });
    }
    /**
     * Applies a routed upsert mutation: permitted payload attributes are
     * assigned and saved onto the found record (the record layer owns value
     * casting and validation), and missing records are created with the
     * client-generated primary key plus a save-then-check membership check.
     * Written records are marked as server applies for the duration of the
     * replay-owned write - an active SyncPublisher never publishes the replayed
     * mutation a second time (the replay owns its own persist and broadcasts),
     * while later server-side writes to the same instance publish normally
     * again. Model validation failures become client-safe per-sync failures
     * carrying the translated validation message.
     * @param {object} args - Options.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.context - Replay context.
     * @param {import("./sync-envelope-replay-service.js").SyncReplayMutation} args.mutation - Normalized replay mutation.
     * @param {import("../frontend-model-resource/base-resource.js").default} args.resource - Routed resource instance.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} Apply result with record, created flag, and afterSyncApply extras.
     */
    async applyRoutedReplayUpsert({ context, mutation, resource }) {
        const attributes = this.permittedRoutedAttributes({ mutation, resource });
        const ModelClass = resource.modelClass();
        const runUpsert = async () => {
            const existingRecord = await resource.findSyncRecord({ mutation });
            const conflictResult = await this.routedReplayConflictResult({ attributes, existingRecord, mutation, resource });
            if (conflictResult)
                return conflictResult;
            /** @type {import("../database/record/index.js").default | null} */
            let record = existingRecord;
            let created = false;
            if (existingRecord) {
                const releaseServerApply = markServerApply(existingRecord);
                try {
                    existingRecord.assign(attributes);
                    await this.saveRoutedReplayRecord(existingRecord);
                }
                finally {
                    releaseServerApply();
                }
            }
            else {
                record = await this.createRoutedReplayRecord({ attributes, mutation, resource });
                created = true;
            }
            const extras = await resource.afterSyncApply({ context, created, mutation, record });
            return { created, deleted: false, record, ...extras };
        };
        if (!this.conflictStrategy)
            return await runUpsert();
        return await ModelClass.withAdvisoryLock(syncReplayConflictLockName({ resourceId: mutation.resourceId, resourceType: mutation.resourceType }), runUpsert, { dedicatedConnection: true });
    }
    /**
     * Checks whether a routed upsert mutation conflicts with the current server
     * state when the service is configured with a conflict strategy. A mutation
     * whose baseVersion does not match the server's current versionAttribute is
     * rejected with a structured conflict payload instead of being applied.
     * @param {object} args - Conflict-check args.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.attributes - Permitted mutation attributes.
     * @param {import("../database/record/index.js").default | null} args.existingRecord - Existing server record.
     * @param {import("./sync-envelope-replay-service.js").SyncReplayMutation} args.mutation - Normalized replay mutation.
     * @param {import("../frontend-model-resource/base-resource.js").default} args.resource - Routed resource instance.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>> | null>} - Conflict apply result, or null when no conflict.
     */
    async routedReplayConflictResult({ attributes, existingRecord, mutation, resource }) {
        if (!this.conflictStrategy)
            return null;
        if (!existingRecord || mutation.syncType === "create")
            return null;
        if (mutation.baseVersion === undefined || mutation.baseVersion === null)
            return null;
        const ModelClass = resource.modelClass();
        const primaryKey = ModelClass.primaryKey();
        const primaryKeyAttribute = ModelClass.resolveAttributeName(primaryKey);
        const versionAttribute = this.conflictStrategy.versionAttribute;
        const versionAttributeName = ModelClass.resolveAttributeName(versionAttribute);
        if (!primaryKeyAttribute)
            throw new Error(`Couldn't resolve primary key attribute: ${primaryKey}`);
        if (!versionAttributeName)
            throw new Error(`Couldn't resolve version attribute: ${versionAttribute}`);
        const serverVersion = normalizeConflictValue(existingRecord.readAttribute(versionAttributeName));
        if (stableJsonStringify(serverVersion) === stableJsonStringify(mutation.baseVersion))
            return null;
        const serializedAffectedAttributes = await this.serializedRoutedConflictAttributes({ attributes, existingRecord, resource });
        const serverAttributes = {
            ...serializedAffectedAttributes,
            [primaryKeyAttribute]: existingRecord.readAttribute(primaryKeyAttribute),
            [versionAttributeName]: serverVersion
        };
        const serverRecord = {
            attributes: serverAttributes,
            version: serverVersion
        };
        const conflictMutation = /** @type {import("./device-identity.js").SyncMutation} */ ( /** @type {unknown} */({
            attributes,
            baseVersion: mutation.baseVersion,
            clientMutationId: mutation.clientMutationId || mutation.id,
            model: mutation.resourceType,
            operation: mutation.syncType,
            payload: { id: mutation.resourceId }
        }));
        const result = await resolveSyncConflict({
            baseRecord: null,
            mutation: conflictMutation,
            serverRecord,
            strategy: this.conflictStrategy.strategy || "optimisticVersion",
            versionAttribute
        });
        if (result.status !== "conflict")
            return null;
        return { conflict: result.conflict, created: false, deleted: false, record: existingRecord, status: "conflict" };
    }
    /**
     * Projects affected mutation fields through the resource's readable
     * attribute contract. Writable-but-hidden fields are omitted, while custom
     * `<attribute>Attribute(model)` serializers and model accessors remain the
     * source of frontend-visible values (Date values are kept raw so the normal
     * frontend-model transport serializer can emit its date marker). Projected
     * keys use canonical model attribute names even when the mutation used a
     * database-column alias. The full model attribute hash is never exposed.
     * @param {object} args - Projection args.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.attributes - Permitted affected mutation attributes.
     * @param {import("../database/record/index.js").default} args.existingRecord - Authorized server record.
     * @param {import("../frontend-model-resource/base-resource.js").default} args.resource - Routed resource instance.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} Serialized readable affected attributes.
     */
    async serializedRoutedConflictAttributes({ attributes, existingRecord, resource }) {
        const ModelClass = resource.modelClass();
        const ResourceClass = /** @type {import("../configuration-types.js").FrontendModelResourceClassType} */ (resource.constructor);
        const readableAttributes = new Set();
        const configuredAttributes = ResourceClass.resourceConfig().attributes;
        const configuredEntries = Array.isArray(configuredAttributes) ? configuredAttributes : Object.keys(configuredAttributes);
        if (configuredEntries.length === 0) {
            const attributeNameToColumnName = ModelClass.getAttributeNameToColumnNameMap();
            for (const attributeName of Object.keys(attributeNameToColumnName)) {
                readableAttributes.add(attributeName);
            }
        }
        for (const configuredAttribute of configuredEntries) {
            const configuredName = typeof configuredAttribute === "string" ? configuredAttribute : configuredAttribute.name;
            if (!configuredName)
                continue;
            const canonicalName = ModelClass.resolveAttributeName(configuredName);
            readableAttributes.add(canonicalName || configuredName);
        }
        /** @type {Record<string, ReturnType<typeof JSON.parse>>} */
        const serializedAttributes = {};
        for (const affectedField of Object.keys(attributes)) {
            const attributeName = ModelClass.resolveAttributeName(affectedField);
            if (!attributeName || !readableAttributes.has(attributeName))
                continue;
            const resourceAttribute = resource.resourceMethod(`${attributeName}Attribute`);
            if (resourceAttribute) {
                serializedAttributes[attributeName] = await resourceAttribute.method.call(resourceAttribute.resource, existingRecord);
                continue;
            }
            const recordMethods = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ ( /** @type {unknown} */(existingRecord));
            const attributeMethod = recordMethods[attributeName];
            if (typeof attributeMethod === "function") {
                serializedAttributes[attributeName] = await attributeMethod.call(existingRecord);
            }
            else {
                serializedAttributes[attributeName] = existingRecord.readAttribute(attributeName);
            }
        }
        return serializedAttributes;
    }
    /**
     * Filters a routed mutation payload down to the resource's declared
     * writable-attribute permit list. Accepted keys per permitted attribute are
     * the camelCase attribute name plus the model's actual column name; unknown
     * keys fail the sync loudly. The primary key is dropped when permitted
     * (snapshot payloads) — the envelope's resourceId is the authoritative
     * record identity, so a payload id can never retarget the row.
     * @param {object} args - Options.
     * @param {import("./sync-envelope-replay-service.js").SyncReplayMutation} args.mutation - Normalized replay mutation.
     * @param {import("../frontend-model-resource/base-resource.js").default} args.resource - Routed resource instance.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} Permitted attributes for record.assign.
     */
    permittedRoutedAttributes({ mutation, resource }) {
        const permittedAttributes = resource.declaredWritableAttributes();
        if (!permittedAttributes) {
            throw new Error(`${resource.constructor.name} must declare static writableAttributes to apply routed sync mutations for: ${mutation.resourceType}`);
        }
        const ModelClass = resource.modelClass();
        const attributeNameToColumnName = ModelClass.getAttributeNameToColumnNameMap();
        /** @type {Set<string>} */
        const allowedKeys = new Set();
        for (const attributeName of permittedAttributes) {
            allowedKeys.add(attributeName);
            const columnName = attributeNameToColumnName[attributeName];
            if (columnName)
                allowedKeys.add(columnName);
        }
        const primaryKey = ModelClass.primaryKey();
        const primaryKeyAttribute = ModelClass.getColumnNameToAttributeNameMap()[primaryKey];
        /** @type {Record<string, ReturnType<typeof JSON.parse>>} */
        const attributes = {};
        for (const [key, value] of Object.entries(mutation.data)) {
            if (!allowedKeys.has(key)) {
                throw resource.writableAttributeError(`Unknown attribute: ${key}.`, { code: "sync-unknown-attribute" });
            }
            if (key === primaryKey || key === primaryKeyAttribute)
                continue;
            attributes[key] = value;
        }
        return attributes;
    }
    /**
     * Creates the routed record with the client-generated primary key (marked
     * as a server apply for the duration of the create - including the
     * membership-check compensation destroy - so an active SyncPublisher never
     * publishes the replayed create a second time), then
     * verifies create-scope membership when an ability is configured: records
     * outside the ability's create scope are destroyed again and fail the sync
     * with the resource-declared reason. A record that already exists outside
     * the resource's lookup scope fails the sync as an authorization denial
     * instead of colliding on the primary key.
     * @param {object} args - Options.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.attributes - Permitted payload attributes.
     * @param {import("./sync-envelope-replay-service.js").SyncReplayMutation} args.mutation - Normalized replay mutation.
     * @param {import("../frontend-model-resource/base-resource.js").default} args.resource - Routed resource instance.
     * @returns {Promise<import("../database/record/index.js").default>} Created record.
     */
    async createRoutedReplayRecord({ attributes, mutation, resource }) {
        const ModelClass = resource.modelClass();
        const primaryKey = ModelClass.primaryKey();
        const conflictingIds = await ModelClass.where({ [primaryKey]: mutation.resourceId }).pluck(primaryKey);
        if (conflictingIds.length > 0) {
            throw VelociousError.safe(`Sync update denied for: ${mutation.resourceType}.`, {
                code: resource.syncAuthorizationFailureReason({ action: "update", mutation }) || "access-denied"
            });
        }
        await ModelClass.ensureInitialized();
        const record = new ModelClass({ [primaryKey]: mutation.resourceId, ...attributes });
        const releaseServerApply = markServerApply(record);
        try {
            try {
                await record.save();
            }
            catch (error) {
                throw this.routedReplaySaveError(error);
            }
            const ability = resource.ability;
            if (ability) {
                const memberIds = await ModelClass
                    .accessibleFor(resource.syncAbilityAction("create"), ability)
                    .where({ [primaryKey]: record.id() })
                    .pluck(primaryKey);
                if (memberIds.length === 0) {
                    await record.destroy();
                    throw VelociousError.safe(`Sync create denied for: ${mutation.resourceType}.`, {
                        code: resource.syncAuthorizationFailureReason({ action: "create", mutation }) || "access-denied"
                    });
                }
            }
            return record;
        }
        finally {
            releaseServerApply();
        }
    }
    /**
     * Saves a routed record, converting model validation failures into
     * client-safe per-sync errors carrying the translated validation message.
     * @param {import("../database/record/index.js").default} record - Record to save.
     * @returns {Promise<void>} Resolves when saved.
     */
    async saveRoutedReplayRecord(record) {
        try {
            await record.save();
        }
        catch (error) {
            throw this.routedReplaySaveError(error);
        }
    }
    /**
     * Maps a routed save/create failure: model validation errors become
     * client-safe errors with their translated messages, everything else
     * propagates unchanged.
     * @param {ReturnType<typeof JSON.parse>} error - Thrown save/create error.
     * @returns {Error} Error to rethrow.
     */
    routedReplaySaveError(error) {
        if (error instanceof ValidationError) {
            return VelociousError.safe(error.message, { cause: error, code: "validation-error" });
        }
        return /** @type {Error} */ (error);
    }
    /**
     * Resolves an apply result for stale mutations that should not touch domain models.
     * Exact duplicates resolve the current routed record so the acknowledgement
     * can include its authoritative version without applying the mutation again.
     * @param {{actor: ReturnType<typeof JSON.parse>, context: Record<string, ReturnType<typeof JSON.parse>>, existingSync: ReturnType<typeof JSON.parse>, mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation}} args - Actor, batch context, existing sync row, and mutation.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} Project-specific apply result.
     */
    async skippedReplayMutation({ actor, context, existingSync, mutation }) {
        if (!this.isDuplicateReplayMutation({ existingSync, mutation }) || !this.routingConfigured())
            return null;
        const registration = this.replayResourceRegistration(mutation.resourceType);
        if (!registration)
            return null;
        const resource = await this.buildReplayResource({ actor, context, mutation, registration });
        const record = await resource.findSyncRecord({ forDelete: mutation.syncType === "delete", mutation });
        return { created: false, deleted: false, duplicate: true, record };
    }
    /**
     * Persists one normalized mutation into the app sync/change store.
     *
     * Defaults to a stale-guarded sync-model upsert (with server re-sequencing on
     * updates) when a sync model is configured; otherwise apps override this hook.
     * @param {{actor: ReturnType<typeof JSON.parse>, context: Record<string, ReturnType<typeof JSON.parse>>, existingSync: ReturnType<typeof JSON.parse>, applyResult: ReturnType<typeof JSON.parse>, mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation, shouldApply: boolean}} args - Replay persistence arguments.
     * @returns {Promise<void>}
     */
    async persistReplayMutation({ actor, applyResult, context, existingSync, mutation, shouldApply }) {
        if (!this.syncModel)
            return;
        const attributes = this.replayPersistAttributes({ actor, mutation });
        // Stale replays never applied anything, so the applyResult-driven extension
        // hooks must not run against the default null skipped result.
        if (this.persistExtraAttributes && shouldApply) {
            Object.assign(attributes, this.persistExtraAttributes({ actor, applyResult, context, existingSync, mutation, shouldApply }));
        }
        if (this.persistSerializedData && shouldApply) {
            const serializedData = this.persistSerializedData({ applyResult, mutation });
            if (serializedData !== undefined && serializedData !== null) {
                attributes.data = typeof serializedData === "string" ? serializedData : JSON.stringify(serializedData);
            }
        }
        if (this.conflictStrategy && shouldApply && mutation.baseVersion !== undefined && applyResult?.record) {
            const publicPayload = decodeReplayPersistedData(attributes.data).payload;
            const acknowledgementVersion = normalizeConflictValue(applyResult.record.readAttribute(this.conflictStrategy.versionAttribute));
            attributes.data = serializeReplayPersistedData({
                acknowledgementVersion,
                clientMutationId: String(mutation.clientMutationId || mutation.id),
                payload: publicPayload,
                payloadFingerprint: sha256Hex(mutation.serializedData)
            });
        }
        if (existingSync) {
            const existingClientUpdatedAt = this.existingReplaySyncClientUpdatedAt(existingSync);
            if (existingClientUpdatedAt && mutation.clientUpdatedAt <= existingClientUpdatedAt)
                return;
        }
        await upsertSyncRow({ attributes, existingSync, syncModel: this.syncModel });
    }
    /**
     * Builds the sync-model attributes persisted by the model-backed default.
     * @param {{actor: ReturnType<typeof JSON.parse>, mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation}} args - Actor and mutation.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} Sync row attributes.
     */
    replayPersistAttributes({ actor, mutation }) {
        return {
            [this.actorForeignKeyColumn]: this.replayActorId(actor),
            client_updated_at: mutation.clientUpdatedAt,
            data: mutation.serializedData,
            resource_id: mutation.resourceId,
            resource_type: mutation.resourceType,
            sync_type: mutation.syncType
        };
    }
    /**
     * Runs side effects after a successful mutation replay and persistence.
     *
     * Defaults to fanning the applied result out through the configured
     * declarative broadcasts.
     * @param {{actor: ReturnType<typeof JSON.parse>, context: Record<string, ReturnType<typeof JSON.parse>>, existingSync: ReturnType<typeof JSON.parse>, applyResult: ReturnType<typeof JSON.parse>, mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation, shouldApply: boolean}} args - Replay side-effect arguments.
     * @returns {Promise<void>}
     */
    async afterReplayMutation(args) {
        if (!this.broadcasts || !this.broadcaster)
            return;
        // Stale replays never applied anything - broadcasting their skipped results
        // would fan out stale side effects (or crash on the default null applyResult).
        if (!args.shouldApply)
            return;
        await deliverDeclaredBroadcasts({ args, broadcaster: this.broadcaster, broadcasts: this.broadcasts });
    }
}
/**
 * Returns a deterministic, MySQL-safe advisory-lock name for a routed replay
 * resource identity. The full `{resourceType, resourceId}` identity is hashed
 * with SHA-256 and truncated to 32 hex characters so the final name stays well
 * under MySQL/MariaDB's 64-character `GET_LOCK` limit while remaining
 * collision-resistant.
 * @param {object} args - Lock identity args.
 * @param {string} args.resourceId - Resource id.
 * @param {string} args.resourceType - Resource type.
 * @returns {string} - Advisory lock name.
 */
export function syncReplayConflictLockName({ resourceId, resourceType }) {
    const identity = stableJsonStringify({ resourceId, resourceType });
    const hash = sha256Hex(identity).slice(0, 32);
    return `vsr:${hash}`;
}
/**
 * Normalizes a version value for deterministic comparison and transport.
 * Only version values participate in stable-JSON comparison against client
 * `baseVersion` strings; resource serializer/accessor results must stay raw so
 * the frontend-model transport serializer can retain Date markers.
 * @param {ReturnType<typeof JSON.parse>} value - Raw version value from a database record.
 * @returns {ReturnType<typeof JSON.parse>} - Normalized value (Date values become ISO strings).
 */
function normalizeConflictValue(value) {
    if (value instanceof Date)
        return value.toISOString();
    return value;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3luYy1lbnZlbG9wZS1yZXBsYXktc2VydmljZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9zeW5jL3N5bmMtZW52ZWxvcGUtcmVwbGF5LXNlcnZpY2UuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sRUFBQyx5QkFBeUIsRUFBRSxhQUFhLEVBQUMsTUFBTSx5QkFBeUIsQ0FBQTtBQUNoRixPQUFPLEVBQUMsZUFBZSxFQUFDLE1BQU0sK0JBQStCLENBQUE7QUFDN0QsT0FBTyxFQUFDLGlDQUFpQyxFQUFDLE1BQU0sMkNBQTJDLENBQUE7QUFDM0YsT0FBTyxFQUFDLG1CQUFtQixFQUFDLE1BQU0sd0JBQXdCLENBQUE7QUFDMUQsT0FBTyx1QkFBdUIsTUFBTSxpQ0FBaUMsQ0FBQTtBQUNyRSxPQUFPLG1CQUFtQixNQUFNLGtCQUFrQixDQUFBO0FBQ2xELE9BQU8sU0FBUyxNQUFNLHdCQUF3QixDQUFBO0FBQzlDLE9BQU8sRUFBQyx5QkFBeUIsRUFBRSw0QkFBNEIsRUFBQyxNQUFNLGlDQUFpQyxDQUFBO0FBQ3ZHLE9BQU8sRUFBQyxlQUFlLEVBQUMsTUFBTSw2QkFBNkIsQ0FBQTtBQUMzRCxPQUFPLGNBQWMsTUFBTSx1QkFBdUIsQ0FBQTtBQUVsRDs7Ozs7O0dBTUc7QUFDSDs7Ozs7Ozs7Ozs7R0FXRztBQUNIOzs7Ozs7O0dBT0c7QUFFSDs7Ozs7Ozs7R0FRRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8seUJBQXlCO0lBQzVDOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7T0EyQkc7SUFDSCxZQUFZLElBQUksR0FBRyxFQUFFO1FBQ25CLElBQUksQ0FBQyxNQUFNLEdBQUcsSUFBSSxDQUFDLE1BQU0sSUFBSSxPQUFPLENBQUE7UUFDcEMsSUFBSSxDQUFDLFNBQVMsR0FBRyxJQUFJLENBQUMsU0FBUyxJQUFJLElBQUksQ0FBQTtRQUN2QyxJQUFJLENBQUMscUJBQXFCLEdBQUcsSUFBSSxD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SUFBSSxFQUFFLENBQUE7QUFDdEIsQ0FBQztBQUVEOzs7Ozs7O0dBT0c7QUFDSCxTQUFTLHNCQUFzQixDQUFDLEtBQUs7SUFDbkMsSUFBSSxLQUFLLFlBQVksSUFBSTtRQUFFLE9BQU8sS0FBSyxDQUFDLFdBQVcsRUFBRSxDQUFBO0lBRXJELE9BQU8sS0FBSyxDQUFBO0FBQ2QsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQge2RlbGl2ZXJEZWNsYXJlZEJyb2FkY2FzdHMsIHVwc2VydFN5bmNSb3d9IGZyb20gXCIuL3N5bmMtY2hhbmdlLWZhbm91dC5qc1wiXG5pbXBvcnQge21hcmtTZXJ2ZXJBcHBseX0gZnJvbSBcIi4vc3luYy1wdWJsaXNoLXN1cHByZXNzaW9uLmpzXCJcbmltcG9ydCB7cmVzb2x2ZUZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzfSBmcm9tIFwiLi4vZnJvbnRlbmQtbW9kZWxzL3Jlc291cmNlLWRlZmluaXRpb24uanNcIlxuaW1wb3J0IHtyZXNvbHZlU3luY0NvbmZsaWN0fSBmcm9tIFwiLi9jb25mbGljdC1zdHJhdGVneS5qc1wiXG5pbXBvcnQgU3luY1JlcGxheVVwc2VydEFwcGxpZXIgZnJvbSBcIi4vc3luYy1yZXBsYXktdXBzZXJ0LWFwcGxpZXIuanNcIlxuaW1wb3J0IHN0YWJsZUpzb25TdHJpbmdpZnkgZnJvbSBcIi4vc3RhYmxlLWpzb24uanNcIlxuaW1wb3J0IHNoYTI1NkhleCBmcm9tIFwiLi4vdXRpbHMvc2hhMjU2LWhleC5qc1wiXG5pbXBvcnQge2RlY29kZVJlcGxheVBlcnNpc3RlZERhdGEsIHNlcmlhbGl6ZVJlcGxheVBlcnNpc3RlZERhdGF9IGZyb20gXCIuL3N5bmMtcmVwbGF5LXBlcnNpc3RlZC1kYXRhLmpzXCJcbmltcG9ydCB7VmFsaWRhdGlvbkVycm9yfSBmcm9tIFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCJcbmltcG9ydCBWZWxvY2lvdXNFcnJvciBmcm9tIFwiLi4vdmVsb2Npb3VzLWVycm9yLmpzXCJcblxuLyoqXG4gKiBSZXNvbHZlZCByb3V0ZWQtcmVzb3VyY2UgcmVnaXN0cmF0aW9uIGZvciBvbmUgcmVwbGF5IHJlc291cmNlIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBTeW5jUmVwbGF5UmVzb3VyY2VSZWdpc3RyYXRpb25cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBtb2RlbE5hbWUgLSBFZmZlY3RpdmUgZnJvbnRlbmQgbW9kZWwgbmFtZS5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGV9IHJlc291cmNlQ2xhc3MgLSBSb3V0ZWQgcmVzb3VyY2UgY2xhc3MuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTm9ybWFsaXplZEZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb24gfCBudWxsfSByZXNvdXJjZUNvbmZpZ3VyYXRpb24gLSBOb3JtYWxpemVkIHJlc291cmNlIGNvbmZpZ3VyYXRpb24gd2hlbiByZWdpc3RyeS1yZXNvbHZlZC5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBTeW5jUmVwbGF5TXV0YXRpb25cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgbnVtYmVyIHwgbnVsbH0gW2Jhc2VWZXJzaW9uXSAtIEJhc2Ugc2VydmVyL2NsaWVudCB2ZXJzaW9uIG9ic2VydmVkIGJ5IHRoZSBjbGllbnQuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW2NsaWVudE11dGF0aW9uSWRdIC0gT3JpZ2luYWwgY2xpZW50IG11dGF0aW9uIGlkIGZyb20gdGhlIHNpZ25lZCBlbnZlbG9wZS5cbiAqIEBwcm9wZXJ0eSB7RGF0ZX0gY2xpZW50VXBkYXRlZEF0IC0gQ2xpZW50LXNpZGUgbXV0YXRpb24gdGltZXN0YW1wLlxuICogQHByb3BlcnR5IHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGRhdGEgLSBQYXJzZWQgbXV0YXRpb24gcGF5bG9hZC5cbiAqIEBwcm9wZXJ0eSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGlkIC0gQ2xpZW50IHN5bmMgcm93IGlkIGZvciBwZXItc3luYyByZXNwb25zZXMuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gcmVzb3VyY2VJZCAtIFJlc291cmNlIGlkIGFzIGEgc3RyaW5nLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHJlc291cmNlVHlwZSAtIFJlc291cmNlL21vZGVsIG5hbWUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gc2VyaWFsaXplZERhdGEgLSBKU09OIHNlcmlhbGl6ZWQgbXV0YXRpb24gcGF5bG9hZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBzeW5jVHlwZSAtIFN5bmMgb3BlcmF0aW9uIHR5cGUuXG4gKi9cbi8qKlxuICogT25lIGRlY2xhcmF0aXZlIGJyb2FkY2FzdCBmYW5uZWQgb3V0IGFmdGVyIGEgbXV0YXRpb24gYXBwbGllcy5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFN5bmNSZXBsYXlCcm9hZGNhc3RcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgKChhcmdzOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IHN0cmluZyl9IGNoYW5uZWwgLSBDaGFubmVsIG5hbWUgb3IgcmVzb2x2ZXIuXG4gKiBAcHJvcGVydHkgeyhhcmdzOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYnJvYWRjYXN0UGFyYW1zIC0gQ2hhbm5lbCByb3V0aW5nIHBhcmFtcy5cbiAqIEBwcm9wZXJ0eSB7KGFyZ3M6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGJvZHkgLSBCcm9hZGNhc3QgYm9keS5cbiAqIEBwcm9wZXJ0eSB7KGFyZ3M6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gYm9vbGVhbn0gW3doZW5dIC0gT3B0aW9uYWwgZ2F0ZTsgc2tpcHBlZCB3aGVuIGl0IHJldHVybnMgZmFsc2UuXG4gKi9cblxuLyoqXG4gKiBSZXBsYXlzIGNsaWVudCBzeW5jIGVudmVsb3BlcyB0aHJvdWdoIHByb2plY3Qgc3VwcGxpZWQgYXV0aGVudGljYXRpb24sXG4gKiBhdXRob3JpemF0aW9uLCBhcHBsaWNhdGlvbiwgYW5kIHBlcnNpc3RlbmNlIGhvb2tzLlxuICpcbiAqIFRoaXMgaXMgaW50ZW50aW9uYWxseSB0cmFuc3BvcnQvbW9kZWwgYWdub3N0aWM6IFZlbG9jaW91cyBvd25zIHRoZSBnZW5lcmljXG4gKiByZXBsYXkgbG9vcCwgbm9ybWFsaXphdGlvbiwgc3RhbGUtY2xpZW50IGNvbXBhcmlzb24sIGFuZCBwZXItc3luYyByZXN1bHRcbiAqIHNoYXBlIHdoaWxlIGVhY2ggYXBwIG93bnMgaXRzIHRva2VuIGxvb2t1cCwgbW9kZWwgaGFuZGxlcnMsIGFuZFxuICogZG9tYWluIGF1dGhvcml6YXRpb24gcnVsZXMuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFN5bmNFbnZlbG9wZVJlcGxheVNlcnZpY2Uge1xuICAvKipcbiAgICogQ3JlYXRlcyBhIHN5bmMgZW52ZWxvcGUgcmVwbGF5IHNlcnZpY2UuXG4gICAqXG4gICAqIFdoZW4gYSBzeW5jIG1vZGVsIGlzIGdpdmVuLCBgZmluZEV4aXN0aW5nUmVwbGF5U3luY2AgYW5kXG4gICAqIGBwZXJzaXN0UmVwbGF5TXV0YXRpb25gIGdldCBtb2RlbC1iYWNrZWQgZGVmYXVsdCBpbXBsZW1lbnRhdGlvbnMuIFRoZSBzeW5jXG4gICAqIG1vZGVsIG11c3QgZXhwb3NlIGBmaW5kQnlgL2BjcmVhdGVgIHN0YXRpY3MgcGx1cyBpbnN0YW5jZVxuICAgKiBgYXNzaWduYC9gc2F2ZWAvYGNsaWVudFVwZGF0ZWRBdGAgYW5kIGBhZHZhbmNlU2VydmVyU2VxdWVuY2VgICh0aGVcbiAgICogY2hhbmdlLWZlZWQgc2VxdWVuY2UgY29udHJhY3QpLCBhbmQgdGhlIGFjdG9yIHJldHVybmVkIGZyb21cbiAgICogYGF1dGhlbnRpY2F0ZVJlcGxheWAgbXVzdCBleHBvc2UgYW4gYGlkKClgIG1ldGhvZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIENvbnN0cnVjdG9yIGFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHt7ZGVidWc/OiAoLi4uYXJnczogQXJyYXk8dW5rbm93bj4pID0+IHZvaWQsIHdhcm4/OiAoLi4uYXJnczogQXJyYXk8dW5rbm93bj4pID0+IHZvaWR9fSBbYXJncy5sb2dnZXJdIC0gTG9nZ2VyIHVzZWQgZm9yIG5vcm1hbGl6YXRpb24gd2FybmluZ3MuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IFthcmdzLnN5bmNNb2RlbF0gLSBTeW5jL2NoYW5nZSBtb2RlbCBlbmFibGluZyBtb2RlbC1iYWNrZWQgZGVmYXVsdCBob29rcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmFjdG9yRm9yZWlnbktleUNvbHVtbl0gLSBTeW5jIG1vZGVsIGNvbHVtbiBsaW5raW5nIHJvd3MgdG8gdGhlIHJlcGxheSBhY3Rvci5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gW2FyZ3MuYXV0aGVudGljYXRpb25Ub2tlbk1vZGVsXSAtIFRva2VuIG1vZGVsIGVuYWJsaW5nIHRoZSBkZWZhdWx0IHRva2VuLWxvb2t1cCBhdXRoZW50aWNhdGVSZXBsYXkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5hdXRoZW50aWNhdGlvblRva2VuQ29sdW1uXSAtIFRva2VuIG1vZGVsIGNvbHVtbiBob2xkaW5nIHRoZSB0b2tlbi4gRGVmYXVsdHMgdG8gXCJ0b2tlblwiLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuYXV0aGVudGljYXRpb25Ub2tlblBhcmFtXSAtIFJlcXVlc3QgcGFyYW0gY2FycnlpbmcgdGhlIHRva2VuLiBEZWZhdWx0cyB0byBcImF1dGhlbnRpY2F0aW9uVG9rZW5cIi5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCAoKGFyZ3M6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gUHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pIHwgQ29uc3RydWN0b3JQYXJhbWV0ZXJzPHR5cGVvZiBTeW5jUmVwbGF5VXBzZXJ0QXBwbGllcj5bMF0+fSBbYXJncy5hcHBseUhhbmRsZXJzXSAtIFBlci1yZXNvdXJjZVR5cGUgYXBwbHkgaGFuZGxlcnMgKGZ1bmN0aW9ucyBvciBkZWNsYXJhdGl2ZSB1cHNlcnQtYXBwbGllciBzcGVjcykgZW5hYmxpbmcgdGhlIGRlZmF1bHQgYXBwbHlSZXBsYXlNdXRhdGlvbiBkaXNwYXRjaC4gRGVwcmVjYXRlZDogcHJlZmVyIHJlc291cmNlIHJvdXRpbmcgdmlhIGBjb25maWd1cmF0aW9uYC9gcmVzb3VyY2VUeXBlT3ZlcnJpZGVzYDsgYXBwbHlIYW5kbGVycyByZW1haW4gZm9yIHJlbGVhc2VkIGFkb3B0ZXJzIGFuZCB3aWxsIGJlIHJlbW92ZWQgYWZ0ZXIgdGhlaXIgbWlncmF0aW9uLlxuICAgKiBAcGFyYW0geyhhcmdzOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gW2FyZ3MucGVyc2lzdEV4dHJhQXR0cmlidXRlc10gLSBFeHRyYSBhdHRyaWJ1dGVzIG1lcmdlZCBpbnRvIHRoZSBtb2RlbC1iYWNrZWQgcGVyc2lzdGVkIHJvdyAoZS5nLiBhbiBldmVudCBzY29wZSBjb2x1bW4pLlxuICAgKiBAcGFyYW0geyhhcmdzOiB7bXV0YXRpb246IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBhcHBseVJlc3VsdDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59KSA9PiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gW2FyZ3MucGVyc2lzdFNlcmlhbGl6ZWREYXRhXSAtIE92ZXJyaWRlcyB0aGUgcGVyc2lzdGVkIGRhdGEgcGF5bG9hZCAob2JqZWN0IHJlc3VsdHMgYXJlIEpTT04gc3RyaW5naWZpZWQpLlxuICAgKiBAcGFyYW0geyhicm9hZGNhc3Q6IHtjaGFubmVsOiBzdHJpbmcsIHBhcmFtczogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBib2R5OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0pID0+IFByb21pc2U8dm9pZD59IFthcmdzLmJyb2FkY2FzdGVyXSAtIERlbGl2ZXJzIGRlY2xhcmF0aXZlIGJyb2FkY2FzdHMuIFJlcXVpcmVkIHdoZW4gYnJvYWRjYXN0cyBhcmUgY29uZmlndXJlZC5cbiAgICogQHBhcmFtIHtTeW5jUmVwbGF5QnJvYWRjYXN0W119IFthcmdzLmJyb2FkY2FzdHNdIC0gQnJvYWRjYXN0cyBmYW5uZWQgb3V0IGJ5IHRoZSBkZWZhdWx0IGFmdGVyUmVwbGF5TXV0YXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBbYXJncy5jb25maWd1cmF0aW9uXSAtIENvbmZpZ3VyYXRpb24gd2hvc2UgZnJvbnRlbmQtbW9kZWwgcmVnaXN0cnkgcm91dGVzIG11dGF0aW9ucyB0byByZXNvdXJjZSBjbGFzc2VzLlxuICAgKiBAcGFyYW0ge3tzdHJhdGVneT86IFwib3B0aW1pc3RpY1ZlcnNpb25cIiB8IFwic2VydmVyV2luc1wiLCB2ZXJzaW9uQXR0cmlidXRlOiBzdHJpbmd9IHwgbnVsbH0gW2FyZ3MuY29uZmxpY3RTdHJhdGVneV0gLSBPcHRpb25hbCBiYXNlLXZlcnNpb24gY29uZmxpY3QgZGV0ZWN0aW9uIGZvciByb3V0ZWQgdXBzZXJ0cy4gT25seSBgb3B0aW1pc3RpY1ZlcnNpb25gIGFuZCBgc2VydmVyV2luc2AgYXJlIHN1cHBvcnRlZCBmb3IgYmFja2VuZCByZXBsYXkgYmVjYXVzZSB0aGUgc2VydmVyIGRvZXMgbm90IGhhdmUgdGhlIGNsaWVudCdzIGJhc2Ugc25hcHNob3QuIFdoZW4gYHN0cmF0ZWd5YCBpcyBvbWl0dGVkIGl0IGRlZmF1bHRzIHRvIGBvcHRpbWlzdGljVmVyc2lvbmAsIG1hdGNoaW5nIGByZXNvbHZlU3luY0NvbmZsaWN0YCBhbmQgbm9ybWFsaXplZCByZXNvdXJjZSBjb25maWcuIFdoZW4gY29uZmlndXJlZCwgYSBtdXRhdGlvbiB3aG9zZSBiYXNlVmVyc2lvbiBkb2VzIG5vdCBtYXRjaCB0aGUgY3VycmVudCBzZXJ2ZXIgdmVyc2lvbkF0dHJpYnV0ZSBpcyByZWplY3RlZCB3aXRoIGEgc3RydWN0dXJlZCBjb25mbGljdCByZXN1bHQgaW5zdGVhZCBvZiBiZWluZyBhcHBsaWVkLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NUeXBlIHwgc3RyaW5nPn0gW2FyZ3MucmVzb3VyY2VUeXBlT3ZlcnJpZGVzXSAtIFBlci1yZXNvdXJjZVR5cGUgcm91dGluZyBvdmVycmlkZXM6IGEgcmVzb3VyY2UgY2xhc3MsIG9yIGEgc3RyaW5nIGFsaWFzIHJlc29sdmVkIHRocm91Z2ggdGhlIHJlZ2lzdHJ5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0fSBbYXJncy5hYmlsaXR5XSAtIEFiaWxpdHkgc2NvcGluZyByb3V0ZWQgcmVjb3JkIGxvb2t1cHMgYW5kIGNyZWF0ZSBtZW1iZXJzaGlwIGNoZWNrcy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IFthcmdzLmFiaWxpdHlDb250ZXh0XSAtIEFiaWxpdHkgY29udGV4dCBwYXNzZWQgdG8gcm91dGVkIHJlc291cmNlcy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IFthcmdzLmxvY2Fsc10gLSBMb2NhbHMgcGFzc2VkIHRvIHJvdXRlZCByZXNvdXJjZXMuXG4gICAqL1xuICBjb25zdHJ1Y3RvcihhcmdzID0ge30pIHtcbiAgICB0aGlzLmxvZ2dlciA9IGFyZ3MubG9nZ2VyIHx8IGNvbnNvbGVcbiAgICB0aGlzLnN5bmNNb2RlbCA9IGFyZ3Muc3luY01vZGVsIHx8IG51bGxcbiAgICB0aGlzLmFjdG9yRm9yZWlnbktleUNvbHVtbiA9IGFyZ3MuYWN0b3JGb3JlaWduS2V5Q29sdW1uIHx8IFwiYXV0aGVudGljYXRpb25fdG9rZW5faWRcIlxuICAgIHRoaXMuYXV0aGVudGljYXRpb25Ub2tlbk1vZGVsID0gYXJncy5hdXRoZW50aWNhdGlvblRva2VuTW9kZWwgfHwgbnVsbFxuICAgIHRoaXMuYXV0aGVudGljYXRpb25Ub2tlbkNvbHVtbiA9IGFyZ3MuYXV0aGVudGljYXRpb25Ub2tlbkNvbHVtbiB8fCBcInRva2VuXCJcbiAgICB0aGlzLmF1dGhlbnRpY2F0aW9uVG9rZW5QYXJhbSA9IGFyZ3MuYXV0aGVudGljYXRpb25Ub2tlblBhcmFtIHx8IFwiYXV0aGVudGljYXRpb25Ub2tlblwiXG4gICAgdGhpcy5wZXJzaXN0RXh0cmFBdHRyaWJ1dGVzID0gYXJncy5wZXJzaXN0RXh0cmFBdHRyaWJ1dGVzIHx8IG51bGxcbiAgICB0aGlzLnBlcnNpc3RTZXJpYWxpemVkRGF0YSA9IGFyZ3MucGVyc2lzdFNlcmlhbGl6ZWREYXRhIHx8IG51bGxcbiAgICB0aGlzLmJyb2FkY2FzdGVyID0gYXJncy5icm9hZGNhc3RlciB8fCBudWxsXG4gICAgdGhpcy5icm9hZGNhc3RzID0gYXJncy5icm9hZGNhc3RzIHx8IG51bGxcbiAgICB0aGlzLmFwcGx5SGFuZGxlcnMgPSBhcmdzLmFwcGx5SGFuZGxlcnMgPyB0aGlzLmJ1aWx0QXBwbHlIYW5kbGVycyhhcmdzLmFwcGx5SGFuZGxlcnMpIDogbnVsbFxuICAgIHRoaXMuY29uZmlndXJhdGlvbiA9IGFyZ3MuY29uZmlndXJhdGlvbiB8fCBudWxsXG4gICAgdGhpcy5jb25mbGljdFN0cmF0ZWd5ID0gYXJncy5jb25mbGljdFN0cmF0ZWd5IHx8IG51bGxcbiAgICB0aGlzLnJlc291cmNlVHlwZU92ZXJyaWRlcyA9IGFyZ3MucmVzb3VyY2VUeXBlT3ZlcnJpZGVzIHx8IG51bGxcbiAgICB0aGlzLmFiaWxpdHkgPSBhcmdzLmFiaWxpdHkgfHwgbnVsbFxuICAgIHRoaXMuYWJpbGl0eUNvbnRleHQgPSBhcmdzLmFiaWxpdHlDb250ZXh0IHx8IG51bGxcbiAgICB0aGlzLmxvY2FscyA9IGFyZ3MubG9jYWxzIHx8IG51bGxcbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIFN5bmNSZXBsYXlSZXNvdXJjZVJlZ2lzdHJhdGlvbiB8IG51bGw+fSAqL1xuICAgIHRoaXMuX3JlcGxheVJlc291cmNlUmVnaXN0cmF0aW9ucyA9IG5ldyBNYXAoKVxuXG4gICAgaWYgKGFyZ3MuYWN0b3JGb3JlaWduS2V5Q29sdW1uICE9PSB1bmRlZmluZWQgJiYgKHR5cGVvZiBhcmdzLmFjdG9yRm9yZWlnbktleUNvbHVtbiAhPT0gXCJzdHJpbmdcIiB8fCBhcmdzLmFjdG9yRm9yZWlnbktleUNvbHVtbi5sZW5ndGggPCAxKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBhY3RvckZvcmVpZ25LZXlDb2x1bW4gbXVzdCBiZSBhIG5vbi1ibGFuayBzdHJpbmcsIGdvdDogJHtTdHJpbmcoYXJncy5hY3RvckZvcmVpZ25LZXlDb2x1bW4pfWApXG4gICAgfVxuICAgIGlmICh0aGlzLmJyb2FkY2FzdHMgJiYgIXRoaXMuYnJvYWRjYXN0ZXIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlN5bmNFbnZlbG9wZVJlcGxheVNlcnZpY2UgYnJvYWRjYXN0cyByZXF1aXJlIGEgYnJvYWRjYXN0ZXIgb3B0aW9uIGRlbGl2ZXJpbmcgdGhlbVwiKVxuICAgIH1cbiAgICBpZiAodGhpcy5jb25mbGljdFN0cmF0ZWd5KSB7XG4gICAgICBjb25zdCBzdXBwb3J0ZWRDb25mbGljdFN0cmF0ZWdpZXMgPSBuZXcgU2V0KFtcIm9wdGltaXN0aWNWZXJzaW9uXCIsIFwic2VydmVyV2luc1wiXSlcblxuICAgICAgaWYgKCF0aGlzLmNvbmZsaWN0U3RyYXRlZ3kudmVyc2lvbkF0dHJpYnV0ZSB8fCB0eXBlb2YgdGhpcy5jb25mbGljdFN0cmF0ZWd5LnZlcnNpb25BdHRyaWJ1dGUgIT09IFwic3RyaW5nXCIpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiU3luY0VudmVsb3BlUmVwbGF5U2VydmljZSBjb25mbGljdFN0cmF0ZWd5IHJlcXVpcmVzIGEgbm9uLWJsYW5rIHZlcnNpb25BdHRyaWJ1dGVcIilcbiAgICAgIH1cbiAgICAgIGlmICh0aGlzLmNvbmZsaWN0U3RyYXRlZ3kuc3RyYXRlZ3kgIT09IHVuZGVmaW5lZCAmJiAhc3VwcG9ydGVkQ29uZmxpY3RTdHJhdGVnaWVzLmhhcyh0aGlzLmNvbmZsaWN0U3RyYXRlZ3kuc3RyYXRlZ3kpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgc3luYyBjb25mbGljdCBzdHJhdGVneSBmb3IgYmFja2VuZCByZXBsYXk6ICR7dGhpcy5jb25mbGljdFN0cmF0ZWd5LnN0cmF0ZWd5fS4gT25seSBvcHRpbWlzdGljVmVyc2lvbiBhbmQgc2VydmVyV2lucyBhcmUgc3VwcG9ydGVkLmApXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFdyYXBzIGRlY2xhcmF0aXZlIGFwcGx5LWhhbmRsZXIgc3BlY3MgaW4gdXBzZXJ0IGFwcGxpZXJzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXBwbHlIYW5kbGVycyAtIFJhdyBhcHBseSBoYW5kbGVycy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIChhcmdzOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IFByb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gQ2FsbGFibGUgaGFuZGxlcnMgYnkgcmVzb3VyY2UgdHlwZS5cbiAgICovXG4gIGJ1aWx0QXBwbHlIYW5kbGVycyhhcHBseUhhbmRsZXJzKSB7XG4gICAgcmV0dXJuIE9iamVjdC5mcm9tRW50cmllcyhPYmplY3QuZW50cmllcyhhcHBseUhhbmRsZXJzKS5tYXAoKFtyZXNvdXJjZVR5cGUsIGhhbmRsZXJdKSA9PiB7XG4gICAgICBpZiAodHlwZW9mIGhhbmRsZXIgPT09IFwiZnVuY3Rpb25cIikgcmV0dXJuIFtyZXNvdXJjZVR5cGUsIGhhbmRsZXJdXG5cbiAgICAgIGNvbnN0IGFwcGxpZXIgPSBuZXcgU3luY1JlcGxheVVwc2VydEFwcGxpZXIoaGFuZGxlcilcblxuICAgICAgcmV0dXJuIFtyZXNvdXJjZVR5cGUsICgvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gYXBwbHlBcmdzKSA9PiBhcHBsaWVyLmFwcGx5KC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChhcHBseUFyZ3MpKV1cbiAgICB9KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXBsYXlzIGEgc3luYyBiYXRjaC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHBhcmFtcyAtIFJlcXVlc3QgcGFyYW1zIGNhcnJ5aW5nIGF1dGhlbnRpY2F0aW9uIGFuZCBzeW5jcy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IFtyZXF1ZXN0U3RhdGVdIC0gUmVxdWVzdC1sb2NhbCBzdGF0ZSBwYXNzZWQgdG8gYXV0aGVudGljYXRpb24vc3luYyBleHRyYWN0aW9uIGhvb2tzOyBzdWJjbGFzc2VzIG1heSB1c2UgdGhpcyB0byBzaGFyZSBwcmUtY29tcHV0ZWQgcGVyLXJlcXVlc3QgZGF0YSB3aXRob3V0IGluc3RhbmNlIG11dGF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7c3luY3M6IEFycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj4sIHN0YXR1cz86IHN0cmluZywgZXJyb3JDb2RlPzogc3RyaW5nLCBlcnJvck1lc3NhZ2U/OiBzdHJpbmd9Pn0gUmVwbGF5IHJlc3BvbnNlLlxuICAgKi9cbiAgYXN5bmMgcmVwbGF5KHBhcmFtcywgcmVxdWVzdFN0YXRlID0ge30pIHtcbiAgICBjb25zdCBhY3RvclJlc3VsdCA9IGF3YWl0IHRoaXMuYXV0aGVudGljYXRlUmVwbGF5KHBhcmFtcywgcmVxdWVzdFN0YXRlKVxuXG4gICAgaWYgKCFhY3RvclJlc3VsdC5hdXRoZW50aWNhdGVkKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBzeW5jczogW10sXG4gICAgICAgIHN0YXR1czogXCJlcnJvclwiLFxuICAgICAgICBlcnJvckNvZGU6IGFjdG9yUmVzdWx0LmVycm9yQ29kZSxcbiAgICAgICAgZXJyb3JNZXNzYWdlOiBhY3RvclJlc3VsdC5lcnJvck1lc3NhZ2VcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBzeW5jUmVzcG9uc2VzID0gW11cbiAgICBjb25zdCBjb250ZXh0ID0gYXdhaXQgdGhpcy5idWlsZFJlcGxheUNvbnRleHQoe2FjdG9yOiBhY3RvclJlc3VsdC5hY3RvciwgcGFyYW1zLCByZXF1ZXN0U3RhdGV9KVxuXG4gICAgZm9yIChjb25zdCByYXdTeW5jIG9mIHRoaXMucmVwbGF5U3luY3MocGFyYW1zLCByZXF1ZXN0U3RhdGUpKSB7XG4gICAgICBjb25zdCBub3JtYWxpemVkUmVzdWx0ID0gdGhpcy5ub3JtYWxpemVSZXBsYXlTeW5jKHJhd1N5bmMpXG5cbiAgICAgIGlmICghbm9ybWFsaXplZFJlc3VsdC5vaykge1xuICAgICAgICBzeW5jUmVzcG9uc2VzLnB1c2gobm9ybWFsaXplZFJlc3VsdC5yZXNwb25zZSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgY29uc3QgbXV0YXRpb24gPSBub3JtYWxpemVkUmVzdWx0Lm11dGF0aW9uXG4gICAgICBjb25zdCBhY2Nlc3NSZXN1bHQgPSBhd2FpdCB0aGlzLmF1dGhvcml6ZVJlcGxheU11dGF0aW9uKHthY3RvcjogYWN0b3JSZXN1bHQuYWN0b3IsIGNvbnRleHQsIG11dGF0aW9ufSlcblxuICAgICAgaWYgKCFhY2Nlc3NSZXN1bHQuYWxsb3dlZCkge1xuICAgICAgICBzeW5jUmVzcG9uc2VzLnB1c2goe1xuICAgICAgICAgIGlkOiBtdXRhdGlvbi5pZCxcbiAgICAgICAgICBzeW5jU3RhdGU6IFwiZmFpbGVkXCIsXG4gICAgICAgICAgcmVhc29uOiBhY2Nlc3NSZXN1bHQucmVhc29uIHx8IFwiYWNjZXNzLWRlbmllZFwiXG4gICAgICAgIH0pXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGV4aXN0aW5nU3luYyA9IGF3YWl0IHRoaXMuZmluZEV4aXN0aW5nUmVwbGF5U3luYyh7YWN0b3I6IGFjdG9yUmVzdWx0LmFjdG9yLCBjb250ZXh0LCBtdXRhdGlvbn0pXG4gICAgICBjb25zdCBzaG91bGRBcHBseSA9IGF3YWl0IHRoaXMuc2hvdWxkQXBwbHlSZXBsYXlNdXRhdGlvbih7YWN0b3I6IGFjdG9yUmVzdWx0LmFjdG9yLCBjb250ZXh0LCBleGlzdGluZ1N5bmMsIG11dGF0aW9ufSlcbiAgICAgIGNvbnN0IGR1cGxpY2F0ZSA9ICFzaG91bGRBcHBseSAmJiB0aGlzLmlzRHVwbGljYXRlUmVwbGF5TXV0YXRpb24oe2V4aXN0aW5nU3luYywgbXV0YXRpb259KVxuXG4gICAgICAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqL1xuICAgICAgbGV0IGFwcGx5UmVzdWx0XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGFwcGx5UmVzdWx0ID0gc2hvdWxkQXBwbHlcbiAgICAgICAgICA/IGF3YWl0IHRoaXMuYXBwbHlSZXBsYXlNdXRhdGlvbih7YWN0b3I6IGFjdG9yUmVzdWx0LmFjdG9yLCBjb250ZXh0LCBleGlzdGluZ1N5bmMsIG11dGF0aW9ufSlcbiAgICAgICAgICA6IGF3YWl0IHRoaXMuc2tpcHBlZFJlcGxheU11dGF0aW9uKHthY3RvcjogYWN0b3JSZXN1bHQuYWN0b3IsIGNvbnRleHQsIGV4aXN0aW5nU3luYywgbXV0YXRpb259KVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgLy8gQ2xpZW50LXNhZmUgYXBwbHkgZmFpbHVyZXMgKHNjaGVtYSB2YWxpZGF0aW9uLCBtb2RlbCB2YWxpZGF0aW9uLFxuICAgICAgICAvLyBhdXRob3JpemF0aW9uIGRlbmlhbHMsIHVua25vd24gcmVzb3VyY2UgdHlwZXMpIGZhaWwgdGhpcyBzeW5jIGFuZFxuICAgICAgICAvLyBrZWVwIHRoZSBiYXRjaCBnb2luZzsgdW5leHBlY3RlZCBlcnJvcnMga2VlcCBwcm9wYWdhdGluZy5cbiAgICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgVmVsb2Npb3VzRXJyb3IgJiYgZXJyb3Iuc2FmZVRvRXhwb3NlKSB7XG4gICAgICAgICAgc3luY1Jlc3BvbnNlcy5wdXNoKHtcbiAgICAgICAgICAgIGlkOiBtdXRhdGlvbi5pZCxcbiAgICAgICAgICAgIHN5bmNTdGF0ZTogXCJmYWlsZWRcIixcbiAgICAgICAgICAgIHJlYXNvbjogZXJyb3IuY29kZSB8fCBcImFwcGx5LWZhaWxlZFwiLFxuICAgICAgICAgICAgbWVzc2FnZTogZXJyb3IubWVzc2FnZVxuICAgICAgICAgIH0pXG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfVxuXG4gICAgICAgIHRocm93IGVycm9yXG4gICAgICB9XG5cbiAgICAgIGlmIChhcHBseVJlc3VsdCAmJiBhcHBseVJlc3VsdC5zdGF0dXMgPT09IFwiY29uZmxpY3RcIikge1xuICAgICAgICBzeW5jUmVzcG9uc2VzLnB1c2goe1xuICAgICAgICAgIGNvbmZsaWN0OiBhcHBseVJlc3VsdC5jb25mbGljdCxcbiAgICAgICAgICBpZDogbXV0YXRpb24uaWQsXG4gICAgICAgICAgc3luY1N0YXRlOiBcImNvbmZsaWN0XCJcbiAgICAgICAgfSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgYXdhaXQgdGhpcy5wZXJzaXN0UmVwbGF5TXV0YXRpb24oe2FjdG9yOiBhY3RvclJlc3VsdC5hY3RvciwgY29udGV4dCwgZXhpc3RpbmdTeW5jLCBhcHBseVJlc3VsdCwgbXV0YXRpb24sIHNob3VsZEFwcGx5fSlcbiAgICAgIGF3YWl0IHRoaXMuYWZ0ZXJSZXBsYXlNdXRhdGlvbih7YWN0b3I6IGFjdG9yUmVzdWx0LmFjdG9yLCBjb250ZXh0LCBleGlzdGluZ1N5bmMsIGFwcGx5UmVzdWx0LCBtdXRhdGlvbiwgc2hvdWxkQXBwbHl9KVxuXG4gICAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICAgIGNvbnN0IHN1Y2Nlc3NmdWxSZXNwb25zZSA9IHtpZDogbXV0YXRpb24uaWQsIHN5bmNTdGF0ZTogZHVwbGljYXRlID8gXCJkdXBsaWNhdGVcIiA6IFwic3VjY2Vzc2Z1bFwifVxuXG4gICAgICBjb25zdCBwZXJzaXN0ZWRSZXBsYXlNZXRhZGF0YSA9IGR1cGxpY2F0ZSA/IHRoaXMucmVwbGF5UGVyc2lzdGVkTWV0YWRhdGEoZXhpc3RpbmdTeW5jKSA6IG51bGxcblxuICAgICAgaWYgKHBlcnNpc3RlZFJlcGxheU1ldGFkYXRhKSB7XG4gICAgICAgIHN1Y2Nlc3NmdWxSZXNwb25zZS5zZXJ2ZXJWZXJzaW9uID0gcGVyc2lzdGVkUmVwbGF5TWV0YWRhdGEuYWNrbm93bGVkZ2VtZW50VmVyc2lvblxuICAgICAgfSBlbHNlIGlmICh0aGlzLmNvbmZsaWN0U3RyYXRlZ3kgJiYgbXV0YXRpb24uYmFzZVZlcnNpb24gIT09IHVuZGVmaW5lZCAmJiBhcHBseVJlc3VsdD8ucmVjb3JkKSB7XG4gICAgICAgIHN1Y2Nlc3NmdWxSZXNwb25zZS5zZXJ2ZXJWZXJzaW9uID0gbm9ybWFsaXplQ29uZmxpY3RWYWx1ZShhcHBseVJlc3VsdC5yZWNvcmQucmVhZEF0dHJpYnV0ZSh0aGlzLmNvbmZsaWN0U3RyYXRlZ3kudmVyc2lvbkF0dHJpYnV0ZSkpXG4gICAgICB9XG5cbiAgICAgIHN5bmNSZXNwb25zZXMucHVzaChzdWNjZXNzZnVsUmVzcG9uc2UpXG4gICAgfVxuXG4gICAgcmV0dXJuIHtzeW5jczogc3luY1Jlc3BvbnNlc31cbiAgfVxuXG4gIC8qKlxuICAgKiBBdXRoZW50aWNhdGVzIHRoZSBzeW5jIGJhdGNoIGFjdG9yLlxuICAgKlxuICAgKiBEZWZhdWx0cyB0byBhIHRva2VuLW1vZGVsIGxvb2t1cCB3aGVuIGBhdXRoZW50aWNhdGlvblRva2VuTW9kZWxgIGlzXG4gICAqIGNvbmZpZ3VyZWQ7IG90aGVyd2lzZSBhcHBzIG92ZXJyaWRlIHRoaXMgaG9vay5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHBhcmFtcyAtIFJlcXVlc3QgcGFyYW1zLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gW19yZXF1ZXN0U3RhdGVdIC0gUmVxdWVzdC1sb2NhbCBzdGF0ZSBwb3B1bGF0ZWQgYnkgc3ViY2xhc3NlcyBiZWZvcmUgdGhlIGJhc2UgcmVwbGF5IGxvb3AgcnVucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8e2F1dGhlbnRpY2F0ZWQ6IHRydWUsIGFjdG9yOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gfCB7YXV0aGVudGljYXRlZDogZmFsc2UsIGVycm9yQ29kZTogc3RyaW5nLCBlcnJvck1lc3NhZ2U6IHN0cmluZ30+fSBBdXRoIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGF1dGhlbnRpY2F0ZVJlcGxheShwYXJhbXMsIF9yZXF1ZXN0U3RhdGUpIHtcbiAgICBpZiAoIXRoaXMuYXV0aGVudGljYXRpb25Ub2tlbk1vZGVsKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jRW52ZWxvcGVSZXBsYXlTZXJ2aWNlLmF1dGhlbnRpY2F0ZVJlcGxheSBtdXN0IGJlIGltcGxlbWVudGVkIChvciBjb25maWd1cmUgYXV0aGVudGljYXRpb25Ub2tlbk1vZGVsKVwiKVxuICAgIH1cblxuICAgIGNvbnN0IHRva2VuID0gcGFyYW1zW3RoaXMuYXV0aGVudGljYXRpb25Ub2tlblBhcmFtXVxuXG4gICAgaWYgKCF0b2tlbikge1xuICAgICAgcmV0dXJuIHthdXRoZW50aWNhdGVkOiBmYWxzZSwgZXJyb3JDb2RlOiBcIm1pc3NpbmctYXV0aGVudGljYXRpb24tdG9rZW5cIiwgZXJyb3JNZXNzYWdlOiBcIk1pc3NpbmcgYXV0aGVudGljYXRpb24gdG9rZW5cIn1cbiAgICB9XG5cbiAgICBjb25zdCBhY3RvciA9IGF3YWl0IHRoaXMuYXV0aGVudGljYXRpb25Ub2tlbk1vZGVsLmZpbmRCeSh7W3RoaXMuYXV0aGVudGljYXRpb25Ub2tlbkNvbHVtbl06IHRva2VufSlcblxuICAgIGlmICghYWN0b3IpIHtcbiAgICAgIHJldHVybiB7YXV0aGVudGljYXRlZDogZmFsc2UsIGVycm9yQ29kZTogXCJpbnZhbGlkLWF1dGhlbnRpY2F0aW9uLXRva2VuXCIsIGVycm9yTWVzc2FnZTogXCJJbnZhbGlkIGF1dGhlbnRpY2F0aW9uIHRva2VuXCJ9XG4gICAgfVxuXG4gICAgcmV0dXJuIHthY3RvciwgYXV0aGVudGljYXRlZDogdHJ1ZX1cbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgcGVyLWJhdGNoIG11dGFibGUgY29udGV4dCBmb3IgY2FjaGVzIHNoYXJlZCBhY3Jvc3Mgc3luYyBpdGVtcy5cbiAgICogQHBhcmFtIHt7YWN0b3I6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBwYXJhbXM6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgcmVxdWVzdFN0YXRlOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59fSBfYXJncyAtIEFjdG9yLCByZXF1ZXN0IHBhcmFtcywgYW5kIHJlcXVlc3QtbG9jYWwgc3RhdGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IFJlcGxheSBjb250ZXh0LlxuICAgKi9cbiAgYXN5bmMgYnVpbGRSZXBsYXlDb250ZXh0KF9hcmdzKSB7XG4gICAgcmV0dXJuIHt9XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyByYXcgc3luYyBlbnRyaWVzIGZyb20gcmVxdWVzdCBwYXJhbXMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBwYXJhbXMgLSBSZXF1ZXN0IHBhcmFtcy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IFtfcmVxdWVzdFN0YXRlXSAtIFJlcXVlc3QtbG9jYWwgc3RhdGUgcG9wdWxhdGVkIGJ5IHN1YmNsYXNzZXMgYmVmb3JlIHRoZSBiYXNlIHJlcGxheSBsb29wIHJ1bnMuXG4gICAqIEByZXR1cm5zIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IFJhdyBzeW5jIGVudHJpZXMuXG4gICAqL1xuICByZXBsYXlTeW5jcyhwYXJhbXMsIF9yZXF1ZXN0U3RhdGUpIHtcbiAgICByZXR1cm4gQXJyYXkuaXNBcnJheShwYXJhbXMuc3luY3MpID8gcGFyYW1zLnN5bmNzIDogW11cbiAgfVxuXG4gIC8qKlxuICAgKiBOb3JtYWxpemVzIG9uZSBzeW5jIGVudHJ5LlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSByYXdTeW5jIC0gUmF3IHN5bmMgZW50cnkuXG4gICAqIEByZXR1cm5zIHt7b2s6IHRydWUsIG11dGF0aW9uOiBpbXBvcnQoXCIuL3N5bmMtZW52ZWxvcGUtcmVwbGF5LXNlcnZpY2UuanNcIikuU3luY1JlcGxheU11dGF0aW9ufSB8IHtvazogZmFsc2UsIHJlc3BvbnNlOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59fSBOb3JtYWxpemVkIG11dGF0aW9uIG9yIGZhaWxlZCByZXNwb25zZS5cbiAgICovXG4gIG5vcm1hbGl6ZVJlcGxheVN5bmMocmF3U3luYykge1xuICAgIGlmICghcmF3U3luYyB8fCB0eXBlb2YgcmF3U3luYyAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHJhd1N5bmMpKSB7XG4gICAgICByZXR1cm4ge29rOiBmYWxzZSwgcmVzcG9uc2U6IHtpZDogdW5kZWZpbmVkLCBzeW5jU3RhdGU6IFwiZmFpbGVkXCIsIHJlYXNvbjogXCJpbnZhbGlkLXN5bmNcIn19XG4gICAgfVxuXG4gICAgY29uc3Qgc3luYyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAocmF3U3luYylcbiAgICBjb25zdCB7Y2xpZW50TXV0YXRpb25JZCwgY2xpZW50VXBkYXRlZEF0LCBkYXRhLCBpZCwgcmVzb3VyY2VJZCwgcmVzb3VyY2VUeXBlLCBzeW5jVHlwZX0gPSBzeW5jXG5cbiAgICBpZiAodHlwZW9mIHJlc291cmNlVHlwZSAhPT0gXCJzdHJpbmdcIiB8fCByZXNvdXJjZVR5cGUubGVuZ3RoIDwgMSB8fCByZXNvdXJjZUlkID09PSB1bmRlZmluZWQgfHwgcmVzb3VyY2VJZCA9PT0gbnVsbCB8fCB0eXBlb2Ygc3luY1R5cGUgIT09IFwic3RyaW5nXCIgfHwgc3luY1R5cGUubGVuZ3RoIDwgMSkge1xuICAgICAgcmV0dXJuIHtvazogZmFsc2UsIHJlc3BvbnNlOiB7aWQsIHN5bmNTdGF0ZTogXCJmYWlsZWRcIiwgcmVhc29uOiBcImludmFsaWQtcmVzb3VyY2UtaWRcIn19XG4gICAgfVxuXG4gICAgY29uc3QgcmVzb3VyY2VJZFN0cmluZyA9IFN0cmluZyhyZXNvdXJjZUlkKVxuICAgIGxldCBjbGllbnRVcGRhdGVkQXREYXRlID0gdHlwZW9mIGNsaWVudFVwZGF0ZWRBdCA9PT0gXCJzdHJpbmdcIiB8fCBjbGllbnRVcGRhdGVkQXQgaW5zdGFuY2VvZiBEYXRlID8gbmV3IERhdGUoY2xpZW50VXBkYXRlZEF0KSA6IG5ldyBEYXRlKClcblxuICAgIGlmIChOdW1iZXIuaXNOYU4oY2xpZW50VXBkYXRlZEF0RGF0ZS5nZXRUaW1lKCkpKSBjbGllbnRVcGRhdGVkQXREYXRlID0gbmV3IERhdGUoKVxuXG4gICAgY29uc3Qgbm9ybWFsaXplZERhdGFSZXN1bHQgPSB0aGlzLm5vcm1hbGl6ZVJlcGxheVN5bmNEYXRhKHtkYXRhLCBpZCwgcmVzb3VyY2VJZDogcmVzb3VyY2VJZFN0cmluZywgcmVzb3VyY2VUeXBlfSlcblxuICAgIGlmICghbm9ybWFsaXplZERhdGFSZXN1bHQub2spIHJldHVybiBub3JtYWxpemVkRGF0YVJlc3VsdFxuXG4gICAgcmV0dXJuIHtcbiAgICAgIG9rOiB0cnVlLFxuICAgICAgbXV0YXRpb246IHtcbiAgICAgICAgYmFzZVZlcnNpb246IHN5bmMuYmFzZVZlcnNpb24sXG4gICAgICAgIGNsaWVudE11dGF0aW9uSWQsXG4gICAgICAgIGNsaWVudFVwZGF0ZWRBdDogY2xpZW50VXBkYXRlZEF0RGF0ZSxcbiAgICAgICAgZGF0YTogbm9ybWFsaXplZERhdGFSZXN1bHQuZGF0YSxcbiAgICAgICAgaWQsXG4gICAgICAgIHJlc291cmNlSWQ6IHJlc291cmNlSWRTdHJpbmcsXG4gICAgICAgIHJlc291cmNlVHlwZSxcbiAgICAgICAgc2VyaWFsaXplZERhdGE6IEpTT04uc3RyaW5naWZ5KG5vcm1hbGl6ZWREYXRhUmVzdWx0LmRhdGEpLFxuICAgICAgICBzeW5jVHlwZVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBOb3JtYWxpemVzIG9uZSBzeW5jIGRhdGEgcGF5bG9hZC5cbiAgICogQHBhcmFtIHt7ZGF0YTogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGlkOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgcmVzb3VyY2VJZDogc3RyaW5nLCByZXNvdXJjZVR5cGU6IHN0cmluZ319IGFyZ3MgLSBTeW5jIHBheWxvYWQgbm9ybWFsaXphdGlvbiBhcmd1bWVudHMuXG4gICAqIEByZXR1cm5zIHt7b2s6IHRydWUsIGRhdGE6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gfCB7b2s6IGZhbHNlLCByZXNwb25zZTogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fX0gTm9ybWFsaXplZCBwYXlsb2FkIG9yIGZhaWxlZCByZXNwb25zZS5cbiAgICovXG4gIG5vcm1hbGl6ZVJlcGxheVN5bmNEYXRhKHtkYXRhLCBpZCwgcmVzb3VyY2VJZCwgcmVzb3VyY2VUeXBlfSkge1xuICAgIGlmIChkYXRhID09PSB1bmRlZmluZWQgfHwgZGF0YSA9PT0gbnVsbCkgcmV0dXJuIHtvazogdHJ1ZSwgZGF0YToge319XG5cbiAgICBpZiAodHlwZW9mIGRhdGEgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHBhcnNlZERhdGEgPSBKU09OLnBhcnNlKGRhdGEpXG5cbiAgICAgICAgaWYgKCFwYXJzZWREYXRhIHx8IHR5cGVvZiBwYXJzZWREYXRhICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkocGFyc2VkRGF0YSkpIHJldHVybiB7b2s6IHRydWUsIGRhdGE6IHt9fVxuXG4gICAgICAgIHJldHVybiB7b2s6IHRydWUsIGRhdGE6IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAocGFyc2VkRGF0YSl9XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICB0aGlzLmxvZ2dlci53YXJuPy4oXCJJbnZhbGlkIHN5bmMgZGF0YSBKU09OXCIsIHtlcnJvciwgaWQsIHJlc291cmNlSWQsIHJlc291cmNlVHlwZX0pXG4gICAgICAgIHJldHVybiB7b2s6IGZhbHNlLCByZXNwb25zZToge2lkLCBzeW5jU3RhdGU6IFwiZmFpbGVkXCIsIHJlYXNvbjogXCJpbnZhbGlkLWRhdGFcIn19XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBkYXRhICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkoZGF0YSkpIHJldHVybiB7b2s6IHRydWUsIGRhdGE6IHt9fVxuXG4gICAgcmV0dXJuIHtvazogdHJ1ZSwgZGF0YTogSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShkYXRhKSl9XG4gIH1cblxuICAvKipcbiAgICogQXV0aG9yaXplcyBvbmUgbm9ybWFsaXplZCBtdXRhdGlvbi5cbiAgICogQHBhcmFtIHt7YWN0b3I6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBjb250ZXh0OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIG11dGF0aW9uOiBpbXBvcnQoXCIuL3N5bmMtZW52ZWxvcGUtcmVwbGF5LXNlcnZpY2UuanNcIikuU3luY1JlcGxheU11dGF0aW9ufX0gX2FyZ3MgLSBBY3RvciwgYmF0Y2ggY29udGV4dCwgYW5kIG11dGF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7YWxsb3dlZDogYm9vbGVhbiwgcmVhc29uPzogc3RyaW5nfT59IEFjY2VzcyByZXN1bHQuXG4gICAqL1xuICBhc3luYyBhdXRob3JpemVSZXBsYXlNdXRhdGlvbihfYXJncykge1xuICAgIHJldHVybiB7YWxsb3dlZDogdHJ1ZX1cbiAgfVxuXG4gIC8qKlxuICAgKiBMb2FkcyB0aGUgcHJldmlvdXNseSBzdG9yZWQgc3luYy9jaGFuZ2Ugcm93IGZvciBzdGFsZS1jbGllbnQgY29tcGFyaXNvbi5cbiAgICpcbiAgICogRGVmYXVsdHMgdG8gYSBzeW5jLW1vZGVsIGxvb2t1cCBieSBhY3RvciBhbmQgcmVzb3VyY2UgaWRlbnRpdHkgd2hlbiBhIHN5bmNcbiAgICogbW9kZWwgaXMgY29uZmlndXJlZDsgb3RoZXJ3aXNlIGFwcHMgb3ZlcnJpZGUgdGhpcyBob29rLlxuICAgKiBAcGFyYW0ge3thY3RvcjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGNvbnRleHQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgbXV0YXRpb246IGltcG9ydChcIi4vc3luYy1lbnZlbG9wZS1yZXBsYXktc2VydmljZS5qc1wiKS5TeW5jUmVwbGF5TXV0YXRpb259fSBhcmdzIC0gQWN0b3IsIGJhdGNoIGNvbnRleHQsIGFuZCBtdXRhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBFeGlzdGluZyBzeW5jIHJvdy5cbiAgICovXG4gIGFzeW5jIGZpbmRFeGlzdGluZ1JlcGxheVN5bmMoe2FjdG9yLCBtdXRhdGlvbn0pIHtcbiAgICBpZiAoIXRoaXMuc3luY01vZGVsKSByZXR1cm4gbnVsbFxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuc3luY01vZGVsLmZpbmRCeSh7XG4gICAgICBbdGhpcy5hY3RvckZvcmVpZ25LZXlDb2x1bW5dOiB0aGlzLnJlcGxheUFjdG9ySWQoYWN0b3IpLFxuICAgICAgcmVzb3VyY2VfaWQ6IG11dGF0aW9uLnJlc291cmNlSWQsXG4gICAgICByZXNvdXJjZV90eXBlOiBtdXRhdGlvbi5yZXNvdXJjZVR5cGVcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBwZXJzaXN0ZWQgYWN0b3IgaWQgdXNlZCBieSBtb2RlbC1iYWNrZWQgZGVmYXVsdCBob29rcy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYWN0b3IgLSBBY3RvciByZXR1cm5lZCBmcm9tIGF1dGhlbnRpY2F0ZVJlcGxheS5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBBY3RvciBpZC5cbiAgICovXG4gIHJlcGxheUFjdG9ySWQoYWN0b3IpIHtcbiAgICBpZiAoIWFjdG9yIHx8IHR5cGVvZiBhY3RvciAhPT0gXCJvYmplY3RcIiB8fCB0eXBlb2YgYWN0b3IuaWQgIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiU3luY0VudmVsb3BlUmVwbGF5U2VydmljZSBtb2RlbC1iYWNrZWQgZGVmYXVsdHMgcmVxdWlyZSBhbiBhY3RvciB3aXRoIGFuIGlkKCkgbWV0aG9kIGZyb20gYXV0aGVudGljYXRlUmVwbGF5XCIpXG4gICAgfVxuXG4gICAgcmV0dXJuIGFjdG9yLmlkKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHdoZXRoZXIgYSBub3JtYWxpemVkIG11dGF0aW9uIHNob3VsZCBiZSBhcHBsaWVkIHRvIGRvbWFpbiBtb2RlbHMuXG4gICAqIEBwYXJhbSB7e2FjdG9yOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgY29udGV4dDogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBleGlzdGluZ1N5bmM6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBtdXRhdGlvbjogaW1wb3J0KFwiLi9zeW5jLWVudmVsb3BlLXJlcGxheS1zZXJ2aWNlLmpzXCIpLlN5bmNSZXBsYXlNdXRhdGlvbn19IGFyZ3MgLSBBY3RvciwgYmF0Y2ggY29udGV4dCwgZXhpc3Rpbmcgc3luYyByb3csIGFuZCBtdXRhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IFdoZXRoZXIgdG8gYXBwbHkgdGhlIG11dGF0aW9uLlxuICAgKi9cbiAgYXN5bmMgc2hvdWxkQXBwbHlSZXBsYXlNdXRhdGlvbih7ZXhpc3RpbmdTeW5jLCBtdXRhdGlvbn0pIHtcbiAgICBjb25zdCBleGlzdGluZ0NsaWVudFVwZGF0ZWRBdCA9IHRoaXMuZXhpc3RpbmdSZXBsYXlTeW5jQ2xpZW50VXBkYXRlZEF0KGV4aXN0aW5nU3luYylcblxuICAgIHJldHVybiAhZXhpc3RpbmdDbGllbnRVcGRhdGVkQXQgfHwgbXV0YXRpb24uY2xpZW50VXBkYXRlZEF0ID4gZXhpc3RpbmdDbGllbnRVcGRhdGVkQXRcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgY2xpZW50IHRpbWVzdGFtcCBmcm9tIGFuIGV4aXN0aW5nIHN5bmMgcm93LlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBleGlzdGluZ1N5bmMgLSBFeGlzdGluZyBzeW5jIHJvdy5cbiAgICogQHJldHVybnMge0RhdGUgfCBudWxsfSBFeGlzdGluZyBjbGllbnQgdGltZXN0YW1wLlxuICAgKi9cbiAgZXhpc3RpbmdSZXBsYXlTeW5jQ2xpZW50VXBkYXRlZEF0KGV4aXN0aW5nU3luYykge1xuICAgIGlmICghZXhpc3RpbmdTeW5jIHx8IHR5cGVvZiBleGlzdGluZ1N5bmMgIT09IFwib2JqZWN0XCIpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCBzeW5jUmVjb3JkID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChleGlzdGluZ1N5bmMpXG4gICAgY29uc3QgdmFsdWUgPSB0eXBlb2Ygc3luY1JlY29yZC5jbGllbnRVcGRhdGVkQXQgPT09IFwiZnVuY3Rpb25cIlxuICAgICAgPyBzeW5jUmVjb3JkLmNsaWVudFVwZGF0ZWRBdCgpXG4gICAgICA6IHN5bmNSZWNvcmQuY2xpZW50VXBkYXRlZEF0XG5cbiAgICBpZiAodmFsdWUgaW5zdGFuY2VvZiBEYXRlKSByZXR1cm4gdmFsdWVcblxuICAgIGlmICh0eXBlb2YgdmFsdWUgIT09IFwic3RyaW5nXCIpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCBwYXJzZWRWYWx1ZSA9IG5ldyBEYXRlKHZhbHVlKVxuXG4gICAgcmV0dXJuIE51bWJlci5pc05hTihwYXJzZWRWYWx1ZS5nZXRUaW1lKCkpID8gbnVsbCA6IHBhcnNlZFZhbHVlXG4gIH1cblxuICAvKipcbiAgICogQ2hlY2tzIHdoZXRoZXIgYSBza2lwcGVkIG11dGF0aW9uIGV4YWN0bHkgbWF0Y2hlcyB0aGUgcGVyc2lzdGVkIHJlcGxheSByb3cuXG4gICAqIE9sZGVyIGRpc3RpbmN0IG11dGF0aW9ucyByZXRhaW4gdGhlIGVzdGFibGlzaGVkIHN1Y2Nlc3NmdWwgc3RhbGUtc2tpcCByZXNwb25zZS5cbiAgICogQHBhcmFtIHt7ZXhpc3RpbmdTeW5jOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgbXV0YXRpb246IGltcG9ydChcIi4vc3luYy1lbnZlbG9wZS1yZXBsYXktc2VydmljZS5qc1wiKS5TeW5jUmVwbGF5TXV0YXRpb259fSBhcmdzIC0gRXhpc3Rpbmcgcm93IGFuZCBpbmNvbWluZyBtdXRhdGlvbi5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IFdoZXRoZXIgdGhpcyBpcyBhIGR1cGxpY2F0ZSByZXBsYXkuXG4gICAqL1xuICBpc0R1cGxpY2F0ZVJlcGxheU11dGF0aW9uKHtleGlzdGluZ1N5bmMsIG11dGF0aW9ufSkge1xuICAgIGlmICghZXhpc3RpbmdTeW5jKSByZXR1cm4gZmFsc2VcblxuICAgIGNvbnN0IG1ldGFkYXRhID0gdGhpcy5yZXBsYXlQZXJzaXN0ZWRNZXRhZGF0YShleGlzdGluZ1N5bmMpXG5cbiAgICBpZiAobWV0YWRhdGEpIHtcbiAgICAgIHJldHVybiBtZXRhZGF0YS5jbGllbnRNdXRhdGlvbklkID09PSBTdHJpbmcobXV0YXRpb24uY2xpZW50TXV0YXRpb25JZCB8fCBtdXRhdGlvbi5pZClcbiAgICAgICAgJiYgbWV0YWRhdGEucGF5bG9hZEZpbmdlcnByaW50ID09PSBzaGEyNTZIZXgobXV0YXRpb24uc2VyaWFsaXplZERhdGEpXG4gICAgfVxuXG4gICAgY29uc3QgZXhpc3RpbmdDbGllbnRVcGRhdGVkQXQgPSB0aGlzLmV4aXN0aW5nUmVwbGF5U3luY0NsaWVudFVwZGF0ZWRBdChleGlzdGluZ1N5bmMpXG4gICAgY29uc3QgZXhpc3RpbmdEYXRhID0gdGhpcy5yZXBsYXlTeW5jUmVjb3JkVmFsdWUoZXhpc3RpbmdTeW5jLCBcImRhdGFcIilcbiAgICBjb25zdCBleGlzdGluZ1N5bmNUeXBlID0gdGhpcy5yZXBsYXlTeW5jUmVjb3JkVmFsdWUoZXhpc3RpbmdTeW5jLCBcInN5bmNUeXBlXCIpXG4gICAgY29uc3Qgc2VyaWFsaXplZEV4aXN0aW5nRGF0YSA9IHR5cGVvZiBleGlzdGluZ0RhdGEgPT09IFwic3RyaW5nXCIgPyBleGlzdGluZ0RhdGEgOiBKU09OLnN0cmluZ2lmeShleGlzdGluZ0RhdGEpXG5cbiAgICByZXR1cm4gZXhpc3RpbmdDbGllbnRVcGRhdGVkQXQ/LmdldFRpbWUoKSA9PT0gbXV0YXRpb24uY2xpZW50VXBkYXRlZEF0LmdldFRpbWUoKVxuICAgICAgJiYgc2VyaWFsaXplZEV4aXN0aW5nRGF0YSA9PT0gbXV0YXRpb24uc2VyaWFsaXplZERhdGFcbiAgICAgICYmIGV4aXN0aW5nU3luY1R5cGUgPT09IG11dGF0aW9uLnN5bmNUeXBlXG4gIH1cblxuICAvKipcbiAgICogUmVhZHMgYSBtb2RlbC1iYWNrZWQgc3luYy1yb3cgdmFsdWUgdGhyb3VnaCBpdHMgYWNjZXNzb3Igb3IgcGxhaW4gcHJvcGVydHkuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHN5bmNSZWNvcmQgLSBFeGlzdGluZyBzeW5jIHJvdy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dHJpYnV0ZU5hbWUgLSBBdHRyaWJ1dGUgbmFtZS5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBTdG9yZWQgdmFsdWUuXG4gICAqL1xuICByZXBsYXlTeW5jUmVjb3JkVmFsdWUoc3luY1JlY29yZCwgYXR0cmlidXRlTmFtZSkge1xuICAgIGNvbnN0IHJlY29yZCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoc3luY1JlY29yZClcbiAgICBjb25zdCB2YWx1ZSA9IHJlY29yZFthdHRyaWJ1dGVOYW1lXVxuXG4gICAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gXCJmdW5jdGlvblwiID8gdmFsdWUuY2FsbChzeW5jUmVjb3JkKSA6IHZhbHVlXG4gIH1cblxuICAvKipcbiAgICogUmVhZHMgZHVyYWJsZSByZXBsYXkgYWNrbm93bGVkZ2VtZW50IG1ldGFkYXRhIGZyb20gYSBtb2RlbC1iYWNrZWQgc3luYyByb3cuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHN5bmNSZWNvcmQgLSBFeGlzdGluZyBzeW5jIHJvdy5cbiAgICogQHJldHVybnMge3thY2tub3dsZWRnZW1lbnRWZXJzaW9uOiBzdHJpbmcgfCBudW1iZXIgfCBudWxsLCBjbGllbnRNdXRhdGlvbklkOiBzdHJpbmcsIHBheWxvYWRGaW5nZXJwcmludDogc3RyaW5nfSB8IG51bGx9IFBlcnNpc3RlZCBtZXRhZGF0YS5cbiAgICovXG4gIHJlcGxheVBlcnNpc3RlZE1ldGFkYXRhKHN5bmNSZWNvcmQpIHtcbiAgICBpZiAoIXN5bmNSZWNvcmQpIHJldHVybiBudWxsXG5cbiAgICByZXR1cm4gZGVjb2RlUmVwbGF5UGVyc2lzdGVkRGF0YSh0aGlzLnJlcGxheVN5bmNSZWNvcmRWYWx1ZShzeW5jUmVjb3JkLCBcImRhdGFcIikpLm1ldGFkYXRhXG4gIH1cblxuICAvKipcbiAgICogQXBwbGllcyBvbmUgbm9ybWFsaXplZCBtdXRhdGlvbiB0byBkb21haW4gbW9kZWxzLlxuICAgKlxuICAgKiBEaXNwYXRjaGVzIHRocm91Z2ggdGhlIGNvbmZpZ3VyZWQgYXBwbHktaGFuZGxlciByZWdpc3RyeSBmaXJzdCAoY29tcGF0XG4gICAqIHByZWNlZGVuY2UpOyBtdXRhdGlvbnMgd2l0aG91dCBhIG1hdGNoaW5nIGhhbmRsZXIgZmFsbCB0aHJvdWdoIHRvXG4gICAqIHJlc291cmNlIHJvdXRpbmcgd2hlbiBhIGNvbmZpZ3VyYXRpb24gb3IgcmVzb3VyY2VUeXBlT3ZlcnJpZGVzIGFyZVxuICAgKiBjb25maWd1cmVkLCBhbmQgb3RoZXJ3aXNlIGZhaWwgbG91ZGx5LlxuICAgKiBAcGFyYW0ge3thY3RvcjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGNvbnRleHQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgZXhpc3RpbmdTeW5jOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgbXV0YXRpb246IGltcG9ydChcIi4vc3luYy1lbnZlbG9wZS1yZXBsYXktc2VydmljZS5qc1wiKS5TeW5jUmVwbGF5TXV0YXRpb259fSBhcmdzIC0gQWN0b3IsIGJhdGNoIGNvbnRleHQsIGV4aXN0aW5nIHN5bmMgcm93LCBhbmQgbXV0YXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gUHJvamVjdC1zcGVjaWZpYyBhcHBseSByZXN1bHQuXG4gICAqL1xuICBhc3luYyBhcHBseVJlcGxheU11dGF0aW9uKGFyZ3MpIHtcbiAgICBpZiAodGhpcy5hcHBseUhhbmRsZXJzKSB7XG4gICAgICBjb25zdCBhcHBseUhhbmRsZXIgPSB0aGlzLmFwcGx5SGFuZGxlcnNbYXJncy5tdXRhdGlvbi5yZXNvdXJjZVR5cGVdXG5cbiAgICAgIGlmIChhcHBseUhhbmRsZXIpIHJldHVybiBhd2FpdCBhcHBseUhhbmRsZXIoYXJncylcbiAgICAgIGlmICghdGhpcy5yb3V0aW5nQ29uZmlndXJlZCgpKSB0aHJvdyBuZXcgRXJyb3IoYE5vIHN5bmMgYXBwbHkgaGFuZGxlciByZWdpc3RlcmVkIGZvcjogJHthcmdzLm11dGF0aW9uLnJlc291cmNlVHlwZX1gKVxuICAgIH1cblxuICAgIGlmICh0aGlzLnJvdXRpbmdDb25maWd1cmVkKCkpIHJldHVybiBhd2FpdCB0aGlzLmFwcGx5Um91dGVkUmVwbGF5TXV0YXRpb24oYXJncylcblxuICAgIHJldHVybiBudWxsXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB3aGV0aGVyIHJlc291cmNlIHJvdXRpbmcgaXMgY29uZmlndXJlZCBvbiB0aGlzIHNlcnZpY2UuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSBXaGV0aGVyIG11dGF0aW9ucyByb3V0ZSB0byBmcm9udGVuZC1tb2RlbCByZXNvdXJjZXMuXG4gICAqL1xuICByb3V0aW5nQ29uZmlndXJlZCgpIHtcbiAgICByZXR1cm4gQm9vbGVhbih0aGlzLmNvbmZpZ3VyYXRpb24gfHwgdGhpcy5yZXNvdXJjZVR5cGVPdmVycmlkZXMpXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIHJvdXRlZCByZXNvdXJjZSByZWdpc3RyYXRpb24gZm9yIGEgcmVzb3VyY2UgdHlwZSwgbWVtb2l6ZWRcbiAgICogcGVyIHJlcGxheSBzZXJ2aWNlLiBPdmVycmlkZXMgd2luIG92ZXIgdGhlIGNvbmZpZ3VyYXRpb24gcmVnaXN0cnk7IHN0cmluZ1xuICAgKiBvdmVycmlkZXMgYXJlIGFsaWFzZXMgcmVzb2x2ZWQgdGhyb3VnaCB0aGUgcmVnaXN0cnkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZXNvdXJjZVR5cGUgLSBNdXRhdGlvbiByZXNvdXJjZSB0eXBlLlxuICAgKiBAcmV0dXJucyB7U3luY1JlcGxheVJlc291cmNlUmVnaXN0cmF0aW9uIHwgbnVsbH0gUmVzb2x2ZWQgcmVnaXN0cmF0aW9uIG9yIG51bGwgd2hlbiB1bnJvdXRhYmxlLlxuICAgKi9cbiAgcmVwbGF5UmVzb3VyY2VSZWdpc3RyYXRpb24ocmVzb3VyY2VUeXBlKSB7XG4gICAgY29uc3QgbWVtb2l6ZWRSZWdpc3RyYXRpb24gPSB0aGlzLl9yZXBsYXlSZXNvdXJjZVJlZ2lzdHJhdGlvbnMuZ2V0KHJlc291cmNlVHlwZSlcblxuICAgIGlmIChtZW1vaXplZFJlZ2lzdHJhdGlvbiAhPT0gdW5kZWZpbmVkKSByZXR1cm4gbWVtb2l6ZWRSZWdpc3RyYXRpb25cblxuICAgIGNvbnN0IHJlZ2lzdHJhdGlvbiA9IHRoaXMucmVzb2x2ZVJlcGxheVJlc291cmNlUmVnaXN0cmF0aW9uKHJlc291cmNlVHlwZSlcblxuICAgIHRoaXMuX3JlcGxheVJlc291cmNlUmVnaXN0cmF0aW9ucy5zZXQocmVzb3VyY2VUeXBlLCByZWdpc3RyYXRpb24pXG5cbiAgICByZXR1cm4gcmVnaXN0cmF0aW9uXG4gIH1cblxuICAvKipcbiAgICogVW5jYWNoZWQgcm91dGVkLXJlc291cmNlIHJlc29sdXRpb24gYmVoaW5kIHtAbGluayBTeW5jRW52ZWxvcGVSZXBsYXlTZXJ2aWNlI3JlcGxheVJlc291cmNlUmVnaXN0cmF0aW9ufS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJlc291cmNlVHlwZSAtIE11dGF0aW9uIHJlc291cmNlIHR5cGUuXG4gICAqIEByZXR1cm5zIHtTeW5jUmVwbGF5UmVzb3VyY2VSZWdpc3RyYXRpb24gfCBudWxsfSBSZXNvbHZlZCByZWdpc3RyYXRpb24gb3IgbnVsbCB3aGVuIHVucm91dGFibGUuXG4gICAqL1xuICByZXNvbHZlUmVwbGF5UmVzb3VyY2VSZWdpc3RyYXRpb24ocmVzb3VyY2VUeXBlKSB7XG4gICAgY29uc3Qgb3ZlcnJpZGUgPSB0aGlzLnJlc291cmNlVHlwZU92ZXJyaWRlcz8uW3Jlc291cmNlVHlwZV1cblxuICAgIGlmIChvdmVycmlkZSAmJiB0eXBlb2Ygb3ZlcnJpZGUgIT09IFwic3RyaW5nXCIpIHtcbiAgICAgIHJldHVybiB7bW9kZWxOYW1lOiByZXNvdXJjZVR5cGUsIHJlc291cmNlQ2xhc3M6IG92ZXJyaWRlLCByZXNvdXJjZUNvbmZpZ3VyYXRpb246IG51bGx9XG4gICAgfVxuXG4gICAgY29uc3QgcmVnaXN0cnlSZXNvdXJjZVR5cGUgPSB0eXBlb2Ygb3ZlcnJpZGUgPT09IFwic3RyaW5nXCIgPyBvdmVycmlkZSA6IHJlc291cmNlVHlwZVxuXG4gICAgaWYgKCF0aGlzLmNvbmZpZ3VyYXRpb24pIHJldHVybiBudWxsXG5cbiAgICBjb25zdCByZXNvbHZlZFJlZ2lzdHJhdGlvbiA9IHJlc29sdmVGcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzcyh7Y29uZmlndXJhdGlvbjogdGhpcy5jb25maWd1cmF0aW9uLCByZXNvdXJjZVR5cGU6IHJlZ2lzdHJ5UmVzb3VyY2VUeXBlfSlcblxuICAgIGlmICghcmVzb2x2ZWRSZWdpc3RyYXRpb24pIHJldHVybiBudWxsXG5cbiAgICByZXR1cm4ge1xuICAgICAgbW9kZWxOYW1lOiByZXNvbHZlZFJlZ2lzdHJhdGlvbi5tb2RlbE5hbWUsXG4gICAgICByZXNvdXJjZUNsYXNzOiByZXNvbHZlZFJlZ2lzdHJhdGlvbi5yZXNvdXJjZUNsYXNzLFxuICAgICAgcmVzb3VyY2VDb25maWd1cmF0aW9uOiByZXNvbHZlZFJlZ2lzdHJhdGlvbi5yZXNvdXJjZUNvbmZpZ3VyYXRpb25cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIGFiaWxpdHkgYW5kIHJlc291cmNlIGNvbnRleHQgdXNlZCB0byBhdXRob3JpemUgcm91dGVkXG4gICAqIHJlc291cmNlcy4gRGVmYXVsdHMgdG8gdGhlIGNvbnN0cnVjdG9yLXdpZGUgYWJpbGl0eS9hYmlsaXR5Q29udGV4dDtcbiAgICogc3ViY2xhc3NlcyAoc2lnbmVkIHJlcGxheSkgb3ZlcnJpZGUgdGhpcyB0byBkZXJpdmUgYXV0aG9yaXphdGlvbiBmcm9tIGFcbiAgICogdmVyaWZpZWQgYWN0b3IvZ3JhbnQgaW5zdGVhZCBvZiB1cGxvYWRlci1nbG9iYWwgc3RhdGUuXG4gICAqIEBwYXJhbSB7e2FjdG9yOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgY29udGV4dDogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fX0gX2FyZ3MgLSBSZXBsYXkgYWN0b3IgYW5kIGJhdGNoIGNvbnRleHQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHthYmlsaXR5OiBpbXBvcnQoXCIuLi9hdXRob3JpemF0aW9uL2FiaWxpdHkuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZCwgYWJpbGl0eUNvbnRleHQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0+fSBBYmlsaXR5IGFuZCByZXNvdXJjZSBjb250ZXh0LlxuICAgKi9cbiAgYXN5bmMgcmVwbGF5QWJpbGl0eUZvcihfYXJncykge1xuICAgIHJldHVybiB7YWJpbGl0eTogdGhpcy5hYmlsaXR5IHx8IHVuZGVmaW5lZCwgYWJpbGl0eUNvbnRleHQ6IHRoaXMuYWJpbGl0eUNvbnRleHQgfHwge319XG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSByb3V0ZWQgcmVzb3VyY2UgaW5zdGFuY2UgaGFuZGxpbmcgb25lIG11dGF0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MuYWN0b3IgLSBSZXBsYXkgYWN0b3IuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmNvbnRleHQgLSBSZXBsYXkgY29udGV4dC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3N5bmMtZW52ZWxvcGUtcmVwbGF5LXNlcnZpY2UuanNcIikuU3luY1JlcGxheU11dGF0aW9ufSBhcmdzLm11dGF0aW9uIC0gTm9ybWFsaXplZCByZXBsYXkgbXV0YXRpb24uXG4gICAqIEBwYXJhbSB7U3luY1JlcGxheVJlc291cmNlUmVnaXN0cmF0aW9ufSBhcmdzLnJlZ2lzdHJhdGlvbiAtIFJlc29sdmVkIHJlc291cmNlIHJlZ2lzdHJhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWwtcmVzb3VyY2UvYmFzZS1yZXNvdXJjZS5qc1wiKS5kZWZhdWx0Pn0gUm91dGVkIHJlc291cmNlIGluc3RhbmNlLlxuICAgKi9cbiAgYXN5bmMgYnVpbGRSZXBsYXlSZXNvdXJjZSh7YWN0b3IsIGNvbnRleHQsIG11dGF0aW9uLCByZWdpc3RyYXRpb259KSB7XG4gICAgY29uc3QgUmVzb3VyY2VDbGFzcyA9IHJlZ2lzdHJhdGlvbi5yZXNvdXJjZUNsYXNzXG4gICAgY29uc3Qge2FiaWxpdHksIGFiaWxpdHlDb250ZXh0fSA9IGF3YWl0IHRoaXMucmVwbGF5QWJpbGl0eUZvcih7YWN0b3IsIGNvbnRleHR9KVxuXG4gICAgcmV0dXJuIG5ldyBSZXNvdXJjZUNsYXNzKHtcbiAgICAgIGFiaWxpdHksXG4gICAgICBjb250ZXh0OiBhYmlsaXR5Q29udGV4dCxcbiAgICAgIGxvY2Fsczogey4uLih0aGlzLmxvY2FscyB8fCB7fSksIC4uLih0aGlzLmNvbmZpZ3VyYXRpb24gPyB7Y29uZmlndXJhdGlvbjogdGhpcy5jb25maWd1cmF0aW9ufSA6IHt9KX0sXG4gICAgICBtb2RlbE5hbWU6IHJlZ2lzdHJhdGlvbi5tb2RlbE5hbWUsXG4gICAgICBwYXJhbXM6IG11dGF0aW9uLmRhdGEsXG4gICAgICAuLi4ocmVnaXN0cmF0aW9uLnJlc291cmNlQ29uZmlndXJhdGlvbiA/IHtyZXNvdXJjZUNvbmZpZ3VyYXRpb246IHJlZ2lzdHJhdGlvbi5yZXNvdXJjZUNvbmZpZ3VyYXRpb259IDoge30pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBsaWVzIG9uZSBtdXRhdGlvbiB0aHJvdWdoIGl0cyByb3V0ZWQgZnJvbnRlbmQtbW9kZWwgcmVzb3VyY2U6XG4gICAqIGF1dGhvcml6YXRpb24sIGFiaWxpdHktc2NvcGVkIHJlY29yZCBsb29rdXAsIHNjaGVtYSBub3JtYWxpemF0aW9uIGFuZFxuICAgKiBhc3NpZ24vc2F2ZSBmb3IgdXBkYXRlcywgc2F2ZS10aGVuLWNoZWNrIG1lbWJlcnNoaXAgY3JlYXRlcywgZGVzdHJveXMgZm9yXG4gICAqIGRlbGV0ZXMsIGFuZCB0aGUgcmVzb3VyY2UncyBhZnRlclN5bmNBcHBseSB0YWlsLiBDbGllbnQtc2FmZSBmYWlsdXJlc1xuICAgKiB0aHJvdyBzYWZlIGVycm9ycyB0aGF0IGZhaWwgdGhlIHNpbmdsZSBzeW5jLlxuICAgKiBAcGFyYW0ge3thY3RvcjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGNvbnRleHQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgZXhpc3RpbmdTeW5jOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgbXV0YXRpb246IGltcG9ydChcIi4vc3luYy1lbnZlbG9wZS1yZXBsYXktc2VydmljZS5qc1wiKS5TeW5jUmVwbGF5TXV0YXRpb259fSBhcmdzIC0gQWN0b3IsIGJhdGNoIGNvbnRleHQsIGV4aXN0aW5nIHN5bmMgcm93LCBhbmQgbXV0YXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IEFwcGx5IHJlc3VsdCB3aXRoIHJlY29yZCwgY3JlYXRlZC9kZWxldGVkIGZsYWdzLCBhbmQgYWZ0ZXJTeW5jQXBwbHkgZXh0cmFzLlxuICAgKi9cbiAgYXN5bmMgYXBwbHlSb3V0ZWRSZXBsYXlNdXRhdGlvbih7YWN0b3IsIGNvbnRleHQsIGV4aXN0aW5nU3luYywgbXV0YXRpb259KSB7XG4gICAgY29uc3QgcmVnaXN0cmF0aW9uID0gdGhpcy5yZXBsYXlSZXNvdXJjZVJlZ2lzdHJhdGlvbihtdXRhdGlvbi5yZXNvdXJjZVR5cGUpXG5cbiAgICBpZiAoIXJlZ2lzdHJhdGlvbikge1xuICAgICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShgVW5rbm93biBzeW5jIHJlc291cmNlIHR5cGU6ICR7bXV0YXRpb24ucmVzb3VyY2VUeXBlfS5gLCB7Y29kZTogXCJ1bmtub3duLXJlc291cmNlLXR5cGVcIn0pXG4gICAgfVxuXG4gICAgY29uc3QgcmVzb3VyY2UgPSBhd2FpdCB0aGlzLmJ1aWxkUmVwbGF5UmVzb3VyY2Uoe2FjdG9yLCBjb250ZXh0LCBtdXRhdGlvbiwgcmVnaXN0cmF0aW9ufSlcbiAgICBjb25zdCBjdXN0b21BcHBseVJlc3VsdCA9IGF3YWl0IHJlc291cmNlLmFwcGx5U3luYyh7Y29udGV4dCwgZXhpc3RpbmdTeW5jLCBtdXRhdGlvbn0pXG5cbiAgICBpZiAoY3VzdG9tQXBwbHlSZXN1bHQgIT09IG51bGwpIHJldHVybiBjdXN0b21BcHBseVJlc3VsdFxuXG4gICAgY29uc3QgYXV0aG9yaXphdGlvbiA9IGF3YWl0IHJlc291cmNlLmF1dGhvcml6ZVN5bmNNdXRhdGlvbih7Y29udGV4dCwgbXV0YXRpb259KVxuXG4gICAgaWYgKCFhdXRob3JpemF0aW9uLmFsbG93ZWQpIHtcbiAgICAgIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoYFN5bmMgbXV0YXRpb24gZGVuaWVkIGZvcjogJHttdXRhdGlvbi5yZXNvdXJjZVR5cGV9LmAsIHtjb2RlOiBhdXRob3JpemF0aW9uLnJlYXNvbiB8fCBcImFjY2Vzcy1kZW5pZWRcIn0pXG4gICAgfVxuXG4gICAgaWYgKG11dGF0aW9uLnN5bmNUeXBlID09PSBcImRlbGV0ZVwiKSByZXR1cm4gYXdhaXQgdGhpcy5hcHBseVJvdXRlZFJlcGxheURlbGV0ZSh7bXV0YXRpb24sIHJlc291cmNlfSlcblxuICAgIGNvbnN0IGNvbW1hbmRBcHBseVJlc3VsdCA9IGF3YWl0IHRoaXMuYXBwbHlSb3V0ZWRSZXBsYXlDb21tYW5kKHtjb250ZXh0LCBtdXRhdGlvbiwgcmVzb3VyY2V9KVxuXG4gICAgaWYgKGNvbW1hbmRBcHBseVJlc3VsdCAhPT0gbnVsbCkgcmV0dXJuIGNvbW1hbmRBcHBseVJlc3VsdFxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuYXBwbHlSb3V0ZWRSZXBsYXlVcHNlcnQoe2NvbnRleHQsIG11dGF0aW9uLCByZXNvdXJjZX0pXG4gIH1cblxuICAvKipcbiAgICogRGlzcGF0Y2hlcyBhIHJvdXRlZCBzeW5jIG11dGF0aW9uIHdob3NlIHN5bmNUeXBlIG1hdGNoZXMgYSByZXNvdXJjZS1kZWNsYXJlZFxuICAgKiBjdXN0b20gY29tbWFuZC4gUmV0dXJucyBudWxsIHdoZW4gdGhlIG11dGF0aW9uIGlzIG5vdCBhIGNvbW1hbmQgc28gdGhlXG4gICAqIGNhbGxlciBjYW4gZmFsbCB0aHJvdWdoIHRvIHRoZSBkZWZhdWx0IHVwc2VydCBwYXRoLlxuICAgKiBAcGFyYW0ge3tjb250ZXh0OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIG11dGF0aW9uOiBpbXBvcnQoXCIuL3N5bmMtZW52ZWxvcGUtcmVwbGF5LXNlcnZpY2UuanNcIikuU3luY1JlcGxheU11dGF0aW9uLCByZXNvdXJjZTogaW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWwtcmVzb3VyY2UvYmFzZS1yZXNvdXJjZS5qc1wiKS5kZWZhdWx0fX0gYXJncyAtIENvbW1hbmQgZGlzcGF0Y2ggYXJncy5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgbnVsbD59IENvbW1hbmQgYXBwbHkgcmVzdWx0IG9yIG51bGwuXG4gICAqL1xuICBhc3luYyBhcHBseVJvdXRlZFJlcGxheUNvbW1hbmQoe2NvbnRleHQsIG11dGF0aW9uLCByZXNvdXJjZX0pIHtcbiAgICBjb25zdCBjb21tYW5kQ29uZmlnID0gdGhpcy5yZXNvdXJjZUNvbW1hbmRDb25maWcocmVzb3VyY2UpXG4gICAgY29uc3QgY29tbWFuZE1ldGhvZE5hbWUgPSB0aGlzLmNvbW1hbmRNZXRob2ROYW1lRm9yU3luY1R5cGUoe2NvbW1hbmRDb25maWcsIHN5bmNUeXBlOiBtdXRhdGlvbi5zeW5jVHlwZX0pXG5cbiAgICBpZiAoIWNvbW1hbmRNZXRob2ROYW1lKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgY29tbWFuZE1ldGhvZCA9IHJlc291cmNlLnJlc291cmNlTWV0aG9kKGNvbW1hbmRNZXRob2ROYW1lKVxuXG4gICAgaWYgKCFjb21tYW5kTWV0aG9kKSB7XG4gICAgICB0aHJvdyBWZWxvY2lvdXNFcnJvci5zYWZlKGBTeW5jIGNvbW1hbmQgaGFuZGxlciBtaXNzaW5nIGZvcjogJHttdXRhdGlvbi5yZXNvdXJjZVR5cGV9LiR7bXV0YXRpb24uc3luY1R5cGV9LmAsIHtjb2RlOiBcInN5bmMtY29tbWFuZC1oYW5kbGVyLW1pc3NpbmdcIn0pXG4gICAgfVxuXG4gICAgY29uc3QgYXJncyA9IHRoaXMuY29tbWFuZEFyZ3NGb3JNdXRhdGlvbih7Y29tbWFuZENvbmZpZywgY29tbWFuZE1ldGhvZE5hbWUsIG11dGF0aW9ufSlcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBjb21tYW5kTWV0aG9kLm1ldGhvZC5jYWxsKGNvbW1hbmRNZXRob2QucmVzb3VyY2UsIGFyZ3MpXG5cbiAgICBjb25zdCBhZnRlckV4dHJhcyA9IGF3YWl0IHJlc291cmNlLmFmdGVyU3luY0FwcGx5KHtjb250ZXh0LCBjcmVhdGVkOiBmYWxzZSwgbXV0YXRpb24sIHJlY29yZDogbnVsbH0pXG4gICAgY29uc3QgcmVzdWx0T2JqZWN0ID0gcmVzdWx0ICYmIHR5cGVvZiByZXN1bHQgPT09IFwib2JqZWN0XCIgJiYgIUFycmF5LmlzQXJyYXkocmVzdWx0KSA/IHJlc3VsdCA6IHt9XG5cbiAgICByZXR1cm4ge2NvbW1hbmRSZXN1bHQ6IHJlc3VsdCwgY3JlYXRlZDogZmFsc2UsIGRlbGV0ZWQ6IGZhbHNlLCByZWNvcmQ6IG51bGwsIC4uLnJlc3VsdE9iamVjdCwgLi4uYWZ0ZXJFeHRyYXN9XG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIGN1c3RvbS1jb21tYW5kIGNvbmZpZ3VyYXRpb24gZGVjbGFyZWQgb24gYSByb3V0ZWQgcmVzb3VyY2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWwtcmVzb3VyY2UvYmFzZS1yZXNvdXJjZS5qc1wiKS5kZWZhdWx0fSByZXNvdXJjZSAtIFJvdXRlZCByZXNvdXJjZSBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge3tjb2xsZWN0aW9uQ29tbWFuZHM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4sIG1lbWJlckNvbW1hbmRzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+fX0gQ29tbWFuZCBjb25maWcuXG4gICAqL1xuICByZXNvdXJjZUNvbW1hbmRDb25maWcocmVzb3VyY2UpIHtcbiAgICBjb25zdCBjb25maWcgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHJlc291cmNlLnJlc291cmNlQ29uZmlndXJhdGlvblZhbHVlIHx8IHt9KVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGNvbGxlY3Rpb25Db21tYW5kczogY29uZmlnLmNvbGxlY3Rpb25Db21tYW5kcyB8fCB7fSxcbiAgICAgIG1lbWJlckNvbW1hbmRzOiBjb25maWcubWVtYmVyQ29tbWFuZHMgfHwge31cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIHJlc291cmNlIG1ldGhvZCBuYW1lIGZvciBhIHN5bmNUeXBlIHdoZW4gaXQgbmFtZXMgYSBkZWNsYXJlZFxuICAgKiBjdXN0b20gY29tbWFuZC5cbiAgICogQHBhcmFtIHt7Y29tbWFuZENvbmZpZzoge2NvbGxlY3Rpb25Db21tYW5kczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiwgbWVtYmVyQ29tbWFuZHM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz59LCBzeW5jVHlwZTogc3RyaW5nfX0gYXJncyAtIExvb2t1cCBhcmdzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVsbH0gTWV0aG9kIG5hbWUgb3IgbnVsbC5cbiAgICovXG4gIGNvbW1hbmRNZXRob2ROYW1lRm9yU3luY1R5cGUoe2NvbW1hbmRDb25maWcsIHN5bmNUeXBlfSkge1xuICAgIGlmIChjb21tYW5kQ29uZmlnLm1lbWJlckNvbW1hbmRzW3N5bmNUeXBlXSkgcmV0dXJuIHN5bmNUeXBlXG4gICAgaWYgKGNvbW1hbmRDb25maWcuY29sbGVjdGlvbkNvbW1hbmRzW3N5bmNUeXBlXSkgcmV0dXJuIHN5bmNUeXBlXG5cbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyB0aGUgYXJndW1lbnRzIG9iamVjdCBwYXNzZWQgdG8gYSByZXNvdXJjZSBjb21tYW5kIG1ldGhvZC4gTWVtYmVyXG4gICAqIGNvbW1hbmRzIHJlY2VpdmUgdGhlIGVudmVsb3BlJ3MgcmVzb3VyY2VJZCBhcyBgaWRgOyB0aGUgZW52ZWxvcGUgaWRlbnRpdHlcbiAgICogaXMgYXNzaWduZWQgYWZ0ZXIgdGhlIHBheWxvYWQgc28gYSBwYXlsb2FkIGBpZGAgY2FuIG5ldmVyIHJldGFyZ2V0IHRoZVxuICAgKiBjb21tYW5kIGF3YXkgZnJvbSB0aGUgcmVzb3VyY2UgdGhlIGF1dGhvcml6YXRpb24gaG9va3MgYXBwcm92ZWQuXG4gICAqIEBwYXJhbSB7e2NvbW1hbmRDb25maWc6IHtjb2xsZWN0aW9uQ29tbWFuZHM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4sIG1lbWJlckNvbW1hbmRzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+fSwgY29tbWFuZE1ldGhvZE5hbWU6IHN0cmluZywgbXV0YXRpb246IGltcG9ydChcIi4vc3luYy1lbnZlbG9wZS1yZXBsYXktc2VydmljZS5qc1wiKS5TeW5jUmVwbGF5TXV0YXRpb259fSBhcmdzIC0gQXJncyBidWlsZGVyIGFyZ3MuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IENvbW1hbmQgbWV0aG9kIGFyZ3VtZW50cy5cbiAgICovXG4gIGNvbW1hbmRBcmdzRm9yTXV0YXRpb24oe2NvbW1hbmRDb25maWcsIGNvbW1hbmRNZXRob2ROYW1lLCBtdXRhdGlvbn0pIHtcbiAgICBjb25zdCBpc01lbWJlciA9IGNvbW1hbmRDb25maWcubWVtYmVyQ29tbWFuZHNbY29tbWFuZE1ldGhvZE5hbWVdICE9PSB1bmRlZmluZWRcblxuICAgIGlmIChpc01lbWJlcikge1xuICAgICAgcmV0dXJuIHsuLi5tdXRhdGlvbi5kYXRhLCBpZDogbXV0YXRpb24ucmVzb3VyY2VJZH1cbiAgICB9XG5cbiAgICByZXR1cm4gey4uLm11dGF0aW9uLmRhdGF9XG4gIH1cblxuICAvKipcbiAgICogQXBwbGllcyBhIHJvdXRlZCBkZWxldGUgbXV0YXRpb24uIFRoZSByZWNvcmQgaXMgbWFya2VkIGFzIGEgc2VydmVyIGFwcGx5XG4gICAqIGZvciB0aGUgZHVyYXRpb24gb2YgdGhlIHJlcGxheS1vd25lZCBkZXN0cm95IC0gYW4gYWN0aXZlIFN5bmNQdWJsaXNoZXJcbiAgICogbmV2ZXIgcHVibGlzaGVzIHRoZSByZXBsYXllZCBkZWxldGUgYSBzZWNvbmQgdGltZSAodGhlIHJlcGxheSBvd25zIGl0c1xuICAgKiBvd24gcGVyc2lzdCBhbmQgYnJvYWRjYXN0cyksIHdoaWxlIGxhdGVyIHNlcnZlci1zaWRlIHdyaXRlcyB0byB0aGUgc2FtZVxuICAgKiBpbnN0YW5jZSBwdWJsaXNoIG5vcm1hbGx5IGFnYWluLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9zeW5jLWVudmVsb3BlLXJlcGxheS1zZXJ2aWNlLmpzXCIpLlN5bmNSZXBsYXlNdXRhdGlvbn0gYXJncy5tdXRhdGlvbiAtIE5vcm1hbGl6ZWQgcmVwbGF5IG11dGF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVsLXJlc291cmNlL2Jhc2UtcmVzb3VyY2UuanNcIikuZGVmYXVsdH0gYXJncy5yZXNvdXJjZSAtIFJvdXRlZCByZXNvdXJjZSBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gQXBwbHkgcmVzdWx0IHdpdGggdGhlIGRlbGV0ZWQgZmxhZy5cbiAgICovXG4gIGFzeW5jIGFwcGx5Um91dGVkUmVwbGF5RGVsZXRlKHttdXRhdGlvbiwgcmVzb3VyY2V9KSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IHJlc291cmNlLm1vZGVsQ2xhc3MoKVxuICAgIGNvbnN0IHJ1bkRlbGV0ZSA9IGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlY29yZCA9IGF3YWl0IHJlc291cmNlLmZpbmRTeW5jUmVjb3JkKHtmb3JEZWxldGU6IHRydWUsIG11dGF0aW9ufSlcblxuICAgICAgaWYgKCFyZWNvcmQpIHJldHVybiB7Y3JlYXRlZDogZmFsc2UsIGRlbGV0ZWQ6IGZhbHNlLCByZWNvcmQ6IG51bGx9XG5cbiAgICAgIGNvbnN0IGNvbmZsaWN0UmVzdWx0ID0gYXdhaXQgdGhpcy5yb3V0ZWRSZXBsYXlDb25mbGljdFJlc3VsdCh7YXR0cmlidXRlczoge30sIGV4aXN0aW5nUmVjb3JkOiByZWNvcmQsIG11dGF0aW9uLCByZXNvdXJjZX0pXG5cbiAgICAgIGlmIChjb25mbGljdFJlc3VsdCkgcmV0dXJuIGNvbmZsaWN0UmVzdWx0XG5cbiAgICAgIGNvbnN0IHJlbGVhc2VTZXJ2ZXJBcHBseSA9IG1hcmtTZXJ2ZXJBcHBseShyZWNvcmQpXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHJlY29yZC5kZXN0cm95KClcbiAgICAgIH0gZmluYWxseSB7XG4gICAgICAgIHJlbGVhc2VTZXJ2ZXJBcHBseSgpXG4gICAgICB9XG5cbiAgICAgIHJldHVybiB7Y3JlYXRlZDogZmFsc2UsIGRlbGV0ZWQ6IHRydWUsIHJlY29yZH1cbiAgICB9XG5cbiAgICBpZiAoIXRoaXMuY29uZmxpY3RTdHJhdGVneSkgcmV0dXJuIGF3YWl0IHJ1bkRlbGV0ZSgpXG5cbiAgICByZXR1cm4gYXdhaXQgTW9kZWxDbGFzcy53aXRoQWR2aXNvcnlMb2NrKHN5bmNSZXBsYXlDb25mbGljdExvY2tOYW1lKHtyZXNvdXJjZUlkOiBtdXRhdGlvbi5yZXNvdXJjZUlkLCByZXNvdXJjZVR5cGU6IG11dGF0aW9uLnJlc291cmNlVHlwZX0pLCBydW5EZWxldGUsIHtkZWRpY2F0ZWRDb25uZWN0aW9uOiB0cnVlfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBsaWVzIGEgcm91dGVkIHVwc2VydCBtdXRhdGlvbjogcGVybWl0dGVkIHBheWxvYWQgYXR0cmlidXRlcyBhcmVcbiAgICogYXNzaWduZWQgYW5kIHNhdmVkIG9udG8gdGhlIGZvdW5kIHJlY29yZCAodGhlIHJlY29yZCBsYXllciBvd25zIHZhbHVlXG4gICAqIGNhc3RpbmcgYW5kIHZhbGlkYXRpb24pLCBhbmQgbWlzc2luZyByZWNvcmRzIGFyZSBjcmVhdGVkIHdpdGggdGhlXG4gICAqIGNsaWVudC1nZW5lcmF0ZWQgcHJpbWFyeSBrZXkgcGx1cyBhIHNhdmUtdGhlbi1jaGVjayBtZW1iZXJzaGlwIGNoZWNrLlxuICAgKiBXcml0dGVuIHJlY29yZHMgYXJlIG1hcmtlZCBhcyBzZXJ2ZXIgYXBwbGllcyBmb3IgdGhlIGR1cmF0aW9uIG9mIHRoZVxuICAgKiByZXBsYXktb3duZWQgd3JpdGUgLSBhbiBhY3RpdmUgU3luY1B1Ymxpc2hlciBuZXZlciBwdWJsaXNoZXMgdGhlIHJlcGxheWVkXG4gICAqIG11dGF0aW9uIGEgc2Vjb25kIHRpbWUgKHRoZSByZXBsYXkgb3ducyBpdHMgb3duIHBlcnNpc3QgYW5kIGJyb2FkY2FzdHMpLFxuICAgKiB3aGlsZSBsYXRlciBzZXJ2ZXItc2lkZSB3cml0ZXMgdG8gdGhlIHNhbWUgaW5zdGFuY2UgcHVibGlzaCBub3JtYWxseVxuICAgKiBhZ2Fpbi4gTW9kZWwgdmFsaWRhdGlvbiBmYWlsdXJlcyBiZWNvbWUgY2xpZW50LXNhZmUgcGVyLXN5bmMgZmFpbHVyZXNcbiAgICogY2FycnlpbmcgdGhlIHRyYW5zbGF0ZWQgdmFsaWRhdGlvbiBtZXNzYWdlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmNvbnRleHQgLSBSZXBsYXkgY29udGV4dC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3N5bmMtZW52ZWxvcGUtcmVwbGF5LXNlcnZpY2UuanNcIikuU3luY1JlcGxheU11dGF0aW9ufSBhcmdzLm11dGF0aW9uIC0gTm9ybWFsaXplZCByZXBsYXkgbXV0YXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWwtcmVzb3VyY2UvYmFzZS1yZXNvdXJjZS5qc1wiKS5kZWZhdWx0fSBhcmdzLnJlc291cmNlIC0gUm91dGVkIHJlc291cmNlIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSBBcHBseSByZXN1bHQgd2l0aCByZWNvcmQsIGNyZWF0ZWQgZmxhZywgYW5kIGFmdGVyU3luY0FwcGx5IGV4dHJhcy5cbiAgICovXG4gIGFzeW5jIGFwcGx5Um91dGVkUmVwbGF5VXBzZXJ0KHtjb250ZXh0LCBtdXRhdGlvbiwgcmVzb3VyY2V9KSB7XG4gICAgY29uc3QgYXR0cmlidXRlcyA9IHRoaXMucGVybWl0dGVkUm91dGVkQXR0cmlidXRlcyh7bXV0YXRpb24sIHJlc291cmNlfSlcbiAgICBjb25zdCBNb2RlbENsYXNzID0gcmVzb3VyY2UubW9kZWxDbGFzcygpXG4gICAgY29uc3QgcnVuVXBzZXJ0ID0gYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgZXhpc3RpbmdSZWNvcmQgPSBhd2FpdCByZXNvdXJjZS5maW5kU3luY1JlY29yZCh7bXV0YXRpb259KVxuICAgICAgY29uc3QgY29uZmxpY3RSZXN1bHQgPSBhd2FpdCB0aGlzLnJvdXRlZFJlcGxheUNvbmZsaWN0UmVzdWx0KHthdHRyaWJ1dGVzLCBleGlzdGluZ1JlY29yZCwgbXV0YXRpb24sIHJlc291cmNlfSlcblxuICAgICAgaWYgKGNvbmZsaWN0UmVzdWx0KSByZXR1cm4gY29uZmxpY3RSZXN1bHRcblxuICAgICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCB8IG51bGx9ICovXG4gICAgICBsZXQgcmVjb3JkID0gZXhpc3RpbmdSZWNvcmRcbiAgICAgIGxldCBjcmVhdGVkID0gZmFsc2VcblxuICAgICAgaWYgKGV4aXN0aW5nUmVjb3JkKSB7XG4gICAgICAgIGNvbnN0IHJlbGVhc2VTZXJ2ZXJBcHBseSA9IG1hcmtTZXJ2ZXJBcHBseShleGlzdGluZ1JlY29yZClcblxuICAgICAgICB0cnkge1xuICAgICAgICAgIGV4aXN0aW5nUmVjb3JkLmFzc2lnbihhdHRyaWJ1dGVzKVxuICAgICAgICAgIGF3YWl0IHRoaXMuc2F2ZVJvdXRlZFJlcGxheVJlY29yZChleGlzdGluZ1JlY29yZClcbiAgICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgICByZWxlYXNlU2VydmVyQXBwbHkoKVxuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZWNvcmQgPSBhd2FpdCB0aGlzLmNyZWF0ZVJvdXRlZFJlcGxheVJlY29yZCh7YXR0cmlidXRlcywgbXV0YXRpb24sIHJlc291cmNlfSlcbiAgICAgICAgY3JlYXRlZCA9IHRydWVcbiAgICAgIH1cblxuICAgICAgY29uc3QgZXh0cmFzID0gYXdhaXQgcmVzb3VyY2UuYWZ0ZXJTeW5jQXBwbHkoe2NvbnRleHQsIGNyZWF0ZWQsIG11dGF0aW9uLCByZWNvcmR9KVxuXG4gICAgICByZXR1cm4ge2NyZWF0ZWQsIGRlbGV0ZWQ6IGZhbHNlLCByZWNvcmQsIC4uLmV4dHJhc31cbiAgICB9XG5cbiAgICBpZiAoIXRoaXMuY29uZmxpY3RTdHJhdGVneSkgcmV0dXJuIGF3YWl0IHJ1blVwc2VydCgpXG5cbiAgICByZXR1cm4gYXdhaXQgTW9kZWxDbGFzcy53aXRoQWR2aXNvcnlMb2NrKHN5bmNSZXBsYXlDb25mbGljdExvY2tOYW1lKHtyZXNvdXJjZUlkOiBtdXRhdGlvbi5yZXNvdXJjZUlkLCByZXNvdXJjZVR5cGU6IG11dGF0aW9uLnJlc291cmNlVHlwZX0pLCBydW5VcHNlcnQsIHtkZWRpY2F0ZWRDb25uZWN0aW9uOiB0cnVlfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVja3Mgd2hldGhlciBhIHJvdXRlZCB1cHNlcnQgbXV0YXRpb24gY29uZmxpY3RzIHdpdGggdGhlIGN1cnJlbnQgc2VydmVyXG4gICAqIHN0YXRlIHdoZW4gdGhlIHNlcnZpY2UgaXMgY29uZmlndXJlZCB3aXRoIGEgY29uZmxpY3Qgc3RyYXRlZ3kuIEEgbXV0YXRpb25cbiAgICogd2hvc2UgYmFzZVZlcnNpb24gZG9lcyBub3QgbWF0Y2ggdGhlIHNlcnZlcidzIGN1cnJlbnQgdmVyc2lvbkF0dHJpYnV0ZSBpc1xuICAgKiByZWplY3RlZCB3aXRoIGEgc3RydWN0dXJlZCBjb25mbGljdCBwYXlsb2FkIGluc3RlYWQgb2YgYmVpbmcgYXBwbGllZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBDb25mbGljdC1jaGVjayBhcmdzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5hdHRyaWJ1dGVzIC0gUGVybWl0dGVkIG11dGF0aW9uIGF0dHJpYnV0ZXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQgfCBudWxsfSBhcmdzLmV4aXN0aW5nUmVjb3JkIC0gRXhpc3Rpbmcgc2VydmVyIHJlY29yZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3N5bmMtZW52ZWxvcGUtcmVwbGF5LXNlcnZpY2UuanNcIikuU3luY1JlcGxheU11dGF0aW9ufSBhcmdzLm11dGF0aW9uIC0gTm9ybWFsaXplZCByZXBsYXkgbXV0YXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWwtcmVzb3VyY2UvYmFzZS1yZXNvdXJjZS5qc1wiKS5kZWZhdWx0fSBhcmdzLnJlc291cmNlIC0gUm91dGVkIHJlc291cmNlIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBudWxsPn0gLSBDb25mbGljdCBhcHBseSByZXN1bHQsIG9yIG51bGwgd2hlbiBubyBjb25mbGljdC5cbiAgICovXG4gIGFzeW5jIHJvdXRlZFJlcGxheUNvbmZsaWN0UmVzdWx0KHthdHRyaWJ1dGVzLCBleGlzdGluZ1JlY29yZCwgbXV0YXRpb24sIHJlc291cmNlfSkge1xuICAgIGlmICghdGhpcy5jb25mbGljdFN0cmF0ZWd5KSByZXR1cm4gbnVsbFxuICAgIGlmICghZXhpc3RpbmdSZWNvcmQgfHwgbXV0YXRpb24uc3luY1R5cGUgPT09IFwiY3JlYXRlXCIpIHJldHVybiBudWxsXG4gICAgaWYgKG11dGF0aW9uLmJhc2VWZXJzaW9uID09PSB1bmRlZmluZWQgfHwgbXV0YXRpb24uYmFzZVZlcnNpb24gPT09IG51bGwpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCBNb2RlbENsYXNzID0gcmVzb3VyY2UubW9kZWxDbGFzcygpXG4gICAgY29uc3QgcHJpbWFyeUtleSA9IE1vZGVsQ2xhc3MucHJpbWFyeUtleSgpXG4gICAgY29uc3QgcHJpbWFyeUtleUF0dHJpYnV0ZSA9IE1vZGVsQ2xhc3MucmVzb2x2ZUF0dHJpYnV0ZU5hbWUocHJpbWFyeUtleSlcbiAgICBjb25zdCB2ZXJzaW9uQXR0cmlidXRlID0gdGhpcy5jb25mbGljdFN0cmF0ZWd5LnZlcnNpb25BdHRyaWJ1dGVcbiAgICBjb25zdCB2ZXJzaW9uQXR0cmlidXRlTmFtZSA9IE1vZGVsQ2xhc3MucmVzb2x2ZUF0dHJpYnV0ZU5hbWUodmVyc2lvbkF0dHJpYnV0ZSlcblxuICAgIGlmICghcHJpbWFyeUtleUF0dHJpYnV0ZSkgdGhyb3cgbmV3IEVycm9yKGBDb3VsZG4ndCByZXNvbHZlIHByaW1hcnkga2V5IGF0dHJpYnV0ZTogJHtwcmltYXJ5S2V5fWApXG4gICAgaWYgKCF2ZXJzaW9uQXR0cmlidXRlTmFtZSkgdGhyb3cgbmV3IEVycm9yKGBDb3VsZG4ndCByZXNvbHZlIHZlcnNpb24gYXR0cmlidXRlOiAke3ZlcnNpb25BdHRyaWJ1dGV9YClcblxuICAgIGNvbnN0IHNlcnZlclZlcnNpb24gPSBub3JtYWxpemVDb25mbGljdFZhbHVlKGV4aXN0aW5nUmVjb3JkLnJlYWRBdHRyaWJ1dGUodmVyc2lvbkF0dHJpYnV0ZU5hbWUpKVxuXG4gICAgaWYgKHN0YWJsZUpzb25TdHJpbmdpZnkoc2VydmVyVmVyc2lvbikgPT09IHN0YWJsZUpzb25TdHJpbmdpZnkobXV0YXRpb24uYmFzZVZlcnNpb24pKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3Qgc2VyaWFsaXplZEFmZmVjdGVkQXR0cmlidXRlcyA9IGF3YWl0IHRoaXMuc2VyaWFsaXplZFJvdXRlZENvbmZsaWN0QXR0cmlidXRlcyh7YXR0cmlidXRlcywgZXhpc3RpbmdSZWNvcmQsIHJlc291cmNlfSlcbiAgICBjb25zdCBzZXJ2ZXJBdHRyaWJ1dGVzID0ge1xuICAgICAgLi4uc2VyaWFsaXplZEFmZmVjdGVkQXR0cmlidXRlcyxcbiAgICAgIFtwcmltYXJ5S2V5QXR0cmlidXRlXTogZXhpc3RpbmdSZWNvcmQucmVhZEF0dHJpYnV0ZShwcmltYXJ5S2V5QXR0cmlidXRlKSxcbiAgICAgIFt2ZXJzaW9uQXR0cmlidXRlTmFtZV06IHNlcnZlclZlcnNpb25cbiAgICB9XG5cbiAgICBjb25zdCBzZXJ2ZXJSZWNvcmQgPSB7XG4gICAgICBhdHRyaWJ1dGVzOiBzZXJ2ZXJBdHRyaWJ1dGVzLFxuICAgICAgdmVyc2lvbjogc2VydmVyVmVyc2lvblxuICAgIH1cbiAgICBjb25zdCBjb25mbGljdE11dGF0aW9uID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuL2RldmljZS1pZGVudGl0eS5qc1wiKS5TeW5jTXV0YXRpb259ICovICgvKiogQHR5cGUge3Vua25vd259ICovICh7XG4gICAgICBhdHRyaWJ1dGVzLFxuICAgICAgYmFzZVZlcnNpb246IG11dGF0aW9uLmJhc2VWZXJzaW9uLFxuICAgICAgY2xpZW50TXV0YXRpb25JZDogbXV0YXRpb24uY2xpZW50TXV0YXRpb25JZCB8fCBtdXRhdGlvbi5pZCxcbiAgICAgIG1vZGVsOiBtdXRhdGlvbi5yZXNvdXJjZVR5cGUsXG4gICAgICBvcGVyYXRpb246IG11dGF0aW9uLnN5bmNUeXBlLFxuICAgICAgcGF5bG9hZDoge2lkOiBtdXRhdGlvbi5yZXNvdXJjZUlkfVxuICAgIH0pKVxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHJlc29sdmVTeW5jQ29uZmxpY3Qoe1xuICAgICAgYmFzZVJlY29yZDogbnVsbCxcbiAgICAgIG11dGF0aW9uOiBjb25mbGljdE11dGF0aW9uLFxuICAgICAgc2VydmVyUmVjb3JkLFxuICAgICAgc3RyYXRlZ3k6IHRoaXMuY29uZmxpY3RTdHJhdGVneS5zdHJhdGVneSB8fCBcIm9wdGltaXN0aWNWZXJzaW9uXCIsXG4gICAgICB2ZXJzaW9uQXR0cmlidXRlXG4gICAgfSlcblxuICAgIGlmIChyZXN1bHQuc3RhdHVzICE9PSBcImNvbmZsaWN0XCIpIHJldHVybiBudWxsXG5cbiAgICByZXR1cm4ge2NvbmZsaWN0OiByZXN1bHQuY29uZmxpY3QsIGNyZWF0ZWQ6IGZhbHNlLCBkZWxldGVkOiBmYWxzZSwgcmVjb3JkOiBleGlzdGluZ1JlY29yZCwgc3RhdHVzOiBcImNvbmZsaWN0XCJ9XG4gIH1cblxuICAvKipcbiAgICogUHJvamVjdHMgYWZmZWN0ZWQgbXV0YXRpb24gZmllbGRzIHRocm91Z2ggdGhlIHJlc291cmNlJ3MgcmVhZGFibGVcbiAgICogYXR0cmlidXRlIGNvbnRyYWN0LiBXcml0YWJsZS1idXQtaGlkZGVuIGZpZWxkcyBhcmUgb21pdHRlZCwgd2hpbGUgY3VzdG9tXG4gICAqIGA8YXR0cmlidXRlPkF0dHJpYnV0ZShtb2RlbClgIHNlcmlhbGl6ZXJzIGFuZCBtb2RlbCBhY2Nlc3NvcnMgcmVtYWluIHRoZVxuICAgKiBzb3VyY2Ugb2YgZnJvbnRlbmQtdmlzaWJsZSB2YWx1ZXMgKERhdGUgdmFsdWVzIGFyZSBrZXB0IHJhdyBzbyB0aGUgbm9ybWFsXG4gICAqIGZyb250ZW5kLW1vZGVsIHRyYW5zcG9ydCBzZXJpYWxpemVyIGNhbiBlbWl0IGl0cyBkYXRlIG1hcmtlcikuIFByb2plY3RlZFxuICAgKiBrZXlzIHVzZSBjYW5vbmljYWwgbW9kZWwgYXR0cmlidXRlIG5hbWVzIGV2ZW4gd2hlbiB0aGUgbXV0YXRpb24gdXNlZCBhXG4gICAqIGRhdGFiYXNlLWNvbHVtbiBhbGlhcy4gVGhlIGZ1bGwgbW9kZWwgYXR0cmlidXRlIGhhc2ggaXMgbmV2ZXIgZXhwb3NlZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBQcm9qZWN0aW9uIGFyZ3MuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmF0dHJpYnV0ZXMgLSBQZXJtaXR0ZWQgYWZmZWN0ZWQgbXV0YXRpb24gYXR0cmlidXRlcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5leGlzdGluZ1JlY29yZCAtIEF1dGhvcml6ZWQgc2VydmVyIHJlY29yZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9mcm9udGVuZC1tb2RlbC1yZXNvdXJjZS9iYXNlLXJlc291cmNlLmpzXCIpLmRlZmF1bHR9IGFyZ3MucmVzb3VyY2UgLSBSb3V0ZWQgcmVzb3VyY2UgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IFNlcmlhbGl6ZWQgcmVhZGFibGUgYWZmZWN0ZWQgYXR0cmlidXRlcy5cbiAgICovXG4gIGFzeW5jIHNlcmlhbGl6ZWRSb3V0ZWRDb25mbGljdEF0dHJpYnV0ZXMoe2F0dHJpYnV0ZXMsIGV4aXN0aW5nUmVjb3JkLCByZXNvdXJjZX0pIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gcmVzb3VyY2UubW9kZWxDbGFzcygpXG4gICAgY29uc3QgUmVzb3VyY2VDbGFzcyA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGV9ICovIChyZXNvdXJjZS5jb25zdHJ1Y3RvcilcbiAgICBjb25zdCByZWFkYWJsZUF0dHJpYnV0ZXMgPSBuZXcgU2V0KClcbiAgICBjb25zdCBjb25maWd1cmVkQXR0cmlidXRlcyA9IFJlc291cmNlQ2xhc3MucmVzb3VyY2VDb25maWcoKS5hdHRyaWJ1dGVzXG4gICAgY29uc3QgY29uZmlndXJlZEVudHJpZXMgPSBBcnJheS5pc0FycmF5KGNvbmZpZ3VyZWRBdHRyaWJ1dGVzKSA/IGNvbmZpZ3VyZWRBdHRyaWJ1dGVzIDogT2JqZWN0LmtleXMoY29uZmlndXJlZEF0dHJpYnV0ZXMpXG5cbiAgICBpZiAoY29uZmlndXJlZEVudHJpZXMubGVuZ3RoID09PSAwKSB7XG4gICAgICBjb25zdCBhdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lID0gTW9kZWxDbGFzcy5nZXRBdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lTWFwKClcblxuICAgICAgZm9yIChjb25zdCBhdHRyaWJ1dGVOYW1lIG9mIE9iamVjdC5rZXlzKGF0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWUpKSB7XG4gICAgICAgIHJlYWRhYmxlQXR0cmlidXRlcy5hZGQoYXR0cmlidXRlTmFtZSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGNvbmZpZ3VyZWRBdHRyaWJ1dGUgb2YgY29uZmlndXJlZEVudHJpZXMpIHtcbiAgICAgIGNvbnN0IGNvbmZpZ3VyZWROYW1lID0gdHlwZW9mIGNvbmZpZ3VyZWRBdHRyaWJ1dGUgPT09IFwic3RyaW5nXCIgPyBjb25maWd1cmVkQXR0cmlidXRlIDogY29uZmlndXJlZEF0dHJpYnV0ZS5uYW1lXG5cbiAgICAgIGlmICghY29uZmlndXJlZE5hbWUpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IGNhbm9uaWNhbE5hbWUgPSBNb2RlbENsYXNzLnJlc29sdmVBdHRyaWJ1dGVOYW1lKGNvbmZpZ3VyZWROYW1lKVxuXG4gICAgICByZWFkYWJsZUF0dHJpYnV0ZXMuYWRkKGNhbm9uaWNhbE5hbWUgfHwgY29uZmlndXJlZE5hbWUpXG4gICAgfVxuXG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3Qgc2VyaWFsaXplZEF0dHJpYnV0ZXMgPSB7fVxuXG4gICAgZm9yIChjb25zdCBhZmZlY3RlZEZpZWxkIG9mIE9iamVjdC5rZXlzKGF0dHJpYnV0ZXMpKSB7XG4gICAgICBjb25zdCBhdHRyaWJ1dGVOYW1lID0gTW9kZWxDbGFzcy5yZXNvbHZlQXR0cmlidXRlTmFtZShhZmZlY3RlZEZpZWxkKVxuXG4gICAgICBpZiAoIWF0dHJpYnV0ZU5hbWUgfHwgIXJlYWRhYmxlQXR0cmlidXRlcy5oYXMoYXR0cmlidXRlTmFtZSkpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IHJlc291cmNlQXR0cmlidXRlID0gcmVzb3VyY2UucmVzb3VyY2VNZXRob2QoYCR7YXR0cmlidXRlTmFtZX1BdHRyaWJ1dGVgKVxuXG4gICAgICBpZiAocmVzb3VyY2VBdHRyaWJ1dGUpIHtcbiAgICAgICAgc2VyaWFsaXplZEF0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV0gPSBhd2FpdCByZXNvdXJjZUF0dHJpYnV0ZS5tZXRob2QuY2FsbChyZXNvdXJjZUF0dHJpYnV0ZS5yZXNvdXJjZSwgZXhpc3RpbmdSZWNvcmQpXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHJlY29yZE1ldGhvZHMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKC8qKiBAdHlwZSB7dW5rbm93bn0gKi8gKGV4aXN0aW5nUmVjb3JkKSlcbiAgICAgIGNvbnN0IGF0dHJpYnV0ZU1ldGhvZCA9IHJlY29yZE1ldGhvZHNbYXR0cmlidXRlTmFtZV1cblxuICAgICAgaWYgKHR5cGVvZiBhdHRyaWJ1dGVNZXRob2QgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICBzZXJpYWxpemVkQXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXSA9IGF3YWl0IGF0dHJpYnV0ZU1ldGhvZC5jYWxsKGV4aXN0aW5nUmVjb3JkKVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgc2VyaWFsaXplZEF0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV0gPSBleGlzdGluZ1JlY29yZC5yZWFkQXR0cmlidXRlKGF0dHJpYnV0ZU5hbWUpXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHNlcmlhbGl6ZWRBdHRyaWJ1dGVzXG4gIH1cblxuICAvKipcbiAgICogRmlsdGVycyBhIHJvdXRlZCBtdXRhdGlvbiBwYXlsb2FkIGRvd24gdG8gdGhlIHJlc291cmNlJ3MgZGVjbGFyZWRcbiAgICogd3JpdGFibGUtYXR0cmlidXRlIHBlcm1pdCBsaXN0LiBBY2NlcHRlZCBrZXlzIHBlciBwZXJtaXR0ZWQgYXR0cmlidXRlIGFyZVxuICAgKiB0aGUgY2FtZWxDYXNlIGF0dHJpYnV0ZSBuYW1lIHBsdXMgdGhlIG1vZGVsJ3MgYWN0dWFsIGNvbHVtbiBuYW1lOyB1bmtub3duXG4gICAqIGtleXMgZmFpbCB0aGUgc3luYyBsb3VkbHkuIFRoZSBwcmltYXJ5IGtleSBpcyBkcm9wcGVkIHdoZW4gcGVybWl0dGVkXG4gICAqIChzbmFwc2hvdCBwYXlsb2Fkcykg4oCUIHRoZSBlbnZlbG9wZSdzIHJlc291cmNlSWQgaXMgdGhlIGF1dGhvcml0YXRpdmVcbiAgICogcmVjb3JkIGlkZW50aXR5LCBzbyBhIHBheWxvYWQgaWQgY2FuIG5ldmVyIHJldGFyZ2V0IHRoZSByb3cuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3N5bmMtZW52ZWxvcGUtcmVwbGF5LXNlcnZpY2UuanNcIikuU3luY1JlcGxheU11dGF0aW9ufSBhcmdzLm11dGF0aW9uIC0gTm9ybWFsaXplZCByZXBsYXkgbXV0YXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWwtcmVzb3VyY2UvYmFzZS1yZXNvdXJjZS5qc1wiKS5kZWZhdWx0fSBhcmdzLnJlc291cmNlIC0gUm91dGVkIHJlc291cmNlIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBQZXJtaXR0ZWQgYXR0cmlidXRlcyBmb3IgcmVjb3JkLmFzc2lnbi5cbiAgICovXG4gIHBlcm1pdHRlZFJvdXRlZEF0dHJpYnV0ZXMoe211dGF0aW9uLCByZXNvdXJjZX0pIHtcbiAgICBjb25zdCBwZXJtaXR0ZWRBdHRyaWJ1dGVzID0gcmVzb3VyY2UuZGVjbGFyZWRXcml0YWJsZUF0dHJpYnV0ZXMoKVxuXG4gICAgaWYgKCFwZXJtaXR0ZWRBdHRyaWJ1dGVzKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7cmVzb3VyY2UuY29uc3RydWN0b3IubmFtZX0gbXVzdCBkZWNsYXJlIHN0YXRpYyB3cml0YWJsZUF0dHJpYnV0ZXMgdG8gYXBwbHkgcm91dGVkIHN5bmMgbXV0YXRpb25zIGZvcjogJHttdXRhdGlvbi5yZXNvdXJjZVR5cGV9YClcbiAgICB9XG5cbiAgICBjb25zdCBNb2RlbENsYXNzID0gcmVzb3VyY2UubW9kZWxDbGFzcygpXG4gICAgY29uc3QgYXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZSA9IE1vZGVsQ2xhc3MuZ2V0QXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZU1hcCgpXG5cbiAgICAvKiogQHR5cGUge1NldDxzdHJpbmc+fSAqL1xuICAgIGNvbnN0IGFsbG93ZWRLZXlzID0gbmV3IFNldCgpXG5cbiAgICBmb3IgKGNvbnN0IGF0dHJpYnV0ZU5hbWUgb2YgcGVybWl0dGVkQXR0cmlidXRlcykge1xuICAgICAgYWxsb3dlZEtleXMuYWRkKGF0dHJpYnV0ZU5hbWUpXG5cbiAgICAgIGNvbnN0IGNvbHVtbk5hbWUgPSBhdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lW2F0dHJpYnV0ZU5hbWVdXG5cbiAgICAgIGlmIChjb2x1bW5OYW1lKSBhbGxvd2VkS2V5cy5hZGQoY29sdW1uTmFtZSlcbiAgICB9XG5cbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gTW9kZWxDbGFzcy5wcmltYXJ5S2V5KClcbiAgICBjb25zdCBwcmltYXJ5S2V5QXR0cmlidXRlID0gTW9kZWxDbGFzcy5nZXRDb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lTWFwKClbcHJpbWFyeUtleV1cblxuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IGF0dHJpYnV0ZXMgPSB7fVxuXG4gICAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMobXV0YXRpb24uZGF0YSkpIHtcbiAgICAgIGlmICghYWxsb3dlZEtleXMuaGFzKGtleSkpIHtcbiAgICAgICAgdGhyb3cgcmVzb3VyY2Uud3JpdGFibGVBdHRyaWJ1dGVFcnJvcihgVW5rbm93biBhdHRyaWJ1dGU6ICR7a2V5fS5gLCB7Y29kZTogXCJzeW5jLXVua25vd24tYXR0cmlidXRlXCJ9KVxuICAgICAgfVxuXG4gICAgICBpZiAoa2V5ID09PSBwcmltYXJ5S2V5IHx8IGtleSA9PT0gcHJpbWFyeUtleUF0dHJpYnV0ZSkgY29udGludWVcblxuICAgICAgYXR0cmlidXRlc1trZXldID0gdmFsdWVcbiAgICB9XG5cbiAgICByZXR1cm4gYXR0cmlidXRlc1xuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZXMgdGhlIHJvdXRlZCByZWNvcmQgd2l0aCB0aGUgY2xpZW50LWdlbmVyYXRlZCBwcmltYXJ5IGtleSAobWFya2VkXG4gICAqIGFzIGEgc2VydmVyIGFwcGx5IGZvciB0aGUgZHVyYXRpb24gb2YgdGhlIGNyZWF0ZSAtIGluY2x1ZGluZyB0aGVcbiAgICogbWVtYmVyc2hpcC1jaGVjayBjb21wZW5zYXRpb24gZGVzdHJveSAtIHNvIGFuIGFjdGl2ZSBTeW5jUHVibGlzaGVyIG5ldmVyXG4gICAqIHB1Ymxpc2hlcyB0aGUgcmVwbGF5ZWQgY3JlYXRlIGEgc2Vjb25kIHRpbWUpLCB0aGVuXG4gICAqIHZlcmlmaWVzIGNyZWF0ZS1zY29wZSBtZW1iZXJzaGlwIHdoZW4gYW4gYWJpbGl0eSBpcyBjb25maWd1cmVkOiByZWNvcmRzXG4gICAqIG91dHNpZGUgdGhlIGFiaWxpdHkncyBjcmVhdGUgc2NvcGUgYXJlIGRlc3Ryb3llZCBhZ2FpbiBhbmQgZmFpbCB0aGUgc3luY1xuICAgKiB3aXRoIHRoZSByZXNvdXJjZS1kZWNsYXJlZCByZWFzb24uIEEgcmVjb3JkIHRoYXQgYWxyZWFkeSBleGlzdHMgb3V0c2lkZVxuICAgKiB0aGUgcmVzb3VyY2UncyBsb29rdXAgc2NvcGUgZmFpbHMgdGhlIHN5bmMgYXMgYW4gYXV0aG9yaXphdGlvbiBkZW5pYWxcbiAgICogaW5zdGVhZCBvZiBjb2xsaWRpbmcgb24gdGhlIHByaW1hcnkga2V5LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmF0dHJpYnV0ZXMgLSBQZXJtaXR0ZWQgcGF5bG9hZCBhdHRyaWJ1dGVzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vc3luYy1lbnZlbG9wZS1yZXBsYXktc2VydmljZS5qc1wiKS5TeW5jUmVwbGF5TXV0YXRpb259IGFyZ3MubXV0YXRpb24gLSBOb3JtYWxpemVkIHJlcGxheSBtdXRhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9mcm9udGVuZC1tb2RlbC1yZXNvdXJjZS9iYXNlLXJlc291cmNlLmpzXCIpLmRlZmF1bHR9IGFyZ3MucmVzb3VyY2UgLSBSb3V0ZWQgcmVzb3VyY2UgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Pn0gQ3JlYXRlZCByZWNvcmQuXG4gICAqL1xuICBhc3luYyBjcmVhdGVSb3V0ZWRSZXBsYXlSZWNvcmQoe2F0dHJpYnV0ZXMsIG11dGF0aW9uLCByZXNvdXJjZX0pIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gcmVzb3VyY2UubW9kZWxDbGFzcygpXG4gICAgY29uc3QgcHJpbWFyeUtleSA9IE1vZGVsQ2xhc3MucHJpbWFyeUtleSgpXG4gICAgY29uc3QgY29uZmxpY3RpbmdJZHMgPSBhd2FpdCBNb2RlbENsYXNzLndoZXJlKHtbcHJpbWFyeUtleV06IG11dGF0aW9uLnJlc291cmNlSWR9KS5wbHVjayhwcmltYXJ5S2V5KVxuXG4gICAgaWYgKGNvbmZsaWN0aW5nSWRzLmxlbmd0aCA+IDApIHtcbiAgICAgIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoYFN5bmMgdXBkYXRlIGRlbmllZCBmb3I6ICR7bXV0YXRpb24ucmVzb3VyY2VUeXBlfS5gLCB7XG4gICAgICAgIGNvZGU6IHJlc291cmNlLnN5bmNBdXRob3JpemF0aW9uRmFpbHVyZVJlYXNvbih7YWN0aW9uOiBcInVwZGF0ZVwiLCBtdXRhdGlvbn0pIHx8IFwiYWNjZXNzLWRlbmllZFwiXG4gICAgICB9KVxuICAgIH1cblxuICAgIGF3YWl0IE1vZGVsQ2xhc3MuZW5zdXJlSW5pdGlhbGl6ZWQoKVxuXG4gICAgY29uc3QgcmVjb3JkID0gbmV3IE1vZGVsQ2xhc3Moe1twcmltYXJ5S2V5XTogbXV0YXRpb24ucmVzb3VyY2VJZCwgLi4uYXR0cmlidXRlc30pXG4gICAgY29uc3QgcmVsZWFzZVNlcnZlckFwcGx5ID0gbWFya1NlcnZlckFwcGx5KHJlY29yZClcblxuICAgIHRyeSB7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCByZWNvcmQuc2F2ZSgpXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICB0aHJvdyB0aGlzLnJvdXRlZFJlcGxheVNhdmVFcnJvcihlcnJvcilcbiAgICAgIH1cblxuICAgICAgY29uc3QgYWJpbGl0eSA9IHJlc291cmNlLmFiaWxpdHlcblxuICAgICAgaWYgKGFiaWxpdHkpIHtcbiAgICAgICAgY29uc3QgbWVtYmVySWRzID0gYXdhaXQgTW9kZWxDbGFzc1xuICAgICAgICAgIC5hY2Nlc3NpYmxlRm9yKHJlc291cmNlLnN5bmNBYmlsaXR5QWN0aW9uKFwiY3JlYXRlXCIpLCBhYmlsaXR5KVxuICAgICAgICAgIC53aGVyZSh7W3ByaW1hcnlLZXldOiByZWNvcmQuaWQoKX0pXG4gICAgICAgICAgLnBsdWNrKHByaW1hcnlLZXkpXG5cbiAgICAgICAgaWYgKG1lbWJlcklkcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICBhd2FpdCByZWNvcmQuZGVzdHJveSgpXG5cbiAgICAgICAgICB0aHJvdyBWZWxvY2lvdXNFcnJvci5zYWZlKGBTeW5jIGNyZWF0ZSBkZW5pZWQgZm9yOiAke211dGF0aW9uLnJlc291cmNlVHlwZX0uYCwge1xuICAgICAgICAgICAgY29kZTogcmVzb3VyY2Uuc3luY0F1dGhvcml6YXRpb25GYWlsdXJlUmVhc29uKHthY3Rpb246IFwiY3JlYXRlXCIsIG11dGF0aW9ufSkgfHwgXCJhY2Nlc3MtZGVuaWVkXCJcbiAgICAgICAgICB9KVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHJldHVybiByZWNvcmRcbiAgICB9IGZpbmFsbHkge1xuICAgICAgcmVsZWFzZVNlcnZlckFwcGx5KClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogU2F2ZXMgYSByb3V0ZWQgcmVjb3JkLCBjb252ZXJ0aW5nIG1vZGVsIHZhbGlkYXRpb24gZmFpbHVyZXMgaW50b1xuICAgKiBjbGllbnQtc2FmZSBwZXItc3luYyBlcnJvcnMgY2FycnlpbmcgdGhlIHRyYW5zbGF0ZWQgdmFsaWRhdGlvbiBtZXNzYWdlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSByZWNvcmQgLSBSZWNvcmQgdG8gc2F2ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIHdoZW4gc2F2ZWQuXG4gICAqL1xuICBhc3luYyBzYXZlUm91dGVkUmVwbGF5UmVjb3JkKHJlY29yZCkge1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCByZWNvcmQuc2F2ZSgpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRocm93IHRoaXMucm91dGVkUmVwbGF5U2F2ZUVycm9yKGVycm9yKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBNYXBzIGEgcm91dGVkIHNhdmUvY3JlYXRlIGZhaWx1cmU6IG1vZGVsIHZhbGlkYXRpb24gZXJyb3JzIGJlY29tZVxuICAgKiBjbGllbnQtc2FmZSBlcnJvcnMgd2l0aCB0aGVpciB0cmFuc2xhdGVkIG1lc3NhZ2VzLCBldmVyeXRoaW5nIGVsc2VcbiAgICogcHJvcGFnYXRlcyB1bmNoYW5nZWQuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGVycm9yIC0gVGhyb3duIHNhdmUvY3JlYXRlIGVycm9yLlxuICAgKiBAcmV0dXJucyB7RXJyb3J9IEVycm9yIHRvIHJldGhyb3cuXG4gICAqL1xuICByb3V0ZWRSZXBsYXlTYXZlRXJyb3IoZXJyb3IpIHtcbiAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBWYWxpZGF0aW9uRXJyb3IpIHtcbiAgICAgIHJldHVybiBWZWxvY2lvdXNFcnJvci5zYWZlKGVycm9yLm1lc3NhZ2UsIHtjYXVzZTogZXJyb3IsIGNvZGU6IFwidmFsaWRhdGlvbi1lcnJvclwifSlcbiAgICB9XG5cbiAgICByZXR1cm4gLyoqIEB0eXBlIHtFcnJvcn0gKi8gKGVycm9yKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGFuIGFwcGx5IHJlc3VsdCBmb3Igc3RhbGUgbXV0YXRpb25zIHRoYXQgc2hvdWxkIG5vdCB0b3VjaCBkb21haW4gbW9kZWxzLlxuICAgKiBFeGFjdCBkdXBsaWNhdGVzIHJlc29sdmUgdGhlIGN1cnJlbnQgcm91dGVkIHJlY29yZCBzbyB0aGUgYWNrbm93bGVkZ2VtZW50XG4gICAqIGNhbiBpbmNsdWRlIGl0cyBhdXRob3JpdGF0aXZlIHZlcnNpb24gd2l0aG91dCBhcHBseWluZyB0aGUgbXV0YXRpb24gYWdhaW4uXG4gICAqIEBwYXJhbSB7e2FjdG9yOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgY29udGV4dDogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBleGlzdGluZ1N5bmM6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBtdXRhdGlvbjogaW1wb3J0KFwiLi9zeW5jLWVudmVsb3BlLXJlcGxheS1zZXJ2aWNlLmpzXCIpLlN5bmNSZXBsYXlNdXRhdGlvbn19IGFyZ3MgLSBBY3RvciwgYmF0Y2ggY29udGV4dCwgZXhpc3Rpbmcgc3luYyByb3csIGFuZCBtdXRhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBQcm9qZWN0LXNwZWNpZmljIGFwcGx5IHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHNraXBwZWRSZXBsYXlNdXRhdGlvbih7YWN0b3IsIGNvbnRleHQsIGV4aXN0aW5nU3luYywgbXV0YXRpb259KSB7XG4gICAgaWYgKCF0aGlzLmlzRHVwbGljYXRlUmVwbGF5TXV0YXRpb24oe2V4aXN0aW5nU3luYywgbXV0YXRpb259KSB8fCAhdGhpcy5yb3V0aW5nQ29uZmlndXJlZCgpKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgcmVnaXN0cmF0aW9uID0gdGhpcy5yZXBsYXlSZXNvdXJjZVJlZ2lzdHJhdGlvbihtdXRhdGlvbi5yZXNvdXJjZVR5cGUpXG5cbiAgICBpZiAoIXJlZ2lzdHJhdGlvbikgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IHJlc291cmNlID0gYXdhaXQgdGhpcy5idWlsZFJlcGxheVJlc291cmNlKHthY3RvciwgY29udGV4dCwgbXV0YXRpb24sIHJlZ2lzdHJhdGlvbn0pXG4gICAgY29uc3QgcmVjb3JkID0gYXdhaXQgcmVzb3VyY2UuZmluZFN5bmNSZWNvcmQoe2ZvckRlbGV0ZTogbXV0YXRpb24uc3luY1R5cGUgPT09IFwiZGVsZXRlXCIsIG11dGF0aW9ufSlcblxuICAgIHJldHVybiB7Y3JlYXRlZDogZmFsc2UsIGRlbGV0ZWQ6IGZhbHNlLCBkdXBsaWNhdGU6IHRydWUsIHJlY29yZH1cbiAgfVxuXG4gIC8qKlxuICAgKiBQZXJzaXN0cyBvbmUgbm9ybWFsaXplZCBtdXRhdGlvbiBpbnRvIHRoZSBhcHAgc3luYy9jaGFuZ2Ugc3RvcmUuXG4gICAqXG4gICAqIERlZmF1bHRzIHRvIGEgc3RhbGUtZ3VhcmRlZCBzeW5jLW1vZGVsIHVwc2VydCAod2l0aCBzZXJ2ZXIgcmUtc2VxdWVuY2luZyBvblxuICAgKiB1cGRhdGVzKSB3aGVuIGEgc3luYyBtb2RlbCBpcyBjb25maWd1cmVkOyBvdGhlcndpc2UgYXBwcyBvdmVycmlkZSB0aGlzIGhvb2suXG4gICAqIEBwYXJhbSB7e2FjdG9yOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgY29udGV4dDogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBleGlzdGluZ1N5bmM6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBhcHBseVJlc3VsdDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIG11dGF0aW9uOiBpbXBvcnQoXCIuL3N5bmMtZW52ZWxvcGUtcmVwbGF5LXNlcnZpY2UuanNcIikuU3luY1JlcGxheU11dGF0aW9uLCBzaG91bGRBcHBseTogYm9vbGVhbn19IGFyZ3MgLSBSZXBsYXkgcGVyc2lzdGVuY2UgYXJndW1lbnRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIHBlcnNpc3RSZXBsYXlNdXRhdGlvbih7YWN0b3IsIGFwcGx5UmVzdWx0LCBjb250ZXh0LCBleGlzdGluZ1N5bmMsIG11dGF0aW9uLCBzaG91bGRBcHBseX0pIHtcbiAgICBpZiAoIXRoaXMuc3luY01vZGVsKSByZXR1cm5cblxuICAgIGNvbnN0IGF0dHJpYnV0ZXMgPSB0aGlzLnJlcGxheVBlcnNpc3RBdHRyaWJ1dGVzKHthY3RvciwgbXV0YXRpb259KVxuXG4gICAgLy8gU3RhbGUgcmVwbGF5cyBuZXZlciBhcHBsaWVkIGFueXRoaW5nLCBzbyB0aGUgYXBwbHlSZXN1bHQtZHJpdmVuIGV4dGVuc2lvblxuICAgIC8vIGhvb2tzIG11c3Qgbm90IHJ1biBhZ2FpbnN0IHRoZSBkZWZhdWx0IG51bGwgc2tpcHBlZCByZXN1bHQuXG4gICAgaWYgKHRoaXMucGVyc2lzdEV4dHJhQXR0cmlidXRlcyAmJiBzaG91bGRBcHBseSkge1xuICAgICAgT2JqZWN0LmFzc2lnbihhdHRyaWJ1dGVzLCB0aGlzLnBlcnNpc3RFeHRyYUF0dHJpYnV0ZXMoe2FjdG9yLCBhcHBseVJlc3VsdCwgY29udGV4dCwgZXhpc3RpbmdTeW5jLCBtdXRhdGlvbiwgc2hvdWxkQXBwbHl9KSlcbiAgICB9XG5cbiAgICBpZiAodGhpcy5wZXJzaXN0U2VyaWFsaXplZERhdGEgJiYgc2hvdWxkQXBwbHkpIHtcbiAgICAgIGNvbnN0IHNlcmlhbGl6ZWREYXRhID0gdGhpcy5wZXJzaXN0U2VyaWFsaXplZERhdGEoe2FwcGx5UmVzdWx0LCBtdXRhdGlvbn0pXG5cbiAgICAgIGlmIChzZXJpYWxpemVkRGF0YSAhPT0gdW5kZWZpbmVkICYmIHNlcmlhbGl6ZWREYXRhICE9PSBudWxsKSB7XG4gICAgICAgIGF0dHJpYnV0ZXMuZGF0YSA9IHR5cGVvZiBzZXJpYWxpemVkRGF0YSA9PT0gXCJzdHJpbmdcIiA/IHNlcmlhbGl6ZWREYXRhIDogSlNPTi5zdHJpbmdpZnkoc2VyaWFsaXplZERhdGEpXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuY29uZmxpY3RTdHJhdGVneSAmJiBzaG91bGRBcHBseSAmJiBtdXRhdGlvbi5iYXNlVmVyc2lvbiAhPT0gdW5kZWZpbmVkICYmIGFwcGx5UmVzdWx0Py5yZWNvcmQpIHtcbiAgICAgIGNvbnN0IHB1YmxpY1BheWxvYWQgPSBkZWNvZGVSZXBsYXlQZXJzaXN0ZWREYXRhKGF0dHJpYnV0ZXMuZGF0YSkucGF5bG9hZFxuICAgICAgY29uc3QgYWNrbm93bGVkZ2VtZW50VmVyc2lvbiA9IG5vcm1hbGl6ZUNvbmZsaWN0VmFsdWUoYXBwbHlSZXN1bHQucmVjb3JkLnJlYWRBdHRyaWJ1dGUodGhpcy5jb25mbGljdFN0cmF0ZWd5LnZlcnNpb25BdHRyaWJ1dGUpKVxuXG4gICAgICBhdHRyaWJ1dGVzLmRhdGEgPSBzZXJpYWxpemVSZXBsYXlQZXJzaXN0ZWREYXRhKHtcbiAgICAgICAgYWNrbm93bGVkZ2VtZW50VmVyc2lvbixcbiAgICAgICAgY2xpZW50TXV0YXRpb25JZDogU3RyaW5nKG11dGF0aW9uLmNsaWVudE11dGF0aW9uSWQgfHwgbXV0YXRpb24uaWQpLFxuICAgICAgICBwYXlsb2FkOiBwdWJsaWNQYXlsb2FkLFxuICAgICAgICBwYXlsb2FkRmluZ2VycHJpbnQ6IHNoYTI1NkhleChtdXRhdGlvbi5zZXJpYWxpemVkRGF0YSlcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgaWYgKGV4aXN0aW5nU3luYykge1xuICAgICAgY29uc3QgZXhpc3RpbmdDbGllbnRVcGRhdGVkQXQgPSB0aGlzLmV4aXN0aW5nUmVwbGF5U3luY0NsaWVudFVwZGF0ZWRBdChleGlzdGluZ1N5bmMpXG5cbiAgICAgIGlmIChleGlzdGluZ0NsaWVudFVwZGF0ZWRBdCAmJiBtdXRhdGlvbi5jbGllbnRVcGRhdGVkQXQgPD0gZXhpc3RpbmdDbGllbnRVcGRhdGVkQXQpIHJldHVyblxuICAgIH1cblxuICAgIGF3YWl0IHVwc2VydFN5bmNSb3coe2F0dHJpYnV0ZXMsIGV4aXN0aW5nU3luYywgc3luY01vZGVsOiB0aGlzLnN5bmNNb2RlbH0pXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSBzeW5jLW1vZGVsIGF0dHJpYnV0ZXMgcGVyc2lzdGVkIGJ5IHRoZSBtb2RlbC1iYWNrZWQgZGVmYXVsdC5cbiAgICogQHBhcmFtIHt7YWN0b3I6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBtdXRhdGlvbjogaW1wb3J0KFwiLi9zeW5jLWVudmVsb3BlLXJlcGxheS1zZXJ2aWNlLmpzXCIpLlN5bmNSZXBsYXlNdXRhdGlvbn19IGFyZ3MgLSBBY3RvciBhbmQgbXV0YXRpb24uXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IFN5bmMgcm93IGF0dHJpYnV0ZXMuXG4gICAqL1xuICByZXBsYXlQZXJzaXN0QXR0cmlidXRlcyh7YWN0b3IsIG11dGF0aW9ufSkge1xuICAgIHJldHVybiB7XG4gICAgICBbdGhpcy5hY3RvckZvcmVpZ25LZXlDb2x1bW5dOiB0aGlzLnJlcGxheUFjdG9ySWQoYWN0b3IpLFxuICAgICAgY2xpZW50X3VwZGF0ZWRfYXQ6IG11dGF0aW9uLmNsaWVudFVwZGF0ZWRBdCxcbiAgICAgIGRhdGE6IG11dGF0aW9uLnNlcmlhbGl6ZWREYXRhLFxuICAgICAgcmVzb3VyY2VfaWQ6IG11dGF0aW9uLnJlc291cmNlSWQsXG4gICAgICByZXNvdXJjZV90eXBlOiBtdXRhdGlvbi5yZXNvdXJjZVR5cGUsXG4gICAgICBzeW5jX3R5cGU6IG11dGF0aW9uLnN5bmNUeXBlXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2lkZSBlZmZlY3RzIGFmdGVyIGEgc3VjY2Vzc2Z1bCBtdXRhdGlvbiByZXBsYXkgYW5kIHBlcnNpc3RlbmNlLlxuICAgKlxuICAgKiBEZWZhdWx0cyB0byBmYW5uaW5nIHRoZSBhcHBsaWVkIHJlc3VsdCBvdXQgdGhyb3VnaCB0aGUgY29uZmlndXJlZFxuICAgKiBkZWNsYXJhdGl2ZSBicm9hZGNhc3RzLlxuICAgKiBAcGFyYW0ge3thY3RvcjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGNvbnRleHQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgZXhpc3RpbmdTeW5jOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgYXBwbHlSZXN1bHQ6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBtdXRhdGlvbjogaW1wb3J0KFwiLi9zeW5jLWVudmVsb3BlLXJlcGxheS1zZXJ2aWNlLmpzXCIpLlN5bmNSZXBsYXlNdXRhdGlvbiwgc2hvdWxkQXBwbHk6IGJvb2xlYW59fSBhcmdzIC0gUmVwbGF5IHNpZGUtZWZmZWN0IGFyZ3VtZW50cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBhZnRlclJlcGxheU11dGF0aW9uKGFyZ3MpIHtcbiAgICBpZiAoIXRoaXMuYnJvYWRjYXN0cyB8fCAhdGhpcy5icm9hZGNhc3RlcikgcmV0dXJuXG4gICAgLy8gU3RhbGUgcmVwbGF5cyBuZXZlciBhcHBsaWVkIGFueXRoaW5nIC0gYnJvYWRjYXN0aW5nIHRoZWlyIHNraXBwZWQgcmVzdWx0c1xuICAgIC8vIHdvdWxkIGZhbiBvdXQgc3RhbGUgc2lkZSBlZmZlY3RzIChvciBjcmFzaCBvbiB0aGUgZGVmYXVsdCBudWxsIGFwcGx5UmVzdWx0KS5cbiAgICBpZiAoIWFyZ3Muc2hvdWxkQXBwbHkpIHJldHVyblxuXG4gICAgYXdhaXQgZGVsaXZlckRlY2xhcmVkQnJvYWRjYXN0cyh7YXJncywgYnJvYWRjYXN0ZXI6IHRoaXMuYnJvYWRjYXN0ZXIsIGJyb2FkY2FzdHM6IHRoaXMuYnJvYWRjYXN0c30pXG4gIH1cbn1cblxuLyoqXG4gKiBSZXR1cm5zIGEgZGV0ZXJtaW5pc3RpYywgTXlTUUwtc2FmZSBhZHZpc29yeS1sb2NrIG5hbWUgZm9yIGEgcm91dGVkIHJlcGxheVxuICogcmVzb3VyY2UgaWRlbnRpdHkuIFRoZSBmdWxsIGB7cmVzb3VyY2VUeXBlLCByZXNvdXJjZUlkfWAgaWRlbnRpdHkgaXMgaGFzaGVkXG4gKiB3aXRoIFNIQS0yNTYgYW5kIHRydW5jYXRlZCB0byAzMiBoZXggY2hhcmFjdGVycyBzbyB0aGUgZmluYWwgbmFtZSBzdGF5cyB3ZWxsXG4gKiB1bmRlciBNeVNRTC9NYXJpYURCJ3MgNjQtY2hhcmFjdGVyIGBHRVRfTE9DS2AgbGltaXQgd2hpbGUgcmVtYWluaW5nXG4gKiBjb2xsaXNpb24tcmVzaXN0YW50LlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBMb2NrIGlkZW50aXR5IGFyZ3MuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy5yZXNvdXJjZUlkIC0gUmVzb3VyY2UgaWQuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy5yZXNvdXJjZVR5cGUgLSBSZXNvdXJjZSB0eXBlLlxuICogQHJldHVybnMge3N0cmluZ30gLSBBZHZpc29yeSBsb2NrIG5hbWUuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzeW5jUmVwbGF5Q29uZmxpY3RMb2NrTmFtZSh7cmVzb3VyY2VJZCwgcmVzb3VyY2VUeXBlfSkge1xuICBjb25zdCBpZGVudGl0eSA9IHN0YWJsZUpzb25TdHJpbmdpZnkoe3Jlc291cmNlSWQsIHJlc291cmNlVHlwZX0pXG4gIGNvbnN0IGhhc2ggPSBzaGEyNTZIZXgoaWRlbnRpdHkpLnNsaWNlKDAsIDMyKVxuXG4gIHJldHVybiBgdnNyOiR7aGFzaH1gXG59XG5cbi8qKlxuICogTm9ybWFsaXplcyBhIHZlcnNpb24gdmFsdWUgZm9yIGRldGVybWluaXN0aWMgY29tcGFyaXNvbiBhbmQgdHJhbnNwb3J0LlxuICogT25seSB2ZXJzaW9uIHZhbHVlcyBwYXJ0aWNpcGF0ZSBpbiBzdGFibGUtSlNPTiBjb21wYXJpc29uIGFnYWluc3QgY2xpZW50XG4gKiBgYmFzZVZlcnNpb25gIHN0cmluZ3M7IHJlc291cmNlIHNlcmlhbGl6ZXIvYWNjZXNzb3IgcmVzdWx0cyBtdXN0IHN0YXkgcmF3IHNvXG4gKiB0aGUgZnJvbnRlbmQtbW9kZWwgdHJhbnNwb3J0IHNlcmlhbGl6ZXIgY2FuIHJldGFpbiBEYXRlIG1hcmtlcnMuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFJhdyB2ZXJzaW9uIHZhbHVlIGZyb20gYSBkYXRhYmFzZSByZWNvcmQuXG4gKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gTm9ybWFsaXplZCB2YWx1ZSAoRGF0ZSB2YWx1ZXMgYmVjb21lIElTTyBzdHJpbmdzKS5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplQ29uZmxpY3RWYWx1ZSh2YWx1ZSkge1xuICBpZiAodmFsdWUgaW5zdGFuY2VvZiBEYXRlKSByZXR1cm4gdmFsdWUudG9JU09TdHJpbmcoKVxuXG4gIHJldHVybiB2YWx1ZVxufVxuIl19