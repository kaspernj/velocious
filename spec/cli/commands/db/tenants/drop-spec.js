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

describe("Cli - Commands - db:tenants:drop", () => {
  it("drops every listed tenant through the provider's dropDatabase hook", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-cli-tenants-drop-"))
    /** @type {Array<{name: string, slug: string}>} */
    const droppedTenants = []
    const configuration = new Configuration({
      database: {
        test: {
          default: {
            driver: SqliteDriver,
            migrations: false,
            name: "velocious-cli-tenants-drop-default",
            poolType: AsyncTrackedMultiConnection,
            type: "sqlite"
          },
          projectTenant: {
            driver: SqliteDriver,
            migrations: true,
            name: "velocious-cli-tenants-drop-project-default",
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
          dropDatabase: async ({databaseConfiguration, tenant}) => {
            const tenantObject = /** @type {{slug: string}} */ (tenant)

            droppedTenants.push({name: databaseConfiguration.name, slug: tenantObject.slug})
          },
          listTenants: async () => [{slug: "alpha"}, {slug: "beta"}]
        }
      },
      tenantDatabaseResolver: ({identifier, tenant}) => {
        const tenantObject = /** @type {{slug?: string}} */ (tenant)

        if (identifier != "projectTenant" || !tenantObject.slug) return

        return {name: `velocious-cli-tenants-drop-project-${tenantObject.slug}`}
      }
    })
    const cli = new Cli({
      configuration,
      directory,
      environmentHandler: new EnvironmentHandlerNode(),
      processArgs: ["db:tenants:drop", "projectTenant"],
      testing: true
    })

    try {
      const result = await cli.execute()

      expect(result).toEqual({identifier: "projectTenant", tenantCount: 2})
      expect(droppedTenants.sort((first, second) => first.slug.localeCompare(second.slug))).toEqual([
        {name: "velocious-cli-tenants-drop-project-alpha", slug: "alpha"},
        {name: "velocious-cli-tenants-drop-project-beta", slug: "beta"}
      ])
    } finally {
      await configuration.closeDatabaseConnections()
      await fs.rm(directory, {force: true, recursive: true})
    }
  })

  it("drops tenants through the framework default when the provider does not define dropDatabase", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-cli-tenants-drop-missing-"))
    const configuration = new Configuration({
      database: {
        test: {
          default: {
            driver: SqliteDriver,
            migrations: false,
            name: "velocious-cli-tenants-drop-missing-default",
            poolType: AsyncTrackedMultiConnection,
            type: "sqlite"
          },
          projectTenant: {
            driver: SqliteDriver,
            migrations: true,
            name: "velocious-cli-tenants-drop-missing-project-default",
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

        if (identifier != "projectTenant" || !tenantObject.slug) return

        return {name: `velocious-cli-tenants-drop-missing-project-${tenantObject.slug}`}
      }
    })
    const cli = new Cli({
      configuration,
      directory,
      environmentHandler: new EnvironmentHandlerNode(),
      processArgs: ["db:tenants:drop", "projectTenant"],
      testing: true
    })

    try {
      const result = await cli.execute()

      expect(result).toEqual({identifier: "projectTenant", tenantCount: 1})
    } finally {
      await configuration.closeDatabaseConnections()
      await fs.rm(directory, {force: true, recursive: true})
    }
  })
})
