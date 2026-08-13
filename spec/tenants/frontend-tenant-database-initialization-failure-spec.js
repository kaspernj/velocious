// @ts-check

import DatabaseRecord from "../../src/database/record/index.js"
import Migration from "../../src/database/migration/index.js"
import Tenant from "../../src/tenants/tenant.js"
import { buildFrontendMigrationContext, tenantSlugFromDatabase } from "../helpers/frontend-tenant-migration-test-helper.js"
import { createTenantTestConfiguration } from "../helpers/tenant-test-helpers.js"
import { describe, expect, it } from "../../src/testing/test.js"

describe("frontend tenant database initialization failures", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("isolates tenant failures and lets only the failed tenant retry", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("frontend-tenant-initialize-failure")
    const attempts = {alpha: 0, beta: 0}

    class TenantWidget extends DatabaseRecord {}
    class CreateTenantWidgets extends Migration {
      async up() {
        const slug = tenantSlugFromDatabase(this.connection())

        attempts[slug]++
        if (slug === "beta" && attempts.beta === 1) throw new Error("beta migration failed")
        await this.execute("CREATE TABLE tenant_widgets(id integer PRIMARY KEY AUTOINCREMENT, name varchar(255))")
      }
    }

    TenantWidget.setTableName("tenant_widgets")
    TenantWidget.switchesTenantDatabase("projectTenant")
    CreateTenantWidgets.onDatabases(["projectTenant"])
    configuration.getDatabaseConfiguration().projectTenant.migrations = true
    TenantWidget.registerRecordClass({configuration})

    const migrations = buildFrontendMigrationContext({"20260813000300-create-tenant-widgets.js": CreateTenantWidgets})
    const alpha = Tenant.handle({slug: "alpha"}, configuration)
    const beta = Tenant.handle({slug: "beta"}, configuration)

    try {
      const results = await Promise.allSettled([
        alpha.initialize({databaseIdentifier: "projectTenant", migrations, schemaGeneration: "generation-1"}),
        beta.initialize({databaseIdentifier: "projectTenant", migrations, schemaGeneration: "generation-1"})
      ])

      expect(results[0].status).toEqual("fulfilled")
      expect(results[1].status).toEqual("rejected")
      expect(alpha.inspect({databaseIdentifier: "projectTenant"}).ready).toEqual(true)
      expect(beta.inspect({databaseIdentifier: "projectTenant"}).ready).toEqual(false)

      await beta.initialize({databaseIdentifier: "projectTenant", migrations, schemaGeneration: "generation-1"})

      expect(attempts).toEqual({alpha: 1, beta: 2})
      expect(beta.inspect({databaseIdentifier: "projectTenant"}).ready).toEqual(true)
    } finally {
      await cleanup()
    }
  })

  it("isolates model metadata failures and retries readiness without replaying the ledger", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("frontend-tenant-initialize-metadata-failure")
    const migrationRuns = {alpha: 0, beta: 0}

    class TenantWidget extends DatabaseRecord {}
    class CreateOnlyAlphaTenantWidgets extends Migration {
      async up() {
        const slug = tenantSlugFromDatabase(this.connection())

        migrationRuns[slug]++
        if (slug === "alpha") {
          await this.execute("CREATE TABLE tenant_widgets(id integer PRIMARY KEY AUTOINCREMENT, name varchar(255))")
        }
      }
    }

    TenantWidget.setTableName("tenant_widgets")
    TenantWidget.switchesTenantDatabase("projectTenant")
    CreateOnlyAlphaTenantWidgets.onDatabases(["projectTenant"])
    configuration.getDatabaseConfiguration().projectTenant.migrations = true
    TenantWidget.registerRecordClass({configuration})

    const migrations = buildFrontendMigrationContext({"20260813000301-create-alpha-tenant-widgets.js": CreateOnlyAlphaTenantWidgets})
    const alpha = Tenant.handle({slug: "alpha"}, configuration)
    const beta = Tenant.handle({slug: "beta"}, configuration)

    try {
      const results = await Promise.allSettled([
        alpha.initialize({databaseIdentifier: "projectTenant", migrations, schemaGeneration: "generation-1"}),
        beta.initialize({databaseIdentifier: "projectTenant", migrations, schemaGeneration: "generation-1"})
      ])

      expect(results[0].status).toEqual("fulfilled")
      expect(results[1].status).toEqual("rejected")
      expect(alpha.inspect({databaseIdentifier: "projectTenant"}).ready).toEqual(true)
      expect(beta.inspect({databaseIdentifier: "projectTenant"}).ready).toEqual(false)
      await expect(async () => await beta.databaseOperation({databaseIdentifier: "projectTenant"}, async () => {})).toThrow(/is not ready/)

      await configuration.withDatabaseOperation({
        databaseConfiguration: beta.databaseConfiguration("projectTenant"),
        databaseIdentifier: "projectTenant",
        name: "Repair metadata failure test fixture",
        tenant: beta.tenant()
      }, async (operation) => {
        await operation.connection().query("CREATE TABLE tenant_widgets(id integer PRIMARY KEY AUTOINCREMENT, name varchar(255))")
      })
      await beta.initialize({databaseIdentifier: "projectTenant", migrations, schemaGeneration: "generation-1"})

      expect(migrationRuns).toEqual({alpha: 1, beta: 1})
      expect(beta.inspect({databaseIdentifier: "projectTenant"}).ready).toEqual(true)
    } finally {
      await cleanup()
    }
  })
})
