// @ts-check
import { createSignedMutation, mutationIdempotencyKey, verifySignedMutation } from "./device-identity.js";
/**
 * Peer mutation bundle exported by a device for offline/P2P transfer.
 * @typedef {object} PeerMutationBundle
 * @property {string} exportedAt - ISO timestamp when the bundle was exported.
 * @property {"velocious.sync.peer-mutation-bundle.v1"} format - Bundle format identifier.
 * @property {PeerMutationBundleEntry[]} mutations - Signed mutations in local sequence order.
 */
/**
 * One peer mutation bundle entry.
 * @typedef {object} PeerMutationBundleEntry
 * @property {string} [localRecordId] - Exporting device's local mutation record id.
 * @property {number} [localSequence] - Exporting device's local mutation sequence.
 * @property {import("./device-identity.js").SignedSyncMutation} signedMutation - Device-signed mutation envelope.
 */
const PEER_MUTATION_BUNDLE_FORMAT = "velocious.sync.peer-mutation-bundle.v1";
const EXPORTABLE_STATUSES = new Set(["pending", "applied-locally", "conflict"]);
/**
 * Exports local non-terminal mutations as a signed peer-transfer bundle.
 * @param {object} args - Arguments.
 * @param {import("./device-identity.js").DeviceCertificate} args.deviceCertificate - Device certificate for signing records.
 * @param {import("./device-identity.js").SyncJsonWebKey} args.devicePrivateKey - Device private key for signing records.
 * @param {import("./local-mutation-log.js").default} args.mutationLog - Local mutation log.
 * @param {() => Date} [args.now] - Export clock.
 * @param {import("./local-mutation-log.js").LocalMutationStatus[]} [args.statuses] - Statuses to export.
 * @returns {Promise<PeerMutationBundle>} - Signed peer mutation bundle.
 */
export async function exportPeerMutationBundle({ deviceCertificate, devicePrivateKey, mutationLog, now = () => new Date(), statuses }) {
    const selectedStatuses = normalizeExportStatuses(statuses);
    const timestamp = isoTimestamp(now(), "exportedAt");
    const records = (await mutationLog.records())
        .filter((record) => selectedStatuses.has(record.status))
        .sort((left, right) => left.sequence - right.sequence);
    const mutations = [];
    for (const record of records) {
        mutations.push({
            localRecordId: record.id,
            localSequence: record.sequence,
            signedMutation: record.signedMutation
                ? /** @type {import("./device-identity.js").SignedSyncMutation} */ (record.signedMutation)
                : await createSignedMutation({
                    deviceCertificate,
                    devicePrivateKey,
                    mutation: record.mutation
                })
        });
    }
    return {
        exportedAt: timestamp,
        format: PEER_MUTATION_BUNDLE_FORMAT,
        mutations
    };
}
/**
 * Imports verified peer mutations into the local mutation log.
 * @param {object} args - Arguments.
 * @param {import("./device-identity.js").SyncJsonWebKey} args.backendPublicKey - Backend public key for verifying peer certificates.
 * @param {PeerMutationBundle} args.bundle - Peer bundle to import.
 * @param {import("./local-mutation-log.js").default} args.mutationLog - Local mutation log.
 * @param {Date} [args.now] - Verification time.
 * @returns {Promise<{imported: {clientMutationId: string, idempotencyKey: string, localRecordId: string}[], rejected: {errorMessage: string, index: number}[], skipped: {clientMutationId: string, idempotencyKey: string, localRecordId: string, reason: "duplicate"}[]}>} - Import result.
 */
export async function importPeerMutationBundle({ backendPublicKey, bundle, mutationLog, now = new Date() }) {
    const normalizedBundle = normalizePeerMutationBundle(bundle);
    const existingRecords = await mutationLog.records();
    const existingByIdempotencyKey = new Map(existingRecords.map((record) => [mutationIdempotencyKey({ mutation: record.mutation }), record]));
    /** @type {{clientMutationId: string, idempotencyKey: string, localRecordId: string}[]} */
    const imported = [];
    /** @type {{errorMessage: string, index: number}[]} */
    const rejected = [];
    /** @type {{clientMutationId: string, idempotencyKey: string, localRecordId: string, reason: "duplicate"}[]} */
    const skipped = [];
    for (const [index, entry] of normalizedBundle.mutations.entries()) {
        const mutation = await verifiedBundleMutation({ backendPublicKey, entry, index, now, rejected });
        if (!mutation)
            continue;
        const idempotencyKey = mutationIdempotencyKey(entry.signedMutation);
        const duplicateRecord = existingByIdempotencyKey.get(idempotencyKey);
        if (duplicateRecord) {
            skipped.push({
                clientMutationId: mutation.clientMutationId,
                idempotencyKey,
                localRecordId: duplicateRecord.id,
                reason: /** @type {"duplicate"} */ ("duplicate")
            });
            continue;
        }
        const record = await mutationLog.append({ mutation, signedMutation: entry.signedMutation });
        const updated = await mutationLog.updateStatus({ id: record.id, status: "peer-applied" });
        existingByIdempotencyKey.set(idempotencyKey, updated);
        imported.push({ clientMutationId: mutation.clientMutationId, idempotencyKey, localRecordId: updated.id });
    }
    return { imported, rejected, skipped };
}
/**
 * Verifies a bundle mutation and records normal per-entry verification rejections.
 * Storage writes intentionally happen outside this helper so storage failures escape import.
 * @param {object} args - Arguments.
 * @param {import("./device-identity.js").SyncJsonWebKey} args.backendPublicKey - Backend public key.
 * @param {PeerMutationBundleEntry} args.entry - Bundle entry.
 * @param {number} args.index - Entry index.
 * @param {Date} args.now - Verification time.
 * @param {{errorMessage: string, index: number}[]} args.rejected - Rejection accumulator.
 * @returns {Promise<import("./device-identity.js").SyncMutation | null>} - Verified mutation, or null when rejected.
 */
async function verifiedBundleMutation({ backendPublicKey, entry, index, now, rejected }) {
    try {
        return await verifySignedMutation({ backendPublicKey, now, signedMutation: entry.signedMutation });
    }
    catch (error) {
        rejected.push({ errorMessage: errorMessage(error), index });
        return null;
    }
}
/**
 * Normalizes export status filters.
 * @param {import("./local-mutation-log.js").LocalMutationStatus[] | undefined} statuses - Optional statuses.
 * @returns {Set<import("./local-mutation-log.js").LocalMutationStatus>} - Status set.
 */
function normalizeExportStatuses(statuses) {
    if (statuses === undefined)
        return /** @type {Set<import("./local-mutation-log.js").LocalMutationStatus>} */ (new Set(EXPORTABLE_STATUSES));
    if (!Array.isArray(statuses))
        throw new Error("Expected peer mutation export statuses array");
    const normalized = new Set();
    for (const status of statuses) {
        if (!EXPORTABLE_STATUSES.has(status))
            throw new Error(`Unsupported peer mutation export status '${String(status)}'`);
        normalized.add(status);
    }
    return /** @type {Set<import("./local-mutation-log.js").LocalMutationStatus>} */ (normalized);
}
/**
 * Normalizes a peer mutation bundle.
 * @param {PeerMutationBundle} bundle - Bundle value.
 * @returns {PeerMutationBundle} - Normalized bundle.
 */
function normalizePeerMutationBundle(bundle) {
    if (!bundle || typeof bundle !== "object" || Array.isArray(bundle))
        throw new Error("Expected peer mutation bundle object");
    if (bundle.format !== PEER_MUTATION_BUNDLE_FORMAT)
        throw new Error(`Unsupported peer mutation bundle format '${String(bundle.format)}'`);
    isoTimestamp(new Date(requiredString(bundle.exportedAt, "exportedAt")), "exportedAt");
    if (!Array.isArray(bundle.mutations))
        throw new Error("Expected peer mutation bundle mutations array");
    return {
        exportedAt: bundle.exportedAt,
        format: bundle.format,
        mutations: bundle.mutations.map((entry, index) => normalizePeerMutationBundleEntry(entry, index))
    };
}
/**
 * Normalizes one peer mutation bundle entry.
 * @param {PeerMutationBundleEntry} entry - Bundle entry.
 * @param {number} index - Entry index.
 * @returns {PeerMutationBundleEntry} - Normalized entry.
 */
function normalizePeerMutationBundleEntry(entry, index) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
        throw new Error(`Expected peer mutation bundle entry ${index} object`);
    if (!entry.signedMutation || typeof entry.signedMutation !== "object" || Array.isArray(entry.signedMutation))
        throw new Error(`Expected peer mutation bundle entry ${index} signedMutation object`);
    /** @type {PeerMutationBundleEntry} */
    const normalized = {
        signedMutation: entry.signedMutation
    };
    if (entry.localRecordId !== undefined)
        normalized.localRecordId = requiredString(entry.localRecordId, `entry ${index} localRecordId`);
    if (entry.localSequence !== undefined)
        normalized.localSequence = positiveInteger(entry.localSequence, `entry ${index} localSequence`);
    return normalized;
}
/**
 * Requires a non-empty string.
 * @param {unknown} value - Value.
 * @param {string} label - Label.
 * @returns {string} - String.
 */
function requiredString(value, label) {
    if (typeof value !== "string" || value.length < 1)
        throw new Error(`Expected peer mutation bundle ${label}`);
    return value;
}
/**
 * Requires a positive integer.
 * @param {unknown} value - Value.
 * @param {string} label - Label.
 * @returns {number} - Integer.
 */
function positiveInteger(value, label) {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1)
        throw new Error(`Expected peer mutation bundle ${label} positive integer`);
    return value;
}
/**
 * Returns an ISO timestamp from a valid Date.
 * @param {Date} date - Date.
 * @param {string} label - Label.
 * @returns {string} - ISO timestamp.
 */
function isoTimestamp(date, label) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime()))
        throw new Error(`Invalid peer mutation bundle ${label}`);
    return date.toISOString();
}
/**
 * Returns a safe error message.
 * @param {unknown} error - Error.
 * @returns {string} - Message.
 */
function errorMessage(error) {
    if (error instanceof Error)
        return error.message;
    return String(error);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGVlci1tdXRhdGlvbi1idW5kbGUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvc3luYy9wZWVyLW11dGF0aW9uLWJ1bmRsZS5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxFQUFDLG9CQUFvQixFQUFFLHNCQUFzQixFQUFFLG9CQUFvQixFQUFDLE1BQU0sc0JBQXNCLENBQUE7QUFFdkc7Ozs7OztHQU1HO0FBQ0g7Ozs7OztHQU1HO0FBQ0gsTUFBTSwyQkFBMkIsR0FBRyx3Q0FBd0MsQ0FBQTtBQUM1RSxNQUFNLG1CQUFtQixHQUFHLElBQUksR0FBRyxDQUFDLENBQUMsU0FBUyxFQUFFLGlCQUFpQixFQUFFLFVBQVUsQ0FBQyxDQUFDLENBQUE7QUFFL0U7Ozs7Ozs7OztHQVNHO0FBQ0gsTUFBTSxDQUFDLEtBQUssVUFBVSx3QkFBd0IsQ0FBQyxFQUFDLGlCQUFpQixFQUFFLGdCQUFnQixFQUFFLFdBQVcsRUFBRSxHQUFHLEdBQUcsR0FBRyxFQUFFLENBQUMsSUFBSSxJQUFJLEVBQUUsRUFBRSxRQUFRLEVBQUM7SUFDakksTUFBTSxnQkFBZ0IsR0FBRyx1QkFBdUIsQ0FBQyxRQUFRLENBQUMsQ0FBQTtJQUMxRCxNQUFNLFNBQVMsR0FBRyxZQUFZLENBQUMsR0FBRyxFQUFFLEVBQUUsWUFBWSxDQUFDLENBQUE7SUFDbkQsTUFBTSxPQUFPLEdBQUcsQ0FBQyxNQUFNLFdBQVcsQ0FBQyxPQUFPLEVBQUUsQ0FBQztTQUMxQyxNQUFNLENBQUMsQ0FBQyxNQUFNLEVBQUUsRUFBRSxDQUFDLGdCQUFnQixDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUM7U0FDdkQsSUFBSSxDQUFDLENBQUMsSUFBSSxFQUFFLEtBQUssRUFBRSxFQUFFLENBQUMsSUFBSSxDQUFDLFFBQVEsR0FBRyxLQUFLLENBQUMsUUFBUSxDQUFDLENBQUE7SUFDeEQsTUFBTSxTQUFTLEdBQUcsRUFBRSxDQUFB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SSxDQUFDLE1BQU0sQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDLElBQUksS0FBSyxHQUFHLENBQUM7UUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLGlDQUFpQyxLQUFLLG1CQUFtQixDQUFDLENBQUE7SUFFbEosT0FBTyxLQUFLLENBQUE7QUFDZCxDQUFDO0FBRUQ7Ozs7O0dBS0c7QUFDSCxTQUFTLFlBQVksQ0FBQyxJQUFJLEVBQUUsS0FBSztJQUMvQixJQUFJLENBQUMsQ0FBQyxJQUFJLFlBQVksSUFBSSxDQUFDLElBQUksTUFBTSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsT0FBTyxFQUFFLENBQUM7UUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLGdDQUFnQyxLQUFLLEVBQUUsQ0FBQyxDQUFBO0lBRXJILE9BQU8sSUFBSSxDQUFDLFdBQVcsRUFBRSxDQUFBO0FBQzNCLENBQUM7QUFFRDs7OztHQUlHO0FBQ0gsU0FBUyxZQUFZLENBQUMsS0FBSztJQUN6QixJQUFJLEtBQUssWUFBWSxLQUFLO1FBQUUsT0FBTyxLQUFLLENBQUMsT0FBTyxDQUFBO0lBRWhELE9BQU8sTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFBO0FBQ3RCLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHtjcmVhdGVTaWduZWRNdXRhdGlvbiwgbXV0YXRpb25JZGVtcG90ZW5jeUtleSwgdmVyaWZ5U2lnbmVkTXV0YXRpb259IGZyb20gXCIuL2RldmljZS1pZGVudGl0eS5qc1wiXG5cbi8qKlxuICogUGVlciBtdXRhdGlvbiBidW5kbGUgZXhwb3J0ZWQgYnkgYSBkZXZpY2UgZm9yIG9mZmxpbmUvUDJQIHRyYW5zZmVyLlxuICogQHR5cGVkZWYge29iamVjdH0gUGVlck11dGF0aW9uQnVuZGxlXG4gKiBAcHJvcGVydHkge3N0cmluZ30gZXhwb3J0ZWRBdCAtIElTTyB0aW1lc3RhbXAgd2hlbiB0aGUgYnVuZGxlIHdhcyBleHBvcnRlZC5cbiAqIEBwcm9wZXJ0eSB7XCJ2ZWxvY2lvdXMuc3luYy5wZWVyLW11dGF0aW9uLWJ1bmRsZS52MVwifSBmb3JtYXQgLSBCdW5kbGUgZm9ybWF0IGlkZW50aWZpZXIuXG4gKiBAcHJvcGVydHkge1BlZXJNdXRhdGlvbkJ1bmRsZUVudHJ5W119IG11dGF0aW9ucyAtIFNpZ25lZCBtdXRhdGlvbnMgaW4gbG9jYWwgc2VxdWVuY2Ugb3JkZXIuXG4gKi9cbi8qKlxuICogT25lIHBlZXIgbXV0YXRpb24gYnVuZGxlIGVudHJ5LlxuICogQHR5cGVkZWYge29iamVjdH0gUGVlck11dGF0aW9uQnVuZGxlRW50cnlcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbbG9jYWxSZWNvcmRJZF0gLSBFeHBvcnRpbmcgZGV2aWNlJ3MgbG9jYWwgbXV0YXRpb24gcmVjb3JkIGlkLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IFtsb2NhbFNlcXVlbmNlXSAtIEV4cG9ydGluZyBkZXZpY2UncyBsb2NhbCBtdXRhdGlvbiBzZXF1ZW5jZS5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi9kZXZpY2UtaWRlbnRpdHkuanNcIikuU2lnbmVkU3luY011dGF0aW9ufSBzaWduZWRNdXRhdGlvbiAtIERldmljZS1zaWduZWQgbXV0YXRpb24gZW52ZWxvcGUuXG4gKi9cbmNvbnN0IFBFRVJfTVVUQVRJT05fQlVORExFX0ZPUk1BVCA9IFwidmVsb2Npb3VzLnN5bmMucGVlci1tdXRhdGlvbi1idW5kbGUudjFcIlxuY29uc3QgRVhQT1JUQUJMRV9TVEFUVVNFUyA9IG5ldyBTZXQoW1wicGVuZGluZ1wiLCBcImFwcGxpZWQtbG9jYWxseVwiLCBcImNvbmZsaWN0XCJdKVxuXG4vKipcbiAqIEV4cG9ydHMgbG9jYWwgbm9uLXRlcm1pbmFsIG11dGF0aW9ucyBhcyBhIHNpZ25lZCBwZWVyLXRyYW5zZmVyIGJ1bmRsZS5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2RldmljZS1pZGVudGl0eS5qc1wiKS5EZXZpY2VDZXJ0aWZpY2F0ZX0gYXJncy5kZXZpY2VDZXJ0aWZpY2F0ZSAtIERldmljZSBjZXJ0aWZpY2F0ZSBmb3Igc2lnbmluZyByZWNvcmRzLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2RldmljZS1pZGVudGl0eS5qc1wiKS5TeW5jSnNvbldlYktleX0gYXJncy5kZXZpY2VQcml2YXRlS2V5IC0gRGV2aWNlIHByaXZhdGUga2V5IGZvciBzaWduaW5nIHJlY29yZHMuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vbG9jYWwtbXV0YXRpb24tbG9nLmpzXCIpLmRlZmF1bHR9IGFyZ3MubXV0YXRpb25Mb2cgLSBMb2NhbCBtdXRhdGlvbiBsb2cuXG4gKiBAcGFyYW0geygpID0+IERhdGV9IFthcmdzLm5vd10gLSBFeHBvcnQgY2xvY2suXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vbG9jYWwtbXV0YXRpb24tbG9nLmpzXCIpLkxvY2FsTXV0YXRpb25TdGF0dXNbXX0gW2FyZ3Muc3RhdHVzZXNdIC0gU3RhdHVzZXMgdG8gZXhwb3J0LlxuICogQHJldHVybnMge1Byb21pc2U8UGVlck11dGF0aW9uQnVuZGxlPn0gLSBTaWduZWQgcGVlciBtdXRhdGlvbiBidW5kbGUuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBleHBvcnRQZWVyTXV0YXRpb25CdW5kbGUoe2RldmljZUNlcnRpZmljYXRlLCBkZXZpY2VQcml2YXRlS2V5LCBtdXRhdGlvbkxvZywgbm93ID0gKCkgPT4gbmV3IERhdGUoKSwgc3RhdHVzZXN9KSB7XG4gIGNvbnN0IHNlbGVjdGVkU3RhdHVzZXMgPSBub3JtYWxpemVFeHBvcnRTdGF0dXNlcyhzdGF0dXNlcylcbiAgY29uc3QgdGltZXN0YW1wID0gaXNvVGltZXN0YW1wKG5vdygpLCBcImV4cG9ydGVkQXRcIilcbiAgY29uc3QgcmVjb3JkcyA9IChhd2FpdCBtdXRhdGlvbkxvZy5yZWNvcmRzKCkpXG4gICAgLmZpbHRlcigocmVjb3JkKSA9PiBzZWxlY3RlZFN0YXR1c2VzLmhhcyhyZWNvcmQuc3RhdHVzKSlcbiAgICAuc29ydCgobGVmdCwgcmlnaHQpID0+IGxlZnQuc2VxdWVuY2UgLSByaWdodC5zZXF1ZW5jZSlcbiAgY29uc3QgbXV0YXRpb25zID0gW11cblxuICBmb3IgKGNvbnN0IHJlY29yZCBvZiByZWNvcmRzKSB7XG4gICAgbXV0YXRpb25zLnB1c2goe1xuICAgICAgbG9jYWxSZWNvcmRJZDogcmVjb3JkLmlkLFxuICAgICAgbG9jYWxTZXF1ZW5jZTogcmVjb3JkLnNlcXVlbmNlLFxuICAgICAgc2lnbmVkTXV0YXRpb246IHJlY29yZC5zaWduZWRNdXRhdGlvblxuICAgICAgICA/IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9kZXZpY2UtaWRlbnRpdHkuanNcIikuU2lnbmVkU3luY011dGF0aW9ufSAqLyAocmVjb3JkLnNpZ25lZE11dGF0aW9uKVxuICAgICAgICA6IGF3YWl0IGNyZWF0ZVNpZ25lZE11dGF0aW9uKHtcbiAgICAgICAgICBkZXZpY2VDZXJ0aWZpY2F0ZSxcbiAgICAgICAgICBkZXZpY2VQcml2YXRlS2V5LFxuICAgICAgICAgIG11dGF0aW9uOiByZWNvcmQubXV0YXRpb25cbiAgICAgICAgfSlcbiAgICB9KVxuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBleHBvcnRlZEF0OiB0aW1lc3RhbXAsXG4gICAgZm9ybWF0OiBQRUVSX01VVEFUSU9OX0JVTkRMRV9GT1JNQVQsXG4gICAgbXV0YXRpb25zXG4gIH1cbn1cblxuLyoqXG4gKiBJbXBvcnRzIHZlcmlmaWVkIHBlZXIgbXV0YXRpb25zIGludG8gdGhlIGxvY2FsIG11dGF0aW9uIGxvZy5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2RldmljZS1pZGVudGl0eS5qc1wiKS5TeW5jSnNvbldlYktleX0gYXJncy5iYWNrZW5kUHVibGljS2V5IC0gQmFja2VuZCBwdWJsaWMga2V5IGZvciB2ZXJpZnlpbmcgcGVlciBjZXJ0aWZpY2F0ZXMuXG4gKiBAcGFyYW0ge1BlZXJNdXRhdGlvbkJ1bmRsZX0gYXJncy5idW5kbGUgLSBQZWVyIGJ1bmRsZSB0byBpbXBvcnQuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vbG9jYWwtbXV0YXRpb24tbG9nLmpzXCIpLmRlZmF1bHR9IGFyZ3MubXV0YXRpb25Mb2cgLSBMb2NhbCBtdXRhdGlvbiBsb2cuXG4gKiBAcGFyYW0ge0RhdGV9IFthcmdzLm5vd10gLSBWZXJpZmljYXRpb24gdGltZS5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHtpbXBvcnRlZDoge2NsaWVudE11dGF0aW9uSWQ6IHN0cmluZywgaWRlbXBvdGVuY3lLZXk6IHN0cmluZywgbG9jYWxSZWNvcmRJZDogc3RyaW5nfVtdLCByZWplY3RlZDoge2Vycm9yTWVzc2FnZTogc3RyaW5nLCBpbmRleDogbnVtYmVyfVtdLCBza2lwcGVkOiB7Y2xpZW50TXV0YXRpb25JZDogc3RyaW5nLCBpZGVtcG90ZW5jeUtleTogc3RyaW5nLCBsb2NhbFJlY29yZElkOiBzdHJpbmcsIHJlYXNvbjogXCJkdXBsaWNhdGVcIn1bXX0+fSAtIEltcG9ydCByZXN1bHQuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBpbXBvcnRQZWVyTXV0YXRpb25CdW5kbGUoe2JhY2tlbmRQdWJsaWNLZXksIGJ1bmRsZSwgbXV0YXRpb25Mb2csIG5vdyA9IG5ldyBEYXRlKCl9KSB7XG4gIGNvbnN0IG5vcm1hbGl6ZWRCdW5kbGUgPSBub3JtYWxpemVQZWVyTXV0YXRpb25CdW5kbGUoYnVuZGxlKVxuICBjb25zdCBleGlzdGluZ1JlY29yZHMgPSBhd2FpdCBtdXRhdGlvbkxvZy5yZWNvcmRzKClcbiAgY29uc3QgZXhpc3RpbmdCeUlkZW1wb3RlbmN5S2V5ID0gbmV3IE1hcChleGlzdGluZ1JlY29yZHMubWFwKChyZWNvcmQpID0+IFttdXRhdGlvbklkZW1wb3RlbmN5S2V5KHttdXRhdGlvbjogcmVjb3JkLm11dGF0aW9ufSksIHJlY29yZF0pKVxuICAvKiogQHR5cGUge3tjbGllbnRNdXRhdGlvbklkOiBzdHJpbmcsIGlkZW1wb3RlbmN5S2V5OiBzdHJpbmcsIGxvY2FsUmVjb3JkSWQ6IHN0cmluZ31bXX0gKi9cbiAgY29uc3QgaW1wb3J0ZWQgPSBbXVxuICAvKiogQHR5cGUge3tlcnJvck1lc3NhZ2U6IHN0cmluZywgaW5kZXg6IG51bWJlcn1bXX0gKi9cbiAgY29uc3QgcmVqZWN0ZWQgPSBbXVxuICAvKiogQHR5cGUge3tjbGllbnRNdXRhdGlvbklkOiBzdHJpbmcsIGlkZW1wb3RlbmN5S2V5OiBzdHJpbmcsIGxvY2FsUmVjb3JkSWQ6IHN0cmluZywgcmVhc29uOiBcImR1cGxpY2F0ZVwifVtdfSAqL1xuICBjb25zdCBza2lwcGVkID0gW11cblxuICBmb3IgKGNvbnN0IFtpbmRleCwgZW50cnldIG9mIG5vcm1hbGl6ZWRCdW5kbGUubXV0YXRpb25zLmVudHJpZXMoKSkge1xuICAgIGNvbnN0IG11dGF0aW9uID0gYXdhaXQgdmVyaWZpZWRCdW5kbGVNdXRhdGlvbih7YmFja2VuZFB1YmxpY0tleSwgZW50cnksIGluZGV4LCBub3csIHJlamVjdGVkfSlcblxuICAgIGlmICghbXV0YXRpb24pIGNvbnRpbnVlXG5cbiAgICBjb25zdCBpZGVtcG90ZW5jeUtleSA9IG11dGF0aW9uSWRlbXBvdGVuY3lLZXkoZW50cnkuc2lnbmVkTXV0YXRpb24pXG4gICAgY29uc3QgZHVwbGljYXRlUmVjb3JkID0gZXhpc3RpbmdCeUlkZW1wb3RlbmN5S2V5LmdldChpZGVtcG90ZW5jeUtleSlcblxuICAgIGlmIChkdXBsaWNhdGVSZWNvcmQpIHtcbiAgICAgIHNraXBwZWQucHVzaCh7XG4gICAgICAgIGNsaWVudE11dGF0aW9uSWQ6IG11dGF0aW9uLmNsaWVudE11dGF0aW9uSWQsXG4gICAgICAgIGlkZW1wb3RlbmN5S2V5LFxuICAgICAgICBsb2NhbFJlY29yZElkOiBkdXBsaWNhdGVSZWNvcmQuaWQsXG4gICAgICAgIHJlYXNvbjogLyoqIEB0eXBlIHtcImR1cGxpY2F0ZVwifSAqLyAoXCJkdXBsaWNhdGVcIilcbiAgICAgIH0pXG4gICAgICBjb250aW51ZVxuICAgIH1cblxuICAgIGNvbnN0IHJlY29yZCA9IGF3YWl0IG11dGF0aW9uTG9nLmFwcGVuZCh7bXV0YXRpb24sIHNpZ25lZE11dGF0aW9uOiBlbnRyeS5zaWduZWRNdXRhdGlvbn0pXG4gICAgY29uc3QgdXBkYXRlZCA9IGF3YWl0IG11dGF0aW9uTG9nLnVwZGF0ZVN0YXR1cyh7aWQ6IHJlY29yZC5pZCwgc3RhdHVzOiBcInBlZXItYXBwbGllZFwifSlcbiAgICBleGlzdGluZ0J5SWRlbXBvdGVuY3lLZXkuc2V0KGlkZW1wb3RlbmN5S2V5LCB1cGRhdGVkKVxuICAgIGltcG9ydGVkLnB1c2goe2NsaWVudE11dGF0aW9uSWQ6IG11dGF0aW9uLmNsaWVudE11dGF0aW9uSWQsIGlkZW1wb3RlbmN5S2V5LCBsb2NhbFJlY29yZElkOiB1cGRhdGVkLmlkfSlcbiAgfVxuXG4gIHJldHVybiB7aW1wb3J0ZWQsIHJlamVjdGVkLCBza2lwcGVkfVxufVxuXG4vKipcbiAqIFZlcmlmaWVzIGEgYnVuZGxlIG11dGF0aW9uIGFuZCByZWNvcmRzIG5vcm1hbCBwZXItZW50cnkgdmVyaWZpY2F0aW9uIHJlamVjdGlvbnMuXG4gKiBTdG9yYWdlIHdyaXRlcyBpbnRlbnRpb25hbGx5IGhhcHBlbiBvdXRzaWRlIHRoaXMgaGVscGVyIHNvIHN0b3JhZ2UgZmFpbHVyZXMgZXNjYXBlIGltcG9ydC5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2RldmljZS1pZGVudGl0eS5qc1wiKS5TeW5jSnNvbldlYktleX0gYXJncy5iYWNrZW5kUHVibGljS2V5IC0gQmFja2VuZCBwdWJsaWMga2V5LlxuICogQHBhcmFtIHtQZWVyTXV0YXRpb25CdW5kbGVFbnRyeX0gYXJncy5lbnRyeSAtIEJ1bmRsZSBlbnRyeS5cbiAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLmluZGV4IC0gRW50cnkgaW5kZXguXG4gKiBAcGFyYW0ge0RhdGV9IGFyZ3Mubm93IC0gVmVyaWZpY2F0aW9uIHRpbWUuXG4gKiBAcGFyYW0ge3tlcnJvck1lc3NhZ2U6IHN0cmluZywgaW5kZXg6IG51bWJlcn1bXX0gYXJncy5yZWplY3RlZCAtIFJlamVjdGlvbiBhY2N1bXVsYXRvci5cbiAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vZGV2aWNlLWlkZW50aXR5LmpzXCIpLlN5bmNNdXRhdGlvbiB8IG51bGw+fSAtIFZlcmlmaWVkIG11dGF0aW9uLCBvciBudWxsIHdoZW4gcmVqZWN0ZWQuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHZlcmlmaWVkQnVuZGxlTXV0YXRpb24oe2JhY2tlbmRQdWJsaWNLZXksIGVudHJ5LCBpbmRleCwgbm93LCByZWplY3RlZH0pIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gYXdhaXQgdmVyaWZ5U2lnbmVkTXV0YXRpb24oe2JhY2tlbmRQdWJsaWNLZXksIG5vdywgc2lnbmVkTXV0YXRpb246IGVudHJ5LnNpZ25lZE11dGF0aW9ufSlcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICByZWplY3RlZC5wdXNoKHtlcnJvck1lc3NhZ2U6IGVycm9yTWVzc2FnZShlcnJvciksIGluZGV4fSlcblxuICAgIHJldHVybiBudWxsXG4gIH1cbn1cblxuLyoqXG4gKiBOb3JtYWxpemVzIGV4cG9ydCBzdGF0dXMgZmlsdGVycy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9sb2NhbC1tdXRhdGlvbi1sb2cuanNcIikuTG9jYWxNdXRhdGlvblN0YXR1c1tdIHwgdW5kZWZpbmVkfSBzdGF0dXNlcyAtIE9wdGlvbmFsIHN0YXR1c2VzLlxuICogQHJldHVybnMge1NldDxpbXBvcnQoXCIuL2xvY2FsLW11dGF0aW9uLWxvZy5qc1wiKS5Mb2NhbE11dGF0aW9uU3RhdHVzPn0gLSBTdGF0dXMgc2V0LlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVFeHBvcnRTdGF0dXNlcyhzdGF0dXNlcykge1xuICBpZiAoc3RhdHVzZXMgPT09IHVuZGVmaW5lZCkgcmV0dXJuIC8qKiBAdHlwZSB7U2V0PGltcG9ydChcIi4vbG9jYWwtbXV0YXRpb24tbG9nLmpzXCIpLkxvY2FsTXV0YXRpb25TdGF0dXM+fSAqLyAobmV3IFNldChFWFBPUlRBQkxFX1NUQVRVU0VTKSlcbiAgaWYgKCFBcnJheS5pc0FycmF5KHN0YXR1c2VzKSkgdGhyb3cgbmV3IEVycm9yKFwiRXhwZWN0ZWQgcGVlciBtdXRhdGlvbiBleHBvcnQgc3RhdHVzZXMgYXJyYXlcIilcblxuICBjb25zdCBub3JtYWxpemVkID0gbmV3IFNldCgpXG5cbiAgZm9yIChjb25zdCBzdGF0dXMgb2Ygc3RhdHVzZXMpIHtcbiAgICBpZiAoIUVYUE9SVEFCTEVfU1RBVFVTRVMuaGFzKHN0YXR1cykpIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgcGVlciBtdXRhdGlvbiBleHBvcnQgc3RhdHVzICcke1N0cmluZyhzdGF0dXMpfSdgKVxuICAgIG5vcm1hbGl6ZWQuYWRkKHN0YXR1cylcbiAgfVxuXG4gIHJldHVybiAvKiogQHR5cGUge1NldDxpbXBvcnQoXCIuL2xvY2FsLW11dGF0aW9uLWxvZy5qc1wiKS5Mb2NhbE11dGF0aW9uU3RhdHVzPn0gKi8gKG5vcm1hbGl6ZWQpXG59XG5cbi8qKlxuICogTm9ybWFsaXplcyBhIHBlZXIgbXV0YXRpb24gYnVuZGxlLlxuICogQHBhcmFtIHtQZWVyTXV0YXRpb25CdW5kbGV9IGJ1bmRsZSAtIEJ1bmRsZSB2YWx1ZS5cbiAqIEByZXR1cm5zIHtQZWVyTXV0YXRpb25CdW5kbGV9IC0gTm9ybWFsaXplZCBidW5kbGUuXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZVBlZXJNdXRhdGlvbkJ1bmRsZShidW5kbGUpIHtcbiAgaWYgKCFidW5kbGUgfHwgdHlwZW9mIGJ1bmRsZSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KGJ1bmRsZSkpIHRocm93IG5ldyBFcnJvcihcIkV4cGVjdGVkIHBlZXIgbXV0YXRpb24gYnVuZGxlIG9iamVjdFwiKVxuICBpZiAoYnVuZGxlLmZvcm1hdCAhPT0gUEVFUl9NVVRBVElPTl9CVU5ETEVfRk9STUFUKSB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIHBlZXIgbXV0YXRpb24gYnVuZGxlIGZvcm1hdCAnJHtTdHJpbmcoYnVuZGxlLmZvcm1hdCl9J2ApXG4gIGlzb1RpbWVzdGFtcChuZXcgRGF0ZShyZXF1aXJlZFN0cmluZyhidW5kbGUuZXhwb3J0ZWRBdCwgXCJleHBvcnRlZEF0XCIpKSwgXCJleHBvcnRlZEF0XCIpXG4gIGlmICghQXJyYXkuaXNBcnJheShidW5kbGUubXV0YXRpb25zKSkgdGhyb3cgbmV3IEVycm9yKFwiRXhwZWN0ZWQgcGVlciBtdXRhdGlvbiBidW5kbGUgbXV0YXRpb25zIGFycmF5XCIpXG5cbiAgcmV0dXJuIHtcbiAgICBleHBvcnRlZEF0OiBidW5kbGUuZXhwb3J0ZWRBdCxcbiAgICBmb3JtYXQ6IGJ1bmRsZS5mb3JtYXQsXG4gICAgbXV0YXRpb25zOiBidW5kbGUubXV0YXRpb25zLm1hcCgoZW50cnksIGluZGV4KSA9PiBub3JtYWxpemVQZWVyTXV0YXRpb25CdW5kbGVFbnRyeShlbnRyeSwgaW5kZXgpKVxuICB9XG59XG5cbi8qKlxuICogTm9ybWFsaXplcyBvbmUgcGVlciBtdXRhdGlvbiBidW5kbGUgZW50cnkuXG4gKiBAcGFyYW0ge1BlZXJNdXRhdGlvbkJ1bmRsZUVudHJ5fSBlbnRyeSAtIEJ1bmRsZSBlbnRyeS5cbiAqIEBwYXJhbSB7bnVtYmVyfSBpbmRleCAtIEVudHJ5IGluZGV4LlxuICogQHJldHVybnMge1BlZXJNdXRhdGlvbkJ1bmRsZUVudHJ5fSAtIE5vcm1hbGl6ZWQgZW50cnkuXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZVBlZXJNdXRhdGlvbkJ1bmRsZUVudHJ5KGVudHJ5LCBpbmRleCkge1xuICBpZiAoIWVudHJ5IHx8IHR5cGVvZiBlbnRyeSAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KGVudHJ5KSkgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBwZWVyIG11dGF0aW9uIGJ1bmRsZSBlbnRyeSAke2luZGV4fSBvYmplY3RgKVxuICBpZiAoIWVudHJ5LnNpZ25lZE11dGF0aW9uIHx8IHR5cGVvZiBlbnRyeS5zaWduZWRNdXRhdGlvbiAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KGVudHJ5LnNpZ25lZE11dGF0aW9uKSkgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBwZWVyIG11dGF0aW9uIGJ1bmRsZSBlbnRyeSAke2luZGV4fSBzaWduZWRNdXRhdGlvbiBvYmplY3RgKVxuXG4gIC8qKiBAdHlwZSB7UGVlck11dGF0aW9uQnVuZGxlRW50cnl9ICovXG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSB7XG4gICAgc2lnbmVkTXV0YXRpb246IGVudHJ5LnNpZ25lZE11dGF0aW9uXG4gIH1cblxuICBpZiAoZW50cnkubG9jYWxSZWNvcmRJZCAhPT0gdW5kZWZpbmVkKSBub3JtYWxpemVkLmxvY2FsUmVjb3JkSWQgPSByZXF1aXJlZFN0cmluZyhlbnRyeS5sb2NhbFJlY29yZElkLCBgZW50cnkgJHtpbmRleH0gbG9jYWxSZWNvcmRJZGApXG4gIGlmIChlbnRyeS5sb2NhbFNlcXVlbmNlICE9PSB1bmRlZmluZWQpIG5vcm1hbGl6ZWQubG9jYWxTZXF1ZW5jZSA9IHBvc2l0aXZlSW50ZWdlcihlbnRyeS5sb2NhbFNlcXVlbmNlLCBgZW50cnkgJHtpbmRleH0gbG9jYWxTZXF1ZW5jZWApXG5cbiAgcmV0dXJuIG5vcm1hbGl6ZWRcbn1cblxuLyoqXG4gKiBSZXF1aXJlcyBhIG5vbi1lbXB0eSBzdHJpbmcuXG4gKiBAcGFyYW0ge3Vua25vd259IHZhbHVlIC0gVmFsdWUuXG4gKiBAcGFyYW0ge3N0cmluZ30gbGFiZWwgLSBMYWJlbC5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU3RyaW5nLlxuICovXG5mdW5jdGlvbiByZXF1aXJlZFN0cmluZyh2YWx1ZSwgbGFiZWwpIHtcbiAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJzdHJpbmdcIiB8fCB2YWx1ZS5sZW5ndGggPCAxKSB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIHBlZXIgbXV0YXRpb24gYnVuZGxlICR7bGFiZWx9YClcblxuICByZXR1cm4gdmFsdWVcbn1cblxuLyoqXG4gKiBSZXF1aXJlcyBhIHBvc2l0aXZlIGludGVnZXIuXG4gKiBAcGFyYW0ge3Vua25vd259IHZhbHVlIC0gVmFsdWUuXG4gKiBAcGFyYW0ge3N0cmluZ30gbGFiZWwgLSBMYWJlbC5cbiAqIEByZXR1cm5zIHtudW1iZXJ9IC0gSW50ZWdlci5cbiAqL1xuZnVuY3Rpb24gcG9zaXRpdmVJbnRlZ2VyKHZhbHVlLCBsYWJlbCkge1xuICBpZiAodHlwZW9mIHZhbHVlICE9PSBcIm51bWJlclwiIHx8ICFOdW1iZXIuaXNJbnRlZ2VyKHZhbHVlKSB8fCB2YWx1ZSA8IDEpIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgcGVlciBtdXRhdGlvbiBidW5kbGUgJHtsYWJlbH0gcG9zaXRpdmUgaW50ZWdlcmApXG5cbiAgcmV0dXJuIHZhbHVlXG59XG5cbi8qKlxuICogUmV0dXJucyBhbiBJU08gdGltZXN0YW1wIGZyb20gYSB2YWxpZCBEYXRlLlxuICogQHBhcmFtIHtEYXRlfSBkYXRlIC0gRGF0ZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBsYWJlbCAtIExhYmVsLlxuICogQHJldHVybnMge3N0cmluZ30gLSBJU08gdGltZXN0YW1wLlxuICovXG5mdW5jdGlvbiBpc29UaW1lc3RhbXAoZGF0ZSwgbGFiZWwpIHtcbiAgaWYgKCEoZGF0ZSBpbnN0YW5jZW9mIERhdGUpIHx8IE51bWJlci5pc05hTihkYXRlLmdldFRpbWUoKSkpIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBwZWVyIG11dGF0aW9uIGJ1bmRsZSAke2xhYmVsfWApXG5cbiAgcmV0dXJuIGRhdGUudG9JU09TdHJpbmcoKVxufVxuXG4vKipcbiAqIFJldHVybnMgYSBzYWZlIGVycm9yIG1lc3NhZ2UuXG4gKiBAcGFyYW0ge3Vua25vd259IGVycm9yIC0gRXJyb3IuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIE1lc3NhZ2UuXG4gKi9cbmZ1bmN0aW9uIGVycm9yTWVzc2FnZShlcnJvcikge1xuICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvcikgcmV0dXJuIGVycm9yLm1lc3NhZ2VcblxuICByZXR1cm4gU3RyaW5nKGVycm9yKVxufVxuIl19