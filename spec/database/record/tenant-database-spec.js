// @ts-check

import Current from "../../../src/current.js"
import DatabaseRecord, {TenantDatabaseScopeError} from "../../../src/database/record/index.js"
import {describe, expect, it} from "../../../src/testing/test.js"
import {createTenantTestConfiguration} from "../../helpers/tenant-test-helpers.js"

class TenantAnalyticsRecord extends DatabaseRecord {}
TenantAnalyticsRecord.setTableName("tenant_analytics_records")

TenantAnalyticsRecord.switchesTenantDatabase(({tenant}) => {
  if (tenant && typeof tenant === "object" && tenant.slug) {
    return "analytics"
  }
})

class StaticTenantAnalyticsRecord extends DatabaseRecord {}

StaticTenantAnalyticsRecord.switchesTenantDatabase("analytics")

class StaticProjectTenantRecord extends DatabaseRecord {}

StaticProjectTenantRecord.switchesTenantDatabase("projectTenant")

class GlobalRecord extends DatabaseRecord {}

class TenantRestrictParent extends DatabaseRecord {}
TenantRestrictParent.setTableName("tenant_restrict_parents")

class TenantRestrictChild extends DatabaseRecord {}
TenantRestrictChild.setTableName("tenant_restrict_children")
TenantRestrictChild.switchesTenantDatabase("projectTenant")

TenantRestrictParent.hasMany("tenantRestrictChildren", {
  dependent: "restrict",
  foreignKey: "parentId",
  klass: TenantRestrictChild
})

async function createTenantAnalyticsRecordTable(configuration, tenant) {
  await configuration.runWithTenant(tenant, async () => {
    await configuration.ensureConnections(async (dbs) => {
      await dbs.analytics.query("CREATE TABLE IF NOT EXISTS tenant_analytics_records(id integer PRIMARY KEY AUTOINCREMENT, name varchar(255))")
    })
  })
}

async function initializeTenantAnalyticsRecord(configuration) {
  await configuration.ensureConnections(async (dbs) => {
    await dbs.default.query("CREATE TABLE IF NOT EXISTS tenant_analytics_records(id integer PRIMARY KEY AUTOINCREMENT, name varchar(255))")
    await dbs.analytics.query("CREATE TABLE IF NOT EXISTS tenant_analytics_records(id integer PRIMARY KEY AUTOINCREMENT, name varchar(255))")

    await TenantAnalyticsRecord.initializeRecord({configuration})
  })
}

async function createTenantRestrictTables(configuration, tenants) {
  await configuration.ensureConnections(async (dbs) => {
    await dbs.default.query("CREATE TABLE IF NOT EXISTS tenant_restrict_parents(id integer PRIMARY KEY AUTOINCREMENT, name varchar(255))")

    await TenantRestrictParent.initializeRecord({configuration})
  })

  for (const tenant of tenants) {
    await configuration.runWithTenant(tenant, async () => {
      await configuration.ensureConnections(async (dbs) => {
        await dbs.projectTenant.query("CREATE TABLE IF NOT EXISTS tenant_restrict_children(id integer PRIMARY KEY AUTOINCREMENT, parent_id integer NOT NULL, name varchar(255))")

        await TenantRestrictChild.initializeRecord({configuration})
      })
    })
  }
}

describe("DatabaseRecord tenant database switching", {databaseCleaning: {transaction: true}}, () => {
  it("throws before tenant-switched model queries fall back to the configured database", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("velocious-record-tenant")
    let previousConfiguration

    try {
      try {
        previousConfiguration = Current.configuration()
      } catch {
        // Ignore missing current configuration.
      }

      configuration.setCurrent()
      await initializeTenantAnalyticsRecord(configuration)

      await expect(async () => TenantAnalyticsRecord.getDatabaseIdentifier()).toThrow(TenantDatabaseScopeError)

      await configuration.ensureConnections(async () => {
        await expect(async () => TenantAnalyticsRecord.count()).toThrow(TenantDatabaseScopeError)
      })

      await configuration.runWithTenant({slug: "alpha"}, async () => {
        expect(Current.tenant()).toEqual({slug: "alpha"})
        expect(TenantAnalyticsRecord.getTenantDatabaseIdentifier()).toEqual("analytics")
        expect(TenantAnalyticsRecord.getDatabaseIdentifier()).toEqual("analytics")
      })
    } finally {
      previousConfiguration?.setCurrent()
      await cleanup()
    }
  })

  it("uses resolved tenant database identifiers inside tenant scope", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("velocious-record-tenant-resolved")
    let previousConfiguration

    try {
      try {
        previousConfiguration = Current.configuration()
      } catch {
        // Ignore missing current configuration.
      }

      configuration.setCurrent()
      await initializeTenantAnalyticsRecord(configuration)

      await createTenantAnalyticsRecordTable(configuration, {slug: "alpha"})

      await configuration.runWithTenant({slug: "alpha"}, async () => {
        await configuration.ensureConnections(async () => {
          await TenantAnalyticsRecord.create({name: "Tenant Alpha"})

          expect(await TenantAnalyticsRecord.count()).toEqual(1)
        })
      })
    } finally {
      previousConfiguration?.setCurrent()
      await cleanup()
    }
  })

  it("throws when the current tenant does not resolve a database identifier", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("velocious-record-tenant-missing-scope")
    let previousConfiguration

    try {
      try {
        previousConfiguration = Current.configuration()
      } catch {
        // Ignore missing current configuration.
      }

      configuration.setCurrent()
      await initializeTenantAnalyticsRecord(configuration)

      await configuration.runWithTenant({}, async () => {
        await configuration.ensureConnections(async () => {
          await expect(async () => TenantAnalyticsRecord.count()).toThrow(TenantDatabaseScopeError)
        })
      })
    } finally {
      previousConfiguration?.setCurrent()
      await cleanup()
    }
  })

  it("allows legacy fallback when strict tenant database scopes are disabled", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration(
      "velocious-record-tenant-legacy",
      {enforceTenantDatabaseScopes: false}
    )
    let previousConfiguration

    try {
      try {
        previousConfiguration = Current.configuration()
      } catch {
        // Ignore missing current configuration.
      }

      configuration.setCurrent()
      await initializeTenantAnalyticsRecord(configuration)

      expect(TenantAnalyticsRecord.getDatabaseIdentifier()).toEqual("default")

      await configuration.ensureConnections(async () => {
        expect(await TenantAnalyticsRecord.count()).toEqual(0)
      })
    } finally {
      previousConfiguration?.setCurrent()
      await cleanup()
    }
  })

  it("leaves static and non-tenant database identifiers unchanged", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("velocious-record-tenant-static-active")
    let previousConfiguration

    try {
      try {
        previousConfiguration = Current.configuration()
      } catch {
        // Ignore missing current configuration.
      }

      configuration.setCurrent()
      expect(StaticTenantAnalyticsRecord.getDatabaseIdentifier()).toEqual("analytics")
      expect(GlobalRecord.getDatabaseIdentifier()).toEqual("default")
    } finally {
      previousConfiguration?.setCurrent()
      await cleanup()
    }
  })

  it("throws when a static tenant-only database identifier is inactive", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("velocious-record-tenant-static-inactive")
    let previousConfiguration

    try {
      try {
        previousConfiguration = Current.configuration()
      } catch {
        // Ignore missing current configuration.
      }

      configuration.setCurrent()
      await expect(async () => StaticProjectTenantRecord.getDatabaseIdentifier()).toThrow(TenantDatabaseScopeError)

      await configuration.runWithTenant({}, async () => {
        await expect(async () => StaticProjectTenantRecord.getDatabaseIdentifier()).toThrow(TenantDatabaseScopeError)
      })
    } finally {
      previousConfiguration?.setCurrent()
      await cleanup()
    }
  })

  it("checks dependent restrict relationships in every listed tenant database", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("velocious-record-tenant-dependent-restrict")
    const tenants = [{slug: "alpha"}, {slug: "beta"}]
    let previousConfiguration

    try {
      try {
        previousConfiguration = Current.configuration()
      } catch {
        // Ignore missing current configuration.
      }

      configuration.setCurrent()
      configuration.setTenantDatabaseProviders({
        projectTenant: {
          listTenants: async () => tenants
        }
      })
      await createTenantRestrictTables(configuration, tenants)

      const parent = await TenantRestrictParent.create({name: "Restricted parent"})

      await configuration.runWithTenant({slug: "beta"}, async () => {
        await configuration.ensureConnections(async () => {
          await TenantRestrictChild.create({
            name: "Blocking child",
            parentId: parent.id()
          })
        })
      })

      await expect(async () => parent.destroy()).toThrowError("Cannot delete record because dependent tenantRestrictChildren exist")

      const foundParent = await configuration.ensureConnections(async () => {
        return await TenantRestrictParent.findBy({id: parent.id()})
      })

      expect(foundParent).toBeDefined()
    } finally {
      previousConfiguration?.setCurrent()
      await cleanup()
    }
  })

  it("uses restrict tenant lists instead of lifecycle tenant lists for dependent restrict checks", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("velocious-record-tenant-dependent-restrict-list")
    const tenants = [{slug: "alpha"}, {slug: "beta"}]
    let lifecycleTenantCalls = 0
    let restrictTenantCalls = 0
    let previousConfiguration

    try {
      try {
        previousConfiguration = Current.configuration()
      } catch {
        // Ignore missing current configuration.
      }

      configuration.setCurrent()
      configuration.setTenantDatabaseProviders({
        projectTenant: {
          listRestrictTenants: async () => {
            restrictTenantCalls += 1

            return tenants
          },
          listTenants: async () => {
            lifecycleTenantCalls += 1

            return [{slug: "pending"}]
          }
        }
      })
      await createTenantRestrictTables(configuration, tenants)

      const parent = await TenantRestrictParent.create({name: "Restricted parent"})

      await configuration.runWithTenant({slug: "beta"}, async () => {
        await configuration.ensureConnections(async () => {
          await TenantRestrictChild.create({
            name: "Blocking child",
            parentId: parent.id()
          })
        })
      })

      await expect(async () => parent.destroy()).toThrowError("Cannot delete record because dependent tenantRestrictChildren exist")
      expect(lifecycleTenantCalls).toEqual(0)
      expect(restrictTenantCalls).toEqual(1)
    } finally {
      previousConfiguration?.setCurrent()
      await cleanup()
    }
  })

  it("allows dependent restrict destroys when listed tenant databases have no dependents", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("velocious-record-tenant-dependent-restrict-empty")
    const tenants = [{slug: "alpha"}, {slug: "beta"}]
    let previousConfiguration

    try {
      try {
        previousConfiguration = Current.configuration()
      } catch {
        // Ignore missing current configuration.
      }

      configuration.setCurrent()
      configuration.setTenantDatabaseProviders({
        projectTenant: {
          listTenants: async () => tenants
        }
      })
      await createTenantRestrictTables(configuration, tenants)

      const parent = await TenantRestrictParent.create({name: "Unrestricted parent"})

      await configuration.ensureConnections(async () => {
        await parent.destroy()
      })

      const foundParent = await configuration.ensureConnections(async () => {
        return await TenantRestrictParent.findBy({id: parent.id()})
      })

      expect(foundParent).toEqual(undefined)
    } finally {
      previousConfiguration?.setCurrent()
      await cleanup()
    }
  })
})
