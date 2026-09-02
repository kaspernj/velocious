// @ts-check

import { describe, expect, it } from "../../../../../src/testing/test.js"
import AsyncTrackedMultiConnection from "../../../../../src/database/pool/async-tracked-multi-connection.js"
import Cli from "../../../../../src/cli/index.js"
import Configuration from "../../../../../src/configuration.js"
import EnvironmentHandlerNode from "../../../../../src/environment-handlers/node.js"
import fs from "fs/promises"
import os from "os"
import path from "path"
import SqliteDriver from "../../../../../src/database/drivers/sqlite/index.js"

describe("Cli tenant migration execution phases", () => {
  it("uses the same phase selection for tenant migrate and pending commands", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-tenant-migration-phase-"))
    const migrationsDirectory = path.join(directory, "src", "database", "migrations")
    const migrationModuleUrl = new URL("../../../../../src/database/migration/index.js", import.meta.url).href

    await fs.mkdir(migrationsDirectory, {recursive: true})
    await fs.writeFile(path.join(migrationsDirectory, "20260901020100-create-tenant-pre-runtime-items.js"), `
import Migration from ${JSON.stringify(migrationModuleUrl)}

class CreateTenantPreRuntimeItems extends Migration {
  async change() {
    await this.execute("CREATE TABLE tenant_pre_runtime_items(id integer PRIMARY KEY)")
  }
}

CreateTenantPreRuntimeItems.onDatabases(["projectTenant"])

export default CreateTenantPreRuntimeItems
`, "utf8")
    await fs.writeFile(path.join(migrationsDirectory, "20260901020200-create-tenant-post-publication-items.js"), `
import Migration from ${JSON.stringify(migrationModuleUrl)}

class CreateTenantPostPublicationItems extends Migration {
  async change() {
    await this.execute("CREATE TABLE tenant_post_publication_items(id integer PRIMARY KEY)")
  }
}

CreateTenantPostPublicationItems.onDatabases(["projectTenant"])
CreateTenantPostPublicationItems.runInPhase("post-publication")

export default CreateTenantPostPublicationItems
`, "utf8")

    const configuration = new Configuration({
      database: {
        test: {
          default: {
            driver: SqliteDriver,
            migrations: false,
            name: "tenant-migration-phase-default",
            poolType: AsyncTrackedMultiConnection,
            type: "sqlite"
          },
          projectTenant: {
            driver: SqliteDriver,
            migrations: true,
            name: "tenant-migration-phase-project-template",
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
          listTenants: async () => [{slug: "alpha"}]
        }
      },
      tenantDatabaseResolver: ({identifier, tenant}) => {
        const tenantObject = /** @type {{slug?: string}} */ (tenant)

        if (identifier != "projectTenant" || tenantObject.slug != "alpha") return

        return {name: "tenant-migration-phase-project-alpha"}
      }
    })

    try {
      const migrateCli = new Cli({
        configuration,
        processArgs: ["db:tenants:migrate", "projectTenant", "--phase", "post-publication"],
        testing: true
      })

      expect(await migrateCli.execute()).toEqual({identifier: "projectTenant", migrationCount: 2, tenantCount: 1})
      await configuration.runWithTenant({slug: "alpha"}, async () => {
        await configuration.ensureConnections({databaseIdentifiers: ["projectTenant"]}, async (dbs) => {
          expect(await dbs.projectTenant.tableExists("tenant_pre_runtime_items")).toEqual(false)
          expect(await dbs.projectTenant.tableExists("tenant_post_publication_items")).toEqual(true)
          expect(await dbs.projectTenant.query("SELECT version FROM schema_migrations ORDER BY version")).toEqual([
            {version: "20260901020200"}
          ])
        })
      })

      const selectedPendingCli = new Cli({
        configuration,
        processArgs: ["db:tenants:migrations:pending", "projectTenant", "--phase", "post-publication"],
        testing: true
      })
      const allPendingCli = new Cli({
        configuration,
        processArgs: ["db:tenants:migrations:pending", "projectTenant"],
        testing: true
      })

      expect(await selectedPendingCli.execute()).toEqual({
        hasPendingMigrations: false,
        identifier: "projectTenant",
        migrationCount: 1,
        pendingTenantCount: 0,
        tenantCount: 1
      })
      expect(await allPendingCli.execute()).toEqual({
        hasPendingMigrations: true,
        identifier: "projectTenant",
        migrationCount: 2,
        pendingTenantCount: 1,
        tenantCount: 1
      })
    } finally {
      await configuration.closeDatabaseConnections()
      await fs.rm(directory, {force: true, recursive: true})
    }
  })
})
