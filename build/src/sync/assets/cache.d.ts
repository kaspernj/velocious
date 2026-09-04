/**
 * Core synchronized asset cache. Platform packages own byte and metadata
 * persistence while this class owns policy, integrity, and lifecycle.
 */
export default class SynchronizedAssetCache {
    accountId: string;
    adapter: import("./types.js").SynchronizedAssetCacheAdapter;
    download: (descriptor: import("./types.js").SynchronizedAssetCacheDescriptor) => Promise<Uint8Array>;
    maxBytes: number;
    now: () => Date;
    retryBaseDelayMs: number;
    retryMaxDelayMs: number;
    /** @type {Map<string, number>} */
    activeDigestCounts: Map<string, number>;
    /** @type {Map<string, Promise<void>>} */
    deletionPromises: Map<string, Promise<void>>;
    /** @type {Set<string>} */
    cleanupRequiredAfterReleaseDigests: Set<string>;
    /** @type {Promise<number>} */
    cleanupPromise: Promise<number>;
    /** @type {Map<string, Promise<{error: Error, uri: null} | {error: null, uri: string}>>} */
    downloadPromises: Map<string, Promise<{
        error: Error;
        uri: null;
    } | {
        error: null;
        uri: string;
    }>>;
    /** @type {import("./types.js").SynchronizedAssetCacheState | null} */
    state: import("./types.js").SynchronizedAssetCacheState | null;
    /** @type {Promise<import("./types.js").SynchronizedAssetCacheState> | null} */
    statePromise: Promise<import("./types.js").SynchronizedAssetCacheState> | null;
    /** @type {Promise<void>} */
    saveStatePromise: Promise<void>;
    /** @type {Map<string, Promise<import("./types.js").SynchronizedAssetCacheSynchronizationResult>>} */
    synchronizePromises: Map<string, Promise<import("./types.js").SynchronizedAssetCacheSynchronizationResult>>;
    /**
     * Creates a synchronized asset cache.
     * @param {object} args Options.
     * @param {string} args.accountId Authenticated account namespace.
     * @param {import("./types.js").SynchronizedAssetCacheAdapter} args.adapter Platform storage adapter.
     * @param {(descriptor: import("./types.js").SynchronizedAssetCacheDescriptor) => Promise<Uint8Array>} args.download Authenticated byte downloader.
     * @param {number} args.maxBytes Maximum evictable cache size.
     * @param {() => Date} [args.now] Clock.
     * @param {number} [args.retryBaseDelayMs] Initial retry delay.
     * @param {number} [args.retryMaxDelayMs] Maximum retry delay.
     */
    constructor({ accountId, adapter, download, maxBytes, now, retryBaseDelayMs, retryMaxDelayMs }: {
        accountId: string;
        adapter: import("./types.js").SynchronizedAssetCacheAdapter;
        download: (descriptor: import("./types.js").SynchronizedAssetCacheDescriptor) => Promise<Uint8Array>;
        maxBytes: number;
        now?: () => Date;
        retryBaseDelayMs?: number;
        retryMaxDelayMs?: number;
    });
    /**
     * Reconciles the immutable descriptors for one synchronized scope and
     * downloads eligible eager assets.
     * @param {object} args Reconciliation inputs.
     * @param {import("./types.js").SynchronizedAssetCacheDescriptor[]} args.descriptors Current descriptors in the scope.
     * @param {boolean} args.online Whether authenticated downloads are available.
     * @param {string} args.scopeKey Stable synchronized scope key.
     * @returns {Promise<import("./types.js").SynchronizedAssetCacheSynchronizationResult>} Synchronization result.
     */
    synchronize({ descriptors, online, scopeKey }: {
        descriptors: import("./types.js").SynchronizedAssetCacheDescriptor[];
        online: boolean;
        scopeKey: string;
    }): Promise<import("./types.js").SynchronizedAssetCacheSynchronizationResult>;
    /**
     * Runs one scope synchronization after prior calls for that scope finish.
     * @param {object} args Reconciliation inputs.
     * @param {import("./types.js").SynchronizedAssetCacheDescriptor[]} args.descriptors Current descriptors in the scope.
     * @param {boolean} args.online Whether authenticated downloads are available.
     * @param {string} args.scopeKey Stable synchronized scope key.
     * @returns {Promise<import("./types.js").SynchronizedAssetCacheSynchronizationResult>} Synchronization result.
     */
    synchronizeScope({ descriptors, online, scopeKey }: {
        descriptors: import("./types.js").SynchronizedAssetCacheDescriptor[];
        online: boolean;
        scopeKey: string;
    }): Promise<import("./types.js").SynchronizedAssetCacheSynchronizationResult>;
    /**
     * Resolves a cached asset URI, downloading it on demand when allowed.
     * @param {object} args Resolution inputs.
     * @param {string} args.assetId Attachment descriptor id.
     * @param {boolean} args.online Whether authenticated downloads are available.
     * @returns {Promise<string | null>} Cached asset URI.
     */
    resolve({ assetId, online }: {
        assetId: string;
        online: boolean;
    }): Promise<string | null>;
    /**
     * Evicts least-recently-used blobs until the unique cached byte total is
     * within the configured budget. A blob stays durable when any live
     * descriptor reference declares durable retention.
     * @param {Set<string>} [protectedDigests] Digests needed by the active caller.
     * @returns {Promise<number>} Bytes removed.
     */
    cleanup(protectedDigests?: Set<string>): Promise<number>;
    /**
     * Performs one serialized eviction pass.
     * @param {Set<string>} protectedDigests Digests needed by the active caller.
     * @returns {Promise<number>} Bytes removed.
     */
    performCleanup(protectedDigests: Set<string>): Promise<number>;
    /**
     * Loads cache state once for this cache instance.
     * @returns {Promise<import("./types.js").SynchronizedAssetCacheState>} Loaded state.
     */
    loadState(): Promise<import("./types.js").SynchronizedAssetCacheState>;
    /**
     * Loads and recovers persisted cache state.
     * @returns {Promise<import("./types.js").SynchronizedAssetCacheState>} Loaded state.
     */
    loadStateFromAdapter(): Promise<import("./types.js").SynchronizedAssetCacheState>;
    /**
     * Persists the current cache state.
     * @returns {Promise<void>} Resolves after state persistence.
     */
    saveState(): Promise<void>;
    /**
     * Persists a detached reconciliation before exposing it through shared state.
     * @param {object} args Reconciliation inputs.
     * @param {import("./types.js").SynchronizedAssetCacheDescriptor[]} args.descriptors Current descriptors in the scope.
     * @param {string} args.scopeKey Stable synchronized scope key.
     * @returns {Promise<Map<string, import("./types.js").SynchronizedAssetCacheEntry>>} Reconciled live entries by id.
     */
    reconcileDescriptors({ descriptors, scopeKey }: {
        descriptors: import("./types.js").SynchronizedAssetCacheDescriptor[];
        scopeKey: string;
    }): Promise<Map<string, import("./types.js").SynchronizedAssetCacheEntry>>;
    /**
     * Applies one scope's descriptor set to cache state.
     * @param {object} args Reconciliation inputs.
     * @param {import("./types.js").SynchronizedAssetCacheDescriptor[]} args.descriptors Current descriptors in the scope.
     * @param {number} args.newEntryLastAccessedAt Initial LRU timestamp for new entries.
     * @param {string} args.scopeKey Stable synchronized scope key.
     * @param {import("./types.js").SynchronizedAssetCacheState} args.state State to reconcile.
     * @returns {Map<string, import("./types.js").SynchronizedAssetCacheEntry>} Live entries by id.
     */
    applyDescriptorReconciliation({ descriptors, newEntryLastAccessedAt, scopeKey, state }: {
        descriptors: import("./types.js").SynchronizedAssetCacheDescriptor[];
        newEntryLastAccessedAt: number;
        scopeKey: string;
        state: import("./types.js").SynchronizedAssetCacheState;
    }): Map<string, import("./types.js").SynchronizedAssetCacheEntry>;
    /**
     * Copies metadata into a detached persistence candidate.
     * @param {import("./types.js").SynchronizedAssetCacheState} state State to copy.
     * @returns {import("./types.js").SynchronizedAssetCacheState} Detached state.
     */
    copyState(state: import("./types.js").SynchronizedAssetCacheState): import("./types.js").SynchronizedAssetCacheState;
    /**
     * Serializes one metadata persistence operation after prior failures or successes.
     * @param {() => Promise<void>} persist Persistence operation.
     * @returns {Promise<void>} Resolves after persistence.
     */
    serializeStatePersistence(persist: () => Promise<void>): Promise<void>;
    /**
     * Ensures one descriptor has verified local bytes.
     * @param {import("./types.js").SynchronizedAssetCacheEntry} entry Descriptor state.
     * @returns {Promise<{error: Error | null, uri: string | null}>} Cache result.
     */
    ensureCached(entry: import("./types.js").SynchronizedAssetCacheEntry): Promise<{
        error: Error | null;
        uri: string | null;
    }>;
    /**
     * Resolves or downloads descriptors sharing one protected digest.
     * @param {import("./types.js").SynchronizedAssetCacheEntry[]} entries Descriptor states.
     * @returns {Promise<{error: Error | null, uri: string | null}>} Cache result.
     */
    ensureCachedWhileActive(entries: import("./types.js").SynchronizedAssetCacheEntry[]): Promise<{
        error: Error | null;
        uri: string | null;
    }>;
    /**
     * Records one cached digest result for every participating descriptor.
     * @param {import("./types.js").SynchronizedAssetCacheEntry[]} entries Descriptor states.
     * @returns {Promise<void>} Resolves after persistence.
     */
    recordCachedEntries(entries: import("./types.js").SynchronizedAssetCacheEntry[]): Promise<void>;
    /**
     * Persists download intent, then downloads one digest and records a shared failure once.
     * @param {import("./types.js").SynchronizedAssetCacheDescriptor} descriptor Asset descriptor.
     * @returns {Promise<{error: Error, uri: null} | {error: null, uri: string}>} Shared cache result.
     */
    downloadAfterPersistingState(descriptor: import("./types.js").SynchronizedAssetCacheDescriptor): Promise<{
        error: Error;
        uri: null;
    } | {
        error: null;
        uri: string;
    }>;
    /**
     * Advances retry metadata for every live descriptor sharing one failed digest.
     * @param {string} digest Content digest.
     * @returns {Promise<void>} Resolves after persistence.
     */
    recordDownloadFailure(digest: string): Promise<void>;
    /**
     * Downloads, verifies, and atomically persists one content digest.
     * @param {import("./types.js").SynchronizedAssetCacheDescriptor} descriptor Asset descriptor.
     * @returns {Promise<string>} Adapter URI.
     */
    downloadVerified(descriptor: import("./types.js").SynchronizedAssetCacheDescriptor): Promise<string>;
    /**
     * Resolves an existing local URI after waiting for deletion work.
     * @param {import("./types.js").SynchronizedAssetCacheEntry} entry Descriptor state.
     * @returns {Promise<string | null>} Existing URI.
     */
    cachedUri(entry: import("./types.js").SynchronizedAssetCacheEntry): Promise<string | null>;
    /**
     * Resolves an existing local URI while its digest is protected.
     * @param {import("./types.js").SynchronizedAssetCacheEntry} entry Descriptor state.
     * @returns {Promise<string | null>} Existing URI.
     */
    cachedUriWhileActive(entry: import("./types.js").SynchronizedAssetCacheEntry): Promise<string | null>;
    /**
     * Waits for deletion and protects a digest for one active cache operation.
     * @param {string} digest Content digest.
     * @returns {Promise<void>} Resolves after protection is registered.
     */
    beginActiveDigest(digest: string): Promise<void>;
    /**
     * Releases one cache operation and processes deferred deletion after the last.
     * @param {string} digest Content digest.
     * @param {Set<string>} [protectedCleanupDigests] Digests needed by the resolving caller.
     * @returns {Promise<boolean>} Whether finalization requires URI revalidation.
     */
    finishActiveDigest(digest: string, protectedCleanupDigests?: Set<string>): Promise<boolean>;
    /**
     * Releases every acquired digest before propagating finalization failures.
     * @param {string[]} digests Content digests.
     * @returns {Promise<void>} Resolves after every digest is released.
     */
    finishActiveDigests(digests: string[]): Promise<void>;
    /**
     * Deletes blobs that lost their final descriptor reference.
     * @returns {Promise<void>} Resolves after deletion.
     */
    deleteUnreferencedDigests(): Promise<void>;
    /**
     * Deletes one persisted pending digest when no descriptor or active operation owns it.
     * @param {string} digest Content digest.
     * @returns {Promise<boolean>} Whether the blob was deleted.
     */
    deletePendingDigestIfUnreferenced(digest: string): Promise<boolean>;
    /**
     * Runs one deletion only after earlier deletion work and when no cache operation owns the digest.
     * @param {string} digest Content digest.
     * @param {() => Promise<boolean>} callback Protected deletion callback.
     * @returns {Promise<boolean>} Whether the callback deleted the blob.
     */
    deleteDigestIfInactive(digest: string, callback: () => Promise<boolean>): Promise<boolean>;
    /**
     * Finds required assets without locally cached bytes.
     * @param {string} scopeKey Synchronized scope to inspect.
     * @returns {Promise<string[]>} Missing required descriptor ids.
     */
    missingRequiredAssetIds(scopeKey: string): Promise<string[]>;
    /**
     * Checks whether a failed or missing entry may be downloaded now.
     * @param {import("./types.js").SynchronizedAssetCacheEntry} entry Descriptor state.
     * @returns {boolean} Whether the retry deadline has passed.
     */
    retryEligible(entry: import("./types.js").SynchronizedAssetCacheEntry): boolean;
    /**
     * Calculates bounded exponential retry delay.
     * @param {number} attempts Consecutive failures.
     * @returns {number} Retry delay.
     */
    retryDelay(attempts: number): number;
    /**
     * Reads the injectable wall clock.
     * @returns {number} Current epoch milliseconds.
     */
    nowMilliseconds(): number;
}
//# sourceMappingURL=cache.d.ts.map