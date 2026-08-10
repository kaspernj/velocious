// @ts-check

import SqliteDriver from "../../src/database/drivers/sqlite/index.js"
import SingleMultiUsePool from "../../src/database/pool/single-multi-use.js"
import Tenant from "../../src/tenants/tenant.js"
import {createTenantTestConfiguration} from "../helpers/tenant-test-helpers.js"
import {describe, expect, it} from "../../src/testing/test.js"

class PendingWritesSqliteDriver extends SqliteDriver {
  hasPendingWrites() { return true }
}

describe("frontend tenant SQLite lifecycle - capacity", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("refuses to evict dirty handles and coalesces concurrent opens", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("frontend-tenant-lifecycle-dirty", {frontendTenantSqlite: {maxOpenHandles: 1}})
    const databaseConfiguration = configuration.getDatabaseConfiguration().projectTenant

    databaseConfiguration.driver = PendingWritesSqliteDriver
    databaseConfiguration.poolType = SingleMultiUsePool
    const alpha = Tenant.handle({slug: "alpha"}, configuration)
    const beta = Tenant.handle({slug: "beta"}, configuration)

    try {
      const [first, second] = await Promise.all([
        alpha.open({databaseIdentifier: "projectTenant"}),
        alpha.open({databaseIdentifier: "projectTenant"})
      ])
      expect(first.state).toEqual("open")
      expect(second.state).toEqual("open")
      expect(configuration.inspectFrontendTenantSqliteHandles().openCount).toEqual(1)

      await alpha.databaseOperation({databaseIdentifier: "projectTenant"}, async () => {})
      expect(alpha.inspect({databaseIdentifier: "projectTenant"}).dirty).toEqual(true)
      await expect(async () => await beta.open({databaseIdentifier: "projectTenant"})).toThrow(/every handle is dirty, pinned, or in use/)
      await alpha.flush({databaseIdentifier: "projectTenant"})
      await beta.open({databaseIdentifier: "projectTenant"})
      expect(alpha.inspect({databaseIdentifier: "projectTenant"}).state).toEqual("closed")
    } finally {
      await cleanup()
    }
  })
})
