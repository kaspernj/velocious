// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import MigrationsLedger from "../../src/database/migrations-ledger.js"
import {createTenantTestConfiguration} from "../helpers/tenant-test-helpers.js"

/**
 * Builds an error carrying a SQL Server numeric error code, the way the driver's
 * `RequestError` exposes it.
 * @param {string} message - Error message.
 * @param {number} number - SQL Server error number.
 * @returns {Error} - Error with the numeric code attached.
 */
function errorWithNumber(message, number) {
  const error = /** @type {Error & {number?: number}} */ (new Error(message))

  error.number = number

  return error
}

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

  // Regression coverage for concurrent ledger bootstrap. CI runs many test shards
  // against one shared database, so `ensureTable` is entered simultaneously and the
  // MSSQL `IF NOT EXISTS (...) BEGIN CREATE TABLE ... END` guard is not atomic. Before
  // this was handled, a losing session crashed its whole process with error 2714
  // ("There is already an object named 'schema_migrations' in the database") or died as
  // a deadlock victim (error 1205) on the INFORMATION_SCHEMA scan.
  describe("concurrent bootstrap", () => {
    it("recognises a duplicate-object error as a lost create race", () => {
      const driverError = errorWithNumber("There is already an object named 'schema_migrations' in the database.", 2714)
      const wrappedError = new Error("Query failed '...': /* velocious */ CREATE TABLE ...", {cause: driverError})
      const unrelatedError = errorWithNumber("Invalid object name 'other_table'.", 208)

      expect(MigrationsLedger.isConcurrentCreationError(wrappedError)).toBeTrue()
      expect(MigrationsLedger.isConcurrentCreationError(driverError)).toBeTrue()
      expect(MigrationsLedger.isConcurrentCreationError(unrelatedError)).toBeFalse()
      expect(MigrationsLedger.isConcurrentCreationError(new Error("some other failure"))).toBeFalse()
      expect(MigrationsLedger.isConcurrentCreationError(undefined)).toBeFalse()
    })

    it("recognises a deadlock victim as retryable", () => {
      const driverError = errorWithNumber(
        "Transaction was deadlocked on lock resources with another process and has been chosen as the deadlock victim.",
        1205
      )
      const wrappedError = new Error("Query failed '...'", {cause: driverError})
      const unrelatedError = errorWithNumber("Invalid object name 'other_table'.", 208)

      expect(MigrationsLedger.isDeadlockError(wrappedError)).toBeTrue()
      expect(MigrationsLedger.isDeadlockError(driverError)).toBeTrue()
      expect(MigrationsLedger.isDeadlockError(unrelatedError)).toBeFalse()
      expect(MigrationsLedger.isDeadlockError(new Error("some other failure"))).toBeFalse()
      expect(MigrationsLedger.isDeadlockError(undefined)).toBeFalse()
    })

    it("treats a create that lost the race as success instead of failing the caller", async () => {
      const {cleanup, configuration} = await createTenantTestConfiguration("migrations-ledger")

      try {
        await configuration.ensureConnections(async (dbs) => {
          const realDb = dbs.default
          let createAttempts = 0

          // Simulates the losing side of the race: our existence check reports "missing",
          // the other session creates the table in the meantime, and our CREATE is
          // rejected with the duplicate-object error. `ensureTable` must absorb exactly
          // that error and report success.
          const racingDb = new Proxy(realDb, {
            get(target, property, receiver) {
              if (property === "getTableByName") {
                return async () => null
              }

              if (property === "query") {
                return async (/** @type {string} */ sql) => {
                  if (!sql.includes("schema_migrations")) return await target.query(sql)

                  createAttempts++

                  const driverError = errorWithNumber(
                    "There is already an object named 'schema_migrations' in the database.",
                    2714
                  )

                  throw new Error(`Query failed '${sql}': /* velocious */`, {cause: driverError})
                }
              }

              const value = Reflect.get(target, property, receiver)

              return typeof value === "function" ? value.bind(target) : value
            }
          })

          // Must resolve (not reject): the accepted error is exactly the race signal.
          await MigrationsLedger.ensureTable(/** @type {any} */ (racingDb))

          expect(createAttempts).toBeGreaterThan(0)
        })
      } finally {
        await cleanup()
      }
    })

    it("propagates unrelated errors instead of hiding them", async () => {
      const {cleanup, configuration} = await createTenantTestConfiguration("migrations-ledger")

      try {
        await configuration.ensureConnections(async (dbs) => {
          const realDb = dbs.default

          const failingDb = new Proxy(realDb, {
            get(target, property, receiver) {
              if (property === "getTableByName") {
                return async () => null
              }

              if (property === "query") {
                return async () => {
                  const driverError = errorWithNumber("Invalid object name 'something_else'.", 208)

                  throw new Error("Query failed '...'", {cause: driverError})
                }
              }

              const value = Reflect.get(target, property, receiver)

              return typeof value === "function" ? value.bind(target) : value
            }
          })

          let caughtError = /** @type {Error | null} */ (null)

          try {
            await MigrationsLedger.ensureTable(/** @type {any} */ (failingDb))
          } catch (error) {
            caughtError = /** @type {Error} */ (error)
          }

          expect(caughtError?.message).toEqual("Query failed '...'")
        })
      } finally {
        await cleanup()
      }
    })
  })
})