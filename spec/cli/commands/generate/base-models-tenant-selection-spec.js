// @ts-check

import {describe, expect, it} from "../../../../src/testing/test.js"
import Cli from "../../../../src/cli/index.js"
import {createTenantDatabaseGenerationTestApp} from "../../../helpers/tenant-database-generation-test-helper.js"
import EnvironmentHandlerNode from "../../../../src/environment-handlers/node.js"
import fs from "fs/promises"
import path from "path"

/**
 * Executes one base-model command and returns its error message.
 * @param {import("../../../../src/configuration.js").default} configuration - Test configuration.
 * @param {string} directory - Test application directory.
 * @param {string[]} processArgs - Command arguments.
 * @returns {Promise<string>} - Rejection message.
 */
async function baseModelCommandError(configuration, directory, processArgs) {
  const cli = new Cli({
    configuration,
    directory,
    environmentHandler: new EnvironmentHandlerNode(),
    processArgs,
    testing: true
  })

  try {
    await cli.execute()
  } catch (error) {
    if (error instanceof Error) return error.message

    throw error
  }

  throw new Error("Expected base-model command to fail")
}

describe("Cli - generate - base-models selected tenant database", () => {
  it("generates tenant-only and tenant-switched models from the selected physical schema", async () => {
    const app = await createTenantDatabaseGenerationTestApp("velocious-base-model-selected")

    try {
      const cli = new Cli({
        configuration: app.configuration,
        directory: app.directory,
        environmentHandler: new EnvironmentHandlerNode(),
        processArgs: ["g:base-models", "--tenant", "projectTenant"],
        testing: true
      })

      await cli.execute()

      const tenantOnlyContents = await fs.readFile(path.join(app.directory, "src", "model-bases", "tenant-only-widget.js"), "utf8")
      const switchedContents = await fs.readFile(path.join(app.directory, "src", "model-bases", "tenant-switched-widget.js"), "utf8")

      expect(tenantOnlyContents).toContain("tenantName()")
      expect(switchedContents).toContain("tenantName()")
      expect(switchedContents).toContain("routingEpoch()")
      expect(switchedContents).not.toContain("controlName()")
      expect(tenantOnlyContents).toContain("Run `velocious generate:base-models --tenant projectTenant` to regenerate.")
      expect(switchedContents).toContain("Run `velocious generate:base-models --tenant projectTenant` to regenerate.")
    } finally {
      await app.cleanup()
    }
  })

  it("keeps no-selector generation on the ordinary default schema", async () => {
    const app = await createTenantDatabaseGenerationTestApp("velocious-base-model-default")

    try {
      const cli = new Cli({
        configuration: app.configuration,
        directory: app.directory,
        environmentHandler: new EnvironmentHandlerNode(),
        processArgs: ["generate:base-models"],
        testing: true
      })

      await cli.execute()

      const switchedContents = await fs.readFile(path.join(app.directory, "src", "model-bases", "tenant-switched-widget.js"), "utf8")

      expect(switchedContents).toContain("controlName()")
      expect(switchedContents).not.toContain("tenantName()")
      expect(switchedContents).toContain("Run `velocious generate:base-models` to regenerate.")
      expect(switchedContents).not.toContain("--tenant")
      expect(await fs.stat(path.join(app.directory, "src", "model-bases", "tenant-only-widget.js")).then(() => true, () => false)).toEqual(false)
    } finally {
      await app.cleanup()
    }
  })

  it("skips an uninitialized ordinary model whose table is absent when allowed", async () => {
    const app = await createTenantDatabaseGenerationTestApp("velocious-base-model-missing-default", {missingModels: true})

    try {
      const cli = new Cli({
        configuration: app.configuration,
        directory: app.directory,
        environmentHandler: new EnvironmentHandlerNode(),
        processArgs: ["g:base-models", "--allow-missing-tables"],
        testing: true
      })

      await cli.execute()

      expect(app.configuration.getModelClass("MissingDefaultWidget").isInitialized()).toEqual(false)
      expect(await fs.stat(path.join(app.directory, "src", "model-bases", "missing-default-widget.js")).then(() => true, () => false)).toEqual(false)
    } finally {
      await app.cleanup()
    }
  })

  it("skips an uninitialized selected-tenant model whose table is absent when allowed", async () => {
    const app = await createTenantDatabaseGenerationTestApp("velocious-base-model-missing-tenant", {missingModels: true})

    try {
      const cli = new Cli({
        configuration: app.configuration,
        directory: app.directory,
        environmentHandler: new EnvironmentHandlerNode(),
        processArgs: ["g:base-models", "--tenant", "projectTenant", "--allow-missing-tables"],
        testing: true
      })

      await cli.execute()

      expect(app.configuration.getModelClass("MissingTenantWidget").isInitialized()).toEqual(false)
      expect(await fs.stat(path.join(app.directory, "src", "model-bases", "missing-tenant-widget.js")).then(() => true, () => false)).toEqual(false)
    } finally {
      await app.cleanup()
    }
  })

  it("excludes switched models whose other conditional tenant database slot is inactive", async () => {
    const app = await createTenantDatabaseGenerationTestApp("velocious-base-model-conditional-slots", {multipleConditionalSlots: true})

    try {
      const cli = new Cli({
        configuration: app.configuration,
        directory: app.directory,
        environmentHandler: new EnvironmentHandlerNode(),
        processArgs: ["g:base-models", "--tenant", "projectTenant"],
        testing: true
      })

      await cli.execute()

      expect(await fs.stat(path.join(app.directory, "src", "model-bases", "tenant-switched-widget.js")).then(() => true, () => false)).toEqual(true)
      expect(await fs.stat(path.join(app.directory, "src", "model-bases", "unrelated-tenant-switched-widget.js")).then(() => true, () => false)).toEqual(false)
    } finally {
      await app.cleanup()
    }
  })

  it("fails closed for missing, unknown, empty, and ambiguous tenant selections", async () => {
    const app = await createTenantDatabaseGenerationTestApp("velocious-base-model-selection-errors", {targetedResolution: false})

    try {
      expect(await baseModelCommandError(app.configuration, app.directory, ["g:base-models", "--tenant"]))
        .toEqual("Missing value for --tenant")
      expect(await baseModelCommandError(app.configuration, app.directory, ["g:base-models", "--tenant", "missingTenant"]))
        .toEqual("No such tenant database identifier configured: missingTenant")

      app.setTenantCandidates([])
      expect(await baseModelCommandError(app.configuration, app.directory, ["g:base-models", "--tenant", "projectTenant"]))
        .toEqual("Tenant database selection projectTenant resolved no tenants")

      app.setTenantCandidates([{slug: ""}])
      expect(await baseModelCommandError(app.configuration, app.directory, ["g:base-models", "--tenant", "projectTenant"]))
        .toEqual("Unknown or inactive database identifier for tenant handle: projectTenant")

      app.setTenantCandidates([{slug: "first"}, {slug: "second"}])
      expect(await baseModelCommandError(app.configuration, app.directory, ["g:base-models", "--tenant", "projectTenant"]))
        .toEqual("Tenant database selection projectTenant is ambiguous: provider returned 2 tenants")
    } finally {
      await app.cleanup()
    }
  })

  it("rejects unknown arguments for both base-model command aliases", async () => {
    const app = await createTenantDatabaseGenerationTestApp("velocious-base-model-arguments")

    try {
      expect(await baseModelCommandError(app.configuration, app.directory, ["g:base-models", "--tenent", "projectTenant"]))
        .toEqual("Unknown argument for g:base-models: --tenent")
      expect(await baseModelCommandError(app.configuration, app.directory, ["generate:base-models", "--tenant", "projectTenant", "extra"]))
        .toEqual("Unknown argument for generate:base-models: extra")
    } finally {
      await app.cleanup()
    }
  })
})
