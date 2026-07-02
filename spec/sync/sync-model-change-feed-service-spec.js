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
