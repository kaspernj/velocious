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
        while (true) {
            await this.beginActiveDigest(digest);
            let deferredCleanupRan;
            let uri;
            try {
                uri = await this.cachedUriWhileActive(entry);
            }
            finally {
                deferredCleanupRan = await this.finishActiveDigest(digest);
            }
            if (!deferredCleanupRan)
                return uri;
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
     * @returns {Promise<boolean>} Whether deferred cleanup ran after the final release.
     */
    async finishActiveDigest(digest, protectedCleanupDigests = new Set()) {
        const activeCount = this.activeDigestCounts.get(digest);
        if (activeCount === undefined) {
            throw new Error(`Missing active synchronized asset digest count for ${digest}`);
        }
        if (activeCount > 1) {
            this.activeDigestCounts.set(digest, activeCount - 1);
            return false;
        }
        this.activeDigestCounts.delete(digest);
        await this.deletePendingDigestIfUnreferenced(digest);
        const deferredCleanupRequired = this.cleanupRequiredAfterReleaseDigests.delete(digest);
        if (deferredCleanupRequired)
            await this.cleanup(protectedCleanupDigests);
        return deferredCleanupRequired;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2FjaGUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvc3luYy9hc3NldHMvY2FjaGUuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sY0FBYyxNQUFNLGlDQUFpQyxDQUFBO0FBRTVELE1BQU0sbUJBQW1CLEdBQUcsQ0FBQyxDQUFBO0FBQzdCLE1BQU0sMkJBQTJCLEdBQUcsSUFBSSxDQUFBO0FBQ3hDLE1BQU0sMEJBQTBCLEdBQUcsSUFBSSxHQUFHLEVBQUUsR0FBRyxDQUFDLENBQUE7QUFFaEQ7OztHQUdHO0FBQ0gsTUFBTSxDQUFDLE9BQU8sT0FBTyxzQkFBc0I7SUFDekM7Ozs7Ozs7Ozs7T0FVRztJQUNILFlBQVksRUFBQyxTQUFTLEVBQUUsT0FBTyxFQUFFLFFBQVEsRUFBRSxRQUFRLEVBQUUsR0FBRyxHQUFHLEdBQUcsRUFBRSxDQUFDLElBQUksSUFBSSxFQUFFLEVBQUUsZ0JBQWdCLEdBQUcsMkJBQTJCLEVBQUUsZUFBZSxHQUFHLDBCQUEwQixFQUFDO1FBQ3hLLElBQUksQ0FBQyxTQUFTO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxpREFBaUQsQ0FBQyxDQUFBO1FBQ2xGLElBQUksQ0FBQyxNQUFNLENBQUMsYUFBYSxDQUFDLFFBQVEsQ0FBQyxJQUFJLFFBQVEsR0FBRyxDQUFDO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyx1RUFBdUUsQ0FBQyxDQUFBO1FBQzdJLElBQUksQ0FBQyxNQUFNLENBQUMsYUFBYSxDQUFDLGdCQUFnQixDQUFDLElBQUksZ0JBQWdCLEdBQUcsQ0FBQztZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsMkVBQTJFLENBQUMsQ0FBQTtRQUNqSyxJQUFJLENBQUMsTUFBTSxDQUFDLGFBQWEsQ0FBQyxlQUFlLENBQUMsSUFBSSxlQUFlLEdBQUcsZ0JBQWdCO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyw0RUFBNEUsQ0FBQyxDQUFBO1FBRS9LLElBQUksQ0FB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QTtRQUNwQyx1QkFBdUI7UUFDdkIsTUFBTSxlQUFlLEdBQUcsRUFBRSxDQUFBO1FBRTFCLEtBQUssTUFBTSxLQUFLLElBQUksS0FBSyxDQUFDLE1BQU0sRUFBRSxDQUFDO1lBQ2pDLElBQUksQ0FBQyxLQUFLLENBQUMsU0FBUyxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUM7Z0JBQUUsU0FBUTtZQUNqRCxJQUFJLEtBQUssQ0FBQyxVQUFVLENBQUMsa0JBQWtCLEtBQUssVUFBVTtnQkFBRSxTQUFRO1lBQ2hFLElBQUksTUFBTSxJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQztnQkFBRSxTQUFRO1lBRXpDLGVBQWUsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLFVBQVUsQ0FBQyxFQUFFLENBQUMsQ0FBQTtRQUMzQyxDQUFDO1FBRUQsT0FBTyxlQUFlLENBQUE7SUFDeEIsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxhQUFhLENBQUMsS0FBSztRQUNqQixPQUFPLEtBQUssQ0FBQyxNQUFNLEtBQUssUUFBUSxJQUFJLEtBQUssQ0FBQyxXQUFXLEtBQUssSUFBSSxJQUFJLEtBQUssQ0FBQyxXQUFXLElBQUksSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFBO0lBQy9HLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsVUFBVSxDQUFDLFFBQVE7UUFDakIsT0FBTyxJQUFJLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxlQUFlLEVBQUUsSUFBSSxDQUFDLGdCQUFnQixHQUFHLENBQUMsQ0FBQyxJQUFJLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxFQUFFLFFBQVEsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUE7SUFDakcsQ0FBQztJQUVEOzs7T0FHRztJQUNILGVBQWU7UUFDYixPQUFPLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQyxPQUFPLEVBQUUsQ0FBQTtJQUM3QixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHNoYTI1NkJ5dGVzSGV4IGZyb20gXCIuLi8uLi91dGlscy9zaGEyNTYtYnl0ZXMtaGV4LmpzXCJcblxuY29uc3QgQ0FDSEVfU1RBVEVfVkVSU0lPTiA9IDFcbmNvbnN0IERFRkFVTFRfUkVUUllfQkFTRV9ERUxBWV9NUyA9IDEwMDBcbmNvbnN0IERFRkFVTFRfUkVUUllfTUFYX0RFTEFZX01TID0gMTAwMCAqIDYwICogNVxuXG4vKipcbiAqIENvcmUgc3luY2hyb25pemVkIGFzc2V0IGNhY2hlLiBQbGF0Zm9ybSBwYWNrYWdlcyBvd24gYnl0ZSBhbmQgbWV0YWRhdGFcbiAqIHBlcnNpc3RlbmNlIHdoaWxlIHRoaXMgY2xhc3Mgb3ducyBwb2xpY3ksIGludGVncml0eSwgYW5kIGxpZmVjeWNsZS5cbiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgU3luY2hyb25pemVkQXNzZXRDYWNoZSB7XG4gIC8qKlxuICAgKiBDcmVhdGVzIGEgc3luY2hyb25pemVkIGFzc2V0IGNhY2hlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5hY2NvdW50SWQgQXV0aGVudGljYXRlZCBhY2NvdW50IG5hbWVzcGFjZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVBZGFwdGVyfSBhcmdzLmFkYXB0ZXIgUGxhdGZvcm0gc3RvcmFnZSBhZGFwdGVyLlxuICAgKiBAcGFyYW0geyhkZXNjcmlwdG9yOiBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVEZXNjcmlwdG9yKSA9PiBQcm9taXNlPFVpbnQ4QXJyYXk+fSBhcmdzLmRvd25sb2FkIEF1dGhlbnRpY2F0ZWQgYnl0ZSBkb3dubG9hZGVyLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5tYXhCeXRlcyBNYXhpbXVtIGV2aWN0YWJsZSBjYWNoZSBzaXplLlxuICAgKiBAcGFyYW0geygpID0+IERhdGV9IFthcmdzLm5vd10gQ2xvY2suXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5yZXRyeUJhc2VEZWxheU1zXSBJbml0aWFsIHJldHJ5IGRlbGF5LlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MucmV0cnlNYXhEZWxheU1zXSBNYXhpbXVtIHJldHJ5IGRlbGF5LlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2FjY291bnRJZCwgYWRhcHRlciwgZG93bmxvYWQsIG1heEJ5dGVzLCBub3cgPSAoKSA9PiBuZXcgRGF0ZSgpLCByZXRyeUJhc2VEZWxheU1zID0gREVGQVVMVF9SRVRSWV9CQVNFX0RFTEFZX01TLCByZXRyeU1heERlbGF5TXMgPSBERUZBVUxUX1JFVFJZX01BWF9ERUxBWV9NU30pIHtcbiAgICBpZiAoIWFjY291bnRJZCkgdGhyb3cgbmV3IEVycm9yKFwiU3luY2hyb25pemVkIGFzc2V0IGNhY2hlIHJlcXVpcmVzIGFuIGFjY291bnQgaWRcIilcbiAgICBpZiAoIU51bWJlci5pc1NhZmVJbnRlZ2VyKG1heEJ5dGVzKSB8fCBtYXhCeXRlcyA8IDApIHRocm93IG5ldyBFcnJvcihcIlN5bmNocm9uaXplZCBhc3NldCBjYWNoZSBtYXhCeXRlcyBtdXN0IGJlIGEgbm9uLW5lZ2F0aXZlIHNhZmUgaW50ZWdlclwiKVxuICAgIGlmICghTnVtYmVyLmlzU2FmZUludGVnZXIocmV0cnlCYXNlRGVsYXlNcykgfHwgcmV0cnlCYXNlRGVsYXlNcyA8IDEpIHRocm93IG5ldyBFcnJvcihcIlN5bmNocm9uaXplZCBhc3NldCBjYWNoZSByZXRyeUJhc2VEZWxheU1zIG11c3QgYmUgYSBwb3NpdGl2ZSBzYWZlIGludGVnZXJcIilcbiAgICBpZiAoIU51bWJlci5pc1NhZmVJbnRlZ2VyKHJldHJ5TWF4RGVsYXlNcykgfHwgcmV0cnlNYXhEZWxheU1zIDwgcmV0cnlCYXNlRGVsYXlNcykgdGhyb3cgbmV3IEVycm9yKFwiU3luY2hyb25pemVkIGFzc2V0IGNhY2hlIHJldHJ5TWF4RGVsYXlNcyBtdXN0IGJlIGF0IGxlYXN0IHJldHJ5QmFzZURlbGF5TXNcIilcblxuICAgIHRoaXMuYWNjb3VudElkID0gYWNjb3VudElkXG4gICAgdGhpcy5hZGFwdGVyID0gYWRhcHRlclxuICAgIHRoaXMuZG93bmxvYWQgPSBkb3dubG9hZFxuICAgIHRoaXMubWF4Qnl0ZXMgPSBtYXhCeXRlc1xuICAgIHRoaXMubm93ID0gbm93XG4gICAgdGhpcy5yZXRyeUJhc2VEZWxheU1zID0gcmV0cnlCYXNlRGVsYXlNc1xuICAgIHRoaXMucmV0cnlNYXhEZWxheU1zID0gcmV0cnlNYXhEZWxheU1zXG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBudW1iZXI+fSAqL1xuICAgIHRoaXMuYWN0aXZlRGlnZXN0Q291bnRzID0gbmV3IE1hcCgpXG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBQcm9taXNlPHZvaWQ+Pn0gKi9cbiAgICB0aGlzLmRlbGV0aW9uUHJvbWlzZXMgPSBuZXcgTWFwKClcbiAgICAvKiogQHR5cGUge1NldDxzdHJpbmc+fSAqL1xuICAgIHRoaXMuY2xlYW51cFJlcXVpcmVkQWZ0ZXJSZWxlYXNlRGlnZXN0cyA9IG5ldyBTZXQoKVxuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTxudW1iZXI+fSAqL1xuICAgIHRoaXMuY2xlYW51cFByb21pc2UgPSBQcm9taXNlLnJlc29sdmUoMClcbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIFByb21pc2U8e2Vycm9yOiBFcnJvciwgdXJpOiBudWxsfSB8IHtlcnJvcjogbnVsbCwgdXJpOiBzdHJpbmd9Pj59ICovXG4gICAgdGhpcy5kb3dubG9hZFByb21pc2VzID0gbmV3IE1hcCgpXG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVTdGF0ZSB8IG51bGx9ICovXG4gICAgdGhpcy5zdGF0ZSA9IG51bGxcbiAgICAvKiogQHR5cGUge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlU3RhdGU+IHwgbnVsbH0gKi9cbiAgICB0aGlzLnN0YXRlUHJvbWlzZSA9IG51bGxcbiAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD59ICovXG4gICAgdGhpcy5zYXZlU3RhdGVQcm9taXNlID0gUHJvbWlzZS5yZXNvbHZlKClcbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIFByb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlU3luY2hyb25pemF0aW9uUmVzdWx0Pj59ICovXG4gICAgdGhpcy5zeW5jaHJvbml6ZVByb21pc2VzID0gbmV3IE1hcCgpXG4gIH1cblxuICAvKipcbiAgICogUmVjb25jaWxlcyB0aGUgaW1tdXRhYmxlIGRlc2NyaXB0b3JzIGZvciBvbmUgc3luY2hyb25pemVkIHNjb3BlIGFuZFxuICAgKiBkb3dubG9hZHMgZWxpZ2libGUgZWFnZXIgYXNzZXRzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyBSZWNvbmNpbGlhdGlvbiBpbnB1dHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlRGVzY3JpcHRvcltdfSBhcmdzLmRlc2NyaXB0b3JzIEN1cnJlbnQgZGVzY3JpcHRvcnMgaW4gdGhlIHNjb3BlLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3Mub25saW5lIFdoZXRoZXIgYXV0aGVudGljYXRlZCBkb3dubG9hZHMgYXJlIGF2YWlsYWJsZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc2NvcGVLZXkgU3RhYmxlIHN5bmNocm9uaXplZCBzY29wZSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZVN5bmNocm9uaXphdGlvblJlc3VsdD59IFN5bmNocm9uaXphdGlvbiByZXN1bHQuXG4gICAqL1xuICBhc3luYyBzeW5jaHJvbml6ZSh7ZGVzY3JpcHRvcnMsIG9ubGluZSwgc2NvcGVLZXl9KSB7XG4gICAgY29uc3Qgc3luY2hyb25pemUgPSBhc3luYyAoKSA9PiBhd2FpdCB0aGlzLnN5bmNocm9uaXplU2NvcGUoe2Rlc2NyaXB0b3JzLCBvbmxpbmUsIHNjb3BlS2V5fSlcbiAgICBjb25zdCBwcmV2aW91c1N5bmNocm9uaXphdGlvblByb21pc2UgPSB0aGlzLnN5bmNocm9uaXplUHJvbWlzZXMuZ2V0KHNjb3BlS2V5KVxuICAgIGNvbnN0IHN5bmNocm9uaXphdGlvblByb21pc2UgPSBwcmV2aW91c1N5bmNocm9uaXphdGlvblByb21pc2VcbiAgICAgID8gcHJldmlvdXNTeW5jaHJvbml6YXRpb25Qcm9taXNlLnRoZW4oc3luY2hyb25pemUsIHN5bmNocm9uaXplKVxuICAgICAgOiBzeW5jaHJvbml6ZSgpXG5cbiAgICB0aGlzLnN5bmNocm9uaXplUHJvbWlzZXMuc2V0KHNjb3BlS2V5LCBzeW5jaHJvbml6YXRpb25Qcm9taXNlKVxuXG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBhd2FpdCBzeW5jaHJvbml6YXRpb25Qcm9taXNlXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGlmICh0aGlzLnN5bmNocm9uaXplUHJvbWlzZXMuZ2V0KHNjb3BlS2V5KSA9PT0gc3luY2hyb25pemF0aW9uUHJvbWlzZSkge1xuICAgICAgICB0aGlzLnN5bmNocm9uaXplUHJvbWlzZXMuZGVsZXRlKHNjb3BlS2V5KVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG9uZSBzY29wZSBzeW5jaHJvbml6YXRpb24gYWZ0ZXIgcHJpb3IgY2FsbHMgZm9yIHRoYXQgc2NvcGUgZmluaXNoLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyBSZWNvbmNpbGlhdGlvbiBpbnB1dHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlRGVzY3JpcHRvcltdfSBhcmdzLmRlc2NyaXB0b3JzIEN1cnJlbnQgZGVzY3JpcHRvcnMgaW4gdGhlIHNjb3BlLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3Mub25saW5lIFdoZXRoZXIgYXV0aGVudGljYXRlZCBkb3dubG9hZHMgYXJlIGF2YWlsYWJsZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc2NvcGVLZXkgU3RhYmxlIHN5bmNocm9uaXplZCBzY29wZSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZVN5bmNocm9uaXphdGlvblJlc3VsdD59IFN5bmNocm9uaXphdGlvbiByZXN1bHQuXG4gICAqL1xuICBhc3luYyBzeW5jaHJvbml6ZVNjb3BlKHtkZXNjcmlwdG9ycywgb25saW5lLCBzY29wZUtleX0pIHtcbiAgICBhd2FpdCB0aGlzLmxvYWRTdGF0ZSgpXG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVEZXNjcmlwdG9yW10+fSAqL1xuICAgIGNvbnN0IGRlc2NyaXB0b3JzQnlEaWdlc3QgPSBuZXcgTWFwKClcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZUZhaWx1cmVbXX0gKi9cbiAgICBjb25zdCBmYWlsdXJlcyA9IFtdXG4gICAgLyoqIEB0eXBlIHtTZXQ8c3RyaW5nPn0gKi9cbiAgICBjb25zdCBhY3RpdmVEaWdlc3RzID0gbmV3IFNldCgpXG5cbiAgICBmb3IgKGNvbnN0IGRlc2NyaXB0b3Igb2YgZGVzY3JpcHRvcnMpIHtcbiAgICAgIGNvbnN0IGRpZ2VzdERlc2NyaXB0b3JzID0gZGVzY3JpcHRvcnNCeURpZ2VzdC5nZXQoZGVzY3JpcHRvci5kaWdlc3QpIHx8IFtdXG5cbiAgICAgIGRpZ2VzdERlc2NyaXB0b3JzLnB1c2goZGVzY3JpcHRvcilcbiAgICAgIGRlc2NyaXB0b3JzQnlEaWdlc3Quc2V0KGRlc2NyaXB0b3IuZGlnZXN0LCBkaWdlc3REZXNjcmlwdG9ycylcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgZm9yIChjb25zdCBkaWdlc3Qgb2YgZGVzY3JpcHRvcnNCeURpZ2VzdC5rZXlzKCkpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5iZWdpbkFjdGl2ZURpZ2VzdChkaWdlc3QpXG4gICAgICAgIGFjdGl2ZURpZ2VzdHMuYWRkKGRpZ2VzdClcbiAgICAgIH1cblxuICAgICAgY29uc3QgZW50cmllc0J5SWQgPSBhd2FpdCB0aGlzLnJlY29uY2lsZURlc2NyaXB0b3JzKHtkZXNjcmlwdG9ycywgc2NvcGVLZXl9KVxuXG4gICAgICBhd2FpdCB0aGlzLmRlbGV0ZVVucmVmZXJlbmNlZERpZ2VzdHMoKVxuXG4gICAgICBmb3IgKGNvbnN0IFtkaWdlc3QsIGRpZ2VzdERlc2NyaXB0b3JzXSBvZiBkZXNjcmlwdG9yc0J5RGlnZXN0KSB7XG4gICAgICAgIGNvbnN0IGVhZ2VyRGVzY3JpcHRvcnMgPSBvbmxpbmUgPyBkaWdlc3REZXNjcmlwdG9ycy5maWx0ZXIoKGRlc2NyaXB0b3IpID0+IGRlc2NyaXB0b3IuZmV0Y2ggPT09IFwiZWFnZXJcIikgOiBbXVxuXG4gICAgICAgIGlmIChlYWdlckRlc2NyaXB0b3JzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgIGFjdGl2ZURpZ2VzdHMuZGVsZXRlKGRpZ2VzdClcbiAgICAgICAgICBhd2FpdCB0aGlzLmZpbmlzaEFjdGl2ZURpZ2VzdChkaWdlc3QpXG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfVxuXG4gICAgICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlRW50cnlbXX0gKi9cbiAgICAgICAgY29uc3QgZWFnZXJFbnRyaWVzID0gW11cblxuICAgICAgICBmb3IgKGNvbnN0IGRlc2NyaXB0b3Igb2YgZWFnZXJEZXNjcmlwdG9ycykge1xuICAgICAgICAgIGNvbnN0IGVudHJ5ID0gZW50cmllc0J5SWQuZ2V0KGRlc2NyaXB0b3IuaWQpXG5cbiAgICAgICAgICBpZiAoIWVudHJ5KSB0aHJvdyBuZXcgRXJyb3IoYE1pc3NpbmcgcmVjb25jaWxlZCBzeW5jaHJvbml6ZWQgYXNzZXQgZGVzY3JpcHRvciAke2Rlc2NyaXB0b3IuaWR9YClcblxuICAgICAgICAgIGVhZ2VyRW50cmllcy5wdXNoKGVudHJ5KVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGVhZ2VyRW50cmllcy5zb21lKChlbnRyeSkgPT4gdGhpcy5yZXRyeUVsaWdpYmxlKGVudHJ5KSkpIHtcbiAgICAgICAgICBjb25zdCBjYWNoZVJlc3VsdCA9IGF3YWl0IHRoaXMuZW5zdXJlQ2FjaGVkV2hpbGVBY3RpdmUoZWFnZXJFbnRyaWVzKVxuXG4gICAgICAgICAgaWYgKGNhY2hlUmVzdWx0LmVycm9yKSB7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGVhZ2VyRW50cmllcykge1xuICAgICAgICAgICAgICBmYWlsdXJlcy5wdXNoKHthc3NldElkOiBlbnRyeS5kZXNjcmlwdG9yLmlkLCBlcnJvcjogY2FjaGVSZXN1bHQuZXJyb3J9KVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGFjdGl2ZURpZ2VzdHMuZGVsZXRlKGRpZ2VzdClcbiAgICAgICAgYXdhaXQgdGhpcy5maW5pc2hBY3RpdmVEaWdlc3QoZGlnZXN0KVxuICAgICAgICBhd2FpdCB0aGlzLmNsZWFudXAoKVxuICAgICAgfVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCB0aGlzLmZpbmlzaEFjdGl2ZURpZ2VzdHMoWy4uLmFjdGl2ZURpZ2VzdHNdKVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuY2xlYW51cCgpXG5cbiAgICByZXR1cm4ge1xuICAgICAgZmFpbHVyZXMsXG4gICAgICBtaXNzaW5nUmVxdWlyZWRBc3NldElkczogYXdhaXQgdGhpcy5taXNzaW5nUmVxdWlyZWRBc3NldElkcyhzY29wZUtleSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYSBjYWNoZWQgYXNzZXQgVVJJLCBkb3dubG9hZGluZyBpdCBvbiBkZW1hbmQgd2hlbiBhbGxvd2VkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyBSZXNvbHV0aW9uIGlucHV0cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuYXNzZXRJZCBBdHRhY2htZW50IGRlc2NyaXB0b3IgaWQuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5vbmxpbmUgV2hldGhlciBhdXRoZW50aWNhdGVkIGRvd25sb2FkcyBhcmUgYXZhaWxhYmxlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmcgfCBudWxsPn0gQ2FjaGVkIGFzc2V0IFVSSS5cbiAgICovXG4gIGFzeW5jIHJlc29sdmUoe2Fzc2V0SWQsIG9ubGluZX0pIHtcbiAgICBjb25zdCBzdGF0ZSA9IGF3YWl0IHRoaXMubG9hZFN0YXRlKClcbiAgICBjb25zdCBlbnRyeSA9IHN0YXRlLmFzc2V0cy5maW5kKChjYW5kaWRhdGUpID0+IGNhbmRpZGF0ZS5kZXNjcmlwdG9yLmlkID09PSBhc3NldElkKVxuXG4gICAgaWYgKCFlbnRyeSkgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IGRpZ2VzdCA9IGVudHJ5LmRlc2NyaXB0b3IuZGlnZXN0XG4gICAgbGV0IHJlc29sdmVkVXJpID0gbnVsbFxuICAgIGxldCBzaG91bGRDbGVhbnVwID0gZmFsc2VcblxuICAgIGF3YWl0IHRoaXMuYmVnaW5BY3RpdmVEaWdlc3QoZGlnZXN0KVxuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGNhY2hlZFVyaSA9IGF3YWl0IHRoaXMuY2FjaGVkVXJpV2hpbGVBY3RpdmUoZW50cnkpXG5cbiAgICAgIGlmIChjYWNoZWRVcmkpIHtcbiAgICAgICAgZW50cnkubGFzdEFjY2Vzc2VkQXQgPSB0aGlzLm5vd01pbGxpc2Vjb25kcygpXG4gICAgICAgIGVudHJ5LnN0YXR1cyA9IFwiY2FjaGVkXCJcbiAgICAgICAgYXdhaXQgdGhpcy5zYXZlU3RhdGUoKVxuXG4gICAgICAgIHJlc29sdmVkVXJpID0gY2FjaGVkVXJpXG4gICAgICB9IGVsc2UgaWYgKG9ubGluZSAmJiB0aGlzLnJldHJ5RWxpZ2libGUoZW50cnkpKSB7XG4gICAgICAgIGNvbnN0IGNhY2hlUmVzdWx0ID0gYXdhaXQgdGhpcy5lbnN1cmVDYWNoZWRXaGlsZUFjdGl2ZShbZW50cnldKVxuXG4gICAgICAgIGlmIChjYWNoZVJlc3VsdC5lcnJvcikgdGhyb3cgY2FjaGVSZXN1bHQuZXJyb3JcblxuICAgICAgICBpZiAoY2FjaGVSZXN1bHQudXJpKSB7XG4gICAgICAgICAgcmVzb2x2ZWRVcmkgPSBjYWNoZVJlc3VsdC51cmlcbiAgICAgICAgICBzaG91bGRDbGVhbnVwID0gdHJ1ZVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IHRoaXMuZmluaXNoQWN0aXZlRGlnZXN0KGRpZ2VzdCwgc2hvdWxkQ2xlYW51cCA/IG5ldyBTZXQoW2RpZ2VzdF0pIDogbmV3IFNldCgpKVxuICAgIH1cblxuICAgIGlmIChzaG91bGRDbGVhbnVwKSBhd2FpdCB0aGlzLmNsZWFudXAobmV3IFNldChbZGlnZXN0XSkpXG4gICAgY29uc3QgcmVxdWlyZXNVbnByb3RlY3RlZENsZWFudXAgPSBzaG91bGRDbGVhbnVwIHx8IChlbnRyeS5kZXNjcmlwdG9yLmJ5dGVTaXplID4gdGhpcy5tYXhCeXRlcyAmJiAhc3RhdGUuYXNzZXRzLnNvbWUoKGNhbmRpZGF0ZSkgPT4ge1xuICAgICAgcmV0dXJuIGNhbmRpZGF0ZS5kZXNjcmlwdG9yLmRpZ2VzdCA9PT0gZGlnZXN0ICYmIGNhbmRpZGF0ZS5kZXNjcmlwdG9yLnJldGVudGlvbiA9PT0gXCJkdXJhYmxlXCJcbiAgICB9KSlcblxuICAgIGlmIChyZXF1aXJlc1VucHJvdGVjdGVkQ2xlYW51cCkgYXdhaXQgdGhpcy5jbGVhbnVwKClcbiAgICBpZiAoIXJlc29sdmVkVXJpKSByZXR1cm4gbnVsbFxuICAgIGNvbnN0IHJlc29sdmVkRW50cnkgPSBzdGF0ZS5hc3NldHMuZmluZCgoY2FuZGlkYXRlKSA9PiBjYW5kaWRhdGUuZGVzY3JpcHRvci5pZCA9PT0gYXNzZXRJZCAmJiBjYW5kaWRhdGUuZGVzY3JpcHRvci5kaWdlc3QgPT09IGRpZ2VzdClcblxuICAgIGlmICghcmVzb2x2ZWRFbnRyeSkgcmV0dXJuIG51bGxcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLmNhY2hlZFVyaShyZXNvbHZlZEVudHJ5KVxuICB9XG5cbiAgLyoqXG4gICAqIEV2aWN0cyBsZWFzdC1yZWNlbnRseS11c2VkIGJsb2JzIHVudGlsIHRoZSB1bmlxdWUgY2FjaGVkIGJ5dGUgdG90YWwgaXNcbiAgICogd2l0aGluIHRoZSBjb25maWd1cmVkIGJ1ZGdldC4gQSBibG9iIHN0YXlzIGR1cmFibGUgd2hlbiBhbnkgbGl2ZVxuICAgKiBkZXNjcmlwdG9yIHJlZmVyZW5jZSBkZWNsYXJlcyBkdXJhYmxlIHJldGVudGlvbi5cbiAgICogQHBhcmFtIHtTZXQ8c3RyaW5nPn0gW3Byb3RlY3RlZERpZ2VzdHNdIERpZ2VzdHMgbmVlZGVkIGJ5IHRoZSBhY3RpdmUgY2FsbGVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSBCeXRlcyByZW1vdmVkLlxuICAgKi9cbiAgYXN5bmMgY2xlYW51cChwcm90ZWN0ZWREaWdlc3RzID0gbmV3IFNldCgpKSB7XG4gICAgY29uc3QgY2xlYW51cCA9IGFzeW5jICgpID0+IGF3YWl0IHRoaXMucGVyZm9ybUNsZWFudXAocHJvdGVjdGVkRGlnZXN0cylcbiAgICBjb25zdCBjbGVhbnVwUHJvbWlzZSA9IHRoaXMuY2xlYW51cFByb21pc2UudGhlbihjbGVhbnVwLCBjbGVhbnVwKVxuXG4gICAgdGhpcy5jbGVhbnVwUHJvbWlzZSA9IGNsZWFudXBQcm9taXNlXG5cbiAgICByZXR1cm4gYXdhaXQgY2xlYW51cFByb21pc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBQZXJmb3JtcyBvbmUgc2VyaWFsaXplZCBldmljdGlvbiBwYXNzLlxuICAgKiBAcGFyYW0ge1NldDxzdHJpbmc+fSBwcm90ZWN0ZWREaWdlc3RzIERpZ2VzdHMgbmVlZGVkIGJ5IHRoZSBhY3RpdmUgY2FsbGVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSBCeXRlcyByZW1vdmVkLlxuICAgKi9cbiAgYXN5bmMgcGVyZm9ybUNsZWFudXAocHJvdGVjdGVkRGlnZXN0cykge1xuICAgIGNvbnN0IHN0YXRlID0gYXdhaXQgdGhpcy5sb2FkU3RhdGUoKVxuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlRW50cnlbXT59ICovXG4gICAgY29uc3QgZW50cmllc0J5RGlnZXN0ID0gbmV3IE1hcCgpXG5cbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHN0YXRlLmFzc2V0cykge1xuICAgICAgY29uc3QgZGlnZXN0RW50cmllcyA9IGVudHJpZXNCeURpZ2VzdC5nZXQoZW50cnkuZGVzY3JpcHRvci5kaWdlc3QpIHx8IFtdXG5cbiAgICAgIGRpZ2VzdEVudHJpZXMucHVzaChlbnRyeSlcbiAgICAgIGVudHJpZXNCeURpZ2VzdC5zZXQoZW50cnkuZGVzY3JpcHRvci5kaWdlc3QsIGRpZ2VzdEVudHJpZXMpXG4gICAgfVxuXG4gICAgLyoqIEB0eXBlIHt7Ynl0ZVNpemU6IG51bWJlciwgZGlnZXN0OiBzdHJpbmcsIGxhc3RBY2Nlc3NlZEF0OiBudW1iZXJ9W119ICovXG4gICAgY29uc3QgY2FjaGVkQmxvYnMgPSBbXVxuICAgIGxldCBjYWNoZWRCeXRlcyA9IDBcblxuICAgIGZvciAoY29uc3QgW2RpZ2VzdCwgcmVmZXJlbmNlc10gb2YgZW50cmllc0J5RGlnZXN0KSB7XG4gICAgICBjb25zdCB1cmkgPSBhd2FpdCB0aGlzLmFkYXB0ZXIuYmxvYlVyaSh7YWNjb3VudElkOiB0aGlzLmFjY291bnRJZCwgZGlnZXN0fSlcblxuICAgICAgaWYgKCF1cmkpIHtcbiAgICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiByZWZlcmVuY2VzKSB7XG4gICAgICAgICAgaWYgKGVudHJ5LnN0YXR1cyA9PT0gXCJjYWNoZWRcIikgZW50cnkuc3RhdHVzID0gXCJtaXNzaW5nXCJcbiAgICAgICAgfVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBjb25zdCBieXRlU2l6ZSA9IHJlZmVyZW5jZXNbMF0uZGVzY3JpcHRvci5ieXRlU2l6ZVxuXG4gICAgICBjYWNoZWRCeXRlcyArPSBieXRlU2l6ZVxuICAgICAgY2FjaGVkQmxvYnMucHVzaCh7XG4gICAgICAgIGJ5dGVTaXplLFxuICAgICAgICBkaWdlc3QsXG4gICAgICAgIGxhc3RBY2Nlc3NlZEF0OiBNYXRoLm1heCguLi5yZWZlcmVuY2VzLm1hcCgoZW50cnkpID0+IGVudHJ5Lmxhc3RBY2Nlc3NlZEF0KSlcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgbGV0IHJlbW92ZWRCeXRlcyA9IDBcblxuICAgIHdoaWxlIChjYWNoZWRCbG9icy5sZW5ndGggPiAwKSB7XG4gICAgICBpZiAoY2FjaGVkQnl0ZXMgPD0gdGhpcy5tYXhCeXRlcykgYnJlYWtcblxuICAgICAgZm9yIChjb25zdCBjYWNoZWRCbG9iIG9mIGNhY2hlZEJsb2JzKSB7XG4gICAgICAgIGNvbnN0IGN1cnJlbnRSZWZlcmVuY2VzID0gc3RhdGUuYXNzZXRzLmZpbHRlcigoZW50cnkpID0+IGVudHJ5LmRlc2NyaXB0b3IuZGlnZXN0ID09PSBjYWNoZWRCbG9iLmRpZ2VzdClcblxuICAgICAgICBpZiAoY3VycmVudFJlZmVyZW5jZXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgIGNhY2hlZEJsb2IubGFzdEFjY2Vzc2VkQXQgPSBNYXRoLm1heCguLi5jdXJyZW50UmVmZXJlbmNlcy5tYXAoKGVudHJ5KSA9PiBlbnRyeS5sYXN0QWNjZXNzZWRBdCkpXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgY2FjaGVkQmxvYnMuc29ydCgobGVmdCwgcmlnaHQpID0+IGxlZnQubGFzdEFjY2Vzc2VkQXQgLSByaWdodC5sYXN0QWNjZXNzZWRBdCB8fCBsZWZ0LmRpZ2VzdC5sb2NhbGVDb21wYXJlKHJpZ2h0LmRpZ2VzdCkpXG5cbiAgICAgIGNvbnN0IGJsb2IgPSBjYWNoZWRCbG9icy5zaGlmdCgpXG5cbiAgICAgIGlmICghYmxvYikgdGhyb3cgbmV3IEVycm9yKFwiRXhwZWN0ZWQgYSBzeW5jaHJvbml6ZWQgYXNzZXQgY2FjaGUgZXZpY3Rpb24gY2FuZGlkYXRlXCIpXG4gICAgICBpZiAocHJvdGVjdGVkRGlnZXN0cy5oYXMoYmxvYi5kaWdlc3QpKSBjb250aW51ZVxuICAgICAgbGV0IGJsb2JXYXNBbHJlYWR5TWlzc2luZyA9IGZhbHNlXG4gICAgICBsZXQgZGVsZXRpb25DaGVja2VkID0gZmFsc2VcbiAgICAgIGNvbnN0IGRlbGV0ZWQgPSBhd2FpdCB0aGlzLmRlbGV0ZURpZ2VzdElmSW5hY3RpdmUoYmxvYi5kaWdlc3QsIGFzeW5jICgpID0+IHtcbiAgICAgICAgZGVsZXRpb25DaGVja2VkID0gdHJ1ZVxuXG4gICAgICAgIGlmICghdGhpcy5zdGF0ZSkgdGhyb3cgbmV3IEVycm9yKFwiQ2Fubm90IGNsZWFuIHN5bmNocm9uaXplZCBhc3NldCBibG9icyBiZWZvcmUgbG9hZGluZyBzdGF0ZVwiKVxuXG4gICAgICAgIGNvbnN0IGN1cnJlbnRVcmkgPSBhd2FpdCB0aGlzLmFkYXB0ZXIuYmxvYlVyaSh7YWNjb3VudElkOiB0aGlzLmFjY291bnRJZCwgZGlnZXN0OiBibG9iLmRpZ2VzdH0pXG4gICAgICAgIGNvbnN0IGN1cnJlbnRSZWZlcmVuY2VzID0gdGhpcy5zdGF0ZS5hc3NldHMuZmlsdGVyKChlbnRyeSkgPT4gZW50cnkuZGVzY3JpcHRvci5kaWdlc3QgPT09IGJsb2IuZGlnZXN0KVxuXG4gICAgICAgIGlmICghY3VycmVudFVyaSkge1xuICAgICAgICAgIGJsb2JXYXNBbHJlYWR5TWlzc2luZyA9IHRydWVcblxuICAgICAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgY3VycmVudFJlZmVyZW5jZXMpIHtcbiAgICAgICAgICAgIGlmIChlbnRyeS5zdGF0dXMgPT09IFwiY2FjaGVkXCIpIGVudHJ5LnN0YXR1cyA9IFwibWlzc2luZ1wiXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICAgIH1cbiAgICAgICAgaWYgKGN1cnJlbnRSZWZlcmVuY2VzLnNvbWUoKGVudHJ5KSA9PiBlbnRyeS5kZXNjcmlwdG9yLnJldGVudGlvbiA9PT0gXCJkdXJhYmxlXCIpKSByZXR1cm4gZmFsc2VcblxuICAgICAgICBhd2FpdCB0aGlzLmFkYXB0ZXIuZGVsZXRlQmxvYih7YWNjb3VudElkOiB0aGlzLmFjY291bnRJZCwgZGlnZXN0OiBibG9iLmRpZ2VzdH0pXG5cbiAgICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiBjdXJyZW50UmVmZXJlbmNlcykge1xuICAgICAgICAgIGVudHJ5LmF0dGVtcHRzID0gMFxuICAgICAgICAgIGVudHJ5Lm5leHRSZXRyeUF0ID0gbnVsbFxuICAgICAgICAgIGVudHJ5LnN0YXR1cyA9IFwibWlzc2luZ1wiXG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdHJ1ZVxuICAgICAgfSlcblxuICAgICAgaWYgKCFkZWxldGlvbkNoZWNrZWQpIHRoaXMuY2xlYW51cFJlcXVpcmVkQWZ0ZXJSZWxlYXNlRGlnZXN0cy5hZGQoYmxvYi5kaWdlc3QpXG4gICAgICBpZiAoYmxvYldhc0FscmVhZHlNaXNzaW5nKSBjYWNoZWRCeXRlcyAtPSBibG9iLmJ5dGVTaXplXG4gICAgICBpZiAoIWRlbGV0ZWQpIGNvbnRpbnVlXG5cbiAgICAgIGNhY2hlZEJ5dGVzIC09IGJsb2IuYnl0ZVNpemVcbiAgICAgIHJlbW92ZWRCeXRlcyArPSBibG9iLmJ5dGVTaXplXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5zYXZlU3RhdGUoKVxuXG4gICAgcmV0dXJuIHJlbW92ZWRCeXRlc1xuICB9XG5cbiAgLyoqXG4gICAqIExvYWRzIGNhY2hlIHN0YXRlIG9uY2UgZm9yIHRoaXMgY2FjaGUgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZVN0YXRlPn0gTG9hZGVkIHN0YXRlLlxuICAgKi9cbiAgYXN5bmMgbG9hZFN0YXRlKCkge1xuICAgIGlmICh0aGlzLnN0YXRlKSByZXR1cm4gdGhpcy5zdGF0ZVxuICAgIGlmICh0aGlzLnN0YXRlUHJvbWlzZSkgcmV0dXJuIGF3YWl0IHRoaXMuc3RhdGVQcm9taXNlXG5cbiAgICB0aGlzLnN0YXRlUHJvbWlzZSA9IHRoaXMubG9hZFN0YXRlRnJvbUFkYXB0ZXIoKVxuXG4gICAgdHJ5IHtcbiAgICAgIHRoaXMuc3RhdGUgPSBhd2FpdCB0aGlzLnN0YXRlUHJvbWlzZVxuXG4gICAgICByZXR1cm4gdGhpcy5zdGF0ZVxuICAgIH0gZmluYWxseSB7XG4gICAgICB0aGlzLnN0YXRlUHJvbWlzZSA9IG51bGxcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogTG9hZHMgYW5kIHJlY292ZXJzIHBlcnNpc3RlZCBjYWNoZSBzdGF0ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlU3RhdGU+fSBMb2FkZWQgc3RhdGUuXG4gICAqL1xuICBhc3luYyBsb2FkU3RhdGVGcm9tQWRhcHRlcigpIHtcbiAgICBjb25zdCBsb2FkZWRTdGF0ZSA9IGF3YWl0IHRoaXMuYWRhcHRlci5sb2FkU3RhdGUoe2FjY291bnRJZDogdGhpcy5hY2NvdW50SWR9KVxuXG4gICAgaWYgKCFsb2FkZWRTdGF0ZSkgcmV0dXJuIHthc3NldHM6IFtdLCBwZW5kaW5nRGVsZXRpb25EaWdlc3RzOiBbXSwgdmVyc2lvbjogQ0FDSEVfU1RBVEVfVkVSU0lPTn1cbiAgICBpZiAobG9hZGVkU3RhdGUudmVyc2lvbiAhPT0gQ0FDSEVfU1RBVEVfVkVSU0lPTikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbnN1cHBvcnRlZCBzeW5jaHJvbml6ZWQgYXNzZXQgY2FjaGUgc3RhdGUgdmVyc2lvbjogJHtsb2FkZWRTdGF0ZS52ZXJzaW9ufWApXG4gICAgfVxuXG4gICAgbGV0IHJlY292ZXJlZEludGVycnVwdGVkRG93bmxvYWQgPSBmYWxzZVxuXG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiBsb2FkZWRTdGF0ZS5hc3NldHMpIHtcbiAgICAgIGlmIChlbnRyeS5zdGF0dXMgIT09IFwiZG93bmxvYWRpbmdcIikgY29udGludWVcblxuICAgICAgZW50cnkuYXR0ZW1wdHMgKz0gMVxuICAgICAgZW50cnkubmV4dFJldHJ5QXQgPSB0aGlzLm5vd01pbGxpc2Vjb25kcygpXG4gICAgICBlbnRyeS5zdGF0dXMgPSBcImZhaWxlZFwiXG4gICAgICByZWNvdmVyZWRJbnRlcnJ1cHRlZERvd25sb2FkID0gdHJ1ZVxuICAgIH1cblxuICAgIGlmIChyZWNvdmVyZWRJbnRlcnJ1cHRlZERvd25sb2FkKSB7XG4gICAgICBhd2FpdCB0aGlzLmFkYXB0ZXIuc2F2ZVN0YXRlKHthY2NvdW50SWQ6IHRoaXMuYWNjb3VudElkLCBzdGF0ZTogbG9hZGVkU3RhdGV9KVxuICAgIH1cblxuICAgIHJldHVybiBsb2FkZWRTdGF0ZVxuICB9XG5cbiAgLyoqXG4gICAqIFBlcnNpc3RzIHRoZSBjdXJyZW50IGNhY2hlIHN0YXRlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgYWZ0ZXIgc3RhdGUgcGVyc2lzdGVuY2UuXG4gICAqL1xuICBhc3luYyBzYXZlU3RhdGUoKSB7XG4gICAgaWYgKCF0aGlzLnN0YXRlKSB0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3Qgc2F2ZSBzeW5jaHJvbml6ZWQgYXNzZXQgY2FjaGUgYmVmb3JlIGxvYWRpbmcgc3RhdGVcIilcblxuICAgIGNvbnN0IHBlcnNpc3QgPSBhc3luYyAoKSA9PiB7XG4gICAgICBpZiAoIXRoaXMuc3RhdGUpIHRocm93IG5ldyBFcnJvcihcIkNhbm5vdCBzYXZlIHN5bmNocm9uaXplZCBhc3NldCBjYWNoZSBiZWZvcmUgbG9hZGluZyBzdGF0ZVwiKVxuXG4gICAgICBhd2FpdCB0aGlzLmFkYXB0ZXIuc2F2ZVN0YXRlKHthY2NvdW50SWQ6IHRoaXMuYWNjb3VudElkLCBzdGF0ZTogdGhpcy5zdGF0ZX0pXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5zZXJpYWxpemVTdGF0ZVBlcnNpc3RlbmNlKHBlcnNpc3QpXG4gIH1cblxuICAvKipcbiAgICogUGVyc2lzdHMgYSBkZXRhY2hlZCByZWNvbmNpbGlhdGlvbiBiZWZvcmUgZXhwb3NpbmcgaXQgdGhyb3VnaCBzaGFyZWQgc3RhdGUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIFJlY29uY2lsaWF0aW9uIGlucHV0cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVEZXNjcmlwdG9yW119IGFyZ3MuZGVzY3JpcHRvcnMgQ3VycmVudCBkZXNjcmlwdG9ycyBpbiB0aGUgc2NvcGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnNjb3BlS2V5IFN0YWJsZSBzeW5jaHJvbml6ZWQgc2NvcGUga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxNYXA8c3RyaW5nLCBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVFbnRyeT4+fSBSZWNvbmNpbGVkIGxpdmUgZW50cmllcyBieSBpZC5cbiAgICovXG4gIGFzeW5jIHJlY29uY2lsZURlc2NyaXB0b3JzKHtkZXNjcmlwdG9ycywgc2NvcGVLZXl9KSB7XG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVFbnRyeT4gfCBudWxsfSAqL1xuICAgIGxldCBlbnRyaWVzQnlJZCA9IG51bGxcblxuICAgIGNvbnN0IHBlcnNpc3QgPSBhc3luYyAoKSA9PiB7XG4gICAgICBpZiAoIXRoaXMuc3RhdGUpIHRocm93IG5ldyBFcnJvcihcIkNhbm5vdCByZWNvbmNpbGUgc3luY2hyb25pemVkIGFzc2V0IGNhY2hlIGJlZm9yZSBsb2FkaW5nIHN0YXRlXCIpXG5cbiAgICAgIGNvbnN0IGNhbmRpZGF0ZVN0YXRlID0gdGhpcy5jb3B5U3RhdGUodGhpcy5zdGF0ZSlcbiAgICAgIGNvbnN0IG5ld0VudHJ5TGFzdEFjY2Vzc2VkQXQgPSB0aGlzLm5vd01pbGxpc2Vjb25kcygpXG5cbiAgICAgIHRoaXMuYXBwbHlEZXNjcmlwdG9yUmVjb25jaWxpYXRpb24oe2Rlc2NyaXB0b3JzLCBuZXdFbnRyeUxhc3RBY2Nlc3NlZEF0LCBzY29wZUtleSwgc3RhdGU6IGNhbmRpZGF0ZVN0YXRlfSlcbiAgICAgIGF3YWl0IHRoaXMuYWRhcHRlci5zYXZlU3RhdGUoe2FjY291bnRJZDogdGhpcy5hY2NvdW50SWQsIHN0YXRlOiBjYW5kaWRhdGVTdGF0ZX0pXG4gICAgICBlbnRyaWVzQnlJZCA9IHRoaXMuYXBwbHlEZXNjcmlwdG9yUmVjb25jaWxpYXRpb24oe2Rlc2NyaXB0b3JzLCBuZXdFbnRyeUxhc3RBY2Nlc3NlZEF0LCBzY29wZUtleSwgc3RhdGU6IHRoaXMuc3RhdGV9KVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuc2VyaWFsaXplU3RhdGVQZXJzaXN0ZW5jZShwZXJzaXN0KVxuXG4gICAgaWYgKCFlbnRyaWVzQnlJZCkgdGhyb3cgbmV3IEVycm9yKFwiU3luY2hyb25pemVkIGFzc2V0IGRlc2NyaXB0b3IgcmVjb25jaWxpYXRpb24gY29tcGxldGVkIHdpdGhvdXQgbGl2ZSBlbnRyaWVzXCIpXG5cbiAgICByZXR1cm4gZW50cmllc0J5SWRcbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBsaWVzIG9uZSBzY29wZSdzIGRlc2NyaXB0b3Igc2V0IHRvIGNhY2hlIHN0YXRlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyBSZWNvbmNpbGlhdGlvbiBpbnB1dHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlRGVzY3JpcHRvcltdfSBhcmdzLmRlc2NyaXB0b3JzIEN1cnJlbnQgZGVzY3JpcHRvcnMgaW4gdGhlIHNjb3BlLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5uZXdFbnRyeUxhc3RBY2Nlc3NlZEF0IEluaXRpYWwgTFJVIHRpbWVzdGFtcCBmb3IgbmV3IGVudHJpZXMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnNjb3BlS2V5IFN0YWJsZSBzeW5jaHJvbml6ZWQgc2NvcGUga2V5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZVN0YXRlfSBhcmdzLnN0YXRlIFN0YXRlIHRvIHJlY29uY2lsZS5cbiAgICogQHJldHVybnMge01hcDxzdHJpbmcsIGltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZUVudHJ5Pn0gTGl2ZSBlbnRyaWVzIGJ5IGlkLlxuICAgKi9cbiAgYXBwbHlEZXNjcmlwdG9yUmVjb25jaWxpYXRpb24oe2Rlc2NyaXB0b3JzLCBuZXdFbnRyeUxhc3RBY2Nlc3NlZEF0LCBzY29wZUtleSwgc3RhdGV9KSB7XG4gICAgY29uc3QgaW5jb21pbmdJZHMgPSBuZXcgU2V0KGRlc2NyaXB0b3JzLm1hcCgoYXNzZXQpID0+IGFzc2V0LmlkKSlcbiAgICBjb25zdCBlbnRyaWVzQnlJZCA9IG5ldyBNYXAoc3RhdGUuYXNzZXRzLm1hcCgoZW50cnkpID0+IFtlbnRyeS5kZXNjcmlwdG9yLmlkLCBlbnRyeV0pKVxuICAgIGNvbnN0IGRlc2NyaXB0b3JzQnlJZCA9IG5ldyBNYXAoc3RhdGUuYXNzZXRzLm1hcCgoZW50cnkpID0+IFtlbnRyeS5kZXNjcmlwdG9yLmlkLCBlbnRyeS5kZXNjcmlwdG9yXSkpXG4gICAgY29uc3QgcmVtb3ZlZERpZ2VzdHMgPSBuZXcgU2V0KClcblxuICAgIGZvciAoY29uc3QgYXNzZXQgb2YgZGVzY3JpcHRvcnMpIHtcbiAgICAgIGNvbnN0IGtub3duRGVzY3JpcHRvciA9IGRlc2NyaXB0b3JzQnlJZC5nZXQoYXNzZXQuaWQpXG5cbiAgICAgIGlmIChrbm93bkRlc2NyaXB0b3IgJiYga25vd25EZXNjcmlwdG9yLmRpZ2VzdCAhPT0gYXNzZXQuZGlnZXN0KSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgU3luY2hyb25pemVkIGFzc2V0IGRlc2NyaXB0b3IgJHthc3NldC5pZH0gY2hhbmdlZCBpdHMgaW1tdXRhYmxlIGRpZ2VzdGApXG4gICAgICB9XG4gICAgICBpZiAoa25vd25EZXNjcmlwdG9yICYmIGtub3duRGVzY3JpcHRvci5ieXRlU2l6ZSAhPT0gYXNzZXQuYnl0ZVNpemUpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBTeW5jaHJvbml6ZWQgYXNzZXQgZGVzY3JpcHRvciAke2Fzc2V0LmlkfSBjaGFuZ2VkIGl0cyBpbW11dGFibGUgYnl0ZSBzaXplYClcbiAgICAgIH1cbiAgICAgIGlmIChrbm93bkRlc2NyaXB0b3IgJiYga25vd25EZXNjcmlwdG9yLmNvbnRlbnRUeXBlICE9PSBhc3NldC5jb250ZW50VHlwZSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFN5bmNocm9uaXplZCBhc3NldCBkZXNjcmlwdG9yICR7YXNzZXQuaWR9IGNoYW5nZWQgaXRzIGltbXV0YWJsZSBjb250ZW50IHR5cGVgKVxuICAgICAgfVxuXG4gICAgICBkZXNjcmlwdG9yc0J5SWQuc2V0KGFzc2V0LmlkLCBhc3NldClcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHN0YXRlLmFzc2V0cykge1xuICAgICAgaWYgKCFlbnRyeS5zY29wZUtleXMuaW5jbHVkZXMoc2NvcGVLZXkpIHx8IGluY29taW5nSWRzLmhhcyhlbnRyeS5kZXNjcmlwdG9yLmlkKSkgY29udGludWVcblxuICAgICAgZW50cnkuc2NvcGVLZXlzID0gZW50cnkuc2NvcGVLZXlzLmZpbHRlcigoY2FuZGlkYXRlKSA9PiBjYW5kaWRhdGUgIT09IHNjb3BlS2V5KVxuICAgICAgaWYgKGVudHJ5LnNjb3BlS2V5cy5sZW5ndGggPT09IDApIHJlbW92ZWREaWdlc3RzLmFkZChlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdClcbiAgICB9XG5cbiAgICBzdGF0ZS5hc3NldHMgPSBzdGF0ZS5hc3NldHMuZmlsdGVyKChlbnRyeSkgPT4gZW50cnkuc2NvcGVLZXlzLmxlbmd0aCA+IDApXG5cbiAgICBmb3IgKGNvbnN0IGFzc2V0IG9mIGRlc2NyaXB0b3JzKSB7XG4gICAgICBjb25zdCBleGlzdGluZyA9IGVudHJpZXNCeUlkLmdldChhc3NldC5pZClcblxuICAgICAgaWYgKGV4aXN0aW5nICYmIHN0YXRlLmFzc2V0cy5pbmNsdWRlcyhleGlzdGluZykpIHtcbiAgICAgICAgZXhpc3RpbmcuZGVzY3JpcHRvciA9IGFzc2V0XG4gICAgICAgIGlmICghZXhpc3Rpbmcuc2NvcGVLZXlzLmluY2x1ZGVzKHNjb3BlS2V5KSkgZXhpc3Rpbmcuc2NvcGVLZXlzLnB1c2goc2NvcGVLZXkpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb25zdCBuZXdFbnRyeSA9IHtcbiAgICAgICAgICBhdHRlbXB0czogMCxcbiAgICAgICAgICBkZXNjcmlwdG9yOiBhc3NldCxcbiAgICAgICAgICBsYXN0QWNjZXNzZWRBdDogbmV3RW50cnlMYXN0QWNjZXNzZWRBdCxcbiAgICAgICAgICBuZXh0UmV0cnlBdDogbnVsbCxcbiAgICAgICAgICBzY29wZUtleXM6IFtzY29wZUtleV0sXG4gICAgICAgICAgc3RhdHVzOiAvKiogQHR5cGUge2NvbnN0fSAqLyAoXCJtaXNzaW5nXCIpXG4gICAgICAgIH1cblxuICAgICAgICBzdGF0ZS5hc3NldHMucHVzaChuZXdFbnRyeSlcbiAgICAgICAgZW50cmllc0J5SWQuc2V0KGFzc2V0LmlkLCBuZXdFbnRyeSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIG51bWJlcj59ICovXG4gICAgY29uc3QgYnl0ZVNpemVzQnlEaWdlc3QgPSBuZXcgTWFwKClcbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIHN0cmluZyB8IG51bGw+fSAqL1xuICAgIGNvbnN0IGNvbnRlbnRUeXBlc0J5RGlnZXN0ID0gbmV3IE1hcCgpXG5cbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHN0YXRlLmFzc2V0cykge1xuICAgICAgY29uc3Qga25vd25CeXRlU2l6ZSA9IGJ5dGVTaXplc0J5RGlnZXN0LmdldChlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdClcbiAgICAgIGNvbnN0IGtub3duQ29udGVudFR5cGUgPSBjb250ZW50VHlwZXNCeURpZ2VzdC5nZXQoZW50cnkuZGVzY3JpcHRvci5kaWdlc3QpXG5cbiAgICAgIGlmIChrbm93bkJ5dGVTaXplICE9PSB1bmRlZmluZWQgJiYga25vd25CeXRlU2l6ZSAhPT0gZW50cnkuZGVzY3JpcHRvci5ieXRlU2l6ZSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFN5bmNocm9uaXplZCBhc3NldCBkaWdlc3QgJHtlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdH0gaGFzIGluY29uc2lzdGVudCBieXRlIHNpemVzYClcbiAgICAgIH1cbiAgICAgIGlmIChrbm93bkNvbnRlbnRUeXBlICE9PSB1bmRlZmluZWQgJiYga25vd25Db250ZW50VHlwZSAhPT0gZW50cnkuZGVzY3JpcHRvci5jb250ZW50VHlwZSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFN5bmNocm9uaXplZCBhc3NldCBkaWdlc3QgJHtlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdH0gaGFzIGluY29uc2lzdGVudCBjb250ZW50IHR5cGVzYClcbiAgICAgIH1cblxuICAgICAgYnl0ZVNpemVzQnlEaWdlc3Quc2V0KGVudHJ5LmRlc2NyaXB0b3IuZGlnZXN0LCBlbnRyeS5kZXNjcmlwdG9yLmJ5dGVTaXplKVxuICAgICAgY29udGVudFR5cGVzQnlEaWdlc3Quc2V0KGVudHJ5LmRlc2NyaXB0b3IuZGlnZXN0LCBlbnRyeS5kZXNjcmlwdG9yLmNvbnRlbnRUeXBlKVxuICAgIH1cblxuICAgIGZvciAoY29uc3QgZGlnZXN0IG9mIHJlbW92ZWREaWdlc3RzKSB7XG4gICAgICBpZiAoc3RhdGUuYXNzZXRzLnNvbWUoKGVudHJ5KSA9PiBlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdCA9PT0gZGlnZXN0KSkgY29udGludWVcbiAgICAgIGlmICghc3RhdGUucGVuZGluZ0RlbGV0aW9uRGlnZXN0cy5pbmNsdWRlcyhkaWdlc3QpKSBzdGF0ZS5wZW5kaW5nRGVsZXRpb25EaWdlc3RzLnB1c2goZGlnZXN0KVxuICAgIH1cblxuICAgIHJldHVybiBlbnRyaWVzQnlJZFxuICB9XG5cbiAgLyoqXG4gICAqIENvcGllcyBtZXRhZGF0YSBpbnRvIGEgZGV0YWNoZWQgcGVyc2lzdGVuY2UgY2FuZGlkYXRlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZVN0YXRlfSBzdGF0ZSBTdGF0ZSB0byBjb3B5LlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlU3RhdGV9IERldGFjaGVkIHN0YXRlLlxuICAgKi9cbiAgY29weVN0YXRlKHN0YXRlKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGFzc2V0czogc3RhdGUuYXNzZXRzLm1hcCgoZW50cnkpID0+ICh7XG4gICAgICAgIC4uLmVudHJ5LFxuICAgICAgICBkZXNjcmlwdG9yOiB7Li4uZW50cnkuZGVzY3JpcHRvcn0sXG4gICAgICAgIHNjb3BlS2V5czogWy4uLmVudHJ5LnNjb3BlS2V5c11cbiAgICAgIH0pKSxcbiAgICAgIHBlbmRpbmdEZWxldGlvbkRpZ2VzdHM6IFsuLi5zdGF0ZS5wZW5kaW5nRGVsZXRpb25EaWdlc3RzXSxcbiAgICAgIHZlcnNpb246IHN0YXRlLnZlcnNpb25cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogU2VyaWFsaXplcyBvbmUgbWV0YWRhdGEgcGVyc2lzdGVuY2Ugb3BlcmF0aW9uIGFmdGVyIHByaW9yIGZhaWx1cmVzIG9yIHN1Y2Nlc3Nlcy5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPHZvaWQ+fSBwZXJzaXN0IFBlcnNpc3RlbmNlIG9wZXJhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIGFmdGVyIHBlcnNpc3RlbmNlLlxuICAgKi9cbiAgYXN5bmMgc2VyaWFsaXplU3RhdGVQZXJzaXN0ZW5jZShwZXJzaXN0KSB7XG4gICAgdGhpcy5zYXZlU3RhdGVQcm9taXNlID0gdGhpcy5zYXZlU3RhdGVQcm9taXNlLnRoZW4ocGVyc2lzdCwgcGVyc2lzdClcblxuICAgIGF3YWl0IHRoaXMuc2F2ZVN0YXRlUHJvbWlzZVxuICB9XG5cbiAgLyoqXG4gICAqIEVuc3VyZXMgb25lIGRlc2NyaXB0b3IgaGFzIHZlcmlmaWVkIGxvY2FsIGJ5dGVzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZUVudHJ5fSBlbnRyeSBEZXNjcmlwdG9yIHN0YXRlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7ZXJyb3I6IEVycm9yIHwgbnVsbCwgdXJpOiBzdHJpbmcgfCBudWxsfT59IENhY2hlIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGVuc3VyZUNhY2hlZChlbnRyeSkge1xuICAgIGNvbnN0IGRpZ2VzdCA9IGVudHJ5LmRlc2NyaXB0b3IuZGlnZXN0XG5cbiAgICBhd2FpdCB0aGlzLmJlZ2luQWN0aXZlRGlnZXN0KGRpZ2VzdClcblxuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5lbnN1cmVDYWNoZWRXaGlsZUFjdGl2ZShbZW50cnldKVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCB0aGlzLmZpbmlzaEFjdGl2ZURpZ2VzdChkaWdlc3QpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIG9yIGRvd25sb2FkcyBkZXNjcmlwdG9ycyBzaGFyaW5nIG9uZSBwcm90ZWN0ZWQgZGlnZXN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZUVudHJ5W119IGVudHJpZXMgRGVzY3JpcHRvciBzdGF0ZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHtlcnJvcjogRXJyb3IgfCBudWxsLCB1cmk6IHN0cmluZyB8IG51bGx9Pn0gQ2FjaGUgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgZW5zdXJlQ2FjaGVkV2hpbGVBY3RpdmUoZW50cmllcykge1xuICAgIGNvbnN0IGVudHJ5ID0gZW50cmllc1swXVxuXG4gICAgaWYgKCFlbnRyeSkgdGhyb3cgbmV3IEVycm9yKFwiQ2Fubm90IGNhY2hlIGEgc3luY2hyb25pemVkIGFzc2V0IGRpZ2VzdCB3aXRob3V0IGRlc2NyaXB0b3IgZW50cmllc1wiKVxuXG4gICAgY29uc3QgZXhpc3RpbmdVcmkgPSBhd2FpdCB0aGlzLmNhY2hlZFVyaVdoaWxlQWN0aXZlKGVudHJ5KVxuXG4gICAgaWYgKGV4aXN0aW5nVXJpKSB7XG4gICAgICBhd2FpdCB0aGlzLnJlY29yZENhY2hlZEVudHJpZXMoZW50cmllcylcblxuICAgICAgcmV0dXJuIHtlcnJvcjogbnVsbCwgdXJpOiBleGlzdGluZ1VyaX1cbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGRpZ2VzdEVudHJ5IG9mIGVudHJpZXMpIGRpZ2VzdEVudHJ5LnN0YXR1cyA9IFwiZG93bmxvYWRpbmdcIlxuXG4gICAgY29uc3QgZGlnZXN0ID0gZW50cnkuZGVzY3JpcHRvci5kaWdlc3RcbiAgICBsZXQgZG93bmxvYWRQcm9taXNlID0gdGhpcy5kb3dubG9hZFByb21pc2VzLmdldChkaWdlc3QpXG4gICAgbGV0IG93bnNEb3dubG9hZFByb21pc2UgPSBmYWxzZVxuXG4gICAgaWYgKCFkb3dubG9hZFByb21pc2UpIHtcbiAgICAgIGRvd25sb2FkUHJvbWlzZSA9IHRoaXMuZG93bmxvYWRBZnRlclBlcnNpc3RpbmdTdGF0ZShlbnRyeS5kZXNjcmlwdG9yKVxuICAgICAgdGhpcy5kb3dubG9hZFByb21pc2VzLnNldChkaWdlc3QsIGRvd25sb2FkUHJvbWlzZSlcbiAgICAgIG93bnNEb3dubG9hZFByb21pc2UgPSB0cnVlXG4gICAgfSBlbHNlIHtcbiAgICAgIGF3YWl0IHRoaXMuc2F2ZVN0YXRlKClcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgY2FjaGVSZXN1bHQgPSBhd2FpdCBkb3dubG9hZFByb21pc2VcblxuICAgICAgaWYgKGNhY2hlUmVzdWx0LmVycm9yKSB7XG4gICAgICAgIGlmIChlbnRyeS5zdGF0dXMgPT09IFwiZG93bmxvYWRpbmdcIikgYXdhaXQgdGhpcy5yZWNvcmREb3dubG9hZEZhaWx1cmUoZGlnZXN0KVxuXG4gICAgICAgIHJldHVybiBjYWNoZVJlc3VsdFxuICAgICAgfVxuXG4gICAgICBhd2FpdCB0aGlzLnJlY29yZENhY2hlZEVudHJpZXMoZW50cmllcylcblxuICAgICAgcmV0dXJuIGNhY2hlUmVzdWx0XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGlmIChvd25zRG93bmxvYWRQcm9taXNlICYmIHRoaXMuZG93bmxvYWRQcm9taXNlcy5nZXQoZGlnZXN0KSA9PT0gZG93bmxvYWRQcm9taXNlKSB7XG4gICAgICAgIHRoaXMuZG93bmxvYWRQcm9taXNlcy5kZWxldGUoZGlnZXN0KVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmRzIG9uZSBjYWNoZWQgZGlnZXN0IHJlc3VsdCBmb3IgZXZlcnkgcGFydGljaXBhdGluZyBkZXNjcmlwdG9yLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZUVudHJ5W119IGVudHJpZXMgRGVzY3JpcHRvciBzdGF0ZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyBhZnRlciBwZXJzaXN0ZW5jZS5cbiAgICovXG4gIGFzeW5jIHJlY29yZENhY2hlZEVudHJpZXMoZW50cmllcykge1xuICAgIGNvbnN0IGxhc3RBY2Nlc3NlZEF0ID0gdGhpcy5ub3dNaWxsaXNlY29uZHMoKVxuXG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiBlbnRyaWVzKSB7XG4gICAgICBlbnRyeS5hdHRlbXB0cyA9IDBcbiAgICAgIGVudHJ5Lmxhc3RBY2Nlc3NlZEF0ID0gbGFzdEFjY2Vzc2VkQXRcbiAgICAgIGVudHJ5Lm5leHRSZXRyeUF0ID0gbnVsbFxuICAgICAgZW50cnkuc3RhdHVzID0gXCJjYWNoZWRcIlxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuc2F2ZVN0YXRlKClcbiAgfVxuXG4gIC8qKlxuICAgKiBQZXJzaXN0cyBkb3dubG9hZCBpbnRlbnQsIHRoZW4gZG93bmxvYWRzIG9uZSBkaWdlc3QgYW5kIHJlY29yZHMgYSBzaGFyZWQgZmFpbHVyZSBvbmNlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZURlc2NyaXB0b3J9IGRlc2NyaXB0b3IgQXNzZXQgZGVzY3JpcHRvci5cbiAgICogQHJldHVybnMge1Byb21pc2U8e2Vycm9yOiBFcnJvciwgdXJpOiBudWxsfSB8IHtlcnJvcjogbnVsbCwgdXJpOiBzdHJpbmd9Pn0gU2hhcmVkIGNhY2hlIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGRvd25sb2FkQWZ0ZXJQZXJzaXN0aW5nU3RhdGUoZGVzY3JpcHRvcikge1xuICAgIGF3YWl0IHRoaXMuc2F2ZVN0YXRlKClcblxuICAgIHRyeSB7XG4gICAgICByZXR1cm4ge2Vycm9yOiBudWxsLCB1cmk6IGF3YWl0IHRoaXMuZG93bmxvYWRWZXJpZmllZChkZXNjcmlwdG9yKX1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc3QgZmFpbHVyZSA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKVxuXG4gICAgICBhd2FpdCB0aGlzLnJlY29yZERvd25sb2FkRmFpbHVyZShkZXNjcmlwdG9yLmRpZ2VzdClcblxuICAgICAgcmV0dXJuIHtlcnJvcjogZmFpbHVyZSwgdXJpOiBudWxsfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBBZHZhbmNlcyByZXRyeSBtZXRhZGF0YSBmb3IgZXZlcnkgbGl2ZSBkZXNjcmlwdG9yIHNoYXJpbmcgb25lIGZhaWxlZCBkaWdlc3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBkaWdlc3QgQ29udGVudCBkaWdlc3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyBhZnRlciBwZXJzaXN0ZW5jZS5cbiAgICovXG4gIGFzeW5jIHJlY29yZERvd25sb2FkRmFpbHVyZShkaWdlc3QpIHtcbiAgICBpZiAoIXRoaXMuc3RhdGUpIHRocm93IG5ldyBFcnJvcihcIkNhbm5vdCByZWNvcmQgc3luY2hyb25pemVkIGFzc2V0IGRvd25sb2FkIGZhaWx1cmUgYmVmb3JlIGxvYWRpbmcgc3RhdGVcIilcblxuICAgIGNvbnN0IGZhaWxlZEF0ID0gdGhpcy5ub3dNaWxsaXNlY29uZHMoKVxuXG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiB0aGlzLnN0YXRlLmFzc2V0cykge1xuICAgICAgaWYgKGVudHJ5LmRlc2NyaXB0b3IuZGlnZXN0ICE9PSBkaWdlc3QpIGNvbnRpbnVlXG4gICAgICBpZiAoZW50cnkuc3RhdHVzICE9PSBcImRvd25sb2FkaW5nXCIpIGNvbnRpbnVlXG5cbiAgICAgIGVudHJ5LmF0dGVtcHRzICs9IDFcbiAgICAgIGVudHJ5Lm5leHRSZXRyeUF0ID0gZmFpbGVkQXQgKyB0aGlzLnJldHJ5RGVsYXkoZW50cnkuYXR0ZW1wdHMpXG4gICAgICBlbnRyeS5zdGF0dXMgPSBcImZhaWxlZFwiXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5zYXZlU3RhdGUoKVxuICB9XG5cbiAgLyoqXG4gICAqIERvd25sb2FkcywgdmVyaWZpZXMsIGFuZCBhdG9taWNhbGx5IHBlcnNpc3RzIG9uZSBjb250ZW50IGRpZ2VzdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVEZXNjcmlwdG9yfSBkZXNjcmlwdG9yIEFzc2V0IGRlc2NyaXB0b3IuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IEFkYXB0ZXIgVVJJLlxuICAgKi9cbiAgYXN5bmMgZG93bmxvYWRWZXJpZmllZChkZXNjcmlwdG9yKSB7XG4gICAgY29uc3QgZG93bmxvYWRlZEJ5dGVzID0gYXdhaXQgdGhpcy5kb3dubG9hZChkZXNjcmlwdG9yKVxuXG4gICAgaWYgKCEoZG93bmxvYWRlZEJ5dGVzIGluc3RhbmNlb2YgVWludDhBcnJheSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgU3luY2hyb25pemVkIGFzc2V0ICR7ZGVzY3JpcHRvci5pZH0gZG93bmxvYWQgZGlkIG5vdCByZXR1cm4gVWludDhBcnJheSBieXRlc2ApXG4gICAgfVxuICAgIGlmIChkb3dubG9hZGVkQnl0ZXMuYnl0ZUxlbmd0aCAhPT0gZGVzY3JpcHRvci5ieXRlU2l6ZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBTeW5jaHJvbml6ZWQgYXNzZXQgJHtkZXNjcmlwdG9yLmlkfSBieXRlIHNpemUgZGlkIG5vdCBtYXRjaCBpdHMgZGVzY3JpcHRvcmApXG4gICAgfVxuXG4gICAgY29uc3QgZGlnZXN0ID0gYHNoYTI1Ni0ke3NoYTI1NkJ5dGVzSGV4KGRvd25sb2FkZWRCeXRlcyl9YFxuXG4gICAgaWYgKGRpZ2VzdCAhPT0gZGVzY3JpcHRvci5kaWdlc3QpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgU3luY2hyb25pemVkIGFzc2V0ICR7ZGVzY3JpcHRvci5pZH0gZGlnZXN0IGRpZCBub3QgbWF0Y2ggaXRzIGRlc2NyaXB0b3JgKVxuICAgIH1cblxuICAgIGNvbnN0IHVyaSA9IGF3YWl0IHRoaXMuYWRhcHRlci53cml0ZUJsb2Ioe1xuICAgICAgYWNjb3VudElkOiB0aGlzLmFjY291bnRJZCxcbiAgICAgIGJ5dGVzOiBkb3dubG9hZGVkQnl0ZXMsXG4gICAgICBjb250ZW50VHlwZTogZGVzY3JpcHRvci5jb250ZW50VHlwZSxcbiAgICAgIGRpZ2VzdFxuICAgIH0pXG5cbiAgICBpZiAoIXVyaSkgdGhyb3cgbmV3IEVycm9yKGBTeW5jaHJvbml6ZWQgYXNzZXQgYWRhcHRlciByZXR1cm5lZCBubyBVUkkgZm9yICR7ZGVzY3JpcHRvci5pZH1gKVxuXG4gICAgcmV0dXJuIHVyaVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGFuIGV4aXN0aW5nIGxvY2FsIFVSSSBhZnRlciB3YWl0aW5nIGZvciBkZWxldGlvbiB3b3JrLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZUVudHJ5fSBlbnRyeSBEZXNjcmlwdG9yIHN0YXRlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmcgfCBudWxsPn0gRXhpc3RpbmcgVVJJLlxuICAgKi9cbiAgYXN5bmMgY2FjaGVkVXJpKGVudHJ5KSB7XG4gICAgY29uc3QgZGlnZXN0ID0gZW50cnkuZGVzY3JpcHRvci5kaWdlc3RcblxuICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICBhd2FpdCB0aGlzLmJlZ2luQWN0aXZlRGlnZXN0KGRpZ2VzdClcbiAgICAgIGxldCBkZWZlcnJlZENsZWFudXBSYW5cbiAgICAgIGxldCB1cmlcblxuICAgICAgdHJ5IHtcbiAgICAgICAgdXJpID0gYXdhaXQgdGhpcy5jYWNoZWRVcmlXaGlsZUFjdGl2ZShlbnRyeSlcbiAgICAgIH0gZmluYWxseSB7XG4gICAgICAgIGRlZmVycmVkQ2xlYW51cFJhbiA9IGF3YWl0IHRoaXMuZmluaXNoQWN0aXZlRGlnZXN0KGRpZ2VzdClcbiAgICAgIH1cblxuICAgICAgaWYgKCFkZWZlcnJlZENsZWFudXBSYW4pIHJldHVybiB1cmlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYW4gZXhpc3RpbmcgbG9jYWwgVVJJIHdoaWxlIGl0cyBkaWdlc3QgaXMgcHJvdGVjdGVkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZUVudHJ5fSBlbnRyeSBEZXNjcmlwdG9yIHN0YXRlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmcgfCBudWxsPn0gRXhpc3RpbmcgVVJJLlxuICAgKi9cbiAgYXN5bmMgY2FjaGVkVXJpV2hpbGVBY3RpdmUoZW50cnkpIHtcbiAgICBjb25zdCB1cmkgPSBhd2FpdCB0aGlzLmFkYXB0ZXIuYmxvYlVyaSh7XG4gICAgICBhY2NvdW50SWQ6IHRoaXMuYWNjb3VudElkLFxuICAgICAgZGlnZXN0OiBlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdFxuICAgIH0pXG5cbiAgICBpZiAoIXVyaSAmJiBlbnRyeS5zdGF0dXMgPT09IFwiY2FjaGVkXCIpIGVudHJ5LnN0YXR1cyA9IFwibWlzc2luZ1wiXG5cbiAgICByZXR1cm4gdXJpXG4gIH1cblxuICAvKipcbiAgICogV2FpdHMgZm9yIGRlbGV0aW9uIGFuZCBwcm90ZWN0cyBhIGRpZ2VzdCBmb3Igb25lIGFjdGl2ZSBjYWNoZSBvcGVyYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBkaWdlc3QgQ29udGVudCBkaWdlc3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyBhZnRlciBwcm90ZWN0aW9uIGlzIHJlZ2lzdGVyZWQuXG4gICAqL1xuICBhc3luYyBiZWdpbkFjdGl2ZURpZ2VzdChkaWdlc3QpIHtcbiAgICBsZXQgZGVsZXRpb25Qcm9taXNlID0gdGhpcy5kZWxldGlvblByb21pc2VzLmdldChkaWdlc3QpXG5cbiAgICB3aGlsZSAoZGVsZXRpb25Qcm9taXNlKSB7XG4gICAgICBhd2FpdCBkZWxldGlvblByb21pc2VcbiAgICAgIGRlbGV0aW9uUHJvbWlzZSA9IHRoaXMuZGVsZXRpb25Qcm9taXNlcy5nZXQoZGlnZXN0KVxuICAgIH1cblxuICAgIGNvbnN0IGFjdGl2ZUNvdW50ID0gdGhpcy5hY3RpdmVEaWdlc3RDb3VudHMuZ2V0KGRpZ2VzdCkgPz8gMFxuXG4gICAgdGhpcy5hY3RpdmVEaWdlc3RDb3VudHMuc2V0KGRpZ2VzdCwgYWN0aXZlQ291bnQgKyAxKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlbGVhc2VzIG9uZSBjYWNoZSBvcGVyYXRpb24gYW5kIHByb2Nlc3NlcyBkZWZlcnJlZCBkZWxldGlvbiBhZnRlciB0aGUgbGFzdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGRpZ2VzdCBDb250ZW50IGRpZ2VzdC5cbiAgICogQHBhcmFtIHtTZXQ8c3RyaW5nPn0gW3Byb3RlY3RlZENsZWFudXBEaWdlc3RzXSBEaWdlc3RzIG5lZWRlZCBieSB0aGUgcmVzb2x2aW5nIGNhbGxlci5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IFdoZXRoZXIgZGVmZXJyZWQgY2xlYW51cCByYW4gYWZ0ZXIgdGhlIGZpbmFsIHJlbGVhc2UuXG4gICAqL1xuICBhc3luYyBmaW5pc2hBY3RpdmVEaWdlc3QoZGlnZXN0LCBwcm90ZWN0ZWRDbGVhbnVwRGlnZXN0cyA9IG5ldyBTZXQoKSkge1xuICAgIGNvbnN0IGFjdGl2ZUNvdW50ID0gdGhpcy5hY3RpdmVEaWdlc3RDb3VudHMuZ2V0KGRpZ2VzdClcblxuICAgIGlmIChhY3RpdmVDb3VudCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE1pc3NpbmcgYWN0aXZlIHN5bmNocm9uaXplZCBhc3NldCBkaWdlc3QgY291bnQgZm9yICR7ZGlnZXN0fWApXG4gICAgfVxuXG4gICAgaWYgKGFjdGl2ZUNvdW50ID4gMSkge1xuICAgICAgdGhpcy5hY3RpdmVEaWdlc3RDb3VudHMuc2V0KGRpZ2VzdCwgYWN0aXZlQ291bnQgLSAxKVxuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfVxuXG4gICAgdGhpcy5hY3RpdmVEaWdlc3RDb3VudHMuZGVsZXRlKGRpZ2VzdClcbiAgICBhd2FpdCB0aGlzLmRlbGV0ZVBlbmRpbmdEaWdlc3RJZlVucmVmZXJlbmNlZChkaWdlc3QpXG4gICAgY29uc3QgZGVmZXJyZWRDbGVhbnVwUmVxdWlyZWQgPSB0aGlzLmNsZWFudXBSZXF1aXJlZEFmdGVyUmVsZWFzZURpZ2VzdHMuZGVsZXRlKGRpZ2VzdClcblxuICAgIGlmIChkZWZlcnJlZENsZWFudXBSZXF1aXJlZCkgYXdhaXQgdGhpcy5jbGVhbnVwKHByb3RlY3RlZENsZWFudXBEaWdlc3RzKVxuXG4gICAgcmV0dXJuIGRlZmVycmVkQ2xlYW51cFJlcXVpcmVkXG4gIH1cblxuICAvKipcbiAgICogUmVsZWFzZXMgZXZlcnkgYWNxdWlyZWQgZGlnZXN0IGJlZm9yZSBwcm9wYWdhdGluZyBmaW5hbGl6YXRpb24gZmFpbHVyZXMuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGRpZ2VzdHMgQ29udGVudCBkaWdlc3RzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgYWZ0ZXIgZXZlcnkgZGlnZXN0IGlzIHJlbGVhc2VkLlxuICAgKi9cbiAgYXN5bmMgZmluaXNoQWN0aXZlRGlnZXN0cyhkaWdlc3RzKSB7XG4gICAgLyoqIEB0eXBlIHtFcnJvcltdfSAqL1xuICAgIGNvbnN0IGZhaWx1cmVzID0gW11cblxuICAgIGZvciAoY29uc3QgZGlnZXN0IG9mIGRpZ2VzdHMpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMuZmluaXNoQWN0aXZlRGlnZXN0KGRpZ2VzdClcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGZhaWx1cmVzLnB1c2goZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpKVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChmYWlsdXJlcy5sZW5ndGggPT09IDEpIHRocm93IGZhaWx1cmVzWzBdXG4gICAgaWYgKGZhaWx1cmVzLmxlbmd0aCA+IDEpIHtcbiAgICAgIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihmYWlsdXJlcywgXCJNdWx0aXBsZSBzeW5jaHJvbml6ZWQgYXNzZXQgZGlnZXN0IGZpbmFsaXplcnMgZmFpbGVkXCIsIHtjYXVzZTogZmFpbHVyZXNbMF19KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBEZWxldGVzIGJsb2JzIHRoYXQgbG9zdCB0aGVpciBmaW5hbCBkZXNjcmlwdG9yIHJlZmVyZW5jZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIGFmdGVyIGRlbGV0aW9uLlxuICAgKi9cbiAgYXN5bmMgZGVsZXRlVW5yZWZlcmVuY2VkRGlnZXN0cygpIHtcbiAgICBpZiAoIXRoaXMuc3RhdGUpIHRocm93IG5ldyBFcnJvcihcIkNhbm5vdCBkZWxldGUgc3luY2hyb25pemVkIGFzc2V0IGJsb2JzIGJlZm9yZSBsb2FkaW5nIHN0YXRlXCIpXG5cbiAgICBmb3IgKGNvbnN0IGRpZ2VzdCBvZiBbLi4udGhpcy5zdGF0ZS5wZW5kaW5nRGVsZXRpb25EaWdlc3RzXSkge1xuICAgICAgYXdhaXQgdGhpcy5kZWxldGVQZW5kaW5nRGlnZXN0SWZVbnJlZmVyZW5jZWQoZGlnZXN0KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBEZWxldGVzIG9uZSBwZXJzaXN0ZWQgcGVuZGluZyBkaWdlc3Qgd2hlbiBubyBkZXNjcmlwdG9yIG9yIGFjdGl2ZSBvcGVyYXRpb24gb3ducyBpdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGRpZ2VzdCBDb250ZW50IGRpZ2VzdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIGFmdGVyIGFueSByZXF1aXJlZCBkZWxldGlvbi5cbiAgICovXG4gIGFzeW5jIGRlbGV0ZVBlbmRpbmdEaWdlc3RJZlVucmVmZXJlbmNlZChkaWdlc3QpIHtcbiAgICBpZiAoIXRoaXMuc3RhdGUpIHRocm93IG5ldyBFcnJvcihcIkNhbm5vdCBkZWxldGUgc3luY2hyb25pemVkIGFzc2V0IGJsb2JzIGJlZm9yZSBsb2FkaW5nIHN0YXRlXCIpXG4gICAgaWYgKCF0aGlzLnN0YXRlLnBlbmRpbmdEZWxldGlvbkRpZ2VzdHMuaW5jbHVkZXMoZGlnZXN0KSkgcmV0dXJuXG5cbiAgICBhd2FpdCB0aGlzLmRlbGV0ZURpZ2VzdElmSW5hY3RpdmUoZGlnZXN0LCBhc3luYyAoKSA9PiB7XG4gICAgICBpZiAoIXRoaXMuc3RhdGUpIHRocm93IG5ldyBFcnJvcihcIkNhbm5vdCBkZWxldGUgc3luY2hyb25pemVkIGFzc2V0IGJsb2JzIGJlZm9yZSBsb2FkaW5nIHN0YXRlXCIpXG4gICAgICBpZiAoIXRoaXMuc3RhdGUucGVuZGluZ0RlbGV0aW9uRGlnZXN0cy5pbmNsdWRlcyhkaWdlc3QpKSByZXR1cm4gZmFsc2VcblxuICAgICAgbGV0IGRlbGV0ZWQgPSBmYWxzZVxuXG4gICAgICBpZiAoIXRoaXMuc3RhdGUuYXNzZXRzLnNvbWUoKGVudHJ5KSA9PiBlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdCA9PT0gZGlnZXN0KSkge1xuICAgICAgICBhd2FpdCB0aGlzLmFkYXB0ZXIuZGVsZXRlQmxvYih7YWNjb3VudElkOiB0aGlzLmFjY291bnRJZCwgZGlnZXN0fSlcbiAgICAgICAgZGVsZXRlZCA9IHRydWVcbiAgICAgIH1cblxuICAgICAgY29uc3QgcGVuZGluZ0RlbGV0aW9uRGlnZXN0cyA9IHRoaXMuc3RhdGUucGVuZGluZ0RlbGV0aW9uRGlnZXN0c1xuXG4gICAgICB0aGlzLnN0YXRlLnBlbmRpbmdEZWxldGlvbkRpZ2VzdHMgPSBwZW5kaW5nRGVsZXRpb25EaWdlc3RzLmZpbHRlcigoY2FuZGlkYXRlKSA9PiBjYW5kaWRhdGUgIT09IGRpZ2VzdClcblxuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5zYXZlU3RhdGUoKVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgaWYgKCF0aGlzLnN0YXRlLnBlbmRpbmdEZWxldGlvbkRpZ2VzdHMuaW5jbHVkZXMoZGlnZXN0KSkgdGhpcy5zdGF0ZS5wZW5kaW5nRGVsZXRpb25EaWdlc3RzLnB1c2goZGlnZXN0KVxuICAgICAgICB0aHJvdyBlcnJvclxuICAgICAgfVxuXG4gICAgICByZXR1cm4gZGVsZXRlZFxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBvbmUgZGVsZXRpb24gb25seSBhZnRlciBlYXJsaWVyIGRlbGV0aW9uIHdvcmsgYW5kIHdoZW4gbm8gY2FjaGUgb3BlcmF0aW9uIG93bnMgdGhlIGRpZ2VzdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGRpZ2VzdCBDb250ZW50IGRpZ2VzdC5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPGJvb2xlYW4+fSBjYWxsYmFjayBQcm90ZWN0ZWQgZGVsZXRpb24gY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSBXaGV0aGVyIHRoZSBjYWxsYmFjayBkZWxldGVkIHRoZSBibG9iLlxuICAgKi9cbiAgYXN5bmMgZGVsZXRlRGlnZXN0SWZJbmFjdGl2ZShkaWdlc3QsIGNhbGxiYWNrKSB7XG4gICAgbGV0IGFjdGl2ZURlbGV0aW9uUHJvbWlzZSA9IHRoaXMuZGVsZXRpb25Qcm9taXNlcy5nZXQoZGlnZXN0KVxuXG4gICAgd2hpbGUgKGFjdGl2ZURlbGV0aW9uUHJvbWlzZSkge1xuICAgICAgYXdhaXQgYWN0aXZlRGVsZXRpb25Qcm9taXNlXG4gICAgICBhY3RpdmVEZWxldGlvblByb21pc2UgPSB0aGlzLmRlbGV0aW9uUHJvbWlzZXMuZ2V0KGRpZ2VzdClcbiAgICB9XG5cbiAgICBpZiAodGhpcy5hY3RpdmVEaWdlc3RDb3VudHMuaGFzKGRpZ2VzdCkpIHJldHVybiBmYWxzZVxuXG4gICAgLyoqXG4gICAgICogUmVsZWFzZXMgY2FsbGVycyB3YWl0aW5nIGZvciBkZWxldGlvbiBjb21wbGV0aW9uLlxuICAgICAqIEB0eXBlIHsoKSA9PiB2b2lkfVxuICAgICAqL1xuICAgIGxldCByZWxlYXNlRGVsZXRpb24gPSAoKSA9PiB7fVxuICAgIC8qKlxuICAgICAqIEJsb2NrcyBuZXcgZGlnZXN0IGFjdGl2aXR5IHVudGlsIGRlbGV0aW9uIGNvbXBsZXRlcy5cbiAgICAgKiBAdHlwZSB7UHJvbWlzZTx2b2lkPn1cbiAgICAgKi9cbiAgICBjb25zdCBkZWxldGlvblByb21pc2UgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgICAgcmVsZWFzZURlbGV0aW9uID0gKCkgPT4gcmVzb2x2ZSh1bmRlZmluZWQpXG4gICAgfSlcblxuICAgIHRoaXMuZGVsZXRpb25Qcm9taXNlcy5zZXQoZGlnZXN0LCBkZWxldGlvblByb21pc2UpXG5cbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKClcbiAgICB9IGZpbmFsbHkge1xuICAgICAgaWYgKHRoaXMuZGVsZXRpb25Qcm9taXNlcy5nZXQoZGlnZXN0KSA9PT0gZGVsZXRpb25Qcm9taXNlKSB0aGlzLmRlbGV0aW9uUHJvbWlzZXMuZGVsZXRlKGRpZ2VzdClcbiAgICAgIHJlbGVhc2VEZWxldGlvbigpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEZpbmRzIHJlcXVpcmVkIGFzc2V0cyB3aXRob3V0IGxvY2FsbHkgY2FjaGVkIGJ5dGVzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2NvcGVLZXkgU3luY2hyb25pemVkIHNjb3BlIHRvIGluc3BlY3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZ1tdPn0gTWlzc2luZyByZXF1aXJlZCBkZXNjcmlwdG9yIGlkcy5cbiAgICovXG4gIGFzeW5jIG1pc3NpbmdSZXF1aXJlZEFzc2V0SWRzKHNjb3BlS2V5KSB7XG4gICAgY29uc3Qgc3RhdGUgPSBhd2FpdCB0aGlzLmxvYWRTdGF0ZSgpXG4gICAgLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgICBjb25zdCBtaXNzaW5nQXNzZXRJZHMgPSBbXVxuXG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiBzdGF0ZS5hc3NldHMpIHtcbiAgICAgIGlmICghZW50cnkuc2NvcGVLZXlzLmluY2x1ZGVzKHNjb3BlS2V5KSkgY29udGludWVcbiAgICAgIGlmIChlbnRyeS5kZXNjcmlwdG9yLm9mZmxpbmVSZXF1aXJlbWVudCAhPT0gXCJyZXF1aXJlZFwiKSBjb250aW51ZVxuICAgICAgaWYgKGF3YWl0IHRoaXMuY2FjaGVkVXJpKGVudHJ5KSkgY29udGludWVcblxuICAgICAgbWlzc2luZ0Fzc2V0SWRzLnB1c2goZW50cnkuZGVzY3JpcHRvci5pZClcbiAgICB9XG5cbiAgICByZXR1cm4gbWlzc2luZ0Fzc2V0SWRzXG4gIH1cblxuICAvKipcbiAgICogQ2hlY2tzIHdoZXRoZXIgYSBmYWlsZWQgb3IgbWlzc2luZyBlbnRyeSBtYXkgYmUgZG93bmxvYWRlZCBub3cuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlRW50cnl9IGVudHJ5IERlc2NyaXB0b3Igc3RhdGUuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSBXaGV0aGVyIHRoZSByZXRyeSBkZWFkbGluZSBoYXMgcGFzc2VkLlxuICAgKi9cbiAgcmV0cnlFbGlnaWJsZShlbnRyeSkge1xuICAgIHJldHVybiBlbnRyeS5zdGF0dXMgIT09IFwiZmFpbGVkXCIgfHwgZW50cnkubmV4dFJldHJ5QXQgPT09IG51bGwgfHwgZW50cnkubmV4dFJldHJ5QXQgPD0gdGhpcy5ub3dNaWxsaXNlY29uZHMoKVxuICB9XG5cbiAgLyoqXG4gICAqIENhbGN1bGF0ZXMgYm91bmRlZCBleHBvbmVudGlhbCByZXRyeSBkZWxheS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGF0dGVtcHRzIENvbnNlY3V0aXZlIGZhaWx1cmVzLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSBSZXRyeSBkZWxheS5cbiAgICovXG4gIHJldHJ5RGVsYXkoYXR0ZW1wdHMpIHtcbiAgICByZXR1cm4gTWF0aC5taW4odGhpcy5yZXRyeU1heERlbGF5TXMsIHRoaXMucmV0cnlCYXNlRGVsYXlNcyAqICgyICoqIE1hdGgubWF4KDAsIGF0dGVtcHRzIC0gMSkpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWRzIHRoZSBpbmplY3RhYmxlIHdhbGwgY2xvY2suXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IEN1cnJlbnQgZXBvY2ggbWlsbGlzZWNvbmRzLlxuICAgKi9cbiAgbm93TWlsbGlzZWNvbmRzKCkge1xuICAgIHJldHVybiB0aGlzLm5vdygpLmdldFRpbWUoKVxuICB9XG59XG4iXX0=