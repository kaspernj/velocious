// @ts-check
/**
 * Immutable attachment descriptor synchronized separately from its bytes.
 * @typedef {object} SynchronizedAssetCacheDescriptor
 * @property {number} byteSize - Expected byte count.
 * @property {string | null} contentType - Media type.
 * @property {string} digest - Expected `sha256-<hex>` content digest.
 * @property {"eager" | "on-demand"} fetch - Download timing policy.
 * @property {string} filename - Original filename.
 * @property {string} id - Immutable attachment id.
 * @property {string} name - Attachment declaration name.
 * @property {"optional" | "required"} offlineRequirement - Whether offline readiness requires the bytes.
 * @property {string} recordId - Owner record id.
 * @property {string} recordType - Owner model name.
 * @property {"durable" | "evictable"} retention - Storage-pressure policy.
 */
/**
 * Persisted state for one synchronized attachment descriptor.
 * @typedef {object} SynchronizedAssetCacheEntry
 * @property {number} attempts - Consecutive failed download count.
 * @property {SynchronizedAssetCacheDescriptor} descriptor - Current immutable descriptor.
 * @property {number} lastAccessedAt - Millisecond LRU timestamp.
 * @property {number | null} nextRetryAt - Earliest automatic retry time.
 * @property {string[]} scopeKeys - Synchronized scopes referencing the descriptor.
 * @property {"cached" | "downloading" | "failed" | "missing"} status - Local byte state.
 */
/**
 * Versioned persistent cache metadata owned by a platform adapter.
 * @typedef {object} SynchronizedAssetCacheState
 * @property {SynchronizedAssetCacheEntry[]} assets - Descriptor entries.
 * @property {1} version - State schema version.
 */
/**
 * Platform storage adapter. `writeBlob` must make bytes visible atomically.
 * @typedef {object} SynchronizedAssetCacheAdapter
 * @property {(args: {accountId: string, digest: string}) => Promise<string | null>} blobUri - Resolves a locally stored blob URI.
 * @property {(args: {accountId: string, digest: string}) => Promise<void>} deleteBlob - Deletes one local blob.
 * @property {(args: {accountId: string}) => Promise<SynchronizedAssetCacheState | null>} loadState - Loads account-scoped metadata.
 * @property {(args: {accountId: string, state: SynchronizedAssetCacheState}) => Promise<void>} saveState - Atomically saves account-scoped metadata.
 * @property {(args: {accountId: string, bytes: Uint8Array, contentType: string | null, digest: string}) => Promise<string>} writeBlob - Atomically stores verified bytes.
 */
/**
 * Failed asset result surfaced to the sync coordinator.
 * @typedef {object} SynchronizedAssetCacheFailure
 * @property {string} assetId - Descriptor id.
 * @property {Error} error - Download or verification error.
 */
/**
 * Descriptor reconciliation result.
 * @typedef {object} SynchronizedAssetCacheSynchronizationResult
 * @property {SynchronizedAssetCacheFailure[]} failures - Failed eligible eager downloads.
 * @property {string[]} missingRequiredAssetIds - Required descriptors without cached bytes.
 */
export {};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidHlwZXMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvc3luYy9hc3NldHMvdHlwZXMuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaOzs7Ozs7Ozs7Ozs7OztHQWNHO0FBRUg7Ozs7Ozs7OztHQVNHO0FBRUg7Ozs7O0dBS0c7QUFFSDs7Ozs7Ozs7R0FRRztBQUVIOzs7OztHQUtHO0FBRUg7Ozs7O0dBS0c7QUFFSCxPQUFPLEVBQUUsQ0FBQSIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG4vKipcbiAqIEltbXV0YWJsZSBhdHRhY2htZW50IGRlc2NyaXB0b3Igc3luY2hyb25pemVkIHNlcGFyYXRlbHkgZnJvbSBpdHMgYnl0ZXMuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBTeW5jaHJvbml6ZWRBc3NldENhY2hlRGVzY3JpcHRvclxuICogQHByb3BlcnR5IHtudW1iZXJ9IGJ5dGVTaXplIC0gRXhwZWN0ZWQgYnl0ZSBjb3VudC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgbnVsbH0gY29udGVudFR5cGUgLSBNZWRpYSB0eXBlLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGRpZ2VzdCAtIEV4cGVjdGVkIGBzaGEyNTYtPGhleD5gIGNvbnRlbnQgZGlnZXN0LlxuICogQHByb3BlcnR5IHtcImVhZ2VyXCIgfCBcIm9uLWRlbWFuZFwifSBmZXRjaCAtIERvd25sb2FkIHRpbWluZyBwb2xpY3kuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gZmlsZW5hbWUgLSBPcmlnaW5hbCBmaWxlbmFtZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBpZCAtIEltbXV0YWJsZSBhdHRhY2htZW50IGlkLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IG5hbWUgLSBBdHRhY2htZW50IGRlY2xhcmF0aW9uIG5hbWUuXG4gKiBAcHJvcGVydHkge1wib3B0aW9uYWxcIiB8IFwicmVxdWlyZWRcIn0gb2ZmbGluZVJlcXVpcmVtZW50IC0gV2hldGhlciBvZmZsaW5lIHJlYWRpbmVzcyByZXF1aXJlcyB0aGUgYnl0ZXMuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gcmVjb3JkSWQgLSBPd25lciByZWNvcmQgaWQuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gcmVjb3JkVHlwZSAtIE93bmVyIG1vZGVsIG5hbWUuXG4gKiBAcHJvcGVydHkge1wiZHVyYWJsZVwiIHwgXCJldmljdGFibGVcIn0gcmV0ZW50aW9uIC0gU3RvcmFnZS1wcmVzc3VyZSBwb2xpY3kuXG4gKi9cblxuLyoqXG4gKiBQZXJzaXN0ZWQgc3RhdGUgZm9yIG9uZSBzeW5jaHJvbml6ZWQgYXR0YWNobWVudCBkZXNjcmlwdG9yLlxuICogQHR5cGVkZWYge29iamVjdH0gU3luY2hyb25pemVkQXNzZXRDYWNoZUVudHJ5XG4gKiBAcHJvcGVydHkge251bWJlcn0gYXR0ZW1wdHMgLSBDb25zZWN1dGl2ZSBmYWlsZWQgZG93bmxvYWQgY291bnQuXG4gKiBAcHJvcGVydHkge1N5bmNocm9uaXplZEFzc2V0Q2FjaGVEZXNjcmlwdG9yfSBkZXNjcmlwdG9yIC0gQ3VycmVudCBpbW11dGFibGUgZGVzY3JpcHRvci5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBsYXN0QWNjZXNzZWRBdCAtIE1pbGxpc2Vjb25kIExSVSB0aW1lc3RhbXAuXG4gKiBAcHJvcGVydHkge251bWJlciB8IG51bGx9IG5leHRSZXRyeUF0IC0gRWFybGllc3QgYXV0b21hdGljIHJldHJ5IHRpbWUuXG4gKiBAcHJvcGVydHkge3N0cmluZ1tdfSBzY29wZUtleXMgLSBTeW5jaHJvbml6ZWQgc2NvcGVzIHJlZmVyZW5jaW5nIHRoZSBkZXNjcmlwdG9yLlxuICogQHByb3BlcnR5IHtcImNhY2hlZFwiIHwgXCJkb3dubG9hZGluZ1wiIHwgXCJmYWlsZWRcIiB8IFwibWlzc2luZ1wifSBzdGF0dXMgLSBMb2NhbCBieXRlIHN0YXRlLlxuICovXG5cbi8qKlxuICogVmVyc2lvbmVkIHBlcnNpc3RlbnQgY2FjaGUgbWV0YWRhdGEgb3duZWQgYnkgYSBwbGF0Zm9ybSBhZGFwdGVyLlxuICogQHR5cGVkZWYge29iamVjdH0gU3luY2hyb25pemVkQXNzZXRDYWNoZVN0YXRlXG4gKiBAcHJvcGVydHkge1N5bmNocm9uaXplZEFzc2V0Q2FjaGVFbnRyeVtdfSBhc3NldHMgLSBEZXNjcmlwdG9yIGVudHJpZXMuXG4gKiBAcHJvcGVydHkgezF9IHZlcnNpb24gLSBTdGF0ZSBzY2hlbWEgdmVyc2lvbi5cbiAqL1xuXG4vKipcbiAqIFBsYXRmb3JtIHN0b3JhZ2UgYWRhcHRlci4gYHdyaXRlQmxvYmAgbXVzdCBtYWtlIGJ5dGVzIHZpc2libGUgYXRvbWljYWxseS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFN5bmNocm9uaXplZEFzc2V0Q2FjaGVBZGFwdGVyXG4gKiBAcHJvcGVydHkgeyhhcmdzOiB7YWNjb3VudElkOiBzdHJpbmcsIGRpZ2VzdDogc3RyaW5nfSkgPT4gUHJvbWlzZTxzdHJpbmcgfCBudWxsPn0gYmxvYlVyaSAtIFJlc29sdmVzIGEgbG9jYWxseSBzdG9yZWQgYmxvYiBVUkkuXG4gKiBAcHJvcGVydHkgeyhhcmdzOiB7YWNjb3VudElkOiBzdHJpbmcsIGRpZ2VzdDogc3RyaW5nfSkgPT4gUHJvbWlzZTx2b2lkPn0gZGVsZXRlQmxvYiAtIERlbGV0ZXMgb25lIGxvY2FsIGJsb2IuXG4gKiBAcHJvcGVydHkgeyhhcmdzOiB7YWNjb3VudElkOiBzdHJpbmd9KSA9PiBQcm9taXNlPFN5bmNocm9uaXplZEFzc2V0Q2FjaGVTdGF0ZSB8IG51bGw+fSBsb2FkU3RhdGUgLSBMb2FkcyBhY2NvdW50LXNjb3BlZCBtZXRhZGF0YS5cbiAqIEBwcm9wZXJ0eSB7KGFyZ3M6IHthY2NvdW50SWQ6IHN0cmluZywgc3RhdGU6IFN5bmNocm9uaXplZEFzc2V0Q2FjaGVTdGF0ZX0pID0+IFByb21pc2U8dm9pZD59IHNhdmVTdGF0ZSAtIEF0b21pY2FsbHkgc2F2ZXMgYWNjb3VudC1zY29wZWQgbWV0YWRhdGEuXG4gKiBAcHJvcGVydHkgeyhhcmdzOiB7YWNjb3VudElkOiBzdHJpbmcsIGJ5dGVzOiBVaW50OEFycmF5LCBjb250ZW50VHlwZTogc3RyaW5nIHwgbnVsbCwgZGlnZXN0OiBzdHJpbmd9KSA9PiBQcm9taXNlPHN0cmluZz59IHdyaXRlQmxvYiAtIEF0b21pY2FsbHkgc3RvcmVzIHZlcmlmaWVkIGJ5dGVzLlxuICovXG5cbi8qKlxuICogRmFpbGVkIGFzc2V0IHJlc3VsdCBzdXJmYWNlZCB0byB0aGUgc3luYyBjb29yZGluYXRvci5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFN5bmNocm9uaXplZEFzc2V0Q2FjaGVGYWlsdXJlXG4gKiBAcHJvcGVydHkge3N0cmluZ30gYXNzZXRJZCAtIERlc2NyaXB0b3IgaWQuXG4gKiBAcHJvcGVydHkge0Vycm9yfSBlcnJvciAtIERvd25sb2FkIG9yIHZlcmlmaWNhdGlvbiBlcnJvci5cbiAqL1xuXG4vKipcbiAqIERlc2NyaXB0b3IgcmVjb25jaWxpYXRpb24gcmVzdWx0LlxuICogQHR5cGVkZWYge29iamVjdH0gU3luY2hyb25pemVkQXNzZXRDYWNoZVN5bmNocm9uaXphdGlvblJlc3VsdFxuICogQHByb3BlcnR5IHtTeW5jaHJvbml6ZWRBc3NldENhY2hlRmFpbHVyZVtdfSBmYWlsdXJlcyAtIEZhaWxlZCBlbGlnaWJsZSBlYWdlciBkb3dubG9hZHMuXG4gKiBAcHJvcGVydHkge3N0cmluZ1tdfSBtaXNzaW5nUmVxdWlyZWRBc3NldElkcyAtIFJlcXVpcmVkIGRlc2NyaXB0b3JzIHdpdGhvdXQgY2FjaGVkIGJ5dGVzLlxuICovXG5cbmV4cG9ydCB7fVxuIl19