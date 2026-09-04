// @ts-check

import { describe, expect, it } from "../../src/testing/test.js"
import SynchronizedAssetCache from "../../src/sync/assets/cache.js"
import { bytes, descriptor, MemoryAssetCacheAdapter, PausedBlobLookupAssetCacheAdapter, PausedDeleteAssetCacheAdapter, PausedWriteAssetCacheAdapter } from "../helpers/synchronized-asset-cache.js"

describe("SynchronizedAssetCache eviction", {databaseCleaning: {transaction: false, truncate: false}}, () => {
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
})
