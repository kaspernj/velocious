// @ts-check

import Tenant from "../../src/tenants/tenant.js"
import {createTenantTestConfiguration} from "../helpers/tenant-test-helpers.js"
import {deferred} from "awaitery"
import {describe, expect, it} from "../../src/testing/test.js"

describe("frontend tenant SQLite lifecycle - concurrency", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("rejects close while a scoped operation pins the captured identity", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("frontend-tenant-lifecycle-concurrency")
    const handle = Tenant.handle({slug: "alpha"}, configuration)
    const entered = deferred()
    const release = deferred()

    try {
      await handle.open({databaseIdentifier: "projectTenant"})
      const operation = handle.databaseOperation({databaseIdentifier: "projectTenant"}, async () => {
        entered.resolve(undefined)
        await release.promise
      })
      await entered.promise

      await expect(async () => await handle.close({databaseIdentifier: "projectTenant"})).toThrow(/pinned/)
      release.resolve(undefined)
      await operation
      await handle.close({databaseIdentifier: "projectTenant"})
      expect(handle.inspect({databaseIdentifier: "projectTenant"}).state).toEqual("closed")
    } finally {
      release.resolve(undefined)
      await cleanup()
    }
  })
})
