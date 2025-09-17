import {digg} from "diggerize"
import * as inflection from "inflection"
import {Logger} from "../logger.js"
import TableData from "./table-data/index.js"

export default class VelociousDatabaseMigrator {
  constructor({configuration}) {
    this.configuration = configuration
    this.logger = new Logger(this)
  }

  async prepare() {
    await this.createMigrationsTable()
    await this.loadMigrationsVersions()
  }

  async createMigrationsTable() {
    const dbs = await this.configuration.getCurrentConnections()

    for (const dbIdentifier in dbs) {
      const db = dbs[dbIdentifier]
      const databaseConfiguration = this.configuration.getDatabaseIdentifier(dbIdentifier)

      if (!databaseConfiguration.migrations) {
        this.logger.log(`${dbIdentifier} isn't configured for migrations - skipping creating migrations table for it`)
        continue
      }

      if (await this.migrationsTableExist(db)) {
        this.logger.log(`${dbIdentifier} migrations table already exists - skipping`)
        continue
      }

      const schemaMigrationsTable = new TableData("schema_migrations", {ifNotExists: true})

      schemaMigrationsTable.string("version", {null: false, primaryKey: true})

      const createSchemaMigrationsTableSqls = db.createTableSql(schemaMigrationsTable)

      for (const createSchemaMigrationsTableSql of createSchemaMigrationsTableSqls) {
        await db.query(createSchemaMigrationsTableSql)
      }
    }
  }

  hasRunMigrationVersion(dbIdentifier, version) {
    if (!this.migrationsVersions) throw new Error("Migrations versions hasn't been loaded yet")
    if (!this.migrationsVersions[dbIdentifier]) throw new Error(`Migrations versions hasn't been loaded yet for db: ${dbIdentifier}`)

    if (version in this.migrationsVersions[dbIdentifier]) {
      return true
    }

    return false
  }

  async migrateFiles(files, importCallback) {
    await this.configuration.ensureConnections(async () => {
      for (const migration of files) {
        await this.runMigrationFile({
          migration,
          requireMigration: async () => {
            const migrationImport = await importCallback(migration.fullPath)

            return migrationImport.default
          }
        })
      }
    })
  }

  async migrateFilesFromRequireContext(requireContext) {
    const files = requireContext
      .keys()
      .map((file) => {
        // "13,14" because somes "require-context"-npm-module deletes first character!?
        const match = file.match(/(\d{13,14})-(.+)\.js$/)

        if (!match) return null

        // Fix require-context-npm-module deletes first character
        let fileName = file
        let dateNumber = match[1]

        if (dateNumber.length == 13) {
          dateNumber = `2${dateNumber}`
          fileName = `2${fileName}`
        }

        // Parse regex
        const date = parseInt(dateNumber)
        const migrationName = match[2]
        const migrationClassName = inflection.camelize(migrationName.replaceAll("-", "_"))

        return {
          file: fileName,
          date,
          migrationClassName
        }
      })
      .filter((migration) => Boolean(migration))
      .sort((migration1, migration2) => migration1.date - migration2.date)

    await this.configuration.ensureConnections(async () => {
      for (const migration of files) {
        await this.runMigrationFile({
          migration,
          requireMigration: () => requireContext(migration.file).default
        })
      }
    })
  }

  async loadMigrationsVersions() {
    this.migrationsVersions = {}

    const dbs = await this.configuration.getCurrentConnections()

    for (const dbIdentifier in dbs) {
      const db = dbs[dbIdentifier]
      const databaseConfiguration = this.configuration.getDatabaseIdentifier(dbIdentifier)

      if (!databaseConfiguration.migrations) {
        this.logger.debug(`${dbIdentifier} isn't configured for migrations - skipping loading migrations versions for it`)
        continue
      }

      if (!await this.migrationsTableExist(db)) {
        this.logger.log(`Migration table does not exist for ${dbIdentifier} - skipping loading migrations versions for it`)
        continue
      }

      const rows = await db.select("schema_migrations")

      this.migrationsVersions[dbIdentifier] = {}

      for (const row of rows) {
        const version = digg(row, "version")

        this.migrationsVersions[dbIdentifier][version] = true
      }
    }
  }

  async migrationsTableExist(db) {
    const schemaTable = await db.getTableByName("schema_migrations", {throwError: false})

    if (!schemaTable) return false

    return true
  }

  async executeRequireContext(requireContext) {
    const migrationFiles = requireContext.keys()

    files = migrationFiles
      .map((file) => {
        const match = file.match(/^(\d{14})-(.+)\.js$/)

        if (!match) return null

        const date = parseInt(match[1])
        const migrationName = match[2]
        const migrationClassName = inflection.camelize(migrationName)

        return {
          file,
          fullPath: `${migrationsPath}/${file}`,
          date,
          migrationClassName
        }
      })
      .filter((migration) => Boolean(migration))
      .sort((migration1, migration2) => migration1.date - migration2.date)

    for (const migration of files) {
      await this.runMigrationFile({
        migration,
        require: requireContext(migration.file).default
      })
    }
  }

  async reset() {
    const dbs = await this.configuration.getCurrentConnections()

    for (const dbIdentifier in dbs) {
      const db = dbs[dbIdentifier]

      await db.withDisabledForeignKeys(async () => {
        while (true) {
          const errors = []
          let anyTableDropped = false

          try {
            for (const table of await db.getTables()) {
              this.logger.log(`Dropping table ${table.getName()}`)

              try {
                await db.dropTable(table.getName(), {cascade: true})
                anyTableDropped = true
              } catch (error) {
                errors.push(error)
              }
            }

            break
          } catch (error) {
            if (errors.length > 0 && anyTableDropped) {
              // Retry
            } else {
              throw errors[0]
            }
          }
        }
      })
    }
  }

  async runMigrationFile({migration, requireMigration}) {
    if (!this.configuration) throw new Error("No configuration set")
    if (!this.configuration.isDatabasePoolInitialized()) await this.configuration.initializeDatabasePool()
    if (!this.migrationsVersions) await this.loadMigrationsVersions()

    const dbs = await this.configuration.getCurrentConnections()
    const migrationClass = await requireMigration()
    const migrationDatabaseIdentifiers = migrationClass.getDatabaseIdentifiers() || ["default"]

    for (const dbIdentifier in dbs) {
      const databaseConfiguration = this.configuration.getDatabaseIdentifier(dbIdentifier)

      if (!databaseConfiguration.migrations) {
        this.logger.debug(`${dbIdentifier} isn't configured for migrations - skipping migration ${digg(migration, "date")}`)
        continue
      }

      if (!migrationDatabaseIdentifiers.includes(dbIdentifier)) {
        this.logger.debug(`${dbIdentifier} shouldn't run migration ${migration.file}`, {migrationDatabaseIdentifiers})
        continue
      }

      if (this.hasRunMigrationVersion(dbIdentifier, migration.date)) {
        this.logger.debug(`${dbIdentifier} has already run migration ${migration.file}`)
        continue
      }

      this.logger.debug(`Running migration on ${dbIdentifier}: ${migration.file}`, {migrationDatabaseIdentifiers})

      const db = dbs[dbIdentifier]
      const MigrationClass = migrationClass
      const migrationInstance = new MigrationClass({
        configuration: this.configuration,
        db
      })

      if (migrationInstance.change) {
        await migrationInstance.change()
      } else if (migrationInstance.up) {
        await migrationInstance.up()
      } else {
        throw new Error(`'change' or 'up' didn't exist on migration: ${migration.file}`)
      }

      const dateString = digg(migration, "date")
      const existingSchemaMigrations = await db.newQuery()
        .from("schema_migrations")
        .where({version: `${dateString}`})
        .results()

      if (existingSchemaMigrations.length == 0) {
        await db.insert({tableName: "schema_migrations", data: {version: dateString}})
      }
    }
  }
}
