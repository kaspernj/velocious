// @ts-check

import { deferred } from "awaitery"
import { describe, expect, it } from "../../src/testing/test.js"
import SynchronizedAssetCache from "../../src/sync/assets/cache.js"
import sha256BytesHex from "../../src/utils/sha256-bytes-hex.js"

/** @typedef {import("../../src/sync/assets/types.js").SynchronizedAssetCacheDescriptor} SynchronizedAssetCacheDescriptor */
/** @typedef {import("../../src/sync/assets/types.js").SynchronizedAssetCacheState} SynchronizedAssetCacheState */

/** In-memory adapter exercising the platform storage contract. */
class MemoryAssetCacheAdapter {
  constructor() {
    /** @type {Map<string, SynchronizedAssetCacheState>} */
    this.states = new Map()
    /** @type {Map<string, Uint8Array>} */
    this.blobs = new Map()
    /** @type {string[]} */
    this.deletedBlobKeys = []
  }

  /** @param {{accountId: string}} args Account namespace. @returns {Promise<SynchronizedAssetCacheState | null>} Persisted state. */
  async loadState({accountId}) {
    return structuredClone(this.states.get(accountId) || null)
  }

  /** @param {{accountId: string, state: SynchronizedAssetCacheState}} args State write. @returns {Promise<void>} */
  async saveState({accountId, state}) {
    this.states.set(accountId, structuredClone(state))
  }

  /** @param {{accountId: string, digest: string}} args Blob identity. @returns {Promise<string | null>} Resolvable URI. */
  async blobUri({accountId, digest}) {
    const key = `${accountId}:${digest}`

    return this.blobs.has(key) ? `memory://${key}` : null
  }

  /** @param {{accountId: string, bytes: Uint8Array, contentType: string | null, digest: string}} args Blob write. @returns {Promise<string>} Resolvable URI. */
  async writeBlob({accountId, bytes, contentType, digest}) {
    void contentType
    const key = `${accountId}:${digest}`

    this.blobs.set(key, bytes.slice())

    return `memory://${key}`
  }

  /** @param {{accountId: string, digest: string}} args Blob identity. @returns {Promise<void>} */
  async deleteBlob({accountId, digest}) {
    const key = `${accountId}:${digest}`

    this.deletedBlobKeys.push(key)
    this.blobs.delete(key)
  }
}

/** Adapter that exposes overlapping metadata persistence. */
class DelayedSaveAssetCacheAdapter extends MemoryAssetCacheAdapter {
  constructor() {
    super()
    this.activeSaveCount = 0
    this.maximumActiveSaveCount = 0
  }

  /** @param {{accountId: string, state: SynchronizedAssetCacheState}} args State write. @returns {Promise<void>} */
  async saveState(args) {
    this.activeSaveCount += 1
    this.maximumActiveSaveCount = Math.max(this.maximumActiveSaveCount, this.activeSaveCount)
    await Promise.resolve()
    await super.saveState(args)
    this.activeSaveCount -= 1
  }
}

/** Adapter that can reject exactly the next metadata write. */
class FailNextSaveAssetCacheAdapter extends MemoryAssetCacheAdapter {
  constructor() {
    super()
    this.failNextSave = false
  }

  /** @param {{accountId: string, state: SynchronizedAssetCacheState}} args State write. @returns {Promise<void>} */
  async saveState(args) {
    if (this.failNextSave) {
      this.failNextSave = false
      throw new Error("planned metadata persistence failure")
    }

    await super.saveState(args)
  }
}

/** Adapter that rejects one selected metadata write. */
class FailSelectedSaveAssetCacheAdapter extends MemoryAssetCacheAdapter {
  constructor() {
    super()
    this.failOnSaveCount = null
    this.saveCount = 0
  }

  /** @param {{accountId: string, state: SynchronizedAssetCacheState}} args State write. @returns {Promise<void>} */
  async saveState(args) {
    this.saveCount += 1

    if (this.saveCount === this.failOnSaveCount) throw new Error("planned selected metadata persistence failure")

    await super.saveState(args)
  }
}

/** Adapter that pauses the next metadata write after committing it. */
class PausedSaveAssetCacheAdapter extends MemoryAssetCacheAdapter {
  constructor() {
    super()
    this.pauseNextSave = false
    this.releaseSave = deferred()
    this.saveCommitted = deferred()
  }

  /** @param {{accountId: string, state: SynchronizedAssetCacheState}} args State write. @returns {Promise<void>} */
  async saveState(args) {
    await super.saveState(args)

    if (!this.pauseNextSave) return

    this.pauseNextSave = false
    this.saveCommitted.resolve(undefined)
    await this.releaseSave.promise
  }
}

/** Adapter that can reject exactly the next blob deletion. */
class FailNextDeleteAssetCacheAdapter extends MemoryAssetCacheAdapter {
  constructor() {
    super()
    this.deletionAttempts = 0
    this.failNextDelete = false
  }

  /** @param {{accountId: string, digest: string}} args Blob identity. @returns {Promise<void>} */
  async deleteBlob(args) {
    this.deletionAttempts += 1

    if (this.failNextDelete) {
      this.failNextDelete = false
      throw new Error("planned blob deletion failure")
    }

    await super.deleteBlob(args)
  }
}

/** Adapter that pauses exactly the next blob deletion before removing bytes. */
class PausedDeleteAssetCacheAdapter extends MemoryAssetCacheAdapter {
  constructor() {
    super()
    this.blobDeletionStarted = deferred()
    this.releaseBlobDeletion = deferred()
  }

  /** @param {{accountId: string, digest: string}} args Blob identity. @returns {Promise<void>} */
  async deleteBlob(args) {
    this.blobDeletionStarted.resolve(undefined)
    await this.releaseBlobDeletion.promise
    await super.deleteBlob(args)
  }
}

/** Adapter that pauses after atomically committing blob bytes. */
class PausedWriteAssetCacheAdapter extends MemoryAssetCacheAdapter {
  constructor() {
    super()
    this.blobWriteCommitted = deferred()
    this.releaseBlobWrite = deferred()
  }

  /** @param {{accountId: string, bytes: Uint8Array, contentType: string | null, digest: string}} args Blob write. @returns {Promise<string>} Resolvable URI. */
  async writeBlob(args) {
    const uri = await super.writeBlob(args)

    this.blobWriteCommitted.resolve(undefined)
    await this.releaseBlobWrite.promise

    return uri
  }
}

/** Adapter that pauses exactly the next local blob lookup. */
class PausedBlobLookupAssetCacheAdapter extends MemoryAssetCacheAdapter {
  constructor() {
    super()
    this.blobLookupStarted = deferred()
    this.pauseNextBlobLookup = false
    this.releaseBlobLookup = deferred()
  }

  /** @param {{accountId: string, digest: string}} args Blob identity. @returns {Promise<string | null>} Resolvable URI. */
  async blobUri(args) {
    if (this.pauseNextBlobLookup) {
      this.pauseNextBlobLookup = false
      this.blobLookupStarted.resolve(undefined)
      await this.releaseBlobLookup.promise
    }

    return await super.blobUri(args)
  }
}

/**
 * Builds an immutable synchronized attachment descriptor.
 * @param {object} args Descriptor overrides.
 * @param {Uint8Array} args.bytes Expected content bytes.
 * @param {"eager" | "on-demand"} [args.fetch] Fetch policy.
 * @param {string} [args.id] Attachment id.
 * @param {"optional" | "required"} [args.offlineRequirement] Offline requirement.
 * @param {"durable" | "evictable"} [args.retention] Retention policy.
 * @returns {SynchronizedAssetCacheDescriptor} Descriptor.
 */
function descriptor({bytes, fetch = "eager", id = "attachment-1", offlineRequirement = "optional", retention = "evictable"}) {
  return {
    byteSize: bytes.byteLength,
    contentType: "image/png",
    digest: `sha256-${sha256BytesHex(bytes)}`,
    filename: `${id}.png`,
    id,
    name: "profilePicture",
    offlineRequirement,
    recordId: "user-1",
    recordType: "User",
    fetch,
    retention
  }
}

/** @param {number[]} values Byte values. @returns {Uint8Array} Bytes. */
function bytes(values) {
  return Uint8Array.from(values)
}

describe("SynchronizedAssetCache", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("eagerly downloads verified bytes once and returns the cached URI", async () => {
    const content = bytes([1, 2, 3])
    const asset = descriptor({bytes: content})
    const adapter = new MemoryAssetCacheAdapter()
    let downloadCount = 0
    const cache = new SynchronizedAssetCache({
      accountId: "account-1",
      adapter,
      download: async () => {
        downloadCount += 1
        return content
      },
      maxBytes: 1024
    })

    const result = await cache.synchronize({descriptors: [asset], online: true, scopeKey: "users"})
    const uri = await cache.resolve({assetId: asset.id, online: true})

    expect(result.failures).toEqual([])
    expect(result.missingRequiredAssetIds).toEqual([])
    expect(uri).toEqual(`memory://account-1:${asset.digest}`)
    expect(downloadCount).toEqual(1)

    await cache.synchronize({descriptors: [asset], online: true, scopeKey: "users"})

    expect(downloadCount).toEqual(1)
  })

  it("defers on-demand downloads and returns null while the asset is offline and absent", async () => {
    const content = bytes([4, 5, 6])
    const asset = descriptor({bytes: content, fetch: "on-demand"})
    const adapter = new MemoryAssetCacheAdapter()
    let downloadCount = 0
    const cache = new SynchronizedAssetCache({
      accountId: "account-1",
      adapter,
      download: async () => {
        downloadCount += 1
        return content
      },
      maxBytes: 1024
    })

    await cache.synchronize({descriptors: [asset], online: true, scopeKey: "users"})

    expect(downloadCount).toEqual(0)
    expect(await cache.resolve({assetId: asset.id, online: false})).toEqual(null)
    expect(await cache.resolve({assetId: asset.id, online: true})).toEqual(`memory://account-1:${asset.digest}`)
    expect(downloadCount).toEqual(1)
  })

  it("persists corrupt-download retry metadata and retries only after its deadline", async () => {
    const content = bytes([7, 8, 9])
    const corruptContent = bytes([9, 8, 7])
    const asset = descriptor({bytes: content})
    const adapter = new MemoryAssetCacheAdapter()
    let currentTime = 1000
    let downloadCount = 0
    const download = async () => {
      downloadCount += 1
      return downloadCount === 1 ? corruptContent : content
    }
    const buildCache = () => new SynchronizedAssetCache({
      accountId: "account-1",
      adapter,
      download,
      maxBytes: 1024,
      now: () => new Date(currentTime),
      retryBaseDelayMs: 500
    })

    const firstResult = await buildCache().synchronize({descriptors: [asset], online: true, scopeKey: "users"})

    expect(firstResult.failures.map((failure) => failure.assetId)).toEqual([asset.id])
    expect(adapter.blobs.size).toEqual(0)

    await buildCache().synchronize({descriptors: [asset], online: true, scopeKey: "users"})

    expect(downloadCount).toEqual(1)

    currentTime += 500

    const retryResult = await buildCache().synchronize({descriptors: [asset], online: true, scopeKey: "users"})

    expect(retryResult.failures).toEqual([])
    expect(downloadCount).toEqual(2)
    expect(await buildCache().resolve({assetId: asset.id, online: false})).toEqual(`memory://account-1:${asset.digest}`)
  })

  it("recovers a persisted interrupted download on the next eligible synchronization", async () => {
    const content = bytes([10, 11, 12])
    const asset = descriptor({bytes: content})
    const adapter = new MemoryAssetCacheAdapter()

    adapter.states.set("account-1", {
      assets: [{
        attempts: 0,
        descriptor: asset,
        lastAccessedAt: 1000,
        nextRetryAt: null,
        scopeKeys: ["users"],
        status: "downloading"
      }],
      pendingDeletionDigests: [],
      version: 1
    })

    const cache = new SynchronizedAssetCache({
      accountId: "account-1",
      adapter,
      download: async () => content,
      maxBytes: 1024,
      now: () => new Date(2000)
    })

    const result = await cache.synchronize({descriptors: [asset], online: true, scopeKey: "users"})

    expect(result.failures).toEqual([])
    expect(await cache.resolve({assetId: asset.id, online: false})).toEqual(`memory://account-1:${asset.digest}`)
  })

  it("deduplicates identical content while keeping descriptor references independent", async () => {
    const content = bytes([13, 14, 15])
    const firstAsset = descriptor({bytes: content, id: "attachment-1"})
    const secondAsset = {...descriptor({bytes: content, id: "attachment-2"}), recordId: "user-2"}
    const adapter = new MemoryAssetCacheAdapter()
    let downloadCount = 0
    const cache = new SynchronizedAssetCache({
      accountId: "account-1",
      adapter,
      download: async () => {
        downloadCount += 1
        return content
      },
      maxBytes: 1024
    })

    await cache.synchronize({descriptors: [firstAsset, secondAsset], online: true, scopeKey: "users"})

    expect(downloadCount).toEqual(1)
    expect(adapter.blobs.size).toEqual(1)
    expect(await cache.resolve({assetId: firstAsset.id, online: false})).toEqual(`memory://account-1:${firstAsset.digest}`)
    expect(await cache.resolve({assetId: secondAsset.id, online: false})).toEqual(`memory://account-1:${secondAsset.digest}`)
  })

  it("single-flights concurrent requests for the same content digest", async () => {
    const content = bytes([28, 29, 30])
    const firstAsset = descriptor({bytes: content, fetch: "on-demand", id: "attachment-1"})
    const secondAsset = {...descriptor({bytes: content, fetch: "on-demand", id: "attachment-2"}), recordId: "user-2"}
    const adapter = new DelayedSaveAssetCacheAdapter()
    let downloadCount = 0
    const cache = new SynchronizedAssetCache({
      accountId: "account-1",
      adapter,
      download: async () => {
        downloadCount += 1
        await Promise.resolve()
        return content
      },
      maxBytes: 1024
    })

    await cache.synchronize({descriptors: [firstAsset, secondAsset], online: true, scopeKey: "users"})
    adapter.maximumActiveSaveCount = 0

    const uris = await Promise.all([
      cache.resolve({assetId: firstAsset.id, online: true}),
      cache.resolve({assetId: secondAsset.id, online: true})
    ])

    expect(uris).toEqual([
      `memory://account-1:${firstAsset.digest}`,
      `memory://account-1:${secondAsset.digest}`
    ])
    expect(downloadCount).toEqual(1)
    expect(adapter.maximumActiveSaveCount).toEqual(1)
  })

  it("counts one failed single-flight download as one retry attempt", async () => {
    const content = bytes([64, 65, 66])
    const asset = descriptor({bytes: content, fetch: "on-demand"})
    const adapter = new MemoryAssetCacheAdapter()
    const downloadStarted = deferred()
    const releaseDownload = deferred()
    let downloadCount = 0
    const cache = new SynchronizedAssetCache({
      accountId: "account-1",
      adapter,
      download: async () => {
        downloadCount += 1
        downloadStarted.resolve(undefined)
        await releaseDownload.promise
        throw new Error("planned download failure")
      },
      maxBytes: 1024,
      now: () => new Date(1000),
      retryBaseDelayMs: 500
    })

    await cache.synchronize({descriptors: [asset], online: true, scopeKey: "users"})

    const firstResolve = cache.resolve({assetId: asset.id, online: true})
    const secondResolve = cache.resolve({assetId: asset.id, online: true})

    await downloadStarted.promise
    releaseDownload.resolve(undefined)

    const results = await Promise.allSettled([firstResolve, secondResolve])
    const persistedState = adapter.states.get("account-1")

    if (!persistedState) throw new Error("Expected persisted asset cache state")

    expect(results.map((result) => result.status)).toEqual(["rejected", "rejected"])
    expect(downloadCount).toEqual(1)
    expect(persistedState.assets[0].attempts).toEqual(1)
    expect(persistedState.assets[0].nextRetryAt).toEqual(1500)
  })

  it("reports missing required assets only for the synchronized scope", async () => {
    const firstContent = bytes([31, 32, 33])
    const secondContent = bytes([34, 35, 36])
    const requiredAsset = descriptor({bytes: firstContent, id: "required", offlineRequirement: "required"})
    const optionalAsset = descriptor({bytes: secondContent, id: "optional"})
    const adapter = new MemoryAssetCacheAdapter()
    const cache = new SynchronizedAssetCache({
      accountId: "account-1",
      adapter,
      download: async () => secondContent,
      maxBytes: 1024
    })

    const firstResult = await cache.synchronize({descriptors: [requiredAsset], online: false, scopeKey: "first-scope"})
    const secondResult = await cache.synchronize({descriptors: [optionalAsset], online: false, scopeKey: "second-scope"})

    expect(firstResult.missingRequiredAssetIds).toEqual([requiredAsset.id])
    expect(secondResult.missingRequiredAssetIds).toEqual([])
  })

  it("does not mutate cache state when immutable descriptor validation fails", async () => {
    const retainedContent = bytes([46, 47, 48])
    const removedContent = bytes([49, 50, 51])
    const replacementContent = bytes([52, 53, 54])
    const addedContent = bytes([55, 56, 57])
    const retainedAsset = descriptor({bytes: retainedContent, id: "retained"})
    const removedAsset = descriptor({bytes: removedContent, id: "removed"})
    const changedAsset = descriptor({bytes: replacementContent, id: retainedAsset.id})
    const addedAsset = descriptor({bytes: addedContent, id: "added"})
    const contents = new Map([
      [retainedAsset.id, retainedContent],
      [removedAsset.id, removedContent]
    ])
    const adapter = new MemoryAssetCacheAdapter()
    const cache = new SynchronizedAssetCache({
      accountId: "account-1",
      adapter,
      download: async (asset) => /** @type {Uint8Array} */ (contents.get(asset.id)),
      maxBytes: 1024
    })

    await cache.synchronize({descriptors: [retainedAsset, removedAsset], online: true, scopeKey: "users"})

    await expect(async () => {
      await cache.synchronize({descriptors: [addedAsset, changedAsset], online: false, scopeKey: "users"})
    }).toThrowError(`Synchronized asset descriptor ${retainedAsset.id} changed its immutable digest`)

    await cache.resolve({assetId: retainedAsset.id, online: false})

    const persistedState = adapter.states.get("account-1")

    if (!persistedState) throw new Error("Expected persisted asset cache state")

    expect(persistedState.assets.map((entry) => entry.descriptor.id).sort()).toEqual([removedAsset.id, retainedAsset.id])
  })

  it("continues serializing metadata writes after one persistence failure", async () => {
    const content = bytes([37, 38, 39])
    const asset = descriptor({bytes: content, fetch: "on-demand"})
    const adapter = new FailNextSaveAssetCacheAdapter()
    const cache = new SynchronizedAssetCache({
      accountId: "account-1",
      adapter,
      download: async () => content,
      maxBytes: 1024
    })

    await cache.synchronize({descriptors: [asset], online: true, scopeKey: "users"})
    adapter.failNextSave = true

    await expect(async () => await cache.resolve({assetId: asset.id, online: true})).toThrowError("planned metadata persistence failure")

    expect(await cache.resolve({assetId: asset.id, online: true})).toEqual(`memory://account-1:${asset.digest}`)
  })

  it("deletes a completed in-flight download after its final scope reference is removed", async () => {
    const content = bytes([40, 41, 42])
    const asset = descriptor({bytes: content, fetch: "on-demand"})
    const adapter = new MemoryAssetCacheAdapter()
    const downloadStarted = deferred()
    const releaseDownload = deferred()
    const cache = new SynchronizedAssetCache({
      accountId: "account-1",
      adapter,
      download: async () => {
        downloadStarted.resolve(undefined)
        await releaseDownload.promise
        return content
      },
      maxBytes: 1024
    })

    await cache.synchronize({descriptors: [asset], online: true, scopeKey: "users"})

    const resolvePromise = cache.resolve({assetId: asset.id, online: true})

    await downloadStarted.promise

    const removalPromise = cache.synchronize({descriptors: [], online: true, scopeKey: "users"})

    await removalPromise
    releaseDownload.resolve(undefined)
    await resolvePromise

    expect(adapter.blobs.size).toEqual(0)
    expect(adapter.deletedBlobKeys).toEqual([`account-1:${asset.digest}`])
  })

  it("deletes a download whose final scope reference is removed during cache lookup", async () => {
    const content = bytes([61, 62, 63])
    const asset = descriptor({bytes: content, fetch: "on-demand"})
    const adapter = new PausedBlobLookupAssetCacheAdapter()
    const cache = new SynchronizedAssetCache({
      accountId: "account-1",
      adapter,
      download: async () => content,
      maxBytes: 1024
    })

    await cache.synchronize({descriptors: [asset], online: true, scopeKey: "users"})

    adapter.pauseNextBlobLookup = true

    const resolvePromise = cache.resolve({assetId: asset.id, online: true})

    await adapter.blobLookupStarted.promise
    await cache.synchronize({descriptors: [], online: true, scopeKey: "users"})

    adapter.releaseBlobLookup.resolve(undefined)
    await resolvePromise

    expect(adapter.blobs.size).toEqual(0)
    expect(adapter.deletedBlobKeys).toEqual([`account-1:${asset.digest}`])
  })

  it("deletes an eager download whose scope is removed during descriptor persistence", async () => {
    const content = bytes([73, 74, 75])
    const asset = descriptor({bytes: content})
    const adapter = new PausedSaveAssetCacheAdapter()
    const cache = new SynchronizedAssetCache({
      accountId: "account-1",
      adapter,
      download: async () => content,
      maxBytes: 1024
    })

    adapter.pauseNextSave = true

    const eagerSynchronization = cache.synchronize({descriptors: [asset], online: true, scopeKey: "users"})

    await adapter.saveCommitted.promise

    const removalSynchronization = cache.synchronize({descriptors: [], online: true, scopeKey: "users"})

    adapter.releaseSave.resolve(undefined)

    await eagerSynchronization
    await removalSynchronization

    expect(adapter.blobs.size).toEqual(0)
  })

  it("releases every incoming digest after one finalizer fails", async () => {
    const firstContent = bytes([76, 77, 78])
    const secondContent = bytes([79, 80, 81])
    const firstAsset = descriptor({bytes: firstContent, fetch: "on-demand", id: "first"})
    const secondAsset = descriptor({bytes: secondContent, fetch: "on-demand", id: "second"})
    const adapter = new FailSelectedSaveAssetCacheAdapter()

    adapter.blobs.set(`account-1:${firstAsset.digest}`, firstContent)
    adapter.blobs.set(`account-1:${secondAsset.digest}`, secondContent)
    adapter.states.set("account-1", {
      assets: [firstAsset, secondAsset].map((asset) => ({
        attempts: 0,
        descriptor: asset,
        lastAccessedAt: 1000,
        nextRetryAt: null,
        scopeKeys: ["users"],
        status: /** @type {const} */ ("cached")
      })),
      pendingDeletionDigests: [firstAsset.digest, secondAsset.digest],
      version: 1
    })

    const cache = new SynchronizedAssetCache({
      accountId: "account-1",
      adapter,
      download: async () => firstContent,
      maxBytes: 1024
    })

    adapter.failOnSaveCount = 2

    await expect(async () => {
      await cache.synchronize({descriptors: [firstAsset, secondAsset], online: false, scopeKey: "users"})
    }).toThrowError("planned selected metadata persistence failure")

    adapter.failOnSaveCount = null

    await cache.synchronize({descriptors: [], online: false, scopeKey: "users"})

    expect(adapter.blobs.size).toEqual(0)
  })

  it("waits for an in-flight eviction before resolving the same digest", async () => {
    const content = bytes([67, 68, 69])
    const asset = descriptor({bytes: content})
    const adapter = new PausedDeleteAssetCacheAdapter()
    const cache = new SynchronizedAssetCache({
      accountId: "account-1",
      adapter,
      download: async () => content,
      maxBytes: 1024
    })

    await cache.synchronize({descriptors: [asset], online: true, scopeKey: "users"})
    cache.maxBytes = 0

    const cleanupPromise = cache.cleanup()

    await adapter.blobDeletionStarted.promise

    const resolvePromise = cache.resolve({assetId: asset.id, online: false})

    adapter.releaseBlobDeletion.resolve(undefined)

    expect(await cleanupPromise).toEqual(content.byteLength)
    expect(await resolvePromise).toEqual(null)
  })

  it("does not evict a blob while its download is still completing", async () => {
    const content = bytes([58, 59, 60])
    const asset = descriptor({bytes: content, fetch: "on-demand"})
    const adapter = new PausedWriteAssetCacheAdapter()
    const cache = new SynchronizedAssetCache({
      accountId: "account-1",
      adapter,
      download: async () => content,
      maxBytes: 0
    })

    await cache.synchronize({descriptors: [asset], online: true, scopeKey: "users"})

    const resolvePromise = cache.resolve({assetId: asset.id, online: true})

    await adapter.blobWriteCommitted.promise

    expect(await cache.cleanup()).toEqual(0)
    expect(adapter.blobs.size).toEqual(1)

    adapter.releaseBlobWrite.resolve(undefined)

    expect(await resolvePromise).toEqual(`memory://account-1:${asset.digest}`)
  })

  it("persists failed blob deletions and retries them on the next synchronization", async () => {
    const content = bytes([43, 44, 45])
    const asset = descriptor({bytes: content})
    const adapter = new FailNextDeleteAssetCacheAdapter()
    const buildCache = () => new SynchronizedAssetCache({
      accountId: "account-1",
      adapter,
      download: async () => content,
      maxBytes: 1024
    })
    const cache = buildCache()

    await cache.synchronize({descriptors: [asset], online: true, scopeKey: "users"})
    adapter.failNextDelete = true

    await expect(async () => {
      await cache.synchronize({descriptors: [], online: true, scopeKey: "users"})
    }).toThrowError("planned blob deletion failure")

    const failedState = adapter.states.get("account-1")

    if (!failedState) throw new Error("Expected persisted asset cache state")

    expect(failedState.assets).toEqual([])
    expect(failedState.pendingDeletionDigests).toEqual([asset.digest])
    expect(adapter.blobs.size).toEqual(1)

    await buildCache().synchronize({descriptors: [], online: true, scopeKey: "users"})

    const recoveredState = adapter.states.get("account-1")

    if (!recoveredState) throw new Error("Expected recovered asset cache state")

    expect(recoveredState.pendingDeletionDigests).toEqual([])
    expect(adapter.blobs.size).toEqual(0)
    expect(adapter.deletionAttempts).toEqual(2)
  })

  it("evicts least-recently-used optional blobs but retains durable content", async () => {
    const oldContent = bytes([16, 17, 18])
    const newContent = bytes([19, 20, 21])
    const durableContent = bytes([22, 23, 24])
    const oldAsset = descriptor({bytes: oldContent, id: "old"})
    const newAsset = descriptor({bytes: newContent, id: "new"})
    const durableAsset = descriptor({
      bytes: durableContent,
      id: "durable",
      offlineRequirement: "required",
      retention: "durable"
    })
    const contents = new Map([
      [oldAsset.id, oldContent],
      [newAsset.id, newContent],
      [durableAsset.id, durableContent]
    ])
    const adapter = new MemoryAssetCacheAdapter()
    let currentTime = 1000
    const cache = new SynchronizedAssetCache({
      accountId: "account-1",
      adapter,
      download: async (asset) => /** @type {Uint8Array} */ (contents.get(asset.id)),
      maxBytes: 6,
      now: () => new Date(currentTime)
    })

    await cache.synchronize({descriptors: [oldAsset], online: true, scopeKey: "old-scope"})
    currentTime += 1
    await cache.synchronize({descriptors: [newAsset, durableAsset], online: true, scopeKey: "current-scope"})

    expect(await cache.resolve({assetId: oldAsset.id, online: false})).toEqual(null)
    expect(await cache.resolve({assetId: newAsset.id, online: false})).toEqual(`memory://account-1:${newAsset.digest}`)
    expect(await cache.resolve({assetId: durableAsset.id, online: false})).toEqual(`memory://account-1:${durableAsset.digest}`)
    expect(adapter.deletedBlobKeys).toEqual([`account-1:${oldAsset.digest}`])
  })

  it("rechecks live durable references before evicting a digest", async () => {
    const content = bytes([70, 71, 72])
    const evictableAsset = descriptor({bytes: content, id: "evictable"})
    const durableAsset = {
      ...descriptor({bytes: content, id: "durable", retention: "durable"}),
      recordId: "user-2"
    }
    const adapter = new PausedBlobLookupAssetCacheAdapter()
    const cache = new SynchronizedAssetCache({
      accountId: "account-1",
      adapter,
      download: async () => content,
      maxBytes: 1024
    })

    await cache.synchronize({descriptors: [evictableAsset], online: true, scopeKey: "first-scope"})
    cache.maxBytes = 0
    adapter.pauseNextBlobLookup = true

    const cleanupPromise = cache.cleanup()

    await adapter.blobLookupStarted.promise
    await cache.synchronize({descriptors: [durableAsset], online: false, scopeKey: "second-scope"})
    adapter.releaseBlobLookup.resolve(undefined)

    expect(await cleanupPromise).toEqual(0)
    expect(adapter.blobs.size).toEqual(1)
    expect(await cache.resolve({assetId: durableAsset.id, online: false})).toEqual(`memory://account-1:${durableAsset.digest}`)
  })

  it("keeps state and bytes isolated by account namespace", async () => {
    const content = bytes([25, 26, 27])
    const asset = descriptor({bytes: content})
    const adapter = new MemoryAssetCacheAdapter()
    const firstAccountCache = new SynchronizedAssetCache({
      accountId: "account-1",
      adapter,
      download: async () => content,
      maxBytes: 1024
    })
    const secondAccountCache = new SynchronizedAssetCache({
      accountId: "account-2",
      adapter,
      download: async () => content,
      maxBytes: 1024
    })

    await firstAccountCache.synchronize({descriptors: [asset], online: true, scopeKey: "users"})

    expect(await firstAccountCache.resolve({assetId: asset.id, online: false})).toEqual(`memory://account-1:${asset.digest}`)
    expect(await secondAccountCache.resolve({assetId: asset.id, online: false})).toEqual(null)

    await secondAccountCache.synchronize({descriptors: [asset], online: true, scopeKey: "users"})

    expect(adapter.blobs.size).toEqual(2)
    expect(await secondAccountCache.resolve({assetId: asset.id, online: false})).toEqual(`memory://account-2:${asset.digest}`)
  })
})
