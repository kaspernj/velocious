// @ts-check

import { describe, expect, it } from "../../src/testing/test.js"
import SynchronizedAssetCache from "../../src/sync/assets/cache.js"
import { bytes, descriptor, FailNextSaveAssetCacheAdapter, MemoryAssetCacheAdapter } from "../helpers/synchronized-asset-cache.js"

describe("SynchronizedAssetCache state", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("rejects inconsistent byte sizes before reconciling a shared digest", async () => {
    const content = bytes([108, 109, 110])
    const firstAsset = descriptor({bytes: content, id: "attachment-1"})
    const secondAsset = {
      ...descriptor({bytes: content, id: "attachment-2"}),
      byteSize: content.byteLength + 1,
      recordId: "user-2"
    }
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

    await expect(async () => {
      await cache.synchronize({descriptors: [firstAsset, secondAsset], online: true, scopeKey: "users"})
    }).toThrowError(`Synchronized asset digest ${firstAsset.digest} has inconsistent byte sizes`)

    expect(downloadCount).toEqual(0)
    expect(await adapter.loadState({accountId: "account-1"})).toEqual(null)
  })

  it("rejects inconsistent content types before reconciling a shared digest", async () => {
    const content = bytes([115, 116, 117])
    const firstAsset = descriptor({bytes: content, id: "attachment-1"})
    const secondAsset = {
      ...descriptor({bytes: content, id: "attachment-2"}),
      contentType: "image/jpeg",
      recordId: "user-2"
    }
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

    await expect(async () => {
      await cache.synchronize({descriptors: [firstAsset, secondAsset], online: true, scopeKey: "users"})
    }).toThrowError(`Synchronized asset digest ${firstAsset.digest} has inconsistent content types`)

    expect(downloadCount).toEqual(0)
    expect(await adapter.loadState({accountId: "account-1"})).toEqual(null)
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

    const persistedState = await adapter.loadState({accountId: "account-1"})

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

  it("keeps the last committed descriptors when reconciliation persistence fails", async () => {
    const removedContent = bytes([64, 65, 66])
    const addedContent = bytes([67, 68, 69])
    const removedAsset = descriptor({bytes: removedContent, fetch: "on-demand", id: "removed"})
    const addedAsset = descriptor({bytes: addedContent, fetch: "on-demand", id: "added"})
    const contents = new Map([
      [removedAsset.id, removedContent],
      [addedAsset.id, addedContent]
    ])
    const adapter = new FailNextSaveAssetCacheAdapter()
    const cache = new SynchronizedAssetCache({
      accountId: "account-1",
      adapter,
      download: async (asset) => /** @type {Uint8Array} */ (contents.get(asset.id)),
      maxBytes: 1024
    })

    await cache.synchronize({descriptors: [removedAsset], online: false, scopeKey: "users"})
    adapter.failNextSave = true

    await expect(async () => {
      await cache.synchronize({descriptors: [addedAsset], online: false, scopeKey: "users"})
    }).toThrowError("planned metadata persistence failure")

    expect(await cache.resolve({assetId: addedAsset.id, online: true})).toEqual(null)
    expect(await cache.resolve({assetId: removedAsset.id, online: true})).toEqual(`memory://account-1:${removedAsset.digest}`)

    const persistedState = await adapter.loadState({accountId: "account-1"})

    if (!persistedState) throw new Error("Expected persisted asset cache state")

    expect(persistedState.assets.map((entry) => entry.descriptor.id)).toEqual([removedAsset.id])
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
