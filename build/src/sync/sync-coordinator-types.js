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
export {};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3luYy1jb29yZGluYXRvci10eXBlcy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9zeW5jL3N5bmMtY29vcmRpbmF0b3ItdHlwZXMuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUNaLDRHQUE0RztBQUU1RyxtSUFBbUk7QUFFbkk7Ozs7Ozs7Ozs7OztHQVlHO0FBRUg7Ozs7Ozs7OztHQVNHO0FBRUg7Ozs7Ozs7Ozs7R0FVRztBQUVIOzs7Ozs7R0FNRztBQUVIOzs7OztHQUtHO0FBRUg7Ozs7O0dBS0c7QUFFSDs7Ozs7O0dBTUc7QUFFSCxPQUFPLEVBQUUsQ0FBQSIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuLyogZXNsaW50LWRpc2FibGUganNkb2Mvbm8tdW5kZWZpbmVkLXR5cGVzIC0tIFJlYWRvbmx5QXJyYXkgaXMgYSBUeXBlU2NyaXB0IHV0aWxpdHkgdHlwZSB1c2VkIGJ5IGNoZWNrSnMuICovXG5cbi8qKiBAdHlwZWRlZiB7XCJiYWNrb2ZmXCIgfCBcImNvbmZsaWN0ZWRcIiB8IFwiZmFpbGVkXCIgfCBcImlkbGVcIiB8IFwib2ZmbGluZVwiIHwgXCJwZW5kaW5nXCIgfCBcInN0b3BwZWRcIiB8IFwic3luY2luZ1wifSBTeW5jQ29vcmRpbmF0b3JTdGF0ZSAqL1xuXG4vKipcbiAqIFByaXZhY3ktc2FmZSBjb25mbGljdCBtZXRhZGF0YSBmb3Igc3RhdHVzIHN1cmZhY2VzLiBNdXRhdGlvbiBhdHRyaWJ1dGVzLFxuICogYXV0aG9yaXRhdGl2ZSByZWNvcmQgZGF0YSwgY3JlZGVudGlhbHMsIGFuZCByZWplY3Rpb24gcmVhc29ucyBhcmUgZXhjbHVkZWQuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBTeW5jQ29uZmxpY3REaWFnbm9zdGljXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IG51bWJlciB8IG51bGx9IGJhc2VWZXJzaW9uIC0gVmVyc2lvbiB0aGUgbG9jYWwgbXV0YXRpb24gd2FzIGJhc2VkIG9uLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGNsaWVudE11dGF0aW9uSWQgLSBEdXJhYmxlIGNsaWVudCBpZGVtcG90ZW5jeSBpZGVudGlmaWVyLlxuICogQHByb3BlcnR5IHtzdHJpbmcgfCBudW1iZXIgfCBudWxsfSBsb2NhbFZlcnNpb24gLSBPcHRpb25hbCBjbGllbnQgdmVyc2lvbiByZXR1cm5lZCBieSB0aGUgY29uZmxpY3QgY29udHJhY3QuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gcmVjb3JkSWQgLSBEdXJhYmxlIGxvY2FsIG11dGF0aW9uLWxvZyByZWNvcmQgaWQuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gcmVzb3VyY2VJZCAtIFN0YWJsZSByZXNvdXJjZSBpZGVudGlmaWVyLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHJlc291cmNlVHlwZSAtIFN0YWJsZSByZXNvdXJjZS9tb2RlbCB0eXBlLlxuICogQHByb3BlcnR5IHtzdHJpbmcgfCBudW1iZXIgfCBudWxsfSBzZXJ2ZXJWZXJzaW9uIC0gQXV0aG9yaXRhdGl2ZSBzZXJ2ZXIgdmVyc2lvbi5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgbnVsbH0gdmVyc2lvbkF0dHJpYnV0ZSAtIEF1dGhvcml0YXRpdmUgdmVyc2lvbiBhdHRyaWJ1dGUgbmFtZS5cbiAqL1xuXG4vKipcbiAqIFNhZmUgY2xhc3NpZmllZCBmYWlsdXJlIG1ldGFkYXRhLiBBcHBsaWNhdGlvbnMgb3duIHRoZSBjbGFzc2lmaWVyIGFuZCBtdXN0XG4gKiByZXR1cm4gb25seSB1c2VyLXNhZmUgY29kZXMvbWVzc2FnZXM7IHRoZSBvcmlnaW5hbCBFcnJvciBpcyBuZXZlciBwZXJzaXN0ZWQuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBTeW5jQ29vcmRpbmF0b3JGYWlsdXJlXG4gKiBAcHJvcGVydHkge251bWJlcn0gYXR0ZW1wdCAtIENvbnNlY3V0aXZlIGN5Y2xlIGF0dGVtcHQgbnVtYmVyLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGF0IC0gSVNPIHRpbWVzdGFtcCBvZiB0aGUgZmFpbHVyZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBjb2RlIC0gU3RhYmxlIHNhZmUgZXJyb3IgY29kZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbbWVzc2FnZV0gLSBPcHRpb25hbCBzYWZlIGRpc3BsYXkgbWVzc2FnZS5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gcmV0cnlhYmxlIC0gV2hldGhlciBhdXRvbWF0aWMgcmV0cnkgaXMgYWxsb3dlZC5cbiAqL1xuXG4vKipcbiAqIEltbXV0YWJsZSBjb29yZGluYXRvciBzdGF0dXMgc25hcHNob3QuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBTeW5jQ29vcmRpbmF0b3JTdGF0dXNcbiAqIEBwcm9wZXJ0eSB7UmVhZG9ubHlBcnJheTxTeW5jQ29uZmxpY3REaWFnbm9zdGljPn0gY29uZmxpY3RzIC0gUHJpdmFjeS1zYWZlIHVucmVzb2x2ZWQgY29uZmxpY3RzLlxuICogQHByb3BlcnR5IHtTeW5jQ29vcmRpbmF0b3JGYWlsdXJlIHwgbnVsbH0gZmFpbHVyZSAtIExhc3QgdW5yZXNvbHZlZCBjeWNsZSBmYWlsdXJlLlxuICogQHByb3BlcnR5IHtzdHJpbmcgfCBudWxsfSBsYXN0U3VjY2Vzc0F0IC0gTGFzdCBzdWNjZXNzZnVsIG9ubGluZSBjeWNsZSB0aW1lc3RhbXAuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IG51bGx9IG5leHRSZXRyeUF0IC0gU2NoZWR1bGVkIGF1dG9tYXRpYyByZXRyeSB0aW1lc3RhbXAuXG4gKiBAcHJvcGVydHkge251bWJlcn0gcGVuZGluZ0NvdW50IC0gRHVyYWJsZSBwZW5kaW5nIG11dGF0aW9uIGNvdW50LlxuICogQHByb3BlcnR5IHtudW1iZXJ9IHJlamVjdGVkQ291bnQgLSBEdXJhYmxlIHBlcm1hbmVudGx5IHJlamVjdGVkIG11dGF0aW9uIGNvdW50LlxuICogQHByb3BlcnR5IHtTeW5jQ29vcmRpbmF0b3JTdGF0ZX0gc3RhdGUgLSBPYnNlcnZhYmxlIGxpZmVjeWNsZSBzdGF0ZS5cbiAqL1xuXG4vKipcbiAqIER1cmFibGUgc3luYyBzdGF0ZSByZXBvcnRlZCBieSBTeW5jQ2xpZW50LlxuICogQHR5cGVkZWYge29iamVjdH0gU3luY0NsaWVudEluc3BlY3Rpb25cbiAqIEBwcm9wZXJ0eSB7UmVhZG9ubHlBcnJheTxTeW5jQ29uZmxpY3REaWFnbm9zdGljPn0gY29uZmxpY3RzIC0gUHJpdmFjeS1zYWZlIGNvbmZsaWN0IGRpYWdub3N0aWNzLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IHBlbmRpbmdDb3VudCAtIER1cmFibGUgcGVuZGluZyBtdXRhdGlvbiBjb3VudC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSByZWplY3RlZENvdW50IC0gRHVyYWJsZSByZWplY3RlZCBtdXRhdGlvbiBjb3VudC5cbiAqL1xuXG4vKipcbiAqIEFwcGxpY2F0aW9uIGNvbm5lY3Rpdml0eSBzaWduYWwgYWRhcHRlci4gU3luY0NsaWVudCByZW1haW5zIHRoZSBhdXRob3JpdHlcbiAqIGZvciB0aGUgY3VycmVudCBvbmxpbmUgY2hlY2s7IHRoaXMgYWRhcHRlciBvbmx5IG5vdGlmaWVzIHRoZSBjb29yZGluYXRvci5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFN5bmNDb29yZGluYXRvckNvbm5lY3Rpdml0eVxuICogQHByb3BlcnR5IHsobGlzdGVuZXI6IChvbmxpbmU6IGJvb2xlYW4pID0+IHZvaWQpID0+ICgoKSA9PiB2b2lkKX0gc3Vic2NyaWJlIC0gU3Vic2NyaWJlcyB0byBjb25uZWN0aXZpdHkgY2hhbmdlcy5cbiAqL1xuXG4vKipcbiAqIEluamVjdGVkIHRpbWVyIG93bmVyc2hpcCBmb3IgZGV0ZXJtaW5pc3RpYyByZXRyeSB0ZXN0cyBhbmQgdGVhcmRvd24uXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBTeW5jQ29vcmRpbmF0b3JTY2hlZHVsZXJcbiAqIEBwcm9wZXJ0eSB7KHRpbWVyOiB1bmtub3duKSA9PiB2b2lkfSBjbGVhclRpbWVvdXQgLSBDbGVhcnMgYSBzY2hlZHVsZWQgcmV0cnkuXG4gKiBAcHJvcGVydHkgeyhjYWxsYmFjazogKCkgPT4gdm9pZCwgZGVsYXlNczogbnVtYmVyKSA9PiB1bmtub3dufSBzZXRUaW1lb3V0IC0gU2NoZWR1bGVzIGEgcmV0cnkuXG4gKi9cblxuLyoqXG4gKiBPcHRpb25hbCBkdXJhYmxlIHN0YXR1cyBtZXRhZGF0YSBzdG9yZS4gQ29uZmxpY3QgcGF5bG9hZHMgcmVtYWluIG93bmVkIGJ5XG4gKiBMb2NhbE11dGF0aW9uTG9nOyB0aGlzIHN0b3JlIHJlY2VpdmVzIG9ubHkgcHJpdmFjeS1zYWZlIHNuYXBzaG90cy5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFN5bmNDb29yZGluYXRvclN0YXR1c1N0b3JlXG4gKiBAcHJvcGVydHkgeygpID0+IFByb21pc2U8U3luY0Nvb3JkaW5hdG9yU3RhdHVzIHwgbnVsbD4gfCBTeW5jQ29vcmRpbmF0b3JTdGF0dXMgfCBudWxsfSBsb2FkIC0gTG9hZHMgdGhlIGxhc3Qgc2FmZSBzbmFwc2hvdC5cbiAqIEBwcm9wZXJ0eSB7KHN0YXR1czogU3luY0Nvb3JkaW5hdG9yU3RhdHVzKSA9PiBQcm9taXNlPHZvaWQ+IHwgdm9pZH0gc2F2ZSAtIFBlcnNpc3RzIG9uZSBzYWZlIHNuYXBzaG90LlxuICovXG5cbmV4cG9ydCB7fVxuIl19