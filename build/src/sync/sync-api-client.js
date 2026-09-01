// @ts-check
import { optionalBoolean, optionalInteger } from "typanic";
import recordChanges from "../database/record-changes.js";
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
        const resourceId = String(resource.id());
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
     * @param {(payload: {authenticationToken: string, syncs: Array<Record<string, ReturnType<typeof JSON.parse>>>}) => Promise<SyncReplayResponse>} args.postReplay - Transport boundary.
     * @param {(identity: string) => number} args.remoteGeneration - Current remote generation.
     * @param {string} args.resourceType - Resource whose log records should drain.
     * @returns {Promise<void>} Resolves when no ready intent remains.
     */
    static async replayConflictTrackedSyncs({ authenticationToken, batchSize, conflictTracking, postReplay, remoteGeneration, resourceType }) {
        const maxBatchSize = this.normalizedBatchSize(batchSize);
        while (true) {
            const records = await conflictTracking.mutationLog.records();
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
            });
            this.ensureSuccessfulResponse(response);
            const responsesById = new Map((response.syncs || []).map((result) => [String(result.id), result]));
            for (const group of groups) {
                const result = responsesById.get(group[0].mutation.clientMutationId);
                if (!result)
                    throw new Error(`Sync response missing result for mutation ${group[0].mutation.clientMutationId}`);
                if (!["successful", "duplicate", "conflict", "failed", "rejected"].includes(result.syncState)) {
                    throw new Error(`Invalid sync state returned for mutation ${group[0].mutation.clientMutationId}: ${result.syncState}`);
                }
                for (const record of group) {
                    await applySyncReplayResultToLocalMutationLog({ mutationLog: conflictTracking.mutationLog, record, result: /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (result) });
                }
                if (["successful", "duplicate"].includes(result.syncState) && result.serverVersion !== undefined) {
                    const identity = this.conflictRecordIdentity(group[0]);
                    if (remoteGeneration(identity) === generations.get(group[0].mutation.clientMutationId)) {
                        await this.rebaseConflictSuccessor({ conflictTracking, predecessor: group[group.length - 1], serverVersion: result.serverVersion });
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
            onProgress: args.onProgress
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
     * @param {(payload: SyncChangesRequest) => Promise<SyncChangesResponse>} args.postChanges - Posts one changes request.
     * @param {(sync: SyncChangeEnvelope) => Promise<SyncChangeApplyResult>} args.applySync - Applies one normalized sync row locally.
     * @param {(progress: import("./sync-api-client-types.js").SyncPullProgress) => void} [args.onProgress] - Progress callback invoked per applied page (and once for an empty pull) with the applied counts and the stable server total.
     * @returns {Promise<SyncChangesResult>} Pull result.
     */
    static async pullChanges(args) {
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
            const changesResponse = await this.changesPage({ ...args, afterCursor, batchSize, upToCursor });
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
                    const applyResult = await args.applySync(sync);
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
            if (args.onProgress)
                args.onProgress({ pages, syncedCount, total });
            if (syncs.length < batchSize)
                break;
        }
        if (afterCursor)
            await args.saveCursor(afterCursor);
        return { changed, pages, resourceChanged, resourceCounts, syncedCount, total };
    }
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
    static async changesPage({ afterCursor, authenticationToken, batchSize, postChanges, upToCursor }) {
        const response = await postChanges({
            authenticationToken,
            limit: batchSize,
            ...this.cursorPayload("after", afterCursor),
            ...this.cursorPayload("upTo", upToCursor)
        });
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
     * @param {(payload: {authenticationToken: string, syncs: Array<Record<string, ReturnType<typeof JSON.parse>>>}) => Promise<SyncReplayResponse>} args.postReplay - Replay poster.
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
        const resourceRecordId = args.resource.id();
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
     * @param {(payload: {authenticationToken: string, syncs: Array<Record<string, ReturnType<typeof JSON.parse>>>}) => Promise<SyncReplayResponse>} args.postReplay - Posts one replay request.
     * @param {(sync: unknown, response: SyncReplayItem) => Promise<void>} args.markSuccessful - Marks one sync as successful locally.
     * @returns {Promise<void>} Resolves after all batches are replayed.
     */
    static async replayPending(args) {
        const pendingSyncs = await args.pendingSyncs();
        const batchSize = this.normalizedBatchSize(args.batchSize);
        for (let offset = 0; offset < pendingSyncs.length; offset += batchSize) {
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
     * @param {(payload: {authenticationToken: string, syncs: Array<Record<string, ReturnType<typeof JSON.parse>>>}) => Promise<SyncReplayResponse>} args.postReplay - Replay poster.
     * @param {(sync: unknown, response: SyncReplayItem) => Promise<void>} args.markSuccessful - Success hook.
     * @returns {Promise<void>} Resolves after the batch is acknowledged.
     */
    static async replayBatch(args) {
        const { authenticationToken, markSuccessful, pendingSyncs, postReplay, syncId, syncPayload } = args;
        if (pendingSyncs.length === 0)
            return;
        const syncsById = new Map();
        for (const sync of pendingSyncs) {
            const id = syncId(sync);
            if (id !== undefined && id !== null)
                syncsById.set(String(id), sync);
        }
        const response = await postReplay({
            authenticationToken,
            syncs: pendingSyncs.map((sync) => syncPayload(sync))
        });
        this.ensureSuccessfulResponse(response);
        for (const syncResponse of response.syncs || []) {
            const sync = syncsById.get(String(syncResponse.id));
            if (!sync)
                continue;
            if (syncResponse.syncState !== "successful") {
                throw new Error(`Invalid sync state returned for sync ${String(syncResponse.id)}: ${String(syncResponse.syncState)}`);
            }
            await markSuccessful(sync, syncResponse);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3luYy1hcGktY2xpZW50LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3N5bmMvc3luYy1hcGktY2xpZW50LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUMsZUFBZSxFQUFFLGVBQWUsRUFBQyxNQUFNLFNBQVMsQ0FBQTtBQUV4RCxPQUFPLGFBQWEsTUFBTSwrQkFBK0IsQ0FBQTtBQUN6RCxPQUFPLEVBQUMsdUNBQXVDLEVBQUMsTUFBTSx3QkFBd0IsQ0FBQTtBQUU5RSxrR0FBa0c7QUFDbEcsNEZBQTRGO0FBQzVGLDRGQUE0RjtBQUM1Riw4RkFBOEY7QUFDOUYsMEZBQTBGO0FBQzFGLDRFQUE0RTtBQUM1RSxvRkFBb0Y7QUFDcEYsNEZBQTRGO0FBQzVGLDRGQUE0RjtBQUM1RixNQUFNLGdCQUFnQixHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7QUFFbEM7Ozs7R0FJRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8sYUFBYTtJQUNoQzs7Ozs7Ozs7Ozs7T0FXRztJQUNILE1BQU0sQ0FBQyxLQUFLLENBQUMsd0JBQXdCLENBQUMsRUFBQyxXQUFXLEVBQUUsZ0JBQWdCLEVBQUUsSUFBSSxFQUFFLFNBQVMsRUFBRSxRQUFRLEVBQUUsWUFBWSxFQUFFLFFBQVEsRUFBQztRQUN0SCxNQUFNLFVBQVUsR0FBRyxNQUFNLENBQUMsUUFBUSxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUE7UUFDeEMsTUFBTSxPQUFPLEdBQUcsTUFBTSxnQkFBZ0IsQ0FBQyxXQUFXLENBQUMsT0FBTyxFQUFFLENBQUE7UUFDNUQsTUFBTSxXQUFXLEdBQUcsT0FBTzthQUN4QixNQUFNLENBQUMsQ0FBQyxNQUFNLEVBQUUsRUFBRSxDQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUMsS0FBSyxLQUFLLFlBQVksSUFBSSxNQUFNLENBQUMsUUFBUSxDQUFDLE9BQU8sRUFBRSxVQUFVLEtBQUssVUFBVSxDQUFDO2FBQ2hILEVBQUUs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QUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxRQUFRLENBQUMsS0FBSyxDQUFDO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyw2QkFBNkIsQ0FBQyxDQUFBO0lBQ3BGLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsTUFBTSxDQUFDLG1CQUFtQixDQUFDLFNBQVM7UUFDbEMsSUFBSSxPQUFPLFNBQVMsS0FBSyxRQUFRLElBQUksQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLFNBQVMsQ0FBQyxJQUFJLFNBQVMsR0FBRyxDQUFDO1lBQUUsT0FBTyxHQUFHLENBQUE7UUFFN0YsT0FBTyxJQUFJLENBQUMsS0FBSyxDQUFDLFNBQVMsQ0FBQyxDQUFBO0lBQzlCLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQge29wdGlvbmFsQm9vbGVhbiwgb3B0aW9uYWxJbnRlZ2VyfSBmcm9tIFwidHlwYW5pY1wiXG5cbmltcG9ydCByZWNvcmRDaGFuZ2VzIGZyb20gXCIuLi9kYXRhYmFzZS9yZWNvcmQtY2hhbmdlcy5qc1wiXG5pbXBvcnQge2FwcGx5U3luY1JlcGxheVJlc3VsdFRvTG9jYWxNdXRhdGlvbkxvZ30gZnJvbSBcIi4vY29uZmxpY3Qtc3RyYXRlZ3kuanNcIlxuXG4vKiogQHR5cGVkZWYge2ltcG9ydChcIi4vc3luYy1hcGktY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDaGFuZ2VBcHBseVJlc3VsdH0gU3luY0NoYW5nZUFwcGx5UmVzdWx0ICovXG4vKiogQHR5cGVkZWYge2ltcG9ydChcIi4vc3luYy1hcGktY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDaGFuZ2VFbnZlbG9wZX0gU3luY0NoYW5nZUVudmVsb3BlICovXG4vKiogQHR5cGVkZWYge2ltcG9ydChcIi4vc3luYy1hcGktY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDaGFuZ2VzUmVxdWVzdH0gU3luY0NoYW5nZXNSZXF1ZXN0ICovXG4vKiogQHR5cGVkZWYge2ltcG9ydChcIi4vc3luYy1hcGktY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDaGFuZ2VzUmVzcG9uc2V9IFN5bmNDaGFuZ2VzUmVzcG9uc2UgKi9cbi8qKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi9zeW5jLWFwaS1jbGllbnQtdHlwZXMuanNcIikuU3luY0NoYW5nZXNSZXN1bHR9IFN5bmNDaGFuZ2VzUmVzdWx0ICovXG4vKiogQHR5cGVkZWYge2ltcG9ydChcIi4vc3luYy1hcGktY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDdXJzb3J9IFN5bmNDdXJzb3IgKi9cbi8qKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi9zeW5jLWFwaS1jbGllbnQtdHlwZXMuanNcIikuU3luY1JlcGxheUl0ZW19IFN5bmNSZXBsYXlJdGVtICovXG4vKiogQHR5cGVkZWYge2ltcG9ydChcIi4vc3luYy1hcGktY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNSZXBsYXlSZXNwb25zZX0gU3luY1JlcGxheVJlc3BvbnNlICovXG4vKiogQHR5cGVkZWYge2ltcG9ydChcIi4vc3luYy1hcGktY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNSZXNvdXJjZUNvbmZpZ30gU3luY1Jlc291cmNlQ29uZmlnICovXG5jb25zdCBzeW5jVGFza1Byb21pc2VzID0gbmV3IE1hcCgpXG5cbi8qKlxuICogR2VuZXJpYyBjbGllbnQtc2lkZSBoZWxwZXIgZm9yIHJlcGxheWluZyBwZW5kaW5nIHN5bmMgZW52ZWxvcGVzIHRocm91Z2ggdGhlXG4gKiBmcmFtZXdvcmstb3duZWQgYC92ZWxvY2lvdXMvc3luYy9yZXBsYXlgIGVuZHBvaW50LiBBcHBzIHByb3ZpZGUgb25seSBsb2NhbFxuICogcGVyc2lzdGVuY2UvYXV0aCBob29rcy5cbiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgU3luY0FwaUNsaWVudCB7XG4gIC8qKlxuICAgKiBBcHBlbmRzIG9uZSBjb25mbGljdC10cmFja2VkIGludGVudCB0byB0aGUgZXhpc3RpbmcgZHVyYWJsZSBtdXRhdGlvbiBsb2cuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gUXVldWUgYXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG51bWJlciB8IG51bGx9IGFyZ3MuYmFzZVZlcnNpb24gLSBBdXRob3JpdGF0aXZlIHZlcnNpb24gb2JzZXJ2ZWQgYmVmb3JlIHRoZSBsb2NhbCBtdXRhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDbGllbnRDb25mbGljdFRyYWNraW5nQ29uZmlnfSBhcmdzLmNvbmZsaWN0VHJhY2tpbmcgLSBEdXJhYmxlIHRyYWNraW5nIGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59IGFyZ3MuZGF0YSAtIEJhY2tlbmQtc2FmZSBtdXRhdGlvbiBhdHRyaWJ1dGVzLlxuICAgKiBAcGFyYW0ge1wiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCJ9IGFyZ3Mub3BlcmF0aW9uIC0gTG9jYWwgb3BlcmF0aW9uLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLnJlc291cmNlIC0gTG9jYWwgcmVzb3VyY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnJlc291cmNlVHlwZSAtIFJlc291cmNlIHR5cGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnN5bmNUeXBlIC0gV2lyZSBvcGVyYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vbG9jYWwtbXV0YXRpb24tbG9nLmpzXCIpLkxvY2FsTXV0YXRpb25Mb2dSZWNvcmQ+fSBBcHBlbmRlZCBpbnRlbnQuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgcXVldWVDb25mbGljdFRyYWNrZWRTeW5jKHtiYXNlVmVyc2lvbiwgY29uZmxpY3RUcmFja2luZywgZGF0YSwgb3BlcmF0aW9uLCByZXNvdXJjZSwgcmVzb3VyY2VUeXBlLCBzeW5jVHlwZX0pIHtcbiAgICBjb25zdCByZXNvdXJjZUlkID0gU3RyaW5nKHJlc291cmNlLmlkKCkpXG4gICAgY29uc3QgcmVjb3JkcyA9IGF3YWl0IGNvbmZsaWN0VHJhY2tpbmcubXV0YXRpb25Mb2cucmVjb3JkcygpXG4gICAgY29uc3QgcHJlZGVjZXNzb3IgPSByZWNvcmRzXG4gICAgICAuZmlsdGVyKChyZWNvcmQpID0+IHJlY29yZC5tdXRhdGlvbi5tb2RlbCA9PT0gcmVzb3VyY2VUeXBlICYmIHJlY29yZC5tdXRhdGlvbi5wYXlsb2FkPy5yZXNvdXJjZUlkID09PSByZXNvdXJjZUlkKVxuICAgICAgLmF0KC0xKVxuICAgIGNvbnN0IGNsaWVudE11dGF0aW9uSWQgPSBjb25mbGljdFRyYWNraW5nLmNsaWVudE11dGF0aW9uSWQoKVxuICAgIGNvbnN0IG5vdyA9IGNvbmZsaWN0VHJhY2tpbmcubm93ID8gY29uZmxpY3RUcmFja2luZy5ub3coKSA6IG5ldyBEYXRlKClcbiAgICBjb25zdCBwcmVkZWNlc3NvclRpbWUgPSBwcmVkZWNlc3NvciA/IG5ldyBEYXRlKHByZWRlY2Vzc29yLm11dGF0aW9uLm9jY3VycmVkQXQpLmdldFRpbWUoKSA6IE51bWJlci5ORUdBVElWRV9JTkZJTklUWVxuICAgIGNvbnN0IG9jY3VycmVkQXQgPSBuZXcgRGF0ZShNYXRoLm1heChub3cuZ2V0VGltZSgpLCBwcmVkZWNlc3NvclRpbWUgKyAxKSkudG9JU09TdHJpbmcoKVxuXG4gICAgcmV0dXJuIGF3YWl0IGNvbmZsaWN0VHJhY2tpbmcubXV0YXRpb25Mb2cuYXBwZW5kKHtcbiAgICAgIGRlcGVuZGVuY2llczogcHJlZGVjZXNzb3IgPyBbe2NsaWVudE11dGF0aW9uSWQ6IHByZWRlY2Vzc29yLm11dGF0aW9uLmNsaWVudE11dGF0aW9uSWQsIG1vZGVsOiByZXNvdXJjZVR5cGV9XSA6IFtdLFxuICAgICAgbXV0YXRpb246IHtcbiAgICAgICAgYWN0b3JEZXZpY2VJZDogY29uZmxpY3RUcmFja2luZy5hY3RvckRldmljZUlkLFxuICAgICAgICBhY3RvclVzZXJJZDogY29uZmxpY3RUcmFja2luZy5hY3RvclVzZXJJZCxcbiAgICAgICAgYXR0cmlidXRlczogLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxTeW5jSnNvblZhbHVlPn0gKi8gKGRhdGEpLFxuICAgICAgICBiYXNlVmVyc2lvbixcbiAgICAgICAgY2xpZW50TXV0YXRpb25JZCxcbiAgICAgICAgbW9kZWw6IHJlc291cmNlVHlwZSxcbiAgICAgICAgb2NjdXJyZWRBdCxcbiAgICAgICAgb2ZmbGluZUdyYW50SWQ6IGNvbmZsaWN0VHJhY2tpbmcub2ZmbGluZUdyYW50SWQsXG4gICAgICAgIG9wZXJhdGlvbixcbiAgICAgICAgcGF5bG9hZDoge3Jlc291cmNlSWQsIHN5bmNUeXBlfSxcbiAgICAgICAgcG9saWN5SGFzaDogY29uZmxpY3RUcmFja2luZy5wb2xpY3lIYXNoXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBEcmFpbnMgdGhlIGV4aXN0aW5nIG11dGF0aW9uIGxvZyBpbiBwcmVkZWNlc3NvciBvcmRlci4gSW5kZXBlbmRlbnQgcmVjb3Jkc1xuICAgKiBjb250aW51ZSBhZnRlciBkdXJhYmxlIGNvbmZsaWN0cy9yZWplY3Rpb25zOyBzdWNjZXNzb3JzIHN0YXkgYmxvY2tlZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBSZXBsYXkgYXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5hdXRoZW50aWNhdGlvblRva2VuIC0gQXV0aGVudGljYXRpb24gdG9rZW4uXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5iYXRjaFNpemVdIC0gQmF0Y2ggc2l6ZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDbGllbnRDb25mbGljdFRyYWNraW5nQ29uZmlnfSBhcmdzLmNvbmZsaWN0VHJhY2tpbmcgLSBUcmFja2luZyBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0geyhwYXlsb2FkOiB7YXV0aGVudGljYXRpb25Ub2tlbjogc3RyaW5nLCBzeW5jczogQXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0pID0+IFByb21pc2U8U3luY1JlcGxheVJlc3BvbnNlPn0gYXJncy5wb3N0UmVwbGF5IC0gVHJhbnNwb3J0IGJvdW5kYXJ5LlxuICAgKiBAcGFyYW0geyhpZGVudGl0eTogc3RyaW5nKSA9PiBudW1iZXJ9IGFyZ3MucmVtb3RlR2VuZXJhdGlvbiAtIEN1cnJlbnQgcmVtb3RlIGdlbmVyYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnJlc291cmNlVHlwZSAtIFJlc291cmNlIHdob3NlIGxvZyByZWNvcmRzIHNob3VsZCBkcmFpbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIHdoZW4gbm8gcmVhZHkgaW50ZW50IHJlbWFpbnMuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgcmVwbGF5Q29uZmxpY3RUcmFja2VkU3luY3Moe2F1dGhlbnRpY2F0aW9uVG9rZW4sIGJhdGNoU2l6ZSwgY29uZmxpY3RUcmFja2luZywgcG9zdFJlcGxheSwgcmVtb3RlR2VuZXJhdGlvbiwgcmVzb3VyY2VUeXBlfSkge1xuICAgIGNvbnN0IG1heEJhdGNoU2l6ZSA9IHRoaXMubm9ybWFsaXplZEJhdGNoU2l6ZShiYXRjaFNpemUpXG5cbiAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgY29uc3QgcmVjb3JkcyA9IGF3YWl0IGNvbmZsaWN0VHJhY2tpbmcubXV0YXRpb25Mb2cucmVjb3JkcygpXG4gICAgICBjb25zdCBzdGF0dXNlcyA9IG5ldyBNYXAocmVjb3Jkcy5tYXAoKHJlY29yZCkgPT4gW3JlY29yZC5tdXRhdGlvbi5jbGllbnRNdXRhdGlvbklkLCByZWNvcmQuc3RhdHVzXSkpXG4gICAgICBjb25zdCBwZW5kaW5nID0gcmVjb3Jkcy5maWx0ZXIoKHJlY29yZCkgPT4gcmVjb3JkLnN0YXR1cyA9PT0gXCJwZW5kaW5nXCIgJiYgcmVjb3JkLm11dGF0aW9uLm1vZGVsID09PSByZXNvdXJjZVR5cGUpXG4gICAgICBjb25zdCByZWFkeSA9IHBlbmRpbmcuZmlsdGVyKChyZWNvcmQpID0+IHJlY29yZC5kZXBlbmRlbmNpZXMuZXZlcnkoKGRlcGVuZGVuY3kpID0+IHN0YXR1c2VzLmdldChkZXBlbmRlbmN5LmNsaWVudE11dGF0aW9uSWQpID09PSBcInN5bmNlZFwiKSlcblxuICAgICAgaWYgKHJlYWR5Lmxlbmd0aCA9PT0gMCkgcmV0dXJuXG5cbiAgICAgIGNvbnN0IGdyb3VwcyA9IHRoaXMuY29uZmxpY3RSZXBsYXlHcm91cHMoe3BlbmRpbmcsIHJlYWR5fSkuc2xpY2UoMCwgbWF4QmF0Y2hTaXplKVxuICAgICAgY29uc3QgZ2VuZXJhdGlvbnMgPSBuZXcgTWFwKGdyb3Vwcy5tYXAoKGdyb3VwKSA9PiBbZ3JvdXBbMF0ubXV0YXRpb24uY2xpZW50TXV0YXRpb25JZCwgcmVtb3RlR2VuZXJhdGlvbih0aGlzLmNvbmZsaWN0UmVjb3JkSWRlbnRpdHkoZ3JvdXBbMF0pKV0pKVxuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBwb3N0UmVwbGF5KHtcbiAgICAgICAgYXV0aGVudGljYXRpb25Ub2tlbixcbiAgICAgICAgc3luY3M6IGdyb3Vwcy5tYXAoKGdyb3VwKSA9PiB0aGlzLmNvbmZsaWN0UmVwbGF5UGF5bG9hZChncm91cCkpXG4gICAgICB9KVxuXG4gICAgICB0aGlzLmVuc3VyZVN1Y2Nlc3NmdWxSZXNwb25zZShyZXNwb25zZSlcblxuICAgICAgY29uc3QgcmVzcG9uc2VzQnlJZCA9IG5ldyBNYXAoKHJlc3BvbnNlLnN5bmNzIHx8IFtdKS5tYXAoKHJlc3VsdCkgPT4gW1N0cmluZyhyZXN1bHQuaWQpLCByZXN1bHRdKSlcblxuICAgICAgZm9yIChjb25zdCBncm91cCBvZiBncm91cHMpIHtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gcmVzcG9uc2VzQnlJZC5nZXQoZ3JvdXBbMF0ubXV0YXRpb24uY2xpZW50TXV0YXRpb25JZClcblxuICAgICAgICBpZiAoIXJlc3VsdCkgdGhyb3cgbmV3IEVycm9yKGBTeW5jIHJlc3BvbnNlIG1pc3NpbmcgcmVzdWx0IGZvciBtdXRhdGlvbiAke2dyb3VwWzBdLm11dGF0aW9uLmNsaWVudE11dGF0aW9uSWR9YClcbiAgICAgICAgaWYgKCFbXCJzdWNjZXNzZnVsXCIsIFwiZHVwbGljYXRlXCIsIFwiY29uZmxpY3RcIiwgXCJmYWlsZWRcIiwgXCJyZWplY3RlZFwiXS5pbmNsdWRlcyhyZXN1bHQuc3luY1N0YXRlKSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBzeW5jIHN0YXRlIHJldHVybmVkIGZvciBtdXRhdGlvbiAke2dyb3VwWzBdLm11dGF0aW9uLmNsaWVudE11dGF0aW9uSWR9OiAke3Jlc3VsdC5zeW5jU3RhdGV9YClcbiAgICAgICAgfVxuXG4gICAgICAgIGZvciAoY29uc3QgcmVjb3JkIG9mIGdyb3VwKSB7XG4gICAgICAgICAgYXdhaXQgYXBwbHlTeW5jUmVwbGF5UmVzdWx0VG9Mb2NhbE11dGF0aW9uTG9nKHttdXRhdGlvbkxvZzogY29uZmxpY3RUcmFja2luZy5tdXRhdGlvbkxvZywgcmVjb3JkLCByZXN1bHQ6IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAocmVzdWx0KX0pXG4gICAgICAgIH1cblxuICAgICAgICBpZiAoW1wic3VjY2Vzc2Z1bFwiLCBcImR1cGxpY2F0ZVwiXS5pbmNsdWRlcyhyZXN1bHQuc3luY1N0YXRlKSAmJiByZXN1bHQuc2VydmVyVmVyc2lvbiAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgY29uc3QgaWRlbnRpdHkgPSB0aGlzLmNvbmZsaWN0UmVjb3JkSWRlbnRpdHkoZ3JvdXBbMF0pXG5cbiAgICAgICAgICBpZiAocmVtb3RlR2VuZXJhdGlvbihpZGVudGl0eSkgPT09IGdlbmVyYXRpb25zLmdldChncm91cFswXS5tdXRhdGlvbi5jbGllbnRNdXRhdGlvbklkKSkge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5yZWJhc2VDb25mbGljdFN1Y2Nlc3Nvcih7Y29uZmxpY3RUcmFja2luZywgcHJlZGVjZXNzb3I6IGdyb3VwW2dyb3VwLmxlbmd0aCAtIDFdLCBzZXJ2ZXJWZXJzaW9uOiByZXN1bHQuc2VydmVyVmVyc2lvbn0pXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBzYWZlIHRyYW5zcG9ydCBncm91cHMgZnJvbSByb290LXJlYWR5IHJlY29yZHMgYW5kIHRoZWlyIHN1Y2Nlc3NvcnMuXG4gICAqIEBwYXJhbSB7e3BlbmRpbmc6IEFycmF5PGltcG9ydChcIi4vbG9jYWwtbXV0YXRpb24tbG9nLmpzXCIpLkxvY2FsTXV0YXRpb25Mb2dSZWNvcmQ+LCByZWFkeTogQXJyYXk8aW1wb3J0KFwiLi9sb2NhbC1tdXRhdGlvbi1sb2cuanNcIikuTG9jYWxNdXRhdGlvbkxvZ1JlY29yZD59fSBhcmdzIC0gUGVuZGluZyBhbmQgcm9vdC1yZWFkeSByZWNvcmRzLlxuICAgKiBAcmV0dXJucyB7QXJyYXk8QXJyYXk8aW1wb3J0KFwiLi9sb2NhbC1tdXRhdGlvbi1sb2cuanNcIikuTG9jYWxNdXRhdGlvbkxvZ1JlY29yZD4+fSBTYWZlIHRyYW5zcG9ydCBncm91cHMuXG4gICAqL1xuICBzdGF0aWMgY29uZmxpY3RSZXBsYXlHcm91cHMoe3BlbmRpbmcsIHJlYWR5fSkge1xuICAgIGNvbnN0IGdyb3VwcyA9IFtdXG4gICAgY29uc3Qgc2VsZWN0ZWRJZGVudGl0aWVzID0gbmV3IFNldCgpXG5cbiAgICBmb3IgKGNvbnN0IHJlY29yZCBvZiByZWFkeSkge1xuICAgICAgY29uc3QgaWRlbnRpdHkgPSB0aGlzLmNvbmZsaWN0UmVjb3JkSWRlbnRpdHkocmVjb3JkKVxuXG4gICAgICBpZiAoc2VsZWN0ZWRJZGVudGl0aWVzLmhhcyhpZGVudGl0eSkpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IGdyb3VwID0gW3JlY29yZF1cbiAgICAgIGxldCB0YWlsID0gcmVjb3JkXG5cbiAgICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICAgIGNvbnN0IHN1Y2Nlc3NvciA9IHBlbmRpbmcuZmluZCgoY2FuZGlkYXRlKSA9PiBjYW5kaWRhdGUuZGVwZW5kZW5jaWVzLnNvbWUoKGRlcGVuZGVuY3kpID0+IGRlcGVuZGVuY3kuY2xpZW50TXV0YXRpb25JZCA9PT0gdGFpbC5tdXRhdGlvbi5jbGllbnRNdXRhdGlvbklkKSlcblxuICAgICAgICBpZiAoIXN1Y2Nlc3NvciB8fCAhdGhpcy5jYW5Db2FsZXNjZUNvbmZsaWN0UmVjb3Jkcyh0YWlsLCBzdWNjZXNzb3IpKSBicmVha1xuICAgICAgICBncm91cC5wdXNoKHN1Y2Nlc3NvcilcbiAgICAgICAgdGFpbCA9IHN1Y2Nlc3NvclxuICAgICAgfVxuXG4gICAgICBncm91cHMucHVzaChncm91cClcbiAgICAgIHNlbGVjdGVkSWRlbnRpdGllcy5hZGQoaWRlbnRpdHkpXG4gICAgfVxuXG4gICAgcmV0dXJuIGdyb3Vwc1xuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrcyB3aGV0aGVyIHR3byBkdXJhYmxlIGludGVudHMgY2FuIHNoYXJlIG9uZSB0cmFuc3BvcnQgbXV0YXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9sb2NhbC1tdXRhdGlvbi1sb2cuanNcIikuTG9jYWxNdXRhdGlvbkxvZ1JlY29yZH0gbGVmdCAtIEVhcmxpZXIgaW50ZW50LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vbG9jYWwtbXV0YXRpb24tbG9nLmpzXCIpLkxvY2FsTXV0YXRpb25Mb2dSZWNvcmR9IHJpZ2h0IC0gTGF0ZXIgaW50ZW50LlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gV2hldGhlciBzY2FsYXIgdXBkYXRlcyBjYW4gc2hhcmUgb25lIHRyYW5zcG9ydCBtdXRhdGlvbi5cbiAgICovXG4gIHN0YXRpYyBjYW5Db2FsZXNjZUNvbmZsaWN0UmVjb3JkcyhsZWZ0LCByaWdodCkge1xuICAgIGlmIChsZWZ0Lm11dGF0aW9uLm9wZXJhdGlvbiAhPT0gXCJ1cGRhdGVcIiB8fCByaWdodC5tdXRhdGlvbi5vcGVyYXRpb24gIT09IFwidXBkYXRlXCIpIHJldHVybiBmYWxzZVxuICAgIGlmICh0aGlzLmNvbmZsaWN0UmVjb3JkSWRlbnRpdHkobGVmdCkgIT09IHRoaXMuY29uZmxpY3RSZWNvcmRJZGVudGl0eShyaWdodCkpIHJldHVybiBmYWxzZVxuICAgIGlmIChsZWZ0Lm11dGF0aW9uLmJhc2VWZXJzaW9uICE9PSByaWdodC5tdXRhdGlvbi5iYXNlVmVyc2lvbikgcmV0dXJuIGZhbHNlXG4gICAgaWYgKCF0aGlzLnNjYWxhclN5bmNBdHRyaWJ1dGVzKGxlZnQubXV0YXRpb24uYXR0cmlidXRlcykgfHwgIXRoaXMuc2NhbGFyU3luY0F0dHJpYnV0ZXMocmlnaHQubXV0YXRpb24uYXR0cmlidXRlcykpIHJldHVybiBmYWxzZVxuXG4gICAgcmV0dXJuICFPYmplY3Qua2V5cyhsZWZ0Lm11dGF0aW9uLmF0dHJpYnV0ZXMgfHwge30pLnNvbWUoKGtleSkgPT4gT2JqZWN0Lmhhc093bihyaWdodC5tdXRhdGlvbi5hdHRyaWJ1dGVzIHx8IHt9LCBrZXkpKVxuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrcyB3aGV0aGVyIGF0dHJpYnV0ZXMgY29udGFpbiBzY2FsYXIgSlNPTiB2YWx1ZXMgb25seS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkZyb250ZW5kTW9kZWxTeW5jSnNvblZhbHVlPiB8IHVuZGVmaW5lZH0gYXR0cmlidXRlcyAtIEF0dHJpYnV0ZXMuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSBXaGV0aGVyIGV2ZXJ5IHZhbHVlIGlzIHNjYWxhci5cbiAgICovXG4gIHN0YXRpYyBzY2FsYXJTeW5jQXR0cmlidXRlcyhhdHRyaWJ1dGVzKSB7XG4gICAgcmV0dXJuIEJvb2xlYW4oYXR0cmlidXRlcykgJiYgT2JqZWN0LnZhbHVlcyhhdHRyaWJ1dGVzIHx8IHt9KS5ldmVyeSgodmFsdWUpID0+IHZhbHVlID09PSBudWxsIHx8IFtcInN0cmluZ1wiLCBcIm51bWJlclwiLCBcImJvb2xlYW5cIl0uaW5jbHVkZXModHlwZW9mIHZhbHVlKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgb25lIHJlcGxheSBlbnZlbG9wZSBmb3IgYSBzYWZlIHRyYW5zcG9ydCBncm91cC5cbiAgICogQHBhcmFtIHtBcnJheTxpbXBvcnQoXCIuL2xvY2FsLW11dGF0aW9uLWxvZy5qc1wiKS5Mb2NhbE11dGF0aW9uTG9nUmVjb3JkPn0gZ3JvdXAgLSBUcmFuc3BvcnQgZ3JvdXAuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IFJlcGxheSBlbnZlbG9wZS5cbiAgICovXG4gIHN0YXRpYyBjb25mbGljdFJlcGxheVBheWxvYWQoZ3JvdXApIHtcbiAgICBjb25zdCBmaXJzdCA9IGdyb3VwWzBdXG4gICAgY29uc3QgcGF5bG9hZCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoe1xuICAgICAgYmFzZVZlcnNpb246IGZpcnN0Lm11dGF0aW9uLmJhc2VWZXJzaW9uLFxuICAgICAgY2xpZW50VXBkYXRlZEF0OiBmaXJzdC5tdXRhdGlvbi5vY2N1cnJlZEF0LFxuICAgICAgZGF0YTogT2JqZWN0LmFzc2lnbih7fSwgLi4uZ3JvdXAubWFwKChyZWNvcmQpID0+IHJlY29yZC5tdXRhdGlvbi5hdHRyaWJ1dGVzIHx8IHt9KSksXG4gICAgICBpZDogZmlyc3QubXV0YXRpb24uY2xpZW50TXV0YXRpb25JZCxcbiAgICAgIHJlc291cmNlSWQ6IGZpcnN0Lm11dGF0aW9uLnBheWxvYWQ/LnJlc291cmNlSWQsXG4gICAgICByZXNvdXJjZVR5cGU6IGZpcnN0Lm11dGF0aW9uLm1vZGVsLFxuICAgICAgc3luY1R5cGU6IGZpcnN0Lm11dGF0aW9uLnBheWxvYWQ/LnN5bmNUeXBlXG4gICAgfSlcblxuICAgIHJldHVybiBwYXlsb2FkXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIGEgc3RhYmxlIHJlc291cmNlIGlkZW50aXR5IGZvciBvcmRlcmluZyBhbmQgcmVtb3RlIGdlbmVyYXRpb25zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vbG9jYWwtbXV0YXRpb24tbG9nLmpzXCIpLkxvY2FsTXV0YXRpb25Mb2dSZWNvcmR9IHJlY29yZCAtIFJlY29yZC5cbiAgICogQHJldHVybnMge3N0cmluZ30gUmVzb3VyY2UgaWRlbnRpdHkuXG4gICAqL1xuICBzdGF0aWMgY29uZmxpY3RSZWNvcmRJZGVudGl0eShyZWNvcmQpIHtcbiAgICByZXR1cm4gYCR7cmVjb3JkLm11dGF0aW9uLm1vZGVsfToke1N0cmluZyhyZWNvcmQubXV0YXRpb24ucGF5bG9hZD8ucmVzb3VyY2VJZCl9YFxuICB9XG5cbiAgLyoqXG4gICAqIFJlYmFzZXMgdGhlIGRpcmVjdCBwZW5kaW5nIHN1Y2Nlc3NvciBmcm9tIGFuIGF1dGhvcml0YXRpdmUgYWNrbm93bGVkZ2VtZW50LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFJlYmFzZSBhcmdzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vc3luYy1jbGllbnQtdHlwZXMuanNcIikuU3luY0NsaWVudENvbmZsaWN0VHJhY2tpbmdDb25maWd9IGFyZ3MuY29uZmxpY3RUcmFja2luZyAtIFRyYWNraW5nIGNvbmZpZy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2xvY2FsLW11dGF0aW9uLWxvZy5qc1wiKS5Mb2NhbE11dGF0aW9uTG9nUmVjb3JkfSBhcmdzLnByZWRlY2Vzc29yIC0gQWNrbm93bGVkZ2VkIHByZWRlY2Vzc29yLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG51bWJlciB8IG51bGx9IGFyZ3Muc2VydmVyVmVyc2lvbiAtIEF1dGhvcml0YXRpdmUgc2VydmVyIHZlcnNpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHJlYmFzZUNvbmZsaWN0U3VjY2Vzc29yKHtjb25mbGljdFRyYWNraW5nLCBwcmVkZWNlc3Nvciwgc2VydmVyVmVyc2lvbn0pIHtcbiAgICBjb25zdCBzdWNjZXNzb3IgPSAoYXdhaXQgY29uZmxpY3RUcmFja2luZy5tdXRhdGlvbkxvZy5wZW5kaW5nUmVjb3JkcygpKVxuICAgICAgLmZpbmQoKHJlY29yZCkgPT4gcmVjb3JkLmRlcGVuZGVuY2llcy5zb21lKChkZXBlbmRlbmN5KSA9PiBkZXBlbmRlbmN5LmNsaWVudE11dGF0aW9uSWQgPT09IHByZWRlY2Vzc29yLm11dGF0aW9uLmNsaWVudE11dGF0aW9uSWQpKVxuXG4gICAgaWYgKCFzdWNjZXNzb3IpIHJldHVyblxuXG4gICAgYXdhaXQgY29uZmxpY3RUcmFja2luZy5tdXRhdGlvbkxvZy51cGRhdGVNdXRhdGlvbih7XG4gICAgICBpZDogc3VjY2Vzc29yLmlkLFxuICAgICAgbXV0YXRpb246IHsuLi5zdWNjZXNzb3IubXV0YXRpb24sIGJhc2VWZXJzaW9uOiBzZXJ2ZXJWZXJzaW9ufVxuICAgIH0pXG4gIH1cbiAgLyoqXG4gICAqIFNlcmlhbGl6ZXMgc3luYyB3b3JrIHdpdGggdGhlIHNhbWUga2V5IHNvIGNhbGxlcnMgZG8gbm90IGhhdmUgdG8ga2VlcCBhcHAtbG9jYWwgbG9ja3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBrZXkgLSBMb2NrIGtleS5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPHZvaWQ+fSBjYWxsYmFjayAtIFdvcmsgdG8gcnVuIG9uY2UgcHJldmlvdXMgd29yayBmaW5pc2hlZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBzdGF0aWMgYXN5bmMgc2luZ2xlRmxpZ2h0KGtleSwgY2FsbGJhY2spIHtcbiAgICB3aGlsZSAoc3luY1Rhc2tQcm9taXNlcy5oYXMoa2V5KSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgc3luY1Rhc2tQcm9taXNlcy5nZXQoa2V5KVxuICAgICAgfSBjYXRjaCAoX2Vycm9yKSB7XG4gICAgICAgIC8vIFRoZSBmYWlsZWQgZmxpZ2h0J3Mgb3duIGNhbGxlciBvYnNlcnZlcyB0aGF0IHJlamVjdGlvbjsgY2FsbGVycyBxdWV1ZWRcbiAgICAgICAgLy8gYmVoaW5kIGl0IHN0aWxsIHJ1biB0aGVpciBvd24gd29yayBzbyBwZW5kaW5nIHJvd3MgcmV0cnkgYWZ0ZXIgdGhlIGxvY2sgY2xlYXJzLlxuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IHByb21pc2UgPSBjYWxsYmFjaygpXG4gICAgc3luY1Rhc2tQcm9taXNlcy5zZXQoa2V5LCBwcm9taXNlKVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHByb21pc2VcbiAgICB9IGZpbmFsbHkge1xuICAgICAgaWYgKHN5bmNUYXNrUHJvbWlzZXMuZ2V0KGtleSkgPT09IHByb21pc2UpIHN5bmNUYXNrUHJvbWlzZXMuZGVsZXRlKGtleSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUHVsbHMgYmFja2VuZCBzeW5jIGNoYW5nZXMgd2l0aCBhIGZyYW1ld29yay1tYW5hZ2VkIGN1cnNvciByb3cuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gUHVsbCBhcmdzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5hdXRoZW50aWNhdGlvblRva2VuIC0gQXV0aCB0b2tlbiB0byBzZW5kIHdpdGggY2hhbmdlIHJlcXVlc3RzLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuYmF0Y2hTaXplXSAtIE1heCBzeW5jcyBwZXIgcmVxdWVzdC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5jdXJzb3JNb2RlbCAtIE1vZGVsIHRoYXQgcmVzcG9uZHMgdG8gZmluZEJ5L2ZpbmRPckluaXRpYWxpemVCeSBmb3IgY3Vyc29yIHBlcnNpc3RlbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jdXJzb3JLZXkgLSBDdXJzb3Igb3B0aW9uIGtleS5cbiAgICogQHBhcmFtIHsocGF5bG9hZDogU3luY0NoYW5nZXNSZXF1ZXN0KSA9PiBQcm9taXNlPFN5bmNDaGFuZ2VzUmVzcG9uc2U+fSBhcmdzLnBvc3RDaGFuZ2VzIC0gUG9zdHMgb25lIGNoYW5nZXMgcmVxdWVzdC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBTeW5jUmVzb3VyY2VDb25maWc+fSBhcmdzLnJlc291cmNlcyAtIFJlc291cmNlIHBvbGljaWVzLlxuICAgKiBAcGFyYW0geyhwcm9ncmVzczogaW1wb3J0KFwiLi9zeW5jLWFwaS1jbGllbnQtdHlwZXMuanNcIikuU3luY1B1bGxQcm9ncmVzcykgPT4gdm9pZH0gW2FyZ3Mub25Qcm9ncmVzc10gLSBQcm9ncmVzcyBjYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8U3luY0NoYW5nZXNSZXN1bHQ+fSBQdWxsIHJlc3VsdC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBwdWxsQ2hhbmdlc1dpdGhDdXJzb3IoYXJncykge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLnB1bGxDaGFuZ2VzKHtcbiAgICAgIGF1dGhlbnRpY2F0aW9uVG9rZW46IGFyZ3MuYXV0aGVudGljYXRpb25Ub2tlbixcbiAgICAgIGJhdGNoU2l6ZTogYXJncy5iYXRjaFNpemUsXG4gICAgICBsb2FkQ3Vyc29yOiBhc3luYyAoKSA9PiBhd2FpdCB0aGlzLmxvYWRTeW5jQ3Vyc29yKHtjdXJzb3JLZXk6IGFyZ3MuY3Vyc29yS2V5LCBjdXJzb3JNb2RlbDogYXJncy5jdXJzb3JNb2RlbH0pLFxuICAgICAgc2F2ZUN1cnNvcjogYXN5bmMgKGN1cnNvcikgPT4gYXdhaXQgdGhpcy5zYXZlU3luY0N1cnNvcih7Y3Vyc29yLCBjdXJzb3JLZXk6IGFyZ3MuY3Vyc29yS2V5LCBjdXJzb3JNb2RlbDogYXJncy5jdXJzb3JNb2RlbH0pLFxuICAgICAgcG9zdENoYW5nZXM6IGFyZ3MucG9zdENoYW5nZXMsXG4gICAgICBhcHBseVN5bmM6IHRoaXMucmVzb3VyY2VBcHBsaWVyKGFyZ3MucmVzb3VyY2VzKSxcbiAgICAgIG9uUHJvZ3Jlc3M6IGFyZ3Mub25Qcm9ncmVzc1xuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogTG9hZHMgYSBwZXJzaXN0ZWQgc3luYyBjdXJzb3IgZnJvbSBhIG1vZGVsIHJvdyB3aXRoIGEgdmFsdWUgY29sdW1uLlxuICAgKiBAcGFyYW0ge3tjdXJzb3JLZXk6IHN0cmluZywgY3Vyc29yTW9kZWw6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fX0gYXJncyAtIEN1cnNvciBhcmdzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmcgfCBudWxsPn0gUGVyc2lzdGVkIGN1cnNvciBwYXlsb2FkLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGxvYWRTeW5jQ3Vyc29yKHtjdXJzb3JLZXksIGN1cnNvck1vZGVsfSkge1xuICAgIGNvbnN0IG9wdGlvbiA9IGF3YWl0IGN1cnNvck1vZGVsLmZpbmRCeSh7a2V5OiBjdXJzb3JLZXl9KVxuXG4gICAgcmV0dXJuIG9wdGlvbiA/IG9wdGlvbi52YWx1ZSgpIDogbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFNhdmVzIGEgcGVyc2lzdGVkIHN5bmMgY3Vyc29yIHRvIGEgbW9kZWwgcm93IHdpdGggYSB2YWx1ZSBjb2x1bW4uXG4gICAqIEBwYXJhbSB7e2N1cnNvcjogU3luY0N1cnNvciwgY3Vyc29yS2V5OiBzdHJpbmcsIGN1cnNvck1vZGVsOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn19IGFyZ3MgLSBDdXJzb3IgYXJncy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBzdGF0aWMgYXN5bmMgc2F2ZVN5bmNDdXJzb3Ioe2N1cnNvciwgY3Vyc29yS2V5LCBjdXJzb3JNb2RlbH0pIHtcbiAgICBpZiAoIWN1cnNvcikgcmV0dXJuXG5cbiAgICBjb25zdCBvcHRpb24gPSBhd2FpdCBjdXJzb3JNb2RlbC5maW5kT3JJbml0aWFsaXplQnkoe2tleTogY3Vyc29yS2V5fSlcblxuICAgIG9wdGlvbi5hc3NpZ24oe3ZhbHVlOiBKU09OLnN0cmluZ2lmeShjdXJzb3IpfSlcbiAgICBpZiAob3B0aW9uLmlzQ2hhbmdlZCgpKSBhd2FpdCBvcHRpb24uc2F2ZSgpXG4gIH1cblxuICAvKipcbiAgICogUHVsbHMgYmFja2VuZCBzeW5jIGNoYW5nZXMgaW4gc3RhYmxlIHBhZ2VzLCBhcHBsaWVzIHRoZW0gbG9jYWxseSwgYW5kIHN0b3Jlc1xuICAgKiB0aGUgYWNrbm93bGVkZ2VkIGN1cnNvci4gQXBwcyBwcm92aWRlIG9ubHkgYXV0aCwgcGVyc2lzdGVuY2UsIHRyYW5zcG9ydCwgYW5kXG4gICAqIHJlc291cmNlIHBvbGljeSBob29rcy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBQdWxsIGFyZ3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmF1dGhlbnRpY2F0aW9uVG9rZW4gLSBBdXRoIHRva2VuIHRvIHNlbmQgd2l0aCBjaGFuZ2UgcmVxdWVzdHMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5iYXRjaFNpemVdIC0gTWF4IHN5bmNzIHBlciByZXF1ZXN0LiBEZWZhdWx0cyB0byAxMDAuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxTeW5jQ3Vyc29yIHwgc3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZD59IGFyZ3MubG9hZEN1cnNvciAtIExvYWRzIHRoZSBwZXJzaXN0ZWQgbG9jYWwgY3Vyc29yLlxuICAgKiBAcGFyYW0geyhjdXJzb3I6IFN5bmNDdXJzb3IpID0+IFByb21pc2U8dm9pZD59IGFyZ3Muc2F2ZUN1cnNvciAtIFBlcnNpc3RzIHRoZSBmaW5hbCBhY2tub3dsZWRnZWQgY3Vyc29yLlxuICAgKiBAcGFyYW0geyhwYXlsb2FkOiBTeW5jQ2hhbmdlc1JlcXVlc3QpID0+IFByb21pc2U8U3luY0NoYW5nZXNSZXNwb25zZT59IGFyZ3MucG9zdENoYW5nZXMgLSBQb3N0cyBvbmUgY2hhbmdlcyByZXF1ZXN0LlxuICAgKiBAcGFyYW0geyhzeW5jOiBTeW5jQ2hhbmdlRW52ZWxvcGUpID0+IFByb21pc2U8U3luY0NoYW5nZUFwcGx5UmVzdWx0Pn0gYXJncy5hcHBseVN5bmMgLSBBcHBsaWVzIG9uZSBub3JtYWxpemVkIHN5bmMgcm93IGxvY2FsbHkuXG4gICAqIEBwYXJhbSB7KHByb2dyZXNzOiBpbXBvcnQoXCIuL3N5bmMtYXBpLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jUHVsbFByb2dyZXNzKSA9PiB2b2lkfSBbYXJncy5vblByb2dyZXNzXSAtIFByb2dyZXNzIGNhbGxiYWNrIGludm9rZWQgcGVyIGFwcGxpZWQgcGFnZSAoYW5kIG9uY2UgZm9yIGFuIGVtcHR5IHB1bGwpIHdpdGggdGhlIGFwcGxpZWQgY291bnRzIGFuZCB0aGUgc3RhYmxlIHNlcnZlciB0b3RhbC5cbiAgICogQHJldHVybnMge1Byb21pc2U8U3luY0NoYW5nZXNSZXN1bHQ+fSBQdWxsIHJlc3VsdC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBwdWxsQ2hhbmdlcyhhcmdzKSB7XG4gICAgbGV0IGFmdGVyQ3Vyc29yID0gdGhpcy5zeW5jQ3Vyc29yRnJvbVBheWxvYWQoYXdhaXQgYXJncy5sb2FkQ3Vyc29yKCkpXG4gICAgbGV0IHVwVG9DdXJzb3IgPSBudWxsXG4gICAgbGV0IHBhZ2VzID0gMFxuICAgIGxldCBzeW5jZWRDb3VudCA9IDBcbiAgICBsZXQgdG90YWwgPSAwXG4gICAgbGV0IGNoYW5nZWQgPSBmYWxzZVxuICAgIGNvbnN0IHJlc291cmNlQ291bnRzID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBudW1iZXI+fSAqLyAoe30pXG4gICAgY29uc3QgcmVzb3VyY2VDaGFuZ2VkID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBib29sZWFuPn0gKi8gKHt9KVxuICAgIGNvbnN0IGJhdGNoU2l6ZSA9IHRoaXMubm9ybWFsaXplZEJhdGNoU2l6ZShhcmdzLmJhdGNoU2l6ZSlcblxuICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICBjb25zdCBjaGFuZ2VzUmVzcG9uc2UgPSBhd2FpdCB0aGlzLmNoYW5nZXNQYWdlKHsuLi5hcmdzLCBhZnRlckN1cnNvciwgYmF0Y2hTaXplLCB1cFRvQ3Vyc29yfSlcbiAgICAgIGNvbnN0IHN5bmNzID0gY2hhbmdlc1Jlc3BvbnNlLnN5bmNzXG5cbiAgICAgIGlmICghdXBUb0N1cnNvcikgdXBUb0N1cnNvciA9IGNoYW5nZXNSZXNwb25zZS51cFRvQ3Vyc29yXG5cbiAgICAgIC8vIFRoZSBzZXJ2ZXIgY291bnRzIHBlbmRpbmcgcm93cyBmcm9tIHRoaXMgcmVxdWVzdCdzIGN1cnNvciwgc28gYWxyZWFkeS1hcHBsaWVkXG4gICAgICAvLyBwYWdlcyBwbHVzIHRoaXMgcmVxdWVzdCdzIGNvdW50IHN0YXlzIHRoZSBzYW1lIHRvdGFsIGFjcm9zcyBldmVyeSBwYWdlOiBhIHN0YWJsZVxuICAgICAgLy8gXCJvZiBZXCIgZGVub21pbmF0b3IgZXZlbiBhcyB0aGUgY3Vyc29yIGFkdmFuY2VzLiBBIHNlcnZlciB0aGF0IGRvZXNuJ3QgcmVwb3J0IHRoZVxuICAgICAgLy8gY291bnQgYXQgYWxsIGxlYXZlcyB0aGUgdG90YWwgYXQgMCBmb3IgZXZlcnkgcGFnZSByYXRoZXIgdGhhbiBkcmlmdGluZyB1cHdhcmRzXG4gICAgICAvLyB3aXRoIHRoZSBhcHBsaWVkIHJvd3MuXG4gICAgICBpZiAoY2hhbmdlc1Jlc3BvbnNlLnRvdGFsICE9PSBudWxsKSB0b3RhbCA9IHN5bmNlZENvdW50ICsgY2hhbmdlc1Jlc3BvbnNlLnRvdGFsXG5cbiAgICAgIGlmIChzeW5jcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgLy8gUmVwb3J0IHRoZSB0ZXJtaW5hbCBwcm9ncmVzcyBvbmNlIGZvciBhbiBlbnRpcmVseSBlbXB0eSBwdWxsIHNvIGNvbnN1bWVycyBvYnNlcnZlXG4gICAgICAgIC8vIHRvdGFsIDA7IGEgcHVsbCB0aGF0IGFscmVhZHkgYXBwbGllZCBwYWdlcyByZXBvcnRlZCBpdHMgZmluYWwgY291bnRzIG9uIGl0cyBsYXN0IHBhZ2UuXG4gICAgICAgIGlmIChwYWdlcyA9PT0gMCAmJiBhcmdzLm9uUHJvZ3Jlc3MpIGFyZ3Mub25Qcm9ncmVzcyh7cGFnZXMsIHN5bmNlZENvdW50LCB0b3RhbH0pXG5cbiAgICAgICAgYnJlYWtcbiAgICAgIH1cblxuICAgICAgcGFnZXMgKz0gMVxuXG4gICAgICAvLyBDb2FsZXNjZSByZWNvcmQtY2hhbmdlIGV2ZW50cyBhY3Jvc3MgdGhpcyBwYWdlJ3MgYXBwbGllcyBzbyBOIGFwcGxpZWQgcm93cyB0cmlnZ2VyIG9uZVxuICAgICAgLy8gbGl2ZS1xdWVyeSByZS1ydW4uIE9ubHkgdGhlIGFwcGx5IGxvb3AgaXMgYmF0Y2hlZDogdGhlIG5ldHdvcmsgcGFnZSBmZXRjaCBhYm92ZSBhbmQgdGhlXG4gICAgICAvLyBjdXJzb3Igc2F2ZSBiZWxvdyBzdGF5IG91dHNpZGUsIHNvIGxpdmUgcXVlcmllcyBmbHVzaCByaWdodCBhZnRlciB0aGUgYXBwbGllcyBpbnN0ZWFkIG9mXG4gICAgICAvLyB3YWl0aW5nIGZvciB0aGUgcmVzdCBvZiB0aGUgcHVsbC5cbiAgICAgIGF3YWl0IHJlY29yZENoYW5nZXMuYmF0Y2goYXN5bmMgKCkgPT4ge1xuICAgICAgICBmb3IgKGNvbnN0IHN5bmMgb2Ygc3luY3MpIHtcbiAgICAgICAgICBjb25zdCBhcHBseVJlc3VsdCA9IGF3YWl0IGFyZ3MuYXBwbHlTeW5jKHN5bmMpXG4gICAgICAgICAgY29uc3QgcmVzb3VyY2VUeXBlID0gYXBwbHlSZXN1bHQucmVzb3VyY2VUeXBlID8/IHN5bmMucmVzb3VyY2VUeXBlKClcblxuICAgICAgICAgIGNoYW5nZWQgfHw9IGFwcGx5UmVzdWx0LmNoYW5nZWQgPT09IHRydWVcbiAgICAgICAgICBzeW5jZWRDb3VudCArPSAxXG5cbiAgICAgICAgICBpZiAocmVzb3VyY2VUeXBlKSB7XG4gICAgICAgICAgICByZXNvdXJjZUNvdW50c1tyZXNvdXJjZVR5cGVdID0gKHJlc291cmNlQ291bnRzW3Jlc291cmNlVHlwZV0gfHwgMCkgKyAxXG4gICAgICAgICAgICByZXNvdXJjZUNoYW5nZWRbcmVzb3VyY2VUeXBlXSB8fD0gYXBwbHlSZXN1bHQuY2hhbmdlZCA9PT0gdHJ1ZVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSlcblxuICAgICAgYWZ0ZXJDdXJzb3IgPSBjaGFuZ2VzUmVzcG9uc2UubmV4dEN1cnNvclxuXG4gICAgICBpZiAoYXJncy5vblByb2dyZXNzKSBhcmdzLm9uUHJvZ3Jlc3Moe3BhZ2VzLCBzeW5jZWRDb3VudCwgdG90YWx9KVxuICAgICAgaWYgKHN5bmNzLmxlbmd0aCA8IGJhdGNoU2l6ZSkgYnJlYWtcbiAgICB9XG5cbiAgICBpZiAoYWZ0ZXJDdXJzb3IpIGF3YWl0IGFyZ3Muc2F2ZUN1cnNvcihhZnRlckN1cnNvcilcblxuICAgIHJldHVybiB7Y2hhbmdlZCwgcGFnZXMsIHJlc291cmNlQ2hhbmdlZCwgcmVzb3VyY2VDb3VudHMsIHN5bmNlZENvdW50LCB0b3RhbH1cbiAgfVxuXG4gIC8qKlxuICAgKiBGZXRjaGVzIGFuZCB2YWxpZGF0ZXMgb25lIGJhY2tlbmQgc3luYyBjaGFuZ2VzIHBhZ2UuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gUGFnZSBhcmdzLlxuICAgKiBAcGFyYW0ge1N5bmNDdXJzb3J9IGFyZ3MuYWZ0ZXJDdXJzb3IgLSBMYXN0IGFja25vd2xlZGdlZCBjdXJzb3IuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmF1dGhlbnRpY2F0aW9uVG9rZW4gLSBBdXRoIHRva2VuLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5iYXRjaFNpemUgLSBQYWdlIHNpemUuXG4gICAqIEBwYXJhbSB7KHBheWxvYWQ6IFN5bmNDaGFuZ2VzUmVxdWVzdCkgPT4gUHJvbWlzZTxTeW5jQ2hhbmdlc1Jlc3BvbnNlPn0gYXJncy5wb3N0Q2hhbmdlcyAtIENoYW5nZXMgcG9zdGVyLlxuICAgKiBAcGFyYW0ge1N5bmNDdXJzb3J9IGFyZ3MudXBUb0N1cnNvciAtIFNuYXBzaG90IHVwcGVyLWJvdW5kIGN1cnNvci5cbiAgICogQHJldHVybnMge1Byb21pc2U8e25leHRDdXJzb3I6IFN5bmNDdXJzb3IsIHN5bmNzOiBTeW5jQ2hhbmdlRW52ZWxvcGVbXSwgdG90YWw6IG51bWJlciB8IG51bGwsIHVwVG9DdXJzb3I6IFN5bmNDdXJzb3J9Pn0gTm9ybWFsaXplZCBjaGFuZ2VzIHBhZ2UuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgY2hhbmdlc1BhZ2Uoe2FmdGVyQ3Vyc29yLCBhdXRoZW50aWNhdGlvblRva2VuLCBiYXRjaFNpemUsIHBvc3RDaGFuZ2VzLCB1cFRvQ3Vyc29yfSkge1xuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgcG9zdENoYW5nZXMoe1xuICAgICAgYXV0aGVudGljYXRpb25Ub2tlbixcbiAgICAgIGxpbWl0OiBiYXRjaFNpemUsXG4gICAgICAuLi50aGlzLmN1cnNvclBheWxvYWQoXCJhZnRlclwiLCBhZnRlckN1cnNvciksXG4gICAgICAuLi50aGlzLmN1cnNvclBheWxvYWQoXCJ1cFRvXCIsIHVwVG9DdXJzb3IpXG4gICAgfSlcblxuICAgIHRoaXMuZW5zdXJlU3VjY2Vzc2Z1bENoYW5nZXNSZXNwb25zZShyZXNwb25zZSlcblxuICAgIGNvbnN0IHN5bmNzID0gLyoqIEB0eXBlIHt1bmtub3duW119ICovIChyZXNwb25zZS5zeW5jcylcblxuICAgIHJldHVybiB7XG4gICAgICBuZXh0Q3Vyc29yOiB0aGlzLnN5bmNDdXJzb3JGcm9tUGF5bG9hZChyZXNwb25zZS5uZXh0Q3Vyc29yID8/IG51bGwpLFxuICAgICAgc3luY3M6IHN5bmNzLm1hcCgoc3luY1BheWxvYWQpID0+IHRoaXMuc3luY0VudmVsb3BlRnJvbVBheWxvYWQoc3luY1BheWxvYWQpKSxcbiAgICAgIHRvdGFsOiBvcHRpb25hbEludGVnZXIocmVzcG9uc2UudG90YWwpLFxuICAgICAgdXBUb0N1cnNvcjogdGhpcy5zeW5jQ3Vyc29yRnJvbVBheWxvYWQocmVzcG9uc2UudXBUb0N1cnNvciA/PyBudWxsKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVja3MgQVBJIHJlc3BvbnNlIHN0YXR1cyBhbmQgc2hhcGUgZm9yIGNoYW5nZS1mZWVkIHB1bGxzLlxuICAgKiBAcGFyYW0ge1N5bmNDaGFuZ2VzUmVzcG9uc2V9IHJlc3BvbnNlIC0gQ2hhbmdlcyByZXNwb25zZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGF0aWMgZW5zdXJlU3VjY2Vzc2Z1bENoYW5nZXNSZXNwb25zZShyZXNwb25zZSkge1xuICAgIGlmIChyZXNwb25zZS5zdGF0dXMgPT09IFwiZXJyb3JcIikgdGhyb3cgbmV3IEVycm9yKHJlc3BvbnNlLmVycm9yTWVzc2FnZSB8fCBcIlN5bmMgY2hhbmdlcyBmYWlsZWRcIilcbiAgICBpZiAoIUFycmF5LmlzQXJyYXkocmVzcG9uc2Uuc3luY3MpKSB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jIGNoYW5nZXMgcmVzcG9uc2UgbWlzc2luZyBzeW5jc1wiKVxuICB9XG5cbiAgLyoqXG4gICAqIENvbnZlcnRzIGEgY3Vyc29yIGludG8gcmVxdWVzdCBwYXJhbXMgd2l0aCB0aGUgZ2l2ZW4gcHJlZml4LlxuICAgKiBAcGFyYW0ge1wiYWZ0ZXJcIiB8IFwidXBUb1wifSBwcmVmaXggLSBSZXF1ZXN0IGZpZWxkIHByZWZpeC5cbiAgICogQHBhcmFtIHtTeW5jQ3Vyc29yfSBjdXJzb3IgLSBDdXJzb3IgdG8gc2VyaWFsaXplLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgc3RyaW5nIHwgbnVtYmVyIHwgbnVsbD59IFJlcXVlc3QgcGFyYW1zLlxuICAgKi9cbiAgc3RhdGljIGN1cnNvclBheWxvYWQocHJlZml4LCBjdXJzb3IpIHtcbiAgICBpZiAoIWN1cnNvcikgcmV0dXJuIHt9XG5cbiAgICByZXR1cm4ge1xuICAgICAgW2Ake3ByZWZpeH1JZGBdOiBjdXJzb3IuaWQsXG4gICAgICAuLi4oY3Vyc29yLnNlcnZlclNlcXVlbmNlID8ge1tgJHtwcmVmaXh9U2VydmVyU2VxdWVuY2VgXTogY3Vyc29yLnNlcnZlclNlcXVlbmNlfSA6IHt9KSxcbiAgICAgIFtgJHtwcmVmaXh9VXBkYXRlZEF0YF06IGN1cnNvci51cGRhdGVkQXRcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUGFyc2VzIGEgcGVyc2lzdGVkIG9yIHJlc3BvbnNlIGN1cnNvciBwYXlsb2FkLlxuICAgKiBAcGFyYW0ge1N5bmNDdXJzb3IgfCBzdHJpbmcgfCBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBudWxsIHwgdW5kZWZpbmVkfSBwYXlsb2FkIC0gQ3Vyc29yIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtTeW5jQ3Vyc29yfSBQYXJzZWQgY3Vyc29yLlxuICAgKi9cbiAgc3RhdGljIHN5bmNDdXJzb3JGcm9tUGF5bG9hZChwYXlsb2FkKSB7XG4gICAgaWYgKCFwYXlsb2FkKSByZXR1cm4gbnVsbFxuXG4gICAgaWYgKHR5cGVvZiBwYXlsb2FkID09PSBcInN0cmluZ1wiKSB7XG4gICAgICB0cnkge1xuICAgICAgICByZXR1cm4gdGhpcy5zeW5jQ3Vyc29yRnJvbVBheWxvYWQoSlNPTi5wYXJzZShwYXlsb2FkKSlcbiAgICAgIH0gY2F0Y2ggKF9lcnJvcikge1xuICAgICAgICByZXR1cm4ge2lkOiBudWxsLCBzZXJ2ZXJTZXF1ZW5jZTogbnVsbCwgdXBkYXRlZEF0OiBwYXlsb2FkfVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmICh0eXBlb2YgcGF5bG9hZCAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHBheWxvYWQpKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgdXBkYXRlZEF0ID0gdHlwZW9mIHBheWxvYWQudXBkYXRlZEF0ID09PSBcInN0cmluZ1wiID8gcGF5bG9hZC51cGRhdGVkQXQgOiBudWxsXG5cbiAgICBpZiAoIXVwZGF0ZWRBdCkgcmV0dXJuIG51bGxcblxuICAgIHJldHVybiB7XG4gICAgICBpZDogcGF5bG9hZC5pZCA9PT0gbnVsbCB8fCBwYXlsb2FkLmlkID09PSB1bmRlZmluZWQgPyBudWxsIDogU3RyaW5nKHBheWxvYWQuaWQpLFxuICAgICAgc2VydmVyU2VxdWVuY2U6IG9wdGlvbmFsSW50ZWdlcihwYXlsb2FkLnNlcnZlclNlcXVlbmNlID09PSBcIlwiID8gbnVsbCA6IHBheWxvYWQuc2VydmVyU2VxdWVuY2UpLFxuICAgICAgdXBkYXRlZEF0XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBhIG5vcm1hbGl6ZWQgc3luYyByb3cgYWRhcHRlci5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gcGF5bG9hZCAtIFJhdyBzeW5jIHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtTeW5jQ2hhbmdlRW52ZWxvcGV9IFN5bmMgcm93IGFkYXB0ZXIuXG4gICAqL1xuICBzdGF0aWMgc3luY0VudmVsb3BlRnJvbVBheWxvYWQocGF5bG9hZCkge1xuICAgIGlmICghcGF5bG9hZCB8fCB0eXBlb2YgcGF5bG9hZCAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHBheWxvYWQpKSB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jIGNoYW5nZXMgZW50cnkgbXVzdCBiZSBhbiBvYmplY3RcIilcblxuICAgIGNvbnN0IHN5bmNQYXlsb2FkID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIChwYXlsb2FkKVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGRhdGE6ICgpID0+IHN5bmNQYXlsb2FkLmRhdGEsXG4gICAgICBpZDogKCkgPT4gc3luY1BheWxvYWQuaWQsXG4gICAgICByZXNvdXJjZUlkOiAoKSA9PiBzeW5jUGF5bG9hZC5yZXNvdXJjZUlkLFxuICAgICAgcmVzb3VyY2VUeXBlOiAoKSA9PiBzeW5jUGF5bG9hZC5yZXNvdXJjZVR5cGUgPT09IG51bGwgfHwgc3luY1BheWxvYWQucmVzb3VyY2VUeXBlID09PSB1bmRlZmluZWQgPyBudWxsIDogU3RyaW5nKHN5bmNQYXlsb2FkLnJlc291cmNlVHlwZSksXG4gICAgICBzeW5jVHlwZTogKCkgPT4gc3luY1BheWxvYWQuc3luY1R5cGUgPT09IG51bGwgfHwgc3luY1BheWxvYWQuc3luY1R5cGUgPT09IHVuZGVmaW5lZCA/IFwiXCIgOiBTdHJpbmcoc3luY1BheWxvYWQuc3luY1R5cGUpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBhbiBhcHAtY29uZmlndXJlZCByZXNvdXJjZSBhcHBsaWVyIGZvciBwdWxsZWQgc3luYyByb3dzLiBUaGUgc3luY1xuICAgKiBtZWNoYW5pY3Mgc3RheSBoZXJlOyBhcHBzIG9ubHkgZGVjbGFyZSB3aGljaCBtb2RlbHMvYXR0cmlidXRlcy9ob29rcyBhcmVcbiAgICogYWxsb3dlZCBmb3IgZWFjaCByZXNvdXJjZSB0eXBlLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFN5bmNSZXNvdXJjZUNvbmZpZz59IHJlc291cmNlcyAtIFJlc291cmNlIHBvbGljeSBtYXAuXG4gICAqIEBwYXJhbSB7KHJlY29yZDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4pID0+ICgpID0+IHZvaWR9IFtvblJlY29yZF0gLSBDYWxsZWQgd2l0aCBlYWNoIHJlY29yZCBhYm91dCB0byBiZSB3cml0dGVuOyByZXR1cm5zIGEgcmVsZWFzZSBjYWxsYmFjayBpbnZva2VkIGFmdGVyIHRoZSB3cml0ZSAodXNlZCBmb3IgZWNobyBzdXBwcmVzc2lvbikuXG4gICAqIEByZXR1cm5zIHsoc3luYzogU3luY0NoYW5nZUVudmVsb3BlKSA9PiBQcm9taXNlPFN5bmNDaGFuZ2VBcHBseVJlc3VsdD59IFN5bmMgYXBwbHkgY2FsbGJhY2suXG4gICAqL1xuICBzdGF0aWMgcmVzb3VyY2VBcHBsaWVyKHJlc291cmNlcywgb25SZWNvcmQpIHtcbiAgICByZXR1cm4gYXN5bmMgKHN5bmMpID0+IGF3YWl0IHRoaXMuYXBwbHlSZXNvdXJjZVN5bmMoe29uUmVjb3JkLCByZXNvdXJjZXMsIHN5bmN9KVxuICB9XG5cbiAgLyoqXG4gICAqIEFwcGxpZXMgb25lIHN5bmMgcm93IHVzaW5nIGRlY2xhcmF0aXZlIHJlc291cmNlIHBvbGljeS5cbiAgICogQHBhcmFtIHt7cmVzb3VyY2VzOiBSZWNvcmQ8c3RyaW5nLCBTeW5jUmVzb3VyY2VDb25maWc+LCBzeW5jOiBTeW5jQ2hhbmdlRW52ZWxvcGUsIG9uUmVjb3JkPzogKHJlY29yZDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4pID0+ICgpID0+IHZvaWR9fSBhcmdzIC0gQXBwbHkgYXJncy5cbiAgICogQHJldHVybnMge1Byb21pc2U8U3luY0NoYW5nZUFwcGx5UmVzdWx0Pn0gQXBwbHkgcmVzdWx0LlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGFwcGx5UmVzb3VyY2VTeW5jKHtvblJlY29yZCwgcmVzb3VyY2VzLCBzeW5jfSkge1xuICAgIGNvbnN0IHJlc291cmNlVHlwZSA9IHN5bmMucmVzb3VyY2VUeXBlKClcbiAgICBjb25zdCByZXNvdXJjZSA9IHJlc291cmNlVHlwZSA/IHJlc291cmNlc1tyZXNvdXJjZVR5cGVdIDogdW5kZWZpbmVkXG5cbiAgICBpZiAoIXJlc291cmNlIHx8ICFyZXNvdXJjZS5lbmFibGVkKSByZXR1cm4ge2NoYW5nZWQ6IGZhbHNlLCByZXNvdXJjZVR5cGV9XG5cbiAgICBpZiAoc3luYy5zeW5jVHlwZSgpID09PSBcImRlbGV0ZVwiKSB7XG4gICAgICByZXR1cm4ge2NoYW5nZWQ6IGF3YWl0IHRoaXMuZGVzdHJveVN5bmNlZFJlc291cmNlKHtvblJlY29yZCwgcmVzb3VyY2UsIHN5bmN9KSwgcmVzb3VyY2VUeXBlfVxuICAgIH1cblxuICAgIGNvbnN0IGRhdGEgPSB0aGlzLnN5bmNEYXRhKHN5bmMpXG4gICAgY29uc3QgcmVjb3JkID0gcmVzb3VyY2UuZmluZFJlY29yZCA/IGF3YWl0IHJlc291cmNlLmZpbmRSZWNvcmQoe2RhdGEsIHJlc291cmNlSWQ6IHN5bmMucmVzb3VyY2VJZCgpLCBzeW5jfSkgOiBhd2FpdCByZXNvdXJjZS5tb2RlbENsYXNzLmZpbmRPckluaXRpYWxpemVCeSh7aWQ6IGRhdGEuaWQgPz8gc3luYy5yZXNvdXJjZUlkKCl9KVxuICAgIGNvbnN0IGF0dHJpYnV0ZXMgPSBhd2FpdCByZXNvdXJjZS5hdHRyaWJ1dGVzKHtkYXRhLCByZWNvcmQsIHN5bmN9KVxuICAgIGNvbnN0IHJlbGVhc2VSZWNvcmQgPSBvblJlY29yZCA/IG9uUmVjb3JkKHJlY29yZCkgOiBudWxsXG4gICAgbGV0IGNoYW5nZWQgPSBmYWxzZVxuXG4gICAgdHJ5IHtcbiAgICAgIHJlY29yZC5hc3NpZ24oYXR0cmlidXRlcylcblxuICAgICAgaWYgKHJlY29yZC5pc0NoYW5nZWQoKSkge1xuICAgICAgICBhd2FpdCByZWNvcmQuc2F2ZSgpXG4gICAgICAgIGNoYW5nZWQgPSB0cnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChyZXNvdXJjZS5hZnRlckFwcGx5KSB7XG4gICAgICAgIGNvbnN0IGhvb2tDaGFuZ2VkID0gYXdhaXQgcmVzb3VyY2UuYWZ0ZXJBcHBseSh7YXR0cmlidXRlcywgZGF0YSwgcmVjb3JkLCBzeW5jfSlcblxuICAgICAgICBjaGFuZ2VkIHx8PSBob29rQ2hhbmdlZCA9PT0gdHJ1ZVxuICAgICAgfVxuICAgIH0gZmluYWxseSB7XG4gICAgICBpZiAocmVsZWFzZVJlY29yZCkgcmVsZWFzZVJlY29yZCgpXG4gICAgfVxuXG4gICAgcmV0dXJuIHtjaGFuZ2VkLCByZXNvdXJjZVR5cGV9XG4gIH1cblxuICAvKipcbiAgICogRGVzdHJveXMgYSBzeW5jZWQgcmVzb3VyY2UgdmlhIGl0cyBkZWNsYXJlZCBtb2RlbCBwb2xpY3kuXG4gICAqIEBwYXJhbSB7e3Jlc291cmNlOiBTeW5jUmVzb3VyY2VDb25maWcsIHN5bmM6IFN5bmNDaGFuZ2VFbnZlbG9wZSwgb25SZWNvcmQ/OiAocmVjb3JkOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPikgPT4gKCkgPT4gdm9pZH19IGFyZ3MgLSBEZXN0cm95IGFyZ3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSBXaGV0aGVyIGEgbG9jYWwgcm93IHdhcyBkZXN0cm95ZWQuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgZGVzdHJveVN5bmNlZFJlc291cmNlKHtvblJlY29yZCwgcmVzb3VyY2UsIHN5bmN9KSB7XG4gICAgY29uc3QgaWQgPSBzeW5jLnJlc291cmNlSWQoKVxuICAgIGNvbnN0IHJlY29yZCA9IHJlc291cmNlLmZpbmRSZWNvcmRGb3JEZWxldGUgPyBhd2FpdCByZXNvdXJjZS5maW5kUmVjb3JkRm9yRGVsZXRlKHtyZXNvdXJjZUlkOiBpZCwgc3luY30pIDogYXdhaXQgcmVzb3VyY2UubW9kZWxDbGFzcy5maW5kQnkoe2lkfSlcblxuICAgIGlmICghcmVjb3JkKSByZXR1cm4gZmFsc2VcblxuICAgIGNvbnN0IHJlbGVhc2VSZWNvcmQgPSBvblJlY29yZCA/IG9uUmVjb3JkKHJlY29yZCkgOiBudWxsXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgcmVjb3JkLmRlc3Ryb3koKVxuICAgIH0gZmluYWxseSB7XG4gICAgICBpZiAocmVsZWFzZVJlY29yZCkgcmVsZWFzZVJlY29yZCgpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBQYXJzZXMgdGhlIGVtYmVkZGVkIHN5bmMgZGF0YSBKU09OL29iamVjdC5cbiAgICogQHBhcmFtIHtTeW5jQ2hhbmdlRW52ZWxvcGV9IHN5bmMgLSBTeW5jIHJvdy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSBTeW5jIGRhdGEgb2JqZWN0LlxuICAgKi9cbiAgc3RhdGljIHN5bmNEYXRhKHN5bmMpIHtcbiAgICBjb25zdCBkYXRhID0gc3luYy5kYXRhKClcblxuICAgIGlmICghZGF0YSkgdGhyb3cgbmV3IEVycm9yKGBTeW5jICR7c3luYy5pZCgpfSBpcyBtaXNzaW5nIGRhdGFgKVxuICAgIGlmICh0eXBlb2YgZGF0YSA9PT0gXCJzdHJpbmdcIikgcmV0dXJuIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59ICovIChKU09OLnBhcnNlKGRhdGEpKVxuICAgIGlmICh0eXBlb2YgZGF0YSA9PT0gXCJvYmplY3RcIiAmJiAhQXJyYXkuaXNBcnJheShkYXRhKSkgcmV0dXJuIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59ICovIChkYXRhKVxuXG4gICAgdGhyb3cgbmV3IEVycm9yKGBTeW5jICR7c3luYy5pZCgpfSBoYXMgaW52YWxpZCBkYXRhYClcbiAgfVxuXG4gIC8qKlxuICAgKiBEcmFpbnMgcGVuZGluZyBzeW5jIHJlY29yZHMgZnJvbSBhIGxvY2FsIFZlbG9jaW91cyBtb2RlbCBpbiBzdGFibGUgb3JkZXIuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gUmVwbGF5IGFyZ3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmF1dGhlbnRpY2F0aW9uVG9rZW4gLSBBdXRoIHRva2VuIHRvIHNlbmQgd2l0aCByZXBsYXkgcmVxdWVzdHMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5iYXRjaFNpemVdIC0gTWF4IHN5bmNzIHBlciByZXF1ZXN0LlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLnN5bmNNb2RlbCAtIExvY2FsIFN5bmMgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7KHBheWxvYWQ6IHthdXRoZW50aWNhdGlvblRva2VuOiBzdHJpbmcsIHN5bmNzOiBBcnJheTxSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSkgPT4gUHJvbWlzZTxTeW5jUmVwbGF5UmVzcG9uc2U+fSBhcmdzLnBvc3RSZXBsYXkgLSBSZXBsYXkgcG9zdGVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIHN0YXRpYyBhc3luYyByZXBsYXlMb2NhbFN5bmNzKGFyZ3MpIHtcbiAgICBjb25zdCBwb3N0ZWRTbmFwc2hvdHNCeVN5bmNJZCA9IG5ldyBNYXAoKVxuXG4gICAgYXdhaXQgdGhpcy5yZXBsYXlQZW5kaW5nKHtcbiAgICAgIGF1dGhlbnRpY2F0aW9uVG9rZW46IGFyZ3MuYXV0aGVudGljYXRpb25Ub2tlbixcbiAgICAgIGJhdGNoU2l6ZTogYXJncy5iYXRjaFNpemUsXG4gICAgICBtYXJrU3VjY2Vzc2Z1bDogYXN5bmMgKHN5bmMpID0+IHtcbiAgICAgICAgY29uc3Qgc3luY0lkID0gKC8qKiBAdHlwZSB7e2lkOiAoKSA9PiBzdHJpbmcgfCBudW1iZXIgfCBudWxsIHwgdW5kZWZpbmVkfX0gKi8gKHN5bmMpKS5pZCgpXG4gICAgICAgIC8vIFJlbG9hZCB3aXRoIHRoZSByZXNvdXJjZSBwcmVsb2FkZWQgc28gcm93cyByZWx5aW5nIG9uIHRoZSByZXNvdXJjZS1hdHRyaWJ1dGVzXG4gICAgICAgIC8vIGZhbGxiYWNrIGluIGxvY2FsU3luY0RhdGEgY29tcGFyZSBhZ2FpbnN0IHRoZSBzYW1lIHNuYXBzaG90IHRoZXkgcG9zdGVkLlxuICAgICAgICBjb25zdCBjdXJyZW50U3luYyA9IGF3YWl0IGFyZ3Muc3luY01vZGVsLnByZWxvYWQoe3Jlc291cmNlOiB0cnVlfSkud2hlcmUoe2lkOiBzeW5jSWR9KS5maXJzdCgpXG5cbiAgICAgICAgaWYgKCFjdXJyZW50U3luYykgcmV0dXJuXG4gICAgICAgIC8vIEEgcm93IGVkaXRlZCB3aGlsZSBpdHMgb2xkIHBheWxvYWQgd2FzIGluIGZsaWdodCBzdGF5cyBwZW5kaW5nLCBzbyB0aGVcbiAgICAgICAgLy8gbmV3ZXIgbG9jYWwgY2hhbmdlIHJlcGxheXMgb24gdGhlIG5leHQgZHJhaW4gaW5zdGVhZCBvZiBiZWluZyBsb3N0LlxuICAgICAgICBpZiAodGhpcy5sb2NhbFN5bmNSZXBsYXlTbmFwc2hvdChjdXJyZW50U3luYykgIT09IHBvc3RlZFNuYXBzaG90c0J5U3luY0lkLmdldChTdHJpbmcoc3luY0lkKSkpIHJldHVyblxuXG4gICAgICAgIGF3YWl0IGN1cnJlbnRTeW5jLnVwZGF0ZSh7c3RhdGU6IFwic3VjY2Vzc1wifSlcbiAgICAgIH0sXG4gICAgICBwZW5kaW5nU3luY3M6IGFzeW5jICgpID0+IGF3YWl0IGFyZ3Muc3luY01vZGVsLnByZWxvYWQoe3Jlc291cmNlOiB0cnVlfSkud2hlcmUoe3N0YXRlOiBcInBlbmRpbmdcIn0pLm9yZGVyKFwiY3JlYXRlZF9hdFwiKS50b0FycmF5KCksXG4gICAgICBwb3N0UmVwbGF5OiBhcmdzLnBvc3RSZXBsYXksXG4gICAgICBzeW5jSWQ6IChzeW5jKSA9PiAoLyoqIEB0eXBlIHt7aWQ6ICgpID0+IHN0cmluZyB8IG51bWJlciB8IG51bGwgfCB1bmRlZmluZWR9fSAqLyAoc3luYykpLmlkKCksXG4gICAgICBzeW5jUGF5bG9hZDogKHN5bmMpID0+IHtcbiAgICAgICAgcG9zdGVkU25hcHNob3RzQnlTeW5jSWQuc2V0KFN0cmluZygoLyoqIEB0eXBlIHt7aWQ6ICgpID0+IHN0cmluZyB8IG51bWJlciB8IG51bGwgfCB1bmRlZmluZWR9fSAqLyAoc3luYykpLmlkKCkpLCB0aGlzLmxvY2FsU3luY1JlcGxheVNuYXBzaG90KHN5bmMpKVxuXG4gICAgICAgIHJldHVybiB0aGlzLmxvY2FsU3luY1BheWxvYWQoc3luYylcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFNlcmlhbGl6ZXMgdGhlIHJlcGxheS1yZWxldmFudCBzdGF0ZSBvZiBhIGxvY2FsIHN5bmMgcm93IGZvciBpbi1mbGlnaHQgY29tcGFyaXNvbnMuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHN5bmMgLSBMb2NhbCBzeW5jIHJvdy5cbiAgICogQHJldHVybnMge3N0cmluZ30gU3RhYmxlIHNuYXBzaG90IG9mIHRoZSByb3cncyByZXBsYXllZCBwYXlsb2FkLlxuICAgKi9cbiAgc3RhdGljIGxvY2FsU3luY1JlcGxheVNuYXBzaG90KHN5bmMpIHtcbiAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkoe2RhdGE6IHRoaXMubG9jYWxTeW5jRGF0YShzeW5jKSwgc3luY1R5cGU6IHN5bmMuc3luY1R5cGUoKX0pXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIG9uZSByZXBsYXkgZW52ZWxvcGUgZnJvbSBhIGxvY2FsIHN5bmMgcm93LlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBzeW5jIC0gTG9jYWwgc3luYyByb3cuXG4gICAqIEByZXR1cm5zIHt7Y2xpZW50VXBkYXRlZEF0Pzogc3RyaW5nLCBkYXRhOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiwgaWQ6IG51bWJlciwgcmVzb3VyY2VJZDogc3RyaW5nLCByZXNvdXJjZVR5cGU6IHN0cmluZywgc3luY1R5cGU6IHN0cmluZ319IFN5bmMgcmVwbGF5IGVudmVsb3BlLlxuICAgKi9cbiAgc3RhdGljIGxvY2FsU3luY1BheWxvYWQoc3luYykge1xuICAgIGNvbnN0IGNsaWVudFVwZGF0ZWRBdCA9IHN5bmMudXBkYXRlZEF0KCkgfHwgc3luYy5jcmVhdGVkQXQoKVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGNsaWVudFVwZGF0ZWRBdDogY2xpZW50VXBkYXRlZEF0ID8gY2xpZW50VXBkYXRlZEF0LnRvSVNPU3RyaW5nKCkgOiB1bmRlZmluZWQsXG4gICAgICBkYXRhOiB0aGlzLmxvY2FsU3luY0RhdGEoc3luYyksXG4gICAgICBpZDogLyoqIEB0eXBlIHtudW1iZXJ9ICovICgvKiogQHR5cGUge3Vua25vd259ICovIChzeW5jLmlkKCkpKSxcbiAgICAgIHJlc291cmNlSWQ6IFN0cmluZyhzeW5jLnJlc291cmNlSWQoKSksXG4gICAgICByZXNvdXJjZVR5cGU6IHN5bmMucmVzb3VyY2VUeXBlKCkgfHwgXCJcIixcbiAgICAgIHN5bmNUeXBlOiBzeW5jLnN5bmNUeXBlKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgb25lIGxvY2FsIHN5bmMgcm93IHBheWxvYWQsIGZhbGxpbmcgYmFjayB0byBwcmVsb2FkZWQgcmVzb3VyY2UgYXR0cmlidXRlcy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gc3luYyAtIExvY2FsIHN5bmMgcm93LlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59IFN5bmMgZGF0YS5cbiAgICovXG4gIHN0YXRpYyBsb2NhbFN5bmNEYXRhKHN5bmMpIHtcbiAgICBsZXQgc3luY0RhdGEgPSAvKiogQHR5cGUge3N0cmluZyB8IFJlY29yZDxzdHJpbmcsIHVua25vd24+fSAqLyAoc3luYy5kYXRhKCkgfHwge30pXG5cbiAgICBpZiAodHlwZW9mIHN5bmNEYXRhID09PSBcInN0cmluZ1wiKSB7XG4gICAgICB0cnkge1xuICAgICAgICBzeW5jRGF0YSA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59ICovIChKU09OLnBhcnNlKHN5bmNEYXRhKSlcbiAgICAgIH0gY2F0Y2ggKF9lcnJvcikge1xuICAgICAgICBzeW5jRGF0YSA9IHt9XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKE9iamVjdC5rZXlzKHN5bmNEYXRhKS5sZW5ndGggPiAwKSByZXR1cm4gc3luY0RhdGFcblxuICAgIHRyeSB7XG4gICAgICByZXR1cm4gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn0gKi8gKHN5bmMucmVzb3VyY2UoKS5hdHRyaWJ1dGVzKCkpXG4gICAgfSBjYXRjaCAoX2Vycm9yKSB7XG4gICAgICByZXR1cm4ge31cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUXVldWVzIGEgbG9jYWwgc3luYyByb3cgZm9yIGEgVmVsb2Npb3VzIG1vZGVsIHJlc291cmNlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFF1ZXVlIGFyZ3MuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MucmVzb3VyY2UgLSBSZXNvdXJjZSBiZWluZyBzeW5jZWQuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3Muc3luY01vZGVsIC0gTG9jYWwgU3luYyBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn0gW2FyZ3MuZGF0YV0gLSBFeHBsaWNpdCBzeW5jIGRhdGEuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5zeW5jVHlwZV0gLSBTeW5jIG9wZXJhdGlvbiB0eXBlLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBbYXJncy5sb2NhbE9ubHlBdHRyaWJ1dGVzXSAtIEF0dHJpYnV0ZXMgdG8gc3RyaXAgZnJvbSBxdWV1ZWQgcGF5bG9hZHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IFthcmdzLmJvb2xlYW5BdHRyaWJ1dGVzXSAtIEF0dHJpYnV0ZXMgdG8gY29lcmNlIHRocm91Z2ggc3luYyBib29sZWFuIHBhcnNpbmcuXG4gICAqIEBwYXJhbSB7KGRhdGE6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KSA9PiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn0gW2FyZ3Mubm9ybWFsaXplRGF0YV0gLSBBcHAtc3BlY2lmaWMgZGF0YSBub3JtYWxpemVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IExvY2FsIHN5bmMgcm93LlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHF1ZXVlTG9jYWxTeW5jKGFyZ3MpIHtcbiAgICBjb25zdCByZXNvdXJjZVJlY29yZElkID0gYXJncy5yZXNvdXJjZS5pZCgpXG4gICAgY29uc3QgbW9kZWxDbGFzcyA9IGFyZ3MucmVzb3VyY2UuY29uc3RydWN0b3JcblxuICAgIGlmICh0eXBlb2YgbW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUgIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiVGhlIHJlc291cmNlIG1vZGVsIGNsYXNzIG11c3QgaW1wbGVtZW50IHN0YXRpYyBnZXRNb2RlbE5hbWUoKSB0byBxdWV1ZSBzeW5jIGRhdGEgLSBjbGFzcyBuYW1lcyBhcmUgbm90IHN0YWJsZSBhY3Jvc3MgZXhwbGljaXQgbW9kZWwgbmFtZXMgYW5kIG1pbmlmaWVkIGJ1bmRsZXNcIilcbiAgICB9XG5cbiAgICBjb25zdCByZXNvdXJjZVR5cGUgPSBtb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpXG4gICAgY29uc3Qgc3luY0RhdGEgPSB0aGlzLnF1ZXVlZFN5bmNEYXRhKGFyZ3MpXG4gICAgY29uc3Qgc3luY1R5cGUgPSBhcmdzLnN5bmNUeXBlIHx8IFwidXBkYXRlXCJcblxuICAgIGlmICghcmVzb3VyY2VSZWNvcmRJZCkgdGhyb3cgbmV3IEVycm9yKFwicmVzb3VyY2UuaWQoKSBpcyByZXF1aXJlZCB0byBxdWV1ZSBzeW5jIGRhdGFcIilcblxuICAgIGNvbnN0IHJlc291cmNlSWQgPSBTdHJpbmcocmVzb3VyY2VSZWNvcmRJZClcbiAgICBjb25zdCBleGlzdGluZ1N5bmMgPSBhd2FpdCBhcmdzLnN5bmNNb2RlbC5maW5kQnkoe3Jlc291cmNlSWQsIHJlc291cmNlVHlwZX0pXG5cbiAgICBpZiAoZXhpc3RpbmdTeW5jKSB7XG4gICAgICBhd2FpdCBleGlzdGluZ1N5bmMudXBkYXRlKHtcbiAgICAgICAgZGF0YTogc3luY0RhdGEsXG4gICAgICAgIHN0YXRlOiBcInBlbmRpbmdcIixcbiAgICAgICAgc3luY1R5cGVcbiAgICAgIH0pXG5cbiAgICAgIHJldHVybiBleGlzdGluZ1N5bmNcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgYXJncy5zeW5jTW9kZWwuY3JlYXRlKHtcbiAgICAgIGRhdGE6IHN5bmNEYXRhLFxuICAgICAgcmVzb3VyY2VJZCxcbiAgICAgIHJlc291cmNlVHlwZSxcbiAgICAgIHN0YXRlOiBcInBlbmRpbmdcIixcbiAgICAgIHN5bmNUeXBlXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgYmFja2VuZC1zYWZlIHF1ZXVlZCBzeW5jIGRhdGEgd2l0aG91dCBtdXRhdGluZyBjYWxsZXIgZGF0YS4gVGhlIGRlZmF1bHRcbiAgICogKG5vIGV4cGxpY2l0IGBkYXRhYCkgaXMgdGhlIHJlc291cmNlJ3MgYXR0cmlidXRlcyBtaW51cyBsb2NhbC1vbmx5IGF0dHJpYnV0ZXMsXG4gICAqIHdpdGggYm9vbGVhbnMgY29lcmNlZCBhbmQgRGF0ZSB2YWx1ZXMgc2VyaWFsaXplZCB0byBJU08gc3RyaW5ncywgc28gYXBwcyBkb24ndFxuICAgKiBuZWVkIHBlci1tb2RlbCB0cmFja2VkLXBheWxvYWQgYnVpbGRlcnMuXG4gICAqIEBwYXJhbSB7e3Jlc291cmNlOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgZGF0YT86IFJlY29yZDxzdHJpbmcsIHVua25vd24+LCBsb2NhbE9ubHlBdHRyaWJ1dGVzPzogc3RyaW5nW10sIGJvb2xlYW5BdHRyaWJ1dGVzPzogc3RyaW5nW10sIG5vcm1hbGl6ZURhdGE/OiAoZGF0YTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pID0+IFJlY29yZDxzdHJpbmcsIHVua25vd24+fX0gYXJncyAtIERhdGEgYXJncy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSBRdWV1ZWQgZGF0YS5cbiAgICovXG4gIHN0YXRpYyBxdWV1ZWRTeW5jRGF0YShhcmdzKSB7XG4gICAgY29uc3QgaW5wdXREYXRhID0gYXJncy5kYXRhID8/IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59ICovIChhcmdzLnJlc291cmNlLmF0dHJpYnV0ZXMoKSlcbiAgICBjb25zdCBub3JtYWxpemVkRGF0YSA9IGFyZ3Mubm9ybWFsaXplRGF0YSA/IGFyZ3Mubm9ybWFsaXplRGF0YShpbnB1dERhdGEpIDogaW5wdXREYXRhXG4gICAgY29uc3Qgc3luY0RhdGEgPSB7Li4ubm9ybWFsaXplZERhdGF9XG5cbiAgICBmb3IgKGNvbnN0IGF0dHJpYnV0ZU5hbWUgb2YgYXJncy5sb2NhbE9ubHlBdHRyaWJ1dGVzIHx8IFtdKSBkZWxldGUgc3luY0RhdGFbYXR0cmlidXRlTmFtZV1cbiAgICBmb3IgKGNvbnN0IGF0dHJpYnV0ZU5hbWUgb2YgYXJncy5ib29sZWFuQXR0cmlidXRlcyB8fCBbXSkge1xuICAgICAgaWYgKE9iamVjdC5oYXNPd24oc3luY0RhdGEsIGF0dHJpYnV0ZU5hbWUpKSBzeW5jRGF0YVthdHRyaWJ1dGVOYW1lXSA9IHRoaXMub3B0aW9uYWxCb29sZWFuU3luY1ZhbHVlKHN5bmNEYXRhW2F0dHJpYnV0ZU5hbWVdLCBhdHRyaWJ1dGVOYW1lKVxuICAgIH1cbiAgICBmb3IgKGNvbnN0IFthdHRyaWJ1dGVOYW1lLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoc3luY0RhdGEpKSB7XG4gICAgICBpZiAodmFsdWUgaW5zdGFuY2VvZiBEYXRlKSBzeW5jRGF0YVthdHRyaWJ1dGVOYW1lXSA9IHZhbHVlLnRvSVNPU3RyaW5nKClcbiAgICB9XG5cbiAgICByZXR1cm4gc3luY0RhdGFcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgYSBzbWFsbCBhcHAtZmFjaW5nIGxvY2FsIHN5bmMgcXVldWUgZmFjYWRlIGZyb20gZGVjbGFyYXRpdmUgbW9kZWwgY29uZmlnLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFF1ZXVlIGNvbmZpZy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5zeW5jTW9kZWwgLSBMb2NhbCBTeW5jIG1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zaW5nbGVGbGlnaHRLZXkgLSBLZXkgdXNlZCB0byBzZXJpYWxpemUgYmFja2VuZCByZXBsYXkuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTx2b2lkPn0gYXJncy5zeW5jUGVuZGluZyAtIEJhY2tlbmQgcmVwbGF5IGNhbGxiYWNrLlxuICAgKiBAcGFyYW0geyhyZXNvdXJjZTogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4pID0+IHN0cmluZ1tdfSBbYXJncy5sb2NhbE9ubHlBdHRyaWJ1dGVzXSAtIFJlc291cmNlLXNwZWNpZmljIGxvY2FsLW9ubHkgYXR0cmlidXRlcy5cbiAgICogQHBhcmFtIHsocmVzb3VyY2U6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+KSA9PiBzdHJpbmdbXX0gW2FyZ3MuYm9vbGVhbkF0dHJpYnV0ZXNdIC0gUmVzb3VyY2Utc3BlY2lmaWMgU1FMaXRlIGJvb2xlYW4gYXR0cmlidXRlcy5cbiAgICogQHJldHVybnMge3txdWV1ZTogKHF1ZXVlQXJnczoge3Jlc291cmNlOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgZGF0YT86IFJlY29yZDxzdHJpbmcsIHVua25vd24+LCBzeW5jVHlwZT86IHN0cmluZ30pID0+IFByb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBzeW5jUGVuZGluZzogKCkgPT4gUHJvbWlzZTx2b2lkPn19IENvbmZpZ3VyZWQgbG9jYWwgc3luYyBxdWV1ZS5cbiAgICovXG4gIHN0YXRpYyBsb2NhbFN5bmNRdWV1ZShhcmdzKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHF1ZXVlOiBhc3luYyAocXVldWVBcmdzKSA9PiBhd2FpdCB0aGlzLnF1ZXVlTG9jYWxTeW5jKHtcbiAgICAgICAgLi4ucXVldWVBcmdzLFxuICAgICAgICBib29sZWFuQXR0cmlidXRlczogYXJncy5ib29sZWFuQXR0cmlidXRlcyA/IGFyZ3MuYm9vbGVhbkF0dHJpYnV0ZXMocXVldWVBcmdzLnJlc291cmNlKSA6IFtdLFxuICAgICAgICBsb2NhbE9ubHlBdHRyaWJ1dGVzOiBhcmdzLmxvY2FsT25seUF0dHJpYnV0ZXMgPyBhcmdzLmxvY2FsT25seUF0dHJpYnV0ZXMocXVldWVBcmdzLnJlc291cmNlKSA6IFtdLFxuICAgICAgICBzeW5jTW9kZWw6IGFyZ3Muc3luY01vZGVsXG4gICAgICB9KSxcbiAgICAgIHN5bmNQZW5kaW5nOiBhc3luYyAoKSA9PiBhd2FpdCB0aGlzLnNpbmdsZUZsaWdodChhcmdzLnNpbmdsZUZsaWdodEtleSwgYXJncy5zeW5jUGVuZGluZylcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUGFyc2VzIGJvb2xlYW5zIGNvbW1vbmx5IHVzZWQgYnkgU1FMaXRlL29mZmxpbmUgc3luYyBwYXlsb2Fkcy5cbiAgICogQHBhcmFtIHt1bmtub3dufSB2YWx1ZSAtIFN5bmMgZGVjaXNpb24gdmFsdWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbZGVzY3JpcHRpb25dIC0gRXJyb3IgY29udGV4dC5cbiAgICogQHJldHVybnMge2Jvb2xlYW4gfCBudWxsfSBQYXJzZWQgYm9vbGVhbi1saWtlIGJhY2tlbmQvbG9jYWwgdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgb3B0aW9uYWxCb29sZWFuU3luY1ZhbHVlKHZhbHVlLCBkZXNjcmlwdGlvbiA9IFwic3luYyBib29sZWFuXCIpIHtcbiAgICBpZiAodmFsdWUgPT0gbnVsbCkgcmV0dXJuIG51bGxcbiAgICBpZiAodmFsdWUgPT09IDEpIHJldHVybiB0cnVlXG4gICAgaWYgKHZhbHVlID09PSAwKSByZXR1cm4gZmFsc2VcblxuICAgIHJldHVybiBvcHRpb25hbEJvb2xlYW4odmFsdWUsIGRlc2NyaXB0aW9uKVxuICB9XG5cbiAgLyoqXG4gICAqIENvbnZlcnRzIGEgYm9vbGVhbiBzeW5jIHZhbHVlIHRvIFNRTGl0ZSBib29sZWFuIHN0b3JhZ2UuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbiB8IG51bGx9IHZhbHVlIC0gU3luYyBib29sZWFuIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7MCB8IDF9IFNRTGl0ZS1jb21wYXRpYmxlIGJvb2xlYW4gdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgc3FsaXRlQm9vbGVhblN5bmNWYWx1ZSh2YWx1ZSkge1xuICAgIHJldHVybiB2YWx1ZSA9PT0gdHJ1ZSA/IDEgOiAwXG4gIH1cblxuICAvKipcbiAgICogUHJvamVjdHMgZ2VuZXJpYyBzeW5jIGNvdW50ZXJzIGludG8gYXBwLXNwZWNpZmljIHJlc3VsdCBrZXlzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFJlc3VsdCBhcmdzLlxuICAgKiBAcGFyYW0ge1N5bmNDaGFuZ2VzUmVzdWx0fSBhcmdzLnJlc3VsdCAtIEdlbmVyaWMgVmVsb2Npb3VzIHN5bmMgcmVzdWx0LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHtjaGFuZ2VkS2V5OiBzdHJpbmcsIGNvdW50S2V5OiBzdHJpbmd9Pn0gYXJncy5yZXNvdXJjZXMgLSBSZXNvdXJjZSByZXN1bHQga2V5IG1hcC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSBQcm9qZWN0ZWQgcmVzdWx0LlxuICAgKi9cbiAgc3RhdGljIHN5bmNSZXN1bHRGb3JSZXNvdXJjZXMoe3Jlc3VsdCwgcmVzb3VyY2VzfSkge1xuICAgIGNvbnN0IHN5bmNSZXN1bHQgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSAqLyAoe1xuICAgICAgY2hhbmdlZDogcmVzdWx0LmNoYW5nZWQsXG4gICAgICBwYWdlczogcmVzdWx0LnBhZ2VzLFxuICAgICAgc3luY2VkQ291bnQ6IHJlc3VsdC5zeW5jZWRDb3VudFxuICAgIH0pXG5cbiAgICBmb3IgKGNvbnN0IFtyZXNvdXJjZVR5cGUsIGtleXNdIG9mIE9iamVjdC5lbnRyaWVzKHJlc291cmNlcykpIHtcbiAgICAgIHN5bmNSZXN1bHRba2V5cy5jb3VudEtleV0gPSByZXN1bHQucmVzb3VyY2VDb3VudHNbcmVzb3VyY2VUeXBlXSB8fCAwXG4gICAgICBzeW5jUmVzdWx0W2tleXMuY2hhbmdlZEtleV0gPSByZXN1bHQucmVzb3VyY2VDaGFuZ2VkW3Jlc291cmNlVHlwZV0gfHwgZmFsc2VcbiAgICB9XG5cbiAgICByZXR1cm4gc3luY1Jlc3VsdFxuICB9XG5cbiAgLyoqXG4gICAqIERyYWlucyBwZW5kaW5nIHN5bmMgcmVjb3JkcyBpbiBzdGFibGUgb3JkZXIgYW5kIG1hcmtzIGFja25vd2xlZGdlZCByb3dzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFJlcGxheSBhcmdzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5hdXRoZW50aWNhdGlvblRva2VuIC0gQXV0aCB0b2tlbiB0byBzZW5kIHdpdGggcmVwbGF5IHJlcXVlc3RzLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuYmF0Y2hTaXplXSAtIE1heCBzeW5jcyBwZXIgcmVxdWVzdC4gRGVmYXVsdHMgdG8gMTAwLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8QXJyYXk8dW5rbm93bj4+fSBhcmdzLnBlbmRpbmdTeW5jcyAtIExvYWRzIHBlbmRpbmcgbG9jYWwgc3luYyByb3dzIGluIHJlcGxheSBvcmRlci5cbiAgICogQHBhcmFtIHsoc3luYzogdW5rbm93bikgPT4gc3RyaW5nIHwgbnVtYmVyIHwgbnVsbCB8IHVuZGVmaW5lZH0gYXJncy5zeW5jSWQgLSBSZXR1cm5zIHRoZSBsb2NhbCBzeW5jIGlkLlxuICAgKiBAcGFyYW0geyhzeW5jOiB1bmtub3duKSA9PiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3Muc3luY1BheWxvYWQgLSBCdWlsZHMgdGhlIEFQSSBzeW5jIGVudmVsb3BlLlxuICAgKiBAcGFyYW0geyhwYXlsb2FkOiB7YXV0aGVudGljYXRpb25Ub2tlbjogc3RyaW5nLCBzeW5jczogQXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0pID0+IFByb21pc2U8U3luY1JlcGxheVJlc3BvbnNlPn0gYXJncy5wb3N0UmVwbGF5IC0gUG9zdHMgb25lIHJlcGxheSByZXF1ZXN0LlxuICAgKiBAcGFyYW0geyhzeW5jOiB1bmtub3duLCByZXNwb25zZTogU3luY1JlcGxheUl0ZW0pID0+IFByb21pc2U8dm9pZD59IGFyZ3MubWFya1N1Y2Nlc3NmdWwgLSBNYXJrcyBvbmUgc3luYyBhcyBzdWNjZXNzZnVsIGxvY2FsbHkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyBhZnRlciBhbGwgYmF0Y2hlcyBhcmUgcmVwbGF5ZWQuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgcmVwbGF5UGVuZGluZyhhcmdzKSB7XG4gICAgY29uc3QgcGVuZGluZ1N5bmNzID0gYXdhaXQgYXJncy5wZW5kaW5nU3luY3MoKVxuICAgIGNvbnN0IGJhdGNoU2l6ZSA9IHRoaXMubm9ybWFsaXplZEJhdGNoU2l6ZShhcmdzLmJhdGNoU2l6ZSlcblxuICAgIGZvciAobGV0IG9mZnNldCA9IDA7IG9mZnNldCA8IHBlbmRpbmdTeW5jcy5sZW5ndGg7IG9mZnNldCArPSBiYXRjaFNpemUpIHtcbiAgICAgIGF3YWl0IHRoaXMucmVwbGF5QmF0Y2goey4uLmFyZ3MsIHBlbmRpbmdTeW5jczogcGVuZGluZ1N5bmNzLnNsaWNlKG9mZnNldCwgb2Zmc2V0ICsgYmF0Y2hTaXplKX0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlcGxheXMgb25lIGJhdGNoIG9mIHN5bmNzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFJlcGxheSBhcmdzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5hdXRoZW50aWNhdGlvblRva2VuIC0gQXV0aCB0b2tlbi5cbiAgICogQHBhcmFtIHtBcnJheTx1bmtub3duPn0gYXJncy5wZW5kaW5nU3luY3MgLSBCYXRjaCBzeW5jcy5cbiAgICogQHBhcmFtIHsoc3luYzogdW5rbm93bikgPT4gc3RyaW5nIHwgbnVtYmVyIHwgbnVsbCB8IHVuZGVmaW5lZH0gYXJncy5zeW5jSWQgLSBTeW5jIGlkIGdldHRlci5cbiAgICogQHBhcmFtIHsoc3luYzogdW5rbm93bikgPT4gUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLnN5bmNQYXlsb2FkIC0gUGF5bG9hZCBidWlsZGVyLlxuICAgKiBAcGFyYW0geyhwYXlsb2FkOiB7YXV0aGVudGljYXRpb25Ub2tlbjogc3RyaW5nLCBzeW5jczogQXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0pID0+IFByb21pc2U8U3luY1JlcGxheVJlc3BvbnNlPn0gYXJncy5wb3N0UmVwbGF5IC0gUmVwbGF5IHBvc3Rlci5cbiAgICogQHBhcmFtIHsoc3luYzogdW5rbm93biwgcmVzcG9uc2U6IFN5bmNSZXBsYXlJdGVtKSA9PiBQcm9taXNlPHZvaWQ+fSBhcmdzLm1hcmtTdWNjZXNzZnVsIC0gU3VjY2VzcyBob29rLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIGJhdGNoIGlzIGFja25vd2xlZGdlZC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyByZXBsYXlCYXRjaChhcmdzKSB7XG4gICAgY29uc3Qge2F1dGhlbnRpY2F0aW9uVG9rZW4sIG1hcmtTdWNjZXNzZnVsLCBwZW5kaW5nU3luY3MsIHBvc3RSZXBsYXksIHN5bmNJZCwgc3luY1BheWxvYWR9ID0gYXJnc1xuXG4gICAgaWYgKHBlbmRpbmdTeW5jcy5sZW5ndGggPT09IDApIHJldHVyblxuXG4gICAgY29uc3Qgc3luY3NCeUlkID0gbmV3IE1hcCgpXG5cbiAgICBmb3IgKGNvbnN0IHN5bmMgb2YgcGVuZGluZ1N5bmNzKSB7XG4gICAgICBjb25zdCBpZCA9IHN5bmNJZChzeW5jKVxuXG4gICAgICBpZiAoaWQgIT09IHVuZGVmaW5lZCAmJiBpZCAhPT0gbnVsbCkgc3luY3NCeUlkLnNldChTdHJpbmcoaWQpLCBzeW5jKVxuICAgIH1cblxuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgcG9zdFJlcGxheSh7XG4gICAgICBhdXRoZW50aWNhdGlvblRva2VuLFxuICAgICAgc3luY3M6IHBlbmRpbmdTeW5jcy5tYXAoKHN5bmMpID0+IHN5bmNQYXlsb2FkKHN5bmMpKVxuICAgIH0pXG5cbiAgICB0aGlzLmVuc3VyZVN1Y2Nlc3NmdWxSZXNwb25zZShyZXNwb25zZSlcblxuICAgIGZvciAoY29uc3Qgc3luY1Jlc3BvbnNlIG9mIHJlc3BvbnNlLnN5bmNzIHx8IFtdKSB7XG4gICAgICBjb25zdCBzeW5jID0gc3luY3NCeUlkLmdldChTdHJpbmcoc3luY1Jlc3BvbnNlLmlkKSlcblxuICAgICAgaWYgKCFzeW5jKSBjb250aW51ZVxuICAgICAgaWYgKHN5bmNSZXNwb25zZS5zeW5jU3RhdGUgIT09IFwic3VjY2Vzc2Z1bFwiKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBzeW5jIHN0YXRlIHJldHVybmVkIGZvciBzeW5jICR7U3RyaW5nKHN5bmNSZXNwb25zZS5pZCl9OiAke1N0cmluZyhzeW5jUmVzcG9uc2Uuc3luY1N0YXRlKX1gKVxuICAgICAgfVxuXG4gICAgICBhd2FpdCBtYXJrU3VjY2Vzc2Z1bChzeW5jLCBzeW5jUmVzcG9uc2UpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrcyBBUEkgcmVzcG9uc2Ugc3RhdHVzIGFuZCBzaGFwZS5cbiAgICogQHBhcmFtIHtTeW5jUmVwbGF5UmVzcG9uc2V9IHJlc3BvbnNlIC0gUmVwbGF5IHJlc3BvbnNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyBlbnN1cmVTdWNjZXNzZnVsUmVzcG9uc2UocmVzcG9uc2UpIHtcbiAgICBpZiAocmVzcG9uc2Uuc3RhdHVzID09PSBcImVycm9yXCIpIHRocm93IG5ldyBFcnJvcihyZXNwb25zZS5lcnJvck1lc3NhZ2UgfHwgXCJTeW5jIGZhaWxlZFwiKVxuICAgIGlmICghQXJyYXkuaXNBcnJheShyZXNwb25zZS5zeW5jcykpIHRocm93IG5ldyBFcnJvcihcIlN5bmMgcmVzcG9uc2UgbWlzc2luZyBzeW5jc1wiKVxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZXMgYSBwb3NpdGl2ZSBiYXRjaCBzaXplLlxuICAgKiBAcGFyYW0ge251bWJlciB8IHVuZGVmaW5lZH0gYmF0Y2hTaXplIC0gQmF0Y2ggc2l6ZS5cbiAgICogQHJldHVybnMge251bWJlcn0gUG9zaXRpdmUgYmF0Y2ggc2l6ZS5cbiAgICovXG4gIHN0YXRpYyBub3JtYWxpemVkQmF0Y2hTaXplKGJhdGNoU2l6ZSkge1xuICAgIGlmICh0eXBlb2YgYmF0Y2hTaXplICE9PSBcIm51bWJlclwiIHx8ICFOdW1iZXIuaXNGaW5pdGUoYmF0Y2hTaXplKSB8fCBiYXRjaFNpemUgPCAxKSByZXR1cm4gMTAwXG5cbiAgICByZXR1cm4gTWF0aC5mbG9vcihiYXRjaFNpemUpXG4gIH1cbn1cbiJdfQ==