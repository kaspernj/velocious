// @ts-check

import {deliverDeclaredBroadcasts, upsertSyncRow} from "./sync-change-fanout.js"
import {markServerApply} from "./sync-publish-suppression.js"
import {resolveFrontendModelResourceClass} from "../frontend-models/resource-definition.js"
import {resolveSyncConflict} from "./conflict-strategy.js"
import SyncReplayUpsertApplier from "./sync-replay-upsert-applier.js"
import stableJsonStringify from "./stable-json.js"
import sha256Hex from "../utils/sha256-hex.js"
import {decodeReplayPersistedData, serializeReplayPersistedData} from "./sync-replay-persisted-data.js"
import {ValidationError} from "../database/record/index.js"
import VelociousError from "../velocious-error.js"

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
    this.logger = args.logger || console
    this.syncModel = args.syncModel || null
    this.actorForeignKeyColumn = args.actorForeignKeyColumn || "authentication_token_id"
    this.authenticationTokenModel = args.authenticationTokenModel || null
    this.authenticationTokenColumn = args.authenticationTokenColumn || "token"
    this.authenticationTokenParam = args.authenticationTokenParam || "authenticationToken"
    this.persistExtraAttributes = args.persistExtraAttributes || null
    this.persistSerializedData = args.persistSerializedData || null
    this.broadcaster = args.broadcaster || null
    this.broadcasts = args.broadcasts || null
    this.applyHandlers = args.applyHandlers ? this.builtApplyHandlers(args.applyHandlers) : null
    this.configuration = args.configuration || null
    this.conflictStrategy = args.conflictStrategy || null
    this.resourceTypeOverrides = args.resourceTypeOverrides || null
    this.ability = args.ability || null
    this.abilityContext = args.abilityContext || null
    this.locals = args.locals || null
    /** @type {Map<string, SyncReplayResourceRegistration | null>} */
    this._replayResourceRegistrations = new Map()

    if (args.actorForeignKeyColumn !== undefined && (typeof args.actorForeignKeyColumn !== "string" || args.actorForeignKeyColumn.length < 1)) {
      throw new Error(`actorForeignKeyColumn must be a non-blank string, got: ${String(args.actorForeignKeyColumn)}`)
    }
    if (this.broadcasts && !this.broadcaster) {
      throw new Error("SyncEnvelopeReplayService broadcasts require a broadcaster option delivering them")
    }
    if (this.conflictStrategy) {
      const supportedConflictStrategies = new Set(["optimisticVersion", "serverWins"])

      if (!this.conflictStrategy.versionAttribute || typeof this.conflictStrategy.versionAttribute !== "string") {
        throw new Error("SyncEnvelopeReplayService conflictStrategy requires a non-blank versionAttribute")
      }
      if (this.conflictStrategy.strategy !== undefined && !supportedConflictStrategies.has(this.conflictStrategy.strategy)) {
        throw new Error(`Unsupported sync conflict strategy for backend replay: ${this.conflictStrategy.strategy}. Only optimisticVersion and serverWins are supported.`)
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
      if (typeof handler === "function") return [resourceType, handler]

      const applier = new SyncReplayUpsertApplier(handler)

      return [resourceType, (/** @type {Record<string, ReturnType<typeof JSON.parse>>} */ applyArgs) => applier.apply(/** @type {ReturnType<typeof JSON.parse>} */ (applyArgs))]
    }))
  }

  /**
   * Replays a sync batch.
   * @param {Record<string, ReturnType<typeof JSON.parse>>} params - Request params carrying authentication and syncs.
   * @param {Record<string, ReturnType<typeof JSON.parse>>} [requestState] - Request-local state passed to authentication/sync extraction hooks; subclasses may use this to share pre-computed per-request data without instance mutation.
   * @returns {Promise<{syncs: Array<Record<string, ReturnType<typeof JSON.parse>>>, status?: string, errorCode?: string, errorMessage?: string}>} Replay response.
   */
  async replay(params, requestState = {}) {
    const actorResult = await this.authenticateReplay(params, requestState)

    if (!actorResult.authenticated) {
      return {
        syncs: [],
        status: "error",
        errorCode: actorResult.errorCode,
        errorMessage: actorResult.errorMessage
      }
    }

    const syncResponses = []
    const context = await this.buildReplayContext({actor: actorResult.actor, params, requestState})

    for (const rawSync of this.replaySyncs(params, requestState)) {
      const normalizedResult = this.normalizeReplaySync(rawSync)

      if (!normalizedResult.ok) {
        syncResponses.push(normalizedResult.response)
        continue
      }

      const mutation = normalizedResult.mutation
      const accessResult = await this.authorizeReplayMutation({actor: actorResult.actor, context, mutation})

      if (!accessResult.allowed) {
        syncResponses.push({
          id: mutation.id,
          syncState: "failed",
          reason: accessResult.reason || "access-denied"
        })
        continue
      }

      const existingSync = await this.findExistingReplaySync({actor: actorResult.actor, context, mutation})
      const shouldApply = await this.shouldApplyReplayMutation({actor: actorResult.actor, context, existingSync, mutation})
      const duplicate = !shouldApply && this.isDuplicateReplayMutation({existingSync, mutation})

      /** @type {ReturnType<typeof JSON.parse>} */
      let applyResult

      try {
        applyResult = shouldApply
          ? await this.applyReplayMutation({actor: actorResult.actor, context, existingSync, mutation})
          : await this.skippedReplayMutation({actor: actorResult.actor, context, existingSync, mutation})
      } catch (error) {
        // Client-safe apply failures (schema validation, model validation,
        // authorization denials, unknown resource types) fail this sync and
        // keep the batch going; unexpected errors keep propagating.
        if (error instanceof VelociousError && error.safeToExpose) {
          syncResponses.push({
            id: mutation.id,
            syncState: "failed",
            reason: error.code || "apply-failed",
            message: error.message
          })
          continue
        }

        throw error
      }

      if (applyResult && applyResult.status === "conflict") {
        syncResponses.push({
          conflict: applyResult.conflict,
          id: mutation.id,
          syncState: "conflict"
        })
        continue
      }

      await this.persistReplayMutation({actor: actorResult.actor, context, existingSync, applyResult, mutation, shouldApply})
      await this.afterReplayMutation({actor: actorResult.actor, context, existingSync, applyResult, mutation, shouldApply})

      /** @type {Record<string, ReturnType<typeof JSON.parse>>} */
      const successfulResponse = {id: mutation.id, syncState: duplicate ? "duplicate" : "successful"}

      const persistedReplayMetadata = duplicate ? this.replayPersistedMetadata(existingSync) : null

      if (persistedReplayMetadata) {
        successfulResponse.serverVersion = persistedReplayMetadata.acknowledgementVersion
      } else if (this.conflictStrategy && mutation.baseVersion !== undefined && applyResult?.record) {
        successfulResponse.serverVersion = normalizeConflictValue(applyResult.record.readAttribute(this.conflictStrategy.versionAttribute))
      }

      syncResponses.push(successfulResponse)
    }

    return {syncs: syncResponses}
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
      throw new Error("SyncEnvelopeReplayService.authenticateReplay must be implemented (or configure authenticationTokenModel)")
    }

    const token = params[this.authenticationTokenParam]

    if (!token) {
      return {authenticated: false, errorCode: "missing-authentication-token", errorMessage: "Missing authentication token"}
    }

    const actor = await this.authenticationTokenModel.findBy({[this.authenticationTokenColumn]: token})

    if (!actor) {
      return {authenticated: false, errorCode: "invalid-authentication-token", errorMessage: "Invalid authentication token"}
    }

    return {actor, authenticated: true}
  }

  /**
   * Builds per-batch mutable context for caches shared across sync items.
   * @param {{actor: ReturnType<typeof JSON.parse>, params: Record<string, ReturnType<typeof JSON.parse>>, requestState: Record<string, ReturnType<typeof JSON.parse>>}} _args - Actor, request params, and request-local state.
   * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} Replay context.
   */
  async buildReplayContext(_args) {
    return {}
  }

  /**
   * Returns raw sync entries from request params.
   * @param {Record<string, ReturnType<typeof JSON.parse>>} params - Request params.
   * @param {Record<string, ReturnType<typeof JSON.parse>>} [_requestState] - Request-local state populated by subclasses before the base replay loop runs.
   * @returns {Array<ReturnType<typeof JSON.parse>>} Raw sync entries.
   */
  replaySyncs(params, _requestState) {
    return Array.isArray(params.syncs) ? params.syncs : []
  }

  /**
   * Normalizes one sync entry.
   * @param {ReturnType<typeof JSON.parse>} rawSync - Raw sync entry.
   * @returns {{ok: true, mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation} | {ok: false, response: Record<string, ReturnType<typeof JSON.parse>>}} Normalized mutation or failed response.
   */
  normalizeReplaySync(rawSync) {
    if (!rawSync || typeof rawSync !== "object" || Array.isArray(rawSync)) {
      return {ok: false, response: {id: undefined, syncState: "failed", reason: "invalid-sync"}}
    }

    const sync = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (rawSync)
    const {clientMutationId, clientUpdatedAt, data, id, resourceId, resourceType, syncType} = sync

    if (typeof resourceType !== "string" || resourceType.length < 1 || resourceId === undefined || resourceId === null || typeof syncType !== "string" || syncType.length < 1) {
      return {ok: false, response: {id, syncState: "failed", reason: "invalid-resource-id"}}
    }

    const resourceIdString = String(resourceId)
    let clientUpdatedAtDate = typeof clientUpdatedAt === "string" || clientUpdatedAt instanceof Date ? new Date(clientUpdatedAt) : new Date()

    if (Number.isNaN(clientUpdatedAtDate.getTime())) clientUpdatedAtDate = new Date()

    const normalizedDataResult = this.normalizeReplaySyncData({data, id, resourceId: resourceIdString, resourceType})

    if (!normalizedDataResult.ok) return normalizedDataResult

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
    }
  }

  /**
   * Normalizes one sync data payload.
   * @param {{data: ReturnType<typeof JSON.parse>, id: ReturnType<typeof JSON.parse>, resourceId: string, resourceType: string}} args - Sync payload normalization arguments.
   * @returns {{ok: true, data: Record<string, ReturnType<typeof JSON.parse>>} | {ok: false, response: Record<string, ReturnType<typeof JSON.parse>>}} Normalized payload or failed response.
   */
  normalizeReplaySyncData({data, id, resourceId, resourceType}) {
    if (data === undefined || data === null) return {ok: true, data: {}}

    if (typeof data === "string") {
      try {
        const parsedData = JSON.parse(data)

        if (!parsedData || typeof parsedData !== "object" || Array.isArray(parsedData)) return {ok: true, data: {}}

        return {ok: true, data: /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (parsedData)}
      } catch (error) {
        this.logger.warn?.("Invalid sync data JSON", {error, id, resourceId, resourceType})
        return {ok: false, response: {id, syncState: "failed", reason: "invalid-data"}}
      }
    }

    if (typeof data !== "object" || Array.isArray(data)) return {ok: true, data: {}}

    return {ok: true, data: JSON.parse(JSON.stringify(data))}
  }

  /**
   * Authorizes one normalized mutation.
   * @param {{actor: ReturnType<typeof JSON.parse>, context: Record<string, ReturnType<typeof JSON.parse>>, mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation}} _args - Actor, batch context, and mutation.
   * @returns {Promise<{allowed: boolean, reason?: string}>} Access result.
   */
  async authorizeReplayMutation(_args) {
    return {allowed: true}
  }

  /**
   * Loads the previously stored sync/change row for stale-client comparison.
   *
   * Defaults to a sync-model lookup by actor and resource identity when a sync
   * model is configured; otherwise apps override this hook.
   * @param {{actor: ReturnType<typeof JSON.parse>, context: Record<string, ReturnType<typeof JSON.parse>>, mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation}} args - Actor, batch context, and mutation.
   * @returns {Promise<ReturnType<typeof JSON.parse>>} Existing sync row.
   */
  async findExistingReplaySync({actor, mutation}) {
    if (!this.syncModel) return null

    return await this.syncModel.findBy({
      [this.actorForeignKeyColumn]: this.replayActorId(actor),
      resource_id: mutation.resourceId,
      resource_type: mutation.resourceType
    })
  }

  /**
   * Resolves the persisted actor id used by model-backed default hooks.
   * @param {ReturnType<typeof JSON.parse>} actor - Actor returned from authenticateReplay.
   * @returns {ReturnType<typeof JSON.parse>} Actor id.
   */
  replayActorId(actor) {
    if (!actor || typeof actor !== "object" || typeof actor.id !== "function") {
      throw new Error("SyncEnvelopeReplayService model-backed defaults require an actor with an id() method from authenticateReplay")
    }

    return actor.id()
  }

  /**
   * Returns whether a normalized mutation should be applied to domain models.
   * @param {{actor: ReturnType<typeof JSON.parse>, context: Record<string, ReturnType<typeof JSON.parse>>, existingSync: ReturnType<typeof JSON.parse>, mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation}} args - Actor, batch context, existing sync row, and mutation.
   * @returns {Promise<boolean>} Whether to apply the mutation.
   */
  async shouldApplyReplayMutation({existingSync, mutation}) {
    const existingClientUpdatedAt = this.existingReplaySyncClientUpdatedAt(existingSync)

    return !existingClientUpdatedAt || mutation.clientUpdatedAt > existingClientUpdatedAt
  }

  /**
   * Resolves the client timestamp from an existing sync row.
   * @param {ReturnType<typeof JSON.parse>} existingSync - Existing sync row.
   * @returns {Date | null} Existing client timestamp.
   */
  existingReplaySyncClientUpdatedAt(existingSync) {
    if (!existingSync || typeof existingSync !== "object") return null

    const syncRecord = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (existingSync)
    const value = typeof syncRecord.clientUpdatedAt === "function"
      ? syncRecord.clientUpdatedAt()
      : syncRecord.clientUpdatedAt

    if (value instanceof Date) return value

    if (typeof value !== "string") return null

    const parsedValue = new Date(value)

    return Number.isNaN(parsedValue.getTime()) ? null : parsedValue
  }

  /**
   * Checks whether a skipped mutation exactly matches the persisted replay row.
   * Older distinct mutations retain the established successful stale-skip response.
   * @param {{existingSync: ReturnType<typeof JSON.parse>, mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation}} args - Existing row and incoming mutation.
   * @returns {boolean} Whether this is a duplicate replay.
   */
  isDuplicateReplayMutation({existingSync, mutation}) {
    if (!existingSync) return false

    const metadata = this.replayPersistedMetadata(existingSync)

    if (metadata) {
      return metadata.clientMutationId === String(mutation.clientMutationId || mutation.id)
        && metadata.payloadFingerprint === sha256Hex(mutation.serializedData)
    }

    const existingClientUpdatedAt = this.existingReplaySyncClientUpdatedAt(existingSync)
    const existingData = this.replaySyncRecordValue(existingSync, "data")
    const existingSyncType = this.replaySyncRecordValue(existingSync, "syncType")
    const serializedExistingData = typeof existingData === "string" ? existingData : JSON.stringify(existingData)

    return existingClientUpdatedAt?.getTime() === mutation.clientUpdatedAt.getTime()
      && serializedExistingData === mutation.serializedData
      && existingSyncType === mutation.syncType
  }

  /**
   * Reads a model-backed sync-row value through its accessor or plain property.
   * @param {ReturnType<typeof JSON.parse>} syncRecord - Existing sync row.
   * @param {string} attributeName - Attribute name.
   * @returns {ReturnType<typeof JSON.parse>} Stored value.
   */
  replaySyncRecordValue(syncRecord, attributeName) {
    const record = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (syncRecord)
    const value = record[attributeName]

    return typeof value === "function" ? value.call(syncRecord) : value
  }

  /**
   * Reads durable replay acknowledgement metadata from a model-backed sync row.
   * @param {ReturnType<typeof JSON.parse>} syncRecord - Existing sync row.
   * @returns {{acknowledgementVersion: string | number | null, clientMutationId: string, payloadFingerprint: string} | null} Persisted metadata.
   */
  replayPersistedMetadata(syncRecord) {
    if (!syncRecord) return null

    return decodeReplayPersistedData(this.replaySyncRecordValue(syncRecord, "data")).metadata
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
      const applyHandler = this.applyHandlers[args.mutation.resourceType]

      if (applyHandler) return await applyHandler(args)
      if (!this.routingConfigured()) throw new Error(`No sync apply handler registered for: ${args.mutation.resourceType}`)
    }

    if (this.routingConfigured()) return await this.applyRoutedReplayMutation(args)

    return null
  }

  /**
   * Returns whether resource routing is configured on this service.
   * @returns {boolean} Whether mutations route to frontend-model resources.
   */
  routingConfigured() {
    return Boolean(this.configuration || this.resourceTypeOverrides)
  }

  /**
   * Resolves the routed resource registration for a resource type, memoized
   * per replay service. Overrides win over the configuration registry; string
   * overrides are aliases resolved through the registry.
   * @param {string} resourceType - Mutation resource type.
   * @returns {SyncReplayResourceRegistration | null} Resolved registration or null when unroutable.
   */
  replayResourceRegistration(resourceType) {
    const memoizedRegistration = this._replayResourceRegistrations.get(resourceType)

    if (memoizedRegistration !== undefined) return memoizedRegistration

    const registration = this.resolveReplayResourceRegistration(resourceType)

    this._replayResourceRegistrations.set(resourceType, registration)

    return registration
  }

  /**
   * Uncached routed-resource resolution behind {@link SyncEnvelopeReplayService#replayResourceRegistration}.
   * @param {string} resourceType - Mutation resource type.
   * @returns {SyncReplayResourceRegistration | null} Resolved registration or null when unroutable.
   */
  resolveReplayResourceRegistration(resourceType) {
    const override = this.resourceTypeOverrides?.[resourceType]

    if (override && typeof override !== "string") {
      return {modelName: resourceType, resourceClass: override, resourceConfiguration: null}
    }

    const registryResourceType = typeof override === "string" ? override : resourceType

    if (!this.configuration) return null

    const resolvedRegistration = resolveFrontendModelResourceClass({configuration: this.configuration, resourceType: registryResourceType})

    if (!resolvedRegistration) return null

    return {
      modelName: resolvedRegistration.modelName,
      resourceClass: resolvedRegistration.resourceClass,
      resourceConfiguration: resolvedRegistration.resourceConfiguration
    }
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
    return {ability: this.ability || undefined, abilityContext: this.abilityContext || {}}
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
  async buildReplayResource({actor, context, mutation, registration}) {
    const ResourceClass = registration.resourceClass
    const {ability, abilityContext} = await this.replayAbilityFor({actor, context})

    return new ResourceClass({
      ability,
      context: abilityContext,
      locals: {...(this.locals || {}), ...(this.configuration ? {configuration: this.configuration} : {})},
      modelName: registration.modelName,
      params: mutation.data,
      ...(registration.resourceConfiguration ? {resourceConfiguration: registration.resourceConfiguration} : {})
    })
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
  async applyRoutedReplayMutation({actor, context, existingSync, mutation}) {
    const registration = this.replayResourceRegistration(mutation.resourceType)

    if (!registration) {
      throw VelociousError.safe(`Unknown sync resource type: ${mutation.resourceType}.`, {code: "unknown-resource-type"})
    }

    const resource = await this.buildReplayResource({actor, context, mutation, registration})
    const customApplyResult = await resource.applySync({context, existingSync, mutation})

    if (customApplyResult !== null) return customApplyResult

    const authorization = await resource.authorizeSyncMutation({context, mutation})

    if (!authorization.allowed) {
      throw VelociousError.safe(`Sync mutation denied for: ${mutation.resourceType}.`, {code: authorization.reason || "access-denied"})
    }

    if (mutation.syncType === "delete") return await this.applyRoutedReplayDelete({mutation, resource})

    const commandApplyResult = await this.applyRoutedReplayCommand({context, mutation, resource})

    if (commandApplyResult !== null) return commandApplyResult

    return await this.applyRoutedReplayUpsert({context, mutation, resource})
  }

  /**
   * Dispatches a routed sync mutation whose syncType matches a resource-declared
   * custom command. Returns null when the mutation is not a command so the
   * caller can fall through to the default upsert path.
   * @param {{context: Record<string, ReturnType<typeof JSON.parse>>, mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation, resource: import("../frontend-model-resource/base-resource.js").default}} args - Command dispatch args.
   * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>> | null>} Command apply result or null.
   */
  async applyRoutedReplayCommand({context, mutation, resource}) {
    const commandConfig = this.resourceCommandConfig(resource)
    const commandMethodName = this.commandMethodNameForSyncType({commandConfig, syncType: mutation.syncType})

    if (!commandMethodName) return null

    const commandMethod = resource.resourceMethod(commandMethodName)

    if (!commandMethod) {
      throw VelociousError.safe(`Sync command handler missing for: ${mutation.resourceType}.${mutation.syncType}.`, {code: "sync-command-handler-missing"})
    }

    const args = this.commandArgsForMutation({commandConfig, commandMethodName, mutation})
    const result = await commandMethod.method.call(commandMethod.resource, args)

    const afterExtras = await resource.afterSyncApply({context, created: false, mutation, record: null})
    const resultObject = result && typeof result === "object" && !Array.isArray(result) ? result : {}

    return {commandResult: result, created: false, deleted: false, record: null, ...resultObject, ...afterExtras}
  }

  /**
   * Resolves the custom-command configuration declared on a routed resource.
   * @param {import("../frontend-model-resource/base-resource.js").default} resource - Routed resource instance.
   * @returns {{collectionCommands: Record<string, string>, memberCommands: Record<string, string>}} Command config.
   */
  resourceCommandConfig(resource) {
    const config = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (resource.resourceConfigurationValue || {})

    return {
      collectionCommands: config.collectionCommands || {},
      memberCommands: config.memberCommands || {}
    }
  }

  /**
   * Resolves the resource method name for a syncType when it names a declared
   * custom command.
   * @param {{commandConfig: {collectionCommands: Record<string, string>, memberCommands: Record<string, string>}, syncType: string}} args - Lookup args.
   * @returns {string | null} Method name or null.
   */
  commandMethodNameForSyncType({commandConfig, syncType}) {
    if (commandConfig.memberCommands[syncType]) return syncType
    if (commandConfig.collectionCommands[syncType]) return syncType

    return null
  }

  /**
   * Builds the arguments object passed to a resource command method. Member
   * commands receive the envelope's resourceId as `id`; the envelope identity
   * is assigned after the payload so a payload `id` can never retarget the
   * command away from the resource the authorization hooks approved.
   * @param {{commandConfig: {collectionCommands: Record<string, string>, memberCommands: Record<string, string>}, commandMethodName: string, mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation}} args - Args builder args.
   * @returns {Record<string, ReturnType<typeof JSON.parse>>} Command method arguments.
   */
  commandArgsForMutation({commandConfig, commandMethodName, mutation}) {
    const isMember = commandConfig.memberCommands[commandMethodName] !== undefined

    if (isMember) {
      return {...mutation.data, id: mutation.resourceId}
    }

    return {...mutation.data}
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
  async applyRoutedReplayDelete({mutation, resource}) {
    const ModelClass = resource.modelClass()
    const runDelete = async () => {
      const record = await resource.findSyncRecord({forDelete: true, mutation})

      if (!record) return {created: false, deleted: false, record: null}

      const conflictResult = await this.routedReplayConflictResult({attributes: {}, existingRecord: record, mutation, resource})

      if (conflictResult) return conflictResult

      const releaseServerApply = markServerApply(record)

      try {
        await record.destroy()
      } finally {
        releaseServerApply()
      }

      return {created: false, deleted: true, record}
    }

    if (!this.conflictStrategy) return await runDelete()

    return await ModelClass.withAdvisoryLock(syncReplayConflictLockName({resourceId: mutation.resourceId, resourceType: mutation.resourceType}), runDelete, {dedicatedConnection: true})
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
  async applyRoutedReplayUpsert({context, mutation, resource}) {
    const attributes = this.permittedRoutedAttributes({mutation, resource})
    const ModelClass = resource.modelClass()
    const runUpsert = async () => {
      const existingRecord = await resource.findSyncRecord({mutation})
      const conflictResult = await this.routedReplayConflictResult({attributes, existingRecord, mutation, resource})

      if (conflictResult) return conflictResult

      /** @type {import("../database/record/index.js").default | null} */
      let record = existingRecord
      let created = false

      if (existingRecord) {
        const releaseServerApply = markServerApply(existingRecord)

        try {
          existingRecord.assign(attributes)
          await this.saveRoutedReplayRecord(existingRecord)
        } finally {
          releaseServerApply()
        }
      } else {
        record = await this.createRoutedReplayRecord({attributes, mutation, resource})
        created = true
      }

      const extras = await resource.afterSyncApply({context, created, mutation, record})

      return {created, deleted: false, record, ...extras}
    }

    if (!this.conflictStrategy) return await runUpsert()

    return await ModelClass.withAdvisoryLock(syncReplayConflictLockName({resourceId: mutation.resourceId, resourceType: mutation.resourceType}), runUpsert, {dedicatedConnection: true})
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
  async routedReplayConflictResult({attributes, existingRecord, mutation, resource}) {
    if (!this.conflictStrategy) return null
    if (!existingRecord || mutation.syncType === "create") return null
    if (mutation.baseVersion === undefined || mutation.baseVersion === null) return null

    const ModelClass = resource.modelClass()
    const primaryKey = ModelClass.primaryKey()
    const primaryKeyAttribute = ModelClass.resolveAttributeName(primaryKey)
    const versionAttribute = this.conflictStrategy.versionAttribute
    const versionAttributeName = ModelClass.resolveAttributeName(versionAttribute)

    if (!primaryKeyAttribute) throw new Error(`Couldn't resolve primary key attribute: ${primaryKey}`)
    if (!versionAttributeName) throw new Error(`Couldn't resolve version attribute: ${versionAttribute}`)

    const serverVersion = normalizeConflictValue(existingRecord.readAttribute(versionAttributeName))

    if (stableJsonStringify(serverVersion) === stableJsonStringify(mutation.baseVersion)) return null

    const serializedAffectedAttributes = await this.serializedRoutedConflictAttributes({attributes, existingRecord, resource})
    const serverAttributes = {
      ...serializedAffectedAttributes,
      [primaryKeyAttribute]: existingRecord.readAttribute(primaryKeyAttribute),
      [versionAttributeName]: serverVersion
    }

    const serverRecord = {
      attributes: serverAttributes,
      version: serverVersion
    }
    const conflictMutation = /** @type {import("./device-identity.js").SyncMutation} */ (/** @type {unknown} */ ({
      attributes,
      baseVersion: mutation.baseVersion,
      clientMutationId: mutation.clientMutationId || mutation.id,
      model: mutation.resourceType,
      operation: mutation.syncType,
      payload: {id: mutation.resourceId}
    }))
    const result = await resolveSyncConflict({
      baseRecord: null,
      mutation: conflictMutation,
      serverRecord,
      strategy: this.conflictStrategy.strategy || "optimisticVersion",
      versionAttribute
    })

    if (result.status !== "conflict") return null

    return {conflict: result.conflict, created: false, deleted: false, record: existingRecord, status: "conflict"}
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
  async serializedRoutedConflictAttributes({attributes, existingRecord, resource}) {
    const ModelClass = resource.modelClass()
    const ResourceClass = /** @type {import("../configuration-types.js").FrontendModelResourceClassType} */ (resource.constructor)
    const readableAttributes = new Set()
    const configuredAttributes = ResourceClass.resourceConfig().attributes
    const configuredEntries = Array.isArray(configuredAttributes) ? configuredAttributes : Object.keys(configuredAttributes)

    if (configuredEntries.length === 0) {
      const attributeNameToColumnName = ModelClass.getAttributeNameToColumnNameMap()

      for (const attributeName of Object.keys(attributeNameToColumnName)) {
        readableAttributes.add(attributeName)
      }
    }

    for (const configuredAttribute of configuredEntries) {
      const configuredName = typeof configuredAttribute === "string" ? configuredAttribute : configuredAttribute.name

      if (!configuredName) continue

      const canonicalName = ModelClass.resolveAttributeName(configuredName)

      readableAttributes.add(canonicalName || configuredName)
    }

    /** @type {Record<string, ReturnType<typeof JSON.parse>>} */
    const serializedAttributes = {}

    for (const affectedField of Object.keys(attributes)) {
      const attributeName = ModelClass.resolveAttributeName(affectedField)

      if (!attributeName || !readableAttributes.has(attributeName)) continue

      const resourceAttribute = resource.resourceMethod(`${attributeName}Attribute`)

      if (resourceAttribute) {
        serializedAttributes[attributeName] = await resourceAttribute.method.call(resourceAttribute.resource, existingRecord)
        continue
      }

      const recordMethods = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (/** @type {unknown} */ (existingRecord))
      const attributeMethod = recordMethods[attributeName]

      if (typeof attributeMethod === "function") {
        serializedAttributes[attributeName] = await attributeMethod.call(existingRecord)
      } else {
        serializedAttributes[attributeName] = existingRecord.readAttribute(attributeName)
      }
    }

    return serializedAttributes
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
  permittedRoutedAttributes({mutation, resource}) {
    const permittedAttributes = resource.declaredWritableAttributes()

    if (!permittedAttributes) {
      throw new Error(`${resource.constructor.name} must declare static writableAttributes to apply routed sync mutations for: ${mutation.resourceType}`)
    }

    const ModelClass = resource.modelClass()
    const attributeNameToColumnName = ModelClass.getAttributeNameToColumnNameMap()

    /** @type {Set<string>} */
    const allowedKeys = new Set()

    for (const attributeName of permittedAttributes) {
      allowedKeys.add(attributeName)

      const columnName = attributeNameToColumnName[attributeName]

      if (columnName) allowedKeys.add(columnName)
    }

    const primaryKey = ModelClass.primaryKey()
    const primaryKeyAttribute = ModelClass.getColumnNameToAttributeNameMap()[primaryKey]

    /** @type {Record<string, ReturnType<typeof JSON.parse>>} */
    const attributes = {}

    for (const [key, value] of Object.entries(mutation.data)) {
      if (!allowedKeys.has(key)) {
        throw resource.writableAttributeError(`Unknown attribute: ${key}.`, {code: "sync-unknown-attribute"})
      }

      if (key === primaryKey || key === primaryKeyAttribute) continue

      attributes[key] = value
    }

    return attributes
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
  async createRoutedReplayRecord({attributes, mutation, resource}) {
    const ModelClass = resource.modelClass()
    const primaryKey = ModelClass.primaryKey()
    const conflictingIds = await ModelClass.where({[primaryKey]: mutation.resourceId}).pluck(primaryKey)

    if (conflictingIds.length > 0) {
      throw VelociousError.safe(`Sync update denied for: ${mutation.resourceType}.`, {
        code: resource.syncAuthorizationFailureReason({action: "update", mutation}) || "access-denied"
      })
    }

    await ModelClass.ensureInitialized()

    const record = new ModelClass({[primaryKey]: mutation.resourceId, ...attributes})
    const releaseServerApply = markServerApply(record)

    try {
      try {
        await record.save()
      } catch (error) {
        throw this.routedReplaySaveError(error)
      }

      const ability = resource.ability

      if (ability) {
        const memberIds = await ModelClass
          .accessibleFor(resource.syncAbilityAction("create"), ability)
          .where({[primaryKey]: record.id()})
          .pluck(primaryKey)

        if (memberIds.length === 0) {
          await record.destroy()

          throw VelociousError.safe(`Sync create denied for: ${mutation.resourceType}.`, {
            code: resource.syncAuthorizationFailureReason({action: "create", mutation}) || "access-denied"
          })
        }
      }

      return record
    } finally {
      releaseServerApply()
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
      await record.save()
    } catch (error) {
      throw this.routedReplaySaveError(error)
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
      return VelociousError.safe(error.message, {cause: error, code: "validation-error"})
    }

    return /** @type {Error} */ (error)
  }

  /**
   * Resolves an apply result for stale mutations that should not touch domain models.
   * Exact duplicates resolve the current routed record so the acknowledgement
   * can include its authoritative version without applying the mutation again.
   * @param {{actor: ReturnType<typeof JSON.parse>, context: Record<string, ReturnType<typeof JSON.parse>>, existingSync: ReturnType<typeof JSON.parse>, mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation}} args - Actor, batch context, existing sync row, and mutation.
   * @returns {Promise<ReturnType<typeof JSON.parse>>} Project-specific apply result.
   */
  async skippedReplayMutation({actor, context, existingSync, mutation}) {
    if (!this.isDuplicateReplayMutation({existingSync, mutation}) || !this.routingConfigured()) return null

    const registration = this.replayResourceRegistration(mutation.resourceType)

    if (!registration) return null

    const resource = await this.buildReplayResource({actor, context, mutation, registration})
    const record = await resource.findSyncRecord({forDelete: mutation.syncType === "delete", mutation})

    return {created: false, deleted: false, duplicate: true, record}
  }

  /**
   * Persists one normalized mutation into the app sync/change store.
   *
   * Defaults to a stale-guarded sync-model upsert (with server re-sequencing on
   * updates) when a sync model is configured; otherwise apps override this hook.
   * @param {{actor: ReturnType<typeof JSON.parse>, context: Record<string, ReturnType<typeof JSON.parse>>, existingSync: ReturnType<typeof JSON.parse>, applyResult: ReturnType<typeof JSON.parse>, mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation, shouldApply: boolean}} args - Replay persistence arguments.
   * @returns {Promise<void>}
   */
  async persistReplayMutation({actor, applyResult, context, existingSync, mutation, shouldApply}) {
    if (!this.syncModel) return

    const attributes = this.replayPersistAttributes({actor, mutation})

    // Stale replays never applied anything, so the applyResult-driven extension
    // hooks must not run against the default null skipped result.
    if (this.persistExtraAttributes && shouldApply) {
      Object.assign(attributes, this.persistExtraAttributes({actor, applyResult, context, existingSync, mutation, shouldApply}))
    }

    if (this.persistSerializedData && shouldApply) {
      const serializedData = this.persistSerializedData({applyResult, mutation})

      if (serializedData !== undefined && serializedData !== null) {
        attributes.data = typeof serializedData === "string" ? serializedData : JSON.stringify(serializedData)
      }
    }

    if (this.conflictStrategy && shouldApply && mutation.baseVersion !== undefined && applyResult?.record) {
      const publicPayload = decodeReplayPersistedData(attributes.data).payload
      const acknowledgementVersion = normalizeConflictValue(applyResult.record.readAttribute(this.conflictStrategy.versionAttribute))

      attributes.data = serializeReplayPersistedData({
        acknowledgementVersion,
        clientMutationId: String(mutation.clientMutationId || mutation.id),
        payload: publicPayload,
        payloadFingerprint: sha256Hex(mutation.serializedData)
      })
    }

    if (existingSync) {
      const existingClientUpdatedAt = this.existingReplaySyncClientUpdatedAt(existingSync)

      if (existingClientUpdatedAt && mutation.clientUpdatedAt <= existingClientUpdatedAt) return
    }

    await upsertSyncRow({attributes, existingSync, syncModel: this.syncModel})
  }

  /**
   * Builds the sync-model attributes persisted by the model-backed default.
   * @param {{actor: ReturnType<typeof JSON.parse>, mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation}} args - Actor and mutation.
   * @returns {Record<string, ReturnType<typeof JSON.parse>>} Sync row attributes.
   */
  replayPersistAttributes({actor, mutation}) {
    return {
      [this.actorForeignKeyColumn]: this.replayActorId(actor),
      client_updated_at: mutation.clientUpdatedAt,
      data: mutation.serializedData,
      resource_id: mutation.resourceId,
      resource_type: mutation.resourceType,
      sync_type: mutation.syncType
    }
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
    if (!this.broadcasts || !this.broadcaster) return
    // Stale replays never applied anything - broadcasting their skipped results
    // would fan out stale side effects (or crash on the default null applyResult).
    if (!args.shouldApply) return

    await deliverDeclaredBroadcasts({args, broadcaster: this.broadcaster, broadcasts: this.broadcasts})
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
export function syncReplayConflictLockName({resourceId, resourceType}) {
  const identity = stableJsonStringify({resourceId, resourceType})
  const hash = sha256Hex(identity).slice(0, 32)

  return `vsr:${hash}`
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
  if (value instanceof Date) return value.toISOString()

  return value
}
