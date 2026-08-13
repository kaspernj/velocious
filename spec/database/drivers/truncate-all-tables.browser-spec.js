// @ts-check

import BaseDriver from "../../../src/database/drivers/base.js"
import BaseTable from "../../../src/database/drivers/base-table.js"
import Configuration from "../../../src/configuration.js"
import Migration from "../../../src/database/migration/index.js"
import MssqlDriver from "../../../src/database/drivers/mssql/index.js"
import MysqlDriver from "../../../src/database/drivers/mysql/index.js"
import PgsqlDriver from "../../../src/database/drivers/pgsql/index.js"
import {countSqlMessages, isTableListQuery, sqlMessages, withQueryLogOutput} from "../../helpers/query-log-helpers.js"
import {describe, expect, it} from "../../../src/testing/test.js"

/** @typedef {import("../../../src/database/drivers/base.js").default} Driver */

const BATCH_PARENT_TABLE = "truncate_batch_parents"
const BATCH_CHILD_TABLE = "truncate_batch_children"
const BATCH_IDENTITY_TABLE = "truncate_batch_identities"
const CACHE_FIRST_TABLE = "truncate_cache_first"
const CACHE_SECOND_TABLE = "truncate_cache_second"
const STALE_TABLE = "truncate_stale_table"
const STALE_LIVE_TABLE = "truncate_stale_live_table"

class TestTable extends BaseTable {
  /**
   * @param {object} args - Table setup.
   * @param {Driver} args.driver - Owning driver.
   * @param {Error} [args.error] - Error raised by truncate.
   * @param {string} args.name - Table name.
   */
  constructor({driver, error, name}) {
    super()
    this.driver = driver
    this.error = error
    this.name = name
    this.truncateCalls = 0
  }

  /** @returns {string} - Table name. */
  getName() { return this.name }

  /** @returns {Promise<[]>} - Empty query result. */
  async truncate() {
    this.truncateCalls++
    if (this.error) throw this.error
    return []
  }
}

class TruncateHarnessDriver extends BaseDriver {
  /** @type {BaseTable[][]} */
  tableSnapshots = []
  getTablesCalls = 0
  disableCalls = 0
  enableCalls = 0
  flushCalls = 0
  clearCalls = 0

  /** @returns {Promise<BaseTable[]>} - Next table snapshot. */
  async getTables() {
    const snapshot = this.tableSnapshots[Math.min(this.getTablesCalls, this.tableSnapshots.length - 1)] || []
    this.getTablesCalls++
    return snapshot
  }

  /** @returns {Promise<void>} - Resolves after recording the toggle. */
  async disableForeignKeys() { this.disableCalls++ }

  /** @returns {Promise<void>} - Resolves after recording the toggle. */
  async enableForeignKeys() { this.enableCalls++ }

  /** @returns {Promise<void>} - Resolves after recording the flush. */
  async flushPendingWrites() { this.flushCalls++ }

  /** @returns {void} - Records cache invalidation. */
  clearSchemaCache() { this.clearCalls++ }
}

class RecordingPgsqlDriver extends PgsqlDriver {
  /** @type {string[]} */
  queries = []

  /**
   * @param {string} sql - SQL string.
   * @returns {Promise<[]>} - Empty result.
   */
  async query(sql) { this.queries.push(sql); return [] }
}

class RecordingMssqlDriver extends MssqlDriver {
  /** @type {string[]} */
  queries = []

  /**
   * @param {string} sql - SQL string.
   * @returns {Promise<[]>} - Empty result.
   */
  async query(sql) { this.queries.push(sql); return [] }
}

class RecordingMysqlDriver extends MysqlDriver {
  /** @type {string[]} */
  queries = []

  /**
   * @param {string} sql - SQL string.
   * @returns {Promise<[]>} - Empty result.
   */
  async query(sql) { this.queries.push(sql); return [] }
}

/**
 * @param {Driver} driver - Database driver.
 * @param {string[]} tableNames - Tables to drop in dependency order.
 * @returns {Promise<void>} - Resolves when tables are absent.
 */
async function dropTables(driver, tableNames) {
  for (const tableName of tableNames) {
    await driver.dropTable(tableName, {cascade: true, ifExists: true})
  }
}

/**
 * @param {Driver} driver - Database driver.
 * @param {string} tableName - Table name.
 * @returns {Promise<number>} - Row count.
 */
async function tableRowCount(driver, tableName) {
  const rows = await driver.query(`SELECT COUNT(*) AS count FROM ${driver.quoteTable(tableName)}`)
  const count = rows[0]?.count

  if (typeof count !== "number" && typeof count !== "string") {
    throw new Error(`Expected numeric count for ${tableName}`)
  }

  return Number(count)
}

/**
 * @param {Driver} driver - Database driver.
 * @param {string} tableName - Table name.
 * @returns {Promise<bigint>} - Maximum identity value.
 */
async function maximumIdentity(driver, tableName) {
  const rows = await driver.query(`SELECT MAX(${driver.quoteColumn("id")}) AS id FROM ${driver.quoteTable(tableName)}`)
  const id = rows[0]?.id

  if (typeof id !== "number" && typeof id !== "string") {
    throw new Error(`Expected numeric identity for ${tableName}`)
  }

  return BigInt(id)
}

/**
 * @param {Driver} driver - Database driver.
 * @param {string[]} tableNames - Tables expected in cleanup SQL.
 * @param {string} message - SQL log message.
 * @returns {boolean} - Whether this is a cleanup request for one of the tables.
 */
function isCleanupRequest(driver, tableNames, message) {
  const cleanupSql = message.includes("TRUNCATE TABLE") || message.includes("DELETE FROM")
  return cleanupSql && tableNames.some((tableName) => message.includes(driver.quoteTable(tableName)))
}

describe("database - drivers - truncate all tables", {tags: ["dummy"], databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("batches cleanup while preserving rows, foreign keys, schema migrations, and identity semantics", async () => {
    const configuration = Configuration.current()

    await configuration.ensureConnections(async (dbs) => {
      const driver = dbs.default
      const migration = new Migration({configuration, databaseIdentifier: "default", db: driver})
      const cleanupOrder = [BATCH_CHILD_TABLE, BATCH_PARENT_TABLE, BATCH_IDENTITY_TABLE]

      await dropTables(driver, cleanupOrder)

      try {
        await migration.createTable(BATCH_PARENT_TABLE, {id: {type: "uuid"}}, (table) => {
          table.string("name", {null: false})
        })
        await migration.createTable(BATCH_CHILD_TABLE, {id: {type: "uuid"}}, (table) => {
          table.uuid("parent_id", {null: false})
          table.string("name", {null: false})
        })
        await migration.addForeignKey(BATCH_CHILD_TABLE, "parent", {
          columnName: "parent_id",
          name: "truncate_batch_parent_fk",
          referencedTableName: BATCH_PARENT_TABLE
        })
        await migration.createTable(BATCH_IDENTITY_TABLE, {id: {type: "bigint"}}, (table) => {
          table.string("name", {null: false})
        })

        await driver.query(`INSERT INTO ${driver.quoteTable(BATCH_PARENT_TABLE)} (${driver.quoteColumn("id")}, ${driver.quoteColumn("name")}) VALUES (${driver.quote("00000000-0000-4000-8000-000000000001")}, ${driver.quote("parent")})`)
        await driver.query(`INSERT INTO ${driver.quoteTable(BATCH_CHILD_TABLE)} (${driver.quoteColumn("id")}, ${driver.quoteColumn("parent_id")}, ${driver.quoteColumn("name")}) VALUES (${driver.quote("00000000-0000-4000-8000-000000000002")}, ${driver.quote("00000000-0000-4000-8000-000000000001")}, ${driver.quote("child")})`)
        await driver.query(`INSERT INTO ${driver.quoteTable(BATCH_IDENTITY_TABLE)} (${driver.quoteColumn("name")}) VALUES (${driver.quote("before")})`)

        const firstIdentity = await maximumIdentity(driver, BATCH_IDENTITY_TABLE)
        const migrationCount = await tableRowCount(driver, "schema_migrations")

        driver.clearSchemaCache()

        await withQueryLogOutput(async (arrayOutput) => {
          await driver.truncateAllTables()

          const cleanupMessages = sqlMessages(arrayOutput)
            .filter((message) => isCleanupRequest(driver, cleanupOrder, message))

          if (driver.getType() == "mysql" && !driver.getArgs().multipleStatements) {
            expect(cleanupMessages.length).toEqual(cleanupOrder.length)
          } else {
            expect(cleanupMessages.length).toEqual(1)
          }

          expect(cleanupMessages.some((message) => message.includes(driver.quoteTable("schema_migrations")))).toEqual(false)
        })

        expect(await tableRowCount(driver, BATCH_PARENT_TABLE)).toEqual(0)
        expect(await tableRowCount(driver, BATCH_CHILD_TABLE)).toEqual(0)
        expect(await tableRowCount(driver, "schema_migrations")).toEqual(migrationCount)

        await expect(async () => {
          await driver.query(`INSERT INTO ${driver.quoteTable(BATCH_CHILD_TABLE)} (${driver.quoteColumn("id")}, ${driver.quoteColumn("parent_id")}, ${driver.quoteColumn("name")}) VALUES (${driver.quote("00000000-0000-4000-8000-000000000003")}, ${driver.quote("00000000-0000-4000-8000-000000000099")}, ${driver.quote("invalid")})`)
        }).toThrow()

        await driver.query(`INSERT INTO ${driver.quoteTable(BATCH_IDENTITY_TABLE)} (${driver.quoteColumn("name")}) VALUES (${driver.quote("after")})`)
        const secondIdentity = await maximumIdentity(driver, BATCH_IDENTITY_TABLE)

        if (driver.getType() == "pgsql") {
          expect(secondIdentity > firstIdentity).toEqual(true)
        } else {
          expect(secondIdentity).toEqual(1n)
        }
      } finally {
        await dropTables(driver, cleanupOrder)
      }
    })
  })

  it("returns without foreign-key toggles, batching, or persistence flushing for an empty eligible schema", async () => {
    const driver = new TruncateHarnessDriver({}, Configuration.current())
    driver.tableSnapshots = [[new TestTable({driver, name: "schema_migrations"})]]

    await driver.truncateAllTables()

    expect(driver.getTablesCalls).toEqual(1)
    expect(driver.disableCalls).toEqual(0)
    expect(driver.enableCalls).toEqual(0)
    expect(driver.flushCalls).toEqual(0)
  })

  it("uses one cold table discovery, reuses a warm cache, and sees tables created after DDL invalidation", async () => {
    const configuration = Configuration.current()

    await configuration.ensureConnections(async (dbs) => {
      const driver = dbs.default
      const migration = new Migration({configuration, databaseIdentifier: "default", db: driver})
      const cleanupOrder = [CACHE_SECOND_TABLE, CACHE_FIRST_TABLE]

      await dropTables(driver, cleanupOrder)

      try {
        await migration.createTable(CACHE_FIRST_TABLE, {id: false}, (table) => table.string("name"))
        driver.clearSchemaCache()

        await withQueryLogOutput(async (arrayOutput) => {
          await driver.truncateAllTables()
          await driver.truncateAllTables()

          expect(countSqlMessages(arrayOutput, (message) => isTableListQuery(driver, message))).toEqual(1)

          await migration.createTable(CACHE_SECOND_TABLE, {id: false}, (table) => table.string("name"))
          await driver.query(`INSERT INTO ${driver.quoteTable(CACHE_SECOND_TABLE)} (${driver.quoteColumn("name")}) VALUES (${driver.quote("created after warm cache")})`)
          await driver.truncateAllTables()

          expect(countSqlMessages(arrayOutput, (message) => isTableListQuery(driver, message))).toEqual(2)
        })

        expect(await tableRowCount(driver, CACHE_SECOND_TABLE)).toEqual(0)
      } finally {
        await dropTables(driver, cleanupOrder)
      }
    })
  })

  it("clears stale table metadata after a failed batch and retries against the live schema", async () => {
    const configuration = Configuration.current()

    await configuration.ensureConnections(async (dbs) => {
      const driver = dbs.default
      const migration = new Migration({configuration, databaseIdentifier: "default", db: driver})
      const cleanupOrder = [STALE_TABLE, STALE_LIVE_TABLE]

      await dropTables(driver, cleanupOrder)

      try {
        await migration.createTable(STALE_TABLE, {id: false}, (table) => table.string("name"))
        await migration.createTable(STALE_LIVE_TABLE, {id: false}, (table) => table.string("name"))
        await driver.query(`INSERT INTO ${driver.quoteTable(STALE_LIVE_TABLE)} (${driver.quoteColumn("name")}) VALUES (${driver.quote("clean me")})`)
        driver.clearSchemaCache()
        await driver.getTables()

        await driver._queryActual(`DROP TABLE ${driver.quoteTable(STALE_TABLE)}`)

        await withQueryLogOutput(async (arrayOutput) => {
          await driver.truncateAllTables()

          expect(countSqlMessages(arrayOutput, (message) => isTableListQuery(driver, message))).toEqual(1)
          const cleanupRequestCount = sqlMessages(arrayOutput)
            .filter((message) => isCleanupRequest(driver, cleanupOrder, message))
            .length

          if (driver.getType() == "mysql" && !driver.getArgs().multipleStatements) {
            expect(cleanupRequestCount).toEqual(2)
          } else {
            expect(cleanupRequestCount).toEqual(1)
          }
        })

        expect(await tableRowCount(driver, STALE_LIVE_TABLE)).toEqual(0)
      } finally {
        await dropTables(driver, cleanupOrder)
      }
    })
  })

  it("retries six passes, preserves the first error in a pass, and restores foreign keys after exhaustion", async () => {
    const driver = new TruncateHarnessDriver({}, Configuration.current())
    const firstError = new Error("first truncate failure")
    const firstTable = new TestTable({driver, error: firstError, name: "first"})
    const secondTable = new TestTable({driver, error: new Error("second truncate failure"), name: "second"})

    driver.tableSnapshots = Array.from({length: 6}, () => [firstTable, secondTable])

    await expect(async () => await driver.truncateAllTables()).toThrow(firstError)

    expect(driver.getTablesCalls).toEqual(6)
    expect(driver.clearCalls).toEqual(5)
    expect(driver.disableCalls).toEqual(1)
    expect(driver.enableCalls).toEqual(1)
    expect(driver.flushCalls).toEqual(0)
    expect(firstTable.truncateCalls).toEqual(6)
    expect(secondTable.truncateCalls).toEqual(6)
  })

  it("builds the driver-specific batch without changing identity or fallback semantics", async () => {
    const configuration = Configuration.current()
    const pgsql = new RecordingPgsqlDriver({}, configuration)
    const pgsqlTables = [new TestTable({driver: pgsql, name: "one"}), new TestTable({driver: pgsql, name: "two"})]

    await pgsql.truncateTables(pgsqlTables)

    expect(pgsql.queries).toEqual(['TRUNCATE TABLE "one", "two" CASCADE'])
    expect(pgsql.queries[0].includes("RESTART IDENTITY")).toEqual(false)

    const mssql = new RecordingMssqlDriver({sqlConfig: {}}, configuration)
    const mssqlTables = [new TestTable({driver: mssql, name: "one"}), new TestTable({driver: mssql, name: "two"})]

    await mssql.truncateTables(mssqlTables)

    expect(mssql.queries.length).toEqual(1)
    expect(mssql.queries[0].match(/TRUNCATE TABLE/gu)?.length).toEqual(2)
    expect(mssql.queries[0].match(/ERROR_NUMBER\(\) = 4712/gu)?.length).toEqual(2)
    expect(mssql.queries[0].match(/DELETE FROM/gu)?.length).toEqual(2)
    expect(mssql.queries[0].match(/THROW/gu)?.length).toEqual(2)

    const mysqlBatched = new RecordingMysqlDriver({multipleStatements: true}, configuration)
    const mysqlBatchedTables = [new TestTable({driver: mysqlBatched, name: "one"}), new TestTable({driver: mysqlBatched, name: "two"})]

    await mysqlBatched.truncateTables(mysqlBatchedTables)

    expect(mysqlBatched.queries).toEqual(["TRUNCATE TABLE `one`;\nTRUNCATE TABLE `two`"])
    expect(mysqlBatchedTables.map((table) => table.truncateCalls)).toEqual([0, 0])

    const mysqlSequential = new RecordingMysqlDriver({multipleStatements: false}, configuration)
    const mysqlSequentialTables = [new TestTable({driver: mysqlSequential, name: "one"}), new TestTable({driver: mysqlSequential, name: "two"})]

    await mysqlSequential.truncateTables(mysqlSequentialTables)

    expect(mysqlSequential.queries).toEqual([])
    expect(mysqlSequentialTables.map((table) => table.truncateCalls)).toEqual([1, 1])
  })
})
