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
        id: "018ff6a1-0000-7000-8000-000000000012",
        resourceId: 34,
        resourceType: "Task",
        syncType: "update"
      }]
    })

    expect(result).toEqual({syncs: [{id: "018ff6a1-0000-7000-8000-000000000012", syncState: "successful"}]})
    expect(calls).toEqual([
      ["authenticate", "token-1"],
      ["find-existing", "actor-1", "Task", "34"],
      ["apply", "Changed", JSON.stringify({name: "Changed"})],
      ["persist", "018ff6a1-0000-7000-8000-000000000012", true, true]
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

    const result = await service.replay({syncs: [{id: "018ff6a1-0000-7000-8000-000000000001", resourceId: "1", resourceType: "Task", syncType: "update"}]})

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
        {id: "018ff6a1-0000-7000-8000-000000000001", resourceType: "Task", syncType: "update"},
        {data: "not-json", id: "018ff6a1-0000-7000-8000-000000000002", resourceId: "2", resourceType: "Task", syncType: "update"},
        {data: {ok: true}, id: "018ff6a1-0000-7000-8000-000000000003", resourceId: "3", resourceType: "Task", syncType: "update"}
      ]
    })

    expect(result).toEqual({
      syncs: [
        {id: "018ff6a1-0000-7000-8000-000000000001", reason: "invalid-resource-id", syncState: "failed"},
        {id: "018ff6a1-0000-7000-8000-000000000002", reason: "invalid-data", syncState: "failed"},
        {id: "018ff6a1-0000-7000-8000-000000000003", syncState: "successful"}
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
        id: "018ff6a1-0000-7000-8000-000000000001",
        resourceId: "old-1",
        resourceType: "Task",
        syncType: "update"
      }]
    })

    expect(result).toEqual({syncs: [{id: "018ff6a1-0000-7000-8000-000000000001", syncState: "successful"}]})
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
        id: "018ff6a1-0000-7000-8000-000000000009",
        resourceId: "old-9",
        resourceType: "Task",
        syncType: "update"
      }]
    })

    expect(result).toEqual({syncs: [{id: "018ff6a1-0000-7000-8000-000000000009", syncState: "successful"}]})
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
      syncs: [{id: "018ff6a1-0000-7000-8000-000000000007", resourceId: "7", resourceType: "Ticket", syncType: "update"}]
    })

    expect(result).toEqual({syncs: [{id: "018ff6a1-0000-7000-8000-000000000007", reason: "mandant-mismatch", syncState: "failed"}]})
  })

  it("finds existing sync rows through the configured sync model", async () => {
    const syncModel = buildFakeSyncModel()
    const service = new ModelBackedReplayService({syncModel})
    const result = await service.replay({
      authenticationToken: "token-1",
      syncs: [{
        clientUpdatedAt: "2026-06-25T11:00:00.000Z",
        data: {name: "Changed"},
        id: "018ff6a1-0000-7000-8000-000000000012",
        resourceId: 34,
        resourceType: "Task",
        syncType: "update"
      }]
    })

    expect(result).toEqual({syncs: [{id: "018ff6a1-0000-7000-8000-000000000012", syncState: "successful"}]})
    expect(syncModel.findByCalls).toEqual([{
      authentication_token_id: "actor-1",
      resource_id: "34",
      resource_type: "Task"
    }])
  })

  it("creates a sync row through the configured sync model when none exists", async () => {
    const syncModel = buildFakeSyncModel()
    const service = new ModelBackedReplayService({syncModel})

    await service.replay({
      authenticationToken: "token-1",
      syncs: [{
        clientUpdatedAt: "2026-06-25T11:00:00.000Z",
        data: {name: "Changed"},
        id: "018ff6a1-0000-7000-8000-000000000012",
        resourceId: 34,
        resourceType: "Task",
        syncType: "update"
      }]
    })

    const {client_updated_at: clientUpdatedAt, ...createdAttributes} = syncModel.createCalls[0]

    expect(clientUpdatedAt.toISOString()).toEqual("2026-06-25T11:00:00.000Z")
    expect(createdAttributes).toEqual({
      authentication_token_id: "actor-1",
      data: JSON.stringify({name: "Changed"}),
      resource_id: "34",
      resource_type: "Task",
      sync_type: "update"
    })
  })

  it("updates and re-sequences an existing sync row for newer client mutations", async () => {
    const existingSync = buildFakeSyncRecord({clientUpdatedAt: new Date("2026-06-25T10:00:00.000Z")})
    const syncModel = buildFakeSyncModel({existingSync})
    const service = new ModelBackedReplayService({syncModel})

    await service.replay({
      authenticationToken: "token-1",
      syncs: [{
        clientUpdatedAt: "2026-06-25T11:00:00.000Z",
        data: {name: "Changed"},
        id: "018ff6a1-0000-7000-8000-000000000012",
        resourceId: 34,
        resourceType: "Task",
        syncType: "update"
      }]
    })

    expect(syncModel.createCalls).toEqual([])
    expect(existingSync.calls).toEqual(["assign", "advanceServerSequence", "save"])
    expect(existingSync.assignedAttributes.sync_type).toEqual("update")
  })

  it("does not persist stale mutations over a newer existing sync row", async () => {
    const existingSync = buildFakeSyncRecord({clientUpdatedAt: new Date("2026-06-25T12:00:00.000Z")})
    const syncModel = buildFakeSyncModel({existingSync})
    const service = new ModelBackedReplayService({syncModel})
    const result = await service.replay({
      authenticationToken: "token-1",
      syncs: [{
        clientUpdatedAt: "2026-06-25T11:00:00.000Z",
        data: {name: "Changed"},
        id: "018ff6a1-0000-7000-8000-000000000012",
        resourceId: 34,
        resourceType: "Task",
        syncType: "update"
      }]
    })

    expect(result).toEqual({syncs: [{id: "018ff6a1-0000-7000-8000-000000000012", syncState: "successful"}]})
    expect(syncModel.createCalls).toEqual([])
    expect(existingSync.calls).toEqual([])
  })

  it("authenticates replay actors through a configured token model", async () => {
    const tokenRecord = {id: () => "token-row-1"}
    /** @type {Array<Record<string, ?>>} */
    const findByCalls = []

    class TokenAuthedReplayService extends SyncEnvelopeReplayService {
      constructor() {
        super({
          authenticationTokenModel: {
            /** @param {Record<string, ?>} conditions - Lookup conditions. @returns {Promise<?>} Token row. */
            findBy: async (conditions) => {
              findByCalls.push(conditions)

              return conditions.token === "valid-token" ? tokenRecord : null
            }
          },
          logger: {warn: () => {}}
        })
      }
    }

    const service = new TokenAuthedReplayService()

    expect(await service.authenticateReplay({authenticationToken: "valid-token"}))
      .toEqual({actor: tokenRecord, authenticated: true})
    expect(await service.authenticateReplay({}))
      .toEqual({authenticated: false, errorCode: "missing-authentication-token", errorMessage: "Missing authentication token"})
    expect(await service.authenticateReplay({authenticationToken: "wrong"}))
      .toEqual({authenticated: false, errorCode: "invalid-authentication-token", errorMessage: "Invalid authentication token"})
    expect(findByCalls).toEqual([{token: "valid-token"}, {token: "wrong"}])
  })

  it("dispatches replay mutations through the declarative apply-handler registry", async () => {
    /** @type {Array<string>} */
    const calls = []
    const service = new TestSyncEnvelopeReplayService({
      authenticateReplay: async () => ({actor: {}, authenticated: true})
    }, {
      applyHandlers: {
        Task: async ({mutation}) => {
          calls.push(`task:${mutation.resourceId}`)

          return {appliedTask: true}
        }
      }
    })
    /** @type {Array<?>} */
    const persisted = []

    service.callbacks.persistReplayMutation = async ({applyResult}) => {
      persisted.push(applyResult)
    }

    const result = await service.replay({
      syncs: [{data: {}, id: "018ff6a1-0000-7000-8000-000000000003", resourceId: "t-3", resourceType: "Task", syncType: "update"}]
    })

    expect(result).toEqual({syncs: [{id: "018ff6a1-0000-7000-8000-000000000003", syncState: "successful"}]})
    expect(calls).toEqual(["task:t-3"])
    expect(persisted).toEqual([{appliedTask: true}])
  })

  it("fails loudly for mutations without a registered apply handler", async () => {
    const service = new TestSyncEnvelopeReplayService({
      authenticateReplay: async () => ({actor: {}, authenticated: true})
    }, {
      applyHandlers: {
        Task: async () => ({})
      }
    })

    await expect(async () => await service.replay({
      syncs: [{data: {}, id: "018ff6a1-0000-7000-8000-000000000004", resourceId: "u-1", resourceType: "Unknown", syncType: "update"}]
    })).toThrow(/No sync apply handler registered for: Unknown/u)
  })

  it("persists extra attributes and serialized data through the configured hooks", async () => {
    const syncModel = buildFakeSyncModel()
    const service = new ModelBackedReplayService({
      options: {
        persistExtraAttributes: ({applyResult}) => ({event_id: applyResult.appliedEventId}),
        persistSerializedData: ({applyResult}) => applyResult.snapshot
      },
      syncModel
    })

    service.applyReplayMutation = async () => ({appliedEventId: "event-7", snapshot: {embedded: true}})

    await service.replay({
      authenticationToken: "token-1",
      syncs: [{clientUpdatedAt: "2026-07-03T10:00:00.000Z", data: {name: "x"}, id: "018ff6a1-0000-7000-8000-000000000001", resourceId: "r-1", resourceType: "Task", syncType: "update"}]
    })

    expect(syncModel.createCalls.length).toEqual(1)
    expect(syncModel.createCalls[0].event_id).toEqual("event-7")
    expect(syncModel.createCalls[0].data).toEqual(JSON.stringify({embedded: true}))
  })

  it("skips persistence extension hooks for stale replays", async () => {
    const existingSync = buildFakeSyncRecord({clientUpdatedAt: new Date("2026-07-03T12:00:00.000Z")})
    const syncModel = buildFakeSyncModel({existingSync})
    const service = new ModelBackedReplayService({
      options: {
        persistExtraAttributes: ({applyResult}) => ({event_id: applyResult.appliedEventId}),
        persistSerializedData: ({applyResult}) => applyResult.snapshot
      },
      syncModel
    })

    service.applyReplayMutation = async () => ({appliedEventId: "event-7", snapshot: {embedded: true}})

    const result = await service.replay({
      authenticationToken: "token-1",
      syncs: [{clientUpdatedAt: "2026-07-03T10:00:00.000Z", data: {name: "stale"}, id: "018ff6a1-0000-7000-8000-000000000001", resourceId: "r-1", resourceType: "Task", syncType: "update"}]
    })

    expect(result).toEqual({syncs: [{id: "018ff6a1-0000-7000-8000-000000000001", syncState: "successful"}]})
    expect(syncModel.createCalls).toEqual([])
    expect(existingSync.calls).toEqual([])
  })

  it("skips declarative broadcasts for stale replays", async () => {
    /** @type {Array<Record<string, ?>>} */
    const broadcastCalls = []
    const service = new TestSyncEnvelopeReplayService({
      authenticateReplay: async () => ({actor: {}, authenticated: true}),
      findExistingReplaySync: async () => ({clientUpdatedAt: () => "2026-07-03T12:00:00.000Z"}),
      applyReplayMutation: async () => {
        throw new Error("Should not apply stale sync")
      },
      persistReplayMutation: async () => {}
    }, {
      broadcaster: async (broadcast) => {
        broadcastCalls.push(broadcast)
      },
      broadcasts: [{
        body: ({applyResult}) => applyResult.published,
        broadcastParams: ({applyResult}) => ({eventId: applyResult.eventId}),
        channel: "ticket-scans"
      }]
    })

    const result = await service.replay({
      syncs: [{clientUpdatedAt: "2026-07-03T10:00:00.000Z", data: {}, id: "018ff6a1-0000-7000-8000-000000000001", resourceId: "t-1", resourceType: "Ticket", syncType: "update"}]
    })

    expect(result).toEqual({syncs: [{id: "018ff6a1-0000-7000-8000-000000000001", syncState: "successful"}]})
    expect(broadcastCalls).toEqual([])
  })

  it("fans applied mutations out through declarative broadcasts", async () => {
    /** @type {Array<Record<string, ?>>} */
    const broadcastCalls = []
    const service = new TestSyncEnvelopeReplayService({
      authenticateReplay: async () => ({actor: {}, authenticated: true}),
      applyReplayMutation: async () => ({eventId: "event-1", mandantenNr: 7, published: {id: "t-1"}}),
      persistReplayMutation: async () => {}
    }, {
      broadcaster: async (broadcast) => {
        broadcastCalls.push(broadcast)
      },
      broadcasts: [{
        body: ({applyResult}) => applyResult.published,
        broadcastParams: ({applyResult}) => ({eventId: applyResult.eventId, mandantenNr: applyResult.mandantenNr}),
        channel: "ticket-scans",
        when: ({applyResult}) => Boolean(applyResult.published)
      }]
    })

    await service.replay({
      syncs: [
        {data: {}, id: "018ff6a1-0000-7000-8000-000000000001", resourceId: "t-1", resourceType: "Ticket", syncType: "update"},
        {data: {}, id: "018ff6a1-0000-7000-8000-000000000002", resourceId: "t-2", resourceType: "Ticket", syncType: "update"}
      ]
    })

    expect(broadcastCalls).toEqual([
      {body: {id: "t-1"}, channel: "ticket-scans", params: {eventId: "event-1", mandantenNr: 7}},
      {body: {id: "t-1"}, channel: "ticket-scans", params: {eventId: "event-1", mandantenNr: 7}}
    ])
  })

  it("skips broadcasts whose when-gate declines", async () => {
    /** @type {Array<Record<string, ?>>} */
    const broadcastCalls = []
    const service = new TestSyncEnvelopeReplayService({
      authenticateReplay: async () => ({actor: {}, authenticated: true}),
      applyReplayMutation: async () => ({published: null}),
      persistReplayMutation: async () => {}
    }, {
      broadcaster: async (broadcast) => {
        broadcastCalls.push(broadcast)
      },
      broadcasts: [{
        body: ({applyResult}) => applyResult.published,
        broadcastParams: () => ({}),
        channel: "ticket-scans",
        when: ({applyResult}) => Boolean(applyResult.published)
      }]
    })

    await service.replay({syncs: [{data: {}, id: "018ff6a1-0000-7000-8000-000000000001", resourceId: "t-1", resourceType: "Ticket", syncType: "update"}]})

    expect(broadcastCalls).toEqual([])
  })

  it("rejects broadcasts configuration without a broadcaster", async () => {
    await expect(() => new TestSyncEnvelopeReplayService({
      authenticateReplay: async () => ({actor: {}, authenticated: true})
    }, {
      broadcasts: [{body: () => ({}), broadcastParams: () => ({}), channel: "x"}]
    })).toThrow(/broadcaster/u)
  })

  it("fails loudly when model-backed defaults get an actor without an id", async () => {
    const syncModel = buildFakeSyncModel()
    const service = new ModelBackedReplayService({actor: {}, syncModel})

    await expect(async () => await service.replay({
      authenticationToken: "token-1",
      syncs: [{clientUpdatedAt: "2026-06-25T11:00:00.000Z", id: "018ff6a1-0000-7000-8000-000000000001", resourceId: "1", resourceType: "Task", syncType: "update"}]
    })).toThrow(/actor with an id/u)
  })
})

/**
 * Builds a fake sync record for model-backed replay tests.
 * @param {{clientUpdatedAt: Date}} args - Existing record state.
 * @returns {{assign: Function, advanceServerSequence: Function, save: Function, clientUpdatedAt: Function, calls: Array<string>, assignedAttributes: Record<string, ?>}} Fake sync record.
 */
function buildFakeSyncRecord({clientUpdatedAt}) {
  const record = {
    assignedAttributes: {},
    calls: [],
    assign(attributes) {
      record.calls.push("assign")
      record.assignedAttributes = attributes
    },
    async advanceServerSequence() {
      record.calls.push("advanceServerSequence")
    },
    clientUpdatedAt: () => clientUpdatedAt,
    async save() {
      record.calls.push("save")
    }
  }

  return record
}

/**
 * Builds a fake sync model class for model-backed replay tests.
 * @param {{existingSync?: ?}} [args] - Existing record returned from findBy.
 * @returns {{findBy: Function, create: Function, findByCalls: Array<Record<string, ?>>, createCalls: Array<Record<string, ?>>}} Fake sync model.
 */
function buildFakeSyncModel({existingSync = null} = {}) {
  const model = {
    createCalls: [],
    findByCalls: [],
    async create(attributes) {
      model.createCalls.push(attributes)
    },
    async findBy(conditions) {
      model.findByCalls.push(conditions)
      return existingSync
    }
  }

  return model
}

class ModelBackedReplayService extends SyncEnvelopeReplayService {
  constructor({actor = {id: () => "actor-1"}, options = {}, syncModel}) {
    super({logger: {warn: () => {}}, syncModel, ...options})
    this.actor = actor
  }

  async authenticateReplay() {
    return {actor: this.actor, authenticated: true}
  }
}

class TestSyncEnvelopeReplayService extends SyncEnvelopeReplayService {
  constructor(callbacks, options = {}) {
    super({logger: {warn: () => {}}, ...options})
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
