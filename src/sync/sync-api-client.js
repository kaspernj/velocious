// @ts-check

import {optionalBoolean, optionalInteger} from "typanic"

const syncTaskPromises = new Map()

/** @typedef {import("./sync-api-client-types.js").SyncChangeApplyResult} SyncChangeApplyResult */
/** @typedef {import("./sync-api-client-types.js").SyncChangeEnvelope} SyncChangeEnvelope */
/** @typedef {import("./sync-api-client-types.js").SyncChangesRequest} SyncChangesRequest */
/** @typedef {import("./sync-api-client-types.js").SyncChangesResponse} SyncChangesResponse */
/** @typedef {import("./sync-api-client-types.js").SyncChangesResult} SyncChangesResult */
/** @typedef {import("./sync-api-client-types.js").SyncCursor} SyncCursor */
/** @typedef {import("./sync-api-client-types.js").SyncReplayItem} SyncReplayItem */
/** @typedef {import("./sync-api-client-types.js").SyncReplayResponse} SyncReplayResponse */
/** @typedef {import("./sync-api-client-types.js").SyncResourceConfig} SyncResourceConfig */

/**
 * Generic client-side helper for replaying pending sync envelopes through the
 * framework-owned `/velocious/sync/replay` endpoint. Apps provide only local
 * persistence/auth hooks.
 */
export default class SyncApiClient {
  /**
   * Serializes sync work with the same key so callers do not have to keep app-local locks.
   * @param {string} key - Lock key.
   * @param {() => Promise<void>} callback - Work to run once previous work finished.
   * @returns {Promise<void>}
   */
  static async singleFlight(key, callback) {
    while (syncTaskPromises.has(key)) {
      try {
        await syncTaskPromises.get(key)
      } catch (_error) {
        // The failed flight's own caller observes that rejection; callers queued
        // behind it still run their own work so pending rows retry after the lock clears.
      }
    }

    const promise = callback()
    syncTaskPromises.set(key, promise)

    try {
      await promise
    } finally {
      if (syncTaskPromises.get(key) === promise) syncTaskPromises.delete(key)
    }
  }

  /**
   * Pulls backend sync changes with a framework-managed cursor row.
   * @param {object} args - Pull args.
   * @param {string} args.authenticationToken - Auth token to send with change requests.
   * @param {number} [args.batchSize] - Max syncs per request.
   * @param {?} args.cursorModel - Model that responds to findBy/findOrInitializeBy for cursor persistence.
   * @param {string} args.cursorKey - Cursor option key.
   * @param {(payload: SyncChangesRequest) => Promise<SyncChangesResponse>} args.postChanges - Posts one changes request.
   * @param {Record<string, SyncResourceConfig>} args.resources - Resource policies.
   * @param {(progress: {pages: number, syncedCount: number}) => void} [args.onProgress] - Progress callback.
   * @returns {Promise<SyncChangesResult>} Pull result.
   */
  static async pullChangesWithCursor(args) {
    return await this.pullChanges({
      authenticationToken: args.authenticationToken,
      batchSize: args.batchSize,
      loadCursor: async () => await this.loadSyncCursor({cursorKey: args.cursorKey, cursorModel: args.cursorModel}),
      saveCursor: async (cursor) => await this.saveSyncCursor({cursor, cursorKey: args.cursorKey, cursorModel: args.cursorModel}),
      postChanges: args.postChanges,
      applySync: this.resourceApplier(args.resources),
      onProgress: args.onProgress
    })
  }

  /**
   * Loads a persisted sync cursor from a model row with a value column.
   * @param {{cursorKey: string, cursorModel: ?}} args - Cursor args.
   * @returns {Promise<string | null>} Persisted cursor payload.
   */
  static async loadSyncCursor({cursorKey, cursorModel}) {
    const option = await cursorModel.findBy({key: cursorKey})

    return option ? option.value() : null
  }

  /**
   * Saves a persisted sync cursor to a model row with a value column.
   * @param {{cursor: SyncCursor, cursorKey: string, cursorModel: ?}} args - Cursor args.
   * @returns {Promise<void>}
   */
  static async saveSyncCursor({cursor, cursorKey, cursorModel}) {
    if (!cursor) return

    const option = await cursorModel.findOrInitializeBy({key: cursorKey})

    option.assign({value: JSON.stringify(cursor)})
    if (option.isChanged()) await option.save()
  }

  /**
   * Pulls backend sync changes in stable pages, applies them locally, and stores
   * the acknowledged cursor. Apps provide only auth, persistence, transport, and
   * resource policy hooks.
   * @param {object} args - Pull args.
   * @param {string} args.authenticationToken - Auth token to send with change requests.
   * @param {number} [args.batchSize] - Max syncs per request. Defaults to 100.
   * @param {() => Promise<SyncCursor | string | null | undefined>} args.loadCursor - Loads the persisted local cursor.
   * @param {(cursor: SyncCursor) => Promise<void>} args.saveCursor - Persists the final acknowledged cursor.
   * @param {(payload: SyncChangesRequest) => Promise<SyncChangesResponse>} args.postChanges - Posts one changes request.
   * @param {(sync: SyncChangeEnvelope) => Promise<SyncChangeApplyResult>} args.applySync - Applies one normalized sync row locally.
   * @param {(progress: {pages: number, syncedCount: number}) => void} [args.onProgress] - Progress callback.
   * @returns {Promise<SyncChangesResult>} Pull result.
   */
  static async pullChanges(args) {
    let afterCursor = this.syncCursorFromPayload(await args.loadCursor())
    let upToCursor = null
    let pages = 0
    let syncedCount = 0
    let changed = false
    const resourceCounts = /** @type {Record<string, number>} */ ({})
    const resourceChanged = /** @type {Record<string, boolean>} */ ({})
    const batchSize = this.normalizedBatchSize(args.batchSize)

    while (true) {
      const changesResponse = await this.changesPage({...args, afterCursor, batchSize, upToCursor})
      const syncs = changesResponse.syncs

      if (!upToCursor) upToCursor = changesResponse.upToCursor
      if (syncs.length === 0) break

      pages += 1

      for (const sync of syncs) {
        const applyResult = await args.applySync(sync)
        const resourceType = applyResult.resourceType ?? sync.resourceType()

        changed ||= applyResult.changed === true
        syncedCount += 1

        if (resourceType) {
          resourceCounts[resourceType] = (resourceCounts[resourceType] || 0) + 1
          resourceChanged[resourceType] ||= applyResult.changed === true
        }
      }

      afterCursor = changesResponse.nextCursor

      if (args.onProgress) args.onProgress({pages, syncedCount})
      if (syncs.length < batchSize) break
    }

    if (afterCursor) await args.saveCursor(afterCursor)

    return {changed, pages, resourceChanged, resourceCounts, syncedCount}
  }

  /**
   * Fetches and validates one backend sync changes page.
   * @param {object} args - Page args.
   * @param {SyncCursor} args.afterCursor - Last acknowledged cursor.
   * @param {string} args.authenticationToken - Auth token.
   * @param {number} args.batchSize - Page size.
   * @param {(payload: SyncChangesRequest) => Promise<SyncChangesResponse>} args.postChanges - Changes poster.
   * @param {SyncCursor} args.upToCursor - Snapshot upper-bound cursor.
   * @returns {Promise<{nextCursor: SyncCursor, syncs: SyncChangeEnvelope[], upToCursor: SyncCursor}>} Normalized changes page.
   */
  static async changesPage({afterCursor, authenticationToken, batchSize, postChanges, upToCursor}) {
    const response = await postChanges({
      authenticationToken,
      limit: batchSize,
      ...this.cursorPayload("after", afterCursor),
      ...this.cursorPayload("upTo", upToCursor)
    })

    this.ensureSuccessfulChangesResponse(response)

    const syncs = /** @type {unknown[]} */ (response.syncs)

    return {
      nextCursor: this.syncCursorFromPayload(response.nextCursor ?? null),
      syncs: syncs.map((syncPayload) => this.syncEnvelopeFromPayload(syncPayload)),
      upToCursor: this.syncCursorFromPayload(response.upToCursor ?? null)
    }
  }

  /**
   * Checks API response status and shape for change-feed pulls.
   * @param {SyncChangesResponse} response - Changes response.
   * @returns {void}
   */
  static ensureSuccessfulChangesResponse(response) {
    if (response.status === "error") throw new Error(response.errorMessage || "Sync changes failed")
    if (!Array.isArray(response.syncs)) throw new Error("Sync changes response missing syncs")
  }

  /**
   * Converts a cursor into request params with the given prefix.
   * @param {"after" | "upTo"} prefix - Request field prefix.
   * @param {SyncCursor} cursor - Cursor to serialize.
   * @returns {Record<string, string | number | null>} Request params.
   */
  static cursorPayload(prefix, cursor) {
    if (!cursor) return {}

    return {
      [`${prefix}Id`]: cursor.id,
      ...(cursor.serverSequence ? {[`${prefix}ServerSequence`]: cursor.serverSequence} : {}),
      [`${prefix}UpdatedAt`]: cursor.updatedAt
    }
  }

  /**
   * Parses a persisted or response cursor payload.
   * @param {SyncCursor | string | Record<string, ?> | null | undefined} payload - Cursor payload.
   * @returns {SyncCursor} Parsed cursor.
   */
  static syncCursorFromPayload(payload) {
    if (!payload) return null

    if (typeof payload === "string") {
      try {
        return this.syncCursorFromPayload(JSON.parse(payload))
      } catch (_error) {
        return {id: null, serverSequence: null, updatedAt: payload}
      }
    }

    if (typeof payload !== "object" || Array.isArray(payload)) return null

    const updatedAt = typeof payload.updatedAt === "string" ? payload.updatedAt : null

    if (!updatedAt) return null

    return {
      id: payload.id === null || payload.id === undefined ? null : String(payload.id),
      serverSequence: optionalInteger(payload.serverSequence === "" ? null : payload.serverSequence),
      updatedAt
    }
  }

  /**
   * Builds a normalized sync row adapter.
   * @param {?} payload - Raw sync payload.
   * @returns {SyncChangeEnvelope} Sync row adapter.
   */
  static syncEnvelopeFromPayload(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Sync changes entry must be an object")

    const syncPayload = /** @type {Record<string, ?>} */ (payload)

    return {
      data: () => syncPayload.data,
      id: () => syncPayload.id,
      resourceId: () => syncPayload.resourceId,
      resourceType: () => syncPayload.resourceType === null || syncPayload.resourceType === undefined ? null : String(syncPayload.resourceType),
      syncType: () => syncPayload.syncType === null || syncPayload.syncType === undefined ? "" : String(syncPayload.syncType)
    }
  }

  /**
   * Builds an app-configured resource applier for pulled sync rows. The sync
   * mechanics stay here; apps only declare which models/attributes/hooks are
   * allowed for each resource type.
   * @param {Record<string, SyncResourceConfig>} resources - Resource policy map.
   * @param {(record: ?) => () => void} [onRecord] - Called with each record about to be written; returns a release callback invoked after the write (used for echo suppression).
   * @returns {(sync: SyncChangeEnvelope) => Promise<SyncChangeApplyResult>} Sync apply callback.
   */
  static resourceApplier(resources, onRecord) {
    return async (sync) => await this.applyResourceSync({onRecord, resources, sync})
  }

  /**
   * Applies one sync row using declarative resource policy.
   * @param {{resources: Record<string, SyncResourceConfig>, sync: SyncChangeEnvelope, onRecord?: (record: ?) => () => void}} args - Apply args.
   * @returns {Promise<SyncChangeApplyResult>} Apply result.
   */
  static async applyResourceSync({onRecord, resources, sync}) {
    const resourceType = sync.resourceType()
    const resource = resourceType ? resources[resourceType] : undefined

    if (!resource || !resource.enabled) return {changed: false, resourceType}

    if (sync.syncType() === "delete") {
      return {changed: await this.destroySyncedResource({onRecord, resource, sync}), resourceType}
    }

    const data = this.syncData(sync)
    const record = resource.findRecord ? await resource.findRecord({data, resourceId: sync.resourceId(), sync}) : await resource.modelClass.findOrInitializeBy({id: data.id ?? sync.resourceId()})
    const attributes = await resource.attributes({data, record, sync})
    const releaseRecord = onRecord ? onRecord(record) : null
    let changed = false

    try {
      record.assign(attributes)

      if (record.isChanged()) {
        await record.save()
        changed = true
      }

      if (resource.afterApply) {
        const hookChanged = await resource.afterApply({attributes, data, record, sync})

        changed ||= hookChanged === true
      }
    } finally {
      if (releaseRecord) releaseRecord()
    }

    return {changed, resourceType}
  }

  /**
   * Destroys a synced resource via its declared model policy.
   * @param {{resource: SyncResourceConfig, sync: SyncChangeEnvelope, onRecord?: (record: ?) => () => void}} args - Destroy args.
   * @returns {Promise<boolean>} Whether a local row was destroyed.
   */
  static async destroySyncedResource({onRecord, resource, sync}) {
    const id = sync.resourceId()
    const record = resource.findRecordForDelete ? await resource.findRecordForDelete({resourceId: id, sync}) : await resource.modelClass.findBy({id})

    if (!record) return false

    const releaseRecord = onRecord ? onRecord(record) : null

    try {
      await record.destroy()
    } finally {
      if (releaseRecord) releaseRecord()
    }

    return true
  }

  /**
   * Parses the embedded sync data JSON/object.
   * @param {SyncChangeEnvelope} sync - Sync row.
   * @returns {Record<string, unknown>} Sync data object.
   */
  static syncData(sync) {
    const data = sync.data()

    if (!data) throw new Error(`Sync ${sync.id()} is missing data`)
    if (typeof data === "string") return /** @type {Record<string, unknown>} */ (JSON.parse(data))
    if (typeof data === "object" && !Array.isArray(data)) return /** @type {Record<string, unknown>} */ (data)

    throw new Error(`Sync ${sync.id()} has invalid data`)
  }

  /**
   * Drains pending sync records from a local Velocious model in stable order.
   * @param {object} args - Replay args.
   * @param {string} args.authenticationToken - Auth token to send with replay requests.
   * @param {number} [args.batchSize] - Max syncs per request.
   * @param {?} args.syncModel - Local Sync model class.
   * @param {(payload: {authenticationToken: string, syncs: Array<Record<string, ?>>}) => Promise<SyncReplayResponse>} args.postReplay - Replay poster.
   * @returns {Promise<void>}
   */
  static async replayLocalSyncs(args) {
    const postedSnapshotsBySyncId = new Map()

    await this.replayPending({
      authenticationToken: args.authenticationToken,
      batchSize: args.batchSize,
      markSuccessful: async (sync) => {
        const syncId = (/** @type {{id: () => string | number | null | undefined}} */ (sync)).id()
        // Reload with the resource preloaded so rows relying on the resource-attributes
        // fallback in localSyncData compare against the same snapshot they posted.
        const currentSync = await args.syncModel.preload({resource: true}).where({id: syncId}).first()

        if (!currentSync) return
        // A row edited while its old payload was in flight stays pending, so the
        // newer local change replays on the next drain instead of being lost.
        if (this.localSyncReplaySnapshot(currentSync) !== postedSnapshotsBySyncId.get(String(syncId))) return

        await currentSync.update({state: "success"})
      },
      pendingSyncs: async () => await args.syncModel.preload({resource: true}).where({state: "pending"}).order("created_at").toArray(),
      postReplay: args.postReplay,
      syncId: (sync) => (/** @type {{id: () => string | number | null | undefined}} */ (sync)).id(),
      syncPayload: (sync) => {
        postedSnapshotsBySyncId.set(String((/** @type {{id: () => string | number | null | undefined}} */ (sync)).id()), this.localSyncReplaySnapshot(sync))

        return this.localSyncPayload(sync)
      }
    })
  }

  /**
   * Serializes the replay-relevant state of a local sync row for in-flight comparisons.
   * @param {?} sync - Local sync row.
   * @returns {string} Stable snapshot of the row's replayed payload.
   */
  static localSyncReplaySnapshot(sync) {
    return JSON.stringify({data: this.localSyncData(sync), syncType: sync.syncType()})
  }

  /**
   * Builds one replay envelope from a local sync row.
   * @param {?} sync - Local sync row.
   * @returns {{clientUpdatedAt?: string, data: Record<string, unknown>, id: number, resourceId: string, resourceType: string, syncType: string}} Sync replay envelope.
   */
  static localSyncPayload(sync) {
    const clientUpdatedAt = sync.updatedAt() || sync.createdAt()

    return {
      clientUpdatedAt: clientUpdatedAt ? clientUpdatedAt.toISOString() : undefined,
      data: this.localSyncData(sync),
      id: /** @type {number} */ (/** @type {unknown} */ (sync.id())),
      resourceId: String(sync.resourceId()),
      resourceType: sync.resourceType() || "",
      syncType: sync.syncType()
    }
  }

  /**
   * Resolves one local sync row payload, falling back to preloaded resource attributes.
   * @param {?} sync - Local sync row.
   * @returns {Record<string, unknown>} Sync data.
   */
  static localSyncData(sync) {
    let syncData = /** @type {string | Record<string, unknown>} */ (sync.data() || {})

    if (typeof syncData === "string") {
      try {
        syncData = /** @type {Record<string, unknown>} */ (JSON.parse(syncData))
      } catch (_error) {
        syncData = {}
      }
    }

    if (Object.keys(syncData).length > 0) return syncData

    try {
      return /** @type {Record<string, unknown>} */ (sync.resource().attributes())
    } catch (_error) {
      return {}
    }
  }

  /**
   * Queues a local sync row for a Velocious model resource.
   * @param {object} args - Queue args.
   * @param {?} args.resource - Resource being synced.
   * @param {?} args.syncModel - Local Sync model class.
   * @param {Record<string, unknown>} [args.data] - Explicit sync data.
   * @param {string} [args.syncType] - Sync operation type.
   * @param {string[]} [args.localOnlyAttributes] - Attributes to strip from queued payloads.
   * @param {string[]} [args.booleanAttributes] - Attributes to coerce through sync boolean parsing.
   * @param {(data: Record<string, unknown>) => Record<string, unknown>} [args.normalizeData] - App-specific data normalizer.
   * @returns {Promise<?>} Local sync row.
   */
  static async queueLocalSync(args) {
    const resourceRecordId = args.resource.id()
    const modelClass = args.resource.constructor

    if (typeof modelClass.getModelName !== "function") {
      throw new Error("The resource model class must implement static getModelName() to queue sync data - class names are not stable across explicit model names and minified bundles")
    }

    const resourceType = modelClass.getModelName()
    const syncData = this.queuedSyncData(args)
    const syncType = args.syncType || "update"

    if (!resourceRecordId) throw new Error("resource.id() is required to queue sync data")

    const resourceId = String(resourceRecordId)
    const existingSync = await args.syncModel.findBy({resourceId, resourceType})

    if (existingSync) {
      await existingSync.update({
        data: syncData,
        state: "pending",
        syncType
      })

      return existingSync
    }

    return await args.syncModel.create({
      data: syncData,
      resourceId,
      resourceType,
      state: "pending",
      syncType
    })
  }

  /**
   * Builds backend-safe queued sync data without mutating caller data. The default
   * (no explicit `data`) is the resource's attributes minus local-only attributes,
   * with booleans coerced and Date values serialized to ISO strings, so apps don't
   * need per-model tracked-payload builders.
   * @param {{resource: ?, data?: Record<string, unknown>, localOnlyAttributes?: string[], booleanAttributes?: string[], normalizeData?: (data: Record<string, unknown>) => Record<string, unknown>}} args - Data args.
   * @returns {Record<string, unknown>} Queued data.
   */
  static queuedSyncData(args) {
    const inputData = args.data ?? /** @type {Record<string, unknown>} */ (args.resource.attributes())
    const normalizedData = args.normalizeData ? args.normalizeData(inputData) : inputData
    const syncData = {...normalizedData}

    for (const attributeName of args.localOnlyAttributes || []) delete syncData[attributeName]
    for (const attributeName of args.booleanAttributes || []) {
      if (Object.hasOwn(syncData, attributeName)) syncData[attributeName] = this.optionalBooleanSyncValue(syncData[attributeName], attributeName)
    }
    for (const [attributeName, value] of Object.entries(syncData)) {
      if (value instanceof Date) syncData[attributeName] = value.toISOString()
    }

    return syncData
  }

  /**
   * Builds a small app-facing local sync queue facade from declarative model config.
   * @param {object} args - Queue config.
   * @param {?} args.syncModel - Local Sync model class.
   * @param {string} args.singleFlightKey - Key used to serialize backend replay.
   * @param {() => Promise<void>} args.syncPending - Backend replay callback.
   * @param {(resource: ?) => string[]} [args.localOnlyAttributes] - Resource-specific local-only attributes.
   * @param {(resource: ?) => string[]} [args.booleanAttributes] - Resource-specific SQLite boolean attributes.
   * @returns {{queue: (queueArgs: {resource: ?, data?: Record<string, unknown>, syncType?: string}) => Promise<?>, syncPending: () => Promise<void>}} Configured local sync queue.
   */
  static localSyncQueue(args) {
    return {
      queue: async (queueArgs) => await this.queueLocalSync({
        ...queueArgs,
        booleanAttributes: args.booleanAttributes ? args.booleanAttributes(queueArgs.resource) : [],
        localOnlyAttributes: args.localOnlyAttributes ? args.localOnlyAttributes(queueArgs.resource) : [],
        syncModel: args.syncModel
      }),
      syncPending: async () => await this.singleFlight(args.singleFlightKey, args.syncPending)
    }
  }

  /**
   * Parses booleans commonly used by SQLite/offline sync payloads.
   * @param {unknown} value - Sync decision value.
   * @param {string} [description] - Error context.
   * @returns {boolean | null} Parsed boolean-like backend/local value.
   */
  static optionalBooleanSyncValue(value, description = "sync boolean") {
    if (value == null) return null
    if (value === 1) return true
    if (value === 0) return false

    return optionalBoolean(value, description)
  }

  /**
   * Converts a boolean sync value to SQLite boolean storage.
   * @param {boolean | null} value - Sync boolean value.
   * @returns {0 | 1} SQLite-compatible boolean value.
   */
  static sqliteBooleanSyncValue(value) {
    return value === true ? 1 : 0
  }

  /**
   * Projects generic sync counters into app-specific result keys.
   * @param {object} args - Result args.
   * @param {SyncChangesResult} args.result - Generic Velocious sync result.
   * @param {Record<string, {changedKey: string, countKey: string}>} args.resources - Resource result key map.
   * @returns {Record<string, unknown>} Projected result.
   */
  static syncResultForResources({result, resources}) {
    const syncResult = /** @type {Record<string, unknown>} */ ({
      changed: result.changed,
      pages: result.pages,
      syncedCount: result.syncedCount
    })

    for (const [resourceType, keys] of Object.entries(resources)) {
      syncResult[keys.countKey] = result.resourceCounts[resourceType] || 0
      syncResult[keys.changedKey] = result.resourceChanged[resourceType] || false
    }

    return syncResult
  }

  /**
   * Drains pending sync records in stable order and marks acknowledged rows.
   * @param {object} args - Replay args.
   * @param {string} args.authenticationToken - Auth token to send with replay requests.
   * @param {number} [args.batchSize] - Max syncs per request. Defaults to 100.
   * @param {() => Promise<Array<unknown>>} args.pendingSyncs - Loads pending local sync rows in replay order.
   * @param {(sync: unknown) => string | number | null | undefined} args.syncId - Returns the local sync id.
   * @param {(sync: unknown) => Record<string, ?>} args.syncPayload - Builds the API sync envelope.
   * @param {(payload: {authenticationToken: string, syncs: Array<Record<string, ?>>}) => Promise<SyncReplayResponse>} args.postReplay - Posts one replay request.
   * @param {(sync: unknown, response: SyncReplayItem) => Promise<void>} args.markSuccessful - Marks one sync as successful locally.
   * @returns {Promise<void>} Resolves after all batches are replayed.
   */
  static async replayPending(args) {
    const pendingSyncs = await args.pendingSyncs()
    const batchSize = this.normalizedBatchSize(args.batchSize)

    for (let offset = 0; offset < pendingSyncs.length; offset += batchSize) {
      await this.replayBatch({...args, pendingSyncs: pendingSyncs.slice(offset, offset + batchSize)})
    }
  }

  /**
   * Replays one batch of syncs.
   * @param {object} args - Replay args.
   * @param {string} args.authenticationToken - Auth token.
   * @param {Array<unknown>} args.pendingSyncs - Batch syncs.
   * @param {(sync: unknown) => string | number | null | undefined} args.syncId - Sync id getter.
   * @param {(sync: unknown) => Record<string, ?>} args.syncPayload - Payload builder.
   * @param {(payload: {authenticationToken: string, syncs: Array<Record<string, ?>>}) => Promise<SyncReplayResponse>} args.postReplay - Replay poster.
   * @param {(sync: unknown, response: SyncReplayItem) => Promise<void>} args.markSuccessful - Success hook.
   * @returns {Promise<void>} Resolves after the batch is acknowledged.
   */
  static async replayBatch(args) {
    const {authenticationToken, markSuccessful, pendingSyncs, postReplay, syncId, syncPayload} = args

    if (pendingSyncs.length === 0) return

    const syncsById = new Map()

    for (const sync of pendingSyncs) {
      const id = syncId(sync)

      if (id !== undefined && id !== null) syncsById.set(String(id), sync)
    }

    const response = await postReplay({
      authenticationToken,
      syncs: pendingSyncs.map((sync) => syncPayload(sync))
    })

    this.ensureSuccessfulResponse(response)

    for (const syncResponse of response.syncs || []) {
      const sync = syncsById.get(String(syncResponse.id))

      if (!sync) continue
      if (syncResponse.syncState !== "successful") {
        throw new Error(`Invalid sync state returned for sync ${String(syncResponse.id)}: ${String(syncResponse.syncState)}`)
      }

      await markSuccessful(sync, syncResponse)
    }
  }

  /**
   * Checks API response status and shape.
   * @param {SyncReplayResponse} response - Replay response.
   * @returns {void}
   */
  static ensureSuccessfulResponse(response) {
    if (response.status === "error") throw new Error(response.errorMessage || "Sync failed")
    if (!Array.isArray(response.syncs)) throw new Error("Sync response missing syncs")
  }

  /**
   * Normalizes a positive batch size.
   * @param {number | undefined} batchSize - Batch size.
   * @returns {number} Positive batch size.
   */
  static normalizedBatchSize(batchSize) {
    if (typeof batchSize !== "number" || !Number.isFinite(batchSize) || batchSize < 1) return 100

    return Math.floor(batchSize)
  }
}
