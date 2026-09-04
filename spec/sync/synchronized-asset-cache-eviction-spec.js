// @ts-check

import { deferred } from "awaitery"
import { describe, expect, it } from "../../src/testing/test.js"
import SynchronizedAssetCache from "../../src/sync/assets/cache.js"
import { bytes, descriptor, MemoryAssetCacheAdapter, PausedBlobLookupAssetCacheAdapter, PausedDeleteAssetCacheAdapter, PausedWriteAssetCacheAdapter } from "../helpers/synchronized-asset-cache.js"

describe("SynchronizedAssetCache eviction", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("reselects the least-recently-used blob after concurrent access", async () => {
    class PausedSecondBlobLookupAssetCacheAdapter extends MemoryAssetCacheAdapter {
      constructor() {
        super()
        this.blobLookupCount = 0
        this.blobLookupStarted = deferred()
        this.pauseOnSecondBlobLookup = false
        this.releaseBlobLookup = deferred()
      }

      /** @param {{accountId: string, digest: string}} args Blob identity. @returns {Promise<string | null>} Resolvable URI. */
      async blobUri(args) {
        this.blobLookupCount += 1

        if (this.pauseOnSecondBlobLookup && this.blobLookupCount === 2) {
          this.blobLookupStarted.resolve(undefined)
          await this.releaseBlobLookup.promise
        }

        return await super.blobUri(args)
      }
    }

    const oldContent = bytes([102, 103, 104])
    const newerContent = bytes([105, 106, 107])
    const oldAsset = descriptor({bytes: oldContent, id: "old"})
    const newerAsset = descriptor({bytes: newerContent, id: "newer"})
    const adapter = new PausedSecondBlobLookupAssetCacheAdapter()
    const contents = new Map([[oldAsset.id, oldContent], [newerAsset.id, newerContent]])
    let currentTime = 1000
    const cache = new SynchronizedAssetCache({
      accountId: "account-1",
      adapter,
      download: async (asset) => /** @type {Uint8Array} */ (contents.get(asset.id)),
      maxBytes: 1024,
      now: () => new Date(currentTime)
    })

    await cache.synchronize({descriptors: [oldAsset], online: true, scopeKey: "old-scope"})
    currentTime = 2000
    await cache.synchronize({descriptors: [newerAsset], online: true, scopeKey: "newer-scope"})

    adapter.blobLookupCount = 0
    adapter.pauseOnSecondBlobLookup = true
    cache.maxBytes = oldContent.byteLength

    const cleanupPromise = cache.cleanup()

    await adapter.blobLookupStarted.promise
    currentTime = 3000

    expect(await cache.resolve({assetId: oldAsset.id, online: false})).toEqual(`memory://account-1:${oldAsset.digest}`)
    adapter.releaseBlobLookup.resolve(undefined)

    expect(await cleanupPromise).toEqual(newerContent.byteLength)
    expect(adapter.deletedBlobKeys).toEqual([`account-1:${newerAsset.digest}`])
    expect(adapter.blobs.has(`account-1:${oldAsset.digest}`)).toEqual(true)
  })

  it("enforces the byte budget incrementally during eager synchronization", async () => {
    class PeakBytesAssetCacheAdapter extends MemoryAssetCacheAdapter {
      constructor() {
        super()
        this.maximumStoredBytes = 0
      }

      /** @param {{accountId: string, bytes: Uint8Array, contentType: string | null, digest: string}} args Blob write. @returns {Promise<string>} Resolvable URI. */
      async writeBlob(args) {
        const uri = await super.writeBlob(args)
        const storedBytes = [...this.blobs.values()].reduce((total, blob) => total + blob.byteLength, 0)

        this.maximumStoredBytes = Math.max(this.maximumStoredBytes, storedBytes)

        return uri
      }
    }

    const contents = [bytes([90, 91, 92]), bytes([93, 94, 95]), bytes([96, 97, 98]), bytes([99, 100, 101])]
    const assets = contents.map((content, index) => descriptor({bytes: content, id: `asset-${index}`}))
    const contentsById = new Map(assets.map((asset, index) => [asset.id, contents[index]]))
    const adapter = new PeakBytesAssetCacheAdapter()
    const cache = new SynchronizedAssetCache({
      accountId: "account-1",
      adapter,
      download: async (asset) => /** @type {Uint8Array} */ (contentsById.get(asset.id)),
      maxBytes: 3
    })

    await cache.synchronize({descriptors: assets, online: true, scopeKey: "users"})

    const storedBytes = [...adapter.blobs.values()].reduce((total, blob) => total + blob.byteLength, 0)

    expect(adapter.maximumStoredBytes).toBeLessThanOrEqual(6)
    expect(storedBytes).toBeLessThanOrEqual(3)
  })

  it("re-enforces the byte budget after concurrent on-demand downloads release their guards", async () => {
    class PausedConcurrentWriteAssetCacheAdapter extends MemoryAssetCacheAdapter {
      constructor() {
        super()
        this.blobWritesCommitted = deferred()
        this.committedWriteCount = 0
        this.releaseBlobWrites = deferred()
      }

      /** @param {{accountId: string, bytes: Uint8Array, contentType: string | null, digest: string}} args Blob write. @returns {Promise<string>} Resolvable URI. */
      async writeBlob(args) {
        const uri = await super.writeBlob(args)

        this.committedWriteCount += 1
        if (this.committedWriteCount === 2) this.blobWritesCommitted.resolve(undefined)
        await this.releaseBlobWrites.promise

        return uri
      }
    }

    const firstContent = bytes([109, 110, 111])
    const secondContent = bytes([112, 113, 114])
    const firstAsset = descriptor({bytes: firstContent, fetch: "on-demand", id: "first"})
    const secondAsset = descriptor({bytes: secondContent, fetch: "on-demand", id: "second"})
    const contents = new Map([[firstAsset.id, firstContent], [secondAsset.id, secondContent]])
    const adapter = new PausedConcurrentWriteAssetCacheAdapter()
    const cache = new SynchronizedAssetCache({
      accountId: "account-1",
      adapter,
      download: async (asset) => /** @type {Uint8Array} */ (contents.get(asset.id)),
      maxBytes: 3
    })

    await cache.synchronize({descriptors: [firstAsset, secondAsset], online: true, scopeKey: "users"})

    const resolutions = Promise.all([
      cache.resolve({assetId: firstAsset.id, online: true}),
      cache.resolve({assetId: secondAsset.id, online: true})
    ])

    await adapter.blobWritesCommitted.promise
    adapter.releaseBlobWrites.resolve(undefined)
    const resolvedUris = await resolutions

    const storedBytes = [...adapter.blobs.values()].reduce((total, blob) => total + blob.byteLength, 0)
    const retainedUris = [...adapter.blobs.keys()].map((key) => `memory://${key}`)

    expect(adapter.blobs.size).toEqual(1)
    expect(storedBytes).toEqual(3)
    expect(resolvedUris.filter((uri) => uri !== null)).toEqual(retainedUris)
  })

  it("re-enforces the byte budget after a cached resolution releases its guard", async () => {
    const cachedContent = bytes([115, 116, 117])
    const durableContent = bytes([118, 119, 120])
    const cachedAsset = descriptor({bytes: cachedContent, id: "cached"})
    const durableAsset = descriptor({bytes: durableContent, id: "durable", retention: "durable"})
    const contents = new Map([[cachedAsset.id, cachedContent], [durableAsset.id, durableContent]])
    const adapter = new PausedBlobLookupAssetCacheAdapter()
    const cache = new SynchronizedAssetCache({
      accountId: "account-1",
      adapter,
      download: async (asset) => /** @type {Uint8Array} */ (contents.get(asset.id)),
      maxBytes: 3
    })

    await cache.synchronize({descriptors: [cachedAsset], online: true, scopeKey: "cached-scope"})
    adapter.pauseNextBlobLookup = true

    const resolvePromise = cache.resolve({assetId: cachedAsset.id, online: false})

    await adapter.blobLookupStarted.promise
    await cache.synchronize({descriptors: [durableAsset], online: true, scopeKey: "durable-scope"})

    expect(adapter.blobs.size).toEqual(2)
    adapter.releaseBlobLookup.resolve(undefined)

    expect(await resolvePromise).toEqual(null)
    expect(adapter.blobs.size).toEqual(1)
    expect(adapter.blobs.has(`account-1:${durableAsset.digest}`)).toEqual(true)
  })

  it("serializes overlapping cleanup passes before selecting another victim", async () => {
    class DelayedBlobLookupAssetCacheAdapter extends MemoryAssetCacheAdapter {
      /** @param {{accountId: string, digest: string}} args Blob identity. @returns {Promise<string | null>} Resolvable URI. */
      async blobUri(args) {
        const uri = await super.blobUri(args)

        await Promise.resolve()

        return uri
      }
    }

    const firstContent = bytes([124, 125, 126])
    const secondContent = bytes([127, 128, 129])
    const firstAsset = descriptor({bytes: firstContent, id: "first"})
    const secondAsset = descriptor({bytes: secondContent, id: "second"})
    const contents = new Map([[firstAsset.id, firstContent], [secondAsset.id, secondContent]])
    const adapter = new DelayedBlobLookupAssetCacheAdapter()
    let currentTime = 1000
    const cache = new SynchronizedAssetCache({
      accountId: "account-1",
      adapter,
      download: async (asset) => /** @type {Uint8Array} */ (contents.get(asset.id)),
      maxBytes: 1024,
      now: () => new Date(currentTime)
    })

    await cache.synchronize({descriptors: [firstAsset], online: true, scopeKey: "first-scope"})
    currentTime += 1
    await cache.synchronize({descriptors: [secondAsset], online: true, scopeKey: "second-scope"})
    cache.maxBytes = firstContent.byteLength

    const removedBytes = await Promise.all([
      cache.cleanup(new Set([firstAsset.digest])),
      cache.cleanup()
    ])

    expect(removedBytes).toEqual([secondContent.byteLength, 0])
    expect(adapter.deletedBlobKeys).toEqual([`account-1:${secondAsset.digest}`])
    expect(adapter.blobs.has(`account-1:${firstAsset.digest}`)).toEqual(true)
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
    class DurableReferenceObservedAssetCache extends SynchronizedAssetCache {
      durableDescriptorReconciled = deferred()

      /**
       * @param {{descriptors: import("../../src/sync/assets/types.js").SynchronizedAssetCacheDescriptor[], scopeKey: string}} args Reconciliation inputs.
       * @returns {Promise<Map<string, import("../../src/sync/assets/types.js").SynchronizedAssetCacheEntry>>} Reconciled entries.
       */
      async reconcileDescriptors(args) {
        const entries = await super.reconcileDescriptors(args)

        if (args.descriptors.some((descriptor) => descriptor.retention === "durable")) {
          this.durableDescriptorReconciled.resolve(undefined)
        }

        return entries
      }
    }

    const content = bytes([70, 71, 72])
    const evictableAsset = descriptor({bytes: content, id: "evictable"})
    const durableAsset = {
      ...descriptor({bytes: content, id: "durable", retention: "durable"}),
      recordId: "user-2"
    }
    const adapter = new PausedBlobLookupAssetCacheAdapter()
    const cache = new DurableReferenceObservedAssetCache({
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
    const synchronizationPromise = cache.synchronize({descriptors: [durableAsset], online: false, scopeKey: "second-scope"})

    await cache.durableDescriptorReconciled.promise
    adapter.releaseBlobLookup.resolve(undefined)
    await synchronizationPromise

    expect(await cleanupPromise).toEqual(0)
    expect(adapter.blobs.size).toEqual(1)
    expect(await cache.resolve({assetId: durableAsset.id, online: false})).toEqual(`memory://account-1:${durableAsset.digest}`)
  })
})
