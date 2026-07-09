// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import SyncApiClient from "../../src/sync/sync-api-client.js"

/**
 * Builds a paged postChanges fake from an ordered list of change pages. Each page
 * carries the server's `total` (pending change count from that request's cursor).
 * @param {Array<{syncs: Array<Record<string, unknown>>, nextCursor: Record<string, unknown> | null, total: number}>} pages - Ordered change pages.
 * @returns {(payload: Record<string, unknown>) => Promise<import("../../src/sync/sync-api-client-types.js").SyncChangesResponse>} Changes poster.
 */
function pagedPostChanges(pages) {
  let index = 0

  return async () => {
    const page = pages[index] || {nextCursor: null, syncs: [], total: 0}

    index += 1

    return {
      nextCursor: page.nextCursor,
      status: "success",
      syncs: page.syncs,
      total: page.total,
      upToCursor: {id: "up-to", serverSequence: 999, updatedAt: "2026-07-09T10:00:00.000Z"}
    }
  }
}

describe("sync API client - pull progress", () => {
  it("reports increasing syncedCount and a stable server total across pages", async () => {
    /** @type {Array<{pages: number, syncedCount: number, total: number}>} */
    const progress = []
    const postChanges = pagedPostChanges([
      {
        nextCursor: {id: "s2", serverSequence: 2, updatedAt: "2026-07-09T10:00:02.000Z"},
        syncs: [
          {data: {}, id: "s1", resourceId: "r1", resourceType: "Task", syncType: "update"},
          {data: {}, id: "s2", resourceId: "r2", resourceType: "Task", syncType: "update"}
        ],
        total: 3
      },
      {
        nextCursor: {id: "s3", serverSequence: 3, updatedAt: "2026-07-09T10:00:03.000Z"},
        syncs: [{data: {}, id: "s3", resourceId: "r3", resourceType: "Task", syncType: "update"}],
        total: 1
      }
    ])

    const result = await SyncApiClient.pullChanges({
      applySync: async (sync) => ({changed: true, resourceType: sync.resourceType()}),
      authenticationToken: "token",
      batchSize: 2,
      loadCursor: async () => null,
      onProgress: (update) => progress.push(update),
      postChanges,
      saveCursor: async () => {}
    })

    expect(progress).toEqual([
      {pages: 1, syncedCount: 2, total: 3},
      {pages: 2, syncedCount: 3, total: 3}
    ])
    expect(result.syncedCount).toEqual(3)
    expect(result.total).toEqual(3)
  })

  it("reports a total of 0 for a pull with nothing to sync", async () => {
    /** @type {Array<{pages: number, syncedCount: number, total: number}>} */
    const progress = []
    const postChanges = pagedPostChanges([{nextCursor: null, syncs: [], total: 0}])

    const result = await SyncApiClient.pullChanges({
      applySync: async () => ({changed: false, resourceType: null}),
      authenticationToken: "token",
      loadCursor: async () => null,
      onProgress: (update) => progress.push(update),
      postChanges,
      saveCursor: async () => {}
    })

    expect(progress).toEqual([{pages: 0, syncedCount: 0, total: 0}])
    expect(result.syncedCount).toEqual(0)
    expect(result.total).toEqual(0)
  })

  it("still pulls without an onProgress callback", async () => {
    const postChanges = pagedPostChanges([
      {
        nextCursor: {id: "s1", serverSequence: 1, updatedAt: "2026-07-09T10:00:01.000Z"},
        syncs: [{data: {}, id: "s1", resourceId: "r1", resourceType: "Task", syncType: "update"}],
        total: 1
      }
    ])

    const result = await SyncApiClient.pullChanges({
      applySync: async (sync) => ({changed: true, resourceType: sync.resourceType()}),
      authenticationToken: "token",
      loadCursor: async () => null,
      postChanges,
      saveCursor: async () => {}
    })

    expect(result.syncedCount).toEqual(1)
    expect(result.total).toEqual(1)
  })
})
