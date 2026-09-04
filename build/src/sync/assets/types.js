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
 * @property {string[]} pendingDeletionDigests - Unreferenced blobs awaiting confirmed deletion.
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidHlwZXMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvc3luYy9hc3NldHMvdHlwZXMuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaOzs7Ozs7Ozs7Ozs7OztHQWNHO0FBRUg7Ozs7Ozs7OztHQVNHO0FBRUg7Ozs7OztHQU1HO0FBRUg7Ozs7Ozs7O0dBUUc7QUFFSDs7Ozs7R0FLRztBQUVIOzs7OztHQUtHO0FBRUgsT0FBTyxFQUFFLENBQUEiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuLyoqXG4gKiBJbW11dGFibGUgYXR0YWNobWVudCBkZXNjcmlwdG9yIHN5bmNocm9uaXplZCBzZXBhcmF0ZWx5IGZyb20gaXRzIGJ5dGVzLlxuICogQHR5cGVkZWYge29iamVjdH0gU3luY2hyb25pemVkQXNzZXRDYWNoZURlc2NyaXB0b3JcbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBieXRlU2l6ZSAtIEV4cGVjdGVkIGJ5dGUgY291bnQuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IG51bGx9IGNvbnRlbnRUeXBlIC0gTWVkaWEgdHlwZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBkaWdlc3QgLSBFeHBlY3RlZCBgc2hhMjU2LTxoZXg+YCBjb250ZW50IGRpZ2VzdC5cbiAqIEBwcm9wZXJ0eSB7XCJlYWdlclwiIHwgXCJvbi1kZW1hbmRcIn0gZmV0Y2ggLSBEb3dubG9hZCB0aW1pbmcgcG9saWN5LlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGZpbGVuYW1lIC0gT3JpZ2luYWwgZmlsZW5hbWUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gaWQgLSBJbW11dGFibGUgYXR0YWNobWVudCBpZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBuYW1lIC0gQXR0YWNobWVudCBkZWNsYXJhdGlvbiBuYW1lLlxuICogQHByb3BlcnR5IHtcIm9wdGlvbmFsXCIgfCBcInJlcXVpcmVkXCJ9IG9mZmxpbmVSZXF1aXJlbWVudCAtIFdoZXRoZXIgb2ZmbGluZSByZWFkaW5lc3MgcmVxdWlyZXMgdGhlIGJ5dGVzLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHJlY29yZElkIC0gT3duZXIgcmVjb3JkIGlkLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHJlY29yZFR5cGUgLSBPd25lciBtb2RlbCBuYW1lLlxuICogQHByb3BlcnR5IHtcImR1cmFibGVcIiB8IFwiZXZpY3RhYmxlXCJ9IHJldGVudGlvbiAtIFN0b3JhZ2UtcHJlc3N1cmUgcG9saWN5LlxuICovXG5cbi8qKlxuICogUGVyc2lzdGVkIHN0YXRlIGZvciBvbmUgc3luY2hyb25pemVkIGF0dGFjaG1lbnQgZGVzY3JpcHRvci5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFN5bmNocm9uaXplZEFzc2V0Q2FjaGVFbnRyeVxuICogQHByb3BlcnR5IHtudW1iZXJ9IGF0dGVtcHRzIC0gQ29uc2VjdXRpdmUgZmFpbGVkIGRvd25sb2FkIGNvdW50LlxuICogQHByb3BlcnR5IHtTeW5jaHJvbml6ZWRBc3NldENhY2hlRGVzY3JpcHRvcn0gZGVzY3JpcHRvciAtIEN1cnJlbnQgaW1tdXRhYmxlIGRlc2NyaXB0b3IuXG4gKiBAcHJvcGVydHkge251bWJlcn0gbGFzdEFjY2Vzc2VkQXQgLSBNaWxsaXNlY29uZCBMUlUgdGltZXN0YW1wLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBudWxsfSBuZXh0UmV0cnlBdCAtIEVhcmxpZXN0IGF1dG9tYXRpYyByZXRyeSB0aW1lLlxuICogQHByb3BlcnR5IHtzdHJpbmdbXX0gc2NvcGVLZXlzIC0gU3luY2hyb25pemVkIHNjb3BlcyByZWZlcmVuY2luZyB0aGUgZGVzY3JpcHRvci5cbiAqIEBwcm9wZXJ0eSB7XCJjYWNoZWRcIiB8IFwiZG93bmxvYWRpbmdcIiB8IFwiZmFpbGVkXCIgfCBcIm1pc3NpbmdcIn0gc3RhdHVzIC0gTG9jYWwgYnl0ZSBzdGF0ZS5cbiAqL1xuXG4vKipcbiAqIFZlcnNpb25lZCBwZXJzaXN0ZW50IGNhY2hlIG1ldGFkYXRhIG93bmVkIGJ5IGEgcGxhdGZvcm0gYWRhcHRlci5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFN5bmNocm9uaXplZEFzc2V0Q2FjaGVTdGF0ZVxuICogQHByb3BlcnR5IHtTeW5jaHJvbml6ZWRBc3NldENhY2hlRW50cnlbXX0gYXNzZXRzIC0gRGVzY3JpcHRvciBlbnRyaWVzLlxuICogQHByb3BlcnR5IHtzdHJpbmdbXX0gcGVuZGluZ0RlbGV0aW9uRGlnZXN0cyAtIFVucmVmZXJlbmNlZCBibG9icyBhd2FpdGluZyBjb25maXJtZWQgZGVsZXRpb24uXG4gKiBAcHJvcGVydHkgezF9IHZlcnNpb24gLSBTdGF0ZSBzY2hlbWEgdmVyc2lvbi5cbiAqL1xuXG4vKipcbiAqIFBsYXRmb3JtIHN0b3JhZ2UgYWRhcHRlci4gYHdyaXRlQmxvYmAgbXVzdCBtYWtlIGJ5dGVzIHZpc2libGUgYXRvbWljYWxseS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFN5bmNocm9uaXplZEFzc2V0Q2FjaGVBZGFwdGVyXG4gKiBAcHJvcGVydHkgeyhhcmdzOiB7YWNjb3VudElkOiBzdHJpbmcsIGRpZ2VzdDogc3RyaW5nfSkgPT4gUHJvbWlzZTxzdHJpbmcgfCBudWxsPn0gYmxvYlVyaSAtIFJlc29sdmVzIGEgbG9jYWxseSBzdG9yZWQgYmxvYiBVUkkuXG4gKiBAcHJvcGVydHkgeyhhcmdzOiB7YWNjb3VudElkOiBzdHJpbmcsIGRpZ2VzdDogc3RyaW5nfSkgPT4gUHJvbWlzZTx2b2lkPn0gZGVsZXRlQmxvYiAtIERlbGV0ZXMgb25lIGxvY2FsIGJsb2IuXG4gKiBAcHJvcGVydHkgeyhhcmdzOiB7YWNjb3VudElkOiBzdHJpbmd9KSA9PiBQcm9taXNlPFN5bmNocm9uaXplZEFzc2V0Q2FjaGVTdGF0ZSB8IG51bGw+fSBsb2FkU3RhdGUgLSBMb2FkcyBhY2NvdW50LXNjb3BlZCBtZXRhZGF0YS5cbiAqIEBwcm9wZXJ0eSB7KGFyZ3M6IHthY2NvdW50SWQ6IHN0cmluZywgc3RhdGU6IFN5bmNocm9uaXplZEFzc2V0Q2FjaGVTdGF0ZX0pID0+IFByb21pc2U8dm9pZD59IHNhdmVTdGF0ZSAtIEF0b21pY2FsbHkgc2F2ZXMgYWNjb3VudC1zY29wZWQgbWV0YWRhdGEuXG4gKiBAcHJvcGVydHkgeyhhcmdzOiB7YWNjb3VudElkOiBzdHJpbmcsIGJ5dGVzOiBVaW50OEFycmF5LCBjb250ZW50VHlwZTogc3RyaW5nIHwgbnVsbCwgZGlnZXN0OiBzdHJpbmd9KSA9PiBQcm9taXNlPHN0cmluZz59IHdyaXRlQmxvYiAtIEF0b21pY2FsbHkgc3RvcmVzIHZlcmlmaWVkIGJ5dGVzLlxuICovXG5cbi8qKlxuICogRmFpbGVkIGFzc2V0IHJlc3VsdCBzdXJmYWNlZCB0byB0aGUgc3luYyBjb29yZGluYXRvci5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFN5bmNocm9uaXplZEFzc2V0Q2FjaGVGYWlsdXJlXG4gKiBAcHJvcGVydHkge3N0cmluZ30gYXNzZXRJZCAtIERlc2NyaXB0b3IgaWQuXG4gKiBAcHJvcGVydHkge0Vycm9yfSBlcnJvciAtIERvd25sb2FkIG9yIHZlcmlmaWNhdGlvbiBlcnJvci5cbiAqL1xuXG4vKipcbiAqIERlc2NyaXB0b3IgcmVjb25jaWxpYXRpb24gcmVzdWx0LlxuICogQHR5cGVkZWYge29iamVjdH0gU3luY2hyb25pemVkQXNzZXRDYWNoZVN5bmNocm9uaXphdGlvblJlc3VsdFxuICogQHByb3BlcnR5IHtTeW5jaHJvbml6ZWRBc3NldENhY2hlRmFpbHVyZVtdfSBmYWlsdXJlcyAtIEZhaWxlZCBlbGlnaWJsZSBlYWdlciBkb3dubG9hZHMuXG4gKiBAcHJvcGVydHkge3N0cmluZ1tdfSBtaXNzaW5nUmVxdWlyZWRBc3NldElkcyAtIFJlcXVpcmVkIGRlc2NyaXB0b3JzIHdpdGhvdXQgY2FjaGVkIGJ5dGVzLlxuICovXG5cbmV4cG9ydCB7fVxuIl19