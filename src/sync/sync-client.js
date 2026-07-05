// @ts-check

import Configuration from "../configuration.js"
import {isBooleanColumnType} from "../database/column-types.js"
import restArgsError from "../utils/rest-args-error.js"

import {serializedScopeFromQuery} from "./query-scope.js"
import SyncApiClient from "./sync-api-client.js"
import SyncRealtimeBridge from "./sync-realtime-bridge.js"
import SyncScopeStore from "./sync-scope-store.js"
import {currentSyncClient, setCurrentSyncClient} from "./sync-client-registry.js"

let clientCounter = 0

/** @type {{create: "afterCreate", update: "afterUpdate", destroy: "afterDestroy"}} */
const TRACKED_CALLBACK_NAMES = {create: "afterCreate", destroy: "afterDestroy", update: "afterUpdate"}

/**
 * Operations tracked by default for models declaring `static sync` without a
 * `track` key: local creates and updates queue automatically. Destroys are not
 * tracked by default because a local destroy is often cache eviction rather
 * than a server delete; opt in with `track: true` or an operations list.
 * @type {Array<"create" | "update" | "destroy">} */
const DEFAULT_TRACKED_OPERATIONS = ["create", "update"]

/** Attribute names treated as client-local sync bookkeeping when deriving localOnlyAttributes. */
const LOCAL_BOOKKEEPING_ATTRIBUTE_NAMES = ["createdAt", "updatedAt", "lastSyncChangeAt"]

/** @type {WeakMap<Configuration, SyncClient>} */
const syncClientsByConfiguration = new WeakMap()

/**
 * Declarative client-side sync driver.
 *
 * Everything is derived from the app's Velocious configuration: models declare
 * `static sync`, transport/auth/connectivity come from the `sync.client`
 * configuration block, and Velocious owns scope persistence, per-scope cursors,
 * pull paging/apply, local queueing, and online-gated replay. Declare sync
 * interest from queries:
 *
 *     await syncClient().start()
 *     await syncClient().sync(Event.where({partnerId}))
 */
export default class SyncClient {
  /**
   * Builds the sync client by deriving everything from the app's Velocious
   * configuration: every registered model declaring `static sync` becomes a
   * resource with booleanAttributes derived from column types and
   * localOnlyAttributes derived from the primary key, createdAt/updatedAt, and
   * sync bookkeeping columns; the pending-sync model is the registered "Sync"
   * model; transport, auth, connectivity, and error reporting come from the
   * `sync.client` configuration block, with the framework owning the
   * `${mountPath}/changes` and `${mountPath}/replay` POSTers.
   * @param {import("./sync-client-types.js").SyncClientOptions} [options] - Optional overrides.
   */
  constructor(options = {}) {
    const {configuration = Configuration.current(), legacyCursor, scopeStore, syncModel, ...restOptions} = options

    restArgsError(restOptions)

    const clientConfiguration = configuration.getSyncConfiguration().client

    if (!clientConfiguration) {
      throw new Error("SyncClient requires a sync.client configuration block: new Configuration({sync: {client: {authenticationToken, transport}}})")
    }

    const modelClasses = configuration.getModelClasses()
    /** @type {Record<string, import("./sync-client-types.js").SyncClientResourceConfig>} */
    const resources = {}

    for (const modelClass of Object.values(modelClasses)) {
      if (!modelClass.sync) continue

      const resourceType = modelClass.getModelName()

      resources[resourceType] = resourceConfigFromSyncDeclaration({declaration: modelClass.sync, modelClass, resourceType})
    }

    if (Object.keys(resources).length === 0) {
      throw new Error("SyncClient found no registered models declaring static sync - declare `static sync = true` (or a sync declaration object) on the models that should sync")
    }

    const resolvedSyncModel = syncModel || modelClasses.Sync

    if (!resolvedSyncModel) {
      throw new Error("SyncClient requires a registered \"Sync\" model for pending local sync rows (or pass options.syncModel)")
    }

    /** @type {import("./sync-client-types.js").SyncClientConfig} */
    this.config = {
      authenticationToken: clientConfiguration.authenticationToken,
      batchSize: clientConfiguration.batchSize,
      configuration,
      isOnline: clientConfiguration.isOnline,
      legacyCursor,
      onError: clientConfiguration.onError,
      postChanges: transportPoster({path: `${clientConfiguration.mountPath}/changes`, transport: clientConfiguration.transport}),
      postReplay: transportPoster({path: `${clientConfiguration.mountPath}/replay`, transport: clientConfiguration.transport}),
      realtime: clientConfiguration.realtime,
      resources,
      syncModel: resolvedSyncModel
    }
    this._clientNumber = ++clientCounter
    /** @type {SyncRealtimeBridge | null} */
    this._realtimeBridge = null
    /** @type {import("./sync-scope-store.js").default | null} */
    this._scopeStore = scopeStore || null
    /** @type {Promise<void> | null} */
    this._scheduledReplay = null
    /** @type {Record<string, import("./sync-api-client-types.js").SyncResourceConfig> | null} */
    this._pullResourceConfigs = null
    /** @type {Array<{callback: (record: ?) => Promise<void>, callbackName: "afterCreate" | "afterUpdate" | "afterDestroy", modelClass: ?}>} */
    this._trackedCallbacks = []
    /** @type {WeakSet<object>} */
    this._remoteApplyRecords = new WeakSet()
    this._withoutTrackingDepth = 0
    this._started = false
  }

  /**
   * Registers automatic mutation tracking for every declared resource (on by
   * default: local creates and updates queue pending sync rows once their
   * transaction commits and schedule an immediate replay attempt, without
   * app-side queue calls). `track: false` resources are skipped; `track: true`
   * adds destroys; an operations list narrows the tracked operations.
   * @returns {Promise<void>}
   */
  async start() {
    if (this._started) return

    this._started = true

    for (const [resourceType, resourceConfig] of Object.entries(this.config.resources)) {
      const operations = this.trackedOperations({resourceConfig, resourceType})

      for (const operation of operations) {
        const callbackName = TRACKED_CALLBACK_NAMES[operation]
        const callback = this.trackedMutationCallback({operation, resourceConfig})

        resourceConfig.modelClass[callbackName](callback)
        this._trackedCallbacks.push({callback, callbackName, modelClass: resourceConfig.modelClass})
      }
    }
  }

  /**
   * Unregisters all tracking callbacks (tests, sign-out, hot reload).
   * @returns {void}
   */
  stop() {
    for (const {callback, callbackName, modelClass} of this._trackedCallbacks) {
      modelClass.unregisterLifecycleCallback(callbackName, callback)
    }

    this._trackedCallbacks = []
    this._started = false
  }

  /**
   * Resolves and validates the tracked operations for a resource config.
   * Tracking is on by default: models declaring `static sync` without a `track`
   * key queue local creates and updates automatically; `track: false` opts a
   * model out (for models written by non-user flows).
   * @param {{resourceConfig: import("./sync-client-types.js").SyncClientResourceConfig, resourceType: string}} args - Resource config and name.
   * @returns {Array<"create" | "update" | "destroy">} Tracked operations.
   */
  trackedOperations({resourceConfig, resourceType}) {
    const track = resourceConfig.track

    if (track === false) return []
    if (track === undefined) return DEFAULT_TRACKED_OPERATIONS
    if (track === true) return ["create", "update", "destroy"]

    if (!track || typeof track !== "object" || !Array.isArray(track.operations) || track.operations.length === 0) {
      throw new Error(`SyncClient resource ${resourceType} track must be true or {operations: [...]}`)
    }

    for (const operation of track.operations) {
      if (!(operation in TRACKED_CALLBACK_NAMES)) {
        throw new Error(`SyncClient resource ${resourceType} track.operations must be create/update/destroy, got: ${String(operation)}`)
      }
    }

    return track.operations
  }

  /**
   * Builds the lifecycle callback queueing one tracked mutation. Queueing is
   * deferred through the model connection's afterCommit hook so it only runs
   * once the mutation's transaction has committed (immediately when no
   * transaction is open) - queued syncs never reference rolled-back rows.
   * Queue failures go to config.onError (or rethrow when none is configured),
   * matching the background replay failure policy.
   * @param {{operation: "create" | "update" | "destroy", resourceConfig: import("./sync-client-types.js").SyncClientResourceConfig}} args - Operation and resource config.
   * @returns {(record: ?) => Promise<void>} Lifecycle callback.
   */
  trackedMutationCallback({operation, resourceConfig}) {
    return async (record) => {
      if (this.isTrackingSuppressed(record)) return

      await resourceConfig.modelClass.connection().afterCommit(async () => {
        try {
          await SyncApiClient.queueLocalSync({
            booleanAttributes: resourceConfig.booleanAttributes || [],
            data: resourceConfig.trackedData ? resourceConfig.trackedData({operation, record}) : undefined,
            localOnlyAttributes: resourceConfig.localOnlyAttributes || [],
            resource: record,
            syncModel: this.config.syncModel,
            syncType: this.defaultSyncType({operation, record, resourceConfig})
          })
        } catch (error) {
          this.reportError(/** @type {Error} */ (error))

          return
        }

        this.scheduleReplay()
      })
    }
  }

  /**
   * Whether a record is currently being written by pull-apply (echo suppression).
   * @param {?} record - Local model record.
   * @returns {boolean} Whether the record write originates from a remote change.
   */
  isRemoteApply(record) {
    return this._remoteApplyRecords.has(record)
  }

  /**
   * Whether tracked mutation queueing is currently suppressed for a record:
   * either the record was marked as a remote apply (`markRemoteApply`, used by
   * pull and realtime applies) or a `withoutTracking` callback is running on
   * this client.
   * @param {?} record - Local model record.
   * @returns {boolean} Whether tracked queueing is suppressed for the record.
   */
  isTrackingSuppressed(record) {
    return this._withoutTrackingDepth > 0 || this.isRemoteApply(record)
  }

  /**
   * Runs a callback with tracked mutation queueing suppressed on this client -
   * for code applying server-originated data outside the derived pull/realtime
   * appliers (legacy pull paths, importers, sign-in backfills), so their writes
   * are not echoed back to the server as device changes. Suppression covers the
   * whole async duration of the callback (nested calls stack) and is
   * client-wide while it runs: mutations from concurrently running tasks are
   * also suppressed for that window, so prefer `markRemoteApply(record)` when
   * writes from other flows can interleave.
   * @template T
   * @param {() => Promise<T> | T} callback - Work whose model writes should not queue tracked syncs.
   * @returns {Promise<T>} The callback result.
   */
  async withoutTracking(callback) {
    this._withoutTrackingDepth++

    try {
      return await callback()
    } finally {
      this._withoutTrackingDepth--
    }
  }

  /**
   * Marks one record as being written from server-originated data so tracked
   * mutation queueing skips it (record-precise suppression). The derived pull
   * and realtime appliers use this internally around every applied write.
   * @param {?} record - Local model record about to be written.
   * @returns {() => void} Release callback re-enabling tracking for the record.
   */
  markRemoteApply(record) {
    this._remoteApplyRecords.add(record)

    return () => this._remoteApplyRecords.delete(record)
  }

  /**
   * Registers this client as the app's current sync client.
   * @returns {void}
   */
  setCurrent() {
    setCurrentSyncClient(this)
  }

  /**
   * Returns the app's current sync client.
   * @returns {SyncClient} Current sync client.
   */
  static current() {
    return /** @type {SyncClient} */ (currentSyncClient())
  }

  /**
   * Builds a sync client derived from the given configuration. Alias for
   * `new SyncClient({configuration, ...options})`.
   * @param {Configuration} [configuration] - Configuration owning the registered models and the sync.client block. Defaults to the current configuration.
   * @param {Omit<import("./sync-client-types.js").SyncClientOptions, "configuration">} [options] - Optional overrides.
   * @returns {SyncClient} Sync client derived from the configuration.
   */
  static fromConfiguration(configuration = Configuration.current(), options = {}) {
    return new SyncClient({...options, configuration})
  }

  /**
   * Declares (or re-activates) a sync scope from a model query and pulls it when online.
   * @param {import("../database/query/model-class-query.js").default<?>} query - Query declaring the sync scope.
   * @returns {Promise<{scope: import("./sync-client-types.js").SerializedSyncScope, pulled: import("./sync-api-client-types.js").SyncChangesResult | null}>} Declared scope and pull result (null while offline).
   */
  async sync(query) {
    const scope = serializedScopeFromQuery(query)
    const scopeStore = this.scopeStore()
    const scopeRow = await scopeStore.findOrCreateScope(scope)

    if (!scopeRow.cursorPayload && this.config.legacyCursor) {
      const legacyCursorPayload = await this.config.legacyCursor({scope})
      const legacyCursor = SyncApiClient.syncCursorFromPayload(legacyCursorPayload)

      if (legacyCursor) await scopeStore.saveCursor(scopeRow, legacyCursor)
    }

    return {pulled: await this.pull(), scope}
  }

  /**
   * Deactivates the sync scope declared by a model query.
   * @param {import("../database/query/model-class-query.js").default<?>} query - Query whose scope should stop syncing.
   * @returns {Promise<void>}
   */
  async unsync(query) {
    await this.scopeStore().deactivate(serializedScopeFromQuery(query))
  }

  /**
   * Pulls changes for every active scope with per-scope cursors (single-flighted, online-gated).
   * @returns {Promise<import("./sync-api-client-types.js").SyncChangesResult | null>} Combined pull result, or null while offline.
   */
  async pull() {
    if (!(await this.isOnline())) return null

    /** @type {import("./sync-api-client-types.js").SyncChangesResult | null} */
    let combinedResult = null

    await SyncApiClient.singleFlight(`velocious-sync-client-pull-${this._clientNumber}`, async () => {
      const authenticationToken = await this.config.authenticationToken()
      const scopeStore = this.scopeStore()
      const applySync = this.remoteApplySync()
      const result = {
        changed: false,
        pages: 0,
        resourceChanged: /** @type {Record<string, boolean>} */ ({}),
        resourceCounts: /** @type {Record<string, number>} */ ({}),
        syncedCount: 0
      }

      for (const scopeRow of await scopeStore.activeScopes()) {
        const scopeResult = await SyncApiClient.pullChanges({
          applySync,
          authenticationToken,
          batchSize: this.config.batchSize,
          loadCursor: async () => await scopeStore.loadCursor(scopeRow),
          postChanges: async (payload) => await this.config.postChanges({
            ...payload,
            scope: {conditions: scopeRow.conditions, resourceType: scopeRow.resourceType}
          }),
          saveCursor: async (cursor) => await scopeStore.saveCursor(scopeRow, cursor)
        })

        result.changed ||= scopeResult.changed
        result.pages += scopeResult.pages
        result.syncedCount += scopeResult.syncedCount

        for (const [resourceType, count] of Object.entries(scopeResult.resourceCounts)) {
          result.resourceCounts[resourceType] = (result.resourceCounts[resourceType] || 0) + count
        }
        for (const [resourceType, changed] of Object.entries(scopeResult.resourceChanged)) {
          result.resourceChanged[resourceType] ||= changed
        }
      }

      combinedResult = result
    })

    return combinedResult
  }

  /**
   * Builds the derived remote-change applier shared by pulls and realtime pushes:
   * applies through the declared resource configs, registers each written record
   * for echo suppression (tracked resources do not re-queue applied changes), and
   * fails loudly instead of silently skipping unconfigured resources.
   * @param {{source?: string}} [args] - Error context describing where the change came from.
   * @returns {(sync: import("./sync-api-client-types.js").SyncChangeEnvelope) => Promise<import("./sync-api-client-types.js").SyncChangeApplyResult>} Loud remote-change applier.
   */
  remoteApplySync({source = "pulled change"} = {}) {
    const pullResourceConfigs = this.pullResourceConfigs()
    const applier = SyncApiClient.resourceApplier(pullResourceConfigs, (record) => this.markRemoteApply(record))

    return async (sync) => {
      const resourceType = sync.resourceType()

      if (!resourceType || !pullResourceConfigs[resourceType]) {
        throw new Error(`No sync resource with pull attributes configured for ${source}: ${String(resourceType)}`)
      }

      return await applier(sync)
    }
  }

  /**
   * Subscribes the derived realtime channels so pushed websocket changes apply
   * through the same derived applier as pulls (idempotent, single-flighted).
   * @param {?} [context] - App context passed to the `sync.client.realtime.channels` callback (runtime values like eventId).
   * @returns {Promise<void>}
   */
  async subscribeRealtime(context) {
    await this.realtimeBridge().subscribe(context)
  }

  /**
   * Unsubscribes the realtime channels and disconnects the websocket client (idempotent).
   * @returns {Promise<void>}
   */
  async unsubscribeRealtime() {
    await this.realtimeBridge().unsubscribe()
  }

  /**
   * Reports the realtime subscription state and per-channel readiness.
   * @returns {ReturnType<SyncRealtimeBridge["status"]>} Realtime status.
   */
  realtimeStatus() {
    return this.realtimeBridge().status()
  }

  /**
   * Awaits all pending realtime message applies and any scheduled
   * pull-on-reconnect (useful in tests and shutdown flows).
   * @returns {Promise<void>}
   */
  async waitForRealtimeApplied() {
    await this.realtimeBridge().waitForApplied()
  }

  /**
   * Returns the lazily built realtime bridge.
   * @returns {SyncRealtimeBridge} Realtime bridge.
   */
  realtimeBridge() {
    this._realtimeBridge ||= new SyncRealtimeBridge({syncClient: this})

    return this._realtimeBridge
  }

  /**
   * Queues a local model change as a pending sync row and schedules an immediate
   * replay attempt (kept pending while offline or when the backend rejects it).
   * @param {{resource: ?, data?: Record<string, ?>, syncType?: string}} args - Queue args.
   * @returns {Promise<?>} Pending local sync row.
   */
  async queue({data, resource, syncType}) {
    const resourceConfig = this.resourceConfigFor(resource)
    const syncRow = await SyncApiClient.queueLocalSync({
      booleanAttributes: resourceConfig.booleanAttributes || [],
      data,
      localOnlyAttributes: resourceConfig.localOnlyAttributes || [],
      resource,
      syncModel: this.config.syncModel,
      syncType: syncType ?? this.defaultSyncType({operation: "update", record: resource, resourceConfig})
    })

    this.scheduleReplay()

    return syncRow
  }

  /**
   * Drains pending local sync rows to the backend (single-flighted, online-gated).
   * Rows are only marked successful after the backend acknowledges them.
   * @returns {Promise<void>}
   */
  async replayPending() {
    if (!(await this.isOnline())) return

    await SyncApiClient.singleFlight(`velocious-sync-client-replay-${this._clientNumber}`, async () => {
      await SyncApiClient.replayLocalSyncs({
        authenticationToken: await this.config.authenticationToken(),
        batchSize: this.config.batchSize,
        postReplay: this.config.postReplay,
        syncModel: this.config.syncModel
      })
    })
  }

  /**
   * Schedules a background replay attempt without blocking the caller.
   * Failures go to config.onError (or rethrow when none is configured).
   * @returns {void}
   */
  scheduleReplay() {
    this._scheduledReplay = (async () => {
      try {
        await this.replayPending()
      } catch (error) {
        this.reportError(/** @type {Error} */ (error))
      }
    })()
  }

  /**
   * Awaits the last scheduled background replay (useful in tests and shutdown flows).
   * @returns {Promise<void>}
   */
  async waitForScheduledReplay() {
    if (this._scheduledReplay) await this._scheduledReplay
  }

  /**
   * Reports a background sync failure.
   * @param {Error} error - Background failure.
   * @returns {void}
   */
  reportError(error) {
    if (this.config.onError) {
      this.config.onError(error)
      return
    }

    throw error
  }

  /**
   * Resolves connectivity through the configured gate.
   * @returns {Promise<boolean>} Whether the backend is considered reachable.
   */
  async isOnline() {
    if (!this.config.isOnline) return true

    return (await this.config.isOnline()) !== false
  }

  /**
   * Returns the scope store backing declared scopes and cursors.
   * @returns {import("./sync-scope-store.js").default} Scope store.
   */
  scopeStore() {
    this._scopeStore ||= new SyncScopeStore({configuration: this.config.configuration})

    return this._scopeStore
  }

  /**
   * Resolves the declared resource config for a local record.
   * @param {?} resource - Local model record.
   * @returns {import("./sync-client-types.js").SyncClientResourceConfig} Declared resource config.
   */
  resourceConfigFor(resource) {
    const modelClass = resource?.constructor

    if (typeof modelClass?.getModelName !== "function") {
      throw new Error(`Sync resources must be model records with a static getModelName(), got: ${String(resource)}`)
    }

    const resourceType = modelClass.getModelName()
    const resourceConfig = this.config.resources[resourceType]

    if (!resourceConfig) throw new Error(`No sync resource configured for: ${resourceType}`)

    return resourceConfig
  }

  /**
   * Resolves the sync type for a mutation through the resource config. The
   * "upsert" flag queues creates and updates as "update" rows (the server
   * upserts by resource id) and destroys as "delete" rows.
   * @param {{operation: "create" | "update" | "destroy", record: ?, resourceConfig: import("./sync-client-types.js").SyncClientResourceConfig}} args - Mutation args.
   * @returns {string} Sync type.
   */
  defaultSyncType({operation, record, resourceConfig}) {
    if (typeof resourceConfig.syncType === "function") return resourceConfig.syncType({operation, record})
    if (operation === "destroy") return "delete"
    if (resourceConfig.syncType === "upsert") return "update"

    return operation
  }

  /**
   * Derives the pull-apply resource configs from the declared resources.
   * @returns {Record<string, import("./sync-api-client-types.js").SyncResourceConfig>} Pull-apply resource configs.
   */
  pullResourceConfigs() {
    this._pullResourceConfigs ||= /** @type {Record<string, import("./sync-api-client-types.js").SyncResourceConfig>} */ (Object.fromEntries(
      Object.entries(this.config.resources)
        .filter(([, resource]) => Boolean(resource.attributes))
        .map(([resourceType, resource]) => [resourceType, {
          afterApply: resource.afterApply,
          attributes: /** @type {import("./sync-api-client-types.js").SyncResourceConfig["attributes"]} */ (resource.attributes),
          enabled: true,
          findRecord: resource.findRecord,
          findRecordForDelete: resource.findRecordForDelete,
          modelClass: resource.modelClass
        }])
    ))

    return this._pullResourceConfigs
  }
}

/**
 * Builds one resource config from a model's `static sync` declaration plus its
 * derived column metadata.
 * @param {{declaration: import("./sync-client-types.js").ModelSyncDeclaration, modelClass: ?, resourceType: string}} args - Declaration args.
 * @returns {import("./sync-client-types.js").SyncClientResourceConfig} Derived resource config.
 */
function resourceConfigFromSyncDeclaration({declaration, modelClass, resourceType}) {
  const normalizedDeclaration = declaration === true ? {} : declaration

  if (!normalizedDeclaration || typeof normalizedDeclaration !== "object" || Array.isArray(normalizedDeclaration)) {
    throw new Error(`${resourceType} static sync must be true or a sync declaration object, got: ${String(declaration)}`)
  }

  const {afterApply, attributes, booleanAttributes, findRecord, findRecordForDelete, localOnlyAttributes, realtime, syncType, track, trackedData, ...restDeclaration} = normalizedDeclaration
  const unknownKeys = Object.keys(restDeclaration)

  if (unknownKeys.length > 0) {
    throw new Error(`${resourceType} static sync received unknown keys: ${unknownKeys.join(", ")} (supported: afterApply, attributes, booleanAttributes, findRecord, findRecordForDelete, localOnlyAttributes, realtime, syncType, track, trackedData)`)
  }
  if (syncType !== undefined && typeof syncType !== "function" && syncType !== "upsert") {
    throw new Error(`${resourceType} static sync syncType must be a function or the string "upsert", got: ${String(syncType)}`)
  }

  const derived = derivedSyncAttributes({modelClass, resourceType})

  return {
    afterApply,
    attributes,
    booleanAttributes: mergedAttributeNames(derived.booleanAttributes, booleanAttributes),
    findRecord,
    findRecordForDelete,
    localOnlyAttributes: mergedAttributeNames(derived.localOnlyAttributes, localOnlyAttributes),
    modelClass,
    realtime,
    syncType,
    track: normalizedTrack(track),
    trackedData
  }
}

/**
 * Derives boolean and local-only attribute names from a model's column metadata:
 * booleans from boolean column types; local-only from the primary key,
 * createdAt/updatedAt, and sync bookkeeping columns.
 * @param {{modelClass: ?, resourceType: string}} args - Derivation args.
 * @returns {{booleanAttributes: string[], localOnlyAttributes: string[]}} Derived attribute names.
 */
function derivedSyncAttributes({modelClass, resourceType}) {
  if (
    typeof modelClass.getColumnNames !== "function" ||
    typeof modelClass.getColumnNameToAttributeNameMap !== "function" ||
    typeof modelClass.getColumnTypeByName !== "function" ||
    typeof modelClass.primaryKey !== "function" ||
    typeof modelClass.hasPrimaryKey !== "function"
  ) {
    throw new Error(`${resourceType} static sync requires a Velocious model class with column metadata (getColumnNames, getColumnNameToAttributeNameMap, getColumnTypeByName, primaryKey, hasPrimaryKey)`)
  }

  const columnNameToAttributeName = modelClass.getColumnNameToAttributeNameMap()
  /** @type {string[]} */
  const booleanAttributes = []
  /** @type {string[]} */
  const localOnlyAttributes = []

  if (modelClass.hasPrimaryKey()) {
    const primaryKeyColumn = modelClass.primaryKey()

    localOnlyAttributes.push(columnNameToAttributeName[primaryKeyColumn] || primaryKeyColumn)
  }

  for (const columnName of modelClass.getColumnNames()) {
    const attributeName = columnNameToAttributeName[columnName] || columnName
    const columnType = modelClass.getColumnTypeByName(columnName)

    if (LOCAL_BOOKKEEPING_ATTRIBUTE_NAMES.includes(attributeName) && !localOnlyAttributes.includes(attributeName)) {
      localOnlyAttributes.push(attributeName)
    }
    if (columnType && isBooleanColumnType(columnType)) {
      booleanAttributes.push(attributeName)
    }
  }

  return {booleanAttributes, localOnlyAttributes}
}

/**
 * Merges derived attribute names with declared extras into a sorted, duplicate-free list.
 * @param {string[]} derived - Derived attribute names.
 * @param {string[] | undefined} declared - Declared extra attribute names.
 * @returns {string[]} Merged attribute names.
 */
function mergedAttributeNames(derived, declared) {
  return [...new Set([...derived, ...(declared || [])])].sort()
}

/**
 * Normalizes a declaration's track value: an operations array is shorthand for
 * the {operations} form.
 * @param {import("./sync-client-types.js").ModelSyncDeclarationConfig["track"]} track - Declared track value.
 * @returns {import("./sync-client-types.js").SyncClientResourceConfig["track"]} Normalized track value.
 */
function normalizedTrack(track) {
  if (Array.isArray(track)) return {operations: track}

  return track
}

/**
 * Builds a framework-owned sync endpoint POSTer over the configured transport.
 * @param {{path: string, transport: import("../configuration-types.js").VelociousSyncClientTransport}} args - Poster args.
 * @returns {(payload: Record<string, ?>) => Promise<?>} Sync endpoint POSTer.
 */
function transportPoster({path, transport}) {
  return async (payload) => {
    const response = await transport.post(path, payload)

    if (!response || typeof response.json !== "function") {
      throw new Error(`sync.client transport.post must resolve to a response with a json() method for ${path} (like the frontend-model websocket client)`)
    }

    return await response.json()
  }
}

/**
 * Lazily builds (and memoizes per configuration) the sync client derived from the
 * app's Velocious configuration and registers it as the current sync client.
 * @param {Configuration} [configuration] - Configuration owning the registered models and the sync.client block. Defaults to the current configuration.
 * @returns {SyncClient} Memoized sync client for the configuration.
 */
export function syncClient(configuration = Configuration.current()) {
  let client = syncClientsByConfiguration.get(configuration)

  if (!client) {
    client = SyncClient.fromConfiguration(configuration)
    syncClientsByConfiguration.set(configuration, client)
    client.setCurrent()
  }

  return client
}

/**
 * Declares a sync scope on the current sync client.
 * @param {import("../database/query/model-class-query.js").default<?>} query - Query declaring the sync scope.
 * @returns {Promise<{scope: import("./sync-client-types.js").SerializedSyncScope, pulled: import("./sync-api-client-types.js").SyncChangesResult | null}>} Declared scope and pull result.
 */
export async function sync(query) {
  return await SyncClient.current().sync(query)
}
