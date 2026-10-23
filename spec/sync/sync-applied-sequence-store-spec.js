// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import Configuration from "../../src/configuration.js"
import SyncAppliedSequenceStore from "../../src/sync/sync-applied-sequence-store.js"

/**
 * Builds a store bound to the current (dummy) configuration.
 * @returns {SyncAppliedSequenceStore} Applied-sequence store.
 */
function buildStore() {
  return new SyncAppliedSequenceStore({configuration: Configuration.current()})
}

describe("sync applied sequence store", {tags: ["dummy"], databaseCleaning: {transaction: false, truncate: true}}, () => {
  it("keeps the highest applied sequence per resource identity", async () => {
    const store = buildStore()
    const resourceId = "spec-applied-sequence-ticket"

    expect(await store.lastAppliedSequence({resourceType: "Ticket", resourceId})).toEqual(null)

    await store.recordAppliedSequence({resourceId, resourceType: "Ticket", serverSequence: 5})

    expect(await store.lastAppliedSequence({resourceType: "Ticket", resourceId})).toEqual(5)

    // A lower sequence never moves the watermark backwards.
    await store.recordAppliedSequence({resourceId, resourceType: "Ticket", serverSequence: 3})

    expect(await store.lastAppliedSequence({resourceType: "Ticket", resourceId})).toEqual(5)

    await store.recordAppliedSequence({resourceId, resourceType: "Ticket", serverSequence: 7})

    expect(await store.lastAppliedSequence({resourceType: "Ticket", resourceId})).toEqual(7)

    // Another resource type or id keeps its own watermark.
    expect(await store.lastAppliedSequence({resourceType: "TicketScan", resourceId})).toEqual(null)
    expect(await store.lastAppliedSequence({resourceType: "Ticket", resourceId: "spec-applied-sequence-other"})).toEqual(null)
  })
})
