// @ts-check

import { deferred } from "awaitery"
import DatabaseRecord from "../../src/database/record/index.js"
import Migration from "../../src/database/migration/index.js"
import MigrationsLedger from "../../src/database/migrations-ledger.js"
import Tenant from "../../src/tenants/tenant.js"
import { buildFrontendMigrationContext, tenantSlugFromDatabase } from "../helpers/frontend-tenant-migration-test-helper.js"
import { createTenantTestConfiguration } from "../helpers/tenant-test-helpers.js"
import { describe, expect, it } from "../../src/testing/test.js"

describe("frontend tenant database initialization concurrency", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("migrates distinct tenants concurrently and keeps their model metadata isolated", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("frontend-tenant-initialize-concurrent")
    const alphaEntered = deferred()
    const betaEntered = deferred()
    const release = deferred()

    class TenantWidget extends DatabaseRecord {
      constructor(changes = /** @type {Record<string, string>} */ ({})) {
        super(changes)
      }
    }
    class CreateTenantWidgets extends Migration {
      async up() {
        const slug = tenantSlugFromDatabase(this.connection())

        if (slug === "alpha") alphaEntered.resolve(undefined)
        if (slug === "beta") betaEntered.resolve(undefined)
        await Promise.all([alphaEntered.promise, betaEntered.promise])
        await release.promise
        await this.execute(`CREATE TABLE tenant_widgets(id integer PRIMARY KEY AUTOINCREMENT, ${slug}_value varchar(255))`)
      }
    }

    TenantWidget.setTableName("tenant_widgets")
    TenantWidget.switchesTenantDatabase("projectTenant")
    CreateTenantWidgets.onDatabases(["projectTenant"])
    configuration.getDatabaseConfiguration().projectTenant.migrations = true
    TenantWidget.registerRecordClass({configuration})

    const migrations = buildFrontendMigrationContext({"20260813000100-create-tenant-widgets.js": CreateTenantWidgets})
    const alpha = Tenant.handle({slug: "alpha"}, configuration)
    const beta = Tenant.handle({slug: "beta"}, configuration)

    try {
      const alphaInitialization = alpha.initialize({databaseIdentifier: "projectTenant", migrations, schemaGeneration: "generation-1"})
      const betaInitialization = beta.initialize({databaseIdentifier: "projectTenant", migrations, schemaGeneration: "generation-1"})

      await Promise.all([alphaEntered.promise, betaEntered.promise])
      release.resolve(undefined)
      await Promise.all([alphaInitialization, betaInitialization])

      await alpha.databaseOperation({databaseIdentifier: "projectTenant"}, async (operation) => {
        await operation.forModel(TenantWidget).create({alphaValue: "alpha"})
        expect(await operation.forModel(TenantWidget).pluck("alphaValue")).toEqual(["alpha"])
      })
      await beta.databaseOperation({databaseIdentifier: "projectTenant"}, async (operation) => {
        await operation.forModel(TenantWidget).create({betaValue: "beta"})
        expect(await operation.forModel(TenantWidget).pluck("betaValue")).toEqual(["beta"])
      })
    } finally {
      release.resolve(undefined)
      await cleanup()
    }
  })

  it("deduplicates one physical tenant generation and applies its ledger once", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("frontend-tenant-initialize-deduplicate")
    const entered = deferred()
    const release = deferred()
    let migrationRuns = 0

    class TenantWidget extends DatabaseRecord {}
    class CreateTenantWidgets extends Migration {
      async up() {
        migrationRuns++
        entered.resolve(undefined)
        await release.promise
        await this.execute("CREATE TABLE tenant_widgets(id integer PRIMARY KEY AUTOINCREMENT, name varchar(255))")
      }
    }

    TenantWidget.setTableName("tenant_widgets")
    TenantWidget.switchesTenantDatabase("projectTenant")
    CreateTenantWidgets.onDatabases(["projectTenant"])
    configuration.getDatabaseConfiguration().projectTenant.migrations = true
    TenantWidget.registerRecordClass({configuration})

    const migrations = buildFrontendMigrationContext({"20260813000200-create-tenant-widgets.js": CreateTenantWidgets})
    const first = Tenant.handle({slug: "alpha"}, configuration)
    const second = Tenant.handle({slug: "alpha"}, configuration)

    try {
      const firstInitialization = first.initialize({databaseIdentifier: "projectTenant", migrations, schemaGeneration: "generation-1"})
      const secondInitialization = second.initialize({databaseIdentifier: "projectTenant", migrations, schemaGeneration: "generation-1"})

      await entered.promise
      expect(migrationRuns).toEqual(1)
      release.resolve(undefined)
      await Promise.all([firstInitialization, secondInitialization])

      await first.databaseOperation({databaseIdentifier: "projectTenant"}, async (operation) => {
        expect(await MigrationsLedger.appliedVersions(operation.connection())).toEqual(["20260813000200"])
      })
      expect(first.inspect({databaseIdentifier: "projectTenant"}).schemaGeneration).toEqual("generation-1")
      expect(first.inspect({databaseIdentifier: "projectTenant"}).ready).toEqual(true)
      expect(first.inspect({databaseIdentifier: "projectTenant"}).pinCount).toEqual(0)
    } finally {
      release.resolve(undefined)
      await cleanup()
    }
  })
})
