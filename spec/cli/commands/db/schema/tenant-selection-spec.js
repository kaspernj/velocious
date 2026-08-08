// @ts-check

import {describe, expect, it} from "../../../../../src/testing/test.js"
import Cli from "../../../../../src/cli/index.js"
import {createTenantDatabaseGenerationTestApp} from "../../../../helpers/tenant-database-generation-test-helper.js"
import EnvironmentHandlerNode from "../../../../../src/environment-handlers/node.js"
import fs from "fs/promises"
import path from "path"

describe("Cli - Commands - db:schema selected tenant database", () => {
  it("dumps and loads only one explicitly selected physical tenant database", async () => {
    const app = await createTenantDatabaseGenerationTestApp("velocious-schema-selected")
    const structurePath = path.join(app.directory, "db", "structure-projectTenant.sql")

    try {
      const dumpCli = new Cli({
        configuration: app.configuration,
        directory: app.directory,
        environmentHandler: new EnvironmentHandlerNode(),
        processArgs: ["db:schema:dump", "--tenant", "projectTenant"],
        testing: true
      })

      await dumpCli.execute()

      const structureSql = await fs.readFile(structurePath, "utf8")

      expect(app.getTenantListCalls()).toEqual(0)
      expect(structureSql).toContain("tenant_only_widgets")
      expect(structureSql).toContain("routing_epoch")
      expect(structureSql).not.toContain("control_markers")

      await app.configuration.runWithTenant(app.selectedTenant, async () => {
        await app.configuration.ensureConnections({databaseIdentifiers: ["projectTenant"], name: "Prepare selected structure load"}, async (dbs) => {
          await dbs.projectTenant.query("DROP TABLE tenant_only_widgets")
          await dbs.projectTenant.query("DROP TABLE tenant_switched_widgets")
        })
      })

      const loadCli = new Cli({
        configuration: app.configuration,
        directory: app.directory,
        environmentHandler: new EnvironmentHandlerNode(),
        processArgs: ["db:schema:load", "--tenant", "projectTenant"],
        testing: true
      })

      await loadCli.execute()

      await app.configuration.runWithTenant(app.selectedTenant, async () => {
        await app.configuration.ensureConnections({databaseIdentifiers: ["projectTenant"], name: "Verify selected structure load"}, async (dbs) => {
          expect(await dbs.projectTenant.tableExists("tenant_only_widgets")).toEqual(true)
          expect(await dbs.projectTenant.tableExists("tenant_switched_widgets")).toEqual(true)
        })
      })
      await app.configuration.ensureConnections({databaseIdentifiers: ["default"], name: "Verify control schema unchanged"}, async (dbs) => {
        expect(await dbs.default.tableExists("control_markers")).toEqual(true)
      })
    } finally {
      await app.cleanup()
    }
  })

  it("rejects unknown selected-schema arguments instead of silently using default", async () => {
    const app = await createTenantDatabaseGenerationTestApp("velocious-schema-selected-arguments")
    const cli = new Cli({
      configuration: app.configuration,
      directory: app.directory,
      environmentHandler: new EnvironmentHandlerNode(),
      processArgs: ["db:schema:dump", "--tenent", "projectTenant"],
      testing: true
    })
    let message

    try {
      await cli.execute()
    } catch (error) {
      if (error instanceof Error) message = error.message
    } finally {
      await app.cleanup()
    }

    expect(message).toEqual("Unknown argument for db:schema:dump: --tenent")
  })
})
