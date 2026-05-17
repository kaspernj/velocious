// @ts-check

import {describe, expect, it} from "../../../../../src/testing/test.js"
import AsyncTrackedMultiConnection from "../../../../../src/database/pool/async-tracked-multi-connection.js"
import Cli from "../../../../../src/cli/index.js"
import Configuration from "../../../../../src/configuration.js"
import EnvironmentHandlerNode from "../../../../../src/environment-handlers/node.js"
import fs from "fs/promises"
import os from "os"
import path from "path"
import SqliteDriver from "../../../../../src/database/drivers/sqlite/index.js"

describe("Cli - Commands - db:tenants:migrate", () => {
  it("runs targeted migrations for every tenant of a tenant-only database", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-cli-tenants-migrate-"))
    const migrationsDirectory = path.join(directory, "src", "database", "migrations")
    const migrationModuleUrl = new URL("../../../../../src/database/migration/index.js", import.meta.url).href

    await fs.mkdir(migrationsDirectory, {recursive: true})
    await fs.writeFile(path.join(migrationsDirectory, "20260517000000-create-tenant-widgets.js"), `
import Migration from ${JSON.stringify(migrationModuleUrl)}

class CreateTenantWidgets extends Migration {
  async change() {
    await this.createTable("tenant_widgets", (table) => {
      table.string("name", {null: false})
    })
  }
}

CreateTenantWidgets.onDatabases(["projectTenant"])

export default CreateTenantWidgets
`, "utf8")

    const configuration = new Configuration({
      database: {
        test: {
          default: {
            driver: SqliteDriver,
            migrations: false,
            name: "velocious-cli-tenants-migrate-default",
            poolType: AsyncTrackedMultiConnection,
            type: "sqlite"
          },
          projectTenant: {
            driver: SqliteDriver,
            migrations: true,
            name: "velocious-cli-tenants-migrate-project-default",
            poolType: AsyncTrackedMultiConnection,
            tenantOnly: true,
            type: "sqlite"
          }
        }
      },
      directory,
      environment: "test",
      environmentHandler: new EnvironmentHandlerNode(),
      initializeModels: async () => {},
      locale: "en",
      localeFallbacks: {en: ["en"]},
      locales: ["en"],
      tenantDatabaseProviders: {
        projectTenant: {
          listTenants: async () => [{slug: "alpha"}, {slug: "beta"}]
        }
      },
      tenantDatabaseResolver: ({identifier, tenant}) => {
        const tenantObject = /** @type {{slug?: string}} */ (tenant)

        if (identifier != "projectTenant" || !tenantObject.slug) return

        return {name: `velocious-cli-tenants-migrate-project-${tenantObject.slug}`}
      }
    })
    const cli = new Cli({
      configuration,
      directory,
      environmentHandler: new EnvironmentHandlerNode(),
      processArgs: ["db:tenants:migrate", "projectTenant"],
      testing: true
    })

    try {
      expect(configuration.getDatabaseIdentifiers()).toEqual(["default"])

      const result = await cli.execute()

      expect(result).toEqual({
        identifier: "projectTenant",
        migrationCount: 1,
        tenantCount: 2
      })

      await configuration.runWithTenant({slug: "alpha"}, async () => {
        await configuration.ensureConnections(async (dbs) => {
          const table = await dbs.projectTenant.getTableByName("tenant_widgets")
          const migrations = await dbs.projectTenant.select("schema_migrations")

          expect(dbs.projectTenant.getArgs().name).toEqual("velocious-cli-tenants-migrate-project-alpha")
          expect(table?.getName()).toEqual("tenant_widgets")
          expect(migrations.map((migration) => migration.version)).toEqual(["20260517000000"])
        })
      })

      await configuration.runWithTenant({slug: "beta"}, async () => {
        await configuration.ensureConnections(async (dbs) => {
          const table = await dbs.projectTenant.getTableByName("tenant_widgets")

          expect(dbs.projectTenant.getArgs().name).toEqual("velocious-cli-tenants-migrate-project-beta")
          expect(table?.getName()).toEqual("tenant_widgets")
        })
      })
    } finally {
      await configuration.closeDatabaseConnections()
      await fs.rm(directory, {force: true, recursive: true})
    }
  })
})
