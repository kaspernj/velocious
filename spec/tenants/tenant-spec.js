// @ts-check

import Current from "../../src/current.js"
import {describe, expect, it} from "../../src/testing/test.js"
import Tenant from "../../src/tenants/tenant.js"
import {createTenantTestConfiguration, seedTenantValue} from "../helpers/tenant-test-helpers.js"

describe("Tenant", () => {
  /**
   * @param {{listTenants: () => Promise<Array<?>> | Array<?>, dropDatabase?: (args: ?) => Promise<void> | void}} provider
   * @param {(args: {configuration: import("../../src/configuration.js").default}) => Promise<void>} callback
   * @returns {Promise<void>}
   */
  async function withConfiguration(provider, callback) {
    const {cleanup, configuration} = await createTenantTestConfiguration("velocious-tenant-facade")
    let previousConfiguration

    configuration.setTenantDatabaseProviders({projectTenant: provider})

    try {
      try {
        previousConfiguration = Current.configuration()
      } catch {
        // Ignore missing current configuration.
      }

      configuration.setCurrent()

      await callback({configuration})
    } finally {
      previousConfiguration?.setCurrent()
      await cleanup()
    }
  }

  it("runs a callback within a tenant context and reads it back via current()", async () => {
    await withConfiguration({listTenants: () => []}, async () => {
      expect(Tenant.current()).toBeUndefined()

      const insideTenant = await Tenant.with({slug: "alpha"}, async () => Tenant.current())

      expect(insideTenant).toEqual({slug: "alpha"})
      expect(Tenant.current()).toBeUndefined()
    })
  })

  it("establishes the tenant's connections so a query inside the callback works without ensureConnections", async () => {
    await withConfiguration({listTenants: () => []}, async ({configuration}) => {
      await seedTenantValue(configuration, "projectTenant", "alpha", "from-alpha")

      const readValue = await Tenant.with({slug: "alpha"}, async (connections) => {
        const rows = await connections.projectTenant.query("SELECT value FROM tenant_values LIMIT 1")

        return rows[0]?.value
      })

      expect(readValue).toEqual("from-alpha")
    })
  })

  it("establishes each tenant's connections during iteration without ensureConnections", async () => {
    await withConfiguration({listTenants: () => [{slug: "alpha"}, {slug: "beta"}]}, async ({configuration}) => {
      await seedTenantValue(configuration, "projectTenant", "alpha", "from-alpha")
      await seedTenantValue(configuration, "projectTenant", "beta", "from-beta")

      /** @type {string[]} */
      const readValues = []

      await Tenant.each({
        callback: async () => {
          const connections = configuration.getCurrentConnections()
          const rows = await connections.projectTenant.query("SELECT value FROM tenant_values LIMIT 1")

          readValues.push(rows[0]?.value)
        },
        configuration,
        identifier: "projectTenant"
      })

      expect(readValues.sort()).toEqual(["from-alpha", "from-beta"])
    })
  })

  it("iterates every tenant the provider lists, running the callback in each tenant context", async () => {
    await withConfiguration({listTenants: () => [{slug: "alpha"}, {slug: "beta"}]}, async ({configuration}) => {
      /** @type {string[]} */
      const seenSlugs = []
      const tenantCount = await Tenant.each({
        callback: async ({tenant}) => {
          const currentTenant = /** @type {{slug: string}} */ (Current.tenant())

          seenSlugs.push(currentTenant.slug)
          expect(tenant).toEqual(currentTenant)
        },
        configuration,
        identifier: "projectTenant"
      })

      expect(tenantCount).toEqual(2)
      expect(seenSlugs.sort()).toEqual(["alpha", "beta"])
    })
  })

  it("only iterates the tenants that pass the filter", async () => {
    await withConfiguration({listTenants: () => [{migrated: true, slug: "alpha"}, {migrated: false, slug: "beta"}]}, async ({configuration}) => {
      /** @type {string[]} */
      const seenSlugs = []
      const tenantCount = await Tenant.each({
        callback: async ({tenant}) => {
          seenSlugs.push(/** @type {{slug: string}} */ (tenant).slug)
        },
        configuration,
        filter: (tenant) => Boolean(/** @type {{migrated: boolean}} */ (tenant).migrated),
        identifier: "projectTenant"
      })

      expect(tenantCount).toEqual(1)
      expect(seenSlugs).toEqual(["alpha"])
    })
  })

  it("drops a tenant through the provider's dropDatabase hook", async () => {
    /** @type {Array<{name: string, slug: string}>} */
    const dropped = []
    const provider = {
      dropDatabase: async (/** @type {{databaseConfiguration: {name: string}, tenant: {slug: string}}} */ {databaseConfiguration, tenant}) => {
        dropped.push({name: databaseConfiguration.name, slug: tenant.slug})
      },
      listTenants: () => []
    }

    await withConfiguration(provider, async ({configuration}) => {
      await Tenant.drop({configuration, identifier: "projectTenant", tenant: {slug: "alpha"}})

      expect(dropped).toEqual([{name: "velocious-tenant-facade-projectTenant-alpha", slug: "alpha"}])
    })
  })

  it("refuses to drop an unresolved tenant instead of dropping the template database", async () => {
    /** @type {string[]} */
    const dropped = []
    const provider = {
      dropDatabase: async (/** @type {{databaseConfiguration: {name: string}}} */ {databaseConfiguration}) => {
        dropped.push(databaseConfiguration.name)
      },
      listTenants: () => []
    }

    await withConfiguration(provider, async ({configuration}) => {
      let caughtError = null

      // A blank slug does not resolve to a tenant database for the tenantOnly identifier.
      try {
        await Tenant.drop({configuration, identifier: "projectTenant", tenant: {slug: ""}})
      } catch (error) {
        caughtError = error
      }

      expect(caughtError instanceof Error && caughtError.message.includes("is inactive for tenant")).toEqual(true)
      expect(dropped).toEqual([])
    })
  })

  it("throws when dropping a tenant whose provider has no dropDatabase hook", async () => {
    await withConfiguration({listTenants: () => []}, async ({configuration}) => {
      let caughtError = null

      try {
        await Tenant.drop({configuration, identifier: "projectTenant", tenant: {slug: "alpha"}})
      } catch (error) {
        caughtError = error
      }

      expect(caughtError instanceof Error && caughtError.message.includes("must define dropDatabase")).toEqual(true)
    })
  })
})
