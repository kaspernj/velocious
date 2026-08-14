// @ts-check

import {describe, expect, it} from "../../../../../../src/testing/test.js"
import AsyncTrackedMultiConnection from "../../../../../../src/database/pool/async-tracked-multi-connection.js"
import Cli from "../../../../../../src/cli/index.js"
import Configuration from "../../../../../../src/configuration.js"
import EnvironmentHandlerNode from "../../../../../../src/environment-handlers/node.js"
import fs from "fs/promises"
import MigrationsLedger from "../../../../../../src/database/migrations-ledger.js"
import os from "os"
import path from "path"
import SqliteDriver from "../../../../../../src/database/drivers/sqlite/index.js"

describe("Cli - Commands - db:tenants:migrations:pending", () => {
  /**
   * Builds a real tenant-database CLI scenario.
   * @param {object} args - Scenario options.
   * @param {string[]} args.alphaVersions - Applied alpha migration versions.
   * @param {string[]} args.betaVersions - Applied beta migration versions.
   * @param {boolean} [args.createAlphaLedger] - Whether alpha has a readable ledger.
   * @param {string[]} [args.templateVersions] - Applied base/template migration versions.
   * @param {Array<{slug: string}>} [args.tenants] - Listed tenants.
   * @returns {Promise<{afterMigrateCalls: () => number, cli: Cli, configuration: Configuration, directory: string}>} - Scenario.
   */
  async function buildScenario({alphaVersions, betaVersions, createAlphaLedger = true, templateVersions, tenants = [{slug: "alpha"}, {slug: "beta"}]}) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-cli-tenant-migrations-pending-"))
    const migrationsDirectory = path.join(directory, "src", "database", "migrations")
    const migrationModuleUrl = new URL("../../../../../../src/database/migration/index.js", import.meta.url).href
    let afterMigrateCallCount = 0

    await fs.mkdir(migrationsDirectory, {recursive: true})

    for (const version of ["20260814090000", "20260814090100"]) {
      await fs.writeFile(path.join(migrationsDirectory, `${version}-tenant-change.js`), `
import Migration from ${JSON.stringify(migrationModuleUrl)}

class TenantChange extends Migration {
  async change() {
    throw new Error("Preflight must not run migrations")
  }
}

TenantChange.onDatabases(["projectTenant"])

export default TenantChange
`, "utf8")
    }

    const configuration = new Configuration({
      database: {
        test: {
          default: {
            driver: SqliteDriver,
            migrations: false,
            name: "velocious-cli-tenant-migrations-pending-default",
            poolType: AsyncTrackedMultiConnection,
            type: "sqlite"
          },
          projectTenant: {
            driver: SqliteDriver,
            migrations: true,
            name: "velocious-cli-tenant-migrations-pending-project-default",
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
          afterMigrateTenant: async () => { afterMigrateCallCount++ },
          checkTenant: async () => { throw new Error("Preflight must not run tenant checks") },
          createDatabase: async () => { throw new Error("Preflight must not create tenant databases") },
          listTenants: async () => tenants
        }
      },
      tenantDatabaseResolver: ({identifier, tenant}) => {
        const tenantObject = /** @type {{slug?: string}} */ (tenant)

        if (identifier != "projectTenant" || !["alpha", "beta"].includes(tenantObject.slug || "")) return

        return {name: `velocious-cli-tenant-migrations-pending-project-${tenantObject.slug}`}
      }
    })

    if (templateVersions) {
      await configuration.ensureConnections({databaseIdentifiers: ["projectTenant"]}, async (dbs) => {
        await MigrationsLedger.ensureTable(dbs.projectTenant)
        await MigrationsLedger.markApplied(dbs.projectTenant, templateVersions)
      })
    }

    for (const [slug, versions, createLedger] of [
      ["alpha", alphaVersions, createAlphaLedger],
      ["beta", betaVersions, true]
    ]) {
      if (!createLedger || !tenants.some((tenant) => tenant.slug == slug)) continue

      await configuration.runWithTenant({slug}, async () => {
        await configuration.ensureConnections({databaseIdentifiers: ["projectTenant"]}, async (dbs) => {
          await MigrationsLedger.ensureTable(dbs.projectTenant)
          await MigrationsLedger.markApplied(dbs.projectTenant, /** @type {string[]} */ (versions))
        })
      })
    }

    const cli = new Cli({
      configuration,
      directory,
      environmentHandler: new EnvironmentHandlerNode(),
      processArgs: ["db:tenants:migrations:pending", "projectTenant"],
      testing: true
    })

    return {afterMigrateCalls: () => afterMigrateCallCount, cli, configuration, directory}
  }

  it("reports when every tenant ledger contains every applicable migration", async () => {
    const scenario = await buildScenario({
      alphaVersions: ["20260814090000", "20260814090100"],
      betaVersions: ["20260814090000", "20260814090100"]
    })

    try {
      expect(await scenario.cli.execute()).toEqual({
        hasPendingMigrations: false,
        identifier: "projectTenant",
        migrationCount: 2,
        pendingTenantCount: 0,
        tenantCount: 2
      })
      expect(scenario.afterMigrateCalls()).toEqual(0)
    } finally {
      await scenario.configuration.closeDatabaseConnections()
      await fs.rm(scenario.directory, {force: true, recursive: true})
    }
  })

  it("reports when one tenant has a pending migration", async () => {
    const scenario = await buildScenario({
      alphaVersions: ["20260814090000", "20260814090100"],
      betaVersions: ["20260814090000"]
    })

    try {
      expect(await scenario.cli.execute()).toEqual({
        hasPendingMigrations: true,
        identifier: "projectTenant",
        migrationCount: 2,
        pendingTenantCount: 1,
        tenantCount: 2
      })
    } finally {
      await scenario.configuration.closeDatabaseConnections()
      await fs.rm(scenario.directory, {force: true, recursive: true})
    }
  })

  it("reports no pending migrations when the provider lists no tenants", async () => {
    const scenario = await buildScenario({alphaVersions: [], betaVersions: [], tenants: []})

    try {
      expect(await scenario.cli.execute()).toEqual({
        hasPendingMigrations: false,
        identifier: "projectTenant",
        migrationCount: 2,
        pendingTenantCount: 0,
        tenantCount: 0
      })
    } finally {
      await scenario.configuration.closeDatabaseConnections()
      await fs.rm(scenario.directory, {force: true, recursive: true})
    }
  })

  it("rejects an unreadable tenant migration ledger without creating it", async () => {
    const scenario = await buildScenario({alphaVersions: [], betaVersions: [], createAlphaLedger: false})

    try {
      await expect(async () => await scenario.cli.execute()).toThrow(/schema_migrations.*alpha|alpha.*schema_migrations/)

      await scenario.configuration.runWithTenant({slug: "alpha"}, async () => {
        await scenario.configuration.ensureConnections({databaseIdentifiers: ["projectTenant"]}, async (dbs) => {
          expect(await MigrationsLedger.tableExists(dbs.projectTenant)).toEqual(false)
        })
      })
    } finally {
      await scenario.configuration.closeDatabaseConnections()
      await fs.rm(scenario.directory, {force: true, recursive: true})
    }
  })

  it("rejects an unresolved tenant without reading the current base template ledger", async () => {
    const scenario = await buildScenario({
      alphaVersions: [],
      betaVersions: [],
      templateVersions: ["20260814090000", "20260814090100"],
      tenants: [{slug: "stale"}]
    })

    try {
      await expect(async () => await scenario.cli.execute()).toThrow(/projectTenant is inactive for tenant: stale/)
    } finally {
      await scenario.configuration.closeDatabaseConnections()
      await fs.rm(scenario.directory, {force: true, recursive: true})
    }
  })
})
