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
     * @param {import("./sync-offline-session.js").default} [args.offlineSession] - Active long-offline session: the mutation identity (actor ids, grant id, policy hash) is supplied by the session and the appended record carries the device-signed envelope.
     * @param {"create" | "update" | "destroy"} args.operation - Local operation.
     * @param {ReturnType<typeof JSON.parse>} args.resource - Local resource.
     * @param {string} args.resourceType - Resource type.
     * @param {string} args.syncType - Wire operation.
     * @returns {Promise<import("./local-mutation-log.js").LocalMutationLogRecord>} Appended intent.
     */
    static async queueConflictTrackedSync({ baseVersion, conflictTracking, data, offlineSession, operation, resource, resourceType, syncType }) {
        const resourceId = String(scalarModelPrimaryKeyValue(resource.id(), `Conflict-tracked sync for ${resourceType}`));
        const records = await conflictTracking.mutationLog.records();
        const predecessor = records
            .filter((record) => record.mutation.model === resourceType && record.mutation.payload?.resourceId === resourceId)
            .at(-1);
        const clientMutationId = conflictTracking.clientMutationId();
        const now = conflictTracking.now ? conflictTracking.now() : new Date();
        const predecessorTime = predecessor ? new Date(predecessor.mutation.occurredAt).getTime() : Number.NEGATIVE_INFINITY;
        const occurredAt = new Date(Math.max(now.getTime(), predecessorTime + 1)).toISOString();
        const dependencies = predecessor ? [{ clientMutationId: predecessor.mutation.clientMutationId, model: resourceType }] : [];
        const attributes = /** @type {Record<string, import("../configuration-types.js").FrontendModelSyncJsonValue>} */ (data);
        if (offlineSession) {
            // Long-offline queueing: the session supplies the rotating identity
            // (actor ids, live grant id, current policy hash) and signs the intent
            // with the device key so it can replay without a live session.
            const signedMutation = await offlineSession.signMutation({
                attributes,
                baseVersion,
                clientMutationId,
                model: resourceType,
                occurredAt,
                operation,
                payload: { resourceId, syncType }
            });
            return await conflictTracking.mutationLog.append({ dependencies, mutation: signedMutation.mutation, signedMutation });
        }
        return await conflictTracking.mutationLog.append({
            dependencies,
            mutation: {
                actorDeviceId: await resolveConflictTrackingIdentityValue({ conflictTracking, key: "actorDeviceId", resourceType }),
                actorUserId: await resolveConflictTrackingIdentityValue({ conflictTracking, key: "actorUserId", resourceType }),
                attributes,
                baseVersion,
                clientMutationId,
                model: resourceType,
                occurredAt,
                offlineGrantId: await resolveConflictTrackingIdentityValue({ conflictTracking, key: "offlineGrantId", resourceType }),
                operation,
                payload: { resourceId, syncType },
                policyHash: await resolveConflictTrackingIdentityValue({ conflictTracking, key: "policyHash", resourceType })
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
            serverSequence: () => this.normalizedServerSequence(syncPayload.serverSequence),
            syncType: () => syncPayload.syncType === null || syncPayload.syncType === undefined ? "" : String(syncPayload.syncType),
            updatedAt: () => syncPayload.updatedAt === null || syncPayload.updatedAt === undefined ? null : String(syncPayload.updatedAt)
        };
    }
    /**
     * Normalizes a raw server sequence into a positive safe integer.
     * @param {unknown} value - Raw sequence.
     * @returns {number | null} Normalized sequence, or null when absent/invalid.
     */
    static normalizedServerSequence(value) {
        if (value === null || value === undefined || value === "")
            return null;
        const sequence = Number(value);
        if (!Number.isSafeInteger(sequence) || sequence <= 0)
            return null;
        return sequence;
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
/**
 * Resolves one conflict-tracking identity field at queue time: a static string
 * or a function (sync or async) resolving the current value. Grants and policy
 * hashes rotate at runtime, so declarations may resolve them per mutation.
 * @param {{conflictTracking: import("./sync-client-types.js").SyncClientConflictTrackingConfig, key: "actorDeviceId" | "actorUserId" | "offlineGrantId" | "policyHash", resourceType: string}} args - Resolution args.
 * @returns {Promise<string>} - Resolved non-empty identity value.
 */
async function resolveConflictTrackingIdentityValue({ conflictTracking, key, resourceType }) {
    const value = conflictTracking[key];
    if (typeof value === "function") {
        const resolved = await value();
        if (typeof resolved !== "string" || resolved.length === 0) {
            throw new Error(`${resourceType} conflictTracking.${key} resolved to an empty value`);
        }
        return resolved;
    }
    if (typeof value === "string" && value.length > 0)
        return value;
    throw new Error(`${resourceType} conflictTracking.${key} must be a non-empty string or a function resolving one (or start an offline session)`);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3luYy1hcGktY2xpZW50LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3N5bmMvc3luYy1hcGktY2xpZW50LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUMsZUFBZSxFQUFFLGVBQWUsRUFBQyxNQUFNLFNBQVMsQ0FBQTtBQUV4RCxPQUFPLGFBQWEsTUFBTSwrQkFBK0IsQ0FBQTtBQUN6RCxPQUFPLEVBQUMsMEJBQTBCLEVBQUMsTUFBTSwrQkFBK0IsQ0FBQTtBQUN4RSxPQUFPLEVBQUMsdUNBQXVDLEVBQUMsTUFBTSx3QkFBd0IsQ0FBQTtBQUU5RSxrR0FBa0c7QUFDbEcsNEZBQTRGO0FBQzVGLDRGQUE0RjtBQUM1Riw4RkFBOEY7QUFDOUYsMEZBQTBGO0FBQzFGLDRFQUE0RTtBQUM1RSxvRkFBb0Y7QUFDcEYsNEZBQTRGO0FBQzVGLDRGQUE0RjtBQUM1RixNQUFNLGdCQUFnQixHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7QUFFbEM7Ozs7R0FJRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8sYUFBYTtJQUNoQzs7Ozs7Ozs7Ozs7O09BWUc7SUFDSCxNQUFNLENBQUMsS0FBSyxDQUFDLHdCQUF3QixDQUFDLEVBQUMsV0FBVyxFQUFFLGdCQUFnQixFQUFFLElBQUksRUFBRSxjQUFjLEVBQUUsU0FBUyxFQUFFLFFBQVEsRUFBRSxZQUFZLEVBQUUsUUFBUSxFQUFDO1FBQ3RJLE1BQU0sVUFBVSxHQUFHLE1BQU0sQ0FBQywwQkFBMEIsQ0FBQyxRQUFRLENBQUMsRUFBRSxFQUFFLEVBQUUsNkJBQTZCLFlBQVksRUFBRSxDQUFDLENBQUMsQ0FBQTtRQUNqSCxNQUFNLE9BQU8sR0FBRyxNQUFNLGdCQUFnQixDQUFDLFdBQVcsQ0FBQyxPQUFPLEVBQUUsQ0FBQTtRQUM1RCxNQUFNLFdBQVcsR0FBRyxPQUFPO2FBQ3hCLE1BQU0sQ0FBQyxDQUFDLE1BQU0sRUFBRSxFQUFFLENBQUMsTUFBTSxD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InNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQge29wdGlvbmFsQm9vbGVhbiwgb3B0aW9uYWxJbnRlZ2VyfSBmcm9tIFwidHlwYW5pY1wiXG5cbmltcG9ydCByZWNvcmRDaGFuZ2VzIGZyb20gXCIuLi9kYXRhYmFzZS9yZWNvcmQtY2hhbmdlcy5qc1wiXG5pbXBvcnQge3NjYWxhck1vZGVsUHJpbWFyeUtleVZhbHVlfSBmcm9tIFwiLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIlxuaW1wb3J0IHthcHBseVN5bmNSZXBsYXlSZXN1bHRUb0xvY2FsTXV0YXRpb25Mb2d9IGZyb20gXCIuL2NvbmZsaWN0LXN0cmF0ZWd5LmpzXCJcblxuLyoqIEB0eXBlZGVmIHtpbXBvcnQoXCIuL3N5bmMtYXBpLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2hhbmdlQXBwbHlSZXN1bHR9IFN5bmNDaGFuZ2VBcHBseVJlc3VsdCAqL1xuLyoqIEB0eXBlZGVmIHtpbXBvcnQoXCIuL3N5bmMtYXBpLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2hhbmdlRW52ZWxvcGV9IFN5bmNDaGFuZ2VFbnZlbG9wZSAqL1xuLyoqIEB0eXBlZGVmIHtpbXBvcnQoXCIuL3N5bmMtYXBpLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2hhbmdlc1JlcXVlc3R9IFN5bmNDaGFuZ2VzUmVxdWVzdCAqL1xuLyoqIEB0eXBlZGVmIHtpbXBvcnQoXCIuL3N5bmMtYXBpLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2hhbmdlc1Jlc3BvbnNlfSBTeW5jQ2hhbmdlc1Jlc3BvbnNlICovXG4vKiogQHR5cGVkZWYge2ltcG9ydChcIi4vc3luYy1hcGktY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDaGFuZ2VzUmVzdWx0fSBTeW5jQ2hhbmdlc1Jlc3VsdCAqL1xuLyoqIEB0eXBlZGVmIHtpbXBvcnQoXCIuL3N5bmMtYXBpLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ3Vyc29yfSBTeW5jQ3Vyc29yICovXG4vKiogQHR5cGVkZWYge2ltcG9ydChcIi4vc3luYy1hcGktY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNSZXBsYXlJdGVtfSBTeW5jUmVwbGF5SXRlbSAqL1xuLyoqIEB0eXBlZGVmIHtpbXBvcnQoXCIuL3N5bmMtYXBpLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jUmVwbGF5UmVzcG9uc2V9IFN5bmNSZXBsYXlSZXNwb25zZSAqL1xuLyoqIEB0eXBlZGVmIHtpbXBvcnQoXCIuL3N5bmMtYXBpLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jUmVzb3VyY2VDb25maWd9IFN5bmNSZXNvdXJjZUNvbmZpZyAqL1xuY29uc3Qgc3luY1Rhc2tQcm9taXNlcyA9IG5ldyBNYXAoKVxuXG4vKipcbiAqIEdlbmVyaWMgY2xpZW50LXNpZGUgaGVscGVyIGZvciByZXBsYXlpbmcgcGVuZGluZyBzeW5jIGVudmVsb3BlcyB0aHJvdWdoIHRoZVxuICogZnJhbWV3b3JrLW93bmVkIGAvdmVsb2Npb3VzL3N5bmMvcmVwbGF5YCBlbmRwb2ludC4gQXBwcyBwcm92aWRlIG9ubHkgbG9jYWxcbiAqIHBlcnNpc3RlbmNlL2F1dGggaG9va3MuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFN5bmNBcGlDbGllbnQge1xuICAvKipcbiAgICogQXBwZW5kcyBvbmUgY29uZmxpY3QtdHJhY2tlZCBpbnRlbnQgdG8gdGhlIGV4aXN0aW5nIGR1cmFibGUgbXV0YXRpb24gbG9nLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFF1ZXVlIGFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBudW1iZXIgfCBudWxsfSBhcmdzLmJhc2VWZXJzaW9uIC0gQXV0aG9yaXRhdGl2ZSB2ZXJzaW9uIG9ic2VydmVkIGJlZm9yZSB0aGUgbG9jYWwgbXV0YXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2xpZW50Q29uZmxpY3RUcmFja2luZ0NvbmZpZ30gYXJncy5jb25mbGljdFRyYWNraW5nIC0gRHVyYWJsZSB0cmFja2luZyBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSBhcmdzLmRhdGEgLSBCYWNrZW5kLXNhZmUgbXV0YXRpb24gYXR0cmlidXRlcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3N5bmMtb2ZmbGluZS1zZXNzaW9uLmpzXCIpLmRlZmF1bHR9IFthcmdzLm9mZmxpbmVTZXNzaW9uXSAtIEFjdGl2ZSBsb25nLW9mZmxpbmUgc2Vzc2lvbjogdGhlIG11dGF0aW9uIGlkZW50aXR5IChhY3RvciBpZHMsIGdyYW50IGlkLCBwb2xpY3kgaGFzaCkgaXMgc3VwcGxpZWQgYnkgdGhlIHNlc3Npb24gYW5kIHRoZSBhcHBlbmRlZCByZWNvcmQgY2FycmllcyB0aGUgZGV2aWNlLXNpZ25lZCBlbnZlbG9wZS5cbiAgICogQHBhcmFtIHtcImNyZWF0ZVwiIHwgXCJ1cGRhdGVcIiB8IFwiZGVzdHJveVwifSBhcmdzLm9wZXJhdGlvbiAtIExvY2FsIG9wZXJhdGlvbi5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5yZXNvdXJjZSAtIExvY2FsIHJlc291cmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5yZXNvdXJjZVR5cGUgLSBSZXNvdXJjZSB0eXBlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zeW5jVHlwZSAtIFdpcmUgb3BlcmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL2xvY2FsLW11dGF0aW9uLWxvZy5qc1wiKS5Mb2NhbE11dGF0aW9uTG9nUmVjb3JkPn0gQXBwZW5kZWQgaW50ZW50LlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHF1ZXVlQ29uZmxpY3RUcmFja2VkU3luYyh7YmFzZVZlcnNpb24sIGNvbmZsaWN0VHJhY2tpbmcsIGRhdGEsIG9mZmxpbmVTZXNzaW9uLCBvcGVyYXRpb24sIHJlc291cmNlLCByZXNvdXJjZVR5cGUsIHN5bmNUeXBlfSkge1xuICAgIGNvbnN0IHJlc291cmNlSWQgPSBTdHJpbmcoc2NhbGFyTW9kZWxQcmltYXJ5S2V5VmFsdWUocmVzb3VyY2UuaWQoKSwgYENvbmZsaWN0LXRyYWNrZWQgc3luYyBmb3IgJHtyZXNvdXJjZVR5cGV9YCkpXG4gICAgY29uc3QgcmVjb3JkcyA9IGF3YWl0IGNvbmZsaWN0VHJhY2tpbmcubXV0YXRpb25Mb2cucmVjb3JkcygpXG4gICAgY29uc3QgcHJlZGVjZXNzb3IgPSByZWNvcmRzXG4gICAgICAuZmlsdGVyKChyZWNvcmQpID0+IHJlY29yZC5tdXRhdGlvbi5tb2RlbCA9PT0gcmVzb3VyY2VUeXBlICYmIHJlY29yZC5tdXRhdGlvbi5wYXlsb2FkPy5yZXNvdXJjZUlkID09PSByZXNvdXJjZUlkKVxuICAgICAgLmF0KC0xKVxuICAgIGNvbnN0IGNsaWVudE11dGF0aW9uSWQgPSBjb25mbGljdFRyYWNraW5nLmNsaWVudE11dGF0aW9uSWQoKVxuICAgIGNvbnN0IG5vdyA9IGNvbmZsaWN0VHJhY2tpbmcubm93ID8gY29uZmxpY3RUcmFja2luZy5ub3coKSA6IG5ldyBEYXRlKClcbiAgICBjb25zdCBwcmVkZWNlc3NvclRpbWUgPSBwcmVkZWNlc3NvciA/IG5ldyBEYXRlKHByZWRlY2Vzc29yLm11dGF0aW9uLm9jY3VycmVkQXQpLmdldFRpbWUoKSA6IE51bWJlci5ORUdBVElWRV9JTkZJTklUWVxuICAgIGNvbnN0IG9jY3VycmVkQXQgPSBuZXcgRGF0ZShNYXRoLm1heChub3cuZ2V0VGltZSgpLCBwcmVkZWNlc3NvclRpbWUgKyAxKSkudG9JU09TdHJpbmcoKVxuXG4gICAgY29uc3QgZGVwZW5kZW5jaWVzID0gcHJlZGVjZXNzb3IgPyBbe2NsaWVudE11dGF0aW9uSWQ6IHByZWRlY2Vzc29yLm11dGF0aW9uLmNsaWVudE11dGF0aW9uSWQsIG1vZGVsOiByZXNvdXJjZVR5cGV9XSA6IFtdXG4gICAgY29uc3QgYXR0cmlidXRlcyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsU3luY0pzb25WYWx1ZT59ICovIChkYXRhKVxuXG4gICAgaWYgKG9mZmxpbmVTZXNzaW9uKSB7XG4gICAgICAvLyBMb25nLW9mZmxpbmUgcXVldWVpbmc6IHRoZSBzZXNzaW9uIHN1cHBsaWVzIHRoZSByb3RhdGluZyBpZGVudGl0eVxuICAgICAgLy8gKGFjdG9yIGlkcywgbGl2ZSBncmFudCBpZCwgY3VycmVudCBwb2xpY3kgaGFzaCkgYW5kIHNpZ25zIHRoZSBpbnRlbnRcbiAgICAgIC8vIHdpdGggdGhlIGRldmljZSBrZXkgc28gaXQgY2FuIHJlcGxheSB3aXRob3V0IGEgbGl2ZSBzZXNzaW9uLlxuICAgICAgY29uc3Qgc2lnbmVkTXV0YXRpb24gPSBhd2FpdCBvZmZsaW5lU2Vzc2lvbi5zaWduTXV0YXRpb24oe1xuICAgICAgICBhdHRyaWJ1dGVzLFxuICAgICAgICBiYXNlVmVyc2lvbixcbiAgICAgICAgY2xpZW50TXV0YXRpb25JZCxcbiAgICAgICAgbW9kZWw6IHJlc291cmNlVHlwZSxcbiAgICAgICAgb2NjdXJyZWRBdCxcbiAgICAgICAgb3BlcmF0aW9uLFxuICAgICAgICBwYXlsb2FkOiB7cmVzb3VyY2VJZCwgc3luY1R5cGV9XG4gICAgICB9KVxuXG4gICAgICByZXR1cm4gYXdhaXQgY29uZmxpY3RUcmFja2luZy5tdXRhdGlvbkxvZy5hcHBlbmQoe2RlcGVuZGVuY2llcywgbXV0YXRpb246IHNpZ25lZE11dGF0aW9uLm11dGF0aW9uLCBzaWduZWRNdXRhdGlvbn0pXG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IGNvbmZsaWN0VHJhY2tpbmcubXV0YXRpb25Mb2cuYXBwZW5kKHtcbiAgICAgIGRlcGVuZGVuY2llcyxcbiAgICAgIG11dGF0aW9uOiB7XG4gICAgICAgIGFjdG9yRGV2aWNlSWQ6IGF3YWl0IHJlc29sdmVDb25mbGljdFRyYWNraW5nSWRlbnRpdHlWYWx1ZSh7Y29uZmxpY3RUcmFja2luZywga2V5OiBcImFjdG9yRGV2aWNlSWRcIiwgcmVzb3VyY2VUeXBlfSksXG4gICAgICAgIGFjdG9yVXNlcklkOiBhd2FpdCByZXNvbHZlQ29uZmxpY3RUcmFja2luZ0lkZW50aXR5VmFsdWUoe2NvbmZsaWN0VHJhY2tpbmcsIGtleTogXCJhY3RvclVzZXJJZFwiLCByZXNvdXJjZVR5cGV9KSxcbiAgICAgICAgYXR0cmlidXRlcyxcbiAgICAgICAgYmFzZVZlcnNpb24sXG4gICAgICAgIGNsaWVudE11dGF0aW9uSWQsXG4gICAgICAgIG1vZGVsOiByZXNvdXJjZVR5cGUsXG4gICAgICAgIG9jY3VycmVkQXQsXG4gICAgICAgIG9mZmxpbmVHcmFudElkOiBhd2FpdCByZXNvbHZlQ29uZmxpY3RUcmFja2luZ0lkZW50aXR5VmFsdWUoe2NvbmZsaWN0VHJhY2tpbmcsIGtleTogXCJvZmZsaW5lR3JhbnRJZFwiLCByZXNvdXJjZVR5cGV9KSxcbiAgICAgICAgb3BlcmF0aW9uLFxuICAgICAgICBwYXlsb2FkOiB7cmVzb3VyY2VJZCwgc3luY1R5cGV9LFxuICAgICAgICBwb2xpY3lIYXNoOiBhd2FpdCByZXNvbHZlQ29uZmxpY3RUcmFja2luZ0lkZW50aXR5VmFsdWUoe2NvbmZsaWN0VHJhY2tpbmcsIGtleTogXCJwb2xpY3lIYXNoXCIsIHJlc291cmNlVHlwZX0pXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBEcmFpbnMgdGhlIGV4aXN0aW5nIG11dGF0aW9uIGxvZyBpbiBwcmVkZWNlc3NvciBvcmRlci4gSW5kZXBlbmRlbnQgcmVjb3Jkc1xuICAgKiBjb250aW51ZSBhZnRlciBkdXJhYmxlIGNvbmZsaWN0cy9yZWplY3Rpb25zOyBzdWNjZXNzb3JzIHN0YXkgYmxvY2tlZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBSZXBsYXkgYXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5hdXRoZW50aWNhdGlvblRva2VuIC0gQXV0aGVudGljYXRpb24gdG9rZW4uXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5iYXRjaFNpemVdIC0gQmF0Y2ggc2l6ZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDbGllbnRDb25mbGljdFRyYWNraW5nQ29uZmlnfSBhcmdzLmNvbmZsaWN0VHJhY2tpbmcgLSBUcmFja2luZyBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0geyhwYXlsb2FkOiB7YXV0aGVudGljYXRpb25Ub2tlbjogc3RyaW5nLCBzeW5jczogQXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0sIG9wdGlvbnM/OiB7c2lnbmFsPzogQWJvcnRTaWduYWx9KSA9PiBQcm9taXNlPFN5bmNSZXBsYXlSZXNwb25zZT59IGFyZ3MucG9zdFJlcGxheSAtIFRyYW5zcG9ydCBib3VuZGFyeS5cbiAgICogQHBhcmFtIHsoYXJnczoge3JlY29yZDogaW1wb3J0KFwiLi9sb2NhbC1tdXRhdGlvbi1sb2cuanNcIikuTG9jYWxNdXRhdGlvbkxvZ1JlY29yZCwgcmVzdWx0OiBTeW5jUmVwbGF5SXRlbX0pID0+IFByb21pc2U8dm9pZD59IFthcmdzLmFwcGx5Q29uZmxpY3RdIC0gQXBwbGllcyBhdXRob3JpdGF0aXZlIGNvbmZsaWN0IHN0YXRlIHRvIHRoZSBsb2NhbCByZXBsaWNhIGJlZm9yZSBwcmVzZXJ2aW5nIHRoZSByZWplY3RlZCBpbnRlbnQuXG4gICAqIEBwYXJhbSB7KGlkZW50aXR5OiBzdHJpbmcpID0+IG51bWJlcn0gYXJncy5yZW1vdGVHZW5lcmF0aW9uIC0gQ3VycmVudCByZW1vdGUgZ2VuZXJhdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucmVzb3VyY2VUeXBlIC0gUmVzb3VyY2Ugd2hvc2UgbG9nIHJlY29yZHMgc2hvdWxkIGRyYWluLlxuICAgKiBAcGFyYW0ge0Fib3J0U2lnbmFsfSBbYXJncy5zaWduYWxdIC0gTGlmZWN5Y2xlIGNhbmNlbGxhdGlvbiBzaWduYWwuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyB3aGVuIG5vIHJlYWR5IGludGVudCByZW1haW5zLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHJlcGxheUNvbmZsaWN0VHJhY2tlZFN5bmNzKHthcHBseUNvbmZsaWN0LCBhdXRoZW50aWNhdGlvblRva2VuLCBiYXRjaFNpemUsIGNvbmZsaWN0VHJhY2tpbmcsIHBvc3RSZXBsYXksIHJlbW90ZUdlbmVyYXRpb24sIHJlc291cmNlVHlwZSwgc2lnbmFsfSkge1xuICAgIGNvbnN0IG1heEJhdGNoU2l6ZSA9IHRoaXMubm9ybWFsaXplZEJhdGNoU2l6ZShiYXRjaFNpemUpXG5cbiAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgdGhyb3dJZlN5bmNBYm9ydGVkKHNpZ25hbClcbiAgICAgIGNvbnN0IHJlY29yZHMgPSBhd2FpdCBjb25mbGljdFRyYWNraW5nLm11dGF0aW9uTG9nLnJlY29yZHMoKVxuICAgICAgdGhyb3dJZlN5bmNBYm9ydGVkKHNpZ25hbClcbiAgICAgIGNvbnN0IHN0YXR1c2VzID0gbmV3IE1hcChyZWNvcmRzLm1hcCgocmVjb3JkKSA9PiBbcmVjb3JkLm11dGF0aW9uLmNsaWVudE11dGF0aW9uSWQsIHJlY29yZC5zdGF0dXNdKSlcbiAgICAgIGNvbnN0IHBlbmRpbmcgPSByZWNvcmRzLmZpbHRlcigocmVjb3JkKSA9PiByZWNvcmQuc3RhdHVzID09PSBcInBlbmRpbmdcIiAmJiByZWNvcmQubXV0YXRpb24ubW9kZWwgPT09IHJlc291cmNlVHlwZSlcbiAgICAgIGNvbnN0IHJlYWR5ID0gcGVuZGluZy5maWx0ZXIoKHJlY29yZCkgPT4gcmVjb3JkLmRlcGVuZGVuY2llcy5ldmVyeSgoZGVwZW5kZW5jeSkgPT4gc3RhdHVzZXMuZ2V0KGRlcGVuZGVuY3kuY2xpZW50TXV0YXRpb25JZCkgPT09IFwic3luY2VkXCIpKVxuXG4gICAgICBpZiAocmVhZHkubGVuZ3RoID09PSAwKSByZXR1cm5cblxuICAgICAgY29uc3QgZ3JvdXBzID0gdGhpcy5jb25mbGljdFJlcGxheUdyb3Vwcyh7cGVuZGluZywgcmVhZHl9KS5zbGljZSgwLCBtYXhCYXRjaFNpemUpXG4gICAgICBjb25zdCBnZW5lcmF0aW9ucyA9IG5ldyBNYXAoZ3JvdXBzLm1hcCgoZ3JvdXApID0+IFtncm91cFswXS5tdXRhdGlvbi5jbGllbnRNdXRhdGlvbklkLCByZW1vdGVHZW5lcmF0aW9uKHRoaXMuY29uZmxpY3RSZWNvcmRJZGVudGl0eShncm91cFswXSkpXSkpXG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHBvc3RSZXBsYXkoe1xuICAgICAgICBhdXRoZW50aWNhdGlvblRva2VuLFxuICAgICAgICBzeW5jczogZ3JvdXBzLm1hcCgoZ3JvdXApID0+IHRoaXMuY29uZmxpY3RSZXBsYXlQYXlsb2FkKGdyb3VwKSlcbiAgICAgIH0sIHtzaWduYWx9KVxuXG4gICAgICB0aHJvd0lmU3luY0Fib3J0ZWQoc2lnbmFsKVxuICAgICAgdGhpcy5lbnN1cmVTdWNjZXNzZnVsUmVzcG9uc2UocmVzcG9uc2UpXG5cbiAgICAgIGNvbnN0IHJlc3BvbnNlc0J5SWQgPSBuZXcgTWFwKChyZXNwb25zZS5zeW5jcyB8fCBbXSkubWFwKChyZXN1bHQpID0+IFtTdHJpbmcocmVzdWx0LmlkKSwgcmVzdWx0XSkpXG5cbiAgICAgIGZvciAoY29uc3QgZ3JvdXAgb2YgZ3JvdXBzKSB7XG4gICAgICAgIHRocm93SWZTeW5jQWJvcnRlZChzaWduYWwpXG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IHJlc3BvbnNlc0J5SWQuZ2V0KGdyb3VwWzBdLm11dGF0aW9uLmNsaWVudE11dGF0aW9uSWQpXG5cbiAgICAgICAgaWYgKCFyZXN1bHQpIHRocm93IG5ldyBFcnJvcihgU3luYyByZXNwb25zZSBtaXNzaW5nIHJlc3VsdCBmb3IgbXV0YXRpb24gJHtncm91cFswXS5tdXRhdGlvbi5jbGllbnRNdXRhdGlvbklkfWApXG4gICAgICAgIGlmICghW1wic3VjY2Vzc2Z1bFwiLCBcImR1cGxpY2F0ZVwiLCBcImNvbmZsaWN0XCIsIFwiZmFpbGVkXCIsIFwicmVqZWN0ZWRcIl0uaW5jbHVkZXMocmVzdWx0LnN5bmNTdGF0ZSkpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgc3luYyBzdGF0ZSByZXR1cm5lZCBmb3IgbXV0YXRpb24gJHtncm91cFswXS5tdXRhdGlvbi5jbGllbnRNdXRhdGlvbklkfTogJHtyZXN1bHQuc3luY1N0YXRlfWApXG4gICAgICAgIH1cblxuICAgICAgICBpZiAocmVzdWx0LnN5bmNTdGF0ZSA9PT0gXCJjb25mbGljdFwiICYmIGFwcGx5Q29uZmxpY3QpIHtcbiAgICAgICAgICBhd2FpdCBhcHBseUNvbmZsaWN0KHtyZWNvcmQ6IGdyb3VwWzBdLCByZXN1bHR9KVxuICAgICAgICAgIHRocm93SWZTeW5jQWJvcnRlZChzaWduYWwpXG4gICAgICAgIH1cblxuICAgICAgICBmb3IgKGNvbnN0IHJlY29yZCBvZiBncm91cCkge1xuICAgICAgICAgIGF3YWl0IGFwcGx5U3luY1JlcGxheVJlc3VsdFRvTG9jYWxNdXRhdGlvbkxvZyh7bXV0YXRpb25Mb2c6IGNvbmZsaWN0VHJhY2tpbmcubXV0YXRpb25Mb2csIHJlY29yZCwgcmVzdWx0OiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHJlc3VsdCl9KVxuICAgICAgICAgIHRocm93SWZTeW5jQWJvcnRlZChzaWduYWwpXG4gICAgICAgIH1cblxuICAgICAgICBpZiAoW1wic3VjY2Vzc2Z1bFwiLCBcImR1cGxpY2F0ZVwiXS5pbmNsdWRlcyhyZXN1bHQuc3luY1N0YXRlKSAmJiByZXN1bHQuc2VydmVyVmVyc2lvbiAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgY29uc3QgaWRlbnRpdHkgPSB0aGlzLmNvbmZsaWN0UmVjb3JkSWRlbnRpdHkoZ3JvdXBbMF0pXG5cbiAgICAgICAgICBpZiAocmVtb3RlR2VuZXJhdGlvbihpZGVudGl0eSkgPT09IGdlbmVyYXRpb25zLmdldChncm91cFswXS5tdXRhdGlvbi5jbGllbnRNdXRhdGlvbklkKSkge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5yZWJhc2VDb25mbGljdFN1Y2Nlc3Nvcih7Y29uZmxpY3RUcmFja2luZywgcHJlZGVjZXNzb3I6IGdyb3VwW2dyb3VwLmxlbmd0aCAtIDFdLCBzZXJ2ZXJWZXJzaW9uOiByZXN1bHQuc2VydmVyVmVyc2lvbn0pXG4gICAgICAgICAgICB0aHJvd0lmU3luY0Fib3J0ZWQoc2lnbmFsKVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgc2FmZSB0cmFuc3BvcnQgZ3JvdXBzIGZyb20gcm9vdC1yZWFkeSByZWNvcmRzIGFuZCB0aGVpciBzdWNjZXNzb3JzLlxuICAgKiBAcGFyYW0ge3twZW5kaW5nOiBBcnJheTxpbXBvcnQoXCIuL2xvY2FsLW11dGF0aW9uLWxvZy5qc1wiKS5Mb2NhbE11dGF0aW9uTG9nUmVjb3JkPiwgcmVhZHk6IEFycmF5PGltcG9ydChcIi4vbG9jYWwtbXV0YXRpb24tbG9nLmpzXCIpLkxvY2FsTXV0YXRpb25Mb2dSZWNvcmQ+fX0gYXJncyAtIFBlbmRpbmcgYW5kIHJvb3QtcmVhZHkgcmVjb3Jkcy5cbiAgICogQHJldHVybnMge0FycmF5PEFycmF5PGltcG9ydChcIi4vbG9jYWwtbXV0YXRpb24tbG9nLmpzXCIpLkxvY2FsTXV0YXRpb25Mb2dSZWNvcmQ+Pn0gU2FmZSB0cmFuc3BvcnQgZ3JvdXBzLlxuICAgKi9cbiAgc3RhdGljIGNvbmZsaWN0UmVwbGF5R3JvdXBzKHtwZW5kaW5nLCByZWFkeX0pIHtcbiAgICBjb25zdCBncm91cHMgPSBbXVxuICAgIGNvbnN0IHNlbGVjdGVkSWRlbnRpdGllcyA9IG5ldyBTZXQoKVxuXG4gICAgZm9yIChjb25zdCByZWNvcmQgb2YgcmVhZHkpIHtcbiAgICAgIGNvbnN0IGlkZW50aXR5ID0gdGhpcy5jb25mbGljdFJlY29yZElkZW50aXR5KHJlY29yZClcblxuICAgICAgaWYgKHNlbGVjdGVkSWRlbnRpdGllcy5oYXMoaWRlbnRpdHkpKSBjb250aW51ZVxuXG4gICAgICBjb25zdCBncm91cCA9IFtyZWNvcmRdXG4gICAgICBsZXQgdGFpbCA9IHJlY29yZFxuXG4gICAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgICBjb25zdCBzdWNjZXNzb3IgPSBwZW5kaW5nLmZpbmQoKGNhbmRpZGF0ZSkgPT4gY2FuZGlkYXRlLmRlcGVuZGVuY2llcy5zb21lKChkZXBlbmRlbmN5KSA9PiBkZXBlbmRlbmN5LmNsaWVudE11dGF0aW9uSWQgPT09IHRhaWwubXV0YXRpb24uY2xpZW50TXV0YXRpb25JZCkpXG5cbiAgICAgICAgaWYgKCFzdWNjZXNzb3IgfHwgIXRoaXMuY2FuQ29hbGVzY2VDb25mbGljdFJlY29yZHModGFpbCwgc3VjY2Vzc29yKSkgYnJlYWtcbiAgICAgICAgZ3JvdXAucHVzaChzdWNjZXNzb3IpXG4gICAgICAgIHRhaWwgPSBzdWNjZXNzb3JcbiAgICAgIH1cblxuICAgICAgZ3JvdXBzLnB1c2goZ3JvdXApXG4gICAgICBzZWxlY3RlZElkZW50aXRpZXMuYWRkKGlkZW50aXR5KVxuICAgIH1cblxuICAgIHJldHVybiBncm91cHNcbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVja3Mgd2hldGhlciB0d28gZHVyYWJsZSBpbnRlbnRzIGNhbiBzaGFyZSBvbmUgdHJhbnNwb3J0IG11dGF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vbG9jYWwtbXV0YXRpb24tbG9nLmpzXCIpLkxvY2FsTXV0YXRpb25Mb2dSZWNvcmR9IGxlZnQgLSBFYXJsaWVyIGludGVudC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2xvY2FsLW11dGF0aW9uLWxvZy5qc1wiKS5Mb2NhbE11dGF0aW9uTG9nUmVjb3JkfSByaWdodCAtIExhdGVyIGludGVudC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IFdoZXRoZXIgc2NhbGFyIHVwZGF0ZXMgY2FuIHNoYXJlIG9uZSB0cmFuc3BvcnQgbXV0YXRpb24uXG4gICAqL1xuICBzdGF0aWMgY2FuQ29hbGVzY2VDb25mbGljdFJlY29yZHMobGVmdCwgcmlnaHQpIHtcbiAgICBpZiAobGVmdC5tdXRhdGlvbi5vcGVyYXRpb24gIT09IFwidXBkYXRlXCIgfHwgcmlnaHQubXV0YXRpb24ub3BlcmF0aW9uICE9PSBcInVwZGF0ZVwiKSByZXR1cm4gZmFsc2VcbiAgICBpZiAodGhpcy5jb25mbGljdFJlY29yZElkZW50aXR5KGxlZnQpICE9PSB0aGlzLmNvbmZsaWN0UmVjb3JkSWRlbnRpdHkocmlnaHQpKSByZXR1cm4gZmFsc2VcbiAgICBpZiAobGVmdC5tdXRhdGlvbi5iYXNlVmVyc2lvbiAhPT0gcmlnaHQubXV0YXRpb24uYmFzZVZlcnNpb24pIHJldHVybiBmYWxzZVxuICAgIGlmICghdGhpcy5zY2FsYXJTeW5jQXR0cmlidXRlcyhsZWZ0Lm11dGF0aW9uLmF0dHJpYnV0ZXMpIHx8ICF0aGlzLnNjYWxhclN5bmNBdHRyaWJ1dGVzKHJpZ2h0Lm11dGF0aW9uLmF0dHJpYnV0ZXMpKSByZXR1cm4gZmFsc2VcblxuICAgIHJldHVybiAhT2JqZWN0LmtleXMobGVmdC5tdXRhdGlvbi5hdHRyaWJ1dGVzIHx8IHt9KS5zb21lKChrZXkpID0+IE9iamVjdC5oYXNPd24ocmlnaHQubXV0YXRpb24uYXR0cmlidXRlcyB8fCB7fSwga2V5KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVja3Mgd2hldGhlciBhdHRyaWJ1dGVzIGNvbnRhaW4gc2NhbGFyIEpTT04gdmFsdWVzIG9ubHkuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsU3luY0pzb25WYWx1ZT4gfCB1bmRlZmluZWR9IGF0dHJpYnV0ZXMgLSBBdHRyaWJ1dGVzLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gV2hldGhlciBldmVyeSB2YWx1ZSBpcyBzY2FsYXIuXG4gICAqL1xuICBzdGF0aWMgc2NhbGFyU3luY0F0dHJpYnV0ZXMoYXR0cmlidXRlcykge1xuICAgIHJldHVybiBCb29sZWFuKGF0dHJpYnV0ZXMpICYmIE9iamVjdC52YWx1ZXMoYXR0cmlidXRlcyB8fCB7fSkuZXZlcnkoKHZhbHVlKSA9PiB2YWx1ZSA9PT0gbnVsbCB8fCBbXCJzdHJpbmdcIiwgXCJudW1iZXJcIiwgXCJib29sZWFuXCJdLmluY2x1ZGVzKHR5cGVvZiB2YWx1ZSkpXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIG9uZSByZXBsYXkgZW52ZWxvcGUgZm9yIGEgc2FmZSB0cmFuc3BvcnQgZ3JvdXAuXG4gICAqIEBwYXJhbSB7QXJyYXk8aW1wb3J0KFwiLi9sb2NhbC1tdXRhdGlvbi1sb2cuanNcIikuTG9jYWxNdXRhdGlvbkxvZ1JlY29yZD59IGdyb3VwIC0gVHJhbnNwb3J0IGdyb3VwLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBSZXBsYXkgZW52ZWxvcGUuXG4gICAqL1xuICBzdGF0aWMgY29uZmxpY3RSZXBsYXlQYXlsb2FkKGdyb3VwKSB7XG4gICAgY29uc3QgZmlyc3QgPSBncm91cFswXVxuICAgIGNvbnN0IHBheWxvYWQgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHtcbiAgICAgIGJhc2VWZXJzaW9uOiBmaXJzdC5tdXRhdGlvbi5iYXNlVmVyc2lvbixcbiAgICAgIGNsaWVudFVwZGF0ZWRBdDogZmlyc3QubXV0YXRpb24ub2NjdXJyZWRBdCxcbiAgICAgIGRhdGE6IE9iamVjdC5hc3NpZ24oe30sIC4uLmdyb3VwLm1hcCgocmVjb3JkKSA9PiByZWNvcmQubXV0YXRpb24uYXR0cmlidXRlcyB8fCB7fSkpLFxuICAgICAgaWQ6IGZpcnN0Lm11dGF0aW9uLmNsaWVudE11dGF0aW9uSWQsXG4gICAgICByZXNvdXJjZUlkOiBmaXJzdC5tdXRhdGlvbi5wYXlsb2FkPy5yZXNvdXJjZUlkLFxuICAgICAgcmVzb3VyY2VUeXBlOiBmaXJzdC5tdXRhdGlvbi5tb2RlbCxcbiAgICAgIHN5bmNUeXBlOiBmaXJzdC5tdXRhdGlvbi5wYXlsb2FkPy5zeW5jVHlwZVxuICAgIH0pXG5cbiAgICByZXR1cm4gcGF5bG9hZFxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBhIHN0YWJsZSByZXNvdXJjZSBpZGVudGl0eSBmb3Igb3JkZXJpbmcgYW5kIHJlbW90ZSBnZW5lcmF0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2xvY2FsLW11dGF0aW9uLWxvZy5qc1wiKS5Mb2NhbE11dGF0aW9uTG9nUmVjb3JkfSByZWNvcmQgLSBSZWNvcmQuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IFJlc291cmNlIGlkZW50aXR5LlxuICAgKi9cbiAgc3RhdGljIGNvbmZsaWN0UmVjb3JkSWRlbnRpdHkocmVjb3JkKSB7XG4gICAgcmV0dXJuIGAke3JlY29yZC5tdXRhdGlvbi5tb2RlbH06JHtTdHJpbmcocmVjb3JkLm11dGF0aW9uLnBheWxvYWQ/LnJlc291cmNlSWQpfWBcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWJhc2VzIHRoZSBkaXJlY3QgcGVuZGluZyBzdWNjZXNzb3IgZnJvbSBhbiBhdXRob3JpdGF0aXZlIGFja25vd2xlZGdlbWVudC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBSZWJhc2UgYXJncy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDbGllbnRDb25mbGljdFRyYWNraW5nQ29uZmlnfSBhcmdzLmNvbmZsaWN0VHJhY2tpbmcgLSBUcmFja2luZyBjb25maWcuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9sb2NhbC1tdXRhdGlvbi1sb2cuanNcIikuTG9jYWxNdXRhdGlvbkxvZ1JlY29yZH0gYXJncy5wcmVkZWNlc3NvciAtIEFja25vd2xlZGdlZCBwcmVkZWNlc3Nvci5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBudW1iZXIgfCBudWxsfSBhcmdzLnNlcnZlclZlcnNpb24gLSBBdXRob3JpdGF0aXZlIHNlcnZlciB2ZXJzaW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIHN0YXRpYyBhc3luYyByZWJhc2VDb25mbGljdFN1Y2Nlc3Nvcih7Y29uZmxpY3RUcmFja2luZywgcHJlZGVjZXNzb3IsIHNlcnZlclZlcnNpb259KSB7XG4gICAgY29uc3Qgc3VjY2Vzc29yID0gKGF3YWl0IGNvbmZsaWN0VHJhY2tpbmcubXV0YXRpb25Mb2cucGVuZGluZ1JlY29yZHMoKSlcbiAgICAgIC5maW5kKChyZWNvcmQpID0+IHJlY29yZC5kZXBlbmRlbmNpZXMuc29tZSgoZGVwZW5kZW5jeSkgPT4gZGVwZW5kZW5jeS5jbGllbnRNdXRhdGlvbklkID09PSBwcmVkZWNlc3Nvci5tdXRhdGlvbi5jbGllbnRNdXRhdGlvbklkKSlcblxuICAgIGlmICghc3VjY2Vzc29yKSByZXR1cm5cblxuICAgIGF3YWl0IGNvbmZsaWN0VHJhY2tpbmcubXV0YXRpb25Mb2cudXBkYXRlTXV0YXRpb24oe1xuICAgICAgaWQ6IHN1Y2Nlc3Nvci5pZCxcbiAgICAgIG11dGF0aW9uOiB7Li4uc3VjY2Vzc29yLm11dGF0aW9uLCBiYXNlVmVyc2lvbjogc2VydmVyVmVyc2lvbn1cbiAgICB9KVxuICB9XG4gIC8qKlxuICAgKiBTZXJpYWxpemVzIHN5bmMgd29yayB3aXRoIHRoZSBzYW1lIGtleSBzbyBjYWxsZXJzIGRvIG5vdCBoYXZlIHRvIGtlZXAgYXBwLWxvY2FsIGxvY2tzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30ga2V5IC0gTG9jayBrZXkuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTx2b2lkPn0gY2FsbGJhY2sgLSBXb3JrIHRvIHJ1biBvbmNlIHByZXZpb3VzIHdvcmsgZmluaXNoZWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHNpbmdsZUZsaWdodChrZXksIGNhbGxiYWNrKSB7XG4gICAgd2hpbGUgKHN5bmNUYXNrUHJvbWlzZXMuaGFzKGtleSkpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHN5bmNUYXNrUHJvbWlzZXMuZ2V0KGtleSlcbiAgICAgIH0gY2F0Y2ggKF9lcnJvcikge1xuICAgICAgICAvLyBUaGUgZmFpbGVkIGZsaWdodCdzIG93biBjYWxsZXIgb2JzZXJ2ZXMgdGhhdCByZWplY3Rpb247IGNhbGxlcnMgcXVldWVkXG4gICAgICAgIC8vIGJlaGluZCBpdCBzdGlsbCBydW4gdGhlaXIgb3duIHdvcmsgc28gcGVuZGluZyByb3dzIHJldHJ5IGFmdGVyIHRoZSBsb2NrIGNsZWFycy5cbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBwcm9taXNlID0gY2FsbGJhY2soKVxuICAgIHN5bmNUYXNrUHJvbWlzZXMuc2V0KGtleSwgcHJvbWlzZSlcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBwcm9taXNlXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGlmIChzeW5jVGFza1Byb21pc2VzLmdldChrZXkpID09PSBwcm9taXNlKSBzeW5jVGFza1Byb21pc2VzLmRlbGV0ZShrZXkpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFB1bGxzIGJhY2tlbmQgc3luYyBjaGFuZ2VzIHdpdGggYSBmcmFtZXdvcmstbWFuYWdlZCBjdXJzb3Igcm93LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFB1bGwgYXJncy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuYXV0aGVudGljYXRpb25Ub2tlbiAtIEF1dGggdG9rZW4gdG8gc2VuZCB3aXRoIGNoYW5nZSByZXF1ZXN0cy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmJhdGNoU2l6ZV0gLSBNYXggc3luY3MgcGVyIHJlcXVlc3QuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MuY3Vyc29yTW9kZWwgLSBNb2RlbCB0aGF0IHJlc3BvbmRzIHRvIGZpbmRCeS9maW5kT3JJbml0aWFsaXplQnkgZm9yIGN1cnNvciBwZXJzaXN0ZW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuY3Vyc29yS2V5IC0gQ3Vyc29yIG9wdGlvbiBrZXkuXG4gICAqIEBwYXJhbSB7KHBheWxvYWQ6IFN5bmNDaGFuZ2VzUmVxdWVzdCkgPT4gUHJvbWlzZTxTeW5jQ2hhbmdlc1Jlc3BvbnNlPn0gYXJncy5wb3N0Q2hhbmdlcyAtIFBvc3RzIG9uZSBjaGFuZ2VzIHJlcXVlc3QuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgU3luY1Jlc291cmNlQ29uZmlnPn0gYXJncy5yZXNvdXJjZXMgLSBSZXNvdXJjZSBwb2xpY2llcy5cbiAgICogQHBhcmFtIHsocHJvZ3Jlc3M6IGltcG9ydChcIi4vc3luYy1hcGktY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNQdWxsUHJvZ3Jlc3MpID0+IHZvaWR9IFthcmdzLm9uUHJvZ3Jlc3NdIC0gUHJvZ3Jlc3MgY2FsbGJhY2suXG4gICAqIEBwYXJhbSB7QWJvcnRTaWduYWx9IFthcmdzLnNpZ25hbF0gLSBMaWZlY3ljbGUgY2FuY2VsbGF0aW9uIHNpZ25hbC5cbiAgICogQHJldHVybnMge1Byb21pc2U8U3luY0NoYW5nZXNSZXN1bHQ+fSBQdWxsIHJlc3VsdC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBwdWxsQ2hhbmdlc1dpdGhDdXJzb3IoYXJncykge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLnB1bGxDaGFuZ2VzKHtcbiAgICAgIGF1dGhlbnRpY2F0aW9uVG9rZW46IGFyZ3MuYXV0aGVudGljYXRpb25Ub2tlbixcbiAgICAgIGJhdGNoU2l6ZTogYXJncy5iYXRjaFNpemUsXG4gICAgICBsb2FkQ3Vyc29yOiBhc3luYyAoKSA9PiBhd2FpdCB0aGlzLmxvYWRTeW5jQ3Vyc29yKHtjdXJzb3JLZXk6IGFyZ3MuY3Vyc29yS2V5LCBjdXJzb3JNb2RlbDogYXJncy5jdXJzb3JNb2RlbH0pLFxuICAgICAgc2F2ZUN1cnNvcjogYXN5bmMgKGN1cnNvcikgPT4gYXdhaXQgdGhpcy5zYXZlU3luY0N1cnNvcih7Y3Vyc29yLCBjdXJzb3JLZXk6IGFyZ3MuY3Vyc29yS2V5LCBjdXJzb3JNb2RlbDogYXJncy5jdXJzb3JNb2RlbH0pLFxuICAgICAgcG9zdENoYW5nZXM6IGFyZ3MucG9zdENoYW5nZXMsXG4gICAgICBhcHBseVN5bmM6IHRoaXMucmVzb3VyY2VBcHBsaWVyKGFyZ3MucmVzb3VyY2VzKSxcbiAgICAgIG9uUHJvZ3Jlc3M6IGFyZ3Mub25Qcm9ncmVzcyxcbiAgICAgIHNpZ25hbDogYXJncy5zaWduYWxcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIExvYWRzIGEgcGVyc2lzdGVkIHN5bmMgY3Vyc29yIGZyb20gYSBtb2RlbCByb3cgd2l0aCBhIHZhbHVlIGNvbHVtbi5cbiAgICogQHBhcmFtIHt7Y3Vyc29yS2V5OiBzdHJpbmcsIGN1cnNvck1vZGVsOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn19IGFyZ3MgLSBDdXJzb3IgYXJncy5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nIHwgbnVsbD59IFBlcnNpc3RlZCBjdXJzb3IgcGF5bG9hZC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBsb2FkU3luY0N1cnNvcih7Y3Vyc29yS2V5LCBjdXJzb3JNb2RlbH0pIHtcbiAgICBjb25zdCBvcHRpb24gPSBhd2FpdCBjdXJzb3JNb2RlbC5maW5kQnkoe2tleTogY3Vyc29yS2V5fSlcblxuICAgIHJldHVybiBvcHRpb24gPyBvcHRpb24udmFsdWUoKSA6IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBTYXZlcyBhIHBlcnNpc3RlZCBzeW5jIGN1cnNvciB0byBhIG1vZGVsIHJvdyB3aXRoIGEgdmFsdWUgY29sdW1uLlxuICAgKiBAcGFyYW0ge3tjdXJzb3I6IFN5bmNDdXJzb3IsIGN1cnNvcktleTogc3RyaW5nLCBjdXJzb3JNb2RlbDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59fSBhcmdzIC0gQ3Vyc29yIGFyZ3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHNhdmVTeW5jQ3Vyc29yKHtjdXJzb3IsIGN1cnNvcktleSwgY3Vyc29yTW9kZWx9KSB7XG4gICAgaWYgKCFjdXJzb3IpIHJldHVyblxuXG4gICAgY29uc3Qgb3B0aW9uID0gYXdhaXQgY3Vyc29yTW9kZWwuZmluZE9ySW5pdGlhbGl6ZUJ5KHtrZXk6IGN1cnNvcktleX0pXG5cbiAgICBvcHRpb24uYXNzaWduKHt2YWx1ZTogSlNPTi5zdHJpbmdpZnkoY3Vyc29yKX0pXG4gICAgaWYgKG9wdGlvbi5pc0NoYW5nZWQoKSkgYXdhaXQgb3B0aW9uLnNhdmUoKVxuICB9XG5cbiAgLyoqXG4gICAqIFB1bGxzIGJhY2tlbmQgc3luYyBjaGFuZ2VzIGluIHN0YWJsZSBwYWdlcywgYXBwbGllcyB0aGVtIGxvY2FsbHksIGFuZCBzdG9yZXNcbiAgICogdGhlIGFja25vd2xlZGdlZCBjdXJzb3IuIEFwcHMgcHJvdmlkZSBvbmx5IGF1dGgsIHBlcnNpc3RlbmNlLCB0cmFuc3BvcnQsIGFuZFxuICAgKiByZXNvdXJjZSBwb2xpY3kgaG9va3MuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gUHVsbCBhcmdzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5hdXRoZW50aWNhdGlvblRva2VuIC0gQXV0aCB0b2tlbiB0byBzZW5kIHdpdGggY2hhbmdlIHJlcXVlc3RzLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuYmF0Y2hTaXplXSAtIE1heCBzeW5jcyBwZXIgcmVxdWVzdC4gRGVmYXVsdHMgdG8gMTAwLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8U3luY0N1cnNvciB8IHN0cmluZyB8IG51bGwgfCB1bmRlZmluZWQ+fSBhcmdzLmxvYWRDdXJzb3IgLSBMb2FkcyB0aGUgcGVyc2lzdGVkIGxvY2FsIGN1cnNvci5cbiAgICogQHBhcmFtIHsoY3Vyc29yOiBTeW5jQ3Vyc29yKSA9PiBQcm9taXNlPHZvaWQ+fSBhcmdzLnNhdmVDdXJzb3IgLSBQZXJzaXN0cyB0aGUgZmluYWwgYWNrbm93bGVkZ2VkIGN1cnNvci5cbiAgICogQHBhcmFtIHsocGF5bG9hZDogU3luY0NoYW5nZXNSZXF1ZXN0LCBvcHRpb25zPzoge3NpZ25hbD86IEFib3J0U2lnbmFsfSkgPT4gUHJvbWlzZTxTeW5jQ2hhbmdlc1Jlc3BvbnNlPn0gYXJncy5wb3N0Q2hhbmdlcyAtIFBvc3RzIG9uZSBjaGFuZ2VzIHJlcXVlc3QuXG4gICAqIEBwYXJhbSB7KHN5bmM6IFN5bmNDaGFuZ2VFbnZlbG9wZSkgPT4gUHJvbWlzZTxTeW5jQ2hhbmdlQXBwbHlSZXN1bHQ+fSBhcmdzLmFwcGx5U3luYyAtIEFwcGxpZXMgb25lIG5vcm1hbGl6ZWQgc3luYyByb3cgbG9jYWxseS5cbiAgICogQHBhcmFtIHsocHJvZ3Jlc3M6IGltcG9ydChcIi4vc3luYy1hcGktY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNQdWxsUHJvZ3Jlc3MpID0+IHZvaWR9IFthcmdzLm9uUHJvZ3Jlc3NdIC0gUHJvZ3Jlc3MgY2FsbGJhY2sgaW52b2tlZCBwZXIgYXBwbGllZCBwYWdlIChhbmQgb25jZSBmb3IgYW4gZW1wdHkgcHVsbCkgd2l0aCB0aGUgYXBwbGllZCBjb3VudHMgYW5kIHRoZSBzdGFibGUgc2VydmVyIHRvdGFsLlxuICAgKiBAcGFyYW0ge0Fib3J0U2lnbmFsfSBbYXJncy5zaWduYWxdIC0gTGlmZWN5Y2xlIGNhbmNlbGxhdGlvbiBzaWduYWwuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFN5bmNDaGFuZ2VzUmVzdWx0Pn0gUHVsbCByZXN1bHQuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgcHVsbENoYW5nZXMoYXJncykge1xuICAgIHRocm93SWZTeW5jQWJvcnRlZChhcmdzLnNpZ25hbClcbiAgICBsZXQgYWZ0ZXJDdXJzb3IgPSB0aGlzLnN5bmNDdXJzb3JGcm9tUGF5bG9hZChhd2FpdCBhcmdzLmxvYWRDdXJzb3IoKSlcbiAgICBsZXQgdXBUb0N1cnNvciA9IG51bGxcbiAgICBsZXQgcGFnZXMgPSAwXG4gICAgbGV0IHN5bmNlZENvdW50ID0gMFxuICAgIGxldCB0b3RhbCA9IDBcbiAgICBsZXQgY2hhbmdlZCA9IGZhbHNlXG4gICAgY29uc3QgcmVzb3VyY2VDb3VudHMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIG51bWJlcj59ICovICh7fSlcbiAgICBjb25zdCByZXNvdXJjZUNoYW5nZWQgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGJvb2xlYW4+fSAqLyAoe30pXG4gICAgY29uc3QgYmF0Y2hTaXplID0gdGhpcy5ub3JtYWxpemVkQmF0Y2hTaXplKGFyZ3MuYmF0Y2hTaXplKVxuXG4gICAgd2hpbGUgKHRydWUpIHtcbiAgICAgIHRocm93SWZTeW5jQWJvcnRlZChhcmdzLnNpZ25hbClcbiAgICAgIGNvbnN0IGNoYW5nZXNSZXNwb25zZSA9IGF3YWl0IHRoaXMuY2hhbmdlc1BhZ2Uoey4uLmFyZ3MsIGFmdGVyQ3Vyc29yLCBiYXRjaFNpemUsIHVwVG9DdXJzb3J9KVxuICAgICAgdGhyb3dJZlN5bmNBYm9ydGVkKGFyZ3Muc2lnbmFsKVxuICAgICAgY29uc3Qgc3luY3MgPSBjaGFuZ2VzUmVzcG9uc2Uuc3luY3NcblxuICAgICAgaWYgKCF1cFRvQ3Vyc29yKSB1cFRvQ3Vyc29yID0gY2hhbmdlc1Jlc3BvbnNlLnVwVG9DdXJzb3JcblxuICAgICAgLy8gVGhlIHNlcnZlciBjb3VudHMgcGVuZGluZyByb3dzIGZyb20gdGhpcyByZXF1ZXN0J3MgY3Vyc29yLCBzbyBhbHJlYWR5LWFwcGxpZWRcbiAgICAgIC8vIHBhZ2VzIHBsdXMgdGhpcyByZXF1ZXN0J3MgY291bnQgc3RheXMgdGhlIHNhbWUgdG90YWwgYWNyb3NzIGV2ZXJ5IHBhZ2U6IGEgc3RhYmxlXG4gICAgICAvLyBcIm9mIFlcIiBkZW5vbWluYXRvciBldmVuIGFzIHRoZSBjdXJzb3IgYWR2YW5jZXMuIEEgc2VydmVyIHRoYXQgZG9lc24ndCByZXBvcnQgdGhlXG4gICAgICAvLyBjb3VudCBhdCBhbGwgbGVhdmVzIHRoZSB0b3RhbCBhdCAwIGZvciBldmVyeSBwYWdlIHJhdGhlciB0aGFuIGRyaWZ0aW5nIHVwd2FyZHNcbiAgICAgIC8vIHdpdGggdGhlIGFwcGxpZWQgcm93cy5cbiAgICAgIGlmIChjaGFuZ2VzUmVzcG9uc2UudG90YWwgIT09IG51bGwpIHRvdGFsID0gc3luY2VkQ291bnQgKyBjaGFuZ2VzUmVzcG9uc2UudG90YWxcblxuICAgICAgaWYgKHN5bmNzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAvLyBSZXBvcnQgdGhlIHRlcm1pbmFsIHByb2dyZXNzIG9uY2UgZm9yIGFuIGVudGlyZWx5IGVtcHR5IHB1bGwgc28gY29uc3VtZXJzIG9ic2VydmVcbiAgICAgICAgLy8gdG90YWwgMDsgYSBwdWxsIHRoYXQgYWxyZWFkeSBhcHBsaWVkIHBhZ2VzIHJlcG9ydGVkIGl0cyBmaW5hbCBjb3VudHMgb24gaXRzIGxhc3QgcGFnZS5cbiAgICAgICAgdGhyb3dJZlN5bmNBYm9ydGVkKGFyZ3Muc2lnbmFsKVxuICAgICAgICBpZiAocGFnZXMgPT09IDAgJiYgYXJncy5vblByb2dyZXNzKSBhcmdzLm9uUHJvZ3Jlc3Moe3BhZ2VzLCBzeW5jZWRDb3VudCwgdG90YWx9KVxuXG4gICAgICAgIGJyZWFrXG4gICAgICB9XG5cbiAgICAgIHBhZ2VzICs9IDFcblxuICAgICAgLy8gQ29hbGVzY2UgcmVjb3JkLWNoYW5nZSBldmVudHMgYWNyb3NzIHRoaXMgcGFnZSdzIGFwcGxpZXMgc28gTiBhcHBsaWVkIHJvd3MgdHJpZ2dlciBvbmVcbiAgICAgIC8vIGxpdmUtcXVlcnkgcmUtcnVuLiBPbmx5IHRoZSBhcHBseSBsb29wIGlzIGJhdGNoZWQ6IHRoZSBuZXR3b3JrIHBhZ2UgZmV0Y2ggYWJvdmUgYW5kIHRoZVxuICAgICAgLy8gY3Vyc29yIHNhdmUgYmVsb3cgc3RheSBvdXRzaWRlLCBzbyBsaXZlIHF1ZXJpZXMgZmx1c2ggcmlnaHQgYWZ0ZXIgdGhlIGFwcGxpZXMgaW5zdGVhZCBvZlxuICAgICAgLy8gd2FpdGluZyBmb3IgdGhlIHJlc3Qgb2YgdGhlIHB1bGwuXG4gICAgICBhd2FpdCByZWNvcmRDaGFuZ2VzLmJhdGNoKGFzeW5jICgpID0+IHtcbiAgICAgICAgZm9yIChjb25zdCBzeW5jIG9mIHN5bmNzKSB7XG4gICAgICAgICAgdGhyb3dJZlN5bmNBYm9ydGVkKGFyZ3Muc2lnbmFsKVxuICAgICAgICAgIGNvbnN0IGFwcGx5UmVzdWx0ID0gYXdhaXQgYXJncy5hcHBseVN5bmMoc3luYylcbiAgICAgICAgICB0aHJvd0lmU3luY0Fib3J0ZWQoYXJncy5zaWduYWwpXG4gICAgICAgICAgY29uc3QgcmVzb3VyY2VUeXBlID0gYXBwbHlSZXN1bHQucmVzb3VyY2VUeXBlID8/IHN5bmMucmVzb3VyY2VUeXBlKClcblxuICAgICAgICAgIGNoYW5nZWQgfHw9IGFwcGx5UmVzdWx0LmNoYW5nZWQgPT09IHRydWVcbiAgICAgICAgICBzeW5jZWRDb3VudCArPSAxXG5cbiAgICAgICAgICBpZiAocmVzb3VyY2VUeXBlKSB7XG4gICAgICAgICAgICByZXNvdXJjZUNvdW50c1tyZXNvdXJjZVR5cGVdID0gKHJlc291cmNlQ291bnRzW3Jlc291cmNlVHlwZV0gfHwgMCkgKyAxXG4gICAgICAgICAgICByZXNvdXJjZUNoYW5nZWRbcmVzb3VyY2VUeXBlXSB8fD0gYXBwbHlSZXN1bHQuY2hhbmdlZCA9PT0gdHJ1ZVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSlcblxuICAgICAgYWZ0ZXJDdXJzb3IgPSBjaGFuZ2VzUmVzcG9uc2UubmV4dEN1cnNvclxuXG4gICAgICB0aHJvd0lmU3luY0Fib3J0ZWQoYXJncy5zaWduYWwpXG4gICAgICBpZiAoYXJncy5vblByb2dyZXNzKSBhcmdzLm9uUHJvZ3Jlc3Moe3BhZ2VzLCBzeW5jZWRDb3VudCwgdG90YWx9KVxuICAgICAgaWYgKHN5bmNzLmxlbmd0aCA8IGJhdGNoU2l6ZSkgYnJlYWtcbiAgICB9XG5cbiAgICB0aHJvd0lmU3luY0Fib3J0ZWQoYXJncy5zaWduYWwpXG4gICAgaWYgKGFmdGVyQ3Vyc29yKSBhd2FpdCBhcmdzLnNhdmVDdXJzb3IoYWZ0ZXJDdXJzb3IpXG4gICAgdGhyb3dJZlN5bmNBYm9ydGVkKGFyZ3Muc2lnbmFsKVxuXG4gICAgcmV0dXJuIHtjaGFuZ2VkLCBwYWdlcywgcmVzb3VyY2VDaGFuZ2VkLCByZXNvdXJjZUNvdW50cywgc3luY2VkQ291bnQsIHRvdGFsfVxuICB9XG5cbiAgLyoqXG4gICAqIEZldGNoZXMgYW5kIHZhbGlkYXRlcyBvbmUgYmFja2VuZCBzeW5jIGNoYW5nZXMgcGFnZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBQYWdlIGFyZ3MuXG4gICAqIEBwYXJhbSB7U3luY0N1cnNvcn0gYXJncy5hZnRlckN1cnNvciAtIExhc3QgYWNrbm93bGVkZ2VkIGN1cnNvci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuYXV0aGVudGljYXRpb25Ub2tlbiAtIEF1dGggdG9rZW4uXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLmJhdGNoU2l6ZSAtIFBhZ2Ugc2l6ZS5cbiAgICogQHBhcmFtIHsocGF5bG9hZDogU3luY0NoYW5nZXNSZXF1ZXN0LCBvcHRpb25zPzoge3NpZ25hbD86IEFib3J0U2lnbmFsfSkgPT4gUHJvbWlzZTxTeW5jQ2hhbmdlc1Jlc3BvbnNlPn0gYXJncy5wb3N0Q2hhbmdlcyAtIENoYW5nZXMgcG9zdGVyLlxuICAgKiBAcGFyYW0ge0Fib3J0U2lnbmFsfSBbYXJncy5zaWduYWxdIC0gTGlmZWN5Y2xlIGNhbmNlbGxhdGlvbiBzaWduYWwuXG4gICAqIEBwYXJhbSB7U3luY0N1cnNvcn0gYXJncy51cFRvQ3Vyc29yIC0gU25hcHNob3QgdXBwZXItYm91bmQgY3Vyc29yLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7bmV4dEN1cnNvcjogU3luY0N1cnNvciwgc3luY3M6IFN5bmNDaGFuZ2VFbnZlbG9wZVtdLCB0b3RhbDogbnVtYmVyIHwgbnVsbCwgdXBUb0N1cnNvcjogU3luY0N1cnNvcn0+fSBOb3JtYWxpemVkIGNoYW5nZXMgcGFnZS5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBjaGFuZ2VzUGFnZSh7YWZ0ZXJDdXJzb3IsIGF1dGhlbnRpY2F0aW9uVG9rZW4sIGJhdGNoU2l6ZSwgcG9zdENoYW5nZXMsIHNpZ25hbCwgdXBUb0N1cnNvcn0pIHtcbiAgICB0aHJvd0lmU3luY0Fib3J0ZWQoc2lnbmFsKVxuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgcG9zdENoYW5nZXMoe1xuICAgICAgYXV0aGVudGljYXRpb25Ub2tlbixcbiAgICAgIGxpbWl0OiBiYXRjaFNpemUsXG4gICAgICAuLi50aGlzLmN1cnNvclBheWxvYWQoXCJhZnRlclwiLCBhZnRlckN1cnNvciksXG4gICAgICAuLi50aGlzLmN1cnNvclBheWxvYWQoXCJ1cFRvXCIsIHVwVG9DdXJzb3IpXG4gICAgfSwge3NpZ25hbH0pXG5cbiAgICB0aHJvd0lmU3luY0Fib3J0ZWQoc2lnbmFsKVxuICAgIHRoaXMuZW5zdXJlU3VjY2Vzc2Z1bENoYW5nZXNSZXNwb25zZShyZXNwb25zZSlcblxuICAgIGNvbnN0IHN5bmNzID0gLyoqIEB0eXBlIHt1bmtub3duW119ICovIChyZXNwb25zZS5zeW5jcylcblxuICAgIHJldHVybiB7XG4gICAgICBuZXh0Q3Vyc29yOiB0aGlzLnN5bmNDdXJzb3JGcm9tUGF5bG9hZChyZXNwb25zZS5uZXh0Q3Vyc29yID8/IG51bGwpLFxuICAgICAgc3luY3M6IHN5bmNzLm1hcCgoc3luY1BheWxvYWQpID0+IHRoaXMuc3luY0VudmVsb3BlRnJvbVBheWxvYWQoc3luY1BheWxvYWQpKSxcbiAgICAgIHRvdGFsOiBvcHRpb25hbEludGVnZXIocmVzcG9uc2UudG90YWwpLFxuICAgICAgdXBUb0N1cnNvcjogdGhpcy5zeW5jQ3Vyc29yRnJvbVBheWxvYWQocmVzcG9uc2UudXBUb0N1cnNvciA/PyBudWxsKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVja3MgQVBJIHJlc3BvbnNlIHN0YXR1cyBhbmQgc2hhcGUgZm9yIGNoYW5nZS1mZWVkIHB1bGxzLlxuICAgKiBAcGFyYW0ge1N5bmNDaGFuZ2VzUmVzcG9uc2V9IHJlc3BvbnNlIC0gQ2hhbmdlcyByZXNwb25zZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGF0aWMgZW5zdXJlU3VjY2Vzc2Z1bENoYW5nZXNSZXNwb25zZShyZXNwb25zZSkge1xuICAgIGlmIChyZXNwb25zZS5zdGF0dXMgPT09IFwiZXJyb3JcIikgdGhyb3cgbmV3IEVycm9yKHJlc3BvbnNlLmVycm9yTWVzc2FnZSB8fCBcIlN5bmMgY2hhbmdlcyBmYWlsZWRcIilcbiAgICBpZiAoIUFycmF5LmlzQXJyYXkocmVzcG9uc2Uuc3luY3MpKSB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jIGNoYW5nZXMgcmVzcG9uc2UgbWlzc2luZyBzeW5jc1wiKVxuICB9XG5cbiAgLyoqXG4gICAqIENvbnZlcnRzIGEgY3Vyc29yIGludG8gcmVxdWVzdCBwYXJhbXMgd2l0aCB0aGUgZ2l2ZW4gcHJlZml4LlxuICAgKiBAcGFyYW0ge1wiYWZ0ZXJcIiB8IFwidXBUb1wifSBwcmVmaXggLSBSZXF1ZXN0IGZpZWxkIHByZWZpeC5cbiAgICogQHBhcmFtIHtTeW5jQ3Vyc29yfSBjdXJzb3IgLSBDdXJzb3IgdG8gc2VyaWFsaXplLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgc3RyaW5nIHwgbnVtYmVyIHwgbnVsbD59IFJlcXVlc3QgcGFyYW1zLlxuICAgKi9cbiAgc3RhdGljIGN1cnNvclBheWxvYWQocHJlZml4LCBjdXJzb3IpIHtcbiAgICBpZiAoIWN1cnNvcikgcmV0dXJuIHt9XG5cbiAgICByZXR1cm4ge1xuICAgICAgW2Ake3ByZWZpeH1JZGBdOiBjdXJzb3IuaWQsXG4gICAgICAuLi4oY3Vyc29yLnNlcnZlclNlcXVlbmNlID8ge1tgJHtwcmVmaXh9U2VydmVyU2VxdWVuY2VgXTogY3Vyc29yLnNlcnZlclNlcXVlbmNlfSA6IHt9KSxcbiAgICAgIFtgJHtwcmVmaXh9VXBkYXRlZEF0YF06IGN1cnNvci51cGRhdGVkQXRcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUGFyc2VzIGEgcGVyc2lzdGVkIG9yIHJlc3BvbnNlIGN1cnNvciBwYXlsb2FkLlxuICAgKiBAcGFyYW0ge1N5bmNDdXJzb3IgfCBzdHJpbmcgfCBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBudWxsIHwgdW5kZWZpbmVkfSBwYXlsb2FkIC0gQ3Vyc29yIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtTeW5jQ3Vyc29yfSBQYXJzZWQgY3Vyc29yLlxuICAgKi9cbiAgc3RhdGljIHN5bmNDdXJzb3JGcm9tUGF5bG9hZChwYXlsb2FkKSB7XG4gICAgaWYgKCFwYXlsb2FkKSByZXR1cm4gbnVsbFxuXG4gICAgaWYgKHR5cGVvZiBwYXlsb2FkID09PSBcInN0cmluZ1wiKSB7XG4gICAgICB0cnkge1xuICAgICAgICByZXR1cm4gdGhpcy5zeW5jQ3Vyc29yRnJvbVBheWxvYWQoSlNPTi5wYXJzZShwYXlsb2FkKSlcbiAgICAgIH0gY2F0Y2ggKF9lcnJvcikge1xuICAgICAgICByZXR1cm4ge2lkOiBudWxsLCBzZXJ2ZXJTZXF1ZW5jZTogbnVsbCwgdXBkYXRlZEF0OiBwYXlsb2FkfVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmICh0eXBlb2YgcGF5bG9hZCAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHBheWxvYWQpKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgdXBkYXRlZEF0ID0gdHlwZW9mIHBheWxvYWQudXBkYXRlZEF0ID09PSBcInN0cmluZ1wiID8gcGF5bG9hZC51cGRhdGVkQXQgOiBudWxsXG5cbiAgICBpZiAoIXVwZGF0ZWRBdCkgcmV0dXJuIG51bGxcblxuICAgIHJldHVybiB7XG4gICAgICBpZDogcGF5bG9hZC5pZCA9PT0gbnVsbCB8fCBwYXlsb2FkLmlkID09PSB1bmRlZmluZWQgPyBudWxsIDogU3RyaW5nKHBheWxvYWQuaWQpLFxuICAgICAgc2VydmVyU2VxdWVuY2U6IG9wdGlvbmFsSW50ZWdlcihwYXlsb2FkLnNlcnZlclNlcXVlbmNlID09PSBcIlwiID8gbnVsbCA6IHBheWxvYWQuc2VydmVyU2VxdWVuY2UpLFxuICAgICAgdXBkYXRlZEF0XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBhIG5vcm1hbGl6ZWQgc3luYyByb3cgYWRhcHRlci5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gcGF5bG9hZCAtIFJhdyBzeW5jIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtTeW5jQ2hhbmdlRW52ZWxvcGV9IFN5bmMgcm93IGFkYXB0ZXIuXG4gICAqL1xuICBzdGF0aWMgc3luY0VudmVsb3BlRnJvbVBheWxvYWQocGF5bG9hZCkge1xuICAgIGlmICghcGF5bG9hZCB8fCB0eXBlb2YgcGF5bG9hZCAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHBheWxvYWQpKSB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jIGNoYW5nZXMgZW50cnkgbXVzdCBiZSBhbiBvYmplY3RcIilcblxuICAgIGNvbnN0IHN5bmNQYXlsb2FkID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChwYXlsb2FkKVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGRhdGE6ICgpID0+IHN5bmNQYXlsb2FkLmRhdGEsXG4gICAgICBpZDogKCkgPT4gc3luY1BheWxvYWQuaWQsXG4gICAgICByZXNvdXJjZUlkOiAoKSA9PiBzeW5jUGF5bG9hZC5yZXNvdXJjZUlkLFxuICAgICAgcmVzb3VyY2VUeXBlOiAoKSA9PiBzeW5jUGF5bG9hZC5yZXNvdXJjZVR5cGUgPT09IG51bGwgfHwgc3luY1BheWxvYWQucmVzb3VyY2VUeXBlID09PSB1bmRlZmluZWQgPyBudWxsIDogU3RyaW5nKHN5bmNQYXlsb2FkLnJlc291cmNlVHlwZSksXG4gICAgICBzZXJ2ZXJTZXF1ZW5jZTogKCkgPT4gdGhpcy5ub3JtYWxpemVkU2VydmVyU2VxdWVuY2Uoc3luY1BheWxvYWQuc2VydmVyU2VxdWVuY2UpLFxuICAgICAgc3luY1R5cGU6ICgpID0+IHN5bmNQYXlsb2FkLnN5bmNUeXBlID09PSBudWxsIHx8IHN5bmNQYXlsb2FkLnN5bmNUeXBlID09PSB1bmRlZmluZWQgPyBcIlwiIDogU3RyaW5nKHN5bmNQYXlsb2FkLnN5bmNUeXBlKSxcbiAgICAgIHVwZGF0ZWRBdDogKCkgPT4gc3luY1BheWxvYWQudXBkYXRlZEF0ID09PSBudWxsIHx8IHN5bmNQYXlsb2FkLnVwZGF0ZWRBdCA9PT0gdW5kZWZpbmVkID8gbnVsbCA6IFN0cmluZyhzeW5jUGF5bG9hZC51cGRhdGVkQXQpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZXMgYSByYXcgc2VydmVyIHNlcXVlbmNlIGludG8gYSBwb3NpdGl2ZSBzYWZlIGludGVnZXIuXG4gICAqIEBwYXJhbSB7dW5rbm93bn0gdmFsdWUgLSBSYXcgc2VxdWVuY2UuXG4gICAqIEByZXR1cm5zIHtudW1iZXIgfCBudWxsfSBOb3JtYWxpemVkIHNlcXVlbmNlLCBvciBudWxsIHdoZW4gYWJzZW50L2ludmFsaWQuXG4gICAqL1xuICBzdGF0aWMgbm9ybWFsaXplZFNlcnZlclNlcXVlbmNlKHZhbHVlKSB7XG4gICAgaWYgKHZhbHVlID09PSBudWxsIHx8IHZhbHVlID09PSB1bmRlZmluZWQgfHwgdmFsdWUgPT09IFwiXCIpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCBzZXF1ZW5jZSA9IE51bWJlcih2YWx1ZSlcblxuICAgIGlmICghTnVtYmVyLmlzU2FmZUludGVnZXIoc2VxdWVuY2UpIHx8IHNlcXVlbmNlIDw9IDApIHJldHVybiBudWxsXG5cbiAgICByZXR1cm4gc2VxdWVuY2VcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgYW4gYXBwLWNvbmZpZ3VyZWQgcmVzb3VyY2UgYXBwbGllciBmb3IgcHVsbGVkIHN5bmMgcm93cy4gVGhlIHN5bmNcbiAgICogbWVjaGFuaWNzIHN0YXkgaGVyZTsgYXBwcyBvbmx5IGRlY2xhcmUgd2hpY2ggbW9kZWxzL2F0dHJpYnV0ZXMvaG9va3MgYXJlXG4gICAqIGFsbG93ZWQgZm9yIGVhY2ggcmVzb3VyY2UgdHlwZS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBTeW5jUmVzb3VyY2VDb25maWc+fSByZXNvdXJjZXMgLSBSZXNvdXJjZSBwb2xpY3kgbWFwLlxuICAgKiBAcGFyYW0geyhyZWNvcmQ6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+KSA9PiAoKSA9PiB2b2lkfSBbb25SZWNvcmRdIC0gQ2FsbGVkIHdpdGggZWFjaCByZWNvcmQgYWJvdXQgdG8gYmUgd3JpdHRlbjsgcmV0dXJucyBhIHJlbGVhc2UgY2FsbGJhY2sgaW52b2tlZCBhZnRlciB0aGUgd3JpdGUgKHVzZWQgZm9yIGVjaG8gc3VwcHJlc3Npb24pLlxuICAgKiBAcmV0dXJucyB7KHN5bmM6IFN5bmNDaGFuZ2VFbnZlbG9wZSkgPT4gUHJvbWlzZTxTeW5jQ2hhbmdlQXBwbHlSZXN1bHQ+fSBTeW5jIGFwcGx5IGNhbGxiYWNrLlxuICAgKi9cbiAgc3RhdGljIHJlc291cmNlQXBwbGllcihyZXNvdXJjZXMsIG9uUmVjb3JkKSB7XG4gICAgcmV0dXJuIGFzeW5jIChzeW5jKSA9PiBhd2FpdCB0aGlzLmFwcGx5UmVzb3VyY2VTeW5jKHtvblJlY29yZCwgcmVzb3VyY2VzLCBzeW5jfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBsaWVzIG9uZSBzeW5jIHJvdyB1c2luZyBkZWNsYXJhdGl2ZSByZXNvdXJjZSBwb2xpY3kuXG4gICAqIEBwYXJhbSB7e3Jlc291cmNlczogUmVjb3JkPHN0cmluZywgU3luY1Jlc291cmNlQ29uZmlnPiwgc3luYzogU3luY0NoYW5nZUVudmVsb3BlLCBvblJlY29yZD86IChyZWNvcmQ6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+KSA9PiAoKSA9PiB2b2lkfX0gYXJncyAtIEFwcGx5IGFyZ3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFN5bmNDaGFuZ2VBcHBseVJlc3VsdD59IEFwcGx5IHJlc3VsdC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBhcHBseVJlc291cmNlU3luYyh7b25SZWNvcmQsIHJlc291cmNlcywgc3luY30pIHtcbiAgICBjb25zdCByZXNvdXJjZVR5cGUgPSBzeW5jLnJlc291cmNlVHlwZSgpXG4gICAgY29uc3QgcmVzb3VyY2UgPSByZXNvdXJjZVR5cGUgPyByZXNvdXJjZXNbcmVzb3VyY2VUeXBlXSA6IHVuZGVmaW5lZFxuXG4gICAgaWYgKCFyZXNvdXJjZSB8fCAhcmVzb3VyY2UuZW5hYmxlZCkgcmV0dXJuIHtjaGFuZ2VkOiBmYWxzZSwgcmVzb3VyY2VUeXBlfVxuXG4gICAgaWYgKHN5bmMuc3luY1R5cGUoKSA9PT0gXCJkZWxldGVcIikge1xuICAgICAgcmV0dXJuIHtjaGFuZ2VkOiBhd2FpdCB0aGlzLmRlc3Ryb3lTeW5jZWRSZXNvdXJjZSh7b25SZWNvcmQsIHJlc291cmNlLCBzeW5jfSksIHJlc291cmNlVHlwZX1cbiAgICB9XG5cbiAgICBjb25zdCBkYXRhID0gdGhpcy5zeW5jRGF0YShzeW5jKVxuICAgIGNvbnN0IHJlY29yZCA9IHJlc291cmNlLmZpbmRSZWNvcmQgPyBhd2FpdCByZXNvdXJjZS5maW5kUmVjb3JkKHtkYXRhLCByZXNvdXJjZUlkOiBzeW5jLnJlc291cmNlSWQoKSwgc3luY30pIDogYXdhaXQgcmVzb3VyY2UubW9kZWxDbGFzcy5maW5kT3JJbml0aWFsaXplQnkoe2lkOiBkYXRhLmlkID8/IHN5bmMucmVzb3VyY2VJZCgpfSlcbiAgICBjb25zdCBhdHRyaWJ1dGVzID0gYXdhaXQgcmVzb3VyY2UuYXR0cmlidXRlcyh7ZGF0YSwgcmVjb3JkLCBzeW5jfSlcbiAgICBjb25zdCByZWxlYXNlUmVjb3JkID0gb25SZWNvcmQgPyBvblJlY29yZChyZWNvcmQpIDogbnVsbFxuICAgIGxldCBjaGFuZ2VkID0gZmFsc2VcblxuICAgIHRyeSB7XG4gICAgICByZWNvcmQuYXNzaWduKGF0dHJpYnV0ZXMpXG5cbiAgICAgIGlmIChyZWNvcmQuaXNDaGFuZ2VkKCkpIHtcbiAgICAgICAgYXdhaXQgcmVjb3JkLnNhdmUoKVxuICAgICAgICBjaGFuZ2VkID0gdHJ1ZVxuICAgICAgfVxuXG4gICAgICBpZiAocmVzb3VyY2UuYWZ0ZXJBcHBseSkge1xuICAgICAgICBjb25zdCBob29rQ2hhbmdlZCA9IGF3YWl0IHJlc291cmNlLmFmdGVyQXBwbHkoe2F0dHJpYnV0ZXMsIGRhdGEsIHJlY29yZCwgc3luY30pXG5cbiAgICAgICAgY2hhbmdlZCB8fD0gaG9va0NoYW5nZWQgPT09IHRydWVcbiAgICAgIH1cbiAgICB9IGZpbmFsbHkge1xuICAgICAgaWYgKHJlbGVhc2VSZWNvcmQpIHJlbGVhc2VSZWNvcmQoKVxuICAgIH1cblxuICAgIHJldHVybiB7Y2hhbmdlZCwgcmVzb3VyY2VUeXBlfVxuICB9XG5cbiAgLyoqXG4gICAqIERlc3Ryb3lzIGEgc3luY2VkIHJlc291cmNlIHZpYSBpdHMgZGVjbGFyZWQgbW9kZWwgcG9saWN5LlxuICAgKiBAcGFyYW0ge3tyZXNvdXJjZTogU3luY1Jlc291cmNlQ29uZmlnLCBzeW5jOiBTeW5jQ2hhbmdlRW52ZWxvcGUsIG9uUmVjb3JkPzogKHJlY29yZDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4pID0+ICgpID0+IHZvaWR9fSBhcmdzIC0gRGVzdHJveSBhcmdzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gV2hldGhlciBhIGxvY2FsIHJvdyB3YXMgZGVzdHJveWVkLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGRlc3Ryb3lTeW5jZWRSZXNvdXJjZSh7b25SZWNvcmQsIHJlc291cmNlLCBzeW5jfSkge1xuICAgIGNvbnN0IGlkID0gc3luYy5yZXNvdXJjZUlkKClcbiAgICBjb25zdCByZWNvcmQgPSByZXNvdXJjZS5maW5kUmVjb3JkRm9yRGVsZXRlID8gYXdhaXQgcmVzb3VyY2UuZmluZFJlY29yZEZvckRlbGV0ZSh7cmVzb3VyY2VJZDogaWQsIHN5bmN9KSA6IGF3YWl0IHJlc291cmNlLm1vZGVsQ2xhc3MuZmluZEJ5KHtpZH0pXG5cbiAgICBpZiAoIXJlY29yZCkgcmV0dXJuIGZhbHNlXG5cbiAgICBjb25zdCByZWxlYXNlUmVjb3JkID0gb25SZWNvcmQgPyBvblJlY29yZChyZWNvcmQpIDogbnVsbFxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHJlY29yZC5kZXN0cm95KClcbiAgICB9IGZpbmFsbHkge1xuICAgICAgaWYgKHJlbGVhc2VSZWNvcmQpIHJlbGVhc2VSZWNvcmQoKVxuICAgIH1cblxuICAgIHJldHVybiB0cnVlXG4gIH1cblxuICAvKipcbiAgICogUGFyc2VzIHRoZSBlbWJlZGRlZCBzeW5jIGRhdGEgSlNPTi9vYmplY3QuXG4gICAqIEBwYXJhbSB7U3luY0NoYW5nZUVudmVsb3BlfSBzeW5jIC0gU3luYyByb3cuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn0gU3luYyBkYXRhIG9iamVjdC5cbiAgICovXG4gIHN0YXRpYyBzeW5jRGF0YShzeW5jKSB7XG4gICAgY29uc3QgZGF0YSA9IHN5bmMuZGF0YSgpXG5cbiAgICBpZiAoIWRhdGEpIHRocm93IG5ldyBFcnJvcihgU3luYyAke3N5bmMuaWQoKX0gaXMgbWlzc2luZyBkYXRhYClcbiAgICBpZiAodHlwZW9mIGRhdGEgPT09IFwic3RyaW5nXCIpIHJldHVybiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSAqLyAoSlNPTi5wYXJzZShkYXRhKSlcbiAgICBpZiAodHlwZW9mIGRhdGEgPT09IFwib2JqZWN0XCIgJiYgIUFycmF5LmlzQXJyYXkoZGF0YSkpIHJldHVybiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSAqLyAoZGF0YSlcblxuICAgIHRocm93IG5ldyBFcnJvcihgU3luYyAke3N5bmMuaWQoKX0gaGFzIGludmFsaWQgZGF0YWApXG4gIH1cblxuICAvKipcbiAgICogRHJhaW5zIHBlbmRpbmcgc3luYyByZWNvcmRzIGZyb20gYSBsb2NhbCBWZWxvY2lvdXMgbW9kZWwgaW4gc3RhYmxlIG9yZGVyLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFJlcGxheSBhcmdzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5hdXRoZW50aWNhdGlvblRva2VuIC0gQXV0aCB0b2tlbiB0byBzZW5kIHdpdGggcmVwbGF5IHJlcXVlc3RzLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuYmF0Y2hTaXplXSAtIE1heCBzeW5jcyBwZXIgcmVxdWVzdC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5zeW5jTW9kZWwgLSBMb2NhbCBTeW5jIG1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0geyhwYXlsb2FkOiB7YXV0aGVudGljYXRpb25Ub2tlbjogc3RyaW5nLCBzeW5jczogQXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0sIG9wdGlvbnM/OiB7c2lnbmFsPzogQWJvcnRTaWduYWx9KSA9PiBQcm9taXNlPFN5bmNSZXBsYXlSZXNwb25zZT59IGFyZ3MucG9zdFJlcGxheSAtIFJlcGxheSBwb3N0ZXIuXG4gICAqIEBwYXJhbSB7QWJvcnRTaWduYWx9IFthcmdzLnNpZ25hbF0gLSBMaWZlY3ljbGUgY2FuY2VsbGF0aW9uIHNpZ25hbC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBzdGF0aWMgYXN5bmMgcmVwbGF5TG9jYWxTeW5jcyhhcmdzKSB7XG4gICAgY29uc3QgcG9zdGVkU25hcHNob3RzQnlTeW5jSWQgPSBuZXcgTWFwKClcblxuICAgIGF3YWl0IHRoaXMucmVwbGF5UGVuZGluZyh7XG4gICAgICBhdXRoZW50aWNhdGlvblRva2VuOiBhcmdzLmF1dGhlbnRpY2F0aW9uVG9rZW4sXG4gICAgICBiYXRjaFNpemU6IGFyZ3MuYmF0Y2hTaXplLFxuICAgICAgbWFya1N1Y2Nlc3NmdWw6IGFzeW5jIChzeW5jKSA9PiB7XG4gICAgICAgIGNvbnN0IHN5bmNJZCA9ICgvKiogQHR5cGUge3tpZDogKCkgPT4gc3RyaW5nIHwgbnVtYmVyIHwgbnVsbCB8IHVuZGVmaW5lZH19ICovIChzeW5jKSkuaWQoKVxuICAgICAgICAvLyBSZWxvYWQgd2l0aCB0aGUgcmVzb3VyY2UgcHJlbG9hZGVkIHNvIHJvd3MgcmVseWluZyBvbiB0aGUgcmVzb3VyY2UtYXR0cmlidXRlc1xuICAgICAgICAvLyBmYWxsYmFjayBpbiBsb2NhbFN5bmNEYXRhIGNvbXBhcmUgYWdhaW5zdCB0aGUgc2FtZSBzbmFwc2hvdCB0aGV5IHBvc3RlZC5cbiAgICAgICAgY29uc3QgY3VycmVudFN5bmMgPSBhd2FpdCBhcmdzLnN5bmNNb2RlbC5wcmVsb2FkKHtyZXNvdXJjZTogdHJ1ZX0pLndoZXJlKHtpZDogc3luY0lkfSkuZmlyc3QoKVxuXG4gICAgICAgIGlmICghY3VycmVudFN5bmMpIHJldHVyblxuICAgICAgICAvLyBBIHJvdyBlZGl0ZWQgd2hpbGUgaXRzIG9sZCBwYXlsb2FkIHdhcyBpbiBmbGlnaHQgc3RheXMgcGVuZGluZywgc28gdGhlXG4gICAgICAgIC8vIG5ld2VyIGxvY2FsIGNoYW5nZSByZXBsYXlzIG9uIHRoZSBuZXh0IGRyYWluIGluc3RlYWQgb2YgYmVpbmcgbG9zdC5cbiAgICAgICAgaWYgKHRoaXMubG9jYWxTeW5jUmVwbGF5U25hcHNob3QoY3VycmVudFN5bmMpICE9PSBwb3N0ZWRTbmFwc2hvdHNCeVN5bmNJZC5nZXQoU3RyaW5nKHN5bmNJZCkpKSByZXR1cm5cblxuICAgICAgICBhd2FpdCBjdXJyZW50U3luYy51cGRhdGUoe3N0YXRlOiBcInN1Y2Nlc3NcIn0pXG4gICAgICB9LFxuICAgICAgcGVuZGluZ1N5bmNzOiBhc3luYyAoKSA9PiBhd2FpdCBhcmdzLnN5bmNNb2RlbC5wcmVsb2FkKHtyZXNvdXJjZTogdHJ1ZX0pLndoZXJlKHtzdGF0ZTogXCJwZW5kaW5nXCJ9KS5vcmRlcihcImNyZWF0ZWRfYXRcIikudG9BcnJheSgpLFxuICAgICAgcG9zdFJlcGxheTogYXJncy5wb3N0UmVwbGF5LFxuICAgICAgc2lnbmFsOiBhcmdzLnNpZ25hbCxcbiAgICAgIHN5bmNJZDogKHN5bmMpID0+ICgvKiogQHR5cGUge3tpZDogKCkgPT4gc3RyaW5nIHwgbnVtYmVyIHwgbnVsbCB8IHVuZGVmaW5lZH19ICovIChzeW5jKSkuaWQoKSxcbiAgICAgIHN5bmNQYXlsb2FkOiAoc3luYykgPT4ge1xuICAgICAgICBwb3N0ZWRTbmFwc2hvdHNCeVN5bmNJZC5zZXQoU3RyaW5nKCgvKiogQHR5cGUge3tpZDogKCkgPT4gc3RyaW5nIHwgbnVtYmVyIHwgbnVsbCB8IHVuZGVmaW5lZH19ICovIChzeW5jKSkuaWQoKSksIHRoaXMubG9jYWxTeW5jUmVwbGF5U25hcHNob3Qoc3luYykpXG5cbiAgICAgICAgcmV0dXJuIHRoaXMubG9jYWxTeW5jUGF5bG9hZChzeW5jKVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogU2VyaWFsaXplcyB0aGUgcmVwbGF5LXJlbGV2YW50IHN0YXRlIG9mIGEgbG9jYWwgc3luYyByb3cgZm9yIGluLWZsaWdodCBjb21wYXJpc29ucy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gc3luYyAtIExvY2FsIHN5bmMgcm93LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSBTdGFibGUgc25hcHNob3Qgb2YgdGhlIHJvdydzIHJlcGxheWVkIHBheWxvYWQuXG4gICAqL1xuICBzdGF0aWMgbG9jYWxTeW5jUmVwbGF5U25hcHNob3Qoc3luYykge1xuICAgIHJldHVybiBKU09OLnN0cmluZ2lmeSh7ZGF0YTogdGhpcy5sb2NhbFN5bmNEYXRhKHN5bmMpLCBzeW5jVHlwZTogc3luYy5zeW5jVHlwZSgpfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgb25lIHJlcGxheSBlbnZlbG9wZSBmcm9tIGEgbG9jYWwgc3luYyByb3cuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHN5bmMgLSBMb2NhbCBzeW5jIHJvdy5cbiAgICogQHJldHVybnMge3tjbGllbnRVcGRhdGVkQXQ/OiBzdHJpbmcsIGRhdGE6IFJlY29yZDxzdHJpbmcsIHVua25vd24+LCBpZDogbnVtYmVyLCByZXNvdXJjZUlkOiBzdHJpbmcsIHJlc291cmNlVHlwZTogc3RyaW5nLCBzeW5jVHlwZTogc3RyaW5nfX0gU3luYyByZXBsYXkgZW52ZWxvcGUuXG4gICAqL1xuICBzdGF0aWMgbG9jYWxTeW5jUGF5bG9hZChzeW5jKSB7XG4gICAgY29uc3QgY2xpZW50VXBkYXRlZEF0ID0gc3luYy51cGRhdGVkQXQoKSB8fCBzeW5jLmNyZWF0ZWRBdCgpXG5cbiAgICByZXR1cm4ge1xuICAgICAgY2xpZW50VXBkYXRlZEF0OiBjbGllbnRVcGRhdGVkQXQgPyBjbGllbnRVcGRhdGVkQXQudG9JU09TdHJpbmcoKSA6IHVuZGVmaW5lZCxcbiAgICAgIGRhdGE6IHRoaXMubG9jYWxTeW5jRGF0YShzeW5jKSxcbiAgICAgIGlkOiAvKiogQHR5cGUge251bWJlcn0gKi8gKC8qKiBAdHlwZSB7dW5rbm93bn0gKi8gKHN5bmMuaWQoKSkpLFxuICAgICAgcmVzb3VyY2VJZDogU3RyaW5nKHN5bmMucmVzb3VyY2VJZCgpKSxcbiAgICAgIHJlc291cmNlVHlwZTogc3luYy5yZXNvdXJjZVR5cGUoKSB8fCBcIlwiLFxuICAgICAgc3luY1R5cGU6IHN5bmMuc3luY1R5cGUoKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBvbmUgbG9jYWwgc3luYyByb3cgcGF5bG9hZCwgZmFsbGluZyBiYWNrIHRvIHByZWxvYWRlZCByZXNvdXJjZSBhdHRyaWJ1dGVzLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBzeW5jIC0gTG9jYWwgc3luYyByb3cuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn0gU3luYyBkYXRhLlxuICAgKi9cbiAgc3RhdGljIGxvY2FsU3luY0RhdGEoc3luYykge1xuICAgIGxldCBzeW5jRGF0YSA9IC8qKiBAdHlwZSB7c3RyaW5nIHwgUmVjb3JkPHN0cmluZywgdW5rbm93bj59ICovIChzeW5jLmRhdGEoKSB8fCB7fSlcblxuICAgIGlmICh0eXBlb2Ygc3luY0RhdGEgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIHN5bmNEYXRhID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn0gKi8gKEpTT04ucGFyc2Uoc3luY0RhdGEpKVxuICAgICAgfSBjYXRjaCAoX2Vycm9yKSB7XG4gICAgICAgIHN5bmNEYXRhID0ge31cbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoT2JqZWN0LmtleXMoc3luY0RhdGEpLmxlbmd0aCA+IDApIHJldHVybiBzeW5jRGF0YVxuXG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSAqLyAoc3luYy5yZXNvdXJjZSgpLmF0dHJpYnV0ZXMoKSlcbiAgICB9IGNhdGNoIChfZXJyb3IpIHtcbiAgICAgIHJldHVybiB7fVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBRdWV1ZXMgYSBsb2NhbCBzeW5jIHJvdyBmb3IgYSBWZWxvY2lvdXMgbW9kZWwgcmVzb3VyY2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gUXVldWUgYXJncy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5yZXNvdXJjZSAtIFJlc291cmNlIGJlaW5nIHN5bmNlZC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5zeW5jTW9kZWwgLSBMb2NhbCBTeW5jIG1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSBbYXJncy5kYXRhXSAtIEV4cGxpY2l0IHN5bmMgZGF0YS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLnN5bmNUeXBlXSAtIFN5bmMgb3BlcmF0aW9uIHR5cGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IFthcmdzLmxvY2FsT25seUF0dHJpYnV0ZXNdIC0gQXR0cmlidXRlcyB0byBzdHJpcCBmcm9tIHF1ZXVlZCBwYXlsb2Fkcy5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gW2FyZ3MuYm9vbGVhbkF0dHJpYnV0ZXNdIC0gQXR0cmlidXRlcyB0byBjb2VyY2UgdGhyb3VnaCBzeW5jIGJvb2xlYW4gcGFyc2luZy5cbiAgICogQHBhcmFtIHsoZGF0YTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pID0+IFJlY29yZDxzdHJpbmcsIHVua25vd24+fSBbYXJncy5ub3JtYWxpemVEYXRhXSAtIEFwcC1zcGVjaWZpYyBkYXRhIG5vcm1hbGl6ZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gTG9jYWwgc3luYyByb3cuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgcXVldWVMb2NhbFN5bmMoYXJncykge1xuICAgIGNvbnN0IHJlc291cmNlUmVjb3JkSWQgPSBzY2FsYXJNb2RlbFByaW1hcnlLZXlWYWx1ZShhcmdzLnJlc291cmNlLmlkKCksIFwiTG9jYWwgc3luYyBxdWV1ZWluZ1wiKVxuICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSBhcmdzLnJlc291cmNlLmNvbnN0cnVjdG9yXG5cbiAgICBpZiAodHlwZW9mIG1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlRoZSByZXNvdXJjZSBtb2RlbCBjbGFzcyBtdXN0IGltcGxlbWVudCBzdGF0aWMgZ2V0TW9kZWxOYW1lKCkgdG8gcXVldWUgc3luYyBkYXRhIC0gY2xhc3MgbmFtZXMgYXJlIG5vdCBzdGFibGUgYWNyb3NzIGV4cGxpY2l0IG1vZGVsIG5hbWVzIGFuZCBtaW5pZmllZCBidW5kbGVzXCIpXG4gICAgfVxuXG4gICAgY29uc3QgcmVzb3VyY2VUeXBlID0gbW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKVxuICAgIGNvbnN0IHN5bmNEYXRhID0gdGhpcy5xdWV1ZWRTeW5jRGF0YShhcmdzKVxuICAgIGNvbnN0IHN5bmNUeXBlID0gYXJncy5zeW5jVHlwZSB8fCBcInVwZGF0ZVwiXG5cbiAgICBpZiAoIXJlc291cmNlUmVjb3JkSWQpIHRocm93IG5ldyBFcnJvcihcInJlc291cmNlLmlkKCkgaXMgcmVxdWlyZWQgdG8gcXVldWUgc3luYyBkYXRhXCIpXG5cbiAgICBjb25zdCByZXNvdXJjZUlkID0gU3RyaW5nKHJlc291cmNlUmVjb3JkSWQpXG4gICAgY29uc3QgZXhpc3RpbmdTeW5jID0gYXdhaXQgYXJncy5zeW5jTW9kZWwuZmluZEJ5KHtyZXNvdXJjZUlkLCByZXNvdXJjZVR5cGV9KVxuXG4gICAgaWYgKGV4aXN0aW5nU3luYykge1xuICAgICAgYXdhaXQgZXhpc3RpbmdTeW5jLnVwZGF0ZSh7XG4gICAgICAgIGRhdGE6IHN5bmNEYXRhLFxuICAgICAgICBzdGF0ZTogXCJwZW5kaW5nXCIsXG4gICAgICAgIHN5bmNUeXBlXG4gICAgICB9KVxuXG4gICAgICByZXR1cm4gZXhpc3RpbmdTeW5jXG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IGFyZ3Muc3luY01vZGVsLmNyZWF0ZSh7XG4gICAgICBkYXRhOiBzeW5jRGF0YSxcbiAgICAgIHJlc291cmNlSWQsXG4gICAgICByZXNvdXJjZVR5cGUsXG4gICAgICBzdGF0ZTogXCJwZW5kaW5nXCIsXG4gICAgICBzeW5jVHlwZVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIGJhY2tlbmQtc2FmZSBxdWV1ZWQgc3luYyBkYXRhIHdpdGhvdXQgbXV0YXRpbmcgY2FsbGVyIGRhdGEuIFRoZSBkZWZhdWx0XG4gICAqIChubyBleHBsaWNpdCBgZGF0YWApIGlzIHRoZSByZXNvdXJjZSdzIGF0dHJpYnV0ZXMgbWludXMgbG9jYWwtb25seSBhdHRyaWJ1dGVzLFxuICAgKiB3aXRoIGJvb2xlYW5zIGNvZXJjZWQgYW5kIERhdGUgdmFsdWVzIHNlcmlhbGl6ZWQgdG8gSVNPIHN0cmluZ3MsIHNvIGFwcHMgZG9uJ3RcbiAgICogbmVlZCBwZXItbW9kZWwgdHJhY2tlZC1wYXlsb2FkIGJ1aWxkZXJzLlxuICAgKiBAcGFyYW0ge3tyZXNvdXJjZTogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGRhdGE/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiwgbG9jYWxPbmx5QXR0cmlidXRlcz86IHN0cmluZ1tdLCBib29sZWFuQXR0cmlidXRlcz86IHN0cmluZ1tdLCBub3JtYWxpemVEYXRhPzogKGRhdGE6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KSA9PiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn19IGFyZ3MgLSBEYXRhIGFyZ3MuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn0gUXVldWVkIGRhdGEuXG4gICAqL1xuICBzdGF0aWMgcXVldWVkU3luY0RhdGEoYXJncykge1xuICAgIGNvbnN0IGlucHV0RGF0YSA9IGFyZ3MuZGF0YSA/PyAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSAqLyAoYXJncy5yZXNvdXJjZS5hdHRyaWJ1dGVzKCkpXG4gICAgY29uc3Qgbm9ybWFsaXplZERhdGEgPSBhcmdzLm5vcm1hbGl6ZURhdGEgPyBhcmdzLm5vcm1hbGl6ZURhdGEoaW5wdXREYXRhKSA6IGlucHV0RGF0YVxuICAgIGNvbnN0IHN5bmNEYXRhID0gey4uLm5vcm1hbGl6ZWREYXRhfVxuXG4gICAgZm9yIChjb25zdCBhdHRyaWJ1dGVOYW1lIG9mIGFyZ3MubG9jYWxPbmx5QXR0cmlidXRlcyB8fCBbXSkgZGVsZXRlIHN5bmNEYXRhW2F0dHJpYnV0ZU5hbWVdXG4gICAgZm9yIChjb25zdCBhdHRyaWJ1dGVOYW1lIG9mIGFyZ3MuYm9vbGVhbkF0dHJpYnV0ZXMgfHwgW10pIHtcbiAgICAgIGlmIChPYmplY3QuaGFzT3duKHN5bmNEYXRhLCBhdHRyaWJ1dGVOYW1lKSkgc3luY0RhdGFbYXR0cmlidXRlTmFtZV0gPSB0aGlzLm9wdGlvbmFsQm9vbGVhblN5bmNWYWx1ZShzeW5jRGF0YVthdHRyaWJ1dGVOYW1lXSwgYXR0cmlidXRlTmFtZSlcbiAgICB9XG4gICAgZm9yIChjb25zdCBbYXR0cmlidXRlTmFtZSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHN5bmNEYXRhKSkge1xuICAgICAgaWYgKHZhbHVlIGluc3RhbmNlb2YgRGF0ZSkgc3luY0RhdGFbYXR0cmlidXRlTmFtZV0gPSB2YWx1ZS50b0lTT1N0cmluZygpXG4gICAgfVxuXG4gICAgcmV0dXJuIHN5bmNEYXRhXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIGEgc21hbGwgYXBwLWZhY2luZyBsb2NhbCBzeW5jIHF1ZXVlIGZhY2FkZSBmcm9tIGRlY2xhcmF0aXZlIG1vZGVsIGNvbmZpZy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBRdWV1ZSBjb25maWcuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3Muc3luY01vZGVsIC0gTG9jYWwgU3luYyBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc2luZ2xlRmxpZ2h0S2V5IC0gS2V5IHVzZWQgdG8gc2VyaWFsaXplIGJhY2tlbmQgcmVwbGF5LlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8dm9pZD59IGFyZ3Muc3luY1BlbmRpbmcgLSBCYWNrZW5kIHJlcGxheSBjYWxsYmFjay5cbiAgICogQHBhcmFtIHsocmVzb3VyY2U6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+KSA9PiBzdHJpbmdbXX0gW2FyZ3MubG9jYWxPbmx5QXR0cmlidXRlc10gLSBSZXNvdXJjZS1zcGVjaWZpYyBsb2NhbC1vbmx5IGF0dHJpYnV0ZXMuXG4gICAqIEBwYXJhbSB7KHJlc291cmNlOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPikgPT4gc3RyaW5nW119IFthcmdzLmJvb2xlYW5BdHRyaWJ1dGVzXSAtIFJlc291cmNlLXNwZWNpZmljIFNRTGl0ZSBib29sZWFuIGF0dHJpYnV0ZXMuXG4gICAqIEByZXR1cm5zIHt7cXVldWU6IChxdWV1ZUFyZ3M6IHtyZXNvdXJjZTogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGRhdGE/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiwgc3luY1R5cGU/OiBzdHJpbmd9KSA9PiBQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Piwgc3luY1BlbmRpbmc6ICgpID0+IFByb21pc2U8dm9pZD59fSBDb25maWd1cmVkIGxvY2FsIHN5bmMgcXVldWUuXG4gICAqL1xuICBzdGF0aWMgbG9jYWxTeW5jUXVldWUoYXJncykge1xuICAgIHJldHVybiB7XG4gICAgICBxdWV1ZTogYXN5bmMgKHF1ZXVlQXJncykgPT4gYXdhaXQgdGhpcy5xdWV1ZUxvY2FsU3luYyh7XG4gICAgICAgIC4uLnF1ZXVlQXJncyxcbiAgICAgICAgYm9vbGVhbkF0dHJpYnV0ZXM6IGFyZ3MuYm9vbGVhbkF0dHJpYnV0ZXMgPyBhcmdzLmJvb2xlYW5BdHRyaWJ1dGVzKHF1ZXVlQXJncy5yZXNvdXJjZSkgOiBbXSxcbiAgICAgICAgbG9jYWxPbmx5QXR0cmlidXRlczogYXJncy5sb2NhbE9ubHlBdHRyaWJ1dGVzID8gYXJncy5sb2NhbE9ubHlBdHRyaWJ1dGVzKHF1ZXVlQXJncy5yZXNvdXJjZSkgOiBbXSxcbiAgICAgICAgc3luY01vZGVsOiBhcmdzLnN5bmNNb2RlbFxuICAgICAgfSksXG4gICAgICBzeW5jUGVuZGluZzogYXN5bmMgKCkgPT4gYXdhaXQgdGhpcy5zaW5nbGVGbGlnaHQoYXJncy5zaW5nbGVGbGlnaHRLZXksIGFyZ3Muc3luY1BlbmRpbmcpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFBhcnNlcyBib29sZWFucyBjb21tb25seSB1c2VkIGJ5IFNRTGl0ZS9vZmZsaW5lIHN5bmMgcGF5bG9hZHMuXG4gICAqIEBwYXJhbSB7dW5rbm93bn0gdmFsdWUgLSBTeW5jIGRlY2lzaW9uIHZhbHVlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2Rlc2NyaXB0aW9uXSAtIEVycm9yIGNvbnRleHQuXG4gICAqIEByZXR1cm5zIHtib29sZWFuIHwgbnVsbH0gUGFyc2VkIGJvb2xlYW4tbGlrZSBiYWNrZW5kL2xvY2FsIHZhbHVlLlxuICAgKi9cbiAgc3RhdGljIG9wdGlvbmFsQm9vbGVhblN5bmNWYWx1ZSh2YWx1ZSwgZGVzY3JpcHRpb24gPSBcInN5bmMgYm9vbGVhblwiKSB7XG4gICAgaWYgKHZhbHVlID09IG51bGwpIHJldHVybiBudWxsXG4gICAgaWYgKHZhbHVlID09PSAxKSByZXR1cm4gdHJ1ZVxuICAgIGlmICh2YWx1ZSA9PT0gMCkgcmV0dXJuIGZhbHNlXG5cbiAgICByZXR1cm4gb3B0aW9uYWxCb29sZWFuKHZhbHVlLCBkZXNjcmlwdGlvbilcbiAgfVxuXG4gIC8qKlxuICAgKiBDb252ZXJ0cyBhIGJvb2xlYW4gc3luYyB2YWx1ZSB0byBTUUxpdGUgYm9vbGVhbiBzdG9yYWdlLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW4gfCBudWxsfSB2YWx1ZSAtIFN5bmMgYm9vbGVhbiB2YWx1ZS5cbiAgICogQHJldHVybnMgezAgfCAxfSBTUUxpdGUtY29tcGF0aWJsZSBib29sZWFuIHZhbHVlLlxuICAgKi9cbiAgc3RhdGljIHNxbGl0ZUJvb2xlYW5TeW5jVmFsdWUodmFsdWUpIHtcbiAgICByZXR1cm4gdmFsdWUgPT09IHRydWUgPyAxIDogMFxuICB9XG5cbiAgLyoqXG4gICAqIFByb2plY3RzIGdlbmVyaWMgc3luYyBjb3VudGVycyBpbnRvIGFwcC1zcGVjaWZpYyByZXN1bHQga2V5cy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBSZXN1bHQgYXJncy5cbiAgICogQHBhcmFtIHtTeW5jQ2hhbmdlc1Jlc3VsdH0gYXJncy5yZXN1bHQgLSBHZW5lcmljIFZlbG9jaW91cyBzeW5jIHJlc3VsdC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCB7Y2hhbmdlZEtleTogc3RyaW5nLCBjb3VudEtleTogc3RyaW5nfT59IGFyZ3MucmVzb3VyY2VzIC0gUmVzb3VyY2UgcmVzdWx0IGtleSBtYXAuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn0gUHJvamVjdGVkIHJlc3VsdC5cbiAgICovXG4gIHN0YXRpYyBzeW5jUmVzdWx0Rm9yUmVzb3VyY2VzKHtyZXN1bHQsIHJlc291cmNlc30pIHtcbiAgICBjb25zdCBzeW5jUmVzdWx0ID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn0gKi8gKHtcbiAgICAgIGNoYW5nZWQ6IHJlc3VsdC5jaGFuZ2VkLFxuICAgICAgcGFnZXM6IHJlc3VsdC5wYWdlcyxcbiAgICAgIHN5bmNlZENvdW50OiByZXN1bHQuc3luY2VkQ291bnRcbiAgICB9KVxuXG4gICAgZm9yIChjb25zdCBbcmVzb3VyY2VUeXBlLCBrZXlzXSBvZiBPYmplY3QuZW50cmllcyhyZXNvdXJjZXMpKSB7XG4gICAgICBzeW5jUmVzdWx0W2tleXMuY291bnRLZXldID0gcmVzdWx0LnJlc291cmNlQ291bnRzW3Jlc291cmNlVHlwZV0gfHwgMFxuICAgICAgc3luY1Jlc3VsdFtrZXlzLmNoYW5nZWRLZXldID0gcmVzdWx0LnJlc291cmNlQ2hhbmdlZFtyZXNvdXJjZVR5cGVdIHx8IGZhbHNlXG4gICAgfVxuXG4gICAgcmV0dXJuIHN5bmNSZXN1bHRcbiAgfVxuXG4gIC8qKlxuICAgKiBEcmFpbnMgcGVuZGluZyBzeW5jIHJlY29yZHMgaW4gc3RhYmxlIG9yZGVyIGFuZCBtYXJrcyBhY2tub3dsZWRnZWQgcm93cy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBSZXBsYXkgYXJncy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuYXV0aGVudGljYXRpb25Ub2tlbiAtIEF1dGggdG9rZW4gdG8gc2VuZCB3aXRoIHJlcGxheSByZXF1ZXN0cy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmJhdGNoU2l6ZV0gLSBNYXggc3luY3MgcGVyIHJlcXVlc3QuIERlZmF1bHRzIHRvIDEwMC5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPEFycmF5PHVua25vd24+Pn0gYXJncy5wZW5kaW5nU3luY3MgLSBMb2FkcyBwZW5kaW5nIGxvY2FsIHN5bmMgcm93cyBpbiByZXBsYXkgb3JkZXIuXG4gICAqIEBwYXJhbSB7KHN5bmM6IHVua25vd24pID0+IHN0cmluZyB8IG51bWJlciB8IG51bGwgfCB1bmRlZmluZWR9IGFyZ3Muc3luY0lkIC0gUmV0dXJucyB0aGUgbG9jYWwgc3luYyBpZC5cbiAgICogQHBhcmFtIHsoc3luYzogdW5rbm93bikgPT4gUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLnN5bmNQYXlsb2FkIC0gQnVpbGRzIHRoZSBBUEkgc3luYyBlbnZlbG9wZS5cbiAgICogQHBhcmFtIHsocGF5bG9hZDoge2F1dGhlbnRpY2F0aW9uVG9rZW46IHN0cmluZywgc3luY3M6IEFycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59LCBvcHRpb25zPzoge3NpZ25hbD86IEFib3J0U2lnbmFsfSkgPT4gUHJvbWlzZTxTeW5jUmVwbGF5UmVzcG9uc2U+fSBhcmdzLnBvc3RSZXBsYXkgLSBQb3N0cyBvbmUgcmVwbGF5IHJlcXVlc3QuXG4gICAqIEBwYXJhbSB7KHN5bmM6IHVua25vd24sIHJlc3BvbnNlOiBTeW5jUmVwbGF5SXRlbSkgPT4gUHJvbWlzZTx2b2lkPn0gYXJncy5tYXJrU3VjY2Vzc2Z1bCAtIE1hcmtzIG9uZSBzeW5jIGFzIHN1Y2Nlc3NmdWwgbG9jYWxseS5cbiAgICogQHBhcmFtIHtBYm9ydFNpZ25hbH0gW2FyZ3Muc2lnbmFsXSAtIExpZmVjeWNsZSBjYW5jZWxsYXRpb24gc2lnbmFsLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgYWZ0ZXIgYWxsIGJhdGNoZXMgYXJlIHJlcGxheWVkLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHJlcGxheVBlbmRpbmcoYXJncykge1xuICAgIHRocm93SWZTeW5jQWJvcnRlZChhcmdzLnNpZ25hbClcbiAgICBjb25zdCBwZW5kaW5nU3luY3MgPSBhd2FpdCBhcmdzLnBlbmRpbmdTeW5jcygpXG4gICAgdGhyb3dJZlN5bmNBYm9ydGVkKGFyZ3Muc2lnbmFsKVxuICAgIGNvbnN0IGJhdGNoU2l6ZSA9IHRoaXMubm9ybWFsaXplZEJhdGNoU2l6ZShhcmdzLmJhdGNoU2l6ZSlcblxuICAgIGZvciAobGV0IG9mZnNldCA9IDA7IG9mZnNldCA8IHBlbmRpbmdTeW5jcy5sZW5ndGg7IG9mZnNldCArPSBiYXRjaFNpemUpIHtcbiAgICAgIHRocm93SWZTeW5jQWJvcnRlZChhcmdzLnNpZ25hbClcbiAgICAgIGF3YWl0IHRoaXMucmVwbGF5QmF0Y2goey4uLmFyZ3MsIHBlbmRpbmdTeW5jczogcGVuZGluZ1N5bmNzLnNsaWNlKG9mZnNldCwgb2Zmc2V0ICsgYmF0Y2hTaXplKX0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlcGxheXMgb25lIGJhdGNoIG9mIHN5bmNzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFJlcGxheSBhcmdzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5hdXRoZW50aWNhdGlvblRva2VuIC0gQXV0aCB0b2tlbi5cbiAgICogQHBhcmFtIHtBcnJheTx1bmtub3duPn0gYXJncy5wZW5kaW5nU3luY3MgLSBCYXRjaCBzeW5jcy5cbiAgICogQHBhcmFtIHsoc3luYzogdW5rbm93bikgPT4gc3RyaW5nIHwgbnVtYmVyIHwgbnVsbCB8IHVuZGVmaW5lZH0gYXJncy5zeW5jSWQgLSBTeW5jIGlkIGdldHRlci5cbiAgICogQHBhcmFtIHsoc3luYzogdW5rbm93bikgPT4gUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLnN5bmNQYXlsb2FkIC0gUGF5bG9hZCBidWlsZGVyLlxuICAgKiBAcGFyYW0geyhwYXlsb2FkOiB7YXV0aGVudGljYXRpb25Ub2tlbjogc3RyaW5nLCBzeW5jczogQXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0sIG9wdGlvbnM/OiB7c2lnbmFsPzogQWJvcnRTaWduYWx9KSA9PiBQcm9taXNlPFN5bmNSZXBsYXlSZXNwb25zZT59IGFyZ3MucG9zdFJlcGxheSAtIFJlcGxheSBwb3N0ZXIuXG4gICAqIEBwYXJhbSB7KHN5bmM6IHVua25vd24sIHJlc3BvbnNlOiBTeW5jUmVwbGF5SXRlbSkgPT4gUHJvbWlzZTx2b2lkPn0gYXJncy5tYXJrU3VjY2Vzc2Z1bCAtIFN1Y2Nlc3MgaG9vay5cbiAgICogQHBhcmFtIHtBYm9ydFNpZ25hbH0gW2FyZ3Muc2lnbmFsXSAtIExpZmVjeWNsZSBjYW5jZWxsYXRpb24gc2lnbmFsLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIGJhdGNoIGlzIGFja25vd2xlZGdlZC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyByZXBsYXlCYXRjaChhcmdzKSB7XG4gICAgY29uc3Qge2F1dGhlbnRpY2F0aW9uVG9rZW4sIG1hcmtTdWNjZXNzZnVsLCBwZW5kaW5nU3luY3MsIHBvc3RSZXBsYXksIHNpZ25hbCwgc3luY0lkLCBzeW5jUGF5bG9hZH0gPSBhcmdzXG5cbiAgICBpZiAocGVuZGluZ1N5bmNzLmxlbmd0aCA9PT0gMCkgcmV0dXJuXG4gICAgdGhyb3dJZlN5bmNBYm9ydGVkKHNpZ25hbClcblxuICAgIGNvbnN0IHN5bmNzQnlJZCA9IG5ldyBNYXAoKVxuXG4gICAgZm9yIChjb25zdCBzeW5jIG9mIHBlbmRpbmdTeW5jcykge1xuICAgICAgY29uc3QgaWQgPSBzeW5jSWQoc3luYylcblxuICAgICAgaWYgKGlkICE9PSB1bmRlZmluZWQgJiYgaWQgIT09IG51bGwpIHN5bmNzQnlJZC5zZXQoU3RyaW5nKGlkKSwgc3luYylcbiAgICB9XG5cbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHBvc3RSZXBsYXkoe1xuICAgICAgYXV0aGVudGljYXRpb25Ub2tlbixcbiAgICAgIHN5bmNzOiBwZW5kaW5nU3luY3MubWFwKChzeW5jKSA9PiBzeW5jUGF5bG9hZChzeW5jKSlcbiAgICB9LCB7c2lnbmFsfSlcblxuICAgIHRocm93SWZTeW5jQWJvcnRlZChzaWduYWwpXG4gICAgdGhpcy5lbnN1cmVTdWNjZXNzZnVsUmVzcG9uc2UocmVzcG9uc2UpXG5cbiAgICBmb3IgKGNvbnN0IHN5bmNSZXNwb25zZSBvZiByZXNwb25zZS5zeW5jcyB8fCBbXSkge1xuICAgICAgdGhyb3dJZlN5bmNBYm9ydGVkKHNpZ25hbClcbiAgICAgIGNvbnN0IHN5bmMgPSBzeW5jc0J5SWQuZ2V0KFN0cmluZyhzeW5jUmVzcG9uc2UuaWQpKVxuXG4gICAgICBpZiAoIXN5bmMpIGNvbnRpbnVlXG4gICAgICBpZiAoc3luY1Jlc3BvbnNlLnN5bmNTdGF0ZSAhPT0gXCJzdWNjZXNzZnVsXCIpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHN5bmMgc3RhdGUgcmV0dXJuZWQgZm9yIHN5bmMgJHtTdHJpbmcoc3luY1Jlc3BvbnNlLmlkKX06ICR7U3RyaW5nKHN5bmNSZXNwb25zZS5zeW5jU3RhdGUpfWApXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IG1hcmtTdWNjZXNzZnVsKHN5bmMsIHN5bmNSZXNwb25zZSlcbiAgICAgIHRocm93SWZTeW5jQWJvcnRlZChzaWduYWwpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrcyBBUEkgcmVzcG9uc2Ugc3RhdHVzIGFuZCBzaGFwZS5cbiAgICogQHBhcmFtIHtTeW5jUmVwbGF5UmVzcG9uc2V9IHJlc3BvbnNlIC0gUmVwbGF5IHJlc3BvbnNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyBlbnN1cmVTdWNjZXNzZnVsUmVzcG9uc2UocmVzcG9uc2UpIHtcbiAgICBpZiAocmVzcG9uc2Uuc3RhdHVzID09PSBcImVycm9yXCIpIHRocm93IG5ldyBFcnJvcihyZXNwb25zZS5lcnJvck1lc3NhZ2UgfHwgXCJTeW5jIGZhaWxlZFwiKVxuICAgIGlmICghQXJyYXkuaXNBcnJheShyZXNwb25zZS5zeW5jcykpIHRocm93IG5ldyBFcnJvcihcIlN5bmMgcmVzcG9uc2UgbWlzc2luZyBzeW5jc1wiKVxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZXMgYSBwb3NpdGl2ZSBiYXRjaCBzaXplLlxuICAgKiBAcGFyYW0ge251bWJlciB8IHVuZGVmaW5lZH0gYmF0Y2hTaXplIC0gQmF0Y2ggc2l6ZS5cbiAgICogQHJldHVybnMge251bWJlcn0gUG9zaXRpdmUgYmF0Y2ggc2l6ZS5cbiAgICovXG4gIHN0YXRpYyBub3JtYWxpemVkQmF0Y2hTaXplKGJhdGNoU2l6ZSkge1xuICAgIGlmICh0eXBlb2YgYmF0Y2hTaXplICE9PSBcIm51bWJlclwiIHx8ICFOdW1iZXIuaXNGaW5pdGUoYmF0Y2hTaXplKSB8fCBiYXRjaFNpemUgPCAxKSByZXR1cm4gMTAwXG5cbiAgICByZXR1cm4gTWF0aC5mbG9vcihiYXRjaFNpemUpXG4gIH1cbn1cblxuLyoqXG4gKiBUaHJvd3MgdGhlIGV4YWN0IGFib3J0IHJlYXNvbiBhdCBsaWZlY3ljbGUgYm91bmRhcmllcyBzbyBjYWxsZXJzIGNhblxuICogZGlzdGluZ3Vpc2ggYW4gZXhwZWN0ZWQgY29vcGVyYXRpdmUgc3RvcCBmcm9tIHRyYW5zcG9ydCBvciBhcHBseSBmYWlsdXJlcy5cbiAqIEBwYXJhbSB7QWJvcnRTaWduYWwgfCB1bmRlZmluZWR9IHNpZ25hbCAtIExpZmVjeWNsZSBzaWduYWwuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gdGhyb3dJZlN5bmNBYm9ydGVkKHNpZ25hbCkge1xuICBpZiAoIXNpZ25hbD8uYWJvcnRlZCkgcmV0dXJuXG5cbiAgdGhyb3cgc2lnbmFsLnJlYXNvbiBpbnN0YW5jZW9mIEVycm9yID8gc2lnbmFsLnJlYXNvbiA6IG5ldyBFcnJvcihcIlN5bmMgb3BlcmF0aW9uIGFib3J0ZWRcIilcbn1cblxuLyoqXG4gKiBSZXNvbHZlcyBvbmUgY29uZmxpY3QtdHJhY2tpbmcgaWRlbnRpdHkgZmllbGQgYXQgcXVldWUgdGltZTogYSBzdGF0aWMgc3RyaW5nXG4gKiBvciBhIGZ1bmN0aW9uIChzeW5jIG9yIGFzeW5jKSByZXNvbHZpbmcgdGhlIGN1cnJlbnQgdmFsdWUuIEdyYW50cyBhbmQgcG9saWN5XG4gKiBoYXNoZXMgcm90YXRlIGF0IHJ1bnRpbWUsIHNvIGRlY2xhcmF0aW9ucyBtYXkgcmVzb2x2ZSB0aGVtIHBlciBtdXRhdGlvbi5cbiAqIEBwYXJhbSB7e2NvbmZsaWN0VHJhY2tpbmc6IGltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU3luY0NsaWVudENvbmZsaWN0VHJhY2tpbmdDb25maWcsIGtleTogXCJhY3RvckRldmljZUlkXCIgfCBcImFjdG9yVXNlcklkXCIgfCBcIm9mZmxpbmVHcmFudElkXCIgfCBcInBvbGljeUhhc2hcIiwgcmVzb3VyY2VUeXBlOiBzdHJpbmd9fSBhcmdzIC0gUmVzb2x1dGlvbiBhcmdzLlxuICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gLSBSZXNvbHZlZCBub24tZW1wdHkgaWRlbnRpdHkgdmFsdWUuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHJlc29sdmVDb25mbGljdFRyYWNraW5nSWRlbnRpdHlWYWx1ZSh7Y29uZmxpY3RUcmFja2luZywga2V5LCByZXNvdXJjZVR5cGV9KSB7XG4gIGNvbnN0IHZhbHVlID0gY29uZmxpY3RUcmFja2luZ1trZXldXG5cbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgY29uc3QgcmVzb2x2ZWQgPSBhd2FpdCB2YWx1ZSgpXG5cbiAgICBpZiAodHlwZW9mIHJlc29sdmVkICE9PSBcInN0cmluZ1wiIHx8IHJlc29sdmVkLmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke3Jlc291cmNlVHlwZX0gY29uZmxpY3RUcmFja2luZy4ke2tleX0gcmVzb2x2ZWQgdG8gYW4gZW1wdHkgdmFsdWVgKVxuICAgIH1cblxuICAgIHJldHVybiByZXNvbHZlZFxuICB9XG5cbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJzdHJpbmdcIiAmJiB2YWx1ZS5sZW5ndGggPiAwKSByZXR1cm4gdmFsdWVcblxuICB0aHJvdyBuZXcgRXJyb3IoYCR7cmVzb3VyY2VUeXBlfSBjb25mbGljdFRyYWNraW5nLiR7a2V5fSBtdXN0IGJlIGEgbm9uLWVtcHR5IHN0cmluZyBvciBhIGZ1bmN0aW9uIHJlc29sdmluZyBvbmUgKG9yIHN0YXJ0IGFuIG9mZmxpbmUgc2Vzc2lvbilgKVxufVxuIl19