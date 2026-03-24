// @ts-check

import Current from "../../src/current.js"
import {describe, expect, it} from "../../src/testing/test.js"
import {createTenantTestConfiguration, readTenantValue, seedTenantValue} from "../helpers/tenant-test-helpers.js"

describe("Configuration tenant support", () => {
  it("switches database configs and current tenant across multiple databases", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("velocious-config-tenant")
    let previousConfiguration

    try {
      try {
        previousConfiguration = Current.configuration()
      } catch {
        // Ignore missing current configuration.
      }

      configuration.setCurrent()
      await seedTenantValue(configuration, "default", undefined, "default-default")
      await seedTenantValue(configuration, "analytics", undefined, "default-analytics")
      await seedTenantValue(configuration, "default", "alpha", "alpha-default")
      await seedTenantValue(configuration, "analytics", "alpha", "alpha-analytics")
      await seedTenantValue(configuration, "default", "beta", "beta-default")
      await seedTenantValue(configuration, "analytics", "beta", "beta-analytics")

      const alphaDatabaseName = configuration.resolveDatabaseConfiguration("default", {slug: "alpha"}).name
      const betaDatabaseName = configuration.resolveDatabaseConfiguration("default", {slug: "beta"}).name

      expect(alphaDatabaseName).toEqual("velocious-config-tenant-default-alpha")
      expect(betaDatabaseName).toEqual("velocious-config-tenant-default-beta")
      expect(await readTenantValue(configuration, "default", undefined)).toEqual("default-default")
      expect(await readTenantValue(configuration, "analytics", undefined)).toEqual("default-analytics")
      expect(await readTenantValue(configuration, "default", "alpha")).toEqual("alpha-default")
      expect(await readTenantValue(configuration, "analytics", "alpha")).toEqual("alpha-analytics")
      expect(await readTenantValue(configuration, "default", "beta")).toEqual("beta-default")
      expect(await readTenantValue(configuration, "analytics", "beta")).toEqual("beta-analytics")

      await configuration.runWithTenant({slug: "alpha"}, async () => {
        expect(Current.tenant()).toEqual({slug: "alpha"})
        expect(configuration.getCurrentTenant()).toEqual({slug: "alpha"})
      })
    } finally {
      previousConfiguration?.setCurrent()
      await cleanup()
    }
  })

  it("does not reuse current async-context connections across tenant switches", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("velocious-config-tenant-nested")

    try {
      await seedTenantValue(configuration, "default", undefined, "default-default")
      await seedTenantValue(configuration, "default", "alpha", "alpha-default")

      await configuration.ensureConnections(async () => {
        await configuration.runWithTenant({slug: "alpha"}, async () => {
          await configuration.ensureConnections(async (dbs) => {
            const rows = await dbs.default.query("SELECT value FROM tenant_values LIMIT 1")

            expect(dbs.default.getArgs().name).toEqual("velocious-config-tenant-nested-default-alpha")
            expect(rows[0]?.value).toEqual("alpha-default")
          })
        })
      })
    } finally {
      await cleanup()
    }
  })
})
