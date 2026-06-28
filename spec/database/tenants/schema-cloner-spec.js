// @ts-check

import {describe, expect, it} from "../../../src/testing/test.js"
import MigrationsLedger from "../../../src/database/migrations-ledger.js"
import SchemaCloner from "../../../src/database/tenants/schema-cloner.js"
import TableData from "../../../src/database/table-data/index.js"
import TableIndex from "../../../src/database/table-data/table-index.js"
import {createTenantTestConfiguration} from "../../helpers/tenant-test-helpers.js"

// The per-driver DDL/introspection the cloner orchestrates (createTable,
// alterTableSQLs, createIndexSQLs, getColumns, getIndexes) is matrix-tested by the
// existing migration browser specs, and the ledger integration by
// migrations-ledger.browser-spec.js. The dummy app exposes a single database, so the
// cross-database clone itself is covered here against SQLite's two-database harness.
describe("SchemaCloner", () => {
  /**
   * @param {(args: {cloner: SchemaCloner, sourceDb: import("../../../src/database/drivers/base.js").default, targetDb: import("../../../src/database/drivers/base.js").default}) => Promise<void>} callback
   * @returns {Promise<void>}
   */
  async function withCloner(callback) {
    const {cleanup, configuration} = await createTenantTestConfiguration("schema-cloner")

    try {
      await configuration.ensureConnections(async (dbs) => {
        const sourceDb = dbs.default
        const targetDb = dbs.analytics

        await createWidgetsSourceTable(sourceDb)
        await MigrationsLedger.markApplied(sourceDb, ["20260101000000", "20260102000000"])

        await callback({cloner: new SchemaCloner({sourceDb, targetDb}), sourceDb, targetDb})
      })
    } finally {
      await cleanup()
    }
  }

  it("clones a missing table's columns and indexes into the target and baselines the ledger", async () => {
    await withCloner(async ({cloner, targetDb}) => {
      await cloner.syncTables(["widgets"])

      expect(await targetDb.tableExists("widgets")).toEqual(true)

      const targetTable = await targetDb.getTableByNameOrFail("widgets")
      const columnNames = (await targetTable.getColumns()).map((column) => column.getName()).sort()

      expect(columnNames).toEqual(["description", "id", "name"])

      const indexColumns = (await targetTable.getIndexes())
        .filter((index) => !index.isPrimaryKey())
        .map((index) => index.getColumnNames().join(","))

      expect(indexColumns).toContain("name")
      expect((await MigrationsLedger.appliedVersions(targetDb)).sort()).toEqual(["20260101000000", "20260102000000"])
    })
  })

  it("adds columns that appeared on the source to an already-cloned target", async () => {
    await withCloner(async ({cloner, sourceDb, targetDb}) => {
      await cloner.syncTables(["widgets"])

      const addPrice = new TableData("widgets")

      addPrice.integer("price", {null: true})

      for (const sql of await sourceDb.alterTableSQLs(addPrice)) {
        await sourceDb.query(sql)
      }

      sourceDb.clearSchemaCache()

      await cloner.syncTables(["widgets"])

      const targetTable = await targetDb.getTableByNameOrFail("widgets")
      const columnNames = (await targetTable.getColumns()).map((column) => column.getName())

      expect(columnNames.includes("price")).toEqual(true)
    })
  })

  it("re-syncing an already-current table is an idempotent no-op", async () => {
    await withCloner(async ({cloner, targetDb}) => {
      await cloner.syncTables(["widgets"])
      await cloner.syncTables(["widgets"])

      const columnNames = (await (await targetDb.getTableByNameOrFail("widgets")).getColumns()).map((column) => column.getName()).sort()

      expect(columnNames).toEqual(["description", "id", "name"])
    })
  })

  it("clones an integer auto-increment primary key", async () => {
    await withCloner(async ({cloner, sourceDb, targetDb}) => {
      const counters = new TableData("counters")

      counters.integer("id", {null: false, primaryKey: true})
      counters.string("label", {maxLength: 64, null: true})

      await sourceDb.createTable(counters)
      sourceDb.clearSchemaCache()

      await cloner.syncTables(["counters"])

      const targetTable = await targetDb.getTableByNameOrFail("counters")
      const idColumn = (await targetTable.getColumns()).find((column) => column.getName() === "id")

      expect(idColumn?.getAutoIncrement()).toEqual(true)
    })
  })

  it("detects and heals ledger drift from the source", async () => {
    await withCloner(async ({cloner, sourceDb, targetDb}) => {
      await cloner.syncTables(["widgets"])

      expect(await cloner.ledgerDriftsFromSource()).toEqual(false)

      await MigrationsLedger.markApplied(sourceDb, ["20260103000000"])

      expect(await cloner.ledgerDriftsFromSource()).toEqual(true)

      await cloner.reconcileLedger()

      expect(await cloner.ledgerDriftsFromSource()).toEqual(false)
      expect((await MigrationsLedger.appliedVersions(targetDb)).includes("20260103000000")).toEqual(true)
    })
  })
})

/**
 * @param {import("../../../src/database/drivers/base.js").default} db
 * @returns {Promise<void>}
 */
async function createWidgetsSourceTable(db) {
  const widgets = new TableData("widgets")

  widgets.bigint("id", {null: false, primaryKey: true})
  widgets.string("name", {maxLength: 255, null: false})
  widgets.text("description", {null: true})
  widgets.addIndex(new TableIndex(["name"], {unique: true}))

  await db.createTable(widgets)
  db.clearSchemaCache()
}
