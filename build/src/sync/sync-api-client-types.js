// @ts-check
/**
 * @module sync-api-client-types
 */
/** @typedef {{id: string | null, serverSequence: number | null, updatedAt: string} | null} SyncCursor */
/**
 * @typedef {object} SyncChangeEnvelope
 * @property {() => unknown} data - Sync data payload.
 * @property {() => unknown} id - Sync row identifier.
 * @property {() => unknown} resourceId - Resource identifier.
 * @property {() => string | null} resourceType - Resource type name.
 * @property {() => string} syncType - Sync operation type.
 */
/**
 * @typedef {object} SyncChangeApplyResult
 * @property {boolean} changed - Whether the local store changed.
 * @property {string | null} [resourceType] - Applied resource type override.
 */
/**
 * @typedef {object} SyncResourceConfig
 * @property {(args: {attributes: Record<string, unknown>, data: Record<string, unknown>, record: ReturnType<typeof JSON.parse>, sync: SyncChangeEnvelope}) => Promise<boolean | void> | boolean | void} [afterApply] - Optional post-save hook.
 * @property {(args: {data: Record<string, unknown>, record: ReturnType<typeof JSON.parse>, sync: SyncChangeEnvelope}) => Promise<Record<string, unknown>> | Record<string, unknown>} attributes - Allowed attributes builder.
 * @property {boolean} enabled - Whether this resource is sync-enabled.
 * @property {(args: {data: Record<string, unknown>, modelClass?: ReturnType<typeof JSON.parse>, operation?: import("../database/operation.js").default | null, resourceId: unknown, sync: SyncChangeEnvelope}) => Promise<ReturnType<typeof JSON.parse>> | ReturnType<typeof JSON.parse>} [findRecord] - Optional upsert finder. SyncClient tenant resources additionally receive an operation-bound model class and operation; direct API consumers retain the legacy arguments.
 * @property {(args: {modelClass?: ReturnType<typeof JSON.parse>, operation?: import("../database/operation.js").default | null, resourceId: unknown, sync: SyncChangeEnvelope}) => Promise<ReturnType<typeof JSON.parse>> | ReturnType<typeof JSON.parse>} [findRecordForDelete] - Optional destroy finder. SyncClient tenant resources additionally receive an operation-bound model class and operation; direct API consumers retain the legacy arguments.
 * @property {ReturnType<typeof JSON.parse>} modelClass - Velocious model class.
 */
/**
 * @typedef {object} SyncChangesRequest
 * @property {string} authenticationToken - Auth token.
 * @property {string | null} [afterId] - Last seen row id.
 * @property {number} [afterServerSequence] - Last seen server sequence.
 * @property {string} [afterUpdatedAt] - Last seen timestamp.
 * @property {number} limit - Page size.
 * @property {string | null} [upToId] - Snapshot upper-bound row id.
 * @property {number} [upToServerSequence] - Snapshot upper-bound server sequence.
 * @property {string} [upToUpdatedAt] - Snapshot upper-bound timestamp.
 */
/**
 * @typedef {object} SyncChangesResponse
 * @property {string} [errorMessage] - Error message.
 * @property {SyncCursor | Record<string, ReturnType<typeof JSON.parse>>} [nextCursor] - Next cursor.
 * @property {string} [status] - Response status.
 * @property {Array<unknown>} [syncs] - Sync rows.
 * @property {number} [total] - Total pending change count for the scope from the request cursor (additive; absent on older servers).
 * @property {SyncCursor | Record<string, ReturnType<typeof JSON.parse>>} [upToCursor] - Snapshot upper-bound cursor.
 */
/**
 * @typedef {object} SyncPullProgress
 * @property {number} pages - Applied page count so far.
 * @property {number} syncedCount - Applied row count so far.
 * @property {number} total - Total pending change count for the pull, stable across pages (0 when nothing to sync, null-free once the server reports it).
 */
/**
 * @typedef {object} SyncChangesResult
 * @property {boolean} changed - Whether any local record changed.
 * @property {number} pages - Applied page count.
 * @property {Record<string, boolean>} resourceChanged - Changed flags by resource type.
 * @property {Record<string, number>} resourceCounts - Applied counts by resource type.
 * @property {number} syncedCount - Applied row count.
 * @property {number} total - Total pending change count across the pulled scopes (the "of Y" denominator for a syncedCount-of-total progress bar).
 */
/**
 * @typedef {object} SyncReplayItem
 * @property {string | number} id - Sync id.
 * @property {Record<string, ReturnType<typeof JSON.parse>>} [conflict] - Structured durable conflict payload.
 * @property {string} [reason] - Rejection reason.
 * @property {string | number | null} [serverVersion] - Authoritative version after successful replay.
 * @property {string} syncState - Replay state.
 */
/**
 * @typedef {object} SyncReplayResponse
 * @property {string} [errorMessage] - Error message.
 * @property {string} [status] - Response status.
 * @property {Array<SyncReplayItem>} [syncs] - Replay results.
 */
export {};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3luYy1hcGktY2xpZW50LXR5cGVzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3N5bmMvc3luYy1hcGktY2xpZW50LXR5cGVzLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWjs7R0FFRztBQUVILHlHQUF5RztBQUV6Rzs7Ozs7OztHQU9HO0FBRUg7Ozs7R0FJRztBQUVIOzs7Ozs7OztHQVFHO0FBRUg7Ozs7Ozs7Ozs7R0FVRztBQUVIOzs7Ozs7OztHQVFHO0FBRUg7Ozs7O0dBS0c7QUFFSDs7Ozs7Ozs7R0FRRztBQUVIOzs7Ozs7O0dBT0c7QUFFSDs7Ozs7R0FLRztBQUVILE9BQU8sRUFBRSxDQUFBIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbi8qKlxuICogQG1vZHVsZSBzeW5jLWFwaS1jbGllbnQtdHlwZXNcbiAqL1xuXG4vKiogQHR5cGVkZWYge3tpZDogc3RyaW5nIHwgbnVsbCwgc2VydmVyU2VxdWVuY2U6IG51bWJlciB8IG51bGwsIHVwZGF0ZWRBdDogc3RyaW5nfSB8IG51bGx9IFN5bmNDdXJzb3IgKi9cblxuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBTeW5jQ2hhbmdlRW52ZWxvcGVcbiAqIEBwcm9wZXJ0eSB7KCkgPT4gdW5rbm93bn0gZGF0YSAtIFN5bmMgZGF0YSBwYXlsb2FkLlxuICogQHByb3BlcnR5IHsoKSA9PiB1bmtub3dufSBpZCAtIFN5bmMgcm93IGlkZW50aWZpZXIuXG4gKiBAcHJvcGVydHkgeygpID0+IHVua25vd259IHJlc291cmNlSWQgLSBSZXNvdXJjZSBpZGVudGlmaWVyLlxuICogQHByb3BlcnR5IHsoKSA9PiBzdHJpbmcgfCBudWxsfSByZXNvdXJjZVR5cGUgLSBSZXNvdXJjZSB0eXBlIG5hbWUuXG4gKiBAcHJvcGVydHkgeygpID0+IHN0cmluZ30gc3luY1R5cGUgLSBTeW5jIG9wZXJhdGlvbiB0eXBlLlxuICovXG5cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gU3luY0NoYW5nZUFwcGx5UmVzdWx0XG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IGNoYW5nZWQgLSBXaGV0aGVyIHRoZSBsb2NhbCBzdG9yZSBjaGFuZ2VkLlxuICogQHByb3BlcnR5IHtzdHJpbmcgfCBudWxsfSBbcmVzb3VyY2VUeXBlXSAtIEFwcGxpZWQgcmVzb3VyY2UgdHlwZSBvdmVycmlkZS5cbiAqL1xuXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IFN5bmNSZXNvdXJjZUNvbmZpZ1xuICogQHByb3BlcnR5IHsoYXJnczoge2F0dHJpYnV0ZXM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+LCBkYXRhOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiwgcmVjb3JkOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgc3luYzogU3luY0NoYW5nZUVudmVsb3BlfSkgPT4gUHJvbWlzZTxib29sZWFuIHwgdm9pZD4gfCBib29sZWFuIHwgdm9pZH0gW2FmdGVyQXBwbHldIC0gT3B0aW9uYWwgcG9zdC1zYXZlIGhvb2suXG4gKiBAcHJvcGVydHkgeyhhcmdzOiB7ZGF0YTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4sIHJlY29yZDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIHN5bmM6IFN5bmNDaGFuZ2VFbnZlbG9wZX0pID0+IFByb21pc2U8UmVjb3JkPHN0cmluZywgdW5rbm93bj4+IHwgUmVjb3JkPHN0cmluZywgdW5rbm93bj59IGF0dHJpYnV0ZXMgLSBBbGxvd2VkIGF0dHJpYnV0ZXMgYnVpbGRlci5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gZW5hYmxlZCAtIFdoZXRoZXIgdGhpcyByZXNvdXJjZSBpcyBzeW5jLWVuYWJsZWQuXG4gKiBAcHJvcGVydHkgeyhhcmdzOiB7ZGF0YTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4sIG1vZGVsQ2xhc3M/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgb3BlcmF0aW9uPzogaW1wb3J0KFwiLi4vZGF0YWJhc2Uvb3BlcmF0aW9uLmpzXCIpLmRlZmF1bHQgfCBudWxsLCByZXNvdXJjZUlkOiB1bmtub3duLCBzeW5jOiBTeW5jQ2hhbmdlRW52ZWxvcGV9KSA9PiBQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBbZmluZFJlY29yZF0gLSBPcHRpb25hbCB1cHNlcnQgZmluZGVyLiBTeW5jQ2xpZW50IHRlbmFudCByZXNvdXJjZXMgYWRkaXRpb25hbGx5IHJlY2VpdmUgYW4gb3BlcmF0aW9uLWJvdW5kIG1vZGVsIGNsYXNzIGFuZCBvcGVyYXRpb247IGRpcmVjdCBBUEkgY29uc3VtZXJzIHJldGFpbiB0aGUgbGVnYWN5IGFyZ3VtZW50cy5cbiAqIEBwcm9wZXJ0eSB7KGFyZ3M6IHttb2RlbENsYXNzPzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIG9wZXJhdGlvbj86IGltcG9ydChcIi4uL2RhdGFiYXNlL29wZXJhdGlvbi5qc1wiKS5kZWZhdWx0IHwgbnVsbCwgcmVzb3VyY2VJZDogdW5rbm93biwgc3luYzogU3luY0NoYW5nZUVudmVsb3BlfSkgPT4gUHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gW2ZpbmRSZWNvcmRGb3JEZWxldGVdIC0gT3B0aW9uYWwgZGVzdHJveSBmaW5kZXIuIFN5bmNDbGllbnQgdGVuYW50IHJlc291cmNlcyBhZGRpdGlvbmFsbHkgcmVjZWl2ZSBhbiBvcGVyYXRpb24tYm91bmQgbW9kZWwgY2xhc3MgYW5kIG9wZXJhdGlvbjsgZGlyZWN0IEFQSSBjb25zdW1lcnMgcmV0YWluIHRoZSBsZWdhY3kgYXJndW1lbnRzLlxuICogQHByb3BlcnR5IHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gbW9kZWxDbGFzcyAtIFZlbG9jaW91cyBtb2RlbCBjbGFzcy5cbiAqL1xuXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IFN5bmNDaGFuZ2VzUmVxdWVzdFxuICogQHByb3BlcnR5IHtzdHJpbmd9IGF1dGhlbnRpY2F0aW9uVG9rZW4gLSBBdXRoIHRva2VuLlxuICogQHByb3BlcnR5IHtzdHJpbmcgfCBudWxsfSBbYWZ0ZXJJZF0gLSBMYXN0IHNlZW4gcm93IGlkLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IFthZnRlclNlcnZlclNlcXVlbmNlXSAtIExhc3Qgc2VlbiBzZXJ2ZXIgc2VxdWVuY2UuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW2FmdGVyVXBkYXRlZEF0XSAtIExhc3Qgc2VlbiB0aW1lc3RhbXAuXG4gKiBAcHJvcGVydHkge251bWJlcn0gbGltaXQgLSBQYWdlIHNpemUuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IG51bGx9IFt1cFRvSWRdIC0gU25hcHNob3QgdXBwZXItYm91bmQgcm93IGlkLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IFt1cFRvU2VydmVyU2VxdWVuY2VdIC0gU25hcHNob3QgdXBwZXItYm91bmQgc2VydmVyIHNlcXVlbmNlLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFt1cFRvVXBkYXRlZEF0XSAtIFNuYXBzaG90IHVwcGVyLWJvdW5kIHRpbWVzdGFtcC5cbiAqL1xuXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IFN5bmNDaGFuZ2VzUmVzcG9uc2VcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbZXJyb3JNZXNzYWdlXSAtIEVycm9yIG1lc3NhZ2UuXG4gKiBAcHJvcGVydHkge1N5bmNDdXJzb3IgfCBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IFtuZXh0Q3Vyc29yXSAtIE5leHQgY3Vyc29yLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtzdGF0dXNdIC0gUmVzcG9uc2Ugc3RhdHVzLlxuICogQHByb3BlcnR5IHtBcnJheTx1bmtub3duPn0gW3N5bmNzXSAtIFN5bmMgcm93cy5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBbdG90YWxdIC0gVG90YWwgcGVuZGluZyBjaGFuZ2UgY291bnQgZm9yIHRoZSBzY29wZSBmcm9tIHRoZSByZXF1ZXN0IGN1cnNvciAoYWRkaXRpdmU7IGFic2VudCBvbiBvbGRlciBzZXJ2ZXJzKS5cbiAqIEBwcm9wZXJ0eSB7U3luY0N1cnNvciB8IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gW3VwVG9DdXJzb3JdIC0gU25hcHNob3QgdXBwZXItYm91bmQgY3Vyc29yLlxuICovXG5cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gU3luY1B1bGxQcm9ncmVzc1xuICogQHByb3BlcnR5IHtudW1iZXJ9IHBhZ2VzIC0gQXBwbGllZCBwYWdlIGNvdW50IHNvIGZhci5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBzeW5jZWRDb3VudCAtIEFwcGxpZWQgcm93IGNvdW50IHNvIGZhci5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSB0b3RhbCAtIFRvdGFsIHBlbmRpbmcgY2hhbmdlIGNvdW50IGZvciB0aGUgcHVsbCwgc3RhYmxlIGFjcm9zcyBwYWdlcyAoMCB3aGVuIG5vdGhpbmcgdG8gc3luYywgbnVsbC1mcmVlIG9uY2UgdGhlIHNlcnZlciByZXBvcnRzIGl0KS5cbiAqL1xuXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IFN5bmNDaGFuZ2VzUmVzdWx0XG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IGNoYW5nZWQgLSBXaGV0aGVyIGFueSBsb2NhbCByZWNvcmQgY2hhbmdlZC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBwYWdlcyAtIEFwcGxpZWQgcGFnZSBjb3VudC5cbiAqIEBwcm9wZXJ0eSB7UmVjb3JkPHN0cmluZywgYm9vbGVhbj59IHJlc291cmNlQ2hhbmdlZCAtIENoYW5nZWQgZmxhZ3MgYnkgcmVzb3VyY2UgdHlwZS5cbiAqIEBwcm9wZXJ0eSB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gcmVzb3VyY2VDb3VudHMgLSBBcHBsaWVkIGNvdW50cyBieSByZXNvdXJjZSB0eXBlLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IHN5bmNlZENvdW50IC0gQXBwbGllZCByb3cgY291bnQuXG4gKiBAcHJvcGVydHkge251bWJlcn0gdG90YWwgLSBUb3RhbCBwZW5kaW5nIGNoYW5nZSBjb3VudCBhY3Jvc3MgdGhlIHB1bGxlZCBzY29wZXMgKHRoZSBcIm9mIFlcIiBkZW5vbWluYXRvciBmb3IgYSBzeW5jZWRDb3VudC1vZi10b3RhbCBwcm9ncmVzcyBiYXIpLlxuICovXG5cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gU3luY1JlcGxheUl0ZW1cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgbnVtYmVyfSBpZCAtIFN5bmMgaWQuXG4gKiBAcHJvcGVydHkge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gW2NvbmZsaWN0XSAtIFN0cnVjdHVyZWQgZHVyYWJsZSBjb25mbGljdCBwYXlsb2FkLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtyZWFzb25dIC0gUmVqZWN0aW9uIHJlYXNvbi5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgbnVtYmVyIHwgbnVsbH0gW3NlcnZlclZlcnNpb25dIC0gQXV0aG9yaXRhdGl2ZSB2ZXJzaW9uIGFmdGVyIHN1Y2Nlc3NmdWwgcmVwbGF5LlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHN5bmNTdGF0ZSAtIFJlcGxheSBzdGF0ZS5cbiAqL1xuXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IFN5bmNSZXBsYXlSZXNwb25zZVxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtlcnJvck1lc3NhZ2VdIC0gRXJyb3IgbWVzc2FnZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbc3RhdHVzXSAtIFJlc3BvbnNlIHN0YXR1cy5cbiAqIEBwcm9wZXJ0eSB7QXJyYXk8U3luY1JlcGxheUl0ZW0+fSBbc3luY3NdIC0gUmVwbGF5IHJlc3VsdHMuXG4gKi9cblxuZXhwb3J0IHt9XG4iXX0=