import {describe, expect, it} from "../../src/testing/test.js"
import SyncModelChangeFeedService from "../../src/sync/sync-model-change-feed-service.js"

class TestSyncModel {}

describe("sync model change-feed service", () => {
  it("rejects sub-unit fractional limits instead of flooring them to zero", () => {
    const service = new SyncModelChangeFeedService({modelClass: TestSyncModel, params: {limit: "0.5"}})

    expect(() => service.normalizedLimit("0.5")).toThrow("Sync changes limit must be a positive integer.")
  })

  it("rejects positive fractional limits instead of silently flooring them", () => {
    const service = new SyncModelChangeFeedService({modelClass: TestSyncModel, params: {limit: "1.5"}})

    expect(() => service.normalizedLimit("1.5")).toThrow("Sync changes limit must be a positive integer.")
  })

  it("clamps valid integer limits to the configured maximum", () => {
    const service = new SyncModelChangeFeedService({maxLimit: 2, modelClass: TestSyncModel, params: {limit: "10"}})

    expect(service.normalizedLimit("10")).toEqual(2)
  })

  it("fails early when asked to read a value from an invalid sync row", () => {
    const service = new SyncModelChangeFeedService({modelClass: TestSyncModel, params: {}})

    expect(() => service.recordValue(null, "id")).toThrow("Sync changes row must be an object.")
  })

  it("fails early when a sync row is missing an expected field", () => {
    const service = new SyncModelChangeFeedService({modelClass: TestSyncModel, params: {}})

    expect(() => service.recordValue({}, "id")).toThrow("Sync changes row is missing id.")
  })
})

/**
 * Builds a fake sync row exposing accessor methods like a real record.
 * @param {Record<string, unknown>} values - Row values by attribute name.
 * @returns {Record<string, () => unknown>} Fake sync row.
 */
function buildFakeRow(values) {
  return Object.fromEntries(Object.entries(values).map(([name, value]) => [name, () => value]))
}

const ROW_VALUES = {
  data: '{"title":"Row 1"}',
  id: "16fd2706-8baf-433b-82eb-8c7fada847da",
  resourceId: "0f8fad5b-d9cb-469f-a165-70867728950e",
  resourceType: "Task",
  serverSequence: 7,
  syncType: "update",
  updatedAt: new Date("2026-07-06T10:20:30.000Z")
}

describe("sync model change-feed service - scope-partition serialization", () => {
  it("serializes the sync model's declared scope attributes under their own names", () => {
    class ProjectScopedSyncModel {
      static syncScopeAttributes = ["projectId"]
    }

    const service = new SyncModelChangeFeedService({modelClass: /** @type {?} */ (ProjectScopedSyncModel), params: {}})
    const serialized = service.defaultSerializeRecord(buildFakeRow({...ROW_VALUES, projectId: "project-1"}))

    expect(serialized.projectId).toEqual("project-1")
    expect("eventId" in serialized).toEqual(false)
  })

  it("keeps the deprecated 1.0.503 eventId wire byte-identical for models declaring no scope attributes and for a declared eventId partition", () => {
    class EventScopedSyncModel {
      static syncScopeAttributes = ["eventId"]
    }

    const undeclaredService = new SyncModelChangeFeedService({modelClass: /** @type {?} */ (TestSyncModel), params: {}})
    const declaredService = new SyncModelChangeFeedService({modelClass: /** @type {?} */ (EventScopedSyncModel), params: {}})
    const row = buildFakeRow({...ROW_VALUES, eventId: "event-1"})
    const expectedWire = JSON.stringify({
      data: {title: "Row 1"},
      eventId: "event-1",
      id: ROW_VALUES.id,
      resourceId: ROW_VALUES.resourceId,
      resourceType: "Task",
      serverSequence: 7,
      syncType: "update",
      updatedAt: "2026-07-06T10:20:30.000Z"
    })

    expect(JSON.stringify(undeclaredService.defaultSerializeRecord(row))).toEqual(expectedWire)
    expect(JSON.stringify(declaredService.defaultSerializeRecord(row))).toEqual(expectedWire)
  })

  it("fails loudly when a sync row is missing a declared scope attribute", () => {
    class ProjectScopedSyncModel {
      static syncScopeAttributes = ["projectId"]
    }

    const service = new SyncModelChangeFeedService({modelClass: /** @type {?} */ (ProjectScopedSyncModel), params: {}})

    expect(() => service.defaultSerializeRecord(buildFakeRow(ROW_VALUES))).toThrow("Sync changes row is missing projectId.")
  })
})
