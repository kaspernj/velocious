// @ts-check

import DatabaseRecord from "../../src/database/record/index.js"
import { createTenantTestConfiguration } from "../helpers/tenant-test-helpers.js"

class TenantOperationItem extends DatabaseRecord {
  /** @returns {string} - Table name. */
  static tableName() { return "tenant_operation_items" }
}

describe("database - operation-scoped transactions - tenant ownership", () => {
  it("rejects same-identifier model work after the tenant physical database changes", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("velocious-operation-tenant")
    const tenants = [{slug: "alpha"}, {slug: "beta"}]

    try {
      for (const tenant of tenants) {
        await configuration.runWithTenant(tenant, async () => {
          await configuration.withConnections(async (dbs) => {
            await dbs.default.query("CREATE TABLE tenant_operation_items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)")
          })
        })
      }

      await configuration.runWithTenant(tenants[0], async () => {
        await configuration.ensureConnections(async () => {
          await TenantOperationItem.initializeRecord({configuration})
        })
      })

      let caughtError

      try {
        await configuration.runWithTenant(tenants[0], async () => {
          await configuration.withTransaction({databaseIdentifier: "default"}, async (operation) => {
            await configuration.runWithTenant(tenants[1], async () => {
              await operation.forModel(TenantOperationItem).create({name: "cross-tenant write"})
            })
          })
        })
      } catch (error) {
        caughtError = error
      }

      expect(caughtError instanceof Error ? caughtError.message : undefined).toContain("different physical database")

      for (const tenant of tenants) {
        await configuration.runWithTenant(tenant, async () => {
          await configuration.withConnections(async (dbs) => {
            expect(await dbs.default.query("SELECT name FROM tenant_operation_items")).toEqual([])
          })
        })
      }
    } finally {
      await cleanup()
    }
  })
})
