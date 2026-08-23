// @ts-check

import Configuration from "../configuration.js"
import {isBooleanColumnType} from "../database/column-types.js"
import Logger from "../logger.js"
import {captureRemoteRequestContext, mergeRemoteRequestContext} from "../remote-request-context.js"
import restArgsError from "../utils/rest-args-error.js"
import VelociousWebsocketClient from "../http-client/websocket-client.js"

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

const SYNC_REQUEST_RESERVED_KEYS = [
  "afterId",
  "afterServerSequence",
  "afterUpdatedAt",
  "authenticationToken",
  "limit",
  "scope",
  "syncs",
  "upstreamRefresh",
  "upToId",
  "upToServerSequence",
  "upToUpdatedAt"
]

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
    const {configuration = Configuration.current(), databaseIdentifier, legacyCursor, requestContext, scopeStore, syncModel, tenantHandle, ...restOptions} = options

    restArgsError(restOptions)

    const clientConfiguration = configuration.getSyncConfiguration().client
    const capturedRequestContext = captureRemoteRequestContext(requestContext, {
      label: "Sync client request context",
      reservedKeys: SYNC_REQUEST_RESERVED_KEYS
    })

    if (!clientConfiguration) {
      throw new Error("SyncClient requires a sync.client configuration block: new Configuration({sync: {client: {authenticationToken, transport}}})")
    }

    if (Boolean(tenantHandle) !== Boolean(databaseIdentifier)) {
      throw new Error("SyncClient tenantHandle and databaseIdentifier must be provided together")
    }
    if (tenantHandle) {
      tenantHandle.assertConfiguration(configuration)
      tenantHandle.databaseConfiguration(/** @type {string} */ (databaseIdentifier))
    }

    const modelClasses = configuration.getModelClasses()
    const resolvedSyncModel = syncModel || modelClasses.Sync
    const databaseIdentity = tenantHandle ? tenantHandle.databaseIdentity(/** @type {string} */ (databaseIdentifier)) : null
    /** @type {Record<string, import("./sync-client-types.js").SyncClientResourceConfig>} */
    const resources = {}

    for (const modelClass of Object.values(modelClasses)) {
      if (!modelClass.sync) continue
      if (tenantHandle && modelClass.getDatabaseIdentifier({tenant: tenantHandle.tenant()}) !== databaseIdentifier) continue

      const resourceType = modelClass.getModelName()

      const metadataModelClass = tenantHandle
        ? tenantHandle.metadataModelClass({databaseIdentifier: /** @type {string} */ (databaseIdentifier), modelClass})
        : modelClass
      const resourceConfig = resourceConfigFromSyncDeclaration({declaration: modelClass.sync, metadataModelClass, modelClass, resourceType})

      if (databaseIdentity && resourceConfig.conflictTracking) {
        resourceConfig.conflictTracking = {
          ...resourceConfig.conflictTracking,
          mutationLog: resourceConfig.conflictTracking.mutationLog.partition(databaseIdentity)
        }
      }

      resources[resourceType] = resourceConfig
    }

    if (Object.keys(resources).length === 0) {
      throw new Error("SyncClient found no registered models declaring static sync - declare `static sync = true` (or a sync declaration object) on the models that should sync")
    }

    if (!resolvedSyncModel) {
      throw new Error("SyncClient requires a registered \"Sync\" model for pending local sync rows (or pass options.syncModel)")
    }
    if (tenantHandle && resolvedSyncModel.getDatabaseIdentifier({tenant: tenantHandle.tenant()}) !== databaseIdentifier) {
      throw new Error(`SyncClient sync model does not use tenant database ${JSON.stringify(databaseIdentifier)}`)
    }

    /** @type {import("./sync-client-types.js").SyncClientConfig} */
    this.config = {
      authenticationToken: clientConfiguration.authenticationToken,
      batchSize: clientConfiguration.batchSize,
      configuration,
      databaseIdentifier,
      isOnline: clientConfiguration.isOnline,
      legacyCursor,
      onError: clientConfiguration.onError,
      postChanges: transportPoster({path: `${clientConfiguration.mountPath}/changes`, requestContext: capturedRequestContext, transport: clientConfiguration.transport}),
      postReplay: transportPoster({path: `${clientConfiguration.mountPath}/replay`, requestContext: capturedRequestContext, transport: clientConfiguration.transport}),
      realtime: clientConfiguration.realtime,
      requestContext: capturedRequestContext,
      resources,
      syncModel: resolvedSyncModel,
      tenantHandle,
      websocketClient: clientConfiguration.websocketClient,
      websocketUrl: clientConfiguration.websocketUrl
    }
    this._clientNumber = ++clientCounter
    this._databaseIdentity = databaseIdentity
    this._tenantSchemaGeneration = tenantHandle
      ? tenantHandle.inspect({databaseIdentifier: /** @type {string} */ (databaseIdentifier)}).schemaGeneration
      : null
    /** @type {SyncRealtimeBridge | null} */
    this._realtimeBridge = null
    /** @type {import("./sync-client-types.js").SyncClientSharedConnection | null | undefined} Shared app-lifetime websocket connection (undefined until first resolved, null when none is configured). */
    this._syncConnection = undefined
    /** @type {Promise<void> | null} */
    this._subscribeUserScopePromise = null
    /** @type {"subscribed" | "subscribing" | "unsubscribed"} */
    this._userScopeState = "unsubscribed"
    /** @type {import("./sync-scope-store.js").default | null} */
    this._scopeStore = scopeStore || null
    /** @type {Promise<void> | null} */
    this._scheduledReplay = null
    /** @type {Record<string, import("./sync-api-client-types.js").SyncResourceConfig> | null} */
    this._pullResourceConfigs = null
    /** @type {Array<{callback: (record: ReturnType<typeof JSON.parse>) => Promise<void> | void, callbackName: "afterCreate" | "afterUpdate" | "afterDestroy" | "beforeUpdate" | "beforeDestroy", modelClass: ReturnType<typeof JSON.parse>}>} */
    this._trackedCallbacks = []
    /** @type {WeakSet<object>} */
    this._remoteApplyRecords = new WeakSet()
    /** @type {Map<string, number>} */
    this._remoteGenerations = new Map()
    /** @type {WeakMap<object, Array<string | number | null>>} */
    this._capturedBaseVersions = new WeakMap()
    this._withoutTrackingDepth = 0
    /** @type {Logger | {error: (...messages: Array<ReturnType<typeof JSON.parse>>) => Promise<void>} | null} */
    this._logger = null
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
    this.assertTenantReady()
    if (this._started) return

    this._started = true

    for (const [resourceType, resourceConfig] of Object.entries(this.config.resources)) {
      const operations = this.trackedOperations({resourceConfig, resourceType})

      if (resourceConfig.conflictTracking) {
        for (const operation of operations.filter((candidate) => candidate !== "create")) {
          const callbackName = operation === "destroy" ? "beforeDestroy" : "beforeUpdate"
          const callback = (/** @type {ReturnType<typeof JSON.parse>} */ record) => {
            if (!this.ownsRecord(record)) return
            if (this.isTrackingSuppressed(record)) return

            const capturedVersions = this._capturedBaseVersions.get(record) || []

            capturedVersions.push(this.preMutationBaseVersionFor({operation, record, resourceConfig}))
            this._capturedBaseVersions.set(record, capturedVersions)
          }

          resourceConfig.modelClass[callbackName](callback)
          this._trackedCallbacks.push({callback, callbackName, modelClass: resourceConfig.modelClass})
        }
      }

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
   * Builds the lifecycle callback queueing one tracked mutation. The queued
   * payload and sync type are snapshotted at mutation-callback time, so
   * afterSave hooks assigning unsaved attributes (or any later drift on the
   * record) cannot change what gets queued vs what was committed. Queueing is
   * deferred through the model connection's afterCommit hook so it only runs
   * once the mutation's transaction has committed (immediately when no
   * transaction is open) - queued syncs never reference rolled-back rows.
   * Post-commit queue failures are reported without rethrowing into the
   * driver's afterCommit chain (see reportAfterCommitError).
   * @param {{operation: "create" | "update" | "destroy", resourceConfig: import("./sync-client-types.js").SyncClientResourceConfig}} args - Operation and resource config.
   * @returns {(record: ReturnType<typeof JSON.parse>) => Promise<void>} Lifecycle callback.
   */
  trackedMutationCallback({operation, resourceConfig}) {
    return async (record) => {
      if (!this.ownsRecord(record)) return
      if (this.isTrackingSuppressed(record)) return

      const data = SyncApiClient.queuedSyncData({
        booleanAttributes: resourceConfig.booleanAttributes || [],
        data: resourceConfig.trackedData ? resourceConfig.trackedData({operation, record}) : undefined,
        localOnlyAttributes: resourceConfig.localOnlyAttributes || [],
        resource: record
      })
      const syncType = this.defaultSyncType({operation, record, resourceConfig})
      const baseVersion = resourceConfig.conflictTracking
        ? this.capturedBaseVersionFor({operation, record, resourceConfig})
        : null
      const databaseOperation = record.databaseOperation()
      const operationScope = databaseOperation
        ? databaseOperation.forModel(this.config.syncModel)
        : this.config.syncModel

      await record.connection().afterCommit(async () => {
        try {
          if (resourceConfig.conflictTracking) {
            await SyncApiClient.queueConflictTrackedSync({
              baseVersion,
              conflictTracking: resourceConfig.conflictTracking,
              data,
              operation,
              resource: record,
              resourceType: record.constructor.getModelName(),
              syncType
            })
          } else {
            await SyncApiClient.queueLocalSync({data, resource: record, syncModel: operationScope, syncType})
          }
        } catch (error) {
          await this.reportAfterCommitError(/** @type {Error} */ (error))

          return
        }

        this.scheduleReplay()
      })
    }
  }

  /**
   * Reports a post-commit tracked-queueing failure. The transaction has already
   * committed when afterCommit callbacks run, so rethrowing here would poison
   * the driver's awaited afterCommit chain (breaking unrelated callbacks) -
   * instead the failure goes to the configured sync.client.onError hook, or is
   * logged loudly through the client's logger when none is configured.
   * @param {Error} error - Post-commit queueing failure.
   * @returns {Promise<void>}
   */
  async reportAfterCommitError(error) {
    if (this.config.onError) {
      this.config.onError(error)

      return
    }

    await this.logger().error("SyncClient failed to queue a tracked mutation after commit", error)
  }

  /**
   * Returns the lazily built client logger.
   * @returns {Logger | {error: (...messages: Array<ReturnType<typeof JSON.parse>>) => Promise<void>}} Client logger.
   */
  logger() {
    this._logger ||= new Logger("SyncClient", {configuration: this.config.configuration})

    return this._logger
  }

  /**
   * Whether a record is currently being written by pull-apply (echo suppression).
   * @param {ReturnType<typeof JSON.parse>} record - Local model record.
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
   * @param {ReturnType<typeof JSON.parse>} record - Local model record.
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
   * @param {ReturnType<typeof JSON.parse>} record - Local model record about to be written.
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
   * @param {import("../database/query/model-class-query.js").default<ReturnType<typeof JSON.parse>>} query - Query declaring the sync scope.
   * @param {object} [options] - Sync options.
   * @param {(progress: import("./sync-api-client-types.js").SyncPullProgress) => void} [options.onProgress] - Called per applied page of the pull this declaration triggers, so the initial import of a newly declared scope can drive a "syncedCount of total" progress bar. See `pull()`.
   * @param {boolean} [options.upstreamRefresh] - Marks the changes request(s) as a user-initiated refresh, so the server can bypass upstream-import throttle windows. See `pull()`.
   * @returns {Promise<{scope: import("./sync-client-types.js").SerializedSyncScope, pulled: import("./sync-api-client-types.js").SyncChangesResult | null}>} Declared scope and pull result (null while offline).
   */
  async sync(query, {onProgress, upstreamRefresh} = {}) {
    this.assertQueryOwnership(query)
    const scope = serializedScopeFromQuery(query)
    const scopeStore = this.scopeStore()
    const scopeRow = await scopeStore.findOrCreateScope(scope)

    if (!scopeRow.cursorPayload && this.config.legacyCursor) {
      const legacyCursorPayload = await this.config.legacyCursor({scope})
      const legacyCursor = SyncApiClient.syncCursorFromPayload(legacyCursorPayload)

      if (legacyCursor) await scopeStore.saveCursor(scopeRow, legacyCursor)
    }

    return {pulled: await this.pull({onProgress, upstreamRefresh}), scope}
  }

  /**
   * Deactivates the sync scope declared by a model query.
   * @param {import("../database/query/model-class-query.js").default<ReturnType<typeof JSON.parse>>} query - Query whose scope should stop syncing.
   * @returns {Promise<void>}
   */
  async unsync(query) {
    this.assertQueryOwnership(query)
    await this.scopeStore().deactivate(serializedScopeFromQuery(query))
  }

  /**
   * Pulls changes for every active scope with per-scope cursors (single-flighted, online-gated).
   * @param {object} [options] - Pull options.
   * @param {(progress: import("./sync-api-client-types.js").SyncPullProgress) => void} [options.onProgress] - Called per applied page with cumulative `{pages, syncedCount, total}` across the pulled scopes, for rendering a "syncedCount of total" progress bar (e.g. a full-import screen). Optional; omitting it keeps the existing behavior.
   * @param {boolean} [options.upstreamRefresh] - Sends `upstreamRefresh: true` on the changes request(s), telling the server this pull is user-initiated so it can bypass upstream-import throttle windows (see docs/sync-upstream-imports.md). Background pulls omit it and stay throttled.
   * @returns {Promise<import("./sync-api-client-types.js").SyncChangesResult | null>} Combined pull result, or null while offline.
   */
  async pull({onProgress, upstreamRefresh} = {}) {
    this.assertTenantReady()
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
        syncedCount: 0,
        total: 0
      }

      for (const scopeRow of await scopeStore.activeScopes()) {
        // Cumulate scope progress onto the counts of the scopes already pulled so a single
        // scope's per-page progress reads exactly its own counts (base 0), and multi-scope
        // pulls report a running cumulative total across every scope.
        const basePages = result.pages
        const baseSyncedCount = result.syncedCount
        const baseTotal = result.total
        const scopeResult = await SyncApiClient.pullChanges({
          applySync,
          authenticationToken,
          batchSize: this.config.batchSize,
          loadCursor: async () => await scopeStore.loadCursor(scopeRow),
          onProgress: onProgress ? (progress) => onProgress({
            pages: basePages + progress.pages,
            syncedCount: baseSyncedCount + progress.syncedCount,
            total: baseTotal + progress.total
          }) : undefined,
          postChanges: async (payload) => await this.config.postChanges({
            ...payload,
            // Only the all-types scope carries the type list; a type-declared scope needs none.
            scope: {
              conditions: scopeRow.conditions,
              resourceType: scopeRow.resourceType,
              ...(scopeRow.resourceType === null ? {resourceTypes: this.userScopeResourceTypes()} : {})
            },
            ...(upstreamRefresh ? {upstreamRefresh: true} : {})
          }),
          saveCursor: async (cursor) => await scopeStore.saveCursor(scopeRow, cursor)
        })

        result.changed ||= scopeResult.changed
        result.pages += scopeResult.pages
        result.syncedCount += scopeResult.syncedCount
        result.total += scopeResult.total

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
    return async (sync) => {
      const resourceType = sync.resourceType()
      const configuredResource = resourceType ? this.config.resources[resourceType] : undefined

      if (!resourceType || !configuredResource?.attributes) {
        throw new Error(`No sync resource with pull attributes configured for ${source}: ${String(resourceType)}`)
      }

      return await this.withTenantOperation(async (operation) => {
        const data = sync.data()
        const versionAttribute = this.config.resources[resourceType].conflictTracking?.versionAttribute

        if (versionAttribute) {
          const dataAttributes = data && typeof data === "object" && !Array.isArray(data)
            ? /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (data)
            : {}

          this.noteRemoteVersion({resourceId: String(sync.resourceId()), resourceType, version: dataAttributes[versionAttribute]})
        }

        const pullResourceConfigs = this.pullResourceConfigs(operation)
        const applier = SyncApiClient.resourceApplier(pullResourceConfigs, (record) => {
          if (operation) this.bindRemoteRecord({operation, record})

          return this.markRemoteApply(record)
        })

        return await applier(sync)
      })
    }
  }

  /**
   * Resolves the shared app-lifetime websocket connection all sync traffic
   * rides, or null when none is configured. Built once and memoized (per
   * client): an app-provided `sync.client.websocketClient` instance wins (the
   * frontend-model transport can pass its own client so one socket carries
   * everything), else a framework-owned reconnecting {@link VelociousWebsocketClient}
   * built from `sync.client.websocketUrl`. The realtime bridge rides this
   * connection without owning its lifecycle; when neither is configured the
   * bridge falls back to the deprecated per-cycle `realtime.createClient`.
   * @returns {import("./sync-client-types.js").SyncClientSharedConnection | null} Shared websocket connection, or null.
   */
  syncConnection() {
    if (this._syncConnection !== undefined) return this._syncConnection

    if (this.config.websocketClient) {
      this._syncConnection = this.config.websocketClient
    } else if (this.config.websocketUrl) {
      const url = typeof this.config.websocketUrl === "function" ? this.config.websocketUrl() : this.config.websocketUrl

      this._syncConnection = url ? new VelociousWebsocketClient({url}) : null
    } else {
      this._syncConnection = null
    }

    return this._syncConnection
  }

  /**
   * Subscribes the derived realtime channels so pushed websocket changes apply
   * through the same derived applier as pulls (idempotent, single-flighted).
   * @param {ReturnType<typeof JSON.parse>} [context] - App context passed to the deprecated `sync.client.realtime.channels` callback (runtime scope values).
   * @returns {Promise<void>}
   */
  async subscribeRealtime(context) {
    this.assertTenantReady()
    await this.realtimeBridge().subscribe(context)
  }

  /**
   * Subscribes the server-enumerated user scope: "everything my ability can
   * see". Declares a user scope (empty conditions) for every pullable synced
   * resource type, subscribes realtime so their framework sync channel
   * subscriptions go live, and pulls so the device catches up. The server
   * authorizes each empty-conditions scope through the app sync resource's
   * `authorizeChanges` and re-checks record access per delivery, so the client
   * subscribes with just its token and the server decides membership.
   * Idempotent and single-flighted like {@link SyncClient#subscribeRealtime}.
   * @returns {Promise<void>}
   */
  async subscribeUserScope() {
    if (this._userScopeState === "subscribed") return

    if (!this._subscribeUserScopePromise) {
      this._subscribeUserScopePromise = this._subscribeUserScope().finally(() => {
        this._subscribeUserScopePromise = null
      })
    }

    await this._subscribeUserScopePromise
  }

  /**
   * Declares and activates the user scope for every pullable resource, then
   * subscribes realtime and pulls.
   * @returns {Promise<void>}
   */
  async _subscribeUserScope() {
    this._userScopeState = "subscribing"

    await this.scopeStore().findOrCreateScope(await this.userScope())

    await this.subscribeRealtime()
    await this.pull()

    this._userScopeState = "subscribed"
  }

  /**
   * Unsubscribes the user scope: deactivates the per-resource user scopes and
   * closes the realtime channel subscriptions. The shared websocket connection
   * stays open when one is configured (sign-out drops subscriptions without
   * disconnecting), so a subsequent sign-in resubscribes over the same socket.
   * @returns {Promise<void>}
   */
  async unsubscribeUserScope() {
    await this.scopeStore().deactivate(await this.userScope())

    await this.unsubscribeRealtime()

    this._userScopeState = "unsubscribed"
    this._subscribeUserScopePromise = null
  }

  /**
   * The user scope: a single all-types scope (null resourceType) with empty
   * conditions, partitioned locally by owner. One scope - not one per resource
   * type - so the server authorizes the caller once per sync and per subscribe,
   * however many resource types it serves. The server decides which types the
   * caller may see; the client applies each pulled row by the resource type on
   * its own envelope.
   * @returns {Promise<import("./sync-client-types.js").SerializedSyncScope>} The user scope.
   */
  async userScope() {
    return {conditions: {}, owner: await this.userScopeOwner(), resourceType: null}
  }

  /**
   * The resource types the user scope covers: every declared resource that
   * receives pulled changes (has pull `attributes`), so the client can apply
   * them. Sent with the scope as a delivery/type filter - it narrows, never
   * widens, what the server's authorization already allows, and it keeps a
   * broadcast of a type this client cannot apply from reaching the server's
   * per-delivery access re-check (a database query per matched broadcast, per
   * subscribed device).
   * @returns {string[]} Pullable resource type names.
   */
  userScopeResourceTypes() {
    return Object.keys(this.pullResourceConfigs())
  }

  /**
   * Resolves the local partition key for the user scope: the currently
   * configured authenticated identity (the sync auth token). Partitioning the
   * user scope's local scope/cursor rows by this owner keeps the
   * empty-conditions cursor from leaking across accounts on a shared device
   * (account B signing in after account A gets a fresh cursor) while the same
   * account reconnecting keeps its cursor continuity. The owner is a local
   * partition key only — pulls still post empty conditions to the server.
   * @returns {Promise<string>} User-scope owner partition key.
   */
  async userScopeOwner() {
    return String(await this.config.authenticationToken())
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
   * @param {{baseVersion?: string | number | null, resource: ReturnType<typeof JSON.parse>, data?: Record<string, ReturnType<typeof JSON.parse>>, operation?: "create" | "update" | "destroy", syncType?: string}} args - Queue args.
   * @returns {Promise<ReturnType<typeof JSON.parse> | import("./local-mutation-log.js").LocalMutationLogRecord>} Pending local sync row or durable conflict-tracked intent.
   */
  async queue({baseVersion, data, operation = "update", resource, syncType}) {
    this.assertTenantReady()
    this.assertRecordOwnership(resource)
    const resourceConfig = this.resourceConfigFor(resource)
    const resolvedSyncType = syncType ?? this.defaultSyncType({operation, record: resource, resourceConfig})

    if (resourceConfig.conflictTracking) {
      const queuedData = SyncApiClient.queuedSyncData({
        booleanAttributes: resourceConfig.booleanAttributes || [],
        data,
        localOnlyAttributes: resourceConfig.localOnlyAttributes || [],
        resource
      })
      const record = await SyncApiClient.queueConflictTrackedSync({
        baseVersion: baseVersion === undefined ? this.baseVersionFor({operation, record: resource, resourceConfig}) : baseVersion,
        conflictTracking: resourceConfig.conflictTracking,
        data: queuedData,
        operation,
        resource,
        resourceType: resource.constructor.getModelName(),
        syncType: resolvedSyncType
      })

      this.scheduleReplay()

      return record
    }

    const syncRow = await this.withTenantOperation(async (databaseOperation) => await SyncApiClient.queueLocalSync({
      booleanAttributes: resourceConfig.booleanAttributes || [],
      data,
      localOnlyAttributes: resourceConfig.localOnlyAttributes || [],
      resource,
      syncModel: databaseOperation ? databaseOperation.modelClass(this.config.syncModel) : this.config.syncModel,
      syncType: resolvedSyncType
    }))

    this.scheduleReplay()

    return syncRow
  }

  /**
   * Drains pending local sync rows to the backend (single-flighted, online-gated).
   * Rows are only marked successful after the backend acknowledges them.
   * @returns {Promise<void>}
   */
  async replayPending() {
    this.assertTenantReady()
    if (!(await this.isOnline())) return

    await SyncApiClient.singleFlight(`velocious-sync-client-replay-${this._clientNumber}`, async () => await this.withTenantOperation(async (operation) => {
      for (const [resourceType, resourceConfig] of Object.entries(this.config.resources)) {
        if (!resourceConfig.conflictTracking) continue

        await SyncApiClient.replayConflictTrackedSyncs({
          authenticationToken: await this.config.authenticationToken(),
          batchSize: this.config.batchSize,
          conflictTracking: resourceConfig.conflictTracking,
          postReplay: this.config.postReplay,
          remoteGeneration: (identity) => this._remoteGenerations.get(identity) || 0,
          resourceType
        })
      }

      await SyncApiClient.replayLocalSyncs({
        authenticationToken: await this.config.authenticationToken(),
        batchSize: this.config.batchSize,
        postReplay: this.config.postReplay,
        syncModel: operation ? operation.modelClass(this.config.syncModel) : this.config.syncModel
      })
    }))
  }

  /**
   * Records an authoritative remote observation so an in-flight acknowledgement
   * cannot rebase a successor across that observation.
   * @param {{resourceId: string | number, resourceType: string, version?: string | number | null}} args - Remote identity.
   * @returns {void}
   */
  noteRemoteVersion({resourceId, resourceType, version}) {
    void version
    const identity = `${resourceType}:${String(resourceId)}`

    this._remoteGenerations.set(identity, (this._remoteGenerations.get(identity) || 0) + 1)
  }

  /**
   * Reads the authoritative base version observed before a local mutation.
   * @param {{operation: "create" | "update" | "destroy", record: ReturnType<typeof JSON.parse>, resourceConfig: import("./sync-client-types.js").SyncClientResourceConfig}} args - Version args.
   * @returns {string | number | null} Base version.
   */
  baseVersionFor({operation, record, resourceConfig}) {
    if (operation === "create") return null

    const versionAttribute = resourceConfig.conflictTracking?.versionAttribute

    if (!versionAttribute) return null

    const value = record.readAttribute(versionAttribute)

    if (value instanceof Date) return value.toISOString()
    if (value === null || typeof value === "string" || typeof value === "number") return value

    throw new Error(`Sync conflict version ${versionAttribute} must be a Date, string, number, or null`)
  }

  /**
   * Reads the pre-assignment value exposed by record changes during beforeUpdate.
   * Deletes have no version change pair and use the record's current version.
   * @param {{operation: "create" | "update" | "destroy", record: ReturnType<typeof JSON.parse>, resourceConfig: import("./sync-client-types.js").SyncClientResourceConfig}} args - Version args.
   * @returns {string | number | null} Pre-mutation base version.
   */
  preMutationBaseVersionFor({operation, record, resourceConfig}) {
    const versionAttribute = resourceConfig.conflictTracking?.versionAttribute
    const versionColumn = versionAttribute
      ? record.constructor.getAttributeNameToColumnNameMap()[versionAttribute]
      : undefined
    const versionChange = operation === "update" && versionColumn
      ? record.changes()[versionColumn]
      : undefined

    if (!versionChange) return this.baseVersionFor({operation, record, resourceConfig})

    const value = versionChange[0]

    if (value instanceof Date) return value.toISOString()
    if (value === null || typeof value === "string" || typeof value === "number") return value

    throw new Error(`Sync conflict version ${versionAttribute} must be a Date, string, number, or null`)
  }

  /**
   * Consumes the base captured for this lifecycle event before its after-commit
   * closure is deferred, preserving repeated same-record writes in one transaction.
   * @param {{operation: "create" | "update" | "destroy", record: ReturnType<typeof JSON.parse>, resourceConfig: import("./sync-client-types.js").SyncClientResourceConfig}} args - Capture args.
   * @returns {string | number | null} Captured base version.
   */
  capturedBaseVersionFor({operation, record, resourceConfig}) {
    if (operation === "create") return null

    const capturedVersions = this._capturedBaseVersions.get(record)
    const baseVersion = capturedVersions?.shift()

    if (capturedVersions?.length === 0) this._capturedBaseVersions.delete(record)
    if (baseVersion !== undefined) return baseVersion

    return this.baseVersionFor({operation, record, resourceConfig})
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
    this.assertTenantReady()

    if (this._scopeStore && this._databaseIdentity && this._scopeStore.storeIdentity !== this._databaseIdentity) {
      throw new Error("SyncClient scope store belongs to another or unresolved physical tenant database")
    }

    this._scopeStore ||= new SyncScopeStore({
      configuration: this.config.configuration,
      databaseIdentifier: this.config.databaseIdentifier,
      tenantHandle: this.config.tenantHandle
    })

    return this._scopeStore
  }

  /**
   * Resolves the declared resource config for a local record.
   * @param {ReturnType<typeof JSON.parse>} resource - Local model record.
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
   * @param {{operation: "create" | "update" | "destroy", record: ReturnType<typeof JSON.parse>, resourceConfig: import("./sync-client-types.js").SyncClientResourceConfig}} args - Mutation args.
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
   * @param {import("../database/operation.js").default | null} [operation] - Tenant operation binding the resource model classes.
   * @returns {Record<string, import("./sync-api-client-types.js").SyncResourceConfig>} Pull-apply resource configs.
   */
  pullResourceConfigs(operation) {
    if (!operation && this._pullResourceConfigs) return this._pullResourceConfigs

    const resourceConfigs = /** @type {Record<string, import("./sync-api-client-types.js").SyncResourceConfig>} */ (Object.fromEntries(
      Object.entries(this.config.resources)
        .filter(([, resource]) => Boolean(resource.attributes))
        .map(([resourceType, resource]) => {
          const modelClass = operation ? operation.modelClass(resource.modelClass) : resource.modelClass
          const findRecord = resource.findRecord
          const findRecordForDelete = resource.findRecordForDelete

          return [resourceType, {
            afterApply: resource.afterApply,
            attributes: /** @type {import("./sync-api-client-types.js").SyncResourceConfig["attributes"]} */ (resource.attributes),
            enabled: true,
            findRecord: operation && findRecord
              ? (args) => findRecord({...args, modelClass, operation: operation || null})
              : findRecord,
            findRecordForDelete: operation && findRecordForDelete
              ? (args) => findRecordForDelete({...args, modelClass, operation: operation || null})
              : findRecordForDelete,
            modelClass
          }]
        })
    ))

    if (!operation) this._pullResourceConfigs = resourceConfigs

    return resourceConfigs
  }

  /**
   * Runs local state work on this client's captured tenant, or directly for the legacy default-database client.
   * @template T
   * @param {(operation: import("../database/operation.js").default | null) => Promise<T>} callback - Bound work.
   * @returns {Promise<T>} Callback result.
   */
  async withTenantOperation(callback) {
    if (!this.config.tenantHandle || !this.config.databaseIdentifier) return await callback(null)
    this.assertTenantReady()

    return await this.config.tenantHandle.databaseOperation({
      databaseIdentifier: this.config.databaseIdentifier,
      name: "Tenant SyncClient"
    }, async (operation) => {
      await operation.ensureModelInitialized(this.config.syncModel)

      return await callback(operation)
    })
  }

  /**
   * Reports whether a record belongs to this client's physical database.
   * @param {ReturnType<typeof JSON.parse>} record - Candidate record.
   * @returns {boolean} Whether this client owns it.
   */
  ownsRecord(record) {
    if (!this._databaseIdentity) return true

    const databaseOperation = record.databaseOperation()

    return record.databaseIdentity() === this._databaseIdentity &&
      databaseOperation?.schemaGeneration() === this._tenantSchemaGeneration
  }

  /**
   * Rejects a record not owned by this client's physical database.
   * @param {ReturnType<typeof JSON.parse>} record - Candidate record.
   * @returns {void}
   */
  assertRecordOwnership(record) {
    if (!this.ownsRecord(record)) throw new Error("SyncClient resource belongs to another or unresolved physical tenant database")
  }

  /**
   * Validates a declared query against this client's captured tenant database.
   * @param {import("../database/query/model-class-query.js").default<ReturnType<typeof JSON.parse>>} query - Scope query.
   * @returns {void}
   */
  assertQueryOwnership(query) {
    if (!this.config.tenantHandle || !this.config.databaseIdentifier) return

    const modelClass = query.getModelClass()
    const databaseIdentifier = modelClass.getDatabaseIdentifier({tenant: this.config.tenantHandle.tenant()})
    const queryDatabaseIdentity = query._operation?.databaseIdentity()

    if (databaseIdentifier !== this.config.databaseIdentifier ||
      !this.config.resources[modelClass.getModelName()] ||
      queryDatabaseIdentity !== this._databaseIdentity) {
      throw new Error("SyncClient scope belongs to another or unresolved physical tenant database")
    }
  }

  /**
   * Rejects work after the handle's ready physical schema generation changed or closed.
   * @returns {void}
   */
  assertTenantReady() {
    if (!this.config.tenantHandle || !this.config.databaseIdentifier) return

    const lifecycle = this.config.tenantHandle.inspect({databaseIdentifier: this.config.databaseIdentifier})

    if (!lifecycle.ready || !lifecycle.schemaGeneration || lifecycle.schemaGeneration !== this._tenantSchemaGeneration) {
      throw new Error("SyncClient tenant database generation is stale or not ready")
    }
  }

  /**
   * Binds a custom remote resolver result to the active tenant operation after proving its captured identity.
   * @param {{operation: import("../database/operation.js").default, record: ReturnType<typeof JSON.parse>}} args - Binding args.
   * @returns {void}
   */
  bindRemoteRecord({operation, record}) {
    if (record.databaseOperation?.() === operation) return
    this.assertRecordOwnership(record)
    operation.bindRecord(record)
  }
}

/**
 * Builds one resource config from a model's `static sync` declaration plus its
 * derived column metadata.
 * @param {{declaration: import("./sync-client-types.js").ModelSyncDeclaration, metadataModelClass: ReturnType<typeof JSON.parse>, modelClass: ReturnType<typeof JSON.parse>, resourceType: string}} args - Declaration args.
 * @returns {import("./sync-client-types.js").SyncClientResourceConfig} Derived resource config.
 */
function resourceConfigFromSyncDeclaration({declaration, metadataModelClass, modelClass, resourceType}) {
  const normalizedDeclaration = declaration === true ? {} : declaration

  if (!normalizedDeclaration || typeof normalizedDeclaration !== "object" || Array.isArray(normalizedDeclaration)) {
    throw new Error(`${resourceType} static sync must be true or a sync declaration object, got: ${String(declaration)}`)
  }

  const {afterApply, attributes, booleanAttributes, conflictTracking, findRecord, findRecordForDelete, localOnlyAttributes, publish, realtime, syncType, track, trackedData, ...restDeclaration} = normalizedDeclaration
  const unknownKeys = Object.keys(restDeclaration)

  // `publish` is the server-side half of the shared `static sync` declaration
  // (consumed by SyncPublisher on the backend) - the client derives nothing
  // from it, but models declared once for both sides must stay valid here.
  void publish

  if (unknownKeys.length > 0) {
    throw new Error(`${resourceType} static sync received unknown keys: ${unknownKeys.join(", ")} (supported: afterApply, attributes, booleanAttributes, conflictTracking, findRecord, findRecordForDelete, localOnlyAttributes, publish, realtime, syncType, track, trackedData)`)
  }
  if (syncType !== undefined && typeof syncType !== "function" && syncType !== "upsert") {
    throw new Error(`${resourceType} static sync syncType must be a function or the string "upsert", got: ${String(syncType)}`)
  }

  const derived = derivedSyncAttributes({modelClass: metadataModelClass, resourceType})

  if (conflictTracking) validateConflictTracking({conflictTracking, derived, resourceType})

  return {
    afterApply,
    attributes,
    booleanAttributes: mergedAttributeNames(derived.booleanAttributes, booleanAttributes),
    conflictTracking: conflictTracking ? {...conflictTracking, versionAttribute: conflictTracking.versionAttribute || "updatedAt"} : undefined,
    findRecord,
    findRecordForDelete,
    localOnlyAttributes: mergedAttributeNames(
      derived.localOnlyAttributes,
      [...(localOnlyAttributes || []), ...(conflictTracking ? [conflictTracking.versionAttribute || "updatedAt"] : [])]
    ),
    metadataModelClass,
    modelClass,
    realtime,
    syncType,
    track: normalizedTrack(track),
    trackedData
  }
}

/**
 * Validates one resource's durable conflict-tracking declaration.
 * @param {{conflictTracking: import("./sync-client-types.js").SyncClientConflictTrackingConfig, derived: {booleanAttributes: string[], localOnlyAttributes: string[]}, resourceType: string}} args - Validation args.
 * @returns {void}
 */
function validateConflictTracking({conflictTracking, derived, resourceType}) {
  const requiredStrings = {
    actorDeviceId: conflictTracking.actorDeviceId,
    actorUserId: conflictTracking.actorUserId,
    offlineGrantId: conflictTracking.offlineGrantId,
    policyHash: conflictTracking.policyHash
  }

  for (const [key, value] of Object.entries(requiredStrings)) {
    if (typeof value !== "string" || value.length === 0) throw new Error(`${resourceType} conflictTracking.${key} must be a non-empty string`)
  }
  if (!conflictTracking.mutationLog || typeof conflictTracking.mutationLog.append !== "function") throw new Error(`${resourceType} conflictTracking.mutationLog must be a LocalMutationLog`)
  if (typeof conflictTracking.clientMutationId !== "function") throw new Error(`${resourceType} conflictTracking.clientMutationId must be a function`)
  if (!conflictTracking.versionAttribute && !derived.localOnlyAttributes.includes("updatedAt")) {
    throw new Error(`${resourceType} conflictTracking requires versionAttribute because the model has no updatedAt column`)
  }
}

/**
 * Derives boolean and local-only attribute names from a model's column metadata:
 * booleans from boolean column types; local-only from the primary key,
 * createdAt/updatedAt, and sync bookkeeping columns.
 * @param {{modelClass: ReturnType<typeof JSON.parse>, resourceType: string}} args - Derivation args.
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
 * @param {{path: string, requestContext: import("../remote-request-context.js").RemoteRequestContext, transport: import("../configuration-types.js").VelociousSyncClientTransport}} args - Poster args.
 * @returns {(payload: Record<string, ReturnType<typeof JSON.parse>>) => Promise<ReturnType<typeof JSON.parse>>} Sync endpoint POSTer.
 */
function transportPoster({path, requestContext, transport}) {
  return async (payload) => {
    const requestPayload = mergeRemoteRequestContext({
      context: requestContext,
      label: "Sync client request context",
      params: payload
    })
    const response = await transport.post(path, requestPayload)

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
 * @param {import("../database/query/model-class-query.js").default<ReturnType<typeof JSON.parse>>} query - Query declaring the sync scope.
 * @returns {Promise<{scope: import("./sync-client-types.js").SerializedSyncScope, pulled: import("./sync-api-client-types.js").SyncChangesResult | null}>} Declared scope and pull result.
 */
export async function sync(query) {
  return await SyncClient.current().sync(query)
}
