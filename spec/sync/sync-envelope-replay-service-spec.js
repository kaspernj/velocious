import {describe, expect, it} from "../../src/testing/test.js"
import SyncEnvelopeReplayService from "../../src/sync/sync-envelope-replay-service.js"

describe("sync envelope replay service", () => {
  it("normalizes sync envelopes and delegates replay hooks", async () => {
    const calls = []
    const existingSync = {clientUpdatedAt: () => new Date("2026-06-25T10:00:00.000Z")}
    const service = new TestSyncEnvelopeReplayService({
      authenticateReplay: async (params) => {
        calls.push(["authenticate", params.authenticationToken])
        return {actor: {id: "actor-1"}, authenticated: true}
      },
      findExistingReplaySync: async ({actor, mutation}) => {
        calls.push(["find-existing", actor.id, mutation.resourceType, mutation.resourceId])
        return existingSync
      },
      applyReplayMutation: async ({mutation}) => {
        calls.push(["apply", mutation.data.name, mutation.serializedData])
        return {applied: true}
      },
      persistReplayMutation: async ({applyResult, mutation, shouldApply}) => {
        calls.push(["persist", mutation.id, shouldApply, applyResult.applied])
      }
    })

    const result = await service.replay({
      authenticationToken: "token-1",
      syncs: [{
        clientUpdatedAt: "2026-06-25T11:00:00.000Z",
        data: JSON.stringify({name: "Changed"}),
        id: 12,
        resourceId: 34,
        resourceType: "Task",
        syncType: "update"
      }]
    })

    expect(result).toEqual({syncs: [{id: 12, syncState: "successful"}]})
    expect(calls).toEqual([
      ["authenticate", "token-1"],
      ["find-existing", "actor-1", "Task", "34"],
      ["apply", "Changed", JSON.stringify({name: "Changed"})],
      ["persist", 12, true, true]
    ])
  })

  it("returns authentication errors before replaying sync items", async () => {
    const service = new TestSyncEnvelopeReplayService({
      authenticateReplay: async () => ({
        authenticated: false,
        errorCode: "invalid-token",
        errorMessage: "Invalid token"
      }),
      applyReplayMutation: async () => {
        throw new Error("Should not apply syncs")
      }
    })

    const result = await service.replay({syncs: [{id: 1, resourceId: "1", resourceType: "Task", syncType: "update"}]})

    expect(result).toEqual({
      errorCode: "invalid-token",
      errorMessage: "Invalid token",
      status: "error",
      syncs: []
    })
  })

  it("marks malformed sync items as failed and continues the batch", async () => {
    const service = new TestSyncEnvelopeReplayService({
      authenticateReplay: async () => ({actor: {}, authenticated: true}),
      applyReplayMutation: async ({mutation}) => ({resourceType: mutation.resourceType})
    })

    const result = await service.replay({
      syncs: [
        {id: 1, resourceType: "Task", syncType: "update"},
        {data: "not-json", id: 2, resourceId: "2", resourceType: "Task", syncType: "update"},
        {data: {ok: true}, id: 3, resourceId: "3", resourceType: "Task", syncType: "update"}
      ]
    })

    expect(result).toEqual({
      syncs: [
        {id: 1, reason: "invalid-resource-id", syncState: "failed"},
        {id: 2, reason: "invalid-data", syncState: "failed"},
        {id: 3, syncState: "successful"}
      ]
    })
  })

  it("skips applying stale mutations while still persisting replay state", async () => {
    const calls = []
    const service = new TestSyncEnvelopeReplayService({
      authenticateReplay: async () => ({actor: {}, authenticated: true}),
      findExistingReplaySync: async () => ({clientUpdatedAt: () => "2026-06-25T11:00:00.000Z"}),
      applyReplayMutation: async () => {
        throw new Error("Should not apply stale sync")
      },
      persistReplayMutation: async ({applyResult, shouldApply}) => {
        calls.push(["persist", shouldApply, applyResult])
      },
      skippedReplayMutation: async ({mutation}) => ({skippedResourceId: mutation.resourceId})
    })

    const result = await service.replay({
      syncs: [{
        clientUpdatedAt: "2026-06-25T10:00:00.000Z",
        id: 1,
        resourceId: "old-1",
        resourceType: "Task",
        syncType: "update"
      }]
    })

    expect(result).toEqual({syncs: [{id: 1, syncState: "successful"}]})
    expect(calls).toEqual([["persist", false, {skippedResourceId: "old-1"}]])
  })

  it("parses existing sync timestamp strings before stale comparisons", async () => {
    const calls = []
    const service = new TestSyncEnvelopeReplayService({
      authenticateReplay: async () => ({actor: {}, authenticated: true}),
      findExistingReplaySync: async () => ({clientUpdatedAt: "2026-06-25T11:00:00.000Z"}),
      applyReplayMutation: async () => {
        throw new Error("Should not apply stale sync")
      },
      persistReplayMutation: async ({shouldApply}) => {
        calls.push(["persist", shouldApply])
      }
    })

    const result = await service.replay({
      syncs: [{
        clientUpdatedAt: "2026-06-25T10:00:00.000Z",
        id: 9,
        resourceId: "old-9",
        resourceType: "Task",
        syncType: "update"
      }]
    })

    expect(result).toEqual({syncs: [{id: 9, syncState: "successful"}]})
    expect(calls).toEqual([["persist", false]])
  })

  it("lets apps reject individual mutations from authorization hooks", async () => {
    const service = new TestSyncEnvelopeReplayService({
      authenticateReplay: async () => ({actor: {}, authenticated: true}),
      authorizeReplayMutation: async () => ({allowed: false, reason: "mandant-mismatch"}),
      applyReplayMutation: async () => {
        throw new Error("Should not apply denied sync")
      }
    })

    const result = await service.replay({
      syncs: [{id: 7, resourceId: "7", resourceType: "Ticket", syncType: "update"}]
    })

    expect(result).toEqual({syncs: [{id: 7, reason: "mandant-mismatch", syncState: "failed"}]})
  })
})

class TestSyncEnvelopeReplayService extends SyncEnvelopeReplayService {
  constructor(callbacks) {
    super({logger: {warn: () => {}}})
    this.callbacks = callbacks
  }

  async authenticateReplay(params) {
    return await this.callbacks.authenticateReplay(params)
  }

  async authorizeReplayMutation(args) {
    if (this.callbacks.authorizeReplayMutation) return await this.callbacks.authorizeReplayMutation(args)

    return await super.authorizeReplayMutation(args)
  }

  async findExistingReplaySync(args) {
    if (this.callbacks.findExistingReplaySync) return await this.callbacks.findExistingReplaySync(args)

    return await super.findExistingReplaySync(args)
  }

  async applyReplayMutation(args) {
    if (this.callbacks.applyReplayMutation) return await this.callbacks.applyReplayMutation(args)

    return await super.applyReplayMutation(args)
  }

  async skippedReplayMutation(args) {
    if (this.callbacks.skippedReplayMutation) return await this.callbacks.skippedReplayMutation(args)

    return await super.skippedReplayMutation(args)
  }

  async persistReplayMutation(args) {
    if (this.callbacks.persistReplayMutation) return await this.callbacks.persistReplayMutation(args)

    return await super.persistReplayMutation(args)
  }
}
