// @ts-check
import { optionalBoolean, optionalInteger } from "typanic";
import recordChanges from "../database/record-changes.js";
import { scalarModelPrimaryKeyValue } from "../utils/model-primary-key.js";
import { applySyncReplayResultToLocalMutationLog } from "./conflict-strategy.js";
/** @typedef {import("./sync-api-client-types.js").SyncChangeApplyResult} SyncChangeApplyResult */
/** @typedef {import("./sync-api-client-types.js").SyncChangeEnvelope} SyncChangeEnvelope */
/** @typedef {import("./sync-api-client-types.js").SyncChangesRequest} SyncChangesRequest */
/** @typedef {import("./sync-api-client-types.js").SyncChangesResponse} SyncChangesResponse */
/** @typedef {import("./sync-api-client-types.js").SyncChangesResult} SyncChangesResult */
/** @typedef {import("./sync-api-client-types.js").SyncCursor} SyncCursor */
/** @typedef {import("./sync-api-client-types.js").SyncReplayItem} SyncReplayItem */
/** @typedef {import("./sync-api-client-types.js").SyncReplayResponse} SyncReplayResponse */
/** @typedef {import("./sync-api-client-types.js").SyncResourceConfig} SyncResourceConfig */
const syncTaskPromises = new Map();
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
    static async queueConflictTrackedSync({ baseVersion, conflictTracking, data, operation, resource, resourceType, syncType }) {
        const resourceId = String(scalarModelPrimaryKeyValue(resource.id(), `Conflict-tracked sync for ${resourceType}`));
        const records = await conflictTracking.mutationLog.records();
        const predecessor = records
            .filter((record) => record.mutation.model === resourceType && record.mutation.payload?.resourceId === resourceId)
            .at(-1);
        const clientMutationId = conflictTracking.clientMutationId();
        const now = conflictTracking.now ? conflictTracking.now() : new Date();
        const predecessorTime = predecessor ? new Date(predecessor.mutation.occurredAt).getTime() : Number.NEGATIVE_INFINITY;
        const occurredAt = new Date(Math.max(now.getTime(), predecessorTime + 1)).toISOString();
        return await conflictTracking.mutationLog.append({
            dependencies: predecessor ? [{ clientMutationId: predecessor.mutation.clientMutationId, model: resourceType }] : [],
            mutation: {
                actorDeviceId: conflictTracking.actorDeviceId,
                actorUserId: conflictTracking.actorUserId,
                attributes: /** @type {Record<string, import("../configuration-types.js").FrontendModelSyncJsonValue>} */ (data),
                baseVersion,
                clientMutationId,
                model: resourceType,
                occurredAt,
                offlineGrantId: conflictTracking.offlineGrantId,
                operation,
                payload: { resourceId, syncType },
                policyHash: conflictTracking.policyHash
            }
        });
    }
    /**
     * Drains the existing mutation log in predecessor order. Independent records
     * continue after durable conflicts/rejections; successors stay blocked.
     * @param {object} args - Replay arguments.
     * @param {string} args.authenticationToken - Authentication token.
     * @param {number} [args.batchSize] - Batch size.
     * @param {import("./sync-client-types.js").SyncClientConflictTrackingConfig} args.conflictTracking - Tracking configuration.
     * @param {(payload: {authenticationToken: string, syncs: Array<Record<string, ReturnType<typeof JSON.parse>>>}, options?: {signal?: AbortSignal}) => Promise<SyncReplayResponse>} args.postReplay - Transport boundary.
     * @param {(identity: string) => number} args.remoteGeneration - Current remote generation.
     * @param {string} args.resourceType - Resource whose log records should drain.
     * @param {AbortSignal} [args.signal] - Lifecycle cancellation signal.
     * @returns {Promise<void>} Resolves when no ready intent remains.
     */
    static async replayConflictTrackedSyncs({ authenticationToken, batchSize, conflictTracking, postReplay, remoteGeneration, resourceType, signal }) {
        const maxBatchSize = this.normalizedBatchSize(batchSize);
        while (true) {
            throwIfSyncAborted(signal);
            const records = await conflictTracking.mutationLog.records();
            throwIfSyncAborted(signal);
            const statuses = new Map(records.map((record) => [record.mutation.clientMutationId, record.status]));
            const pending = records.filter((record) => record.status === "pending" && record.mutation.model === resourceType);
            const ready = pending.filter((record) => record.dependencies.every((dependency) => statuses.get(dependency.clientMutationId) === "synced"));
            if (ready.length === 0)
                return;
            const groups = this.conflictReplayGroups({ pending, ready }).slice(0, maxBatchSize);
            const generations = new Map(groups.map((group) => [group[0].mutation.clientMutationId, remoteGeneration(this.conflictRecordIdentity(group[0]))]));
            const response = await postReplay({
                authenticationToken,
                syncs: groups.map((group) => this.conflictReplayPayload(group))
            }, { signal });
            throwIfSyncAborted(signal);
            this.ensureSuccessfulResponse(response);
            const responsesById = new Map((response.syncs || []).map((result) => [String(result.id), result]));
            for (const group of groups) {
                throwIfSyncAborted(signal);
                const result = responsesById.get(group[0].mutation.clientMutationId);
                if (!result)
                    throw new Error(`Sync response missing result for mutation ${group[0].mutation.clientMutationId}`);
                if (!["successful", "duplicate", "conflict", "failed", "rejected"].includes(result.syncState)) {
                    throw new Error(`Invalid sync state returned for mutation ${group[0].mutation.clientMutationId}: ${result.syncState}`);
                }
                for (const record of group) {
                    await applySyncReplayResultToLocalMutationLog({ mutationLog: conflictTracking.mutationLog, record, result: /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (result) });
                    throwIfSyncAborted(signal);
                }
                if (["successful", "duplicate"].includes(result.syncState) && result.serverVersion !== undefined) {
                    const identity = this.conflictRecordIdentity(group[0]);
                    if (remoteGeneration(identity) === generations.get(group[0].mutation.clientMutationId)) {
                        await this.rebaseConflictSuccessor({ conflictTracking, predecessor: group[group.length - 1], serverVersion: result.serverVersion });
                        throwIfSyncAborted(signal);
                    }
                }
            }
        }
    }
    /**
     * Builds safe transport groups from root-ready records and their successors.
     * @param {{pending: Array<import("./local-mutation-log.js").LocalMutationLogRecord>, ready: Array<import("./local-mutation-log.js").LocalMutationLogRecord>}} args - Pending and root-ready records.
     * @returns {Array<Array<import("./local-mutation-log.js").LocalMutationLogRecord>>} Safe transport groups.
     */
    static conflictReplayGroups({ pending, ready }) {
        const groups = [];
        const selectedIdentities = new Set();
        for (const record of ready) {
            const identity = this.conflictRecordIdentity(record);
            if (selectedIdentities.has(identity))
                continue;
            const group = [record];
            let tail = record;
            while (true) {
                const successor = pending.find((candidate) => candidate.dependencies.some((dependency) => dependency.clientMutationId === tail.mutation.clientMutationId));
                if (!successor || !this.canCoalesceConflictRecords(tail, successor))
                    break;
                group.push(successor);
                tail = successor;
            }
            groups.push(group);
            selectedIdentities.add(identity);
        }
        return groups;
    }
    /**
     * Checks whether two durable intents can share one transport mutation.
     * @param {import("./local-mutation-log.js").LocalMutationLogRecord} left - Earlier intent.
     * @param {import("./local-mutation-log.js").LocalMutationLogRecord} right - Later intent.
     * @returns {boolean} Whether scalar updates can share one transport mutation.
     */
    static canCoalesceConflictRecords(left, right) {
        if (left.mutation.operation !== "update" || right.mutation.operation !== "update")
            return false;
        if (this.conflictRecordIdentity(left) !== this.conflictRecordIdentity(right))
            return false;
        if (left.mutation.baseVersion !== right.mutation.baseVersion)
            return false;
        if (!this.scalarSyncAttributes(left.mutation.attributes) || !this.scalarSyncAttributes(right.mutation.attributes))
            return false;
        return !Object.keys(left.mutation.attributes || {}).some((key) => Object.hasOwn(right.mutation.attributes || {}, key));
    }
    /**
     * Checks whether attributes contain scalar JSON values only.
     * @param {Record<string, import("../configuration-types.js").FrontendModelSyncJsonValue> | undefined} attributes - Attributes.
     * @returns {boolean} Whether every value is scalar.
     */
    static scalarSyncAttributes(attributes) {
        return Boolean(attributes) && Object.values(attributes || {}).every((value) => value === null || ["string", "number", "boolean"].includes(typeof value));
    }
    /**
     * Builds one replay envelope for a safe transport group.
     * @param {Array<import("./local-mutation-log.js").LocalMutationLogRecord>} group - Transport group.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} Replay envelope.
     */
    static conflictReplayPayload(group) {
        const first = group[0];
        const payload = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ ({
            baseVersion: first.mutation.baseVersion,
            clientUpdatedAt: first.mutation.occurredAt,
            data: Object.assign({}, ...group.map((record) => record.mutation.attributes || {})),
            id: first.mutation.clientMutationId,
            resourceId: first.mutation.payload?.resourceId,
            resourceType: first.mutation.model,
            syncType: first.mutation.payload?.syncType
        });
        return payload;
    }
    /**
     * Builds a stable resource identity for ordering and remote generations.
     * @param {import("./local-mutation-log.js").LocalMutationLogRecord} record - Record.
     * @returns {string} Resource identity.
     */
    static conflictRecordIdentity(record) {
        return `${record.mutation.model}:${String(record.mutation.payload?.resourceId)}`;
    }
    /**
     * Rebases the direct pending successor from an authoritative acknowledgement.
     * @param {object} args - Rebase args.
     * @param {import("./sync-client-types.js").SyncClientConflictTrackingConfig} args.conflictTracking - Tracking config.
     * @param {import("./local-mutation-log.js").LocalMutationLogRecord} args.predecessor - Acknowledged predecessor.
     * @param {string | number | null} args.serverVersion - Authoritative server version.
     * @returns {Promise<void>}
     */
    static async rebaseConflictSuccessor({ conflictTracking, predecessor, serverVersion }) {
        const successor = (await conflictTracking.mutationLog.pendingRecords())
            .find((record) => record.dependencies.some((dependency) => dependency.clientMutationId === predecessor.mutation.clientMutationId));
        if (!successor)
            return;
        await conflictTracking.mutationLog.updateMutation({
            id: successor.id,
            mutation: { ...successor.mutation, baseVersion: serverVersion }
        });
    }
    /**
     * Serializes sync work with the same key so callers do not have to keep app-local locks.
     * @param {string} key - Lock key.
     * @param {() => Promise<void>} callback - Work to run once previous work finished.
     * @returns {Promise<void>}
     */
    static async singleFlight(key, callback) {
        while (syncTaskPromises.has(key)) {
            try {
                await syncTaskPromises.get(key);
            }
            catch (_error) {
                // The failed flight's own caller observes that rejection; callers queued
                // behind it still run their own work so pending rows retry after the lock clears.
            }
        }
        const promise = callback();
        syncTaskPromises.set(key, promise);
        try {
            await promise;
        }
        finally {
            if (syncTaskPromises.get(key) === promise)
                syncTaskPromises.delete(key);
        }
    }
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
     * @param {AbortSignal} [args.signal] - Lifecycle cancellation signal.
     * @returns {Promise<SyncChangesResult>} Pull result.
     */
    static async pullChangesWithCursor(args) {
        return await this.pullChanges({
            authenticationToken: args.authenticationToken,
            batchSize: args.batchSize,
            loadCursor: async () => await this.loadSyncCursor({ cursorKey: args.cursorKey, cursorModel: args.cursorModel }),
            saveCursor: async (cursor) => await this.saveSyncCursor({ cursor, cursorKey: args.cursorKey, cursorModel: args.cursorModel }),
            postChanges: args.postChanges,
            applySync: this.resourceApplier(args.resources),
            onProgress: args.onProgress,
            signal: args.signal
        });
    }
    /**
     * Loads a persisted sync cursor from a model row with a value column.
     * @param {{cursorKey: string, cursorModel: ReturnType<typeof JSON.parse>}} args - Cursor args.
     * @returns {Promise<string | null>} Persisted cursor payload.
     */
    static async loadSyncCursor({ cursorKey, cursorModel }) {
        const option = await cursorModel.findBy({ key: cursorKey });
        return option ? option.value() : null;
    }
    /**
     * Saves a persisted sync cursor to a model row with a value column.
     * @param {{cursor: SyncCursor, cursorKey: string, cursorModel: ReturnType<typeof JSON.parse>}} args - Cursor args.
     * @returns {Promise<void>}
     */
    static async saveSyncCursor({ cursor, cursorKey, cursorModel }) {
        if (!cursor)
            return;
        const option = await cursorModel.findOrInitializeBy({ key: cursorKey });
        option.assign({ value: JSON.stringify(cursor) });
        if (option.isChanged())
            await option.save();
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
     * @param {(payload: SyncChangesRequest, options?: {signal?: AbortSignal}) => Promise<SyncChangesResponse>} args.postChanges - Posts one changes request.
     * @param {(sync: SyncChangeEnvelope) => Promise<SyncChangeApplyResult>} args.applySync - Applies one normalized sync row locally.
     * @param {(progress: import("./sync-api-client-types.js").SyncPullProgress) => void} [args.onProgress] - Progress callback invoked per applied page (and once for an empty pull) with the applied counts and the stable server total.
     * @param {AbortSignal} [args.signal] - Lifecycle cancellation signal.
     * @returns {Promise<SyncChangesResult>} Pull result.
     */
    static async pullChanges(args) {
        throwIfSyncAborted(args.signal);
        let afterCursor = this.syncCursorFromPayload(await args.loadCursor());
        let upToCursor = null;
        let pages = 0;
        let syncedCount = 0;
        let total = 0;
        let changed = false;
        const resourceCounts = /** @type {Record<string, number>} */ ({});
        const resourceChanged = /** @type {Record<string, boolean>} */ ({});
        const batchSize = this.normalizedBatchSize(args.batchSize);
        while (true) {
            throwIfSyncAborted(args.signal);
            const changesResponse = await this.changesPage({ ...args, afterCursor, batchSize, upToCursor });
            throwIfSyncAborted(args.signal);
            const syncs = changesResponse.syncs;
            if (!upToCursor)
                upToCursor = changesResponse.upToCursor;
            // The server counts pending rows from this request's cursor, so already-applied
            // pages plus this request's count stays the same total across every page: a stable
            // "of Y" denominator even as the cursor advances. A server that doesn't report the
            // count at all leaves the total at 0 for every page rather than drifting upwards
            // with the applied rows.
            if (changesResponse.total !== null)
                total = syncedCount + changesResponse.total;
            if (syncs.length === 0) {
                // Report the terminal progress once for an entirely empty pull so consumers observe
                // total 0; a pull that already applied pages reported its final counts on its last page.
                throwIfSyncAborted(args.signal);
                if (pages === 0 && args.onProgress)
                    args.onProgress({ pages, syncedCount, total });
                break;
            }
            pages += 1;
            // Coalesce record-change events across this page's applies so N applied rows trigger one
            // live-query re-run. Only the apply loop is batched: the network page fetch above and the
            // cursor save below stay outside, so live queries flush right after the applies instead of
            // waiting for the rest of the pull.
            await recordChanges.batch(async () => {
                for (const sync of syncs) {
                    throwIfSyncAborted(args.signal);
                    const applyResult = await args.applySync(sync);
                    throwIfSyncAborted(args.signal);
                    const resourceType = applyResult.resourceType ?? sync.resourceType();
                    changed ||= applyResult.changed === true;
                    syncedCount += 1;
                    if (resourceType) {
                        resourceCounts[resourceType] = (resourceCounts[resourceType] || 0) + 1;
                        resourceChanged[resourceType] ||= applyResult.changed === true;
                    }
                }
            });
            afterCursor = changesResponse.nextCursor;
            throwIfSyncAborted(args.signal);
            if (args.onProgress)
                args.onProgress({ pages, syncedCount, total });
            if (syncs.length < batchSize)
                break;
        }
        throwIfSyncAborted(args.signal);
        if (afterCursor)
            await args.saveCursor(afterCursor);
        throwIfSyncAborted(args.signal);
        return { changed, pages, resourceChanged, resourceCounts, syncedCount, total };
    }
    /**
     * Fetches and validates one backend sync changes page.
     * @param {object} args - Page args.
     * @param {SyncCursor} args.afterCursor - Last acknowledged cursor.
     * @param {string} args.authenticationToken - Auth token.
     * @param {number} args.batchSize - Page size.
     * @param {(payload: SyncChangesRequest, options?: {signal?: AbortSignal}) => Promise<SyncChangesResponse>} args.postChanges - Changes poster.
     * @param {AbortSignal} [args.signal] - Lifecycle cancellation signal.
     * @param {SyncCursor} args.upToCursor - Snapshot upper-bound cursor.
     * @returns {Promise<{nextCursor: SyncCursor, syncs: SyncChangeEnvelope[], total: number | null, upToCursor: SyncCursor}>} Normalized changes page.
     */
    static async changesPage({ afterCursor, authenticationToken, batchSize, postChanges, signal, upToCursor }) {
        throwIfSyncAborted(signal);
        const response = await postChanges({
            authenticationToken,
            limit: batchSize,
            ...this.cursorPayload("after", afterCursor),
            ...this.cursorPayload("upTo", upToCursor)
        }, { signal });
        throwIfSyncAborted(signal);
        this.ensureSuccessfulChangesResponse(response);
        const syncs = /** @type {unknown[]} */ (response.syncs);
        return {
            nextCursor: this.syncCursorFromPayload(response.nextCursor ?? null),
            syncs: syncs.map((syncPayload) => this.syncEnvelopeFromPayload(syncPayload)),
            total: optionalInteger(response.total),
            upToCursor: this.syncCursorFromPayload(response.upToCursor ?? null)
        };
    }
    /**
     * Checks API response status and shape for change-feed pulls.
     * @param {SyncChangesResponse} response - Changes response.
     * @returns {void}
     */
    static ensureSuccessfulChangesResponse(response) {
        if (response.status === "error")
            throw new Error(response.errorMessage || "Sync changes failed");
        if (!Array.isArray(response.syncs))
            throw new Error("Sync changes response missing syncs");
    }
    /**
     * Converts a cursor into request params with the given prefix.
     * @param {"after" | "upTo"} prefix - Request field prefix.
     * @param {SyncCursor} cursor - Cursor to serialize.
     * @returns {Record<string, string | number | null>} Request params.
     */
    static cursorPayload(prefix, cursor) {
        if (!cursor)
            return {};
        return {
            [`${prefix}Id`]: cursor.id,
            ...(cursor.serverSequence ? { [`${prefix}ServerSequence`]: cursor.serverSequence } : {}),
            [`${prefix}UpdatedAt`]: cursor.updatedAt
        };
    }
    /**
     * Parses a persisted or response cursor payload.
     * @param {SyncCursor | string | Record<string, ReturnType<typeof JSON.parse>> | null | undefined} payload - Cursor payload.
     * @returns {SyncCursor} Parsed cursor.
     */
    static syncCursorFromPayload(payload) {
        if (!payload)
            return null;
        if (typeof payload === "string") {
            try {
                return this.syncCursorFromPayload(JSON.parse(payload));
            }
            catch (_error) {
                return { id: null, serverSequence: null, updatedAt: payload };
            }
        }
        if (typeof payload !== "object" || Array.isArray(payload))
            return null;
        const updatedAt = typeof payload.updatedAt === "string" ? payload.updatedAt : null;
        if (!updatedAt)
            return null;
        return {
            id: payload.id === null || payload.id === undefined ? null : String(payload.id),
            serverSequence: optionalInteger(payload.serverSequence === "" ? null : payload.serverSequence),
            updatedAt
        };
    }
    /**
     * Builds a normalized sync row adapter.
     * @param {ReturnType<typeof JSON.parse>} payload - Raw sync payload.
     * @returns {SyncChangeEnvelope} Sync row adapter.
     */
    static syncEnvelopeFromPayload(payload) {
        if (!payload || typeof payload !== "object" || Array.isArray(payload))
            throw new Error("Sync changes entry must be an object");
        const syncPayload = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (payload);
        return {
            data: () => syncPayload.data,
            id: () => syncPayload.id,
            resourceId: () => syncPayload.resourceId,
            resourceType: () => syncPayload.resourceType === null || syncPayload.resourceType === undefined ? null : String(syncPayload.resourceType),
            syncType: () => syncPayload.syncType === null || syncPayload.syncType === undefined ? "" : String(syncPayload.syncType)
        };
    }
    /**
     * Builds an app-configured resource applier for pulled sync rows. The sync
     * mechanics stay here; apps only declare which models/attributes/hooks are
     * allowed for each resource type.
     * @param {Record<string, SyncResourceConfig>} resources - Resource policy map.
     * @param {(record: ReturnType<typeof JSON.parse>) => () => void} [onRecord] - Called with each record about to be written; returns a release callback invoked after the write (used for echo suppression).
     * @returns {(sync: SyncChangeEnvelope) => Promise<SyncChangeApplyResult>} Sync apply callback.
     */
    static resourceApplier(resources, onRecord) {
        return async (sync) => await this.applyResourceSync({ onRecord, resources, sync });
    }
    /**
     * Applies one sync row using declarative resource policy.
     * @param {{resources: Record<string, SyncResourceConfig>, sync: SyncChangeEnvelope, onRecord?: (record: ReturnType<typeof JSON.parse>) => () => void}} args - Apply args.
     * @returns {Promise<SyncChangeApplyResult>} Apply result.
     */
    static async applyResourceSync({ onRecord, resources, sync }) {
        const resourceType = sync.resourceType();
        const resource = resourceType ? resources[resourceType] : undefined;
        if (!resource || !resource.enabled)
            return { changed: false, resourceType };
        if (sync.syncType() === "delete") {
            return { changed: await this.destroySyncedResource({ onRecord, resource, sync }), resourceType };
        }
        const data = this.syncData(sync);
        const record = resource.findRecord ? await resource.findRecord({ data, resourceId: sync.resourceId(), sync }) : await resource.modelClass.findOrInitializeBy({ id: data.id ?? sync.resourceId() });
        const attributes = await resource.attributes({ data, record, sync });
        const releaseRecord = onRecord ? onRecord(record) : null;
        let changed = false;
        try {
            record.assign(attributes);
            if (record.isChanged()) {
                await record.save();
                changed = true;
            }
            if (resource.afterApply) {
                const hookChanged = await resource.afterApply({ attributes, data, record, sync });
                changed ||= hookChanged === true;
            }
        }
        finally {
            if (releaseRecord)
                releaseRecord();
        }
        return { changed, resourceType };
    }
    /**
     * Destroys a synced resource via its declared model policy.
     * @param {{resource: SyncResourceConfig, sync: SyncChangeEnvelope, onRecord?: (record: ReturnType<typeof JSON.parse>) => () => void}} args - Destroy args.
     * @returns {Promise<boolean>} Whether a local row was destroyed.
     */
    static async destroySyncedResource({ onRecord, resource, sync }) {
        const id = sync.resourceId();
        const record = resource.findRecordForDelete ? await resource.findRecordForDelete({ resourceId: id, sync }) : await resource.modelClass.findBy({ id });
        if (!record)
            return false;
        const releaseRecord = onRecord ? onRecord(record) : null;
        try {
            await record.destroy();
        }
        finally {
            if (releaseRecord)
                releaseRecord();
        }
        return true;
    }
    /**
     * Parses the embedded sync data JSON/object.
     * @param {SyncChangeEnvelope} sync - Sync row.
     * @returns {Record<string, unknown>} Sync data object.
     */
    static syncData(sync) {
        const data = sync.data();
        if (!data)
            throw new Error(`Sync ${sync.id()} is missing data`);
        if (typeof data === "string")
            return /** @type {Record<string, unknown>} */ (JSON.parse(data));
        if (typeof data === "object" && !Array.isArray(data))
            return /** @type {Record<string, unknown>} */ (data);
        throw new Error(`Sync ${sync.id()} has invalid data`);
    }
    /**
     * Drains pending sync records from a local Velocious model in stable order.
     * @param {object} args - Replay args.
     * @param {string} args.authenticationToken - Auth token to send with replay requests.
     * @param {number} [args.batchSize] - Max syncs per request.
     * @param {ReturnType<typeof JSON.parse>} args.syncModel - Local Sync model class.
     * @param {(payload: {authenticationToken: string, syncs: Array<Record<string, ReturnType<typeof JSON.parse>>>}, options?: {signal?: AbortSignal}) => Promise<SyncReplayResponse>} args.postReplay - Replay poster.
     * @param {AbortSignal} [args.signal] - Lifecycle cancellation signal.
     * @returns {Promise<void>}
     */
    static async replayLocalSyncs(args) {
        const postedSnapshotsBySyncId = new Map();
        await this.replayPending({
            authenticationToken: args.authenticationToken,
            batchSize: args.batchSize,
            markSuccessful: async (sync) => {
                const syncId = /** @type {{id: () => string | number | null | undefined}} */ (sync).id();
                // Reload with the resource preloaded so rows relying on the resource-attributes
                // fallback in localSyncData compare against the same snapshot they posted.
                const currentSync = await args.syncModel.preload({ resource: true }).where({ id: syncId }).first();
                if (!currentSync)
                    return;
                // A row edited while its old payload was in flight stays pending, so the
                // newer local change replays on the next drain instead of being lost.
                if (this.localSyncReplaySnapshot(currentSync) !== postedSnapshotsBySyncId.get(String(syncId)))
                    return;
                await currentSync.update({ state: "success" });
            },
            pendingSyncs: async () => await args.syncModel.preload({ resource: true }).where({ state: "pending" }).order("created_at").toArray(),
            postReplay: args.postReplay,
            signal: args.signal,
            syncId: (sync) => /** @type {{id: () => string | number | null | undefined}} */ (sync).id(),
            syncPayload: (sync) => {
                postedSnapshotsBySyncId.set(String(/** @type {{id: () => string | number | null | undefined}} */ (sync).id()), this.localSyncReplaySnapshot(sync));
                return this.localSyncPayload(sync);
            }
        });
    }
    /**
     * Serializes the replay-relevant state of a local sync row for in-flight comparisons.
     * @param {ReturnType<typeof JSON.parse>} sync - Local sync row.
     * @returns {string} Stable snapshot of the row's replayed payload.
     */
    static localSyncReplaySnapshot(sync) {
        return JSON.stringify({ data: this.localSyncData(sync), syncType: sync.syncType() });
    }
    /**
     * Builds one replay envelope from a local sync row.
     * @param {ReturnType<typeof JSON.parse>} sync - Local sync row.
     * @returns {{clientUpdatedAt?: string, data: Record<string, unknown>, id: number, resourceId: string, resourceType: string, syncType: string}} Sync replay envelope.
     */
    static localSyncPayload(sync) {
        const clientUpdatedAt = sync.updatedAt() || sync.createdAt();
        return {
            clientUpdatedAt: clientUpdatedAt ? clientUpdatedAt.toISOString() : undefined,
            data: this.localSyncData(sync),
            id: /** @type {number} */ ( /** @type {unknown} */(sync.id())),
            resourceId: String(sync.resourceId()),
            resourceType: sync.resourceType() || "",
            syncType: sync.syncType()
        };
    }
    /**
     * Resolves one local sync row payload, falling back to preloaded resource attributes.
     * @param {ReturnType<typeof JSON.parse>} sync - Local sync row.
     * @returns {Record<string, unknown>} Sync data.
     */
    static localSyncData(sync) {
        let syncData = /** @type {string | Record<string, unknown>} */ (sync.data() || {});
        if (typeof syncData === "string") {
            try {
                syncData = /** @type {Record<string, unknown>} */ (JSON.parse(syncData));
            }
            catch (_error) {
                syncData = {};
            }
        }
        if (Object.keys(syncData).length > 0)
            return syncData;
        try {
            return /** @type {Record<string, unknown>} */ (sync.resource().attributes());
        }
        catch (_error) {
            return {};
        }
    }
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
    static async queueLocalSync(args) {
        const resourceRecordId = scalarModelPrimaryKeyValue(args.resource.id(), "Local sync queueing");
        const modelClass = args.resource.constructor;
        if (typeof modelClass.getModelName !== "function") {
            throw new Error("The resource model class must implement static getModelName() to queue sync data - class names are not stable across explicit model names and minified bundles");
        }
        const resourceType = modelClass.getModelName();
        const syncData = this.queuedSyncData(args);
        const syncType = args.syncType || "update";
        if (!resourceRecordId)
            throw new Error("resource.id() is required to queue sync data");
        const resourceId = String(resourceRecordId);
        const existingSync = await args.syncModel.findBy({ resourceId, resourceType });
        if (existingSync) {
            await existingSync.update({
                data: syncData,
                state: "pending",
                syncType
            });
            return existingSync;
        }
        return await args.syncModel.create({
            data: syncData,
            resourceId,
            resourceType,
            state: "pending",
            syncType
        });
    }
    /**
     * Builds backend-safe queued sync data without mutating caller data. The default
     * (no explicit `data`) is the resource's attributes minus local-only attributes,
     * with booleans coerced and Date values serialized to ISO strings, so apps don't
     * need per-model tracked-payload builders.
     * @param {{resource: ReturnType<typeof JSON.parse>, data?: Record<string, unknown>, localOnlyAttributes?: string[], booleanAttributes?: string[], normalizeData?: (data: Record<string, unknown>) => Record<string, unknown>}} args - Data args.
     * @returns {Record<string, unknown>} Queued data.
     */
    static queuedSyncData(args) {
        const inputData = args.data ?? /** @type {Record<string, unknown>} */ (args.resource.attributes());
        const normalizedData = args.normalizeData ? args.normalizeData(inputData) : inputData;
        const syncData = { ...normalizedData };
        for (const attributeName of args.localOnlyAttributes || [])
            delete syncData[attributeName];
        for (const attributeName of args.booleanAttributes || []) {
            if (Object.hasOwn(syncData, attributeName))
                syncData[attributeName] = this.optionalBooleanSyncValue(syncData[attributeName], attributeName);
        }
        for (const [attributeName, value] of Object.entries(syncData)) {
            if (value instanceof Date)
                syncData[attributeName] = value.toISOString();
        }
        return syncData;
    }
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
    static localSyncQueue(args) {
        return {
            queue: async (queueArgs) => await this.queueLocalSync({
                ...queueArgs,
                booleanAttributes: args.booleanAttributes ? args.booleanAttributes(queueArgs.resource) : [],
                localOnlyAttributes: args.localOnlyAttributes ? args.localOnlyAttributes(queueArgs.resource) : [],
                syncModel: args.syncModel
            }),
            syncPending: async () => await this.singleFlight(args.singleFlightKey, args.syncPending)
        };
    }
    /**
     * Parses booleans commonly used by SQLite/offline sync payloads.
     * @param {unknown} value - Sync decision value.
     * @param {string} [description] - Error context.
     * @returns {boolean | null} Parsed boolean-like backend/local value.
     */
    static optionalBooleanSyncValue(value, description = "sync boolean") {
        if (value == null)
            return null;
        if (value === 1)
            return true;
        if (value === 0)
            return false;
        return optionalBoolean(value, description);
    }
    /**
     * Converts a boolean sync value to SQLite boolean storage.
     * @param {boolean | null} value - Sync boolean value.
     * @returns {0 | 1} SQLite-compatible boolean value.
     */
    static sqliteBooleanSyncValue(value) {
        return value === true ? 1 : 0;
    }
    /**
     * Projects generic sync counters into app-specific result keys.
     * @param {object} args - Result args.
     * @param {SyncChangesResult} args.result - Generic Velocious sync result.
     * @param {Record<string, {changedKey: string, countKey: string}>} args.resources - Resource result key map.
     * @returns {Record<string, unknown>} Projected result.
     */
    static syncResultForResources({ result, resources }) {
        const syncResult = /** @type {Record<string, unknown>} */ ({
            changed: result.changed,
            pages: result.pages,
            syncedCount: result.syncedCount
        });
        for (const [resourceType, keys] of Object.entries(resources)) {
            syncResult[keys.countKey] = result.resourceCounts[resourceType] || 0;
            syncResult[keys.changedKey] = result.resourceChanged[resourceType] || false;
        }
        return syncResult;
    }
    /**
     * Drains pending sync records in stable order and marks acknowledged rows.
     * @param {object} args - Replay args.
     * @param {string} args.authenticationToken - Auth token to send with replay requests.
     * @param {number} [args.batchSize] - Max syncs per request. Defaults to 100.
     * @param {() => Promise<Array<unknown>>} args.pendingSyncs - Loads pending local sync rows in replay order.
     * @param {(sync: unknown) => string | number | null | undefined} args.syncId - Returns the local sync id.
     * @param {(sync: unknown) => Record<string, ReturnType<typeof JSON.parse>>} args.syncPayload - Builds the API sync envelope.
     * @param {(payload: {authenticationToken: string, syncs: Array<Record<string, ReturnType<typeof JSON.parse>>>}, options?: {signal?: AbortSignal}) => Promise<SyncReplayResponse>} args.postReplay - Posts one replay request.
     * @param {(sync: unknown, response: SyncReplayItem) => Promise<void>} args.markSuccessful - Marks one sync as successful locally.
     * @param {AbortSignal} [args.signal] - Lifecycle cancellation signal.
     * @returns {Promise<void>} Resolves after all batches are replayed.
     */
    static async replayPending(args) {
        throwIfSyncAborted(args.signal);
        const pendingSyncs = await args.pendingSyncs();
        throwIfSyncAborted(args.signal);
        const batchSize = this.normalizedBatchSize(args.batchSize);
        for (let offset = 0; offset < pendingSyncs.length; offset += batchSize) {
            throwIfSyncAborted(args.signal);
            await this.replayBatch({ ...args, pendingSyncs: pendingSyncs.slice(offset, offset + batchSize) });
        }
    }
    /**
     * Replays one batch of syncs.
     * @param {object} args - Replay args.
     * @param {string} args.authenticationToken - Auth token.
     * @param {Array<unknown>} args.pendingSyncs - Batch syncs.
     * @param {(sync: unknown) => string | number | null | undefined} args.syncId - Sync id getter.
     * @param {(sync: unknown) => Record<string, ReturnType<typeof JSON.parse>>} args.syncPayload - Payload builder.
     * @param {(payload: {authenticationToken: string, syncs: Array<Record<string, ReturnType<typeof JSON.parse>>>}, options?: {signal?: AbortSignal}) => Promise<SyncReplayResponse>} args.postReplay - Replay poster.
     * @param {(sync: unknown, response: SyncReplayItem) => Promise<void>} args.markSuccessful - Success hook.
     * @param {AbortSignal} [args.signal] - Lifecycle cancellation signal.
     * @returns {Promise<void>} Resolves after the batch is acknowledged.
     */
    static async replayBatch(args) {
        const { authenticationToken, markSuccessful, pendingSyncs, postReplay, signal, syncId, syncPayload } = args;
        if (pendingSyncs.length === 0)
            return;
        throwIfSyncAborted(signal);
        const syncsById = new Map();
        for (const sync of pendingSyncs) {
            const id = syncId(sync);
            if (id !== undefined && id !== null)
                syncsById.set(String(id), sync);
        }
        const response = await postReplay({
            authenticationToken,
            syncs: pendingSyncs.map((sync) => syncPayload(sync))
        }, { signal });
        throwIfSyncAborted(signal);
        this.ensureSuccessfulResponse(response);
        for (const syncResponse of response.syncs || []) {
            throwIfSyncAborted(signal);
            const sync = syncsById.get(String(syncResponse.id));
            if (!sync)
                continue;
            if (syncResponse.syncState !== "successful") {
                throw new Error(`Invalid sync state returned for sync ${String(syncResponse.id)}: ${String(syncResponse.syncState)}`);
            }
            await markSuccessful(sync, syncResponse);
            throwIfSyncAborted(signal);
        }
    }
    /**
     * Checks API response status and shape.
     * @param {SyncReplayResponse} response - Replay response.
     * @returns {void}
     */
    static ensureSuccessfulResponse(response) {
        if (response.status === "error")
            throw new Error(response.errorMessage || "Sync failed");
        if (!Array.isArray(response.syncs))
            throw new Error("Sync response missing syncs");
    }
    /**
     * Normalizes a positive batch size.
     * @param {number | undefined} batchSize - Batch size.
     * @returns {number} Positive batch size.
     */
    static normalizedBatchSize(batchSize) {
        if (typeof batchSize !== "number" || !Number.isFinite(batchSize) || batchSize < 1)
            return 100;
        return Math.floor(batchSize);
    }
}
/**
 * Throws the exact abort reason at lifecycle boundaries so callers can
 * distinguish an expected cooperative stop from transport or apply failures.
 * @param {AbortSignal | undefined} signal - Lifecycle signal.
 * @returns {void}
 */
function throwIfSyncAborted(signal) {
    if (!signal?.aborted)
        return;
    throw signal.reason instanceof Error ? signal.reason : new Error("Sync operation aborted");
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3luYy1hcGktY2xpZW50LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3N5bmMvc3luYy1hcGktY2xpZW50LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUMsZUFBZSxFQUFFLGVBQWUsRUFBQyxNQUFNLFNBQVMsQ0FBQTtBQUV4RCxPQUFPLGFBQWEsTUFBTSwrQkFBK0IsQ0FBQTtBQUN6RCxPQUFPLEVBQUMsMEJBQTBCLEVBQUMsTUFBTSwrQkFBK0IsQ0FBQTtBQUN4RSxPQUFPLEVBQUMsdUNBQXVDLEVBQUMsTUFBTSx3QkFBd0IsQ0FBQTtBQUU5RSxrR0FBa0c7QUFDbEcsNEZBQTRGO0FBQzVGLDRGQUE0RjtBQUM1Riw4RkFBOEY7QUFDOUYsMEZBQTBGO0FBQzFGLDRFQUE0RTtBQUM1RSxvRkFBb0Y7QUFDcEYsNEZBQTRGO0FBQzVGLDRGQUE0RjtBQUM1RixNQUFNLGdCQUFnQixHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7QUFFbEM7Ozs7R0FJRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8sYUFBYTtJQUNoQzs7Ozs7Ozs7Ozs7T0FXRztJQUNILE1BQU0sQ0FBQyxLQUFLLENBQUMsd0JBQXdCLENBQUMsRUFBQyxXQUFXLEVBQUUsZ0JBQWdCLEVBQUUsSUFBSSxFQUFFLFNBQVMsRUFBRSxRQUFRLEVBQUUsWUFBWSxFQUFFLFFBQVEsRUFBQztRQUN0SCxNQUFNLFVBQVUsR0FBRyxNQUFNLENBQUMsMEJBQTBCLENBQUMsUUFBUSxDQUFDLEVBQUUsRUFBRSxFQUFFLDZCQUE2QixZQUFZLEVBQUUsQ0FBQyxDQUFDLENBQUE7UUFDakgsTUFBTSxPQUFPLEdBQUcsTUFBTSxnQkFBZ0IsQ0FBQyxXQUFXLENBQUMsT0FBTyxFQUFFLENBQUE7UUFDNUQsTUFBTSxXQUFXLEdBQUcsT0FBTzthQUN4QixNQUFNLENBQUMsQ0FBQyxNQUFNLEVBQUUsRUFBRSxDQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUMsS0FBSyxLQUFLLFlBQVksSUFBSSxNQUFNLENBQUMsUUFBUSxDQUFDLE9BQU8sRUFBRSxVQUFVLEtBQUssVUFBVSxDQUFDO2FBQ2hILEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFBO1FBQ1QsTUFBTSxnQkFBZ0IsR0FBRyxnQkFBZ0IsQ0FBQyxnQkFBZ0IsRUFBRSxDQUFBO1FBQzVELE1BQU0sR0FBRyxHQUFHLGdCQUFnQixDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsZ0JBQWdCLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQyxDQUFDLElBQUksSUFBSSxFQUFFLENBQUE7UUFDdEUsTUFBTSxlQUFlLEdBQUcsV0FBVyxDQUFDLENBQUMsQ0FBQyxJQUFJLElBQUksQ0FBQyxXQUFXLENBQUMsUUFBUSxDQUFDLFVBQVUsQ0FBQyxDQUFDLE9BQU8sRUFBRSxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsaUJBQWlCLENBQUE7UUFDcEgsTUFBTSxVQUFVLEdBQUcsSUFBSSxJQUFJLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsT0FBTyxFQUFFLEVBQUUsZUFBZSxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsV0FBVyxFQUFFLENBQUE7UUFFdkYsT0FBTyxNQUFNLGdCQUFnQixDQUFDLFdBQVcsQ0FBQyxNQUFNLENBQUM7WUFDL0MsWUFBWSxFQUFFLFdBQVcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFDLGdCQUFnQixFQUFFLFdBQVcsQ0FBQyxRQUFRLENBQUMsZ0JBQWdCLEVBQUUsS0FBSyxFQUFFLFlBQVksRUFBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUU7WUFDakgsUUFBUSxFQUFFO2dCQUNSLGFBQWEsRUFBRSxnQkFBZ0IsQ0FBQyxhQUFhO2dCQUM3QyxXQUFXLEVBQUUsZ0JBQWdCLENBQUMsV0FBVztnQkFDekMsVUFBVSxFQUFFLDZGQUE2RixDQUFDLENBQUMsSUFBSSxDQUFDO2dCQUNoSCxXQUFXO2dCQUNYLGdCQUFnQjtnQkFDaEIsS0FBSyxFQUFFLFlBQVk7Z0JBQ25CLFVBQVU7Z0JBQ1YsY0FBYyxFQUFFLGdCQUFnQixDQUFDLGNBQWM7Z0JBQy9DLFNBQVM7Z0JBQ1QsT0FBTyxFQUFFLEVBQUMsVUFBVSxFQUFFLFFBQVEsRUFBQztnQkFDL0IsVUFBVSxFQUFFLGdCQUFnQixDQUFDLFVBQVU7YUFDeEM7U0FDRixDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQ7Ozs7Ozs7Ozs7OztPQVlHO0lBQ0gsTUFBTSxDQUFDLEtBQUssQ0FBQywwQkFBMEIsQ0FBQyxFQUFDLG1CQUFtQixFQUFFLFNBQVMsRUFBRSxnQkFBZ0IsRUFBRSxVQUFVLEVBQUUsZ0JBQWdCLEVBQUUsWUFBWSxFQUFFLE1BQU0sRUFBQztRQUM1SSxNQUFNLFlBQVksR0FBRyxJQUFJLENBQUMsbUJBQW1CLENBQUMsU0FBUyxDQUFDLENBQUE7UUFFeEQsT0FBTyxJQUFJLEVBQUUsQ0FBQztZQUNaLGtCQUFrQixDQUFDLE1BQU0sQ0FBQyxDQUFBO1lBQzFCLE1BQU0sT0FBTyxHQUFHLE1BQU0sZ0JBQWdCLENBQUMsV0FBVyxDQUFDLE9BQU8sRUFBRSxDQUFBO1lBQzVELGtCQUFrQixDQUFDLE1BQU0sQ0FBQyxDQUFBO1lBQzFCLE1BQU0sUUFBUSxHQUFHLElBQUksR0FBRyxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQyxNQUFNLEVBQUUsRUFBRSxDQUFDLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxnQkFBZ0IsRUFBRSxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFBO1lBQ3BHLE1BQU0sT0FBTyxHQUFHLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQyxNQUFNLEVBQUUsRUFBRSxDQUFDLE1BQU0sQ0FBQyxNQUFNLEtBQUssU0FBUyxJQUFJLE1BQU0sQ0FBQyxRQUFRLENBQUMsS0FBSyxLQUFLLFlBQVksQ0FBQyxDQUFBO1lBQ2pILE1BQU0sS0FBSyxHQUFHLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQyxNQUFNLEVBQUUsRUFBRSxDQUFDLE1BQU0sQ0FBQyxZQUFZLENBQUMsS0FBSyxDQUFDLENBQUMsVUFBVSxFQUFFLEVBQUUsQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQyxnQkFBZ0IsQ0FBQyxLQUFLLFFBQVEsQ0FBQyxDQUFDLENBQUE7WUFFM0ksSUFBSSxLQUFLLENBQUMsTUFBTSxLQUFLLENBQUM7Z0JBQUUsT0FBTTtZQUU5QixNQUFNLE1BQU0sR0FBRyxJQUFJLENBQUMsb0JBQW9CLENBQUMsRUFBQyxPQUFPLEVBQUUsS0FBSyxFQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxFQUFFLFlBQVksQ0FBQyxDQUFBO1lBQ2pGLE1BQU0sV0FBVyxHQUFHLElBQUksR0FBRyxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxnQkFBZ0IsRUFBRSxnQkFBZ0IsQ0FBQyxJQUFJLENBQUMsc0JBQXNCLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQTtZQUNqSixNQUFNLFFBQVEsR0FBRyxNQUFNLFVBQVUsQ0FBQztnQkFDaEMsbUJBQW1CO2dCQUNuQixLQUFLLEVBQUUsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsSUFBSSxDQUFDLHFCQUFxQixDQUFDLEtBQUssQ0FBQyxDQUFDO2FBQ2hFLEVBQUUsRUFBQyxNQUFNLEVBQUMsQ0FBQyxDQUFBO1lBRVosa0JBQWtCLENBQUMsTUFBTSxDQUFDLENBQUE7WUFDMUIsSUFBSSxDQUFDLHdCQUF3QixDQUFDLFFBQVEsQ0FBQyxDQUFBO1lBRXZDLE1BQU0sYUFBYSxHQUFHLElBQUksR0FBRyxDQUFDLENBQUMsUUFBUSxDQUFDLEtBQUssSUFBSSxFQUFFLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxNQUFNLEVBQUUsRUFBRSxDQUFDLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUMsRUFBRSxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUE7WUFFbEcsS0FBSyxNQUFNLEtBQUssSUFBSSxNQUFNLEVBQUUsQ0FBQztnQkFDM0Isa0JBQWtCLENBQUMsTUFBTSxDQUFDLENBQUE7Z0JBQzFCLE1BQU0sTUFBTSxHQUFHLGFBQWEsQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFBO2dCQUVwRSxJQUFJLENBQUMsTUFBTTtvQkFBRSxNQUFNLElBQUksS0FBSyxDQUFDLDZDQUE2QyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLGdCQUFnQixFQUFFLENBQUMsQ0FBQTtnQkFDL0csSUFBSSxDQUFDLENBQUMsWUFBWSxFQUFFLFdBQVcsRUFBRSxVQUFVLEVBQUUsUUFBUSxFQUFFLFVBQVUsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUMsU0FBUyxDQUFDLEVBQUUsQ0FBQztvQkFDOUYsTUFBTSxJQUFJLEtBQUssQ0FBQyw0Q0FBNEMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxnQkFBZ0IsS0FBSyxNQUFNLENBQUMsU0FBUyxFQUFFLENBQUMsQ0FBQTtnQkFDeEgsQ0FBQztnQkFFRCxLQUFLLE1BQU0sTUFBTSxJQUFJLEtBQUssRUFBRSxDQUFDO29CQUMzQixNQUFNLHVDQUF1QyxDQUFDLEVBQUMsV0FBVyxFQUFFLGdCQUFnQixDQUFDLFdBQVcsRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLDREQUE0RCxDQUFDLENBQUMsTUFBTSxDQUFDLEVBQUMsQ0FBQyxDQUFBO29CQUNqTCxrQkFBa0IsQ0FBQyxNQUFNLENBQUMsQ0FBQTtnQkFDNUIsQ0FBQztnQkFFRCxJQUFJLENBQUMsWUFBWSxFQUFFLFdBQVcsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUMsU0FBUyxDQUFDLElBQUksTUFBTSxDQUFDLGFBQWEsS0FBSyxTQUFTLEVBQUUsQ0FBQztvQkFDakcsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLHNCQUFzQixDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFBO29CQUV0RCxJQUFJLGdCQUFnQixDQUFDLFFBQVEsQ0FBQyxLQUFLLFdBQVcsQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxnQkFBZ0IsQ0FBQyxFQUFFLENBQUM7d0JBQ3ZGLE1BQU0sSUFBSSxDQUFDLHVCQUF1QixDQUFDLEVBQUMsZ0JBQWdCLEVBQUUsV0FBVyxFQUFFLEtBQUssQ0FBQyxLQUFLLENBQUMsTUFBTSxHQUFHLENBQUMsQ0FBQyxFQUFFLGFBQWEsRUFBRSxNQUFNLENBQUMsYUFBYSxFQUFDLENBQUMsQ0FBQTt3QkFDakksa0JBQWtCLENBQUMsTUFBTSxDQUFDLENBQUE7b0JBQzVCLENBQUM7Z0JBQ0gsQ0FBQztZQUNILENBQUM7UUFDSCxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxNQUFNLENBQUMsb0JBQW9CLENBQUMsRUFBQyxPQUFPLEVBQUUsS0FBSyxFQUFDO1FBQzFDLE1BQU0sTUFBTSxHQUFHLEVBQUUsQ0FBQTtRQUNqQixNQUFNLGtCQUFrQixHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7UUFFcEMsS0FBSyxNQUFNLE1BQU0sSUFBSSxLQUFLLEVBQUUsQ0FBQztZQUMzQixNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUMsc0JBQXNCLENBQUMsTUFBTSxDQUFDLENBQUE7WUFFcEQsSUFBSSxrQkFBa0IsQ0FBQyxHQUFHLENBQUMsUUFBUSxDQUFDO2dCQUFFLFNBQVE7WUFFOUMsTUFBTSxLQUFLLEdBQUcsQ0FBQyxNQUFNLENBQUMsQ0FBQTtZQUN0QixJQUFJLElBQUksR0FBRyxNQUFNLENBQUE7WUFFakIsT0FBTyxJQUFJLEVBQUUsQ0FBQztnQkFDWixNQUFNLFNBQVMsR0FBRyxPQUFPLENBQUMsSUFBSSxDQUFDLENBQUMsU0FBUyxFQUFFLEVBQUUsQ0FBQyxTQUFTLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxDQUFDLFVBQVUsRUFBRSxFQUFFLENBQUMsVUFBVSxDQUFDLGdCQUFnQixLQUFLLElBQUksQ0FBQyxRQUFRLENBQUMsZ0JBQWdCLENBQUMsQ0FBQyxDQUFBO2dCQUUxSixJQUFJLENBQUMsU0FBUyxJQUFJLENBQUMsSUFBSSxDQUFDLDBCQUEwQixDQUFDLElBQUksRUFBRSxTQUFTLENBQUM7b0JBQUUsTUFBSztnQkFDMUUsS0FBSyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQTtnQkFDckIsSUFBSSxHQUFHLFNBQVMsQ0FBQTtZQUNsQixDQUFDO1lBRUQsTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQTtZQUNsQixrQkFBa0IsQ0FBQyxHQUFHLENBQUMsUUFBUSxDQUFDLENBQUE7UUFDbEMsQ0FBQztRQUVELE9BQU8sTUFBTSxDQUFBO0lBQ2YsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsTUFBTSxDQUFDLDBCQUEwQixDQUFDLElBQUksRUFBRSxLQUFLO1FBQzNDLElBQUksSUFBSSxDQUFDLFFBQVEsQ0FBQyxTQUFTLEtBQUssUUFBUSxJQUFJLEtBQUssQ0FBQyxRQUFRLENBQUMsU0FBUyxLQUFLLFFBQVE7WUFBRSxPQUFPLEtBQUssQ0FBQTtRQUMvRixJQUFJLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxJQUFJLENBQUMsS0FBSyxJQUFJLENBQUMsc0JBQXNCLENBQUMsS0FBSyxDQUFDO1lBQUUsT0FBTyxLQUFLLENBQUE7UUFDMUYsSUFBSSxJQUFJLENBQUMsUUFBUSxDQUFDLFdBQVcsS0FBSyxLQUFLLENBQUMsUUFBUSxDQUFDLFdBQVc7WUFBRSxPQUFPLEtBQUssQ0FBQTtRQUMxRSxJQUFJLENBQUMsSUFBSSxDQUFDLG9CQUFvQixDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsVUFBVSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsb0JBQW9CLENBQUMsS0FBSyxDQUFDLFFBQVEsQ0FBQyxVQUFVLENBQUM7WUFBRSxPQUFPLEtBQUssQ0FBQTtRQUUvSCxPQUFPLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLFVBQVUsSUFBSSxFQUFFLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxHQUFHLEVBQUUsRUFBRSxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLFFBQVEsQ0FBQyxVQUFVLElBQUksRUFBRSxFQUFFLEdBQUcsQ0FBQyxDQUFDLENBQUE7SUFDeEgsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxNQUFNLENBQUMsb0JBQW9CLENBQUMsVUFBVTtRQUNwQyxPQUFPLE9BQU8sQ0FBQyxVQUFVLENBQUMsSUFBSSxNQUFNLENBQUMsTUFBTSxDQUFDLFVBQVUsSUFBSSxFQUFFLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLEtBQUssS0FBSyxJQUFJLElBQUksQ0FBQyxRQUFRLEVBQUUsUUFBUSxFQUFFLFNBQVMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxPQUFPLEtBQUssQ0FBQyxDQUFDLENBQUE7SUFDMUosQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxNQUFNLENBQUMscUJBQXFCLENBQUMsS0FBSztRQUNoQyxNQUFNLEtBQUssR0FBRyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUE7UUFDdEIsTUFBTSxPQUFPLEdBQUcsNERBQTRELENBQUMsQ0FBQztZQUM1RSxXQUFXLEVBQUUsS0FBSyxDQUFDLFFBQVEsQ0FBQyxXQUFXO1lBQ3ZDLGVBQWUsRUFBRSxLQUFLLENBQUMsUUFBUSxDQUFDLFVBQVU7WUFDMUMsSUFBSSxFQUFFLE1BQU0sQ0FBQyxNQUFNLENBQUMsRUFBRSxFQUFFLEdBQUcsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLE1BQU0sRUFBRSxFQUFFLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxVQUFVLElBQUksRUFBRSxDQUFDLENBQUM7WUFDbkYsRUFBRSxFQUFFLEtBQUssQ0FBQyxRQUFRLENBQUMsZ0JBQWdCO1lBQ25DLFVBQVUsRUFBRSxLQUFLLENBQUMsUUFBUSxDQUFDLE9BQU8sRUFBRSxVQUFVO1lBQzlDLFlBQVksRUFBRSxLQUFLLENBQUMsUUFBUSxDQUFDLEtBQUs7WUFDbEMsUUFBUSxFQUFFLEtBQUssQ0FBQyxRQUFRLENBQUMsT0FBTyxFQUFFLFFBQVE7U0FDM0MsQ0FBQyxDQUFBO1FBRUYsT0FBTyxPQUFPLENBQUE7SUFDaEIsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxNQUFNLENBQUMsc0JBQXNCLENBQUMsTUFBTTtRQUNsQyxPQUFPLEdBQUcsTUFBTSxDQUFDLFFBQVEsQ0FBQyxLQUFLLElBQUksTUFBTSxDQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUMsT0FBTyxFQUFFLFVBQVUsQ0FBQyxFQUFFLENBQUE7SUFDbEYsQ0FBQztJQUVEOzs7Ozs7O09BT0c7SUFDSCxNQUFNLENBQUMsS0FBSyxDQUFDLHVCQUF1QixDQUFDLEVBQUMsZ0JBQWdCLEVBQUUsV0FBVyxFQUFFLGFBQWEsRUFBQztRQUNqRixNQUFNLFNBQVMsR0FBRyxDQUFDLE1BQU0sZ0JBQWdCLENBQUMsV0FBVyxDQUFDLGNBQWMsRUFBRSxDQUFDO2FBQ3BFLElBQUksQ0FBQyxDQUFDLE1BQU0sRUFBRSxFQUFFLENBQUMsTUFBTSxDQUFDLFlBQVksQ0FBQyxJQUFJLENBQUMsQ0FBQyxVQUFVLEVBQUUsRUFBRSxDQUFDLFVBQVUsQ0FBQyxnQkFBZ0IsS0FBSyxXQUFXLENBQUMsUUFBUSxDQUFDLGdCQUFnQixDQUFDLENBQUMsQ0FBQTtRQUVwSSxJQUFJLENBQUMsU0FBUztZQUFFLE9BQU07UUFFdEIsTUFBTSxnQkFBZ0IsQ0FBQyxXQUFXLENBQUMsY0FBYyxDQUFDO1lBQ2hELEVBQUUsRUFBRSxTQUFTLENBQUMsRUFBRTtZQUNoQixRQUFRLEVBQUUsRUFBQyxHQUFHLFNBQVMsQ0FBQyxRQUFRLEVBQUUsV0FBVyxFQUFFLGFBQWEsRUFBQztTQUM5RCxDQUFDLENBQUE7SUFDSixDQUFDO0lBQ0Q7Ozs7O09BS0c7SUFDSCxNQUFNLENBQUMsS0FBSyxDQUFDLFlBQVksQ0FBQyxHQUFHLEVBQUUsUUFBUTtRQUNyQyxPQUFPLGdCQUFnQixDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQ2pDLElBQUksQ0FBQztnQkFDSCxNQUFNLGdCQUFnQixDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQTtZQUNqQyxDQUFDO1lBQUMsT0FBTyxNQUFNLEVBQUUsQ0FBQztnQkFDaEIseUVBQXlFO2dCQUN6RSxrRkFBa0Y7WUFDcEYsQ0FBQztRQUNILENBQUM7UUFFRCxNQUFNLE9BQU8sR0FBRyxRQUFRLEVBQUUsQ0FBQTtRQUMxQixnQkFBZ0IsQ0FBQyxHQUFHLENBQUMsR0FBRyxFQUFFLE9BQU8sQ0FBQyxDQUFBO1FBRWxDLElBQUksQ0FBQztZQUNILE1BQU0sT0FBTyxDQUFBO1FBQ2YsQ0FBQztnQkFBUyxDQUFDO1lBQ1QsSUFBSSxnQkFBZ0IsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLEtBQUssT0FBTztnQkFBRSxnQkFBZ0IsQ0FBQyxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUE7UUFDekUsQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7Ozs7Ozs7O09BWUc7SUFDSCxNQUFNLENBQUMsS0FBSyxDQUFDLHFCQUFxQixDQUFDLElBQUk7UUFDckMsT0FBTyxNQUFNLElBQUksQ0FBQyxXQUFXLENBQUM7WUFDNUIsbUJBQW1CLEVBQUUsSUFBSSxDQUFDLG1CQUFtQjtZQUM3QyxTQUFTLEVBQUUsSUFBSSxDQUFDLFNBQVM7WUFDekIsVUFBVSxFQUFFLEtBQUssSUFBSSxFQUFFLENBQUMsTUFBTSxJQUFJLENBQUMsY0FBYyxDQUFDLEVBQUMsU0FBUyxFQUFFLElBQUksQ0FBQyxTQUFTLEVBQUUsV0FBVyxFQUFFLElBQUksQ0FBQyxXQUFXLEVBQUMsQ0FBQztZQUM3RyxVQUFVLEVBQUUsS0FBSyxFQUFFLE1BQU0sRUFBRSxFQUFFLENBQUMsTUFBTSxJQUFJLENBQUMsY0FBYyxDQUFDLEVBQUMsTUFBTSxFQUFFLFNBQVMsRUFBRSxJQUFJLENBQUMsU0FBUyxFQUFFLFdBQVcsRUFBRSxJQUFJLENBQUMsV0FBVyxFQUFDLENBQUM7WUFDM0gsV0FBVyxFQUFFLElBQUksQ0FBQyxXQUFXO1lBQzdCLFNBQVMsRUFBRSxJQUFJLENBQUMsZUFBZSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUM7WUFDL0MsVUFBVSxFQUFFLElBQUksQ0FBQyxVQUFVO1lBQzNCLE1BQU0sRUFBRSxJQUFJLENBQUMsTUFBTTtTQUNwQixDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILE1BQU0sQ0FBQyxLQUFLLENBQUMsY0FBYyxDQUFDLEVBQUMsU0FBUyxFQUFFLFdBQVcsRUFBQztRQUNsRCxNQUFNLE1BQU0sR0FBRyxNQUFNLFdBQVcsQ0FBQyxNQUFNLENBQUMsRUFBQyxHQUFHLEVBQUUsU0FBUyxFQUFDLENBQUMsQ0FBQTtRQUV6RCxPQUFPLE1BQU0sQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLEtBQUssRUFBRSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUE7SUFDdkMsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxNQUFNLENBQUMsS0FBSyxDQUFDLGNBQWMsQ0FBQyxFQUFDLE1BQU0sRUFBRSxTQUFTLEVBQUUsV0FBVyxFQUFDO1FBQzFELElBQUksQ0FBQyxNQUFNO1lBQUUsT0FBTTtRQUVuQixNQUFNLE1BQU0sR0FBRyxNQUFNLFdBQVcsQ0FBQyxrQkFBa0IsQ0FBQyxFQUFDLEdBQUcsRUFBRSxTQUFTLEVBQUMsQ0FBQyxDQUFBO1FBRXJFLE1BQU0sQ0FBQyxNQUFNLENBQUMsRUFBQyxLQUFLLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxNQUFNLENBQUMsRUFBQyxDQUFDLENBQUE7UUFDOUMsSUFBSSxNQUFNLENBQUMsU0FBUyxFQUFFO1lBQUUsTUFBTSxNQUFNLENBQUMsSUFBSSxFQUFFLENBQUE7SUFDN0MsQ0FBQztJQUVEOzs7Ozs7Ozs7Ozs7OztPQWNHO0lBQ0gsTUFBTSxDQUFDLEtBQUssQ0FBQyxXQUFXLENBQUMsSUFBSTtRQUMzQixrQkFBa0IsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUE7UUFDL0IsSUFBSSxXQUFXLEdBQUcsSUFBSSxDQUFDLHFCQUFxQixDQUFDLE1BQU0sSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUE7UUFDckUsSUFBSSxVQUFVLEdBQUcsSUFBSSxDQUFBO1FBQ3JCLElBQUksS0FBSyxHQUFHLENBQUMsQ0FBQTtRQUNiLElBQUksV0FBVyxHQUFHLENBQUMsQ0FBQTtRQUNuQixJQUFJLEtBQUssR0FBRyxDQUFDLENBQUE7UUFDYixJQUFJLE9BQU8sR0FBRyxLQUFLLENBQUE7UUFDbkIsTUFBTSxjQUFjLEdBQUcscUNBQXFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQTtRQUNqRSxNQUFNLGVBQWUsR0FBRyxzQ0FBc0MsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFBO1FBQ25FLE1BQU0sU0FBUyxHQUFHLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUE7UUFFMUQsT0FBTyxJQUFJLEVBQUUsQ0FBQztZQUNaLGtCQUFrQixDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQTtZQUMvQixNQUFNLGVBQWUsR0FBRyxNQUFNLElBQUksQ0FBQyxXQUFXLENBQUMsRUFBQyxHQUFHLElBQUksRUFBRSxXQUFXLEVBQUUsU0FBUyxFQUFFLFVBQVUsRUFBQyxDQUFDLENBQUE7WUFDN0Ysa0JBQWtCLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFBO1lBQy9CLE1BQU0sS0FBSyxHQUFHLGVBQWUsQ0FBQyxLQUFLLENBQUE7WUFFbkMsSUFBSSxDQUFDLFVBQVU7Z0JBQUUsVUFBVSxHQUFHLGVBQWUsQ0FBQyxVQUFVLENBQUE7WUFFeEQsZ0ZBQWdGO1lBQ2hGLG1GQUFtRjtZQUNuRixtRkFBbUY7WUFDbkYsaUZBQWlGO1lBQ2pGLHlCQUF5QjtZQUN6QixJQUFJLGVBQWUsQ0FBQyxLQUFLLEtBQUssSUFBSTtnQkFBRSxLQUFLLEdBQUcsV0FBVyxHQUFHLGVBQWUsQ0FBQyxLQUFLLENBQUE7WUFFL0UsSUFBSSxLQUFLLENBQUMsTUFBTSxLQUFLLENBQUMsRUFBRSxDQUFDO2dCQUN2QixvRkFBb0Y7Z0JBQ3BGLHlGQUF5RjtnQkFDekYsa0JBQWtCLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFBO2dCQUMvQixJQUFJLEtBQUssS0FBSyxDQUFDLElBQUksSUFBSSxDQUFDLFVBQVU7b0JBQUUsSUFBSSxDQUFDLFVBQVUsQ0FBQyxFQUFDLEtBQUssRUFBRSxXQUFXLEVBQUUsS0FBSyxFQUFDLENBQUMsQ0FBQTtnQkFFaEYsTUFBSztZQUNQLENBQUM7WUFFRCxLQUFLLElBQUksQ0FBQyxDQUFBO1lBRVYseUZBQXlGO1lBQ3pGLDBGQUEwRjtZQUMxRiwyRkFBMkY7WUFDM0Ysb0NBQW9DO1lBQ3BDLE1BQU0sYUFBYSxDQUFDLEtBQUssQ0FBQyxLQUFLLElBQUksRUFBRTtnQkFDbkMsS0FBSyxNQUFNLElBQUksSUFBSSxLQUFLLEVBQUUsQ0FBQztvQkFDekIsa0JBQWtCLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFBO29CQUMvQixNQUFNLFdBQVcsR0FBRyxNQUFNLElBQUksQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLENBQUE7b0JBQzlDLGtCQUFrQixDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQTtvQkFDL0IsTUFBTSxZQUFZLEdBQUcsV0FBVyxDQUFDLFlBQVksSUFBSSxJQUFJLENBQUMsWUFBWSxFQUFFLENBQUE7b0JBRXBFLE9BQU8sS0FBSyxXQUFXLENBQUMsT0FBTyxLQUFLLElBQUksQ0FBQTtvQkFDeEMsV0FBVyxJQUFJLENBQUMsQ0FBQTtvQkFFaEIsSUFBSSxZQUFZLEVBQUUsQ0FBQzt3QkFDakIsY0FBYyxDQUFDLFlBQVksQ0FBQyxHQUFHLENBQUMsY0FBYyxDQUFDLFlBQVksQ0FBQyxJQUFJLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQTt3QkFDdEUsZUFBZSxDQUFDLFlBQVksQ0FBQyxLQUFLLFdBQVcsQ0FBQyxPQUFPLEtBQUssSUFBSSxDQUFBO29CQUNoRSxDQUFDO2dCQUNILENBQUM7WUFDSCxDQUFDLENBQUMsQ0FBQTtZQUVGLFdBQVcsR0FBRyxlQUFlLENBQUMsVUFBVSxDQUFBO1lBRXhDLGtCQUFrQixDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQTtZQUMvQixJQUFJLElBQUksQ0FBQyxVQUFVO2dCQUFFLElBQUksQ0FBQyxVQUFVLENBQUMsRUFBQyxLQUFLLEVBQUUsV0FBVyxFQUFFLEtBQUssRUFBQyxDQUFDLENBQUE7WUFDakUsSUFBSSxLQUFLLENBQUMsTUFBTSxHQUFHLFNBQVM7Z0JBQUUsTUFBSztRQUNyQyxDQUFDO1FBRUQsa0JBQWtCLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFBO1FBQy9CLElBQUksV0FBVztZQUFFLE1BQU0sSUFBSSxDQUFDLFVBQVUsQ0FBQyxXQUFXLENBQUMsQ0FBQTtRQUNuRCxrQkFBa0IsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUE7UUFFL0IsT0FBTyxFQUFDLE9BQU8sRUFBRSxLQUFLLEVBQUUsZUFBZSxFQUFFLGNBQWMsRUFBRSxXQUFXLEVBQUUsS0FBSyxFQUFDLENBQUE7SUFDOUUsQ0FBQztJQUVEOzs7Ozs7Ozs7O09BVUc7SUFDSCxNQUFNLENBQUMsS0FBSyxDQUFDLFdBQVcsQ0FBQyxFQUFDLFdBQVcsRUFBRSxtQkFBbUIsRUFBRSxTQUFTLEVBQUUsV0FBVyxFQUFFLE1BQU0sRUFBRSxVQUFVLEVBQUM7UUFDckcsa0JBQWtCLENBQUMsTUFBTSxDQUFDLENBQUE7UUFDMUIsTUFBTSxRQUFRLEdBQUcsTUFBTSxXQUFXLENBQUM7WUFDakMsbUJBQW1CO1lBQ25CLEtBQUssRUFBRSxTQUFTO1lBQ2hCLEdBQUcsSUFBSSxDQUFDLGFBQWEsQ0FBQyxPQUFPLEVBQUUsV0FBVyxDQUFDO1lBQzNDLEdBQUcsSUFBSSxDQUFDLGFBQWEsQ0FBQyxNQUFNLEVBQUUsVUFBVSxDQUFDO1NBQzFDLEVBQUUsRUFBQyxNQUFNLEVBQUMsQ0FBQyxDQUFBO1FBRVosa0JBQWtCLENBQUMsTUFBTSxDQUFDLENBQUE7UUFDMUIsSUFBSSxDQUFDLCtCQUErQixDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBRTlDLE1BQU0sS0FBSyxHQUFHLHdCQUF3QixDQUFDLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQyxDQUFBO1FBRXZELE9BQU87WUFDTCxVQUFVLEVBQUUsSUFBSSxDQUFDLHFCQUFxQixDQUFDLFFBQVEsQ0FBQyxVQUFVLElBQUksSUFBSSxDQUFDO1lBQ25FLEtBQUssRUFBRSxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsV0FBVyxFQUFFLEVBQUUsQ0FBQyxJQUFJLENBQUMsdUJBQXVCLENBQUMsV0FBVyxDQUFDLENBQUM7WUFDNUUsS0FBSyxFQUFFLGVBQWUsQ0FBQyxRQUFRLENBQUMsS0FBSyxDQUFDO1lBQ3RDLFVBQVUsRUFBRSxJQUFJLENBQUMscUJBQXFCLENBQUMsUUFBUSxDQUFDLFVBQVUsSUFBSSxJQUFJLENBQUM7U0FDcEUsQ0FBQTtJQUNILENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsTUFBTSxDQUFDLCtCQUErQixDQUFDLFFBQVE7UUFDN0MsSUFBSSxRQUFRLENBQUMsTUFBTSxLQUFLLE9BQU87WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLFFBQVEsQ0FBQyxZQUFZLElBQUkscUJBQXFCLENBQUMsQ0FBQTtRQUNoRyxJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxRQUFRLENBQUMsS0FBSyxDQUFDO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxxQ0FBcUMsQ0FBQyxDQUFBO0lBQzVGLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILE1BQU0sQ0FBQyxhQUFhLENBQUMsTUFBTSxFQUFFLE1BQU07UUFDakMsSUFBSSxDQUFDLE1BQU07WUFBRSxPQUFPLEVBQUUsQ0FBQTtRQUV0QixPQUFPO1lBQ0wsQ0FBQyxHQUFHLE1BQU0sSUFBSSxDQUFDLEVBQUUsTUFBTSxDQUFDLEVBQUU7WUFDMUIsR0FBRyxDQUFDLE1BQU0sQ0FBQyxjQUFjLENBQUMsQ0FBQyxDQUFDLEVBQUMsQ0FBQyxHQUFHLE1BQU0sZ0JBQWdCLENBQUMsRUFBRSxNQUFNLENBQUMsY0FBYyxFQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztZQUN0RixDQUFDLEdBQUcsTUFBTSxXQUFXLENBQUMsRUFBRSxNQUFNLENBQUMsU0FBUztTQUN6QyxDQUFBO0lBQ0gsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxNQUFNLENBQUMscUJBQXFCLENBQUMsT0FBTztRQUNsQyxJQUFJLENBQUMsT0FBTztZQUFFLE9BQU8sSUFBSSxDQUFBO1FBRXpCLElBQUksT0FBTyxPQUFPLEtBQUssUUFBUSxFQUFFLENBQUM7WUFDaEMsSUFBSSxDQUFDO2dCQUNILE9BQU8sSUFBSSxDQUFDLHFCQUFxQixDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQTtZQUN4RCxDQUFDO1lBQUMsT0FBTyxNQUFNLEVBQUUsQ0FBQztnQkFDaEIsT0FBTyxFQUFDLEVBQUUsRUFBRSxJQUFJLEVBQUUsY0FBYyxFQUFFLElBQUksRUFBRSxTQUFTLEVBQUUsT0FBTyxFQUFDLENBQUE7WUFDN0QsQ0FBQztRQUNILENBQUM7UUFFRCxJQUFJLE9BQU8sT0FBTyxLQUFLLFFBQVEsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQztZQUFFLE9BQU8sSUFBSSxDQUFBO1FBRXRFLE1BQU0sU0FBUyxHQUFHLE9BQU8sT0FBTyxDQUFDLFNBQVMsS0FBSyxRQUFRLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQTtRQUVsRixJQUFJLENBQUMsU0FBUztZQUFFLE9BQU8sSUFBSSxDQUFBO1FBRTNCLE9BQU87WUFDTCxFQUFFLEVBQUUsT0FBTyxDQUFDLEVBQUUsS0FBSyxJQUFJLElBQUksT0FBTyxDQUFDLEVBQUUsS0FBSyxTQUFTLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7WUFDL0UsY0FBYyxFQUFFLGVBQWUsQ0FBQyxPQUFPLENBQUMsY0FBYyxLQUFLLEVBQUUsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsY0FBYyxDQUFDO1lBQzlGLFNBQVM7U0FDVixDQUFBO0lBQ0gsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxNQUFNLENBQUMsdUJBQXVCLENBQUMsT0FBTztRQUNwQyxJQUFJLENBQUMsT0FBTyxJQUFJLE9BQU8sT0FBTyxLQUFLLFFBQVEsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQztZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsc0NBQXNDLENBQUMsQ0FBQTtRQUU5SCxNQUFNLFdBQVcsR0FBRyw0REFBNEQsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFBO1FBRTFGLE9BQU87WUFDTCxJQUFJLEVBQUUsR0FBRyxFQUFFLENBQUMsV0FBVyxDQUFDLElBQUk7WUFDNUIsRUFBRSxFQUFFLEdBQUcsRUFBRSxDQUFDLFdBQVcsQ0FBQyxFQUFFO1lBQ3hCLFVBQVUsRUFBRSxHQUFHLEVBQUUsQ0FBQyxXQUFXLENBQUMsVUFBVTtZQUN4QyxZQUFZLEVBQUUsR0FBRyxFQUFFLENBQUMsV0FBVyxDQUFDLFlBQVksS0FBSyxJQUFJLElBQUksV0FBVyxDQUFDLFlBQVksS0FBSyxTQUFTLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLFdBQVcsQ0FBQyxZQUFZLENBQUM7WUFDekksUUFBUSxFQUFFLEdBQUcsRUFBRSxDQUFDLFdBQVcsQ0FBQyxRQUFRLEtBQUssSUFBSSxJQUFJLFdBQVcsQ0FBQyxRQUFRLEtBQUssU0FBUyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxXQUFXLENBQUMsUUFBUSxDQUFDO1NBQ3hILENBQUE7SUFDSCxDQUFDO0lBRUQ7Ozs7Ozs7T0FPRztJQUNILE1BQU0sQ0FBQyxlQUFlLENBQUMsU0FBUyxFQUFFLFFBQVE7UUFDeEMsT0FBTyxLQUFLLEVBQUUsSUFBSSxFQUFFLEVBQUUsQ0FBQyxNQUFNLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxFQUFDLFFBQVEsRUFBRSxTQUFTLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQTtJQUNsRixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILE1BQU0sQ0FBQyxLQUFLLENBQUMsaUJBQWlCLENBQUMsRUFBQyxRQUFRLEVBQUUsU0FBUyxFQUFFLElBQUksRUFBQztRQUN4RCxNQUFNLFlBQVksR0FBRyxJQUFJLENBQUMsWUFBWSxFQUFFLENBQUE7UUFDeEMsTUFBTSxRQUFRLEdBQUcsWUFBWSxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQTtRQUVuRSxJQUFJLENBQUMsUUFBUSxJQUFJLENBQUMsUUFBUSxDQUFDLE9BQU87WUFBRSxPQUFPLEVBQUMsT0FBTyxFQUFFLEtBQUssRUFBRSxZQUFZLEVBQUMsQ0FBQTtRQUV6RSxJQUFJLElBQUksQ0FBQyxRQUFRLEVBQUUsS0FBSyxRQUFRLEVBQUUsQ0FBQztZQUNqQyxPQUFPLEVBQUMsT0FBTyxFQUFFLE1BQU0sSUFBSSxDQUFDLHFCQUFxQixDQUFDLEVBQUMsUUFBUSxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUMsQ0FBQyxFQUFFLFlBQVksRUFBQyxDQUFBO1FBQzlGLENBQUM7UUFFRCxNQUFNLElBQUksR0FBRyxJQUFJLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxDQUFBO1FBQ2hDLE1BQU0sTUFBTSxHQUFHLFFBQVEsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLE1BQU0sUUFBUSxDQUFDLFVBQVUsQ0FBQyxFQUFDLElBQUksRUFBRSxVQUFVLEVBQUUsSUFBSSxDQUFDLFVBQVUsRUFBRSxFQUFFLElBQUksRUFBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sUUFBUSxDQUFDLFVBQVUsQ0FBQyxrQkFBa0IsQ0FBQyxFQUFDLEVBQUUsRUFBRSxJQUFJLENBQUMsRUFBRSxJQUFJLElBQUksQ0FBQyxVQUFVLEVBQUUsRUFBQyxDQUFDLENBQUE7UUFDOUwsTUFBTSxVQUFVLEdBQUcsTUFBTSxRQUFRLENBQUMsVUFBVSxDQUFDLEVBQUMsSUFBSSxFQUFFLE1BQU0sRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO1FBQ2xFLE1BQU0sYUFBYSxHQUFHLFFBQVEsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUE7UUFDeEQsSUFBSSxPQUFPLEdBQUcsS0FBSyxDQUFBO1FBRW5CLElBQUksQ0FBQztZQUNILE1BQU0sQ0FBQyxNQUFNLENBQUMsVUFBVSxDQUFDLENBQUE7WUFFekIsSUFBSSxNQUFNLENBQUMsU0FBUyxFQUFFLEVBQUUsQ0FBQztnQkFDdkIsTUFBTSxNQUFNLENBQUMsSUFBSSxFQUFFLENBQUE7Z0JBQ25CLE9BQU8sR0FBRyxJQUFJLENBQUE7WUFDaEIsQ0FBQztZQUVELElBQUksUUFBUSxDQUFDLFVBQVUsRUFBRSxDQUFDO2dCQUN4QixNQUFNLFdBQVcsR0FBRyxNQUFNLFFBQVEsQ0FBQyxVQUFVLENBQUMsRUFBQyxVQUFVLEVBQUUsSUFBSSxFQUFFLE1BQU0sRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO2dCQUUvRSxPQUFPLEtBQUssV0FBVyxLQUFLLElBQUksQ0FBQTtZQUNsQyxDQUFDO1FBQ0gsQ0FBQztnQkFBUyxDQUFDO1lBQ1QsSUFBSSxhQUFhO2dCQUFFLGFBQWEsRUFBRSxDQUFBO1FBQ3BDLENBQUM7UUFFRCxPQUFPLEVBQUMsT0FBTyxFQUFFLFlBQVksRUFBQyxDQUFBO0lBQ2hDLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsTUFBTSxDQUFDLEtBQUssQ0FBQyxxQkFBcUIsQ0FBQyxFQUFDLFFBQVEsRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFDO1FBQzNELE1BQU0sRUFBRSxHQUFHLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQTtRQUM1QixNQUFNLE1BQU0sR0FBRyxRQUFRLENBQUMsbUJBQW1CLENBQUMsQ0FBQyxDQUFDLE1BQU0sUUFBUSxDQUFDLG1CQUFtQixDQUFDLEVBQUMsVUFBVSxFQUFFLEVBQUUsRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLFFBQVEsQ0FBQyxVQUFVLENBQUMsTUFBTSxDQUFDLEVBQUMsRUFBRSxFQUFDLENBQUMsQ0FBQTtRQUVqSixJQUFJLENBQUMsTUFBTTtZQUFFLE9BQU8sS0FBSyxDQUFBO1FBRXpCLE1BQU0sYUFBYSxHQUFHLFFBQVEsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUE7UUFFeEQsSUFBSSxDQUFDO1lBQ0gsTUFBTSxNQUFNLENBQUMsT0FBTyxFQUFFLENBQUE7UUFDeEIsQ0FBQztnQkFBUyxDQUFDO1lBQ1QsSUFBSSxhQUFhO2dCQUFFLGFBQWEsRUFBRSxDQUFBO1FBQ3BDLENBQUM7UUFFRCxPQUFPLElBQUksQ0FBQTtJQUNiLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsTUFBTSxDQUFDLFFBQVEsQ0FBQyxJQUFJO1FBQ2xCLE1BQU0sSUFBSSxHQUFHLElBQUksQ0FBQyxJQUFJLEVBQUUsQ0FBQTtRQUV4QixJQUFJLENBQUMsSUFBSTtZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsUUFBUSxJQUFJLENBQUMsRUFBRSxFQUFFLGtCQUFrQixDQUFDLENBQUE7UUFDL0QsSUFBSSxPQUFPLElBQUksS0FBSyxRQUFRO1lBQUUsT0FBTyxzQ0FBc0MsQ0FBQyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQTtRQUM5RixJQUFJLE9BQU8sSUFBSSxLQUFLLFFBQVEsSUFBSSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDO1lBQUUsT0FBTyxzQ0FBc0MsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFBO1FBRTFHLE1BQU0sSUFBSSxLQUFLLENBQUMsUUFBUSxJQUFJLENBQUMsRUFBRSxFQUFFLG1CQUFtQixDQUFDLENBQUE7SUFDdkQsQ0FBQztJQUVEOzs7Ozs7Ozs7T0FTRztJQUNILE1BQU0sQ0FBQyxLQUFLLENBQUMsZ0JBQWdCLENBQUMsSUFBSTtRQUNoQyxNQUFNLHVCQUF1QixHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7UUFFekMsTUFBTSxJQUFJLENBQUMsYUFBYSxDQUFDO1lBQ3ZCLG1CQUFtQixFQUFFLElBQUksQ0FBQyxtQkFBbUI7WUFDN0MsU0FBUyxFQUFFLElBQUksQ0FBQyxTQUFTO1lBQ3pCLGNBQWMsRUFBRSxLQUFLLEVBQUUsSUFBSSxFQUFFLEVBQUU7Z0JBQzdCLE1BQU0sTUFBTSxHQUFJLDZEQUE2RCxDQUFDLENBQUMsSUFBSSxDQUFFLENBQUMsRUFBRSxFQUFFLENBQUE7Z0JBQzFGLGdGQUFnRjtnQkFDaEYsMkVBQTJFO2dCQUMzRSxNQUFNLFdBQVcsR0FBRyxNQUFNLElBQUksQ0FBQyxTQUFTLENBQUMsT0FBTyxDQUFDLEVBQUMsUUFBUSxFQUFFLElBQUksRUFBQyxDQUFDLENBQUMsS0FBSyxDQUFDLEVBQUMsRUFBRSxFQUFFLE1BQU0sRUFBQyxDQUFDLENBQUMsS0FBSyxFQUFFLENBQUE7Z0JBRTlGLElBQUksQ0FBQyxXQUFXO29CQUFFLE9BQU07Z0JBQ3hCLHlFQUF5RTtnQkFDekUsc0VBQXNFO2dCQUN0RSxJQUFJLElBQUksQ0FBQyx1QkFBdUIsQ0FBQyxXQUFXLENBQUMsS0FBSyx1QkFBdUIsQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDO29CQUFFLE9BQU07Z0JBRXJHLE1BQU0sV0FBVyxDQUFDLE1BQU0sQ0FBQyxFQUFDLEtBQUssRUFBRSxTQUFTLEVBQUMsQ0FBQyxDQUFBO1lBQzlDLENBQUM7WUFDRCxZQUFZLEVBQUUsS0FBSyxJQUFJLEVBQUUsQ0FBQyxNQUFNLElBQUksQ0FBQyxTQUFTLENBQUMsT0FBTyxDQUFDLEVBQUMsUUFBUSxFQUFFLElBQUksRUFBQyxDQUFDLENBQUMsS0FBSyxDQUFDLEVBQUMsS0FBSyxFQUFFLFNBQVMsRUFBQyxDQUFDLENBQUMsS0FBSyxDQUFDLFlBQVksQ0FBQyxDQUFDLE9BQU8sRUFBRTtZQUNoSSxVQUFVLEVBQUUsSUFBSSxDQUFDLFVBQVU7WUFDM0IsTUFBTSxFQUFFLElBQUksQ0FBQyxNQUFNO1lBQ25CLE1BQU0sRUFBRSxDQUFDLElBQUksRUFBRSxFQUFFLENBQUUsNkRBQTZELENBQUMsQ0FBQyxJQUFJLENBQUUsQ0FBQyxFQUFFLEVBQUU7WUFDN0YsV0FBVyxFQUFFLENBQUMsSUFBSSxFQUFFLEVBQUU7Z0JBQ3BCLHVCQUF1QixDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUUsNkRBQTZELENBQUMsQ0FBQyxJQUFJLENBQUUsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxFQUFFLElBQUksQ0FBQyx1QkFBdUIsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFBO2dCQUVwSixPQUFPLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxJQUFJLENBQUMsQ0FBQTtZQUNwQyxDQUFDO1NBQ0YsQ0FBQyxDQUFBO0lBQ0osQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxNQUFNLENBQUMsdUJBQXVCLENBQUMsSUFBSTtRQUNqQyxPQUFPLElBQUksQ0FBQyxTQUFTLENBQUMsRUFBQyxJQUFJLEVBQUUsSUFBSSxDQUFDLGFBQWEsQ0FBQyxJQUFJLENBQUMsRUFBRSxRQUFRLEVBQUUsSUFBSSxDQUFDLFFBQVEsRUFBRSxFQUFDLENBQUMsQ0FBQTtJQUNwRixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILE1BQU0sQ0FBQyxnQkFBZ0IsQ0FBQyxJQUFJO1FBQzFCLE1BQU0sZUFBZSxHQUFHLElBQUksQ0FBQyxTQUFTLEVBQUUsSUFBSSxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUE7UUFFNUQsT0FBTztZQUNMLGVBQWUsRUFBRSxlQUFlLENBQUMsQ0FBQyxDQUFDLGVBQWUsQ0FBQyxXQUFXLEVBQUUsQ0FBQyxDQUFDLENBQUMsU0FBUztZQUM1RSxJQUFJLEVBQUUsSUFBSSxDQUFDLGFBQWEsQ0FBQyxJQUFJLENBQUM7WUFDOUIsRUFBRSxFQUFFLHFCQUFxQixDQUFDLEVBQUMsc0JBQXVCLENBQUMsSUFBSSxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUM7WUFDOUQsVUFBVSxFQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUM7WUFDckMsWUFBWSxFQUFFLElBQUksQ0FBQyxZQUFZLEVBQUUsSUFBSSxFQUFFO1lBQ3ZDLFFBQVEsRUFBRSxJQUFJLENBQUMsUUFBUSxFQUFFO1NBQzFCLENBQUE7SUFDSCxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILE1BQU0sQ0FBQyxhQUFhLENBQUMsSUFBSTtRQUN2QixJQUFJLFFBQVEsR0FBRywrQ0FBK0MsQ0FBQyxDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQTtRQUVsRixJQUFJLE9BQU8sUUFBUSxLQUFLLFFBQVEsRUFBRSxDQUFDO1lBQ2pDLElBQUksQ0FBQztnQkFDSCxRQUFRLEdBQUcsc0NBQXNDLENBQUMsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUE7WUFDMUUsQ0FBQztZQUFDLE9BQU8sTUFBTSxFQUFFLENBQUM7Z0JBQ2hCLFFBQVEsR0FBRyxFQUFFLENBQUE7WUFDZixDQUFDO1FBQ0gsQ0FBQztRQUVELElBQUksTUFBTSxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQyxNQUFNLEdBQUcsQ0FBQztZQUFFLE9BQU8sUUFBUSxDQUFBO1FBRXJELElBQUksQ0FBQztZQUNILE9BQU8sc0NBQXNDLENBQUMsQ0FBQyxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUMsVUFBVSxFQUFFLENBQUMsQ0FBQTtRQUM5RSxDQUFDO1FBQUMsT0FBTyxNQUFNLEVBQUUsQ0FBQztZQUNoQixPQUFPLEVBQUUsQ0FBQTtRQUNYLENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7Ozs7Ozs7O09BV0c7SUFDSCxNQUFNLENBQUMsS0FBSyxDQUFDLGNBQWMsQ0FBQyxJQUFJO1FBQzlCLE1BQU0sZ0JBQWdCLEdBQUcsMEJBQTBCLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxFQUFFLEVBQUUsRUFBRSxxQkFBcUIsQ0FBQyxDQUFBO1FBQzlGLE1BQU0sVUFBVSxHQUFHLElBQUksQ0FBQyxRQUFRLENBQUMsV0FBVyxDQUFBO1FBRTVDLElBQUksT0FBTyxVQUFVLENBQUMsWUFBWSxLQUFLLFVBQVUsRUFBRSxDQUFDO1lBQ2xELE1BQU0sSUFBSSxLQUFLLENBQUMsZ0tBQWdLLENBQUMsQ0FBQTtRQUNuTCxDQUFDO1FBRUQsTUFBTSxZQUFZLEdBQUcsVUFBVSxDQUFDLFlBQVksRUFBRSxDQUFBO1FBQzlDLE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxjQUFjLENBQUMsSUFBSSxDQUFDLENBQUE7UUFDMUMsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLFFBQVEsSUFBSSxRQUFRLENBQUE7UUFFMUMsSUFBSSxDQUFDLGdCQUFnQjtZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsOENBQThDLENBQUMsQ0FBQTtRQUV0RixNQUFNLFVBQVUsR0FBRyxNQUFNLENBQUMsZ0JBQWdCLENBQUMsQ0FBQTtRQUMzQyxNQUFNLFlBQVksR0FBRyxNQUFNLElBQUksQ0FBQyxTQUFTLENBQUMsTUFBTSxDQUFDLEVBQUMsVUFBVSxFQUFFLFlBQVksRUFBQyxDQUFDLENBQUE7UUFFNUUsSUFBSSxZQUFZLEVBQUUsQ0FBQztZQUNqQixNQUFNLFlBQVksQ0FBQyxNQUFNLENBQUM7Z0JBQ3hCLElBQUksRUFBRSxRQUFRO2dCQUNkLEtBQUssRUFBRSxTQUFTO2dCQUNoQixRQUFRO2FBQ1QsQ0FBQyxDQUFBO1lBRUYsT0FBTyxZQUFZLENBQUE7UUFDckIsQ0FBQztRQUVELE9BQU8sTUFBTSxJQUFJLENBQUMsU0FBUyxDQUFDLE1BQU0sQ0FBQztZQUNqQyxJQUFJLEVBQUUsUUFBUTtZQUNkLFVBQVU7WUFDVixZQUFZO1lBQ1osS0FBSyxFQUFFLFNBQVM7WUFDaEIsUUFBUTtTQUNULENBQUMsQ0FBQTtJQUNKLENBQUM7SUFFRDs7Ozs7OztPQU9HO0lBQ0gsTUFBTSxDQUFDLGNBQWMsQ0FBQyxJQUFJO1FBQ3hCLE1BQU0sU0FBUyxHQUFHLElBQUksQ0FBQyxJQUFJLElBQUksc0NBQXNDLENBQUMsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUE7UUFDbEcsTUFBTSxjQUFjLEdBQUcsSUFBSSxDQUFDLGFBQWEsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFBO1FBQ3JGLE1BQU0sUUFBUSxHQUFHLEVBQUMsR0FBRyxjQUFjLEVBQUMsQ0FBQTtRQUVwQyxLQUFLLE1BQU0sYUFBYSxJQUFJLElBQUksQ0FBQyxtQkFBbUIsSUFBSSxFQUFFO1lBQUUsT0FBTyxRQUFRLENBQUMsYUFBYSxDQUFDLENBQUE7UUFDMUYsS0FBSyxNQUFNLGFBQWEsSUFBSSxJQUFJLENBQUMsaUJBQWlCLElBQUksRUFBRSxFQUFFLENBQUM7WUFDekQsSUFBSSxNQUFNLENBQUMsTUFBTSxDQUFDLFFBQVEsRUFBRSxhQUFhLENBQUM7Z0JBQUUsUUFBUSxDQUFDLGFBQWEsQ0FBQyxHQUFHLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxRQUFRLENBQUMsYUFBYSxDQUFDLEVBQUUsYUFBYSxDQUFDLENBQUE7UUFDN0ksQ0FBQztRQUNELEtBQUssTUFBTSxDQUFDLGFBQWEsRUFBRSxLQUFLLENBQUMsSUFBSSxNQUFNLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUM7WUFDOUQsSUFBSSxLQUFLLFlBQVksSUFBSTtnQkFBRSxRQUFRLENBQUMsYUFBYSxDQUFDLEdBQUcsS0FBSyxDQUFDLFdBQVcsRUFBRSxDQUFBO1FBQzFFLENBQUM7UUFFRCxPQUFPLFFBQVEsQ0FBQTtJQUNqQixDQUFDO0lBRUQ7Ozs7Ozs7OztPQVNHO0lBQ0gsTUFBTSxDQUFDLGNBQWMsQ0FBQyxJQUFJO1FBQ3hCLE9BQU87WUFDTCxLQUFLLEVBQUUsS0FBSyxFQUFFLFNBQVMsRUFBRSxFQUFFLENBQUMsTUFBTSxJQUFJLENBQUMsY0FBYyxDQUFDO2dCQUNwRCxHQUFHLFNBQVM7Z0JBQ1osaUJBQWlCLEVBQUUsSUFBSSxDQUFDLGlCQUFpQixDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsaUJBQWlCLENBQUMsU0FBUyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFO2dCQUMzRixtQkFBbUIsRUFBRSxJQUFJLENBQUMsbUJBQW1CLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxTQUFTLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUU7Z0JBQ2pHLFNBQVMsRUFBRSxJQUFJLENBQUMsU0FBUzthQUMxQixDQUFDO1lBQ0YsV0FBVyxFQUFFLEtBQUssSUFBSSxFQUFFLENBQUMsTUFBTSxJQUFJLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxlQUFlLEVBQUUsSUFBSSxDQUFDLFdBQVcsQ0FBQztTQUN6RixDQUFBO0lBQ0gsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0gsTUFBTSxDQUFDLHdCQUF3QixDQUFDLEtBQUssRUFBRSxXQUFXLEdBQUcsY0FBYztRQUNqRSxJQUFJLEtBQUssSUFBSSxJQUFJO1lBQUUsT0FBTyxJQUFJLENBQUE7UUFDOUIsSUFBSSxLQUFLLEtBQUssQ0FBQztZQUFFLE9BQU8sSUFBSSxDQUFBO1FBQzVCLElBQUksS0FBSyxLQUFLLENBQUM7WUFBRSxPQUFPLEtBQUssQ0FBQTtRQUU3QixPQUFPLGVBQWUsQ0FBQyxLQUFLLEVBQUUsV0FBVyxDQUFDLENBQUE7SUFDNUMsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxNQUFNLENBQUMsc0JBQXNCLENBQUMsS0FBSztRQUNqQyxPQUFPLEtBQUssS0FBSyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFBO0lBQy9CLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxNQUFNLENBQUMsc0JBQXNCLENBQUMsRUFBQyxNQUFNLEVBQUUsU0FBUyxFQUFDO1FBQy9DLE1BQU0sVUFBVSxHQUFHLHNDQUFzQyxDQUFDLENBQUM7WUFDekQsT0FBTyxFQUFFLE1BQU0sQ0FBQyxPQUFPO1lBQ3ZCLEtBQUssRUFBRSxNQUFNLENBQUMsS0FBSztZQUNuQixXQUFXLEVBQUUsTUFBTSxDQUFDLFdBQVc7U0FDaEMsQ0FBQyxDQUFBO1FBRUYsS0FBSyxNQUFNLENBQUMsWUFBWSxFQUFFLElBQUksQ0FBQyxJQUFJLE1BQU0sQ0FBQyxPQUFPLENBQUMsU0FBUyxDQUFDLEVBQUUsQ0FBQztZQUM3RCxVQUFVLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxHQUFHLE1BQU0sQ0FBQyxjQUFjLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxDQUFBO1lBQ3BFLFVBQVUsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLEdBQUcsTUFBTSxDQUFDLGVBQWUsQ0FBQyxZQUFZLENBQUMsSUFBSSxLQUFLLENBQUE7UUFDN0UsQ0FBQztRQUVELE9BQU8sVUFBVSxDQUFBO0lBQ25CLENBQUM7SUFFRDs7Ozs7Ozs7Ozs7O09BWUc7SUFDSCxNQUFNLENBQUMsS0FBSyxDQUFDLGFBQWEsQ0FBQyxJQUFJO1FBQzdCLGtCQUFrQixDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQTtRQUMvQixNQUFNLFlBQVksR0FBRyxNQUFNLElBQUksQ0FBQyxZQUFZLEVBQUUsQ0FBQTtRQUM5QyxrQkFBa0IsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUE7UUFDL0IsTUFBTSxTQUFTLEdBQUcsSUFBSSxDQUFDLG1CQUFtQixDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQTtRQUUxRCxLQUFLLElBQUksTUFBTSxHQUFHLENBQUMsRUFBRSxNQUFNLEdBQUcsWUFBWSxDQUFDLE1BQU0sRUFBRSxNQUFNLElBQUksU0FBUyxFQUFFLENBQUM7WUFDdkUsa0JBQWtCLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFBO1lBQy9CLE1BQU0sSUFBSSxDQUFDLFdBQVcsQ0FBQyxFQUFDLEdBQUcsSUFBSSxFQUFFLFlBQVksRUFBRSxZQUFZLENBQUMsS0FBSyxDQUFDLE1BQU0sRUFBRSxNQUFNLEdBQUcsU0FBUyxDQUFDLEVBQUMsQ0FBQyxDQUFBO1FBQ2pHLENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7Ozs7Ozs7O09BV0c7SUFDSCxNQUFNLENBQUMsS0FBSyxDQUFDLFdBQVcsQ0FBQyxJQUFJO1FBQzNCLE1BQU0sRUFBQyxtQkFBbUIsRUFBRSxjQUFjLEVBQUUsWUFBWSxFQUFFLFVBQVUsRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLFdBQVcsRUFBQyxHQUFHLElBQUksQ0FBQTtRQUV6RyxJQUFJLFlBQVksQ0FBQyxNQUFNLEtBQUssQ0FBQztZQUFFLE9BQU07UUFDckMsa0JBQWtCLENBQUMsTUFBTSxDQUFDLENBQUE7UUFFMUIsTUFBTSxTQUFTLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQTtRQUUzQixLQUFLLE1BQU0sSUFBSSxJQUFJLFlBQVksRUFBRSxDQUFDO1lBQ2hDLE1BQU0sRUFBRSxHQUFHLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQTtZQUV2QixJQUFJLEVBQUUsS0FBSyxTQUFTLElBQUksRUFBRSxLQUFLLElBQUk7Z0JBQUUsU0FBUyxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDLEVBQUUsSUFBSSxDQUFDLENBQUE7UUFDdEUsQ0FBQztRQUVELE1BQU0sUUFBUSxHQUFHLE1BQU0sVUFBVSxDQUFDO1lBQ2hDLG1CQUFtQjtZQUNuQixLQUFLLEVBQUUsWUFBWSxDQUFDLEdBQUcsQ0FBQyxDQUFDLElBQUksRUFBRSxFQUFFLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQyxDQUFDO1NBQ3JELEVBQUUsRUFBQyxNQUFNLEVBQUMsQ0FBQyxDQUFBO1FBRVosa0JBQWtCLENBQUMsTUFBTSxDQUFDLENBQUE7UUFDMUIsSUFBSSxDQUFDLHdCQUF3QixDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBRXZDLEtBQUssTUFBTSxZQUFZLElBQUksUUFBUSxDQUFDLEtBQUssSUFBSSxFQUFFLEVBQUUsQ0FBQztZQUNoRCxrQkFBa0IsQ0FBQyxNQUFNLENBQUMsQ0FBQTtZQUMxQixNQUFNLElBQUksR0FBRyxTQUFTLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxZQUFZLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQTtZQUVuRCxJQUFJLENBQUMsSUFBSTtnQkFBRSxTQUFRO1lBQ25CLElBQUksWUFBWSxDQUFDLFNBQVMsS0FBSyxZQUFZLEVBQUUsQ0FBQztnQkFDNUMsTUFBTSxJQUFJLEtBQUssQ0FBQyx3Q0FBd0MsTUFBTSxDQUFDLFlBQVksQ0FBQyxFQUFFLENBQUMsS0FBSyxNQUFNLENBQUMsWUFBWSxDQUFDLFNBQVMsQ0FBQyxFQUFFLENBQUMsQ0FBQTtZQUN2SCxDQUFDO1lBRUQsTUFBTSxjQUFjLENBQUMsSUFBSSxFQUFFLFlBQVksQ0FBQyxDQUFBO1lBQ3hDLGtCQUFrQixDQUFDLE1BQU0sQ0FBQyxDQUFBO1FBQzVCLENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILE1BQU0sQ0FBQyx3QkFBd0IsQ0FBQyxRQUFRO1FBQ3RDLElBQUksUUFBUSxDQUFDLE1BQU0sS0FBSyxPQUFPO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxRQUFRLENBQUMsWUFBWSxJQUFJLGFBQWEsQ0FBQyxDQUFBO1FBQ3hGLElBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyxLQUFLLENBQUM7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLDZCQUE2QixDQUFDLENBQUE7SUFDcEYsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxNQUFNLENBQUMsbUJBQW1CLENBQUMsU0FBUztRQUNsQyxJQUFJLE9BQU8sU0FBUyxLQUFLLFFBQVEsSUFBSSxDQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUMsU0FBUyxDQUFDLElBQUksU0FBUyxHQUFHLENBQUM7WUFBRSxPQUFPLEdBQUcsQ0FBQTtRQUU3RixPQUFPLElBQUksQ0FBQyxLQUFLLENBQUMsU0FBUyxDQUFDLENBQUE7SUFDOUIsQ0FBQztDQUNGO0FBRUQ7Ozs7O0dBS0c7QUFDSCxTQUFTLGtCQUFrQixDQUFDLE1BQU07SUFDaEMsSUFBSSxDQUFDLE1BQU0sRUFBRSxPQUFPO1FBQUUsT0FBTTtJQUU1QixNQUFNLE1BQU0sQ0FBQyxNQUFNLFlBQVksS0FBSyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxJQUFJLEtBQUssQ0FBQyx3QkFBd0IsQ0FBQyxDQUFBO0FBQzVGLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHtvcHRpb25hbEJvb2xlYW4sIG9wdGlvbmFsSW50ZWdlcn0gZnJvbSBcInR5cGFuaWNcIlxuXG5pbXBvcnQgcmVjb3JkQ2hhbmdlcyBmcm9tIFwiLi4vZGF0YWJhc2UvcmVjb3JkLWNoYW5nZXMuanNcIlxuaW1wb3J0IHtzY2FsYXJNb2RlbFByaW1hcnlLZXlWYWx1ZX0gZnJvbSBcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCJcbmltcG9ydCB7YXBwbHlTeW5jUmVwbGF5UmVzdWx0VG9Mb2NhbE11dGF0aW9uTG9nfSBmcm9tIFwiLi9jb25mbGljdC1zdHJhdGVneS5qc1wiXG5cbi8qKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi9zeW5jLWFwaS1jbGllbnQtdHlwZXMuanNcIikuU3luY0NoYW5nZUFwcGx5UmVzdWx0fSBTeW5jQ2hhbmdlQXBwbHlSZXN1bHQgKi9cbi8qKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi9zeW5jLWFwaS1jbGllbnQtdHlwZXMuanNcIikuU3luY0NoYW5nZUVudmVsb3BlfSBTeW5jQ2hhbmdlRW52ZWxvcGUgKi9cbi8qKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi9zeW5jLWFwaS1jbGllbnQtdHlwZXMuanNcIikuU3luY0NoYW5nZXNSZXF1ZXN0fSBTeW5jQ2hhbmdlc1JlcXVlc3QgKi9cbi8qKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi9zeW5jLWFwaS1jbGllbnQtdHlwZXMuanNcIikuU3luY0NoYW5nZXNSZXNwb25zZX0gU3luY0NoYW5nZXNSZXNwb25zZSAqL1xuLyoqIEB0eXBlZGVmIHtpbXBvcnQoXCIuL3N5bmMtYXBpLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2hhbmdlc1Jlc3VsdH0gU3luY0NoYW5nZXNSZXN1bHQgKi9cbi8qKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi9zeW5jLWFwaS1jbGllbnQtdHlwZXMuanNcIikuU3luY0N1cnNvcn0gU3luY0N1cnNvciAqL1xuLyoqIEB0eXBlZGVmIHtpbXBvcnQoXCIuL3N5bmMtYXBpLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jUmVwbGF5SXRlbX0gU3luY1JlcGxheUl0ZW0gKi9cbi8qKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi9zeW5jLWFwaS1jbGllbnQtdHlwZXMuanNcIikuU3luY1JlcGxheVJlc3BvbnNlfSBTeW5jUmVwbGF5UmVzcG9uc2UgKi9cbi8qKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi9zeW5jLWFwaS1jbGllbnQtdHlwZXMuanNcIikuU3luY1Jlc291cmNlQ29uZmlnfSBTeW5jUmVzb3VyY2VDb25maWcgKi9cbmNvbnN0IHN5bmNUYXNrUHJvbWlzZXMgPSBuZXcgTWFwKClcblxuLyoqXG4gKiBHZW5lcmljIGNsaWVudC1zaWRlIGhlbHBlciBmb3IgcmVwbGF5aW5nIHBlbmRpbmcgc3luYyBlbnZlbG9wZXMgdGhyb3VnaCB0aGVcbiAqIGZyYW1ld29yay1vd25lZCBgL3ZlbG9jaW91cy9zeW5jL3JlcGxheWAgZW5kcG9pbnQuIEFwcHMgcHJvdmlkZSBvbmx5IGxvY2FsXG4gKiBwZXJzaXN0ZW5jZS9hdXRoIGhvb2tzLlxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBTeW5jQXBpQ2xpZW50IHtcbiAgLyoqXG4gICAqIEFwcGVuZHMgb25lIGNvbmZsaWN0LXRyYWNrZWQgaW50ZW50IHRvIHRoZSBleGlzdGluZyBkdXJhYmxlIG11dGF0aW9uIGxvZy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBRdWV1ZSBhcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVtYmVyIHwgbnVsbH0gYXJncy5iYXNlVmVyc2lvbiAtIEF1dGhvcml0YXRpdmUgdmVyc2lvbiBvYnNlcnZlZCBiZWZvcmUgdGhlIGxvY2FsIG11dGF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU3luY0NsaWVudENvbmZsaWN0VHJhY2tpbmdDb25maWd9IGFyZ3MuY29uZmxpY3RUcmFja2luZyAtIER1cmFibGUgdHJhY2tpbmcgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn0gYXJncy5kYXRhIC0gQmFja2VuZC1zYWZlIG11dGF0aW9uIGF0dHJpYnV0ZXMuXG4gICAqIEBwYXJhbSB7XCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIn0gYXJncy5vcGVyYXRpb24gLSBMb2NhbCBvcGVyYXRpb24uXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MucmVzb3VyY2UgLSBMb2NhbCByZXNvdXJjZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucmVzb3VyY2VUeXBlIC0gUmVzb3VyY2UgdHlwZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc3luY1R5cGUgLSBXaXJlIG9wZXJhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi9sb2NhbC1tdXRhdGlvbi1sb2cuanNcIikuTG9jYWxNdXRhdGlvbkxvZ1JlY29yZD59IEFwcGVuZGVkIGludGVudC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBxdWV1ZUNvbmZsaWN0VHJhY2tlZFN5bmMoe2Jhc2VWZXJzaW9uLCBjb25mbGljdFRyYWNraW5nLCBkYXRhLCBvcGVyYXRpb24sIHJlc291cmNlLCByZXNvdXJjZVR5cGUsIHN5bmNUeXBlfSkge1xuICAgIGNvbnN0IHJlc291cmNlSWQgPSBTdHJpbmcoc2NhbGFyTW9kZWxQcmltYXJ5S2V5VmFsdWUocmVzb3VyY2UuaWQoKSwgYENvbmZsaWN0LXRyYWNrZWQgc3luYyBmb3IgJHtyZXNvdXJjZVR5cGV9YCkpXG4gICAgY29uc3QgcmVjb3JkcyA9IGF3YWl0IGNvbmZsaWN0VHJhY2tpbmcubXV0YXRpb25Mb2cucmVjb3JkcygpXG4gICAgY29uc3QgcHJlZGVjZXNzb3IgPSByZWNvcmRzXG4gICAgICAuZmlsdGVyKChyZWNvcmQpID0+IHJlY29yZC5tdXRhdGlvbi5tb2RlbCA9PT0gcmVzb3VyY2VUeXBlICYmIHJlY29yZC5tdXRhdGlvbi5wYXlsb2FkPy5yZXNvdXJjZUlkID09PSByZXNvdXJjZUlkKVxuICAgICAgLmF0KC0xKVxuICAgIGNvbnN0IGNsaWVudE11dGF0aW9uSWQgPSBjb25mbGljdFRyYWNraW5nLmNsaWVudE11dGF0aW9uSWQoKVxuICAgIGNvbnN0IG5vdyA9IGNvbmZsaWN0VHJhY2tpbmcubm93ID8gY29uZmxpY3RUcmFja2luZy5ub3coKSA6IG5ldyBEYXRlKClcbiAgICBjb25zdCBwcmVkZWNlc3NvclRpbWUgPSBwcmVkZWNlc3NvciA/IG5ldyBEYXRlKHByZWRlY2Vzc29yLm11dGF0aW9uLm9jY3VycmVkQXQpLmdldFRpbWUoKSA6IE51bWJlci5ORUdBVElWRV9JTkZJTklUWVxuICAgIGNvbnN0IG9jY3VycmVkQXQgPSBuZXcgRGF0ZShNYXRoLm1heChub3cuZ2V0VGltZSgpLCBwcmVkZWNlc3NvclRpbWUgKyAxKSkudG9JU09TdHJpbmcoKVxuXG4gICAgcmV0dXJuIGF3YWl0IGNvbmZsaWN0VHJhY2tpbmcubXV0YXRpb25Mb2cuYXBwZW5kKHtcbiAgICAgIGRlcGVuZGVuY2llczogcHJlZGVjZXNzb3IgPyBbe2NsaWVudE11dGF0aW9uSWQ6IHByZWRlY2Vzc29yLm11dGF0aW9uLmNsaWVudE11dGF0aW9uSWQsIG1vZGVsOiByZXNvdXJjZVR5cGV9XSA6IFtdLFxuICAgICAgbXV0YXRpb246IHtcbiAgICAgICAgYWN0b3JEZXZpY2VJZDogY29uZmxpY3RUcmFja2luZy5hY3RvckRldmljZUlkLFxuICAgICAgICBhY3RvclVzZXJJZDogY29uZmxpY3RUcmFja2luZy5hY3RvclVzZXJJZCxcbiAgICAgICAgYXR0cmlidXRlczogLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxTeW5jSnNvblZhbHVlPn0gKi8gKGRhdGEpLFxuICAgICAgICBiYXNlVmVyc2lvbixcbiAgICAgICAgY2xpZW50TXV0YXRpb25JZCxcbiAgICAgICAgbW9kZWw6IHJlc291cmNlVHlwZSxcbiAgICAgICAgb2NjdXJyZWRBdCxcbiAgICAgICAgb2ZmbGluZUdyYW50SWQ6IGNvbmZsaWN0VHJhY2tpbmcub2ZmbGluZUdyYW50SWQsXG4gICAgICAgIG9wZXJhdGlvbixcbiAgICAgICAgcGF5bG9hZDoge3Jlc291cmNlSWQsIHN5bmNUeXBlfSxcbiAgICAgICAgcG9saWN5SGFzaDogY29uZmxpY3RUcmFja2luZy5wb2xpY3lIYXNoXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBEcmFpbnMgdGhlIGV4aXN0aW5nIG11dGF0aW9uIGxvZyBpbiBwcmVkZWNlc3NvciBvcmRlci4gSW5kZXBlbmRlbnQgcmVjb3Jkc1xuICAgKiBjb250aW51ZSBhZnRlciBkdXJhYmxlIGNvbmZsaWN0cy9yZWplY3Rpb25zOyBzdWNjZXNzb3JzIHN0YXkgYmxvY2tlZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBSZXBsYXkgYXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5hdXRoZW50aWNhdGlvblRva2VuIC0gQXV0aGVudGljYXRpb24gdG9rZW4uXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5iYXRjaFNpemVdIC0gQmF0Y2ggc2l6ZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDbGllbnRDb25mbGljdFRyYWNraW5nQ29uZmlnfSBhcmdzLmNvbmZsaWN0VHJhY2tpbmcgLSBUcmFja2luZyBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0geyhwYXlsb2FkOiB7YXV0aGVudGljYXRpb25Ub2tlbjogc3RyaW5nLCBzeW5jczogQXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0sIG9wdGlvbnM/OiB7c2lnbmFsPzogQWJvcnRTaWduYWx9KSA9PiBQcm9taXNlPFN5bmNSZXBsYXlSZXNwb25zZT59IGFyZ3MucG9zdFJlcGxheSAtIFRyYW5zcG9ydCBib3VuZGFyeS5cbiAgICogQHBhcmFtIHsoaWRlbnRpdHk6IHN0cmluZykgPT4gbnVtYmVyfSBhcmdzLnJlbW90ZUdlbmVyYXRpb24gLSBDdXJyZW50IHJlbW90ZSBnZW5lcmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5yZXNvdXJjZVR5cGUgLSBSZXNvdXJjZSB3aG9zZSBsb2cgcmVjb3JkcyBzaG91bGQgZHJhaW4uXG4gICAqIEBwYXJhbSB7QWJvcnRTaWduYWx9IFthcmdzLnNpZ25hbF0gLSBMaWZlY3ljbGUgY2FuY2VsbGF0aW9uIHNpZ25hbC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIHdoZW4gbm8gcmVhZHkgaW50ZW50IHJlbWFpbnMuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgcmVwbGF5Q29uZmxpY3RUcmFja2VkU3luY3Moe2F1dGhlbnRpY2F0aW9uVG9rZW4sIGJhdGNoU2l6ZSwgY29uZmxpY3RUcmFja2luZywgcG9zdFJlcGxheSwgcmVtb3RlR2VuZXJhdGlvbiwgcmVzb3VyY2VUeXBlLCBzaWduYWx9KSB7XG4gICAgY29uc3QgbWF4QmF0Y2hTaXplID0gdGhpcy5ub3JtYWxpemVkQmF0Y2hTaXplKGJhdGNoU2l6ZSlcblxuICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICB0aHJvd0lmU3luY0Fib3J0ZWQoc2lnbmFsKVxuICAgICAgY29uc3QgcmVjb3JkcyA9IGF3YWl0IGNvbmZsaWN0VHJhY2tpbmcubXV0YXRpb25Mb2cucmVjb3JkcygpXG4gICAgICB0aHJvd0lmU3luY0Fib3J0ZWQoc2lnbmFsKVxuICAgICAgY29uc3Qgc3RhdHVzZXMgPSBuZXcgTWFwKHJlY29yZHMubWFwKChyZWNvcmQpID0+IFtyZWNvcmQubXV0YXRpb24uY2xpZW50TXV0YXRpb25JZCwgcmVjb3JkLnN0YXR1c10pKVxuICAgICAgY29uc3QgcGVuZGluZyA9IHJlY29yZHMuZmlsdGVyKChyZWNvcmQpID0+IHJlY29yZC5zdGF0dXMgPT09IFwicGVuZGluZ1wiICYmIHJlY29yZC5tdXRhdGlvbi5tb2RlbCA9PT0gcmVzb3VyY2VUeXBlKVxuICAgICAgY29uc3QgcmVhZHkgPSBwZW5kaW5nLmZpbHRlcigocmVjb3JkKSA9PiByZWNvcmQuZGVwZW5kZW5jaWVzLmV2ZXJ5KChkZXBlbmRlbmN5KSA9PiBzdGF0dXNlcy5nZXQoZGVwZW5kZW5jeS5jbGllbnRNdXRhdGlvbklkKSA9PT0gXCJzeW5jZWRcIikpXG5cbiAgICAgIGlmIChyZWFkeS5sZW5ndGggPT09IDApIHJldHVyblxuXG4gICAgICBjb25zdCBncm91cHMgPSB0aGlzLmNvbmZsaWN0UmVwbGF5R3JvdXBzKHtwZW5kaW5nLCByZWFkeX0pLnNsaWNlKDAsIG1heEJhdGNoU2l6ZSlcbiAgICAgIGNvbnN0IGdlbmVyYXRpb25zID0gbmV3IE1hcChncm91cHMubWFwKChncm91cCkgPT4gW2dyb3VwWzBdLm11dGF0aW9uLmNsaWVudE11dGF0aW9uSWQsIHJlbW90ZUdlbmVyYXRpb24odGhpcy5jb25mbGljdFJlY29yZElkZW50aXR5KGdyb3VwWzBdKSldKSlcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgcG9zdFJlcGxheSh7XG4gICAgICAgIGF1dGhlbnRpY2F0aW9uVG9rZW4sXG4gICAgICAgIHN5bmNzOiBncm91cHMubWFwKChncm91cCkgPT4gdGhpcy5jb25mbGljdFJlcGxheVBheWxvYWQoZ3JvdXApKVxuICAgICAgfSwge3NpZ25hbH0pXG5cbiAgICAgIHRocm93SWZTeW5jQWJvcnRlZChzaWduYWwpXG4gICAgICB0aGlzLmVuc3VyZVN1Y2Nlc3NmdWxSZXNwb25zZShyZXNwb25zZSlcblxuICAgICAgY29uc3QgcmVzcG9uc2VzQnlJZCA9IG5ldyBNYXAoKHJlc3BvbnNlLnN5bmNzIHx8IFtdKS5tYXAoKHJlc3VsdCkgPT4gW1N0cmluZyhyZXN1bHQuaWQpLCByZXN1bHRdKSlcblxuICAgICAgZm9yIChjb25zdCBncm91cCBvZiBncm91cHMpIHtcbiAgICAgICAgdGhyb3dJZlN5bmNBYm9ydGVkKHNpZ25hbClcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gcmVzcG9uc2VzQnlJZC5nZXQoZ3JvdXBbMF0ubXV0YXRpb24uY2xpZW50TXV0YXRpb25JZClcblxuICAgICAgICBpZiAoIXJlc3VsdCkgdGhyb3cgbmV3IEVycm9yKGBTeW5jIHJlc3BvbnNlIG1pc3NpbmcgcmVzdWx0IGZvciBtdXRhdGlvbiAke2dyb3VwWzBdLm11dGF0aW9uLmNsaWVudE11dGF0aW9uSWR9YClcbiAgICAgICAgaWYgKCFbXCJzdWNjZXNzZnVsXCIsIFwiZHVwbGljYXRlXCIsIFwiY29uZmxpY3RcIiwgXCJmYWlsZWRcIiwgXCJyZWplY3RlZFwiXS5pbmNsdWRlcyhyZXN1bHQuc3luY1N0YXRlKSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBzeW5jIHN0YXRlIHJldHVybmVkIGZvciBtdXRhdGlvbiAke2dyb3VwWzBdLm11dGF0aW9uLmNsaWVudE11dGF0aW9uSWR9OiAke3Jlc3VsdC5zeW5jU3RhdGV9YClcbiAgICAgICAgfVxuXG4gICAgICAgIGZvciAoY29uc3QgcmVjb3JkIG9mIGdyb3VwKSB7XG4gICAgICAgICAgYXdhaXQgYXBwbHlTeW5jUmVwbGF5UmVzdWx0VG9Mb2NhbE11dGF0aW9uTG9nKHttdXRhdGlvbkxvZzogY29uZmxpY3RUcmFja2luZy5tdXRhdGlvbkxvZywgcmVjb3JkLCByZXN1bHQ6IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAocmVzdWx0KX0pXG4gICAgICAgICAgdGhyb3dJZlN5bmNBYm9ydGVkKHNpZ25hbClcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChbXCJzdWNjZXNzZnVsXCIsIFwiZHVwbGljYXRlXCJdLmluY2x1ZGVzKHJlc3VsdC5zeW5jU3RhdGUpICYmIHJlc3VsdC5zZXJ2ZXJWZXJzaW9uICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICBjb25zdCBpZGVudGl0eSA9IHRoaXMuY29uZmxpY3RSZWNvcmRJZGVudGl0eShncm91cFswXSlcblxuICAgICAgICAgIGlmIChyZW1vdGVHZW5lcmF0aW9uKGlkZW50aXR5KSA9PT0gZ2VuZXJhdGlvbnMuZ2V0KGdyb3VwWzBdLm11dGF0aW9uLmNsaWVudE11dGF0aW9uSWQpKSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnJlYmFzZUNvbmZsaWN0U3VjY2Vzc29yKHtjb25mbGljdFRyYWNraW5nLCBwcmVkZWNlc3NvcjogZ3JvdXBbZ3JvdXAubGVuZ3RoIC0gMV0sIHNlcnZlclZlcnNpb246IHJlc3VsdC5zZXJ2ZXJWZXJzaW9ufSlcbiAgICAgICAgICAgIHRocm93SWZTeW5jQWJvcnRlZChzaWduYWwpXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBzYWZlIHRyYW5zcG9ydCBncm91cHMgZnJvbSByb290LXJlYWR5IHJlY29yZHMgYW5kIHRoZWlyIHN1Y2Nlc3NvcnMuXG4gICAqIEBwYXJhbSB7e3BlbmRpbmc6IEFycmF5PGltcG9ydChcIi4vbG9jYWwtbXV0YXRpb24tbG9nLmpzXCIpLkxvY2FsTXV0YXRpb25Mb2dSZWNvcmQ+LCByZWFkeTogQXJyYXk8aW1wb3J0KFwiLi9sb2NhbC1tdXRhdGlvbi1sb2cuanNcIikuTG9jYWxNdXRhdGlvbkxvZ1JlY29yZD59fSBhcmdzIC0gUGVuZGluZyBhbmQgcm9vdC1yZWFkeSByZWNvcmRzLlxuICAgKiBAcmV0dXJucyB7QXJyYXk8QXJyYXk8aW1wb3J0KFwiLi9sb2NhbC1tdXRhdGlvbi1sb2cuanNcIikuTG9jYWxNdXRhdGlvbkxvZ1JlY29yZD4+fSBTYWZlIHRyYW5zcG9ydCBncm91cHMuXG4gICAqL1xuICBzdGF0aWMgY29uZmxpY3RSZXBsYXlHcm91cHMoe3BlbmRpbmcsIHJlYWR5fSkge1xuICAgIGNvbnN0IGdyb3VwcyA9IFtdXG4gICAgY29uc3Qgc2VsZWN0ZWRJZGVudGl0aWVzID0gbmV3IFNldCgpXG5cbiAgICBmb3IgKGNvbnN0IHJlY29yZCBvZiByZWFkeSkge1xuICAgICAgY29uc3QgaWRlbnRpdHkgPSB0aGlzLmNvbmZsaWN0UmVjb3JkSWRlbnRpdHkocmVjb3JkKVxuXG4gICAgICBpZiAoc2VsZWN0ZWRJZGVudGl0aWVzLmhhcyhpZGVudGl0eSkpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IGdyb3VwID0gW3JlY29yZF1cbiAgICAgIGxldCB0YWlsID0gcmVjb3JkXG5cbiAgICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICAgIGNvbnN0IHN1Y2Nlc3NvciA9IHBlbmRpbmcuZmluZCgoY2FuZGlkYXRlKSA9PiBjYW5kaWRhdGUuZGVwZW5kZW5jaWVzLnNvbWUoKGRlcGVuZGVuY3kpID0+IGRlcGVuZGVuY3kuY2xpZW50TXV0YXRpb25JZCA9PT0gdGFpbC5tdXRhdGlvbi5jbGllbnRNdXRhdGlvbklkKSlcblxuICAgICAgICBpZiAoIXN1Y2Nlc3NvciB8fCAhdGhpcy5jYW5Db2FsZXNjZUNvbmZsaWN0UmVjb3Jkcyh0YWlsLCBzdWNjZXNzb3IpKSBicmVha1xuICAgICAgICBncm91cC5wdXNoKHN1Y2Nlc3NvcilcbiAgICAgICAgdGFpbCA9IHN1Y2Nlc3NvclxuICAgICAgfVxuXG4gICAgICBncm91cHMucHVzaChncm91cClcbiAgICAgIHNlbGVjdGVkSWRlbnRpdGllcy5hZGQoaWRlbnRpdHkpXG4gICAgfVxuXG4gICAgcmV0dXJuIGdyb3Vwc1xuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrcyB3aGV0aGVyIHR3byBkdXJhYmxlIGludGVudHMgY2FuIHNoYXJlIG9uZSB0cmFuc3BvcnQgbXV0YXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9sb2NhbC1tdXRhdGlvbi1sb2cuanNcIikuTG9jYWxNdXRhdGlvbkxvZ1JlY29yZH0gbGVmdCAtIEVhcmxpZXIgaW50ZW50LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vbG9jYWwtbXV0YXRpb24tbG9nLmpzXCIpLkxvY2FsTXV0YXRpb25Mb2dSZWNvcmR9IHJpZ2h0IC0gTGF0ZXIgaW50ZW50LlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gV2hldGhlciBzY2FsYXIgdXBkYXRlcyBjYW4gc2hhcmUgb25lIHRyYW5zcG9ydCBtdXRhdGlvbi5cbiAgICovXG4gIHN0YXRpYyBjYW5Db2FsZXNjZUNvbmZsaWN0UmVjb3JkcyhsZWZ0LCByaWdodCkge1xuICAgIGlmIChsZWZ0Lm11dGF0aW9uLm9wZXJhdGlvbiAhPT0gXCJ1cGRhdGVcIiB8fCByaWdodC5tdXRhdGlvbi5vcGVyYXRpb24gIT09IFwidXBkYXRlXCIpIHJldHVybiBmYWxzZVxuICAgIGlmICh0aGlzLmNvbmZsaWN0UmVjb3JkSWRlbnRpdHkobGVmdCkgIT09IHRoaXMuY29uZmxpY3RSZWNvcmRJZGVudGl0eShyaWdodCkpIHJldHVybiBmYWxzZVxuICAgIGlmIChsZWZ0Lm11dGF0aW9uLmJhc2VWZXJzaW9uICE9PSByaWdodC5tdXRhdGlvbi5iYXNlVmVyc2lvbikgcmV0dXJuIGZhbHNlXG4gICAgaWYgKCF0aGlzLnNjYWxhclN5bmNBdHRyaWJ1dGVzKGxlZnQubXV0YXRpb24uYXR0cmlidXRlcykgfHwgIXRoaXMuc2NhbGFyU3luY0F0dHJpYnV0ZXMocmlnaHQubXV0YXRpb24uYXR0cmlidXRlcykpIHJldHVybiBmYWxzZVxuXG4gICAgcmV0dXJuICFPYmplY3Qua2V5cyhsZWZ0Lm11dGF0aW9uLmF0dHJpYnV0ZXMgfHwge30pLnNvbWUoKGtleSkgPT4gT2JqZWN0Lmhhc093bihyaWdodC5tdXRhdGlvbi5hdHRyaWJ1dGVzIHx8IHt9LCBrZXkpKVxuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrcyB3aGV0aGVyIGF0dHJpYnV0ZXMgY29udGFpbiBzY2FsYXIgSlNPTiB2YWx1ZXMgb25seS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxTeW5jSnNvblZhbHVlPiB8IHVuZGVmaW5lZH0gYXR0cmlidXRlcyAtIEF0dHJpYnV0ZXMuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSBXaGV0aGVyIGV2ZXJ5IHZhbHVlIGlzIHNjYWxhci5cbiAgICovXG4gIHN0YXRpYyBzY2FsYXJTeW5jQXR0cmlidXRlcyhhdHRyaWJ1dGVzKSB7XG4gICAgcmV0dXJuIEJvb2xlYW4oYXR0cmlidXRlcykgJiYgT2JqZWN0LnZhbHVlcyhhdHRyaWJ1dGVzIHx8IHt9KS5ldmVyeSgodmFsdWUpID0+IHZhbHVlID09PSBudWxsIHx8IFtcInN0cmluZ1wiLCBcIm51bWJlclwiLCBcImJvb2xlYW5cIl0uaW5jbHVkZXModHlwZW9mIHZhbHVlKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgb25lIHJlcGxheSBlbnZlbG9wZSBmb3IgYSBzYWZlIHRyYW5zcG9ydCBncm91cC5cbiAgICogQHBhcmFtIHtBcnJheTxpbXBvcnQoXCIuL2xvY2FsLW11dGF0aW9uLWxvZy5qc1wiKS5Mb2NhbE11dGF0aW9uTG9nUmVjb3JkPn0gZ3JvdXAgLSBUcmFuc3BvcnQgZ3JvdXAuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IFJlcGxheSBlbnZlbG9wZS5cbiAgICovXG4gIHN0YXRpYyBjb25mbGljdFJlcGxheVBheWxvYWQoZ3JvdXApIHtcbiAgICBjb25zdCBmaXJzdCA9IGdyb3VwWzBdXG4gICAgY29uc3QgcGF5bG9hZCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoe1xuICAgICAgYmFzZVZlcnNpb246IGZpcnN0Lm11dGF0aW9uLmJhc2VWZXJzaW9uLFxuICAgICAgY2xpZW50VXBkYXRlZEF0OiBmaXJzdC5tdXRhdGlvbi5vY2N1cnJlZEF0LFxuICAgICAgZGF0YTogT2JqZWN0LmFzc2lnbih7fSwgLi4uZ3JvdXAubWFwKChyZWNvcmQpID0+IHJlY29yZC5tdXRhdGlvbi5hdHRyaWJ1dGVzIHx8IHt9KSksXG4gICAgICBpZDogZmlyc3QubXV0YXRpb24uY2xpZW50TXV0YXRpb25JZCxcbiAgICAgIHJlc291cmNlSWQ6IGZpcnN0Lm11dGF0aW9uLnBheWxvYWQ/LnJlc291cmNlSWQsXG4gICAgICByZXNvdXJjZVR5cGU6IGZpcnN0Lm11dGF0aW9uLm1vZGVsLFxuICAgICAgc3luY1R5cGU6IGZpcnN0Lm11dGF0aW9uLnBheWxvYWQ/LnN5bmNUeXBlXG4gICAgfSlcblxuICAgIHJldHVybiBwYXlsb2FkXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIGEgc3RhYmxlIHJlc291cmNlIGlkZW50aXR5IGZvciBvcmRlcmluZyBhbmQgcmVtb3RlIGdlbmVyYXRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vbG9jYWwtbXV0YXRpb24tbG9nLmpzXCIpLkxvY2FsTXV0YXRpb25Mb2dSZWNvcmR9IHJlY29yZCAtIFJlY29yZC5cbiAgICogQHJldHVybnMge3N0cmluZ30gUmVzb3VyY2UgaWRlbnRpdHkuXG4gICAqL1xuICBzdGF0aWMgY29uZmxpY3RSZWNvcmRJZGVudGl0eShyZWNvcmQpIHtcbiAgICByZXR1cm4gYCR7cmVjb3JkLm11dGF0aW9uLm1vZGVsfToke1N0cmluZyhyZWNvcmQubXV0YXRpb24ucGF5bG9hZD8ucmVzb3VyY2VJZCl9YFxuICB9XG5cbiAgLyoqXG4gICAqIFJlYmFzZXMgdGhlIGRpcmVjdCBwZW5kaW5nIHN1Y2Nlc3NvciBmcm9tIGFuIGF1dGhvcml0YXRpdmUgYWNrbm93bGVkZ2VtZW50LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFJlYmFzZSBhcmdzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU3luY0NsaWVudENvbmZsaWN0VHJhY2tpbmdDb25maWd9IGFyZ3MuY29uZmxpY3RUcmFja2luZyAtIFRyYWNraW5nIGNvbmZpZy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2xvY2FsLW11dGF0aW9uLWxvZy5qc1wiKS5Mb2NhbE11dGF0aW9uTG9nUmVjb3JkfSBhcmdzLnByZWRlY2Vzc29yIC0gQWNrbm93bGVkZ2VkIHByZWRlY2Vzc29yLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG51bWJlciB8IG51bGx9IGFyZ3Muc2VydmVyVmVyc2lvbiAtIEF1dGhvcml0YXRpdmUgc2VydmVyIHZlcnNpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHJlYmFzZUNvbmZsaWN0U3VjY2Vzc29yKHtjb25mbGljdFRyYWNraW5nLCBwcmVkZWNlc3Nvciwgc2VydmVyVmVyc2lvbn0pIHtcbiAgICBjb25zdCBzdWNjZXNzb3IgPSAoYXdhaXQgY29uZmxpY3RUcmFja2luZy5tdXRhdGlvbkxvZy5wZW5kaW5nUmVjb3JkcygpKVxuICAgICAgLmZpbmQoKHJlY29yZCkgPT4gcmVjb3JkLmRlcGVuZGVuY2llcy5zb21lKChkZXBlbmRlbmN5KSA9PiBkZXBlbmRlbmN5LmNsaWVudE11dGF0aW9uSWQgPT09IHByZWRlY2Vzc29yLm11dGF0aW9uLmNsaWVudE11dGF0aW9uSWQpKVxuXG4gICAgaWYgKCFzdWNjZXNzb3IpIHJldHVyblxuXG4gICAgYXdhaXQgY29uZmxpY3RUcmFja2luZy5tdXRhdGlvbkxvZy51cGRhdGVNdXRhdGlvbih7XG4gICAgICBpZDogc3VjY2Vzc29yLmlkLFxuICAgICAgbXV0YXRpb246IHsuLi5zdWNjZXNzb3IubXV0YXRpb24sIGJhc2VWZXJzaW9uOiBzZXJ2ZXJWZXJzaW9ufVxuICAgIH0pXG4gIH1cbiAgLyoqXG4gICAqIFNlcmlhbGl6ZXMgc3luYyB3b3JrIHdpdGggdGhlIHNhbWUga2V5IHNvIGNhbGxlcnMgZG8gbm90IGhhdmUgdG8ga2VlcCBhcHAtbG9jYWwgbG9ja3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBrZXkgLSBMb2NrIGtleS5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPHZvaWQ+fSBjYWxsYmFjayAtIFdvcmsgdG8gcnVuIG9uY2UgcHJldmlvdXMgd29yayBmaW5pc2hlZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBzdGF0aWMgYXN5bmMgc2luZ2xlRmxpZ2h0KGtleSwgY2FsbGJhY2spIHtcbiAgICB3aGlsZSAoc3luY1Rhc2tQcm9taXNlcy5oYXMoa2V5KSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgc3luY1Rhc2tQcm9taXNlcy5nZXQoa2V5KVxuICAgICAgfSBjYXRjaCAoX2Vycm9yKSB7XG4gICAgICAgIC8vIFRoZSBmYWlsZWQgZmxpZ2h0J3Mgb3duIGNhbGxlciBvYnNlcnZlcyB0aGF0IHJlamVjdGlvbjsgY2FsbGVycyBxdWV1ZWRcbiAgICAgICAgLy8gYmVoaW5kIGl0IHN0aWxsIHJ1biB0aGVpciBvd24gd29yayBzbyBwZW5kaW5nIHJvd3MgcmV0cnkgYWZ0ZXIgdGhlIGxvY2sgY2xlYXJzLlxuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IHByb21pc2UgPSBjYWxsYmFjaygpXG4gICAgc3luY1Rhc2tQcm9taXNlcy5zZXQoa2V5LCBwcm9taXNlKVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHByb21pc2VcbiAgICB9IGZpbmFsbHkge1xuICAgICAgaWYgKHN5bmNUYXNrUHJvbWlzZXMuZ2V0KGtleSkgPT09IHByb21pc2UpIHN5bmNUYXNrUHJvbWlzZXMuZGVsZXRlKGtleSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUHVsbHMgYmFja2VuZCBzeW5jIGNoYW5nZXMgd2l0aCBhIGZyYW1ld29yay1tYW5hZ2VkIGN1cnNvciByb3cuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gUHVsbCBhcmdzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5hdXRoZW50aWNhdGlvblRva2VuIC0gQXV0aCB0b2tlbiB0byBzZW5kIHdpdGggY2hhbmdlIHJlcXVlc3RzLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuYmF0Y2hTaXplXSAtIE1heCBzeW5jcyBwZXIgcmVxdWVzdC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5jdXJzb3JNb2RlbCAtIE1vZGVsIHRoYXQgcmVzcG9uZHMgdG8gZmluZEJ5L2ZpbmRPckluaXRpYWxpemVCeSBmb3IgY3Vyc29yIHBlcnNpc3RlbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jdXJzb3JLZXkgLSBDdXJzb3Igb3B0aW9uIGtleS5cbiAgICogQHBhcmFtIHsocGF5bG9hZDogU3luY0NoYW5nZXNSZXF1ZXN0KSA9PiBQcm9taXNlPFN5bmNDaGFuZ2VzUmVzcG9uc2U+fSBhcmdzLnBvc3RDaGFuZ2VzIC0gUG9zdHMgb25lIGNoYW5nZXMgcmVxdWVzdC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBTeW5jUmVzb3VyY2VDb25maWc+fSBhcmdzLnJlc291cmNlcyAtIFJlc291cmNlIHBvbGljaWVzLlxuICAgKiBAcGFyYW0geyhwcm9ncmVzczogaW1wb3J0KFwiLi9zeW5jLWFwaS1jbGllbnQtdHlwZXMuanNcIikuU3luY1B1bGxQcm9ncmVzcykgPT4gdm9pZH0gW2FyZ3Mub25Qcm9ncmVzc10gLSBQcm9ncmVzcyBjYWxsYmFjay5cbiAgICogQHBhcmFtIHtBYm9ydFNpZ25hbH0gW2FyZ3Muc2lnbmFsXSAtIExpZmVjeWNsZSBjYW5jZWxsYXRpb24gc2lnbmFsLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxTeW5jQ2hhbmdlc1Jlc3VsdD59IFB1bGwgcmVzdWx0LlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHB1bGxDaGFuZ2VzV2l0aEN1cnNvcihhcmdzKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMucHVsbENoYW5nZXMoe1xuICAgICAgYXV0aGVudGljYXRpb25Ub2tlbjogYXJncy5hdXRoZW50aWNhdGlvblRva2VuLFxuICAgICAgYmF0Y2hTaXplOiBhcmdzLmJhdGNoU2l6ZSxcbiAgICAgIGxvYWRDdXJzb3I6IGFzeW5jICgpID0+IGF3YWl0IHRoaXMubG9hZFN5bmNDdXJzb3Ioe2N1cnNvcktleTogYXJncy5jdXJzb3JLZXksIGN1cnNvck1vZGVsOiBhcmdzLmN1cnNvck1vZGVsfSksXG4gICAgICBzYXZlQ3Vyc29yOiBhc3luYyAoY3Vyc29yKSA9PiBhd2FpdCB0aGlzLnNhdmVTeW5jQ3Vyc29yKHtjdXJzb3IsIGN1cnNvcktleTogYXJncy5jdXJzb3JLZXksIGN1cnNvck1vZGVsOiBhcmdzLmN1cnNvck1vZGVsfSksXG4gICAgICBwb3N0Q2hhbmdlczogYXJncy5wb3N0Q2hhbmdlcyxcbiAgICAgIGFwcGx5U3luYzogdGhpcy5yZXNvdXJjZUFwcGxpZXIoYXJncy5yZXNvdXJjZXMpLFxuICAgICAgb25Qcm9ncmVzczogYXJncy5vblByb2dyZXNzLFxuICAgICAgc2lnbmFsOiBhcmdzLnNpZ25hbFxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogTG9hZHMgYSBwZXJzaXN0ZWQgc3luYyBjdXJzb3IgZnJvbSBhIG1vZGVsIHJvdyB3aXRoIGEgdmFsdWUgY29sdW1uLlxuICAgKiBAcGFyYW0ge3tjdXJzb3JLZXk6IHN0cmluZywgY3Vyc29yTW9kZWw6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fX0gYXJncyAtIEN1cnNvciBhcmdzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmcgfCBudWxsPn0gUGVyc2lzdGVkIGN1cnNvciBwYXlsb2FkLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGxvYWRTeW5jQ3Vyc29yKHtjdXJzb3JLZXksIGN1cnNvck1vZGVsfSkge1xuICAgIGNvbnN0IG9wdGlvbiA9IGF3YWl0IGN1cnNvck1vZGVsLmZpbmRCeSh7a2V5OiBjdXJzb3JLZXl9KVxuXG4gICAgcmV0dXJuIG9wdGlvbiA/IG9wdGlvbi52YWx1ZSgpIDogbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFNhdmVzIGEgcGVyc2lzdGVkIHN5bmMgY3Vyc29yIHRvIGEgbW9kZWwgcm93IHdpdGggYSB2YWx1ZSBjb2x1bW4uXG4gICAqIEBwYXJhbSB7e2N1cnNvcjogU3luY0N1cnNvciwgY3Vyc29yS2V5OiBzdHJpbmcsIGN1cnNvck1vZGVsOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn19IGFyZ3MgLSBDdXJzb3IgYXJncy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBzdGF0aWMgYXN5bmMgc2F2ZVN5bmNDdXJzb3Ioe2N1cnNvciwgY3Vyc29yS2V5LCBjdXJzb3JNb2RlbH0pIHtcbiAgICBpZiAoIWN1cnNvcikgcmV0dXJuXG5cbiAgICBjb25zdCBvcHRpb24gPSBhd2FpdCBjdXJzb3JNb2RlbC5maW5kT3JJbml0aWFsaXplQnkoe2tleTogY3Vyc29yS2V5fSlcblxuICAgIG9wdGlvbi5hc3NpZ24oe3ZhbHVlOiBKU09OLnN0cmluZ2lmeShjdXJzb3IpfSlcbiAgICBpZiAob3B0aW9uLmlzQ2hhbmdlZCgpKSBhd2FpdCBvcHRpb24uc2F2ZSgpXG4gIH1cblxuICAvKipcbiAgICogUHVsbHMgYmFja2VuZCBzeW5jIGNoYW5nZXMgaW4gc3RhYmxlIHBhZ2VzLCBhcHBsaWVzIHRoZW0gbG9jYWxseSwgYW5kIHN0b3Jlc1xuICAgKiB0aGUgYWNrbm93bGVkZ2VkIGN1cnNvci4gQXBwcyBwcm92aWRlIG9ubHkgYXV0aCwgcGVyc2lzdGVuY2UsIHRyYW5zcG9ydCwgYW5kXG4gICAqIHJlc291cmNlIHBvbGljeSBob29rcy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBQdWxsIGFyZ3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmF1dGhlbnRpY2F0aW9uVG9rZW4gLSBBdXRoIHRva2VuIHRvIHNlbmQgd2l0aCBjaGFuZ2UgcmVxdWVzdHMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5iYXRjaFNpemVdIC0gTWF4IHN5bmNzIHBlciByZXF1ZXN0LiBEZWZhdWx0cyB0byAxMDAuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxTeW5jQ3Vyc29yIHwgc3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZD59IGFyZ3MubG9hZEN1cnNvciAtIExvYWRzIHRoZSBwZXJzaXN0ZWQgbG9jYWwgY3Vyc29yLlxuICAgKiBAcGFyYW0geyhjdXJzb3I6IFN5bmNDdXJzb3IpID0+IFByb21pc2U8dm9pZD59IGFyZ3Muc2F2ZUN1cnNvciAtIFBlcnNpc3RzIHRoZSBmaW5hbCBhY2tub3dsZWRnZWQgY3Vyc29yLlxuICAgKiBAcGFyYW0geyhwYXlsb2FkOiBTeW5jQ2hhbmdlc1JlcXVlc3QsIG9wdGlvbnM/OiB7c2lnbmFsPzogQWJvcnRTaWduYWx9KSA9PiBQcm9taXNlPFN5bmNDaGFuZ2VzUmVzcG9uc2U+fSBhcmdzLnBvc3RDaGFuZ2VzIC0gUG9zdHMgb25lIGNoYW5nZXMgcmVxdWVzdC5cbiAgICogQHBhcmFtIHsoc3luYzogU3luY0NoYW5nZUVudmVsb3BlKSA9PiBQcm9taXNlPFN5bmNDaGFuZ2VBcHBseVJlc3VsdD59IGFyZ3MuYXBwbHlTeW5jIC0gQXBwbGllcyBvbmUgbm9ybWFsaXplZCBzeW5jIHJvdyBsb2NhbGx5LlxuICAgKiBAcGFyYW0geyhwcm9ncmVzczogaW1wb3J0KFwiLi9zeW5jLWFwaS1jbGllbnQtdHlwZXMuanNcIikuU3luY1B1bGxQcm9ncmVzcykgPT4gdm9pZH0gW2FyZ3Mub25Qcm9ncmVzc10gLSBQcm9ncmVzcyBjYWxsYmFjayBpbnZva2VkIHBlciBhcHBsaWVkIHBhZ2UgKGFuZCBvbmNlIGZvciBhbiBlbXB0eSBwdWxsKSB3aXRoIHRoZSBhcHBsaWVkIGNvdW50cyBhbmQgdGhlIHN0YWJsZSBzZXJ2ZXIgdG90YWwuXG4gICAqIEBwYXJhbSB7QWJvcnRTaWduYWx9IFthcmdzLnNpZ25hbF0gLSBMaWZlY3ljbGUgY2FuY2VsbGF0aW9uIHNpZ25hbC5cbiAgICogQHJldHVybnMge1Byb21pc2U8U3luY0NoYW5nZXNSZXN1bHQ+fSBQdWxsIHJlc3VsdC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBwdWxsQ2hhbmdlcyhhcmdzKSB7XG4gICAgdGhyb3dJZlN5bmNBYm9ydGVkKGFyZ3Muc2lnbmFsKVxuICAgIGxldCBhZnRlckN1cnNvciA9IHRoaXMuc3luY0N1cnNvckZyb21QYXlsb2FkKGF3YWl0IGFyZ3MubG9hZEN1cnNvcigpKVxuICAgIGxldCB1cFRvQ3Vyc29yID0gbnVsbFxuICAgIGxldCBwYWdlcyA9IDBcbiAgICBsZXQgc3luY2VkQ291bnQgPSAwXG4gICAgbGV0IHRvdGFsID0gMFxuICAgIGxldCBjaGFuZ2VkID0gZmFsc2VcbiAgICBjb25zdCByZXNvdXJjZUNvdW50cyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gKi8gKHt9KVxuICAgIGNvbnN0IHJlc291cmNlQ2hhbmdlZCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgYm9vbGVhbj59ICovICh7fSlcbiAgICBjb25zdCBiYXRjaFNpemUgPSB0aGlzLm5vcm1hbGl6ZWRCYXRjaFNpemUoYXJncy5iYXRjaFNpemUpXG5cbiAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgdGhyb3dJZlN5bmNBYm9ydGVkKGFyZ3Muc2lnbmFsKVxuICAgICAgY29uc3QgY2hhbmdlc1Jlc3BvbnNlID0gYXdhaXQgdGhpcy5jaGFuZ2VzUGFnZSh7Li4uYXJncywgYWZ0ZXJDdXJzb3IsIGJhdGNoU2l6ZSwgdXBUb0N1cnNvcn0pXG4gICAgICB0aHJvd0lmU3luY0Fib3J0ZWQoYXJncy5zaWduYWwpXG4gICAgICBjb25zdCBzeW5jcyA9IGNoYW5nZXNSZXNwb25zZS5zeW5jc1xuXG4gICAgICBpZiAoIXVwVG9DdXJzb3IpIHVwVG9DdXJzb3IgPSBjaGFuZ2VzUmVzcG9uc2UudXBUb0N1cnNvclxuXG4gICAgICAvLyBUaGUgc2VydmVyIGNvdW50cyBwZW5kaW5nIHJvd3MgZnJvbSB0aGlzIHJlcXVlc3QncyBjdXJzb3IsIHNvIGFscmVhZHktYXBwbGllZFxuICAgICAgLy8gcGFnZXMgcGx1cyB0aGlzIHJlcXVlc3QncyBjb3VudCBzdGF5cyB0aGUgc2FtZSB0b3RhbCBhY3Jvc3MgZXZlcnkgcGFnZTogYSBzdGFibGVcbiAgICAgIC8vIFwib2YgWVwiIGRlbm9taW5hdG9yIGV2ZW4gYXMgdGhlIGN1cnNvciBhZHZhbmNlcy4gQSBzZXJ2ZXIgdGhhdCBkb2Vzbid0IHJlcG9ydCB0aGVcbiAgICAgIC8vIGNvdW50IGF0IGFsbCBsZWF2ZXMgdGhlIHRvdGFsIGF0IDAgZm9yIGV2ZXJ5IHBhZ2UgcmF0aGVyIHRoYW4gZHJpZnRpbmcgdXB3YXJkc1xuICAgICAgLy8gd2l0aCB0aGUgYXBwbGllZCByb3dzLlxuICAgICAgaWYgKGNoYW5nZXNSZXNwb25zZS50b3RhbCAhPT0gbnVsbCkgdG90YWwgPSBzeW5jZWRDb3VudCArIGNoYW5nZXNSZXNwb25zZS50b3RhbFxuXG4gICAgICBpZiAoc3luY3MubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIC8vIFJlcG9ydCB0aGUgdGVybWluYWwgcHJvZ3Jlc3Mgb25jZSBmb3IgYW4gZW50aXJlbHkgZW1wdHkgcHVsbCBzbyBjb25zdW1lcnMgb2JzZXJ2ZVxuICAgICAgICAvLyB0b3RhbCAwOyBhIHB1bGwgdGhhdCBhbHJlYWR5IGFwcGxpZWQgcGFnZXMgcmVwb3J0ZWQgaXRzIGZpbmFsIGNvdW50cyBvbiBpdHMgbGFzdCBwYWdlLlxuICAgICAgICB0aHJvd0lmU3luY0Fib3J0ZWQoYXJncy5zaWduYWwpXG4gICAgICAgIGlmIChwYWdlcyA9PT0gMCAmJiBhcmdzLm9uUHJvZ3Jlc3MpIGFyZ3Mub25Qcm9ncmVzcyh7cGFnZXMsIHN5bmNlZENvdW50LCB0b3RhbH0pXG5cbiAgICAgICAgYnJlYWtcbiAgICAgIH1cblxuICAgICAgcGFnZXMgKz0gMVxuXG4gICAgICAvLyBDb2FsZXNjZSByZWNvcmQtY2hhbmdlIGV2ZW50cyBhY3Jvc3MgdGhpcyBwYWdlJ3MgYXBwbGllcyBzbyBOIGFwcGxpZWQgcm93cyB0cmlnZ2VyIG9uZVxuICAgICAgLy8gbGl2ZS1xdWVyeSByZS1ydW4uIE9ubHkgdGhlIGFwcGx5IGxvb3AgaXMgYmF0Y2hlZDogdGhlIG5ldHdvcmsgcGFnZSBmZXRjaCBhYm92ZSBhbmQgdGhlXG4gICAgICAvLyBjdXJzb3Igc2F2ZSBiZWxvdyBzdGF5IG91dHNpZGUsIHNvIGxpdmUgcXVlcmllcyBmbHVzaCByaWdodCBhZnRlciB0aGUgYXBwbGllcyBpbnN0ZWFkIG9mXG4gICAgICAvLyB3YWl0aW5nIGZvciB0aGUgcmVzdCBvZiB0aGUgcHVsbC5cbiAgICAgIGF3YWl0IHJlY29yZENoYW5nZXMuYmF0Y2goYXN5bmMgKCkgPT4ge1xuICAgICAgICBmb3IgKGNvbnN0IHN5bmMgb2Ygc3luY3MpIHtcbiAgICAgICAgICB0aHJvd0lmU3luY0Fib3J0ZWQoYXJncy5zaWduYWwpXG4gICAgICAgICAgY29uc3QgYXBwbHlSZXN1bHQgPSBhd2FpdCBhcmdzLmFwcGx5U3luYyhzeW5jKVxuICAgICAgICAgIHRocm93SWZTeW5jQWJvcnRlZChhcmdzLnNpZ25hbClcbiAgICAgICAgICBjb25zdCByZXNvdXJjZVR5cGUgPSBhcHBseVJlc3VsdC5yZXNvdXJjZVR5cGUgPz8gc3luYy5yZXNvdXJjZVR5cGUoKVxuXG4gICAgICAgICAgY2hhbmdlZCB8fD0gYXBwbHlSZXN1bHQuY2hhbmdlZCA9PT0gdHJ1ZVxuICAgICAgICAgIHN5bmNlZENvdW50ICs9IDFcblxuICAgICAgICAgIGlmIChyZXNvdXJjZVR5cGUpIHtcbiAgICAgICAgICAgIHJlc291cmNlQ291bnRzW3Jlc291cmNlVHlwZV0gPSAocmVzb3VyY2VDb3VudHNbcmVzb3VyY2VUeXBlXSB8fCAwKSArIDFcbiAgICAgICAgICAgIHJlc291cmNlQ2hhbmdlZFtyZXNvdXJjZVR5cGVdIHx8PSBhcHBseVJlc3VsdC5jaGFuZ2VkID09PSB0cnVlXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KVxuXG4gICAgICBhZnRlckN1cnNvciA9IGNoYW5nZXNSZXNwb25zZS5uZXh0Q3Vyc29yXG5cbiAgICAgIHRocm93SWZTeW5jQWJvcnRlZChhcmdzLnNpZ25hbClcbiAgICAgIGlmIChhcmdzLm9uUHJvZ3Jlc3MpIGFyZ3Mub25Qcm9ncmVzcyh7cGFnZXMsIHN5bmNlZENvdW50LCB0b3RhbH0pXG4gICAgICBpZiAoc3luY3MubGVuZ3RoIDwgYmF0Y2hTaXplKSBicmVha1xuICAgIH1cblxuICAgIHRocm93SWZTeW5jQWJvcnRlZChhcmdzLnNpZ25hbClcbiAgICBpZiAoYWZ0ZXJDdXJzb3IpIGF3YWl0IGFyZ3Muc2F2ZUN1cnNvcihhZnRlckN1cnNvcilcbiAgICB0aHJvd0lmU3luY0Fib3J0ZWQoYXJncy5zaWduYWwpXG5cbiAgICByZXR1cm4ge2NoYW5nZWQsIHBhZ2VzLCByZXNvdXJjZUNoYW5nZWQsIHJlc291cmNlQ291bnRzLCBzeW5jZWRDb3VudCwgdG90YWx9XG4gIH1cblxuICAvKipcbiAgICogRmV0Y2hlcyBhbmQgdmFsaWRhdGVzIG9uZSBiYWNrZW5kIHN5bmMgY2hhbmdlcyBwYWdlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFBhZ2UgYXJncy5cbiAgICogQHBhcmFtIHtTeW5jQ3Vyc29yfSBhcmdzLmFmdGVyQ3Vyc29yIC0gTGFzdCBhY2tub3dsZWRnZWQgY3Vyc29yLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5hdXRoZW50aWNhdGlvblRva2VuIC0gQXV0aCB0b2tlbi5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MuYmF0Y2hTaXplIC0gUGFnZSBzaXplLlxuICAgKiBAcGFyYW0geyhwYXlsb2FkOiBTeW5jQ2hhbmdlc1JlcXVlc3QsIG9wdGlvbnM/OiB7c2lnbmFsPzogQWJvcnRTaWduYWx9KSA9PiBQcm9taXNlPFN5bmNDaGFuZ2VzUmVzcG9uc2U+fSBhcmdzLnBvc3RDaGFuZ2VzIC0gQ2hhbmdlcyBwb3N0ZXIuXG4gICAqIEBwYXJhbSB7QWJvcnRTaWduYWx9IFthcmdzLnNpZ25hbF0gLSBMaWZlY3ljbGUgY2FuY2VsbGF0aW9uIHNpZ25hbC5cbiAgICogQHBhcmFtIHtTeW5jQ3Vyc29yfSBhcmdzLnVwVG9DdXJzb3IgLSBTbmFwc2hvdCB1cHBlci1ib3VuZCBjdXJzb3IuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHtuZXh0Q3Vyc29yOiBTeW5jQ3Vyc29yLCBzeW5jczogU3luY0NoYW5nZUVudmVsb3BlW10sIHRvdGFsOiBudW1iZXIgfCBudWxsLCB1cFRvQ3Vyc29yOiBTeW5jQ3Vyc29yfT59IE5vcm1hbGl6ZWQgY2hhbmdlcyBwYWdlLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGNoYW5nZXNQYWdlKHthZnRlckN1cnNvciwgYXV0aGVudGljYXRpb25Ub2tlbiwgYmF0Y2hTaXplLCBwb3N0Q2hhbmdlcywgc2lnbmFsLCB1cFRvQ3Vyc29yfSkge1xuICAgIHRocm93SWZTeW5jQWJvcnRlZChzaWduYWwpXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBwb3N0Q2hhbmdlcyh7XG4gICAgICBhdXRoZW50aWNhdGlvblRva2VuLFxuICAgICAgbGltaXQ6IGJhdGNoU2l6ZSxcbiAgICAgIC4uLnRoaXMuY3Vyc29yUGF5bG9hZChcImFmdGVyXCIsIGFmdGVyQ3Vyc29yKSxcbiAgICAgIC4uLnRoaXMuY3Vyc29yUGF5bG9hZChcInVwVG9cIiwgdXBUb0N1cnNvcilcbiAgICB9LCB7c2lnbmFsfSlcblxuICAgIHRocm93SWZTeW5jQWJvcnRlZChzaWduYWwpXG4gICAgdGhpcy5lbnN1cmVTdWNjZXNzZnVsQ2hhbmdlc1Jlc3BvbnNlKHJlc3BvbnNlKVxuXG4gICAgY29uc3Qgc3luY3MgPSAvKiogQHR5cGUge3Vua25vd25bXX0gKi8gKHJlc3BvbnNlLnN5bmNzKVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIG5leHRDdXJzb3I6IHRoaXMuc3luY0N1cnNvckZyb21QYXlsb2FkKHJlc3BvbnNlLm5leHRDdXJzb3IgPz8gbnVsbCksXG4gICAgICBzeW5jczogc3luY3MubWFwKChzeW5jUGF5bG9hZCkgPT4gdGhpcy5zeW5jRW52ZWxvcGVGcm9tUGF5bG9hZChzeW5jUGF5bG9hZCkpLFxuICAgICAgdG90YWw6IG9wdGlvbmFsSW50ZWdlcihyZXNwb25zZS50b3RhbCksXG4gICAgICB1cFRvQ3Vyc29yOiB0aGlzLnN5bmNDdXJzb3JGcm9tUGF5bG9hZChyZXNwb25zZS51cFRvQ3Vyc29yID8/IG51bGwpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrcyBBUEkgcmVzcG9uc2Ugc3RhdHVzIGFuZCBzaGFwZSBmb3IgY2hhbmdlLWZlZWQgcHVsbHMuXG4gICAqIEBwYXJhbSB7U3luY0NoYW5nZXNSZXNwb25zZX0gcmVzcG9uc2UgLSBDaGFuZ2VzIHJlc3BvbnNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyBlbnN1cmVTdWNjZXNzZnVsQ2hhbmdlc1Jlc3BvbnNlKHJlc3BvbnNlKSB7XG4gICAgaWYgKHJlc3BvbnNlLnN0YXR1cyA9PT0gXCJlcnJvclwiKSB0aHJvdyBuZXcgRXJyb3IocmVzcG9uc2UuZXJyb3JNZXNzYWdlIHx8IFwiU3luYyBjaGFuZ2VzIGZhaWxlZFwiKVxuICAgIGlmICghQXJyYXkuaXNBcnJheShyZXNwb25zZS5zeW5jcykpIHRocm93IG5ldyBFcnJvcihcIlN5bmMgY2hhbmdlcyByZXNwb25zZSBtaXNzaW5nIHN5bmNzXCIpXG4gIH1cblxuICAvKipcbiAgICogQ29udmVydHMgYSBjdXJzb3IgaW50byByZXF1ZXN0IHBhcmFtcyB3aXRoIHRoZSBnaXZlbiBwcmVmaXguXG4gICAqIEBwYXJhbSB7XCJhZnRlclwiIHwgXCJ1cFRvXCJ9IHByZWZpeCAtIFJlcXVlc3QgZmllbGQgcHJlZml4LlxuICAgKiBAcGFyYW0ge1N5bmNDdXJzb3J9IGN1cnNvciAtIEN1cnNvciB0byBzZXJpYWxpemUuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBudW1iZXIgfCBudWxsPn0gUmVxdWVzdCBwYXJhbXMuXG4gICAqL1xuICBzdGF0aWMgY3Vyc29yUGF5bG9hZChwcmVmaXgsIGN1cnNvcikge1xuICAgIGlmICghY3Vyc29yKSByZXR1cm4ge31cblxuICAgIHJldHVybiB7XG4gICAgICBbYCR7cHJlZml4fUlkYF06IGN1cnNvci5pZCxcbiAgICAgIC4uLihjdXJzb3Iuc2VydmVyU2VxdWVuY2UgPyB7W2Ake3ByZWZpeH1TZXJ2ZXJTZXF1ZW5jZWBdOiBjdXJzb3Iuc2VydmVyU2VxdWVuY2V9IDoge30pLFxuICAgICAgW2Ake3ByZWZpeH1VcGRhdGVkQXRgXTogY3Vyc29yLnVwZGF0ZWRBdFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBQYXJzZXMgYSBwZXJzaXN0ZWQgb3IgcmVzcG9uc2UgY3Vyc29yIHBheWxvYWQuXG4gICAqIEBwYXJhbSB7U3luY0N1cnNvciB8IHN0cmluZyB8IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IG51bGwgfCB1bmRlZmluZWR9IHBheWxvYWQgLSBDdXJzb3IgcGF5bG9hZC5cbiAgICogQHJldHVybnMge1N5bmNDdXJzb3J9IFBhcnNlZCBjdXJzb3IuXG4gICAqL1xuICBzdGF0aWMgc3luY0N1cnNvckZyb21QYXlsb2FkKHBheWxvYWQpIHtcbiAgICBpZiAoIXBheWxvYWQpIHJldHVybiBudWxsXG5cbiAgICBpZiAodHlwZW9mIHBheWxvYWQgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIHJldHVybiB0aGlzLnN5bmNDdXJzb3JGcm9tUGF5bG9hZChKU09OLnBhcnNlKHBheWxvYWQpKVxuICAgICAgfSBjYXRjaCAoX2Vycm9yKSB7XG4gICAgICAgIHJldHVybiB7aWQ6IG51bGwsIHNlcnZlclNlcXVlbmNlOiBudWxsLCB1cGRhdGVkQXQ6IHBheWxvYWR9XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBwYXlsb2FkICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkocGF5bG9hZCkpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCB1cGRhdGVkQXQgPSB0eXBlb2YgcGF5bG9hZC51cGRhdGVkQXQgPT09IFwic3RyaW5nXCIgPyBwYXlsb2FkLnVwZGF0ZWRBdCA6IG51bGxcblxuICAgIGlmICghdXBkYXRlZEF0KSByZXR1cm4gbnVsbFxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGlkOiBwYXlsb2FkLmlkID09PSBudWxsIHx8IHBheWxvYWQuaWQgPT09IHVuZGVmaW5lZCA/IG51bGwgOiBTdHJpbmcocGF5bG9hZC5pZCksXG4gICAgICBzZXJ2ZXJTZXF1ZW5jZTogb3B0aW9uYWxJbnRlZ2VyKHBheWxvYWQuc2VydmVyU2VxdWVuY2UgPT09IFwiXCIgPyBudWxsIDogcGF5bG9hZC5zZXJ2ZXJTZXF1ZW5jZSksXG4gICAgICB1cGRhdGVkQXRcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIGEgbm9ybWFsaXplZCBzeW5jIHJvdyBhZGFwdGVyLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBwYXlsb2FkIC0gUmF3IHN5bmMgcGF5bG9hZC5cbiAgICogQHJldHVybnMge1N5bmNDaGFuZ2VFbnZlbG9wZX0gU3luYyByb3cgYWRhcHRlci5cbiAgICovXG4gIHN0YXRpYyBzeW5jRW52ZWxvcGVGcm9tUGF5bG9hZChwYXlsb2FkKSB7XG4gICAgaWYgKCFwYXlsb2FkIHx8IHR5cGVvZiBwYXlsb2FkICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkocGF5bG9hZCkpIHRocm93IG5ldyBFcnJvcihcIlN5bmMgY2hhbmdlcyBlbnRyeSBtdXN0IGJlIGFuIG9iamVjdFwiKVxuXG4gICAgY29uc3Qgc3luY1BheWxvYWQgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHBheWxvYWQpXG5cbiAgICByZXR1cm4ge1xuICAgICAgZGF0YTogKCkgPT4gc3luY1BheWxvYWQuZGF0YSxcbiAgICAgIGlkOiAoKSA9PiBzeW5jUGF5bG9hZC5pZCxcbiAgICAgIHJlc291cmNlSWQ6ICgpID0+IHN5bmNQYXlsb2FkLnJlc291cmNlSWQsXG4gICAgICByZXNvdXJjZVR5cGU6ICgpID0+IHN5bmNQYXlsb2FkLnJlc291cmNlVHlwZSA9PT0gbnVsbCB8fCBzeW5jUGF5bG9hZC5yZXNvdXJjZVR5cGUgPT09IHVuZGVmaW5lZCA/IG51bGwgOiBTdHJpbmcoc3luY1BheWxvYWQucmVzb3VyY2VUeXBlKSxcbiAgICAgIHN5bmNUeXBlOiAoKSA9PiBzeW5jUGF5bG9hZC5zeW5jVHlwZSA9PT0gbnVsbCB8fCBzeW5jUGF5bG9hZC5zeW5jVHlwZSA9PT0gdW5kZWZpbmVkID8gXCJcIiA6IFN0cmluZyhzeW5jUGF5bG9hZC5zeW5jVHlwZSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIGFuIGFwcC1jb25maWd1cmVkIHJlc291cmNlIGFwcGxpZXIgZm9yIHB1bGxlZCBzeW5jIHJvd3MuIFRoZSBzeW5jXG4gICAqIG1lY2hhbmljcyBzdGF5IGhlcmU7IGFwcHMgb25seSBkZWNsYXJlIHdoaWNoIG1vZGVscy9hdHRyaWJ1dGVzL2hvb2tzIGFyZVxuICAgKiBhbGxvd2VkIGZvciBlYWNoIHJlc291cmNlIHR5cGUuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgU3luY1Jlc291cmNlQ29uZmlnPn0gcmVzb3VyY2VzIC0gUmVzb3VyY2UgcG9saWN5IG1hcC5cbiAgICogQHBhcmFtIHsocmVjb3JkOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPikgPT4gKCkgPT4gdm9pZH0gW29uUmVjb3JkXSAtIENhbGxlZCB3aXRoIGVhY2ggcmVjb3JkIGFib3V0IHRvIGJlIHdyaXR0ZW47IHJldHVybnMgYSByZWxlYXNlIGNhbGxiYWNrIGludm9rZWQgYWZ0ZXIgdGhlIHdyaXRlICh1c2VkIGZvciBlY2hvIHN1cHByZXNzaW9uKS5cbiAgICogQHJldHVybnMgeyhzeW5jOiBTeW5jQ2hhbmdlRW52ZWxvcGUpID0+IFByb21pc2U8U3luY0NoYW5nZUFwcGx5UmVzdWx0Pn0gU3luYyBhcHBseSBjYWxsYmFjay5cbiAgICovXG4gIHN0YXRpYyByZXNvdXJjZUFwcGxpZXIocmVzb3VyY2VzLCBvblJlY29yZCkge1xuICAgIHJldHVybiBhc3luYyAoc3luYykgPT4gYXdhaXQgdGhpcy5hcHBseVJlc291cmNlU3luYyh7b25SZWNvcmQsIHJlc291cmNlcywgc3luY30pXG4gIH1cblxuICAvKipcbiAgICogQXBwbGllcyBvbmUgc3luYyByb3cgdXNpbmcgZGVjbGFyYXRpdmUgcmVzb3VyY2UgcG9saWN5LlxuICAgKiBAcGFyYW0ge3tyZXNvdXJjZXM6IFJlY29yZDxzdHJpbmcsIFN5bmNSZXNvdXJjZUNvbmZpZz4sIHN5bmM6IFN5bmNDaGFuZ2VFbnZlbG9wZSwgb25SZWNvcmQ/OiAocmVjb3JkOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPikgPT4gKCkgPT4gdm9pZH19IGFyZ3MgLSBBcHBseSBhcmdzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxTeW5jQ2hhbmdlQXBwbHlSZXN1bHQ+fSBBcHBseSByZXN1bHQuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgYXBwbHlSZXNvdXJjZVN5bmMoe29uUmVjb3JkLCByZXNvdXJjZXMsIHN5bmN9KSB7XG4gICAgY29uc3QgcmVzb3VyY2VUeXBlID0gc3luYy5yZXNvdXJjZVR5cGUoKVxuICAgIGNvbnN0IHJlc291cmNlID0gcmVzb3VyY2VUeXBlID8gcmVzb3VyY2VzW3Jlc291cmNlVHlwZV0gOiB1bmRlZmluZWRcblxuICAgIGlmICghcmVzb3VyY2UgfHwgIXJlc291cmNlLmVuYWJsZWQpIHJldHVybiB7Y2hhbmdlZDogZmFsc2UsIHJlc291cmNlVHlwZX1cblxuICAgIGlmIChzeW5jLnN5bmNUeXBlKCkgPT09IFwiZGVsZXRlXCIpIHtcbiAgICAgIHJldHVybiB7Y2hhbmdlZDogYXdhaXQgdGhpcy5kZXN0cm95U3luY2VkUmVzb3VyY2Uoe29uUmVjb3JkLCByZXNvdXJjZSwgc3luY30pLCByZXNvdXJjZVR5cGV9XG4gICAgfVxuXG4gICAgY29uc3QgZGF0YSA9IHRoaXMuc3luY0RhdGEoc3luYylcbiAgICBjb25zdCByZWNvcmQgPSByZXNvdXJjZS5maW5kUmVjb3JkID8gYXdhaXQgcmVzb3VyY2UuZmluZFJlY29yZCh7ZGF0YSwgcmVzb3VyY2VJZDogc3luYy5yZXNvdXJjZUlkKCksIHN5bmN9KSA6IGF3YWl0IHJlc291cmNlLm1vZGVsQ2xhc3MuZmluZE9ySW5pdGlhbGl6ZUJ5KHtpZDogZGF0YS5pZCA/PyBzeW5jLnJlc291cmNlSWQoKX0pXG4gICAgY29uc3QgYXR0cmlidXRlcyA9IGF3YWl0IHJlc291cmNlLmF0dHJpYnV0ZXMoe2RhdGEsIHJlY29yZCwgc3luY30pXG4gICAgY29uc3QgcmVsZWFzZVJlY29yZCA9IG9uUmVjb3JkID8gb25SZWNvcmQocmVjb3JkKSA6IG51bGxcbiAgICBsZXQgY2hhbmdlZCA9IGZhbHNlXG5cbiAgICB0cnkge1xuICAgICAgcmVjb3JkLmFzc2lnbihhdHRyaWJ1dGVzKVxuXG4gICAgICBpZiAocmVjb3JkLmlzQ2hhbmdlZCgpKSB7XG4gICAgICAgIGF3YWl0IHJlY29yZC5zYXZlKClcbiAgICAgICAgY2hhbmdlZCA9IHRydWVcbiAgICAgIH1cblxuICAgICAgaWYgKHJlc291cmNlLmFmdGVyQXBwbHkpIHtcbiAgICAgICAgY29uc3QgaG9va0NoYW5nZWQgPSBhd2FpdCByZXNvdXJjZS5hZnRlckFwcGx5KHthdHRyaWJ1dGVzLCBkYXRhLCByZWNvcmQsIHN5bmN9KVxuXG4gICAgICAgIGNoYW5nZWQgfHw9IGhvb2tDaGFuZ2VkID09PSB0cnVlXG4gICAgICB9XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGlmIChyZWxlYXNlUmVjb3JkKSByZWxlYXNlUmVjb3JkKClcbiAgICB9XG5cbiAgICByZXR1cm4ge2NoYW5nZWQsIHJlc291cmNlVHlwZX1cbiAgfVxuXG4gIC8qKlxuICAgKiBEZXN0cm95cyBhIHN5bmNlZCByZXNvdXJjZSB2aWEgaXRzIGRlY2xhcmVkIG1vZGVsIHBvbGljeS5cbiAgICogQHBhcmFtIHt7cmVzb3VyY2U6IFN5bmNSZXNvdXJjZUNvbmZpZywgc3luYzogU3luY0NoYW5nZUVudmVsb3BlLCBvblJlY29yZD86IChyZWNvcmQ6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+KSA9PiAoKSA9PiB2b2lkfX0gYXJncyAtIERlc3Ryb3kgYXJncy5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IFdoZXRoZXIgYSBsb2NhbCByb3cgd2FzIGRlc3Ryb3llZC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBkZXN0cm95U3luY2VkUmVzb3VyY2Uoe29uUmVjb3JkLCByZXNvdXJjZSwgc3luY30pIHtcbiAgICBjb25zdCBpZCA9IHN5bmMucmVzb3VyY2VJZCgpXG4gICAgY29uc3QgcmVjb3JkID0gcmVzb3VyY2UuZmluZFJlY29yZEZvckRlbGV0ZSA/IGF3YWl0IHJlc291cmNlLmZpbmRSZWNvcmRGb3JEZWxldGUoe3Jlc291cmNlSWQ6IGlkLCBzeW5jfSkgOiBhd2FpdCByZXNvdXJjZS5tb2RlbENsYXNzLmZpbmRCeSh7aWR9KVxuXG4gICAgaWYgKCFyZWNvcmQpIHJldHVybiBmYWxzZVxuXG4gICAgY29uc3QgcmVsZWFzZVJlY29yZCA9IG9uUmVjb3JkID8gb25SZWNvcmQocmVjb3JkKSA6IG51bGxcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCByZWNvcmQuZGVzdHJveSgpXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGlmIChyZWxlYXNlUmVjb3JkKSByZWxlYXNlUmVjb3JkKClcbiAgICB9XG5cbiAgICByZXR1cm4gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFBhcnNlcyB0aGUgZW1iZWRkZWQgc3luYyBkYXRhIEpTT04vb2JqZWN0LlxuICAgKiBAcGFyYW0ge1N5bmNDaGFuZ2VFbnZlbG9wZX0gc3luYyAtIFN5bmMgcm93LlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59IFN5bmMgZGF0YSBvYmplY3QuXG4gICAqL1xuICBzdGF0aWMgc3luY0RhdGEoc3luYykge1xuICAgIGNvbnN0IGRhdGEgPSBzeW5jLmRhdGEoKVxuXG4gICAgaWYgKCFkYXRhKSB0aHJvdyBuZXcgRXJyb3IoYFN5bmMgJHtzeW5jLmlkKCl9IGlzIG1pc3NpbmcgZGF0YWApXG4gICAgaWYgKHR5cGVvZiBkYXRhID09PSBcInN0cmluZ1wiKSByZXR1cm4gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn0gKi8gKEpTT04ucGFyc2UoZGF0YSkpXG4gICAgaWYgKHR5cGVvZiBkYXRhID09PSBcIm9iamVjdFwiICYmICFBcnJheS5pc0FycmF5KGRhdGEpKSByZXR1cm4gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn0gKi8gKGRhdGEpXG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoYFN5bmMgJHtzeW5jLmlkKCl9IGhhcyBpbnZhbGlkIGRhdGFgKVxuICB9XG5cbiAgLyoqXG4gICAqIERyYWlucyBwZW5kaW5nIHN5bmMgcmVjb3JkcyBmcm9tIGEgbG9jYWwgVmVsb2Npb3VzIG1vZGVsIGluIHN0YWJsZSBvcmRlci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBSZXBsYXkgYXJncy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuYXV0aGVudGljYXRpb25Ub2tlbiAtIEF1dGggdG9rZW4gdG8gc2VuZCB3aXRoIHJlcGxheSByZXF1ZXN0cy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmJhdGNoU2l6ZV0gLSBNYXggc3luY3MgcGVyIHJlcXVlc3QuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3Muc3luY01vZGVsIC0gTG9jYWwgU3luYyBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHsocGF5bG9hZDoge2F1dGhlbnRpY2F0aW9uVG9rZW46IHN0cmluZywgc3luY3M6IEFycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59LCBvcHRpb25zPzoge3NpZ25hbD86IEFib3J0U2lnbmFsfSkgPT4gUHJvbWlzZTxTeW5jUmVwbGF5UmVzcG9uc2U+fSBhcmdzLnBvc3RSZXBsYXkgLSBSZXBsYXkgcG9zdGVyLlxuICAgKiBAcGFyYW0ge0Fib3J0U2lnbmFsfSBbYXJncy5zaWduYWxdIC0gTGlmZWN5Y2xlIGNhbmNlbGxhdGlvbiBzaWduYWwuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHJlcGxheUxvY2FsU3luY3MoYXJncykge1xuICAgIGNvbnN0IHBvc3RlZFNuYXBzaG90c0J5U3luY0lkID0gbmV3IE1hcCgpXG5cbiAgICBhd2FpdCB0aGlzLnJlcGxheVBlbmRpbmcoe1xuICAgICAgYXV0aGVudGljYXRpb25Ub2tlbjogYXJncy5hdXRoZW50aWNhdGlvblRva2VuLFxuICAgICAgYmF0Y2hTaXplOiBhcmdzLmJhdGNoU2l6ZSxcbiAgICAgIG1hcmtTdWNjZXNzZnVsOiBhc3luYyAoc3luYykgPT4ge1xuICAgICAgICBjb25zdCBzeW5jSWQgPSAoLyoqIEB0eXBlIHt7aWQ6ICgpID0+IHN0cmluZyB8IG51bWJlciB8IG51bGwgfCB1bmRlZmluZWR9fSAqLyAoc3luYykpLmlkKClcbiAgICAgICAgLy8gUmVsb2FkIHdpdGggdGhlIHJlc291cmNlIHByZWxvYWRlZCBzbyByb3dzIHJlbHlpbmcgb24gdGhlIHJlc291cmNlLWF0dHJpYnV0ZXNcbiAgICAgICAgLy8gZmFsbGJhY2sgaW4gbG9jYWxTeW5jRGF0YSBjb21wYXJlIGFnYWluc3QgdGhlIHNhbWUgc25hcHNob3QgdGhleSBwb3N0ZWQuXG4gICAgICAgIGNvbnN0IGN1cnJlbnRTeW5jID0gYXdhaXQgYXJncy5zeW5jTW9kZWwucHJlbG9hZCh7cmVzb3VyY2U6IHRydWV9KS53aGVyZSh7aWQ6IHN5bmNJZH0pLmZpcnN0KClcblxuICAgICAgICBpZiAoIWN1cnJlbnRTeW5jKSByZXR1cm5cbiAgICAgICAgLy8gQSByb3cgZWRpdGVkIHdoaWxlIGl0cyBvbGQgcGF5bG9hZCB3YXMgaW4gZmxpZ2h0IHN0YXlzIHBlbmRpbmcsIHNvIHRoZVxuICAgICAgICAvLyBuZXdlciBsb2NhbCBjaGFuZ2UgcmVwbGF5cyBvbiB0aGUgbmV4dCBkcmFpbiBpbnN0ZWFkIG9mIGJlaW5nIGxvc3QuXG4gICAgICAgIGlmICh0aGlzLmxvY2FsU3luY1JlcGxheVNuYXBzaG90KGN1cnJlbnRTeW5jKSAhPT0gcG9zdGVkU25hcHNob3RzQnlTeW5jSWQuZ2V0KFN0cmluZyhzeW5jSWQpKSkgcmV0dXJuXG5cbiAgICAgICAgYXdhaXQgY3VycmVudFN5bmMudXBkYXRlKHtzdGF0ZTogXCJzdWNjZXNzXCJ9KVxuICAgICAgfSxcbiAgICAgIHBlbmRpbmdTeW5jczogYXN5bmMgKCkgPT4gYXdhaXQgYXJncy5zeW5jTW9kZWwucHJlbG9hZCh7cmVzb3VyY2U6IHRydWV9KS53aGVyZSh7c3RhdGU6IFwicGVuZGluZ1wifSkub3JkZXIoXCJjcmVhdGVkX2F0XCIpLnRvQXJyYXkoKSxcbiAgICAgIHBvc3RSZXBsYXk6IGFyZ3MucG9zdFJlcGxheSxcbiAgICAgIHNpZ25hbDogYXJncy5zaWduYWwsXG4gICAgICBzeW5jSWQ6IChzeW5jKSA9PiAoLyoqIEB0eXBlIHt7aWQ6ICgpID0+IHN0cmluZyB8IG51bWJlciB8IG51bGwgfCB1bmRlZmluZWR9fSAqLyAoc3luYykpLmlkKCksXG4gICAgICBzeW5jUGF5bG9hZDogKHN5bmMpID0+IHtcbiAgICAgICAgcG9zdGVkU25hcHNob3RzQnlTeW5jSWQuc2V0KFN0cmluZygoLyoqIEB0eXBlIHt7aWQ6ICgpID0+IHN0cmluZyB8IG51bWJlciB8IG51bGwgfCB1bmRlZmluZWR9fSAqLyAoc3luYykpLmlkKCkpLCB0aGlzLmxvY2FsU3luY1JlcGxheVNuYXBzaG90KHN5bmMpKVxuXG4gICAgICAgIHJldHVybiB0aGlzLmxvY2FsU3luY1BheWxvYWQoc3luYylcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFNlcmlhbGl6ZXMgdGhlIHJlcGxheS1yZWxldmFudCBzdGF0ZSBvZiBhIGxvY2FsIHN5bmMgcm93IGZvciBpbi1mbGlnaHQgY29tcGFyaXNvbnMuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHN5bmMgLSBMb2NhbCBzeW5jIHJvdy5cbiAgICogQHJldHVybnMge3N0cmluZ30gU3RhYmxlIHNuYXBzaG90IG9mIHRoZSByb3cncyByZXBsYXllZCBwYXlsb2FkLlxuICAgKi9cbiAgc3RhdGljIGxvY2FsU3luY1JlcGxheVNuYXBzaG90KHN5bmMpIHtcbiAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkoe2RhdGE6IHRoaXMubG9jYWxTeW5jRGF0YShzeW5jKSwgc3luY1R5cGU6IHN5bmMuc3luY1R5cGUoKX0pXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIG9uZSByZXBsYXkgZW52ZWxvcGUgZnJvbSBhIGxvY2FsIHN5bmMgcm93LlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBzeW5jIC0gTG9jYWwgc3luYyByb3cuXG4gICAqIEByZXR1cm5zIHt7Y2xpZW50VXBkYXRlZEF0Pzogc3RyaW5nLCBkYXRhOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiwgaWQ6IG51bWJlciwgcmVzb3VyY2VJZDogc3RyaW5nLCByZXNvdXJjZVR5cGU6IHN0cmluZywgc3luY1R5cGU6IHN0cmluZ319IFN5bmMgcmVwbGF5IGVudmVsb3BlLlxuICAgKi9cbiAgc3RhdGljIGxvY2FsU3luY1BheWxvYWQoc3luYykge1xuICAgIGNvbnN0IGNsaWVudFVwZGF0ZWRBdCA9IHN5bmMudXBkYXRlZEF0KCkgfHwgc3luYy5jcmVhdGVkQXQoKVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGNsaWVudFVwZGF0ZWRBdDogY2xpZW50VXBkYXRlZEF0ID8gY2xpZW50VXBkYXRlZEF0LnRvSVNPU3RyaW5nKCkgOiB1bmRlZmluZWQsXG4gICAgICBkYXRhOiB0aGlzLmxvY2FsU3luY0RhdGEoc3luYyksXG4gICAgICBpZDogLyoqIEB0eXBlIHtudW1iZXJ9ICovICgvKiogQHR5cGUge3Vua25vd259ICovIChzeW5jLmlkKCkpKSxcbiAgICAgIHJlc291cmNlSWQ6IFN0cmluZyhzeW5jLnJlc291cmNlSWQoKSksXG4gICAgICByZXNvdXJjZVR5cGU6IHN5bmMucmVzb3VyY2VUeXBlKCkgfHwgXCJcIixcbiAgICAgIHN5bmNUeXBlOiBzeW5jLnN5bmNUeXBlKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgb25lIGxvY2FsIHN5bmMgcm93IHBheWxvYWQsIGZhbGxpbmcgYmFjayB0byBwcmVsb2FkZWQgcmVzb3VyY2UgYXR0cmlidXRlcy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gc3luYyAtIExvY2FsIHN5bmMgcm93LlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59IFN5bmMgZGF0YS5cbiAgICovXG4gIHN0YXRpYyBsb2NhbFN5bmNEYXRhKHN5bmMpIHtcbiAgICBsZXQgc3luY0RhdGEgPSAvKiogQHR5cGUge3N0cmluZyB8IFJlY29yZDxzdHJpbmcsIHVua25vd24+fSAqLyAoc3luYy5kYXRhKCkgfHwge30pXG5cbiAgICBpZiAodHlwZW9mIHN5bmNEYXRhID09PSBcInN0cmluZ1wiKSB7XG4gICAgICB0cnkge1xuICAgICAgICBzeW5jRGF0YSA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59ICovIChKU09OLnBhcnNlKHN5bmNEYXRhKSlcbiAgICAgIH0gY2F0Y2ggKF9lcnJvcikge1xuICAgICAgICBzeW5jRGF0YSA9IHt9XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKE9iamVjdC5rZXlzKHN5bmNEYXRhKS5sZW5ndGggPiAwKSByZXR1cm4gc3luY0RhdGFcblxuICAgIHRyeSB7XG4gICAgICByZXR1cm4gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn0gKi8gKHN5bmMucmVzb3VyY2UoKS5hdHRyaWJ1dGVzKCkpXG4gICAgfSBjYXRjaCAoX2Vycm9yKSB7XG4gICAgICByZXR1cm4ge31cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUXVldWVzIGEgbG9jYWwgc3luYyByb3cgZm9yIGEgVmVsb2Npb3VzIG1vZGVsIHJlc291cmNlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFF1ZXVlIGFyZ3MuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MucmVzb3VyY2UgLSBSZXNvdXJjZSBiZWluZyBzeW5jZWQuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3Muc3luY01vZGVsIC0gTG9jYWwgU3luYyBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn0gW2FyZ3MuZGF0YV0gLSBFeHBsaWNpdCBzeW5jIGRhdGEuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5zeW5jVHlwZV0gLSBTeW5jIG9wZXJhdGlvbiB0eXBlLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBbYXJncy5sb2NhbE9ubHlBdHRyaWJ1dGVzXSAtIEF0dHJpYnV0ZXMgdG8gc3RyaXAgZnJvbSBxdWV1ZWQgcGF5bG9hZHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IFthcmdzLmJvb2xlYW5BdHRyaWJ1dGVzXSAtIEF0dHJpYnV0ZXMgdG8gY29lcmNlIHRocm91Z2ggc3luYyBib29sZWFuIHBhcnNpbmcuXG4gICAqIEBwYXJhbSB7KGRhdGE6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KSA9PiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn0gW2FyZ3Mubm9ybWFsaXplRGF0YV0gLSBBcHAtc3BlY2lmaWMgZGF0YSBub3JtYWxpemVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IExvY2FsIHN5bmMgcm93LlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHF1ZXVlTG9jYWxTeW5jKGFyZ3MpIHtcbiAgICBjb25zdCByZXNvdXJjZVJlY29yZElkID0gc2NhbGFyTW9kZWxQcmltYXJ5S2V5VmFsdWUoYXJncy5yZXNvdXJjZS5pZCgpLCBcIkxvY2FsIHN5bmMgcXVldWVpbmdcIilcbiAgICBjb25zdCBtb2RlbENsYXNzID0gYXJncy5yZXNvdXJjZS5jb25zdHJ1Y3RvclxuXG4gICAgaWYgKHR5cGVvZiBtb2RlbENsYXNzLmdldE1vZGVsTmFtZSAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJUaGUgcmVzb3VyY2UgbW9kZWwgY2xhc3MgbXVzdCBpbXBsZW1lbnQgc3RhdGljIGdldE1vZGVsTmFtZSgpIHRvIHF1ZXVlIHN5bmMgZGF0YSAtIGNsYXNzIG5hbWVzIGFyZSBub3Qgc3RhYmxlIGFjcm9zcyBleHBsaWNpdCBtb2RlbCBuYW1lcyBhbmQgbWluaWZpZWQgYnVuZGxlc1wiKVxuICAgIH1cblxuICAgIGNvbnN0IHJlc291cmNlVHlwZSA9IG1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKClcbiAgICBjb25zdCBzeW5jRGF0YSA9IHRoaXMucXVldWVkU3luY0RhdGEoYXJncylcbiAgICBjb25zdCBzeW5jVHlwZSA9IGFyZ3Muc3luY1R5cGUgfHwgXCJ1cGRhdGVcIlxuXG4gICAgaWYgKCFyZXNvdXJjZVJlY29yZElkKSB0aHJvdyBuZXcgRXJyb3IoXCJyZXNvdXJjZS5pZCgpIGlzIHJlcXVpcmVkIHRvIHF1ZXVlIHN5bmMgZGF0YVwiKVxuXG4gICAgY29uc3QgcmVzb3VyY2VJZCA9IFN0cmluZyhyZXNvdXJjZVJlY29yZElkKVxuICAgIGNvbnN0IGV4aXN0aW5nU3luYyA9IGF3YWl0IGFyZ3Muc3luY01vZGVsLmZpbmRCeSh7cmVzb3VyY2VJZCwgcmVzb3VyY2VUeXBlfSlcblxuICAgIGlmIChleGlzdGluZ1N5bmMpIHtcbiAgICAgIGF3YWl0IGV4aXN0aW5nU3luYy51cGRhdGUoe1xuICAgICAgICBkYXRhOiBzeW5jRGF0YSxcbiAgICAgICAgc3RhdGU6IFwicGVuZGluZ1wiLFxuICAgICAgICBzeW5jVHlwZVxuICAgICAgfSlcblxuICAgICAgcmV0dXJuIGV4aXN0aW5nU3luY1xuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCBhcmdzLnN5bmNNb2RlbC5jcmVhdGUoe1xuICAgICAgZGF0YTogc3luY0RhdGEsXG4gICAgICByZXNvdXJjZUlkLFxuICAgICAgcmVzb3VyY2VUeXBlLFxuICAgICAgc3RhdGU6IFwicGVuZGluZ1wiLFxuICAgICAgc3luY1R5cGVcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBiYWNrZW5kLXNhZmUgcXVldWVkIHN5bmMgZGF0YSB3aXRob3V0IG11dGF0aW5nIGNhbGxlciBkYXRhLiBUaGUgZGVmYXVsdFxuICAgKiAobm8gZXhwbGljaXQgYGRhdGFgKSBpcyB0aGUgcmVzb3VyY2UncyBhdHRyaWJ1dGVzIG1pbnVzIGxvY2FsLW9ubHkgYXR0cmlidXRlcyxcbiAgICogd2l0aCBib29sZWFucyBjb2VyY2VkIGFuZCBEYXRlIHZhbHVlcyBzZXJpYWxpemVkIHRvIElTTyBzdHJpbmdzLCBzbyBhcHBzIGRvbid0XG4gICAqIG5lZWQgcGVyLW1vZGVsIHRyYWNrZWQtcGF5bG9hZCBidWlsZGVycy5cbiAgICogQHBhcmFtIHt7cmVzb3VyY2U6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBkYXRhPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4sIGxvY2FsT25seUF0dHJpYnV0ZXM/OiBzdHJpbmdbXSwgYm9vbGVhbkF0dHJpYnV0ZXM/OiBzdHJpbmdbXSwgbm9ybWFsaXplRGF0YT86IChkYXRhOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikgPT4gUmVjb3JkPHN0cmluZywgdW5rbm93bj59fSBhcmdzIC0gRGF0YSBhcmdzLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59IFF1ZXVlZCBkYXRhLlxuICAgKi9cbiAgc3RhdGljIHF1ZXVlZFN5bmNEYXRhKGFyZ3MpIHtcbiAgICBjb25zdCBpbnB1dERhdGEgPSBhcmdzLmRhdGEgPz8gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn0gKi8gKGFyZ3MucmVzb3VyY2UuYXR0cmlidXRlcygpKVxuICAgIGNvbnN0IG5vcm1hbGl6ZWREYXRhID0gYXJncy5ub3JtYWxpemVEYXRhID8gYXJncy5ub3JtYWxpemVEYXRhKGlucHV0RGF0YSkgOiBpbnB1dERhdGFcbiAgICBjb25zdCBzeW5jRGF0YSA9IHsuLi5ub3JtYWxpemVkRGF0YX1cblxuICAgIGZvciAoY29uc3QgYXR0cmlidXRlTmFtZSBvZiBhcmdzLmxvY2FsT25seUF0dHJpYnV0ZXMgfHwgW10pIGRlbGV0ZSBzeW5jRGF0YVthdHRyaWJ1dGVOYW1lXVxuICAgIGZvciAoY29uc3QgYXR0cmlidXRlTmFtZSBvZiBhcmdzLmJvb2xlYW5BdHRyaWJ1dGVzIHx8IFtdKSB7XG4gICAgICBpZiAoT2JqZWN0Lmhhc093bihzeW5jRGF0YSwgYXR0cmlidXRlTmFtZSkpIHN5bmNEYXRhW2F0dHJpYnV0ZU5hbWVdID0gdGhpcy5vcHRpb25hbEJvb2xlYW5TeW5jVmFsdWUoc3luY0RhdGFbYXR0cmlidXRlTmFtZV0sIGF0dHJpYnV0ZU5hbWUpXG4gICAgfVxuICAgIGZvciAoY29uc3QgW2F0dHJpYnV0ZU5hbWUsIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhzeW5jRGF0YSkpIHtcbiAgICAgIGlmICh2YWx1ZSBpbnN0YW5jZW9mIERhdGUpIHN5bmNEYXRhW2F0dHJpYnV0ZU5hbWVdID0gdmFsdWUudG9JU09TdHJpbmcoKVxuICAgIH1cblxuICAgIHJldHVybiBzeW5jRGF0YVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBhIHNtYWxsIGFwcC1mYWNpbmcgbG9jYWwgc3luYyBxdWV1ZSBmYWNhZGUgZnJvbSBkZWNsYXJhdGl2ZSBtb2RlbCBjb25maWcuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gUXVldWUgY29uZmlnLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLnN5bmNNb2RlbCAtIExvY2FsIFN5bmMgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnNpbmdsZUZsaWdodEtleSAtIEtleSB1c2VkIHRvIHNlcmlhbGl6ZSBiYWNrZW5kIHJlcGxheS5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPHZvaWQ+fSBhcmdzLnN5bmNQZW5kaW5nIC0gQmFja2VuZCByZXBsYXkgY2FsbGJhY2suXG4gICAqIEBwYXJhbSB7KHJlc291cmNlOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPikgPT4gc3RyaW5nW119IFthcmdzLmxvY2FsT25seUF0dHJpYnV0ZXNdIC0gUmVzb3VyY2Utc3BlY2lmaWMgbG9jYWwtb25seSBhdHRyaWJ1dGVzLlxuICAgKiBAcGFyYW0geyhyZXNvdXJjZTogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4pID0+IHN0cmluZ1tdfSBbYXJncy5ib29sZWFuQXR0cmlidXRlc10gLSBSZXNvdXJjZS1zcGVjaWZpYyBTUUxpdGUgYm9vbGVhbiBhdHRyaWJ1dGVzLlxuICAgKiBAcmV0dXJucyB7e3F1ZXVlOiAocXVldWVBcmdzOiB7cmVzb3VyY2U6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBkYXRhPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4sIHN5bmNUeXBlPzogc3RyaW5nfSkgPT4gUHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIHN5bmNQZW5kaW5nOiAoKSA9PiBQcm9taXNlPHZvaWQ+fX0gQ29uZmlndXJlZCBsb2NhbCBzeW5jIHF1ZXVlLlxuICAgKi9cbiAgc3RhdGljIGxvY2FsU3luY1F1ZXVlKGFyZ3MpIHtcbiAgICByZXR1cm4ge1xuICAgICAgcXVldWU6IGFzeW5jIChxdWV1ZUFyZ3MpID0+IGF3YWl0IHRoaXMucXVldWVMb2NhbFN5bmMoe1xuICAgICAgICAuLi5xdWV1ZUFyZ3MsXG4gICAgICAgIGJvb2xlYW5BdHRyaWJ1dGVzOiBhcmdzLmJvb2xlYW5BdHRyaWJ1dGVzID8gYXJncy5ib29sZWFuQXR0cmlidXRlcyhxdWV1ZUFyZ3MucmVzb3VyY2UpIDogW10sXG4gICAgICAgIGxvY2FsT25seUF0dHJpYnV0ZXM6IGFyZ3MubG9jYWxPbmx5QXR0cmlidXRlcyA/IGFyZ3MubG9jYWxPbmx5QXR0cmlidXRlcyhxdWV1ZUFyZ3MucmVzb3VyY2UpIDogW10sXG4gICAgICAgIHN5bmNNb2RlbDogYXJncy5zeW5jTW9kZWxcbiAgICAgIH0pLFxuICAgICAgc3luY1BlbmRpbmc6IGFzeW5jICgpID0+IGF3YWl0IHRoaXMuc2luZ2xlRmxpZ2h0KGFyZ3Muc2luZ2xlRmxpZ2h0S2V5LCBhcmdzLnN5bmNQZW5kaW5nKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBQYXJzZXMgYm9vbGVhbnMgY29tbW9ubHkgdXNlZCBieSBTUUxpdGUvb2ZmbGluZSBzeW5jIHBheWxvYWRzLlxuICAgKiBAcGFyYW0ge3Vua25vd259IHZhbHVlIC0gU3luYyBkZWNpc2lvbiB2YWx1ZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFtkZXNjcmlwdGlvbl0gLSBFcnJvciBjb250ZXh0LlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbiB8IG51bGx9IFBhcnNlZCBib29sZWFuLWxpa2UgYmFja2VuZC9sb2NhbCB2YWx1ZS5cbiAgICovXG4gIHN0YXRpYyBvcHRpb25hbEJvb2xlYW5TeW5jVmFsdWUodmFsdWUsIGRlc2NyaXB0aW9uID0gXCJzeW5jIGJvb2xlYW5cIikge1xuICAgIGlmICh2YWx1ZSA9PSBudWxsKSByZXR1cm4gbnVsbFxuICAgIGlmICh2YWx1ZSA9PT0gMSkgcmV0dXJuIHRydWVcbiAgICBpZiAodmFsdWUgPT09IDApIHJldHVybiBmYWxzZVxuXG4gICAgcmV0dXJuIG9wdGlvbmFsQm9vbGVhbih2YWx1ZSwgZGVzY3JpcHRpb24pXG4gIH1cblxuICAvKipcbiAgICogQ29udmVydHMgYSBib29sZWFuIHN5bmMgdmFsdWUgdG8gU1FMaXRlIGJvb2xlYW4gc3RvcmFnZS5cbiAgICogQHBhcmFtIHtib29sZWFuIHwgbnVsbH0gdmFsdWUgLSBTeW5jIGJvb2xlYW4gdmFsdWUuXG4gICAqIEByZXR1cm5zIHswIHwgMX0gU1FMaXRlLWNvbXBhdGlibGUgYm9vbGVhbiB2YWx1ZS5cbiAgICovXG4gIHN0YXRpYyBzcWxpdGVCb29sZWFuU3luY1ZhbHVlKHZhbHVlKSB7XG4gICAgcmV0dXJuIHZhbHVlID09PSB0cnVlID8gMSA6IDBcbiAgfVxuXG4gIC8qKlxuICAgKiBQcm9qZWN0cyBnZW5lcmljIHN5bmMgY291bnRlcnMgaW50byBhcHAtc3BlY2lmaWMgcmVzdWx0IGtleXMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gUmVzdWx0IGFyZ3MuXG4gICAqIEBwYXJhbSB7U3luY0NoYW5nZXNSZXN1bHR9IGFyZ3MucmVzdWx0IC0gR2VuZXJpYyBWZWxvY2lvdXMgc3luYyByZXN1bHQuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywge2NoYW5nZWRLZXk6IHN0cmluZywgY291bnRLZXk6IHN0cmluZ30+fSBhcmdzLnJlc291cmNlcyAtIFJlc291cmNlIHJlc3VsdCBrZXkgbWFwLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59IFByb2plY3RlZCByZXN1bHQuXG4gICAqL1xuICBzdGF0aWMgc3luY1Jlc3VsdEZvclJlc291cmNlcyh7cmVzdWx0LCByZXNvdXJjZXN9KSB7XG4gICAgY29uc3Qgc3luY1Jlc3VsdCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59ICovICh7XG4gICAgICBjaGFuZ2VkOiByZXN1bHQuY2hhbmdlZCxcbiAgICAgIHBhZ2VzOiByZXN1bHQucGFnZXMsXG4gICAgICBzeW5jZWRDb3VudDogcmVzdWx0LnN5bmNlZENvdW50XG4gICAgfSlcblxuICAgIGZvciAoY29uc3QgW3Jlc291cmNlVHlwZSwga2V5c10gb2YgT2JqZWN0LmVudHJpZXMocmVzb3VyY2VzKSkge1xuICAgICAgc3luY1Jlc3VsdFtrZXlzLmNvdW50S2V5XSA9IHJlc3VsdC5yZXNvdXJjZUNvdW50c1tyZXNvdXJjZVR5cGVdIHx8IDBcbiAgICAgIHN5bmNSZXN1bHRba2V5cy5jaGFuZ2VkS2V5XSA9IHJlc3VsdC5yZXNvdXJjZUNoYW5nZWRbcmVzb3VyY2VUeXBlXSB8fCBmYWxzZVxuICAgIH1cblxuICAgIHJldHVybiBzeW5jUmVzdWx0XG4gIH1cblxuICAvKipcbiAgICogRHJhaW5zIHBlbmRpbmcgc3luYyByZWNvcmRzIGluIHN0YWJsZSBvcmRlciBhbmQgbWFya3MgYWNrbm93bGVkZ2VkIHJvd3MuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gUmVwbGF5IGFyZ3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmF1dGhlbnRpY2F0aW9uVG9rZW4gLSBBdXRoIHRva2VuIHRvIHNlbmQgd2l0aCByZXBsYXkgcmVxdWVzdHMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5iYXRjaFNpemVdIC0gTWF4IHN5bmNzIHBlciByZXF1ZXN0LiBEZWZhdWx0cyB0byAxMDAuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxBcnJheTx1bmtub3duPj59IGFyZ3MucGVuZGluZ1N5bmNzIC0gTG9hZHMgcGVuZGluZyBsb2NhbCBzeW5jIHJvd3MgaW4gcmVwbGF5IG9yZGVyLlxuICAgKiBAcGFyYW0geyhzeW5jOiB1bmtub3duKSA9PiBzdHJpbmcgfCBudW1iZXIgfCBudWxsIHwgdW5kZWZpbmVkfSBhcmdzLnN5bmNJZCAtIFJldHVybnMgdGhlIGxvY2FsIHN5bmMgaWQuXG4gICAqIEBwYXJhbSB7KHN5bmM6IHVua25vd24pID0+IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5zeW5jUGF5bG9hZCAtIEJ1aWxkcyB0aGUgQVBJIHN5bmMgZW52ZWxvcGUuXG4gICAqIEBwYXJhbSB7KHBheWxvYWQ6IHthdXRoZW50aWNhdGlvblRva2VuOiBzdHJpbmcsIHN5bmNzOiBBcnJheTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSwgb3B0aW9ucz86IHtzaWduYWw/OiBBYm9ydFNpZ25hbH0pID0+IFByb21pc2U8U3luY1JlcGxheVJlc3BvbnNlPn0gYXJncy5wb3N0UmVwbGF5IC0gUG9zdHMgb25lIHJlcGxheSByZXF1ZXN0LlxuICAgKiBAcGFyYW0geyhzeW5jOiB1bmtub3duLCByZXNwb25zZTogU3luY1JlcGxheUl0ZW0pID0+IFByb21pc2U8dm9pZD59IGFyZ3MubWFya1N1Y2Nlc3NmdWwgLSBNYXJrcyBvbmUgc3luYyBhcyBzdWNjZXNzZnVsIGxvY2FsbHkuXG4gICAqIEBwYXJhbSB7QWJvcnRTaWduYWx9IFthcmdzLnNpZ25hbF0gLSBMaWZlY3ljbGUgY2FuY2VsbGF0aW9uIHNpZ25hbC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIGFmdGVyIGFsbCBiYXRjaGVzIGFyZSByZXBsYXllZC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyByZXBsYXlQZW5kaW5nKGFyZ3MpIHtcbiAgICB0aHJvd0lmU3luY0Fib3J0ZWQoYXJncy5zaWduYWwpXG4gICAgY29uc3QgcGVuZGluZ1N5bmNzID0gYXdhaXQgYXJncy5wZW5kaW5nU3luY3MoKVxuICAgIHRocm93SWZTeW5jQWJvcnRlZChhcmdzLnNpZ25hbClcbiAgICBjb25zdCBiYXRjaFNpemUgPSB0aGlzLm5vcm1hbGl6ZWRCYXRjaFNpemUoYXJncy5iYXRjaFNpemUpXG5cbiAgICBmb3IgKGxldCBvZmZzZXQgPSAwOyBvZmZzZXQgPCBwZW5kaW5nU3luY3MubGVuZ3RoOyBvZmZzZXQgKz0gYmF0Y2hTaXplKSB7XG4gICAgICB0aHJvd0lmU3luY0Fib3J0ZWQoYXJncy5zaWduYWwpXG4gICAgICBhd2FpdCB0aGlzLnJlcGxheUJhdGNoKHsuLi5hcmdzLCBwZW5kaW5nU3luY3M6IHBlbmRpbmdTeW5jcy5zbGljZShvZmZzZXQsIG9mZnNldCArIGJhdGNoU2l6ZSl9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXBsYXlzIG9uZSBiYXRjaCBvZiBzeW5jcy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBSZXBsYXkgYXJncy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuYXV0aGVudGljYXRpb25Ub2tlbiAtIEF1dGggdG9rZW4uXG4gICAqIEBwYXJhbSB7QXJyYXk8dW5rbm93bj59IGFyZ3MucGVuZGluZ1N5bmNzIC0gQmF0Y2ggc3luY3MuXG4gICAqIEBwYXJhbSB7KHN5bmM6IHVua25vd24pID0+IHN0cmluZyB8IG51bWJlciB8IG51bGwgfCB1bmRlZmluZWR9IGFyZ3Muc3luY0lkIC0gU3luYyBpZCBnZXR0ZXIuXG4gICAqIEBwYXJhbSB7KHN5bmM6IHVua25vd24pID0+IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5zeW5jUGF5bG9hZCAtIFBheWxvYWQgYnVpbGRlci5cbiAgICogQHBhcmFtIHsocGF5bG9hZDoge2F1dGhlbnRpY2F0aW9uVG9rZW46IHN0cmluZywgc3luY3M6IEFycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59LCBvcHRpb25zPzoge3NpZ25hbD86IEFib3J0U2lnbmFsfSkgPT4gUHJvbWlzZTxTeW5jUmVwbGF5UmVzcG9uc2U+fSBhcmdzLnBvc3RSZXBsYXkgLSBSZXBsYXkgcG9zdGVyLlxuICAgKiBAcGFyYW0geyhzeW5jOiB1bmtub3duLCByZXNwb25zZTogU3luY1JlcGxheUl0ZW0pID0+IFByb21pc2U8dm9pZD59IGFyZ3MubWFya1N1Y2Nlc3NmdWwgLSBTdWNjZXNzIGhvb2suXG4gICAqIEBwYXJhbSB7QWJvcnRTaWduYWx9IFthcmdzLnNpZ25hbF0gLSBMaWZlY3ljbGUgY2FuY2VsbGF0aW9uIHNpZ25hbC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIGFmdGVyIHRoZSBiYXRjaCBpcyBhY2tub3dsZWRnZWQuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgcmVwbGF5QmF0Y2goYXJncykge1xuICAgIGNvbnN0IHthdXRoZW50aWNhdGlvblRva2VuLCBtYXJrU3VjY2Vzc2Z1bCwgcGVuZGluZ1N5bmNzLCBwb3N0UmVwbGF5LCBzaWduYWwsIHN5bmNJZCwgc3luY1BheWxvYWR9ID0gYXJnc1xuXG4gICAgaWYgKHBlbmRpbmdTeW5jcy5sZW5ndGggPT09IDApIHJldHVyblxuICAgIHRocm93SWZTeW5jQWJvcnRlZChzaWduYWwpXG5cbiAgICBjb25zdCBzeW5jc0J5SWQgPSBuZXcgTWFwKClcblxuICAgIGZvciAoY29uc3Qgc3luYyBvZiBwZW5kaW5nU3luY3MpIHtcbiAgICAgIGNvbnN0IGlkID0gc3luY0lkKHN5bmMpXG5cbiAgICAgIGlmIChpZCAhPT0gdW5kZWZpbmVkICYmIGlkICE9PSBudWxsKSBzeW5jc0J5SWQuc2V0KFN0cmluZyhpZCksIHN5bmMpXG4gICAgfVxuXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBwb3N0UmVwbGF5KHtcbiAgICAgIGF1dGhlbnRpY2F0aW9uVG9rZW4sXG4gICAgICBzeW5jczogcGVuZGluZ1N5bmNzLm1hcCgoc3luYykgPT4gc3luY1BheWxvYWQoc3luYykpXG4gICAgfSwge3NpZ25hbH0pXG5cbiAgICB0aHJvd0lmU3luY0Fib3J0ZWQoc2lnbmFsKVxuICAgIHRoaXMuZW5zdXJlU3VjY2Vzc2Z1bFJlc3BvbnNlKHJlc3BvbnNlKVxuXG4gICAgZm9yIChjb25zdCBzeW5jUmVzcG9uc2Ugb2YgcmVzcG9uc2Uuc3luY3MgfHwgW10pIHtcbiAgICAgIHRocm93SWZTeW5jQWJvcnRlZChzaWduYWwpXG4gICAgICBjb25zdCBzeW5jID0gc3luY3NCeUlkLmdldChTdHJpbmcoc3luY1Jlc3BvbnNlLmlkKSlcblxuICAgICAgaWYgKCFzeW5jKSBjb250aW51ZVxuICAgICAgaWYgKHN5bmNSZXNwb25zZS5zeW5jU3RhdGUgIT09IFwic3VjY2Vzc2Z1bFwiKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBzeW5jIHN0YXRlIHJldHVybmVkIGZvciBzeW5jICR7U3RyaW5nKHN5bmNSZXNwb25zZS5pZCl9OiAke1N0cmluZyhzeW5jUmVzcG9uc2Uuc3luY1N0YXRlKX1gKVxuICAgICAgfVxuXG4gICAgICBhd2FpdCBtYXJrU3VjY2Vzc2Z1bChzeW5jLCBzeW5jUmVzcG9uc2UpXG4gICAgICB0aHJvd0lmU3luY0Fib3J0ZWQoc2lnbmFsKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVja3MgQVBJIHJlc3BvbnNlIHN0YXR1cyBhbmQgc2hhcGUuXG4gICAqIEBwYXJhbSB7U3luY1JlcGxheVJlc3BvbnNlfSByZXNwb25zZSAtIFJlcGxheSByZXNwb25zZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGF0aWMgZW5zdXJlU3VjY2Vzc2Z1bFJlc3BvbnNlKHJlc3BvbnNlKSB7XG4gICAgaWYgKHJlc3BvbnNlLnN0YXR1cyA9PT0gXCJlcnJvclwiKSB0aHJvdyBuZXcgRXJyb3IocmVzcG9uc2UuZXJyb3JNZXNzYWdlIHx8IFwiU3luYyBmYWlsZWRcIilcbiAgICBpZiAoIUFycmF5LmlzQXJyYXkocmVzcG9uc2Uuc3luY3MpKSB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jIHJlc3BvbnNlIG1pc3Npbmcgc3luY3NcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBOb3JtYWxpemVzIGEgcG9zaXRpdmUgYmF0Y2ggc2l6ZS5cbiAgICogQHBhcmFtIHtudW1iZXIgfCB1bmRlZmluZWR9IGJhdGNoU2l6ZSAtIEJhdGNoIHNpemUuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IFBvc2l0aXZlIGJhdGNoIHNpemUuXG4gICAqL1xuICBzdGF0aWMgbm9ybWFsaXplZEJhdGNoU2l6ZShiYXRjaFNpemUpIHtcbiAgICBpZiAodHlwZW9mIGJhdGNoU2l6ZSAhPT0gXCJudW1iZXJcIiB8fCAhTnVtYmVyLmlzRmluaXRlKGJhdGNoU2l6ZSkgfHwgYmF0Y2hTaXplIDwgMSkgcmV0dXJuIDEwMFxuXG4gICAgcmV0dXJuIE1hdGguZmxvb3IoYmF0Y2hTaXplKVxuICB9XG59XG5cbi8qKlxuICogVGhyb3dzIHRoZSBleGFjdCBhYm9ydCByZWFzb24gYXQgbGlmZWN5Y2xlIGJvdW5kYXJpZXMgc28gY2FsbGVycyBjYW5cbiAqIGRpc3Rpbmd1aXNoIGFuIGV4cGVjdGVkIGNvb3BlcmF0aXZlIHN0b3AgZnJvbSB0cmFuc3BvcnQgb3IgYXBwbHkgZmFpbHVyZXMuXG4gKiBAcGFyYW0ge0Fib3J0U2lnbmFsIHwgdW5kZWZpbmVkfSBzaWduYWwgLSBMaWZlY3ljbGUgc2lnbmFsLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIHRocm93SWZTeW5jQWJvcnRlZChzaWduYWwpIHtcbiAgaWYgKCFzaWduYWw/LmFib3J0ZWQpIHJldHVyblxuXG4gIHRocm93IHNpZ25hbC5yZWFzb24gaW5zdGFuY2VvZiBFcnJvciA/IHNpZ25hbC5yZWFzb24gOiBuZXcgRXJyb3IoXCJTeW5jIG9wZXJhdGlvbiBhYm9ydGVkXCIpXG59XG4iXX0=