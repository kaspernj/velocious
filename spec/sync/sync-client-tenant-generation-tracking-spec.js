// @ts-check

import DatabaseRecord from "../../src/database/record/index.js"
import Migration from "../../src/database/migration/index.js"
import SyncClient from "../../src/sync/sync-client.js"
import Tenant from "../../src/tenants/tenant.js"
import { buildFrontendMigrationContext } from "../helpers/frontend-tenant-migration-test-helper.js"
import { buildMutationLog, conflictTracking } from "../helpers/sync-client-conflict-tracking-helper.js"
import { createTenantTestConfiguration } from "../helpers/tenant-test-helpers.js"
import { describe, expect, it } from "../../src/testing/test.js"

describe("tenant SyncClient schema-generation tracking", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("does not let a stale started client track records from a replacement generation", async () => {
    const errors = []
    const mutationIds = ["mutation-1", "mutation-2", "mutation-3"]
    const mutationLog = buildMutationLog(mutationIds)
    const {cleanup, configuration} = await createTenantTestConfiguration("sync-client-tenant-generation-tracking", {
      sync: {
        client: {
          authenticationToken: () => "token-1",
          isOnline: () => false,
          onError: (error) => errors.push(error),
          transport: {post: async () => ({json: () => ({status: "success", syncs: []})})}
        }
      }
    })

    class TenantTrackedItem extends DatabaseRecord {
      static sync = true
    }
    class TenantConflictItem extends DatabaseRecord {
      static sync = {conflictTracking: conflictTracking(mutationLog, mutationIds)}
    }
    class TenantPendingSync extends DatabaseRecord {}
    class CreateTenantTrackingTables extends Migration {
      async up() {
        await this.execute("CREATE TABLE tenant_tracked_items(id integer PRIMARY KEY, name varchar(255) NOT NULL)")
        await this.execute("CREATE TABLE tenant_conflict_items(id integer PRIMARY KEY, name varchar(255) NOT NULL, version integer NOT NULL)")
        await this.execute("CREATE TABLE tenant_pending_syncs(id integer PRIMARY KEY AUTOINCREMENT, resource_id varchar(255) NOT NULL, resource_type varchar(255) NOT NULL, sync_type varchar(255) NOT NULL, data text, state varchar(255) NOT NULL, created_at datetime, updated_at datetime)")
      }
    }

    for (const modelClass of [TenantTrackedItem, TenantConflictItem, TenantPendingSync]) {
      modelClass.switchesTenantDatabase("projectTenant")
      modelClass.registerRecordClass({configuration})
    }
    TenantTrackedItem.setTableName("tenant_tracked_items")
    TenantConflictItem.setTableName("tenant_conflict_items")
    TenantPendingSync.setTableName("tenant_pending_syncs")
    TenantPendingSync.belongsTo("resource", {polymorphic: true})
    CreateTenantTrackingTables.onDatabases(["projectTenant"])
    configuration.getDatabaseConfiguration().projectTenant.migrations = true

    const migrations = buildFrontendMigrationContext({"20260815180000-create-tenant-tracking-tables.js": CreateTenantTrackingTables})
    const tenant = Tenant.handle({slug: "alpha"}, configuration)
    /** @type {SyncClient | undefined} */
    let oldClient
    /** @type {SyncClient | undefined} */
    let newClient

    try {
      await tenant.initialize({databaseIdentifier: "projectTenant", migrations, schemaGeneration: "generation-1"})
      oldClient = new SyncClient({configuration, databaseIdentifier: "projectTenant", syncModel: TenantPendingSync, tenantHandle: tenant})
      await oldClient.start()

      await tenant.close({databaseIdentifier: "projectTenant"})
      await tenant.initialize({databaseIdentifier: "projectTenant", migrations, schemaGeneration: "generation-2"})

      await tenant.databaseOperation({databaseIdentifier: "projectTenant"}, async (operation) => {
        await operation.forModel(TenantTrackedItem).create({id: 1, name: "stale-tracked"})
        await operation.forModel(TenantConflictItem).create({id: 1, name: "stale-conflict", version: 1})
      })
      await oldClient.waitForScheduledReplay()

      await tenant.databaseOperation({databaseIdentifier: "projectTenant"}, async (operation) => {
        expect(await operation.forModel(TenantPendingSync).count()).toEqual(0)
      })
      const conflictLog = oldClient.config.resources.TenantConflictItem.conflictTracking?.mutationLog

      expect(await conflictLog?.records()).toHaveLength(0)
      expect(errors.map((error) => error.message)).toEqual([])

      newClient = new SyncClient({configuration, databaseIdentifier: "projectTenant", syncModel: TenantPendingSync, tenantHandle: tenant})
      await newClient.start()

      await tenant.databaseOperation({databaseIdentifier: "projectTenant"}, async (operation) => {
        await operation.forModel(TenantTrackedItem).create({id: 2, name: "current-tracked"})
        await operation.forModel(TenantConflictItem).create({id: 2, name: "current-conflict", version: 1})
      })
      await Promise.all([oldClient.waitForScheduledReplay(), newClient.waitForScheduledReplay()])

      await tenant.databaseOperation({databaseIdentifier: "projectTenant"}, async (operation) => {
        expect(await operation.forModel(TenantPendingSync).count()).toEqual(1)
      })
      expect(await conflictLog?.records()).toHaveLength(1)
      expect(errors.map((error) => error.message)).toEqual([])
    } finally {
      oldClient?.stop()
      newClient?.stop()
      await cleanup()
    }
  })
})
