// @ts-check
/* eslint-disable jsdoc/no-undefined-types -- ReadonlyArray is a TypeScript utility type used by checkJs. */

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

export {}
