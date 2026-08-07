// @ts-check

import Current from "../../src/current.js"
import DatabaseRecord from "../../src/database/record/index.js"
import EnvironmentHandlerBrowser from "../../src/environment-handlers/browser.js"
import Tenant from "../../src/tenants/tenant.js"
import TenantHandle from "../../src/tenants/tenant-handle.js"
import {deferred, waitFor} from "awaitery"
import {createTenantTestConfiguration, seedTenantValue} from "../helpers/tenant-test-helpers.js"

describe("Tenant immutable handle context", () => {
  /**
   * @param {string} prefix - Test database prefix.
   * @param {(args: {configuration: import("../../src/configuration.js").default, TenantItem: typeof DatabaseRecord}) => Promise<void>} callback - Test callback.
   * @returns {Promise<void>}
   */
  async function withBrowserConfiguration(prefix, callback) {
    const {cleanup, configuration} = await createTenantTestConfiguration(prefix, {
      environmentHandler: new EnvironmentHandlerBrowser()
    })
    let previousConfiguration

    class TenantItem extends DatabaseRecord {}

    TenantItem.setTableName("tenant_handle_items")
    TenantItem.switchesTenantDatabase("projectTenant")

    try {
      try {
        previousConfiguration = Current.configuration()
      } catch {
        // Ignore missing current configuration.
      }

      configuration.setCurrent()

      for (const slug of ["alpha", "beta"]) {
        await configuration.runWithTenant({slug}, async () => {
          await configuration.ensureConnections(async (connections) => {
            await connections.projectTenant.query("CREATE TABLE tenant_handle_items(id integer PRIMARY KEY AUTOINCREMENT, name varchar(255))")
            await connections.projectTenant.query(`INSERT INTO tenant_handle_items(name) VALUES ('${slug}')`)

            if (!TenantItem.isInitialized()) await TenantItem.initializeRecord({configuration})
          })
        })
      }

      await callback({configuration, TenantItem})
    } finally {
      previousConfiguration?.setCurrent()
      await cleanup()
    }
  }

  it("keeps overlapping browser operations pinned to their captured physical tenants", async () => {
    await withBrowserConfiguration("velocious-tenant-handle-overlap", async ({TenantItem}) => {
      const alpha = Tenant.handle({slug: "alpha"})
      const beta = Tenant.handle({slug: "beta"})
      /** @type {() => void} */
      let releaseAlpha = () => {}
      /** @type {() => void} */
      let markAlphaStarted = () => {}
      const alphaStarted = new Promise((resolve) => { markAlphaStarted = resolve })
      const alphaCanFinish = new Promise((resolve) => { releaseAlpha = resolve })

      const alphaResult = alpha.databaseOperation({databaseIdentifier: "projectTenant"}, async (operation) => {
        markAlphaStarted()
        await alphaCanFinish

        const rows = await operation.forModel(TenantItem).toArray()

        return {
          databaseName: operation.connection().getArgs().name,
          names: rows.map((record) => record.readAttribute("name")),
          tenant: operation.tenant()
        }
      })

      await alphaStarted

      const betaResult = await beta.databaseOperation({databaseIdentifier: "projectTenant"}, async (operation) => {
        const rows = await operation.forModel(TenantItem).toArray()

        return {
          databaseName: operation.connection().getArgs().name,
          names: rows.map((record) => record.readAttribute("name")),
          tenant: operation.tenant()
        }
      })

      releaseAlpha()

      expect(await alphaResult).toEqual({
        databaseName: "velocious-tenant-handle-overlap-projectTenant-alpha",
        names: ["alpha"],
        tenant: {slug: "alpha"}
      })
      expect(betaResult).toEqual({
        databaseName: "velocious-tenant-handle-overlap-projectTenant-beta",
        names: ["beta"],
        tenant: {slug: "beta"}
      })
    })
  })

  it("keeps a query created for tenant A bound while tenant B runs", async () => {
    await withBrowserConfiguration("velocious-tenant-handle-delayed-query", async ({TenantItem}) => {
      const alpha = TenantItem.usingTenant({slug: "alpha"})
      const beta = TenantItem.usingTenant({slug: "beta"})

      const names = await alpha.databaseOperation(async (alphaScope) => {
        const alphaQuery = alphaScope.where({name: "alpha"})

        await beta.databaseOperation(async (betaScope) => {
          expect((await betaScope.toArray()).map((record) => record.readAttribute("name"))).toEqual(["beta"])
        })

        return (await alphaQuery.toArray()).map((record) => record.readAttribute("name"))
      })

      expect(names).toEqual(["alpha"])
    })
  })

  it("restores nested browser tenant scopes after success and exceptions", async () => {
    await withBrowserConfiguration("velocious-tenant-handle-nested", async ({configuration}) => {
      expect(Current.tenant()).toBeUndefined()

      await configuration.runWithTenant({slug: "alpha"}, async () => {
        await configuration.runWithTenant({slug: "beta"}, async () => {
          expect(Current.tenant()).toEqual({slug: "beta"})
        })

        expect(Current.tenant()).toEqual({slug: "alpha"})

        try {
          await configuration.runWithTenant({slug: "beta"}, async () => {
            throw new Error("nested failure")
          })
        } catch (error) {
          expect(error instanceof Error ? error.message : undefined).toEqual("nested failure")
        }

        expect(Current.tenant()).toEqual({slug: "alpha"})
      })

      expect(Current.tenant()).toBeUndefined()
    })
  })

  it("removes completed non-LIFO browser scopes from ambient tenant state", async () => {
    await withBrowserConfiguration("velocious-tenant-handle-non-lifo", async ({configuration}) => {
      const alphaCanFinish = deferred()
      const alphaStarted = deferred()
      const betaCanFinish = deferred()
      const betaStarted = deferred()

      const alphaPromise = configuration.runWithTenant({slug: "alpha"}, async () => {
        alphaStarted.resolve(undefined)
        await alphaCanFinish.promise
      })

      await alphaStarted.promise

      const betaPromise = configuration.runWithTenant({slug: "beta"}, async () => {
        betaStarted.resolve(undefined)
        await betaCanFinish.promise
      })

      await betaStarted.promise
      expect(Current.tenant()).toEqual({slug: "beta"})

      alphaCanFinish.resolve(undefined)
      await alphaPromise
      expect(Current.tenant()).toEqual({slug: "beta"})

      betaCanFinish.resolve(undefined)
      await betaPromise
      expect(Current.tenant()).toBeUndefined()
    })
  })

  it("captures and deeply freezes the tenant descriptor", async () => {
    await withBrowserConfiguration("velocious-tenant-handle-frozen-tenant", async ({TenantItem}) => {
      const tenant = {metadata: {labels: ["original"]}, slug: "alpha"}
      const handle = Tenant.handle(tenant)

      tenant.slug = "beta"
      tenant.metadata.labels[0] = "changed"

      expect(handle.tenant()).toEqual({metadata: {labels: ["original"]}, slug: "alpha"})
      await expect(() => {
        handle.tenant().slug = "beta"
      }).toThrow()
      await expect(() => {
        /** @type {{metadata: {labels: string[]}}} */ (handle.tenant()).metadata.labels.push("changed")
      }).toThrow()

      await handle.databaseOperation({databaseIdentifier: "projectTenant"}, async (operation) => {
        expect(operation.tenant()).toEqual({metadata: {labels: ["original"]}, slug: "alpha"})
        expect((await operation.forModel(TenantItem).pluck("name"))).toEqual(["alpha"])
        await expect(() => {
          if (operation.tenant()) operation.tenant().slug = "beta"
        }).toThrow()
      })
    })
  })

  it("captures dangerous JSON keys as immutable own data without inherited routing", async () => {
    await withBrowserConfiguration("velocious-tenant-handle-dangerous-keys", async () => {
      const tenant = JSON.parse('{"__proto__":{"slug":"beta"},"constructor":{"name":"tenant-constructor"},"prototype":{"nested":{"__proto__":{"slug":"nested-victim"},"constructor":"nested-constructor","prototype":"nested-prototype"}}}')
      const handle = Tenant.handle(tenant)
      const capturedTenant = handle.tenant()
      const nested = /** @type {{nested: Record<string, ReturnType<typeof JSON.parse>>}} */ (capturedTenant.prototype).nested

      expect(Object.getPrototypeOf(capturedTenant)).toBe(Object.prototype)
      expect(Object.keys(capturedTenant)).toEqual(["__proto__", "constructor", "prototype"])
      expect(Object.hasOwn(capturedTenant, "__proto__")).toBe(true)
      expect(Object.hasOwn(capturedTenant, "constructor")).toBe(true)
      expect(Object.hasOwn(capturedTenant, "prototype")).toBe(true)
      expect(capturedTenant.slug).toBeUndefined()
      expect(capturedTenant.__proto__).toEqual({slug: "beta"})
      expect(Object.getPrototypeOf(nested)).toBe(Object.prototype)
      expect(Object.keys(nested)).toEqual(["__proto__", "constructor", "prototype"])
      expect(Object.hasOwn(nested, "__proto__")).toBe(true)

      await expect(() => {
        capturedTenant.__proto__.slug = "alpha"
      }).toThrow()
      await expect(() => {
        nested.constructor = "changed"
      }).toThrow()
      await expect(() => handle.databaseConfiguration("projectTenant")).toThrowError("Unknown or inactive database identifier for tenant handle: projectTenant")
    })
  })

  it("captures dangerous database configuration keys as immutable own data", async () => {
    await withBrowserConfiguration("velocious-tenant-handle-dangerous-config-keys", async ({configuration}) => {
      const sourceConfiguration = configuration.getDatabaseConfiguration().projectTenant

      sourceConfiguration.sqlConfig = JSON.parse('{"__proto__":{"route":"victim"},"constructor":{"name":"config-constructor"},"prototype":{"nested":{"__proto__":{"route":"nested-victim"},"constructor":"nested-constructor","prototype":"nested-prototype"}}}')

      const handle = Tenant.handle({slug: "alpha"})
      const capturedSqlConfig = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ (handle.databaseConfiguration("projectTenant").sqlConfig)
      const nested = /** @type {{nested: Record<string, ReturnType<typeof JSON.parse>>}} */ (capturedSqlConfig.prototype).nested

      expect(Object.getPrototypeOf(capturedSqlConfig)).toBe(Object.prototype)
      expect(Object.keys(capturedSqlConfig)).toEqual(["__proto__", "constructor", "prototype"])
      expect(Object.hasOwn(capturedSqlConfig, "__proto__")).toBe(true)
      expect(capturedSqlConfig.route).toBeUndefined()
      expect(capturedSqlConfig.__proto__).toEqual({route: "victim"})
      expect(Object.getPrototypeOf(nested)).toBe(Object.prototype)
      expect(Object.keys(nested)).toEqual(["__proto__", "constructor", "prototype"])

      await expect(() => {
        capturedSqlConfig.__proto__.route = "changed"
      }).toThrow()
      await expect(() => {
        nested.prototype = "changed"
      }).toThrow()
      await expect(() => handle.databaseConfiguration("__proto__")).toThrowError("Unknown or inactive database identifier for tenant handle: __proto__")
      await expect(() => handle.databaseConfiguration("constructor")).toThrowError("Unknown or inactive database identifier for tenant handle: constructor")
      await expect(() => handle.databaseConfiguration("prototype")).toThrowError("Unknown or inactive database identifier for tenant handle: prototype")
    })
  })

  it("rejects cyclic and unsupported mutable tenant descriptors", async () => {
    await withBrowserConfiguration("velocious-tenant-handle-invalid-tenant", async () => {
      /** @type {Record<string, ReturnType<typeof JSON.parse>>} */
      const cyclicTenant = {slug: "alpha"}

      cyclicTenant.self = cyclicTenant

      await expect(() => Tenant.handle(cyclicTenant)).toThrowError("Tenant descriptor contains a cycle at self")
      await expect(() => Tenant.handle({createdAt: new Date(), slug: "alpha"})).toThrowError("Tenant descriptor contains an unsupported value at createdAt: Date")
    })
  })

  it("keeps captured database configuration immutable after source and accessor mutation", async () => {
    await withBrowserConfiguration("velocious-tenant-handle-frozen-config", async ({configuration}) => {
      const sourceConfiguration = configuration.getDatabaseConfiguration().projectTenant
      sourceConfiguration.sqlConfig = {options: {nested: {route: "original"}}}
      const handle = Tenant.handle({slug: "alpha"})
      const capturedConfiguration = handle.databaseConfiguration("projectTenant")

      sourceConfiguration.name = "rerouted-source"
      sourceConfiguration.sqlConfig.options.nested.route = "rerouted-source"

      await expect(() => {
        capturedConfiguration.name = "rerouted-accessor"
      }).toThrow()
      expect(capturedConfiguration.name).toEqual("velocious-tenant-handle-frozen-config-projectTenant-alpha")
      expect(capturedConfiguration.sqlConfig?.options?.nested).toEqual({route: "original"})
      await expect(() => {
        if (capturedConfiguration.sqlConfig?.options?.nested) {
          capturedConfiguration.sqlConfig.options.nested.route = "rerouted-accessor"
        }
      }).toThrow()

      await handle.databaseOperation({databaseIdentifier: "projectTenant"}, async (operation) => {
        expect(operation.connection().getArgs().name).toEqual("velocious-tenant-handle-frozen-config-projectTenant-alpha")
      })
    })
  })

  it("accounts and queues captured operations within the configured pool maximum", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("velocious-tenant-handle-capacity")
    const databaseConfiguration = configuration.getDatabaseConfiguration().projectTenant
    const firstCanFinish = deferred()
    const firstStarted = deferred()
    const secondCanFinish = deferred()
    let secondEntered = false

    databaseConfiguration.pool = {checkoutTimeoutMillis: 1000, max: 1}

    const firstPromise = new TenantHandle({configuration, tenant: {slug: "alpha"}}).databaseOperation({databaseIdentifier: "projectTenant"}, async () => {
      firstStarted.resolve(undefined)
      await firstCanFinish.promise
    })

    try {
      await firstStarted.promise

      const secondPromise = new TenantHandle({configuration, tenant: {slug: "beta"}}).databaseOperation({databaseIdentifier: "projectTenant"}, async () => {
        secondEntered = true
        await secondCanFinish.promise
      })
      const pool = configuration.getDatabasePool("projectTenant")

      await waitFor({wait: 1}, () => {
        if (secondEntered || pool.getDebugSnapshot().pendingCheckoutCount === 1) return

        throw new Error("Second captured operation has not entered pool ownership")
      })

      const waitingSnapshot = pool.getDebugSnapshot()

      if (secondEntered) {
        secondCanFinish.resolve(undefined)
        await secondPromise
        firstCanFinish.resolve(undefined)
        await firstPromise
      } else {
        firstCanFinish.resolve(undefined)
        await firstPromise
        await waitFor({wait: 1}, () => {
          if (secondEntered) return

          throw new Error("Queued captured operation has not started")
        })
        secondCanFinish.resolve(undefined)
        await secondPromise
      }

      expect(waitingSnapshot.inUseCount).toEqual(1)
      expect(waitingSnapshot.pendingCheckoutCount).toEqual(1)
      expect(waitingSnapshot.connectionsBeingSpawned).toEqual(0)
    } finally {
      firstCanFinish.resolve(undefined)
      secondCanFinish.resolve(undefined)
      await firstPromise
      await cleanup()
    }
  })

  it("applies captured checkout timeouts and closeAll lifecycle ownership", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("velocious-tenant-handle-timeout-close")
    const databaseConfiguration = configuration.getDatabaseConfiguration().projectTenant
    const firstCanFinish = deferred()
    const firstStarted = deferred()
    const firstHandle = new TenantHandle({configuration, tenant: {slug: "alpha"}})

    databaseConfiguration.pool = {checkoutTimeoutMillis: 0, max: 1}

    const firstPromise = firstHandle.databaseOperation({databaseIdentifier: "projectTenant"}, async () => {
      firstStarted.resolve(undefined)
      await firstCanFinish.promise
    })

    try {
      await firstStarted.promise

      const pool = configuration.getDatabasePool("projectTenant")

      await expect(async () => {
        await new TenantHandle({configuration, tenant: {slug: "beta"}}).databaseOperation({databaseIdentifier: "projectTenant"}, async () => {})
      }).toThrow(/Timed out after 0ms waiting for database connection checkout/)

      expect(pool.getDebugSnapshot().inUseCount).toEqual(1)
      await pool.closeAll()
      expect(pool.getDebugSnapshot().connections).toEqual([])

      firstCanFinish.resolve(undefined)
      await firstPromise
      expect(pool.getDebugSnapshot().inUseCount).toEqual(0)
    } finally {
      firstCanFinish.resolve(undefined)
      await firstPromise
      await cleanup()
    }
  })

  it("fails closed when the captured tenant does not activate the requested database", async () => {
    await withBrowserConfiguration("velocious-tenant-handle-inactive", async () => {
      const unresolved = Tenant.handle({slug: ""})

      await expect(async () => {
        await unresolved.databaseOperation({databaseIdentifier: "projectTenant"}, async () => {})
      }).toThrowError("Unknown or inactive database identifier for tenant handle: projectTenant")
    })
  })

  it("keeps the existing Node ambient Tenant.with API compatible", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("velocious-tenant-handle-node-ambient")
    let previousConfiguration

    try {
      try {
        previousConfiguration = Current.configuration()
      } catch {
        // Ignore missing current configuration.
      }

      configuration.setCurrent()
      await seedTenantValue(configuration, "projectTenant", "alpha", "node-alpha")

      const result = await Tenant.with({slug: "alpha"}, async (connections) => {
        const rows = await connections.projectTenant.query("SELECT value FROM tenant_values LIMIT 1")

        return {tenant: Tenant.current(), value: rows[0]?.value}
      })

      expect(result).toEqual({tenant: {slug: "alpha"}, value: "node-alpha"})
      expect(Tenant.current()).toBeUndefined()
    } finally {
      previousConfiguration?.setCurrent()
      await cleanup()
    }
  })
})
