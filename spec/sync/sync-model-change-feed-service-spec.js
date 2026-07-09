import {describe, expect, it} from "../../src/testing/test.js"
import SyncEntry from "../dummy/src/models/sync-entry.js"
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

const SYNC_ENTRY_RESOURCE_IDS = [
  "b7a1cbb2-4a0f-45c5-9d0a-2fd3a1f0b902",
  "c9d2dcc3-5b10-46d6-8e1b-30e4b201ca13",
  "d1e3edd4-6c21-47e7-9f2c-41f5c312db24"
]

/**
 * Creates ordered dummy sync entries with strictly increasing server sequences.
 * @param {number} count - Number of rows to create.
 * @returns {Promise<Array<SyncEntry>>} Created rows in creation order.
 */
async function createSyncEntries(count) {
  /** @type {Array<SyncEntry>} */
  const entries = []

  for (let index = 0; index < count; index++) {
    entries.push(await SyncEntry.create({
      resourceId: SYNC_ENTRY_RESOURCE_IDS[index],
      resourceType: "Task",
      syncType: "update"
    }))
  }

  return entries
}

describe("sync model change-feed service - total pending count", {databaseCleaning: {transaction: false, truncate: true}, tags: ["dummy"]}, () => {
  it("returns the scope's total pending change count from the cursor alongside the page", async () => {
    await createSyncEntries(3)

    const service = new SyncModelChangeFeedService({modelClass: SyncEntry, params: {}})
    const result = await service.changes()

    expect(result.total).toEqual(3)
    expect(result.syncs.length).toEqual(3)
  })

  it("counts only the rows after the request cursor without materializing them", async () => {
    const entries = await createSyncEntries(3)
    const firstSequence = entries[0].serverSequence()

    if (firstSequence === null) throw new Error("Expected a server sequence to be assigned on create")

    const service = new SyncModelChangeFeedService({modelClass: SyncEntry, params: {afterServerSequence: firstSequence}})
    const result = await service.changes()

    expect(result.total).toEqual(2)
    expect(result.syncs.length).toEqual(2)
  })

  it("reports a total of 0 when there is nothing to sync", async () => {
    const service = new SyncModelChangeFeedService({modelClass: SyncEntry, params: {}})
    const result = await service.changes()

    expect(result.total).toEqual(0)
    expect(result.upToCursor).toEqual(null)
  })
})
