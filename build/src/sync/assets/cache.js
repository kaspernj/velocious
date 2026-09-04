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
        if (!state.assets.some((candidate) => candidate.descriptor.id === assetId && candidate.descriptor.digest === digest))
            return null;
        return resolvedUri;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2FjaGUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvc3luYy9hc3NldHMvY2FjaGUuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sY0FBYyxNQUFNLGlDQUFpQyxDQUFBO0FBRTVELE1BQU0sbUJBQW1CLEdBQUcsQ0FBQyxDQUFBO0FBQzdCLE1BQU0sMkJBQTJCLEdBQUcsSUFBSSxDQUFBO0FBQ3hDLE1BQU0sMEJBQTBCLEdBQUcsSUFBSSxHQUFHLEVBQUUsR0FBRyxDQUFDLENBQUE7QUFFaEQ7OztHQUdHO0FBQ0gsTUFBTSxDQUFDLE9BQU8sT0FBTyxzQkFBc0I7SUFDekM7Ozs7Ozs7Ozs7T0FVRztJQUNILFlBQVksRUFBQyxTQUFTLEVBQUUsT0FBTyxFQUFFLFFBQVEsRUFBRSxRQUFRLEVBQUUsR0FBRyxHQUFHLEdBQUcsRUFBRSxDQUFDLElBQUksSUFBSSxFQUFFLEVBQUUsZ0JBQWdCLEdBQUcsMkJBQTJCLEVBQUUsZUFBZSxHQUFHLDBCQUEwQixFQUFDO1FBQ3hLLElBQUksQ0FBQyxTQUFTO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxpREFBaUQsQ0FBQyxDQUFBO1FBQ2xGLElBQUksQ0FBQyxNQUFNLENBQUMsYUFBYSxDQUFDLFFBQVEsQ0FBQyxJQUFJLFFBQVEsR0FBRyxDQUFDO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyx1RUFBdUUsQ0FBQyxDQUFBO1FBQzdJLElBQUksQ0FBQyxNQUFNLENBQUMsYUFBYSxDQUFDLGdCQUFnQixDQUFDLElBQUksZ0JBQWdCLEdBQUcsQ0FBQztZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsMkVBQTJFLENBQUMsQ0FBQTtRQUNqSyxJQUFJLENBQUMsTUFBTSxDQUFDLGFBQWEsQ0FBQyxlQUFlLENBQUMsSUFBSSxlQUFlLEdBQUcsZ0JBQWdCO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyw0RUFBNEUsQ0FBQyxDQUFBO1FBRS9LLElBQUksQ0FB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WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHNoYTI1NkJ5dGVzSGV4IGZyb20gXCIuLi8uLi91dGlscy9zaGEyNTYtYnl0ZXMtaGV4LmpzXCJcblxuY29uc3QgQ0FDSEVfU1RBVEVfVkVSU0lPTiA9IDFcbmNvbnN0IERFRkFVTFRfUkVUUllfQkFTRV9ERUxBWV9NUyA9IDEwMDBcbmNvbnN0IERFRkFVTFRfUkVUUllfTUFYX0RFTEFZX01TID0gMTAwMCAqIDYwICogNVxuXG4vKipcbiAqIENvcmUgc3luY2hyb25pemVkIGFzc2V0IGNhY2hlLiBQbGF0Zm9ybSBwYWNrYWdlcyBvd24gYnl0ZSBhbmQgbWV0YWRhdGFcbiAqIHBlcnNpc3RlbmNlIHdoaWxlIHRoaXMgY2xhc3Mgb3ducyBwb2xpY3ksIGludGVncml0eSwgYW5kIGxpZmVjeWNsZS5cbiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgU3luY2hyb25pemVkQXNzZXRDYWNoZSB7XG4gIC8qKlxuICAgKiBDcmVhdGVzIGEgc3luY2hyb25pemVkIGFzc2V0IGNhY2hlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5hY2NvdW50SWQgQXV0aGVudGljYXRlZCBhY2NvdW50IG5hbWVzcGFjZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVBZGFwdGVyfSBhcmdzLmFkYXB0ZXIgUGxhdGZvcm0gc3RvcmFnZSBhZGFwdGVyLlxuICAgKiBAcGFyYW0geyhkZXNjcmlwdG9yOiBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVEZXNjcmlwdG9yKSA9PiBQcm9taXNlPFVpbnQ4QXJyYXk+fSBhcmdzLmRvd25sb2FkIEF1dGhlbnRpY2F0ZWQgYnl0ZSBkb3dubG9hZGVyLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5tYXhCeXRlcyBNYXhpbXVtIGV2aWN0YWJsZSBjYWNoZSBzaXplLlxuICAgKiBAcGFyYW0geygpID0+IERhdGV9IFthcmdzLm5vd10gQ2xvY2suXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5yZXRyeUJhc2VEZWxheU1zXSBJbml0aWFsIHJldHJ5IGRlbGF5LlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MucmV0cnlNYXhEZWxheU1zXSBNYXhpbXVtIHJldHJ5IGRlbGF5LlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2FjY291bnRJZCwgYWRhcHRlciwgZG93bmxvYWQsIG1heEJ5dGVzLCBub3cgPSAoKSA9PiBuZXcgRGF0ZSgpLCByZXRyeUJhc2VEZWxheU1zID0gREVGQVVMVF9SRVRSWV9CQVNFX0RFTEFZX01TLCByZXRyeU1heERlbGF5TXMgPSBERUZBVUxUX1JFVFJZX01BWF9ERUxBWV9NU30pIHtcbiAgICBpZiAoIWFjY291bnRJZCkgdGhyb3cgbmV3IEVycm9yKFwiU3luY2hyb25pemVkIGFzc2V0IGNhY2hlIHJlcXVpcmVzIGFuIGFjY291bnQgaWRcIilcbiAgICBpZiAoIU51bWJlci5pc1NhZmVJbnRlZ2VyKG1heEJ5dGVzKSB8fCBtYXhCeXRlcyA8IDApIHRocm93IG5ldyBFcnJvcihcIlN5bmNocm9uaXplZCBhc3NldCBjYWNoZSBtYXhCeXRlcyBtdXN0IGJlIGEgbm9uLW5lZ2F0aXZlIHNhZmUgaW50ZWdlclwiKVxuICAgIGlmICghTnVtYmVyLmlzU2FmZUludGVnZXIocmV0cnlCYXNlRGVsYXlNcykgfHwgcmV0cnlCYXNlRGVsYXlNcyA8IDEpIHRocm93IG5ldyBFcnJvcihcIlN5bmNocm9uaXplZCBhc3NldCBjYWNoZSByZXRyeUJhc2VEZWxheU1zIG11c3QgYmUgYSBwb3NpdGl2ZSBzYWZlIGludGVnZXJcIilcbiAgICBpZiAoIU51bWJlci5pc1NhZmVJbnRlZ2VyKHJldHJ5TWF4RGVsYXlNcykgfHwgcmV0cnlNYXhEZWxheU1zIDwgcmV0cnlCYXNlRGVsYXlNcykgdGhyb3cgbmV3IEVycm9yKFwiU3luY2hyb25pemVkIGFzc2V0IGNhY2hlIHJldHJ5TWF4RGVsYXlNcyBtdXN0IGJlIGF0IGxlYXN0IHJldHJ5QmFzZURlbGF5TXNcIilcblxuICAgIHRoaXMuYWNjb3VudElkID0gYWNjb3VudElkXG4gICAgdGhpcy5hZGFwdGVyID0gYWRhcHRlclxuICAgIHRoaXMuZG93bmxvYWQgPSBkb3dubG9hZFxuICAgIHRoaXMubWF4Qnl0ZXMgPSBtYXhCeXRlc1xuICAgIHRoaXMubm93ID0gbm93XG4gICAgdGhpcy5yZXRyeUJhc2VEZWxheU1zID0gcmV0cnlCYXNlRGVsYXlNc1xuICAgIHRoaXMucmV0cnlNYXhEZWxheU1zID0gcmV0cnlNYXhEZWxheU1zXG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBudW1iZXI+fSAqL1xuICAgIHRoaXMuYWN0aXZlRGlnZXN0Q291bnRzID0gbmV3IE1hcCgpXG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBQcm9taXNlPHZvaWQ+Pn0gKi9cbiAgICB0aGlzLmRlbGV0aW9uUHJvbWlzZXMgPSBuZXcgTWFwKClcbiAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD59ICovXG4gICAgdGhpcy5yZXNvbHZlQ2xlYW51cFByb21pc2UgPSBQcm9taXNlLnJlc29sdmUoKVxuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgUHJvbWlzZTx7ZXJyb3I6IEVycm9yLCB1cmk6IG51bGx9IHwge2Vycm9yOiBudWxsLCB1cmk6IHN0cmluZ30+Pn0gKi9cbiAgICB0aGlzLmRvd25sb2FkUHJvbWlzZXMgPSBuZXcgTWFwKClcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZVN0YXRlIHwgbnVsbH0gKi9cbiAgICB0aGlzLnN0YXRlID0gbnVsbFxuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVTdGF0ZT4gfCBudWxsfSAqL1xuICAgIHRoaXMuc3RhdGVQcm9taXNlID0gbnVsbFxuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPn0gKi9cbiAgICB0aGlzLnNhdmVTdGF0ZVByb21pc2UgPSBQcm9taXNlLnJlc29sdmUoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlY29uY2lsZXMgdGhlIGltbXV0YWJsZSBkZXNjcmlwdG9ycyBmb3Igb25lIHN5bmNocm9uaXplZCBzY29wZSBhbmRcbiAgICogZG93bmxvYWRzIGVsaWdpYmxlIGVhZ2VyIGFzc2V0cy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgUmVjb25jaWxpYXRpb24gaW5wdXRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZURlc2NyaXB0b3JbXX0gYXJncy5kZXNjcmlwdG9ycyBDdXJyZW50IGRlc2NyaXB0b3JzIGluIHRoZSBzY29wZS5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLm9ubGluZSBXaGV0aGVyIGF1dGhlbnRpY2F0ZWQgZG93bmxvYWRzIGFyZSBhdmFpbGFibGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnNjb3BlS2V5IFN0YWJsZSBzeW5jaHJvbml6ZWQgc2NvcGUga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVTeW5jaHJvbml6YXRpb25SZXN1bHQ+fSBTeW5jaHJvbml6YXRpb24gcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgc3luY2hyb25pemUoe2Rlc2NyaXB0b3JzLCBvbmxpbmUsIHNjb3BlS2V5fSkge1xuICAgIGF3YWl0IHRoaXMubG9hZFN0YXRlKClcbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIGltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZURlc2NyaXB0b3JbXT59ICovXG4gICAgY29uc3QgZGVzY3JpcHRvcnNCeURpZ2VzdCA9IG5ldyBNYXAoKVxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlRmFpbHVyZVtdfSAqL1xuICAgIGNvbnN0IGZhaWx1cmVzID0gW11cbiAgICAvKiogQHR5cGUge1NldDxzdHJpbmc+fSAqL1xuICAgIGNvbnN0IGFjdGl2ZURpZ2VzdHMgPSBuZXcgU2V0KClcblxuICAgIGZvciAoY29uc3QgZGVzY3JpcHRvciBvZiBkZXNjcmlwdG9ycykge1xuICAgICAgY29uc3QgZGlnZXN0RGVzY3JpcHRvcnMgPSBkZXNjcmlwdG9yc0J5RGlnZXN0LmdldChkZXNjcmlwdG9yLmRpZ2VzdCkgfHwgW11cblxuICAgICAgZGlnZXN0RGVzY3JpcHRvcnMucHVzaChkZXNjcmlwdG9yKVxuICAgICAgZGVzY3JpcHRvcnNCeURpZ2VzdC5zZXQoZGVzY3JpcHRvci5kaWdlc3QsIGRpZ2VzdERlc2NyaXB0b3JzKVxuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBmb3IgKGNvbnN0IGRpZ2VzdCBvZiBkZXNjcmlwdG9yc0J5RGlnZXN0LmtleXMoKSkge1xuICAgICAgICBhd2FpdCB0aGlzLmJlZ2luQWN0aXZlRGlnZXN0KGRpZ2VzdClcbiAgICAgICAgYWN0aXZlRGlnZXN0cy5hZGQoZGlnZXN0KVxuICAgICAgfVxuXG4gICAgICBjb25zdCBlbnRyaWVzQnlJZCA9IGF3YWl0IHRoaXMucmVjb25jaWxlRGVzY3JpcHRvcnMoe2Rlc2NyaXB0b3JzLCBzY29wZUtleX0pXG5cbiAgICAgIGF3YWl0IHRoaXMuZGVsZXRlVW5yZWZlcmVuY2VkRGlnZXN0cygpXG5cbiAgICAgIGZvciAoY29uc3QgW2RpZ2VzdCwgZGlnZXN0RGVzY3JpcHRvcnNdIG9mIGRlc2NyaXB0b3JzQnlEaWdlc3QpIHtcbiAgICAgICAgY29uc3QgZWFnZXJEZXNjcmlwdG9ycyA9IG9ubGluZSA/IGRpZ2VzdERlc2NyaXB0b3JzLmZpbHRlcigoZGVzY3JpcHRvcikgPT4gZGVzY3JpcHRvci5mZXRjaCA9PT0gXCJlYWdlclwiKSA6IFtdXG5cbiAgICAgICAgaWYgKGVhZ2VyRGVzY3JpcHRvcnMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgYWN0aXZlRGlnZXN0cy5kZWxldGUoZGlnZXN0KVxuICAgICAgICAgIGF3YWl0IHRoaXMuZmluaXNoQWN0aXZlRGlnZXN0KGRpZ2VzdClcbiAgICAgICAgICBjb250aW51ZVxuICAgICAgICB9XG5cbiAgICAgICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVFbnRyeVtdfSAqL1xuICAgICAgICBjb25zdCBlYWdlckVudHJpZXMgPSBbXVxuXG4gICAgICAgIGZvciAoY29uc3QgZGVzY3JpcHRvciBvZiBlYWdlckRlc2NyaXB0b3JzKSB7XG4gICAgICAgICAgY29uc3QgZW50cnkgPSBlbnRyaWVzQnlJZC5nZXQoZGVzY3JpcHRvci5pZClcblxuICAgICAgICAgIGlmICghZW50cnkpIHRocm93IG5ldyBFcnJvcihgTWlzc2luZyByZWNvbmNpbGVkIHN5bmNocm9uaXplZCBhc3NldCBkZXNjcmlwdG9yICR7ZGVzY3JpcHRvci5pZH1gKVxuXG4gICAgICAgICAgZWFnZXJFbnRyaWVzLnB1c2goZW50cnkpXG4gICAgICAgIH1cblxuICAgICAgICBpZiAoZWFnZXJFbnRyaWVzLnNvbWUoKGVudHJ5KSA9PiB0aGlzLnJldHJ5RWxpZ2libGUoZW50cnkpKSkge1xuICAgICAgICAgIGNvbnN0IGNhY2hlUmVzdWx0ID0gYXdhaXQgdGhpcy5lbnN1cmVDYWNoZWRXaGlsZUFjdGl2ZShlYWdlckVudHJpZXMpXG5cbiAgICAgICAgICBpZiAoY2FjaGVSZXN1bHQuZXJyb3IpIHtcbiAgICAgICAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgZWFnZXJFbnRyaWVzKSB7XG4gICAgICAgICAgICAgIGZhaWx1cmVzLnB1c2goe2Fzc2V0SWQ6IGVudHJ5LmRlc2NyaXB0b3IuaWQsIGVycm9yOiBjYWNoZVJlc3VsdC5lcnJvcn0pXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgYWN0aXZlRGlnZXN0cy5kZWxldGUoZGlnZXN0KVxuICAgICAgICBhd2FpdCB0aGlzLmZpbmlzaEFjdGl2ZURpZ2VzdChkaWdlc3QpXG4gICAgICAgIGF3YWl0IHRoaXMuY2xlYW51cCgpXG4gICAgICB9XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IHRoaXMuZmluaXNoQWN0aXZlRGlnZXN0cyhbLi4uYWN0aXZlRGlnZXN0c10pXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5jbGVhbnVwKClcblxuICAgIHJldHVybiB7XG4gICAgICBmYWlsdXJlcyxcbiAgICAgIG1pc3NpbmdSZXF1aXJlZEFzc2V0SWRzOiBhd2FpdCB0aGlzLm1pc3NpbmdSZXF1aXJlZEFzc2V0SWRzKHNjb3BlS2V5KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBhIGNhY2hlZCBhc3NldCBVUkksIGRvd25sb2FkaW5nIGl0IG9uIGRlbWFuZCB3aGVuIGFsbG93ZWQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIFJlc29sdXRpb24gaW5wdXRzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5hc3NldElkIEF0dGFjaG1lbnQgZGVzY3JpcHRvciBpZC5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLm9ubGluZSBXaGV0aGVyIGF1dGhlbnRpY2F0ZWQgZG93bmxvYWRzIGFyZSBhdmFpbGFibGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZyB8IG51bGw+fSBDYWNoZWQgYXNzZXQgVVJJLlxuICAgKi9cbiAgYXN5bmMgcmVzb2x2ZSh7YXNzZXRJZCwgb25saW5lfSkge1xuICAgIGNvbnN0IHN0YXRlID0gYXdhaXQgdGhpcy5sb2FkU3RhdGUoKVxuICAgIGNvbnN0IGVudHJ5ID0gc3RhdGUuYXNzZXRzLmZpbmQoKGNhbmRpZGF0ZSkgPT4gY2FuZGlkYXRlLmRlc2NyaXB0b3IuaWQgPT09IGFzc2V0SWQpXG5cbiAgICBpZiAoIWVudHJ5KSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgZGlnZXN0ID0gZW50cnkuZGVzY3JpcHRvci5kaWdlc3RcbiAgICBsZXQgcmVzb2x2ZWRVcmkgPSBudWxsXG4gICAgbGV0IHNob3VsZENsZWFudXAgPSBmYWxzZVxuXG4gICAgYXdhaXQgdGhpcy5iZWdpbkFjdGl2ZURpZ2VzdChkaWdlc3QpXG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgY2FjaGVkVXJpID0gYXdhaXQgdGhpcy5jYWNoZWRVcmlXaGlsZUFjdGl2ZShlbnRyeSlcblxuICAgICAgaWYgKGNhY2hlZFVyaSkge1xuICAgICAgICBlbnRyeS5sYXN0QWNjZXNzZWRBdCA9IHRoaXMubm93TWlsbGlzZWNvbmRzKClcbiAgICAgICAgZW50cnkuc3RhdHVzID0gXCJjYWNoZWRcIlxuICAgICAgICBhd2FpdCB0aGlzLnNhdmVTdGF0ZSgpXG5cbiAgICAgICAgcmVzb2x2ZWRVcmkgPSBjYWNoZWRVcmlcbiAgICAgIH0gZWxzZSBpZiAob25saW5lICYmIHRoaXMucmV0cnlFbGlnaWJsZShlbnRyeSkpIHtcbiAgICAgICAgY29uc3QgY2FjaGVSZXN1bHQgPSBhd2FpdCB0aGlzLmVuc3VyZUNhY2hlZFdoaWxlQWN0aXZlKFtlbnRyeV0pXG5cbiAgICAgICAgaWYgKGNhY2hlUmVzdWx0LmVycm9yKSB0aHJvdyBjYWNoZVJlc3VsdC5lcnJvclxuXG4gICAgICAgIGlmIChjYWNoZVJlc3VsdC51cmkpIHtcbiAgICAgICAgICByZXNvbHZlZFVyaSA9IGNhY2hlUmVzdWx0LnVyaVxuICAgICAgICAgIHNob3VsZENsZWFudXAgPSB0cnVlXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgdGhpcy5maW5pc2hBY3RpdmVEaWdlc3QoZGlnZXN0KVxuICAgIH1cblxuICAgIGlmIChzaG91bGRDbGVhbnVwKSBhd2FpdCB0aGlzLmNsZWFudXBBZnRlclJlc29sdmUobmV3IFNldChbZGlnZXN0XSkpXG4gICAgaWYgKCFyZXNvbHZlZFVyaSkgcmV0dXJuIG51bGxcbiAgICBpZiAoIXN0YXRlLmFzc2V0cy5zb21lKChjYW5kaWRhdGUpID0+IGNhbmRpZGF0ZS5kZXNjcmlwdG9yLmlkID09PSBhc3NldElkICYmIGNhbmRpZGF0ZS5kZXNjcmlwdG9yLmRpZ2VzdCA9PT0gZGlnZXN0KSkgcmV0dXJuIG51bGxcblxuICAgIHJldHVybiByZXNvbHZlZFVyaVxuICB9XG5cbiAgLyoqXG4gICAqIEV2aWN0cyBsZWFzdC1yZWNlbnRseS11c2VkIGJsb2JzIHVudGlsIHRoZSB1bmlxdWUgY2FjaGVkIGJ5dGUgdG90YWwgaXNcbiAgICogd2l0aGluIHRoZSBjb25maWd1cmVkIGJ1ZGdldC4gQSBibG9iIHN0YXlzIGR1cmFibGUgd2hlbiBhbnkgbGl2ZVxuICAgKiBkZXNjcmlwdG9yIHJlZmVyZW5jZSBkZWNsYXJlcyBkdXJhYmxlIHJldGVudGlvbi5cbiAgICogQHBhcmFtIHtTZXQ8c3RyaW5nPn0gW3Byb3RlY3RlZERpZ2VzdHNdIERpZ2VzdHMgbmVlZGVkIGJ5IHRoZSBhY3RpdmUgY2FsbGVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSBCeXRlcyByZW1vdmVkLlxuICAgKi9cbiAgYXN5bmMgY2xlYW51cChwcm90ZWN0ZWREaWdlc3RzID0gbmV3IFNldCgpKSB7XG4gICAgY29uc3Qgc3RhdGUgPSBhd2FpdCB0aGlzLmxvYWRTdGF0ZSgpXG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVFbnRyeVtdPn0gKi9cbiAgICBjb25zdCBlbnRyaWVzQnlEaWdlc3QgPSBuZXcgTWFwKClcblxuICAgIGZvciAoY29uc3QgZW50cnkgb2Ygc3RhdGUuYXNzZXRzKSB7XG4gICAgICBjb25zdCBkaWdlc3RFbnRyaWVzID0gZW50cmllc0J5RGlnZXN0LmdldChlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdCkgfHwgW11cblxuICAgICAgZGlnZXN0RW50cmllcy5wdXNoKGVudHJ5KVxuICAgICAgZW50cmllc0J5RGlnZXN0LnNldChlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdCwgZGlnZXN0RW50cmllcylcbiAgICB9XG5cbiAgICAvKiogQHR5cGUge3tieXRlU2l6ZTogbnVtYmVyLCBkaWdlc3Q6IHN0cmluZywgbGFzdEFjY2Vzc2VkQXQ6IG51bWJlcn1bXX0gKi9cbiAgICBjb25zdCBjYWNoZWRCbG9icyA9IFtdXG4gICAgbGV0IGNhY2hlZEJ5dGVzID0gMFxuXG4gICAgZm9yIChjb25zdCBbZGlnZXN0LCByZWZlcmVuY2VzXSBvZiBlbnRyaWVzQnlEaWdlc3QpIHtcbiAgICAgIGNvbnN0IHVyaSA9IGF3YWl0IHRoaXMuYWRhcHRlci5ibG9iVXJpKHthY2NvdW50SWQ6IHRoaXMuYWNjb3VudElkLCBkaWdlc3R9KVxuXG4gICAgICBpZiAoIXVyaSkge1xuICAgICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHJlZmVyZW5jZXMpIHtcbiAgICAgICAgICBpZiAoZW50cnkuc3RhdHVzID09PSBcImNhY2hlZFwiKSBlbnRyeS5zdGF0dXMgPSBcIm1pc3NpbmdcIlxuICAgICAgICB9XG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGJ5dGVTaXplID0gcmVmZXJlbmNlc1swXS5kZXNjcmlwdG9yLmJ5dGVTaXplXG5cbiAgICAgIGNhY2hlZEJ5dGVzICs9IGJ5dGVTaXplXG4gICAgICBjYWNoZWRCbG9icy5wdXNoKHtcbiAgICAgICAgYnl0ZVNpemUsXG4gICAgICAgIGRpZ2VzdCxcbiAgICAgICAgbGFzdEFjY2Vzc2VkQXQ6IE1hdGgubWF4KC4uLnJlZmVyZW5jZXMubWFwKChlbnRyeSkgPT4gZW50cnkubGFzdEFjY2Vzc2VkQXQpKVxuICAgICAgfSlcbiAgICB9XG5cbiAgICBsZXQgcmVtb3ZlZEJ5dGVzID0gMFxuXG4gICAgd2hpbGUgKGNhY2hlZEJsb2JzLmxlbmd0aCA+IDApIHtcbiAgICAgIGlmIChjYWNoZWRCeXRlcyA8PSB0aGlzLm1heEJ5dGVzKSBicmVha1xuXG4gICAgICBmb3IgKGNvbnN0IGNhY2hlZEJsb2Igb2YgY2FjaGVkQmxvYnMpIHtcbiAgICAgICAgY29uc3QgY3VycmVudFJlZmVyZW5jZXMgPSBzdGF0ZS5hc3NldHMuZmlsdGVyKChlbnRyeSkgPT4gZW50cnkuZGVzY3JpcHRvci5kaWdlc3QgPT09IGNhY2hlZEJsb2IuZGlnZXN0KVxuXG4gICAgICAgIGlmIChjdXJyZW50UmVmZXJlbmNlcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgY2FjaGVkQmxvYi5sYXN0QWNjZXNzZWRBdCA9IE1hdGgubWF4KC4uLmN1cnJlbnRSZWZlcmVuY2VzLm1hcCgoZW50cnkpID0+IGVudHJ5Lmxhc3RBY2Nlc3NlZEF0KSlcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBjYWNoZWRCbG9icy5zb3J0KChsZWZ0LCByaWdodCkgPT4gbGVmdC5sYXN0QWNjZXNzZWRBdCAtIHJpZ2h0Lmxhc3RBY2Nlc3NlZEF0IHx8IGxlZnQuZGlnZXN0LmxvY2FsZUNvbXBhcmUocmlnaHQuZGlnZXN0KSlcblxuICAgICAgY29uc3QgYmxvYiA9IGNhY2hlZEJsb2JzLnNoaWZ0KClcblxuICAgICAgaWYgKCFibG9iKSB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RlZCBhIHN5bmNocm9uaXplZCBhc3NldCBjYWNoZSBldmljdGlvbiBjYW5kaWRhdGVcIilcbiAgICAgIGlmIChwcm90ZWN0ZWREaWdlc3RzLmhhcyhibG9iLmRpZ2VzdCkpIGNvbnRpbnVlXG4gICAgICBsZXQgYmxvYldhc0FscmVhZHlNaXNzaW5nID0gZmFsc2VcbiAgICAgIGNvbnN0IGRlbGV0ZWQgPSBhd2FpdCB0aGlzLmRlbGV0ZURpZ2VzdElmSW5hY3RpdmUoYmxvYi5kaWdlc3QsIGFzeW5jICgpID0+IHtcbiAgICAgICAgaWYgKCF0aGlzLnN0YXRlKSB0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3QgY2xlYW4gc3luY2hyb25pemVkIGFzc2V0IGJsb2JzIGJlZm9yZSBsb2FkaW5nIHN0YXRlXCIpXG5cbiAgICAgICAgY29uc3QgY3VycmVudFVyaSA9IGF3YWl0IHRoaXMuYWRhcHRlci5ibG9iVXJpKHthY2NvdW50SWQ6IHRoaXMuYWNjb3VudElkLCBkaWdlc3Q6IGJsb2IuZGlnZXN0fSlcbiAgICAgICAgY29uc3QgY3VycmVudFJlZmVyZW5jZXMgPSB0aGlzLnN0YXRlLmFzc2V0cy5maWx0ZXIoKGVudHJ5KSA9PiBlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdCA9PT0gYmxvYi5kaWdlc3QpXG5cbiAgICAgICAgaWYgKCFjdXJyZW50VXJpKSB7XG4gICAgICAgICAgYmxvYldhc0FscmVhZHlNaXNzaW5nID0gdHJ1ZVxuXG4gICAgICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiBjdXJyZW50UmVmZXJlbmNlcykge1xuICAgICAgICAgICAgaWYgKGVudHJ5LnN0YXR1cyA9PT0gXCJjYWNoZWRcIikgZW50cnkuc3RhdHVzID0gXCJtaXNzaW5nXCJcbiAgICAgICAgICB9XG5cbiAgICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgICAgfVxuICAgICAgICBpZiAoY3VycmVudFJlZmVyZW5jZXMuc29tZSgoZW50cnkpID0+IGVudHJ5LmRlc2NyaXB0b3IucmV0ZW50aW9uID09PSBcImR1cmFibGVcIikpIHJldHVybiBmYWxzZVxuXG4gICAgICAgIGF3YWl0IHRoaXMuYWRhcHRlci5kZWxldGVCbG9iKHthY2NvdW50SWQ6IHRoaXMuYWNjb3VudElkLCBkaWdlc3Q6IGJsb2IuZGlnZXN0fSlcblxuICAgICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGN1cnJlbnRSZWZlcmVuY2VzKSB7XG4gICAgICAgICAgZW50cnkuYXR0ZW1wdHMgPSAwXG4gICAgICAgICAgZW50cnkubmV4dFJldHJ5QXQgPSBudWxsXG4gICAgICAgICAgZW50cnkuc3RhdHVzID0gXCJtaXNzaW5nXCJcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB0cnVlXG4gICAgICB9KVxuXG4gICAgICBpZiAoYmxvYldhc0FscmVhZHlNaXNzaW5nKSBjYWNoZWRCeXRlcyAtPSBibG9iLmJ5dGVTaXplXG4gICAgICBpZiAoIWRlbGV0ZWQpIGNvbnRpbnVlXG5cbiAgICAgIGNhY2hlZEJ5dGVzIC09IGJsb2IuYnl0ZVNpemVcbiAgICAgIHJlbW92ZWRCeXRlcyArPSBibG9iLmJ5dGVTaXplXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5zYXZlU3RhdGUoKVxuXG4gICAgcmV0dXJuIHJlbW92ZWRCeXRlc1xuICB9XG5cbiAgLyoqXG4gICAqIFNlcmlhbGl6ZXMgY2xlYW51cCBwYXNzZXMgc3RhcnRlZCBhZnRlciBvbi1kZW1hbmQgcmVzb2x1dGlvbiByZWxlYXNlcyBpdHMgZGlnZXN0IGd1YXJkLlxuICAgKiBAcGFyYW0ge1NldDxzdHJpbmc+fSBwcm90ZWN0ZWREaWdlc3RzIERpZ2VzdHMgbmVlZGVkIGJ5IHRoZSByZXNvbHZpbmcgY2FsbGVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgYWZ0ZXIgY2xlYW51cC5cbiAgICovXG4gIGFzeW5jIGNsZWFudXBBZnRlclJlc29sdmUocHJvdGVjdGVkRGlnZXN0cykge1xuICAgIGNvbnN0IGNsZWFudXAgPSBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCB0aGlzLmNsZWFudXAocHJvdGVjdGVkRGlnZXN0cylcbiAgICB9XG5cbiAgICB0aGlzLnJlc29sdmVDbGVhbnVwUHJvbWlzZSA9IHRoaXMucmVzb2x2ZUNsZWFudXBQcm9taXNlLnRoZW4oY2xlYW51cCwgY2xlYW51cClcbiAgICBhd2FpdCB0aGlzLnJlc29sdmVDbGVhbnVwUHJvbWlzZVxuICB9XG5cbiAgLyoqXG4gICAqIExvYWRzIGNhY2hlIHN0YXRlIG9uY2UgZm9yIHRoaXMgY2FjaGUgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZVN0YXRlPn0gTG9hZGVkIHN0YXRlLlxuICAgKi9cbiAgYXN5bmMgbG9hZFN0YXRlKCkge1xuICAgIGlmICh0aGlzLnN0YXRlKSByZXR1cm4gdGhpcy5zdGF0ZVxuICAgIGlmICh0aGlzLnN0YXRlUHJvbWlzZSkgcmV0dXJuIGF3YWl0IHRoaXMuc3RhdGVQcm9taXNlXG5cbiAgICB0aGlzLnN0YXRlUHJvbWlzZSA9IHRoaXMubG9hZFN0YXRlRnJvbUFkYXB0ZXIoKVxuXG4gICAgdHJ5IHtcbiAgICAgIHRoaXMuc3RhdGUgPSBhd2FpdCB0aGlzLnN0YXRlUHJvbWlzZVxuXG4gICAgICByZXR1cm4gdGhpcy5zdGF0ZVxuICAgIH0gZmluYWxseSB7XG4gICAgICB0aGlzLnN0YXRlUHJvbWlzZSA9IG51bGxcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogTG9hZHMgYW5kIHJlY292ZXJzIHBlcnNpc3RlZCBjYWNoZSBzdGF0ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlU3RhdGU+fSBMb2FkZWQgc3RhdGUuXG4gICAqL1xuICBhc3luYyBsb2FkU3RhdGVGcm9tQWRhcHRlcigpIHtcbiAgICBjb25zdCBsb2FkZWRTdGF0ZSA9IGF3YWl0IHRoaXMuYWRhcHRlci5sb2FkU3RhdGUoe2FjY291bnRJZDogdGhpcy5hY2NvdW50SWR9KVxuXG4gICAgaWYgKCFsb2FkZWRTdGF0ZSkgcmV0dXJuIHthc3NldHM6IFtdLCBwZW5kaW5nRGVsZXRpb25EaWdlc3RzOiBbXSwgdmVyc2lvbjogQ0FDSEVfU1RBVEVfVkVSU0lPTn1cbiAgICBpZiAobG9hZGVkU3RhdGUudmVyc2lvbiAhPT0gQ0FDSEVfU1RBVEVfVkVSU0lPTikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbnN1cHBvcnRlZCBzeW5jaHJvbml6ZWQgYXNzZXQgY2FjaGUgc3RhdGUgdmVyc2lvbjogJHtsb2FkZWRTdGF0ZS52ZXJzaW9ufWApXG4gICAgfVxuXG4gICAgbGV0IHJlY292ZXJlZEludGVycnVwdGVkRG93bmxvYWQgPSBmYWxzZVxuXG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiBsb2FkZWRTdGF0ZS5hc3NldHMpIHtcbiAgICAgIGlmIChlbnRyeS5zdGF0dXMgIT09IFwiZG93bmxvYWRpbmdcIikgY29udGludWVcblxuICAgICAgZW50cnkuYXR0ZW1wdHMgKz0gMVxuICAgICAgZW50cnkubmV4dFJldHJ5QXQgPSB0aGlzLm5vd01pbGxpc2Vjb25kcygpXG4gICAgICBlbnRyeS5zdGF0dXMgPSBcImZhaWxlZFwiXG4gICAgICByZWNvdmVyZWRJbnRlcnJ1cHRlZERvd25sb2FkID0gdHJ1ZVxuICAgIH1cblxuICAgIGlmIChyZWNvdmVyZWRJbnRlcnJ1cHRlZERvd25sb2FkKSB7XG4gICAgICBhd2FpdCB0aGlzLmFkYXB0ZXIuc2F2ZVN0YXRlKHthY2NvdW50SWQ6IHRoaXMuYWNjb3VudElkLCBzdGF0ZTogbG9hZGVkU3RhdGV9KVxuICAgIH1cblxuICAgIHJldHVybiBsb2FkZWRTdGF0ZVxuICB9XG5cbiAgLyoqXG4gICAqIFBlcnNpc3RzIHRoZSBjdXJyZW50IGNhY2hlIHN0YXRlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgYWZ0ZXIgc3RhdGUgcGVyc2lzdGVuY2UuXG4gICAqL1xuICBhc3luYyBzYXZlU3RhdGUoKSB7XG4gICAgaWYgKCF0aGlzLnN0YXRlKSB0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3Qgc2F2ZSBzeW5jaHJvbml6ZWQgYXNzZXQgY2FjaGUgYmVmb3JlIGxvYWRpbmcgc3RhdGVcIilcblxuICAgIGNvbnN0IHBlcnNpc3QgPSBhc3luYyAoKSA9PiB7XG4gICAgICBpZiAoIXRoaXMuc3RhdGUpIHRocm93IG5ldyBFcnJvcihcIkNhbm5vdCBzYXZlIHN5bmNocm9uaXplZCBhc3NldCBjYWNoZSBiZWZvcmUgbG9hZGluZyBzdGF0ZVwiKVxuXG4gICAgICBhd2FpdCB0aGlzLmFkYXB0ZXIuc2F2ZVN0YXRlKHthY2NvdW50SWQ6IHRoaXMuYWNjb3VudElkLCBzdGF0ZTogdGhpcy5zdGF0ZX0pXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5zZXJpYWxpemVTdGF0ZVBlcnNpc3RlbmNlKHBlcnNpc3QpXG4gIH1cblxuICAvKipcbiAgICogUGVyc2lzdHMgYSBkZXRhY2hlZCByZWNvbmNpbGlhdGlvbiBiZWZvcmUgZXhwb3NpbmcgaXQgdGhyb3VnaCBzaGFyZWQgc3RhdGUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIFJlY29uY2lsaWF0aW9uIGlucHV0cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVEZXNjcmlwdG9yW119IGFyZ3MuZGVzY3JpcHRvcnMgQ3VycmVudCBkZXNjcmlwdG9ycyBpbiB0aGUgc2NvcGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnNjb3BlS2V5IFN0YWJsZSBzeW5jaHJvbml6ZWQgc2NvcGUga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxNYXA8c3RyaW5nLCBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVFbnRyeT4+fSBSZWNvbmNpbGVkIGxpdmUgZW50cmllcyBieSBpZC5cbiAgICovXG4gIGFzeW5jIHJlY29uY2lsZURlc2NyaXB0b3JzKHtkZXNjcmlwdG9ycywgc2NvcGVLZXl9KSB7XG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVFbnRyeT4gfCBudWxsfSAqL1xuICAgIGxldCBlbnRyaWVzQnlJZCA9IG51bGxcblxuICAgIGNvbnN0IHBlcnNpc3QgPSBhc3luYyAoKSA9PiB7XG4gICAgICBpZiAoIXRoaXMuc3RhdGUpIHRocm93IG5ldyBFcnJvcihcIkNhbm5vdCByZWNvbmNpbGUgc3luY2hyb25pemVkIGFzc2V0IGNhY2hlIGJlZm9yZSBsb2FkaW5nIHN0YXRlXCIpXG5cbiAgICAgIGNvbnN0IGNhbmRpZGF0ZVN0YXRlID0gdGhpcy5jb3B5U3RhdGUodGhpcy5zdGF0ZSlcbiAgICAgIGNvbnN0IG5ld0VudHJ5TGFzdEFjY2Vzc2VkQXQgPSB0aGlzLm5vd01pbGxpc2Vjb25kcygpXG5cbiAgICAgIHRoaXMuYXBwbHlEZXNjcmlwdG9yUmVjb25jaWxpYXRpb24oe2Rlc2NyaXB0b3JzLCBuZXdFbnRyeUxhc3RBY2Nlc3NlZEF0LCBzY29wZUtleSwgc3RhdGU6IGNhbmRpZGF0ZVN0YXRlfSlcbiAgICAgIGF3YWl0IHRoaXMuYWRhcHRlci5zYXZlU3RhdGUoe2FjY291bnRJZDogdGhpcy5hY2NvdW50SWQsIHN0YXRlOiBjYW5kaWRhdGVTdGF0ZX0pXG4gICAgICBlbnRyaWVzQnlJZCA9IHRoaXMuYXBwbHlEZXNjcmlwdG9yUmVjb25jaWxpYXRpb24oe2Rlc2NyaXB0b3JzLCBuZXdFbnRyeUxhc3RBY2Nlc3NlZEF0LCBzY29wZUtleSwgc3RhdGU6IHRoaXMuc3RhdGV9KVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuc2VyaWFsaXplU3RhdGVQZXJzaXN0ZW5jZShwZXJzaXN0KVxuXG4gICAgaWYgKCFlbnRyaWVzQnlJZCkgdGhyb3cgbmV3IEVycm9yKFwiU3luY2hyb25pemVkIGFzc2V0IGRlc2NyaXB0b3IgcmVjb25jaWxpYXRpb24gY29tcGxldGVkIHdpdGhvdXQgbGl2ZSBlbnRyaWVzXCIpXG5cbiAgICByZXR1cm4gZW50cmllc0J5SWRcbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBsaWVzIG9uZSBzY29wZSdzIGRlc2NyaXB0b3Igc2V0IHRvIGNhY2hlIHN0YXRlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyBSZWNvbmNpbGlhdGlvbiBpbnB1dHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlRGVzY3JpcHRvcltdfSBhcmdzLmRlc2NyaXB0b3JzIEN1cnJlbnQgZGVzY3JpcHRvcnMgaW4gdGhlIHNjb3BlLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5uZXdFbnRyeUxhc3RBY2Nlc3NlZEF0IEluaXRpYWwgTFJVIHRpbWVzdGFtcCBmb3IgbmV3IGVudHJpZXMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnNjb3BlS2V5IFN0YWJsZSBzeW5jaHJvbml6ZWQgc2NvcGUga2V5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZVN0YXRlfSBhcmdzLnN0YXRlIFN0YXRlIHRvIHJlY29uY2lsZS5cbiAgICogQHJldHVybnMge01hcDxzdHJpbmcsIGltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZUVudHJ5Pn0gTGl2ZSBlbnRyaWVzIGJ5IGlkLlxuICAgKi9cbiAgYXBwbHlEZXNjcmlwdG9yUmVjb25jaWxpYXRpb24oe2Rlc2NyaXB0b3JzLCBuZXdFbnRyeUxhc3RBY2Nlc3NlZEF0LCBzY29wZUtleSwgc3RhdGV9KSB7XG4gICAgY29uc3QgaW5jb21pbmdJZHMgPSBuZXcgU2V0KGRlc2NyaXB0b3JzLm1hcCgoYXNzZXQpID0+IGFzc2V0LmlkKSlcbiAgICBjb25zdCBlbnRyaWVzQnlJZCA9IG5ldyBNYXAoc3RhdGUuYXNzZXRzLm1hcCgoZW50cnkpID0+IFtlbnRyeS5kZXNjcmlwdG9yLmlkLCBlbnRyeV0pKVxuICAgIGNvbnN0IGRlc2NyaXB0b3JzQnlJZCA9IG5ldyBNYXAoc3RhdGUuYXNzZXRzLm1hcCgoZW50cnkpID0+IFtlbnRyeS5kZXNjcmlwdG9yLmlkLCBlbnRyeS5kZXNjcmlwdG9yXSkpXG4gICAgY29uc3QgcmVtb3ZlZERpZ2VzdHMgPSBuZXcgU2V0KClcblxuICAgIGZvciAoY29uc3QgYXNzZXQgb2YgZGVzY3JpcHRvcnMpIHtcbiAgICAgIGNvbnN0IGtub3duRGVzY3JpcHRvciA9IGRlc2NyaXB0b3JzQnlJZC5nZXQoYXNzZXQuaWQpXG5cbiAgICAgIGlmIChrbm93bkRlc2NyaXB0b3IgJiYga25vd25EZXNjcmlwdG9yLmRpZ2VzdCAhPT0gYXNzZXQuZGlnZXN0KSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgU3luY2hyb25pemVkIGFzc2V0IGRlc2NyaXB0b3IgJHthc3NldC5pZH0gY2hhbmdlZCBpdHMgaW1tdXRhYmxlIGRpZ2VzdGApXG4gICAgICB9XG4gICAgICBpZiAoa25vd25EZXNjcmlwdG9yICYmIGtub3duRGVzY3JpcHRvci5ieXRlU2l6ZSAhPT0gYXNzZXQuYnl0ZVNpemUpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBTeW5jaHJvbml6ZWQgYXNzZXQgZGVzY3JpcHRvciAke2Fzc2V0LmlkfSBjaGFuZ2VkIGl0cyBpbW11dGFibGUgYnl0ZSBzaXplYClcbiAgICAgIH1cbiAgICAgIGlmIChrbm93bkRlc2NyaXB0b3IgJiYga25vd25EZXNjcmlwdG9yLmNvbnRlbnRUeXBlICE9PSBhc3NldC5jb250ZW50VHlwZSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFN5bmNocm9uaXplZCBhc3NldCBkZXNjcmlwdG9yICR7YXNzZXQuaWR9IGNoYW5nZWQgaXRzIGltbXV0YWJsZSBjb250ZW50IHR5cGVgKVxuICAgICAgfVxuXG4gICAgICBkZXNjcmlwdG9yc0J5SWQuc2V0KGFzc2V0LmlkLCBhc3NldClcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHN0YXRlLmFzc2V0cykge1xuICAgICAgaWYgKCFlbnRyeS5zY29wZUtleXMuaW5jbHVkZXMoc2NvcGVLZXkpIHx8IGluY29taW5nSWRzLmhhcyhlbnRyeS5kZXNjcmlwdG9yLmlkKSkgY29udGludWVcblxuICAgICAgZW50cnkuc2NvcGVLZXlzID0gZW50cnkuc2NvcGVLZXlzLmZpbHRlcigoY2FuZGlkYXRlKSA9PiBjYW5kaWRhdGUgIT09IHNjb3BlS2V5KVxuICAgICAgaWYgKGVudHJ5LnNjb3BlS2V5cy5sZW5ndGggPT09IDApIHJlbW92ZWREaWdlc3RzLmFkZChlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdClcbiAgICB9XG5cbiAgICBzdGF0ZS5hc3NldHMgPSBzdGF0ZS5hc3NldHMuZmlsdGVyKChlbnRyeSkgPT4gZW50cnkuc2NvcGVLZXlzLmxlbmd0aCA+IDApXG5cbiAgICBmb3IgKGNvbnN0IGFzc2V0IG9mIGRlc2NyaXB0b3JzKSB7XG4gICAgICBjb25zdCBleGlzdGluZyA9IGVudHJpZXNCeUlkLmdldChhc3NldC5pZClcblxuICAgICAgaWYgKGV4aXN0aW5nICYmIHN0YXRlLmFzc2V0cy5pbmNsdWRlcyhleGlzdGluZykpIHtcbiAgICAgICAgZXhpc3RpbmcuZGVzY3JpcHRvciA9IGFzc2V0XG4gICAgICAgIGlmICghZXhpc3Rpbmcuc2NvcGVLZXlzLmluY2x1ZGVzKHNjb3BlS2V5KSkgZXhpc3Rpbmcuc2NvcGVLZXlzLnB1c2goc2NvcGVLZXkpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb25zdCBuZXdFbnRyeSA9IHtcbiAgICAgICAgICBhdHRlbXB0czogMCxcbiAgICAgICAgICBkZXNjcmlwdG9yOiBhc3NldCxcbiAgICAgICAgICBsYXN0QWNjZXNzZWRBdDogbmV3RW50cnlMYXN0QWNjZXNzZWRBdCxcbiAgICAgICAgICBuZXh0UmV0cnlBdDogbnVsbCxcbiAgICAgICAgICBzY29wZUtleXM6IFtzY29wZUtleV0sXG4gICAgICAgICAgc3RhdHVzOiAvKiogQHR5cGUge2NvbnN0fSAqLyAoXCJtaXNzaW5nXCIpXG4gICAgICAgIH1cblxuICAgICAgICBzdGF0ZS5hc3NldHMucHVzaChuZXdFbnRyeSlcbiAgICAgICAgZW50cmllc0J5SWQuc2V0KGFzc2V0LmlkLCBuZXdFbnRyeSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIG51bWJlcj59ICovXG4gICAgY29uc3QgYnl0ZVNpemVzQnlEaWdlc3QgPSBuZXcgTWFwKClcbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIHN0cmluZyB8IG51bGw+fSAqL1xuICAgIGNvbnN0IGNvbnRlbnRUeXBlc0J5RGlnZXN0ID0gbmV3IE1hcCgpXG5cbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHN0YXRlLmFzc2V0cykge1xuICAgICAgY29uc3Qga25vd25CeXRlU2l6ZSA9IGJ5dGVTaXplc0J5RGlnZXN0LmdldChlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdClcbiAgICAgIGNvbnN0IGtub3duQ29udGVudFR5cGUgPSBjb250ZW50VHlwZXNCeURpZ2VzdC5nZXQoZW50cnkuZGVzY3JpcHRvci5kaWdlc3QpXG5cbiAgICAgIGlmIChrbm93bkJ5dGVTaXplICE9PSB1bmRlZmluZWQgJiYga25vd25CeXRlU2l6ZSAhPT0gZW50cnkuZGVzY3JpcHRvci5ieXRlU2l6ZSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFN5bmNocm9uaXplZCBhc3NldCBkaWdlc3QgJHtlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdH0gaGFzIGluY29uc2lzdGVudCBieXRlIHNpemVzYClcbiAgICAgIH1cbiAgICAgIGlmIChrbm93bkNvbnRlbnRUeXBlICE9PSB1bmRlZmluZWQgJiYga25vd25Db250ZW50VHlwZSAhPT0gZW50cnkuZGVzY3JpcHRvci5jb250ZW50VHlwZSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFN5bmNocm9uaXplZCBhc3NldCBkaWdlc3QgJHtlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdH0gaGFzIGluY29uc2lzdGVudCBjb250ZW50IHR5cGVzYClcbiAgICAgIH1cblxuICAgICAgYnl0ZVNpemVzQnlEaWdlc3Quc2V0KGVudHJ5LmRlc2NyaXB0b3IuZGlnZXN0LCBlbnRyeS5kZXNjcmlwdG9yLmJ5dGVTaXplKVxuICAgICAgY29udGVudFR5cGVzQnlEaWdlc3Quc2V0KGVudHJ5LmRlc2NyaXB0b3IuZGlnZXN0LCBlbnRyeS5kZXNjcmlwdG9yLmNvbnRlbnRUeXBlKVxuICAgIH1cblxuICAgIGZvciAoY29uc3QgZGlnZXN0IG9mIHJlbW92ZWREaWdlc3RzKSB7XG4gICAgICBpZiAoc3RhdGUuYXNzZXRzLnNvbWUoKGVudHJ5KSA9PiBlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdCA9PT0gZGlnZXN0KSkgY29udGludWVcbiAgICAgIGlmICghc3RhdGUucGVuZGluZ0RlbGV0aW9uRGlnZXN0cy5pbmNsdWRlcyhkaWdlc3QpKSBzdGF0ZS5wZW5kaW5nRGVsZXRpb25EaWdlc3RzLnB1c2goZGlnZXN0KVxuICAgIH1cblxuICAgIHJldHVybiBlbnRyaWVzQnlJZFxuICB9XG5cbiAgLyoqXG4gICAqIENvcGllcyBtZXRhZGF0YSBpbnRvIGEgZGV0YWNoZWQgcGVyc2lzdGVuY2UgY2FuZGlkYXRlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZVN0YXRlfSBzdGF0ZSBTdGF0ZSB0byBjb3B5LlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlU3RhdGV9IERldGFjaGVkIHN0YXRlLlxuICAgKi9cbiAgY29weVN0YXRlKHN0YXRlKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGFzc2V0czogc3RhdGUuYXNzZXRzLm1hcCgoZW50cnkpID0+ICh7XG4gICAgICAgIC4uLmVudHJ5LFxuICAgICAgICBkZXNjcmlwdG9yOiB7Li4uZW50cnkuZGVzY3JpcHRvcn0sXG4gICAgICAgIHNjb3BlS2V5czogWy4uLmVudHJ5LnNjb3BlS2V5c11cbiAgICAgIH0pKSxcbiAgICAgIHBlbmRpbmdEZWxldGlvbkRpZ2VzdHM6IFsuLi5zdGF0ZS5wZW5kaW5nRGVsZXRpb25EaWdlc3RzXSxcbiAgICAgIHZlcnNpb246IHN0YXRlLnZlcnNpb25cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogU2VyaWFsaXplcyBvbmUgbWV0YWRhdGEgcGVyc2lzdGVuY2Ugb3BlcmF0aW9uIGFmdGVyIHByaW9yIGZhaWx1cmVzIG9yIHN1Y2Nlc3Nlcy5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPHZvaWQ+fSBwZXJzaXN0IFBlcnNpc3RlbmNlIG9wZXJhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIGFmdGVyIHBlcnNpc3RlbmNlLlxuICAgKi9cbiAgYXN5bmMgc2VyaWFsaXplU3RhdGVQZXJzaXN0ZW5jZShwZXJzaXN0KSB7XG4gICAgdGhpcy5zYXZlU3RhdGVQcm9taXNlID0gdGhpcy5zYXZlU3RhdGVQcm9taXNlLnRoZW4ocGVyc2lzdCwgcGVyc2lzdClcblxuICAgIGF3YWl0IHRoaXMuc2F2ZVN0YXRlUHJvbWlzZVxuICB9XG5cbiAgLyoqXG4gICAqIEVuc3VyZXMgb25lIGRlc2NyaXB0b3IgaGFzIHZlcmlmaWVkIGxvY2FsIGJ5dGVzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZUVudHJ5fSBlbnRyeSBEZXNjcmlwdG9yIHN0YXRlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7ZXJyb3I6IEVycm9yIHwgbnVsbCwgdXJpOiBzdHJpbmcgfCBudWxsfT59IENhY2hlIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGVuc3VyZUNhY2hlZChlbnRyeSkge1xuICAgIGNvbnN0IGRpZ2VzdCA9IGVudHJ5LmRlc2NyaXB0b3IuZGlnZXN0XG5cbiAgICBhd2FpdCB0aGlzLmJlZ2luQWN0aXZlRGlnZXN0KGRpZ2VzdClcblxuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5lbnN1cmVDYWNoZWRXaGlsZUFjdGl2ZShbZW50cnldKVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCB0aGlzLmZpbmlzaEFjdGl2ZURpZ2VzdChkaWdlc3QpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIG9yIGRvd25sb2FkcyBkZXNjcmlwdG9ycyBzaGFyaW5nIG9uZSBwcm90ZWN0ZWQgZGlnZXN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZUVudHJ5W119IGVudHJpZXMgRGVzY3JpcHRvciBzdGF0ZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHtlcnJvcjogRXJyb3IgfCBudWxsLCB1cmk6IHN0cmluZyB8IG51bGx9Pn0gQ2FjaGUgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgZW5zdXJlQ2FjaGVkV2hpbGVBY3RpdmUoZW50cmllcykge1xuICAgIGNvbnN0IGVudHJ5ID0gZW50cmllc1swXVxuXG4gICAgaWYgKCFlbnRyeSkgdGhyb3cgbmV3IEVycm9yKFwiQ2Fubm90IGNhY2hlIGEgc3luY2hyb25pemVkIGFzc2V0IGRpZ2VzdCB3aXRob3V0IGRlc2NyaXB0b3IgZW50cmllc1wiKVxuXG4gICAgY29uc3QgZXhpc3RpbmdVcmkgPSBhd2FpdCB0aGlzLmNhY2hlZFVyaVdoaWxlQWN0aXZlKGVudHJ5KVxuXG4gICAgaWYgKGV4aXN0aW5nVXJpKSB7XG4gICAgICBhd2FpdCB0aGlzLnJlY29yZENhY2hlZEVudHJpZXMoZW50cmllcylcblxuICAgICAgcmV0dXJuIHtlcnJvcjogbnVsbCwgdXJpOiBleGlzdGluZ1VyaX1cbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGRpZ2VzdEVudHJ5IG9mIGVudHJpZXMpIGRpZ2VzdEVudHJ5LnN0YXR1cyA9IFwiZG93bmxvYWRpbmdcIlxuXG4gICAgY29uc3QgZGlnZXN0ID0gZW50cnkuZGVzY3JpcHRvci5kaWdlc3RcbiAgICBsZXQgZG93bmxvYWRQcm9taXNlID0gdGhpcy5kb3dubG9hZFByb21pc2VzLmdldChkaWdlc3QpXG4gICAgbGV0IG93bnNEb3dubG9hZFByb21pc2UgPSBmYWxzZVxuXG4gICAgaWYgKCFkb3dubG9hZFByb21pc2UpIHtcbiAgICAgIGRvd25sb2FkUHJvbWlzZSA9IHRoaXMuZG93bmxvYWRBZnRlclBlcnNpc3RpbmdTdGF0ZShlbnRyeS5kZXNjcmlwdG9yKVxuICAgICAgdGhpcy5kb3dubG9hZFByb21pc2VzLnNldChkaWdlc3QsIGRvd25sb2FkUHJvbWlzZSlcbiAgICAgIG93bnNEb3dubG9hZFByb21pc2UgPSB0cnVlXG4gICAgfSBlbHNlIHtcbiAgICAgIGF3YWl0IHRoaXMuc2F2ZVN0YXRlKClcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgY2FjaGVSZXN1bHQgPSBhd2FpdCBkb3dubG9hZFByb21pc2VcblxuICAgICAgaWYgKGNhY2hlUmVzdWx0LmVycm9yKSB7XG4gICAgICAgIGlmIChlbnRyeS5zdGF0dXMgPT09IFwiZG93bmxvYWRpbmdcIikgYXdhaXQgdGhpcy5yZWNvcmREb3dubG9hZEZhaWx1cmUoZGlnZXN0KVxuXG4gICAgICAgIHJldHVybiBjYWNoZVJlc3VsdFxuICAgICAgfVxuXG4gICAgICBhd2FpdCB0aGlzLnJlY29yZENhY2hlZEVudHJpZXMoZW50cmllcylcblxuICAgICAgcmV0dXJuIGNhY2hlUmVzdWx0XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGlmIChvd25zRG93bmxvYWRQcm9taXNlICYmIHRoaXMuZG93bmxvYWRQcm9taXNlcy5nZXQoZGlnZXN0KSA9PT0gZG93bmxvYWRQcm9taXNlKSB7XG4gICAgICAgIHRoaXMuZG93bmxvYWRQcm9taXNlcy5kZWxldGUoZGlnZXN0KVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmRzIG9uZSBjYWNoZWQgZGlnZXN0IHJlc3VsdCBmb3IgZXZlcnkgcGFydGljaXBhdGluZyBkZXNjcmlwdG9yLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZUVudHJ5W119IGVudHJpZXMgRGVzY3JpcHRvciBzdGF0ZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyBhZnRlciBwZXJzaXN0ZW5jZS5cbiAgICovXG4gIGFzeW5jIHJlY29yZENhY2hlZEVudHJpZXMoZW50cmllcykge1xuICAgIGNvbnN0IGxhc3RBY2Nlc3NlZEF0ID0gdGhpcy5ub3dNaWxsaXNlY29uZHMoKVxuXG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiBlbnRyaWVzKSB7XG4gICAgICBlbnRyeS5hdHRlbXB0cyA9IDBcbiAgICAgIGVudHJ5Lmxhc3RBY2Nlc3NlZEF0ID0gbGFzdEFjY2Vzc2VkQXRcbiAgICAgIGVudHJ5Lm5leHRSZXRyeUF0ID0gbnVsbFxuICAgICAgZW50cnkuc3RhdHVzID0gXCJjYWNoZWRcIlxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuc2F2ZVN0YXRlKClcbiAgfVxuXG4gIC8qKlxuICAgKiBQZXJzaXN0cyBkb3dubG9hZCBpbnRlbnQsIHRoZW4gZG93bmxvYWRzIG9uZSBkaWdlc3QgYW5kIHJlY29yZHMgYSBzaGFyZWQgZmFpbHVyZSBvbmNlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZURlc2NyaXB0b3J9IGRlc2NyaXB0b3IgQXNzZXQgZGVzY3JpcHRvci5cbiAgICogQHJldHVybnMge1Byb21pc2U8e2Vycm9yOiBFcnJvciwgdXJpOiBudWxsfSB8IHtlcnJvcjogbnVsbCwgdXJpOiBzdHJpbmd9Pn0gU2hhcmVkIGNhY2hlIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGRvd25sb2FkQWZ0ZXJQZXJzaXN0aW5nU3RhdGUoZGVzY3JpcHRvcikge1xuICAgIGF3YWl0IHRoaXMuc2F2ZVN0YXRlKClcblxuICAgIHRyeSB7XG4gICAgICByZXR1cm4ge2Vycm9yOiBudWxsLCB1cmk6IGF3YWl0IHRoaXMuZG93bmxvYWRWZXJpZmllZChkZXNjcmlwdG9yKX1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc3QgZmFpbHVyZSA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKVxuXG4gICAgICBhd2FpdCB0aGlzLnJlY29yZERvd25sb2FkRmFpbHVyZShkZXNjcmlwdG9yLmRpZ2VzdClcblxuICAgICAgcmV0dXJuIHtlcnJvcjogZmFpbHVyZSwgdXJpOiBudWxsfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBBZHZhbmNlcyByZXRyeSBtZXRhZGF0YSBmb3IgZXZlcnkgbGl2ZSBkZXNjcmlwdG9yIHNoYXJpbmcgb25lIGZhaWxlZCBkaWdlc3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBkaWdlc3QgQ29udGVudCBkaWdlc3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyBhZnRlciBwZXJzaXN0ZW5jZS5cbiAgICovXG4gIGFzeW5jIHJlY29yZERvd25sb2FkRmFpbHVyZShkaWdlc3QpIHtcbiAgICBpZiAoIXRoaXMuc3RhdGUpIHRocm93IG5ldyBFcnJvcihcIkNhbm5vdCByZWNvcmQgc3luY2hyb25pemVkIGFzc2V0IGRvd25sb2FkIGZhaWx1cmUgYmVmb3JlIGxvYWRpbmcgc3RhdGVcIilcblxuICAgIGNvbnN0IGZhaWxlZEF0ID0gdGhpcy5ub3dNaWxsaXNlY29uZHMoKVxuXG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiB0aGlzLnN0YXRlLmFzc2V0cykge1xuICAgICAgaWYgKGVudHJ5LmRlc2NyaXB0b3IuZGlnZXN0ICE9PSBkaWdlc3QpIGNvbnRpbnVlXG4gICAgICBpZiAoZW50cnkuc3RhdHVzICE9PSBcImRvd25sb2FkaW5nXCIpIGNvbnRpbnVlXG5cbiAgICAgIGVudHJ5LmF0dGVtcHRzICs9IDFcbiAgICAgIGVudHJ5Lm5leHRSZXRyeUF0ID0gZmFpbGVkQXQgKyB0aGlzLnJldHJ5RGVsYXkoZW50cnkuYXR0ZW1wdHMpXG4gICAgICBlbnRyeS5zdGF0dXMgPSBcImZhaWxlZFwiXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5zYXZlU3RhdGUoKVxuICB9XG5cbiAgLyoqXG4gICAqIERvd25sb2FkcywgdmVyaWZpZXMsIGFuZCBhdG9taWNhbGx5IHBlcnNpc3RzIG9uZSBjb250ZW50IGRpZ2VzdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVEZXNjcmlwdG9yfSBkZXNjcmlwdG9yIEFzc2V0IGRlc2NyaXB0b3IuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IEFkYXB0ZXIgVVJJLlxuICAgKi9cbiAgYXN5bmMgZG93bmxvYWRWZXJpZmllZChkZXNjcmlwdG9yKSB7XG4gICAgY29uc3QgZG93bmxvYWRlZEJ5dGVzID0gYXdhaXQgdGhpcy5kb3dubG9hZChkZXNjcmlwdG9yKVxuXG4gICAgaWYgKCEoZG93bmxvYWRlZEJ5dGVzIGluc3RhbmNlb2YgVWludDhBcnJheSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgU3luY2hyb25pemVkIGFzc2V0ICR7ZGVzY3JpcHRvci5pZH0gZG93bmxvYWQgZGlkIG5vdCByZXR1cm4gVWludDhBcnJheSBieXRlc2ApXG4gICAgfVxuICAgIGlmIChkb3dubG9hZGVkQnl0ZXMuYnl0ZUxlbmd0aCAhPT0gZGVzY3JpcHRvci5ieXRlU2l6ZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBTeW5jaHJvbml6ZWQgYXNzZXQgJHtkZXNjcmlwdG9yLmlkfSBieXRlIHNpemUgZGlkIG5vdCBtYXRjaCBpdHMgZGVzY3JpcHRvcmApXG4gICAgfVxuXG4gICAgY29uc3QgZGlnZXN0ID0gYHNoYTI1Ni0ke3NoYTI1NkJ5dGVzSGV4KGRvd25sb2FkZWRCeXRlcyl9YFxuXG4gICAgaWYgKGRpZ2VzdCAhPT0gZGVzY3JpcHRvci5kaWdlc3QpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgU3luY2hyb25pemVkIGFzc2V0ICR7ZGVzY3JpcHRvci5pZH0gZGlnZXN0IGRpZCBub3QgbWF0Y2ggaXRzIGRlc2NyaXB0b3JgKVxuICAgIH1cblxuICAgIGNvbnN0IHVyaSA9IGF3YWl0IHRoaXMuYWRhcHRlci53cml0ZUJsb2Ioe1xuICAgICAgYWNjb3VudElkOiB0aGlzLmFjY291bnRJZCxcbiAgICAgIGJ5dGVzOiBkb3dubG9hZGVkQnl0ZXMsXG4gICAgICBjb250ZW50VHlwZTogZGVzY3JpcHRvci5jb250ZW50VHlwZSxcbiAgICAgIGRpZ2VzdFxuICAgIH0pXG5cbiAgICBpZiAoIXVyaSkgdGhyb3cgbmV3IEVycm9yKGBTeW5jaHJvbml6ZWQgYXNzZXQgYWRhcHRlciByZXR1cm5lZCBubyBVUkkgZm9yICR7ZGVzY3JpcHRvci5pZH1gKVxuXG4gICAgcmV0dXJuIHVyaVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGFuIGV4aXN0aW5nIGxvY2FsIFVSSSBhZnRlciB3YWl0aW5nIGZvciBkZWxldGlvbiB3b3JrLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZUVudHJ5fSBlbnRyeSBEZXNjcmlwdG9yIHN0YXRlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmcgfCBudWxsPn0gRXhpc3RpbmcgVVJJLlxuICAgKi9cbiAgYXN5bmMgY2FjaGVkVXJpKGVudHJ5KSB7XG4gICAgY29uc3QgZGlnZXN0ID0gZW50cnkuZGVzY3JpcHRvci5kaWdlc3RcblxuICAgIGF3YWl0IHRoaXMuYmVnaW5BY3RpdmVEaWdlc3QoZGlnZXN0KVxuXG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLmNhY2hlZFVyaVdoaWxlQWN0aXZlKGVudHJ5KVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCB0aGlzLmZpbmlzaEFjdGl2ZURpZ2VzdChkaWdlc3QpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGFuIGV4aXN0aW5nIGxvY2FsIFVSSSB3aGlsZSBpdHMgZGlnZXN0IGlzIHByb3RlY3RlZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVFbnRyeX0gZW50cnkgRGVzY3JpcHRvciBzdGF0ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nIHwgbnVsbD59IEV4aXN0aW5nIFVSSS5cbiAgICovXG4gIGFzeW5jIGNhY2hlZFVyaVdoaWxlQWN0aXZlKGVudHJ5KSB7XG4gICAgY29uc3QgdXJpID0gYXdhaXQgdGhpcy5hZGFwdGVyLmJsb2JVcmkoe1xuICAgICAgYWNjb3VudElkOiB0aGlzLmFjY291bnRJZCxcbiAgICAgIGRpZ2VzdDogZW50cnkuZGVzY3JpcHRvci5kaWdlc3RcbiAgICB9KVxuXG4gICAgaWYgKCF1cmkgJiYgZW50cnkuc3RhdHVzID09PSBcImNhY2hlZFwiKSBlbnRyeS5zdGF0dXMgPSBcIm1pc3NpbmdcIlxuXG4gICAgcmV0dXJuIHVyaVxuICB9XG5cbiAgLyoqXG4gICAqIFdhaXRzIGZvciBkZWxldGlvbiBhbmQgcHJvdGVjdHMgYSBkaWdlc3QgZm9yIG9uZSBhY3RpdmUgY2FjaGUgb3BlcmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZGlnZXN0IENvbnRlbnQgZGlnZXN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgYWZ0ZXIgcHJvdGVjdGlvbiBpcyByZWdpc3RlcmVkLlxuICAgKi9cbiAgYXN5bmMgYmVnaW5BY3RpdmVEaWdlc3QoZGlnZXN0KSB7XG4gICAgbGV0IGRlbGV0aW9uUHJvbWlzZSA9IHRoaXMuZGVsZXRpb25Qcm9taXNlcy5nZXQoZGlnZXN0KVxuXG4gICAgd2hpbGUgKGRlbGV0aW9uUHJvbWlzZSkge1xuICAgICAgYXdhaXQgZGVsZXRpb25Qcm9taXNlXG4gICAgICBkZWxldGlvblByb21pc2UgPSB0aGlzLmRlbGV0aW9uUHJvbWlzZXMuZ2V0KGRpZ2VzdClcbiAgICB9XG5cbiAgICBjb25zdCBhY3RpdmVDb3VudCA9IHRoaXMuYWN0aXZlRGlnZXN0Q291bnRzLmdldChkaWdlc3QpID8/IDBcblxuICAgIHRoaXMuYWN0aXZlRGlnZXN0Q291bnRzLnNldChkaWdlc3QsIGFjdGl2ZUNvdW50ICsgMSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWxlYXNlcyBvbmUgY2FjaGUgb3BlcmF0aW9uIGFuZCBwcm9jZXNzZXMgZGVmZXJyZWQgZGVsZXRpb24gYWZ0ZXIgdGhlIGxhc3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBkaWdlc3QgQ29udGVudCBkaWdlc3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyBhZnRlciBhbnkgcGVuZGluZyBkZWxldGlvbi5cbiAgICovXG4gIGFzeW5jIGZpbmlzaEFjdGl2ZURpZ2VzdChkaWdlc3QpIHtcbiAgICBjb25zdCBhY3RpdmVDb3VudCA9IHRoaXMuYWN0aXZlRGlnZXN0Q291bnRzLmdldChkaWdlc3QpXG5cbiAgICBpZiAoYWN0aXZlQ291bnQgPT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBNaXNzaW5nIGFjdGl2ZSBzeW5jaHJvbml6ZWQgYXNzZXQgZGlnZXN0IGNvdW50IGZvciAke2RpZ2VzdH1gKVxuICAgIH1cblxuICAgIGlmIChhY3RpdmVDb3VudCA+IDEpIHtcbiAgICAgIHRoaXMuYWN0aXZlRGlnZXN0Q291bnRzLnNldChkaWdlc3QsIGFjdGl2ZUNvdW50IC0gMSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHRoaXMuYWN0aXZlRGlnZXN0Q291bnRzLmRlbGV0ZShkaWdlc3QpXG4gICAgYXdhaXQgdGhpcy5kZWxldGVQZW5kaW5nRGlnZXN0SWZVbnJlZmVyZW5jZWQoZGlnZXN0KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlbGVhc2VzIGV2ZXJ5IGFjcXVpcmVkIGRpZ2VzdCBiZWZvcmUgcHJvcGFnYXRpbmcgZmluYWxpemF0aW9uIGZhaWx1cmVzLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBkaWdlc3RzIENvbnRlbnQgZGlnZXN0cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIGFmdGVyIGV2ZXJ5IGRpZ2VzdCBpcyByZWxlYXNlZC5cbiAgICovXG4gIGFzeW5jIGZpbmlzaEFjdGl2ZURpZ2VzdHMoZGlnZXN0cykge1xuICAgIC8qKiBAdHlwZSB7RXJyb3JbXX0gKi9cbiAgICBjb25zdCBmYWlsdXJlcyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IGRpZ2VzdCBvZiBkaWdlc3RzKSB7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLmZpbmlzaEFjdGl2ZURpZ2VzdChkaWdlc3QpXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBmYWlsdXJlcy5wdXNoKGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoZmFpbHVyZXMubGVuZ3RoID09PSAxKSB0aHJvdyBmYWlsdXJlc1swXVxuICAgIGlmIChmYWlsdXJlcy5sZW5ndGggPiAxKSB7XG4gICAgICB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoZmFpbHVyZXMsIFwiTXVsdGlwbGUgc3luY2hyb25pemVkIGFzc2V0IGRpZ2VzdCBmaW5hbGl6ZXJzIGZhaWxlZFwiLCB7Y2F1c2U6IGZhaWx1cmVzWzBdfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRGVsZXRlcyBibG9icyB0aGF0IGxvc3QgdGhlaXIgZmluYWwgZGVzY3JpcHRvciByZWZlcmVuY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyBhZnRlciBkZWxldGlvbi5cbiAgICovXG4gIGFzeW5jIGRlbGV0ZVVucmVmZXJlbmNlZERpZ2VzdHMoKSB7XG4gICAgaWYgKCF0aGlzLnN0YXRlKSB0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3QgZGVsZXRlIHN5bmNocm9uaXplZCBhc3NldCBibG9icyBiZWZvcmUgbG9hZGluZyBzdGF0ZVwiKVxuXG4gICAgZm9yIChjb25zdCBkaWdlc3Qgb2YgWy4uLnRoaXMuc3RhdGUucGVuZGluZ0RlbGV0aW9uRGlnZXN0c10pIHtcbiAgICAgIGF3YWl0IHRoaXMuZGVsZXRlUGVuZGluZ0RpZ2VzdElmVW5yZWZlcmVuY2VkKGRpZ2VzdClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRGVsZXRlcyBvbmUgcGVyc2lzdGVkIHBlbmRpbmcgZGlnZXN0IHdoZW4gbm8gZGVzY3JpcHRvciBvciBhY3RpdmUgb3BlcmF0aW9uIG93bnMgaXQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBkaWdlc3QgQ29udGVudCBkaWdlc3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyBhZnRlciBhbnkgcmVxdWlyZWQgZGVsZXRpb24uXG4gICAqL1xuICBhc3luYyBkZWxldGVQZW5kaW5nRGlnZXN0SWZVbnJlZmVyZW5jZWQoZGlnZXN0KSB7XG4gICAgaWYgKCF0aGlzLnN0YXRlKSB0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3QgZGVsZXRlIHN5bmNocm9uaXplZCBhc3NldCBibG9icyBiZWZvcmUgbG9hZGluZyBzdGF0ZVwiKVxuICAgIGlmICghdGhpcy5zdGF0ZS5wZW5kaW5nRGVsZXRpb25EaWdlc3RzLmluY2x1ZGVzKGRpZ2VzdCkpIHJldHVyblxuXG4gICAgYXdhaXQgdGhpcy5kZWxldGVEaWdlc3RJZkluYWN0aXZlKGRpZ2VzdCwgYXN5bmMgKCkgPT4ge1xuICAgICAgaWYgKCF0aGlzLnN0YXRlKSB0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3QgZGVsZXRlIHN5bmNocm9uaXplZCBhc3NldCBibG9icyBiZWZvcmUgbG9hZGluZyBzdGF0ZVwiKVxuICAgICAgaWYgKCF0aGlzLnN0YXRlLnBlbmRpbmdEZWxldGlvbkRpZ2VzdHMuaW5jbHVkZXMoZGlnZXN0KSkgcmV0dXJuIGZhbHNlXG5cbiAgICAgIGxldCBkZWxldGVkID0gZmFsc2VcblxuICAgICAgaWYgKCF0aGlzLnN0YXRlLmFzc2V0cy5zb21lKChlbnRyeSkgPT4gZW50cnkuZGVzY3JpcHRvci5kaWdlc3QgPT09IGRpZ2VzdCkpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5hZGFwdGVyLmRlbGV0ZUJsb2Ioe2FjY291bnRJZDogdGhpcy5hY2NvdW50SWQsIGRpZ2VzdH0pXG4gICAgICAgIGRlbGV0ZWQgPSB0cnVlXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHBlbmRpbmdEZWxldGlvbkRpZ2VzdHMgPSB0aGlzLnN0YXRlLnBlbmRpbmdEZWxldGlvbkRpZ2VzdHNcblxuICAgICAgdGhpcy5zdGF0ZS5wZW5kaW5nRGVsZXRpb25EaWdlc3RzID0gcGVuZGluZ0RlbGV0aW9uRGlnZXN0cy5maWx0ZXIoKGNhbmRpZGF0ZSkgPT4gY2FuZGlkYXRlICE9PSBkaWdlc3QpXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMuc2F2ZVN0YXRlKClcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGlmICghdGhpcy5zdGF0ZS5wZW5kaW5nRGVsZXRpb25EaWdlc3RzLmluY2x1ZGVzKGRpZ2VzdCkpIHRoaXMuc3RhdGUucGVuZGluZ0RlbGV0aW9uRGlnZXN0cy5wdXNoKGRpZ2VzdClcbiAgICAgICAgdGhyb3cgZXJyb3JcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGRlbGV0ZWRcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgb25lIGRlbGV0aW9uIG9ubHkgYWZ0ZXIgZWFybGllciBkZWxldGlvbiB3b3JrIGFuZCB3aGVuIG5vIGNhY2hlIG9wZXJhdGlvbiBvd25zIHRoZSBkaWdlc3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBkaWdlc3QgQ29udGVudCBkaWdlc3QuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxib29sZWFuPn0gY2FsbGJhY2sgUHJvdGVjdGVkIGRlbGV0aW9uIGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gV2hldGhlciB0aGUgY2FsbGJhY2sgZGVsZXRlZCB0aGUgYmxvYi5cbiAgICovXG4gIGFzeW5jIGRlbGV0ZURpZ2VzdElmSW5hY3RpdmUoZGlnZXN0LCBjYWxsYmFjaykge1xuICAgIGxldCBhY3RpdmVEZWxldGlvblByb21pc2UgPSB0aGlzLmRlbGV0aW9uUHJvbWlzZXMuZ2V0KGRpZ2VzdClcblxuICAgIHdoaWxlIChhY3RpdmVEZWxldGlvblByb21pc2UpIHtcbiAgICAgIGF3YWl0IGFjdGl2ZURlbGV0aW9uUHJvbWlzZVxuICAgICAgYWN0aXZlRGVsZXRpb25Qcm9taXNlID0gdGhpcy5kZWxldGlvblByb21pc2VzLmdldChkaWdlc3QpXG4gICAgfVxuXG4gICAgaWYgKHRoaXMuYWN0aXZlRGlnZXN0Q291bnRzLmhhcyhkaWdlc3QpKSByZXR1cm4gZmFsc2VcblxuICAgIC8qKlxuICAgICAqIFJlbGVhc2VzIGNhbGxlcnMgd2FpdGluZyBmb3IgZGVsZXRpb24gY29tcGxldGlvbi5cbiAgICAgKiBAdHlwZSB7KCkgPT4gdm9pZH1cbiAgICAgKi9cbiAgICBsZXQgcmVsZWFzZURlbGV0aW9uID0gKCkgPT4ge31cbiAgICAvKipcbiAgICAgKiBCbG9ja3MgbmV3IGRpZ2VzdCBhY3Rpdml0eSB1bnRpbCBkZWxldGlvbiBjb21wbGV0ZXMuXG4gICAgICogQHR5cGUge1Byb21pc2U8dm9pZD59XG4gICAgICovXG4gICAgY29uc3QgZGVsZXRpb25Qcm9taXNlID0gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICAgIHJlbGVhc2VEZWxldGlvbiA9ICgpID0+IHJlc29sdmUodW5kZWZpbmVkKVxuICAgIH0pXG5cbiAgICB0aGlzLmRlbGV0aW9uUHJvbWlzZXMuc2V0KGRpZ2VzdCwgZGVsZXRpb25Qcm9taXNlKVxuXG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBhd2FpdCBjYWxsYmFjaygpXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGlmICh0aGlzLmRlbGV0aW9uUHJvbWlzZXMuZ2V0KGRpZ2VzdCkgPT09IGRlbGV0aW9uUHJvbWlzZSkgdGhpcy5kZWxldGlvblByb21pc2VzLmRlbGV0ZShkaWdlc3QpXG4gICAgICByZWxlYXNlRGVsZXRpb24oKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBGaW5kcyByZXF1aXJlZCBhc3NldHMgd2l0aG91dCBsb2NhbGx5IGNhY2hlZCBieXRlcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNjb3BlS2V5IFN5bmNocm9uaXplZCBzY29wZSB0byBpbnNwZWN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmdbXT59IE1pc3NpbmcgcmVxdWlyZWQgZGVzY3JpcHRvciBpZHMuXG4gICAqL1xuICBhc3luYyBtaXNzaW5nUmVxdWlyZWRBc3NldElkcyhzY29wZUtleSkge1xuICAgIGNvbnN0IHN0YXRlID0gYXdhaXQgdGhpcy5sb2FkU3RhdGUoKVxuICAgIC8qKiBAdHlwZSB7c3RyaW5nW119ICovXG4gICAgY29uc3QgbWlzc2luZ0Fzc2V0SWRzID0gW11cblxuICAgIGZvciAoY29uc3QgZW50cnkgb2Ygc3RhdGUuYXNzZXRzKSB7XG4gICAgICBpZiAoIWVudHJ5LnNjb3BlS2V5cy5pbmNsdWRlcyhzY29wZUtleSkpIGNvbnRpbnVlXG4gICAgICBpZiAoZW50cnkuZGVzY3JpcHRvci5vZmZsaW5lUmVxdWlyZW1lbnQgIT09IFwicmVxdWlyZWRcIikgY29udGludWVcbiAgICAgIGlmIChhd2FpdCB0aGlzLmNhY2hlZFVyaShlbnRyeSkpIGNvbnRpbnVlXG5cbiAgICAgIG1pc3NpbmdBc3NldElkcy5wdXNoKGVudHJ5LmRlc2NyaXB0b3IuaWQpXG4gICAgfVxuXG4gICAgcmV0dXJuIG1pc3NpbmdBc3NldElkc1xuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrcyB3aGV0aGVyIGEgZmFpbGVkIG9yIG1pc3NpbmcgZW50cnkgbWF5IGJlIGRvd25sb2FkZWQgbm93LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZUVudHJ5fSBlbnRyeSBEZXNjcmlwdG9yIHN0YXRlLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gV2hldGhlciB0aGUgcmV0cnkgZGVhZGxpbmUgaGFzIHBhc3NlZC5cbiAgICovXG4gIHJldHJ5RWxpZ2libGUoZW50cnkpIHtcbiAgICByZXR1cm4gZW50cnkuc3RhdHVzICE9PSBcImZhaWxlZFwiIHx8IGVudHJ5Lm5leHRSZXRyeUF0ID09PSBudWxsIHx8IGVudHJ5Lm5leHRSZXRyeUF0IDw9IHRoaXMubm93TWlsbGlzZWNvbmRzKClcbiAgfVxuXG4gIC8qKlxuICAgKiBDYWxjdWxhdGVzIGJvdW5kZWQgZXhwb25lbnRpYWwgcmV0cnkgZGVsYXkuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhdHRlbXB0cyBDb25zZWN1dGl2ZSBmYWlsdXJlcy5cbiAgICogQHJldHVybnMge251bWJlcn0gUmV0cnkgZGVsYXkuXG4gICAqL1xuICByZXRyeURlbGF5KGF0dGVtcHRzKSB7XG4gICAgcmV0dXJuIE1hdGgubWluKHRoaXMucmV0cnlNYXhEZWxheU1zLCB0aGlzLnJldHJ5QmFzZURlbGF5TXMgKiAoMiAqKiBNYXRoLm1heCgwLCBhdHRlbXB0cyAtIDEpKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkcyB0aGUgaW5qZWN0YWJsZSB3YWxsIGNsb2NrLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSBDdXJyZW50IGVwb2NoIG1pbGxpc2Vjb25kcy5cbiAgICovXG4gIG5vd01pbGxpc2Vjb25kcygpIHtcbiAgICByZXR1cm4gdGhpcy5ub3coKS5nZXRUaW1lKClcbiAgfVxufVxuIl19