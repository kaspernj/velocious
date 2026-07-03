// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import ServerSequenceAllocator from "../../src/sync/server-sequence-allocator.js"
import Configuration from "../../src/configuration.js"
import SyncEntry from "../dummy/src/models/sync-entry.js"
import TableData from "../../src/database/table-data/index.js"

/** @returns {ServerSequenceAllocator} Allocator bound to the current (dummy) configuration. */
function buildAllocator() {
  return new ServerSequenceAllocator({configuration: Configuration.current()})
}

describe("server sequence allocator", {tags: ["dummy"], databaseCleaning: {transaction: false, truncate: true}}, () => {
  it("allocates strictly increasing sequences", async () => {
    const allocator = buildAllocator()
    const first = await allocator.next()
    const second = await allocator.next()
    const third = await allocator.next()

    expect(second).toBeGreaterThan(first)
    expect(third).toBeGreaterThan(second)
  })

  it("allocates distinct values for parallel allocations", async () => {
    const allocator = buildAllocator()
    const values = await Promise.all([allocator.next(), allocator.next(), allocator.next(), allocator.next(), allocator.next()])
    const distinctValues = new Set(values)

    expect(distinctValues.size).toEqual(5)

    for (const value of values) {
      expect(Number.isInteger(value)).toEqual(true)
    }
  })

  it("serializes allocations across allocator instances sharing a table", async () => {
    const firstAllocator = new ServerSequenceAllocator()
    const secondAllocator = new ServerSequenceAllocator()
    const values = await Promise.all([
      firstAllocator.next(),
      secondAllocator.next(),
      firstAllocator.next(),
      secondAllocator.next()
    ])

    expect(new Set(values).size).toEqual(4)
  })

  it("allocates from a custom bare table with an empty insert payload", async () => {
    // Mirrors ticket-server's existing `sync_server_sequences` table, which only has an AUTO_INCREMENT id column.
    await Configuration.current().ensureConnections({name: "Bare sequence table setup"}, async (dbs) => {
      const db = dbs.default

      if (await db.tableExists("bare_server_sequences")) return

      const table = new TableData("bare_server_sequences", {ifNotExists: true})

      table.bigint("id", {autoIncrement: true, null: false, primaryKey: true})

      await db.createTable(table)
    })

    const allocator = new ServerSequenceAllocator({configuration: Configuration.current(), insertData: {}, tableName: "bare_server_sequences"})
    const first = await allocator.next()
    const second = await allocator.next()

    expect(first).toBeGreaterThan(0)
    expect(second).toBeGreaterThan(first)
  })

  it("assigns a sequence on create through withServerSequence and leaves existing values", async () => {
    const entry = new SyncEntry({
      authenticationTokenId: "3f1c9f2e-6a52-4a8f-9a63-0f4b6f6c8a01",
      clientUpdatedAt: new Date("2026-07-03T10:00:00.000Z"),
      resourceId: "b7a1cbb2-4a0f-45c5-9d0a-2fd3a1f0b902",
      resourceType: "Task",
      syncType: "update"
    })

    await entry.save()

    const assignedSequence = entry.serverSequence()

    if (assignedSequence === null) throw new Error("Expected a server sequence to be assigned on create")

    expect(assignedSequence).toBeGreaterThan(0)

    const presetEntry = new SyncEntry({
      authenticationTokenId: "3f1c9f2e-6a52-4a8f-9a63-0f4b6f6c8a01",
      clientUpdatedAt: new Date("2026-07-03T10:00:00.000Z"),
      resourceId: "c9d2dcc3-5b10-46d6-8e1b-30e4b201ca13",
      resourceType: "Task",
      serverSequence: 123456,
      syncType: "update"
    })

    await presetEntry.save()

    expect(presetEntry.serverSequence()).toEqual(123456)
  })

  it("defines an advance method through withServerSequence", async () => {
    const entry = new SyncEntry({
      authenticationTokenId: "3f1c9f2e-6a52-4a8f-9a63-0f4b6f6c8a01",
      clientUpdatedAt: new Date("2026-07-03T10:00:00.000Z"),
      resourceId: "d1e3edd4-6c21-47e7-9f2c-41f5c312db24",
      resourceType: "Task",
      syncType: "update"
    })

    await entry.save()

    const initialSequence = entry.serverSequence()

    if (initialSequence === null) throw new Error("Expected a server sequence to be assigned on create")

    await entry.advanceServerSequence()
    await entry.save()

    const advancedSequence = entry.serverSequence()

    if (advancedSequence === null) throw new Error("Expected a server sequence after advancing")

    expect(advancedSequence).toBeGreaterThan(initialSequence)
  })
})
