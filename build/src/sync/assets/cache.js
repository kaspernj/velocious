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
        /** @type {import("./types.js").SynchronizedAssetCacheFailure[]} */
        const failures = [];
        if (online) {
            for (const asset of descriptors) {
                if (asset.fetch !== "eager")
                    continue;
                const entry = entriesById.get(asset.id);
                if (!entry || !this.retryEligible(entry))
                    continue;
                const cacheResult = await this.ensureCached(entry);
                if (cacheResult.error)
                    failures.push({ assetId: asset.id, error: cacheResult.error });
            }
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
        this.beginActiveDigest(digest);
        try {
            const cachedUri = await this.cachedUri(entry);
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
        /** @type {{byteSize: number, digest: string, lastAccessedAt: number, references: import("./types.js").SynchronizedAssetCacheEntry[]}[]} */
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
                lastAccessedAt: Math.max(...references.map((entry) => entry.lastAccessedAt)),
                references
            });
        }
        cachedBlobs.sort((left, right) => left.lastAccessedAt - right.lastAccessedAt || left.digest.localeCompare(right.digest));
        let removedBytes = 0;
        for (const blob of cachedBlobs) {
            if (cachedBytes <= this.maxBytes)
                break;
            if (protectedDigests.has(blob.digest))
                continue;
            if (this.activeDigestCounts.has(blob.digest))
                continue;
            if (blob.references.some((entry) => entry.descriptor.retention === "durable"))
                continue;
            await this.adapter.deleteBlob({ accountId: this.accountId, digest: blob.digest });
            cachedBytes -= blob.byteSize;
            removedBytes += blob.byteSize;
            for (const entry of blob.references) {
                entry.attempts = 0;
                entry.nextRetryAt = null;
                entry.status = "missing";
            }
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
        this.beginActiveDigest(digest);
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
        const existingUri = await this.cachedUri(entry);
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
            downloadPromise = this.downloadVerified(entry.descriptor);
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
            entry.attempts += 1;
            entry.nextRetryAt = this.nowMilliseconds() + this.retryDelay(entry.attempts);
            entry.status = "failed";
            await this.saveState();
            return { error: failure, uri: null };
        }
        finally {
            if (ownsDownloadPromise && this.downloadPromises.get(digest) === downloadPromise) {
                this.downloadPromises.delete(digest);
            }
        }
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
     * Resolves an existing local URI and repairs stale cached metadata.
     * @param {import("./types.js").SynchronizedAssetCacheEntry} entry Descriptor state.
     * @returns {Promise<string | null>} Existing URI.
     */
    async cachedUri(entry) {
        const uri = await this.adapter.blobUri({
            accountId: this.accountId,
            digest: entry.descriptor.digest
        });
        if (!uri && entry.status === "cached")
            entry.status = "missing";
        return uri;
    }
    /**
     * Protects a digest for the duration of one active cache operation.
     * @param {string} digest Content digest.
     * @returns {void}
     */
    beginActiveDigest(digest) {
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
        if (this.activeDigestCounts.has(digest))
            return;
        if (!this.state.assets.some((entry) => entry.descriptor.digest === digest)) {
            await this.adapter.deleteBlob({ accountId: this.accountId, digest });
        }
        const pendingDeletionDigests = this.state.pendingDeletionDigests;
        this.state.pendingDeletionDigests = pendingDeletionDigests.filter((candidate) => candidate !== digest);
        try {
            await this.saveState();
        }
        catch (error) {
            this.state.pendingDeletionDigests = pendingDeletionDigests;
            throw error;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2FjaGUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvc3luYy9hc3NldHMvY2FjaGUuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sY0FBYyxNQUFNLGlDQUFpQyxDQUFBO0FBRTVELE1BQU0sbUJBQW1CLEdBQUcsQ0FBQyxDQUFBO0FBQzdCLE1BQU0sMkJBQTJCLEdBQUcsSUFBSSxDQUFBO0FBQ3hDLE1BQU0sMEJBQTBCLEdBQUcsSUFBSSxHQUFHLEVBQUUsR0FBRyxDQUFDLENBQUE7QUFFaEQ7OztHQUdHO0FBQ0gsTUFBTSxDQUFDLE9BQU8sT0FBTyxzQkFBc0I7SUFDekM7Ozs7Ozs7Ozs7T0FVRztJQUNILFlBQVksRUFBQyxTQUFTLEVBQUUsT0FBTyxFQUFFLFFBQVEsRUFBRSxRQUFRLEVBQUUsR0FBRyxHQUFHLEdBQUcsRUFBRSxDQUFDLElBQUksSUFBSSxFQUFFLEVBQUUsZ0JBQWdCLEdBQUcsMkJBQTJCLEVBQUUsZUFBZSxHQUFHLDBCQUEwQixFQUFDO1FBQ3hLLElBQUksQ0FBQyxTQUFTO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxpREFBaUQsQ0FBQyxDQUFBO1FBQ2xGLElBQUksQ0FBQyxNQUFNLENBQUMsYUFBYSxDQUFDLFFBQVEsQ0FBQyxJQUFJLFFBQVEsR0FBRyxDQUFDO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyx1RUFBdUUsQ0FBQyxDQUFBO1FBQzdJLElBQUksQ0FBQyxNQUFNLENBQUMsYUFBYSxDQUFDLGdCQUFnQixDQUFDLElBQUksZ0JBQWdCLEdBQUcsQ0FBQztZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsMkVBQTJFLENBQUMsQ0FBQTtRQUNqSyxJQUFJLENBQUMsTUFBTSxDQUFDLGFBQWEsQ0FBQyxlQUFlLENBQUMsSUFBSSxlQUFlLEdBQUcsZ0JBQWdCO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyw0RUFBNEUsQ0FBQyxDQUFBO1FBRS9LLElBQUksQ0FBQyxTQUFTLEdBQUcsU0FBUyxDQUFBO1FBQzFCLElBQUksQ0FBQyxPQUFPLEdBQUcsT0FBTyxDQUFBO1FBQ3RCLElBQUksQ0FBQyxRQUFRLEdBQUcsUUFBUSxDQUFBO1FBQ3hCLElBQUksQ0FBQyxRQUFRLEdBQUcsUUFBUSxDQUFBO1FBQ3hCLElBQUksQ0FBQyxHQUFHLEdBQUcsR0FBRyxDQUFBO1FBQ2QsSUFBSSxDQUFDLGdCQUFnQixHQUFHLGdCQUFnQixDQUFBO1FBQ3hDLElBQUksQ0FBQyxlQUFlLEdBQUcsZUFBZSxDQUFBO1FBQ3RDLGtDQUFrQztRQUNsQyxJQUFJLENBQUMsa0JBQWtCLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQTtRQUNuQywyQ0FBMkM7UUFDM0MsSUFBSSxDQUFDLGdCQUFnQixHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7UUFDakMsc0VBQXNFO1FBQ3RFLElBQUksQ0FBQyxLQUFLLEdBQUcsSUFBSSxDQUFBO1FBQ2pCLCtFQUErRTtRQUMvRSxJQUFJLENBQUMsWUFBWSxHQUFHLElBQUksQ0FBQTtRQUN4Qiw0QkFBNEI7UUFDNUIsSUFBSSxDQUFDLGdCQUFnQixHQUFHLE9BQU8sQ0FBQyxPQUFPLEVBQUUsQ0FBQTtJQUMzQyxDQUFDO0lBRUQ7Ozs7Ozs7O09BUUc7SUFDSCxLQUFLLENBQUMsV0FBVyxDQUFDLEVBQUMsV0FBVyxFQUFFLE1BQU0sRUFBRSxRQUFRLEVBQUM7UUFDL0MsTUFBTSxLQUFLLEdBQUcsTUFBTSxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUE7UUFDcEMsTUFBTSxXQUFXLEdBQUcsSUFBSSxHQUFHLENBQUMsV0FBVyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUE7UUFDakUsTUFBTSxXQUFXLEdBQUcsSUFBSSxHQUFHLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLENBQUMsS0FBSyxDQUFDLFVBQVUsQ0FBQyxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFBO1FBQ3RGLE1BQU0sV0FBVyxHQUFHLElBQUksR0FBRyxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsRUFBRSxFQUFFLEtBQUssQ0FBQyxVQUFVLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFBO1FBQ3hHLE1BQU0sY0FBYyxHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7UUFFaEMsS0FBSyxNQUFNLEtBQUssSUFBSSxXQUFXLEVBQUUsQ0FBQztZQUNoQyxNQUFNLFdBQVcsR0FBRyxXQUFXLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUMsQ0FBQTtZQUU3QyxJQUFJLFdBQVcsS0FBSyxTQUFTLElBQUksV0FBVyxLQUFLLEtBQUssQ0FBQyxNQUFNLEVBQUUsQ0FBQztnQkFDOUQsTUFBTSxJQUFJLEtBQUssQ0FBQyxpQ0FBaUMsS0FBSyxDQUFDLEVBQUUsK0JBQStCLENBQUMsQ0FBQTtZQUMzRixDQUFDO1lBRUQsV0FBVyxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsRUFBRSxFQUFFLEtBQUssQ0FBQyxNQUFNLENBQUMsQ0FBQTtRQUN6QyxDQUFDO1FBRUQsS0FBSyxNQUFNLEtBQUssSUFBSSxLQUFLLENBQUMsTUFBTSxFQUFFLENBQUM7WUFDakMsSUFBSSxDQUFDLEtBQUssQ0FBQyxTQUFTLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQyxJQUFJLFdBQVcsQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLFVBQVUsQ0FBQyxFQUFFLENBQUM7Z0JBQUUsU0FBUTtZQUV6RixLQUFLLENBQUMsU0FBUyxHQUFHLEtBQUssQ0FBQyxTQUFTLENBQUMsTUFBTSxDQUFDLENBQUMsU0FBUyxFQUFFLEVBQUUsQ0FBQyxTQUFTLEtBQUssUUFBUSxDQUFDLENBQUE7WUFDL0UsSUFBSSxLQUFLLENBQUMsU0FBUyxDQUFDLE1BQU0sS0FBSyxDQUFDO2dCQUFFLGNBQWMsQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLFVBQVUsQ0FBQyxNQUFNLENBQUMsQ0FBQTtRQUMvRSxDQUFDO1FBRUQsS0FBSyxDQUFDLE1BQU0sR0FBRyxLQUFLLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsS0FBSyxDQUFDLFNBQVMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDLENBQUE7UUFFekUsS0FBSyxNQUFNLEtBQUssSUFBSSxXQUFXLEVBQUUsQ0FBQztZQUNoQyxNQUFNLFFBQVEsR0FBRyxXQUFXLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUMsQ0FBQTtZQUUxQyxJQUFJLFFBQVEsSUFBSSxLQUFLLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDO2dCQUNoRCxRQUFRLENBQUMsVUFBVSxHQUFHLEtBQUssQ0FBQTtnQkFDM0IsSUFBSSxDQUFDLFFBQVEsQ0FBQyxTQUFTLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQztvQkFBRSxRQUFRLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQTtZQUMvRSxDQUFDO2lCQUFNLENBQUM7Z0JBQ04sTUFBTSxRQUFRLEdBQUc7b0JBQ2YsUUFBUSxFQUFFLENBQUM7b0JBQ1gsVUFBVSxFQUFFLEtBQUs7b0JBQ2pCLGNBQWMsRUFBRSxJQUFJLENBQUMsZUFBZSxFQUFFO29CQUN0QyxXQUFXLEVBQUUsSUFBSTtvQkFDakIsU0FBUyxFQUFFLENBQUMsUUFBUSxDQUFDO29CQUNyQixNQUFNLEVBQUUsb0JBQW9CLENBQUMsQ0FBQyxTQUFTLENBQUM7aUJBQ3pDLENBQUE7Z0JBRUQsS0FBSyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUE7Z0JBQzNCLFdBQVcsQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLEVBQUUsRUFBRSxRQUFRLENBQUMsQ0FBQTtZQUNyQyxDQUFDO1FBQ0gsQ0FBQztRQUVELEtBQUssTUFBTSxNQUFNLElBQUksY0FBYyxFQUFFLENBQUM7WUFDcEMsSUFBSSxLQUFLLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsS0FBSyxDQUFDLFVBQVUsQ0FBQyxNQUFNLEtBQUssTUFBTSxDQUFDO2dCQUFFLFNBQVE7WUFDOUUsSUFBSSxDQUFDLEtBQUssQ0FBQyxzQkFBc0IsQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDO2dCQUFFLEtBQUssQ0FBQyxzQkFBc0IsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUE7UUFDL0YsQ0FBQztRQUVELE1BQU0sSUFBSSxDQUFDLFNBQVMsRUFBRSxDQUFBO1FBQ3RCLE1BQU0sSUFBSSxDQUFDLHlCQUF5QixFQUFFLENBQUE7UUFFdEMsbUVBQW1FO1FBQ25FLE1BQU0sUUFBUSxHQUFHLEVBQUUsQ0FBQTtRQUVuQixJQUFJLE1BQU0sRUFBRSxDQUFDO1lBQ1gsS0FBSyxNQUFNLEtBQUssSUFBSSxXQUFXLEVBQUUsQ0FBQztnQkFDaEMsSUFBSSxLQUFLLENBQUMsS0FBSyxLQUFLLE9BQU87b0JBQUUsU0FBUTtnQkFFckMsTUFBTSxLQUFLLEdBQUcsV0FBVyxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDLENBQUE7Z0JBRXZDLElBQUksQ0FBQyxLQUFLLElBQUksQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLEtBQUssQ0FBQztvQkFBRSxTQUFRO2dCQUVsRCxNQUFNLFdBQVcsR0FBRyxNQUFNLElBQUksQ0FBQyxZQUFZLENBQUMsS0FBSyxDQUFDLENBQUE7Z0JBRWxELElBQUksV0FBVyxDQUFDLEtBQUs7b0JBQUUsUUFBUSxDQUFDLElBQUksQ0FBQyxFQUFDLE9BQU8sRUFBRSxLQUFLLENBQUMsRUFBRSxFQUFFLEtBQUssRUFBRSxXQUFXLENBQUMsS0FBSyxFQUFDLENBQUMsQ0FBQTtZQUNyRixDQUFDO1FBQ0gsQ0FBQztRQUVELE1BQU0sSUFBSSxDQUFDLE9BQU8sRUFBRSxDQUFBO1FBRXBCLE9BQU87WUFDTCxRQUFRO1lBQ1IsdUJBQXVCLEVBQUUsTUFBTSxJQUFJLENBQUMsdUJBQXVCLENBQUMsUUFBUSxDQUFDO1NBQ3RFLENBQUE7SUFDSCxDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsS0FBSyxDQUFDLE9BQU8sQ0FBQyxFQUFDLE9BQU8sRUFBRSxNQUFNLEVBQUM7UUFDN0IsTUFBTSxLQUFLLEdBQUcsTUFBTSxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUE7UUFDcEMsTUFBTSxLQUFLLEdBQUcsS0FBSyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQyxTQUFTLEVBQUUsRUFBRSxDQUFDLFNBQVMsQ0FBQyxVQUFVLENBQUMsRUFBRSxLQUFLLE9BQU8sQ0FBQyxDQUFBO1FBRW5GLElBQUksQ0FBQyxLQUFLO1lBQUUsT0FBTyxJQUFJLENBQUE7UUFFdkIsTUFBTSxNQUFNLEdBQUcsS0FBSyxDQUFDLFVBQVUsQ0FBQyxNQUFNLENBQUE7UUFFdEMsSUFBSSxDQUFDLGlCQUFpQixDQUFDLE1BQU0sQ0FBQyxDQUFBO1FBRTlCLElBQUksQ0FBQztZQUNILE1BQU0sU0FBUyxHQUFHLE1BQU0sSUFBSSxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUMsQ0FBQTtZQUU3QyxJQUFJLFNBQVMsRUFBRSxDQUFDO2dCQUNkLEtBQUssQ0FBQyxjQUFjLEdBQUcsSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFBO2dCQUM3QyxLQUFLLENBQUMsTUFBTSxHQUFHLFFBQVEsQ0FBQTtnQkFDdkIsTUFBTSxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUE7Z0JBRXRCLE9BQU8sU0FBUyxDQUFBO1lBQ2xCLENBQUM7WUFFRCxJQUFJLENBQUMsTUFBTSxJQUFJLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxLQUFLLENBQUM7Z0JBQUUsT0FBTyxJQUFJLENBQUE7WUFFdEQsTUFBTSxXQUFXLEdBQUcsTUFBTSxJQUFJLENBQUMsdUJBQXVCLENBQUMsS0FBSyxDQUFDLENBQUE7WUFFN0QsSUFBSSxXQUFXLENBQUMsS0FBSztnQkFBRSxNQUFNLFdBQVcsQ0FBQyxLQUFLLENBQUE7WUFDOUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxHQUFHO2dCQUFFLE9BQU8sSUFBSSxDQUFBO1lBRWpDLE1BQU0sSUFBSSxDQUFDLE9BQU8sQ0FBQyxJQUFJLEdBQUcsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQTtZQUVyQyxPQUFPLFdBQVcsQ0FBQyxHQUFHLENBQUE7UUFDeEIsQ0FBQztnQkFBUyxDQUFDO1lBQ1QsTUFBTSxJQUFJLENBQUMsa0JBQWtCLENBQUMsTUFBTSxDQUFDLENBQUE7UUFDdkMsQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxLQUFLLENBQUMsT0FBTyxDQUFDLGdCQUFnQixHQUFHLElBQUksR0FBRyxFQUFFO1FBQ3hDLE1BQU0sS0FBSyxHQUFHLE1BQU0sSUFBSSxDQUFDLFNBQVMsRUFBRSxDQUFBO1FBQ3BDLDhFQUE4RTtRQUM5RSxNQUFNLGVBQWUsR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFBO1FBRWpDLEtBQUssTUFBTSxLQUFLLElBQUksS0FBSyxDQUFDLE1BQU0sRUFBRSxDQUFDO1lBQ2pDLE1BQU0sYUFBYSxHQUFHLGVBQWUsQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLFVBQVUsQ0FBQyxNQUFNLENBQUMsSUFBSSxFQUFFLENBQUE7WUFFeEUsYUFBYSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQTtZQUN6QixlQUFlLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsTUFBTSxFQUFFLGFBQWEsQ0FBQyxDQUFBO1FBQzdELENBQUM7UUFFRCwySUFBMkk7UUFDM0ksTUFBTSxXQUFXLEdBQUcsRUFBRSxDQUFBO1FBQ3RCLElBQUksV0FBVyxHQUFHLENBQUMsQ0FBQTtRQUVuQixLQUFLLE1BQU0sQ0FBQyxNQUFNLEVBQUUsVUFBVSxDQUFDLElBQUksZUFBZSxFQUFFLENBQUM7WUFDbkQsTUFBTSxHQUFHLEdBQUcsTUFBTSxJQUFJLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxFQUFDLFNBQVMsRUFBRSxJQUFJLENBQUMsU0FBUyxFQUFFLE1BQU0sRUFBQyxDQUFDLENBQUE7WUFFM0UsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDO2dCQUNULEtBQUssTUFBTSxLQUFLLElBQUksVUFBVSxFQUFFLENBQUM7b0JBQy9CLElBQUksS0FBSyxDQUFDLE1BQU0sS0FBSyxRQUFRO3dCQUFFLEtBQUssQ0FBQyxNQUFNLEdBQUcsU0FBUyxDQUFBO2dCQUN6RCxDQUFDO2dCQUNELFNBQVE7WUFDVixDQUFDO1lBRUQsTUFBTSxRQUFRLEdBQUcsVUFBVSxDQUFDLENBQUMsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxRQUFRLENBQUE7WUFFbEQsV0FBVyxJQUFJLFFBQVEsQ0FBQTtZQUN2QixXQUFXLENBQUMsSUFBSSxDQUFDO2dCQUNmLFFBQVE7Z0JBQ1IsTUFBTTtnQkFDTixjQUFjLEVBQUUsSUFBSSxDQUFDLEdBQUcsQ0FBQyxHQUFHLFVBQVUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLEtBQUssQ0FBQyxjQUFjLENBQUMsQ0FBQztnQkFDNUUsVUFBVTthQUNYLENBQUMsQ0FBQTtRQUNKLENBQUM7UUFFRCxXQUFXLENBQUMsSUFBSSxDQUFDLENBQUMsSUFBSSxFQUFFLEtBQUssRUFBRSxFQUFFLENBQUMsSUFBSSxDQUFDLGNBQWMsR0FBRyxLQUFLLENBQUMsY0FBYyxJQUFJLElBQUksQ0FBQyxNQUFNLENBQUMsYUFBYSxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFBO1FBRXhILElBQUksWUFBWSxHQUFHLENBQUMsQ0FBQTtRQUVwQixLQUFLLE1BQU0sSUFBSSxJQUFJLFdBQVcsRUFBRSxDQUFDO1lBQy9CLElBQUksV0FBVyxJQUFJLElBQUksQ0FBQyxRQUFRO2dCQUFFLE1BQUs7WUFDdkMsSUFBSSxnQkFBZ0IsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQztnQkFBRSxTQUFRO1lBQy9DLElBQUksSUFBSSxDQUFDLGtCQUFrQixDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDO2dCQUFFLFNBQVE7WUFDdEQsSUFBSSxJQUFJLENBQUMsVUFBVSxDQUFDLElBQUksQ0FBQyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsS0FBSyxDQUFDLFVBQVUsQ0FBQyxTQUFTLEtBQUssU0FBUyxDQUFDO2dCQUFFLFNBQVE7WUFFdkYsTUFBTSxJQUFJLENBQUMsT0FBTyxDQUFDLFVBQVUsQ0FBQyxFQUFDLFNBQVMsRUFBRSxJQUFJLENBQUMsU0FBUyxFQUFFLE1BQU0sRUFBRSxJQUFJLENBQUMsTUFBTSxFQUFDLENBQUMsQ0FBQTtZQUMvRSxXQUFXLElBQUksSUFBSSxDQUFDLFFBQVEsQ0FBQTtZQUM1QixZQUFZLElBQUksSUFBSSxDQUFDLFFBQVEsQ0FBQTtZQUU3QixLQUFLLE1BQU0sS0FBSyxJQUFJLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQztnQkFDcEMsS0FBSyxDQUFDLFFBQVEsR0FBRyxDQUFDLENBQUE7Z0JBQ2xCLEtBQUssQ0FBQyxXQUFXLEdBQUcsSUFBSSxDQUFBO2dCQUN4QixLQUFLLENBQUMsTUFBTSxHQUFHLFNBQVMsQ0FBQTtZQUMxQixDQUFDO1FBQ0gsQ0FBQztRQUVELE1BQU0sSUFBSSxDQUFDLFNBQVMsRUFBRSxDQUFBO1FBRXRCLE9BQU8sWUFBWSxDQUFBO0lBQ3JCLENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLLENBQUMsU0FBUztRQUNiLElBQUksSUFBSSxDQUFDLEtBQUs7WUFBRSxPQUFPLElBQUksQ0FBQyxLQUFLLENBQUE7UUFDakMsSUFBSSxJQUFJLENBQUMsWUFBWTtZQUFFLE9BQU8sTUFBTSxJQUFJLENBQUMsWUFBWSxDQUFBO1FBRXJELElBQUksQ0FBQyxZQUFZLEdBQUcsSUFBSSxDQUFDLG9CQUFvQixFQUFFLENBQUE7UUFFL0MsSUFBSSxDQUFDO1lBQ0gsSUFBSSxDQUFDLEtBQUssR0FBRyxNQUFNLElBQUksQ0FBQyxZQUFZLENBQUE7WUFFcEMsT0FBTyxJQUFJLENBQUMsS0FBSyxDQUFBO1FBQ25CLENBQUM7Z0JBQVMsQ0FBQztZQUNULElBQUksQ0FBQyxZQUFZLEdBQUcsSUFBSSxDQUFBO1FBQzFCLENBQUM7SUFDSCxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLG9CQUFvQjtRQUN4QixNQUFNLFdBQVcsR0FBRyxNQUFNLElBQUksQ0FBQyxPQUFPLENBQUMsU0FBUyxDQUFDLEVBQUMsU0FBUyxFQUFFLElBQUksQ0FBQyxTQUFTLEVBQUMsQ0FBQyxDQUFBO1FBRTdFLElBQUksQ0FBQyxXQUFXO1lBQUUsT0FBTyxFQUFDLE1BQU0sRUFBRSxFQUFFLEVBQUUsc0JBQXNCLEVBQUUsRUFBRSxFQUFFLE9BQU8sRUFBRSxtQkFBbUIsRUFBQyxDQUFBO1FBQy9GLElBQUksV0FBVyxDQUFDLE9BQU8sS0FBSyxtQkFBbUIsRUFBRSxDQUFDO1lBQ2hELE1BQU0sSUFBSSxLQUFLLENBQUMsdURBQXVELFdBQVcsQ0FBQyxPQUFPLEVBQUUsQ0FBQyxDQUFBO1FBQy9GLENBQUM7UUFFRCxJQUFJLDRCQUE0QixHQUFHLEtBQUssQ0FBQTtRQUV4QyxLQUFLLE1BQU0sS0FBSyxJQUFJLFdBQVcsQ0FBQyxNQUFNLEVBQUUsQ0FBQztZQUN2QyxJQUFJLEtBQUssQ0FBQyxNQUFNLEtBQUssYUFBYTtnQkFBRSxTQUFRO1lBRTVDLEtBQUssQ0FBQyxRQUFRLElBQUksQ0FBQyxDQUFBO1lBQ25CLEtBQUssQ0FBQyxXQUFXLEdBQUcsSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFBO1lBQzFDLEtBQUssQ0FBQyxNQUFNLEdBQUcsUUFBUSxDQUFBO1lBQ3ZCLDRCQUE0QixHQUFHLElBQUksQ0FBQTtRQUNyQyxDQUFDO1FBRUQsSUFBSSw0QkFBNEIsRUFBRSxDQUFDO1lBQ2pDLE1BQU0sSUFBSSxDQUFDLE9BQU8sQ0FBQyxTQUFTLENBQUMsRUFBQyxTQUFTLEVBQUUsSUFBSSxDQUFDLFNBQVMsRUFBRSxLQUFLLEVBQUUsV0FBVyxFQUFDLENBQUMsQ0FBQTtRQUMvRSxDQUFDO1FBRUQsT0FBTyxXQUFXLENBQUE7SUFDcEIsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxTQUFTO1FBQ2IsSUFBSSxDQUFDLElBQUksQ0FBQyxLQUFLO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQywyREFBMkQsQ0FBQyxDQUFBO1FBRTdGLE1BQU0sT0FBTyxHQUFHLEtBQUssSUFBSSxFQUFFO1lBQ3pCLElBQUksQ0FBQyxJQUFJLENBQUMsS0FBSztnQkFBRSxNQUFNLElBQUksS0FBSyxDQUFDLDJEQUEyRCxDQUFDLENBQUE7WUFFN0YsTUFBTSxJQUFJLENBQUMsT0FBTyxDQUFDLFNBQVMsQ0FBQyxFQUFDLFNBQVMsRUFBRSxJQUFJLENBQUMsU0FBUyxFQUFFLEtBQUssRUFBRSxJQUFJLENBQUMsS0FBSyxFQUFDLENBQUMsQ0FBQTtRQUM5RSxDQUFDLENBQUE7UUFFRCxJQUFJLENBQUMsZ0JBQWdCLEdBQUcsSUFBSSxDQUFDLGdCQUFnQixDQUFDLElBQUksQ0FBQyxPQUFPLEVBQUUsT0FBTyxDQUFDLENBQUE7UUFFcEUsTUFBTSxJQUFJLENBQUMsZ0JBQWdCLENBQUE7SUFDN0IsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsWUFBWSxDQUFDLEtBQUs7UUFDdEIsTUFBTSxNQUFNLEdBQUcsS0FBSyxDQUFDLFVBQVUsQ0FBQyxNQUFNLENBQUE7UUFFdEMsSUFBSSxDQUFDLGlCQUFpQixDQUFDLE1BQU0sQ0FBQyxDQUFBO1FBRTlCLElBQUksQ0FBQztZQUNILE9BQU8sTUFBTSxJQUFJLENBQUMsdUJBQXVCLENBQUMsS0FBSyxDQUFDLENBQUE7UUFDbEQsQ0FBQztnQkFBUyxDQUFDO1lBQ1QsTUFBTSxJQUFJLENBQUMsa0JBQWtCLENBQUMsTUFBTSxDQUFDLENBQUE7UUFDdkMsQ0FBQztJQUNILENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLHVCQUF1QixDQUFDLEtBQUs7UUFDakMsTUFBTSxXQUFXLEdBQUcsTUFBTSxJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxDQUFBO1FBRS9DLElBQUksV0FBVyxFQUFFLENBQUM7WUFDaEIsS0FBSyxDQUFDLFFBQVEsR0FBRyxDQUFDLENBQUE7WUFDbEIsS0FBSyxDQUFDLGNBQWMsR0FBRyxJQUFJLENBQUMsZUFBZSxFQUFFLENBQUE7WUFDN0MsS0FBSyxDQUFDLFdBQVcsR0FBRyxJQUFJLENBQUE7WUFDeEIsS0FBSyxDQUFDLE1BQU0sR0FBRyxRQUFRLENBQUE7WUFDdkIsTUFBTSxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUE7WUFFdEIsT0FBTyxFQUFDLEtBQUssRUFBRSxJQUFJLEVBQUUsR0FBRyxFQUFFLFdBQVcsRUFBQyxDQUFBO1FBQ3hDLENBQUM7UUFFRCxLQUFLLENBQUMsTUFBTSxHQUFHLGFBQWEsQ0FBQTtRQUM1QixNQUFNLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQTtRQUV0QixNQUFNLE1BQU0sR0FBRyxLQUFLLENBQUMsVUFBVSxDQUFDLE1BQU0sQ0FBQTtRQUN0QyxJQUFJLGVBQWUsR0FBRyxJQUFJLENBQUMsZ0JBQWdCLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxDQUFBO1FBQ3ZELElBQUksbUJBQW1CLEdBQUcsS0FBSyxDQUFBO1FBRS9CLElBQUksQ0FBQyxlQUFlLEVBQUUsQ0FBQztZQUNyQixlQUFlLEdBQUcsSUFBSSxDQUFDLGdCQUFnQixDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsQ0FBQTtZQUN6RCxJQUFJLENBQUMsZ0JBQWdCLENBQUMsR0FBRyxDQUFDLE1BQU0sRUFBRSxlQUFlLENBQUMsQ0FBQTtZQUNsRCxtQkFBbUIsR0FBRyxJQUFJLENBQUE7UUFDNUIsQ0FBQztRQUVELElBQUksQ0FBQztZQUNILE1BQU0sR0FBRyxHQUFHLE1BQU0sZUFBZSxDQUFBO1lBRWpDLEtBQUssQ0FBQyxRQUFRLEdBQUcsQ0FBQyxDQUFBO1lBQ2xCLEtBQUssQ0FBQyxjQUFjLEdBQUcsSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFBO1lBQzdDLEtBQUssQ0FBQyxXQUFXLEdBQUcsSUFBSSxDQUFBO1lBQ3hCLEtBQUssQ0FBQyxNQUFNLEdBQUcsUUFBUSxDQUFBO1lBQ3ZCLE1BQU0sSUFBSSxDQUFDLFNBQVMsRUFBRSxDQUFBO1lBRXRCLE9BQU8sRUFBQyxLQUFLLEVBQUUsSUFBSSxFQUFFLEdBQUcsRUFBQyxDQUFBO1FBQzNCLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsTUFBTSxPQUFPLEdBQUcsS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxJQUFJLEtBQUssQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQTtZQUV6RSxLQUFLLENBQUMsUUFBUSxJQUFJLENBQUMsQ0FBQTtZQUNuQixLQUFLLENBQUMsV0FBVyxHQUFHLElBQUksQ0FBQyxlQUFlLEVBQUUsR0FBRyxJQUFJLENBQUMsVUFBVSxDQUFDLEtBQUssQ0FBQyxRQUFRLENBQUMsQ0FBQTtZQUM1RSxLQUFLLENBQUMsTUFBTSxHQUFHLFFBQVEsQ0FBQTtZQUN2QixNQUFNLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQTtZQUV0QixPQUFPLEVBQUMsS0FBSyxFQUFFLE9BQU8sRUFBRSxHQUFHLEVBQUUsSUFBSSxFQUFDLENBQUE7UUFDcEMsQ0FBQztnQkFBUyxDQUFDO1lBQ1QsSUFBSSxtQkFBbUIsSUFBSSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxLQUFLLGVBQWUsRUFBRSxDQUFDO2dCQUNqRixJQUFJLENBQUMsZ0JBQWdCLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFBO1lBQ3RDLENBQUM7UUFDSCxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsZ0JBQWdCLENBQUMsVUFBVTtRQUMvQixNQUFNLGVBQWUsR0FBRyxNQUFNLElBQUksQ0FBQyxRQUFRLENBQUMsVUFBVSxDQUFDLENBQUE7UUFFdkQsSUFBSSxDQUFDLENBQUMsZUFBZSxZQUFZLFVBQVUsQ0FBQyxFQUFFLENBQUM7WUFDN0MsTUFBTSxJQUFJLEtBQUssQ0FBQyxzQkFBc0IsVUFBVSxDQUFDLEVBQUUsMkNBQTJDLENBQUMsQ0FBQTtRQUNqRyxDQUFDO1FBQ0QsSUFBSSxlQUFlLENBQUMsVUFBVSxLQUFLLFVBQVUsQ0FBQyxRQUFRLEVBQUUsQ0FBQztZQUN2RCxNQUFNLElBQUksS0FBSyxDQUFDLHNCQUFzQixVQUFVLENBQUMsRUFBRSx5Q0FBeUMsQ0FBQyxDQUFBO1FBQy9GLENBQUM7UUFFRCxNQUFNLE1BQU0sR0FBRyxVQUFVLGNBQWMsQ0FBQyxlQUFlLENBQUMsRUFBRSxDQUFBO1FBRTFELElBQUksTUFBTSxLQUFLLFVBQVUsQ0FBQyxNQUFNLEVBQUUsQ0FBQztZQUNqQyxNQUFNLElBQUksS0FBSyxDQUFDLHNCQUFzQixVQUFVLENBQUMsRUFBRSxzQ0FBc0MsQ0FBQyxDQUFBO1FBQzVGLENBQUM7UUFFRCxNQUFNLEdBQUcsR0FBRyxNQUFNLElBQUksQ0FBQyxPQUFPLENBQUMsU0FBUyxDQUFDO1lBQ3ZDLFNBQVMsRUFBRSxJQUFJLENBQUMsU0FBUztZQUN6QixLQUFLLEVBQUUsZUFBZTtZQUN0QixXQUFXLEVBQUUsVUFBVSxDQUFDLFdBQVc7WUFDbkMsTUFBTTtTQUNQLENBQUMsQ0FBQTtRQUVGLElBQUksQ0FBQyxHQUFHO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxrREFBa0QsVUFBVSxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUE7UUFFNUYsT0FBTyxHQUFHLENBQUE7SUFDWixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxTQUFTLENBQUMsS0FBSztRQUNuQixNQUFNLEdBQUcsR0FBRyxNQUFNLElBQUksQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDO1lBQ3JDLFNBQVMsRUFBRSxJQUFJLENBQUMsU0FBUztZQUN6QixNQUFNLEVBQUUsS0FBSyxDQUFDLFVBQVUsQ0FBQyxNQUFNO1NBQ2hDLENBQUMsQ0FBQTtRQUVGLElBQUksQ0FBQyxHQUFHLElBQUksS0FBSyxDQUFDLE1BQU0sS0FBSyxRQUFRO1lBQUUsS0FBSyxDQUFDLE1BQU0sR0FBRyxTQUFTLENBQUE7UUFFL0QsT0FBTyxHQUFHLENBQUE7SUFDWixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILGlCQUFpQixDQUFDLE1BQU07UUFDdEIsTUFBTSxXQUFXLEdBQUcsSUFBSSxDQUFDLGtCQUFrQixDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUE7UUFFNUQsSUFBSSxDQUFDLGtCQUFrQixDQUFDLEdBQUcsQ0FBQyxNQUFNLEVBQUUsV0FBVyxHQUFHLENBQUMsQ0FBQyxDQUFBO0lBQ3RELENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLGtCQUFrQixDQUFDLE1BQU07UUFDN0IsTUFBTSxXQUFXLEdBQUcsSUFBSSxDQUFDLGtCQUFrQixDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsQ0FBQTtRQUV2RCxJQUFJLFdBQVcsS0FBSyxTQUFTLEVBQUUsQ0FBQztZQUM5QixNQUFNLElBQUksS0FBSyxDQUFDLHNEQUFzRCxNQUFNLEVBQUUsQ0FBQyxDQUFBO1FBQ2pGLENBQUM7UUFFRCxJQUFJLFdBQVcsR0FBRyxDQUFDLEVBQUUsQ0FBQztZQUNwQixJQUFJLENBQUMsa0JBQWtCLENBQUMsR0FBRyxDQUFDLE1BQU0sRUFBRSxXQUFXLEdBQUcsQ0FBQyxDQUFDLENBQUE7WUFDcEQsT0FBTTtRQUNSLENBQUM7UUFFRCxJQUFJLENBQUMsa0JBQWtCLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFBO1FBQ3RDLE1BQU0sSUFBSSxDQUFDLGlDQUFpQyxDQUFDLE1BQU0sQ0FBQyxDQUFBO0lBQ3RELENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLLENBQUMseUJBQXlCO1FBQzdCLElBQUksQ0FBQyxJQUFJLENBQUMsS0FBSztZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsNkRBQTZELENBQUMsQ0FBQTtRQUUvRixLQUFLLE1BQU0sTUFBTSxJQUFJLENBQUMsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLHNCQUFzQixDQUFDLEVBQUUsQ0FBQztZQUM1RCxNQUFNLElBQUksQ0FBQyxpQ0FBaUMsQ0FBQyxNQUFNLENBQUMsQ0FBQTtRQUN0RCxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsaUNBQWlDLENBQUMsTUFBTTtRQUM1QyxJQUFJLENBQUMsSUFBSSxDQUFDLEtBQUs7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLDZEQUE2RCxDQUFDLENBQUE7UUFDL0YsSUFBSSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsc0JBQXNCLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQztZQUFFLE9BQU07UUFDL0QsSUFBSSxJQUFJLENBQUMsa0JBQWtCLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQztZQUFFLE9BQU07UUFFL0MsSUFBSSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsS0FBSyxDQUFDLFVBQVUsQ0FBQyxNQUFNLEtBQUssTUFBTSxDQUFDLEVBQUUsQ0FBQztZQUMzRSxNQUFNLElBQUksQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDLEVBQUMsU0FBUyxFQUFFLElBQUksQ0FBQyxTQUFTLEVBQUUsTUFBTSxFQUFDLENBQUMsQ0FBQTtRQUNwRSxDQUFDO1FBRUQsTUFBTSxzQkFBc0IsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLHNCQUFzQixDQUFBO1FBRWhFLElBQUksQ0FBQyxLQUFLLENBQUMsc0JBQXNCLEdBQUcsc0JBQXNCLENBQUMsTUFBTSxDQUFDLENBQUMsU0FBUyxFQUFFLEVBQUUsQ0FBQyxTQUFTLEtBQUssTUFBTSxDQUFDLENBQUE7UUFFdEcsSUFBSSxDQUFDO1lBQ0gsTUFBTSxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUE7UUFDeEIsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZixJQUFJLENBQUMsS0FBSyxDQUFDLHNCQUFzQixHQUFHLHNCQUFzQixDQUFBO1lBQzFELE1BQU0sS0FBSyxDQUFBO1FBQ2IsQ0FBQztJQUNILENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLHVCQUF1QixDQUFDLFFBQVE7UUFDcEMsTUFBTSxLQUFLLEdBQUcsTUFBTSxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUE7UUFDcEMsdUJBQXVCO1FBQ3ZCLE1BQU0sZUFBZSxHQUFHLEVBQUUsQ0FBQTtRQUUxQixLQUFLLE1BQU0sS0FBSyxJQUFJLEtBQUssQ0FBQyxNQUFNLEVBQUUsQ0FBQztZQUNqQyxJQUFJLENBQUMsS0FBSyxDQUFDLFNBQVMsQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDO2dCQUFFLFNBQVE7WUFDakQsSUFBSSxLQUFLLENBQUMsVUFBVSxDQUFDLGtCQUFrQixLQUFLLFVBQVU7Z0JBQUUsU0FBUTtZQUNoRSxJQUFJLE1BQU0sSUFBSSxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUM7Z0JBQUUsU0FBUTtZQUV6QyxlQUFlLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsRUFBRSxDQUFDLENBQUE7UUFDM0MsQ0FBQztRQUVELE9BQU8sZUFBZSxDQUFBO0lBQ3hCLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsYUFBYSxDQUFDLEtBQUs7UUFDakIsT0FBTyxLQUFLLENBQUMsTUFBTSxLQUFLLFFBQVEsSUFBSSxLQUFLLENBQUMsV0FBVyxLQUFLLElBQUksSUFBSSxLQUFLLENBQUMsV0FBVyxJQUFJLElBQUksQ0FBQyxlQUFlLEVBQUUsQ0FBQTtJQUMvRyxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILFVBQVUsQ0FBQyxRQUFRO1FBQ2pCLE9BQU8sSUFBSSxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsZUFBZSxFQUFFLElBQUksQ0FBQyxnQkFBZ0IsR0FBRyxDQUFDLENBQUMsSUFBSSxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsRUFBRSxRQUFRLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFBO0lBQ2pHLENBQUM7SUFFRDs7O09BR0c7SUFDSCxlQUFlO1FBQ2IsT0FBTyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUMsT0FBTyxFQUFFLENBQUE7SUFDN0IsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBzaGEyNTZCeXRlc0hleCBmcm9tIFwiLi4vLi4vdXRpbHMvc2hhMjU2LWJ5dGVzLWhleC5qc1wiXG5cbmNvbnN0IENBQ0hFX1NUQVRFX1ZFUlNJT04gPSAxXG5jb25zdCBERUZBVUxUX1JFVFJZX0JBU0VfREVMQVlfTVMgPSAxMDAwXG5jb25zdCBERUZBVUxUX1JFVFJZX01BWF9ERUxBWV9NUyA9IDEwMDAgKiA2MCAqIDVcblxuLyoqXG4gKiBDb3JlIHN5bmNocm9uaXplZCBhc3NldCBjYWNoZS4gUGxhdGZvcm0gcGFja2FnZXMgb3duIGJ5dGUgYW5kIG1ldGFkYXRhXG4gKiBwZXJzaXN0ZW5jZSB3aGlsZSB0aGlzIGNsYXNzIG93bnMgcG9saWN5LCBpbnRlZ3JpdHksIGFuZCBsaWZlY3ljbGUuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFN5bmNocm9uaXplZEFzc2V0Q2FjaGUge1xuICAvKipcbiAgICogQ3JlYXRlcyBhIHN5bmNocm9uaXplZCBhc3NldCBjYWNoZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgT3B0aW9ucy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuYWNjb3VudElkIEF1dGhlbnRpY2F0ZWQgYWNjb3VudCBuYW1lc3BhY2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlQWRhcHRlcn0gYXJncy5hZGFwdGVyIFBsYXRmb3JtIHN0b3JhZ2UgYWRhcHRlci5cbiAgICogQHBhcmFtIHsoZGVzY3JpcHRvcjogaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlRGVzY3JpcHRvcikgPT4gUHJvbWlzZTxVaW50OEFycmF5Pn0gYXJncy5kb3dubG9hZCBBdXRoZW50aWNhdGVkIGJ5dGUgZG93bmxvYWRlci5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MubWF4Qnl0ZXMgTWF4aW11bSBldmljdGFibGUgY2FjaGUgc2l6ZS5cbiAgICogQHBhcmFtIHsoKSA9PiBEYXRlfSBbYXJncy5ub3ddIENsb2NrLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MucmV0cnlCYXNlRGVsYXlNc10gSW5pdGlhbCByZXRyeSBkZWxheS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLnJldHJ5TWF4RGVsYXlNc10gTWF4aW11bSByZXRyeSBkZWxheS5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHthY2NvdW50SWQsIGFkYXB0ZXIsIGRvd25sb2FkLCBtYXhCeXRlcywgbm93ID0gKCkgPT4gbmV3IERhdGUoKSwgcmV0cnlCYXNlRGVsYXlNcyA9IERFRkFVTFRfUkVUUllfQkFTRV9ERUxBWV9NUywgcmV0cnlNYXhEZWxheU1zID0gREVGQVVMVF9SRVRSWV9NQVhfREVMQVlfTVN9KSB7XG4gICAgaWYgKCFhY2NvdW50SWQpIHRocm93IG5ldyBFcnJvcihcIlN5bmNocm9uaXplZCBhc3NldCBjYWNoZSByZXF1aXJlcyBhbiBhY2NvdW50IGlkXCIpXG4gICAgaWYgKCFOdW1iZXIuaXNTYWZlSW50ZWdlcihtYXhCeXRlcykgfHwgbWF4Qnl0ZXMgPCAwKSB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jaHJvbml6ZWQgYXNzZXQgY2FjaGUgbWF4Qnl0ZXMgbXVzdCBiZSBhIG5vbi1uZWdhdGl2ZSBzYWZlIGludGVnZXJcIilcbiAgICBpZiAoIU51bWJlci5pc1NhZmVJbnRlZ2VyKHJldHJ5QmFzZURlbGF5TXMpIHx8IHJldHJ5QmFzZURlbGF5TXMgPCAxKSB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jaHJvbml6ZWQgYXNzZXQgY2FjaGUgcmV0cnlCYXNlRGVsYXlNcyBtdXN0IGJlIGEgcG9zaXRpdmUgc2FmZSBpbnRlZ2VyXCIpXG4gICAgaWYgKCFOdW1iZXIuaXNTYWZlSW50ZWdlcihyZXRyeU1heERlbGF5TXMpIHx8IHJldHJ5TWF4RGVsYXlNcyA8IHJldHJ5QmFzZURlbGF5TXMpIHRocm93IG5ldyBFcnJvcihcIlN5bmNocm9uaXplZCBhc3NldCBjYWNoZSByZXRyeU1heERlbGF5TXMgbXVzdCBiZSBhdCBsZWFzdCByZXRyeUJhc2VEZWxheU1zXCIpXG5cbiAgICB0aGlzLmFjY291bnRJZCA9IGFjY291bnRJZFxuICAgIHRoaXMuYWRhcHRlciA9IGFkYXB0ZXJcbiAgICB0aGlzLmRvd25sb2FkID0gZG93bmxvYWRcbiAgICB0aGlzLm1heEJ5dGVzID0gbWF4Qnl0ZXNcbiAgICB0aGlzLm5vdyA9IG5vd1xuICAgIHRoaXMucmV0cnlCYXNlRGVsYXlNcyA9IHJldHJ5QmFzZURlbGF5TXNcbiAgICB0aGlzLnJldHJ5TWF4RGVsYXlNcyA9IHJldHJ5TWF4RGVsYXlNc1xuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgbnVtYmVyPn0gKi9cbiAgICB0aGlzLmFjdGl2ZURpZ2VzdENvdW50cyA9IG5ldyBNYXAoKVxuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgUHJvbWlzZTxzdHJpbmc+Pn0gKi9cbiAgICB0aGlzLmRvd25sb2FkUHJvbWlzZXMgPSBuZXcgTWFwKClcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZVN0YXRlIHwgbnVsbH0gKi9cbiAgICB0aGlzLnN0YXRlID0gbnVsbFxuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVTdGF0ZT4gfCBudWxsfSAqL1xuICAgIHRoaXMuc3RhdGVQcm9taXNlID0gbnVsbFxuICAgIC8qKiBAdHlwZSB7UHJvbWlzZTx2b2lkPn0gKi9cbiAgICB0aGlzLnNhdmVTdGF0ZVByb21pc2UgPSBQcm9taXNlLnJlc29sdmUoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlY29uY2lsZXMgdGhlIGltbXV0YWJsZSBkZXNjcmlwdG9ycyBmb3Igb25lIHN5bmNocm9uaXplZCBzY29wZSBhbmRcbiAgICogZG93bmxvYWRzIGVsaWdpYmxlIGVhZ2VyIGFzc2V0cy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgUmVjb25jaWxpYXRpb24gaW5wdXRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZURlc2NyaXB0b3JbXX0gYXJncy5kZXNjcmlwdG9ycyBDdXJyZW50IGRlc2NyaXB0b3JzIGluIHRoZSBzY29wZS5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLm9ubGluZSBXaGV0aGVyIGF1dGhlbnRpY2F0ZWQgZG93bmxvYWRzIGFyZSBhdmFpbGFibGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnNjb3BlS2V5IFN0YWJsZSBzeW5jaHJvbml6ZWQgc2NvcGUga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVTeW5jaHJvbml6YXRpb25SZXN1bHQ+fSBTeW5jaHJvbml6YXRpb24gcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgc3luY2hyb25pemUoe2Rlc2NyaXB0b3JzLCBvbmxpbmUsIHNjb3BlS2V5fSkge1xuICAgIGNvbnN0IHN0YXRlID0gYXdhaXQgdGhpcy5sb2FkU3RhdGUoKVxuICAgIGNvbnN0IGluY29taW5nSWRzID0gbmV3IFNldChkZXNjcmlwdG9ycy5tYXAoKGFzc2V0KSA9PiBhc3NldC5pZCkpXG4gICAgY29uc3QgZW50cmllc0J5SWQgPSBuZXcgTWFwKHN0YXRlLmFzc2V0cy5tYXAoKGVudHJ5KSA9PiBbZW50cnkuZGVzY3JpcHRvci5pZCwgZW50cnldKSlcbiAgICBjb25zdCBkaWdlc3RzQnlJZCA9IG5ldyBNYXAoc3RhdGUuYXNzZXRzLm1hcCgoZW50cnkpID0+IFtlbnRyeS5kZXNjcmlwdG9yLmlkLCBlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdF0pKVxuICAgIGNvbnN0IHJlbW92ZWREaWdlc3RzID0gbmV3IFNldCgpXG5cbiAgICBmb3IgKGNvbnN0IGFzc2V0IG9mIGRlc2NyaXB0b3JzKSB7XG4gICAgICBjb25zdCBrbm93bkRpZ2VzdCA9IGRpZ2VzdHNCeUlkLmdldChhc3NldC5pZClcblxuICAgICAgaWYgKGtub3duRGlnZXN0ICE9PSB1bmRlZmluZWQgJiYga25vd25EaWdlc3QgIT09IGFzc2V0LmRpZ2VzdCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFN5bmNocm9uaXplZCBhc3NldCBkZXNjcmlwdG9yICR7YXNzZXQuaWR9IGNoYW5nZWQgaXRzIGltbXV0YWJsZSBkaWdlc3RgKVxuICAgICAgfVxuXG4gICAgICBkaWdlc3RzQnlJZC5zZXQoYXNzZXQuaWQsIGFzc2V0LmRpZ2VzdClcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHN0YXRlLmFzc2V0cykge1xuICAgICAgaWYgKCFlbnRyeS5zY29wZUtleXMuaW5jbHVkZXMoc2NvcGVLZXkpIHx8IGluY29taW5nSWRzLmhhcyhlbnRyeS5kZXNjcmlwdG9yLmlkKSkgY29udGludWVcblxuICAgICAgZW50cnkuc2NvcGVLZXlzID0gZW50cnkuc2NvcGVLZXlzLmZpbHRlcigoY2FuZGlkYXRlKSA9PiBjYW5kaWRhdGUgIT09IHNjb3BlS2V5KVxuICAgICAgaWYgKGVudHJ5LnNjb3BlS2V5cy5sZW5ndGggPT09IDApIHJlbW92ZWREaWdlc3RzLmFkZChlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdClcbiAgICB9XG5cbiAgICBzdGF0ZS5hc3NldHMgPSBzdGF0ZS5hc3NldHMuZmlsdGVyKChlbnRyeSkgPT4gZW50cnkuc2NvcGVLZXlzLmxlbmd0aCA+IDApXG5cbiAgICBmb3IgKGNvbnN0IGFzc2V0IG9mIGRlc2NyaXB0b3JzKSB7XG4gICAgICBjb25zdCBleGlzdGluZyA9IGVudHJpZXNCeUlkLmdldChhc3NldC5pZClcblxuICAgICAgaWYgKGV4aXN0aW5nICYmIHN0YXRlLmFzc2V0cy5pbmNsdWRlcyhleGlzdGluZykpIHtcbiAgICAgICAgZXhpc3RpbmcuZGVzY3JpcHRvciA9IGFzc2V0XG4gICAgICAgIGlmICghZXhpc3Rpbmcuc2NvcGVLZXlzLmluY2x1ZGVzKHNjb3BlS2V5KSkgZXhpc3Rpbmcuc2NvcGVLZXlzLnB1c2goc2NvcGVLZXkpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb25zdCBuZXdFbnRyeSA9IHtcbiAgICAgICAgICBhdHRlbXB0czogMCxcbiAgICAgICAgICBkZXNjcmlwdG9yOiBhc3NldCxcbiAgICAgICAgICBsYXN0QWNjZXNzZWRBdDogdGhpcy5ub3dNaWxsaXNlY29uZHMoKSxcbiAgICAgICAgICBuZXh0UmV0cnlBdDogbnVsbCxcbiAgICAgICAgICBzY29wZUtleXM6IFtzY29wZUtleV0sXG4gICAgICAgICAgc3RhdHVzOiAvKiogQHR5cGUge2NvbnN0fSAqLyAoXCJtaXNzaW5nXCIpXG4gICAgICAgIH1cblxuICAgICAgICBzdGF0ZS5hc3NldHMucHVzaChuZXdFbnRyeSlcbiAgICAgICAgZW50cmllc0J5SWQuc2V0KGFzc2V0LmlkLCBuZXdFbnRyeSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGRpZ2VzdCBvZiByZW1vdmVkRGlnZXN0cykge1xuICAgICAgaWYgKHN0YXRlLmFzc2V0cy5zb21lKChlbnRyeSkgPT4gZW50cnkuZGVzY3JpcHRvci5kaWdlc3QgPT09IGRpZ2VzdCkpIGNvbnRpbnVlXG4gICAgICBpZiAoIXN0YXRlLnBlbmRpbmdEZWxldGlvbkRpZ2VzdHMuaW5jbHVkZXMoZGlnZXN0KSkgc3RhdGUucGVuZGluZ0RlbGV0aW9uRGlnZXN0cy5wdXNoKGRpZ2VzdClcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnNhdmVTdGF0ZSgpXG4gICAgYXdhaXQgdGhpcy5kZWxldGVVbnJlZmVyZW5jZWREaWdlc3RzKClcblxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlRmFpbHVyZVtdfSAqL1xuICAgIGNvbnN0IGZhaWx1cmVzID0gW11cblxuICAgIGlmIChvbmxpbmUpIHtcbiAgICAgIGZvciAoY29uc3QgYXNzZXQgb2YgZGVzY3JpcHRvcnMpIHtcbiAgICAgICAgaWYgKGFzc2V0LmZldGNoICE9PSBcImVhZ2VyXCIpIGNvbnRpbnVlXG5cbiAgICAgICAgY29uc3QgZW50cnkgPSBlbnRyaWVzQnlJZC5nZXQoYXNzZXQuaWQpXG5cbiAgICAgICAgaWYgKCFlbnRyeSB8fCAhdGhpcy5yZXRyeUVsaWdpYmxlKGVudHJ5KSkgY29udGludWVcblxuICAgICAgICBjb25zdCBjYWNoZVJlc3VsdCA9IGF3YWl0IHRoaXMuZW5zdXJlQ2FjaGVkKGVudHJ5KVxuXG4gICAgICAgIGlmIChjYWNoZVJlc3VsdC5lcnJvcikgZmFpbHVyZXMucHVzaCh7YXNzZXRJZDogYXNzZXQuaWQsIGVycm9yOiBjYWNoZVJlc3VsdC5lcnJvcn0pXG4gICAgICB9XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5jbGVhbnVwKClcblxuICAgIHJldHVybiB7XG4gICAgICBmYWlsdXJlcyxcbiAgICAgIG1pc3NpbmdSZXF1aXJlZEFzc2V0SWRzOiBhd2FpdCB0aGlzLm1pc3NpbmdSZXF1aXJlZEFzc2V0SWRzKHNjb3BlS2V5KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBhIGNhY2hlZCBhc3NldCBVUkksIGRvd25sb2FkaW5nIGl0IG9uIGRlbWFuZCB3aGVuIGFsbG93ZWQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIFJlc29sdXRpb24gaW5wdXRzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5hc3NldElkIEF0dGFjaG1lbnQgZGVzY3JpcHRvciBpZC5cbiAgICogQHBhcmFtIHtib29sZWFufSBhcmdzLm9ubGluZSBXaGV0aGVyIGF1dGhlbnRpY2F0ZWQgZG93bmxvYWRzIGFyZSBhdmFpbGFibGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZyB8IG51bGw+fSBDYWNoZWQgYXNzZXQgVVJJLlxuICAgKi9cbiAgYXN5bmMgcmVzb2x2ZSh7YXNzZXRJZCwgb25saW5lfSkge1xuICAgIGNvbnN0IHN0YXRlID0gYXdhaXQgdGhpcy5sb2FkU3RhdGUoKVxuICAgIGNvbnN0IGVudHJ5ID0gc3RhdGUuYXNzZXRzLmZpbmQoKGNhbmRpZGF0ZSkgPT4gY2FuZGlkYXRlLmRlc2NyaXB0b3IuaWQgPT09IGFzc2V0SWQpXG5cbiAgICBpZiAoIWVudHJ5KSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgZGlnZXN0ID0gZW50cnkuZGVzY3JpcHRvci5kaWdlc3RcblxuICAgIHRoaXMuYmVnaW5BY3RpdmVEaWdlc3QoZGlnZXN0KVxuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGNhY2hlZFVyaSA9IGF3YWl0IHRoaXMuY2FjaGVkVXJpKGVudHJ5KVxuXG4gICAgICBpZiAoY2FjaGVkVXJpKSB7XG4gICAgICAgIGVudHJ5Lmxhc3RBY2Nlc3NlZEF0ID0gdGhpcy5ub3dNaWxsaXNlY29uZHMoKVxuICAgICAgICBlbnRyeS5zdGF0dXMgPSBcImNhY2hlZFwiXG4gICAgICAgIGF3YWl0IHRoaXMuc2F2ZVN0YXRlKClcblxuICAgICAgICByZXR1cm4gY2FjaGVkVXJpXG4gICAgICB9XG5cbiAgICAgIGlmICghb25saW5lIHx8ICF0aGlzLnJldHJ5RWxpZ2libGUoZW50cnkpKSByZXR1cm4gbnVsbFxuXG4gICAgICBjb25zdCBjYWNoZVJlc3VsdCA9IGF3YWl0IHRoaXMuZW5zdXJlQ2FjaGVkV2hpbGVBY3RpdmUoZW50cnkpXG5cbiAgICAgIGlmIChjYWNoZVJlc3VsdC5lcnJvcikgdGhyb3cgY2FjaGVSZXN1bHQuZXJyb3JcbiAgICAgIGlmICghY2FjaGVSZXN1bHQudXJpKSByZXR1cm4gbnVsbFxuXG4gICAgICBhd2FpdCB0aGlzLmNsZWFudXAobmV3IFNldChbZGlnZXN0XSkpXG5cbiAgICAgIHJldHVybiBjYWNoZVJlc3VsdC51cmlcbiAgICB9IGZpbmFsbHkge1xuICAgICAgYXdhaXQgdGhpcy5maW5pc2hBY3RpdmVEaWdlc3QoZGlnZXN0KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBFdmljdHMgbGVhc3QtcmVjZW50bHktdXNlZCBibG9icyB1bnRpbCB0aGUgdW5pcXVlIGNhY2hlZCBieXRlIHRvdGFsIGlzXG4gICAqIHdpdGhpbiB0aGUgY29uZmlndXJlZCBidWRnZXQuIEEgYmxvYiBzdGF5cyBkdXJhYmxlIHdoZW4gYW55IGxpdmVcbiAgICogZGVzY3JpcHRvciByZWZlcmVuY2UgZGVjbGFyZXMgZHVyYWJsZSByZXRlbnRpb24uXG4gICAqIEBwYXJhbSB7U2V0PHN0cmluZz59IFtwcm90ZWN0ZWREaWdlc3RzXSBEaWdlc3RzIG5lZWRlZCBieSB0aGUgYWN0aXZlIGNhbGxlci5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gQnl0ZXMgcmVtb3ZlZC5cbiAgICovXG4gIGFzeW5jIGNsZWFudXAocHJvdGVjdGVkRGlnZXN0cyA9IG5ldyBTZXQoKSkge1xuICAgIGNvbnN0IHN0YXRlID0gYXdhaXQgdGhpcy5sb2FkU3RhdGUoKVxuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlRW50cnlbXT59ICovXG4gICAgY29uc3QgZW50cmllc0J5RGlnZXN0ID0gbmV3IE1hcCgpXG5cbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHN0YXRlLmFzc2V0cykge1xuICAgICAgY29uc3QgZGlnZXN0RW50cmllcyA9IGVudHJpZXNCeURpZ2VzdC5nZXQoZW50cnkuZGVzY3JpcHRvci5kaWdlc3QpIHx8IFtdXG5cbiAgICAgIGRpZ2VzdEVudHJpZXMucHVzaChlbnRyeSlcbiAgICAgIGVudHJpZXNCeURpZ2VzdC5zZXQoZW50cnkuZGVzY3JpcHRvci5kaWdlc3QsIGRpZ2VzdEVudHJpZXMpXG4gICAgfVxuXG4gICAgLyoqIEB0eXBlIHt7Ynl0ZVNpemU6IG51bWJlciwgZGlnZXN0OiBzdHJpbmcsIGxhc3RBY2Nlc3NlZEF0OiBudW1iZXIsIHJlZmVyZW5jZXM6IGltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZUVudHJ5W119W119ICovXG4gICAgY29uc3QgY2FjaGVkQmxvYnMgPSBbXVxuICAgIGxldCBjYWNoZWRCeXRlcyA9IDBcblxuICAgIGZvciAoY29uc3QgW2RpZ2VzdCwgcmVmZXJlbmNlc10gb2YgZW50cmllc0J5RGlnZXN0KSB7XG4gICAgICBjb25zdCB1cmkgPSBhd2FpdCB0aGlzLmFkYXB0ZXIuYmxvYlVyaSh7YWNjb3VudElkOiB0aGlzLmFjY291bnRJZCwgZGlnZXN0fSlcblxuICAgICAgaWYgKCF1cmkpIHtcbiAgICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiByZWZlcmVuY2VzKSB7XG4gICAgICAgICAgaWYgKGVudHJ5LnN0YXR1cyA9PT0gXCJjYWNoZWRcIikgZW50cnkuc3RhdHVzID0gXCJtaXNzaW5nXCJcbiAgICAgICAgfVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBjb25zdCBieXRlU2l6ZSA9IHJlZmVyZW5jZXNbMF0uZGVzY3JpcHRvci5ieXRlU2l6ZVxuXG4gICAgICBjYWNoZWRCeXRlcyArPSBieXRlU2l6ZVxuICAgICAgY2FjaGVkQmxvYnMucHVzaCh7XG4gICAgICAgIGJ5dGVTaXplLFxuICAgICAgICBkaWdlc3QsXG4gICAgICAgIGxhc3RBY2Nlc3NlZEF0OiBNYXRoLm1heCguLi5yZWZlcmVuY2VzLm1hcCgoZW50cnkpID0+IGVudHJ5Lmxhc3RBY2Nlc3NlZEF0KSksXG4gICAgICAgIHJlZmVyZW5jZXNcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgY2FjaGVkQmxvYnMuc29ydCgobGVmdCwgcmlnaHQpID0+IGxlZnQubGFzdEFjY2Vzc2VkQXQgLSByaWdodC5sYXN0QWNjZXNzZWRBdCB8fCBsZWZ0LmRpZ2VzdC5sb2NhbGVDb21wYXJlKHJpZ2h0LmRpZ2VzdCkpXG5cbiAgICBsZXQgcmVtb3ZlZEJ5dGVzID0gMFxuXG4gICAgZm9yIChjb25zdCBibG9iIG9mIGNhY2hlZEJsb2JzKSB7XG4gICAgICBpZiAoY2FjaGVkQnl0ZXMgPD0gdGhpcy5tYXhCeXRlcykgYnJlYWtcbiAgICAgIGlmIChwcm90ZWN0ZWREaWdlc3RzLmhhcyhibG9iLmRpZ2VzdCkpIGNvbnRpbnVlXG4gICAgICBpZiAodGhpcy5hY3RpdmVEaWdlc3RDb3VudHMuaGFzKGJsb2IuZGlnZXN0KSkgY29udGludWVcbiAgICAgIGlmIChibG9iLnJlZmVyZW5jZXMuc29tZSgoZW50cnkpID0+IGVudHJ5LmRlc2NyaXB0b3IucmV0ZW50aW9uID09PSBcImR1cmFibGVcIikpIGNvbnRpbnVlXG5cbiAgICAgIGF3YWl0IHRoaXMuYWRhcHRlci5kZWxldGVCbG9iKHthY2NvdW50SWQ6IHRoaXMuYWNjb3VudElkLCBkaWdlc3Q6IGJsb2IuZGlnZXN0fSlcbiAgICAgIGNhY2hlZEJ5dGVzIC09IGJsb2IuYnl0ZVNpemVcbiAgICAgIHJlbW92ZWRCeXRlcyArPSBibG9iLmJ5dGVTaXplXG5cbiAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgYmxvYi5yZWZlcmVuY2VzKSB7XG4gICAgICAgIGVudHJ5LmF0dGVtcHRzID0gMFxuICAgICAgICBlbnRyeS5uZXh0UmV0cnlBdCA9IG51bGxcbiAgICAgICAgZW50cnkuc3RhdHVzID0gXCJtaXNzaW5nXCJcbiAgICAgIH1cbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnNhdmVTdGF0ZSgpXG5cbiAgICByZXR1cm4gcmVtb3ZlZEJ5dGVzXG4gIH1cblxuICAvKipcbiAgICogTG9hZHMgY2FjaGUgc3RhdGUgb25jZSBmb3IgdGhpcyBjYWNoZSBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlU3RhdGU+fSBMb2FkZWQgc3RhdGUuXG4gICAqL1xuICBhc3luYyBsb2FkU3RhdGUoKSB7XG4gICAgaWYgKHRoaXMuc3RhdGUpIHJldHVybiB0aGlzLnN0YXRlXG4gICAgaWYgKHRoaXMuc3RhdGVQcm9taXNlKSByZXR1cm4gYXdhaXQgdGhpcy5zdGF0ZVByb21pc2VcblxuICAgIHRoaXMuc3RhdGVQcm9taXNlID0gdGhpcy5sb2FkU3RhdGVGcm9tQWRhcHRlcigpXG5cbiAgICB0cnkge1xuICAgICAgdGhpcy5zdGF0ZSA9IGF3YWl0IHRoaXMuc3RhdGVQcm9taXNlXG5cbiAgICAgIHJldHVybiB0aGlzLnN0YXRlXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMuc3RhdGVQcm9taXNlID0gbnVsbFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBMb2FkcyBhbmQgcmVjb3ZlcnMgcGVyc2lzdGVkIGNhY2hlIHN0YXRlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVTdGF0ZT59IExvYWRlZCBzdGF0ZS5cbiAgICovXG4gIGFzeW5jIGxvYWRTdGF0ZUZyb21BZGFwdGVyKCkge1xuICAgIGNvbnN0IGxvYWRlZFN0YXRlID0gYXdhaXQgdGhpcy5hZGFwdGVyLmxvYWRTdGF0ZSh7YWNjb3VudElkOiB0aGlzLmFjY291bnRJZH0pXG5cbiAgICBpZiAoIWxvYWRlZFN0YXRlKSByZXR1cm4ge2Fzc2V0czogW10sIHBlbmRpbmdEZWxldGlvbkRpZ2VzdHM6IFtdLCB2ZXJzaW9uOiBDQUNIRV9TVEFURV9WRVJTSU9OfVxuICAgIGlmIChsb2FkZWRTdGF0ZS52ZXJzaW9uICE9PSBDQUNIRV9TVEFURV9WRVJTSU9OKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIHN5bmNocm9uaXplZCBhc3NldCBjYWNoZSBzdGF0ZSB2ZXJzaW9uOiAke2xvYWRlZFN0YXRlLnZlcnNpb259YClcbiAgICB9XG5cbiAgICBsZXQgcmVjb3ZlcmVkSW50ZXJydXB0ZWREb3dubG9hZCA9IGZhbHNlXG5cbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGxvYWRlZFN0YXRlLmFzc2V0cykge1xuICAgICAgaWYgKGVudHJ5LnN0YXR1cyAhPT0gXCJkb3dubG9hZGluZ1wiKSBjb250aW51ZVxuXG4gICAgICBlbnRyeS5hdHRlbXB0cyArPSAxXG4gICAgICBlbnRyeS5uZXh0UmV0cnlBdCA9IHRoaXMubm93TWlsbGlzZWNvbmRzKClcbiAgICAgIGVudHJ5LnN0YXR1cyA9IFwiZmFpbGVkXCJcbiAgICAgIHJlY292ZXJlZEludGVycnVwdGVkRG93bmxvYWQgPSB0cnVlXG4gICAgfVxuXG4gICAgaWYgKHJlY292ZXJlZEludGVycnVwdGVkRG93bmxvYWQpIHtcbiAgICAgIGF3YWl0IHRoaXMuYWRhcHRlci5zYXZlU3RhdGUoe2FjY291bnRJZDogdGhpcy5hY2NvdW50SWQsIHN0YXRlOiBsb2FkZWRTdGF0ZX0pXG4gICAgfVxuXG4gICAgcmV0dXJuIGxvYWRlZFN0YXRlXG4gIH1cblxuICAvKipcbiAgICogUGVyc2lzdHMgdGhlIGN1cnJlbnQgY2FjaGUgc3RhdGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyBhZnRlciBzdGF0ZSBwZXJzaXN0ZW5jZS5cbiAgICovXG4gIGFzeW5jIHNhdmVTdGF0ZSgpIHtcbiAgICBpZiAoIXRoaXMuc3RhdGUpIHRocm93IG5ldyBFcnJvcihcIkNhbm5vdCBzYXZlIHN5bmNocm9uaXplZCBhc3NldCBjYWNoZSBiZWZvcmUgbG9hZGluZyBzdGF0ZVwiKVxuXG4gICAgY29uc3QgcGVyc2lzdCA9IGFzeW5jICgpID0+IHtcbiAgICAgIGlmICghdGhpcy5zdGF0ZSkgdGhyb3cgbmV3IEVycm9yKFwiQ2Fubm90IHNhdmUgc3luY2hyb25pemVkIGFzc2V0IGNhY2hlIGJlZm9yZSBsb2FkaW5nIHN0YXRlXCIpXG5cbiAgICAgIGF3YWl0IHRoaXMuYWRhcHRlci5zYXZlU3RhdGUoe2FjY291bnRJZDogdGhpcy5hY2NvdW50SWQsIHN0YXRlOiB0aGlzLnN0YXRlfSlcbiAgICB9XG5cbiAgICB0aGlzLnNhdmVTdGF0ZVByb21pc2UgPSB0aGlzLnNhdmVTdGF0ZVByb21pc2UudGhlbihwZXJzaXN0LCBwZXJzaXN0KVxuXG4gICAgYXdhaXQgdGhpcy5zYXZlU3RhdGVQcm9taXNlXG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyBvbmUgZGVzY3JpcHRvciBoYXMgdmVyaWZpZWQgbG9jYWwgYnl0ZXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlRW50cnl9IGVudHJ5IERlc2NyaXB0b3Igc3RhdGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHtlcnJvcjogRXJyb3IgfCBudWxsLCB1cmk6IHN0cmluZyB8IG51bGx9Pn0gQ2FjaGUgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgZW5zdXJlQ2FjaGVkKGVudHJ5KSB7XG4gICAgY29uc3QgZGlnZXN0ID0gZW50cnkuZGVzY3JpcHRvci5kaWdlc3RcblxuICAgIHRoaXMuYmVnaW5BY3RpdmVEaWdlc3QoZGlnZXN0KVxuXG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLmVuc3VyZUNhY2hlZFdoaWxlQWN0aXZlKGVudHJ5KVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCB0aGlzLmZpbmlzaEFjdGl2ZURpZ2VzdChkaWdlc3QpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIG9yIGRvd25sb2FkcyBvbmUgZGVzY3JpcHRvciB3aGlsZSBpdHMgZGlnZXN0IGlzIHByb3RlY3RlZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVFbnRyeX0gZW50cnkgRGVzY3JpcHRvciBzdGF0ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8e2Vycm9yOiBFcnJvciB8IG51bGwsIHVyaTogc3RyaW5nIHwgbnVsbH0+fSBDYWNoZSByZXN1bHQuXG4gICAqL1xuICBhc3luYyBlbnN1cmVDYWNoZWRXaGlsZUFjdGl2ZShlbnRyeSkge1xuICAgIGNvbnN0IGV4aXN0aW5nVXJpID0gYXdhaXQgdGhpcy5jYWNoZWRVcmkoZW50cnkpXG5cbiAgICBpZiAoZXhpc3RpbmdVcmkpIHtcbiAgICAgIGVudHJ5LmF0dGVtcHRzID0gMFxuICAgICAgZW50cnkubGFzdEFjY2Vzc2VkQXQgPSB0aGlzLm5vd01pbGxpc2Vjb25kcygpXG4gICAgICBlbnRyeS5uZXh0UmV0cnlBdCA9IG51bGxcbiAgICAgIGVudHJ5LnN0YXR1cyA9IFwiY2FjaGVkXCJcbiAgICAgIGF3YWl0IHRoaXMuc2F2ZVN0YXRlKClcblxuICAgICAgcmV0dXJuIHtlcnJvcjogbnVsbCwgdXJpOiBleGlzdGluZ1VyaX1cbiAgICB9XG5cbiAgICBlbnRyeS5zdGF0dXMgPSBcImRvd25sb2FkaW5nXCJcbiAgICBhd2FpdCB0aGlzLnNhdmVTdGF0ZSgpXG5cbiAgICBjb25zdCBkaWdlc3QgPSBlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdFxuICAgIGxldCBkb3dubG9hZFByb21pc2UgPSB0aGlzLmRvd25sb2FkUHJvbWlzZXMuZ2V0KGRpZ2VzdClcbiAgICBsZXQgb3duc0Rvd25sb2FkUHJvbWlzZSA9IGZhbHNlXG5cbiAgICBpZiAoIWRvd25sb2FkUHJvbWlzZSkge1xuICAgICAgZG93bmxvYWRQcm9taXNlID0gdGhpcy5kb3dubG9hZFZlcmlmaWVkKGVudHJ5LmRlc2NyaXB0b3IpXG4gICAgICB0aGlzLmRvd25sb2FkUHJvbWlzZXMuc2V0KGRpZ2VzdCwgZG93bmxvYWRQcm9taXNlKVxuICAgICAgb3duc0Rvd25sb2FkUHJvbWlzZSA9IHRydWVcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgdXJpID0gYXdhaXQgZG93bmxvYWRQcm9taXNlXG5cbiAgICAgIGVudHJ5LmF0dGVtcHRzID0gMFxuICAgICAgZW50cnkubGFzdEFjY2Vzc2VkQXQgPSB0aGlzLm5vd01pbGxpc2Vjb25kcygpXG4gICAgICBlbnRyeS5uZXh0UmV0cnlBdCA9IG51bGxcbiAgICAgIGVudHJ5LnN0YXR1cyA9IFwiY2FjaGVkXCJcbiAgICAgIGF3YWl0IHRoaXMuc2F2ZVN0YXRlKClcblxuICAgICAgcmV0dXJuIHtlcnJvcjogbnVsbCwgdXJpfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zdCBmYWlsdXJlID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpXG5cbiAgICAgIGVudHJ5LmF0dGVtcHRzICs9IDFcbiAgICAgIGVudHJ5Lm5leHRSZXRyeUF0ID0gdGhpcy5ub3dNaWxsaXNlY29uZHMoKSArIHRoaXMucmV0cnlEZWxheShlbnRyeS5hdHRlbXB0cylcbiAgICAgIGVudHJ5LnN0YXR1cyA9IFwiZmFpbGVkXCJcbiAgICAgIGF3YWl0IHRoaXMuc2F2ZVN0YXRlKClcblxuICAgICAgcmV0dXJuIHtlcnJvcjogZmFpbHVyZSwgdXJpOiBudWxsfVxuICAgIH0gZmluYWxseSB7XG4gICAgICBpZiAob3duc0Rvd25sb2FkUHJvbWlzZSAmJiB0aGlzLmRvd25sb2FkUHJvbWlzZXMuZ2V0KGRpZ2VzdCkgPT09IGRvd25sb2FkUHJvbWlzZSkge1xuICAgICAgICB0aGlzLmRvd25sb2FkUHJvbWlzZXMuZGVsZXRlKGRpZ2VzdClcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRG93bmxvYWRzLCB2ZXJpZmllcywgYW5kIGF0b21pY2FsbHkgcGVyc2lzdHMgb25lIGNvbnRlbnQgZGlnZXN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZURlc2NyaXB0b3J9IGRlc2NyaXB0b3IgQXNzZXQgZGVzY3JpcHRvci5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gQWRhcHRlciBVUkkuXG4gICAqL1xuICBhc3luYyBkb3dubG9hZFZlcmlmaWVkKGRlc2NyaXB0b3IpIHtcbiAgICBjb25zdCBkb3dubG9hZGVkQnl0ZXMgPSBhd2FpdCB0aGlzLmRvd25sb2FkKGRlc2NyaXB0b3IpXG5cbiAgICBpZiAoIShkb3dubG9hZGVkQnl0ZXMgaW5zdGFuY2VvZiBVaW50OEFycmF5KSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBTeW5jaHJvbml6ZWQgYXNzZXQgJHtkZXNjcmlwdG9yLmlkfSBkb3dubG9hZCBkaWQgbm90IHJldHVybiBVaW50OEFycmF5IGJ5dGVzYClcbiAgICB9XG4gICAgaWYgKGRvd25sb2FkZWRCeXRlcy5ieXRlTGVuZ3RoICE9PSBkZXNjcmlwdG9yLmJ5dGVTaXplKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFN5bmNocm9uaXplZCBhc3NldCAke2Rlc2NyaXB0b3IuaWR9IGJ5dGUgc2l6ZSBkaWQgbm90IG1hdGNoIGl0cyBkZXNjcmlwdG9yYClcbiAgICB9XG5cbiAgICBjb25zdCBkaWdlc3QgPSBgc2hhMjU2LSR7c2hhMjU2Qnl0ZXNIZXgoZG93bmxvYWRlZEJ5dGVzKX1gXG5cbiAgICBpZiAoZGlnZXN0ICE9PSBkZXNjcmlwdG9yLmRpZ2VzdCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBTeW5jaHJvbml6ZWQgYXNzZXQgJHtkZXNjcmlwdG9yLmlkfSBkaWdlc3QgZGlkIG5vdCBtYXRjaCBpdHMgZGVzY3JpcHRvcmApXG4gICAgfVxuXG4gICAgY29uc3QgdXJpID0gYXdhaXQgdGhpcy5hZGFwdGVyLndyaXRlQmxvYih7XG4gICAgICBhY2NvdW50SWQ6IHRoaXMuYWNjb3VudElkLFxuICAgICAgYnl0ZXM6IGRvd25sb2FkZWRCeXRlcyxcbiAgICAgIGNvbnRlbnRUeXBlOiBkZXNjcmlwdG9yLmNvbnRlbnRUeXBlLFxuICAgICAgZGlnZXN0XG4gICAgfSlcblxuICAgIGlmICghdXJpKSB0aHJvdyBuZXcgRXJyb3IoYFN5bmNocm9uaXplZCBhc3NldCBhZGFwdGVyIHJldHVybmVkIG5vIFVSSSBmb3IgJHtkZXNjcmlwdG9yLmlkfWApXG5cbiAgICByZXR1cm4gdXJpXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYW4gZXhpc3RpbmcgbG9jYWwgVVJJIGFuZCByZXBhaXJzIHN0YWxlIGNhY2hlZCBtZXRhZGF0YS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVFbnRyeX0gZW50cnkgRGVzY3JpcHRvciBzdGF0ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nIHwgbnVsbD59IEV4aXN0aW5nIFVSSS5cbiAgICovXG4gIGFzeW5jIGNhY2hlZFVyaShlbnRyeSkge1xuICAgIGNvbnN0IHVyaSA9IGF3YWl0IHRoaXMuYWRhcHRlci5ibG9iVXJpKHtcbiAgICAgIGFjY291bnRJZDogdGhpcy5hY2NvdW50SWQsXG4gICAgICBkaWdlc3Q6IGVudHJ5LmRlc2NyaXB0b3IuZGlnZXN0XG4gICAgfSlcblxuICAgIGlmICghdXJpICYmIGVudHJ5LnN0YXR1cyA9PT0gXCJjYWNoZWRcIikgZW50cnkuc3RhdHVzID0gXCJtaXNzaW5nXCJcblxuICAgIHJldHVybiB1cmlcbiAgfVxuXG4gIC8qKlxuICAgKiBQcm90ZWN0cyBhIGRpZ2VzdCBmb3IgdGhlIGR1cmF0aW9uIG9mIG9uZSBhY3RpdmUgY2FjaGUgb3BlcmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZGlnZXN0IENvbnRlbnQgZGlnZXN0LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGJlZ2luQWN0aXZlRGlnZXN0KGRpZ2VzdCkge1xuICAgIGNvbnN0IGFjdGl2ZUNvdW50ID0gdGhpcy5hY3RpdmVEaWdlc3RDb3VudHMuZ2V0KGRpZ2VzdCkgPz8gMFxuXG4gICAgdGhpcy5hY3RpdmVEaWdlc3RDb3VudHMuc2V0KGRpZ2VzdCwgYWN0aXZlQ291bnQgKyAxKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlbGVhc2VzIG9uZSBjYWNoZSBvcGVyYXRpb24gYW5kIHByb2Nlc3NlcyBkZWZlcnJlZCBkZWxldGlvbiBhZnRlciB0aGUgbGFzdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGRpZ2VzdCBDb250ZW50IGRpZ2VzdC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIGFmdGVyIGFueSBwZW5kaW5nIGRlbGV0aW9uLlxuICAgKi9cbiAgYXN5bmMgZmluaXNoQWN0aXZlRGlnZXN0KGRpZ2VzdCkge1xuICAgIGNvbnN0IGFjdGl2ZUNvdW50ID0gdGhpcy5hY3RpdmVEaWdlc3RDb3VudHMuZ2V0KGRpZ2VzdClcblxuICAgIGlmIChhY3RpdmVDb3VudCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE1pc3NpbmcgYWN0aXZlIHN5bmNocm9uaXplZCBhc3NldCBkaWdlc3QgY291bnQgZm9yICR7ZGlnZXN0fWApXG4gICAgfVxuXG4gICAgaWYgKGFjdGl2ZUNvdW50ID4gMSkge1xuICAgICAgdGhpcy5hY3RpdmVEaWdlc3RDb3VudHMuc2V0KGRpZ2VzdCwgYWN0aXZlQ291bnQgLSAxKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdGhpcy5hY3RpdmVEaWdlc3RDb3VudHMuZGVsZXRlKGRpZ2VzdClcbiAgICBhd2FpdCB0aGlzLmRlbGV0ZVBlbmRpbmdEaWdlc3RJZlVucmVmZXJlbmNlZChkaWdlc3QpXG4gIH1cblxuICAvKipcbiAgICogRGVsZXRlcyBibG9icyB0aGF0IGxvc3QgdGhlaXIgZmluYWwgZGVzY3JpcHRvciByZWZlcmVuY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyBhZnRlciBkZWxldGlvbi5cbiAgICovXG4gIGFzeW5jIGRlbGV0ZVVucmVmZXJlbmNlZERpZ2VzdHMoKSB7XG4gICAgaWYgKCF0aGlzLnN0YXRlKSB0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3QgZGVsZXRlIHN5bmNocm9uaXplZCBhc3NldCBibG9icyBiZWZvcmUgbG9hZGluZyBzdGF0ZVwiKVxuXG4gICAgZm9yIChjb25zdCBkaWdlc3Qgb2YgWy4uLnRoaXMuc3RhdGUucGVuZGluZ0RlbGV0aW9uRGlnZXN0c10pIHtcbiAgICAgIGF3YWl0IHRoaXMuZGVsZXRlUGVuZGluZ0RpZ2VzdElmVW5yZWZlcmVuY2VkKGRpZ2VzdClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRGVsZXRlcyBvbmUgcGVyc2lzdGVkIHBlbmRpbmcgZGlnZXN0IHdoZW4gbm8gZGVzY3JpcHRvciBvciBhY3RpdmUgb3BlcmF0aW9uIG93bnMgaXQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBkaWdlc3QgQ29udGVudCBkaWdlc3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyBhZnRlciBhbnkgcmVxdWlyZWQgZGVsZXRpb24uXG4gICAqL1xuICBhc3luYyBkZWxldGVQZW5kaW5nRGlnZXN0SWZVbnJlZmVyZW5jZWQoZGlnZXN0KSB7XG4gICAgaWYgKCF0aGlzLnN0YXRlKSB0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3QgZGVsZXRlIHN5bmNocm9uaXplZCBhc3NldCBibG9icyBiZWZvcmUgbG9hZGluZyBzdGF0ZVwiKVxuICAgIGlmICghdGhpcy5zdGF0ZS5wZW5kaW5nRGVsZXRpb25EaWdlc3RzLmluY2x1ZGVzKGRpZ2VzdCkpIHJldHVyblxuICAgIGlmICh0aGlzLmFjdGl2ZURpZ2VzdENvdW50cy5oYXMoZGlnZXN0KSkgcmV0dXJuXG5cbiAgICBpZiAoIXRoaXMuc3RhdGUuYXNzZXRzLnNvbWUoKGVudHJ5KSA9PiBlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdCA9PT0gZGlnZXN0KSkge1xuICAgICAgYXdhaXQgdGhpcy5hZGFwdGVyLmRlbGV0ZUJsb2Ioe2FjY291bnRJZDogdGhpcy5hY2NvdW50SWQsIGRpZ2VzdH0pXG4gICAgfVxuXG4gICAgY29uc3QgcGVuZGluZ0RlbGV0aW9uRGlnZXN0cyA9IHRoaXMuc3RhdGUucGVuZGluZ0RlbGV0aW9uRGlnZXN0c1xuXG4gICAgdGhpcy5zdGF0ZS5wZW5kaW5nRGVsZXRpb25EaWdlc3RzID0gcGVuZGluZ0RlbGV0aW9uRGlnZXN0cy5maWx0ZXIoKGNhbmRpZGF0ZSkgPT4gY2FuZGlkYXRlICE9PSBkaWdlc3QpXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5zYXZlU3RhdGUoKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLnN0YXRlLnBlbmRpbmdEZWxldGlvbkRpZ2VzdHMgPSBwZW5kaW5nRGVsZXRpb25EaWdlc3RzXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBGaW5kcyByZXF1aXJlZCBhc3NldHMgd2l0aG91dCBsb2NhbGx5IGNhY2hlZCBieXRlcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHNjb3BlS2V5IFN5bmNocm9uaXplZCBzY29wZSB0byBpbnNwZWN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmdbXT59IE1pc3NpbmcgcmVxdWlyZWQgZGVzY3JpcHRvciBpZHMuXG4gICAqL1xuICBhc3luYyBtaXNzaW5nUmVxdWlyZWRBc3NldElkcyhzY29wZUtleSkge1xuICAgIGNvbnN0IHN0YXRlID0gYXdhaXQgdGhpcy5sb2FkU3RhdGUoKVxuICAgIC8qKiBAdHlwZSB7c3RyaW5nW119ICovXG4gICAgY29uc3QgbWlzc2luZ0Fzc2V0SWRzID0gW11cblxuICAgIGZvciAoY29uc3QgZW50cnkgb2Ygc3RhdGUuYXNzZXRzKSB7XG4gICAgICBpZiAoIWVudHJ5LnNjb3BlS2V5cy5pbmNsdWRlcyhzY29wZUtleSkpIGNvbnRpbnVlXG4gICAgICBpZiAoZW50cnkuZGVzY3JpcHRvci5vZmZsaW5lUmVxdWlyZW1lbnQgIT09IFwicmVxdWlyZWRcIikgY29udGludWVcbiAgICAgIGlmIChhd2FpdCB0aGlzLmNhY2hlZFVyaShlbnRyeSkpIGNvbnRpbnVlXG5cbiAgICAgIG1pc3NpbmdBc3NldElkcy5wdXNoKGVudHJ5LmRlc2NyaXB0b3IuaWQpXG4gICAgfVxuXG4gICAgcmV0dXJuIG1pc3NpbmdBc3NldElkc1xuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrcyB3aGV0aGVyIGEgZmFpbGVkIG9yIG1pc3NpbmcgZW50cnkgbWF5IGJlIGRvd25sb2FkZWQgbm93LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZUVudHJ5fSBlbnRyeSBEZXNjcmlwdG9yIHN0YXRlLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gV2hldGhlciB0aGUgcmV0cnkgZGVhZGxpbmUgaGFzIHBhc3NlZC5cbiAgICovXG4gIHJldHJ5RWxpZ2libGUoZW50cnkpIHtcbiAgICByZXR1cm4gZW50cnkuc3RhdHVzICE9PSBcImZhaWxlZFwiIHx8IGVudHJ5Lm5leHRSZXRyeUF0ID09PSBudWxsIHx8IGVudHJ5Lm5leHRSZXRyeUF0IDw9IHRoaXMubm93TWlsbGlzZWNvbmRzKClcbiAgfVxuXG4gIC8qKlxuICAgKiBDYWxjdWxhdGVzIGJvdW5kZWQgZXhwb25lbnRpYWwgcmV0cnkgZGVsYXkuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhdHRlbXB0cyBDb25zZWN1dGl2ZSBmYWlsdXJlcy5cbiAgICogQHJldHVybnMge251bWJlcn0gUmV0cnkgZGVsYXkuXG4gICAqL1xuICByZXRyeURlbGF5KGF0dGVtcHRzKSB7XG4gICAgcmV0dXJuIE1hdGgubWluKHRoaXMucmV0cnlNYXhEZWxheU1zLCB0aGlzLnJldHJ5QmFzZURlbGF5TXMgKiAoMiAqKiBNYXRoLm1heCgwLCBhdHRlbXB0cyAtIDEpKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkcyB0aGUgaW5qZWN0YWJsZSB3YWxsIGNsb2NrLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSBDdXJyZW50IGVwb2NoIG1pbGxpc2Vjb25kcy5cbiAgICovXG4gIG5vd01pbGxpc2Vjb25kcygpIHtcbiAgICByZXR1cm4gdGhpcy5ub3coKS5nZXRUaW1lKClcbiAgfVxufVxuIl19