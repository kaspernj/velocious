// @ts-check

import { describe, expect, it } from "../../src/testing/test.js"
import { deferred } from "awaitery"
import Configuration from "../../src/configuration.js"
import ServerChangeFeedStore from "../../src/sync/server-change-feed.js"
import { createTransactionalDdlReadinessConfiguration, expectTransactionalDdlTableRolledBack, supportsTransactionalDdlRollback } from "../helpers/transactional-ddl-rollback-helper.js"
import Task from "../dummy/src/models/task.js"

describe("server change-feed store", {tags: ["dummy"], databaseCleaning: {transaction: false, truncate: true}}, () => {
  it("recreates its table after transactional creation rolls back", async () => {
    const configuration = Configuration.current()

    await configuration.ensureConnections({name: "Server change-feed rollback setup"}, async (dbs) => {
      await dbs.default.dropTable("frontend_model_sync_changes", {ifExists: true})
    })

    const store = new ServerChangeFeedStore({configuration})

    await expect(async () => {
      await Task.transaction(async () => {
        await store.append({
          actorDeviceId: null,
          actorUserId: null,
          attributes: null,
          idempotencyKey: null,
          model: "Task",
          operation: "update",
          payload: null,
          recordId: "task-1",
          response: null,
          scope: null
        })
        await store.append({
          actorDeviceId: null,
          actorUserId: null,
          attributes: null,
          idempotencyKey: null,
          model: "Task",
          operation: "update",
          payload: null,
          recordId: "task-2",
          response: null,
          scope: null
        })

        expect(store._isReady).toEqual(false)
        throw new Error("Rolls back server change-feed table creation")
      })
    }).toThrow("Rolls back server change-feed table creation")

    expect(store._isReady).toEqual(false)

    await expectTransactionalDdlTableRolledBack(configuration, "Server change-feed rollback verification", "frontend_model_sync_changes")

    const latestSequence = await store.latestSequence()

    expect(Number.isInteger(latestSequence)).toEqual(true)
    if (await supportsTransactionalDdlRollback(configuration)) expect(latestSequence).toEqual(0)

    await configuration.ensureConnections({name: "Server change-feed readiness verification"}, async (dbs) => {
      expect(await dbs.default.tableExists("frontend_model_sync_changes")).toEqual(true)
    })
  })

  it("keeps another connection waiting for durable readiness", async () => {
    const {cleanup, configuration} = await createTransactionalDdlReadinessConfiguration("change-feed-readiness")
    const ddlCanFinish = deferred()
    const ddlFinished = deferred()
    const transactionCanFinish = deferred()
    const transactionOperationFinished = deferred()

    class ControlledServerChangeFeedStore extends ServerChangeFeedStore {
      /** @param {import("../../src/database/drivers/base.js").default} db - Database connection. @returns {Promise<boolean>} Whether created. */
      async _ensureChangesTable(db) {
        const created = await super._ensureChangesTable(db)

        ddlFinished.resolve(undefined)
        await ddlCanFinish.promise

        return created
      }
    }

    const store = new ControlledServerChangeFeedStore({configuration})
    const transactionResult = configuration.withConnections({name: "Change-feed readiness owner"}, async (dbs) => {
      try {
        await dbs.default.transaction(async () => {
          await store.ensureReady()
          transactionOperationFinished.resolve(undefined)
          await transactionCanFinish.promise
          throw new Error("Rolls back controlled change-feed readiness")
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
      expect(transactionError instanceof Error ? transactionError.message : "").toEqual("Rolls back controlled change-feed readiness")
      await concurrentCall
      expect(store._isReady).toEqual(true)
    } finally {
      ddlCanFinish.resolve(undefined)
      transactionCanFinish.resolve(undefined)
      await transactionResult
      await cleanup()
    }
  })

  it("publishes durable readiness immediately when a transaction finds the table", async () => {
    const {cleanup, configuration} = await createTransactionalDdlReadinessConfiguration("change-feed-existing-readiness")
    const setupStore = new ServerChangeFeedStore({configuration})

    try {
      await setupStore.ensureReady()

      const store = new ServerChangeFeedStore({configuration})

      await configuration.withConnections({name: "Change-feed existing-table owner"}, async (dbs) => {
        await dbs.default.transaction(async () => {
          await store.ensureReady()

          expect(store._isReady).toEqual(true)

          const concurrentStarted = deferred()
          const concurrentCall = configuration.withoutCurrentConnectionContexts(async () => {
            concurrentStarted.resolve(undefined)
            await store.ensureReady()
          })

          await concurrentStarted.promise
          await concurrentCall
        })
      })
    } finally {
      await cleanup()
    }
  })
})
