// @ts-check

import {optionalInteger} from "typanic"

/**
 * Generic client-side helper for replaying pending sync envelopes through the
 * framework-owned `/velocious/sync/replay` endpoint. Apps provide only local
 * persistence/auth hooks.
 */
export default class SyncApiClient {
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
   * @returns {(sync: SyncChangeEnvelope) => Promise<SyncChangeApplyResult>} Sync apply callback.
   */
  static resourceApplier(resources) {
    return async (sync) => await this.applyResourceSync({resources, sync})
  }

  /**
   * Applies one sync row using declarative resource policy.
   * @param {{resources: Record<string, SyncResourceConfig>, sync: SyncChangeEnvelope}} args - Apply args.
   * @returns {Promise<SyncChangeApplyResult>} Apply result.
   */
  static async applyResourceSync({resources, sync}) {
    const resourceType = sync.resourceType()
    const resource = resourceType ? resources[resourceType] : undefined

    if (!resource || !resource.enabled) return {changed: false, resourceType}

    if (sync.syncType() === "delete") {
      return {changed: await this.destroySyncedResource({resource, sync}), resourceType}
    }

    const data = this.syncData(sync)
    const record = resource.findRecord ? await resource.findRecord({data, resourceId: sync.resourceId(), sync}) : await resource.modelClass.findOrInitializeBy({id: data.id ?? sync.resourceId()})
    const attributes = await resource.attributes({data, record, sync})
    let changed = false

    record.assign(attributes)

    if (record.isChanged()) {
      await record.save()
      changed = true
    }

    if (resource.afterApply) {
      const hookChanged = await resource.afterApply({attributes, data, record, sync})

      changed ||= hookChanged === true
    }

    return {changed, resourceType}
  }

  /**
   * Destroys a synced resource via its declared model policy.
   * @param {{resource: SyncResourceConfig, sync: SyncChangeEnvelope}} args - Destroy args.
   * @returns {Promise<boolean>} Whether a local row was destroyed.
   */
  static async destroySyncedResource({resource, sync}) {
    const id = sync.resourceId()
    const record = resource.findRecordForDelete ? await resource.findRecordForDelete({resourceId: id, sync}) : await resource.modelClass.findBy({id})

    if (!record) return false

    await record.destroy()
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

/** @typedef {{id: string | null, serverSequence: number | null, updatedAt: string} | null} SyncCursor */

/**
 * @typedef {object} SyncChangeEnvelope
 * @property {() => unknown} data - Sync data payload.
 * @property {() => unknown} id - Sync row identifier.
 * @property {() => unknown} resourceId - Resource identifier.
 * @property {() => string | null} resourceType - Resource type name.
 * @property {() => string} syncType - Sync operation type.
 */

/**
 * @typedef {object} SyncChangeApplyResult
 * @property {boolean} changed - Whether the local store changed.
 * @property {string | null} [resourceType] - Applied resource type override.
 */

/**
 * @typedef {object} SyncResourceConfig
 * @property {(args: {attributes: Record<string, unknown>, data: Record<string, unknown>, record: ?, sync: SyncChangeEnvelope}) => Promise<boolean | void> | boolean | void} [afterApply] - Optional post-save hook.
 * @property {(args: {data: Record<string, unknown>, record: ?, sync: SyncChangeEnvelope}) => Promise<Record<string, unknown>> | Record<string, unknown>} attributes - Allowed attributes builder.
 * @property {boolean} enabled - Whether this resource is sync-enabled.
 * @property {(args: {data: Record<string, unknown>, resourceId: unknown, sync: SyncChangeEnvelope}) => Promise<?> | ?} [findRecord] - Optional upsert finder.
 * @property {(args: {resourceId: unknown, sync: SyncChangeEnvelope}) => Promise<?> | ?} [findRecordForDelete] - Optional destroy finder.
 * @property {?} modelClass - Velocious model class.
 */

/**
 * @typedef {object} SyncChangesRequest
 * @property {string} authenticationToken - Auth token.
 * @property {string | null} [afterId] - Last seen row id.
 * @property {number} [afterServerSequence] - Last seen server sequence.
 * @property {string} [afterUpdatedAt] - Last seen timestamp.
 * @property {number} limit - Page size.
 * @property {string | null} [upToId] - Snapshot upper-bound row id.
 * @property {number} [upToServerSequence] - Snapshot upper-bound server sequence.
 * @property {string} [upToUpdatedAt] - Snapshot upper-bound timestamp.
 */

/**
 * @typedef {object} SyncChangesResponse
 * @property {string} [errorMessage] - Error message.
 * @property {SyncCursor | Record<string, ?>} [nextCursor] - Next cursor.
 * @property {string} [status] - Response status.
 * @property {Array<unknown>} [syncs] - Sync rows.
 * @property {SyncCursor | Record<string, ?>} [upToCursor] - Snapshot upper-bound cursor.
 */

/**
 * @typedef {object} SyncChangesResult
 * @property {boolean} changed - Whether any local record changed.
 * @property {number} pages - Applied page count.
 * @property {Record<string, boolean>} resourceChanged - Changed flags by resource type.
 * @property {Record<string, number>} resourceCounts - Applied counts by resource type.
 * @property {number} syncedCount - Applied row count.
 */

/**
 * @typedef {object} SyncReplayItem
 * @property {string | number} id - Sync id.
 * @property {string} syncState - Replay state.
 */

/**
 * @typedef {object} SyncReplayResponse
 * @property {string} [errorMessage] - Error message.
 * @property {string} [status] - Response status.
 * @property {Array<SyncReplayItem>} [syncs] - Replay results.
 */
