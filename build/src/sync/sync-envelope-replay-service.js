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
 * Private durable idempotency metadata stored outside an application's public change feed.
 * @typedef {object} SyncReplayReceipt
 * @property {string | number | null} acknowledgementVersion - Authoritative version returned for an exact retry.
 * @property {string} clientMutationId - Stable client-owned mutation identity.
 * @property {string} mutationFingerprint - Hash of the complete normalized mutation identity and intent.
 */
/**
 * Application-owned durable receipt storage.
 * @typedef {object} SyncReplayReceiptStore
 * @property {(args: {actor: ReturnType<typeof JSON.parse>, context: Record<string, ReturnType<typeof JSON.parse>>, mutation: SyncReplayMutation}) => Promise<SyncReplayReceipt | null>} find - Finds a receipt in the already-authorized replay partition.
 * @property {(args: {actor: ReturnType<typeof JSON.parse>, context: Record<string, ReturnType<typeof JSON.parse>>, mutation: SyncReplayMutation, receipt: SyncReplayReceipt}) => Promise<void>} save - Durably records a successful apply before its response is returned.
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
     * @param {SyncReplayReceiptStore} [args.replayReceiptStore] - Private durable idempotency storage, separate from public sync/change rows.
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
        this.replayReceiptStore = args.replayReceiptStore || null;
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
        if (this.replayReceiptStore && (typeof this.replayReceiptStore.find !== "function" || typeof this.replayReceiptStore.save !== "function")) {
            throw new Error("SyncEnvelopeReplayService replayReceiptStore requires find and save functions");
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
            const mutationFingerprint = this.replayMutationFingerprint(mutation);
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
            const replayReceipt = await this.findReplayReceipt({ actor: actorResult.actor, context, mutation });
            const receiptDuplicate = replayReceipt ? this.isDuplicateReplayReceipt({ mutationFingerprint, mutation, receipt: replayReceipt }) : false;
            if (replayReceipt && !receiptDuplicate) {
                syncResponses.push({ id: mutation.id, reason: "sync-client-mutation-id-reused", syncState: "failed" });
                continue;
            }
            const shouldApply = receiptDuplicate
                ? false
                : await this.shouldApplyReplayMutation({ actor: actorResult.actor, context, existingSync, mutation });
            const duplicate = receiptDuplicate || (!shouldApply && this.isDuplicateReplayMutation({ existingSync, mutation }));
            /** @type {ReturnType<typeof JSON.parse>} */
            let applyResult;
            try {
                applyResult = shouldApply
                    ? await this.applyReplayMutation({ actor: actorResult.actor, context, existingSync, mutation })
                    : await this.skippedReplayMutation({ actor: actorResult.actor, context, duplicate, existingSync, mutation });
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
            if (shouldApply)
                await this.persistReplayReceipt({ actor: actorResult.actor, context, mutation, mutationFingerprint, applyResult });
            await this.afterReplayMutation({ actor: actorResult.actor, context, existingSync, applyResult, mutation, shouldApply });
            /** @type {Record<string, ReturnType<typeof JSON.parse>>} */
            const successfulResponse = { id: mutation.id, syncState: duplicate ? "duplicate" : "successful" };
            const persistedReplayMetadata = duplicate ? replayReceipt ?? this.replayPersistedMetadata(existingSync) : null;
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
     * Loads private idempotency metadata from the application-owned durable store.
     * @param {{actor: ReturnType<typeof JSON.parse>, context: Record<string, ReturnType<typeof JSON.parse>>, mutation: SyncReplayMutation}} args - Authorized replay context.
     * @returns {Promise<SyncReplayReceipt | null>} Durable receipt or null.
     */
    async findReplayReceipt(args) {
        if (!this.replayReceiptStore)
            return null;
        const receipt = await this.replayReceiptStore.find(args);
        if (receipt === null)
            return null;
        if (!receipt || typeof receipt !== "object" || typeof receipt.clientMutationId !== "string" || typeof receipt.mutationFingerprint !== "string") {
            throw new Error("Sync replay receipt store returned invalid receipt metadata");
        }
        return receipt;
    }
    /**
     * Checks an incoming normalized mutation against private receipt metadata.
     * @param {{mutation: SyncReplayMutation, mutationFingerprint?: string, receipt: SyncReplayReceipt}} args - Mutation and durable receipt.
     * @returns {boolean} Whether this is the exact mutation whose apply was acknowledged.
     */
    isDuplicateReplayReceipt({ mutation, mutationFingerprint = this.replayMutationFingerprint(mutation), receipt }) {
        return receipt.clientMutationId === String(mutation.clientMutationId || mutation.id)
            && receipt.mutationFingerprint === mutationFingerprint;
    }
    /**
     * Hashes the complete normalized mutation intent without retaining its payload.
     * @param {SyncReplayMutation} mutation - Normalized replay mutation.
     * @returns {string} Stable SHA-256 fingerprint.
     */
    replayMutationFingerprint(mutation) {
        return sha256Hex(stableJsonStringify({
            baseVersion: mutation.baseVersion,
            clientUpdatedAt: mutation.clientUpdatedAt.toISOString(),
            data: mutation.data,
            resourceId: mutation.resourceId,
            resourceType: mutation.resourceType,
            syncType: mutation.syncType
        }));
    }
    /**
     * Persists private receipt metadata after a successful apply and feed write.
     * @param {{actor: ReturnType<typeof JSON.parse>, applyResult: ReturnType<typeof JSON.parse>, context: Record<string, ReturnType<typeof JSON.parse>>, mutation: SyncReplayMutation, mutationFingerprint: string}} args - Applied replay context.
     * @returns {Promise<void>} Completion after the receipt is durable.
     */
    async persistReplayReceipt({ actor, applyResult, context, mutation, mutationFingerprint }) {
        if (!this.replayReceiptStore)
            return;
        let acknowledgementVersion = null;
        if (this.conflictStrategy && applyResult?.record) {
            acknowledgementVersion = normalizeConflictValue(applyResult.record.readAttribute(this.conflictStrategy.versionAttribute));
        }
        await this.replayReceiptStore.save({
            actor,
            context,
            mutation,
            receipt: {
                acknowledgementVersion,
                clientMutationId: String(mutation.clientMutationId || mutation.id),
                mutationFingerprint
            }
        });
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
     * @param {{actor: ReturnType<typeof JSON.parse>, context: Record<string, ReturnType<typeof JSON.parse>>, duplicate?: boolean, existingSync: ReturnType<typeof JSON.parse>, mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation}} args - Actor, batch context, existing sync row, and duplicate decision.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} Project-specific apply result.
     */
    async skippedReplayMutation({ actor, context, duplicate = false, existingSync, mutation }) {
        if ((!duplicate && !this.isDuplicateReplayMutation({ existingSync, mutation })) || !this.routingConfigured())
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
        if (!this.replayReceiptStore && this.conflictStrategy && shouldApply && mutation.baseVersion !== undefined && applyResult?.record) {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3luYy1lbnZlbG9wZS1yZXBsYXktc2VydmljZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9zeW5jL3N5bmMtZW52ZWxvcGUtcmVwbGF5LXNlcnZpY2UuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sRUFBQyx5QkFBeUIsRUFBRSxhQUFhLEVBQUMsTUFBTSx5QkFBeUIsQ0FBQTtBQUNoRixPQUFPLEVBQUMsd0NBQXdDLEVBQUMsTUFBTSw2Q0FBNkMsQ0FBQTtBQUNwRyxPQUFPLEVBQUMsZUFBZSxFQUFDLE1BQU0sK0JBQStCLENBQUE7QUFDN0QsT0FBTyxFQUFDLGlDQUFpQyxFQUFDLE1BQU0sMkNBQTJDLENBQUE7QUFDM0YsT0FBTyxFQUFDLG1CQUFtQixFQUFDLE1BQU0sd0JBQXdCLENBQUE7QUFDMUQsT0FBTyx1QkFBdUIsTUFBTSxpQ0FBaUMsQ0FBQTtBQUNyRSxPQUFPLG1CQUFtQixNQUFNLGtCQUFrQixDQUFBO0FBQ2xELE9BQU8sU0FBUyxNQUFNLHdCQUF3QixDQUFBO0FBQzlDLE9BQU8sRUFBQyx5QkFBeUIsRUFBRSw0QkFBNEIsRUFBQyxNQUFNLGlDQUFpQyxDQUFBO0FBQ3ZHLE9BQU8sRUFBQyxlQUFlLEVBQUMsTUFBTSw2QkFBNkIsQ0FBQTtBQUMzRCxPQUFPLGNBQWMsTUFBTSx1QkFBdUIsQ0FBQTtBQUNsRCxPQUFPLEVBQUMscUJBQXFCLEVBQUUsMEJBQTBCLEVBQUMsTUFBTSwrQkFBK0IsQ0FBQTtBQUUvRjs7Ozs7O0dBTUc7QUFDSDs7Ozs7Ozs7Ozs7R0FXRztBQUNIOzs7Ozs7O0dBT0c7QUFDSDs7Ozs7O0dBTUc7QUFDSDs7Ozs7R0FLRztBQUVIOzs7Ozs7OztHQVFHO0FBQ0gsTUFBTSxDQUFDLE9BQU8sT0FBTyx5QkFBeUI7SUFDNUM7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7T0E0Qkc7SUFDSCxZQUFZLElBQUksR0FBRyxFQUFFO1FBQ25CLElBQUksQ0FB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O0dBVUc7QUFDSCxNQUFNLFVBQVUsMEJBQTBCLENBQUMsRUFBQyxVQUFVLEVBQUUsWUFBWSxFQUFDO0lBQ25FLE1BQU0sUUFBUSxHQUFHLG1CQUFtQixDQUFDLEVBQUMsVUFBVSxFQUFFLFlBQVksRUFBQyxDQUFDLENBQUE7SUFDaEUsTUFBTSxJQUFJLEdBQUcsU0FBUyxDQUFDLFFBQVEsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUE7SUFFN0MsT0FBTyxPQUFPLElBQUksRUFBRSxDQUFBO0FBQ3RCLENBQUM7QUFFRDs7Ozs7OztHQU9HO0FBQ0gsU0FBUyxzQkFBc0IsQ0FBQyxLQUFLO0lBQ25DLElBQUksS0FBSyxZQUFZLElBQUk7UUFBRSxPQUFPLEtBQUssQ0FBQyxXQUFXLEVBQUUsQ0FBQTtJQUVyRCxPQUFPLEtBQUssQ0FBQTtBQUNkLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHtkZWxpdmVyRGVjbGFyZWRCcm9hZGNhc3RzLCB1cHNlcnRTeW5jUm93fSBmcm9tIFwiLi9zeW5jLWNoYW5nZS1mYW5vdXQuanNcIlxuaW1wb3J0IHtmcm9udGVuZE1vZGVsUmVzb3VyY2VJbnRlcm5hbENvbnN0cnVjdG9yfSBmcm9tIFwiLi4vZnJvbnRlbmQtbW9kZWwtcmVzb3VyY2UvYmFzZS1yZXNvdXJjZS5qc1wiXG5pbXBvcnQge21hcmtTZXJ2ZXJBcHBseX0gZnJvbSBcIi4vc3luYy1wdWJsaXNoLXN1cHByZXNzaW9uLmpzXCJcbmltcG9ydCB7cmVzb2x2ZUZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzfSBmcm9tIFwiLi4vZnJvbnRlbmQtbW9kZWxzL3Jlc291cmNlLWRlZmluaXRpb24uanNcIlxuaW1wb3J0IHtyZXNvbHZlU3luY0NvbmZsaWN0fSBmcm9tIFwiLi9jb25mbGljdC1zdHJhdGVneS5qc1wiXG5pbXBvcnQgU3luY1JlcGxheVVwc2VydEFwcGxpZXIgZnJvbSBcIi4vc3luYy1yZXBsYXktdXBzZXJ0LWFwcGxpZXIuanNcIlxuaW1wb3J0IHN0YWJsZUpzb25TdHJpbmdpZnkgZnJvbSBcIi4vc3RhYmxlLWpzb24uanNcIlxuaW1wb3J0IHNoYTI1NkhleCBmcm9tIFwiLi4vdXRpbHMvc2hhMjU2LWhleC5qc1wiXG5pbXBvcnQge2RlY29kZVJlcGxheVBlcnNpc3RlZERhdGEsIHNlcmlhbGl6ZVJlcGxheVBlcnNpc3RlZERhdGF9IGZyb20gXCIuL3N5bmMtcmVwbGF5LXBlcnNpc3RlZC1kYXRhLmpzXCJcbmltcG9ydCB7VmFsaWRhdGlvbkVycm9yfSBmcm9tIFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCJcbmltcG9ydCBWZWxvY2lvdXNFcnJvciBmcm9tIFwiLi4vdmVsb2Npb3VzLWVycm9yLmpzXCJcbmltcG9ydCB7c2NhbGFyTW9kZWxQcmltYXJ5S2V5LCBzY2FsYXJNb2RlbFByaW1hcnlLZXlWYWx1ZX0gZnJvbSBcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCJcblxuLyoqXG4gKiBSZXNvbHZlZCByb3V0ZWQtcmVzb3VyY2UgcmVnaXN0cmF0aW9uIGZvciBvbmUgcmVwbGF5IHJlc291cmNlIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBTeW5jUmVwbGF5UmVzb3VyY2VSZWdpc3RyYXRpb25cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBtb2RlbE5hbWUgLSBFZmZlY3RpdmUgZnJvbnRlbmQgbW9kZWwgbmFtZS5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGV9IHJlc291cmNlQ2xhc3MgLSBSb3V0ZWQgcmVzb3VyY2UgY2xhc3MuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuTm9ybWFsaXplZEZyb250ZW5kTW9kZWxSZXNvdXJjZUNvbmZpZ3VyYXRpb24gfCBudWxsfSByZXNvdXJjZUNvbmZpZ3VyYXRpb24gLSBOb3JtYWxpemVkIHJlc291cmNlIGNvbmZpZ3VyYXRpb24gd2hlbiByZWdpc3RyeS1yZXNvbHZlZC5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBTeW5jUmVwbGF5TXV0YXRpb25cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgbnVtYmVyIHwgbnVsbH0gW2Jhc2VWZXJzaW9uXSAtIEJhc2Ugc2VydmVyL2NsaWVudCB2ZXJzaW9uIG9ic2VydmVkIGJ5IHRoZSBjbGllbnQuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW2NsaWVudE11dGF0aW9uSWRdIC0gT3JpZ2luYWwgY2xpZW50IG11dGF0aW9uIGlkIGZyb20gdGhlIHNpZ25lZCBlbnZlbG9wZS5cbiAqIEBwcm9wZXJ0eSB7RGF0ZX0gY2xpZW50VXBkYXRlZEF0IC0gQ2xpZW50LXNpZGUgbXV0YXRpb24gdGltZXN0YW1wLlxuICogQHByb3BlcnR5IHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGRhdGEgLSBQYXJzZWQgbXV0YXRpb24gcGF5bG9hZC5cbiAqIEBwcm9wZXJ0eSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGlkIC0gQ2xpZW50IHN5bmMgcm93IGlkIGZvciBwZXItc3luYyByZXNwb25zZXMuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gcmVzb3VyY2VJZCAtIFJlc291cmNlIGlkIGFzIGEgc3RyaW5nLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHJlc291cmNlVHlwZSAtIFJlc291cmNlL21vZGVsIG5hbWUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gc2VyaWFsaXplZERhdGEgLSBKU09OIHNlcmlhbGl6ZWQgbXV0YXRpb24gcGF5bG9hZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBzeW5jVHlwZSAtIFN5bmMgb3BlcmF0aW9uIHR5cGUuXG4gKi9cbi8qKlxuICogT25lIGRlY2xhcmF0aXZlIGJyb2FkY2FzdCBmYW5uZWQgb3V0IGFmdGVyIGEgbXV0YXRpb24gYXBwbGllcy5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFN5bmNSZXBsYXlCcm9hZGNhc3RcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgKChhcmdzOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IHN0cmluZyl9IGNoYW5uZWwgLSBDaGFubmVsIG5hbWUgb3IgcmVzb2x2ZXIuXG4gKiBAcHJvcGVydHkgeyhhcmdzOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYnJvYWRjYXN0UGFyYW1zIC0gQ2hhbm5lbCByb3V0aW5nIHBhcmFtcy5cbiAqIEBwcm9wZXJ0eSB7KGFyZ3M6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGJvZHkgLSBCcm9hZGNhc3QgYm9keS5cbiAqIEBwcm9wZXJ0eSB7KGFyZ3M6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gYm9vbGVhbn0gW3doZW5dIC0gT3B0aW9uYWwgZ2F0ZTsgc2tpcHBlZCB3aGVuIGl0IHJldHVybnMgZmFsc2UuXG4gKi9cbi8qKlxuICogUHJpdmF0ZSBkdXJhYmxlIGlkZW1wb3RlbmN5IG1ldGFkYXRhIHN0b3JlZCBvdXRzaWRlIGFuIGFwcGxpY2F0aW9uJ3MgcHVibGljIGNoYW5nZSBmZWVkLlxuICogQHR5cGVkZWYge29iamVjdH0gU3luY1JlcGxheVJlY2VpcHRcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgbnVtYmVyIHwgbnVsbH0gYWNrbm93bGVkZ2VtZW50VmVyc2lvbiAtIEF1dGhvcml0YXRpdmUgdmVyc2lvbiByZXR1cm5lZCBmb3IgYW4gZXhhY3QgcmV0cnkuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gY2xpZW50TXV0YXRpb25JZCAtIFN0YWJsZSBjbGllbnQtb3duZWQgbXV0YXRpb24gaWRlbnRpdHkuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gbXV0YXRpb25GaW5nZXJwcmludCAtIEhhc2ggb2YgdGhlIGNvbXBsZXRlIG5vcm1hbGl6ZWQgbXV0YXRpb24gaWRlbnRpdHkgYW5kIGludGVudC5cbiAqL1xuLyoqXG4gKiBBcHBsaWNhdGlvbi1vd25lZCBkdXJhYmxlIHJlY2VpcHQgc3RvcmFnZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFN5bmNSZXBsYXlSZWNlaXB0U3RvcmVcbiAqIEBwcm9wZXJ0eSB7KGFyZ3M6IHthY3RvcjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGNvbnRleHQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgbXV0YXRpb246IFN5bmNSZXBsYXlNdXRhdGlvbn0pID0+IFByb21pc2U8U3luY1JlcGxheVJlY2VpcHQgfCBudWxsPn0gZmluZCAtIEZpbmRzIGEgcmVjZWlwdCBpbiB0aGUgYWxyZWFkeS1hdXRob3JpemVkIHJlcGxheSBwYXJ0aXRpb24uXG4gKiBAcHJvcGVydHkgeyhhcmdzOiB7YWN0b3I6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBjb250ZXh0OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIG11dGF0aW9uOiBTeW5jUmVwbGF5TXV0YXRpb24sIHJlY2VpcHQ6IFN5bmNSZXBsYXlSZWNlaXB0fSkgPT4gUHJvbWlzZTx2b2lkPn0gc2F2ZSAtIER1cmFibHkgcmVjb3JkcyBhIHN1Y2Nlc3NmdWwgYXBwbHkgYmVmb3JlIGl0cyByZXNwb25zZSBpcyByZXR1cm5lZC5cbiAqL1xuXG4vKipcbiAqIFJlcGxheXMgY2xpZW50IHN5bmMgZW52ZWxvcGVzIHRocm91Z2ggcHJvamVjdCBzdXBwbGllZCBhdXRoZW50aWNhdGlvbixcbiAqIGF1dGhvcml6YXRpb24sIGFwcGxpY2F0aW9uLCBhbmQgcGVyc2lzdGVuY2UgaG9va3MuXG4gKlxuICogVGhpcyBpcyBpbnRlbnRpb25hbGx5IHRyYW5zcG9ydC9tb2RlbCBhZ25vc3RpYzogVmVsb2Npb3VzIG93bnMgdGhlIGdlbmVyaWNcbiAqIHJlcGxheSBsb29wLCBub3JtYWxpemF0aW9uLCBzdGFsZS1jbGllbnQgY29tcGFyaXNvbiwgYW5kIHBlci1zeW5jIHJlc3VsdFxuICogc2hhcGUgd2hpbGUgZWFjaCBhcHAgb3ducyBpdHMgdG9rZW4gbG9va3VwLCBtb2RlbCBoYW5kbGVycywgYW5kXG4gKiBkb21haW4gYXV0aG9yaXphdGlvbiBydWxlcy5cbiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgU3luY0VudmVsb3BlUmVwbGF5U2VydmljZSB7XG4gIC8qKlxuICAgKiBDcmVhdGVzIGEgc3luYyBlbnZlbG9wZSByZXBsYXkgc2VydmljZS5cbiAgICpcbiAgICogV2hlbiBhIHN5bmMgbW9kZWwgaXMgZ2l2ZW4sIGBmaW5kRXhpc3RpbmdSZXBsYXlTeW5jYCBhbmRcbiAgICogYHBlcnNpc3RSZXBsYXlNdXRhdGlvbmAgZ2V0IG1vZGVsLWJhY2tlZCBkZWZhdWx0IGltcGxlbWVudGF0aW9ucy4gVGhlIHN5bmNcbiAgICogbW9kZWwgbXVzdCBleHBvc2UgYGZpbmRCeWAvYGNyZWF0ZWAgc3RhdGljcyBwbHVzIGluc3RhbmNlXG4gICAqIGBhc3NpZ25gL2BzYXZlYC9gY2xpZW50VXBkYXRlZEF0YCBhbmQgYGFkdmFuY2VTZXJ2ZXJTZXF1ZW5jZWAgKHRoZVxuICAgKiBjaGFuZ2UtZmVlZCBzZXF1ZW5jZSBjb250cmFjdCksIGFuZCB0aGUgYWN0b3IgcmV0dXJuZWQgZnJvbVxuICAgKiBgYXV0aGVudGljYXRlUmVwbGF5YCBtdXN0IGV4cG9zZSBhbiBgaWQoKWAgbWV0aG9kLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gQ29uc3RydWN0b3IgYXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge3tkZWJ1Zz86ICguLi5hcmdzOiBBcnJheTx1bmtub3duPikgPT4gdm9pZCwgd2Fybj86ICguLi5hcmdzOiBBcnJheTx1bmtub3duPikgPT4gdm9pZH19IFthcmdzLmxvZ2dlcl0gLSBMb2dnZXIgdXNlZCBmb3Igbm9ybWFsaXphdGlvbiB3YXJuaW5ncy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gW2FyZ3Muc3luY01vZGVsXSAtIFN5bmMvY2hhbmdlIG1vZGVsIGVuYWJsaW5nIG1vZGVsLWJhY2tlZCBkZWZhdWx0IGhvb2tzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuYWN0b3JGb3JlaWduS2V5Q29sdW1uXSAtIFN5bmMgbW9kZWwgY29sdW1uIGxpbmtpbmcgcm93cyB0byB0aGUgcmVwbGF5IGFjdG9yLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBbYXJncy5hdXRoZW50aWNhdGlvblRva2VuTW9kZWxdIC0gVG9rZW4gbW9kZWwgZW5hYmxpbmcgdGhlIGRlZmF1bHQgdG9rZW4tbG9va3VwIGF1dGhlbnRpY2F0ZVJlcGxheS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmF1dGhlbnRpY2F0aW9uVG9rZW5Db2x1bW5dIC0gVG9rZW4gbW9kZWwgY29sdW1uIGhvbGRpbmcgdGhlIHRva2VuLiBEZWZhdWx0cyB0byBcInRva2VuXCIuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5hdXRoZW50aWNhdGlvblRva2VuUGFyYW1dIC0gUmVxdWVzdCBwYXJhbSBjYXJyeWluZyB0aGUgdG9rZW4uIERlZmF1bHRzIHRvIFwiYXV0aGVudGljYXRpb25Ub2tlblwiLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsICgoYXJnczogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSA9PiBQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgfCBDb25zdHJ1Y3RvclBhcmFtZXRlcnM8dHlwZW9mIFN5bmNSZXBsYXlVcHNlcnRBcHBsaWVyPlswXT59IFthcmdzLmFwcGx5SGFuZGxlcnNdIC0gUGVyLXJlc291cmNlVHlwZSBhcHBseSBoYW5kbGVycyAoZnVuY3Rpb25zIG9yIGRlY2xhcmF0aXZlIHVwc2VydC1hcHBsaWVyIHNwZWNzKSBlbmFibGluZyB0aGUgZGVmYXVsdCBhcHBseVJlcGxheU11dGF0aW9uIGRpc3BhdGNoLiBEZXByZWNhdGVkOiBwcmVmZXIgcmVzb3VyY2Ugcm91dGluZyB2aWEgYGNvbmZpZ3VyYXRpb25gL2ByZXNvdXJjZVR5cGVPdmVycmlkZXNgOyBhcHBseUhhbmRsZXJzIHJlbWFpbiBmb3IgcmVsZWFzZWQgYWRvcHRlcnMgYW5kIHdpbGwgYmUgcmVtb3ZlZCBhZnRlciB0aGVpciBtaWdyYXRpb24uXG4gICAqIEBwYXJhbSB7KGFyZ3M6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBbYXJncy5wZXJzaXN0RXh0cmFBdHRyaWJ1dGVzXSAtIEV4dHJhIGF0dHJpYnV0ZXMgbWVyZ2VkIGludG8gdGhlIG1vZGVsLWJhY2tlZCBwZXJzaXN0ZWQgcm93IChlLmcuIGFuIGV2ZW50IHNjb3BlIGNvbHVtbikuXG4gICAqIEBwYXJhbSB7KGFyZ3M6IHttdXRhdGlvbjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGFwcGx5UmVzdWx0OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0pID0+IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBbYXJncy5wZXJzaXN0U2VyaWFsaXplZERhdGFdIC0gT3ZlcnJpZGVzIHRoZSBwZXJzaXN0ZWQgZGF0YSBwYXlsb2FkIChvYmplY3QgcmVzdWx0cyBhcmUgSlNPTiBzdHJpbmdpZmllZCkuXG4gICAqIEBwYXJhbSB7KGJyb2FkY2FzdDoge2NoYW5uZWw6IHN0cmluZywgcGFyYW1zOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIGJvZHk6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSkgPT4gUHJvbWlzZTx2b2lkPn0gW2FyZ3MuYnJvYWRjYXN0ZXJdIC0gRGVsaXZlcnMgZGVjbGFyYXRpdmUgYnJvYWRjYXN0cy4gUmVxdWlyZWQgd2hlbiBicm9hZGNhc3RzIGFyZSBjb25maWd1cmVkLlxuICAgKiBAcGFyYW0ge1N5bmNSZXBsYXlCcm9hZGNhc3RbXX0gW2FyZ3MuYnJvYWRjYXN0c10gLSBCcm9hZGNhc3RzIGZhbm5lZCBvdXQgYnkgdGhlIGRlZmF1bHQgYWZ0ZXJSZXBsYXlNdXRhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IFthcmdzLmNvbmZpZ3VyYXRpb25dIC0gQ29uZmlndXJhdGlvbiB3aG9zZSBmcm9udGVuZC1tb2RlbCByZWdpc3RyeSByb3V0ZXMgbXV0YXRpb25zIHRvIHJlc291cmNlIGNsYXNzZXMuXG4gICAqIEBwYXJhbSB7e3N0cmF0ZWd5PzogXCJvcHRpbWlzdGljVmVyc2lvblwiIHwgXCJzZXJ2ZXJXaW5zXCIsIHZlcnNpb25BdHRyaWJ1dGU6IHN0cmluZ30gfCBudWxsfSBbYXJncy5jb25mbGljdFN0cmF0ZWd5XSAtIE9wdGlvbmFsIGJhc2UtdmVyc2lvbiBjb25mbGljdCBkZXRlY3Rpb24gZm9yIHJvdXRlZCB1cHNlcnRzLiBPbmx5IGBvcHRpbWlzdGljVmVyc2lvbmAgYW5kIGBzZXJ2ZXJXaW5zYCBhcmUgc3VwcG9ydGVkIGZvciBiYWNrZW5kIHJlcGxheSBiZWNhdXNlIHRoZSBzZXJ2ZXIgZG9lcyBub3QgaGF2ZSB0aGUgY2xpZW50J3MgYmFzZSBzbmFwc2hvdC4gV2hlbiBgc3RyYXRlZ3lgIGlzIG9taXR0ZWQgaXQgZGVmYXVsdHMgdG8gYG9wdGltaXN0aWNWZXJzaW9uYCwgbWF0Y2hpbmcgYHJlc29sdmVTeW5jQ29uZmxpY3RgIGFuZCBub3JtYWxpemVkIHJlc291cmNlIGNvbmZpZy4gV2hlbiBjb25maWd1cmVkLCBhIG11dGF0aW9uIHdob3NlIGJhc2VWZXJzaW9uIGRvZXMgbm90IG1hdGNoIHRoZSBjdXJyZW50IHNlcnZlciB2ZXJzaW9uQXR0cmlidXRlIGlzIHJlamVjdGVkIHdpdGggYSBzdHJ1Y3R1cmVkIGNvbmZsaWN0IHJlc3VsdCBpbnN0ZWFkIG9mIGJlaW5nIGFwcGxpZWQuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzc1R5cGUgfCBzdHJpbmc+fSBbYXJncy5yZXNvdXJjZVR5cGVPdmVycmlkZXNdIC0gUGVyLXJlc291cmNlVHlwZSByb3V0aW5nIG92ZXJyaWRlczogYSByZXNvdXJjZSBjbGFzcywgb3IgYSBzdHJpbmcgYWxpYXMgcmVzb2x2ZWQgdGhyb3VnaCB0aGUgcmVnaXN0cnkuXG4gICAqIEBwYXJhbSB7U3luY1JlcGxheVJlY2VpcHRTdG9yZX0gW2FyZ3MucmVwbGF5UmVjZWlwdFN0b3JlXSAtIFByaXZhdGUgZHVyYWJsZSBpZGVtcG90ZW5jeSBzdG9yYWdlLCBzZXBhcmF0ZSBmcm9tIHB1YmxpYyBzeW5jL2NoYW5nZSByb3dzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0fSBbYXJncy5hYmlsaXR5XSAtIEFiaWxpdHkgc2NvcGluZyByb3V0ZWQgcmVjb3JkIGxvb2t1cHMgYW5kIGNyZWF0ZSBtZW1iZXJzaGlwIGNoZWNrcy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IFthcmdzLmFiaWxpdHlDb250ZXh0XSAtIEFiaWxpdHkgY29udGV4dCBwYXNzZWQgdG8gcm91dGVkIHJlc291cmNlcy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IFthcmdzLmxvY2Fsc10gLSBMb2NhbHMgcGFzc2VkIHRvIHJvdXRlZCByZXNvdXJjZXMuXG4gICAqL1xuICBjb25zdHJ1Y3RvcihhcmdzID0ge30pIHtcbiAgICB0aGlzLmxvZ2dlciA9IGFyZ3MubG9nZ2VyIHx8IGNvbnNvbGVcbiAgICB0aGlzLnN5bmNNb2RlbCA9IGFyZ3Muc3luY01vZGVsIHx8IG51bGxcbiAgICB0aGlzLmFjdG9yRm9yZWlnbktleUNvbHVtbiA9IGFyZ3MuYWN0b3JGb3JlaWduS2V5Q29sdW1uIHx8IFwiYXV0aGVudGljYXRpb25fdG9rZW5faWRcIlxuICAgIHRoaXMuYXV0aGVudGljYXRpb25Ub2tlbk1vZGVsID0gYXJncy5hdXRoZW50aWNhdGlvblRva2VuTW9kZWwgfHwgbnVsbFxuICAgIHRoaXMuYXV0aGVudGljYXRpb25Ub2tlbkNvbHVtbiA9IGFyZ3MuYXV0aGVudGljYXRpb25Ub2tlbkNvbHVtbiB8fCBcInRva2VuXCJcbiAgICB0aGlzLmF1dGhlbnRpY2F0aW9uVG9rZW5QYXJhbSA9IGFyZ3MuYXV0aGVudGljYXRpb25Ub2tlblBhcmFtIHx8IFwiYXV0aGVudGljYXRpb25Ub2tlblwiXG4gICAgdGhpcy5wZXJzaXN0RXh0cmFBdHRyaWJ1dGVzID0gYXJncy5wZXJzaXN0RXh0cmFBdHRyaWJ1dGVzIHx8IG51bGxcbiAgICB0aGlzLnBlcnNpc3RTZXJpYWxpemVkRGF0YSA9IGFyZ3MucGVyc2lzdFNlcmlhbGl6ZWREYXRhIHx8IG51bGxcbiAgICB0aGlzLmJyb2FkY2FzdGVyID0gYXJncy5icm9hZGNhc3RlciB8fCBudWxsXG4gICAgdGhpcy5icm9hZGNhc3RzID0gYXJncy5icm9hZGNhc3RzIHx8IG51bGxcbiAgICB0aGlzLmFwcGx5SGFuZGxlcnMgPSBhcmdzLmFwcGx5SGFuZGxlcnMgPyB0aGlzLmJ1aWx0QXBwbHlIYW5kbGVycyhhcmdzLmFwcGx5SGFuZGxlcnMpIDogbnVsbFxuICAgIHRoaXMuY29uZmlndXJhdGlvbiA9IGFyZ3MuY29uZmlndXJhdGlvbiB8fCBudWxsXG4gICAgdGhpcy5jb25mbGljdFN0cmF0ZWd5ID0gYXJncy5jb25mbGljdFN0cmF0ZWd5IHx8IG51bGxcbiAgICB0aGlzLnJlc291cmNlVHlwZU92ZXJyaWRlcyA9IGFyZ3MucmVzb3VyY2VUeXBlT3ZlcnJpZGVzIHx8IG51bGxcbiAgICB0aGlzLnJlcGxheVJlY2VpcHRTdG9yZSA9IGFyZ3MucmVwbGF5UmVjZWlwdFN0b3JlIHx8IG51bGxcbiAgICB0aGlzLmFiaWxpdHkgPSBhcmdzLmFiaWxpdHkgfHwgbnVsbFxuICAgIHRoaXMuYWJpbGl0eUNvbnRleHQgPSBhcmdzLmFiaWxpdHlDb250ZXh0IHx8IG51bGxcbiAgICB0aGlzLmxvY2FscyA9IGFyZ3MubG9jYWxzIHx8IG51bGxcbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIFN5bmNSZXBsYXlSZXNvdXJjZVJlZ2lzdHJhdGlvbiB8IG51bGw+fSAqL1xuICAgIHRoaXMuX3JlcGxheVJlc291cmNlUmVnaXN0cmF0aW9ucyA9IG5ldyBNYXAoKVxuXG4gICAgaWYgKGFyZ3MuYWN0b3JGb3JlaWduS2V5Q29sdW1uICE9PSB1bmRlZmluZWQgJiYgKHR5cGVvZiBhcmdzLmFjdG9yRm9yZWlnbktleUNvbHVtbiAhPT0gXCJzdHJpbmdcIiB8fCBhcmdzLmFjdG9yRm9yZWlnbktleUNvbHVtbi5sZW5ndGggPCAxKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBhY3RvckZvcmVpZ25LZXlDb2x1bW4gbXVzdCBiZSBhIG5vbi1ibGFuayBzdHJpbmcsIGdvdDogJHtTdHJpbmcoYXJncy5hY3RvckZvcmVpZ25LZXlDb2x1bW4pfWApXG4gICAgfVxuICAgIGlmICh0aGlzLmJyb2FkY2FzdHMgJiYgIXRoaXMuYnJvYWRjYXN0ZXIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlN5bmNFbnZlbG9wZVJlcGxheVNlcnZpY2UgYnJvYWRjYXN0cyByZXF1aXJlIGEgYnJvYWRjYXN0ZXIgb3B0aW9uIGRlbGl2ZXJpbmcgdGhlbVwiKVxuICAgIH1cbiAgICBpZiAodGhpcy5yZXBsYXlSZWNlaXB0U3RvcmUgJiYgKHR5cGVvZiB0aGlzLnJlcGxheVJlY2VpcHRTdG9yZS5maW5kICE9PSBcImZ1bmN0aW9uXCIgfHwgdHlwZW9mIHRoaXMucmVwbGF5UmVjZWlwdFN0b3JlLnNhdmUgIT09IFwiZnVuY3Rpb25cIikpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlN5bmNFbnZlbG9wZVJlcGxheVNlcnZpY2UgcmVwbGF5UmVjZWlwdFN0b3JlIHJlcXVpcmVzIGZpbmQgYW5kIHNhdmUgZnVuY3Rpb25zXCIpXG4gICAgfVxuICAgIGlmICh0aGlzLmNvbmZsaWN0U3RyYXRlZ3kpIHtcbiAgICAgIGNvbnN0IHN1cHBvcnRlZENvbmZsaWN0U3RyYXRlZ2llcyA9IG5ldyBTZXQoW1wib3B0aW1pc3RpY1ZlcnNpb25cIiwgXCJzZXJ2ZXJXaW5zXCJdKVxuXG4gICAgICBpZiAoIXRoaXMuY29uZmxpY3RTdHJhdGVneS52ZXJzaW9uQXR0cmlidXRlIHx8IHR5cGVvZiB0aGlzLmNvbmZsaWN0U3RyYXRlZ3kudmVyc2lvbkF0dHJpYnV0ZSAhPT0gXCJzdHJpbmdcIikge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jRW52ZWxvcGVSZXBsYXlTZXJ2aWNlIGNvbmZsaWN0U3RyYXRlZ3kgcmVxdWlyZXMgYSBub24tYmxhbmsgdmVyc2lvbkF0dHJpYnV0ZVwiKVxuICAgICAgfVxuICAgICAgaWYgKHRoaXMuY29uZmxpY3RTdHJhdGVneS5zdHJhdGVneSAhPT0gdW5kZWZpbmVkICYmICFzdXBwb3J0ZWRDb25mbGljdFN0cmF0ZWdpZXMuaGFzKHRoaXMuY29uZmxpY3RTdHJhdGVneS5zdHJhdGVneSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbnN1cHBvcnRlZCBzeW5jIGNvbmZsaWN0IHN0cmF0ZWd5IGZvciBiYWNrZW5kIHJlcGxheTogJHt0aGlzLmNvbmZsaWN0U3RyYXRlZ3kuc3RyYXRlZ3l9LiBPbmx5IG9wdGltaXN0aWNWZXJzaW9uIGFuZCBzZXJ2ZXJXaW5zIGFyZSBzdXBwb3J0ZWQuYClcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogV3JhcHMgZGVjbGFyYXRpdmUgYXBwbHktaGFuZGxlciBzcGVjcyBpbiB1cHNlcnQgYXBwbGllcnMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcHBseUhhbmRsZXJzIC0gUmF3IGFwcGx5IGhhbmRsZXJzLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgKGFyZ3M6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gUHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSBDYWxsYWJsZSBoYW5kbGVycyBieSByZXNvdXJjZSB0eXBlLlxuICAgKi9cbiAgYnVpbHRBcHBseUhhbmRsZXJzKGFwcGx5SGFuZGxlcnMpIHtcbiAgICByZXR1cm4gT2JqZWN0LmZyb21FbnRyaWVzKE9iamVjdC5lbnRyaWVzKGFwcGx5SGFuZGxlcnMpLm1hcCgoW3Jlc291cmNlVHlwZSwgaGFuZGxlcl0pID0+IHtcbiAgICAgIGlmICh0eXBlb2YgaGFuZGxlciA9PT0gXCJmdW5jdGlvblwiKSByZXR1cm4gW3Jlc291cmNlVHlwZSwgaGFuZGxlcl1cblxuICAgICAgY29uc3QgYXBwbGllciA9IG5ldyBTeW5jUmVwbGF5VXBzZXJ0QXBwbGllcihoYW5kbGVyKVxuXG4gICAgICByZXR1cm4gW3Jlc291cmNlVHlwZSwgKC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyBhcHBseUFyZ3MpID0+IGFwcGxpZXIuYXBwbHkoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKGFwcGx5QXJncykpXVxuICAgIH0pKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlcGxheXMgYSBzeW5jIGJhdGNoLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gcGFyYW1zIC0gUmVxdWVzdCBwYXJhbXMgY2FycnlpbmcgYXV0aGVudGljYXRpb24gYW5kIHN5bmNzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gW3JlcXVlc3RTdGF0ZV0gLSBSZXF1ZXN0LWxvY2FsIHN0YXRlIHBhc3NlZCB0byBhdXRoZW50aWNhdGlvbi9zeW5jIGV4dHJhY3Rpb24gaG9va3M7IHN1YmNsYXNzZXMgbWF5IHVzZSB0aGlzIHRvIHNoYXJlIHByZS1jb21wdXRlZCBwZXItcmVxdWVzdCBkYXRhIHdpdGhvdXQgaW5zdGFuY2UgbXV0YXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHtzeW5jczogQXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Piwgc3RhdHVzPzogc3RyaW5nLCBlcnJvckNvZGU/OiBzdHJpbmcsIGVycm9yTWVzc2FnZT86IHN0cmluZ30+fSBSZXBsYXkgcmVzcG9uc2UuXG4gICAqL1xuICBhc3luYyByZXBsYXkocGFyYW1zLCByZXF1ZXN0U3RhdGUgPSB7fSkge1xuICAgIGNvbnN0IGFjdG9yUmVzdWx0ID0gYXdhaXQgdGhpcy5hdXRoZW50aWNhdGVSZXBsYXkocGFyYW1zLCByZXF1ZXN0U3RhdGUpXG5cbiAgICBpZiAoIWFjdG9yUmVzdWx0LmF1dGhlbnRpY2F0ZWQpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN5bmNzOiBbXSxcbiAgICAgICAgc3RhdHVzOiBcImVycm9yXCIsXG4gICAgICAgIGVycm9yQ29kZTogYWN0b3JSZXN1bHQuZXJyb3JDb2RlLFxuICAgICAgICBlcnJvck1lc3NhZ2U6IGFjdG9yUmVzdWx0LmVycm9yTWVzc2FnZVxuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IHN5bmNSZXNwb25zZXMgPSBbXVxuICAgIGNvbnN0IGNvbnRleHQgPSBhd2FpdCB0aGlzLmJ1aWxkUmVwbGF5Q29udGV4dCh7YWN0b3I6IGFjdG9yUmVzdWx0LmFjdG9yLCBwYXJhbXMsIHJlcXVlc3RTdGF0ZX0pXG5cbiAgICBmb3IgKGNvbnN0IHJhd1N5bmMgb2YgdGhpcy5yZXBsYXlTeW5jcyhwYXJhbXMsIHJlcXVlc3RTdGF0ZSkpIHtcbiAgICAgIGNvbnN0IG5vcm1hbGl6ZWRSZXN1bHQgPSB0aGlzLm5vcm1hbGl6ZVJlcGxheVN5bmMocmF3U3luYylcblxuICAgICAgaWYgKCFub3JtYWxpemVkUmVzdWx0Lm9rKSB7XG4gICAgICAgIHN5bmNSZXNwb25zZXMucHVzaChub3JtYWxpemVkUmVzdWx0LnJlc3BvbnNlKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBjb25zdCBtdXRhdGlvbiA9IG5vcm1hbGl6ZWRSZXN1bHQubXV0YXRpb25cbiAgICAgIGNvbnN0IG11dGF0aW9uRmluZ2VycHJpbnQgPSB0aGlzLnJlcGxheU11dGF0aW9uRmluZ2VycHJpbnQobXV0YXRpb24pXG4gICAgICBjb25zdCBhY2Nlc3NSZXN1bHQgPSBhd2FpdCB0aGlzLmF1dGhvcml6ZVJlcGxheU11dGF0aW9uKHthY3RvcjogYWN0b3JSZXN1bHQuYWN0b3IsIGNvbnRleHQsIG11dGF0aW9ufSlcblxuICAgICAgaWYgKCFhY2Nlc3NSZXN1bHQuYWxsb3dlZCkge1xuICAgICAgICBzeW5jUmVzcG9uc2VzLnB1c2goe1xuICAgICAgICAgIGlkOiBtdXRhdGlvbi5pZCxcbiAgICAgICAgICBzeW5jU3RhdGU6IFwiZmFpbGVkXCIsXG4gICAgICAgICAgcmVhc29uOiBhY2Nlc3NSZXN1bHQucmVhc29uIHx8IFwiYWNjZXNzLWRlbmllZFwiXG4gICAgICAgIH0pXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGV4aXN0aW5nU3luYyA9IGF3YWl0IHRoaXMuZmluZEV4aXN0aW5nUmVwbGF5U3luYyh7YWN0b3I6IGFjdG9yUmVzdWx0LmFjdG9yLCBjb250ZXh0LCBtdXRhdGlvbn0pXG4gICAgICBjb25zdCByZXBsYXlSZWNlaXB0ID0gYXdhaXQgdGhpcy5maW5kUmVwbGF5UmVjZWlwdCh7YWN0b3I6IGFjdG9yUmVzdWx0LmFjdG9yLCBjb250ZXh0LCBtdXRhdGlvbn0pXG4gICAgICBjb25zdCByZWNlaXB0RHVwbGljYXRlID0gcmVwbGF5UmVjZWlwdCA/IHRoaXMuaXNEdXBsaWNhdGVSZXBsYXlSZWNlaXB0KHttdXRhdGlvbkZpbmdlcnByaW50LCBtdXRhdGlvbiwgcmVjZWlwdDogcmVwbGF5UmVjZWlwdH0pIDogZmFsc2VcblxuICAgICAgaWYgKHJlcGxheVJlY2VpcHQgJiYgIXJlY2VpcHREdXBsaWNhdGUpIHtcbiAgICAgICAgc3luY1Jlc3BvbnNlcy5wdXNoKHtpZDogbXV0YXRpb24uaWQsIHJlYXNvbjogXCJzeW5jLWNsaWVudC1tdXRhdGlvbi1pZC1yZXVzZWRcIiwgc3luY1N0YXRlOiBcImZhaWxlZFwifSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgY29uc3Qgc2hvdWxkQXBwbHkgPSByZWNlaXB0RHVwbGljYXRlXG4gICAgICAgID8gZmFsc2VcbiAgICAgICAgOiBhd2FpdCB0aGlzLnNob3VsZEFwcGx5UmVwbGF5TXV0YXRpb24oe2FjdG9yOiBhY3RvclJlc3VsdC5hY3RvciwgY29udGV4dCwgZXhpc3RpbmdTeW5jLCBtdXRhdGlvbn0pXG4gICAgICBjb25zdCBkdXBsaWNhdGUgPSByZWNlaXB0RHVwbGljYXRlIHx8ICghc2hvdWxkQXBwbHkgJiYgdGhpcy5pc0R1cGxpY2F0ZVJlcGxheU11dGF0aW9uKHtleGlzdGluZ1N5bmMsIG11dGF0aW9ufSkpXG5cbiAgICAgIC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovXG4gICAgICBsZXQgYXBwbHlSZXN1bHRcblxuICAgICAgdHJ5IHtcbiAgICAgICAgYXBwbHlSZXN1bHQgPSBzaG91bGRBcHBseVxuICAgICAgICAgID8gYXdhaXQgdGhpcy5hcHBseVJlcGxheU11dGF0aW9uKHthY3RvcjogYWN0b3JSZXN1bHQuYWN0b3IsIGNvbnRleHQsIGV4aXN0aW5nU3luYywgbXV0YXRpb259KVxuICAgICAgICAgIDogYXdhaXQgdGhpcy5za2lwcGVkUmVwbGF5TXV0YXRpb24oe2FjdG9yOiBhY3RvclJlc3VsdC5hY3RvciwgY29udGV4dCwgZHVwbGljYXRlLCBleGlzdGluZ1N5bmMsIG11dGF0aW9ufSlcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIC8vIENsaWVudC1zYWZlIGFwcGx5IGZhaWx1cmVzIChzY2hlbWEgdmFsaWRhdGlvbiwgbW9kZWwgdmFsaWRhdGlvbixcbiAgICAgICAgLy8gYXV0aG9yaXphdGlvbiBkZW5pYWxzLCB1bmtub3duIHJlc291cmNlIHR5cGVzKSBmYWlsIHRoaXMgc3luYyBhbmRcbiAgICAgICAgLy8ga2VlcCB0aGUgYmF0Y2ggZ29pbmc7IHVuZXhwZWN0ZWQgZXJyb3JzIGtlZXAgcHJvcGFnYXRpbmcuXG4gICAgICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIFZlbG9jaW91c0Vycm9yICYmIGVycm9yLnNhZmVUb0V4cG9zZSkge1xuICAgICAgICAgIHN5bmNSZXNwb25zZXMucHVzaCh7XG4gICAgICAgICAgICBpZDogbXV0YXRpb24uaWQsXG4gICAgICAgICAgICBzeW5jU3RhdGU6IFwiZmFpbGVkXCIsXG4gICAgICAgICAgICByZWFzb246IGVycm9yLmNvZGUgfHwgXCJhcHBseS1mYWlsZWRcIixcbiAgICAgICAgICAgIG1lc3NhZ2U6IGVycm9yLm1lc3NhZ2VcbiAgICAgICAgICB9KVxuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH1cblxuICAgICAgICB0aHJvdyBlcnJvclxuICAgICAgfVxuXG4gICAgICBpZiAoYXBwbHlSZXN1bHQgJiYgYXBwbHlSZXN1bHQuc3RhdHVzID09PSBcImNvbmZsaWN0XCIpIHtcbiAgICAgICAgc3luY1Jlc3BvbnNlcy5wdXNoKHtcbiAgICAgICAgICBjb25mbGljdDogYXBwbHlSZXN1bHQuY29uZmxpY3QsXG4gICAgICAgICAgaWQ6IG11dGF0aW9uLmlkLFxuICAgICAgICAgIHN5bmNTdGF0ZTogXCJjb25mbGljdFwiXG4gICAgICAgIH0pXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHRoaXMucGVyc2lzdFJlcGxheU11dGF0aW9uKHthY3RvcjogYWN0b3JSZXN1bHQuYWN0b3IsIGNvbnRleHQsIGV4aXN0aW5nU3luYywgYXBwbHlSZXN1bHQsIG11dGF0aW9uLCBzaG91bGRBcHBseX0pXG4gICAgICBpZiAoc2hvdWxkQXBwbHkpIGF3YWl0IHRoaXMucGVyc2lzdFJlcGxheVJlY2VpcHQoe2FjdG9yOiBhY3RvclJlc3VsdC5hY3RvciwgY29udGV4dCwgbXV0YXRpb24sIG11dGF0aW9uRmluZ2VycHJpbnQsIGFwcGx5UmVzdWx0fSlcbiAgICAgIGF3YWl0IHRoaXMuYWZ0ZXJSZXBsYXlNdXRhdGlvbih7YWN0b3I6IGFjdG9yUmVzdWx0LmFjdG9yLCBjb250ZXh0LCBleGlzdGluZ1N5bmMsIGFwcGx5UmVzdWx0LCBtdXRhdGlvbiwgc2hvdWxkQXBwbHl9KVxuXG4gICAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICAgIGNvbnN0IHN1Y2Nlc3NmdWxSZXNwb25zZSA9IHtpZDogbXV0YXRpb24uaWQsIHN5bmNTdGF0ZTogZHVwbGljYXRlID8gXCJkdXBsaWNhdGVcIiA6IFwic3VjY2Vzc2Z1bFwifVxuXG4gICAgICBjb25zdCBwZXJzaXN0ZWRSZXBsYXlNZXRhZGF0YSA9IGR1cGxpY2F0ZSA/IHJlcGxheVJlY2VpcHQgPz8gdGhpcy5yZXBsYXlQZXJzaXN0ZWRNZXRhZGF0YShleGlzdGluZ1N5bmMpIDogbnVsbFxuXG4gICAgICBpZiAocGVyc2lzdGVkUmVwbGF5TWV0YWRhdGEpIHtcbiAgICAgICAgc3VjY2Vzc2Z1bFJlc3BvbnNlLnNlcnZlclZlcnNpb24gPSBwZXJzaXN0ZWRSZXBsYXlNZXRhZGF0YS5hY2tub3dsZWRnZW1lbnRWZXJzaW9uXG4gICAgICB9IGVsc2UgaWYgKHRoaXMuY29uZmxpY3RTdHJhdGVneSAmJiBtdXRhdGlvbi5iYXNlVmVyc2lvbiAhPT0gdW5kZWZpbmVkICYmIGFwcGx5UmVzdWx0Py5yZWNvcmQpIHtcbiAgICAgICAgc3VjY2Vzc2Z1bFJlc3BvbnNlLnNlcnZlclZlcnNpb24gPSBub3JtYWxpemVDb25mbGljdFZhbHVlKGFwcGx5UmVzdWx0LnJlY29yZC5yZWFkQXR0cmlidXRlKHRoaXMuY29uZmxpY3RTdHJhdGVneS52ZXJzaW9uQXR0cmlidXRlKSlcbiAgICAgIH1cblxuICAgICAgc3luY1Jlc3BvbnNlcy5wdXNoKHN1Y2Nlc3NmdWxSZXNwb25zZSlcbiAgICB9XG5cbiAgICByZXR1cm4ge3N5bmNzOiBzeW5jUmVzcG9uc2VzfVxuICB9XG5cbiAgLyoqXG4gICAqIEF1dGhlbnRpY2F0ZXMgdGhlIHN5bmMgYmF0Y2ggYWN0b3IuXG4gICAqXG4gICAqIERlZmF1bHRzIHRvIGEgdG9rZW4tbW9kZWwgbG9va3VwIHdoZW4gYGF1dGhlbnRpY2F0aW9uVG9rZW5Nb2RlbGAgaXNcbiAgICogY29uZmlndXJlZDsgb3RoZXJ3aXNlIGFwcHMgb3ZlcnJpZGUgdGhpcyBob29rLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gcGFyYW1zIC0gUmVxdWVzdCBwYXJhbXMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBbX3JlcXVlc3RTdGF0ZV0gLSBSZXF1ZXN0LWxvY2FsIHN0YXRlIHBvcHVsYXRlZCBieSBzdWJjbGFzc2VzIGJlZm9yZSB0aGUgYmFzZSByZXBsYXkgbG9vcCBydW5zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7YXV0aGVudGljYXRlZDogdHJ1ZSwgYWN0b3I6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB8IHthdXRoZW50aWNhdGVkOiBmYWxzZSwgZXJyb3JDb2RlOiBzdHJpbmcsIGVycm9yTWVzc2FnZTogc3RyaW5nfT59IEF1dGggcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgYXV0aGVudGljYXRlUmVwbGF5KHBhcmFtcywgX3JlcXVlc3RTdGF0ZSkge1xuICAgIGlmICghdGhpcy5hdXRoZW50aWNhdGlvblRva2VuTW9kZWwpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlN5bmNFbnZlbG9wZVJlcGxheVNlcnZpY2UuYXV0aGVudGljYXRlUmVwbGF5IG11c3QgYmUgaW1wbGVtZW50ZWQgKG9yIGNvbmZpZ3VyZSBhdXRoZW50aWNhdGlvblRva2VuTW9kZWwpXCIpXG4gICAgfVxuXG4gICAgY29uc3QgdG9rZW4gPSBwYXJhbXNbdGhpcy5hdXRoZW50aWNhdGlvblRva2VuUGFyYW1dXG5cbiAgICBpZiAoIXRva2VuKSB7XG4gICAgICByZXR1cm4ge2F1dGhlbnRpY2F0ZWQ6IGZhbHNlLCBlcnJvckNvZGU6IFwibWlzc2luZy1hdXRoZW50aWNhdGlvbi10b2tlblwiLCBlcnJvck1lc3NhZ2U6IFwiTWlzc2luZyBhdXRoZW50aWNhdGlvbiB0b2tlblwifVxuICAgIH1cblxuICAgIGNvbnN0IGFjdG9yID0gYXdhaXQgdGhpcy5hdXRoZW50aWNhdGlvblRva2VuTW9kZWwuZmluZEJ5KHtbdGhpcy5hdXRoZW50aWNhdGlvblRva2VuQ29sdW1uXTogdG9rZW59KVxuXG4gICAgaWYgKCFhY3Rvcikge1xuICAgICAgcmV0dXJuIHthdXRoZW50aWNhdGVkOiBmYWxzZSwgZXJyb3JDb2RlOiBcImludmFsaWQtYXV0aGVudGljYXRpb24tdG9rZW5cIiwgZXJyb3JNZXNzYWdlOiBcIkludmFsaWQgYXV0aGVudGljYXRpb24gdG9rZW5cIn1cbiAgICB9XG5cbiAgICByZXR1cm4ge2FjdG9yLCBhdXRoZW50aWNhdGVkOiB0cnVlfVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBwZXItYmF0Y2ggbXV0YWJsZSBjb250ZXh0IGZvciBjYWNoZXMgc2hhcmVkIGFjcm9zcyBzeW5jIGl0ZW1zLlxuICAgKiBAcGFyYW0ge3thY3RvcjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIHBhcmFtczogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCByZXF1ZXN0U3RhdGU6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn19IF9hcmdzIC0gQWN0b3IsIHJlcXVlc3QgcGFyYW1zLCBhbmQgcmVxdWVzdC1sb2NhbCBzdGF0ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gUmVwbGF5IGNvbnRleHQuXG4gICAqL1xuICBhc3luYyBidWlsZFJlcGxheUNvbnRleHQoX2FyZ3MpIHtcbiAgICByZXR1cm4ge31cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHJhdyBzeW5jIGVudHJpZXMgZnJvbSByZXF1ZXN0IHBhcmFtcy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHBhcmFtcyAtIFJlcXVlc3QgcGFyYW1zLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gW19yZXF1ZXN0U3RhdGVdIC0gUmVxdWVzdC1sb2NhbCBzdGF0ZSBwb3B1bGF0ZWQgYnkgc3ViY2xhc3NlcyBiZWZvcmUgdGhlIGJhc2UgcmVwbGF5IGxvb3AgcnVucy5cbiAgICogQHJldHVybnMge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gUmF3IHN5bmMgZW50cmllcy5cbiAgICovXG4gIHJlcGxheVN5bmNzKHBhcmFtcywgX3JlcXVlc3RTdGF0ZSkge1xuICAgIHJldHVybiBBcnJheS5pc0FycmF5KHBhcmFtcy5zeW5jcykgPyBwYXJhbXMuc3luY3MgOiBbXVxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZXMgb25lIHN5bmMgZW50cnkuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHJhd1N5bmMgLSBSYXcgc3luYyBlbnRyeS5cbiAgICogQHJldHVybnMge3tvazogdHJ1ZSwgbXV0YXRpb246IGltcG9ydChcIi4vc3luYy1lbnZlbG9wZS1yZXBsYXktc2VydmljZS5qc1wiKS5TeW5jUmVwbGF5TXV0YXRpb259IHwge29rOiBmYWxzZSwgcmVzcG9uc2U6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn19IE5vcm1hbGl6ZWQgbXV0YXRpb24gb3IgZmFpbGVkIHJlc3BvbnNlLlxuICAgKi9cbiAgbm9ybWFsaXplUmVwbGF5U3luYyhyYXdTeW5jKSB7XG4gICAgaWYgKCFyYXdTeW5jIHx8IHR5cGVvZiByYXdTeW5jICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkocmF3U3luYykpIHtcbiAgICAgIHJldHVybiB7b2s6IGZhbHNlLCByZXNwb25zZToge2lkOiB1bmRlZmluZWQsIHN5bmNTdGF0ZTogXCJmYWlsZWRcIiwgcmVhc29uOiBcImludmFsaWQtc3luY1wifX1cbiAgICB9XG5cbiAgICBjb25zdCBzeW5jID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChyYXdTeW5jKVxuICAgIGNvbnN0IHtjbGllbnRNdXRhdGlvbklkLCBjbGllbnRVcGRhdGVkQXQsIGRhdGEsIGlkLCByZXNvdXJjZUlkLCByZXNvdXJjZVR5cGUsIHN5bmNUeXBlfSA9IHN5bmNcblxuICAgIGlmICh0eXBlb2YgcmVzb3VyY2VUeXBlICE9PSBcInN0cmluZ1wiIHx8IHJlc291cmNlVHlwZS5sZW5ndGggPCAxIHx8IHJlc291cmNlSWQgPT09IHVuZGVmaW5lZCB8fCByZXNvdXJjZUlkID09PSBudWxsIHx8IHR5cGVvZiBzeW5jVHlwZSAhPT0gXCJzdHJpbmdcIiB8fCBzeW5jVHlwZS5sZW5ndGggPCAxKSB7XG4gICAgICByZXR1cm4ge29rOiBmYWxzZSwgcmVzcG9uc2U6IHtpZCwgc3luY1N0YXRlOiBcImZhaWxlZFwiLCByZWFzb246IFwiaW52YWxpZC1yZXNvdXJjZS1pZFwifX1cbiAgICB9XG5cbiAgICBjb25zdCByZXNvdXJjZUlkU3RyaW5nID0gU3RyaW5nKHJlc291cmNlSWQpXG4gICAgbGV0IGNsaWVudFVwZGF0ZWRBdERhdGUgPSB0eXBlb2YgY2xpZW50VXBkYXRlZEF0ID09PSBcInN0cmluZ1wiIHx8IGNsaWVudFVwZGF0ZWRBdCBpbnN0YW5jZW9mIERhdGUgPyBuZXcgRGF0ZShjbGllbnRVcGRhdGVkQXQpIDogbmV3IERhdGUoKVxuXG4gICAgaWYgKE51bWJlci5pc05hTihjbGllbnRVcGRhdGVkQXREYXRlLmdldFRpbWUoKSkpIGNsaWVudFVwZGF0ZWRBdERhdGUgPSBuZXcgRGF0ZSgpXG5cbiAgICBjb25zdCBub3JtYWxpemVkRGF0YVJlc3VsdCA9IHRoaXMubm9ybWFsaXplUmVwbGF5U3luY0RhdGEoe2RhdGEsIGlkLCByZXNvdXJjZUlkOiByZXNvdXJjZUlkU3RyaW5nLCByZXNvdXJjZVR5cGV9KVxuXG4gICAgaWYgKCFub3JtYWxpemVkRGF0YVJlc3VsdC5vaykgcmV0dXJuIG5vcm1hbGl6ZWREYXRhUmVzdWx0XG5cbiAgICByZXR1cm4ge1xuICAgICAgb2s6IHRydWUsXG4gICAgICBtdXRhdGlvbjoge1xuICAgICAgICBiYXNlVmVyc2lvbjogc3luYy5iYXNlVmVyc2lvbixcbiAgICAgICAgY2xpZW50TXV0YXRpb25JZCxcbiAgICAgICAgY2xpZW50VXBkYXRlZEF0OiBjbGllbnRVcGRhdGVkQXREYXRlLFxuICAgICAgICBkYXRhOiBub3JtYWxpemVkRGF0YVJlc3VsdC5kYXRhLFxuICAgICAgICBpZCxcbiAgICAgICAgcmVzb3VyY2VJZDogcmVzb3VyY2VJZFN0cmluZyxcbiAgICAgICAgcmVzb3VyY2VUeXBlLFxuICAgICAgICBzZXJpYWxpemVkRGF0YTogSlNPTi5zdHJpbmdpZnkobm9ybWFsaXplZERhdGFSZXN1bHQuZGF0YSksXG4gICAgICAgIHN5bmNUeXBlXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZXMgb25lIHN5bmMgZGF0YSBwYXlsb2FkLlxuICAgKiBAcGFyYW0ge3tkYXRhOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgaWQ6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCByZXNvdXJjZUlkOiBzdHJpbmcsIHJlc291cmNlVHlwZTogc3RyaW5nfX0gYXJncyAtIFN5bmMgcGF5bG9hZCBub3JtYWxpemF0aW9uIGFyZ3VtZW50cy5cbiAgICogQHJldHVybnMge3tvazogdHJ1ZSwgZGF0YTogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSB8IHtvazogZmFsc2UsIHJlc3BvbnNlOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59fSBOb3JtYWxpemVkIHBheWxvYWQgb3IgZmFpbGVkIHJlc3BvbnNlLlxuICAgKi9cbiAgbm9ybWFsaXplUmVwbGF5U3luY0RhdGEoe2RhdGEsIGlkLCByZXNvdXJjZUlkLCByZXNvdXJjZVR5cGV9KSB7XG4gICAgaWYgKGRhdGEgPT09IHVuZGVmaW5lZCB8fCBkYXRhID09PSBudWxsKSByZXR1cm4ge29rOiB0cnVlLCBkYXRhOiB7fX1cblxuICAgIGlmICh0eXBlb2YgZGF0YSA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcGFyc2VkRGF0YSA9IEpTT04ucGFyc2UoZGF0YSlcblxuICAgICAgICBpZiAoIXBhcnNlZERhdGEgfHwgdHlwZW9mIHBhcnNlZERhdGEgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShwYXJzZWREYXRhKSkgcmV0dXJuIHtvazogdHJ1ZSwgZGF0YToge319XG5cbiAgICAgICAgcmV0dXJuIHtvazogdHJ1ZSwgZGF0YTogLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChwYXJzZWREYXRhKX1cbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLndhcm4/LihcIkludmFsaWQgc3luYyBkYXRhIEpTT05cIiwge2Vycm9yLCBpZCwgcmVzb3VyY2VJZCwgcmVzb3VyY2VUeXBlfSlcbiAgICAgICAgcmV0dXJuIHtvazogZmFsc2UsIHJlc3BvbnNlOiB7aWQsIHN5bmNTdGF0ZTogXCJmYWlsZWRcIiwgcmVhc29uOiBcImludmFsaWQtZGF0YVwifX1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIGRhdGEgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShkYXRhKSkgcmV0dXJuIHtvazogdHJ1ZSwgZGF0YToge319XG5cbiAgICByZXR1cm4ge29rOiB0cnVlLCBkYXRhOiBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KGRhdGEpKX1cbiAgfVxuXG4gIC8qKlxuICAgKiBBdXRob3JpemVzIG9uZSBub3JtYWxpemVkIG11dGF0aW9uLlxuICAgKiBAcGFyYW0ge3thY3RvcjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGNvbnRleHQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgbXV0YXRpb246IGltcG9ydChcIi4vc3luYy1lbnZlbG9wZS1yZXBsYXktc2VydmljZS5qc1wiKS5TeW5jUmVwbGF5TXV0YXRpb259fSBfYXJncyAtIEFjdG9yLCBiYXRjaCBjb250ZXh0LCBhbmQgbXV0YXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHthbGxvd2VkOiBib29sZWFuLCByZWFzb24/OiBzdHJpbmd9Pn0gQWNjZXNzIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGF1dGhvcml6ZVJlcGxheU11dGF0aW9uKF9hcmdzKSB7XG4gICAgcmV0dXJuIHthbGxvd2VkOiB0cnVlfVxuICB9XG5cbiAgLyoqXG4gICAqIExvYWRzIHRoZSBwcmV2aW91c2x5IHN0b3JlZCBzeW5jL2NoYW5nZSByb3cgZm9yIHN0YWxlLWNsaWVudCBjb21wYXJpc29uLlxuICAgKlxuICAgKiBEZWZhdWx0cyB0byBhIHN5bmMtbW9kZWwgbG9va3VwIGJ5IGFjdG9yIGFuZCByZXNvdXJjZSBpZGVudGl0eSB3aGVuIGEgc3luY1xuICAgKiBtb2RlbCBpcyBjb25maWd1cmVkOyBvdGhlcndpc2UgYXBwcyBvdmVycmlkZSB0aGlzIGhvb2suXG4gICAqIEBwYXJhbSB7e2FjdG9yOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgY29udGV4dDogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBtdXRhdGlvbjogaW1wb3J0KFwiLi9zeW5jLWVudmVsb3BlLXJlcGxheS1zZXJ2aWNlLmpzXCIpLlN5bmNSZXBsYXlNdXRhdGlvbn19IGFyZ3MgLSBBY3RvciwgYmF0Y2ggY29udGV4dCwgYW5kIG11dGF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IEV4aXN0aW5nIHN5bmMgcm93LlxuICAgKi9cbiAgYXN5bmMgZmluZEV4aXN0aW5nUmVwbGF5U3luYyh7YWN0b3IsIG11dGF0aW9ufSkge1xuICAgIGlmICghdGhpcy5zeW5jTW9kZWwpIHJldHVybiBudWxsXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5zeW5jTW9kZWwuZmluZEJ5KHtcbiAgICAgIFt0aGlzLmFjdG9yRm9yZWlnbktleUNvbHVtbl06IHRoaXMucmVwbGF5QWN0b3JJZChhY3RvciksXG4gICAgICByZXNvdXJjZV9pZDogbXV0YXRpb24ucmVzb3VyY2VJZCxcbiAgICAgIHJlc291cmNlX3R5cGU6IG11dGF0aW9uLnJlc291cmNlVHlwZVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIHBlcnNpc3RlZCBhY3RvciBpZCB1c2VkIGJ5IG1vZGVsLWJhY2tlZCBkZWZhdWx0IGhvb2tzLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhY3RvciAtIEFjdG9yIHJldHVybmVkIGZyb20gYXV0aGVudGljYXRlUmVwbGF5LlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IEFjdG9yIGlkLlxuICAgKi9cbiAgcmVwbGF5QWN0b3JJZChhY3Rvcikge1xuICAgIGlmICghYWN0b3IgfHwgdHlwZW9mIGFjdG9yICE9PSBcIm9iamVjdFwiIHx8IHR5cGVvZiBhY3Rvci5pZCAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jRW52ZWxvcGVSZXBsYXlTZXJ2aWNlIG1vZGVsLWJhY2tlZCBkZWZhdWx0cyByZXF1aXJlIGFuIGFjdG9yIHdpdGggYW4gaWQoKSBtZXRob2QgZnJvbSBhdXRoZW50aWNhdGVSZXBsYXlcIilcbiAgICB9XG5cbiAgICByZXR1cm4gYWN0b3IuaWQoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgd2hldGhlciBhIG5vcm1hbGl6ZWQgbXV0YXRpb24gc2hvdWxkIGJlIGFwcGxpZWQgdG8gZG9tYWluIG1vZGVscy5cbiAgICogQHBhcmFtIHt7YWN0b3I6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBjb250ZXh0OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIGV4aXN0aW5nU3luYzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIG11dGF0aW9uOiBpbXBvcnQoXCIuL3N5bmMtZW52ZWxvcGUtcmVwbGF5LXNlcnZpY2UuanNcIikuU3luY1JlcGxheU11dGF0aW9ufX0gYXJncyAtIEFjdG9yLCBiYXRjaCBjb250ZXh0LCBleGlzdGluZyBzeW5jIHJvdywgYW5kIG11dGF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gV2hldGhlciB0byBhcHBseSB0aGUgbXV0YXRpb24uXG4gICAqL1xuICBhc3luYyBzaG91bGRBcHBseVJlcGxheU11dGF0aW9uKHtleGlzdGluZ1N5bmMsIG11dGF0aW9ufSkge1xuICAgIGNvbnN0IGV4aXN0aW5nQ2xpZW50VXBkYXRlZEF0ID0gdGhpcy5leGlzdGluZ1JlcGxheVN5bmNDbGllbnRVcGRhdGVkQXQoZXhpc3RpbmdTeW5jKVxuXG4gICAgcmV0dXJuICFleGlzdGluZ0NsaWVudFVwZGF0ZWRBdCB8fCBtdXRhdGlvbi5jbGllbnRVcGRhdGVkQXQgPiBleGlzdGluZ0NsaWVudFVwZGF0ZWRBdFxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBjbGllbnQgdGltZXN0YW1wIGZyb20gYW4gZXhpc3Rpbmcgc3luYyByb3cuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGV4aXN0aW5nU3luYyAtIEV4aXN0aW5nIHN5bmMgcm93LlxuICAgKiBAcmV0dXJucyB7RGF0ZSB8IG51bGx9IEV4aXN0aW5nIGNsaWVudCB0aW1lc3RhbXAuXG4gICAqL1xuICBleGlzdGluZ1JlcGxheVN5bmNDbGllbnRVcGRhdGVkQXQoZXhpc3RpbmdTeW5jKSB7XG4gICAgaWYgKCFleGlzdGluZ1N5bmMgfHwgdHlwZW9mIGV4aXN0aW5nU3luYyAhPT0gXCJvYmplY3RcIikgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IHN5bmNSZWNvcmQgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKGV4aXN0aW5nU3luYylcbiAgICBjb25zdCB2YWx1ZSA9IHR5cGVvZiBzeW5jUmVjb3JkLmNsaWVudFVwZGF0ZWRBdCA9PT0gXCJmdW5jdGlvblwiXG4gICAgICA/IHN5bmNSZWNvcmQuY2xpZW50VXBkYXRlZEF0KClcbiAgICAgIDogc3luY1JlY29yZC5jbGllbnRVcGRhdGVkQXRcblxuICAgIGlmICh2YWx1ZSBpbnN0YW5jZW9mIERhdGUpIHJldHVybiB2YWx1ZVxuXG4gICAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJzdHJpbmdcIikgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IHBhcnNlZFZhbHVlID0gbmV3IERhdGUodmFsdWUpXG5cbiAgICByZXR1cm4gTnVtYmVyLmlzTmFOKHBhcnNlZFZhbHVlLmdldFRpbWUoKSkgPyBudWxsIDogcGFyc2VkVmFsdWVcbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVja3Mgd2hldGhlciBhIHNraXBwZWQgbXV0YXRpb24gZXhhY3RseSBtYXRjaGVzIHRoZSBwZXJzaXN0ZWQgcmVwbGF5IHJvdy5cbiAgICogT2xkZXIgZGlzdGluY3QgbXV0YXRpb25zIHJldGFpbiB0aGUgZXN0YWJsaXNoZWQgc3VjY2Vzc2Z1bCBzdGFsZS1za2lwIHJlc3BvbnNlLlxuICAgKiBAcGFyYW0ge3tleGlzdGluZ1N5bmM6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBtdXRhdGlvbjogaW1wb3J0KFwiLi9zeW5jLWVudmVsb3BlLXJlcGxheS1zZXJ2aWNlLmpzXCIpLlN5bmNSZXBsYXlNdXRhdGlvbn19IGFyZ3MgLSBFeGlzdGluZyByb3cgYW5kIGluY29taW5nIG11dGF0aW9uLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gV2hldGhlciB0aGlzIGlzIGEgZHVwbGljYXRlIHJlcGxheS5cbiAgICovXG4gIGlzRHVwbGljYXRlUmVwbGF5TXV0YXRpb24oe2V4aXN0aW5nU3luYywgbXV0YXRpb259KSB7XG4gICAgaWYgKCFleGlzdGluZ1N5bmMpIHJldHVybiBmYWxzZVxuXG4gICAgY29uc3QgbWV0YWRhdGEgPSB0aGlzLnJlcGxheVBlcnNpc3RlZE1ldGFkYXRhKGV4aXN0aW5nU3luYylcblxuICAgIGlmIChtZXRhZGF0YSkge1xuICAgICAgcmV0dXJuIG1ldGFkYXRhLmNsaWVudE11dGF0aW9uSWQgPT09IFN0cmluZyhtdXRhdGlvbi5jbGllbnRNdXRhdGlvbklkIHx8IG11dGF0aW9uLmlkKVxuICAgICAgICAmJiBtZXRhZGF0YS5wYXlsb2FkRmluZ2VycHJpbnQgPT09IHNoYTI1NkhleChtdXRhdGlvbi5zZXJpYWxpemVkRGF0YSlcbiAgICB9XG5cbiAgICBjb25zdCBleGlzdGluZ0NsaWVudFVwZGF0ZWRBdCA9IHRoaXMuZXhpc3RpbmdSZXBsYXlTeW5jQ2xpZW50VXBkYXRlZEF0KGV4aXN0aW5nU3luYylcbiAgICBjb25zdCBleGlzdGluZ0RhdGEgPSB0aGlzLnJlcGxheVN5bmNSZWNvcmRWYWx1ZShleGlzdGluZ1N5bmMsIFwiZGF0YVwiKVxuICAgIGNvbnN0IGV4aXN0aW5nU3luY1R5cGUgPSB0aGlzLnJlcGxheVN5bmNSZWNvcmRWYWx1ZShleGlzdGluZ1N5bmMsIFwic3luY1R5cGVcIilcbiAgICBjb25zdCBzZXJpYWxpemVkRXhpc3RpbmdEYXRhID0gdHlwZW9mIGV4aXN0aW5nRGF0YSA9PT0gXCJzdHJpbmdcIiA/IGV4aXN0aW5nRGF0YSA6IEpTT04uc3RyaW5naWZ5KGV4aXN0aW5nRGF0YSlcblxuICAgIHJldHVybiBleGlzdGluZ0NsaWVudFVwZGF0ZWRBdD8uZ2V0VGltZSgpID09PSBtdXRhdGlvbi5jbGllbnRVcGRhdGVkQXQuZ2V0VGltZSgpXG4gICAgICAmJiBzZXJpYWxpemVkRXhpc3RpbmdEYXRhID09PSBtdXRhdGlvbi5zZXJpYWxpemVkRGF0YVxuICAgICAgJiYgZXhpc3RpbmdTeW5jVHlwZSA9PT0gbXV0YXRpb24uc3luY1R5cGVcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkcyBhIG1vZGVsLWJhY2tlZCBzeW5jLXJvdyB2YWx1ZSB0aHJvdWdoIGl0cyBhY2Nlc3NvciBvciBwbGFpbiBwcm9wZXJ0eS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gc3luY1JlY29yZCAtIEV4aXN0aW5nIHN5bmMgcm93LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0cmlidXRlTmFtZSAtIEF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IFN0b3JlZCB2YWx1ZS5cbiAgICovXG4gIHJlcGxheVN5bmNSZWNvcmRWYWx1ZShzeW5jUmVjb3JkLCBhdHRyaWJ1dGVOYW1lKSB7XG4gICAgY29uc3QgcmVjb3JkID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChzeW5jUmVjb3JkKVxuICAgIGNvbnN0IHZhbHVlID0gcmVjb3JkW2F0dHJpYnV0ZU5hbWVdXG5cbiAgICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSBcImZ1bmN0aW9uXCIgPyB2YWx1ZS5jYWxsKHN5bmNSZWNvcmQpIDogdmFsdWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkcyBkdXJhYmxlIHJlcGxheSBhY2tub3dsZWRnZW1lbnQgbWV0YWRhdGEgZnJvbSBhIG1vZGVsLWJhY2tlZCBzeW5jIHJvdy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gc3luY1JlY29yZCAtIEV4aXN0aW5nIHN5bmMgcm93LlxuICAgKiBAcmV0dXJucyB7e2Fja25vd2xlZGdlbWVudFZlcnNpb246IHN0cmluZyB8IG51bWJlciB8IG51bGwsIGNsaWVudE11dGF0aW9uSWQ6IHN0cmluZywgcGF5bG9hZEZpbmdlcnByaW50OiBzdHJpbmd9IHwgbnVsbH0gUGVyc2lzdGVkIG1ldGFkYXRhLlxuICAgKi9cbiAgcmVwbGF5UGVyc2lzdGVkTWV0YWRhdGEoc3luY1JlY29yZCkge1xuICAgIGlmICghc3luY1JlY29yZCkgcmV0dXJuIG51bGxcblxuICAgIHJldHVybiBkZWNvZGVSZXBsYXlQZXJzaXN0ZWREYXRhKHRoaXMucmVwbGF5U3luY1JlY29yZFZhbHVlKHN5bmNSZWNvcmQsIFwiZGF0YVwiKSkubWV0YWRhdGFcbiAgfVxuXG4gIC8qKlxuICAgKiBMb2FkcyBwcml2YXRlIGlkZW1wb3RlbmN5IG1ldGFkYXRhIGZyb20gdGhlIGFwcGxpY2F0aW9uLW93bmVkIGR1cmFibGUgc3RvcmUuXG4gICAqIEBwYXJhbSB7e2FjdG9yOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgY29udGV4dDogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBtdXRhdGlvbjogU3luY1JlcGxheU11dGF0aW9ufX0gYXJncyAtIEF1dGhvcml6ZWQgcmVwbGF5IGNvbnRleHQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFN5bmNSZXBsYXlSZWNlaXB0IHwgbnVsbD59IER1cmFibGUgcmVjZWlwdCBvciBudWxsLlxuICAgKi9cbiAgYXN5bmMgZmluZFJlcGxheVJlY2VpcHQoYXJncykge1xuICAgIGlmICghdGhpcy5yZXBsYXlSZWNlaXB0U3RvcmUpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCByZWNlaXB0ID0gYXdhaXQgdGhpcy5yZXBsYXlSZWNlaXB0U3RvcmUuZmluZChhcmdzKVxuXG4gICAgaWYgKHJlY2VpcHQgPT09IG51bGwpIHJldHVybiBudWxsXG4gICAgaWYgKCFyZWNlaXB0IHx8IHR5cGVvZiByZWNlaXB0ICE9PSBcIm9iamVjdFwiIHx8IHR5cGVvZiByZWNlaXB0LmNsaWVudE11dGF0aW9uSWQgIT09IFwic3RyaW5nXCIgfHwgdHlwZW9mIHJlY2VpcHQubXV0YXRpb25GaW5nZXJwcmludCAhPT0gXCJzdHJpbmdcIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiU3luYyByZXBsYXkgcmVjZWlwdCBzdG9yZSByZXR1cm5lZCBpbnZhbGlkIHJlY2VpcHQgbWV0YWRhdGFcIilcbiAgICB9XG5cbiAgICByZXR1cm4gcmVjZWlwdFxuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrcyBhbiBpbmNvbWluZyBub3JtYWxpemVkIG11dGF0aW9uIGFnYWluc3QgcHJpdmF0ZSByZWNlaXB0IG1ldGFkYXRhLlxuICAgKiBAcGFyYW0ge3ttdXRhdGlvbjogU3luY1JlcGxheU11dGF0aW9uLCBtdXRhdGlvbkZpbmdlcnByaW50Pzogc3RyaW5nLCByZWNlaXB0OiBTeW5jUmVwbGF5UmVjZWlwdH19IGFyZ3MgLSBNdXRhdGlvbiBhbmQgZHVyYWJsZSByZWNlaXB0LlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gV2hldGhlciB0aGlzIGlzIHRoZSBleGFjdCBtdXRhdGlvbiB3aG9zZSBhcHBseSB3YXMgYWNrbm93bGVkZ2VkLlxuICAgKi9cbiAgaXNEdXBsaWNhdGVSZXBsYXlSZWNlaXB0KHttdXRhdGlvbiwgbXV0YXRpb25GaW5nZXJwcmludCA9IHRoaXMucmVwbGF5TXV0YXRpb25GaW5nZXJwcmludChtdXRhdGlvbiksIHJlY2VpcHR9KSB7XG4gICAgcmV0dXJuIHJlY2VpcHQuY2xpZW50TXV0YXRpb25JZCA9PT0gU3RyaW5nKG11dGF0aW9uLmNsaWVudE11dGF0aW9uSWQgfHwgbXV0YXRpb24uaWQpXG4gICAgICAmJiByZWNlaXB0Lm11dGF0aW9uRmluZ2VycHJpbnQgPT09IG11dGF0aW9uRmluZ2VycHJpbnRcbiAgfVxuXG4gIC8qKlxuICAgKiBIYXNoZXMgdGhlIGNvbXBsZXRlIG5vcm1hbGl6ZWQgbXV0YXRpb24gaW50ZW50IHdpdGhvdXQgcmV0YWluaW5nIGl0cyBwYXlsb2FkLlxuICAgKiBAcGFyYW0ge1N5bmNSZXBsYXlNdXRhdGlvbn0gbXV0YXRpb24gLSBOb3JtYWxpemVkIHJlcGxheSBtdXRhdGlvbi5cbiAgICogQHJldHVybnMge3N0cmluZ30gU3RhYmxlIFNIQS0yNTYgZmluZ2VycHJpbnQuXG4gICAqL1xuICByZXBsYXlNdXRhdGlvbkZpbmdlcnByaW50KG11dGF0aW9uKSB7XG4gICAgcmV0dXJuIHNoYTI1NkhleChzdGFibGVKc29uU3RyaW5naWZ5KHtcbiAgICAgIGJhc2VWZXJzaW9uOiBtdXRhdGlvbi5iYXNlVmVyc2lvbixcbiAgICAgIGNsaWVudFVwZGF0ZWRBdDogbXV0YXRpb24uY2xpZW50VXBkYXRlZEF0LnRvSVNPU3RyaW5nKCksXG4gICAgICBkYXRhOiBtdXRhdGlvbi5kYXRhLFxuICAgICAgcmVzb3VyY2VJZDogbXV0YXRpb24ucmVzb3VyY2VJZCxcbiAgICAgIHJlc291cmNlVHlwZTogbXV0YXRpb24ucmVzb3VyY2VUeXBlLFxuICAgICAgc3luY1R5cGU6IG11dGF0aW9uLnN5bmNUeXBlXG4gICAgfSkpXG4gIH1cblxuICAvKipcbiAgICogUGVyc2lzdHMgcHJpdmF0ZSByZWNlaXB0IG1ldGFkYXRhIGFmdGVyIGEgc3VjY2Vzc2Z1bCBhcHBseSBhbmQgZmVlZCB3cml0ZS5cbiAgICogQHBhcmFtIHt7YWN0b3I6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBhcHBseVJlc3VsdDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGNvbnRleHQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgbXV0YXRpb246IFN5bmNSZXBsYXlNdXRhdGlvbiwgbXV0YXRpb25GaW5nZXJwcmludDogc3RyaW5nfX0gYXJncyAtIEFwcGxpZWQgcmVwbGF5IGNvbnRleHQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBDb21wbGV0aW9uIGFmdGVyIHRoZSByZWNlaXB0IGlzIGR1cmFibGUuXG4gICAqL1xuICBhc3luYyBwZXJzaXN0UmVwbGF5UmVjZWlwdCh7YWN0b3IsIGFwcGx5UmVzdWx0LCBjb250ZXh0LCBtdXRhdGlvbiwgbXV0YXRpb25GaW5nZXJwcmludH0pIHtcbiAgICBpZiAoIXRoaXMucmVwbGF5UmVjZWlwdFN0b3JlKSByZXR1cm5cblxuICAgIGxldCBhY2tub3dsZWRnZW1lbnRWZXJzaW9uID0gbnVsbFxuICAgIGlmICh0aGlzLmNvbmZsaWN0U3RyYXRlZ3kgJiYgYXBwbHlSZXN1bHQ/LnJlY29yZCkge1xuICAgICAgYWNrbm93bGVkZ2VtZW50VmVyc2lvbiA9IG5vcm1hbGl6ZUNvbmZsaWN0VmFsdWUoYXBwbHlSZXN1bHQucmVjb3JkLnJlYWRBdHRyaWJ1dGUodGhpcy5jb25mbGljdFN0cmF0ZWd5LnZlcnNpb25BdHRyaWJ1dGUpKVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMucmVwbGF5UmVjZWlwdFN0b3JlLnNhdmUoe1xuICAgICAgYWN0b3IsXG4gICAgICBjb250ZXh0LFxuICAgICAgbXV0YXRpb24sXG4gICAgICByZWNlaXB0OiB7XG4gICAgICAgIGFja25vd2xlZGdlbWVudFZlcnNpb24sXG4gICAgICAgIGNsaWVudE11dGF0aW9uSWQ6IFN0cmluZyhtdXRhdGlvbi5jbGllbnRNdXRhdGlvbklkIHx8IG11dGF0aW9uLmlkKSxcbiAgICAgICAgbXV0YXRpb25GaW5nZXJwcmludFxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQXBwbGllcyBvbmUgbm9ybWFsaXplZCBtdXRhdGlvbiB0byBkb21haW4gbW9kZWxzLlxuICAgKlxuICAgKiBEaXNwYXRjaGVzIHRocm91Z2ggdGhlIGNvbmZpZ3VyZWQgYXBwbHktaGFuZGxlciByZWdpc3RyeSBmaXJzdCAoY29tcGF0XG4gICAqIHByZWNlZGVuY2UpOyBtdXRhdGlvbnMgd2l0aG91dCBhIG1hdGNoaW5nIGhhbmRsZXIgZmFsbCB0aHJvdWdoIHRvXG4gICAqIHJlc291cmNlIHJvdXRpbmcgd2hlbiBhIGNvbmZpZ3VyYXRpb24gb3IgcmVzb3VyY2VUeXBlT3ZlcnJpZGVzIGFyZVxuICAgKiBjb25maWd1cmVkLCBhbmQgb3RoZXJ3aXNlIGZhaWwgbG91ZGx5LlxuICAgKiBAcGFyYW0ge3thY3RvcjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGNvbnRleHQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgZXhpc3RpbmdTeW5jOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgbXV0YXRpb246IGltcG9ydChcIi4vc3luYy1lbnZlbG9wZS1yZXBsYXktc2VydmljZS5qc1wiKS5TeW5jUmVwbGF5TXV0YXRpb259fSBhcmdzIC0gQWN0b3IsIGJhdGNoIGNvbnRleHQsIGV4aXN0aW5nIHN5bmMgcm93LCBhbmQgbXV0YXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gUHJvamVjdC1zcGVjaWZpYyBhcHBseSByZXN1bHQuXG4gICAqL1xuICBhc3luYyBhcHBseVJlcGxheU11dGF0aW9uKGFyZ3MpIHtcbiAgICBpZiAodGhpcy5hcHBseUhhbmRsZXJzKSB7XG4gICAgICBjb25zdCBhcHBseUhhbmRsZXIgPSB0aGlzLmFwcGx5SGFuZGxlcnNbYXJncy5tdXRhdGlvbi5yZXNvdXJjZVR5cGVdXG5cbiAgICAgIGlmIChhcHBseUhhbmRsZXIpIHJldHVybiBhd2FpdCBhcHBseUhhbmRsZXIoYXJncylcbiAgICAgIGlmICghdGhpcy5yb3V0aW5nQ29uZmlndXJlZCgpKSB0aHJvdyBuZXcgRXJyb3IoYE5vIHN5bmMgYXBwbHkgaGFuZGxlciByZWdpc3RlcmVkIGZvcjogJHthcmdzLm11dGF0aW9uLnJlc291cmNlVHlwZX1gKVxuICAgIH1cblxuICAgIGlmICh0aGlzLnJvdXRpbmdDb25maWd1cmVkKCkpIHJldHVybiBhd2FpdCB0aGlzLmFwcGx5Um91dGVkUmVwbGF5TXV0YXRpb24oYXJncylcblxuICAgIHJldHVybiBudWxsXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB3aGV0aGVyIHJlc291cmNlIHJvdXRpbmcgaXMgY29uZmlndXJlZCBvbiB0aGlzIHNlcnZpY2UuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSBXaGV0aGVyIG11dGF0aW9ucyByb3V0ZSB0byBmcm9udGVuZC1tb2RlbCByZXNvdXJjZXMuXG4gICAqL1xuICByb3V0aW5nQ29uZmlndXJlZCgpIHtcbiAgICByZXR1cm4gQm9vbGVhbih0aGlzLmNvbmZpZ3VyYXRpb24gfHwgdGhpcy5yZXNvdXJjZVR5cGVPdmVycmlkZXMpXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIHJvdXRlZCByZXNvdXJjZSByZWdpc3RyYXRpb24gZm9yIGEgcmVzb3VyY2UgdHlwZSwgbWVtb2l6ZWRcbiAgICogcGVyIHJlcGxheSBzZXJ2aWNlLiBPdmVycmlkZXMgd2luIG92ZXIgdGhlIGNvbmZpZ3VyYXRpb24gcmVnaXN0cnk7IHN0cmluZ1xuICAgKiBvdmVycmlkZXMgYXJlIGFsaWFzZXMgcmVzb2x2ZWQgdGhyb3VnaCB0aGUgcmVnaXN0cnkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZXNvdXJjZVR5cGUgLSBNdXRhdGlvbiByZXNvdXJjZSB0eXBlLlxuICAgKiBAcmV0dXJucyB7U3luY1JlcGxheVJlc291cmNlUmVnaXN0cmF0aW9uIHwgbnVsbH0gUmVzb2x2ZWQgcmVnaXN0cmF0aW9uIG9yIG51bGwgd2hlbiB1bnJvdXRhYmxlLlxuICAgKi9cbiAgcmVwbGF5UmVzb3VyY2VSZWdpc3RyYXRpb24ocmVzb3VyY2VUeXBlKSB7XG4gICAgY29uc3QgbWVtb2l6ZWRSZWdpc3RyYXRpb24gPSB0aGlzLl9yZXBsYXlSZXNvdXJjZVJlZ2lzdHJhdGlvbnMuZ2V0KHJlc291cmNlVHlwZSlcblxuICAgIGlmIChtZW1vaXplZFJlZ2lzdHJhdGlvbiAhPT0gdW5kZWZpbmVkKSByZXR1cm4gbWVtb2l6ZWRSZWdpc3RyYXRpb25cblxuICAgIGNvbnN0IHJlZ2lzdHJhdGlvbiA9IHRoaXMucmVzb2x2ZVJlcGxheVJlc291cmNlUmVnaXN0cmF0aW9uKHJlc291cmNlVHlwZSlcblxuICAgIHRoaXMuX3JlcGxheVJlc291cmNlUmVnaXN0cmF0aW9ucy5zZXQocmVzb3VyY2VUeXBlLCByZWdpc3RyYXRpb24pXG5cbiAgICByZXR1cm4gcmVnaXN0cmF0aW9uXG4gIH1cblxuICAvKipcbiAgICogVW5jYWNoZWQgcm91dGVkLXJlc291cmNlIHJlc29sdXRpb24gYmVoaW5kIHtAbGluayBTeW5jRW52ZWxvcGVSZXBsYXlTZXJ2aWNlI3JlcGxheVJlc291cmNlUmVnaXN0cmF0aW9ufS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJlc291cmNlVHlwZSAtIE11dGF0aW9uIHJlc291cmNlIHR5cGUuXG4gICAqIEByZXR1cm5zIHtTeW5jUmVwbGF5UmVzb3VyY2VSZWdpc3RyYXRpb24gfCBudWxsfSBSZXNvbHZlZCByZWdpc3RyYXRpb24gb3IgbnVsbCB3aGVuIHVucm91dGFibGUuXG4gICAqL1xuICByZXNvbHZlUmVwbGF5UmVzb3VyY2VSZWdpc3RyYXRpb24ocmVzb3VyY2VUeXBlKSB7XG4gICAgY29uc3Qgb3ZlcnJpZGUgPSB0aGlzLnJlc291cmNlVHlwZU92ZXJyaWRlcz8uW3Jlc291cmNlVHlwZV1cblxuICAgIGlmIChvdmVycmlkZSAmJiB0eXBlb2Ygb3ZlcnJpZGUgIT09IFwic3RyaW5nXCIpIHtcbiAgICAgIHJldHVybiB7bW9kZWxOYW1lOiByZXNvdXJjZVR5cGUsIHJlc291cmNlQ2xhc3M6IG92ZXJyaWRlLCByZXNvdXJjZUNvbmZpZ3VyYXRpb246IG51bGx9XG4gICAgfVxuXG4gICAgY29uc3QgcmVnaXN0cnlSZXNvdXJjZVR5cGUgPSB0eXBlb2Ygb3ZlcnJpZGUgPT09IFwic3RyaW5nXCIgPyBvdmVycmlkZSA6IHJlc291cmNlVHlwZVxuXG4gICAgaWYgKCF0aGlzLmNvbmZpZ3VyYXRpb24pIHJldHVybiBudWxsXG5cbiAgICBjb25zdCByZXNvbHZlZFJlZ2lzdHJhdGlvbiA9IHJlc29sdmVGcm9udGVuZE1vZGVsUmVzb3VyY2VDbGFzcyh7Y29uZmlndXJhdGlvbjogdGhpcy5jb25maWd1cmF0aW9uLCByZXNvdXJjZVR5cGU6IHJlZ2lzdHJ5UmVzb3VyY2VUeXBlfSlcblxuICAgIGlmICghcmVzb2x2ZWRSZWdpc3RyYXRpb24pIHJldHVybiBudWxsXG5cbiAgICByZXR1cm4ge1xuICAgICAgbW9kZWxOYW1lOiByZXNvbHZlZFJlZ2lzdHJhdGlvbi5tb2RlbE5hbWUsXG4gICAgICByZXNvdXJjZUNsYXNzOiByZXNvbHZlZFJlZ2lzdHJhdGlvbi5yZXNvdXJjZUNsYXNzLFxuICAgICAgcmVzb3VyY2VDb25maWd1cmF0aW9uOiByZXNvbHZlZFJlZ2lzdHJhdGlvbi5yZXNvdXJjZUNvbmZpZ3VyYXRpb25cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIGFiaWxpdHkgYW5kIHJlc291cmNlIGNvbnRleHQgdXNlZCB0byBhdXRob3JpemUgcm91dGVkXG4gICAqIHJlc291cmNlcy4gRGVmYXVsdHMgdG8gdGhlIGNvbnN0cnVjdG9yLXdpZGUgYWJpbGl0eS9hYmlsaXR5Q29udGV4dDtcbiAgICogc3ViY2xhc3NlcyAoc2lnbmVkIHJlcGxheSkgb3ZlcnJpZGUgdGhpcyB0byBkZXJpdmUgYXV0aG9yaXphdGlvbiBmcm9tIGFcbiAgICogdmVyaWZpZWQgYWN0b3IvZ3JhbnQgaW5zdGVhZCBvZiB1cGxvYWRlci1nbG9iYWwgc3RhdGUuXG4gICAqIEBwYXJhbSB7e2FjdG9yOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgY29udGV4dDogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fX0gX2FyZ3MgLSBSZXBsYXkgYWN0b3IgYW5kIGJhdGNoIGNvbnRleHQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHthYmlsaXR5OiBpbXBvcnQoXCIuLi9hdXRob3JpemF0aW9uL2FiaWxpdHkuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZCwgYWJpbGl0eUNvbnRleHQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0+fSBBYmlsaXR5IGFuZCByZXNvdXJjZSBjb250ZXh0LlxuICAgKi9cbiAgYXN5bmMgcmVwbGF5QWJpbGl0eUZvcihfYXJncykge1xuICAgIHJldHVybiB7YWJpbGl0eTogdGhpcy5hYmlsaXR5IHx8IHVuZGVmaW5lZCwgYWJpbGl0eUNvbnRleHQ6IHRoaXMuYWJpbGl0eUNvbnRleHQgfHwge319XG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIHRoZSByb3V0ZWQgcmVzb3VyY2UgaW5zdGFuY2UgaGFuZGxpbmcgb25lIG11dGF0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MuYWN0b3IgLSBSZXBsYXkgYWN0b3IuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmNvbnRleHQgLSBSZXBsYXkgY29udGV4dC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3N5bmMtZW52ZWxvcGUtcmVwbGF5LXNlcnZpY2UuanNcIikuU3luY1JlcGxheU11dGF0aW9ufSBhcmdzLm11dGF0aW9uIC0gTm9ybWFsaXplZCByZXBsYXkgbXV0YXRpb24uXG4gICAqIEBwYXJhbSB7U3luY1JlcGxheVJlc291cmNlUmVnaXN0cmF0aW9ufSBhcmdzLnJlZ2lzdHJhdGlvbiAtIFJlc29sdmVkIHJlc291cmNlIHJlZ2lzdHJhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWwtcmVzb3VyY2UvYmFzZS1yZXNvdXJjZS5qc1wiKS5kZWZhdWx0Pn0gUm91dGVkIHJlc291cmNlIGluc3RhbmNlLlxuICAgKi9cbiAgYXN5bmMgYnVpbGRSZXBsYXlSZXNvdXJjZSh7YWN0b3IsIGNvbnRleHQsIG11dGF0aW9uLCByZWdpc3RyYXRpb259KSB7XG4gICAgY29uc3QgUmVzb3VyY2VDbGFzcyA9IGZyb250ZW5kTW9kZWxSZXNvdXJjZUludGVybmFsQ29uc3RydWN0b3IocmVnaXN0cmF0aW9uLnJlc291cmNlQ2xhc3MpXG4gICAgY29uc3Qge2FiaWxpdHksIGFiaWxpdHlDb250ZXh0fSA9IGF3YWl0IHRoaXMucmVwbGF5QWJpbGl0eUZvcih7YWN0b3IsIGNvbnRleHR9KVxuXG4gICAgcmV0dXJuIG5ldyBSZXNvdXJjZUNsYXNzKHtcbiAgICAgIGFiaWxpdHksXG4gICAgICBjb250ZXh0OiBhYmlsaXR5Q29udGV4dCxcbiAgICAgIGxvY2Fsczogey4uLih0aGlzLmxvY2FscyB8fCB7fSksIC4uLih0aGlzLmNvbmZpZ3VyYXRpb24gPyB7Y29uZmlndXJhdGlvbjogdGhpcy5jb25maWd1cmF0aW9ufSA6IHt9KX0sXG4gICAgICBtb2RlbE5hbWU6IHJlZ2lzdHJhdGlvbi5tb2RlbE5hbWUsXG4gICAgICBwYXJhbXM6IG11dGF0aW9uLmRhdGEsXG4gICAgICAuLi4ocmVnaXN0cmF0aW9uLnJlc291cmNlQ29uZmlndXJhdGlvbiA/IHtyZXNvdXJjZUNvbmZpZ3VyYXRpb246IHJlZ2lzdHJhdGlvbi5yZXNvdXJjZUNvbmZpZ3VyYXRpb259IDoge30pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBsaWVzIG9uZSBtdXRhdGlvbiB0aHJvdWdoIGl0cyByb3V0ZWQgZnJvbnRlbmQtbW9kZWwgcmVzb3VyY2U6XG4gICAqIGF1dGhvcml6YXRpb24sIGFiaWxpdHktc2NvcGVkIHJlY29yZCBsb29rdXAsIHNjaGVtYSBub3JtYWxpemF0aW9uIGFuZFxuICAgKiBhc3NpZ24vc2F2ZSBmb3IgdXBkYXRlcywgc2F2ZS10aGVuLWNoZWNrIG1lbWJlcnNoaXAgY3JlYXRlcywgZGVzdHJveXMgZm9yXG4gICAqIGRlbGV0ZXMsIGFuZCB0aGUgcmVzb3VyY2UncyBhZnRlclN5bmNBcHBseSB0YWlsLiBDbGllbnQtc2FmZSBmYWlsdXJlc1xuICAgKiB0aHJvdyBzYWZlIGVycm9ycyB0aGF0IGZhaWwgdGhlIHNpbmdsZSBzeW5jLlxuICAgKiBAcGFyYW0ge3thY3RvcjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGNvbnRleHQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgZXhpc3RpbmdTeW5jOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgbXV0YXRpb246IGltcG9ydChcIi4vc3luYy1lbnZlbG9wZS1yZXBsYXktc2VydmljZS5qc1wiKS5TeW5jUmVwbGF5TXV0YXRpb259fSBhcmdzIC0gQWN0b3IsIGJhdGNoIGNvbnRleHQsIGV4aXN0aW5nIHN5bmMgcm93LCBhbmQgbXV0YXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IEFwcGx5IHJlc3VsdCB3aXRoIHJlY29yZCwgY3JlYXRlZC9kZWxldGVkIGZsYWdzLCBhbmQgYWZ0ZXJTeW5jQXBwbHkgZXh0cmFzLlxuICAgKi9cbiAgYXN5bmMgYXBwbHlSb3V0ZWRSZXBsYXlNdXRhdGlvbih7YWN0b3IsIGNvbnRleHQsIGV4aXN0aW5nU3luYywgbXV0YXRpb259KSB7XG4gICAgY29uc3QgcmVnaXN0cmF0aW9uID0gdGhpcy5yZXBsYXlSZXNvdXJjZVJlZ2lzdHJhdGlvbihtdXRhdGlvbi5yZXNvdXJjZVR5cGUpXG5cbiAgICBpZiAoIXJlZ2lzdHJhdGlvbikge1xuICAgICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShgVW5rbm93biBzeW5jIHJlc291cmNlIHR5cGU6ICR7bXV0YXRpb24ucmVzb3VyY2VUeXBlfS5gLCB7Y29kZTogXCJ1bmtub3duLXJlc291cmNlLXR5cGVcIn0pXG4gICAgfVxuXG4gICAgY29uc3QgcmVzb3VyY2UgPSBhd2FpdCB0aGlzLmJ1aWxkUmVwbGF5UmVzb3VyY2Uoe2FjdG9yLCBjb250ZXh0LCBtdXRhdGlvbiwgcmVnaXN0cmF0aW9ufSlcbiAgICBjb25zdCBjdXN0b21BcHBseVJlc3VsdCA9IGF3YWl0IHJlc291cmNlLmFwcGx5U3luYyh7Y29udGV4dCwgZXhpc3RpbmdTeW5jLCBtdXRhdGlvbn0pXG5cbiAgICBpZiAoY3VzdG9tQXBwbHlSZXN1bHQgIT09IG51bGwpIHJldHVybiBjdXN0b21BcHBseVJlc3VsdFxuXG4gICAgY29uc3QgYXV0aG9yaXphdGlvbiA9IGF3YWl0IHJlc291cmNlLmF1dGhvcml6ZVN5bmNNdXRhdGlvbih7Y29udGV4dCwgbXV0YXRpb259KVxuXG4gICAgaWYgKCFhdXRob3JpemF0aW9uLmFsbG93ZWQpIHtcbiAgICAgIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoYFN5bmMgbXV0YXRpb24gZGVuaWVkIGZvcjogJHttdXRhdGlvbi5yZXNvdXJjZVR5cGV9LmAsIHtjb2RlOiBhdXRob3JpemF0aW9uLnJlYXNvbiB8fCBcImFjY2Vzcy1kZW5pZWRcIn0pXG4gICAgfVxuXG4gICAgaWYgKG11dGF0aW9uLnN5bmNUeXBlID09PSBcImRlbGV0ZVwiKSByZXR1cm4gYXdhaXQgdGhpcy5hcHBseVJvdXRlZFJlcGxheURlbGV0ZSh7bXV0YXRpb24sIHJlc291cmNlfSlcblxuICAgIGNvbnN0IGNvbW1hbmRBcHBseVJlc3VsdCA9IGF3YWl0IHRoaXMuYXBwbHlSb3V0ZWRSZXBsYXlDb21tYW5kKHtjb250ZXh0LCBtdXRhdGlvbiwgcmVzb3VyY2V9KVxuXG4gICAgaWYgKGNvbW1hbmRBcHBseVJlc3VsdCAhPT0gbnVsbCkgcmV0dXJuIGNvbW1hbmRBcHBseVJlc3VsdFxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuYXBwbHlSb3V0ZWRSZXBsYXlVcHNlcnQoe2NvbnRleHQsIG11dGF0aW9uLCByZXNvdXJjZX0pXG4gIH1cblxuICAvKipcbiAgICogRGlzcGF0Y2hlcyBhIHJvdXRlZCBzeW5jIG11dGF0aW9uIHdob3NlIHN5bmNUeXBlIG1hdGNoZXMgYSByZXNvdXJjZS1kZWNsYXJlZFxuICAgKiBjdXN0b20gY29tbWFuZC4gUmV0dXJucyBudWxsIHdoZW4gdGhlIG11dGF0aW9uIGlzIG5vdCBhIGNvbW1hbmQgc28gdGhlXG4gICAqIGNhbGxlciBjYW4gZmFsbCB0aHJvdWdoIHRvIHRoZSBkZWZhdWx0IHVwc2VydCBwYXRoLlxuICAgKiBAcGFyYW0ge3tjb250ZXh0OiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIG11dGF0aW9uOiBpbXBvcnQoXCIuL3N5bmMtZW52ZWxvcGUtcmVwbGF5LXNlcnZpY2UuanNcIikuU3luY1JlcGxheU11dGF0aW9uLCByZXNvdXJjZTogaW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWwtcmVzb3VyY2UvYmFzZS1yZXNvdXJjZS5qc1wiKS5kZWZhdWx0fX0gYXJncyAtIENvbW1hbmQgZGlzcGF0Y2ggYXJncy5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgbnVsbD59IENvbW1hbmQgYXBwbHkgcmVzdWx0IG9yIG51bGwuXG4gICAqL1xuICBhc3luYyBhcHBseVJvdXRlZFJlcGxheUNvbW1hbmQoe2NvbnRleHQsIG11dGF0aW9uLCByZXNvdXJjZX0pIHtcbiAgICBjb25zdCBjb21tYW5kQ29uZmlnID0gdGhpcy5yZXNvdXJjZUNvbW1hbmRDb25maWcocmVzb3VyY2UpXG4gICAgY29uc3QgY29tbWFuZE1ldGhvZE5hbWUgPSB0aGlzLmNvbW1hbmRNZXRob2ROYW1lRm9yU3luY1R5cGUoe2NvbW1hbmRDb25maWcsIHN5bmNUeXBlOiBtdXRhdGlvbi5zeW5jVHlwZX0pXG5cbiAgICBpZiAoIWNvbW1hbmRNZXRob2ROYW1lKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgY29tbWFuZE1ldGhvZCA9IHJlc291cmNlLnJlc291cmNlTWV0aG9kKGNvbW1hbmRNZXRob2ROYW1lKVxuXG4gICAgaWYgKCFjb21tYW5kTWV0aG9kKSB7XG4gICAgICB0aHJvdyBWZWxvY2lvdXNFcnJvci5zYWZlKGBTeW5jIGNvbW1hbmQgaGFuZGxlciBtaXNzaW5nIGZvcjogJHttdXRhdGlvbi5yZXNvdXJjZVR5cGV9LiR7bXV0YXRpb24uc3luY1R5cGV9LmAsIHtjb2RlOiBcInN5bmMtY29tbWFuZC1oYW5kbGVyLW1pc3NpbmdcIn0pXG4gICAgfVxuXG4gICAgY29uc3QgYXJncyA9IHRoaXMuY29tbWFuZEFyZ3NGb3JNdXRhdGlvbih7Y29tbWFuZENvbmZpZywgY29tbWFuZE1ldGhvZE5hbWUsIG11dGF0aW9ufSlcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBjb21tYW5kTWV0aG9kLm1ldGhvZC5jYWxsKGNvbW1hbmRNZXRob2QucmVzb3VyY2UsIGFyZ3MpXG5cbiAgICBjb25zdCBhZnRlckV4dHJhcyA9IGF3YWl0IHJlc291cmNlLmFmdGVyU3luY0FwcGx5KHtjb250ZXh0LCBjcmVhdGVkOiBmYWxzZSwgbXV0YXRpb24sIHJlY29yZDogbnVsbH0pXG4gICAgY29uc3QgcmVzdWx0T2JqZWN0ID0gcmVzdWx0ICYmIHR5cGVvZiByZXN1bHQgPT09IFwib2JqZWN0XCIgJiYgIUFycmF5LmlzQXJyYXkocmVzdWx0KSA/IHJlc3VsdCA6IHt9XG5cbiAgICByZXR1cm4ge2NvbW1hbmRSZXN1bHQ6IHJlc3VsdCwgY3JlYXRlZDogZmFsc2UsIGRlbGV0ZWQ6IGZhbHNlLCByZWNvcmQ6IG51bGwsIC4uLnJlc3VsdE9iamVjdCwgLi4uYWZ0ZXJFeHRyYXN9XG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIGN1c3RvbS1jb21tYW5kIGNvbmZpZ3VyYXRpb24gZGVjbGFyZWQgb24gYSByb3V0ZWQgcmVzb3VyY2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWwtcmVzb3VyY2UvYmFzZS1yZXNvdXJjZS5qc1wiKS5kZWZhdWx0fSByZXNvdXJjZSAtIFJvdXRlZCByZXNvdXJjZSBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge3tjb2xsZWN0aW9uQ29tbWFuZHM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4sIG1lbWJlckNvbW1hbmRzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+fX0gQ29tbWFuZCBjb25maWcuXG4gICAqL1xuICByZXNvdXJjZUNvbW1hbmRDb25maWcocmVzb3VyY2UpIHtcbiAgICBjb25zdCBjb25maWcgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHJlc291cmNlLnJlc291cmNlQ29uZmlndXJhdGlvblZhbHVlIHx8IHt9KVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGNvbGxlY3Rpb25Db21tYW5kczogY29uZmlnLmNvbGxlY3Rpb25Db21tYW5kcyB8fCB7fSxcbiAgICAgIG1lbWJlckNvbW1hbmRzOiBjb25maWcubWVtYmVyQ29tbWFuZHMgfHwge31cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIHJlc291cmNlIG1ldGhvZCBuYW1lIGZvciBhIHN5bmNUeXBlIHdoZW4gaXQgbmFtZXMgYSBkZWNsYXJlZFxuICAgKiBjdXN0b20gY29tbWFuZC5cbiAgICogQHBhcmFtIHt7Y29tbWFuZENvbmZpZzoge2NvbGxlY3Rpb25Db21tYW5kczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiwgbWVtYmVyQ29tbWFuZHM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz59LCBzeW5jVHlwZTogc3RyaW5nfX0gYXJncyAtIExvb2t1cCBhcmdzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVsbH0gTWV0aG9kIG5hbWUgb3IgbnVsbC5cbiAgICovXG4gIGNvbW1hbmRNZXRob2ROYW1lRm9yU3luY1R5cGUoe2NvbW1hbmRDb25maWcsIHN5bmNUeXBlfSkge1xuICAgIGlmIChjb21tYW5kQ29uZmlnLm1lbWJlckNvbW1hbmRzW3N5bmNUeXBlXSkgcmV0dXJuIHN5bmNUeXBlXG4gICAgaWYgKGNvbW1hbmRDb25maWcuY29sbGVjdGlvbkNvbW1hbmRzW3N5bmNUeXBlXSkgcmV0dXJuIHN5bmNUeXBlXG5cbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyB0aGUgYXJndW1lbnRzIG9iamVjdCBwYXNzZWQgdG8gYSByZXNvdXJjZSBjb21tYW5kIG1ldGhvZC4gTWVtYmVyXG4gICAqIGNvbW1hbmRzIHJlY2VpdmUgdGhlIGVudmVsb3BlJ3MgcmVzb3VyY2VJZCBhcyBgaWRgOyB0aGUgZW52ZWxvcGUgaWRlbnRpdHlcbiAgICogaXMgYXNzaWduZWQgYWZ0ZXIgdGhlIHBheWxvYWQgc28gYSBwYXlsb2FkIGBpZGAgY2FuIG5ldmVyIHJldGFyZ2V0IHRoZVxuICAgKiBjb21tYW5kIGF3YXkgZnJvbSB0aGUgcmVzb3VyY2UgdGhlIGF1dGhvcml6YXRpb24gaG9va3MgYXBwcm92ZWQuXG4gICAqIEBwYXJhbSB7e2NvbW1hbmRDb25maWc6IHtjb2xsZWN0aW9uQ29tbWFuZHM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4sIG1lbWJlckNvbW1hbmRzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+fSwgY29tbWFuZE1ldGhvZE5hbWU6IHN0cmluZywgbXV0YXRpb246IGltcG9ydChcIi4vc3luYy1lbnZlbG9wZS1yZXBsYXktc2VydmljZS5qc1wiKS5TeW5jUmVwbGF5TXV0YXRpb259fSBhcmdzIC0gQXJncyBidWlsZGVyIGFyZ3MuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IENvbW1hbmQgbWV0aG9kIGFyZ3VtZW50cy5cbiAgICovXG4gIGNvbW1hbmRBcmdzRm9yTXV0YXRpb24oe2NvbW1hbmRDb25maWcsIGNvbW1hbmRNZXRob2ROYW1lLCBtdXRhdGlvbn0pIHtcbiAgICBjb25zdCBpc01lbWJlciA9IGNvbW1hbmRDb25maWcubWVtYmVyQ29tbWFuZHNbY29tbWFuZE1ldGhvZE5hbWVdICE9PSB1bmRlZmluZWRcblxuICAgIGlmIChpc01lbWJlcikge1xuICAgICAgcmV0dXJuIHsuLi5tdXRhdGlvbi5kYXRhLCBpZDogbXV0YXRpb24ucmVzb3VyY2VJZH1cbiAgICB9XG5cbiAgICByZXR1cm4gey4uLm11dGF0aW9uLmRhdGF9XG4gIH1cblxuICAvKipcbiAgICogQXBwbGllcyBhIHJvdXRlZCBkZWxldGUgbXV0YXRpb24uIFRoZSByZWNvcmQgaXMgbWFya2VkIGFzIGEgc2VydmVyIGFwcGx5XG4gICAqIGZvciB0aGUgZHVyYXRpb24gb2YgdGhlIHJlcGxheS1vd25lZCBkZXN0cm95IC0gYW4gYWN0aXZlIFN5bmNQdWJsaXNoZXJcbiAgICogbmV2ZXIgcHVibGlzaGVzIHRoZSByZXBsYXllZCBkZWxldGUgYSBzZWNvbmQgdGltZSAodGhlIHJlcGxheSBvd25zIGl0c1xuICAgKiBvd24gcGVyc2lzdCBhbmQgYnJvYWRjYXN0cyksIHdoaWxlIGxhdGVyIHNlcnZlci1zaWRlIHdyaXRlcyB0byB0aGUgc2FtZVxuICAgKiBpbnN0YW5jZSBwdWJsaXNoIG5vcm1hbGx5IGFnYWluLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9zeW5jLWVudmVsb3BlLXJlcGxheS1zZXJ2aWNlLmpzXCIpLlN5bmNSZXBsYXlNdXRhdGlvbn0gYXJncy5tdXRhdGlvbiAtIE5vcm1hbGl6ZWQgcmVwbGF5IG11dGF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVsLXJlc291cmNlL2Jhc2UtcmVzb3VyY2UuanNcIikuZGVmYXVsdH0gYXJncy5yZXNvdXJjZSAtIFJvdXRlZCByZXNvdXJjZSBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gQXBwbHkgcmVzdWx0IHdpdGggdGhlIGRlbGV0ZWQgZmxhZy5cbiAgICovXG4gIGFzeW5jIGFwcGx5Um91dGVkUmVwbGF5RGVsZXRlKHttdXRhdGlvbiwgcmVzb3VyY2V9KSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IHJlc291cmNlLm1vZGVsQ2xhc3MoKVxuICAgIGNvbnN0IHJ1bkRlbGV0ZSA9IGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlY29yZCA9IGF3YWl0IHJlc291cmNlLmZpbmRTeW5jUmVjb3JkKHtmb3JEZWxldGU6IHRydWUsIG11dGF0aW9ufSlcblxuICAgICAgaWYgKCFyZWNvcmQpIHJldHVybiB7Y3JlYXRlZDogZmFsc2UsIGRlbGV0ZWQ6IGZhbHNlLCByZWNvcmQ6IG51bGx9XG5cbiAgICAgIGNvbnN0IGNvbmZsaWN0UmVzdWx0ID0gYXdhaXQgdGhpcy5yb3V0ZWRSZXBsYXlDb25mbGljdFJlc3VsdCh7YXR0cmlidXRlczoge30sIGV4aXN0aW5nUmVjb3JkOiByZWNvcmQsIG11dGF0aW9uLCByZXNvdXJjZX0pXG5cbiAgICAgIGlmIChjb25mbGljdFJlc3VsdCkgcmV0dXJuIGNvbmZsaWN0UmVzdWx0XG5cbiAgICAgIGNvbnN0IHJlbGVhc2VTZXJ2ZXJBcHBseSA9IG1hcmtTZXJ2ZXJBcHBseShyZWNvcmQpXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHJlY29yZC5kZXN0cm95KClcbiAgICAgIH0gZmluYWxseSB7XG4gICAgICAgIHJlbGVhc2VTZXJ2ZXJBcHBseSgpXG4gICAgICB9XG5cbiAgICAgIHJldHVybiB7Y3JlYXRlZDogZmFsc2UsIGRlbGV0ZWQ6IHRydWUsIHJlY29yZH1cbiAgICB9XG5cbiAgICBpZiAoIXRoaXMuY29uZmxpY3RTdHJhdGVneSkgcmV0dXJuIGF3YWl0IHJ1bkRlbGV0ZSgpXG5cbiAgICByZXR1cm4gYXdhaXQgTW9kZWxDbGFzcy53aXRoQWR2aXNvcnlMb2NrKHN5bmNSZXBsYXlDb25mbGljdExvY2tOYW1lKHtyZXNvdXJjZUlkOiBtdXRhdGlvbi5yZXNvdXJjZUlkLCByZXNvdXJjZVR5cGU6IG11dGF0aW9uLnJlc291cmNlVHlwZX0pLCBydW5EZWxldGUsIHtkZWRpY2F0ZWRDb25uZWN0aW9uOiB0cnVlfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBsaWVzIGEgcm91dGVkIHVwc2VydCBtdXRhdGlvbjogcGVybWl0dGVkIHBheWxvYWQgYXR0cmlidXRlcyBhcmVcbiAgICogYXNzaWduZWQgYW5kIHNhdmVkIG9udG8gdGhlIGZvdW5kIHJlY29yZCAodGhlIHJlY29yZCBsYXllciBvd25zIHZhbHVlXG4gICAqIGNhc3RpbmcgYW5kIHZhbGlkYXRpb24pLCBhbmQgbWlzc2luZyByZWNvcmRzIGFyZSBjcmVhdGVkIHdpdGggdGhlXG4gICAqIGNsaWVudC1nZW5lcmF0ZWQgcHJpbWFyeSBrZXkgcGx1cyBhIHNhdmUtdGhlbi1jaGVjayBtZW1iZXJzaGlwIGNoZWNrLlxuICAgKiBXcml0dGVuIHJlY29yZHMgYXJlIG1hcmtlZCBhcyBzZXJ2ZXIgYXBwbGllcyBmb3IgdGhlIGR1cmF0aW9uIG9mIHRoZVxuICAgKiByZXBsYXktb3duZWQgd3JpdGUgLSBhbiBhY3RpdmUgU3luY1B1Ymxpc2hlciBuZXZlciBwdWJsaXNoZXMgdGhlIHJlcGxheWVkXG4gICAqIG11dGF0aW9uIGEgc2Vjb25kIHRpbWUgKHRoZSByZXBsYXkgb3ducyBpdHMgb3duIHBlcnNpc3QgYW5kIGJyb2FkY2FzdHMpLFxuICAgKiB3aGlsZSBsYXRlciBzZXJ2ZXItc2lkZSB3cml0ZXMgdG8gdGhlIHNhbWUgaW5zdGFuY2UgcHVibGlzaCBub3JtYWxseVxuICAgKiBhZ2Fpbi4gTW9kZWwgdmFsaWRhdGlvbiBmYWlsdXJlcyBiZWNvbWUgY2xpZW50LXNhZmUgcGVyLXN5bmMgZmFpbHVyZXNcbiAgICogY2FycnlpbmcgdGhlIHRyYW5zbGF0ZWQgdmFsaWRhdGlvbiBtZXNzYWdlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmNvbnRleHQgLSBSZXBsYXkgY29udGV4dC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3N5bmMtZW52ZWxvcGUtcmVwbGF5LXNlcnZpY2UuanNcIikuU3luY1JlcGxheU11dGF0aW9ufSBhcmdzLm11dGF0aW9uIC0gTm9ybWFsaXplZCByZXBsYXkgbXV0YXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWwtcmVzb3VyY2UvYmFzZS1yZXNvdXJjZS5qc1wiKS5kZWZhdWx0fSBhcmdzLnJlc291cmNlIC0gUm91dGVkIHJlc291cmNlIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSBBcHBseSByZXN1bHQgd2l0aCByZWNvcmQsIGNyZWF0ZWQgZmxhZywgYW5kIGFmdGVyU3luY0FwcGx5IGV4dHJhcy5cbiAgICovXG4gIGFzeW5jIGFwcGx5Um91dGVkUmVwbGF5VXBzZXJ0KHtjb250ZXh0LCBtdXRhdGlvbiwgcmVzb3VyY2V9KSB7XG4gICAgY29uc3QgYXR0cmlidXRlcyA9IHRoaXMucGVybWl0dGVkUm91dGVkQXR0cmlidXRlcyh7bXV0YXRpb24sIHJlc291cmNlfSlcbiAgICBjb25zdCBNb2RlbENsYXNzID0gcmVzb3VyY2UubW9kZWxDbGFzcygpXG4gICAgY29uc3QgcnVuVXBzZXJ0ID0gYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgZXhpc3RpbmdSZWNvcmQgPSBhd2FpdCByZXNvdXJjZS5maW5kU3luY1JlY29yZCh7bXV0YXRpb259KVxuICAgICAgY29uc3QgY29uZmxpY3RSZXN1bHQgPSBhd2FpdCB0aGlzLnJvdXRlZFJlcGxheUNvbmZsaWN0UmVzdWx0KHthdHRyaWJ1dGVzLCBleGlzdGluZ1JlY29yZCwgbXV0YXRpb24sIHJlc291cmNlfSlcblxuICAgICAgaWYgKGNvbmZsaWN0UmVzdWx0KSByZXR1cm4gY29uZmxpY3RSZXN1bHRcblxuICAgICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdCB8IG51bGx9ICovXG4gICAgICBsZXQgcmVjb3JkID0gZXhpc3RpbmdSZWNvcmRcbiAgICAgIGxldCBjcmVhdGVkID0gZmFsc2VcblxuICAgICAgaWYgKGV4aXN0aW5nUmVjb3JkKSB7XG4gICAgICAgIGNvbnN0IHJlbGVhc2VTZXJ2ZXJBcHBseSA9IG1hcmtTZXJ2ZXJBcHBseShleGlzdGluZ1JlY29yZClcblxuICAgICAgICB0cnkge1xuICAgICAgICAgIGV4aXN0aW5nUmVjb3JkLmFzc2lnbihhdHRyaWJ1dGVzKVxuICAgICAgICAgIGF3YWl0IHRoaXMuc2F2ZVJvdXRlZFJlcGxheVJlY29yZChleGlzdGluZ1JlY29yZClcbiAgICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgICByZWxlYXNlU2VydmVyQXBwbHkoKVxuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZWNvcmQgPSBhd2FpdCB0aGlzLmNyZWF0ZVJvdXRlZFJlcGxheVJlY29yZCh7YXR0cmlidXRlcywgbXV0YXRpb24sIHJlc291cmNlfSlcbiAgICAgICAgY3JlYXRlZCA9IHRydWVcbiAgICAgIH1cblxuICAgICAgY29uc3QgZXh0cmFzID0gYXdhaXQgcmVzb3VyY2UuYWZ0ZXJTeW5jQXBwbHkoe2NvbnRleHQsIGNyZWF0ZWQsIG11dGF0aW9uLCByZWNvcmR9KVxuXG4gICAgICByZXR1cm4ge2NyZWF0ZWQsIGRlbGV0ZWQ6IGZhbHNlLCByZWNvcmQsIC4uLmV4dHJhc31cbiAgICB9XG5cbiAgICBpZiAoIXRoaXMuY29uZmxpY3RTdHJhdGVneSkgcmV0dXJuIGF3YWl0IHJ1blVwc2VydCgpXG5cbiAgICByZXR1cm4gYXdhaXQgTW9kZWxDbGFzcy53aXRoQWR2aXNvcnlMb2NrKHN5bmNSZXBsYXlDb25mbGljdExvY2tOYW1lKHtyZXNvdXJjZUlkOiBtdXRhdGlvbi5yZXNvdXJjZUlkLCByZXNvdXJjZVR5cGU6IG11dGF0aW9uLnJlc291cmNlVHlwZX0pLCBydW5VcHNlcnQsIHtkZWRpY2F0ZWRDb25uZWN0aW9uOiB0cnVlfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVja3Mgd2hldGhlciBhIHJvdXRlZCB1cHNlcnQgbXV0YXRpb24gY29uZmxpY3RzIHdpdGggdGhlIGN1cnJlbnQgc2VydmVyXG4gICAqIHN0YXRlIHdoZW4gdGhlIHNlcnZpY2UgaXMgY29uZmlndXJlZCB3aXRoIGEgY29uZmxpY3Qgc3RyYXRlZ3kuIEEgbXV0YXRpb25cbiAgICogd2hvc2UgYmFzZVZlcnNpb24gZG9lcyBub3QgbWF0Y2ggdGhlIHNlcnZlcidzIGN1cnJlbnQgdmVyc2lvbkF0dHJpYnV0ZSBpc1xuICAgKiByZWplY3RlZCB3aXRoIGEgc3RydWN0dXJlZCBjb25mbGljdCBwYXlsb2FkIGluc3RlYWQgb2YgYmVpbmcgYXBwbGllZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBDb25mbGljdC1jaGVjayBhcmdzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5hdHRyaWJ1dGVzIC0gUGVybWl0dGVkIG11dGF0aW9uIGF0dHJpYnV0ZXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQgfCBudWxsfSBhcmdzLmV4aXN0aW5nUmVjb3JkIC0gRXhpc3Rpbmcgc2VydmVyIHJlY29yZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3N5bmMtZW52ZWxvcGUtcmVwbGF5LXNlcnZpY2UuanNcIikuU3luY1JlcGxheU11dGF0aW9ufSBhcmdzLm11dGF0aW9uIC0gTm9ybWFsaXplZCByZXBsYXkgbXV0YXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWwtcmVzb3VyY2UvYmFzZS1yZXNvdXJjZS5qc1wiKS5kZWZhdWx0fSBhcmdzLnJlc291cmNlIC0gUm91dGVkIHJlc291cmNlIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBudWxsPn0gLSBDb25mbGljdCBhcHBseSByZXN1bHQsIG9yIG51bGwgd2hlbiBubyBjb25mbGljdC5cbiAgICovXG4gIGFzeW5jIHJvdXRlZFJlcGxheUNvbmZsaWN0UmVzdWx0KHthdHRyaWJ1dGVzLCBleGlzdGluZ1JlY29yZCwgbXV0YXRpb24sIHJlc291cmNlfSkge1xuICAgIGlmICghdGhpcy5jb25mbGljdFN0cmF0ZWd5KSByZXR1cm4gbnVsbFxuICAgIGlmICghZXhpc3RpbmdSZWNvcmQgfHwgbXV0YXRpb24uc3luY1R5cGUgPT09IFwiY3JlYXRlXCIpIHJldHVybiBudWxsXG4gICAgaWYgKG11dGF0aW9uLmJhc2VWZXJzaW9uID09PSB1bmRlZmluZWQgfHwgbXV0YXRpb24uYmFzZVZlcnNpb24gPT09IG51bGwpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCBNb2RlbENsYXNzID0gcmVzb3VyY2UubW9kZWxDbGFzcygpXG4gICAgY29uc3QgcHJpbWFyeUtleSA9IHNjYWxhck1vZGVsUHJpbWFyeUtleShNb2RlbENsYXNzLnByaW1hcnlLZXkoKSwgYE9mZmxpbmUgc3luYyBjb25mbGljdCBoYW5kbGluZyBmb3IgJHtNb2RlbENsYXNzLm5hbWV9YClcbiAgICBjb25zdCBwcmltYXJ5S2V5QXR0cmlidXRlID0gTW9kZWxDbGFzcy5yZXNvbHZlQXR0cmlidXRlTmFtZShwcmltYXJ5S2V5KVxuICAgIGNvbnN0IHZlcnNpb25BdHRyaWJ1dGUgPSB0aGlzLmNvbmZsaWN0U3RyYXRlZ3kudmVyc2lvbkF0dHJpYnV0ZVxuICAgIGNvbnN0IHZlcnNpb25BdHRyaWJ1dGVOYW1lID0gTW9kZWxDbGFzcy5yZXNvbHZlQXR0cmlidXRlTmFtZSh2ZXJzaW9uQXR0cmlidXRlKVxuXG4gICAgaWYgKCFwcmltYXJ5S2V5QXR0cmlidXRlKSB0aHJvdyBuZXcgRXJyb3IoYENvdWxkbid0IHJlc29sdmUgcHJpbWFyeSBrZXkgYXR0cmlidXRlOiAke3ByaW1hcnlLZXl9YClcbiAgICBpZiAoIXZlcnNpb25BdHRyaWJ1dGVOYW1lKSB0aHJvdyBuZXcgRXJyb3IoYENvdWxkbid0IHJlc29sdmUgdmVyc2lvbiBhdHRyaWJ1dGU6ICR7dmVyc2lvbkF0dHJpYnV0ZX1gKVxuXG4gICAgY29uc3Qgc2VydmVyVmVyc2lvbiA9IG5vcm1hbGl6ZUNvbmZsaWN0VmFsdWUoZXhpc3RpbmdSZWNvcmQucmVhZEF0dHJpYnV0ZSh2ZXJzaW9uQXR0cmlidXRlTmFtZSkpXG5cbiAgICBpZiAoc3RhYmxlSnNvblN0cmluZ2lmeShzZXJ2ZXJWZXJzaW9uKSA9PT0gc3RhYmxlSnNvblN0cmluZ2lmeShtdXRhdGlvbi5iYXNlVmVyc2lvbikpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCBzZXJpYWxpemVkQWZmZWN0ZWRBdHRyaWJ1dGVzID0gYXdhaXQgdGhpcy5zZXJpYWxpemVkUm91dGVkQ29uZmxpY3RBdHRyaWJ1dGVzKHthdHRyaWJ1dGVzLCBleGlzdGluZ1JlY29yZCwgcmVzb3VyY2V9KVxuICAgIGNvbnN0IHNlcnZlckF0dHJpYnV0ZXMgPSB7XG4gICAgICAuLi5zZXJpYWxpemVkQWZmZWN0ZWRBdHRyaWJ1dGVzLFxuICAgICAgW3ByaW1hcnlLZXlBdHRyaWJ1dGVdOiBleGlzdGluZ1JlY29yZC5yZWFkQXR0cmlidXRlKHByaW1hcnlLZXlBdHRyaWJ1dGUpLFxuICAgICAgW3ZlcnNpb25BdHRyaWJ1dGVOYW1lXTogc2VydmVyVmVyc2lvblxuICAgIH1cblxuICAgIGNvbnN0IHNlcnZlclJlY29yZCA9IHtcbiAgICAgIGF0dHJpYnV0ZXM6IHNlcnZlckF0dHJpYnV0ZXMsXG4gICAgICB2ZXJzaW9uOiBzZXJ2ZXJWZXJzaW9uXG4gICAgfVxuICAgIGNvbnN0IGNvbmZsaWN0TXV0YXRpb24gPSAvKiogQHR5cGUge2ltcG9ydChcIi4vZGV2aWNlLWlkZW50aXR5LmpzXCIpLlN5bmNNdXRhdGlvbn0gKi8gKC8qKiBAdHlwZSB7dW5rbm93bn0gKi8gKHtcbiAgICAgIGF0dHJpYnV0ZXMsXG4gICAgICBiYXNlVmVyc2lvbjogbXV0YXRpb24uYmFzZVZlcnNpb24sXG4gICAgICBjbGllbnRNdXRhdGlvbklkOiBtdXRhdGlvbi5jbGllbnRNdXRhdGlvbklkIHx8IG11dGF0aW9uLmlkLFxuICAgICAgbW9kZWw6IG11dGF0aW9uLnJlc291cmNlVHlwZSxcbiAgICAgIG9wZXJhdGlvbjogbXV0YXRpb24uc3luY1R5cGUsXG4gICAgICBwYXlsb2FkOiB7aWQ6IG11dGF0aW9uLnJlc291cmNlSWR9XG4gICAgfSkpXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgcmVzb2x2ZVN5bmNDb25mbGljdCh7XG4gICAgICBiYXNlUmVjb3JkOiBudWxsLFxuICAgICAgbXV0YXRpb246IGNvbmZsaWN0TXV0YXRpb24sXG4gICAgICBzZXJ2ZXJSZWNvcmQsXG4gICAgICBzdHJhdGVneTogdGhpcy5jb25mbGljdFN0cmF0ZWd5LnN0cmF0ZWd5IHx8IFwib3B0aW1pc3RpY1ZlcnNpb25cIixcbiAgICAgIHZlcnNpb25BdHRyaWJ1dGVcbiAgICB9KVxuXG4gICAgaWYgKHJlc3VsdC5zdGF0dXMgIT09IFwiY29uZmxpY3RcIikgcmV0dXJuIG51bGxcblxuICAgIHJldHVybiB7Y29uZmxpY3Q6IHJlc3VsdC5jb25mbGljdCwgY3JlYXRlZDogZmFsc2UsIGRlbGV0ZWQ6IGZhbHNlLCByZWNvcmQ6IGV4aXN0aW5nUmVjb3JkLCBzdGF0dXM6IFwiY29uZmxpY3RcIn1cbiAgfVxuXG4gIC8qKlxuICAgKiBQcm9qZWN0cyBhZmZlY3RlZCBtdXRhdGlvbiBmaWVsZHMgdGhyb3VnaCB0aGUgcmVzb3VyY2UncyByZWFkYWJsZVxuICAgKiBhdHRyaWJ1dGUgY29udHJhY3QuIFdyaXRhYmxlLWJ1dC1oaWRkZW4gZmllbGRzIGFyZSBvbWl0dGVkLCB3aGlsZSBjdXN0b21cbiAgICogYDxhdHRyaWJ1dGU+QXR0cmlidXRlKG1vZGVsKWAgc2VyaWFsaXplcnMgYW5kIG1vZGVsIGFjY2Vzc29ycyByZW1haW4gdGhlXG4gICAqIHNvdXJjZSBvZiBmcm9udGVuZC12aXNpYmxlIHZhbHVlcyAoRGF0ZSB2YWx1ZXMgYXJlIGtlcHQgcmF3IHNvIHRoZSBub3JtYWxcbiAgICogZnJvbnRlbmQtbW9kZWwgdHJhbnNwb3J0IHNlcmlhbGl6ZXIgY2FuIGVtaXQgaXRzIGRhdGUgbWFya2VyKS4gUHJvamVjdGVkXG4gICAqIGtleXMgdXNlIGNhbm9uaWNhbCBtb2RlbCBhdHRyaWJ1dGUgbmFtZXMgZXZlbiB3aGVuIHRoZSBtdXRhdGlvbiB1c2VkIGFcbiAgICogZGF0YWJhc2UtY29sdW1uIGFsaWFzLiBUaGUgZnVsbCBtb2RlbCBhdHRyaWJ1dGUgaGFzaCBpcyBuZXZlciBleHBvc2VkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFByb2plY3Rpb24gYXJncy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3MuYXR0cmlidXRlcyAtIFBlcm1pdHRlZCBhZmZlY3RlZCBtdXRhdGlvbiBhdHRyaWJ1dGVzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLmV4aXN0aW5nUmVjb3JkIC0gQXV0aG9yaXplZCBzZXJ2ZXIgcmVjb3JkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVsLXJlc291cmNlL2Jhc2UtcmVzb3VyY2UuanNcIikuZGVmYXVsdH0gYXJncy5yZXNvdXJjZSAtIFJvdXRlZCByZXNvdXJjZSBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gU2VyaWFsaXplZCByZWFkYWJsZSBhZmZlY3RlZCBhdHRyaWJ1dGVzLlxuICAgKi9cbiAgYXN5bmMgc2VyaWFsaXplZFJvdXRlZENvbmZsaWN0QXR0cmlidXRlcyh7YXR0cmlidXRlcywgZXhpc3RpbmdSZWNvcmQsIHJlc291cmNlfSkge1xuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSByZXNvdXJjZS5tb2RlbENsYXNzKClcbiAgICBjb25zdCBSZXNvdXJjZUNsYXNzID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxSZXNvdXJjZUNsYXNzVHlwZX0gKi8gKHJlc291cmNlLmNvbnN0cnVjdG9yKVxuICAgIGNvbnN0IHJlYWRhYmxlQXR0cmlidXRlcyA9IG5ldyBTZXQoKVxuICAgIGNvbnN0IGNvbmZpZ3VyZWRBdHRyaWJ1dGVzID0gUmVzb3VyY2VDbGFzcy5yZXNvdXJjZUNvbmZpZygpLmF0dHJpYnV0ZXNcbiAgICBjb25zdCBjb25maWd1cmVkRW50cmllcyA9IEFycmF5LmlzQXJyYXkoY29uZmlndXJlZEF0dHJpYnV0ZXMpID8gY29uZmlndXJlZEF0dHJpYnV0ZXMgOiBPYmplY3Qua2V5cyhjb25maWd1cmVkQXR0cmlidXRlcylcblxuICAgIGlmIChjb25maWd1cmVkRW50cmllcy5sZW5ndGggPT09IDApIHtcbiAgICAgIGNvbnN0IGF0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWUgPSBNb2RlbENsYXNzLmdldEF0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWVNYXAoKVxuXG4gICAgICBmb3IgKGNvbnN0IGF0dHJpYnV0ZU5hbWUgb2YgT2JqZWN0LmtleXMoYXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZSkpIHtcbiAgICAgICAgcmVhZGFibGVBdHRyaWJ1dGVzLmFkZChhdHRyaWJ1dGVOYW1lKVxuICAgICAgfVxuICAgIH1cblxuICAgIGZvciAoY29uc3QgY29uZmlndXJlZEF0dHJpYnV0ZSBvZiBjb25maWd1cmVkRW50cmllcykge1xuICAgICAgY29uc3QgY29uZmlndXJlZE5hbWUgPSB0eXBlb2YgY29uZmlndXJlZEF0dHJpYnV0ZSA9PT0gXCJzdHJpbmdcIiA/IGNvbmZpZ3VyZWRBdHRyaWJ1dGUgOiBjb25maWd1cmVkQXR0cmlidXRlLm5hbWVcblxuICAgICAgaWYgKCFjb25maWd1cmVkTmFtZSkgY29udGludWVcblxuICAgICAgY29uc3QgY2Fub25pY2FsTmFtZSA9IE1vZGVsQ2xhc3MucmVzb2x2ZUF0dHJpYnV0ZU5hbWUoY29uZmlndXJlZE5hbWUpXG5cbiAgICAgIHJlYWRhYmxlQXR0cmlidXRlcy5hZGQoY2Fub25pY2FsTmFtZSB8fCBjb25maWd1cmVkTmFtZSlcbiAgICB9XG5cbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCBzZXJpYWxpemVkQXR0cmlidXRlcyA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IGFmZmVjdGVkRmllbGQgb2YgT2JqZWN0LmtleXMoYXR0cmlidXRlcykpIHtcbiAgICAgIGNvbnN0IGF0dHJpYnV0ZU5hbWUgPSBNb2RlbENsYXNzLnJlc29sdmVBdHRyaWJ1dGVOYW1lKGFmZmVjdGVkRmllbGQpXG5cbiAgICAgIGlmICghYXR0cmlidXRlTmFtZSB8fCAhcmVhZGFibGVBdHRyaWJ1dGVzLmhhcyhhdHRyaWJ1dGVOYW1lKSkgY29udGludWVcblxuICAgICAgY29uc3QgcmVzb3VyY2VBdHRyaWJ1dGUgPSByZXNvdXJjZS5yZXNvdXJjZU1ldGhvZChgJHthdHRyaWJ1dGVOYW1lfUF0dHJpYnV0ZWApXG5cbiAgICAgIGlmIChyZXNvdXJjZUF0dHJpYnV0ZSkge1xuICAgICAgICBzZXJpYWxpemVkQXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXSA9IGF3YWl0IHJlc291cmNlQXR0cmlidXRlLm1ldGhvZC5jYWxsKHJlc291cmNlQXR0cmlidXRlLnJlc291cmNlLCBleGlzdGluZ1JlY29yZClcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgY29uc3QgcmVjb3JkTWV0aG9kcyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoLyoqIEB0eXBlIHt1bmtub3dufSAqLyAoZXhpc3RpbmdSZWNvcmQpKVxuICAgICAgY29uc3QgYXR0cmlidXRlTWV0aG9kID0gcmVjb3JkTWV0aG9kc1thdHRyaWJ1dGVOYW1lXVxuXG4gICAgICBpZiAodHlwZW9mIGF0dHJpYnV0ZU1ldGhvZCA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgIHNlcmlhbGl6ZWRBdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdID0gYXdhaXQgYXR0cmlidXRlTWV0aG9kLmNhbGwoZXhpc3RpbmdSZWNvcmQpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBzZXJpYWxpemVkQXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXSA9IGV4aXN0aW5nUmVjb3JkLnJlYWRBdHRyaWJ1dGUoYXR0cmlidXRlTmFtZSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gc2VyaWFsaXplZEF0dHJpYnV0ZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBGaWx0ZXJzIGEgcm91dGVkIG11dGF0aW9uIHBheWxvYWQgZG93biB0byB0aGUgcmVzb3VyY2UncyBkZWNsYXJlZFxuICAgKiB3cml0YWJsZS1hdHRyaWJ1dGUgcGVybWl0IGxpc3QuIEFjY2VwdGVkIGtleXMgcGVyIHBlcm1pdHRlZCBhdHRyaWJ1dGUgYXJlXG4gICAqIHRoZSBjYW1lbENhc2UgYXR0cmlidXRlIG5hbWUgcGx1cyB0aGUgbW9kZWwncyBhY3R1YWwgY29sdW1uIG5hbWU7IHVua25vd25cbiAgICoga2V5cyBmYWlsIHRoZSBzeW5jIGxvdWRseS4gVGhlIHByaW1hcnkga2V5IGlzIGRyb3BwZWQgd2hlbiBwZXJtaXR0ZWRcbiAgICogKHNuYXBzaG90IHBheWxvYWRzKSDigJQgdGhlIGVudmVsb3BlJ3MgcmVzb3VyY2VJZCBpcyB0aGUgYXV0aG9yaXRhdGl2ZVxuICAgKiByZWNvcmQgaWRlbnRpdHksIHNvIGEgcGF5bG9hZCBpZCBjYW4gbmV2ZXIgcmV0YXJnZXQgdGhlIHJvdy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vc3luYy1lbnZlbG9wZS1yZXBsYXktc2VydmljZS5qc1wiKS5TeW5jUmVwbGF5TXV0YXRpb259IGFyZ3MubXV0YXRpb24gLSBOb3JtYWxpemVkIHJlcGxheSBtdXRhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9mcm9udGVuZC1tb2RlbC1yZXNvdXJjZS9iYXNlLXJlc291cmNlLmpzXCIpLmRlZmF1bHR9IGFyZ3MucmVzb3VyY2UgLSBSb3V0ZWQgcmVzb3VyY2UgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IFBlcm1pdHRlZCBhdHRyaWJ1dGVzIGZvciByZWNvcmQuYXNzaWduLlxuICAgKi9cbiAgcGVybWl0dGVkUm91dGVkQXR0cmlidXRlcyh7bXV0YXRpb24sIHJlc291cmNlfSkge1xuICAgIGNvbnN0IHBlcm1pdHRlZEF0dHJpYnV0ZXMgPSByZXNvdXJjZS5kZWNsYXJlZFdyaXRhYmxlQXR0cmlidXRlcygpXG5cbiAgICBpZiAoIXBlcm1pdHRlZEF0dHJpYnV0ZXMpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHtyZXNvdXJjZS5jb25zdHJ1Y3Rvci5uYW1lfSBtdXN0IGRlY2xhcmUgc3RhdGljIHdyaXRhYmxlQXR0cmlidXRlcyB0byBhcHBseSByb3V0ZWQgc3luYyBtdXRhdGlvbnMgZm9yOiAke211dGF0aW9uLnJlc291cmNlVHlwZX1gKVxuICAgIH1cblxuICAgIGNvbnN0IE1vZGVsQ2xhc3MgPSByZXNvdXJjZS5tb2RlbENsYXNzKClcbiAgICBjb25zdCBhdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lID0gTW9kZWxDbGFzcy5nZXRBdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lTWFwKClcblxuICAgIC8qKiBAdHlwZSB7U2V0PHN0cmluZz59ICovXG4gICAgY29uc3QgYWxsb3dlZEtleXMgPSBuZXcgU2V0KClcblxuICAgIGZvciAoY29uc3QgYXR0cmlidXRlTmFtZSBvZiBwZXJtaXR0ZWRBdHRyaWJ1dGVzKSB7XG4gICAgICBhbGxvd2VkS2V5cy5hZGQoYXR0cmlidXRlTmFtZSlcblxuICAgICAgY29uc3QgY29sdW1uTmFtZSA9IGF0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWVbYXR0cmlidXRlTmFtZV1cblxuICAgICAgaWYgKGNvbHVtbk5hbWUpIGFsbG93ZWRLZXlzLmFkZChjb2x1bW5OYW1lKVxuICAgIH1cblxuICAgIGNvbnN0IHByaW1hcnlLZXkgPSBzY2FsYXJNb2RlbFByaW1hcnlLZXkoTW9kZWxDbGFzcy5wcmltYXJ5S2V5KCksIGBPZmZsaW5lIHN5bmMgYXR0cmlidXRlIGZpbHRlcmluZyBmb3IgJHtNb2RlbENsYXNzLm5hbWV9YClcbiAgICBjb25zdCBwcmltYXJ5S2V5QXR0cmlidXRlID0gTW9kZWxDbGFzcy5nZXRDb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lTWFwKClbcHJpbWFyeUtleV1cblxuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IGF0dHJpYnV0ZXMgPSB7fVxuXG4gICAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMobXV0YXRpb24uZGF0YSkpIHtcbiAgICAgIGlmICghYWxsb3dlZEtleXMuaGFzKGtleSkpIHtcbiAgICAgICAgdGhyb3cgcmVzb3VyY2Uud3JpdGFibGVBdHRyaWJ1dGVFcnJvcihgVW5rbm93biBhdHRyaWJ1dGU6ICR7a2V5fS5gLCB7Y29kZTogXCJzeW5jLXVua25vd24tYXR0cmlidXRlXCJ9KVxuICAgICAgfVxuXG4gICAgICBpZiAoa2V5ID09PSBwcmltYXJ5S2V5IHx8IGtleSA9PT0gcHJpbWFyeUtleUF0dHJpYnV0ZSkgY29udGludWVcblxuICAgICAgYXR0cmlidXRlc1trZXldID0gdmFsdWVcbiAgICB9XG5cbiAgICByZXR1cm4gYXR0cmlidXRlc1xuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZXMgdGhlIHJvdXRlZCByZWNvcmQgd2l0aCB0aGUgY2xpZW50LWdlbmVyYXRlZCBwcmltYXJ5IGtleSAobWFya2VkXG4gICAqIGFzIGEgc2VydmVyIGFwcGx5IGZvciB0aGUgZHVyYXRpb24gb2YgdGhlIGNyZWF0ZSAtIGluY2x1ZGluZyB0aGVcbiAgICogbWVtYmVyc2hpcC1jaGVjayBjb21wZW5zYXRpb24gZGVzdHJveSAtIHNvIGFuIGFjdGl2ZSBTeW5jUHVibGlzaGVyIG5ldmVyXG4gICAqIHB1Ymxpc2hlcyB0aGUgcmVwbGF5ZWQgY3JlYXRlIGEgc2Vjb25kIHRpbWUpLCB0aGVuXG4gICAqIHZlcmlmaWVzIGNyZWF0ZS1zY29wZSBtZW1iZXJzaGlwIHdoZW4gYW4gYWJpbGl0eSBpcyBjb25maWd1cmVkOiByZWNvcmRzXG4gICAqIG91dHNpZGUgdGhlIGFiaWxpdHkncyBjcmVhdGUgc2NvcGUgYXJlIGRlc3Ryb3llZCBhZ2FpbiBhbmQgZmFpbCB0aGUgc3luY1xuICAgKiB3aXRoIHRoZSByZXNvdXJjZS1kZWNsYXJlZCByZWFzb24uIEEgcmVjb3JkIHRoYXQgYWxyZWFkeSBleGlzdHMgb3V0c2lkZVxuICAgKiB0aGUgcmVzb3VyY2UncyBsb29rdXAgc2NvcGUgZmFpbHMgdGhlIHN5bmMgYXMgYW4gYXV0aG9yaXphdGlvbiBkZW5pYWxcbiAgICogaW5zdGVhZCBvZiBjb2xsaWRpbmcgb24gdGhlIHByaW1hcnkga2V5LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLmF0dHJpYnV0ZXMgLSBQZXJtaXR0ZWQgcGF5bG9hZCBhdHRyaWJ1dGVzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vc3luYy1lbnZlbG9wZS1yZXBsYXktc2VydmljZS5qc1wiKS5TeW5jUmVwbGF5TXV0YXRpb259IGFyZ3MubXV0YXRpb24gLSBOb3JtYWxpemVkIHJlcGxheSBtdXRhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9mcm9udGVuZC1tb2RlbC1yZXNvdXJjZS9iYXNlLXJlc291cmNlLmpzXCIpLmRlZmF1bHR9IGFyZ3MucmVzb3VyY2UgLSBSb3V0ZWQgcmVzb3VyY2UgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0Pn0gQ3JlYXRlZCByZWNvcmQuXG4gICAqL1xuICBhc3luYyBjcmVhdGVSb3V0ZWRSZXBsYXlSZWNvcmQoe2F0dHJpYnV0ZXMsIG11dGF0aW9uLCByZXNvdXJjZX0pIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gcmVzb3VyY2UubW9kZWxDbGFzcygpXG4gICAgY29uc3QgcHJpbWFyeUtleSA9IHNjYWxhck1vZGVsUHJpbWFyeUtleShNb2RlbENsYXNzLnByaW1hcnlLZXkoKSwgYE9mZmxpbmUgc3luYyBjcmVhdGUgZm9yICR7TW9kZWxDbGFzcy5uYW1lfWApXG4gICAgY29uc3QgY29uZmxpY3RpbmdJZHMgPSBhd2FpdCBNb2RlbENsYXNzLndoZXJlKHtbcHJpbWFyeUtleV06IG11dGF0aW9uLnJlc291cmNlSWR9KS5wbHVjayhwcmltYXJ5S2V5KVxuXG4gICAgaWYgKGNvbmZsaWN0aW5nSWRzLmxlbmd0aCA+IDApIHtcbiAgICAgIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoYFN5bmMgdXBkYXRlIGRlbmllZCBmb3I6ICR7bXV0YXRpb24ucmVzb3VyY2VUeXBlfS5gLCB7XG4gICAgICAgIGNvZGU6IHJlc291cmNlLnN5bmNBdXRob3JpemF0aW9uRmFpbHVyZVJlYXNvbih7YWN0aW9uOiBcInVwZGF0ZVwiLCBtdXRhdGlvbn0pIHx8IFwiYWNjZXNzLWRlbmllZFwiXG4gICAgICB9KVxuICAgIH1cblxuICAgIGF3YWl0IE1vZGVsQ2xhc3MuZW5zdXJlSW5pdGlhbGl6ZWQoKVxuXG4gICAgY29uc3QgcmVjb3JkID0gbmV3IE1vZGVsQ2xhc3Moe1twcmltYXJ5S2V5XTogbXV0YXRpb24ucmVzb3VyY2VJZCwgLi4uYXR0cmlidXRlc30pXG4gICAgY29uc3QgcmVsZWFzZVNlcnZlckFwcGx5ID0gbWFya1NlcnZlckFwcGx5KHJlY29yZClcblxuICAgIHRyeSB7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCByZWNvcmQuc2F2ZSgpXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICB0aHJvdyB0aGlzLnJvdXRlZFJlcGxheVNhdmVFcnJvcihlcnJvcilcbiAgICAgIH1cblxuICAgICAgY29uc3QgYWJpbGl0eSA9IHJlc291cmNlLmFiaWxpdHlcblxuICAgICAgaWYgKGFiaWxpdHkpIHtcbiAgICAgICAgY29uc3QgbWVtYmVySWRzID0gYXdhaXQgTW9kZWxDbGFzc1xuICAgICAgICAgIC5hY2Nlc3NpYmxlRm9yKHJlc291cmNlLnN5bmNBYmlsaXR5QWN0aW9uKFwiY3JlYXRlXCIpLCBhYmlsaXR5KVxuICAgICAgICAgIC53aGVyZSh7W3ByaW1hcnlLZXldOiBzY2FsYXJNb2RlbFByaW1hcnlLZXlWYWx1ZShyZWNvcmQuaWQoKSwgYE9mZmxpbmUgc3luYyBjcmVhdGUgYXV0aG9yaXphdGlvbiBmb3IgJHtNb2RlbENsYXNzLm5hbWV9YCl9KVxuICAgICAgICAgIC5wbHVjayhwcmltYXJ5S2V5KVxuXG4gICAgICAgIGlmIChtZW1iZXJJZHMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgYXdhaXQgcmVjb3JkLmRlc3Ryb3koKVxuXG4gICAgICAgICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShgU3luYyBjcmVhdGUgZGVuaWVkIGZvcjogJHttdXRhdGlvbi5yZXNvdXJjZVR5cGV9LmAsIHtcbiAgICAgICAgICAgIGNvZGU6IHJlc291cmNlLnN5bmNBdXRob3JpemF0aW9uRmFpbHVyZVJlYXNvbih7YWN0aW9uOiBcImNyZWF0ZVwiLCBtdXRhdGlvbn0pIHx8IFwiYWNjZXNzLWRlbmllZFwiXG4gICAgICAgICAgfSlcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gcmVjb3JkXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHJlbGVhc2VTZXJ2ZXJBcHBseSgpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFNhdmVzIGEgcm91dGVkIHJlY29yZCwgY29udmVydGluZyBtb2RlbCB2YWxpZGF0aW9uIGZhaWx1cmVzIGludG9cbiAgICogY2xpZW50LXNhZmUgcGVyLXN5bmMgZXJyb3JzIGNhcnJ5aW5nIHRoZSB0cmFuc2xhdGVkIHZhbGlkYXRpb24gbWVzc2FnZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gcmVjb3JkIC0gUmVjb3JkIHRvIHNhdmUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyB3aGVuIHNhdmVkLlxuICAgKi9cbiAgYXN5bmMgc2F2ZVJvdXRlZFJlcGxheVJlY29yZChyZWNvcmQpIHtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgcmVjb3JkLnNhdmUoKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aHJvdyB0aGlzLnJvdXRlZFJlcGxheVNhdmVFcnJvcihlcnJvcilcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogTWFwcyBhIHJvdXRlZCBzYXZlL2NyZWF0ZSBmYWlsdXJlOiBtb2RlbCB2YWxpZGF0aW9uIGVycm9ycyBiZWNvbWVcbiAgICogY2xpZW50LXNhZmUgZXJyb3JzIHdpdGggdGhlaXIgdHJhbnNsYXRlZCBtZXNzYWdlcywgZXZlcnl0aGluZyBlbHNlXG4gICAqIHByb3BhZ2F0ZXMgdW5jaGFuZ2VkLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBlcnJvciAtIFRocm93biBzYXZlL2NyZWF0ZSBlcnJvci5cbiAgICogQHJldHVybnMge0Vycm9yfSBFcnJvciB0byByZXRocm93LlxuICAgKi9cbiAgcm91dGVkUmVwbGF5U2F2ZUVycm9yKGVycm9yKSB7XG4gICAgaWYgKGVycm9yIGluc3RhbmNlb2YgVmFsaWRhdGlvbkVycm9yKSB7XG4gICAgICByZXR1cm4gVmVsb2Npb3VzRXJyb3Iuc2FmZShlcnJvci5tZXNzYWdlLCB7Y2F1c2U6IGVycm9yLCBjb2RlOiBcInZhbGlkYXRpb24tZXJyb3JcIn0pXG4gICAgfVxuXG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7RXJyb3J9ICovIChlcnJvcilcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBhbiBhcHBseSByZXN1bHQgZm9yIHN0YWxlIG11dGF0aW9ucyB0aGF0IHNob3VsZCBub3QgdG91Y2ggZG9tYWluIG1vZGVscy5cbiAgICogRXhhY3QgZHVwbGljYXRlcyByZXNvbHZlIHRoZSBjdXJyZW50IHJvdXRlZCByZWNvcmQgc28gdGhlIGFja25vd2xlZGdlbWVudFxuICAgKiBjYW4gaW5jbHVkZSBpdHMgYXV0aG9yaXRhdGl2ZSB2ZXJzaW9uIHdpdGhvdXQgYXBwbHlpbmcgdGhlIG11dGF0aW9uIGFnYWluLlxuICAgKiBAcGFyYW0ge3thY3RvcjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGNvbnRleHQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgZHVwbGljYXRlPzogYm9vbGVhbiwgZXhpc3RpbmdTeW5jOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgbXV0YXRpb246IGltcG9ydChcIi4vc3luYy1lbnZlbG9wZS1yZXBsYXktc2VydmljZS5qc1wiKS5TeW5jUmVwbGF5TXV0YXRpb259fSBhcmdzIC0gQWN0b3IsIGJhdGNoIGNvbnRleHQsIGV4aXN0aW5nIHN5bmMgcm93LCBhbmQgZHVwbGljYXRlIGRlY2lzaW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IFByb2plY3Qtc3BlY2lmaWMgYXBwbHkgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgc2tpcHBlZFJlcGxheU11dGF0aW9uKHthY3RvciwgY29udGV4dCwgZHVwbGljYXRlID0gZmFsc2UsIGV4aXN0aW5nU3luYywgbXV0YXRpb259KSB7XG4gICAgaWYgKCghZHVwbGljYXRlICYmICF0aGlzLmlzRHVwbGljYXRlUmVwbGF5TXV0YXRpb24oe2V4aXN0aW5nU3luYywgbXV0YXRpb259KSkgfHwgIXRoaXMucm91dGluZ0NvbmZpZ3VyZWQoKSkgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IHJlZ2lzdHJhdGlvbiA9IHRoaXMucmVwbGF5UmVzb3VyY2VSZWdpc3RyYXRpb24obXV0YXRpb24ucmVzb3VyY2VUeXBlKVxuXG4gICAgaWYgKCFyZWdpc3RyYXRpb24pIHJldHVybiBudWxsXG5cbiAgICBjb25zdCByZXNvdXJjZSA9IGF3YWl0IHRoaXMuYnVpbGRSZXBsYXlSZXNvdXJjZSh7YWN0b3IsIGNvbnRleHQsIG11dGF0aW9uLCByZWdpc3RyYXRpb259KVxuICAgIGNvbnN0IHJlY29yZCA9IGF3YWl0IHJlc291cmNlLmZpbmRTeW5jUmVjb3JkKHtmb3JEZWxldGU6IG11dGF0aW9uLnN5bmNUeXBlID09PSBcImRlbGV0ZVwiLCBtdXRhdGlvbn0pXG5cbiAgICByZXR1cm4ge2NyZWF0ZWQ6IGZhbHNlLCBkZWxldGVkOiBmYWxzZSwgZHVwbGljYXRlOiB0cnVlLCByZWNvcmR9XG4gIH1cblxuICAvKipcbiAgICogUGVyc2lzdHMgb25lIG5vcm1hbGl6ZWQgbXV0YXRpb24gaW50byB0aGUgYXBwIHN5bmMvY2hhbmdlIHN0b3JlLlxuICAgKlxuICAgKiBEZWZhdWx0cyB0byBhIHN0YWxlLWd1YXJkZWQgc3luYy1tb2RlbCB1cHNlcnQgKHdpdGggc2VydmVyIHJlLXNlcXVlbmNpbmcgb25cbiAgICogdXBkYXRlcykgd2hlbiBhIHN5bmMgbW9kZWwgaXMgY29uZmlndXJlZDsgb3RoZXJ3aXNlIGFwcHMgb3ZlcnJpZGUgdGhpcyBob29rLlxuICAgKiBAcGFyYW0ge3thY3RvcjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGNvbnRleHQ6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgZXhpc3RpbmdTeW5jOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgYXBwbHlSZXN1bHQ6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBtdXRhdGlvbjogaW1wb3J0KFwiLi9zeW5jLWVudmVsb3BlLXJlcGxheS1zZXJ2aWNlLmpzXCIpLlN5bmNSZXBsYXlNdXRhdGlvbiwgc2hvdWxkQXBwbHk6IGJvb2xlYW59fSBhcmdzIC0gUmVwbGF5IHBlcnNpc3RlbmNlIGFyZ3VtZW50cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBwZXJzaXN0UmVwbGF5TXV0YXRpb24oe2FjdG9yLCBhcHBseVJlc3VsdCwgY29udGV4dCwgZXhpc3RpbmdTeW5jLCBtdXRhdGlvbiwgc2hvdWxkQXBwbHl9KSB7XG4gICAgaWYgKCF0aGlzLnN5bmNNb2RlbCkgcmV0dXJuXG5cbiAgICBjb25zdCBhdHRyaWJ1dGVzID0gdGhpcy5yZXBsYXlQZXJzaXN0QXR0cmlidXRlcyh7YWN0b3IsIG11dGF0aW9ufSlcblxuICAgIC8vIFN0YWxlIHJlcGxheXMgbmV2ZXIgYXBwbGllZCBhbnl0aGluZywgc28gdGhlIGFwcGx5UmVzdWx0LWRyaXZlbiBleHRlbnNpb25cbiAgICAvLyBob29rcyBtdXN0IG5vdCBydW4gYWdhaW5zdCB0aGUgZGVmYXVsdCBudWxsIHNraXBwZWQgcmVzdWx0LlxuICAgIGlmICh0aGlzLnBlcnNpc3RFeHRyYUF0dHJpYnV0ZXMgJiYgc2hvdWxkQXBwbHkpIHtcbiAgICAgIE9iamVjdC5hc3NpZ24oYXR0cmlidXRlcywgdGhpcy5wZXJzaXN0RXh0cmFBdHRyaWJ1dGVzKHthY3RvciwgYXBwbHlSZXN1bHQsIGNvbnRleHQsIGV4aXN0aW5nU3luYywgbXV0YXRpb24sIHNob3VsZEFwcGx5fSkpXG4gICAgfVxuXG4gICAgaWYgKHRoaXMucGVyc2lzdFNlcmlhbGl6ZWREYXRhICYmIHNob3VsZEFwcGx5KSB7XG4gICAgICBjb25zdCBzZXJpYWxpemVkRGF0YSA9IHRoaXMucGVyc2lzdFNlcmlhbGl6ZWREYXRhKHthcHBseVJlc3VsdCwgbXV0YXRpb259KVxuXG4gICAgICBpZiAoc2VyaWFsaXplZERhdGEgIT09IHVuZGVmaW5lZCAmJiBzZXJpYWxpemVkRGF0YSAhPT0gbnVsbCkge1xuICAgICAgICBhdHRyaWJ1dGVzLmRhdGEgPSB0eXBlb2Ygc2VyaWFsaXplZERhdGEgPT09IFwic3RyaW5nXCIgPyBzZXJpYWxpemVkRGF0YSA6IEpTT04uc3RyaW5naWZ5KHNlcmlhbGl6ZWREYXRhKVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmICghdGhpcy5yZXBsYXlSZWNlaXB0U3RvcmUgJiYgdGhpcy5jb25mbGljdFN0cmF0ZWd5ICYmIHNob3VsZEFwcGx5ICYmIG11dGF0aW9uLmJhc2VWZXJzaW9uICE9PSB1bmRlZmluZWQgJiYgYXBwbHlSZXN1bHQ/LnJlY29yZCkge1xuICAgICAgY29uc3QgcHVibGljUGF5bG9hZCA9IGRlY29kZVJlcGxheVBlcnNpc3RlZERhdGEoYXR0cmlidXRlcy5kYXRhKS5wYXlsb2FkXG4gICAgICBjb25zdCBhY2tub3dsZWRnZW1lbnRWZXJzaW9uID0gbm9ybWFsaXplQ29uZmxpY3RWYWx1ZShhcHBseVJlc3VsdC5yZWNvcmQucmVhZEF0dHJpYnV0ZSh0aGlzLmNvbmZsaWN0U3RyYXRlZ3kudmVyc2lvbkF0dHJpYnV0ZSkpXG5cbiAgICAgIGF0dHJpYnV0ZXMuZGF0YSA9IHNlcmlhbGl6ZVJlcGxheVBlcnNpc3RlZERhdGEoe1xuICAgICAgICBhY2tub3dsZWRnZW1lbnRWZXJzaW9uLFxuICAgICAgICBjbGllbnRNdXRhdGlvbklkOiBTdHJpbmcobXV0YXRpb24uY2xpZW50TXV0YXRpb25JZCB8fCBtdXRhdGlvbi5pZCksXG4gICAgICAgIHBheWxvYWQ6IHB1YmxpY1BheWxvYWQsXG4gICAgICAgIHBheWxvYWRGaW5nZXJwcmludDogc2hhMjU2SGV4KG11dGF0aW9uLnNlcmlhbGl6ZWREYXRhKVxuICAgICAgfSlcbiAgICB9XG5cbiAgICBpZiAoZXhpc3RpbmdTeW5jKSB7XG4gICAgICBjb25zdCBleGlzdGluZ0NsaWVudFVwZGF0ZWRBdCA9IHRoaXMuZXhpc3RpbmdSZXBsYXlTeW5jQ2xpZW50VXBkYXRlZEF0KGV4aXN0aW5nU3luYylcblxuICAgICAgaWYgKGV4aXN0aW5nQ2xpZW50VXBkYXRlZEF0ICYmIG11dGF0aW9uLmNsaWVudFVwZGF0ZWRBdCA8PSBleGlzdGluZ0NsaWVudFVwZGF0ZWRBdCkgcmV0dXJuXG4gICAgfVxuXG4gICAgYXdhaXQgdXBzZXJ0U3luY1Jvdyh7YXR0cmlidXRlcywgZXhpc3RpbmdTeW5jLCBzeW5jTW9kZWw6IHRoaXMuc3luY01vZGVsfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgdGhlIHN5bmMtbW9kZWwgYXR0cmlidXRlcyBwZXJzaXN0ZWQgYnkgdGhlIG1vZGVsLWJhY2tlZCBkZWZhdWx0LlxuICAgKiBAcGFyYW0ge3thY3RvcjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIG11dGF0aW9uOiBpbXBvcnQoXCIuL3N5bmMtZW52ZWxvcGUtcmVwbGF5LXNlcnZpY2UuanNcIikuU3luY1JlcGxheU11dGF0aW9ufX0gYXJncyAtIEFjdG9yIGFuZCBtdXRhdGlvbi5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gU3luYyByb3cgYXR0cmlidXRlcy5cbiAgICovXG4gIHJlcGxheVBlcnNpc3RBdHRyaWJ1dGVzKHthY3RvciwgbXV0YXRpb259KSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIFt0aGlzLmFjdG9yRm9yZWlnbktleUNvbHVtbl06IHRoaXMucmVwbGF5QWN0b3JJZChhY3RvciksXG4gICAgICBjbGllbnRfdXBkYXRlZF9hdDogbXV0YXRpb24uY2xpZW50VXBkYXRlZEF0LFxuICAgICAgZGF0YTogbXV0YXRpb24uc2VyaWFsaXplZERhdGEsXG4gICAgICByZXNvdXJjZV9pZDogbXV0YXRpb24ucmVzb3VyY2VJZCxcbiAgICAgIHJlc291cmNlX3R5cGU6IG11dGF0aW9uLnJlc291cmNlVHlwZSxcbiAgICAgIHN5bmNfdHlwZTogbXV0YXRpb24uc3luY1R5cGVcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBzaWRlIGVmZmVjdHMgYWZ0ZXIgYSBzdWNjZXNzZnVsIG11dGF0aW9uIHJlcGxheSBhbmQgcGVyc2lzdGVuY2UuXG4gICAqXG4gICAqIERlZmF1bHRzIHRvIGZhbm5pbmcgdGhlIGFwcGxpZWQgcmVzdWx0IG91dCB0aHJvdWdoIHRoZSBjb25maWd1cmVkXG4gICAqIGRlY2xhcmF0aXZlIGJyb2FkY2FzdHMuXG4gICAqIEBwYXJhbSB7e2FjdG9yOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgY29udGV4dDogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBleGlzdGluZ1N5bmM6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBhcHBseVJlc3VsdDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIG11dGF0aW9uOiBpbXBvcnQoXCIuL3N5bmMtZW52ZWxvcGUtcmVwbGF5LXNlcnZpY2UuanNcIikuU3luY1JlcGxheU11dGF0aW9uLCBzaG91bGRBcHBseTogYm9vbGVhbn19IGFyZ3MgLSBSZXBsYXkgc2lkZS1lZmZlY3QgYXJndW1lbnRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIGFmdGVyUmVwbGF5TXV0YXRpb24oYXJncykge1xuICAgIGlmICghdGhpcy5icm9hZGNhc3RzIHx8ICF0aGlzLmJyb2FkY2FzdGVyKSByZXR1cm5cbiAgICAvLyBTdGFsZSByZXBsYXlzIG5ldmVyIGFwcGxpZWQgYW55dGhpbmcgLSBicm9hZGNhc3RpbmcgdGhlaXIgc2tpcHBlZCByZXN1bHRzXG4gICAgLy8gd291bGQgZmFuIG91dCBzdGFsZSBzaWRlIGVmZmVjdHMgKG9yIGNyYXNoIG9uIHRoZSBkZWZhdWx0IG51bGwgYXBwbHlSZXN1bHQpLlxuICAgIGlmICghYXJncy5zaG91bGRBcHBseSkgcmV0dXJuXG5cbiAgICBhd2FpdCBkZWxpdmVyRGVjbGFyZWRCcm9hZGNhc3RzKHthcmdzLCBicm9hZGNhc3RlcjogdGhpcy5icm9hZGNhc3RlciwgYnJvYWRjYXN0czogdGhpcy5icm9hZGNhc3RzfSlcbiAgfVxufVxuXG4vKipcbiAqIFJldHVybnMgYSBkZXRlcm1pbmlzdGljLCBNeVNRTC1zYWZlIGFkdmlzb3J5LWxvY2sgbmFtZSBmb3IgYSByb3V0ZWQgcmVwbGF5XG4gKiByZXNvdXJjZSBpZGVudGl0eS4gVGhlIGZ1bGwgYHtyZXNvdXJjZVR5cGUsIHJlc291cmNlSWR9YCBpZGVudGl0eSBpcyBoYXNoZWRcbiAqIHdpdGggU0hBLTI1NiBhbmQgdHJ1bmNhdGVkIHRvIDMyIGhleCBjaGFyYWN0ZXJzIHNvIHRoZSBmaW5hbCBuYW1lIHN0YXlzIHdlbGxcbiAqIHVuZGVyIE15U1FML01hcmlhREIncyA2NC1jaGFyYWN0ZXIgYEdFVF9MT0NLYCBsaW1pdCB3aGlsZSByZW1haW5pbmdcbiAqIGNvbGxpc2lvbi1yZXNpc3RhbnQuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIExvY2sgaWRlbnRpdHkgYXJncy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnJlc291cmNlSWQgLSBSZXNvdXJjZSBpZC5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnJlc291cmNlVHlwZSAtIFJlc291cmNlIHR5cGUuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIEFkdmlzb3J5IGxvY2sgbmFtZS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHN5bmNSZXBsYXlDb25mbGljdExvY2tOYW1lKHtyZXNvdXJjZUlkLCByZXNvdXJjZVR5cGV9KSB7XG4gIGNvbnN0IGlkZW50aXR5ID0gc3RhYmxlSnNvblN0cmluZ2lmeSh7cmVzb3VyY2VJZCwgcmVzb3VyY2VUeXBlfSlcbiAgY29uc3QgaGFzaCA9IHNoYTI1NkhleChpZGVudGl0eSkuc2xpY2UoMCwgMzIpXG5cbiAgcmV0dXJuIGB2c3I6JHtoYXNofWBcbn1cblxuLyoqXG4gKiBOb3JtYWxpemVzIGEgdmVyc2lvbiB2YWx1ZSBmb3IgZGV0ZXJtaW5pc3RpYyBjb21wYXJpc29uIGFuZCB0cmFuc3BvcnQuXG4gKiBPbmx5IHZlcnNpb24gdmFsdWVzIHBhcnRpY2lwYXRlIGluIHN0YWJsZS1KU09OIGNvbXBhcmlzb24gYWdhaW5zdCBjbGllbnRcbiAqIGBiYXNlVmVyc2lvbmAgc3RyaW5nczsgcmVzb3VyY2Ugc2VyaWFsaXplci9hY2Nlc3NvciByZXN1bHRzIG11c3Qgc3RheSByYXcgc29cbiAqIHRoZSBmcm9udGVuZC1tb2RlbCB0cmFuc3BvcnQgc2VyaWFsaXplciBjYW4gcmV0YWluIERhdGUgbWFya2Vycy5cbiAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gUmF3IHZlcnNpb24gdmFsdWUgZnJvbSBhIGRhdGFiYXNlIHJlY29yZC5cbiAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBOb3JtYWxpemVkIHZhbHVlIChEYXRlIHZhbHVlcyBiZWNvbWUgSVNPIHN0cmluZ3MpLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVDb25mbGljdFZhbHVlKHZhbHVlKSB7XG4gIGlmICh2YWx1ZSBpbnN0YW5jZW9mIERhdGUpIHJldHVybiB2YWx1ZS50b0lTT1N0cmluZygpXG5cbiAgcmV0dXJuIHZhbHVlXG59XG4iXX0=