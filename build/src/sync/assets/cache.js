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
        const cachedUri = await this.cachedUri(entry);
        if (cachedUri) {
            entry.lastAccessedAt = this.nowMilliseconds();
            entry.status = "cached";
            await this.saveState();
            return cachedUri;
        }
        if (!online || !this.retryEligible(entry))
            return null;
        const cacheResult = await this.ensureCached(entry);
        if (cacheResult.error)
            throw cacheResult.error;
        if (!cacheResult.uri)
            return null;
        await this.cleanup(new Set([entry.descriptor.digest]));
        return cacheResult.uri;
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
            if (this.downloadPromises.has(blob.digest))
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
                await this.deletePendingDigestIfUnreferenced(digest);
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
     * Deletes one persisted pending digest when no descriptor or download owns it.
     * @param {string} digest Content digest.
     * @returns {Promise<void>} Resolves after any required deletion.
     */
    async deletePendingDigestIfUnreferenced(digest) {
        if (!this.state)
            throw new Error("Cannot delete synchronized asset blobs before loading state");
        if (!this.state.pendingDeletionDigests.includes(digest))
            return;
        if (this.downloadPromises.has(digest))
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2FjaGUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvc3luYy9hc3NldHMvY2FjaGUuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sY0FBYyxNQUFNLGlDQUFpQyxDQUFBO0FBRTVELE1BQU0sbUJBQW1CLEdBQUcsQ0FBQyxDQUFBO0FBQzdCLE1BQU0sMkJBQTJCLEdBQUcsSUFBSSxDQUFBO0FBQ3hDLE1BQU0sMEJBQTBCLEdBQUcsSUFBSSxHQUFHLEVBQUUsR0FBRyxDQUFDLENBQUE7QUFFaEQ7OztHQUdHO0FBQ0gsTUFBTSxDQUFDLE9BQU8sT0FBTyxzQkFBc0I7SUFDekM7Ozs7Ozs7Ozs7T0FVRztJQUNILFlBQVksRUFBQyxTQUFTLEVBQUUsT0FBTyxFQUFFLFFBQVEsRUFBRSxRQUFRLEVBQUUsR0FBRyxHQUFHLEdBQUcsRUFBRSxDQUFDLElBQUksSUFBSSxFQUFFLEVBQUUsZ0JBQWdCLEdBQUcsMkJBQTJCLEVBQUUsZUFBZSxHQUFHLDBCQUEwQixFQUFDO1FBQ3hLLElBQUksQ0FBQyxTQUFTO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxpREFBaUQsQ0FBQyxDQUFBO1FBQ2xGLElBQUksQ0FBQyxNQUFNLENBQUMsYUFBYSxDQUFDLFFBQVEsQ0FBQyxJQUFJLFFBQVEsR0FBRyxDQUFDO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyx1RUFBdUUsQ0FBQyxDQUFBO1FBQzdJLElBQUksQ0FBQyxNQUFNLENBQUMsYUFBYSxDQUFDLGdCQUFnQixDQUFDLElBQUksZ0JBQWdCLEdBQUcsQ0FBQztZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsMkVBQTJFLENBQUMsQ0FBQTtRQUNqSyxJQUFJLENBQUMsTUFBTSxDQUFDLGFBQWEsQ0FBQyxlQUFlLENBQUMsSUFBSSxlQUFlLEdBQUcsZ0JBQWdCO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyw0RUFBNEUsQ0FBQyxDQUFBO1FBRS9LLElBQUksQ0FBQyxTQUFTLEdBQUcsU0FBUyxDQUFBO1FBQzFCLElBQUksQ0FBQyxPQUFPLEdBQUcsT0FBTyxDQUFBO1FBQ3RCLElBQUksQ0FBQyxRQUFRLEdBQUcsUUFBUSxDQUFBO1FBQ3hCLElBQUksQ0FBQyxRQUFRLEdBQUcsUUFBUSxDQUFBO1FBQ3hCLElBQUksQ0FBQyxHQUFHLEdBQUcsR0FBRyxDQUFBO1FBQ2QsSUFBSSxDQUFDLGdCQUFnQixHQUFHLGdCQUFnQixDQUFBO1FBQ3hDLElBQUksQ0FBQyxlQUFlLEdBQUcsZUFBZSxDQUFBO1FBQ3RDLDJDQUEyQztRQUMzQyxJQUFJLENBQUMsZ0JBQWdCLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQTtRQUNqQyxzRUFBc0U7UUFDdEUsSUFBSSxDQUFDLEtBQUssR0FBRyxJQUFJLENBQUE7UUFDakIsK0VBQStFO1FBQy9FLElBQUksQ0FBQyxZQUFZLEdBQUcsSUFBSSxDQUFBO1FBQ3hCLDRCQUE0QjtRQUM1QixJQUFJLENBQUMsZ0JBQWdCLEdBQUcsT0FBTyxDQUFDLE9BQU8sRUFBRSxDQUFBO0lBQzNDLENBQUM7SUFFRDs7Ozs7Ozs7T0FRRztJQUNILEtBQUssQ0FBQyxXQUFXLENBQUMsRUFBQyxXQUFXLEVBQUUsTUFBTSxFQUFFLFFBQVEsRUFBQztRQUMvQyxNQUFNLEtBQUssR0FBRyxNQUFNLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQTtRQUNwQyxNQUFNLFdBQVcsR0FBRyxJQUFJLEdBQUcsQ0FBQyxXQUFXLENBQUMsR0FBRyxDQUFDLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQTtRQUNqRSxNQUFNLFdBQVcsR0FBRyxJQUFJLEdBQUcsQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUE7UUFDdEYsTUFBTSxXQUFXLEdBQUcsSUFBSSxHQUFHLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLENBQUMsS0FBSyxDQUFDLFVBQVUsQ0FBQyxFQUFFLEVBQUUsS0FBSyxDQUFDLFVBQVUsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUE7UUFDeEcsTUFBTSxjQUFjLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQTtRQUVoQyxLQUFLLE1BQU0sS0FBSyxJQUFJLFdBQVcsRUFBRSxDQUFDO1lBQ2hDLE1BQU0sV0FBVyxHQUFHLFdBQVcsQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxDQUFBO1lBRTdDLElBQUksV0FBVyxLQUFLLFNBQVMsSUFBSSxXQUFXLEtBQUssS0FBSyxDQUFDLE1BQU0sRUFBRSxDQUFDO2dCQUM5RCxNQUFNLElBQUksS0FBSyxDQUFDLGlDQUFpQyxLQUFLLENBQUMsRUFBRSwrQkFBK0IsQ0FBQyxDQUFBO1lBQzNGLENBQUM7WUFFRCxXQUFXLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxFQUFFLEVBQUUsS0FBSyxDQUFDLE1BQU0sQ0FBQyxDQUFBO1FBQ3pDLENBQUM7UUFFRCxLQUFLLE1BQU0sS0FBSyxJQUFJLEtBQUssQ0FBQyxNQUFNLEVBQUUsQ0FBQztZQUNqQyxJQUFJLENBQUMsS0FBSyxDQUFDLFNBQVMsQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDLElBQUksV0FBVyxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDLEVBQUUsQ0FBQztnQkFBRSxTQUFRO1lBRXpGLEtBQUssQ0FBQyxTQUFTLEdBQUcsS0FBSyxDQUFDLFNBQVMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxTQUFTLEVBQUUsRUFBRSxDQUFDLFNBQVMsS0FBSyxRQUFRLENBQUMsQ0FBQTtZQUMvRSxJQUFJLEtBQUssQ0FBQyxTQUFTLENBQUMsTUFBTSxLQUFLLENBQUM7Z0JBQUUsY0FBYyxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDLE1BQU0sQ0FBQyxDQUFBO1FBQy9FLENBQUM7UUFFRCxLQUFLLENBQUMsTUFBTSxHQUFHLEtBQUssQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxLQUFLLENBQUMsU0FBUyxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUMsQ0FBQTtRQUV6RSxLQUFLLE1BQU0sS0FBSyxJQUFJLFdBQVcsRUFBRSxDQUFDO1lBQ2hDLE1BQU0sUUFBUSxHQUFHLFdBQVcsQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxDQUFBO1lBRTFDLElBQUksUUFBUSxJQUFJLEtBQUssQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUM7Z0JBQ2hELFFBQVEsQ0FBQyxVQUFVLEdBQUcsS0FBSyxDQUFBO2dCQUMzQixJQUFJLENBQUMsUUFBUSxDQUFDLFNBQVMsQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDO29CQUFFLFFBQVEsQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFBO1lBQy9FLENBQUM7aUJBQU0sQ0FBQztnQkFDTixNQUFNLFFBQVEsR0FBRztvQkFDZixRQUFRLEVBQUUsQ0FBQztvQkFDWCxVQUFVLEVBQUUsS0FBSztvQkFDakIsY0FBYyxFQUFFLElBQUksQ0FBQyxlQUFlLEVBQUU7b0JBQ3RDLFdBQVcsRUFBRSxJQUFJO29CQUNqQixTQUFTLEVBQUUsQ0FBQyxRQUFRLENBQUM7b0JBQ3JCLE1BQU0sRUFBRSxvQkFBb0IsQ0FBQyxDQUFDLFNBQVMsQ0FBQztpQkFDekMsQ0FBQTtnQkFFRCxLQUFLLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQTtnQkFDM0IsV0FBVyxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsRUFBRSxFQUFFLFFBQVEsQ0FBQyxDQUFBO1lBQ3JDLENBQUM7UUFDSCxDQUFDO1FBRUQsS0FBSyxNQUFNLE1BQU0sSUFBSSxjQUFjLEVBQUUsQ0FBQztZQUNwQyxJQUFJLEtBQUssQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDLE1BQU0sS0FBSyxNQUFNLENBQUM7Z0JBQUUsU0FBUTtZQUM5RSxJQUFJLENBQUMsS0FBSyxDQUFDLHNCQUFzQixDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUM7Z0JBQUUsS0FBSyxDQUFDLHNCQUFzQixDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQTtRQUMvRixDQUFDO1FBRUQsTUFBTSxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUE7UUFDdEIsTUFBTSxJQUFJLENBQUMseUJBQXlCLEVBQUUsQ0FBQTtRQUV0QyxtRUFBbUU7UUFDbkUsTUFBTSxRQUFRLEdBQUcsRUFBRSxDQUFBO1FBRW5CLElBQUksTUFBTSxFQUFFLENBQUM7WUFDWCxLQUFLLE1BQU0sS0FBSyxJQUFJLFdBQVcsRUFBRSxDQUFDO2dCQUNoQyxJQUFJLEtBQUssQ0FBQyxLQUFLLEtBQUssT0FBTztvQkFBRSxTQUFRO2dCQUVyQyxNQUFNLEtBQUssR0FBRyxXQUFXLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUMsQ0FBQTtnQkFFdkMsSUFBSSxDQUFDLEtBQUssSUFBSSxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsS0FBSyxDQUFDO29CQUFFLFNBQVE7Z0JBRWxELE1BQU0sV0FBVyxHQUFHLE1BQU0sSUFBSSxDQUFDLFlBQVksQ0FBQyxLQUFLLENBQUMsQ0FBQTtnQkFFbEQsSUFBSSxXQUFXLENBQUMsS0FBSztvQkFBRSxRQUFRLENBQUMsSUFBSSxDQUFDLEVBQUMsT0FBTyxFQUFFLEtBQUssQ0FBQyxFQUFFLEVBQUUsS0FBSyxFQUFFLFdBQVcsQ0FBQyxLQUFLLEVBQUMsQ0FBQyxDQUFBO1lBQ3JGLENBQUM7UUFDSCxDQUFDO1FBRUQsTUFBTSxJQUFJLENBQUMsT0FBTyxFQUFFLENBQUE7UUFFcEIsT0FBTztZQUNMLFFBQVE7WUFDUix1QkFBdUIsRUFBRSxNQUFNLElBQUksQ0FBQyx1QkFBdUIsQ0FBQyxRQUFRLENBQUM7U0FDdEUsQ0FBQTtJQUNILENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxLQUFLLENBQUMsT0FBTyxDQUFDLEVBQUMsT0FBTyxFQUFFLE1BQU0sRUFBQztRQUM3QixNQUFNLEtBQUssR0FBRyxNQUFNLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQTtRQUNwQyxNQUFNLEtBQUssR0FBRyxLQUFLLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLFNBQVMsRUFBRSxFQUFFLENBQUMsU0FBUyxDQUFDLFVBQVUsQ0FBQyxFQUFFLEtBQUssT0FBTyxDQUFDLENBQUE7UUFFbkYsSUFBSSxDQUFDLEtBQUs7WUFBRSxPQUFPLElBQUksQ0FBQTtRQUV2QixNQUFNLFNBQVMsR0FBRyxNQUFNLElBQUksQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDLENBQUE7UUFFN0MsSUFBSSxTQUFTLEVBQUUsQ0FBQztZQUNkLEtBQUssQ0FBQyxjQUFjLEdBQUcsSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFBO1lBQzdDLEtBQUssQ0FBQyxNQUFNLEdBQUcsUUFBUSxDQUFBO1lBQ3ZCLE1BQU0sSUFBSSxDQUFDLFNBQVMsRUFBRSxDQUFBO1lBRXRCLE9BQU8sU0FBUyxDQUFBO1FBQ2xCLENBQUM7UUFFRCxJQUFJLENBQUMsTUFBTSxJQUFJLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxLQUFLLENBQUM7WUFBRSxPQUFPLElBQUksQ0FBQTtRQUV0RCxNQUFNLFdBQVcsR0FBRyxNQUFNLElBQUksQ0FBQyxZQUFZLENBQUMsS0FBSyxDQUFDLENBQUE7UUFFbEQsSUFBSSxXQUFXLENBQUMsS0FBSztZQUFFLE1BQU0sV0FBVyxDQUFDLEtBQUssQ0FBQTtRQUM5QyxJQUFJLENBQUMsV0FBVyxDQUFDLEdBQUc7WUFBRSxPQUFPLElBQUksQ0FBQTtRQUVqQyxNQUFNLElBQUksQ0FBQyxPQUFPLENBQUMsSUFBSSxHQUFHLENBQUMsQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQTtRQUV0RCxPQUFPLFdBQVcsQ0FBQyxHQUFHLENBQUE7SUFDeEIsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILEtBQUssQ0FBQyxPQUFPLENBQUMsZ0JBQWdCLEdBQUcsSUFBSSxHQUFHLEVBQUU7UUFDeEMsTUFBTSxLQUFLLEdBQUcsTUFBTSxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUE7UUFDcEMsOEVBQThFO1FBQzlFLE1BQU0sZUFBZSxHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7UUFFakMsS0FBSyxNQUFNLEtBQUssSUFBSSxLQUFLLENBQUMsTUFBTSxFQUFFLENBQUM7WUFDakMsTUFBTSxhQUFhLEdBQUcsZUFBZSxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDLE1BQU0sQ0FBQyxJQUFJLEVBQUUsQ0FBQTtZQUV4RSxhQUFhLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFBO1lBQ3pCLGVBQWUsQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLFVBQVUsQ0FBQyxNQUFNLEVBQUUsYUFBYSxDQUFDLENBQUE7UUFDN0QsQ0FBQztRQUVELDJJQUEySTtRQUMzSSxNQUFNLFdBQVcsR0FBRyxFQUFFLENBQUE7UUFDdEIsSUFBSSxXQUFXLEdBQUcsQ0FBQyxDQUFBO1FBRW5CLEtBQUssTUFBTSxDQUFDLE1BQU0sRUFBRSxVQUFVLENBQUMsSUFBSSxlQUFlLEVBQUUsQ0FBQztZQUNuRCxNQUFNLEdBQUcsR0FBRyxNQUFNLElBQUksQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLEVBQUMsU0FBUyxFQUFFLElBQUksQ0FBQyxTQUFTLEVBQUUsTUFBTSxFQUFDLENBQUMsQ0FBQTtZQUUzRSxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUM7Z0JBQ1QsS0FBSyxNQUFNLEtBQUssSUFBSSxVQUFVLEVBQUUsQ0FBQztvQkFDL0IsSUFBSSxLQUFLLENBQUMsTUFBTSxLQUFLLFFBQVE7d0JBQUUsS0FBSyxDQUFDLE1BQU0sR0FBRyxTQUFTLENBQUE7Z0JBQ3pELENBQUM7Z0JBQ0QsU0FBUTtZQUNWLENBQUM7WUFFRCxNQUFNLFFBQVEsR0FBRyxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUMsVUFBVSxDQUFDLFFBQVEsQ0FBQTtZQUVsRCxXQUFXLElBQUksUUFBUSxDQUFBO1lBQ3ZCLFdBQVcsQ0FBQyxJQUFJLENBQUM7Z0JBQ2YsUUFBUTtnQkFDUixNQUFNO2dCQUNOLGNBQWMsRUFBRSxJQUFJLENBQUMsR0FBRyxDQUFDLEdBQUcsVUFBVSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsS0FBSyxDQUFDLGNBQWMsQ0FBQyxDQUFDO2dCQUM1RSxVQUFVO2FBQ1gsQ0FBQyxDQUFBO1FBQ0osQ0FBQztRQUVELFdBQVcsQ0FBQyxJQUFJLENBQUMsQ0FBQyxJQUFJLEVBQUUsS0FBSyxFQUFFLEVBQUUsQ0FBQyxJQUFJLENBQUMsY0FBYyxHQUFHLEtBQUssQ0FBQyxjQUFjLElBQUksSUFBSSxDQUFDLE1BQU0sQ0FBQyxhQUFhLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUE7UUFFeEgsSUFBSSxZQUFZLEdBQUcsQ0FBQyxDQUFBO1FBRXBCLEtBQUssTUFBTSxJQUFJLElBQUksV0FBVyxFQUFFLENBQUM7WUFDL0IsSUFBSSxXQUFXLElBQUksSUFBSSxDQUFDLFFBQVE7Z0JBQUUsTUFBSztZQUN2QyxJQUFJLGdCQUFnQixDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDO2dCQUFFLFNBQVE7WUFDL0MsSUFBSSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUM7Z0JBQUUsU0FBUTtZQUNwRCxJQUFJLElBQUksQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDLFNBQVMsS0FBSyxTQUFTLENBQUM7Z0JBQUUsU0FBUTtZQUV2RixNQUFNLElBQUksQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDLEVBQUMsU0FBUyxFQUFFLElBQUksQ0FBQyxTQUFTLEVBQUUsTUFBTSxFQUFFLElBQUksQ0FBQyxNQUFNLEVBQUMsQ0FBQyxDQUFBO1lBQy9FLFdBQVcsSUFBSSxJQUFJLENBQUMsUUFBUSxDQUFBO1lBQzVCLFlBQVksSUFBSSxJQUFJLENBQUMsUUFBUSxDQUFBO1lBRTdCLEtBQUssTUFBTSxLQUFLLElBQUksSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFDO2dCQUNwQyxLQUFLLENBQUMsUUFBUSxHQUFHLENBQUMsQ0FBQTtnQkFDbEIsS0FBSyxDQUFDLFdBQVcsR0FBRyxJQUFJLENBQUE7Z0JBQ3hCLEtBQUssQ0FBQyxNQUFNLEdBQUcsU0FBUyxDQUFBO1lBQzFCLENBQUM7UUFDSCxDQUFDO1FBRUQsTUFBTSxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUE7UUFFdEIsT0FBTyxZQUFZLENBQUE7SUFDckIsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxTQUFTO1FBQ2IsSUFBSSxJQUFJLENBQUMsS0FBSztZQUFFLE9BQU8sSUFBSSxDQUFDLEtBQUssQ0FBQTtRQUNqQyxJQUFJLElBQUksQ0FBQyxZQUFZO1lBQUUsT0FBTyxNQUFNLElBQUksQ0FBQyxZQUFZLENBQUE7UUFFckQsSUFBSSxDQUFDLFlBQVksR0FBRyxJQUFJLENBQUMsb0JBQW9CLEVBQUUsQ0FBQTtRQUUvQyxJQUFJLENBQUM7WUFDSCxJQUFJLENBQUMsS0FBSyxHQUFHLE1BQU0sSUFBSSxDQUFDLFlBQVksQ0FBQTtZQUVwQyxPQUFPLElBQUksQ0FBQyxLQUFLLENBQUE7UUFDbkIsQ0FBQztnQkFBUyxDQUFDO1lBQ1QsSUFBSSxDQUFDLFlBQVksR0FBRyxJQUFJLENBQUE7UUFDMUIsQ0FBQztJQUNILENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLLENBQUMsb0JBQW9CO1FBQ3hCLE1BQU0sV0FBVyxHQUFHLE1BQU0sSUFBSSxDQUFDLE9BQU8sQ0FBQyxTQUFTLENBQUMsRUFBQyxTQUFTLEVBQUUsSUFBSSxDQUFDLFNBQVMsRUFBQyxDQUFDLENBQUE7UUFFN0UsSUFBSSxDQUFDLFdBQVc7WUFBRSxPQUFPLEVBQUMsTUFBTSxFQUFFLEVBQUUsRUFBRSxzQkFBc0IsRUFBRSxFQUFFLEVBQUUsT0FBTyxFQUFFLG1CQUFtQixFQUFDLENBQUE7UUFDL0YsSUFBSSxXQUFXLENBQUMsT0FBTyxLQUFLLG1CQUFtQixFQUFFLENBQUM7WUFDaEQsTUFBTSxJQUFJLEtBQUssQ0FBQyx1REFBdUQsV0FBVyxDQUFDLE9BQU8sRUFBRSxDQUFDLENBQUE7UUFDL0YsQ0FBQztRQUVELElBQUksNEJBQTRCLEdBQUcsS0FBSyxDQUFBO1FBRXhDLEtBQUssTUFBTSxLQUFLLElBQUksV0FBVyxDQUFDLE1BQU0sRUFBRSxDQUFDO1lBQ3ZDLElBQUksS0FBSyxDQUFDLE1BQU0sS0FBSyxhQUFhO2dCQUFFLFNBQVE7WUFFNUMsS0FBSyxDQUFDLFFBQVEsSUFBSSxDQUFDLENBQUE7WUFDbkIsS0FBSyxDQUFDLFdBQVcsR0FBRyxJQUFJLENBQUMsZUFBZSxFQUFFLENBQUE7WUFDMUMsS0FBSyxDQUFDLE1BQU0sR0FBRyxRQUFRLENBQUE7WUFDdkIsNEJBQTRCLEdBQUcsSUFBSSxDQUFBO1FBQ3JDLENBQUM7UUFFRCxJQUFJLDRCQUE0QixFQUFFLENBQUM7WUFDakMsTUFBTSxJQUFJLENBQUMsT0FBTyxDQUFDLFNBQVMsQ0FBQyxFQUFDLFNBQVMsRUFBRSxJQUFJLENBQUMsU0FBUyxFQUFFLEtBQUssRUFBRSxXQUFXLEVBQUMsQ0FBQyxDQUFBO1FBQy9FLENBQUM7UUFFRCxPQUFPLFdBQVcsQ0FBQTtJQUNwQixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLFNBQVM7UUFDYixJQUFJLENBQUMsSUFBSSxDQUFDLEtBQUs7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLDJEQUEyRCxDQUFDLENBQUE7UUFFN0YsTUFBTSxPQUFPLEdBQUcsS0FBSyxJQUFJLEVBQUU7WUFDekIsSUFBSSxDQUFDLElBQUksQ0FBQyxLQUFLO2dCQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsMkRBQTJELENBQUMsQ0FBQTtZQUU3RixNQUFNLElBQUksQ0FBQyxPQUFPLENBQUMsU0FBUyxDQUFDLEVBQUMsU0FBUyxFQUFFLElBQUksQ0FBQyxTQUFTLEVBQUUsS0FBSyxFQUFFLElBQUksQ0FBQyxLQUFLLEVBQUMsQ0FBQyxDQUFBO1FBQzlFLENBQUMsQ0FBQTtRQUVELElBQUksQ0FBQyxnQkFBZ0IsR0FBRyxJQUFJLENBQUMsZ0JBQWdCLENBQUMsSUFBSSxDQUFDLE9BQU8sRUFBRSxPQUFPLENBQUMsQ0FBQTtRQUVwRSxNQUFNLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQTtJQUM3QixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxZQUFZLENBQUMsS0FBSztRQUN0QixNQUFNLFdBQVcsR0FBRyxNQUFNLElBQUksQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDLENBQUE7UUFFL0MsSUFBSSxXQUFXLEVBQUUsQ0FBQztZQUNoQixLQUFLLENBQUMsUUFBUSxHQUFHLENBQUMsQ0FBQTtZQUNsQixLQUFLLENBQUMsY0FBYyxHQUFHLElBQUksQ0FBQyxlQUFlLEVBQUUsQ0FBQTtZQUM3QyxLQUFLLENBQUMsV0FBVyxHQUFHLElBQUksQ0FBQTtZQUN4QixLQUFLLENBQUMsTUFBTSxHQUFHLFFBQVEsQ0FBQTtZQUN2QixNQUFNLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQTtZQUV0QixPQUFPLEVBQUMsS0FBSyxFQUFFLElBQUksRUFBRSxHQUFHLEVBQUUsV0FBVyxFQUFDLENBQUE7UUFDeEMsQ0FBQztRQUVELEtBQUssQ0FBQyxNQUFNLEdBQUcsYUFBYSxDQUFBO1FBQzVCLE1BQU0sSUFBSSxDQUFDLFNBQVMsRUFBRSxDQUFBO1FBRXRCLE1BQU0sTUFBTSxHQUFHLEtBQUssQ0FBQyxVQUFVLENBQUMsTUFBTSxDQUFBO1FBQ3RDLElBQUksZUFBZSxHQUFHLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDLENBQUE7UUFDdkQsSUFBSSxtQkFBbUIsR0FBRyxLQUFLLENBQUE7UUFFL0IsSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFDO1lBQ3JCLGVBQWUsR0FBRyxJQUFJLENBQUMsZ0JBQWdCLENBQUMsS0FBSyxDQUFDLFVBQVUsQ0FBQyxDQUFBO1lBQ3pELElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxHQUFHLENBQUMsTUFBTSxFQUFFLGVBQWUsQ0FBQyxDQUFBO1lBQ2xELG1CQUFtQixHQUFHLElBQUksQ0FBQTtRQUM1QixDQUFDO1FBRUQsSUFBSSxDQUFDO1lBQ0gsTUFBTSxHQUFHLEdBQUcsTUFBTSxlQUFlLENBQUE7WUFFakMsS0FBSyxDQUFDLFFBQVEsR0FBRyxDQUFDLENBQUE7WUFDbEIsS0FBSyxDQUFDLGNBQWMsR0FBRyxJQUFJLENBQUMsZUFBZSxFQUFFLENBQUE7WUFDN0MsS0FBSyxDQUFDLFdBQVcsR0FBRyxJQUFJLENBQUE7WUFDeEIsS0FBSyxDQUFDLE1BQU0sR0FBRyxRQUFRLENBQUE7WUFDdkIsTUFBTSxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUE7WUFFdEIsT0FBTyxFQUFDLEtBQUssRUFBRSxJQUFJLEVBQUUsR0FBRyxFQUFDLENBQUE7UUFDM0IsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZixNQUFNLE9BQU8sR0FBRyxLQUFLLFlBQVksS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLElBQUksS0FBSyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFBO1lBRXpFLEtBQUssQ0FBQyxRQUFRLElBQUksQ0FBQyxDQUFBO1lBQ25CLEtBQUssQ0FBQyxXQUFXLEdBQUcsSUFBSSxDQUFDLGVBQWUsRUFBRSxHQUFHLElBQUksQ0FBQyxVQUFVLENBQUMsS0FBSyxDQUFDLFFBQVEsQ0FBQyxDQUFBO1lBQzVFLEtBQUssQ0FBQyxNQUFNLEdBQUcsUUFBUSxDQUFBO1lBQ3ZCLE1BQU0sSUFBSSxDQUFDLFNBQVMsRUFBRSxDQUFBO1lBRXRCLE9BQU8sRUFBQyxLQUFLLEVBQUUsT0FBTyxFQUFFLEdBQUcsRUFBRSxJQUFJLEVBQUMsQ0FBQTtRQUNwQyxDQUFDO2dCQUFTLENBQUM7WUFDVCxJQUFJLG1CQUFtQixJQUFJLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDLEtBQUssZUFBZSxFQUFFLENBQUM7Z0JBQ2pGLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUE7Z0JBRXBDLE1BQU0sSUFBSSxDQUFDLGlDQUFpQyxDQUFDLE1BQU0sQ0FBQyxDQUFBO1lBQ3RELENBQUM7UUFDSCxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsZ0JBQWdCLENBQUMsVUFBVTtRQUMvQixNQUFNLGVBQWUsR0FBRyxNQUFNLElBQUksQ0FBQyxRQUFRLENBQUMsVUFBVSxDQUFDLENBQUE7UUFFdkQsSUFBSSxDQUFDLENBQUMsZUFBZSxZQUFZLFVBQVUsQ0FBQyxFQUFFLENBQUM7WUFDN0MsTUFBTSxJQUFJLEtBQUssQ0FBQyxzQkFBc0IsVUFBVSxDQUFDLEVBQUUsMkNBQTJDLENBQUMsQ0FBQTtRQUNqRyxDQUFDO1FBQ0QsSUFBSSxlQUFlLENBQUMsVUFBVSxLQUFLLFVBQVUsQ0FBQyxRQUFRLEVBQUUsQ0FBQztZQUN2RCxNQUFNLElBQUksS0FBSyxDQUFDLHNCQUFzQixVQUFVLENBQUMsRUFBRSx5Q0FBeUMsQ0FBQyxDQUFBO1FBQy9GLENBQUM7UUFFRCxNQUFNLE1BQU0sR0FBRyxVQUFVLGNBQWMsQ0FBQyxlQUFlLENBQUMsRUFBRSxDQUFBO1FBRTFELElBQUksTUFBTSxLQUFLLFVBQVUsQ0FBQyxNQUFNLEVBQUUsQ0FBQztZQUNqQyxNQUFNLElBQUksS0FBSyxDQUFDLHNCQUFzQixVQUFVLENBQUMsRUFBRSxzQ0FBc0MsQ0FBQyxDQUFBO1FBQzVGLENBQUM7UUFFRCxNQUFNLEdBQUcsR0FBRyxNQUFNLElBQUksQ0FBQyxPQUFPLENBQUMsU0FBUyxDQUFDO1lBQ3ZDLFNBQVMsRUFBRSxJQUFJLENBQUMsU0FBUztZQUN6QixLQUFLLEVBQUUsZUFBZTtZQUN0QixXQUFXLEVBQUUsVUFBVSxDQUFDLFdBQVc7WUFDbkMsTUFBTTtTQUNQLENBQUMsQ0FBQTtRQUVGLElBQUksQ0FBQyxHQUFHO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxrREFBa0QsVUFBVSxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUE7UUFFNUYsT0FBTyxHQUFHLENBQUE7SUFDWixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxTQUFTLENBQUMsS0FBSztRQUNuQixNQUFNLEdBQUcsR0FBRyxNQUFNLElBQUksQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDO1lBQ3JDLFNBQVMsRUFBRSxJQUFJLENBQUMsU0FBUztZQUN6QixNQUFNLEVBQUUsS0FBSyxDQUFDLFVBQVUsQ0FBQyxNQUFNO1NBQ2hDLENBQUMsQ0FBQTtRQUVGLElBQUksQ0FBQyxHQUFHLElBQUksS0FBSyxDQUFDLE1BQU0sS0FBSyxRQUFRO1lBQUUsS0FBSyxDQUFDLE1BQU0sR0FBRyxTQUFTLENBQUE7UUFFL0QsT0FBTyxHQUFHLENBQUE7SUFDWixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLHlCQUF5QjtRQUM3QixJQUFJLENBQUMsSUFBSSxDQUFDLEtBQUs7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLDZEQUE2RCxDQUFDLENBQUE7UUFFL0YsS0FBSyxNQUFNLE1BQU0sSUFBSSxDQUFDLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxzQkFBc0IsQ0FBQyxFQUFFLENBQUM7WUFDNUQsTUFBTSxJQUFJLENBQUMsaUNBQWlDLENBQUMsTUFBTSxDQUFDLENBQUE7UUFDdEQsQ0FBQztJQUNILENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLGlDQUFpQyxDQUFDLE1BQU07UUFDNUMsSUFBSSxDQUFDLElBQUksQ0FBQyxLQUFLO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyw2REFBNkQsQ0FBQyxDQUFBO1FBQy9GLElBQUksQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLHNCQUFzQixDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUM7WUFBRSxPQUFNO1FBQy9ELElBQUksSUFBSSxDQUFDLGdCQUFnQixDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUM7WUFBRSxPQUFNO1FBRTdDLElBQUksQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsTUFBTSxLQUFLLE1BQU0sQ0FBQyxFQUFFLENBQUM7WUFDM0UsTUFBTSxJQUFJLENBQUMsT0FBTyxDQUFDLFVBQVUsQ0FBQyxFQUFDLFNBQVMsRUFBRSxJQUFJLENBQUMsU0FBUyxFQUFFLE1BQU0sRUFBQyxDQUFDLENBQUE7UUFDcEUsQ0FBQztRQUVELE1BQU0sc0JBQXNCLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxzQkFBc0IsQ0FBQTtRQUVoRSxJQUFJLENBQUMsS0FBSyxDQUFDLHNCQUFzQixHQUFHLHNCQUFzQixDQUFDLE1BQU0sQ0FBQyxDQUFDLFNBQVMsRUFBRSxFQUFFLENBQUMsU0FBUyxLQUFLLE1BQU0sQ0FBQyxDQUFBO1FBRXRHLElBQUksQ0FBQztZQUNILE1BQU0sSUFBSSxDQUFDLFNBQVMsRUFBRSxDQUFBO1FBQ3hCLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsSUFBSSxDQUFDLEtBQUssQ0FBQyxzQkFBc0IsR0FBRyxzQkFBc0IsQ0FBQTtZQUMxRCxNQUFNLEtBQUssQ0FBQTtRQUNiLENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyx1QkFBdUIsQ0FBQyxRQUFRO1FBQ3BDLE1BQU0sS0FBSyxHQUFHLE1BQU0sSUFBSSxDQUFDLFNBQVMsRUFBRSxDQUFBO1FBQ3BDLHVCQUF1QjtRQUN2QixNQUFNLGVBQWUsR0FBRyxFQUFFLENBQUE7UUFFMUIsS0FBSyxNQUFNLEtBQUssSUFBSSxLQUFLLENBQUMsTUFBTSxFQUFFLENBQUM7WUFDakMsSUFBSSxDQUFDLEtBQUssQ0FBQyxTQUFTLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQztnQkFBRSxTQUFRO1lBQ2pELElBQUksS0FBSyxDQUFDLFVBQVUsQ0FBQyxrQkFBa0IsS0FBSyxVQUFVO2dCQUFFLFNBQVE7WUFDaEUsSUFBSSxNQUFNLElBQUksQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDO2dCQUFFLFNBQVE7WUFFekMsZUFBZSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDLEVBQUUsQ0FBQyxDQUFBO1FBQzNDLENBQUM7UUFFRCxPQUFPLGVBQWUsQ0FBQTtJQUN4QixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILGFBQWEsQ0FBQyxLQUFLO1FBQ2pCLE9BQU8sS0FBSyxDQUFDLE1BQU0sS0FBSyxRQUFRLElBQUksS0FBSyxDQUFDLFdBQVcsS0FBSyxJQUFJLElBQUksS0FBSyxDQUFDLFdBQVcsSUFBSSxJQUFJLENBQUMsZUFBZSxFQUFFLENBQUE7SUFDL0csQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxVQUFVLENBQUMsUUFBUTtRQUNqQixPQUFPLElBQUksQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLGVBQWUsRUFBRSxJQUFJLENBQUMsZ0JBQWdCLEdBQUcsQ0FBQyxDQUFDLElBQUksSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsUUFBUSxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQTtJQUNqRyxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsZUFBZTtRQUNiLE9BQU8sSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDLE9BQU8sRUFBRSxDQUFBO0lBQzdCLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgc2hhMjU2Qnl0ZXNIZXggZnJvbSBcIi4uLy4uL3V0aWxzL3NoYTI1Ni1ieXRlcy1oZXguanNcIlxuXG5jb25zdCBDQUNIRV9TVEFURV9WRVJTSU9OID0gMVxuY29uc3QgREVGQVVMVF9SRVRSWV9CQVNFX0RFTEFZX01TID0gMTAwMFxuY29uc3QgREVGQVVMVF9SRVRSWV9NQVhfREVMQVlfTVMgPSAxMDAwICogNjAgKiA1XG5cbi8qKlxuICogQ29yZSBzeW5jaHJvbml6ZWQgYXNzZXQgY2FjaGUuIFBsYXRmb3JtIHBhY2thZ2VzIG93biBieXRlIGFuZCBtZXRhZGF0YVxuICogcGVyc2lzdGVuY2Ugd2hpbGUgdGhpcyBjbGFzcyBvd25zIHBvbGljeSwgaW50ZWdyaXR5LCBhbmQgbGlmZWN5Y2xlLlxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBTeW5jaHJvbml6ZWRBc3NldENhY2hlIHtcbiAgLyoqXG4gICAqIENyZWF0ZXMgYSBzeW5jaHJvbml6ZWQgYXNzZXQgY2FjaGUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmFjY291bnRJZCBBdXRoZW50aWNhdGVkIGFjY291bnQgbmFtZXNwYWNlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZUFkYXB0ZXJ9IGFyZ3MuYWRhcHRlciBQbGF0Zm9ybSBzdG9yYWdlIGFkYXB0ZXIuXG4gICAqIEBwYXJhbSB7KGRlc2NyaXB0b3I6IGltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZURlc2NyaXB0b3IpID0+IFByb21pc2U8VWludDhBcnJheT59IGFyZ3MuZG93bmxvYWQgQXV0aGVudGljYXRlZCBieXRlIGRvd25sb2FkZXIuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLm1heEJ5dGVzIE1heGltdW0gZXZpY3RhYmxlIGNhY2hlIHNpemUuXG4gICAqIEBwYXJhbSB7KCkgPT4gRGF0ZX0gW2FyZ3Mubm93XSBDbG9jay5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLnJldHJ5QmFzZURlbGF5TXNdIEluaXRpYWwgcmV0cnkgZGVsYXkuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5yZXRyeU1heERlbGF5TXNdIE1heGltdW0gcmV0cnkgZGVsYXkuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7YWNjb3VudElkLCBhZGFwdGVyLCBkb3dubG9hZCwgbWF4Qnl0ZXMsIG5vdyA9ICgpID0+IG5ldyBEYXRlKCksIHJldHJ5QmFzZURlbGF5TXMgPSBERUZBVUxUX1JFVFJZX0JBU0VfREVMQVlfTVMsIHJldHJ5TWF4RGVsYXlNcyA9IERFRkFVTFRfUkVUUllfTUFYX0RFTEFZX01TfSkge1xuICAgIGlmICghYWNjb3VudElkKSB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jaHJvbml6ZWQgYXNzZXQgY2FjaGUgcmVxdWlyZXMgYW4gYWNjb3VudCBpZFwiKVxuICAgIGlmICghTnVtYmVyLmlzU2FmZUludGVnZXIobWF4Qnl0ZXMpIHx8IG1heEJ5dGVzIDwgMCkgdGhyb3cgbmV3IEVycm9yKFwiU3luY2hyb25pemVkIGFzc2V0IGNhY2hlIG1heEJ5dGVzIG11c3QgYmUgYSBub24tbmVnYXRpdmUgc2FmZSBpbnRlZ2VyXCIpXG4gICAgaWYgKCFOdW1iZXIuaXNTYWZlSW50ZWdlcihyZXRyeUJhc2VEZWxheU1zKSB8fCByZXRyeUJhc2VEZWxheU1zIDwgMSkgdGhyb3cgbmV3IEVycm9yKFwiU3luY2hyb25pemVkIGFzc2V0IGNhY2hlIHJldHJ5QmFzZURlbGF5TXMgbXVzdCBiZSBhIHBvc2l0aXZlIHNhZmUgaW50ZWdlclwiKVxuICAgIGlmICghTnVtYmVyLmlzU2FmZUludGVnZXIocmV0cnlNYXhEZWxheU1zKSB8fCByZXRyeU1heERlbGF5TXMgPCByZXRyeUJhc2VEZWxheU1zKSB0aHJvdyBuZXcgRXJyb3IoXCJTeW5jaHJvbml6ZWQgYXNzZXQgY2FjaGUgcmV0cnlNYXhEZWxheU1zIG11c3QgYmUgYXQgbGVhc3QgcmV0cnlCYXNlRGVsYXlNc1wiKVxuXG4gICAgdGhpcy5hY2NvdW50SWQgPSBhY2NvdW50SWRcbiAgICB0aGlzLmFkYXB0ZXIgPSBhZGFwdGVyXG4gICAgdGhpcy5kb3dubG9hZCA9IGRvd25sb2FkXG4gICAgdGhpcy5tYXhCeXRlcyA9IG1heEJ5dGVzXG4gICAgdGhpcy5ub3cgPSBub3dcbiAgICB0aGlzLnJldHJ5QmFzZURlbGF5TXMgPSByZXRyeUJhc2VEZWxheU1zXG4gICAgdGhpcy5yZXRyeU1heERlbGF5TXMgPSByZXRyeU1heERlbGF5TXNcbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIFByb21pc2U8c3RyaW5nPj59ICovXG4gICAgdGhpcy5kb3dubG9hZFByb21pc2VzID0gbmV3IE1hcCgpXG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVTdGF0ZSB8IG51bGx9ICovXG4gICAgdGhpcy5zdGF0ZSA9IG51bGxcbiAgICAvKiogQHR5cGUge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlU3RhdGU+IHwgbnVsbH0gKi9cbiAgICB0aGlzLnN0YXRlUHJvbWlzZSA9IG51bGxcbiAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD59ICovXG4gICAgdGhpcy5zYXZlU3RhdGVQcm9taXNlID0gUHJvbWlzZS5yZXNvbHZlKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvbmNpbGVzIHRoZSBpbW11dGFibGUgZGVzY3JpcHRvcnMgZm9yIG9uZSBzeW5jaHJvbml6ZWQgc2NvcGUgYW5kXG4gICAqIGRvd25sb2FkcyBlbGlnaWJsZSBlYWdlciBhc3NldHMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIFJlY29uY2lsaWF0aW9uIGlucHV0cy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVEZXNjcmlwdG9yW119IGFyZ3MuZGVzY3JpcHRvcnMgQ3VycmVudCBkZXNjcmlwdG9ycyBpbiB0aGUgc2NvcGUuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5vbmxpbmUgV2hldGhlciBhdXRoZW50aWNhdGVkIGRvd25sb2FkcyBhcmUgYXZhaWxhYmxlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zY29wZUtleSBTdGFibGUgc3luY2hyb25pemVkIHNjb3BlIGtleS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlU3luY2hyb25pemF0aW9uUmVzdWx0Pn0gU3luY2hyb25pemF0aW9uIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHN5bmNocm9uaXplKHtkZXNjcmlwdG9ycywgb25saW5lLCBzY29wZUtleX0pIHtcbiAgICBjb25zdCBzdGF0ZSA9IGF3YWl0IHRoaXMubG9hZFN0YXRlKClcbiAgICBjb25zdCBpbmNvbWluZ0lkcyA9IG5ldyBTZXQoZGVzY3JpcHRvcnMubWFwKChhc3NldCkgPT4gYXNzZXQuaWQpKVxuICAgIGNvbnN0IGVudHJpZXNCeUlkID0gbmV3IE1hcChzdGF0ZS5hc3NldHMubWFwKChlbnRyeSkgPT4gW2VudHJ5LmRlc2NyaXB0b3IuaWQsIGVudHJ5XSkpXG4gICAgY29uc3QgZGlnZXN0c0J5SWQgPSBuZXcgTWFwKHN0YXRlLmFzc2V0cy5tYXAoKGVudHJ5KSA9PiBbZW50cnkuZGVzY3JpcHRvci5pZCwgZW50cnkuZGVzY3JpcHRvci5kaWdlc3RdKSlcbiAgICBjb25zdCByZW1vdmVkRGlnZXN0cyA9IG5ldyBTZXQoKVxuXG4gICAgZm9yIChjb25zdCBhc3NldCBvZiBkZXNjcmlwdG9ycykge1xuICAgICAgY29uc3Qga25vd25EaWdlc3QgPSBkaWdlc3RzQnlJZC5nZXQoYXNzZXQuaWQpXG5cbiAgICAgIGlmIChrbm93bkRpZ2VzdCAhPT0gdW5kZWZpbmVkICYmIGtub3duRGlnZXN0ICE9PSBhc3NldC5kaWdlc3QpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBTeW5jaHJvbml6ZWQgYXNzZXQgZGVzY3JpcHRvciAke2Fzc2V0LmlkfSBjaGFuZ2VkIGl0cyBpbW11dGFibGUgZGlnZXN0YClcbiAgICAgIH1cblxuICAgICAgZGlnZXN0c0J5SWQuc2V0KGFzc2V0LmlkLCBhc3NldC5kaWdlc3QpXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiBzdGF0ZS5hc3NldHMpIHtcbiAgICAgIGlmICghZW50cnkuc2NvcGVLZXlzLmluY2x1ZGVzKHNjb3BlS2V5KSB8fCBpbmNvbWluZ0lkcy5oYXMoZW50cnkuZGVzY3JpcHRvci5pZCkpIGNvbnRpbnVlXG5cbiAgICAgIGVudHJ5LnNjb3BlS2V5cyA9IGVudHJ5LnNjb3BlS2V5cy5maWx0ZXIoKGNhbmRpZGF0ZSkgPT4gY2FuZGlkYXRlICE9PSBzY29wZUtleSlcbiAgICAgIGlmIChlbnRyeS5zY29wZUtleXMubGVuZ3RoID09PSAwKSByZW1vdmVkRGlnZXN0cy5hZGQoZW50cnkuZGVzY3JpcHRvci5kaWdlc3QpXG4gICAgfVxuXG4gICAgc3RhdGUuYXNzZXRzID0gc3RhdGUuYXNzZXRzLmZpbHRlcigoZW50cnkpID0+IGVudHJ5LnNjb3BlS2V5cy5sZW5ndGggPiAwKVxuXG4gICAgZm9yIChjb25zdCBhc3NldCBvZiBkZXNjcmlwdG9ycykge1xuICAgICAgY29uc3QgZXhpc3RpbmcgPSBlbnRyaWVzQnlJZC5nZXQoYXNzZXQuaWQpXG5cbiAgICAgIGlmIChleGlzdGluZyAmJiBzdGF0ZS5hc3NldHMuaW5jbHVkZXMoZXhpc3RpbmcpKSB7XG4gICAgICAgIGV4aXN0aW5nLmRlc2NyaXB0b3IgPSBhc3NldFxuICAgICAgICBpZiAoIWV4aXN0aW5nLnNjb3BlS2V5cy5pbmNsdWRlcyhzY29wZUtleSkpIGV4aXN0aW5nLnNjb3BlS2V5cy5wdXNoKHNjb3BlS2V5KVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY29uc3QgbmV3RW50cnkgPSB7XG4gICAgICAgICAgYXR0ZW1wdHM6IDAsXG4gICAgICAgICAgZGVzY3JpcHRvcjogYXNzZXQsXG4gICAgICAgICAgbGFzdEFjY2Vzc2VkQXQ6IHRoaXMubm93TWlsbGlzZWNvbmRzKCksXG4gICAgICAgICAgbmV4dFJldHJ5QXQ6IG51bGwsXG4gICAgICAgICAgc2NvcGVLZXlzOiBbc2NvcGVLZXldLFxuICAgICAgICAgIHN0YXR1czogLyoqIEB0eXBlIHtjb25zdH0gKi8gKFwibWlzc2luZ1wiKVxuICAgICAgICB9XG5cbiAgICAgICAgc3RhdGUuYXNzZXRzLnB1c2gobmV3RW50cnkpXG4gICAgICAgIGVudHJpZXNCeUlkLnNldChhc3NldC5pZCwgbmV3RW50cnkpXG4gICAgICB9XG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBkaWdlc3Qgb2YgcmVtb3ZlZERpZ2VzdHMpIHtcbiAgICAgIGlmIChzdGF0ZS5hc3NldHMuc29tZSgoZW50cnkpID0+IGVudHJ5LmRlc2NyaXB0b3IuZGlnZXN0ID09PSBkaWdlc3QpKSBjb250aW51ZVxuICAgICAgaWYgKCFzdGF0ZS5wZW5kaW5nRGVsZXRpb25EaWdlc3RzLmluY2x1ZGVzKGRpZ2VzdCkpIHN0YXRlLnBlbmRpbmdEZWxldGlvbkRpZ2VzdHMucHVzaChkaWdlc3QpXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5zYXZlU3RhdGUoKVxuICAgIGF3YWl0IHRoaXMuZGVsZXRlVW5yZWZlcmVuY2VkRGlnZXN0cygpXG5cbiAgICAvKiogQHR5cGUge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZUZhaWx1cmVbXX0gKi9cbiAgICBjb25zdCBmYWlsdXJlcyA9IFtdXG5cbiAgICBpZiAob25saW5lKSB7XG4gICAgICBmb3IgKGNvbnN0IGFzc2V0IG9mIGRlc2NyaXB0b3JzKSB7XG4gICAgICAgIGlmIChhc3NldC5mZXRjaCAhPT0gXCJlYWdlclwiKSBjb250aW51ZVxuXG4gICAgICAgIGNvbnN0IGVudHJ5ID0gZW50cmllc0J5SWQuZ2V0KGFzc2V0LmlkKVxuXG4gICAgICAgIGlmICghZW50cnkgfHwgIXRoaXMucmV0cnlFbGlnaWJsZShlbnRyeSkpIGNvbnRpbnVlXG5cbiAgICAgICAgY29uc3QgY2FjaGVSZXN1bHQgPSBhd2FpdCB0aGlzLmVuc3VyZUNhY2hlZChlbnRyeSlcblxuICAgICAgICBpZiAoY2FjaGVSZXN1bHQuZXJyb3IpIGZhaWx1cmVzLnB1c2goe2Fzc2V0SWQ6IGFzc2V0LmlkLCBlcnJvcjogY2FjaGVSZXN1bHQuZXJyb3J9KVxuICAgICAgfVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuY2xlYW51cCgpXG5cbiAgICByZXR1cm4ge1xuICAgICAgZmFpbHVyZXMsXG4gICAgICBtaXNzaW5nUmVxdWlyZWRBc3NldElkczogYXdhaXQgdGhpcy5taXNzaW5nUmVxdWlyZWRBc3NldElkcyhzY29wZUtleSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYSBjYWNoZWQgYXNzZXQgVVJJLCBkb3dubG9hZGluZyBpdCBvbiBkZW1hbmQgd2hlbiBhbGxvd2VkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyBSZXNvbHV0aW9uIGlucHV0cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuYXNzZXRJZCBBdHRhY2htZW50IGRlc2NyaXB0b3IgaWQuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5vbmxpbmUgV2hldGhlciBhdXRoZW50aWNhdGVkIGRvd25sb2FkcyBhcmUgYXZhaWxhYmxlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmcgfCBudWxsPn0gQ2FjaGVkIGFzc2V0IFVSSS5cbiAgICovXG4gIGFzeW5jIHJlc29sdmUoe2Fzc2V0SWQsIG9ubGluZX0pIHtcbiAgICBjb25zdCBzdGF0ZSA9IGF3YWl0IHRoaXMubG9hZFN0YXRlKClcbiAgICBjb25zdCBlbnRyeSA9IHN0YXRlLmFzc2V0cy5maW5kKChjYW5kaWRhdGUpID0+IGNhbmRpZGF0ZS5kZXNjcmlwdG9yLmlkID09PSBhc3NldElkKVxuXG4gICAgaWYgKCFlbnRyeSkgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IGNhY2hlZFVyaSA9IGF3YWl0IHRoaXMuY2FjaGVkVXJpKGVudHJ5KVxuXG4gICAgaWYgKGNhY2hlZFVyaSkge1xuICAgICAgZW50cnkubGFzdEFjY2Vzc2VkQXQgPSB0aGlzLm5vd01pbGxpc2Vjb25kcygpXG4gICAgICBlbnRyeS5zdGF0dXMgPSBcImNhY2hlZFwiXG4gICAgICBhd2FpdCB0aGlzLnNhdmVTdGF0ZSgpXG5cbiAgICAgIHJldHVybiBjYWNoZWRVcmlcbiAgICB9XG5cbiAgICBpZiAoIW9ubGluZSB8fCAhdGhpcy5yZXRyeUVsaWdpYmxlKGVudHJ5KSkgcmV0dXJuIG51bGxcblxuICAgIGNvbnN0IGNhY2hlUmVzdWx0ID0gYXdhaXQgdGhpcy5lbnN1cmVDYWNoZWQoZW50cnkpXG5cbiAgICBpZiAoY2FjaGVSZXN1bHQuZXJyb3IpIHRocm93IGNhY2hlUmVzdWx0LmVycm9yXG4gICAgaWYgKCFjYWNoZVJlc3VsdC51cmkpIHJldHVybiBudWxsXG5cbiAgICBhd2FpdCB0aGlzLmNsZWFudXAobmV3IFNldChbZW50cnkuZGVzY3JpcHRvci5kaWdlc3RdKSlcblxuICAgIHJldHVybiBjYWNoZVJlc3VsdC51cmlcbiAgfVxuXG4gIC8qKlxuICAgKiBFdmljdHMgbGVhc3QtcmVjZW50bHktdXNlZCBibG9icyB1bnRpbCB0aGUgdW5pcXVlIGNhY2hlZCBieXRlIHRvdGFsIGlzXG4gICAqIHdpdGhpbiB0aGUgY29uZmlndXJlZCBidWRnZXQuIEEgYmxvYiBzdGF5cyBkdXJhYmxlIHdoZW4gYW55IGxpdmVcbiAgICogZGVzY3JpcHRvciByZWZlcmVuY2UgZGVjbGFyZXMgZHVyYWJsZSByZXRlbnRpb24uXG4gICAqIEBwYXJhbSB7U2V0PHN0cmluZz59IFtwcm90ZWN0ZWREaWdlc3RzXSBEaWdlc3RzIG5lZWRlZCBieSB0aGUgYWN0aXZlIGNhbGxlci5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gQnl0ZXMgcmVtb3ZlZC5cbiAgICovXG4gIGFzeW5jIGNsZWFudXAocHJvdGVjdGVkRGlnZXN0cyA9IG5ldyBTZXQoKSkge1xuICAgIGNvbnN0IHN0YXRlID0gYXdhaXQgdGhpcy5sb2FkU3RhdGUoKVxuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgaW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlRW50cnlbXT59ICovXG4gICAgY29uc3QgZW50cmllc0J5RGlnZXN0ID0gbmV3IE1hcCgpXG5cbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHN0YXRlLmFzc2V0cykge1xuICAgICAgY29uc3QgZGlnZXN0RW50cmllcyA9IGVudHJpZXNCeURpZ2VzdC5nZXQoZW50cnkuZGVzY3JpcHRvci5kaWdlc3QpIHx8IFtdXG5cbiAgICAgIGRpZ2VzdEVudHJpZXMucHVzaChlbnRyeSlcbiAgICAgIGVudHJpZXNCeURpZ2VzdC5zZXQoZW50cnkuZGVzY3JpcHRvci5kaWdlc3QsIGRpZ2VzdEVudHJpZXMpXG4gICAgfVxuXG4gICAgLyoqIEB0eXBlIHt7Ynl0ZVNpemU6IG51bWJlciwgZGlnZXN0OiBzdHJpbmcsIGxhc3RBY2Nlc3NlZEF0OiBudW1iZXIsIHJlZmVyZW5jZXM6IGltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZUVudHJ5W119W119ICovXG4gICAgY29uc3QgY2FjaGVkQmxvYnMgPSBbXVxuICAgIGxldCBjYWNoZWRCeXRlcyA9IDBcblxuICAgIGZvciAoY29uc3QgW2RpZ2VzdCwgcmVmZXJlbmNlc10gb2YgZW50cmllc0J5RGlnZXN0KSB7XG4gICAgICBjb25zdCB1cmkgPSBhd2FpdCB0aGlzLmFkYXB0ZXIuYmxvYlVyaSh7YWNjb3VudElkOiB0aGlzLmFjY291bnRJZCwgZGlnZXN0fSlcblxuICAgICAgaWYgKCF1cmkpIHtcbiAgICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiByZWZlcmVuY2VzKSB7XG4gICAgICAgICAgaWYgKGVudHJ5LnN0YXR1cyA9PT0gXCJjYWNoZWRcIikgZW50cnkuc3RhdHVzID0gXCJtaXNzaW5nXCJcbiAgICAgICAgfVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBjb25zdCBieXRlU2l6ZSA9IHJlZmVyZW5jZXNbMF0uZGVzY3JpcHRvci5ieXRlU2l6ZVxuXG4gICAgICBjYWNoZWRCeXRlcyArPSBieXRlU2l6ZVxuICAgICAgY2FjaGVkQmxvYnMucHVzaCh7XG4gICAgICAgIGJ5dGVTaXplLFxuICAgICAgICBkaWdlc3QsXG4gICAgICAgIGxhc3RBY2Nlc3NlZEF0OiBNYXRoLm1heCguLi5yZWZlcmVuY2VzLm1hcCgoZW50cnkpID0+IGVudHJ5Lmxhc3RBY2Nlc3NlZEF0KSksXG4gICAgICAgIHJlZmVyZW5jZXNcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgY2FjaGVkQmxvYnMuc29ydCgobGVmdCwgcmlnaHQpID0+IGxlZnQubGFzdEFjY2Vzc2VkQXQgLSByaWdodC5sYXN0QWNjZXNzZWRBdCB8fCBsZWZ0LmRpZ2VzdC5sb2NhbGVDb21wYXJlKHJpZ2h0LmRpZ2VzdCkpXG5cbiAgICBsZXQgcmVtb3ZlZEJ5dGVzID0gMFxuXG4gICAgZm9yIChjb25zdCBibG9iIG9mIGNhY2hlZEJsb2JzKSB7XG4gICAgICBpZiAoY2FjaGVkQnl0ZXMgPD0gdGhpcy5tYXhCeXRlcykgYnJlYWtcbiAgICAgIGlmIChwcm90ZWN0ZWREaWdlc3RzLmhhcyhibG9iLmRpZ2VzdCkpIGNvbnRpbnVlXG4gICAgICBpZiAodGhpcy5kb3dubG9hZFByb21pc2VzLmhhcyhibG9iLmRpZ2VzdCkpIGNvbnRpbnVlXG4gICAgICBpZiAoYmxvYi5yZWZlcmVuY2VzLnNvbWUoKGVudHJ5KSA9PiBlbnRyeS5kZXNjcmlwdG9yLnJldGVudGlvbiA9PT0gXCJkdXJhYmxlXCIpKSBjb250aW51ZVxuXG4gICAgICBhd2FpdCB0aGlzLmFkYXB0ZXIuZGVsZXRlQmxvYih7YWNjb3VudElkOiB0aGlzLmFjY291bnRJZCwgZGlnZXN0OiBibG9iLmRpZ2VzdH0pXG4gICAgICBjYWNoZWRCeXRlcyAtPSBibG9iLmJ5dGVTaXplXG4gICAgICByZW1vdmVkQnl0ZXMgKz0gYmxvYi5ieXRlU2l6ZVxuXG4gICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGJsb2IucmVmZXJlbmNlcykge1xuICAgICAgICBlbnRyeS5hdHRlbXB0cyA9IDBcbiAgICAgICAgZW50cnkubmV4dFJldHJ5QXQgPSBudWxsXG4gICAgICAgIGVudHJ5LnN0YXR1cyA9IFwibWlzc2luZ1wiXG4gICAgICB9XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5zYXZlU3RhdGUoKVxuXG4gICAgcmV0dXJuIHJlbW92ZWRCeXRlc1xuICB9XG5cbiAgLyoqXG4gICAqIExvYWRzIGNhY2hlIHN0YXRlIG9uY2UgZm9yIHRoaXMgY2FjaGUgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZVN0YXRlPn0gTG9hZGVkIHN0YXRlLlxuICAgKi9cbiAgYXN5bmMgbG9hZFN0YXRlKCkge1xuICAgIGlmICh0aGlzLnN0YXRlKSByZXR1cm4gdGhpcy5zdGF0ZVxuICAgIGlmICh0aGlzLnN0YXRlUHJvbWlzZSkgcmV0dXJuIGF3YWl0IHRoaXMuc3RhdGVQcm9taXNlXG5cbiAgICB0aGlzLnN0YXRlUHJvbWlzZSA9IHRoaXMubG9hZFN0YXRlRnJvbUFkYXB0ZXIoKVxuXG4gICAgdHJ5IHtcbiAgICAgIHRoaXMuc3RhdGUgPSBhd2FpdCB0aGlzLnN0YXRlUHJvbWlzZVxuXG4gICAgICByZXR1cm4gdGhpcy5zdGF0ZVxuICAgIH0gZmluYWxseSB7XG4gICAgICB0aGlzLnN0YXRlUHJvbWlzZSA9IG51bGxcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogTG9hZHMgYW5kIHJlY292ZXJzIHBlcnNpc3RlZCBjYWNoZSBzdGF0ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlU3RhdGU+fSBMb2FkZWQgc3RhdGUuXG4gICAqL1xuICBhc3luYyBsb2FkU3RhdGVGcm9tQWRhcHRlcigpIHtcbiAgICBjb25zdCBsb2FkZWRTdGF0ZSA9IGF3YWl0IHRoaXMuYWRhcHRlci5sb2FkU3RhdGUoe2FjY291bnRJZDogdGhpcy5hY2NvdW50SWR9KVxuXG4gICAgaWYgKCFsb2FkZWRTdGF0ZSkgcmV0dXJuIHthc3NldHM6IFtdLCBwZW5kaW5nRGVsZXRpb25EaWdlc3RzOiBbXSwgdmVyc2lvbjogQ0FDSEVfU1RBVEVfVkVSU0lPTn1cbiAgICBpZiAobG9hZGVkU3RhdGUudmVyc2lvbiAhPT0gQ0FDSEVfU1RBVEVfVkVSU0lPTikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbnN1cHBvcnRlZCBzeW5jaHJvbml6ZWQgYXNzZXQgY2FjaGUgc3RhdGUgdmVyc2lvbjogJHtsb2FkZWRTdGF0ZS52ZXJzaW9ufWApXG4gICAgfVxuXG4gICAgbGV0IHJlY292ZXJlZEludGVycnVwdGVkRG93bmxvYWQgPSBmYWxzZVxuXG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiBsb2FkZWRTdGF0ZS5hc3NldHMpIHtcbiAgICAgIGlmIChlbnRyeS5zdGF0dXMgIT09IFwiZG93bmxvYWRpbmdcIikgY29udGludWVcblxuICAgICAgZW50cnkuYXR0ZW1wdHMgKz0gMVxuICAgICAgZW50cnkubmV4dFJldHJ5QXQgPSB0aGlzLm5vd01pbGxpc2Vjb25kcygpXG4gICAgICBlbnRyeS5zdGF0dXMgPSBcImZhaWxlZFwiXG4gICAgICByZWNvdmVyZWRJbnRlcnJ1cHRlZERvd25sb2FkID0gdHJ1ZVxuICAgIH1cblxuICAgIGlmIChyZWNvdmVyZWRJbnRlcnJ1cHRlZERvd25sb2FkKSB7XG4gICAgICBhd2FpdCB0aGlzLmFkYXB0ZXIuc2F2ZVN0YXRlKHthY2NvdW50SWQ6IHRoaXMuYWNjb3VudElkLCBzdGF0ZTogbG9hZGVkU3RhdGV9KVxuICAgIH1cblxuICAgIHJldHVybiBsb2FkZWRTdGF0ZVxuICB9XG5cbiAgLyoqXG4gICAqIFBlcnNpc3RzIHRoZSBjdXJyZW50IGNhY2hlIHN0YXRlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgYWZ0ZXIgc3RhdGUgcGVyc2lzdGVuY2UuXG4gICAqL1xuICBhc3luYyBzYXZlU3RhdGUoKSB7XG4gICAgaWYgKCF0aGlzLnN0YXRlKSB0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3Qgc2F2ZSBzeW5jaHJvbml6ZWQgYXNzZXQgY2FjaGUgYmVmb3JlIGxvYWRpbmcgc3RhdGVcIilcblxuICAgIGNvbnN0IHBlcnNpc3QgPSBhc3luYyAoKSA9PiB7XG4gICAgICBpZiAoIXRoaXMuc3RhdGUpIHRocm93IG5ldyBFcnJvcihcIkNhbm5vdCBzYXZlIHN5bmNocm9uaXplZCBhc3NldCBjYWNoZSBiZWZvcmUgbG9hZGluZyBzdGF0ZVwiKVxuXG4gICAgICBhd2FpdCB0aGlzLmFkYXB0ZXIuc2F2ZVN0YXRlKHthY2NvdW50SWQ6IHRoaXMuYWNjb3VudElkLCBzdGF0ZTogdGhpcy5zdGF0ZX0pXG4gICAgfVxuXG4gICAgdGhpcy5zYXZlU3RhdGVQcm9taXNlID0gdGhpcy5zYXZlU3RhdGVQcm9taXNlLnRoZW4ocGVyc2lzdCwgcGVyc2lzdClcblxuICAgIGF3YWl0IHRoaXMuc2F2ZVN0YXRlUHJvbWlzZVxuICB9XG5cbiAgLyoqXG4gICAqIEVuc3VyZXMgb25lIGRlc2NyaXB0b3IgaGFzIHZlcmlmaWVkIGxvY2FsIGJ5dGVzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdHlwZXMuanNcIikuU3luY2hyb25pemVkQXNzZXRDYWNoZUVudHJ5fSBlbnRyeSBEZXNjcmlwdG9yIHN0YXRlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7ZXJyb3I6IEVycm9yIHwgbnVsbCwgdXJpOiBzdHJpbmcgfCBudWxsfT59IENhY2hlIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGVuc3VyZUNhY2hlZChlbnRyeSkge1xuICAgIGNvbnN0IGV4aXN0aW5nVXJpID0gYXdhaXQgdGhpcy5jYWNoZWRVcmkoZW50cnkpXG5cbiAgICBpZiAoZXhpc3RpbmdVcmkpIHtcbiAgICAgIGVudHJ5LmF0dGVtcHRzID0gMFxuICAgICAgZW50cnkubGFzdEFjY2Vzc2VkQXQgPSB0aGlzLm5vd01pbGxpc2Vjb25kcygpXG4gICAgICBlbnRyeS5uZXh0UmV0cnlBdCA9IG51bGxcbiAgICAgIGVudHJ5LnN0YXR1cyA9IFwiY2FjaGVkXCJcbiAgICAgIGF3YWl0IHRoaXMuc2F2ZVN0YXRlKClcblxuICAgICAgcmV0dXJuIHtlcnJvcjogbnVsbCwgdXJpOiBleGlzdGluZ1VyaX1cbiAgICB9XG5cbiAgICBlbnRyeS5zdGF0dXMgPSBcImRvd25sb2FkaW5nXCJcbiAgICBhd2FpdCB0aGlzLnNhdmVTdGF0ZSgpXG5cbiAgICBjb25zdCBkaWdlc3QgPSBlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdFxuICAgIGxldCBkb3dubG9hZFByb21pc2UgPSB0aGlzLmRvd25sb2FkUHJvbWlzZXMuZ2V0KGRpZ2VzdClcbiAgICBsZXQgb3duc0Rvd25sb2FkUHJvbWlzZSA9IGZhbHNlXG5cbiAgICBpZiAoIWRvd25sb2FkUHJvbWlzZSkge1xuICAgICAgZG93bmxvYWRQcm9taXNlID0gdGhpcy5kb3dubG9hZFZlcmlmaWVkKGVudHJ5LmRlc2NyaXB0b3IpXG4gICAgICB0aGlzLmRvd25sb2FkUHJvbWlzZXMuc2V0KGRpZ2VzdCwgZG93bmxvYWRQcm9taXNlKVxuICAgICAgb3duc0Rvd25sb2FkUHJvbWlzZSA9IHRydWVcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgdXJpID0gYXdhaXQgZG93bmxvYWRQcm9taXNlXG5cbiAgICAgIGVudHJ5LmF0dGVtcHRzID0gMFxuICAgICAgZW50cnkubGFzdEFjY2Vzc2VkQXQgPSB0aGlzLm5vd01pbGxpc2Vjb25kcygpXG4gICAgICBlbnRyeS5uZXh0UmV0cnlBdCA9IG51bGxcbiAgICAgIGVudHJ5LnN0YXR1cyA9IFwiY2FjaGVkXCJcbiAgICAgIGF3YWl0IHRoaXMuc2F2ZVN0YXRlKClcblxuICAgICAgcmV0dXJuIHtlcnJvcjogbnVsbCwgdXJpfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zdCBmYWlsdXJlID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpXG5cbiAgICAgIGVudHJ5LmF0dGVtcHRzICs9IDFcbiAgICAgIGVudHJ5Lm5leHRSZXRyeUF0ID0gdGhpcy5ub3dNaWxsaXNlY29uZHMoKSArIHRoaXMucmV0cnlEZWxheShlbnRyeS5hdHRlbXB0cylcbiAgICAgIGVudHJ5LnN0YXR1cyA9IFwiZmFpbGVkXCJcbiAgICAgIGF3YWl0IHRoaXMuc2F2ZVN0YXRlKClcblxuICAgICAgcmV0dXJuIHtlcnJvcjogZmFpbHVyZSwgdXJpOiBudWxsfVxuICAgIH0gZmluYWxseSB7XG4gICAgICBpZiAob3duc0Rvd25sb2FkUHJvbWlzZSAmJiB0aGlzLmRvd25sb2FkUHJvbWlzZXMuZ2V0KGRpZ2VzdCkgPT09IGRvd25sb2FkUHJvbWlzZSkge1xuICAgICAgICB0aGlzLmRvd25sb2FkUHJvbWlzZXMuZGVsZXRlKGRpZ2VzdClcblxuICAgICAgICBhd2FpdCB0aGlzLmRlbGV0ZVBlbmRpbmdEaWdlc3RJZlVucmVmZXJlbmNlZChkaWdlc3QpXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIERvd25sb2FkcywgdmVyaWZpZXMsIGFuZCBhdG9taWNhbGx5IHBlcnNpc3RzIG9uZSBjb250ZW50IGRpZ2VzdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3R5cGVzLmpzXCIpLlN5bmNocm9uaXplZEFzc2V0Q2FjaGVEZXNjcmlwdG9yfSBkZXNjcmlwdG9yIEFzc2V0IGRlc2NyaXB0b3IuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IEFkYXB0ZXIgVVJJLlxuICAgKi9cbiAgYXN5bmMgZG93bmxvYWRWZXJpZmllZChkZXNjcmlwdG9yKSB7XG4gICAgY29uc3QgZG93bmxvYWRlZEJ5dGVzID0gYXdhaXQgdGhpcy5kb3dubG9hZChkZXNjcmlwdG9yKVxuXG4gICAgaWYgKCEoZG93bmxvYWRlZEJ5dGVzIGluc3RhbmNlb2YgVWludDhBcnJheSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgU3luY2hyb25pemVkIGFzc2V0ICR7ZGVzY3JpcHRvci5pZH0gZG93bmxvYWQgZGlkIG5vdCByZXR1cm4gVWludDhBcnJheSBieXRlc2ApXG4gICAgfVxuICAgIGlmIChkb3dubG9hZGVkQnl0ZXMuYnl0ZUxlbmd0aCAhPT0gZGVzY3JpcHRvci5ieXRlU2l6ZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBTeW5jaHJvbml6ZWQgYXNzZXQgJHtkZXNjcmlwdG9yLmlkfSBieXRlIHNpemUgZGlkIG5vdCBtYXRjaCBpdHMgZGVzY3JpcHRvcmApXG4gICAgfVxuXG4gICAgY29uc3QgZGlnZXN0ID0gYHNoYTI1Ni0ke3NoYTI1NkJ5dGVzSGV4KGRvd25sb2FkZWRCeXRlcyl9YFxuXG4gICAgaWYgKGRpZ2VzdCAhPT0gZGVzY3JpcHRvci5kaWdlc3QpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgU3luY2hyb25pemVkIGFzc2V0ICR7ZGVzY3JpcHRvci5pZH0gZGlnZXN0IGRpZCBub3QgbWF0Y2ggaXRzIGRlc2NyaXB0b3JgKVxuICAgIH1cblxuICAgIGNvbnN0IHVyaSA9IGF3YWl0IHRoaXMuYWRhcHRlci53cml0ZUJsb2Ioe1xuICAgICAgYWNjb3VudElkOiB0aGlzLmFjY291bnRJZCxcbiAgICAgIGJ5dGVzOiBkb3dubG9hZGVkQnl0ZXMsXG4gICAgICBjb250ZW50VHlwZTogZGVzY3JpcHRvci5jb250ZW50VHlwZSxcbiAgICAgIGRpZ2VzdFxuICAgIH0pXG5cbiAgICBpZiAoIXVyaSkgdGhyb3cgbmV3IEVycm9yKGBTeW5jaHJvbml6ZWQgYXNzZXQgYWRhcHRlciByZXR1cm5lZCBubyBVUkkgZm9yICR7ZGVzY3JpcHRvci5pZH1gKVxuXG4gICAgcmV0dXJuIHVyaVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGFuIGV4aXN0aW5nIGxvY2FsIFVSSSBhbmQgcmVwYWlycyBzdGFsZSBjYWNoZWQgbWV0YWRhdGEuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlRW50cnl9IGVudHJ5IERlc2NyaXB0b3Igc3RhdGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZyB8IG51bGw+fSBFeGlzdGluZyBVUkkuXG4gICAqL1xuICBhc3luYyBjYWNoZWRVcmkoZW50cnkpIHtcbiAgICBjb25zdCB1cmkgPSBhd2FpdCB0aGlzLmFkYXB0ZXIuYmxvYlVyaSh7XG4gICAgICBhY2NvdW50SWQ6IHRoaXMuYWNjb3VudElkLFxuICAgICAgZGlnZXN0OiBlbnRyeS5kZXNjcmlwdG9yLmRpZ2VzdFxuICAgIH0pXG5cbiAgICBpZiAoIXVyaSAmJiBlbnRyeS5zdGF0dXMgPT09IFwiY2FjaGVkXCIpIGVudHJ5LnN0YXR1cyA9IFwibWlzc2luZ1wiXG5cbiAgICByZXR1cm4gdXJpXG4gIH1cblxuICAvKipcbiAgICogRGVsZXRlcyBibG9icyB0aGF0IGxvc3QgdGhlaXIgZmluYWwgZGVzY3JpcHRvciByZWZlcmVuY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBSZXNvbHZlcyBhZnRlciBkZWxldGlvbi5cbiAgICovXG4gIGFzeW5jIGRlbGV0ZVVucmVmZXJlbmNlZERpZ2VzdHMoKSB7XG4gICAgaWYgKCF0aGlzLnN0YXRlKSB0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3QgZGVsZXRlIHN5bmNocm9uaXplZCBhc3NldCBibG9icyBiZWZvcmUgbG9hZGluZyBzdGF0ZVwiKVxuXG4gICAgZm9yIChjb25zdCBkaWdlc3Qgb2YgWy4uLnRoaXMuc3RhdGUucGVuZGluZ0RlbGV0aW9uRGlnZXN0c10pIHtcbiAgICAgIGF3YWl0IHRoaXMuZGVsZXRlUGVuZGluZ0RpZ2VzdElmVW5yZWZlcmVuY2VkKGRpZ2VzdClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRGVsZXRlcyBvbmUgcGVyc2lzdGVkIHBlbmRpbmcgZGlnZXN0IHdoZW4gbm8gZGVzY3JpcHRvciBvciBkb3dubG9hZCBvd25zIGl0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZGlnZXN0IENvbnRlbnQgZGlnZXN0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgYWZ0ZXIgYW55IHJlcXVpcmVkIGRlbGV0aW9uLlxuICAgKi9cbiAgYXN5bmMgZGVsZXRlUGVuZGluZ0RpZ2VzdElmVW5yZWZlcmVuY2VkKGRpZ2VzdCkge1xuICAgIGlmICghdGhpcy5zdGF0ZSkgdGhyb3cgbmV3IEVycm9yKFwiQ2Fubm90IGRlbGV0ZSBzeW5jaHJvbml6ZWQgYXNzZXQgYmxvYnMgYmVmb3JlIGxvYWRpbmcgc3RhdGVcIilcbiAgICBpZiAoIXRoaXMuc3RhdGUucGVuZGluZ0RlbGV0aW9uRGlnZXN0cy5pbmNsdWRlcyhkaWdlc3QpKSByZXR1cm5cbiAgICBpZiAodGhpcy5kb3dubG9hZFByb21pc2VzLmhhcyhkaWdlc3QpKSByZXR1cm5cblxuICAgIGlmICghdGhpcy5zdGF0ZS5hc3NldHMuc29tZSgoZW50cnkpID0+IGVudHJ5LmRlc2NyaXB0b3IuZGlnZXN0ID09PSBkaWdlc3QpKSB7XG4gICAgICBhd2FpdCB0aGlzLmFkYXB0ZXIuZGVsZXRlQmxvYih7YWNjb3VudElkOiB0aGlzLmFjY291bnRJZCwgZGlnZXN0fSlcbiAgICB9XG5cbiAgICBjb25zdCBwZW5kaW5nRGVsZXRpb25EaWdlc3RzID0gdGhpcy5zdGF0ZS5wZW5kaW5nRGVsZXRpb25EaWdlc3RzXG5cbiAgICB0aGlzLnN0YXRlLnBlbmRpbmdEZWxldGlvbkRpZ2VzdHMgPSBwZW5kaW5nRGVsZXRpb25EaWdlc3RzLmZpbHRlcigoY2FuZGlkYXRlKSA9PiBjYW5kaWRhdGUgIT09IGRpZ2VzdClcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLnNhdmVTdGF0ZSgpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMuc3RhdGUucGVuZGluZ0RlbGV0aW9uRGlnZXN0cyA9IHBlbmRpbmdEZWxldGlvbkRpZ2VzdHNcbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEZpbmRzIHJlcXVpcmVkIGFzc2V0cyB3aXRob3V0IGxvY2FsbHkgY2FjaGVkIGJ5dGVzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gc2NvcGVLZXkgU3luY2hyb25pemVkIHNjb3BlIHRvIGluc3BlY3QuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZ1tdPn0gTWlzc2luZyByZXF1aXJlZCBkZXNjcmlwdG9yIGlkcy5cbiAgICovXG4gIGFzeW5jIG1pc3NpbmdSZXF1aXJlZEFzc2V0SWRzKHNjb3BlS2V5KSB7XG4gICAgY29uc3Qgc3RhdGUgPSBhd2FpdCB0aGlzLmxvYWRTdGF0ZSgpXG4gICAgLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgICBjb25zdCBtaXNzaW5nQXNzZXRJZHMgPSBbXVxuXG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiBzdGF0ZS5hc3NldHMpIHtcbiAgICAgIGlmICghZW50cnkuc2NvcGVLZXlzLmluY2x1ZGVzKHNjb3BlS2V5KSkgY29udGludWVcbiAgICAgIGlmIChlbnRyeS5kZXNjcmlwdG9yLm9mZmxpbmVSZXF1aXJlbWVudCAhPT0gXCJyZXF1aXJlZFwiKSBjb250aW51ZVxuICAgICAgaWYgKGF3YWl0IHRoaXMuY2FjaGVkVXJpKGVudHJ5KSkgY29udGludWVcblxuICAgICAgbWlzc2luZ0Fzc2V0SWRzLnB1c2goZW50cnkuZGVzY3JpcHRvci5pZClcbiAgICB9XG5cbiAgICByZXR1cm4gbWlzc2luZ0Fzc2V0SWRzXG4gIH1cblxuICAvKipcbiAgICogQ2hlY2tzIHdoZXRoZXIgYSBmYWlsZWQgb3IgbWlzc2luZyBlbnRyeSBtYXkgYmUgZG93bmxvYWRlZCBub3cuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi90eXBlcy5qc1wiKS5TeW5jaHJvbml6ZWRBc3NldENhY2hlRW50cnl9IGVudHJ5IERlc2NyaXB0b3Igc3RhdGUuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSBXaGV0aGVyIHRoZSByZXRyeSBkZWFkbGluZSBoYXMgcGFzc2VkLlxuICAgKi9cbiAgcmV0cnlFbGlnaWJsZShlbnRyeSkge1xuICAgIHJldHVybiBlbnRyeS5zdGF0dXMgIT09IFwiZmFpbGVkXCIgfHwgZW50cnkubmV4dFJldHJ5QXQgPT09IG51bGwgfHwgZW50cnkubmV4dFJldHJ5QXQgPD0gdGhpcy5ub3dNaWxsaXNlY29uZHMoKVxuICB9XG5cbiAgLyoqXG4gICAqIENhbGN1bGF0ZXMgYm91bmRlZCBleHBvbmVudGlhbCByZXRyeSBkZWxheS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGF0dGVtcHRzIENvbnNlY3V0aXZlIGZhaWx1cmVzLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSBSZXRyeSBkZWxheS5cbiAgICovXG4gIHJldHJ5RGVsYXkoYXR0ZW1wdHMpIHtcbiAgICByZXR1cm4gTWF0aC5taW4odGhpcy5yZXRyeU1heERlbGF5TXMsIHRoaXMucmV0cnlCYXNlRGVsYXlNcyAqICgyICoqIE1hdGgubWF4KDAsIGF0dGVtcHRzIC0gMSkpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWRzIHRoZSBpbmplY3RhYmxlIHdhbGwgY2xvY2suXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IEN1cnJlbnQgZXBvY2ggbWlsbGlzZWNvbmRzLlxuICAgKi9cbiAgbm93TWlsbGlzZWNvbmRzKCkge1xuICAgIHJldHVybiB0aGlzLm5vdygpLmdldFRpbWUoKVxuICB9XG59XG4iXX0=