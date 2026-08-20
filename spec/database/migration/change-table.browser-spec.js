// @ts-check

import Configuration from "../../../src/configuration.js"
import Migration from "../../../src/database/migration/index.js"
import {describe, expect, it} from "../../../src/testing/test.js"

const tableName = "change_table_journal_entries"

const sentinelRowId = "a1b2c3d4-e5f6-4890-abcd-000000000001"
const addedRowId = "a1b2c3d4-e5f6-4890-abcd-000000000002"

const addedColumnNames = [
  "correlated_at",
  "first_github_check_created_at",
  "first_github_check_run_id",
  "first_github_check_url"
]

const addedIndexNames = [
  "index_github_delivery_journal_on_first_check_received",
  "index_github_delivery_journal_on_first_check_run",
  "index_github_delivery_journal_on_received",
  "index_github_delivery_journal_on_commit_sha"
]

/**
 * Builds a migration for the dummy database.
 * @param {import("../../../src/database/drivers/base.js").default} driver - Database driver.
 * @param {import("../../../src/configuration.js").default} configuration - Configuration instance.
 * @returns {Migration} - The migration instance.
 */
function buildMigration(driver, configuration) {
  return new Migration({configuration, databaseIdentifier: "default", db: driver})
}

/**
 * Asserts the four added columns exist on the table.
 * @param {import("../../../src/database/drivers/base-table.js").default} table - Table metadata.
 * @returns {Promise<void>} - Resolves when complete.
 */
async function expectAddedColumns(table) {
  const columnNames = (await table.getColumns()).map((column) => column.getName())

  for (const columnName of addedColumnNames) {
    expect(columnNames).toContain(columnName)
  }
}

/**
 * Asserts the four added indexes exist on the table.
 * @param {import("../../../src/database/drivers/base-table.js").default} table - Table metadata.
 * @returns {Promise<void>} - Resolves when complete.
 */
async function expectAddedIndexes(table) {
  const indexNames = (await table.getIndexes()).map((index) => index.getName())

  for (const indexName of addedIndexNames) {
    expect(indexNames).toContain(indexName)
  }
}

/**
 * Asserts the four added columns and indexes are gone while the originals remain.
 * @param {import("../../../src/database/drivers/base-table.js").default} table - Table metadata.
 * @returns {Promise<void>} - Resolves when complete.
 */
async function expectAdditionsRemoved(table) {
  const columnNames = (await table.getColumns()).map((column) => column.getName())

  expect(columnNames).toContain("received_at")
  expect(columnNames).toContain("commit_sha")

  for (const columnName of addedColumnNames) {
    expect(columnNames).not.toContain(columnName)
  }

  const indexNames = (await table.getIndexes()).map((index) => index.getName())

  for (const indexName of addedIndexNames) {
    expect(indexNames).not.toContain(indexName)
  }
}

describe("database - migration - changeTable", {tags: ["dummy"]}, () => {
  it("adds and reverses the bulk example while preserving original columns and data", async () => {
    const configuration = Configuration.current()

    await configuration.ensureConnections(async (dbs) => {
      const driver = dbs.default
      const migration = buildMigration(driver, configuration)

      try {
        await driver.dropTable(tableName, {cascade: true, ifExists: true})
        await migration.createTable(tableName, {id: {type: "uuid"}}, (table) => {
          table.datetime("received_at", {null: true})
          table.string("commit_sha", {null: true})
        })
        await driver.query(
          `INSERT INTO ${driver.quoteTable(tableName)} (${driver.quoteColumn("id")}, ${driver.quoteColumn("received_at")}, ${driver.quoteColumn("commit_sha")}) ` +
          `VALUES (${driver.quote(sentinelRowId)}, ${driver.quote("2026-01-02 03:04:05")}, ${driver.quote("abc123")})`
        )

        await migration.changeTable(tableName, {bulk: true}, (table) => {
          table.datetime("correlated_at", {null: true})
          table.datetime("first_github_check_created_at", {null: true})
          table.string("first_github_check_run_id", {null: true})
          table.string("first_github_check_url", {null: true})
          table.index(["first_github_check_created_at", "received_at"], {name: "index_github_delivery_journal_on_first_check_received"})
          table.index(["first_github_check_run_id"], {name: "index_github_delivery_journal_on_first_check_run"})
          table.index(["received_at"], {name: "index_github_delivery_journal_on_received"})
          table.index(["commit_sha"], {name: "index_github_delivery_journal_on_commit_sha"})
        })

        await expectAddedColumns(await driver.getTableByNameOrFail(tableName))
        await expectAddedIndexes(await driver.getTableByNameOrFail(tableName))

        await driver.query(
          `INSERT INTO ${driver.quoteTable(tableName)} (${driver.quoteColumn("id")}, ${driver.quoteColumn("received_at")}, ${driver.quoteColumn("commit_sha")}, ${driver.quoteColumn("correlated_at")}, ${driver.quoteColumn("first_github_check_created_at")}, ${driver.quoteColumn("first_github_check_run_id")}, ${driver.quoteColumn("first_github_check_url")}) ` +
          `VALUES (${driver.quote(addedRowId)}, ${driver.quote("2026-02-03 04:05:06")}, ${driver.quote("def456")}, ${driver.quote("2026-02-03 04:05:06")}, ${driver.quote("2026-02-03 04:05:06")}, ${driver.quote("138173515")}, ${driver.quote("https://example.com/checks/138173515")})`
        )
        const insertedRows = await driver.query(
          `SELECT ${driver.quoteColumn("first_github_check_run_id")}, ${driver.quoteColumn("first_github_check_url")} ` +
          `FROM ${driver.quoteTable(tableName)} WHERE ${driver.quoteColumn("commit_sha")} = ${driver.quote("def456")}`
        )

        expect(insertedRows).toHaveLength(1)
        expect(insertedRows[0].first_github_check_run_id).toEqual("138173515")
        expect(insertedRows[0].first_github_check_url).toEqual("https://example.com/checks/138173515")

        await migration.changeTable(tableName, {bulk: true}, (table) => {
          table.removeIndex("index_github_delivery_journal_on_first_check_received")
          table.removeIndex("index_github_delivery_journal_on_first_check_run")
          table.removeIndex("index_github_delivery_journal_on_received")
          table.removeIndex("index_github_delivery_journal_on_commit_sha")
          table.remove("correlated_at", "first_github_check_created_at", "first_github_check_run_id", "first_github_check_url")
        })

        await expectAdditionsRemoved(await driver.getTableByNameOrFail(tableName))

        const sentinelRows = await driver.query(
          `SELECT ${driver.quoteColumn("received_at")}, ${driver.quoteColumn("commit_sha")} ` +
          `FROM ${driver.quoteTable(tableName)} WHERE ${driver.quoteColumn("commit_sha")} = ${driver.quote("abc123")}`
        )

        expect(sentinelRows).toHaveLength(1)
        expect(sentinelRows[0].commit_sha).toEqual("abc123")
      } finally {
        await driver.dropTable(tableName, {cascade: true, ifExists: true})
      }
    })
  })

  it("applies and reverses the example without bulk by outcome", async () => {
    const configuration = Configuration.current()

    await configuration.ensureConnections(async (dbs) => {
      const driver = dbs.default
      const migration = buildMigration(driver, configuration)

      try {
        await driver.dropTable(tableName, {cascade: true, ifExists: true})
        await migration.createTable(tableName, {id: {type: "uuid"}}, (table) => {
          table.datetime("received_at", {null: true})
          table.string("commit_sha", {null: true})
        })

        await migration.changeTable(tableName, (table) => {
          table.datetime("correlated_at", {null: true})
          table.datetime("first_github_check_created_at", {null: true})
          table.string("first_github_check_run_id", {null: true})
          table.string("first_github_check_url", {null: true})
          table.index(["first_github_check_created_at", "received_at"], {name: "index_github_delivery_journal_on_first_check_received"})
          table.index(["first_github_check_run_id"], {name: "index_github_delivery_journal_on_first_check_run"})
          table.index(["received_at"], {name: "index_github_delivery_journal_on_received"})
          table.index(["commit_sha"], {name: "index_github_delivery_journal_on_commit_sha"})
        })

        await expectAddedColumns(await driver.getTableByNameOrFail(tableName))
        await expectAddedIndexes(await driver.getTableByNameOrFail(tableName))

        await migration.changeTable(tableName, (table) => {
          table.removeIndex("index_github_delivery_journal_on_first_check_received")
          table.removeIndex("index_github_delivery_journal_on_first_check_run")
          table.removeIndex("index_github_delivery_journal_on_received")
          table.removeIndex("index_github_delivery_journal_on_commit_sha")
          table.remove("correlated_at", "first_github_check_created_at", "first_github_check_run_id", "first_github_check_url")
        })

        await expectAdditionsRemoved(await driver.getTableByNameOrFail(tableName))
      } finally {
        await driver.dropTable(tableName, {cascade: true, ifExists: true})
      }
    })
  })
})