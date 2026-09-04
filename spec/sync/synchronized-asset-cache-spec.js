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
