// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import Project from "../dummy/src/models/project.js"
import recordChanges from "../../src/database/record-changes.js"
import SyncApiClient from "../../src/sync/sync-api-client.js"
import Task from "../dummy/src/models/task.js"

describe("sync api client - pull change batching", {databaseCleaning: {transaction: false, truncate: true}, tags: ["dummy"]}, () => {
  it("flushes live-query changes once per applied page, right after the applies and before the next network fetch", async () => {
    const project = await Project.create({name: "Pull batching project"})

    /** @type {string[]} */
    const events = []
    const unsubscribe = recordChanges.subscribe(Task, () => events.push("flush"))

    let pageNumber = 0

    /** @returns {Promise<import("../../src/sync/sync-api-client-types.js").SyncChangesResponse>} A page of pulled changes. */
    const postChanges = async () => {
      events.push("network")
      pageNumber++

      if (pageNumber === 1) {
        return {
          nextCursor: {updatedAt: "2026-01-01T00:00:00Z"},
          status: "success",
          syncs: [{id: "s1", resourceType: "Task"}, {id: "s2", resourceType: "Task"}],
          upToCursor: {updatedAt: "2026-01-01T00:00:00Z"}
        }
      }

      return {nextCursor: null, status: "success", syncs: [], upToCursor: {updatedAt: "2026-01-01T00:00:00Z"}}
    }

    /** @returns {Promise<{changed: boolean, resourceType: string}>} Apply result. */
    const applySync = async () => {
      events.push("apply")
      await Task.create({name: `Pulled task ${events.length}`, projectId: project.id()})

      return {changed: true, resourceType: "Task"}
    }

    try {
      await SyncApiClient.pullChanges({
        applySync,
        authenticationToken: "token",
        batchSize: 2,
        loadCursor: async () => null,
        postChanges,
        saveCursor: async () => {}
      })

      expect(events).toEqual(["network", "apply", "apply", "flush", "network"])
    } finally {
      unsubscribe()
    }
  })
})
