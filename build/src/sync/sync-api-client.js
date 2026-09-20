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
     * @param {(args: {record: import("./local-mutation-log.js").LocalMutationLogRecord, result: SyncReplayItem}) => Promise<void>} [args.applyConflict] - Applies authoritative conflict state to the local replica before preserving the rejected intent.
     * @param {(identity: string) => number} args.remoteGeneration - Current remote generation.
     * @param {string} args.resourceType - Resource whose log records should drain.
     * @param {AbortSignal} [args.signal] - Lifecycle cancellation signal.
     * @returns {Promise<void>} Resolves when no ready intent remains.
     */
    static async replayConflictTrackedSyncs({ applyConflict, authenticationToken, batchSize, conflictTracking, postReplay, remoteGeneration, resourceType, signal }) {
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
                if (result.syncState === "conflict" && applyConflict) {
                    await applyConflict({ record: group[0], result });
                    throwIfSyncAborted(signal);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3luYy1hcGktY2xpZW50LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3N5bmMvc3luYy1hcGktY2xpZW50LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUMsZUFBZSxFQUFFLGVBQWUsRUFBQyxNQUFNLFNBQVMsQ0FBQTtBQUV4RCxPQUFPLGFBQWEsTUFBTSwrQkFBK0IsQ0FBQTtBQUN6RCxPQUFPLEVBQUMsMEJBQTBCLEVBQUMsTUFBTSwrQkFBK0IsQ0FBQTtBQUN4RSxPQUFPLEVBQUMsdUNBQXVDLEVBQUMsTUFBTSx3QkFBd0IsQ0FBQTtBQUU5RSxrR0FBa0c7QUFDbEcsNEZBQTRGO0FBQzVGLDRGQUE0RjtBQUM1Riw4RkFBOEY7QUFDOUYsMEZBQTBGO0FBQzFGLDRFQUE0RTtBQUM1RSxvRkFBb0Y7QUFDcEYsNEZBQTRGO0FBQzVGLDRGQUE0RjtBQUM1RixNQUFNLGdCQUFnQixHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7QUFFbEM7Ozs7R0FJRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8sYUFBYTtJQUNoQzs7Ozs7Ozs7Ozs7T0FXRztJQUNILE1BQU0sQ0FBQyxLQUFLLENBQUMsd0JBQXdCLENBQUMsRUFBQyxXQUFXLEVBQUUsZ0JBQWdCLEVBQUUsSUFBSSxFQUFFLFNBQVMsRUFBRSxRQUFRLEVBQUUsWUFBWSxFQUFFLFFBQVEsRUFBQztRQUN0SCxNQUFNLFVBQVUsR0FBRyxNQUFNLENBQUMsMEJBQTBCLENBQUMsUUFBUSxDQUFDLEVBQUUsRUFBRSxFQUFFLDZCQUE2QixZQUFZLEVBQUUsQ0FBQyxDQUFDLENBQUE7UUFDakgsTUFBTSxPQUFPLEdBQUcsTUFBTSxnQkFBZ0IsQ0FBQyxXQUFXLENBQUMsT0FBTyxFQUFFLENBQUE7UUFDNUQsTUFBTSxXQUFXLEdBQUcsT0FBTzthQUN4QixNQUFNLENBQUMsQ0FBQyxNQUFNLEVBQUUsRUFBRSxDQUFDLE1BQU0sQ0FBQyxRQUFRLENB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QyxNQUFNLFlBQVksS0FBSyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxJQUFJLEtBQUssQ0FBQyx3QkFBd0IsQ0FBQyxDQUFBO0FBQzVGLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHtvcHRpb25hbEJvb2xlYW4sIG9wdGlvbmFsSW50ZWdlcn0gZnJvbSBcInR5cGFuaWNcIlxuXG5pbXBvcnQgcmVjb3JkQ2hhbmdlcyBmcm9tIFwiLi4vZGF0YWJhc2UvcmVjb3JkLWNoYW5nZXMuanNcIlxuaW1wb3J0IHtzY2FsYXJNb2RlbFByaW1hcnlLZXlWYWx1ZX0gZnJvbSBcIi4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCJcbmltcG9ydCB7YXBwbHlTeW5jUmVwbGF5UmVzdWx0VG9Mb2NhbE11dGF0aW9uTG9nfSBmcm9tIFwiLi9jb25mbGljdC1zdHJhdGVneS5qc1wiXG5cbi8qKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi9zeW5jLWFwaS1jbGllbnQtdHlwZXMuanNcIikuU3luY0NoYW5nZUFwcGx5UmVzdWx0fSBTeW5jQ2hhbmdlQXBwbHlSZXN1bHQgKi9cbi8qKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi9zeW5jLWFwaS1jbGllbnQtdHlwZXMuanNcIikuU3luY0NoYW5nZUVudmVsb3BlfSBTeW5jQ2hhbmdlRW52ZWxvcGUgKi9cbi8qKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi9zeW5jLWFwaS1jbGllbnQtdHlwZXMuanNcIikuU3luY0NoYW5nZXNSZXF1ZXN0fSBTeW5jQ2hhbmdlc1JlcXVlc3QgKi9cbi8qKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi9zeW5jLWFwaS1jbGllbnQtdHlwZXMuanNcIikuU3luY0NoYW5nZXNSZXNwb25zZX0gU3luY0NoYW5nZXNSZXNwb25zZSAqL1xuLyoqIEB0eXBlZGVmIHtpbXBvcnQoXCIuL3N5bmMtYXBpLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2hhbmdlc1Jlc3VsdH0gU3luY0NoYW5nZXNSZXN1bHQgKi9cbi8qKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi9zeW5jLWFwaS1jbGllbnQtdHlwZXMuanNcIikuU3luY0N1cnNvcn0gU3luY0N1cnNvciAqL1xuLyoqIEB0eXBlZGVmIHtpbXBvcnQoXCIuL3N5bmMtYXBpLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jUmVwbGF5SXRlbX0gU3luY1JlcGxheUl0ZW0gKi9cbi8qKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi9zeW5jLWFwaS1jbGllbnQtdHlwZXMuanNcIikuU3luY1JlcGxheVJlc3BvbnNlfSBTeW5jUmVwbGF5UmVzcG9uc2UgKi9cbi8qKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi9zeW5jLWFwaS1jbGllbnQtdHlwZXMuanNcIikuU3luY1Jlc291cmNlQ29uZmlnfSBTeW5jUmVzb3VyY2VDb25maWcgKi9cbmNvbnN0IHN5bmNUYXNrUHJvbWlzZXMgPSBuZXcgTWFwKClcblxuLyoqXG4gKiBHZW5lcmljIGNsaWVudC1zaWRlIGhlbHBlciBmb3IgcmVwbGF5aW5nIHBlbmRpbmcgc3luYyBlbnZlbG9wZXMgdGhyb3VnaCB0aGVcbiAqIGZyYW1ld29yay1vd25lZCBgL3ZlbG9jaW91cy9zeW5jL3JlcGxheWAgZW5kcG9pbnQuIEFwcHMgcHJvdmlkZSBvbmx5IGxvY2FsXG4gKiBwZXJzaXN0ZW5jZS9hdXRoIGhvb2tzLlxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBTeW5jQXBpQ2xpZW50IHtcbiAgLyoqXG4gICAqIEFwcGVuZHMgb25lIGNvbmZsaWN0LXRyYWNrZWQgaW50ZW50IHRvIHRoZSBleGlzdGluZyBkdXJhYmxlIG11dGF0aW9uIGxvZy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBRdWV1ZSBhcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVtYmVyIHwgbnVsbH0gYXJncy5iYXNlVmVyc2lvbiAtIEF1dGhvcml0YXRpdmUgdmVyc2lvbiBvYnNlcnZlZCBiZWZvcmUgdGhlIGxvY2FsIG11dGF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU3luY0NsaWVudENvbmZsaWN0VHJhY2tpbmdDb25maWd9IGFyZ3MuY29uZmxpY3RUcmFja2luZyAtIER1cmFibGUgdHJhY2tpbmcgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn0gYXJncy5kYXRhIC0gQmFja2VuZC1zYWZlIG11dGF0aW9uIGF0dHJpYnV0ZXMuXG4gICAqIEBwYXJhbSB7XCJjcmVhdGVcIiB8IFwidXBkYXRlXCIgfCBcImRlc3Ryb3lcIn0gYXJncy5vcGVyYXRpb24gLSBMb2NhbCBvcGVyYXRpb24uXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MucmVzb3VyY2UgLSBMb2NhbCByZXNvdXJjZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucmVzb3VyY2VUeXBlIC0gUmVzb3VyY2UgdHlwZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc3luY1R5cGUgLSBXaXJlIG9wZXJhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi9sb2NhbC1tdXRhdGlvbi1sb2cuanNcIikuTG9jYWxNdXRhdGlvbkxvZ1JlY29yZD59IEFwcGVuZGVkIGludGVudC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBxdWV1ZUNvbmZsaWN0VHJhY2tlZFN5bmMoe2Jhc2VWZXJzaW9uLCBjb25mbGljdFRyYWNraW5nLCBkYXRhLCBvcGVyYXRpb24sIHJlc291cmNlLCByZXNvdXJjZVR5cGUsIHN5bmNUeXBlfSkge1xuICAgIGNvbnN0IHJlc291cmNlSWQgPSBTdHJpbmcoc2NhbGFyTW9kZWxQcmltYXJ5S2V5VmFsdWUocmVzb3VyY2UuaWQoKSwgYENvbmZsaWN0LXRyYWNrZWQgc3luYyBmb3IgJHtyZXNvdXJjZVR5cGV9YCkpXG4gICAgY29uc3QgcmVjb3JkcyA9IGF3YWl0IGNvbmZsaWN0VHJhY2tpbmcubXV0YXRpb25Mb2cucmVjb3JkcygpXG4gICAgY29uc3QgcHJlZGVjZXNzb3IgPSByZWNvcmRzXG4gICAgICAuZmlsdGVyKChyZWNvcmQpID0+IHJlY29yZC5tdXRhdGlvbi5tb2RlbCA9PT0gcmVzb3VyY2VUeXBlICYmIHJlY29yZC5tdXRhdGlvbi5wYXlsb2FkPy5yZXNvdXJjZUlkID09PSByZXNvdXJjZUlkKVxuICAgICAgLmF0KC0xKVxuICAgIGNvbnN0IGNsaWVudE11dGF0aW9uSWQgPSBjb25mbGljdFRyYWNraW5nLmNsaWVudE11dGF0aW9uSWQoKVxuICAgIGNvbnN0IG5vdyA9IGNvbmZsaWN0VHJhY2tpbmcubm93ID8gY29uZmxpY3RUcmFja2luZy5ub3coKSA6IG5ldyBEYXRlKClcbiAgICBjb25zdCBwcmVkZWNlc3NvclRpbWUgPSBwcmVkZWNlc3NvciA/IG5ldyBEYXRlKHByZWRlY2Vzc29yLm11dGF0aW9uLm9jY3VycmVkQXQpLmdldFRpbWUoKSA6IE51bWJlci5ORUdBVElWRV9JTkZJTklUWVxuICAgIGNvbnN0IG9jY3VycmVkQXQgPSBuZXcgRGF0ZShNYXRoLm1heChub3cuZ2V0VGltZSgpLCBwcmVkZWNlc3NvclRpbWUgKyAxKSkudG9JU09TdHJpbmcoKVxuXG4gICAgcmV0dXJuIGF3YWl0IGNvbmZsaWN0VHJhY2tpbmcubXV0YXRpb25Mb2cuYXBwZW5kKHtcbiAgICAgIGRlcGVuZGVuY2llczogcHJlZGVjZXNzb3IgPyBbe2NsaWVudE11dGF0aW9uSWQ6IHByZWRlY2Vzc29yLm11dGF0aW9uLmNsaWVudE11dGF0aW9uSWQsIG1vZGVsOiByZXNvdXJjZVR5cGV9XSA6IFtdLFxuICAgICAgbXV0YXRpb246IHtcbiAgICAgICAgYWN0b3JEZXZpY2VJZDogY29uZmxpY3RUcmFja2luZy5hY3RvckRldmljZUlkLFxuICAgICAgICBhY3RvclVzZXJJZDogY29uZmxpY3RUcmFja2luZy5hY3RvclVzZXJJZCxcbiAgICAgICAgYXR0cmlidXRlczogLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxTeW5jSnNvblZhbHVlPn0gKi8gKGRhdGEpLFxuICAgICAgICBiYXNlVmVyc2lvbixcbiAgICAgICAgY2xpZW50TXV0YXRpb25JZCxcbiAgICAgICAgbW9kZWw6IHJlc291cmNlVHlwZSxcbiAgICAgICAgb2NjdXJyZWRBdCxcbiAgICAgICAgb2ZmbGluZUdyYW50SWQ6IGNvbmZsaWN0VHJhY2tpbmcub2ZmbGluZUdyYW50SWQsXG4gICAgICAgIG9wZXJhdGlvbixcbiAgICAgICAgcGF5bG9hZDoge3Jlc291cmNlSWQsIHN5bmNUeXBlfSxcbiAgICAgICAgcG9saWN5SGFzaDogY29uZmxpY3RUcmFja2luZy5wb2xpY3lIYXNoXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBEcmFpbnMgdGhlIGV4aXN0aW5nIG11dGF0aW9uIGxvZyBpbiBwcmVkZWNlc3NvciBvcmRlci4gSW5kZXBlbmRlbnQgcmVjb3Jkc1xuICAgKiBjb250aW51ZSBhZnRlciBkdXJhYmxlIGNvbmZsaWN0cy9yZWplY3Rpb25zOyBzdWNjZXNzb3JzIHN0YXkgYmxvY2tlZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBSZXBsYXkgYXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5hdXRoZW50aWNhdGlvblRva2VuIC0gQXV0aGVudGljYXRpb24gdG9rZW4uXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5iYXRjaFNpemVdIC0gQmF0Y2ggc2l6ZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDbGllbnRDb25mbGljdFRyYWNraW5nQ29uZmlnfSBhcmdzLmNvbmZsaWN0VHJhY2tpbmcgLSBUcmFja2luZyBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0geyhwYXlsb2FkOiB7YXV0aGVudGljYXRpb25Ub2tlbjogc3RyaW5nLCBzeW5jczogQXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0sIG9wdGlvbnM/OiB7c2lnbmFsPzogQWJvcnRTaWduYWx9KSA9PiBQcm9taXNlPFN5bmNSZXBsYXlSZXNwb25zZT59IGFyZ3MucG9zdFJlcGxheSAtIFRyYW5zcG9ydCBib3VuZGFyeS5cbiAgICogQHBhcmFtIHsoYXJnczoge3JlY29yZDogaW1wb3J0KFwiLi9sb2NhbC1tdXRhdGlvbi1sb2cuanNcIikuTG9jYWxNdXRhdGlvbkxvZ1JlY29yZCwgcmVzdWx0OiBTeW5jUmVwbGF5SXRlbX0pID0+IFByb21pc2U8dm9pZD59IFthcmdzLmFwcGx5Q29uZmxpY3RdIC0gQXBwbGllcyBhdXRob3JpdGF0aXZlIGNvbmZsaWN0IHN0YXRlIHRvIHRoZSBsb2NhbCByZXBsaWNhIGJlZm9yZSBwcmVzZXJ2aW5nIHRoZSByZWplY3RlZCBpbnRlbnQuXG4gICAqIEBwYXJhbSB7KGlkZW50aXR5OiBzdHJpbmcpID0+IG51bWJlcn0gYXJncy5yZW1vdGVHZW5lcmF0aW9uIC0gQ3VycmVudCByZW1vdGUgZ2VuZXJhdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucmVzb3VyY2VUeXBlIC0gUmVzb3VyY2Ugd2hvc2UgbG9nIHJlY29yZHMgc2hvdWxkIGRyYWluLlxuICAgKiBAcGFyYW0ge0Fib3J0U2lnbmFsfSBbYXJncy5zaWduYWxdIC0gTGlmZWN5Y2xlIGNhbmNlbGxhdGlvbiBzaWduYWwuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyB3aGVuIG5vIHJlYWR5IGludGVudCByZW1haW5zLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHJlcGxheUNvbmZsaWN0VHJhY2tlZFN5bmNzKHthcHBseUNvbmZsaWN0LCBhdXRoZW50aWNhdGlvblRva2VuLCBiYXRjaFNpemUsIGNvbmZsaWN0VHJhY2tpbmcsIHBvc3RSZXBsYXksIHJlbW90ZUdlbmVyYXRpb24sIHJlc291cmNlVHlwZSwgc2lnbmFsfSkge1xuICAgIGNvbnN0IG1heEJhdGNoU2l6ZSA9IHRoaXMubm9ybWFsaXplZEJhdGNoU2l6ZShiYXRjaFNpemUpXG5cbiAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgdGhyb3dJZlN5bmNBYm9ydGVkKHNpZ25hbClcbiAgICAgIGNvbnN0IHJlY29yZHMgPSBhd2FpdCBjb25mbGljdFRyYWNraW5nLm11dGF0aW9uTG9nLnJlY29yZHMoKVxuICAgICAgdGhyb3dJZlN5bmNBYm9ydGVkKHNpZ25hbClcbiAgICAgIGNvbnN0IHN0YXR1c2VzID0gbmV3IE1hcChyZWNvcmRzLm1hcCgocmVjb3JkKSA9PiBbcmVjb3JkLm11dGF0aW9uLmNsaWVudE11dGF0aW9uSWQsIHJlY29yZC5zdGF0dXNdKSlcbiAgICAgIGNvbnN0IHBlbmRpbmcgPSByZWNvcmRzLmZpbHRlcigocmVjb3JkKSA9PiByZWNvcmQuc3RhdHVzID09PSBcInBlbmRpbmdcIiAmJiByZWNvcmQubXV0YXRpb24ubW9kZWwgPT09IHJlc291cmNlVHlwZSlcbiAgICAgIGNvbnN0IHJlYWR5ID0gcGVuZGluZy5maWx0ZXIoKHJlY29yZCkgPT4gcmVjb3JkLmRlcGVuZGVuY2llcy5ldmVyeSgoZGVwZW5kZW5jeSkgPT4gc3RhdHVzZXMuZ2V0KGRlcGVuZGVuY3kuY2xpZW50TXV0YXRpb25JZCkgPT09IFwic3luY2VkXCIpKVxuXG4gICAgICBpZiAocmVhZHkubGVuZ3RoID09PSAwKSByZXR1cm5cblxuICAgICAgY29uc3QgZ3JvdXBzID0gdGhpcy5jb25mbGljdFJlcGxheUdyb3Vwcyh7cGVuZGluZywgcmVhZHl9KS5zbGljZSgwLCBtYXhCYXRjaFNpemUpXG4gICAgICBjb25zdCBnZW5lcmF0aW9ucyA9IG5ldyBNYXAoZ3JvdXBzLm1hcCgoZ3JvdXApID0+IFtncm91cFswXS5tdXRhdGlvbi5jbGllbnRNdXRhdGlvbklkLCByZW1vdGVHZW5lcmF0aW9uKHRoaXMuY29uZmxpY3RSZWNvcmRJZGVudGl0eShncm91cFswXSkpXSkpXG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHBvc3RSZXBsYXkoe1xuICAgICAgICBhdXRoZW50aWNhdGlvblRva2VuLFxuICAgICAgICBzeW5jczogZ3JvdXBzLm1hcCgoZ3JvdXApID0+IHRoaXMuY29uZmxpY3RSZXBsYXlQYXlsb2FkKGdyb3VwKSlcbiAgICAgIH0sIHtzaWduYWx9KVxuXG4gICAgICB0aHJvd0lmU3luY0Fib3J0ZWQoc2lnbmFsKVxuICAgICAgdGhpcy5lbnN1cmVTdWNjZXNzZnVsUmVzcG9uc2UocmVzcG9uc2UpXG5cbiAgICAgIGNvbnN0IHJlc3BvbnNlc0J5SWQgPSBuZXcgTWFwKChyZXNwb25zZS5zeW5jcyB8fCBbXSkubWFwKChyZXN1bHQpID0+IFtTdHJpbmcocmVzdWx0LmlkKSwgcmVzdWx0XSkpXG5cbiAgICAgIGZvciAoY29uc3QgZ3JvdXAgb2YgZ3JvdXBzKSB7XG4gICAgICAgIHRocm93SWZTeW5jQWJvcnRlZChzaWduYWwpXG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IHJlc3BvbnNlc0J5SWQuZ2V0KGdyb3VwWzBdLm11dGF0aW9uLmNsaWVudE11dGF0aW9uSWQpXG5cbiAgICAgICAgaWYgKCFyZXN1bHQpIHRocm93IG5ldyBFcnJvcihgU3luYyByZXNwb25zZSBtaXNzaW5nIHJlc3VsdCBmb3IgbXV0YXRpb24gJHtncm91cFswXS5tdXRhdGlvbi5jbGllbnRNdXRhdGlvbklkfWApXG4gICAgICAgIGlmICghW1wic3VjY2Vzc2Z1bFwiLCBcImR1cGxpY2F0ZVwiLCBcImNvbmZsaWN0XCIsIFwiZmFpbGVkXCIsIFwicmVqZWN0ZWRcIl0uaW5jbHVkZXMocmVzdWx0LnN5bmNTdGF0ZSkpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgc3luYyBzdGF0ZSByZXR1cm5lZCBmb3IgbXV0YXRpb24gJHtncm91cFswXS5tdXRhdGlvbi5jbGllbnRNdXRhdGlvbklkfTogJHtyZXN1bHQuc3luY1N0YXRlfWApXG4gICAgICAgIH1cblxuICAgICAgICBpZiAocmVzdWx0LnN5bmNTdGF0ZSA9PT0gXCJjb25mbGljdFwiICYmIGFwcGx5Q29uZmxpY3QpIHtcbiAgICAgICAgICBhd2FpdCBhcHBseUNvbmZsaWN0KHtyZWNvcmQ6IGdyb3VwWzBdLCByZXN1bHR9KVxuICAgICAgICAgIHRocm93SWZTeW5jQWJvcnRlZChzaWduYWwpXG4gICAgICAgIH1cblxuICAgICAgICBmb3IgKGNvbnN0IHJlY29yZCBvZiBncm91cCkge1xuICAgICAgICAgIGF3YWl0IGFwcGx5U3luY1JlcGxheVJlc3VsdFRvTG9jYWxNdXRhdGlvbkxvZyh7bXV0YXRpb25Mb2c6IGNvbmZsaWN0VHJhY2tpbmcubXV0YXRpb25Mb2csIHJlY29yZCwgcmVzdWx0OiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHJlc3VsdCl9KVxuICAgICAgICAgIHRocm93SWZTeW5jQWJvcnRlZChzaWduYWwpXG4gICAgICAgIH1cblxuICAgICAgICBpZiAoW1wic3VjY2Vzc2Z1bFwiLCBcImR1cGxpY2F0ZVwiXS5pbmNsdWRlcyhyZXN1bHQuc3luY1N0YXRlKSAmJiByZXN1bHQuc2VydmVyVmVyc2lvbiAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgY29uc3QgaWRlbnRpdHkgPSB0aGlzLmNvbmZsaWN0UmVjb3JkSWRlbnRpdHkoZ3JvdXBbMF0pXG5cbiAgICAgICAgICBpZiAocmVtb3RlR2VuZXJhdGlvbihpZGVudGl0eSkgPT09IGdlbmVyYXRpb25zLmdldChncm91cFswXS5tdXRhdGlvbi5jbGllbnRNdXRhdGlvbklkKSkge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5yZWJhc2VDb25mbGljdFN1Y2Nlc3Nvcih7Y29uZmxpY3RUcmFja2luZywgcHJlZGVjZXNzb3I6IGdyb3VwW2dyb3VwLmxlbmd0aCAtIDFdLCBzZXJ2ZXJWZXJzaW9uOiByZXN1bHQuc2VydmVyVmVyc2lvbn0pXG4gICAgICAgICAgICB0aHJvd0lmU3luY0Fib3J0ZWQoc2lnbmFsKVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgc2FmZSB0cmFuc3BvcnQgZ3JvdXBzIGZyb20gcm9vdC1yZWFkeSByZWNvcmRzIGFuZCB0aGVpciBzdWNjZXNzb3JzLlxuICAgKiBAcGFyYW0ge3twZW5kaW5nOiBBcnJheTxpbXBvcnQoXCIuL2xvY2FsLW11dGF0aW9uLWxvZy5qc1wiKS5Mb2NhbE11dGF0aW9uTG9nUmVjb3JkPiwgcmVhZHk6IEFycmF5PGltcG9ydChcIi4vbG9jYWwtbXV0YXRpb24tbG9nLmpzXCIpLkxvY2FsTXV0YXRpb25Mb2dSZWNvcmQ+fX0gYXJncyAtIFBlbmRpbmcgYW5kIHJvb3QtcmVhZHkgcmVjb3Jkcy5cbiAgICogQHJldHVybnMge0FycmF5PEFycmF5PGltcG9ydChcIi4vbG9jYWwtbXV0YXRpb24tbG9nLmpzXCIpLkxvY2FsTXV0YXRpb25Mb2dSZWNvcmQ+Pn0gU2FmZSB0cmFuc3BvcnQgZ3JvdXBzLlxuICAgKi9cbiAgc3RhdGljIGNvbmZsaWN0UmVwbGF5R3JvdXBzKHtwZW5kaW5nLCByZWFkeX0pIHtcbiAgICBjb25zdCBncm91cHMgPSBbXVxuICAgIGNvbnN0IHNlbGVjdGVkSWRlbnRpdGllcyA9IG5ldyBTZXQoKVxuXG4gICAgZm9yIChjb25zdCByZWNvcmQgb2YgcmVhZHkpIHtcbiAgICAgIGNvbnN0IGlkZW50aXR5ID0gdGhpcy5jb25mbGljdFJlY29yZElkZW50aXR5KHJlY29yZClcblxuICAgICAgaWYgKHNlbGVjdGVkSWRlbnRpdGllcy5oYXMoaWRlbnRpdHkpKSBjb250aW51ZVxuXG4gICAgICBjb25zdCBncm91cCA9IFtyZWNvcmRdXG4gICAgICBsZXQgdGFpbCA9IHJlY29yZFxuXG4gICAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgICBjb25zdCBzdWNjZXNzb3IgPSBwZW5kaW5nLmZpbmQoKGNhbmRpZGF0ZSkgPT4gY2FuZGlkYXRlLmRlcGVuZGVuY2llcy5zb21lKChkZXBlbmRlbmN5KSA9PiBkZXBlbmRlbmN5LmNsaWVudE11dGF0aW9uSWQgPT09IHRhaWwubXV0YXRpb24uY2xpZW50TXV0YXRpb25JZCkpXG5cbiAgICAgICAgaWYgKCFzdWNjZXNzb3IgfHwgIXRoaXMuY2FuQ29hbGVzY2VDb25mbGljdFJlY29yZHModGFpbCwgc3VjY2Vzc29yKSkgYnJlYWtcbiAgICAgICAgZ3JvdXAucHVzaChzdWNjZXNzb3IpXG4gICAgICAgIHRhaWwgPSBzdWNjZXNzb3JcbiAgICAgIH1cblxuICAgICAgZ3JvdXBzLnB1c2goZ3JvdXApXG4gICAgICBzZWxlY3RlZElkZW50aXRpZXMuYWRkKGlkZW50aXR5KVxuICAgIH1cblxuICAgIHJldHVybiBncm91cHNcbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVja3Mgd2hldGhlciB0d28gZHVyYWJsZSBpbnRlbnRzIGNhbiBzaGFyZSBvbmUgdHJhbnNwb3J0IG11dGF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vbG9jYWwtbXV0YXRpb24tbG9nLmpzXCIpLkxvY2FsTXV0YXRpb25Mb2dSZWNvcmR9IGxlZnQgLSBFYXJsaWVyIGludGVudC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2xvY2FsLW11dGF0aW9uLWxvZy5qc1wiKS5Mb2NhbE11dGF0aW9uTG9nUmVjb3JkfSByaWdodCAtIExhdGVyIGludGVudC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IFdoZXRoZXIgc2NhbGFyIHVwZGF0ZXMgY2FuIHNoYXJlIG9uZSB0cmFuc3BvcnQgbXV0YXRpb24uXG4gICAqL1xuICBzdGF0aWMgY2FuQ29hbGVzY2VDb25mbGljdFJlY29yZHMobGVmdCwgcmlnaHQpIHtcbiAgICBpZiAobGVmdC5tdXRhdGlvbi5vcGVyYXRpb24gIT09IFwidXBkYXRlXCIgfHwgcmlnaHQubXV0YXRpb24ub3BlcmF0aW9uICE9PSBcInVwZGF0ZVwiKSByZXR1cm4gZmFsc2VcbiAgICBpZiAodGhpcy5jb25mbGljdFJlY29yZElkZW50aXR5KGxlZnQpICE9PSB0aGlzLmNvbmZsaWN0UmVjb3JkSWRlbnRpdHkocmlnaHQpKSByZXR1cm4gZmFsc2VcbiAgICBpZiAobGVmdC5tdXRhdGlvbi5iYXNlVmVyc2lvbiAhPT0gcmlnaHQubXV0YXRpb24uYmFzZVZlcnNpb24pIHJldHVybiBmYWxzZVxuICAgIGlmICghdGhpcy5zY2FsYXJTeW5jQXR0cmlidXRlcyhsZWZ0Lm11dGF0aW9uLmF0dHJpYnV0ZXMpIHx8ICF0aGlzLnNjYWxhclN5bmNBdHRyaWJ1dGVzKHJpZ2h0Lm11dGF0aW9uLmF0dHJpYnV0ZXMpKSByZXR1cm4gZmFsc2VcblxuICAgIHJldHVybiAhT2JqZWN0LmtleXMobGVmdC5tdXRhdGlvbi5hdHRyaWJ1dGVzIHx8IHt9KS5zb21lKChrZXkpID0+IE9iamVjdC5oYXNPd24ocmlnaHQubXV0YXRpb24uYXR0cmlidXRlcyB8fCB7fSwga2V5KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVja3Mgd2hldGhlciBhdHRyaWJ1dGVzIGNvbnRhaW4gc2NhbGFyIEpTT04gdmFsdWVzIG9ubHkuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsU3luY0pzb25WYWx1ZT4gfCB1bmRlZmluZWR9IGF0dHJpYnV0ZXMgLSBBdHRyaWJ1dGVzLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gV2hldGhlciBldmVyeSB2YWx1ZSBpcyBzY2FsYXIuXG4gICAqL1xuICBzdGF0aWMgc2NhbGFyU3luY0F0dHJpYnV0ZXMoYXR0cmlidXRlcykge1xuICAgIHJldHVybiBCb29sZWFuKGF0dHJpYnV0ZXMpICYmIE9iamVjdC52YWx1ZXMoYXR0cmlidXRlcyB8fCB7fSkuZXZlcnkoKHZhbHVlKSA9PiB2YWx1ZSA9PT0gbnVsbCB8fCBbXCJzdHJpbmdcIiwgXCJudW1iZXJcIiwgXCJib29sZWFuXCJdLmluY2x1ZGVzKHR5cGVvZiB2YWx1ZSkpXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIG9uZSByZXBsYXkgZW52ZWxvcGUgZm9yIGEgc2FmZSB0cmFuc3BvcnQgZ3JvdXAuXG4gICAqIEBwYXJhbSB7QXJyYXk8aW1wb3J0KFwiLi9sb2NhbC1tdXRhdGlvbi1sb2cuanNcIikuTG9jYWxNdXRhdGlvbkxvZ1JlY29yZD59IGdyb3VwIC0gVHJhbnNwb3J0IGdyb3VwLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBSZXBsYXkgZW52ZWxvcGUuXG4gICAqL1xuICBzdGF0aWMgY29uZmxpY3RSZXBsYXlQYXlsb2FkKGdyb3VwKSB7XG4gICAgY29uc3QgZmlyc3QgPSBncm91cFswXVxuICAgIGNvbnN0IHBheWxvYWQgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHtcbiAgICAgIGJhc2VWZXJzaW9uOiBmaXJzdC5tdXRhdGlvbi5iYXNlVmVyc2lvbixcbiAgICAgIGNsaWVudFVwZGF0ZWRBdDogZmlyc3QubXV0YXRpb24ub2NjdXJyZWRBdCxcbiAgICAgIGRhdGE6IE9iamVjdC5hc3NpZ24oe30sIC4uLmdyb3VwLm1hcCgocmVjb3JkKSA9PiByZWNvcmQubXV0YXRpb24uYXR0cmlidXRlcyB8fCB7fSkpLFxuICAgICAgaWQ6IGZpcnN0Lm11dGF0aW9uLmNsaWVudE11dGF0aW9uSWQsXG4gICAgICByZXNvdXJjZUlkOiBmaXJzdC5tdXRhdGlvbi5wYXlsb2FkPy5yZXNvdXJjZUlkLFxuICAgICAgcmVzb3VyY2VUeXBlOiBmaXJzdC5tdXRhdGlvbi5tb2RlbCxcbiAgICAgIHN5bmNUeXBlOiBmaXJzdC5tdXRhdGlvbi5wYXlsb2FkPy5zeW5jVHlwZVxuICAgIH0pXG5cbiAgICByZXR1cm4gcGF5bG9hZFxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBhIHN0YWJsZSByZXNvdXJjZSBpZGVudGl0eSBmb3Igb3JkZXJpbmcgYW5kIHJlbW90ZSBnZW5lcmF0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2xvY2FsLW11dGF0aW9uLWxvZy5qc1wiKS5Mb2NhbE11dGF0aW9uTG9nUmVjb3JkfSByZWNvcmQgLSBSZWNvcmQuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IFJlc291cmNlIGlkZW50aXR5LlxuICAgKi9cbiAgc3RhdGljIGNvbmZsaWN0UmVjb3JkSWRlbnRpdHkocmVjb3JkKSB7XG4gICAgcmV0dXJuIGAke3JlY29yZC5tdXRhdGlvbi5tb2RlbH06JHtTdHJpbmcocmVjb3JkLm11dGF0aW9uLnBheWxvYWQ/LnJlc291cmNlSWQpfWBcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWJhc2VzIHRoZSBkaXJlY3QgcGVuZGluZyBzdWNjZXNzb3IgZnJvbSBhbiBhdXRob3JpdGF0aXZlIGFja25vd2xlZGdlbWVudC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBSZWJhc2UgYXJncy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDbGllbnRDb25mbGljdFRyYWNraW5nQ29uZmlnfSBhcmdzLmNvbmZsaWN0VHJhY2tpbmcgLSBUcmFja2luZyBjb25maWcuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9sb2NhbC1tdXRhdGlvbi1sb2cuanNcIikuTG9jYWxNdXRhdGlvbkxvZ1JlY29yZH0gYXJncy5wcmVkZWNlc3NvciAtIEFja25vd2xlZGdlZCBwcmVkZWNlc3Nvci5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBudW1iZXIgfCBudWxsfSBhcmdzLnNlcnZlclZlcnNpb24gLSBBdXRob3JpdGF0aXZlIHNlcnZlciB2ZXJzaW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIHN0YXRpYyBhc3luYyByZWJhc2VDb25mbGljdFN1Y2Nlc3Nvcih7Y29uZmxpY3RUcmFja2luZywgcHJlZGVjZXNzb3IsIHNlcnZlclZlcnNpb259KSB7XG4gICAgY29uc3Qgc3VjY2Vzc29yID0gKGF3YWl0IGNvbmZsaWN0VHJhY2tpbmcubXV0YXRpb25Mb2cucGVuZGluZ1JlY29yZHMoKSlcbiAgICAgIC5maW5kKChyZWNvcmQpID0+IHJlY29yZC5kZXBlbmRlbmNpZXMuc29tZSgoZGVwZW5kZW5jeSkgPT4gZGVwZW5kZW5jeS5jbGllbnRNdXRhdGlvbklkID09PSBwcmVkZWNlc3Nvci5tdXRhdGlvbi5jbGllbnRNdXRhdGlvbklkKSlcblxuICAgIGlmICghc3VjY2Vzc29yKSByZXR1cm5cblxuICAgIGF3YWl0IGNvbmZsaWN0VHJhY2tpbmcubXV0YXRpb25Mb2cudXBkYXRlTXV0YXRpb24oe1xuICAgICAgaWQ6IHN1Y2Nlc3Nvci5pZCxcbiAgICAgIG11dGF0aW9uOiB7Li4uc3VjY2Vzc29yLm11dGF0aW9uLCBiYXNlVmVyc2lvbjogc2VydmVyVmVyc2lvbn1cbiAgICB9KVxuICB9XG4gIC8qKlxuICAgKiBTZXJpYWxpemVzIHN5bmMgd29yayB3aXRoIHRoZSBzYW1lIGtleSBzbyBjYWxsZXJzIGRvIG5vdCBoYXZlIHRvIGtlZXAgYXBwLWxvY2FsIGxvY2tzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30ga2V5IC0gTG9jayBrZXkuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTx2b2lkPn0gY2FsbGJhY2sgLSBXb3JrIHRvIHJ1biBvbmNlIHByZXZpb3VzIHdvcmsgZmluaXNoZWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHNpbmdsZUZsaWdodChrZXksIGNhbGxiYWNrKSB7XG4gICAgd2hpbGUgKHN5bmNUYXNrUHJvbWlzZXMuaGFzKGtleSkpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHN5bmNUYXNrUHJvbWlzZXMuZ2V0KGtleSlcbiAgICAgIH0gY2F0Y2ggKF9lcnJvcikge1xuICAgICAgICAvLyBUaGUgZmFpbGVkIGZsaWdodCdzIG93biBjYWxsZXIgb2JzZXJ2ZXMgdGhhdCByZWplY3Rpb247IGNhbGxlcnMgcXVldWVkXG4gICAgICAgIC8vIGJlaGluZCBpdCBzdGlsbCBydW4gdGhlaXIgb3duIHdvcmsgc28gcGVuZGluZyByb3dzIHJldHJ5IGFmdGVyIHRoZSBsb2NrIGNsZWFycy5cbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBwcm9taXNlID0gY2FsbGJhY2soKVxuICAgIHN5bmNUYXNrUHJvbWlzZXMuc2V0KGtleSwgcHJvbWlzZSlcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBwcm9taXNlXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGlmIChzeW5jVGFza1Byb21pc2VzLmdldChrZXkpID09PSBwcm9taXNlKSBzeW5jVGFza1Byb21pc2VzLmRlbGV0ZShrZXkpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFB1bGxzIGJhY2tlbmQgc3luYyBjaGFuZ2VzIHdpdGggYSBmcmFtZXdvcmstbWFuYWdlZCBjdXJzb3Igcm93LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFB1bGwgYXJncy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuYXV0aGVudGljYXRpb25Ub2tlbiAtIEF1dGggdG9rZW4gdG8gc2VuZCB3aXRoIGNoYW5nZSByZXF1ZXN0cy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmJhdGNoU2l6ZV0gLSBNYXggc3luY3MgcGVyIHJlcXVlc3QuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MuY3Vyc29yTW9kZWwgLSBNb2RlbCB0aGF0IHJlc3BvbmRzIHRvIGZpbmRCeS9maW5kT3JJbml0aWFsaXplQnkgZm9yIGN1cnNvciBwZXJzaXN0ZW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuY3Vyc29yS2V5IC0gQ3Vyc29yIG9wdGlvbiBrZXkuXG4gICAqIEBwYXJhbSB7KHBheWxvYWQ6IFN5bmNDaGFuZ2VzUmVxdWVzdCkgPT4gUHJvbWlzZTxTeW5jQ2hhbmdlc1Jlc3BvbnNlPn0gYXJncy5wb3N0Q2hhbmdlcyAtIFBvc3RzIG9uZSBjaGFuZ2VzIHJlcXVlc3QuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgU3luY1Jlc291cmNlQ29uZmlnPn0gYXJncy5yZXNvdXJjZXMgLSBSZXNvdXJjZSBwb2xpY2llcy5cbiAgICogQHBhcmFtIHsocHJvZ3Jlc3M6IGltcG9ydChcIi4vc3luYy1hcGktY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNQdWxsUHJvZ3Jlc3MpID0+IHZvaWR9IFthcmdzLm9uUHJvZ3Jlc3NdIC0gUHJvZ3Jlc3MgY2FsbGJhY2suXG4gICAqIEBwYXJhbSB7QWJvcnRTaWduYWx9IFthcmdzLnNpZ25hbF0gLSBMaWZlY3ljbGUgY2FuY2VsbGF0aW9uIHNpZ25hbC5cbiAgICogQHJldHVybnMge1Byb21pc2U8U3luY0NoYW5nZXNSZXN1bHQ+fSBQdWxsIHJlc3VsdC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBwdWxsQ2hhbmdlc1dpdGhDdXJzb3IoYXJncykge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLnB1bGxDaGFuZ2VzKHtcbiAgICAgIGF1dGhlbnRpY2F0aW9uVG9rZW46IGFyZ3MuYXV0aGVudGljYXRpb25Ub2tlbixcbiAgICAgIGJhdGNoU2l6ZTogYXJncy5iYXRjaFNpemUsXG4gICAgICBsb2FkQ3Vyc29yOiBhc3luYyAoKSA9PiBhd2FpdCB0aGlzLmxvYWRTeW5jQ3Vyc29yKHtjdXJzb3JLZXk6IGFyZ3MuY3Vyc29yS2V5LCBjdXJzb3JNb2RlbDogYXJncy5jdXJzb3JNb2RlbH0pLFxuICAgICAgc2F2ZUN1cnNvcjogYXN5bmMgKGN1cnNvcikgPT4gYXdhaXQgdGhpcy5zYXZlU3luY0N1cnNvcih7Y3Vyc29yLCBjdXJzb3JLZXk6IGFyZ3MuY3Vyc29yS2V5LCBjdXJzb3JNb2RlbDogYXJncy5jdXJzb3JNb2RlbH0pLFxuICAgICAgcG9zdENoYW5nZXM6IGFyZ3MucG9zdENoYW5nZXMsXG4gICAgICBhcHBseVN5bmM6IHRoaXMucmVzb3VyY2VBcHBsaWVyKGFyZ3MucmVzb3VyY2VzKSxcbiAgICAgIG9uUHJvZ3Jlc3M6IGFyZ3Mub25Qcm9ncmVzcyxcbiAgICAgIHNpZ25hbDogYXJncy5zaWduYWxcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIExvYWRzIGEgcGVyc2lzdGVkIHN5bmMgY3Vyc29yIGZyb20gYSBtb2RlbCByb3cgd2l0aCBhIHZhbHVlIGNvbHVtbi5cbiAgICogQHBhcmFtIHt7Y3Vyc29yS2V5OiBzdHJpbmcsIGN1cnNvck1vZGVsOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn19IGFyZ3MgLSBDdXJzb3IgYXJncy5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nIHwgbnVsbD59IFBlcnNpc3RlZCBjdXJzb3IgcGF5bG9hZC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBsb2FkU3luY0N1cnNvcih7Y3Vyc29yS2V5LCBjdXJzb3JNb2RlbH0pIHtcbiAgICBjb25zdCBvcHRpb24gPSBhd2FpdCBjdXJzb3JNb2RlbC5maW5kQnkoe2tleTogY3Vyc29yS2V5fSlcblxuICAgIHJldHVybiBvcHRpb24gPyBvcHRpb24udmFsdWUoKSA6IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBTYXZlcyBhIHBlcnNpc3RlZCBzeW5jIGN1cnNvciB0byBhIG1vZGVsIHJvdyB3aXRoIGEgdmFsdWUgY29sdW1uLlxuICAgKiBAcGFyYW0ge3tjdXJzb3I6IFN5bmNDdXJzb3IsIGN1cnNvcktleTogc3RyaW5nLCBjdXJzb3JNb2RlbDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59fSBhcmdzIC0gQ3Vyc29yIGFyZ3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHNhdmVTeW5jQ3Vyc29yKHtjdXJzb3IsIGN1cnNvcktleSwgY3Vyc29yTW9kZWx9KSB7XG4gICAgaWYgKCFjdXJzb3IpIHJldHVyblxuXG4gICAgY29uc3Qgb3B0aW9uID0gYXdhaXQgY3Vyc29yTW9kZWwuZmluZE9ySW5pdGlhbGl6ZUJ5KHtrZXk6IGN1cnNvcktleX0pXG5cbiAgICBvcHRpb24uYXNzaWduKHt2YWx1ZTogSlNPTi5zdHJpbmdpZnkoY3Vyc29yKX0pXG4gICAgaWYgKG9wdGlvbi5pc0NoYW5nZWQoKSkgYXdhaXQgb3B0aW9uLnNhdmUoKVxuICB9XG5cbiAgLyoqXG4gICAqIFB1bGxzIGJhY2tlbmQgc3luYyBjaGFuZ2VzIGluIHN0YWJsZSBwYWdlcywgYXBwbGllcyB0aGVtIGxvY2FsbHksIGFuZCBzdG9yZXNcbiAgICogdGhlIGFja25vd2xlZGdlZCBjdXJzb3IuIEFwcHMgcHJvdmlkZSBvbmx5IGF1dGgsIHBlcnNpc3RlbmNlLCB0cmFuc3BvcnQsIGFuZFxuICAgKiByZXNvdXJjZSBwb2xpY3kgaG9va3MuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gUHVsbCBhcmdzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5hdXRoZW50aWNhdGlvblRva2VuIC0gQXV0aCB0b2tlbiB0byBzZW5kIHdpdGggY2hhbmdlIHJlcXVlc3RzLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuYmF0Y2hTaXplXSAtIE1heCBzeW5jcyBwZXIgcmVxdWVzdC4gRGVmYXVsdHMgdG8gMTAwLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8U3luY0N1cnNvciB8IHN0cmluZyB8IG51bGwgfCB1bmRlZmluZWQ+fSBhcmdzLmxvYWRDdXJzb3IgLSBMb2FkcyB0aGUgcGVyc2lzdGVkIGxvY2FsIGN1cnNvci5cbiAgICogQHBhcmFtIHsoY3Vyc29yOiBTeW5jQ3Vyc29yKSA9PiBQcm9taXNlPHZvaWQ+fSBhcmdzLnNhdmVDdXJzb3IgLSBQZXJzaXN0cyB0aGUgZmluYWwgYWNrbm93bGVkZ2VkIGN1cnNvci5cbiAgICogQHBhcmFtIHsocGF5bG9hZDogU3luY0NoYW5nZXNSZXF1ZXN0LCBvcHRpb25zPzoge3NpZ25hbD86IEFib3J0U2lnbmFsfSkgPT4gUHJvbWlzZTxTeW5jQ2hhbmdlc1Jlc3BvbnNlPn0gYXJncy5wb3N0Q2hhbmdlcyAtIFBvc3RzIG9uZSBjaGFuZ2VzIHJlcXVlc3QuXG4gICAqIEBwYXJhbSB7KHN5bmM6IFN5bmNDaGFuZ2VFbnZlbG9wZSkgPT4gUHJvbWlzZTxTeW5jQ2hhbmdlQXBwbHlSZXN1bHQ+fSBhcmdzLmFwcGx5U3luYyAtIEFwcGxpZXMgb25lIG5vcm1hbGl6ZWQgc3luYyByb3cgbG9jYWxseS5cbiAgICogQHBhcmFtIHsocHJvZ3Jlc3M6IGltcG9ydChcIi4vc3luYy1hcGktY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNQdWxsUHJvZ3Jlc3MpID0+IHZvaWR9IFthcmdzLm9uUHJvZ3Jlc3NdIC0gUHJvZ3Jlc3MgY2FsbGJhY2sgaW52b2tlZCBwZXIgYXBwbGllZCBwYWdlIChhbmQgb25jZSBmb3IgYW4gZW1wdHkgcHVsbCkgd2l0aCB0aGUgYXBwbGllZCBjb3VudHMgYW5kIHRoZSBzdGFibGUgc2VydmVyIHRvdGFsLlxuICAgKiBAcGFyYW0ge0Fib3J0U2lnbmFsfSBbYXJncy5zaWduYWxdIC0gTGlmZWN5Y2xlIGNhbmNlbGxhdGlvbiBzaWduYWwuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFN5bmNDaGFuZ2VzUmVzdWx0Pn0gUHVsbCByZXN1bHQuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgcHVsbENoYW5nZXMoYXJncykge1xuICAgIHRocm93SWZTeW5jQWJvcnRlZChhcmdzLnNpZ25hbClcbiAgICBsZXQgYWZ0ZXJDdXJzb3IgPSB0aGlzLnN5bmNDdXJzb3JGcm9tUGF5bG9hZChhd2FpdCBhcmdzLmxvYWRDdXJzb3IoKSlcbiAgICBsZXQgdXBUb0N1cnNvciA9IG51bGxcbiAgICBsZXQgcGFnZXMgPSAwXG4gICAgbGV0IHN5bmNlZENvdW50ID0gMFxuICAgIGxldCB0b3RhbCA9IDBcbiAgICBsZXQgY2hhbmdlZCA9IGZhbHNlXG4gICAgY29uc3QgcmVzb3VyY2VDb3VudHMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIG51bWJlcj59ICovICh7fSlcbiAgICBjb25zdCByZXNvdXJjZUNoYW5nZWQgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGJvb2xlYW4+fSAqLyAoe30pXG4gICAgY29uc3QgYmF0Y2hTaXplID0gdGhpcy5ub3JtYWxpemVkQmF0Y2hTaXplKGFyZ3MuYmF0Y2hTaXplKVxuXG4gICAgd2hpbGUgKHRydWUpIHtcbiAgICAgIHRocm93SWZTeW5jQWJvcnRlZChhcmdzLnNpZ25hbClcbiAgICAgIGNvbnN0IGNoYW5nZXNSZXNwb25zZSA9IGF3YWl0IHRoaXMuY2hhbmdlc1BhZ2Uoey4uLmFyZ3MsIGFmdGVyQ3Vyc29yLCBiYXRjaFNpemUsIHVwVG9DdXJzb3J9KVxuICAgICAgdGhyb3dJZlN5bmNBYm9ydGVkKGFyZ3Muc2lnbmFsKVxuICAgICAgY29uc3Qgc3luY3MgPSBjaGFuZ2VzUmVzcG9uc2Uuc3luY3NcblxuICAgICAgaWYgKCF1cFRvQ3Vyc29yKSB1cFRvQ3Vyc29yID0gY2hhbmdlc1Jlc3BvbnNlLnVwVG9DdXJzb3JcblxuICAgICAgLy8gVGhlIHNlcnZlciBjb3VudHMgcGVuZGluZyByb3dzIGZyb20gdGhpcyByZXF1ZXN0J3MgY3Vyc29yLCBzbyBhbHJlYWR5LWFwcGxpZWRcbiAgICAgIC8vIHBhZ2VzIHBsdXMgdGhpcyByZXF1ZXN0J3MgY291bnQgc3RheXMgdGhlIHNhbWUgdG90YWwgYWNyb3NzIGV2ZXJ5IHBhZ2U6IGEgc3RhYmxlXG4gICAgICAvLyBcIm9mIFlcIiBkZW5vbWluYXRvciBldmVuIGFzIHRoZSBjdXJzb3IgYWR2YW5jZXMuIEEgc2VydmVyIHRoYXQgZG9lc24ndCByZXBvcnQgdGhlXG4gICAgICAvLyBjb3VudCBhdCBhbGwgbGVhdmVzIHRoZSB0b3RhbCBhdCAwIGZvciBldmVyeSBwYWdlIHJhdGhlciB0aGFuIGRyaWZ0aW5nIHVwd2FyZHNcbiAgICAgIC8vIHdpdGggdGhlIGFwcGxpZWQgcm93cy5cbiAgICAgIGlmIChjaGFuZ2VzUmVzcG9uc2UudG90YWwgIT09IG51bGwpIHRvdGFsID0gc3luY2VkQ291bnQgKyBjaGFuZ2VzUmVzcG9uc2UudG90YWxcblxuICAgICAgaWYgKHN5bmNzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAvLyBSZXBvcnQgdGhlIHRlcm1pbmFsIHByb2dyZXNzIG9uY2UgZm9yIGFuIGVudGlyZWx5IGVtcHR5IHB1bGwgc28gY29uc3VtZXJzIG9ic2VydmVcbiAgICAgICAgLy8gdG90YWwgMDsgYSBwdWxsIHRoYXQgYWxyZWFkeSBhcHBsaWVkIHBhZ2VzIHJlcG9ydGVkIGl0cyBmaW5hbCBjb3VudHMgb24gaXRzIGxhc3QgcGFnZS5cbiAgICAgICAgdGhyb3dJZlN5bmNBYm9ydGVkKGFyZ3Muc2lnbmFsKVxuICAgICAgICBpZiAocGFnZXMgPT09IDAgJiYgYXJncy5vblByb2dyZXNzKSBhcmdzLm9uUHJvZ3Jlc3Moe3BhZ2VzLCBzeW5jZWRDb3VudCwgdG90YWx9KVxuXG4gICAgICAgIGJyZWFrXG4gICAgICB9XG5cbiAgICAgIHBhZ2VzICs9IDFcblxuICAgICAgLy8gQ29hbGVzY2UgcmVjb3JkLWNoYW5nZSBldmVudHMgYWNyb3NzIHRoaXMgcGFnZSdzIGFwcGxpZXMgc28gTiBhcHBsaWVkIHJvd3MgdHJpZ2dlciBvbmVcbiAgICAgIC8vIGxpdmUtcXVlcnkgcmUtcnVuLiBPbmx5IHRoZSBhcHBseSBsb29wIGlzIGJhdGNoZWQ6IHRoZSBuZXR3b3JrIHBhZ2UgZmV0Y2ggYWJvdmUgYW5kIHRoZVxuICAgICAgLy8gY3Vyc29yIHNhdmUgYmVsb3cgc3RheSBvdXRzaWRlLCBzbyBsaXZlIHF1ZXJpZXMgZmx1c2ggcmlnaHQgYWZ0ZXIgdGhlIGFwcGxpZXMgaW5zdGVhZCBvZlxuICAgICAgLy8gd2FpdGluZyBmb3IgdGhlIHJlc3Qgb2YgdGhlIHB1bGwuXG4gICAgICBhd2FpdCByZWNvcmRDaGFuZ2VzLmJhdGNoKGFzeW5jICgpID0+IHtcbiAgICAgICAgZm9yIChjb25zdCBzeW5jIG9mIHN5bmNzKSB7XG4gICAgICAgICAgdGhyb3dJZlN5bmNBYm9ydGVkKGFyZ3Muc2lnbmFsKVxuICAgICAgICAgIGNvbnN0IGFwcGx5UmVzdWx0ID0gYXdhaXQgYXJncy5hcHBseVN5bmMoc3luYylcbiAgICAgICAgICB0aHJvd0lmU3luY0Fib3J0ZWQoYXJncy5zaWduYWwpXG4gICAgICAgICAgY29uc3QgcmVzb3VyY2VUeXBlID0gYXBwbHlSZXN1bHQucmVzb3VyY2VUeXBlID8/IHN5bmMucmVzb3VyY2VUeXBlKClcblxuICAgICAgICAgIGNoYW5nZWQgfHw9IGFwcGx5UmVzdWx0LmNoYW5nZWQgPT09IHRydWVcbiAgICAgICAgICBzeW5jZWRDb3VudCArPSAxXG5cbiAgICAgICAgICBpZiAocmVzb3VyY2VUeXBlKSB7XG4gICAgICAgICAgICByZXNvdXJjZUNvdW50c1tyZXNvdXJjZVR5cGVdID0gKHJlc291cmNlQ291bnRzW3Jlc291cmNlVHlwZV0gfHwgMCkgKyAxXG4gICAgICAgICAgICByZXNvdXJjZUNoYW5nZWRbcmVzb3VyY2VUeXBlXSB8fD0gYXBwbHlSZXN1bHQuY2hhbmdlZCA9PT0gdHJ1ZVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSlcblxuICAgICAgYWZ0ZXJDdXJzb3IgPSBjaGFuZ2VzUmVzcG9uc2UubmV4dEN1cnNvclxuXG4gICAgICB0aHJvd0lmU3luY0Fib3J0ZWQoYXJncy5zaWduYWwpXG4gICAgICBpZiAoYXJncy5vblByb2dyZXNzKSBhcmdzLm9uUHJvZ3Jlc3Moe3BhZ2VzLCBzeW5jZWRDb3VudCwgdG90YWx9KVxuICAgICAgaWYgKHN5bmNzLmxlbmd0aCA8IGJhdGNoU2l6ZSkgYnJlYWtcbiAgICB9XG5cbiAgICB0aHJvd0lmU3luY0Fib3J0ZWQoYXJncy5zaWduYWwpXG4gICAgaWYgKGFmdGVyQ3Vyc29yKSBhd2FpdCBhcmdzLnNhdmVDdXJzb3IoYWZ0ZXJDdXJzb3IpXG4gICAgdGhyb3dJZlN5bmNBYm9ydGVkKGFyZ3Muc2lnbmFsKVxuXG4gICAgcmV0dXJuIHtjaGFuZ2VkLCBwYWdlcywgcmVzb3VyY2VDaGFuZ2VkLCByZXNvdXJjZUNvdW50cywgc3luY2VkQ291bnQsIHRvdGFsfVxuICB9XG5cbiAgLyoqXG4gICAqIEZldGNoZXMgYW5kIHZhbGlkYXRlcyBvbmUgYmFja2VuZCBzeW5jIGNoYW5nZXMgcGFnZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBQYWdlIGFyZ3MuXG4gICAqIEBwYXJhbSB7U3luY0N1cnNvcn0gYXJncy5hZnRlckN1cnNvciAtIExhc3QgYWNrbm93bGVkZ2VkIGN1cnNvci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuYXV0aGVudGljYXRpb25Ub2tlbiAtIEF1dGggdG9rZW4uXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLmJhdGNoU2l6ZSAtIFBhZ2Ugc2l6ZS5cbiAgICogQHBhcmFtIHsocGF5bG9hZDogU3luY0NoYW5nZXNSZXF1ZXN0LCBvcHRpb25zPzoge3NpZ25hbD86IEFib3J0U2lnbmFsfSkgPT4gUHJvbWlzZTxTeW5jQ2hhbmdlc1Jlc3BvbnNlPn0gYXJncy5wb3N0Q2hhbmdlcyAtIENoYW5nZXMgcG9zdGVyLlxuICAgKiBAcGFyYW0ge0Fib3J0U2lnbmFsfSBbYXJncy5zaWduYWxdIC0gTGlmZWN5Y2xlIGNhbmNlbGxhdGlvbiBzaWduYWwuXG4gICAqIEBwYXJhbSB7U3luY0N1cnNvcn0gYXJncy51cFRvQ3Vyc29yIC0gU25hcHNob3QgdXBwZXItYm91bmQgY3Vyc29yLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7bmV4dEN1cnNvcjogU3luY0N1cnNvciwgc3luY3M6IFN5bmNDaGFuZ2VFbnZlbG9wZVtdLCB0b3RhbDogbnVtYmVyIHwgbnVsbCwgdXBUb0N1cnNvcjogU3luY0N1cnNvcn0+fSBOb3JtYWxpemVkIGNoYW5nZXMgcGFnZS5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBjaGFuZ2VzUGFnZSh7YWZ0ZXJDdXJzb3IsIGF1dGhlbnRpY2F0aW9uVG9rZW4sIGJhdGNoU2l6ZSwgcG9zdENoYW5nZXMsIHNpZ25hbCwgdXBUb0N1cnNvcn0pIHtcbiAgICB0aHJvd0lmU3luY0Fib3J0ZWQoc2lnbmFsKVxuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgcG9zdENoYW5nZXMoe1xuICAgICAgYXV0aGVudGljYXRpb25Ub2tlbixcbiAgICAgIGxpbWl0OiBiYXRjaFNpemUsXG4gICAgICAuLi50aGlzLmN1cnNvclBheWxvYWQoXCJhZnRlclwiLCBhZnRlckN1cnNvciksXG4gICAgICAuLi50aGlzLmN1cnNvclBheWxvYWQoXCJ1cFRvXCIsIHVwVG9DdXJzb3IpXG4gICAgfSwge3NpZ25hbH0pXG5cbiAgICB0aHJvd0lmU3luY0Fib3J0ZWQoc2lnbmFsKVxuICAgIHRoaXMuZW5zdXJlU3VjY2Vzc2Z1bENoYW5nZXNSZXNwb25zZShyZXNwb25zZSlcblxuICAgIGNvbnN0IHN5bmNzID0gLyoqIEB0eXBlIHt1bmtub3duW119ICovIChyZXNwb25zZS5zeW5jcylcblxuICAgIHJldHVybiB7XG4gICAgICBuZXh0Q3Vyc29yOiB0aGlzLnN5bmNDdXJzb3JGcm9tUGF5bG9hZChyZXNwb25zZS5uZXh0Q3Vyc29yID8/IG51bGwpLFxuICAgICAgc3luY3M6IHN5bmNzLm1hcCgoc3luY1BheWxvYWQpID0+IHRoaXMuc3luY0VudmVsb3BlRnJvbVBheWxvYWQoc3luY1BheWxvYWQpKSxcbiAgICAgIHRvdGFsOiBvcHRpb25hbEludGVnZXIocmVzcG9uc2UudG90YWwpLFxuICAgICAgdXBUb0N1cnNvcjogdGhpcy5zeW5jQ3Vyc29yRnJvbVBheWxvYWQocmVzcG9uc2UudXBUb0N1cnNvciA/PyBudWxsKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVja3MgQVBJIHJlc3BvbnNlIHN0YXR1cyBhbmQgc2hhcGUgZm9yIGNoYW5nZS1mZWVkIHB1bGxzLlxuICAgKiBAcGFyYW0ge1N5bmNDaGFuZ2VzUmVzcG9uc2V9IHJlc3BvbnNlIC0gQ2hhbmdlcyByZXNwb25zZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGF0aWMgZW5zdXJlU3VjY2Vzc2Z1bENoYW5nZXNSZXNwb25zZShyZXNwb25zZSkge1xuICAgIGlmIChyZXNwb25zZS5zdGF0dXMgPT09IFwiZXJyb3JcIikgdGhyb3cgbmV3IEVycm9yKHJlc3BvbnNlLmVycm9yTWVzc2FnZSB8fCBcIlN5bmMgY2hhbmdlcyBmYWlsZWRcIilcbiAgICBpZiAoIUFycmF5LmlzQXJyYXkocmVzcG9uc2Uuc3luY3MpKSB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jIGNoYW5nZXMgcmVzcG9uc2UgbWlzc2luZyBzeW5jc1wiKVxuICB9XG5cbiAgLyoqXG4gICAqIENvbnZlcnRzIGEgY3Vyc29yIGludG8gcmVxdWVzdCBwYXJhbXMgd2l0aCB0aGUgZ2l2ZW4gcHJlZml4LlxuICAgKiBAcGFyYW0ge1wiYWZ0ZXJcIiB8IFwidXBUb1wifSBwcmVmaXggLSBSZXF1ZXN0IGZpZWxkIHByZWZpeC5cbiAgICogQHBhcmFtIHtTeW5jQ3Vyc29yfSBjdXJzb3IgLSBDdXJzb3IgdG8gc2VyaWFsaXplLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgc3RyaW5nIHwgbnVtYmVyIHwgbnVsbD59IFJlcXVlc3QgcGFyYW1zLlxuICAgKi9cbiAgc3RhdGljIGN1cnNvclBheWxvYWQocHJlZml4LCBjdXJzb3IpIHtcbiAgICBpZiAoIWN1cnNvcikgcmV0dXJuIHt9XG5cbiAgICByZXR1cm4ge1xuICAgICAgW2Ake3ByZWZpeH1JZGBdOiBjdXJzb3IuaWQsXG4gICAgICAuLi4oY3Vyc29yLnNlcnZlclNlcXVlbmNlID8ge1tgJHtwcmVmaXh9U2VydmVyU2VxdWVuY2VgXTogY3Vyc29yLnNlcnZlclNlcXVlbmNlfSA6IHt9KSxcbiAgICAgIFtgJHtwcmVmaXh9VXBkYXRlZEF0YF06IGN1cnNvci51cGRhdGVkQXRcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUGFyc2VzIGEgcGVyc2lzdGVkIG9yIHJlc3BvbnNlIGN1cnNvciBwYXlsb2FkLlxuICAgKiBAcGFyYW0ge1N5bmNDdXJzb3IgfCBzdHJpbmcgfCBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBudWxsIHwgdW5kZWZpbmVkfSBwYXlsb2FkIC0gQ3Vyc29yIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtTeW5jQ3Vyc29yfSBQYXJzZWQgY3Vyc29yLlxuICAgKi9cbiAgc3RhdGljIHN5bmNDdXJzb3JGcm9tUGF5bG9hZChwYXlsb2FkKSB7XG4gICAgaWYgKCFwYXlsb2FkKSByZXR1cm4gbnVsbFxuXG4gICAgaWYgKHR5cGVvZiBwYXlsb2FkID09PSBcInN0cmluZ1wiKSB7XG4gICAgICB0cnkge1xuICAgICAgICByZXR1cm4gdGhpcy5zeW5jQ3Vyc29yRnJvbVBheWxvYWQoSlNPTi5wYXJzZShwYXlsb2FkKSlcbiAgICAgIH0gY2F0Y2ggKF9lcnJvcikge1xuICAgICAgICByZXR1cm4ge2lkOiBudWxsLCBzZXJ2ZXJTZXF1ZW5jZTogbnVsbCwgdXBkYXRlZEF0OiBwYXlsb2FkfVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmICh0eXBlb2YgcGF5bG9hZCAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHBheWxvYWQpKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgdXBkYXRlZEF0ID0gdHlwZW9mIHBheWxvYWQudXBkYXRlZEF0ID09PSBcInN0cmluZ1wiID8gcGF5bG9hZC51cGRhdGVkQXQgOiBudWxsXG5cbiAgICBpZiAoIXVwZGF0ZWRBdCkgcmV0dXJuIG51bGxcblxuICAgIHJldHVybiB7XG4gICAgICBpZDogcGF5bG9hZC5pZCA9PT0gbnVsbCB8fCBwYXlsb2FkLmlkID09PSB1bmRlZmluZWQgPyBudWxsIDogU3RyaW5nKHBheWxvYWQuaWQpLFxuICAgICAgc2VydmVyU2VxdWVuY2U6IG9wdGlvbmFsSW50ZWdlcihwYXlsb2FkLnNlcnZlclNlcXVlbmNlID09PSBcIlwiID8gbnVsbCA6IHBheWxvYWQuc2VydmVyU2VxdWVuY2UpLFxuICAgICAgdXBkYXRlZEF0XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBhIG5vcm1hbGl6ZWQgc3luYyByb3cgYWRhcHRlci5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gcGF5bG9hZCAtIFJhdyBzeW5jIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtTeW5jQ2hhbmdlRW52ZWxvcGV9IFN5bmMgcm93IGFkYXB0ZXIuXG4gICAqL1xuICBzdGF0aWMgc3luY0VudmVsb3BlRnJvbVBheWxvYWQocGF5bG9hZCkge1xuICAgIGlmICghcGF5bG9hZCB8fCB0eXBlb2YgcGF5bG9hZCAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHBheWxvYWQpKSB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jIGNoYW5nZXMgZW50cnkgbXVzdCBiZSBhbiBvYmplY3RcIilcblxuICAgIGNvbnN0IHN5bmNQYXlsb2FkID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChwYXlsb2FkKVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGRhdGE6ICgpID0+IHN5bmNQYXlsb2FkLmRhdGEsXG4gICAgICBpZDogKCkgPT4gc3luY1BheWxvYWQuaWQsXG4gICAgICByZXNvdXJjZUlkOiAoKSA9PiBzeW5jUGF5bG9hZC5yZXNvdXJjZUlkLFxuICAgICAgcmVzb3VyY2VUeXBlOiAoKSA9PiBzeW5jUGF5bG9hZC5yZXNvdXJjZVR5cGUgPT09IG51bGwgfHwgc3luY1BheWxvYWQucmVzb3VyY2VUeXBlID09PSB1bmRlZmluZWQgPyBudWxsIDogU3RyaW5nKHN5bmNQYXlsb2FkLnJlc291cmNlVHlwZSksXG4gICAgICBzeW5jVHlwZTogKCkgPT4gc3luY1BheWxvYWQuc3luY1R5cGUgPT09IG51bGwgfHwgc3luY1BheWxvYWQuc3luY1R5cGUgPT09IHVuZGVmaW5lZCA/IFwiXCIgOiBTdHJpbmcoc3luY1BheWxvYWQuc3luY1R5cGUpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBhbiBhcHAtY29uZmlndXJlZCByZXNvdXJjZSBhcHBsaWVyIGZvciBwdWxsZWQgc3luYyByb3dzLiBUaGUgc3luY1xuICAgKiBtZWNoYW5pY3Mgc3RheSBoZXJlOyBhcHBzIG9ubHkgZGVjbGFyZSB3aGljaCBtb2RlbHMvYXR0cmlidXRlcy9ob29rcyBhcmVcbiAgICogYWxsb3dlZCBmb3IgZWFjaCByZXNvdXJjZSB0eXBlLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFN5bmNSZXNvdXJjZUNvbmZpZz59IHJlc291cmNlcyAtIFJlc291cmNlIHBvbGljeSBtYXAuXG4gICAqIEBwYXJhbSB7KHJlY29yZDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4pID0+ICgpID0+IHZvaWR9IFtvblJlY29yZF0gLSBDYWxsZWQgd2l0aCBlYWNoIHJlY29yZCBhYm91dCB0byBiZSB3cml0dGVuOyByZXR1cm5zIGEgcmVsZWFzZSBjYWxsYmFjayBpbnZva2VkIGFmdGVyIHRoZSB3cml0ZSAodXNlZCBmb3IgZWNobyBzdXBwcmVzc2lvbikuXG4gICAqIEByZXR1cm5zIHsoc3luYzogU3luY0NoYW5nZUVudmVsb3BlKSA9PiBQcm9taXNlPFN5bmNDaGFuZ2VBcHBseVJlc3VsdD59IFN5bmMgYXBwbHkgY2FsbGJhY2suXG4gICAqL1xuICBzdGF0aWMgcmVzb3VyY2VBcHBsaWVyKHJlc291cmNlcywgb25SZWNvcmQpIHtcbiAgICByZXR1cm4gYXN5bmMgKHN5bmMpID0+IGF3YWl0IHRoaXMuYXBwbHlSZXNvdXJjZVN5bmMoe29uUmVjb3JkLCByZXNvdXJjZXMsIHN5bmN9KVxuICB9XG5cbiAgLyoqXG4gICAqIEFwcGxpZXMgb25lIHN5bmMgcm93IHVzaW5nIGRlY2xhcmF0aXZlIHJlc291cmNlIHBvbGljeS5cbiAgICogQHBhcmFtIHt7cmVzb3VyY2VzOiBSZWNvcmQ8c3RyaW5nLCBTeW5jUmVzb3VyY2VDb25maWc+LCBzeW5jOiBTeW5jQ2hhbmdlRW52ZWxvcGUsIG9uUmVjb3JkPzogKHJlY29yZDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4pID0+ICgpID0+IHZvaWR9fSBhcmdzIC0gQXBwbHkgYXJncy5cbiAgICogQHJldHVybnMge1Byb21pc2U8U3luY0NoYW5nZUFwcGx5UmVzdWx0Pn0gQXBwbHkgcmVzdWx0LlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGFwcGx5UmVzb3VyY2VTeW5jKHtvblJlY29yZCwgcmVzb3VyY2VzLCBzeW5jfSkge1xuICAgIGNvbnN0IHJlc291cmNlVHlwZSA9IHN5bmMucmVzb3VyY2VUeXBlKClcbiAgICBjb25zdCByZXNvdXJjZSA9IHJlc291cmNlVHlwZSA/IHJlc291cmNlc1tyZXNvdXJjZVR5cGVdIDogdW5kZWZpbmVkXG5cbiAgICBpZiAoIXJlc291cmNlIHx8ICFyZXNvdXJjZS5lbmFibGVkKSByZXR1cm4ge2NoYW5nZWQ6IGZhbHNlLCByZXNvdXJjZVR5cGV9XG5cbiAgICBpZiAoc3luYy5zeW5jVHlwZSgpID09PSBcImRlbGV0ZVwiKSB7XG4gICAgICByZXR1cm4ge2NoYW5nZWQ6IGF3YWl0IHRoaXMuZGVzdHJveVN5bmNlZFJlc291cmNlKHtvblJlY29yZCwgcmVzb3VyY2UsIHN5bmN9KSwgcmVzb3VyY2VUeXBlfVxuICAgIH1cblxuICAgIGNvbnN0IGRhdGEgPSB0aGlzLnN5bmNEYXRhKHN5bmMpXG4gICAgY29uc3QgcmVjb3JkID0gcmVzb3VyY2UuZmluZFJlY29yZCA/IGF3YWl0IHJlc291cmNlLmZpbmRSZWNvcmQoe2RhdGEsIHJlc291cmNlSWQ6IHN5bmMucmVzb3VyY2VJZCgpLCBzeW5jfSkgOiBhd2FpdCByZXNvdXJjZS5tb2RlbENsYXNzLmZpbmRPckluaXRpYWxpemVCeSh7aWQ6IGRhdGEuaWQgPz8gc3luYy5yZXNvdXJjZUlkKCl9KVxuICAgIGNvbnN0IGF0dHJpYnV0ZXMgPSBhd2FpdCByZXNvdXJjZS5hdHRyaWJ1dGVzKHtkYXRhLCByZWNvcmQsIHN5bmN9KVxuICAgIGNvbnN0IHJlbGVhc2VSZWNvcmQgPSBvblJlY29yZCA/IG9uUmVjb3JkKHJlY29yZCkgOiBudWxsXG4gICAgbGV0IGNoYW5nZWQgPSBmYWxzZVxuXG4gICAgdHJ5IHtcbiAgICAgIHJlY29yZC5hc3NpZ24oYXR0cmlidXRlcylcblxuICAgICAgaWYgKHJlY29yZC5pc0NoYW5nZWQoKSkge1xuICAgICAgICBhd2FpdCByZWNvcmQuc2F2ZSgpXG4gICAgICAgIGNoYW5nZWQgPSB0cnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChyZXNvdXJjZS5hZnRlckFwcGx5KSB7XG4gICAgICAgIGNvbnN0IGhvb2tDaGFuZ2VkID0gYXdhaXQgcmVzb3VyY2UuYWZ0ZXJBcHBseSh7YXR0cmlidXRlcywgZGF0YSwgcmVjb3JkLCBzeW5jfSlcblxuICAgICAgICBjaGFuZ2VkIHx8PSBob29rQ2hhbmdlZCA9PT0gdHJ1ZVxuICAgICAgfVxuICAgIH0gZmluYWxseSB7XG4gICAgICBpZiAocmVsZWFzZVJlY29yZCkgcmVsZWFzZVJlY29yZCgpXG4gICAgfVxuXG4gICAgcmV0dXJuIHtjaGFuZ2VkLCByZXNvdXJjZVR5cGV9XG4gIH1cblxuICAvKipcbiAgICogRGVzdHJveXMgYSBzeW5jZWQgcmVzb3VyY2UgdmlhIGl0cyBkZWNsYXJlZCBtb2RlbCBwb2xpY3kuXG4gICAqIEBwYXJhbSB7e3Jlc291cmNlOiBTeW5jUmVzb3VyY2VDb25maWcsIHN5bmM6IFN5bmNDaGFuZ2VFbnZlbG9wZSwgb25SZWNvcmQ/OiAocmVjb3JkOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPikgPT4gKCkgPT4gdm9pZH19IGFyZ3MgLSBEZXN0cm95IGFyZ3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSBXaGV0aGVyIGEgbG9jYWwgcm93IHdhcyBkZXN0cm95ZWQuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgZGVzdHJveVN5bmNlZFJlc291cmNlKHtvblJlY29yZCwgcmVzb3VyY2UsIHN5bmN9KSB7XG4gICAgY29uc3QgaWQgPSBzeW5jLnJlc291cmNlSWQoKVxuICAgIGNvbnN0IHJlY29yZCA9IHJlc291cmNlLmZpbmRSZWNvcmRGb3JEZWxldGUgPyBhd2FpdCByZXNvdXJjZS5maW5kUmVjb3JkRm9yRGVsZXRlKHtyZXNvdXJjZUlkOiBpZCwgc3luY30pIDogYXdhaXQgcmVzb3VyY2UubW9kZWxDbGFzcy5maW5kQnkoe2lkfSlcblxuICAgIGlmICghcmVjb3JkKSByZXR1cm4gZmFsc2VcblxuICAgIGNvbnN0IHJlbGVhc2VSZWNvcmQgPSBvblJlY29yZCA/IG9uUmVjb3JkKHJlY29yZCkgOiBudWxsXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgcmVjb3JkLmRlc3Ryb3koKVxuICAgIH0gZmluYWxseSB7XG4gICAgICBpZiAocmVsZWFzZVJlY29yZCkgcmVsZWFzZVJlY29yZCgpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBQYXJzZXMgdGhlIGVtYmVkZGVkIHN5bmMgZGF0YSBKU09OL29iamVjdC5cbiAgICogQHBhcmFtIHtTeW5jQ2hhbmdlRW52ZWxvcGV9IHN5bmMgLSBTeW5jIHJvdy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSBTeW5jIGRhdGEgb2JqZWN0LlxuICAgKi9cbiAgc3RhdGljIHN5bmNEYXRhKHN5bmMpIHtcbiAgICBjb25zdCBkYXRhID0gc3luYy5kYXRhKClcblxuICAgIGlmICghZGF0YSkgdGhyb3cgbmV3IEVycm9yKGBTeW5jICR7c3luYy5pZCgpfSBpcyBtaXNzaW5nIGRhdGFgKVxuICAgIGlmICh0eXBlb2YgZGF0YSA9PT0gXCJzdHJpbmdcIikgcmV0dXJuIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59ICovIChKU09OLnBhcnNlKGRhdGEpKVxuICAgIGlmICh0eXBlb2YgZGF0YSA9PT0gXCJvYmplY3RcIiAmJiAhQXJyYXkuaXNBcnJheShkYXRhKSkgcmV0dXJuIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59ICovIChkYXRhKVxuXG4gICAgdGhyb3cgbmV3IEVycm9yKGBTeW5jICR7c3luYy5pZCgpfSBoYXMgaW52YWxpZCBkYXRhYClcbiAgfVxuXG4gIC8qKlxuICAgKiBEcmFpbnMgcGVuZGluZyBzeW5jIHJlY29yZHMgZnJvbSBhIGxvY2FsIFZlbG9jaW91cyBtb2RlbCBpbiBzdGFibGUgb3JkZXIuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gUmVwbGF5IGFyZ3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmF1dGhlbnRpY2F0aW9uVG9rZW4gLSBBdXRoIHRva2VuIHRvIHNlbmQgd2l0aCByZXBsYXkgcmVxdWVzdHMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5iYXRjaFNpemVdIC0gTWF4IHN5bmNzIHBlciByZXF1ZXN0LlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLnN5bmNNb2RlbCAtIExvY2FsIFN5bmMgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7KHBheWxvYWQ6IHthdXRoZW50aWNhdGlvblRva2VuOiBzdHJpbmcsIHN5bmNzOiBBcnJheTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSwgb3B0aW9ucz86IHtzaWduYWw/OiBBYm9ydFNpZ25hbH0pID0+IFByb21pc2U8U3luY1JlcGxheVJlc3BvbnNlPn0gYXJncy5wb3N0UmVwbGF5IC0gUmVwbGF5IHBvc3Rlci5cbiAgICogQHBhcmFtIHtBYm9ydFNpZ25hbH0gW2FyZ3Muc2lnbmFsXSAtIExpZmVjeWNsZSBjYW5jZWxsYXRpb24gc2lnbmFsLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIHN0YXRpYyBhc3luYyByZXBsYXlMb2NhbFN5bmNzKGFyZ3MpIHtcbiAgICBjb25zdCBwb3N0ZWRTbmFwc2hvdHNCeVN5bmNJZCA9IG5ldyBNYXAoKVxuXG4gICAgYXdhaXQgdGhpcy5yZXBsYXlQZW5kaW5nKHtcbiAgICAgIGF1dGhlbnRpY2F0aW9uVG9rZW46IGFyZ3MuYXV0aGVudGljYXRpb25Ub2tlbixcbiAgICAgIGJhdGNoU2l6ZTogYXJncy5iYXRjaFNpemUsXG4gICAgICBtYXJrU3VjY2Vzc2Z1bDogYXN5bmMgKHN5bmMpID0+IHtcbiAgICAgICAgY29uc3Qgc3luY0lkID0gKC8qKiBAdHlwZSB7e2lkOiAoKSA9PiBzdHJpbmcgfCBudW1iZXIgfCBudWxsIHwgdW5kZWZpbmVkfX0gKi8gKHN5bmMpKS5pZCgpXG4gICAgICAgIC8vIFJlbG9hZCB3aXRoIHRoZSByZXNvdXJjZSBwcmVsb2FkZWQgc28gcm93cyByZWx5aW5nIG9uIHRoZSByZXNvdXJjZS1hdHRyaWJ1dGVzXG4gICAgICAgIC8vIGZhbGxiYWNrIGluIGxvY2FsU3luY0RhdGEgY29tcGFyZSBhZ2FpbnN0IHRoZSBzYW1lIHNuYXBzaG90IHRoZXkgcG9zdGVkLlxuICAgICAgICBjb25zdCBjdXJyZW50U3luYyA9IGF3YWl0IGFyZ3Muc3luY01vZGVsLnByZWxvYWQoe3Jlc291cmNlOiB0cnVlfSkud2hlcmUoe2lkOiBzeW5jSWR9KS5maXJzdCgpXG5cbiAgICAgICAgaWYgKCFjdXJyZW50U3luYykgcmV0dXJuXG4gICAgICAgIC8vIEEgcm93IGVkaXRlZCB3aGlsZSBpdHMgb2xkIHBheWxvYWQgd2FzIGluIGZsaWdodCBzdGF5cyBwZW5kaW5nLCBzbyB0aGVcbiAgICAgICAgLy8gbmV3ZXIgbG9jYWwgY2hhbmdlIHJlcGxheXMgb24gdGhlIG5leHQgZHJhaW4gaW5zdGVhZCBvZiBiZWluZyBsb3N0LlxuICAgICAgICBpZiAodGhpcy5sb2NhbFN5bmNSZXBsYXlTbmFwc2hvdChjdXJyZW50U3luYykgIT09IHBvc3RlZFNuYXBzaG90c0J5U3luY0lkLmdldChTdHJpbmcoc3luY0lkKSkpIHJldHVyblxuXG4gICAgICAgIGF3YWl0IGN1cnJlbnRTeW5jLnVwZGF0ZSh7c3RhdGU6IFwic3VjY2Vzc1wifSlcbiAgICAgIH0sXG4gICAgICBwZW5kaW5nU3luY3M6IGFzeW5jICgpID0+IGF3YWl0IGFyZ3Muc3luY01vZGVsLnByZWxvYWQoe3Jlc291cmNlOiB0cnVlfSkud2hlcmUoe3N0YXRlOiBcInBlbmRpbmdcIn0pLm9yZGVyKFwiY3JlYXRlZF9hdFwiKS50b0FycmF5KCksXG4gICAgICBwb3N0UmVwbGF5OiBhcmdzLnBvc3RSZXBsYXksXG4gICAgICBzaWduYWw6IGFyZ3Muc2lnbmFsLFxuICAgICAgc3luY0lkOiAoc3luYykgPT4gKC8qKiBAdHlwZSB7e2lkOiAoKSA9PiBzdHJpbmcgfCBudW1iZXIgfCBudWxsIHwgdW5kZWZpbmVkfX0gKi8gKHN5bmMpKS5pZCgpLFxuICAgICAgc3luY1BheWxvYWQ6IChzeW5jKSA9PiB7XG4gICAgICAgIHBvc3RlZFNuYXBzaG90c0J5U3luY0lkLnNldChTdHJpbmcoKC8qKiBAdHlwZSB7e2lkOiAoKSA9PiBzdHJpbmcgfCBudW1iZXIgfCBudWxsIHwgdW5kZWZpbmVkfX0gKi8gKHN5bmMpKS5pZCgpKSwgdGhpcy5sb2NhbFN5bmNSZXBsYXlTbmFwc2hvdChzeW5jKSlcblxuICAgICAgICByZXR1cm4gdGhpcy5sb2NhbFN5bmNQYXlsb2FkKHN5bmMpXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBTZXJpYWxpemVzIHRoZSByZXBsYXktcmVsZXZhbnQgc3RhdGUgb2YgYSBsb2NhbCBzeW5jIHJvdyBmb3IgaW4tZmxpZ2h0IGNvbXBhcmlzb25zLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBzeW5jIC0gTG9jYWwgc3luYyByb3cuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IFN0YWJsZSBzbmFwc2hvdCBvZiB0aGUgcm93J3MgcmVwbGF5ZWQgcGF5bG9hZC5cbiAgICovXG4gIHN0YXRpYyBsb2NhbFN5bmNSZXBsYXlTbmFwc2hvdChzeW5jKSB7XG4gICAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KHtkYXRhOiB0aGlzLmxvY2FsU3luY0RhdGEoc3luYyksIHN5bmNUeXBlOiBzeW5jLnN5bmNUeXBlKCl9KVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBvbmUgcmVwbGF5IGVudmVsb3BlIGZyb20gYSBsb2NhbCBzeW5jIHJvdy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gc3luYyAtIExvY2FsIHN5bmMgcm93LlxuICAgKiBAcmV0dXJucyB7e2NsaWVudFVwZGF0ZWRBdD86IHN0cmluZywgZGF0YTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4sIGlkOiBudW1iZXIsIHJlc291cmNlSWQ6IHN0cmluZywgcmVzb3VyY2VUeXBlOiBzdHJpbmcsIHN5bmNUeXBlOiBzdHJpbmd9fSBTeW5jIHJlcGxheSBlbnZlbG9wZS5cbiAgICovXG4gIHN0YXRpYyBsb2NhbFN5bmNQYXlsb2FkKHN5bmMpIHtcbiAgICBjb25zdCBjbGllbnRVcGRhdGVkQXQgPSBzeW5jLnVwZGF0ZWRBdCgpIHx8IHN5bmMuY3JlYXRlZEF0KClcblxuICAgIHJldHVybiB7XG4gICAgICBjbGllbnRVcGRhdGVkQXQ6IGNsaWVudFVwZGF0ZWRBdCA/IGNsaWVudFVwZGF0ZWRBdC50b0lTT1N0cmluZygpIDogdW5kZWZpbmVkLFxuICAgICAgZGF0YTogdGhpcy5sb2NhbFN5bmNEYXRhKHN5bmMpLFxuICAgICAgaWQ6IC8qKiBAdHlwZSB7bnVtYmVyfSAqLyAoLyoqIEB0eXBlIHt1bmtub3dufSAqLyAoc3luYy5pZCgpKSksXG4gICAgICByZXNvdXJjZUlkOiBTdHJpbmcoc3luYy5yZXNvdXJjZUlkKCkpLFxuICAgICAgcmVzb3VyY2VUeXBlOiBzeW5jLnJlc291cmNlVHlwZSgpIHx8IFwiXCIsXG4gICAgICBzeW5jVHlwZTogc3luYy5zeW5jVHlwZSgpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIG9uZSBsb2NhbCBzeW5jIHJvdyBwYXlsb2FkLCBmYWxsaW5nIGJhY2sgdG8gcHJlbG9hZGVkIHJlc291cmNlIGF0dHJpYnV0ZXMuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHN5bmMgLSBMb2NhbCBzeW5jIHJvdy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSBTeW5jIGRhdGEuXG4gICAqL1xuICBzdGF0aWMgbG9jYWxTeW5jRGF0YShzeW5jKSB7XG4gICAgbGV0IHN5bmNEYXRhID0gLyoqIEB0eXBlIHtzdHJpbmcgfCBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn0gKi8gKHN5bmMuZGF0YSgpIHx8IHt9KVxuXG4gICAgaWYgKHR5cGVvZiBzeW5jRGF0YSA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgdHJ5IHtcbiAgICAgICAgc3luY0RhdGEgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSAqLyAoSlNPTi5wYXJzZShzeW5jRGF0YSkpXG4gICAgICB9IGNhdGNoIChfZXJyb3IpIHtcbiAgICAgICAgc3luY0RhdGEgPSB7fVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChPYmplY3Qua2V5cyhzeW5jRGF0YSkubGVuZ3RoID4gMCkgcmV0dXJuIHN5bmNEYXRhXG5cbiAgICB0cnkge1xuICAgICAgcmV0dXJuIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59ICovIChzeW5jLnJlc291cmNlKCkuYXR0cmlidXRlcygpKVxuICAgIH0gY2F0Y2ggKF9lcnJvcikge1xuICAgICAgcmV0dXJuIHt9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFF1ZXVlcyBhIGxvY2FsIHN5bmMgcm93IGZvciBhIFZlbG9jaW91cyBtb2RlbCByZXNvdXJjZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBRdWV1ZSBhcmdzLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLnJlc291cmNlIC0gUmVzb3VyY2UgYmVpbmcgc3luY2VkLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLnN5bmNNb2RlbCAtIExvY2FsIFN5bmMgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59IFthcmdzLmRhdGFdIC0gRXhwbGljaXQgc3luYyBkYXRhLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3Muc3luY1R5cGVdIC0gU3luYyBvcGVyYXRpb24gdHlwZS5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gW2FyZ3MubG9jYWxPbmx5QXR0cmlidXRlc10gLSBBdHRyaWJ1dGVzIHRvIHN0cmlwIGZyb20gcXVldWVkIHBheWxvYWRzLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBbYXJncy5ib29sZWFuQXR0cmlidXRlc10gLSBBdHRyaWJ1dGVzIHRvIGNvZXJjZSB0aHJvdWdoIHN5bmMgYm9vbGVhbiBwYXJzaW5nLlxuICAgKiBAcGFyYW0geyhkYXRhOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikgPT4gUmVjb3JkPHN0cmluZywgdW5rbm93bj59IFthcmdzLm5vcm1hbGl6ZURhdGFdIC0gQXBwLXNwZWNpZmljIGRhdGEgbm9ybWFsaXplci5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBMb2NhbCBzeW5jIHJvdy5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBxdWV1ZUxvY2FsU3luYyhhcmdzKSB7XG4gICAgY29uc3QgcmVzb3VyY2VSZWNvcmRJZCA9IHNjYWxhck1vZGVsUHJpbWFyeUtleVZhbHVlKGFyZ3MucmVzb3VyY2UuaWQoKSwgXCJMb2NhbCBzeW5jIHF1ZXVlaW5nXCIpXG4gICAgY29uc3QgbW9kZWxDbGFzcyA9IGFyZ3MucmVzb3VyY2UuY29uc3RydWN0b3JcblxuICAgIGlmICh0eXBlb2YgbW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUgIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiVGhlIHJlc291cmNlIG1vZGVsIGNsYXNzIG11c3QgaW1wbGVtZW50IHN0YXRpYyBnZXRNb2RlbE5hbWUoKSB0byBxdWV1ZSBzeW5jIGRhdGEgLSBjbGFzcyBuYW1lcyBhcmUgbm90IHN0YWJsZSBhY3Jvc3MgZXhwbGljaXQgbW9kZWwgbmFtZXMgYW5kIG1pbmlmaWVkIGJ1bmRsZXNcIilcbiAgICB9XG5cbiAgICBjb25zdCByZXNvdXJjZVR5cGUgPSBtb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpXG4gICAgY29uc3Qgc3luY0RhdGEgPSB0aGlzLnF1ZXVlZFN5bmNEYXRhKGFyZ3MpXG4gICAgY29uc3Qgc3luY1R5cGUgPSBhcmdzLnN5bmNUeXBlIHx8IFwidXBkYXRlXCJcblxuICAgIGlmICghcmVzb3VyY2VSZWNvcmRJZCkgdGhyb3cgbmV3IEVycm9yKFwicmVzb3VyY2UuaWQoKSBpcyByZXF1aXJlZCB0byBxdWV1ZSBzeW5jIGRhdGFcIilcblxuICAgIGNvbnN0IHJlc291cmNlSWQgPSBTdHJpbmcocmVzb3VyY2VSZWNvcmRJZClcbiAgICBjb25zdCBleGlzdGluZ1N5bmMgPSBhd2FpdCBhcmdzLnN5bmNNb2RlbC5maW5kQnkoe3Jlc291cmNlSWQsIHJlc291cmNlVHlwZX0pXG5cbiAgICBpZiAoZXhpc3RpbmdTeW5jKSB7XG4gICAgICBhd2FpdCBleGlzdGluZ1N5bmMudXBkYXRlKHtcbiAgICAgICAgZGF0YTogc3luY0RhdGEsXG4gICAgICAgIHN0YXRlOiBcInBlbmRpbmdcIixcbiAgICAgICAgc3luY1R5cGVcbiAgICAgIH0pXG5cbiAgICAgIHJldHVybiBleGlzdGluZ1N5bmNcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgYXJncy5zeW5jTW9kZWwuY3JlYXRlKHtcbiAgICAgIGRhdGE6IHN5bmNEYXRhLFxuICAgICAgcmVzb3VyY2VJZCxcbiAgICAgIHJlc291cmNlVHlwZSxcbiAgICAgIHN0YXRlOiBcInBlbmRpbmdcIixcbiAgICAgIHN5bmNUeXBlXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgYmFja2VuZC1zYWZlIHF1ZXVlZCBzeW5jIGRhdGEgd2l0aG91dCBtdXRhdGluZyBjYWxsZXIgZGF0YS4gVGhlIGRlZmF1bHRcbiAgICogKG5vIGV4cGxpY2l0IGBkYXRhYCkgaXMgdGhlIHJlc291cmNlJ3MgYXR0cmlidXRlcyBtaW51cyBsb2NhbC1vbmx5IGF0dHJpYnV0ZXMsXG4gICAqIHdpdGggYm9vbGVhbnMgY29lcmNlZCBhbmQgRGF0ZSB2YWx1ZXMgc2VyaWFsaXplZCB0byBJU08gc3RyaW5ncywgc28gYXBwcyBkb24ndFxuICAgKiBuZWVkIHBlci1tb2RlbCB0cmFja2VkLXBheWxvYWQgYnVpbGRlcnMuXG4gICAqIEBwYXJhbSB7e3Jlc291cmNlOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgZGF0YT86IFJlY29yZDxzdHJpbmcsIHVua25vd24+LCBsb2NhbE9ubHlBdHRyaWJ1dGVzPzogc3RyaW5nW10sIGJvb2xlYW5BdHRyaWJ1dGVzPzogc3RyaW5nW10sIG5vcm1hbGl6ZURhdGE/OiAoZGF0YTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pID0+IFJlY29yZDxzdHJpbmcsIHVua25vd24+fX0gYXJncyAtIERhdGEgYXJncy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSBRdWV1ZWQgZGF0YS5cbiAgICovXG4gIHN0YXRpYyBxdWV1ZWRTeW5jRGF0YShhcmdzKSB7XG4gICAgY29uc3QgaW5wdXREYXRhID0gYXJncy5kYXRhID8/IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59ICovIChhcmdzLnJlc291cmNlLmF0dHJpYnV0ZXMoKSlcbiAgICBjb25zdCBub3JtYWxpemVkRGF0YSA9IGFyZ3Mubm9ybWFsaXplRGF0YSA/IGFyZ3Mubm9ybWFsaXplRGF0YShpbnB1dERhdGEpIDogaW5wdXREYXRhXG4gICAgY29uc3Qgc3luY0RhdGEgPSB7Li4ubm9ybWFsaXplZERhdGF9XG5cbiAgICBmb3IgKGNvbnN0IGF0dHJpYnV0ZU5hbWUgb2YgYXJncy5sb2NhbE9ubHlBdHRyaWJ1dGVzIHx8IFtdKSBkZWxldGUgc3luY0RhdGFbYXR0cmlidXRlTmFtZV1cbiAgICBmb3IgKGNvbnN0IGF0dHJpYnV0ZU5hbWUgb2YgYXJncy5ib29sZWFuQXR0cmlidXRlcyB8fCBbXSkge1xuICAgICAgaWYgKE9iamVjdC5oYXNPd24oc3luY0RhdGEsIGF0dHJpYnV0ZU5hbWUpKSBzeW5jRGF0YVthdHRyaWJ1dGVOYW1lXSA9IHRoaXMub3B0aW9uYWxCb29sZWFuU3luY1ZhbHVlKHN5bmNEYXRhW2F0dHJpYnV0ZU5hbWVdLCBhdHRyaWJ1dGVOYW1lKVxuICAgIH1cbiAgICBmb3IgKGNvbnN0IFthdHRyaWJ1dGVOYW1lLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoc3luY0RhdGEpKSB7XG4gICAgICBpZiAodmFsdWUgaW5zdGFuY2VvZiBEYXRlKSBzeW5jRGF0YVthdHRyaWJ1dGVOYW1lXSA9IHZhbHVlLnRvSVNPU3RyaW5nKClcbiAgICB9XG5cbiAgICByZXR1cm4gc3luY0RhdGFcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgYSBzbWFsbCBhcHAtZmFjaW5nIGxvY2FsIHN5bmMgcXVldWUgZmFjYWRlIGZyb20gZGVjbGFyYXRpdmUgbW9kZWwgY29uZmlnLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFF1ZXVlIGNvbmZpZy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5zeW5jTW9kZWwgLSBMb2NhbCBTeW5jIG1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zaW5nbGVGbGlnaHRLZXkgLSBLZXkgdXNlZCB0byBzZXJpYWxpemUgYmFja2VuZCByZXBsYXkuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTx2b2lkPn0gYXJncy5zeW5jUGVuZGluZyAtIEJhY2tlbmQgcmVwbGF5IGNhbGxiYWNrLlxuICAgKiBAcGFyYW0geyhyZXNvdXJjZTogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4pID0+IHN0cmluZ1tdfSBbYXJncy5sb2NhbE9ubHlBdHRyaWJ1dGVzXSAtIFJlc291cmNlLXNwZWNpZmljIGxvY2FsLW9ubHkgYXR0cmlidXRlcy5cbiAgICogQHBhcmFtIHsocmVzb3VyY2U6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+KSA9PiBzdHJpbmdbXX0gW2FyZ3MuYm9vbGVhbkF0dHJpYnV0ZXNdIC0gUmVzb3VyY2Utc3BlY2lmaWMgU1FMaXRlIGJvb2xlYW4gYXR0cmlidXRlcy5cbiAgICogQHJldHVybnMge3txdWV1ZTogKHF1ZXVlQXJnczoge3Jlc291cmNlOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgZGF0YT86IFJlY29yZDxzdHJpbmcsIHVua25vd24+LCBzeW5jVHlwZT86IHN0cmluZ30pID0+IFByb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBzeW5jUGVuZGluZzogKCkgPT4gUHJvbWlzZTx2b2lkPn19IENvbmZpZ3VyZWQgbG9jYWwgc3luYyBxdWV1ZS5cbiAgICovXG4gIHN0YXRpYyBsb2NhbFN5bmNRdWV1ZShhcmdzKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHF1ZXVlOiBhc3luYyAocXVldWVBcmdzKSA9PiBhd2FpdCB0aGlzLnF1ZXVlTG9jYWxTeW5jKHtcbiAgICAgICAgLi4ucXVldWVBcmdzLFxuICAgICAgICBib29sZWFuQXR0cmlidXRlczogYXJncy5ib29sZWFuQXR0cmlidXRlcyA/IGFyZ3MuYm9vbGVhbkF0dHJpYnV0ZXMocXVldWVBcmdzLnJlc291cmNlKSA6IFtdLFxuICAgICAgICBsb2NhbE9ubHlBdHRyaWJ1dGVzOiBhcmdzLmxvY2FsT25seUF0dHJpYnV0ZXMgPyBhcmdzLmxvY2FsT25seUF0dHJpYnV0ZXMocXVldWVBcmdzLnJlc291cmNlKSA6IFtdLFxuICAgICAgICBzeW5jTW9kZWw6IGFyZ3Muc3luY01vZGVsXG4gICAgICB9KSxcbiAgICAgIHN5bmNQZW5kaW5nOiBhc3luYyAoKSA9PiBhd2FpdCB0aGlzLnNpbmdsZUZsaWdodChhcmdzLnNpbmdsZUZsaWdodEtleSwgYXJncy5zeW5jUGVuZGluZylcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUGFyc2VzIGJvb2xlYW5zIGNvbW1vbmx5IHVzZWQgYnkgU1FMaXRlL29mZmxpbmUgc3luYyBwYXlsb2Fkcy5cbiAgICogQHBhcmFtIHt1bmtub3dufSB2YWx1ZSAtIFN5bmMgZGVjaXNpb24gdmFsdWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbZGVzY3JpcHRpb25dIC0gRXJyb3IgY29udGV4dC5cbiAgICogQHJldHVybnMge2Jvb2xlYW4gfCBudWxsfSBQYXJzZWQgYm9vbGVhbi1saWtlIGJhY2tlbmQvbG9jYWwgdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgb3B0aW9uYWxCb29sZWFuU3luY1ZhbHVlKHZhbHVlLCBkZXNjcmlwdGlvbiA9IFwic3luYyBib29sZWFuXCIpIHtcbiAgICBpZiAodmFsdWUgPT0gbnVsbCkgcmV0dXJuIG51bGxcbiAgICBpZiAodmFsdWUgPT09IDEpIHJldHVybiB0cnVlXG4gICAgaWYgKHZhbHVlID09PSAwKSByZXR1cm4gZmFsc2VcblxuICAgIHJldHVybiBvcHRpb25hbEJvb2xlYW4odmFsdWUsIGRlc2NyaXB0aW9uKVxuICB9XG5cbiAgLyoqXG4gICAqIENvbnZlcnRzIGEgYm9vbGVhbiBzeW5jIHZhbHVlIHRvIFNRTGl0ZSBib29sZWFuIHN0b3JhZ2UuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbiB8IG51bGx9IHZhbHVlIC0gU3luYyBib29sZWFuIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7MCB8IDF9IFNRTGl0ZS1jb21wYXRpYmxlIGJvb2xlYW4gdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgc3FsaXRlQm9vbGVhblN5bmNWYWx1ZSh2YWx1ZSkge1xuICAgIHJldHVybiB2YWx1ZSA9PT0gdHJ1ZSA/IDEgOiAwXG4gIH1cblxuICAvKipcbiAgICogUHJvamVjdHMgZ2VuZXJpYyBzeW5jIGNvdW50ZXJzIGludG8gYXBwLXNwZWNpZmljIHJlc3VsdCBrZXlzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFJlc3VsdCBhcmdzLlxuICAgKiBAcGFyYW0ge1N5bmNDaGFuZ2VzUmVzdWx0fSBhcmdzLnJlc3VsdCAtIEdlbmVyaWMgVmVsb2Npb3VzIHN5bmMgcmVzdWx0LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHtjaGFuZ2VkS2V5OiBzdHJpbmcsIGNvdW50S2V5OiBzdHJpbmd9Pn0gYXJncy5yZXNvdXJjZXMgLSBSZXNvdXJjZSByZXN1bHQga2V5IG1hcC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSBQcm9qZWN0ZWQgcmVzdWx0LlxuICAgKi9cbiAgc3RhdGljIHN5bmNSZXN1bHRGb3JSZXNvdXJjZXMoe3Jlc3VsdCwgcmVzb3VyY2VzfSkge1xuICAgIGNvbnN0IHN5bmNSZXN1bHQgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSAqLyAoe1xuICAgICAgY2hhbmdlZDogcmVzdWx0LmNoYW5nZWQsXG4gICAgICBwYWdlczogcmVzdWx0LnBhZ2VzLFxuICAgICAgc3luY2VkQ291bnQ6IHJlc3VsdC5zeW5jZWRDb3VudFxuICAgIH0pXG5cbiAgICBmb3IgKGNvbnN0IFtyZXNvdXJjZVR5cGUsIGtleXNdIG9mIE9iamVjdC5lbnRyaWVzKHJlc291cmNlcykpIHtcbiAgICAgIHN5bmNSZXN1bHRba2V5cy5jb3VudEtleV0gPSByZXN1bHQucmVzb3VyY2VDb3VudHNbcmVzb3VyY2VUeXBlXSB8fCAwXG4gICAgICBzeW5jUmVzdWx0W2tleXMuY2hhbmdlZEtleV0gPSByZXN1bHQucmVzb3VyY2VDaGFuZ2VkW3Jlc291cmNlVHlwZV0gfHwgZmFsc2VcbiAgICB9XG5cbiAgICByZXR1cm4gc3luY1Jlc3VsdFxuICB9XG5cbiAgLyoqXG4gICAqIERyYWlucyBwZW5kaW5nIHN5bmMgcmVjb3JkcyBpbiBzdGFibGUgb3JkZXIgYW5kIG1hcmtzIGFja25vd2xlZGdlZCByb3dzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFJlcGxheSBhcmdzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5hdXRoZW50aWNhdGlvblRva2VuIC0gQXV0aCB0b2tlbiB0byBzZW5kIHdpdGggcmVwbGF5IHJlcXVlc3RzLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuYmF0Y2hTaXplXSAtIE1heCBzeW5jcyBwZXIgcmVxdWVzdC4gRGVmYXVsdHMgdG8gMTAwLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8QXJyYXk8dW5rbm93bj4+fSBhcmdzLnBlbmRpbmdTeW5jcyAtIExvYWRzIHBlbmRpbmcgbG9jYWwgc3luYyByb3dzIGluIHJlcGxheSBvcmRlci5cbiAgICogQHBhcmFtIHsoc3luYzogdW5rbm93bikgPT4gc3RyaW5nIHwgbnVtYmVyIHwgbnVsbCB8IHVuZGVmaW5lZH0gYXJncy5zeW5jSWQgLSBSZXR1cm5zIHRoZSBsb2NhbCBzeW5jIGlkLlxuICAgKiBAcGFyYW0geyhzeW5jOiB1bmtub3duKSA9PiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3Muc3luY1BheWxvYWQgLSBCdWlsZHMgdGhlIEFQSSBzeW5jIGVudmVsb3BlLlxuICAgKiBAcGFyYW0geyhwYXlsb2FkOiB7YXV0aGVudGljYXRpb25Ub2tlbjogc3RyaW5nLCBzeW5jczogQXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0sIG9wdGlvbnM/OiB7c2lnbmFsPzogQWJvcnRTaWduYWx9KSA9PiBQcm9taXNlPFN5bmNSZXBsYXlSZXNwb25zZT59IGFyZ3MucG9zdFJlcGxheSAtIFBvc3RzIG9uZSByZXBsYXkgcmVxdWVzdC5cbiAgICogQHBhcmFtIHsoc3luYzogdW5rbm93biwgcmVzcG9uc2U6IFN5bmNSZXBsYXlJdGVtKSA9PiBQcm9taXNlPHZvaWQ+fSBhcmdzLm1hcmtTdWNjZXNzZnVsIC0gTWFya3Mgb25lIHN5bmMgYXMgc3VjY2Vzc2Z1bCBsb2NhbGx5LlxuICAgKiBAcGFyYW0ge0Fib3J0U2lnbmFsfSBbYXJncy5zaWduYWxdIC0gTGlmZWN5Y2xlIGNhbmNlbGxhdGlvbiBzaWduYWwuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyBhZnRlciBhbGwgYmF0Y2hlcyBhcmUgcmVwbGF5ZWQuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgcmVwbGF5UGVuZGluZyhhcmdzKSB7XG4gICAgdGhyb3dJZlN5bmNBYm9ydGVkKGFyZ3Muc2lnbmFsKVxuICAgIGNvbnN0IHBlbmRpbmdTeW5jcyA9IGF3YWl0IGFyZ3MucGVuZGluZ1N5bmNzKClcbiAgICB0aHJvd0lmU3luY0Fib3J0ZWQoYXJncy5zaWduYWwpXG4gICAgY29uc3QgYmF0Y2hTaXplID0gdGhpcy5ub3JtYWxpemVkQmF0Y2hTaXplKGFyZ3MuYmF0Y2hTaXplKVxuXG4gICAgZm9yIChsZXQgb2Zmc2V0ID0gMDsgb2Zmc2V0IDwgcGVuZGluZ1N5bmNzLmxlbmd0aDsgb2Zmc2V0ICs9IGJhdGNoU2l6ZSkge1xuICAgICAgdGhyb3dJZlN5bmNBYm9ydGVkKGFyZ3Muc2lnbmFsKVxuICAgICAgYXdhaXQgdGhpcy5yZXBsYXlCYXRjaCh7Li4uYXJncywgcGVuZGluZ1N5bmNzOiBwZW5kaW5nU3luY3Muc2xpY2Uob2Zmc2V0LCBvZmZzZXQgKyBiYXRjaFNpemUpfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVwbGF5cyBvbmUgYmF0Y2ggb2Ygc3luY3MuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gUmVwbGF5IGFyZ3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmF1dGhlbnRpY2F0aW9uVG9rZW4gLSBBdXRoIHRva2VuLlxuICAgKiBAcGFyYW0ge0FycmF5PHVua25vd24+fSBhcmdzLnBlbmRpbmdTeW5jcyAtIEJhdGNoIHN5bmNzLlxuICAgKiBAcGFyYW0geyhzeW5jOiB1bmtub3duKSA9PiBzdHJpbmcgfCBudW1iZXIgfCBudWxsIHwgdW5kZWZpbmVkfSBhcmdzLnN5bmNJZCAtIFN5bmMgaWQgZ2V0dGVyLlxuICAgKiBAcGFyYW0geyhzeW5jOiB1bmtub3duKSA9PiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3Muc3luY1BheWxvYWQgLSBQYXlsb2FkIGJ1aWxkZXIuXG4gICAqIEBwYXJhbSB7KHBheWxvYWQ6IHthdXRoZW50aWNhdGlvblRva2VuOiBzdHJpbmcsIHN5bmNzOiBBcnJheTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSwgb3B0aW9ucz86IHtzaWduYWw/OiBBYm9ydFNpZ25hbH0pID0+IFByb21pc2U8U3luY1JlcGxheVJlc3BvbnNlPn0gYXJncy5wb3N0UmVwbGF5IC0gUmVwbGF5IHBvc3Rlci5cbiAgICogQHBhcmFtIHsoc3luYzogdW5rbm93biwgcmVzcG9uc2U6IFN5bmNSZXBsYXlJdGVtKSA9PiBQcm9taXNlPHZvaWQ+fSBhcmdzLm1hcmtTdWNjZXNzZnVsIC0gU3VjY2VzcyBob29rLlxuICAgKiBAcGFyYW0ge0Fib3J0U2lnbmFsfSBbYXJncy5zaWduYWxdIC0gTGlmZWN5Y2xlIGNhbmNlbGxhdGlvbiBzaWduYWwuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyBhZnRlciB0aGUgYmF0Y2ggaXMgYWNrbm93bGVkZ2VkLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHJlcGxheUJhdGNoKGFyZ3MpIHtcbiAgICBjb25zdCB7YXV0aGVudGljYXRpb25Ub2tlbiwgbWFya1N1Y2Nlc3NmdWwsIHBlbmRpbmdTeW5jcywgcG9zdFJlcGxheSwgc2lnbmFsLCBzeW5jSWQsIHN5bmNQYXlsb2FkfSA9IGFyZ3NcblxuICAgIGlmIChwZW5kaW5nU3luY3MubGVuZ3RoID09PSAwKSByZXR1cm5cbiAgICB0aHJvd0lmU3luY0Fib3J0ZWQoc2lnbmFsKVxuXG4gICAgY29uc3Qgc3luY3NCeUlkID0gbmV3IE1hcCgpXG5cbiAgICBmb3IgKGNvbnN0IHN5bmMgb2YgcGVuZGluZ1N5bmNzKSB7XG4gICAgICBjb25zdCBpZCA9IHN5bmNJZChzeW5jKVxuXG4gICAgICBpZiAoaWQgIT09IHVuZGVmaW5lZCAmJiBpZCAhPT0gbnVsbCkgc3luY3NCeUlkLnNldChTdHJpbmcoaWQpLCBzeW5jKVxuICAgIH1cblxuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgcG9zdFJlcGxheSh7XG4gICAgICBhdXRoZW50aWNhdGlvblRva2VuLFxuICAgICAgc3luY3M6IHBlbmRpbmdTeW5jcy5tYXAoKHN5bmMpID0+IHN5bmNQYXlsb2FkKHN5bmMpKVxuICAgIH0sIHtzaWduYWx9KVxuXG4gICAgdGhyb3dJZlN5bmNBYm9ydGVkKHNpZ25hbClcbiAgICB0aGlzLmVuc3VyZVN1Y2Nlc3NmdWxSZXNwb25zZShyZXNwb25zZSlcblxuICAgIGZvciAoY29uc3Qgc3luY1Jlc3BvbnNlIG9mIHJlc3BvbnNlLnN5bmNzIHx8IFtdKSB7XG4gICAgICB0aHJvd0lmU3luY0Fib3J0ZWQoc2lnbmFsKVxuICAgICAgY29uc3Qgc3luYyA9IHN5bmNzQnlJZC5nZXQoU3RyaW5nKHN5bmNSZXNwb25zZS5pZCkpXG5cbiAgICAgIGlmICghc3luYykgY29udGludWVcbiAgICAgIGlmIChzeW5jUmVzcG9uc2Uuc3luY1N0YXRlICE9PSBcInN1Y2Nlc3NmdWxcIikge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgc3luYyBzdGF0ZSByZXR1cm5lZCBmb3Igc3luYyAke1N0cmluZyhzeW5jUmVzcG9uc2UuaWQpfTogJHtTdHJpbmcoc3luY1Jlc3BvbnNlLnN5bmNTdGF0ZSl9YClcbiAgICAgIH1cblxuICAgICAgYXdhaXQgbWFya1N1Y2Nlc3NmdWwoc3luYywgc3luY1Jlc3BvbnNlKVxuICAgICAgdGhyb3dJZlN5bmNBYm9ydGVkKHNpZ25hbClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ2hlY2tzIEFQSSByZXNwb25zZSBzdGF0dXMgYW5kIHNoYXBlLlxuICAgKiBAcGFyYW0ge1N5bmNSZXBsYXlSZXNwb25zZX0gcmVzcG9uc2UgLSBSZXBsYXkgcmVzcG9uc2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIGVuc3VyZVN1Y2Nlc3NmdWxSZXNwb25zZShyZXNwb25zZSkge1xuICAgIGlmIChyZXNwb25zZS5zdGF0dXMgPT09IFwiZXJyb3JcIikgdGhyb3cgbmV3IEVycm9yKHJlc3BvbnNlLmVycm9yTWVzc2FnZSB8fCBcIlN5bmMgZmFpbGVkXCIpXG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHJlc3BvbnNlLnN5bmNzKSkgdGhyb3cgbmV3IEVycm9yKFwiU3luYyByZXNwb25zZSBtaXNzaW5nIHN5bmNzXCIpXG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplcyBhIHBvc2l0aXZlIGJhdGNoIHNpemUuXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgdW5kZWZpbmVkfSBiYXRjaFNpemUgLSBCYXRjaCBzaXplLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSBQb3NpdGl2ZSBiYXRjaCBzaXplLlxuICAgKi9cbiAgc3RhdGljIG5vcm1hbGl6ZWRCYXRjaFNpemUoYmF0Y2hTaXplKSB7XG4gICAgaWYgKHR5cGVvZiBiYXRjaFNpemUgIT09IFwibnVtYmVyXCIgfHwgIU51bWJlci5pc0Zpbml0ZShiYXRjaFNpemUpIHx8IGJhdGNoU2l6ZSA8IDEpIHJldHVybiAxMDBcblxuICAgIHJldHVybiBNYXRoLmZsb29yKGJhdGNoU2l6ZSlcbiAgfVxufVxuXG4vKipcbiAqIFRocm93cyB0aGUgZXhhY3QgYWJvcnQgcmVhc29uIGF0IGxpZmVjeWNsZSBib3VuZGFyaWVzIHNvIGNhbGxlcnMgY2FuXG4gKiBkaXN0aW5ndWlzaCBhbiBleHBlY3RlZCBjb29wZXJhdGl2ZSBzdG9wIGZyb20gdHJhbnNwb3J0IG9yIGFwcGx5IGZhaWx1cmVzLlxuICogQHBhcmFtIHtBYm9ydFNpZ25hbCB8IHVuZGVmaW5lZH0gc2lnbmFsIC0gTGlmZWN5Y2xlIHNpZ25hbC5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiB0aHJvd0lmU3luY0Fib3J0ZWQoc2lnbmFsKSB7XG4gIGlmICghc2lnbmFsPy5hYm9ydGVkKSByZXR1cm5cblxuICB0aHJvdyBzaWduYWwucmVhc29uIGluc3RhbmNlb2YgRXJyb3IgPyBzaWduYWwucmVhc29uIDogbmV3IEVycm9yKFwiU3luYyBvcGVyYXRpb24gYWJvcnRlZFwiKVxufVxuIl19