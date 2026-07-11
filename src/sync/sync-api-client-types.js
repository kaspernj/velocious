// @ts-check

/**
 * @module sync-api-client-types
 */

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
 * @property {number} [total] - Total pending change count for the scope from the request cursor (additive; absent on older servers).
 * @property {SyncCursor | Record<string, ?>} [upToCursor] - Snapshot upper-bound cursor.
 */

/**
 * @typedef {object} SyncPullProgress
 * @property {number} pages - Applied page count so far.
 * @property {number} syncedCount - Applied row count so far.
 * @property {number} total - Total pending change count for the pull, stable across pages (0 when nothing to sync, null-free once the server reports it).
 */

/**
 * @typedef {object} SyncChangesResult
 * @property {boolean} changed - Whether any local record changed.
 * @property {number} pages - Applied page count.
 * @property {Record<string, boolean>} resourceChanged - Changed flags by resource type.
 * @property {Record<string, number>} resourceCounts - Applied counts by resource type.
 * @property {number} syncedCount - Applied row count.
 * @property {number} total - Total pending change count across the pulled scopes (the "of Y" denominator for a syncedCount-of-total progress bar).
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

export {}
