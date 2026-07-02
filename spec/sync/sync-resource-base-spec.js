// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import SyncEnvelopeReplayService from "../../src/sync/sync-envelope-replay-service.js"
import SyncModelChangeFeedService from "../../src/sync/sync-model-change-feed-service.js"
import SyncResourceBase from "../../src/sync/sync-resource-base.js"

class TestSyncModel {}

/**
 * Builds a sync resource instance without the frontend-model pipeline.
 * @param {typeof SyncResourceBase} ResourceClass - Resource class to instantiate.
 * @param {Record<string, ?>} params - Request params.
 * @returns {SyncResourceBase} Resource instance.
 */
function buildResource(ResourceClass, params) {
  return /** @type {SyncResourceBase} */ (Object.assign(Object.create(ResourceClass.prototype), {
    params: () => params
  }))
}

describe("sync resource base", () => {
  it("parses an optional scope param into a serialized scope", () => {
    const resource = buildResource(SyncResourceBase, {})

    expect(resource.changesScope({})).toEqual(null)
    expect(resource.changesScope({scope: {conditions: {partnerId: 5}, resourceType: "Event"}}))
      .toEqual({conditions: {partnerId: 5}, resourceType: "Event"})
  })

  it("fails loudly on malformed scope params", async () => {
    const resource = buildResource(SyncResourceBase, {})

    await expect(() => resource.changesScope({scope: "Event"})).toThrow(/scope must be an object/u)
    await expect(() => resource.changesScope({scope: {conditions: {a: 1}}})).toThrow(/resourceType/u)
    await expect(() => resource.changesScope({scope: {conditions: [], resourceType: "Event"}})).toThrow(/conditions must be an object/u)
  })

  it("calls authorizeChanges with the parsed scope before serving changes", async () => {
    /** @type {Array<string>} */
    const calls = []

    class TestResource extends SyncResourceBase {
      static ModelClass = TestSyncModel

      /** @param {{params: Record<string, ?>, scope: import("../../src/sync/sync-resource-base.js").SerializedChangesScope | null}} args @returns {Promise<void>} */
      async authorizeChanges({scope}) {
        calls.push(`authorize:${scope?.resourceType}`)
      }

      /** @param {{params: Record<string, ?>, scope: import("../../src/sync/sync-resource-base.js").SerializedChangesScope | null}} args @returns {{changes: () => Promise<Record<string, ?>>}} */
      changeFeedService(args) {
        calls.push(`feed:${args.scope?.resourceType}`)
        return {changes: async () => ({status: "success", syncs: []})}
      }
    }

    const resource = buildResource(TestResource, {scope: {conditions: {partnerId: 5}, resourceType: "Event"}})
    const result = await resource.changes()

    expect(calls).toEqual(["authorize:Event", "feed:Event"])
    expect(result).toEqual({status: "success", syncs: []})
  })

  it("propagates authorizeChanges rejections without serving changes", async () => {
    /** @type {Array<string>} */
    const calls = []

    class TestResource extends SyncResourceBase {
      static ModelClass = TestSyncModel

      /** @returns {Promise<void>} */
      async authorizeChanges() {
        throw new Error("Not allowed to read sync changes")
      }

      /** @returns {{changes: () => Promise<Record<string, ?>>}} */
      changeFeedService() {
        calls.push("feed")
        return {changes: async () => ({})}
      }
    }

    const resource = buildResource(TestResource, {})

    await expect(async () => await resource.changes()).toThrow("Not allowed to read sync changes")
    expect(calls).toEqual([])
  })

  it("builds a change feed service that scopes through scopeChangesQuery", () => {
    /** @type {Array<Record<string, ?>>} */
    const scopeCalls = []

    class TestResource extends SyncResourceBase {
      static ModelClass = TestSyncModel

      /** @param {{params: Record<string, ?>, query: ?, scope: import("../../src/sync/sync-resource-base.js").SerializedChangesScope | null}} args @returns {void} */
      scopeChangesQuery({query, scope}) {
        scopeCalls.push({query, scope})
      }
    }

    const params = {scope: {conditions: {partnerId: 5}, resourceType: "Event"}}
    const resource = buildResource(TestResource, params)
    const scope = resource.changesScope(params)
    const service = resource.changeFeedService({params, scope})

    expect(service instanceof SyncModelChangeFeedService).toEqual(true)

    const fakeQuery = {id: "query-1"}

    service.scopeQuery({query: fakeQuery})

    expect(scopeCalls).toEqual([{query: fakeQuery, scope: {conditions: {partnerId: 5}, resourceType: "Event"}}])
  })

  it("delegates replay to the app replay service and reshapes successful results", async () => {
    /** @type {Array<Record<string, ?>>} */
    const replayCalls = []

    class TestReplayService extends SyncEnvelopeReplayService {
      /** @param {Record<string, ?>} params @returns {Promise<{syncs: Array<Record<string, ?>>}>} */
      async replay(params) {
        replayCalls.push(params)
        return {syncs: [{id: 1, syncState: "successful"}]}
      }
    }

    class TestResource extends SyncResourceBase {
      static ModelClass = TestSyncModel

      /** @returns {typeof SyncEnvelopeReplayService} */
      replayServiceClass() {
        return TestReplayService
      }
    }

    const params = {authenticationToken: "token-1", syncs: [{id: 1}]}
    const resource = buildResource(TestResource, params)
    const result = await resource.replay()

    expect(replayCalls).toEqual([params])
    expect(result).toEqual({status: "success", syncs: [{id: 1, syncState: "successful"}]})
  })

  it("passes replay error results through unchanged", async () => {
    class TestReplayService extends SyncEnvelopeReplayService {
      /** @returns {Promise<{syncs: Array<Record<string, ?>>, status: string, errorCode: string, errorMessage: string}>} */
      async replay() {
        return {errorCode: "invalid-token", errorMessage: "Invalid token", status: "error", syncs: []}
      }
    }

    class TestResource extends SyncResourceBase {
      static ModelClass = TestSyncModel

      /** @returns {typeof SyncEnvelopeReplayService} */
      replayServiceClass() {
        return TestReplayService
      }
    }

    const resource = buildResource(TestResource, {})
    const result = await resource.replay()

    expect(result).toEqual({errorCode: "invalid-token", errorMessage: "Invalid token", status: "error", syncs: []})
  })

  it("throws configuration errors when hooks are not implemented", async () => {
    class TestResource extends SyncResourceBase {
      static ModelClass = TestSyncModel

      /** @returns {Promise<void>} */
      async authorizeChanges() {}
    }

    const bareResource = buildResource(SyncResourceBase, {})
    const scopedResource = buildResource(TestResource, {})
    const service = scopedResource.changeFeedService({params: {}, scope: null})

    await expect(async () => await bareResource.changes()).toThrow("SyncResourceBase#authorizeChanges must be implemented")
    await expect(() => service.scopeQuery({query: {}})).toThrow("SyncResourceBase#scopeChangesQuery must be implemented")
    await expect(async () => await scopedResource.replay()).toThrow("SyncResourceBase#replayServiceClass must be implemented")
  })
})
