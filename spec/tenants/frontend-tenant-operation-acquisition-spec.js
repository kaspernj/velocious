// @ts-check

import { deferred } from "awaitery"
import DatabaseRecord from "../../src/database/record/index.js"
import Migration from "../../src/database/migration/index.js"
import Tenant from "../../src/tenants/tenant.js"
import { buildFrontendMigrationContext } from "../helpers/frontend-tenant-migration-test-helper.js"
import { createTenantTestConfiguration } from "../helpers/tenant-test-helpers.js"
import { describe, expect, it } from "../../src/testing/test.js"

describe("frontend tenant operation acquisition", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("does not admit an old-generation operation behind a queued replacement", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("frontend-tenant-operation-generation-race")
    const replacementEntered = deferred()
    const releaseReplacement = deferred()

    class TenantWidget extends DatabaseRecord {}
    class CreateTenantWidgets extends Migration {
      async up() {
        await this.execute("CREATE TABLE tenant_widgets(id integer PRIMARY KEY AUTOINCREMENT, name varchar(255))")
      }
    }
    class ReplaceTenantWidgetGeneration extends Migration {
      async up() {
        replacementEntered.resolve(undefined)
        await releaseReplacement.promise
        await this.addColumn("tenant_widgets", "status", "string")
      }
    }

    TenantWidget.setTableName("tenant_widgets")
    TenantWidget.switchesTenantDatabase("projectTenant")
    CreateTenantWidgets.onDatabases(["projectTenant"])
    ReplaceTenantWidgetGeneration.onDatabases(["projectTenant"])
    configuration.getDatabaseConfiguration().projectTenant.migrations = true
    TenantWidget.registerRecordClass({configuration})

    const generationOne = buildFrontendMigrationContext({"20260813000700-create-tenant-widgets.js": CreateTenantWidgets})
    const generationTwo = buildFrontendMigrationContext({
      "20260813000700-create-tenant-widgets.js": CreateTenantWidgets,
      "20260813000701-replace-tenant-widget-generation.js": ReplaceTenantWidgetGeneration
    })
    const handle = Tenant.handle({slug: "alpha"}, configuration)

    try {
      await handle.initialize({databaseIdentifier: "projectTenant", migrations: generationOne, schemaGeneration: "generation-1"})

      const replacement = handle.initialize({databaseIdentifier: "projectTenant", migrations: generationTwo, schemaGeneration: "generation-2"})
      const staleOperationExpectation = expect(async () => await handle.databaseOperation({databaseIdentifier: "projectTenant"}, async () => "stale operation entered"))
        .toThrow(/not ready for schema generation "generation-2"/)

      await replacementEntered.promise
      releaseReplacement.resolve(undefined)
      await replacement

      await staleOperationExpectation
    } finally {
      releaseReplacement.resolve(undefined)
      await cleanup()
    }
  })
})
