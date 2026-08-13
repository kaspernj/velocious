// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import {deferred} from "awaitery"
import {serializedScopeFromQuery} from "../../src/sync/query-scope.js"
import SyncScopeStore from "../../src/sync/sync-scope-store.js"
import Configuration from "../../src/configuration.js"
import {createTransactionalDdlReadinessConfiguration, expectTransactionalDdlTableRolledBack} from "../helpers/transactional-ddl-rollback-helper.js"
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

  it("recreates its table after transactional creation rolls back", async () => {
    const configuration = Configuration.current()

    await configuration.ensureConnections({name: "Sync scope rollback setup"}, async (dbs) => {
      await dbs.default.dropTable("velocious_sync_scopes", {ifExists: true})
    })

    const store = buildStore()
    const scope = serializedScopeFromQuery(Task.where({projectId: 5}))

    await expect(async () => {
      await Task.transaction(async () => {
        await store.findOrCreateScope(scope)
        await store.findOrCreateScope(scope)

        expect(store._isReady).toEqual(false)
        throw new Error("Rolls back sync scope table creation")
      })
    }).toThrow("Rolls back sync scope table creation")

    expect(store._isReady).toEqual(false)

    await expectTransactionalDdlTableRolledBack(configuration, "Sync scope rollback verification", "velocious_sync_scopes")

    const scopeRow = await store.findOrCreateScope(scope)

    expect(scopeRow.resourceType).toEqual("Task")

    await configuration.ensureConnections({name: "Sync scope readiness verification"}, async (dbs) => {
      expect(await dbs.default.tableExists("velocious_sync_scopes")).toEqual(true)
    })
  })

  it("keeps another connection waiting for durable readiness", async () => {
    const {cleanup, configuration} = await createTransactionalDdlReadinessConfiguration("sync-scope-readiness")
    const ddlCanFinish = deferred()
    const ddlFinished = deferred()
    const transactionCanFinish = deferred()
    const transactionOperationFinished = deferred()

    class ControlledSyncScopeStore extends SyncScopeStore {
      /** @param {import("../../src/database/drivers/base.js").default} db - Database connection. @returns {Promise<boolean>} Whether created. */
      async _ensureScopesTable(db) {
        const created = await super._ensureScopesTable(db)

        ddlFinished.resolve(undefined)
        await ddlCanFinish.promise

        return created
      }
    }

    const store = new ControlledSyncScopeStore({configuration})
    const transactionResult = configuration.withConnections({name: "Sync scope readiness owner"}, async (dbs) => {
      try {
        await dbs.default.transaction(async () => {
          await store.ensureReady()
          transactionOperationFinished.resolve(undefined)
          await transactionCanFinish.promise
          throw new Error("Rolls back controlled sync scope readiness")
        })
      } catch (error) {
        return error
      }
    })

    try {
      await ddlFinished.promise

      let concurrentReady = false
      const concurrentCall = configuration.withoutCurrentConnectionContexts(async () => {
        await store.ensureReady()
        concurrentReady = true
      })

      ddlCanFinish.resolve(undefined)
      await transactionOperationFinished.promise
      await Promise.resolve()

      expect(concurrentReady).toEqual(false)

      transactionCanFinish.resolve(undefined)

      const transactionError = await transactionResult

      expect(transactionError).toBeInstanceOf(Error)
      expect(transactionError instanceof Error ? transactionError.message : "").toEqual("Rolls back controlled sync scope readiness")
      await concurrentCall
      expect(store._isReady).toEqual(true)
    } finally {
      ddlCanFinish.resolve(undefined)
      transactionCanFinish.resolve(undefined)
      await transactionResult
      await cleanup()
    }
  })
})
