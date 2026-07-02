// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import {setCurrentSyncClient} from "../../src/sync/sync-client-registry.js"
import Task from "../dummy/src/models/task.js"

describe("query sync sugar", {tags: ["dummy"]}, () => {
  it("delegates query.sync() and query.unsync() to the current sync client", async () => {
    /** @type {Array<string>} */
    const calls = []
    const fakeClient = {
      /** @param {?} query - Declared query. @returns {Promise<?>} Fake result. */
      sync: async (query) => {
        calls.push(`sync:${query.getModelClass().getModelName()}`)

        return {pulled: null, scope: null}
      },
      /** @param {?} query - Undeclared query. @returns {Promise<void>} */
      unsync: async (query) => {
        calls.push(`unsync:${query.getModelClass().getModelName()}`)
      }
    }

    setCurrentSyncClient(fakeClient)

    try {
      await Task.where({projectId: 5}).sync()
      await Task.where({projectId: 5}).unsync()
    } finally {
      setCurrentSyncClient(null)
    }

    expect(calls).toEqual(["sync:Task", "unsync:Task"])
  })

  it("fails loudly when no sync client is configured", async () => {
    await expect(async () => await Task.where({projectId: 5}).sync())
      .toThrow(/No sync client configured/u)
  })
})
