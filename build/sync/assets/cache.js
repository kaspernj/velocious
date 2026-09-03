// @ts-check

import sha256BytesHex from "../../utils/sha256-bytes-hex.js"

const CACHE_STATE_VERSION = 1
const DEFAULT_RETRY_BASE_DELAY_MS = 1000
const DEFAULT_RETRY_MAX_DELAY_MS = 1000 * 60 * 5

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
  constructor({accountId, adapter, download, maxBytes, now = () => new Date(), retryBaseDelayMs = DEFAULT_RETRY_BASE_DELAY_MS, retryMaxDelayMs = DEFAULT_RETRY_MAX_DELAY_MS}) {
    if (!accountId) throw new Error("Synchronized asset cache requires an account id")
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new Error("Synchronized asset cache maxBytes must be a non-negative safe integer")
    if (!Number.isSafeInteger(retryBaseDelayMs) || retryBaseDelayMs < 1) throw new Error("Synchronized asset cache retryBaseDelayMs must be a positive safe integer")
    if (!Number.isSafeInteger(retryMaxDelayMs) || retryMaxDelayMs < retryBaseDelayMs) throw new Error("Synchronized asset cache retryMaxDelayMs must be at least retryBaseDelayMs")

    this.accountId = accountId
    this.adapter = adapter
    this.download = download
    this.maxBytes = maxBytes
    this.now = now
    this.retryBaseDelayMs = retryBaseDelayMs
    this.retryMaxDelayMs = retryMaxDelayMs
    /** @type {Map<string, Promise<string>>} */
    this.downloadPromises = new Map()
    /** @type {Set<string>} */
    this.pendingDeletionDigests = new Set()
    /** @type {import("./types.js").SynchronizedAssetCacheState | null} */
    this.state = null
    /** @type {Promise<import("./types.js").SynchronizedAssetCacheState> | null} */
    this.statePromise = null
    /** @type {Promise<void>} */
    this.saveStatePromise = Promise.resolve()
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
  async synchronize({descriptors, online, scopeKey}) {
    const state = await this.loadState()
    const incomingIds = new Set(descriptors.map((asset) => asset.id))
    const entriesById = new Map(state.assets.map((entry) => [entry.descriptor.id, entry]))
    const removedDigests = new Set()

    for (const entry of state.assets) {
      if (!entry.scopeKeys.includes(scopeKey) || incomingIds.has(entry.descriptor.id)) continue

      entry.scopeKeys = entry.scopeKeys.filter((candidate) => candidate !== scopeKey)
      if (entry.scopeKeys.length === 0) removedDigests.add(entry.descriptor.digest)
    }

    state.assets = state.assets.filter((entry) => entry.scopeKeys.length > 0)

    for (const asset of descriptors) {
      const existing = entriesById.get(asset.id)

      if (existing && state.assets.includes(existing)) {
        if (existing.descriptor.digest !== asset.digest) {
          throw new Error(`Synchronized asset descriptor ${asset.id} changed its immutable digest`)
        }
        existing.descriptor = asset
        if (!existing.scopeKeys.includes(scopeKey)) existing.scopeKeys.push(scopeKey)
      } else {
        const newEntry = {
          attempts: 0,
          descriptor: asset,
          lastAccessedAt: this.nowMilliseconds(),
          nextRetryAt: null,
          scopeKeys: [scopeKey],
          status: /** @type {const} */ ("missing")
        }

        state.assets.push(newEntry)
        entriesById.set(asset.id, newEntry)
      }
    }

    await this.saveState()
    await this.deleteUnreferencedDigests(removedDigests)

    /** @type {import("./types.js").SynchronizedAssetCacheFailure[]} */
    const failures = []

    if (online) {
      for (const asset of descriptors) {
        if (asset.fetch !== "eager") continue

        const entry = entriesById.get(asset.id)

        if (!entry || !this.retryEligible(entry)) continue

        const cacheResult = await this.ensureCached(entry)

        if (cacheResult.error) failures.push({assetId: asset.id, error: cacheResult.error})
      }
    }

    await this.cleanup()

    return {
      failures,
      missingRequiredAssetIds: await this.missingRequiredAssetIds(scopeKey)
    }
  }

  /**
   * Resolves a cached asset URI, downloading it on demand when allowed.
   * @param {object} args Resolution inputs.
   * @param {string} args.assetId Attachment descriptor id.
   * @param {boolean} args.online Whether authenticated downloads are available.
   * @returns {Promise<string | null>} Cached asset URI.
   */
  async resolve({assetId, online}) {
    const state = await this.loadState()
    const entry = state.assets.find((candidate) => candidate.descriptor.id === assetId)

    if (!entry) return null

    const cachedUri = await this.cachedUri(entry)

    if (cachedUri) {
      entry.lastAccessedAt = this.nowMilliseconds()
      entry.status = "cached"
      await this.saveState()

      return cachedUri
    }

    if (!online || !this.retryEligible(entry)) return null

    const cacheResult = await this.ensureCached(entry)

    if (cacheResult.error) throw cacheResult.error
    if (!cacheResult.uri) return null

    await this.cleanup(new Set([entry.descriptor.digest]))

    return cacheResult.uri
  }

  /**
   * Evicts least-recently-used blobs until the unique cached byte total is
   * within the configured budget. A blob stays durable when any live
   * descriptor reference declares durable retention.
   * @param {Set<string>} [protectedDigests] Digests needed by the active caller.
   * @returns {Promise<number>} Bytes removed.
   */
  async cleanup(protectedDigests = new Set()) {
    const state = await this.loadState()
    /** @type {Map<string, import("./types.js").SynchronizedAssetCacheEntry[]>} */
    const entriesByDigest = new Map()

    for (const entry of state.assets) {
      const digestEntries = entriesByDigest.get(entry.descriptor.digest) || []

      digestEntries.push(entry)
      entriesByDigest.set(entry.descriptor.digest, digestEntries)
    }

    /** @type {{byteSize: number, digest: string, lastAccessedAt: number, references: import("./types.js").SynchronizedAssetCacheEntry[]}[]} */
    const cachedBlobs = []
    let cachedBytes = 0

    for (const [digest, references] of entriesByDigest) {
      const uri = await this.adapter.blobUri({accountId: this.accountId, digest})

      if (!uri) {
        for (const entry of references) {
          if (entry.status === "cached") entry.status = "missing"
        }
        continue
      }

      const byteSize = references[0].descriptor.byteSize

      cachedBytes += byteSize
      cachedBlobs.push({
        byteSize,
        digest,
        lastAccessedAt: Math.max(...references.map((entry) => entry.lastAccessedAt)),
        references
      })
    }

    cachedBlobs.sort((left, right) => left.lastAccessedAt - right.lastAccessedAt || left.digest.localeCompare(right.digest))

    let removedBytes = 0

    for (const blob of cachedBlobs) {
      if (cachedBytes <= this.maxBytes) break
      if (protectedDigests.has(blob.digest)) continue
      if (blob.references.some((entry) => entry.descriptor.retention === "durable")) continue

      await this.adapter.deleteBlob({accountId: this.accountId, digest: blob.digest})
      cachedBytes -= blob.byteSize
      removedBytes += blob.byteSize

      for (const entry of blob.references) {
        entry.attempts = 0
        entry.nextRetryAt = null
        entry.status = "missing"
      }
    }

    await this.saveState()

    return removedBytes
  }

  /**
   * Loads cache state once for this cache instance.
   * @returns {Promise<import("./types.js").SynchronizedAssetCacheState>} Loaded state.
   */
  async loadState() {
    if (this.state) return this.state
    if (this.statePromise) return await this.statePromise

    this.statePromise = this.loadStateFromAdapter()

    try {
      this.state = await this.statePromise

      return this.state
    } finally {
      this.statePromise = null
    }
  }

  /**
   * Loads and recovers persisted cache state.
   * @returns {Promise<import("./types.js").SynchronizedAssetCacheState>} Loaded state.
   */
  async loadStateFromAdapter() {
    const loadedState = await this.adapter.loadState({accountId: this.accountId})

    if (!loadedState) return {assets: [], version: CACHE_STATE_VERSION}
    if (loadedState.version !== CACHE_STATE_VERSION) {
      throw new Error(`Unsupported synchronized asset cache state version: ${loadedState.version}`)
    }

    let recoveredInterruptedDownload = false

    for (const entry of loadedState.assets) {
      if (entry.status !== "downloading") continue

      entry.attempts += 1
      entry.nextRetryAt = this.nowMilliseconds()
      entry.status = "failed"
      recoveredInterruptedDownload = true
    }

    if (recoveredInterruptedDownload) {
      await this.adapter.saveState({accountId: this.accountId, state: loadedState})
    }

    return loadedState
  }

  /**
   * Persists the current cache state.
   * @returns {Promise<void>} Resolves after state persistence.
   */
  async saveState() {
    if (!this.state) throw new Error("Cannot save synchronized asset cache before loading state")

    const persist = async () => {
      if (!this.state) throw new Error("Cannot save synchronized asset cache before loading state")

      await this.adapter.saveState({accountId: this.accountId, state: this.state})
    }

    this.saveStatePromise = this.saveStatePromise.then(persist, persist)

    await this.saveStatePromise
  }

  /**
   * Ensures one descriptor has verified local bytes.
   * @param {import("./types.js").SynchronizedAssetCacheEntry} entry Descriptor state.
   * @returns {Promise<{error: Error | null, uri: string | null}>} Cache result.
   */
  async ensureCached(entry) {
    const existingUri = await this.cachedUri(entry)

    if (existingUri) {
      entry.attempts = 0
      entry.lastAccessedAt = this.nowMilliseconds()
      entry.nextRetryAt = null
      entry.status = "cached"
      await this.saveState()

      return {error: null, uri: existingUri}
    }

    entry.status = "downloading"
    await this.saveState()

    const digest = entry.descriptor.digest
    let downloadPromise = this.downloadPromises.get(digest)
    let ownsDownloadPromise = false

    if (!downloadPromise) {
      downloadPromise = this.downloadVerified(entry.descriptor)
      this.downloadPromises.set(digest, downloadPromise)
      ownsDownloadPromise = true
    }

    try {
      const uri = await downloadPromise

      entry.attempts = 0
      entry.lastAccessedAt = this.nowMilliseconds()
      entry.nextRetryAt = null
      entry.status = "cached"
      await this.saveState()

      return {error: null, uri}
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error))

      entry.attempts += 1
      entry.nextRetryAt = this.nowMilliseconds() + this.retryDelay(entry.attempts)
      entry.status = "failed"
      await this.saveState()

      return {error: failure, uri: null}
    } finally {
      if (ownsDownloadPromise && this.downloadPromises.get(digest) === downloadPromise) {
        this.downloadPromises.delete(digest)

        if (this.pendingDeletionDigests.delete(digest)) {
          await this.deleteDigestIfUnreferenced(digest)
        }
      }
    }
  }

  /**
   * Downloads, verifies, and atomically persists one content digest.
   * @param {import("./types.js").SynchronizedAssetCacheDescriptor} descriptor Asset descriptor.
   * @returns {Promise<string>} Adapter URI.
   */
  async downloadVerified(descriptor) {
    const downloadedBytes = await this.download(descriptor)

    if (!(downloadedBytes instanceof Uint8Array)) {
      throw new Error(`Synchronized asset ${descriptor.id} download did not return Uint8Array bytes`)
    }
    if (downloadedBytes.byteLength !== descriptor.byteSize) {
      throw new Error(`Synchronized asset ${descriptor.id} byte size did not match its descriptor`)
    }

    const digest = `sha256-${sha256BytesHex(downloadedBytes)}`

    if (digest !== descriptor.digest) {
      throw new Error(`Synchronized asset ${descriptor.id} digest did not match its descriptor`)
    }

    const uri = await this.adapter.writeBlob({
      accountId: this.accountId,
      bytes: downloadedBytes,
      contentType: descriptor.contentType,
      digest
    })

    if (!uri) throw new Error(`Synchronized asset adapter returned no URI for ${descriptor.id}`)

    return uri
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
    })

    if (!uri && entry.status === "cached") entry.status = "missing"

    return uri
  }

  /**
   * Deletes blobs that lost their final descriptor reference.
   * @param {Set<string>} removedDigests Candidate digests.
   * @returns {Promise<void>} Resolves after deletion.
   */
  async deleteUnreferencedDigests(removedDigests) {
    if (!this.state) throw new Error("Cannot delete synchronized asset blobs before loading state")

    for (const digest of removedDigests) {
      if (this.state.assets.some((entry) => entry.descriptor.digest === digest)) continue
      if (this.downloadPromises.has(digest)) {
        this.pendingDeletionDigests.add(digest)
        continue
      }

      await this.adapter.deleteBlob({accountId: this.accountId, digest})
    }
  }

  /**
   * Deletes a digest only when no current descriptor references it.
   * @param {string} digest Content digest.
   * @returns {Promise<void>} Resolves after any required deletion.
   */
  async deleteDigestIfUnreferenced(digest) {
    if (!this.state) throw new Error("Cannot delete synchronized asset blobs before loading state")
    if (this.state.assets.some((entry) => entry.descriptor.digest === digest)) return

    await this.adapter.deleteBlob({accountId: this.accountId, digest})
  }

  /**
   * Finds required assets without locally cached bytes.
   * @param {string} scopeKey Synchronized scope to inspect.
   * @returns {Promise<string[]>} Missing required descriptor ids.
   */
  async missingRequiredAssetIds(scopeKey) {
    const state = await this.loadState()
    /** @type {string[]} */
    const missingAssetIds = []

    for (const entry of state.assets) {
      if (!entry.scopeKeys.includes(scopeKey)) continue
      if (entry.descriptor.offlineRequirement !== "required") continue
      if (await this.cachedUri(entry)) continue

      missingAssetIds.push(entry.descriptor.id)
    }

    return missingAssetIds
  }

  /**
   * Checks whether a failed or missing entry may be downloaded now.
   * @param {import("./types.js").SynchronizedAssetCacheEntry} entry Descriptor state.
   * @returns {boolean} Whether the retry deadline has passed.
   */
  retryEligible(entry) {
    return entry.status !== "failed" || entry.nextRetryAt === null || entry.nextRetryAt <= this.nowMilliseconds()
  }

  /**
   * Calculates bounded exponential retry delay.
   * @param {number} attempts Consecutive failures.
   * @returns {number} Retry delay.
   */
  retryDelay(attempts) {
    return Math.min(this.retryMaxDelayMs, this.retryBaseDelayMs * (2 ** Math.max(0, attempts - 1)))
  }

  /**
   * Reads the injectable wall clock.
   * @returns {number} Current epoch milliseconds.
   */
  nowMilliseconds() {
    return this.now().getTime()
  }
}
