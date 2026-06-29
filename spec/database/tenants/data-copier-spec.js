// @ts-check

import {describe, expect, it} from "../../../src/testing/test.js"
import DataCopier from "../../../src/database/tenants/data-copier.js"
import TableData from "../../../src/database/table-data/index.js"
import {createTenantTestConfiguration} from "../../helpers/tenant-test-helpers.js"

/** @type {import("../../../src/database/tenants/tenant-table-plan.js").TenantTablePlanEntry[]} */
const TABLE_PLAN = [
  {tableName: "gizmos", keyColumn: "account_id"},
  {parentColumn: "gizmo_id", parentTableName: "gizmos", tableName: "gizmo_parts"}
]

// The per-driver row CRUD the copier orchestrates (select/insert/delete, transactions and
// withDisabledForeignKeys) is matrix-tested elsewhere; the dummy app exposes a single
// database, so the cross-database copy itself is covered here against SQLite's two-database
// harness (default = source, analytics = target).
describe("DataCopier", () => {
  /**
   * @param {(args: {sourceDb: import("../../../src/database/drivers/base.js").default, targetDb: import("../../../src/database/drivers/base.js").default}) => Promise<void>} callback
   * @returns {Promise<void>}
   */
  async function withDatabases(callback) {
    const {cleanup, configuration} = await createTenantTestConfiguration("data-copier")

    try {
      await configuration.ensureConnections(async (dbs) => {
        const sourceDb = dbs.default
        const targetDb = dbs.analytics

        await createGizmoTables(sourceDb)
        await createGizmoTables(targetDb)

        await callback({sourceDb, targetDb})
      })
    } finally {
      await cleanup()
    }
  }

  /**
   * @param {import("../../../src/database/drivers/base.js").default} db
   * @returns {Promise<void>}
   */
  async function seedSource(db) {
    await db.query(db.insertSql({
      columns: ["id", "account_id", "name"],
      tableName: "gizmos",
      rows: [["g1", "acct-a", "Alpha"], ["g2", "acct-b", "Beta"]]
    }))
    await db.query(db.insertSql({
      columns: ["id", "gizmo_id", "label"],
      tableName: "gizmo_parts",
      rows: [["p1", "g1", "A-part"], ["p2", "g1", "A-part-2"], ["p3", "g2", "B-part"]]
    }))
  }

  it("copies only the keyed tenant's rows and the children that hang off them", async () => {
    await withDatabases(async ({sourceDb, targetDb}) => {
      await seedSource(sourceDb)

      const copier = new DataCopier({sourceDb, tablePlan: TABLE_PLAN, targetDb})

      await copier.copy("acct-a")

      const gizmos = await targetDb.query("SELECT id FROM gizmos ORDER BY id")
      const gizmoParts = await targetDb.query("SELECT id FROM gizmo_parts ORDER BY id")

      expect(gizmos.map((row) => row.id)).toEqual(["g1"])
      expect(gizmoParts.map((row) => row.id)).toEqual(["p1", "p2"])
    })
  })

  it("returns the loaded rows keyed by table name", async () => {
    await withDatabases(async ({sourceDb, targetDb}) => {
      await seedSource(sourceDb)

      const copier = new DataCopier({sourceDb, tablePlan: TABLE_PLAN, targetDb})
      const rowsByTableName = await copier.copy("acct-a")

      expect(rowsByTableName.get("gizmos")?.map((row) => row.id)).toEqual(["g1"])
      expect((rowsByTableName.get("gizmo_parts") || []).map((row) => row.id).sort()).toEqual(["p1", "p2"])
    })
  })

  it("is idempotent — re-copying replaces the target rows instead of duplicating them", async () => {
    await withDatabases(async ({sourceDb, targetDb}) => {
      await seedSource(sourceDb)

      const copier = new DataCopier({sourceDb, tablePlan: TABLE_PLAN, targetDb})

      await copier.copy("acct-a")
      await copier.copy("acct-a")

      const gizmos = await targetDb.query("SELECT id FROM gizmos ORDER BY id")
      const gizmoParts = await targetDb.query("SELECT id FROM gizmo_parts ORDER BY id")

      expect(gizmos.map((row) => row.id)).toEqual(["g1"])
      expect(gizmoParts.map((row) => row.id)).toEqual(["p1", "p2"])
    })
  })

  it("removes target rows that no longer exist in the source on re-copy", async () => {
    await withDatabases(async ({sourceDb, targetDb}) => {
      await seedSource(sourceDb)

      const copier = new DataCopier({sourceDb, tablePlan: TABLE_PLAN, targetDb})

      await copier.copy("acct-a")

      // A child that was copied before is later removed from the source snapshot.
      await sourceDb.query("DELETE FROM gizmo_parts WHERE id = 'p2'")

      await copier.copy("acct-a")

      const gizmoParts = await targetDb.query("SELECT id FROM gizmo_parts ORDER BY id")

      expect(gizmoParts.map((row) => row.id)).toEqual(["p1"])
    })
  })

  it("throws when a parent-scoped entry appears before its parent in the plan", async () => {
    await withDatabases(async ({sourceDb, targetDb}) => {
      await seedSource(sourceDb)

      /** @type {import("../../../src/database/tenants/tenant-table-plan.js").TenantTablePlanEntry[]} */
      const misorderedPlan = [
        {parentColumn: "gizmo_id", parentTableName: "gizmos", tableName: "gizmo_parts"},
        {keyColumn: "account_id", tableName: "gizmos"}
      ]
      const copier = new DataCopier({sourceDb, tablePlan: misorderedPlan, targetDb})

      let caughtError = null

      try {
        await copier.copy("acct-a")
      } catch (error) {
        caughtError = error
      }

      expect(caughtError instanceof Error && caughtError.message.includes("has not been loaded")).toEqual(true)
    })
  })

  it("refreshes stale target rows with the current source values", async () => {
    await withDatabases(async ({sourceDb, targetDb}) => {
      await seedSource(sourceDb)

      // A stale copy of g1 already lives in the target with an outdated name.
      await targetDb.query(targetDb.insertSql({
        columns: ["id", "account_id", "name"],
        tableName: "gizmos",
        rows: [["g1", "acct-a", "Outdated"]]
      }))

      const copier = new DataCopier({sourceDb, tablePlan: TABLE_PLAN, targetDb})

      await copier.copy("acct-a")

      const gizmos = await targetDb.query("SELECT name FROM gizmos WHERE id = 'g1'")

      expect(gizmos.map((row) => row.name)).toEqual(["Alpha"])
    })
  })

  it("copies nothing for a tenant key with no rows", async () => {
    await withDatabases(async ({sourceDb, targetDb}) => {
      await seedSource(sourceDb)

      const copier = new DataCopier({sourceDb, tablePlan: TABLE_PLAN, targetDb})

      await copier.copy("acct-unknown")

      const gizmos = await targetDb.query("SELECT id FROM gizmos")
      const gizmoParts = await targetDb.query("SELECT id FROM gizmo_parts")

      expect(gizmos).toEqual([])
      expect(gizmoParts).toEqual([])
    })
  })

  it("reports progress for the tables it touches", async () => {
    await withDatabases(async ({sourceDb, targetDb}) => {
      await seedSource(sourceDb)

      /** @type {string[]} */
      const progress = []
      const copier = new DataCopier({onProgress: (message) => progress.push(message), sourceDb, tablePlan: TABLE_PLAN, targetDb})

      await copier.copy("acct-a")

      expect(progress.some((message) => message.includes("gizmos: loaded 1 row(s)"))).toEqual(true)
      expect(progress.some((message) => message.includes("gizmo_parts: inserting 2 row(s)"))).toEqual(true)
    })
  })
})

/**
 * @param {import("../../../src/database/drivers/base.js").default} db
 * @returns {Promise<void>}
 */
async function createGizmoTables(db) {
  const gizmos = new TableData("gizmos")

  gizmos.string("id", {maxLength: 64, null: false, primaryKey: true})
  gizmos.string("account_id", {maxLength: 64, null: false})
  gizmos.string("name", {maxLength: 255, null: true})

  await db.createTable(gizmos)

  const gizmoParts = new TableData("gizmo_parts")

  gizmoParts.string("id", {maxLength: 64, null: false, primaryKey: true})
  gizmoParts.string("gizmo_id", {maxLength: 64, null: false})
  gizmoParts.string("label", {maxLength: 255, null: true})

  await db.createTable(gizmoParts)
  db.clearSchemaCache()
}
