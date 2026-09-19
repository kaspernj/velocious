import BrowserEnvironmentHandler from "velocious/build/src/environment-handlers/browser.js"
import Configuration from "velocious/build/src/configuration.js"
import DatabaseRecord from "velocious/build/src/database/record/index.js"
import FrontendModelBase from "velocious/build/src/frontend-models/base.js"
import Migration from "velocious/build/src/database/migration/index.js"
import SingleMultiUsePool from "velocious/build/src/database/pool/single-multi-use.js"
import SqliteDriver from "velocious/build/src/database/drivers/sqlite/index"
import Tenant from "velocious/build/src/tenants/tenant.js"
import useCreatedEvent from "velocious/build/src/frontend-models/use-created-event.js"

const PROJECT_DATABASE_IDENTIFIER = "projectTenant"
const PROJECT_SCHEMA_GENERATION = "expo-project-replica-1"
const sqliteDatabase = {
  driver: SqliteDriver,
  locateFile: (file) => `/${file}`,
  migrations: true,
  poolType: SingleMultiUsePool,
  type: "sqlite"
}

const configuration = new Configuration({
  database: {
    development: {
      default: {
        ...sqliteDatabase,
        name: "velocious-expo-example-development"
      },
      projectTenant: {
        ...sqliteDatabase,
        name: "velocious-expo-example-project-template",
        tenantOnly: true
      }
    },
    production: {
      default: {
        ...sqliteDatabase,
        name: "velocious-expo-example-production"
      },
      projectTenant: {
        ...sqliteDatabase,
        name: "velocious-expo-example-project-template",
        tenantOnly: true
      }
    }
  },
  environment: "development",
  environmentHandler: new BrowserEnvironmentHandler(),
  frontendTenantSqlite: {maxOpenHandles: 2},
  initializeModels: async () => {},
  locale: () => "en",
  localeFallbacks: {en: ["en"]},
  locales: ["en"],
  tenantDatabaseResolver: ({identifier, tenant}) => {
    if (identifier !== PROJECT_DATABASE_IDENTIFIER || !tenant || typeof tenant !== "object") return
    const projectId = /** @type {{projectId?: string}} */ (tenant).projectId

    if (projectId !== "alpha" && projectId !== "beta") return

    return {name: `velocious-expo-example-project-${projectId}.sqlite`}
  }
})

configuration.setCurrent()

FrontendModelBase.configureTransport({
  requestHeaders: () => ({}),
  url: () => "https://example.invalid"
})

class ExpoCompatibilityTask extends FrontendModelBase {
  static resourceConfig() {
    return {
      attributes: {
        id: {type: "integer"},
        name: {type: "string"}
      },
      builtInCollectionCommands: ["index", "create"],
      builtInMemberCommands: ["show", "update", "destroy"],
      modelName: "ExpoCompatibilityTask",
      primaryKey: "id",
      resourcePath: "/frontend-models/expo-compatibility-tasks"
    }
  }
}

class ExpoCompatibilityRecord extends DatabaseRecord {}
class CreateExpoCompatibilityRecords extends Migration {
  async up() {
    await this.execute("CREATE TABLE expo_compatibility_records(id integer PRIMARY KEY AUTOINCREMENT, name varchar(255) NOT NULL)")
  }
}

ExpoCompatibilityRecord.setTableName("expo_compatibility_records")
ExpoCompatibilityRecord.switchesTenantDatabase(PROJECT_DATABASE_IDENTIFIER)
ExpoCompatibilityRecord.registerRecordClass({configuration})
CreateExpoCompatibilityRecords.onDatabases([PROJECT_DATABASE_IDENTIFIER])

const migrationFile = "20260919091000-create-expo-compatibility-records.js"
const projectMigrations = (fileName) => {
  if (fileName !== migrationFile) throw new Error(`Unknown Expo project migration: ${fileName}`)

  return {default: CreateExpoCompatibilityRecords}
}

projectMigrations.keys = () => [migrationFile]
projectMigrations.id = "expo-project-replica-proof"

async function runFrontendTenantDatabaseProof() {
  const alpha = Tenant.handle({projectId: "alpha"}, configuration)
  const beta = Tenant.handle({projectId: "beta"}, configuration)

  try {
    await Promise.all([
      alpha.delete({databaseIdentifier: PROJECT_DATABASE_IDENTIFIER}),
      beta.delete({databaseIdentifier: PROJECT_DATABASE_IDENTIFIER})
    ])
    await Promise.all([
      alpha.initialize({databaseIdentifier: PROJECT_DATABASE_IDENTIFIER, migrations: projectMigrations, schemaGeneration: PROJECT_SCHEMA_GENERATION}),
      beta.initialize({databaseIdentifier: PROJECT_DATABASE_IDENTIFIER, migrations: projectMigrations, schemaGeneration: PROJECT_SCHEMA_GENERATION})
    ])

    await Promise.all([
      alpha.databaseOperation({databaseIdentifier: PROJECT_DATABASE_IDENTIFIER}, async (operation) => {
        await operation.forModel(ExpoCompatibilityRecord).create({name: "alpha-only"})
      }),
      beta.databaseOperation({databaseIdentifier: PROJECT_DATABASE_IDENTIFIER}, async (operation) => {
        await operation.forModel(ExpoCompatibilityRecord).create({name: "beta-only"})
      })
    ])
    await Promise.all([
      alpha.close({databaseIdentifier: PROJECT_DATABASE_IDENTIFIER, flush: true}),
      beta.close({databaseIdentifier: PROJECT_DATABASE_IDENTIFIER, flush: true})
    ])
    await Promise.all([
      alpha.initialize({databaseIdentifier: PROJECT_DATABASE_IDENTIFIER, migrations: projectMigrations, schemaGeneration: PROJECT_SCHEMA_GENERATION}),
      beta.initialize({databaseIdentifier: PROJECT_DATABASE_IDENTIFIER, migrations: projectMigrations, schemaGeneration: PROJECT_SCHEMA_GENERATION})
    ])

    const [alphaNames, betaNames] = await Promise.all([
      alpha.databaseOperation({databaseIdentifier: PROJECT_DATABASE_IDENTIFIER}, async (operation) => {
        return await operation.forModel(ExpoCompatibilityRecord).pluck("name")
      }),
      beta.databaseOperation({databaseIdentifier: PROJECT_DATABASE_IDENTIFIER}, async (operation) => {
        return await operation.forModel(ExpoCompatibilityRecord).pluck("name")
      })
    ])

    return {
      alphaNames,
      betaNames,
      distinctDatabaseIdentities: alpha.databaseIdentity(PROJECT_DATABASE_IDENTIFIER) !== beta.databaseIdentity(PROJECT_DATABASE_IDENTIFIER)
    }
  } finally {
    await Promise.all([
      alpha.delete({databaseIdentifier: PROJECT_DATABASE_IDENTIFIER}),
      beta.delete({databaseIdentifier: PROJECT_DATABASE_IDENTIFIER})
    ])
  }
}

FrontendModelBase.registerModel(ExpoCompatibilityTask)

export {configuration, ExpoCompatibilityRecord, ExpoCompatibilityTask, runFrontendTenantDatabaseProof, SqliteDriver, useCreatedEvent}
