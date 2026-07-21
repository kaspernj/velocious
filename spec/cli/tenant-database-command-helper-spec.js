// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import wait from "awaitery/build/wait.js"
import AsyncTrackedMultiConnection from "../../src/database/pool/async-tracked-multi-connection.js"
import BaseCommand from "../../src/cli/base-command.js"
import Cli from "../../src/cli/index.js"
import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import fs from "fs/promises"
import os from "os"
import path from "path"
import SqliteDriver from "../../src/database/drivers/sqlite/index.js"
import TenantDatabaseCommandHelper from "../../src/cli/tenant-database-command-helper.js"

describe("TenantDatabaseCommandHelper", () => {
  it("reports tenant progress and emits heartbeats while work is active", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-cli-tenant-progress-"))
    const configuration = new Configuration({
      database: {
        test: {
          default: {
            driver: SqliteDriver,
            migrations: false,
            name: "velocious-cli-tenant-progress-default",
            poolType: AsyncTrackedMultiConnection,
            type: "sqlite"
          },
          projectTenant: {
            driver: SqliteDriver,
            migrations: true,
            name: "velocious-cli-tenant-progress-project-default",
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

        return {name: `velocious-cli-tenant-progress-${tenantObject.slug}`}
      }
    })
    const cli = new Cli({
      configuration,
      directory,
      environmentHandler: new EnvironmentHandlerNode(),
      processArgs: ["db:tenants:check", "projectTenant"],
      testing: true
    })
    const command = new BaseCommand({
      args: {
        configuration,
        processArgs: ["db:tenants:check", "projectTenant"],
        testing: true
      },
      cli
    })
    /** @type {string[]} */
    const output = []
    const helper = new TenantDatabaseCommandHelper({
      command,
      heartbeatIntervalMs: 5,
      identifier: "projectTenant",
      output: (message) => output.push(message)
    })

    try {
      expect(await helper.eachTenant(async () => await wait(15))).toEqual(2)
      expect(output[0]).toEqual("db:tenants:check projectTenant: processing 2 tenant(s) with parallelism 1")
      expect(output).toContain("db:tenants:check projectTenant: heartbeat: 0/2 completed, 1 active")
      expect(output).toContain("db:tenants:check projectTenant: completed alpha (1/2)")
      expect(output).toContain("db:tenants:check projectTenant: completed beta (2/2)")
      expect(output.at(-1)).toEqual("db:tenants:check projectTenant: finished 2/2 tenant(s)")
    } finally {
      await configuration.closeDatabaseConnections()
      await fs.rm(directory, {force: true, recursive: true})
    }
  })
})
