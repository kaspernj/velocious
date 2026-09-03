// @ts-check

import BackgroundJobsStore from "../../src/background-jobs/store.js"
import ChangeTableFakeDriver from "../helpers/change-table-fake-driver.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import {clearBackgroundJobs} from "../helpers/background-jobs-helper.js"

/** Store harness that isolates index repair from the migration ledger. */
class IndexRepairStore extends BackgroundJobsStore {
  /** @returns {Promise<boolean>} - The repair has not been recorded. */
  async _hasMigration() { return false }

  /** @returns {Promise<void>} - Resolves without recording the harness migration. */
  async _recordMigration() {}
}

/** SQLite harness whose advisory lock is intentionally process-local. */
class ProcessLocalIndexRepairDriver extends ChangeTableFakeDriver {
  constructor() {
    super({type: "sqlite"})
    this.setTable("background_jobs")
  }

  /** @returns {Promise<boolean>} - Acquires this harness's independent lock. */
  async _acquireAdvisoryLock() { return true }

  /** @returns {Promise<boolean>} - Releases this harness's independent lock. */
  async _releaseAdvisoryLock() { return true }
}

describe("Background jobs store index repair", {databaseCleaning: {transaction: true}}, () => {
  it("repairs indexes missing from an already-upgraded background jobs table", async () => {
    const store = await clearBackgroundJobs()
    const indexColumns = ["queue", "concurrency_key", "schedule_key"]
    const pool = dummyConfiguration.getDatabasePool(store.getDatabaseIdentifier())

    await pool.withConnection({name: "Background jobs remove upgraded indexes"}, async (db) => {
      const jobsTable = await db.getTableByNameOrFail("background_jobs")

      for (const columnName of indexColumns) {
        const index = (await jobsTable.getIndexes()).find((candidate) => {
          const columnNames = candidate.getColumnNames()

          return !candidate.isPrimaryKey() && columnNames.length === 1 && columnNames[0] === columnName
        })

        if (!index) continue

        for (const sql of await db.removeIndexSQLs({name: index.getName(), tableName: "background_jobs"})) {
          await db.query(sql)
        }
      }

      await db.delete({
        tableName: "velocious_internal_migrations",
        conditions: {key: "background_jobs:20260903120000"}
      })

      db.clearSchemaCache()
    })

    await new BackgroundJobsStore({configuration: dummyConfiguration}).ensureReady()

    await pool.withConnection({name: "Background jobs verify upgraded indexes"}, async (db) => {
      const jobsTable = await db.getTableByNameOrFail("background_jobs")
      const indexedColumns = (await jobsTable.getIndexes())
        .filter((index) => !index.isPrimaryKey() && index.getColumnNames().length === 1)
        .map((index) => index.getColumnNames()[0])

      for (const columnName of indexColumns) expect(indexedColumns).toContain(columnName)
    })
  })

  it("uses conflict-safe index creation for SQLite repair processes", async () => {
    const store = new IndexRepairStore({configuration: dummyConfiguration})
    const db = new ProcessLocalIndexRepairDriver()

    await store._ensureJobsTableIndexesOnce(db)

    expect(db.indexCalls.length).toBeGreaterThan(0)
    for (const indexCall of db.indexCalls) expect(indexCall.ifNotExists).toEqual(true)
  })
})
