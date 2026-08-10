// @ts-check

import Tenant from "../../src/tenants/tenant.js"
import {createTenantTestConfiguration} from "../helpers/tenant-test-helpers.js"
import {describe, expect, it} from "../../src/testing/test.js"

describe("frontend tenant SQLite lifecycle - Node", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("opens a captured tenant database without exposing its connection", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("frontend-tenant-lifecycle-open")

    try {
      const handle = Tenant.handle({slug: "alpha"}, configuration)
      const snapshot = await handle.open({databaseIdentifier: "projectTenant"})

      expect(snapshot.databaseIdentifier).toEqual("projectTenant")
      expect(snapshot.state).toEqual("open")
      expect("connection" in snapshot).toEqual(false)
    } finally {
      await cleanup()
    }
  })

  it("retains lifecycle-open identities outside ordinary async idle reaping", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("frontend-tenant-lifecycle-async-retention")
    configuration.getDatabaseConfiguration().projectTenant.pool = {idleTimeoutMillis: 0, max: 10}
    const handle = Tenant.handle({slug: "alpha"}, configuration)

    try {
      await handle.open({databaseIdentifier: "projectTenant"})

      expect(configuration.getDatabasePool("projectTenant").getDebugSnapshot().connections.length).toEqual(1)
      expect(handle.inspect({databaseIdentifier: "projectTenant"}).state).toEqual("open")
    } finally {
      await cleanup()
    }
  })

  it("persists through close and removes storage through delete", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("frontend-tenant-lifecycle-persistence")
    const handle = Tenant.handle({slug: "alpha"}, configuration)

    try {
      await handle.databaseOperation({databaseIdentifier: "projectTenant"}, async (operation) => {
        await operation.connection().query("CREATE TABLE lifecycle_values(value TEXT NOT NULL)")
        await operation.connection().query("INSERT INTO lifecycle_values(value) VALUES ('saved')")
      })
      await handle.close({databaseIdentifier: "projectTenant", flush: true})
      await handle.open({databaseIdentifier: "projectTenant"})
      await handle.databaseOperation({databaseIdentifier: "projectTenant"}, async (operation) => {
        expect(await operation.connection().query("SELECT value FROM lifecycle_values")).toEqual([{value: "saved"}])
      })

      await handle.delete({databaseIdentifier: "projectTenant"})
      await handle.open({databaseIdentifier: "projectTenant"})
      await handle.databaseOperation({databaseIdentifier: "projectTenant"}, async (operation) => {
        expect(await operation.connection().getTableByName("lifecycle_values", {throwError: false})).toEqual(undefined)
      })
    } finally {
      await cleanup()
    }
  })

  it("evicts the clean least-recently-used handle and never evicts a scoped pin", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("frontend-tenant-lifecycle-capacity", {frontendTenantSqlite: {maxOpenHandles: 2}})
    const alpha = Tenant.handle({slug: "alpha"}, configuration)
    const beta = Tenant.handle({slug: "beta"}, configuration)
    const gamma = Tenant.handle({slug: "gamma"}, configuration)

    try {
      await alpha.open({databaseIdentifier: "projectTenant"})
      await beta.open({databaseIdentifier: "projectTenant"})
      await alpha.open({databaseIdentifier: "projectTenant"})
      await gamma.open({databaseIdentifier: "projectTenant"})
      expect(alpha.inspect({databaseIdentifier: "projectTenant"}).state).toEqual("open")
      expect(beta.inspect({databaseIdentifier: "projectTenant"}).state).toEqual("closed")

      await alpha.withPin({databaseIdentifier: "projectTenant"}, async () => {
        await beta.open({databaseIdentifier: "projectTenant"})
        expect(alpha.inspect({databaseIdentifier: "projectTenant"}).state).toEqual("open")
        expect(gamma.inspect({databaseIdentifier: "projectTenant"}).state).toEqual("closed")
      })
    } finally {
      await cleanup()
    }
  })

  it("fails closed for unresolved tenant identity", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("frontend-tenant-lifecycle-unresolved")
    const handle = Tenant.handle({slug: ""}, configuration)

    try {
      await expect(async () => await handle.delete({databaseIdentifier: "projectTenant"})).toThrow(/Unknown or inactive/)
    } finally {
      await cleanup()
    }
  })
})
