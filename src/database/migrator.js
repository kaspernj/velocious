// @ts-check

import {digg} from "diggerize"
import * as inflection from "inflection"
import {Logger} from "../logger.js"
import {NotImplementedError} from "./migration/index.js"
import restArgsError from "../utils/rest-args-error.js"
import TableData from "./table-data/index.js"

export default class VelociousDatabaseMigrator {
  /** @type {Record<string, Record<string, boolean>>} */
  migrationsVersions = {}

  /**
   * @param {object} args
   * @param {import("../configuration.js").default} args.configuration
   */
  constructor({configuration, ...restArgs}) {
    restArgsError(restArgs)

    if (!configuration) throw new Error("configuration argument is required")

    this.configuration = configuration
    this.logger = new Logger(this, {debug: false})
  }


  /** @returns {Promise<void>} */
  async prepare() {
    await this.createMigrationsTable()
    await this.loadMigrationsVersions()
  }

  /** @returns {Promise<void>} */
  async createMigrationsTable() {
    const dbs = await this.configuration.getCurrentConnections()

    for (const dbIdentifier in dbs) {
      const db = dbs[dbIdentifier]
      const databaseConfiguration = this.configuration.getDatabaseIdentifier(dbIdentifier)

      if (!databaseConfiguration.migrations) {
        this.logger.debug(`${dbIdentifier} isn't configured for migrations - skipping creating migrations table for it`)
        continue
      }

      const exists = await this.migrationsTableExist(db)

      if (exists) {
        this.logger.debug(`${dbIdentifier} migrations table already exists - skipping`)
      } else {
        this.logger.debug("New TableData for schema_migrations")
        const schemaMigrationsTable = new TableData("schema_migrations", {ifNotExists: true})

        schemaMigrationsTable.string("version", {null: false, primaryKey: true})

        const createSchemaMigrationsTableSqls = await db.createTableSql(schemaMigrationsTable)

        for (const createSchemaMigrationsTableSql of createSchemaMigrationsTableSqls) {
          this.logger.debug(`Creating migrations table with SQL`, createSchemaMigrationsTableSql)
          await db.query(createSchemaMigrationsTableSql)
        }
      }
    }
  }

  async dropDatabase() {
    throw new Error("Not implemented yet")
  }

  /**
   * @param {string} dbIdentifier
   * @param {number} version
   * @returns {boolean}
   */
  hasRunMigrationVersion(dbIdentifier, version) {
    if (!this.migrationsVersions) throw new Error("Migrations versions hasn't been loaded yet")
    if (!this.migrationsVersions[dbIdentifier]) throw new Error(`Migrations versions hasn't been loaded yet for db: ${dbIdentifier}`)

    if (version in this.migrationsVersions[dbIdentifier]) {
      return true
    }

    return false
  }

  /**
   * @param {import("./migrator/types.js").MigrationObjectType[]} files
   * @param {import("./migrator/types.js").ImportFullpathCallbackType} importCallback
   */
  async migrateFiles(files, importCallback) {
    await this.configuration.ensureConnections(async () => {
      for (const migration of files) {
        await this.runMigrationFile({
          migration,
          requireMigration: async () => {
            if (!migration.fullPath) throw new Error(`Migration didn't have a fullPath key: ${Object.keys(migration).join(", ")}`)

            const migrationImport = await importCallback(migration.fullPath)

            if (!migrationImport) {
              throw new Error(`Migration file must export migration class: ${migration.fullPath}`)
            }

            return migrationImport
          }
        })
      }
    })
  }

  /**
   * @param {import("./migrator/types.js").RequireMigrationContextType} requireContext
   * @returns {Promise<void>}
   */
  async migrateFilesFromRequireContext(requireContext) {
    /** @type {import("./migrator/types.js").MigrationObjectType[]} */
    let files = []

    for (const file of requireContext.keys()) {
      // "13,14" because somes "require-context"-npm-module deletes first character!?
      const match = file.match(/(\d{13,14})-(.+)\.js$/)

      if (!match) continue

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

      files.push({
        file: fileName,
        date,
        migrationClassName
      })
    }

    files = files.sort((migration1, migration2) => migration1.date - migration2.date)

    await this.configuration.ensureConnections(async () => {
      for (const migration of files) {
        await this.runMigrationFile({
          migration,
          requireMigration: async () => requireContext(migration.file).default
        })
      }
    })
  }

  /** @returns {Promise<void>} */
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

  /**
   * @param {import("./drivers/base.js").default} db
   * @returns {Promise<boolean>}
   */
  async migrationsTableExist(db) {
    const schemaTable = await db.getTableByName("schema_migrations", {throwError: false})

    if (!schemaTable) return false

    return true
  }

  /**
   * @param {import("./migrator/types.js").RequireMigrationContextType} requireContext
   * @returns {Promise<void>}
   */
  async executeRequireContext(requireContext) {
    const migrationFiles = requireContext.keys()

    /** @type {import("./migrator/types.js").MigrationObjectType[]} */
    let files = []

    for (const file of migrationFiles) {
      const match = file.match(/^(\d{14})-(.+)\.js$/)

      if (!match) continue

      const date = parseInt(match[1])
      const migrationName = match[2]
      const migrationClassName = inflection.camelize(migrationName)

      const migrationObject = /** @type {import("./migrator/types.js").MigrationObjectType} */ ({
        file,
        date,
        migrationClassName
      })

      files.push(migrationObject)
    }

    files = files.sort((migration1, migration2) => migration1.date - migration2.date)

    for (const migration of files) {
      await this.runMigrationFile({
        migration,
        requireMigration: async () => requireContext(migration.file).default
      })
    }
  }

  /**
   * @returns {Promise<void>}
   */
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
          } catch (error) { // eslint-disable-line no-unused-vars
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

  /**
   * @param {import("./migrator/types.js").MigrationObjectType[]} files
   * @param {import("./migrator/types.js").ImportFullpathCallbackType} importCallback Function to import a file
   * @returns {Promise<void>}
   */
  async rollback(files, importCallback) {
    const latestMigrationVersion = await this._latestMigrationVersion()

    if (!latestMigrationVersion) {
      throw new Error("No migrations have been run yet")
    }

    const latestMigrationVersionNumber = parseInt(latestMigrationVersion)
    const migration = files.find((file) => file.date == latestMigrationVersionNumber)

    if (!migration) {
      throw new Error(`Migration file for version ${latestMigrationVersionNumber} not found`)
    }

    await this.runMigrationFile({
      migration,
      requireMigration: async () => {
        if (!migration.fullPath) throw new Error(`Migration didn't have a fullPath key: ${Object.keys(migration).join(", ")}`)

        return await importCallback(migration.fullPath)
      },
      direction: "down"
    })
  }

  /**
   * @returns {Promise<string | undefined>} The latest migration version
   */
  async _latestMigrationVersion() {
    if (!this.migrationsVersions) await this.loadMigrationsVersions()

    /** @type {string | undefined} */
    let highestVersion

    for (const dbIdentifier in this.migrationsVersions) {
      for (const migrationVersion in this.migrationsVersions[dbIdentifier]) {
        if (!highestVersion || migrationVersion > highestVersion) {
          highestVersion = migrationVersion
        }
      }
    }

    return highestVersion
  }

  /**
   * @param {object} args
   * @param {import("./migrator/types.js").MigrationObjectType} args.migration
   * @param {import("./migrator/types.js").RequireMigrationType} args.requireMigration
   * @param {string} [args.direction]
   */
  async runMigrationFile({migration, requireMigration, direction = "up"}) {
    if (!this.configuration) throw new Error("No configuration set")
    if (!this.configuration.isDatabasePoolInitialized()) await this.configuration.initializeDatabasePool()
    if (!this.migrationsVersions) await this.loadMigrationsVersions()

    const dbs = await this.configuration.getCurrentConnections()
    const migrationClass = await requireMigration()

    if (!migrationClass || typeof migrationClass !== "function") {
      throw new Error(`Migration ${migration.file} must export a default migration class. Type: ${typeof migrationClass}`)
    }

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

      if (direction == "up") {
        if (this.hasRunMigrationVersion(dbIdentifier, migration.date)) {
          this.logger.debug(`${dbIdentifier} has already run migration ${migration.file}`)
          continue
        }
      } else if (direction == "down") {
        if (!this.hasRunMigrationVersion(dbIdentifier, migration.date)) {
          this.logger.debug(`${dbIdentifier} hasn't run migration ${migration.file}`)
          continue
        }
      } else {
        throw new Error(`Unknown direction: ${direction}`)
      }

      this.logger.debug(`Running migration on ${dbIdentifier}: ${migration.file}`, {migrationDatabaseIdentifiers})

      const db = dbs[dbIdentifier]
      const MigrationClass = migrationClass
      const migrationInstance = new MigrationClass({
        configuration: this.configuration,
        databaseIdentifier: dbIdentifier,
        db
      })
      const dateString = `${digg(migration, "date")}`

      if (direction == "up") {
        try {
          await migrationInstance.change()
        } catch (changeError) {
          if (changeError instanceof NotImplementedError) {
            try {
              await migrationInstance.up()
            } catch (upError) {
              if (upError instanceof NotImplementedError) {
                throw new Error(`'change' or 'up' didn't exist on migration: ${migration.file}`)
              } else {
                throw upError
              }
            }
          } else {
            throw changeError
          }
        }

        const existingSchemaMigrations = await db.newQuery()
          .from("schema_migrations")
          .where({version: dateString})
          .results()

        if (existingSchemaMigrations.length == 0) {
          await db.insert({tableName: "schema_migrations", data: {version: dateString}})
        }
      } else if (direction == "down") {
        try {
          await migrationInstance.down()
        } catch (downError) {
          if (downError instanceof NotImplementedError) {
            throw new Error(`'down' didn't exist on migration: ${migration.file} or migrating down with a change method isn't currently supported`)
          } else {
            throw downError
          }
        }

        await db.delete({tableName: "schema_migrations", conditions: {version: dateString}})
      } else {
        throw new Error(`Unknown direction: ${direction}`)
      }
    }
  }
}
