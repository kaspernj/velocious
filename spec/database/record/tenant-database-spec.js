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
})
