// @ts-check

import { deferred } from "awaitery"
import { describe, expect, it } from "../../src/testing/test.js"
import SynchronizedAssetCache from "../../src/sync/assets/cache.js"
import { bytes, descriptor, FailNextDeleteAssetCacheAdapter, FailSelectedSaveAssetCacheAdapter, MemoryAssetCacheAdapter, PausedBlobLookupAssetCacheAdapter, PausedFailingSaveAssetCacheAdapter, PausedSaveAssetCacheAdapter } from "../helpers/synchronized-asset-cache.js"

describe("SynchronizedAssetCache deletion", {databaseCleaning: {transaction: false, truncate: false}}, () => {
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

  it("returns null and deletes a cached URI whose final scope reference is removed during lookup", async () => {
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

    expect(await resolvePromise).toEqual(null)
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

  it("isolates queued reconciliation while preserving its deletion work after an earlier rollback", async () => {
    const firstContent = bytes([82, 83, 84])
    const secondContent = bytes([85, 86, 87])
    const firstAsset = descriptor({bytes: firstContent, fetch: "on-demand", id: "first"})
    const secondAsset = descriptor({bytes: secondContent, fetch: "on-demand", id: "second"})
    const adapter = new PausedFailingSaveAssetCacheAdapter()

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
      pendingDeletionDigests: [firstAsset.digest],
      version: 1
    })

    const cache = new SynchronizedAssetCache({
      accountId: "account-1",
      adapter,
      download: async () => firstContent,
      maxBytes: 1024
    })

    adapter.failOnSaveCount = 2

    const failingSynchronization = expect(async () => {
      await cache.synchronize({descriptors: [firstAsset, secondAsset], online: false, scopeKey: "users"})
    }).toThrowError("planned selected metadata persistence failure")

    await adapter.failingSaveStarted.promise

    const removalSynchronization = cache.synchronize({descriptors: [], online: false, scopeKey: "users"})
    const liveState = await cache.loadState()

    expect(liveState.pendingDeletionDigests).toEqual([firstAsset.digest])
    adapter.releaseFailingSave.resolve(undefined)

    await failingSynchronization
    await removalSynchronization

    const persistedState = await adapter.loadState({accountId: "account-1"})

    if (!persistedState) throw new Error("Expected persisted asset cache state")

    expect(persistedState.assets).toEqual([])
    expect(persistedState.pendingDeletionDigests).toEqual([])
    expect(adapter.blobs.size).toEqual(0)
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

    const failedState = await adapter.loadState({accountId: "account-1"})

    if (!failedState) throw new Error("Expected persisted asset cache state")

    expect(failedState.assets).toEqual([])
    expect(failedState.pendingDeletionDigests).toEqual([asset.digest])
    expect(adapter.blobs.size).toEqual(1)

    await buildCache().synchronize({descriptors: [], online: true, scopeKey: "users"})

    const recoveredState = await adapter.loadState({accountId: "account-1"})

    if (!recoveredState) throw new Error("Expected recovered asset cache state")

    expect(recoveredState.pendingDeletionDigests).toEqual([])
    expect(adapter.blobs.size).toEqual(0)
    expect(adapter.deletionAttempts).toEqual(2)
  })

  it("does not reuse a pending blob with new metadata", async () => {
    const content = bytes([130, 131, 132])
    const removedAsset = descriptor({bytes: content, id: "removed"})
    const replacementAsset = {
      ...descriptor({bytes: content, id: "replacement", offlineRequirement: "required"}),
      byteSize: content.byteLength + 1
    }
    const adapter = new FailNextDeleteAssetCacheAdapter()
    const removedCache = new SynchronizedAssetCache({
      accountId: "account-1",
      adapter,
      download: async () => content,
      maxBytes: 1024
    })

    await removedCache.synchronize({descriptors: [removedAsset], online: true, scopeKey: "removed-scope"})
    adapter.failNextDelete = true

    await expect(async () => {
      await removedCache.synchronize({descriptors: [], online: true, scopeKey: "removed-scope"})
    }).toThrowError("planned blob deletion failure")

    let downloadCount = 0
    const replacementCache = new SynchronizedAssetCache({
      accountId: "account-1",
      adapter,
      download: async () => {
        downloadCount += 1
        return content
      },
      maxBytes: 1024
    })
    const result = await replacementCache.synchronize({descriptors: [replacementAsset], online: true, scopeKey: "replacement-scope"})

    expect(result.failures.map((failure) => failure.assetId)).toEqual([replacementAsset.id])
    expect(result.missingRequiredAssetIds).toEqual([replacementAsset.id])
    expect(downloadCount).toEqual(1)
    expect(adapter.deletionAttempts).toEqual(1)
    expect(adapter.blobs.size).toEqual(1)
    expect(await replacementCache.resolve({assetId: replacementAsset.id, online: false})).toEqual(null)
  })
})
