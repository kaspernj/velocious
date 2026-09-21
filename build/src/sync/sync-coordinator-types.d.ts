export type SyncCoordinatorState = "backoff" | "conflicted" | "failed" | "idle" | "offline" | "pending" | "stopped" | "syncing";
export type SyncConflictDiagnostic = {
    /**
     * - Version the local mutation was based on.
     */
    baseVersion: string | number | null;
    /**
     * - Durable client idempotency identifier.
     */
    clientMutationId: string;
    /**
     * - Optional client version returned by the conflict contract.
     */
    localVersion: string | number | null;
    /**
     * - Durable local mutation-log record id.
     */
    recordId: string;
    /**
     * - Stable resource identifier.
     */
    resourceId: string;
    /**
     * - Stable resource/model type.
     */
    resourceType: string;
    /**
     * - Authoritative server version.
     */
    serverVersion: string | number | null;
    /**
     * - Authoritative version attribute name.
     */
    versionAttribute: string | null;
};
export type SyncCoordinatorFailure = {
    /**
     * - Consecutive cycle attempt number.
     */
    attempt: number;
    /**
     * - ISO timestamp of the failure.
     */
    at: string;
    /**
     * - Stable safe error code.
     */
    code: string;
    /**
     * - Optional safe display message.
     */
    message?: string;
    /**
     * - Whether automatic retry is allowed.
     */
    retryable: boolean;
};
export type SyncCoordinatorStatus = {
    /**
     * - Privacy-safe unresolved conflicts.
     */
    conflicts: ReadonlyArray<SyncConflictDiagnostic>;
    /**
     * - Last unresolved cycle failure.
     */
    failure: SyncCoordinatorFailure | null;
    /**
     * - Last successful online cycle timestamp.
     */
    lastSuccessAt: string | null;
    /**
     * - Scheduled automatic retry timestamp.
     */
    nextRetryAt: string | null;
    /**
     * - Durable pending mutation count.
     */
    pendingCount: number;
    /**
     * - Durable permanently rejected mutation count.
     */
    rejectedCount: number;
    /**
     * - Observable lifecycle state.
     */
    state: SyncCoordinatorState;
};
export type SyncClientInspection = {
    /**
     * - Privacy-safe conflict diagnostics.
     */
    conflicts: ReadonlyArray<SyncConflictDiagnostic>;
    /**
     * - Durable pending mutation count.
     */
    pendingCount: number;
    /**
     * - Durable rejected mutation count.
     */
    rejectedCount: number;
};
export type SyncCoordinatorConnectivity = {
    /**
     * - Subscribes to connectivity changes.
     */
    subscribe: (listener: (online: boolean) => void) => (() => void);
};
export type SyncCoordinatorScheduler = {
    /**
     * - Clears a scheduled retry.
     */
    clearTimeout: (timer: unknown) => void;
    /**
     * - Schedules a retry.
     */
    setTimeout: (callback: () => void, delayMs: number) => unknown;
};
export type SyncCoordinatorStatusStore = {
    /**
     * - Loads the last safe snapshot.
     */
    load: () => Promise<SyncCoordinatorStatus | null> | SyncCoordinatorStatus | null;
    /**
     * - Persists one safe snapshot.
     */
    save: (status: SyncCoordinatorStatus) => Promise<void> | void;
};
/** @typedef {"backoff" | "conflicted" | "failed" | "idle" | "offline" | "pending" | "stopped" | "syncing"} SyncCoordinatorState */
/**
 * Privacy-safe conflict metadata for status surfaces. Mutation attributes,
 * authoritative record data, credentials, and rejection reasons are excluded.
 * @typedef {object} SyncConflictDiagnostic
 * @property {string | number | null} baseVersion - Version the local mutation was based on.
 * @property {string} clientMutationId - Durable client idempotency identifier.
 * @property {string | number | null} localVersion - Optional client version returned by the conflict contract.
 * @property {string} recordId - Durable local mutation-log record id.
 * @property {string} resourceId - Stable resource identifier.
 * @property {string} resourceType - Stable resource/model type.
 * @property {string | number | null} serverVersion - Authoritative server version.
 * @property {string | null} versionAttribute - Authoritative version attribute name.
 */
/**
 * Safe classified failure metadata. Applications own the classifier and must
 * return only user-safe codes/messages; the original Error is never persisted.
 * @typedef {object} SyncCoordinatorFailure
 * @property {number} attempt - Consecutive cycle attempt number.
 * @property {string} at - ISO timestamp of the failure.
 * @property {string} code - Stable safe error code.
 * @property {string} [message] - Optional safe display message.
 * @property {boolean} retryable - Whether automatic retry is allowed.
 */
/**
 * Immutable coordinator status snapshot.
 * @typedef {object} SyncCoordinatorStatus
 * @property {ReadonlyArray<SyncConflictDiagnostic>} conflicts - Privacy-safe unresolved conflicts.
 * @property {SyncCoordinatorFailure | null} failure - Last unresolved cycle failure.
 * @property {string | null} lastSuccessAt - Last successful online cycle timestamp.
 * @property {string | null} nextRetryAt - Scheduled automatic retry timestamp.
 * @property {number} pendingCount - Durable pending mutation count.
 * @property {number} rejectedCount - Durable permanently rejected mutation count.
 * @property {SyncCoordinatorState} state - Observable lifecycle state.
 */
/**
 * Durable sync state reported by SyncClient.
 * @typedef {object} SyncClientInspection
 * @property {ReadonlyArray<SyncConflictDiagnostic>} conflicts - Privacy-safe conflict diagnostics.
 * @property {number} pendingCount - Durable pending mutation count.
 * @property {number} rejectedCount - Durable rejected mutation count.
 */
/**
 * Application connectivity signal adapter. SyncClient remains the authority
 * for the current online check; this adapter only notifies the coordinator.
 * @typedef {object} SyncCoordinatorConnectivity
 * @property {(listener: (online: boolean) => void) => (() => void)} subscribe - Subscribes to connectivity changes.
 */
/**
 * Injected timer ownership for deterministic retry tests and teardown.
 * @typedef {object} SyncCoordinatorScheduler
 * @property {(timer: unknown) => void} clearTimeout - Clears a scheduled retry.
 * @property {(callback: () => void, delayMs: number) => unknown} setTimeout - Schedules a retry.
 */
/**
 * Optional durable status metadata store. Conflict payloads remain owned by
 * LocalMutationLog; this store receives only privacy-safe snapshots.
 * @typedef {object} SyncCoordinatorStatusStore
 * @property {() => Promise<SyncCoordinatorStatus | null> | SyncCoordinatorStatus | null} load - Loads the last safe snapshot.
 * @property {(status: SyncCoordinatorStatus) => Promise<void> | void} save - Persists one safe snapshot.
 */
export {};
//# sourceMappingURL=sync-coordinator-types.d.ts.map