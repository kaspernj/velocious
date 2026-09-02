/**
 * @typedef {null | string | number | boolean | unknown[] | Record<string, unknown>} SyncJsonValue
 */
/**
 * @typedef {object} SyncConflictRecord
 * @property {Record<string, SyncJsonValue>} attributes - Record attributes.
 * @property {string | number | boolean | null} [version] - Record version value.
 */
/**
 * @typedef {object} SyncConflictResult
 * @property {Record<string, SyncJsonValue>} [attributes] - Attributes to apply when replay may continue.
 * @property {Record<string, SyncJsonValue>} [conflict] - Structured conflict payload for the client/local log.
 * @property {"applied" | "conflict" | "rejected"} status - Conflict decision.
 * @property {string} strategy - Strategy that produced the decision.
 */
export type SyncJsonValue = null | string | number | boolean | unknown[] | Record<string, unknown>;
export type SyncConflictRecord = {
    /**
     * - Record attributes.
     */
    attributes: Record<string, SyncJsonValue>;
    /**
     * - Record version value.
     */
    version?: string | number | boolean | null;
};
export type SyncConflictResult = {
    /**
     * - Attributes to apply when replay may continue.
     */
    attributes?: Record<string, SyncJsonValue>;
    /**
     * - Structured conflict payload for the client/local log.
     */
    conflict?: Record<string, SyncJsonValue>;
    /**
     * - Conflict decision.
     */
    status: "applied" | "conflict" | "rejected";
    /**
     * - Strategy that produced the decision.
     */
    strategy: string;
};
/**
 * Evaluates a replay mutation against server/base state using a sync conflict strategy.
 * @param {object} args - Arguments.
 * @param {SyncConflictRecord | null} [args.baseRecord] - Record state observed when the mutation was made.
 * @param {(arg: object) => (SyncConflictResult | Promise<SyncConflictResult>)} [args.customHandler] - Resource-specific conflict hook.
 * @param {import("./device-identity.js").SyncMutation} args.mutation - Replayed mutation.
 * @param {SyncConflictRecord | null} [args.serverRecord] - Current authoritative server record.
 * @param {string} [args.strategy] - Conflict strategy.
 * @param {string} [args.versionAttribute] - Attribute used for optimistic version checks.
 * @returns {Promise<SyncConflictResult>} - Conflict decision.
 */
export declare function resolveSyncConflict({ baseRecord, customHandler, mutation, serverRecord, strategy, versionAttribute }: {
    baseRecord?: SyncConflictRecord | null;
    customHandler?: (arg: object) => (SyncConflictResult | Promise<SyncConflictResult>);
    mutation: import("./device-identity.js").SyncMutation;
    serverRecord?: SyncConflictRecord | null;
    strategy?: string;
    versionAttribute?: string;
}): Promise<SyncConflictResult>;
/**
 * Applies a server replay result to a local mutation-log record.
 * @param {object} args - Arguments.
 * @param {import("./local-mutation-log.js").default} args.mutationLog - Local mutation log.
 * @param {import("./local-mutation-log.js").LocalMutationLogRecord} args.record - Local mutation-log record.
 * @param {Record<string, SyncJsonValue>} args.result - Server replay result payload.
 * @returns {Promise<import("./local-mutation-log.js").LocalMutationLogRecord>} - Updated local record.
 */
export declare function applySyncReplayResultToLocalMutationLog({ mutationLog, record, result }: {
    mutationLog: import("./local-mutation-log.js").default;
    record: import("./local-mutation-log.js").LocalMutationLogRecord;
    result: Record<string, SyncJsonValue>;
}): Promise<import("./local-mutation-log.js").LocalMutationLogRecord>;
/**
 * Maps a server replay result to a local mutation-log status.
 * @param {Record<string, SyncJsonValue>} result - Replay result.
 * @returns {import("./local-mutation-log.js").LocalMutationStatus} - Local mutation-log status.
 */
export declare function replayResultLocalStatus(result: Record<string, SyncJsonValue>): import("./local-mutation-log.js").LocalMutationStatus;
//# sourceMappingURL=conflict-strategy.d.ts.map