export type SyncCursor = {
    id: string | null;
    serverSequence: number | null;
    updatedAt: string;
} | null;
export type SyncChangeEnvelope = {
    /**
     * - Sync data payload.
     */
    data: () => unknown;
    /**
     * - Sync row identifier.
     */
    id: () => unknown;
    /**
     * - Resource identifier.
     */
    resourceId: () => unknown;
    /**
     * - Resource type name.
     */
    resourceType: () => string | null;
    /**
     * - Sync operation type.
     */
    syncType: () => string;
};
export type SyncChangeApplyResult = {
    /**
     * - Whether the local store changed.
     */
    changed: boolean;
    /**
     * - Applied resource type override.
     */
    resourceType?: string | null;
};
export type SyncResourceConfig = {
    /**
     * - Optional post-save hook.
     */
    afterApply?: (args: {
        attributes: Record<string, unknown>;
        data: Record<string, unknown>;
        record: ReturnType<typeof JSON.parse>;
        sync: SyncChangeEnvelope;
    }) => Promise<boolean | void> | boolean | void;
    /**
     * - Allowed attributes builder.
     */
    attributes: (args: {
        data: Record<string, unknown>;
        record: ReturnType<typeof JSON.parse>;
        sync: SyncChangeEnvelope;
    }) => Promise<Record<string, unknown>> | Record<string, unknown>;
    /**
     * - Whether this resource is sync-enabled.
     */
    enabled: boolean;
    /**
     * - Optional upsert finder. SyncClient tenant resources additionally receive an operation-bound model class and operation; direct API consumers retain the legacy arguments.
     */
    findRecord?: (args: {
        data: Record<string, unknown>;
        modelClass?: ReturnType<typeof JSON.parse>;
        operation?: import("../database/operation.js").default | null;
        resourceId: unknown;
        sync: SyncChangeEnvelope;
    }) => Promise<ReturnType<typeof JSON.parse>> | ReturnType<typeof JSON.parse>;
    /**
     * - Optional destroy finder. SyncClient tenant resources additionally receive an operation-bound model class and operation; direct API consumers retain the legacy arguments.
     */
    findRecordForDelete?: (args: {
        modelClass?: ReturnType<typeof JSON.parse>;
        operation?: import("../database/operation.js").default | null;
        resourceId: unknown;
        sync: SyncChangeEnvelope;
    }) => Promise<ReturnType<typeof JSON.parse>> | ReturnType<typeof JSON.parse>;
    /**
     * - Velocious model class.
     */
    modelClass: ReturnType<typeof JSON.parse>;
};
export type SyncChangesRequest = {
    /**
     * - Auth token.
     */
    authenticationToken: string;
    /**
     * - Last seen row id.
     */
    afterId?: string | null;
    /**
     * - Last seen server sequence.
     */
    afterServerSequence?: number;
    /**
     * - Last seen timestamp.
     */
    afterUpdatedAt?: string;
    /**
     * - Page size.
     */
    limit: number;
    /**
     * - Snapshot upper-bound row id.
     */
    upToId?: string | null;
    /**
     * - Snapshot upper-bound server sequence.
     */
    upToServerSequence?: number;
    /**
     * - Snapshot upper-bound timestamp.
     */
    upToUpdatedAt?: string;
};
export type SyncChangesResponse = {
    /**
     * - Error message.
     */
    errorMessage?: string;
    /**
     * - Next cursor.
     */
    nextCursor?: SyncCursor | Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * - Response status.
     */
    status?: string;
    /**
     * - Sync rows.
     */
    syncs?: Array<unknown>;
    /**
     * - Total pending change count for the scope from the request cursor (additive; absent on older servers).
     */
    total?: number;
    /**
     * - Snapshot upper-bound cursor.
     */
    upToCursor?: SyncCursor | Record<string, ReturnType<typeof JSON.parse>>;
};
export type SyncPullProgress = {
    /**
     * - Applied page count so far.
     */
    pages: number;
    /**
     * - Applied row count so far.
     */
    syncedCount: number;
    /**
     * - Total pending change count for the pull, stable across pages (0 when nothing to sync, null-free once the server reports it).
     */
    total: number;
};
export type SyncChangesResult = {
    /**
     * - Whether any local record changed.
     */
    changed: boolean;
    /**
     * - Applied page count.
     */
    pages: number;
    /**
     * - Changed flags by resource type.
     */
    resourceChanged: Record<string, boolean>;
    /**
     * - Applied counts by resource type.
     */
    resourceCounts: Record<string, number>;
    /**
     * - Applied row count.
     */
    syncedCount: number;
    /**
     * - Total pending change count across the pulled scopes (the "of Y" denominator for a syncedCount-of-total progress bar).
     */
    total: number;
};
export type SyncReplayItem = {
    /**
     * - Sync id.
     */
    id: string | number;
    /**
     * - Structured durable conflict payload.
     */
    conflict?: Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * - Rejection reason.
     */
    reason?: string;
    /**
     * - Authoritative version after successful replay.
     */
    serverVersion?: string | number | null;
    /**
     * - Replay state.
     */
    syncState: string;
};
export type SyncReplayResponse = {
    /**
     * - Error message.
     */
    errorMessage?: string;
    /**
     * - Response status.
     */
    status?: string;
    /**
     * - Replay results.
     */
    syncs?: Array<SyncReplayItem>;
};
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
 * @property {(args: {attributes: Record<string, unknown>, data: Record<string, unknown>, record: ReturnType<typeof JSON.parse>, sync: SyncChangeEnvelope}) => Promise<boolean | void> | boolean | void} [afterApply] - Optional post-save hook.
 * @property {(args: {data: Record<string, unknown>, record: ReturnType<typeof JSON.parse>, sync: SyncChangeEnvelope}) => Promise<Record<string, unknown>> | Record<string, unknown>} attributes - Allowed attributes builder.
 * @property {boolean} enabled - Whether this resource is sync-enabled.
 * @property {(args: {data: Record<string, unknown>, modelClass?: ReturnType<typeof JSON.parse>, operation?: import("../database/operation.js").default | null, resourceId: unknown, sync: SyncChangeEnvelope}) => Promise<ReturnType<typeof JSON.parse>> | ReturnType<typeof JSON.parse>} [findRecord] - Optional upsert finder. SyncClient tenant resources additionally receive an operation-bound model class and operation; direct API consumers retain the legacy arguments.
 * @property {(args: {modelClass?: ReturnType<typeof JSON.parse>, operation?: import("../database/operation.js").default | null, resourceId: unknown, sync: SyncChangeEnvelope}) => Promise<ReturnType<typeof JSON.parse>> | ReturnType<typeof JSON.parse>} [findRecordForDelete] - Optional destroy finder. SyncClient tenant resources additionally receive an operation-bound model class and operation; direct API consumers retain the legacy arguments.
 * @property {ReturnType<typeof JSON.parse>} modelClass - Velocious model class.
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
 * @property {SyncCursor | Record<string, ReturnType<typeof JSON.parse>>} [nextCursor] - Next cursor.
 * @property {string} [status] - Response status.
 * @property {Array<unknown>} [syncs] - Sync rows.
 * @property {number} [total] - Total pending change count for the scope from the request cursor (additive; absent on older servers).
 * @property {SyncCursor | Record<string, ReturnType<typeof JSON.parse>>} [upToCursor] - Snapshot upper-bound cursor.
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
 * @property {Record<string, ReturnType<typeof JSON.parse>>} [conflict] - Structured durable conflict payload.
 * @property {string} [reason] - Rejection reason.
 * @property {string | number | null} [serverVersion] - Authoritative version after successful replay.
 * @property {string} syncState - Replay state.
 */
/**
 * @typedef {object} SyncReplayResponse
 * @property {string} [errorMessage] - Error message.
 * @property {string} [status] - Response status.
 * @property {Array<SyncReplayItem>} [syncs] - Replay results.
 */
export {};
//# sourceMappingURL=sync-api-client-types.d.ts.map