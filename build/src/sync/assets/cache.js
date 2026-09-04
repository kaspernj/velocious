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
        /** @type {Set<string>} */
        this.cleanupRequiredAfterReleaseDigests = new Set();
        /** @type {Promise<number>} */
        this.cleanupPromise = Promise.resolve(0);
        /** @type {Map<string, Promise<{error: Error, uri: null} | {error: null, uri: string}>>} */
        this.downloadPromises = new Map();
        /** @type {import("./types.js").SynchronizedAssetCacheState | null} */
        this.state = null;
        /** @type {Promise<import("./types.js").SynchronizedAssetCacheState> | null} */
        this.statePromise = null;
        /** @type {Promise<void>} */
        this.saveStatePromise = Promise.resolve();
        /** @type {Map<string, Promise<import("./types.js").SynchronizedAssetCacheSynchronizationResult>>} */
        this.synchronizePromises = new Map();
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
        const synchronize = async () => await this.synchronizeScope({ descriptors, online, scopeKey });
        const previousSynchronizationPromise = this.synchronizePromises.get(scopeKey);
        const synchronizationPromise = previousSynchronizationPromise
            ? previousSynchronizationPromise.then(synchronize, synchronize)
            : synchronize();
        this.synchronizePromises.set(scopeKey, synchronizationPromise);
        try {
            return await synchronizationPromise;
        }
        finally {
            if (this.synchronizePromises.get(scopeKey) === synchronizationPromise) {
                this.synchronizePromises.delete(scopeKey);
            }
        }
    }
    /**
     * Runs one scope synchronization after prior calls for that scope finish.
     * @param {object} args Reconciliation inputs.
     * @param {import("./types.js").SynchronizedAssetCacheDescriptor[]} args.descriptors Current descriptors in the scope.
     * @param {boolean} args.online Whether authenticated downloads are available.
     * @param {string} args.scopeKey Stable synchronized scope key.
     * @returns {Promise<import("./types.js").SynchronizedAssetCacheSynchronizationResult>} Synchronization result.
     */
    async synchronizeScope({ descriptors, online, scopeKey }) {
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
            await this.finishActiveDigest(digest, shouldCleanup ? new Set([digest]) : new Set());
        }
        if (shouldCleanup)
            await this.cleanup(new Set([digest]));
        const requiresUnprotectedCleanup = entry.descriptor.byteSize > this.maxBytes && !state.assets.some((candidate) => {
            return candidate.descriptor.digest === digest && candidate.descriptor.retention === "durable";
        });
        if (requiresUnprotectedCleanup)
            await this.cleanup();
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
        const cleanup = async () => await this.performCleanup(protectedDigests);
        const cleanupPromise = this.cleanupPromise.then(cleanup, cleanup);
        this.cleanupPromise = cleanupPromise;
        return await cleanupPromise;
    }
    /**
     * Performs one serialized eviction pass.
     * @param {Set<string>} protectedDigests Digests needed by the active caller.
     * @returns {Promise<number>} Bytes removed.
     */
    async performCleanup(protectedDigests) {
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
            let deletionChecked = false;
            const deleted = await this.deleteDigestIfInactive(blob.digest, async () => {
                deletionChecked = true;
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
            if (!deletionChecked)
                this.cleanupRequiredAfterReleaseDigests.add(blob.digest);
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
     * @param {Set<string>} [protectedCleanupDigests] Digests needed by the resolving caller.
     * @returns {Promise<void>} Resolves after any pending deletion.
     */
    async finishActiveDigest(digest, protectedCleanupDigests = new Set()) {
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
        if (this.cleanupRequiredAfterReleaseDigests.delete(digest)) {
            await this.cleanup(protectedCleanupDigests);
        }
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2FjaGUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvc3luYy9hc3NldHMvY2FjaGUuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sY0FBYyxNQUFNLGlDQUFpQyxDQUFBO0FBRTVELE1BQU0sbUJBQW1CLEdBQUcsQ0FBQyxDQUFBO0FBQzdCLE1BQU0sMkJBQTJCLEdBQUcsSUFBSSxDQUFBO0FBQ3hDLE1BQU0sMEJBQTBCLEdBQUcsSUFBSSxHQUFHLEVBQUUsR0FBRyxDQUFDLENBQUE7QUFFaEQ7OztHQUdHO0FBQ0gsTUFBTSxDQUFDLE9BQU8sT0FBTyxzQkFBc0I7SUFDekM7Ozs7Ozs7Ozs7T0FVRztJQUNILFlBQVksRUFBQyxTQUFTLEVBQUUsT0FBTyxFQUFFLFFBQVEsRUFBRSxRQUFRLEVBQUUsR0FBRyxHQUFHLEdBQUcsRUFBRSxDQUFDLElBQUksSUFBSSxFQUFFLEVBQUUsZ0JBQWdCLEdBQUcsMkJBQTJCLEVBQUUsZUFBZSxHQUFHLDBCQUEwQixFQUFDO1FBQ3hLLElBQUksQ0FBQyxTQUFTO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxpREFBaUQsQ0FBQyxDQUFBO1FBQ2xGLElBQUksQ0FBQyxNQUFNLENBQUMsYUFBYSxDQUFDLFFBQVEsQ0FBQyxJQUFJLFFBQVEsR0FBRyxDQUFDO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyx1RUFBdUUsQ0FBQyxDQUFBO1FBQzdJLElBQUksQ0FBQyxNQUFNLENBQUMsYUFBYSxDQUFDLGdCQUFnQixDQUFDLElBQUksZ0JBQWdCLEdBQUcsQ0FBQztZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsMkVBQTJFLENBQUMsQ0FBQTtRQUNqSyxJQUFJLENBQUMsTUFBTSxDQUFDLGFBQWEsQ0FBQyxlQUFlLENBQUMsSUFBSSxlQUFlLEdBQUcsZ0JBQWdCO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyw0RUFBNEUsQ0FBQyxDQUFBO1FBRS9LLElBQUksQ0FB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QUFVO2dCQUFFLFNBQVE7WUFDaEUsSUFBSSxNQUFNLElBQUksQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDO2dCQUFFLFNBQVE7WUFFekMsZUFBZSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDLEVBQUUsQ0FBQyxDQUFBO1FBQzNDLENBQUM7UUFFRCxPQUFPLGVBQWUsQ0FBQTtJQUN4QixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILGFBQWEsQ0FBQyxLQUFLO1FBQ2pCLE9BQU8sS0FBSyxDQUFDLE1BQU0sS0FBSyxRQUFRLElBQUksS0FBSyxDQUFDLFdBQVcsS0FBSyxJQUFJLElBQUksS0FBSyxDQUFDLFdBQVcsSUFBSSxJQUFJLENBQUMsZUFBZSxFQUFFLENBQUE7SUFDL0csQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxVQUFVLENBQUMsUUFBUTtRQUNqQixPQUFPLElBQUksQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLGVBQWUsRUFBRSxJQUFJLENBQUMsZ0JBQWdCLEdBQUcsQ0FBQyxDQUFDLElBQUksSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsUUFBUSxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQTtJQUNqRyxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsZUFBZTtRQUNiLE9BQU8sSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDLE9BQU8sRUFBRSxDQUFBO0lBQzdCLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgc2hhMjU2Qnl0ZXNIZXggZnJvbSBcIi4uLy4uL3V0aWxzL3NoYTI1Ni1ieXRlcy1oZXguanNcIlxuXG5jb25zdCBDQUNIRV9TVEFURV9WRVJTSU9OID0gMVxuY29uc3QgREVGQVVMVF9SRVRSWV9CQVNFX0RFTEFZX01TID0gMTAwMFxuY29uc3QgREVGQVVMVF9SRVRSWV9NQVhfREVMQVlfTVMgPSAxMDAwICogNjAgKiA1XG5cbi8qKlxuICogQ29yZSBzeW5jaHJvbml6ZWQgYXNzZXQgY2FjaGUuIFBsYXRmb3JtIHBhY2thZ2VzIG93biBieXRlIGFuZCBtZXRhZGF0YVxuICogcGVyc2lzdGVuY2Ugd2hpbGUgdGhpcyBjbGFzcyBvd25zIHBvbGljeSwgaW50ZWdyaXR5LCBhbmQgbGlmZWN5Y2xlLlxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBTeW5jaHJvbml6ZWRBc3NldENhY2hlIHtcbiAgLyoqXG4gICAqIENyZWF0ZXMgYSBzeW5jaHJvbml6ZWQgYXNzZXQgY2FjaGUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmFjY291bnRJZCBBdXRoZW50aWNhdGVkIGFjY291bnQgbmFtZXNwYWNlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZUFkYXB0ZXJ9IGFyZ3MuYWRhcHRlciBQbGF0Zm9ybSBzdG9yYWdlIGFkYXB0ZXIuXG4gICAqIEBwYXJhbSB7KGRlc2NyaXB0b3I6IGltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZURlc2NyaXB0b3IpID0+IFByb21pc2U8VWludDhBcnJheT59IGFyZ3MuZG93bmxvYWQgQXV0aGVudGljYXRlZCBieXRlIGRvd25sb2FkZXIuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLm1heEJ5dGVzIE1heGltdW0gZXZpY3RhYmxlIGNhY2hlIHNpemUuXG4gICAqIEBwYXJhbSB7KCkgPT4gRGF0ZX0gW2FyZ3Mubm93XSBDbG9jay5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLnJldHJ5QmFzZURlbGF5TXNdIEluaXRpYWwgcmV0cnkgZGVsYXkuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5yZXRyeU1heERlbGF5TXNdIE1heGltdW0gcmV0cnkgZGVsYXkuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7YWNjb3VudElkLCBhZGFwdGVyLCBkb3dubG9hZCwgbWF4Qnl0ZXMsIG5vdyA9ICgpID0+IG5ldyBEYXRlKCksIHJldHJ5QmFzZURlbGF5TXMgPSBERUZBVUxUX1JFVFJZX0JBU0VfREVMQVlfTVMsIHJldHJ5TWF4RGVsYXlNcyA9IERFRkFVTFRfUkVUUllfTUFYX0RFTEFZX01TfSkge1xuICAgIGlmICghYWNjb3VudElkKSB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jaHJvbml6ZWQgYXNzZXQgY2FjaGUgcmVxdWlyZXMgYW4gYWNjb3VudCBpZFwiKVxuICAgIGlmICghTnVtYmVyLmlzU2FmZUludGVnZXIobWF4Qnl0ZXMpIHx8IG1heEJ5dGVzIDwgMCkgdGhyb3cgbmV3IEVycm9yKFwiU3luY2hyb25pemVkIGFzc2V0IGNhY2hlIG1heEJ5dGVzIG11c3QgYmUgYSBub24tbmVnYXRpdmUgc2FmZSBpbnRlZ2VyXCIpXG4gICAgaWYgKCFOdW1iZXIuaXNTYWZlSW50ZWdlcihyZXRyeUJhc2VEZWxheU1zKSB8fCByZXRyeUJhc2VEZWxheU1zIDwgMSkgdGhyb3cgbmV3IEVycm9yKFwiU3luY2hyb25pemVkIGFzc2V0IGNhY2hlIHJldHJ5QmFzZURlbGF5TXMgbXVzdCBiZSBhIHBvc2l0aXZlIHNhZmUgaW50ZWdlclwiKVxuICAgIGlmICghTnVtYmVyLmlzU2FmZUludGVnZXIocmV0cnlNYXhEZWxheU1zKSB8fCByZXRyeU1heERlbGF5TXMgPCByZXRyeUJhc2VEZWxheU1zKSB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jaHJvbml6ZWQgYXNzZXQgY2FjaGUgcmV0cnlNYXhEZWxheU1zIG11c3QgYmUgYXQgbGVhc3QgcmV0cnlCYXNlRGVsYXlNc1wiKVxuXG4gICAgdGhpcy5hY2NvdW50SWQgPSBhY2NvdW50SWRcbiAgICB0aGlzLmFkYXB0ZXIgPSBhZGFwdGVyXG4gICAgdGhpcy5kb3dubG9hZCA9IGRvd25sb2FkXG4gICAgdGhpcy5tYXhCeXRlcyA9IG1heEJ5dGVzXG4gICAgdGhpcy5ub3cgPSBub3dcbiAgICB0aGlzLnJldHJ5QmFzZURlbGF5TXMgPSByZXRyeUJhc2VEZWxheU1zXG4gICAgdGhpcy5yZXRyeU1heERlbGF5TXMgPSByZXRyeU1heERlbGF5TXNcbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIG51bWJlcj59ICovXG4gICAgdGhpcy5hY3RpdmVEaWdlc3RDb3VudHMgPSBuZXcgTWFwKClcbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIFByb21pc2U8dm9pZD4+fSAqL1xuICAgIHRoaXMuZGVsZXRpb25Qcm9taXNlcyA9IG5ldyBNYXAoKVxuICAgIC8qKiBAdHlwZSB7U2V0PHN0cmluZz59ICovXG4gICAgdGhpcy5jbGVhbnVwUmVxdWlyZWRBZnRlclJlbGVhc2VEaWdlc3RzID0gbmV3IFNldCgpXG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPG51bWJlcj59ICovXG4gICAgdGhpcy5jbGVhbnVwUHJvbWlzZSA9IFByb21pc2UucmVzb2x2ZSgwKVxuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgUHJvbWlzZTx7ZXJyb3I6IEVycm9yLCB1cmk6IG51bGx9IHwge2Vycm9yOiBudWxsLCB1cmk6IHN0cmluZ30+Pn0gKi9cbiAgICB0aGlzLmRvd25sb2FkUHJvbWlzZXMgPSBuZXcgTWFwKClcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZVN0YXRlIHwgbnVsbH0gKi9cbiAgICB0aGlzLnN0YXRlID0gbnVsbFxuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVTdGF0ZT4gfCBudWxsfSAqL1xuICAgIHRoaXMuc3RhdGVQcm9taXNlID0gbnVsbFxuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPn0gKi9cbiAgICB0aGlzLnNhdmVTdGF0ZVByb21pc2UgPSBQcm9taXNlLnJlc29sdmUoKVxuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgUHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVTeW5jaHJvbml6YXRpb25SZXN1bHQ+Pn0gKi9cbiAgICB0aGlzLnN5bmNocm9uaXplUHJvbWlzZXMgPSBuZXcgTWFwKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvbmNpbGVzIHRoZSBpbW11dGFibGUgZGVzY3JpcHRvcnMgZm9yIG9uZSBzeW5jaHJvbml6ZWQgc2NvcGUgYW5kXG4gICAqIGRvd25sb2FkcyBlbGlnaWJsZSBlYWdlciBhc3NldHMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIFJlY29uY2lsaWF0aW9uIGlucHV0cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVEZXNjcmlwdG9yW119IGFyZ3MuZGVzY3JpcHRvcnMgQ3VycmVudCBkZXNjcmlwdG9ycyBpbiB0aGUgc2NvcGUuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5vbmxpbmUgV2hldGhlciBhdXRoZW50aWNhdGVkIGRvd25sb2FkcyBhcmUgYXZhaWxhYmxlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zY29wZUtleSBTdGFibGUgc3luY2hyb25pemVkIHNjb3BlIGtleS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlU3luY2hyb25pemF0aW9uUmVzdWx0Pn0gU3luY2hyb25pemF0aW9uIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHN5bmNocm9uaXplKHtkZXNjcmlwdG9ycywgb25saW5lLCBzY29wZUtleX0pIHtcbiAgICBjb25zdCBzeW5jaHJvbml6ZSA9IGFzeW5jICgpID0+IGF3YWl0IHRoaXMuc3luY2hyb25pemVTY29wZSh7ZGVzY3JpcHRvcnMsIG9ubGluZSwgc2NvcGVLZXl9KVxuICAgIGNvbnN0IHByZXZpb3VzU3luY2hyb25pemF0aW9uUHJvbWlzZSA9IHRoaXMuc3luY2hyb25pemVQcm9taXNlcy5nZXQoc2NvcGVLZXkpXG4gICAgY29uc3Qgc3luY2hyb25pemF0aW9uUHJvbWlzZSA9IHByZXZpb3VzU3luY2hyb25pemF0aW9uUHJvbWlzZVxuICAgICAgPyBwcmV2aW91c1N5bmNocm9uaXphdGlvblByb21pc2UudGhlbihzeW5jaHJvbml6ZSwgc3luY2hyb25pemUpXG4gICAgICA6IHN5bmNocm9uaXplKClcblxuICAgIHRoaXMuc3luY2hyb25pemVQcm9taXNlcy5zZXQoc2NvcGVLZXksIHN5bmNocm9uaXphdGlvblByb21pc2UpXG5cbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IHN5bmNocm9uaXphdGlvblByb21pc2VcbiAgICB9IGZpbmFsbHkge1xuICAgICAgaWYgKHRoaXMuc3luY2hyb25pemVQcm9taXNlcy5nZXQoc2NvcGVLZXkpID09PSBzeW5jaHJvbml6YXRpb25Qcm9taXNlKSB7XG4gICAgICAgIHRoaXMuc3luY2hyb25pemVQcm9taXNlcy5kZWxldGUoc2NvcGVLZXkpXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgb25lIHNjb3BlIHN5bmNocm9uaXphdGlvbiBhZnRlciBwcmlvciBjYWxscyBmb3IgdGhhdCBzY29wZSBmaW5pc2guXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIFJlY29uY2lsaWF0aW9uIGlucHV0cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVEZXNjcmlwdG9yW119IGFyZ3MuZGVzY3JpcHRvcnMgQ3VycmVudCBkZXNjcmlwdG9ycyBpbiB0aGUgc2NvcGUuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5vbmxpbmUgV2hldGhlciBhdXRoZW50aWNhdGVkIGRvd25sb2FkcyBhcmUgYXZhaWxhYmxlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zY29wZUtleSBTdGFibGUgc3luY2hyb25pemVkIHNjb3BlIGtleS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlU3luY2hyb25pemF0aW9uUmVzdWx0Pn0gU3luY2hyb25pemF0aW9uIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHN5bmNocm9uaXplU2NvcGUoe2Rlc2NyaXB0b3JzLCBvbmxpbmUsIHNjb3BlS2V5fSkge1xuICAgIGF3YWl0IHRoaXMubG9hZFN0YXRlKClcbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIGltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZURlc2NyaXB0b3JbXT59ICovXG4gICAgY29uc3QgZGVzY3JpcHRvcnNCeURpZ2VzdCA9IG5ldyBNYXAoKVxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlRmFpbHVyZVtdfSAqL1xuICAgIGNvbnN0IGZhaWx1cmVzID0gW11cbiAgICAvKiogQHR5cGUge1NldDxzdHJpbmc+fSAqL1xuICAgIGNvbnN0IGFjdGl2ZURpZ2VzdHMgPSBuZXcgU2V0KClcblxuICAgIGZvciAoY29uc3QgZGVzY3JpcHRvciBvZiBkZXNjcmlwdG9ycykge1xuICAgICAgY29uc3QgZGlnZXN0RGVzY3JpcHRvcnMgPSBkZXNjcmlwdG9yc0J5RGlnZXN0LmdldChkZXNjcmlwdG9yLmRpZ2VzdCkgfHwgW11cblxuICAgICAgZGlnZXN0RGVzY3JpcHRvcnMucHVzaChkZXNjcmlwdG9yKVxuICAgICAgZGVzY3JpcHRvcnNCeURpZ2VzdC5zZXQoZGVzY3JpcHRvci5kaWdlc3QsIGRpZ2VzdERlc2NyaXB0b3JzKVxuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBmb3IgKGNvbnN0IGRpZ2VzdCBvZiBkZXNjcmlwdG9yc0J5RGlnZXN0LmtleXMoKSkge1xuICAgICAgICBhd2FpdCB0aGlzLmJlZ2luQWN0aXZlRGlnZXN0KGRpZ2VzdClcbiAgICAgICAgYWN0aXZlRGlnZXN0cy5hZGQoZGlnZXN0KVxuICAgICAgfVxuXG4gICAgICBjb25zdCBlbnRyaWVzQnlJZCA9IGF3YWl0IHRoaXMucmVjb25jaWxlRGVzY3JpcHRvcnMoe2Rlc2NyaXB0b3JzLCBzY29wZUtleX0pXG5cbiAgICAgIGF3YWl0IHRoaXMuZGVsZXRlVW5yZWZlcmVuY2VkRGlnZXN0cygpXG5cbiAgICAgIGZvciAoY29uc3QgW2RpZ2VzdCwgZGlnZXN0RGVzY3JpcHRvcnNdIG9mIGRlc2NyaXB0b3JzQnlEaWdlc3QpIHtcbiAgICAgICAgY29uc3QgZWFnZXJEZXNjcmlwdG9ycyA9IG9ubGluZSA/IGRpZ2VzdERlc2NyaXB0b3JzLmZpbHRlcigoZGVzY3JpcHRvcikgPT4gZGVzY3JpcHRvci5mZXRjaCA9PT0gXCJlYWdlclwiKSA6IFtdXG5cbiAgICAgICAgaWYgKGVhZ2VyRGVzY3JpcHRvcnMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgYWN0aXZlRGlnZXN0cy5kZWxldGUoZGlnZXN0KVxuICAgICAgICAgIGF3YWl0IHRoaXMuZmluaXNoQWN0aXZlRGlnZXN0KGRpZ2VzdClcbiAgICAgICAgICBjb250aW51ZVxuICAgICAgICB9XG5cbiAgICAgICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVFbnRyeVtdfSAqL1xuICAgICAgICBjb25zdCBlYWdlckVudHJpZXMgPSBbXVxuXG4gICAgICAgIGZvciAoY29uc3QgZGVzY3JpcHRvciBvZiBlYWdlckRlc2NyaXB0b3JzKSB7XG4gICAgICAgICAgY29uc3QgZW50cnkgPSBlbnRyaWVzQnlJZC5nZXQoZGVzY3JpcHRvci5pZClcblxuICAgICAgICAgIGlmICghZW50cnkpIHRocm93IG5ldyBFcnJvcihgTWlzc2luZyByZWNvbmNpbGVkIHN5bmNocm9uaXplZCBhc3NldCBkZXNjcmlwdG9yICR7ZGVzY3JpcHRvci5pZH1gKVxuXG4gICAgICAgICAgZWFnZXJFbnRyaWVzLnB1c2goZW50cnkpXG4gICAgICAgIH1cblxuICAgICAgICBpZiAoZWFnZXJFbnRyaWVzLnNvbWUoKGVudHJ5KSA9PiB0aGlzLnJldHJ5RWxpZ2libGUoZW50cnkpKSkge1xuICAgICAgICAgIGNvbnN0IGNhY2hlUmVzdWx0ID0gYXdhaXQgdGhpcy5lbnN1cmVDYWNoZWRXaGlsZUFjdGl2ZShlYWdlckVudHJpZXMpXG5cbiAgICAgICAgICBpZiAoY2FjaGVSZXN1bHQuZXJyb3IpIHtcbiAgICAgICAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgZWFnZXJFbnRyaWVzKSB7XG4gICAgICAgICAgICAgIGZhaWx1cmVzLnB1c2goe2Fzc2V0SWQ6IGVudHJ5LmRlc2NyaXB0b3IuaWQsIGVycm9yOiBjYWNoZVJlc3VsdC5lcnJvcn0pXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgYWN0aXZlRGlnZXN0cy5kZWxldGUoZGlnZXN0KVxuICAgICAgICBhd2FpdCB0aGlzLmZpbmlzaEFjdGl2ZURpZ2VzdChkaWdlc3QpXG4gICAgICAgIGF3YWl0IHRoaXMuY2xlYW51cCgpXG4gICAgICB9XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IHRoaXMuZmluaXNoQWN0aXZlRGlnZXN0cyhbLi4uYWN0aXZlRGlnZXN0c10pXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5jbGVhbnVwKClcblxuICAgIHJldHVybiB7XG4gICAgICBmYWlsdXJlcyxcbiAgICAgIG1pc3NpbmdSZXF1aXJlZEFzc2V0SWRzOiBhd2FpdCB0aGlzLm1pc3NpbmdSZXF1aXJlZEFzc2V0SWRzKHNjb3BlS2V5KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBhIGNhY2hlZCBhc3NldCBVUkksIGRvd25sb2FkaW5nIGl0IG9uIGRlbWFuZCB3aGVuIGFsbG93ZWQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIFJlc29sdXRpb24gaW5wdXRzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5hc3NldElkIEF0dGFjaG1lbnQgZGVzY3JpcHRvciBpZC5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLm9ubGluZSBXaGV0aGVyIGF1dGhlbnRpY2F0ZWQgZG93bmxvYWRzIGFyZSBhdmFpbGFibGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZyB8IG51bGw+fSBDYWNoZWQgYXNzZXQgVVJJLlxuICAgKi9cbiAgYXN5bmMgcmVzb2x2ZSh7YXNzZXRJZCwgb25saW5lfSkge1xuICAgIGNvbnN0IHN0YXRlID0gYXdhaXQgdGhpcy5sb2FkU3RhdGUoKVxuICAgIGNvbnN0IGVudHJ5ID0gc3RhdGUuYXNzZXRzLmZpbmQoKGNhbmRpZGF0ZSkgPT4gY2FuZGlkYXRlLmRlc2NyaXB0b3IuaWQgPT09IGFzc2V0SWQpXG5cbiAgICBpZiAoIWVudHJ5KSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgZGlnZXN0ID0gZW50cnkuZGVzY3JpcHRvci5kaWdlc3RcbiAgICBsZXQgcmVzb2x2ZWRVcmkgPSBudWxsXG4gICAgbGV0IHNob3VsZENsZWFudXAgPSBmYWxzZVxuXG4gICAgYXdhaXQgdGhpcy5iZWdpbkFjdGl2ZURpZ2VzdChkaWdlc3QpXG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgY2FjaGVkVXJpID0gYXdhaXQgdGhpcy5jYWNoZWRVcmlXaGlsZUFjdGl2ZShlbnRyeSlcblxuICAgICAgaWYgKGNhY2hlZFVyaSkge1xuICAgICAgICBlbnRyeS5sYXN0QWNjZXNzZWRBdCA9IHRoaXMubm93TWlsbGlzZWNvbmRzKClcbiAgICAgICAgZW50cnkuc3RhdHVzID0gXCJjYWNoZWRcIlxuICAgICAgICBhd2FpdCB0aGlzLnNhdmVTdGF0ZSgpXG5cbiAgICAgICAgcmVzb2x2ZWRVcmkgPSBjYWNoZWRVcmlcbiAgICAgIH0gZWxzZSBpZiAob25saW5lICYmIHRoaXMucmV0cnlFbGlnaWJsZShlbnRyeSkpIHtcbiAgICAgICAgY29uc3QgY2FjaGVSZXN1bHQgPSBhd2FpdCB0aGlzLmVuc3VyZUNhY2hlZFdoaWxlQWN0aXZlKFtlbnRyeV0pXG5cbiAgICAgICAgaWYgKGNhY2hlUmVzdWx0LmVycm9yKSB0aHJvdyBjYWNoZVJlc3VsdC5lcnJvclxuXG4gICAgICAgIGlmIChjYWNoZVJlc3VsdC51cmkpIHtcbiAgICAgICAgICByZXNvbHZlZFVyaSA9IGNhY2hlUmVzdWx0LnVyaVxuICAgICAgICAgIHNob3VsZENsZWFudXAgPSB0cnVlXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgdGhpcy5maW5pc2hBY3RpdmVEaWdlc3QoZGlnZXN0LCBzaG91bGRDbGVhbnVwID8gbmV3IFNldChbZGlnZXN0XSkgOiBuZXcgU2V0KCkpXG4gICAgfVxuXG4gICAgaWYgKHNob3VsZENsZWFudXApIGF3YWl0IHRoaXMuY2xlYW51cChuZXcgU2V0KFtkaWdlc3RdKSlcbiAgICBjb25zdCByZXF1aXJlc1VucHJvdGVjdGVkQ2xlYW51cCA9IGVudHJ5LmRlc2NyaXB0b3IuYnl0ZVNpemUgPiB0aGlzLm1heEJ5dGVzICYmICFzdGF0ZS5hc3NldHMuc29tZSgoY2FuZGlkYXRlKSA9PiB7XG4gICAgICByZXR1cm4gY2FuZGlkYXRlLmRlc2NyaXB0b3IuZGlnZXN0ID09PSBkaWdlc3QgJiYgY2FuZGlkYXRlLmRlc2NyaXB0b3IucmV0ZW50aW9uID09PSBcImR1cmFibGVcIlxuICAgIH0pXG5cbiAgICBpZiAocmVxdWlyZXNVbnByb3RlY3RlZENsZWFudXApIGF3YWl0IHRoaXMuY2xlYW51cCgpXG4gICAgaWYgKCFyZXNvbHZlZFVyaSkgcmV0dXJuIG51bGxcbiAgICBjb25zdCByZXNvbHZlZEVudHJ5ID0gc3RhdGUuYXNzZXRzLmZpbmQoKGNhbmRpZGF0ZSkgPT4gY2FuZGlkYXRlLmRlc2NyaXB0b3IuaWQgPT09IGFzc2V0SWQgJiYgY2FuZGlkYXRlLmRlc2NyaXB0b3IuZGlnZXN0ID09PSBkaWdlc3QpXG5cbiAgICBpZiAoIXJlc29sdmVkRW50cnkpIHJldHVybiBudWxsXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5jYWNoZWRVcmkocmVzb2x2ZWRFbnRyeSlcbiAgfVxuXG4gIC8qKlxuICAgKiBFdmljdHMgbGVhc3QtcmVjZW50bHktdXNlZCBibG9icyB1bnRpbCB0aGUgdW5pcXVlIGNhY2hlZCBieXRlIHRvdGFsIGlzXG4gICAqIHdpdGhpbiB0aGUgY29uZmlndXJlZCBidWRnZXQuIEEgYmxvYiBzdGF5cyBkdXJhYmxlIHdoZW4gYW55IGxpdmVcbiAgICogZGVzY3JpcHRvciByZWZlcmVuY2UgZGVjbGFyZXMgZHVyYWJsZSByZXRlbnRpb24uXG4gICAqIEBwYXJhbSB7U2V0PHN0cmluZz59IFtwcm90ZWN0ZWREaWdlc3RzXSBEaWdlc3RzIG5lZWRlZCBieSB0aGUgYWN0aXZlIGNhbGxlci5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gQnl0ZXMgcmVtb3ZlZC5cbiAgICovXG4gIGFzeW5jIGNsZWFudXAocHJvdGVjdGVkRGlnZXN0cyA9IG5ldyBTZXQoKSkge1xuICAgIGNvbnN0IGNsZWFudXAgPSBhc3luYyAoKSA9PiBhd2FpdCB0aGlzLnBlcmZvcm1DbGVhbnVwKHByb3RlY3RlZERpZ2VzdHMpXG4gICAgY29uc3QgY2xlYW51cFByb21pc2UgPSB0aGlzLmNsZWFudXBQcm9taXNlLnRoZW4oY2xlYW51cCwgY2xlYW51cClcblxuICAgIHRoaXMuY2xlYW51cFByb21pc2UgPSBjbGVhbnVwUHJvbWlzZVxuXG4gICAgcmV0dXJuIGF3YWl0IGNsZWFudXBQcm9taXNlXG4gIH1cblxuICAvKipcbiAgICogUGVyZm9ybXMgb25lIHNlcmlhbGl6ZWQgZXZpY3Rpb24gcGFzcy5cbiAgICogQHBhcmFtIHtTZXQ8c3RyaW5nPn0gcHJvdGVjdGVkRGlnZXN0cyBEaWdlc3RzIG5lZWRlZCBieSB0aGUgYWN0aXZlIGNhbGxlci5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gQnl0ZXMgcmVtb3ZlZC5cbiAgICovXG4gIGFzeW5jIHBlcmZvcm1DbGVhbnVwKHByb3RlY3RlZERpZ2VzdHMpIHtcbiAgICBjb25zdCBzdGF0ZSA9IGF3YWl0IHRoaXMubG9hZFN0YXRlKClcbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIGltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZUVudHJ5W10+fSAqL1xuICAgIGNvbnN0IGVudHJpZXNCeURpZ2VzdCA9IG5ldyBNYXAoKVxuXG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiBzdGF0ZS5hc3NldHMpIHtcbiAgICAgIGNvbnN0IGRpZ2VzdEVudHJpZXMgPSBlbnRyaWVzQnlEaWdlc3QuZ2V0KGVudHJ5LmRlc2NyaXB0b3IuZGlnZXN0KSB8fCBbXVxuXG4gICAgICBkaWdlc3RFbnRyaWVzLnB1c2goZW50cnkpXG4gICAgICBlbnRyaWVzQnlEaWdlc3Quc2V0KGVudHJ5LmRlc2NyaXB0b3IuZGlnZXN0LCBkaWdlc3RFbnRyaWVzKVxuICAgIH1cblxuICAgIC8qKiBAdHlwZSB7e2J5dGVTaXplOiBudW1iZXIsIGRpZ2VzdDogc3RyaW5nLCBsYXN0QWNjZXNzZWRBdDogbnVtYmVyfVtdfSAqL1xuICAgIGNvbnN0IGNhY2hlZEJsb2JzID0gW11cbiAgICBsZXQgY2FjaGVkQnl0ZXMgPSAwXG5cbiAgICBmb3IgKGNvbnN0IFtkaWdlc3QsIHJlZmVyZW5jZXNdIG9mIGVudHJpZXNCeURpZ2VzdCkge1xuICAgICAgY29uc3QgdXJpID0gYXdhaXQgdGhpcy5hZGFwdGVyLmJsb2JVcmkoe2FjY291bnRJZDogdGhpcy5hY2NvdW50SWQsIGRpZ2VzdH0pXG5cbiAgICAgIGlmICghdXJpKSB7XG4gICAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgcmVmZXJlbmNlcykge1xuICAgICAgICAgIGlmIChlbnRyeS5zdGF0dXMgPT09IFwiY2FjaGVkXCIpIGVudHJ5LnN0YXR1cyA9IFwibWlzc2luZ1wiXG4gICAgICAgIH1cbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgY29uc3QgYnl0ZVNpemUgPSByZWZlcmVuY2VzWzBdLmRlc2NyaXB0b3IuYnl0ZVNpemVcblxuICAgICAgY2FjaGVkQnl0ZXMgKz0gYnl0ZVNpemVcbiAgICAgIGNhY2hlZEJsb2JzLnB1c2goe1xuICAgICAgICBieXRlU2l6ZSxcbiAgICAgICAgZGlnZXN0LFxuICAgICAgICBsYXN0QWNjZXNzZWRBdDogTWF0aC5tYXgoLi4ucmVmZXJlbmNlcy5tYXAoKGVudHJ5KSA9PiBlbnRyeS5sYXN0QWNjZXNzZWRBdCkpXG4gICAgICB9KVxuICAgIH1cblxuICAgIGxldCByZW1vdmVkQnl0ZXMgPSAwXG5cbiAgICB3aGlsZSAoY2FjaGVkQmxvYnMubGVuZ3RoID4gMCkge1xuICAgICAgaWYgKGNhY2hlZEJ5dGVzIDw9IHRoaXMubWF4Qnl0ZXMpIGJyZWFrXG5cbiAgICAgIGZvciAoY29uc3QgY2FjaGVkQmxvYiBvZiBjYWNoZWRCbG9icykge1xuICAgICAgICBjb25zdCBjdXJyZW50UmVmZXJlbmNlcyA9IHN0YXRlLmFzc2V0cy5maWx0ZXIoKGVudHJ5KSA9PiBlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdCA9PT0gY2FjaGVkQmxvYi5kaWdlc3QpXG5cbiAgICAgICAgaWYgKGN1cnJlbnRSZWZlcmVuY2VzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICBjYWNoZWRCbG9iLmxhc3RBY2Nlc3NlZEF0ID0gTWF0aC5tYXgoLi4uY3VycmVudFJlZmVyZW5jZXMubWFwKChlbnRyeSkgPT4gZW50cnkubGFzdEFjY2Vzc2VkQXQpKVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGNhY2hlZEJsb2JzLnNvcnQoKGxlZnQsIHJpZ2h0KSA9PiBsZWZ0Lmxhc3RBY2Nlc3NlZEF0IC0gcmlnaHQubGFzdEFjY2Vzc2VkQXQgfHwgbGVmdC5kaWdlc3QubG9jYWxlQ29tcGFyZShyaWdodC5kaWdlc3QpKVxuXG4gICAgICBjb25zdCBibG9iID0gY2FjaGVkQmxvYnMuc2hpZnQoKVxuXG4gICAgICBpZiAoIWJsb2IpIHRocm93IG5ldyBFcnJvcihcIkV4cGVjdGVkIGEgc3luY2hyb25pemVkIGFzc2V0IGNhY2hlIGV2aWN0aW9uIGNhbmRpZGF0ZVwiKVxuICAgICAgaWYgKHByb3RlY3RlZERpZ2VzdHMuaGFzKGJsb2IuZGlnZXN0KSkgY29udGludWVcbiAgICAgIGxldCBibG9iV2FzQWxyZWFkeU1pc3NpbmcgPSBmYWxzZVxuICAgICAgbGV0IGRlbGV0aW9uQ2hlY2tlZCA9IGZhbHNlXG4gICAgICBjb25zdCBkZWxldGVkID0gYXdhaXQgdGhpcy5kZWxldGVEaWdlc3RJZkluYWN0aXZlKGJsb2IuZGlnZXN0LCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGRlbGV0aW9uQ2hlY2tlZCA9IHRydWVcblxuICAgICAgICBpZiAoIXRoaXMuc3RhdGUpIHRocm93IG5ldyBFcnJvcihcIkNhbm5vdCBjbGVhbiBzeW5jaHJvbml6ZWQgYXNzZXQgYmxvYnMgYmVmb3JlIGxvYWRpbmcgc3RhdGVcIilcblxuICAgICAgICBjb25zdCBjdXJyZW50VXJpID0gYXdhaXQgdGhpcy5hZGFwdGVyLmJsb2JVcmkoe2FjY291bnRJZDogdGhpcy5hY2NvdW50SWQsIGRpZ2VzdDogYmxvYi5kaWdlc3R9KVxuICAgICAgICBjb25zdCBjdXJyZW50UmVmZXJlbmNlcyA9IHRoaXMuc3RhdGUuYXNzZXRzLmZpbHRlcigoZW50cnkpID0+IGVudHJ5LmRlc2NyaXB0b3IuZGlnZXN0ID09PSBibG9iLmRpZ2VzdClcblxuICAgICAgICBpZiAoIWN1cnJlbnRVcmkpIHtcbiAgICAgICAgICBibG9iV2FzQWxyZWFkeU1pc3NpbmcgPSB0cnVlXG5cbiAgICAgICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGN1cnJlbnRSZWZlcmVuY2VzKSB7XG4gICAgICAgICAgICBpZiAoZW50cnkuc3RhdHVzID09PSBcImNhY2hlZFwiKSBlbnRyeS5zdGF0dXMgPSBcIm1pc3NpbmdcIlxuICAgICAgICAgIH1cblxuICAgICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgICB9XG4gICAgICAgIGlmIChjdXJyZW50UmVmZXJlbmNlcy5zb21lKChlbnRyeSkgPT4gZW50cnkuZGVzY3JpcHRvci5yZXRlbnRpb24gPT09IFwiZHVyYWJsZVwiKSkgcmV0dXJuIGZhbHNlXG5cbiAgICAgICAgYXdhaXQgdGhpcy5hZGFwdGVyLmRlbGV0ZUJsb2Ioe2FjY291bnRJZDogdGhpcy5hY2NvdW50SWQsIGRpZ2VzdDogYmxvYi5kaWdlc3R9KVxuXG4gICAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgY3VycmVudFJlZmVyZW5jZXMpIHtcbiAgICAgICAgICBlbnRyeS5hdHRlbXB0cyA9IDBcbiAgICAgICAgICBlbnRyeS5uZXh0UmV0cnlBdCA9IG51bGxcbiAgICAgICAgICBlbnRyeS5zdGF0dXMgPSBcIm1pc3NpbmdcIlxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHRydWVcbiAgICAgIH0pXG5cbiAgICAgIGlmICghZGVsZXRpb25DaGVja2VkKSB0aGlzLmNsZWFudXBSZXF1aXJlZEFmdGVyUmVsZWFzZURpZ2VzdHMuYWRkKGJsb2IuZGlnZXN0KVxuICAgICAgaWYgKGJsb2JXYXNBbHJlYWR5TWlzc2luZykgY2FjaGVkQnl0ZXMgLT0gYmxvYi5ieXRlU2l6ZVxuICAgICAgaWYgKCFkZWxldGVkKSBjb250aW51ZVxuXG4gICAgICBjYWNoZWRCeXRlcyAtPSBibG9iLmJ5dGVTaXplXG4gICAgICByZW1vdmVkQnl0ZXMgKz0gYmxvYi5ieXRlU2l6ZVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuc2F2ZVN0YXRlKClcblxuICAgIHJldHVybiByZW1vdmVkQnl0ZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBMb2FkcyBjYWNoZSBzdGF0ZSBvbmNlIGZvciB0aGlzIGNhY2hlIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVTdGF0ZT59IExvYWRlZCBzdGF0ZS5cbiAgICovXG4gIGFzeW5jIGxvYWRTdGF0ZSgpIHtcbiAgICBpZiAodGhpcy5zdGF0ZSkgcmV0dXJuIHRoaXMuc3RhdGVcbiAgICBpZiAodGhpcy5zdGF0ZVByb21pc2UpIHJldHVybiBhd2FpdCB0aGlzLnN0YXRlUHJvbWlzZVxuXG4gICAgdGhpcy5zdGF0ZVByb21pc2UgPSB0aGlzLmxvYWRTdGF0ZUZyb21BZGFwdGVyKClcblxuICAgIHRyeSB7XG4gICAgICB0aGlzLnN0YXRlID0gYXdhaXQgdGhpcy5zdGF0ZVByb21pc2VcblxuICAgICAgcmV0dXJuIHRoaXMuc3RhdGVcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdGhpcy5zdGF0ZVByb21pc2UgPSBudWxsXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIExvYWRzIGFuZCByZWNvdmVycyBwZXJzaXN0ZWQgY2FjaGUgc3RhdGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZVN0YXRlPn0gTG9hZGVkIHN0YXRlLlxuICAgKi9cbiAgYXN5bmMgbG9hZFN0YXRlRnJvbUFkYXB0ZXIoKSB7XG4gICAgY29uc3QgbG9hZGVkU3RhdGUgPSBhd2FpdCB0aGlzLmFkYXB0ZXIubG9hZFN0YXRlKHthY2NvdW50SWQ6IHRoaXMuYWNjb3VudElkfSlcblxuICAgIGlmICghbG9hZGVkU3RhdGUpIHJldHVybiB7YXNzZXRzOiBbXSwgcGVuZGluZ0RlbGV0aW9uRGlnZXN0czogW10sIHZlcnNpb246IENBQ0hFX1NUQVRFX1ZFUlNJT059XG4gICAgaWYgKGxvYWRlZFN0YXRlLnZlcnNpb24gIT09IENBQ0hFX1NUQVRFX1ZFUlNJT04pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgc3luY2hyb25pemVkIGFzc2V0IGNhY2hlIHN0YXRlIHZlcnNpb246ICR7bG9hZGVkU3RhdGUudmVyc2lvbn1gKVxuICAgIH1cblxuICAgIGxldCByZWNvdmVyZWRJbnRlcnJ1cHRlZERvd25sb2FkID0gZmFsc2VcblxuICAgIGZvciAoY29uc3QgZW50cnkgb2YgbG9hZGVkU3RhdGUuYXNzZXRzKSB7XG4gICAgICBpZiAoZW50cnkuc3RhdHVzICE9PSBcImRvd25sb2FkaW5nXCIpIGNvbnRpbnVlXG5cbiAgICAgIGVudHJ5LmF0dGVtcHRzICs9IDFcbiAgICAgIGVudHJ5Lm5leHRSZXRyeUF0ID0gdGhpcy5ub3dNaWxsaXNlY29uZHMoKVxuICAgICAgZW50cnkuc3RhdHVzID0gXCJmYWlsZWRcIlxuICAgICAgcmVjb3ZlcmVkSW50ZXJydXB0ZWREb3dubG9hZCA9IHRydWVcbiAgICB9XG5cbiAgICBpZiAocmVjb3ZlcmVkSW50ZXJydXB0ZWREb3dubG9hZCkge1xuICAgICAgYXdhaXQgdGhpcy5hZGFwdGVyLnNhdmVTdGF0ZSh7YWNjb3VudElkOiB0aGlzLmFjY291bnRJZCwgc3RhdGU6IGxvYWRlZFN0YXRlfSlcbiAgICB9XG5cbiAgICByZXR1cm4gbG9hZGVkU3RhdGVcbiAgfVxuXG4gIC8qKlxuICAgKiBQZXJzaXN0cyB0aGUgY3VycmVudCBjYWNoZSBzdGF0ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIGFmdGVyIHN0YXRlIHBlcnNpc3RlbmNlLlxuICAgKi9cbiAgYXN5bmMgc2F2ZVN0YXRlKCkge1xuICAgIGlmICghdGhpcy5zdGF0ZSkgdGhyb3cgbmV3IEVycm9yKFwiQ2Fubm90IHNhdmUgc3luY2hyb25pemVkIGFzc2V0IGNhY2hlIGJlZm9yZSBsb2FkaW5nIHN0YXRlXCIpXG5cbiAgICBjb25zdCBwZXJzaXN0ID0gYXN5bmMgKCkgPT4ge1xuICAgICAgaWYgKCF0aGlzLnN0YXRlKSB0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3Qgc2F2ZSBzeW5jaHJvbml6ZWQgYXNzZXQgY2FjaGUgYmVmb3JlIGxvYWRpbmcgc3RhdGVcIilcblxuICAgICAgYXdhaXQgdGhpcy5hZGFwdGVyLnNhdmVTdGF0ZSh7YWNjb3VudElkOiB0aGlzLmFjY291bnRJZCwgc3RhdGU6IHRoaXMuc3RhdGV9KVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuc2VyaWFsaXplU3RhdGVQZXJzaXN0ZW5jZShwZXJzaXN0KVxuICB9XG5cbiAgLyoqXG4gICAqIFBlcnNpc3RzIGEgZGV0YWNoZWQgcmVjb25jaWxpYXRpb24gYmVmb3JlIGV4cG9zaW5nIGl0IHRocm91Z2ggc2hhcmVkIHN0YXRlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyBSZWNvbmNpbGlhdGlvbiBpbnB1dHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlRGVzY3JpcHRvcltdfSBhcmdzLmRlc2NyaXB0b3JzIEN1cnJlbnQgZGVzY3JpcHRvcnMgaW4gdGhlIHNjb3BlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zY29wZUtleSBTdGFibGUgc3luY2hyb25pemVkIHNjb3BlIGtleS5cbiAgICogQHJldHVybnMge1Byb21pc2U8TWFwPHN0cmluZywgaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlRW50cnk+Pn0gUmVjb25jaWxlZCBsaXZlIGVudHJpZXMgYnkgaWQuXG4gICAqL1xuICBhc3luYyByZWNvbmNpbGVEZXNjcmlwdG9ycyh7ZGVzY3JpcHRvcnMsIHNjb3BlS2V5fSkge1xuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlRW50cnk+IHwgbnVsbH0gKi9cbiAgICBsZXQgZW50cmllc0J5SWQgPSBudWxsXG5cbiAgICBjb25zdCBwZXJzaXN0ID0gYXN5bmMgKCkgPT4ge1xuICAgICAgaWYgKCF0aGlzLnN0YXRlKSB0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3QgcmVjb25jaWxlIHN5bmNocm9uaXplZCBhc3NldCBjYWNoZSBiZWZvcmUgbG9hZGluZyBzdGF0ZVwiKVxuXG4gICAgICBjb25zdCBjYW5kaWRhdGVTdGF0ZSA9IHRoaXMuY29weVN0YXRlKHRoaXMuc3RhdGUpXG4gICAgICBjb25zdCBuZXdFbnRyeUxhc3RBY2Nlc3NlZEF0ID0gdGhpcy5ub3dNaWxsaXNlY29uZHMoKVxuXG4gICAgICB0aGlzLmFwcGx5RGVzY3JpcHRvclJlY29uY2lsaWF0aW9uKHtkZXNjcmlwdG9ycywgbmV3RW50cnlMYXN0QWNjZXNzZWRBdCwgc2NvcGVLZXksIHN0YXRlOiBjYW5kaWRhdGVTdGF0ZX0pXG4gICAgICBhd2FpdCB0aGlzLmFkYXB0ZXIuc2F2ZVN0YXRlKHthY2NvdW50SWQ6IHRoaXMuYWNjb3VudElkLCBzdGF0ZTogY2FuZGlkYXRlU3RhdGV9KVxuICAgICAgZW50cmllc0J5SWQgPSB0aGlzLmFwcGx5RGVzY3JpcHRvclJlY29uY2lsaWF0aW9uKHtkZXNjcmlwdG9ycywgbmV3RW50cnlMYXN0QWNjZXNzZWRBdCwgc2NvcGVLZXksIHN0YXRlOiB0aGlzLnN0YXRlfSlcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnNlcmlhbGl6ZVN0YXRlUGVyc2lzdGVuY2UocGVyc2lzdClcblxuICAgIGlmICghZW50cmllc0J5SWQpIHRocm93IG5ldyBFcnJvcihcIlN5bmNocm9uaXplZCBhc3NldCBkZXNjcmlwdG9yIHJlY29uY2lsaWF0aW9uIGNvbXBsZXRlZCB3aXRob3V0IGxpdmUgZW50cmllc1wiKVxuXG4gICAgcmV0dXJuIGVudHJpZXNCeUlkXG4gIH1cblxuICAvKipcbiAgICogQXBwbGllcyBvbmUgc2NvcGUncyBkZXNjcmlwdG9yIHNldCB0byBjYWNoZSBzdGF0ZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgUmVjb25jaWxpYXRpb24gaW5wdXRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZURlc2NyaXB0b3JbXX0gYXJncy5kZXNjcmlwdG9ycyBDdXJyZW50IGRlc2NyaXB0b3JzIGluIHRoZSBzY29wZS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MubmV3RW50cnlMYXN0QWNjZXNzZWRBdCBJbml0aWFsIExSVSB0aW1lc3RhbXAgZm9yIG5ldyBlbnRyaWVzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zY29wZUtleSBTdGFibGUgc3luY2hyb25pemVkIHNjb3BlIGtleS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVTdGF0ZX0gYXJncy5zdGF0ZSBTdGF0ZSB0byByZWNvbmNpbGUuXG4gICAqIEByZXR1cm5zIHtNYXA8c3RyaW5nLCBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVFbnRyeT59IExpdmUgZW50cmllcyBieSBpZC5cbiAgICovXG4gIGFwcGx5RGVzY3JpcHRvclJlY29uY2lsaWF0aW9uKHtkZXNjcmlwdG9ycywgbmV3RW50cnlMYXN0QWNjZXNzZWRBdCwgc2NvcGVLZXksIHN0YXRlfSkge1xuICAgIGNvbnN0IGluY29taW5nSWRzID0gbmV3IFNldChkZXNjcmlwdG9ycy5tYXAoKGFzc2V0KSA9PiBhc3NldC5pZCkpXG4gICAgY29uc3QgZW50cmllc0J5SWQgPSBuZXcgTWFwKHN0YXRlLmFzc2V0cy5tYXAoKGVudHJ5KSA9PiBbZW50cnkuZGVzY3JpcHRvci5pZCwgZW50cnldKSlcbiAgICBjb25zdCBkZXNjcmlwdG9yc0J5SWQgPSBuZXcgTWFwKHN0YXRlLmFzc2V0cy5tYXAoKGVudHJ5KSA9PiBbZW50cnkuZGVzY3JpcHRvci5pZCwgZW50cnkuZGVzY3JpcHRvcl0pKVxuICAgIGNvbnN0IHJlbW92ZWREaWdlc3RzID0gbmV3IFNldCgpXG5cbiAgICBmb3IgKGNvbnN0IGFzc2V0IG9mIGRlc2NyaXB0b3JzKSB7XG4gICAgICBjb25zdCBrbm93bkRlc2NyaXB0b3IgPSBkZXNjcmlwdG9yc0J5SWQuZ2V0KGFzc2V0LmlkKVxuXG4gICAgICBpZiAoa25vd25EZXNjcmlwdG9yICYmIGtub3duRGVzY3JpcHRvci5kaWdlc3QgIT09IGFzc2V0LmRpZ2VzdCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFN5bmNocm9uaXplZCBhc3NldCBkZXNjcmlwdG9yICR7YXNzZXQuaWR9IGNoYW5nZWQgaXRzIGltbXV0YWJsZSBkaWdlc3RgKVxuICAgICAgfVxuICAgICAgaWYgKGtub3duRGVzY3JpcHRvciAmJiBrbm93bkRlc2NyaXB0b3IuYnl0ZVNpemUgIT09IGFzc2V0LmJ5dGVTaXplKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgU3luY2hyb25pemVkIGFzc2V0IGRlc2NyaXB0b3IgJHthc3NldC5pZH0gY2hhbmdlZCBpdHMgaW1tdXRhYmxlIGJ5dGUgc2l6ZWApXG4gICAgICB9XG4gICAgICBpZiAoa25vd25EZXNjcmlwdG9yICYmIGtub3duRGVzY3JpcHRvci5jb250ZW50VHlwZSAhPT0gYXNzZXQuY29udGVudFR5cGUpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBTeW5jaHJvbml6ZWQgYXNzZXQgZGVzY3JpcHRvciAke2Fzc2V0LmlkfSBjaGFuZ2VkIGl0cyBpbW11dGFibGUgY29udGVudCB0eXBlYClcbiAgICAgIH1cblxuICAgICAgZGVzY3JpcHRvcnNCeUlkLnNldChhc3NldC5pZCwgYXNzZXQpXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiBzdGF0ZS5hc3NldHMpIHtcbiAgICAgIGlmICghZW50cnkuc2NvcGVLZXlzLmluY2x1ZGVzKHNjb3BlS2V5KSB8fCBpbmNvbWluZ0lkcy5oYXMoZW50cnkuZGVzY3JpcHRvci5pZCkpIGNvbnRpbnVlXG5cbiAgICAgIGVudHJ5LnNjb3BlS2V5cyA9IGVudHJ5LnNjb3BlS2V5cy5maWx0ZXIoKGNhbmRpZGF0ZSkgPT4gY2FuZGlkYXRlICE9PSBzY29wZUtleSlcbiAgICAgIGlmIChlbnRyeS5zY29wZUtleXMubGVuZ3RoID09PSAwKSByZW1vdmVkRGlnZXN0cy5hZGQoZW50cnkuZGVzY3JpcHRvci5kaWdlc3QpXG4gICAgfVxuXG4gICAgc3RhdGUuYXNzZXRzID0gc3RhdGUuYXNzZXRzLmZpbHRlcigoZW50cnkpID0+IGVudHJ5LnNjb3BlS2V5cy5sZW5ndGggPiAwKVxuXG4gICAgZm9yIChjb25zdCBhc3NldCBvZiBkZXNjcmlwdG9ycykge1xuICAgICAgY29uc3QgZXhpc3RpbmcgPSBlbnRyaWVzQnlJZC5nZXQoYXNzZXQuaWQpXG5cbiAgICAgIGlmIChleGlzdGluZyAmJiBzdGF0ZS5hc3NldHMuaW5jbHVkZXMoZXhpc3RpbmcpKSB7XG4gICAgICAgIGV4aXN0aW5nLmRlc2NyaXB0b3IgPSBhc3NldFxuICAgICAgICBpZiAoIWV4aXN0aW5nLnNjb3BlS2V5cy5pbmNsdWRlcyhzY29wZUtleSkpIGV4aXN0aW5nLnNjb3BlS2V5cy5wdXNoKHNjb3BlS2V5KVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY29uc3QgbmV3RW50cnkgPSB7XG4gICAgICAgICAgYXR0ZW1wdHM6IDAsXG4gICAgICAgICAgZGVzY3JpcHRvcjogYXNzZXQsXG4gICAgICAgICAgbGFzdEFjY2Vzc2VkQXQ6IG5ld0VudHJ5TGFzdEFjY2Vzc2VkQXQsXG4gICAgICAgICAgbmV4dFJldHJ5QXQ6IG51bGwsXG4gICAgICAgICAgc2NvcGVLZXlzOiBbc2NvcGVLZXldLFxuICAgICAgICAgIHN0YXR1czogLyoqIEB0eXBlIHtjb25zdH0gKi8gKFwibWlzc2luZ1wiKVxuICAgICAgICB9XG5cbiAgICAgICAgc3RhdGUuYXNzZXRzLnB1c2gobmV3RW50cnkpXG4gICAgICAgIGVudHJpZXNCeUlkLnNldChhc3NldC5pZCwgbmV3RW50cnkpXG4gICAgICB9XG4gICAgfVxuXG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBudW1iZXI+fSAqL1xuICAgIGNvbnN0IGJ5dGVTaXplc0J5RGlnZXN0ID0gbmV3IE1hcCgpXG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBzdHJpbmcgfCBudWxsPn0gKi9cbiAgICBjb25zdCBjb250ZW50VHlwZXNCeURpZ2VzdCA9IG5ldyBNYXAoKVxuXG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiBzdGF0ZS5hc3NldHMpIHtcbiAgICAgIGNvbnN0IGtub3duQnl0ZVNpemUgPSBieXRlU2l6ZXNCeURpZ2VzdC5nZXQoZW50cnkuZGVzY3JpcHRvci5kaWdlc3QpXG4gICAgICBjb25zdCBrbm93bkNvbnRlbnRUeXBlID0gY29udGVudFR5cGVzQnlEaWdlc3QuZ2V0KGVudHJ5LmRlc2NyaXB0b3IuZGlnZXN0KVxuXG4gICAgICBpZiAoa25vd25CeXRlU2l6ZSAhPT0gdW5kZWZpbmVkICYmIGtub3duQnl0ZVNpemUgIT09IGVudHJ5LmRlc2NyaXB0b3IuYnl0ZVNpemUpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBTeW5jaHJvbml6ZWQgYXNzZXQgZGlnZXN0ICR7ZW50cnkuZGVzY3JpcHRvci5kaWdlc3R9IGhhcyBpbmNvbnNpc3RlbnQgYnl0ZSBzaXplc2ApXG4gICAgICB9XG4gICAgICBpZiAoa25vd25Db250ZW50VHlwZSAhPT0gdW5kZWZpbmVkICYmIGtub3duQ29udGVudFR5cGUgIT09IGVudHJ5LmRlc2NyaXB0b3IuY29udGVudFR5cGUpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBTeW5jaHJvbml6ZWQgYXNzZXQgZGlnZXN0ICR7ZW50cnkuZGVzY3JpcHRvci5kaWdlc3R9IGhhcyBpbmNvbnNpc3RlbnQgY29udGVudCB0eXBlc2ApXG4gICAgICB9XG5cbiAgICAgIGJ5dGVTaXplc0J5RGlnZXN0LnNldChlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdCwgZW50cnkuZGVzY3JpcHRvci5ieXRlU2l6ZSlcbiAgICAgIGNvbnRlbnRUeXBlc0J5RGlnZXN0LnNldChlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdCwgZW50cnkuZGVzY3JpcHRvci5jb250ZW50VHlwZSlcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGRpZ2VzdCBvZiByZW1vdmVkRGlnZXN0cykge1xuICAgICAgaWYgKHN0YXRlLmFzc2V0cy5zb21lKChlbnRyeSkgPT4gZW50cnkuZGVzY3JpcHRvci5kaWdlc3QgPT09IGRpZ2VzdCkpIGNvbnRpbnVlXG4gICAgICBpZiAoIXN0YXRlLnBlbmRpbmdEZWxldGlvbkRpZ2VzdHMuaW5jbHVkZXMoZGlnZXN0KSkgc3RhdGUucGVuZGluZ0RlbGV0aW9uRGlnZXN0cy5wdXNoKGRpZ2VzdClcbiAgICB9XG5cbiAgICByZXR1cm4gZW50cmllc0J5SWRcbiAgfVxuXG4gIC8qKlxuICAgKiBDb3BpZXMgbWV0YWRhdGEgaW50byBhIGRldGFjaGVkIHBlcnNpc3RlbmNlIGNhbmRpZGF0ZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVTdGF0ZX0gc3RhdGUgU3RhdGUgdG8gY29weS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZVN0YXRlfSBEZXRhY2hlZCBzdGF0ZS5cbiAgICovXG4gIGNvcHlTdGF0ZShzdGF0ZSkge1xuICAgIHJldHVybiB7XG4gICAgICBhc3NldHM6IHN0YXRlLmFzc2V0cy5tYXAoKGVudHJ5KSA9PiAoe1xuICAgICAgICAuLi5lbnRyeSxcbiAgICAgICAgZGVzY3JpcHRvcjogey4uLmVudHJ5LmRlc2NyaXB0b3J9LFxuICAgICAgICBzY29wZUtleXM6IFsuLi5lbnRyeS5zY29wZUtleXNdXG4gICAgICB9KSksXG4gICAgICBwZW5kaW5nRGVsZXRpb25EaWdlc3RzOiBbLi4uc3RhdGUucGVuZGluZ0RlbGV0aW9uRGlnZXN0c10sXG4gICAgICB2ZXJzaW9uOiBzdGF0ZS52ZXJzaW9uXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFNlcmlhbGl6ZXMgb25lIG1ldGFkYXRhIHBlcnNpc3RlbmNlIG9wZXJhdGlvbiBhZnRlciBwcmlvciBmYWlsdXJlcyBvciBzdWNjZXNzZXMuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTx2b2lkPn0gcGVyc2lzdCBQZXJzaXN0ZW5jZSBvcGVyYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyBhZnRlciBwZXJzaXN0ZW5jZS5cbiAgICovXG4gIGFzeW5jIHNlcmlhbGl6ZVN0YXRlUGVyc2lzdGVuY2UocGVyc2lzdCkge1xuICAgIHRoaXMuc2F2ZVN0YXRlUHJvbWlzZSA9IHRoaXMuc2F2ZVN0YXRlUHJvbWlzZS50aGVuKHBlcnNpc3QsIHBlcnNpc3QpXG5cbiAgICBhd2FpdCB0aGlzLnNhdmVTdGF0ZVByb21pc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBFbnN1cmVzIG9uZSBkZXNjcmlwdG9yIGhhcyB2ZXJpZmllZCBsb2NhbCBieXRlcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVFbnRyeX0gZW50cnkgRGVzY3JpcHRvciBzdGF0ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8e2Vycm9yOiBFcnJvciB8IG51bGwsIHVyaTogc3RyaW5nIHwgbnVsbH0+fSBDYWNoZSByZXN1bHQuXG4gICAqL1xuICBhc3luYyBlbnN1cmVDYWNoZWQoZW50cnkpIHtcbiAgICBjb25zdCBkaWdlc3QgPSBlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdFxuXG4gICAgYXdhaXQgdGhpcy5iZWdpbkFjdGl2ZURpZ2VzdChkaWdlc3QpXG5cbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuZW5zdXJlQ2FjaGVkV2hpbGVBY3RpdmUoW2VudHJ5XSlcbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgdGhpcy5maW5pc2hBY3RpdmVEaWdlc3QoZGlnZXN0KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBvciBkb3dubG9hZHMgZGVzY3JpcHRvcnMgc2hhcmluZyBvbmUgcHJvdGVjdGVkIGRpZ2VzdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVFbnRyeVtdfSBlbnRyaWVzIERlc2NyaXB0b3Igc3RhdGVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7ZXJyb3I6IEVycm9yIHwgbnVsbCwgdXJpOiBzdHJpbmcgfCBudWxsfT59IENhY2hlIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGVuc3VyZUNhY2hlZFdoaWxlQWN0aXZlKGVudHJpZXMpIHtcbiAgICBjb25zdCBlbnRyeSA9IGVudHJpZXNbMF1cblxuICAgIGlmICghZW50cnkpIHRocm93IG5ldyBFcnJvcihcIkNhbm5vdCBjYWNoZSBhIHN5bmNocm9uaXplZCBhc3NldCBkaWdlc3Qgd2l0aG91dCBkZXNjcmlwdG9yIGVudHJpZXNcIilcblxuICAgIGNvbnN0IGV4aXN0aW5nVXJpID0gYXdhaXQgdGhpcy5jYWNoZWRVcmlXaGlsZUFjdGl2ZShlbnRyeSlcblxuICAgIGlmIChleGlzdGluZ1VyaSkge1xuICAgICAgYXdhaXQgdGhpcy5yZWNvcmRDYWNoZWRFbnRyaWVzKGVudHJpZXMpXG5cbiAgICAgIHJldHVybiB7ZXJyb3I6IG51bGwsIHVyaTogZXhpc3RpbmdVcml9XG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBkaWdlc3RFbnRyeSBvZiBlbnRyaWVzKSBkaWdlc3RFbnRyeS5zdGF0dXMgPSBcImRvd25sb2FkaW5nXCJcblxuICAgIGNvbnN0IGRpZ2VzdCA9IGVudHJ5LmRlc2NyaXB0b3IuZGlnZXN0XG4gICAgbGV0IGRvd25sb2FkUHJvbWlzZSA9IHRoaXMuZG93bmxvYWRQcm9taXNlcy5nZXQoZGlnZXN0KVxuICAgIGxldCBvd25zRG93bmxvYWRQcm9taXNlID0gZmFsc2VcblxuICAgIGlmICghZG93bmxvYWRQcm9taXNlKSB7XG4gICAgICBkb3dubG9hZFByb21pc2UgPSB0aGlzLmRvd25sb2FkQWZ0ZXJQZXJzaXN0aW5nU3RhdGUoZW50cnkuZGVzY3JpcHRvcilcbiAgICAgIHRoaXMuZG93bmxvYWRQcm9taXNlcy5zZXQoZGlnZXN0LCBkb3dubG9hZFByb21pc2UpXG4gICAgICBvd25zRG93bmxvYWRQcm9taXNlID0gdHJ1ZVxuICAgIH0gZWxzZSB7XG4gICAgICBhd2FpdCB0aGlzLnNhdmVTdGF0ZSgpXG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGNhY2hlUmVzdWx0ID0gYXdhaXQgZG93bmxvYWRQcm9taXNlXG5cbiAgICAgIGlmIChjYWNoZVJlc3VsdC5lcnJvcikge1xuICAgICAgICBpZiAoZW50cnkuc3RhdHVzID09PSBcImRvd25sb2FkaW5nXCIpIGF3YWl0IHRoaXMucmVjb3JkRG93bmxvYWRGYWlsdXJlKGRpZ2VzdClcblxuICAgICAgICByZXR1cm4gY2FjaGVSZXN1bHRcbiAgICAgIH1cblxuICAgICAgYXdhaXQgdGhpcy5yZWNvcmRDYWNoZWRFbnRyaWVzKGVudHJpZXMpXG5cbiAgICAgIHJldHVybiBjYWNoZVJlc3VsdFxuICAgIH0gZmluYWxseSB7XG4gICAgICBpZiAob3duc0Rvd25sb2FkUHJvbWlzZSAmJiB0aGlzLmRvd25sb2FkUHJvbWlzZXMuZ2V0KGRpZ2VzdCkgPT09IGRvd25sb2FkUHJvbWlzZSkge1xuICAgICAgICB0aGlzLmRvd25sb2FkUHJvbWlzZXMuZGVsZXRlKGRpZ2VzdClcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkcyBvbmUgY2FjaGVkIGRpZ2VzdCByZXN1bHQgZm9yIGV2ZXJ5IHBhcnRpY2lwYXRpbmcgZGVzY3JpcHRvci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVFbnRyeVtdfSBlbnRyaWVzIERlc2NyaXB0b3Igc3RhdGVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgYWZ0ZXIgcGVyc2lzdGVuY2UuXG4gICAqL1xuICBhc3luYyByZWNvcmRDYWNoZWRFbnRyaWVzKGVudHJpZXMpIHtcbiAgICBjb25zdCBsYXN0QWNjZXNzZWRBdCA9IHRoaXMubm93TWlsbGlzZWNvbmRzKClcblxuICAgIGZvciAoY29uc3QgZW50cnkgb2YgZW50cmllcykge1xuICAgICAgZW50cnkuYXR0ZW1wdHMgPSAwXG4gICAgICBlbnRyeS5sYXN0QWNjZXNzZWRBdCA9IGxhc3RBY2Nlc3NlZEF0XG4gICAgICBlbnRyeS5uZXh0UmV0cnlBdCA9IG51bGxcbiAgICAgIGVudHJ5LnN0YXR1cyA9IFwiY2FjaGVkXCJcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnNhdmVTdGF0ZSgpXG4gIH1cblxuICAvKipcbiAgICogUGVyc2lzdHMgZG93bmxvYWQgaW50ZW50LCB0aGVuIGRvd25sb2FkcyBvbmUgZGlnZXN0IGFuZCByZWNvcmRzIGEgc2hhcmVkIGZhaWx1cmUgb25jZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVEZXNjcmlwdG9yfSBkZXNjcmlwdG9yIEFzc2V0IGRlc2NyaXB0b3IuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHtlcnJvcjogRXJyb3IsIHVyaTogbnVsbH0gfCB7ZXJyb3I6IG51bGwsIHVyaTogc3RyaW5nfT59IFNoYXJlZCBjYWNoZSByZXN1bHQuXG4gICAqL1xuICBhc3luYyBkb3dubG9hZEFmdGVyUGVyc2lzdGluZ1N0YXRlKGRlc2NyaXB0b3IpIHtcbiAgICBhd2FpdCB0aGlzLnNhdmVTdGF0ZSgpXG5cbiAgICB0cnkge1xuICAgICAgcmV0dXJuIHtlcnJvcjogbnVsbCwgdXJpOiBhd2FpdCB0aGlzLmRvd25sb2FkVmVyaWZpZWQoZGVzY3JpcHRvcil9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnN0IGZhaWx1cmUgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSlcblxuICAgICAgYXdhaXQgdGhpcy5yZWNvcmREb3dubG9hZEZhaWx1cmUoZGVzY3JpcHRvci5kaWdlc3QpXG5cbiAgICAgIHJldHVybiB7ZXJyb3I6IGZhaWx1cmUsIHVyaTogbnVsbH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQWR2YW5jZXMgcmV0cnkgbWV0YWRhdGEgZm9yIGV2ZXJ5IGxpdmUgZGVzY3JpcHRvciBzaGFyaW5nIG9uZSBmYWlsZWQgZGlnZXN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZGlnZXN0IENvbnRlbnQgZGlnZXN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgYWZ0ZXIgcGVyc2lzdGVuY2UuXG4gICAqL1xuICBhc3luYyByZWNvcmREb3dubG9hZEZhaWx1cmUoZGlnZXN0KSB7XG4gICAgaWYgKCF0aGlzLnN0YXRlKSB0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3QgcmVjb3JkIHN5bmNocm9uaXplZCBhc3NldCBkb3dubG9hZCBmYWlsdXJlIGJlZm9yZSBsb2FkaW5nIHN0YXRlXCIpXG5cbiAgICBjb25zdCBmYWlsZWRBdCA9IHRoaXMubm93TWlsbGlzZWNvbmRzKClcblxuICAgIGZvciAoY29uc3QgZW50cnkgb2YgdGhpcy5zdGF0ZS5hc3NldHMpIHtcbiAgICAgIGlmIChlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdCAhPT0gZGlnZXN0KSBjb250aW51ZVxuICAgICAgaWYgKGVudHJ5LnN0YXR1cyAhPT0gXCJkb3dubG9hZGluZ1wiKSBjb250aW51ZVxuXG4gICAgICBlbnRyeS5hdHRlbXB0cyArPSAxXG4gICAgICBlbnRyeS5uZXh0UmV0cnlBdCA9IGZhaWxlZEF0ICsgdGhpcy5yZXRyeURlbGF5KGVudHJ5LmF0dGVtcHRzKVxuICAgICAgZW50cnkuc3RhdHVzID0gXCJmYWlsZWRcIlxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuc2F2ZVN0YXRlKClcbiAgfVxuXG4gIC8qKlxuICAgKiBEb3dubG9hZHMsIHZlcmlmaWVzLCBhbmQgYXRvbWljYWxseSBwZXJzaXN0cyBvbmUgY29udGVudCBkaWdlc3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlRGVzY3JpcHRvcn0gZGVzY3JpcHRvciBBc3NldCBkZXNjcmlwdG9yLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSBBZGFwdGVyIFVSSS5cbiAgICovXG4gIGFzeW5jIGRvd25sb2FkVmVyaWZpZWQoZGVzY3JpcHRvcikge1xuICAgIGNvbnN0IGRvd25sb2FkZWRCeXRlcyA9IGF3YWl0IHRoaXMuZG93bmxvYWQoZGVzY3JpcHRvcilcblxuICAgIGlmICghKGRvd25sb2FkZWRCeXRlcyBpbnN0YW5jZW9mIFVpbnQ4QXJyYXkpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFN5bmNocm9uaXplZCBhc3NldCAke2Rlc2NyaXB0b3IuaWR9IGRvd25sb2FkIGRpZCBub3QgcmV0dXJuIFVpbnQ4QXJyYXkgYnl0ZXNgKVxuICAgIH1cbiAgICBpZiAoZG93bmxvYWRlZEJ5dGVzLmJ5dGVMZW5ndGggIT09IGRlc2NyaXB0b3IuYnl0ZVNpemUpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgU3luY2hyb25pemVkIGFzc2V0ICR7ZGVzY3JpcHRvci5pZH0gYnl0ZSBzaXplIGRpZCBub3QgbWF0Y2ggaXRzIGRlc2NyaXB0b3JgKVxuICAgIH1cblxuICAgIGNvbnN0IGRpZ2VzdCA9IGBzaGEyNTYtJHtzaGEyNTZCeXRlc0hleChkb3dubG9hZGVkQnl0ZXMpfWBcblxuICAgIGlmIChkaWdlc3QgIT09IGRlc2NyaXB0b3IuZGlnZXN0KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFN5bmNocm9uaXplZCBhc3NldCAke2Rlc2NyaXB0b3IuaWR9IGRpZ2VzdCBkaWQgbm90IG1hdGNoIGl0cyBkZXNjcmlwdG9yYClcbiAgICB9XG5cbiAgICBjb25zdCB1cmkgPSBhd2FpdCB0aGlzLmFkYXB0ZXIud3JpdGVCbG9iKHtcbiAgICAgIGFjY291bnRJZDogdGhpcy5hY2NvdW50SWQsXG4gICAgICBieXRlczogZG93bmxvYWRlZEJ5dGVzLFxuICAgICAgY29udGVudFR5cGU6IGRlc2NyaXB0b3IuY29udGVudFR5cGUsXG4gICAgICBkaWdlc3RcbiAgICB9KVxuXG4gICAgaWYgKCF1cmkpIHRocm93IG5ldyBFcnJvcihgU3luY2hyb25pemVkIGFzc2V0IGFkYXB0ZXIgcmV0dXJuZWQgbm8gVVJJIGZvciAke2Rlc2NyaXB0b3IuaWR9YClcblxuICAgIHJldHVybiB1cmlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBhbiBleGlzdGluZyBsb2NhbCBVUkkgYWZ0ZXIgd2FpdGluZyBmb3IgZGVsZXRpb24gd29yay5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVFbnRyeX0gZW50cnkgRGVzY3JpcHRvciBzdGF0ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nIHwgbnVsbD59IEV4aXN0aW5nIFVSSS5cbiAgICovXG4gIGFzeW5jIGNhY2hlZFVyaShlbnRyeSkge1xuICAgIGNvbnN0IGRpZ2VzdCA9IGVudHJ5LmRlc2NyaXB0b3IuZGlnZXN0XG5cbiAgICBhd2FpdCB0aGlzLmJlZ2luQWN0aXZlRGlnZXN0KGRpZ2VzdClcblxuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5jYWNoZWRVcmlXaGlsZUFjdGl2ZShlbnRyeSlcbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgdGhpcy5maW5pc2hBY3RpdmVEaWdlc3QoZGlnZXN0KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBhbiBleGlzdGluZyBsb2NhbCBVUkkgd2hpbGUgaXRzIGRpZ2VzdCBpcyBwcm90ZWN0ZWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlRW50cnl9IGVudHJ5IERlc2NyaXB0b3Igc3RhdGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZyB8IG51bGw+fSBFeGlzdGluZyBVUkkuXG4gICAqL1xuICBhc3luYyBjYWNoZWRVcmlXaGlsZUFjdGl2ZShlbnRyeSkge1xuICAgIGNvbnN0IHVyaSA9IGF3YWl0IHRoaXMuYWRhcHRlci5ibG9iVXJpKHtcbiAgICAgIGFjY291bnRJZDogdGhpcy5hY2NvdW50SWQsXG4gICAgICBkaWdlc3Q6IGVudHJ5LmRlc2NyaXB0b3IuZGlnZXN0XG4gICAgfSlcblxuICAgIGlmICghdXJpICYmIGVudHJ5LnN0YXR1cyA9PT0gXCJjYWNoZWRcIikgZW50cnkuc3RhdHVzID0gXCJtaXNzaW5nXCJcblxuICAgIHJldHVybiB1cmlcbiAgfVxuXG4gIC8qKlxuICAgKiBXYWl0cyBmb3IgZGVsZXRpb24gYW5kIHByb3RlY3RzIGEgZGlnZXN0IGZvciBvbmUgYWN0aXZlIGNhY2hlIG9wZXJhdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGRpZ2VzdCBDb250ZW50IGRpZ2VzdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIGFmdGVyIHByb3RlY3Rpb24gaXMgcmVnaXN0ZXJlZC5cbiAgICovXG4gIGFzeW5jIGJlZ2luQWN0aXZlRGlnZXN0KGRpZ2VzdCkge1xuICAgIGxldCBkZWxldGlvblByb21pc2UgPSB0aGlzLmRlbGV0aW9uUHJvbWlzZXMuZ2V0KGRpZ2VzdClcblxuICAgIHdoaWxlIChkZWxldGlvblByb21pc2UpIHtcbiAgICAgIGF3YWl0IGRlbGV0aW9uUHJvbWlzZVxuICAgICAgZGVsZXRpb25Qcm9taXNlID0gdGhpcy5kZWxldGlvblByb21pc2VzLmdldChkaWdlc3QpXG4gICAgfVxuXG4gICAgY29uc3QgYWN0aXZlQ291bnQgPSB0aGlzLmFjdGl2ZURpZ2VzdENvdW50cy5nZXQoZGlnZXN0KSA/PyAwXG5cbiAgICB0aGlzLmFjdGl2ZURpZ2VzdENvdW50cy5zZXQoZGlnZXN0LCBhY3RpdmVDb3VudCArIDEpXG4gIH1cblxuICAvKipcbiAgICogUmVsZWFzZXMgb25lIGNhY2hlIG9wZXJhdGlvbiBhbmQgcHJvY2Vzc2VzIGRlZmVycmVkIGRlbGV0aW9uIGFmdGVyIHRoZSBsYXN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZGlnZXN0IENvbnRlbnQgZGlnZXN0LlxuICAgKiBAcGFyYW0ge1NldDxzdHJpbmc+fSBbcHJvdGVjdGVkQ2xlYW51cERpZ2VzdHNdIERpZ2VzdHMgbmVlZGVkIGJ5IHRoZSByZXNvbHZpbmcgY2FsbGVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgYWZ0ZXIgYW55IHBlbmRpbmcgZGVsZXRpb24uXG4gICAqL1xuICBhc3luYyBmaW5pc2hBY3RpdmVEaWdlc3QoZGlnZXN0LCBwcm90ZWN0ZWRDbGVhbnVwRGlnZXN0cyA9IG5ldyBTZXQoKSkge1xuICAgIGNvbnN0IGFjdGl2ZUNvdW50ID0gdGhpcy5hY3RpdmVEaWdlc3RDb3VudHMuZ2V0KGRpZ2VzdClcblxuICAgIGlmIChhY3RpdmVDb3VudCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE1pc3NpbmcgYWN0aXZlIHN5bmNocm9uaXplZCBhc3NldCBkaWdlc3QgY291bnQgZm9yICR7ZGlnZXN0fWApXG4gICAgfVxuXG4gICAgaWYgKGFjdGl2ZUNvdW50ID4gMSkge1xuICAgICAgdGhpcy5hY3RpdmVEaWdlc3RDb3VudHMuc2V0KGRpZ2VzdCwgYWN0aXZlQ291bnQgLSAxKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdGhpcy5hY3RpdmVEaWdlc3RDb3VudHMuZGVsZXRlKGRpZ2VzdClcbiAgICBhd2FpdCB0aGlzLmRlbGV0ZVBlbmRpbmdEaWdlc3RJZlVucmVmZXJlbmNlZChkaWdlc3QpXG5cbiAgICBpZiAodGhpcy5jbGVhbnVwUmVxdWlyZWRBZnRlclJlbGVhc2VEaWdlc3RzLmRlbGV0ZShkaWdlc3QpKSB7XG4gICAgICBhd2FpdCB0aGlzLmNsZWFudXAocHJvdGVjdGVkQ2xlYW51cERpZ2VzdHMpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlbGVhc2VzIGV2ZXJ5IGFjcXVpcmVkIGRpZ2VzdCBiZWZvcmUgcHJvcGFnYXRpbmcgZmluYWxpemF0aW9uIGZhaWx1cmVzLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBkaWdlc3RzIENvbnRlbnQgZGlnZXN0cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIGFmdGVyIGV2ZXJ5IGRpZ2VzdCBpcyByZWxlYXNlZC5cbiAgICovXG4gIGFzeW5jIGZpbmlzaEFjdGl2ZURpZ2VzdHMoZGlnZXN0cykge1xuICAgIC8qKiBAdHlwZSB7RXJyb3JbXX0gKi9cbiAgICBjb25zdCBmYWlsdXJlcyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IGRpZ2VzdCBvZiBkaWdlc3RzKSB7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLmZpbmlzaEFjdGl2ZURpZ2VzdChkaWdlc3QpXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBmYWlsdXJlcy5wdXNoKGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoZmFpbHVyZXMubGVuZ3RoID09PSAxKSB0aHJvdyBmYWlsdXJlc1swXVxuICAgIGlmIChmYWlsdXJlcy5sZW5ndGggPiAxKSB7XG4gICAgICB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoZmFpbHVyZXMsIFwiTXVsdGlwbGUgc3luY2hyb25pemVkIGFzc2V0IGRpZ2VzdCBmaW5hbGl6ZXJzIGZhaWxlZFwiLCB7Y2F1c2U6IGZhaWx1cmVzWzBdfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRGVsZXRlcyBibG9icyB0aGF0IGxvc3QgdGhlaXIgZmluYWwgZGVzY3JpcHRvciByZWZlcmVuY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyBhZnRlciBkZWxldGlvbi5cbiAgICovXG4gIGFzeW5jIGRlbGV0ZVVucmVmZXJlbmNlZERpZ2VzdHMoKSB7XG4gICAgaWYgKCF0aGlzLnN0YXRlKSB0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3QgZGVsZXRlIHN5bmNocm9uaXplZCBhc3NldCBibG9icyBiZWZvcmUgbG9hZGluZyBzdGF0ZVwiKVxuXG4gICAgZm9yIChjb25zdCBkaWdlc3Qgb2YgWy4uLnRoaXMuc3RhdGUucGVuZGluZ0RlbGV0aW9uRGlnZXN0c10pIHtcbiAgICAgIGF3YWl0IHRoaXMuZGVsZXRlUGVuZGluZ0RpZ2VzdElmVW5yZWZlcmVuY2VkKGRpZ2VzdClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRGVsZXRlcyBvbmUgcGVyc2lzdGVkIHBlbmRpbmcgZGlnZXN0IHdoZW4gbm8gZGVzY3JpcHRvciBvciBhY3RpdmUgb3BlcmF0aW9uIG93bnMgaXQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBkaWdlc3QgQ29udGVudCBkaWdlc3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyBhZnRlciBhbnkgcmVxdWlyZWQgZGVsZXRpb24uXG4gICAqL1xuICBhc3luYyBkZWxldGVQZW5kaW5nRGlnZXN0SWZVbnJlZmVyZW5jZWQoZGlnZXN0KSB7XG4gICAgaWYgKCF0aGlzLnN0YXRlKSB0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3QgZGVsZXRlIHN5bmNocm9uaXplZCBhc3NldCBibG9icyBiZWZvcmUgbG9hZGluZyBzdGF0ZVwiKVxuICAgIGlmICghdGhpcy5zdGF0ZS5wZW5kaW5nRGVsZXRpb25EaWdlc3RzLmluY2x1ZGVzKGRpZ2VzdCkpIHJldHVyblxuXG4gICAgYXdhaXQgdGhpcy5kZWxldGVEaWdlc3RJZkluYWN0aXZlKGRpZ2VzdCwgYXN5bmMgKCkgPT4ge1xuICAgICAgaWYgKCF0aGlzLnN0YXRlKSB0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3QgZGVsZXRlIHN5bmNocm9uaXplZCBhc3NldCBibG9icyBiZWZvcmUgbG9hZGluZyBzdGF0ZVwiKVxuICAgICAgaWYgKCF0aGlzLnN0YXRlLnBlbmRpbmdEZWxldGlvbkRpZ2VzdHMuaW5jbHVkZXMoZGlnZXN0KSkgcmV0dXJuIGZhbHNlXG5cbiAgICAgIGxldCBkZWxldGVkID0gZmFsc2VcblxuICAgICAgaWYgKCF0aGlzLnN0YXRlLmFzc2V0cy5zb21lKChlbnRyeSkgPT4gZW50cnkuZGVzY3JpcHRvci5kaWdlc3QgPT09IGRpZ2VzdCkpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5hZGFwdGVyLmRlbGV0ZUJsb2Ioe2FjY291bnRJZDogdGhpcy5hY2NvdW50SWQsIGRpZ2VzdH0pXG4gICAgICAgIGRlbGV0ZWQgPSB0cnVlXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHBlbmRpbmdEZWxldGlvbkRpZ2VzdHMgPSB0aGlzLnN0YXRlLnBlbmRpbmdEZWxldGlvbkRpZ2VzdHNcblxuICAgICAgdGhpcy5zdGF0ZS5wZW5kaW5nRGVsZXRpb25EaWdlc3RzID0gcGVuZGluZ0RlbGV0aW9uRGlnZXN0cy5maWx0ZXIoKGNhbmRpZGF0ZSkgPT4gY2FuZGlkYXRlICE9PSBkaWdlc3QpXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMuc2F2ZVN0YXRlKClcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGlmICghdGhpcy5zdGF0ZS5wZW5kaW5nRGVsZXRpb25EaWdlc3RzLmluY2x1ZGVzKGRpZ2VzdCkpIHRoaXMuc3RhdGUucGVuZGluZ0RlbGV0aW9uRGlnZXN0cy5wdXNoKGRpZ2VzdClcbiAgICAgICAgdGhyb3cgZXJyb3JcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGRlbGV0ZWRcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgb25lIGRlbGV0aW9uIG9ubHkgYWZ0ZXIgZWFybGllciBkZWxldGlvbiB3b3JrIGFuZCB3aGVuIG5vIGNhY2hlIG9wZXJhdGlvbiBvd25zIHRoZSBkaWdlc3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBkaWdlc3QgQ29udGVudCBkaWdlc3QuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxib29sZWFuPn0gY2FsbGJhY2sgUHJvdGVjdGVkIGRlbGV0aW9uIGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gV2hldGhlciB0aGUgY2FsbGJhY2sgZGVsZXRlZCB0aGUgYmxvYi5cbiAgICovXG4gIGFzeW5jIGRlbGV0ZURpZ2VzdElmSW5hY3RpdmUoZGlnZXN0LCBjYWxsYmFjaykge1xuICAgIGxldCBhY3RpdmVEZWxldGlvblByb21pc2UgPSB0aGlzLmRlbGV0aW9uUHJvbWlzZXMuZ2V0KGRpZ2VzdClcblxuICAgIHdoaWxlIChhY3RpdmVEZWxldGlvblByb21pc2UpIHtcbiAgICAgIGF3YWl0IGFjdGl2ZURlbGV0aW9uUHJvbWlzZVxuICAgICAgYWN0aXZlRGVsZXRpb25Qcm9taXNlID0gdGhpcy5kZWxldGlvblByb21pc2VzLmdldChkaWdlc3QpXG4gICAgfVxuXG4gICAgaWYgKHRoaXMuYWN0aXZlRGlnZXN0Q291bnRzLmhhcyhkaWdlc3QpKSByZXR1cm4gZmFsc2VcblxuICAgIC8qKlxuICAgICAqIFJlbGVhc2VzIGNhbGxlcnMgd2FpdGluZyBmb3IgZGVsZXRpb24gY29tcGxldGlvbi5cbiAgICAgKiBAdHlwZSB7KCkgPT4gdm9pZH1cbiAgICAgKi9cbiAgICBsZXQgcmVsZWFzZURlbGV0aW9uID0gKCkgPT4ge31cbiAgICAvKipcbiAgICAgKiBCbG9ja3MgbmV3IGRpZ2VzdCBhY3Rpdml0eSB1bnRpbCBkZWxldGlvbiBjb21wbGV0ZXMuXG4gICAgICogQHR5cGUge1Byb21pc2U8dm9pZD59XG4gICAgICovXG4gICAgY29uc3QgZGVsZXRpb25Qcm9taXNlID0gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICAgIHJlbGVhc2VEZWxldGlvbiA9ICgpID0+IHJlc29sdmUodW5kZWZpbmVkKVxuICAgIH0pXG5cbiAgICB0aGlzLmRlbGV0aW9uUHJvbWlzZXMuc2V0KGRpZ2VzdCwgZGVsZXRpb25Qcm9taXNlKVxuXG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBhd2FpdCBjYWxsYmFjaygpXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGlmICh0aGlzLmRlbGV0aW9uUHJvbWlzZXMuZ2V0KGRpZ2VzdCkgPT09IGRlbGV0aW9uUHJvbWlzZSkgdGhpcy5kZWxldGlvblByb21pc2VzLmRlbGV0ZShkaWdlc3QpXG4gICAgICByZWxlYXNlRGVsZXRpb24oKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBGaW5kcyByZXF1aXJlZCBhc3NldHMgd2l0aG91dCBsb2NhbGx5IGNhY2hlZCBieXRlcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNjb3BlS2V5IFN5bmNocm9uaXplZCBzY29wZSB0byBpbnNwZWN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmdbXT59IE1pc3NpbmcgcmVxdWlyZWQgZGVzY3JpcHRvciBpZHMuXG4gICAqL1xuICBhc3luYyBtaXNzaW5nUmVxdWlyZWRBc3NldElkcyhzY29wZUtleSkge1xuICAgIGNvbnN0IHN0YXRlID0gYXdhaXQgdGhpcy5sb2FkU3RhdGUoKVxuICAgIC8qKiBAdHlwZSB7c3RyaW5nW119ICovXG4gICAgY29uc3QgbWlzc2luZ0Fzc2V0SWRzID0gW11cblxuICAgIGZvciAoY29uc3QgZW50cnkgb2Ygc3RhdGUuYXNzZXRzKSB7XG4gICAgICBpZiAoIWVudHJ5LnNjb3BlS2V5cy5pbmNsdWRlcyhzY29wZUtleSkpIGNvbnRpbnVlXG4gICAgICBpZiAoZW50cnkuZGVzY3JpcHRvci5vZmZsaW5lUmVxdWlyZW1lbnQgIT09IFwicmVxdWlyZWRcIikgY29udGludWVcbiAgICAgIGlmIChhd2FpdCB0aGlzLmNhY2hlZFVyaShlbnRyeSkpIGNvbnRpbnVlXG5cbiAgICAgIG1pc3NpbmdBc3NldElkcy5wdXNoKGVudHJ5LmRlc2NyaXB0b3IuaWQpXG4gICAgfVxuXG4gICAgcmV0dXJuIG1pc3NpbmdBc3NldElkc1xuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrcyB3aGV0aGVyIGEgZmFpbGVkIG9yIG1pc3NpbmcgZW50cnkgbWF5IGJlIGRvd25sb2FkZWQgbm93LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZUVudHJ5fSBlbnRyeSBEZXNjcmlwdG9yIHN0YXRlLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gV2hldGhlciB0aGUgcmV0cnkgZGVhZGxpbmUgaGFzIHBhc3NlZC5cbiAgICovXG4gIHJldHJ5RWxpZ2libGUoZW50cnkpIHtcbiAgICByZXR1cm4gZW50cnkuc3RhdHVzICE9PSBcImZhaWxlZFwiIHx8IGVudHJ5Lm5leHRSZXRyeUF0ID09PSBudWxsIHx8IGVudHJ5Lm5leHRSZXRyeUF0IDw9IHRoaXMubm93TWlsbGlzZWNvbmRzKClcbiAgfVxuXG4gIC8qKlxuICAgKiBDYWxjdWxhdGVzIGJvdW5kZWQgZXhwb25lbnRpYWwgcmV0cnkgZGVsYXkuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhdHRlbXB0cyBDb25zZWN1dGl2ZSBmYWlsdXJlcy5cbiAgICogQHJldHVybnMge251bWJlcn0gUmV0cnkgZGVsYXkuXG4gICAqL1xuICByZXRyeURlbGF5KGF0dGVtcHRzKSB7XG4gICAgcmV0dXJuIE1hdGgubWluKHRoaXMucmV0cnlNYXhEZWxheU1zLCB0aGlzLnJldHJ5QmFzZURlbGF5TXMgKiAoMiAqKiBNYXRoLm1heCgwLCBhdHRlbXB0cyAtIDEpKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkcyB0aGUgaW5qZWN0YWJsZSB3YWxsIGNsb2NrLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSBDdXJyZW50IGVwb2NoIG1pbGxpc2Vjb25kcy5cbiAgICovXG4gIG5vd01pbGxpc2Vjb25kcygpIHtcbiAgICByZXR1cm4gdGhpcy5ub3coKS5nZXRUaW1lKClcbiAgfVxufVxuIl19