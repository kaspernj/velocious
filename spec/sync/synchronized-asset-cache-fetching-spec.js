// @ts-check

import { deferred } from "awaitery"
import { describe, expect, it } from "../../src/testing/test.js"
import SynchronizedAssetCache from "../../src/sync/assets/cache.js"
import { bytes, DelayedSaveAssetCacheAdapter, descriptor, MemoryAssetCacheAdapter, PausedSaveAssetCacheAdapter } from "../helpers/synchronized-asset-cache.js"

describe("SynchronizedAssetCache fetching", {databaseCleaning: {transaction: false, truncate: false}}, () => {
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

  it("attempts a failed eager digest once and propagates the failure to every reference", async () => {
    const content = bytes([105, 106, 107])
    const firstAsset = descriptor({bytes: content, id: "attachment-1"})
    const secondAsset = {...descriptor({bytes: content, id: "attachment-2"}), recordId: "user-2"}
    const adapter = new MemoryAssetCacheAdapter()
    let downloadCount = 0
    const cache = new SynchronizedAssetCache({
      accountId: "account-1",
      adapter,
      download: async () => {
        downloadCount += 1
        throw new Error("planned eager download failure")
      },
      maxBytes: 1024,
      now: () => new Date(1000),
      retryBaseDelayMs: 500
    })

    const result = await cache.synchronize({descriptors: [firstAsset, secondAsset], online: true, scopeKey: "users"})
    const persistedState = await adapter.loadState({accountId: "account-1"})

    if (!persistedState) throw new Error("Expected persisted asset cache state")

    expect(result.failures.map((failure) => failure.assetId)).toEqual([firstAsset.id, secondAsset.id])
    expect(downloadCount).toEqual(1)
    expect(persistedState.assets.map((entry) => ({attempts: entry.attempts, nextRetryAt: entry.nextRetryAt, status: entry.status}))).toEqual([
      {attempts: 1, nextRetryAt: 1500, status: "failed"},
      {attempts: 1, nextRetryAt: 1500, status: "failed"}
    ])
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

  it("rejects descriptor metadata that conflicts with an in-flight digest download", async () => {
    const content = bytes([108, 109, 110])
    const firstAsset = descriptor({bytes: content, fetch: "on-demand", id: "attachment-1"})
    const secondAsset = {...descriptor({bytes: content, fetch: "on-demand", id: "attachment-2"}), byteSize: content.byteLength + 1}
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

    await cache.synchronize({descriptors: [firstAsset], online: true, scopeKey: "first-scope"})

    const firstResolve = cache.resolve({assetId: firstAsset.id, online: true})

    await downloadStarted.promise
    await cache.synchronize({descriptors: [], online: true, scopeKey: "first-scope"})

    try {
      await expect(async () => {
        await cache.synchronize({descriptors: [secondAsset], online: false, scopeKey: "second-scope"})
      }).toThrowError(`Synchronized asset digest ${secondAsset.digest} has inconsistent byte sizes`)
    } finally {
      releaseDownload.resolve(undefined)
      await firstResolve
    }
  })

  it("joins a failed digest flight while its retry metadata is still persisting", async () => {
    const content = bytes([102, 103, 104])
    const firstAsset = descriptor({bytes: content, fetch: "on-demand", id: "attachment-1"})
    const secondAsset = {...descriptor({bytes: content, fetch: "on-demand", id: "attachment-2"}), recordId: "user-2"}
    const downloadStarted = deferred()
    const releaseDownload = deferred()
    const secondDownloadingSaveStarted = deferred()
    const adapter = new PausedSaveAssetCacheAdapter()

    class ObservedSynchronizedAssetCache extends SynchronizedAssetCache {
      /** @returns {Promise<void>} Resolves after state persistence. */
      async saveState() {
        if (this.state && this.state.assets.some((entry) => entry.descriptor.id === secondAsset.id && entry.status === "downloading")) {
          secondDownloadingSaveStarted.resolve(undefined)
        }

        await super.saveState()
      }
    }

    let downloadCount = 0
    const cache = new ObservedSynchronizedAssetCache({
      accountId: "account-1",
      adapter,
      download: async () => {
        downloadCount += 1

        if (downloadCount > 1) return content

        downloadStarted.resolve(undefined)
        await releaseDownload.promise
        throw new Error("planned download failure")
      },
      maxBytes: 1024,
      now: () => new Date(1000),
      retryBaseDelayMs: 500
    })

    await cache.synchronize({descriptors: [firstAsset, secondAsset], online: true, scopeKey: "users"})

    const firstResolve = cache.resolve({assetId: firstAsset.id, online: true})

    await downloadStarted.promise
    adapter.pauseNextSave = true
    releaseDownload.resolve(undefined)
    await adapter.saveCommitted.promise

    const secondResolve = cache.resolve({assetId: secondAsset.id, online: true})

    await secondDownloadingSaveStarted.promise
    adapter.releaseSave.resolve(undefined)

    const results = await Promise.allSettled([firstResolve, secondResolve])
    const persistedState = await adapter.loadState({accountId: "account-1"})

    if (!persistedState) throw new Error("Expected persisted asset cache state")

    expect(results.map((result) => result.status)).toEqual(["rejected", "rejected"])
    expect(downloadCount).toEqual(1)
    expect(persistedState.assets.map((entry) => ({attempts: entry.attempts, nextRetryAt: entry.nextRetryAt, status: entry.status}))).toEqual([
      {attempts: 1, nextRetryAt: 1500, status: "failed"},
      {attempts: 1, nextRetryAt: 1500, status: "failed"}
    ])
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
    const persistedState = await adapter.loadState({accountId: "account-1"})

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
})
