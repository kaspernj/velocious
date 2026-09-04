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
    /** @type {Map<string, number>} */
    this.activeDigestCounts = new Map()
    /** @type {Map<string, Promise<void>>} */
    this.deletionPromises = new Map()
    /** @type {Map<string, Promise<string>>} */
    this.downloadPromises = new Map()
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
    await this.loadState()
    const incomingDigests = [...new Set(descriptors.map((asset) => asset.digest))]
    /** @type {import("./types.js").SynchronizedAssetCacheFailure[]} */
    const failures = []

    for (const digest of incomingDigests) await this.beginActiveDigest(digest)

    /** @type {Map<string, import("./types.js").SynchronizedAssetCacheEntry>} */
    let entriesById

    try {
      entriesById = await this.reconcileDescriptors({descriptors, scopeKey})
      await this.deleteUnreferencedDigests()

      if (online) {
        for (const asset of descriptors) {
          if (asset.fetch !== "eager") continue

          const entry = entriesById.get(asset.id)

          if (!entry || !this.retryEligible(entry)) continue

          const cacheResult = await this.ensureCachedWhileActive(entry)

          if (cacheResult.error) failures.push({assetId: asset.id, error: cacheResult.error})
        }
      }
    } finally {
      await this.finishActiveDigests(incomingDigests)
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

    const digest = entry.descriptor.digest
    let resolvedUri = null

    await this.beginActiveDigest(digest)

    try {
      const cachedUri = await this.cachedUriWhileActive(entry)

      if (cachedUri) {
        entry.lastAccessedAt = this.nowMilliseconds()
        entry.status = "cached"
        await this.saveState()

        resolvedUri = cachedUri
      } else if (online && this.retryEligible(entry)) {
        const cacheResult = await this.ensureCachedWhileActive(entry)

        if (cacheResult.error) throw cacheResult.error

        if (cacheResult.uri) {
          await this.cleanup(new Set([digest]))

          resolvedUri = cacheResult.uri
        }
      }
    } finally {
      await this.finishActiveDigest(digest)
    }

    if (!resolvedUri) return null
    if (!state.assets.some((candidate) => candidate.descriptor.id === assetId && candidate.descriptor.digest === digest)) return null

    return resolvedUri
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

    /** @type {{byteSize: number, digest: string, lastAccessedAt: number}[]} */
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
        lastAccessedAt: Math.max(...references.map((entry) => entry.lastAccessedAt))
      })
    }

    cachedBlobs.sort((left, right) => left.lastAccessedAt - right.lastAccessedAt || left.digest.localeCompare(right.digest))

    let removedBytes = 0

    for (const blob of cachedBlobs) {
      if (cachedBytes <= this.maxBytes) break
      if (protectedDigests.has(blob.digest)) continue
      let blobWasAlreadyMissing = false
      const deleted = await this.deleteDigestIfInactive(blob.digest, async () => {
        if (!this.state) throw new Error("Cannot clean synchronized asset blobs before loading state")

        const currentUri = await this.adapter.blobUri({accountId: this.accountId, digest: blob.digest})
        const currentReferences = this.state.assets.filter((entry) => entry.descriptor.digest === blob.digest)

        if (!currentUri) {
          blobWasAlreadyMissing = true

          for (const entry of currentReferences) {
            if (entry.status === "cached") entry.status = "missing"
          }

          return false
        }
        if (currentReferences.some((entry) => entry.descriptor.retention === "durable")) return false

        await this.adapter.deleteBlob({accountId: this.accountId, digest: blob.digest})

        for (const entry of currentReferences) {
          entry.attempts = 0
          entry.nextRetryAt = null
          entry.status = "missing"
        }

        return true
      })

      if (blobWasAlreadyMissing) cachedBytes -= blob.byteSize
      if (!deleted) continue

      cachedBytes -= blob.byteSize
      removedBytes += blob.byteSize
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

    if (!loadedState) return {assets: [], pendingDeletionDigests: [], version: CACHE_STATE_VERSION}
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

    await this.serializeStatePersistence(persist)
  }

  /**
   * Persists a detached reconciliation before exposing it through shared state.
   * @param {object} args Reconciliation inputs.
   * @param {import("./types.js").SynchronizedAssetCacheDescriptor[]} args.descriptors Current descriptors in the scope.
   * @param {string} args.scopeKey Stable synchronized scope key.
   * @returns {Promise<Map<string, import("./types.js").SynchronizedAssetCacheEntry>>} Reconciled live entries by id.
   */
  async reconcileDescriptors({descriptors, scopeKey}) {
    /** @type {Map<string, import("./types.js").SynchronizedAssetCacheEntry> | null} */
    let entriesById = null

    const persist = async () => {
      if (!this.state) throw new Error("Cannot reconcile synchronized asset cache before loading state")

      const candidateState = this.copyState(this.state)
      const newEntryLastAccessedAt = this.nowMilliseconds()

      this.applyDescriptorReconciliation({descriptors, newEntryLastAccessedAt, scopeKey, state: candidateState})
      await this.adapter.saveState({accountId: this.accountId, state: candidateState})
      entriesById = this.applyDescriptorReconciliation({descriptors, newEntryLastAccessedAt, scopeKey, state: this.state})
    }

    await this.serializeStatePersistence(persist)

    if (!entriesById) throw new Error("Synchronized asset descriptor reconciliation completed without live entries")

    return entriesById
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
  applyDescriptorReconciliation({descriptors, newEntryLastAccessedAt, scopeKey, state}) {
    const incomingIds = new Set(descriptors.map((asset) => asset.id))
    const entriesById = new Map(state.assets.map((entry) => [entry.descriptor.id, entry]))
    const digestsById = new Map(state.assets.map((entry) => [entry.descriptor.id, entry.descriptor.digest]))
    const removedDigests = new Set()

    for (const asset of descriptors) {
      const knownDigest = digestsById.get(asset.id)

      if (knownDigest !== undefined && knownDigest !== asset.digest) {
        throw new Error(`Synchronized asset descriptor ${asset.id} changed its immutable digest`)
      }

      digestsById.set(asset.id, asset.digest)
    }

    for (const entry of state.assets) {
      if (!entry.scopeKeys.includes(scopeKey) || incomingIds.has(entry.descriptor.id)) continue

      entry.scopeKeys = entry.scopeKeys.filter((candidate) => candidate !== scopeKey)
      if (entry.scopeKeys.length === 0) removedDigests.add(entry.descriptor.digest)
    }

    state.assets = state.assets.filter((entry) => entry.scopeKeys.length > 0)

    for (const asset of descriptors) {
      const existing = entriesById.get(asset.id)

      if (existing && state.assets.includes(existing)) {
        existing.descriptor = asset
        if (!existing.scopeKeys.includes(scopeKey)) existing.scopeKeys.push(scopeKey)
      } else {
        const newEntry = {
          attempts: 0,
          descriptor: asset,
          lastAccessedAt: newEntryLastAccessedAt,
          nextRetryAt: null,
          scopeKeys: [scopeKey],
          status: /** @type {const} */ ("missing")
        }

        state.assets.push(newEntry)
        entriesById.set(asset.id, newEntry)
      }
    }

    for (const digest of removedDigests) {
      if (state.assets.some((entry) => entry.descriptor.digest === digest)) continue
      if (!state.pendingDeletionDigests.includes(digest)) state.pendingDeletionDigests.push(digest)
    }

    return entriesById
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
        descriptor: {...entry.descriptor},
        scopeKeys: [...entry.scopeKeys]
      })),
      pendingDeletionDigests: [...state.pendingDeletionDigests],
      version: state.version
    }
  }

  /**
   * Serializes one metadata persistence operation after prior failures or successes.
   * @param {() => Promise<void>} persist Persistence operation.
   * @returns {Promise<void>} Resolves after persistence.
   */
  async serializeStatePersistence(persist) {
    this.saveStatePromise = this.saveStatePromise.then(persist, persist)

    await this.saveStatePromise
  }

  /**
   * Ensures one descriptor has verified local bytes.
   * @param {import("./types.js").SynchronizedAssetCacheEntry} entry Descriptor state.
   * @returns {Promise<{error: Error | null, uri: string | null}>} Cache result.
   */
  async ensureCached(entry) {
    const digest = entry.descriptor.digest

    await this.beginActiveDigest(digest)

    try {
      return await this.ensureCachedWhileActive(entry)
    } finally {
      await this.finishActiveDigest(digest)
    }
  }

  /**
   * Resolves or downloads one descriptor while its digest is protected.
   * @param {import("./types.js").SynchronizedAssetCacheEntry} entry Descriptor state.
   * @returns {Promise<{error: Error | null, uri: string | null}>} Cache result.
   */
  async ensureCachedWhileActive(entry) {
    const existingUri = await this.cachedUriWhileActive(entry)

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
      downloadPromise = this.downloadAndRecordFailure(entry.descriptor)
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

      return {error: failure, uri: null}
    } finally {
      if (ownsDownloadPromise && this.downloadPromises.get(digest) === downloadPromise) {
        this.downloadPromises.delete(digest)
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
      return await this.downloadVerified(descriptor)
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error))

      await this.recordDownloadFailure(descriptor.digest)
      throw failure
    }
  }

  /**
   * Advances retry metadata for every live descriptor sharing one failed digest.
   * @param {string} digest Content digest.
   * @returns {Promise<void>} Resolves after persistence.
   */
  async recordDownloadFailure(digest) {
    if (!this.state) throw new Error("Cannot record synchronized asset download failure before loading state")

    const failedAt = this.nowMilliseconds()

    for (const entry of this.state.assets) {
      if (entry.descriptor.digest !== digest) continue
      if (entry.status !== "downloading") continue

      entry.attempts += 1
      entry.nextRetryAt = failedAt + this.retryDelay(entry.attempts)
      entry.status = "failed"
    }

    await this.saveState()
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
   * Resolves an existing local URI after waiting for deletion work.
   * @param {import("./types.js").SynchronizedAssetCacheEntry} entry Descriptor state.
   * @returns {Promise<string | null>} Existing URI.
   */
  async cachedUri(entry) {
    const digest = entry.descriptor.digest

    await this.beginActiveDigest(digest)

    try {
      return await this.cachedUriWhileActive(entry)
    } finally {
      await this.finishActiveDigest(digest)
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
    })

    if (!uri && entry.status === "cached") entry.status = "missing"

    return uri
  }

  /**
   * Waits for deletion and protects a digest for one active cache operation.
   * @param {string} digest Content digest.
   * @returns {Promise<void>} Resolves after protection is registered.
   */
  async beginActiveDigest(digest) {
    let deletionPromise = this.deletionPromises.get(digest)

    while (deletionPromise) {
      await deletionPromise
      deletionPromise = this.deletionPromises.get(digest)
    }

    const activeCount = this.activeDigestCounts.get(digest) ?? 0

    this.activeDigestCounts.set(digest, activeCount + 1)
  }

  /**
   * Releases one cache operation and processes deferred deletion after the last.
   * @param {string} digest Content digest.
   * @returns {Promise<void>} Resolves after any pending deletion.
   */
  async finishActiveDigest(digest) {
    const activeCount = this.activeDigestCounts.get(digest)

    if (activeCount === undefined) {
      throw new Error(`Missing active synchronized asset digest count for ${digest}`)
    }

    if (activeCount > 1) {
      this.activeDigestCounts.set(digest, activeCount - 1)
      return
    }

    this.activeDigestCounts.delete(digest)
    await this.deletePendingDigestIfUnreferenced(digest)
  }

  /**
   * Releases every acquired digest before propagating finalization failures.
   * @param {string[]} digests Content digests.
   * @returns {Promise<void>} Resolves after every digest is released.
   */
  async finishActiveDigests(digests) {
    /** @type {Error[]} */
    const failures = []

    for (const digest of digests) {
      try {
        await this.finishActiveDigest(digest)
      } catch (error) {
        failures.push(error instanceof Error ? error : new Error(String(error)))
      }
    }

    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) {
      throw new AggregateError(failures, "Multiple synchronized asset digest finalizers failed", {cause: failures[0]})
    }
  }

  /**
   * Deletes blobs that lost their final descriptor reference.
   * @returns {Promise<void>} Resolves after deletion.
   */
  async deleteUnreferencedDigests() {
    if (!this.state) throw new Error("Cannot delete synchronized asset blobs before loading state")

    for (const digest of [...this.state.pendingDeletionDigests]) {
      await this.deletePendingDigestIfUnreferenced(digest)
    }
  }

  /**
   * Deletes one persisted pending digest when no descriptor or active operation owns it.
   * @param {string} digest Content digest.
   * @returns {Promise<void>} Resolves after any required deletion.
   */
  async deletePendingDigestIfUnreferenced(digest) {
    if (!this.state) throw new Error("Cannot delete synchronized asset blobs before loading state")
    if (!this.state.pendingDeletionDigests.includes(digest)) return

    await this.deleteDigestIfInactive(digest, async () => {
      if (!this.state) throw new Error("Cannot delete synchronized asset blobs before loading state")
      if (!this.state.pendingDeletionDigests.includes(digest)) return false

      let deleted = false

      if (!this.state.assets.some((entry) => entry.descriptor.digest === digest)) {
        await this.adapter.deleteBlob({accountId: this.accountId, digest})
        deleted = true
      }

      const pendingDeletionDigests = this.state.pendingDeletionDigests

      this.state.pendingDeletionDigests = pendingDeletionDigests.filter((candidate) => candidate !== digest)

      try {
        await this.saveState()
      } catch (error) {
        if (!this.state.pendingDeletionDigests.includes(digest)) this.state.pendingDeletionDigests.push(digest)
        throw error
      }

      return deleted
    })
  }

  /**
   * Runs one deletion only after earlier deletion work and when no cache operation owns the digest.
   * @param {string} digest Content digest.
   * @param {() => Promise<boolean>} callback Protected deletion callback.
   * @returns {Promise<boolean>} Whether the callback deleted the blob.
   */
  async deleteDigestIfInactive(digest, callback) {
    let activeDeletionPromise = this.deletionPromises.get(digest)

    while (activeDeletionPromise) {
      await activeDeletionPromise
      activeDeletionPromise = this.deletionPromises.get(digest)
    }

    if (this.activeDigestCounts.has(digest)) return false

    /**
     * Releases callers waiting for deletion completion.
     * @type {() => void}
     */
    let releaseDeletion = () => {}
    /**
     * Blocks new digest activity until deletion completes.
     * @type {Promise<void>}
     */
    const deletionPromise = new Promise((resolve) => {
      releaseDeletion = () => resolve(undefined)
    })

    this.deletionPromises.set(digest, deletionPromise)

    try {
      return await callback()
    } finally {
      if (this.deletionPromises.get(digest) === deletionPromise) this.deletionPromises.delete(digest)
      releaseDeletion()
    }
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
