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

  it("moves only the keyed tenant rows and their children out of the source database", async () => {
    await withDatabases(async ({sourceDb, targetDb}) => {
      await seedSource(sourceDb)

      const copier = new DataCopier({sourceDb, tablePlan: TABLE_PLAN, targetDb})
      const movedRows = await copier.move("acct-a")
      const sourceGizmos = await sourceDb.query("SELECT id FROM gizmos ORDER BY id")
      const sourceGizmoParts = await sourceDb.query("SELECT id FROM gizmo_parts ORDER BY id")
      const targetGizmos = await targetDb.query("SELECT id FROM gizmos ORDER BY id")
      const targetGizmoParts = await targetDb.query("SELECT id FROM gizmo_parts ORDER BY id")

      expect(sourceGizmos.map((row) => row.id)).toEqual(["g2"])
      expect(sourceGizmoParts.map((row) => row.id)).toEqual(["p3"])
      expect(targetGizmos.map((row) => row.id)).toEqual(["g1"])
      expect(targetGizmoParts.map((row) => row.id)).toEqual(["p1", "p2"])
      expect(movedRows.get("gizmos")?.map((row) => row.id)).toEqual(["g1"])
    })
  })

  it("transforms rows only for the target while moving them", async () => {
    await withDatabases(async ({sourceDb, targetDb}) => {
      await seedSource(sourceDb)

      const copier = new DataCopier({sourceDb, tablePlan: TABLE_PLAN, targetDb})

      await copier.move("acct-a", {
        transformRow: ({row, tableName}) => tableName === "gizmos"
          ? {...row, account_id: "acct-tenant"}
          : row
      })

      const sourceRows = await sourceDb.query("SELECT id FROM gizmos WHERE account_id = 'acct-a'")
      const targetRows = await targetDb.query("SELECT account_id AS accountId, id FROM gizmos WHERE id = 'g1'")

      expect(sourceRows).toEqual([])
      expect(targetRows).toEqual([{accountId: "acct-tenant", id: "g1"}])
    })
  })

  it("keeps source rows when the target write fails", async () => {
    await withDatabases(async ({sourceDb, targetDb}) => {
      await seedSource(sourceDb)

      const copier = new DataCopier({sourceDb, tablePlan: TABLE_PLAN, targetDb})

      await expect(async () => {
        await copier.move("acct-a", {
          transformRow: ({row, tableName}) => tableName === "gizmos"
            ? {...row, missing_column: "invalid"}
            : row
        })
      }).toThrow()

      const sourceGizmos = await sourceDb.query("SELECT id FROM gizmos WHERE account_id = 'acct-a'")
      const sourceGizmoParts = await sourceDb.query("SELECT id FROM gizmo_parts WHERE gizmo_id = 'g1' ORDER BY id")

      expect(sourceGizmos.map((row) => row.id)).toEqual(["g1"])
      expect(sourceGizmoParts.map((row) => row.id)).toEqual(["p1", "p2"])
    })
  })

  it("preserves moved target rows when retried after the source is gone", async () => {
    await withDatabases(async ({sourceDb, targetDb}) => {
      await seedSource(sourceDb)

      const copier = new DataCopier({sourceDb, tablePlan: TABLE_PLAN, targetDb})

      await copier.move("acct-a")
      const retriedRows = await copier.move("acct-a")
      const targetGizmos = await targetDb.query("SELECT id FROM gizmos ORDER BY id")
      const targetGizmoParts = await targetDb.query("SELECT id FROM gizmo_parts ORDER BY id")

      expect(retriedRows.get("gizmos")).toEqual([])
      expect(retriedRows.get("gizmo_parts")).toEqual([])
      expect(targetGizmos.map((row) => row.id)).toEqual(["g1"])
      expect(targetGizmoParts.map((row) => row.id)).toEqual(["p1", "p2"])
    })
  })

  it("rejects moving rows when source and target use the same connection", async () => {
    await withDatabases(async ({sourceDb}) => {
      await seedSource(sourceDb)

      const copier = new DataCopier({sourceDb, tablePlan: TABLE_PLAN, targetDb: sourceDb})

      await expect(async () => await copier.move("acct-a")).toThrow("DataCopier move requires different physical databases.")

      const sourceGizmos = await sourceDb.query("SELECT id FROM gizmos ORDER BY id")

      expect(sourceGizmos.map((row) => row.id)).toEqual(["g1", "g2"])
    })
  })

  it("rejects moving rows when distinct connections use the same physical database", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("data-copier-same-database")
    const databaseConfiguration = configuration.getDatabaseConfiguration()

    databaseConfiguration.analytics.name = databaseConfiguration.default.name

    try {
      await configuration.ensureConnections(async (dbs) => {
        const sourceDb = dbs.default
        const targetDb = dbs.analytics

        expect(sourceDb === targetDb).toBe(false)

        await createGizmoTables(sourceDb)
        await seedSource(sourceDb)

        const copier = new DataCopier({sourceDb, tablePlan: TABLE_PLAN, targetDb})

        await expect(async () => await copier.move("acct-a")).toThrow("DataCopier move requires different physical databases.")

        const sourceGizmos = await sourceDb.query("SELECT id FROM gizmos ORDER BY id")

        expect(sourceGizmos.map((row) => row.id)).toEqual(["g1", "g2"])
      })
    } finally {
      await cleanup()
    }
  })

  it("loadRowIds returns only the keyed tenant's ids per table, following the child traversal", async () => {
    await withDatabases(async ({sourceDb, targetDb}) => {
      await seedSource(sourceDb)

      const copier = new DataCopier({sourceDb, tablePlan: TABLE_PLAN, targetDb})
      const idsByTableName = await copier.loadRowIds(sourceDb, "acct-a")

      expect(idsByTableName.get("gizmos")).toEqual(["g1"])
      expect((idsByTableName.get("gizmo_parts") || []).slice().sort()).toEqual(["p1", "p2"])
    })
  })

  it("loadRowIds returns empty id lists for a tenant key with no rows", async () => {
    await withDatabases(async ({sourceDb, targetDb}) => {
      await seedSource(sourceDb)

      const copier = new DataCopier({sourceDb, tablePlan: TABLE_PLAN, targetDb})
      const idsByTableName = await copier.loadRowIds(sourceDb, "acct-unknown")

      expect(idsByTableName.get("gizmos")).toEqual([])
      expect(idsByTableName.get("gizmo_parts")).toEqual([])
    })
  })

  it("findMissingRowIds returns empty when the target already holds every source row", async () => {
    await withDatabases(async ({sourceDb, targetDb}) => {
      await seedSource(sourceDb)

      const copier = new DataCopier({sourceDb, tablePlan: TABLE_PLAN, targetDb})

      await copier.copy("acct-a")

      const missing = await copier.findMissingRowIds("acct-a", {batchSize: 1})

      expect(missing.size).toEqual(0)
    })
  })

  it("findMissingRowIds streams and reports source ids missing from the target, including chained children", async () => {
    await withDatabases(async ({sourceDb, targetDb}) => {
      await seedSource(sourceDb)

      // Target has the parent gizmo and one of its parts, but is missing the second part.
      await targetDb.query(targetDb.insertSql({columns: ["id", "account_id", "name"], tableName: "gizmos", rows: [["g1", "acct-a", "Alpha"]]}))
      await targetDb.query(targetDb.insertSql({columns: ["id", "gizmo_id", "label"], tableName: "gizmo_parts", rows: [["p1", "g1", "A-part"]]}))

      const copier = new DataCopier({sourceDb, tablePlan: TABLE_PLAN, targetDb})
      const missing = await copier.findMissingRowIds("acct-a", {batchSize: 1})

      expect(missing.has("gizmos")).toEqual(false)
      expect(missing.get("gizmo_parts")).toEqual(["p2"])
    })
  })

  it("copyMissingRows streams and copies only the rows missing from the target", async () => {
    await withDatabases(async ({sourceDb, targetDb}) => {
      await seedSource(sourceDb)

      await targetDb.query(targetDb.insertSql({columns: ["id", "account_id", "name"], tableName: "gizmos", rows: [["g1", "acct-a", "Alpha"]]}))
      await targetDb.query(targetDb.insertSql({columns: ["id", "gizmo_id", "label"], tableName: "gizmo_parts", rows: [["p1", "g1", "A-part"]]}))

      const copier = new DataCopier({sourceDb, tablePlan: TABLE_PLAN, targetDb})
      const copiedCount = await copier.copyMissingRows("acct-a", {batchSize: 1})

      const gizmoParts = await targetDb.query("SELECT id FROM gizmo_parts ORDER BY id")

      expect(copiedCount).toEqual(1)
      expect(gizmoParts.map((row) => row.id)).toEqual(["p1", "p2"])
    })
  })

  it("findMissingRowIds fails fast on the first missing table for a fully-behind target", async () => {
    await withDatabases(async ({sourceDb, targetDb}) => {
      await seedSource(sourceDb)

      // Target is empty, so every source row is missing; findMissingRowIds must stop at the
      // first table rather than accumulating the whole plan's ids.
      const copier = new DataCopier({sourceDb, tablePlan: TABLE_PLAN, targetDb})
      const missing = await copier.findMissingRowIds("acct-a", {batchSize: 1})

      expect(missing.has("gizmos")).toEqual(true)
      expect(missing.has("gizmo_parts")).toEqual(false)
    })
  })

  it("copyMissingRows copies a fully-behind target in bounded batches", async () => {
    await withDatabases(async ({sourceDb, targetDb}) => {
      await seedSource(sourceDb)

      const copier = new DataCopier({sourceDb, tablePlan: TABLE_PLAN, targetDb})
      const copiedCount = await copier.copyMissingRows("acct-a", {batchSize: 1})

      const gizmos = await targetDb.query("SELECT id FROM gizmos ORDER BY id")
      const gizmoParts = await targetDb.query("SELECT id FROM gizmo_parts ORDER BY id")

      expect(copiedCount).toEqual(3)
      expect(gizmos.map((row) => row.id)).toEqual(["g1"])
      expect(gizmoParts.map((row) => row.id)).toEqual(["p1", "p2"])
    })
  })

  it("deleteTenantRows removes only the keyed tenant's rows from the target and returns them", async () => {
    await withDatabases(async ({sourceDb, targetDb}) => {
      await seedSource(targetDb)

      const copier = new DataCopier({sourceDb, tablePlan: TABLE_PLAN, targetDb})
      const deleted = await copier.deleteTenantRows("acct-a")

      const gizmos = await targetDb.query("SELECT id FROM gizmos ORDER BY id")
      const gizmoParts = await targetDb.query("SELECT id FROM gizmo_parts ORDER BY id")

      expect(gizmos.map((row) => row.id)).toEqual(["g2"])
      expect(gizmoParts.map((row) => row.id)).toEqual(["p3"])
      expect((deleted.get("gizmos") || []).map((row) => row.id)).toEqual(["g1"])
      expect((deleted.get("gizmo_parts") || []).map((row) => row.id).sort()).toEqual(["p1", "p2"])
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
