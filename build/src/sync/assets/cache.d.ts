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
    /** @type {Map<string, Promise<string>>} */
    downloadPromises: Map<string, Promise<string>>;
    /** @type {import("./types.js").SynchronizedAssetCacheState | null} */
    state: import("./types.js").SynchronizedAssetCacheState | null;
    /** @type {Promise<import("./types.js").SynchronizedAssetCacheState> | null} */
    statePromise: Promise<import("./types.js").SynchronizedAssetCacheState> | null;
    /** @type {Promise<void>} */
    saveStatePromise: Promise<void>;
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
     * Ensures one descriptor has verified local bytes.
     * @param {import("./types.js").SynchronizedAssetCacheEntry} entry Descriptor state.
     * @returns {Promise<{error: Error | null, uri: string | null}>} Cache result.
     */
    ensureCached(entry: import("./types.js").SynchronizedAssetCacheEntry): Promise<{
        error: Error | null;
        uri: string | null;
    }>;
    /**
     * Downloads, verifies, and atomically persists one content digest.
     * @param {import("./types.js").SynchronizedAssetCacheDescriptor} descriptor Asset descriptor.
     * @returns {Promise<string>} Adapter URI.
     */
    downloadVerified(descriptor: import("./types.js").SynchronizedAssetCacheDescriptor): Promise<string>;
    /**
     * Resolves an existing local URI and repairs stale cached metadata.
     * @param {import("./types.js").SynchronizedAssetCacheEntry} entry Descriptor state.
     * @returns {Promise<string | null>} Existing URI.
     */
    cachedUri(entry: import("./types.js").SynchronizedAssetCacheEntry): Promise<string | null>;
    /**
     * Deletes blobs that lost their final descriptor reference.
     * @returns {Promise<void>} Resolves after deletion.
     */
    deleteUnreferencedDigests(): Promise<void>;
    /**
     * Deletes one persisted pending digest when no descriptor or download owns it.
     * @param {string} digest Content digest.
     * @returns {Promise<void>} Resolves after any required deletion.
     */
    deletePendingDigestIfUnreferenced(digest: string): Promise<void>;
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