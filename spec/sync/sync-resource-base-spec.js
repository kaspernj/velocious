// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import SyncEnvelopeReplayService from "../../src/sync/sync-envelope-replay-service.js"
import SyncModelChangeFeedService from "../../src/sync/sync-model-change-feed-service.js"
import SyncResourceBase from "../../src/sync/sync-resource-base.js"
import {frontendModelResourceConfigurationFromDefinition} from "../../src/frontend-models/resource-definition.js"
import SyncEntry from "../dummy/src/models/sync-entry.js"
import VelociousError from "../../src/velocious-error.js"

class TestSyncModel {
  /** @returns {Record<string, string>} Attribute-to-column map like a real model class. */
  static getAttributeNameToColumnNameMap() {
    return {clientUpdatedAt: "client_updated_at", data: "data", resourceId: "resource_id", syncType: "sync_type"}
  }
}

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
      static ReplayServiceClass = TestReplayService
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
    await expect(async () => await scopedResource.replay()).toThrow("SyncEnvelopeReplayService.authenticateReplay must be implemented (or configure authenticationTokenModel)")
  })

  it("builds the default replay service with plumbed ability, context and locals", () => {
    class TestResource extends SyncResourceBase {
      static ModelClass = TestSyncModel
    }

    /** @type {import("../../src/authorization/ability.js").default} */
    const fakeAbility = /** @type {?} */ ({fake: "ability"})
    const resource = new TestResource({
      ability: fakeAbility,
      context: {currentUserId: "8a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"},
      locals: {locale: "da"},
      modelName: "TestSyncModel"
    })
    const service = /** @type {SyncEnvelopeReplayService} */ (resource.buildReplayService())

    expect(service instanceof SyncEnvelopeReplayService).toEqual(true)
    expect(service.ability === fakeAbility).toEqual(true)
    expect(service.abilityContext).toEqual({currentUserId: "8a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"})
    expect(service.locals).toEqual({locale: "da"})
    expect(service.configuration).toEqual(null)
  })

  it("lets replayServiceArgs win over the plumbed defaults", () => {
    /** @type {import("../../src/authorization/ability.js").default} */
    const overrideAbility = /** @type {?} */ ({override: "ability"})

    class TestResource extends SyncResourceBase {
      static ModelClass = TestSyncModel

      /** @returns {Record<string, ?>} - Replay service args. */
      replayServiceArgs() {
        return {ability: overrideAbility, syncModel: SyncEntry}
      }
    }

    /** @type {import("../../src/authorization/ability.js").default} */
    const plumbedAbility = /** @type {?} */ ({plumbed: "ability"})
    const resource = new TestResource({ability: plumbedAbility, modelName: "TestSyncModel"})
    const service = /** @type {SyncEnvelopeReplayService} */ (resource.buildReplayService())

    expect(service.ability === overrideAbility).toEqual(true)
    expect(service.syncModel === SyncEntry).toEqual(true)
  })

  it("passes index pagination through to the controller hook by default and lets subclasses override it", () => {
    /** @type {Array<Record<string, ?>>} */
    const paginationCalls = []
    const fakeController = /** @type {import("../../src/frontend-model-resource/base-resource.js").FrontendModelResourceController} */ (/** @type {unknown} */ ({
      applyFrontendModelPagination: (/** @type {Record<string, ?>} */ args) => paginationCalls.push(args)
    }))
    const fakeQuery = /** @type {import("../../src/frontend-model-resource/base-resource.js").FrontendModelResourceAnyQuery} */ (/** @type {unknown} */ ({id: "query-1"}))
    const pagination = {limit: null, offset: null, page: 2, perPage: 100}

    buildResource(SyncResourceBase, {}).applyFrontendModelIndexPagination({controller: fakeController, pagination, query: fakeQuery})

    expect(paginationCalls).toEqual([{pagination, query: fakeQuery}])

    class CappedResource extends SyncResourceBase {
      static ModelClass = TestSyncModel

      /** @param {{controller: import("../../src/frontend-model-resource/base-resource.js").FrontendModelResourceController, pagination: import("../../src/frontend-model-resource/base-resource.js").FrontendModelResourcePagination, query: import("../../src/frontend-model-resource/base-resource.js").FrontendModelResourceAnyQuery}} args @returns {void} */
      applyFrontendModelIndexPagination({controller, pagination: givenPagination, query}) {
        controller.applyFrontendModelPagination({pagination: {...givenPagination, perPage: Math.min(givenPagination.perPage ?? 20, 50)}, query})
      }
    }

    buildResource(CappedResource, {}).applyFrontendModelIndexPagination({controller: fakeController, pagination, query: fakeQuery})

    expect(paginationCalls[1]).toEqual({pagination: {limit: null, offset: null, page: 2, perPage: 50}, query: fakeQuery})
  })

})

class QuickSearchSyncResource extends SyncResourceBase {
  static ModelClass = SyncEntry
  static quickSearchColumns = ["resource_id", "resource_type", "sync_type"]
}

/**
 * Builds a fake frontend-model controller recording delegated searches.
 * @param {Array<Record<string, ?>>} searchCalls - Recorded search calls.
 * @returns {import("../../src/frontend-model-resource/base-resource.js").FrontendModelResourceController} Fake controller.
 */
function buildSearchController(searchCalls) {
  return /** @type {import("../../src/frontend-model-resource/base-resource.js").FrontendModelResourceController} */ (/** @type {unknown} */ ({
    applyFrontendModelSearch: (/** @type {Record<string, ?>} */ args) => searchCalls.push(args)
  }))
}

/**
 * Creates a persisted sync entry for quick-search filtering.
 * @param {{resourceId: string, syncType: string}} args - Distinctive entry values.
 * @returns {Promise<SyncEntry>} Persisted entry.
 */
async function createQuickSearchEntry({resourceId, syncType}) {
  const entry = new SyncEntry({
    authenticationTokenId: "3f1c9f2e-6a52-4a8f-9a63-0f4b6f6c8a01",
    clientUpdatedAt: new Date("2026-07-03T10:00:00.000Z"),
    resourceId,
    resourceType: "Task",
    syncType
  })

  await entry.save()

  return entry
}

describe("sync resource base - registration", () => {
  it("passes the declarative static config assertion when registered as a frontend-model resource", () => {
    class RegisteredSyncResource extends SyncResourceBase {
      static ModelClass = SyncEntry
      static attributes = {id: true}
    }

    const configuration = frontendModelResourceConfigurationFromDefinition(RegisteredSyncResource)

    if (!configuration) throw new Error("Expected a normalized resource configuration")
  })
})

describe("sync resource base - quick search", {tags: ["dummy"], databaseCleaning: {transaction: false, truncate: true}}, () => {
  it("expands quickSearch searches to LIKE conditions over the declared columns", async () => {
    const matchingEntry = await createQuickSearchEntry({resourceId: "11111111-aaaa-4bbb-8ccc-222222222222", syncType: "update"})

    await createQuickSearchEntry({resourceId: "33333333-dddd-4eee-8fff-444444444444", syncType: "update"})

    /** @type {Array<Record<string, ?>>} */
    const searchCalls = []
    const resource = buildResource(QuickSearchSyncResource, {})
    const query = SyncEntry.where({})

    resource.applyFrontendModelIndexSearch({
      controller: buildSearchController(searchCalls),
      query,
      search: {column: "quickSearch", operator: "like", path: [], value: " aaaa "}
    })

    const foundEntries = await query.toArray()

    expect(searchCalls).toEqual([])
    expect(foundEntries.map((foundEntry) => foundEntry.id())).toEqual([matchingEntry.id()])
  })

  it("matches quickSearch values across any declared column", async () => {
    await createQuickSearchEntry({resourceId: "11111111-aaaa-4bbb-8ccc-222222222222", syncType: "update"})

    const deleteEntry = await createQuickSearchEntry({resourceId: "33333333-dddd-4eee-8fff-444444444444", syncType: "delete"})

    const resource = buildResource(QuickSearchSyncResource, {})
    const query = SyncEntry.where({})

    resource.applyFrontendModelIndexSearch({
      controller: buildSearchController([]),
      query,
      search: {column: "quickSearch", operator: "like", path: [], value: "delete"}
    })

    const foundEntries = await query.toArray()

    expect(foundEntries.map((foundEntry) => foundEntry.id())).toEqual([deleteEntry.id()])
  })

  it("treats blank quickSearch values as handled without filtering", async () => {
    await createQuickSearchEntry({resourceId: "11111111-aaaa-4bbb-8ccc-222222222222", syncType: "update"})
    await createQuickSearchEntry({resourceId: "33333333-dddd-4eee-8fff-444444444444", syncType: "delete"})

    /** @type {Array<Record<string, ?>>} */
    const searchCalls = []
    const resource = buildResource(QuickSearchSyncResource, {})
    const query = SyncEntry.where({})

    resource.applyFrontendModelIndexSearch({
      controller: buildSearchController(searchCalls),
      query,
      search: {column: "quickSearch", operator: "like", path: [], value: "   "}
    })

    expect(searchCalls).toEqual([])
    expect((await query.toArray()).length).toEqual(2)
  })

  it("rejects invalid quickSearch operators and values with client-safe errors", () => {
    const resource = buildResource(QuickSearchSyncResource, {})
    const query = SyncEntry.where({})
    const controller = buildSearchController([])

    try {
      resource.applyFrontendModelIndexSearch({controller, query, search: {column: "quickSearch", operator: "eq", path: [], value: "abc"}})
      throw new Error("Expected quick search to fail")
    } catch (error) {
      if (!(error instanceof VelociousError)) throw error

      expect(error.message).toEqual("Sync quick search must use the like operator.")
      expect(error.code).toEqual("sync-invalid-quick-search")
      expect(error.safeToExpose).toEqual(true)
    }

    try {
      resource.applyFrontendModelIndexSearch({controller, query, search: {column: "quickSearch", operator: "like", path: [], value: 5}})
      throw new Error("Expected quick search to fail")
    } catch (error) {
      if (!(error instanceof VelociousError)) throw error

      expect(error.message).toEqual("Sync quick search must be a string.")
      expect(error.code).toEqual("sync-invalid-quick-search")
    }
  })

  it("delegates non-quickSearch searches and quickSearch without declared columns to the controller", () => {
    /** @type {Array<Record<string, ?>>} */
    const searchCalls = []
    const controller = buildSearchController(searchCalls)
    const query = SyncEntry.where({})
    const columnSearch = {column: "resource_id", operator: /** @type {const} */ ("like"), path: [], value: "abc"}

    buildResource(QuickSearchSyncResource, {}).applyFrontendModelIndexSearch({controller, query, search: columnSearch})

    class UndeclaredResource extends SyncResourceBase {
      static ModelClass = SyncEntry
    }

    const quickSearch = {column: "quickSearch", operator: /** @type {const} */ ("like"), path: [], value: "abc"}

    buildResource(UndeclaredResource, {}).applyFrontendModelIndexSearch({controller, query, search: quickSearch})

    expect(searchCalls).toEqual([{query, search: columnSearch}, {query, search: quickSearch}])
  })
})
