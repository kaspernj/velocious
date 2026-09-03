// @ts-check
import { deliverDeclaredBroadcasts, upsertSyncRow } from "./sync-change-fanout.js";
import { frontendModelResourceInternalConstructor } from "../frontend-model-resource/base-resource.js";
import { markServerApply } from "./sync-publish-suppression.js";
import { resolveFrontendModelResourceClass } from "../frontend-models/resource-definition.js";
import { resolveSyncConflict } from "./conflict-strategy.js";
import SyncReplayUpsertApplier from "./sync-replay-upsert-applier.js";
import stableJsonStringify from "./stable-json.js";
import sha256Hex from "../utils/sha256-hex.js";
import { decodeReplayPersistedData, serializeReplayPersistedData } from "./sync-replay-persisted-data.js";
import { ValidationError } from "../database/record/index.js";
import VelociousError from "../velocious-error.js";
import { scalarModelPrimaryKey, scalarModelPrimaryKeyValue } from "../utils/model-primary-key.js";
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
        const ResourceClass = frontendModelResourceInternalConstructor(registration.resourceClass);
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
        const primaryKey = scalarModelPrimaryKey(ModelClass.primaryKey(), `Offline sync conflict handling for ${ModelClass.name}`);
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
        const primaryKey = scalarModelPrimaryKey(ModelClass.primaryKey(), `Offline sync attribute filtering for ${ModelClass.name}`);
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
        const primaryKey = scalarModelPrimaryKey(ModelClass.primaryKey(), `Offline sync create for ${ModelClass.name}`);
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
                    .where({ [primaryKey]: scalarModelPrimaryKeyValue(record.id(), `Offline sync create authorization for ${ModelClass.name}`) })
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3luYy1lbnZlbG9wZS1yZXBsYXktc2VydmljZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9zeW5jL3N5bmMtZW52ZWxvcGUtcmVwbGF5LXNlcnZpY2UuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sRUFBQyx5QkFBeUIsRUFBRSxhQUFhLEVBQUMsTUFBTSx5QkFBeUIsQ0FBQTtBQUNoRixPQUFPLEVBQUMsd0NBQXdDLEVBQUMsTUFBTSw2Q0FBNkMsQ0FBQTtBQUNwRyxPQUFPLEVBQUMsZUFBZSxFQUFDLE1BQU0sK0JBQStCLENBQUE7QUFDN0QsT0FBTyxFQUFDLGlDQUFpQyxFQUFDLE1BQU0sMkNBQTJDLENBQUE7QUFDM0YsT0FBTyxFQUFDLG1CQUFtQixFQUFDLE1BQU0sd0JBQXdCLENBQUE7QUFDMUQsT0FBTyx1QkFBdUIsTUFBTSxpQ0FBaUMsQ0FBQTtBQUNyRSxPQUFPLG1CQUFtQixNQUFNLGtCQUFrQixDQUFBO0FBQ2xELE9BQU8sU0FBUyxNQUFNLHdCQUF3QixDQUFBO0FBQzlDLE9BQU8sRUFBQyx5QkFBeUIsRUFBRSw0QkFBNEIsRUFBQyxNQUFNLGlDQUFpQyxDQUFBO0FBQ3ZHLE9BQU8sRUFBQyxlQUFlLEVBQUMsTUFBTSw2QkFBNkIsQ0FBQTtBQUMzRCxPQUFPLGNBQWMsTUFBTSx1QkFBdUIsQ0FBQTtBQUNsRCxPQUFPLEVBQUMscUJBQXFCLEVBQUUsMEJBQTBCLEVBQUMsTUFBTSwrQkFBK0IsQ0FBQTtBQUUvRjs7Ozs7O0dBTUc7QUFDSDs7Ozs7Ozs7Ozs7R0FXRztBQUNIOzs7Ozs7O0dBT0c7QUFFSDs7Ozs7Ozs7R0FRRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8seUJBQXlCO0lBQzVDOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7T0EyQkc7SUFDSCxZQUFZLElBQUksR0FBRyxFQUFFO1FBQ25CLElBQUksQ0FBQyxNQUFNLEdBQUcsSUFBSSxDQUFDLE1BQU0sSUFB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QUUsSUFBSSxDQUFDLFdBQVcsRUFBRSxVQUFVLEVBQUUsSUFBSSxDQUFDLFVBQVUsRUFBQyxDQUFDLENBQUE7SUFDckcsQ0FBQztDQUNGO0FBRUQ7Ozs7Ozs7Ozs7R0FVRztBQUNILE1BQU0sVUFBVSwwQkFBMEIsQ0FBQyxFQUFDLFVBQVUsRUFBRSxZQUFZLEVBQUM7SUFDbkUsTUFBTSxRQUFRLEdBQUcsbUJBQW1CLENBQUMsRUFBQyxVQUFVLEVBQUUsWUFBWSxFQUFDLENBQUMsQ0FBQTtJQUNoRSxNQUFNLElBQUksR0FBRyxTQUFTLENBQUMsUUFBUSxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQTtJQUU3QyxPQUFPLE9BQU8sSUFBSSxFQUFFLENBQUE7QUFDdEIsQ0FBQztBQUVEOzs7Ozs7O0dBT0c7QUFDSCxTQUFTLHNCQUFzQixDQUFDLEtBQUs7SUFDbkMsSUFBSSxLQUFLLFlBQVksSUFBSTtRQUFFLE9BQU8sS0FBSyxDQUFDLFdBQVcsRUFBRSxDQUFBO0lBRXJELE9BQU8sS0FBSyxDQUFBO0FBQ2QsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQge2RlbGl2ZXJEZWNsYXJlZEJyb2FkY2FzdHMsIHVwc2VydFN5bmNSb3d9IGZyb20gXCIuL3N5bmMtY2hhbmdlLWZhbm91dC5qc1wiXG5pbXBvcnQge2Zyb250ZW5kTW9kZWxSZXNvdXJjZUludGVybmFsQ29uc3RydWN0b3J9IGZyb20gXCIuLi9mcm9udGVuZC1tb2RlbC1yZXNvdXJjZS9iYXNlLXJlc291cmNlLmpzXCJcbmltcG9ydCB7bWFya1NlcnZlckFwcGx5fSBmcm9tIFwiLi9zeW5jLXB1Ymxpc2gtc3VwcHJlc3Npb24uanNcIlxuaW1wb3J0IHtyZXNvbHZlRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3N9IGZyb20gXCIuLi9mcm9udGVuZC1tb2RlbHMvcmVzb3VyY2UtZGVmaW5pdGlvbi5qc1wiXG5pbXBvcnQge3Jlc29sdmVTeW5jQ29uZmxpY3R9IGZyb20gXCIuL2NvbmZsaWN0LXN0cmF0ZWd5LmpzXCJcbmltcG9ydCBTeW5jUmVwbGF5VXBzZXJ0QXBwbGllciBmcm9tIFwiLi9zeW5jLXJlcGxheS11cHNlcnQtYXBwbGllci5qc1wiXG5pbXBvcnQgc3RhYmxlSnNvblN0cmluZ2lmeSBmcm9tIFwiLi9zdGFibGUtanNvbi5qc1wiXG5pbXBvcnQgc2hhMjU2SGV4IGZyb20gXCIuLi91dGlscy9zaGEyNTYtaGV4LmpzXCJcbmltcG9ydCB7ZGVjb2RlUmVwbGF5UGVyc2lzdGVkRGF0YSwgc2VyaWFsaXplUmVwbGF5UGVyc2lzdGVkRGF0YX0gZnJvbSBcIi4vc3luYy1yZXBsYXktcGVyc2lzdGVkLWRhdGEuanNcIlxuaW1wb3J0IHtWYWxpZGF0aW9uRXJyb3J9IGZyb20gXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIlxuaW1wb3J0IFZlbG9jaW91c0Vycm9yIGZyb20gXCIuLi92ZWxvY2lvdXMtZXJyb3IuanNcIlxuaW1wb3J0IHtzY2FsYXJNb2RlbFByaW1hcnlLZXksIHNjYWxhck1vZGVsUHJpbWFyeUtleVZhbHVlfSBmcm9tIFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIlxuXG4vKipcbiAqIFJlc29sdmVkIHJvdXRlZC1yZXNvdXJjZSByZWdpc3RyYXRpb24gZm9yIG9uZSByZXBsYXkgcmVzb3VyY2UgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFN5bmNSZXBsYXlSZXNvdXJjZVJlZ2lzdHJhdGlvblxuICogQHByb3BlcnR5IHtzdHJpbmd9IG1vZGVsTmFtZSAtIEVmZmVjdGl2ZSBmcm9udGVuZCBtb2RlbCBuYW1lLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZX0gcmVzb3VyY2VDbGFzcyAtIFJvdXRlZCByZXNvdXJjZSBjbGFzcy5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Ob3JtYWxpemVkRnJvbnRlbmRNb2RlbFJlc291cmNlQ29uZmlndXJhdGlvbiB8IG51bGx9IHJlc291cmNlQ29uZmlndXJhdGlvbiAtIE5vcm1hbGl6ZWQgcmVzb3VyY2UgY29uZmlndXJhdGlvbiB3aGVuIHJlZ2lzdHJ5LXJlc29sdmVkLlxuICovXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IFN5bmNSZXBsYXlNdXRhdGlvblxuICogQHByb3BlcnR5IHtzdHJpbmcgfCBudW1iZXIgfCBudWxsfSBbYmFzZVZlcnNpb25dIC0gQmFzZSBzZXJ2ZXIvY2xpZW50IHZlcnNpb24gb2JzZXJ2ZWQgYnkgdGhlIGNsaWVudC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbY2xpZW50TXV0YXRpb25JZF0gLSBPcmlnaW5hbCBjbGllbnQgbXV0YXRpb24gaWQgZnJvbSB0aGUgc2lnbmVkIGVudmVsb3BlLlxuICogQHByb3BlcnR5IHtEYXRlfSBjbGllbnRVcGRhdGVkQXQgLSBDbGllbnQtc2lkZSBtdXRhdGlvbiB0aW1lc3RhbXAuXG4gKiBAcHJvcGVydHkge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gZGF0YSAtIFBhcnNlZCBtdXRhdGlvbiBwYXlsb2FkLlxuICogQHByb3BlcnR5IHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gaWQgLSBDbGllbnQgc3luYyByb3cgaWQgZm9yIHBlci1zeW5jIHJlc3BvbnNlcy5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSByZXNvdXJjZUlkIC0gUmVzb3VyY2UgaWQgYXMgYSBzdHJpbmcuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gcmVzb3VyY2VUeXBlIC0gUmVzb3VyY2UvbW9kZWwgbmFtZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBzZXJpYWxpemVkRGF0YSAtIEpTT04gc2VyaWFsaXplZCBtdXRhdGlvbiBwYXlsb2FkLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHN5bmNUeXBlIC0gU3luYyBvcGVyYXRpb24gdHlwZS5cbiAqL1xuLyoqXG4gKiBPbmUgZGVjbGFyYXRpdmUgYnJvYWRjYXN0IGZhbm5lZCBvdXQgYWZ0ZXIgYSBtdXRhdGlvbiBhcHBsaWVzLlxuICogQHR5cGVkZWYge29iamVjdH0gU3luY1JlcGxheUJyb2FkY2FzdFxuICogQHByb3BlcnR5IHtzdHJpbmcgfCAoKGFyZ3M6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gc3RyaW5nKX0gY2hhbm5lbCAtIENoYW5uZWwgbmFtZSBvciByZXNvbHZlci5cbiAqIEBwcm9wZXJ0eSB7KGFyZ3M6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBicm9hZGNhc3RQYXJhbXMgLSBDaGFubmVsIHJvdXRpbmcgcGFyYW1zLlxuICogQHByb3BlcnR5IHsoYXJnczogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSA9PiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYm9keSAtIEJyb2FkY2FzdCBib2R5LlxuICogQHByb3BlcnR5IHsoYXJnczogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSA9PiBib29sZWFufSBbd2hlbl0gLSBPcHRpb25hbCBnYXRlOyBza2lwcGVkIHdoZW4gaXQgcmV0dXJucyBmYWxzZS5cbiAqL1xuXG4vKipcbiAqIFJlcGxheXMgY2xpZW50IHN5bmMgZW52ZWxvcGVzIHRocm91Z2ggcHJvamVjdCBzdXBwbGllZCBhdXRoZW50aWNhdGlvbixcbiAqIGF1dGhvcml6YXRpb24sIGFwcGxpY2F0aW9uLCBhbmQgcGVyc2lzdGVuY2UgaG9va3MuXG4gKlxuICogVGhpcyBpcyBpbnRlbnRpb25hbGx5IHRyYW5zcG9ydC9tb2RlbCBhZ25vc3RpYzogVmVsb2Npb3VzIG93bnMgdGhlIGdlbmVyaWNcbiAqIHJlcGxheSBsb29wLCBub3JtYWxpemF0aW9uLCBzdGFsZS1jbGllbnQgY29tcGFyaXNvbiwgYW5kIHBlci1zeW5jIHJlc3VsdFxuICogc2hhcGUgd2hpbGUgZWFjaCBhcHAgb3ducyBpdHMgdG9rZW4gbG9va3VwLCBtb2RlbCBoYW5kbGVycywgYW5kXG4gKiBkb21haW4gYXV0aG9yaXphdGlvbiBydWxlcy5cbiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgU3luY0VudmVsb3BlUmVwbGF5U2VydmljZSB7XG4gIC8qKlxuICAgKiBDcmVhdGVzIGEgc3luYyBlbnZlbG9wZSByZXBsYXkgc2VydmljZS5cbiAgICpcbiAgICogV2hlbiBhIHN5bmMgbW9kZWwgaXMgZ2l2ZW4sIGBmaW5kRXhpc3RpbmdSZXBsYXlTeW5jYCBhbmRcbiAgICogYHBlcnNpc3RSZXBsYXlNdXRhdGlvbmAgZ2V0IG1vZGVsLWJhY2tlZCBkZWZhdWx0IGltcGxlbWVudGF0aW9ucy4gVGhlIHN5bmNcbiAgICogbW9kZWwgbXVzdCBleHBvc2UgYGZpbmRCeWAvYGNyZWF0ZWAgc3RhdGljcyBwbHVzIGluc3RhbmNlXG4gICAqIGBhc3NpZ25gL2BzYXZlYC9gY2xpZW50VXBkYXRlZEF0YCBhbmQgYGFkdmFuY2VTZXJ2ZXJTZXF1ZW5jZWAgKHRoZVxuICAgKiBjaGFuZ2UtZmVlZCBzZXF1ZW5jZSBjb250cmFjdCksIGFuZCB0aGUgYWN0b3IgcmV0dXJuZWQgZnJvbVxuICAgKiBgYXV0aGVudGljYXRlUmVwbGF5YCBtdXN0IGV4cG9zZSBhbiBgaWQoKWAgbWV0aG9kLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gQ29uc3RydWN0b3IgYXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge3tkZWJ1Zz86ICguLi5hcmdzOiBBcnJheTx1bmtub3duPikgPT4gdm9pZCwgd2Fybj86ICguLi5hcmdzOiBBcnJheTx1bmtub3duPikgPT4gdm9pZH19IFthcmdzLmxvZ2dlcl0gLSBMb2dnZXIgdXNlZCBmb3Igbm9ybWFsaXphdGlvbiB3YXJuaW5ncy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gW2FyZ3Muc3luY01vZGVsXSAtIFN5bmMvY2hhbmdlIG1vZGVsIGVuYWJsaW5nIG1vZGVsLWJhY2tlZCBkZWZhdWx0IGhvb2tzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuYWN0b3JGb3JlaWduS2V5Q29sdW1uXSAtIFN5bmMgbW9kZWwgY29sdW1uIGxpbmtpbmcgcm93cyB0byB0aGUgcmVwbGF5IGFjdG9yLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBbYXJncy5hdXRoZW50aWNhdGlvblRva2VuTW9kZWxdIC0gVG9rZW4gbW9kZWwgZW5hYmxpbmcgdGhlIGRlZmF1bHQgdG9rZW4tbG9va3VwIGF1dGhlbnRpY2F0ZVJlcGxheS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmF1dGhlbnRpY2F0aW9uVG9rZW5Db2x1bW5dIC0gVG9rZW4gbW9kZWwgY29sdW1uIGhvbGRpbmcgdGhlIHRva2VuLiBEZWZhdWx0cyB0byBcInRva2VuXCIuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5hdXRoZW50aWNhdGlvblRva2VuUGFyYW1dIC0gUmVxdWVzdCBwYXJhbSBjYXJyeWluZyB0aGUgdG9rZW4uIERlZmF1bHRzIHRvIFwiYXV0aGVudGljYXRpb25Ub2tlblwiLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsICgoYXJnczogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSA9PiBQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgfCBDb25zdHJ1Y3RvclBhcmFtZXRlcnM8dHlwZW9mIFN5bmNSZXBsYXlVcHNlcnRBcHBsaWVyPlswXT59IFthcmdzLmFwcGx5SGFuZGxlcnNdIC0gUGVyLXJlc291cmNlVHlwZSBhcHBseSBoYW5kbGVycyAoZnVuY3Rpb25zIG9yIGRlY2xhcmF0aXZlIHVwc2VydC1hcHBsaWVyIHNwZWNzKSBlbmFibGluZyB0aGUgZGVmYXVsdCBhcHBseVJlcGxheU11dGF0aW9uIGRpc3BhdGNoLiBEZXByZWNhdGVkOiBwcmVmZXIgcmVzb3VyY2Ugcm91dGluZyB2aWEgYGNvbmZpZ3VyYXRpb25gL2ByZXNvdXJjZVR5cGVPdmVycmlkZXNgOyBhcHBseUhhbmRsZXJzIHJlbWFpbiBmb3IgcmVsZWFzZWQgYWRvcHRlcnMgYW5kIHdpbGwgYmUgcmVtb3ZlZCBhZnRlciB0aGVpciBtaWdyYXRpb24uXG4gICAqIEBwYXJhbSB7KGFyZ3M6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBbYXJncy5wZXJzaXN0RXh0cmFBdHRyaWJ1dGVzXSAtIEV4dHJhIGF0dHJpYnV0ZXMgbWVyZ2VkIGludG8gdGhlIG1vZGVsLWJhY2tlZCBwZXJzaXN0ZWQgcm93IChlLmcuIGFuIGV2ZW50IHNjb3BlIGNvbHVtbikuXG4gICAqIEBwYXJhbSB7KGFyZ3M6IHttdXRhdGlvbjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGFwcGx5UmVzdWx0OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0pID0+IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBbYXJncy5wZXJzaXN0U2VyaWFsaXplZERhdGFdIC0gT3ZlcnJpZGVzIHRoZSBwZXJzaXN0ZWQgZGF0YSBwYXlsb2FkIChvYmplY3QgcmVzdWx0cyBhcmUgSlNPTiBzdHJpbmdpZmllZCkuXG4gICAqIEBwYXJhbSB7KGJyb2FkY2FzdDoge2NoYW5uZWw6IHN0cmluZywgcGFyYW1zOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIGJvZHk6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSkgPT4gUHJvbWlzZTx2b2lkPn0gW2FyZ3MuYnJvYWRjYXN0ZXJdIC0gRGVsaXZlcnMgZGVjbGFyYXRpdmUgYnJvYWRjYXN0cy4gUmVxdWlyZWQgd2hlbiBicm9hZGNhc3RzIGFyZSBjb25maWd1cmVkLlxuICAgKiBAcGFyYW0ge1N5bmNSZXBsYXlCcm9hZGNhc3RbXX0gW2FyZ3MuYnJvYWRjYXN0c10gLSBCcm9hZGNhc3RzIGZhbm5lZCBvdXQgYnkgdGhlIGRlZmF1bHQgYWZ0ZXJSZXBsYXlNdXRhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IFthcmdzLmNvbmZpZ3VyYXRpb25dIC0gQ29uZmlndXJhdGlvbiB3aG9zZSBmcm9udGVuZC1tb2RlbCByZWdpc3RyeSByb3V0ZXMgbXV0YXRpb25zIHRvIHJlc291cmNlIGNsYXNzZXMuXG4gICAqIEBwYXJhbSB7e3N0cmF0ZWd5PzogXCJvcHRpbWlzdGljVmVyc2lvblwiIHwgXCJzZXJ2ZXJXaW5zXCIsIHZlcnNpb25BdHRyaWJ1dGU6IHN0cmluZ30gfCBudWxsfSBbYXJncy5jb25mbGljdFN0cmF0ZWd5XSAtIE9wdGlvbmFsIGJhc2UtdmVyc2lvbiBjb25mbGljdCBkZXRlY3Rpb24gZm9yIHJvdXRlZCB1cHNlcnRzLiBPbmx5IGBvcHRpbWlzdGljVmVyc2lvbmAgYW5kIGBzZXJ2ZXJXaW5zYCBhcmUgc3VwcG9ydGVkIGZvciBiYWNrZW5kIHJlcGxheSBiZWNhdXNlIHRoZSBzZXJ2ZXIgZG9lcyBub3QgaGF2ZSB0aGUgY2xpZW50J3MgYmFzZSBzbmFwc2hvdC4gV2hlbiBgc3RyYXRlZ3lgIGlzIG9taXR0ZWQgaXQgZGVmYXVsdHMgdG8gYG9wdGltaXN0aWNWZXJzaW9uYCwgbWF0Y2hpbmcgYHJlc29sdmVTeW5jQ29uZmxpY3RgIGFuZCBub3JtYWxpemVkIHJlc291cmNlIGNvbmZpZy4gV2hlbiBjb25maWd1cmVkLCBhIG11dGF0aW9uIHdob3NlIGJhc2VWZXJzaW9uIGRvZXMgbm90IG1hdGNoIHRoZSBjdXJyZW50IHNlcnZlciB2ZXJzaW9uQXR0cmlidXRlIGlzIHJlamVjdGVkIHdpdGggYSBzdHJ1Y3R1cmVkIGNvbmZsaWN0IHJlc3VsdCBpbnN0ZWFkIG9mIGJlaW5nIGFwcGxpZWQuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGUgfCBzdHJpbmc+fSBbYXJncy5yZXNvdXJjZVR5cGVPdmVycmlkZXNdIC0gUGVyLXJlc291cmNlVHlwZSByb3V0aW5nIG92ZXJyaWRlczogYSByZXNvdXJjZSBjbGFzcywgb3IgYSBzdHJpbmcgYWxpYXMgcmVzb2x2ZWQgdGhyb3VnaCB0aGUgcmVnaXN0cnkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHR9IFthcmdzLmFiaWxpdHldIC0gQWJpbGl0eSBzY29waW5nIHJvdXRlZCByZWNvcmQgbG9va3VwcyBhbmQgY3JlYXRlIG1lbWJlcnNoaXAgY2hlY2tzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gW2FyZ3MuYWJpbGl0eUNvbnRleHRdIC0gQWJpbGl0eSBjb250ZXh0IHBhc3NlZCB0byByb3V0ZWQgcmVzb3VyY2VzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gW2FyZ3MubG9jYWxzXSAtIExvY2FscyBwYXNzZWQgdG8gcm91dGVkIHJlc291cmNlcy5cbiAgICovXG4gIGNvbnN0cnVjdG9yKGFyZ3MgPSB7fSkge1xuICAgIHRoaXMubG9nZ2VyID0gYXJncy5sb2dnZXIgfHwgY29uc29sZVxuICAgIHRoaXMuc3luY01vZGVsID0gYXJncy5zeW5jTW9kZWwgfHwgbnVsbFxuICAgIHRoaXMuYWN0b3JGb3JlaWduS2V5Q29sdW1uID0gYXJncy5hY3RvckZvcmVpZ25LZXlDb2x1bW4gfHwgXCJhdXRoZW50aWNhdGlvbl90b2tlbl9pZFwiXG4gICAgdGhpcy5hdXRoZW50aWNhdGlvblRva2VuTW9kZWwgPSBhcmdzLmF1dGhlbnRpY2F0aW9uVG9rZW5Nb2RlbCB8fCBudWxsXG4gICAgdGhpcy5hdXRoZW50aWNhdGlvblRva2VuQ29sdW1uID0gYXJncy5hdXRoZW50aWNhdGlvblRva2VuQ29sdW1uIHx8IFwidG9rZW5cIlxuICAgIHRoaXMuYXV0aGVudGljYXRpb25Ub2tlblBhcmFtID0gYXJncy5hdXRoZW50aWNhdGlvblRva2VuUGFyYW0gfHwgXCJhdXRoZW50aWNhdGlvblRva2VuXCJcbiAgICB0aGlzLnBlcnNpc3RFeHRyYUF0dHJpYnV0ZXMgPSBhcmdzLnBlcnNpc3RFeHRyYUF0dHJpYnV0ZXMgfHwgbnVsbFxuICAgIHRoaXMucGVyc2lzdFNlcmlhbGl6ZWREYXRhID0gYXJncy5wZXJzaXN0U2VyaWFsaXplZERhdGEgfHwgbnVsbFxuICAgIHRoaXMuYnJvYWRjYXN0ZXIgPSBhcmdzLmJyb2FkY2FzdGVyIHx8IG51bGxcbiAgICB0aGlzLmJyb2FkY2FzdHMgPSBhcmdzLmJyb2FkY2FzdHMgfHwgbnVsbFxuICAgIHRoaXMuYXBwbHlIYW5kbGVycyA9IGFyZ3MuYXBwbHlIYW5kbGVycyA/IHRoaXMuYnVpbHRBcHBseUhhbmRsZXJzKGFyZ3MuYXBwbHlIYW5kbGVycykgOiBudWxsXG4gICAgdGhpcy5jb25maWd1cmF0aW9uID0gYXJncy5jb25maWd1cmF0aW9uIHx8IG51bGxcbiAgICB0aGlzLmNvbmZsaWN0U3RyYXRlZ3kgPSBhcmdzLmNvbmZsaWN0U3RyYXRlZ3kgfHwgbnVsbFxuICAgIHRoaXMucmVzb3VyY2VUeXBlT3ZlcnJpZGVzID0gYXJncy5yZXNvdXJjZVR5cGVPdmVycmlkZXMgfHwgbnVsbFxuICAgIHRoaXMuYWJpbGl0eSA9IGFyZ3MuYWJpbGl0eSB8fCBudWxsXG4gICAgdGhpcy5hYmlsaXR5Q29udGV4dCA9IGFyZ3MuYWJpbGl0eUNvbnRleHQgfHwgbnVsbFxuICAgIHRoaXMubG9jYWxzID0gYXJncy5sb2NhbHMgfHwgbnVsbFxuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgU3luY1JlcGxheVJlc291cmNlUmVnaXN0cmF0aW9uIHwgbnVsbD59ICovXG4gICAgdGhpcy5fcmVwbGF5UmVzb3VyY2VSZWdpc3RyYXRpb25zID0gbmV3IE1hcCgpXG5cbiAgICBpZiAoYXJncy5hY3RvckZvcmVpZ25LZXlDb2x1bW4gIT09IHVuZGVmaW5lZCAmJiAodHlwZW9mIGFyZ3MuYWN0b3JGb3JlaWduS2V5Q29sdW1uICE9PSBcInN0cmluZ1wiIHx8IGFyZ3MuYWN0b3JGb3JlaWduS2V5Q29sdW1uLmxlbmd0aCA8IDEpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYGFjdG9yRm9yZWlnbktleUNvbHVtbiBtdXN0IGJlIGEgbm9uLWJsYW5rIHN0cmluZywgZ290OiAke1N0cmluZyhhcmdzLmFjdG9yRm9yZWlnbktleUNvbHVtbil9YClcbiAgICB9XG4gICAgaWYgKHRoaXMuYnJvYWRjYXN0cyAmJiAhdGhpcy5icm9hZGNhc3Rlcikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiU3luY0VudmVsb3BlUmVwbGF5U2VydmljZSBicm9hZGNhc3RzIHJlcXVpcmUgYSBicm9hZGNhc3RlciBvcHRpb24gZGVsaXZlcmluZyB0aGVtXCIpXG4gICAgfVxuICAgIGlmICh0aGlzLmNvbmZsaWN0U3RyYXRlZ3kpIHtcbiAgICAgIGNvbnN0IHN1cHBvcnRlZENvbmZsaWN0U3RyYXRlZ2llcyA9IG5ldyBTZXQoW1wib3B0aW1pc3RpY1ZlcnNpb25cIiwgXCJzZXJ2ZXJXaW5zXCJdKVxuXG4gICAgICBpZiAoIXRoaXMuY29uZmxpY3RTdHJhdGVneS52ZXJzaW9uQXR0cmlidXRlIHx8IHR5cGVvZiB0aGlzLmNvbmZsaWN0U3RyYXRlZ3kudmVyc2lvbkF0dHJpYnV0ZSAhPT0gXCJzdHJpbmdcIikge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jRW52ZWxvcGVSZXBsYXlTZXJ2aWNlIGNvbmZsaWN0U3RyYXRlZ3kgcmVxdWlyZXMgYSBub24tYmxhbmsgdmVyc2lvbkF0dHJpYnV0ZVwiKVxuICAgICAgfVxuICAgICAgaWYgKHRoaXMuY29uZmxpY3RTdHJhdGVneS5zdHJhdGVneSAhPT0gdW5kZWZpbmVkICYmICFzdXBwb3J0ZWRDb25mbGljdFN0cmF0ZWdpZXMuaGFzKHRoaXMuY29uZmxpY3RTdHJhdGVneS5zdHJhdGVneSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbnN1cHBvcnRlZCBzeW5jIGNvbmZsaWN0IHN0cmF0ZWd5IGZvciBiYWNrZW5kIHJlcGxheTogJHt0aGlzLmNvbmZsaWN0U3RyYXRlZ3kuc3RyYXRlZ3l9LiBPbmx5IG9wdGltaXN0aWNWZXJzaW9uIGFuZCBzZXJ2ZXJXaW5zIGFyZSBzdXBwb3J0ZWQuYClcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogV3JhcHMgZGVjbGFyYXRpdmUgYXBwbHktaGFuZGxlciBzcGVjcyBpbiB1cHNlcnQgYXBwbGllcnMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcHBseUhhbmRsZXJzIC0gUmF3IGFwcGx5IGhhbmRsZXJzLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgKGFyZ3M6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gUHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSBDYWxsYWJsZSBoYW5kbGVycyBieSByZXNvdXJjZSB0eXBlLlxuICAgKi9cbiAgYnVpbHRBcHBseUhhbmRsZXJzKGFwcGx5SGFuZGxlcnMpIHtcbiAgICByZXR1cm4gT2JqZWN0LmZyb21FbnRyaWVzKE9iamVjdC5lbnRyaWVzKGFwcGx5SGFuZGxlcnMpLm1hcCgoW3Jlc291cmNlVHlwZSwgaGFuZGxlcl0pID0+IHtcbiAgICAgIGlmICh0eXBlb2YgaGFuZGxlciA9PT0gXCJmdW5jdGlvblwiKSByZXR1cm4gW3Jlc291cmNlVHlwZSwgaGFuZGxlcl1cblxuICAgICAgY29uc3QgYXBwbGllciA9IG5ldyBTeW5jUmVwbGF5VXBzZXJ0QXBwbGllcihoYW5kbGVyKVxuXG4gICAgICByZXR1cm4gW3Jlc291cmNlVHlwZSwgKC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyBhcHBseUFyZ3MpID0+IGFwcGxpZXIuYXBwbHkoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGFwcGx5QXJncykpXVxuICAgIH0pKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlcGxheXMgYSBzeW5jIGJhdGNoLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gcGFyYW1zIC0gUmVxdWVzdCBwYXJhbXMgY2FycnlpbmcgYXV0aGVudGljYXRpb24gYW5kIHN5bmNzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gW3JlcXVlc3RTdGF0ZV0gLSBSZXF1ZXN0LWxvY2FsIHN0YXRlIHBhc3NlZCB0byBhdXRoZW50aWNhdGlvbi9zeW5jIGV4dHJhY3Rpb24gaG9va3M7IHN1YmNsYXNzZXMgbWF5IHVzZSB0aGlzIHRvIHNoYXJlIHByZS1jb21wdXRlZCBwZXItcmVxdWVzdCBkYXRhIHdpdGhvdXQgaW5zdGFuY2UgbXV0YXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHtzeW5jczogQXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Piwgc3RhdHVzPzogc3RyaW5nLCBlcnJvckNvZGU/OiBzdHJpbmcsIGVycm9yTWVzc2FnZT86IHN0cmluZ30+fSBSZXBsYXkgcmVzcG9uc2UuXG4gICAqL1xuICBhc3luYyByZXBsYXkocGFyYW1zLCByZXF1ZXN0U3RhdGUgPSB7fSkge1xuICAgIGNvbnN0IGFjdG9yUmVzdWx0ID0gYXdhaXQgdGhpcy5hdXRoZW50aWNhdGVSZXBsYXkocGFyYW1zLCByZXF1ZXN0U3RhdGUpXG5cbiAgICBpZiAoIWFjdG9yUmVzdWx0LmF1dGhlbnRpY2F0ZWQpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN5bmNzOiBbXSxcbiAgICAgICAgc3RhdHVzOiBcImVycm9yXCIsXG4gICAgICAgIGVycm9yQ29kZTogYWN0b3JSZXN1bHQuZXJyb3JDb2RlLFxuICAgICAgICBlcnJvck1lc3NhZ2U6IGFjdG9yUmVzdWx0LmVycm9yTWVzc2FnZVxuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IHN5bmNSZXNwb25zZXMgPSBbXVxuICAgIGNvbnN0IGNvbnRleHQgPSBhd2FpdCB0aGlzLmJ1aWxkUmVwbGF5Q29udGV4dCh7YWN0b3I6IGFjdG9yUmVzdWx0LmFjdG9yLCBwYXJhbXMsIHJlcXVlc3RTdGF0ZX0pXG5cbiAgICBmb3IgKGNvbnN0IHJhd1N5bmMgb2YgdGhpcy5yZXBsYXlTeW5jcyhwYXJhbXMsIHJlcXVlc3RTdGF0ZSkpIHtcbiAgICAgIGNvbnN0IG5vcm1hbGl6ZWRSZXN1bHQgPSB0aGlzLm5vcm1hbGl6ZVJlcGxheVN5bmMocmF3U3luYylcblxuICAgICAgaWYgKCFub3JtYWxpemVkUmVzdWx0Lm9rKSB7XG4gICAgICAgIHN5bmNSZXNwb25zZXMucHVzaChub3JtYWxpemVkUmVzdWx0LnJlc3BvbnNlKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBjb25zdCBtdXRhdGlvbiA9IG5vcm1hbGl6ZWRSZXN1bHQubXV0YXRpb25cbiAgICAgIGNvbnN0IGFjY2Vzc1Jlc3VsdCA9IGF3YWl0IHRoaXMuYXV0aG9yaXplUmVwbGF5TXV0YXRpb24oe2FjdG9yOiBhY3RvclJlc3VsdC5hY3RvciwgY29udGV4dCwgbXV0YXRpb259KVxuXG4gICAgICBpZiAoIWFjY2Vzc1Jlc3VsdC5hbGxvd2VkKSB7XG4gICAgICAgIHN5bmNSZXNwb25zZXMucHVzaCh7XG4gICAgICAgICAgaWQ6IG11dGF0aW9uLmlkLFxuICAgICAgICAgIHN5bmNTdGF0ZTogXCJmYWlsZWRcIixcbiAgICAgICAgICByZWFzb246IGFjY2Vzc1Jlc3VsdC5yZWFzb24gfHwgXCJhY2Nlc3MtZGVuaWVkXCJcbiAgICAgICAgfSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgY29uc3QgZXhpc3RpbmdTeW5jID0gYXdhaXQgdGhpcy5maW5kRXhpc3RpbmdSZXBsYXlTeW5jKHthY3RvcjogYWN0b3JSZXN1bHQuYWN0b3IsIGNvbnRleHQsIG11dGF0aW9ufSlcbiAgICAgIGNvbnN0IHNob3VsZEFwcGx5ID0gYXdhaXQgdGhpcy5zaG91bGRBcHBseVJlcGxheU11dGF0aW9uKHthY3RvcjogYWN0b3JSZXN1bHQuYWN0b3IsIGNvbnRleHQsIGV4aXN0aW5nU3luYywgbXV0YXRpb259KVxuICAgICAgY29uc3QgZHVwbGljYXRlID0gIXNob3VsZEFwcGx5ICYmIHRoaXMuaXNEdXBsaWNhdGVSZXBsYXlNdXRhdGlvbih7ZXhpc3RpbmdTeW5jLCBtdXRhdGlvbn0pXG5cbiAgICAgIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovXG4gICAgICBsZXQgYXBwbHlSZXN1bHRcblxuICAgICAgdHJ5IHtcbiAgICAgICAgYXBwbHlSZXN1bHQgPSBzaG91bGRBcHBseVxuICAgICAgICAgID8gYXdhaXQgdGhpcy5hcHBseVJlcGxheU11dGF0aW9uKHthY3RvcjogYWN0b3JSZXN1bHQuYWN0b3IsIGNvbnRleHQsIGV4aXN0aW5nU3luYywgbXV0YXRpb259KVxuICAgICAgICAgIDogYXdhaXQgdGhpcy5za2lwcGVkUmVwbGF5TXV0YXRpb24oe2FjdG9yOiBhY3RvclJlc3VsdC5hY3RvciwgY29udGV4dCwgZXhpc3RpbmdTeW5jLCBtdXRhdGlvbn0pXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAvLyBDbGllbnQtc2FmZSBhcHBseSBmYWlsdXJlcyAoc2NoZW1hIHZhbGlkYXRpb24sIG1vZGVsIHZhbGlkYXRpb24sXG4gICAgICAgIC8vIGF1dGhvcml6YXRpb24gZGVuaWFscywgdW5rbm93biByZXNvdXJjZSB0eXBlcykgZmFpbCB0aGlzIHN5bmMgYW5kXG4gICAgICAgIC8vIGtlZXAgdGhlIGJhdGNoIGdvaW5nOyB1bmV4cGVjdGVkIGVycm9ycyBrZWVwIHByb3BhZ2F0aW5nLlxuICAgICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBWZWxvY2lvdXNFcnJvciAmJiBlcnJvci5zYWZlVG9FeHBvc2UpIHtcbiAgICAgICAgICBzeW5jUmVzcG9uc2VzLnB1c2goe1xuICAgICAgICAgICAgaWQ6IG11dGF0aW9uLmlkLFxuICAgICAgICAgICAgc3luY1N0YXRlOiBcImZhaWxlZFwiLFxuICAgICAgICAgICAgcmVhc29uOiBlcnJvci5jb2RlIHx8IFwiYXBwbHktZmFpbGVkXCIsXG4gICAgICAgICAgICBtZXNzYWdlOiBlcnJvci5tZXNzYWdlXG4gICAgICAgICAgfSlcbiAgICAgICAgICBjb250aW51ZVxuICAgICAgICB9XG5cbiAgICAgICAgdGhyb3cgZXJyb3JcbiAgICAgIH1cblxuICAgICAgaWYgKGFwcGx5UmVzdWx0ICYmIGFwcGx5UmVzdWx0LnN0YXR1cyA9PT0gXCJjb25mbGljdFwiKSB7XG4gICAgICAgIHN5bmNSZXNwb25zZXMucHVzaCh7XG4gICAgICAgICAgY29uZmxpY3Q6IGFwcGx5UmVzdWx0LmNvbmZsaWN0LFxuICAgICAgICAgIGlkOiBtdXRhdGlvbi5pZCxcbiAgICAgICAgICBzeW5jU3RhdGU6IFwiY29uZmxpY3RcIlxuICAgICAgICB9KVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBhd2FpdCB0aGlzLnBlcnNpc3RSZXBsYXlNdXRhdGlvbih7YWN0b3I6IGFjdG9yUmVzdWx0LmFjdG9yLCBjb250ZXh0LCBleGlzdGluZ1N5bmMsIGFwcGx5UmVzdWx0LCBtdXRhdGlvbiwgc2hvdWxkQXBwbHl9KVxuICAgICAgYXdhaXQgdGhpcy5hZnRlclJlcGxheU11dGF0aW9uKHthY3RvcjogYWN0b3JSZXN1bHQuYWN0b3IsIGNvbnRleHQsIGV4aXN0aW5nU3luYywgYXBwbHlSZXN1bHQsIG11dGF0aW9uLCBzaG91bGRBcHBseX0pXG5cbiAgICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgICAgY29uc3Qgc3VjY2Vzc2Z1bFJlc3BvbnNlID0ge2lkOiBtdXRhdGlvbi5pZCwgc3luY1N0YXRlOiBkdXBsaWNhdGUgPyBcImR1cGxpY2F0ZVwiIDogXCJzdWNjZXNzZnVsXCJ9XG5cbiAgICAgIGNvbnN0IHBlcnNpc3RlZFJlcGxheU1ldGFkYXRhID0gZHVwbGljYXRlID8gdGhpcy5yZXBsYXlQZXJzaXN0ZWRNZXRhZGF0YShleGlzdGluZ1N5bmMpIDogbnVsbFxuXG4gICAgICBpZiAocGVyc2lzdGVkUmVwbGF5TWV0YWRhdGEpIHtcbiAgICAgICAgc3VjY2Vzc2Z1bFJlc3BvbnNlLnNlcnZlclZlcnNpb24gPSBwZXJzaXN0ZWRSZXBsYXlNZXRhZGF0YS5hY2tub3dsZWRnZW1lbnRWZXJzaW9uXG4gICAgICB9IGVsc2UgaWYgKHRoaXMuY29uZmxpY3RTdHJhdGVneSAmJiBtdXRhdGlvbi5iYXNlVmVyc2lvbiAhPT0gdW5kZWZpbmVkICYmIGFwcGx5UmVzdWx0Py5yZWNvcmQpIHtcbiAgICAgICAgc3VjY2Vzc2Z1bFJlc3BvbnNlLnNlcnZlclZlcnNpb24gPSBub3JtYWxpemVDb25mbGljdFZhbHVlKGFwcGx5UmVzdWx0LnJlY29yZC5yZWFkQXR0cmlidXRlKHRoaXMuY29uZmxpY3RTdHJhdGVneS52ZXJzaW9uQXR0cmlidXRlKSlcbiAgICAgIH1cblxuICAgICAgc3luY1Jlc3BvbnNlcy5wdXNoKHN1Y2Nlc3NmdWxSZXNwb25zZSlcbiAgICB9XG5cbiAgICByZXR1cm4ge3N5bmNzOiBzeW5jUmVzcG9uc2VzfVxuICB9XG5cbiAgLyoqXG4gICAqIEF1dGhlbnRpY2F0ZXMgdGhlIHN5bmMgYmF0Y2ggYWN0b3IuXG4gICAqXG4gICAqIERlZmF1bHRzIHRvIGEgdG9rZW4tbW9kZWwgbG9va3VwIHdoZW4gYGF1dGhlbnRpY2F0aW9uVG9rZW5Nb2RlbGAgaXNcbiAgICogY29uZmlndXJlZDsgb3RoZXJ3aXNlIGFwcHMgb3ZlcnJpZGUgdGhpcyBob29rLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gcGFyYW1zIC0gUmVxdWVzdCBwYXJhbXMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBbX3JlcXVlc3RTdGF0ZV0gLSBSZXF1ZXN0LWxvY2FsIHN0YXRlIHBvcHVsYXRlZCBieSBzdWJjbGFzc2VzIGJlZm9yZSB0aGUgYmFzZSByZXBsYXkgbG9vcCBydW5zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7YXV0aGVudGljYXRlZDogdHJ1ZSwgYWN0b3I6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB8IHthdXRoZW50aWNhdGVkOiBmYWxzZSwgZXJyb3JDb2RlOiBzdHJpbmcsIGVycm9yTWVzc2FnZTogc3RyaW5nfT59IEF1dGggcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgYXV0aGVudGljYXRlUmVwbGF5KHBhcmFtcywgX3JlcXVlc3RTdGF0ZSkge1xuICAgIGlmICghdGhpcy5hdXRoZW50aWNhdGlvblRva2VuTW9kZWwpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlN5bmNFbnZlbG9wZVJlcGxheVNlcnZpY2UuYXV0aGVudGljYXRlUmVwbGF5IG11c3QgYmUgaW1wbGVtZW50ZWQgKG9yIGNvbmZpZ3VyZSBhdXRoZW50aWNhdGlvblRva2VuTW9kZWwpXCIpXG4gICAgfVxuXG4gICAgY29uc3QgdG9rZW4gPSBwYXJhbXNbdGhpcy5hdXRoZW50aWNhdGlvblRva2VuUGFyYW1dXG5cbiAgICBpZiAoIXRva2VuKSB7XG4gICAgICByZXR1cm4ge2F1dGhlbnRpY2F0ZWQ6IGZhbHNlLCBlcnJvckNvZGU6IFwibWlzc2luZy1hdXRoZW50aWNhdGlvbi10b2tlblwiLCBlcnJvck1lc3NhZ2U6IFwiTWlzc2luZyBhdXRoZW50aWNhdGlvbiB0b2tlblwifVxuICAgIH1cblxuICAgIGNvbnN0IGFjdG9yID0gYXdhaXQgdGhpcy5hdXRoZW50aWNhdGlvblRva2VuTW9kZWwuZmluZEJ5KHtbdGhpcy5hdXRoZW50aWNhdGlvblRva2VuQ29sdW1uXTogdG9rZW59KVxuXG4gICAgaWYgKCFhY3Rvcikge1xuICAgICAgcmV0dXJuIHthdXRoZW50aWNhdGVkOiBmYWxzZSwgZXJyb3JDb2RlOiBcImludmFsaWQtYXV0aGVudGljYXRpb24tdG9rZW5cIiwgZXJyb3JNZXNzYWdlOiBcIkludmFsaWQgYXV0aGVudGljYXRpb24gdG9rZW5cIn1cbiAgICB9XG5cbiAgICByZXR1cm4ge2FjdG9yLCBhdXRoZW50aWNhdGVkOiB0cnVlfVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBwZXItYmF0Y2ggbXV0YWJsZSBjb250ZXh0IGZvciBjYWNoZXMgc2hhcmVkIGFjcm9zcyBzeW5jIGl0ZW1zLlxuICAgKiBAcGFyYW0ge3thY3RvcjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIHBhcmFtczogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCByZXF1ZXN0U3RhdGU6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn19IF9hcmdzIC0gQWN0b3IsIHJlcXVlc3QgcGFyYW1zLCBhbmQgcmVxdWVzdC1sb2NhbCBzdGF0ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gUmVwbGF5IGNvbnRleHQuXG4gICAqL1xuICBhc3luYyBidWlsZFJlcGxheUNvbnRleHQoX2FyZ3MpIHtcbiAgICByZXR1cm4ge31cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHJhdyBzeW5jIGVudHJpZXMgZnJvbSByZXF1ZXN0IHBhcmFtcy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHBhcmFtcyAtIFJlcXVlc3QgcGFyYW1zLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gW19yZXF1ZXN0U3RhdGVdIC0gUmVxdWVzdC1sb2NhbCBzdGF0ZSBwb3B1bGF0ZWQgYnkgc3ViY2xhc3NlcyBiZWZvcmUgdGhlIGJhc2UgcmVwbGF5IGxvb3AgcnVucy5cbiAgICogQHJldHVybnMge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gUmF3IHN5bmMgZW50cmllcy5cbiAgICovXG4gIHJlcGxheVN5bmNzKHBhcmFtcywgX3JlcXVlc3RTdGF0ZSkge1xuICAgIHJldHVybiBBcnJheS5pc0FycmF5KHBhcmFtcy5zeW5jcykgPyBwYXJhbXMuc3luY3MgOiBbXVxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZXMgb25lIHN5bmMgZW50cnkuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHJhd1N5bmMgLSBSYXcgc3luYyBlbnRyeS5cbiAgICogQHJldHVybnMge3tvazogdHJ1ZSwgbXV0YXRpb246IGltcG9ydChcIi4vc3luYy1lbnZlbG9wZS1yZXBsYXktc2VydmljZS5qc1wiKS5TeW5jUmVwbGF5TXV0YXRpb259IHwge29rOiBmYWxzZSwgcmVzcG9uc2U6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn19IE5vcm1hbGl6ZWQgbXV0YXRpb24gb3IgZmFpbGVkIHJlc3BvbnNlLlxuICAgKi9cbiAgbm9ybWFsaXplUmVwbGF5U3luYyhyYXdTeW5jKSB7XG4gICAgaWYgKCFyYXdTeW5jIHx8IHR5cGVvZiByYXdTeW5jICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkocmF3U3luYykpIHtcbiAgICAgIHJldHVybiB7b2s6IGZhbHNlLCByZXNwb25zZToge2lkOiB1bmRlZmluZWQsIHN5bmNTdGF0ZTogXCJmYWlsZWRcIiwgcmVhc29uOiBcImludmFsaWQtc3luY1wifX1cbiAgICB9XG5cbiAgICBjb25zdCBzeW5jID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChyYXdTeW5jKVxuICAgIGNvbnN0IHtjbGllbnRNdXRhdGlvbklkLCBjbGllbnRVcGRhdGVkQXQsIGRhdGEsIGlkLCByZXNvdXJjZUlkLCByZXNvdXJjZVR5cGUsIHN5bmNUeXBlfSA9IHN5bmNcblxuICAgIGlmICh0eXBlb2YgcmVzb3VyY2VUeXBlICE9PSBcInN0cmluZ1wiIHx8IHJlc291cmNlVHlwZS5sZW5ndGggPCAxIHx8IHJlc291cmNlSWQgPT09IHVuZGVmaW5lZCB8fCByZXNvdXJjZUlkID09PSBudWxsIHx8IHR5cGVvZiBzeW5jVHlwZSAhPT0gXCJzdHJpbmdcIiB8fCBzeW5jVHlwZS5sZW5ndGggPCAxKSB7XG4gICAgICByZXR1cm4ge29rOiBmYWxzZSwgcmVzcG9uc2U6IHtpZCwgc3luY1N0YXRlOiBcImZhaWxlZFwiLCByZWFzb246IFwiaW52YWxpZC1yZXNvdXJjZS1pZFwifX1cbiAgICB9XG5cbiAgICBjb25zdCByZXNvdXJjZUlkU3RyaW5nID0gU3RyaW5nKHJlc291cmNlSWQpXG4gICAgbGV0IGNsaWVudFVwZGF0ZWRBdERhdGUgPSB0eXBlb2YgY2xpZW50VXBkYXRlZEF0ID09PSBcInN0cmluZ1wiIHx8IGNsaWVudFVwZGF0ZWRBdCBpbnN0YW5jZW9mIERhdGUgPyBuZXcgRGF0ZShjbGllbnRVcGRhdGVkQXQpIDogbmV3IERhdGUoKVxuXG4gICAgaWYgKE51bWJlci5pc05hTihjbGllbnRVcGRhdGVkQXREYXRlLmdldFRpbWUoKSkpIGNsaWVudFVwZGF0ZWRBdERhdGUgPSBuZXcgRGF0ZSgpXG5cbiAgICBjb25zdCBub3JtYWxpemVkRGF0YVJlc3VsdCA9IHRoaXMubm9ybWFsaXplUmVwbGF5U3luY0RhdGEoe2RhdGEsIGlkLCByZXNvdXJjZUlkOiByZXNvdXJjZUlkU3RyaW5nLCByZXNvdXJjZVR5cGV9KVxuXG4gICAgaWYgKCFub3JtYWxpemVkRGF0YVJlc3VsdC5vaykgcmV0dXJuIG5vcm1hbGl6ZWREYXRhUmVzdWx0XG5cbiAgICByZXR1cm4ge1xuICAgICAgb2s6IHRydWUsXG4gICAgICBtdXRhdGlvbjoge1xuICAgICAgICBiYXNlVmVyc2lvbjogc3luYy5iYXNlVmVyc2lvbixcbiAgICAgICAgY2xpZW50TXV0YXRpb25JZCxcbiAgICAgICAgY2xpZW50VXBkYXRlZEF0OiBjbGllbnRVcGRhdGVkQXREYXRlLFxuICAgICAgICBkYXRhOiBub3JtYWxpemVkRGF0YVJlc3VsdC5kYXRhLFxuICAgICAgICBpZCxcbiAgICAgICAgcmVzb3VyY2VJZDogcmVzb3VyY2VJZFN0cmluZyxcbiAgICAgICAgcmVzb3VyY2VUeXBlLFxuICAgICAgICBzZXJpYWxpemVkRGF0YTogSlNPTi5zdHJpbmdpZnkobm9ybWFsaXplZERhdGFSZXN1bHQuZGF0YSksXG4gICAgICAgIHN5bmNUeXBlXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZXMgb25lIHN5bmMgZGF0YSBwYXlsb2FkLlxuICAgKiBAcGFyYW0ge3tkYXRhOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgaWQ6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCByZXNvdXJjZUlkOiBzdHJpbmcsIHJlc291cmNlVHlwZTogc3RyaW5nfX0gYXJncyAtIFN5bmMgcGF5bG9hZCBub3JtYWxpemF0aW9uIGFyZ3VtZW50cy5cbiAgICogQHJldHVybnMge3tvazogdHJ1ZSwgZGF0YTogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSB8IHtvazogZmFsc2UsIHJlc3BvbnNlOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59fSBOb3JtYWxpemVkIHBheWxvYWQgb3IgZmFpbGVkIHJlc3BvbnNlLlxuICAgKi9cbiAgbm9ybWFsaXplUmVwbGF5U3luY0RhdGEoe2RhdGEsIGlkLCByZXNvdXJjZUlkLCByZXNvdXJjZVR5cGV9KSB7XG4gICAgaWYgKGRhdGEgPT09IHVuZGVmaW5lZCB8fCBkYXRhID09PSBudWxsKSByZXR1cm4ge29rOiB0cnVlLCBkYXRhOiB7fX1cblxuICAgIGlmICh0eXBlb2YgZGF0YSA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcGFyc2VkRGF0YSA9IEpTT04ucGFyc2UoZGF0YSlcblxuICAgICAgICBpZiAoIXBhcnNlZERhdGEgfHwgdHlwZW9mIHBhcnNlZERhdGEgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShwYXJzZWREYXRhKSkgcmV0dXJuIHtvazogdHJ1ZSwgZGF0YToge319XG5cbiAgICAgICAgcmV0dXJuIHtvazogdHJ1ZSwgZGF0YTogLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChwYXJzZWREYXRhKX1cbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLndhcm4/LihcIkludmFsaWQgc3luYyBkYXRhIEpTT05cIiwge2Vycm9yLCBpZCwgcmVzb3VyY2VJZCwgcmVzb3VyY2VUeXBlfSlcbiAgICAgICAgcmV0dXJuIHtvazogZmFsc2UsIHJlc3BvbnNlOiB7aWQsIHN5bmNTdGF0ZTogXCJmYWlsZWRcIiwgcmVhc29uOiBcImludmFsaWQtZGF0YVwifX1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIGRhdGEgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShkYXRhKSkgcmV0dXJuIHtvazogdHJ1ZSwgZGF0YToge319XG5cbiAgICByZXR1cm4ge29rOiB0cnVlLCBkYXRhOiBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KGRhdGEpKX1cbiAgfVxuXG4gIC8qKlxuICAgKiBBdXRob3JpemVzIG9uZSBub3JtYWxpemVkIG11dGF0aW9uLlxuICAgKiBAcGFyYW0ge3thY3RvcjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGNvbnRleHQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgbXV0YXRpb246IGltcG9ydChcIi4vc3luYy1lbnZlbG9wZS1yZXBsYXktc2VydmljZS5qc1wiKS5TeW5jUmVwbGF5TXV0YXRpb259fSBfYXJncyAtIEFjdG9yLCBiYXRjaCBjb250ZXh0LCBhbmQgbXV0YXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHthbGxvd2VkOiBib29sZWFuLCByZWFzb24/OiBzdHJpbmd9Pn0gQWNjZXNzIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGF1dGhvcml6ZVJlcGxheU11dGF0aW9uKF9hcmdzKSB7XG4gICAgcmV0dXJuIHthbGxvd2VkOiB0cnVlfVxuICB9XG5cbiAgLyoqXG4gICAqIExvYWRzIHRoZSBwcmV2aW91c2x5IHN0b3JlZCBzeW5jL2NoYW5nZSByb3cgZm9yIHN0YWxlLWNsaWVudCBjb21wYXJpc29uLlxuICAgKlxuICAgKiBEZWZhdWx0cyB0byBhIHN5bmMtbW9kZWwgbG9va3VwIGJ5IGFjdG9yIGFuZCByZXNvdXJjZSBpZGVudGl0eSB3aGVuIGEgc3luY1xuICAgKiBtb2RlbCBpcyBjb25maWd1cmVkOyBvdGhlcndpc2UgYXBwcyBvdmVycmlkZSB0aGlzIGhvb2suXG4gICAqIEBwYXJhbSB7e2FjdG9yOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgY29udGV4dDogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBtdXRhdGlvbjogaW1wb3J0KFwiLi9zeW5jLWVudmVsb3BlLXJlcGxheS1zZXJ2aWNlLmpzXCIpLlN5bmNSZXBsYXlNdXRhdGlvbn19IGFyZ3MgLSBBY3RvciwgYmF0Y2ggY29udGV4dCwgYW5kIG11dGF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IEV4aXN0aW5nIHN5bmMgcm93LlxuICAgKi9cbiAgYXN5bmMgZmluZEV4aXN0aW5nUmVwbGF5U3luYyh7YWN0b3IsIG11dGF0aW9ufSkge1xuICAgIGlmICghdGhpcy5zeW5jTW9kZWwpIHJldHVybiBudWxsXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5zeW5jTW9kZWwuZmluZEJ5KHtcbiAgICAgIFt0aGlzLmFjdG9yRm9yZWlnbktleUNvbHVtbl06IHRoaXMucmVwbGF5QWN0b3JJZChhY3RvciksXG4gICAgICByZXNvdXJjZV9pZDogbXV0YXRpb24ucmVzb3VyY2VJZCxcbiAgICAgIHJlc291cmNlX3R5cGU6IG11dGF0aW9uLnJlc291cmNlVHlwZVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIHBlcnNpc3RlZCBhY3RvciBpZCB1c2VkIGJ5IG1vZGVsLWJhY2tlZCBkZWZhdWx0IGhvb2tzLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhY3RvciAtIEFjdG9yIHJldHVybmVkIGZyb20gYXV0aGVudGljYXRlUmVwbGF5LlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IEFjdG9yIGlkLlxuICAgKi9cbiAgcmVwbGF5QWN0b3JJZChhY3Rvcikge1xuICAgIGlmICghYWN0b3IgfHwgdHlwZW9mIGFjdG9yICE9PSBcIm9iamVjdFwiIHx8IHR5cGVvZiBhY3Rvci5pZCAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jRW52ZWxvcGVSZXBsYXlTZXJ2aWNlIG1vZGVsLWJhY2tlZCBkZWZhdWx0cyByZXF1aXJlIGFuIGFjdG9yIHdpdGggYW4gaWQoKSBtZXRob2QgZnJvbSBhdXRoZW50aWNhdGVSZXBsYXlcIilcbiAgICB9XG5cbiAgICByZXR1cm4gYWN0b3IuaWQoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgd2hldGhlciBhIG5vcm1hbGl6ZWQgbXV0YXRpb24gc2hvdWxkIGJlIGFwcGxpZWQgdG8gZG9tYWluIG1vZGVscy5cbiAgICogQHBhcmFtIHt7YWN0b3I6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBjb250ZXh0OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIGV4aXN0aW5nU3luYzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIG11dGF0aW9uOiBpbXBvcnQoXCIuL3N5bmMtZW52ZWxvcGUtcmVwbGF5LXNlcnZpY2UuanNcIikuU3luY1JlcGxheU11dGF0aW9ufX0gYXJncyAtIEFjdG9yLCBiYXRjaCBjb250ZXh0LCBleGlzdGluZyBzeW5jIHJvdywgYW5kIG11dGF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gV2hldGhlciB0byBhcHBseSB0aGUgbXV0YXRpb24uXG4gICAqL1xuICBhc3luYyBzaG91bGRBcHBseVJlcGxheU11dGF0aW9uKHtleGlzdGluZ1N5bmMsIG11dGF0aW9ufSkge1xuICAgIGNvbnN0IGV4aXN0aW5nQ2xpZW50VXBkYXRlZEF0ID0gdGhpcy5leGlzdGluZ1JlcGxheVN5bmNDbGllbnRVcGRhdGVkQXQoZXhpc3RpbmdTeW5jKVxuXG4gICAgcmV0dXJuICFleGlzdGluZ0NsaWVudFVwZGF0ZWRBdCB8fCBtdXRhdGlvbi5jbGllbnRVcGRhdGVkQXQgPiBleGlzdGluZ0NsaWVudFVwZGF0ZWRBdFxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBjbGllbnQgdGltZXN0YW1wIGZyb20gYW4gZXhpc3Rpbmcgc3luYyByb3cuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGV4aXN0aW5nU3luYyAtIEV4aXN0aW5nIHN5bmMgcm93LlxuICAgKiBAcmV0dXJucyB7RGF0ZSB8IG51bGx9IEV4aXN0aW5nIGNsaWVudCB0aW1lc3RhbXAuXG4gICAqL1xuICBleGlzdGluZ1JlcGxheVN5bmNDbGllbnRVcGRhdGVkQXQoZXhpc3RpbmdTeW5jKSB7XG4gICAgaWYgKCFleGlzdGluZ1N5bmMgfHwgdHlwZW9mIGV4aXN0aW5nU3luYyAhPT0gXCJvYmplY3RcIikgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IHN5bmNSZWNvcmQgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKGV4aXN0aW5nU3luYylcbiAgICBjb25zdCB2YWx1ZSA9IHR5cGVvZiBzeW5jUmVjb3JkLmNsaWVudFVwZGF0ZWRBdCA9PT0gXCJmdW5jdGlvblwiXG4gICAgICA/IHN5bmNSZWNvcmQuY2xpZW50VXBkYXRlZEF0KClcbiAgICAgIDogc3luY1JlY29yZC5jbGllbnRVcGRhdGVkQXRcblxuICAgIGlmICh2YWx1ZSBpbnN0YW5jZW9mIERhdGUpIHJldHVybiB2YWx1ZVxuXG4gICAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJzdHJpbmdcIikgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IHBhcnNlZFZhbHVlID0gbmV3IERhdGUodmFsdWUpXG5cbiAgICByZXR1cm4gTnVtYmVyLmlzTmFOKHBhcnNlZFZhbHVlLmdldFRpbWUoKSkgPyBudWxsIDogcGFyc2VkVmFsdWVcbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVja3Mgd2hldGhlciBhIHNraXBwZWQgbXV0YXRpb24gZXhhY3RseSBtYXRjaGVzIHRoZSBwZXJzaXN0ZWQgcmVwbGF5IHJvdy5cbiAgICogT2xkZXIgZGlzdGluY3QgbXV0YXRpb25zIHJldGFpbiB0aGUgZXN0YWJsaXNoZWQgc3VjY2Vzc2Z1bCBzdGFsZS1za2lwIHJlc3BvbnNlLlxuICAgKiBAcGFyYW0ge3tleGlzdGluZ1N5bmM6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBtdXRhdGlvbjogaW1wb3J0KFwiLi9zeW5jLWVudmVsb3BlLXJlcGxheS1zZXJ2aWNlLmpzXCIpLlN5bmNSZXBsYXlNdXRhdGlvbn19IGFyZ3MgLSBFeGlzdGluZyByb3cgYW5kIGluY29taW5nIG11dGF0aW9uLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gV2hldGhlciB0aGlzIGlzIGEgZHVwbGljYXRlIHJlcGxheS5cbiAgICovXG4gIGlzRHVwbGljYXRlUmVwbGF5TXV0YXRpb24oe2V4aXN0aW5nU3luYywgbXV0YXRpb259KSB7XG4gICAgaWYgKCFleGlzdGluZ1N5bmMpIHJldHVybiBmYWxzZVxuXG4gICAgY29uc3QgbWV0YWRhdGEgPSB0aGlzLnJlcGxheVBlcnNpc3RlZE1ldGFkYXRhKGV4aXN0aW5nU3luYylcblxuICAgIGlmIChtZXRhZGF0YSkge1xuICAgICAgcmV0dXJuIG1ldGFkYXRhLmNsaWVudE11dGF0aW9uSWQgPT09IFN0cmluZyhtdXRhdGlvbi5jbGllbnRNdXRhdGlvbklkIHx8IG11dGF0aW9uLmlkKVxuICAgICAgICAmJiBtZXRhZGF0YS5wYXlsb2FkRmluZ2VycHJpbnQgPT09IHNoYTI1NkhleChtdXRhdGlvbi5zZXJpYWxpemVkRGF0YSlcbiAgICB9XG5cbiAgICBjb25zdCBleGlzdGluZ0NsaWVudFVwZGF0ZWRBdCA9IHRoaXMuZXhpc3RpbmdSZXBsYXlTeW5jQ2xpZW50VXBkYXRlZEF0KGV4aXN0aW5nU3luYylcbiAgICBjb25zdCBleGlzdGluZ0RhdGEgPSB0aGlzLnJlcGxheVN5bmNSZWNvcmRWYWx1ZShleGlzdGluZ1N5bmMsIFwiZGF0YVwiKVxuICAgIGNvbnN0IGV4aXN0aW5nU3luY1R5cGUgPSB0aGlzLnJlcGxheVN5bmNSZWNvcmRWYWx1ZShleGlzdGluZ1N5bmMsIFwic3luY1R5cGVcIilcbiAgICBjb25zdCBzZXJpYWxpemVkRXhpc3RpbmdEYXRhID0gdHlwZW9mIGV4aXN0aW5nRGF0YSA9PT0gXCJzdHJpbmdcIiA/IGV4aXN0aW5nRGF0YSA6IEpTT04uc3RyaW5naWZ5KGV4aXN0aW5nRGF0YSlcblxuICAgIHJldHVybiBleGlzdGluZ0NsaWVudFVwZGF0ZWRBdD8uZ2V0VGltZSgpID09PSBtdXRhdGlvbi5jbGllbnRVcGRhdGVkQXQuZ2V0VGltZSgpXG4gICAgICAmJiBzZXJpYWxpemVkRXhpc3RpbmdEYXRhID09PSBtdXRhdGlvbi5zZXJpYWxpemVkRGF0YVxuICAgICAgJiYgZXhpc3RpbmdTeW5jVHlwZSA9PT0gbXV0YXRpb24uc3luY1R5cGVcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkcyBhIG1vZGVsLWJhY2tlZCBzeW5jLXJvdyB2YWx1ZSB0aHJvdWdoIGl0cyBhY2Nlc3NvciBvciBwbGFpbiBwcm9wZXJ0eS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gc3luY1JlY29yZCAtIEV4aXN0aW5nIHN5bmMgcm93LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0cmlidXRlTmFtZSAtIEF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IFN0b3JlZCB2YWx1ZS5cbiAgICovXG4gIHJlcGxheVN5bmNSZWNvcmRWYWx1ZShzeW5jUmVjb3JkLCBhdHRyaWJ1dGVOYW1lKSB7XG4gICAgY29uc3QgcmVjb3JkID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChzeW5jUmVjb3JkKVxuICAgIGNvbnN0IHZhbHVlID0gcmVjb3JkW2F0dHJpYnV0ZU5hbWVdXG5cbiAgICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSBcImZ1bmN0aW9uXCIgPyB2YWx1ZS5jYWxsKHN5bmNSZWNvcmQpIDogdmFsdWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkcyBkdXJhYmxlIHJlcGxheSBhY2tub3dsZWRnZW1lbnQgbWV0YWRhdGEgZnJvbSBhIG1vZGVsLWJhY2tlZCBzeW5jIHJvdy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gc3luY1JlY29yZCAtIEV4aXN0aW5nIHN5bmMgcm93LlxuICAgKiBAcmV0dXJucyB7e2Fja25vd2xlZGdlbWVudFZlcnNpb246IHN0cmluZyB8IG51bWJlciB8IG51bGwsIGNsaWVudE11dGF0aW9uSWQ6IHN0cmluZywgcGF5bG9hZEZpbmdlcnByaW50OiBzdHJpbmd9IHwgbnVsbH0gUGVyc2lzdGVkIG1ldGFkYXRhLlxuICAgKi9cbiAgcmVwbGF5UGVyc2lzdGVkTWV0YWRhdGEoc3luY1JlY29yZCkge1xuICAgIGlmICghc3luY1JlY29yZCkgcmV0dXJuIG51bGxcblxuICAgIHJldHVybiBkZWNvZGVSZXBsYXlQZXJzaXN0ZWREYXRhKHRoaXMucmVwbGF5U3luY1JlY29yZFZhbHVlKHN5bmNSZWNvcmQsIFwiZGF0YVwiKSkubWV0YWRhdGFcbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBsaWVzIG9uZSBub3JtYWxpemVkIG11dGF0aW9uIHRvIGRvbWFpbiBtb2RlbHMuXG4gICAqXG4gICAqIERpc3BhdGNoZXMgdGhyb3VnaCB0aGUgY29uZmlndXJlZCBhcHBseS1oYW5kbGVyIHJlZ2lzdHJ5IGZpcnN0IChjb21wYXRcbiAgICogcHJlY2VkZW5jZSk7IG11dGF0aW9ucyB3aXRob3V0IGEgbWF0Y2hpbmcgaGFuZGxlciBmYWxsIHRocm91Z2ggdG9cbiAgICogcmVzb3VyY2Ugcm91dGluZyB3aGVuIGEgY29uZmlndXJhdGlvbiBvciByZXNvdXJjZVR5cGVPdmVycmlkZXMgYXJlXG4gICAqIGNvbmZpZ3VyZWQsIGFuZCBvdGhlcndpc2UgZmFpbCBsb3VkbHkuXG4gICAqIEBwYXJhbSB7e2FjdG9yOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgY29udGV4dDogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBleGlzdGluZ1N5bmM6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBtdXRhdGlvbjogaW1wb3J0KFwiLi9zeW5jLWVudmVsb3BlLXJlcGxheS1zZXJ2aWNlLmpzXCIpLlN5bmNSZXBsYXlNdXRhdGlvbn19IGFyZ3MgLSBBY3RvciwgYmF0Y2ggY29udGV4dCwgZXhpc3Rpbmcgc3luYyByb3csIGFuZCBtdXRhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBQcm9qZWN0LXNwZWNpZmljIGFwcGx5IHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGFwcGx5UmVwbGF5TXV0YXRpb24oYXJncykge1xuICAgIGlmICh0aGlzLmFwcGx5SGFuZGxlcnMpIHtcbiAgICAgIGNvbnN0IGFwcGx5SGFuZGxlciA9IHRoaXMuYXBwbHlIYW5kbGVyc1thcmdzLm11dGF0aW9uLnJlc291cmNlVHlwZV1cblxuICAgICAgaWYgKGFwcGx5SGFuZGxlcikgcmV0dXJuIGF3YWl0IGFwcGx5SGFuZGxlcihhcmdzKVxuICAgICAgaWYgKCF0aGlzLnJvdXRpbmdDb25maWd1cmVkKCkpIHRocm93IG5ldyBFcnJvcihgTm8gc3luYyBhcHBseSBoYW5kbGVyIHJlZ2lzdGVyZWQgZm9yOiAke2FyZ3MubXV0YXRpb24ucmVzb3VyY2VUeXBlfWApXG4gICAgfVxuXG4gICAgaWYgKHRoaXMucm91dGluZ0NvbmZpZ3VyZWQoKSkgcmV0dXJuIGF3YWl0IHRoaXMuYXBwbHlSb3V0ZWRSZXBsYXlNdXRhdGlvbihhcmdzKVxuXG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHdoZXRoZXIgcmVzb3VyY2Ugcm91dGluZyBpcyBjb25maWd1cmVkIG9uIHRoaXMgc2VydmljZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IFdoZXRoZXIgbXV0YXRpb25zIHJvdXRlIHRvIGZyb250ZW5kLW1vZGVsIHJlc291cmNlcy5cbiAgICovXG4gIHJvdXRpbmdDb25maWd1cmVkKCkge1xuICAgIHJldHVybiBCb29sZWFuKHRoaXMuY29uZmlndXJhdGlvbiB8fCB0aGlzLnJlc291cmNlVHlwZU92ZXJyaWRlcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgcm91dGVkIHJlc291cmNlIHJlZ2lzdHJhdGlvbiBmb3IgYSByZXNvdXJjZSB0eXBlLCBtZW1vaXplZFxuICAgKiBwZXIgcmVwbGF5IHNlcnZpY2UuIE92ZXJyaWRlcyB3aW4gb3ZlciB0aGUgY29uZmlndXJhdGlvbiByZWdpc3RyeTsgc3RyaW5nXG4gICAqIG92ZXJyaWRlcyBhcmUgYWxpYXNlcyByZXNvbHZlZCB0aHJvdWdoIHRoZSByZWdpc3RyeS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJlc291cmNlVHlwZSAtIE11dGF0aW9uIHJlc291cmNlIHR5cGUuXG4gICAqIEByZXR1cm5zIHtTeW5jUmVwbGF5UmVzb3VyY2VSZWdpc3RyYXRpb24gfCBudWxsfSBSZXNvbHZlZCByZWdpc3RyYXRpb24gb3IgbnVsbCB3aGVuIHVucm91dGFibGUuXG4gICAqL1xuICByZXBsYXlSZXNvdXJjZVJlZ2lzdHJhdGlvbihyZXNvdXJjZVR5cGUpIHtcbiAgICBjb25zdCBtZW1vaXplZFJlZ2lzdHJhdGlvbiA9IHRoaXMuX3JlcGxheVJlc291cmNlUmVnaXN0cmF0aW9ucy5nZXQocmVzb3VyY2VUeXBlKVxuXG4gICAgaWYgKG1lbW9pemVkUmVnaXN0cmF0aW9uICE9PSB1bmRlZmluZWQpIHJldHVybiBtZW1vaXplZFJlZ2lzdHJhdGlvblxuXG4gICAgY29uc3QgcmVnaXN0cmF0aW9uID0gdGhpcy5yZXNvbHZlUmVwbGF5UmVzb3VyY2VSZWdpc3RyYXRpb24ocmVzb3VyY2VUeXBlKVxuXG4gICAgdGhpcy5fcmVwbGF5UmVzb3VyY2VSZWdpc3RyYXRpb25zLnNldChyZXNvdXJjZVR5cGUsIHJlZ2lzdHJhdGlvbilcblxuICAgIHJldHVybiByZWdpc3RyYXRpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBVbmNhY2hlZCByb3V0ZWQtcmVzb3VyY2UgcmVzb2x1dGlvbiBiZWhpbmQge0BsaW5rIFN5bmNFbnZlbG9wZVJlcGxheVNlcnZpY2UjcmVwbGF5UmVzb3VyY2VSZWdpc3RyYXRpb259LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVzb3VyY2VUeXBlIC0gTXV0YXRpb24gcmVzb3VyY2UgdHlwZS5cbiAgICogQHJldHVybnMge1N5bmNSZXBsYXlSZXNvdXJjZVJlZ2lzdHJhdGlvbiB8IG51bGx9IFJlc29sdmVkIHJlZ2lzdHJhdGlvbiBvciBudWxsIHdoZW4gdW5yb3V0YWJsZS5cbiAgICovXG4gIHJlc29sdmVSZXBsYXlSZXNvdXJjZVJlZ2lzdHJhdGlvbihyZXNvdXJjZVR5cGUpIHtcbiAgICBjb25zdCBvdmVycmlkZSA9IHRoaXMucmVzb3VyY2VUeXBlT3ZlcnJpZGVzPy5bcmVzb3VyY2VUeXBlXVxuXG4gICAgaWYgKG92ZXJyaWRlICYmIHR5cGVvZiBvdmVycmlkZSAhPT0gXCJzdHJpbmdcIikge1xuICAgICAgcmV0dXJuIHttb2RlbE5hbWU6IHJlc291cmNlVHlwZSwgcmVzb3VyY2VDbGFzczogb3ZlcnJpZGUsIHJlc291cmNlQ29uZmlndXJhdGlvbjogbnVsbH1cbiAgICB9XG5cbiAgICBjb25zdCByZWdpc3RyeVJlc291cmNlVHlwZSA9IHR5cGVvZiBvdmVycmlkZSA9PT0gXCJzdHJpbmdcIiA/IG92ZXJyaWRlIDogcmVzb3VyY2VUeXBlXG5cbiAgICBpZiAoIXRoaXMuY29uZmlndXJhdGlvbikgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IHJlc29sdmVkUmVnaXN0cmF0aW9uID0gcmVzb2x2ZUZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzKHtjb25maWd1cmF0aW9uOiB0aGlzLmNvbmZpZ3VyYXRpb24sIHJlc291cmNlVHlwZTogcmVnaXN0cnlSZXNvdXJjZVR5cGV9KVxuXG4gICAgaWYgKCFyZXNvbHZlZFJlZ2lzdHJhdGlvbikgcmV0dXJuIG51bGxcblxuICAgIHJldHVybiB7XG4gICAgICBtb2RlbE5hbWU6IHJlc29sdmVkUmVnaXN0cmF0aW9uLm1vZGVsTmFtZSxcbiAgICAgIHJlc291cmNlQ2xhc3M6IHJlc29sdmVkUmVnaXN0cmF0aW9uLnJlc291cmNlQ2xhc3MsXG4gICAgICByZXNvdXJjZUNvbmZpZ3VyYXRpb246IHJlc29sdmVkUmVnaXN0cmF0aW9uLnJlc291cmNlQ29uZmlndXJhdGlvblxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgYWJpbGl0eSBhbmQgcmVzb3VyY2UgY29udGV4dCB1c2VkIHRvIGF1dGhvcml6ZSByb3V0ZWRcbiAgICogcmVzb3VyY2VzLiBEZWZhdWx0cyB0byB0aGUgY29uc3RydWN0b3Itd2lkZSBhYmlsaXR5L2FiaWxpdHlDb250ZXh0O1xuICAgKiBzdWJjbGFzc2VzIChzaWduZWQgcmVwbGF5KSBvdmVycmlkZSB0aGlzIHRvIGRlcml2ZSBhdXRob3JpemF0aW9uIGZyb20gYVxuICAgKiB2ZXJpZmllZCBhY3Rvci9ncmFudCBpbnN0ZWFkIG9mIHVwbG9hZGVyLWdsb2JhbCBzdGF0ZS5cbiAgICogQHBhcmFtIHt7YWN0b3I6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBjb250ZXh0OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59fSBfYXJncyAtIFJlcGxheSBhY3RvciBhbmQgYmF0Y2ggY29udGV4dC5cbiAgICogQHJldHVybnMge1Byb21pc2U8e2FiaWxpdHk6IGltcG9ydChcIi4uL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkLCBhYmlsaXR5Q29udGV4dDogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fT59IEFiaWxpdHkgYW5kIHJlc291cmNlIGNvbnRleHQuXG4gICAqL1xuICBhc3luYyByZXBsYXlBYmlsaXR5Rm9yKF9hcmdzKSB7XG4gICAgcmV0dXJuIHthYmlsaXR5OiB0aGlzLmFiaWxpdHkgfHwgdW5kZWZpbmVkLCBhYmlsaXR5Q29udGV4dDogdGhpcy5hYmlsaXR5Q29udGV4dCB8fCB7fX1cbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIHJvdXRlZCByZXNvdXJjZSBpbnN0YW5jZSBoYW5kbGluZyBvbmUgbXV0YXRpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5hY3RvciAtIFJlcGxheSBhY3Rvci5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuY29udGV4dCAtIFJlcGxheSBjb250ZXh0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vc3luYy1lbnZlbG9wZS1yZXBsYXktc2VydmljZS5qc1wiKS5TeW5jUmVwbGF5TXV0YXRpb259IGFyZ3MubXV0YXRpb24gLSBOb3JtYWxpemVkIHJlcGxheSBtdXRhdGlvbi5cbiAgICogQHBhcmFtIHtTeW5jUmVwbGF5UmVzb3VyY2VSZWdpc3RyYXRpb259IGFyZ3MucmVnaXN0cmF0aW9uIC0gUmVzb2x2ZWQgcmVzb3VyY2UgcmVnaXN0cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuLi9mcm9udGVuZC1tb2RlbC1yZXNvdXJjZS9iYXNlLXJlc291cmNlLmpzXCIpLmRlZmF1bHQ+fSBSb3V0ZWQgcmVzb3VyY2UgaW5zdGFuY2UuXG4gICAqL1xuICBhc3luYyBidWlsZFJlcGxheVJlc291cmNlKHthY3RvciwgY29udGV4dCwgbXV0YXRpb24sIHJlZ2lzdHJhdGlvbn0pIHtcbiAgICBjb25zdCBSZXNvdXJjZUNsYXNzID0gZnJvbnRlbmRNb2RlbFJlc291cmNlSW50ZXJuYWxDb25zdHJ1Y3RvcihyZWdpc3RyYXRpb24ucmVzb3VyY2VDbGFzcylcbiAgICBjb25zdCB7YWJpbGl0eSwgYWJpbGl0eUNvbnRleHR9ID0gYXdhaXQgdGhpcy5yZXBsYXlBYmlsaXR5Rm9yKHthY3RvciwgY29udGV4dH0pXG5cbiAgICByZXR1cm4gbmV3IFJlc291cmNlQ2xhc3Moe1xuICAgICAgYWJpbGl0eSxcbiAgICAgIGNvbnRleHQ6IGFiaWxpdHlDb250ZXh0LFxuICAgICAgbG9jYWxzOiB7Li4uKHRoaXMubG9jYWxzIHx8IHt9KSwgLi4uKHRoaXMuY29uZmlndXJhdGlvbiA/IHtjb25maWd1cmF0aW9uOiB0aGlzLmNvbmZpZ3VyYXRpb259IDoge30pfSxcbiAgICAgIG1vZGVsTmFtZTogcmVnaXN0cmF0aW9uLm1vZGVsTmFtZSxcbiAgICAgIHBhcmFtczogbXV0YXRpb24uZGF0YSxcbiAgICAgIC4uLihyZWdpc3RyYXRpb24ucmVzb3VyY2VDb25maWd1cmF0aW9uID8ge3Jlc291cmNlQ29uZmlndXJhdGlvbjogcmVnaXN0cmF0aW9uLnJlc291cmNlQ29uZmlndXJhdGlvbn0gOiB7fSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIEFwcGxpZXMgb25lIG11dGF0aW9uIHRocm91Z2ggaXRzIHJvdXRlZCBmcm9udGVuZC1tb2RlbCByZXNvdXJjZTpcbiAgICogYXV0aG9yaXphdGlvbiwgYWJpbGl0eS1zY29wZWQgcmVjb3JkIGxvb2t1cCwgc2NoZW1hIG5vcm1hbGl6YXRpb24gYW5kXG4gICAqIGFzc2lnbi9zYXZlIGZvciB1cGRhdGVzLCBzYXZlLXRoZW4tY2hlY2sgbWVtYmVyc2hpcCBjcmVhdGVzLCBkZXN0cm95cyBmb3JcbiAgICogZGVsZXRlcywgYW5kIHRoZSByZXNvdXJjZSdzIGFmdGVyU3luY0FwcGx5IHRhaWwuIENsaWVudC1zYWZlIGZhaWx1cmVzXG4gICAqIHRocm93IHNhZmUgZXJyb3JzIHRoYXQgZmFpbCB0aGUgc2luZ2xlIHN5bmMuXG4gICAqIEBwYXJhbSB7e2FjdG9yOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgY29udGV4dDogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBleGlzdGluZ1N5bmM6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBtdXRhdGlvbjogaW1wb3J0KFwiLi9zeW5jLWVudmVsb3BlLXJlcGxheS1zZXJ2aWNlLmpzXCIpLlN5bmNSZXBsYXlNdXRhdGlvbn19IGFyZ3MgLSBBY3RvciwgYmF0Y2ggY29udGV4dCwgZXhpc3Rpbmcgc3luYyByb3csIGFuZCBtdXRhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gQXBwbHkgcmVzdWx0IHdpdGggcmVjb3JkLCBjcmVhdGVkL2RlbGV0ZWQgZmxhZ3MsIGFuZCBhZnRlclN5bmNBcHBseSBleHRyYXMuXG4gICAqL1xuICBhc3luYyBhcHBseVJvdXRlZFJlcGxheU11dGF0aW9uKHthY3RvciwgY29udGV4dCwgZXhpc3RpbmdTeW5jLCBtdXRhdGlvbn0pIHtcbiAgICBjb25zdCByZWdpc3RyYXRpb24gPSB0aGlzLnJlcGxheVJlc291cmNlUmVnaXN0cmF0aW9uKG11dGF0aW9uLnJlc291cmNlVHlwZSlcblxuICAgIGlmICghcmVnaXN0cmF0aW9uKSB7XG4gICAgICB0aHJvdyBWZWxvY2lvdXNFcnJvci5zYWZlKGBVbmtub3duIHN5bmMgcmVzb3VyY2UgdHlwZTogJHttdXRhdGlvbi5yZXNvdXJjZVR5cGV9LmAsIHtjb2RlOiBcInVua25vd24tcmVzb3VyY2UtdHlwZVwifSlcbiAgICB9XG5cbiAgICBjb25zdCByZXNvdXJjZSA9IGF3YWl0IHRoaXMuYnVpbGRSZXBsYXlSZXNvdXJjZSh7YWN0b3IsIGNvbnRleHQsIG11dGF0aW9uLCByZWdpc3RyYXRpb259KVxuICAgIGNvbnN0IGN1c3RvbUFwcGx5UmVzdWx0ID0gYXdhaXQgcmVzb3VyY2UuYXBwbHlTeW5jKHtjb250ZXh0LCBleGlzdGluZ1N5bmMsIG11dGF0aW9ufSlcblxuICAgIGlmIChjdXN0b21BcHBseVJlc3VsdCAhPT0gbnVsbCkgcmV0dXJuIGN1c3RvbUFwcGx5UmVzdWx0XG5cbiAgICBjb25zdCBhdXRob3JpemF0aW9uID0gYXdhaXQgcmVzb3VyY2UuYXV0aG9yaXplU3luY011dGF0aW9uKHtjb250ZXh0LCBtdXRhdGlvbn0pXG5cbiAgICBpZiAoIWF1dGhvcml6YXRpb24uYWxsb3dlZCkge1xuICAgICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShgU3luYyBtdXRhdGlvbiBkZW5pZWQgZm9yOiAke211dGF0aW9uLnJlc291cmNlVHlwZX0uYCwge2NvZGU6IGF1dGhvcml6YXRpb24ucmVhc29uIHx8IFwiYWNjZXNzLWRlbmllZFwifSlcbiAgICB9XG5cbiAgICBpZiAobXV0YXRpb24uc3luY1R5cGUgPT09IFwiZGVsZXRlXCIpIHJldHVybiBhd2FpdCB0aGlzLmFwcGx5Um91dGVkUmVwbGF5RGVsZXRlKHttdXRhdGlvbiwgcmVzb3VyY2V9KVxuXG4gICAgY29uc3QgY29tbWFuZEFwcGx5UmVzdWx0ID0gYXdhaXQgdGhpcy5hcHBseVJvdXRlZFJlcGxheUNvbW1hbmQoe2NvbnRleHQsIG11dGF0aW9uLCByZXNvdXJjZX0pXG5cbiAgICBpZiAoY29tbWFuZEFwcGx5UmVzdWx0ICE9PSBudWxsKSByZXR1cm4gY29tbWFuZEFwcGx5UmVzdWx0XG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5hcHBseVJvdXRlZFJlcGxheVVwc2VydCh7Y29udGV4dCwgbXV0YXRpb24sIHJlc291cmNlfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBEaXNwYXRjaGVzIGEgcm91dGVkIHN5bmMgbXV0YXRpb24gd2hvc2Ugc3luY1R5cGUgbWF0Y2hlcyBhIHJlc291cmNlLWRlY2xhcmVkXG4gICAqIGN1c3RvbSBjb21tYW5kLiBSZXR1cm5zIG51bGwgd2hlbiB0aGUgbXV0YXRpb24gaXMgbm90IGEgY29tbWFuZCBzbyB0aGVcbiAgICogY2FsbGVyIGNhbiBmYWxsIHRocm91Z2ggdG8gdGhlIGRlZmF1bHQgdXBzZXJ0IHBhdGguXG4gICAqIEBwYXJhbSB7e2NvbnRleHQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgbXV0YXRpb246IGltcG9ydChcIi4vc3luYy1lbnZlbG9wZS1yZXBsYXktc2VydmljZS5qc1wiKS5TeW5jUmVwbGF5TXV0YXRpb24sIHJlc291cmNlOiBpbXBvcnQoXCIuLi9mcm9udGVuZC1tb2RlbC1yZXNvdXJjZS9iYXNlLXJlc291cmNlLmpzXCIpLmRlZmF1bHR9fSBhcmdzIC0gQ29tbWFuZCBkaXNwYXRjaCBhcmdzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBudWxsPn0gQ29tbWFuZCBhcHBseSByZXN1bHQgb3IgbnVsbC5cbiAgICovXG4gIGFzeW5jIGFwcGx5Um91dGVkUmVwbGF5Q29tbWFuZCh7Y29udGV4dCwgbXV0YXRpb24sIHJlc291cmNlfSkge1xuICAgIGNvbnN0IGNvbW1hbmRDb25maWcgPSB0aGlzLnJlc291cmNlQ29tbWFuZENvbmZpZyhyZXNvdXJjZSlcbiAgICBjb25zdCBjb21tYW5kTWV0aG9kTmFtZSA9IHRoaXMuY29tbWFuZE1ldGhvZE5hbWVGb3JTeW5jVHlwZSh7Y29tbWFuZENvbmZpZywgc3luY1R5cGU6IG11dGF0aW9uLnN5bmNUeXBlfSlcblxuICAgIGlmICghY29tbWFuZE1ldGhvZE5hbWUpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCBjb21tYW5kTWV0aG9kID0gcmVzb3VyY2UucmVzb3VyY2VNZXRob2QoY29tbWFuZE1ldGhvZE5hbWUpXG5cbiAgICBpZiAoIWNvbW1hbmRNZXRob2QpIHtcbiAgICAgIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoYFN5bmMgY29tbWFuZCBoYW5kbGVyIG1pc3NpbmcgZm9yOiAke211dGF0aW9uLnJlc291cmNlVHlwZX0uJHttdXRhdGlvbi5zeW5jVHlwZX0uYCwge2NvZGU6IFwic3luYy1jb21tYW5kLWhhbmRsZXItbWlzc2luZ1wifSlcbiAgICB9XG5cbiAgICBjb25zdCBhcmdzID0gdGhpcy5jb21tYW5kQXJnc0Zvck11dGF0aW9uKHtjb21tYW5kQ29uZmlnLCBjb21tYW5kTWV0aG9kTmFtZSwgbXV0YXRpb259KVxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGNvbW1hbmRNZXRob2QubWV0aG9kLmNhbGwoY29tbWFuZE1ldGhvZC5yZXNvdXJjZSwgYXJncylcblxuICAgIGNvbnN0IGFmdGVyRXh0cmFzID0gYXdhaXQgcmVzb3VyY2UuYWZ0ZXJTeW5jQXBwbHkoe2NvbnRleHQsIGNyZWF0ZWQ6IGZhbHNlLCBtdXRhdGlvbiwgcmVjb3JkOiBudWxsfSlcbiAgICBjb25zdCByZXN1bHRPYmplY3QgPSByZXN1bHQgJiYgdHlwZW9mIHJlc3VsdCA9PT0gXCJvYmplY3RcIiAmJiAhQXJyYXkuaXNBcnJheShyZXN1bHQpID8gcmVzdWx0IDoge31cblxuICAgIHJldHVybiB7Y29tbWFuZFJlc3VsdDogcmVzdWx0LCBjcmVhdGVkOiBmYWxzZSwgZGVsZXRlZDogZmFsc2UsIHJlY29yZDogbnVsbCwgLi4ucmVzdWx0T2JqZWN0LCAuLi5hZnRlckV4dHJhc31cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgY3VzdG9tLWNvbW1hbmQgY29uZmlndXJhdGlvbiBkZWNsYXJlZCBvbiBhIHJvdXRlZCByZXNvdXJjZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9mcm9udGVuZC1tb2RlbC1yZXNvdXJjZS9iYXNlLXJlc291cmNlLmpzXCIpLmRlZmF1bHR9IHJlc291cmNlIC0gUm91dGVkIHJlc291cmNlIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7e2NvbGxlY3Rpb25Db21tYW5kczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiwgbWVtYmVyQ29tbWFuZHM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz59fSBDb21tYW5kIGNvbmZpZy5cbiAgICovXG4gIHJlc291cmNlQ29tbWFuZENvbmZpZyhyZXNvdXJjZSkge1xuICAgIGNvbnN0IGNvbmZpZyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAocmVzb3VyY2UucmVzb3VyY2VDb25maWd1cmF0aW9uVmFsdWUgfHwge30pXG5cbiAgICByZXR1cm4ge1xuICAgICAgY29sbGVjdGlvbkNvbW1hbmRzOiBjb25maWcuY29sbGVjdGlvbkNvbW1hbmRzIHx8IHt9LFxuICAgICAgbWVtYmVyQ29tbWFuZHM6IGNvbmZpZy5tZW1iZXJDb21tYW5kcyB8fCB7fVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgcmVzb3VyY2UgbWV0aG9kIG5hbWUgZm9yIGEgc3luY1R5cGUgd2hlbiBpdCBuYW1lcyBhIGRlY2xhcmVkXG4gICAqIGN1c3RvbSBjb21tYW5kLlxuICAgKiBAcGFyYW0ge3tjb21tYW5kQ29uZmlnOiB7Y29sbGVjdGlvbkNvbW1hbmRzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+LCBtZW1iZXJDb21tYW5kczogUmVjb3JkPHN0cmluZywgc3RyaW5nPn0sIHN5bmNUeXBlOiBzdHJpbmd9fSBhcmdzIC0gTG9va3VwIGFyZ3MuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudWxsfSBNZXRob2QgbmFtZSBvciBudWxsLlxuICAgKi9cbiAgY29tbWFuZE1ldGhvZE5hbWVGb3JTeW5jVHlwZSh7Y29tbWFuZENvbmZpZywgc3luY1R5cGV9KSB7XG4gICAgaWYgKGNvbW1hbmRDb25maWcubWVtYmVyQ29tbWFuZHNbc3luY1R5cGVdKSByZXR1cm4gc3luY1R5cGVcbiAgICBpZiAoY29tbWFuZENvbmZpZy5jb2xsZWN0aW9uQ29tbWFuZHNbc3luY1R5cGVdKSByZXR1cm4gc3luY1R5cGVcblxuICAgIHJldHVybiBudWxsXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSBhcmd1bWVudHMgb2JqZWN0IHBhc3NlZCB0byBhIHJlc291cmNlIGNvbW1hbmQgbWV0aG9kLiBNZW1iZXJcbiAgICogY29tbWFuZHMgcmVjZWl2ZSB0aGUgZW52ZWxvcGUncyByZXNvdXJjZUlkIGFzIGBpZGA7IHRoZSBlbnZlbG9wZSBpZGVudGl0eVxuICAgKiBpcyBhc3NpZ25lZCBhZnRlciB0aGUgcGF5bG9hZCBzbyBhIHBheWxvYWQgYGlkYCBjYW4gbmV2ZXIgcmV0YXJnZXQgdGhlXG4gICAqIGNvbW1hbmQgYXdheSBmcm9tIHRoZSByZXNvdXJjZSB0aGUgYXV0aG9yaXphdGlvbiBob29rcyBhcHByb3ZlZC5cbiAgICogQHBhcmFtIHt7Y29tbWFuZENvbmZpZzoge2NvbGxlY3Rpb25Db21tYW5kczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiwgbWVtYmVyQ29tbWFuZHM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz59LCBjb21tYW5kTWV0aG9kTmFtZTogc3RyaW5nLCBtdXRhdGlvbjogaW1wb3J0KFwiLi9zeW5jLWVudmVsb3BlLXJlcGxheS1zZXJ2aWNlLmpzXCIpLlN5bmNSZXBsYXlNdXRhdGlvbn19IGFyZ3MgLSBBcmdzIGJ1aWxkZXIgYXJncy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gQ29tbWFuZCBtZXRob2QgYXJndW1lbnRzLlxuICAgKi9cbiAgY29tbWFuZEFyZ3NGb3JNdXRhdGlvbih7Y29tbWFuZENvbmZpZywgY29tbWFuZE1ldGhvZE5hbWUsIG11dGF0aW9ufSkge1xuICAgIGNvbnN0IGlzTWVtYmVyID0gY29tbWFuZENvbmZpZy5tZW1iZXJDb21tYW5kc1tjb21tYW5kTWV0aG9kTmFtZV0gIT09IHVuZGVmaW5lZFxuXG4gICAgaWYgKGlzTWVtYmVyKSB7XG4gICAgICByZXR1cm4gey4uLm11dGF0aW9uLmRhdGEsIGlkOiBtdXRhdGlvbi5yZXNvdXJjZUlkfVxuICAgIH1cblxuICAgIHJldHVybiB7Li4ubXV0YXRpb24uZGF0YX1cbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBsaWVzIGEgcm91dGVkIGRlbGV0ZSBtdXRhdGlvbi4gVGhlIHJlY29yZCBpcyBtYXJrZWQgYXMgYSBzZXJ2ZXIgYXBwbHlcbiAgICogZm9yIHRoZSBkdXJhdGlvbiBvZiB0aGUgcmVwbGF5LW93bmVkIGRlc3Ryb3kgLSBhbiBhY3RpdmUgU3luY1B1Ymxpc2hlclxuICAgKiBuZXZlciBwdWJsaXNoZXMgdGhlIHJlcGxheWVkIGRlbGV0ZSBhIHNlY29uZCB0aW1lICh0aGUgcmVwbGF5IG93bnMgaXRzXG4gICAqIG93biBwZXJzaXN0IGFuZCBicm9hZGNhc3RzKSwgd2hpbGUgbGF0ZXIgc2VydmVyLXNpZGUgd3JpdGVzIHRvIHRoZSBzYW1lXG4gICAqIGluc3RhbmNlIHB1Ymxpc2ggbm9ybWFsbHkgYWdhaW4uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3N5bmMtZW52ZWxvcGUtcmVwbGF5LXNlcnZpY2UuanNcIikuU3luY1JlcGxheU11dGF0aW9ufSBhcmdzLm11dGF0aW9uIC0gTm9ybWFsaXplZCByZXBsYXkgbXV0YXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWwtcmVzb3VyY2UvYmFzZS1yZXNvdXJjZS5qc1wiKS5kZWZhdWx0fSBhcmdzLnJlc291cmNlIC0gUm91dGVkIHJlc291cmNlIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSBBcHBseSByZXN1bHQgd2l0aCB0aGUgZGVsZXRlZCBmbGFnLlxuICAgKi9cbiAgYXN5bmMgYXBwbHlSb3V0ZWRSZXBsYXlEZWxldGUoe211dGF0aW9uLCByZXNvdXJjZX0pIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gcmVzb3VyY2UubW9kZWxDbGFzcygpXG4gICAgY29uc3QgcnVuRGVsZXRlID0gYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcmVjb3JkID0gYXdhaXQgcmVzb3VyY2UuZmluZFN5bmNSZWNvcmQoe2ZvckRlbGV0ZTogdHJ1ZSwgbXV0YXRpb259KVxuXG4gICAgICBpZiAoIXJlY29yZCkgcmV0dXJuIHtjcmVhdGVkOiBmYWxzZSwgZGVsZXRlZDogZmFsc2UsIHJlY29yZDogbnVsbH1cblxuICAgICAgY29uc3QgY29uZmxpY3RSZXN1bHQgPSBhd2FpdCB0aGlzLnJvdXRlZFJlcGxheUNvbmZsaWN0UmVzdWx0KHthdHRyaWJ1dGVzOiB7fSwgZXhpc3RpbmdSZWNvcmQ6IHJlY29yZCwgbXV0YXRpb24sIHJlc291cmNlfSlcblxuICAgICAgaWYgKGNvbmZsaWN0UmVzdWx0KSByZXR1cm4gY29uZmxpY3RSZXN1bHRcblxuICAgICAgY29uc3QgcmVsZWFzZVNlcnZlckFwcGx5ID0gbWFya1NlcnZlckFwcGx5KHJlY29yZClcblxuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgcmVjb3JkLmRlc3Ryb3koKVxuICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgcmVsZWFzZVNlcnZlckFwcGx5KClcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHtjcmVhdGVkOiBmYWxzZSwgZGVsZXRlZDogdHJ1ZSwgcmVjb3JkfVxuICAgIH1cblxuICAgIGlmICghdGhpcy5jb25mbGljdFN0cmF0ZWd5KSByZXR1cm4gYXdhaXQgcnVuRGVsZXRlKClcblxuICAgIHJldHVybiBhd2FpdCBNb2RlbENsYXNzLndpdGhBZHZpc29yeUxvY2soc3luY1JlcGxheUNvbmZsaWN0TG9ja05hbWUoe3Jlc291cmNlSWQ6IG11dGF0aW9uLnJlc291cmNlSWQsIHJlc291cmNlVHlwZTogbXV0YXRpb24ucmVzb3VyY2VUeXBlfSksIHJ1bkRlbGV0ZSwge2RlZGljYXRlZENvbm5lY3Rpb246IHRydWV9KVxuICB9XG5cbiAgLyoqXG4gICAqIEFwcGxpZXMgYSByb3V0ZWQgdXBzZXJ0IG11dGF0aW9uOiBwZXJtaXR0ZWQgcGF5bG9hZCBhdHRyaWJ1dGVzIGFyZVxuICAgKiBhc3NpZ25lZCBhbmQgc2F2ZWQgb250byB0aGUgZm91bmQgcmVjb3JkICh0aGUgcmVjb3JkIGxheWVyIG93bnMgdmFsdWVcbiAgICogY2FzdGluZyBhbmQgdmFsaWRhdGlvbiksIGFuZCBtaXNzaW5nIHJlY29yZHMgYXJlIGNyZWF0ZWQgd2l0aCB0aGVcbiAgICogY2xpZW50LWdlbmVyYXRlZCBwcmltYXJ5IGtleSBwbHVzIGEgc2F2ZS10aGVuLWNoZWNrIG1lbWJlcnNoaXAgY2hlY2suXG4gICAqIFdyaXR0ZW4gcmVjb3JkcyBhcmUgbWFya2VkIGFzIHNlcnZlciBhcHBsaWVzIGZvciB0aGUgZHVyYXRpb24gb2YgdGhlXG4gICAqIHJlcGxheS1vd25lZCB3cml0ZSAtIGFuIGFjdGl2ZSBTeW5jUHVibGlzaGVyIG5ldmVyIHB1Ymxpc2hlcyB0aGUgcmVwbGF5ZWRcbiAgICogbXV0YXRpb24gYSBzZWNvbmQgdGltZSAodGhlIHJlcGxheSBvd25zIGl0cyBvd24gcGVyc2lzdCBhbmQgYnJvYWRjYXN0cyksXG4gICAqIHdoaWxlIGxhdGVyIHNlcnZlci1zaWRlIHdyaXRlcyB0byB0aGUgc2FtZSBpbnN0YW5jZSBwdWJsaXNoIG5vcm1hbGx5XG4gICAqIGFnYWluLiBNb2RlbCB2YWxpZGF0aW9uIGZhaWx1cmVzIGJlY29tZSBjbGllbnQtc2FmZSBwZXItc3luYyBmYWlsdXJlc1xuICAgKiBjYXJyeWluZyB0aGUgdHJhbnNsYXRlZCB2YWxpZGF0aW9uIG1lc3NhZ2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuY29udGV4dCAtIFJlcGxheSBjb250ZXh0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vc3luYy1lbnZlbG9wZS1yZXBsYXktc2VydmljZS5qc1wiKS5TeW5jUmVwbGF5TXV0YXRpb259IGFyZ3MubXV0YXRpb24gLSBOb3JtYWxpemVkIHJlcGxheSBtdXRhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9mcm9udGVuZC1tb2RlbC1yZXNvdXJjZS9iYXNlLXJlc291cmNlLmpzXCIpLmRlZmF1bHR9IGFyZ3MucmVzb3VyY2UgLSBSb3V0ZWQgcmVzb3VyY2UgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IEFwcGx5IHJlc3VsdCB3aXRoIHJlY29yZCwgY3JlYXRlZCBmbGFnLCBhbmQgYWZ0ZXJTeW5jQXBwbHkgZXh0cmFzLlxuICAgKi9cbiAgYXN5bmMgYXBwbHlSb3V0ZWRSZXBsYXlVcHNlcnQoe2NvbnRleHQsIG11dGF0aW9uLCByZXNvdXJjZX0pIHtcbiAgICBjb25zdCBhdHRyaWJ1dGVzID0gdGhpcy5wZXJtaXR0ZWRSb3V0ZWRBdHRyaWJ1dGVzKHttdXRhdGlvbiwgcmVzb3VyY2V9KVxuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSByZXNvdXJjZS5tb2RlbENsYXNzKClcbiAgICBjb25zdCBydW5VcHNlcnQgPSBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBleGlzdGluZ1JlY29yZCA9IGF3YWl0IHJlc291cmNlLmZpbmRTeW5jUmVjb3JkKHttdXRhdGlvbn0pXG4gICAgICBjb25zdCBjb25mbGljdFJlc3VsdCA9IGF3YWl0IHRoaXMucm91dGVkUmVwbGF5Q29uZmxpY3RSZXN1bHQoe2F0dHJpYnV0ZXMsIGV4aXN0aW5nUmVjb3JkLCBtdXRhdGlvbiwgcmVzb3VyY2V9KVxuXG4gICAgICBpZiAoY29uZmxpY3RSZXN1bHQpIHJldHVybiBjb25mbGljdFJlc3VsdFxuXG4gICAgICAvKiogQHR5cGUge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgbnVsbH0gKi9cbiAgICAgIGxldCByZWNvcmQgPSBleGlzdGluZ1JlY29yZFxuICAgICAgbGV0IGNyZWF0ZWQgPSBmYWxzZVxuXG4gICAgICBpZiAoZXhpc3RpbmdSZWNvcmQpIHtcbiAgICAgICAgY29uc3QgcmVsZWFzZVNlcnZlckFwcGx5ID0gbWFya1NlcnZlckFwcGx5KGV4aXN0aW5nUmVjb3JkKVxuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgZXhpc3RpbmdSZWNvcmQuYXNzaWduKGF0dHJpYnV0ZXMpXG4gICAgICAgICAgYXdhaXQgdGhpcy5zYXZlUm91dGVkUmVwbGF5UmVjb3JkKGV4aXN0aW5nUmVjb3JkKVxuICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgIHJlbGVhc2VTZXJ2ZXJBcHBseSgpXG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJlY29yZCA9IGF3YWl0IHRoaXMuY3JlYXRlUm91dGVkUmVwbGF5UmVjb3JkKHthdHRyaWJ1dGVzLCBtdXRhdGlvbiwgcmVzb3VyY2V9KVxuICAgICAgICBjcmVhdGVkID0gdHJ1ZVxuICAgICAgfVxuXG4gICAgICBjb25zdCBleHRyYXMgPSBhd2FpdCByZXNvdXJjZS5hZnRlclN5bmNBcHBseSh7Y29udGV4dCwgY3JlYXRlZCwgbXV0YXRpb24sIHJlY29yZH0pXG5cbiAgICAgIHJldHVybiB7Y3JlYXRlZCwgZGVsZXRlZDogZmFsc2UsIHJlY29yZCwgLi4uZXh0cmFzfVxuICAgIH1cblxuICAgIGlmICghdGhpcy5jb25mbGljdFN0cmF0ZWd5KSByZXR1cm4gYXdhaXQgcnVuVXBzZXJ0KClcblxuICAgIHJldHVybiBhd2FpdCBNb2RlbENsYXNzLndpdGhBZHZpc29yeUxvY2soc3luY1JlcGxheUNvbmZsaWN0TG9ja05hbWUoe3Jlc291cmNlSWQ6IG11dGF0aW9uLnJlc291cmNlSWQsIHJlc291cmNlVHlwZTogbXV0YXRpb24ucmVzb3VyY2VUeXBlfSksIHJ1blVwc2VydCwge2RlZGljYXRlZENvbm5lY3Rpb246IHRydWV9KVxuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrcyB3aGV0aGVyIGEgcm91dGVkIHVwc2VydCBtdXRhdGlvbiBjb25mbGljdHMgd2l0aCB0aGUgY3VycmVudCBzZXJ2ZXJcbiAgICogc3RhdGUgd2hlbiB0aGUgc2VydmljZSBpcyBjb25maWd1cmVkIHdpdGggYSBjb25mbGljdCBzdHJhdGVneS4gQSBtdXRhdGlvblxuICAgKiB3aG9zZSBiYXNlVmVyc2lvbiBkb2VzIG5vdCBtYXRjaCB0aGUgc2VydmVyJ3MgY3VycmVudCB2ZXJzaW9uQXR0cmlidXRlIGlzXG4gICAqIHJlamVjdGVkIHdpdGggYSBzdHJ1Y3R1cmVkIGNvbmZsaWN0IHBheWxvYWQgaW5zdGVhZCBvZiBiZWluZyBhcHBsaWVkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIENvbmZsaWN0LWNoZWNrIGFyZ3MuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmF0dHJpYnV0ZXMgLSBQZXJtaXR0ZWQgbXV0YXRpb24gYXR0cmlidXRlcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCB8IG51bGx9IGFyZ3MuZXhpc3RpbmdSZWNvcmQgLSBFeGlzdGluZyBzZXJ2ZXIgcmVjb3JkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vc3luYy1lbnZlbG9wZS1yZXBsYXktc2VydmljZS5qc1wiKS5TeW5jUmVwbGF5TXV0YXRpb259IGFyZ3MubXV0YXRpb24gLSBOb3JtYWxpemVkIHJlcGxheSBtdXRhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9mcm9udGVuZC1tb2RlbC1yZXNvdXJjZS9iYXNlLXJlc291cmNlLmpzXCIpLmRlZmF1bHR9IGFyZ3MucmVzb3VyY2UgLSBSb3V0ZWQgcmVzb3VyY2UgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IG51bGw+fSAtIENvbmZsaWN0IGFwcGx5IHJlc3VsdCwgb3IgbnVsbCB3aGVuIG5vIGNvbmZsaWN0LlxuICAgKi9cbiAgYXN5bmMgcm91dGVkUmVwbGF5Q29uZmxpY3RSZXN1bHQoe2F0dHJpYnV0ZXMsIGV4aXN0aW5nUmVjb3JkLCBtdXRhdGlvbiwgcmVzb3VyY2V9KSB7XG4gICAgaWYgKCF0aGlzLmNvbmZsaWN0U3RyYXRlZ3kpIHJldHVybiBudWxsXG4gICAgaWYgKCFleGlzdGluZ1JlY29yZCB8fCBtdXRhdGlvbi5zeW5jVHlwZSA9PT0gXCJjcmVhdGVcIikgcmV0dXJuIG51bGxcbiAgICBpZiAobXV0YXRpb24uYmFzZVZlcnNpb24gPT09IHVuZGVmaW5lZCB8fCBtdXRhdGlvbi5iYXNlVmVyc2lvbiA9PT0gbnVsbCkgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSByZXNvdXJjZS5tb2RlbENsYXNzKClcbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gc2NhbGFyTW9kZWxQcmltYXJ5S2V5KE1vZGVsQ2xhc3MucHJpbWFyeUtleSgpLCBgT2ZmbGluZSBzeW5jIGNvbmZsaWN0IGhhbmRsaW5nIGZvciAke01vZGVsQ2xhc3MubmFtZX1gKVxuICAgIGNvbnN0IHByaW1hcnlLZXlBdHRyaWJ1dGUgPSBNb2RlbENsYXNzLnJlc29sdmVBdHRyaWJ1dGVOYW1lKHByaW1hcnlLZXkpXG4gICAgY29uc3QgdmVyc2lvbkF0dHJpYnV0ZSA9IHRoaXMuY29uZmxpY3RTdHJhdGVneS52ZXJzaW9uQXR0cmlidXRlXG4gICAgY29uc3QgdmVyc2lvbkF0dHJpYnV0ZU5hbWUgPSBNb2RlbENsYXNzLnJlc29sdmVBdHRyaWJ1dGVOYW1lKHZlcnNpb25BdHRyaWJ1dGUpXG5cbiAgICBpZiAoIXByaW1hcnlLZXlBdHRyaWJ1dGUpIHRocm93IG5ldyBFcnJvcihgQ291bGRuJ3QgcmVzb2x2ZSBwcmltYXJ5IGtleSBhdHRyaWJ1dGU6ICR7cHJpbWFyeUtleX1gKVxuICAgIGlmICghdmVyc2lvbkF0dHJpYnV0ZU5hbWUpIHRocm93IG5ldyBFcnJvcihgQ291bGRuJ3QgcmVzb2x2ZSB2ZXJzaW9uIGF0dHJpYnV0ZTogJHt2ZXJzaW9uQXR0cmlidXRlfWApXG5cbiAgICBjb25zdCBzZXJ2ZXJWZXJzaW9uID0gbm9ybWFsaXplQ29uZmxpY3RWYWx1ZShleGlzdGluZ1JlY29yZC5yZWFkQXR0cmlidXRlKHZlcnNpb25BdHRyaWJ1dGVOYW1lKSlcblxuICAgIGlmIChzdGFibGVKc29uU3RyaW5naWZ5KHNlcnZlclZlcnNpb24pID09PSBzdGFibGVKc29uU3RyaW5naWZ5KG11dGF0aW9uLmJhc2VWZXJzaW9uKSkgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IHNlcmlhbGl6ZWRBZmZlY3RlZEF0dHJpYnV0ZXMgPSBhd2FpdCB0aGlzLnNlcmlhbGl6ZWRSb3V0ZWRDb25mbGljdEF0dHJpYnV0ZXMoe2F0dHJpYnV0ZXMsIGV4aXN0aW5nUmVjb3JkLCByZXNvdXJjZX0pXG4gICAgY29uc3Qgc2VydmVyQXR0cmlidXRlcyA9IHtcbiAgICAgIC4uLnNlcmlhbGl6ZWRBZmZlY3RlZEF0dHJpYnV0ZXMsXG4gICAgICBbcHJpbWFyeUtleUF0dHJpYnV0ZV06IGV4aXN0aW5nUmVjb3JkLnJlYWRBdHRyaWJ1dGUocHJpbWFyeUtleUF0dHJpYnV0ZSksXG4gICAgICBbdmVyc2lvbkF0dHJpYnV0ZU5hbWVdOiBzZXJ2ZXJWZXJzaW9uXG4gICAgfVxuXG4gICAgY29uc3Qgc2VydmVyUmVjb3JkID0ge1xuICAgICAgYXR0cmlidXRlczogc2VydmVyQXR0cmlidXRlcyxcbiAgICAgIHZlcnNpb246IHNlcnZlclZlcnNpb25cbiAgICB9XG4gICAgY29uc3QgY29uZmxpY3RNdXRhdGlvbiA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9kZXZpY2UtaWRlbnRpdHkuanNcIikuU3luY011dGF0aW9ufSAqLyAoLyoqIEB0eXBlIHt1bmtub3dufSAqLyAoe1xuICAgICAgYXR0cmlidXRlcyxcbiAgICAgIGJhc2VWZXJzaW9uOiBtdXRhdGlvbi5iYXNlVmVyc2lvbixcbiAgICAgIGNsaWVudE11dGF0aW9uSWQ6IG11dGF0aW9uLmNsaWVudE11dGF0aW9uSWQgfHwgbXV0YXRpb24uaWQsXG4gICAgICBtb2RlbDogbXV0YXRpb24ucmVzb3VyY2VUeXBlLFxuICAgICAgb3BlcmF0aW9uOiBtdXRhdGlvbi5zeW5jVHlwZSxcbiAgICAgIHBheWxvYWQ6IHtpZDogbXV0YXRpb24ucmVzb3VyY2VJZH1cbiAgICB9KSlcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCByZXNvbHZlU3luY0NvbmZsaWN0KHtcbiAgICAgIGJhc2VSZWNvcmQ6IG51bGwsXG4gICAgICBtdXRhdGlvbjogY29uZmxpY3RNdXRhdGlvbixcbiAgICAgIHNlcnZlclJlY29yZCxcbiAgICAgIHN0cmF0ZWd5OiB0aGlzLmNvbmZsaWN0U3RyYXRlZ3kuc3RyYXRlZ3kgfHwgXCJvcHRpbWlzdGljVmVyc2lvblwiLFxuICAgICAgdmVyc2lvbkF0dHJpYnV0ZVxuICAgIH0pXG5cbiAgICBpZiAocmVzdWx0LnN0YXR1cyAhPT0gXCJjb25mbGljdFwiKSByZXR1cm4gbnVsbFxuXG4gICAgcmV0dXJuIHtjb25mbGljdDogcmVzdWx0LmNvbmZsaWN0LCBjcmVhdGVkOiBmYWxzZSwgZGVsZXRlZDogZmFsc2UsIHJlY29yZDogZXhpc3RpbmdSZWNvcmQsIHN0YXR1czogXCJjb25mbGljdFwifVxuICB9XG5cbiAgLyoqXG4gICAqIFByb2plY3RzIGFmZmVjdGVkIG11dGF0aW9uIGZpZWxkcyB0aHJvdWdoIHRoZSByZXNvdXJjZSdzIHJlYWRhYmxlXG4gICAqIGF0dHJpYnV0ZSBjb250cmFjdC4gV3JpdGFibGUtYnV0LWhpZGRlbiBmaWVsZHMgYXJlIG9taXR0ZWQsIHdoaWxlIGN1c3RvbVxuICAgKiBgPGF0dHJpYnV0ZT5BdHRyaWJ1dGUobW9kZWwpYCBzZXJpYWxpemVycyBhbmQgbW9kZWwgYWNjZXNzb3JzIHJlbWFpbiB0aGVcbiAgICogc291cmNlIG9mIGZyb250ZW5kLXZpc2libGUgdmFsdWVzIChEYXRlIHZhbHVlcyBhcmUga2VwdCByYXcgc28gdGhlIG5vcm1hbFxuICAgKiBmcm9udGVuZC1tb2RlbCB0cmFuc3BvcnQgc2VyaWFsaXplciBjYW4gZW1pdCBpdHMgZGF0ZSBtYXJrZXIpLiBQcm9qZWN0ZWRcbiAgICoga2V5cyB1c2UgY2Fub25pY2FsIG1vZGVsIGF0dHJpYnV0ZSBuYW1lcyBldmVuIHdoZW4gdGhlIG11dGF0aW9uIHVzZWQgYVxuICAgKiBkYXRhYmFzZS1jb2x1bW4gYWxpYXMuIFRoZSBmdWxsIG1vZGVsIGF0dHJpYnV0ZSBoYXNoIGlzIG5ldmVyIGV4cG9zZWQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gUHJvamVjdGlvbiBhcmdzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5hdHRyaWJ1dGVzIC0gUGVybWl0dGVkIGFmZmVjdGVkIG11dGF0aW9uIGF0dHJpYnV0ZXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MuZXhpc3RpbmdSZWNvcmQgLSBBdXRob3JpemVkIHNlcnZlciByZWNvcmQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWwtcmVzb3VyY2UvYmFzZS1yZXNvdXJjZS5qc1wiKS5kZWZhdWx0fSBhcmdzLnJlc291cmNlIC0gUm91dGVkIHJlc291cmNlIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSBTZXJpYWxpemVkIHJlYWRhYmxlIGFmZmVjdGVkIGF0dHJpYnV0ZXMuXG4gICAqL1xuICBhc3luYyBzZXJpYWxpemVkUm91dGVkQ29uZmxpY3RBdHRyaWJ1dGVzKHthdHRyaWJ1dGVzLCBleGlzdGluZ1JlY29yZCwgcmVzb3VyY2V9KSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IHJlc291cmNlLm1vZGVsQ2xhc3MoKVxuICAgIGNvbnN0IFJlc291cmNlQ2xhc3MgPSAvKiogQHR5cGUge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NUeXBlfSAqLyAocmVzb3VyY2UuY29uc3RydWN0b3IpXG4gICAgY29uc3QgcmVhZGFibGVBdHRyaWJ1dGVzID0gbmV3IFNldCgpXG4gICAgY29uc3QgY29uZmlndXJlZEF0dHJpYnV0ZXMgPSBSZXNvdXJjZUNsYXNzLnJlc291cmNlQ29uZmlnKCkuYXR0cmlidXRlc1xuICAgIGNvbnN0IGNvbmZpZ3VyZWRFbnRyaWVzID0gQXJyYXkuaXNBcnJheShjb25maWd1cmVkQXR0cmlidXRlcykgPyBjb25maWd1cmVkQXR0cmlidXRlcyA6IE9iamVjdC5rZXlzKGNvbmZpZ3VyZWRBdHRyaWJ1dGVzKVxuXG4gICAgaWYgKGNvbmZpZ3VyZWRFbnRyaWVzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgY29uc3QgYXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZSA9IE1vZGVsQ2xhc3MuZ2V0QXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZU1hcCgpXG5cbiAgICAgIGZvciAoY29uc3QgYXR0cmlidXRlTmFtZSBvZiBPYmplY3Qua2V5cyhhdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lKSkge1xuICAgICAgICByZWFkYWJsZUF0dHJpYnV0ZXMuYWRkKGF0dHJpYnV0ZU5hbWUpXG4gICAgICB9XG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBjb25maWd1cmVkQXR0cmlidXRlIG9mIGNvbmZpZ3VyZWRFbnRyaWVzKSB7XG4gICAgICBjb25zdCBjb25maWd1cmVkTmFtZSA9IHR5cGVvZiBjb25maWd1cmVkQXR0cmlidXRlID09PSBcInN0cmluZ1wiID8gY29uZmlndXJlZEF0dHJpYnV0ZSA6IGNvbmZpZ3VyZWRBdHRyaWJ1dGUubmFtZVxuXG4gICAgICBpZiAoIWNvbmZpZ3VyZWROYW1lKSBjb250aW51ZVxuXG4gICAgICBjb25zdCBjYW5vbmljYWxOYW1lID0gTW9kZWxDbGFzcy5yZXNvbHZlQXR0cmlidXRlTmFtZShjb25maWd1cmVkTmFtZSlcblxuICAgICAgcmVhZGFibGVBdHRyaWJ1dGVzLmFkZChjYW5vbmljYWxOYW1lIHx8IGNvbmZpZ3VyZWROYW1lKVxuICAgIH1cblxuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IHNlcmlhbGl6ZWRBdHRyaWJ1dGVzID0ge31cblxuICAgIGZvciAoY29uc3QgYWZmZWN0ZWRGaWVsZCBvZiBPYmplY3Qua2V5cyhhdHRyaWJ1dGVzKSkge1xuICAgICAgY29uc3QgYXR0cmlidXRlTmFtZSA9IE1vZGVsQ2xhc3MucmVzb2x2ZUF0dHJpYnV0ZU5hbWUoYWZmZWN0ZWRGaWVsZClcblxuICAgICAgaWYgKCFhdHRyaWJ1dGVOYW1lIHx8ICFyZWFkYWJsZUF0dHJpYnV0ZXMuaGFzKGF0dHJpYnV0ZU5hbWUpKSBjb250aW51ZVxuXG4gICAgICBjb25zdCByZXNvdXJjZUF0dHJpYnV0ZSA9IHJlc291cmNlLnJlc291cmNlTWV0aG9kKGAke2F0dHJpYnV0ZU5hbWV9QXR0cmlidXRlYClcblxuICAgICAgaWYgKHJlc291cmNlQXR0cmlidXRlKSB7XG4gICAgICAgIHNlcmlhbGl6ZWRBdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdID0gYXdhaXQgcmVzb3VyY2VBdHRyaWJ1dGUubWV0aG9kLmNhbGwocmVzb3VyY2VBdHRyaWJ1dGUucmVzb3VyY2UsIGV4aXN0aW5nUmVjb3JkKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBjb25zdCByZWNvcmRNZXRob2RzID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICgvKiogQHR5cGUge3Vua25vd259ICovIChleGlzdGluZ1JlY29yZCkpXG4gICAgICBjb25zdCBhdHRyaWJ1dGVNZXRob2QgPSByZWNvcmRNZXRob2RzW2F0dHJpYnV0ZU5hbWVdXG5cbiAgICAgIGlmICh0eXBlb2YgYXR0cmlidXRlTWV0aG9kID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgc2VyaWFsaXplZEF0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV0gPSBhd2FpdCBhdHRyaWJ1dGVNZXRob2QuY2FsbChleGlzdGluZ1JlY29yZClcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHNlcmlhbGl6ZWRBdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdID0gZXhpc3RpbmdSZWNvcmQucmVhZEF0dHJpYnV0ZShhdHRyaWJ1dGVOYW1lKVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBzZXJpYWxpemVkQXR0cmlidXRlc1xuICB9XG5cbiAgLyoqXG4gICAqIEZpbHRlcnMgYSByb3V0ZWQgbXV0YXRpb24gcGF5bG9hZCBkb3duIHRvIHRoZSByZXNvdXJjZSdzIGRlY2xhcmVkXG4gICAqIHdyaXRhYmxlLWF0dHJpYnV0ZSBwZXJtaXQgbGlzdC4gQWNjZXB0ZWQga2V5cyBwZXIgcGVybWl0dGVkIGF0dHJpYnV0ZSBhcmVcbiAgICogdGhlIGNhbWVsQ2FzZSBhdHRyaWJ1dGUgbmFtZSBwbHVzIHRoZSBtb2RlbCdzIGFjdHVhbCBjb2x1bW4gbmFtZTsgdW5rbm93blxuICAgKiBrZXlzIGZhaWwgdGhlIHN5bmMgbG91ZGx5LiBUaGUgcHJpbWFyeSBrZXkgaXMgZHJvcHBlZCB3aGVuIHBlcm1pdHRlZFxuICAgKiAoc25hcHNob3QgcGF5bG9hZHMpIOKAlCB0aGUgZW52ZWxvcGUncyByZXNvdXJjZUlkIGlzIHRoZSBhdXRob3JpdGF0aXZlXG4gICAqIHJlY29yZCBpZGVudGl0eSwgc28gYSBwYXlsb2FkIGlkIGNhbiBuZXZlciByZXRhcmdldCB0aGUgcm93LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9zeW5jLWVudmVsb3BlLXJlcGxheS1zZXJ2aWNlLmpzXCIpLlN5bmNSZXBsYXlNdXRhdGlvbn0gYXJncy5tdXRhdGlvbiAtIE5vcm1hbGl6ZWQgcmVwbGF5IG11dGF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVsLXJlc291cmNlL2Jhc2UtcmVzb3VyY2UuanNcIikuZGVmYXVsdH0gYXJncy5yZXNvdXJjZSAtIFJvdXRlZCByZXNvdXJjZSBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gUGVybWl0dGVkIGF0dHJpYnV0ZXMgZm9yIHJlY29yZC5hc3NpZ24uXG4gICAqL1xuICBwZXJtaXR0ZWRSb3V0ZWRBdHRyaWJ1dGVzKHttdXRhdGlvbiwgcmVzb3VyY2V9KSB7XG4gICAgY29uc3QgcGVybWl0dGVkQXR0cmlidXRlcyA9IHJlc291cmNlLmRlY2xhcmVkV3JpdGFibGVBdHRyaWJ1dGVzKClcblxuICAgIGlmICghcGVybWl0dGVkQXR0cmlidXRlcykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke3Jlc291cmNlLmNvbnN0cnVjdG9yLm5hbWV9IG11c3QgZGVjbGFyZSBzdGF0aWMgd3JpdGFibGVBdHRyaWJ1dGVzIHRvIGFwcGx5IHJvdXRlZCBzeW5jIG11dGF0aW9ucyBmb3I6ICR7bXV0YXRpb24ucmVzb3VyY2VUeXBlfWApXG4gICAgfVxuXG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IHJlc291cmNlLm1vZGVsQ2xhc3MoKVxuICAgIGNvbnN0IGF0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWUgPSBNb2RlbENsYXNzLmdldEF0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWVNYXAoKVxuXG4gICAgLyoqIEB0eXBlIHtTZXQ8c3RyaW5nPn0gKi9cbiAgICBjb25zdCBhbGxvd2VkS2V5cyA9IG5ldyBTZXQoKVxuXG4gICAgZm9yIChjb25zdCBhdHRyaWJ1dGVOYW1lIG9mIHBlcm1pdHRlZEF0dHJpYnV0ZXMpIHtcbiAgICAgIGFsbG93ZWRLZXlzLmFkZChhdHRyaWJ1dGVOYW1lKVxuXG4gICAgICBjb25zdCBjb2x1bW5OYW1lID0gYXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZVthdHRyaWJ1dGVOYW1lXVxuXG4gICAgICBpZiAoY29sdW1uTmFtZSkgYWxsb3dlZEtleXMuYWRkKGNvbHVtbk5hbWUpXG4gICAgfVxuXG4gICAgY29uc3QgcHJpbWFyeUtleSA9IHNjYWxhck1vZGVsUHJpbWFyeUtleShNb2RlbENsYXNzLnByaW1hcnlLZXkoKSwgYE9mZmxpbmUgc3luYyBhdHRyaWJ1dGUgZmlsdGVyaW5nIGZvciAke01vZGVsQ2xhc3MubmFtZX1gKVxuICAgIGNvbnN0IHByaW1hcnlLZXlBdHRyaWJ1dGUgPSBNb2RlbENsYXNzLmdldENvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWVNYXAoKVtwcmltYXJ5S2V5XVxuXG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgYXR0cmlidXRlcyA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhtdXRhdGlvbi5kYXRhKSkge1xuICAgICAgaWYgKCFhbGxvd2VkS2V5cy5oYXMoa2V5KSkge1xuICAgICAgICB0aHJvdyByZXNvdXJjZS53cml0YWJsZUF0dHJpYnV0ZUVycm9yKGBVbmtub3duIGF0dHJpYnV0ZTogJHtrZXl9LmAsIHtjb2RlOiBcInN5bmMtdW5rbm93bi1hdHRyaWJ1dGVcIn0pXG4gICAgICB9XG5cbiAgICAgIGlmIChrZXkgPT09IHByaW1hcnlLZXkgfHwga2V5ID09PSBwcmltYXJ5S2V5QXR0cmlidXRlKSBjb250aW51ZVxuXG4gICAgICBhdHRyaWJ1dGVzW2tleV0gPSB2YWx1ZVxuICAgIH1cblxuICAgIHJldHVybiBhdHRyaWJ1dGVzXG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlcyB0aGUgcm91dGVkIHJlY29yZCB3aXRoIHRoZSBjbGllbnQtZ2VuZXJhdGVkIHByaW1hcnkga2V5IChtYXJrZWRcbiAgICogYXMgYSBzZXJ2ZXIgYXBwbHkgZm9yIHRoZSBkdXJhdGlvbiBvZiB0aGUgY3JlYXRlIC0gaW5jbHVkaW5nIHRoZVxuICAgKiBtZW1iZXJzaGlwLWNoZWNrIGNvbXBlbnNhdGlvbiBkZXN0cm95IC0gc28gYW4gYWN0aXZlIFN5bmNQdWJsaXNoZXIgbmV2ZXJcbiAgICogcHVibGlzaGVzIHRoZSByZXBsYXllZCBjcmVhdGUgYSBzZWNvbmQgdGltZSksIHRoZW5cbiAgICogdmVyaWZpZXMgY3JlYXRlLXNjb3BlIG1lbWJlcnNoaXAgd2hlbiBhbiBhYmlsaXR5IGlzIGNvbmZpZ3VyZWQ6IHJlY29yZHNcbiAgICogb3V0c2lkZSB0aGUgYWJpbGl0eSdzIGNyZWF0ZSBzY29wZSBhcmUgZGVzdHJveWVkIGFnYWluIGFuZCBmYWlsIHRoZSBzeW5jXG4gICAqIHdpdGggdGhlIHJlc291cmNlLWRlY2xhcmVkIHJlYXNvbi4gQSByZWNvcmQgdGhhdCBhbHJlYWR5IGV4aXN0cyBvdXRzaWRlXG4gICAqIHRoZSByZXNvdXJjZSdzIGxvb2t1cCBzY29wZSBmYWlscyB0aGUgc3luYyBhcyBhbiBhdXRob3JpemF0aW9uIGRlbmlhbFxuICAgKiBpbnN0ZWFkIG9mIGNvbGxpZGluZyBvbiB0aGUgcHJpbWFyeSBrZXkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuYXR0cmlidXRlcyAtIFBlcm1pdHRlZCBwYXlsb2FkIGF0dHJpYnV0ZXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9zeW5jLWVudmVsb3BlLXJlcGxheS1zZXJ2aWNlLmpzXCIpLlN5bmNSZXBsYXlNdXRhdGlvbn0gYXJncy5tdXRhdGlvbiAtIE5vcm1hbGl6ZWQgcmVwbGF5IG11dGF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVsLXJlc291cmNlL2Jhc2UtcmVzb3VyY2UuanNcIikuZGVmYXVsdH0gYXJncy5yZXNvdXJjZSAtIFJvdXRlZCByZXNvdXJjZSBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQ+fSBDcmVhdGVkIHJlY29yZC5cbiAgICovXG4gIGFzeW5jIGNyZWF0ZVJvdXRlZFJlcGxheVJlY29yZCh7YXR0cmlidXRlcywgbXV0YXRpb24sIHJlc291cmNlfSkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSByZXNvdXJjZS5tb2RlbENsYXNzKClcbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gc2NhbGFyTW9kZWxQcmltYXJ5S2V5KE1vZGVsQ2xhc3MucHJpbWFyeUtleSgpLCBgT2ZmbGluZSBzeW5jIGNyZWF0ZSBmb3IgJHtNb2RlbENsYXNzLm5hbWV9YClcbiAgICBjb25zdCBjb25mbGljdGluZ0lkcyA9IGF3YWl0IE1vZGVsQ2xhc3Mud2hlcmUoe1twcmltYXJ5S2V5XTogbXV0YXRpb24ucmVzb3VyY2VJZH0pLnBsdWNrKHByaW1hcnlLZXkpXG5cbiAgICBpZiAoY29uZmxpY3RpbmdJZHMubGVuZ3RoID4gMCkge1xuICAgICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShgU3luYyB1cGRhdGUgZGVuaWVkIGZvcjogJHttdXRhdGlvbi5yZXNvdXJjZVR5cGV9LmAsIHtcbiAgICAgICAgY29kZTogcmVzb3VyY2Uuc3luY0F1dGhvcml6YXRpb25GYWlsdXJlUmVhc29uKHthY3Rpb246IFwidXBkYXRlXCIsIG11dGF0aW9ufSkgfHwgXCJhY2Nlc3MtZGVuaWVkXCJcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgYXdhaXQgTW9kZWxDbGFzcy5lbnN1cmVJbml0aWFsaXplZCgpXG5cbiAgICBjb25zdCByZWNvcmQgPSBuZXcgTW9kZWxDbGFzcyh7W3ByaW1hcnlLZXldOiBtdXRhdGlvbi5yZXNvdXJjZUlkLCAuLi5hdHRyaWJ1dGVzfSlcbiAgICBjb25zdCByZWxlYXNlU2VydmVyQXBwbHkgPSBtYXJrU2VydmVyQXBwbHkocmVjb3JkKVxuXG4gICAgdHJ5IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHJlY29yZC5zYXZlKClcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHRocm93IHRoaXMucm91dGVkUmVwbGF5U2F2ZUVycm9yKGVycm9yKVxuICAgICAgfVxuXG4gICAgICBjb25zdCBhYmlsaXR5ID0gcmVzb3VyY2UuYWJpbGl0eVxuXG4gICAgICBpZiAoYWJpbGl0eSkge1xuICAgICAgICBjb25zdCBtZW1iZXJJZHMgPSBhd2FpdCBNb2RlbENsYXNzXG4gICAgICAgICAgLmFjY2Vzc2libGVGb3IocmVzb3VyY2Uuc3luY0FiaWxpdHlBY3Rpb24oXCJjcmVhdGVcIiksIGFiaWxpdHkpXG4gICAgICAgICAgLndoZXJlKHtbcHJpbWFyeUtleV06IHNjYWxhck1vZGVsUHJpbWFyeUtleVZhbHVlKHJlY29yZC5pZCgpLCBgT2ZmbGluZSBzeW5jIGNyZWF0ZSBhdXRob3JpemF0aW9uIGZvciAke01vZGVsQ2xhc3MubmFtZX1gKX0pXG4gICAgICAgICAgLnBsdWNrKHByaW1hcnlLZXkpXG5cbiAgICAgICAgaWYgKG1lbWJlcklkcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICBhd2FpdCByZWNvcmQuZGVzdHJveSgpXG5cbiAgICAgICAgICB0aHJvdyBWZWxvY2lvdXNFcnJvci5zYWZlKGBTeW5jIGNyZWF0ZSBkZW5pZWQgZm9yOiAke211dGF0aW9uLnJlc291cmNlVHlwZX0uYCwge1xuICAgICAgICAgICAgY29kZTogcmVzb3VyY2Uuc3luY0F1dGhvcml6YXRpb25GYWlsdXJlUmVhc29uKHthY3Rpb246IFwiY3JlYXRlXCIsIG11dGF0aW9ufSkgfHwgXCJhY2Nlc3MtZGVuaWVkXCJcbiAgICAgICAgICB9KVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHJldHVybiByZWNvcmRcbiAgICB9IGZpbmFsbHkge1xuICAgICAgcmVsZWFzZVNlcnZlckFwcGx5KClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogU2F2ZXMgYSByb3V0ZWQgcmVjb3JkLCBjb252ZXJ0aW5nIG1vZGVsIHZhbGlkYXRpb24gZmFpbHVyZXMgaW50b1xuICAgKiBjbGllbnQtc2FmZSBwZXItc3luYyBlcnJvcnMgY2FycnlpbmcgdGhlIHRyYW5zbGF0ZWQgdmFsaWRhdGlvbiBtZXNzYWdlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSByZWNvcmQgLSBSZWNvcmQgdG8gc2F2ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIHdoZW4gc2F2ZWQuXG4gICAqL1xuICBhc3luYyBzYXZlUm91dGVkUmVwbGF5UmVjb3JkKHJlY29yZCkge1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCByZWNvcmQuc2F2ZSgpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRocm93IHRoaXMucm91dGVkUmVwbGF5U2F2ZUVycm9yKGVycm9yKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBNYXBzIGEgcm91dGVkIHNhdmUvY3JlYXRlIGZhaWx1cmU6IG1vZGVsIHZhbGlkYXRpb24gZXJyb3JzIGJlY29tZVxuICAgKiBjbGllbnQtc2FmZSBlcnJvcnMgd2l0aCB0aGVpciB0cmFuc2xhdGVkIG1lc3NhZ2VzLCBldmVyeXRoaW5nIGVsc2VcbiAgICogcHJvcGFnYXRlcyB1bmNoYW5nZWQuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGVycm9yIC0gVGhyb3duIHNhdmUvY3JlYXRlIGVycm9yLlxuICAgKiBAcmV0dXJucyB7RXJyb3J9IEVycm9yIHRvIHJldGhyb3cuXG4gICAqL1xuICByb3V0ZWRSZXBsYXlTYXZlRXJyb3IoZXJyb3IpIHtcbiAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBWYWxpZGF0aW9uRXJyb3IpIHtcbiAgICAgIHJldHVybiBWZWxvY2lvdXNFcnJvci5zYWZlKGVycm9yLm1lc3NhZ2UsIHtjYXVzZTogZXJyb3IsIGNvZGU6IFwidmFsaWRhdGlvbi1lcnJvclwifSlcbiAgICB9XG5cbiAgICByZXR1cm4gLyoqIEB0eXBlIHtFcnJvcn0gKi8gKGVycm9yKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGFuIGFwcGx5IHJlc3VsdCBmb3Igc3RhbGUgbXV0YXRpb25zIHRoYXQgc2hvdWxkIG5vdCB0b3VjaCBkb21haW4gbW9kZWxzLlxuICAgKiBFeGFjdCBkdXBsaWNhdGVzIHJlc29sdmUgdGhlIGN1cnJlbnQgcm91dGVkIHJlY29yZCBzbyB0aGUgYWNrbm93bGVkZ2VtZW50XG4gICAqIGNhbiBpbmNsdWRlIGl0cyBhdXRob3JpdGF0aXZlIHZlcnNpb24gd2l0aG91dCBhcHBseWluZyB0aGUgbXV0YXRpb24gYWdhaW4uXG4gICAqIEBwYXJhbSB7e2FjdG9yOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgY29udGV4dDogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBleGlzdGluZ1N5bmM6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBtdXRhdGlvbjogaW1wb3J0KFwiLi9zeW5jLWVudmVsb3BlLXJlcGxheS1zZXJ2aWNlLmpzXCIpLlN5bmNSZXBsYXlNdXRhdGlvbn19IGFyZ3MgLSBBY3RvciwgYmF0Y2ggY29udGV4dCwgZXhpc3Rpbmcgc3luYyByb3csIGFuZCBtdXRhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBQcm9qZWN0LXNwZWNpZmljIGFwcGx5IHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHNraXBwZWRSZXBsYXlNdXRhdGlvbih7YWN0b3IsIGNvbnRleHQsIGV4aXN0aW5nU3luYywgbXV0YXRpb259KSB7XG4gICAgaWYgKCF0aGlzLmlzRHVwbGljYXRlUmVwbGF5TXV0YXRpb24oe2V4aXN0aW5nU3luYywgbXV0YXRpb259KSB8fCAhdGhpcy5yb3V0aW5nQ29uZmlndXJlZCgpKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgcmVnaXN0cmF0aW9uID0gdGhpcy5yZXBsYXlSZXNvdXJjZVJlZ2lzdHJhdGlvbihtdXRhdGlvbi5yZXNvdXJjZVR5cGUpXG5cbiAgICBpZiAoIXJlZ2lzdHJhdGlvbikgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IHJlc291cmNlID0gYXdhaXQgdGhpcy5idWlsZFJlcGxheVJlc291cmNlKHthY3RvciwgY29udGV4dCwgbXV0YXRpb24sIHJlZ2lzdHJhdGlvbn0pXG4gICAgY29uc3QgcmVjb3JkID0gYXdhaXQgcmVzb3VyY2UuZmluZFN5bmNSZWNvcmQoe2ZvckRlbGV0ZTogbXV0YXRpb24uc3luY1R5cGUgPT09IFwiZGVsZXRlXCIsIG11dGF0aW9ufSlcblxuICAgIHJldHVybiB7Y3JlYXRlZDogZmFsc2UsIGRlbGV0ZWQ6IGZhbHNlLCBkdXBsaWNhdGU6IHRydWUsIHJlY29yZH1cbiAgfVxuXG4gIC8qKlxuICAgKiBQZXJzaXN0cyBvbmUgbm9ybWFsaXplZCBtdXRhdGlvbiBpbnRvIHRoZSBhcHAgc3luYy9jaGFuZ2Ugc3RvcmUuXG4gICAqXG4gICAqIERlZmF1bHRzIHRvIGEgc3RhbGUtZ3VhcmRlZCBzeW5jLW1vZGVsIHVwc2VydCAod2l0aCBzZXJ2ZXIgcmUtc2VxdWVuY2luZyBvblxuICAgKiB1cGRhdGVzKSB3aGVuIGEgc3luYyBtb2RlbCBpcyBjb25maWd1cmVkOyBvdGhlcndpc2UgYXBwcyBvdmVycmlkZSB0aGlzIGhvb2suXG4gICAqIEBwYXJhbSB7e2FjdG9yOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgY29udGV4dDogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBleGlzdGluZ1N5bmM6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBhcHBseVJlc3VsdDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIG11dGF0aW9uOiBpbXBvcnQoXCIuL3N5bmMtZW52ZWxvcGUtcmVwbGF5LXNlcnZpY2UuanNcIikuU3luY1JlcGxheU11dGF0aW9uLCBzaG91bGRBcHBseTogYm9vbGVhbn19IGFyZ3MgLSBSZXBsYXkgcGVyc2lzdGVuY2UgYXJndW1lbnRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIHBlcnNpc3RSZXBsYXlNdXRhdGlvbih7YWN0b3IsIGFwcGx5UmVzdWx0LCBjb250ZXh0LCBleGlzdGluZ1N5bmMsIG11dGF0aW9uLCBzaG91bGRBcHBseX0pIHtcbiAgICBpZiAoIXRoaXMuc3luY01vZGVsKSByZXR1cm5cblxuICAgIGNvbnN0IGF0dHJpYnV0ZXMgPSB0aGlzLnJlcGxheVBlcnNpc3RBdHRyaWJ1dGVzKHthY3RvciwgbXV0YXRpb259KVxuXG4gICAgLy8gU3RhbGUgcmVwbGF5cyBuZXZlciBhcHBsaWVkIGFueXRoaW5nLCBzbyB0aGUgYXBwbHlSZXN1bHQtZHJpdmVuIGV4dGVuc2lvblxuICAgIC8vIGhvb2tzIG11c3Qgbm90IHJ1biBhZ2FpbnN0IHRoZSBkZWZhdWx0IG51bGwgc2tpcHBlZCByZXN1bHQuXG4gICAgaWYgKHRoaXMucGVyc2lzdEV4dHJhQXR0cmlidXRlcyAmJiBzaG91bGRBcHBseSkge1xuICAgICAgT2JqZWN0LmFzc2lnbihhdHRyaWJ1dGVzLCB0aGlzLnBlcnNpc3RFeHRyYUF0dHJpYnV0ZXMoe2FjdG9yLCBhcHBseVJlc3VsdCwgY29udGV4dCwgZXhpc3RpbmdTeW5jLCBtdXRhdGlvbiwgc2hvdWxkQXBwbHl9KSlcbiAgICB9XG5cbiAgICBpZiAodGhpcy5wZXJzaXN0U2VyaWFsaXplZERhdGEgJiYgc2hvdWxkQXBwbHkpIHtcbiAgICAgIGNvbnN0IHNlcmlhbGl6ZWREYXRhID0gdGhpcy5wZXJzaXN0U2VyaWFsaXplZERhdGEoe2FwcGx5UmVzdWx0LCBtdXRhdGlvbn0pXG5cbiAgICAgIGlmIChzZXJpYWxpemVkRGF0YSAhPT0gdW5kZWZpbmVkICYmIHNlcmlhbGl6ZWREYXRhICE9PSBudWxsKSB7XG4gICAgICAgIGF0dHJpYnV0ZXMuZGF0YSA9IHR5cGVvZiBzZXJpYWxpemVkRGF0YSA9PT0gXCJzdHJpbmdcIiA/IHNlcmlhbGl6ZWREYXRhIDogSlNPTi5zdHJpbmdpZnkoc2VyaWFsaXplZERhdGEpXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuY29uZmxpY3RTdHJhdGVneSAmJiBzaG91bGRBcHBseSAmJiBtdXRhdGlvbi5iYXNlVmVyc2lvbiAhPT0gdW5kZWZpbmVkICYmIGFwcGx5UmVzdWx0Py5yZWNvcmQpIHtcbiAgICAgIGNvbnN0IHB1YmxpY1BheWxvYWQgPSBkZWNvZGVSZXBsYXlQZXJzaXN0ZWREYXRhKGF0dHJpYnV0ZXMuZGF0YSkucGF5bG9hZFxuICAgICAgY29uc3QgYWNrbm93bGVkZ2VtZW50VmVyc2lvbiA9IG5vcm1hbGl6ZUNvbmZsaWN0VmFsdWUoYXBwbHlSZXN1bHQucmVjb3JkLnJlYWRBdHRyaWJ1dGUodGhpcy5jb25mbGljdFN0cmF0ZWd5LnZlcnNpb25BdHRyaWJ1dGUpKVxuXG4gICAgICBhdHRyaWJ1dGVzLmRhdGEgPSBzZXJpYWxpemVSZXBsYXlQZXJzaXN0ZWREYXRhKHtcbiAgICAgICAgYWNrbm93bGVkZ2VtZW50VmVyc2lvbixcbiAgICAgICAgY2xpZW50TXV0YXRpb25JZDogU3RyaW5nKG11dGF0aW9uLmNsaWVudE11dGF0aW9uSWQgfHwgbXV0YXRpb24uaWQpLFxuICAgICAgICBwYXlsb2FkOiBwdWJsaWNQYXlsb2FkLFxuICAgICAgICBwYXlsb2FkRmluZ2VycHJpbnQ6IHNoYTI1NkhleChtdXRhdGlvbi5zZXJpYWxpemVkRGF0YSlcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgaWYgKGV4aXN0aW5nU3luYykge1xuICAgICAgY29uc3QgZXhpc3RpbmdDbGllbnRVcGRhdGVkQXQgPSB0aGlzLmV4aXN0aW5nUmVwbGF5U3luY0NsaWVudFVwZGF0ZWRBdChleGlzdGluZ1N5bmMpXG5cbiAgICAgIGlmIChleGlzdGluZ0NsaWVudFVwZGF0ZWRBdCAmJiBtdXRhdGlvbi5jbGllbnRVcGRhdGVkQXQgPD0gZXhpc3RpbmdDbGllbnRVcGRhdGVkQXQpIHJldHVyblxuICAgIH1cblxuICAgIGF3YWl0IHVwc2VydFN5bmNSb3coe2F0dHJpYnV0ZXMsIGV4aXN0aW5nU3luYywgc3luY01vZGVsOiB0aGlzLnN5bmNNb2RlbH0pXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSBzeW5jLW1vZGVsIGF0dHJpYnV0ZXMgcGVyc2lzdGVkIGJ5IHRoZSBtb2RlbC1iYWNrZWQgZGVmYXVsdC5cbiAgICogQHBhcmFtIHt7YWN0b3I6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBtdXRhdGlvbjogaW1wb3J0KFwiLi9zeW5jLWVudmVsb3BlLXJlcGxheS1zZXJ2aWNlLmpzXCIpLlN5bmNSZXBsYXlNdXRhdGlvbn19IGFyZ3MgLSBBY3RvciBhbmQgbXV0YXRpb24uXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IFN5bmMgcm93IGF0dHJpYnV0ZXMuXG4gICAqL1xuICByZXBsYXlQZXJzaXN0QXR0cmlidXRlcyh7YWN0b3IsIG11dGF0aW9ufSkge1xuICAgIHJldHVybiB7XG4gICAgICBbdGhpcy5hY3RvckZvcmVpZ25LZXlDb2x1bW5dOiB0aGlzLnJlcGxheUFjdG9ySWQoYWN0b3IpLFxuICAgICAgY2xpZW50X3VwZGF0ZWRfYXQ6IG11dGF0aW9uLmNsaWVudFVwZGF0ZWRBdCxcbiAgICAgIGRhdGE6IG11dGF0aW9uLnNlcmlhbGl6ZWREYXRhLFxuICAgICAgcmVzb3VyY2VfaWQ6IG11dGF0aW9uLnJlc291cmNlSWQsXG4gICAgICByZXNvdXJjZV90eXBlOiBtdXRhdGlvbi5yZXNvdXJjZVR5cGUsXG4gICAgICBzeW5jX3R5cGU6IG11dGF0aW9uLnN5bmNUeXBlXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2lkZSBlZmZlY3RzIGFmdGVyIGEgc3VjY2Vzc2Z1bCBtdXRhdGlvbiByZXBsYXkgYW5kIHBlcnNpc3RlbmNlLlxuICAgKlxuICAgKiBEZWZhdWx0cyB0byBmYW5uaW5nIHRoZSBhcHBsaWVkIHJlc3VsdCBvdXQgdGhyb3VnaCB0aGUgY29uZmlndXJlZFxuICAgKiBkZWNsYXJhdGl2ZSBicm9hZGNhc3RzLlxuICAgKiBAcGFyYW0ge3thY3RvcjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGNvbnRleHQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgZXhpc3RpbmdTeW5jOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgYXBwbHlSZXN1bHQ6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBtdXRhdGlvbjogaW1wb3J0KFwiLi9zeW5jLWVudmVsb3BlLXJlcGxheS1zZXJ2aWNlLmpzXCIpLlN5bmNSZXBsYXlNdXRhdGlvbiwgc2hvdWxkQXBwbHk6IGJvb2xlYW59fSBhcmdzIC0gUmVwbGF5IHNpZGUtZWZmZWN0IGFyZ3VtZW50cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBhZnRlclJlcGxheU11dGF0aW9uKGFyZ3MpIHtcbiAgICBpZiAoIXRoaXMuYnJvYWRjYXN0cyB8fCAhdGhpcy5icm9hZGNhc3RlcikgcmV0dXJuXG4gICAgLy8gU3RhbGUgcmVwbGF5cyBuZXZlciBhcHBsaWVkIGFueXRoaW5nIC0gYnJvYWRjYXN0aW5nIHRoZWlyIHNraXBwZWQgcmVzdWx0c1xuICAgIC8vIHdvdWxkIGZhbiBvdXQgc3RhbGUgc2lkZSBlZmZlY3RzIChvciBjcmFzaCBvbiB0aGUgZGVmYXVsdCBudWxsIGFwcGx5UmVzdWx0KS5cbiAgICBpZiAoIWFyZ3Muc2hvdWxkQXBwbHkpIHJldHVyblxuXG4gICAgYXdhaXQgZGVsaXZlckRlY2xhcmVkQnJvYWRjYXN0cyh7YXJncywgYnJvYWRjYXN0ZXI6IHRoaXMuYnJvYWRjYXN0ZXIsIGJyb2FkY2FzdHM6IHRoaXMuYnJvYWRjYXN0c30pXG4gIH1cbn1cblxuLyoqXG4gKiBSZXR1cm5zIGEgZGV0ZXJtaW5pc3RpYywgTXlTUUwtc2FmZSBhZHZpc29yeS1sb2NrIG5hbWUgZm9yIGEgcm91dGVkIHJlcGxheVxuICogcmVzb3VyY2UgaWRlbnRpdHkuIFRoZSBmdWxsIGB7cmVzb3VyY2VUeXBlLCByZXNvdXJjZUlkfWAgaWRlbnRpdHkgaXMgaGFzaGVkXG4gKiB3aXRoIFNIQS0yNTYgYW5kIHRydW5jYXRlZCB0byAzMiBoZXggY2hhcmFjdGVycyBzbyB0aGUgZmluYWwgbmFtZSBzdGF5cyB3ZWxsXG4gKiB1bmRlciBNeVNRTC9NYXJpYURCJ3MgNjQtY2hhcmFjdGVyIGBHRVRfTE9DS2AgbGltaXQgd2hpbGUgcmVtYWluaW5nXG4gKiBjb2xsaXNpb24tcmVzaXN0YW50LlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBMb2NrIGlkZW50aXR5IGFyZ3MuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy5yZXNvdXJjZUlkIC0gUmVzb3VyY2UgaWQuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy5yZXNvdXJjZVR5cGUgLSBSZXNvdXJjZSB0eXBlLlxuICogQHJldHVybnMge3N0cmluZ30gLSBBZHZpc29yeSBsb2NrIG5hbWUuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzeW5jUmVwbGF5Q29uZmxpY3RMb2NrTmFtZSh7cmVzb3VyY2VJZCwgcmVzb3VyY2VUeXBlfSkge1xuICBjb25zdCBpZGVudGl0eSA9IHN0YWJsZUpzb25TdHJpbmdpZnkoe3Jlc291cmNlSWQsIHJlc291cmNlVHlwZX0pXG4gIGNvbnN0IGhhc2ggPSBzaGEyNTZIZXgoaWRlbnRpdHkpLnNsaWNlKDAsIDMyKVxuXG4gIHJldHVybiBgdnNyOiR7aGFzaH1gXG59XG5cbi8qKlxuICogTm9ybWFsaXplcyBhIHZlcnNpb24gdmFsdWUgZm9yIGRldGVybWluaXN0aWMgY29tcGFyaXNvbiBhbmQgdHJhbnNwb3J0LlxuICogT25seSB2ZXJzaW9uIHZhbHVlcyBwYXJ0aWNpcGF0ZSBpbiBzdGFibGUtSlNPTiBjb21wYXJpc29uIGFnYWluc3QgY2xpZW50XG4gKiBgYmFzZVZlcnNpb25gIHN0cmluZ3M7IHJlc291cmNlIHNlcmlhbGl6ZXIvYWNjZXNzb3IgcmVzdWx0cyBtdXN0IHN0YXkgcmF3IHNvXG4gKiB0aGUgZnJvbnRlbmQtbW9kZWwgdHJhbnNwb3J0IHNlcmlhbGl6ZXIgY2FuIHJldGFpbiBEYXRlIG1hcmtlcnMuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFJhdyB2ZXJzaW9uIHZhbHVlIGZyb20gYSBkYXRhYmFzZSByZWNvcmQuXG4gKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gTm9ybWFsaXplZCB2YWx1ZSAoRGF0ZSB2YWx1ZXMgYmVjb21lIElTTyBzdHJpbmdzKS5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplQ29uZmxpY3RWYWx1ZSh2YWx1ZSkge1xuICBpZiAodmFsdWUgaW5zdGFuY2VvZiBEYXRlKSByZXR1cm4gdmFsdWUudG9JU09TdHJpbmcoKVxuXG4gIHJldHVybiB2YWx1ZVxufVxuIl19