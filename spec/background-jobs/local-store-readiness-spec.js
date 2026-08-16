// @ts-check

import LocalBackgroundJobsStore, {LOCAL_BACKGROUND_JOBS_INDEX_NAMES} from "../../src/background-jobs/local-store.js"
import Configuration from "../../src/configuration.js"
import {createTransactionalDdlReadinessConfiguration, expectTransactionalDdlTableRolledBack} from "../helpers/transactional-ddl-rollback-helper.js"
import {describe, expect, it} from "../../src/testing/test.js"
import sha256Hex from "../../src/utils/sha256-hex.js"

const JOBS_TABLE = "velocious_local_background_jobs"
const CONCURRENCY_TABLE = "velocious_local_background_job_concurrency"

/** @param {Configuration} configuration - Owning configuration. @returns {Promise<void>} - Resolves after local schema removal. */
async function dropLocalSchema(configuration) {
  await configuration.ensureConnections({name: "Local background jobs schema reset"}, async (dbs) => {
    await dbs.default.dropTable(CONCURRENCY_TABLE, {ifExists: true})
    await dbs.default.dropTable(JOBS_TABLE, {ifExists: true})
    if (await dbs.default.tableExists("velocious_internal_migrations")) {
      await dbs.default.delete({conditions: {scope: "local_background_jobs"}, tableName: "velocious_internal_migrations"})
    }
  })
}

/** Store that rejects its first schema application inside the real readiness lifecycle. */
class RejectFirstSchemaApplicationStore extends LocalBackgroundJobsStore {
  applySchemaAttempts = 0

  /**
   * @param {import("../../src/database/drivers/base.js").default} db - Local SQLite connection.
   * @returns {Promise<boolean>} - Whether schema state changed.
   */
  async _applySchema(db) {
    this.applySchemaAttempts++
    if (this.applySchemaAttempts === 1) throw new Error("Planned local schema readiness failure")

    return await super._applySchema(db)
  }
}

describe("Local background jobs store - readiness", {tags: ["dummy"], databaseCleaning: {transaction: false, truncate: true}}, () => {
  it("creates the namespaced versioned schema once and reopens it safely", async () => {
    const configuration = Configuration.current()

    await dropLocalSchema(configuration)

    const store = new LocalBackgroundJobsStore({configuration})

    await Promise.all([store.ensureReady(), store.ensureReady(), store.ensureReady()])

    await configuration.ensureConnections({name: "Local background jobs schema verification"}, async (dbs) => {
      expect(await dbs.default.tableExists(JOBS_TABLE)).toEqual(true)
      expect(await dbs.default.tableExists(CONCURRENCY_TABLE)).toEqual(true)

      const jobsTable = await dbs.default.getTableByNameOrFail(JOBS_TABLE)
      const indexes = await jobsTable.getIndexes()
      const primaryIndexes = indexes.filter((index) => index.isPrimaryKey())
      const secondaryIndexNames = indexes
        .filter((index) => !index.isPrimaryKey())
        .map((index) => index.getName())
        .sort()
      const argsDigestColumn = await jobsTable.getColumnByNameOrFail("args_digest")
      const deduplicationIndex = indexes.find((index) => index.getName() === LOCAL_BACKGROUND_JOBS_INDEX_NAMES[2])

      expect(primaryIndexes.map((index) => index.getColumnNames())).toEqual(dbs.default.getType() === "sqlite" ? [] : [["id"]])
      expect(secondaryIndexNames).toEqual([...LOCAL_BACKGROUND_JOBS_INDEX_NAMES].sort())
      expect(argsDigestColumn.getMaxLength()).toEqual(64)
      expect(deduplicationIndex?.getColumnNames()).toEqual(["args_digest"])
    })

    await new LocalBackgroundJobsStore({configuration}).ensureReady()
  })

  it("uses the bounded digest only to narrow exact queued-argument deduplication", async () => {
    const configuration = Configuration.current()

    await dropLocalSchema(configuration)

    const store = new LocalBackgroundJobsStore({configuration})
    const options = {deduplicateWhileQueued: true}
    const firstId = await store.enqueue({jobName: "CollisionJob", args: ["first"], options})
    const secondArgs = ["second"]
    const collidingDigest = sha256Hex(JSON.stringify(secondArgs))

    await configuration.ensureConnections({name: "Local background jobs digest collision setup"}, async (dbs) => {
      await dbs.default.update({
        conditions: {id: firstId},
        data: {args_digest: collidingDigest},
        tableName: JOBS_TABLE
      })
    })

    const secondId = await store.enqueue({jobName: "CollisionJob", args: secondArgs, options})

    expect(secondId).not.toEqual(firstId)
    expect((await store.getJob(secondId))?.args).toEqual(secondArgs)
  })

  it("repairs a missing current-version index without replacing stored jobs", async () => {
    const configuration = Configuration.current()
    const store = new LocalBackgroundJobsStore({configuration})

    await store.ensureReady()
    const jobId = await store.enqueue({jobName: "ReadyJob", args: [1]})

    await configuration.ensureConnections({name: "Local background jobs index removal"}, async (dbs) => {
      const sqls = await dbs.default.removeIndexSQLs({name: LOCAL_BACKGROUND_JOBS_INDEX_NAMES[0], tableName: JOBS_TABLE})

      for (const sql of sqls) await dbs.default.query(sql)
      dbs.default.clearSchemaCache()
    })

    await new LocalBackgroundJobsStore({configuration}).ensureReady()

    expect((await new LocalBackgroundJobsStore({configuration}).getJob(jobId))?.id).toEqual(jobId)
  })

  it("does not latch schema readiness created inside a rolled-back transaction", async () => {
    const {cleanup, configuration} = await createTransactionalDdlReadinessConfiguration("local-background-jobs-readiness")
    const store = new LocalBackgroundJobsStore({configuration})

    try {
      await expect(async () => {
        await configuration.ensureConnections({name: "Local background jobs rollback owner"}, async (dbs) => {
          await dbs.default.transaction(async () => {
            await store.ensureReady()
            throw new Error("Rolls back local background jobs schema")
          })
        })
      }).toThrow("Rolls back local background jobs schema")

      await expectTransactionalDdlTableRolledBack(configuration, "Local background jobs rollback verification", JOBS_TABLE)
      await store.ensureReady()

      await configuration.ensureConnections({name: "Local background jobs recreated schema"}, async (dbs) => {
        expect(await dbs.default.tableExists(JOBS_TABLE)).toEqual(true)
      })
    } finally {
      await cleanup()
    }
  })

  it("retries schema readiness after an ambient transaction attempt rejects", async () => {
    const configuration = Configuration.current()

    await dropLocalSchema(configuration)

    const store = new RejectFirstSchemaApplicationStore({configuration})

    await configuration.ensureConnections({name: "Local background jobs failed readiness owner"}, async (dbs) => {
      await dbs.default.transaction(async () => {
        await expect(async () => await store.ensureReady()).toThrow("Planned local schema readiness failure")
        await store.ensureReady()
      })
    })

    expect(store.applySchemaAttempts).toEqual(2)
    await configuration.ensureConnections({name: "Local background jobs retried schema verification"}, async (dbs) => {
      expect(await dbs.default.tableExists(JOBS_TABLE)).toEqual(true)
    })
  })
})
