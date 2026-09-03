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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3luYy1lbnZlbG9wZS1yZXBsYXktc2VydmljZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9zeW5jL3N5bmMtZW52ZWxvcGUtcmVwbGF5LXNlcnZpY2UuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sRUFBQyx5QkFBeUIsRUFBRSxhQUFhLEVBQUMsTUFBTSx5QkFBeUIsQ0FBQTtBQUNoRixPQUFPLEVBQUMsZUFBZSxFQUFDLE1BQU0sK0JBQStCLENBQUE7QUFDN0QsT0FBTyxFQUFDLGlDQUFpQyxFQUFDLE1BQU0sMkNBQTJDLENBQUE7QUFDM0YsT0FBTyxFQUFDLG1CQUFtQixFQUFDLE1BQU0sd0JBQXdCLENBQUE7QUFDMUQsT0FBTyx1QkFBdUIsTUFBTSxpQ0FBaUMsQ0FBQTtBQUNyRSxPQUFPLG1CQUFtQixNQUFNLGtCQUFrQixDQUFBO0FBQ2xELE9BQU8sU0FBUyxNQUFNLHdCQUF3QixDQUFBO0FBQzlDLE9BQU8sRUFBQyx5QkFBeUIsRUFBRSw0QkFBNEIsRUFBQyxNQUFNLGlDQUFpQyxDQUFBO0FBQ3ZHLE9BQU8sRUFBQyxlQUFlLEVBQUMsTUFBTSw2QkFBNkIsQ0FBQTtBQUMzRCxPQUFPLGNBQWMsTUFBTSx1QkFBdUIsQ0FBQTtBQUNsRCxPQUFPLEVBQUMscUJBQXFCLEVBQUUsMEJBQTBCLEVBQUMsTUFBTSwrQkFBK0IsQ0FBQTtBQUUvRjs7Ozs7O0dBTUc7QUFDSDs7Ozs7Ozs7Ozs7R0FXRztBQUNIOzs7Ozs7O0dBT0c7QUFFSDs7Ozs7Ozs7R0FRRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8seUJBQXlCO0lBQzVDOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7T0EyQkc7SUFDSCxZQUFZLElBQUksR0FBRyxFQUFFO1FBQ25CLElBQUksQ0FBQyxNQUFNLEdBQUcsSUFBSSxDQUFDLE1BQU0sSUFBSSxPQUFPLENBQUE7UUFDcEMsSUFBSSxDQUFDLFNBQVMsR0FBRyxJQUFJLENB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O0lBQ3JHLENBQUM7Q0FDRjtBQUVEOzs7Ozs7Ozs7O0dBVUc7QUFDSCxNQUFNLFVBQVUsMEJBQTBCLENBQUMsRUFBQyxVQUFVLEVBQUUsWUFBWSxFQUFDO0lBQ25FLE1BQU0sUUFBUSxHQUFHLG1CQUFtQixDQUFDLEVBQUMsVUFBVSxFQUFFLFlBQVksRUFBQyxDQUFDLENBQUE7SUFDaEUsTUFBTSxJQUFJLEdBQUcsU0FBUyxDQUFDLFFBQVEsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUE7SUFFN0MsT0FBTyxPQUFPLElBQUksRUFBRSxDQUFBO0FBQ3RCLENBQUM7QUFFRDs7Ozs7OztHQU9HO0FBQ0gsU0FBUyxzQkFBc0IsQ0FBQyxLQUFLO0lBQ25DLElBQUksS0FBSyxZQUFZLElBQUk7UUFBRSxPQUFPLEtBQUssQ0FBQyxXQUFXLEVBQUUsQ0FBQTtJQUVyRCxPQUFPLEtBQUssQ0FBQTtBQUNkLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHtkZWxpdmVyRGVjbGFyZWRCcm9hZGNhc3RzLCB1cHNlcnRTeW5jUm93fSBmcm9tIFwiLi9zeW5jLWNoYW5nZS1mYW5vdXQuanNcIlxuaW1wb3J0IHttYXJrU2VydmVyQXBwbHl9IGZyb20gXCIuL3N5bmMtcHVibGlzaC1zdXBwcmVzc2lvbi5qc1wiXG5pbXBvcnQge3Jlc29sdmVGcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc30gZnJvbSBcIi4uL2Zyb250ZW5kLW1vZGVscy9yZXNvdXJjZS1kZWZpbml0aW9uLmpzXCJcbmltcG9ydCB7cmVzb2x2ZVN5bmNDb25mbGljdH0gZnJvbSBcIi4vY29uZmxpY3Qtc3RyYXRlZ3kuanNcIlxuaW1wb3J0IFN5bmNSZXBsYXlVcHNlcnRBcHBsaWVyIGZyb20gXCIuL3N5bmMtcmVwbGF5LXVwc2VydC1hcHBsaWVyLmpzXCJcbmltcG9ydCBzdGFibGVKc29uU3RyaW5naWZ5IGZyb20gXCIuL3N0YWJsZS1qc29uLmpzXCJcbmltcG9ydCBzaGEyNTZIZXggZnJvbSBcIi4uL3V0aWxzL3NoYTI1Ni1oZXguanNcIlxuaW1wb3J0IHtkZWNvZGVSZXBsYXlQZXJzaXN0ZWREYXRhLCBzZXJpYWxpemVSZXBsYXlQZXJzaXN0ZWREYXRhfSBmcm9tIFwiLi9zeW5jLXJlcGxheS1wZXJzaXN0ZWQtZGF0YS5qc1wiXG5pbXBvcnQge1ZhbGlkYXRpb25FcnJvcn0gZnJvbSBcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiXG5pbXBvcnQgVmVsb2Npb3VzRXJyb3IgZnJvbSBcIi4uL3ZlbG9jaW91cy1lcnJvci5qc1wiXG5pbXBvcnQge3NjYWxhck1vZGVsUHJpbWFyeUtleSwgc2NhbGFyTW9kZWxQcmltYXJ5S2V5VmFsdWV9IGZyb20gXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiXG5cbi8qKlxuICogUmVzb2x2ZWQgcm91dGVkLXJlc291cmNlIHJlZ2lzdHJhdGlvbiBmb3Igb25lIHJlcGxheSByZXNvdXJjZSB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gU3luY1JlcGxheVJlc291cmNlUmVnaXN0cmF0aW9uXG4gKiBAcHJvcGVydHkge3N0cmluZ30gbW9kZWxOYW1lIC0gRWZmZWN0aXZlIGZyb250ZW5kIG1vZGVsIG5hbWUuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3NUeXBlfSByZXNvdXJjZUNsYXNzIC0gUm91dGVkIHJlc291cmNlIGNsYXNzLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLk5vcm1hbGl6ZWRGcm9udGVuZE1vZGVsUmVzb3VyY2VDb25maWd1cmF0aW9uIHwgbnVsbH0gcmVzb3VyY2VDb25maWd1cmF0aW9uIC0gTm9ybWFsaXplZCByZXNvdXJjZSBjb25maWd1cmF0aW9uIHdoZW4gcmVnaXN0cnktcmVzb2x2ZWQuXG4gKi9cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gU3luY1JlcGxheU11dGF0aW9uXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IG51bWJlciB8IG51bGx9IFtiYXNlVmVyc2lvbl0gLSBCYXNlIHNlcnZlci9jbGllbnQgdmVyc2lvbiBvYnNlcnZlZCBieSB0aGUgY2xpZW50LlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtjbGllbnRNdXRhdGlvbklkXSAtIE9yaWdpbmFsIGNsaWVudCBtdXRhdGlvbiBpZCBmcm9tIHRoZSBzaWduZWQgZW52ZWxvcGUuXG4gKiBAcHJvcGVydHkge0RhdGV9IGNsaWVudFVwZGF0ZWRBdCAtIENsaWVudC1zaWRlIG11dGF0aW9uIHRpbWVzdGFtcC5cbiAqIEBwcm9wZXJ0eSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBkYXRhIC0gUGFyc2VkIG11dGF0aW9uIHBheWxvYWQuXG4gKiBAcHJvcGVydHkge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBpZCAtIENsaWVudCBzeW5jIHJvdyBpZCBmb3IgcGVyLXN5bmMgcmVzcG9uc2VzLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHJlc291cmNlSWQgLSBSZXNvdXJjZSBpZCBhcyBhIHN0cmluZy5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSByZXNvdXJjZVR5cGUgLSBSZXNvdXJjZS9tb2RlbCBuYW1lLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHNlcmlhbGl6ZWREYXRhIC0gSlNPTiBzZXJpYWxpemVkIG11dGF0aW9uIHBheWxvYWQuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gc3luY1R5cGUgLSBTeW5jIG9wZXJhdGlvbiB0eXBlLlxuICovXG4vKipcbiAqIE9uZSBkZWNsYXJhdGl2ZSBicm9hZGNhc3QgZmFubmVkIG91dCBhZnRlciBhIG11dGF0aW9uIGFwcGxpZXMuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBTeW5jUmVwbGF5QnJvYWRjYXN0XG4gKiBAcHJvcGVydHkge3N0cmluZyB8ICgoYXJnczogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSA9PiBzdHJpbmcpfSBjaGFubmVsIC0gQ2hhbm5lbCBuYW1lIG9yIHJlc29sdmVyLlxuICogQHByb3BlcnR5IHsoYXJnczogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSA9PiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGJyb2FkY2FzdFBhcmFtcyAtIENoYW5uZWwgcm91dGluZyBwYXJhbXMuXG4gKiBAcHJvcGVydHkgeyhhcmdzOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBib2R5IC0gQnJvYWRjYXN0IGJvZHkuXG4gKiBAcHJvcGVydHkgeyhhcmdzOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IGJvb2xlYW59IFt3aGVuXSAtIE9wdGlvbmFsIGdhdGU7IHNraXBwZWQgd2hlbiBpdCByZXR1cm5zIGZhbHNlLlxuICovXG5cbi8qKlxuICogUmVwbGF5cyBjbGllbnQgc3luYyBlbnZlbG9wZXMgdGhyb3VnaCBwcm9qZWN0IHN1cHBsaWVkIGF1dGhlbnRpY2F0aW9uLFxuICogYXV0aG9yaXphdGlvbiwgYXBwbGljYXRpb24sIGFuZCBwZXJzaXN0ZW5jZSBob29rcy5cbiAqXG4gKiBUaGlzIGlzIGludGVudGlvbmFsbHkgdHJhbnNwb3J0L21vZGVsIGFnbm9zdGljOiBWZWxvY2lvdXMgb3ducyB0aGUgZ2VuZXJpY1xuICogcmVwbGF5IGxvb3AsIG5vcm1hbGl6YXRpb24sIHN0YWxlLWNsaWVudCBjb21wYXJpc29uLCBhbmQgcGVyLXN5bmMgcmVzdWx0XG4gKiBzaGFwZSB3aGlsZSBlYWNoIGFwcCBvd25zIGl0cyB0b2tlbiBsb29rdXAsIG1vZGVsIGhhbmRsZXJzLCBhbmRcbiAqIGRvbWFpbiBhdXRob3JpemF0aW9uIHJ1bGVzLlxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBTeW5jRW52ZWxvcGVSZXBsYXlTZXJ2aWNlIHtcbiAgLyoqXG4gICAqIENyZWF0ZXMgYSBzeW5jIGVudmVsb3BlIHJlcGxheSBzZXJ2aWNlLlxuICAgKlxuICAgKiBXaGVuIGEgc3luYyBtb2RlbCBpcyBnaXZlbiwgYGZpbmRFeGlzdGluZ1JlcGxheVN5bmNgIGFuZFxuICAgKiBgcGVyc2lzdFJlcGxheU11dGF0aW9uYCBnZXQgbW9kZWwtYmFja2VkIGRlZmF1bHQgaW1wbGVtZW50YXRpb25zLiBUaGUgc3luY1xuICAgKiBtb2RlbCBtdXN0IGV4cG9zZSBgZmluZEJ5YC9gY3JlYXRlYCBzdGF0aWNzIHBsdXMgaW5zdGFuY2VcbiAgICogYGFzc2lnbmAvYHNhdmVgL2BjbGllbnRVcGRhdGVkQXRgIGFuZCBgYWR2YW5jZVNlcnZlclNlcXVlbmNlYCAodGhlXG4gICAqIGNoYW5nZS1mZWVkIHNlcXVlbmNlIGNvbnRyYWN0KSwgYW5kIHRoZSBhY3RvciByZXR1cm5lZCBmcm9tXG4gICAqIGBhdXRoZW50aWNhdGVSZXBsYXlgIG11c3QgZXhwb3NlIGFuIGBpZCgpYCBtZXRob2QuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBDb25zdHJ1Y3RvciBhcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7e2RlYnVnPzogKC4uLmFyZ3M6IEFycmF5PHVua25vd24+KSA9PiB2b2lkLCB3YXJuPzogKC4uLmFyZ3M6IEFycmF5PHVua25vd24+KSA9PiB2b2lkfX0gW2FyZ3MubG9nZ2VyXSAtIExvZ2dlciB1c2VkIGZvciBub3JtYWxpemF0aW9uIHdhcm5pbmdzLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBbYXJncy5zeW5jTW9kZWxdIC0gU3luYy9jaGFuZ2UgbW9kZWwgZW5hYmxpbmcgbW9kZWwtYmFja2VkIGRlZmF1bHQgaG9va3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5hY3RvckZvcmVpZ25LZXlDb2x1bW5dIC0gU3luYyBtb2RlbCBjb2x1bW4gbGlua2luZyByb3dzIHRvIHRoZSByZXBsYXkgYWN0b3IuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IFthcmdzLmF1dGhlbnRpY2F0aW9uVG9rZW5Nb2RlbF0gLSBUb2tlbiBtb2RlbCBlbmFibGluZyB0aGUgZGVmYXVsdCB0b2tlbi1sb29rdXAgYXV0aGVudGljYXRlUmVwbGF5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuYXV0aGVudGljYXRpb25Ub2tlbkNvbHVtbl0gLSBUb2tlbiBtb2RlbCBjb2x1bW4gaG9sZGluZyB0aGUgdG9rZW4uIERlZmF1bHRzIHRvIFwidG9rZW5cIi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmF1dGhlbnRpY2F0aW9uVG9rZW5QYXJhbV0gLSBSZXF1ZXN0IHBhcmFtIGNhcnJ5aW5nIHRoZSB0b2tlbi4gRGVmYXVsdHMgdG8gXCJhdXRoZW50aWNhdGlvblRva2VuXCIuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgKChhcmdzOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IFByb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSB8IENvbnN0cnVjdG9yUGFyYW1ldGVyczx0eXBlb2YgU3luY1JlcGxheVVwc2VydEFwcGxpZXI+WzBdPn0gW2FyZ3MuYXBwbHlIYW5kbGVyc10gLSBQZXItcmVzb3VyY2VUeXBlIGFwcGx5IGhhbmRsZXJzIChmdW5jdGlvbnMgb3IgZGVjbGFyYXRpdmUgdXBzZXJ0LWFwcGxpZXIgc3BlY3MpIGVuYWJsaW5nIHRoZSBkZWZhdWx0IGFwcGx5UmVwbGF5TXV0YXRpb24gZGlzcGF0Y2guIERlcHJlY2F0ZWQ6IHByZWZlciByZXNvdXJjZSByb3V0aW5nIHZpYSBgY29uZmlndXJhdGlvbmAvYHJlc291cmNlVHlwZU92ZXJyaWRlc2A7IGFwcGx5SGFuZGxlcnMgcmVtYWluIGZvciByZWxlYXNlZCBhZG9wdGVycyBhbmQgd2lsbCBiZSByZW1vdmVkIGFmdGVyIHRoZWlyIG1pZ3JhdGlvbi5cbiAgICogQHBhcmFtIHsoYXJnczogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSA9PiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IFthcmdzLnBlcnNpc3RFeHRyYUF0dHJpYnV0ZXNdIC0gRXh0cmEgYXR0cmlidXRlcyBtZXJnZWQgaW50byB0aGUgbW9kZWwtYmFja2VkIHBlcnNpc3RlZCByb3cgKGUuZy4gYW4gZXZlbnQgc2NvcGUgY29sdW1uKS5cbiAgICogQHBhcmFtIHsoYXJnczoge211dGF0aW9uOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgYXBwbHlSZXN1bHQ6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSkgPT4gUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IFthcmdzLnBlcnNpc3RTZXJpYWxpemVkRGF0YV0gLSBPdmVycmlkZXMgdGhlIHBlcnNpc3RlZCBkYXRhIHBheWxvYWQgKG9iamVjdCByZXN1bHRzIGFyZSBKU09OIHN0cmluZ2lmaWVkKS5cbiAgICogQHBhcmFtIHsoYnJvYWRjYXN0OiB7Y2hhbm5lbDogc3RyaW5nLCBwYXJhbXM6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgYm9keTogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59KSA9PiBQcm9taXNlPHZvaWQ+fSBbYXJncy5icm9hZGNhc3Rlcl0gLSBEZWxpdmVycyBkZWNsYXJhdGl2ZSBicm9hZGNhc3RzLiBSZXF1aXJlZCB3aGVuIGJyb2FkY2FzdHMgYXJlIGNvbmZpZ3VyZWQuXG4gICAqIEBwYXJhbSB7U3luY1JlcGxheUJyb2FkY2FzdFtdfSBbYXJncy5icm9hZGNhc3RzXSAtIEJyb2FkY2FzdHMgZmFubmVkIG91dCBieSB0aGUgZGVmYXVsdCBhZnRlclJlcGxheU11dGF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gW2FyZ3MuY29uZmlndXJhdGlvbl0gLSBDb25maWd1cmF0aW9uIHdob3NlIGZyb250ZW5kLW1vZGVsIHJlZ2lzdHJ5IHJvdXRlcyBtdXRhdGlvbnMgdG8gcmVzb3VyY2UgY2xhc3Nlcy5cbiAgICogQHBhcmFtIHt7c3RyYXRlZ3k/OiBcIm9wdGltaXN0aWNWZXJzaW9uXCIgfCBcInNlcnZlcldpbnNcIiwgdmVyc2lvbkF0dHJpYnV0ZTogc3RyaW5nfSB8IG51bGx9IFthcmdzLmNvbmZsaWN0U3RyYXRlZ3ldIC0gT3B0aW9uYWwgYmFzZS12ZXJzaW9uIGNvbmZsaWN0IGRldGVjdGlvbiBmb3Igcm91dGVkIHVwc2VydHMuIE9ubHkgYG9wdGltaXN0aWNWZXJzaW9uYCBhbmQgYHNlcnZlcldpbnNgIGFyZSBzdXBwb3J0ZWQgZm9yIGJhY2tlbmQgcmVwbGF5IGJlY2F1c2UgdGhlIHNlcnZlciBkb2VzIG5vdCBoYXZlIHRoZSBjbGllbnQncyBiYXNlIHNuYXBzaG90LiBXaGVuIGBzdHJhdGVneWAgaXMgb21pdHRlZCBpdCBkZWZhdWx0cyB0byBgb3B0aW1pc3RpY1ZlcnNpb25gLCBtYXRjaGluZyBgcmVzb2x2ZVN5bmNDb25mbGljdGAgYW5kIG5vcm1hbGl6ZWQgcmVzb3VyY2UgY29uZmlnLiBXaGVuIGNvbmZpZ3VyZWQsIGEgbXV0YXRpb24gd2hvc2UgYmFzZVZlcnNpb24gZG9lcyBub3QgbWF0Y2ggdGhlIGN1cnJlbnQgc2VydmVyIHZlcnNpb25BdHRyaWJ1dGUgaXMgcmVqZWN0ZWQgd2l0aCBhIHN0cnVjdHVyZWQgY29uZmxpY3QgcmVzdWx0IGluc3RlYWQgb2YgYmVpbmcgYXBwbGllZC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZSB8IHN0cmluZz59IFthcmdzLnJlc291cmNlVHlwZU92ZXJyaWRlc10gLSBQZXItcmVzb3VyY2VUeXBlIHJvdXRpbmcgb3ZlcnJpZGVzOiBhIHJlc291cmNlIGNsYXNzLCBvciBhIHN0cmluZyBhbGlhcyByZXNvbHZlZCB0aHJvdWdoIHRoZSByZWdpc3RyeS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9hdXRob3JpemF0aW9uL2FiaWxpdHkuanNcIikuZGVmYXVsdH0gW2FyZ3MuYWJpbGl0eV0gLSBBYmlsaXR5IHNjb3Bpbmcgcm91dGVkIHJlY29yZCBsb29rdXBzIGFuZCBjcmVhdGUgbWVtYmVyc2hpcCBjaGVja3MuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBbYXJncy5hYmlsaXR5Q29udGV4dF0gLSBBYmlsaXR5IGNvbnRleHQgcGFzc2VkIHRvIHJvdXRlZCByZXNvdXJjZXMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBbYXJncy5sb2NhbHNdIC0gTG9jYWxzIHBhc3NlZCB0byByb3V0ZWQgcmVzb3VyY2VzLlxuICAgKi9cbiAgY29uc3RydWN0b3IoYXJncyA9IHt9KSB7XG4gICAgdGhpcy5sb2dnZXIgPSBhcmdzLmxvZ2dlciB8fCBjb25zb2xlXG4gICAgdGhpcy5zeW5jTW9kZWwgPSBhcmdzLnN5bmNNb2RlbCB8fCBudWxsXG4gICAgdGhpcy5hY3RvckZvcmVpZ25LZXlDb2x1bW4gPSBhcmdzLmFjdG9yRm9yZWlnbktleUNvbHVtbiB8fCBcImF1dGhlbnRpY2F0aW9uX3Rva2VuX2lkXCJcbiAgICB0aGlzLmF1dGhlbnRpY2F0aW9uVG9rZW5Nb2RlbCA9IGFyZ3MuYXV0aGVudGljYXRpb25Ub2tlbk1vZGVsIHx8IG51bGxcbiAgICB0aGlzLmF1dGhlbnRpY2F0aW9uVG9rZW5Db2x1bW4gPSBhcmdzLmF1dGhlbnRpY2F0aW9uVG9rZW5Db2x1bW4gfHwgXCJ0b2tlblwiXG4gICAgdGhpcy5hdXRoZW50aWNhdGlvblRva2VuUGFyYW0gPSBhcmdzLmF1dGhlbnRpY2F0aW9uVG9rZW5QYXJhbSB8fCBcImF1dGhlbnRpY2F0aW9uVG9rZW5cIlxuICAgIHRoaXMucGVyc2lzdEV4dHJhQXR0cmlidXRlcyA9IGFyZ3MucGVyc2lzdEV4dHJhQXR0cmlidXRlcyB8fCBudWxsXG4gICAgdGhpcy5wZXJzaXN0U2VyaWFsaXplZERhdGEgPSBhcmdzLnBlcnNpc3RTZXJpYWxpemVkRGF0YSB8fCBudWxsXG4gICAgdGhpcy5icm9hZGNhc3RlciA9IGFyZ3MuYnJvYWRjYXN0ZXIgfHwgbnVsbFxuICAgIHRoaXMuYnJvYWRjYXN0cyA9IGFyZ3MuYnJvYWRjYXN0cyB8fCBudWxsXG4gICAgdGhpcy5hcHBseUhhbmRsZXJzID0gYXJncy5hcHBseUhhbmRsZXJzID8gdGhpcy5idWlsdEFwcGx5SGFuZGxlcnMoYXJncy5hcHBseUhhbmRsZXJzKSA6IG51bGxcbiAgICB0aGlzLmNvbmZpZ3VyYXRpb24gPSBhcmdzLmNvbmZpZ3VyYXRpb24gfHwgbnVsbFxuICAgIHRoaXMuY29uZmxpY3RTdHJhdGVneSA9IGFyZ3MuY29uZmxpY3RTdHJhdGVneSB8fCBudWxsXG4gICAgdGhpcy5yZXNvdXJjZVR5cGVPdmVycmlkZXMgPSBhcmdzLnJlc291cmNlVHlwZU92ZXJyaWRlcyB8fCBudWxsXG4gICAgdGhpcy5hYmlsaXR5ID0gYXJncy5hYmlsaXR5IHx8IG51bGxcbiAgICB0aGlzLmFiaWxpdHlDb250ZXh0ID0gYXJncy5hYmlsaXR5Q29udGV4dCB8fCBudWxsXG4gICAgdGhpcy5sb2NhbHMgPSBhcmdzLmxvY2FscyB8fCBudWxsXG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBTeW5jUmVwbGF5UmVzb3VyY2VSZWdpc3RyYXRpb24gfCBudWxsPn0gKi9cbiAgICB0aGlzLl9yZXBsYXlSZXNvdXJjZVJlZ2lzdHJhdGlvbnMgPSBuZXcgTWFwKClcblxuICAgIGlmIChhcmdzLmFjdG9yRm9yZWlnbktleUNvbHVtbiAhPT0gdW5kZWZpbmVkICYmICh0eXBlb2YgYXJncy5hY3RvckZvcmVpZ25LZXlDb2x1bW4gIT09IFwic3RyaW5nXCIgfHwgYXJncy5hY3RvckZvcmVpZ25LZXlDb2x1bW4ubGVuZ3RoIDwgMSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgYWN0b3JGb3JlaWduS2V5Q29sdW1uIG11c3QgYmUgYSBub24tYmxhbmsgc3RyaW5nLCBnb3Q6ICR7U3RyaW5nKGFyZ3MuYWN0b3JGb3JlaWduS2V5Q29sdW1uKX1gKVxuICAgIH1cbiAgICBpZiAodGhpcy5icm9hZGNhc3RzICYmICF0aGlzLmJyb2FkY2FzdGVyKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jRW52ZWxvcGVSZXBsYXlTZXJ2aWNlIGJyb2FkY2FzdHMgcmVxdWlyZSBhIGJyb2FkY2FzdGVyIG9wdGlvbiBkZWxpdmVyaW5nIHRoZW1cIilcbiAgICB9XG4gICAgaWYgKHRoaXMuY29uZmxpY3RTdHJhdGVneSkge1xuICAgICAgY29uc3Qgc3VwcG9ydGVkQ29uZmxpY3RTdHJhdGVnaWVzID0gbmV3IFNldChbXCJvcHRpbWlzdGljVmVyc2lvblwiLCBcInNlcnZlcldpbnNcIl0pXG5cbiAgICAgIGlmICghdGhpcy5jb25mbGljdFN0cmF0ZWd5LnZlcnNpb25BdHRyaWJ1dGUgfHwgdHlwZW9mIHRoaXMuY29uZmxpY3RTdHJhdGVneS52ZXJzaW9uQXR0cmlidXRlICE9PSBcInN0cmluZ1wiKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIlN5bmNFbnZlbG9wZVJlcGxheVNlcnZpY2UgY29uZmxpY3RTdHJhdGVneSByZXF1aXJlcyBhIG5vbi1ibGFuayB2ZXJzaW9uQXR0cmlidXRlXCIpXG4gICAgICB9XG4gICAgICBpZiAodGhpcy5jb25mbGljdFN0cmF0ZWd5LnN0cmF0ZWd5ICE9PSB1bmRlZmluZWQgJiYgIXN1cHBvcnRlZENvbmZsaWN0U3RyYXRlZ2llcy5oYXModGhpcy5jb25mbGljdFN0cmF0ZWd5LnN0cmF0ZWd5KSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIHN5bmMgY29uZmxpY3Qgc3RyYXRlZ3kgZm9yIGJhY2tlbmQgcmVwbGF5OiAke3RoaXMuY29uZmxpY3RTdHJhdGVneS5zdHJhdGVneX0uIE9ubHkgb3B0aW1pc3RpY1ZlcnNpb24gYW5kIHNlcnZlcldpbnMgYXJlIHN1cHBvcnRlZC5gKVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBXcmFwcyBkZWNsYXJhdGl2ZSBhcHBseS1oYW5kbGVyIHNwZWNzIGluIHVwc2VydCBhcHBsaWVycy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFwcGx5SGFuZGxlcnMgLSBSYXcgYXBwbHkgaGFuZGxlcnMuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCAoYXJnczogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSA9PiBQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IENhbGxhYmxlIGhhbmRsZXJzIGJ5IHJlc291cmNlIHR5cGUuXG4gICAqL1xuICBidWlsdEFwcGx5SGFuZGxlcnMoYXBwbHlIYW5kbGVycykge1xuICAgIHJldHVybiBPYmplY3QuZnJvbUVudHJpZXMoT2JqZWN0LmVudHJpZXMoYXBwbHlIYW5kbGVycykubWFwKChbcmVzb3VyY2VUeXBlLCBoYW5kbGVyXSkgPT4ge1xuICAgICAgaWYgKHR5cGVvZiBoYW5kbGVyID09PSBcImZ1bmN0aW9uXCIpIHJldHVybiBbcmVzb3VyY2VUeXBlLCBoYW5kbGVyXVxuXG4gICAgICBjb25zdCBhcHBsaWVyID0gbmV3IFN5bmNSZXBsYXlVcHNlcnRBcHBsaWVyKGhhbmRsZXIpXG5cbiAgICAgIHJldHVybiBbcmVzb3VyY2VUeXBlLCAoLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIGFwcGx5QXJncykgPT4gYXBwbGllci5hcHBseSgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAoYXBwbHlBcmdzKSldXG4gICAgfSkpXG4gIH1cblxuICAvKipcbiAgICogUmVwbGF5cyBhIHN5bmMgYmF0Y2guXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBwYXJhbXMgLSBSZXF1ZXN0IHBhcmFtcyBjYXJyeWluZyBhdXRoZW50aWNhdGlvbiBhbmQgc3luY3MuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBbcmVxdWVzdFN0YXRlXSAtIFJlcXVlc3QtbG9jYWwgc3RhdGUgcGFzc2VkIHRvIGF1dGhlbnRpY2F0aW9uL3N5bmMgZXh0cmFjdGlvbiBob29rczsgc3ViY2xhc3NlcyBtYXkgdXNlIHRoaXMgdG8gc2hhcmUgcHJlLWNvbXB1dGVkIHBlci1yZXF1ZXN0IGRhdGEgd2l0aG91dCBpbnN0YW5jZSBtdXRhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8e3N5bmNzOiBBcnJheTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+LCBzdGF0dXM/OiBzdHJpbmcsIGVycm9yQ29kZT86IHN0cmluZywgZXJyb3JNZXNzYWdlPzogc3RyaW5nfT59IFJlcGxheSByZXNwb25zZS5cbiAgICovXG4gIGFzeW5jIHJlcGxheShwYXJhbXMsIHJlcXVlc3RTdGF0ZSA9IHt9KSB7XG4gICAgY29uc3QgYWN0b3JSZXN1bHQgPSBhd2FpdCB0aGlzLmF1dGhlbnRpY2F0ZVJlcGxheShwYXJhbXMsIHJlcXVlc3RTdGF0ZSlcblxuICAgIGlmICghYWN0b3JSZXN1bHQuYXV0aGVudGljYXRlZCkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3luY3M6IFtdLFxuICAgICAgICBzdGF0dXM6IFwiZXJyb3JcIixcbiAgICAgICAgZXJyb3JDb2RlOiBhY3RvclJlc3VsdC5lcnJvckNvZGUsXG4gICAgICAgIGVycm9yTWVzc2FnZTogYWN0b3JSZXN1bHQuZXJyb3JNZXNzYWdlXG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3Qgc3luY1Jlc3BvbnNlcyA9IFtdXG4gICAgY29uc3QgY29udGV4dCA9IGF3YWl0IHRoaXMuYnVpbGRSZXBsYXlDb250ZXh0KHthY3RvcjogYWN0b3JSZXN1bHQuYWN0b3IsIHBhcmFtcywgcmVxdWVzdFN0YXRlfSlcblxuICAgIGZvciAoY29uc3QgcmF3U3luYyBvZiB0aGlzLnJlcGxheVN5bmNzKHBhcmFtcywgcmVxdWVzdFN0YXRlKSkge1xuICAgICAgY29uc3Qgbm9ybWFsaXplZFJlc3VsdCA9IHRoaXMubm9ybWFsaXplUmVwbGF5U3luYyhyYXdTeW5jKVxuXG4gICAgICBpZiAoIW5vcm1hbGl6ZWRSZXN1bHQub2spIHtcbiAgICAgICAgc3luY1Jlc3BvbnNlcy5wdXNoKG5vcm1hbGl6ZWRSZXN1bHQucmVzcG9uc2UpXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IG11dGF0aW9uID0gbm9ybWFsaXplZFJlc3VsdC5tdXRhdGlvblxuICAgICAgY29uc3QgYWNjZXNzUmVzdWx0ID0gYXdhaXQgdGhpcy5hdXRob3JpemVSZXBsYXlNdXRhdGlvbih7YWN0b3I6IGFjdG9yUmVzdWx0LmFjdG9yLCBjb250ZXh0LCBtdXRhdGlvbn0pXG5cbiAgICAgIGlmICghYWNjZXNzUmVzdWx0LmFsbG93ZWQpIHtcbiAgICAgICAgc3luY1Jlc3BvbnNlcy5wdXNoKHtcbiAgICAgICAgICBpZDogbXV0YXRpb24uaWQsXG4gICAgICAgICAgc3luY1N0YXRlOiBcImZhaWxlZFwiLFxuICAgICAgICAgIHJlYXNvbjogYWNjZXNzUmVzdWx0LnJlYXNvbiB8fCBcImFjY2Vzcy1kZW5pZWRcIlxuICAgICAgICB9KVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBjb25zdCBleGlzdGluZ1N5bmMgPSBhd2FpdCB0aGlzLmZpbmRFeGlzdGluZ1JlcGxheVN5bmMoe2FjdG9yOiBhY3RvclJlc3VsdC5hY3RvciwgY29udGV4dCwgbXV0YXRpb259KVxuICAgICAgY29uc3Qgc2hvdWxkQXBwbHkgPSBhd2FpdCB0aGlzLnNob3VsZEFwcGx5UmVwbGF5TXV0YXRpb24oe2FjdG9yOiBhY3RvclJlc3VsdC5hY3RvciwgY29udGV4dCwgZXhpc3RpbmdTeW5jLCBtdXRhdGlvbn0pXG4gICAgICBjb25zdCBkdXBsaWNhdGUgPSAhc2hvdWxkQXBwbHkgJiYgdGhpcy5pc0R1cGxpY2F0ZVJlcGxheU11dGF0aW9uKHtleGlzdGluZ1N5bmMsIG11dGF0aW9ufSlcblxuICAgICAgLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi9cbiAgICAgIGxldCBhcHBseVJlc3VsdFxuXG4gICAgICB0cnkge1xuICAgICAgICBhcHBseVJlc3VsdCA9IHNob3VsZEFwcGx5XG4gICAgICAgICAgPyBhd2FpdCB0aGlzLmFwcGx5UmVwbGF5TXV0YXRpb24oe2FjdG9yOiBhY3RvclJlc3VsdC5hY3RvciwgY29udGV4dCwgZXhpc3RpbmdTeW5jLCBtdXRhdGlvbn0pXG4gICAgICAgICAgOiBhd2FpdCB0aGlzLnNraXBwZWRSZXBsYXlNdXRhdGlvbih7YWN0b3I6IGFjdG9yUmVzdWx0LmFjdG9yLCBjb250ZXh0LCBleGlzdGluZ1N5bmMsIG11dGF0aW9ufSlcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIC8vIENsaWVudC1zYWZlIGFwcGx5IGZhaWx1cmVzIChzY2hlbWEgdmFsaWRhdGlvbiwgbW9kZWwgdmFsaWRhdGlvbixcbiAgICAgICAgLy8gYXV0aG9yaXphdGlvbiBkZW5pYWxzLCB1bmtub3duIHJlc291cmNlIHR5cGVzKSBmYWlsIHRoaXMgc3luYyBhbmRcbiAgICAgICAgLy8ga2VlcCB0aGUgYmF0Y2ggZ29pbmc7IHVuZXhwZWN0ZWQgZXJyb3JzIGtlZXAgcHJvcGFnYXRpbmcuXG4gICAgICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIFZlbG9jaW91c0Vycm9yICYmIGVycm9yLnNhZmVUb0V4cG9zZSkge1xuICAgICAgICAgIHN5bmNSZXNwb25zZXMucHVzaCh7XG4gICAgICAgICAgICBpZDogbXV0YXRpb24uaWQsXG4gICAgICAgICAgICBzeW5jU3RhdGU6IFwiZmFpbGVkXCIsXG4gICAgICAgICAgICByZWFzb246IGVycm9yLmNvZGUgfHwgXCJhcHBseS1mYWlsZWRcIixcbiAgICAgICAgICAgIG1lc3NhZ2U6IGVycm9yLm1lc3NhZ2VcbiAgICAgICAgICB9KVxuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH1cblxuICAgICAgICB0aHJvdyBlcnJvclxuICAgICAgfVxuXG4gICAgICBpZiAoYXBwbHlSZXN1bHQgJiYgYXBwbHlSZXN1bHQuc3RhdHVzID09PSBcImNvbmZsaWN0XCIpIHtcbiAgICAgICAgc3luY1Jlc3BvbnNlcy5wdXNoKHtcbiAgICAgICAgICBjb25mbGljdDogYXBwbHlSZXN1bHQuY29uZmxpY3QsXG4gICAgICAgICAgaWQ6IG11dGF0aW9uLmlkLFxuICAgICAgICAgIHN5bmNTdGF0ZTogXCJjb25mbGljdFwiXG4gICAgICAgIH0pXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHRoaXMucGVyc2lzdFJlcGxheU11dGF0aW9uKHthY3RvcjogYWN0b3JSZXN1bHQuYWN0b3IsIGNvbnRleHQsIGV4aXN0aW5nU3luYywgYXBwbHlSZXN1bHQsIG11dGF0aW9uLCBzaG91bGRBcHBseX0pXG4gICAgICBhd2FpdCB0aGlzLmFmdGVyUmVwbGF5TXV0YXRpb24oe2FjdG9yOiBhY3RvclJlc3VsdC5hY3RvciwgY29udGV4dCwgZXhpc3RpbmdTeW5jLCBhcHBseVJlc3VsdCwgbXV0YXRpb24sIHNob3VsZEFwcGx5fSlcblxuICAgICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgICBjb25zdCBzdWNjZXNzZnVsUmVzcG9uc2UgPSB7aWQ6IG11dGF0aW9uLmlkLCBzeW5jU3RhdGU6IGR1cGxpY2F0ZSA/IFwiZHVwbGljYXRlXCIgOiBcInN1Y2Nlc3NmdWxcIn1cblxuICAgICAgY29uc3QgcGVyc2lzdGVkUmVwbGF5TWV0YWRhdGEgPSBkdXBsaWNhdGUgPyB0aGlzLnJlcGxheVBlcnNpc3RlZE1ldGFkYXRhKGV4aXN0aW5nU3luYykgOiBudWxsXG5cbiAgICAgIGlmIChwZXJzaXN0ZWRSZXBsYXlNZXRhZGF0YSkge1xuICAgICAgICBzdWNjZXNzZnVsUmVzcG9uc2Uuc2VydmVyVmVyc2lvbiA9IHBlcnNpc3RlZFJlcGxheU1ldGFkYXRhLmFja25vd2xlZGdlbWVudFZlcnNpb25cbiAgICAgIH0gZWxzZSBpZiAodGhpcy5jb25mbGljdFN0cmF0ZWd5ICYmIG11dGF0aW9uLmJhc2VWZXJzaW9uICE9PSB1bmRlZmluZWQgJiYgYXBwbHlSZXN1bHQ/LnJlY29yZCkge1xuICAgICAgICBzdWNjZXNzZnVsUmVzcG9uc2Uuc2VydmVyVmVyc2lvbiA9IG5vcm1hbGl6ZUNvbmZsaWN0VmFsdWUoYXBwbHlSZXN1bHQucmVjb3JkLnJlYWRBdHRyaWJ1dGUodGhpcy5jb25mbGljdFN0cmF0ZWd5LnZlcnNpb25BdHRyaWJ1dGUpKVxuICAgICAgfVxuXG4gICAgICBzeW5jUmVzcG9uc2VzLnB1c2goc3VjY2Vzc2Z1bFJlc3BvbnNlKVxuICAgIH1cblxuICAgIHJldHVybiB7c3luY3M6IHN5bmNSZXNwb25zZXN9XG4gIH1cblxuICAvKipcbiAgICogQXV0aGVudGljYXRlcyB0aGUgc3luYyBiYXRjaCBhY3Rvci5cbiAgICpcbiAgICogRGVmYXVsdHMgdG8gYSB0b2tlbi1tb2RlbCBsb29rdXAgd2hlbiBgYXV0aGVudGljYXRpb25Ub2tlbk1vZGVsYCBpc1xuICAgKiBjb25maWd1cmVkOyBvdGhlcndpc2UgYXBwcyBvdmVycmlkZSB0aGlzIGhvb2suXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBwYXJhbXMgLSBSZXF1ZXN0IHBhcmFtcy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IFtfcmVxdWVzdFN0YXRlXSAtIFJlcXVlc3QtbG9jYWwgc3RhdGUgcG9wdWxhdGVkIGJ5IHN1YmNsYXNzZXMgYmVmb3JlIHRoZSBiYXNlIHJlcGxheSBsb29wIHJ1bnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHthdXRoZW50aWNhdGVkOiB0cnVlLCBhY3RvcjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHwge2F1dGhlbnRpY2F0ZWQ6IGZhbHNlLCBlcnJvckNvZGU6IHN0cmluZywgZXJyb3JNZXNzYWdlOiBzdHJpbmd9Pn0gQXV0aCByZXN1bHQuXG4gICAqL1xuICBhc3luYyBhdXRoZW50aWNhdGVSZXBsYXkocGFyYW1zLCBfcmVxdWVzdFN0YXRlKSB7XG4gICAgaWYgKCF0aGlzLmF1dGhlbnRpY2F0aW9uVG9rZW5Nb2RlbCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiU3luY0VudmVsb3BlUmVwbGF5U2VydmljZS5hdXRoZW50aWNhdGVSZXBsYXkgbXVzdCBiZSBpbXBsZW1lbnRlZCAob3IgY29uZmlndXJlIGF1dGhlbnRpY2F0aW9uVG9rZW5Nb2RlbClcIilcbiAgICB9XG5cbiAgICBjb25zdCB0b2tlbiA9IHBhcmFtc1t0aGlzLmF1dGhlbnRpY2F0aW9uVG9rZW5QYXJhbV1cblxuICAgIGlmICghdG9rZW4pIHtcbiAgICAgIHJldHVybiB7YXV0aGVudGljYXRlZDogZmFsc2UsIGVycm9yQ29kZTogXCJtaXNzaW5nLWF1dGhlbnRpY2F0aW9uLXRva2VuXCIsIGVycm9yTWVzc2FnZTogXCJNaXNzaW5nIGF1dGhlbnRpY2F0aW9uIHRva2VuXCJ9XG4gICAgfVxuXG4gICAgY29uc3QgYWN0b3IgPSBhd2FpdCB0aGlzLmF1dGhlbnRpY2F0aW9uVG9rZW5Nb2RlbC5maW5kQnkoe1t0aGlzLmF1dGhlbnRpY2F0aW9uVG9rZW5Db2x1bW5dOiB0b2tlbn0pXG5cbiAgICBpZiAoIWFjdG9yKSB7XG4gICAgICByZXR1cm4ge2F1dGhlbnRpY2F0ZWQ6IGZhbHNlLCBlcnJvckNvZGU6IFwiaW52YWxpZC1hdXRoZW50aWNhdGlvbi10b2tlblwiLCBlcnJvck1lc3NhZ2U6IFwiSW52YWxpZCBhdXRoZW50aWNhdGlvbiB0b2tlblwifVxuICAgIH1cblxuICAgIHJldHVybiB7YWN0b3IsIGF1dGhlbnRpY2F0ZWQ6IHRydWV9XG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHBlci1iYXRjaCBtdXRhYmxlIGNvbnRleHQgZm9yIGNhY2hlcyBzaGFyZWQgYWNyb3NzIHN5bmMgaXRlbXMuXG4gICAqIEBwYXJhbSB7e2FjdG9yOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgcGFyYW1zOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIHJlcXVlc3RTdGF0ZTogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fX0gX2FyZ3MgLSBBY3RvciwgcmVxdWVzdCBwYXJhbXMsIGFuZCByZXF1ZXN0LWxvY2FsIHN0YXRlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSBSZXBsYXkgY29udGV4dC5cbiAgICovXG4gIGFzeW5jIGJ1aWxkUmVwbGF5Q29udGV4dChfYXJncykge1xuICAgIHJldHVybiB7fVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgcmF3IHN5bmMgZW50cmllcyBmcm9tIHJlcXVlc3QgcGFyYW1zLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gcGFyYW1zIC0gUmVxdWVzdCBwYXJhbXMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBbX3JlcXVlc3RTdGF0ZV0gLSBSZXF1ZXN0LWxvY2FsIHN0YXRlIHBvcHVsYXRlZCBieSBzdWJjbGFzc2VzIGJlZm9yZSB0aGUgYmFzZSByZXBsYXkgbG9vcCBydW5zLlxuICAgKiBAcmV0dXJucyB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBSYXcgc3luYyBlbnRyaWVzLlxuICAgKi9cbiAgcmVwbGF5U3luY3MocGFyYW1zLCBfcmVxdWVzdFN0YXRlKSB7XG4gICAgcmV0dXJuIEFycmF5LmlzQXJyYXkocGFyYW1zLnN5bmNzKSA/IHBhcmFtcy5zeW5jcyA6IFtdXG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplcyBvbmUgc3luYyBlbnRyeS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gcmF3U3luYyAtIFJhdyBzeW5jIGVudHJ5LlxuICAgKiBAcmV0dXJucyB7e29rOiB0cnVlLCBtdXRhdGlvbjogaW1wb3J0KFwiLi9zeW5jLWVudmVsb3BlLXJlcGxheS1zZXJ2aWNlLmpzXCIpLlN5bmNSZXBsYXlNdXRhdGlvbn0gfCB7b2s6IGZhbHNlLCByZXNwb25zZTogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fX0gTm9ybWFsaXplZCBtdXRhdGlvbiBvciBmYWlsZWQgcmVzcG9uc2UuXG4gICAqL1xuICBub3JtYWxpemVSZXBsYXlTeW5jKHJhd1N5bmMpIHtcbiAgICBpZiAoIXJhd1N5bmMgfHwgdHlwZW9mIHJhd1N5bmMgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShyYXdTeW5jKSkge1xuICAgICAgcmV0dXJuIHtvazogZmFsc2UsIHJlc3BvbnNlOiB7aWQ6IHVuZGVmaW5lZCwgc3luY1N0YXRlOiBcImZhaWxlZFwiLCByZWFzb246IFwiaW52YWxpZC1zeW5jXCJ9fVxuICAgIH1cblxuICAgIGNvbnN0IHN5bmMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHJhd1N5bmMpXG4gICAgY29uc3Qge2NsaWVudE11dGF0aW9uSWQsIGNsaWVudFVwZGF0ZWRBdCwgZGF0YSwgaWQsIHJlc291cmNlSWQsIHJlc291cmNlVHlwZSwgc3luY1R5cGV9ID0gc3luY1xuXG4gICAgaWYgKHR5cGVvZiByZXNvdXJjZVR5cGUgIT09IFwic3RyaW5nXCIgfHwgcmVzb3VyY2VUeXBlLmxlbmd0aCA8IDEgfHwgcmVzb3VyY2VJZCA9PT0gdW5kZWZpbmVkIHx8IHJlc291cmNlSWQgPT09IG51bGwgfHwgdHlwZW9mIHN5bmNUeXBlICE9PSBcInN0cmluZ1wiIHx8IHN5bmNUeXBlLmxlbmd0aCA8IDEpIHtcbiAgICAgIHJldHVybiB7b2s6IGZhbHNlLCByZXNwb25zZToge2lkLCBzeW5jU3RhdGU6IFwiZmFpbGVkXCIsIHJlYXNvbjogXCJpbnZhbGlkLXJlc291cmNlLWlkXCJ9fVxuICAgIH1cblxuICAgIGNvbnN0IHJlc291cmNlSWRTdHJpbmcgPSBTdHJpbmcocmVzb3VyY2VJZClcbiAgICBsZXQgY2xpZW50VXBkYXRlZEF0RGF0ZSA9IHR5cGVvZiBjbGllbnRVcGRhdGVkQXQgPT09IFwic3RyaW5nXCIgfHwgY2xpZW50VXBkYXRlZEF0IGluc3RhbmNlb2YgRGF0ZSA/IG5ldyBEYXRlKGNsaWVudFVwZGF0ZWRBdCkgOiBuZXcgRGF0ZSgpXG5cbiAgICBpZiAoTnVtYmVyLmlzTmFOKGNsaWVudFVwZGF0ZWRBdERhdGUuZ2V0VGltZSgpKSkgY2xpZW50VXBkYXRlZEF0RGF0ZSA9IG5ldyBEYXRlKClcblxuICAgIGNvbnN0IG5vcm1hbGl6ZWREYXRhUmVzdWx0ID0gdGhpcy5ub3JtYWxpemVSZXBsYXlTeW5jRGF0YSh7ZGF0YSwgaWQsIHJlc291cmNlSWQ6IHJlc291cmNlSWRTdHJpbmcsIHJlc291cmNlVHlwZX0pXG5cbiAgICBpZiAoIW5vcm1hbGl6ZWREYXRhUmVzdWx0Lm9rKSByZXR1cm4gbm9ybWFsaXplZERhdGFSZXN1bHRcblxuICAgIHJldHVybiB7XG4gICAgICBvazogdHJ1ZSxcbiAgICAgIG11dGF0aW9uOiB7XG4gICAgICAgIGJhc2VWZXJzaW9uOiBzeW5jLmJhc2VWZXJzaW9uLFxuICAgICAgICBjbGllbnRNdXRhdGlvbklkLFxuICAgICAgICBjbGllbnRVcGRhdGVkQXQ6IGNsaWVudFVwZGF0ZWRBdERhdGUsXG4gICAgICAgIGRhdGE6IG5vcm1hbGl6ZWREYXRhUmVzdWx0LmRhdGEsXG4gICAgICAgIGlkLFxuICAgICAgICByZXNvdXJjZUlkOiByZXNvdXJjZUlkU3RyaW5nLFxuICAgICAgICByZXNvdXJjZVR5cGUsXG4gICAgICAgIHNlcmlhbGl6ZWREYXRhOiBKU09OLnN0cmluZ2lmeShub3JtYWxpemVkRGF0YVJlc3VsdC5kYXRhKSxcbiAgICAgICAgc3luY1R5cGVcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplcyBvbmUgc3luYyBkYXRhIHBheWxvYWQuXG4gICAqIEBwYXJhbSB7e2RhdGE6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBpZDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIHJlc291cmNlSWQ6IHN0cmluZywgcmVzb3VyY2VUeXBlOiBzdHJpbmd9fSBhcmdzIC0gU3luYyBwYXlsb2FkIG5vcm1hbGl6YXRpb24gYXJndW1lbnRzLlxuICAgKiBAcmV0dXJucyB7e29rOiB0cnVlLCBkYXRhOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHwge29rOiBmYWxzZSwgcmVzcG9uc2U6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn19IE5vcm1hbGl6ZWQgcGF5bG9hZCBvciBmYWlsZWQgcmVzcG9uc2UuXG4gICAqL1xuICBub3JtYWxpemVSZXBsYXlTeW5jRGF0YSh7ZGF0YSwgaWQsIHJlc291cmNlSWQsIHJlc291cmNlVHlwZX0pIHtcbiAgICBpZiAoZGF0YSA9PT0gdW5kZWZpbmVkIHx8IGRhdGEgPT09IG51bGwpIHJldHVybiB7b2s6IHRydWUsIGRhdGE6IHt9fVxuXG4gICAgaWYgKHR5cGVvZiBkYXRhID09PSBcInN0cmluZ1wiKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBwYXJzZWREYXRhID0gSlNPTi5wYXJzZShkYXRhKVxuXG4gICAgICAgIGlmICghcGFyc2VkRGF0YSB8fCB0eXBlb2YgcGFyc2VkRGF0YSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHBhcnNlZERhdGEpKSByZXR1cm4ge29rOiB0cnVlLCBkYXRhOiB7fX1cblxuICAgICAgICByZXR1cm4ge29rOiB0cnVlLCBkYXRhOiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHBhcnNlZERhdGEpfVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIud2Fybj8uKFwiSW52YWxpZCBzeW5jIGRhdGEgSlNPTlwiLCB7ZXJyb3IsIGlkLCByZXNvdXJjZUlkLCByZXNvdXJjZVR5cGV9KVxuICAgICAgICByZXR1cm4ge29rOiBmYWxzZSwgcmVzcG9uc2U6IHtpZCwgc3luY1N0YXRlOiBcImZhaWxlZFwiLCByZWFzb246IFwiaW52YWxpZC1kYXRhXCJ9fVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmICh0eXBlb2YgZGF0YSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KGRhdGEpKSByZXR1cm4ge29rOiB0cnVlLCBkYXRhOiB7fX1cblxuICAgIHJldHVybiB7b2s6IHRydWUsIGRhdGE6IEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkoZGF0YSkpfVxuICB9XG5cbiAgLyoqXG4gICAqIEF1dGhvcml6ZXMgb25lIG5vcm1hbGl6ZWQgbXV0YXRpb24uXG4gICAqIEBwYXJhbSB7e2FjdG9yOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgY29udGV4dDogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBtdXRhdGlvbjogaW1wb3J0KFwiLi9zeW5jLWVudmVsb3BlLXJlcGxheS1zZXJ2aWNlLmpzXCIpLlN5bmNSZXBsYXlNdXRhdGlvbn19IF9hcmdzIC0gQWN0b3IsIGJhdGNoIGNvbnRleHQsIGFuZCBtdXRhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8e2FsbG93ZWQ6IGJvb2xlYW4sIHJlYXNvbj86IHN0cmluZ30+fSBBY2Nlc3MgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgYXV0aG9yaXplUmVwbGF5TXV0YXRpb24oX2FyZ3MpIHtcbiAgICByZXR1cm4ge2FsbG93ZWQ6IHRydWV9XG4gIH1cblxuICAvKipcbiAgICogTG9hZHMgdGhlIHByZXZpb3VzbHkgc3RvcmVkIHN5bmMvY2hhbmdlIHJvdyBmb3Igc3RhbGUtY2xpZW50IGNvbXBhcmlzb24uXG4gICAqXG4gICAqIERlZmF1bHRzIHRvIGEgc3luYy1tb2RlbCBsb29rdXAgYnkgYWN0b3IgYW5kIHJlc291cmNlIGlkZW50aXR5IHdoZW4gYSBzeW5jXG4gICAqIG1vZGVsIGlzIGNvbmZpZ3VyZWQ7IG90aGVyd2lzZSBhcHBzIG92ZXJyaWRlIHRoaXMgaG9vay5cbiAgICogQHBhcmFtIHt7YWN0b3I6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBjb250ZXh0OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIG11dGF0aW9uOiBpbXBvcnQoXCIuL3N5bmMtZW52ZWxvcGUtcmVwbGF5LXNlcnZpY2UuanNcIikuU3luY1JlcGxheU11dGF0aW9ufX0gYXJncyAtIEFjdG9yLCBiYXRjaCBjb250ZXh0LCBhbmQgbXV0YXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gRXhpc3Rpbmcgc3luYyByb3cuXG4gICAqL1xuICBhc3luYyBmaW5kRXhpc3RpbmdSZXBsYXlTeW5jKHthY3RvciwgbXV0YXRpb259KSB7XG4gICAgaWYgKCF0aGlzLnN5bmNNb2RlbCkgcmV0dXJuIG51bGxcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLnN5bmNNb2RlbC5maW5kQnkoe1xuICAgICAgW3RoaXMuYWN0b3JGb3JlaWduS2V5Q29sdW1uXTogdGhpcy5yZXBsYXlBY3RvcklkKGFjdG9yKSxcbiAgICAgIHJlc291cmNlX2lkOiBtdXRhdGlvbi5yZXNvdXJjZUlkLFxuICAgICAgcmVzb3VyY2VfdHlwZTogbXV0YXRpb24ucmVzb3VyY2VUeXBlXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgcGVyc2lzdGVkIGFjdG9yIGlkIHVzZWQgYnkgbW9kZWwtYmFja2VkIGRlZmF1bHQgaG9va3MuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFjdG9yIC0gQWN0b3IgcmV0dXJuZWQgZnJvbSBhdXRoZW50aWNhdGVSZXBsYXkuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gQWN0b3IgaWQuXG4gICAqL1xuICByZXBsYXlBY3RvcklkKGFjdG9yKSB7XG4gICAgaWYgKCFhY3RvciB8fCB0eXBlb2YgYWN0b3IgIT09IFwib2JqZWN0XCIgfHwgdHlwZW9mIGFjdG9yLmlkICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlN5bmNFbnZlbG9wZVJlcGxheVNlcnZpY2UgbW9kZWwtYmFja2VkIGRlZmF1bHRzIHJlcXVpcmUgYW4gYWN0b3Igd2l0aCBhbiBpZCgpIG1ldGhvZCBmcm9tIGF1dGhlbnRpY2F0ZVJlcGxheVwiKVxuICAgIH1cblxuICAgIHJldHVybiBhY3Rvci5pZCgpXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB3aGV0aGVyIGEgbm9ybWFsaXplZCBtdXRhdGlvbiBzaG91bGQgYmUgYXBwbGllZCB0byBkb21haW4gbW9kZWxzLlxuICAgKiBAcGFyYW0ge3thY3RvcjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGNvbnRleHQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgZXhpc3RpbmdTeW5jOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgbXV0YXRpb246IGltcG9ydChcIi4vc3luYy1lbnZlbG9wZS1yZXBsYXktc2VydmljZS5qc1wiKS5TeW5jUmVwbGF5TXV0YXRpb259fSBhcmdzIC0gQWN0b3IsIGJhdGNoIGNvbnRleHQsIGV4aXN0aW5nIHN5bmMgcm93LCBhbmQgbXV0YXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSBXaGV0aGVyIHRvIGFwcGx5IHRoZSBtdXRhdGlvbi5cbiAgICovXG4gIGFzeW5jIHNob3VsZEFwcGx5UmVwbGF5TXV0YXRpb24oe2V4aXN0aW5nU3luYywgbXV0YXRpb259KSB7XG4gICAgY29uc3QgZXhpc3RpbmdDbGllbnRVcGRhdGVkQXQgPSB0aGlzLmV4aXN0aW5nUmVwbGF5U3luY0NsaWVudFVwZGF0ZWRBdChleGlzdGluZ1N5bmMpXG5cbiAgICByZXR1cm4gIWV4aXN0aW5nQ2xpZW50VXBkYXRlZEF0IHx8IG11dGF0aW9uLmNsaWVudFVwZGF0ZWRBdCA+IGV4aXN0aW5nQ2xpZW50VXBkYXRlZEF0XG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIGNsaWVudCB0aW1lc3RhbXAgZnJvbSBhbiBleGlzdGluZyBzeW5jIHJvdy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gZXhpc3RpbmdTeW5jIC0gRXhpc3Rpbmcgc3luYyByb3cuXG4gICAqIEByZXR1cm5zIHtEYXRlIHwgbnVsbH0gRXhpc3RpbmcgY2xpZW50IHRpbWVzdGFtcC5cbiAgICovXG4gIGV4aXN0aW5nUmVwbGF5U3luY0NsaWVudFVwZGF0ZWRBdChleGlzdGluZ1N5bmMpIHtcbiAgICBpZiAoIWV4aXN0aW5nU3luYyB8fCB0eXBlb2YgZXhpc3RpbmdTeW5jICE9PSBcIm9iamVjdFwiKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3Qgc3luY1JlY29yZCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoZXhpc3RpbmdTeW5jKVxuICAgIGNvbnN0IHZhbHVlID0gdHlwZW9mIHN5bmNSZWNvcmQuY2xpZW50VXBkYXRlZEF0ID09PSBcImZ1bmN0aW9uXCJcbiAgICAgID8gc3luY1JlY29yZC5jbGllbnRVcGRhdGVkQXQoKVxuICAgICAgOiBzeW5jUmVjb3JkLmNsaWVudFVwZGF0ZWRBdFxuXG4gICAgaWYgKHZhbHVlIGluc3RhbmNlb2YgRGF0ZSkgcmV0dXJuIHZhbHVlXG5cbiAgICBpZiAodHlwZW9mIHZhbHVlICE9PSBcInN0cmluZ1wiKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgcGFyc2VkVmFsdWUgPSBuZXcgRGF0ZSh2YWx1ZSlcblxuICAgIHJldHVybiBOdW1iZXIuaXNOYU4ocGFyc2VkVmFsdWUuZ2V0VGltZSgpKSA/IG51bGwgOiBwYXJzZWRWYWx1ZVxuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrcyB3aGV0aGVyIGEgc2tpcHBlZCBtdXRhdGlvbiBleGFjdGx5IG1hdGNoZXMgdGhlIHBlcnNpc3RlZCByZXBsYXkgcm93LlxuICAgKiBPbGRlciBkaXN0aW5jdCBtdXRhdGlvbnMgcmV0YWluIHRoZSBlc3RhYmxpc2hlZCBzdWNjZXNzZnVsIHN0YWxlLXNraXAgcmVzcG9uc2UuXG4gICAqIEBwYXJhbSB7e2V4aXN0aW5nU3luYzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIG11dGF0aW9uOiBpbXBvcnQoXCIuL3N5bmMtZW52ZWxvcGUtcmVwbGF5LXNlcnZpY2UuanNcIikuU3luY1JlcGxheU11dGF0aW9ufX0gYXJncyAtIEV4aXN0aW5nIHJvdyBhbmQgaW5jb21pbmcgbXV0YXRpb24uXG4gICAqIEByZXR1cm5zIHtib29sZWFufSBXaGV0aGVyIHRoaXMgaXMgYSBkdXBsaWNhdGUgcmVwbGF5LlxuICAgKi9cbiAgaXNEdXBsaWNhdGVSZXBsYXlNdXRhdGlvbih7ZXhpc3RpbmdTeW5jLCBtdXRhdGlvbn0pIHtcbiAgICBpZiAoIWV4aXN0aW5nU3luYykgcmV0dXJuIGZhbHNlXG5cbiAgICBjb25zdCBtZXRhZGF0YSA9IHRoaXMucmVwbGF5UGVyc2lzdGVkTWV0YWRhdGEoZXhpc3RpbmdTeW5jKVxuXG4gICAgaWYgKG1ldGFkYXRhKSB7XG4gICAgICByZXR1cm4gbWV0YWRhdGEuY2xpZW50TXV0YXRpb25JZCA9PT0gU3RyaW5nKG11dGF0aW9uLmNsaWVudE11dGF0aW9uSWQgfHwgbXV0YXRpb24uaWQpXG4gICAgICAgICYmIG1ldGFkYXRhLnBheWxvYWRGaW5nZXJwcmludCA9PT0gc2hhMjU2SGV4KG11dGF0aW9uLnNlcmlhbGl6ZWREYXRhKVxuICAgIH1cblxuICAgIGNvbnN0IGV4aXN0aW5nQ2xpZW50VXBkYXRlZEF0ID0gdGhpcy5leGlzdGluZ1JlcGxheVN5bmNDbGllbnRVcGRhdGVkQXQoZXhpc3RpbmdTeW5jKVxuICAgIGNvbnN0IGV4aXN0aW5nRGF0YSA9IHRoaXMucmVwbGF5U3luY1JlY29yZFZhbHVlKGV4aXN0aW5nU3luYywgXCJkYXRhXCIpXG4gICAgY29uc3QgZXhpc3RpbmdTeW5jVHlwZSA9IHRoaXMucmVwbGF5U3luY1JlY29yZFZhbHVlKGV4aXN0aW5nU3luYywgXCJzeW5jVHlwZVwiKVxuICAgIGNvbnN0IHNlcmlhbGl6ZWRFeGlzdGluZ0RhdGEgPSB0eXBlb2YgZXhpc3RpbmdEYXRhID09PSBcInN0cmluZ1wiID8gZXhpc3RpbmdEYXRhIDogSlNPTi5zdHJpbmdpZnkoZXhpc3RpbmdEYXRhKVxuXG4gICAgcmV0dXJuIGV4aXN0aW5nQ2xpZW50VXBkYXRlZEF0Py5nZXRUaW1lKCkgPT09IG11dGF0aW9uLmNsaWVudFVwZGF0ZWRBdC5nZXRUaW1lKClcbiAgICAgICYmIHNlcmlhbGl6ZWRFeGlzdGluZ0RhdGEgPT09IG11dGF0aW9uLnNlcmlhbGl6ZWREYXRhXG4gICAgICAmJiBleGlzdGluZ1N5bmNUeXBlID09PSBtdXRhdGlvbi5zeW5jVHlwZVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWRzIGEgbW9kZWwtYmFja2VkIHN5bmMtcm93IHZhbHVlIHRocm91Z2ggaXRzIGFjY2Vzc29yIG9yIHBsYWluIHByb3BlcnR5LlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBzeW5jUmVjb3JkIC0gRXhpc3Rpbmcgc3luYyByb3cuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRyaWJ1dGVOYW1lIC0gQXR0cmlidXRlIG5hbWUuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gU3RvcmVkIHZhbHVlLlxuICAgKi9cbiAgcmVwbGF5U3luY1JlY29yZFZhbHVlKHN5bmNSZWNvcmQsIGF0dHJpYnV0ZU5hbWUpIHtcbiAgICBjb25zdCByZWNvcmQgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHN5bmNSZWNvcmQpXG4gICAgY29uc3QgdmFsdWUgPSByZWNvcmRbYXR0cmlidXRlTmFtZV1cblxuICAgIHJldHVybiB0eXBlb2YgdmFsdWUgPT09IFwiZnVuY3Rpb25cIiA/IHZhbHVlLmNhbGwoc3luY1JlY29yZCkgOiB2YWx1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWRzIGR1cmFibGUgcmVwbGF5IGFja25vd2xlZGdlbWVudCBtZXRhZGF0YSBmcm9tIGEgbW9kZWwtYmFja2VkIHN5bmMgcm93LlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBzeW5jUmVjb3JkIC0gRXhpc3Rpbmcgc3luYyByb3cuXG4gICAqIEByZXR1cm5zIHt7YWNrbm93bGVkZ2VtZW50VmVyc2lvbjogc3RyaW5nIHwgbnVtYmVyIHwgbnVsbCwgY2xpZW50TXV0YXRpb25JZDogc3RyaW5nLCBwYXlsb2FkRmluZ2VycHJpbnQ6IHN0cmluZ30gfCBudWxsfSBQZXJzaXN0ZWQgbWV0YWRhdGEuXG4gICAqL1xuICByZXBsYXlQZXJzaXN0ZWRNZXRhZGF0YShzeW5jUmVjb3JkKSB7XG4gICAgaWYgKCFzeW5jUmVjb3JkKSByZXR1cm4gbnVsbFxuXG4gICAgcmV0dXJuIGRlY29kZVJlcGxheVBlcnNpc3RlZERhdGEodGhpcy5yZXBsYXlTeW5jUmVjb3JkVmFsdWUoc3luY1JlY29yZCwgXCJkYXRhXCIpKS5tZXRhZGF0YVxuICB9XG5cbiAgLyoqXG4gICAqIEFwcGxpZXMgb25lIG5vcm1hbGl6ZWQgbXV0YXRpb24gdG8gZG9tYWluIG1vZGVscy5cbiAgICpcbiAgICogRGlzcGF0Y2hlcyB0aHJvdWdoIHRoZSBjb25maWd1cmVkIGFwcGx5LWhhbmRsZXIgcmVnaXN0cnkgZmlyc3QgKGNvbXBhdFxuICAgKiBwcmVjZWRlbmNlKTsgbXV0YXRpb25zIHdpdGhvdXQgYSBtYXRjaGluZyBoYW5kbGVyIGZhbGwgdGhyb3VnaCB0b1xuICAgKiByZXNvdXJjZSByb3V0aW5nIHdoZW4gYSBjb25maWd1cmF0aW9uIG9yIHJlc291cmNlVHlwZU92ZXJyaWRlcyBhcmVcbiAgICogY29uZmlndXJlZCwgYW5kIG90aGVyd2lzZSBmYWlsIGxvdWRseS5cbiAgICogQHBhcmFtIHt7YWN0b3I6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBjb250ZXh0OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIGV4aXN0aW5nU3luYzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIG11dGF0aW9uOiBpbXBvcnQoXCIuL3N5bmMtZW52ZWxvcGUtcmVwbGF5LXNlcnZpY2UuanNcIikuU3luY1JlcGxheU11dGF0aW9ufX0gYXJncyAtIEFjdG9yLCBiYXRjaCBjb250ZXh0LCBleGlzdGluZyBzeW5jIHJvdywgYW5kIG11dGF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IFByb2plY3Qtc3BlY2lmaWMgYXBwbHkgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgYXBwbHlSZXBsYXlNdXRhdGlvbihhcmdzKSB7XG4gICAgaWYgKHRoaXMuYXBwbHlIYW5kbGVycykge1xuICAgICAgY29uc3QgYXBwbHlIYW5kbGVyID0gdGhpcy5hcHBseUhhbmRsZXJzW2FyZ3MubXV0YXRpb24ucmVzb3VyY2VUeXBlXVxuXG4gICAgICBpZiAoYXBwbHlIYW5kbGVyKSByZXR1cm4gYXdhaXQgYXBwbHlIYW5kbGVyKGFyZ3MpXG4gICAgICBpZiAoIXRoaXMucm91dGluZ0NvbmZpZ3VyZWQoKSkgdGhyb3cgbmV3IEVycm9yKGBObyBzeW5jIGFwcGx5IGhhbmRsZXIgcmVnaXN0ZXJlZCBmb3I6ICR7YXJncy5tdXRhdGlvbi5yZXNvdXJjZVR5cGV9YClcbiAgICB9XG5cbiAgICBpZiAodGhpcy5yb3V0aW5nQ29uZmlndXJlZCgpKSByZXR1cm4gYXdhaXQgdGhpcy5hcHBseVJvdXRlZFJlcGxheU11dGF0aW9uKGFyZ3MpXG5cbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgd2hldGhlciByZXNvdXJjZSByb3V0aW5nIGlzIGNvbmZpZ3VyZWQgb24gdGhpcyBzZXJ2aWNlLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gV2hldGhlciBtdXRhdGlvbnMgcm91dGUgdG8gZnJvbnRlbmQtbW9kZWwgcmVzb3VyY2VzLlxuICAgKi9cbiAgcm91dGluZ0NvbmZpZ3VyZWQoKSB7XG4gICAgcmV0dXJuIEJvb2xlYW4odGhpcy5jb25maWd1cmF0aW9uIHx8IHRoaXMucmVzb3VyY2VUeXBlT3ZlcnJpZGVzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSByb3V0ZWQgcmVzb3VyY2UgcmVnaXN0cmF0aW9uIGZvciBhIHJlc291cmNlIHR5cGUsIG1lbW9pemVkXG4gICAqIHBlciByZXBsYXkgc2VydmljZS4gT3ZlcnJpZGVzIHdpbiBvdmVyIHRoZSBjb25maWd1cmF0aW9uIHJlZ2lzdHJ5OyBzdHJpbmdcbiAgICogb3ZlcnJpZGVzIGFyZSBhbGlhc2VzIHJlc29sdmVkIHRocm91Z2ggdGhlIHJlZ2lzdHJ5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVzb3VyY2VUeXBlIC0gTXV0YXRpb24gcmVzb3VyY2UgdHlwZS5cbiAgICogQHJldHVybnMge1N5bmNSZXBsYXlSZXNvdXJjZVJlZ2lzdHJhdGlvbiB8IG51bGx9IFJlc29sdmVkIHJlZ2lzdHJhdGlvbiBvciBudWxsIHdoZW4gdW5yb3V0YWJsZS5cbiAgICovXG4gIHJlcGxheVJlc291cmNlUmVnaXN0cmF0aW9uKHJlc291cmNlVHlwZSkge1xuICAgIGNvbnN0IG1lbW9pemVkUmVnaXN0cmF0aW9uID0gdGhpcy5fcmVwbGF5UmVzb3VyY2VSZWdpc3RyYXRpb25zLmdldChyZXNvdXJjZVR5cGUpXG5cbiAgICBpZiAobWVtb2l6ZWRSZWdpc3RyYXRpb24gIT09IHVuZGVmaW5lZCkgcmV0dXJuIG1lbW9pemVkUmVnaXN0cmF0aW9uXG5cbiAgICBjb25zdCByZWdpc3RyYXRpb24gPSB0aGlzLnJlc29sdmVSZXBsYXlSZXNvdXJjZVJlZ2lzdHJhdGlvbihyZXNvdXJjZVR5cGUpXG5cbiAgICB0aGlzLl9yZXBsYXlSZXNvdXJjZVJlZ2lzdHJhdGlvbnMuc2V0KHJlc291cmNlVHlwZSwgcmVnaXN0cmF0aW9uKVxuXG4gICAgcmV0dXJuIHJlZ2lzdHJhdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIFVuY2FjaGVkIHJvdXRlZC1yZXNvdXJjZSByZXNvbHV0aW9uIGJlaGluZCB7QGxpbmsgU3luY0VudmVsb3BlUmVwbGF5U2VydmljZSNyZXBsYXlSZXNvdXJjZVJlZ2lzdHJhdGlvbn0uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZXNvdXJjZVR5cGUgLSBNdXRhdGlvbiByZXNvdXJjZSB0eXBlLlxuICAgKiBAcmV0dXJucyB7U3luY1JlcGxheVJlc291cmNlUmVnaXN0cmF0aW9uIHwgbnVsbH0gUmVzb2x2ZWQgcmVnaXN0cmF0aW9uIG9yIG51bGwgd2hlbiB1bnJvdXRhYmxlLlxuICAgKi9cbiAgcmVzb2x2ZVJlcGxheVJlc291cmNlUmVnaXN0cmF0aW9uKHJlc291cmNlVHlwZSkge1xuICAgIGNvbnN0IG92ZXJyaWRlID0gdGhpcy5yZXNvdXJjZVR5cGVPdmVycmlkZXM/LltyZXNvdXJjZVR5cGVdXG5cbiAgICBpZiAob3ZlcnJpZGUgJiYgdHlwZW9mIG92ZXJyaWRlICE9PSBcInN0cmluZ1wiKSB7XG4gICAgICByZXR1cm4ge21vZGVsTmFtZTogcmVzb3VyY2VUeXBlLCByZXNvdXJjZUNsYXNzOiBvdmVycmlkZSwgcmVzb3VyY2VDb25maWd1cmF0aW9uOiBudWxsfVxuICAgIH1cblxuICAgIGNvbnN0IHJlZ2lzdHJ5UmVzb3VyY2VUeXBlID0gdHlwZW9mIG92ZXJyaWRlID09PSBcInN0cmluZ1wiID8gb3ZlcnJpZGUgOiByZXNvdXJjZVR5cGVcblxuICAgIGlmICghdGhpcy5jb25maWd1cmF0aW9uKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgcmVzb2x2ZWRSZWdpc3RyYXRpb24gPSByZXNvbHZlRnJvbnRlbmRNb2RlbFJlc291cmNlQ2xhc3Moe2NvbmZpZ3VyYXRpb246IHRoaXMuY29uZmlndXJhdGlvbiwgcmVzb3VyY2VUeXBlOiByZWdpc3RyeVJlc291cmNlVHlwZX0pXG5cbiAgICBpZiAoIXJlc29sdmVkUmVnaXN0cmF0aW9uKSByZXR1cm4gbnVsbFxuXG4gICAgcmV0dXJuIHtcbiAgICAgIG1vZGVsTmFtZTogcmVzb2x2ZWRSZWdpc3RyYXRpb24ubW9kZWxOYW1lLFxuICAgICAgcmVzb3VyY2VDbGFzczogcmVzb2x2ZWRSZWdpc3RyYXRpb24ucmVzb3VyY2VDbGFzcyxcbiAgICAgIHJlc291cmNlQ29uZmlndXJhdGlvbjogcmVzb2x2ZWRSZWdpc3RyYXRpb24ucmVzb3VyY2VDb25maWd1cmF0aW9uXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBhYmlsaXR5IGFuZCByZXNvdXJjZSBjb250ZXh0IHVzZWQgdG8gYXV0aG9yaXplIHJvdXRlZFxuICAgKiByZXNvdXJjZXMuIERlZmF1bHRzIHRvIHRoZSBjb25zdHJ1Y3Rvci13aWRlIGFiaWxpdHkvYWJpbGl0eUNvbnRleHQ7XG4gICAqIHN1YmNsYXNzZXMgKHNpZ25lZCByZXBsYXkpIG92ZXJyaWRlIHRoaXMgdG8gZGVyaXZlIGF1dGhvcml6YXRpb24gZnJvbSBhXG4gICAqIHZlcmlmaWVkIGFjdG9yL2dyYW50IGluc3RlYWQgb2YgdXBsb2FkZXItZ2xvYmFsIHN0YXRlLlxuICAgKiBAcGFyYW0ge3thY3RvcjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGNvbnRleHQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn19IF9hcmdzIC0gUmVwbGF5IGFjdG9yIGFuZCBiYXRjaCBjb250ZXh0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7YWJpbGl0eTogaW1wb3J0KFwiLi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWQsIGFiaWxpdHlDb250ZXh0OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59Pn0gQWJpbGl0eSBhbmQgcmVzb3VyY2UgY29udGV4dC5cbiAgICovXG4gIGFzeW5jIHJlcGxheUFiaWxpdHlGb3IoX2FyZ3MpIHtcbiAgICByZXR1cm4ge2FiaWxpdHk6IHRoaXMuYWJpbGl0eSB8fCB1bmRlZmluZWQsIGFiaWxpdHlDb250ZXh0OiB0aGlzLmFiaWxpdHlDb250ZXh0IHx8IHt9fVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyB0aGUgcm91dGVkIHJlc291cmNlIGluc3RhbmNlIGhhbmRsaW5nIG9uZSBtdXRhdGlvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLmFjdG9yIC0gUmVwbGF5IGFjdG9yLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5jb250ZXh0IC0gUmVwbGF5IGNvbnRleHQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9zeW5jLWVudmVsb3BlLXJlcGxheS1zZXJ2aWNlLmpzXCIpLlN5bmNSZXBsYXlNdXRhdGlvbn0gYXJncy5tdXRhdGlvbiAtIE5vcm1hbGl6ZWQgcmVwbGF5IG11dGF0aW9uLlxuICAgKiBAcGFyYW0ge1N5bmNSZXBsYXlSZXNvdXJjZVJlZ2lzdHJhdGlvbn0gYXJncy5yZWdpc3RyYXRpb24gLSBSZXNvbHZlZCByZXNvdXJjZSByZWdpc3RyYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVsLXJlc291cmNlL2Jhc2UtcmVzb3VyY2UuanNcIikuZGVmYXVsdD59IFJvdXRlZCByZXNvdXJjZSBpbnN0YW5jZS5cbiAgICovXG4gIGFzeW5jIGJ1aWxkUmVwbGF5UmVzb3VyY2Uoe2FjdG9yLCBjb250ZXh0LCBtdXRhdGlvbiwgcmVnaXN0cmF0aW9ufSkge1xuICAgIGNvbnN0IFJlc291cmNlQ2xhc3MgPSByZWdpc3RyYXRpb24ucmVzb3VyY2VDbGFzc1xuICAgIGNvbnN0IHthYmlsaXR5LCBhYmlsaXR5Q29udGV4dH0gPSBhd2FpdCB0aGlzLnJlcGxheUFiaWxpdHlGb3Ioe2FjdG9yLCBjb250ZXh0fSlcblxuICAgIHJldHVybiBuZXcgUmVzb3VyY2VDbGFzcyh7XG4gICAgICBhYmlsaXR5LFxuICAgICAgY29udGV4dDogYWJpbGl0eUNvbnRleHQsXG4gICAgICBsb2NhbHM6IHsuLi4odGhpcy5sb2NhbHMgfHwge30pLCAuLi4odGhpcy5jb25maWd1cmF0aW9uID8ge2NvbmZpZ3VyYXRpb246IHRoaXMuY29uZmlndXJhdGlvbn0gOiB7fSl9LFxuICAgICAgbW9kZWxOYW1lOiByZWdpc3RyYXRpb24ubW9kZWxOYW1lLFxuICAgICAgcGFyYW1zOiBtdXRhdGlvbi5kYXRhLFxuICAgICAgLi4uKHJlZ2lzdHJhdGlvbi5yZXNvdXJjZUNvbmZpZ3VyYXRpb24gPyB7cmVzb3VyY2VDb25maWd1cmF0aW9uOiByZWdpc3RyYXRpb24ucmVzb3VyY2VDb25maWd1cmF0aW9ufSA6IHt9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQXBwbGllcyBvbmUgbXV0YXRpb24gdGhyb3VnaCBpdHMgcm91dGVkIGZyb250ZW5kLW1vZGVsIHJlc291cmNlOlxuICAgKiBhdXRob3JpemF0aW9uLCBhYmlsaXR5LXNjb3BlZCByZWNvcmQgbG9va3VwLCBzY2hlbWEgbm9ybWFsaXphdGlvbiBhbmRcbiAgICogYXNzaWduL3NhdmUgZm9yIHVwZGF0ZXMsIHNhdmUtdGhlbi1jaGVjayBtZW1iZXJzaGlwIGNyZWF0ZXMsIGRlc3Ryb3lzIGZvclxuICAgKiBkZWxldGVzLCBhbmQgdGhlIHJlc291cmNlJ3MgYWZ0ZXJTeW5jQXBwbHkgdGFpbC4gQ2xpZW50LXNhZmUgZmFpbHVyZXNcbiAgICogdGhyb3cgc2FmZSBlcnJvcnMgdGhhdCBmYWlsIHRoZSBzaW5nbGUgc3luYy5cbiAgICogQHBhcmFtIHt7YWN0b3I6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBjb250ZXh0OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIGV4aXN0aW5nU3luYzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIG11dGF0aW9uOiBpbXBvcnQoXCIuL3N5bmMtZW52ZWxvcGUtcmVwbGF5LXNlcnZpY2UuanNcIikuU3luY1JlcGxheU11dGF0aW9ufX0gYXJncyAtIEFjdG9yLCBiYXRjaCBjb250ZXh0LCBleGlzdGluZyBzeW5jIHJvdywgYW5kIG11dGF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSBBcHBseSByZXN1bHQgd2l0aCByZWNvcmQsIGNyZWF0ZWQvZGVsZXRlZCBmbGFncywgYW5kIGFmdGVyU3luY0FwcGx5IGV4dHJhcy5cbiAgICovXG4gIGFzeW5jIGFwcGx5Um91dGVkUmVwbGF5TXV0YXRpb24oe2FjdG9yLCBjb250ZXh0LCBleGlzdGluZ1N5bmMsIG11dGF0aW9ufSkge1xuICAgIGNvbnN0IHJlZ2lzdHJhdGlvbiA9IHRoaXMucmVwbGF5UmVzb3VyY2VSZWdpc3RyYXRpb24obXV0YXRpb24ucmVzb3VyY2VUeXBlKVxuXG4gICAgaWYgKCFyZWdpc3RyYXRpb24pIHtcbiAgICAgIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoYFVua25vd24gc3luYyByZXNvdXJjZSB0eXBlOiAke211dGF0aW9uLnJlc291cmNlVHlwZX0uYCwge2NvZGU6IFwidW5rbm93bi1yZXNvdXJjZS10eXBlXCJ9KVxuICAgIH1cblxuICAgIGNvbnN0IHJlc291cmNlID0gYXdhaXQgdGhpcy5idWlsZFJlcGxheVJlc291cmNlKHthY3RvciwgY29udGV4dCwgbXV0YXRpb24sIHJlZ2lzdHJhdGlvbn0pXG4gICAgY29uc3QgY3VzdG9tQXBwbHlSZXN1bHQgPSBhd2FpdCByZXNvdXJjZS5hcHBseVN5bmMoe2NvbnRleHQsIGV4aXN0aW5nU3luYywgbXV0YXRpb259KVxuXG4gICAgaWYgKGN1c3RvbUFwcGx5UmVzdWx0ICE9PSBudWxsKSByZXR1cm4gY3VzdG9tQXBwbHlSZXN1bHRcblxuICAgIGNvbnN0IGF1dGhvcml6YXRpb24gPSBhd2FpdCByZXNvdXJjZS5hdXRob3JpemVTeW5jTXV0YXRpb24oe2NvbnRleHQsIG11dGF0aW9ufSlcblxuICAgIGlmICghYXV0aG9yaXphdGlvbi5hbGxvd2VkKSB7XG4gICAgICB0aHJvdyBWZWxvY2lvdXNFcnJvci5zYWZlKGBTeW5jIG11dGF0aW9uIGRlbmllZCBmb3I6ICR7bXV0YXRpb24ucmVzb3VyY2VUeXBlfS5gLCB7Y29kZTogYXV0aG9yaXphdGlvbi5yZWFzb24gfHwgXCJhY2Nlc3MtZGVuaWVkXCJ9KVxuICAgIH1cblxuICAgIGlmIChtdXRhdGlvbi5zeW5jVHlwZSA9PT0gXCJkZWxldGVcIikgcmV0dXJuIGF3YWl0IHRoaXMuYXBwbHlSb3V0ZWRSZXBsYXlEZWxldGUoe211dGF0aW9uLCByZXNvdXJjZX0pXG5cbiAgICBjb25zdCBjb21tYW5kQXBwbHlSZXN1bHQgPSBhd2FpdCB0aGlzLmFwcGx5Um91dGVkUmVwbGF5Q29tbWFuZCh7Y29udGV4dCwgbXV0YXRpb24sIHJlc291cmNlfSlcblxuICAgIGlmIChjb21tYW5kQXBwbHlSZXN1bHQgIT09IG51bGwpIHJldHVybiBjb21tYW5kQXBwbHlSZXN1bHRcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLmFwcGx5Um91dGVkUmVwbGF5VXBzZXJ0KHtjb250ZXh0LCBtdXRhdGlvbiwgcmVzb3VyY2V9KVxuICB9XG5cbiAgLyoqXG4gICAqIERpc3BhdGNoZXMgYSByb3V0ZWQgc3luYyBtdXRhdGlvbiB3aG9zZSBzeW5jVHlwZSBtYXRjaGVzIGEgcmVzb3VyY2UtZGVjbGFyZWRcbiAgICogY3VzdG9tIGNvbW1hbmQuIFJldHVybnMgbnVsbCB3aGVuIHRoZSBtdXRhdGlvbiBpcyBub3QgYSBjb21tYW5kIHNvIHRoZVxuICAgKiBjYWxsZXIgY2FuIGZhbGwgdGhyb3VnaCB0byB0aGUgZGVmYXVsdCB1cHNlcnQgcGF0aC5cbiAgICogQHBhcmFtIHt7Y29udGV4dDogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBtdXRhdGlvbjogaW1wb3J0KFwiLi9zeW5jLWVudmVsb3BlLXJlcGxheS1zZXJ2aWNlLmpzXCIpLlN5bmNSZXBsYXlNdXRhdGlvbiwgcmVzb3VyY2U6IGltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVsLXJlc291cmNlL2Jhc2UtcmVzb3VyY2UuanNcIikuZGVmYXVsdH19IGFyZ3MgLSBDb21tYW5kIGRpc3BhdGNoIGFyZ3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IG51bGw+fSBDb21tYW5kIGFwcGx5IHJlc3VsdCBvciBudWxsLlxuICAgKi9cbiAgYXN5bmMgYXBwbHlSb3V0ZWRSZXBsYXlDb21tYW5kKHtjb250ZXh0LCBtdXRhdGlvbiwgcmVzb3VyY2V9KSB7XG4gICAgY29uc3QgY29tbWFuZENvbmZpZyA9IHRoaXMucmVzb3VyY2VDb21tYW5kQ29uZmlnKHJlc291cmNlKVxuICAgIGNvbnN0IGNvbW1hbmRNZXRob2ROYW1lID0gdGhpcy5jb21tYW5kTWV0aG9kTmFtZUZvclN5bmNUeXBlKHtjb21tYW5kQ29uZmlnLCBzeW5jVHlwZTogbXV0YXRpb24uc3luY1R5cGV9KVxuXG4gICAgaWYgKCFjb21tYW5kTWV0aG9kTmFtZSkgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IGNvbW1hbmRNZXRob2QgPSByZXNvdXJjZS5yZXNvdXJjZU1ldGhvZChjb21tYW5kTWV0aG9kTmFtZSlcblxuICAgIGlmICghY29tbWFuZE1ldGhvZCkge1xuICAgICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShgU3luYyBjb21tYW5kIGhhbmRsZXIgbWlzc2luZyBmb3I6ICR7bXV0YXRpb24ucmVzb3VyY2VUeXBlfS4ke211dGF0aW9uLnN5bmNUeXBlfS5gLCB7Y29kZTogXCJzeW5jLWNvbW1hbmQtaGFuZGxlci1taXNzaW5nXCJ9KVxuICAgIH1cblxuICAgIGNvbnN0IGFyZ3MgPSB0aGlzLmNvbW1hbmRBcmdzRm9yTXV0YXRpb24oe2NvbW1hbmRDb25maWcsIGNvbW1hbmRNZXRob2ROYW1lLCBtdXRhdGlvbn0pXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgY29tbWFuZE1ldGhvZC5tZXRob2QuY2FsbChjb21tYW5kTWV0aG9kLnJlc291cmNlLCBhcmdzKVxuXG4gICAgY29uc3QgYWZ0ZXJFeHRyYXMgPSBhd2FpdCByZXNvdXJjZS5hZnRlclN5bmNBcHBseSh7Y29udGV4dCwgY3JlYXRlZDogZmFsc2UsIG11dGF0aW9uLCByZWNvcmQ6IG51bGx9KVxuICAgIGNvbnN0IHJlc3VsdE9iamVjdCA9IHJlc3VsdCAmJiB0eXBlb2YgcmVzdWx0ID09PSBcIm9iamVjdFwiICYmICFBcnJheS5pc0FycmF5KHJlc3VsdCkgPyByZXN1bHQgOiB7fVxuXG4gICAgcmV0dXJuIHtjb21tYW5kUmVzdWx0OiByZXN1bHQsIGNyZWF0ZWQ6IGZhbHNlLCBkZWxldGVkOiBmYWxzZSwgcmVjb3JkOiBudWxsLCAuLi5yZXN1bHRPYmplY3QsIC4uLmFmdGVyRXh0cmFzfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBjdXN0b20tY29tbWFuZCBjb25maWd1cmF0aW9uIGRlY2xhcmVkIG9uIGEgcm91dGVkIHJlc291cmNlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVsLXJlc291cmNlL2Jhc2UtcmVzb3VyY2UuanNcIikuZGVmYXVsdH0gcmVzb3VyY2UgLSBSb3V0ZWQgcmVzb3VyY2UgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHt7Y29sbGVjdGlvbkNvbW1hbmRzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+LCBtZW1iZXJDb21tYW5kczogUmVjb3JkPHN0cmluZywgc3RyaW5nPn19IENvbW1hbmQgY29uZmlnLlxuICAgKi9cbiAgcmVzb3VyY2VDb21tYW5kQ29uZmlnKHJlc291cmNlKSB7XG4gICAgY29uc3QgY29uZmlnID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChyZXNvdXJjZS5yZXNvdXJjZUNvbmZpZ3VyYXRpb25WYWx1ZSB8fCB7fSlcblxuICAgIHJldHVybiB7XG4gICAgICBjb2xsZWN0aW9uQ29tbWFuZHM6IGNvbmZpZy5jb2xsZWN0aW9uQ29tbWFuZHMgfHwge30sXG4gICAgICBtZW1iZXJDb21tYW5kczogY29uZmlnLm1lbWJlckNvbW1hbmRzIHx8IHt9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSByZXNvdXJjZSBtZXRob2QgbmFtZSBmb3IgYSBzeW5jVHlwZSB3aGVuIGl0IG5hbWVzIGEgZGVjbGFyZWRcbiAgICogY3VzdG9tIGNvbW1hbmQuXG4gICAqIEBwYXJhbSB7e2NvbW1hbmRDb25maWc6IHtjb2xsZWN0aW9uQ29tbWFuZHM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4sIG1lbWJlckNvbW1hbmRzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+fSwgc3luY1R5cGU6IHN0cmluZ319IGFyZ3MgLSBMb29rdXAgYXJncy5cbiAgICogQHJldHVybnMge3N0cmluZyB8IG51bGx9IE1ldGhvZCBuYW1lIG9yIG51bGwuXG4gICAqL1xuICBjb21tYW5kTWV0aG9kTmFtZUZvclN5bmNUeXBlKHtjb21tYW5kQ29uZmlnLCBzeW5jVHlwZX0pIHtcbiAgICBpZiAoY29tbWFuZENvbmZpZy5tZW1iZXJDb21tYW5kc1tzeW5jVHlwZV0pIHJldHVybiBzeW5jVHlwZVxuICAgIGlmIChjb21tYW5kQ29uZmlnLmNvbGxlY3Rpb25Db21tYW5kc1tzeW5jVHlwZV0pIHJldHVybiBzeW5jVHlwZVxuXG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIGFyZ3VtZW50cyBvYmplY3QgcGFzc2VkIHRvIGEgcmVzb3VyY2UgY29tbWFuZCBtZXRob2QuIE1lbWJlclxuICAgKiBjb21tYW5kcyByZWNlaXZlIHRoZSBlbnZlbG9wZSdzIHJlc291cmNlSWQgYXMgYGlkYDsgdGhlIGVudmVsb3BlIGlkZW50aXR5XG4gICAqIGlzIGFzc2lnbmVkIGFmdGVyIHRoZSBwYXlsb2FkIHNvIGEgcGF5bG9hZCBgaWRgIGNhbiBuZXZlciByZXRhcmdldCB0aGVcbiAgICogY29tbWFuZCBhd2F5IGZyb20gdGhlIHJlc291cmNlIHRoZSBhdXRob3JpemF0aW9uIGhvb2tzIGFwcHJvdmVkLlxuICAgKiBAcGFyYW0ge3tjb21tYW5kQ29uZmlnOiB7Y29sbGVjdGlvbkNvbW1hbmRzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+LCBtZW1iZXJDb21tYW5kczogUmVjb3JkPHN0cmluZywgc3RyaW5nPn0sIGNvbW1hbmRNZXRob2ROYW1lOiBzdHJpbmcsIG11dGF0aW9uOiBpbXBvcnQoXCIuL3N5bmMtZW52ZWxvcGUtcmVwbGF5LXNlcnZpY2UuanNcIikuU3luY1JlcGxheU11dGF0aW9ufX0gYXJncyAtIEFyZ3MgYnVpbGRlciBhcmdzLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBDb21tYW5kIG1ldGhvZCBhcmd1bWVudHMuXG4gICAqL1xuICBjb21tYW5kQXJnc0Zvck11dGF0aW9uKHtjb21tYW5kQ29uZmlnLCBjb21tYW5kTWV0aG9kTmFtZSwgbXV0YXRpb259KSB7XG4gICAgY29uc3QgaXNNZW1iZXIgPSBjb21tYW5kQ29uZmlnLm1lbWJlckNvbW1hbmRzW2NvbW1hbmRNZXRob2ROYW1lXSAhPT0gdW5kZWZpbmVkXG5cbiAgICBpZiAoaXNNZW1iZXIpIHtcbiAgICAgIHJldHVybiB7Li4ubXV0YXRpb24uZGF0YSwgaWQ6IG11dGF0aW9uLnJlc291cmNlSWR9XG4gICAgfVxuXG4gICAgcmV0dXJuIHsuLi5tdXRhdGlvbi5kYXRhfVxuICB9XG5cbiAgLyoqXG4gICAqIEFwcGxpZXMgYSByb3V0ZWQgZGVsZXRlIG11dGF0aW9uLiBUaGUgcmVjb3JkIGlzIG1hcmtlZCBhcyBhIHNlcnZlciBhcHBseVxuICAgKiBmb3IgdGhlIGR1cmF0aW9uIG9mIHRoZSByZXBsYXktb3duZWQgZGVzdHJveSAtIGFuIGFjdGl2ZSBTeW5jUHVibGlzaGVyXG4gICAqIG5ldmVyIHB1Ymxpc2hlcyB0aGUgcmVwbGF5ZWQgZGVsZXRlIGEgc2Vjb25kIHRpbWUgKHRoZSByZXBsYXkgb3ducyBpdHNcbiAgICogb3duIHBlcnNpc3QgYW5kIGJyb2FkY2FzdHMpLCB3aGlsZSBsYXRlciBzZXJ2ZXItc2lkZSB3cml0ZXMgdG8gdGhlIHNhbWVcbiAgICogaW5zdGFuY2UgcHVibGlzaCBub3JtYWxseSBhZ2Fpbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vc3luYy1lbnZlbG9wZS1yZXBsYXktc2VydmljZS5qc1wiKS5TeW5jUmVwbGF5TXV0YXRpb259IGFyZ3MubXV0YXRpb24gLSBOb3JtYWxpemVkIHJlcGxheSBtdXRhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9mcm9udGVuZC1tb2RlbC1yZXNvdXJjZS9iYXNlLXJlc291cmNlLmpzXCIpLmRlZmF1bHR9IGFyZ3MucmVzb3VyY2UgLSBSb3V0ZWQgcmVzb3VyY2UgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IEFwcGx5IHJlc3VsdCB3aXRoIHRoZSBkZWxldGVkIGZsYWcuXG4gICAqL1xuICBhc3luYyBhcHBseVJvdXRlZFJlcGxheURlbGV0ZSh7bXV0YXRpb24sIHJlc291cmNlfSkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSByZXNvdXJjZS5tb2RlbENsYXNzKClcbiAgICBjb25zdCBydW5EZWxldGUgPSBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByZWNvcmQgPSBhd2FpdCByZXNvdXJjZS5maW5kU3luY1JlY29yZCh7Zm9yRGVsZXRlOiB0cnVlLCBtdXRhdGlvbn0pXG5cbiAgICAgIGlmICghcmVjb3JkKSByZXR1cm4ge2NyZWF0ZWQ6IGZhbHNlLCBkZWxldGVkOiBmYWxzZSwgcmVjb3JkOiBudWxsfVxuXG4gICAgICBjb25zdCBjb25mbGljdFJlc3VsdCA9IGF3YWl0IHRoaXMucm91dGVkUmVwbGF5Q29uZmxpY3RSZXN1bHQoe2F0dHJpYnV0ZXM6IHt9LCBleGlzdGluZ1JlY29yZDogcmVjb3JkLCBtdXRhdGlvbiwgcmVzb3VyY2V9KVxuXG4gICAgICBpZiAoY29uZmxpY3RSZXN1bHQpIHJldHVybiBjb25mbGljdFJlc3VsdFxuXG4gICAgICBjb25zdCByZWxlYXNlU2VydmVyQXBwbHkgPSBtYXJrU2VydmVyQXBwbHkocmVjb3JkKVxuXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCByZWNvcmQuZGVzdHJveSgpXG4gICAgICB9IGZpbmFsbHkge1xuICAgICAgICByZWxlYXNlU2VydmVyQXBwbHkoKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4ge2NyZWF0ZWQ6IGZhbHNlLCBkZWxldGVkOiB0cnVlLCByZWNvcmR9XG4gICAgfVxuXG4gICAgaWYgKCF0aGlzLmNvbmZsaWN0U3RyYXRlZ3kpIHJldHVybiBhd2FpdCBydW5EZWxldGUoKVxuXG4gICAgcmV0dXJuIGF3YWl0IE1vZGVsQ2xhc3Mud2l0aEFkdmlzb3J5TG9jayhzeW5jUmVwbGF5Q29uZmxpY3RMb2NrTmFtZSh7cmVzb3VyY2VJZDogbXV0YXRpb24ucmVzb3VyY2VJZCwgcmVzb3VyY2VUeXBlOiBtdXRhdGlvbi5yZXNvdXJjZVR5cGV9KSwgcnVuRGVsZXRlLCB7ZGVkaWNhdGVkQ29ubmVjdGlvbjogdHJ1ZX0pXG4gIH1cblxuICAvKipcbiAgICogQXBwbGllcyBhIHJvdXRlZCB1cHNlcnQgbXV0YXRpb246IHBlcm1pdHRlZCBwYXlsb2FkIGF0dHJpYnV0ZXMgYXJlXG4gICAqIGFzc2lnbmVkIGFuZCBzYXZlZCBvbnRvIHRoZSBmb3VuZCByZWNvcmQgKHRoZSByZWNvcmQgbGF5ZXIgb3ducyB2YWx1ZVxuICAgKiBjYXN0aW5nIGFuZCB2YWxpZGF0aW9uKSwgYW5kIG1pc3NpbmcgcmVjb3JkcyBhcmUgY3JlYXRlZCB3aXRoIHRoZVxuICAgKiBjbGllbnQtZ2VuZXJhdGVkIHByaW1hcnkga2V5IHBsdXMgYSBzYXZlLXRoZW4tY2hlY2sgbWVtYmVyc2hpcCBjaGVjay5cbiAgICogV3JpdHRlbiByZWNvcmRzIGFyZSBtYXJrZWQgYXMgc2VydmVyIGFwcGxpZXMgZm9yIHRoZSBkdXJhdGlvbiBvZiB0aGVcbiAgICogcmVwbGF5LW93bmVkIHdyaXRlIC0gYW4gYWN0aXZlIFN5bmNQdWJsaXNoZXIgbmV2ZXIgcHVibGlzaGVzIHRoZSByZXBsYXllZFxuICAgKiBtdXRhdGlvbiBhIHNlY29uZCB0aW1lICh0aGUgcmVwbGF5IG93bnMgaXRzIG93biBwZXJzaXN0IGFuZCBicm9hZGNhc3RzKSxcbiAgICogd2hpbGUgbGF0ZXIgc2VydmVyLXNpZGUgd3JpdGVzIHRvIHRoZSBzYW1lIGluc3RhbmNlIHB1Ymxpc2ggbm9ybWFsbHlcbiAgICogYWdhaW4uIE1vZGVsIHZhbGlkYXRpb24gZmFpbHVyZXMgYmVjb21lIGNsaWVudC1zYWZlIHBlci1zeW5jIGZhaWx1cmVzXG4gICAqIGNhcnJ5aW5nIHRoZSB0cmFuc2xhdGVkIHZhbGlkYXRpb24gbWVzc2FnZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5jb250ZXh0IC0gUmVwbGF5IGNvbnRleHQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9zeW5jLWVudmVsb3BlLXJlcGxheS1zZXJ2aWNlLmpzXCIpLlN5bmNSZXBsYXlNdXRhdGlvbn0gYXJncy5tdXRhdGlvbiAtIE5vcm1hbGl6ZWQgcmVwbGF5IG11dGF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVsLXJlc291cmNlL2Jhc2UtcmVzb3VyY2UuanNcIikuZGVmYXVsdH0gYXJncy5yZXNvdXJjZSAtIFJvdXRlZCByZXNvdXJjZSBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gQXBwbHkgcmVzdWx0IHdpdGggcmVjb3JkLCBjcmVhdGVkIGZsYWcsIGFuZCBhZnRlclN5bmNBcHBseSBleHRyYXMuXG4gICAqL1xuICBhc3luYyBhcHBseVJvdXRlZFJlcGxheVVwc2VydCh7Y29udGV4dCwgbXV0YXRpb24sIHJlc291cmNlfSkge1xuICAgIGNvbnN0IGF0dHJpYnV0ZXMgPSB0aGlzLnBlcm1pdHRlZFJvdXRlZEF0dHJpYnV0ZXMoe211dGF0aW9uLCByZXNvdXJjZX0pXG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IHJlc291cmNlLm1vZGVsQ2xhc3MoKVxuICAgIGNvbnN0IHJ1blVwc2VydCA9IGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGV4aXN0aW5nUmVjb3JkID0gYXdhaXQgcmVzb3VyY2UuZmluZFN5bmNSZWNvcmQoe211dGF0aW9ufSlcbiAgICAgIGNvbnN0IGNvbmZsaWN0UmVzdWx0ID0gYXdhaXQgdGhpcy5yb3V0ZWRSZXBsYXlDb25mbGljdFJlc3VsdCh7YXR0cmlidXRlcywgZXhpc3RpbmdSZWNvcmQsIG11dGF0aW9uLCByZXNvdXJjZX0pXG5cbiAgICAgIGlmIChjb25mbGljdFJlc3VsdCkgcmV0dXJuIGNvbmZsaWN0UmVzdWx0XG5cbiAgICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQgfCBudWxsfSAqL1xuICAgICAgbGV0IHJlY29yZCA9IGV4aXN0aW5nUmVjb3JkXG4gICAgICBsZXQgY3JlYXRlZCA9IGZhbHNlXG5cbiAgICAgIGlmIChleGlzdGluZ1JlY29yZCkge1xuICAgICAgICBjb25zdCByZWxlYXNlU2VydmVyQXBwbHkgPSBtYXJrU2VydmVyQXBwbHkoZXhpc3RpbmdSZWNvcmQpXG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBleGlzdGluZ1JlY29yZC5hc3NpZ24oYXR0cmlidXRlcylcbiAgICAgICAgICBhd2FpdCB0aGlzLnNhdmVSb3V0ZWRSZXBsYXlSZWNvcmQoZXhpc3RpbmdSZWNvcmQpXG4gICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgcmVsZWFzZVNlcnZlckFwcGx5KClcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmVjb3JkID0gYXdhaXQgdGhpcy5jcmVhdGVSb3V0ZWRSZXBsYXlSZWNvcmQoe2F0dHJpYnV0ZXMsIG11dGF0aW9uLCByZXNvdXJjZX0pXG4gICAgICAgIGNyZWF0ZWQgPSB0cnVlXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGV4dHJhcyA9IGF3YWl0IHJlc291cmNlLmFmdGVyU3luY0FwcGx5KHtjb250ZXh0LCBjcmVhdGVkLCBtdXRhdGlvbiwgcmVjb3JkfSlcblxuICAgICAgcmV0dXJuIHtjcmVhdGVkLCBkZWxldGVkOiBmYWxzZSwgcmVjb3JkLCAuLi5leHRyYXN9XG4gICAgfVxuXG4gICAgaWYgKCF0aGlzLmNvbmZsaWN0U3RyYXRlZ3kpIHJldHVybiBhd2FpdCBydW5VcHNlcnQoKVxuXG4gICAgcmV0dXJuIGF3YWl0IE1vZGVsQ2xhc3Mud2l0aEFkdmlzb3J5TG9jayhzeW5jUmVwbGF5Q29uZmxpY3RMb2NrTmFtZSh7cmVzb3VyY2VJZDogbXV0YXRpb24ucmVzb3VyY2VJZCwgcmVzb3VyY2VUeXBlOiBtdXRhdGlvbi5yZXNvdXJjZVR5cGV9KSwgcnVuVXBzZXJ0LCB7ZGVkaWNhdGVkQ29ubmVjdGlvbjogdHJ1ZX0pXG4gIH1cblxuICAvKipcbiAgICogQ2hlY2tzIHdoZXRoZXIgYSByb3V0ZWQgdXBzZXJ0IG11dGF0aW9uIGNvbmZsaWN0cyB3aXRoIHRoZSBjdXJyZW50IHNlcnZlclxuICAgKiBzdGF0ZSB3aGVuIHRoZSBzZXJ2aWNlIGlzIGNvbmZpZ3VyZWQgd2l0aCBhIGNvbmZsaWN0IHN0cmF0ZWd5LiBBIG11dGF0aW9uXG4gICAqIHdob3NlIGJhc2VWZXJzaW9uIGRvZXMgbm90IG1hdGNoIHRoZSBzZXJ2ZXIncyBjdXJyZW50IHZlcnNpb25BdHRyaWJ1dGUgaXNcbiAgICogcmVqZWN0ZWQgd2l0aCBhIHN0cnVjdHVyZWQgY29uZmxpY3QgcGF5bG9hZCBpbnN0ZWFkIG9mIGJlaW5nIGFwcGxpZWQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQ29uZmxpY3QtY2hlY2sgYXJncy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuYXR0cmlidXRlcyAtIFBlcm1pdHRlZCBtdXRhdGlvbiBhdHRyaWJ1dGVzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0IHwgbnVsbH0gYXJncy5leGlzdGluZ1JlY29yZCAtIEV4aXN0aW5nIHNlcnZlciByZWNvcmQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9zeW5jLWVudmVsb3BlLXJlcGxheS1zZXJ2aWNlLmpzXCIpLlN5bmNSZXBsYXlNdXRhdGlvbn0gYXJncy5tdXRhdGlvbiAtIE5vcm1hbGl6ZWQgcmVwbGF5IG11dGF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVsLXJlc291cmNlL2Jhc2UtcmVzb3VyY2UuanNcIikuZGVmYXVsdH0gYXJncy5yZXNvdXJjZSAtIFJvdXRlZCByZXNvdXJjZSBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgbnVsbD59IC0gQ29uZmxpY3QgYXBwbHkgcmVzdWx0LCBvciBudWxsIHdoZW4gbm8gY29uZmxpY3QuXG4gICAqL1xuICBhc3luYyByb3V0ZWRSZXBsYXlDb25mbGljdFJlc3VsdCh7YXR0cmlidXRlcywgZXhpc3RpbmdSZWNvcmQsIG11dGF0aW9uLCByZXNvdXJjZX0pIHtcbiAgICBpZiAoIXRoaXMuY29uZmxpY3RTdHJhdGVneSkgcmV0dXJuIG51bGxcbiAgICBpZiAoIWV4aXN0aW5nUmVjb3JkIHx8IG11dGF0aW9uLnN5bmNUeXBlID09PSBcImNyZWF0ZVwiKSByZXR1cm4gbnVsbFxuICAgIGlmIChtdXRhdGlvbi5iYXNlVmVyc2lvbiA9PT0gdW5kZWZpbmVkIHx8IG11dGF0aW9uLmJhc2VWZXJzaW9uID09PSBudWxsKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IHJlc291cmNlLm1vZGVsQ2xhc3MoKVxuICAgIGNvbnN0IHByaW1hcnlLZXkgPSBzY2FsYXJNb2RlbFByaW1hcnlLZXkoTW9kZWxDbGFzcy5wcmltYXJ5S2V5KCksIGBPZmZsaW5lIHN5bmMgY29uZmxpY3QgaGFuZGxpbmcgZm9yICR7TW9kZWxDbGFzcy5uYW1lfWApXG4gICAgY29uc3QgcHJpbWFyeUtleUF0dHJpYnV0ZSA9IE1vZGVsQ2xhc3MucmVzb2x2ZUF0dHJpYnV0ZU5hbWUocHJpbWFyeUtleSlcbiAgICBjb25zdCB2ZXJzaW9uQXR0cmlidXRlID0gdGhpcy5jb25mbGljdFN0cmF0ZWd5LnZlcnNpb25BdHRyaWJ1dGVcbiAgICBjb25zdCB2ZXJzaW9uQXR0cmlidXRlTmFtZSA9IE1vZGVsQ2xhc3MucmVzb2x2ZUF0dHJpYnV0ZU5hbWUodmVyc2lvbkF0dHJpYnV0ZSlcblxuICAgIGlmICghcHJpbWFyeUtleUF0dHJpYnV0ZSkgdGhyb3cgbmV3IEVycm9yKGBDb3VsZG4ndCByZXNvbHZlIHByaW1hcnkga2V5IGF0dHJpYnV0ZTogJHtwcmltYXJ5S2V5fWApXG4gICAgaWYgKCF2ZXJzaW9uQXR0cmlidXRlTmFtZSkgdGhyb3cgbmV3IEVycm9yKGBDb3VsZG4ndCByZXNvbHZlIHZlcnNpb24gYXR0cmlidXRlOiAke3ZlcnNpb25BdHRyaWJ1dGV9YClcblxuICAgIGNvbnN0IHNlcnZlclZlcnNpb24gPSBub3JtYWxpemVDb25mbGljdFZhbHVlKGV4aXN0aW5nUmVjb3JkLnJlYWRBdHRyaWJ1dGUodmVyc2lvbkF0dHJpYnV0ZU5hbWUpKVxuXG4gICAgaWYgKHN0YWJsZUpzb25TdHJpbmdpZnkoc2VydmVyVmVyc2lvbikgPT09IHN0YWJsZUpzb25TdHJpbmdpZnkobXV0YXRpb24uYmFzZVZlcnNpb24pKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3Qgc2VyaWFsaXplZEFmZmVjdGVkQXR0cmlidXRlcyA9IGF3YWl0IHRoaXMuc2VyaWFsaXplZFJvdXRlZENvbmZsaWN0QXR0cmlidXRlcyh7YXR0cmlidXRlcywgZXhpc3RpbmdSZWNvcmQsIHJlc291cmNlfSlcbiAgICBjb25zdCBzZXJ2ZXJBdHRyaWJ1dGVzID0ge1xuICAgICAgLi4uc2VyaWFsaXplZEFmZmVjdGVkQXR0cmlidXRlcyxcbiAgICAgIFtwcmltYXJ5S2V5QXR0cmlidXRlXTogZXhpc3RpbmdSZWNvcmQucmVhZEF0dHJpYnV0ZShwcmltYXJ5S2V5QXR0cmlidXRlKSxcbiAgICAgIFt2ZXJzaW9uQXR0cmlidXRlTmFtZV06IHNlcnZlclZlcnNpb25cbiAgICB9XG5cbiAgICBjb25zdCBzZXJ2ZXJSZWNvcmQgPSB7XG4gICAgICBhdHRyaWJ1dGVzOiBzZXJ2ZXJBdHRyaWJ1dGVzLFxuICAgICAgdmVyc2lvbjogc2VydmVyVmVyc2lvblxuICAgIH1cbiAgICBjb25zdCBjb25mbGljdE11dGF0aW9uID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuL2RldmljZS1pZGVudGl0eS5qc1wiKS5TeW5jTXV0YXRpb259ICovICgvKiogQHR5cGUge3Vua25vd259ICovICh7XG4gICAgICBhdHRyaWJ1dGVzLFxuICAgICAgYmFzZVZlcnNpb246IG11dGF0aW9uLmJhc2VWZXJzaW9uLFxuICAgICAgY2xpZW50TXV0YXRpb25JZDogbXV0YXRpb24uY2xpZW50TXV0YXRpb25JZCB8fCBtdXRhdGlvbi5pZCxcbiAgICAgIG1vZGVsOiBtdXRhdGlvbi5yZXNvdXJjZVR5cGUsXG4gICAgICBvcGVyYXRpb246IG11dGF0aW9uLnN5bmNUeXBlLFxuICAgICAgcGF5bG9hZDoge2lkOiBtdXRhdGlvbi5yZXNvdXJjZUlkfVxuICAgIH0pKVxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHJlc29sdmVTeW5jQ29uZmxpY3Qoe1xuICAgICAgYmFzZVJlY29yZDogbnVsbCxcbiAgICAgIG11dGF0aW9uOiBjb25mbGljdE11dGF0aW9uLFxuICAgICAgc2VydmVyUmVjb3JkLFxuICAgICAgc3RyYXRlZ3k6IHRoaXMuY29uZmxpY3RTdHJhdGVneS5zdHJhdGVneSB8fCBcIm9wdGltaXN0aWNWZXJzaW9uXCIsXG4gICAgICB2ZXJzaW9uQXR0cmlidXRlXG4gICAgfSlcblxuICAgIGlmIChyZXN1bHQuc3RhdHVzICE9PSBcImNvbmZsaWN0XCIpIHJldHVybiBudWxsXG5cbiAgICByZXR1cm4ge2NvbmZsaWN0OiByZXN1bHQuY29uZmxpY3QsIGNyZWF0ZWQ6IGZhbHNlLCBkZWxldGVkOiBmYWxzZSwgcmVjb3JkOiBleGlzdGluZ1JlY29yZCwgc3RhdHVzOiBcImNvbmZsaWN0XCJ9XG4gIH1cblxuICAvKipcbiAgICogUHJvamVjdHMgYWZmZWN0ZWQgbXV0YXRpb24gZmllbGRzIHRocm91Z2ggdGhlIHJlc291cmNlJ3MgcmVhZGFibGVcbiAgICogYXR0cmlidXRlIGNvbnRyYWN0LiBXcml0YWJsZS1idXQtaGlkZGVuIGZpZWxkcyBhcmUgb21pdHRlZCwgd2hpbGUgY3VzdG9tXG4gICAqIGA8YXR0cmlidXRlPkF0dHJpYnV0ZShtb2RlbClgIHNlcmlhbGl6ZXJzIGFuZCBtb2RlbCBhY2Nlc3NvcnMgcmVtYWluIHRoZVxuICAgKiBzb3VyY2Ugb2YgZnJvbnRlbmQtdmlzaWJsZSB2YWx1ZXMgKERhdGUgdmFsdWVzIGFyZSBrZXB0IHJhdyBzbyB0aGUgbm9ybWFsXG4gICAqIGZyb250ZW5kLW1vZGVsIHRyYW5zcG9ydCBzZXJpYWxpemVyIGNhbiBlbWl0IGl0cyBkYXRlIG1hcmtlcikuIFByb2plY3RlZFxuICAgKiBrZXlzIHVzZSBjYW5vbmljYWwgbW9kZWwgYXR0cmlidXRlIG5hbWVzIGV2ZW4gd2hlbiB0aGUgbXV0YXRpb24gdXNlZCBhXG4gICAqIGRhdGFiYXNlLWNvbHVtbiBhbGlhcy4gVGhlIGZ1bGwgbW9kZWwgYXR0cmlidXRlIGhhc2ggaXMgbmV2ZXIgZXhwb3NlZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBQcm9qZWN0aW9uIGFyZ3MuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmF0dHJpYnV0ZXMgLSBQZXJtaXR0ZWQgYWZmZWN0ZWQgbXV0YXRpb24gYXR0cmlidXRlcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5leGlzdGluZ1JlY29yZCAtIEF1dGhvcml6ZWQgc2VydmVyIHJlY29yZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9mcm9udGVuZC1tb2RlbC1yZXNvdXJjZS9iYXNlLXJlc291cmNlLmpzXCIpLmRlZmF1bHR9IGFyZ3MucmVzb3VyY2UgLSBSb3V0ZWQgcmVzb3VyY2UgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IFNlcmlhbGl6ZWQgcmVhZGFibGUgYWZmZWN0ZWQgYXR0cmlidXRlcy5cbiAgICovXG4gIGFzeW5jIHNlcmlhbGl6ZWRSb3V0ZWRDb25mbGljdEF0dHJpYnV0ZXMoe2F0dHJpYnV0ZXMsIGV4aXN0aW5nUmVjb3JkLCByZXNvdXJjZX0pIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gcmVzb3VyY2UubW9kZWxDbGFzcygpXG4gICAgY29uc3QgUmVzb3VyY2VDbGFzcyA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGV9ICovIChyZXNvdXJjZS5jb25zdHJ1Y3RvcilcbiAgICBjb25zdCByZWFkYWJsZUF0dHJpYnV0ZXMgPSBuZXcgU2V0KClcbiAgICBjb25zdCBjb25maWd1cmVkQXR0cmlidXRlcyA9IFJlc291cmNlQ2xhc3MucmVzb3VyY2VDb25maWcoKS5hdHRyaWJ1dGVzXG4gICAgY29uc3QgY29uZmlndXJlZEVudHJpZXMgPSBBcnJheS5pc0FycmF5KGNvbmZpZ3VyZWRBdHRyaWJ1dGVzKSA/IGNvbmZpZ3VyZWRBdHRyaWJ1dGVzIDogT2JqZWN0LmtleXMoY29uZmlndXJlZEF0dHJpYnV0ZXMpXG5cbiAgICBpZiAoY29uZmlndXJlZEVudHJpZXMubGVuZ3RoID09PSAwKSB7XG4gICAgICBjb25zdCBhdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lID0gTW9kZWxDbGFzcy5nZXRBdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lTWFwKClcblxuICAgICAgZm9yIChjb25zdCBhdHRyaWJ1dGVOYW1lIG9mIE9iamVjdC5rZXlzKGF0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWUpKSB7XG4gICAgICAgIHJlYWRhYmxlQXR0cmlidXRlcy5hZGQoYXR0cmlidXRlTmFtZSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGNvbmZpZ3VyZWRBdHRyaWJ1dGUgb2YgY29uZmlndXJlZEVudHJpZXMpIHtcbiAgICAgIGNvbnN0IGNvbmZpZ3VyZWROYW1lID0gdHlwZW9mIGNvbmZpZ3VyZWRBdHRyaWJ1dGUgPT09IFwic3RyaW5nXCIgPyBjb25maWd1cmVkQXR0cmlidXRlIDogY29uZmlndXJlZEF0dHJpYnV0ZS5uYW1lXG5cbiAgICAgIGlmICghY29uZmlndXJlZE5hbWUpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IGNhbm9uaWNhbE5hbWUgPSBNb2RlbENsYXNzLnJlc29sdmVBdHRyaWJ1dGVOYW1lKGNvbmZpZ3VyZWROYW1lKVxuXG4gICAgICByZWFkYWJsZUF0dHJpYnV0ZXMuYWRkKGNhbm9uaWNhbE5hbWUgfHwgY29uZmlndXJlZE5hbWUpXG4gICAgfVxuXG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3Qgc2VyaWFsaXplZEF0dHJpYnV0ZXMgPSB7fVxuXG4gICAgZm9yIChjb25zdCBhZmZlY3RlZEZpZWxkIG9mIE9iamVjdC5rZXlzKGF0dHJpYnV0ZXMpKSB7XG4gICAgICBjb25zdCBhdHRyaWJ1dGVOYW1lID0gTW9kZWxDbGFzcy5yZXNvbHZlQXR0cmlidXRlTmFtZShhZmZlY3RlZEZpZWxkKVxuXG4gICAgICBpZiAoIWF0dHJpYnV0ZU5hbWUgfHwgIXJlYWRhYmxlQXR0cmlidXRlcy5oYXMoYXR0cmlidXRlTmFtZSkpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IHJlc291cmNlQXR0cmlidXRlID0gcmVzb3VyY2UucmVzb3VyY2VNZXRob2QoYCR7YXR0cmlidXRlTmFtZX1BdHRyaWJ1dGVgKVxuXG4gICAgICBpZiAocmVzb3VyY2VBdHRyaWJ1dGUpIHtcbiAgICAgICAgc2VyaWFsaXplZEF0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV0gPSBhd2FpdCByZXNvdXJjZUF0dHJpYnV0ZS5tZXRob2QuY2FsbChyZXNvdXJjZUF0dHJpYnV0ZS5yZXNvdXJjZSwgZXhpc3RpbmdSZWNvcmQpXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHJlY29yZE1ldGhvZHMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKC8qKiBAdHlwZSB7dW5rbm93bn0gKi8gKGV4aXN0aW5nUmVjb3JkKSlcbiAgICAgIGNvbnN0IGF0dHJpYnV0ZU1ldGhvZCA9IHJlY29yZE1ldGhvZHNbYXR0cmlidXRlTmFtZV1cblxuICAgICAgaWYgKHR5cGVvZiBhdHRyaWJ1dGVNZXRob2QgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICBzZXJpYWxpemVkQXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXSA9IGF3YWl0IGF0dHJpYnV0ZU1ldGhvZC5jYWxsKGV4aXN0aW5nUmVjb3JkKVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgc2VyaWFsaXplZEF0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV0gPSBleGlzdGluZ1JlY29yZC5yZWFkQXR0cmlidXRlKGF0dHJpYnV0ZU5hbWUpXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHNlcmlhbGl6ZWRBdHRyaWJ1dGVzXG4gIH1cblxuICAvKipcbiAgICogRmlsdGVycyBhIHJvdXRlZCBtdXRhdGlvbiBwYXlsb2FkIGRvd24gdG8gdGhlIHJlc291cmNlJ3MgZGVjbGFyZWRcbiAgICogd3JpdGFibGUtYXR0cmlidXRlIHBlcm1pdCBsaXN0LiBBY2NlcHRlZCBrZXlzIHBlciBwZXJtaXR0ZWQgYXR0cmlidXRlIGFyZVxuICAgKiB0aGUgY2FtZWxDYXNlIGF0dHJpYnV0ZSBuYW1lIHBsdXMgdGhlIG1vZGVsJ3MgYWN0dWFsIGNvbHVtbiBuYW1lOyB1bmtub3duXG4gICAqIGtleXMgZmFpbCB0aGUgc3luYyBsb3VkbHkuIFRoZSBwcmltYXJ5IGtleSBpcyBkcm9wcGVkIHdoZW4gcGVybWl0dGVkXG4gICAqIChzbmFwc2hvdCBwYXlsb2Fkcykg4oCUIHRoZSBlbnZlbG9wZSdzIHJlc291cmNlSWQgaXMgdGhlIGF1dGhvcml0YXRpdmVcbiAgICogcmVjb3JkIGlkZW50aXR5LCBzbyBhIHBheWxvYWQgaWQgY2FuIG5ldmVyIHJldGFyZ2V0IHRoZSByb3cuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3N5bmMtZW52ZWxvcGUtcmVwbGF5LXNlcnZpY2UuanNcIikuU3luY1JlcGxheU11dGF0aW9ufSBhcmdzLm11dGF0aW9uIC0gTm9ybWFsaXplZCByZXBsYXkgbXV0YXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWwtcmVzb3VyY2UvYmFzZS1yZXNvdXJjZS5qc1wiKS5kZWZhdWx0fSBhcmdzLnJlc291cmNlIC0gUm91dGVkIHJlc291cmNlIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBQZXJtaXR0ZWQgYXR0cmlidXRlcyBmb3IgcmVjb3JkLmFzc2lnbi5cbiAgICovXG4gIHBlcm1pdHRlZFJvdXRlZEF0dHJpYnV0ZXMoe211dGF0aW9uLCByZXNvdXJjZX0pIHtcbiAgICBjb25zdCBwZXJtaXR0ZWRBdHRyaWJ1dGVzID0gcmVzb3VyY2UuZGVjbGFyZWRXcml0YWJsZUF0dHJpYnV0ZXMoKVxuXG4gICAgaWYgKCFwZXJtaXR0ZWRBdHRyaWJ1dGVzKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7cmVzb3VyY2UuY29uc3RydWN0b3IubmFtZX0gbXVzdCBkZWNsYXJlIHN0YXRpYyB3cml0YWJsZUF0dHJpYnV0ZXMgdG8gYXBwbHkgcm91dGVkIHN5bmMgbXV0YXRpb25zIGZvcjogJHttdXRhdGlvbi5yZXNvdXJjZVR5cGV9YClcbiAgICB9XG5cbiAgICBjb25zdCBNb2RlbENsYXNzID0gcmVzb3VyY2UubW9kZWxDbGFzcygpXG4gICAgY29uc3QgYXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZSA9IE1vZGVsQ2xhc3MuZ2V0QXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZU1hcCgpXG5cbiAgICAvKiogQHR5cGUge1NldDxzdHJpbmc+fSAqL1xuICAgIGNvbnN0IGFsbG93ZWRLZXlzID0gbmV3IFNldCgpXG5cbiAgICBmb3IgKGNvbnN0IGF0dHJpYnV0ZU5hbWUgb2YgcGVybWl0dGVkQXR0cmlidXRlcykge1xuICAgICAgYWxsb3dlZEtleXMuYWRkKGF0dHJpYnV0ZU5hbWUpXG5cbiAgICAgIGNvbnN0IGNvbHVtbk5hbWUgPSBhdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lW2F0dHJpYnV0ZU5hbWVdXG5cbiAgICAgIGlmIChjb2x1bW5OYW1lKSBhbGxvd2VkS2V5cy5hZGQoY29sdW1uTmFtZSlcbiAgICB9XG5cbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gc2NhbGFyTW9kZWxQcmltYXJ5S2V5KE1vZGVsQ2xhc3MucHJpbWFyeUtleSgpLCBgT2ZmbGluZSBzeW5jIGF0dHJpYnV0ZSBmaWx0ZXJpbmcgZm9yICR7TW9kZWxDbGFzcy5uYW1lfWApXG4gICAgY29uc3QgcHJpbWFyeUtleUF0dHJpYnV0ZSA9IE1vZGVsQ2xhc3MuZ2V0Q29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZU1hcCgpW3ByaW1hcnlLZXldXG5cbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCBhdHRyaWJ1dGVzID0ge31cblxuICAgIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKG11dGF0aW9uLmRhdGEpKSB7XG4gICAgICBpZiAoIWFsbG93ZWRLZXlzLmhhcyhrZXkpKSB7XG4gICAgICAgIHRocm93IHJlc291cmNlLndyaXRhYmxlQXR0cmlidXRlRXJyb3IoYFVua25vd24gYXR0cmlidXRlOiAke2tleX0uYCwge2NvZGU6IFwic3luYy11bmtub3duLWF0dHJpYnV0ZVwifSlcbiAgICAgIH1cblxuICAgICAgaWYgKGtleSA9PT0gcHJpbWFyeUtleSB8fCBrZXkgPT09IHByaW1hcnlLZXlBdHRyaWJ1dGUpIGNvbnRpbnVlXG5cbiAgICAgIGF0dHJpYnV0ZXNba2V5XSA9IHZhbHVlXG4gICAgfVxuXG4gICAgcmV0dXJuIGF0dHJpYnV0ZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBDcmVhdGVzIHRoZSByb3V0ZWQgcmVjb3JkIHdpdGggdGhlIGNsaWVudC1nZW5lcmF0ZWQgcHJpbWFyeSBrZXkgKG1hcmtlZFxuICAgKiBhcyBhIHNlcnZlciBhcHBseSBmb3IgdGhlIGR1cmF0aW9uIG9mIHRoZSBjcmVhdGUgLSBpbmNsdWRpbmcgdGhlXG4gICAqIG1lbWJlcnNoaXAtY2hlY2sgY29tcGVuc2F0aW9uIGRlc3Ryb3kgLSBzbyBhbiBhY3RpdmUgU3luY1B1Ymxpc2hlciBuZXZlclxuICAgKiBwdWJsaXNoZXMgdGhlIHJlcGxheWVkIGNyZWF0ZSBhIHNlY29uZCB0aW1lKSwgdGhlblxuICAgKiB2ZXJpZmllcyBjcmVhdGUtc2NvcGUgbWVtYmVyc2hpcCB3aGVuIGFuIGFiaWxpdHkgaXMgY29uZmlndXJlZDogcmVjb3Jkc1xuICAgKiBvdXRzaWRlIHRoZSBhYmlsaXR5J3MgY3JlYXRlIHNjb3BlIGFyZSBkZXN0cm95ZWQgYWdhaW4gYW5kIGZhaWwgdGhlIHN5bmNcbiAgICogd2l0aCB0aGUgcmVzb3VyY2UtZGVjbGFyZWQgcmVhc29uLiBBIHJlY29yZCB0aGF0IGFscmVhZHkgZXhpc3RzIG91dHNpZGVcbiAgICogdGhlIHJlc291cmNlJ3MgbG9va3VwIHNjb3BlIGZhaWxzIHRoZSBzeW5jIGFzIGFuIGF1dGhvcml6YXRpb24gZGVuaWFsXG4gICAqIGluc3RlYWQgb2YgY29sbGlkaW5nIG9uIHRoZSBwcmltYXJ5IGtleS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5hdHRyaWJ1dGVzIC0gUGVybWl0dGVkIHBheWxvYWQgYXR0cmlidXRlcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3N5bmMtZW52ZWxvcGUtcmVwbGF5LXNlcnZpY2UuanNcIikuU3luY1JlcGxheU11dGF0aW9ufSBhcmdzLm11dGF0aW9uIC0gTm9ybWFsaXplZCByZXBsYXkgbXV0YXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWwtcmVzb3VyY2UvYmFzZS1yZXNvdXJjZS5qc1wiKS5kZWZhdWx0fSBhcmdzLnJlc291cmNlIC0gUm91dGVkIHJlc291cmNlIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdD59IENyZWF0ZWQgcmVjb3JkLlxuICAgKi9cbiAgYXN5bmMgY3JlYXRlUm91dGVkUmVwbGF5UmVjb3JkKHthdHRyaWJ1dGVzLCBtdXRhdGlvbiwgcmVzb3VyY2V9KSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IHJlc291cmNlLm1vZGVsQ2xhc3MoKVxuICAgIGNvbnN0IHByaW1hcnlLZXkgPSBzY2FsYXJNb2RlbFByaW1hcnlLZXkoTW9kZWxDbGFzcy5wcmltYXJ5S2V5KCksIGBPZmZsaW5lIHN5bmMgY3JlYXRlIGZvciAke01vZGVsQ2xhc3MubmFtZX1gKVxuICAgIGNvbnN0IGNvbmZsaWN0aW5nSWRzID0gYXdhaXQgTW9kZWxDbGFzcy53aGVyZSh7W3ByaW1hcnlLZXldOiBtdXRhdGlvbi5yZXNvdXJjZUlkfSkucGx1Y2socHJpbWFyeUtleSlcblxuICAgIGlmIChjb25mbGljdGluZ0lkcy5sZW5ndGggPiAwKSB7XG4gICAgICB0aHJvdyBWZWxvY2lvdXNFcnJvci5zYWZlKGBTeW5jIHVwZGF0ZSBkZW5pZWQgZm9yOiAke211dGF0aW9uLnJlc291cmNlVHlwZX0uYCwge1xuICAgICAgICBjb2RlOiByZXNvdXJjZS5zeW5jQXV0aG9yaXphdGlvbkZhaWx1cmVSZWFzb24oe2FjdGlvbjogXCJ1cGRhdGVcIiwgbXV0YXRpb259KSB8fCBcImFjY2Vzcy1kZW5pZWRcIlxuICAgICAgfSlcbiAgICB9XG5cbiAgICBhd2FpdCBNb2RlbENsYXNzLmVuc3VyZUluaXRpYWxpemVkKClcblxuICAgIGNvbnN0IHJlY29yZCA9IG5ldyBNb2RlbENsYXNzKHtbcHJpbWFyeUtleV06IG11dGF0aW9uLnJlc291cmNlSWQsIC4uLmF0dHJpYnV0ZXN9KVxuICAgIGNvbnN0IHJlbGVhc2VTZXJ2ZXJBcHBseSA9IG1hcmtTZXJ2ZXJBcHBseShyZWNvcmQpXG5cbiAgICB0cnkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgcmVjb3JkLnNhdmUoKVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgdGhyb3cgdGhpcy5yb3V0ZWRSZXBsYXlTYXZlRXJyb3IoZXJyb3IpXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGFiaWxpdHkgPSByZXNvdXJjZS5hYmlsaXR5XG5cbiAgICAgIGlmIChhYmlsaXR5KSB7XG4gICAgICAgIGNvbnN0IG1lbWJlcklkcyA9IGF3YWl0IE1vZGVsQ2xhc3NcbiAgICAgICAgICAuYWNjZXNzaWJsZUZvcihyZXNvdXJjZS5zeW5jQWJpbGl0eUFjdGlvbihcImNyZWF0ZVwiKSwgYWJpbGl0eSlcbiAgICAgICAgICAud2hlcmUoe1twcmltYXJ5S2V5XTogc2NhbGFyTW9kZWxQcmltYXJ5S2V5VmFsdWUocmVjb3JkLmlkKCksIGBPZmZsaW5lIHN5bmMgY3JlYXRlIGF1dGhvcml6YXRpb24gZm9yICR7TW9kZWxDbGFzcy5uYW1lfWApfSlcbiAgICAgICAgICAucGx1Y2socHJpbWFyeUtleSlcblxuICAgICAgICBpZiAobWVtYmVySWRzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgIGF3YWl0IHJlY29yZC5kZXN0cm95KClcblxuICAgICAgICAgIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoYFN5bmMgY3JlYXRlIGRlbmllZCBmb3I6ICR7bXV0YXRpb24ucmVzb3VyY2VUeXBlfS5gLCB7XG4gICAgICAgICAgICBjb2RlOiByZXNvdXJjZS5zeW5jQXV0aG9yaXphdGlvbkZhaWx1cmVSZWFzb24oe2FjdGlvbjogXCJjcmVhdGVcIiwgbXV0YXRpb259KSB8fCBcImFjY2Vzcy1kZW5pZWRcIlxuICAgICAgICAgIH0pXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHJlY29yZFxuICAgIH0gZmluYWxseSB7XG4gICAgICByZWxlYXNlU2VydmVyQXBwbHkoKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBTYXZlcyBhIHJvdXRlZCByZWNvcmQsIGNvbnZlcnRpbmcgbW9kZWwgdmFsaWRhdGlvbiBmYWlsdXJlcyBpbnRvXG4gICAqIGNsaWVudC1zYWZlIHBlci1zeW5jIGVycm9ycyBjYXJyeWluZyB0aGUgdHJhbnNsYXRlZCB2YWxpZGF0aW9uIG1lc3NhZ2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IHJlY29yZCAtIFJlY29yZCB0byBzYXZlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgd2hlbiBzYXZlZC5cbiAgICovXG4gIGFzeW5jIHNhdmVSb3V0ZWRSZXBsYXlSZWNvcmQocmVjb3JkKSB7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHJlY29yZC5zYXZlKClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhyb3cgdGhpcy5yb3V0ZWRSZXBsYXlTYXZlRXJyb3IoZXJyb3IpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIE1hcHMgYSByb3V0ZWQgc2F2ZS9jcmVhdGUgZmFpbHVyZTogbW9kZWwgdmFsaWRhdGlvbiBlcnJvcnMgYmVjb21lXG4gICAqIGNsaWVudC1zYWZlIGVycm9ycyB3aXRoIHRoZWlyIHRyYW5zbGF0ZWQgbWVzc2FnZXMsIGV2ZXJ5dGhpbmcgZWxzZVxuICAgKiBwcm9wYWdhdGVzIHVuY2hhbmdlZC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gZXJyb3IgLSBUaHJvd24gc2F2ZS9jcmVhdGUgZXJyb3IuXG4gICAqIEByZXR1cm5zIHtFcnJvcn0gRXJyb3IgdG8gcmV0aHJvdy5cbiAgICovXG4gIHJvdXRlZFJlcGxheVNhdmVFcnJvcihlcnJvcikge1xuICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIFZhbGlkYXRpb25FcnJvcikge1xuICAgICAgcmV0dXJuIFZlbG9jaW91c0Vycm9yLnNhZmUoZXJyb3IubWVzc2FnZSwge2NhdXNlOiBlcnJvciwgY29kZTogXCJ2YWxpZGF0aW9uLWVycm9yXCJ9KVxuICAgIH1cblxuICAgIHJldHVybiAvKiogQHR5cGUge0Vycm9yfSAqLyAoZXJyb3IpXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYW4gYXBwbHkgcmVzdWx0IGZvciBzdGFsZSBtdXRhdGlvbnMgdGhhdCBzaG91bGQgbm90IHRvdWNoIGRvbWFpbiBtb2RlbHMuXG4gICAqIEV4YWN0IGR1cGxpY2F0ZXMgcmVzb2x2ZSB0aGUgY3VycmVudCByb3V0ZWQgcmVjb3JkIHNvIHRoZSBhY2tub3dsZWRnZW1lbnRcbiAgICogY2FuIGluY2x1ZGUgaXRzIGF1dGhvcml0YXRpdmUgdmVyc2lvbiB3aXRob3V0IGFwcGx5aW5nIHRoZSBtdXRhdGlvbiBhZ2Fpbi5cbiAgICogQHBhcmFtIHt7YWN0b3I6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBjb250ZXh0OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIGV4aXN0aW5nU3luYzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIG11dGF0aW9uOiBpbXBvcnQoXCIuL3N5bmMtZW52ZWxvcGUtcmVwbGF5LXNlcnZpY2UuanNcIikuU3luY1JlcGxheU11dGF0aW9ufX0gYXJncyAtIEFjdG9yLCBiYXRjaCBjb250ZXh0LCBleGlzdGluZyBzeW5jIHJvdywgYW5kIG11dGF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IFByb2plY3Qtc3BlY2lmaWMgYXBwbHkgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgc2tpcHBlZFJlcGxheU11dGF0aW9uKHthY3RvciwgY29udGV4dCwgZXhpc3RpbmdTeW5jLCBtdXRhdGlvbn0pIHtcbiAgICBpZiAoIXRoaXMuaXNEdXBsaWNhdGVSZXBsYXlNdXRhdGlvbih7ZXhpc3RpbmdTeW5jLCBtdXRhdGlvbn0pIHx8ICF0aGlzLnJvdXRpbmdDb25maWd1cmVkKCkpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCByZWdpc3RyYXRpb24gPSB0aGlzLnJlcGxheVJlc291cmNlUmVnaXN0cmF0aW9uKG11dGF0aW9uLnJlc291cmNlVHlwZSlcblxuICAgIGlmICghcmVnaXN0cmF0aW9uKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgcmVzb3VyY2UgPSBhd2FpdCB0aGlzLmJ1aWxkUmVwbGF5UmVzb3VyY2Uoe2FjdG9yLCBjb250ZXh0LCBtdXRhdGlvbiwgcmVnaXN0cmF0aW9ufSlcbiAgICBjb25zdCByZWNvcmQgPSBhd2FpdCByZXNvdXJjZS5maW5kU3luY1JlY29yZCh7Zm9yRGVsZXRlOiBtdXRhdGlvbi5zeW5jVHlwZSA9PT0gXCJkZWxldGVcIiwgbXV0YXRpb259KVxuXG4gICAgcmV0dXJuIHtjcmVhdGVkOiBmYWxzZSwgZGVsZXRlZDogZmFsc2UsIGR1cGxpY2F0ZTogdHJ1ZSwgcmVjb3JkfVxuICB9XG5cbiAgLyoqXG4gICAqIFBlcnNpc3RzIG9uZSBub3JtYWxpemVkIG11dGF0aW9uIGludG8gdGhlIGFwcCBzeW5jL2NoYW5nZSBzdG9yZS5cbiAgICpcbiAgICogRGVmYXVsdHMgdG8gYSBzdGFsZS1ndWFyZGVkIHN5bmMtbW9kZWwgdXBzZXJ0ICh3aXRoIHNlcnZlciByZS1zZXF1ZW5jaW5nIG9uXG4gICAqIHVwZGF0ZXMpIHdoZW4gYSBzeW5jIG1vZGVsIGlzIGNvbmZpZ3VyZWQ7IG90aGVyd2lzZSBhcHBzIG92ZXJyaWRlIHRoaXMgaG9vay5cbiAgICogQHBhcmFtIHt7YWN0b3I6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBjb250ZXh0OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIGV4aXN0aW5nU3luYzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGFwcGx5UmVzdWx0OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgbXV0YXRpb246IGltcG9ydChcIi4vc3luYy1lbnZlbG9wZS1yZXBsYXktc2VydmljZS5qc1wiKS5TeW5jUmVwbGF5TXV0YXRpb24sIHNob3VsZEFwcGx5OiBib29sZWFufX0gYXJncyAtIFJlcGxheSBwZXJzaXN0ZW5jZSBhcmd1bWVudHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgcGVyc2lzdFJlcGxheU11dGF0aW9uKHthY3RvciwgYXBwbHlSZXN1bHQsIGNvbnRleHQsIGV4aXN0aW5nU3luYywgbXV0YXRpb24sIHNob3VsZEFwcGx5fSkge1xuICAgIGlmICghdGhpcy5zeW5jTW9kZWwpIHJldHVyblxuXG4gICAgY29uc3QgYXR0cmlidXRlcyA9IHRoaXMucmVwbGF5UGVyc2lzdEF0dHJpYnV0ZXMoe2FjdG9yLCBtdXRhdGlvbn0pXG5cbiAgICAvLyBTdGFsZSByZXBsYXlzIG5ldmVyIGFwcGxpZWQgYW55dGhpbmcsIHNvIHRoZSBhcHBseVJlc3VsdC1kcml2ZW4gZXh0ZW5zaW9uXG4gICAgLy8gaG9va3MgbXVzdCBub3QgcnVuIGFnYWluc3QgdGhlIGRlZmF1bHQgbnVsbCBza2lwcGVkIHJlc3VsdC5cbiAgICBpZiAodGhpcy5wZXJzaXN0RXh0cmFBdHRyaWJ1dGVzICYmIHNob3VsZEFwcGx5KSB7XG4gICAgICBPYmplY3QuYXNzaWduKGF0dHJpYnV0ZXMsIHRoaXMucGVyc2lzdEV4dHJhQXR0cmlidXRlcyh7YWN0b3IsIGFwcGx5UmVzdWx0LCBjb250ZXh0LCBleGlzdGluZ1N5bmMsIG11dGF0aW9uLCBzaG91bGRBcHBseX0pKVxuICAgIH1cblxuICAgIGlmICh0aGlzLnBlcnNpc3RTZXJpYWxpemVkRGF0YSAmJiBzaG91bGRBcHBseSkge1xuICAgICAgY29uc3Qgc2VyaWFsaXplZERhdGEgPSB0aGlzLnBlcnNpc3RTZXJpYWxpemVkRGF0YSh7YXBwbHlSZXN1bHQsIG11dGF0aW9ufSlcblxuICAgICAgaWYgKHNlcmlhbGl6ZWREYXRhICE9PSB1bmRlZmluZWQgJiYgc2VyaWFsaXplZERhdGEgIT09IG51bGwpIHtcbiAgICAgICAgYXR0cmlidXRlcy5kYXRhID0gdHlwZW9mIHNlcmlhbGl6ZWREYXRhID09PSBcInN0cmluZ1wiID8gc2VyaWFsaXplZERhdGEgOiBKU09OLnN0cmluZ2lmeShzZXJpYWxpemVkRGF0YSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAodGhpcy5jb25mbGljdFN0cmF0ZWd5ICYmIHNob3VsZEFwcGx5ICYmIG11dGF0aW9uLmJhc2VWZXJzaW9uICE9PSB1bmRlZmluZWQgJiYgYXBwbHlSZXN1bHQ/LnJlY29yZCkge1xuICAgICAgY29uc3QgcHVibGljUGF5bG9hZCA9IGRlY29kZVJlcGxheVBlcnNpc3RlZERhdGEoYXR0cmlidXRlcy5kYXRhKS5wYXlsb2FkXG4gICAgICBjb25zdCBhY2tub3dsZWRnZW1lbnRWZXJzaW9uID0gbm9ybWFsaXplQ29uZmxpY3RWYWx1ZShhcHBseVJlc3VsdC5yZWNvcmQucmVhZEF0dHJpYnV0ZSh0aGlzLmNvbmZsaWN0U3RyYXRlZ3kudmVyc2lvbkF0dHJpYnV0ZSkpXG5cbiAgICAgIGF0dHJpYnV0ZXMuZGF0YSA9IHNlcmlhbGl6ZVJlcGxheVBlcnNpc3RlZERhdGEoe1xuICAgICAgICBhY2tub3dsZWRnZW1lbnRWZXJzaW9uLFxuICAgICAgICBjbGllbnRNdXRhdGlvbklkOiBTdHJpbmcobXV0YXRpb24uY2xpZW50TXV0YXRpb25JZCB8fCBtdXRhdGlvbi5pZCksXG4gICAgICAgIHBheWxvYWQ6IHB1YmxpY1BheWxvYWQsXG4gICAgICAgIHBheWxvYWRGaW5nZXJwcmludDogc2hhMjU2SGV4KG11dGF0aW9uLnNlcmlhbGl6ZWREYXRhKVxuICAgICAgfSlcbiAgICB9XG5cbiAgICBpZiAoZXhpc3RpbmdTeW5jKSB7XG4gICAgICBjb25zdCBleGlzdGluZ0NsaWVudFVwZGF0ZWRBdCA9IHRoaXMuZXhpc3RpbmdSZXBsYXlTeW5jQ2xpZW50VXBkYXRlZEF0KGV4aXN0aW5nU3luYylcblxuICAgICAgaWYgKGV4aXN0aW5nQ2xpZW50VXBkYXRlZEF0ICYmIG11dGF0aW9uLmNsaWVudFVwZGF0ZWRBdCA8PSBleGlzdGluZ0NsaWVudFVwZGF0ZWRBdCkgcmV0dXJuXG4gICAgfVxuXG4gICAgYXdhaXQgdXBzZXJ0U3luY1Jvdyh7YXR0cmlidXRlcywgZXhpc3RpbmdTeW5jLCBzeW5jTW9kZWw6IHRoaXMuc3luY01vZGVsfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIHN5bmMtbW9kZWwgYXR0cmlidXRlcyBwZXJzaXN0ZWQgYnkgdGhlIG1vZGVsLWJhY2tlZCBkZWZhdWx0LlxuICAgKiBAcGFyYW0ge3thY3RvcjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIG11dGF0aW9uOiBpbXBvcnQoXCIuL3N5bmMtZW52ZWxvcGUtcmVwbGF5LXNlcnZpY2UuanNcIikuU3luY1JlcGxheU11dGF0aW9ufX0gYXJncyAtIEFjdG9yIGFuZCBtdXRhdGlvbi5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gU3luYyByb3cgYXR0cmlidXRlcy5cbiAgICovXG4gIHJlcGxheVBlcnNpc3RBdHRyaWJ1dGVzKHthY3RvciwgbXV0YXRpb259KSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIFt0aGlzLmFjdG9yRm9yZWlnbktleUNvbHVtbl06IHRoaXMucmVwbGF5QWN0b3JJZChhY3RvciksXG4gICAgICBjbGllbnRfdXBkYXRlZF9hdDogbXV0YXRpb24uY2xpZW50VXBkYXRlZEF0LFxuICAgICAgZGF0YTogbXV0YXRpb24uc2VyaWFsaXplZERhdGEsXG4gICAgICByZXNvdXJjZV9pZDogbXV0YXRpb24ucmVzb3VyY2VJZCxcbiAgICAgIHJlc291cmNlX3R5cGU6IG11dGF0aW9uLnJlc291cmNlVHlwZSxcbiAgICAgIHN5bmNfdHlwZTogbXV0YXRpb24uc3luY1R5cGVcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBzaWRlIGVmZmVjdHMgYWZ0ZXIgYSBzdWNjZXNzZnVsIG11dGF0aW9uIHJlcGxheSBhbmQgcGVyc2lzdGVuY2UuXG4gICAqXG4gICAqIERlZmF1bHRzIHRvIGZhbm5pbmcgdGhlIGFwcGxpZWQgcmVzdWx0IG91dCB0aHJvdWdoIHRoZSBjb25maWd1cmVkXG4gICAqIGRlY2xhcmF0aXZlIGJyb2FkY2FzdHMuXG4gICAqIEBwYXJhbSB7e2FjdG9yOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgY29udGV4dDogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBleGlzdGluZ1N5bmM6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBhcHBseVJlc3VsdDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIG11dGF0aW9uOiBpbXBvcnQoXCIuL3N5bmMtZW52ZWxvcGUtcmVwbGF5LXNlcnZpY2UuanNcIikuU3luY1JlcGxheU11dGF0aW9uLCBzaG91bGRBcHBseTogYm9vbGVhbn19IGFyZ3MgLSBSZXBsYXkgc2lkZS1lZmZlY3QgYXJndW1lbnRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIGFmdGVyUmVwbGF5TXV0YXRpb24oYXJncykge1xuICAgIGlmICghdGhpcy5icm9hZGNhc3RzIHx8ICF0aGlzLmJyb2FkY2FzdGVyKSByZXR1cm5cbiAgICAvLyBTdGFsZSByZXBsYXlzIG5ldmVyIGFwcGxpZWQgYW55dGhpbmcgLSBicm9hZGNhc3RpbmcgdGhlaXIgc2tpcHBlZCByZXN1bHRzXG4gICAgLy8gd291bGQgZmFuIG91dCBzdGFsZSBzaWRlIGVmZmVjdHMgKG9yIGNyYXNoIG9uIHRoZSBkZWZhdWx0IG51bGwgYXBwbHlSZXN1bHQpLlxuICAgIGlmICghYXJncy5zaG91bGRBcHBseSkgcmV0dXJuXG5cbiAgICBhd2FpdCBkZWxpdmVyRGVjbGFyZWRCcm9hZGNhc3RzKHthcmdzLCBicm9hZGNhc3RlcjogdGhpcy5icm9hZGNhc3RlciwgYnJvYWRjYXN0czogdGhpcy5icm9hZGNhc3RzfSlcbiAgfVxufVxuXG4vKipcbiAqIFJldHVybnMgYSBkZXRlcm1pbmlzdGljLCBNeVNRTC1zYWZlIGFkdmlzb3J5LWxvY2sgbmFtZSBmb3IgYSByb3V0ZWQgcmVwbGF5XG4gKiByZXNvdXJjZSBpZGVudGl0eS4gVGhlIGZ1bGwgYHtyZXNvdXJjZVR5cGUsIHJlc291cmNlSWR9YCBpZGVudGl0eSBpcyBoYXNoZWRcbiAqIHdpdGggU0hBLTI1NiBhbmQgdHJ1bmNhdGVkIHRvIDMyIGhleCBjaGFyYWN0ZXJzIHNvIHRoZSBmaW5hbCBuYW1lIHN0YXlzIHdlbGxcbiAqIHVuZGVyIE15U1FML01hcmlhREIncyA2NC1jaGFyYWN0ZXIgYEdFVF9MT0NLYCBsaW1pdCB3aGlsZSByZW1haW5pbmdcbiAqIGNvbGxpc2lvbi1yZXNpc3RhbnQuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIExvY2sgaWRlbnRpdHkgYXJncy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnJlc291cmNlSWQgLSBSZXNvdXJjZSBpZC5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnJlc291cmNlVHlwZSAtIFJlc291cmNlIHR5cGUuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIEFkdmlzb3J5IGxvY2sgbmFtZS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHN5bmNSZXBsYXlDb25mbGljdExvY2tOYW1lKHtyZXNvdXJjZUlkLCByZXNvdXJjZVR5cGV9KSB7XG4gIGNvbnN0IGlkZW50aXR5ID0gc3RhYmxlSnNvblN0cmluZ2lmeSh7cmVzb3VyY2VJZCwgcmVzb3VyY2VUeXBlfSlcbiAgY29uc3QgaGFzaCA9IHNoYTI1NkhleChpZGVudGl0eSkuc2xpY2UoMCwgMzIpXG5cbiAgcmV0dXJuIGB2c3I6JHtoYXNofWBcbn1cblxuLyoqXG4gKiBOb3JtYWxpemVzIGEgdmVyc2lvbiB2YWx1ZSBmb3IgZGV0ZXJtaW5pc3RpYyBjb21wYXJpc29uIGFuZCB0cmFuc3BvcnQuXG4gKiBPbmx5IHZlcnNpb24gdmFsdWVzIHBhcnRpY2lwYXRlIGluIHN0YWJsZS1KU09OIGNvbXBhcmlzb24gYWdhaW5zdCBjbGllbnRcbiAqIGBiYXNlVmVyc2lvbmAgc3RyaW5nczsgcmVzb3VyY2Ugc2VyaWFsaXplci9hY2Nlc3NvciByZXN1bHRzIG11c3Qgc3RheSByYXcgc29cbiAqIHRoZSBmcm9udGVuZC1tb2RlbCB0cmFuc3BvcnQgc2VyaWFsaXplciBjYW4gcmV0YWluIERhdGUgbWFya2Vycy5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gUmF3IHZlcnNpb24gdmFsdWUgZnJvbSBhIGRhdGFiYXNlIHJlY29yZC5cbiAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBOb3JtYWxpemVkIHZhbHVlIChEYXRlIHZhbHVlcyBiZWNvbWUgSVNPIHN0cmluZ3MpLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVDb25mbGljdFZhbHVlKHZhbHVlKSB7XG4gIGlmICh2YWx1ZSBpbnN0YW5jZW9mIERhdGUpIHJldHVybiB2YWx1ZS50b0lTT1N0cmluZygpXG5cbiAgcmV0dXJuIHZhbHVlXG59XG4iXX0=