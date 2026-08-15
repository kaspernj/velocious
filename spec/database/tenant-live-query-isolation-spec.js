// @ts-check

import DatabaseRecord from "../../src/database/record/index.js"
import LiveQuery from "../../src/database/live-query.js"
import Migration from "../../src/database/migration/index.js"
import Tenant from "../../src/tenants/tenant.js"
import recordChanges from "../../src/database/record-changes.js"
import { buildFrontendMigrationContext } from "../helpers/frontend-tenant-migration-test-helper.js"
import { createTenantTestConfiguration } from "../helpers/tenant-test-helpers.js"
import { describe, expect, it } from "../../src/testing/test.js"

describe("tenant-isolated live queries", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("routes committed events and refreshes to the physical tenant captured at creation", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("tenant-live-query-isolation")

    class TenantLiveItem extends DatabaseRecord {}
    class CreateTenantLiveItems extends Migration {
      async up() {
        await this.execute("CREATE TABLE tenant_live_items(id integer PRIMARY KEY AUTOINCREMENT, name varchar(255) NOT NULL)")
      }
    }

    TenantLiveItem.setTableName("tenant_live_items")
    TenantLiveItem.switchesTenantDatabase("projectTenant")
    TenantLiveItem.registerRecordClass({configuration})
    CreateTenantLiveItems.onDatabases(["projectTenant"])
    configuration.getDatabaseConfiguration().projectTenant.migrations = true

    const migrations = buildFrontendMigrationContext({"20260815090000-create-tenant-live-items.js": CreateTenantLiveItems})
    const alpha = Tenant.handle({slug: "alpha"}, configuration)
    const beta = Tenant.handle({slug: "beta"}, configuration)
    const alphaEvents = []
    const betaEvents = []

    try {
      await Promise.all([
        alpha.initialize({databaseIdentifier: "projectTenant", migrations, schemaGeneration: "generation-1"}),
        beta.initialize({databaseIdentifier: "projectTenant", migrations, schemaGeneration: "generation-1"})
      ])

      expect(() => recordChanges.subscribe(TenantLiveItem, () => {})).toThrow(/require a captured databaseIdentity/u)

      const unsubscribeAlpha = recordChanges.subscribe(TenantLiveItem, (event) => alphaEvents.push(event), {
        databaseIdentity: alpha.databaseIdentity("projectTenant")
      })
      const unsubscribeBeta = recordChanges.subscribe(TenantLiveItem, (event) => betaEvents.push(event), {
        databaseIdentity: beta.databaseIdentity("projectTenant")
      })
      const source = alpha.liveQuery({
        databaseIdentifier: "projectTenant",
        modelClass: TenantLiveItem,
        query: (query) => query.order("id")
      })
      const liveQuery = new LiveQuery({query: source})
      let notifications = 0
      const unsubscribeState = liveQuery.subscribe(() => notifications++)

      try {
        liveQuery.start()
        await liveQuery.whenSettled()

        expect(notifications).toEqual(1)

        await beta.databaseOperation({databaseIdentifier: "projectTenant"}, async (operation) => {
          await operation.forModel(TenantLiveItem).create({name: "beta-only"})
        })
        await liveQuery.whenSettled()

        expect(notifications).toEqual(1)
        expect(alphaEvents).toHaveLength(0)
        expect(betaEvents).toHaveLength(1)
        expect(betaEvents[0].databaseIdentity).toEqual(beta.databaseIdentity("projectTenant"))

        await alpha.databaseOperation({databaseIdentifier: "projectTenant"}, async (operation) => {
          await operation.forModel(TenantLiveItem).create({name: "alpha-only"})
        })
        await liveQuery.whenSettled()

        expect(notifications).toEqual(2)
        expect(alphaEvents).toHaveLength(1)
        expect(betaEvents).toHaveLength(1)
        expect(liveQuery.getState().results.map((record) => record.readAttribute("name"))).toEqual(["alpha-only"])
      } finally {
        unsubscribeState()
        liveQuery.close()
        unsubscribeAlpha()
        unsubscribeBeta()
      }
    } finally {
      await cleanup()
    }
  })
})
