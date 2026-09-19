// @ts-check

import Configuration, { CurrentConfigurationNotSetError } from "../configuration.js"
import DatabaseRecord from "../database/record/index.js"
import BrowserEnvironmentHandler from "../environment-handlers/browser.js"
import Migration from "../database/migration/index.js"
import SingleMultiUsePool from "../database/pool/single-multi-use.js"
import SqliteWebDriver from "../database/drivers/sqlite/index.web.js"
import Tenant from "../tenants/tenant.js"

const DATABASE_IDENTIFIER = "projectTenant"
const SCHEMA_GENERATION = "frontend-tenant-browser-persistence-1"

/**
 * Returns the current configuration without requiring one to exist.
 * @returns {Configuration | undefined} Current configuration when installed.
 */
function currentConfigurationOrUndefined() {
  try {
    return Configuration.current()
  } catch (error) {
    if (!(error instanceof CurrentConfigurationNotSetError)) throw error

    return undefined
  }
}

/**
 * Builds the real browser-backed two-project configuration.
 * @returns {Configuration} Browser tenant configuration.
 */
function buildConfiguration() {
  return new Configuration({
    database: {
      test: {
        projectTenant: {
          driver: SqliteWebDriver,
          locateFile: () => "/sql-wasm.wasm",
          migrations: true,
          name: "velocious-browser-project-proof-template",
          poolType: SingleMultiUsePool,
          tenantOnly: true,
          type: "sqlite"
        }
      }
    },
    directory: "/frontend-tenant-browser-persistence-scenario",
    environment: "test",
    environmentHandler: new BrowserEnvironmentHandler(),
    frontendTenantSqlite: {maxOpenHandles: 2},
    initializeModels: async () => {},
    locale: "en",
    localeFallbacks: {en: ["en"]},
    locales: ["en"],
    tenantDatabaseResolver: ({identifier, tenant}) => {
      if (identifier !== DATABASE_IDENTIFIER || !tenant || typeof tenant !== "object") return
      const projectSlug = /** @type {{projectSlug?: string}} */ (tenant).projectSlug

      if (projectSlug !== "alpha" && projectSlug !== "beta") return

      return {name: `velocious-browser-project-proof-${projectSlug}`}
    }
  })
}

/**
 * Exercises two durable physical tenant databases inside the real browser.
 * @returns {Promise<{alphaNames: ReturnType<typeof JSON.parse>[], betaNames: ReturnType<typeof JSON.parse>[], identitiesAreDistinct: boolean, openCount: number}>} Serializable proof result.
 */
export default async function runFrontendTenantDatabasePersistenceScenario() {
  const previousConfiguration = currentConfigurationOrUndefined()
  const configuration = buildConfiguration()

  class BrowserProjectRecord extends DatabaseRecord {}
  class CreateBrowserProjectRecords extends Migration {
    async up() {
      await this.execute("CREATE TABLE browser_project_records(id integer PRIMARY KEY AUTOINCREMENT, name varchar(255) NOT NULL)")
    }
  }

  BrowserProjectRecord.setTableName("browser_project_records")
  BrowserProjectRecord.switchesTenantDatabase(DATABASE_IDENTIFIER)
  BrowserProjectRecord.registerRecordClass({configuration})
  CreateBrowserProjectRecords.onDatabases([DATABASE_IDENTIFIER])

  const migrationFile = "20260919090000-create-browser-project-records.js"
  /**
   * Loads the one migration bundled into this browser proof.
   * @type {import("../database/migrator/types.js").RequireMigrationContextType}
   */
  const migrations = (fileName) => {
    if (fileName !== migrationFile) throw new Error(`Unknown browser tenant proof migration: ${fileName}`)

    return {default: CreateBrowserProjectRecords}
  }

  migrations.keys = () => [migrationFile]
  migrations.id = "frontend-tenant-browser-persistence-scenario"

  const alpha = Tenant.handle({projectSlug: "alpha"}, configuration)
  const beta = Tenant.handle({projectSlug: "beta"}, configuration)

  configuration.setCurrent()

  try {
    await Promise.all([
      alpha.delete({databaseIdentifier: DATABASE_IDENTIFIER}),
      beta.delete({databaseIdentifier: DATABASE_IDENTIFIER})
    ])
    await Promise.all([
      alpha.initialize({databaseIdentifier: DATABASE_IDENTIFIER, migrations, schemaGeneration: SCHEMA_GENERATION}),
      beta.initialize({databaseIdentifier: DATABASE_IDENTIFIER, migrations, schemaGeneration: SCHEMA_GENERATION})
    ])

    for (let index = 0; index < 12; index++) {
      await Promise.all([
        alpha.databaseOperation({databaseIdentifier: DATABASE_IDENTIFIER}, async (operation) => {
          await operation.forModel(BrowserProjectRecord).create({name: `alpha-${index}`})
        }),
        beta.databaseOperation({databaseIdentifier: DATABASE_IDENTIFIER}, async (operation) => {
          await operation.forModel(BrowserProjectRecord).create({name: `beta-${index}`})
        })
      ])
    }

    await Promise.all([
      alpha.close({databaseIdentifier: DATABASE_IDENTIFIER, flush: true}),
      beta.close({databaseIdentifier: DATABASE_IDENTIFIER, flush: true})
    ])
    await Promise.all([
      alpha.initialize({databaseIdentifier: DATABASE_IDENTIFIER, migrations, schemaGeneration: SCHEMA_GENERATION}),
      beta.initialize({databaseIdentifier: DATABASE_IDENTIFIER, migrations, schemaGeneration: SCHEMA_GENERATION})
    ])

    const [alphaNames, betaNames] = await Promise.all([
      alpha.databaseOperation({databaseIdentifier: DATABASE_IDENTIFIER}, async (operation) => {
        return await operation.forModel(BrowserProjectRecord).order("id").pluck("name")
      }),
      beta.databaseOperation({databaseIdentifier: DATABASE_IDENTIFIER}, async (operation) => {
        return await operation.forModel(BrowserProjectRecord).order("id").pluck("name")
      })
    ])

    return {
      alphaNames,
      betaNames,
      identitiesAreDistinct: alpha.databaseIdentity(DATABASE_IDENTIFIER) !== beta.databaseIdentity(DATABASE_IDENTIFIER),
      openCount: configuration.inspectFrontendTenantSqliteHandles().openCount
    }
  } finally {
    await Promise.all([
      alpha.delete({databaseIdentifier: DATABASE_IDENTIFIER}),
      beta.delete({databaseIdentifier: DATABASE_IDENTIFIER})
    ])
    if (previousConfiguration) previousConfiguration.setCurrent()
    await configuration.closeDatabaseConnections()
  }
}
