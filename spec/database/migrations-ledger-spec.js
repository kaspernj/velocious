// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import MigrationsLedger from "../../src/database/migrations-ledger.js"
import {createTenantTestConfiguration} from "../helpers/tenant-test-helpers.js"

// Unit coverage for the cases the dummy-app browser matrix can't exercise: creating
// the ledger table from scratch and the cross-database `baselineFromDatabase`
// orchestration (the dummy app exposes only a single `default` database). The
// per-driver DDL/CRUD primitives are covered against the real matrix in
// migrations-ledger.browser-spec.js.
describe("MigrationsLedger", () => {
  it("creates the ledger table and records versions as applied without running migrations", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("migrations-ledger")

    try {
      await configuration.ensureConnections(async (dbs) => {
        const db = dbs.default

        expect(await MigrationsLedger.tableExists(db)).toEqual(false)

        const recorded = await MigrationsLedger.markApplied(db, ["20260101000000", "20260102000000"])

        expect(recorded.sort()).toEqual(["20260101000000", "20260102000000"])
        expect(await MigrationsLedger.tableExists(db)).toEqual(true)
        expect((await MigrationsLedger.appliedVersions(db)).sort()).toEqual(["20260101000000", "20260102000000"])
      })
    } finally {
      await cleanup()
    }
  })

  it("is idempotent — re-marking already-applied versions records only the new ones", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("migrations-ledger")

    try {
      await configuration.ensureConnections(async (dbs) => {
        const db = dbs.default

        await MigrationsLedger.markApplied(db, ["20260101000000", "20260102000000"])

        const recorded = await MigrationsLedger.markApplied(db, ["20260101000000", "20260103000000"])

        expect(recorded).toEqual(["20260103000000"])
        expect((await MigrationsLedger.appliedVersions(db)).sort()).toEqual([
          "20260101000000",
          "20260102000000",
          "20260103000000"
        ])
      })
    } finally {
      await cleanup()
    }
  })

  it("records and removes a single version idempotently", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("migrations-ledger")

    try {
      await configuration.ensureConnections(async (dbs) => {
        const db = dbs.default

        await MigrationsLedger.ensureTable(db)
        await MigrationsLedger.recordVersion(db, "20260101000000")
        await MigrationsLedger.recordVersion(db, "20260101000000")

        expect(await MigrationsLedger.hasVersion(db, "20260101000000")).toEqual(true)
        expect(await MigrationsLedger.appliedVersions(db)).toEqual(["20260101000000"])

        await MigrationsLedger.removeVersion(db, "20260101000000")

        expect(await MigrationsLedger.hasVersion(db, "20260101000000")).toEqual(false)
        expect(await MigrationsLedger.appliedVersions(db)).toEqual([])
      })
    } finally {
      await cleanup()
    }
  })

  it("baselines a target database from a source database's applied versions", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("migrations-ledger")

    try {
      await configuration.ensureConnections(async (dbs) => {
        const sourceDb = dbs.default
        const targetDb = dbs.analytics

        await MigrationsLedger.markApplied(sourceDb, ["20260101000000", "20260102000000", "20260103000000"])
        await MigrationsLedger.markApplied(targetDb, ["20260101000000"])

        const recorded = await MigrationsLedger.baselineFromDatabase({sourceDb, targetDb})

        expect(recorded.sort()).toEqual(["20260102000000", "20260103000000"])
        expect((await MigrationsLedger.appliedVersions(targetDb)).sort()).toEqual([
          "20260101000000",
          "20260102000000",
          "20260103000000"
        ])
      })
    } finally {
      await cleanup()
    }
  })
})
