// @ts-check

/**
 * Default tenant-database provisioning used by `db:tenants:create`,
 * `db:tenants:drop`, and `Tenant.drop` when a tenant-database provider does not
 * define its own `createDatabase`/`dropDatabase`. This is the generic,
 * driver-agnostic lifecycle every app on the tenant framework needs, so it lives
 * in the framework instead of being reimplemented in each consuming project.
 *
 * File-backed drivers (sqlite) have no server-side CREATE/DROP DATABASE — the file
 * is created on connect and left in place on drop — so creating just ensures the
 * tenant's connection and dropping is a no-op. Server drivers (mysql, pgsql, …)
 * connect to the configured maintenance database (`useDatabase`) and run the
 * driver's own `createDatabaseSql`/`dropDatabaseSql`.
 */

const SAFE_TENANT_DATABASE_NAME = /^[a-z0-9_]+$/

/**
 * Whether the driver stores each database as a local file instead of on a server.
 * @param {import("../configuration-types.js").DatabaseConfigurationType} databaseConfiguration - Resolved tenant database configuration.
 * @returns {boolean} - True for file-backed drivers such as sqlite.
 */
function fileBackedDriver(databaseConfiguration) {
  return databaseConfiguration.type === "sqlite"
}

/**
 * Validates the tenant database name against a strict allowlist before it is
 * interpolated into DDL.
 * @param {import("../configuration-types.js").DatabaseConfigurationType} databaseConfiguration - Resolved tenant database configuration.
 * @returns {string} - The validated tenant database name.
 */
function guardedDatabaseName(databaseConfiguration) {
  const databaseName = databaseConfiguration.database

  if (!databaseName || !SAFE_TENANT_DATABASE_NAME.test(databaseName)) {
    throw new Error(`Unsafe tenant database name: ${databaseName}`)
  }

  return databaseName
}

/**
 * Opens a driver connected to the server's maintenance database (`useDatabase`),
 * from which `CREATE DATABASE` / `DROP DATABASE` for the tenant can be issued.
 * @param {import("../configuration-types.js").DatabaseConfigurationType} databaseConfiguration - Resolved tenant database configuration.
 * @param {import("../configuration.js").default} configuration - The Velocious configuration.
 * @returns {import("../database/drivers/base.js").default} - A driver bound to the maintenance database.
 */
function maintenanceConnection(databaseConfiguration, configuration) {
  const DriverClass = databaseConfiguration.driver

  if (!DriverClass) {
    throw new Error("Tenant database configuration is missing a driver.")
  }

  if (!databaseConfiguration.useDatabase) {
    throw new Error("Tenant database configuration is missing a maintenance database in useDatabase.")
  }

  return new DriverClass({...databaseConfiguration, database: databaseConfiguration.useDatabase}, configuration)
}

/**
 * Creates the tenant database for one tenant.
 * @param {{configuration: import("../configuration.js").default, databaseConfiguration: import("../configuration-types.js").DatabaseConfigurationType, identifier?: string, tenant: ?}} args - Provisioning arguments.
 * @returns {Promise<void>} - Resolves once the tenant database exists.
 */
export async function createTenantDatabase({configuration, databaseConfiguration, identifier, tenant}) {
  if (fileBackedDriver(databaseConfiguration)) {
    await configuration.runWithTenant(tenant, async () => {
      await configuration.ensureConnections({databaseIdentifiers: identifier ? [identifier] : undefined, name: "Create file-backed tenant database"}, async () => {})
    })

    return
  }

  const databaseName = guardedDatabaseName(databaseConfiguration)
  const connection = maintenanceConnection(databaseConfiguration, configuration)

  await connection.connect()

  try {
    const sqls = connection.createDatabaseSql(databaseName, {
      databaseCharset: databaseConfiguration.databaseCharset,
      databaseCollation: databaseConfiguration.databaseCollation,
      ifNotExists: true
    })

    for (const sql of sqls) {
      await connection.query(sql)
    }
  } finally {
    await connection.close()
  }
}

/**
 * Drops the tenant database for one tenant. Uses `DROP DATABASE IF EXISTS`, so it
 * is a safe no-op for a tenant that was never fully provisioned.
 * @param {{configuration: import("../configuration.js").default, databaseConfiguration: import("../configuration-types.js").DatabaseConfigurationType}} args - Provisioning arguments.
 * @returns {Promise<void>} - Resolves once the tenant database is gone.
 */
export async function dropTenantDatabase({configuration, databaseConfiguration}) {
  if (fileBackedDriver(databaseConfiguration)) {
    return
  }

  const databaseName = guardedDatabaseName(databaseConfiguration)
  const connection = maintenanceConnection(databaseConfiguration, configuration)

  await connection.connect()

  try {
    const sqls = connection.dropDatabaseSql(databaseName, {ifExists: true})

    for (const sql of sqls) {
      await connection.query(sql)
    }
  } finally {
    await connection.close()
  }
}
