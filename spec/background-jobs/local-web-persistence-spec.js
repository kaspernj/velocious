// @ts-check

import path from "node:path"
import {fileURLToPath} from "node:url"
import initSqlJs from "sql.js"

import LocalBackgroundJobsStore from "../../src/background-jobs/local-store.js"
import Configuration from "../../src/configuration.js"
import ConnectionSqlJs from "../../src/database/drivers/sqlite/connection-sql-js.js"
import TableData from "../../src/database/table-data/index.js"
import TableIndex from "../../src/database/table-data/table-index.js"
import SqliteWebDriver from "../../src/database/drivers/sqlite/index.web.js"
import SingleMultiUsePool from "../../src/database/pool/single-multi-use.js"
import BrowserEnvironmentHandler from "../../src/environment-handlers/browser.js"
import {describe, expect, it} from "../../src/testing/test.js"

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
/** @type {Map<string, Uint8Array>} */
const persistedDatabases = new Map()
/** @type {import("sql.js").SqlJsStatic | undefined} */
let SQL

/** Test driver retaining production ConnectionSqlJs persistence semantics across configurations. */
class PersistentLocalJobsSqliteWebDriver extends SqliteWebDriver {
  /** @returns {Promise<void>} - Resolves after restoring persisted SQL.js bytes. */
  async connect() {
    this.args = this.getArgs()
    SQL ||= await initSqlJs({locateFile: (file) => path.join(projectRoot, "node_modules/sql.js/dist", file)})

    const databaseName = this.databaseName()
    const bytes = persistedDatabases.get(databaseName)
    const persistence = {
      name: /** @type {"localstorage"} */ ("localstorage"),
      delete: async () => { persistedDatabases.delete(databaseName) },
      load: async () => persistedDatabases.get(databaseName),
      save: async (content) => { persistedDatabases.set(databaseName, new Uint8Array(content)) }
    }

    this._connection = new ConnectionSqlJs(this, new SQL.Database(bytes), persistence)
  }
}

/** @param {string} databaseName - Persisted database name. @returns {Configuration} - Isolated browser configuration. */
function buildConfiguration(databaseName) {
  return new Configuration({
    backgroundJobs: {databaseIdentifier: "default", jobClasses: []},
    database: {
      test: {
        default: {
          driver: PersistentLocalJobsSqliteWebDriver,
          migrations: false,
          name: databaseName,
          poolType: SingleMultiUsePool,
          type: "sqlite"
        }
      }
    },
    directory: projectRoot,
    environment: "test",
    environmentHandler: new BrowserEnvironmentHandler(),
    initializeModels: async () => {},
    locale: "en",
    localeFallbacks: {en: ["en"]},
    locales: ["en"]
  })
}

/** @returns {TableData} - Exact local background-job schema-v1 jobs table. */
function localJobsV1TableData() {
  const table = new TableData("velocious_local_background_jobs")

  table.string("id", {null: false, primaryKey: true})
  table.string("job_name", {null: false})
  table.text("args_json", {null: false})
  table.string("args_digest", {maxLength: 64, null: false})
  table.string("execution_mode", {null: false})
  table.string("queue", {null: false})
  table.integer("max_retries", {null: false})
  table.integer("attempts", {null: false})
  table.string("status", {null: false})
  table.bigint("scheduled_at_ms", {null: false})
  table.bigint("created_at_ms", {null: false})
  table.bigint("handed_off_at_ms", {null: true})
  table.string("handoff_id", {null: true})
  table.string("worker_id", {null: true})
  table.bigint("completed_at_ms", {null: true})
  table.bigint("failed_at_ms", {null: true})
  table.text("last_error", {null: true})
  table.string("concurrency_key", {null: true})
  table.integer("max_concurrency", {null: true})
  table.bigint("child_received_at_ms", {null: true})
  table.bigint("child_started_at_ms", {null: true})
  table.string("child_instance_id", {null: true})
  table.integer("child_pid", {null: true})
  table.addIndex(new TableIndex(["status", "scheduled_at_ms", "created_at_ms", "id"], {name: "index_velocious_local_background_jobs_due"}))
  table.addIndex(new TableIndex(["queue", "status", "created_at_ms"], {name: "index_velocious_local_background_jobs_queue_status"}))
  table.addIndex(new TableIndex(["args_digest"], {name: "index_velocious_local_background_jobs_deduplication"}))
  table.addIndex(new TableIndex(["status", "concurrency_key", "scheduled_at_ms"], {name: "index_velocious_local_background_jobs_concurrency"}))
  return table
}

/**
 * Persists a version-one local queue with active rows before framework upgrade.
 * @param {Configuration} configuration - Isolated Browser configuration.
 * @returns {Promise<void>} - Resolves after the v1 image is durable.
 */
async function seedLocalJobsV1(configuration) {
  await configuration.ensureConnections({name: "Seed local background jobs schema v1"}, async (dbs) => {
    const db = dbs.default
    const migrations = new TableData("velocious_internal_migrations")
    const concurrency = new TableData("velocious_local_background_job_concurrency")

    migrations.string("key", {null: false, primaryKey: true})
    migrations.string("scope", {null: false})
    migrations.string("version", {null: false})
    migrations.bigint("applied_at_ms", {null: false})
    concurrency.string("concurrency_key", {null: false, primaryKey: true})
    concurrency.integer("max_concurrency", {null: false})
    concurrency.integer("active_count", {null: false})

    await db.createTable(migrations)
    await db.createTable(localJobsV1TableData())
    await db.createTable(concurrency)
    await db.insert({
      tableName: "velocious_internal_migrations",
      data: {applied_at_ms: 1_000, key: "local_background_jobs:1", scope: "local_background_jobs", version: "1"}
    })

    const common = {
      args_digest: "0".repeat(64),
      attempts: 0,
      execution_mode: "inline",
      max_retries: 3,
      queue: "default",
      scheduled_at_ms: 2_000
    }

    await db.insert({
      tableName: "velocious_local_background_jobs",
      data: {...common, args_json: "[\"queued-v1\"]", created_at_ms: 1_000, id: "queued-v1", job_name: "PersistedLocalJob", status: "queued"}
    })
    await db.insert({
      tableName: "velocious_local_background_jobs",
      data: {
        ...common,
        args_json: "[\"handed-off-v1\"]",
        created_at_ms: 1_001,
        handed_off_at_ms: 1_500,
        handoff_id: "v1-handoff",
        id: "handed-off-v1",
        job_name: "PersistedLocalJob",
        status: "handed_off",
        worker_id: "v1-worker"
      }
    })
  })

  await configuration.closeDatabaseConnections()
}

/**
 * Advances the persisted v1 fixture to the exact stable-schedule v2 shape.
 * @param {Configuration} configuration - Isolated Browser configuration.
 * @returns {Promise<void>} - Resolves after the v2 image is durable.
 */
async function advanceLocalJobsToV2(configuration) {
  await configuration.ensureConnections({name: "Advance local background jobs schema to v2"}, async (dbs) => {
    const db = dbs.default
    const jobsAlteration = new TableData("velocious_local_background_jobs")
    const owners = new TableData("velocious_local_background_job_schedule_keys")

    jobsAlteration.string("schedule_key", {null: true})
    for (const sql of await db.alterTableSQLs(jobsAlteration)) await db.query(sql)

    owners.string("schedule_key", {null: false, primaryKey: true})
    owners.string("job_id", {null: false})
    owners.addIndex(new TableIndex(["job_id"], {name: "index_velocious_local_background_job_schedule_keys_job"}))
    await db.createTable(owners)

    const historyIndexes = await db.createIndexSQLs({
      columns: ["schedule_key", "created_at_ms", "id"],
      name: "index_velocious_local_background_jobs_schedule_history",
      tableName: "velocious_local_background_jobs"
    })

    for (const sql of historyIndexes) await db.query(sql)
    await db.update({
      conditions: {id: "queued-v1"},
      data: {schedule_key: "persisted:v2-owner"},
      tableName: "velocious_local_background_jobs"
    })
    await db.insert({
      data: {job_id: "queued-v1", schedule_key: "persisted:v2-owner"},
      tableName: "velocious_local_background_job_schedule_keys"
    })
    await db.insert({
      data: {applied_at_ms: 2_000, key: "local_background_jobs:2", scope: "local_background_jobs", version: "2"},
      tableName: "velocious_internal_migrations"
    })
  })

  await configuration.closeDatabaseConnections()
}

describe("Local background jobs store - SQL.js persistence", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("retains queued local jobs across a configured SQL.js persistence reopen", async () => {
    const databaseName = `local-background-jobs-persistence-${Date.now()}`
    const firstConfiguration = buildConfiguration(databaseName)
    const firstStore = new LocalBackgroundJobsStore({configuration: firstConfiguration})
    let secondConfiguration

    try {
      const jobId = await firstStore.enqueue({jobName: "PersistedLocalJob", args: ["saved"]})

      await firstConfiguration.closeDatabaseConnections()

      secondConfiguration = buildConfiguration(databaseName)

      const reopenedStore = new LocalBackgroundJobsStore({configuration: secondConfiguration})
      const reopenedJob = await reopenedStore.getJob(jobId)

      expect(reopenedJob?.status).toEqual("queued")
      expect(reopenedJob?.args).toEqual(["saved"])
    } finally {
      await firstConfiguration.closeDatabaseConnections()
      if (secondConfiguration) await secondConfiguration.closeDatabaseConnections()
      persistedDatabases.delete(databaseName)
    }
  })

  it("migrates a persisted v1 queue through v3 without losing queued or handed-off rows", async () => {
    const databaseName = `local-background-jobs-v1-upgrade-${Date.now()}`
    const firstConfiguration = buildConfiguration(databaseName)
    let secondConfiguration

    try {
      await seedLocalJobsV1(firstConfiguration)

      secondConfiguration = buildConfiguration(databaseName)

      const upgradedStore = new LocalBackgroundJobsStore({configuration: secondConfiguration})

      await upgradedStore.ensureReady()
      expect(await upgradedStore.getJob("queued-v1")).toMatchObject({args: ["queued-v1"], scheduleOrder: null, status: "queued"})
      expect(await upgradedStore.getJob("handed-off-v1")).toMatchObject({
        args: ["handed-off-v1"],
        handedOffAtMs: 1_500,
        handoffId: "v1-handoff",
        scheduleOrder: null,
        status: "handed_off",
        workerId: "v1-worker"
      })

      await secondConfiguration.ensureConnections({name: "Inspect local background jobs schema v3"}, async (dbs) => {
        const jobsTable = await dbs.default.getTableByNameOrFail("velocious_local_background_jobs")
        const ownerTable = await dbs.default.getTableByNameOrFail("velocious_local_background_job_schedule_keys")
        const versionTwoRows = await dbs.default
          .newQuery()
          .from("velocious_internal_migrations")
          .where({key: "local_background_jobs:2"})
          .results()
        const versionThreeRows = await dbs.default
          .newQuery()
          .from("velocious_internal_migrations")
          .where({key: "local_background_jobs:3"})
          .results()
        const jobIndexNames = (await jobsTable.getIndexes()).map((index) => index.getName())

        expect((await jobsTable.getColumnByName("schedule_key"))?.getName()).toEqual("schedule_key")
        expect((await jobsTable.getColumnByName("schedule_order"))?.getName()).toEqual("schedule_order")
        expect(jobIndexNames).toContain("index_velocious_local_background_jobs_schedule_history")
        expect(jobIndexNames).toContain("index_velocious_local_background_jobs_schedule_order")
        expect(ownerTable.getName()).toEqual("velocious_local_background_job_schedule_keys")
        expect((await ownerTable.getColumnByName("schedule_key"))?.getPrimaryKey()).toEqual(true)
        expect((await ownerTable.getIndexes()).map((index) => index.getName())).toContain("index_velocious_local_background_job_schedule_keys_job")
        expect(versionTwoRows).toHaveLength(1)
        expect(versionThreeRows).toHaveLength(1)
      })
    } finally {
      await firstConfiguration.closeDatabaseConnections()
      if (secondConfiguration) await secondConfiguration.closeDatabaseConnections()
      persistedDatabases.delete(databaseName)
    }
  })

  it("migrates a persisted v2 owner to v3 without losing its row or ownership", async () => {
    const databaseName = `local-background-jobs-v2-upgrade-${Date.now()}`
    const firstConfiguration = buildConfiguration(databaseName)
    let secondConfiguration

    try {
      await seedLocalJobsV1(firstConfiguration)
      await advanceLocalJobsToV2(firstConfiguration)

      secondConfiguration = buildConfiguration(databaseName)

      const upgradedStore = new LocalBackgroundJobsStore({configuration: secondConfiguration})

      await upgradedStore.ensureReady()
      expect(await upgradedStore.getScheduledJob("persisted:v2-owner", {includeLatestTerminal: true})).toMatchObject({
        currentJob: {args: ["queued-v1"], id: "queued-v1", scheduleOrder: null, status: "queued"},
        latestTerminalJob: null
      })

      await secondConfiguration.ensureConnections({name: "Inspect upgraded local background jobs schema v3"}, async (dbs) => {
        const jobsTable = await dbs.default.getTableByNameOrFail("velocious_local_background_jobs")
        const versionThreeRows = await dbs.default
          .newQuery()
          .from("velocious_internal_migrations")
          .where({key: "local_background_jobs:3"})
          .results()

        expect((await jobsTable.getColumnByName("schedule_order"))?.getName()).toEqual("schedule_order")
        expect((await jobsTable.getIndexes()).map((index) => index.getName())).toContain("index_velocious_local_background_jobs_schedule_order")
        expect(versionThreeRows).toHaveLength(1)
      })
    } finally {
      await firstConfiguration.closeDatabaseConnections()
      if (secondConfiguration) await secondConfiguration.closeDatabaseConnections()
      persistedDatabases.delete(databaseName)
    }
  })
})
