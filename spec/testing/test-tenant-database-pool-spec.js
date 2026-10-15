// @ts-check

import {createTenantTestConfiguration} from "../helpers/tenant-test-helpers.js"
import MigrationsLedger from "../../src/database/migrations-ledger.js"
import TestTenantDatabasePool from "../../src/testing/test-tenant-database-pool.js"
import {describe, expect, it} from "../../src/testing/test.js"

/**
 * @param {import("../../src/configuration.js").default} configuration - Configuration.
 * @param {ReturnType<typeof JSON.parse>} tenant - Tenant descriptor.
 * @param {string} sql - SQL to run on the tenant's projectTenant connection.
 * @template T
 * @param {(db: import("../../src/database/drivers/base.js").default) => Promise<T>} [transform] - Optional result transform.
 * @returns {Promise<T>} - Query or transform result.
 */
async function withTenantDatabase(configuration, tenant, sql, transform) {
  return await configuration.runWithTenant(tenant, async () => {
    return await configuration.ensureConnections({databaseIdentifiers: ["projectTenant"]}, async (dbs) => {
      const db = dbs.projectTenant

      if (!db) throw new Error("Expected a projectTenant connection")

      const rows = await db.query(sql)

      return transform ? transform(rows) : rows
    })
  })
}

describe("test tenant database pool", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("provisions pool members once with the default structure and a baselined ledger", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("test-tenant-pool-provision")

    try {
      await configuration.ensureConnections({databaseIdentifiers: ["default"]}, async (dbs) => {
        await dbs.default.query("CREATE TABLE tenant_values(value varchar(255) NOT NULL)")
        await MigrationsLedger.ensureTable(dbs.default)
        await MigrationsLedger.recordVersion(dbs.default, "20261015000000")
      })

      const pool = new TestTenantDatabasePool({
        configuration,
        databaseIdentifier: "projectTenant",
        poolConfiguration: {tenants: [{slug: "p1"}, {slug: "p2"}]}
      })

      const firstLease = await pool.acquire()

      expect(firstLease.tenant).toEqual({slug: "p1"})
      expect(firstLease.databaseIdentifier).toEqual("projectTenant")

      const rows = await withTenantDatabase(configuration, firstLease.tenant, "SELECT value FROM tenant_values")

      expect(rows).toEqual([])

      const ledgerVersions = await configuration.runWithTenant(firstLease.tenant, async () => {
        return await configuration.ensureConnections({databaseIdentifiers: ["projectTenant"]}, async (dbs) => {
          return await MigrationsLedger.appliedVersions(dbs.projectTenant)
        })
      })

      expect(ledgerVersions).toContain("20261015000000")
    } finally {
      await cleanup()
    }
  })

  it("resets leased members between acquisitions so no rows leak across tests", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("test-tenant-pool-isolation")

    try {
      await configuration.ensureConnections({databaseIdentifiers: ["default"]}, async (dbs) => {
        await dbs.default.query("CREATE TABLE tenant_values(value varchar(255) NOT NULL)")
        await MigrationsLedger.ensureTable(dbs.default)
        await MigrationsLedger.recordVersion(dbs.default, "20261015000001")
      })

      const pool = new TestTenantDatabasePool({
        configuration,
        databaseIdentifier: "projectTenant",
        poolConfiguration: {tenants: [{slug: "iso"}]}
      })

      const firstLease = await pool.acquire()

      await withTenantDatabase(configuration, firstLease.tenant, "INSERT INTO tenant_values(value) VALUES ('leak-check')")
      await pool.release(firstLease)

      const secondLease = await pool.acquire()

      // Deterministic reuse: the same member comes back first after release.
      expect(secondLease.tenant).toEqual({slug: "iso"})

      const rows = await withTenantDatabase(configuration, secondLease.tenant, "SELECT value FROM tenant_values")

      expect(rows).toEqual([])

      // The ledger survives the reset (truncateAllTables preserves schema_migrations).
      const ledgerVersions = await configuration.runWithTenant(secondLease.tenant, async () => {
        return await configuration.ensureConnections({databaseIdentifiers: ["projectTenant"]}, async (dbs) => {
          return await MigrationsLedger.appliedVersions(dbs.projectTenant)
        })
      })

      expect(ledgerVersions).toContain("20261015000001")
    } finally {
      await cleanup()
    }
  })

  it("fails loudly on pool exhaustion instead of queueing a waiting lease", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("test-tenant-pool-exhaustion")

    try {
      const pool = new TestTenantDatabasePool({
        configuration,
        databaseIdentifier: "projectTenant",
        poolConfiguration: {tenants: [{slug: "only"}]}
      })

      const lease = await pool.acquire()

      expect(lease.tenant).toEqual({slug: "only"})

      let exhaustionError

      try {
        await pool.acquire()
      } catch (error) {
        exhaustionError = error
      }

      expect(exhaustionError instanceof Error).toEqual(true)
      expect(String(exhaustionError?.message)).toContain("exhausted")

      // The failed acquisition did not steal the held member.
      let pinnedError

      try {
        await pool.acquire({tenant: {slug: "only"}})
      } catch (error) {
        pinnedError = error
      }

      expect(String(pinnedError?.message)).toContain("already leased")

      await pool.release(lease)

      const reacquired = await pool.acquire({tenant: {slug: "only"}})

      expect(reacquired.tenant).toEqual({slug: "only"})
    } finally {
      await cleanup()
    }
  })

  it("never double-leases one member under concurrent acquisitions", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("test-tenant-pool-concurrent")

    try {
      const pool = new TestTenantDatabasePool({
        configuration,
        databaseIdentifier: "projectTenant",
        poolConfiguration: {
          provisionTenant: async () => {},
          tenants: [{slug: "c1"}, {slug: "c2"}]
        }
      })

      const outcomes = await Promise.allSettled([
        pool.acquire(),
        pool.acquire(),
        pool.acquire()
      ])
      const fulfilled = outcomes.filter((outcome) => outcome.status == "fulfilled")
      const rejected = outcomes.filter((outcome) => outcome.status == "rejected")

      expect(fulfilled.length).toEqual(2)
      expect(rejected.length).toEqual(1)
      expect(String(rejected[0].reason?.message)).toContain("exhausted")

      const leasedTenants = fulfilled.map((outcome) => /** @type {{value: {tenant: {slug: string}}}} */ (outcome).value.tenant.slug)

      expect(leasedTenants).toEqual(["c1", "c2"])
    } finally {
      await cleanup()
    }
  })

  it("rejects a pinned tenant that is not a pool member", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("test-tenant-pool-pin")

    try {
      const pool = new TestTenantDatabasePool({
        configuration,
        databaseIdentifier: "projectTenant",
        poolConfiguration: {tenants: [{slug: "member"}]}
      })

      let pinError

      try {
        await pool.acquire({tenant: {slug: "outsider"}})
      } catch (error) {
        pinError = error
      }

      expect(String(pinError?.message)).toContain("not a member")
    } finally {
      await cleanup()
    }
  })

  it("tears down members exactly once and refuses acquisitions afterwards", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("test-tenant-pool-teardown")
    /** @type {string[]} */
    const droppedTenants = []

    try {
      configuration.setTenantDatabaseProviders({
        projectTenant: {
          listTenants: async () => [],
          dropDatabase: async ({tenant}) => {
            droppedTenants.push(/** @type {{slug?: string}} */ (tenant).slug ?? "?")
          }
        }
      })

      const pool = new TestTenantDatabasePool({
        configuration,
        databaseIdentifier: "projectTenant",
        poolConfiguration: {tenants: [{slug: "drop-a"}, {slug: "drop-b"}]}
      })

      await pool.acquire()
      await pool.teardown()
      await pool.teardown()

      expect(droppedTenants).toEqual(["drop-a", "drop-b"])

      let acquireAfterTeardownError

      try {
        await pool.acquire()
      } catch (error) {
        acquireAfterTeardownError = error
      }

      expect(String(acquireAfterTeardownError?.message)).toContain("already torn down")
    } finally {
      await cleanup()
    }
  })

  it("re-provisions a member when its reset fails instead of handing over a corrupted database", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("test-tenant-pool-reprovision")
    let resetCalls = 0
    let provisionCalls = 0

    try {
      const pool = new TestTenantDatabasePool({
        configuration,
        databaseIdentifier: "projectTenant",
        poolConfiguration: {
          provisionTenant: async () => {
            provisionCalls++
          },
          resetTenant: async () => {
            resetCalls++

            if (resetCalls === 1) throw new Error("Simulated reset failure")
          },
          tenants: [{slug: "recover"}]
        }
      })

      const lease = await pool.acquire()

      expect(provisionCalls).toEqual(1)

      await pool.release(lease)

      // The failed reset triggered a full re-provision before the member was freed.
      expect(resetCalls).toEqual(1)
      expect(provisionCalls).toEqual(2)

      const reacquired = await pool.acquire()

      expect(reacquired.tenant).toEqual({slug: "recover"})
    } finally {
      await cleanup()
    }
  })
})
