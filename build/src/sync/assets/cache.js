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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2FjaGUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvc3luYy9hc3NldHMvY2FjaGUuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sY0FBYyxNQUFNLGlDQUFpQyxDQUFBO0FBRTVELE1BQU0sbUJBQW1CLEdBQUcsQ0FBQyxDQUFBO0FBQzdCLE1BQU0sMkJBQTJCLEdBQUcsSUFBSSxDQUFBO0FBQ3hDLE1BQU0sMEJBQTBCLEdBQUcsSUFBSSxHQUFHLEVBQUUsR0FBRyxDQUFDLENBQUE7QUFFaEQ7OztHQUdHO0FBQ0gsTUFBTSxDQUFDLE9BQU8sT0FBTyxzQkFBc0I7SUFDekM7Ozs7Ozs7Ozs7T0FVRztJQUNILFlBQVksRUFBQyxTQUFTLEVBQUUsT0FBTyxFQUFFLFFBQVEsRUFBRSxRQUFRLEVBQUUsR0FBRyxHQUFHLEdBQUcsRUFBRSxDQUFDLElBQUksSUFBSSxFQUFFLEVBQUUsZ0JBQWdCLEdBQUcsMkJBQTJCLEVBQUUsZUFBZSxHQUFHLDBCQUEwQixFQUFDO1FBQ3hLLElBQUksQ0FBQyxTQUFTO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxpREFBaUQsQ0FBQyxDQUFBO1FBQ2xGLElBQUksQ0FBQyxNQUFNLENBQUMsYUFBYSxDQUFDLFFBQVEsQ0FBQyxJQUFJLFFBQVEsR0FBRyxDQUFDO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyx1RUFBdUUsQ0FBQyxDQUFBO1FBQzdJLElBQUksQ0FBQyxNQUFNLENBQUMsYUFBYSxDQUFDLGdCQUFnQixDQUFDLElBQUksZ0JBQWdCLEdBQUcsQ0FBQztZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsMkVBQTJFLENBQUMsQ0FBQTtRQUNqSyxJQUFJLENBQUMsTUFBTSxDQUFDLGFBQWEsQ0FBQyxlQUFlLENBQUMsSUFBSSxlQUFlLEdBQUcsZ0JBQWdCO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyw0RUFBNEUsQ0FBQyxDQUFBO1FBRS9LLElBQUksQ0FB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VyxJQUFJLElBQUksQ0FBQyxlQUFlLEVBQUUsQ0FBQTtJQUMvRyxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILFVBQVUsQ0FBQyxRQUFRO1FBQ2pCLE9BQU8sSUFBSSxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsZUFBZSxFQUFFLElBQUksQ0FBQyxnQkFBZ0IsR0FBRyxDQUFDLENBQUMsSUFBSSxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsRUFBRSxRQUFRLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFBO0lBQ2pHLENBQUM7SUFFRDs7O09BR0c7SUFDSCxlQUFlO1FBQ2IsT0FBTyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUMsT0FBTyxFQUFFLENBQUE7SUFDN0IsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBzaGEyNTZCeXRlc0hleCBmcm9tIFwiLi4vLi4vdXRpbHMvc2hhMjU2LWJ5dGVzLWhleC5qc1wiXG5cbmNvbnN0IENBQ0hFX1NUQVRFX1ZFUlNJT04gPSAxXG5jb25zdCBERUZBVUxUX1JFVFJZX0JBU0VfREVMQVlfTVMgPSAxMDAwXG5jb25zdCBERUZBVUxUX1JFVFJZX01BWF9ERUxBWV9NUyA9IDEwMDAgKiA2MCAqIDVcblxuLyoqXG4gKiBDb3JlIHN5bmNocm9uaXplZCBhc3NldCBjYWNoZS4gUGxhdGZvcm0gcGFja2FnZXMgb3duIGJ5dGUgYW5kIG1ldGFkYXRhXG4gKiBwZXJzaXN0ZW5jZSB3aGlsZSB0aGlzIGNsYXNzIG93bnMgcG9saWN5LCBpbnRlZ3JpdHksIGFuZCBsaWZlY3ljbGUuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFN5bmNocm9uaXplZEFzc2V0Q2FjaGUge1xuICAvKipcbiAgICogQ3JlYXRlcyBhIHN5bmNocm9uaXplZCBhc3NldCBjYWNoZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuYWNjb3VudElkIEF1dGhlbnRpY2F0ZWQgYWNjb3VudCBuYW1lc3BhY2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlQWRhcHRlcn0gYXJncy5hZGFwdGVyIFBsYXRmb3JtIHN0b3JhZ2UgYWRhcHRlci5cbiAgICogQHBhcmFtIHsoZGVzY3JpcHRvcjogaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlRGVzY3JpcHRvcikgPT4gUHJvbWlzZTxVaW50OEFycmF5Pn0gYXJncy5kb3dubG9hZCBBdXRoZW50aWNhdGVkIGJ5dGUgZG93bmxvYWRlci5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MubWF4Qnl0ZXMgTWF4aW11bSBldmljdGFibGUgY2FjaGUgc2l6ZS5cbiAgICogQHBhcmFtIHsoKSA9PiBEYXRlfSBbYXJncy5ub3ddIENsb2NrLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MucmV0cnlCYXNlRGVsYXlNc10gSW5pdGlhbCByZXRyeSBkZWxheS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLnJldHJ5TWF4RGVsYXlNc10gTWF4aW11bSByZXRyeSBkZWxheS5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHthY2NvdW50SWQsIGFkYXB0ZXIsIGRvd25sb2FkLCBtYXhCeXRlcywgbm93ID0gKCkgPT4gbmV3IERhdGUoKSwgcmV0cnlCYXNlRGVsYXlNcyA9IERFRkFVTFRfUkVUUllfQkFTRV9ERUxBWV9NUywgcmV0cnlNYXhEZWxheU1zID0gREVGQVVMVF9SRVRSWV9NQVhfREVMQVlfTVN9KSB7XG4gICAgaWYgKCFhY2NvdW50SWQpIHRocm93IG5ldyBFcnJvcihcIlN5bmNocm9uaXplZCBhc3NldCBjYWNoZSByZXF1aXJlcyBhbiBhY2NvdW50IGlkXCIpXG4gICAgaWYgKCFOdW1iZXIuaXNTYWZlSW50ZWdlcihtYXhCeXRlcykgfHwgbWF4Qnl0ZXMgPCAwKSB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jaHJvbml6ZWQgYXNzZXQgY2FjaGUgbWF4Qnl0ZXMgbXVzdCBiZSBhIG5vbi1uZWdhdGl2ZSBzYWZlIGludGVnZXJcIilcbiAgICBpZiAoIU51bWJlci5pc1NhZmVJbnRlZ2VyKHJldHJ5QmFzZURlbGF5TXMpIHx8IHJldHJ5QmFzZURlbGF5TXMgPCAxKSB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jaHJvbml6ZWQgYXNzZXQgY2FjaGUgcmV0cnlCYXNlRGVsYXlNcyBtdXN0IGJlIGEgcG9zaXRpdmUgc2FmZSBpbnRlZ2VyXCIpXG4gICAgaWYgKCFOdW1iZXIuaXNTYWZlSW50ZWdlcihyZXRyeU1heERlbGF5TXMpIHx8IHJldHJ5TWF4RGVsYXlNcyA8IHJldHJ5QmFzZURlbGF5TXMpIHRocm93IG5ldyBFcnJvcihcIlN5bmNocm9uaXplZCBhc3NldCBjYWNoZSByZXRyeU1heERlbGF5TXMgbXVzdCBiZSBhdCBsZWFzdCByZXRyeUJhc2VEZWxheU1zXCIpXG5cbiAgICB0aGlzLmFjY291bnRJZCA9IGFjY291bnRJZFxuICAgIHRoaXMuYWRhcHRlciA9IGFkYXB0ZXJcbiAgICB0aGlzLmRvd25sb2FkID0gZG93bmxvYWRcbiAgICB0aGlzLm1heEJ5dGVzID0gbWF4Qnl0ZXNcbiAgICB0aGlzLm5vdyA9IG5vd1xuICAgIHRoaXMucmV0cnlCYXNlRGVsYXlNcyA9IHJldHJ5QmFzZURlbGF5TXNcbiAgICB0aGlzLnJldHJ5TWF4RGVsYXlNcyA9IHJldHJ5TWF4RGVsYXlNc1xuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgbnVtYmVyPn0gKi9cbiAgICB0aGlzLmFjdGl2ZURpZ2VzdENvdW50cyA9IG5ldyBNYXAoKVxuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgUHJvbWlzZTx2b2lkPj59ICovXG4gICAgdGhpcy5kZWxldGlvblByb21pc2VzID0gbmV3IE1hcCgpXG4gICAgLyoqIEB0eXBlIHtTZXQ8c3RyaW5nPn0gKi9cbiAgICB0aGlzLmNsZWFudXBSZXF1aXJlZEFmdGVyUmVsZWFzZURpZ2VzdHMgPSBuZXcgU2V0KClcbiAgICAvKiogQHR5cGUge1Byb21pc2U8bnVtYmVyPn0gKi9cbiAgICB0aGlzLmNsZWFudXBQcm9taXNlID0gUHJvbWlzZS5yZXNvbHZlKDApXG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBQcm9taXNlPHtlcnJvcjogRXJyb3IsIHVyaTogbnVsbH0gfCB7ZXJyb3I6IG51bGwsIHVyaTogc3RyaW5nfT4+fSAqL1xuICAgIHRoaXMuZG93bmxvYWRQcm9taXNlcyA9IG5ldyBNYXAoKVxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlU3RhdGUgfCBudWxsfSAqL1xuICAgIHRoaXMuc3RhdGUgPSBudWxsXG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZVN0YXRlPiB8IG51bGx9ICovXG4gICAgdGhpcy5zdGF0ZVByb21pc2UgPSBudWxsXG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+fSAqL1xuICAgIHRoaXMuc2F2ZVN0YXRlUHJvbWlzZSA9IFByb21pc2UucmVzb2x2ZSgpXG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZVN5bmNocm9uaXphdGlvblJlc3VsdD4+fSAqL1xuICAgIHRoaXMuc3luY2hyb25pemVQcm9taXNlcyA9IG5ldyBNYXAoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlY29uY2lsZXMgdGhlIGltbXV0YWJsZSBkZXNjcmlwdG9ycyBmb3Igb25lIHN5bmNocm9uaXplZCBzY29wZSBhbmRcbiAgICogZG93bmxvYWRzIGVsaWdpYmxlIGVhZ2VyIGFzc2V0cy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgUmVjb25jaWxpYXRpb24gaW5wdXRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZURlc2NyaXB0b3JbXX0gYXJncy5kZXNjcmlwdG9ycyBDdXJyZW50IGRlc2NyaXB0b3JzIGluIHRoZSBzY29wZS5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLm9ubGluZSBXaGV0aGVyIGF1dGhlbnRpY2F0ZWQgZG93bmxvYWRzIGFyZSBhdmFpbGFibGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnNjb3BlS2V5IFN0YWJsZSBzeW5jaHJvbml6ZWQgc2NvcGUga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVTeW5jaHJvbml6YXRpb25SZXN1bHQ+fSBTeW5jaHJvbml6YXRpb24gcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgc3luY2hyb25pemUoe2Rlc2NyaXB0b3JzLCBvbmxpbmUsIHNjb3BlS2V5fSkge1xuICAgIGNvbnN0IHN5bmNocm9uaXplID0gYXN5bmMgKCkgPT4gYXdhaXQgdGhpcy5zeW5jaHJvbml6ZVNjb3BlKHtkZXNjcmlwdG9ycywgb25saW5lLCBzY29wZUtleX0pXG4gICAgY29uc3QgcHJldmlvdXNTeW5jaHJvbml6YXRpb25Qcm9taXNlID0gdGhpcy5zeW5jaHJvbml6ZVByb21pc2VzLmdldChzY29wZUtleSlcbiAgICBjb25zdCBzeW5jaHJvbml6YXRpb25Qcm9taXNlID0gcHJldmlvdXNTeW5jaHJvbml6YXRpb25Qcm9taXNlXG4gICAgICA/IHByZXZpb3VzU3luY2hyb25pemF0aW9uUHJvbWlzZS50aGVuKHN5bmNocm9uaXplLCBzeW5jaHJvbml6ZSlcbiAgICAgIDogc3luY2hyb25pemUoKVxuXG4gICAgdGhpcy5zeW5jaHJvbml6ZVByb21pc2VzLnNldChzY29wZUtleSwgc3luY2hyb25pemF0aW9uUHJvbWlzZSlcblxuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgc3luY2hyb25pemF0aW9uUHJvbWlzZVxuICAgIH0gZmluYWxseSB7XG4gICAgICBpZiAodGhpcy5zeW5jaHJvbml6ZVByb21pc2VzLmdldChzY29wZUtleSkgPT09IHN5bmNocm9uaXphdGlvblByb21pc2UpIHtcbiAgICAgICAgdGhpcy5zeW5jaHJvbml6ZVByb21pc2VzLmRlbGV0ZShzY29wZUtleSlcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBvbmUgc2NvcGUgc3luY2hyb25pemF0aW9uIGFmdGVyIHByaW9yIGNhbGxzIGZvciB0aGF0IHNjb3BlIGZpbmlzaC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgUmVjb25jaWxpYXRpb24gaW5wdXRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZURlc2NyaXB0b3JbXX0gYXJncy5kZXNjcmlwdG9ycyBDdXJyZW50IGRlc2NyaXB0b3JzIGluIHRoZSBzY29wZS5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLm9ubGluZSBXaGV0aGVyIGF1dGhlbnRpY2F0ZWQgZG93bmxvYWRzIGFyZSBhdmFpbGFibGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnNjb3BlS2V5IFN0YWJsZSBzeW5jaHJvbml6ZWQgc2NvcGUga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVTeW5jaHJvbml6YXRpb25SZXN1bHQ+fSBTeW5jaHJvbml6YXRpb24gcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgc3luY2hyb25pemVTY29wZSh7ZGVzY3JpcHRvcnMsIG9ubGluZSwgc2NvcGVLZXl9KSB7XG4gICAgYXdhaXQgdGhpcy5sb2FkU3RhdGUoKVxuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlRGVzY3JpcHRvcltdPn0gKi9cbiAgICBjb25zdCBkZXNjcmlwdG9yc0J5RGlnZXN0ID0gbmV3IE1hcCgpXG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVGYWlsdXJlW119ICovXG4gICAgY29uc3QgZmFpbHVyZXMgPSBbXVxuICAgIC8qKiBAdHlwZSB7U2V0PHN0cmluZz59ICovXG4gICAgY29uc3QgYWN0aXZlRGlnZXN0cyA9IG5ldyBTZXQoKVxuXG4gICAgZm9yIChjb25zdCBkZXNjcmlwdG9yIG9mIGRlc2NyaXB0b3JzKSB7XG4gICAgICBjb25zdCBkaWdlc3REZXNjcmlwdG9ycyA9IGRlc2NyaXB0b3JzQnlEaWdlc3QuZ2V0KGRlc2NyaXB0b3IuZGlnZXN0KSB8fCBbXVxuXG4gICAgICBkaWdlc3REZXNjcmlwdG9ycy5wdXNoKGRlc2NyaXB0b3IpXG4gICAgICBkZXNjcmlwdG9yc0J5RGlnZXN0LnNldChkZXNjcmlwdG9yLmRpZ2VzdCwgZGlnZXN0RGVzY3JpcHRvcnMpXG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGZvciAoY29uc3QgZGlnZXN0IG9mIGRlc2NyaXB0b3JzQnlEaWdlc3Qua2V5cygpKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuYmVnaW5BY3RpdmVEaWdlc3QoZGlnZXN0KVxuICAgICAgICBhY3RpdmVEaWdlc3RzLmFkZChkaWdlc3QpXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGVudHJpZXNCeUlkID0gYXdhaXQgdGhpcy5yZWNvbmNpbGVEZXNjcmlwdG9ycyh7ZGVzY3JpcHRvcnMsIHNjb3BlS2V5fSlcblxuICAgICAgYXdhaXQgdGhpcy5kZWxldGVVbnJlZmVyZW5jZWREaWdlc3RzKClcblxuICAgICAgZm9yIChjb25zdCBbZGlnZXN0LCBkaWdlc3REZXNjcmlwdG9yc10gb2YgZGVzY3JpcHRvcnNCeURpZ2VzdCkge1xuICAgICAgICBjb25zdCBlYWdlckRlc2NyaXB0b3JzID0gb25saW5lID8gZGlnZXN0RGVzY3JpcHRvcnMuZmlsdGVyKChkZXNjcmlwdG9yKSA9PiBkZXNjcmlwdG9yLmZldGNoID09PSBcImVhZ2VyXCIpIDogW11cblxuICAgICAgICBpZiAoZWFnZXJEZXNjcmlwdG9ycy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICBhY3RpdmVEaWdlc3RzLmRlbGV0ZShkaWdlc3QpXG4gICAgICAgICAgYXdhaXQgdGhpcy5maW5pc2hBY3RpdmVEaWdlc3QoZGlnZXN0KVxuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH1cblxuICAgICAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZUVudHJ5W119ICovXG4gICAgICAgIGNvbnN0IGVhZ2VyRW50cmllcyA9IFtdXG5cbiAgICAgICAgZm9yIChjb25zdCBkZXNjcmlwdG9yIG9mIGVhZ2VyRGVzY3JpcHRvcnMpIHtcbiAgICAgICAgICBjb25zdCBlbnRyeSA9IGVudHJpZXNCeUlkLmdldChkZXNjcmlwdG9yLmlkKVxuXG4gICAgICAgICAgaWYgKCFlbnRyeSkgdGhyb3cgbmV3IEVycm9yKGBNaXNzaW5nIHJlY29uY2lsZWQgc3luY2hyb25pemVkIGFzc2V0IGRlc2NyaXB0b3IgJHtkZXNjcmlwdG9yLmlkfWApXG5cbiAgICAgICAgICBlYWdlckVudHJpZXMucHVzaChlbnRyeSlcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChlYWdlckVudHJpZXMuc29tZSgoZW50cnkpID0+IHRoaXMucmV0cnlFbGlnaWJsZShlbnRyeSkpKSB7XG4gICAgICAgICAgY29uc3QgY2FjaGVSZXN1bHQgPSBhd2FpdCB0aGlzLmVuc3VyZUNhY2hlZFdoaWxlQWN0aXZlKGVhZ2VyRW50cmllcylcblxuICAgICAgICAgIGlmIChjYWNoZVJlc3VsdC5lcnJvcikge1xuICAgICAgICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiBlYWdlckVudHJpZXMpIHtcbiAgICAgICAgICAgICAgZmFpbHVyZXMucHVzaCh7YXNzZXRJZDogZW50cnkuZGVzY3JpcHRvci5pZCwgZXJyb3I6IGNhY2hlUmVzdWx0LmVycm9yfSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBhY3RpdmVEaWdlc3RzLmRlbGV0ZShkaWdlc3QpXG4gICAgICAgIGF3YWl0IHRoaXMuZmluaXNoQWN0aXZlRGlnZXN0KGRpZ2VzdClcbiAgICAgICAgYXdhaXQgdGhpcy5jbGVhbnVwKClcbiAgICAgIH1cbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgdGhpcy5maW5pc2hBY3RpdmVEaWdlc3RzKFsuLi5hY3RpdmVEaWdlc3RzXSlcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLmNsZWFudXAoKVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGZhaWx1cmVzLFxuICAgICAgbWlzc2luZ1JlcXVpcmVkQXNzZXRJZHM6IGF3YWl0IHRoaXMubWlzc2luZ1JlcXVpcmVkQXNzZXRJZHMoc2NvcGVLZXkpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGEgY2FjaGVkIGFzc2V0IFVSSSwgZG93bmxvYWRpbmcgaXQgb24gZGVtYW5kIHdoZW4gYWxsb3dlZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgUmVzb2x1dGlvbiBpbnB1dHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmFzc2V0SWQgQXR0YWNobWVudCBkZXNjcmlwdG9yIGlkLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3Mub25saW5lIFdoZXRoZXIgYXV0aGVudGljYXRlZCBkb3dubG9hZHMgYXJlIGF2YWlsYWJsZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nIHwgbnVsbD59IENhY2hlZCBhc3NldCBVUkkuXG4gICAqL1xuICBhc3luYyByZXNvbHZlKHthc3NldElkLCBvbmxpbmV9KSB7XG4gICAgY29uc3Qgc3RhdGUgPSBhd2FpdCB0aGlzLmxvYWRTdGF0ZSgpXG4gICAgY29uc3QgZW50cnkgPSBzdGF0ZS5hc3NldHMuZmluZCgoY2FuZGlkYXRlKSA9PiBjYW5kaWRhdGUuZGVzY3JpcHRvci5pZCA9PT0gYXNzZXRJZClcblxuICAgIGlmICghZW50cnkpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCBkaWdlc3QgPSBlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdFxuICAgIGxldCByZXNvbHZlZFVyaSA9IG51bGxcbiAgICBsZXQgc2hvdWxkQ2xlYW51cCA9IGZhbHNlXG5cbiAgICBhd2FpdCB0aGlzLmJlZ2luQWN0aXZlRGlnZXN0KGRpZ2VzdClcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBjYWNoZWRVcmkgPSBhd2FpdCB0aGlzLmNhY2hlZFVyaVdoaWxlQWN0aXZlKGVudHJ5KVxuXG4gICAgICBpZiAoY2FjaGVkVXJpKSB7XG4gICAgICAgIGVudHJ5Lmxhc3RBY2Nlc3NlZEF0ID0gdGhpcy5ub3dNaWxsaXNlY29uZHMoKVxuICAgICAgICBlbnRyeS5zdGF0dXMgPSBcImNhY2hlZFwiXG4gICAgICAgIGF3YWl0IHRoaXMuc2F2ZVN0YXRlKClcblxuICAgICAgICByZXNvbHZlZFVyaSA9IGNhY2hlZFVyaVxuICAgICAgfSBlbHNlIGlmIChvbmxpbmUgJiYgdGhpcy5yZXRyeUVsaWdpYmxlKGVudHJ5KSkge1xuICAgICAgICBjb25zdCBjYWNoZVJlc3VsdCA9IGF3YWl0IHRoaXMuZW5zdXJlQ2FjaGVkV2hpbGVBY3RpdmUoW2VudHJ5XSlcblxuICAgICAgICBpZiAoY2FjaGVSZXN1bHQuZXJyb3IpIHRocm93IGNhY2hlUmVzdWx0LmVycm9yXG5cbiAgICAgICAgaWYgKGNhY2hlUmVzdWx0LnVyaSkge1xuICAgICAgICAgIHJlc29sdmVkVXJpID0gY2FjaGVSZXN1bHQudXJpXG4gICAgICAgICAgc2hvdWxkQ2xlYW51cCA9IHRydWVcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCB0aGlzLmZpbmlzaEFjdGl2ZURpZ2VzdChkaWdlc3QsIHNob3VsZENsZWFudXAgPyBuZXcgU2V0KFtkaWdlc3RdKSA6IG5ldyBTZXQoKSlcbiAgICB9XG5cbiAgICBpZiAoc2hvdWxkQ2xlYW51cCkgYXdhaXQgdGhpcy5jbGVhbnVwKG5ldyBTZXQoW2RpZ2VzdF0pKVxuICAgIGlmICghcmVzb2x2ZWRVcmkpIHJldHVybiBudWxsXG4gICAgY29uc3QgcmVzb2x2ZWRFbnRyeSA9IHN0YXRlLmFzc2V0cy5maW5kKChjYW5kaWRhdGUpID0+IGNhbmRpZGF0ZS5kZXNjcmlwdG9yLmlkID09PSBhc3NldElkICYmIGNhbmRpZGF0ZS5kZXNjcmlwdG9yLmRpZ2VzdCA9PT0gZGlnZXN0KVxuXG4gICAgaWYgKCFyZXNvbHZlZEVudHJ5KSByZXR1cm4gbnVsbFxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuY2FjaGVkVXJpKHJlc29sdmVkRW50cnkpXG4gIH1cblxuICAvKipcbiAgICogRXZpY3RzIGxlYXN0LXJlY2VudGx5LXVzZWQgYmxvYnMgdW50aWwgdGhlIHVuaXF1ZSBjYWNoZWQgYnl0ZSB0b3RhbCBpc1xuICAgKiB3aXRoaW4gdGhlIGNvbmZpZ3VyZWQgYnVkZ2V0LiBBIGJsb2Igc3RheXMgZHVyYWJsZSB3aGVuIGFueSBsaXZlXG4gICAqIGRlc2NyaXB0b3IgcmVmZXJlbmNlIGRlY2xhcmVzIGR1cmFibGUgcmV0ZW50aW9uLlxuICAgKiBAcGFyYW0ge1NldDxzdHJpbmc+fSBbcHJvdGVjdGVkRGlnZXN0c10gRGlnZXN0cyBuZWVkZWQgYnkgdGhlIGFjdGl2ZSBjYWxsZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IEJ5dGVzIHJlbW92ZWQuXG4gICAqL1xuICBhc3luYyBjbGVhbnVwKHByb3RlY3RlZERpZ2VzdHMgPSBuZXcgU2V0KCkpIHtcbiAgICBjb25zdCBjbGVhbnVwID0gYXN5bmMgKCkgPT4gYXdhaXQgdGhpcy5wZXJmb3JtQ2xlYW51cChwcm90ZWN0ZWREaWdlc3RzKVxuICAgIGNvbnN0IGNsZWFudXBQcm9taXNlID0gdGhpcy5jbGVhbnVwUHJvbWlzZS50aGVuKGNsZWFudXAsIGNsZWFudXApXG5cbiAgICB0aGlzLmNsZWFudXBQcm9taXNlID0gY2xlYW51cFByb21pc2VcblxuICAgIHJldHVybiBhd2FpdCBjbGVhbnVwUHJvbWlzZVxuICB9XG5cbiAgLyoqXG4gICAqIFBlcmZvcm1zIG9uZSBzZXJpYWxpemVkIGV2aWN0aW9uIHBhc3MuXG4gICAqIEBwYXJhbSB7U2V0PHN0cmluZz59IHByb3RlY3RlZERpZ2VzdHMgRGlnZXN0cyBuZWVkZWQgYnkgdGhlIGFjdGl2ZSBjYWxsZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IEJ5dGVzIHJlbW92ZWQuXG4gICAqL1xuICBhc3luYyBwZXJmb3JtQ2xlYW51cChwcm90ZWN0ZWREaWdlc3RzKSB7XG4gICAgY29uc3Qgc3RhdGUgPSBhd2FpdCB0aGlzLmxvYWRTdGF0ZSgpXG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVFbnRyeVtdPn0gKi9cbiAgICBjb25zdCBlbnRyaWVzQnlEaWdlc3QgPSBuZXcgTWFwKClcblxuICAgIGZvciAoY29uc3QgZW50cnkgb2Ygc3RhdGUuYXNzZXRzKSB7XG4gICAgICBjb25zdCBkaWdlc3RFbnRyaWVzID0gZW50cmllc0J5RGlnZXN0LmdldChlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdCkgfHwgW11cblxuICAgICAgZGlnZXN0RW50cmllcy5wdXNoKGVudHJ5KVxuICAgICAgZW50cmllc0J5RGlnZXN0LnNldChlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdCwgZGlnZXN0RW50cmllcylcbiAgICB9XG5cbiAgICAvKiogQHR5cGUge3tieXRlU2l6ZTogbnVtYmVyLCBkaWdlc3Q6IHN0cmluZywgbGFzdEFjY2Vzc2VkQXQ6IG51bWJlcn1bXX0gKi9cbiAgICBjb25zdCBjYWNoZWRCbG9icyA9IFtdXG4gICAgbGV0IGNhY2hlZEJ5dGVzID0gMFxuXG4gICAgZm9yIChjb25zdCBbZGlnZXN0LCByZWZlcmVuY2VzXSBvZiBlbnRyaWVzQnlEaWdlc3QpIHtcbiAgICAgIGNvbnN0IHVyaSA9IGF3YWl0IHRoaXMuYWRhcHRlci5ibG9iVXJpKHthY2NvdW50SWQ6IHRoaXMuYWNjb3VudElkLCBkaWdlc3R9KVxuXG4gICAgICBpZiAoIXVyaSkge1xuICAgICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHJlZmVyZW5jZXMpIHtcbiAgICAgICAgICBpZiAoZW50cnkuc3RhdHVzID09PSBcImNhY2hlZFwiKSBlbnRyeS5zdGF0dXMgPSBcIm1pc3NpbmdcIlxuICAgICAgICB9XG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGJ5dGVTaXplID0gcmVmZXJlbmNlc1swXS5kZXNjcmlwdG9yLmJ5dGVTaXplXG5cbiAgICAgIGNhY2hlZEJ5dGVzICs9IGJ5dGVTaXplXG4gICAgICBjYWNoZWRCbG9icy5wdXNoKHtcbiAgICAgICAgYnl0ZVNpemUsXG4gICAgICAgIGRpZ2VzdCxcbiAgICAgICAgbGFzdEFjY2Vzc2VkQXQ6IE1hdGgubWF4KC4uLnJlZmVyZW5jZXMubWFwKChlbnRyeSkgPT4gZW50cnkubGFzdEFjY2Vzc2VkQXQpKVxuICAgICAgfSlcbiAgICB9XG5cbiAgICBsZXQgcmVtb3ZlZEJ5dGVzID0gMFxuXG4gICAgd2hpbGUgKGNhY2hlZEJsb2JzLmxlbmd0aCA+IDApIHtcbiAgICAgIGlmIChjYWNoZWRCeXRlcyA8PSB0aGlzLm1heEJ5dGVzKSBicmVha1xuXG4gICAgICBmb3IgKGNvbnN0IGNhY2hlZEJsb2Igb2YgY2FjaGVkQmxvYnMpIHtcbiAgICAgICAgY29uc3QgY3VycmVudFJlZmVyZW5jZXMgPSBzdGF0ZS5hc3NldHMuZmlsdGVyKChlbnRyeSkgPT4gZW50cnkuZGVzY3JpcHRvci5kaWdlc3QgPT09IGNhY2hlZEJsb2IuZGlnZXN0KVxuXG4gICAgICAgIGlmIChjdXJyZW50UmVmZXJlbmNlcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgY2FjaGVkQmxvYi5sYXN0QWNjZXNzZWRBdCA9IE1hdGgubWF4KC4uLmN1cnJlbnRSZWZlcmVuY2VzLm1hcCgoZW50cnkpID0+IGVudHJ5Lmxhc3RBY2Nlc3NlZEF0KSlcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBjYWNoZWRCbG9icy5zb3J0KChsZWZ0LCByaWdodCkgPT4gbGVmdC5sYXN0QWNjZXNzZWRBdCAtIHJpZ2h0Lmxhc3RBY2Nlc3NlZEF0IHx8IGxlZnQuZGlnZXN0LmxvY2FsZUNvbXBhcmUocmlnaHQuZGlnZXN0KSlcblxuICAgICAgY29uc3QgYmxvYiA9IGNhY2hlZEJsb2JzLnNoaWZ0KClcblxuICAgICAgaWYgKCFibG9iKSB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RlZCBhIHN5bmNocm9uaXplZCBhc3NldCBjYWNoZSBldmljdGlvbiBjYW5kaWRhdGVcIilcbiAgICAgIGlmIChwcm90ZWN0ZWREaWdlc3RzLmhhcyhibG9iLmRpZ2VzdCkpIGNvbnRpbnVlXG4gICAgICBsZXQgYmxvYldhc0FscmVhZHlNaXNzaW5nID0gZmFsc2VcbiAgICAgIGxldCBkZWxldGlvbkNoZWNrZWQgPSBmYWxzZVxuICAgICAgY29uc3QgZGVsZXRlZCA9IGF3YWl0IHRoaXMuZGVsZXRlRGlnZXN0SWZJbmFjdGl2ZShibG9iLmRpZ2VzdCwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBkZWxldGlvbkNoZWNrZWQgPSB0cnVlXG5cbiAgICAgICAgaWYgKCF0aGlzLnN0YXRlKSB0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3QgY2xlYW4gc3luY2hyb25pemVkIGFzc2V0IGJsb2JzIGJlZm9yZSBsb2FkaW5nIHN0YXRlXCIpXG5cbiAgICAgICAgY29uc3QgY3VycmVudFVyaSA9IGF3YWl0IHRoaXMuYWRhcHRlci5ibG9iVXJpKHthY2NvdW50SWQ6IHRoaXMuYWNjb3VudElkLCBkaWdlc3Q6IGJsb2IuZGlnZXN0fSlcbiAgICAgICAgY29uc3QgY3VycmVudFJlZmVyZW5jZXMgPSB0aGlzLnN0YXRlLmFzc2V0cy5maWx0ZXIoKGVudHJ5KSA9PiBlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdCA9PT0gYmxvYi5kaWdlc3QpXG5cbiAgICAgICAgaWYgKCFjdXJyZW50VXJpKSB7XG4gICAgICAgICAgYmxvYldhc0FscmVhZHlNaXNzaW5nID0gdHJ1ZVxuXG4gICAgICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiBjdXJyZW50UmVmZXJlbmNlcykge1xuICAgICAgICAgICAgaWYgKGVudHJ5LnN0YXR1cyA9PT0gXCJjYWNoZWRcIikgZW50cnkuc3RhdHVzID0gXCJtaXNzaW5nXCJcbiAgICAgICAgICB9XG5cbiAgICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgICAgfVxuICAgICAgICBpZiAoY3VycmVudFJlZmVyZW5jZXMuc29tZSgoZW50cnkpID0+IGVudHJ5LmRlc2NyaXB0b3IucmV0ZW50aW9uID09PSBcImR1cmFibGVcIikpIHJldHVybiBmYWxzZVxuXG4gICAgICAgIGF3YWl0IHRoaXMuYWRhcHRlci5kZWxldGVCbG9iKHthY2NvdW50SWQ6IHRoaXMuYWNjb3VudElkLCBkaWdlc3Q6IGJsb2IuZGlnZXN0fSlcblxuICAgICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGN1cnJlbnRSZWZlcmVuY2VzKSB7XG4gICAgICAgICAgZW50cnkuYXR0ZW1wdHMgPSAwXG4gICAgICAgICAgZW50cnkubmV4dFJldHJ5QXQgPSBudWxsXG4gICAgICAgICAgZW50cnkuc3RhdHVzID0gXCJtaXNzaW5nXCJcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB0cnVlXG4gICAgICB9KVxuXG4gICAgICBpZiAoIWRlbGV0aW9uQ2hlY2tlZCkgdGhpcy5jbGVhbnVwUmVxdWlyZWRBZnRlclJlbGVhc2VEaWdlc3RzLmFkZChibG9iLmRpZ2VzdClcbiAgICAgIGlmIChibG9iV2FzQWxyZWFkeU1pc3NpbmcpIGNhY2hlZEJ5dGVzIC09IGJsb2IuYnl0ZVNpemVcbiAgICAgIGlmICghZGVsZXRlZCkgY29udGludWVcblxuICAgICAgY2FjaGVkQnl0ZXMgLT0gYmxvYi5ieXRlU2l6ZVxuICAgICAgcmVtb3ZlZEJ5dGVzICs9IGJsb2IuYnl0ZVNpemVcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnNhdmVTdGF0ZSgpXG5cbiAgICByZXR1cm4gcmVtb3ZlZEJ5dGVzXG4gIH1cblxuICAvKipcbiAgICogTG9hZHMgY2FjaGUgc3RhdGUgb25jZSBmb3IgdGhpcyBjYWNoZSBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlU3RhdGU+fSBMb2FkZWQgc3RhdGUuXG4gICAqL1xuICBhc3luYyBsb2FkU3RhdGUoKSB7XG4gICAgaWYgKHRoaXMuc3RhdGUpIHJldHVybiB0aGlzLnN0YXRlXG4gICAgaWYgKHRoaXMuc3RhdGVQcm9taXNlKSByZXR1cm4gYXdhaXQgdGhpcy5zdGF0ZVByb21pc2VcblxuICAgIHRoaXMuc3RhdGVQcm9taXNlID0gdGhpcy5sb2FkU3RhdGVGcm9tQWRhcHRlcigpXG5cbiAgICB0cnkge1xuICAgICAgdGhpcy5zdGF0ZSA9IGF3YWl0IHRoaXMuc3RhdGVQcm9taXNlXG5cbiAgICAgIHJldHVybiB0aGlzLnN0YXRlXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMuc3RhdGVQcm9taXNlID0gbnVsbFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBMb2FkcyBhbmQgcmVjb3ZlcnMgcGVyc2lzdGVkIGNhY2hlIHN0YXRlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVTdGF0ZT59IExvYWRlZCBzdGF0ZS5cbiAgICovXG4gIGFzeW5jIGxvYWRTdGF0ZUZyb21BZGFwdGVyKCkge1xuICAgIGNvbnN0IGxvYWRlZFN0YXRlID0gYXdhaXQgdGhpcy5hZGFwdGVyLmxvYWRTdGF0ZSh7YWNjb3VudElkOiB0aGlzLmFjY291bnRJZH0pXG5cbiAgICBpZiAoIWxvYWRlZFN0YXRlKSByZXR1cm4ge2Fzc2V0czogW10sIHBlbmRpbmdEZWxldGlvbkRpZ2VzdHM6IFtdLCB2ZXJzaW9uOiBDQUNIRV9TVEFURV9WRVJTSU9OfVxuICAgIGlmIChsb2FkZWRTdGF0ZS52ZXJzaW9uICE9PSBDQUNIRV9TVEFURV9WRVJTSU9OKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIHN5bmNocm9uaXplZCBhc3NldCBjYWNoZSBzdGF0ZSB2ZXJzaW9uOiAke2xvYWRlZFN0YXRlLnZlcnNpb259YClcbiAgICB9XG5cbiAgICBsZXQgcmVjb3ZlcmVkSW50ZXJydXB0ZWREb3dubG9hZCA9IGZhbHNlXG5cbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGxvYWRlZFN0YXRlLmFzc2V0cykge1xuICAgICAgaWYgKGVudHJ5LnN0YXR1cyAhPT0gXCJkb3dubG9hZGluZ1wiKSBjb250aW51ZVxuXG4gICAgICBlbnRyeS5hdHRlbXB0cyArPSAxXG4gICAgICBlbnRyeS5uZXh0UmV0cnlBdCA9IHRoaXMubm93TWlsbGlzZWNvbmRzKClcbiAgICAgIGVudHJ5LnN0YXR1cyA9IFwiZmFpbGVkXCJcbiAgICAgIHJlY292ZXJlZEludGVycnVwdGVkRG93bmxvYWQgPSB0cnVlXG4gICAgfVxuXG4gICAgaWYgKHJlY292ZXJlZEludGVycnVwdGVkRG93bmxvYWQpIHtcbiAgICAgIGF3YWl0IHRoaXMuYWRhcHRlci5zYXZlU3RhdGUoe2FjY291bnRJZDogdGhpcy5hY2NvdW50SWQsIHN0YXRlOiBsb2FkZWRTdGF0ZX0pXG4gICAgfVxuXG4gICAgcmV0dXJuIGxvYWRlZFN0YXRlXG4gIH1cblxuICAvKipcbiAgICogUGVyc2lzdHMgdGhlIGN1cnJlbnQgY2FjaGUgc3RhdGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyBhZnRlciBzdGF0ZSBwZXJzaXN0ZW5jZS5cbiAgICovXG4gIGFzeW5jIHNhdmVTdGF0ZSgpIHtcbiAgICBpZiAoIXRoaXMuc3RhdGUpIHRocm93IG5ldyBFcnJvcihcIkNhbm5vdCBzYXZlIHN5bmNocm9uaXplZCBhc3NldCBjYWNoZSBiZWZvcmUgbG9hZGluZyBzdGF0ZVwiKVxuXG4gICAgY29uc3QgcGVyc2lzdCA9IGFzeW5jICgpID0+IHtcbiAgICAgIGlmICghdGhpcy5zdGF0ZSkgdGhyb3cgbmV3IEVycm9yKFwiQ2Fubm90IHNhdmUgc3luY2hyb25pemVkIGFzc2V0IGNhY2hlIGJlZm9yZSBsb2FkaW5nIHN0YXRlXCIpXG5cbiAgICAgIGF3YWl0IHRoaXMuYWRhcHRlci5zYXZlU3RhdGUoe2FjY291bnRJZDogdGhpcy5hY2NvdW50SWQsIHN0YXRlOiB0aGlzLnN0YXRlfSlcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnNlcmlhbGl6ZVN0YXRlUGVyc2lzdGVuY2UocGVyc2lzdClcbiAgfVxuXG4gIC8qKlxuICAgKiBQZXJzaXN0cyBhIGRldGFjaGVkIHJlY29uY2lsaWF0aW9uIGJlZm9yZSBleHBvc2luZyBpdCB0aHJvdWdoIHNoYXJlZCBzdGF0ZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgUmVjb25jaWxpYXRpb24gaW5wdXRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZURlc2NyaXB0b3JbXX0gYXJncy5kZXNjcmlwdG9ycyBDdXJyZW50IGRlc2NyaXB0b3JzIGluIHRoZSBzY29wZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc2NvcGVLZXkgU3RhYmxlIHN5bmNocm9uaXplZCBzY29wZSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPE1hcDxzdHJpbmcsIGltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZUVudHJ5Pj59IFJlY29uY2lsZWQgbGl2ZSBlbnRyaWVzIGJ5IGlkLlxuICAgKi9cbiAgYXN5bmMgcmVjb25jaWxlRGVzY3JpcHRvcnMoe2Rlc2NyaXB0b3JzLCBzY29wZUtleX0pIHtcbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIGltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZUVudHJ5PiB8IG51bGx9ICovXG4gICAgbGV0IGVudHJpZXNCeUlkID0gbnVsbFxuXG4gICAgY29uc3QgcGVyc2lzdCA9IGFzeW5jICgpID0+IHtcbiAgICAgIGlmICghdGhpcy5zdGF0ZSkgdGhyb3cgbmV3IEVycm9yKFwiQ2Fubm90IHJlY29uY2lsZSBzeW5jaHJvbml6ZWQgYXNzZXQgY2FjaGUgYmVmb3JlIGxvYWRpbmcgc3RhdGVcIilcblxuICAgICAgY29uc3QgY2FuZGlkYXRlU3RhdGUgPSB0aGlzLmNvcHlTdGF0ZSh0aGlzLnN0YXRlKVxuICAgICAgY29uc3QgbmV3RW50cnlMYXN0QWNjZXNzZWRBdCA9IHRoaXMubm93TWlsbGlzZWNvbmRzKClcblxuICAgICAgdGhpcy5hcHBseURlc2NyaXB0b3JSZWNvbmNpbGlhdGlvbih7ZGVzY3JpcHRvcnMsIG5ld0VudHJ5TGFzdEFjY2Vzc2VkQXQsIHNjb3BlS2V5LCBzdGF0ZTogY2FuZGlkYXRlU3RhdGV9KVxuICAgICAgYXdhaXQgdGhpcy5hZGFwdGVyLnNhdmVTdGF0ZSh7YWNjb3VudElkOiB0aGlzLmFjY291bnRJZCwgc3RhdGU6IGNhbmRpZGF0ZVN0YXRlfSlcbiAgICAgIGVudHJpZXNCeUlkID0gdGhpcy5hcHBseURlc2NyaXB0b3JSZWNvbmNpbGlhdGlvbih7ZGVzY3JpcHRvcnMsIG5ld0VudHJ5TGFzdEFjY2Vzc2VkQXQsIHNjb3BlS2V5LCBzdGF0ZTogdGhpcy5zdGF0ZX0pXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5zZXJpYWxpemVTdGF0ZVBlcnNpc3RlbmNlKHBlcnNpc3QpXG5cbiAgICBpZiAoIWVudHJpZXNCeUlkKSB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jaHJvbml6ZWQgYXNzZXQgZGVzY3JpcHRvciByZWNvbmNpbGlhdGlvbiBjb21wbGV0ZWQgd2l0aG91dCBsaXZlIGVudHJpZXNcIilcblxuICAgIHJldHVybiBlbnRyaWVzQnlJZFxuICB9XG5cbiAgLyoqXG4gICAqIEFwcGxpZXMgb25lIHNjb3BlJ3MgZGVzY3JpcHRvciBzZXQgdG8gY2FjaGUgc3RhdGUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIFJlY29uY2lsaWF0aW9uIGlucHV0cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVEZXNjcmlwdG9yW119IGFyZ3MuZGVzY3JpcHRvcnMgQ3VycmVudCBkZXNjcmlwdG9ycyBpbiB0aGUgc2NvcGUuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLm5ld0VudHJ5TGFzdEFjY2Vzc2VkQXQgSW5pdGlhbCBMUlUgdGltZXN0YW1wIGZvciBuZXcgZW50cmllcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc2NvcGVLZXkgU3RhYmxlIHN5bmNocm9uaXplZCBzY29wZSBrZXkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlU3RhdGV9IGFyZ3Muc3RhdGUgU3RhdGUgdG8gcmVjb25jaWxlLlxuICAgKiBAcmV0dXJucyB7TWFwPHN0cmluZywgaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlRW50cnk+fSBMaXZlIGVudHJpZXMgYnkgaWQuXG4gICAqL1xuICBhcHBseURlc2NyaXB0b3JSZWNvbmNpbGlhdGlvbih7ZGVzY3JpcHRvcnMsIG5ld0VudHJ5TGFzdEFjY2Vzc2VkQXQsIHNjb3BlS2V5LCBzdGF0ZX0pIHtcbiAgICBjb25zdCBpbmNvbWluZ0lkcyA9IG5ldyBTZXQoZGVzY3JpcHRvcnMubWFwKChhc3NldCkgPT4gYXNzZXQuaWQpKVxuICAgIGNvbnN0IGVudHJpZXNCeUlkID0gbmV3IE1hcChzdGF0ZS5hc3NldHMubWFwKChlbnRyeSkgPT4gW2VudHJ5LmRlc2NyaXB0b3IuaWQsIGVudHJ5XSkpXG4gICAgY29uc3QgZGVzY3JpcHRvcnNCeUlkID0gbmV3IE1hcChzdGF0ZS5hc3NldHMubWFwKChlbnRyeSkgPT4gW2VudHJ5LmRlc2NyaXB0b3IuaWQsIGVudHJ5LmRlc2NyaXB0b3JdKSlcbiAgICBjb25zdCByZW1vdmVkRGlnZXN0cyA9IG5ldyBTZXQoKVxuXG4gICAgZm9yIChjb25zdCBhc3NldCBvZiBkZXNjcmlwdG9ycykge1xuICAgICAgY29uc3Qga25vd25EZXNjcmlwdG9yID0gZGVzY3JpcHRvcnNCeUlkLmdldChhc3NldC5pZClcblxuICAgICAgaWYgKGtub3duRGVzY3JpcHRvciAmJiBrbm93bkRlc2NyaXB0b3IuZGlnZXN0ICE9PSBhc3NldC5kaWdlc3QpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBTeW5jaHJvbml6ZWQgYXNzZXQgZGVzY3JpcHRvciAke2Fzc2V0LmlkfSBjaGFuZ2VkIGl0cyBpbW11dGFibGUgZGlnZXN0YClcbiAgICAgIH1cbiAgICAgIGlmIChrbm93bkRlc2NyaXB0b3IgJiYga25vd25EZXNjcmlwdG9yLmJ5dGVTaXplICE9PSBhc3NldC5ieXRlU2l6ZSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFN5bmNocm9uaXplZCBhc3NldCBkZXNjcmlwdG9yICR7YXNzZXQuaWR9IGNoYW5nZWQgaXRzIGltbXV0YWJsZSBieXRlIHNpemVgKVxuICAgICAgfVxuICAgICAgaWYgKGtub3duRGVzY3JpcHRvciAmJiBrbm93bkRlc2NyaXB0b3IuY29udGVudFR5cGUgIT09IGFzc2V0LmNvbnRlbnRUeXBlKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgU3luY2hyb25pemVkIGFzc2V0IGRlc2NyaXB0b3IgJHthc3NldC5pZH0gY2hhbmdlZCBpdHMgaW1tdXRhYmxlIGNvbnRlbnQgdHlwZWApXG4gICAgICB9XG5cbiAgICAgIGRlc2NyaXB0b3JzQnlJZC5zZXQoYXNzZXQuaWQsIGFzc2V0KVxuICAgIH1cblxuICAgIGZvciAoY29uc3QgZW50cnkgb2Ygc3RhdGUuYXNzZXRzKSB7XG4gICAgICBpZiAoIWVudHJ5LnNjb3BlS2V5cy5pbmNsdWRlcyhzY29wZUtleSkgfHwgaW5jb21pbmdJZHMuaGFzKGVudHJ5LmRlc2NyaXB0b3IuaWQpKSBjb250aW51ZVxuXG4gICAgICBlbnRyeS5zY29wZUtleXMgPSBlbnRyeS5zY29wZUtleXMuZmlsdGVyKChjYW5kaWRhdGUpID0+IGNhbmRpZGF0ZSAhPT0gc2NvcGVLZXkpXG4gICAgICBpZiAoZW50cnkuc2NvcGVLZXlzLmxlbmd0aCA9PT0gMCkgcmVtb3ZlZERpZ2VzdHMuYWRkKGVudHJ5LmRlc2NyaXB0b3IuZGlnZXN0KVxuICAgIH1cblxuICAgIHN0YXRlLmFzc2V0cyA9IHN0YXRlLmFzc2V0cy5maWx0ZXIoKGVudHJ5KSA9PiBlbnRyeS5zY29wZUtleXMubGVuZ3RoID4gMClcblxuICAgIGZvciAoY29uc3QgYXNzZXQgb2YgZGVzY3JpcHRvcnMpIHtcbiAgICAgIGNvbnN0IGV4aXN0aW5nID0gZW50cmllc0J5SWQuZ2V0KGFzc2V0LmlkKVxuXG4gICAgICBpZiAoZXhpc3RpbmcgJiYgc3RhdGUuYXNzZXRzLmluY2x1ZGVzKGV4aXN0aW5nKSkge1xuICAgICAgICBleGlzdGluZy5kZXNjcmlwdG9yID0gYXNzZXRcbiAgICAgICAgaWYgKCFleGlzdGluZy5zY29wZUtleXMuaW5jbHVkZXMoc2NvcGVLZXkpKSBleGlzdGluZy5zY29wZUtleXMucHVzaChzY29wZUtleSlcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnN0IG5ld0VudHJ5ID0ge1xuICAgICAgICAgIGF0dGVtcHRzOiAwLFxuICAgICAgICAgIGRlc2NyaXB0b3I6IGFzc2V0LFxuICAgICAgICAgIGxhc3RBY2Nlc3NlZEF0OiBuZXdFbnRyeUxhc3RBY2Nlc3NlZEF0LFxuICAgICAgICAgIG5leHRSZXRyeUF0OiBudWxsLFxuICAgICAgICAgIHNjb3BlS2V5czogW3Njb3BlS2V5XSxcbiAgICAgICAgICBzdGF0dXM6IC8qKiBAdHlwZSB7Y29uc3R9ICovIChcIm1pc3NpbmdcIilcbiAgICAgICAgfVxuXG4gICAgICAgIHN0YXRlLmFzc2V0cy5wdXNoKG5ld0VudHJ5KVxuICAgICAgICBlbnRyaWVzQnlJZC5zZXQoYXNzZXQuaWQsIG5ld0VudHJ5KVxuICAgICAgfVxuICAgIH1cblxuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgbnVtYmVyPn0gKi9cbiAgICBjb25zdCBieXRlU2l6ZXNCeURpZ2VzdCA9IG5ldyBNYXAoKVxuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgc3RyaW5nIHwgbnVsbD59ICovXG4gICAgY29uc3QgY29udGVudFR5cGVzQnlEaWdlc3QgPSBuZXcgTWFwKClcblxuICAgIGZvciAoY29uc3QgZW50cnkgb2Ygc3RhdGUuYXNzZXRzKSB7XG4gICAgICBjb25zdCBrbm93bkJ5dGVTaXplID0gYnl0ZVNpemVzQnlEaWdlc3QuZ2V0KGVudHJ5LmRlc2NyaXB0b3IuZGlnZXN0KVxuICAgICAgY29uc3Qga25vd25Db250ZW50VHlwZSA9IGNvbnRlbnRUeXBlc0J5RGlnZXN0LmdldChlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdClcblxuICAgICAgaWYgKGtub3duQnl0ZVNpemUgIT09IHVuZGVmaW5lZCAmJiBrbm93bkJ5dGVTaXplICE9PSBlbnRyeS5kZXNjcmlwdG9yLmJ5dGVTaXplKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgU3luY2hyb25pemVkIGFzc2V0IGRpZ2VzdCAke2VudHJ5LmRlc2NyaXB0b3IuZGlnZXN0fSBoYXMgaW5jb25zaXN0ZW50IGJ5dGUgc2l6ZXNgKVxuICAgICAgfVxuICAgICAgaWYgKGtub3duQ29udGVudFR5cGUgIT09IHVuZGVmaW5lZCAmJiBrbm93bkNvbnRlbnRUeXBlICE9PSBlbnRyeS5kZXNjcmlwdG9yLmNvbnRlbnRUeXBlKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgU3luY2hyb25pemVkIGFzc2V0IGRpZ2VzdCAke2VudHJ5LmRlc2NyaXB0b3IuZGlnZXN0fSBoYXMgaW5jb25zaXN0ZW50IGNvbnRlbnQgdHlwZXNgKVxuICAgICAgfVxuXG4gICAgICBieXRlU2l6ZXNCeURpZ2VzdC5zZXQoZW50cnkuZGVzY3JpcHRvci5kaWdlc3QsIGVudHJ5LmRlc2NyaXB0b3IuYnl0ZVNpemUpXG4gICAgICBjb250ZW50VHlwZXNCeURpZ2VzdC5zZXQoZW50cnkuZGVzY3JpcHRvci5kaWdlc3QsIGVudHJ5LmRlc2NyaXB0b3IuY29udGVudFR5cGUpXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBkaWdlc3Qgb2YgcmVtb3ZlZERpZ2VzdHMpIHtcbiAgICAgIGlmIChzdGF0ZS5hc3NldHMuc29tZSgoZW50cnkpID0+IGVudHJ5LmRlc2NyaXB0b3IuZGlnZXN0ID09PSBkaWdlc3QpKSBjb250aW51ZVxuICAgICAgaWYgKCFzdGF0ZS5wZW5kaW5nRGVsZXRpb25EaWdlc3RzLmluY2x1ZGVzKGRpZ2VzdCkpIHN0YXRlLnBlbmRpbmdEZWxldGlvbkRpZ2VzdHMucHVzaChkaWdlc3QpXG4gICAgfVxuXG4gICAgcmV0dXJuIGVudHJpZXNCeUlkXG4gIH1cblxuICAvKipcbiAgICogQ29waWVzIG1ldGFkYXRhIGludG8gYSBkZXRhY2hlZCBwZXJzaXN0ZW5jZSBjYW5kaWRhdGUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlU3RhdGV9IHN0YXRlIFN0YXRlIHRvIGNvcHkuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVTdGF0ZX0gRGV0YWNoZWQgc3RhdGUuXG4gICAqL1xuICBjb3B5U3RhdGUoc3RhdGUpIHtcbiAgICByZXR1cm4ge1xuICAgICAgYXNzZXRzOiBzdGF0ZS5hc3NldHMubWFwKChlbnRyeSkgPT4gKHtcbiAgICAgICAgLi4uZW50cnksXG4gICAgICAgIGRlc2NyaXB0b3I6IHsuLi5lbnRyeS5kZXNjcmlwdG9yfSxcbiAgICAgICAgc2NvcGVLZXlzOiBbLi4uZW50cnkuc2NvcGVLZXlzXVxuICAgICAgfSkpLFxuICAgICAgcGVuZGluZ0RlbGV0aW9uRGlnZXN0czogWy4uLnN0YXRlLnBlbmRpbmdEZWxldGlvbkRpZ2VzdHNdLFxuICAgICAgdmVyc2lvbjogc3RhdGUudmVyc2lvblxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBTZXJpYWxpemVzIG9uZSBtZXRhZGF0YSBwZXJzaXN0ZW5jZSBvcGVyYXRpb24gYWZ0ZXIgcHJpb3IgZmFpbHVyZXMgb3Igc3VjY2Vzc2VzLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8dm9pZD59IHBlcnNpc3QgUGVyc2lzdGVuY2Ugb3BlcmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgYWZ0ZXIgcGVyc2lzdGVuY2UuXG4gICAqL1xuICBhc3luYyBzZXJpYWxpemVTdGF0ZVBlcnNpc3RlbmNlKHBlcnNpc3QpIHtcbiAgICB0aGlzLnNhdmVTdGF0ZVByb21pc2UgPSB0aGlzLnNhdmVTdGF0ZVByb21pc2UudGhlbihwZXJzaXN0LCBwZXJzaXN0KVxuXG4gICAgYXdhaXQgdGhpcy5zYXZlU3RhdGVQcm9taXNlXG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyBvbmUgZGVzY3JpcHRvciBoYXMgdmVyaWZpZWQgbG9jYWwgYnl0ZXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlRW50cnl9IGVudHJ5IERlc2NyaXB0b3Igc3RhdGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHtlcnJvcjogRXJyb3IgfCBudWxsLCB1cmk6IHN0cmluZyB8IG51bGx9Pn0gQ2FjaGUgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgZW5zdXJlQ2FjaGVkKGVudHJ5KSB7XG4gICAgY29uc3QgZGlnZXN0ID0gZW50cnkuZGVzY3JpcHRvci5kaWdlc3RcblxuICAgIGF3YWl0IHRoaXMuYmVnaW5BY3RpdmVEaWdlc3QoZGlnZXN0KVxuXG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLmVuc3VyZUNhY2hlZFdoaWxlQWN0aXZlKFtlbnRyeV0pXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IHRoaXMuZmluaXNoQWN0aXZlRGlnZXN0KGRpZ2VzdClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgb3IgZG93bmxvYWRzIGRlc2NyaXB0b3JzIHNoYXJpbmcgb25lIHByb3RlY3RlZCBkaWdlc3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlRW50cnlbXX0gZW50cmllcyBEZXNjcmlwdG9yIHN0YXRlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8e2Vycm9yOiBFcnJvciB8IG51bGwsIHVyaTogc3RyaW5nIHwgbnVsbH0+fSBDYWNoZSByZXN1bHQuXG4gICAqL1xuICBhc3luYyBlbnN1cmVDYWNoZWRXaGlsZUFjdGl2ZShlbnRyaWVzKSB7XG4gICAgY29uc3QgZW50cnkgPSBlbnRyaWVzWzBdXG5cbiAgICBpZiAoIWVudHJ5KSB0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3QgY2FjaGUgYSBzeW5jaHJvbml6ZWQgYXNzZXQgZGlnZXN0IHdpdGhvdXQgZGVzY3JpcHRvciBlbnRyaWVzXCIpXG5cbiAgICBjb25zdCBleGlzdGluZ1VyaSA9IGF3YWl0IHRoaXMuY2FjaGVkVXJpV2hpbGVBY3RpdmUoZW50cnkpXG5cbiAgICBpZiAoZXhpc3RpbmdVcmkpIHtcbiAgICAgIGF3YWl0IHRoaXMucmVjb3JkQ2FjaGVkRW50cmllcyhlbnRyaWVzKVxuXG4gICAgICByZXR1cm4ge2Vycm9yOiBudWxsLCB1cmk6IGV4aXN0aW5nVXJpfVxuICAgIH1cblxuICAgIGZvciAoY29uc3QgZGlnZXN0RW50cnkgb2YgZW50cmllcykgZGlnZXN0RW50cnkuc3RhdHVzID0gXCJkb3dubG9hZGluZ1wiXG5cbiAgICBjb25zdCBkaWdlc3QgPSBlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdFxuICAgIGxldCBkb3dubG9hZFByb21pc2UgPSB0aGlzLmRvd25sb2FkUHJvbWlzZXMuZ2V0KGRpZ2VzdClcbiAgICBsZXQgb3duc0Rvd25sb2FkUHJvbWlzZSA9IGZhbHNlXG5cbiAgICBpZiAoIWRvd25sb2FkUHJvbWlzZSkge1xuICAgICAgZG93bmxvYWRQcm9taXNlID0gdGhpcy5kb3dubG9hZEFmdGVyUGVyc2lzdGluZ1N0YXRlKGVudHJ5LmRlc2NyaXB0b3IpXG4gICAgICB0aGlzLmRvd25sb2FkUHJvbWlzZXMuc2V0KGRpZ2VzdCwgZG93bmxvYWRQcm9taXNlKVxuICAgICAgb3duc0Rvd25sb2FkUHJvbWlzZSA9IHRydWVcbiAgICB9IGVsc2Uge1xuICAgICAgYXdhaXQgdGhpcy5zYXZlU3RhdGUoKVxuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBjYWNoZVJlc3VsdCA9IGF3YWl0IGRvd25sb2FkUHJvbWlzZVxuXG4gICAgICBpZiAoY2FjaGVSZXN1bHQuZXJyb3IpIHtcbiAgICAgICAgaWYgKGVudHJ5LnN0YXR1cyA9PT0gXCJkb3dubG9hZGluZ1wiKSBhd2FpdCB0aGlzLnJlY29yZERvd25sb2FkRmFpbHVyZShkaWdlc3QpXG5cbiAgICAgICAgcmV0dXJuIGNhY2hlUmVzdWx0XG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHRoaXMucmVjb3JkQ2FjaGVkRW50cmllcyhlbnRyaWVzKVxuXG4gICAgICByZXR1cm4gY2FjaGVSZXN1bHRcbiAgICB9IGZpbmFsbHkge1xuICAgICAgaWYgKG93bnNEb3dubG9hZFByb21pc2UgJiYgdGhpcy5kb3dubG9hZFByb21pc2VzLmdldChkaWdlc3QpID09PSBkb3dubG9hZFByb21pc2UpIHtcbiAgICAgICAgdGhpcy5kb3dubG9hZFByb21pc2VzLmRlbGV0ZShkaWdlc3QpXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgb25lIGNhY2hlZCBkaWdlc3QgcmVzdWx0IGZvciBldmVyeSBwYXJ0aWNpcGF0aW5nIGRlc2NyaXB0b3IuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlRW50cnlbXX0gZW50cmllcyBEZXNjcmlwdG9yIHN0YXRlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIGFmdGVyIHBlcnNpc3RlbmNlLlxuICAgKi9cbiAgYXN5bmMgcmVjb3JkQ2FjaGVkRW50cmllcyhlbnRyaWVzKSB7XG4gICAgY29uc3QgbGFzdEFjY2Vzc2VkQXQgPSB0aGlzLm5vd01pbGxpc2Vjb25kcygpXG5cbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGVudHJpZXMpIHtcbiAgICAgIGVudHJ5LmF0dGVtcHRzID0gMFxuICAgICAgZW50cnkubGFzdEFjY2Vzc2VkQXQgPSBsYXN0QWNjZXNzZWRBdFxuICAgICAgZW50cnkubmV4dFJldHJ5QXQgPSBudWxsXG4gICAgICBlbnRyeS5zdGF0dXMgPSBcImNhY2hlZFwiXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5zYXZlU3RhdGUoKVxuICB9XG5cbiAgLyoqXG4gICAqIFBlcnNpc3RzIGRvd25sb2FkIGludGVudCwgdGhlbiBkb3dubG9hZHMgb25lIGRpZ2VzdCBhbmQgcmVjb3JkcyBhIHNoYXJlZCBmYWlsdXJlIG9uY2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlRGVzY3JpcHRvcn0gZGVzY3JpcHRvciBBc3NldCBkZXNjcmlwdG9yLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7ZXJyb3I6IEVycm9yLCB1cmk6IG51bGx9IHwge2Vycm9yOiBudWxsLCB1cmk6IHN0cmluZ30+fSBTaGFyZWQgY2FjaGUgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgZG93bmxvYWRBZnRlclBlcnNpc3RpbmdTdGF0ZShkZXNjcmlwdG9yKSB7XG4gICAgYXdhaXQgdGhpcy5zYXZlU3RhdGUoKVxuXG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiB7ZXJyb3I6IG51bGwsIHVyaTogYXdhaXQgdGhpcy5kb3dubG9hZFZlcmlmaWVkKGRlc2NyaXB0b3IpfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zdCBmYWlsdXJlID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpXG5cbiAgICAgIGF3YWl0IHRoaXMucmVjb3JkRG93bmxvYWRGYWlsdXJlKGRlc2NyaXB0b3IuZGlnZXN0KVxuXG4gICAgICByZXR1cm4ge2Vycm9yOiBmYWlsdXJlLCB1cmk6IG51bGx9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEFkdmFuY2VzIHJldHJ5IG1ldGFkYXRhIGZvciBldmVyeSBsaXZlIGRlc2NyaXB0b3Igc2hhcmluZyBvbmUgZmFpbGVkIGRpZ2VzdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGRpZ2VzdCBDb250ZW50IGRpZ2VzdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIGFmdGVyIHBlcnNpc3RlbmNlLlxuICAgKi9cbiAgYXN5bmMgcmVjb3JkRG93bmxvYWRGYWlsdXJlKGRpZ2VzdCkge1xuICAgIGlmICghdGhpcy5zdGF0ZSkgdGhyb3cgbmV3IEVycm9yKFwiQ2Fubm90IHJlY29yZCBzeW5jaHJvbml6ZWQgYXNzZXQgZG93bmxvYWQgZmFpbHVyZSBiZWZvcmUgbG9hZGluZyBzdGF0ZVwiKVxuXG4gICAgY29uc3QgZmFpbGVkQXQgPSB0aGlzLm5vd01pbGxpc2Vjb25kcygpXG5cbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHRoaXMuc3RhdGUuYXNzZXRzKSB7XG4gICAgICBpZiAoZW50cnkuZGVzY3JpcHRvci5kaWdlc3QgIT09IGRpZ2VzdCkgY29udGludWVcbiAgICAgIGlmIChlbnRyeS5zdGF0dXMgIT09IFwiZG93bmxvYWRpbmdcIikgY29udGludWVcblxuICAgICAgZW50cnkuYXR0ZW1wdHMgKz0gMVxuICAgICAgZW50cnkubmV4dFJldHJ5QXQgPSBmYWlsZWRBdCArIHRoaXMucmV0cnlEZWxheShlbnRyeS5hdHRlbXB0cylcbiAgICAgIGVudHJ5LnN0YXR1cyA9IFwiZmFpbGVkXCJcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnNhdmVTdGF0ZSgpXG4gIH1cblxuICAvKipcbiAgICogRG93bmxvYWRzLCB2ZXJpZmllcywgYW5kIGF0b21pY2FsbHkgcGVyc2lzdHMgb25lIGNvbnRlbnQgZGlnZXN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZURlc2NyaXB0b3J9IGRlc2NyaXB0b3IgQXNzZXQgZGVzY3JpcHRvci5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gQWRhcHRlciBVUkkuXG4gICAqL1xuICBhc3luYyBkb3dubG9hZFZlcmlmaWVkKGRlc2NyaXB0b3IpIHtcbiAgICBjb25zdCBkb3dubG9hZGVkQnl0ZXMgPSBhd2FpdCB0aGlzLmRvd25sb2FkKGRlc2NyaXB0b3IpXG5cbiAgICBpZiAoIShkb3dubG9hZGVkQnl0ZXMgaW5zdGFuY2VvZiBVaW50OEFycmF5KSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBTeW5jaHJvbml6ZWQgYXNzZXQgJHtkZXNjcmlwdG9yLmlkfSBkb3dubG9hZCBkaWQgbm90IHJldHVybiBVaW50OEFycmF5IGJ5dGVzYClcbiAgICB9XG4gICAgaWYgKGRvd25sb2FkZWRCeXRlcy5ieXRlTGVuZ3RoICE9PSBkZXNjcmlwdG9yLmJ5dGVTaXplKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFN5bmNocm9uaXplZCBhc3NldCAke2Rlc2NyaXB0b3IuaWR9IGJ5dGUgc2l6ZSBkaWQgbm90IG1hdGNoIGl0cyBkZXNjcmlwdG9yYClcbiAgICB9XG5cbiAgICBjb25zdCBkaWdlc3QgPSBgc2hhMjU2LSR7c2hhMjU2Qnl0ZXNIZXgoZG93bmxvYWRlZEJ5dGVzKX1gXG5cbiAgICBpZiAoZGlnZXN0ICE9PSBkZXNjcmlwdG9yLmRpZ2VzdCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBTeW5jaHJvbml6ZWQgYXNzZXQgJHtkZXNjcmlwdG9yLmlkfSBkaWdlc3QgZGlkIG5vdCBtYXRjaCBpdHMgZGVzY3JpcHRvcmApXG4gICAgfVxuXG4gICAgY29uc3QgdXJpID0gYXdhaXQgdGhpcy5hZGFwdGVyLndyaXRlQmxvYih7XG4gICAgICBhY2NvdW50SWQ6IHRoaXMuYWNjb3VudElkLFxuICAgICAgYnl0ZXM6IGRvd25sb2FkZWRCeXRlcyxcbiAgICAgIGNvbnRlbnRUeXBlOiBkZXNjcmlwdG9yLmNvbnRlbnRUeXBlLFxuICAgICAgZGlnZXN0XG4gICAgfSlcblxuICAgIGlmICghdXJpKSB0aHJvdyBuZXcgRXJyb3IoYFN5bmNocm9uaXplZCBhc3NldCBhZGFwdGVyIHJldHVybmVkIG5vIFVSSSBmb3IgJHtkZXNjcmlwdG9yLmlkfWApXG5cbiAgICByZXR1cm4gdXJpXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYW4gZXhpc3RpbmcgbG9jYWwgVVJJIGFmdGVyIHdhaXRpbmcgZm9yIGRlbGV0aW9uIHdvcmsuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlRW50cnl9IGVudHJ5IERlc2NyaXB0b3Igc3RhdGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZyB8IG51bGw+fSBFeGlzdGluZyBVUkkuXG4gICAqL1xuICBhc3luYyBjYWNoZWRVcmkoZW50cnkpIHtcbiAgICBjb25zdCBkaWdlc3QgPSBlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdFxuXG4gICAgYXdhaXQgdGhpcy5iZWdpbkFjdGl2ZURpZ2VzdChkaWdlc3QpXG5cbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuY2FjaGVkVXJpV2hpbGVBY3RpdmUoZW50cnkpXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IHRoaXMuZmluaXNoQWN0aXZlRGlnZXN0KGRpZ2VzdClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYW4gZXhpc3RpbmcgbG9jYWwgVVJJIHdoaWxlIGl0cyBkaWdlc3QgaXMgcHJvdGVjdGVkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZUVudHJ5fSBlbnRyeSBEZXNjcmlwdG9yIHN0YXRlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmcgfCBudWxsPn0gRXhpc3RpbmcgVVJJLlxuICAgKi9cbiAgYXN5bmMgY2FjaGVkVXJpV2hpbGVBY3RpdmUoZW50cnkpIHtcbiAgICBjb25zdCB1cmkgPSBhd2FpdCB0aGlzLmFkYXB0ZXIuYmxvYlVyaSh7XG4gICAgICBhY2NvdW50SWQ6IHRoaXMuYWNjb3VudElkLFxuICAgICAgZGlnZXN0OiBlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdFxuICAgIH0pXG5cbiAgICBpZiAoIXVyaSAmJiBlbnRyeS5zdGF0dXMgPT09IFwiY2FjaGVkXCIpIGVudHJ5LnN0YXR1cyA9IFwibWlzc2luZ1wiXG5cbiAgICByZXR1cm4gdXJpXG4gIH1cblxuICAvKipcbiAgICogV2FpdHMgZm9yIGRlbGV0aW9uIGFuZCBwcm90ZWN0cyBhIGRpZ2VzdCBmb3Igb25lIGFjdGl2ZSBjYWNoZSBvcGVyYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBkaWdlc3QgQ29udGVudCBkaWdlc3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyBhZnRlciBwcm90ZWN0aW9uIGlzIHJlZ2lzdGVyZWQuXG4gICAqL1xuICBhc3luYyBiZWdpbkFjdGl2ZURpZ2VzdChkaWdlc3QpIHtcbiAgICBsZXQgZGVsZXRpb25Qcm9taXNlID0gdGhpcy5kZWxldGlvblByb21pc2VzLmdldChkaWdlc3QpXG5cbiAgICB3aGlsZSAoZGVsZXRpb25Qcm9taXNlKSB7XG4gICAgICBhd2FpdCBkZWxldGlvblByb21pc2VcbiAgICAgIGRlbGV0aW9uUHJvbWlzZSA9IHRoaXMuZGVsZXRpb25Qcm9taXNlcy5nZXQoZGlnZXN0KVxuICAgIH1cblxuICAgIGNvbnN0IGFjdGl2ZUNvdW50ID0gdGhpcy5hY3RpdmVEaWdlc3RDb3VudHMuZ2V0KGRpZ2VzdCkgPz8gMFxuXG4gICAgdGhpcy5hY3RpdmVEaWdlc3RDb3VudHMuc2V0KGRpZ2VzdCwgYWN0aXZlQ291bnQgKyAxKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlbGVhc2VzIG9uZSBjYWNoZSBvcGVyYXRpb24gYW5kIHByb2Nlc3NlcyBkZWZlcnJlZCBkZWxldGlvbiBhZnRlciB0aGUgbGFzdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGRpZ2VzdCBDb250ZW50IGRpZ2VzdC5cbiAgICogQHBhcmFtIHtTZXQ8c3RyaW5nPn0gW3Byb3RlY3RlZENsZWFudXBEaWdlc3RzXSBEaWdlc3RzIG5lZWRlZCBieSB0aGUgcmVzb2x2aW5nIGNhbGxlci5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIGFmdGVyIGFueSBwZW5kaW5nIGRlbGV0aW9uLlxuICAgKi9cbiAgYXN5bmMgZmluaXNoQWN0aXZlRGlnZXN0KGRpZ2VzdCwgcHJvdGVjdGVkQ2xlYW51cERpZ2VzdHMgPSBuZXcgU2V0KCkpIHtcbiAgICBjb25zdCBhY3RpdmVDb3VudCA9IHRoaXMuYWN0aXZlRGlnZXN0Q291bnRzLmdldChkaWdlc3QpXG5cbiAgICBpZiAoYWN0aXZlQ291bnQgPT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBNaXNzaW5nIGFjdGl2ZSBzeW5jaHJvbml6ZWQgYXNzZXQgZGlnZXN0IGNvdW50IGZvciAke2RpZ2VzdH1gKVxuICAgIH1cblxuICAgIGlmIChhY3RpdmVDb3VudCA+IDEpIHtcbiAgICAgIHRoaXMuYWN0aXZlRGlnZXN0Q291bnRzLnNldChkaWdlc3QsIGFjdGl2ZUNvdW50IC0gMSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHRoaXMuYWN0aXZlRGlnZXN0Q291bnRzLmRlbGV0ZShkaWdlc3QpXG4gICAgYXdhaXQgdGhpcy5kZWxldGVQZW5kaW5nRGlnZXN0SWZVbnJlZmVyZW5jZWQoZGlnZXN0KVxuXG4gICAgaWYgKHRoaXMuY2xlYW51cFJlcXVpcmVkQWZ0ZXJSZWxlYXNlRGlnZXN0cy5kZWxldGUoZGlnZXN0KSkge1xuICAgICAgYXdhaXQgdGhpcy5jbGVhbnVwKHByb3RlY3RlZENsZWFudXBEaWdlc3RzKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZWxlYXNlcyBldmVyeSBhY3F1aXJlZCBkaWdlc3QgYmVmb3JlIHByb3BhZ2F0aW5nIGZpbmFsaXphdGlvbiBmYWlsdXJlcy5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gZGlnZXN0cyBDb250ZW50IGRpZ2VzdHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyBhZnRlciBldmVyeSBkaWdlc3QgaXMgcmVsZWFzZWQuXG4gICAqL1xuICBhc3luYyBmaW5pc2hBY3RpdmVEaWdlc3RzKGRpZ2VzdHMpIHtcbiAgICAvKiogQHR5cGUge0Vycm9yW119ICovXG4gICAgY29uc3QgZmFpbHVyZXMgPSBbXVxuXG4gICAgZm9yIChjb25zdCBkaWdlc3Qgb2YgZGlnZXN0cykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5maW5pc2hBY3RpdmVEaWdlc3QoZGlnZXN0KVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgZmFpbHVyZXMucHVzaChlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSkpXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGZhaWx1cmVzLmxlbmd0aCA9PT0gMSkgdGhyb3cgZmFpbHVyZXNbMF1cbiAgICBpZiAoZmFpbHVyZXMubGVuZ3RoID4gMSkge1xuICAgICAgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKGZhaWx1cmVzLCBcIk11bHRpcGxlIHN5bmNocm9uaXplZCBhc3NldCBkaWdlc3QgZmluYWxpemVycyBmYWlsZWRcIiwge2NhdXNlOiBmYWlsdXJlc1swXX0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIERlbGV0ZXMgYmxvYnMgdGhhdCBsb3N0IHRoZWlyIGZpbmFsIGRlc2NyaXB0b3IgcmVmZXJlbmNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgYWZ0ZXIgZGVsZXRpb24uXG4gICAqL1xuICBhc3luYyBkZWxldGVVbnJlZmVyZW5jZWREaWdlc3RzKCkge1xuICAgIGlmICghdGhpcy5zdGF0ZSkgdGhyb3cgbmV3IEVycm9yKFwiQ2Fubm90IGRlbGV0ZSBzeW5jaHJvbml6ZWQgYXNzZXQgYmxvYnMgYmVmb3JlIGxvYWRpbmcgc3RhdGVcIilcblxuICAgIGZvciAoY29uc3QgZGlnZXN0IG9mIFsuLi50aGlzLnN0YXRlLnBlbmRpbmdEZWxldGlvbkRpZ2VzdHNdKSB7XG4gICAgICBhd2FpdCB0aGlzLmRlbGV0ZVBlbmRpbmdEaWdlc3RJZlVucmVmZXJlbmNlZChkaWdlc3QpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIERlbGV0ZXMgb25lIHBlcnNpc3RlZCBwZW5kaW5nIGRpZ2VzdCB3aGVuIG5vIGRlc2NyaXB0b3Igb3IgYWN0aXZlIG9wZXJhdGlvbiBvd25zIGl0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZGlnZXN0IENvbnRlbnQgZGlnZXN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgYWZ0ZXIgYW55IHJlcXVpcmVkIGRlbGV0aW9uLlxuICAgKi9cbiAgYXN5bmMgZGVsZXRlUGVuZGluZ0RpZ2VzdElmVW5yZWZlcmVuY2VkKGRpZ2VzdCkge1xuICAgIGlmICghdGhpcy5zdGF0ZSkgdGhyb3cgbmV3IEVycm9yKFwiQ2Fubm90IGRlbGV0ZSBzeW5jaHJvbml6ZWQgYXNzZXQgYmxvYnMgYmVmb3JlIGxvYWRpbmcgc3RhdGVcIilcbiAgICBpZiAoIXRoaXMuc3RhdGUucGVuZGluZ0RlbGV0aW9uRGlnZXN0cy5pbmNsdWRlcyhkaWdlc3QpKSByZXR1cm5cblxuICAgIGF3YWl0IHRoaXMuZGVsZXRlRGlnZXN0SWZJbmFjdGl2ZShkaWdlc3QsIGFzeW5jICgpID0+IHtcbiAgICAgIGlmICghdGhpcy5zdGF0ZSkgdGhyb3cgbmV3IEVycm9yKFwiQ2Fubm90IGRlbGV0ZSBzeW5jaHJvbml6ZWQgYXNzZXQgYmxvYnMgYmVmb3JlIGxvYWRpbmcgc3RhdGVcIilcbiAgICAgIGlmICghdGhpcy5zdGF0ZS5wZW5kaW5nRGVsZXRpb25EaWdlc3RzLmluY2x1ZGVzKGRpZ2VzdCkpIHJldHVybiBmYWxzZVxuXG4gICAgICBsZXQgZGVsZXRlZCA9IGZhbHNlXG5cbiAgICAgIGlmICghdGhpcy5zdGF0ZS5hc3NldHMuc29tZSgoZW50cnkpID0+IGVudHJ5LmRlc2NyaXB0b3IuZGlnZXN0ID09PSBkaWdlc3QpKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuYWRhcHRlci5kZWxldGVCbG9iKHthY2NvdW50SWQ6IHRoaXMuYWNjb3VudElkLCBkaWdlc3R9KVxuICAgICAgICBkZWxldGVkID0gdHJ1ZVxuICAgICAgfVxuXG4gICAgICBjb25zdCBwZW5kaW5nRGVsZXRpb25EaWdlc3RzID0gdGhpcy5zdGF0ZS5wZW5kaW5nRGVsZXRpb25EaWdlc3RzXG5cbiAgICAgIHRoaXMuc3RhdGUucGVuZGluZ0RlbGV0aW9uRGlnZXN0cyA9IHBlbmRpbmdEZWxldGlvbkRpZ2VzdHMuZmlsdGVyKChjYW5kaWRhdGUpID0+IGNhbmRpZGF0ZSAhPT0gZGlnZXN0KVxuXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLnNhdmVTdGF0ZSgpXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBpZiAoIXRoaXMuc3RhdGUucGVuZGluZ0RlbGV0aW9uRGlnZXN0cy5pbmNsdWRlcyhkaWdlc3QpKSB0aGlzLnN0YXRlLnBlbmRpbmdEZWxldGlvbkRpZ2VzdHMucHVzaChkaWdlc3QpXG4gICAgICAgIHRocm93IGVycm9yXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBkZWxldGVkXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG9uZSBkZWxldGlvbiBvbmx5IGFmdGVyIGVhcmxpZXIgZGVsZXRpb24gd29yayBhbmQgd2hlbiBubyBjYWNoZSBvcGVyYXRpb24gb3ducyB0aGUgZGlnZXN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZGlnZXN0IENvbnRlbnQgZGlnZXN0LlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8Ym9vbGVhbj59IGNhbGxiYWNrIFByb3RlY3RlZCBkZWxldGlvbiBjYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IFdoZXRoZXIgdGhlIGNhbGxiYWNrIGRlbGV0ZWQgdGhlIGJsb2IuXG4gICAqL1xuICBhc3luYyBkZWxldGVEaWdlc3RJZkluYWN0aXZlKGRpZ2VzdCwgY2FsbGJhY2spIHtcbiAgICBsZXQgYWN0aXZlRGVsZXRpb25Qcm9taXNlID0gdGhpcy5kZWxldGlvblByb21pc2VzLmdldChkaWdlc3QpXG5cbiAgICB3aGlsZSAoYWN0aXZlRGVsZXRpb25Qcm9taXNlKSB7XG4gICAgICBhd2FpdCBhY3RpdmVEZWxldGlvblByb21pc2VcbiAgICAgIGFjdGl2ZURlbGV0aW9uUHJvbWlzZSA9IHRoaXMuZGVsZXRpb25Qcm9taXNlcy5nZXQoZGlnZXN0KVxuICAgIH1cblxuICAgIGlmICh0aGlzLmFjdGl2ZURpZ2VzdENvdW50cy5oYXMoZGlnZXN0KSkgcmV0dXJuIGZhbHNlXG5cbiAgICAvKipcbiAgICAgKiBSZWxlYXNlcyBjYWxsZXJzIHdhaXRpbmcgZm9yIGRlbGV0aW9uIGNvbXBsZXRpb24uXG4gICAgICogQHR5cGUgeygpID0+IHZvaWR9XG4gICAgICovXG4gICAgbGV0IHJlbGVhc2VEZWxldGlvbiA9ICgpID0+IHt9XG4gICAgLyoqXG4gICAgICogQmxvY2tzIG5ldyBkaWdlc3QgYWN0aXZpdHkgdW50aWwgZGVsZXRpb24gY29tcGxldGVzLlxuICAgICAqIEB0eXBlIHtQcm9taXNlPHZvaWQ+fVxuICAgICAqL1xuICAgIGNvbnN0IGRlbGV0aW9uUHJvbWlzZSA9IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgICByZWxlYXNlRGVsZXRpb24gPSAoKSA9PiByZXNvbHZlKHVuZGVmaW5lZClcbiAgICB9KVxuXG4gICAgdGhpcy5kZWxldGlvblByb21pc2VzLnNldChkaWdlc3QsIGRlbGV0aW9uUHJvbWlzZSlcblxuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soKVxuICAgIH0gZmluYWxseSB7XG4gICAgICBpZiAodGhpcy5kZWxldGlvblByb21pc2VzLmdldChkaWdlc3QpID09PSBkZWxldGlvblByb21pc2UpIHRoaXMuZGVsZXRpb25Qcm9taXNlcy5kZWxldGUoZGlnZXN0KVxuICAgICAgcmVsZWFzZURlbGV0aW9uKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRmluZHMgcmVxdWlyZWQgYXNzZXRzIHdpdGhvdXQgbG9jYWxseSBjYWNoZWQgYnl0ZXMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzY29wZUtleSBTeW5jaHJvbml6ZWQgc2NvcGUgdG8gaW5zcGVjdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fSBNaXNzaW5nIHJlcXVpcmVkIGRlc2NyaXB0b3IgaWRzLlxuICAgKi9cbiAgYXN5bmMgbWlzc2luZ1JlcXVpcmVkQXNzZXRJZHMoc2NvcGVLZXkpIHtcbiAgICBjb25zdCBzdGF0ZSA9IGF3YWl0IHRoaXMubG9hZFN0YXRlKClcbiAgICAvKiogQHR5cGUge3N0cmluZ1tdfSAqL1xuICAgIGNvbnN0IG1pc3NpbmdBc3NldElkcyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHN0YXRlLmFzc2V0cykge1xuICAgICAgaWYgKCFlbnRyeS5zY29wZUtleXMuaW5jbHVkZXMoc2NvcGVLZXkpKSBjb250aW51ZVxuICAgICAgaWYgKGVudHJ5LmRlc2NyaXB0b3Iub2ZmbGluZVJlcXVpcmVtZW50ICE9PSBcInJlcXVpcmVkXCIpIGNvbnRpbnVlXG4gICAgICBpZiAoYXdhaXQgdGhpcy5jYWNoZWRVcmkoZW50cnkpKSBjb250aW51ZVxuXG4gICAgICBtaXNzaW5nQXNzZXRJZHMucHVzaChlbnRyeS5kZXNjcmlwdG9yLmlkKVxuICAgIH1cblxuICAgIHJldHVybiBtaXNzaW5nQXNzZXRJZHNcbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVja3Mgd2hldGhlciBhIGZhaWxlZCBvciBtaXNzaW5nIGVudHJ5IG1heSBiZSBkb3dubG9hZGVkIG5vdy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVFbnRyeX0gZW50cnkgRGVzY3JpcHRvciBzdGF0ZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IFdoZXRoZXIgdGhlIHJldHJ5IGRlYWRsaW5lIGhhcyBwYXNzZWQuXG4gICAqL1xuICByZXRyeUVsaWdpYmxlKGVudHJ5KSB7XG4gICAgcmV0dXJuIGVudHJ5LnN0YXR1cyAhPT0gXCJmYWlsZWRcIiB8fCBlbnRyeS5uZXh0UmV0cnlBdCA9PT0gbnVsbCB8fCBlbnRyeS5uZXh0UmV0cnlBdCA8PSB0aGlzLm5vd01pbGxpc2Vjb25kcygpXG4gIH1cblxuICAvKipcbiAgICogQ2FsY3VsYXRlcyBib3VuZGVkIGV4cG9uZW50aWFsIHJldHJ5IGRlbGF5LlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXR0ZW1wdHMgQ29uc2VjdXRpdmUgZmFpbHVyZXMuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IFJldHJ5IGRlbGF5LlxuICAgKi9cbiAgcmV0cnlEZWxheShhdHRlbXB0cykge1xuICAgIHJldHVybiBNYXRoLm1pbih0aGlzLnJldHJ5TWF4RGVsYXlNcywgdGhpcy5yZXRyeUJhc2VEZWxheU1zICogKDIgKiogTWF0aC5tYXgoMCwgYXR0ZW1wdHMgLSAxKSkpXG4gIH1cblxuICAvKipcbiAgICogUmVhZHMgdGhlIGluamVjdGFibGUgd2FsbCBjbG9jay5cbiAgICogQHJldHVybnMge251bWJlcn0gQ3VycmVudCBlcG9jaCBtaWxsaXNlY29uZHMuXG4gICAqL1xuICBub3dNaWxsaXNlY29uZHMoKSB7XG4gICAgcmV0dXJuIHRoaXMubm93KCkuZ2V0VGltZSgpXG4gIH1cbn1cbiJdfQ==