/**
 * Wraps change-feed data with replay acknowledgement metadata in the existing
 * durable sync-row data column.
 * @param {{acknowledgementVersion: string | number | null, clientMutationId: string, payload: ReturnType<typeof JSON.parse>, payloadFingerprint: string}} args - Durable replay metadata and public payload.
 * @returns {string} Serialized durable value.
 */
export declare function serializeReplayPersistedData({ acknowledgementVersion, clientMutationId, payload, payloadFingerprint }: {
    acknowledgementVersion: string | number | null;
    clientMutationId: string;
    payload: ReturnType<typeof JSON.parse>;
    payloadFingerprint: string;
}): string;
/**
 * Decodes framework-owned replay metadata while leaving ordinary sync data unchanged.
 * @param {ReturnType<typeof JSON.parse>} value - Parsed or serialized sync-row data.
 * @returns {{metadata: {acknowledgementVersion: string | number | null, clientMutationId: string, payloadFingerprint: string} | null, payload: ReturnType<typeof JSON.parse>}} Decoded metadata and public payload.
 */
export declare function decodeReplayPersistedData(value: ReturnType<typeof JSON.parse>): {
    metadata: {
        acknowledgementVersion: string | number | null;
        clientMutationId: string;
        payloadFingerprint: string;
    } | null;
    payload: ReturnType<typeof JSON.parse>;
};
//# sourceMappingURL=sync-replay-persisted-data.d.ts.map