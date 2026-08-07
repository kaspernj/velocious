// @ts-check

import Current from "../../src/current.js"
import DatabaseRecord from "../../src/database/record/index.js"
import Tenant from "../../src/tenants/tenant.js"
import {createTenantTestConfiguration} from "../helpers/tenant-test-helpers.js"

describe("Tenant immutable handle ORM ownership", () => {
  /**
   * @param {(args: {configuration: import("../../src/configuration.js").default, TenantChild: typeof DatabaseRecord, TenantParent: typeof DatabaseRecord}) => Promise<void>} callback - Test callback.
   * @returns {Promise<void>}
   */
  async function withTenantModels(callback) {
    const {cleanup, configuration} = await createTenantTestConfiguration("velocious-tenant-handle-orm")
    let previousConfiguration

    class TenantParent extends DatabaseRecord {}
    class TenantChild extends DatabaseRecord {}

    TenantParent.setTableName("tenant_handle_parents")
    TenantChild.setTableName("tenant_handle_children")
    TenantParent.switchesTenantDatabase("projectTenant")
    TenantChild.switchesTenantDatabase("projectTenant")
    TenantParent.hasMany("tenantChildren", {foreignKey: "parentId", klass: TenantChild})
    TenantChild.belongsTo("tenantParent", {foreignKey: "parentId", klass: TenantParent})

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
            await connections.projectTenant.query("CREATE TABLE tenant_handle_parents(id integer PRIMARY KEY AUTOINCREMENT, name varchar(255))")
            await connections.projectTenant.query("CREATE TABLE tenant_handle_children(id integer PRIMARY KEY AUTOINCREMENT, parent_id integer NOT NULL, name varchar(255))")

            if (!TenantParent.isInitialized()) {
              await TenantParent.initializeRecord({configuration})
              await TenantChild.initializeRecord({configuration})
            }
          })
        })
      }

      await callback({configuration, TenantChild, TenantParent})
    } finally {
      previousConfiguration?.setCurrent()
      await cleanup()
    }
  }

  it("runs query, create, update, destroy, association, and preload work on the captured tenant", async () => {
    await withTenantModels(async ({TenantParent}) => {
      const alpha = Tenant.handle({slug: "alpha"})

      await alpha.databaseOperation({databaseIdentifier: "projectTenant"}, async (operation) => {
        const parent = await operation.forModel(TenantParent).create({name: "before"})
        const child = await parent.getRelationshipByName("tenantChildren").create({name: "child"})

        parent.assign({name: "after"})
        await parent.save()

        const loadedParent = await operation
          .forModel(TenantParent)
          .preload({tenantChildren: true})
          .findByOrFail({id: parent.id()})
        const loadedChildren = loadedParent.getRelationshipByName("tenantChildren").loaded()

        expect(loadedParent.readAttribute("name")).toEqual("after")
        expect(Array.isArray(loadedChildren) ? loadedChildren.map((record) => record.readAttribute("name")) : []).toEqual(["child"])

        await child.destroy()
        await parent.destroy()
        expect(await operation.forModel(TenantParent).count()).toEqual(0)
      })

      await Tenant.handle({slug: "beta"}).databaseOperation({databaseIdentifier: "projectTenant"}, async (operation) => {
        expect(await operation.forModel(TenantParent).count()).toEqual(0)
      })
    })
  })

  it("pins both databaseOperation and transaction paths to the captured tenant", async () => {
    await withTenantModels(async ({TenantParent}) => {
      const alpha = Tenant.handle({slug: "alpha"})

      await alpha.databaseOperation({databaseIdentifier: "projectTenant"}, async (operation) => {
        await operation.forModel(TenantParent).create({name: "outside transaction"})
      })
      await alpha.transaction({databaseIdentifier: "projectTenant"}, async (operation) => {
        await operation.forModel(TenantParent).create({name: "inside transaction"})
      })

      await alpha.databaseOperation({databaseIdentifier: "projectTenant"}, async (operation) => {
        expect((await operation.forModel(TenantParent).order("name").pluck("name"))).toEqual(["inside transaction", "outside transaction"])
      })
      await Tenant.handle({slug: "beta"}).databaseOperation({databaseIdentifier: "projectTenant"}, async (operation) => {
        expect(await operation.forModel(TenantParent).count()).toEqual(0)
      })
    })
  })

  it("rejects combining a record with another physical tenant", async () => {
    await withTenantModels(async ({TenantParent}) => {
      const alpha = Tenant.handle({slug: "alpha"})
      const beta = Tenant.handle({slug: "beta"})

      await alpha.databaseOperation({databaseIdentifier: "projectTenant"}, async (alphaOperation) => {
        const alphaRecord = await alphaOperation.forModel(TenantParent).create({name: "alpha"})

        await beta.databaseOperation({databaseIdentifier: "projectTenant"}, async (betaOperation) => {
          await expect(async () => betaOperation.bindRecord(alphaRecord)).toThrowError("Record is already bound to another database operation")
        })
      })
    })
  })

  it("preserves legacy eager finder follow-up use inside an ambient Node tenant scope", async () => {
    await withTenantModels(async ({configuration, TenantParent}) => {
      const scope = TenantParent.usingTenant({slug: "alpha"})

      await scope.databaseOperation(async (query) => {
        await query.create({name: "before"})
      })

      await configuration.runWithTenant({slug: "alpha"}, async () => {
        const parent = await scope.findByOrFail({name: "before"})

        expect(parent.databaseOperation()).toBeUndefined()
        parent.assign({name: "after"})
        await parent.save()
      })

      await scope.databaseOperation(async (query) => {
        expect(await query.pluck("name")).toEqual(["after"])
      })
    })
  })
})
