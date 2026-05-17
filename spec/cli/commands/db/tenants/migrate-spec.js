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
  it("initializes the app runtime before listing provider tenants", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-cli-tenants-initialize-"))
    let initialized = false
    const configuration = new Configuration({
      database: {
        test: {
          default: {
            driver: SqliteDriver,
            migrations: false,
            name: "velocious-cli-tenants-initialize-default",
            poolType: AsyncTrackedMultiConnection,
            type: "sqlite"
          },
          projectTenant: {
            driver: SqliteDriver,
            migrations: true,
            name: "velocious-cli-tenants-initialize-project-default",
            poolType: AsyncTrackedMultiConnection,
            tenantOnly: true,
            type: "sqlite"
          }
        }
      },
      directory,
      environment: "test",
      environmentHandler: new EnvironmentHandlerNode(),
      initializeModels: async () => {
        initialized = true
      },
      locale: "en",
      localeFallbacks: {en: ["en"]},
      locales: ["en"],
      tenantDatabaseProviders: {
        projectTenant: {
          listTenants: async () => {
            expect(initialized).toEqual(true)

            return []
          }
        }
      },
      tenantDatabaseResolver: () => {}
    })
    const cli = new Cli({
      configuration,
      directory,
      environmentHandler: new EnvironmentHandlerNode(),
      processArgs: ["db:tenants:check", "projectTenant"],
      testing: true
    })

    try {
      expect(await cli.execute()).toEqual({
        identifier: "projectTenant",
        tenantCount: 0
      })
    } finally {
      await configuration.closeDatabaseConnections()
      await fs.rm(directory, {force: true, recursive: true})
    }
  })

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

  it("uses the provider tenant list at command execution time", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-cli-tenants-dynamic-"))
    const migrationsDirectory = path.join(directory, "src", "database", "migrations")
    const migrationModuleUrl = new URL("../../../../../src/database/migration/index.js", import.meta.url).href
    /** @type {Array<{slug: string}>} */
    let tenants = [{slug: "alpha"}]

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
            name: "velocious-cli-tenants-dynamic-default",
            poolType: AsyncTrackedMultiConnection,
            type: "sqlite"
          },
          projectTenant: {
            driver: SqliteDriver,
            migrations: true,
            name: "velocious-cli-tenants-dynamic-project-default",
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
          listTenants: async () => tenants
        }
      },
      tenantDatabaseResolver: ({identifier, tenant}) => {
        const tenantObject = /** @type {{slug?: string}} */ (tenant)

        if (identifier != "projectTenant" || !tenantObject.slug) return

        return {name: `velocious-cli-tenants-dynamic-project-${tenantObject.slug}`}
      }
    })

    try {
      const firstCli = new Cli({
        configuration,
        directory,
        environmentHandler: new EnvironmentHandlerNode(),
        processArgs: ["db:tenants:migrate", "projectTenant"],
        testing: true
      })

      expect(await firstCli.execute()).toEqual({
        identifier: "projectTenant",
        migrationCount: 1,
        tenantCount: 1
      })

      tenants = [{slug: "beta"}]
      await fs.writeFile(path.join(migrationsDirectory, "20260517000001-create-tenant-gadgets.js"), `
import Migration from ${JSON.stringify(migrationModuleUrl)}

class CreateTenantGadgets extends Migration {
  async change() {
    await this.createTable("tenant_gadgets", (table) => {
      table.string("name", {null: false})
    })
  }
}

CreateTenantGadgets.onDatabases(["projectTenant"])

export default CreateTenantGadgets
`, "utf8")

      const secondCli = new Cli({
        configuration,
        directory,
        environmentHandler: new EnvironmentHandlerNode(),
        processArgs: ["db:tenants:migrate", "projectTenant"],
        testing: true
      })

      expect(await secondCli.execute()).toEqual({
        identifier: "projectTenant",
        migrationCount: 2,
        tenantCount: 1
      })

      await configuration.runWithTenant({slug: "alpha"}, async () => {
        await configuration.ensureConnections(async (dbs) => {
          expect(await dbs.projectTenant.getTableByName("tenant_widgets")).toBeTruthy()
          expect(await dbs.projectTenant.getTableByName("tenant_gadgets", {throwError: false})).toEqual(null)
        })
      })

      await configuration.runWithTenant({slug: "beta"}, async () => {
        await configuration.ensureConnections(async (dbs) => {
          expect(await dbs.projectTenant.getTableByName("tenant_widgets")).toBeTruthy()
          expect(await dbs.projectTenant.getTableByName("tenant_gadgets")).toBeTruthy()
        })
      })
    } finally {
      await configuration.closeDatabaseConnections()
      await fs.rm(directory, {force: true, recursive: true})
    }
  })

  it("rejects disabled tenant database identifiers", async () => {
    const previousDisabledIdentifiers = process.env.VELOCIOUS_DISABLED_DATABASE_IDENTIFIERS
    const configuration = new Configuration({
      database: {
        test: {
          default: {
            driver: SqliteDriver,
            migrations: false,
            name: "velocious-cli-tenants-disabled-default",
            poolType: AsyncTrackedMultiConnection,
            type: "sqlite"
          },
          projectTenant: {
            driver: SqliteDriver,
            migrations: true,
            name: "velocious-cli-tenants-disabled-project-default",
            poolType: AsyncTrackedMultiConnection,
            tenantOnly: true,
            type: "sqlite"
          }
        }
      },
      directory: await fs.mkdtemp(path.join(os.tmpdir(), "velocious-cli-tenants-disabled-")),
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

        if (identifier != "projectTenant" || !tenantObject.slug) return

        return {name: `velocious-cli-tenants-disabled-project-${tenantObject.slug}`}
      }
    })
    const cli = new Cli({
      configuration,
      directory: configuration.getDirectory(),
      environmentHandler: new EnvironmentHandlerNode(),
      processArgs: ["db:tenants:migrate", "projectTenant"],
      testing: true
    })

    process.env.VELOCIOUS_DISABLED_DATABASE_IDENTIFIERS = "projectTenant"

    try {
      await expect(async () => {
        await cli.execute()
      }).toThrow(/projectTenant is disabled/)
    } finally {
      if (previousDisabledIdentifiers === undefined) {
        delete process.env.VELOCIOUS_DISABLED_DATABASE_IDENTIFIERS
      } else {
        process.env.VELOCIOUS_DISABLED_DATABASE_IDENTIFIERS = previousDisabledIdentifiers
      }

      await configuration.closeDatabaseConnections()
      await fs.rm(configuration.getDirectory(), {force: true, recursive: true})
    }
  })
})
