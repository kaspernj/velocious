// @ts-check

import Configuration from "../../../src/configuration.js"
import Migration from "../../../src/database/migration/index.js"
import { describe, expect, it } from "../../../src/testing/test.js"
import { dropTables, isCleanupRequest, tableRowCount } from "../../helpers/truncate-all-tables-test-helper.js"
import { sqlMessages, withQueryLogOutput } from "../../helpers/query-log-helpers.js"

/** @typedef {import("../../../src/database/drivers/base.js").default} Driver */

const BATCH_PARENT_TABLE = "truncate_batch_parents"
const BATCH_CHILD_TABLE = "truncate_batch_children"
const BATCH_IDENTITY_TABLE = "truncate_batch_identities"

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

describe("database - drivers - truncate all tables - cleanup", {tags: ["dummy"], databaseCleaning: {transaction: false, truncate: false}}, () => {
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
})
