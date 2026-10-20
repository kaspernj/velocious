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
 * @typedef {object} PeerMutationBundleImportResult
 * @property {Array<{clientMutationId: string, idempotencyKey: string, localRecordId: string}>} imported - Entries appended to the local log.
 * @property {Array<{errorMessage: string, index: number}>} rejected - Entries that failed verification.
 * @property {Array<{clientMutationId: string, idempotencyKey: string, localRecordId: string, reason: "duplicate"}>} skipped - Entries already present by idempotency key.
 */
/**
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGVlci1tdXRhdGlvbi1idW5kbGUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvc3luYy9wZWVyLW11dGF0aW9uLWJ1bmRsZS5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxFQUFDLG9CQUFvQixFQUFFLHNCQUFzQixFQUFFLG9CQUFvQixFQUFDLE1BQU0sc0JBQXNCLENBQUE7QUFFdkc7Ozs7OztHQU1HO0FBQ0g7Ozs7OztHQU1HO0FBQ0g7Ozs7O0dBS0c7QUFDSCxNQUFNLDJCQUEyQixHQUFHLHdDQUF3QyxDQUFBO0FBQzVFLE1BQU0sbUJBQW1CLEdBQUcsSUFBSSxHQUFHLENBQUMsQ0FBQyxTQUFTLEVBQUUsaUJBQWlCLEVBQUUsVUFBVSxDQUFDLENBQUMsQ0FBQTtBQUUvRTs7Ozs7Ozs7O0dBU0c7QUFDSCxNQUFNLENBQUMsS0FBSyxVQUFVLHdCQUF3QixDQUFDLEVBQUMsaUJBQWlCLEVBQUUsZ0JBQWdCLEVBQUUsV0FBVyxFQUFFLEdBQUcsR0FBRyxHQUFHLEVBQUUsQ0FBQyxJQUFJLElBQUksRUFBRSxFQUFFLFFBQVEsRUFBQztJQUNqSSxNQUFNLGdCQUFnQixHQUFHLHVCQUF1QixDQUFDLFFBQVEsQ0FBQyxDQUFBO0lBQzFELE1BQU0sU0FBUyxHQUFHLFlBQVksQ0FBQyxHQUFHLEVBQUUsRUFBRSxZQUFZLENBQUMsQ0FBQTtJQUNuRCxNQUFNLE9BQU8sR0FBRyxDQUFDLE1BQU0sV0FBVyxDQUFDLE9BQU8sRUFBRSxDQUFDO1NBQzFDLE1BQU0sQ0FBQyxDQUFDLE1BQU0sRUFBRSxFQUFFLENBQUMsZ0JBQWdCLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQztTQUN2RCxJQUFJLENBQUMsQ0FBQyxJQUFJLEVBQUUsS0FBSyxFQUFFLEVBQUUsQ0FBQyxJQUFJLENBQUMsUUFBUSxHQUFHLEtBQUssQ0FBQyxRQUFRLENBQUMsQ0FBQTtJQUN4RCxNQUFNLFNBQVMs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LEtBQUssUUFBUSxJQUFJLENBQUMsTUFBTSxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUMsSUFBSSxLQUFLLEdBQUcsQ0FBQztRQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsaUNBQWlDLEtBQUssbUJBQW1CLENBQUMsQ0FBQTtJQUVsSixPQUFPLEtBQUssQ0FBQTtBQUNkLENBQUM7QUFFRDs7Ozs7R0FLRztBQUNILFNBQVMsWUFBWSxDQUFDLElBQUksRUFBRSxLQUFLO0lBQy9CLElBQUksQ0FBQyxDQUFDLElBQUksWUFBWSxJQUFJLENBQUMsSUFBSSxNQUFNLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxPQUFPLEVBQUUsQ0FBQztRQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsZ0NBQWdDLEtBQUssRUFBRSxDQUFDLENBQUE7SUFFckgsT0FBTyxJQUFJLENBQUMsV0FBVyxFQUFFLENBQUE7QUFDM0IsQ0FBQztBQUVEOzs7O0dBSUc7QUFDSCxTQUFTLFlBQVksQ0FBQyxLQUFLO0lBQ3pCLElBQUksS0FBSyxZQUFZLEtBQUs7UUFBRSxPQUFPLEtBQUssQ0FBQyxPQUFPLENBQUE7SUFFaEQsT0FBTyxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUE7QUFDdEIsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQge2NyZWF0ZVNpZ25lZE11dGF0aW9uLCBtdXRhdGlvbklkZW1wb3RlbmN5S2V5LCB2ZXJpZnlTaWduZWRNdXRhdGlvbn0gZnJvbSBcIi4vZGV2aWNlLWlkZW50aXR5LmpzXCJcblxuLyoqXG4gKiBQZWVyIG11dGF0aW9uIGJ1bmRsZSBleHBvcnRlZCBieSBhIGRldmljZSBmb3Igb2ZmbGluZS9QMlAgdHJhbnNmZXIuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBQZWVyTXV0YXRpb25CdW5kbGVcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBleHBvcnRlZEF0IC0gSVNPIHRpbWVzdGFtcCB3aGVuIHRoZSBidW5kbGUgd2FzIGV4cG9ydGVkLlxuICogQHByb3BlcnR5IHtcInZlbG9jaW91cy5zeW5jLnBlZXItbXV0YXRpb24tYnVuZGxlLnYxXCJ9IGZvcm1hdCAtIEJ1bmRsZSBmb3JtYXQgaWRlbnRpZmllci5cbiAqIEBwcm9wZXJ0eSB7UGVlck11dGF0aW9uQnVuZGxlRW50cnlbXX0gbXV0YXRpb25zIC0gU2lnbmVkIG11dGF0aW9ucyBpbiBsb2NhbCBzZXF1ZW5jZSBvcmRlci5cbiAqL1xuLyoqXG4gKiBPbmUgcGVlciBtdXRhdGlvbiBidW5kbGUgZW50cnkuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBQZWVyTXV0YXRpb25CdW5kbGVJbXBvcnRSZXN1bHRcbiAqIEBwcm9wZXJ0eSB7QXJyYXk8e2NsaWVudE11dGF0aW9uSWQ6IHN0cmluZywgaWRlbXBvdGVuY3lLZXk6IHN0cmluZywgbG9jYWxSZWNvcmRJZDogc3RyaW5nfT59IGltcG9ydGVkIC0gRW50cmllcyBhcHBlbmRlZCB0byB0aGUgbG9jYWwgbG9nLlxuICogQHByb3BlcnR5IHtBcnJheTx7ZXJyb3JNZXNzYWdlOiBzdHJpbmcsIGluZGV4OiBudW1iZXJ9Pn0gcmVqZWN0ZWQgLSBFbnRyaWVzIHRoYXQgZmFpbGVkIHZlcmlmaWNhdGlvbi5cbiAqIEBwcm9wZXJ0eSB7QXJyYXk8e2NsaWVudE11dGF0aW9uSWQ6IHN0cmluZywgaWRlbXBvdGVuY3lLZXk6IHN0cmluZywgbG9jYWxSZWNvcmRJZDogc3RyaW5nLCByZWFzb246IFwiZHVwbGljYXRlXCJ9Pn0gc2tpcHBlZCAtIEVudHJpZXMgYWxyZWFkeSBwcmVzZW50IGJ5IGlkZW1wb3RlbmN5IGtleS5cbiAqL1xuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBQZWVyTXV0YXRpb25CdW5kbGVFbnRyeVxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtsb2NhbFJlY29yZElkXSAtIEV4cG9ydGluZyBkZXZpY2UncyBsb2NhbCBtdXRhdGlvbiByZWNvcmQgaWQuXG4gKiBAcHJvcGVydHkge251bWJlcn0gW2xvY2FsU2VxdWVuY2VdIC0gRXhwb3J0aW5nIGRldmljZSdzIGxvY2FsIG11dGF0aW9uIHNlcXVlbmNlLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuL2RldmljZS1pZGVudGl0eS5qc1wiKS5TaWduZWRTeW5jTXV0YXRpb259IHNpZ25lZE11dGF0aW9uIC0gRGV2aWNlLXNpZ25lZCBtdXRhdGlvbiBlbnZlbG9wZS5cbiAqL1xuY29uc3QgUEVFUl9NVVRBVElPTl9CVU5ETEVfRk9STUFUID0gXCJ2ZWxvY2lvdXMuc3luYy5wZWVyLW11dGF0aW9uLWJ1bmRsZS52MVwiXG5jb25zdCBFWFBPUlRBQkxFX1NUQVRVU0VTID0gbmV3IFNldChbXCJwZW5kaW5nXCIsIFwiYXBwbGllZC1sb2NhbGx5XCIsIFwiY29uZmxpY3RcIl0pXG5cbi8qKlxuICogRXhwb3J0cyBsb2NhbCBub24tdGVybWluYWwgbXV0YXRpb25zIGFzIGEgc2lnbmVkIHBlZXItdHJhbnNmZXIgYnVuZGxlLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vZGV2aWNlLWlkZW50aXR5LmpzXCIpLkRldmljZUNlcnRpZmljYXRlfSBhcmdzLmRldmljZUNlcnRpZmljYXRlIC0gRGV2aWNlIGNlcnRpZmljYXRlIGZvciBzaWduaW5nIHJlY29yZHMuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vZGV2aWNlLWlkZW50aXR5LmpzXCIpLlN5bmNKc29uV2ViS2V5fSBhcmdzLmRldmljZVByaXZhdGVLZXkgLSBEZXZpY2UgcHJpdmF0ZSBrZXkgZm9yIHNpZ25pbmcgcmVjb3Jkcy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9sb2NhbC1tdXRhdGlvbi1sb2cuanNcIikuZGVmYXVsdH0gYXJncy5tdXRhdGlvbkxvZyAtIExvY2FsIG11dGF0aW9uIGxvZy5cbiAqIEBwYXJhbSB7KCkgPT4gRGF0ZX0gW2FyZ3Mubm93XSAtIEV4cG9ydCBjbG9jay5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9sb2NhbC1tdXRhdGlvbi1sb2cuanNcIikuTG9jYWxNdXRhdGlvblN0YXR1c1tdfSBbYXJncy5zdGF0dXNlc10gLSBTdGF0dXNlcyB0byBleHBvcnQuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxQZWVyTXV0YXRpb25CdW5kbGU+fSAtIFNpZ25lZCBwZWVyIG11dGF0aW9uIGJ1bmRsZS5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGV4cG9ydFBlZXJNdXRhdGlvbkJ1bmRsZSh7ZGV2aWNlQ2VydGlmaWNhdGUsIGRldmljZVByaXZhdGVLZXksIG11dGF0aW9uTG9nLCBub3cgPSAoKSA9PiBuZXcgRGF0ZSgpLCBzdGF0dXNlc30pIHtcbiAgY29uc3Qgc2VsZWN0ZWRTdGF0dXNlcyA9IG5vcm1hbGl6ZUV4cG9ydFN0YXR1c2VzKHN0YXR1c2VzKVxuICBjb25zdCB0aW1lc3RhbXAgPSBpc29UaW1lc3RhbXAobm93KCksIFwiZXhwb3J0ZWRBdFwiKVxuICBjb25zdCByZWNvcmRzID0gKGF3YWl0IG11dGF0aW9uTG9nLnJlY29yZHMoKSlcbiAgICAuZmlsdGVyKChyZWNvcmQpID0+IHNlbGVjdGVkU3RhdHVzZXMuaGFzKHJlY29yZC5zdGF0dXMpKVxuICAgIC5zb3J0KChsZWZ0LCByaWdodCkgPT4gbGVmdC5zZXF1ZW5jZSAtIHJpZ2h0LnNlcXVlbmNlKVxuICBjb25zdCBtdXRhdGlvbnMgPSBbXVxuXG4gIGZvciAoY29uc3QgcmVjb3JkIG9mIHJlY29yZHMpIHtcbiAgICBtdXRhdGlvbnMucHVzaCh7XG4gICAgICBsb2NhbFJlY29yZElkOiByZWNvcmQuaWQsXG4gICAgICBsb2NhbFNlcXVlbmNlOiByZWNvcmQuc2VxdWVuY2UsXG4gICAgICBzaWduZWRNdXRhdGlvbjogcmVjb3JkLnNpZ25lZE11dGF0aW9uXG4gICAgICAgID8gLyoqIEB0eXBlIHtpbXBvcnQoXCIuL2RldmljZS1pZGVudGl0eS5qc1wiKS5TaWduZWRTeW5jTXV0YXRpb259ICovIChyZWNvcmQuc2lnbmVkTXV0YXRpb24pXG4gICAgICAgIDogYXdhaXQgY3JlYXRlU2lnbmVkTXV0YXRpb24oe1xuICAgICAgICAgIGRldmljZUNlcnRpZmljYXRlLFxuICAgICAgICAgIGRldmljZVByaXZhdGVLZXksXG4gICAgICAgICAgbXV0YXRpb246IHJlY29yZC5tdXRhdGlvblxuICAgICAgICB9KVxuICAgIH0pXG4gIH1cblxuICByZXR1cm4ge1xuICAgIGV4cG9ydGVkQXQ6IHRpbWVzdGFtcCxcbiAgICBmb3JtYXQ6IFBFRVJfTVVUQVRJT05fQlVORExFX0ZPUk1BVCxcbiAgICBtdXRhdGlvbnNcbiAgfVxufVxuXG4vKipcbiAqIEltcG9ydHMgdmVyaWZpZWQgcGVlciBtdXRhdGlvbnMgaW50byB0aGUgbG9jYWwgbXV0YXRpb24gbG9nLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vZGV2aWNlLWlkZW50aXR5LmpzXCIpLlN5bmNKc29uV2ViS2V5fSBhcmdzLmJhY2tlbmRQdWJsaWNLZXkgLSBCYWNrZW5kIHB1YmxpYyBrZXkgZm9yIHZlcmlmeWluZyBwZWVyIGNlcnRpZmljYXRlcy5cbiAqIEBwYXJhbSB7UGVlck11dGF0aW9uQnVuZGxlfSBhcmdzLmJ1bmRsZSAtIFBlZXIgYnVuZGxlIHRvIGltcG9ydC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9sb2NhbC1tdXRhdGlvbi1sb2cuanNcIikuZGVmYXVsdH0gYXJncy5tdXRhdGlvbkxvZyAtIExvY2FsIG11dGF0aW9uIGxvZy5cbiAqIEBwYXJhbSB7RGF0ZX0gW2FyZ3Mubm93XSAtIFZlcmlmaWNhdGlvbiB0aW1lLlxuICogQHJldHVybnMge1Byb21pc2U8e2ltcG9ydGVkOiB7Y2xpZW50TXV0YXRpb25JZDogc3RyaW5nLCBpZGVtcG90ZW5jeUtleTogc3RyaW5nLCBsb2NhbFJlY29yZElkOiBzdHJpbmd9W10sIHJlamVjdGVkOiB7ZXJyb3JNZXNzYWdlOiBzdHJpbmcsIGluZGV4OiBudW1iZXJ9W10sIHNraXBwZWQ6IHtjbGllbnRNdXRhdGlvbklkOiBzdHJpbmcsIGlkZW1wb3RlbmN5S2V5OiBzdHJpbmcsIGxvY2FsUmVjb3JkSWQ6IHN0cmluZywgcmVhc29uOiBcImR1cGxpY2F0ZVwifVtdfT59IC0gSW1wb3J0IHJlc3VsdC5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGltcG9ydFBlZXJNdXRhdGlvbkJ1bmRsZSh7YmFja2VuZFB1YmxpY0tleSwgYnVuZGxlLCBtdXRhdGlvbkxvZywgbm93ID0gbmV3IERhdGUoKX0pIHtcbiAgY29uc3Qgbm9ybWFsaXplZEJ1bmRsZSA9IG5vcm1hbGl6ZVBlZXJNdXRhdGlvbkJ1bmRsZShidW5kbGUpXG4gIGNvbnN0IGV4aXN0aW5nUmVjb3JkcyA9IGF3YWl0IG11dGF0aW9uTG9nLnJlY29yZHMoKVxuICBjb25zdCBleGlzdGluZ0J5SWRlbXBvdGVuY3lLZXkgPSBuZXcgTWFwKGV4aXN0aW5nUmVjb3Jkcy5tYXAoKHJlY29yZCkgPT4gW211dGF0aW9uSWRlbXBvdGVuY3lLZXkoe211dGF0aW9uOiByZWNvcmQubXV0YXRpb259KSwgcmVjb3JkXSkpXG4gIC8qKiBAdHlwZSB7e2NsaWVudE11dGF0aW9uSWQ6IHN0cmluZywgaWRlbXBvdGVuY3lLZXk6IHN0cmluZywgbG9jYWxSZWNvcmRJZDogc3RyaW5nfVtdfSAqL1xuICBjb25zdCBpbXBvcnRlZCA9IFtdXG4gIC8qKiBAdHlwZSB7e2Vycm9yTWVzc2FnZTogc3RyaW5nLCBpbmRleDogbnVtYmVyfVtdfSAqL1xuICBjb25zdCByZWplY3RlZCA9IFtdXG4gIC8qKiBAdHlwZSB7e2NsaWVudE11dGF0aW9uSWQ6IHN0cmluZywgaWRlbXBvdGVuY3lLZXk6IHN0cmluZywgbG9jYWxSZWNvcmRJZDogc3RyaW5nLCByZWFzb246IFwiZHVwbGljYXRlXCJ9W119ICovXG4gIGNvbnN0IHNraXBwZWQgPSBbXVxuXG4gIGZvciAoY29uc3QgW2luZGV4LCBlbnRyeV0gb2Ygbm9ybWFsaXplZEJ1bmRsZS5tdXRhdGlvbnMuZW50cmllcygpKSB7XG4gICAgY29uc3QgbXV0YXRpb24gPSBhd2FpdCB2ZXJpZmllZEJ1bmRsZU11dGF0aW9uKHtiYWNrZW5kUHVibGljS2V5LCBlbnRyeSwgaW5kZXgsIG5vdywgcmVqZWN0ZWR9KVxuXG4gICAgaWYgKCFtdXRhdGlvbikgY29udGludWVcblxuICAgIGNvbnN0IGlkZW1wb3RlbmN5S2V5ID0gbXV0YXRpb25JZGVtcG90ZW5jeUtleShlbnRyeS5zaWduZWRNdXRhdGlvbilcbiAgICBjb25zdCBkdXBsaWNhdGVSZWNvcmQgPSBleGlzdGluZ0J5SWRlbXBvdGVuY3lLZXkuZ2V0KGlkZW1wb3RlbmN5S2V5KVxuXG4gICAgaWYgKGR1cGxpY2F0ZVJlY29yZCkge1xuICAgICAgc2tpcHBlZC5wdXNoKHtcbiAgICAgICAgY2xpZW50TXV0YXRpb25JZDogbXV0YXRpb24uY2xpZW50TXV0YXRpb25JZCxcbiAgICAgICAgaWRlbXBvdGVuY3lLZXksXG4gICAgICAgIGxvY2FsUmVjb3JkSWQ6IGR1cGxpY2F0ZVJlY29yZC5pZCxcbiAgICAgICAgcmVhc29uOiAvKiogQHR5cGUge1wiZHVwbGljYXRlXCJ9ICovIChcImR1cGxpY2F0ZVwiKVxuICAgICAgfSlcbiAgICAgIGNvbnRpbnVlXG4gICAgfVxuXG4gICAgY29uc3QgcmVjb3JkID0gYXdhaXQgbXV0YXRpb25Mb2cuYXBwZW5kKHttdXRhdGlvbiwgc2lnbmVkTXV0YXRpb246IGVudHJ5LnNpZ25lZE11dGF0aW9ufSlcbiAgICBjb25zdCB1cGRhdGVkID0gYXdhaXQgbXV0YXRpb25Mb2cudXBkYXRlU3RhdHVzKHtpZDogcmVjb3JkLmlkLCBzdGF0dXM6IFwicGVlci1hcHBsaWVkXCJ9KVxuICAgIGV4aXN0aW5nQnlJZGVtcG90ZW5jeUtleS5zZXQoaWRlbXBvdGVuY3lLZXksIHVwZGF0ZWQpXG4gICAgaW1wb3J0ZWQucHVzaCh7Y2xpZW50TXV0YXRpb25JZDogbXV0YXRpb24uY2xpZW50TXV0YXRpb25JZCwgaWRlbXBvdGVuY3lLZXksIGxvY2FsUmVjb3JkSWQ6IHVwZGF0ZWQuaWR9KVxuICB9XG5cbiAgcmV0dXJuIHtpbXBvcnRlZCwgcmVqZWN0ZWQsIHNraXBwZWR9XG59XG5cbi8qKlxuICogVmVyaWZpZXMgYSBidW5kbGUgbXV0YXRpb24gYW5kIHJlY29yZHMgbm9ybWFsIHBlci1lbnRyeSB2ZXJpZmljYXRpb24gcmVqZWN0aW9ucy5cbiAqIFN0b3JhZ2Ugd3JpdGVzIGludGVudGlvbmFsbHkgaGFwcGVuIG91dHNpZGUgdGhpcyBoZWxwZXIgc28gc3RvcmFnZSBmYWlsdXJlcyBlc2NhcGUgaW1wb3J0LlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vZGV2aWNlLWlkZW50aXR5LmpzXCIpLlN5bmNKc29uV2ViS2V5fSBhcmdzLmJhY2tlbmRQdWJsaWNLZXkgLSBCYWNrZW5kIHB1YmxpYyBrZXkuXG4gKiBAcGFyYW0ge1BlZXJNdXRhdGlvbkJ1bmRsZUVudHJ5fSBhcmdzLmVudHJ5IC0gQnVuZGxlIGVudHJ5LlxuICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MuaW5kZXggLSBFbnRyeSBpbmRleC5cbiAqIEBwYXJhbSB7RGF0ZX0gYXJncy5ub3cgLSBWZXJpZmljYXRpb24gdGltZS5cbiAqIEBwYXJhbSB7e2Vycm9yTWVzc2FnZTogc3RyaW5nLCBpbmRleDogbnVtYmVyfVtdfSBhcmdzLnJlamVjdGVkIC0gUmVqZWN0aW9uIGFjY3VtdWxhdG9yLlxuICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi9kZXZpY2UtaWRlbnRpdHkuanNcIikuU3luY011dGF0aW9uIHwgbnVsbD59IC0gVmVyaWZpZWQgbXV0YXRpb24sIG9yIG51bGwgd2hlbiByZWplY3RlZC5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gdmVyaWZpZWRCdW5kbGVNdXRhdGlvbih7YmFja2VuZFB1YmxpY0tleSwgZW50cnksIGluZGV4LCBub3csIHJlamVjdGVkfSkge1xuICB0cnkge1xuICAgIHJldHVybiBhd2FpdCB2ZXJpZnlTaWduZWRNdXRhdGlvbih7YmFja2VuZFB1YmxpY0tleSwgbm93LCBzaWduZWRNdXRhdGlvbjogZW50cnkuc2lnbmVkTXV0YXRpb259KVxuICB9IGNhdGNoIChlcnJvcikge1xuICAgIHJlamVjdGVkLnB1c2goe2Vycm9yTWVzc2FnZTogZXJyb3JNZXNzYWdlKGVycm9yKSwgaW5kZXh9KVxuXG4gICAgcmV0dXJuIG51bGxcbiAgfVxufVxuXG4vKipcbiAqIE5vcm1hbGl6ZXMgZXhwb3J0IHN0YXR1cyBmaWx0ZXJzLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2xvY2FsLW11dGF0aW9uLWxvZy5qc1wiKS5Mb2NhbE11dGF0aW9uU3RhdHVzW10gfCB1bmRlZmluZWR9IHN0YXR1c2VzIC0gT3B0aW9uYWwgc3RhdHVzZXMuXG4gKiBAcmV0dXJucyB7U2V0PGltcG9ydChcIi4vbG9jYWwtbXV0YXRpb24tbG9nLmpzXCIpLkxvY2FsTXV0YXRpb25TdGF0dXM+fSAtIFN0YXR1cyBzZXQuXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZUV4cG9ydFN0YXR1c2VzKHN0YXR1c2VzKSB7XG4gIGlmIChzdGF0dXNlcyA9PT0gdW5kZWZpbmVkKSByZXR1cm4gLyoqIEB0eXBlIHtTZXQ8aW1wb3J0KFwiLi9sb2NhbC1tdXRhdGlvbi1sb2cuanNcIikuTG9jYWxNdXRhdGlvblN0YXR1cz59ICovIChuZXcgU2V0KEVYUE9SVEFCTEVfU1RBVFVTRVMpKVxuICBpZiAoIUFycmF5LmlzQXJyYXkoc3RhdHVzZXMpKSB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RlZCBwZWVyIG11dGF0aW9uIGV4cG9ydCBzdGF0dXNlcyBhcnJheVwiKVxuXG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSBuZXcgU2V0KClcblxuICBmb3IgKGNvbnN0IHN0YXR1cyBvZiBzdGF0dXNlcykge1xuICAgIGlmICghRVhQT1JUQUJMRV9TVEFUVVNFUy5oYXMoc3RhdHVzKSkgdGhyb3cgbmV3IEVycm9yKGBVbnN1cHBvcnRlZCBwZWVyIG11dGF0aW9uIGV4cG9ydCBzdGF0dXMgJyR7U3RyaW5nKHN0YXR1cyl9J2ApXG4gICAgbm9ybWFsaXplZC5hZGQoc3RhdHVzKVxuICB9XG5cbiAgcmV0dXJuIC8qKiBAdHlwZSB7U2V0PGltcG9ydChcIi4vbG9jYWwtbXV0YXRpb24tbG9nLmpzXCIpLkxvY2FsTXV0YXRpb25TdGF0dXM+fSAqLyAobm9ybWFsaXplZClcbn1cblxuLyoqXG4gKiBOb3JtYWxpemVzIGEgcGVlciBtdXRhdGlvbiBidW5kbGUuXG4gKiBAcGFyYW0ge1BlZXJNdXRhdGlvbkJ1bmRsZX0gYnVuZGxlIC0gQnVuZGxlIHZhbHVlLlxuICogQHJldHVybnMge1BlZXJNdXRhdGlvbkJ1bmRsZX0gLSBOb3JtYWxpemVkIGJ1bmRsZS5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplUGVlck11dGF0aW9uQnVuZGxlKGJ1bmRsZSkge1xuICBpZiAoIWJ1bmRsZSB8fCB0eXBlb2YgYnVuZGxlICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkoYnVuZGxlKSkgdGhyb3cgbmV3IEVycm9yKFwiRXhwZWN0ZWQgcGVlciBtdXRhdGlvbiBidW5kbGUgb2JqZWN0XCIpXG4gIGlmIChidW5kbGUuZm9ybWF0ICE9PSBQRUVSX01VVEFUSU9OX0JVTkRMRV9GT1JNQVQpIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgcGVlciBtdXRhdGlvbiBidW5kbGUgZm9ybWF0ICcke1N0cmluZyhidW5kbGUuZm9ybWF0KX0nYClcbiAgaXNvVGltZXN0YW1wKG5ldyBEYXRlKHJlcXVpcmVkU3RyaW5nKGJ1bmRsZS5leHBvcnRlZEF0LCBcImV4cG9ydGVkQXRcIikpLCBcImV4cG9ydGVkQXRcIilcbiAgaWYgKCFBcnJheS5pc0FycmF5KGJ1bmRsZS5tdXRhdGlvbnMpKSB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RlZCBwZWVyIG11dGF0aW9uIGJ1bmRsZSBtdXRhdGlvbnMgYXJyYXlcIilcblxuICByZXR1cm4ge1xuICAgIGV4cG9ydGVkQXQ6IGJ1bmRsZS5leHBvcnRlZEF0LFxuICAgIGZvcm1hdDogYnVuZGxlLmZvcm1hdCxcbiAgICBtdXRhdGlvbnM6IGJ1bmRsZS5tdXRhdGlvbnMubWFwKChlbnRyeSwgaW5kZXgpID0+IG5vcm1hbGl6ZVBlZXJNdXRhdGlvbkJ1bmRsZUVudHJ5KGVudHJ5LCBpbmRleCkpXG4gIH1cbn1cblxuLyoqXG4gKiBOb3JtYWxpemVzIG9uZSBwZWVyIG11dGF0aW9uIGJ1bmRsZSBlbnRyeS5cbiAqIEBwYXJhbSB7UGVlck11dGF0aW9uQnVuZGxlRW50cnl9IGVudHJ5IC0gQnVuZGxlIGVudHJ5LlxuICogQHBhcmFtIHtudW1iZXJ9IGluZGV4IC0gRW50cnkgaW5kZXguXG4gKiBAcmV0dXJucyB7UGVlck11dGF0aW9uQnVuZGxlRW50cnl9IC0gTm9ybWFsaXplZCBlbnRyeS5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplUGVlck11dGF0aW9uQnVuZGxlRW50cnkoZW50cnksIGluZGV4KSB7XG4gIGlmICghZW50cnkgfHwgdHlwZW9mIGVudHJ5ICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkoZW50cnkpKSB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIHBlZXIgbXV0YXRpb24gYnVuZGxlIGVudHJ5ICR7aW5kZXh9IG9iamVjdGApXG4gIGlmICghZW50cnkuc2lnbmVkTXV0YXRpb24gfHwgdHlwZW9mIGVudHJ5LnNpZ25lZE11dGF0aW9uICE9PSBcIm9iamVjdFwiIHx8IEFycmF5LmlzQXJyYXkoZW50cnkuc2lnbmVkTXV0YXRpb24pKSB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIHBlZXIgbXV0YXRpb24gYnVuZGxlIGVudHJ5ICR7aW5kZXh9IHNpZ25lZE11dGF0aW9uIG9iamVjdGApXG5cbiAgLyoqIEB0eXBlIHtQZWVyTXV0YXRpb25CdW5kbGVFbnRyeX0gKi9cbiAgY29uc3Qgbm9ybWFsaXplZCA9IHtcbiAgICBzaWduZWRNdXRhdGlvbjogZW50cnkuc2lnbmVkTXV0YXRpb25cbiAgfVxuXG4gIGlmIChlbnRyeS5sb2NhbFJlY29yZElkICE9PSB1bmRlZmluZWQpIG5vcm1hbGl6ZWQubG9jYWxSZWNvcmRJZCA9IHJlcXVpcmVkU3RyaW5nKGVudHJ5LmxvY2FsUmVjb3JkSWQsIGBlbnRyeSAke2luZGV4fSBsb2NhbFJlY29yZElkYClcbiAgaWYgKGVudHJ5LmxvY2FsU2VxdWVuY2UgIT09IHVuZGVmaW5lZCkgbm9ybWFsaXplZC5sb2NhbFNlcXVlbmNlID0gcG9zaXRpdmVJbnRlZ2VyKGVudHJ5LmxvY2FsU2VxdWVuY2UsIGBlbnRyeSAke2luZGV4fSBsb2NhbFNlcXVlbmNlYClcblxuICByZXR1cm4gbm9ybWFsaXplZFxufVxuXG4vKipcbiAqIFJlcXVpcmVzIGEgbm9uLWVtcHR5IHN0cmluZy5cbiAqIEBwYXJhbSB7dW5rbm93bn0gdmFsdWUgLSBWYWx1ZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBsYWJlbCAtIExhYmVsLlxuICogQHJldHVybnMge3N0cmluZ30gLSBTdHJpbmcuXG4gKi9cbmZ1bmN0aW9uIHJlcXVpcmVkU3RyaW5nKHZhbHVlLCBsYWJlbCkge1xuICBpZiAodHlwZW9mIHZhbHVlICE9PSBcInN0cmluZ1wiIHx8IHZhbHVlLmxlbmd0aCA8IDEpIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgcGVlciBtdXRhdGlvbiBidW5kbGUgJHtsYWJlbH1gKVxuXG4gIHJldHVybiB2YWx1ZVxufVxuXG4vKipcbiAqIFJlcXVpcmVzIGEgcG9zaXRpdmUgaW50ZWdlci5cbiAqIEBwYXJhbSB7dW5rbm93bn0gdmFsdWUgLSBWYWx1ZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBsYWJlbCAtIExhYmVsLlxuICogQHJldHVybnMge251bWJlcn0gLSBJbnRlZ2VyLlxuICovXG5mdW5jdGlvbiBwb3NpdGl2ZUludGVnZXIodmFsdWUsIGxhYmVsKSB7XG4gIGlmICh0eXBlb2YgdmFsdWUgIT09IFwibnVtYmVyXCIgfHwgIU51bWJlci5pc0ludGVnZXIodmFsdWUpIHx8IHZhbHVlIDwgMSkgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBwZWVyIG11dGF0aW9uIGJ1bmRsZSAke2xhYmVsfSBwb3NpdGl2ZSBpbnRlZ2VyYClcblxuICByZXR1cm4gdmFsdWVcbn1cblxuLyoqXG4gKiBSZXR1cm5zIGFuIElTTyB0aW1lc3RhbXAgZnJvbSBhIHZhbGlkIERhdGUuXG4gKiBAcGFyYW0ge0RhdGV9IGRhdGUgLSBEYXRlLlxuICogQHBhcmFtIHtzdHJpbmd9IGxhYmVsIC0gTGFiZWwuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIElTTyB0aW1lc3RhbXAuXG4gKi9cbmZ1bmN0aW9uIGlzb1RpbWVzdGFtcChkYXRlLCBsYWJlbCkge1xuICBpZiAoIShkYXRlIGluc3RhbmNlb2YgRGF0ZSkgfHwgTnVtYmVyLmlzTmFOKGRhdGUuZ2V0VGltZSgpKSkgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHBlZXIgbXV0YXRpb24gYnVuZGxlICR7bGFiZWx9YClcblxuICByZXR1cm4gZGF0ZS50b0lTT1N0cmluZygpXG59XG5cbi8qKlxuICogUmV0dXJucyBhIHNhZmUgZXJyb3IgbWVzc2FnZS5cbiAqIEBwYXJhbSB7dW5rbm93bn0gZXJyb3IgLSBFcnJvci5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gTWVzc2FnZS5cbiAqL1xuZnVuY3Rpb24gZXJyb3JNZXNzYWdlKGVycm9yKSB7XG4gIGlmIChlcnJvciBpbnN0YW5jZW9mIEVycm9yKSByZXR1cm4gZXJyb3IubWVzc2FnZVxuXG4gIHJldHVybiBTdHJpbmcoZXJyb3IpXG59XG4iXX0=