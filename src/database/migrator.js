// @ts-check

import {digg} from "diggerize"
import * as inflection from "inflection"
import Logger from "../logger.js"
import MigrationsLedger from "./migrations-ledger.js"
import {NotImplementedError} from "./migration/index.js"
import { migrationExecutionPhase, migrationRunsInExecutionPhase } from "./migration-execution-phase.js"
import restArgsError from "../utils/rest-args-error.js"

export default class VelociousDatabaseMigrator {
  /**
   * Migrations versions.
   * @type {Record<string, Record<string, boolean>>} */
  migrationsVersions = {}

  /**
   * Runs constructor.
   * @param {object} args - Options object.
   * @param {import("../configuration.js").default} args.configuration - Configuration instance.
   * @param {string[]} [args.databaseIdentifiers] - Optional database identifiers to migrate.
   * @param {import("./migration-execution-phase.js").MigrationExecutionPhase} [args.executionPhase] - Optional migration execution phase to select.
   */
  constructor({configuration, databaseIdentifiers, executionPhase, ...restArgs}) {
    restArgsError(restArgs)

    if (!configuration) throw new Error("configuration argument is required")

    this.configuration = configuration
    this.databaseIdentifiers = databaseIdentifiers
    this.executionPhase = executionPhase === undefined ? undefined : migrationExecutionPhase(executionPhase)
    this.logger = new Logger(this)
  }

  /**
   * Runs handles database identifier.
   * @param {string} dbIdentifier - Database identifier.
   * @returns {boolean} - Whether this migrator should touch the database identifier.
   */
  handlesDatabaseIdentifier(dbIdentifier) {
    if (!this.databaseIdentifiers) return true

    return this.databaseIdentifiers.includes(dbIdentifier)
  }


  /**
   * Runs prepare.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async prepare() {
    await this.createMigrationsTable()
    await this.loadMigrationsVersions()
  }

  /**
   * Runs create migrations table.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async createMigrationsTable() {
    const dbs = await this.configuration.getCurrentConnections()

    for (const dbIdentifier in dbs) {
      if (!this.handlesDatabaseIdentifier(dbIdentifier)) continue

      await this.createMigrationsTableForDatabase({dbIdentifier, db: dbs[dbIdentifier]})
    }
  }

  /**
   * Runs create migrations table for database.
   * @param {object} args - Options object.
   * @param {string} args.dbIdentifier - Database identifier.
   * @param {import("./drivers/base.js").default} args.db - Database connection.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async createMigrationsTableForDatabase({dbIdentifier, db}) {
    const databaseConfiguration = this.configuration.getDatabaseIdentifier(dbIdentifier)

    if (!databaseConfiguration.migrations) {
      this.logger.debug(`${dbIdentifier} isn't configured for migrations - skipping creating migrations table for it`)
      return
    }

    if (await this.migrationsTableExist(db)) {
      this.logger.debug(`${dbIdentifier} migrations table already exists - skipping`)
    } else {
      this.logger.debug("Creating schema_migrations table via MigrationsLedger")
      await MigrationsLedger.ensureTable(db)
    }
  }

  /**
   * Runs has run migration version.
   * @param {string} dbIdentifier - Db identifier.
   * @param {number} version - Version.
   * @returns {boolean} - Whether it has run migration version.
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
   * Runs migrate files.
   * @param {import("./migrator/types.js").MigrationObjectType[]} files - Files.
   * @param {import("./migrator/types.js").ImportFullpathCallbackType} importCallback - Import callback.
   * @returns {Promise<number>} - Number of migrations actually applied (not skipped as already-run).
   */
  async migrateFiles(files, importCallback) {
    let appliedCount = 0

    await this.configuration.ensureConnections({databaseIdentifiers: this.databaseIdentifiers, name: "Database migrator: migrate files"}, async () => {
      for (const migration of files) {
        const applied = await this.runMigrationFile({
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

        if (applied) appliedCount++
      }

      await this._afterMigrations()
    })

    return appliedCount
  }

  /**
   * Runs migrate files from require context.
   * @param {import("./migrator/types.js").RequireMigrationContextType} requireContext - Require context.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async migrateFilesFromRequireContext(requireContext) {
    const files = this.migrationsFromRequireContext(requireContext)

    await this.configuration.ensureConnections({databaseIdentifiers: this.databaseIdentifiers, name: "Database migrator: migrate require-context files"}, async () => {
      for (const migration of files) {
        await this.runMigrationFile({
          migration,
          requireMigration: async () => requireContext(migration.file).default
        })
      }

      await this._afterMigrations()
    })
  }

  /**
   * Migrates exactly one already-captured physical database. This is the
   * frontend/tenant counterpart to the ambient multi-database entrypoints:
   * callers own the captured connection and no configuration fallback is read.
   * @param {object} args - Captured migration arguments.
   * @param {import("../configuration-types.js").DatabaseConfigurationType} args.databaseConfiguration - Captured physical database configuration.
   * @param {string} args.databaseIdentifier - Logical database identifier.
   * @param {import("./drivers/base.js").default} args.db - Captured physical connection.
   * @param {import("./migrator/types.js").RequireMigrationContextType} args.requireContext - Frontend migration require context.
   * @returns {Promise<number>} - Number of newly applied migrations.
   */
  async migrateRequireContextForDatabase({databaseConfiguration, databaseIdentifier, db, requireContext}) {
    if (!databaseConfiguration.migrations) return 0

    await MigrationsLedger.ensureTable(db)
    const appliedVersions = new Set(await MigrationsLedger.appliedVersions(db))
    const migrations = this.migrationsFromRequireContext(requireContext)
    let appliedCount = 0

    for (const migration of migrations) {
      const version = `${migration.date}`

      if (appliedVersions.has(version)) continue

      const MigrationClass = requireContext(migration.file).default

      if (!MigrationClass || typeof MigrationClass !== "function") {
        throw new Error(`Migration ${migration.file} must export a default migration class. Type: ${typeof MigrationClass}`)
      }
      if (!migrationRunsInExecutionPhase(MigrationClass, this.executionPhase)) continue
      if (!(MigrationClass.getDatabaseIdentifiers() || ["default"]).includes(databaseIdentifier)) continue

      const migrationInstance = new MigrationClass({configuration: this.configuration, databaseIdentifier, db})

      await this.runMigrationUp({migration, migrationInstance})
      await MigrationsLedger.recordVersion(db, version)
      appliedVersions.add(version)
      appliedCount++
    }

    return appliedCount
  }

  /**
   * Parses and orders migrations from a browser/native require context.
   * @param {import("./migrator/types.js").RequireMigrationContextType} requireContext - Migration require context.
   * @returns {import("./migrator/types.js").MigrationObjectType[]} - Ordered migrations.
   */
  migrationsFromRequireContext(requireContext) {
    const migrations = []

    for (const file of requireContext.keys()) {
      const match = file.match(/(\d{13,14})-(.+)\.js$/)

      if (!match) continue

      let fileName = file
      let dateNumber = match[1]

      if (dateNumber.length == 13) {
        dateNumber = `2${dateNumber}`
        fileName = `2${fileName}`
      }

      migrations.push({
        date: parseInt(dateNumber),
        file: fileName,
        migrationClassName: inflection.camelize(match[2].replaceAll("-", "_"))
      })
    }

    return migrations.sort((migration1, migration2) => migration1.date - migration2.date)
  }

  /**
   * Runs one migration's upward implementation.
   * @param {object} args - Migration arguments.
   * @param {import("./migrator/types.js").MigrationObjectType} args.migration - Migration descriptor.
   * @param {import("./migration/index.js").default} args.migrationInstance - Migration instance.
   * @returns {Promise<void>} - Resolves after the migration succeeds.
   */
  async runMigrationUp({migration, migrationInstance}) {
    try {
      await migrationInstance.change()
    } catch (changeError) {
      if (!(changeError instanceof NotImplementedError)) throw changeError

      try {
        await migrationInstance.up()
      } catch (upError) {
        if (upError instanceof NotImplementedError) {
          throw new Error(`'change' or 'up' didn't exist on migration: ${migration.file}`, {cause: upError})
        }

        throw upError
      }
    }
  }

  /**
   * Runs after migrations.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _afterMigrations() {
    const environmentHandler = this.configuration.getEnvironmentHandler()
    const dbs = await this.configuration.getCurrentConnections()
    const filteredDbs = Object.fromEntries(
      Object.entries(dbs).filter(([dbIdentifier]) => {
        if (!this.handlesDatabaseIdentifier(dbIdentifier)) return false

        return Boolean(this.configuration.getDatabaseIdentifier(dbIdentifier).migrations)
      })
    )

    if (!environmentHandler || Object.keys(filteredDbs).length == 0) return

    // Ensure Velocious' own framework schema before the structure dump. The dump is
    // gated to enabled environments, but migration-enabled databases must include
    // framework tables so `db:migrate` and schema:load produce a complete database.
    await environmentHandler.ensureFrameworkSchema({dbs: filteredDbs})
    await environmentHandler.afterMigrations({dbs: filteredDbs})
  }

  /**
   * Runs load migrations versions.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async loadMigrationsVersions() {
    this.migrationsVersions = {}

    const dbs = await this.configuration.getCurrentConnections()

    for (const dbIdentifier in dbs) {
      if (!this.handlesDatabaseIdentifier(dbIdentifier)) continue

      await this.loadMigrationsVersionsForDatabase({dbIdentifier, db: dbs[dbIdentifier]})
    }
  }

  /**
   * Runs load migrations versions for database.
   * @param {object} args - Options object.
   * @param {string} args.dbIdentifier - Database identifier.
   * @param {import("./drivers/base.js").default} args.db - Database connection.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async loadMigrationsVersionsForDatabase({dbIdentifier, db}) {
    const databaseConfiguration = this.configuration.getDatabaseIdentifier(dbIdentifier)

    if (!databaseConfiguration.migrations) {
      this.logger.debug(`${dbIdentifier} isn't configured for migrations - skipping loading migrations versions for it`)
      return
    }

    if (!await this.migrationsTableExist(db)) {
      this.logger.info(`Migration table does not exist for ${dbIdentifier} - skipping loading migrations versions for it`)
      delete this.migrationsVersions[dbIdentifier]
      return
    }

    const versions = await MigrationsLedger.appliedVersions(db)

    this.migrationsVersions[dbIdentifier] = {}

    for (const version of versions) {
      this.migrationsVersions[dbIdentifier][version] = true
    }
  }

  /**
   * Runs migrations table exist.
   * @param {import("./drivers/base.js").default} db - Database connection.
   * @returns {Promise<boolean>} - Resolves with Whether migrations table exist.
   */
  async migrationsTableExist(db) {
    return await MigrationsLedger.tableExists(db)
  }

  /**
   * Runs execute require context.
   * @param {import("./migrator/types.js").RequireMigrationContextType} requireContext - Require context.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async executeRequireContext(requireContext) {
    const migrationFiles = requireContext.keys()

    /**
     * Files.
     * @type {import("./migrator/types.js").MigrationObjectType[]} */
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
   * Runs reset.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async reset() {
    const dbs = await this.configuration.getCurrentConnections()

    for (const dbIdentifier in dbs) {
      if (!this.handlesDatabaseIdentifier(dbIdentifier)) continue

      const db = dbs[dbIdentifier]

      await db.withDisabledForeignKeys(async () => {
        while (true) {
          const errors = []
          let anyTableDropped = false

          try {
            for (const table of await db.getTables()) {
              this.logger.info(`Dropping table ${table.getName()}`)

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
   * Runs rollback.
   * @param {import("./migrator/types.js").MigrationObjectType[]} files - Files.
   * @param {import("./migrator/types.js").ImportFullpathCallbackType} importCallback Function to import a file
   * @returns {Promise<void>} - Resolves when complete.
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
   * Runs latest migration version.
   * @returns {Promise<string | undefined>} The latest migration version
   */
  async _latestMigrationVersion() {
    if (!this.migrationsVersions) await this.loadMigrationsVersions()

    /**
     * Defines highestVersion.
     * @type {string | undefined} */
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
   * Runs run migration file.
   * @param {object} args - Options object.
   * @param {import("./migrator/types.js").MigrationObjectType} args.migration - Migration.
   * @param {import("./migrator/types.js").RequireMigrationType} args.requireMigration - Require migration.
   * @param {string} [args.direction] - Direction.
   * @returns {Promise<boolean>} - Whether the migration ran on at least one database (false if skipped as already-run everywhere).
   */
  async runMigrationFile({migration, requireMigration, direction = "up"}) {
    if (!this.configuration) throw new Error("No configuration set")
    if (!this.configuration.isDatabasePoolInitialized()) await this.configuration.initializeDatabasePool()
    if (!this.migrationsVersions) await this.loadMigrationsVersions()

    let applied = false
    const dbs = await this.configuration.getCurrentConnections()

    /**
     * Db identifiers needing migration versions.
     * @type {string[]} */
    const dbIdentifiersNeedingMigrationVersions = []

    // migrateFiles() wraps execution in ensureConnections(), so the current
    // async context can expose DB identifiers not loaded by prepare().
    for (const dbIdentifier in dbs) {
      if (!this.handlesDatabaseIdentifier(dbIdentifier)) continue

      const databaseConfiguration = this.configuration.getDatabaseIdentifier(dbIdentifier)

      if (!databaseConfiguration.migrations) continue
      if (this.migrationsVersions[dbIdentifier]) continue

      dbIdentifiersNeedingMigrationVersions.push(dbIdentifier)
    }

    for (const dbIdentifier of dbIdentifiersNeedingMigrationVersions) {
      const db = dbs[dbIdentifier]

      await this.createMigrationsTableForDatabase({dbIdentifier, db})
      await this.loadMigrationsVersionsForDatabase({dbIdentifier, db})
    }

    const migrationClass = await requireMigration()

    if (!migrationClass || typeof migrationClass !== "function") {
      throw new Error(`Migration ${migration.file} must export a default migration class. Type: ${typeof migrationClass}`)
    }
    if (!migrationRunsInExecutionPhase(migrationClass, this.executionPhase)) return false

    const migrationDatabaseIdentifiers = migrationClass.getDatabaseIdentifiers() || ["default"]

    for (const dbIdentifier in dbs) {
      if (!this.handlesDatabaseIdentifier(dbIdentifier)) continue

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

      applied = true
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
                throw new Error(`'change' or 'up' didn't exist on migration: ${migration.file}`, {cause: upError})
              } else {
                throw upError
              }
            }
          } else {
            throw changeError
          }
        }

        await MigrationsLedger.recordVersion(db, dateString)
      } else if (direction == "down") {
        try {
          await migrationInstance.down()
        } catch (downError) {
          if (downError instanceof NotImplementedError) {
            throw new Error(`'down' didn't exist on migration: ${migration.file} or migrating down with a change method isn't currently supported`, {cause: downError})
          } else {
            throw downError
          }
        }

        await MigrationsLedger.removeVersion(db, dateString)
      } else {
        throw new Error(`Unknown direction: ${direction}`)
      }
    }

    return applied
  }
}
