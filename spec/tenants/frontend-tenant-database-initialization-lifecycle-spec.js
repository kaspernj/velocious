// @ts-check

import { deferred } from "awaitery"
import DatabaseRecord from "../../src/database/record/index.js"
import Migration from "../../src/database/migration/index.js"
import { initializeFrontendDatabase } from "../../src/database/use-database.js"
import Tenant from "../../src/tenants/tenant.js"
import { buildFrontendMigrationContext } from "../helpers/frontend-tenant-migration-test-helper.js"
import { createTenantTestConfiguration } from "../helpers/tenant-test-helpers.js"
import { describe, expect, it } from "../../src/testing/test.js"

describe("frontend tenant database initialization lifecycle", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("rebuilds readiness after close and invalidates it for a new schema generation", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("frontend-tenant-initialize-generation")
    const operationEntered = deferred()
    const releaseOperation = deferred()
    let firstMigrationRuns = 0
    let secondMigrationRuns = 0

    class TenantWidget extends DatabaseRecord {}
    class CreateTenantWidgets extends Migration {
      async up() {
        firstMigrationRuns++
        await this.execute("CREATE TABLE tenant_widgets(id integer PRIMARY KEY AUTOINCREMENT, name varchar(255))")
      }
    }
    class AddTenantWidgetStatus extends Migration {
      async up() {
        secondMigrationRuns++
        await this.addColumn("tenant_widgets", "status", "string")
      }
    }

    TenantWidget.setTableName("tenant_widgets")
    TenantWidget.switchesTenantDatabase("projectTenant")
    CreateTenantWidgets.onDatabases(["projectTenant"])
    AddTenantWidgetStatus.onDatabases(["projectTenant"])
    configuration.getDatabaseConfiguration().projectTenant.migrations = true
    TenantWidget.registerRecordClass({configuration})

    const generationOneMigrations = buildFrontendMigrationContext({"20260813000400-create-tenant-widgets.js": CreateTenantWidgets})
    const generationTwoMigrations = buildFrontendMigrationContext({
      "20260813000400-create-tenant-widgets.js": CreateTenantWidgets,
      "20260813000401-add-tenant-widget-status.js": AddTenantWidgetStatus
    })
    const handle = Tenant.handle({slug: "alpha"}, configuration)

    try {
      await handle.initialize({databaseIdentifier: "projectTenant", migrations: generationOneMigrations, schemaGeneration: "generation-1"})
      await handle.close({databaseIdentifier: "projectTenant", flush: true})
      expect(handle.inspect({databaseIdentifier: "projectTenant"}).ready).toEqual(false)

      await handle.initialize({databaseIdentifier: "projectTenant", migrations: generationOneMigrations, schemaGeneration: "generation-1"})
      expect(firstMigrationRuns).toEqual(1)

      const activeOperation = handle.databaseOperation({databaseIdentifier: "projectTenant"}, async () => {
        operationEntered.resolve(undefined)
        await releaseOperation.promise
      })

      await operationEntered.promise
      await expect(async () => await handle.initialize({databaseIdentifier: "projectTenant", migrations: generationTwoMigrations, schemaGeneration: "generation-2"})).toThrow(/while its physical database is in use/)
      releaseOperation.resolve(undefined)
      await activeOperation

      await handle.initialize({databaseIdentifier: "projectTenant", migrations: generationTwoMigrations, schemaGeneration: "generation-2"})
      expect(firstMigrationRuns).toEqual(1)
      expect(secondMigrationRuns).toEqual(1)
      expect(handle.inspect({databaseIdentifier: "projectTenant"}).schemaGeneration).toEqual("generation-2")

      await handle.databaseOperation({databaseIdentifier: "projectTenant"}, async (operation) => {
        await operation.forModel(TenantWidget).create({name: "ready", status: "active"})
        expect(await operation.forModel(TenantWidget).pluck("status")).toEqual(["active"])
      })
    } finally {
      releaseOperation.resolve(undefined)
      await cleanup()
    }
  })

  it("rejects missing, mismatched, and unresolved tenant initialization contexts", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("frontend-tenant-initialize-rejection")
    const {cleanup: cleanupOther, configuration: otherConfiguration} = await createTenantTestConfiguration("frontend-tenant-initialize-rejection-other")
    const entered = deferred()
    const release = deferred()

    class WaitForRelease extends Migration {
      async up() {
        entered.resolve(undefined)
        await release.promise
      }
    }

    WaitForRelease.onDatabases(["projectTenant"])
    configuration.getDatabaseConfiguration().projectTenant.migrations = true
    const migrations = buildFrontendMigrationContext({"20260813000500-wait-for-release.js": WaitForRelease})
    const alpha = Tenant.handle({slug: "alpha"}, configuration)

    try {
      await expect(async () => await alpha.initialize({databaseIdentifier: "projectTenant", migrations, schemaGeneration: ""})).toThrow(/schemaGeneration/)
      await expect(async () => await alpha.initialize({databaseIdentifier: "default", migrations, schemaGeneration: "generation-1"})).toThrow(/tenant-only SQLite/)
      await expect(async () => await Tenant.handle({slug: ""}, configuration).initialize({databaseIdentifier: "projectTenant", migrations, schemaGeneration: "generation-1"})).toThrow(/Unknown or inactive/)
      await expect(async () => await initializeFrontendDatabase({
        configuration: otherConfiguration,
        databaseIdentifier: "projectTenant",
        migrationsRequireContextCallback: async () => migrations,
        schemaGeneration: "generation-1",
        tenantHandle: alpha
      })).toThrow(/different Velocious configuration/)

      const initializing = alpha.initialize({databaseIdentifier: "projectTenant", migrations, schemaGeneration: "generation-1"})

      await entered.promise
      await expect(async () => await alpha.initialize({databaseIdentifier: "projectTenant", migrations, schemaGeneration: "generation-2"})).toThrow(/mismatched generation/)
      release.resolve(undefined)
      await initializing
    } finally {
      release.resolve(undefined)
      await cleanupOther()
      await cleanup()
    }
  })
})
