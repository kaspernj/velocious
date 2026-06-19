// @ts-check

import Current from "../../src/current.js"
import {describe, expect, it} from "../../src/testing/test.js"
import {createTenantTestConfiguration, readTenantValue, seedTenantValue} from "../helpers/tenant-test-helpers.js"

describe("Configuration tenant support", {databaseCleaning: {transaction: true}}, () => {
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
      expect(configuration.getDatabaseIdentifiers()).toEqual(["analytics", "default"])
      await seedTenantValue(configuration, "default", undefined, "default-default")
      await seedTenantValue(configuration, "analytics", undefined, "default-analytics")
      await seedTenantValue(configuration, "default", "alpha", "alpha-default")
      await seedTenantValue(configuration, "analytics", "alpha", "alpha-analytics")
      await seedTenantValue(configuration, "projectTenant", "alpha", "alpha-project-tenant")
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
      expect(await readTenantValue(configuration, "projectTenant", "alpha")).toEqual("alpha-project-tenant")
      expect(await readTenantValue(configuration, "default", "beta")).toEqual("beta-default")
      expect(await readTenantValue(configuration, "analytics", "beta")).toEqual("beta-analytics")

      await configuration.runWithTenant({slug: "alpha"}, async () => {
        expect(configuration.getDatabaseIdentifiers()).toEqual(["analytics", "default", "projectTenant"])
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

  it("reuses current async-context connections and checks out only missing databases", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("velocious-config-partial-connections")

    try {
      configuration.getDatabaseConfiguration().default.pool = {checkoutTimeoutMillis: 10, max: 1}

      const analyticsPool = configuration.getDatabasePool("analytics")
      const defaultPool = configuration.getDatabasePool("default")

      await defaultPool.withConnection({name: "held default connection"}, async (defaultConnection) => {
        await configuration.ensureConnections({name: "partial ensure"}, async (dbs) => {
          expect(dbs.default).toBe(defaultConnection)
          expect(dbs.analytics).toBeDefined()
          expect(analyticsPool.getDebugSnapshot().inUseCount).toEqual(1)
          expect(defaultPool.getDebugSnapshot().inUseCount).toEqual(1)
        })

        expect(analyticsPool.getDebugSnapshot().inUseCount).toEqual(0)
        expect(defaultPool.getDebugSnapshot().inUseCount).toEqual(1)
      })

      expect(analyticsPool.getDebugSnapshot().inUseCount).toEqual(0)
      expect(defaultPool.getDebugSnapshot().inUseCount).toEqual(0)
    } finally {
      await cleanup()
    }
  })

  it("checks out fallback-only connections when another database is missing", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("velocious-config-test-shared-partial-connections")

    try {
      const defaultPool = configuration.getDatabasePool("default")
      const testSharedConnection = await defaultPool.spawnConnection()

      defaultPool.setTestSharedConnection(testSharedConnection)

      await configuration.ensureConnections({name: "partial ensure with fallback"}, async (dbs) => {
        const scopedDefaultConnection = defaultPool.getCurrentConnection()

        expect(dbs.default).toBe(scopedDefaultConnection)
        expect(dbs.default).not.toBe(testSharedConnection)
        expect(dbs.analytics).toBeDefined()
      })
    } finally {
      await cleanup()
    }
  })

  it("suppresses async-tracked test shared fallback connections when current contexts are cleared", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("velocious-config-test-shared-suppressed-context")

    try {
      const defaultPool = configuration.getDatabasePool("default")
      const testSharedConnection = await defaultPool.spawnConnection()
      let contextConnection
      let configurationConnectionCount = 0

      defaultPool.setTestSharedConnection(testSharedConnection)

      await configuration.withoutCurrentConnectionContexts(async () => {
        await Promise.resolve()
        contextConnection = defaultPool.getCurrentContextConnection()
        configurationConnectionCount = Object.keys(configuration.getCurrentConnections()).length
      })

      expect(contextConnection).toBeUndefined()
      expect(configurationConnectionCount).toEqual(0)
    } finally {
      await cleanup()
    }
  })
})
