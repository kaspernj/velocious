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
        /** @type {Map<string, Promise<string>>} */
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
        const state = await this.loadState();
        const incomingDigests = [...new Set(descriptors.map((asset) => asset.digest))];
        /** @type {import("./types.js").SynchronizedAssetCacheFailure[]} */
        const failures = [];
        for (const digest of incomingDigests)
            await this.beginActiveDigest(digest);
        /** @type {Map<string, import("./types.js").SynchronizedAssetCacheEntry>} */
        let entriesById;
        try {
            const incomingIds = new Set(descriptors.map((asset) => asset.id));
            entriesById = new Map(state.assets.map((entry) => [entry.descriptor.id, entry]));
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
                        lastAccessedAt: this.nowMilliseconds(),
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
            await this.saveState();
            await this.deleteUnreferencedDigests();
            if (online) {
                for (const asset of descriptors) {
                    if (asset.fetch !== "eager")
                        continue;
                    const entry = entriesById.get(asset.id);
                    if (!entry || !this.retryEligible(entry))
                        continue;
                    const cacheResult = await this.ensureCachedWhileActive(entry);
                    if (cacheResult.error)
                        failures.push({ assetId: asset.id, error: cacheResult.error });
                }
            }
        }
        finally {
            await this.finishActiveDigests(incomingDigests);
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
        await this.beginActiveDigest(digest);
        try {
            const cachedUri = await this.cachedUriWhileActive(entry);
            if (cachedUri) {
                entry.lastAccessedAt = this.nowMilliseconds();
                entry.status = "cached";
                await this.saveState();
                return cachedUri;
            }
            if (!online || !this.retryEligible(entry))
                return null;
            const cacheResult = await this.ensureCachedWhileActive(entry);
            if (cacheResult.error)
                throw cacheResult.error;
            if (!cacheResult.uri)
                return null;
            await this.cleanup(new Set([digest]));
            return cacheResult.uri;
        }
        finally {
            await this.finishActiveDigest(digest);
        }
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
        cachedBlobs.sort((left, right) => left.lastAccessedAt - right.lastAccessedAt || left.digest.localeCompare(right.digest));
        let removedBytes = 0;
        for (const blob of cachedBlobs) {
            if (cachedBytes <= this.maxBytes)
                break;
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
        await this.saveState();
        const digest = entry.descriptor.digest;
        let downloadPromise = this.downloadPromises.get(digest);
        let ownsDownloadPromise = false;
        if (!downloadPromise) {
            downloadPromise = this.downloadAndRecordFailure(entry.descriptor);
            this.downloadPromises.set(digest, downloadPromise);
            ownsDownloadPromise = true;
        }
        try {
            const uri = await downloadPromise;
            entry.attempts = 0;
            entry.lastAccessedAt = this.nowMilliseconds();
            entry.nextRetryAt = null;
            entry.status = "cached";
            await this.saveState();
            return { error: null, uri };
        }
        catch (error) {
            const failure = error instanceof Error ? error : new Error(String(error));
            return { error: failure, uri: null };
        }
        finally {
            if (ownsDownloadPromise && this.downloadPromises.get(digest) === downloadPromise) {
                this.downloadPromises.delete(digest);
            }
        }
    }
    /**
     * Downloads one digest and records a shared attempt failure once.
     * @param {import("./types.js").SynchronizedAssetCacheDescriptor} descriptor Asset descriptor.
     * @returns {Promise<string>} Adapter URI.
     */
    async downloadAndRecordFailure(descriptor) {
        try {
            return await this.downloadVerified(descriptor);
        }
        catch (error) {
            const failure = error instanceof Error ? error : new Error(String(error));
            await this.recordDownloadFailure(descriptor.digest);
            throw failure;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2FjaGUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvc3luYy9hc3NldHMvY2FjaGUuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sY0FBYyxNQUFNLGlDQUFpQyxDQUFBO0FBRTVELE1BQU0sbUJBQW1CLEdBQUcsQ0FBQyxDQUFBO0FBQzdCLE1BQU0sMkJBQTJCLEdBQUcsSUFBSSxDQUFBO0FBQ3hDLE1BQU0sMEJBQTBCLEdBQUcsSUFBSSxHQUFHLEVBQUUsR0FBRyxDQUFDLENBQUE7QUFFaEQ7OztHQUdHO0FBQ0gsTUFBTSxDQUFDLE9BQU8sT0FBTyxzQkFBc0I7SUFDekM7Ozs7Ozs7Ozs7T0FVRztJQUNILFlBQVksRUFBQyxTQUFTLEVBQUUsT0FBTyxFQUFFLFFBQVEsRUFBRSxRQUFRLEVBQUUsR0FBRyxHQUFHLEdBQUcsRUFBRSxDQUFDLElBQUksSUFBSSxFQUFFLEVBQUUsZ0JBQWdCLEdBQUcsMkJBQTJCLEVBQUUsZUFBZSxHQUFHLDBCQUEwQixFQUFDO1FBQ3hLLElBQUksQ0FBQyxTQUFTO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxpREFBaUQsQ0FBQyxDQUFBO1FBQ2xGLElBQUksQ0FBQyxNQUFNLENBQUMsYUFBYSxDQUFDLFFBQVEsQ0FBQyxJQUFJLFFBQVEsR0FBRyxDQUFDO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyx1RUFBdUUsQ0FBQyxDQUFBO1FBQzdJLElBQUksQ0FBQyxNQUFNLENBQUMsYUFBYSxDQUFDLGdCQUFnQixDQUFDLElBQUksZ0JBQWdCLEdBQUcsQ0FBQztZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsMkVBQTJFLENBQUMsQ0FBQTtRQUNqSyxJQUFJLENBQUMsTUFBTSxDQUFDLGFBQWEsQ0FBQyxlQUFlLENBQUMsSUFBSSxlQUFlLEdBQUcsZ0JBQWdCO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyw0RUFBNEUsQ0FBQyxDQUFBO1FBRS9LLElBQUksQ0FB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ZSxDQUFBO0lBQ3hCLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsYUFBYSxDQUFDLEtBQUs7UUFDakIsT0FBTyxLQUFLLENBQUMsTUFBTSxLQUFLLFFBQVEsSUFBSSxLQUFLLENBQUMsV0FBVyxLQUFLLElBQUksSUFBSSxLQUFLLENBQUMsV0FBVyxJQUFJLElBQUksQ0FBQyxlQUFlLEVBQUUsQ0FBQTtJQUMvRyxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILFVBQVUsQ0FBQyxRQUFRO1FBQ2pCLE9BQU8sSUFBSSxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsZUFBZSxFQUFFLElBQUksQ0FBQyxnQkFBZ0IsR0FBRyxDQUFDLENBQUMsSUFBSSxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsRUFBRSxRQUFRLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFBO0lBQ2pHLENBQUM7SUFFRDs7O09BR0c7SUFDSCxlQUFlO1FBQ2IsT0FBTyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUMsT0FBTyxFQUFFLENBQUE7SUFDN0IsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBzaGEyNTZCeXRlc0hleCBmcm9tIFwiLi4vLi4vdXRpbHMvc2hhMjU2LWJ5dGVzLWhleC5qc1wiXG5cbmNvbnN0IENBQ0hFX1NUQVRFX1ZFUlNJT04gPSAxXG5jb25zdCBERUZBVUxUX1JFVFJZX0JBU0VfREVMQVlfTVMgPSAxMDAwXG5jb25zdCBERUZBVUxUX1JFVFJZX01BWF9ERUxBWV9NUyA9IDEwMDAgKiA2MCAqIDVcblxuLyoqXG4gKiBDb3JlIHN5bmNocm9uaXplZCBhc3NldCBjYWNoZS4gUGxhdGZvcm0gcGFja2FnZXMgb3duIGJ5dGUgYW5kIG1ldGFkYXRhXG4gKiBwZXJzaXN0ZW5jZSB3aGlsZSB0aGlzIGNsYXNzIG93bnMgcG9saWN5LCBpbnRlZ3JpdHksIGFuZCBsaWZlY3ljbGUuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFN5bmNocm9uaXplZEFzc2V0Q2FjaGUge1xuICAvKipcbiAgICogQ3JlYXRlcyBhIHN5bmNocm9uaXplZCBhc3NldCBjYWNoZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuYWNjb3VudElkIEF1dGhlbnRpY2F0ZWQgYWNjb3VudCBuYW1lc3BhY2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlQWRhcHRlcn0gYXJncy5hZGFwdGVyIFBsYXRmb3JtIHN0b3JhZ2UgYWRhcHRlci5cbiAgICogQHBhcmFtIHsoZGVzY3JpcHRvcjogaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlRGVzY3JpcHRvcikgPT4gUHJvbWlzZTxVaW50OEFycmF5Pn0gYXJncy5kb3dubG9hZCBBdXRoZW50aWNhdGVkIGJ5dGUgZG93bmxvYWRlci5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MubWF4Qnl0ZXMgTWF4aW11bSBldmljdGFibGUgY2FjaGUgc2l6ZS5cbiAgICogQHBhcmFtIHsoKSA9PiBEYXRlfSBbYXJncy5ub3ddIENsb2NrLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MucmV0cnlCYXNlRGVsYXlNc10gSW5pdGlhbCByZXRyeSBkZWxheS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLnJldHJ5TWF4RGVsYXlNc10gTWF4aW11bSByZXRyeSBkZWxheS5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHthY2NvdW50SWQsIGFkYXB0ZXIsIGRvd25sb2FkLCBtYXhCeXRlcywgbm93ID0gKCkgPT4gbmV3IERhdGUoKSwgcmV0cnlCYXNlRGVsYXlNcyA9IERFRkFVTFRfUkVUUllfQkFTRV9ERUxBWV9NUywgcmV0cnlNYXhEZWxheU1zID0gREVGQVVMVF9SRVRSWV9NQVhfREVMQVlfTVN9KSB7XG4gICAgaWYgKCFhY2NvdW50SWQpIHRocm93IG5ldyBFcnJvcihcIlN5bmNocm9uaXplZCBhc3NldCBjYWNoZSByZXF1aXJlcyBhbiBhY2NvdW50IGlkXCIpXG4gICAgaWYgKCFOdW1iZXIuaXNTYWZlSW50ZWdlcihtYXhCeXRlcykgfHwgbWF4Qnl0ZXMgPCAwKSB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jaHJvbml6ZWQgYXNzZXQgY2FjaGUgbWF4Qnl0ZXMgbXVzdCBiZSBhIG5vbi1uZWdhdGl2ZSBzYWZlIGludGVnZXJcIilcbiAgICBpZiAoIU51bWJlci5pc1NhZmVJbnRlZ2VyKHJldHJ5QmFzZURlbGF5TXMpIHx8IHJldHJ5QmFzZURlbGF5TXMgPCAxKSB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jaHJvbml6ZWQgYXNzZXQgY2FjaGUgcmV0cnlCYXNlRGVsYXlNcyBtdXN0IGJlIGEgcG9zaXRpdmUgc2FmZSBpbnRlZ2VyXCIpXG4gICAgaWYgKCFOdW1iZXIuaXNTYWZlSW50ZWdlcihyZXRyeU1heERlbGF5TXMpIHx8IHJldHJ5TWF4RGVsYXlNcyA8IHJldHJ5QmFzZURlbGF5TXMpIHRocm93IG5ldyBFcnJvcihcIlN5bmNocm9uaXplZCBhc3NldCBjYWNoZSByZXRyeU1heERlbGF5TXMgbXVzdCBiZSBhdCBsZWFzdCByZXRyeUJhc2VEZWxheU1zXCIpXG5cbiAgICB0aGlzLmFjY291bnRJZCA9IGFjY291bnRJZFxuICAgIHRoaXMuYWRhcHRlciA9IGFkYXB0ZXJcbiAgICB0aGlzLmRvd25sb2FkID0gZG93bmxvYWRcbiAgICB0aGlzLm1heEJ5dGVzID0gbWF4Qnl0ZXNcbiAgICB0aGlzLm5vdyA9IG5vd1xuICAgIHRoaXMucmV0cnlCYXNlRGVsYXlNcyA9IHJldHJ5QmFzZURlbGF5TXNcbiAgICB0aGlzLnJldHJ5TWF4RGVsYXlNcyA9IHJldHJ5TWF4RGVsYXlNc1xuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgbnVtYmVyPn0gKi9cbiAgICB0aGlzLmFjdGl2ZURpZ2VzdENvdW50cyA9IG5ldyBNYXAoKVxuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgUHJvbWlzZTx2b2lkPj59ICovXG4gICAgdGhpcy5kZWxldGlvblByb21pc2VzID0gbmV3IE1hcCgpXG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBQcm9taXNlPHN0cmluZz4+fSAqL1xuICAgIHRoaXMuZG93bmxvYWRQcm9taXNlcyA9IG5ldyBNYXAoKVxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlU3RhdGUgfCBudWxsfSAqL1xuICAgIHRoaXMuc3RhdGUgPSBudWxsXG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZVN0YXRlPiB8IG51bGx9ICovXG4gICAgdGhpcy5zdGF0ZVByb21pc2UgPSBudWxsXG4gICAgLyoqIEB0eXBlIHtQcm9taXNlPHZvaWQ+fSAqL1xuICAgIHRoaXMuc2F2ZVN0YXRlUHJvbWlzZSA9IFByb21pc2UucmVzb2x2ZSgpXG4gIH1cblxuICAvKipcbiAgICogUmVjb25jaWxlcyB0aGUgaW1tdXRhYmxlIGRlc2NyaXB0b3JzIGZvciBvbmUgc3luY2hyb25pemVkIHNjb3BlIGFuZFxuICAgKiBkb3dubG9hZHMgZWxpZ2libGUgZWFnZXIgYXNzZXRzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyBSZWNvbmNpbGlhdGlvbiBpbnB1dHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlRGVzY3JpcHRvcltdfSBhcmdzLmRlc2NyaXB0b3JzIEN1cnJlbnQgZGVzY3JpcHRvcnMgaW4gdGhlIHNjb3BlLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3Mub25saW5lIFdoZXRoZXIgYXV0aGVudGljYXRlZCBkb3dubG9hZHMgYXJlIGF2YWlsYWJsZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc2NvcGVLZXkgU3RhYmxlIHN5bmNocm9uaXplZCBzY29wZSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZVN5bmNocm9uaXphdGlvblJlc3VsdD59IFN5bmNocm9uaXphdGlvbiByZXN1bHQuXG4gICAqL1xuICBhc3luYyBzeW5jaHJvbml6ZSh7ZGVzY3JpcHRvcnMsIG9ubGluZSwgc2NvcGVLZXl9KSB7XG4gICAgY29uc3Qgc3RhdGUgPSBhd2FpdCB0aGlzLmxvYWRTdGF0ZSgpXG4gICAgY29uc3QgaW5jb21pbmdEaWdlc3RzID0gWy4uLm5ldyBTZXQoZGVzY3JpcHRvcnMubWFwKChhc3NldCkgPT4gYXNzZXQuZGlnZXN0KSldXG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVGYWlsdXJlW119ICovXG4gICAgY29uc3QgZmFpbHVyZXMgPSBbXVxuXG4gICAgZm9yIChjb25zdCBkaWdlc3Qgb2YgaW5jb21pbmdEaWdlc3RzKSBhd2FpdCB0aGlzLmJlZ2luQWN0aXZlRGlnZXN0KGRpZ2VzdClcblxuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlRW50cnk+fSAqL1xuICAgIGxldCBlbnRyaWVzQnlJZFxuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGluY29taW5nSWRzID0gbmV3IFNldChkZXNjcmlwdG9ycy5tYXAoKGFzc2V0KSA9PiBhc3NldC5pZCkpXG4gICAgICBlbnRyaWVzQnlJZCA9IG5ldyBNYXAoc3RhdGUuYXNzZXRzLm1hcCgoZW50cnkpID0+IFtlbnRyeS5kZXNjcmlwdG9yLmlkLCBlbnRyeV0pKVxuICAgICAgY29uc3QgZGlnZXN0c0J5SWQgPSBuZXcgTWFwKHN0YXRlLmFzc2V0cy5tYXAoKGVudHJ5KSA9PiBbZW50cnkuZGVzY3JpcHRvci5pZCwgZW50cnkuZGVzY3JpcHRvci5kaWdlc3RdKSlcbiAgICAgIGNvbnN0IHJlbW92ZWREaWdlc3RzID0gbmV3IFNldCgpXG5cbiAgICAgIGZvciAoY29uc3QgYXNzZXQgb2YgZGVzY3JpcHRvcnMpIHtcbiAgICAgICAgY29uc3Qga25vd25EaWdlc3QgPSBkaWdlc3RzQnlJZC5nZXQoYXNzZXQuaWQpXG5cbiAgICAgICAgaWYgKGtub3duRGlnZXN0ICE9PSB1bmRlZmluZWQgJiYga25vd25EaWdlc3QgIT09IGFzc2V0LmRpZ2VzdCkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgU3luY2hyb25pemVkIGFzc2V0IGRlc2NyaXB0b3IgJHthc3NldC5pZH0gY2hhbmdlZCBpdHMgaW1tdXRhYmxlIGRpZ2VzdGApXG4gICAgICAgIH1cblxuICAgICAgICBkaWdlc3RzQnlJZC5zZXQoYXNzZXQuaWQsIGFzc2V0LmRpZ2VzdClcbiAgICAgIH1cblxuICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiBzdGF0ZS5hc3NldHMpIHtcbiAgICAgICAgaWYgKCFlbnRyeS5zY29wZUtleXMuaW5jbHVkZXMoc2NvcGVLZXkpIHx8IGluY29taW5nSWRzLmhhcyhlbnRyeS5kZXNjcmlwdG9yLmlkKSkgY29udGludWVcblxuICAgICAgICBlbnRyeS5zY29wZUtleXMgPSBlbnRyeS5zY29wZUtleXMuZmlsdGVyKChjYW5kaWRhdGUpID0+IGNhbmRpZGF0ZSAhPT0gc2NvcGVLZXkpXG4gICAgICAgIGlmIChlbnRyeS5zY29wZUtleXMubGVuZ3RoID09PSAwKSByZW1vdmVkRGlnZXN0cy5hZGQoZW50cnkuZGVzY3JpcHRvci5kaWdlc3QpXG4gICAgICB9XG5cbiAgICAgIHN0YXRlLmFzc2V0cyA9IHN0YXRlLmFzc2V0cy5maWx0ZXIoKGVudHJ5KSA9PiBlbnRyeS5zY29wZUtleXMubGVuZ3RoID4gMClcblxuICAgICAgZm9yIChjb25zdCBhc3NldCBvZiBkZXNjcmlwdG9ycykge1xuICAgICAgICBjb25zdCBleGlzdGluZyA9IGVudHJpZXNCeUlkLmdldChhc3NldC5pZClcblxuICAgICAgICBpZiAoZXhpc3RpbmcgJiYgc3RhdGUuYXNzZXRzLmluY2x1ZGVzKGV4aXN0aW5nKSkge1xuICAgICAgICAgIGV4aXN0aW5nLmRlc2NyaXB0b3IgPSBhc3NldFxuICAgICAgICAgIGlmICghZXhpc3Rpbmcuc2NvcGVLZXlzLmluY2x1ZGVzKHNjb3BlS2V5KSkgZXhpc3Rpbmcuc2NvcGVLZXlzLnB1c2goc2NvcGVLZXkpXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY29uc3QgbmV3RW50cnkgPSB7XG4gICAgICAgICAgICBhdHRlbXB0czogMCxcbiAgICAgICAgICAgIGRlc2NyaXB0b3I6IGFzc2V0LFxuICAgICAgICAgICAgbGFzdEFjY2Vzc2VkQXQ6IHRoaXMubm93TWlsbGlzZWNvbmRzKCksXG4gICAgICAgICAgICBuZXh0UmV0cnlBdDogbnVsbCxcbiAgICAgICAgICAgIHNjb3BlS2V5czogW3Njb3BlS2V5XSxcbiAgICAgICAgICAgIHN0YXR1czogLyoqIEB0eXBlIHtjb25zdH0gKi8gKFwibWlzc2luZ1wiKVxuICAgICAgICAgIH1cblxuICAgICAgICAgIHN0YXRlLmFzc2V0cy5wdXNoKG5ld0VudHJ5KVxuICAgICAgICAgIGVudHJpZXNCeUlkLnNldChhc3NldC5pZCwgbmV3RW50cnkpXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgZm9yIChjb25zdCBkaWdlc3Qgb2YgcmVtb3ZlZERpZ2VzdHMpIHtcbiAgICAgICAgaWYgKHN0YXRlLmFzc2V0cy5zb21lKChlbnRyeSkgPT4gZW50cnkuZGVzY3JpcHRvci5kaWdlc3QgPT09IGRpZ2VzdCkpIGNvbnRpbnVlXG4gICAgICAgIGlmICghc3RhdGUucGVuZGluZ0RlbGV0aW9uRGlnZXN0cy5pbmNsdWRlcyhkaWdlc3QpKSBzdGF0ZS5wZW5kaW5nRGVsZXRpb25EaWdlc3RzLnB1c2goZGlnZXN0KVxuICAgICAgfVxuXG4gICAgICBhd2FpdCB0aGlzLnNhdmVTdGF0ZSgpXG4gICAgICBhd2FpdCB0aGlzLmRlbGV0ZVVucmVmZXJlbmNlZERpZ2VzdHMoKVxuXG4gICAgICBpZiAob25saW5lKSB7XG4gICAgICAgIGZvciAoY29uc3QgYXNzZXQgb2YgZGVzY3JpcHRvcnMpIHtcbiAgICAgICAgICBpZiAoYXNzZXQuZmV0Y2ggIT09IFwiZWFnZXJcIikgY29udGludWVcblxuICAgICAgICAgIGNvbnN0IGVudHJ5ID0gZW50cmllc0J5SWQuZ2V0KGFzc2V0LmlkKVxuXG4gICAgICAgICAgaWYgKCFlbnRyeSB8fCAhdGhpcy5yZXRyeUVsaWdpYmxlKGVudHJ5KSkgY29udGludWVcblxuICAgICAgICAgIGNvbnN0IGNhY2hlUmVzdWx0ID0gYXdhaXQgdGhpcy5lbnN1cmVDYWNoZWRXaGlsZUFjdGl2ZShlbnRyeSlcblxuICAgICAgICAgIGlmIChjYWNoZVJlc3VsdC5lcnJvcikgZmFpbHVyZXMucHVzaCh7YXNzZXRJZDogYXNzZXQuaWQsIGVycm9yOiBjYWNoZVJlc3VsdC5lcnJvcn0pXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgdGhpcy5maW5pc2hBY3RpdmVEaWdlc3RzKGluY29taW5nRGlnZXN0cylcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLmNsZWFudXAoKVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGZhaWx1cmVzLFxuICAgICAgbWlzc2luZ1JlcXVpcmVkQXNzZXRJZHM6IGF3YWl0IHRoaXMubWlzc2luZ1JlcXVpcmVkQXNzZXRJZHMoc2NvcGVLZXkpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGEgY2FjaGVkIGFzc2V0IFVSSSwgZG93bmxvYWRpbmcgaXQgb24gZGVtYW5kIHdoZW4gYWxsb3dlZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgUmVzb2x1dGlvbiBpbnB1dHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmFzc2V0SWQgQXR0YWNobWVudCBkZXNjcmlwdG9yIGlkLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3Mub25saW5lIFdoZXRoZXIgYXV0aGVudGljYXRlZCBkb3dubG9hZHMgYXJlIGF2YWlsYWJsZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nIHwgbnVsbD59IENhY2hlZCBhc3NldCBVUkkuXG4gICAqL1xuICBhc3luYyByZXNvbHZlKHthc3NldElkLCBvbmxpbmV9KSB7XG4gICAgY29uc3Qgc3RhdGUgPSBhd2FpdCB0aGlzLmxvYWRTdGF0ZSgpXG4gICAgY29uc3QgZW50cnkgPSBzdGF0ZS5hc3NldHMuZmluZCgoY2FuZGlkYXRlKSA9PiBjYW5kaWRhdGUuZGVzY3JpcHRvci5pZCA9PT0gYXNzZXRJZClcblxuICAgIGlmICghZW50cnkpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCBkaWdlc3QgPSBlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdFxuXG4gICAgYXdhaXQgdGhpcy5iZWdpbkFjdGl2ZURpZ2VzdChkaWdlc3QpXG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgY2FjaGVkVXJpID0gYXdhaXQgdGhpcy5jYWNoZWRVcmlXaGlsZUFjdGl2ZShlbnRyeSlcblxuICAgICAgaWYgKGNhY2hlZFVyaSkge1xuICAgICAgICBlbnRyeS5sYXN0QWNjZXNzZWRBdCA9IHRoaXMubm93TWlsbGlzZWNvbmRzKClcbiAgICAgICAgZW50cnkuc3RhdHVzID0gXCJjYWNoZWRcIlxuICAgICAgICBhd2FpdCB0aGlzLnNhdmVTdGF0ZSgpXG5cbiAgICAgICAgcmV0dXJuIGNhY2hlZFVyaVxuICAgICAgfVxuXG4gICAgICBpZiAoIW9ubGluZSB8fCAhdGhpcy5yZXRyeUVsaWdpYmxlKGVudHJ5KSkgcmV0dXJuIG51bGxcblxuICAgICAgY29uc3QgY2FjaGVSZXN1bHQgPSBhd2FpdCB0aGlzLmVuc3VyZUNhY2hlZFdoaWxlQWN0aXZlKGVudHJ5KVxuXG4gICAgICBpZiAoY2FjaGVSZXN1bHQuZXJyb3IpIHRocm93IGNhY2hlUmVzdWx0LmVycm9yXG4gICAgICBpZiAoIWNhY2hlUmVzdWx0LnVyaSkgcmV0dXJuIG51bGxcblxuICAgICAgYXdhaXQgdGhpcy5jbGVhbnVwKG5ldyBTZXQoW2RpZ2VzdF0pKVxuXG4gICAgICByZXR1cm4gY2FjaGVSZXN1bHQudXJpXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IHRoaXMuZmluaXNoQWN0aXZlRGlnZXN0KGRpZ2VzdClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRXZpY3RzIGxlYXN0LXJlY2VudGx5LXVzZWQgYmxvYnMgdW50aWwgdGhlIHVuaXF1ZSBjYWNoZWQgYnl0ZSB0b3RhbCBpc1xuICAgKiB3aXRoaW4gdGhlIGNvbmZpZ3VyZWQgYnVkZ2V0LiBBIGJsb2Igc3RheXMgZHVyYWJsZSB3aGVuIGFueSBsaXZlXG4gICAqIGRlc2NyaXB0b3IgcmVmZXJlbmNlIGRlY2xhcmVzIGR1cmFibGUgcmV0ZW50aW9uLlxuICAgKiBAcGFyYW0ge1NldDxzdHJpbmc+fSBbcHJvdGVjdGVkRGlnZXN0c10gRGlnZXN0cyBuZWVkZWQgYnkgdGhlIGFjdGl2ZSBjYWxsZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IEJ5dGVzIHJlbW92ZWQuXG4gICAqL1xuICBhc3luYyBjbGVhbnVwKHByb3RlY3RlZERpZ2VzdHMgPSBuZXcgU2V0KCkpIHtcbiAgICBjb25zdCBzdGF0ZSA9IGF3YWl0IHRoaXMubG9hZFN0YXRlKClcbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIGltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZUVudHJ5W10+fSAqL1xuICAgIGNvbnN0IGVudHJpZXNCeURpZ2VzdCA9IG5ldyBNYXAoKVxuXG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiBzdGF0ZS5hc3NldHMpIHtcbiAgICAgIGNvbnN0IGRpZ2VzdEVudHJpZXMgPSBlbnRyaWVzQnlEaWdlc3QuZ2V0KGVudHJ5LmRlc2NyaXB0b3IuZGlnZXN0KSB8fCBbXVxuXG4gICAgICBkaWdlc3RFbnRyaWVzLnB1c2goZW50cnkpXG4gICAgICBlbnRyaWVzQnlEaWdlc3Quc2V0KGVudHJ5LmRlc2NyaXB0b3IuZGlnZXN0LCBkaWdlc3RFbnRyaWVzKVxuICAgIH1cblxuICAgIC8qKiBAdHlwZSB7e2J5dGVTaXplOiBudW1iZXIsIGRpZ2VzdDogc3RyaW5nLCBsYXN0QWNjZXNzZWRBdDogbnVtYmVyfVtdfSAqL1xuICAgIGNvbnN0IGNhY2hlZEJsb2JzID0gW11cbiAgICBsZXQgY2FjaGVkQnl0ZXMgPSAwXG5cbiAgICBmb3IgKGNvbnN0IFtkaWdlc3QsIHJlZmVyZW5jZXNdIG9mIGVudHJpZXNCeURpZ2VzdCkge1xuICAgICAgY29uc3QgdXJpID0gYXdhaXQgdGhpcy5hZGFwdGVyLmJsb2JVcmkoe2FjY291bnRJZDogdGhpcy5hY2NvdW50SWQsIGRpZ2VzdH0pXG5cbiAgICAgIGlmICghdXJpKSB7XG4gICAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgcmVmZXJlbmNlcykge1xuICAgICAgICAgIGlmIChlbnRyeS5zdGF0dXMgPT09IFwiY2FjaGVkXCIpIGVudHJ5LnN0YXR1cyA9IFwibWlzc2luZ1wiXG4gICAgICAgIH1cbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgY29uc3QgYnl0ZVNpemUgPSByZWZlcmVuY2VzWzBdLmRlc2NyaXB0b3IuYnl0ZVNpemVcblxuICAgICAgY2FjaGVkQnl0ZXMgKz0gYnl0ZVNpemVcbiAgICAgIGNhY2hlZEJsb2JzLnB1c2goe1xuICAgICAgICBieXRlU2l6ZSxcbiAgICAgICAgZGlnZXN0LFxuICAgICAgICBsYXN0QWNjZXNzZWRBdDogTWF0aC5tYXgoLi4ucmVmZXJlbmNlcy5tYXAoKGVudHJ5KSA9PiBlbnRyeS5sYXN0QWNjZXNzZWRBdCkpXG4gICAgICB9KVxuICAgIH1cblxuICAgIGNhY2hlZEJsb2JzLnNvcnQoKGxlZnQsIHJpZ2h0KSA9PiBsZWZ0Lmxhc3RBY2Nlc3NlZEF0IC0gcmlnaHQubGFzdEFjY2Vzc2VkQXQgfHwgbGVmdC5kaWdlc3QubG9jYWxlQ29tcGFyZShyaWdodC5kaWdlc3QpKVxuXG4gICAgbGV0IHJlbW92ZWRCeXRlcyA9IDBcblxuICAgIGZvciAoY29uc3QgYmxvYiBvZiBjYWNoZWRCbG9icykge1xuICAgICAgaWYgKGNhY2hlZEJ5dGVzIDw9IHRoaXMubWF4Qnl0ZXMpIGJyZWFrXG4gICAgICBpZiAocHJvdGVjdGVkRGlnZXN0cy5oYXMoYmxvYi5kaWdlc3QpKSBjb250aW51ZVxuICAgICAgbGV0IGJsb2JXYXNBbHJlYWR5TWlzc2luZyA9IGZhbHNlXG4gICAgICBjb25zdCBkZWxldGVkID0gYXdhaXQgdGhpcy5kZWxldGVEaWdlc3RJZkluYWN0aXZlKGJsb2IuZGlnZXN0LCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGlmICghdGhpcy5zdGF0ZSkgdGhyb3cgbmV3IEVycm9yKFwiQ2Fubm90IGNsZWFuIHN5bmNocm9uaXplZCBhc3NldCBibG9icyBiZWZvcmUgbG9hZGluZyBzdGF0ZVwiKVxuXG4gICAgICAgIGNvbnN0IGN1cnJlbnRVcmkgPSBhd2FpdCB0aGlzLmFkYXB0ZXIuYmxvYlVyaSh7YWNjb3VudElkOiB0aGlzLmFjY291bnRJZCwgZGlnZXN0OiBibG9iLmRpZ2VzdH0pXG4gICAgICAgIGNvbnN0IGN1cnJlbnRSZWZlcmVuY2VzID0gdGhpcy5zdGF0ZS5hc3NldHMuZmlsdGVyKChlbnRyeSkgPT4gZW50cnkuZGVzY3JpcHRvci5kaWdlc3QgPT09IGJsb2IuZGlnZXN0KVxuXG4gICAgICAgIGlmICghY3VycmVudFVyaSkge1xuICAgICAgICAgIGJsb2JXYXNBbHJlYWR5TWlzc2luZyA9IHRydWVcblxuICAgICAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgY3VycmVudFJlZmVyZW5jZXMpIHtcbiAgICAgICAgICAgIGlmIChlbnRyeS5zdGF0dXMgPT09IFwiY2FjaGVkXCIpIGVudHJ5LnN0YXR1cyA9IFwibWlzc2luZ1wiXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICAgIH1cbiAgICAgICAgaWYgKGN1cnJlbnRSZWZlcmVuY2VzLnNvbWUoKGVudHJ5KSA9PiBlbnRyeS5kZXNjcmlwdG9yLnJldGVudGlvbiA9PT0gXCJkdXJhYmxlXCIpKSByZXR1cm4gZmFsc2VcblxuICAgICAgICBhd2FpdCB0aGlzLmFkYXB0ZXIuZGVsZXRlQmxvYih7YWNjb3VudElkOiB0aGlzLmFjY291bnRJZCwgZGlnZXN0OiBibG9iLmRpZ2VzdH0pXG5cbiAgICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiBjdXJyZW50UmVmZXJlbmNlcykge1xuICAgICAgICAgIGVudHJ5LmF0dGVtcHRzID0gMFxuICAgICAgICAgIGVudHJ5Lm5leHRSZXRyeUF0ID0gbnVsbFxuICAgICAgICAgIGVudHJ5LnN0YXR1cyA9IFwibWlzc2luZ1wiXG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdHJ1ZVxuICAgICAgfSlcblxuICAgICAgaWYgKGJsb2JXYXNBbHJlYWR5TWlzc2luZykgY2FjaGVkQnl0ZXMgLT0gYmxvYi5ieXRlU2l6ZVxuICAgICAgaWYgKCFkZWxldGVkKSBjb250aW51ZVxuXG4gICAgICBjYWNoZWRCeXRlcyAtPSBibG9iLmJ5dGVTaXplXG4gICAgICByZW1vdmVkQnl0ZXMgKz0gYmxvYi5ieXRlU2l6ZVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuc2F2ZVN0YXRlKClcblxuICAgIHJldHVybiByZW1vdmVkQnl0ZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBMb2FkcyBjYWNoZSBzdGF0ZSBvbmNlIGZvciB0aGlzIGNhY2hlIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVTdGF0ZT59IExvYWRlZCBzdGF0ZS5cbiAgICovXG4gIGFzeW5jIGxvYWRTdGF0ZSgpIHtcbiAgICBpZiAodGhpcy5zdGF0ZSkgcmV0dXJuIHRoaXMuc3RhdGVcbiAgICBpZiAodGhpcy5zdGF0ZVByb21pc2UpIHJldHVybiBhd2FpdCB0aGlzLnN0YXRlUHJvbWlzZVxuXG4gICAgdGhpcy5zdGF0ZVByb21pc2UgPSB0aGlzLmxvYWRTdGF0ZUZyb21BZGFwdGVyKClcblxuICAgIHRyeSB7XG4gICAgICB0aGlzLnN0YXRlID0gYXdhaXQgdGhpcy5zdGF0ZVByb21pc2VcblxuICAgICAgcmV0dXJuIHRoaXMuc3RhdGVcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdGhpcy5zdGF0ZVByb21pc2UgPSBudWxsXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIExvYWRzIGFuZCByZWNvdmVycyBwZXJzaXN0ZWQgY2FjaGUgc3RhdGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZVN0YXRlPn0gTG9hZGVkIHN0YXRlLlxuICAgKi9cbiAgYXN5bmMgbG9hZFN0YXRlRnJvbUFkYXB0ZXIoKSB7XG4gICAgY29uc3QgbG9hZGVkU3RhdGUgPSBhd2FpdCB0aGlzLmFkYXB0ZXIubG9hZFN0YXRlKHthY2NvdW50SWQ6IHRoaXMuYWNjb3VudElkfSlcblxuICAgIGlmICghbG9hZGVkU3RhdGUpIHJldHVybiB7YXNzZXRzOiBbXSwgcGVuZGluZ0RlbGV0aW9uRGlnZXN0czogW10sIHZlcnNpb246IENBQ0hFX1NUQVRFX1ZFUlNJT059XG4gICAgaWYgKGxvYWRlZFN0YXRlLnZlcnNpb24gIT09IENBQ0hFX1NUQVRFX1ZFUlNJT04pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgc3luY2hyb25pemVkIGFzc2V0IGNhY2hlIHN0YXRlIHZlcnNpb246ICR7bG9hZGVkU3RhdGUudmVyc2lvbn1gKVxuICAgIH1cblxuICAgIGxldCByZWNvdmVyZWRJbnRlcnJ1cHRlZERvd25sb2FkID0gZmFsc2VcblxuICAgIGZvciAoY29uc3QgZW50cnkgb2YgbG9hZGVkU3RhdGUuYXNzZXRzKSB7XG4gICAgICBpZiAoZW50cnkuc3RhdHVzICE9PSBcImRvd25sb2FkaW5nXCIpIGNvbnRpbnVlXG5cbiAgICAgIGVudHJ5LmF0dGVtcHRzICs9IDFcbiAgICAgIGVudHJ5Lm5leHRSZXRyeUF0ID0gdGhpcy5ub3dNaWxsaXNlY29uZHMoKVxuICAgICAgZW50cnkuc3RhdHVzID0gXCJmYWlsZWRcIlxuICAgICAgcmVjb3ZlcmVkSW50ZXJydXB0ZWREb3dubG9hZCA9IHRydWVcbiAgICB9XG5cbiAgICBpZiAocmVjb3ZlcmVkSW50ZXJydXB0ZWREb3dubG9hZCkge1xuICAgICAgYXdhaXQgdGhpcy5hZGFwdGVyLnNhdmVTdGF0ZSh7YWNjb3VudElkOiB0aGlzLmFjY291bnRJZCwgc3RhdGU6IGxvYWRlZFN0YXRlfSlcbiAgICB9XG5cbiAgICByZXR1cm4gbG9hZGVkU3RhdGVcbiAgfVxuXG4gIC8qKlxuICAgKiBQZXJzaXN0cyB0aGUgY3VycmVudCBjYWNoZSBzdGF0ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIGFmdGVyIHN0YXRlIHBlcnNpc3RlbmNlLlxuICAgKi9cbiAgYXN5bmMgc2F2ZVN0YXRlKCkge1xuICAgIGlmICghdGhpcy5zdGF0ZSkgdGhyb3cgbmV3IEVycm9yKFwiQ2Fubm90IHNhdmUgc3luY2hyb25pemVkIGFzc2V0IGNhY2hlIGJlZm9yZSBsb2FkaW5nIHN0YXRlXCIpXG5cbiAgICBjb25zdCBwZXJzaXN0ID0gYXN5bmMgKCkgPT4ge1xuICAgICAgaWYgKCF0aGlzLnN0YXRlKSB0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3Qgc2F2ZSBzeW5jaHJvbml6ZWQgYXNzZXQgY2FjaGUgYmVmb3JlIGxvYWRpbmcgc3RhdGVcIilcblxuICAgICAgYXdhaXQgdGhpcy5hZGFwdGVyLnNhdmVTdGF0ZSh7YWNjb3VudElkOiB0aGlzLmFjY291bnRJZCwgc3RhdGU6IHRoaXMuc3RhdGV9KVxuICAgIH1cblxuICAgIHRoaXMuc2F2ZVN0YXRlUHJvbWlzZSA9IHRoaXMuc2F2ZVN0YXRlUHJvbWlzZS50aGVuKHBlcnNpc3QsIHBlcnNpc3QpXG5cbiAgICBhd2FpdCB0aGlzLnNhdmVTdGF0ZVByb21pc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBFbnN1cmVzIG9uZSBkZXNjcmlwdG9yIGhhcyB2ZXJpZmllZCBsb2NhbCBieXRlcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVFbnRyeX0gZW50cnkgRGVzY3JpcHRvciBzdGF0ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8e2Vycm9yOiBFcnJvciB8IG51bGwsIHVyaTogc3RyaW5nIHwgbnVsbH0+fSBDYWNoZSByZXN1bHQuXG4gICAqL1xuICBhc3luYyBlbnN1cmVDYWNoZWQoZW50cnkpIHtcbiAgICBjb25zdCBkaWdlc3QgPSBlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdFxuXG4gICAgYXdhaXQgdGhpcy5iZWdpbkFjdGl2ZURpZ2VzdChkaWdlc3QpXG5cbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuZW5zdXJlQ2FjaGVkV2hpbGVBY3RpdmUoZW50cnkpXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IHRoaXMuZmluaXNoQWN0aXZlRGlnZXN0KGRpZ2VzdClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgb3IgZG93bmxvYWRzIG9uZSBkZXNjcmlwdG9yIHdoaWxlIGl0cyBkaWdlc3QgaXMgcHJvdGVjdGVkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZUVudHJ5fSBlbnRyeSBEZXNjcmlwdG9yIHN0YXRlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7ZXJyb3I6IEVycm9yIHwgbnVsbCwgdXJpOiBzdHJpbmcgfCBudWxsfT59IENhY2hlIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGVuc3VyZUNhY2hlZFdoaWxlQWN0aXZlKGVudHJ5KSB7XG4gICAgY29uc3QgZXhpc3RpbmdVcmkgPSBhd2FpdCB0aGlzLmNhY2hlZFVyaVdoaWxlQWN0aXZlKGVudHJ5KVxuXG4gICAgaWYgKGV4aXN0aW5nVXJpKSB7XG4gICAgICBlbnRyeS5hdHRlbXB0cyA9IDBcbiAgICAgIGVudHJ5Lmxhc3RBY2Nlc3NlZEF0ID0gdGhpcy5ub3dNaWxsaXNlY29uZHMoKVxuICAgICAgZW50cnkubmV4dFJldHJ5QXQgPSBudWxsXG4gICAgICBlbnRyeS5zdGF0dXMgPSBcImNhY2hlZFwiXG4gICAgICBhd2FpdCB0aGlzLnNhdmVTdGF0ZSgpXG5cbiAgICAgIHJldHVybiB7ZXJyb3I6IG51bGwsIHVyaTogZXhpc3RpbmdVcml9XG4gICAgfVxuXG4gICAgZW50cnkuc3RhdHVzID0gXCJkb3dubG9hZGluZ1wiXG4gICAgYXdhaXQgdGhpcy5zYXZlU3RhdGUoKVxuXG4gICAgY29uc3QgZGlnZXN0ID0gZW50cnkuZGVzY3JpcHRvci5kaWdlc3RcbiAgICBsZXQgZG93bmxvYWRQcm9taXNlID0gdGhpcy5kb3dubG9hZFByb21pc2VzLmdldChkaWdlc3QpXG4gICAgbGV0IG93bnNEb3dubG9hZFByb21pc2UgPSBmYWxzZVxuXG4gICAgaWYgKCFkb3dubG9hZFByb21pc2UpIHtcbiAgICAgIGRvd25sb2FkUHJvbWlzZSA9IHRoaXMuZG93bmxvYWRBbmRSZWNvcmRGYWlsdXJlKGVudHJ5LmRlc2NyaXB0b3IpXG4gICAgICB0aGlzLmRvd25sb2FkUHJvbWlzZXMuc2V0KGRpZ2VzdCwgZG93bmxvYWRQcm9taXNlKVxuICAgICAgb3duc0Rvd25sb2FkUHJvbWlzZSA9IHRydWVcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgdXJpID0gYXdhaXQgZG93bmxvYWRQcm9taXNlXG5cbiAgICAgIGVudHJ5LmF0dGVtcHRzID0gMFxuICAgICAgZW50cnkubGFzdEFjY2Vzc2VkQXQgPSB0aGlzLm5vd01pbGxpc2Vjb25kcygpXG4gICAgICBlbnRyeS5uZXh0UmV0cnlBdCA9IG51bGxcbiAgICAgIGVudHJ5LnN0YXR1cyA9IFwiY2FjaGVkXCJcbiAgICAgIGF3YWl0IHRoaXMuc2F2ZVN0YXRlKClcblxuICAgICAgcmV0dXJuIHtlcnJvcjogbnVsbCwgdXJpfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zdCBmYWlsdXJlID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpXG5cbiAgICAgIHJldHVybiB7ZXJyb3I6IGZhaWx1cmUsIHVyaTogbnVsbH1cbiAgICB9IGZpbmFsbHkge1xuICAgICAgaWYgKG93bnNEb3dubG9hZFByb21pc2UgJiYgdGhpcy5kb3dubG9hZFByb21pc2VzLmdldChkaWdlc3QpID09PSBkb3dubG9hZFByb21pc2UpIHtcbiAgICAgICAgdGhpcy5kb3dubG9hZFByb21pc2VzLmRlbGV0ZShkaWdlc3QpXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIERvd25sb2FkcyBvbmUgZGlnZXN0IGFuZCByZWNvcmRzIGEgc2hhcmVkIGF0dGVtcHQgZmFpbHVyZSBvbmNlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZURlc2NyaXB0b3J9IGRlc2NyaXB0b3IgQXNzZXQgZGVzY3JpcHRvci5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gQWRhcHRlciBVUkkuXG4gICAqL1xuICBhc3luYyBkb3dubG9hZEFuZFJlY29yZEZhaWx1cmUoZGVzY3JpcHRvcikge1xuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5kb3dubG9hZFZlcmlmaWVkKGRlc2NyaXB0b3IpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnN0IGZhaWx1cmUgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSlcblxuICAgICAgYXdhaXQgdGhpcy5yZWNvcmREb3dubG9hZEZhaWx1cmUoZGVzY3JpcHRvci5kaWdlc3QpXG4gICAgICB0aHJvdyBmYWlsdXJlXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEFkdmFuY2VzIHJldHJ5IG1ldGFkYXRhIGZvciBldmVyeSBsaXZlIGRlc2NyaXB0b3Igc2hhcmluZyBvbmUgZmFpbGVkIGRpZ2VzdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGRpZ2VzdCBDb250ZW50IGRpZ2VzdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIGFmdGVyIHBlcnNpc3RlbmNlLlxuICAgKi9cbiAgYXN5bmMgcmVjb3JkRG93bmxvYWRGYWlsdXJlKGRpZ2VzdCkge1xuICAgIGlmICghdGhpcy5zdGF0ZSkgdGhyb3cgbmV3IEVycm9yKFwiQ2Fubm90IHJlY29yZCBzeW5jaHJvbml6ZWQgYXNzZXQgZG93bmxvYWQgZmFpbHVyZSBiZWZvcmUgbG9hZGluZyBzdGF0ZVwiKVxuXG4gICAgY29uc3QgZmFpbGVkQXQgPSB0aGlzLm5vd01pbGxpc2Vjb25kcygpXG5cbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHRoaXMuc3RhdGUuYXNzZXRzKSB7XG4gICAgICBpZiAoZW50cnkuZGVzY3JpcHRvci5kaWdlc3QgIT09IGRpZ2VzdCkgY29udGludWVcbiAgICAgIGlmIChlbnRyeS5zdGF0dXMgIT09IFwiZG93bmxvYWRpbmdcIikgY29udGludWVcblxuICAgICAgZW50cnkuYXR0ZW1wdHMgKz0gMVxuICAgICAgZW50cnkubmV4dFJldHJ5QXQgPSBmYWlsZWRBdCArIHRoaXMucmV0cnlEZWxheShlbnRyeS5hdHRlbXB0cylcbiAgICAgIGVudHJ5LnN0YXR1cyA9IFwiZmFpbGVkXCJcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnNhdmVTdGF0ZSgpXG4gIH1cblxuICAvKipcbiAgICogRG93bmxvYWRzLCB2ZXJpZmllcywgYW5kIGF0b21pY2FsbHkgcGVyc2lzdHMgb25lIGNvbnRlbnQgZGlnZXN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZURlc2NyaXB0b3J9IGRlc2NyaXB0b3IgQXNzZXQgZGVzY3JpcHRvci5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gQWRhcHRlciBVUkkuXG4gICAqL1xuICBhc3luYyBkb3dubG9hZFZlcmlmaWVkKGRlc2NyaXB0b3IpIHtcbiAgICBjb25zdCBkb3dubG9hZGVkQnl0ZXMgPSBhd2FpdCB0aGlzLmRvd25sb2FkKGRlc2NyaXB0b3IpXG5cbiAgICBpZiAoIShkb3dubG9hZGVkQnl0ZXMgaW5zdGFuY2VvZiBVaW50OEFycmF5KSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBTeW5jaHJvbml6ZWQgYXNzZXQgJHtkZXNjcmlwdG9yLmlkfSBkb3dubG9hZCBkaWQgbm90IHJldHVybiBVaW50OEFycmF5IGJ5dGVzYClcbiAgICB9XG4gICAgaWYgKGRvd25sb2FkZWRCeXRlcy5ieXRlTGVuZ3RoICE9PSBkZXNjcmlwdG9yLmJ5dGVTaXplKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFN5bmNocm9uaXplZCBhc3NldCAke2Rlc2NyaXB0b3IuaWR9IGJ5dGUgc2l6ZSBkaWQgbm90IG1hdGNoIGl0cyBkZXNjcmlwdG9yYClcbiAgICB9XG5cbiAgICBjb25zdCBkaWdlc3QgPSBgc2hhMjU2LSR7c2hhMjU2Qnl0ZXNIZXgoZG93bmxvYWRlZEJ5dGVzKX1gXG5cbiAgICBpZiAoZGlnZXN0ICE9PSBkZXNjcmlwdG9yLmRpZ2VzdCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBTeW5jaHJvbml6ZWQgYXNzZXQgJHtkZXNjcmlwdG9yLmlkfSBkaWdlc3QgZGlkIG5vdCBtYXRjaCBpdHMgZGVzY3JpcHRvcmApXG4gICAgfVxuXG4gICAgY29uc3QgdXJpID0gYXdhaXQgdGhpcy5hZGFwdGVyLndyaXRlQmxvYih7XG4gICAgICBhY2NvdW50SWQ6IHRoaXMuYWNjb3VudElkLFxuICAgICAgYnl0ZXM6IGRvd25sb2FkZWRCeXRlcyxcbiAgICAgIGNvbnRlbnRUeXBlOiBkZXNjcmlwdG9yLmNvbnRlbnRUeXBlLFxuICAgICAgZGlnZXN0XG4gICAgfSlcblxuICAgIGlmICghdXJpKSB0aHJvdyBuZXcgRXJyb3IoYFN5bmNocm9uaXplZCBhc3NldCBhZGFwdGVyIHJldHVybmVkIG5vIFVSSSBmb3IgJHtkZXNjcmlwdG9yLmlkfWApXG5cbiAgICByZXR1cm4gdXJpXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYW4gZXhpc3RpbmcgbG9jYWwgVVJJIGFmdGVyIHdhaXRpbmcgZm9yIGRlbGV0aW9uIHdvcmsuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlRW50cnl9IGVudHJ5IERlc2NyaXB0b3Igc3RhdGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZyB8IG51bGw+fSBFeGlzdGluZyBVUkkuXG4gICAqL1xuICBhc3luYyBjYWNoZWRVcmkoZW50cnkpIHtcbiAgICBjb25zdCBkaWdlc3QgPSBlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdFxuXG4gICAgYXdhaXQgdGhpcy5iZWdpbkFjdGl2ZURpZ2VzdChkaWdlc3QpXG5cbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuY2FjaGVkVXJpV2hpbGVBY3RpdmUoZW50cnkpXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IHRoaXMuZmluaXNoQWN0aXZlRGlnZXN0KGRpZ2VzdClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYW4gZXhpc3RpbmcgbG9jYWwgVVJJIHdoaWxlIGl0cyBkaWdlc3QgaXMgcHJvdGVjdGVkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZUVudHJ5fSBlbnRyeSBEZXNjcmlwdG9yIHN0YXRlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmcgfCBudWxsPn0gRXhpc3RpbmcgVVJJLlxuICAgKi9cbiAgYXN5bmMgY2FjaGVkVXJpV2hpbGVBY3RpdmUoZW50cnkpIHtcbiAgICBjb25zdCB1cmkgPSBhd2FpdCB0aGlzLmFkYXB0ZXIuYmxvYlVyaSh7XG4gICAgICBhY2NvdW50SWQ6IHRoaXMuYWNjb3VudElkLFxuICAgICAgZGlnZXN0OiBlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdFxuICAgIH0pXG5cbiAgICBpZiAoIXVyaSAmJiBlbnRyeS5zdGF0dXMgPT09IFwiY2FjaGVkXCIpIGVudHJ5LnN0YXR1cyA9IFwibWlzc2luZ1wiXG5cbiAgICByZXR1cm4gdXJpXG4gIH1cblxuICAvKipcbiAgICogV2FpdHMgZm9yIGRlbGV0aW9uIGFuZCBwcm90ZWN0cyBhIGRpZ2VzdCBmb3Igb25lIGFjdGl2ZSBjYWNoZSBvcGVyYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBkaWdlc3QgQ29udGVudCBkaWdlc3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyBhZnRlciBwcm90ZWN0aW9uIGlzIHJlZ2lzdGVyZWQuXG4gICAqL1xuICBhc3luYyBiZWdpbkFjdGl2ZURpZ2VzdChkaWdlc3QpIHtcbiAgICBsZXQgZGVsZXRpb25Qcm9taXNlID0gdGhpcy5kZWxldGlvblByb21pc2VzLmdldChkaWdlc3QpXG5cbiAgICB3aGlsZSAoZGVsZXRpb25Qcm9taXNlKSB7XG4gICAgICBhd2FpdCBkZWxldGlvblByb21pc2VcbiAgICAgIGRlbGV0aW9uUHJvbWlzZSA9IHRoaXMuZGVsZXRpb25Qcm9taXNlcy5nZXQoZGlnZXN0KVxuICAgIH1cblxuICAgIGNvbnN0IGFjdGl2ZUNvdW50ID0gdGhpcy5hY3RpdmVEaWdlc3RDb3VudHMuZ2V0KGRpZ2VzdCkgPz8gMFxuXG4gICAgdGhpcy5hY3RpdmVEaWdlc3RDb3VudHMuc2V0KGRpZ2VzdCwgYWN0aXZlQ291bnQgKyAxKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlbGVhc2VzIG9uZSBjYWNoZSBvcGVyYXRpb24gYW5kIHByb2Nlc3NlcyBkZWZlcnJlZCBkZWxldGlvbiBhZnRlciB0aGUgbGFzdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGRpZ2VzdCBDb250ZW50IGRpZ2VzdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIGFmdGVyIGFueSBwZW5kaW5nIGRlbGV0aW9uLlxuICAgKi9cbiAgYXN5bmMgZmluaXNoQWN0aXZlRGlnZXN0KGRpZ2VzdCkge1xuICAgIGNvbnN0IGFjdGl2ZUNvdW50ID0gdGhpcy5hY3RpdmVEaWdlc3RDb3VudHMuZ2V0KGRpZ2VzdClcblxuICAgIGlmIChhY3RpdmVDb3VudCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE1pc3NpbmcgYWN0aXZlIHN5bmNocm9uaXplZCBhc3NldCBkaWdlc3QgY291bnQgZm9yICR7ZGlnZXN0fWApXG4gICAgfVxuXG4gICAgaWYgKGFjdGl2ZUNvdW50ID4gMSkge1xuICAgICAgdGhpcy5hY3RpdmVEaWdlc3RDb3VudHMuc2V0KGRpZ2VzdCwgYWN0aXZlQ291bnQgLSAxKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdGhpcy5hY3RpdmVEaWdlc3RDb3VudHMuZGVsZXRlKGRpZ2VzdClcbiAgICBhd2FpdCB0aGlzLmRlbGV0ZVBlbmRpbmdEaWdlc3RJZlVucmVmZXJlbmNlZChkaWdlc3QpXG4gIH1cblxuICAvKipcbiAgICogUmVsZWFzZXMgZXZlcnkgYWNxdWlyZWQgZGlnZXN0IGJlZm9yZSBwcm9wYWdhdGluZyBmaW5hbGl6YXRpb24gZmFpbHVyZXMuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGRpZ2VzdHMgQ29udGVudCBkaWdlc3RzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgYWZ0ZXIgZXZlcnkgZGlnZXN0IGlzIHJlbGVhc2VkLlxuICAgKi9cbiAgYXN5bmMgZmluaXNoQWN0aXZlRGlnZXN0cyhkaWdlc3RzKSB7XG4gICAgLyoqIEB0eXBlIHtFcnJvcltdfSAqL1xuICAgIGNvbnN0IGZhaWx1cmVzID0gW11cblxuICAgIGZvciAoY29uc3QgZGlnZXN0IG9mIGRpZ2VzdHMpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMuZmluaXNoQWN0aXZlRGlnZXN0KGRpZ2VzdClcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGZhaWx1cmVzLnB1c2goZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpKVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChmYWlsdXJlcy5sZW5ndGggPT09IDEpIHRocm93IGZhaWx1cmVzWzBdXG4gICAgaWYgKGZhaWx1cmVzLmxlbmd0aCA+IDEpIHtcbiAgICAgIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihmYWlsdXJlcywgXCJNdWx0aXBsZSBzeW5jaHJvbml6ZWQgYXNzZXQgZGlnZXN0IGZpbmFsaXplcnMgZmFpbGVkXCIsIHtjYXVzZTogZmFpbHVyZXNbMF19KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBEZWxldGVzIGJsb2JzIHRoYXQgbG9zdCB0aGVpciBmaW5hbCBkZXNjcmlwdG9yIHJlZmVyZW5jZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIGFmdGVyIGRlbGV0aW9uLlxuICAgKi9cbiAgYXN5bmMgZGVsZXRlVW5yZWZlcmVuY2VkRGlnZXN0cygpIHtcbiAgICBpZiAoIXRoaXMuc3RhdGUpIHRocm93IG5ldyBFcnJvcihcIkNhbm5vdCBkZWxldGUgc3luY2hyb25pemVkIGFzc2V0IGJsb2JzIGJlZm9yZSBsb2FkaW5nIHN0YXRlXCIpXG5cbiAgICBmb3IgKGNvbnN0IGRpZ2VzdCBvZiBbLi4udGhpcy5zdGF0ZS5wZW5kaW5nRGVsZXRpb25EaWdlc3RzXSkge1xuICAgICAgYXdhaXQgdGhpcy5kZWxldGVQZW5kaW5nRGlnZXN0SWZVbnJlZmVyZW5jZWQoZGlnZXN0KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBEZWxldGVzIG9uZSBwZXJzaXN0ZWQgcGVuZGluZyBkaWdlc3Qgd2hlbiBubyBkZXNjcmlwdG9yIG9yIGFjdGl2ZSBvcGVyYXRpb24gb3ducyBpdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGRpZ2VzdCBDb250ZW50IGRpZ2VzdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIGFmdGVyIGFueSByZXF1aXJlZCBkZWxldGlvbi5cbiAgICovXG4gIGFzeW5jIGRlbGV0ZVBlbmRpbmdEaWdlc3RJZlVucmVmZXJlbmNlZChkaWdlc3QpIHtcbiAgICBpZiAoIXRoaXMuc3RhdGUpIHRocm93IG5ldyBFcnJvcihcIkNhbm5vdCBkZWxldGUgc3luY2hyb25pemVkIGFzc2V0IGJsb2JzIGJlZm9yZSBsb2FkaW5nIHN0YXRlXCIpXG4gICAgaWYgKCF0aGlzLnN0YXRlLnBlbmRpbmdEZWxldGlvbkRpZ2VzdHMuaW5jbHVkZXMoZGlnZXN0KSkgcmV0dXJuXG5cbiAgICBhd2FpdCB0aGlzLmRlbGV0ZURpZ2VzdElmSW5hY3RpdmUoZGlnZXN0LCBhc3luYyAoKSA9PiB7XG4gICAgICBpZiAoIXRoaXMuc3RhdGUpIHRocm93IG5ldyBFcnJvcihcIkNhbm5vdCBkZWxldGUgc3luY2hyb25pemVkIGFzc2V0IGJsb2JzIGJlZm9yZSBsb2FkaW5nIHN0YXRlXCIpXG4gICAgICBpZiAoIXRoaXMuc3RhdGUucGVuZGluZ0RlbGV0aW9uRGlnZXN0cy5pbmNsdWRlcyhkaWdlc3QpKSByZXR1cm4gZmFsc2VcblxuICAgICAgbGV0IGRlbGV0ZWQgPSBmYWxzZVxuXG4gICAgICBpZiAoIXRoaXMuc3RhdGUuYXNzZXRzLnNvbWUoKGVudHJ5KSA9PiBlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdCA9PT0gZGlnZXN0KSkge1xuICAgICAgICBhd2FpdCB0aGlzLmFkYXB0ZXIuZGVsZXRlQmxvYih7YWNjb3VudElkOiB0aGlzLmFjY291bnRJZCwgZGlnZXN0fSlcbiAgICAgICAgZGVsZXRlZCA9IHRydWVcbiAgICAgIH1cblxuICAgICAgY29uc3QgcGVuZGluZ0RlbGV0aW9uRGlnZXN0cyA9IHRoaXMuc3RhdGUucGVuZGluZ0RlbGV0aW9uRGlnZXN0c1xuXG4gICAgICB0aGlzLnN0YXRlLnBlbmRpbmdEZWxldGlvbkRpZ2VzdHMgPSBwZW5kaW5nRGVsZXRpb25EaWdlc3RzLmZpbHRlcigoY2FuZGlkYXRlKSA9PiBjYW5kaWRhdGUgIT09IGRpZ2VzdClcblxuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5zYXZlU3RhdGUoKVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgaWYgKCF0aGlzLnN0YXRlLnBlbmRpbmdEZWxldGlvbkRpZ2VzdHMuaW5jbHVkZXMoZGlnZXN0KSkgdGhpcy5zdGF0ZS5wZW5kaW5nRGVsZXRpb25EaWdlc3RzLnB1c2goZGlnZXN0KVxuICAgICAgICB0aHJvdyBlcnJvclxuICAgICAgfVxuXG4gICAgICByZXR1cm4gZGVsZXRlZFxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBvbmUgZGVsZXRpb24gb25seSBhZnRlciBlYXJsaWVyIGRlbGV0aW9uIHdvcmsgYW5kIHdoZW4gbm8gY2FjaGUgb3BlcmF0aW9uIG93bnMgdGhlIGRpZ2VzdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGRpZ2VzdCBDb250ZW50IGRpZ2VzdC5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPGJvb2xlYW4+fSBjYWxsYmFjayBQcm90ZWN0ZWQgZGVsZXRpb24gY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSBXaGV0aGVyIHRoZSBjYWxsYmFjayBkZWxldGVkIHRoZSBibG9iLlxuICAgKi9cbiAgYXN5bmMgZGVsZXRlRGlnZXN0SWZJbmFjdGl2ZShkaWdlc3QsIGNhbGxiYWNrKSB7XG4gICAgbGV0IGFjdGl2ZURlbGV0aW9uUHJvbWlzZSA9IHRoaXMuZGVsZXRpb25Qcm9taXNlcy5nZXQoZGlnZXN0KVxuXG4gICAgd2hpbGUgKGFjdGl2ZURlbGV0aW9uUHJvbWlzZSkge1xuICAgICAgYXdhaXQgYWN0aXZlRGVsZXRpb25Qcm9taXNlXG4gICAgICBhY3RpdmVEZWxldGlvblByb21pc2UgPSB0aGlzLmRlbGV0aW9uUHJvbWlzZXMuZ2V0KGRpZ2VzdClcbiAgICB9XG5cbiAgICBpZiAodGhpcy5hY3RpdmVEaWdlc3RDb3VudHMuaGFzKGRpZ2VzdCkpIHJldHVybiBmYWxzZVxuXG4gICAgLyoqXG4gICAgICogUmVsZWFzZXMgY2FsbGVycyB3YWl0aW5nIGZvciBkZWxldGlvbiBjb21wbGV0aW9uLlxuICAgICAqIEB0eXBlIHsoKSA9PiB2b2lkfVxuICAgICAqL1xuICAgIGxldCByZWxlYXNlRGVsZXRpb24gPSAoKSA9PiB7fVxuICAgIC8qKlxuICAgICAqIEJsb2NrcyBuZXcgZGlnZXN0IGFjdGl2aXR5IHVudGlsIGRlbGV0aW9uIGNvbXBsZXRlcy5cbiAgICAgKiBAdHlwZSB7UHJvbWlzZTx2b2lkPn1cbiAgICAgKi9cbiAgICBjb25zdCBkZWxldGlvblByb21pc2UgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgICAgcmVsZWFzZURlbGV0aW9uID0gKCkgPT4gcmVzb2x2ZSh1bmRlZmluZWQpXG4gICAgfSlcblxuICAgIHRoaXMuZGVsZXRpb25Qcm9taXNlcy5zZXQoZGlnZXN0LCBkZWxldGlvblByb21pc2UpXG5cbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKClcbiAgICB9IGZpbmFsbHkge1xuICAgICAgaWYgKHRoaXMuZGVsZXRpb25Qcm9taXNlcy5nZXQoZGlnZXN0KSA9PT0gZGVsZXRpb25Qcm9taXNlKSB0aGlzLmRlbGV0aW9uUHJvbWlzZXMuZGVsZXRlKGRpZ2VzdClcbiAgICAgIHJlbGVhc2VEZWxldGlvbigpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEZpbmRzIHJlcXVpcmVkIGFzc2V0cyB3aXRob3V0IGxvY2FsbHkgY2FjaGVkIGJ5dGVzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2NvcGVLZXkgU3luY2hyb25pemVkIHNjb3BlIHRvIGluc3BlY3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZ1tdPn0gTWlzc2luZyByZXF1aXJlZCBkZXNjcmlwdG9yIGlkcy5cbiAgICovXG4gIGFzeW5jIG1pc3NpbmdSZXF1aXJlZEFzc2V0SWRzKHNjb3BlS2V5KSB7XG4gICAgY29uc3Qgc3RhdGUgPSBhd2FpdCB0aGlzLmxvYWRTdGF0ZSgpXG4gICAgLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgICBjb25zdCBtaXNzaW5nQXNzZXRJZHMgPSBbXVxuXG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiBzdGF0ZS5hc3NldHMpIHtcbiAgICAgIGlmICghZW50cnkuc2NvcGVLZXlzLmluY2x1ZGVzKHNjb3BlS2V5KSkgY29udGludWVcbiAgICAgIGlmIChlbnRyeS5kZXNjcmlwdG9yLm9mZmxpbmVSZXF1aXJlbWVudCAhPT0gXCJyZXF1aXJlZFwiKSBjb250aW51ZVxuICAgICAgaWYgKGF3YWl0IHRoaXMuY2FjaGVkVXJpKGVudHJ5KSkgY29udGludWVcblxuICAgICAgbWlzc2luZ0Fzc2V0SWRzLnB1c2goZW50cnkuZGVzY3JpcHRvci5pZClcbiAgICB9XG5cbiAgICByZXR1cm4gbWlzc2luZ0Fzc2V0SWRzXG4gIH1cblxuICAvKipcbiAgICogQ2hlY2tzIHdoZXRoZXIgYSBmYWlsZWQgb3IgbWlzc2luZyBlbnRyeSBtYXkgYmUgZG93bmxvYWRlZCBub3cuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlRW50cnl9IGVudHJ5IERlc2NyaXB0b3Igc3RhdGUuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSBXaGV0aGVyIHRoZSByZXRyeSBkZWFkbGluZSBoYXMgcGFzc2VkLlxuICAgKi9cbiAgcmV0cnlFbGlnaWJsZShlbnRyeSkge1xuICAgIHJldHVybiBlbnRyeS5zdGF0dXMgIT09IFwiZmFpbGVkXCIgfHwgZW50cnkubmV4dFJldHJ5QXQgPT09IG51bGwgfHwgZW50cnkubmV4dFJldHJ5QXQgPD0gdGhpcy5ub3dNaWxsaXNlY29uZHMoKVxuICB9XG5cbiAgLyoqXG4gICAqIENhbGN1bGF0ZXMgYm91bmRlZCBleHBvbmVudGlhbCByZXRyeSBkZWxheS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGF0dGVtcHRzIENvbnNlY3V0aXZlIGZhaWx1cmVzLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSBSZXRyeSBkZWxheS5cbiAgICovXG4gIHJldHJ5RGVsYXkoYXR0ZW1wdHMpIHtcbiAgICByZXR1cm4gTWF0aC5taW4odGhpcy5yZXRyeU1heERlbGF5TXMsIHRoaXMucmV0cnlCYXNlRGVsYXlNcyAqICgyICoqIE1hdGgubWF4KDAsIGF0dGVtcHRzIC0gMSkpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWRzIHRoZSBpbmplY3RhYmxlIHdhbGwgY2xvY2suXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IEN1cnJlbnQgZXBvY2ggbWlsbGlzZWNvbmRzLlxuICAgKi9cbiAgbm93TWlsbGlzZWNvbmRzKCkge1xuICAgIHJldHVybiB0aGlzLm5vdygpLmdldFRpbWUoKVxuICB9XG59XG4iXX0=