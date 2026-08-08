// @ts-check

import AsyncTrackedMultiConnection from "../../src/database/pool/async-tracked-multi-connection.js"
import Configuration from "../../src/configuration.js"
import DatabaseRecord from "../../src/database/record/index.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import fs from "fs/promises"
import InitializerFromRequireContext from "../../src/database/initializer-from-require-context.js"
import os from "os"
import path from "path"
import SqliteDriver from "../../src/database/drivers/sqlite/index.js"

/**
 * Creates a real two-schema SQLite application for selected-tenant generator specs.
 * @param {string} prefix - Temporary directory/database prefix.
 * @param {object} [options] - Provider options.
 * @param {boolean} [options.missingModels] - Whether to register deferred models whose tables are absent.
 * @param {boolean} [options.multipleConditionalSlots] - Whether to register an unrelated conditional tenant database slot.
 * @param {boolean} [options.targetedResolution] - Whether the provider defines targeted generation resolution.
 * @returns {Promise<{
 *   cleanup: () => Promise<void>,
 *   configuration: Configuration,
 *   directory: string,
 *   getTenantOnlyInitializationTenants: () => {slug: string}[],
 *   getTenantListCalls: () => number,
 *   selectedTenant: {slug: string},
 *   setTenantCandidates: (tenants: {slug: string}[]) => void
 * }>} - Test application and controls.
 */
export async function createTenantDatabaseGenerationTestApp(prefix, {missingModels = false, multipleConditionalSlots = false, targetedResolution = true} = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`))
  const selectedTenant = Object.freeze({slug: "selected"})
  /** @type {{slug: string}[]} */
  let tenantCandidates = [selectedTenant]
  let tenantListCalls = 0
  /** @type {{slug: string}[]} */
  const tenantOnlyInitializationTenants = []

  class TenantOnlyWidget extends DatabaseRecord {
    /**
     * Records the active tenant when real require-context initialization reaches this model.
     * @param {object} args - Initialization arguments.
     * @param {Configuration} args.configuration - Test configuration.
     * @param {import("../../src/database/drivers/base.js").default} [args.connection] - Explicit metadata connection.
     * @returns {Promise<void>} - Resolves when initialized.
     */
    static async initializeRecord({configuration, connection}) {
      tenantOnlyInitializationTenants.push(configuration.getCurrentTenant())
      await super.initializeRecord({configuration, connection})
    }
  }
  class TenantSwitchedWidget extends DatabaseRecord {}
  class MissingDefaultWidget extends DatabaseRecord {}
  class MissingTenantWidget extends DatabaseRecord {}
  class UnrelatedTenantSwitchedWidget extends DatabaseRecord {}

  TenantOnlyWidget.setTableName("tenant_only_widgets")
  TenantOnlyWidget.setDatabaseIdentifier("projectTenant")
  TenantSwitchedWidget.setTableName("tenant_switched_widgets")
  TenantSwitchedWidget.switchesTenantDatabase(({tenant}) => {
    if (!tenant) return

    const tenantDescriptor = /** @type {{slug: string}} */ (tenant)

    return tenantDescriptor.slug === selectedTenant.slug ? "projectTenant" : undefined
  })
  MissingDefaultWidget.setTableName("missing_default_widgets")
  MissingTenantWidget.setTableName("missing_tenant_widgets")
  MissingTenantWidget.setDatabaseIdentifier("projectTenant")
  MissingDefaultWidget.setEagerLoadRecordMetadata(false)
  MissingTenantWidget.setEagerLoadRecordMetadata(false)
  UnrelatedTenantSwitchedWidget.setTableName("unrelated_tenant_switched_widgets")
  UnrelatedTenantSwitchedWidget.setEagerLoadRecordMetadata(false)
  UnrelatedTenantSwitchedWidget.switchesTenantDatabase(({tenant}) => {
    if (!tenant) return

    const tenantDescriptor = /** @type {{slug: string}} */ (tenant)

    return tenantDescriptor.slug === "unrelated" ? "unrelatedTenant" : undefined
  })

  const configuration = new Configuration({
    database: {
      test: {
        default: {
          driver: SqliteDriver,
          migrations: false,
          name: `${prefix}-default`,
          poolType: AsyncTrackedMultiConnection,
          type: "sqlite"
        },
        projectTenant: {
          driver: SqliteDriver,
          migrations: false,
          name: `${prefix}-project-template`,
          poolType: AsyncTrackedMultiConnection,
          tenantOnly: true,
          type: "sqlite"
        },
        ...(multipleConditionalSlots ? {
          unrelatedTenant: {
            driver: SqliteDriver,
            migrations: false,
            name: `${prefix}-unrelated-template`,
            poolType: AsyncTrackedMultiConnection,
            tenantOnly: true,
            type: "sqlite"
          }
        } : {})
      }
    },
    directory,
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    initializeModels: async ({configuration}) => {
      /** @type {Record<string, {default: typeof DatabaseRecord}>} */
      const models = {
        "./tenant-only-widget.js": {default: TenantOnlyWidget},
        "./tenant-switched-widget.js": {default: TenantSwitchedWidget},
        ...(missingModels ? {
          "./missing-default-widget.js": {default: MissingDefaultWidget},
          "./missing-tenant-widget.js": {default: MissingTenantWidget}
        } : {}),
        ...(multipleConditionalSlots ? {
          "./unrelated-tenant-switched-widget.js": {default: UnrelatedTenantSwitchedWidget}
        } : {})
      }
      const requireContext = /** @type {import("../../src/database/initializer-from-require-context.js").ModelClassRequireContextType} */ ((fileName) => models[fileName])

      requireContext.keys = () => Object.keys(models)
      requireContext.id = "tenant-database-generation-test-helper"

      await configuration.ensureConnections({name: "Initialize tenant generator test models"}, async () => {
        await new InitializerFromRequireContext({requireContext}).initialize({configuration})
      })
    },
    locale: "en",
    localeFallbacks: {en: ["en"]},
    locales: ["en"],
    structureSql: {enabledEnvironments: ["test"]},
    tenantDatabaseProviders: {
      projectTenant: {
        listTenants: async () => {
          tenantListCalls++

          return [...tenantCandidates]
        },
        ...(targetedResolution ? {resolveGenerationTenant: async () => selectedTenant} : {})
      },
      ...(multipleConditionalSlots ? {
        unrelatedTenant: {
          listTenants: async () => [{slug: "unrelated"}],
          resolveGenerationTenant: async () => ({slug: "unrelated"})
        }
      } : {})
    },
    tenantDatabaseResolver: ({identifier, tenant}) => {
      if (!tenant || typeof tenant !== "object") return

      const slug = /** @type {{slug?: string}} */ (tenant).slug

      if (!slug) return
      if (identifier === "unrelatedTenant") {
        if (slug !== "unrelated") return

        return {name: `${prefix}-unrelated-${slug}`}
      }
      if (identifier !== "projectTenant") return
      if (slug !== selectedTenant.slug) return

      return {name: `${prefix}-project-${slug}`}
    }
  })

  await fs.mkdir(path.join(directory, "src", "models"), {recursive: true})
  await configuration.ensureConnections({databaseIdentifiers: ["default"], name: "Seed generator control schema"}, async (dbs) => {
    await dbs.default.query("CREATE TABLE tenant_switched_widgets (id INTEGER PRIMARY KEY NOT NULL, control_name TEXT NOT NULL)")
    await dbs.default.query("CREATE TABLE control_markers (id INTEGER PRIMARY KEY NOT NULL, name TEXT NOT NULL)")
  })
  await configuration.runWithTenant(selectedTenant, async () => {
    await configuration.ensureConnections({databaseIdentifiers: ["projectTenant"], name: "Seed generator tenant schema"}, async (dbs) => {
      await dbs.projectTenant.query("CREATE TABLE tenant_only_widgets (id INTEGER PRIMARY KEY NOT NULL, tenant_name TEXT NOT NULL)")
      await dbs.projectTenant.query("CREATE TABLE tenant_switched_widgets (id INTEGER PRIMARY KEY NOT NULL, tenant_name TEXT NOT NULL, routing_epoch INTEGER NOT NULL)")
    })
  })

  return {
    cleanup: async () => {
      await configuration.closeDatabaseConnections()
      await fs.rm(directory, {force: true, recursive: true})
    },
    configuration,
    directory,
    getTenantOnlyInitializationTenants: () => [...tenantOnlyInitializationTenants],
    getTenantListCalls: () => tenantListCalls,
    selectedTenant,
    setTenantCandidates: (tenants) => {
      tenantCandidates = tenants
    }
  }
}
