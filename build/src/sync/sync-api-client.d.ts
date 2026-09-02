export type SyncChangeApplyResult = import("./sync-api-client-types.js").SyncChangeApplyResult;
export type SyncChangeEnvelope = import("./sync-api-client-types.js").SyncChangeEnvelope;
export type SyncChangesRequest = import("./sync-api-client-types.js").SyncChangesRequest;
export type SyncChangesResponse = import("./sync-api-client-types.js").SyncChangesResponse;
export type SyncChangesResult = import("./sync-api-client-types.js").SyncChangesResult;
export type SyncCursor = import("./sync-api-client-types.js").SyncCursor;
export type SyncReplayItem = import("./sync-api-client-types.js").SyncReplayItem;
export type SyncReplayResponse = import("./sync-api-client-types.js").SyncReplayResponse;
export type SyncResourceConfig = import("./sync-api-client-types.js").SyncResourceConfig;
/**
 * Generic client-side helper for replaying pending sync envelopes through the
 * framework-owned `/velocious/sync/replay` endpoint. Apps provide only local
 * persistence/auth hooks.
 */
export default class SyncApiClient {
    /**
     * Appends one conflict-tracked intent to the existing durable mutation log.
     * @param {object} args - Queue arguments.
     * @param {string | number | null} args.baseVersion - Authoritative version observed before the local mutation.
     * @param {import("./sync-client-types.js").SyncClientConflictTrackingConfig} args.conflictTracking - Durable tracking configuration.
     * @param {Record<string, unknown>} args.data - Backend-safe mutation attributes.
     * @param {"create" | "update" | "destroy"} args.operation - Local operation.
     * @param {ReturnType<typeof JSON.parse>} args.resource - Local resource.
     * @param {string} args.resourceType - Resource type.
     * @param {string} args.syncType - Wire operation.
     * @returns {Promise<import("./local-mutation-log.js").LocalMutationLogRecord>} Appended intent.
     */
    static queueConflictTrackedSync({ baseVersion, conflictTracking, data, operation, resource, resourceType, syncType }: {
        baseVersion: string | number | null;
        conflictTracking: import("./sync-client-types.js").SyncClientConflictTrackingConfig;
        data: Record<string, unknown>;
        operation: "create" | "update" | "destroy";
        resource: ReturnType<typeof JSON.parse>;
        resourceType: string;
        syncType: string;
    }): Promise<import("./local-mutation-log.js").LocalMutationLogRecord>;
    /**
     * Drains the existing mutation log in predecessor order. Independent records
     * continue after durable conflicts/rejections; successors stay blocked.
     * @param {object} args - Replay arguments.
     * @param {string} args.authenticationToken - Authentication token.
     * @param {number} [args.batchSize] - Batch size.
     * @param {import("./sync-client-types.js").SyncClientConflictTrackingConfig} args.conflictTracking - Tracking configuration.
     * @param {(payload: {authenticationToken: string, syncs: Array<Record<string, ReturnType<typeof JSON.parse>>>}) => Promise<SyncReplayResponse>} args.postReplay - Transport boundary.
     * @param {(identity: string) => number} args.remoteGeneration - Current remote generation.
     * @param {string} args.resourceType - Resource whose log records should drain.
     * @returns {Promise<void>} Resolves when no ready intent remains.
     */
    static replayConflictTrackedSyncs({ authenticationToken, batchSize, conflictTracking, postReplay, remoteGeneration, resourceType }: {
        authenticationToken: string;
        batchSize?: number;
        conflictTracking: import("./sync-client-types.js").SyncClientConflictTrackingConfig;
        postReplay: (payload: {
            authenticationToken: string;
            syncs: Array<Record<string, ReturnType<typeof JSON.parse>>>;
        }) => Promise<SyncReplayResponse>;
        remoteGeneration: (identity: string) => number;
        resourceType: string;
    }): Promise<void>;
    /**
     * Builds safe transport groups from root-ready records and their successors.
     * @param {{pending: Array<import("./local-mutation-log.js").LocalMutationLogRecord>, ready: Array<import("./local-mutation-log.js").LocalMutationLogRecord>}} args - Pending and root-ready records.
     * @returns {Array<Array<import("./local-mutation-log.js").LocalMutationLogRecord>>} Safe transport groups.
     */
    static conflictReplayGroups({ pending, ready }: {
        pending: Array<import("./local-mutation-log.js").LocalMutationLogRecord>;
        ready: Array<import("./local-mutation-log.js").LocalMutationLogRecord>;
    }): Array<Array<import("./local-mutation-log.js").LocalMutationLogRecord>>;
    /**
     * Checks whether two durable intents can share one transport mutation.
     * @param {import("./local-mutation-log.js").LocalMutationLogRecord} left - Earlier intent.
     * @param {import("./local-mutation-log.js").LocalMutationLogRecord} right - Later intent.
     * @returns {boolean} Whether scalar updates can share one transport mutation.
     */
    static canCoalesceConflictRecords(left: import("./local-mutation-log.js").LocalMutationLogRecord, right: import("./local-mutation-log.js").LocalMutationLogRecord): boolean;
    /**
     * Checks whether attributes contain scalar JSON values only.
     * @param {Record<string, import("../configuration-types.js").FrontendModelSyncJsonValue> | undefined} attributes - Attributes.
     * @returns {boolean} Whether every value is scalar.
     */
    static scalarSyncAttributes(attributes: Record<string, import("../configuration-types.js").FrontendModelSyncJsonValue> | undefined): boolean;
    /**
     * Builds one replay envelope for a safe transport group.
     * @param {Array<import("./local-mutation-log.js").LocalMutationLogRecord>} group - Transport group.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} Replay envelope.
     */
    static conflictReplayPayload(group: Array<import("./local-mutation-log.js").LocalMutationLogRecord>): Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * Builds a stable resource identity for ordering and remote generations.
     * @param {import("./local-mutation-log.js").LocalMutationLogRecord} record - Record.
     * @returns {string} Resource identity.
     */
    static conflictRecordIdentity(record: import("./local-mutation-log.js").LocalMutationLogRecord): string;
    /**
     * Rebases the direct pending successor from an authoritative acknowledgement.
     * @param {object} args - Rebase args.
     * @param {import("./sync-client-types.js").SyncClientConflictTrackingConfig} args.conflictTracking - Tracking config.
     * @param {import("./local-mutation-log.js").LocalMutationLogRecord} args.predecessor - Acknowledged predecessor.
     * @param {string | number | null} args.serverVersion - Authoritative server version.
     * @returns {Promise<void>}
     */
    static rebaseConflictSuccessor({ conflictTracking, predecessor, serverVersion }: {
        conflictTracking: import("./sync-client-types.js").SyncClientConflictTrackingConfig;
        predecessor: import("./local-mutation-log.js").LocalMutationLogRecord;
        serverVersion: string | number | null;
    }): Promise<void>;
    /**
     * Serializes sync work with the same key so callers do not have to keep app-local locks.
     * @param {string} key - Lock key.
     * @param {() => Promise<void>} callback - Work to run once previous work finished.
     * @returns {Promise<void>}
     */
    static singleFlight(key: string, callback: () => Promise<void>): Promise<void>;
    /**
     * Pulls backend sync changes with a framework-managed cursor row.
     * @param {object} args - Pull args.
     * @param {string} args.authenticationToken - Auth token to send with change requests.
     * @param {number} [args.batchSize] - Max syncs per request.
     * @param {ReturnType<typeof JSON.parse>} args.cursorModel - Model that responds to findBy/findOrInitializeBy for cursor persistence.
     * @param {string} args.cursorKey - Cursor option key.
     * @param {(payload: SyncChangesRequest) => Promise<SyncChangesResponse>} args.postChanges - Posts one changes request.
     * @param {Record<string, SyncResourceConfig>} args.resources - Resource policies.
     * @param {(progress: import("./sync-api-client-types.js").SyncPullProgress) => void} [args.onProgress] - Progress callback.
     * @returns {Promise<SyncChangesResult>} Pull result.
     */
    static pullChangesWithCursor(args: {
        authenticationToken: string;
        batchSize?: number;
        cursorModel: ReturnType<typeof JSON.parse>;
        cursorKey: string;
        postChanges: (payload: SyncChangesRequest) => Promise<SyncChangesResponse>;
        resources: Record<string, SyncResourceConfig>;
        onProgress?: (progress: import("./sync-api-client-types.js").SyncPullProgress) => void;
    }): Promise<SyncChangesResult>;
    /**
     * Loads a persisted sync cursor from a model row with a value column.
     * @param {{cursorKey: string, cursorModel: ReturnType<typeof JSON.parse>}} args - Cursor args.
     * @returns {Promise<string | null>} Persisted cursor payload.
     */
    static loadSyncCursor({ cursorKey, cursorModel }: {
        cursorKey: string;
        cursorModel: ReturnType<typeof JSON.parse>;
    }): Promise<string | null>;
    /**
     * Saves a persisted sync cursor to a model row with a value column.
     * @param {{cursor: SyncCursor, cursorKey: string, cursorModel: ReturnType<typeof JSON.parse>}} args - Cursor args.
     * @returns {Promise<void>}
     */
    static saveSyncCursor({ cursor, cursorKey, cursorModel }: {
        cursor: SyncCursor;
        cursorKey: string;
        cursorModel: ReturnType<typeof JSON.parse>;
    }): Promise<void>;
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
     * @param {(progress: import("./sync-api-client-types.js").SyncPullProgress) => void} [args.onProgress] - Progress callback invoked per applied page (and once for an empty pull) with the applied counts and the stable server total.
     * @returns {Promise<SyncChangesResult>} Pull result.
     */
    static pullChanges(args: {
        authenticationToken: string;
        batchSize?: number;
        loadCursor: () => Promise<SyncCursor | string | null | undefined>;
        saveCursor: (cursor: SyncCursor) => Promise<void>;
        postChanges: (payload: SyncChangesRequest) => Promise<SyncChangesResponse>;
        applySync: (sync: SyncChangeEnvelope) => Promise<SyncChangeApplyResult>;
        onProgress?: (progress: import("./sync-api-client-types.js").SyncPullProgress) => void;
    }): Promise<SyncChangesResult>;
    /**
     * Fetches and validates one backend sync changes page.
     * @param {object} args - Page args.
     * @param {SyncCursor} args.afterCursor - Last acknowledged cursor.
     * @param {string} args.authenticationToken - Auth token.
     * @param {number} args.batchSize - Page size.
     * @param {(payload: SyncChangesRequest) => Promise<SyncChangesResponse>} args.postChanges - Changes poster.
     * @param {SyncCursor} args.upToCursor - Snapshot upper-bound cursor.
     * @returns {Promise<{nextCursor: SyncCursor, syncs: SyncChangeEnvelope[], total: number | null, upToCursor: SyncCursor}>} Normalized changes page.
     */
    static changesPage({ afterCursor, authenticationToken, batchSize, postChanges, upToCursor }: {
        afterCursor: SyncCursor;
        authenticationToken: string;
        batchSize: number;
        postChanges: (payload: SyncChangesRequest) => Promise<SyncChangesResponse>;
        upToCursor: SyncCursor;
    }): Promise<{
        nextCursor: SyncCursor;
        syncs: SyncChangeEnvelope[];
        total: number | null;
        upToCursor: SyncCursor;
    }>;
    /**
     * Checks API response status and shape for change-feed pulls.
     * @param {SyncChangesResponse} response - Changes response.
     * @returns {void}
     */
    static ensureSuccessfulChangesResponse(response: SyncChangesResponse): void;
    /**
     * Converts a cursor into request params with the given prefix.
     * @param {"after" | "upTo"} prefix - Request field prefix.
     * @param {SyncCursor} cursor - Cursor to serialize.
     * @returns {Record<string, string | number | null>} Request params.
     */
    static cursorPayload(prefix: "after" | "upTo", cursor: SyncCursor): Record<string, string | number | null>;
    /**
     * Parses a persisted or response cursor payload.
     * @param {SyncCursor | string | Record<string, ReturnType<typeof JSON.parse>> | null | undefined} payload - Cursor payload.
     * @returns {SyncCursor} Parsed cursor.
     */
    static syncCursorFromPayload(payload: SyncCursor | string | Record<string, ReturnType<typeof JSON.parse>> | null | undefined): SyncCursor;
    /**
     * Builds a normalized sync row adapter.
     * @param {ReturnType<typeof JSON.parse>} payload - Raw sync payload.
     * @returns {SyncChangeEnvelope} Sync row adapter.
     */
    static syncEnvelopeFromPayload(payload: ReturnType<typeof JSON.parse>): SyncChangeEnvelope;
    /**
     * Builds an app-configured resource applier for pulled sync rows. The sync
     * mechanics stay here; apps only declare which models/attributes/hooks are
     * allowed for each resource type.
     * @param {Record<string, SyncResourceConfig>} resources - Resource policy map.
     * @param {(record: ReturnType<typeof JSON.parse>) => () => void} [onRecord] - Called with each record about to be written; returns a release callback invoked after the write (used for echo suppression).
     * @returns {(sync: SyncChangeEnvelope) => Promise<SyncChangeApplyResult>} Sync apply callback.
     */
    static resourceApplier(resources: Record<string, SyncResourceConfig>, onRecord?: (record: ReturnType<typeof JSON.parse>) => () => void): (sync: SyncChangeEnvelope) => Promise<SyncChangeApplyResult>;
    /**
     * Applies one sync row using declarative resource policy.
     * @param {{resources: Record<string, SyncResourceConfig>, sync: SyncChangeEnvelope, onRecord?: (record: ReturnType<typeof JSON.parse>) => () => void}} args - Apply args.
     * @returns {Promise<SyncChangeApplyResult>} Apply result.
     */
    static applyResourceSync({ onRecord, resources, sync }: {
        resources: Record<string, SyncResourceConfig>;
        sync: SyncChangeEnvelope;
        onRecord?: (record: ReturnType<typeof JSON.parse>) => () => void;
    }): Promise<SyncChangeApplyResult>;
    /**
     * Destroys a synced resource via its declared model policy.
     * @param {{resource: SyncResourceConfig, sync: SyncChangeEnvelope, onRecord?: (record: ReturnType<typeof JSON.parse>) => () => void}} args - Destroy args.
     * @returns {Promise<boolean>} Whether a local row was destroyed.
     */
    static destroySyncedResource({ onRecord, resource, sync }: {
        resource: SyncResourceConfig;
        sync: SyncChangeEnvelope;
        onRecord?: (record: ReturnType<typeof JSON.parse>) => () => void;
    }): Promise<boolean>;
    /**
     * Parses the embedded sync data JSON/object.
     * @param {SyncChangeEnvelope} sync - Sync row.
     * @returns {Record<string, unknown>} Sync data object.
     */
    static syncData(sync: SyncChangeEnvelope): Record<string, unknown>;
    /**
     * Drains pending sync records from a local Velocious model in stable order.
     * @param {object} args - Replay args.
     * @param {string} args.authenticationToken - Auth token to send with replay requests.
     * @param {number} [args.batchSize] - Max syncs per request.
     * @param {ReturnType<typeof JSON.parse>} args.syncModel - Local Sync model class.
     * @param {(payload: {authenticationToken: string, syncs: Array<Record<string, ReturnType<typeof JSON.parse>>>}) => Promise<SyncReplayResponse>} args.postReplay - Replay poster.
     * @returns {Promise<void>}
     */
    static replayLocalSyncs(args: {
        authenticationToken: string;
        batchSize?: number;
        syncModel: ReturnType<typeof JSON.parse>;
        postReplay: (payload: {
            authenticationToken: string;
            syncs: Array<Record<string, ReturnType<typeof JSON.parse>>>;
        }) => Promise<SyncReplayResponse>;
    }): Promise<void>;
    /**
     * Serializes the replay-relevant state of a local sync row for in-flight comparisons.
     * @param {ReturnType<typeof JSON.parse>} sync - Local sync row.
     * @returns {string} Stable snapshot of the row's replayed payload.
     */
    static localSyncReplaySnapshot(sync: ReturnType<typeof JSON.parse>): string;
    /**
     * Builds one replay envelope from a local sync row.
     * @param {ReturnType<typeof JSON.parse>} sync - Local sync row.
     * @returns {{clientUpdatedAt?: string, data: Record<string, unknown>, id: number, resourceId: string, resourceType: string, syncType: string}} Sync replay envelope.
     */
    static localSyncPayload(sync: ReturnType<typeof JSON.parse>): {
        clientUpdatedAt?: string;
        data: Record<string, unknown>;
        id: number;
        resourceId: string;
        resourceType: string;
        syncType: string;
    };
    /**
     * Resolves one local sync row payload, falling back to preloaded resource attributes.
     * @param {ReturnType<typeof JSON.parse>} sync - Local sync row.
     * @returns {Record<string, unknown>} Sync data.
     */
    static localSyncData(sync: ReturnType<typeof JSON.parse>): Record<string, unknown>;
    /**
     * Queues a local sync row for a Velocious model resource.
     * @param {object} args - Queue args.
     * @param {ReturnType<typeof JSON.parse>} args.resource - Resource being synced.
     * @param {ReturnType<typeof JSON.parse>} args.syncModel - Local Sync model class.
     * @param {Record<string, unknown>} [args.data] - Explicit sync data.
     * @param {string} [args.syncType] - Sync operation type.
     * @param {string[]} [args.localOnlyAttributes] - Attributes to strip from queued payloads.
     * @param {string[]} [args.booleanAttributes] - Attributes to coerce through sync boolean parsing.
     * @param {(data: Record<string, unknown>) => Record<string, unknown>} [args.normalizeData] - App-specific data normalizer.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} Local sync row.
     */
    static queueLocalSync(args: {
        resource: ReturnType<typeof JSON.parse>;
        syncModel: ReturnType<typeof JSON.parse>;
        data?: Record<string, unknown>;
        syncType?: string;
        localOnlyAttributes?: string[];
        booleanAttributes?: string[];
        normalizeData?: (data: Record<string, unknown>) => Record<string, unknown>;
    }): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Builds backend-safe queued sync data without mutating caller data. The default
     * (no explicit `data`) is the resource's attributes minus local-only attributes,
     * with booleans coerced and Date values serialized to ISO strings, so apps don't
     * need per-model tracked-payload builders.
     * @param {{resource: ReturnType<typeof JSON.parse>, data?: Record<string, unknown>, localOnlyAttributes?: string[], booleanAttributes?: string[], normalizeData?: (data: Record<string, unknown>) => Record<string, unknown>}} args - Data args.
     * @returns {Record<string, unknown>} Queued data.
     */
    static queuedSyncData(args: {
        resource: ReturnType<typeof JSON.parse>;
        data?: Record<string, unknown>;
        localOnlyAttributes?: string[];
        booleanAttributes?: string[];
        normalizeData?: (data: Record<string, unknown>) => Record<string, unknown>;
    }): Record<string, unknown>;
    /**
     * Builds a small app-facing local sync queue facade from declarative model config.
     * @param {object} args - Queue config.
     * @param {ReturnType<typeof JSON.parse>} args.syncModel - Local Sync model class.
     * @param {string} args.singleFlightKey - Key used to serialize backend replay.
     * @param {() => Promise<void>} args.syncPending - Backend replay callback.
     * @param {(resource: ReturnType<typeof JSON.parse>) => string[]} [args.localOnlyAttributes] - Resource-specific local-only attributes.
     * @param {(resource: ReturnType<typeof JSON.parse>) => string[]} [args.booleanAttributes] - Resource-specific SQLite boolean attributes.
     * @returns {{queue: (queueArgs: {resource: ReturnType<typeof JSON.parse>, data?: Record<string, unknown>, syncType?: string}) => Promise<ReturnType<typeof JSON.parse>>, syncPending: () => Promise<void>}} Configured local sync queue.
     */
    static localSyncQueue(args: {
        syncModel: ReturnType<typeof JSON.parse>;
        singleFlightKey: string;
        syncPending: () => Promise<void>;
        localOnlyAttributes?: (resource: ReturnType<typeof JSON.parse>) => string[];
        booleanAttributes?: (resource: ReturnType<typeof JSON.parse>) => string[];
    }): {
        queue: (queueArgs: {
            resource: ReturnType<typeof JSON.parse>;
            data?: Record<string, unknown>;
            syncType?: string;
        }) => Promise<ReturnType<typeof JSON.parse>>;
        syncPending: () => Promise<void>;
    };
    /**
     * Parses booleans commonly used by SQLite/offline sync payloads.
     * @param {unknown} value - Sync decision value.
     * @param {string} [description] - Error context.
     * @returns {boolean | null} Parsed boolean-like backend/local value.
     */
    static optionalBooleanSyncValue(value: unknown, description?: string): boolean | null;
    /**
     * Converts a boolean sync value to SQLite boolean storage.
     * @param {boolean | null} value - Sync boolean value.
     * @returns {0 | 1} SQLite-compatible boolean value.
     */
    static sqliteBooleanSyncValue(value: boolean | null): 0 | 1;
    /**
     * Projects generic sync counters into app-specific result keys.
     * @param {object} args - Result args.
     * @param {SyncChangesResult} args.result - Generic Velocious sync result.
     * @param {Record<string, {changedKey: string, countKey: string}>} args.resources - Resource result key map.
     * @returns {Record<string, unknown>} Projected result.
     */
    static syncResultForResources({ result, resources }: {
        result: SyncChangesResult;
        resources: Record<string, {
            changedKey: string;
            countKey: string;
        }>;
    }): Record<string, unknown>;
    /**
     * Drains pending sync records in stable order and marks acknowledged rows.
     * @param {object} args - Replay args.
     * @param {string} args.authenticationToken - Auth token to send with replay requests.
     * @param {number} [args.batchSize] - Max syncs per request. Defaults to 100.
     * @param {() => Promise<Array<unknown>>} args.pendingSyncs - Loads pending local sync rows in replay order.
     * @param {(sync: unknown) => string | number | null | undefined} args.syncId - Returns the local sync id.
     * @param {(sync: unknown) => Record<string, ReturnType<typeof JSON.parse>>} args.syncPayload - Builds the API sync envelope.
     * @param {(payload: {authenticationToken: string, syncs: Array<Record<string, ReturnType<typeof JSON.parse>>>}) => Promise<SyncReplayResponse>} args.postReplay - Posts one replay request.
     * @param {(sync: unknown, response: SyncReplayItem) => Promise<void>} args.markSuccessful - Marks one sync as successful locally.
     * @returns {Promise<void>} Resolves after all batches are replayed.
     */
    static replayPending(args: {
        authenticationToken: string;
        batchSize?: number;
        pendingSyncs: () => Promise<Array<unknown>>;
        syncId: (sync: unknown) => string | number | null | undefined;
        syncPayload: (sync: unknown) => Record<string, ReturnType<typeof JSON.parse>>;
        postReplay: (payload: {
            authenticationToken: string;
            syncs: Array<Record<string, ReturnType<typeof JSON.parse>>>;
        }) => Promise<SyncReplayResponse>;
        markSuccessful: (sync: unknown, response: SyncReplayItem) => Promise<void>;
    }): Promise<void>;
    /**
     * Replays one batch of syncs.
     * @param {object} args - Replay args.
     * @param {string} args.authenticationToken - Auth token.
     * @param {Array<unknown>} args.pendingSyncs - Batch syncs.
     * @param {(sync: unknown) => string | number | null | undefined} args.syncId - Sync id getter.
     * @param {(sync: unknown) => Record<string, ReturnType<typeof JSON.parse>>} args.syncPayload - Payload builder.
     * @param {(payload: {authenticationToken: string, syncs: Array<Record<string, ReturnType<typeof JSON.parse>>>}) => Promise<SyncReplayResponse>} args.postReplay - Replay poster.
     * @param {(sync: unknown, response: SyncReplayItem) => Promise<void>} args.markSuccessful - Success hook.
     * @returns {Promise<void>} Resolves after the batch is acknowledged.
     */
    static replayBatch(args: {
        authenticationToken: string;
        pendingSyncs: Array<unknown>;
        syncId: (sync: unknown) => string | number | null | undefined;
        syncPayload: (sync: unknown) => Record<string, ReturnType<typeof JSON.parse>>;
        postReplay: (payload: {
            authenticationToken: string;
            syncs: Array<Record<string, ReturnType<typeof JSON.parse>>>;
        }) => Promise<SyncReplayResponse>;
        markSuccessful: (sync: unknown, response: SyncReplayItem) => Promise<void>;
    }): Promise<void>;
    /**
     * Checks API response status and shape.
     * @param {SyncReplayResponse} response - Replay response.
     * @returns {void}
     */
    static ensureSuccessfulResponse(response: SyncReplayResponse): void;
    /**
     * Normalizes a positive batch size.
     * @param {number | undefined} batchSize - Batch size.
     * @returns {number} Positive batch size.
     */
    static normalizedBatchSize(batchSize: number | undefined): number;
}
//# sourceMappingURL=sync-api-client.d.ts.map