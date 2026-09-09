export type PeerMutationBundle = {
    /**
     * - ISO timestamp when the bundle was exported.
     */
    exportedAt: string;
    /**
     * - Bundle format identifier.
     */
    format: "velocious.sync.peer-mutation-bundle.v1";
    /**
     * - Signed mutations in local sequence order.
     */
    mutations: PeerMutationBundleEntry[];
};
export type PeerMutationBundleEntry = {
    /**
     * - Exporting device's local mutation record id.
     */
    localRecordId?: string;
    /**
     * - Exporting device's local mutation sequence.
     */
    localSequence?: number;
    /**
     * - Device-signed mutation envelope.
     */
    signedMutation: import("./device-identity.js").SignedSyncMutation;
};
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
export declare function exportPeerMutationBundle({ deviceCertificate, devicePrivateKey, mutationLog, now, statuses }: {
    deviceCertificate: import("./device-identity.js").DeviceCertificate;
    devicePrivateKey: import("./device-identity.js").SyncJsonWebKey;
    mutationLog: import("./local-mutation-log.js").default;
    now?: () => Date;
    statuses?: import("./local-mutation-log.js").LocalMutationStatus[];
}): Promise<PeerMutationBundle>;
/**
 * Imports verified peer mutations into the local mutation log.
 * @param {object} args - Arguments.
 * @param {import("./device-identity.js").SyncJsonWebKey} args.backendPublicKey - Backend public key for verifying peer certificates.
 * @param {PeerMutationBundle} args.bundle - Peer bundle to import.
 * @param {import("./local-mutation-log.js").default} args.mutationLog - Local mutation log.
 * @param {Date} [args.now] - Verification time.
 * @returns {Promise<{imported: {clientMutationId: string, idempotencyKey: string, localRecordId: string}[], rejected: {errorMessage: string, index: number}[], skipped: {clientMutationId: string, idempotencyKey: string, localRecordId: string, reason: "duplicate"}[]}>} - Import result.
 */
export declare function importPeerMutationBundle({ backendPublicKey, bundle, mutationLog, now }: {
    backendPublicKey: import("./device-identity.js").SyncJsonWebKey;
    bundle: PeerMutationBundle;
    mutationLog: import("./local-mutation-log.js").default;
    now?: Date;
}): Promise<{
    imported: {
        clientMutationId: string;
        idempotencyKey: string;
        localRecordId: string;
    }[];
    rejected: {
        errorMessage: string;
        index: number;
    }[];
    skipped: {
        clientMutationId: string;
        idempotencyKey: string;
        localRecordId: string;
        reason: "duplicate";
    }[];
}>;
//# sourceMappingURL=peer-mutation-bundle.d.ts.map