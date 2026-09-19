// @ts-check

import SqliteDriver from "../../src/database/drivers/sqlite/index.js"
import SingleMultiUsePool from "../../src/database/pool/single-multi-use.js"
import Tenant from "../../src/tenants/tenant.js"
import {createTenantTestConfiguration} from "../helpers/tenant-test-helpers.js"
import { describe, expect, it } from "@velocious/testing"

class PendingWritesSqliteDriver extends SqliteDriver {
  hasPendingWrites() { return true }
}

describe("frontend tenant SQLite lifecycle - capacity", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("keeps residency bounded and physical identities distinct through many-project churn", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("frontend-tenant-lifecycle-many-projects", {frontendTenantSqlite: {maxOpenHandles: 3}})
    const handles = Array.from({length: 40}, (_value, index) => Tenant.handle({slug: `project-${index}`}, configuration))
    const identities = handles.map((handle) => handle.databaseIdentity("projectTenant"))

    try {
      expect(new Set(identities).size).toEqual(handles.length)

      for (const handle of handles) {
        await handle.open({databaseIdentifier: "projectTenant"})
        expect(configuration.inspectFrontendTenantSqliteHandles().openCount).toBeLessThanOrEqual(3)
      }
      for (const handle of handles.toReversed()) {
        await handle.open({databaseIdentifier: "projectTenant"})
        expect(configuration.inspectFrontendTenantSqliteHandles().openCount).toBeLessThanOrEqual(3)
      }

      expect(configuration.inspectFrontendTenantSqliteHandles().handles).toHaveLength(3)
    } finally {
      await cleanup()
    }
  })

  it("retains every lifecycle-open identity in a single multi-use pool", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("frontend-tenant-lifecycle-single-retention", {frontendTenantSqlite: {maxOpenHandles: 2}})
    const databaseConfiguration = configuration.getDatabaseConfiguration().projectTenant

    databaseConfiguration.poolType = SingleMultiUsePool
    const alpha = Tenant.handle({slug: "alpha"}, configuration)
    const beta = Tenant.handle({slug: "beta"}, configuration)

    try {
      await alpha.open({databaseIdentifier: "projectTenant"})
      await beta.open({databaseIdentifier: "projectTenant"})

      expect(configuration.getDatabasePool("projectTenant").getDebugSnapshot().connections.length).toEqual(2)
      expect(alpha.inspect({databaseIdentifier: "projectTenant"}).state).toEqual("open")
      expect(beta.inspect({databaseIdentifier: "projectTenant"}).state).toEqual("open")
    } finally {
      await cleanup()
    }
  })

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
