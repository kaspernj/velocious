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
        const requiresUnprotectedCleanup = shouldCleanup || (entry.descriptor.byteSize > this.maxBytes && !state.assets.some((candidate) => {
            return candidate.descriptor.digest === digest && candidate.descriptor.retention === "durable";
        }));
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2FjaGUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvc3luYy9hc3NldHMvY2FjaGUuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sY0FBYyxNQUFNLGlDQUFpQyxDQUFBO0FBRTVELE1BQU0sbUJBQW1CLEdBQUcsQ0FBQyxDQUFBO0FBQzdCLE1BQU0sMkJBQTJCLEdBQUcsSUFBSSxDQUFBO0FBQ3hDLE1BQU0sMEJBQTBCLEdBQUcsSUFBSSxHQUFHLEVBQUUsR0FBRyxDQUFDLENBQUE7QUFFaEQ7OztHQUdHO0FBQ0gsTUFBTSxDQUFDLE9BQU8sT0FBTyxzQkFBc0I7SUFDekM7Ozs7Ozs7Ozs7T0FVRztJQUNILFlBQVksRUFBQyxTQUFTLEVBQUUsT0FBTyxFQUFFLFFBQVEsRUFBRSxRQUFRLEVBQUUsR0FBRyxHQUFHLEdBQUcsRUFBRSxDQUFDLElBQUksSUFBSSxFQUFFLEVBQUUsZ0JBQWdCLEdBQUcsMkJBQTJCLEVBQUUsZUFBZSxHQUFHLDBCQUEwQixFQUFDO1FBQ3hLLElBQUksQ0FBQyxTQUFTO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxpREFBaUQsQ0FBQyxDQUFBO1FBQ2xGLElBQUksQ0FBQyxNQUFNLENBQUMsYUFBYSxDQUFDLFFBQVEsQ0FBQyxJQUFJLFFBQVEsR0FBRyxDQUFDO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyx1RUFBdUUsQ0FBQyxDQUFBO1FBQzdJLElBQUksQ0FBQyxNQUFNLENBQUMsYUFBYSxDQUFDLGdCQUFnQixDQUFDLElBQUksZ0JBQWdCLEdBQUcsQ0FBQztZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsMkVBQTJFLENBQUMsQ0FBQTtRQUNqSyxJQUFJLENBQUMsTUFBTSxDQUFDLGFBQWEsQ0FBQyxlQUFlLENBQUMsSUFBSSxlQUFlLEdBQUcsZ0JBQWdCO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyw0RUFBNEUsQ0FBQyxDQUFBO1FBRS9LLElBQUksQ0FB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VSxDQUFDLGtCQUFrQixLQUFLLFVBQVU7Z0JBQUUsU0FBUTtZQUNoRSxJQUFJLE1BQU0sSUFBSSxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUM7Z0JBQUUsU0FBUTtZQUV6QyxlQUFlLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsRUFBRSxDQUFDLENBQUE7UUFDM0MsQ0FBQztRQUVELE9BQU8sZUFBZSxDQUFBO0lBQ3hCLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsYUFBYSxDQUFDLEtBQUs7UUFDakIsT0FBTyxLQUFLLENBQUMsTUFBTSxLQUFLLFFBQVEsSUFBSSxLQUFLLENBQUMsV0FBVyxLQUFLLElBQUksSUFBSSxLQUFLLENBQUMsV0FBVyxJQUFJLElBQUksQ0FBQyxlQUFlLEVBQUUsQ0FBQTtJQUMvRyxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILFVBQVUsQ0FBQyxRQUFRO1FBQ2pCLE9BQU8sSUFBSSxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsZUFBZSxFQUFFLElBQUksQ0FBQyxnQkFBZ0IsR0FBRyxDQUFDLENBQUMsSUFBSSxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsRUFBRSxRQUFRLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFBO0lBQ2pHLENBQUM7SUFFRDs7O09BR0c7SUFDSCxlQUFlO1FBQ2IsT0FBTyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUMsT0FBTyxFQUFFLENBQUE7SUFDN0IsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBzaGEyNTZCeXRlc0hleCBmcm9tIFwiLi4vLi4vdXRpbHMvc2hhMjU2LWJ5dGVzLWhleC5qc1wiXG5cbmNvbnN0IENBQ0hFX1NUQVRFX1ZFUlNJT04gPSAxXG5jb25zdCBERUZBVUxUX1JFVFJZX0JBU0VfREVMQVlfTVMgPSAxMDAwXG5jb25zdCBERUZBVUxUX1JFVFJZX01BWF9ERUxBWV9NUyA9IDEwMDAgKiA2MCAqIDVcblxuLyoqXG4gKiBDb3JlIHN5bmNocm9uaXplZCBhc3NldCBjYWNoZS4gUGxhdGZvcm0gcGFja2FnZXMgb3duIGJ5dGUgYW5kIG1ldGFkYXRhXG4gKiBwZXJzaXN0ZW5jZSB3aGlsZSB0aGlzIGNsYXNzIG93bnMgcG9saWN5LCBpbnRlZ3JpdHksIGFuZCBsaWZlY3ljbGUuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFN5bmNocm9uaXplZEFzc2V0Q2FjaGUge1xuICAvKipcbiAgICogQ3JlYXRlcyBhIHN5bmNocm9uaXplZCBhc3NldCBjYWNoZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuYWNjb3VudElkIEF1dGhlbnRpY2F0ZWQgYWNjb3VudCBuYW1lc3BhY2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlQWRhcHRlcn0gYXJncy5hZGFwdGVyIFBsYXRmb3JtIHN0b3JhZ2UgYWRhcHRlci5cbiAgICogQHBhcmFtIHsoZGVzY3JpcHRvcjogaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlRGVzY3JpcHRvcikgPT4gUHJvbWlzZTxVaW50OEFycmF5Pn0gYXJncy5kb3dubG9hZCBBdXRoZW50aWNhdGVkIGJ5dGUgZG93bmxvYWRlci5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MubWF4Qnl0ZXMgTWF4aW11bSBldmljdGFibGUgY2FjaGUgc2l6ZS5cbiAgICogQHBhcmFtIHsoKSA9PiBEYXRlfSBbYXJncy5ub3ddIENsb2NrLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MucmV0cnlCYXNlRGVsYXlNc10gSW5pdGlhbCByZXRyeSBkZWxheS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLnJldHJ5TWF4RGVsYXlNc10gTWF4aW11bSByZXRyeSBkZWxheS5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHthY2NvdW50SWQsIGFkYXB0ZXIsIGRvd25sb2FkLCBtYXhCeXRlcywgbm93ID0gKCkgPT4gbmV3IERhdGUoKSwgcmV0cnlCYXNlRGVsYXlNcyA9IERFRkFVTFRfUkVUUllfQkFTRV9ERUxBWV9NUywgcmV0cnlNYXhEZWxheU1zID0gREVGQVVMVF9SRVRSWV9NQVhfREVMQVlfTVN9KSB7XG4gICAgaWYgKCFhY2NvdW50SWQpIHRocm93IG5ldyBFcnJvcihcIlN5bmNocm9uaXplZCBhc3NldCBjYWNoZSByZXF1aXJlcyBhbiBhY2NvdW50IGlkXCIpXG4gICAgaWYgKCFOdW1iZXIuaXNTYWZlSW50ZWdlcihtYXhCeXRlcykgfHwgbWF4Qnl0ZXMgPCAwKSB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jaHJvbml6ZWQgYXNzZXQgY2FjaGUgbWF4Qnl0ZXMgbXVzdCBiZSBhIG5vbi1uZWdhdGl2ZSBzYWZlIGludGVnZXJcIilcbiAgICBpZiAoIU51bWJlci5pc1NhZmVJbnRlZ2VyKHJldHJ5QmFzZURlbGF5TXMpIHx8IHJldHJ5QmFzZURlbGF5TXMgPCAxKSB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jaHJvbml6ZWQgYXNzZXQgY2FjaGUgcmV0cnlCYXNlRGVsYXlNcyBtdXN0IGJlIGEgcG9zaXRpdmUgc2FmZSBpbnRlZ2VyXCIpXG4gICAgaWYgKCFOdW1iZXIuaXNTYWZlSW50ZWdlcihyZXRyeU1heERlbGF5TXMpIHx8IHJldHJ5TWF4RGVsYXlNcyA8IHJldHJ5QmFzZURlbGF5TXMpIHRocm93IG5ldyBFcnJvcihcIlN5bmNocm9uaXplZCBhc3NldCBjYWNoZSByZXRyeU1heERlbGF5TXMgbXVzdCBiZSBhdCBsZWFzdCByZXRyeUJhc2VEZWxheU1zXCIpXG5cbiAgICB0aGlzLmFjY291bnRJZCA9IGFjY291bnRJZFxuICAgIHRoaXMuYWRhcHRlciA9IGFkYXB0ZXJcbiAgICB0aGlzLmRvd25sb2FkID0gZG93bmxvYWRcbiAgICB0aGlzLm1heEJ5dGVzID0gbWF4Qnl0ZXNcbiAgICB0aGlzLm5vdyA9IG5vd1xuICAgIHRoaXMucmV0cnlCYXNlRGVsYXlNcyA9IHJldHJ5QmFzZURlbGF5TXNcbiAgICB0aGlzLnJldHJ5TWF4RGVsYXlNcyA9IHJldHJ5TWF4RGVsYXlNc1xuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgbnVtYmVyPn0gKi9cbiAgICB0aGlzLmFjdGl2ZURpZ2VzdENvdW50cyA9IG5ldyBNYXAoKVxuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgUHJvbWlzZTx2b2lkPj59ICovXG4gICAgdGhpcy5kZWxldGlvblByb21pc2VzID0gbmV3IE1hcCgpXG4gICAgLyoqIEB0eXBlIHtTZXQ8c3RyaW5nPn0gKi9cbiAgICB0aGlzLmNsZWFudXBSZXF1aXJlZEFmdGVyUmVsZWFzZURpZ2VzdHMgPSBuZXcgU2V0KClcbiAgICAvKiogQHR5cGUge1Byb21pc2U8bnVtYmVyPn0gKi9cbiAgICB0aGlzLmNsZWFudXBQcm9taXNlID0gUHJvbWlzZS5yZXNvbHZlKDApXG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBQcm9taXNlPHtlcnJvcjogRXJyb3IsIHVyaTogbnVsbH0gfCB7ZXJyb3I6IG51bGwsIHVyaTogc3RyaW5nfT4+fSAqL1xuICAgIHRoaXMuZG93bmxvYWRQcm9taXNlcyA9IG5ldyBNYXAoKVxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlU3RhdGUgfCBudWxsfSAqL1xuICAgIHRoaXMuc3RhdGUgPSBudWxsXG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZVN0YXRlPiB8IG51bGx9ICovXG4gICAgdGhpcy5zdGF0ZVByb21pc2UgPSBudWxsXG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+fSAqL1xuICAgIHRoaXMuc2F2ZVN0YXRlUHJvbWlzZSA9IFByb21pc2UucmVzb2x2ZSgpXG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZVN5bmNocm9uaXphdGlvblJlc3VsdD4+fSAqL1xuICAgIHRoaXMuc3luY2hyb25pemVQcm9taXNlcyA9IG5ldyBNYXAoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlY29uY2lsZXMgdGhlIGltbXV0YWJsZSBkZXNjcmlwdG9ycyBmb3Igb25lIHN5bmNocm9uaXplZCBzY29wZSBhbmRcbiAgICogZG93bmxvYWRzIGVsaWdpYmxlIGVhZ2VyIGFzc2V0cy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgUmVjb25jaWxpYXRpb24gaW5wdXRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZURlc2NyaXB0b3JbXX0gYXJncy5kZXNjcmlwdG9ycyBDdXJyZW50IGRlc2NyaXB0b3JzIGluIHRoZSBzY29wZS5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLm9ubGluZSBXaGV0aGVyIGF1dGhlbnRpY2F0ZWQgZG93bmxvYWRzIGFyZSBhdmFpbGFibGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnNjb3BlS2V5IFN0YWJsZSBzeW5jaHJvbml6ZWQgc2NvcGUga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVTeW5jaHJvbml6YXRpb25SZXN1bHQ+fSBTeW5jaHJvbml6YXRpb24gcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgc3luY2hyb25pemUoe2Rlc2NyaXB0b3JzLCBvbmxpbmUsIHNjb3BlS2V5fSkge1xuICAgIGNvbnN0IHN5bmNocm9uaXplID0gYXN5bmMgKCkgPT4gYXdhaXQgdGhpcy5zeW5jaHJvbml6ZVNjb3BlKHtkZXNjcmlwdG9ycywgb25saW5lLCBzY29wZUtleX0pXG4gICAgY29uc3QgcHJldmlvdXNTeW5jaHJvbml6YXRpb25Qcm9taXNlID0gdGhpcy5zeW5jaHJvbml6ZVByb21pc2VzLmdldChzY29wZUtleSlcbiAgICBjb25zdCBzeW5jaHJvbml6YXRpb25Qcm9taXNlID0gcHJldmlvdXNTeW5jaHJvbml6YXRpb25Qcm9taXNlXG4gICAgICA/IHByZXZpb3VzU3luY2hyb25pemF0aW9uUHJvbWlzZS50aGVuKHN5bmNocm9uaXplLCBzeW5jaHJvbml6ZSlcbiAgICAgIDogc3luY2hyb25pemUoKVxuXG4gICAgdGhpcy5zeW5jaHJvbml6ZVByb21pc2VzLnNldChzY29wZUtleSwgc3luY2hyb25pemF0aW9uUHJvbWlzZSlcblxuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgc3luY2hyb25pemF0aW9uUHJvbWlzZVxuICAgIH0gZmluYWxseSB7XG4gICAgICBpZiAodGhpcy5zeW5jaHJvbml6ZVByb21pc2VzLmdldChzY29wZUtleSkgPT09IHN5bmNocm9uaXphdGlvblByb21pc2UpIHtcbiAgICAgICAgdGhpcy5zeW5jaHJvbml6ZVByb21pc2VzLmRlbGV0ZShzY29wZUtleSlcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBvbmUgc2NvcGUgc3luY2hyb25pemF0aW9uIGFmdGVyIHByaW9yIGNhbGxzIGZvciB0aGF0IHNjb3BlIGZpbmlzaC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgUmVjb25jaWxpYXRpb24gaW5wdXRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZURlc2NyaXB0b3JbXX0gYXJncy5kZXNjcmlwdG9ycyBDdXJyZW50IGRlc2NyaXB0b3JzIGluIHRoZSBzY29wZS5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLm9ubGluZSBXaGV0aGVyIGF1dGhlbnRpY2F0ZWQgZG93bmxvYWRzIGFyZSBhdmFpbGFibGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnNjb3BlS2V5IFN0YWJsZSBzeW5jaHJvbml6ZWQgc2NvcGUga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVTeW5jaHJvbml6YXRpb25SZXN1bHQ+fSBTeW5jaHJvbml6YXRpb24gcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgc3luY2hyb25pemVTY29wZSh7ZGVzY3JpcHRvcnMsIG9ubGluZSwgc2NvcGVLZXl9KSB7XG4gICAgYXdhaXQgdGhpcy5sb2FkU3RhdGUoKVxuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlRGVzY3JpcHRvcltdPn0gKi9cbiAgICBjb25zdCBkZXNjcmlwdG9yc0J5RGlnZXN0ID0gbmV3IE1hcCgpXG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVGYWlsdXJlW119ICovXG4gICAgY29uc3QgZmFpbHVyZXMgPSBbXVxuICAgIC8qKiBAdHlwZSB7U2V0PHN0cmluZz59ICovXG4gICAgY29uc3QgYWN0aXZlRGlnZXN0cyA9IG5ldyBTZXQoKVxuXG4gICAgZm9yIChjb25zdCBkZXNjcmlwdG9yIG9mIGRlc2NyaXB0b3JzKSB7XG4gICAgICBjb25zdCBkaWdlc3REZXNjcmlwdG9ycyA9IGRlc2NyaXB0b3JzQnlEaWdlc3QuZ2V0KGRlc2NyaXB0b3IuZGlnZXN0KSB8fCBbXVxuXG4gICAgICBkaWdlc3REZXNjcmlwdG9ycy5wdXNoKGRlc2NyaXB0b3IpXG4gICAgICBkZXNjcmlwdG9yc0J5RGlnZXN0LnNldChkZXNjcmlwdG9yLmRpZ2VzdCwgZGlnZXN0RGVzY3JpcHRvcnMpXG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGZvciAoY29uc3QgZGlnZXN0IG9mIGRlc2NyaXB0b3JzQnlEaWdlc3Qua2V5cygpKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuYmVnaW5BY3RpdmVEaWdlc3QoZGlnZXN0KVxuICAgICAgICBhY3RpdmVEaWdlc3RzLmFkZChkaWdlc3QpXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGVudHJpZXNCeUlkID0gYXdhaXQgdGhpcy5yZWNvbmNpbGVEZXNjcmlwdG9ycyh7ZGVzY3JpcHRvcnMsIHNjb3BlS2V5fSlcblxuICAgICAgYXdhaXQgdGhpcy5kZWxldGVVbnJlZmVyZW5jZWREaWdlc3RzKClcblxuICAgICAgZm9yIChjb25zdCBbZGlnZXN0LCBkaWdlc3REZXNjcmlwdG9yc10gb2YgZGVzY3JpcHRvcnNCeURpZ2VzdCkge1xuICAgICAgICBjb25zdCBlYWdlckRlc2NyaXB0b3JzID0gb25saW5lID8gZGlnZXN0RGVzY3JpcHRvcnMuZmlsdGVyKChkZXNjcmlwdG9yKSA9PiBkZXNjcmlwdG9yLmZldGNoID09PSBcImVhZ2VyXCIpIDogW11cblxuICAgICAgICBpZiAoZWFnZXJEZXNjcmlwdG9ycy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICBhY3RpdmVEaWdlc3RzLmRlbGV0ZShkaWdlc3QpXG4gICAgICAgICAgYXdhaXQgdGhpcy5maW5pc2hBY3RpdmVEaWdlc3QoZGlnZXN0KVxuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH1cblxuICAgICAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZUVudHJ5W119ICovXG4gICAgICAgIGNvbnN0IGVhZ2VyRW50cmllcyA9IFtdXG5cbiAgICAgICAgZm9yIChjb25zdCBkZXNjcmlwdG9yIG9mIGVhZ2VyRGVzY3JpcHRvcnMpIHtcbiAgICAgICAgICBjb25zdCBlbnRyeSA9IGVudHJpZXNCeUlkLmdldChkZXNjcmlwdG9yLmlkKVxuXG4gICAgICAgICAgaWYgKCFlbnRyeSkgdGhyb3cgbmV3IEVycm9yKGBNaXNzaW5nIHJlY29uY2lsZWQgc3luY2hyb25pemVkIGFzc2V0IGRlc2NyaXB0b3IgJHtkZXNjcmlwdG9yLmlkfWApXG5cbiAgICAgICAgICBlYWdlckVudHJpZXMucHVzaChlbnRyeSlcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChlYWdlckVudHJpZXMuc29tZSgoZW50cnkpID0+IHRoaXMucmV0cnlFbGlnaWJsZShlbnRyeSkpKSB7XG4gICAgICAgICAgY29uc3QgY2FjaGVSZXN1bHQgPSBhd2FpdCB0aGlzLmVuc3VyZUNhY2hlZFdoaWxlQWN0aXZlKGVhZ2VyRW50cmllcylcblxuICAgICAgICAgIGlmIChjYWNoZVJlc3VsdC5lcnJvcikge1xuICAgICAgICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiBlYWdlckVudHJpZXMpIHtcbiAgICAgICAgICAgICAgZmFpbHVyZXMucHVzaCh7YXNzZXRJZDogZW50cnkuZGVzY3JpcHRvci5pZCwgZXJyb3I6IGNhY2hlUmVzdWx0LmVycm9yfSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBhY3RpdmVEaWdlc3RzLmRlbGV0ZShkaWdlc3QpXG4gICAgICAgIGF3YWl0IHRoaXMuZmluaXNoQWN0aXZlRGlnZXN0KGRpZ2VzdClcbiAgICAgICAgYXdhaXQgdGhpcy5jbGVhbnVwKClcbiAgICAgIH1cbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgdGhpcy5maW5pc2hBY3RpdmVEaWdlc3RzKFsuLi5hY3RpdmVEaWdlc3RzXSlcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLmNsZWFudXAoKVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGZhaWx1cmVzLFxuICAgICAgbWlzc2luZ1JlcXVpcmVkQXNzZXRJZHM6IGF3YWl0IHRoaXMubWlzc2luZ1JlcXVpcmVkQXNzZXRJZHMoc2NvcGVLZXkpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGEgY2FjaGVkIGFzc2V0IFVSSSwgZG93bmxvYWRpbmcgaXQgb24gZGVtYW5kIHdoZW4gYWxsb3dlZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgUmVzb2x1dGlvbiBpbnB1dHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmFzc2V0SWQgQXR0YWNobWVudCBkZXNjcmlwdG9yIGlkLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3Mub25saW5lIFdoZXRoZXIgYXV0aGVudGljYXRlZCBkb3dubG9hZHMgYXJlIGF2YWlsYWJsZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nIHwgbnVsbD59IENhY2hlZCBhc3NldCBVUkkuXG4gICAqL1xuICBhc3luYyByZXNvbHZlKHthc3NldElkLCBvbmxpbmV9KSB7XG4gICAgY29uc3Qgc3RhdGUgPSBhd2FpdCB0aGlzLmxvYWRTdGF0ZSgpXG4gICAgY29uc3QgZW50cnkgPSBzdGF0ZS5hc3NldHMuZmluZCgoY2FuZGlkYXRlKSA9PiBjYW5kaWRhdGUuZGVzY3JpcHRvci5pZCA9PT0gYXNzZXRJZClcblxuICAgIGlmICghZW50cnkpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCBkaWdlc3QgPSBlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdFxuICAgIGxldCByZXNvbHZlZFVyaSA9IG51bGxcbiAgICBsZXQgc2hvdWxkQ2xlYW51cCA9IGZhbHNlXG5cbiAgICBhd2FpdCB0aGlzLmJlZ2luQWN0aXZlRGlnZXN0KGRpZ2VzdClcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBjYWNoZWRVcmkgPSBhd2FpdCB0aGlzLmNhY2hlZFVyaVdoaWxlQWN0aXZlKGVudHJ5KVxuXG4gICAgICBpZiAoY2FjaGVkVXJpKSB7XG4gICAgICAgIGVudHJ5Lmxhc3RBY2Nlc3NlZEF0ID0gdGhpcy5ub3dNaWxsaXNlY29uZHMoKVxuICAgICAgICBlbnRyeS5zdGF0dXMgPSBcImNhY2hlZFwiXG4gICAgICAgIGF3YWl0IHRoaXMuc2F2ZVN0YXRlKClcblxuICAgICAgICByZXNvbHZlZFVyaSA9IGNhY2hlZFVyaVxuICAgICAgfSBlbHNlIGlmIChvbmxpbmUgJiYgdGhpcy5yZXRyeUVsaWdpYmxlKGVudHJ5KSkge1xuICAgICAgICBjb25zdCBjYWNoZVJlc3VsdCA9IGF3YWl0IHRoaXMuZW5zdXJlQ2FjaGVkV2hpbGVBY3RpdmUoW2VudHJ5XSlcblxuICAgICAgICBpZiAoY2FjaGVSZXN1bHQuZXJyb3IpIHRocm93IGNhY2hlUmVzdWx0LmVycm9yXG5cbiAgICAgICAgaWYgKGNhY2hlUmVzdWx0LnVyaSkge1xuICAgICAgICAgIHJlc29sdmVkVXJpID0gY2FjaGVSZXN1bHQudXJpXG4gICAgICAgICAgc2hvdWxkQ2xlYW51cCA9IHRydWVcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCB0aGlzLmZpbmlzaEFjdGl2ZURpZ2VzdChkaWdlc3QsIHNob3VsZENsZWFudXAgPyBuZXcgU2V0KFtkaWdlc3RdKSA6IG5ldyBTZXQoKSlcbiAgICB9XG5cbiAgICBpZiAoc2hvdWxkQ2xlYW51cCkgYXdhaXQgdGhpcy5jbGVhbnVwKG5ldyBTZXQoW2RpZ2VzdF0pKVxuICAgIGNvbnN0IHJlcXVpcmVzVW5wcm90ZWN0ZWRDbGVhbnVwID0gc2hvdWxkQ2xlYW51cCB8fCAoZW50cnkuZGVzY3JpcHRvci5ieXRlU2l6ZSA+IHRoaXMubWF4Qnl0ZXMgJiYgIXN0YXRlLmFzc2V0cy5zb21lKChjYW5kaWRhdGUpID0+IHtcbiAgICAgIHJldHVybiBjYW5kaWRhdGUuZGVzY3JpcHRvci5kaWdlc3QgPT09IGRpZ2VzdCAmJiBjYW5kaWRhdGUuZGVzY3JpcHRvci5yZXRlbnRpb24gPT09IFwiZHVyYWJsZVwiXG4gICAgfSkpXG5cbiAgICBpZiAocmVxdWlyZXNVbnByb3RlY3RlZENsZWFudXApIGF3YWl0IHRoaXMuY2xlYW51cCgpXG4gICAgaWYgKCFyZXNvbHZlZFVyaSkgcmV0dXJuIG51bGxcbiAgICBjb25zdCByZXNvbHZlZEVudHJ5ID0gc3RhdGUuYXNzZXRzLmZpbmQoKGNhbmRpZGF0ZSkgPT4gY2FuZGlkYXRlLmRlc2NyaXB0b3IuaWQgPT09IGFzc2V0SWQgJiYgY2FuZGlkYXRlLmRlc2NyaXB0b3IuZGlnZXN0ID09PSBkaWdlc3QpXG5cbiAgICBpZiAoIXJlc29sdmVkRW50cnkpIHJldHVybiBudWxsXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5jYWNoZWRVcmkocmVzb2x2ZWRFbnRyeSlcbiAgfVxuXG4gIC8qKlxuICAgKiBFdmljdHMgbGVhc3QtcmVjZW50bHktdXNlZCBibG9icyB1bnRpbCB0aGUgdW5pcXVlIGNhY2hlZCBieXRlIHRvdGFsIGlzXG4gICAqIHdpdGhpbiB0aGUgY29uZmlndXJlZCBidWRnZXQuIEEgYmxvYiBzdGF5cyBkdXJhYmxlIHdoZW4gYW55IGxpdmVcbiAgICogZGVzY3JpcHRvciByZWZlcmVuY2UgZGVjbGFyZXMgZHVyYWJsZSByZXRlbnRpb24uXG4gICAqIEBwYXJhbSB7U2V0PHN0cmluZz59IFtwcm90ZWN0ZWREaWdlc3RzXSBEaWdlc3RzIG5lZWRlZCBieSB0aGUgYWN0aXZlIGNhbGxlci5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gQnl0ZXMgcmVtb3ZlZC5cbiAgICovXG4gIGFzeW5jIGNsZWFudXAocHJvdGVjdGVkRGlnZXN0cyA9IG5ldyBTZXQoKSkge1xuICAgIGNvbnN0IGNsZWFudXAgPSBhc3luYyAoKSA9PiBhd2FpdCB0aGlzLnBlcmZvcm1DbGVhbnVwKHByb3RlY3RlZERpZ2VzdHMpXG4gICAgY29uc3QgY2xlYW51cFByb21pc2UgPSB0aGlzLmNsZWFudXBQcm9taXNlLnRoZW4oY2xlYW51cCwgY2xlYW51cClcblxuICAgIHRoaXMuY2xlYW51cFByb21pc2UgPSBjbGVhbnVwUHJvbWlzZVxuXG4gICAgcmV0dXJuIGF3YWl0IGNsZWFudXBQcm9taXNlXG4gIH1cblxuICAvKipcbiAgICogUGVyZm9ybXMgb25lIHNlcmlhbGl6ZWQgZXZpY3Rpb24gcGFzcy5cbiAgICogQHBhcmFtIHtTZXQ8c3RyaW5nPn0gcHJvdGVjdGVkRGlnZXN0cyBEaWdlc3RzIG5lZWRlZCBieSB0aGUgYWN0aXZlIGNhbGxlci5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gQnl0ZXMgcmVtb3ZlZC5cbiAgICovXG4gIGFzeW5jIHBlcmZvcm1DbGVhbnVwKHByb3RlY3RlZERpZ2VzdHMpIHtcbiAgICBjb25zdCBzdGF0ZSA9IGF3YWl0IHRoaXMubG9hZFN0YXRlKClcbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIGltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZUVudHJ5W10+fSAqL1xuICAgIGNvbnN0IGVudHJpZXNCeURpZ2VzdCA9IG5ldyBNYXAoKVxuXG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiBzdGF0ZS5hc3NldHMpIHtcbiAgICAgIGNvbnN0IGRpZ2VzdEVudHJpZXMgPSBlbnRyaWVzQnlEaWdlc3QuZ2V0KGVudHJ5LmRlc2NyaXB0b3IuZGlnZXN0KSB8fCBbXVxuXG4gICAgICBkaWdlc3RFbnRyaWVzLnB1c2goZW50cnkpXG4gICAgICBlbnRyaWVzQnlEaWdlc3Quc2V0KGVudHJ5LmRlc2NyaXB0b3IuZGlnZXN0LCBkaWdlc3RFbnRyaWVzKVxuICAgIH1cblxuICAgIC8qKiBAdHlwZSB7e2J5dGVTaXplOiBudW1iZXIsIGRpZ2VzdDogc3RyaW5nLCBsYXN0QWNjZXNzZWRBdDogbnVtYmVyfVtdfSAqL1xuICAgIGNvbnN0IGNhY2hlZEJsb2JzID0gW11cbiAgICBsZXQgY2FjaGVkQnl0ZXMgPSAwXG5cbiAgICBmb3IgKGNvbnN0IFtkaWdlc3QsIHJlZmVyZW5jZXNdIG9mIGVudHJpZXNCeURpZ2VzdCkge1xuICAgICAgY29uc3QgdXJpID0gYXdhaXQgdGhpcy5hZGFwdGVyLmJsb2JVcmkoe2FjY291bnRJZDogdGhpcy5hY2NvdW50SWQsIGRpZ2VzdH0pXG5cbiAgICAgIGlmICghdXJpKSB7XG4gICAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgcmVmZXJlbmNlcykge1xuICAgICAgICAgIGlmIChlbnRyeS5zdGF0dXMgPT09IFwiY2FjaGVkXCIpIGVudHJ5LnN0YXR1cyA9IFwibWlzc2luZ1wiXG4gICAgICAgIH1cbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgY29uc3QgYnl0ZVNpemUgPSByZWZlcmVuY2VzWzBdLmRlc2NyaXB0b3IuYnl0ZVNpemVcblxuICAgICAgY2FjaGVkQnl0ZXMgKz0gYnl0ZVNpemVcbiAgICAgIGNhY2hlZEJsb2JzLnB1c2goe1xuICAgICAgICBieXRlU2l6ZSxcbiAgICAgICAgZGlnZXN0LFxuICAgICAgICBsYXN0QWNjZXNzZWRBdDogTWF0aC5tYXgoLi4ucmVmZXJlbmNlcy5tYXAoKGVudHJ5KSA9PiBlbnRyeS5sYXN0QWNjZXNzZWRBdCkpXG4gICAgICB9KVxuICAgIH1cblxuICAgIGxldCByZW1vdmVkQnl0ZXMgPSAwXG5cbiAgICB3aGlsZSAoY2FjaGVkQmxvYnMubGVuZ3RoID4gMCkge1xuICAgICAgaWYgKGNhY2hlZEJ5dGVzIDw9IHRoaXMubWF4Qnl0ZXMpIGJyZWFrXG5cbiAgICAgIGZvciAoY29uc3QgY2FjaGVkQmxvYiBvZiBjYWNoZWRCbG9icykge1xuICAgICAgICBjb25zdCBjdXJyZW50UmVmZXJlbmNlcyA9IHN0YXRlLmFzc2V0cy5maWx0ZXIoKGVudHJ5KSA9PiBlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdCA9PT0gY2FjaGVkQmxvYi5kaWdlc3QpXG5cbiAgICAgICAgaWYgKGN1cnJlbnRSZWZlcmVuY2VzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICBjYWNoZWRCbG9iLmxhc3RBY2Nlc3NlZEF0ID0gTWF0aC5tYXgoLi4uY3VycmVudFJlZmVyZW5jZXMubWFwKChlbnRyeSkgPT4gZW50cnkubGFzdEFjY2Vzc2VkQXQpKVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGNhY2hlZEJsb2JzLnNvcnQoKGxlZnQsIHJpZ2h0KSA9PiBsZWZ0Lmxhc3RBY2Nlc3NlZEF0IC0gcmlnaHQubGFzdEFjY2Vzc2VkQXQgfHwgbGVmdC5kaWdlc3QubG9jYWxlQ29tcGFyZShyaWdodC5kaWdlc3QpKVxuXG4gICAgICBjb25zdCBibG9iID0gY2FjaGVkQmxvYnMuc2hpZnQoKVxuXG4gICAgICBpZiAoIWJsb2IpIHRocm93IG5ldyBFcnJvcihcIkV4cGVjdGVkIGEgc3luY2hyb25pemVkIGFzc2V0IGNhY2hlIGV2aWN0aW9uIGNhbmRpZGF0ZVwiKVxuICAgICAgaWYgKHByb3RlY3RlZERpZ2VzdHMuaGFzKGJsb2IuZGlnZXN0KSkgY29udGludWVcbiAgICAgIGxldCBibG9iV2FzQWxyZWFkeU1pc3NpbmcgPSBmYWxzZVxuICAgICAgbGV0IGRlbGV0aW9uQ2hlY2tlZCA9IGZhbHNlXG4gICAgICBjb25zdCBkZWxldGVkID0gYXdhaXQgdGhpcy5kZWxldGVEaWdlc3RJZkluYWN0aXZlKGJsb2IuZGlnZXN0LCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGRlbGV0aW9uQ2hlY2tlZCA9IHRydWVcblxuICAgICAgICBpZiAoIXRoaXMuc3RhdGUpIHRocm93IG5ldyBFcnJvcihcIkNhbm5vdCBjbGVhbiBzeW5jaHJvbml6ZWQgYXNzZXQgYmxvYnMgYmVmb3JlIGxvYWRpbmcgc3RhdGVcIilcblxuICAgICAgICBjb25zdCBjdXJyZW50VXJpID0gYXdhaXQgdGhpcy5hZGFwdGVyLmJsb2JVcmkoe2FjY291bnRJZDogdGhpcy5hY2NvdW50SWQsIGRpZ2VzdDogYmxvYi5kaWdlc3R9KVxuICAgICAgICBjb25zdCBjdXJyZW50UmVmZXJlbmNlcyA9IHRoaXMuc3RhdGUuYXNzZXRzLmZpbHRlcigoZW50cnkpID0+IGVudHJ5LmRlc2NyaXB0b3IuZGlnZXN0ID09PSBibG9iLmRpZ2VzdClcblxuICAgICAgICBpZiAoIWN1cnJlbnRVcmkpIHtcbiAgICAgICAgICBibG9iV2FzQWxyZWFkeU1pc3NpbmcgPSB0cnVlXG5cbiAgICAgICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGN1cnJlbnRSZWZlcmVuY2VzKSB7XG4gICAgICAgICAgICBpZiAoZW50cnkuc3RhdHVzID09PSBcImNhY2hlZFwiKSBlbnRyeS5zdGF0dXMgPSBcIm1pc3NpbmdcIlxuICAgICAgICAgIH1cblxuICAgICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgICB9XG4gICAgICAgIGlmIChjdXJyZW50UmVmZXJlbmNlcy5zb21lKChlbnRyeSkgPT4gZW50cnkuZGVzY3JpcHRvci5yZXRlbnRpb24gPT09IFwiZHVyYWJsZVwiKSkgcmV0dXJuIGZhbHNlXG5cbiAgICAgICAgYXdhaXQgdGhpcy5hZGFwdGVyLmRlbGV0ZUJsb2Ioe2FjY291bnRJZDogdGhpcy5hY2NvdW50SWQsIGRpZ2VzdDogYmxvYi5kaWdlc3R9KVxuXG4gICAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgY3VycmVudFJlZmVyZW5jZXMpIHtcbiAgICAgICAgICBlbnRyeS5hdHRlbXB0cyA9IDBcbiAgICAgICAgICBlbnRyeS5uZXh0UmV0cnlBdCA9IG51bGxcbiAgICAgICAgICBlbnRyeS5zdGF0dXMgPSBcIm1pc3NpbmdcIlxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHRydWVcbiAgICAgIH0pXG5cbiAgICAgIGlmICghZGVsZXRpb25DaGVja2VkKSB0aGlzLmNsZWFudXBSZXF1aXJlZEFmdGVyUmVsZWFzZURpZ2VzdHMuYWRkKGJsb2IuZGlnZXN0KVxuICAgICAgaWYgKGJsb2JXYXNBbHJlYWR5TWlzc2luZykgY2FjaGVkQnl0ZXMgLT0gYmxvYi5ieXRlU2l6ZVxuICAgICAgaWYgKCFkZWxldGVkKSBjb250aW51ZVxuXG4gICAgICBjYWNoZWRCeXRlcyAtPSBibG9iLmJ5dGVTaXplXG4gICAgICByZW1vdmVkQnl0ZXMgKz0gYmxvYi5ieXRlU2l6ZVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuc2F2ZVN0YXRlKClcblxuICAgIHJldHVybiByZW1vdmVkQnl0ZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBMb2FkcyBjYWNoZSBzdGF0ZSBvbmNlIGZvciB0aGlzIGNhY2hlIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVTdGF0ZT59IExvYWRlZCBzdGF0ZS5cbiAgICovXG4gIGFzeW5jIGxvYWRTdGF0ZSgpIHtcbiAgICBpZiAodGhpcy5zdGF0ZSkgcmV0dXJuIHRoaXMuc3RhdGVcbiAgICBpZiAodGhpcy5zdGF0ZVByb21pc2UpIHJldHVybiBhd2FpdCB0aGlzLnN0YXRlUHJvbWlzZVxuXG4gICAgdGhpcy5zdGF0ZVByb21pc2UgPSB0aGlzLmxvYWRTdGF0ZUZyb21BZGFwdGVyKClcblxuICAgIHRyeSB7XG4gICAgICB0aGlzLnN0YXRlID0gYXdhaXQgdGhpcy5zdGF0ZVByb21pc2VcblxuICAgICAgcmV0dXJuIHRoaXMuc3RhdGVcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdGhpcy5zdGF0ZVByb21pc2UgPSBudWxsXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIExvYWRzIGFuZCByZWNvdmVycyBwZXJzaXN0ZWQgY2FjaGUgc3RhdGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZVN0YXRlPn0gTG9hZGVkIHN0YXRlLlxuICAgKi9cbiAgYXN5bmMgbG9hZFN0YXRlRnJvbUFkYXB0ZXIoKSB7XG4gICAgY29uc3QgbG9hZGVkU3RhdGUgPSBhd2FpdCB0aGlzLmFkYXB0ZXIubG9hZFN0YXRlKHthY2NvdW50SWQ6IHRoaXMuYWNjb3VudElkfSlcblxuICAgIGlmICghbG9hZGVkU3RhdGUpIHJldHVybiB7YXNzZXRzOiBbXSwgcGVuZGluZ0RlbGV0aW9uRGlnZXN0czogW10sIHZlcnNpb246IENBQ0hFX1NUQVRFX1ZFUlNJT059XG4gICAgaWYgKGxvYWRlZFN0YXRlLnZlcnNpb24gIT09IENBQ0hFX1NUQVRFX1ZFUlNJT04pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgc3luY2hyb25pemVkIGFzc2V0IGNhY2hlIHN0YXRlIHZlcnNpb246ICR7bG9hZGVkU3RhdGUudmVyc2lvbn1gKVxuICAgIH1cblxuICAgIGxldCByZWNvdmVyZWRJbnRlcnJ1cHRlZERvd25sb2FkID0gZmFsc2VcblxuICAgIGZvciAoY29uc3QgZW50cnkgb2YgbG9hZGVkU3RhdGUuYXNzZXRzKSB7XG4gICAgICBpZiAoZW50cnkuc3RhdHVzICE9PSBcImRvd25sb2FkaW5nXCIpIGNvbnRpbnVlXG5cbiAgICAgIGVudHJ5LmF0dGVtcHRzICs9IDFcbiAgICAgIGVudHJ5Lm5leHRSZXRyeUF0ID0gdGhpcy5ub3dNaWxsaXNlY29uZHMoKVxuICAgICAgZW50cnkuc3RhdHVzID0gXCJmYWlsZWRcIlxuICAgICAgcmVjb3ZlcmVkSW50ZXJydXB0ZWREb3dubG9hZCA9IHRydWVcbiAgICB9XG5cbiAgICBpZiAocmVjb3ZlcmVkSW50ZXJydXB0ZWREb3dubG9hZCkge1xuICAgICAgYXdhaXQgdGhpcy5hZGFwdGVyLnNhdmVTdGF0ZSh7YWNjb3VudElkOiB0aGlzLmFjY291bnRJZCwgc3RhdGU6IGxvYWRlZFN0YXRlfSlcbiAgICB9XG5cbiAgICByZXR1cm4gbG9hZGVkU3RhdGVcbiAgfVxuXG4gIC8qKlxuICAgKiBQZXJzaXN0cyB0aGUgY3VycmVudCBjYWNoZSBzdGF0ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIGFmdGVyIHN0YXRlIHBlcnNpc3RlbmNlLlxuICAgKi9cbiAgYXN5bmMgc2F2ZVN0YXRlKCkge1xuICAgIGlmICghdGhpcy5zdGF0ZSkgdGhyb3cgbmV3IEVycm9yKFwiQ2Fubm90IHNhdmUgc3luY2hyb25pemVkIGFzc2V0IGNhY2hlIGJlZm9yZSBsb2FkaW5nIHN0YXRlXCIpXG5cbiAgICBjb25zdCBwZXJzaXN0ID0gYXN5bmMgKCkgPT4ge1xuICAgICAgaWYgKCF0aGlzLnN0YXRlKSB0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3Qgc2F2ZSBzeW5jaHJvbml6ZWQgYXNzZXQgY2FjaGUgYmVmb3JlIGxvYWRpbmcgc3RhdGVcIilcblxuICAgICAgYXdhaXQgdGhpcy5hZGFwdGVyLnNhdmVTdGF0ZSh7YWNjb3VudElkOiB0aGlzLmFjY291bnRJZCwgc3RhdGU6IHRoaXMuc3RhdGV9KVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuc2VyaWFsaXplU3RhdGVQZXJzaXN0ZW5jZShwZXJzaXN0KVxuICB9XG5cbiAgLyoqXG4gICAqIFBlcnNpc3RzIGEgZGV0YWNoZWQgcmVjb25jaWxpYXRpb24gYmVmb3JlIGV4cG9zaW5nIGl0IHRocm91Z2ggc2hhcmVkIHN0YXRlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyBSZWNvbmNpbGlhdGlvbiBpbnB1dHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlRGVzY3JpcHRvcltdfSBhcmdzLmRlc2NyaXB0b3JzIEN1cnJlbnQgZGVzY3JpcHRvcnMgaW4gdGhlIHNjb3BlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zY29wZUtleSBTdGFibGUgc3luY2hyb25pemVkIHNjb3BlIGtleS5cbiAgICogQHJldHVybnMge1Byb21pc2U8TWFwPHN0cmluZywgaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlRW50cnk+Pn0gUmVjb25jaWxlZCBsaXZlIGVudHJpZXMgYnkgaWQuXG4gICAqL1xuICBhc3luYyByZWNvbmNpbGVEZXNjcmlwdG9ycyh7ZGVzY3JpcHRvcnMsIHNjb3BlS2V5fSkge1xuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlRW50cnk+IHwgbnVsbH0gKi9cbiAgICBsZXQgZW50cmllc0J5SWQgPSBudWxsXG5cbiAgICBjb25zdCBwZXJzaXN0ID0gYXN5bmMgKCkgPT4ge1xuICAgICAgaWYgKCF0aGlzLnN0YXRlKSB0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3QgcmVjb25jaWxlIHN5bmNocm9uaXplZCBhc3NldCBjYWNoZSBiZWZvcmUgbG9hZGluZyBzdGF0ZVwiKVxuXG4gICAgICBjb25zdCBjYW5kaWRhdGVTdGF0ZSA9IHRoaXMuY29weVN0YXRlKHRoaXMuc3RhdGUpXG4gICAgICBjb25zdCBuZXdFbnRyeUxhc3RBY2Nlc3NlZEF0ID0gdGhpcy5ub3dNaWxsaXNlY29uZHMoKVxuXG4gICAgICB0aGlzLmFwcGx5RGVzY3JpcHRvclJlY29uY2lsaWF0aW9uKHtkZXNjcmlwdG9ycywgbmV3RW50cnlMYXN0QWNjZXNzZWRBdCwgc2NvcGVLZXksIHN0YXRlOiBjYW5kaWRhdGVTdGF0ZX0pXG4gICAgICBhd2FpdCB0aGlzLmFkYXB0ZXIuc2F2ZVN0YXRlKHthY2NvdW50SWQ6IHRoaXMuYWNjb3VudElkLCBzdGF0ZTogY2FuZGlkYXRlU3RhdGV9KVxuICAgICAgZW50cmllc0J5SWQgPSB0aGlzLmFwcGx5RGVzY3JpcHRvclJlY29uY2lsaWF0aW9uKHtkZXNjcmlwdG9ycywgbmV3RW50cnlMYXN0QWNjZXNzZWRBdCwgc2NvcGVLZXksIHN0YXRlOiB0aGlzLnN0YXRlfSlcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnNlcmlhbGl6ZVN0YXRlUGVyc2lzdGVuY2UocGVyc2lzdClcblxuICAgIGlmICghZW50cmllc0J5SWQpIHRocm93IG5ldyBFcnJvcihcIlN5bmNocm9uaXplZCBhc3NldCBkZXNjcmlwdG9yIHJlY29uY2lsaWF0aW9uIGNvbXBsZXRlZCB3aXRob3V0IGxpdmUgZW50cmllc1wiKVxuXG4gICAgcmV0dXJuIGVudHJpZXNCeUlkXG4gIH1cblxuICAvKipcbiAgICogQXBwbGllcyBvbmUgc2NvcGUncyBkZXNjcmlwdG9yIHNldCB0byBjYWNoZSBzdGF0ZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgUmVjb25jaWxpYXRpb24gaW5wdXRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZURlc2NyaXB0b3JbXX0gYXJncy5kZXNjcmlwdG9ycyBDdXJyZW50IGRlc2NyaXB0b3JzIGluIHRoZSBzY29wZS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MubmV3RW50cnlMYXN0QWNjZXNzZWRBdCBJbml0aWFsIExSVSB0aW1lc3RhbXAgZm9yIG5ldyBlbnRyaWVzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zY29wZUtleSBTdGFibGUgc3luY2hyb25pemVkIHNjb3BlIGtleS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVTdGF0ZX0gYXJncy5zdGF0ZSBTdGF0ZSB0byByZWNvbmNpbGUuXG4gICAqIEByZXR1cm5zIHtNYXA8c3RyaW5nLCBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVFbnRyeT59IExpdmUgZW50cmllcyBieSBpZC5cbiAgICovXG4gIGFwcGx5RGVzY3JpcHRvclJlY29uY2lsaWF0aW9uKHtkZXNjcmlwdG9ycywgbmV3RW50cnlMYXN0QWNjZXNzZWRBdCwgc2NvcGVLZXksIHN0YXRlfSkge1xuICAgIGNvbnN0IGluY29taW5nSWRzID0gbmV3IFNldChkZXNjcmlwdG9ycy5tYXAoKGFzc2V0KSA9PiBhc3NldC5pZCkpXG4gICAgY29uc3QgZW50cmllc0J5SWQgPSBuZXcgTWFwKHN0YXRlLmFzc2V0cy5tYXAoKGVudHJ5KSA9PiBbZW50cnkuZGVzY3JpcHRvci5pZCwgZW50cnldKSlcbiAgICBjb25zdCBkZXNjcmlwdG9yc0J5SWQgPSBuZXcgTWFwKHN0YXRlLmFzc2V0cy5tYXAoKGVudHJ5KSA9PiBbZW50cnkuZGVzY3JpcHRvci5pZCwgZW50cnkuZGVzY3JpcHRvcl0pKVxuICAgIGNvbnN0IHJlbW92ZWREaWdlc3RzID0gbmV3IFNldCgpXG5cbiAgICBmb3IgKGNvbnN0IGFzc2V0IG9mIGRlc2NyaXB0b3JzKSB7XG4gICAgICBjb25zdCBrbm93bkRlc2NyaXB0b3IgPSBkZXNjcmlwdG9yc0J5SWQuZ2V0KGFzc2V0LmlkKVxuXG4gICAgICBpZiAoa25vd25EZXNjcmlwdG9yICYmIGtub3duRGVzY3JpcHRvci5kaWdlc3QgIT09IGFzc2V0LmRpZ2VzdCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFN5bmNocm9uaXplZCBhc3NldCBkZXNjcmlwdG9yICR7YXNzZXQuaWR9IGNoYW5nZWQgaXRzIGltbXV0YWJsZSBkaWdlc3RgKVxuICAgICAgfVxuICAgICAgaWYgKGtub3duRGVzY3JpcHRvciAmJiBrbm93bkRlc2NyaXB0b3IuYnl0ZVNpemUgIT09IGFzc2V0LmJ5dGVTaXplKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgU3luY2hyb25pemVkIGFzc2V0IGRlc2NyaXB0b3IgJHthc3NldC5pZH0gY2hhbmdlZCBpdHMgaW1tdXRhYmxlIGJ5dGUgc2l6ZWApXG4gICAgICB9XG4gICAgICBpZiAoa25vd25EZXNjcmlwdG9yICYmIGtub3duRGVzY3JpcHRvci5jb250ZW50VHlwZSAhPT0gYXNzZXQuY29udGVudFR5cGUpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBTeW5jaHJvbml6ZWQgYXNzZXQgZGVzY3JpcHRvciAke2Fzc2V0LmlkfSBjaGFuZ2VkIGl0cyBpbW11dGFibGUgY29udGVudCB0eXBlYClcbiAgICAgIH1cblxuICAgICAgZGVzY3JpcHRvcnNCeUlkLnNldChhc3NldC5pZCwgYXNzZXQpXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiBzdGF0ZS5hc3NldHMpIHtcbiAgICAgIGlmICghZW50cnkuc2NvcGVLZXlzLmluY2x1ZGVzKHNjb3BlS2V5KSB8fCBpbmNvbWluZ0lkcy5oYXMoZW50cnkuZGVzY3JpcHRvci5pZCkpIGNvbnRpbnVlXG5cbiAgICAgIGVudHJ5LnNjb3BlS2V5cyA9IGVudHJ5LnNjb3BlS2V5cy5maWx0ZXIoKGNhbmRpZGF0ZSkgPT4gY2FuZGlkYXRlICE9PSBzY29wZUtleSlcbiAgICAgIGlmIChlbnRyeS5zY29wZUtleXMubGVuZ3RoID09PSAwKSByZW1vdmVkRGlnZXN0cy5hZGQoZW50cnkuZGVzY3JpcHRvci5kaWdlc3QpXG4gICAgfVxuXG4gICAgc3RhdGUuYXNzZXRzID0gc3RhdGUuYXNzZXRzLmZpbHRlcigoZW50cnkpID0+IGVudHJ5LnNjb3BlS2V5cy5sZW5ndGggPiAwKVxuXG4gICAgZm9yIChjb25zdCBhc3NldCBvZiBkZXNjcmlwdG9ycykge1xuICAgICAgY29uc3QgZXhpc3RpbmcgPSBlbnRyaWVzQnlJZC5nZXQoYXNzZXQuaWQpXG5cbiAgICAgIGlmIChleGlzdGluZyAmJiBzdGF0ZS5hc3NldHMuaW5jbHVkZXMoZXhpc3RpbmcpKSB7XG4gICAgICAgIGV4aXN0aW5nLmRlc2NyaXB0b3IgPSBhc3NldFxuICAgICAgICBpZiAoIWV4aXN0aW5nLnNjb3BlS2V5cy5pbmNsdWRlcyhzY29wZUtleSkpIGV4aXN0aW5nLnNjb3BlS2V5cy5wdXNoKHNjb3BlS2V5KVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY29uc3QgbmV3RW50cnkgPSB7XG4gICAgICAgICAgYXR0ZW1wdHM6IDAsXG4gICAgICAgICAgZGVzY3JpcHRvcjogYXNzZXQsXG4gICAgICAgICAgbGFzdEFjY2Vzc2VkQXQ6IG5ld0VudHJ5TGFzdEFjY2Vzc2VkQXQsXG4gICAgICAgICAgbmV4dFJldHJ5QXQ6IG51bGwsXG4gICAgICAgICAgc2NvcGVLZXlzOiBbc2NvcGVLZXldLFxuICAgICAgICAgIHN0YXR1czogLyoqIEB0eXBlIHtjb25zdH0gKi8gKFwibWlzc2luZ1wiKVxuICAgICAgICB9XG5cbiAgICAgICAgc3RhdGUuYXNzZXRzLnB1c2gobmV3RW50cnkpXG4gICAgICAgIGVudHJpZXNCeUlkLnNldChhc3NldC5pZCwgbmV3RW50cnkpXG4gICAgICB9XG4gICAgfVxuXG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBudW1iZXI+fSAqL1xuICAgIGNvbnN0IGJ5dGVTaXplc0J5RGlnZXN0ID0gbmV3IE1hcCgpXG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBzdHJpbmcgfCBudWxsPn0gKi9cbiAgICBjb25zdCBjb250ZW50VHlwZXNCeURpZ2VzdCA9IG5ldyBNYXAoKVxuXG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiBzdGF0ZS5hc3NldHMpIHtcbiAgICAgIGNvbnN0IGtub3duQnl0ZVNpemUgPSBieXRlU2l6ZXNCeURpZ2VzdC5nZXQoZW50cnkuZGVzY3JpcHRvci5kaWdlc3QpXG4gICAgICBjb25zdCBrbm93bkNvbnRlbnRUeXBlID0gY29udGVudFR5cGVzQnlEaWdlc3QuZ2V0KGVudHJ5LmRlc2NyaXB0b3IuZGlnZXN0KVxuXG4gICAgICBpZiAoa25vd25CeXRlU2l6ZSAhPT0gdW5kZWZpbmVkICYmIGtub3duQnl0ZVNpemUgIT09IGVudHJ5LmRlc2NyaXB0b3IuYnl0ZVNpemUpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBTeW5jaHJvbml6ZWQgYXNzZXQgZGlnZXN0ICR7ZW50cnkuZGVzY3JpcHRvci5kaWdlc3R9IGhhcyBpbmNvbnNpc3RlbnQgYnl0ZSBzaXplc2ApXG4gICAgICB9XG4gICAgICBpZiAoa25vd25Db250ZW50VHlwZSAhPT0gdW5kZWZpbmVkICYmIGtub3duQ29udGVudFR5cGUgIT09IGVudHJ5LmRlc2NyaXB0b3IuY29udGVudFR5cGUpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBTeW5jaHJvbml6ZWQgYXNzZXQgZGlnZXN0ICR7ZW50cnkuZGVzY3JpcHRvci5kaWdlc3R9IGhhcyBpbmNvbnNpc3RlbnQgY29udGVudCB0eXBlc2ApXG4gICAgICB9XG5cbiAgICAgIGJ5dGVTaXplc0J5RGlnZXN0LnNldChlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdCwgZW50cnkuZGVzY3JpcHRvci5ieXRlU2l6ZSlcbiAgICAgIGNvbnRlbnRUeXBlc0J5RGlnZXN0LnNldChlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdCwgZW50cnkuZGVzY3JpcHRvci5jb250ZW50VHlwZSlcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGRpZ2VzdCBvZiByZW1vdmVkRGlnZXN0cykge1xuICAgICAgaWYgKHN0YXRlLmFzc2V0cy5zb21lKChlbnRyeSkgPT4gZW50cnkuZGVzY3JpcHRvci5kaWdlc3QgPT09IGRpZ2VzdCkpIGNvbnRpbnVlXG4gICAgICBpZiAoIXN0YXRlLnBlbmRpbmdEZWxldGlvbkRpZ2VzdHMuaW5jbHVkZXMoZGlnZXN0KSkgc3RhdGUucGVuZGluZ0RlbGV0aW9uRGlnZXN0cy5wdXNoKGRpZ2VzdClcbiAgICB9XG5cbiAgICByZXR1cm4gZW50cmllc0J5SWRcbiAgfVxuXG4gIC8qKlxuICAgKiBDb3BpZXMgbWV0YWRhdGEgaW50byBhIGRldGFjaGVkIHBlcnNpc3RlbmNlIGNhbmRpZGF0ZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVTdGF0ZX0gc3RhdGUgU3RhdGUgdG8gY29weS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZVN0YXRlfSBEZXRhY2hlZCBzdGF0ZS5cbiAgICovXG4gIGNvcHlTdGF0ZShzdGF0ZSkge1xuICAgIHJldHVybiB7XG4gICAgICBhc3NldHM6IHN0YXRlLmFzc2V0cy5tYXAoKGVudHJ5KSA9PiAoe1xuICAgICAgICAuLi5lbnRyeSxcbiAgICAgICAgZGVzY3JpcHRvcjogey4uLmVudHJ5LmRlc2NyaXB0b3J9LFxuICAgICAgICBzY29wZUtleXM6IFsuLi5lbnRyeS5zY29wZUtleXNdXG4gICAgICB9KSksXG4gICAgICBwZW5kaW5nRGVsZXRpb25EaWdlc3RzOiBbLi4uc3RhdGUucGVuZGluZ0RlbGV0aW9uRGlnZXN0c10sXG4gICAgICB2ZXJzaW9uOiBzdGF0ZS52ZXJzaW9uXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFNlcmlhbGl6ZXMgb25lIG1ldGFkYXRhIHBlcnNpc3RlbmNlIG9wZXJhdGlvbiBhZnRlciBwcmlvciBmYWlsdXJlcyBvciBzdWNjZXNzZXMuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTx2b2lkPn0gcGVyc2lzdCBQZXJzaXN0ZW5jZSBvcGVyYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyBhZnRlciBwZXJzaXN0ZW5jZS5cbiAgICovXG4gIGFzeW5jIHNlcmlhbGl6ZVN0YXRlUGVyc2lzdGVuY2UocGVyc2lzdCkge1xuICAgIHRoaXMuc2F2ZVN0YXRlUHJvbWlzZSA9IHRoaXMuc2F2ZVN0YXRlUHJvbWlzZS50aGVuKHBlcnNpc3QsIHBlcnNpc3QpXG5cbiAgICBhd2FpdCB0aGlzLnNhdmVTdGF0ZVByb21pc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBFbnN1cmVzIG9uZSBkZXNjcmlwdG9yIGhhcyB2ZXJpZmllZCBsb2NhbCBieXRlcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVFbnRyeX0gZW50cnkgRGVzY3JpcHRvciBzdGF0ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8e2Vycm9yOiBFcnJvciB8IG51bGwsIHVyaTogc3RyaW5nIHwgbnVsbH0+fSBDYWNoZSByZXN1bHQuXG4gICAqL1xuICBhc3luYyBlbnN1cmVDYWNoZWQoZW50cnkpIHtcbiAgICBjb25zdCBkaWdlc3QgPSBlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdFxuXG4gICAgYXdhaXQgdGhpcy5iZWdpbkFjdGl2ZURpZ2VzdChkaWdlc3QpXG5cbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuZW5zdXJlQ2FjaGVkV2hpbGVBY3RpdmUoW2VudHJ5XSlcbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgdGhpcy5maW5pc2hBY3RpdmVEaWdlc3QoZGlnZXN0KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBvciBkb3dubG9hZHMgZGVzY3JpcHRvcnMgc2hhcmluZyBvbmUgcHJvdGVjdGVkIGRpZ2VzdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVFbnRyeVtdfSBlbnRyaWVzIERlc2NyaXB0b3Igc3RhdGVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7ZXJyb3I6IEVycm9yIHwgbnVsbCwgdXJpOiBzdHJpbmcgfCBudWxsfT59IENhY2hlIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGVuc3VyZUNhY2hlZFdoaWxlQWN0aXZlKGVudHJpZXMpIHtcbiAgICBjb25zdCBlbnRyeSA9IGVudHJpZXNbMF1cblxuICAgIGlmICghZW50cnkpIHRocm93IG5ldyBFcnJvcihcIkNhbm5vdCBjYWNoZSBhIHN5bmNocm9uaXplZCBhc3NldCBkaWdlc3Qgd2l0aG91dCBkZXNjcmlwdG9yIGVudHJpZXNcIilcblxuICAgIGNvbnN0IGV4aXN0aW5nVXJpID0gYXdhaXQgdGhpcy5jYWNoZWRVcmlXaGlsZUFjdGl2ZShlbnRyeSlcblxuICAgIGlmIChleGlzdGluZ1VyaSkge1xuICAgICAgYXdhaXQgdGhpcy5yZWNvcmRDYWNoZWRFbnRyaWVzKGVudHJpZXMpXG5cbiAgICAgIHJldHVybiB7ZXJyb3I6IG51bGwsIHVyaTogZXhpc3RpbmdVcml9XG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBkaWdlc3RFbnRyeSBvZiBlbnRyaWVzKSBkaWdlc3RFbnRyeS5zdGF0dXMgPSBcImRvd25sb2FkaW5nXCJcblxuICAgIGNvbnN0IGRpZ2VzdCA9IGVudHJ5LmRlc2NyaXB0b3IuZGlnZXN0XG4gICAgbGV0IGRvd25sb2FkUHJvbWlzZSA9IHRoaXMuZG93bmxvYWRQcm9taXNlcy5nZXQoZGlnZXN0KVxuICAgIGxldCBvd25zRG93bmxvYWRQcm9taXNlID0gZmFsc2VcblxuICAgIGlmICghZG93bmxvYWRQcm9taXNlKSB7XG4gICAgICBkb3dubG9hZFByb21pc2UgPSB0aGlzLmRvd25sb2FkQWZ0ZXJQZXJzaXN0aW5nU3RhdGUoZW50cnkuZGVzY3JpcHRvcilcbiAgICAgIHRoaXMuZG93bmxvYWRQcm9taXNlcy5zZXQoZGlnZXN0LCBkb3dubG9hZFByb21pc2UpXG4gICAgICBvd25zRG93bmxvYWRQcm9taXNlID0gdHJ1ZVxuICAgIH0gZWxzZSB7XG4gICAgICBhd2FpdCB0aGlzLnNhdmVTdGF0ZSgpXG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGNhY2hlUmVzdWx0ID0gYXdhaXQgZG93bmxvYWRQcm9taXNlXG5cbiAgICAgIGlmIChjYWNoZVJlc3VsdC5lcnJvcikge1xuICAgICAgICBpZiAoZW50cnkuc3RhdHVzID09PSBcImRvd25sb2FkaW5nXCIpIGF3YWl0IHRoaXMucmVjb3JkRG93bmxvYWRGYWlsdXJlKGRpZ2VzdClcblxuICAgICAgICByZXR1cm4gY2FjaGVSZXN1bHRcbiAgICAgIH1cblxuICAgICAgYXdhaXQgdGhpcy5yZWNvcmRDYWNoZWRFbnRyaWVzKGVudHJpZXMpXG5cbiAgICAgIHJldHVybiBjYWNoZVJlc3VsdFxuICAgIH0gZmluYWxseSB7XG4gICAgICBpZiAob3duc0Rvd25sb2FkUHJvbWlzZSAmJiB0aGlzLmRvd25sb2FkUHJvbWlzZXMuZ2V0KGRpZ2VzdCkgPT09IGRvd25sb2FkUHJvbWlzZSkge1xuICAgICAgICB0aGlzLmRvd25sb2FkUHJvbWlzZXMuZGVsZXRlKGRpZ2VzdClcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkcyBvbmUgY2FjaGVkIGRpZ2VzdCByZXN1bHQgZm9yIGV2ZXJ5IHBhcnRpY2lwYXRpbmcgZGVzY3JpcHRvci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVFbnRyeVtdfSBlbnRyaWVzIERlc2NyaXB0b3Igc3RhdGVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgYWZ0ZXIgcGVyc2lzdGVuY2UuXG4gICAqL1xuICBhc3luYyByZWNvcmRDYWNoZWRFbnRyaWVzKGVudHJpZXMpIHtcbiAgICBjb25zdCBsYXN0QWNjZXNzZWRBdCA9IHRoaXMubm93TWlsbGlzZWNvbmRzKClcblxuICAgIGZvciAoY29uc3QgZW50cnkgb2YgZW50cmllcykge1xuICAgICAgZW50cnkuYXR0ZW1wdHMgPSAwXG4gICAgICBlbnRyeS5sYXN0QWNjZXNzZWRBdCA9IGxhc3RBY2Nlc3NlZEF0XG4gICAgICBlbnRyeS5uZXh0UmV0cnlBdCA9IG51bGxcbiAgICAgIGVudHJ5LnN0YXR1cyA9IFwiY2FjaGVkXCJcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnNhdmVTdGF0ZSgpXG4gIH1cblxuICAvKipcbiAgICogUGVyc2lzdHMgZG93bmxvYWQgaW50ZW50LCB0aGVuIGRvd25sb2FkcyBvbmUgZGlnZXN0IGFuZCByZWNvcmRzIGEgc2hhcmVkIGZhaWx1cmUgb25jZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVEZXNjcmlwdG9yfSBkZXNjcmlwdG9yIEFzc2V0IGRlc2NyaXB0b3IuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHtlcnJvcjogRXJyb3IsIHVyaTogbnVsbH0gfCB7ZXJyb3I6IG51bGwsIHVyaTogc3RyaW5nfT59IFNoYXJlZCBjYWNoZSByZXN1bHQuXG4gICAqL1xuICBhc3luYyBkb3dubG9hZEFmdGVyUGVyc2lzdGluZ1N0YXRlKGRlc2NyaXB0b3IpIHtcbiAgICBhd2FpdCB0aGlzLnNhdmVTdGF0ZSgpXG5cbiAgICB0cnkge1xuICAgICAgcmV0dXJuIHtlcnJvcjogbnVsbCwgdXJpOiBhd2FpdCB0aGlzLmRvd25sb2FkVmVyaWZpZWQoZGVzY3JpcHRvcil9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnN0IGZhaWx1cmUgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSlcblxuICAgICAgYXdhaXQgdGhpcy5yZWNvcmREb3dubG9hZEZhaWx1cmUoZGVzY3JpcHRvci5kaWdlc3QpXG5cbiAgICAgIHJldHVybiB7ZXJyb3I6IGZhaWx1cmUsIHVyaTogbnVsbH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQWR2YW5jZXMgcmV0cnkgbWV0YWRhdGEgZm9yIGV2ZXJ5IGxpdmUgZGVzY3JpcHRvciBzaGFyaW5nIG9uZSBmYWlsZWQgZGlnZXN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZGlnZXN0IENvbnRlbnQgZGlnZXN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgYWZ0ZXIgcGVyc2lzdGVuY2UuXG4gICAqL1xuICBhc3luYyByZWNvcmREb3dubG9hZEZhaWx1cmUoZGlnZXN0KSB7XG4gICAgaWYgKCF0aGlzLnN0YXRlKSB0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3QgcmVjb3JkIHN5bmNocm9uaXplZCBhc3NldCBkb3dubG9hZCBmYWlsdXJlIGJlZm9yZSBsb2FkaW5nIHN0YXRlXCIpXG5cbiAgICBjb25zdCBmYWlsZWRBdCA9IHRoaXMubm93TWlsbGlzZWNvbmRzKClcblxuICAgIGZvciAoY29uc3QgZW50cnkgb2YgdGhpcy5zdGF0ZS5hc3NldHMpIHtcbiAgICAgIGlmIChlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdCAhPT0gZGlnZXN0KSBjb250aW51ZVxuICAgICAgaWYgKGVudHJ5LnN0YXR1cyAhPT0gXCJkb3dubG9hZGluZ1wiKSBjb250aW51ZVxuXG4gICAgICBlbnRyeS5hdHRlbXB0cyArPSAxXG4gICAgICBlbnRyeS5uZXh0UmV0cnlBdCA9IGZhaWxlZEF0ICsgdGhpcy5yZXRyeURlbGF5KGVudHJ5LmF0dGVtcHRzKVxuICAgICAgZW50cnkuc3RhdHVzID0gXCJmYWlsZWRcIlxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuc2F2ZVN0YXRlKClcbiAgfVxuXG4gIC8qKlxuICAgKiBEb3dubG9hZHMsIHZlcmlmaWVzLCBhbmQgYXRvbWljYWxseSBwZXJzaXN0cyBvbmUgY29udGVudCBkaWdlc3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlRGVzY3JpcHRvcn0gZGVzY3JpcHRvciBBc3NldCBkZXNjcmlwdG9yLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSBBZGFwdGVyIFVSSS5cbiAgICovXG4gIGFzeW5jIGRvd25sb2FkVmVyaWZpZWQoZGVzY3JpcHRvcikge1xuICAgIGNvbnN0IGRvd25sb2FkZWRCeXRlcyA9IGF3YWl0IHRoaXMuZG93bmxvYWQoZGVzY3JpcHRvcilcblxuICAgIGlmICghKGRvd25sb2FkZWRCeXRlcyBpbnN0YW5jZW9mIFVpbnQ4QXJyYXkpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFN5bmNocm9uaXplZCBhc3NldCAke2Rlc2NyaXB0b3IuaWR9IGRvd25sb2FkIGRpZCBub3QgcmV0dXJuIFVpbnQ4QXJyYXkgYnl0ZXNgKVxuICAgIH1cbiAgICBpZiAoZG93bmxvYWRlZEJ5dGVzLmJ5dGVMZW5ndGggIT09IGRlc2NyaXB0b3IuYnl0ZVNpemUpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgU3luY2hyb25pemVkIGFzc2V0ICR7ZGVzY3JpcHRvci5pZH0gYnl0ZSBzaXplIGRpZCBub3QgbWF0Y2ggaXRzIGRlc2NyaXB0b3JgKVxuICAgIH1cblxuICAgIGNvbnN0IGRpZ2VzdCA9IGBzaGEyNTYtJHtzaGEyNTZCeXRlc0hleChkb3dubG9hZGVkQnl0ZXMpfWBcblxuICAgIGlmIChkaWdlc3QgIT09IGRlc2NyaXB0b3IuZGlnZXN0KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFN5bmNocm9uaXplZCBhc3NldCAke2Rlc2NyaXB0b3IuaWR9IGRpZ2VzdCBkaWQgbm90IG1hdGNoIGl0cyBkZXNjcmlwdG9yYClcbiAgICB9XG5cbiAgICBjb25zdCB1cmkgPSBhd2FpdCB0aGlzLmFkYXB0ZXIud3JpdGVCbG9iKHtcbiAgICAgIGFjY291bnRJZDogdGhpcy5hY2NvdW50SWQsXG4gICAgICBieXRlczogZG93bmxvYWRlZEJ5dGVzLFxuICAgICAgY29udGVudFR5cGU6IGRlc2NyaXB0b3IuY29udGVudFR5cGUsXG4gICAgICBkaWdlc3RcbiAgICB9KVxuXG4gICAgaWYgKCF1cmkpIHRocm93IG5ldyBFcnJvcihgU3luY2hyb25pemVkIGFzc2V0IGFkYXB0ZXIgcmV0dXJuZWQgbm8gVVJJIGZvciAke2Rlc2NyaXB0b3IuaWR9YClcblxuICAgIHJldHVybiB1cmlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBhbiBleGlzdGluZyBsb2NhbCBVUkkgYWZ0ZXIgd2FpdGluZyBmb3IgZGVsZXRpb24gd29yay5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVFbnRyeX0gZW50cnkgRGVzY3JpcHRvciBzdGF0ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nIHwgbnVsbD59IEV4aXN0aW5nIFVSSS5cbiAgICovXG4gIGFzeW5jIGNhY2hlZFVyaShlbnRyeSkge1xuICAgIGNvbnN0IGRpZ2VzdCA9IGVudHJ5LmRlc2NyaXB0b3IuZGlnZXN0XG5cbiAgICBhd2FpdCB0aGlzLmJlZ2luQWN0aXZlRGlnZXN0KGRpZ2VzdClcblxuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5jYWNoZWRVcmlXaGlsZUFjdGl2ZShlbnRyeSlcbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgdGhpcy5maW5pc2hBY3RpdmVEaWdlc3QoZGlnZXN0KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBhbiBleGlzdGluZyBsb2NhbCBVUkkgd2hpbGUgaXRzIGRpZ2VzdCBpcyBwcm90ZWN0ZWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlRW50cnl9IGVudHJ5IERlc2NyaXB0b3Igc3RhdGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZyB8IG51bGw+fSBFeGlzdGluZyBVUkkuXG4gICAqL1xuICBhc3luYyBjYWNoZWRVcmlXaGlsZUFjdGl2ZShlbnRyeSkge1xuICAgIGNvbnN0IHVyaSA9IGF3YWl0IHRoaXMuYWRhcHRlci5ibG9iVXJpKHtcbiAgICAgIGFjY291bnRJZDogdGhpcy5hY2NvdW50SWQsXG4gICAgICBkaWdlc3Q6IGVudHJ5LmRlc2NyaXB0b3IuZGlnZXN0XG4gICAgfSlcblxuICAgIGlmICghdXJpICYmIGVudHJ5LnN0YXR1cyA9PT0gXCJjYWNoZWRcIikgZW50cnkuc3RhdHVzID0gXCJtaXNzaW5nXCJcblxuICAgIHJldHVybiB1cmlcbiAgfVxuXG4gIC8qKlxuICAgKiBXYWl0cyBmb3IgZGVsZXRpb24gYW5kIHByb3RlY3RzIGEgZGlnZXN0IGZvciBvbmUgYWN0aXZlIGNhY2hlIG9wZXJhdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGRpZ2VzdCBDb250ZW50IGRpZ2VzdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIGFmdGVyIHByb3RlY3Rpb24gaXMgcmVnaXN0ZXJlZC5cbiAgICovXG4gIGFzeW5jIGJlZ2luQWN0aXZlRGlnZXN0KGRpZ2VzdCkge1xuICAgIGxldCBkZWxldGlvblByb21pc2UgPSB0aGlzLmRlbGV0aW9uUHJvbWlzZXMuZ2V0KGRpZ2VzdClcblxuICAgIHdoaWxlIChkZWxldGlvblByb21pc2UpIHtcbiAgICAgIGF3YWl0IGRlbGV0aW9uUHJvbWlzZVxuICAgICAgZGVsZXRpb25Qcm9taXNlID0gdGhpcy5kZWxldGlvblByb21pc2VzLmdldChkaWdlc3QpXG4gICAgfVxuXG4gICAgY29uc3QgYWN0aXZlQ291bnQgPSB0aGlzLmFjdGl2ZURpZ2VzdENvdW50cy5nZXQoZGlnZXN0KSA/PyAwXG5cbiAgICB0aGlzLmFjdGl2ZURpZ2VzdENvdW50cy5zZXQoZGlnZXN0LCBhY3RpdmVDb3VudCArIDEpXG4gIH1cblxuICAvKipcbiAgICogUmVsZWFzZXMgb25lIGNhY2hlIG9wZXJhdGlvbiBhbmQgcHJvY2Vzc2VzIGRlZmVycmVkIGRlbGV0aW9uIGFmdGVyIHRoZSBsYXN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZGlnZXN0IENvbnRlbnQgZGlnZXN0LlxuICAgKiBAcGFyYW0ge1NldDxzdHJpbmc+fSBbcHJvdGVjdGVkQ2xlYW51cERpZ2VzdHNdIERpZ2VzdHMgbmVlZGVkIGJ5IHRoZSByZXNvbHZpbmcgY2FsbGVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgYWZ0ZXIgYW55IHBlbmRpbmcgZGVsZXRpb24uXG4gICAqL1xuICBhc3luYyBmaW5pc2hBY3RpdmVEaWdlc3QoZGlnZXN0LCBwcm90ZWN0ZWRDbGVhbnVwRGlnZXN0cyA9IG5ldyBTZXQoKSkge1xuICAgIGNvbnN0IGFjdGl2ZUNvdW50ID0gdGhpcy5hY3RpdmVEaWdlc3RDb3VudHMuZ2V0KGRpZ2VzdClcblxuICAgIGlmIChhY3RpdmVDb3VudCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE1pc3NpbmcgYWN0aXZlIHN5bmNocm9uaXplZCBhc3NldCBkaWdlc3QgY291bnQgZm9yICR7ZGlnZXN0fWApXG4gICAgfVxuXG4gICAgaWYgKGFjdGl2ZUNvdW50ID4gMSkge1xuICAgICAgdGhpcy5hY3RpdmVEaWdlc3RDb3VudHMuc2V0KGRpZ2VzdCwgYWN0aXZlQ291bnQgLSAxKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdGhpcy5hY3RpdmVEaWdlc3RDb3VudHMuZGVsZXRlKGRpZ2VzdClcbiAgICBhd2FpdCB0aGlzLmRlbGV0ZVBlbmRpbmdEaWdlc3RJZlVucmVmZXJlbmNlZChkaWdlc3QpXG5cbiAgICBpZiAodGhpcy5jbGVhbnVwUmVxdWlyZWRBZnRlclJlbGVhc2VEaWdlc3RzLmRlbGV0ZShkaWdlc3QpKSB7XG4gICAgICBhd2FpdCB0aGlzLmNsZWFudXAocHJvdGVjdGVkQ2xlYW51cERpZ2VzdHMpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlbGVhc2VzIGV2ZXJ5IGFjcXVpcmVkIGRpZ2VzdCBiZWZvcmUgcHJvcGFnYXRpbmcgZmluYWxpemF0aW9uIGZhaWx1cmVzLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBkaWdlc3RzIENvbnRlbnQgZGlnZXN0cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIGFmdGVyIGV2ZXJ5IGRpZ2VzdCBpcyByZWxlYXNlZC5cbiAgICovXG4gIGFzeW5jIGZpbmlzaEFjdGl2ZURpZ2VzdHMoZGlnZXN0cykge1xuICAgIC8qKiBAdHlwZSB7RXJyb3JbXX0gKi9cbiAgICBjb25zdCBmYWlsdXJlcyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IGRpZ2VzdCBvZiBkaWdlc3RzKSB7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLmZpbmlzaEFjdGl2ZURpZ2VzdChkaWdlc3QpXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBmYWlsdXJlcy5wdXNoKGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoZmFpbHVyZXMubGVuZ3RoID09PSAxKSB0aHJvdyBmYWlsdXJlc1swXVxuICAgIGlmIChmYWlsdXJlcy5sZW5ndGggPiAxKSB7XG4gICAgICB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoZmFpbHVyZXMsIFwiTXVsdGlwbGUgc3luY2hyb25pemVkIGFzc2V0IGRpZ2VzdCBmaW5hbGl6ZXJzIGZhaWxlZFwiLCB7Y2F1c2U6IGZhaWx1cmVzWzBdfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRGVsZXRlcyBibG9icyB0aGF0IGxvc3QgdGhlaXIgZmluYWwgZGVzY3JpcHRvciByZWZlcmVuY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyBhZnRlciBkZWxldGlvbi5cbiAgICovXG4gIGFzeW5jIGRlbGV0ZVVucmVmZXJlbmNlZERpZ2VzdHMoKSB7XG4gICAgaWYgKCF0aGlzLnN0YXRlKSB0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3QgZGVsZXRlIHN5bmNocm9uaXplZCBhc3NldCBibG9icyBiZWZvcmUgbG9hZGluZyBzdGF0ZVwiKVxuXG4gICAgZm9yIChjb25zdCBkaWdlc3Qgb2YgWy4uLnRoaXMuc3RhdGUucGVuZGluZ0RlbGV0aW9uRGlnZXN0c10pIHtcbiAgICAgIGF3YWl0IHRoaXMuZGVsZXRlUGVuZGluZ0RpZ2VzdElmVW5yZWZlcmVuY2VkKGRpZ2VzdClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRGVsZXRlcyBvbmUgcGVyc2lzdGVkIHBlbmRpbmcgZGlnZXN0IHdoZW4gbm8gZGVzY3JpcHRvciBvciBhY3RpdmUgb3BlcmF0aW9uIG93bnMgaXQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBkaWdlc3QgQ29udGVudCBkaWdlc3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyBhZnRlciBhbnkgcmVxdWlyZWQgZGVsZXRpb24uXG4gICAqL1xuICBhc3luYyBkZWxldGVQZW5kaW5nRGlnZXN0SWZVbnJlZmVyZW5jZWQoZGlnZXN0KSB7XG4gICAgaWYgKCF0aGlzLnN0YXRlKSB0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3QgZGVsZXRlIHN5bmNocm9uaXplZCBhc3NldCBibG9icyBiZWZvcmUgbG9hZGluZyBzdGF0ZVwiKVxuICAgIGlmICghdGhpcy5zdGF0ZS5wZW5kaW5nRGVsZXRpb25EaWdlc3RzLmluY2x1ZGVzKGRpZ2VzdCkpIHJldHVyblxuXG4gICAgYXdhaXQgdGhpcy5kZWxldGVEaWdlc3RJZkluYWN0aXZlKGRpZ2VzdCwgYXN5bmMgKCkgPT4ge1xuICAgICAgaWYgKCF0aGlzLnN0YXRlKSB0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3QgZGVsZXRlIHN5bmNocm9uaXplZCBhc3NldCBibG9icyBiZWZvcmUgbG9hZGluZyBzdGF0ZVwiKVxuICAgICAgaWYgKCF0aGlzLnN0YXRlLnBlbmRpbmdEZWxldGlvbkRpZ2VzdHMuaW5jbHVkZXMoZGlnZXN0KSkgcmV0dXJuIGZhbHNlXG5cbiAgICAgIGxldCBkZWxldGVkID0gZmFsc2VcblxuICAgICAgaWYgKCF0aGlzLnN0YXRlLmFzc2V0cy5zb21lKChlbnRyeSkgPT4gZW50cnkuZGVzY3JpcHRvci5kaWdlc3QgPT09IGRpZ2VzdCkpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5hZGFwdGVyLmRlbGV0ZUJsb2Ioe2FjY291bnRJZDogdGhpcy5hY2NvdW50SWQsIGRpZ2VzdH0pXG4gICAgICAgIGRlbGV0ZWQgPSB0cnVlXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHBlbmRpbmdEZWxldGlvbkRpZ2VzdHMgPSB0aGlzLnN0YXRlLnBlbmRpbmdEZWxldGlvbkRpZ2VzdHNcblxuICAgICAgdGhpcy5zdGF0ZS5wZW5kaW5nRGVsZXRpb25EaWdlc3RzID0gcGVuZGluZ0RlbGV0aW9uRGlnZXN0cy5maWx0ZXIoKGNhbmRpZGF0ZSkgPT4gY2FuZGlkYXRlICE9PSBkaWdlc3QpXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMuc2F2ZVN0YXRlKClcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGlmICghdGhpcy5zdGF0ZS5wZW5kaW5nRGVsZXRpb25EaWdlc3RzLmluY2x1ZGVzKGRpZ2VzdCkpIHRoaXMuc3RhdGUucGVuZGluZ0RlbGV0aW9uRGlnZXN0cy5wdXNoKGRpZ2VzdClcbiAgICAgICAgdGhyb3cgZXJyb3JcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGRlbGV0ZWRcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgb25lIGRlbGV0aW9uIG9ubHkgYWZ0ZXIgZWFybGllciBkZWxldGlvbiB3b3JrIGFuZCB3aGVuIG5vIGNhY2hlIG9wZXJhdGlvbiBvd25zIHRoZSBkaWdlc3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBkaWdlc3QgQ29udGVudCBkaWdlc3QuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxib29sZWFuPn0gY2FsbGJhY2sgUHJvdGVjdGVkIGRlbGV0aW9uIGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gV2hldGhlciB0aGUgY2FsbGJhY2sgZGVsZXRlZCB0aGUgYmxvYi5cbiAgICovXG4gIGFzeW5jIGRlbGV0ZURpZ2VzdElmSW5hY3RpdmUoZGlnZXN0LCBjYWxsYmFjaykge1xuICAgIGxldCBhY3RpdmVEZWxldGlvblByb21pc2UgPSB0aGlzLmRlbGV0aW9uUHJvbWlzZXMuZ2V0KGRpZ2VzdClcblxuICAgIHdoaWxlIChhY3RpdmVEZWxldGlvblByb21pc2UpIHtcbiAgICAgIGF3YWl0IGFjdGl2ZURlbGV0aW9uUHJvbWlzZVxuICAgICAgYWN0aXZlRGVsZXRpb25Qcm9taXNlID0gdGhpcy5kZWxldGlvblByb21pc2VzLmdldChkaWdlc3QpXG4gICAgfVxuXG4gICAgaWYgKHRoaXMuYWN0aXZlRGlnZXN0Q291bnRzLmhhcyhkaWdlc3QpKSByZXR1cm4gZmFsc2VcblxuICAgIC8qKlxuICAgICAqIFJlbGVhc2VzIGNhbGxlcnMgd2FpdGluZyBmb3IgZGVsZXRpb24gY29tcGxldGlvbi5cbiAgICAgKiBAdHlwZSB7KCkgPT4gdm9pZH1cbiAgICAgKi9cbiAgICBsZXQgcmVsZWFzZURlbGV0aW9uID0gKCkgPT4ge31cbiAgICAvKipcbiAgICAgKiBCbG9ja3MgbmV3IGRpZ2VzdCBhY3Rpdml0eSB1bnRpbCBkZWxldGlvbiBjb21wbGV0ZXMuXG4gICAgICogQHR5cGUge1Byb21pc2U8dm9pZD59XG4gICAgICovXG4gICAgY29uc3QgZGVsZXRpb25Qcm9taXNlID0gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICAgIHJlbGVhc2VEZWxldGlvbiA9ICgpID0+IHJlc29sdmUodW5kZWZpbmVkKVxuICAgIH0pXG5cbiAgICB0aGlzLmRlbGV0aW9uUHJvbWlzZXMuc2V0KGRpZ2VzdCwgZGVsZXRpb25Qcm9taXNlKVxuXG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBhd2FpdCBjYWxsYmFjaygpXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGlmICh0aGlzLmRlbGV0aW9uUHJvbWlzZXMuZ2V0KGRpZ2VzdCkgPT09IGRlbGV0aW9uUHJvbWlzZSkgdGhpcy5kZWxldGlvblByb21pc2VzLmRlbGV0ZShkaWdlc3QpXG4gICAgICByZWxlYXNlRGVsZXRpb24oKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBGaW5kcyByZXF1aXJlZCBhc3NldHMgd2l0aG91dCBsb2NhbGx5IGNhY2hlZCBieXRlcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNjb3BlS2V5IFN5bmNocm9uaXplZCBzY29wZSB0byBpbnNwZWN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmdbXT59IE1pc3NpbmcgcmVxdWlyZWQgZGVzY3JpcHRvciBpZHMuXG4gICAqL1xuICBhc3luYyBtaXNzaW5nUmVxdWlyZWRBc3NldElkcyhzY29wZUtleSkge1xuICAgIGNvbnN0IHN0YXRlID0gYXdhaXQgdGhpcy5sb2FkU3RhdGUoKVxuICAgIC8qKiBAdHlwZSB7c3RyaW5nW119ICovXG4gICAgY29uc3QgbWlzc2luZ0Fzc2V0SWRzID0gW11cblxuICAgIGZvciAoY29uc3QgZW50cnkgb2Ygc3RhdGUuYXNzZXRzKSB7XG4gICAgICBpZiAoIWVudHJ5LnNjb3BlS2V5cy5pbmNsdWRlcyhzY29wZUtleSkpIGNvbnRpbnVlXG4gICAgICBpZiAoZW50cnkuZGVzY3JpcHRvci5vZmZsaW5lUmVxdWlyZW1lbnQgIT09IFwicmVxdWlyZWRcIikgY29udGludWVcbiAgICAgIGlmIChhd2FpdCB0aGlzLmNhY2hlZFVyaShlbnRyeSkpIGNvbnRpbnVlXG5cbiAgICAgIG1pc3NpbmdBc3NldElkcy5wdXNoKGVudHJ5LmRlc2NyaXB0b3IuaWQpXG4gICAgfVxuXG4gICAgcmV0dXJuIG1pc3NpbmdBc3NldElkc1xuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrcyB3aGV0aGVyIGEgZmFpbGVkIG9yIG1pc3NpbmcgZW50cnkgbWF5IGJlIGRvd25sb2FkZWQgbm93LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZUVudHJ5fSBlbnRyeSBEZXNjcmlwdG9yIHN0YXRlLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gV2hldGhlciB0aGUgcmV0cnkgZGVhZGxpbmUgaGFzIHBhc3NlZC5cbiAgICovXG4gIHJldHJ5RWxpZ2libGUoZW50cnkpIHtcbiAgICByZXR1cm4gZW50cnkuc3RhdHVzICE9PSBcImZhaWxlZFwiIHx8IGVudHJ5Lm5leHRSZXRyeUF0ID09PSBudWxsIHx8IGVudHJ5Lm5leHRSZXRyeUF0IDw9IHRoaXMubm93TWlsbGlzZWNvbmRzKClcbiAgfVxuXG4gIC8qKlxuICAgKiBDYWxjdWxhdGVzIGJvdW5kZWQgZXhwb25lbnRpYWwgcmV0cnkgZGVsYXkuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhdHRlbXB0cyBDb25zZWN1dGl2ZSBmYWlsdXJlcy5cbiAgICogQHJldHVybnMge251bWJlcn0gUmV0cnkgZGVsYXkuXG4gICAqL1xuICByZXRyeURlbGF5KGF0dGVtcHRzKSB7XG4gICAgcmV0dXJuIE1hdGgubWluKHRoaXMucmV0cnlNYXhEZWxheU1zLCB0aGlzLnJldHJ5QmFzZURlbGF5TXMgKiAoMiAqKiBNYXRoLm1heCgwLCBhdHRlbXB0cyAtIDEpKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkcyB0aGUgaW5qZWN0YWJsZSB3YWxsIGNsb2NrLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSBDdXJyZW50IGVwb2NoIG1pbGxpc2Vjb25kcy5cbiAgICovXG4gIG5vd01pbGxpc2Vjb25kcygpIHtcbiAgICByZXR1cm4gdGhpcy5ub3coKS5nZXRUaW1lKClcbiAgfVxufVxuIl19