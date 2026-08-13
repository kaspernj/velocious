// @ts-check

import DatabaseRecord from "../../src/database/record/index.js"
import Migration from "../../src/database/migration/index.js"
import Tenant from "../../src/tenants/tenant.js"
import { buildFrontendMigrationContext } from "../helpers/frontend-tenant-migration-test-helper.js"
import { createTenantTestConfiguration } from "../helpers/tenant-test-helpers.js"
import { describe, expect, it } from "../../src/testing/test.js"

describe("frontend tenant association builders", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("constructs hasMany, hasOne, and belongsTo targets through the owning generation", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("frontend-tenant-association-builders")

    class TenantParent extends DatabaseRecord {}
    class TenantChild extends DatabaseRecord {
      constructor(changes = /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ ({})) {
        super(changes)
        this.constructedByApplicationClass = true
      }
    }
    class TenantProfile extends DatabaseRecord {}
    class CreateTenantAssociations extends Migration {
      async up() {
        await this.execute("CREATE TABLE tenant_parents(id integer PRIMARY KEY AUTOINCREMENT, name varchar(255))")
        await this.execute("CREATE TABLE tenant_children(id integer PRIMARY KEY AUTOINCREMENT, parent_id integer, name varchar(255))")
        await this.execute("CREATE TABLE tenant_profiles(id integer PRIMARY KEY AUTOINCREMENT, parent_id integer, name varchar(255))")
      }
    }

    TenantParent.setTableName("tenant_parents")
    TenantChild.setTableName("tenant_children")
    TenantProfile.setTableName("tenant_profiles")
    TenantParent.switchesTenantDatabase("projectTenant")
    TenantChild.switchesTenantDatabase("projectTenant")
    TenantProfile.switchesTenantDatabase("projectTenant")
    TenantParent.hasMany("tenantChildren", {foreignKey: "parentId", klass: TenantChild})
    TenantParent.hasOne("tenantProfile", {foreignKey: "parentId", klass: TenantProfile})
    TenantChild.belongsTo("tenantParent", {foreignKey: "parentId", klass: TenantParent})
    CreateTenantAssociations.onDatabases(["projectTenant"])
    configuration.getDatabaseConfiguration().projectTenant.migrations = true
    TenantParent.registerRecordClass({configuration})
    TenantChild.registerRecordClass({configuration})
    TenantProfile.registerRecordClass({configuration})

    const migrations = buildFrontendMigrationContext({"20260813000710-create-tenant-associations.js": CreateTenantAssociations})
    const handle = Tenant.handle({slug: "alpha"}, configuration)

    try {
      await handle.initialize({databaseIdentifier: "projectTenant", migrations, schemaGeneration: "generation-1"})
      expect(TenantChild.isInitialized()).toEqual(false)

      await handle.databaseOperation({databaseIdentifier: "projectTenant"}, async (operation) => {
        const parent = await operation.forModel(TenantParent).create({name: "parent"})
        const child = parent.getRelationshipByName("tenantChildren").build({name: "child"})
        const profile = parent.getRelationshipByName("tenantProfile").build({name: "profile"})
        const secondChild = operation.forModel(TenantChild).build({name: "second child"})
        const builtParent = secondChild.getRelationshipByName("tenantParent").build({name: "built parent"})

        expect(child).toBeInstanceOf(TenantChild)
        expect(child.constructedByApplicationClass).toEqual(true)
        expect(profile).toBeInstanceOf(TenantProfile)
        expect(builtParent).toBeInstanceOf(TenantParent)
        expect(child.getModelClass()).toEqual(operation.modelClass(TenantChild))
        expect(profile.getModelClass()).toEqual(operation.modelClass(TenantProfile))
        expect(builtParent.getModelClass()).toEqual(operation.modelClass(TenantParent))
      })
    } finally {
      await cleanup()
    }
  })
})
