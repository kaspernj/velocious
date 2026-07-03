// @ts-check

import * as inflection from "inflection"
import normalizeAttributesWithSchema from "./sync-attribute-normalizer.js"
import {resolveFrontendModelResourceClass} from "../frontend-models/resource-definition.js"
import SyncReplayUpsertApplier from "./sync-replay-upsert-applier.js"
import {ValidationError} from "../database/record/index.js"
import VelociousError from "../velocious-error.js"

/**
 * One declarative broadcast fanned out after a mutation applies.
 * @typedef {object} SyncReplayBroadcast
 * @property {string | ((args: Record<string, ?>) => string)} channel - Channel name or resolver.
 * @property {(args: Record<string, ?>) => Record<string, ?>} broadcastParams - Channel routing params.
 * @property {(args: Record<string, ?>) => ?} body - Broadcast body.
 * @property {(args: Record<string, ?>) => boolean} [when] - Optional gate; skipped when it returns false.
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
   * @param {?} [args.syncModel] - Sync/change model enabling model-backed default hooks.
   * @param {string} [args.actorForeignKeyColumn] - Sync model column linking rows to the replay actor.
   * @param {?} [args.authenticationTokenModel] - Token model enabling the default token-lookup authenticateReplay.
   * @param {string} [args.authenticationTokenColumn] - Token model column holding the token. Defaults to "token".
   * @param {string} [args.authenticationTokenParam] - Request param carrying the token. Defaults to "authenticationToken".
   * @param {Record<string, ((args: Record<string, ?>) => Promise<?>) | ConstructorParameters<typeof SyncReplayUpsertApplier>[0]>} [args.applyHandlers] - Per-resourceType apply handlers (functions or declarative upsert-applier specs) enabling the default applyReplayMutation dispatch.
   * @param {(args: Record<string, ?>) => Record<string, ?>} [args.persistExtraAttributes] - Extra attributes merged into the model-backed persisted row (e.g. an event scope column).
   * @param {(args: {mutation: ?, applyResult: ?}) => ?} [args.persistSerializedData] - Overrides the persisted data payload (object results are JSON stringified).
   * @param {(broadcast: {channel: string, params: Record<string, ?>, body: ?}) => Promise<void>} [args.broadcaster] - Delivers declarative broadcasts. Required when broadcasts are configured.
   * @param {SyncReplayBroadcast[]} [args.broadcasts] - Broadcasts fanned out by the default afterReplayMutation.
   * @param {{getBackendProjects: () => import("../configuration-types.js").BackendProjectConfiguration[]}} [args.configuration] - Configuration whose frontend-model registry routes mutations to resource classes.
   * @param {Record<string, import("../configuration-types.js").FrontendModelResourceClassType | string>} [args.resourceTypeOverrides] - Per-resourceType routing overrides: a resource class, or a string alias resolved through the registry.
   * @param {import("../authorization/ability.js").default} [args.ability] - Ability scoping routed record lookups and create membership checks.
   * @param {Record<string, ?>} [args.abilityContext] - Ability context passed to routed resources.
   * @param {Record<string, ?>} [args.locals] - Locals passed to routed resources.
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
  }

  /**
   * Wraps declarative apply-handler specs in upsert appliers.
   * @param {Record<string, ?>} applyHandlers - Raw apply handlers.
   * @returns {Record<string, (args: Record<string, ?>) => Promise<?>>} Callable handlers by resource type.
   */
  builtApplyHandlers(applyHandlers) {
    return Object.fromEntries(Object.entries(applyHandlers).map(([resourceType, handler]) => {
      if (typeof handler === "function") return [resourceType, handler]

      const applier = new SyncReplayUpsertApplier(handler)

      return [resourceType, (/** @type {Record<string, ?>} */ applyArgs) => applier.apply(/** @type {?} */ (applyArgs))]
    }))
  }

  /**
   * Replays a sync batch.
   * @param {Record<string, ?>} params - Request params carrying authentication and syncs.
   * @returns {Promise<{syncs: Array<Record<string, ?>>, status?: string, errorCode?: string, errorMessage?: string}>} Replay response.
   */
  async replay(params) {
    const actorResult = await this.authenticateReplay(params)

    if (!actorResult.authenticated) {
      return {
        syncs: [],
        status: "error",
        errorCode: actorResult.errorCode,
        errorMessage: actorResult.errorMessage
      }
    }

    const syncResponses = []
    const context = await this.buildReplayContext({actor: actorResult.actor, params})

    for (const rawSync of this.replaySyncs(params)) {
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

      /** @type {?} */
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

      await this.persistReplayMutation({actor: actorResult.actor, context, existingSync, applyResult, mutation, shouldApply})
      await this.afterReplayMutation({actor: actorResult.actor, context, existingSync, applyResult, mutation, shouldApply})

      syncResponses.push({id: mutation.id, syncState: "successful"})
    }

    return {syncs: syncResponses}
  }

  /**
   * Authenticates the sync batch actor.
   *
   * Defaults to a token-model lookup when `authenticationTokenModel` is
   * configured; otherwise apps override this hook.
   * @param {Record<string, ?>} params - Request params.
   * @returns {Promise<{authenticated: true, actor: ?} | {authenticated: false, errorCode: string, errorMessage: string}>} Auth result.
   */
  async authenticateReplay(params) {
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
   * @param {{actor: ?, params: Record<string, ?>}} _args - Actor and request params.
   * @returns {Promise<Record<string, ?>>} Replay context.
   */
  async buildReplayContext(_args) {
    return {}
  }

  /**
   * Returns raw sync entries from request params.
   * @param {Record<string, ?>} params - Request params.
   * @returns {Array<?>} Raw sync entries.
   */
  replaySyncs(params) {
    return Array.isArray(params.syncs) ? params.syncs : []
  }

  /**
   * Normalizes one sync entry.
   * @param {?} rawSync - Raw sync entry.
   * @returns {{ok: true, mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation} | {ok: false, response: Record<string, ?>}} Normalized mutation or failed response.
   */
  normalizeReplaySync(rawSync) {
    if (!rawSync || typeof rawSync !== "object" || Array.isArray(rawSync)) {
      return {ok: false, response: {id: undefined, syncState: "failed", reason: "invalid-sync"}}
    }

    const sync = /** @type {Record<string, ?>} */ (rawSync)
    const {clientUpdatedAt, data, id, resourceId, resourceType, syncType} = sync

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
   * @param {{data: ?, id: ?, resourceId: string, resourceType: string}} args - Sync payload normalization arguments.
   * @returns {{ok: true, data: Record<string, ?>} | {ok: false, response: Record<string, ?>}} Normalized payload or failed response.
   */
  normalizeReplaySyncData({data, id, resourceId, resourceType}) {
    if (data === undefined || data === null) return {ok: true, data: {}}

    if (typeof data === "string") {
      try {
        const parsedData = JSON.parse(data)

        if (!parsedData || typeof parsedData !== "object" || Array.isArray(parsedData)) return {ok: true, data: {}}

        return {ok: true, data: /** @type {Record<string, ?>} */ (parsedData)}
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
   * @param {{actor: ?, context: Record<string, ?>, mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation}} _args - Actor, batch context, and mutation.
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
   * @param {{actor: ?, context: Record<string, ?>, mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation}} args - Actor, batch context, and mutation.
   * @returns {Promise<?>} Existing sync row.
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
   * @param {?} actor - Actor returned from authenticateReplay.
   * @returns {?} Actor id.
   */
  replayActorId(actor) {
    if (!actor || typeof actor !== "object" || typeof actor.id !== "function") {
      throw new Error("SyncEnvelopeReplayService model-backed defaults require an actor with an id() method from authenticateReplay")
    }

    return actor.id()
  }

  /**
   * Returns whether a normalized mutation should be applied to domain models.
   *
   * A routed resource with a non-null `shouldApplySync` decision wins;
   * otherwise the existing-sync timestamp comparison decides.
   * @param {{actor: ?, context: Record<string, ?>, existingSync: ?, mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation}} args - Actor, batch context, existing sync row, and mutation.
   * @returns {Promise<boolean>} Whether to apply the mutation.
   */
  async shouldApplyReplayMutation({existingSync, mutation}) {
    if (this.routingConfigured()) {
      const registration = this.replayResourceRegistration(mutation.resourceType)

      if (registration) {
        const resource = this.buildReplayResource({mutation, registration})
        const hookDecision = await resource.shouldApplySync({existingSync, mutation})

        if (hookDecision !== null) return hookDecision
      }
    }

    const existingClientUpdatedAt = this.existingReplaySyncClientUpdatedAt(existingSync)

    return !existingClientUpdatedAt || mutation.clientUpdatedAt > existingClientUpdatedAt
  }

  /**
   * Resolves the client timestamp from an existing sync row.
   * @param {?} existingSync - Existing sync row.
   * @returns {Date | null} Existing client timestamp.
   */
  existingReplaySyncClientUpdatedAt(existingSync) {
    if (!existingSync || typeof existingSync !== "object") return null

    const syncRecord = /** @type {Record<string, ?>} */ (existingSync)
    const value = typeof syncRecord.clientUpdatedAt === "function"
      ? syncRecord.clientUpdatedAt()
      : syncRecord.clientUpdatedAt

    if (value instanceof Date) return value

    if (typeof value !== "string") return null

    const parsedValue = new Date(value)

    return Number.isNaN(parsedValue.getTime()) ? null : parsedValue
  }

  /**
   * Applies one normalized mutation to domain models.
   *
   * Dispatches through the configured apply-handler registry first (compat
   * precedence); mutations without a matching handler fall through to
   * resource routing when a configuration or resourceTypeOverrides are
   * configured, and otherwise fail loudly.
   * @param {{actor: ?, context: Record<string, ?>, existingSync: ?, mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation}} args - Actor, batch context, existing sync row, and mutation.
   * @returns {Promise<?>} Project-specific apply result.
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
   * Builds the routed resource instance handling one mutation.
   * @param {object} args - Options.
   * @param {import("./sync-envelope-replay-service.js").SyncReplayMutation} args.mutation - Normalized replay mutation.
   * @param {SyncReplayResourceRegistration} args.registration - Resolved resource registration.
   * @returns {import("../frontend-model-resource/base-resource.js").default} Routed resource instance.
   */
  buildReplayResource({mutation, registration}) {
    const ResourceClass = registration.resourceClass

    return new ResourceClass({
      ability: this.ability || undefined,
      context: this.abilityContext || {},
      locals: this.locals || {},
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
   * @param {{actor: ?, context: Record<string, ?>, existingSync: ?, mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation}} args - Actor, batch context, existing sync row, and mutation.
   * @returns {Promise<Record<string, ?>>} Apply result with record, created/deleted flags, and afterSyncApply extras.
   */
  async applyRoutedReplayMutation({context, existingSync, mutation}) {
    const registration = this.replayResourceRegistration(mutation.resourceType)

    if (!registration) {
      throw VelociousError.safe(`Unknown sync resource type: ${mutation.resourceType}.`, {code: "unknown-resource-type"})
    }

    const resource = this.buildReplayResource({mutation, registration})
    const customApplyResult = await resource.applySync({context, existingSync, mutation})

    if (customApplyResult !== null) return customApplyResult

    const authorization = await resource.authorizeSyncMutation({context, mutation})

    if (!authorization.allowed) {
      throw VelociousError.safe(`Sync mutation denied for: ${mutation.resourceType}.`, {code: authorization.reason || "access-denied"})
    }

    if (mutation.syncType === "delete") return await this.applyRoutedReplayDelete({mutation, resource})

    return await this.applyRoutedReplayUpsert({context, mutation, resource})
  }

  /**
   * Applies a routed delete mutation.
   * @param {object} args - Options.
   * @param {import("./sync-envelope-replay-service.js").SyncReplayMutation} args.mutation - Normalized replay mutation.
   * @param {import("../frontend-model-resource/base-resource.js").default} args.resource - Routed resource instance.
   * @returns {Promise<Record<string, ?>>} Apply result with the deleted flag.
   */
  async applyRoutedReplayDelete({mutation, resource}) {
    const record = await resource.findSyncRecord({forDelete: true, mutation})

    if (!record) return {created: false, deleted: false, record: null}
    if (resource.syncDeleteBehavior() === "ignore") return {created: false, deleted: false, record}

    await record.destroy()

    return {created: false, deleted: true, record}
  }

  /**
   * Applies a routed upsert mutation: schema-normalized assign/save for found
   * records, and a save-then-check membership create (or a configured no-op)
   * for missing ones. Model validation failures become client-safe per-sync
   * failures carrying the translated validation message.
   * @param {object} args - Options.
   * @param {Record<string, ?>} args.context - Replay context.
   * @param {import("./sync-envelope-replay-service.js").SyncReplayMutation} args.mutation - Normalized replay mutation.
   * @param {import("../frontend-model-resource/base-resource.js").default} args.resource - Routed resource instance.
   * @returns {Promise<Record<string, ?>>} Apply result with record, created flag, and afterSyncApply extras.
   */
  async applyRoutedReplayUpsert({context, mutation, resource}) {
    const schema = resource.syncWritableAttributes()

    if (!schema) {
      throw new Error(`${resource.constructor.name} must declare static writableAttributes (or override syncWritableAttributes) to apply routed sync mutations for: ${mutation.resourceType}`)
    }

    const normalizedAttributes = normalizeAttributesWithSchema({
      attributes: mutation.data,
      errorFactory: (message, details) => resource.writableAttributeError(message, details),
      schema,
      translator: resource.writableAttributeTranslator()
    })

    // The envelope's resourceId is the authoritative record identity. Schemas
    // including the primary key (e.g. full client snapshots with `id: true`)
    // must never let a payload id retarget the row: strip the primary key
    // from the normalized payload so updates cannot reassign it and creates
    // always use mutation.resourceId.
    const primaryKey = resource.modelClass().primaryKey()

    delete normalizedAttributes[primaryKey]
    delete normalizedAttributes[inflection.camelize(primaryKey, true)]

    const existingRecord = await resource.findSyncRecord({mutation})

    /** @type {import("../database/record/index.js").default | null} */
    let record = existingRecord
    let created = false

    if (existingRecord) {
      existingRecord.assign(normalizedAttributes)
      await this.saveRoutedReplayRecord(existingRecord)
    } else {
      if (resource.syncMissingRecordBehavior() === "ignore") return {created: false, deleted: false, record: null}

      record = await this.createRoutedReplayRecord({mutation, normalizedAttributes, resource})
      created = true
    }

    const extras = await resource.afterSyncApply({context, created, mutation, record})

    return {created, deleted: false, record, ...extras}
  }

  /**
   * Creates the routed record with the client-generated primary key, then
   * verifies create-scope membership when an ability is configured: records
   * outside the ability's create scope are destroyed again and fail the sync
   * with the resource-declared reason.
   * @param {object} args - Options.
   * @param {import("./sync-envelope-replay-service.js").SyncReplayMutation} args.mutation - Normalized replay mutation.
   * @param {Record<string, ?>} args.normalizedAttributes - Schema-normalized attributes.
   * @param {import("../frontend-model-resource/base-resource.js").default} args.resource - Routed resource instance.
   * @returns {Promise<import("../database/record/index.js").default>} Created record.
   */
  async createRoutedReplayRecord({mutation, normalizedAttributes, resource}) {
    const ModelClass = resource.modelClass()
    const primaryKey = ModelClass.primaryKey()
    /** @type {import("../database/record/index.js").default} */
    let record

    try {
      record = await ModelClass.create({[primaryKey]: mutation.resourceId, ...normalizedAttributes})
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
   * @param {?} error - Thrown save/create error.
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
   * @param {{actor: ?, context: Record<string, ?>, existingSync: ?, mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation}} _args - Actor, batch context, existing sync row, and mutation.
   * @returns {Promise<?>} Project-specific apply result.
   */
  async skippedReplayMutation(_args) {
    return null
  }

  /**
   * Persists one normalized mutation into the app sync/change store.
   *
   * Defaults to a stale-guarded sync-model upsert (with server re-sequencing on
   * updates) when a sync model is configured; otherwise apps override this hook.
   * @param {{actor: ?, context: Record<string, ?>, existingSync: ?, applyResult: ?, mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation, shouldApply: boolean}} args - Replay persistence arguments.
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

    if (existingSync) {
      const existingClientUpdatedAt = this.existingReplaySyncClientUpdatedAt(existingSync)

      if (existingClientUpdatedAt && mutation.clientUpdatedAt <= existingClientUpdatedAt) return

      existingSync.assign(attributes)
      await existingSync.advanceServerSequence()
      await existingSync.save()
    } else {
      await this.syncModel.create(attributes)
    }
  }

  /**
   * Builds the sync-model attributes persisted by the model-backed default.
   * @param {{actor: ?, mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation}} args - Actor and mutation.
   * @returns {Record<string, ?>} Sync row attributes.
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
   * @param {{actor: ?, context: Record<string, ?>, existingSync: ?, applyResult: ?, mutation: import("./sync-envelope-replay-service.js").SyncReplayMutation, shouldApply: boolean}} args - Replay side-effect arguments.
   * @returns {Promise<void>}
   */
  async afterReplayMutation(args) {
    if (!this.broadcasts || !this.broadcaster) return
    // Stale replays never applied anything - broadcasting their skipped results
    // would fan out stale side effects (or crash on the default null applyResult).
    if (!args.shouldApply) return

    for (const broadcast of this.broadcasts) {
      if (broadcast.when && !broadcast.when(args)) continue

      await this.broadcaster({
        body: broadcast.body(args),
        channel: typeof broadcast.channel === "function" ? broadcast.channel(args) : broadcast.channel,
        params: broadcast.broadcastParams(args)
      })
    }
  }
}

/**
 * Resolved routed-resource registration for one replay resource type.
 * @typedef {object} SyncReplayResourceRegistration
 * @property {string} modelName - Effective frontend model name.
 * @property {import("../configuration-types.js").FrontendModelResourceClassType} resourceClass - Routed resource class.
 * @property {import("../configuration-types.js").NormalizedFrontendModelResourceConfiguration | null} resourceConfiguration - Normalized resource configuration when registry-resolved.
 */

/**
 * @typedef {object} SyncReplayMutation
 * @property {Date} clientUpdatedAt - Client-side mutation timestamp.
 * @property {Record<string, ?>} data - Parsed mutation payload.
 * @property {?} id - Client sync row id for per-sync responses.
 * @property {string} resourceId - Resource id as a string.
 * @property {string} resourceType - Resource/model name.
 * @property {string} serializedData - JSON serialized mutation payload.
 * @property {string} syncType - Sync operation type.
 */
