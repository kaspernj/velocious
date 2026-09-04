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

export {}
