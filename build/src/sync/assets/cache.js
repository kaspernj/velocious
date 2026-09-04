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
                for (const descriptor of eagerDescriptors) {
                    const entry = entriesById.get(descriptor.id);
                    if (!entry || !this.retryEligible(entry))
                        continue;
                    const cacheResult = await this.ensureCachedWhileActive(entry);
                    if (cacheResult.error)
                        failures.push({ assetId: descriptor.id, error: cacheResult.error });
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
                const cacheResult = await this.ensureCachedWhileActive(entry);
                if (cacheResult.error)
                    throw cacheResult.error;
                if (cacheResult.uri) {
                    await this.cleanup(new Set([digest]));
                    resolvedUri = cacheResult.uri;
                }
            }
        }
        finally {
            await this.finishActiveDigest(digest);
        }
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
        const digestsById = new Map(state.assets.map((entry) => [entry.descriptor.id, entry.descriptor.digest]));
        const removedDigests = new Set();
        for (const asset of descriptors) {
            const knownDigest = digestsById.get(asset.id);
            if (knownDigest !== undefined && knownDigest !== asset.digest) {
                throw new Error(`Synchronized asset descriptor ${asset.id} changed its immutable digest`);
            }
            digestsById.set(asset.id, asset.digest);
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
            return await this.ensureCachedWhileActive(entry);
        }
        finally {
            await this.finishActiveDigest(digest);
        }
    }
    /**
     * Resolves or downloads one descriptor while its digest is protected.
     * @param {import("./types.js").SynchronizedAssetCacheEntry} entry Descriptor state.
     * @returns {Promise<{error: Error | null, uri: string | null}>} Cache result.
     */
    async ensureCachedWhileActive(entry) {
        const existingUri = await this.cachedUriWhileActive(entry);
        if (existingUri) {
            entry.attempts = 0;
            entry.lastAccessedAt = this.nowMilliseconds();
            entry.nextRetryAt = null;
            entry.status = "cached";
            await this.saveState();
            return { error: null, uri: existingUri };
        }
        entry.status = "downloading";
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
            entry.attempts = 0;
            entry.lastAccessedAt = this.nowMilliseconds();
            entry.nextRetryAt = null;
            entry.status = "cached";
            await this.saveState();
            return cacheResult;
        }
        finally {
            if (ownsDownloadPromise && this.downloadPromises.get(digest) === downloadPromise) {
                this.downloadPromises.delete(digest);
            }
        }
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2FjaGUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvc3luYy9hc3NldHMvY2FjaGUuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sY0FBYyxNQUFNLGlDQUFpQyxDQUFBO0FBRTVELE1BQU0sbUJBQW1CLEdBQUcsQ0FBQyxDQUFBO0FBQzdCLE1BQU0sMkJBQTJCLEdBQUcsSUFBSSxDQUFBO0FBQ3hDLE1BQU0sMEJBQTBCLEdBQUcsSUFBSSxHQUFHLEVBQUUsR0FBRyxDQUFDLENBQUE7QUFFaEQ7OztHQUdHO0FBQ0gsTUFBTSxDQUFDLE9BQU8sT0FBTyxzQkFBc0I7SUFDekM7Ozs7Ozs7Ozs7T0FVRztJQUNILFlBQVksRUFBQyxTQUFTLEVBQUUsT0FBTyxFQUFFLFFBQVEsRUFBRSxRQUFRLEVBQUUsR0FBRyxHQUFHLEdBQUcsRUFBRSxDQUFDLElBQUksSUFBSSxFQUFFLEVBQUUsZ0JBQWdCLEdBQUcsMkJBQTJCLEVBQUUsZUFBZSxHQUFHLDBCQUEwQixFQUFDO1FBQ3hLLElBQUksQ0FBQyxTQUFTO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxpREFBaUQsQ0FBQyxDQUFBO1FBQ2xGLElBQUksQ0FBQyxNQUFNLENBQUMsYUFBYSxDQUFDLFFBQVEsQ0FBQyxJQUFJLFFBQVEsR0FBRyxDQUFDO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyx1RUFBdUUsQ0FBQyxDQUFBO1FBQzdJLElBQUksQ0FBQyxNQUFNLENBQUMsYUFBYSxDQUFDLGdCQUFnQixDQUFDLElBQUksZ0JBQWdCLEdBQUcsQ0FBQztZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsMkVBQTJFLENBQUMsQ0FBQTtRQUNqSyxJQUFJLENBQUMsTUFBTSxDQUFDLGFBQWEsQ0FBQyxlQUFlLENBQUMsSUFBSSxlQUFlLEdBQUcsZ0JBQWdCO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyw0RUFBNEUsQ0FBQyxDQUFBO1FBRS9LLElBQUksQ0FB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Q2pELElBQUksS0FBSyxDQUFDLFVBQVUsQ0FBQyxrQkFBa0IsS0FBSyxVQUFVO2dCQUFFLFNBQVE7WUFDaEUsSUFBSSxNQUFNLElBQUksQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDO2dCQUFFLFNBQVE7WUFFekMsZUFBZSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDLEVBQUUsQ0FBQyxDQUFBO1FBQzNDLENBQUM7UUFFRCxPQUFPLGVBQWUsQ0FBQTtJQUN4QixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILGFBQWEsQ0FBQyxLQUFLO1FBQ2pCLE9BQU8sS0FBSyxDQUFDLE1BQU0sS0FBSyxRQUFRLElBQUksS0FBSyxDQUFDLFdBQVcsS0FBSyxJQUFJLElBQUksS0FBSyxDQUFDLFdBQVcsSUFBSSxJQUFJLENBQUMsZUFBZSxFQUFFLENBQUE7SUFDL0csQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxVQUFVLENBQUMsUUFBUTtRQUNqQixPQUFPLElBQUksQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLGVBQWUsRUFBRSxJQUFJLENBQUMsZ0JBQWdCLEdBQUcsQ0FBQyxDQUFDLElBQUksSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsUUFBUSxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQTtJQUNqRyxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsZUFBZTtRQUNiLE9BQU8sSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDLE9BQU8sRUFBRSxDQUFBO0lBQzdCLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgc2hhMjU2Qnl0ZXNIZXggZnJvbSBcIi4uLy4uL3V0aWxzL3NoYTI1Ni1ieXRlcy1oZXguanNcIlxuXG5jb25zdCBDQUNIRV9TVEFURV9WRVJTSU9OID0gMVxuY29uc3QgREVGQVVMVF9SRVRSWV9CQVNFX0RFTEFZX01TID0gMTAwMFxuY29uc3QgREVGQVVMVF9SRVRSWV9NQVhfREVMQVlfTVMgPSAxMDAwICogNjAgKiA1XG5cbi8qKlxuICogQ29yZSBzeW5jaHJvbml6ZWQgYXNzZXQgY2FjaGUuIFBsYXRmb3JtIHBhY2thZ2VzIG93biBieXRlIGFuZCBtZXRhZGF0YVxuICogcGVyc2lzdGVuY2Ugd2hpbGUgdGhpcyBjbGFzcyBvd25zIHBvbGljeSwgaW50ZWdyaXR5LCBhbmQgbGlmZWN5Y2xlLlxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBTeW5jaHJvbml6ZWRBc3NldENhY2hlIHtcbiAgLyoqXG4gICAqIENyZWF0ZXMgYSBzeW5jaHJvbml6ZWQgYXNzZXQgY2FjaGUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmFjY291bnRJZCBBdXRoZW50aWNhdGVkIGFjY291bnQgbmFtZXNwYWNlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZUFkYXB0ZXJ9IGFyZ3MuYWRhcHRlciBQbGF0Zm9ybSBzdG9yYWdlIGFkYXB0ZXIuXG4gICAqIEBwYXJhbSB7KGRlc2NyaXB0b3I6IGltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZURlc2NyaXB0b3IpID0+IFByb21pc2U8VWludDhBcnJheT59IGFyZ3MuZG93bmxvYWQgQXV0aGVudGljYXRlZCBieXRlIGRvd25sb2FkZXIuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLm1heEJ5dGVzIE1heGltdW0gZXZpY3RhYmxlIGNhY2hlIHNpemUuXG4gICAqIEBwYXJhbSB7KCkgPT4gRGF0ZX0gW2FyZ3Mubm93XSBDbG9jay5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLnJldHJ5QmFzZURlbGF5TXNdIEluaXRpYWwgcmV0cnkgZGVsYXkuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5yZXRyeU1heERlbGF5TXNdIE1heGltdW0gcmV0cnkgZGVsYXkuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7YWNjb3VudElkLCBhZGFwdGVyLCBkb3dubG9hZCwgbWF4Qnl0ZXMsIG5vdyA9ICgpID0+IG5ldyBEYXRlKCksIHJldHJ5QmFzZURlbGF5TXMgPSBERUZBVUxUX1JFVFJZX0JBU0VfREVMQVlfTVMsIHJldHJ5TWF4RGVsYXlNcyA9IERFRkFVTFRfUkVUUllfTUFYX0RFTEFZX01TfSkge1xuICAgIGlmICghYWNjb3VudElkKSB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jaHJvbml6ZWQgYXNzZXQgY2FjaGUgcmVxdWlyZXMgYW4gYWNjb3VudCBpZFwiKVxuICAgIGlmICghTnVtYmVyLmlzU2FmZUludGVnZXIobWF4Qnl0ZXMpIHx8IG1heEJ5dGVzIDwgMCkgdGhyb3cgbmV3IEVycm9yKFwiU3luY2hyb25pemVkIGFzc2V0IGNhY2hlIG1heEJ5dGVzIG11c3QgYmUgYSBub24tbmVnYXRpdmUgc2FmZSBpbnRlZ2VyXCIpXG4gICAgaWYgKCFOdW1iZXIuaXNTYWZlSW50ZWdlcihyZXRyeUJhc2VEZWxheU1zKSB8fCByZXRyeUJhc2VEZWxheU1zIDwgMSkgdGhyb3cgbmV3IEVycm9yKFwiU3luY2hyb25pemVkIGFzc2V0IGNhY2hlIHJldHJ5QmFzZURlbGF5TXMgbXVzdCBiZSBhIHBvc2l0aXZlIHNhZmUgaW50ZWdlclwiKVxuICAgIGlmICghTnVtYmVyLmlzU2FmZUludGVnZXIocmV0cnlNYXhEZWxheU1zKSB8fCByZXRyeU1heERlbGF5TXMgPCByZXRyeUJhc2VEZWxheU1zKSB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jaHJvbml6ZWQgYXNzZXQgY2FjaGUgcmV0cnlNYXhEZWxheU1zIG11c3QgYmUgYXQgbGVhc3QgcmV0cnlCYXNlRGVsYXlNc1wiKVxuXG4gICAgdGhpcy5hY2NvdW50SWQgPSBhY2NvdW50SWRcbiAgICB0aGlzLmFkYXB0ZXIgPSBhZGFwdGVyXG4gICAgdGhpcy5kb3dubG9hZCA9IGRvd25sb2FkXG4gICAgdGhpcy5tYXhCeXRlcyA9IG1heEJ5dGVzXG4gICAgdGhpcy5ub3cgPSBub3dcbiAgICB0aGlzLnJldHJ5QmFzZURlbGF5TXMgPSByZXRyeUJhc2VEZWxheU1zXG4gICAgdGhpcy5yZXRyeU1heERlbGF5TXMgPSByZXRyeU1heERlbGF5TXNcbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIG51bWJlcj59ICovXG4gICAgdGhpcy5hY3RpdmVEaWdlc3RDb3VudHMgPSBuZXcgTWFwKClcbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIFByb21pc2U8dm9pZD4+fSAqL1xuICAgIHRoaXMuZGVsZXRpb25Qcm9taXNlcyA9IG5ldyBNYXAoKVxuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgUHJvbWlzZTx7ZXJyb3I6IEVycm9yLCB1cmk6IG51bGx9IHwge2Vycm9yOiBudWxsLCB1cmk6IHN0cmluZ30+Pn0gKi9cbiAgICB0aGlzLmRvd25sb2FkUHJvbWlzZXMgPSBuZXcgTWFwKClcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZVN0YXRlIHwgbnVsbH0gKi9cbiAgICB0aGlzLnN0YXRlID0gbnVsbFxuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVTdGF0ZT4gfCBudWxsfSAqL1xuICAgIHRoaXMuc3RhdGVQcm9taXNlID0gbnVsbFxuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPn0gKi9cbiAgICB0aGlzLnNhdmVTdGF0ZVByb21pc2UgPSBQcm9taXNlLnJlc29sdmUoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlY29uY2lsZXMgdGhlIGltbXV0YWJsZSBkZXNjcmlwdG9ycyBmb3Igb25lIHN5bmNocm9uaXplZCBzY29wZSBhbmRcbiAgICogZG93bmxvYWRzIGVsaWdpYmxlIGVhZ2VyIGFzc2V0cy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgUmVjb25jaWxpYXRpb24gaW5wdXRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZURlc2NyaXB0b3JbXX0gYXJncy5kZXNjcmlwdG9ycyBDdXJyZW50IGRlc2NyaXB0b3JzIGluIHRoZSBzY29wZS5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLm9ubGluZSBXaGV0aGVyIGF1dGhlbnRpY2F0ZWQgZG93bmxvYWRzIGFyZSBhdmFpbGFibGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnNjb3BlS2V5IFN0YWJsZSBzeW5jaHJvbml6ZWQgc2NvcGUga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVTeW5jaHJvbml6YXRpb25SZXN1bHQ+fSBTeW5jaHJvbml6YXRpb24gcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgc3luY2hyb25pemUoe2Rlc2NyaXB0b3JzLCBvbmxpbmUsIHNjb3BlS2V5fSkge1xuICAgIGF3YWl0IHRoaXMubG9hZFN0YXRlKClcbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIGltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZURlc2NyaXB0b3JbXT59ICovXG4gICAgY29uc3QgZGVzY3JpcHRvcnNCeURpZ2VzdCA9IG5ldyBNYXAoKVxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlRmFpbHVyZVtdfSAqL1xuICAgIGNvbnN0IGZhaWx1cmVzID0gW11cbiAgICAvKiogQHR5cGUge1NldDxzdHJpbmc+fSAqL1xuICAgIGNvbnN0IGFjdGl2ZURpZ2VzdHMgPSBuZXcgU2V0KClcblxuICAgIGZvciAoY29uc3QgZGVzY3JpcHRvciBvZiBkZXNjcmlwdG9ycykge1xuICAgICAgY29uc3QgZGlnZXN0RGVzY3JpcHRvcnMgPSBkZXNjcmlwdG9yc0J5RGlnZXN0LmdldChkZXNjcmlwdG9yLmRpZ2VzdCkgfHwgW11cblxuICAgICAgZGlnZXN0RGVzY3JpcHRvcnMucHVzaChkZXNjcmlwdG9yKVxuICAgICAgZGVzY3JpcHRvcnNCeURpZ2VzdC5zZXQoZGVzY3JpcHRvci5kaWdlc3QsIGRpZ2VzdERlc2NyaXB0b3JzKVxuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBmb3IgKGNvbnN0IGRpZ2VzdCBvZiBkZXNjcmlwdG9yc0J5RGlnZXN0LmtleXMoKSkge1xuICAgICAgICBhd2FpdCB0aGlzLmJlZ2luQWN0aXZlRGlnZXN0KGRpZ2VzdClcbiAgICAgICAgYWN0aXZlRGlnZXN0cy5hZGQoZGlnZXN0KVxuICAgICAgfVxuXG4gICAgICBjb25zdCBlbnRyaWVzQnlJZCA9IGF3YWl0IHRoaXMucmVjb25jaWxlRGVzY3JpcHRvcnMoe2Rlc2NyaXB0b3JzLCBzY29wZUtleX0pXG5cbiAgICAgIGF3YWl0IHRoaXMuZGVsZXRlVW5yZWZlcmVuY2VkRGlnZXN0cygpXG5cbiAgICAgIGZvciAoY29uc3QgW2RpZ2VzdCwgZGlnZXN0RGVzY3JpcHRvcnNdIG9mIGRlc2NyaXB0b3JzQnlEaWdlc3QpIHtcbiAgICAgICAgY29uc3QgZWFnZXJEZXNjcmlwdG9ycyA9IG9ubGluZSA/IGRpZ2VzdERlc2NyaXB0b3JzLmZpbHRlcigoZGVzY3JpcHRvcikgPT4gZGVzY3JpcHRvci5mZXRjaCA9PT0gXCJlYWdlclwiKSA6IFtdXG5cbiAgICAgICAgaWYgKGVhZ2VyRGVzY3JpcHRvcnMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgYWN0aXZlRGlnZXN0cy5kZWxldGUoZGlnZXN0KVxuICAgICAgICAgIGF3YWl0IHRoaXMuZmluaXNoQWN0aXZlRGlnZXN0KGRpZ2VzdClcbiAgICAgICAgICBjb250aW51ZVxuICAgICAgICB9XG5cbiAgICAgICAgZm9yIChjb25zdCBkZXNjcmlwdG9yIG9mIGVhZ2VyRGVzY3JpcHRvcnMpIHtcbiAgICAgICAgICBjb25zdCBlbnRyeSA9IGVudHJpZXNCeUlkLmdldChkZXNjcmlwdG9yLmlkKVxuXG4gICAgICAgICAgaWYgKCFlbnRyeSB8fCAhdGhpcy5yZXRyeUVsaWdpYmxlKGVudHJ5KSkgY29udGludWVcblxuICAgICAgICAgIGNvbnN0IGNhY2hlUmVzdWx0ID0gYXdhaXQgdGhpcy5lbnN1cmVDYWNoZWRXaGlsZUFjdGl2ZShlbnRyeSlcblxuICAgICAgICAgIGlmIChjYWNoZVJlc3VsdC5lcnJvcikgZmFpbHVyZXMucHVzaCh7YXNzZXRJZDogZGVzY3JpcHRvci5pZCwgZXJyb3I6IGNhY2hlUmVzdWx0LmVycm9yfSlcbiAgICAgICAgfVxuXG4gICAgICAgIGFjdGl2ZURpZ2VzdHMuZGVsZXRlKGRpZ2VzdClcbiAgICAgICAgYXdhaXQgdGhpcy5maW5pc2hBY3RpdmVEaWdlc3QoZGlnZXN0KVxuICAgICAgICBhd2FpdCB0aGlzLmNsZWFudXAoKVxuICAgICAgfVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCB0aGlzLmZpbmlzaEFjdGl2ZURpZ2VzdHMoWy4uLmFjdGl2ZURpZ2VzdHNdKVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuY2xlYW51cCgpXG5cbiAgICByZXR1cm4ge1xuICAgICAgZmFpbHVyZXMsXG4gICAgICBtaXNzaW5nUmVxdWlyZWRBc3NldElkczogYXdhaXQgdGhpcy5taXNzaW5nUmVxdWlyZWRBc3NldElkcyhzY29wZUtleSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYSBjYWNoZWQgYXNzZXQgVVJJLCBkb3dubG9hZGluZyBpdCBvbiBkZW1hbmQgd2hlbiBhbGxvd2VkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyBSZXNvbHV0aW9uIGlucHV0cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuYXNzZXRJZCBBdHRhY2htZW50IGRlc2NyaXB0b3IgaWQuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5vbmxpbmUgV2hldGhlciBhdXRoZW50aWNhdGVkIGRvd25sb2FkcyBhcmUgYXZhaWxhYmxlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmcgfCBudWxsPn0gQ2FjaGVkIGFzc2V0IFVSSS5cbiAgICovXG4gIGFzeW5jIHJlc29sdmUoe2Fzc2V0SWQsIG9ubGluZX0pIHtcbiAgICBjb25zdCBzdGF0ZSA9IGF3YWl0IHRoaXMubG9hZFN0YXRlKClcbiAgICBjb25zdCBlbnRyeSA9IHN0YXRlLmFzc2V0cy5maW5kKChjYW5kaWRhdGUpID0+IGNhbmRpZGF0ZS5kZXNjcmlwdG9yLmlkID09PSBhc3NldElkKVxuXG4gICAgaWYgKCFlbnRyeSkgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IGRpZ2VzdCA9IGVudHJ5LmRlc2NyaXB0b3IuZGlnZXN0XG4gICAgbGV0IHJlc29sdmVkVXJpID0gbnVsbFxuXG4gICAgYXdhaXQgdGhpcy5iZWdpbkFjdGl2ZURpZ2VzdChkaWdlc3QpXG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgY2FjaGVkVXJpID0gYXdhaXQgdGhpcy5jYWNoZWRVcmlXaGlsZUFjdGl2ZShlbnRyeSlcblxuICAgICAgaWYgKGNhY2hlZFVyaSkge1xuICAgICAgICBlbnRyeS5sYXN0QWNjZXNzZWRBdCA9IHRoaXMubm93TWlsbGlzZWNvbmRzKClcbiAgICAgICAgZW50cnkuc3RhdHVzID0gXCJjYWNoZWRcIlxuICAgICAgICBhd2FpdCB0aGlzLnNhdmVTdGF0ZSgpXG5cbiAgICAgICAgcmVzb2x2ZWRVcmkgPSBjYWNoZWRVcmlcbiAgICAgIH0gZWxzZSBpZiAob25saW5lICYmIHRoaXMucmV0cnlFbGlnaWJsZShlbnRyeSkpIHtcbiAgICAgICAgY29uc3QgY2FjaGVSZXN1bHQgPSBhd2FpdCB0aGlzLmVuc3VyZUNhY2hlZFdoaWxlQWN0aXZlKGVudHJ5KVxuXG4gICAgICAgIGlmIChjYWNoZVJlc3VsdC5lcnJvcikgdGhyb3cgY2FjaGVSZXN1bHQuZXJyb3JcblxuICAgICAgICBpZiAoY2FjaGVSZXN1bHQudXJpKSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5jbGVhbnVwKG5ldyBTZXQoW2RpZ2VzdF0pKVxuXG4gICAgICAgICAgcmVzb2x2ZWRVcmkgPSBjYWNoZVJlc3VsdC51cmlcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCB0aGlzLmZpbmlzaEFjdGl2ZURpZ2VzdChkaWdlc3QpXG4gICAgfVxuXG4gICAgaWYgKCFyZXNvbHZlZFVyaSkgcmV0dXJuIG51bGxcbiAgICBpZiAoIXN0YXRlLmFzc2V0cy5zb21lKChjYW5kaWRhdGUpID0+IGNhbmRpZGF0ZS5kZXNjcmlwdG9yLmlkID09PSBhc3NldElkICYmIGNhbmRpZGF0ZS5kZXNjcmlwdG9yLmRpZ2VzdCA9PT0gZGlnZXN0KSkgcmV0dXJuIG51bGxcblxuICAgIHJldHVybiByZXNvbHZlZFVyaVxuICB9XG5cbiAgLyoqXG4gICAqIEV2aWN0cyBsZWFzdC1yZWNlbnRseS11c2VkIGJsb2JzIHVudGlsIHRoZSB1bmlxdWUgY2FjaGVkIGJ5dGUgdG90YWwgaXNcbiAgICogd2l0aGluIHRoZSBjb25maWd1cmVkIGJ1ZGdldC4gQSBibG9iIHN0YXlzIGR1cmFibGUgd2hlbiBhbnkgbGl2ZVxuICAgKiBkZXNjcmlwdG9yIHJlZmVyZW5jZSBkZWNsYXJlcyBkdXJhYmxlIHJldGVudGlvbi5cbiAgICogQHBhcmFtIHtTZXQ8c3RyaW5nPn0gW3Byb3RlY3RlZERpZ2VzdHNdIERpZ2VzdHMgbmVlZGVkIGJ5IHRoZSBhY3RpdmUgY2FsbGVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSBCeXRlcyByZW1vdmVkLlxuICAgKi9cbiAgYXN5bmMgY2xlYW51cChwcm90ZWN0ZWREaWdlc3RzID0gbmV3IFNldCgpKSB7XG4gICAgY29uc3Qgc3RhdGUgPSBhd2FpdCB0aGlzLmxvYWRTdGF0ZSgpXG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVFbnRyeVtdPn0gKi9cbiAgICBjb25zdCBlbnRyaWVzQnlEaWdlc3QgPSBuZXcgTWFwKClcblxuICAgIGZvciAoY29uc3QgZW50cnkgb2Ygc3RhdGUuYXNzZXRzKSB7XG4gICAgICBjb25zdCBkaWdlc3RFbnRyaWVzID0gZW50cmllc0J5RGlnZXN0LmdldChlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdCkgfHwgW11cblxuICAgICAgZGlnZXN0RW50cmllcy5wdXNoKGVudHJ5KVxuICAgICAgZW50cmllc0J5RGlnZXN0LnNldChlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdCwgZGlnZXN0RW50cmllcylcbiAgICB9XG5cbiAgICAvKiogQHR5cGUge3tieXRlU2l6ZTogbnVtYmVyLCBkaWdlc3Q6IHN0cmluZywgbGFzdEFjY2Vzc2VkQXQ6IG51bWJlcn1bXX0gKi9cbiAgICBjb25zdCBjYWNoZWRCbG9icyA9IFtdXG4gICAgbGV0IGNhY2hlZEJ5dGVzID0gMFxuXG4gICAgZm9yIChjb25zdCBbZGlnZXN0LCByZWZlcmVuY2VzXSBvZiBlbnRyaWVzQnlEaWdlc3QpIHtcbiAgICAgIGNvbnN0IHVyaSA9IGF3YWl0IHRoaXMuYWRhcHRlci5ibG9iVXJpKHthY2NvdW50SWQ6IHRoaXMuYWNjb3VudElkLCBkaWdlc3R9KVxuXG4gICAgICBpZiAoIXVyaSkge1xuICAgICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHJlZmVyZW5jZXMpIHtcbiAgICAgICAgICBpZiAoZW50cnkuc3RhdHVzID09PSBcImNhY2hlZFwiKSBlbnRyeS5zdGF0dXMgPSBcIm1pc3NpbmdcIlxuICAgICAgICB9XG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGJ5dGVTaXplID0gcmVmZXJlbmNlc1swXS5kZXNjcmlwdG9yLmJ5dGVTaXplXG5cbiAgICAgIGNhY2hlZEJ5dGVzICs9IGJ5dGVTaXplXG4gICAgICBjYWNoZWRCbG9icy5wdXNoKHtcbiAgICAgICAgYnl0ZVNpemUsXG4gICAgICAgIGRpZ2VzdCxcbiAgICAgICAgbGFzdEFjY2Vzc2VkQXQ6IE1hdGgubWF4KC4uLnJlZmVyZW5jZXMubWFwKChlbnRyeSkgPT4gZW50cnkubGFzdEFjY2Vzc2VkQXQpKVxuICAgICAgfSlcbiAgICB9XG5cbiAgICBsZXQgcmVtb3ZlZEJ5dGVzID0gMFxuXG4gICAgd2hpbGUgKGNhY2hlZEJsb2JzLmxlbmd0aCA+IDApIHtcbiAgICAgIGlmIChjYWNoZWRCeXRlcyA8PSB0aGlzLm1heEJ5dGVzKSBicmVha1xuXG4gICAgICBmb3IgKGNvbnN0IGNhY2hlZEJsb2Igb2YgY2FjaGVkQmxvYnMpIHtcbiAgICAgICAgY29uc3QgY3VycmVudFJlZmVyZW5jZXMgPSBzdGF0ZS5hc3NldHMuZmlsdGVyKChlbnRyeSkgPT4gZW50cnkuZGVzY3JpcHRvci5kaWdlc3QgPT09IGNhY2hlZEJsb2IuZGlnZXN0KVxuXG4gICAgICAgIGlmIChjdXJyZW50UmVmZXJlbmNlcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgY2FjaGVkQmxvYi5sYXN0QWNjZXNzZWRBdCA9IE1hdGgubWF4KC4uLmN1cnJlbnRSZWZlcmVuY2VzLm1hcCgoZW50cnkpID0+IGVudHJ5Lmxhc3RBY2Nlc3NlZEF0KSlcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBjYWNoZWRCbG9icy5zb3J0KChsZWZ0LCByaWdodCkgPT4gbGVmdC5sYXN0QWNjZXNzZWRBdCAtIHJpZ2h0Lmxhc3RBY2Nlc3NlZEF0IHx8IGxlZnQuZGlnZXN0LmxvY2FsZUNvbXBhcmUocmlnaHQuZGlnZXN0KSlcblxuICAgICAgY29uc3QgYmxvYiA9IGNhY2hlZEJsb2JzLnNoaWZ0KClcblxuICAgICAgaWYgKCFibG9iKSB0aHJvdyBuZXcgRXJyb3IoXCJFeHBlY3RlZCBhIHN5bmNocm9uaXplZCBhc3NldCBjYWNoZSBldmljdGlvbiBjYW5kaWRhdGVcIilcbiAgICAgIGlmIChwcm90ZWN0ZWREaWdlc3RzLmhhcyhibG9iLmRpZ2VzdCkpIGNvbnRpbnVlXG4gICAgICBsZXQgYmxvYldhc0FscmVhZHlNaXNzaW5nID0gZmFsc2VcbiAgICAgIGNvbnN0IGRlbGV0ZWQgPSBhd2FpdCB0aGlzLmRlbGV0ZURpZ2VzdElmSW5hY3RpdmUoYmxvYi5kaWdlc3QsIGFzeW5jICgpID0+IHtcbiAgICAgICAgaWYgKCF0aGlzLnN0YXRlKSB0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3QgY2xlYW4gc3luY2hyb25pemVkIGFzc2V0IGJsb2JzIGJlZm9yZSBsb2FkaW5nIHN0YXRlXCIpXG5cbiAgICAgICAgY29uc3QgY3VycmVudFVyaSA9IGF3YWl0IHRoaXMuYWRhcHRlci5ibG9iVXJpKHthY2NvdW50SWQ6IHRoaXMuYWNjb3VudElkLCBkaWdlc3Q6IGJsb2IuZGlnZXN0fSlcbiAgICAgICAgY29uc3QgY3VycmVudFJlZmVyZW5jZXMgPSB0aGlzLnN0YXRlLmFzc2V0cy5maWx0ZXIoKGVudHJ5KSA9PiBlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdCA9PT0gYmxvYi5kaWdlc3QpXG5cbiAgICAgICAgaWYgKCFjdXJyZW50VXJpKSB7XG4gICAgICAgICAgYmxvYldhc0FscmVhZHlNaXNzaW5nID0gdHJ1ZVxuXG4gICAgICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiBjdXJyZW50UmVmZXJlbmNlcykge1xuICAgICAgICAgICAgaWYgKGVudHJ5LnN0YXR1cyA9PT0gXCJjYWNoZWRcIikgZW50cnkuc3RhdHVzID0gXCJtaXNzaW5nXCJcbiAgICAgICAgICB9XG5cbiAgICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgICAgfVxuICAgICAgICBpZiAoY3VycmVudFJlZmVyZW5jZXMuc29tZSgoZW50cnkpID0+IGVudHJ5LmRlc2NyaXB0b3IucmV0ZW50aW9uID09PSBcImR1cmFibGVcIikpIHJldHVybiBmYWxzZVxuXG4gICAgICAgIGF3YWl0IHRoaXMuYWRhcHRlci5kZWxldGVCbG9iKHthY2NvdW50SWQ6IHRoaXMuYWNjb3VudElkLCBkaWdlc3Q6IGJsb2IuZGlnZXN0fSlcblxuICAgICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGN1cnJlbnRSZWZlcmVuY2VzKSB7XG4gICAgICAgICAgZW50cnkuYXR0ZW1wdHMgPSAwXG4gICAgICAgICAgZW50cnkubmV4dFJldHJ5QXQgPSBudWxsXG4gICAgICAgICAgZW50cnkuc3RhdHVzID0gXCJtaXNzaW5nXCJcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB0cnVlXG4gICAgICB9KVxuXG4gICAgICBpZiAoYmxvYldhc0FscmVhZHlNaXNzaW5nKSBjYWNoZWRCeXRlcyAtPSBibG9iLmJ5dGVTaXplXG4gICAgICBpZiAoIWRlbGV0ZWQpIGNvbnRpbnVlXG5cbiAgICAgIGNhY2hlZEJ5dGVzIC09IGJsb2IuYnl0ZVNpemVcbiAgICAgIHJlbW92ZWRCeXRlcyArPSBibG9iLmJ5dGVTaXplXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5zYXZlU3RhdGUoKVxuXG4gICAgcmV0dXJuIHJlbW92ZWRCeXRlc1xuICB9XG5cbiAgLyoqXG4gICAqIExvYWRzIGNhY2hlIHN0YXRlIG9uY2UgZm9yIHRoaXMgY2FjaGUgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZVN0YXRlPn0gTG9hZGVkIHN0YXRlLlxuICAgKi9cbiAgYXN5bmMgbG9hZFN0YXRlKCkge1xuICAgIGlmICh0aGlzLnN0YXRlKSByZXR1cm4gdGhpcy5zdGF0ZVxuICAgIGlmICh0aGlzLnN0YXRlUHJvbWlzZSkgcmV0dXJuIGF3YWl0IHRoaXMuc3RhdGVQcm9taXNlXG5cbiAgICB0aGlzLnN0YXRlUHJvbWlzZSA9IHRoaXMubG9hZFN0YXRlRnJvbUFkYXB0ZXIoKVxuXG4gICAgdHJ5IHtcbiAgICAgIHRoaXMuc3RhdGUgPSBhd2FpdCB0aGlzLnN0YXRlUHJvbWlzZVxuXG4gICAgICByZXR1cm4gdGhpcy5zdGF0ZVxuICAgIH0gZmluYWxseSB7XG4gICAgICB0aGlzLnN0YXRlUHJvbWlzZSA9IG51bGxcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogTG9hZHMgYW5kIHJlY292ZXJzIHBlcnNpc3RlZCBjYWNoZSBzdGF0ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlU3RhdGU+fSBMb2FkZWQgc3RhdGUuXG4gICAqL1xuICBhc3luYyBsb2FkU3RhdGVGcm9tQWRhcHRlcigpIHtcbiAgICBjb25zdCBsb2FkZWRTdGF0ZSA9IGF3YWl0IHRoaXMuYWRhcHRlci5sb2FkU3RhdGUoe2FjY291bnRJZDogdGhpcy5hY2NvdW50SWR9KVxuXG4gICAgaWYgKCFsb2FkZWRTdGF0ZSkgcmV0dXJuIHthc3NldHM6IFtdLCBwZW5kaW5nRGVsZXRpb25EaWdlc3RzOiBbXSwgdmVyc2lvbjogQ0FDSEVfU1RBVEVfVkVSU0lPTn1cbiAgICBpZiAobG9hZGVkU3RhdGUudmVyc2lvbiAhPT0gQ0FDSEVfU1RBVEVfVkVSU0lPTikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbnN1cHBvcnRlZCBzeW5jaHJvbml6ZWQgYXNzZXQgY2FjaGUgc3RhdGUgdmVyc2lvbjogJHtsb2FkZWRTdGF0ZS52ZXJzaW9ufWApXG4gICAgfVxuXG4gICAgbGV0IHJlY292ZXJlZEludGVycnVwdGVkRG93bmxvYWQgPSBmYWxzZVxuXG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiBsb2FkZWRTdGF0ZS5hc3NldHMpIHtcbiAgICAgIGlmIChlbnRyeS5zdGF0dXMgIT09IFwiZG93bmxvYWRpbmdcIikgY29udGludWVcblxuICAgICAgZW50cnkuYXR0ZW1wdHMgKz0gMVxuICAgICAgZW50cnkubmV4dFJldHJ5QXQgPSB0aGlzLm5vd01pbGxpc2Vjb25kcygpXG4gICAgICBlbnRyeS5zdGF0dXMgPSBcImZhaWxlZFwiXG4gICAgICByZWNvdmVyZWRJbnRlcnJ1cHRlZERvd25sb2FkID0gdHJ1ZVxuICAgIH1cblxuICAgIGlmIChyZWNvdmVyZWRJbnRlcnJ1cHRlZERvd25sb2FkKSB7XG4gICAgICBhd2FpdCB0aGlzLmFkYXB0ZXIuc2F2ZVN0YXRlKHthY2NvdW50SWQ6IHRoaXMuYWNjb3VudElkLCBzdGF0ZTogbG9hZGVkU3RhdGV9KVxuICAgIH1cblxuICAgIHJldHVybiBsb2FkZWRTdGF0ZVxuICB9XG5cbiAgLyoqXG4gICAqIFBlcnNpc3RzIHRoZSBjdXJyZW50IGNhY2hlIHN0YXRlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgYWZ0ZXIgc3RhdGUgcGVyc2lzdGVuY2UuXG4gICAqL1xuICBhc3luYyBzYXZlU3RhdGUoKSB7XG4gICAgaWYgKCF0aGlzLnN0YXRlKSB0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3Qgc2F2ZSBzeW5jaHJvbml6ZWQgYXNzZXQgY2FjaGUgYmVmb3JlIGxvYWRpbmcgc3RhdGVcIilcblxuICAgIGNvbnN0IHBlcnNpc3QgPSBhc3luYyAoKSA9PiB7XG4gICAgICBpZiAoIXRoaXMuc3RhdGUpIHRocm93IG5ldyBFcnJvcihcIkNhbm5vdCBzYXZlIHN5bmNocm9uaXplZCBhc3NldCBjYWNoZSBiZWZvcmUgbG9hZGluZyBzdGF0ZVwiKVxuXG4gICAgICBhd2FpdCB0aGlzLmFkYXB0ZXIuc2F2ZVN0YXRlKHthY2NvdW50SWQ6IHRoaXMuYWNjb3VudElkLCBzdGF0ZTogdGhpcy5zdGF0ZX0pXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5zZXJpYWxpemVTdGF0ZVBlcnNpc3RlbmNlKHBlcnNpc3QpXG4gIH1cblxuICAvKipcbiAgICogUGVyc2lzdHMgYSBkZXRhY2hlZCByZWNvbmNpbGlhdGlvbiBiZWZvcmUgZXhwb3NpbmcgaXQgdGhyb3VnaCBzaGFyZWQgc3RhdGUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIFJlY29uY2lsaWF0aW9uIGlucHV0cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVEZXNjcmlwdG9yW119IGFyZ3MuZGVzY3JpcHRvcnMgQ3VycmVudCBkZXNjcmlwdG9ycyBpbiB0aGUgc2NvcGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnNjb3BlS2V5IFN0YWJsZSBzeW5jaHJvbml6ZWQgc2NvcGUga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxNYXA8c3RyaW5nLCBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVFbnRyeT4+fSBSZWNvbmNpbGVkIGxpdmUgZW50cmllcyBieSBpZC5cbiAgICovXG4gIGFzeW5jIHJlY29uY2lsZURlc2NyaXB0b3JzKHtkZXNjcmlwdG9ycywgc2NvcGVLZXl9KSB7XG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVFbnRyeT4gfCBudWxsfSAqL1xuICAgIGxldCBlbnRyaWVzQnlJZCA9IG51bGxcblxuICAgIGNvbnN0IHBlcnNpc3QgPSBhc3luYyAoKSA9PiB7XG4gICAgICBpZiAoIXRoaXMuc3RhdGUpIHRocm93IG5ldyBFcnJvcihcIkNhbm5vdCByZWNvbmNpbGUgc3luY2hyb25pemVkIGFzc2V0IGNhY2hlIGJlZm9yZSBsb2FkaW5nIHN0YXRlXCIpXG5cbiAgICAgIGNvbnN0IGNhbmRpZGF0ZVN0YXRlID0gdGhpcy5jb3B5U3RhdGUodGhpcy5zdGF0ZSlcbiAgICAgIGNvbnN0IG5ld0VudHJ5TGFzdEFjY2Vzc2VkQXQgPSB0aGlzLm5vd01pbGxpc2Vjb25kcygpXG5cbiAgICAgIHRoaXMuYXBwbHlEZXNjcmlwdG9yUmVjb25jaWxpYXRpb24oe2Rlc2NyaXB0b3JzLCBuZXdFbnRyeUxhc3RBY2Nlc3NlZEF0LCBzY29wZUtleSwgc3RhdGU6IGNhbmRpZGF0ZVN0YXRlfSlcbiAgICAgIGF3YWl0IHRoaXMuYWRhcHRlci5zYXZlU3RhdGUoe2FjY291bnRJZDogdGhpcy5hY2NvdW50SWQsIHN0YXRlOiBjYW5kaWRhdGVTdGF0ZX0pXG4gICAgICBlbnRyaWVzQnlJZCA9IHRoaXMuYXBwbHlEZXNjcmlwdG9yUmVjb25jaWxpYXRpb24oe2Rlc2NyaXB0b3JzLCBuZXdFbnRyeUxhc3RBY2Nlc3NlZEF0LCBzY29wZUtleSwgc3RhdGU6IHRoaXMuc3RhdGV9KVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuc2VyaWFsaXplU3RhdGVQZXJzaXN0ZW5jZShwZXJzaXN0KVxuXG4gICAgaWYgKCFlbnRyaWVzQnlJZCkgdGhyb3cgbmV3IEVycm9yKFwiU3luY2hyb25pemVkIGFzc2V0IGRlc2NyaXB0b3IgcmVjb25jaWxpYXRpb24gY29tcGxldGVkIHdpdGhvdXQgbGl2ZSBlbnRyaWVzXCIpXG5cbiAgICByZXR1cm4gZW50cmllc0J5SWRcbiAgfVxuXG4gIC8qKlxuICAgKiBBcHBsaWVzIG9uZSBzY29wZSdzIGRlc2NyaXB0b3Igc2V0IHRvIGNhY2hlIHN0YXRlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyBSZWNvbmNpbGlhdGlvbiBpbnB1dHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlRGVzY3JpcHRvcltdfSBhcmdzLmRlc2NyaXB0b3JzIEN1cnJlbnQgZGVzY3JpcHRvcnMgaW4gdGhlIHNjb3BlLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXJncy5uZXdFbnRyeUxhc3RBY2Nlc3NlZEF0IEluaXRpYWwgTFJVIHRpbWVzdGFtcCBmb3IgbmV3IGVudHJpZXMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnNjb3BlS2V5IFN0YWJsZSBzeW5jaHJvbml6ZWQgc2NvcGUga2V5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZVN0YXRlfSBhcmdzLnN0YXRlIFN0YXRlIHRvIHJlY29uY2lsZS5cbiAgICogQHJldHVybnMge01hcDxzdHJpbmcsIGltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZUVudHJ5Pn0gTGl2ZSBlbnRyaWVzIGJ5IGlkLlxuICAgKi9cbiAgYXBwbHlEZXNjcmlwdG9yUmVjb25jaWxpYXRpb24oe2Rlc2NyaXB0b3JzLCBuZXdFbnRyeUxhc3RBY2Nlc3NlZEF0LCBzY29wZUtleSwgc3RhdGV9KSB7XG4gICAgY29uc3QgaW5jb21pbmdJZHMgPSBuZXcgU2V0KGRlc2NyaXB0b3JzLm1hcCgoYXNzZXQpID0+IGFzc2V0LmlkKSlcbiAgICBjb25zdCBlbnRyaWVzQnlJZCA9IG5ldyBNYXAoc3RhdGUuYXNzZXRzLm1hcCgoZW50cnkpID0+IFtlbnRyeS5kZXNjcmlwdG9yLmlkLCBlbnRyeV0pKVxuICAgIGNvbnN0IGRpZ2VzdHNCeUlkID0gbmV3IE1hcChzdGF0ZS5hc3NldHMubWFwKChlbnRyeSkgPT4gW2VudHJ5LmRlc2NyaXB0b3IuaWQsIGVudHJ5LmRlc2NyaXB0b3IuZGlnZXN0XSkpXG4gICAgY29uc3QgcmVtb3ZlZERpZ2VzdHMgPSBuZXcgU2V0KClcblxuICAgIGZvciAoY29uc3QgYXNzZXQgb2YgZGVzY3JpcHRvcnMpIHtcbiAgICAgIGNvbnN0IGtub3duRGlnZXN0ID0gZGlnZXN0c0J5SWQuZ2V0KGFzc2V0LmlkKVxuXG4gICAgICBpZiAoa25vd25EaWdlc3QgIT09IHVuZGVmaW5lZCAmJiBrbm93bkRpZ2VzdCAhPT0gYXNzZXQuZGlnZXN0KSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgU3luY2hyb25pemVkIGFzc2V0IGRlc2NyaXB0b3IgJHthc3NldC5pZH0gY2hhbmdlZCBpdHMgaW1tdXRhYmxlIGRpZ2VzdGApXG4gICAgICB9XG5cbiAgICAgIGRpZ2VzdHNCeUlkLnNldChhc3NldC5pZCwgYXNzZXQuZGlnZXN0KVxuICAgIH1cblxuICAgIGZvciAoY29uc3QgZW50cnkgb2Ygc3RhdGUuYXNzZXRzKSB7XG4gICAgICBpZiAoIWVudHJ5LnNjb3BlS2V5cy5pbmNsdWRlcyhzY29wZUtleSkgfHwgaW5jb21pbmdJZHMuaGFzKGVudHJ5LmRlc2NyaXB0b3IuaWQpKSBjb250aW51ZVxuXG4gICAgICBlbnRyeS5zY29wZUtleXMgPSBlbnRyeS5zY29wZUtleXMuZmlsdGVyKChjYW5kaWRhdGUpID0+IGNhbmRpZGF0ZSAhPT0gc2NvcGVLZXkpXG4gICAgICBpZiAoZW50cnkuc2NvcGVLZXlzLmxlbmd0aCA9PT0gMCkgcmVtb3ZlZERpZ2VzdHMuYWRkKGVudHJ5LmRlc2NyaXB0b3IuZGlnZXN0KVxuICAgIH1cblxuICAgIHN0YXRlLmFzc2V0cyA9IHN0YXRlLmFzc2V0cy5maWx0ZXIoKGVudHJ5KSA9PiBlbnRyeS5zY29wZUtleXMubGVuZ3RoID4gMClcblxuICAgIGZvciAoY29uc3QgYXNzZXQgb2YgZGVzY3JpcHRvcnMpIHtcbiAgICAgIGNvbnN0IGV4aXN0aW5nID0gZW50cmllc0J5SWQuZ2V0KGFzc2V0LmlkKVxuXG4gICAgICBpZiAoZXhpc3RpbmcgJiYgc3RhdGUuYXNzZXRzLmluY2x1ZGVzKGV4aXN0aW5nKSkge1xuICAgICAgICBleGlzdGluZy5kZXNjcmlwdG9yID0gYXNzZXRcbiAgICAgICAgaWYgKCFleGlzdGluZy5zY29wZUtleXMuaW5jbHVkZXMoc2NvcGVLZXkpKSBleGlzdGluZy5zY29wZUtleXMucHVzaChzY29wZUtleSlcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnN0IG5ld0VudHJ5ID0ge1xuICAgICAgICAgIGF0dGVtcHRzOiAwLFxuICAgICAgICAgIGRlc2NyaXB0b3I6IGFzc2V0LFxuICAgICAgICAgIGxhc3RBY2Nlc3NlZEF0OiBuZXdFbnRyeUxhc3RBY2Nlc3NlZEF0LFxuICAgICAgICAgIG5leHRSZXRyeUF0OiBudWxsLFxuICAgICAgICAgIHNjb3BlS2V5czogW3Njb3BlS2V5XSxcbiAgICAgICAgICBzdGF0dXM6IC8qKiBAdHlwZSB7Y29uc3R9ICovIChcIm1pc3NpbmdcIilcbiAgICAgICAgfVxuXG4gICAgICAgIHN0YXRlLmFzc2V0cy5wdXNoKG5ld0VudHJ5KVxuICAgICAgICBlbnRyaWVzQnlJZC5zZXQoYXNzZXQuaWQsIG5ld0VudHJ5KVxuICAgICAgfVxuICAgIH1cblxuICAgIGZvciAoY29uc3QgZGlnZXN0IG9mIHJlbW92ZWREaWdlc3RzKSB7XG4gICAgICBpZiAoc3RhdGUuYXNzZXRzLnNvbWUoKGVudHJ5KSA9PiBlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdCA9PT0gZGlnZXN0KSkgY29udGludWVcbiAgICAgIGlmICghc3RhdGUucGVuZGluZ0RlbGV0aW9uRGlnZXN0cy5pbmNsdWRlcyhkaWdlc3QpKSBzdGF0ZS5wZW5kaW5nRGVsZXRpb25EaWdlc3RzLnB1c2goZGlnZXN0KVxuICAgIH1cblxuICAgIHJldHVybiBlbnRyaWVzQnlJZFxuICB9XG5cbiAgLyoqXG4gICAqIENvcGllcyBtZXRhZGF0YSBpbnRvIGEgZGV0YWNoZWQgcGVyc2lzdGVuY2UgY2FuZGlkYXRlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZVN0YXRlfSBzdGF0ZSBTdGF0ZSB0byBjb3B5LlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlU3RhdGV9IERldGFjaGVkIHN0YXRlLlxuICAgKi9cbiAgY29weVN0YXRlKHN0YXRlKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGFzc2V0czogc3RhdGUuYXNzZXRzLm1hcCgoZW50cnkpID0+ICh7XG4gICAgICAgIC4uLmVudHJ5LFxuICAgICAgICBkZXNjcmlwdG9yOiB7Li4uZW50cnkuZGVzY3JpcHRvcn0sXG4gICAgICAgIHNjb3BlS2V5czogWy4uLmVudHJ5LnNjb3BlS2V5c11cbiAgICAgIH0pKSxcbiAgICAgIHBlbmRpbmdEZWxldGlvbkRpZ2VzdHM6IFsuLi5zdGF0ZS5wZW5kaW5nRGVsZXRpb25EaWdlc3RzXSxcbiAgICAgIHZlcnNpb246IHN0YXRlLnZlcnNpb25cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogU2VyaWFsaXplcyBvbmUgbWV0YWRhdGEgcGVyc2lzdGVuY2Ugb3BlcmF0aW9uIGFmdGVyIHByaW9yIGZhaWx1cmVzIG9yIHN1Y2Nlc3Nlcy5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPHZvaWQ+fSBwZXJzaXN0IFBlcnNpc3RlbmNlIG9wZXJhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIGFmdGVyIHBlcnNpc3RlbmNlLlxuICAgKi9cbiAgYXN5bmMgc2VyaWFsaXplU3RhdGVQZXJzaXN0ZW5jZShwZXJzaXN0KSB7XG4gICAgdGhpcy5zYXZlU3RhdGVQcm9taXNlID0gdGhpcy5zYXZlU3RhdGVQcm9taXNlLnRoZW4ocGVyc2lzdCwgcGVyc2lzdClcblxuICAgIGF3YWl0IHRoaXMuc2F2ZVN0YXRlUHJvbWlzZVxuICB9XG5cbiAgLyoqXG4gICAqIEVuc3VyZXMgb25lIGRlc2NyaXB0b3IgaGFzIHZlcmlmaWVkIGxvY2FsIGJ5dGVzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZUVudHJ5fSBlbnRyeSBEZXNjcmlwdG9yIHN0YXRlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7ZXJyb3I6IEVycm9yIHwgbnVsbCwgdXJpOiBzdHJpbmcgfCBudWxsfT59IENhY2hlIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGVuc3VyZUNhY2hlZChlbnRyeSkge1xuICAgIGNvbnN0IGRpZ2VzdCA9IGVudHJ5LmRlc2NyaXB0b3IuZGlnZXN0XG5cbiAgICBhd2FpdCB0aGlzLmJlZ2luQWN0aXZlRGlnZXN0KGRpZ2VzdClcblxuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5lbnN1cmVDYWNoZWRXaGlsZUFjdGl2ZShlbnRyeSlcbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgdGhpcy5maW5pc2hBY3RpdmVEaWdlc3QoZGlnZXN0KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBvciBkb3dubG9hZHMgb25lIGRlc2NyaXB0b3Igd2hpbGUgaXRzIGRpZ2VzdCBpcyBwcm90ZWN0ZWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlRW50cnl9IGVudHJ5IERlc2NyaXB0b3Igc3RhdGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHtlcnJvcjogRXJyb3IgfCBudWxsLCB1cmk6IHN0cmluZyB8IG51bGx9Pn0gQ2FjaGUgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgZW5zdXJlQ2FjaGVkV2hpbGVBY3RpdmUoZW50cnkpIHtcbiAgICBjb25zdCBleGlzdGluZ1VyaSA9IGF3YWl0IHRoaXMuY2FjaGVkVXJpV2hpbGVBY3RpdmUoZW50cnkpXG5cbiAgICBpZiAoZXhpc3RpbmdVcmkpIHtcbiAgICAgIGVudHJ5LmF0dGVtcHRzID0gMFxuICAgICAgZW50cnkubGFzdEFjY2Vzc2VkQXQgPSB0aGlzLm5vd01pbGxpc2Vjb25kcygpXG4gICAgICBlbnRyeS5uZXh0UmV0cnlBdCA9IG51bGxcbiAgICAgIGVudHJ5LnN0YXR1cyA9IFwiY2FjaGVkXCJcbiAgICAgIGF3YWl0IHRoaXMuc2F2ZVN0YXRlKClcblxuICAgICAgcmV0dXJuIHtlcnJvcjogbnVsbCwgdXJpOiBleGlzdGluZ1VyaX1cbiAgICB9XG5cbiAgICBlbnRyeS5zdGF0dXMgPSBcImRvd25sb2FkaW5nXCJcbiAgICBjb25zdCBkaWdlc3QgPSBlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdFxuICAgIGxldCBkb3dubG9hZFByb21pc2UgPSB0aGlzLmRvd25sb2FkUHJvbWlzZXMuZ2V0KGRpZ2VzdClcbiAgICBsZXQgb3duc0Rvd25sb2FkUHJvbWlzZSA9IGZhbHNlXG5cbiAgICBpZiAoIWRvd25sb2FkUHJvbWlzZSkge1xuICAgICAgZG93bmxvYWRQcm9taXNlID0gdGhpcy5kb3dubG9hZEFmdGVyUGVyc2lzdGluZ1N0YXRlKGVudHJ5LmRlc2NyaXB0b3IpXG4gICAgICB0aGlzLmRvd25sb2FkUHJvbWlzZXMuc2V0KGRpZ2VzdCwgZG93bmxvYWRQcm9taXNlKVxuICAgICAgb3duc0Rvd25sb2FkUHJvbWlzZSA9IHRydWVcbiAgICB9IGVsc2Uge1xuICAgICAgYXdhaXQgdGhpcy5zYXZlU3RhdGUoKVxuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBjYWNoZVJlc3VsdCA9IGF3YWl0IGRvd25sb2FkUHJvbWlzZVxuXG4gICAgICBpZiAoY2FjaGVSZXN1bHQuZXJyb3IpIHtcbiAgICAgICAgaWYgKGVudHJ5LnN0YXR1cyA9PT0gXCJkb3dubG9hZGluZ1wiKSBhd2FpdCB0aGlzLnJlY29yZERvd25sb2FkRmFpbHVyZShkaWdlc3QpXG5cbiAgICAgICAgcmV0dXJuIGNhY2hlUmVzdWx0XG4gICAgICB9XG5cbiAgICAgIGVudHJ5LmF0dGVtcHRzID0gMFxuICAgICAgZW50cnkubGFzdEFjY2Vzc2VkQXQgPSB0aGlzLm5vd01pbGxpc2Vjb25kcygpXG4gICAgICBlbnRyeS5uZXh0UmV0cnlBdCA9IG51bGxcbiAgICAgIGVudHJ5LnN0YXR1cyA9IFwiY2FjaGVkXCJcbiAgICAgIGF3YWl0IHRoaXMuc2F2ZVN0YXRlKClcblxuICAgICAgcmV0dXJuIGNhY2hlUmVzdWx0XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGlmIChvd25zRG93bmxvYWRQcm9taXNlICYmIHRoaXMuZG93bmxvYWRQcm9taXNlcy5nZXQoZGlnZXN0KSA9PT0gZG93bmxvYWRQcm9taXNlKSB7XG4gICAgICAgIHRoaXMuZG93bmxvYWRQcm9taXNlcy5kZWxldGUoZGlnZXN0KVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBQZXJzaXN0cyBkb3dubG9hZCBpbnRlbnQsIHRoZW4gZG93bmxvYWRzIG9uZSBkaWdlc3QgYW5kIHJlY29yZHMgYSBzaGFyZWQgZmFpbHVyZSBvbmNlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZURlc2NyaXB0b3J9IGRlc2NyaXB0b3IgQXNzZXQgZGVzY3JpcHRvci5cbiAgICogQHJldHVybnMge1Byb21pc2U8e2Vycm9yOiBFcnJvciwgdXJpOiBudWxsfSB8IHtlcnJvcjogbnVsbCwgdXJpOiBzdHJpbmd9Pn0gU2hhcmVkIGNhY2hlIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGRvd25sb2FkQWZ0ZXJQZXJzaXN0aW5nU3RhdGUoZGVzY3JpcHRvcikge1xuICAgIGF3YWl0IHRoaXMuc2F2ZVN0YXRlKClcblxuICAgIHRyeSB7XG4gICAgICByZXR1cm4ge2Vycm9yOiBudWxsLCB1cmk6IGF3YWl0IHRoaXMuZG93bmxvYWRWZXJpZmllZChkZXNjcmlwdG9yKX1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc3QgZmFpbHVyZSA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKVxuXG4gICAgICBhd2FpdCB0aGlzLnJlY29yZERvd25sb2FkRmFpbHVyZShkZXNjcmlwdG9yLmRpZ2VzdClcblxuICAgICAgcmV0dXJuIHtlcnJvcjogZmFpbHVyZSwgdXJpOiBudWxsfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBBZHZhbmNlcyByZXRyeSBtZXRhZGF0YSBmb3IgZXZlcnkgbGl2ZSBkZXNjcmlwdG9yIHNoYXJpbmcgb25lIGZhaWxlZCBkaWdlc3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBkaWdlc3QgQ29udGVudCBkaWdlc3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyBhZnRlciBwZXJzaXN0ZW5jZS5cbiAgICovXG4gIGFzeW5jIHJlY29yZERvd25sb2FkRmFpbHVyZShkaWdlc3QpIHtcbiAgICBpZiAoIXRoaXMuc3RhdGUpIHRocm93IG5ldyBFcnJvcihcIkNhbm5vdCByZWNvcmQgc3luY2hyb25pemVkIGFzc2V0IGRvd25sb2FkIGZhaWx1cmUgYmVmb3JlIGxvYWRpbmcgc3RhdGVcIilcblxuICAgIGNvbnN0IGZhaWxlZEF0ID0gdGhpcy5ub3dNaWxsaXNlY29uZHMoKVxuXG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiB0aGlzLnN0YXRlLmFzc2V0cykge1xuICAgICAgaWYgKGVudHJ5LmRlc2NyaXB0b3IuZGlnZXN0ICE9PSBkaWdlc3QpIGNvbnRpbnVlXG4gICAgICBpZiAoZW50cnkuc3RhdHVzICE9PSBcImRvd25sb2FkaW5nXCIpIGNvbnRpbnVlXG5cbiAgICAgIGVudHJ5LmF0dGVtcHRzICs9IDFcbiAgICAgIGVudHJ5Lm5leHRSZXRyeUF0ID0gZmFpbGVkQXQgKyB0aGlzLnJldHJ5RGVsYXkoZW50cnkuYXR0ZW1wdHMpXG4gICAgICBlbnRyeS5zdGF0dXMgPSBcImZhaWxlZFwiXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5zYXZlU3RhdGUoKVxuICB9XG5cbiAgLyoqXG4gICAqIERvd25sb2FkcywgdmVyaWZpZXMsIGFuZCBhdG9taWNhbGx5IHBlcnNpc3RzIG9uZSBjb250ZW50IGRpZ2VzdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVEZXNjcmlwdG9yfSBkZXNjcmlwdG9yIEFzc2V0IGRlc2NyaXB0b3IuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IEFkYXB0ZXIgVVJJLlxuICAgKi9cbiAgYXN5bmMgZG93bmxvYWRWZXJpZmllZChkZXNjcmlwdG9yKSB7XG4gICAgY29uc3QgZG93bmxvYWRlZEJ5dGVzID0gYXdhaXQgdGhpcy5kb3dubG9hZChkZXNjcmlwdG9yKVxuXG4gICAgaWYgKCEoZG93bmxvYWRlZEJ5dGVzIGluc3RhbmNlb2YgVWludDhBcnJheSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgU3luY2hyb25pemVkIGFzc2V0ICR7ZGVzY3JpcHRvci5pZH0gZG93bmxvYWQgZGlkIG5vdCByZXR1cm4gVWludDhBcnJheSBieXRlc2ApXG4gICAgfVxuICAgIGlmIChkb3dubG9hZGVkQnl0ZXMuYnl0ZUxlbmd0aCAhPT0gZGVzY3JpcHRvci5ieXRlU2l6ZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBTeW5jaHJvbml6ZWQgYXNzZXQgJHtkZXNjcmlwdG9yLmlkfSBieXRlIHNpemUgZGlkIG5vdCBtYXRjaCBpdHMgZGVzY3JpcHRvcmApXG4gICAgfVxuXG4gICAgY29uc3QgZGlnZXN0ID0gYHNoYTI1Ni0ke3NoYTI1NkJ5dGVzSGV4KGRvd25sb2FkZWRCeXRlcyl9YFxuXG4gICAgaWYgKGRpZ2VzdCAhPT0gZGVzY3JpcHRvci5kaWdlc3QpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgU3luY2hyb25pemVkIGFzc2V0ICR7ZGVzY3JpcHRvci5pZH0gZGlnZXN0IGRpZCBub3QgbWF0Y2ggaXRzIGRlc2NyaXB0b3JgKVxuICAgIH1cblxuICAgIGNvbnN0IHVyaSA9IGF3YWl0IHRoaXMuYWRhcHRlci53cml0ZUJsb2Ioe1xuICAgICAgYWNjb3VudElkOiB0aGlzLmFjY291bnRJZCxcbiAgICAgIGJ5dGVzOiBkb3dubG9hZGVkQnl0ZXMsXG4gICAgICBjb250ZW50VHlwZTogZGVzY3JpcHRvci5jb250ZW50VHlwZSxcbiAgICAgIGRpZ2VzdFxuICAgIH0pXG5cbiAgICBpZiAoIXVyaSkgdGhyb3cgbmV3IEVycm9yKGBTeW5jaHJvbml6ZWQgYXNzZXQgYWRhcHRlciByZXR1cm5lZCBubyBVUkkgZm9yICR7ZGVzY3JpcHRvci5pZH1gKVxuXG4gICAgcmV0dXJuIHVyaVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGFuIGV4aXN0aW5nIGxvY2FsIFVSSSBhZnRlciB3YWl0aW5nIGZvciBkZWxldGlvbiB3b3JrLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZUVudHJ5fSBlbnRyeSBEZXNjcmlwdG9yIHN0YXRlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmcgfCBudWxsPn0gRXhpc3RpbmcgVVJJLlxuICAgKi9cbiAgYXN5bmMgY2FjaGVkVXJpKGVudHJ5KSB7XG4gICAgY29uc3QgZGlnZXN0ID0gZW50cnkuZGVzY3JpcHRvci5kaWdlc3RcblxuICAgIGF3YWl0IHRoaXMuYmVnaW5BY3RpdmVEaWdlc3QoZGlnZXN0KVxuXG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLmNhY2hlZFVyaVdoaWxlQWN0aXZlKGVudHJ5KVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCB0aGlzLmZpbmlzaEFjdGl2ZURpZ2VzdChkaWdlc3QpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGFuIGV4aXN0aW5nIGxvY2FsIFVSSSB3aGlsZSBpdHMgZGlnZXN0IGlzIHByb3RlY3RlZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVFbnRyeX0gZW50cnkgRGVzY3JpcHRvciBzdGF0ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nIHwgbnVsbD59IEV4aXN0aW5nIFVSSS5cbiAgICovXG4gIGFzeW5jIGNhY2hlZFVyaVdoaWxlQWN0aXZlKGVudHJ5KSB7XG4gICAgY29uc3QgdXJpID0gYXdhaXQgdGhpcy5hZGFwdGVyLmJsb2JVcmkoe1xuICAgICAgYWNjb3VudElkOiB0aGlzLmFjY291bnRJZCxcbiAgICAgIGRpZ2VzdDogZW50cnkuZGVzY3JpcHRvci5kaWdlc3RcbiAgICB9KVxuXG4gICAgaWYgKCF1cmkgJiYgZW50cnkuc3RhdHVzID09PSBcImNhY2hlZFwiKSBlbnRyeS5zdGF0dXMgPSBcIm1pc3NpbmdcIlxuXG4gICAgcmV0dXJuIHVyaVxuICB9XG5cbiAgLyoqXG4gICAqIFdhaXRzIGZvciBkZWxldGlvbiBhbmQgcHJvdGVjdHMgYSBkaWdlc3QgZm9yIG9uZSBhY3RpdmUgY2FjaGUgb3BlcmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZGlnZXN0IENvbnRlbnQgZGlnZXN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgYWZ0ZXIgcHJvdGVjdGlvbiBpcyByZWdpc3RlcmVkLlxuICAgKi9cbiAgYXN5bmMgYmVnaW5BY3RpdmVEaWdlc3QoZGlnZXN0KSB7XG4gICAgbGV0IGRlbGV0aW9uUHJvbWlzZSA9IHRoaXMuZGVsZXRpb25Qcm9taXNlcy5nZXQoZGlnZXN0KVxuXG4gICAgd2hpbGUgKGRlbGV0aW9uUHJvbWlzZSkge1xuICAgICAgYXdhaXQgZGVsZXRpb25Qcm9taXNlXG4gICAgICBkZWxldGlvblByb21pc2UgPSB0aGlzLmRlbGV0aW9uUHJvbWlzZXMuZ2V0KGRpZ2VzdClcbiAgICB9XG5cbiAgICBjb25zdCBhY3RpdmVDb3VudCA9IHRoaXMuYWN0aXZlRGlnZXN0Q291bnRzLmdldChkaWdlc3QpID8/IDBcblxuICAgIHRoaXMuYWN0aXZlRGlnZXN0Q291bnRzLnNldChkaWdlc3QsIGFjdGl2ZUNvdW50ICsgMSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWxlYXNlcyBvbmUgY2FjaGUgb3BlcmF0aW9uIGFuZCBwcm9jZXNzZXMgZGVmZXJyZWQgZGVsZXRpb24gYWZ0ZXIgdGhlIGxhc3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBkaWdlc3QgQ29udGVudCBkaWdlc3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyBhZnRlciBhbnkgcGVuZGluZyBkZWxldGlvbi5cbiAgICovXG4gIGFzeW5jIGZpbmlzaEFjdGl2ZURpZ2VzdChkaWdlc3QpIHtcbiAgICBjb25zdCBhY3RpdmVDb3VudCA9IHRoaXMuYWN0aXZlRGlnZXN0Q291bnRzLmdldChkaWdlc3QpXG5cbiAgICBpZiAoYWN0aXZlQ291bnQgPT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBNaXNzaW5nIGFjdGl2ZSBzeW5jaHJvbml6ZWQgYXNzZXQgZGlnZXN0IGNvdW50IGZvciAke2RpZ2VzdH1gKVxuICAgIH1cblxuICAgIGlmIChhY3RpdmVDb3VudCA+IDEpIHtcbiAgICAgIHRoaXMuYWN0aXZlRGlnZXN0Q291bnRzLnNldChkaWdlc3QsIGFjdGl2ZUNvdW50IC0gMSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHRoaXMuYWN0aXZlRGlnZXN0Q291bnRzLmRlbGV0ZShkaWdlc3QpXG4gICAgYXdhaXQgdGhpcy5kZWxldGVQZW5kaW5nRGlnZXN0SWZVbnJlZmVyZW5jZWQoZGlnZXN0KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlbGVhc2VzIGV2ZXJ5IGFjcXVpcmVkIGRpZ2VzdCBiZWZvcmUgcHJvcGFnYXRpbmcgZmluYWxpemF0aW9uIGZhaWx1cmVzLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBkaWdlc3RzIENvbnRlbnQgZGlnZXN0cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIGFmdGVyIGV2ZXJ5IGRpZ2VzdCBpcyByZWxlYXNlZC5cbiAgICovXG4gIGFzeW5jIGZpbmlzaEFjdGl2ZURpZ2VzdHMoZGlnZXN0cykge1xuICAgIC8qKiBAdHlwZSB7RXJyb3JbXX0gKi9cbiAgICBjb25zdCBmYWlsdXJlcyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IGRpZ2VzdCBvZiBkaWdlc3RzKSB7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLmZpbmlzaEFjdGl2ZURpZ2VzdChkaWdlc3QpXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBmYWlsdXJlcy5wdXNoKGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoZmFpbHVyZXMubGVuZ3RoID09PSAxKSB0aHJvdyBmYWlsdXJlc1swXVxuICAgIGlmIChmYWlsdXJlcy5sZW5ndGggPiAxKSB7XG4gICAgICB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoZmFpbHVyZXMsIFwiTXVsdGlwbGUgc3luY2hyb25pemVkIGFzc2V0IGRpZ2VzdCBmaW5hbGl6ZXJzIGZhaWxlZFwiLCB7Y2F1c2U6IGZhaWx1cmVzWzBdfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRGVsZXRlcyBibG9icyB0aGF0IGxvc3QgdGhlaXIgZmluYWwgZGVzY3JpcHRvciByZWZlcmVuY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyBhZnRlciBkZWxldGlvbi5cbiAgICovXG4gIGFzeW5jIGRlbGV0ZVVucmVmZXJlbmNlZERpZ2VzdHMoKSB7XG4gICAgaWYgKCF0aGlzLnN0YXRlKSB0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3QgZGVsZXRlIHN5bmNocm9uaXplZCBhc3NldCBibG9icyBiZWZvcmUgbG9hZGluZyBzdGF0ZVwiKVxuXG4gICAgZm9yIChjb25zdCBkaWdlc3Qgb2YgWy4uLnRoaXMuc3RhdGUucGVuZGluZ0RlbGV0aW9uRGlnZXN0c10pIHtcbiAgICAgIGF3YWl0IHRoaXMuZGVsZXRlUGVuZGluZ0RpZ2VzdElmVW5yZWZlcmVuY2VkKGRpZ2VzdClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRGVsZXRlcyBvbmUgcGVyc2lzdGVkIHBlbmRpbmcgZGlnZXN0IHdoZW4gbm8gZGVzY3JpcHRvciBvciBhY3RpdmUgb3BlcmF0aW9uIG93bnMgaXQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBkaWdlc3QgQ29udGVudCBkaWdlc3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyBhZnRlciBhbnkgcmVxdWlyZWQgZGVsZXRpb24uXG4gICAqL1xuICBhc3luYyBkZWxldGVQZW5kaW5nRGlnZXN0SWZVbnJlZmVyZW5jZWQoZGlnZXN0KSB7XG4gICAgaWYgKCF0aGlzLnN0YXRlKSB0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3QgZGVsZXRlIHN5bmNocm9uaXplZCBhc3NldCBibG9icyBiZWZvcmUgbG9hZGluZyBzdGF0ZVwiKVxuICAgIGlmICghdGhpcy5zdGF0ZS5wZW5kaW5nRGVsZXRpb25EaWdlc3RzLmluY2x1ZGVzKGRpZ2VzdCkpIHJldHVyblxuXG4gICAgYXdhaXQgdGhpcy5kZWxldGVEaWdlc3RJZkluYWN0aXZlKGRpZ2VzdCwgYXN5bmMgKCkgPT4ge1xuICAgICAgaWYgKCF0aGlzLnN0YXRlKSB0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3QgZGVsZXRlIHN5bmNocm9uaXplZCBhc3NldCBibG9icyBiZWZvcmUgbG9hZGluZyBzdGF0ZVwiKVxuICAgICAgaWYgKCF0aGlzLnN0YXRlLnBlbmRpbmdEZWxldGlvbkRpZ2VzdHMuaW5jbHVkZXMoZGlnZXN0KSkgcmV0dXJuIGZhbHNlXG5cbiAgICAgIGxldCBkZWxldGVkID0gZmFsc2VcblxuICAgICAgaWYgKCF0aGlzLnN0YXRlLmFzc2V0cy5zb21lKChlbnRyeSkgPT4gZW50cnkuZGVzY3JpcHRvci5kaWdlc3QgPT09IGRpZ2VzdCkpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5hZGFwdGVyLmRlbGV0ZUJsb2Ioe2FjY291bnRJZDogdGhpcy5hY2NvdW50SWQsIGRpZ2VzdH0pXG4gICAgICAgIGRlbGV0ZWQgPSB0cnVlXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHBlbmRpbmdEZWxldGlvbkRpZ2VzdHMgPSB0aGlzLnN0YXRlLnBlbmRpbmdEZWxldGlvbkRpZ2VzdHNcblxuICAgICAgdGhpcy5zdGF0ZS5wZW5kaW5nRGVsZXRpb25EaWdlc3RzID0gcGVuZGluZ0RlbGV0aW9uRGlnZXN0cy5maWx0ZXIoKGNhbmRpZGF0ZSkgPT4gY2FuZGlkYXRlICE9PSBkaWdlc3QpXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMuc2F2ZVN0YXRlKClcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGlmICghdGhpcy5zdGF0ZS5wZW5kaW5nRGVsZXRpb25EaWdlc3RzLmluY2x1ZGVzKGRpZ2VzdCkpIHRoaXMuc3RhdGUucGVuZGluZ0RlbGV0aW9uRGlnZXN0cy5wdXNoKGRpZ2VzdClcbiAgICAgICAgdGhyb3cgZXJyb3JcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGRlbGV0ZWRcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgb25lIGRlbGV0aW9uIG9ubHkgYWZ0ZXIgZWFybGllciBkZWxldGlvbiB3b3JrIGFuZCB3aGVuIG5vIGNhY2hlIG9wZXJhdGlvbiBvd25zIHRoZSBkaWdlc3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBkaWdlc3QgQ29udGVudCBkaWdlc3QuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxib29sZWFuPn0gY2FsbGJhY2sgUHJvdGVjdGVkIGRlbGV0aW9uIGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gV2hldGhlciB0aGUgY2FsbGJhY2sgZGVsZXRlZCB0aGUgYmxvYi5cbiAgICovXG4gIGFzeW5jIGRlbGV0ZURpZ2VzdElmSW5hY3RpdmUoZGlnZXN0LCBjYWxsYmFjaykge1xuICAgIGxldCBhY3RpdmVEZWxldGlvblByb21pc2UgPSB0aGlzLmRlbGV0aW9uUHJvbWlzZXMuZ2V0KGRpZ2VzdClcblxuICAgIHdoaWxlIChhY3RpdmVEZWxldGlvblByb21pc2UpIHtcbiAgICAgIGF3YWl0IGFjdGl2ZURlbGV0aW9uUHJvbWlzZVxuICAgICAgYWN0aXZlRGVsZXRpb25Qcm9taXNlID0gdGhpcy5kZWxldGlvblByb21pc2VzLmdldChkaWdlc3QpXG4gICAgfVxuXG4gICAgaWYgKHRoaXMuYWN0aXZlRGlnZXN0Q291bnRzLmhhcyhkaWdlc3QpKSByZXR1cm4gZmFsc2VcblxuICAgIC8qKlxuICAgICAqIFJlbGVhc2VzIGNhbGxlcnMgd2FpdGluZyBmb3IgZGVsZXRpb24gY29tcGxldGlvbi5cbiAgICAgKiBAdHlwZSB7KCkgPT4gdm9pZH1cbiAgICAgKi9cbiAgICBsZXQgcmVsZWFzZURlbGV0aW9uID0gKCkgPT4ge31cbiAgICAvKipcbiAgICAgKiBCbG9ja3MgbmV3IGRpZ2VzdCBhY3Rpdml0eSB1bnRpbCBkZWxldGlvbiBjb21wbGV0ZXMuXG4gICAgICogQHR5cGUge1Byb21pc2U8dm9pZD59XG4gICAgICovXG4gICAgY29uc3QgZGVsZXRpb25Qcm9taXNlID0gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICAgIHJlbGVhc2VEZWxldGlvbiA9ICgpID0+IHJlc29sdmUodW5kZWZpbmVkKVxuICAgIH0pXG5cbiAgICB0aGlzLmRlbGV0aW9uUHJvbWlzZXMuc2V0KGRpZ2VzdCwgZGVsZXRpb25Qcm9taXNlKVxuXG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBhd2FpdCBjYWxsYmFjaygpXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGlmICh0aGlzLmRlbGV0aW9uUHJvbWlzZXMuZ2V0KGRpZ2VzdCkgPT09IGRlbGV0aW9uUHJvbWlzZSkgdGhpcy5kZWxldGlvblByb21pc2VzLmRlbGV0ZShkaWdlc3QpXG4gICAgICByZWxlYXNlRGVsZXRpb24oKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBGaW5kcyByZXF1aXJlZCBhc3NldHMgd2l0aG91dCBsb2NhbGx5IGNhY2hlZCBieXRlcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNjb3BlS2V5IFN5bmNocm9uaXplZCBzY29wZSB0byBpbnNwZWN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmdbXT59IE1pc3NpbmcgcmVxdWlyZWQgZGVzY3JpcHRvciBpZHMuXG4gICAqL1xuICBhc3luYyBtaXNzaW5nUmVxdWlyZWRBc3NldElkcyhzY29wZUtleSkge1xuICAgIGNvbnN0IHN0YXRlID0gYXdhaXQgdGhpcy5sb2FkU3RhdGUoKVxuICAgIC8qKiBAdHlwZSB7c3RyaW5nW119ICovXG4gICAgY29uc3QgbWlzc2luZ0Fzc2V0SWRzID0gW11cblxuICAgIGZvciAoY29uc3QgZW50cnkgb2Ygc3RhdGUuYXNzZXRzKSB7XG4gICAgICBpZiAoIWVudHJ5LnNjb3BlS2V5cy5pbmNsdWRlcyhzY29wZUtleSkpIGNvbnRpbnVlXG4gICAgICBpZiAoZW50cnkuZGVzY3JpcHRvci5vZmZsaW5lUmVxdWlyZW1lbnQgIT09IFwicmVxdWlyZWRcIikgY29udGludWVcbiAgICAgIGlmIChhd2FpdCB0aGlzLmNhY2hlZFVyaShlbnRyeSkpIGNvbnRpbnVlXG5cbiAgICAgIG1pc3NpbmdBc3NldElkcy5wdXNoKGVudHJ5LmRlc2NyaXB0b3IuaWQpXG4gICAgfVxuXG4gICAgcmV0dXJuIG1pc3NpbmdBc3NldElkc1xuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrcyB3aGV0aGVyIGEgZmFpbGVkIG9yIG1pc3NpbmcgZW50cnkgbWF5IGJlIGRvd25sb2FkZWQgbm93LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZUVudHJ5fSBlbnRyeSBEZXNjcmlwdG9yIHN0YXRlLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gV2hldGhlciB0aGUgcmV0cnkgZGVhZGxpbmUgaGFzIHBhc3NlZC5cbiAgICovXG4gIHJldHJ5RWxpZ2libGUoZW50cnkpIHtcbiAgICByZXR1cm4gZW50cnkuc3RhdHVzICE9PSBcImZhaWxlZFwiIHx8IGVudHJ5Lm5leHRSZXRyeUF0ID09PSBudWxsIHx8IGVudHJ5Lm5leHRSZXRyeUF0IDw9IHRoaXMubm93TWlsbGlzZWNvbmRzKClcbiAgfVxuXG4gIC8qKlxuICAgKiBDYWxjdWxhdGVzIGJvdW5kZWQgZXhwb25lbnRpYWwgcmV0cnkgZGVsYXkuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhdHRlbXB0cyBDb25zZWN1dGl2ZSBmYWlsdXJlcy5cbiAgICogQHJldHVybnMge251bWJlcn0gUmV0cnkgZGVsYXkuXG4gICAqL1xuICByZXRyeURlbGF5KGF0dGVtcHRzKSB7XG4gICAgcmV0dXJuIE1hdGgubWluKHRoaXMucmV0cnlNYXhEZWxheU1zLCB0aGlzLnJldHJ5QmFzZURlbGF5TXMgKiAoMiAqKiBNYXRoLm1heCgwLCBhdHRlbXB0cyAtIDEpKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkcyB0aGUgaW5qZWN0YWJsZSB3YWxsIGNsb2NrLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSBDdXJyZW50IGVwb2NoIG1pbGxpc2Vjb25kcy5cbiAgICovXG4gIG5vd01pbGxpc2Vjb25kcygpIHtcbiAgICByZXR1cm4gdGhpcy5ub3coKS5nZXRUaW1lKClcbiAgfVxufVxuIl19