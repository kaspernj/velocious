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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3luYy1hcGktY2xpZW50LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3N5bmMvc3luYy1hcGktY2xpZW50LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUMsZUFBZSxFQUFFLGVBQWUsRUFBQyxNQUFNLFNBQVMsQ0FBQTtBQUV4RCxPQUFPLGFBQWEsTUFBTSwrQkFBK0IsQ0FBQTtBQUN6RCxPQUFPLEVBQUMsMEJBQTBCLEVBQUMsTUFBTSwrQkFBK0IsQ0FBQTtBQUN4RSxPQUFPLEVBQUMsdUNBQXVDLEVBQUMsTUFBTSx3QkFBd0IsQ0FBQTtBQUU5RSxrR0FBa0c7QUFDbEcsNEZBQTRGO0FBQzVGLDRGQUE0RjtBQUM1Riw4RkFBOEY7QUFDOUYsMEZBQTBGO0FBQzFGLDRFQUE0RTtBQUM1RSxvRkFBb0Y7QUFDcEYsNEZBQTRGO0FBQzVGLDRGQUE0RjtBQUM1RixNQUFNLGdCQUFnQixHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7QUFFbEM7Ozs7R0FJRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8sYUFBYTtJQUNoQzs7Ozs7Ozs7Ozs7T0FXRztJQUNILE1BQU0sQ0FBQyxLQUFLLENBQUMsd0JBQXdCLENBQUMsRUFBQyxXQUFXLEVBQUUsZ0JBQWdCLEVBQUUsSUFBSSxFQUFFLFNBQVMsRUFBRSxRQUFRLEVBQUUsWUFBWSxFQUFFLFFBQVEsRUFBQztRQUN0SCxNQUFNLFVBQVUsR0FBRyxNQUFNLENBQUMsMEJBQTBCLENBQUMsUUFBUSxDQUFDLEVBQUUsRUFBRSxFQUFFLDZCQUE2QixZQUFZLEVBQUUsQ0FBQyxDQUFDLENBQUE7UUFDakgsTUFBTSxPQUFPLEdBQUcsTUFBTSxnQkFBZ0IsQ0FBQyxXQUFXLENBQUMsT0FBTyxFQUFFLENBQUE7UUFDNUQsTUFBTSxXQUFXLEdBQUcsT0FBTzthQUN4QixNQUFNLENBQUMsQ0FBQyxNQUFNLEVBQUUsRUFBRSxDQUFDLE1BQU0sQ0FBQyxRQUFRLENB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QUFRO1FBQ3RDLElBQUksUUFBUSxDQUFDLE1BQU0sS0FBSyxPQUFPO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxRQUFRLENBQUMsWUFBWSxJQUFJLGFBQWEsQ0FBQyxDQUFBO1FBQ3hGLElBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyxLQUFLLENBQUM7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLDZCQUE2QixDQUFDLENBQUE7SUFDcEYsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxNQUFNLENBQUMsbUJBQW1CLENBQUMsU0FBUztRQUNsQyxJQUFJLE9BQU8sU0FBUyxLQUFLLFFBQVEsSUFBSSxDQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUMsU0FBUyxDQUFDLElBQUksU0FBUyxHQUFHLENBQUM7WUFBRSxPQUFPLEdBQUcsQ0FBQTtRQUU3RixPQUFPLElBQUksQ0FBQyxLQUFLLENBQUMsU0FBUyxDQUFDLENBQUE7SUFDOUIsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCB7b3B0aW9uYWxCb29sZWFuLCBvcHRpb25hbEludGVnZXJ9IGZyb20gXCJ0eXBhbmljXCJcblxuaW1wb3J0IHJlY29yZENoYW5nZXMgZnJvbSBcIi4uL2RhdGFiYXNlL3JlY29yZC1jaGFuZ2VzLmpzXCJcbmltcG9ydCB7c2NhbGFyTW9kZWxQcmltYXJ5S2V5VmFsdWV9IGZyb20gXCIuLi91dGlscy9tb2RlbC1wcmltYXJ5LWtleS5qc1wiXG5pbXBvcnQge2FwcGx5U3luY1JlcGxheVJlc3VsdFRvTG9jYWxNdXRhdGlvbkxvZ30gZnJvbSBcIi4vY29uZmxpY3Qtc3RyYXRlZ3kuanNcIlxuXG4vKiogQHR5cGVkZWYge2ltcG9ydChcIi4vc3luYy1hcGktY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDaGFuZ2VBcHBseVJlc3VsdH0gU3luY0NoYW5nZUFwcGx5UmVzdWx0ICovXG4vKiogQHR5cGVkZWYge2ltcG9ydChcIi4vc3luYy1hcGktY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDaGFuZ2VFbnZlbG9wZX0gU3luY0NoYW5nZUVudmVsb3BlICovXG4vKiogQHR5cGVkZWYge2ltcG9ydChcIi4vc3luYy1hcGktY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDaGFuZ2VzUmVxdWVzdH0gU3luY0NoYW5nZXNSZXF1ZXN0ICovXG4vKiogQHR5cGVkZWYge2ltcG9ydChcIi4vc3luYy1hcGktY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDaGFuZ2VzUmVzcG9uc2V9IFN5bmNDaGFuZ2VzUmVzcG9uc2UgKi9cbi8qKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi9zeW5jLWFwaS1jbGllbnQtdHlwZXMuanNcIikuU3luY0NoYW5nZXNSZXN1bHR9IFN5bmNDaGFuZ2VzUmVzdWx0ICovXG4vKiogQHR5cGVkZWYge2ltcG9ydChcIi4vc3luYy1hcGktY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDdXJzb3J9IFN5bmNDdXJzb3IgKi9cbi8qKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi9zeW5jLWFwaS1jbGllbnQtdHlwZXMuanNcIikuU3luY1JlcGxheUl0ZW19IFN5bmNSZXBsYXlJdGVtICovXG4vKiogQHR5cGVkZWYge2ltcG9ydChcIi4vc3luYy1hcGktY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNSZXBsYXlSZXNwb25zZX0gU3luY1JlcGxheVJlc3BvbnNlICovXG4vKiogQHR5cGVkZWYge2ltcG9ydChcIi4vc3luYy1hcGktY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNSZXNvdXJjZUNvbmZpZ30gU3luY1Jlc291cmNlQ29uZmlnICovXG5jb25zdCBzeW5jVGFza1Byb21pc2VzID0gbmV3IE1hcCgpXG5cbi8qKlxuICogR2VuZXJpYyBjbGllbnQtc2lkZSBoZWxwZXIgZm9yIHJlcGxheWluZyBwZW5kaW5nIHN5bmMgZW52ZWxvcGVzIHRocm91Z2ggdGhlXG4gKiBmcmFtZXdvcmstb3duZWQgYC92ZWxvY2lvdXMvc3luYy9yZXBsYXlgIGVuZHBvaW50LiBBcHBzIHByb3ZpZGUgb25seSBsb2NhbFxuICogcGVyc2lzdGVuY2UvYXV0aCBob29rcy5cbiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgU3luY0FwaUNsaWVudCB7XG4gIC8qKlxuICAgKiBBcHBlbmRzIG9uZSBjb25mbGljdC10cmFja2VkIGludGVudCB0byB0aGUgZXhpc3RpbmcgZHVyYWJsZSBtdXRhdGlvbiBsb2cuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gUXVldWUgYXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG51bWJlciB8IG51bGx9IGFyZ3MuYmFzZVZlcnNpb24gLSBBdXRob3JpdGF0aXZlIHZlcnNpb24gb2JzZXJ2ZWQgYmVmb3JlIHRoZSBsb2NhbCBtdXRhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDbGllbnRDb25mbGljdFRyYWNraW5nQ29uZmlnfSBhcmdzLmNvbmZsaWN0VHJhY2tpbmcgLSBEdXJhYmxlIHRyYWNraW5nIGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59IGFyZ3MuZGF0YSAtIEJhY2tlbmQtc2FmZSBtdXRhdGlvbiBhdHRyaWJ1dGVzLlxuICAgKiBAcGFyYW0ge1wiY3JlYXRlXCIgfCBcInVwZGF0ZVwiIHwgXCJkZXN0cm95XCJ9IGFyZ3Mub3BlcmF0aW9uIC0gTG9jYWwgb3BlcmF0aW9uLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLnJlc291cmNlIC0gTG9jYWwgcmVzb3VyY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnJlc291cmNlVHlwZSAtIFJlc291cmNlIHR5cGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnN5bmNUeXBlIC0gV2lyZSBvcGVyYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vbG9jYWwtbXV0YXRpb24tbG9nLmpzXCIpLkxvY2FsTXV0YXRpb25Mb2dSZWNvcmQ+fSBBcHBlbmRlZCBpbnRlbnQuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgcXVldWVDb25mbGljdFRyYWNrZWRTeW5jKHtiYXNlVmVyc2lvbiwgY29uZmxpY3RUcmFja2luZywgZGF0YSwgb3BlcmF0aW9uLCByZXNvdXJjZSwgcmVzb3VyY2VUeXBlLCBzeW5jVHlwZX0pIHtcbiAgICBjb25zdCByZXNvdXJjZUlkID0gU3RyaW5nKHNjYWxhck1vZGVsUHJpbWFyeUtleVZhbHVlKHJlc291cmNlLmlkKCksIGBDb25mbGljdC10cmFja2VkIHN5bmMgZm9yICR7cmVzb3VyY2VUeXBlfWApKVxuICAgIGNvbnN0IHJlY29yZHMgPSBhd2FpdCBjb25mbGljdFRyYWNraW5nLm11dGF0aW9uTG9nLnJlY29yZHMoKVxuICAgIGNvbnN0IHByZWRlY2Vzc29yID0gcmVjb3Jkc1xuICAgICAgLmZpbHRlcigocmVjb3JkKSA9PiByZWNvcmQubXV0YXRpb24ubW9kZWwgPT09IHJlc291cmNlVHlwZSAmJiByZWNvcmQubXV0YXRpb24ucGF5bG9hZD8ucmVzb3VyY2VJZCA9PT0gcmVzb3VyY2VJZClcbiAgICAgIC5hdCgtMSlcbiAgICBjb25zdCBjbGllbnRNdXRhdGlvbklkID0gY29uZmxpY3RUcmFja2luZy5jbGllbnRNdXRhdGlvbklkKClcbiAgICBjb25zdCBub3cgPSBjb25mbGljdFRyYWNraW5nLm5vdyA/IGNvbmZsaWN0VHJhY2tpbmcubm93KCkgOiBuZXcgRGF0ZSgpXG4gICAgY29uc3QgcHJlZGVjZXNzb3JUaW1lID0gcHJlZGVjZXNzb3IgPyBuZXcgRGF0ZShwcmVkZWNlc3Nvci5tdXRhdGlvbi5vY2N1cnJlZEF0KS5nZXRUaW1lKCkgOiBOdW1iZXIuTkVHQVRJVkVfSU5GSU5JVFlcbiAgICBjb25zdCBvY2N1cnJlZEF0ID0gbmV3IERhdGUoTWF0aC5tYXgobm93LmdldFRpbWUoKSwgcHJlZGVjZXNzb3JUaW1lICsgMSkpLnRvSVNPU3RyaW5nKClcblxuICAgIHJldHVybiBhd2FpdCBjb25mbGljdFRyYWNraW5nLm11dGF0aW9uTG9nLmFwcGVuZCh7XG4gICAgICBkZXBlbmRlbmNpZXM6IHByZWRlY2Vzc29yID8gW3tjbGllbnRNdXRhdGlvbklkOiBwcmVkZWNlc3Nvci5tdXRhdGlvbi5jbGllbnRNdXRhdGlvbklkLCBtb2RlbDogcmVzb3VyY2VUeXBlfV0gOiBbXSxcbiAgICAgIG11dGF0aW9uOiB7XG4gICAgICAgIGFjdG9yRGV2aWNlSWQ6IGNvbmZsaWN0VHJhY2tpbmcuYWN0b3JEZXZpY2VJZCxcbiAgICAgICAgYWN0b3JVc2VySWQ6IGNvbmZsaWN0VHJhY2tpbmcuYWN0b3JVc2VySWQsXG4gICAgICAgIGF0dHJpYnV0ZXM6IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsU3luY0pzb25WYWx1ZT59ICovIChkYXRhKSxcbiAgICAgICAgYmFzZVZlcnNpb24sXG4gICAgICAgIGNsaWVudE11dGF0aW9uSWQsXG4gICAgICAgIG1vZGVsOiByZXNvdXJjZVR5cGUsXG4gICAgICAgIG9jY3VycmVkQXQsXG4gICAgICAgIG9mZmxpbmVHcmFudElkOiBjb25mbGljdFRyYWNraW5nLm9mZmxpbmVHcmFudElkLFxuICAgICAgICBvcGVyYXRpb24sXG4gICAgICAgIHBheWxvYWQ6IHtyZXNvdXJjZUlkLCBzeW5jVHlwZX0sXG4gICAgICAgIHBvbGljeUhhc2g6IGNvbmZsaWN0VHJhY2tpbmcucG9saWN5SGFzaFxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogRHJhaW5zIHRoZSBleGlzdGluZyBtdXRhdGlvbiBsb2cgaW4gcHJlZGVjZXNzb3Igb3JkZXIuIEluZGVwZW5kZW50IHJlY29yZHNcbiAgICogY29udGludWUgYWZ0ZXIgZHVyYWJsZSBjb25mbGljdHMvcmVqZWN0aW9uczsgc3VjY2Vzc29ycyBzdGF5IGJsb2NrZWQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gUmVwbGF5IGFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuYXV0aGVudGljYXRpb25Ub2tlbiAtIEF1dGhlbnRpY2F0aW9uIHRva2VuLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuYmF0Y2hTaXplXSAtIEJhdGNoIHNpemUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5TeW5jQ2xpZW50Q29uZmxpY3RUcmFja2luZ0NvbmZpZ30gYXJncy5jb25mbGljdFRyYWNraW5nIC0gVHJhY2tpbmcgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHsocGF5bG9hZDoge2F1dGhlbnRpY2F0aW9uVG9rZW46IHN0cmluZywgc3luY3M6IEFycmF5PFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59KSA9PiBQcm9taXNlPFN5bmNSZXBsYXlSZXNwb25zZT59IGFyZ3MucG9zdFJlcGxheSAtIFRyYW5zcG9ydCBib3VuZGFyeS5cbiAgICogQHBhcmFtIHsoaWRlbnRpdHk6IHN0cmluZykgPT4gbnVtYmVyfSBhcmdzLnJlbW90ZUdlbmVyYXRpb24gLSBDdXJyZW50IHJlbW90ZSBnZW5lcmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5yZXNvdXJjZVR5cGUgLSBSZXNvdXJjZSB3aG9zZSBsb2cgcmVjb3JkcyBzaG91bGQgZHJhaW4uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyB3aGVuIG5vIHJlYWR5IGludGVudCByZW1haW5zLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHJlcGxheUNvbmZsaWN0VHJhY2tlZFN5bmNzKHthdXRoZW50aWNhdGlvblRva2VuLCBiYXRjaFNpemUsIGNvbmZsaWN0VHJhY2tpbmcsIHBvc3RSZXBsYXksIHJlbW90ZUdlbmVyYXRpb24sIHJlc291cmNlVHlwZX0pIHtcbiAgICBjb25zdCBtYXhCYXRjaFNpemUgPSB0aGlzLm5vcm1hbGl6ZWRCYXRjaFNpemUoYmF0Y2hTaXplKVxuXG4gICAgd2hpbGUgKHRydWUpIHtcbiAgICAgIGNvbnN0IHJlY29yZHMgPSBhd2FpdCBjb25mbGljdFRyYWNraW5nLm11dGF0aW9uTG9nLnJlY29yZHMoKVxuICAgICAgY29uc3Qgc3RhdHVzZXMgPSBuZXcgTWFwKHJlY29yZHMubWFwKChyZWNvcmQpID0+IFtyZWNvcmQubXV0YXRpb24uY2xpZW50TXV0YXRpb25JZCwgcmVjb3JkLnN0YXR1c10pKVxuICAgICAgY29uc3QgcGVuZGluZyA9IHJlY29yZHMuZmlsdGVyKChyZWNvcmQpID0+IHJlY29yZC5zdGF0dXMgPT09IFwicGVuZGluZ1wiICYmIHJlY29yZC5tdXRhdGlvbi5tb2RlbCA9PT0gcmVzb3VyY2VUeXBlKVxuICAgICAgY29uc3QgcmVhZHkgPSBwZW5kaW5nLmZpbHRlcigocmVjb3JkKSA9PiByZWNvcmQuZGVwZW5kZW5jaWVzLmV2ZXJ5KChkZXBlbmRlbmN5KSA9PiBzdGF0dXNlcy5nZXQoZGVwZW5kZW5jeS5jbGllbnRNdXRhdGlvbklkKSA9PT0gXCJzeW5jZWRcIikpXG5cbiAgICAgIGlmIChyZWFkeS5sZW5ndGggPT09IDApIHJldHVyblxuXG4gICAgICBjb25zdCBncm91cHMgPSB0aGlzLmNvbmZsaWN0UmVwbGF5R3JvdXBzKHtwZW5kaW5nLCByZWFkeX0pLnNsaWNlKDAsIG1heEJhdGNoU2l6ZSlcbiAgICAgIGNvbnN0IGdlbmVyYXRpb25zID0gbmV3IE1hcChncm91cHMubWFwKChncm91cCkgPT4gW2dyb3VwWzBdLm11dGF0aW9uLmNsaWVudE11dGF0aW9uSWQsIHJlbW90ZUdlbmVyYXRpb24odGhpcy5jb25mbGljdFJlY29yZElkZW50aXR5KGdyb3VwWzBdKSldKSlcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgcG9zdFJlcGxheSh7XG4gICAgICAgIGF1dGhlbnRpY2F0aW9uVG9rZW4sXG4gICAgICAgIHN5bmNzOiBncm91cHMubWFwKChncm91cCkgPT4gdGhpcy5jb25mbGljdFJlcGxheVBheWxvYWQoZ3JvdXApKVxuICAgICAgfSlcblxuICAgICAgdGhpcy5lbnN1cmVTdWNjZXNzZnVsUmVzcG9uc2UocmVzcG9uc2UpXG5cbiAgICAgIGNvbnN0IHJlc3BvbnNlc0J5SWQgPSBuZXcgTWFwKChyZXNwb25zZS5zeW5jcyB8fCBbXSkubWFwKChyZXN1bHQpID0+IFtTdHJpbmcocmVzdWx0LmlkKSwgcmVzdWx0XSkpXG5cbiAgICAgIGZvciAoY29uc3QgZ3JvdXAgb2YgZ3JvdXBzKSB7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IHJlc3BvbnNlc0J5SWQuZ2V0KGdyb3VwWzBdLm11dGF0aW9uLmNsaWVudE11dGF0aW9uSWQpXG5cbiAgICAgICAgaWYgKCFyZXN1bHQpIHRocm93IG5ldyBFcnJvcihgU3luYyByZXNwb25zZSBtaXNzaW5nIHJlc3VsdCBmb3IgbXV0YXRpb24gJHtncm91cFswXS5tdXRhdGlvbi5jbGllbnRNdXRhdGlvbklkfWApXG4gICAgICAgIGlmICghW1wic3VjY2Vzc2Z1bFwiLCBcImR1cGxpY2F0ZVwiLCBcImNvbmZsaWN0XCIsIFwiZmFpbGVkXCIsIFwicmVqZWN0ZWRcIl0uaW5jbHVkZXMocmVzdWx0LnN5bmNTdGF0ZSkpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgc3luYyBzdGF0ZSByZXR1cm5lZCBmb3IgbXV0YXRpb24gJHtncm91cFswXS5tdXRhdGlvbi5jbGllbnRNdXRhdGlvbklkfTogJHtyZXN1bHQuc3luY1N0YXRlfWApXG4gICAgICAgIH1cblxuICAgICAgICBmb3IgKGNvbnN0IHJlY29yZCBvZiBncm91cCkge1xuICAgICAgICAgIGF3YWl0IGFwcGx5U3luY1JlcGxheVJlc3VsdFRvTG9jYWxNdXRhdGlvbkxvZyh7bXV0YXRpb25Mb2c6IGNvbmZsaWN0VHJhY2tpbmcubXV0YXRpb25Mb2csIHJlY29yZCwgcmVzdWx0OiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHJlc3VsdCl9KVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKFtcInN1Y2Nlc3NmdWxcIiwgXCJkdXBsaWNhdGVcIl0uaW5jbHVkZXMocmVzdWx0LnN5bmNTdGF0ZSkgJiYgcmVzdWx0LnNlcnZlclZlcnNpb24gIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIGNvbnN0IGlkZW50aXR5ID0gdGhpcy5jb25mbGljdFJlY29yZElkZW50aXR5KGdyb3VwWzBdKVxuXG4gICAgICAgICAgaWYgKHJlbW90ZUdlbmVyYXRpb24oaWRlbnRpdHkpID09PSBnZW5lcmF0aW9ucy5nZXQoZ3JvdXBbMF0ubXV0YXRpb24uY2xpZW50TXV0YXRpb25JZCkpIHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucmViYXNlQ29uZmxpY3RTdWNjZXNzb3Ioe2NvbmZsaWN0VHJhY2tpbmcsIHByZWRlY2Vzc29yOiBncm91cFtncm91cC5sZW5ndGggLSAxXSwgc2VydmVyVmVyc2lvbjogcmVzdWx0LnNlcnZlclZlcnNpb259KVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgc2FmZSB0cmFuc3BvcnQgZ3JvdXBzIGZyb20gcm9vdC1yZWFkeSByZWNvcmRzIGFuZCB0aGVpciBzdWNjZXNzb3JzLlxuICAgKiBAcGFyYW0ge3twZW5kaW5nOiBBcnJheTxpbXBvcnQoXCIuL2xvY2FsLW11dGF0aW9uLWxvZy5qc1wiKS5Mb2NhbE11dGF0aW9uTG9nUmVjb3JkPiwgcmVhZHk6IEFycmF5PGltcG9ydChcIi4vbG9jYWwtbXV0YXRpb24tbG9nLmpzXCIpLkxvY2FsTXV0YXRpb25Mb2dSZWNvcmQ+fX0gYXJncyAtIFBlbmRpbmcgYW5kIHJvb3QtcmVhZHkgcmVjb3Jkcy5cbiAgICogQHJldHVybnMge0FycmF5PEFycmF5PGltcG9ydChcIi4vbG9jYWwtbXV0YXRpb24tbG9nLmpzXCIpLkxvY2FsTXV0YXRpb25Mb2dSZWNvcmQ+Pn0gU2FmZSB0cmFuc3BvcnQgZ3JvdXBzLlxuICAgKi9cbiAgc3RhdGljIGNvbmZsaWN0UmVwbGF5R3JvdXBzKHtwZW5kaW5nLCByZWFkeX0pIHtcbiAgICBjb25zdCBncm91cHMgPSBbXVxuICAgIGNvbnN0IHNlbGVjdGVkSWRlbnRpdGllcyA9IG5ldyBTZXQoKVxuXG4gICAgZm9yIChjb25zdCByZWNvcmQgb2YgcmVhZHkpIHtcbiAgICAgIGNvbnN0IGlkZW50aXR5ID0gdGhpcy5jb25mbGljdFJlY29yZElkZW50aXR5KHJlY29yZClcblxuICAgICAgaWYgKHNlbGVjdGVkSWRlbnRpdGllcy5oYXMoaWRlbnRpdHkpKSBjb250aW51ZVxuXG4gICAgICBjb25zdCBncm91cCA9IFtyZWNvcmRdXG4gICAgICBsZXQgdGFpbCA9IHJlY29yZFxuXG4gICAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgICBjb25zdCBzdWNjZXNzb3IgPSBwZW5kaW5nLmZpbmQoKGNhbmRpZGF0ZSkgPT4gY2FuZGlkYXRlLmRlcGVuZGVuY2llcy5zb21lKChkZXBlbmRlbmN5KSA9PiBkZXBlbmRlbmN5LmNsaWVudE11dGF0aW9uSWQgPT09IHRhaWwubXV0YXRpb24uY2xpZW50TXV0YXRpb25JZCkpXG5cbiAgICAgICAgaWYgKCFzdWNjZXNzb3IgfHwgIXRoaXMuY2FuQ29hbGVzY2VDb25mbGljdFJlY29yZHModGFpbCwgc3VjY2Vzc29yKSkgYnJlYWtcbiAgICAgICAgZ3JvdXAucHVzaChzdWNjZXNzb3IpXG4gICAgICAgIHRhaWwgPSBzdWNjZXNzb3JcbiAgICAgIH1cblxuICAgICAgZ3JvdXBzLnB1c2goZ3JvdXApXG4gICAgICBzZWxlY3RlZElkZW50aXRpZXMuYWRkKGlkZW50aXR5KVxuICAgIH1cblxuICAgIHJldHVybiBncm91cHNcbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVja3Mgd2hldGhlciB0d28gZHVyYWJsZSBpbnRlbnRzIGNhbiBzaGFyZSBvbmUgdHJhbnNwb3J0IG11dGF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vbG9jYWwtbXV0YXRpb24tbG9nLmpzXCIpLkxvY2FsTXV0YXRpb25Mb2dSZWNvcmR9IGxlZnQgLSBFYXJsaWVyIGludGVudC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2xvY2FsLW11dGF0aW9uLWxvZy5qc1wiKS5Mb2NhbE11dGF0aW9uTG9nUmVjb3JkfSByaWdodCAtIExhdGVyIGludGVudC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IFdoZXRoZXIgc2NhbGFyIHVwZGF0ZXMgY2FuIHNoYXJlIG9uZSB0cmFuc3BvcnQgbXV0YXRpb24uXG4gICAqL1xuICBzdGF0aWMgY2FuQ29hbGVzY2VDb25mbGljdFJlY29yZHMobGVmdCwgcmlnaHQpIHtcbiAgICBpZiAobGVmdC5tdXRhdGlvbi5vcGVyYXRpb24gIT09IFwidXBkYXRlXCIgfHwgcmlnaHQubXV0YXRpb24ub3BlcmF0aW9uICE9PSBcInVwZGF0ZVwiKSByZXR1cm4gZmFsc2VcbiAgICBpZiAodGhpcy5jb25mbGljdFJlY29yZElkZW50aXR5KGxlZnQpICE9PSB0aGlzLmNvbmZsaWN0UmVjb3JkSWRlbnRpdHkocmlnaHQpKSByZXR1cm4gZmFsc2VcbiAgICBpZiAobGVmdC5tdXRhdGlvbi5iYXNlVmVyc2lvbiAhPT0gcmlnaHQubXV0YXRpb24uYmFzZVZlcnNpb24pIHJldHVybiBmYWxzZVxuICAgIGlmICghdGhpcy5zY2FsYXJTeW5jQXR0cmlidXRlcyhsZWZ0Lm11dGF0aW9uLmF0dHJpYnV0ZXMpIHx8ICF0aGlzLnNjYWxhclN5bmNBdHRyaWJ1dGVzKHJpZ2h0Lm11dGF0aW9uLmF0dHJpYnV0ZXMpKSByZXR1cm4gZmFsc2VcblxuICAgIHJldHVybiAhT2JqZWN0LmtleXMobGVmdC5tdXRhdGlvbi5hdHRyaWJ1dGVzIHx8IHt9KS5zb21lKChrZXkpID0+IE9iamVjdC5oYXNPd24ocmlnaHQubXV0YXRpb24uYXR0cmlidXRlcyB8fCB7fSwga2V5KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVja3Mgd2hldGhlciBhdHRyaWJ1dGVzIGNvbnRhaW4gc2NhbGFyIEpTT04gdmFsdWVzIG9ubHkuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5Gcm9udGVuZE1vZGVsU3luY0pzb25WYWx1ZT4gfCB1bmRlZmluZWR9IGF0dHJpYnV0ZXMgLSBBdHRyaWJ1dGVzLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gV2hldGhlciBldmVyeSB2YWx1ZSBpcyBzY2FsYXIuXG4gICAqL1xuICBzdGF0aWMgc2NhbGFyU3luY0F0dHJpYnV0ZXMoYXR0cmlidXRlcykge1xuICAgIHJldHVybiBCb29sZWFuKGF0dHJpYnV0ZXMpICYmIE9iamVjdC52YWx1ZXMoYXR0cmlidXRlcyB8fCB7fSkuZXZlcnkoKHZhbHVlKSA9PiB2YWx1ZSA9PT0gbnVsbCB8fCBbXCJzdHJpbmdcIiwgXCJudW1iZXJcIiwgXCJib29sZWFuXCJdLmluY2x1ZGVzKHR5cGVvZiB2YWx1ZSkpXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIG9uZSByZXBsYXkgZW52ZWxvcGUgZm9yIGEgc2FmZSB0cmFuc3BvcnQgZ3JvdXAuXG4gICAqIEBwYXJhbSB7QXJyYXk8aW1wb3J0KFwiLi9sb2NhbC1tdXRhdGlvbi1sb2cuanNcIikuTG9jYWxNdXRhdGlvbkxvZ1JlY29yZD59IGdyb3VwIC0gVHJhbnNwb3J0IGdyb3VwLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBSZXBsYXkgZW52ZWxvcGUuXG4gICAqL1xuICBzdGF0aWMgY29uZmxpY3RSZXBsYXlQYXlsb2FkKGdyb3VwKSB7XG4gICAgY29uc3QgZmlyc3QgPSBncm91cFswXVxuICAgIGNvbnN0IHBheWxvYWQgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKHtcbiAgICAgIGJhc2VWZXJzaW9uOiBmaXJzdC5tdXRhdGlvbi5iYXNlVmVyc2lvbixcbiAgICAgIGNsaWVudFVwZGF0ZWRBdDogZmlyc3QubXV0YXRpb24ub2NjdXJyZWRBdCxcbiAgICAgIGRhdGE6IE9iamVjdC5hc3NpZ24oe30sIC4uLmdyb3VwLm1hcCgocmVjb3JkKSA9PiByZWNvcmQubXV0YXRpb24uYXR0cmlidXRlcyB8fCB7fSkpLFxuICAgICAgaWQ6IGZpcnN0Lm11dGF0aW9uLmNsaWVudE11dGF0aW9uSWQsXG4gICAgICByZXNvdXJjZUlkOiBmaXJzdC5tdXRhdGlvbi5wYXlsb2FkPy5yZXNvdXJjZUlkLFxuICAgICAgcmVzb3VyY2VUeXBlOiBmaXJzdC5tdXRhdGlvbi5tb2RlbCxcbiAgICAgIHN5bmNUeXBlOiBmaXJzdC5tdXRhdGlvbi5wYXlsb2FkPy5zeW5jVHlwZVxuICAgIH0pXG5cbiAgICByZXR1cm4gcGF5bG9hZFxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBhIHN0YWJsZSByZXNvdXJjZSBpZGVudGl0eSBmb3Igb3JkZXJpbmcgYW5kIHJlbW90ZSBnZW5lcmF0aW9ucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2xvY2FsLW11dGF0aW9uLWxvZy5qc1wiKS5Mb2NhbE11dGF0aW9uTG9nUmVjb3JkfSByZWNvcmQgLSBSZWNvcmQuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IFJlc291cmNlIGlkZW50aXR5LlxuICAgKi9cbiAgc3RhdGljIGNvbmZsaWN0UmVjb3JkSWRlbnRpdHkocmVjb3JkKSB7XG4gICAgcmV0dXJuIGAke3JlY29yZC5tdXRhdGlvbi5tb2RlbH06JHtTdHJpbmcocmVjb3JkLm11dGF0aW9uLnBheWxvYWQ/LnJlc291cmNlSWQpfWBcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWJhc2VzIHRoZSBkaXJlY3QgcGVuZGluZyBzdWNjZXNzb3IgZnJvbSBhbiBhdXRob3JpdGF0aXZlIGFja25vd2xlZGdlbWVudC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBSZWJhc2UgYXJncy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNDbGllbnRDb25mbGljdFRyYWNraW5nQ29uZmlnfSBhcmdzLmNvbmZsaWN0VHJhY2tpbmcgLSBUcmFja2luZyBjb25maWcuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9sb2NhbC1tdXRhdGlvbi1sb2cuanNcIikuTG9jYWxNdXRhdGlvbkxvZ1JlY29yZH0gYXJncy5wcmVkZWNlc3NvciAtIEFja25vd2xlZGdlZCBwcmVkZWNlc3Nvci5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBudW1iZXIgfCBudWxsfSBhcmdzLnNlcnZlclZlcnNpb24gLSBBdXRob3JpdGF0aXZlIHNlcnZlciB2ZXJzaW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIHN0YXRpYyBhc3luYyByZWJhc2VDb25mbGljdFN1Y2Nlc3Nvcih7Y29uZmxpY3RUcmFja2luZywgcHJlZGVjZXNzb3IsIHNlcnZlclZlcnNpb259KSB7XG4gICAgY29uc3Qgc3VjY2Vzc29yID0gKGF3YWl0IGNvbmZsaWN0VHJhY2tpbmcubXV0YXRpb25Mb2cucGVuZGluZ1JlY29yZHMoKSlcbiAgICAgIC5maW5kKChyZWNvcmQpID0+IHJlY29yZC5kZXBlbmRlbmNpZXMuc29tZSgoZGVwZW5kZW5jeSkgPT4gZGVwZW5kZW5jeS5jbGllbnRNdXRhdGlvbklkID09PSBwcmVkZWNlc3Nvci5tdXRhdGlvbi5jbGllbnRNdXRhdGlvbklkKSlcblxuICAgIGlmICghc3VjY2Vzc29yKSByZXR1cm5cblxuICAgIGF3YWl0IGNvbmZsaWN0VHJhY2tpbmcubXV0YXRpb25Mb2cudXBkYXRlTXV0YXRpb24oe1xuICAgICAgaWQ6IHN1Y2Nlc3Nvci5pZCxcbiAgICAgIG11dGF0aW9uOiB7Li4uc3VjY2Vzc29yLm11dGF0aW9uLCBiYXNlVmVyc2lvbjogc2VydmVyVmVyc2lvbn1cbiAgICB9KVxuICB9XG4gIC8qKlxuICAgKiBTZXJpYWxpemVzIHN5bmMgd29yayB3aXRoIHRoZSBzYW1lIGtleSBzbyBjYWxsZXJzIGRvIG5vdCBoYXZlIHRvIGtlZXAgYXBwLWxvY2FsIGxvY2tzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30ga2V5IC0gTG9jayBrZXkuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTx2b2lkPn0gY2FsbGJhY2sgLSBXb3JrIHRvIHJ1biBvbmNlIHByZXZpb3VzIHdvcmsgZmluaXNoZWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHNpbmdsZUZsaWdodChrZXksIGNhbGxiYWNrKSB7XG4gICAgd2hpbGUgKHN5bmNUYXNrUHJvbWlzZXMuaGFzKGtleSkpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHN5bmNUYXNrUHJvbWlzZXMuZ2V0KGtleSlcbiAgICAgIH0gY2F0Y2ggKF9lcnJvcikge1xuICAgICAgICAvLyBUaGUgZmFpbGVkIGZsaWdodCdzIG93biBjYWxsZXIgb2JzZXJ2ZXMgdGhhdCByZWplY3Rpb247IGNhbGxlcnMgcXVldWVkXG4gICAgICAgIC8vIGJlaGluZCBpdCBzdGlsbCBydW4gdGhlaXIgb3duIHdvcmsgc28gcGVuZGluZyByb3dzIHJldHJ5IGFmdGVyIHRoZSBsb2NrIGNsZWFycy5cbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBwcm9taXNlID0gY2FsbGJhY2soKVxuICAgIHN5bmNUYXNrUHJvbWlzZXMuc2V0KGtleSwgcHJvbWlzZSlcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBwcm9taXNlXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGlmIChzeW5jVGFza1Byb21pc2VzLmdldChrZXkpID09PSBwcm9taXNlKSBzeW5jVGFza1Byb21pc2VzLmRlbGV0ZShrZXkpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFB1bGxzIGJhY2tlbmQgc3luYyBjaGFuZ2VzIHdpdGggYSBmcmFtZXdvcmstbWFuYWdlZCBjdXJzb3Igcm93LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFB1bGwgYXJncy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuYXV0aGVudGljYXRpb25Ub2tlbiAtIEF1dGggdG9rZW4gdG8gc2VuZCB3aXRoIGNoYW5nZSByZXF1ZXN0cy5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLmJhdGNoU2l6ZV0gLSBNYXggc3luY3MgcGVyIHJlcXVlc3QuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MuY3Vyc29yTW9kZWwgLSBNb2RlbCB0aGF0IHJlc3BvbmRzIHRvIGZpbmRCeS9maW5kT3JJbml0aWFsaXplQnkgZm9yIGN1cnNvciBwZXJzaXN0ZW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuY3Vyc29yS2V5IC0gQ3Vyc29yIG9wdGlvbiBrZXkuXG4gICAqIEBwYXJhbSB7KHBheWxvYWQ6IFN5bmNDaGFuZ2VzUmVxdWVzdCkgPT4gUHJvbWlzZTxTeW5jQ2hhbmdlc1Jlc3BvbnNlPn0gYXJncy5wb3N0Q2hhbmdlcyAtIFBvc3RzIG9uZSBjaGFuZ2VzIHJlcXVlc3QuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgU3luY1Jlc291cmNlQ29uZmlnPn0gYXJncy5yZXNvdXJjZXMgLSBSZXNvdXJjZSBwb2xpY2llcy5cbiAgICogQHBhcmFtIHsocHJvZ3Jlc3M6IGltcG9ydChcIi4vc3luYy1hcGktY2xpZW50LXR5cGVzLmpzXCIpLlN5bmNQdWxsUHJvZ3Jlc3MpID0+IHZvaWR9IFthcmdzLm9uUHJvZ3Jlc3NdIC0gUHJvZ3Jlc3MgY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFN5bmNDaGFuZ2VzUmVzdWx0Pn0gUHVsbCByZXN1bHQuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgcHVsbENoYW5nZXNXaXRoQ3Vyc29yKGFyZ3MpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5wdWxsQ2hhbmdlcyh7XG4gICAgICBhdXRoZW50aWNhdGlvblRva2VuOiBhcmdzLmF1dGhlbnRpY2F0aW9uVG9rZW4sXG4gICAgICBiYXRjaFNpemU6IGFyZ3MuYmF0Y2hTaXplLFxuICAgICAgbG9hZEN1cnNvcjogYXN5bmMgKCkgPT4gYXdhaXQgdGhpcy5sb2FkU3luY0N1cnNvcih7Y3Vyc29yS2V5OiBhcmdzLmN1cnNvcktleSwgY3Vyc29yTW9kZWw6IGFyZ3MuY3Vyc29yTW9kZWx9KSxcbiAgICAgIHNhdmVDdXJzb3I6IGFzeW5jIChjdXJzb3IpID0+IGF3YWl0IHRoaXMuc2F2ZVN5bmNDdXJzb3Ioe2N1cnNvciwgY3Vyc29yS2V5OiBhcmdzLmN1cnNvcktleSwgY3Vyc29yTW9kZWw6IGFyZ3MuY3Vyc29yTW9kZWx9KSxcbiAgICAgIHBvc3RDaGFuZ2VzOiBhcmdzLnBvc3RDaGFuZ2VzLFxuICAgICAgYXBwbHlTeW5jOiB0aGlzLnJlc291cmNlQXBwbGllcihhcmdzLnJlc291cmNlcyksXG4gICAgICBvblByb2dyZXNzOiBhcmdzLm9uUHJvZ3Jlc3NcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIExvYWRzIGEgcGVyc2lzdGVkIHN5bmMgY3Vyc29yIGZyb20gYSBtb2RlbCByb3cgd2l0aCBhIHZhbHVlIGNvbHVtbi5cbiAgICogQHBhcmFtIHt7Y3Vyc29yS2V5OiBzdHJpbmcsIGN1cnNvck1vZGVsOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn19IGFyZ3MgLSBDdXJzb3IgYXJncy5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nIHwgbnVsbD59IFBlcnNpc3RlZCBjdXJzb3IgcGF5bG9hZC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBsb2FkU3luY0N1cnNvcih7Y3Vyc29yS2V5LCBjdXJzb3JNb2RlbH0pIHtcbiAgICBjb25zdCBvcHRpb24gPSBhd2FpdCBjdXJzb3JNb2RlbC5maW5kQnkoe2tleTogY3Vyc29yS2V5fSlcblxuICAgIHJldHVybiBvcHRpb24gPyBvcHRpb24udmFsdWUoKSA6IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBTYXZlcyBhIHBlcnNpc3RlZCBzeW5jIGN1cnNvciB0byBhIG1vZGVsIHJvdyB3aXRoIGEgdmFsdWUgY29sdW1uLlxuICAgKiBAcGFyYW0ge3tjdXJzb3I6IFN5bmNDdXJzb3IsIGN1cnNvcktleTogc3RyaW5nLCBjdXJzb3JNb2RlbDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59fSBhcmdzIC0gQ3Vyc29yIGFyZ3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHNhdmVTeW5jQ3Vyc29yKHtjdXJzb3IsIGN1cnNvcktleSwgY3Vyc29yTW9kZWx9KSB7XG4gICAgaWYgKCFjdXJzb3IpIHJldHVyblxuXG4gICAgY29uc3Qgb3B0aW9uID0gYXdhaXQgY3Vyc29yTW9kZWwuZmluZE9ySW5pdGlhbGl6ZUJ5KHtrZXk6IGN1cnNvcktleX0pXG5cbiAgICBvcHRpb24uYXNzaWduKHt2YWx1ZTogSlNPTi5zdHJpbmdpZnkoY3Vyc29yKX0pXG4gICAgaWYgKG9wdGlvbi5pc0NoYW5nZWQoKSkgYXdhaXQgb3B0aW9uLnNhdmUoKVxuICB9XG5cbiAgLyoqXG4gICAqIFB1bGxzIGJhY2tlbmQgc3luYyBjaGFuZ2VzIGluIHN0YWJsZSBwYWdlcywgYXBwbGllcyB0aGVtIGxvY2FsbHksIGFuZCBzdG9yZXNcbiAgICogdGhlIGFja25vd2xlZGdlZCBjdXJzb3IuIEFwcHMgcHJvdmlkZSBvbmx5IGF1dGgsIHBlcnNpc3RlbmNlLCB0cmFuc3BvcnQsIGFuZFxuICAgKiByZXNvdXJjZSBwb2xpY3kgaG9va3MuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gUHVsbCBhcmdzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5hdXRoZW50aWNhdGlvblRva2VuIC0gQXV0aCB0b2tlbiB0byBzZW5kIHdpdGggY2hhbmdlIHJlcXVlc3RzLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuYmF0Y2hTaXplXSAtIE1heCBzeW5jcyBwZXIgcmVxdWVzdC4gRGVmYXVsdHMgdG8gMTAwLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8U3luY0N1cnNvciB8IHN0cmluZyB8IG51bGwgfCB1bmRlZmluZWQ+fSBhcmdzLmxvYWRDdXJzb3IgLSBMb2FkcyB0aGUgcGVyc2lzdGVkIGxvY2FsIGN1cnNvci5cbiAgICogQHBhcmFtIHsoY3Vyc29yOiBTeW5jQ3Vyc29yKSA9PiBQcm9taXNlPHZvaWQ+fSBhcmdzLnNhdmVDdXJzb3IgLSBQZXJzaXN0cyB0aGUgZmluYWwgYWNrbm93bGVkZ2VkIGN1cnNvci5cbiAgICogQHBhcmFtIHsocGF5bG9hZDogU3luY0NoYW5nZXNSZXF1ZXN0KSA9PiBQcm9taXNlPFN5bmNDaGFuZ2VzUmVzcG9uc2U+fSBhcmdzLnBvc3RDaGFuZ2VzIC0gUG9zdHMgb25lIGNoYW5nZXMgcmVxdWVzdC5cbiAgICogQHBhcmFtIHsoc3luYzogU3luY0NoYW5nZUVudmVsb3BlKSA9PiBQcm9taXNlPFN5bmNDaGFuZ2VBcHBseVJlc3VsdD59IGFyZ3MuYXBwbHlTeW5jIC0gQXBwbGllcyBvbmUgbm9ybWFsaXplZCBzeW5jIHJvdyBsb2NhbGx5LlxuICAgKiBAcGFyYW0geyhwcm9ncmVzczogaW1wb3J0KFwiLi9zeW5jLWFwaS1jbGllbnQtdHlwZXMuanNcIikuU3luY1B1bGxQcm9ncmVzcykgPT4gdm9pZH0gW2FyZ3Mub25Qcm9ncmVzc10gLSBQcm9ncmVzcyBjYWxsYmFjayBpbnZva2VkIHBlciBhcHBsaWVkIHBhZ2UgKGFuZCBvbmNlIGZvciBhbiBlbXB0eSBwdWxsKSB3aXRoIHRoZSBhcHBsaWVkIGNvdW50cyBhbmQgdGhlIHN0YWJsZSBzZXJ2ZXIgdG90YWwuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFN5bmNDaGFuZ2VzUmVzdWx0Pn0gUHVsbCByZXN1bHQuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgcHVsbENoYW5nZXMoYXJncykge1xuICAgIGxldCBhZnRlckN1cnNvciA9IHRoaXMuc3luY0N1cnNvckZyb21QYXlsb2FkKGF3YWl0IGFyZ3MubG9hZEN1cnNvcigpKVxuICAgIGxldCB1cFRvQ3Vyc29yID0gbnVsbFxuICAgIGxldCBwYWdlcyA9IDBcbiAgICBsZXQgc3luY2VkQ291bnQgPSAwXG4gICAgbGV0IHRvdGFsID0gMFxuICAgIGxldCBjaGFuZ2VkID0gZmFsc2VcbiAgICBjb25zdCByZXNvdXJjZUNvdW50cyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gKi8gKHt9KVxuICAgIGNvbnN0IHJlc291cmNlQ2hhbmdlZCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgYm9vbGVhbj59ICovICh7fSlcbiAgICBjb25zdCBiYXRjaFNpemUgPSB0aGlzLm5vcm1hbGl6ZWRCYXRjaFNpemUoYXJncy5iYXRjaFNpemUpXG5cbiAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgY29uc3QgY2hhbmdlc1Jlc3BvbnNlID0gYXdhaXQgdGhpcy5jaGFuZ2VzUGFnZSh7Li4uYXJncywgYWZ0ZXJDdXJzb3IsIGJhdGNoU2l6ZSwgdXBUb0N1cnNvcn0pXG4gICAgICBjb25zdCBzeW5jcyA9IGNoYW5nZXNSZXNwb25zZS5zeW5jc1xuXG4gICAgICBpZiAoIXVwVG9DdXJzb3IpIHVwVG9DdXJzb3IgPSBjaGFuZ2VzUmVzcG9uc2UudXBUb0N1cnNvclxuXG4gICAgICAvLyBUaGUgc2VydmVyIGNvdW50cyBwZW5kaW5nIHJvd3MgZnJvbSB0aGlzIHJlcXVlc3QncyBjdXJzb3IsIHNvIGFscmVhZHktYXBwbGllZFxuICAgICAgLy8gcGFnZXMgcGx1cyB0aGlzIHJlcXVlc3QncyBjb3VudCBzdGF5cyB0aGUgc2FtZSB0b3RhbCBhY3Jvc3MgZXZlcnkgcGFnZTogYSBzdGFibGVcbiAgICAgIC8vIFwib2YgWVwiIGRlbm9taW5hdG9yIGV2ZW4gYXMgdGhlIGN1cnNvciBhZHZhbmNlcy4gQSBzZXJ2ZXIgdGhhdCBkb2Vzbid0IHJlcG9ydCB0aGVcbiAgICAgIC8vIGNvdW50IGF0IGFsbCBsZWF2ZXMgdGhlIHRvdGFsIGF0IDAgZm9yIGV2ZXJ5IHBhZ2UgcmF0aGVyIHRoYW4gZHJpZnRpbmcgdXB3YXJkc1xuICAgICAgLy8gd2l0aCB0aGUgYXBwbGllZCByb3dzLlxuICAgICAgaWYgKGNoYW5nZXNSZXNwb25zZS50b3RhbCAhPT0gbnVsbCkgdG90YWwgPSBzeW5jZWRDb3VudCArIGNoYW5nZXNSZXNwb25zZS50b3RhbFxuXG4gICAgICBpZiAoc3luY3MubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIC8vIFJlcG9ydCB0aGUgdGVybWluYWwgcHJvZ3Jlc3Mgb25jZSBmb3IgYW4gZW50aXJlbHkgZW1wdHkgcHVsbCBzbyBjb25zdW1lcnMgb2JzZXJ2ZVxuICAgICAgICAvLyB0b3RhbCAwOyBhIHB1bGwgdGhhdCBhbHJlYWR5IGFwcGxpZWQgcGFnZXMgcmVwb3J0ZWQgaXRzIGZpbmFsIGNvdW50cyBvbiBpdHMgbGFzdCBwYWdlLlxuICAgICAgICBpZiAocGFnZXMgPT09IDAgJiYgYXJncy5vblByb2dyZXNzKSBhcmdzLm9uUHJvZ3Jlc3Moe3BhZ2VzLCBzeW5jZWRDb3VudCwgdG90YWx9KVxuXG4gICAgICAgIGJyZWFrXG4gICAgICB9XG5cbiAgICAgIHBhZ2VzICs9IDFcblxuICAgICAgLy8gQ29hbGVzY2UgcmVjb3JkLWNoYW5nZSBldmVudHMgYWNyb3NzIHRoaXMgcGFnZSdzIGFwcGxpZXMgc28gTiBhcHBsaWVkIHJvd3MgdHJpZ2dlciBvbmVcbiAgICAgIC8vIGxpdmUtcXVlcnkgcmUtcnVuLiBPbmx5IHRoZSBhcHBseSBsb29wIGlzIGJhdGNoZWQ6IHRoZSBuZXR3b3JrIHBhZ2UgZmV0Y2ggYWJvdmUgYW5kIHRoZVxuICAgICAgLy8gY3Vyc29yIHNhdmUgYmVsb3cgc3RheSBvdXRzaWRlLCBzbyBsaXZlIHF1ZXJpZXMgZmx1c2ggcmlnaHQgYWZ0ZXIgdGhlIGFwcGxpZXMgaW5zdGVhZCBvZlxuICAgICAgLy8gd2FpdGluZyBmb3IgdGhlIHJlc3Qgb2YgdGhlIHB1bGwuXG4gICAgICBhd2FpdCByZWNvcmRDaGFuZ2VzLmJhdGNoKGFzeW5jICgpID0+IHtcbiAgICAgICAgZm9yIChjb25zdCBzeW5jIG9mIHN5bmNzKSB7XG4gICAgICAgICAgY29uc3QgYXBwbHlSZXN1bHQgPSBhd2FpdCBhcmdzLmFwcGx5U3luYyhzeW5jKVxuICAgICAgICAgIGNvbnN0IHJlc291cmNlVHlwZSA9IGFwcGx5UmVzdWx0LnJlc291cmNlVHlwZSA/PyBzeW5jLnJlc291cmNlVHlwZSgpXG5cbiAgICAgICAgICBjaGFuZ2VkIHx8PSBhcHBseVJlc3VsdC5jaGFuZ2VkID09PSB0cnVlXG4gICAgICAgICAgc3luY2VkQ291bnQgKz0gMVxuXG4gICAgICAgICAgaWYgKHJlc291cmNlVHlwZSkge1xuICAgICAgICAgICAgcmVzb3VyY2VDb3VudHNbcmVzb3VyY2VUeXBlXSA9IChyZXNvdXJjZUNvdW50c1tyZXNvdXJjZVR5cGVdIHx8IDApICsgMVxuICAgICAgICAgICAgcmVzb3VyY2VDaGFuZ2VkW3Jlc291cmNlVHlwZV0gfHw9IGFwcGx5UmVzdWx0LmNoYW5nZWQgPT09IHRydWVcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0pXG5cbiAgICAgIGFmdGVyQ3Vyc29yID0gY2hhbmdlc1Jlc3BvbnNlLm5leHRDdXJzb3JcblxuICAgICAgaWYgKGFyZ3Mub25Qcm9ncmVzcykgYXJncy5vblByb2dyZXNzKHtwYWdlcywgc3luY2VkQ291bnQsIHRvdGFsfSlcbiAgICAgIGlmIChzeW5jcy5sZW5ndGggPCBiYXRjaFNpemUpIGJyZWFrXG4gICAgfVxuXG4gICAgaWYgKGFmdGVyQ3Vyc29yKSBhd2FpdCBhcmdzLnNhdmVDdXJzb3IoYWZ0ZXJDdXJzb3IpXG5cbiAgICByZXR1cm4ge2NoYW5nZWQsIHBhZ2VzLCByZXNvdXJjZUNoYW5nZWQsIHJlc291cmNlQ291bnRzLCBzeW5jZWRDb3VudCwgdG90YWx9XG4gIH1cblxuICAvKipcbiAgICogRmV0Y2hlcyBhbmQgdmFsaWRhdGVzIG9uZSBiYWNrZW5kIHN5bmMgY2hhbmdlcyBwYWdlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFBhZ2UgYXJncy5cbiAgICogQHBhcmFtIHtTeW5jQ3Vyc29yfSBhcmdzLmFmdGVyQ3Vyc29yIC0gTGFzdCBhY2tub3dsZWRnZWQgY3Vyc29yLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5hdXRoZW50aWNhdGlvblRva2VuIC0gQXV0aCB0b2tlbi5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MuYmF0Y2hTaXplIC0gUGFnZSBzaXplLlxuICAgKiBAcGFyYW0geyhwYXlsb2FkOiBTeW5jQ2hhbmdlc1JlcXVlc3QpID0+IFByb21pc2U8U3luY0NoYW5nZXNSZXNwb25zZT59IGFyZ3MucG9zdENoYW5nZXMgLSBDaGFuZ2VzIHBvc3Rlci5cbiAgICogQHBhcmFtIHtTeW5jQ3Vyc29yfSBhcmdzLnVwVG9DdXJzb3IgLSBTbmFwc2hvdCB1cHBlci1ib3VuZCBjdXJzb3IuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHtuZXh0Q3Vyc29yOiBTeW5jQ3Vyc29yLCBzeW5jczogU3luY0NoYW5nZUVudmVsb3BlW10sIHRvdGFsOiBudW1iZXIgfCBudWxsLCB1cFRvQ3Vyc29yOiBTeW5jQ3Vyc29yfT59IE5vcm1hbGl6ZWQgY2hhbmdlcyBwYWdlLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGNoYW5nZXNQYWdlKHthZnRlckN1cnNvciwgYXV0aGVudGljYXRpb25Ub2tlbiwgYmF0Y2hTaXplLCBwb3N0Q2hhbmdlcywgdXBUb0N1cnNvcn0pIHtcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHBvc3RDaGFuZ2VzKHtcbiAgICAgIGF1dGhlbnRpY2F0aW9uVG9rZW4sXG4gICAgICBsaW1pdDogYmF0Y2hTaXplLFxuICAgICAgLi4udGhpcy5jdXJzb3JQYXlsb2FkKFwiYWZ0ZXJcIiwgYWZ0ZXJDdXJzb3IpLFxuICAgICAgLi4udGhpcy5jdXJzb3JQYXlsb2FkKFwidXBUb1wiLCB1cFRvQ3Vyc29yKVxuICAgIH0pXG5cbiAgICB0aGlzLmVuc3VyZVN1Y2Nlc3NmdWxDaGFuZ2VzUmVzcG9uc2UocmVzcG9uc2UpXG5cbiAgICBjb25zdCBzeW5jcyA9IC8qKiBAdHlwZSB7dW5rbm93bltdfSAqLyAocmVzcG9uc2Uuc3luY3MpXG5cbiAgICByZXR1cm4ge1xuICAgICAgbmV4dEN1cnNvcjogdGhpcy5zeW5jQ3Vyc29yRnJvbVBheWxvYWQocmVzcG9uc2UubmV4dEN1cnNvciA/PyBudWxsKSxcbiAgICAgIHN5bmNzOiBzeW5jcy5tYXAoKHN5bmNQYXlsb2FkKSA9PiB0aGlzLnN5bmNFbnZlbG9wZUZyb21QYXlsb2FkKHN5bmNQYXlsb2FkKSksXG4gICAgICB0b3RhbDogb3B0aW9uYWxJbnRlZ2VyKHJlc3BvbnNlLnRvdGFsKSxcbiAgICAgIHVwVG9DdXJzb3I6IHRoaXMuc3luY0N1cnNvckZyb21QYXlsb2FkKHJlc3BvbnNlLnVwVG9DdXJzb3IgPz8gbnVsbClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ2hlY2tzIEFQSSByZXNwb25zZSBzdGF0dXMgYW5kIHNoYXBlIGZvciBjaGFuZ2UtZmVlZCBwdWxscy5cbiAgICogQHBhcmFtIHtTeW5jQ2hhbmdlc1Jlc3BvbnNlfSByZXNwb25zZSAtIENoYW5nZXMgcmVzcG9uc2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIGVuc3VyZVN1Y2Nlc3NmdWxDaGFuZ2VzUmVzcG9uc2UocmVzcG9uc2UpIHtcbiAgICBpZiAocmVzcG9uc2Uuc3RhdHVzID09PSBcImVycm9yXCIpIHRocm93IG5ldyBFcnJvcihyZXNwb25zZS5lcnJvck1lc3NhZ2UgfHwgXCJTeW5jIGNoYW5nZXMgZmFpbGVkXCIpXG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHJlc3BvbnNlLnN5bmNzKSkgdGhyb3cgbmV3IEVycm9yKFwiU3luYyBjaGFuZ2VzIHJlc3BvbnNlIG1pc3Npbmcgc3luY3NcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBDb252ZXJ0cyBhIGN1cnNvciBpbnRvIHJlcXVlc3QgcGFyYW1zIHdpdGggdGhlIGdpdmVuIHByZWZpeC5cbiAgICogQHBhcmFtIHtcImFmdGVyXCIgfCBcInVwVG9cIn0gcHJlZml4IC0gUmVxdWVzdCBmaWVsZCBwcmVmaXguXG4gICAqIEBwYXJhbSB7U3luY0N1cnNvcn0gY3Vyc29yIC0gQ3Vyc29yIHRvIHNlcmlhbGl6ZS5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHN0cmluZyB8IG51bWJlciB8IG51bGw+fSBSZXF1ZXN0IHBhcmFtcy5cbiAgICovXG4gIHN0YXRpYyBjdXJzb3JQYXlsb2FkKHByZWZpeCwgY3Vyc29yKSB7XG4gICAgaWYgKCFjdXJzb3IpIHJldHVybiB7fVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIFtgJHtwcmVmaXh9SWRgXTogY3Vyc29yLmlkLFxuICAgICAgLi4uKGN1cnNvci5zZXJ2ZXJTZXF1ZW5jZSA/IHtbYCR7cHJlZml4fVNlcnZlclNlcXVlbmNlYF06IGN1cnNvci5zZXJ2ZXJTZXF1ZW5jZX0gOiB7fSksXG4gICAgICBbYCR7cHJlZml4fVVwZGF0ZWRBdGBdOiBjdXJzb3IudXBkYXRlZEF0XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFBhcnNlcyBhIHBlcnNpc3RlZCBvciByZXNwb25zZSBjdXJzb3IgcGF5bG9hZC5cbiAgICogQHBhcmFtIHtTeW5jQ3Vyc29yIHwgc3RyaW5nIHwgUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgbnVsbCB8IHVuZGVmaW5lZH0gcGF5bG9hZCAtIEN1cnNvciBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7U3luY0N1cnNvcn0gUGFyc2VkIGN1cnNvci5cbiAgICovXG4gIHN0YXRpYyBzeW5jQ3Vyc29yRnJvbVBheWxvYWQocGF5bG9hZCkge1xuICAgIGlmICghcGF5bG9hZCkgcmV0dXJuIG51bGxcblxuICAgIGlmICh0eXBlb2YgcGF5bG9hZCA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgdHJ5IHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc3luY0N1cnNvckZyb21QYXlsb2FkKEpTT04ucGFyc2UocGF5bG9hZCkpXG4gICAgICB9IGNhdGNoIChfZXJyb3IpIHtcbiAgICAgICAgcmV0dXJuIHtpZDogbnVsbCwgc2VydmVyU2VxdWVuY2U6IG51bGwsIHVwZGF0ZWRBdDogcGF5bG9hZH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIHBheWxvYWQgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShwYXlsb2FkKSkgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IHVwZGF0ZWRBdCA9IHR5cGVvZiBwYXlsb2FkLnVwZGF0ZWRBdCA9PT0gXCJzdHJpbmdcIiA/IHBheWxvYWQudXBkYXRlZEF0IDogbnVsbFxuXG4gICAgaWYgKCF1cGRhdGVkQXQpIHJldHVybiBudWxsXG5cbiAgICByZXR1cm4ge1xuICAgICAgaWQ6IHBheWxvYWQuaWQgPT09IG51bGwgfHwgcGF5bG9hZC5pZCA9PT0gdW5kZWZpbmVkID8gbnVsbCA6IFN0cmluZyhwYXlsb2FkLmlkKSxcbiAgICAgIHNlcnZlclNlcXVlbmNlOiBvcHRpb25hbEludGVnZXIocGF5bG9hZC5zZXJ2ZXJTZXF1ZW5jZSA9PT0gXCJcIiA/IG51bGwgOiBwYXlsb2FkLnNlcnZlclNlcXVlbmNlKSxcbiAgICAgIHVwZGF0ZWRBdFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgYSBub3JtYWxpemVkIHN5bmMgcm93IGFkYXB0ZXIuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHBheWxvYWQgLSBSYXcgc3luYyBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7U3luY0NoYW5nZUVudmVsb3BlfSBTeW5jIHJvdyBhZGFwdGVyLlxuICAgKi9cbiAgc3RhdGljIHN5bmNFbnZlbG9wZUZyb21QYXlsb2FkKHBheWxvYWQpIHtcbiAgICBpZiAoIXBheWxvYWQgfHwgdHlwZW9mIHBheWxvYWQgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShwYXlsb2FkKSkgdGhyb3cgbmV3IEVycm9yKFwiU3luYyBjaGFuZ2VzIGVudHJ5IG11c3QgYmUgYW4gb2JqZWN0XCIpXG5cbiAgICBjb25zdCBzeW5jUGF5bG9hZCA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAocGF5bG9hZClcblxuICAgIHJldHVybiB7XG4gICAgICBkYXRhOiAoKSA9PiBzeW5jUGF5bG9hZC5kYXRhLFxuICAgICAgaWQ6ICgpID0+IHN5bmNQYXlsb2FkLmlkLFxuICAgICAgcmVzb3VyY2VJZDogKCkgPT4gc3luY1BheWxvYWQucmVzb3VyY2VJZCxcbiAgICAgIHJlc291cmNlVHlwZTogKCkgPT4gc3luY1BheWxvYWQucmVzb3VyY2VUeXBlID09PSBudWxsIHx8IHN5bmNQYXlsb2FkLnJlc291cmNlVHlwZSA9PT0gdW5kZWZpbmVkID8gbnVsbCA6IFN0cmluZyhzeW5jUGF5bG9hZC5yZXNvdXJjZVR5cGUpLFxuICAgICAgc3luY1R5cGU6ICgpID0+IHN5bmNQYXlsb2FkLnN5bmNUeXBlID09PSBudWxsIHx8IHN5bmNQYXlsb2FkLnN5bmNUeXBlID09PSB1bmRlZmluZWQgPyBcIlwiIDogU3RyaW5nKHN5bmNQYXlsb2FkLnN5bmNUeXBlKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgYW4gYXBwLWNvbmZpZ3VyZWQgcmVzb3VyY2UgYXBwbGllciBmb3IgcHVsbGVkIHN5bmMgcm93cy4gVGhlIHN5bmNcbiAgICogbWVjaGFuaWNzIHN0YXkgaGVyZTsgYXBwcyBvbmx5IGRlY2xhcmUgd2hpY2ggbW9kZWxzL2F0dHJpYnV0ZXMvaG9va3MgYXJlXG4gICAqIGFsbG93ZWQgZm9yIGVhY2ggcmVzb3VyY2UgdHlwZS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBTeW5jUmVzb3VyY2VDb25maWc+fSByZXNvdXJjZXMgLSBSZXNvdXJjZSBwb2xpY3kgbWFwLlxuICAgKiBAcGFyYW0geyhyZWNvcmQ6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+KSA9PiAoKSA9PiB2b2lkfSBbb25SZWNvcmRdIC0gQ2FsbGVkIHdpdGggZWFjaCByZWNvcmQgYWJvdXQgdG8gYmUgd3JpdHRlbjsgcmV0dXJucyBhIHJlbGVhc2UgY2FsbGJhY2sgaW52b2tlZCBhZnRlciB0aGUgd3JpdGUgKHVzZWQgZm9yIGVjaG8gc3VwcHJlc3Npb24pLlxuICAgKiBAcmV0dXJucyB7KHN5bmM6IFN5bmNDaGFuZ2VFbnZlbG9wZSkgPT4gUHJvbWlzZTxTeW5jQ2hhbmdlQXBwbHlSZXN1bHQ+fSBTeW5jIGFwcGx5IGNhbGxiYWNrLlxuICAgKi9cbiAgc3RhdGljIHJlc291cmNlQXBwbGllcihyZXNvdXJjZXMsIG9uUmVjb3JkKSB7XG4gICAgcmV0dXJuIGFzeW5jIChzeW5jKSA9PiBhd2FpdCB0aGlzLmFwcGx5UmVzb3VyY2VTeW5jKHtvblJlY29yZCwgcmVzb3VyY2VzLCBzeW5jfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBsaWVzIG9uZSBzeW5jIHJvdyB1c2luZyBkZWNsYXJhdGl2ZSByZXNvdXJjZSBwb2xpY3kuXG4gICAqIEBwYXJhbSB7e3Jlc291cmNlczogUmVjb3JkPHN0cmluZywgU3luY1Jlc291cmNlQ29uZmlnPiwgc3luYzogU3luY0NoYW5nZUVudmVsb3BlLCBvblJlY29yZD86IChyZWNvcmQ6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+KSA9PiAoKSA9PiB2b2lkfX0gYXJncyAtIEFwcGx5IGFyZ3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFN5bmNDaGFuZ2VBcHBseVJlc3VsdD59IEFwcGx5IHJlc3VsdC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBhcHBseVJlc291cmNlU3luYyh7b25SZWNvcmQsIHJlc291cmNlcywgc3luY30pIHtcbiAgICBjb25zdCByZXNvdXJjZVR5cGUgPSBzeW5jLnJlc291cmNlVHlwZSgpXG4gICAgY29uc3QgcmVzb3VyY2UgPSByZXNvdXJjZVR5cGUgPyByZXNvdXJjZXNbcmVzb3VyY2VUeXBlXSA6IHVuZGVmaW5lZFxuXG4gICAgaWYgKCFyZXNvdXJjZSB8fCAhcmVzb3VyY2UuZW5hYmxlZCkgcmV0dXJuIHtjaGFuZ2VkOiBmYWxzZSwgcmVzb3VyY2VUeXBlfVxuXG4gICAgaWYgKHN5bmMuc3luY1R5cGUoKSA9PT0gXCJkZWxldGVcIikge1xuICAgICAgcmV0dXJuIHtjaGFuZ2VkOiBhd2FpdCB0aGlzLmRlc3Ryb3lTeW5jZWRSZXNvdXJjZSh7b25SZWNvcmQsIHJlc291cmNlLCBzeW5jfSksIHJlc291cmNlVHlwZX1cbiAgICB9XG5cbiAgICBjb25zdCBkYXRhID0gdGhpcy5zeW5jRGF0YShzeW5jKVxuICAgIGNvbnN0IHJlY29yZCA9IHJlc291cmNlLmZpbmRSZWNvcmQgPyBhd2FpdCByZXNvdXJjZS5maW5kUmVjb3JkKHtkYXRhLCByZXNvdXJjZUlkOiBzeW5jLnJlc291cmNlSWQoKSwgc3luY30pIDogYXdhaXQgcmVzb3VyY2UubW9kZWxDbGFzcy5maW5kT3JJbml0aWFsaXplQnkoe2lkOiBkYXRhLmlkID8/IHN5bmMucmVzb3VyY2VJZCgpfSlcbiAgICBjb25zdCBhdHRyaWJ1dGVzID0gYXdhaXQgcmVzb3VyY2UuYXR0cmlidXRlcyh7ZGF0YSwgcmVjb3JkLCBzeW5jfSlcbiAgICBjb25zdCByZWxlYXNlUmVjb3JkID0gb25SZWNvcmQgPyBvblJlY29yZChyZWNvcmQpIDogbnVsbFxuICAgIGxldCBjaGFuZ2VkID0gZmFsc2VcblxuICAgIHRyeSB7XG4gICAgICByZWNvcmQuYXNzaWduKGF0dHJpYnV0ZXMpXG5cbiAgICAgIGlmIChyZWNvcmQuaXNDaGFuZ2VkKCkpIHtcbiAgICAgICAgYXdhaXQgcmVjb3JkLnNhdmUoKVxuICAgICAgICBjaGFuZ2VkID0gdHJ1ZVxuICAgICAgfVxuXG4gICAgICBpZiAocmVzb3VyY2UuYWZ0ZXJBcHBseSkge1xuICAgICAgICBjb25zdCBob29rQ2hhbmdlZCA9IGF3YWl0IHJlc291cmNlLmFmdGVyQXBwbHkoe2F0dHJpYnV0ZXMsIGRhdGEsIHJlY29yZCwgc3luY30pXG5cbiAgICAgICAgY2hhbmdlZCB8fD0gaG9va0NoYW5nZWQgPT09IHRydWVcbiAgICAgIH1cbiAgICB9IGZpbmFsbHkge1xuICAgICAgaWYgKHJlbGVhc2VSZWNvcmQpIHJlbGVhc2VSZWNvcmQoKVxuICAgIH1cblxuICAgIHJldHVybiB7Y2hhbmdlZCwgcmVzb3VyY2VUeXBlfVxuICB9XG5cbiAgLyoqXG4gICAqIERlc3Ryb3lzIGEgc3luY2VkIHJlc291cmNlIHZpYSBpdHMgZGVjbGFyZWQgbW9kZWwgcG9saWN5LlxuICAgKiBAcGFyYW0ge3tyZXNvdXJjZTogU3luY1Jlc291cmNlQ29uZmlnLCBzeW5jOiBTeW5jQ2hhbmdlRW52ZWxvcGUsIG9uUmVjb3JkPzogKHJlY29yZDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4pID0+ICgpID0+IHZvaWR9fSBhcmdzIC0gRGVzdHJveSBhcmdzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gV2hldGhlciBhIGxvY2FsIHJvdyB3YXMgZGVzdHJveWVkLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGRlc3Ryb3lTeW5jZWRSZXNvdXJjZSh7b25SZWNvcmQsIHJlc291cmNlLCBzeW5jfSkge1xuICAgIGNvbnN0IGlkID0gc3luYy5yZXNvdXJjZUlkKClcbiAgICBjb25zdCByZWNvcmQgPSByZXNvdXJjZS5maW5kUmVjb3JkRm9yRGVsZXRlID8gYXdhaXQgcmVzb3VyY2UuZmluZFJlY29yZEZvckRlbGV0ZSh7cmVzb3VyY2VJZDogaWQsIHN5bmN9KSA6IGF3YWl0IHJlc291cmNlLm1vZGVsQ2xhc3MuZmluZEJ5KHtpZH0pXG5cbiAgICBpZiAoIXJlY29yZCkgcmV0dXJuIGZhbHNlXG5cbiAgICBjb25zdCByZWxlYXNlUmVjb3JkID0gb25SZWNvcmQgPyBvblJlY29yZChyZWNvcmQpIDogbnVsbFxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHJlY29yZC5kZXN0cm95KClcbiAgICB9IGZpbmFsbHkge1xuICAgICAgaWYgKHJlbGVhc2VSZWNvcmQpIHJlbGVhc2VSZWNvcmQoKVxuICAgIH1cblxuICAgIHJldHVybiB0cnVlXG4gIH1cblxuICAvKipcbiAgICogUGFyc2VzIHRoZSBlbWJlZGRlZCBzeW5jIGRhdGEgSlNPTi9vYmplY3QuXG4gICAqIEBwYXJhbSB7U3luY0NoYW5nZUVudmVsb3BlfSBzeW5jIC0gU3luYyByb3cuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn0gU3luYyBkYXRhIG9iamVjdC5cbiAgICovXG4gIHN0YXRpYyBzeW5jRGF0YShzeW5jKSB7XG4gICAgY29uc3QgZGF0YSA9IHN5bmMuZGF0YSgpXG5cbiAgICBpZiAoIWRhdGEpIHRocm93IG5ldyBFcnJvcihgU3luYyAke3N5bmMuaWQoKX0gaXMgbWlzc2luZyBkYXRhYClcbiAgICBpZiAodHlwZW9mIGRhdGEgPT09IFwic3RyaW5nXCIpIHJldHVybiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSAqLyAoSlNPTi5wYXJzZShkYXRhKSlcbiAgICBpZiAodHlwZW9mIGRhdGEgPT09IFwib2JqZWN0XCIgJiYgIUFycmF5LmlzQXJyYXkoZGF0YSkpIHJldHVybiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSAqLyAoZGF0YSlcblxuICAgIHRocm93IG5ldyBFcnJvcihgU3luYyAke3N5bmMuaWQoKX0gaGFzIGludmFsaWQgZGF0YWApXG4gIH1cblxuICAvKipcbiAgICogRHJhaW5zIHBlbmRpbmcgc3luYyByZWNvcmRzIGZyb20gYSBsb2NhbCBWZWxvY2lvdXMgbW9kZWwgaW4gc3RhYmxlIG9yZGVyLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFJlcGxheSBhcmdzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5hdXRoZW50aWNhdGlvblRva2VuIC0gQXV0aCB0b2tlbiB0byBzZW5kIHdpdGggcmVwbGF5IHJlcXVlc3RzLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuYmF0Y2hTaXplXSAtIE1heCBzeW5jcyBwZXIgcmVxdWVzdC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5zeW5jTW9kZWwgLSBMb2NhbCBTeW5jIG1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0geyhwYXlsb2FkOiB7YXV0aGVudGljYXRpb25Ub2tlbjogc3RyaW5nLCBzeW5jczogQXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0pID0+IFByb21pc2U8U3luY1JlcGxheVJlc3BvbnNlPn0gYXJncy5wb3N0UmVwbGF5IC0gUmVwbGF5IHBvc3Rlci5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBzdGF0aWMgYXN5bmMgcmVwbGF5TG9jYWxTeW5jcyhhcmdzKSB7XG4gICAgY29uc3QgcG9zdGVkU25hcHNob3RzQnlTeW5jSWQgPSBuZXcgTWFwKClcblxuICAgIGF3YWl0IHRoaXMucmVwbGF5UGVuZGluZyh7XG4gICAgICBhdXRoZW50aWNhdGlvblRva2VuOiBhcmdzLmF1dGhlbnRpY2F0aW9uVG9rZW4sXG4gICAgICBiYXRjaFNpemU6IGFyZ3MuYmF0Y2hTaXplLFxuICAgICAgbWFya1N1Y2Nlc3NmdWw6IGFzeW5jIChzeW5jKSA9PiB7XG4gICAgICAgIGNvbnN0IHN5bmNJZCA9ICgvKiogQHR5cGUge3tpZDogKCkgPT4gc3RyaW5nIHwgbnVtYmVyIHwgbnVsbCB8IHVuZGVmaW5lZH19ICovIChzeW5jKSkuaWQoKVxuICAgICAgICAvLyBSZWxvYWQgd2l0aCB0aGUgcmVzb3VyY2UgcHJlbG9hZGVkIHNvIHJvd3MgcmVseWluZyBvbiB0aGUgcmVzb3VyY2UtYXR0cmlidXRlc1xuICAgICAgICAvLyBmYWxsYmFjayBpbiBsb2NhbFN5bmNEYXRhIGNvbXBhcmUgYWdhaW5zdCB0aGUgc2FtZSBzbmFwc2hvdCB0aGV5IHBvc3RlZC5cbiAgICAgICAgY29uc3QgY3VycmVudFN5bmMgPSBhd2FpdCBhcmdzLnN5bmNNb2RlbC5wcmVsb2FkKHtyZXNvdXJjZTogdHJ1ZX0pLndoZXJlKHtpZDogc3luY0lkfSkuZmlyc3QoKVxuXG4gICAgICAgIGlmICghY3VycmVudFN5bmMpIHJldHVyblxuICAgICAgICAvLyBBIHJvdyBlZGl0ZWQgd2hpbGUgaXRzIG9sZCBwYXlsb2FkIHdhcyBpbiBmbGlnaHQgc3RheXMgcGVuZGluZywgc28gdGhlXG4gICAgICAgIC8vIG5ld2VyIGxvY2FsIGNoYW5nZSByZXBsYXlzIG9uIHRoZSBuZXh0IGRyYWluIGluc3RlYWQgb2YgYmVpbmcgbG9zdC5cbiAgICAgICAgaWYgKHRoaXMubG9jYWxTeW5jUmVwbGF5U25hcHNob3QoY3VycmVudFN5bmMpICE9PSBwb3N0ZWRTbmFwc2hvdHNCeVN5bmNJZC5nZXQoU3RyaW5nKHN5bmNJZCkpKSByZXR1cm5cblxuICAgICAgICBhd2FpdCBjdXJyZW50U3luYy51cGRhdGUoe3N0YXRlOiBcInN1Y2Nlc3NcIn0pXG4gICAgICB9LFxuICAgICAgcGVuZGluZ1N5bmNzOiBhc3luYyAoKSA9PiBhd2FpdCBhcmdzLnN5bmNNb2RlbC5wcmVsb2FkKHtyZXNvdXJjZTogdHJ1ZX0pLndoZXJlKHtzdGF0ZTogXCJwZW5kaW5nXCJ9KS5vcmRlcihcImNyZWF0ZWRfYXRcIikudG9BcnJheSgpLFxuICAgICAgcG9zdFJlcGxheTogYXJncy5wb3N0UmVwbGF5LFxuICAgICAgc3luY0lkOiAoc3luYykgPT4gKC8qKiBAdHlwZSB7e2lkOiAoKSA9PiBzdHJpbmcgfCBudW1iZXIgfCBudWxsIHwgdW5kZWZpbmVkfX0gKi8gKHN5bmMpKS5pZCgpLFxuICAgICAgc3luY1BheWxvYWQ6IChzeW5jKSA9PiB7XG4gICAgICAgIHBvc3RlZFNuYXBzaG90c0J5U3luY0lkLnNldChTdHJpbmcoKC8qKiBAdHlwZSB7e2lkOiAoKSA9PiBzdHJpbmcgfCBudW1iZXIgfCBudWxsIHwgdW5kZWZpbmVkfX0gKi8gKHN5bmMpKS5pZCgpKSwgdGhpcy5sb2NhbFN5bmNSZXBsYXlTbmFwc2hvdChzeW5jKSlcblxuICAgICAgICByZXR1cm4gdGhpcy5sb2NhbFN5bmNQYXlsb2FkKHN5bmMpXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBTZXJpYWxpemVzIHRoZSByZXBsYXktcmVsZXZhbnQgc3RhdGUgb2YgYSBsb2NhbCBzeW5jIHJvdyBmb3IgaW4tZmxpZ2h0IGNvbXBhcmlzb25zLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBzeW5jIC0gTG9jYWwgc3luYyByb3cuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IFN0YWJsZSBzbmFwc2hvdCBvZiB0aGUgcm93J3MgcmVwbGF5ZWQgcGF5bG9hZC5cbiAgICovXG4gIHN0YXRpYyBsb2NhbFN5bmNSZXBsYXlTbmFwc2hvdChzeW5jKSB7XG4gICAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KHtkYXRhOiB0aGlzLmxvY2FsU3luY0RhdGEoc3luYyksIHN5bmNUeXBlOiBzeW5jLnN5bmNUeXBlKCl9KVxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBvbmUgcmVwbGF5IGVudmVsb3BlIGZyb20gYSBsb2NhbCBzeW5jIHJvdy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gc3luYyAtIExvY2FsIHN5bmMgcm93LlxuICAgKiBAcmV0dXJucyB7e2NsaWVudFVwZGF0ZWRBdD86IHN0cmluZywgZGF0YTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4sIGlkOiBudW1iZXIsIHJlc291cmNlSWQ6IHN0cmluZywgcmVzb3VyY2VUeXBlOiBzdHJpbmcsIHN5bmNUeXBlOiBzdHJpbmd9fSBTeW5jIHJlcGxheSBlbnZlbG9wZS5cbiAgICovXG4gIHN0YXRpYyBsb2NhbFN5bmNQYXlsb2FkKHN5bmMpIHtcbiAgICBjb25zdCBjbGllbnRVcGRhdGVkQXQgPSBzeW5jLnVwZGF0ZWRBdCgpIHx8IHN5bmMuY3JlYXRlZEF0KClcblxuICAgIHJldHVybiB7XG4gICAgICBjbGllbnRVcGRhdGVkQXQ6IGNsaWVudFVwZGF0ZWRBdCA/IGNsaWVudFVwZGF0ZWRBdC50b0lTT1N0cmluZygpIDogdW5kZWZpbmVkLFxuICAgICAgZGF0YTogdGhpcy5sb2NhbFN5bmNEYXRhKHN5bmMpLFxuICAgICAgaWQ6IC8qKiBAdHlwZSB7bnVtYmVyfSAqLyAoLyoqIEB0eXBlIHt1bmtub3dufSAqLyAoc3luYy5pZCgpKSksXG4gICAgICByZXNvdXJjZUlkOiBTdHJpbmcoc3luYy5yZXNvdXJjZUlkKCkpLFxuICAgICAgcmVzb3VyY2VUeXBlOiBzeW5jLnJlc291cmNlVHlwZSgpIHx8IFwiXCIsXG4gICAgICBzeW5jVHlwZTogc3luYy5zeW5jVHlwZSgpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIG9uZSBsb2NhbCBzeW5jIHJvdyBwYXlsb2FkLCBmYWxsaW5nIGJhY2sgdG8gcHJlbG9hZGVkIHJlc291cmNlIGF0dHJpYnV0ZXMuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHN5bmMgLSBMb2NhbCBzeW5jIHJvdy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSBTeW5jIGRhdGEuXG4gICAqL1xuICBzdGF0aWMgbG9jYWxTeW5jRGF0YShzeW5jKSB7XG4gICAgbGV0IHN5bmNEYXRhID0gLyoqIEB0eXBlIHtzdHJpbmcgfCBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPn0gKi8gKHN5bmMuZGF0YSgpIHx8IHt9KVxuXG4gICAgaWYgKHR5cGVvZiBzeW5jRGF0YSA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgdHJ5IHtcbiAgICAgICAgc3luY0RhdGEgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSAqLyAoSlNPTi5wYXJzZShzeW5jRGF0YSkpXG4gICAgICB9IGNhdGNoIChfZXJyb3IpIHtcbiAgICAgICAgc3luY0RhdGEgPSB7fVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChPYmplY3Qua2V5cyhzeW5jRGF0YSkubGVuZ3RoID4gMCkgcmV0dXJuIHN5bmNEYXRhXG5cbiAgICB0cnkge1xuICAgICAgcmV0dXJuIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59ICovIChzeW5jLnJlc291cmNlKCkuYXR0cmlidXRlcygpKVxuICAgIH0gY2F0Y2ggKF9lcnJvcikge1xuICAgICAgcmV0dXJuIHt9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFF1ZXVlcyBhIGxvY2FsIHN5bmMgcm93IGZvciBhIFZlbG9jaW91cyBtb2RlbCByZXNvdXJjZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBRdWV1ZSBhcmdzLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLnJlc291cmNlIC0gUmVzb3VyY2UgYmVpbmcgc3luY2VkLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLnN5bmNNb2RlbCAtIExvY2FsIFN5bmMgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59IFthcmdzLmRhdGFdIC0gRXhwbGljaXQgc3luYyBkYXRhLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3Muc3luY1R5cGVdIC0gU3luYyBvcGVyYXRpb24gdHlwZS5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gW2FyZ3MubG9jYWxPbmx5QXR0cmlidXRlc10gLSBBdHRyaWJ1dGVzIHRvIHN0cmlwIGZyb20gcXVldWVkIHBheWxvYWRzLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBbYXJncy5ib29sZWFuQXR0cmlidXRlc10gLSBBdHRyaWJ1dGVzIHRvIGNvZXJjZSB0aHJvdWdoIHN5bmMgYm9vbGVhbiBwYXJzaW5nLlxuICAgKiBAcGFyYW0geyhkYXRhOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikgPT4gUmVjb3JkPHN0cmluZywgdW5rbm93bj59IFthcmdzLm5vcm1hbGl6ZURhdGFdIC0gQXBwLXNwZWNpZmljIGRhdGEgbm9ybWFsaXplci5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBMb2NhbCBzeW5jIHJvdy5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBxdWV1ZUxvY2FsU3luYyhhcmdzKSB7XG4gICAgY29uc3QgcmVzb3VyY2VSZWNvcmRJZCA9IHNjYWxhck1vZGVsUHJpbWFyeUtleVZhbHVlKGFyZ3MucmVzb3VyY2UuaWQoKSwgXCJMb2NhbCBzeW5jIHF1ZXVlaW5nXCIpXG4gICAgY29uc3QgbW9kZWxDbGFzcyA9IGFyZ3MucmVzb3VyY2UuY29uc3RydWN0b3JcblxuICAgIGlmICh0eXBlb2YgbW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUgIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiVGhlIHJlc291cmNlIG1vZGVsIGNsYXNzIG11c3QgaW1wbGVtZW50IHN0YXRpYyBnZXRNb2RlbE5hbWUoKSB0byBxdWV1ZSBzeW5jIGRhdGEgLSBjbGFzcyBuYW1lcyBhcmUgbm90IHN0YWJsZSBhY3Jvc3MgZXhwbGljaXQgbW9kZWwgbmFtZXMgYW5kIG1pbmlmaWVkIGJ1bmRsZXNcIilcbiAgICB9XG5cbiAgICBjb25zdCByZXNvdXJjZVR5cGUgPSBtb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpXG4gICAgY29uc3Qgc3luY0RhdGEgPSB0aGlzLnF1ZXVlZFN5bmNEYXRhKGFyZ3MpXG4gICAgY29uc3Qgc3luY1R5cGUgPSBhcmdzLnN5bmNUeXBlIHx8IFwidXBkYXRlXCJcblxuICAgIGlmICghcmVzb3VyY2VSZWNvcmRJZCkgdGhyb3cgbmV3IEVycm9yKFwicmVzb3VyY2UuaWQoKSBpcyByZXF1aXJlZCB0byBxdWV1ZSBzeW5jIGRhdGFcIilcblxuICAgIGNvbnN0IHJlc291cmNlSWQgPSBTdHJpbmcocmVzb3VyY2VSZWNvcmRJZClcbiAgICBjb25zdCBleGlzdGluZ1N5bmMgPSBhd2FpdCBhcmdzLnN5bmNNb2RlbC5maW5kQnkoe3Jlc291cmNlSWQsIHJlc291cmNlVHlwZX0pXG5cbiAgICBpZiAoZXhpc3RpbmdTeW5jKSB7XG4gICAgICBhd2FpdCBleGlzdGluZ1N5bmMudXBkYXRlKHtcbiAgICAgICAgZGF0YTogc3luY0RhdGEsXG4gICAgICAgIHN0YXRlOiBcInBlbmRpbmdcIixcbiAgICAgICAgc3luY1R5cGVcbiAgICAgIH0pXG5cbiAgICAgIHJldHVybiBleGlzdGluZ1N5bmNcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgYXJncy5zeW5jTW9kZWwuY3JlYXRlKHtcbiAgICAgIGRhdGE6IHN5bmNEYXRhLFxuICAgICAgcmVzb3VyY2VJZCxcbiAgICAgIHJlc291cmNlVHlwZSxcbiAgICAgIHN0YXRlOiBcInBlbmRpbmdcIixcbiAgICAgIHN5bmNUeXBlXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgYmFja2VuZC1zYWZlIHF1ZXVlZCBzeW5jIGRhdGEgd2l0aG91dCBtdXRhdGluZyBjYWxsZXIgZGF0YS4gVGhlIGRlZmF1bHRcbiAgICogKG5vIGV4cGxpY2l0IGBkYXRhYCkgaXMgdGhlIHJlc291cmNlJ3MgYXR0cmlidXRlcyBtaW51cyBsb2NhbC1vbmx5IGF0dHJpYnV0ZXMsXG4gICAqIHdpdGggYm9vbGVhbnMgY29lcmNlZCBhbmQgRGF0ZSB2YWx1ZXMgc2VyaWFsaXplZCB0byBJU08gc3RyaW5ncywgc28gYXBwcyBkb24ndFxuICAgKiBuZWVkIHBlci1tb2RlbCB0cmFja2VkLXBheWxvYWQgYnVpbGRlcnMuXG4gICAqIEBwYXJhbSB7e3Jlc291cmNlOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgZGF0YT86IFJlY29yZDxzdHJpbmcsIHVua25vd24+LCBsb2NhbE9ubHlBdHRyaWJ1dGVzPzogc3RyaW5nW10sIGJvb2xlYW5BdHRyaWJ1dGVzPzogc3RyaW5nW10sIG5vcm1hbGl6ZURhdGE/OiAoZGF0YTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pID0+IFJlY29yZDxzdHJpbmcsIHVua25vd24+fX0gYXJncyAtIERhdGEgYXJncy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSBRdWV1ZWQgZGF0YS5cbiAgICovXG4gIHN0YXRpYyBxdWV1ZWRTeW5jRGF0YShhcmdzKSB7XG4gICAgY29uc3QgaW5wdXREYXRhID0gYXJncy5kYXRhID8/IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgdW5rbm93bj59ICovIChhcmdzLnJlc291cmNlLmF0dHJpYnV0ZXMoKSlcbiAgICBjb25zdCBub3JtYWxpemVkRGF0YSA9IGFyZ3Mubm9ybWFsaXplRGF0YSA/IGFyZ3Mubm9ybWFsaXplRGF0YShpbnB1dERhdGEpIDogaW5wdXREYXRhXG4gICAgY29uc3Qgc3luY0RhdGEgPSB7Li4ubm9ybWFsaXplZERhdGF9XG5cbiAgICBmb3IgKGNvbnN0IGF0dHJpYnV0ZU5hbWUgb2YgYXJncy5sb2NhbE9ubHlBdHRyaWJ1dGVzIHx8IFtdKSBkZWxldGUgc3luY0RhdGFbYXR0cmlidXRlTmFtZV1cbiAgICBmb3IgKGNvbnN0IGF0dHJpYnV0ZU5hbWUgb2YgYXJncy5ib29sZWFuQXR0cmlidXRlcyB8fCBbXSkge1xuICAgICAgaWYgKE9iamVjdC5oYXNPd24oc3luY0RhdGEsIGF0dHJpYnV0ZU5hbWUpKSBzeW5jRGF0YVthdHRyaWJ1dGVOYW1lXSA9IHRoaXMub3B0aW9uYWxCb29sZWFuU3luY1ZhbHVlKHN5bmNEYXRhW2F0dHJpYnV0ZU5hbWVdLCBhdHRyaWJ1dGVOYW1lKVxuICAgIH1cbiAgICBmb3IgKGNvbnN0IFthdHRyaWJ1dGVOYW1lLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoc3luY0RhdGEpKSB7XG4gICAgICBpZiAodmFsdWUgaW5zdGFuY2VvZiBEYXRlKSBzeW5jRGF0YVthdHRyaWJ1dGVOYW1lXSA9IHZhbHVlLnRvSVNPU3RyaW5nKClcbiAgICB9XG5cbiAgICByZXR1cm4gc3luY0RhdGFcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgYSBzbWFsbCBhcHAtZmFjaW5nIGxvY2FsIHN5bmMgcXVldWUgZmFjYWRlIGZyb20gZGVjbGFyYXRpdmUgbW9kZWwgY29uZmlnLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFF1ZXVlIGNvbmZpZy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5zeW5jTW9kZWwgLSBMb2NhbCBTeW5jIG1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zaW5nbGVGbGlnaHRLZXkgLSBLZXkgdXNlZCB0byBzZXJpYWxpemUgYmFja2VuZCByZXBsYXkuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTx2b2lkPn0gYXJncy5zeW5jUGVuZGluZyAtIEJhY2tlbmQgcmVwbGF5IGNhbGxiYWNrLlxuICAgKiBAcGFyYW0geyhyZXNvdXJjZTogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4pID0+IHN0cmluZ1tdfSBbYXJncy5sb2NhbE9ubHlBdHRyaWJ1dGVzXSAtIFJlc291cmNlLXNwZWNpZmljIGxvY2FsLW9ubHkgYXR0cmlidXRlcy5cbiAgICogQHBhcmFtIHsocmVzb3VyY2U6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+KSA9PiBzdHJpbmdbXX0gW2FyZ3MuYm9vbGVhbkF0dHJpYnV0ZXNdIC0gUmVzb3VyY2Utc3BlY2lmaWMgU1FMaXRlIGJvb2xlYW4gYXR0cmlidXRlcy5cbiAgICogQHJldHVybnMge3txdWV1ZTogKHF1ZXVlQXJnczoge3Jlc291cmNlOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgZGF0YT86IFJlY29yZDxzdHJpbmcsIHVua25vd24+LCBzeW5jVHlwZT86IHN0cmluZ30pID0+IFByb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBzeW5jUGVuZGluZzogKCkgPT4gUHJvbWlzZTx2b2lkPn19IENvbmZpZ3VyZWQgbG9jYWwgc3luYyBxdWV1ZS5cbiAgICovXG4gIHN0YXRpYyBsb2NhbFN5bmNRdWV1ZShhcmdzKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHF1ZXVlOiBhc3luYyAocXVldWVBcmdzKSA9PiBhd2FpdCB0aGlzLnF1ZXVlTG9jYWxTeW5jKHtcbiAgICAgICAgLi4ucXVldWVBcmdzLFxuICAgICAgICBib29sZWFuQXR0cmlidXRlczogYXJncy5ib29sZWFuQXR0cmlidXRlcyA/IGFyZ3MuYm9vbGVhbkF0dHJpYnV0ZXMocXVldWVBcmdzLnJlc291cmNlKSA6IFtdLFxuICAgICAgICBsb2NhbE9ubHlBdHRyaWJ1dGVzOiBhcmdzLmxvY2FsT25seUF0dHJpYnV0ZXMgPyBhcmdzLmxvY2FsT25seUF0dHJpYnV0ZXMocXVldWVBcmdzLnJlc291cmNlKSA6IFtdLFxuICAgICAgICBzeW5jTW9kZWw6IGFyZ3Muc3luY01vZGVsXG4gICAgICB9KSxcbiAgICAgIHN5bmNQZW5kaW5nOiBhc3luYyAoKSA9PiBhd2FpdCB0aGlzLnNpbmdsZUZsaWdodChhcmdzLnNpbmdsZUZsaWdodEtleSwgYXJncy5zeW5jUGVuZGluZylcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUGFyc2VzIGJvb2xlYW5zIGNvbW1vbmx5IHVzZWQgYnkgU1FMaXRlL29mZmxpbmUgc3luYyBwYXlsb2Fkcy5cbiAgICogQHBhcmFtIHt1bmtub3dufSB2YWx1ZSAtIFN5bmMgZGVjaXNpb24gdmFsdWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbZGVzY3JpcHRpb25dIC0gRXJyb3IgY29udGV4dC5cbiAgICogQHJldHVybnMge2Jvb2xlYW4gfCBudWxsfSBQYXJzZWQgYm9vbGVhbi1saWtlIGJhY2tlbmQvbG9jYWwgdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgb3B0aW9uYWxCb29sZWFuU3luY1ZhbHVlKHZhbHVlLCBkZXNjcmlwdGlvbiA9IFwic3luYyBib29sZWFuXCIpIHtcbiAgICBpZiAodmFsdWUgPT0gbnVsbCkgcmV0dXJuIG51bGxcbiAgICBpZiAodmFsdWUgPT09IDEpIHJldHVybiB0cnVlXG4gICAgaWYgKHZhbHVlID09PSAwKSByZXR1cm4gZmFsc2VcblxuICAgIHJldHVybiBvcHRpb25hbEJvb2xlYW4odmFsdWUsIGRlc2NyaXB0aW9uKVxuICB9XG5cbiAgLyoqXG4gICAqIENvbnZlcnRzIGEgYm9vbGVhbiBzeW5jIHZhbHVlIHRvIFNRTGl0ZSBib29sZWFuIHN0b3JhZ2UuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbiB8IG51bGx9IHZhbHVlIC0gU3luYyBib29sZWFuIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7MCB8IDF9IFNRTGl0ZS1jb21wYXRpYmxlIGJvb2xlYW4gdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgc3FsaXRlQm9vbGVhblN5bmNWYWx1ZSh2YWx1ZSkge1xuICAgIHJldHVybiB2YWx1ZSA9PT0gdHJ1ZSA/IDEgOiAwXG4gIH1cblxuICAvKipcbiAgICogUHJvamVjdHMgZ2VuZXJpYyBzeW5jIGNvdW50ZXJzIGludG8gYXBwLXNwZWNpZmljIHJlc3VsdCBrZXlzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFJlc3VsdCBhcmdzLlxuICAgKiBAcGFyYW0ge1N5bmNDaGFuZ2VzUmVzdWx0fSBhcmdzLnJlc3VsdCAtIEdlbmVyaWMgVmVsb2Npb3VzIHN5bmMgcmVzdWx0LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIHtjaGFuZ2VkS2V5OiBzdHJpbmcsIGNvdW50S2V5OiBzdHJpbmd9Pn0gYXJncy5yZXNvdXJjZXMgLSBSZXNvdXJjZSByZXN1bHQga2V5IG1hcC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSBQcm9qZWN0ZWQgcmVzdWx0LlxuICAgKi9cbiAgc3RhdGljIHN5bmNSZXN1bHRGb3JSZXNvdXJjZXMoe3Jlc3VsdCwgcmVzb3VyY2VzfSkge1xuICAgIGNvbnN0IHN5bmNSZXN1bHQgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHVua25vd24+fSAqLyAoe1xuICAgICAgY2hhbmdlZDogcmVzdWx0LmNoYW5nZWQsXG4gICAgICBwYWdlczogcmVzdWx0LnBhZ2VzLFxuICAgICAgc3luY2VkQ291bnQ6IHJlc3VsdC5zeW5jZWRDb3VudFxuICAgIH0pXG5cbiAgICBmb3IgKGNvbnN0IFtyZXNvdXJjZVR5cGUsIGtleXNdIG9mIE9iamVjdC5lbnRyaWVzKHJlc291cmNlcykpIHtcbiAgICAgIHN5bmNSZXN1bHRba2V5cy5jb3VudEtleV0gPSByZXN1bHQucmVzb3VyY2VDb3VudHNbcmVzb3VyY2VUeXBlXSB8fCAwXG4gICAgICBzeW5jUmVzdWx0W2tleXMuY2hhbmdlZEtleV0gPSByZXN1bHQucmVzb3VyY2VDaGFuZ2VkW3Jlc291cmNlVHlwZV0gfHwgZmFsc2VcbiAgICB9XG5cbiAgICByZXR1cm4gc3luY1Jlc3VsdFxuICB9XG5cbiAgLyoqXG4gICAqIERyYWlucyBwZW5kaW5nIHN5bmMgcmVjb3JkcyBpbiBzdGFibGUgb3JkZXIgYW5kIG1hcmtzIGFja25vd2xlZGdlZCByb3dzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFJlcGxheSBhcmdzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5hdXRoZW50aWNhdGlvblRva2VuIC0gQXV0aCB0b2tlbiB0byBzZW5kIHdpdGggcmVwbGF5IHJlcXVlc3RzLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MuYmF0Y2hTaXplXSAtIE1heCBzeW5jcyBwZXIgcmVxdWVzdC4gRGVmYXVsdHMgdG8gMTAwLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8QXJyYXk8dW5rbm93bj4+fSBhcmdzLnBlbmRpbmdTeW5jcyAtIExvYWRzIHBlbmRpbmcgbG9jYWwgc3luYyByb3dzIGluIHJlcGxheSBvcmRlci5cbiAgICogQHBhcmFtIHsoc3luYzogdW5rbm93bikgPT4gc3RyaW5nIHwgbnVtYmVyIHwgbnVsbCB8IHVuZGVmaW5lZH0gYXJncy5zeW5jSWQgLSBSZXR1cm5zIHRoZSBsb2NhbCBzeW5jIGlkLlxuICAgKiBAcGFyYW0geyhzeW5jOiB1bmtub3duKSA9PiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGFyZ3Muc3luY1BheWxvYWQgLSBCdWlsZHMgdGhlIEFQSSBzeW5jIGVudmVsb3BlLlxuICAgKiBAcGFyYW0geyhwYXlsb2FkOiB7YXV0aGVudGljYXRpb25Ub2tlbjogc3RyaW5nLCBzeW5jczogQXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0pID0+IFByb21pc2U8U3luY1JlcGxheVJlc3BvbnNlPn0gYXJncy5wb3N0UmVwbGF5IC0gUG9zdHMgb25lIHJlcGxheSByZXF1ZXN0LlxuICAgKiBAcGFyYW0geyhzeW5jOiB1bmtub3duLCByZXNwb25zZTogU3luY1JlcGxheUl0ZW0pID0+IFByb21pc2U8dm9pZD59IGFyZ3MubWFya1N1Y2Nlc3NmdWwgLSBNYXJrcyBvbmUgc3luYyBhcyBzdWNjZXNzZnVsIGxvY2FsbHkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyBhZnRlciBhbGwgYmF0Y2hlcyBhcmUgcmVwbGF5ZWQuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgcmVwbGF5UGVuZGluZyhhcmdzKSB7XG4gICAgY29uc3QgcGVuZGluZ1N5bmNzID0gYXdhaXQgYXJncy5wZW5kaW5nU3luY3MoKVxuICAgIGNvbnN0IGJhdGNoU2l6ZSA9IHRoaXMubm9ybWFsaXplZEJhdGNoU2l6ZShhcmdzLmJhdGNoU2l6ZSlcblxuICAgIGZvciAobGV0IG9mZnNldCA9IDA7IG9mZnNldCA8IHBlbmRpbmdTeW5jcy5sZW5ndGg7IG9mZnNldCArPSBiYXRjaFNpemUpIHtcbiAgICAgIGF3YWl0IHRoaXMucmVwbGF5QmF0Y2goey4uLmFyZ3MsIHBlbmRpbmdTeW5jczogcGVuZGluZ1N5bmNzLnNsaWNlKG9mZnNldCwgb2Zmc2V0ICsgYmF0Y2hTaXplKX0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlcGxheXMgb25lIGJhdGNoIG9mIHN5bmNzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFJlcGxheSBhcmdzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5hdXRoZW50aWNhdGlvblRva2VuIC0gQXV0aCB0b2tlbi5cbiAgICogQHBhcmFtIHtBcnJheTx1bmtub3duPn0gYXJncy5wZW5kaW5nU3luY3MgLSBCYXRjaCBzeW5jcy5cbiAgICogQHBhcmFtIHsoc3luYzogdW5rbm93bikgPT4gc3RyaW5nIHwgbnVtYmVyIHwgbnVsbCB8IHVuZGVmaW5lZH0gYXJncy5zeW5jSWQgLSBTeW5jIGlkIGdldHRlci5cbiAgICogQHBhcmFtIHsoc3luYzogdW5rbm93bikgPT4gUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhcmdzLnN5bmNQYXlsb2FkIC0gUGF5bG9hZCBidWlsZGVyLlxuICAgKiBAcGFyYW0geyhwYXlsb2FkOiB7YXV0aGVudGljYXRpb25Ub2tlbjogc3RyaW5nLCBzeW5jczogQXJyYXk8UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0pID0+IFByb21pc2U8U3luY1JlcGxheVJlc3BvbnNlPn0gYXJncy5wb3N0UmVwbGF5IC0gUmVwbGF5IHBvc3Rlci5cbiAgICogQHBhcmFtIHsoc3luYzogdW5rbm93biwgcmVzcG9uc2U6IFN5bmNSZXBsYXlJdGVtKSA9PiBQcm9taXNlPHZvaWQ+fSBhcmdzLm1hcmtTdWNjZXNzZnVsIC0gU3VjY2VzcyBob29rLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIGJhdGNoIGlzIGFja25vd2xlZGdlZC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyByZXBsYXlCYXRjaChhcmdzKSB7XG4gICAgY29uc3Qge2F1dGhlbnRpY2F0aW9uVG9rZW4sIG1hcmtTdWNjZXNzZnVsLCBwZW5kaW5nU3luY3MsIHBvc3RSZXBsYXksIHN5bmNJZCwgc3luY1BheWxvYWR9ID0gYXJnc1xuXG4gICAgaWYgKHBlbmRpbmdTeW5jcy5sZW5ndGggPT09IDApIHJldHVyblxuXG4gICAgY29uc3Qgc3luY3NCeUlkID0gbmV3IE1hcCgpXG5cbiAgICBmb3IgKGNvbnN0IHN5bmMgb2YgcGVuZGluZ1N5bmNzKSB7XG4gICAgICBjb25zdCBpZCA9IHN5bmNJZChzeW5jKVxuXG4gICAgICBpZiAoaWQgIT09IHVuZGVmaW5lZCAmJiBpZCAhPT0gbnVsbCkgc3luY3NCeUlkLnNldChTdHJpbmcoaWQpLCBzeW5jKVxuICAgIH1cblxuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgcG9zdFJlcGxheSh7XG4gICAgICBhdXRoZW50aWNhdGlvblRva2VuLFxuICAgICAgc3luY3M6IHBlbmRpbmdTeW5jcy5tYXAoKHN5bmMpID0+IHN5bmNQYXlsb2FkKHN5bmMpKVxuICAgIH0pXG5cbiAgICB0aGlzLmVuc3VyZVN1Y2Nlc3NmdWxSZXNwb25zZShyZXNwb25zZSlcblxuICAgIGZvciAoY29uc3Qgc3luY1Jlc3BvbnNlIG9mIHJlc3BvbnNlLnN5bmNzIHx8IFtdKSB7XG4gICAgICBjb25zdCBzeW5jID0gc3luY3NCeUlkLmdldChTdHJpbmcoc3luY1Jlc3BvbnNlLmlkKSlcblxuICAgICAgaWYgKCFzeW5jKSBjb250aW51ZVxuICAgICAgaWYgKHN5bmNSZXNwb25zZS5zeW5jU3RhdGUgIT09IFwic3VjY2Vzc2Z1bFwiKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBzeW5jIHN0YXRlIHJldHVybmVkIGZvciBzeW5jICR7U3RyaW5nKHN5bmNSZXNwb25zZS5pZCl9OiAke1N0cmluZyhzeW5jUmVzcG9uc2Uuc3luY1N0YXRlKX1gKVxuICAgICAgfVxuXG4gICAgICBhd2FpdCBtYXJrU3VjY2Vzc2Z1bChzeW5jLCBzeW5jUmVzcG9uc2UpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrcyBBUEkgcmVzcG9uc2Ugc3RhdHVzIGFuZCBzaGFwZS5cbiAgICogQHBhcmFtIHtTeW5jUmVwbGF5UmVzcG9uc2V9IHJlc3BvbnNlIC0gUmVwbGF5IHJlc3BvbnNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyBlbnN1cmVTdWNjZXNzZnVsUmVzcG9uc2UocmVzcG9uc2UpIHtcbiAgICBpZiAocmVzcG9uc2Uuc3RhdHVzID09PSBcImVycm9yXCIpIHRocm93IG5ldyBFcnJvcihyZXNwb25zZS5lcnJvck1lc3NhZ2UgfHwgXCJTeW5jIGZhaWxlZFwiKVxuICAgIGlmICghQXJyYXkuaXNBcnJheShyZXNwb25zZS5zeW5jcykpIHRocm93IG5ldyBFcnJvcihcIlN5bmMgcmVzcG9uc2UgbWlzc2luZyBzeW5jc1wiKVxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZXMgYSBwb3NpdGl2ZSBiYXRjaCBzaXplLlxuICAgKiBAcGFyYW0ge251bWJlciB8IHVuZGVmaW5lZH0gYmF0Y2hTaXplIC0gQmF0Y2ggc2l6ZS5cbiAgICogQHJldHVybnMge251bWJlcn0gUG9zaXRpdmUgYmF0Y2ggc2l6ZS5cbiAgICovXG4gIHN0YXRpYyBub3JtYWxpemVkQmF0Y2hTaXplKGJhdGNoU2l6ZSkge1xuICAgIGlmICh0eXBlb2YgYmF0Y2hTaXplICE9PSBcIm51bWJlclwiIHx8ICFOdW1iZXIuaXNGaW5pdGUoYmF0Y2hTaXplKSB8fCBiYXRjaFNpemUgPCAxKSByZXR1cm4gMTAwXG5cbiAgICByZXR1cm4gTWF0aC5mbG9vcihiYXRjaFNpemUpXG4gIH1cbn1cbiJdfQ==