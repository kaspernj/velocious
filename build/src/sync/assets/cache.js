// @ts-check
import sha256BytesHex from "../../utils/sha256-bytes-hex.js";
const CACHE_STATE_VERSION = 1;
const DEFAULT_RETRY_BASE_DELAY_MS = 1000;
const DEFAULT_RETRY_MAX_DELAY_MS = 1000 * 60 * 5;
/**
 * Core synchronized asset cache. Platform packages own byte and metadata
 * persistence while this class owns policy, integrity, and lifecycle.
 */
export default class SynchronizedAssetCache {
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
    constructor({ accountId, adapter, download, maxBytes, now = () => new Date(), retryBaseDelayMs = DEFAULT_RETRY_BASE_DELAY_MS, retryMaxDelayMs = DEFAULT_RETRY_MAX_DELAY_MS }) {
        if (!accountId)
            throw new Error("Synchronized asset cache requires an account id");
        if (!Number.isSafeInteger(maxBytes) || maxBytes < 0)
            throw new Error("Synchronized asset cache maxBytes must be a non-negative safe integer");
        if (!Number.isSafeInteger(retryBaseDelayMs) || retryBaseDelayMs < 1)
            throw new Error("Synchronized asset cache retryBaseDelayMs must be a positive safe integer");
        if (!Number.isSafeInteger(retryMaxDelayMs) || retryMaxDelayMs < retryBaseDelayMs)
            throw new Error("Synchronized asset cache retryMaxDelayMs must be at least retryBaseDelayMs");
        this.accountId = accountId;
        this.adapter = adapter;
        this.download = download;
        this.maxBytes = maxBytes;
        this.now = now;
        this.retryBaseDelayMs = retryBaseDelayMs;
        this.retryMaxDelayMs = retryMaxDelayMs;
        /** @type {Map<string, number>} */
        this.activeDigestCounts = new Map();
        /** @type {Map<string, Promise<void>>} */
        this.deletionPromises = new Map();
        /** @type {Promise<void>} */
        this.resolveCleanupPromise = Promise.resolve();
        /** @type {Map<string, Promise<{error: Error, uri: null} | {error: null, uri: string}>>} */
        this.downloadPromises = new Map();
        /** @type {import("./types.js").SynchronizedAssetCacheState | null} */
        this.state = null;
        /** @type {Promise<import("./types.js").SynchronizedAssetCacheState> | null} */
        this.statePromise = null;
        /** @type {Promise<void>} */
        this.saveStatePromise = Promise.resolve();
    }
    /**
     * Reconciles the immutable descriptors for one synchronized scope and
     * downloads eligible eager assets.
     * @param {object} args Reconciliation inputs.
     * @param {import("./types.js").SynchronizedAssetCacheDescriptor[]} args.descriptors Current descriptors in the scope.
     * @param {boolean} args.online Whether authenticated downloads are available.
     * @param {string} args.scopeKey Stable synchronized scope key.
     * @returns {Promise<import("./types.js").SynchronizedAssetCacheSynchronizationResult>} Synchronization result.
     */
    async synchronize({ descriptors, online, scopeKey }) {
        await this.loadState();
        /** @type {Map<string, import("./types.js").SynchronizedAssetCacheDescriptor[]>} */
        const descriptorsByDigest = new Map();
        /** @type {import("./types.js").SynchronizedAssetCacheFailure[]} */
        const failures = [];
        /** @type {Set<string>} */
        const activeDigests = new Set();
        for (const descriptor of descriptors) {
            const digestDescriptors = descriptorsByDigest.get(descriptor.digest) || [];
            digestDescriptors.push(descriptor);
            descriptorsByDigest.set(descriptor.digest, digestDescriptors);
        }
        try {
            for (const digest of descriptorsByDigest.keys()) {
                await this.beginActiveDigest(digest);
                activeDigests.add(digest);
            }
            const entriesById = await this.reconcileDescriptors({ descriptors, scopeKey });
            await this.deleteUnreferencedDigests();
            for (const [digest, digestDescriptors] of descriptorsByDigest) {
                const eagerDescriptors = online ? digestDescriptors.filter((descriptor) => descriptor.fetch === "eager") : [];
                if (eagerDescriptors.length === 0) {
                    activeDigests.delete(digest);
                    await this.finishActiveDigest(digest);
                    continue;
                }
                /** @type {import("./types.js").SynchronizedAssetCacheEntry[]} */
                const eagerEntries = [];
                for (const descriptor of eagerDescriptors) {
                    const entry = entriesById.get(descriptor.id);
                    if (!entry)
                        throw new Error(`Missing reconciled synchronized asset descriptor ${descriptor.id}`);
                    eagerEntries.push(entry);
                }
                if (eagerEntries.some((entry) => this.retryEligible(entry))) {
                    const cacheResult = await this.ensureCachedWhileActive(eagerEntries);
                    if (cacheResult.error) {
                        for (const entry of eagerEntries) {
                            failures.push({ assetId: entry.descriptor.id, error: cacheResult.error });
                        }
                    }
                }
                activeDigests.delete(digest);
                await this.finishActiveDigest(digest);
                await this.cleanup();
            }
        }
        finally {
            await this.finishActiveDigests([...activeDigests]);
        }
        await this.cleanup();
        return {
            failures,
            missingRequiredAssetIds: await this.missingRequiredAssetIds(scopeKey)
        };
    }
    /**
     * Resolves a cached asset URI, downloading it on demand when allowed.
     * @param {object} args Resolution inputs.
     * @param {string} args.assetId Attachment descriptor id.
     * @param {boolean} args.online Whether authenticated downloads are available.
     * @returns {Promise<string | null>} Cached asset URI.
     */
    async resolve({ assetId, online }) {
        const state = await this.loadState();
        const entry = state.assets.find((candidate) => candidate.descriptor.id === assetId);
        if (!entry)
            return null;
        const digest = entry.descriptor.digest;
        let resolvedUri = null;
        let shouldCleanup = false;
        await this.beginActiveDigest(digest);
        try {
            const cachedUri = await this.cachedUriWhileActive(entry);
            if (cachedUri) {
                entry.lastAccessedAt = this.nowMilliseconds();
                entry.status = "cached";
                await this.saveState();
                resolvedUri = cachedUri;
            }
            else if (online && this.retryEligible(entry)) {
                const cacheResult = await this.ensureCachedWhileActive([entry]);
                if (cacheResult.error)
                    throw cacheResult.error;
                if (cacheResult.uri) {
                    resolvedUri = cacheResult.uri;
                    shouldCleanup = true;
                }
            }
        }
        finally {
            await this.finishActiveDigest(digest);
        }
        if (shouldCleanup)
            await this.cleanupAfterResolve(new Set([digest]));
        if (!resolvedUri)
            return null;
        const resolvedEntry = state.assets.find((candidate) => candidate.descriptor.id === assetId && candidate.descriptor.digest === digest);
        if (!resolvedEntry)
            return null;
        return await this.cachedUri(resolvedEntry);
    }
    /**
     * Evicts least-recently-used blobs until the unique cached byte total is
     * within the configured budget. A blob stays durable when any live
     * descriptor reference declares durable retention.
     * @param {Set<string>} [protectedDigests] Digests needed by the active caller.
     * @returns {Promise<number>} Bytes removed.
     */
    async cleanup(protectedDigests = new Set()) {
        const state = await this.loadState();
        /** @type {Map<string, import("./types.js").SynchronizedAssetCacheEntry[]>} */
        const entriesByDigest = new Map();
        for (const entry of state.assets) {
            const digestEntries = entriesByDigest.get(entry.descriptor.digest) || [];
            digestEntries.push(entry);
            entriesByDigest.set(entry.descriptor.digest, digestEntries);
        }
        /** @type {{byteSize: number, digest: string, lastAccessedAt: number}[]} */
        const cachedBlobs = [];
        let cachedBytes = 0;
        for (const [digest, references] of entriesByDigest) {
            const uri = await this.adapter.blobUri({ accountId: this.accountId, digest });
            if (!uri) {
                for (const entry of references) {
                    if (entry.status === "cached")
                        entry.status = "missing";
                }
                continue;
            }
            const byteSize = references[0].descriptor.byteSize;
            cachedBytes += byteSize;
            cachedBlobs.push({
                byteSize,
                digest,
                lastAccessedAt: Math.max(...references.map((entry) => entry.lastAccessedAt))
            });
        }
        let removedBytes = 0;
        while (cachedBlobs.length > 0) {
            if (cachedBytes <= this.maxBytes)
                break;
            for (const cachedBlob of cachedBlobs) {
                const currentReferences = state.assets.filter((entry) => entry.descriptor.digest === cachedBlob.digest);
                if (currentReferences.length > 0) {
                    cachedBlob.lastAccessedAt = Math.max(...currentReferences.map((entry) => entry.lastAccessedAt));
                }
            }
            cachedBlobs.sort((left, right) => left.lastAccessedAt - right.lastAccessedAt || left.digest.localeCompare(right.digest));
            const blob = cachedBlobs.shift();
            if (!blob)
                throw new Error("Expected a synchronized asset cache eviction candidate");
            if (protectedDigests.has(blob.digest))
                continue;
            let blobWasAlreadyMissing = false;
            const deleted = await this.deleteDigestIfInactive(blob.digest, async () => {
                if (!this.state)
                    throw new Error("Cannot clean synchronized asset blobs before loading state");
                const currentUri = await this.adapter.blobUri({ accountId: this.accountId, digest: blob.digest });
                const currentReferences = this.state.assets.filter((entry) => entry.descriptor.digest === blob.digest);
                if (!currentUri) {
                    blobWasAlreadyMissing = true;
                    for (const entry of currentReferences) {
                        if (entry.status === "cached")
                            entry.status = "missing";
                    }
                    return false;
                }
                if (currentReferences.some((entry) => entry.descriptor.retention === "durable"))
                    return false;
                await this.adapter.deleteBlob({ accountId: this.accountId, digest: blob.digest });
                for (const entry of currentReferences) {
                    entry.attempts = 0;
                    entry.nextRetryAt = null;
                    entry.status = "missing";
                }
                return true;
            });
            if (blobWasAlreadyMissing)
                cachedBytes -= blob.byteSize;
            if (!deleted)
                continue;
            cachedBytes -= blob.byteSize;
            removedBytes += blob.byteSize;
        }
        await this.saveState();
        return removedBytes;
    }
    /**
     * Serializes cleanup passes started after on-demand resolution releases its digest guard.
     * @param {Set<string>} protectedDigests Digests needed by the resolving caller.
     * @returns {Promise<void>} Resolves after cleanup.
     */
    async cleanupAfterResolve(protectedDigests) {
        const cleanup = async () => {
            await this.cleanup(protectedDigests);
        };
        this.resolveCleanupPromise = this.resolveCleanupPromise.then(cleanup, cleanup);
        await this.resolveCleanupPromise;
    }
    /**
     * Loads cache state once for this cache instance.
     * @returns {Promise<import("./types.js").SynchronizedAssetCacheState>} Loaded state.
     */
    async loadState() {
        if (this.state)
            return this.state;
        if (this.statePromise)
            return await this.statePromise;
        this.statePromise = this.loadStateFromAdapter();
        try {
            this.state = await this.statePromise;
            return this.state;
        }
        finally {
            this.statePromise = null;
        }
    }
    /**
     * Loads and recovers persisted cache state.
     * @returns {Promise<import("./types.js").SynchronizedAssetCacheState>} Loaded state.
     */
    async loadStateFromAdapter() {
        const loadedState = await this.adapter.loadState({ accountId: this.accountId });
        if (!loadedState)
            return { assets: [], pendingDeletionDigests: [], version: CACHE_STATE_VERSION };
        if (loadedState.version !== CACHE_STATE_VERSION) {
            throw new Error(`Unsupported synchronized asset cache state version: ${loadedState.version}`);
        }
        let recoveredInterruptedDownload = false;
        for (const entry of loadedState.assets) {
            if (entry.status !== "downloading")
                continue;
            entry.attempts += 1;
            entry.nextRetryAt = this.nowMilliseconds();
            entry.status = "failed";
            recoveredInterruptedDownload = true;
        }
        if (recoveredInterruptedDownload) {
            await this.adapter.saveState({ accountId: this.accountId, state: loadedState });
        }
        return loadedState;
    }
    /**
     * Persists the current cache state.
     * @returns {Promise<void>} Resolves after state persistence.
     */
    async saveState() {
        if (!this.state)
            throw new Error("Cannot save synchronized asset cache before loading state");
        const persist = async () => {
            if (!this.state)
                throw new Error("Cannot save synchronized asset cache before loading state");
            await this.adapter.saveState({ accountId: this.accountId, state: this.state });
        };
        await this.serializeStatePersistence(persist);
    }
    /**
     * Persists a detached reconciliation before exposing it through shared state.
     * @param {object} args Reconciliation inputs.
     * @param {import("./types.js").SynchronizedAssetCacheDescriptor[]} args.descriptors Current descriptors in the scope.
     * @param {string} args.scopeKey Stable synchronized scope key.
     * @returns {Promise<Map<string, import("./types.js").SynchronizedAssetCacheEntry>>} Reconciled live entries by id.
     */
    async reconcileDescriptors({ descriptors, scopeKey }) {
        /** @type {Map<string, import("./types.js").SynchronizedAssetCacheEntry> | null} */
        let entriesById = null;
        const persist = async () => {
            if (!this.state)
                throw new Error("Cannot reconcile synchronized asset cache before loading state");
            const candidateState = this.copyState(this.state);
            const newEntryLastAccessedAt = this.nowMilliseconds();
            this.applyDescriptorReconciliation({ descriptors, newEntryLastAccessedAt, scopeKey, state: candidateState });
            await this.adapter.saveState({ accountId: this.accountId, state: candidateState });
            entriesById = this.applyDescriptorReconciliation({ descriptors, newEntryLastAccessedAt, scopeKey, state: this.state });
        };
        await this.serializeStatePersistence(persist);
        if (!entriesById)
            throw new Error("Synchronized asset descriptor reconciliation completed without live entries");
        return entriesById;
    }
    /**
     * Applies one scope's descriptor set to cache state.
     * @param {object} args Reconciliation inputs.
     * @param {import("./types.js").SynchronizedAssetCacheDescriptor[]} args.descriptors Current descriptors in the scope.
     * @param {number} args.newEntryLastAccessedAt Initial LRU timestamp for new entries.
     * @param {string} args.scopeKey Stable synchronized scope key.
     * @param {import("./types.js").SynchronizedAssetCacheState} args.state State to reconcile.
     * @returns {Map<string, import("./types.js").SynchronizedAssetCacheEntry>} Live entries by id.
     */
    applyDescriptorReconciliation({ descriptors, newEntryLastAccessedAt, scopeKey, state }) {
        const incomingIds = new Set(descriptors.map((asset) => asset.id));
        const entriesById = new Map(state.assets.map((entry) => [entry.descriptor.id, entry]));
        const descriptorsById = new Map(state.assets.map((entry) => [entry.descriptor.id, entry.descriptor]));
        const removedDigests = new Set();
        for (const asset of descriptors) {
            const knownDescriptor = descriptorsById.get(asset.id);
            if (knownDescriptor && knownDescriptor.digest !== asset.digest) {
                throw new Error(`Synchronized asset descriptor ${asset.id} changed its immutable digest`);
            }
            if (knownDescriptor && knownDescriptor.byteSize !== asset.byteSize) {
                throw new Error(`Synchronized asset descriptor ${asset.id} changed its immutable byte size`);
            }
            if (knownDescriptor && knownDescriptor.contentType !== asset.contentType) {
                throw new Error(`Synchronized asset descriptor ${asset.id} changed its immutable content type`);
            }
            descriptorsById.set(asset.id, asset);
        }
        for (const entry of state.assets) {
            if (!entry.scopeKeys.includes(scopeKey) || incomingIds.has(entry.descriptor.id))
                continue;
            entry.scopeKeys = entry.scopeKeys.filter((candidate) => candidate !== scopeKey);
            if (entry.scopeKeys.length === 0)
                removedDigests.add(entry.descriptor.digest);
        }
        state.assets = state.assets.filter((entry) => entry.scopeKeys.length > 0);
        for (const asset of descriptors) {
            const existing = entriesById.get(asset.id);
            if (existing && state.assets.includes(existing)) {
                existing.descriptor = asset;
                if (!existing.scopeKeys.includes(scopeKey))
                    existing.scopeKeys.push(scopeKey);
            }
            else {
                const newEntry = {
                    attempts: 0,
                    descriptor: asset,
                    lastAccessedAt: newEntryLastAccessedAt,
                    nextRetryAt: null,
                    scopeKeys: [scopeKey],
                    status: /** @type {const} */ ("missing")
                };
                state.assets.push(newEntry);
                entriesById.set(asset.id, newEntry);
            }
        }
        /** @type {Map<string, number>} */
        const byteSizesByDigest = new Map();
        /** @type {Map<string, string | null>} */
        const contentTypesByDigest = new Map();
        for (const entry of state.assets) {
            const knownByteSize = byteSizesByDigest.get(entry.descriptor.digest);
            const knownContentType = contentTypesByDigest.get(entry.descriptor.digest);
            if (knownByteSize !== undefined && knownByteSize !== entry.descriptor.byteSize) {
                throw new Error(`Synchronized asset digest ${entry.descriptor.digest} has inconsistent byte sizes`);
            }
            if (knownContentType !== undefined && knownContentType !== entry.descriptor.contentType) {
                throw new Error(`Synchronized asset digest ${entry.descriptor.digest} has inconsistent content types`);
            }
            byteSizesByDigest.set(entry.descriptor.digest, entry.descriptor.byteSize);
            contentTypesByDigest.set(entry.descriptor.digest, entry.descriptor.contentType);
        }
        for (const digest of removedDigests) {
            if (state.assets.some((entry) => entry.descriptor.digest === digest))
                continue;
            if (!state.pendingDeletionDigests.includes(digest))
                state.pendingDeletionDigests.push(digest);
        }
        return entriesById;
    }
    /**
     * Copies metadata into a detached persistence candidate.
     * @param {import("./types.js").SynchronizedAssetCacheState} state State to copy.
     * @returns {import("./types.js").SynchronizedAssetCacheState} Detached state.
     */
    copyState(state) {
        return {
            assets: state.assets.map((entry) => ({
                ...entry,
                descriptor: { ...entry.descriptor },
                scopeKeys: [...entry.scopeKeys]
            })),
            pendingDeletionDigests: [...state.pendingDeletionDigests],
            version: state.version
        };
    }
    /**
     * Serializes one metadata persistence operation after prior failures or successes.
     * @param {() => Promise<void>} persist Persistence operation.
     * @returns {Promise<void>} Resolves after persistence.
     */
    async serializeStatePersistence(persist) {
        this.saveStatePromise = this.saveStatePromise.then(persist, persist);
        await this.saveStatePromise;
    }
    /**
     * Ensures one descriptor has verified local bytes.
     * @param {import("./types.js").SynchronizedAssetCacheEntry} entry Descriptor state.
     * @returns {Promise<{error: Error | null, uri: string | null}>} Cache result.
     */
    async ensureCached(entry) {
        const digest = entry.descriptor.digest;
        await this.beginActiveDigest(digest);
        try {
            return await this.ensureCachedWhileActive([entry]);
        }
        finally {
            await this.finishActiveDigest(digest);
        }
    }
    /**
     * Resolves or downloads descriptors sharing one protected digest.
     * @param {import("./types.js").SynchronizedAssetCacheEntry[]} entries Descriptor states.
     * @returns {Promise<{error: Error | null, uri: string | null}>} Cache result.
     */
    async ensureCachedWhileActive(entries) {
        const entry = entries[0];
        if (!entry)
            throw new Error("Cannot cache a synchronized asset digest without descriptor entries");
        const existingUri = await this.cachedUriWhileActive(entry);
        if (existingUri) {
            await this.recordCachedEntries(entries);
            return { error: null, uri: existingUri };
        }
        for (const digestEntry of entries)
            digestEntry.status = "downloading";
        const digest = entry.descriptor.digest;
        let downloadPromise = this.downloadPromises.get(digest);
        let ownsDownloadPromise = false;
        if (!downloadPromise) {
            downloadPromise = this.downloadAfterPersistingState(entry.descriptor);
            this.downloadPromises.set(digest, downloadPromise);
            ownsDownloadPromise = true;
        }
        else {
            await this.saveState();
        }
        try {
            const cacheResult = await downloadPromise;
            if (cacheResult.error) {
                if (entry.status === "downloading")
                    await this.recordDownloadFailure(digest);
                return cacheResult;
            }
            await this.recordCachedEntries(entries);
            return cacheResult;
        }
        finally {
            if (ownsDownloadPromise && this.downloadPromises.get(digest) === downloadPromise) {
                this.downloadPromises.delete(digest);
            }
        }
    }
    /**
     * Records one cached digest result for every participating descriptor.
     * @param {import("./types.js").SynchronizedAssetCacheEntry[]} entries Descriptor states.
     * @returns {Promise<void>} Resolves after persistence.
     */
    async recordCachedEntries(entries) {
        const lastAccessedAt = this.nowMilliseconds();
        for (const entry of entries) {
            entry.attempts = 0;
            entry.lastAccessedAt = lastAccessedAt;
            entry.nextRetryAt = null;
            entry.status = "cached";
        }
        await this.saveState();
    }
    /**
     * Persists download intent, then downloads one digest and records a shared failure once.
     * @param {import("./types.js").SynchronizedAssetCacheDescriptor} descriptor Asset descriptor.
     * @returns {Promise<{error: Error, uri: null} | {error: null, uri: string}>} Shared cache result.
     */
    async downloadAfterPersistingState(descriptor) {
        await this.saveState();
        try {
            return { error: null, uri: await this.downloadVerified(descriptor) };
        }
        catch (error) {
            const failure = error instanceof Error ? error : new Error(String(error));
            await this.recordDownloadFailure(descriptor.digest);
            return { error: failure, uri: null };
        }
    }
    /**
     * Advances retry metadata for every live descriptor sharing one failed digest.
     * @param {string} digest Content digest.
     * @returns {Promise<void>} Resolves after persistence.
     */
    async recordDownloadFailure(digest) {
        if (!this.state)
            throw new Error("Cannot record synchronized asset download failure before loading state");
        const failedAt = this.nowMilliseconds();
        for (const entry of this.state.assets) {
            if (entry.descriptor.digest !== digest)
                continue;
            if (entry.status !== "downloading")
                continue;
            entry.attempts += 1;
            entry.nextRetryAt = failedAt + this.retryDelay(entry.attempts);
            entry.status = "failed";
        }
        await this.saveState();
    }
    /**
     * Downloads, verifies, and atomically persists one content digest.
     * @param {import("./types.js").SynchronizedAssetCacheDescriptor} descriptor Asset descriptor.
     * @returns {Promise<string>} Adapter URI.
     */
    async downloadVerified(descriptor) {
        const downloadedBytes = await this.download(descriptor);
        if (!(downloadedBytes instanceof Uint8Array)) {
            throw new Error(`Synchronized asset ${descriptor.id} download did not return Uint8Array bytes`);
        }
        if (downloadedBytes.byteLength !== descriptor.byteSize) {
            throw new Error(`Synchronized asset ${descriptor.id} byte size did not match its descriptor`);
        }
        const digest = `sha256-${sha256BytesHex(downloadedBytes)}`;
        if (digest !== descriptor.digest) {
            throw new Error(`Synchronized asset ${descriptor.id} digest did not match its descriptor`);
        }
        const uri = await this.adapter.writeBlob({
            accountId: this.accountId,
            bytes: downloadedBytes,
            contentType: descriptor.contentType,
            digest
        });
        if (!uri)
            throw new Error(`Synchronized asset adapter returned no URI for ${descriptor.id}`);
        return uri;
    }
    /**
     * Resolves an existing local URI after waiting for deletion work.
     * @param {import("./types.js").SynchronizedAssetCacheEntry} entry Descriptor state.
     * @returns {Promise<string | null>} Existing URI.
     */
    async cachedUri(entry) {
        const digest = entry.descriptor.digest;
        await this.beginActiveDigest(digest);
        try {
            return await this.cachedUriWhileActive(entry);
        }
        finally {
            await this.finishActiveDigest(digest);
        }
    }
    /**
     * Resolves an existing local URI while its digest is protected.
     * @param {import("./types.js").SynchronizedAssetCacheEntry} entry Descriptor state.
     * @returns {Promise<string | null>} Existing URI.
     */
    async cachedUriWhileActive(entry) {
        const uri = await this.adapter.blobUri({
            accountId: this.accountId,
            digest: entry.descriptor.digest
        });
        if (!uri && entry.status === "cached")
            entry.status = "missing";
        return uri;
    }
    /**
     * Waits for deletion and protects a digest for one active cache operation.
     * @param {string} digest Content digest.
     * @returns {Promise<void>} Resolves after protection is registered.
     */
    async beginActiveDigest(digest) {
        let deletionPromise = this.deletionPromises.get(digest);
        while (deletionPromise) {
            await deletionPromise;
            deletionPromise = this.deletionPromises.get(digest);
        }
        const activeCount = this.activeDigestCounts.get(digest) ?? 0;
        this.activeDigestCounts.set(digest, activeCount + 1);
    }
    /**
     * Releases one cache operation and processes deferred deletion after the last.
     * @param {string} digest Content digest.
     * @returns {Promise<void>} Resolves after any pending deletion.
     */
    async finishActiveDigest(digest) {
        const activeCount = this.activeDigestCounts.get(digest);
        if (activeCount === undefined) {
            throw new Error(`Missing active synchronized asset digest count for ${digest}`);
        }
        if (activeCount > 1) {
            this.activeDigestCounts.set(digest, activeCount - 1);
            return;
        }
        this.activeDigestCounts.delete(digest);
        await this.deletePendingDigestIfUnreferenced(digest);
    }
    /**
     * Releases every acquired digest before propagating finalization failures.
     * @param {string[]} digests Content digests.
     * @returns {Promise<void>} Resolves after every digest is released.
     */
    async finishActiveDigests(digests) {
        /** @type {Error[]} */
        const failures = [];
        for (const digest of digests) {
            try {
                await this.finishActiveDigest(digest);
            }
            catch (error) {
                failures.push(error instanceof Error ? error : new Error(String(error)));
            }
        }
        if (failures.length === 1)
            throw failures[0];
        if (failures.length > 1) {
            throw new AggregateError(failures, "Multiple synchronized asset digest finalizers failed", { cause: failures[0] });
        }
    }
    /**
     * Deletes blobs that lost their final descriptor reference.
     * @returns {Promise<void>} Resolves after deletion.
     */
    async deleteUnreferencedDigests() {
        if (!this.state)
            throw new Error("Cannot delete synchronized asset blobs before loading state");
        for (const digest of [...this.state.pendingDeletionDigests]) {
            await this.deletePendingDigestIfUnreferenced(digest);
        }
    }
    /**
     * Deletes one persisted pending digest when no descriptor or active operation owns it.
     * @param {string} digest Content digest.
     * @returns {Promise<void>} Resolves after any required deletion.
     */
    async deletePendingDigestIfUnreferenced(digest) {
        if (!this.state)
            throw new Error("Cannot delete synchronized asset blobs before loading state");
        if (!this.state.pendingDeletionDigests.includes(digest))
            return;
        await this.deleteDigestIfInactive(digest, async () => {
            if (!this.state)
                throw new Error("Cannot delete synchronized asset blobs before loading state");
            if (!this.state.pendingDeletionDigests.includes(digest))
                return false;
            let deleted = false;
            if (!this.state.assets.some((entry) => entry.descriptor.digest === digest)) {
                await this.adapter.deleteBlob({ accountId: this.accountId, digest });
                deleted = true;
            }
            const pendingDeletionDigests = this.state.pendingDeletionDigests;
            this.state.pendingDeletionDigests = pendingDeletionDigests.filter((candidate) => candidate !== digest);
            try {
                await this.saveState();
            }
            catch (error) {
                if (!this.state.pendingDeletionDigests.includes(digest))
                    this.state.pendingDeletionDigests.push(digest);
                throw error;
            }
            return deleted;
        });
    }
    /**
     * Runs one deletion only after earlier deletion work and when no cache operation owns the digest.
     * @param {string} digest Content digest.
     * @param {() => Promise<boolean>} callback Protected deletion callback.
     * @returns {Promise<boolean>} Whether the callback deleted the blob.
     */
    async deleteDigestIfInactive(digest, callback) {
        let activeDeletionPromise = this.deletionPromises.get(digest);
        while (activeDeletionPromise) {
            await activeDeletionPromise;
            activeDeletionPromise = this.deletionPromises.get(digest);
        }
        if (this.activeDigestCounts.has(digest))
            return false;
        /**
         * Releases callers waiting for deletion completion.
         * @type {() => void}
         */
        let releaseDeletion = () => { };
        /**
         * Blocks new digest activity until deletion completes.
         * @type {Promise<void>}
         */
        const deletionPromise = new Promise((resolve) => {
            releaseDeletion = () => resolve(undefined);
        });
        this.deletionPromises.set(digest, deletionPromise);
        try {
            return await callback();
        }
        finally {
            if (this.deletionPromises.get(digest) === deletionPromise)
                this.deletionPromises.delete(digest);
            releaseDeletion();
        }
    }
    /**
     * Finds required assets without locally cached bytes.
     * @param {string} scopeKey Synchronized scope to inspect.
     * @returns {Promise<string[]>} Missing required descriptor ids.
     */
    async missingRequiredAssetIds(scopeKey) {
        const state = await this.loadState();
        /** @type {string[]} */
        const missingAssetIds = [];
        for (const entry of state.assets) {
            if (!entry.scopeKeys.includes(scopeKey))
                continue;
            if (entry.descriptor.offlineRequirement !== "required")
                continue;
            if (await this.cachedUri(entry))
                continue;
            missingAssetIds.push(entry.descriptor.id);
        }
        return missingAssetIds;
    }
    /**
     * Checks whether a failed or missing entry may be downloaded now.
     * @param {import("./types.js").SynchronizedAssetCacheEntry} entry Descriptor state.
     * @returns {boolean} Whether the retry deadline has passed.
     */
    retryEligible(entry) {
        return entry.status !== "failed" || entry.nextRetryAt === null || entry.nextRetryAt <= this.nowMilliseconds();
    }
    /**
     * Calculates bounded exponential retry delay.
     * @param {number} attempts Consecutive failures.
     * @returns {number} Retry delay.
     */
    retryDelay(attempts) {
        return Math.min(this.retryMaxDelayMs, this.retryBaseDelayMs * (2 ** Math.max(0, attempts - 1)));
    }
    /**
     * Reads the injectable wall clock.
     * @returns {number} Current epoch milliseconds.
     */
    nowMilliseconds() {
        return this.now().getTime();
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2FjaGUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvc3luYy9hc3NldHMvY2FjaGUuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sY0FBYyxNQUFNLGlDQUFpQyxDQUFBO0FBRTVELE1BQU0sbUJBQW1CLEdBQUcsQ0FBQyxDQUFBO0FBQzdCLE1BQU0sMkJBQTJCLEdBQUcsSUFBSSxDQUFBO0FBQ3hDLE1BQU0sMEJBQTBCLEdBQUcsSUFBSSxHQUFHLEVBQUUsR0FBRyxDQUFDLENBQUE7QUFFaEQ7OztHQUdHO0FBQ0gsTUFBTSxDQUFDLE9BQU8sT0FBTyxzQkFBc0I7SUFDekM7Ozs7Ozs7Ozs7T0FVRztJQUNILFlBQVksRUFBQyxTQUFTLEVBQUUsT0FBTyxFQUFFLFFBQVEsRUFBRSxRQUFRLEVBQUUsR0FBRyxHQUFHLEdBQUcsRUFBRSxDQUFDLElBQUksSUFBSSxFQUFFLEVBQUUsZ0JBQWdCLEdBQUcsMkJBQTJCLEVBQUUsZUFBZSxHQUFHLDBCQUEwQixFQUFDO1FBQ3hLLElBQUksQ0FBQyxTQUFTO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxpREFBaUQsQ0FBQyxDQUFBO1FBQ2xGLElBQUksQ0FBQyxNQUFNLENBQUMsYUFBYSxDQUFDLFFBQVEsQ0FBQyxJQUFJLFFBQVEsR0FBRyxDQUFDO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyx1RUFBdUUsQ0FBQyxDQUFBO1FBQzdJLElBQUksQ0FBQyxNQUFNLENBQUMsYUFBYSxDQUFDLGdCQUFnQixDQUFDLElBQUksZ0JBQWdCLEdBQUcsQ0FBQztZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsMkVBQTJFLENBQUMsQ0FBQTtRQUNqSyxJQUFJLENBQUMsTUFBTSxDQUFDLGFBQWEsQ0FBQyxlQUFlLENBQUMsSUFBSSxlQUFlLEdBQUcsZ0JBQWdCO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyw0RUFBNEUsQ0FBQyxDQUFBO1FBRS9LLElBQUksQ0FB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RyxFQUFFLENBQUMsT0FBTyxFQUFFLENBQUE7SUFDN0IsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBzaGEyNTZCeXRlc0hleCBmcm9tIFwiLi4vLi4vdXRpbHMvc2hhMjU2LWJ5dGVzLWhleC5qc1wiXG5cbmNvbnN0IENBQ0hFX1NUQVRFX1ZFUlNJT04gPSAxXG5jb25zdCBERUZBVUxUX1JFVFJZX0JBU0VfREVMQVlfTVMgPSAxMDAwXG5jb25zdCBERUZBVUxUX1JFVFJZX01BWF9ERUxBWV9NUyA9IDEwMDAgKiA2MCAqIDVcblxuLyoqXG4gKiBDb3JlIHN5bmNocm9uaXplZCBhc3NldCBjYWNoZS4gUGxhdGZvcm0gcGFja2FnZXMgb3duIGJ5dGUgYW5kIG1ldGFkYXRhXG4gKiBwZXJzaXN0ZW5jZSB3aGlsZSB0aGlzIGNsYXNzIG93bnMgcG9saWN5LCBpbnRlZ3JpdHksIGFuZCBsaWZlY3ljbGUuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFN5bmNocm9uaXplZEFzc2V0Q2FjaGUge1xuICAvKipcbiAgICogQ3JlYXRlcyBhIHN5bmNocm9uaXplZCBhc3NldCBjYWNoZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuYWNjb3VudElkIEF1dGhlbnRpY2F0ZWQgYWNjb3VudCBuYW1lc3BhY2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlQWRhcHRlcn0gYXJncy5hZGFwdGVyIFBsYXRmb3JtIHN0b3JhZ2UgYWRhcHRlci5cbiAgICogQHBhcmFtIHsoZGVzY3JpcHRvcjogaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlRGVzY3JpcHRvcikgPT4gUHJvbWlzZTxVaW50OEFycmF5Pn0gYXJncy5kb3dubG9hZCBBdXRoZW50aWNhdGVkIGJ5dGUgZG93bmxvYWRlci5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MubWF4Qnl0ZXMgTWF4aW11bSBldmljdGFibGUgY2FjaGUgc2l6ZS5cbiAgICogQHBhcmFtIHsoKSA9PiBEYXRlfSBbYXJncy5ub3ddIENsb2NrLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MucmV0cnlCYXNlRGVsYXlNc10gSW5pdGlhbCByZXRyeSBkZWxheS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLnJldHJ5TWF4RGVsYXlNc10gTWF4aW11bSByZXRyeSBkZWxheS5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHthY2NvdW50SWQsIGFkYXB0ZXIsIGRvd25sb2FkLCBtYXhCeXRlcywgbm93ID0gKCkgPT4gbmV3IERhdGUoKSwgcmV0cnlCYXNlRGVsYXlNcyA9IERFRkFVTFRfUkVUUllfQkFTRV9ERUxBWV9NUywgcmV0cnlNYXhEZWxheU1zID0gREVGQVVMVF9SRVRSWV9NQVhfREVMQVlfTVN9KSB7XG4gICAgaWYgKCFhY2NvdW50SWQpIHRocm93IG5ldyBFcnJvcihcIlN5bmNocm9uaXplZCBhc3NldCBjYWNoZSByZXF1aXJlcyBhbiBhY2NvdW50IGlkXCIpXG4gICAgaWYgKCFOdW1iZXIuaXNTYWZlSW50ZWdlcihtYXhCeXRlcykgfHwgbWF4Qnl0ZXMgPCAwKSB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jaHJvbml6ZWQgYXNzZXQgY2FjaGUgbWF4Qnl0ZXMgbXVzdCBiZSBhIG5vbi1uZWdhdGl2ZSBzYWZlIGludGVnZXJcIilcbiAgICBpZiAoIU51bWJlci5pc1NhZmVJbnRlZ2VyKHJldHJ5QmFzZURlbGF5TXMpIHx8IHJldHJ5QmFzZURlbGF5TXMgPCAxKSB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jaHJvbml6ZWQgYXNzZXQgY2FjaGUgcmV0cnlCYXNlRGVsYXlNcyBtdXN0IGJlIGEgcG9zaXRpdmUgc2FmZSBpbnRlZ2VyXCIpXG4gICAgaWYgKCFOdW1iZXIuaXNTYWZlSW50ZWdlcihyZXRyeU1heERlbGF5TXMpIHx8IHJldHJ5TWF4RGVsYXlNcyA8IHJldHJ5QmFzZURlbGF5TXMpIHRocm93IG5ldyBFcnJvcihcIlN5bmNocm9uaXplZCBhc3NldCBjYWNoZSByZXRyeU1heERlbGF5TXMgbXVzdCBiZSBhdCBsZWFzdCByZXRyeUJhc2VEZWxheU1zXCIpXG5cbiAgICB0aGlzLmFjY291bnRJZCA9IGFjY291bnRJZFxuICAgIHRoaXMuYWRhcHRlciA9IGFkYXB0ZXJcbiAgICB0aGlzLmRvd25sb2FkID0gZG93bmxvYWRcbiAgICB0aGlzLm1heEJ5dGVzID0gbWF4Qnl0ZXNcbiAgICB0aGlzLm5vdyA9IG5vd1xuICAgIHRoaXMucmV0cnlCYXNlRGVsYXlNcyA9IHJldHJ5QmFzZURlbGF5TXNcbiAgICB0aGlzLnJldHJ5TWF4RGVsYXlNcyA9IHJldHJ5TWF4RGVsYXlNc1xuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgbnVtYmVyPn0gKi9cbiAgICB0aGlzLmFjdGl2ZURpZ2VzdENvdW50cyA9IG5ldyBNYXAoKVxuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgUHJvbWlzZTx2b2lkPj59ICovXG4gICAgdGhpcy5kZWxldGlvblByb21pc2VzID0gbmV3IE1hcCgpXG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+fSAqL1xuICAgIHRoaXMucmVzb2x2ZUNsZWFudXBQcm9taXNlID0gUHJvbWlzZS5yZXNvbHZlKClcbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIFByb21pc2U8e2Vycm9yOiBFcnJvciwgdXJpOiBudWxsfSB8IHtlcnJvcjogbnVsbCwgdXJpOiBzdHJpbmd9Pj59ICovXG4gICAgdGhpcy5kb3dubG9hZFByb21pc2VzID0gbmV3IE1hcCgpXG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVTdGF0ZSB8IG51bGx9ICovXG4gICAgdGhpcy5zdGF0ZSA9IG51bGxcbiAgICAvKiogQHR5cGUge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlU3RhdGU+IHwgbnVsbH0gKi9cbiAgICB0aGlzLnN0YXRlUHJvbWlzZSA9IG51bGxcbiAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD59ICovXG4gICAgdGhpcy5zYXZlU3RhdGVQcm9taXNlID0gUHJvbWlzZS5yZXNvbHZlKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvbmNpbGVzIHRoZSBpbW11dGFibGUgZGVzY3JpcHRvcnMgZm9yIG9uZSBzeW5jaHJvbml6ZWQgc2NvcGUgYW5kXG4gICAqIGRvd25sb2FkcyBlbGlnaWJsZSBlYWdlciBhc3NldHMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIFJlY29uY2lsaWF0aW9uIGlucHV0cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVEZXNjcmlwdG9yW119IGFyZ3MuZGVzY3JpcHRvcnMgQ3VycmVudCBkZXNjcmlwdG9ycyBpbiB0aGUgc2NvcGUuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5vbmxpbmUgV2hldGhlciBhdXRoZW50aWNhdGVkIGRvd25sb2FkcyBhcmUgYXZhaWxhYmxlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zY29wZUtleSBTdGFibGUgc3luY2hyb25pemVkIHNjb3BlIGtleS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlU3luY2hyb25pemF0aW9uUmVzdWx0Pn0gU3luY2hyb25pemF0aW9uIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHN5bmNocm9uaXplKHtkZXNjcmlwdG9ycywgb25saW5lLCBzY29wZUtleX0pIHtcbiAgICBhd2FpdCB0aGlzLmxvYWRTdGF0ZSgpXG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVEZXNjcmlwdG9yW10+fSAqL1xuICAgIGNvbnN0IGRlc2NyaXB0b3JzQnlEaWdlc3QgPSBuZXcgTWFwKClcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZUZhaWx1cmVbXX0gKi9cbiAgICBjb25zdCBmYWlsdXJlcyA9IFtdXG4gICAgLyoqIEB0eXBlIHtTZXQ8c3RyaW5nPn0gKi9cbiAgICBjb25zdCBhY3RpdmVEaWdlc3RzID0gbmV3IFNldCgpXG5cbiAgICBmb3IgKGNvbnN0IGRlc2NyaXB0b3Igb2YgZGVzY3JpcHRvcnMpIHtcbiAgICAgIGNvbnN0IGRpZ2VzdERlc2NyaXB0b3JzID0gZGVzY3JpcHRvcnNCeURpZ2VzdC5nZXQoZGVzY3JpcHRvci5kaWdlc3QpIHx8IFtdXG5cbiAgICAgIGRpZ2VzdERlc2NyaXB0b3JzLnB1c2goZGVzY3JpcHRvcilcbiAgICAgIGRlc2NyaXB0b3JzQnlEaWdlc3Quc2V0KGRlc2NyaXB0b3IuZGlnZXN0LCBkaWdlc3REZXNjcmlwdG9ycylcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgZm9yIChjb25zdCBkaWdlc3Qgb2YgZGVzY3JpcHRvcnNCeURpZ2VzdC5rZXlzKCkpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5iZWdpbkFjdGl2ZURpZ2VzdChkaWdlc3QpXG4gICAgICAgIGFjdGl2ZURpZ2VzdHMuYWRkKGRpZ2VzdClcbiAgICAgIH1cblxuICAgICAgY29uc3QgZW50cmllc0J5SWQgPSBhd2FpdCB0aGlzLnJlY29uY2lsZURlc2NyaXB0b3JzKHtkZXNjcmlwdG9ycywgc2NvcGVLZXl9KVxuXG4gICAgICBhd2FpdCB0aGlzLmRlbGV0ZVVucmVmZXJlbmNlZERpZ2VzdHMoKVxuXG4gICAgICBmb3IgKGNvbnN0IFtkaWdlc3QsIGRpZ2VzdERlc2NyaXB0b3JzXSBvZiBkZXNjcmlwdG9yc0J5RGlnZXN0KSB7XG4gICAgICAgIGNvbnN0IGVhZ2VyRGVzY3JpcHRvcnMgPSBvbmxpbmUgPyBkaWdlc3REZXNjcmlwdG9ycy5maWx0ZXIoKGRlc2NyaXB0b3IpID0+IGRlc2NyaXB0b3IuZmV0Y2ggPT09IFwiZWFnZXJcIikgOiBbXVxuXG4gICAgICAgIGlmIChlYWdlckRlc2NyaXB0b3JzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgIGFjdGl2ZURpZ2VzdHMuZGVsZXRlKGRpZ2VzdClcbiAgICAgICAgICBhd2FpdCB0aGlzLmZpbmlzaEFjdGl2ZURpZ2VzdChkaWdlc3QpXG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfVxuXG4gICAgICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlRW50cnlbXX0gKi9cbiAgICAgICAgY29uc3QgZWFnZXJFbnRyaWVzID0gW11cblxuICAgICAgICBmb3IgKGNvbnN0IGRlc2NyaXB0b3Igb2YgZWFnZXJEZXNjcmlwdG9ycykge1xuICAgICAgICAgIGNvbnN0IGVudHJ5ID0gZW50cmllc0J5SWQuZ2V0KGRlc2NyaXB0b3IuaWQpXG5cbiAgICAgICAgICBpZiAoIWVudHJ5KSB0aHJvdyBuZXcgRXJyb3IoYE1pc3NpbmcgcmVjb25jaWxlZCBzeW5jaHJvbml6ZWQgYXNzZXQgZGVzY3JpcHRvciAke2Rlc2NyaXB0b3IuaWR9YClcblxuICAgICAgICAgIGVhZ2VyRW50cmllcy5wdXNoKGVudHJ5KVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGVhZ2VyRW50cmllcy5zb21lKChlbnRyeSkgPT4gdGhpcy5yZXRyeUVsaWdpYmxlKGVudHJ5KSkpIHtcbiAgICAgICAgICBjb25zdCBjYWNoZVJlc3VsdCA9IGF3YWl0IHRoaXMuZW5zdXJlQ2FjaGVkV2hpbGVBY3RpdmUoZWFnZXJFbnRyaWVzKVxuXG4gICAgICAgICAgaWYgKGNhY2hlUmVzdWx0LmVycm9yKSB7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGVhZ2VyRW50cmllcykge1xuICAgICAgICAgICAgICBmYWlsdXJlcy5wdXNoKHthc3NldElkOiBlbnRyeS5kZXNjcmlwdG9yLmlkLCBlcnJvcjogY2FjaGVSZXN1bHQuZXJyb3J9KVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGFjdGl2ZURpZ2VzdHMuZGVsZXRlKGRpZ2VzdClcbiAgICAgICAgYXdhaXQgdGhpcy5maW5pc2hBY3RpdmVEaWdlc3QoZGlnZXN0KVxuICAgICAgICBhd2FpdCB0aGlzLmNsZWFudXAoKVxuICAgICAgfVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCB0aGlzLmZpbmlzaEFjdGl2ZURpZ2VzdHMoWy4uLmFjdGl2ZURpZ2VzdHNdKVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuY2xlYW51cCgpXG5cbiAgICByZXR1cm4ge1xuICAgICAgZmFpbHVyZXMsXG4gICAgICBtaXNzaW5nUmVxdWlyZWRBc3NldElkczogYXdhaXQgdGhpcy5taXNzaW5nUmVxdWlyZWRBc3NldElkcyhzY29wZUtleSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYSBjYWNoZWQgYXNzZXQgVVJJLCBkb3dubG9hZGluZyBpdCBvbiBkZW1hbmQgd2hlbiBhbGxvd2VkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyBSZXNvbHV0aW9uIGlucHV0cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuYXNzZXRJZCBBdHRhY2htZW50IGRlc2NyaXB0b3IgaWQuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5vbmxpbmUgV2hldGhlciBhdXRoZW50aWNhdGVkIGRvd25sb2FkcyBhcmUgYXZhaWxhYmxlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmcgfCBudWxsPn0gQ2FjaGVkIGFzc2V0IFVSSS5cbiAgICovXG4gIGFzeW5jIHJlc29sdmUoe2Fzc2V0SWQsIG9ubGluZX0pIHtcbiAgICBjb25zdCBzdGF0ZSA9IGF3YWl0IHRoaXMubG9hZFN0YXRlKClcbiAgICBjb25zdCBlbnRyeSA9IHN0YXRlLmFzc2V0cy5maW5kKChjYW5kaWRhdGUpID0+IGNhbmRpZGF0ZS5kZXNjcmlwdG9yLmlkID09PSBhc3NldElkKVxuXG4gICAgaWYgKCFlbnRyeSkgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IGRpZ2VzdCA9IGVudHJ5LmRlc2NyaXB0b3IuZGlnZXN0XG4gICAgbGV0IHJlc29sdmVkVXJpID0gbnVsbFxuICAgIGxldCBzaG91bGRDbGVhbnVwID0gZmFsc2VcblxuICAgIGF3YWl0IHRoaXMuYmVnaW5BY3RpdmVEaWdlc3QoZGlnZXN0KVxuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGNhY2hlZFVyaSA9IGF3YWl0IHRoaXMuY2FjaGVkVXJpV2hpbGVBY3RpdmUoZW50cnkpXG5cbiAgICAgIGlmIChjYWNoZWRVcmkpIHtcbiAgICAgICAgZW50cnkubGFzdEFjY2Vzc2VkQXQgPSB0aGlzLm5vd01pbGxpc2Vjb25kcygpXG4gICAgICAgIGVudHJ5LnN0YXR1cyA9IFwiY2FjaGVkXCJcbiAgICAgICAgYXdhaXQgdGhpcy5zYXZlU3RhdGUoKVxuXG4gICAgICAgIHJlc29sdmVkVXJpID0gY2FjaGVkVXJpXG4gICAgICB9IGVsc2UgaWYgKG9ubGluZSAmJiB0aGlzLnJldHJ5RWxpZ2libGUoZW50cnkpKSB7XG4gICAgICAgIGNvbnN0IGNhY2hlUmVzdWx0ID0gYXdhaXQgdGhpcy5lbnN1cmVDYWNoZWRXaGlsZUFjdGl2ZShbZW50cnldKVxuXG4gICAgICAgIGlmIChjYWNoZVJlc3VsdC5lcnJvcikgdGhyb3cgY2FjaGVSZXN1bHQuZXJyb3JcblxuICAgICAgICBpZiAoY2FjaGVSZXN1bHQudXJpKSB7XG4gICAgICAgICAgcmVzb2x2ZWRVcmkgPSBjYWNoZVJlc3VsdC51cmlcbiAgICAgICAgICBzaG91bGRDbGVhbnVwID0gdHJ1ZVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IHRoaXMuZmluaXNoQWN0aXZlRGlnZXN0KGRpZ2VzdClcbiAgICB9XG5cbiAgICBpZiAoc2hvdWxkQ2xlYW51cCkgYXdhaXQgdGhpcy5jbGVhbnVwQWZ0ZXJSZXNvbHZlKG5ldyBTZXQoW2RpZ2VzdF0pKVxuICAgIGlmICghcmVzb2x2ZWRVcmkpIHJldHVybiBudWxsXG4gICAgY29uc3QgcmVzb2x2ZWRFbnRyeSA9IHN0YXRlLmFzc2V0cy5maW5kKChjYW5kaWRhdGUpID0+IGNhbmRpZGF0ZS5kZXNjcmlwdG9yLmlkID09PSBhc3NldElkICYmIGNhbmRpZGF0ZS5kZXNjcmlwdG9yLmRpZ2VzdCA9PT0gZGlnZXN0KVxuXG4gICAgaWYgKCFyZXNvbHZlZEVudHJ5KSByZXR1cm4gbnVsbFxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuY2FjaGVkVXJpKHJlc29sdmVkRW50cnkpXG4gIH1cblxuICAvKipcbiAgICogRXZpY3RzIGxlYXN0LXJlY2VudGx5LXVzZWQgYmxvYnMgdW50aWwgdGhlIHVuaXF1ZSBjYWNoZWQgYnl0ZSB0b3RhbCBpc1xuICAgKiB3aXRoaW4gdGhlIGNvbmZpZ3VyZWQgYnVkZ2V0LiBBIGJsb2Igc3RheXMgZHVyYWJsZSB3aGVuIGFueSBsaXZlXG4gICAqIGRlc2NyaXB0b3IgcmVmZXJlbmNlIGRlY2xhcmVzIGR1cmFibGUgcmV0ZW50aW9uLlxuICAgKiBAcGFyYW0ge1NldDxzdHJpbmc+fSBbcHJvdGVjdGVkRGlnZXN0c10gRGlnZXN0cyBuZWVkZWQgYnkgdGhlIGFjdGl2ZSBjYWxsZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IEJ5dGVzIHJlbW92ZWQuXG4gICAqL1xuICBhc3luYyBjbGVhbnVwKHByb3RlY3RlZERpZ2VzdHMgPSBuZXcgU2V0KCkpIHtcbiAgICBjb25zdCBzdGF0ZSA9IGF3YWl0IHRoaXMubG9hZFN0YXRlKClcbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIGltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZUVudHJ5W10+fSAqL1xuICAgIGNvbnN0IGVudHJpZXNCeURpZ2VzdCA9IG5ldyBNYXAoKVxuXG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiBzdGF0ZS5hc3NldHMpIHtcbiAgICAgIGNvbnN0IGRpZ2VzdEVudHJpZXMgPSBlbnRyaWVzQnlEaWdlc3QuZ2V0KGVudHJ5LmRlc2NyaXB0b3IuZGlnZXN0KSB8fCBbXVxuXG4gICAgICBkaWdlc3RFbnRyaWVzLnB1c2goZW50cnkpXG4gICAgICBlbnRyaWVzQnlEaWdlc3Quc2V0KGVudHJ5LmRlc2NyaXB0b3IuZGlnZXN0LCBkaWdlc3RFbnRyaWVzKVxuICAgIH1cblxuICAgIC8qKiBAdHlwZSB7e2J5dGVTaXplOiBudW1iZXIsIGRpZ2VzdDogc3RyaW5nLCBsYXN0QWNjZXNzZWRBdDogbnVtYmVyfVtdfSAqL1xuICAgIGNvbnN0IGNhY2hlZEJsb2JzID0gW11cbiAgICBsZXQgY2FjaGVkQnl0ZXMgPSAwXG5cbiAgICBmb3IgKGNvbnN0IFtkaWdlc3QsIHJlZmVyZW5jZXNdIG9mIGVudHJpZXNCeURpZ2VzdCkge1xuICAgICAgY29uc3QgdXJpID0gYXdhaXQgdGhpcy5hZGFwdGVyLmJsb2JVcmkoe2FjY291bnRJZDogdGhpcy5hY2NvdW50SWQsIGRpZ2VzdH0pXG5cbiAgICAgIGlmICghdXJpKSB7XG4gICAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgcmVmZXJlbmNlcykge1xuICAgICAgICAgIGlmIChlbnRyeS5zdGF0dXMgPT09IFwiY2FjaGVkXCIpIGVudHJ5LnN0YXR1cyA9IFwibWlzc2luZ1wiXG4gICAgICAgIH1cbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgY29uc3QgYnl0ZVNpemUgPSByZWZlcmVuY2VzWzBdLmRlc2NyaXB0b3IuYnl0ZVNpemVcblxuICAgICAgY2FjaGVkQnl0ZXMgKz0gYnl0ZVNpemVcbiAgICAgIGNhY2hlZEJsb2JzLnB1c2goe1xuICAgICAgICBieXRlU2l6ZSxcbiAgICAgICAgZGlnZXN0LFxuICAgICAgICBsYXN0QWNjZXNzZWRBdDogTWF0aC5tYXgoLi4ucmVmZXJlbmNlcy5tYXAoKGVudHJ5KSA9PiBlbnRyeS5sYXN0QWNjZXNzZWRBdCkpXG4gICAgICB9KVxuICAgIH1cblxuICAgIGxldCByZW1vdmVkQnl0ZXMgPSAwXG5cbiAgICB3aGlsZSAoY2FjaGVkQmxvYnMubGVuZ3RoID4gMCkge1xuICAgICAgaWYgKGNhY2hlZEJ5dGVzIDw9IHRoaXMubWF4Qnl0ZXMpIGJyZWFrXG5cbiAgICAgIGZvciAoY29uc3QgY2FjaGVkQmxvYiBvZiBjYWNoZWRCbG9icykge1xuICAgICAgICBjb25zdCBjdXJyZW50UmVmZXJlbmNlcyA9IHN0YXRlLmFzc2V0cy5maWx0ZXIoKGVudHJ5KSA9PiBlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdCA9PT0gY2FjaGVkQmxvYi5kaWdlc3QpXG5cbiAgICAgICAgaWYgKGN1cnJlbnRSZWZlcmVuY2VzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICBjYWNoZWRCbG9iLmxhc3RBY2Nlc3NlZEF0ID0gTWF0aC5tYXgoLi4uY3VycmVudFJlZmVyZW5jZXMubWFwKChlbnRyeSkgPT4gZW50cnkubGFzdEFjY2Vzc2VkQXQpKVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGNhY2hlZEJsb2JzLnNvcnQoKGxlZnQsIHJpZ2h0KSA9PiBsZWZ0Lmxhc3RBY2Nlc3NlZEF0IC0gcmlnaHQubGFzdEFjY2Vzc2VkQXQgfHwgbGVmdC5kaWdlc3QubG9jYWxlQ29tcGFyZShyaWdodC5kaWdlc3QpKVxuXG4gICAgICBjb25zdCBibG9iID0gY2FjaGVkQmxvYnMuc2hpZnQoKVxuXG4gICAgICBpZiAoIWJsb2IpIHRocm93IG5ldyBFcnJvcihcIkV4cGVjdGVkIGEgc3luY2hyb25pemVkIGFzc2V0IGNhY2hlIGV2aWN0aW9uIGNhbmRpZGF0ZVwiKVxuICAgICAgaWYgKHByb3RlY3RlZERpZ2VzdHMuaGFzKGJsb2IuZGlnZXN0KSkgY29udGludWVcbiAgICAgIGxldCBibG9iV2FzQWxyZWFkeU1pc3NpbmcgPSBmYWxzZVxuICAgICAgY29uc3QgZGVsZXRlZCA9IGF3YWl0IHRoaXMuZGVsZXRlRGlnZXN0SWZJbmFjdGl2ZShibG9iLmRpZ2VzdCwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBpZiAoIXRoaXMuc3RhdGUpIHRocm93IG5ldyBFcnJvcihcIkNhbm5vdCBjbGVhbiBzeW5jaHJvbml6ZWQgYXNzZXQgYmxvYnMgYmVmb3JlIGxvYWRpbmcgc3RhdGVcIilcblxuICAgICAgICBjb25zdCBjdXJyZW50VXJpID0gYXdhaXQgdGhpcy5hZGFwdGVyLmJsb2JVcmkoe2FjY291bnRJZDogdGhpcy5hY2NvdW50SWQsIGRpZ2VzdDogYmxvYi5kaWdlc3R9KVxuICAgICAgICBjb25zdCBjdXJyZW50UmVmZXJlbmNlcyA9IHRoaXMuc3RhdGUuYXNzZXRzLmZpbHRlcigoZW50cnkpID0+IGVudHJ5LmRlc2NyaXB0b3IuZGlnZXN0ID09PSBibG9iLmRpZ2VzdClcblxuICAgICAgICBpZiAoIWN1cnJlbnRVcmkpIHtcbiAgICAgICAgICBibG9iV2FzQWxyZWFkeU1pc3NpbmcgPSB0cnVlXG5cbiAgICAgICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGN1cnJlbnRSZWZlcmVuY2VzKSB7XG4gICAgICAgICAgICBpZiAoZW50cnkuc3RhdHVzID09PSBcImNhY2hlZFwiKSBlbnRyeS5zdGF0dXMgPSBcIm1pc3NpbmdcIlxuICAgICAgICAgIH1cblxuICAgICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgICB9XG4gICAgICAgIGlmIChjdXJyZW50UmVmZXJlbmNlcy5zb21lKChlbnRyeSkgPT4gZW50cnkuZGVzY3JpcHRvci5yZXRlbnRpb24gPT09IFwiZHVyYWJsZVwiKSkgcmV0dXJuIGZhbHNlXG5cbiAgICAgICAgYXdhaXQgdGhpcy5hZGFwdGVyLmRlbGV0ZUJsb2Ioe2FjY291bnRJZDogdGhpcy5hY2NvdW50SWQsIGRpZ2VzdDogYmxvYi5kaWdlc3R9KVxuXG4gICAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgY3VycmVudFJlZmVyZW5jZXMpIHtcbiAgICAgICAgICBlbnRyeS5hdHRlbXB0cyA9IDBcbiAgICAgICAgICBlbnRyeS5uZXh0UmV0cnlBdCA9IG51bGxcbiAgICAgICAgICBlbnRyeS5zdGF0dXMgPSBcIm1pc3NpbmdcIlxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHRydWVcbiAgICAgIH0pXG5cbiAgICAgIGlmIChibG9iV2FzQWxyZWFkeU1pc3NpbmcpIGNhY2hlZEJ5dGVzIC09IGJsb2IuYnl0ZVNpemVcbiAgICAgIGlmICghZGVsZXRlZCkgY29udGludWVcblxuICAgICAgY2FjaGVkQnl0ZXMgLT0gYmxvYi5ieXRlU2l6ZVxuICAgICAgcmVtb3ZlZEJ5dGVzICs9IGJsb2IuYnl0ZVNpemVcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnNhdmVTdGF0ZSgpXG5cbiAgICByZXR1cm4gcmVtb3ZlZEJ5dGVzXG4gIH1cblxuICAvKipcbiAgICogU2VyaWFsaXplcyBjbGVhbnVwIHBhc3NlcyBzdGFydGVkIGFmdGVyIG9uLWRlbWFuZCByZXNvbHV0aW9uIHJlbGVhc2VzIGl0cyBkaWdlc3QgZ3VhcmQuXG4gICAqIEBwYXJhbSB7U2V0PHN0cmluZz59IHByb3RlY3RlZERpZ2VzdHMgRGlnZXN0cyBuZWVkZWQgYnkgdGhlIHJlc29sdmluZyBjYWxsZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyBhZnRlciBjbGVhbnVwLlxuICAgKi9cbiAgYXN5bmMgY2xlYW51cEFmdGVyUmVzb2x2ZShwcm90ZWN0ZWREaWdlc3RzKSB7XG4gICAgY29uc3QgY2xlYW51cCA9IGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuY2xlYW51cChwcm90ZWN0ZWREaWdlc3RzKVxuICAgIH1cblxuICAgIHRoaXMucmVzb2x2ZUNsZWFudXBQcm9taXNlID0gdGhpcy5yZXNvbHZlQ2xlYW51cFByb21pc2UudGhlbihjbGVhbnVwLCBjbGVhbnVwKVxuICAgIGF3YWl0IHRoaXMucmVzb2x2ZUNsZWFudXBQcm9taXNlXG4gIH1cblxuICAvKipcbiAgICogTG9hZHMgY2FjaGUgc3RhdGUgb25jZSBmb3IgdGhpcyBjYWNoZSBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlU3RhdGU+fSBMb2FkZWQgc3RhdGUuXG4gICAqL1xuICBhc3luYyBsb2FkU3RhdGUoKSB7XG4gICAgaWYgKHRoaXMuc3RhdGUpIHJldHVybiB0aGlzLnN0YXRlXG4gICAgaWYgKHRoaXMuc3RhdGVQcm9taXNlKSByZXR1cm4gYXdhaXQgdGhpcy5zdGF0ZVByb21pc2VcblxuICAgIHRoaXMuc3RhdGVQcm9taXNlID0gdGhpcy5sb2FkU3RhdGVGcm9tQWRhcHRlcigpXG5cbiAgICB0cnkge1xuICAgICAgdGhpcy5zdGF0ZSA9IGF3YWl0IHRoaXMuc3RhdGVQcm9taXNlXG5cbiAgICAgIHJldHVybiB0aGlzLnN0YXRlXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMuc3RhdGVQcm9taXNlID0gbnVsbFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBMb2FkcyBhbmQgcmVjb3ZlcnMgcGVyc2lzdGVkIGNhY2hlIHN0YXRlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVTdGF0ZT59IExvYWRlZCBzdGF0ZS5cbiAgICovXG4gIGFzeW5jIGxvYWRTdGF0ZUZyb21BZGFwdGVyKCkge1xuICAgIGNvbnN0IGxvYWRlZFN0YXRlID0gYXdhaXQgdGhpcy5hZGFwdGVyLmxvYWRTdGF0ZSh7YWNjb3VudElkOiB0aGlzLmFjY291bnRJZH0pXG5cbiAgICBpZiAoIWxvYWRlZFN0YXRlKSByZXR1cm4ge2Fzc2V0czogW10sIHBlbmRpbmdEZWxldGlvbkRpZ2VzdHM6IFtdLCB2ZXJzaW9uOiBDQUNIRV9TVEFURV9WRVJTSU9OfVxuICAgIGlmIChsb2FkZWRTdGF0ZS52ZXJzaW9uICE9PSBDQUNIRV9TVEFURV9WRVJTSU9OKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIHN5bmNocm9uaXplZCBhc3NldCBjYWNoZSBzdGF0ZSB2ZXJzaW9uOiAke2xvYWRlZFN0YXRlLnZlcnNpb259YClcbiAgICB9XG5cbiAgICBsZXQgcmVjb3ZlcmVkSW50ZXJydXB0ZWREb3dubG9hZCA9IGZhbHNlXG5cbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGxvYWRlZFN0YXRlLmFzc2V0cykge1xuICAgICAgaWYgKGVudHJ5LnN0YXR1cyAhPT0gXCJkb3dubG9hZGluZ1wiKSBjb250aW51ZVxuXG4gICAgICBlbnRyeS5hdHRlbXB0cyArPSAxXG4gICAgICBlbnRyeS5uZXh0UmV0cnlBdCA9IHRoaXMubm93TWlsbGlzZWNvbmRzKClcbiAgICAgIGVudHJ5LnN0YXR1cyA9IFwiZmFpbGVkXCJcbiAgICAgIHJlY292ZXJlZEludGVycnVwdGVkRG93bmxvYWQgPSB0cnVlXG4gICAgfVxuXG4gICAgaWYgKHJlY292ZXJlZEludGVycnVwdGVkRG93bmxvYWQpIHtcbiAgICAgIGF3YWl0IHRoaXMuYWRhcHRlci5zYXZlU3RhdGUoe2FjY291bnRJZDogdGhpcy5hY2NvdW50SWQsIHN0YXRlOiBsb2FkZWRTdGF0ZX0pXG4gICAgfVxuXG4gICAgcmV0dXJuIGxvYWRlZFN0YXRlXG4gIH1cblxuICAvKipcbiAgICogUGVyc2lzdHMgdGhlIGN1cnJlbnQgY2FjaGUgc3RhdGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyBhZnRlciBzdGF0ZSBwZXJzaXN0ZW5jZS5cbiAgICovXG4gIGFzeW5jIHNhdmVTdGF0ZSgpIHtcbiAgICBpZiAoIXRoaXMuc3RhdGUpIHRocm93IG5ldyBFcnJvcihcIkNhbm5vdCBzYXZlIHN5bmNocm9uaXplZCBhc3NldCBjYWNoZSBiZWZvcmUgbG9hZGluZyBzdGF0ZVwiKVxuXG4gICAgY29uc3QgcGVyc2lzdCA9IGFzeW5jICgpID0+IHtcbiAgICAgIGlmICghdGhpcy5zdGF0ZSkgdGhyb3cgbmV3IEVycm9yKFwiQ2Fubm90IHNhdmUgc3luY2hyb25pemVkIGFzc2V0IGNhY2hlIGJlZm9yZSBsb2FkaW5nIHN0YXRlXCIpXG5cbiAgICAgIGF3YWl0IHRoaXMuYWRhcHRlci5zYXZlU3RhdGUoe2FjY291bnRJZDogdGhpcy5hY2NvdW50SWQsIHN0YXRlOiB0aGlzLnN0YXRlfSlcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnNlcmlhbGl6ZVN0YXRlUGVyc2lzdGVuY2UocGVyc2lzdClcbiAgfVxuXG4gIC8qKlxuICAgKiBQZXJzaXN0cyBhIGRldGFjaGVkIHJlY29uY2lsaWF0aW9uIGJlZm9yZSBleHBvc2luZyBpdCB0aHJvdWdoIHNoYXJlZCBzdGF0ZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgUmVjb25jaWxpYXRpb24gaW5wdXRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZURlc2NyaXB0b3JbXX0gYXJncy5kZXNjcmlwdG9ycyBDdXJyZW50IGRlc2NyaXB0b3JzIGluIHRoZSBzY29wZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc2NvcGVLZXkgU3RhYmxlIHN5bmNocm9uaXplZCBzY29wZSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPE1hcDxzdHJpbmcsIGltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZUVudHJ5Pj59IFJlY29uY2lsZWQgbGl2ZSBlbnRyaWVzIGJ5IGlkLlxuICAgKi9cbiAgYXN5bmMgcmVjb25jaWxlRGVzY3JpcHRvcnMoe2Rlc2NyaXB0b3JzLCBzY29wZUtleX0pIHtcbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIGltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZUVudHJ5PiB8IG51bGx9ICovXG4gICAgbGV0IGVudHJpZXNCeUlkID0gbnVsbFxuXG4gICAgY29uc3QgcGVyc2lzdCA9IGFzeW5jICgpID0+IHtcbiAgICAgIGlmICghdGhpcy5zdGF0ZSkgdGhyb3cgbmV3IEVycm9yKFwiQ2Fubm90IHJlY29uY2lsZSBzeW5jaHJvbml6ZWQgYXNzZXQgY2FjaGUgYmVmb3JlIGxvYWRpbmcgc3RhdGVcIilcblxuICAgICAgY29uc3QgY2FuZGlkYXRlU3RhdGUgPSB0aGlzLmNvcHlTdGF0ZSh0aGlzLnN0YXRlKVxuICAgICAgY29uc3QgbmV3RW50cnlMYXN0QWNjZXNzZWRBdCA9IHRoaXMubm93TWlsbGlzZWNvbmRzKClcblxuICAgICAgdGhpcy5hcHBseURlc2NyaXB0b3JSZWNvbmNpbGlhdGlvbih7ZGVzY3JpcHRvcnMsIG5ld0VudHJ5TGFzdEFjY2Vzc2VkQXQsIHNjb3BlS2V5LCBzdGF0ZTogY2FuZGlkYXRlU3RhdGV9KVxuICAgICAgYXdhaXQgdGhpcy5hZGFwdGVyLnNhdmVTdGF0ZSh7YWNjb3VudElkOiB0aGlzLmFjY291bnRJZCwgc3RhdGU6IGNhbmRpZGF0ZVN0YXRlfSlcbiAgICAgIGVudHJpZXNCeUlkID0gdGhpcy5hcHBseURlc2NyaXB0b3JSZWNvbmNpbGlhdGlvbih7ZGVzY3JpcHRvcnMsIG5ld0VudHJ5TGFzdEFjY2Vzc2VkQXQsIHNjb3BlS2V5LCBzdGF0ZTogdGhpcy5zdGF0ZX0pXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5zZXJpYWxpemVTdGF0ZVBlcnNpc3RlbmNlKHBlcnNpc3QpXG5cbiAgICBpZiAoIWVudHJpZXNCeUlkKSB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jaHJvbml6ZWQgYXNzZXQgZGVzY3JpcHRvciByZWNvbmNpbGlhdGlvbiBjb21wbGV0ZWQgd2l0aG91dCBsaXZlIGVudHJpZXNcIilcblxuICAgIHJldHVybiBlbnRyaWVzQnlJZFxuICB9XG5cbiAgLyoqXG4gICAqIEFwcGxpZXMgb25lIHNjb3BlJ3MgZGVzY3JpcHRvciBzZXQgdG8gY2FjaGUgc3RhdGUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIFJlY29uY2lsaWF0aW9uIGlucHV0cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVEZXNjcmlwdG9yW119IGFyZ3MuZGVzY3JpcHRvcnMgQ3VycmVudCBkZXNjcmlwdG9ycyBpbiB0aGUgc2NvcGUuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLm5ld0VudHJ5TGFzdEFjY2Vzc2VkQXQgSW5pdGlhbCBMUlUgdGltZXN0YW1wIGZvciBuZXcgZW50cmllcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc2NvcGVLZXkgU3RhYmxlIHN5bmNocm9uaXplZCBzY29wZSBrZXkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlU3RhdGV9IGFyZ3Muc3RhdGUgU3RhdGUgdG8gcmVjb25jaWxlLlxuICAgKiBAcmV0dXJucyB7TWFwPHN0cmluZywgaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlRW50cnk+fSBMaXZlIGVudHJpZXMgYnkgaWQuXG4gICAqL1xuICBhcHBseURlc2NyaXB0b3JSZWNvbmNpbGlhdGlvbih7ZGVzY3JpcHRvcnMsIG5ld0VudHJ5TGFzdEFjY2Vzc2VkQXQsIHNjb3BlS2V5LCBzdGF0ZX0pIHtcbiAgICBjb25zdCBpbmNvbWluZ0lkcyA9IG5ldyBTZXQoZGVzY3JpcHRvcnMubWFwKChhc3NldCkgPT4gYXNzZXQuaWQpKVxuICAgIGNvbnN0IGVudHJpZXNCeUlkID0gbmV3IE1hcChzdGF0ZS5hc3NldHMubWFwKChlbnRyeSkgPT4gW2VudHJ5LmRlc2NyaXB0b3IuaWQsIGVudHJ5XSkpXG4gICAgY29uc3QgZGVzY3JpcHRvcnNCeUlkID0gbmV3IE1hcChzdGF0ZS5hc3NldHMubWFwKChlbnRyeSkgPT4gW2VudHJ5LmRlc2NyaXB0b3IuaWQsIGVudHJ5LmRlc2NyaXB0b3JdKSlcbiAgICBjb25zdCByZW1vdmVkRGlnZXN0cyA9IG5ldyBTZXQoKVxuXG4gICAgZm9yIChjb25zdCBhc3NldCBvZiBkZXNjcmlwdG9ycykge1xuICAgICAgY29uc3Qga25vd25EZXNjcmlwdG9yID0gZGVzY3JpcHRvcnNCeUlkLmdldChhc3NldC5pZClcblxuICAgICAgaWYgKGtub3duRGVzY3JpcHRvciAmJiBrbm93bkRlc2NyaXB0b3IuZGlnZXN0ICE9PSBhc3NldC5kaWdlc3QpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBTeW5jaHJvbml6ZWQgYXNzZXQgZGVzY3JpcHRvciAke2Fzc2V0LmlkfSBjaGFuZ2VkIGl0cyBpbW11dGFibGUgZGlnZXN0YClcbiAgICAgIH1cbiAgICAgIGlmIChrbm93bkRlc2NyaXB0b3IgJiYga25vd25EZXNjcmlwdG9yLmJ5dGVTaXplICE9PSBhc3NldC5ieXRlU2l6ZSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFN5bmNocm9uaXplZCBhc3NldCBkZXNjcmlwdG9yICR7YXNzZXQuaWR9IGNoYW5nZWQgaXRzIGltbXV0YWJsZSBieXRlIHNpemVgKVxuICAgICAgfVxuICAgICAgaWYgKGtub3duRGVzY3JpcHRvciAmJiBrbm93bkRlc2NyaXB0b3IuY29udGVudFR5cGUgIT09IGFzc2V0LmNvbnRlbnRUeXBlKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgU3luY2hyb25pemVkIGFzc2V0IGRlc2NyaXB0b3IgJHthc3NldC5pZH0gY2hhbmdlZCBpdHMgaW1tdXRhYmxlIGNvbnRlbnQgdHlwZWApXG4gICAgICB9XG5cbiAgICAgIGRlc2NyaXB0b3JzQnlJZC5zZXQoYXNzZXQuaWQsIGFzc2V0KVxuICAgIH1cblxuICAgIGZvciAoY29uc3QgZW50cnkgb2Ygc3RhdGUuYXNzZXRzKSB7XG4gICAgICBpZiAoIWVudHJ5LnNjb3BlS2V5cy5pbmNsdWRlcyhzY29wZUtleSkgfHwgaW5jb21pbmdJZHMuaGFzKGVudHJ5LmRlc2NyaXB0b3IuaWQpKSBjb250aW51ZVxuXG4gICAgICBlbnRyeS5zY29wZUtleXMgPSBlbnRyeS5zY29wZUtleXMuZmlsdGVyKChjYW5kaWRhdGUpID0+IGNhbmRpZGF0ZSAhPT0gc2NvcGVLZXkpXG4gICAgICBpZiAoZW50cnkuc2NvcGVLZXlzLmxlbmd0aCA9PT0gMCkgcmVtb3ZlZERpZ2VzdHMuYWRkKGVudHJ5LmRlc2NyaXB0b3IuZGlnZXN0KVxuICAgIH1cblxuICAgIHN0YXRlLmFzc2V0cyA9IHN0YXRlLmFzc2V0cy5maWx0ZXIoKGVudHJ5KSA9PiBlbnRyeS5zY29wZUtleXMubGVuZ3RoID4gMClcblxuICAgIGZvciAoY29uc3QgYXNzZXQgb2YgZGVzY3JpcHRvcnMpIHtcbiAgICAgIGNvbnN0IGV4aXN0aW5nID0gZW50cmllc0J5SWQuZ2V0KGFzc2V0LmlkKVxuXG4gICAgICBpZiAoZXhpc3RpbmcgJiYgc3RhdGUuYXNzZXRzLmluY2x1ZGVzKGV4aXN0aW5nKSkge1xuICAgICAgICBleGlzdGluZy5kZXNjcmlwdG9yID0gYXNzZXRcbiAgICAgICAgaWYgKCFleGlzdGluZy5zY29wZUtleXMuaW5jbHVkZXMoc2NvcGVLZXkpKSBleGlzdGluZy5zY29wZUtleXMucHVzaChzY29wZUtleSlcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnN0IG5ld0VudHJ5ID0ge1xuICAgICAgICAgIGF0dGVtcHRzOiAwLFxuICAgICAgICAgIGRlc2NyaXB0b3I6IGFzc2V0LFxuICAgICAgICAgIGxhc3RBY2Nlc3NlZEF0OiBuZXdFbnRyeUxhc3RBY2Nlc3NlZEF0LFxuICAgICAgICAgIG5leHRSZXRyeUF0OiBudWxsLFxuICAgICAgICAgIHNjb3BlS2V5czogW3Njb3BlS2V5XSxcbiAgICAgICAgICBzdGF0dXM6IC8qKiBAdHlwZSB7Y29uc3R9ICovIChcIm1pc3NpbmdcIilcbiAgICAgICAgfVxuXG4gICAgICAgIHN0YXRlLmFzc2V0cy5wdXNoKG5ld0VudHJ5KVxuICAgICAgICBlbnRyaWVzQnlJZC5zZXQoYXNzZXQuaWQsIG5ld0VudHJ5KVxuICAgICAgfVxuICAgIH1cblxuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgbnVtYmVyPn0gKi9cbiAgICBjb25zdCBieXRlU2l6ZXNCeURpZ2VzdCA9IG5ldyBNYXAoKVxuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgc3RyaW5nIHwgbnVsbD59ICovXG4gICAgY29uc3QgY29udGVudFR5cGVzQnlEaWdlc3QgPSBuZXcgTWFwKClcblxuICAgIGZvciAoY29uc3QgZW50cnkgb2Ygc3RhdGUuYXNzZXRzKSB7XG4gICAgICBjb25zdCBrbm93bkJ5dGVTaXplID0gYnl0ZVNpemVzQnlEaWdlc3QuZ2V0KGVudHJ5LmRlc2NyaXB0b3IuZGlnZXN0KVxuICAgICAgY29uc3Qga25vd25Db250ZW50VHlwZSA9IGNvbnRlbnRUeXBlc0J5RGlnZXN0LmdldChlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdClcblxuICAgICAgaWYgKGtub3duQnl0ZVNpemUgIT09IHVuZGVmaW5lZCAmJiBrbm93bkJ5dGVTaXplICE9PSBlbnRyeS5kZXNjcmlwdG9yLmJ5dGVTaXplKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgU3luY2hyb25pemVkIGFzc2V0IGRpZ2VzdCAke2VudHJ5LmRlc2NyaXB0b3IuZGlnZXN0fSBoYXMgaW5jb25zaXN0ZW50IGJ5dGUgc2l6ZXNgKVxuICAgICAgfVxuICAgICAgaWYgKGtub3duQ29udGVudFR5cGUgIT09IHVuZGVmaW5lZCAmJiBrbm93bkNvbnRlbnRUeXBlICE9PSBlbnRyeS5kZXNjcmlwdG9yLmNvbnRlbnRUeXBlKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgU3luY2hyb25pemVkIGFzc2V0IGRpZ2VzdCAke2VudHJ5LmRlc2NyaXB0b3IuZGlnZXN0fSBoYXMgaW5jb25zaXN0ZW50IGNvbnRlbnQgdHlwZXNgKVxuICAgICAgfVxuXG4gICAgICBieXRlU2l6ZXNCeURpZ2VzdC5zZXQoZW50cnkuZGVzY3JpcHRvci5kaWdlc3QsIGVudHJ5LmRlc2NyaXB0b3IuYnl0ZVNpemUpXG4gICAgICBjb250ZW50VHlwZXNCeURpZ2VzdC5zZXQoZW50cnkuZGVzY3JpcHRvci5kaWdlc3QsIGVudHJ5LmRlc2NyaXB0b3IuY29udGVudFR5cGUpXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBkaWdlc3Qgb2YgcmVtb3ZlZERpZ2VzdHMpIHtcbiAgICAgIGlmIChzdGF0ZS5hc3NldHMuc29tZSgoZW50cnkpID0+IGVudHJ5LmRlc2NyaXB0b3IuZGlnZXN0ID09PSBkaWdlc3QpKSBjb250aW51ZVxuICAgICAgaWYgKCFzdGF0ZS5wZW5kaW5nRGVsZXRpb25EaWdlc3RzLmluY2x1ZGVzKGRpZ2VzdCkpIHN0YXRlLnBlbmRpbmdEZWxldGlvbkRpZ2VzdHMucHVzaChkaWdlc3QpXG4gICAgfVxuXG4gICAgcmV0dXJuIGVudHJpZXNCeUlkXG4gIH1cblxuICAvKipcbiAgICogQ29waWVzIG1ldGFkYXRhIGludG8gYSBkZXRhY2hlZCBwZXJzaXN0ZW5jZSBjYW5kaWRhdGUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlU3RhdGV9IHN0YXRlIFN0YXRlIHRvIGNvcHkuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVTdGF0ZX0gRGV0YWNoZWQgc3RhdGUuXG4gICAqL1xuICBjb3B5U3RhdGUoc3RhdGUpIHtcbiAgICByZXR1cm4ge1xuICAgICAgYXNzZXRzOiBzdGF0ZS5hc3NldHMubWFwKChlbnRyeSkgPT4gKHtcbiAgICAgICAgLi4uZW50cnksXG4gICAgICAgIGRlc2NyaXB0b3I6IHsuLi5lbnRyeS5kZXNjcmlwdG9yfSxcbiAgICAgICAgc2NvcGVLZXlzOiBbLi4uZW50cnkuc2NvcGVLZXlzXVxuICAgICAgfSkpLFxuICAgICAgcGVuZGluZ0RlbGV0aW9uRGlnZXN0czogWy4uLnN0YXRlLnBlbmRpbmdEZWxldGlvbkRpZ2VzdHNdLFxuICAgICAgdmVyc2lvbjogc3RhdGUudmVyc2lvblxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBTZXJpYWxpemVzIG9uZSBtZXRhZGF0YSBwZXJzaXN0ZW5jZSBvcGVyYXRpb24gYWZ0ZXIgcHJpb3IgZmFpbHVyZXMgb3Igc3VjY2Vzc2VzLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8dm9pZD59IHBlcnNpc3QgUGVyc2lzdGVuY2Ugb3BlcmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgYWZ0ZXIgcGVyc2lzdGVuY2UuXG4gICAqL1xuICBhc3luYyBzZXJpYWxpemVTdGF0ZVBlcnNpc3RlbmNlKHBlcnNpc3QpIHtcbiAgICB0aGlzLnNhdmVTdGF0ZVByb21pc2UgPSB0aGlzLnNhdmVTdGF0ZVByb21pc2UudGhlbihwZXJzaXN0LCBwZXJzaXN0KVxuXG4gICAgYXdhaXQgdGhpcy5zYXZlU3RhdGVQcm9taXNlXG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyBvbmUgZGVzY3JpcHRvciBoYXMgdmVyaWZpZWQgbG9jYWwgYnl0ZXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlRW50cnl9IGVudHJ5IERlc2NyaXB0b3Igc3RhdGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHtlcnJvcjogRXJyb3IgfCBudWxsLCB1cmk6IHN0cmluZyB8IG51bGx9Pn0gQ2FjaGUgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgZW5zdXJlQ2FjaGVkKGVudHJ5KSB7XG4gICAgY29uc3QgZGlnZXN0ID0gZW50cnkuZGVzY3JpcHRvci5kaWdlc3RcblxuICAgIGF3YWl0IHRoaXMuYmVnaW5BY3RpdmVEaWdlc3QoZGlnZXN0KVxuXG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLmVuc3VyZUNhY2hlZFdoaWxlQWN0aXZlKFtlbnRyeV0pXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IHRoaXMuZmluaXNoQWN0aXZlRGlnZXN0KGRpZ2VzdClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgb3IgZG93bmxvYWRzIGRlc2NyaXB0b3JzIHNoYXJpbmcgb25lIHByb3RlY3RlZCBkaWdlc3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlRW50cnlbXX0gZW50cmllcyBEZXNjcmlwdG9yIHN0YXRlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8e2Vycm9yOiBFcnJvciB8IG51bGwsIHVyaTogc3RyaW5nIHwgbnVsbH0+fSBDYWNoZSByZXN1bHQuXG4gICAqL1xuICBhc3luYyBlbnN1cmVDYWNoZWRXaGlsZUFjdGl2ZShlbnRyaWVzKSB7XG4gICAgY29uc3QgZW50cnkgPSBlbnRyaWVzWzBdXG5cbiAgICBpZiAoIWVudHJ5KSB0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3QgY2FjaGUgYSBzeW5jaHJvbml6ZWQgYXNzZXQgZGlnZXN0IHdpdGhvdXQgZGVzY3JpcHRvciBlbnRyaWVzXCIpXG5cbiAgICBjb25zdCBleGlzdGluZ1VyaSA9IGF3YWl0IHRoaXMuY2FjaGVkVXJpV2hpbGVBY3RpdmUoZW50cnkpXG5cbiAgICBpZiAoZXhpc3RpbmdVcmkpIHtcbiAgICAgIGF3YWl0IHRoaXMucmVjb3JkQ2FjaGVkRW50cmllcyhlbnRyaWVzKVxuXG4gICAgICByZXR1cm4ge2Vycm9yOiBudWxsLCB1cmk6IGV4aXN0aW5nVXJpfVxuICAgIH1cblxuICAgIGZvciAoY29uc3QgZGlnZXN0RW50cnkgb2YgZW50cmllcykgZGlnZXN0RW50cnkuc3RhdHVzID0gXCJkb3dubG9hZGluZ1wiXG5cbiAgICBjb25zdCBkaWdlc3QgPSBlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdFxuICAgIGxldCBkb3dubG9hZFByb21pc2UgPSB0aGlzLmRvd25sb2FkUHJvbWlzZXMuZ2V0KGRpZ2VzdClcbiAgICBsZXQgb3duc0Rvd25sb2FkUHJvbWlzZSA9IGZhbHNlXG5cbiAgICBpZiAoIWRvd25sb2FkUHJvbWlzZSkge1xuICAgICAgZG93bmxvYWRQcm9taXNlID0gdGhpcy5kb3dubG9hZEFmdGVyUGVyc2lzdGluZ1N0YXRlKGVudHJ5LmRlc2NyaXB0b3IpXG4gICAgICB0aGlzLmRvd25sb2FkUHJvbWlzZXMuc2V0KGRpZ2VzdCwgZG93bmxvYWRQcm9taXNlKVxuICAgICAgb3duc0Rvd25sb2FkUHJvbWlzZSA9IHRydWVcbiAgICB9IGVsc2Uge1xuICAgICAgYXdhaXQgdGhpcy5zYXZlU3RhdGUoKVxuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBjYWNoZVJlc3VsdCA9IGF3YWl0IGRvd25sb2FkUHJvbWlzZVxuXG4gICAgICBpZiAoY2FjaGVSZXN1bHQuZXJyb3IpIHtcbiAgICAgICAgaWYgKGVudHJ5LnN0YXR1cyA9PT0gXCJkb3dubG9hZGluZ1wiKSBhd2FpdCB0aGlzLnJlY29yZERvd25sb2FkRmFpbHVyZShkaWdlc3QpXG5cbiAgICAgICAgcmV0dXJuIGNhY2hlUmVzdWx0XG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHRoaXMucmVjb3JkQ2FjaGVkRW50cmllcyhlbnRyaWVzKVxuXG4gICAgICByZXR1cm4gY2FjaGVSZXN1bHRcbiAgICB9IGZpbmFsbHkge1xuICAgICAgaWYgKG93bnNEb3dubG9hZFByb21pc2UgJiYgdGhpcy5kb3dubG9hZFByb21pc2VzLmdldChkaWdlc3QpID09PSBkb3dubG9hZFByb21pc2UpIHtcbiAgICAgICAgdGhpcy5kb3dubG9hZFByb21pc2VzLmRlbGV0ZShkaWdlc3QpXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgb25lIGNhY2hlZCBkaWdlc3QgcmVzdWx0IGZvciBldmVyeSBwYXJ0aWNpcGF0aW5nIGRlc2NyaXB0b3IuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlRW50cnlbXX0gZW50cmllcyBEZXNjcmlwdG9yIHN0YXRlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIGFmdGVyIHBlcnNpc3RlbmNlLlxuICAgKi9cbiAgYXN5bmMgcmVjb3JkQ2FjaGVkRW50cmllcyhlbnRyaWVzKSB7XG4gICAgY29uc3QgbGFzdEFjY2Vzc2VkQXQgPSB0aGlzLm5vd01pbGxpc2Vjb25kcygpXG5cbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGVudHJpZXMpIHtcbiAgICAgIGVudHJ5LmF0dGVtcHRzID0gMFxuICAgICAgZW50cnkubGFzdEFjY2Vzc2VkQXQgPSBsYXN0QWNjZXNzZWRBdFxuICAgICAgZW50cnkubmV4dFJldHJ5QXQgPSBudWxsXG4gICAgICBlbnRyeS5zdGF0dXMgPSBcImNhY2hlZFwiXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5zYXZlU3RhdGUoKVxuICB9XG5cbiAgLyoqXG4gICAqIFBlcnNpc3RzIGRvd25sb2FkIGludGVudCwgdGhlbiBkb3dubG9hZHMgb25lIGRpZ2VzdCBhbmQgcmVjb3JkcyBhIHNoYXJlZCBmYWlsdXJlIG9uY2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlRGVzY3JpcHRvcn0gZGVzY3JpcHRvciBBc3NldCBkZXNjcmlwdG9yLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7ZXJyb3I6IEVycm9yLCB1cmk6IG51bGx9IHwge2Vycm9yOiBudWxsLCB1cmk6IHN0cmluZ30+fSBTaGFyZWQgY2FjaGUgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgZG93bmxvYWRBZnRlclBlcnNpc3RpbmdTdGF0ZShkZXNjcmlwdG9yKSB7XG4gICAgYXdhaXQgdGhpcy5zYXZlU3RhdGUoKVxuXG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiB7ZXJyb3I6IG51bGwsIHVyaTogYXdhaXQgdGhpcy5kb3dubG9hZFZlcmlmaWVkKGRlc2NyaXB0b3IpfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zdCBmYWlsdXJlID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpXG5cbiAgICAgIGF3YWl0IHRoaXMucmVjb3JkRG93bmxvYWRGYWlsdXJlKGRlc2NyaXB0b3IuZGlnZXN0KVxuXG4gICAgICByZXR1cm4ge2Vycm9yOiBmYWlsdXJlLCB1cmk6IG51bGx9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEFkdmFuY2VzIHJldHJ5IG1ldGFkYXRhIGZvciBldmVyeSBsaXZlIGRlc2NyaXB0b3Igc2hhcmluZyBvbmUgZmFpbGVkIGRpZ2VzdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGRpZ2VzdCBDb250ZW50IGRpZ2VzdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIGFmdGVyIHBlcnNpc3RlbmNlLlxuICAgKi9cbiAgYXN5bmMgcmVjb3JkRG93bmxvYWRGYWlsdXJlKGRpZ2VzdCkge1xuICAgIGlmICghdGhpcy5zdGF0ZSkgdGhyb3cgbmV3IEVycm9yKFwiQ2Fubm90IHJlY29yZCBzeW5jaHJvbml6ZWQgYXNzZXQgZG93bmxvYWQgZmFpbHVyZSBiZWZvcmUgbG9hZGluZyBzdGF0ZVwiKVxuXG4gICAgY29uc3QgZmFpbGVkQXQgPSB0aGlzLm5vd01pbGxpc2Vjb25kcygpXG5cbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHRoaXMuc3RhdGUuYXNzZXRzKSB7XG4gICAgICBpZiAoZW50cnkuZGVzY3JpcHRvci5kaWdlc3QgIT09IGRpZ2VzdCkgY29udGludWVcbiAgICAgIGlmIChlbnRyeS5zdGF0dXMgIT09IFwiZG93bmxvYWRpbmdcIikgY29udGludWVcblxuICAgICAgZW50cnkuYXR0ZW1wdHMgKz0gMVxuICAgICAgZW50cnkubmV4dFJldHJ5QXQgPSBmYWlsZWRBdCArIHRoaXMucmV0cnlEZWxheShlbnRyeS5hdHRlbXB0cylcbiAgICAgIGVudHJ5LnN0YXR1cyA9IFwiZmFpbGVkXCJcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnNhdmVTdGF0ZSgpXG4gIH1cblxuICAvKipcbiAgICogRG93bmxvYWRzLCB2ZXJpZmllcywgYW5kIGF0b21pY2FsbHkgcGVyc2lzdHMgb25lIGNvbnRlbnQgZGlnZXN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZURlc2NyaXB0b3J9IGRlc2NyaXB0b3IgQXNzZXQgZGVzY3JpcHRvci5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gQWRhcHRlciBVUkkuXG4gICAqL1xuICBhc3luYyBkb3dubG9hZFZlcmlmaWVkKGRlc2NyaXB0b3IpIHtcbiAgICBjb25zdCBkb3dubG9hZGVkQnl0ZXMgPSBhd2FpdCB0aGlzLmRvd25sb2FkKGRlc2NyaXB0b3IpXG5cbiAgICBpZiAoIShkb3dubG9hZGVkQnl0ZXMgaW5zdGFuY2VvZiBVaW50OEFycmF5KSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBTeW5jaHJvbml6ZWQgYXNzZXQgJHtkZXNjcmlwdG9yLmlkfSBkb3dubG9hZCBkaWQgbm90IHJldHVybiBVaW50OEFycmF5IGJ5dGVzYClcbiAgICB9XG4gICAgaWYgKGRvd25sb2FkZWRCeXRlcy5ieXRlTGVuZ3RoICE9PSBkZXNjcmlwdG9yLmJ5dGVTaXplKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFN5bmNocm9uaXplZCBhc3NldCAke2Rlc2NyaXB0b3IuaWR9IGJ5dGUgc2l6ZSBkaWQgbm90IG1hdGNoIGl0cyBkZXNjcmlwdG9yYClcbiAgICB9XG5cbiAgICBjb25zdCBkaWdlc3QgPSBgc2hhMjU2LSR7c2hhMjU2Qnl0ZXNIZXgoZG93bmxvYWRlZEJ5dGVzKX1gXG5cbiAgICBpZiAoZGlnZXN0ICE9PSBkZXNjcmlwdG9yLmRpZ2VzdCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBTeW5jaHJvbml6ZWQgYXNzZXQgJHtkZXNjcmlwdG9yLmlkfSBkaWdlc3QgZGlkIG5vdCBtYXRjaCBpdHMgZGVzY3JpcHRvcmApXG4gICAgfVxuXG4gICAgY29uc3QgdXJpID0gYXdhaXQgdGhpcy5hZGFwdGVyLndyaXRlQmxvYih7XG4gICAgICBhY2NvdW50SWQ6IHRoaXMuYWNjb3VudElkLFxuICAgICAgYnl0ZXM6IGRvd25sb2FkZWRCeXRlcyxcbiAgICAgIGNvbnRlbnRUeXBlOiBkZXNjcmlwdG9yLmNvbnRlbnRUeXBlLFxuICAgICAgZGlnZXN0XG4gICAgfSlcblxuICAgIGlmICghdXJpKSB0aHJvdyBuZXcgRXJyb3IoYFN5bmNocm9uaXplZCBhc3NldCBhZGFwdGVyIHJldHVybmVkIG5vIFVSSSBmb3IgJHtkZXNjcmlwdG9yLmlkfWApXG5cbiAgICByZXR1cm4gdXJpXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYW4gZXhpc3RpbmcgbG9jYWwgVVJJIGFmdGVyIHdhaXRpbmcgZm9yIGRlbGV0aW9uIHdvcmsuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlRW50cnl9IGVudHJ5IERlc2NyaXB0b3Igc3RhdGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZyB8IG51bGw+fSBFeGlzdGluZyBVUkkuXG4gICAqL1xuICBhc3luYyBjYWNoZWRVcmkoZW50cnkpIHtcbiAgICBjb25zdCBkaWdlc3QgPSBlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdFxuXG4gICAgYXdhaXQgdGhpcy5iZWdpbkFjdGl2ZURpZ2VzdChkaWdlc3QpXG5cbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuY2FjaGVkVXJpV2hpbGVBY3RpdmUoZW50cnkpXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IHRoaXMuZmluaXNoQWN0aXZlRGlnZXN0KGRpZ2VzdClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYW4gZXhpc3RpbmcgbG9jYWwgVVJJIHdoaWxlIGl0cyBkaWdlc3QgaXMgcHJvdGVjdGVkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZUVudHJ5fSBlbnRyeSBEZXNjcmlwdG9yIHN0YXRlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmcgfCBudWxsPn0gRXhpc3RpbmcgVVJJLlxuICAgKi9cbiAgYXN5bmMgY2FjaGVkVXJpV2hpbGVBY3RpdmUoZW50cnkpIHtcbiAgICBjb25zdCB1cmkgPSBhd2FpdCB0aGlzLmFkYXB0ZXIuYmxvYlVyaSh7XG4gICAgICBhY2NvdW50SWQ6IHRoaXMuYWNjb3VudElkLFxuICAgICAgZGlnZXN0OiBlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdFxuICAgIH0pXG5cbiAgICBpZiAoIXVyaSAmJiBlbnRyeS5zdGF0dXMgPT09IFwiY2FjaGVkXCIpIGVudHJ5LnN0YXR1cyA9IFwibWlzc2luZ1wiXG5cbiAgICByZXR1cm4gdXJpXG4gIH1cblxuICAvKipcbiAgICogV2FpdHMgZm9yIGRlbGV0aW9uIGFuZCBwcm90ZWN0cyBhIGRpZ2VzdCBmb3Igb25lIGFjdGl2ZSBjYWNoZSBvcGVyYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBkaWdlc3QgQ29udGVudCBkaWdlc3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyBhZnRlciBwcm90ZWN0aW9uIGlzIHJlZ2lzdGVyZWQuXG4gICAqL1xuICBhc3luYyBiZWdpbkFjdGl2ZURpZ2VzdChkaWdlc3QpIHtcbiAgICBsZXQgZGVsZXRpb25Qcm9taXNlID0gdGhpcy5kZWxldGlvblByb21pc2VzLmdldChkaWdlc3QpXG5cbiAgICB3aGlsZSAoZGVsZXRpb25Qcm9taXNlKSB7XG4gICAgICBhd2FpdCBkZWxldGlvblByb21pc2VcbiAgICAgIGRlbGV0aW9uUHJvbWlzZSA9IHRoaXMuZGVsZXRpb25Qcm9taXNlcy5nZXQoZGlnZXN0KVxuICAgIH1cblxuICAgIGNvbnN0IGFjdGl2ZUNvdW50ID0gdGhpcy5hY3RpdmVEaWdlc3RDb3VudHMuZ2V0KGRpZ2VzdCkgPz8gMFxuXG4gICAgdGhpcy5hY3RpdmVEaWdlc3RDb3VudHMuc2V0KGRpZ2VzdCwgYWN0aXZlQ291bnQgKyAxKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlbGVhc2VzIG9uZSBjYWNoZSBvcGVyYXRpb24gYW5kIHByb2Nlc3NlcyBkZWZlcnJlZCBkZWxldGlvbiBhZnRlciB0aGUgbGFzdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGRpZ2VzdCBDb250ZW50IGRpZ2VzdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIGFmdGVyIGFueSBwZW5kaW5nIGRlbGV0aW9uLlxuICAgKi9cbiAgYXN5bmMgZmluaXNoQWN0aXZlRGlnZXN0KGRpZ2VzdCkge1xuICAgIGNvbnN0IGFjdGl2ZUNvdW50ID0gdGhpcy5hY3RpdmVEaWdlc3RDb3VudHMuZ2V0KGRpZ2VzdClcblxuICAgIGlmIChhY3RpdmVDb3VudCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE1pc3NpbmcgYWN0aXZlIHN5bmNocm9uaXplZCBhc3NldCBkaWdlc3QgY291bnQgZm9yICR7ZGlnZXN0fWApXG4gICAgfVxuXG4gICAgaWYgKGFjdGl2ZUNvdW50ID4gMSkge1xuICAgICAgdGhpcy5hY3RpdmVEaWdlc3RDb3VudHMuc2V0KGRpZ2VzdCwgYWN0aXZlQ291bnQgLSAxKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdGhpcy5hY3RpdmVEaWdlc3RDb3VudHMuZGVsZXRlKGRpZ2VzdClcbiAgICBhd2FpdCB0aGlzLmRlbGV0ZVBlbmRpbmdEaWdlc3RJZlVucmVmZXJlbmNlZChkaWdlc3QpXG4gIH1cblxuICAvKipcbiAgICogUmVsZWFzZXMgZXZlcnkgYWNxdWlyZWQgZGlnZXN0IGJlZm9yZSBwcm9wYWdhdGluZyBmaW5hbGl6YXRpb24gZmFpbHVyZXMuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGRpZ2VzdHMgQ29udGVudCBkaWdlc3RzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgYWZ0ZXIgZXZlcnkgZGlnZXN0IGlzIHJlbGVhc2VkLlxuICAgKi9cbiAgYXN5bmMgZmluaXNoQWN0aXZlRGlnZXN0cyhkaWdlc3RzKSB7XG4gICAgLyoqIEB0eXBlIHtFcnJvcltdfSAqL1xuICAgIGNvbnN0IGZhaWx1cmVzID0gW11cblxuICAgIGZvciAoY29uc3QgZGlnZXN0IG9mIGRpZ2VzdHMpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMuZmluaXNoQWN0aXZlRGlnZXN0KGRpZ2VzdClcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGZhaWx1cmVzLnB1c2goZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpKVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChmYWlsdXJlcy5sZW5ndGggPT09IDEpIHRocm93IGZhaWx1cmVzWzBdXG4gICAgaWYgKGZhaWx1cmVzLmxlbmd0aCA+IDEpIHtcbiAgICAgIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihmYWlsdXJlcywgXCJNdWx0aXBsZSBzeW5jaHJvbml6ZWQgYXNzZXQgZGlnZXN0IGZpbmFsaXplcnMgZmFpbGVkXCIsIHtjYXVzZTogZmFpbHVyZXNbMF19KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBEZWxldGVzIGJsb2JzIHRoYXQgbG9zdCB0aGVpciBmaW5hbCBkZXNjcmlwdG9yIHJlZmVyZW5jZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIGFmdGVyIGRlbGV0aW9uLlxuICAgKi9cbiAgYXN5bmMgZGVsZXRlVW5yZWZlcmVuY2VkRGlnZXN0cygpIHtcbiAgICBpZiAoIXRoaXMuc3RhdGUpIHRocm93IG5ldyBFcnJvcihcIkNhbm5vdCBkZWxldGUgc3luY2hyb25pemVkIGFzc2V0IGJsb2JzIGJlZm9yZSBsb2FkaW5nIHN0YXRlXCIpXG5cbiAgICBmb3IgKGNvbnN0IGRpZ2VzdCBvZiBbLi4udGhpcy5zdGF0ZS5wZW5kaW5nRGVsZXRpb25EaWdlc3RzXSkge1xuICAgICAgYXdhaXQgdGhpcy5kZWxldGVQZW5kaW5nRGlnZXN0SWZVbnJlZmVyZW5jZWQoZGlnZXN0KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBEZWxldGVzIG9uZSBwZXJzaXN0ZWQgcGVuZGluZyBkaWdlc3Qgd2hlbiBubyBkZXNjcmlwdG9yIG9yIGFjdGl2ZSBvcGVyYXRpb24gb3ducyBpdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGRpZ2VzdCBDb250ZW50IGRpZ2VzdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIGFmdGVyIGFueSByZXF1aXJlZCBkZWxldGlvbi5cbiAgICovXG4gIGFzeW5jIGRlbGV0ZVBlbmRpbmdEaWdlc3RJZlVucmVmZXJlbmNlZChkaWdlc3QpIHtcbiAgICBpZiAoIXRoaXMuc3RhdGUpIHRocm93IG5ldyBFcnJvcihcIkNhbm5vdCBkZWxldGUgc3luY2hyb25pemVkIGFzc2V0IGJsb2JzIGJlZm9yZSBsb2FkaW5nIHN0YXRlXCIpXG4gICAgaWYgKCF0aGlzLnN0YXRlLnBlbmRpbmdEZWxldGlvbkRpZ2VzdHMuaW5jbHVkZXMoZGlnZXN0KSkgcmV0dXJuXG5cbiAgICBhd2FpdCB0aGlzLmRlbGV0ZURpZ2VzdElmSW5hY3RpdmUoZGlnZXN0LCBhc3luYyAoKSA9PiB7XG4gICAgICBpZiAoIXRoaXMuc3RhdGUpIHRocm93IG5ldyBFcnJvcihcIkNhbm5vdCBkZWxldGUgc3luY2hyb25pemVkIGFzc2V0IGJsb2JzIGJlZm9yZSBsb2FkaW5nIHN0YXRlXCIpXG4gICAgICBpZiAoIXRoaXMuc3RhdGUucGVuZGluZ0RlbGV0aW9uRGlnZXN0cy5pbmNsdWRlcyhkaWdlc3QpKSByZXR1cm4gZmFsc2VcblxuICAgICAgbGV0IGRlbGV0ZWQgPSBmYWxzZVxuXG4gICAgICBpZiAoIXRoaXMuc3RhdGUuYXNzZXRzLnNvbWUoKGVudHJ5KSA9PiBlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdCA9PT0gZGlnZXN0KSkge1xuICAgICAgICBhd2FpdCB0aGlzLmFkYXB0ZXIuZGVsZXRlQmxvYih7YWNjb3VudElkOiB0aGlzLmFjY291bnRJZCwgZGlnZXN0fSlcbiAgICAgICAgZGVsZXRlZCA9IHRydWVcbiAgICAgIH1cblxuICAgICAgY29uc3QgcGVuZGluZ0RlbGV0aW9uRGlnZXN0cyA9IHRoaXMuc3RhdGUucGVuZGluZ0RlbGV0aW9uRGlnZXN0c1xuXG4gICAgICB0aGlzLnN0YXRlLnBlbmRpbmdEZWxldGlvbkRpZ2VzdHMgPSBwZW5kaW5nRGVsZXRpb25EaWdlc3RzLmZpbHRlcigoY2FuZGlkYXRlKSA9PiBjYW5kaWRhdGUgIT09IGRpZ2VzdClcblxuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5zYXZlU3RhdGUoKVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgaWYgKCF0aGlzLnN0YXRlLnBlbmRpbmdEZWxldGlvbkRpZ2VzdHMuaW5jbHVkZXMoZGlnZXN0KSkgdGhpcy5zdGF0ZS5wZW5kaW5nRGVsZXRpb25EaWdlc3RzLnB1c2goZGlnZXN0KVxuICAgICAgICB0aHJvdyBlcnJvclxuICAgICAgfVxuXG4gICAgICByZXR1cm4gZGVsZXRlZFxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBvbmUgZGVsZXRpb24gb25seSBhZnRlciBlYXJsaWVyIGRlbGV0aW9uIHdvcmsgYW5kIHdoZW4gbm8gY2FjaGUgb3BlcmF0aW9uIG93bnMgdGhlIGRpZ2VzdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGRpZ2VzdCBDb250ZW50IGRpZ2VzdC5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPGJvb2xlYW4+fSBjYWxsYmFjayBQcm90ZWN0ZWQgZGVsZXRpb24gY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSBXaGV0aGVyIHRoZSBjYWxsYmFjayBkZWxldGVkIHRoZSBibG9iLlxuICAgKi9cbiAgYXN5bmMgZGVsZXRlRGlnZXN0SWZJbmFjdGl2ZShkaWdlc3QsIGNhbGxiYWNrKSB7XG4gICAgbGV0IGFjdGl2ZURlbGV0aW9uUHJvbWlzZSA9IHRoaXMuZGVsZXRpb25Qcm9taXNlcy5nZXQoZGlnZXN0KVxuXG4gICAgd2hpbGUgKGFjdGl2ZURlbGV0aW9uUHJvbWlzZSkge1xuICAgICAgYXdhaXQgYWN0aXZlRGVsZXRpb25Qcm9taXNlXG4gICAgICBhY3RpdmVEZWxldGlvblByb21pc2UgPSB0aGlzLmRlbGV0aW9uUHJvbWlzZXMuZ2V0KGRpZ2VzdClcbiAgICB9XG5cbiAgICBpZiAodGhpcy5hY3RpdmVEaWdlc3RDb3VudHMuaGFzKGRpZ2VzdCkpIHJldHVybiBmYWxzZVxuXG4gICAgLyoqXG4gICAgICogUmVsZWFzZXMgY2FsbGVycyB3YWl0aW5nIGZvciBkZWxldGlvbiBjb21wbGV0aW9uLlxuICAgICAqIEB0eXBlIHsoKSA9PiB2b2lkfVxuICAgICAqL1xuICAgIGxldCByZWxlYXNlRGVsZXRpb24gPSAoKSA9PiB7fVxuICAgIC8qKlxuICAgICAqIEJsb2NrcyBuZXcgZGlnZXN0IGFjdGl2aXR5IHVudGlsIGRlbGV0aW9uIGNvbXBsZXRlcy5cbiAgICAgKiBAdHlwZSB7UHJvbWlzZTx2b2lkPn1cbiAgICAgKi9cbiAgICBjb25zdCBkZWxldGlvblByb21pc2UgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgICAgcmVsZWFzZURlbGV0aW9uID0gKCkgPT4gcmVzb2x2ZSh1bmRlZmluZWQpXG4gICAgfSlcblxuICAgIHRoaXMuZGVsZXRpb25Qcm9taXNlcy5zZXQoZGlnZXN0LCBkZWxldGlvblByb21pc2UpXG5cbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKClcbiAgICB9IGZpbmFsbHkge1xuICAgICAgaWYgKHRoaXMuZGVsZXRpb25Qcm9taXNlcy5nZXQoZGlnZXN0KSA9PT0gZGVsZXRpb25Qcm9taXNlKSB0aGlzLmRlbGV0aW9uUHJvbWlzZXMuZGVsZXRlKGRpZ2VzdClcbiAgICAgIHJlbGVhc2VEZWxldGlvbigpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEZpbmRzIHJlcXVpcmVkIGFzc2V0cyB3aXRob3V0IGxvY2FsbHkgY2FjaGVkIGJ5dGVzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2NvcGVLZXkgU3luY2hyb25pemVkIHNjb3BlIHRvIGluc3BlY3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZ1tdPn0gTWlzc2luZyByZXF1aXJlZCBkZXNjcmlwdG9yIGlkcy5cbiAgICovXG4gIGFzeW5jIG1pc3NpbmdSZXF1aXJlZEFzc2V0SWRzKHNjb3BlS2V5KSB7XG4gICAgY29uc3Qgc3RhdGUgPSBhd2FpdCB0aGlzLmxvYWRTdGF0ZSgpXG4gICAgLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgICBjb25zdCBtaXNzaW5nQXNzZXRJZHMgPSBbXVxuXG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiBzdGF0ZS5hc3NldHMpIHtcbiAgICAgIGlmICghZW50cnkuc2NvcGVLZXlzLmluY2x1ZGVzKHNjb3BlS2V5KSkgY29udGludWVcbiAgICAgIGlmIChlbnRyeS5kZXNjcmlwdG9yLm9mZmxpbmVSZXF1aXJlbWVudCAhPT0gXCJyZXF1aXJlZFwiKSBjb250aW51ZVxuICAgICAgaWYgKGF3YWl0IHRoaXMuY2FjaGVkVXJpKGVudHJ5KSkgY29udGludWVcblxuICAgICAgbWlzc2luZ0Fzc2V0SWRzLnB1c2goZW50cnkuZGVzY3JpcHRvci5pZClcbiAgICB9XG5cbiAgICByZXR1cm4gbWlzc2luZ0Fzc2V0SWRzXG4gIH1cblxuICAvKipcbiAgICogQ2hlY2tzIHdoZXRoZXIgYSBmYWlsZWQgb3IgbWlzc2luZyBlbnRyeSBtYXkgYmUgZG93bmxvYWRlZCBub3cuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlRW50cnl9IGVudHJ5IERlc2NyaXB0b3Igc3RhdGUuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSBXaGV0aGVyIHRoZSByZXRyeSBkZWFkbGluZSBoYXMgcGFzc2VkLlxuICAgKi9cbiAgcmV0cnlFbGlnaWJsZShlbnRyeSkge1xuICAgIHJldHVybiBlbnRyeS5zdGF0dXMgIT09IFwiZmFpbGVkXCIgfHwgZW50cnkubmV4dFJldHJ5QXQgPT09IG51bGwgfHwgZW50cnkubmV4dFJldHJ5QXQgPD0gdGhpcy5ub3dNaWxsaXNlY29uZHMoKVxuICB9XG5cbiAgLyoqXG4gICAqIENhbGN1bGF0ZXMgYm91bmRlZCBleHBvbmVudGlhbCByZXRyeSBkZWxheS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGF0dGVtcHRzIENvbnNlY3V0aXZlIGZhaWx1cmVzLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSBSZXRyeSBkZWxheS5cbiAgICovXG4gIHJldHJ5RGVsYXkoYXR0ZW1wdHMpIHtcbiAgICByZXR1cm4gTWF0aC5taW4odGhpcy5yZXRyeU1heERlbGF5TXMsIHRoaXMucmV0cnlCYXNlRGVsYXlNcyAqICgyICoqIE1hdGgubWF4KDAsIGF0dGVtcHRzIC0gMSkpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWRzIHRoZSBpbmplY3RhYmxlIHdhbGwgY2xvY2suXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IEN1cnJlbnQgZXBvY2ggbWlsbGlzZWNvbmRzLlxuICAgKi9cbiAgbm93TWlsbGlzZWNvbmRzKCkge1xuICAgIHJldHVybiB0aGlzLm5vdygpLmdldFRpbWUoKVxuICB9XG59XG4iXX0=