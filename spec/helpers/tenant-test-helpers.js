// @ts-check

import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import AsyncTrackedMultiConnection from "../../src/database/pool/async-tracked-multi-connection.js"
import SqliteDriver from "../../src/database/drivers/sqlite/index.js"
import fs from "fs/promises"
import os from "os"
import path from "path"

/**
 * @typedef {{slug: string}} TenantTestTenant
 */

/**
 * @param {string} prefix - Temp-path prefix.
 * @returns {Promise<{cleanup: () => Promise<void>, configuration: Configuration}>} - Test configuration and cleanup.
 */
export async function createTenantTestConfiguration(prefix) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`))

  const configuration = new Configuration({
    database: {
      test: {
        analytics: {
          driver: SqliteDriver,
          migrations: false,
          name: `${prefix}-analytics-default`,
          poolType: AsyncTrackedMultiConnection,
          type: "sqlite"
        },
        default: {
          driver: SqliteDriver,
          migrations: false,
          name: `${prefix}-default`,
          poolType: AsyncTrackedMultiConnection,
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
    tenantDatabaseResolver: ({identifier, tenant}) => {
      const tenantSlug = tenantSlugFromUnknownTenant(tenant)

      if (!tenantSlug) return

      return {name: `${prefix}-${identifier}-${tenantSlug}`}
    },
    tenantResolver: async ({params, subscription}) => {
      const projectSlug = tenantSlugFromParams(subscription?.params || params)

      if (!projectSlug) return

      return {slug: projectSlug}
    }
  })

  return {
    cleanup: async () => {
      await configuration.closeDatabaseConnections()
      await fs.rm(directory, {force: true, recursive: true})
    },
    configuration
  }
}

/**
 * @param {Configuration} configuration - Configuration.
 * @param {"analytics" | "default"} identifier - Database identifier.
 * @param {string | undefined} tenantSlug - Tenant slug.
 * @param {string} value - Stored value.
 * @returns {Promise<void>} - Resolves when complete.
 */
export async function seedTenantValue(configuration, identifier, tenantSlug, value) {
  const tenant = tenantSlug ? {slug: tenantSlug} : undefined

  await configuration.runWithTenant(tenant, async () => {
    await configuration.ensureConnections(async (dbs) => {
      const db = dbs[identifier]

      await db.query("CREATE TABLE IF NOT EXISTS tenant_values(value varchar(255) NOT NULL)")
      await db.query("DELETE FROM tenant_values")
      await db.query(`INSERT INTO tenant_values(value) VALUES (${db.quote(value)})`)
    })
  })
}

/**
 * @param {Configuration} configuration - Configuration.
 * @param {"analytics" | "default"} identifier - Database identifier.
 * @param {string | undefined} tenantSlug - Tenant slug.
 * @returns {Promise<string | undefined>} - Stored value.
 */
export async function readTenantValue(configuration, identifier, tenantSlug) {
  const tenant = tenantSlug ? {slug: tenantSlug} : undefined

  return await configuration.runWithTenant(tenant, async () => {
    return await configuration.ensureConnections(async (dbs) => {
      const rows = await dbs[identifier].query("SELECT value FROM tenant_values LIMIT 1")

      return rows[0]?.value
    })
  })
}

/**
 * @param {Record<string, unknown> | undefined} params - Params object.
 * @returns {string | undefined} - Tenant slug.
 */
function tenantSlugFromParams(params) {
  if (!params || typeof params !== "object") return

  const projectSlug = params.project_slug

  if (typeof projectSlug !== "string") return

  const trimmed = projectSlug.trim()

  return trimmed || undefined
}

/**
 * @param {unknown} tenant - Tenant value.
 * @returns {string | undefined} - Tenant slug.
 */
function tenantSlugFromUnknownTenant(tenant) {
  if (!tenant || typeof tenant !== "object") return

  const tenantObject = /** @type {TenantTestTenant} */ (tenant)

  if (typeof tenantObject.slug !== "string") return

  const trimmed = tenantObject.slug.trim()

  return trimmed || undefined
}
