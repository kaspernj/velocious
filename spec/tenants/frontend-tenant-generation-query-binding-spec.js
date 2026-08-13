// @ts-check

import DatabaseRecord from "../../src/database/record/index.js"
import Migration from "../../src/database/migration/index.js"
import Tenant from "../../src/tenants/tenant.js"
import { buildFrontendMigrationContext, tenantSlugFromDatabase } from "../helpers/frontend-tenant-migration-test-helper.js"
import { createTenantTestConfiguration } from "../helpers/tenant-test-helpers.js"
import { describe, expect, it } from "../../src/testing/test.js"

describe("frontend tenant generation query binding", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("applies a canonical defined scope to an operation-bound model query", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("frontend-tenant-generation-scope")

    class TenantTask extends DatabaseRecord {}
    class CreateTenantTasks extends Migration {
      async up() {
        await this.execute("CREATE TABLE tenant_tasks(id integer PRIMARY KEY AUTOINCREMENT, active boolean NOT NULL, name varchar(255))")
      }
    }

    TenantTask.setTableName("tenant_tasks")
    TenantTask.switchesTenantDatabase("projectTenant")
    TenantTask.active = TenantTask.defineScope(({query}) => query.where({active: true}))
    CreateTenantTasks.onDatabases(["projectTenant"])
    configuration.getDatabaseConfiguration().projectTenant.migrations = true
    TenantTask.registerRecordClass({configuration})

    const migrations = buildFrontendMigrationContext({"20260813000600-create-tenant-tasks.js": CreateTenantTasks})
    const handle = Tenant.handle({slug: "alpha"}, configuration)

    try {
      await handle.initialize({databaseIdentifier: "projectTenant", migrations, schemaGeneration: "generation-1"})
      await handle.databaseOperation({databaseIdentifier: "projectTenant"}, async (operation) => {
        await operation.forModel(TenantTask).create({active: true, name: "active"})
        await operation.forModel(TenantTask).create({active: false, name: "inactive"})

        const names = await operation
          .forModel(TenantTask)
          .scope(TenantTask.active.scope())
          .pluck("name")

        expect(names).toEqual(["active"])
        expect(await operation.modelClass(TenantTask).active().pluck("name")).toEqual(["active"])
      })
    } finally {
      await cleanup()
    }
  })

  it("uses each generation-bound relationship target's attributes for nested and operator filters", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("frontend-tenant-generation-relationship-filter")

    class TenantProject extends DatabaseRecord {}
    class TenantTask extends DatabaseRecord {}
    class CreateTenantProjectTasks extends Migration {
      async up() {
        const slug = tenantSlugFromDatabase(this.connection())

        await this.execute("CREATE TABLE tenant_projects(id integer PRIMARY KEY AUTOINCREMENT, name varchar(255))")
        await this.execute(`CREATE TABLE tenant_tasks(id integer PRIMARY KEY AUTOINCREMENT, project_id integer NOT NULL, ${slug}_status varchar(255))`)
      }
    }

    TenantProject.setTableName("tenant_projects")
    TenantTask.setTableName("tenant_tasks")
    TenantProject.switchesTenantDatabase("projectTenant")
    TenantTask.switchesTenantDatabase("projectTenant")
    TenantProject.hasMany("tenantTasks", {foreignKey: "projectId", klass: TenantTask})
    TenantTask.belongsTo("tenantProject", {foreignKey: "projectId", klass: TenantProject})
    CreateTenantProjectTasks.onDatabases(["projectTenant"])
    configuration.getDatabaseConfiguration().projectTenant.migrations = true
    TenantProject.registerRecordClass({configuration})
    TenantTask.registerRecordClass({configuration})

    const migrations = buildFrontendMigrationContext({"20260813000601-create-tenant-project-tasks.js": CreateTenantProjectTasks})
    const alpha = Tenant.handle({slug: "alpha"}, configuration)
    const beta = Tenant.handle({slug: "beta"}, configuration)

    try {
      await Promise.all([
        alpha.initialize({databaseIdentifier: "projectTenant", migrations, schemaGeneration: "generation-1"}),
        beta.initialize({databaseIdentifier: "projectTenant", migrations, schemaGeneration: "generation-1"})
      ])

      await alpha.databaseOperation({databaseIdentifier: "projectTenant"}, async (operation) => {
        const project = await operation.forModel(TenantProject).create({name: "alpha"})

        await operation.forModel(TenantTask).create({alphaStatus: "selected", projectId: project.id()})
        expect(await operation.forModel(TenantProject).where({tenantTasks: {alphaStatus: "selected"}}).pluck("name")).toEqual(["alpha"])
        expect(await operation.forModel(TenantProject).where({tenantTasks: [["alphaStatus", "eq", "selected"]]}).pluck("name")).toEqual(["alpha"])

        const loadedProject = await operation
          .forModel(TenantProject)
          .preload({tenantTasks: true})
          .withCount("tenantTasks")
          .findByOrFail({id: project.id()})
        const loadedTasks = loadedProject.getRelationshipByName("tenantTasks").loaded()

        expect(loadedProject.readCount("tenantTasksCount")).toEqual(1)
        expect(Array.isArray(loadedTasks) ? loadedTasks.map((task) => task.readAttribute("alphaStatus")) : []).toEqual(["selected"])
      })
      await beta.databaseOperation({databaseIdentifier: "projectTenant"}, async (operation) => {
        const project = await operation.forModel(TenantProject).create({name: "beta"})

        await operation.forModel(TenantTask).create({betaStatus: "selected", projectId: project.id()})
        expect(await operation.forModel(TenantProject).where({tenantTasks: {betaStatus: "selected"}}).pluck("name")).toEqual(["beta"])
        expect(await operation.forModel(TenantProject).where({tenantTasks: [["betaStatus", "eq", "selected"]]}).pluck("name")).toEqual(["beta"])
      })
    } finally {
      await cleanup()
    }
  })
})
