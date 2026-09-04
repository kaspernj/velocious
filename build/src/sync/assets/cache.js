// @ts-check
import sha256BytesHex from "../../utils/sha256-bytes-hex.js";
/**
 * @typedef {{
 *   byteSize: number,
 *   contentType: string | null,
 *   promise: Promise<{error: Error, uri: null} | {error: null, uri: string}>
 * }} SynchronizedAssetDownloadFlight */
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
        /** @type {Map<string, SynchronizedAssetDownloadFlight>} */
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
            const downloadFlight = this.downloadPromises.get(asset.digest);
            if (knownDescriptor && knownDescriptor.digest !== asset.digest) {
                throw new Error(`Synchronized asset descriptor ${asset.id} changed its immutable digest`);
            }
            if (knownDescriptor && knownDescriptor.byteSize !== asset.byteSize) {
                throw new Error(`Synchronized asset descriptor ${asset.id} changed its immutable byte size`);
            }
            if (knownDescriptor && knownDescriptor.contentType !== asset.contentType) {
                throw new Error(`Synchronized asset descriptor ${asset.id} changed its immutable content type`);
            }
            if (downloadFlight && downloadFlight.byteSize !== asset.byteSize) {
                throw new Error(`Synchronized asset digest ${asset.digest} has inconsistent byte sizes`);
            }
            if (downloadFlight && downloadFlight.contentType !== asset.contentType) {
                throw new Error(`Synchronized asset digest ${asset.digest} has inconsistent content types`);
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
        const digest = entry.descriptor.digest;
        let downloadFlight = this.downloadPromises.get(digest);
        let ownsDownloadPromise = false;
        if (downloadFlight) {
            for (const digestEntry of entries) {
                if (downloadFlight.byteSize !== digestEntry.descriptor.byteSize) {
                    throw new Error(`Synchronized asset digest ${digest} has inconsistent byte sizes`);
                }
                if (downloadFlight.contentType !== digestEntry.descriptor.contentType) {
                    throw new Error(`Synchronized asset digest ${digest} has inconsistent content types`);
                }
            }
        }
        for (const digestEntry of entries)
            digestEntry.status = "downloading";
        if (!downloadFlight) {
            downloadFlight = {
                byteSize: entry.descriptor.byteSize,
                contentType: entry.descriptor.contentType,
                promise: this.downloadAfterPersistingState(entry.descriptor)
            };
            this.downloadPromises.set(digest, downloadFlight);
            ownsDownloadPromise = true;
        }
        else {
            await this.saveState();
        }
        try {
            const cacheResult = await downloadFlight.promise;
            if (cacheResult.error) {
                if (entry.status === "downloading")
                    await this.recordDownloadFailure(digest);
                return cacheResult;
            }
            await this.recordCachedEntries(entries);
            return cacheResult;
        }
        finally {
            if (ownsDownloadPromise && this.downloadPromises.get(digest) === downloadFlight) {
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
            let revalidationRequired;
            let uri;
            try {
                uri = await this.cachedUriWhileActive(entry);
            }
            finally {
                revalidationRequired = await this.finishActiveDigest(digest);
            }
            if (!revalidationRequired)
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
     * @returns {Promise<boolean>} Whether finalization requires URI revalidation.
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
        const pendingDigestDeleted = await this.deletePendingDigestIfUnreferenced(digest);
        const deferredCleanupRequired = this.cleanupRequiredAfterReleaseDigests.delete(digest);
        if (deferredCleanupRequired)
            await this.cleanup(protectedCleanupDigests);
        return pendingDigestDeleted || deferredCleanupRequired;
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
     * @returns {Promise<boolean>} Whether the blob was deleted.
     */
    async deletePendingDigestIfUnreferenced(digest) {
        if (!this.state)
            throw new Error("Cannot delete synchronized asset blobs before loading state");
        if (!this.state.pendingDeletionDigests.includes(digest))
            return false;
        return await this.deleteDigestIfInactive(digest, async () => {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2FjaGUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvc3luYy9hc3NldHMvY2FjaGUuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sY0FBYyxNQUFNLGlDQUFpQyxDQUFBO0FBRTVEOzs7Ozt3Q0FLd0M7QUFFeEMsTUFBTSxtQkFBbUIsR0FBRyxDQUFDLENBQUE7QUFDN0IsTUFBTSwyQkFBMkIsR0FBRyxJQUFJLENBQUE7QUFDeEMsTUFBTSwwQkFBMEIsR0FBRyxJQUFJLEdBQUcsRUFBRSxHQUFHLENBQUMsQ0FBQTtBQUVoRDs7O0dBR0c7QUFDSCxNQUFNLENBQUMsT0FBTyxPQUFPLHNCQUFzQjtJQUN6Qzs7Ozs7Ozs7OztPQVVHO0lBQ0gsWUFBWSxFQUFDLFNBQVMsRUFBRSxPQUFPLEVBQUUsUUFBUSxFQUFFLFFBQVEsRUFBRSxHQUFHLEdBQUcsR0FBRyxFQUFFLENBQUMsSUFBSSxJQUFJLEVBQUUsRUFBRSxnQkFBZ0IsR0FBRywyQkFBMkIsRUFBRSxlQUFlLEdBQUcsMEJBQTBCLEVBQUM7UUFDeEssSUFBSSxDQUFDLFNBQVM7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLGlEQUFpRCxDQUFDLENBQUE7UUFDbEYsSUFBSSxDQUFDLE1BQU0sQ0FBQyxhQUFhLENBQUMsUUFBUSxDQUFDLElBQUksUUFBUSxHQUFHLENBQUM7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLHVFQUF1RSxDQUFDLENBQUE7UUFDN0ksSUFBSSxDQUFDLE1BQU0sQ0FBQyxhQUFhLENBQUMsZ0JBQWdCLENBQUMsSUFBSSxnQkFBZ0IsR0FBRyxDQUFDO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQywyRUFBMkUsQ0FBQyxDQUFBO1FBQ2pLLElBQUksQ0FBQyxNQUFNLENBQUMsYUFBYSxDQUFDLGVBQWUsQ0FBQyxJQUFJLGVBQWUsR0FBRyxnQkFBZ0I7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLDRFQUE0RSxDQUFDLENB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LHVCQUF1QjtRQUN2QixNQUFNLGVBQWUsR0FBRyxFQUFFLENBQUE7UUFFMUIsS0FBSyxNQUFNLEtBQUssSUFBSSxLQUFLLENBQUMsTUFBTSxFQUFFLENBQUM7WUFDakMsSUFBSSxDQUFDLEtBQUssQ0FBQyxTQUFTLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQztnQkFBRSxTQUFRO1lBQ2pELElBQUksS0FBSyxDQUFDLFVBQVUsQ0FBQyxrQkFBa0IsS0FBSyxVQUFVO2dCQUFFLFNBQVE7WUFDaEUsSUFBSSxNQUFNLElBQUksQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDO2dCQUFFLFNBQVE7WUFFekMsZUFBZSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDLEVBQUUsQ0FBQyxDQUFBO1FBQzNDLENBQUM7UUFFRCxPQUFPLGVBQWUsQ0FBQTtJQUN4QixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILGFBQWEsQ0FBQyxLQUFLO1FBQ2pCLE9BQU8sS0FBSyxDQUFDLE1BQU0sS0FBSyxRQUFRLElBQUksS0FBSyxDQUFDLFdBQVcsS0FBSyxJQUFJLElBQUksS0FBSyxDQUFDLFdBQVcsSUFBSSxJQUFJLENBQUMsZUFBZSxFQUFFLENBQUE7SUFDL0csQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxVQUFVLENBQUMsUUFBUTtRQUNqQixPQUFPLElBQUksQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLGVBQWUsRUFBRSxJQUFJLENBQUMsZ0JBQWdCLEdBQUcsQ0FBQyxDQUFDLElBQUksSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsUUFBUSxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQTtJQUNqRyxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsZUFBZTtRQUNiLE9BQU8sSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDLE9BQU8sRUFBRSxDQUFBO0lBQzdCLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgc2hhMjU2Qnl0ZXNIZXggZnJvbSBcIi4uLy4uL3V0aWxzL3NoYTI1Ni1ieXRlcy1oZXguanNcIlxuXG4vKipcbiAqIEB0eXBlZGVmIHt7XG4gKiAgIGJ5dGVTaXplOiBudW1iZXIsXG4gKiAgIGNvbnRlbnRUeXBlOiBzdHJpbmcgfCBudWxsLFxuICogICBwcm9taXNlOiBQcm9taXNlPHtlcnJvcjogRXJyb3IsIHVyaTogbnVsbH0gfCB7ZXJyb3I6IG51bGwsIHVyaTogc3RyaW5nfT5cbiAqIH19IFN5bmNocm9uaXplZEFzc2V0RG93bmxvYWRGbGlnaHQgKi9cblxuY29uc3QgQ0FDSEVfU1RBVEVfVkVSU0lPTiA9IDFcbmNvbnN0IERFRkFVTFRfUkVUUllfQkFTRV9ERUxBWV9NUyA9IDEwMDBcbmNvbnN0IERFRkFVTFRfUkVUUllfTUFYX0RFTEFZX01TID0gMTAwMCAqIDYwICogNVxuXG4vKipcbiAqIENvcmUgc3luY2hyb25pemVkIGFzc2V0IGNhY2hlLiBQbGF0Zm9ybSBwYWNrYWdlcyBvd24gYnl0ZSBhbmQgbWV0YWRhdGFcbiAqIHBlcnNpc3RlbmNlIHdoaWxlIHRoaXMgY2xhc3Mgb3ducyBwb2xpY3ksIGludGVncml0eSwgYW5kIGxpZmVjeWNsZS5cbiAqL1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgU3luY2hyb25pemVkQXNzZXRDYWNoZSB7XG4gIC8qKlxuICAgKiBDcmVhdGVzIGEgc3luY2hyb25pemVkIGFzc2V0IGNhY2hlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyBPcHRpb25zLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5hY2NvdW50SWQgQXV0aGVudGljYXRlZCBhY2NvdW50IG5hbWVzcGFjZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVBZGFwdGVyfSBhcmdzLmFkYXB0ZXIgUGxhdGZvcm0gc3RvcmFnZSBhZGFwdGVyLlxuICAgKiBAcGFyYW0geyhkZXNjcmlwdG9yOiBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVEZXNjcmlwdG9yKSA9PiBQcm9taXNlPFVpbnQ4QXJyYXk+fSBhcmdzLmRvd25sb2FkIEF1dGhlbnRpY2F0ZWQgYnl0ZSBkb3dubG9hZGVyLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5tYXhCeXRlcyBNYXhpbXVtIGV2aWN0YWJsZSBjYWNoZSBzaXplLlxuICAgKiBAcGFyYW0geygpID0+IERhdGV9IFthcmdzLm5vd10gQ2xvY2suXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5yZXRyeUJhc2VEZWxheU1zXSBJbml0aWFsIHJldHJ5IGRlbGF5LlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MucmV0cnlNYXhEZWxheU1zXSBNYXhpbXVtIHJldHJ5IGRlbGF5LlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2FjY291bnRJZCwgYWRhcHRlciwgZG93bmxvYWQsIG1heEJ5dGVzLCBub3cgPSAoKSA9PiBuZXcgRGF0ZSgpLCByZXRyeUJhc2VEZWxheU1zID0gREVGQVVMVF9SRVRSWV9CQVNFX0RFTEFZX01TLCByZXRyeU1heERlbGF5TXMgPSBERUZBVUxUX1JFVFJZX01BWF9ERUxBWV9NU30pIHtcbiAgICBpZiAoIWFjY291bnRJZCkgdGhyb3cgbmV3IEVycm9yKFwiU3luY2hyb25pemVkIGFzc2V0IGNhY2hlIHJlcXVpcmVzIGFuIGFjY291bnQgaWRcIilcbiAgICBpZiAoIU51bWJlci5pc1NhZmVJbnRlZ2VyKG1heEJ5dGVzKSB8fCBtYXhCeXRlcyA8IDApIHRocm93IG5ldyBFcnJvcihcIlN5bmNocm9uaXplZCBhc3NldCBjYWNoZSBtYXhCeXRlcyBtdXN0IGJlIGEgbm9uLW5lZ2F0aXZlIHNhZmUgaW50ZWdlclwiKVxuICAgIGlmICghTnVtYmVyLmlzU2FmZUludGVnZXIocmV0cnlCYXNlRGVsYXlNcykgfHwgcmV0cnlCYXNlRGVsYXlNcyA8IDEpIHRocm93IG5ldyBFcnJvcihcIlN5bmNocm9uaXplZCBhc3NldCBjYWNoZSByZXRyeUJhc2VEZWxheU1zIG11c3QgYmUgYSBwb3NpdGl2ZSBzYWZlIGludGVnZXJcIilcbiAgICBpZiAoIU51bWJlci5pc1NhZmVJbnRlZ2VyKHJldHJ5TWF4RGVsYXlNcykgfHwgcmV0cnlNYXhEZWxheU1zIDwgcmV0cnlCYXNlRGVsYXlNcykgdGhyb3cgbmV3IEVycm9yKFwiU3luY2hyb25pemVkIGFzc2V0IGNhY2hlIHJldHJ5TWF4RGVsYXlNcyBtdXN0IGJlIGF0IGxlYXN0IHJldHJ5QmFzZURlbGF5TXNcIilcblxuICAgIHRoaXMuYWNjb3VudElkID0gYWNjb3VudElkXG4gICAgdGhpcy5hZGFwdGVyID0gYWRhcHRlclxuICAgIHRoaXMuZG93bmxvYWQgPSBkb3dubG9hZFxuICAgIHRoaXMubWF4Qnl0ZXMgPSBtYXhCeXRlc1xuICAgIHRoaXMubm93ID0gbm93XG4gICAgdGhpcy5yZXRyeUJhc2VEZWxheU1zID0gcmV0cnlCYXNlRGVsYXlNc1xuICAgIHRoaXMucmV0cnlNYXhEZWxheU1zID0gcmV0cnlNYXhEZWxheU1zXG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBudW1iZXI+fSAqL1xuICAgIHRoaXMuYWN0aXZlRGlnZXN0Q291bnRzID0gbmV3IE1hcCgpXG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBQcm9taXNlPHZvaWQ+Pn0gKi9cbiAgICB0aGlzLmRlbGV0aW9uUHJvbWlzZXMgPSBuZXcgTWFwKClcbiAgICAvKiogQHR5cGUge1NldDxzdHJpbmc+fSAqL1xuICAgIHRoaXMuY2xlYW51cFJlcXVpcmVkQWZ0ZXJSZWxlYXNlRGlnZXN0cyA9IG5ldyBTZXQoKVxuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTxudW1iZXI+fSAqL1xuICAgIHRoaXMuY2xlYW51cFByb21pc2UgPSBQcm9taXNlLnJlc29sdmUoMClcbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIFN5bmNocm9uaXplZEFzc2V0RG93bmxvYWRGbGlnaHQ+fSAqL1xuICAgIHRoaXMuZG93bmxvYWRQcm9taXNlcyA9IG5ldyBNYXAoKVxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlU3RhdGUgfCBudWxsfSAqL1xuICAgIHRoaXMuc3RhdGUgPSBudWxsXG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZVN0YXRlPiB8IG51bGx9ICovXG4gICAgdGhpcy5zdGF0ZVByb21pc2UgPSBudWxsXG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+fSAqL1xuICAgIHRoaXMuc2F2ZVN0YXRlUHJvbWlzZSA9IFByb21pc2UucmVzb2x2ZSgpXG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZVN5bmNocm9uaXphdGlvblJlc3VsdD4+fSAqL1xuICAgIHRoaXMuc3luY2hyb25pemVQcm9taXNlcyA9IG5ldyBNYXAoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlY29uY2lsZXMgdGhlIGltbXV0YWJsZSBkZXNjcmlwdG9ycyBmb3Igb25lIHN5bmNocm9uaXplZCBzY29wZSBhbmRcbiAgICogZG93bmxvYWRzIGVsaWdpYmxlIGVhZ2VyIGFzc2V0cy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgUmVjb25jaWxpYXRpb24gaW5wdXRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZURlc2NyaXB0b3JbXX0gYXJncy5kZXNjcmlwdG9ycyBDdXJyZW50IGRlc2NyaXB0b3JzIGluIHRoZSBzY29wZS5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLm9ubGluZSBXaGV0aGVyIGF1dGhlbnRpY2F0ZWQgZG93bmxvYWRzIGFyZSBhdmFpbGFibGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnNjb3BlS2V5IFN0YWJsZSBzeW5jaHJvbml6ZWQgc2NvcGUga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVTeW5jaHJvbml6YXRpb25SZXN1bHQ+fSBTeW5jaHJvbml6YXRpb24gcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgc3luY2hyb25pemUoe2Rlc2NyaXB0b3JzLCBvbmxpbmUsIHNjb3BlS2V5fSkge1xuICAgIGNvbnN0IHN5bmNocm9uaXplID0gYXN5bmMgKCkgPT4gYXdhaXQgdGhpcy5zeW5jaHJvbml6ZVNjb3BlKHtkZXNjcmlwdG9ycywgb25saW5lLCBzY29wZUtleX0pXG4gICAgY29uc3QgcHJldmlvdXNTeW5jaHJvbml6YXRpb25Qcm9taXNlID0gdGhpcy5zeW5jaHJvbml6ZVByb21pc2VzLmdldChzY29wZUtleSlcbiAgICBjb25zdCBzeW5jaHJvbml6YXRpb25Qcm9taXNlID0gcHJldmlvdXNTeW5jaHJvbml6YXRpb25Qcm9taXNlXG4gICAgICA/IHByZXZpb3VzU3luY2hyb25pemF0aW9uUHJvbWlzZS50aGVuKHN5bmNocm9uaXplLCBzeW5jaHJvbml6ZSlcbiAgICAgIDogc3luY2hyb25pemUoKVxuXG4gICAgdGhpcy5zeW5jaHJvbml6ZVByb21pc2VzLnNldChzY29wZUtleSwgc3luY2hyb25pemF0aW9uUHJvbWlzZSlcblxuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgc3luY2hyb25pemF0aW9uUHJvbWlzZVxuICAgIH0gZmluYWxseSB7XG4gICAgICBpZiAodGhpcy5zeW5jaHJvbml6ZVByb21pc2VzLmdldChzY29wZUtleSkgPT09IHN5bmNocm9uaXphdGlvblByb21pc2UpIHtcbiAgICAgICAgdGhpcy5zeW5jaHJvbml6ZVByb21pc2VzLmRlbGV0ZShzY29wZUtleSlcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBvbmUgc2NvcGUgc3luY2hyb25pemF0aW9uIGFmdGVyIHByaW9yIGNhbGxzIGZvciB0aGF0IHNjb3BlIGZpbmlzaC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgUmVjb25jaWxpYXRpb24gaW5wdXRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZURlc2NyaXB0b3JbXX0gYXJncy5kZXNjcmlwdG9ycyBDdXJyZW50IGRlc2NyaXB0b3JzIGluIHRoZSBzY29wZS5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLm9ubGluZSBXaGV0aGVyIGF1dGhlbnRpY2F0ZWQgZG93bmxvYWRzIGFyZSBhdmFpbGFibGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnNjb3BlS2V5IFN0YWJsZSBzeW5jaHJvbml6ZWQgc2NvcGUga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVTeW5jaHJvbml6YXRpb25SZXN1bHQ+fSBTeW5jaHJvbml6YXRpb24gcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgc3luY2hyb25pemVTY29wZSh7ZGVzY3JpcHRvcnMsIG9ubGluZSwgc2NvcGVLZXl9KSB7XG4gICAgYXdhaXQgdGhpcy5sb2FkU3RhdGUoKVxuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlRGVzY3JpcHRvcltdPn0gKi9cbiAgICBjb25zdCBkZXNjcmlwdG9yc0J5RGlnZXN0ID0gbmV3IE1hcCgpXG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVGYWlsdXJlW119ICovXG4gICAgY29uc3QgZmFpbHVyZXMgPSBbXVxuICAgIC8qKiBAdHlwZSB7U2V0PHN0cmluZz59ICovXG4gICAgY29uc3QgYWN0aXZlRGlnZXN0cyA9IG5ldyBTZXQoKVxuXG4gICAgZm9yIChjb25zdCBkZXNjcmlwdG9yIG9mIGRlc2NyaXB0b3JzKSB7XG4gICAgICBjb25zdCBkaWdlc3REZXNjcmlwdG9ycyA9IGRlc2NyaXB0b3JzQnlEaWdlc3QuZ2V0KGRlc2NyaXB0b3IuZGlnZXN0KSB8fCBbXVxuXG4gICAgICBkaWdlc3REZXNjcmlwdG9ycy5wdXNoKGRlc2NyaXB0b3IpXG4gICAgICBkZXNjcmlwdG9yc0J5RGlnZXN0LnNldChkZXNjcmlwdG9yLmRpZ2VzdCwgZGlnZXN0RGVzY3JpcHRvcnMpXG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGZvciAoY29uc3QgZGlnZXN0IG9mIGRlc2NyaXB0b3JzQnlEaWdlc3Qua2V5cygpKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuYmVnaW5BY3RpdmVEaWdlc3QoZGlnZXN0KVxuICAgICAgICBhY3RpdmVEaWdlc3RzLmFkZChkaWdlc3QpXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGVudHJpZXNCeUlkID0gYXdhaXQgdGhpcy5yZWNvbmNpbGVEZXNjcmlwdG9ycyh7ZGVzY3JpcHRvcnMsIHNjb3BlS2V5fSlcblxuICAgICAgYXdhaXQgdGhpcy5kZWxldGVVbnJlZmVyZW5jZWREaWdlc3RzKClcblxuICAgICAgZm9yIChjb25zdCBbZGlnZXN0LCBkaWdlc3REZXNjcmlwdG9yc10gb2YgZGVzY3JpcHRvcnNCeURpZ2VzdCkge1xuICAgICAgICBjb25zdCBlYWdlckRlc2NyaXB0b3JzID0gb25saW5lID8gZGlnZXN0RGVzY3JpcHRvcnMuZmlsdGVyKChkZXNjcmlwdG9yKSA9PiBkZXNjcmlwdG9yLmZldGNoID09PSBcImVhZ2VyXCIpIDogW11cblxuICAgICAgICBpZiAoZWFnZXJEZXNjcmlwdG9ycy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICBhY3RpdmVEaWdlc3RzLmRlbGV0ZShkaWdlc3QpXG4gICAgICAgICAgYXdhaXQgdGhpcy5maW5pc2hBY3RpdmVEaWdlc3QoZGlnZXN0KVxuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH1cblxuICAgICAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZUVudHJ5W119ICovXG4gICAgICAgIGNvbnN0IGVhZ2VyRW50cmllcyA9IFtdXG5cbiAgICAgICAgZm9yIChjb25zdCBkZXNjcmlwdG9yIG9mIGVhZ2VyRGVzY3JpcHRvcnMpIHtcbiAgICAgICAgICBjb25zdCBlbnRyeSA9IGVudHJpZXNCeUlkLmdldChkZXNjcmlwdG9yLmlkKVxuXG4gICAgICAgICAgaWYgKCFlbnRyeSkgdGhyb3cgbmV3IEVycm9yKGBNaXNzaW5nIHJlY29uY2lsZWQgc3luY2hyb25pemVkIGFzc2V0IGRlc2NyaXB0b3IgJHtkZXNjcmlwdG9yLmlkfWApXG5cbiAgICAgICAgICBlYWdlckVudHJpZXMucHVzaChlbnRyeSlcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChlYWdlckVudHJpZXMuc29tZSgoZW50cnkpID0+IHRoaXMucmV0cnlFbGlnaWJsZShlbnRyeSkpKSB7XG4gICAgICAgICAgY29uc3QgY2FjaGVSZXN1bHQgPSBhd2FpdCB0aGlzLmVuc3VyZUNhY2hlZFdoaWxlQWN0aXZlKGVhZ2VyRW50cmllcylcblxuICAgICAgICAgIGlmIChjYWNoZVJlc3VsdC5lcnJvcikge1xuICAgICAgICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiBlYWdlckVudHJpZXMpIHtcbiAgICAgICAgICAgICAgZmFpbHVyZXMucHVzaCh7YXNzZXRJZDogZW50cnkuZGVzY3JpcHRvci5pZCwgZXJyb3I6IGNhY2hlUmVzdWx0LmVycm9yfSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBhY3RpdmVEaWdlc3RzLmRlbGV0ZShkaWdlc3QpXG4gICAgICAgIGF3YWl0IHRoaXMuZmluaXNoQWN0aXZlRGlnZXN0KGRpZ2VzdClcbiAgICAgICAgYXdhaXQgdGhpcy5jbGVhbnVwKClcbiAgICAgIH1cbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgdGhpcy5maW5pc2hBY3RpdmVEaWdlc3RzKFsuLi5hY3RpdmVEaWdlc3RzXSlcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLmNsZWFudXAoKVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGZhaWx1cmVzLFxuICAgICAgbWlzc2luZ1JlcXVpcmVkQXNzZXRJZHM6IGF3YWl0IHRoaXMubWlzc2luZ1JlcXVpcmVkQXNzZXRJZHMoc2NvcGVLZXkpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGEgY2FjaGVkIGFzc2V0IFVSSSwgZG93bmxvYWRpbmcgaXQgb24gZGVtYW5kIHdoZW4gYWxsb3dlZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgUmVzb2x1dGlvbiBpbnB1dHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmFzc2V0SWQgQXR0YWNobWVudCBkZXNjcmlwdG9yIGlkLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3Mub25saW5lIFdoZXRoZXIgYXV0aGVudGljYXRlZCBkb3dubG9hZHMgYXJlIGF2YWlsYWJsZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nIHwgbnVsbD59IENhY2hlZCBhc3NldCBVUkkuXG4gICAqL1xuICBhc3luYyByZXNvbHZlKHthc3NldElkLCBvbmxpbmV9KSB7XG4gICAgY29uc3Qgc3RhdGUgPSBhd2FpdCB0aGlzLmxvYWRTdGF0ZSgpXG4gICAgY29uc3QgZW50cnkgPSBzdGF0ZS5hc3NldHMuZmluZCgoY2FuZGlkYXRlKSA9PiBjYW5kaWRhdGUuZGVzY3JpcHRvci5pZCA9PT0gYXNzZXRJZClcblxuICAgIGlmICghZW50cnkpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCBkaWdlc3QgPSBlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdFxuICAgIGxldCByZXNvbHZlZFVyaSA9IG51bGxcbiAgICBsZXQgc2hvdWxkQ2xlYW51cCA9IGZhbHNlXG5cbiAgICBhd2FpdCB0aGlzLmJlZ2luQWN0aXZlRGlnZXN0KGRpZ2VzdClcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBjYWNoZWRVcmkgPSBhd2FpdCB0aGlzLmNhY2hlZFVyaVdoaWxlQWN0aXZlKGVudHJ5KVxuXG4gICAgICBpZiAoY2FjaGVkVXJpKSB7XG4gICAgICAgIGVudHJ5Lmxhc3RBY2Nlc3NlZEF0ID0gdGhpcy5ub3dNaWxsaXNlY29uZHMoKVxuICAgICAgICBlbnRyeS5zdGF0dXMgPSBcImNhY2hlZFwiXG4gICAgICAgIGF3YWl0IHRoaXMuc2F2ZVN0YXRlKClcblxuICAgICAgICByZXNvbHZlZFVyaSA9IGNhY2hlZFVyaVxuICAgICAgfSBlbHNlIGlmIChvbmxpbmUgJiYgdGhpcy5yZXRyeUVsaWdpYmxlKGVudHJ5KSkge1xuICAgICAgICBjb25zdCBjYWNoZVJlc3VsdCA9IGF3YWl0IHRoaXMuZW5zdXJlQ2FjaGVkV2hpbGVBY3RpdmUoW2VudHJ5XSlcblxuICAgICAgICBpZiAoY2FjaGVSZXN1bHQuZXJyb3IpIHRocm93IGNhY2hlUmVzdWx0LmVycm9yXG5cbiAgICAgICAgaWYgKGNhY2hlUmVzdWx0LnVyaSkge1xuICAgICAgICAgIHJlc29sdmVkVXJpID0gY2FjaGVSZXN1bHQudXJpXG4gICAgICAgICAgc2hvdWxkQ2xlYW51cCA9IHRydWVcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCB0aGlzLmZpbmlzaEFjdGl2ZURpZ2VzdChkaWdlc3QsIHNob3VsZENsZWFudXAgPyBuZXcgU2V0KFtkaWdlc3RdKSA6IG5ldyBTZXQoKSlcbiAgICB9XG5cbiAgICBpZiAoc2hvdWxkQ2xlYW51cCkgYXdhaXQgdGhpcy5jbGVhbnVwKG5ldyBTZXQoW2RpZ2VzdF0pKVxuICAgIGNvbnN0IHJlcXVpcmVzVW5wcm90ZWN0ZWRDbGVhbnVwID0gc2hvdWxkQ2xlYW51cCB8fCAoZW50cnkuZGVzY3JpcHRvci5ieXRlU2l6ZSA+IHRoaXMubWF4Qnl0ZXMgJiYgIXN0YXRlLmFzc2V0cy5zb21lKChjYW5kaWRhdGUpID0+IHtcbiAgICAgIHJldHVybiBjYW5kaWRhdGUuZGVzY3JpcHRvci5kaWdlc3QgPT09IGRpZ2VzdCAmJiBjYW5kaWRhdGUuZGVzY3JpcHRvci5yZXRlbnRpb24gPT09IFwiZHVyYWJsZVwiXG4gICAgfSkpXG5cbiAgICBpZiAocmVxdWlyZXNVbnByb3RlY3RlZENsZWFudXApIGF3YWl0IHRoaXMuY2xlYW51cCgpXG4gICAgaWYgKCFyZXNvbHZlZFVyaSkgcmV0dXJuIG51bGxcbiAgICBjb25zdCByZXNvbHZlZEVudHJ5ID0gc3RhdGUuYXNzZXRzLmZpbmQoKGNhbmRpZGF0ZSkgPT4gY2FuZGlkYXRlLmRlc2NyaXB0b3IuaWQgPT09IGFzc2V0SWQgJiYgY2FuZGlkYXRlLmRlc2NyaXB0b3IuZGlnZXN0ID09PSBkaWdlc3QpXG5cbiAgICBpZiAoIXJlc29sdmVkRW50cnkpIHJldHVybiBudWxsXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5jYWNoZWRVcmkocmVzb2x2ZWRFbnRyeSlcbiAgfVxuXG4gIC8qKlxuICAgKiBFdmljdHMgbGVhc3QtcmVjZW50bHktdXNlZCBibG9icyB1bnRpbCB0aGUgdW5pcXVlIGNhY2hlZCBieXRlIHRvdGFsIGlzXG4gICAqIHdpdGhpbiB0aGUgY29uZmlndXJlZCBidWRnZXQuIEEgYmxvYiBzdGF5cyBkdXJhYmxlIHdoZW4gYW55IGxpdmVcbiAgICogZGVzY3JpcHRvciByZWZlcmVuY2UgZGVjbGFyZXMgZHVyYWJsZSByZXRlbnRpb24uXG4gICAqIEBwYXJhbSB7U2V0PHN0cmluZz59IFtwcm90ZWN0ZWREaWdlc3RzXSBEaWdlc3RzIG5lZWRlZCBieSB0aGUgYWN0aXZlIGNhbGxlci5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gQnl0ZXMgcmVtb3ZlZC5cbiAgICovXG4gIGFzeW5jIGNsZWFudXAocHJvdGVjdGVkRGlnZXN0cyA9IG5ldyBTZXQoKSkge1xuICAgIGNvbnN0IGNsZWFudXAgPSBhc3luYyAoKSA9PiBhd2FpdCB0aGlzLnBlcmZvcm1DbGVhbnVwKHByb3RlY3RlZERpZ2VzdHMpXG4gICAgY29uc3QgY2xlYW51cFByb21pc2UgPSB0aGlzLmNsZWFudXBQcm9taXNlLnRoZW4oY2xlYW51cCwgY2xlYW51cClcblxuICAgIHRoaXMuY2xlYW51cFByb21pc2UgPSBjbGVhbnVwUHJvbWlzZVxuXG4gICAgcmV0dXJuIGF3YWl0IGNsZWFudXBQcm9taXNlXG4gIH1cblxuICAvKipcbiAgICogUGVyZm9ybXMgb25lIHNlcmlhbGl6ZWQgZXZpY3Rpb24gcGFzcy5cbiAgICogQHBhcmFtIHtTZXQ8c3RyaW5nPn0gcHJvdGVjdGVkRGlnZXN0cyBEaWdlc3RzIG5lZWRlZCBieSB0aGUgYWN0aXZlIGNhbGxlci5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gQnl0ZXMgcmVtb3ZlZC5cbiAgICovXG4gIGFzeW5jIHBlcmZvcm1DbGVhbnVwKHByb3RlY3RlZERpZ2VzdHMpIHtcbiAgICBjb25zdCBzdGF0ZSA9IGF3YWl0IHRoaXMubG9hZFN0YXRlKClcbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIGltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZUVudHJ5W10+fSAqL1xuICAgIGNvbnN0IGVudHJpZXNCeURpZ2VzdCA9IG5ldyBNYXAoKVxuXG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiBzdGF0ZS5hc3NldHMpIHtcbiAgICAgIGNvbnN0IGRpZ2VzdEVudHJpZXMgPSBlbnRyaWVzQnlEaWdlc3QuZ2V0KGVudHJ5LmRlc2NyaXB0b3IuZGlnZXN0KSB8fCBbXVxuXG4gICAgICBkaWdlc3RFbnRyaWVzLnB1c2goZW50cnkpXG4gICAgICBlbnRyaWVzQnlEaWdlc3Quc2V0KGVudHJ5LmRlc2NyaXB0b3IuZGlnZXN0LCBkaWdlc3RFbnRyaWVzKVxuICAgIH1cblxuICAgIC8qKiBAdHlwZSB7e2J5dGVTaXplOiBudW1iZXIsIGRpZ2VzdDogc3RyaW5nLCBsYXN0QWNjZXNzZWRBdDogbnVtYmVyfVtdfSAqL1xuICAgIGNvbnN0IGNhY2hlZEJsb2JzID0gW11cbiAgICBsZXQgY2FjaGVkQnl0ZXMgPSAwXG5cbiAgICBmb3IgKGNvbnN0IFtkaWdlc3QsIHJlZmVyZW5jZXNdIG9mIGVudHJpZXNCeURpZ2VzdCkge1xuICAgICAgY29uc3QgdXJpID0gYXdhaXQgdGhpcy5hZGFwdGVyLmJsb2JVcmkoe2FjY291bnRJZDogdGhpcy5hY2NvdW50SWQsIGRpZ2VzdH0pXG5cbiAgICAgIGlmICghdXJpKSB7XG4gICAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgcmVmZXJlbmNlcykge1xuICAgICAgICAgIGlmIChlbnRyeS5zdGF0dXMgPT09IFwiY2FjaGVkXCIpIGVudHJ5LnN0YXR1cyA9IFwibWlzc2luZ1wiXG4gICAgICAgIH1cbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgY29uc3QgYnl0ZVNpemUgPSByZWZlcmVuY2VzWzBdLmRlc2NyaXB0b3IuYnl0ZVNpemVcblxuICAgICAgY2FjaGVkQnl0ZXMgKz0gYnl0ZVNpemVcbiAgICAgIGNhY2hlZEJsb2JzLnB1c2goe1xuICAgICAgICBieXRlU2l6ZSxcbiAgICAgICAgZGlnZXN0LFxuICAgICAgICBsYXN0QWNjZXNzZWRBdDogTWF0aC5tYXgoLi4ucmVmZXJlbmNlcy5tYXAoKGVudHJ5KSA9PiBlbnRyeS5sYXN0QWNjZXNzZWRBdCkpXG4gICAgICB9KVxuICAgIH1cblxuICAgIGxldCByZW1vdmVkQnl0ZXMgPSAwXG5cbiAgICB3aGlsZSAoY2FjaGVkQmxvYnMubGVuZ3RoID4gMCkge1xuICAgICAgaWYgKGNhY2hlZEJ5dGVzIDw9IHRoaXMubWF4Qnl0ZXMpIGJyZWFrXG5cbiAgICAgIGZvciAoY29uc3QgY2FjaGVkQmxvYiBvZiBjYWNoZWRCbG9icykge1xuICAgICAgICBjb25zdCBjdXJyZW50UmVmZXJlbmNlcyA9IHN0YXRlLmFzc2V0cy5maWx0ZXIoKGVudHJ5KSA9PiBlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdCA9PT0gY2FjaGVkQmxvYi5kaWdlc3QpXG5cbiAgICAgICAgaWYgKGN1cnJlbnRSZWZlcmVuY2VzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICBjYWNoZWRCbG9iLmxhc3RBY2Nlc3NlZEF0ID0gTWF0aC5tYXgoLi4uY3VycmVudFJlZmVyZW5jZXMubWFwKChlbnRyeSkgPT4gZW50cnkubGFzdEFjY2Vzc2VkQXQpKVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGNhY2hlZEJsb2JzLnNvcnQoKGxlZnQsIHJpZ2h0KSA9PiBsZWZ0Lmxhc3RBY2Nlc3NlZEF0IC0gcmlnaHQubGFzdEFjY2Vzc2VkQXQgfHwgbGVmdC5kaWdlc3QubG9jYWxlQ29tcGFyZShyaWdodC5kaWdlc3QpKVxuXG4gICAgICBjb25zdCBibG9iID0gY2FjaGVkQmxvYnMuc2hpZnQoKVxuXG4gICAgICBpZiAoIWJsb2IpIHRocm93IG5ldyBFcnJvcihcIkV4cGVjdGVkIGEgc3luY2hyb25pemVkIGFzc2V0IGNhY2hlIGV2aWN0aW9uIGNhbmRpZGF0ZVwiKVxuICAgICAgaWYgKHByb3RlY3RlZERpZ2VzdHMuaGFzKGJsb2IuZGlnZXN0KSkgY29udGludWVcbiAgICAgIGxldCBibG9iV2FzQWxyZWFkeU1pc3NpbmcgPSBmYWxzZVxuICAgICAgbGV0IGRlbGV0aW9uQ2hlY2tlZCA9IGZhbHNlXG4gICAgICBjb25zdCBkZWxldGVkID0gYXdhaXQgdGhpcy5kZWxldGVEaWdlc3RJZkluYWN0aXZlKGJsb2IuZGlnZXN0LCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGRlbGV0aW9uQ2hlY2tlZCA9IHRydWVcblxuICAgICAgICBpZiAoIXRoaXMuc3RhdGUpIHRocm93IG5ldyBFcnJvcihcIkNhbm5vdCBjbGVhbiBzeW5jaHJvbml6ZWQgYXNzZXQgYmxvYnMgYmVmb3JlIGxvYWRpbmcgc3RhdGVcIilcblxuICAgICAgICBjb25zdCBjdXJyZW50VXJpID0gYXdhaXQgdGhpcy5hZGFwdGVyLmJsb2JVcmkoe2FjY291bnRJZDogdGhpcy5hY2NvdW50SWQsIGRpZ2VzdDogYmxvYi5kaWdlc3R9KVxuICAgICAgICBjb25zdCBjdXJyZW50UmVmZXJlbmNlcyA9IHRoaXMuc3RhdGUuYXNzZXRzLmZpbHRlcigoZW50cnkpID0+IGVudHJ5LmRlc2NyaXB0b3IuZGlnZXN0ID09PSBibG9iLmRpZ2VzdClcblxuICAgICAgICBpZiAoIWN1cnJlbnRVcmkpIHtcbiAgICAgICAgICBibG9iV2FzQWxyZWFkeU1pc3NpbmcgPSB0cnVlXG5cbiAgICAgICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGN1cnJlbnRSZWZlcmVuY2VzKSB7XG4gICAgICAgICAgICBpZiAoZW50cnkuc3RhdHVzID09PSBcImNhY2hlZFwiKSBlbnRyeS5zdGF0dXMgPSBcIm1pc3NpbmdcIlxuICAgICAgICAgIH1cblxuICAgICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgICB9XG4gICAgICAgIGlmIChjdXJyZW50UmVmZXJlbmNlcy5zb21lKChlbnRyeSkgPT4gZW50cnkuZGVzY3JpcHRvci5yZXRlbnRpb24gPT09IFwiZHVyYWJsZVwiKSkgcmV0dXJuIGZhbHNlXG5cbiAgICAgICAgYXdhaXQgdGhpcy5hZGFwdGVyLmRlbGV0ZUJsb2Ioe2FjY291bnRJZDogdGhpcy5hY2NvdW50SWQsIGRpZ2VzdDogYmxvYi5kaWdlc3R9KVxuXG4gICAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgY3VycmVudFJlZmVyZW5jZXMpIHtcbiAgICAgICAgICBlbnRyeS5hdHRlbXB0cyA9IDBcbiAgICAgICAgICBlbnRyeS5uZXh0UmV0cnlBdCA9IG51bGxcbiAgICAgICAgICBlbnRyeS5zdGF0dXMgPSBcIm1pc3NpbmdcIlxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHRydWVcbiAgICAgIH0pXG5cbiAgICAgIGlmICghZGVsZXRpb25DaGVja2VkKSB0aGlzLmNsZWFudXBSZXF1aXJlZEFmdGVyUmVsZWFzZURpZ2VzdHMuYWRkKGJsb2IuZGlnZXN0KVxuICAgICAgaWYgKGJsb2JXYXNBbHJlYWR5TWlzc2luZykgY2FjaGVkQnl0ZXMgLT0gYmxvYi5ieXRlU2l6ZVxuICAgICAgaWYgKCFkZWxldGVkKSBjb250aW51ZVxuXG4gICAgICBjYWNoZWRCeXRlcyAtPSBibG9iLmJ5dGVTaXplXG4gICAgICByZW1vdmVkQnl0ZXMgKz0gYmxvYi5ieXRlU2l6ZVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuc2F2ZVN0YXRlKClcblxuICAgIHJldHVybiByZW1vdmVkQnl0ZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBMb2FkcyBjYWNoZSBzdGF0ZSBvbmNlIGZvciB0aGlzIGNhY2hlIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVTdGF0ZT59IExvYWRlZCBzdGF0ZS5cbiAgICovXG4gIGFzeW5jIGxvYWRTdGF0ZSgpIHtcbiAgICBpZiAodGhpcy5zdGF0ZSkgcmV0dXJuIHRoaXMuc3RhdGVcbiAgICBpZiAodGhpcy5zdGF0ZVByb21pc2UpIHJldHVybiBhd2FpdCB0aGlzLnN0YXRlUHJvbWlzZVxuXG4gICAgdGhpcy5zdGF0ZVByb21pc2UgPSB0aGlzLmxvYWRTdGF0ZUZyb21BZGFwdGVyKClcblxuICAgIHRyeSB7XG4gICAgICB0aGlzLnN0YXRlID0gYXdhaXQgdGhpcy5zdGF0ZVByb21pc2VcblxuICAgICAgcmV0dXJuIHRoaXMuc3RhdGVcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdGhpcy5zdGF0ZVByb21pc2UgPSBudWxsXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIExvYWRzIGFuZCByZWNvdmVycyBwZXJzaXN0ZWQgY2FjaGUgc3RhdGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZVN0YXRlPn0gTG9hZGVkIHN0YXRlLlxuICAgKi9cbiAgYXN5bmMgbG9hZFN0YXRlRnJvbUFkYXB0ZXIoKSB7XG4gICAgY29uc3QgbG9hZGVkU3RhdGUgPSBhd2FpdCB0aGlzLmFkYXB0ZXIubG9hZFN0YXRlKHthY2NvdW50SWQ6IHRoaXMuYWNjb3VudElkfSlcblxuICAgIGlmICghbG9hZGVkU3RhdGUpIHJldHVybiB7YXNzZXRzOiBbXSwgcGVuZGluZ0RlbGV0aW9uRGlnZXN0czogW10sIHZlcnNpb246IENBQ0hFX1NUQVRFX1ZFUlNJT059XG4gICAgaWYgKGxvYWRlZFN0YXRlLnZlcnNpb24gIT09IENBQ0hFX1NUQVRFX1ZFUlNJT04pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgc3luY2hyb25pemVkIGFzc2V0IGNhY2hlIHN0YXRlIHZlcnNpb246ICR7bG9hZGVkU3RhdGUudmVyc2lvbn1gKVxuICAgIH1cblxuICAgIGxldCByZWNvdmVyZWRJbnRlcnJ1cHRlZERvd25sb2FkID0gZmFsc2VcblxuICAgIGZvciAoY29uc3QgZW50cnkgb2YgbG9hZGVkU3RhdGUuYXNzZXRzKSB7XG4gICAgICBpZiAoZW50cnkuc3RhdHVzICE9PSBcImRvd25sb2FkaW5nXCIpIGNvbnRpbnVlXG5cbiAgICAgIGVudHJ5LmF0dGVtcHRzICs9IDFcbiAgICAgIGVudHJ5Lm5leHRSZXRyeUF0ID0gdGhpcy5ub3dNaWxsaXNlY29uZHMoKVxuICAgICAgZW50cnkuc3RhdHVzID0gXCJmYWlsZWRcIlxuICAgICAgcmVjb3ZlcmVkSW50ZXJydXB0ZWREb3dubG9hZCA9IHRydWVcbiAgICB9XG5cbiAgICBpZiAocmVjb3ZlcmVkSW50ZXJydXB0ZWREb3dubG9hZCkge1xuICAgICAgYXdhaXQgdGhpcy5hZGFwdGVyLnNhdmVTdGF0ZSh7YWNjb3VudElkOiB0aGlzLmFjY291bnRJZCwgc3RhdGU6IGxvYWRlZFN0YXRlfSlcbiAgICB9XG5cbiAgICByZXR1cm4gbG9hZGVkU3RhdGVcbiAgfVxuXG4gIC8qKlxuICAgKiBQZXJzaXN0cyB0aGUgY3VycmVudCBjYWNoZSBzdGF0ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIGFmdGVyIHN0YXRlIHBlcnNpc3RlbmNlLlxuICAgKi9cbiAgYXN5bmMgc2F2ZVN0YXRlKCkge1xuICAgIGlmICghdGhpcy5zdGF0ZSkgdGhyb3cgbmV3IEVycm9yKFwiQ2Fubm90IHNhdmUgc3luY2hyb25pemVkIGFzc2V0IGNhY2hlIGJlZm9yZSBsb2FkaW5nIHN0YXRlXCIpXG5cbiAgICBjb25zdCBwZXJzaXN0ID0gYXN5bmMgKCkgPT4ge1xuICAgICAgaWYgKCF0aGlzLnN0YXRlKSB0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3Qgc2F2ZSBzeW5jaHJvbml6ZWQgYXNzZXQgY2FjaGUgYmVmb3JlIGxvYWRpbmcgc3RhdGVcIilcblxuICAgICAgYXdhaXQgdGhpcy5hZGFwdGVyLnNhdmVTdGF0ZSh7YWNjb3VudElkOiB0aGlzLmFjY291bnRJZCwgc3RhdGU6IHRoaXMuc3RhdGV9KVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuc2VyaWFsaXplU3RhdGVQZXJzaXN0ZW5jZShwZXJzaXN0KVxuICB9XG5cbiAgLyoqXG4gICAqIFBlcnNpc3RzIGEgZGV0YWNoZWQgcmVjb25jaWxpYXRpb24gYmVmb3JlIGV4cG9zaW5nIGl0IHRocm91Z2ggc2hhcmVkIHN0YXRlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyBSZWNvbmNpbGlhdGlvbiBpbnB1dHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlRGVzY3JpcHRvcltdfSBhcmdzLmRlc2NyaXB0b3JzIEN1cnJlbnQgZGVzY3JpcHRvcnMgaW4gdGhlIHNjb3BlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zY29wZUtleSBTdGFibGUgc3luY2hyb25pemVkIHNjb3BlIGtleS5cbiAgICogQHJldHVybnMge1Byb21pc2U8TWFwPHN0cmluZywgaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlRW50cnk+Pn0gUmVjb25jaWxlZCBsaXZlIGVudHJpZXMgYnkgaWQuXG4gICAqL1xuICBhc3luYyByZWNvbmNpbGVEZXNjcmlwdG9ycyh7ZGVzY3JpcHRvcnMsIHNjb3BlS2V5fSkge1xuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlRW50cnk+IHwgbnVsbH0gKi9cbiAgICBsZXQgZW50cmllc0J5SWQgPSBudWxsXG5cbiAgICBjb25zdCBwZXJzaXN0ID0gYXN5bmMgKCkgPT4ge1xuICAgICAgaWYgKCF0aGlzLnN0YXRlKSB0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3QgcmVjb25jaWxlIHN5bmNocm9uaXplZCBhc3NldCBjYWNoZSBiZWZvcmUgbG9hZGluZyBzdGF0ZVwiKVxuXG4gICAgICBjb25zdCBjYW5kaWRhdGVTdGF0ZSA9IHRoaXMuY29weVN0YXRlKHRoaXMuc3RhdGUpXG4gICAgICBjb25zdCBuZXdFbnRyeUxhc3RBY2Nlc3NlZEF0ID0gdGhpcy5ub3dNaWxsaXNlY29uZHMoKVxuXG4gICAgICB0aGlzLmFwcGx5RGVzY3JpcHRvclJlY29uY2lsaWF0aW9uKHtkZXNjcmlwdG9ycywgbmV3RW50cnlMYXN0QWNjZXNzZWRBdCwgc2NvcGVLZXksIHN0YXRlOiBjYW5kaWRhdGVTdGF0ZX0pXG4gICAgICBhd2FpdCB0aGlzLmFkYXB0ZXIuc2F2ZVN0YXRlKHthY2NvdW50SWQ6IHRoaXMuYWNjb3VudElkLCBzdGF0ZTogY2FuZGlkYXRlU3RhdGV9KVxuICAgICAgZW50cmllc0J5SWQgPSB0aGlzLmFwcGx5RGVzY3JpcHRvclJlY29uY2lsaWF0aW9uKHtkZXNjcmlwdG9ycywgbmV3RW50cnlMYXN0QWNjZXNzZWRBdCwgc2NvcGVLZXksIHN0YXRlOiB0aGlzLnN0YXRlfSlcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnNlcmlhbGl6ZVN0YXRlUGVyc2lzdGVuY2UocGVyc2lzdClcblxuICAgIGlmICghZW50cmllc0J5SWQpIHRocm93IG5ldyBFcnJvcihcIlN5bmNocm9uaXplZCBhc3NldCBkZXNjcmlwdG9yIHJlY29uY2lsaWF0aW9uIGNvbXBsZXRlZCB3aXRob3V0IGxpdmUgZW50cmllc1wiKVxuXG4gICAgcmV0dXJuIGVudHJpZXNCeUlkXG4gIH1cblxuICAvKipcbiAgICogQXBwbGllcyBvbmUgc2NvcGUncyBkZXNjcmlwdG9yIHNldCB0byBjYWNoZSBzdGF0ZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgUmVjb25jaWxpYXRpb24gaW5wdXRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZURlc2NyaXB0b3JbXX0gYXJncy5kZXNjcmlwdG9ycyBDdXJyZW50IGRlc2NyaXB0b3JzIGluIHRoZSBzY29wZS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MubmV3RW50cnlMYXN0QWNjZXNzZWRBdCBJbml0aWFsIExSVSB0aW1lc3RhbXAgZm9yIG5ldyBlbnRyaWVzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zY29wZUtleSBTdGFibGUgc3luY2hyb25pemVkIHNjb3BlIGtleS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVTdGF0ZX0gYXJncy5zdGF0ZSBTdGF0ZSB0byByZWNvbmNpbGUuXG4gICAqIEByZXR1cm5zIHtNYXA8c3RyaW5nLCBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVFbnRyeT59IExpdmUgZW50cmllcyBieSBpZC5cbiAgICovXG4gIGFwcGx5RGVzY3JpcHRvclJlY29uY2lsaWF0aW9uKHtkZXNjcmlwdG9ycywgbmV3RW50cnlMYXN0QWNjZXNzZWRBdCwgc2NvcGVLZXksIHN0YXRlfSkge1xuICAgIGNvbnN0IGluY29taW5nSWRzID0gbmV3IFNldChkZXNjcmlwdG9ycy5tYXAoKGFzc2V0KSA9PiBhc3NldC5pZCkpXG4gICAgY29uc3QgZW50cmllc0J5SWQgPSBuZXcgTWFwKHN0YXRlLmFzc2V0cy5tYXAoKGVudHJ5KSA9PiBbZW50cnkuZGVzY3JpcHRvci5pZCwgZW50cnldKSlcbiAgICBjb25zdCBkZXNjcmlwdG9yc0J5SWQgPSBuZXcgTWFwKHN0YXRlLmFzc2V0cy5tYXAoKGVudHJ5KSA9PiBbZW50cnkuZGVzY3JpcHRvci5pZCwgZW50cnkuZGVzY3JpcHRvcl0pKVxuICAgIGNvbnN0IHJlbW92ZWREaWdlc3RzID0gbmV3IFNldCgpXG5cbiAgICBmb3IgKGNvbnN0IGFzc2V0IG9mIGRlc2NyaXB0b3JzKSB7XG4gICAgICBjb25zdCBrbm93bkRlc2NyaXB0b3IgPSBkZXNjcmlwdG9yc0J5SWQuZ2V0KGFzc2V0LmlkKVxuICAgICAgY29uc3QgZG93bmxvYWRGbGlnaHQgPSB0aGlzLmRvd25sb2FkUHJvbWlzZXMuZ2V0KGFzc2V0LmRpZ2VzdClcblxuICAgICAgaWYgKGtub3duRGVzY3JpcHRvciAmJiBrbm93bkRlc2NyaXB0b3IuZGlnZXN0ICE9PSBhc3NldC5kaWdlc3QpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBTeW5jaHJvbml6ZWQgYXNzZXQgZGVzY3JpcHRvciAke2Fzc2V0LmlkfSBjaGFuZ2VkIGl0cyBpbW11dGFibGUgZGlnZXN0YClcbiAgICAgIH1cbiAgICAgIGlmIChrbm93bkRlc2NyaXB0b3IgJiYga25vd25EZXNjcmlwdG9yLmJ5dGVTaXplICE9PSBhc3NldC5ieXRlU2l6ZSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFN5bmNocm9uaXplZCBhc3NldCBkZXNjcmlwdG9yICR7YXNzZXQuaWR9IGNoYW5nZWQgaXRzIGltbXV0YWJsZSBieXRlIHNpemVgKVxuICAgICAgfVxuICAgICAgaWYgKGtub3duRGVzY3JpcHRvciAmJiBrbm93bkRlc2NyaXB0b3IuY29udGVudFR5cGUgIT09IGFzc2V0LmNvbnRlbnRUeXBlKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgU3luY2hyb25pemVkIGFzc2V0IGRlc2NyaXB0b3IgJHthc3NldC5pZH0gY2hhbmdlZCBpdHMgaW1tdXRhYmxlIGNvbnRlbnQgdHlwZWApXG4gICAgICB9XG4gICAgICBpZiAoZG93bmxvYWRGbGlnaHQgJiYgZG93bmxvYWRGbGlnaHQuYnl0ZVNpemUgIT09IGFzc2V0LmJ5dGVTaXplKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgU3luY2hyb25pemVkIGFzc2V0IGRpZ2VzdCAke2Fzc2V0LmRpZ2VzdH0gaGFzIGluY29uc2lzdGVudCBieXRlIHNpemVzYClcbiAgICAgIH1cbiAgICAgIGlmIChkb3dubG9hZEZsaWdodCAmJiBkb3dubG9hZEZsaWdodC5jb250ZW50VHlwZSAhPT0gYXNzZXQuY29udGVudFR5cGUpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBTeW5jaHJvbml6ZWQgYXNzZXQgZGlnZXN0ICR7YXNzZXQuZGlnZXN0fSBoYXMgaW5jb25zaXN0ZW50IGNvbnRlbnQgdHlwZXNgKVxuICAgICAgfVxuXG4gICAgICBkZXNjcmlwdG9yc0J5SWQuc2V0KGFzc2V0LmlkLCBhc3NldClcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHN0YXRlLmFzc2V0cykge1xuICAgICAgaWYgKCFlbnRyeS5zY29wZUtleXMuaW5jbHVkZXMoc2NvcGVLZXkpIHx8IGluY29taW5nSWRzLmhhcyhlbnRyeS5kZXNjcmlwdG9yLmlkKSkgY29udGludWVcblxuICAgICAgZW50cnkuc2NvcGVLZXlzID0gZW50cnkuc2NvcGVLZXlzLmZpbHRlcigoY2FuZGlkYXRlKSA9PiBjYW5kaWRhdGUgIT09IHNjb3BlS2V5KVxuICAgICAgaWYgKGVudHJ5LnNjb3BlS2V5cy5sZW5ndGggPT09IDApIHJlbW92ZWREaWdlc3RzLmFkZChlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdClcbiAgICB9XG5cbiAgICBzdGF0ZS5hc3NldHMgPSBzdGF0ZS5hc3NldHMuZmlsdGVyKChlbnRyeSkgPT4gZW50cnkuc2NvcGVLZXlzLmxlbmd0aCA+IDApXG5cbiAgICBmb3IgKGNvbnN0IGFzc2V0IG9mIGRlc2NyaXB0b3JzKSB7XG4gICAgICBjb25zdCBleGlzdGluZyA9IGVudHJpZXNCeUlkLmdldChhc3NldC5pZClcblxuICAgICAgaWYgKGV4aXN0aW5nICYmIHN0YXRlLmFzc2V0cy5pbmNsdWRlcyhleGlzdGluZykpIHtcbiAgICAgICAgZXhpc3RpbmcuZGVzY3JpcHRvciA9IGFzc2V0XG4gICAgICAgIGlmICghZXhpc3Rpbmcuc2NvcGVLZXlzLmluY2x1ZGVzKHNjb3BlS2V5KSkgZXhpc3Rpbmcuc2NvcGVLZXlzLnB1c2goc2NvcGVLZXkpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb25zdCBuZXdFbnRyeSA9IHtcbiAgICAgICAgICBhdHRlbXB0czogMCxcbiAgICAgICAgICBkZXNjcmlwdG9yOiBhc3NldCxcbiAgICAgICAgICBsYXN0QWNjZXNzZWRBdDogbmV3RW50cnlMYXN0QWNjZXNzZWRBdCxcbiAgICAgICAgICBuZXh0UmV0cnlBdDogbnVsbCxcbiAgICAgICAgICBzY29wZUtleXM6IFtzY29wZUtleV0sXG4gICAgICAgICAgc3RhdHVzOiAvKiogQHR5cGUge2NvbnN0fSAqLyAoXCJtaXNzaW5nXCIpXG4gICAgICAgIH1cblxuICAgICAgICBzdGF0ZS5hc3NldHMucHVzaChuZXdFbnRyeSlcbiAgICAgICAgZW50cmllc0J5SWQuc2V0KGFzc2V0LmlkLCBuZXdFbnRyeSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIG51bWJlcj59ICovXG4gICAgY29uc3QgYnl0ZVNpemVzQnlEaWdlc3QgPSBuZXcgTWFwKClcbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIHN0cmluZyB8IG51bGw+fSAqL1xuICAgIGNvbnN0IGNvbnRlbnRUeXBlc0J5RGlnZXN0ID0gbmV3IE1hcCgpXG5cbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHN0YXRlLmFzc2V0cykge1xuICAgICAgY29uc3Qga25vd25CeXRlU2l6ZSA9IGJ5dGVTaXplc0J5RGlnZXN0LmdldChlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdClcbiAgICAgIGNvbnN0IGtub3duQ29udGVudFR5cGUgPSBjb250ZW50VHlwZXNCeURpZ2VzdC5nZXQoZW50cnkuZGVzY3JpcHRvci5kaWdlc3QpXG5cbiAgICAgIGlmIChrbm93bkJ5dGVTaXplICE9PSB1bmRlZmluZWQgJiYga25vd25CeXRlU2l6ZSAhPT0gZW50cnkuZGVzY3JpcHRvci5ieXRlU2l6ZSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFN5bmNocm9uaXplZCBhc3NldCBkaWdlc3QgJHtlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdH0gaGFzIGluY29uc2lzdGVudCBieXRlIHNpemVzYClcbiAgICAgIH1cbiAgICAgIGlmIChrbm93bkNvbnRlbnRUeXBlICE9PSB1bmRlZmluZWQgJiYga25vd25Db250ZW50VHlwZSAhPT0gZW50cnkuZGVzY3JpcHRvci5jb250ZW50VHlwZSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFN5bmNocm9uaXplZCBhc3NldCBkaWdlc3QgJHtlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdH0gaGFzIGluY29uc2lzdGVudCBjb250ZW50IHR5cGVzYClcbiAgICAgIH1cblxuICAgICAgYnl0ZVNpemVzQnlEaWdlc3Quc2V0KGVudHJ5LmRlc2NyaXB0b3IuZGlnZXN0LCBlbnRyeS5kZXNjcmlwdG9yLmJ5dGVTaXplKVxuICAgICAgY29udGVudFR5cGVzQnlEaWdlc3Quc2V0KGVudHJ5LmRlc2NyaXB0b3IuZGlnZXN0LCBlbnRyeS5kZXNjcmlwdG9yLmNvbnRlbnRUeXBlKVxuICAgIH1cblxuICAgIGZvciAoY29uc3QgZGlnZXN0IG9mIHJlbW92ZWREaWdlc3RzKSB7XG4gICAgICBpZiAoc3RhdGUuYXNzZXRzLnNvbWUoKGVudHJ5KSA9PiBlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdCA9PT0gZGlnZXN0KSkgY29udGludWVcbiAgICAgIGlmICghc3RhdGUucGVuZGluZ0RlbGV0aW9uRGlnZXN0cy5pbmNsdWRlcyhkaWdlc3QpKSBzdGF0ZS5wZW5kaW5nRGVsZXRpb25EaWdlc3RzLnB1c2goZGlnZXN0KVxuICAgIH1cblxuICAgIHJldHVybiBlbnRyaWVzQnlJZFxuICB9XG5cbiAgLyoqXG4gICAqIENvcGllcyBtZXRhZGF0YSBpbnRvIGEgZGV0YWNoZWQgcGVyc2lzdGVuY2UgY2FuZGlkYXRlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZVN0YXRlfSBzdGF0ZSBTdGF0ZSB0byBjb3B5LlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlU3RhdGV9IERldGFjaGVkIHN0YXRlLlxuICAgKi9cbiAgY29weVN0YXRlKHN0YXRlKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGFzc2V0czogc3RhdGUuYXNzZXRzLm1hcCgoZW50cnkpID0+ICh7XG4gICAgICAgIC4uLmVudHJ5LFxuICAgICAgICBkZXNjcmlwdG9yOiB7Li4uZW50cnkuZGVzY3JpcHRvcn0sXG4gICAgICAgIHNjb3BlS2V5czogWy4uLmVudHJ5LnNjb3BlS2V5c11cbiAgICAgIH0pKSxcbiAgICAgIHBlbmRpbmdEZWxldGlvbkRpZ2VzdHM6IFsuLi5zdGF0ZS5wZW5kaW5nRGVsZXRpb25EaWdlc3RzXSxcbiAgICAgIHZlcnNpb246IHN0YXRlLnZlcnNpb25cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogU2VyaWFsaXplcyBvbmUgbWV0YWRhdGEgcGVyc2lzdGVuY2Ugb3BlcmF0aW9uIGFmdGVyIHByaW9yIGZhaWx1cmVzIG9yIHN1Y2Nlc3Nlcy5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPHZvaWQ+fSBwZXJzaXN0IFBlcnNpc3RlbmNlIG9wZXJhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIGFmdGVyIHBlcnNpc3RlbmNlLlxuICAgKi9cbiAgYXN5bmMgc2VyaWFsaXplU3RhdGVQZXJzaXN0ZW5jZShwZXJzaXN0KSB7XG4gICAgdGhpcy5zYXZlU3RhdGVQcm9taXNlID0gdGhpcy5zYXZlU3RhdGVQcm9taXNlLnRoZW4ocGVyc2lzdCwgcGVyc2lzdClcblxuICAgIGF3YWl0IHRoaXMuc2F2ZVN0YXRlUHJvbWlzZVxuICB9XG5cbiAgLyoqXG4gICAqIEVuc3VyZXMgb25lIGRlc2NyaXB0b3IgaGFzIHZlcmlmaWVkIGxvY2FsIGJ5dGVzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZUVudHJ5fSBlbnRyeSBEZXNjcmlwdG9yIHN0YXRlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7ZXJyb3I6IEVycm9yIHwgbnVsbCwgdXJpOiBzdHJpbmcgfCBudWxsfT59IENhY2hlIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGVuc3VyZUNhY2hlZChlbnRyeSkge1xuICAgIGNvbnN0IGRpZ2VzdCA9IGVudHJ5LmRlc2NyaXB0b3IuZGlnZXN0XG5cbiAgICBhd2FpdCB0aGlzLmJlZ2luQWN0aXZlRGlnZXN0KGRpZ2VzdClcblxuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5lbnN1cmVDYWNoZWRXaGlsZUFjdGl2ZShbZW50cnldKVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCB0aGlzLmZpbmlzaEFjdGl2ZURpZ2VzdChkaWdlc3QpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIG9yIGRvd25sb2FkcyBkZXNjcmlwdG9ycyBzaGFyaW5nIG9uZSBwcm90ZWN0ZWQgZGlnZXN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZUVudHJ5W119IGVudHJpZXMgRGVzY3JpcHRvciBzdGF0ZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHtlcnJvcjogRXJyb3IgfCBudWxsLCB1cmk6IHN0cmluZyB8IG51bGx9Pn0gQ2FjaGUgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgZW5zdXJlQ2FjaGVkV2hpbGVBY3RpdmUoZW50cmllcykge1xuICAgIGNvbnN0IGVudHJ5ID0gZW50cmllc1swXVxuXG4gICAgaWYgKCFlbnRyeSkgdGhyb3cgbmV3IEVycm9yKFwiQ2Fubm90IGNhY2hlIGEgc3luY2hyb25pemVkIGFzc2V0IGRpZ2VzdCB3aXRob3V0IGRlc2NyaXB0b3IgZW50cmllc1wiKVxuXG4gICAgY29uc3QgZXhpc3RpbmdVcmkgPSBhd2FpdCB0aGlzLmNhY2hlZFVyaVdoaWxlQWN0aXZlKGVudHJ5KVxuXG4gICAgaWYgKGV4aXN0aW5nVXJpKSB7XG4gICAgICBhd2FpdCB0aGlzLnJlY29yZENhY2hlZEVudHJpZXMoZW50cmllcylcblxuICAgICAgcmV0dXJuIHtlcnJvcjogbnVsbCwgdXJpOiBleGlzdGluZ1VyaX1cbiAgICB9XG5cbiAgICBjb25zdCBkaWdlc3QgPSBlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdFxuICAgIGxldCBkb3dubG9hZEZsaWdodCA9IHRoaXMuZG93bmxvYWRQcm9taXNlcy5nZXQoZGlnZXN0KVxuICAgIGxldCBvd25zRG93bmxvYWRQcm9taXNlID0gZmFsc2VcblxuICAgIGlmIChkb3dubG9hZEZsaWdodCkge1xuICAgICAgZm9yIChjb25zdCBkaWdlc3RFbnRyeSBvZiBlbnRyaWVzKSB7XG4gICAgICAgIGlmIChkb3dubG9hZEZsaWdodC5ieXRlU2l6ZSAhPT0gZGlnZXN0RW50cnkuZGVzY3JpcHRvci5ieXRlU2l6ZSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgU3luY2hyb25pemVkIGFzc2V0IGRpZ2VzdCAke2RpZ2VzdH0gaGFzIGluY29uc2lzdGVudCBieXRlIHNpemVzYClcbiAgICAgICAgfVxuICAgICAgICBpZiAoZG93bmxvYWRGbGlnaHQuY29udGVudFR5cGUgIT09IGRpZ2VzdEVudHJ5LmRlc2NyaXB0b3IuY29udGVudFR5cGUpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFN5bmNocm9uaXplZCBhc3NldCBkaWdlc3QgJHtkaWdlc3R9IGhhcyBpbmNvbnNpc3RlbnQgY29udGVudCB0eXBlc2ApXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGRpZ2VzdEVudHJ5IG9mIGVudHJpZXMpIGRpZ2VzdEVudHJ5LnN0YXR1cyA9IFwiZG93bmxvYWRpbmdcIlxuXG4gICAgaWYgKCFkb3dubG9hZEZsaWdodCkge1xuICAgICAgZG93bmxvYWRGbGlnaHQgPSB7XG4gICAgICAgIGJ5dGVTaXplOiBlbnRyeS5kZXNjcmlwdG9yLmJ5dGVTaXplLFxuICAgICAgICBjb250ZW50VHlwZTogZW50cnkuZGVzY3JpcHRvci5jb250ZW50VHlwZSxcbiAgICAgICAgcHJvbWlzZTogdGhpcy5kb3dubG9hZEFmdGVyUGVyc2lzdGluZ1N0YXRlKGVudHJ5LmRlc2NyaXB0b3IpXG4gICAgICB9XG4gICAgICB0aGlzLmRvd25sb2FkUHJvbWlzZXMuc2V0KGRpZ2VzdCwgZG93bmxvYWRGbGlnaHQpXG4gICAgICBvd25zRG93bmxvYWRQcm9taXNlID0gdHJ1ZVxuICAgIH0gZWxzZSB7XG4gICAgICBhd2FpdCB0aGlzLnNhdmVTdGF0ZSgpXG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGNhY2hlUmVzdWx0ID0gYXdhaXQgZG93bmxvYWRGbGlnaHQucHJvbWlzZVxuXG4gICAgICBpZiAoY2FjaGVSZXN1bHQuZXJyb3IpIHtcbiAgICAgICAgaWYgKGVudHJ5LnN0YXR1cyA9PT0gXCJkb3dubG9hZGluZ1wiKSBhd2FpdCB0aGlzLnJlY29yZERvd25sb2FkRmFpbHVyZShkaWdlc3QpXG5cbiAgICAgICAgcmV0dXJuIGNhY2hlUmVzdWx0XG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHRoaXMucmVjb3JkQ2FjaGVkRW50cmllcyhlbnRyaWVzKVxuXG4gICAgICByZXR1cm4gY2FjaGVSZXN1bHRcbiAgICB9IGZpbmFsbHkge1xuICAgICAgaWYgKG93bnNEb3dubG9hZFByb21pc2UgJiYgdGhpcy5kb3dubG9hZFByb21pc2VzLmdldChkaWdlc3QpID09PSBkb3dubG9hZEZsaWdodCkge1xuICAgICAgICB0aGlzLmRvd25sb2FkUHJvbWlzZXMuZGVsZXRlKGRpZ2VzdClcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkcyBvbmUgY2FjaGVkIGRpZ2VzdCByZXN1bHQgZm9yIGV2ZXJ5IHBhcnRpY2lwYXRpbmcgZGVzY3JpcHRvci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVFbnRyeVtdfSBlbnRyaWVzIERlc2NyaXB0b3Igc3RhdGVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgYWZ0ZXIgcGVyc2lzdGVuY2UuXG4gICAqL1xuICBhc3luYyByZWNvcmRDYWNoZWRFbnRyaWVzKGVudHJpZXMpIHtcbiAgICBjb25zdCBsYXN0QWNjZXNzZWRBdCA9IHRoaXMubm93TWlsbGlzZWNvbmRzKClcblxuICAgIGZvciAoY29uc3QgZW50cnkgb2YgZW50cmllcykge1xuICAgICAgZW50cnkuYXR0ZW1wdHMgPSAwXG4gICAgICBlbnRyeS5sYXN0QWNjZXNzZWRBdCA9IGxhc3RBY2Nlc3NlZEF0XG4gICAgICBlbnRyeS5uZXh0UmV0cnlBdCA9IG51bGxcbiAgICAgIGVudHJ5LnN0YXR1cyA9IFwiY2FjaGVkXCJcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnNhdmVTdGF0ZSgpXG4gIH1cblxuICAvKipcbiAgICogUGVyc2lzdHMgZG93bmxvYWQgaW50ZW50LCB0aGVuIGRvd25sb2FkcyBvbmUgZGlnZXN0IGFuZCByZWNvcmRzIGEgc2hhcmVkIGZhaWx1cmUgb25jZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVEZXNjcmlwdG9yfSBkZXNjcmlwdG9yIEFzc2V0IGRlc2NyaXB0b3IuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHtlcnJvcjogRXJyb3IsIHVyaTogbnVsbH0gfCB7ZXJyb3I6IG51bGwsIHVyaTogc3RyaW5nfT59IFNoYXJlZCBjYWNoZSByZXN1bHQuXG4gICAqL1xuICBhc3luYyBkb3dubG9hZEFmdGVyUGVyc2lzdGluZ1N0YXRlKGRlc2NyaXB0b3IpIHtcbiAgICBhd2FpdCB0aGlzLnNhdmVTdGF0ZSgpXG5cbiAgICB0cnkge1xuICAgICAgcmV0dXJuIHtlcnJvcjogbnVsbCwgdXJpOiBhd2FpdCB0aGlzLmRvd25sb2FkVmVyaWZpZWQoZGVzY3JpcHRvcil9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnN0IGZhaWx1cmUgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSlcblxuICAgICAgYXdhaXQgdGhpcy5yZWNvcmREb3dubG9hZEZhaWx1cmUoZGVzY3JpcHRvci5kaWdlc3QpXG5cbiAgICAgIHJldHVybiB7ZXJyb3I6IGZhaWx1cmUsIHVyaTogbnVsbH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQWR2YW5jZXMgcmV0cnkgbWV0YWRhdGEgZm9yIGV2ZXJ5IGxpdmUgZGVzY3JpcHRvciBzaGFyaW5nIG9uZSBmYWlsZWQgZGlnZXN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZGlnZXN0IENvbnRlbnQgZGlnZXN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgYWZ0ZXIgcGVyc2lzdGVuY2UuXG4gICAqL1xuICBhc3luYyByZWNvcmREb3dubG9hZEZhaWx1cmUoZGlnZXN0KSB7XG4gICAgaWYgKCF0aGlzLnN0YXRlKSB0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3QgcmVjb3JkIHN5bmNocm9uaXplZCBhc3NldCBkb3dubG9hZCBmYWlsdXJlIGJlZm9yZSBsb2FkaW5nIHN0YXRlXCIpXG5cbiAgICBjb25zdCBmYWlsZWRBdCA9IHRoaXMubm93TWlsbGlzZWNvbmRzKClcblxuICAgIGZvciAoY29uc3QgZW50cnkgb2YgdGhpcy5zdGF0ZS5hc3NldHMpIHtcbiAgICAgIGlmIChlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdCAhPT0gZGlnZXN0KSBjb250aW51ZVxuICAgICAgaWYgKGVudHJ5LnN0YXR1cyAhPT0gXCJkb3dubG9hZGluZ1wiKSBjb250aW51ZVxuXG4gICAgICBlbnRyeS5hdHRlbXB0cyArPSAxXG4gICAgICBlbnRyeS5uZXh0UmV0cnlBdCA9IGZhaWxlZEF0ICsgdGhpcy5yZXRyeURlbGF5KGVudHJ5LmF0dGVtcHRzKVxuICAgICAgZW50cnkuc3RhdHVzID0gXCJmYWlsZWRcIlxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuc2F2ZVN0YXRlKClcbiAgfVxuXG4gIC8qKlxuICAgKiBEb3dubG9hZHMsIHZlcmlmaWVzLCBhbmQgYXRvbWljYWxseSBwZXJzaXN0cyBvbmUgY29udGVudCBkaWdlc3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlRGVzY3JpcHRvcn0gZGVzY3JpcHRvciBBc3NldCBkZXNjcmlwdG9yLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSBBZGFwdGVyIFVSSS5cbiAgICovXG4gIGFzeW5jIGRvd25sb2FkVmVyaWZpZWQoZGVzY3JpcHRvcikge1xuICAgIGNvbnN0IGRvd25sb2FkZWRCeXRlcyA9IGF3YWl0IHRoaXMuZG93bmxvYWQoZGVzY3JpcHRvcilcblxuICAgIGlmICghKGRvd25sb2FkZWRCeXRlcyBpbnN0YW5jZW9mIFVpbnQ4QXJyYXkpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFN5bmNocm9uaXplZCBhc3NldCAke2Rlc2NyaXB0b3IuaWR9IGRvd25sb2FkIGRpZCBub3QgcmV0dXJuIFVpbnQ4QXJyYXkgYnl0ZXNgKVxuICAgIH1cbiAgICBpZiAoZG93bmxvYWRlZEJ5dGVzLmJ5dGVMZW5ndGggIT09IGRlc2NyaXB0b3IuYnl0ZVNpemUpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgU3luY2hyb25pemVkIGFzc2V0ICR7ZGVzY3JpcHRvci5pZH0gYnl0ZSBzaXplIGRpZCBub3QgbWF0Y2ggaXRzIGRlc2NyaXB0b3JgKVxuICAgIH1cblxuICAgIGNvbnN0IGRpZ2VzdCA9IGBzaGEyNTYtJHtzaGEyNTZCeXRlc0hleChkb3dubG9hZGVkQnl0ZXMpfWBcblxuICAgIGlmIChkaWdlc3QgIT09IGRlc2NyaXB0b3IuZGlnZXN0KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFN5bmNocm9uaXplZCBhc3NldCAke2Rlc2NyaXB0b3IuaWR9IGRpZ2VzdCBkaWQgbm90IG1hdGNoIGl0cyBkZXNjcmlwdG9yYClcbiAgICB9XG5cbiAgICBjb25zdCB1cmkgPSBhd2FpdCB0aGlzLmFkYXB0ZXIud3JpdGVCbG9iKHtcbiAgICAgIGFjY291bnRJZDogdGhpcy5hY2NvdW50SWQsXG4gICAgICBieXRlczogZG93bmxvYWRlZEJ5dGVzLFxuICAgICAgY29udGVudFR5cGU6IGRlc2NyaXB0b3IuY29udGVudFR5cGUsXG4gICAgICBkaWdlc3RcbiAgICB9KVxuXG4gICAgaWYgKCF1cmkpIHRocm93IG5ldyBFcnJvcihgU3luY2hyb25pemVkIGFzc2V0IGFkYXB0ZXIgcmV0dXJuZWQgbm8gVVJJIGZvciAke2Rlc2NyaXB0b3IuaWR9YClcblxuICAgIHJldHVybiB1cmlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBhbiBleGlzdGluZyBsb2NhbCBVUkkgYWZ0ZXIgd2FpdGluZyBmb3IgZGVsZXRpb24gd29yay5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVFbnRyeX0gZW50cnkgRGVzY3JpcHRvciBzdGF0ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nIHwgbnVsbD59IEV4aXN0aW5nIFVSSS5cbiAgICovXG4gIGFzeW5jIGNhY2hlZFVyaShlbnRyeSkge1xuICAgIGNvbnN0IGRpZ2VzdCA9IGVudHJ5LmRlc2NyaXB0b3IuZGlnZXN0XG5cbiAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgYXdhaXQgdGhpcy5iZWdpbkFjdGl2ZURpZ2VzdChkaWdlc3QpXG4gICAgICBsZXQgcmV2YWxpZGF0aW9uUmVxdWlyZWRcbiAgICAgIGxldCB1cmlcblxuICAgICAgdHJ5IHtcbiAgICAgICAgdXJpID0gYXdhaXQgdGhpcy5jYWNoZWRVcmlXaGlsZUFjdGl2ZShlbnRyeSlcbiAgICAgIH0gZmluYWxseSB7XG4gICAgICAgIHJldmFsaWRhdGlvblJlcXVpcmVkID0gYXdhaXQgdGhpcy5maW5pc2hBY3RpdmVEaWdlc3QoZGlnZXN0KVxuICAgICAgfVxuXG4gICAgICBpZiAoIXJldmFsaWRhdGlvblJlcXVpcmVkKSByZXR1cm4gdXJpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGFuIGV4aXN0aW5nIGxvY2FsIFVSSSB3aGlsZSBpdHMgZGlnZXN0IGlzIHByb3RlY3RlZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVFbnRyeX0gZW50cnkgRGVzY3JpcHRvciBzdGF0ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nIHwgbnVsbD59IEV4aXN0aW5nIFVSSS5cbiAgICovXG4gIGFzeW5jIGNhY2hlZFVyaVdoaWxlQWN0aXZlKGVudHJ5KSB7XG4gICAgY29uc3QgdXJpID0gYXdhaXQgdGhpcy5hZGFwdGVyLmJsb2JVcmkoe1xuICAgICAgYWNjb3VudElkOiB0aGlzLmFjY291bnRJZCxcbiAgICAgIGRpZ2VzdDogZW50cnkuZGVzY3JpcHRvci5kaWdlc3RcbiAgICB9KVxuXG4gICAgaWYgKCF1cmkgJiYgZW50cnkuc3RhdHVzID09PSBcImNhY2hlZFwiKSBlbnRyeS5zdGF0dXMgPSBcIm1pc3NpbmdcIlxuXG4gICAgcmV0dXJuIHVyaVxuICB9XG5cbiAgLyoqXG4gICAqIFdhaXRzIGZvciBkZWxldGlvbiBhbmQgcHJvdGVjdHMgYSBkaWdlc3QgZm9yIG9uZSBhY3RpdmUgY2FjaGUgb3BlcmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZGlnZXN0IENvbnRlbnQgZGlnZXN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgYWZ0ZXIgcHJvdGVjdGlvbiBpcyByZWdpc3RlcmVkLlxuICAgKi9cbiAgYXN5bmMgYmVnaW5BY3RpdmVEaWdlc3QoZGlnZXN0KSB7XG4gICAgbGV0IGRlbGV0aW9uUHJvbWlzZSA9IHRoaXMuZGVsZXRpb25Qcm9taXNlcy5nZXQoZGlnZXN0KVxuXG4gICAgd2hpbGUgKGRlbGV0aW9uUHJvbWlzZSkge1xuICAgICAgYXdhaXQgZGVsZXRpb25Qcm9taXNlXG4gICAgICBkZWxldGlvblByb21pc2UgPSB0aGlzLmRlbGV0aW9uUHJvbWlzZXMuZ2V0KGRpZ2VzdClcbiAgICB9XG5cbiAgICBjb25zdCBhY3RpdmVDb3VudCA9IHRoaXMuYWN0aXZlRGlnZXN0Q291bnRzLmdldChkaWdlc3QpID8/IDBcblxuICAgIHRoaXMuYWN0aXZlRGlnZXN0Q291bnRzLnNldChkaWdlc3QsIGFjdGl2ZUNvdW50ICsgMSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWxlYXNlcyBvbmUgY2FjaGUgb3BlcmF0aW9uIGFuZCBwcm9jZXNzZXMgZGVmZXJyZWQgZGVsZXRpb24gYWZ0ZXIgdGhlIGxhc3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBkaWdlc3QgQ29udGVudCBkaWdlc3QuXG4gICAqIEBwYXJhbSB7U2V0PHN0cmluZz59IFtwcm90ZWN0ZWRDbGVhbnVwRGlnZXN0c10gRGlnZXN0cyBuZWVkZWQgYnkgdGhlIHJlc29sdmluZyBjYWxsZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSBXaGV0aGVyIGZpbmFsaXphdGlvbiByZXF1aXJlcyBVUkkgcmV2YWxpZGF0aW9uLlxuICAgKi9cbiAgYXN5bmMgZmluaXNoQWN0aXZlRGlnZXN0KGRpZ2VzdCwgcHJvdGVjdGVkQ2xlYW51cERpZ2VzdHMgPSBuZXcgU2V0KCkpIHtcbiAgICBjb25zdCBhY3RpdmVDb3VudCA9IHRoaXMuYWN0aXZlRGlnZXN0Q291bnRzLmdldChkaWdlc3QpXG5cbiAgICBpZiAoYWN0aXZlQ291bnQgPT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBNaXNzaW5nIGFjdGl2ZSBzeW5jaHJvbml6ZWQgYXNzZXQgZGlnZXN0IGNvdW50IGZvciAke2RpZ2VzdH1gKVxuICAgIH1cblxuICAgIGlmIChhY3RpdmVDb3VudCA+IDEpIHtcbiAgICAgIHRoaXMuYWN0aXZlRGlnZXN0Q291bnRzLnNldChkaWdlc3QsIGFjdGl2ZUNvdW50IC0gMSlcbiAgICAgIHJldHVybiBmYWxzZVxuICAgIH1cblxuICAgIHRoaXMuYWN0aXZlRGlnZXN0Q291bnRzLmRlbGV0ZShkaWdlc3QpXG4gICAgY29uc3QgcGVuZGluZ0RpZ2VzdERlbGV0ZWQgPSBhd2FpdCB0aGlzLmRlbGV0ZVBlbmRpbmdEaWdlc3RJZlVucmVmZXJlbmNlZChkaWdlc3QpXG4gICAgY29uc3QgZGVmZXJyZWRDbGVhbnVwUmVxdWlyZWQgPSB0aGlzLmNsZWFudXBSZXF1aXJlZEFmdGVyUmVsZWFzZURpZ2VzdHMuZGVsZXRlKGRpZ2VzdClcblxuICAgIGlmIChkZWZlcnJlZENsZWFudXBSZXF1aXJlZCkgYXdhaXQgdGhpcy5jbGVhbnVwKHByb3RlY3RlZENsZWFudXBEaWdlc3RzKVxuXG4gICAgcmV0dXJuIHBlbmRpbmdEaWdlc3REZWxldGVkIHx8IGRlZmVycmVkQ2xlYW51cFJlcXVpcmVkXG4gIH1cblxuICAvKipcbiAgICogUmVsZWFzZXMgZXZlcnkgYWNxdWlyZWQgZGlnZXN0IGJlZm9yZSBwcm9wYWdhdGluZyBmaW5hbGl6YXRpb24gZmFpbHVyZXMuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGRpZ2VzdHMgQ29udGVudCBkaWdlc3RzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgYWZ0ZXIgZXZlcnkgZGlnZXN0IGlzIHJlbGVhc2VkLlxuICAgKi9cbiAgYXN5bmMgZmluaXNoQWN0aXZlRGlnZXN0cyhkaWdlc3RzKSB7XG4gICAgLyoqIEB0eXBlIHtFcnJvcltdfSAqL1xuICAgIGNvbnN0IGZhaWx1cmVzID0gW11cblxuICAgIGZvciAoY29uc3QgZGlnZXN0IG9mIGRpZ2VzdHMpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMuZmluaXNoQWN0aXZlRGlnZXN0KGRpZ2VzdClcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGZhaWx1cmVzLnB1c2goZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpKVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChmYWlsdXJlcy5sZW5ndGggPT09IDEpIHRocm93IGZhaWx1cmVzWzBdXG4gICAgaWYgKGZhaWx1cmVzLmxlbmd0aCA+IDEpIHtcbiAgICAgIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihmYWlsdXJlcywgXCJNdWx0aXBsZSBzeW5jaHJvbml6ZWQgYXNzZXQgZGlnZXN0IGZpbmFsaXplcnMgZmFpbGVkXCIsIHtjYXVzZTogZmFpbHVyZXNbMF19KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBEZWxldGVzIGJsb2JzIHRoYXQgbG9zdCB0aGVpciBmaW5hbCBkZXNjcmlwdG9yIHJlZmVyZW5jZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIGFmdGVyIGRlbGV0aW9uLlxuICAgKi9cbiAgYXN5bmMgZGVsZXRlVW5yZWZlcmVuY2VkRGlnZXN0cygpIHtcbiAgICBpZiAoIXRoaXMuc3RhdGUpIHRocm93IG5ldyBFcnJvcihcIkNhbm5vdCBkZWxldGUgc3luY2hyb25pemVkIGFzc2V0IGJsb2JzIGJlZm9yZSBsb2FkaW5nIHN0YXRlXCIpXG5cbiAgICBmb3IgKGNvbnN0IGRpZ2VzdCBvZiBbLi4udGhpcy5zdGF0ZS5wZW5kaW5nRGVsZXRpb25EaWdlc3RzXSkge1xuICAgICAgYXdhaXQgdGhpcy5kZWxldGVQZW5kaW5nRGlnZXN0SWZVbnJlZmVyZW5jZWQoZGlnZXN0KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBEZWxldGVzIG9uZSBwZXJzaXN0ZWQgcGVuZGluZyBkaWdlc3Qgd2hlbiBubyBkZXNjcmlwdG9yIG9yIGFjdGl2ZSBvcGVyYXRpb24gb3ducyBpdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGRpZ2VzdCBDb250ZW50IGRpZ2VzdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IFdoZXRoZXIgdGhlIGJsb2Igd2FzIGRlbGV0ZWQuXG4gICAqL1xuICBhc3luYyBkZWxldGVQZW5kaW5nRGlnZXN0SWZVbnJlZmVyZW5jZWQoZGlnZXN0KSB7XG4gICAgaWYgKCF0aGlzLnN0YXRlKSB0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3QgZGVsZXRlIHN5bmNocm9uaXplZCBhc3NldCBibG9icyBiZWZvcmUgbG9hZGluZyBzdGF0ZVwiKVxuICAgIGlmICghdGhpcy5zdGF0ZS5wZW5kaW5nRGVsZXRpb25EaWdlc3RzLmluY2x1ZGVzKGRpZ2VzdCkpIHJldHVybiBmYWxzZVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZGVsZXRlRGlnZXN0SWZJbmFjdGl2ZShkaWdlc3QsIGFzeW5jICgpID0+IHtcbiAgICAgIGlmICghdGhpcy5zdGF0ZSkgdGhyb3cgbmV3IEVycm9yKFwiQ2Fubm90IGRlbGV0ZSBzeW5jaHJvbml6ZWQgYXNzZXQgYmxvYnMgYmVmb3JlIGxvYWRpbmcgc3RhdGVcIilcbiAgICAgIGlmICghdGhpcy5zdGF0ZS5wZW5kaW5nRGVsZXRpb25EaWdlc3RzLmluY2x1ZGVzKGRpZ2VzdCkpIHJldHVybiBmYWxzZVxuXG4gICAgICBsZXQgZGVsZXRlZCA9IGZhbHNlXG5cbiAgICAgIGlmICghdGhpcy5zdGF0ZS5hc3NldHMuc29tZSgoZW50cnkpID0+IGVudHJ5LmRlc2NyaXB0b3IuZGlnZXN0ID09PSBkaWdlc3QpKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuYWRhcHRlci5kZWxldGVCbG9iKHthY2NvdW50SWQ6IHRoaXMuYWNjb3VudElkLCBkaWdlc3R9KVxuICAgICAgICBkZWxldGVkID0gdHJ1ZVxuICAgICAgfVxuXG4gICAgICBjb25zdCBwZW5kaW5nRGVsZXRpb25EaWdlc3RzID0gdGhpcy5zdGF0ZS5wZW5kaW5nRGVsZXRpb25EaWdlc3RzXG5cbiAgICAgIHRoaXMuc3RhdGUucGVuZGluZ0RlbGV0aW9uRGlnZXN0cyA9IHBlbmRpbmdEZWxldGlvbkRpZ2VzdHMuZmlsdGVyKChjYW5kaWRhdGUpID0+IGNhbmRpZGF0ZSAhPT0gZGlnZXN0KVxuXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLnNhdmVTdGF0ZSgpXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBpZiAoIXRoaXMuc3RhdGUucGVuZGluZ0RlbGV0aW9uRGlnZXN0cy5pbmNsdWRlcyhkaWdlc3QpKSB0aGlzLnN0YXRlLnBlbmRpbmdEZWxldGlvbkRpZ2VzdHMucHVzaChkaWdlc3QpXG4gICAgICAgIHRocm93IGVycm9yXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBkZWxldGVkXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG9uZSBkZWxldGlvbiBvbmx5IGFmdGVyIGVhcmxpZXIgZGVsZXRpb24gd29yayBhbmQgd2hlbiBubyBjYWNoZSBvcGVyYXRpb24gb3ducyB0aGUgZGlnZXN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZGlnZXN0IENvbnRlbnQgZGlnZXN0LlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8Ym9vbGVhbj59IGNhbGxiYWNrIFByb3RlY3RlZCBkZWxldGlvbiBjYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IFdoZXRoZXIgdGhlIGNhbGxiYWNrIGRlbGV0ZWQgdGhlIGJsb2IuXG4gICAqL1xuICBhc3luYyBkZWxldGVEaWdlc3RJZkluYWN0aXZlKGRpZ2VzdCwgY2FsbGJhY2spIHtcbiAgICBsZXQgYWN0aXZlRGVsZXRpb25Qcm9taXNlID0gdGhpcy5kZWxldGlvblByb21pc2VzLmdldChkaWdlc3QpXG5cbiAgICB3aGlsZSAoYWN0aXZlRGVsZXRpb25Qcm9taXNlKSB7XG4gICAgICBhd2FpdCBhY3RpdmVEZWxldGlvblByb21pc2VcbiAgICAgIGFjdGl2ZURlbGV0aW9uUHJvbWlzZSA9IHRoaXMuZGVsZXRpb25Qcm9taXNlcy5nZXQoZGlnZXN0KVxuICAgIH1cblxuICAgIGlmICh0aGlzLmFjdGl2ZURpZ2VzdENvdW50cy5oYXMoZGlnZXN0KSkgcmV0dXJuIGZhbHNlXG5cbiAgICAvKipcbiAgICAgKiBSZWxlYXNlcyBjYWxsZXJzIHdhaXRpbmcgZm9yIGRlbGV0aW9uIGNvbXBsZXRpb24uXG4gICAgICogQHR5cGUgeygpID0+IHZvaWR9XG4gICAgICovXG4gICAgbGV0IHJlbGVhc2VEZWxldGlvbiA9ICgpID0+IHt9XG4gICAgLyoqXG4gICAgICogQmxvY2tzIG5ldyBkaWdlc3QgYWN0aXZpdHkgdW50aWwgZGVsZXRpb24gY29tcGxldGVzLlxuICAgICAqIEB0eXBlIHtQcm9taXNlPHZvaWQ+fVxuICAgICAqL1xuICAgIGNvbnN0IGRlbGV0aW9uUHJvbWlzZSA9IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgICByZWxlYXNlRGVsZXRpb24gPSAoKSA9PiByZXNvbHZlKHVuZGVmaW5lZClcbiAgICB9KVxuXG4gICAgdGhpcy5kZWxldGlvblByb21pc2VzLnNldChkaWdlc3QsIGRlbGV0aW9uUHJvbWlzZSlcblxuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soKVxuICAgIH0gZmluYWxseSB7XG4gICAgICBpZiAodGhpcy5kZWxldGlvblByb21pc2VzLmdldChkaWdlc3QpID09PSBkZWxldGlvblByb21pc2UpIHRoaXMuZGVsZXRpb25Qcm9taXNlcy5kZWxldGUoZGlnZXN0KVxuICAgICAgcmVsZWFzZURlbGV0aW9uKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRmluZHMgcmVxdWlyZWQgYXNzZXRzIHdpdGhvdXQgbG9jYWxseSBjYWNoZWQgYnl0ZXMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzY29wZUtleSBTeW5jaHJvbml6ZWQgc2NvcGUgdG8gaW5zcGVjdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fSBNaXNzaW5nIHJlcXVpcmVkIGRlc2NyaXB0b3IgaWRzLlxuICAgKi9cbiAgYXN5bmMgbWlzc2luZ1JlcXVpcmVkQXNzZXRJZHMoc2NvcGVLZXkpIHtcbiAgICBjb25zdCBzdGF0ZSA9IGF3YWl0IHRoaXMubG9hZFN0YXRlKClcbiAgICAvKiogQHR5cGUge3N0cmluZ1tdfSAqL1xuICAgIGNvbnN0IG1pc3NpbmdBc3NldElkcyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHN0YXRlLmFzc2V0cykge1xuICAgICAgaWYgKCFlbnRyeS5zY29wZUtleXMuaW5jbHVkZXMoc2NvcGVLZXkpKSBjb250aW51ZVxuICAgICAgaWYgKGVudHJ5LmRlc2NyaXB0b3Iub2ZmbGluZVJlcXVpcmVtZW50ICE9PSBcInJlcXVpcmVkXCIpIGNvbnRpbnVlXG4gICAgICBpZiAoYXdhaXQgdGhpcy5jYWNoZWRVcmkoZW50cnkpKSBjb250aW51ZVxuXG4gICAgICBtaXNzaW5nQXNzZXRJZHMucHVzaChlbnRyeS5kZXNjcmlwdG9yLmlkKVxuICAgIH1cblxuICAgIHJldHVybiBtaXNzaW5nQXNzZXRJZHNcbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVja3Mgd2hldGhlciBhIGZhaWxlZCBvciBtaXNzaW5nIGVudHJ5IG1heSBiZSBkb3dubG9hZGVkIG5vdy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVFbnRyeX0gZW50cnkgRGVzY3JpcHRvciBzdGF0ZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IFdoZXRoZXIgdGhlIHJldHJ5IGRlYWRsaW5lIGhhcyBwYXNzZWQuXG4gICAqL1xuICByZXRyeUVsaWdpYmxlKGVudHJ5KSB7XG4gICAgcmV0dXJuIGVudHJ5LnN0YXR1cyAhPT0gXCJmYWlsZWRcIiB8fCBlbnRyeS5uZXh0UmV0cnlBdCA9PT0gbnVsbCB8fCBlbnRyeS5uZXh0UmV0cnlBdCA8PSB0aGlzLm5vd01pbGxpc2Vjb25kcygpXG4gIH1cblxuICAvKipcbiAgICogQ2FsY3VsYXRlcyBib3VuZGVkIGV4cG9uZW50aWFsIHJldHJ5IGRlbGF5LlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXR0ZW1wdHMgQ29uc2VjdXRpdmUgZmFpbHVyZXMuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IFJldHJ5IGRlbGF5LlxuICAgKi9cbiAgcmV0cnlEZWxheShhdHRlbXB0cykge1xuICAgIHJldHVybiBNYXRoLm1pbih0aGlzLnJldHJ5TWF4RGVsYXlNcywgdGhpcy5yZXRyeUJhc2VEZWxheU1zICogKDIgKiogTWF0aC5tYXgoMCwgYXR0ZW1wdHMgLSAxKSkpXG4gIH1cblxuICAvKipcbiAgICogUmVhZHMgdGhlIGluamVjdGFibGUgd2FsbCBjbG9jay5cbiAgICogQHJldHVybnMge251bWJlcn0gQ3VycmVudCBlcG9jaCBtaWxsaXNlY29uZHMuXG4gICAqL1xuICBub3dNaWxsaXNlY29uZHMoKSB7XG4gICAgcmV0dXJuIHRoaXMubm93KCkuZ2V0VGltZSgpXG4gIH1cbn1cbiJdfQ==