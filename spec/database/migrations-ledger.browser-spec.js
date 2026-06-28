// @ts-check

import Configuration from "../../src/configuration.js"
import MigrationsLedger from "../../src/database/migrations-ledger.js"

// Runs against the real database driver matrix (MariaDB / PostgreSQL / MS-SQL /
// SQLite) via the dummy app, so driver-specific implementations of the ledger's
// DDL, introspection and CRUD are exercised. `schema_migrations` already exists in
// the dummy app (migrations prepared it through MigrationsLedger.ensureTable /
// recordVersion on every matrix DB), so these cases add their own throwaway versions
// and clean them up, leaving the real ledger untouched. The cross-database
// `baselineFromDatabase` orchestration and the from-scratch table creation are
// covered in the SQLite unit spec, which can spin up a second/empty database.
describe("MigrationsLedger - browser DB matrix", {tags: ["dummy"]}, () => {
  it("records, queries and removes versions against the real database driver", async () => {
    await Configuration.current().ensureConnections(async (dbs) => {
      const db = dbs.default
      const v1 = "ledger-browser-spec-0001"
      const v2 = "ledger-browser-spec-0002"
      const v3 = "ledger-browser-spec-0003"

      expect(await MigrationsLedger.tableExists(db)).toEqual(true)
      await MigrationsLedger.ensureTable(db)

      const originalCount = (await MigrationsLedger.appliedVersions(db)).length

      try {
        const recorded = await MigrationsLedger.markApplied(db, [v1, v2])

        expect(recorded.sort()).toEqual([v1, v2])
        expect(await MigrationsLedger.hasVersion(db, v1)).toEqual(true)
        expect(await MigrationsLedger.hasVersion(db, v2)).toEqual(true)

        // Idempotent: re-marking v1 records nothing, only v3 is new.
        const recordedAgain = await MigrationsLedger.markApplied(db, [v1, v3])

        expect(recordedAgain).toEqual([v3])

        const versions = await MigrationsLedger.appliedVersions(db)

        expect(versions.length).toEqual(originalCount + 3)
        expect(versions.includes(v1)).toEqual(true)

        // recordVersion is idempotent for a single version.
        await MigrationsLedger.recordVersion(db, v1)

        expect((await MigrationsLedger.appliedVersions(db)).length).toEqual(originalCount + 3)
      } finally {
        for (const version of [v1, v2, v3]) {
          await MigrationsLedger.removeVersion(db, version)
        }
      }

      expect(await MigrationsLedger.hasVersion(db, v1)).toEqual(false)
      expect((await MigrationsLedger.appliedVersions(db)).length).toEqual(originalCount)
    })
  })
})
