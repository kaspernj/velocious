// @ts-check

import {createTenantTestConfiguration} from "../helpers/tenant-test-helpers.js"
import Current from "../../src/current.js"
import DatabaseRecord from "../../src/database/record/index.js"
import MigrationsLedger from "../../src/database/migrations-ledger.js"
import {describe, expect, it} from "../../src/testing/test.js"
import Tenant from "../../src/tenants/tenant.js"
import TestRunner from "../../src/testing/test-runner.js"

describe("test runner tenant pool and cleanup registration", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("leases pool tenants across attempts with per-attempt reset and no cross-test leakage", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("test-runner-tenant-pool")
    /** @type {string[]} */
    const droppedTenants = []
    /** @type {string[]} */
    const provisionedTenants = []
    let previousConfiguration

    try {
      try {
        previousConfiguration = Current.configuration()
      } catch {
        // No previous current configuration.
      }
      configuration.setCurrent()

      await configuration.ensureConnections({databaseIdentifiers: ["default"]}, async (dbs) => {
        await dbs.default.query("CREATE TABLE tenant_values(id integer PRIMARY KEY AUTOINCREMENT, value varchar(255) NOT NULL)")
        await MigrationsLedger.ensureTable(dbs.default)
        await MigrationsLedger.recordVersion(dbs.default, "20261015100000")
      })

      configuration.setTenantDatabaseProviders({
        projectTenant: {
          listTenants: async () => [],
          dropDatabase: async ({tenant}) => {
            droppedTenants.push(/** @type {{slug?: string}} */ (tenant).slug ?? "?")
          }
        }
      })
      configuration.setTestTenantPools({
        projectTenant: {
          provisionTenant: async ({configuration: poolConfiguration, tenant}) => {
            provisionedTenants.push(/** @type {{slug?: string}} */ (tenant).slug ?? "?")

            // Default-equivalent provisioning: create the file-backed tenant
            // connection, then load the default structure and baseline the ledger.
            await poolConfiguration.runWithTenant(tenant, async () => {
              await poolConfiguration.ensureConnections({databaseIdentifiers: ["projectTenant"]}, async (dbs) => {
                const tenantDb = dbs.projectTenant

                if (!tenantDb) throw new Error("Expected a projectTenant connection")

                await tenantDb.query("CREATE TABLE IF NOT EXISTS tenant_values(id integer PRIMARY KEY AUTOINCREMENT, value varchar(255) NOT NULL)")
                await tenantDb.query("CREATE TABLE IF NOT EXISTS schema_migrations(version varchar(255) NOT NULL PRIMARY KEY)")
              })
            })
          },
          tenants: [{slug: "leased-1"}, {slug: "leased-2"}]
        }
      })

      const runner = new TestRunner({configuration, testFiles: []})

      class PoolRow extends DatabaseRecord {}

      PoolRow.setTableName("tenant_values")
      PoolRow.switchesTenantDatabase("projectTenant")
      PoolRow.registerRecordClass({configuration})

      const tests = {
        args: {},
        afterAlls: [],
        afterEaches: [],
        beforeAlls: [],
        beforeEaches: [],
        subs: {},
        tests: {
          "first attempt writes into its leased tenant": {
            args: {databaseCleaning: {transaction: true}},
            function: async (testArgs) => {
              const lease = await testArgs.acquireTestTenant?.({databaseIdentifier: "projectTenant"})

              if (!lease) throw new Error("Expected acquireTestTenant on testArgs")

              expect(lease.tenant).toEqual({slug: "leased-1"})

              await testArgs.registerTransactionalTenant({databaseIdentifier: "projectTenant", tenant: lease.tenant})

              await Tenant.with(lease.tenant, async () => {
                await PoolRow.create({value: "attempt-one"})
              })
            }
          },
          "second attempt gets a clean tenant": {
            args: {databaseCleaning: {transaction: true}},
            function: async (testArgs) => {
              const lease = await testArgs.acquireTestTenant?.({databaseIdentifier: "projectTenant"})

              if (!lease) throw new Error("Expected acquireTestTenant on testArgs")

              // Deterministic reuse order: the released first member is leased again.
              expect(lease.tenant).toEqual({slug: "leased-1"})

              await testArgs.registerTransactionalTenant({databaseIdentifier: "projectTenant", tenant: lease.tenant})

              await Tenant.with(lease.tenant, async (dbs) => {
                const rows = await dbs.projectTenant.query("SELECT value FROM tenant_values")

                // The pool reset truncated the committed row from the first attempt.
                expect(rows).toEqual([])
              })
            }
          },
          "reset truncates committed rows written outside any test transaction": {
            args: {databaseCleaning: {transaction: false, truncate: false}},
            function: async (testArgs) => {
              const lease = await testArgs.acquireTestTenant?.({databaseIdentifier: "projectTenant"})

              if (!lease) throw new Error("Expected acquireTestTenant on testArgs")

              // Committed write through an independent checkout (no test transaction
              // wraps it), so only the pool reset can remove it.
              await configuration.runWithTenant(lease.tenant, async () => {
                await configuration.ensureConnections({databaseIdentifiers: ["projectTenant"]}, async (dbs) => {
                  await dbs.projectTenant.query("INSERT INTO tenant_values(value) VALUES ('committed-leak')")
                })
              })

              const committedRows = await configuration.runWithTenant(lease.tenant, async () => {
                return await configuration.ensureConnections({databaseIdentifiers: ["projectTenant"]}, async (dbs) => {
                  return await dbs.projectTenant.query("SELECT value FROM tenant_values")
                })
              })

              expect(committedRows.map((row) => row.value)).toEqual(["committed-leak"])
            }
          },
          "the next attempt sees the committed row truncated": {
            args: {databaseCleaning: {transaction: false, truncate: false}},
            function: async (testArgs) => {
              const lease = await testArgs.acquireTestTenant?.({databaseIdentifier: "projectTenant"})

              if (!lease) throw new Error("Expected acquireTestTenant on testArgs")

              const rows = await configuration.runWithTenant(lease.tenant, async () => {
                return await configuration.ensureConnections({databaseIdentifiers: ["projectTenant"]}, async (dbs) => {
                  return await dbs.projectTenant.query("SELECT value FROM tenant_values")
                })
              })

              expect(rows).toEqual([])
            }
          }
        }
      }

      await runner.runTests({afterEaches: [], beforeEaches: [], descriptions: [], indentLevel: 0, tests})
      await runner.teardownTestTenantPools()

      expect(runner._failedTests).toBe(0)
      expect(provisionedTenants).toEqual(["leased-1", "leased-2"])
      expect(droppedTenants).toEqual(["leased-1", "leased-2"])
    } finally {
      previousConfiguration?.setCurrent()
      await cleanup()
    }
  })

  it("fails the attempt loudly when the pool is exhausted", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("test-runner-tenant-pool-exhaustion")
    let previousConfiguration

    try {
      try {
        previousConfiguration = Current.configuration()
      } catch {
        // No previous current configuration.
      }
      configuration.setCurrent()

      configuration.setTestTenantPools({
        projectTenant: {
          provisionTenant: async () => {},
          tenants: [{slug: "single"}]
        }
      })

      const runner = new TestRunner({configuration, testFiles: []})
      /** @type {string | undefined} */
      let exhaustionMessage

      const tests = {
        args: {},
        afterAlls: [],
        afterEaches: [],
        beforeAlls: [],
        beforeEaches: [],
        subs: {},
        tests: {
          "holding every member fails the second acquisition": {
            args: {databaseCleaning: {transaction: false, truncate: false}},
            function: async (testArgs) => {
              await testArgs.acquireTestTenant?.({databaseIdentifier: "projectTenant"})

              try {
                await testArgs.acquireTestTenant?.({databaseIdentifier: "projectTenant"})
              } catch (error) {
                exhaustionMessage = error instanceof Error ? error.message : String(error)

                throw error
              }
            }
          }
        }
      }

      await runner.runTests({afterEaches: [], beforeEaches: [], descriptions: [], indentLevel: 0, tests})
      await runner.teardownTestTenantPools()

      expect(runner._failedTests).toBe(1)
      expect(exhaustionMessage ?? "").toContain("exhausted")
    } finally {
      previousConfiguration?.setCurrent()
      await cleanup()
    }
  })

  it("drops tenants registered for cleanup at attempt end without app-side afterEach bookkeeping", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("test-runner-tenant-cleanup")
    /** @type {string[]} */
    const droppedTenants = []
    let previousConfiguration

    try {
      try {
        previousConfiguration = Current.configuration()
      } catch {
        // No previous current configuration.
      }
      configuration.setCurrent()

      configuration.setTenantDatabaseProviders({
        projectTenant: {
          listTenants: async () => [],
          dropDatabase: async ({tenant}) => {
            droppedTenants.push(/** @type {{slug?: string}} */ (tenant).slug ?? "?")
          }
        }
      })

      const runner = new TestRunner({configuration, testFiles: []})

      const tests = {
        args: {},
        afterAlls: [],
        afterEaches: [],
        beforeAlls: [],
        beforeEaches: [],
        subs: {},
        tests: {
          "registered tenant is dropped after afterEach hooks": {
            args: {databaseCleaning: {transaction: false, truncate: false}},
            function: async (testArgs) => {
              testArgs.registerTenantForCleanup?.({databaseIdentifier: "projectTenant", tenant: {slug: "per-test"}})

              // A second registration of the same tenant drops it once per registration;
              // the framework default drop is IF EXISTS-safe, so repeats are harmless.
              expect(droppedTenants).toEqual([])
            }
          }
        }
      }

      await runner.runTests({afterEaches: [], beforeEaches: [], descriptions: [], indentLevel: 0, tests})

      expect(runner._failedTests).toBe(0)
      expect(droppedTenants).toEqual(["per-test"])
    } finally {
      previousConfiguration?.setCurrent()
      await cleanup()
    }
  })

  it("rejects cleanup registration for a non-tenant database identifier", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("test-runner-tenant-cleanup-validation")
    let previousConfiguration

    try {
      try {
        previousConfiguration = Current.configuration()
      } catch {
        // No previous current configuration.
      }
      configuration.setCurrent()

      const runner = new TestRunner({configuration, testFiles: []})
      /** @type {string | undefined} */
      let validationMessage

      const tests = {
        args: {},
        afterAlls: [],
        afterEaches: [],
        beforeAlls: [],
        beforeEaches: [],
        subs: {},
        tests: {
          "non-tenant identifiers fail loudly": {
            args: {databaseCleaning: {transaction: false, truncate: false}},
            function: async (testArgs) => {
              try {
                testArgs.registerTenantForCleanup?.({databaseIdentifier: "default", tenant: {slug: "nope"}})
              } catch (error) {
                validationMessage = error instanceof Error ? error.message : String(error)

                throw error
              }
            }
          }
        }
      }

      await runner.runTests({afterEaches: [], beforeEaches: [], descriptions: [], indentLevel: 0, tests})

      expect(runner._failedTests).toBe(1)
      expect(validationMessage ?? "").toContain("tenantOnly")
    } finally {
      previousConfiguration?.setCurrent()
      await cleanup()
    }
  })
})
