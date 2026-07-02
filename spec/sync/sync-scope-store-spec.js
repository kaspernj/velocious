// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import {serializedScopeFromQuery} from "../../src/sync/query-scope.js"
import SyncScopeStore from "../../src/sync/sync-scope-store.js"
import Configuration from "../../src/configuration.js"
import Task from "../dummy/src/models/task.js"

/** @returns {SyncScopeStore} Store bound to the current (dummy) configuration. */
function buildStore() {
  return new SyncScopeStore({configuration: Configuration.current()})
}

describe("sync scope store", {tags: ["dummy"], databaseCleaning: {transaction: false, truncate: true}}, () => {
  it("stores an active scope row with no cursor when a scope is declared", async () => {
    const store = buildStore()
    const scope = serializedScopeFromQuery(Task.where({projectId: 5}))
    const scopeRow = await store.findOrCreateScope(scope)

    expect(scopeRow.resourceType).toEqual("Task")
    expect(scopeRow.conditions).toEqual({project_id: 5})
    expect(scopeRow.state).toEqual("active")
    expect(scopeRow.cursorPayload).toEqual(null)
  })

  it("reuses the existing scope row when the same scope is declared twice", async () => {
    const store = buildStore()
    const scope = serializedScopeFromQuery(Task.where({projectId: 5}))
    const firstRow = await store.findOrCreateScope(scope)
    const secondRow = await store.findOrCreateScope(serializedScopeFromQuery(Task.where({projectId: 5})))

    expect(secondRow.id).toEqual(firstRow.id)
    expect((await store.activeScopes()).length).toEqual(1)
  })

  it("persists cursors per scope independently", async () => {
    const store = buildStore()
    const firstScopeRow = await store.findOrCreateScope(serializedScopeFromQuery(Task.where({projectId: 5})))
    const secondScopeRow = await store.findOrCreateScope(serializedScopeFromQuery(Task.where({projectId: 6})))

    await store.saveCursor(firstScopeRow, {id: "sync-1", serverSequence: 11, updatedAt: "2026-07-01T10:00:00.000Z"})

    expect(JSON.parse(String(await store.loadCursor(firstScopeRow)))).toEqual({id: "sync-1", serverSequence: 11, updatedAt: "2026-07-01T10:00:00.000Z"})
    expect(await store.loadCursor(secondScopeRow)).toEqual(null)
  })

  it("stores long scope identities in a fixed-size digest key", async () => {
    const store = buildStore()
    const longName = "n".repeat(400)
    const scopeRow = await store.findOrCreateScope(serializedScopeFromQuery(Task.where({name: longName, projectId: 5})))

    expect(scopeRow.scopeDigest.length).toEqual(36)

    const reusedRow = await store.findOrCreateScope(serializedScopeFromQuery(Task.where({projectId: 5}).where({name: longName})))

    expect(reusedRow.id).toEqual(scopeRow.id)
    expect((await store.activeScopes()).length).toEqual(1)
  })

  it("deactivates and reactivates scopes", async () => {
    const store = buildStore()
    const scope = serializedScopeFromQuery(Task.where({projectId: 5}))

    await store.findOrCreateScope(scope)
    await store.deactivate(scope)

    expect((await store.activeScopes()).length).toEqual(0)

    const reactivatedRow = await store.findOrCreateScope(scope)

    expect(reactivatedRow.state).toEqual("active")
    expect((await store.activeScopes()).length).toEqual(1)
  })
})
