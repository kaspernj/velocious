// @ts-check
import { digg } from "diggerize";
import * as inflection from "inflection";
import Logger from "../logger.js";
import MigrationsLedger from "./migrations-ledger.js";
import { NotImplementedError } from "./migration/index.js";
import { migrationExecutionPhase, migrationRunsInExecutionPhase } from "./migration-execution-phase.js";
import restArgsError from "../utils/rest-args-error.js";
export default class VelociousDatabaseMigrator {
    /**
     * Migrations versions.
     * @type {Record<string, Record<string, boolean>>} */
    migrationsVersions = {};
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("../configuration.js").default} args.configuration - Configuration instance.
     * @param {string[]} [args.databaseIdentifiers] - Optional database identifiers to migrate.
     * @param {import("./migration-execution-phase.js").MigrationExecutionPhase} [args.executionPhase] - Optional migration execution phase to select.
     */
    constructor({ configuration, databaseIdentifiers, executionPhase, ...restArgs }) {
        restArgsError(restArgs);
        if (!configuration)
            throw new Error("configuration argument is required");
        this.configuration = configuration;
        this.databaseIdentifiers = databaseIdentifiers;
        this.executionPhase = executionPhase === undefined ? undefined : migrationExecutionPhase(executionPhase);
        this.logger = new Logger(this);
    }
    /**
     * Runs handles database identifier.
     * @param {string} dbIdentifier - Database identifier.
     * @returns {boolean} - Whether this migrator should touch the database identifier.
     */
    handlesDatabaseIdentifier(dbIdentifier) {
        if (!this.databaseIdentifiers)
            return true;
        return this.databaseIdentifiers.includes(dbIdentifier);
    }
    /**
     * Runs prepare.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async prepare() {
        await this.createMigrationsTable();
        await this.loadMigrationsVersions();
    }
    /**
     * Runs create migrations table.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async createMigrationsTable() {
        const dbs = await this.configuration.getCurrentConnections();
        for (const dbIdentifier in dbs) {
            if (!this.handlesDatabaseIdentifier(dbIdentifier))
                continue;
            await this.createMigrationsTableForDatabase({ dbIdentifier, db: dbs[dbIdentifier] });
        }
    }
    /**
     * Runs create migrations table for database.
     * @param {object} args - Options object.
     * @param {string} args.dbIdentifier - Database identifier.
     * @param {import("./drivers/base.js").default} args.db - Database connection.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async createMigrationsTableForDatabase({ dbIdentifier, db }) {
        const databaseConfiguration = this.configuration.getDatabaseIdentifier(dbIdentifier);
        if (!databaseConfiguration.migrations) {
            this.logger.debug(`${dbIdentifier} isn't configured for migrations - skipping creating migrations table for it`);
            return;
        }
        if (await this.migrationsTableExist(db)) {
            this.logger.debug(`${dbIdentifier} migrations table already exists - skipping`);
        }
        else {
            this.logger.debug("Creating schema_migrations table via MigrationsLedger");
            await MigrationsLedger.ensureTable(db);
        }
    }
    /**
     * Runs has run migration version.
     * @param {string} dbIdentifier - Db identifier.
     * @param {number} version - Version.
     * @returns {boolean} - Whether it has run migration version.
     */
    hasRunMigrationVersion(dbIdentifier, version) {
        if (!this.migrationsVersions)
            throw new Error("Migrations versions hasn't been loaded yet");
        if (!this.migrationsVersions[dbIdentifier])
            throw new Error(`Migrations versions hasn't been loaded yet for db: ${dbIdentifier}`);
        if (version in this.migrationsVersions[dbIdentifier]) {
            return true;
        }
        return false;
    }
    /**
     * Runs migrate files.
     * @param {import("./migrator/types.js").MigrationObjectType[]} files - Files.
     * @param {import("./migrator/types.js").ImportFullpathCallbackType} importCallback - Import callback.
     * @returns {Promise<number>} - Number of migrations actually applied (not skipped as already-run).
     */
    async migrateFiles(files, importCallback) {
        let appliedCount = 0;
        await this.configuration.ensureConnections({ databaseIdentifiers: this.databaseIdentifiers, name: "Database migrator: migrate files" }, async () => {
            for (const migration of files) {
                const applied = await this.runMigrationFile({
                    migration,
                    requireMigration: async () => {
                        if (!migration.fullPath)
                            throw new Error(`Migration didn't have a fullPath key: ${Object.keys(migration).join(", ")}`);
                        const migrationImport = await importCallback(migration.fullPath);
                        if (!migrationImport) {
                            throw new Error(`Migration file must export migration class: ${migration.fullPath}`);
                        }
                        return migrationImport;
                    }
                });
                if (applied)
                    appliedCount++;
            }
            await this._afterMigrations();
        });
        return appliedCount;
    }
    /**
     * Runs migrate files from require context.
     * @param {import("./migrator/types.js").RequireMigrationContextType} requireContext - Require context.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async migrateFilesFromRequireContext(requireContext) {
        const files = this.migrationsFromRequireContext(requireContext);
        await this.configuration.ensureConnections({ databaseIdentifiers: this.databaseIdentifiers, name: "Database migrator: migrate require-context files" }, async () => {
            for (const migration of files) {
                await this.runMigrationFile({
                    migration,
                    requireMigration: async () => requireContext(migration.file).default
                });
            }
            await this._afterMigrations();
        });
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
    async migrateRequireContextForDatabase({ databaseConfiguration, databaseIdentifier, db, requireContext }) {
        if (!databaseConfiguration.migrations)
            return 0;
        await MigrationsLedger.ensureTable(db);
        const appliedVersions = new Set(await MigrationsLedger.appliedVersions(db));
        const migrations = this.migrationsFromRequireContext(requireContext);
        let appliedCount = 0;
        for (const migration of migrations) {
            const version = `${migration.date}`;
            if (appliedVersions.has(version))
                continue;
            const MigrationClass = requireContext(migration.file).default;
            if (!MigrationClass || typeof MigrationClass !== "function") {
                throw new Error(`Migration ${migration.file} must export a default migration class. Type: ${typeof MigrationClass}`);
            }
            if (!migrationRunsInExecutionPhase(MigrationClass, this.executionPhase))
                continue;
            if (!(MigrationClass.getDatabaseIdentifiers() || ["default"]).includes(databaseIdentifier))
                continue;
            const migrationInstance = new MigrationClass({ configuration: this.configuration, databaseIdentifier, db });
            await this.runMigrationUp({ migration, migrationInstance });
            await MigrationsLedger.recordVersion(db, version);
            appliedVersions.add(version);
            appliedCount++;
        }
        return appliedCount;
    }
    /**
     * Parses and orders migrations from a browser/native require context.
     * @param {import("./migrator/types.js").RequireMigrationContextType} requireContext - Migration require context.
     * @returns {import("./migrator/types.js").MigrationObjectType[]} - Ordered migrations.
     */
    migrationsFromRequireContext(requireContext) {
        const migrations = [];
        for (const file of requireContext.keys()) {
            const match = file.match(/(\d{13,14})-(.+)\.js$/);
            if (!match)
                continue;
            let fileName = file;
            let dateNumber = match[1];
            if (dateNumber.length == 13) {
                dateNumber = `2${dateNumber}`;
                fileName = `2${fileName}`;
            }
            migrations.push({
                date: parseInt(dateNumber),
                file: fileName,
                migrationClassName: inflection.camelize(match[2].replaceAll("-", "_"))
            });
        }
        return migrations.sort((migration1, migration2) => migration1.date - migration2.date);
    }
    /**
     * Runs one migration's upward implementation.
     * @param {object} args - Migration arguments.
     * @param {import("./migrator/types.js").MigrationObjectType} args.migration - Migration descriptor.
     * @param {import("./migration/index.js").default} args.migrationInstance - Migration instance.
     * @returns {Promise<void>} - Resolves after the migration succeeds.
     */
    async runMigrationUp({ migration, migrationInstance }) {
        try {
            await migrationInstance.change();
        }
        catch (changeError) {
            if (!(changeError instanceof NotImplementedError))
                throw changeError;
            try {
                await migrationInstance.up();
            }
            catch (upError) {
                if (upError instanceof NotImplementedError) {
                    throw new Error(`'change' or 'up' didn't exist on migration: ${migration.file}`, { cause: upError });
                }
                throw upError;
            }
        }
    }
    /**
     * Runs after migrations.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async _afterMigrations() {
        const environmentHandler = this.configuration.getEnvironmentHandler();
        const dbs = await this.configuration.getCurrentConnections();
        const filteredDbs = Object.fromEntries(Object.entries(dbs).filter(([dbIdentifier]) => {
            if (!this.handlesDatabaseIdentifier(dbIdentifier))
                return false;
            return Boolean(this.configuration.getDatabaseIdentifier(dbIdentifier).migrations);
        }));
        if (!environmentHandler || Object.keys(filteredDbs).length == 0)
            return;
        // Ensure Velocious' own framework schema before the structure dump. The dump is
        // gated to enabled environments, but migration-enabled databases must include
        // framework tables so `db:migrate` and schema:load produce a complete database.
        await environmentHandler.ensureFrameworkSchema({ dbs: filteredDbs });
        await environmentHandler.afterMigrations({ dbs: filteredDbs });
    }
    /**
     * Runs load migrations versions.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async loadMigrationsVersions() {
        this.migrationsVersions = {};
        const dbs = await this.configuration.getCurrentConnections();
        for (const dbIdentifier in dbs) {
            if (!this.handlesDatabaseIdentifier(dbIdentifier))
                continue;
            await this.loadMigrationsVersionsForDatabase({ dbIdentifier, db: dbs[dbIdentifier] });
        }
    }
    /**
     * Runs load migrations versions for database.
     * @param {object} args - Options object.
     * @param {string} args.dbIdentifier - Database identifier.
     * @param {import("./drivers/base.js").default} args.db - Database connection.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async loadMigrationsVersionsForDatabase({ dbIdentifier, db }) {
        const databaseConfiguration = this.configuration.getDatabaseIdentifier(dbIdentifier);
        if (!databaseConfiguration.migrations) {
            this.logger.debug(`${dbIdentifier} isn't configured for migrations - skipping loading migrations versions for it`);
            return;
        }
        if (!await this.migrationsTableExist(db)) {
            this.logger.info(`Migration table does not exist for ${dbIdentifier} - skipping loading migrations versions for it`);
            delete this.migrationsVersions[dbIdentifier];
            return;
        }
        const versions = await MigrationsLedger.appliedVersions(db);
        this.migrationsVersions[dbIdentifier] = {};
        for (const version of versions) {
            this.migrationsVersions[dbIdentifier][version] = true;
        }
    }
    /**
     * Runs migrations table exist.
     * @param {import("./drivers/base.js").default} db - Database connection.
     * @returns {Promise<boolean>} - Resolves with Whether migrations table exist.
     */
    async migrationsTableExist(db) {
        return await MigrationsLedger.tableExists(db);
    }
    /**
     * Runs execute require context.
     * @param {import("./migrator/types.js").RequireMigrationContextType} requireContext - Require context.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async executeRequireContext(requireContext) {
        const migrationFiles = requireContext.keys();
        /**
         * Files.
         * @type {import("./migrator/types.js").MigrationObjectType[]} */
        let files = [];
        for (const file of migrationFiles) {
            const match = file.match(/^(\d{14})-(.+)\.js$/);
            if (!match)
                continue;
            const date = parseInt(match[1]);
            const migrationName = match[2];
            const migrationClassName = inflection.camelize(migrationName);
            const migrationObject = /** @type {import("./migrator/types.js").MigrationObjectType} */ ({
                file,
                date,
                migrationClassName
            });
            files.push(migrationObject);
        }
        files = files.sort((migration1, migration2) => migration1.date - migration2.date);
        for (const migration of files) {
            await this.runMigrationFile({
                migration,
                requireMigration: async () => requireContext(migration.file).default
            });
        }
    }
    /**
     * Runs reset.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async reset() {
        const dbs = await this.configuration.getCurrentConnections();
        for (const dbIdentifier in dbs) {
            if (!this.handlesDatabaseIdentifier(dbIdentifier))
                continue;
            const db = dbs[dbIdentifier];
            await db.withDisabledForeignKeys(async () => {
                while (true) {
                    const errors = [];
                    let anyTableDropped = false;
                    try {
                        for (const table of await db.getTables()) {
                            this.logger.info(`Dropping table ${table.getName()}`);
                            try {
                                await db.dropTable(table.getName(), { cascade: true });
                                anyTableDropped = true;
                            }
                            catch (error) {
                                errors.push(error);
                            }
                        }
                        break;
                    }
                    catch (error) { // eslint-disable-line no-unused-vars
                        if (errors.length > 0 && anyTableDropped) {
                            // Retry
                        }
                        else {
                            throw errors[0];
                        }
                    }
                }
            });
        }
    }
    /**
     * Runs rollback.
     * @param {import("./migrator/types.js").MigrationObjectType[]} files - Files.
     * @param {import("./migrator/types.js").ImportFullpathCallbackType} importCallback Function to import a file
     * @returns {Promise<void>} - Resolves when complete.
     */
    async rollback(files, importCallback) {
        const latestMigrationVersion = await this._latestMigrationVersion();
        if (!latestMigrationVersion) {
            throw new Error("No migrations have been run yet");
        }
        const latestMigrationVersionNumber = parseInt(latestMigrationVersion);
        const migration = files.find((file) => file.date == latestMigrationVersionNumber);
        if (!migration) {
            throw new Error(`Migration file for version ${latestMigrationVersionNumber} not found`);
        }
        await this.runMigrationFile({
            migration,
            requireMigration: async () => {
                if (!migration.fullPath)
                    throw new Error(`Migration didn't have a fullPath key: ${Object.keys(migration).join(", ")}`);
                return await importCallback(migration.fullPath);
            },
            direction: "down"
        });
    }
    /**
     * Runs latest migration version.
     * @returns {Promise<string | undefined>} The latest migration version
     */
    async _latestMigrationVersion() {
        if (!this.migrationsVersions)
            await this.loadMigrationsVersions();
        /**
         * Defines highestVersion.
         * @type {string | undefined} */
        let highestVersion;
        for (const dbIdentifier in this.migrationsVersions) {
            for (const migrationVersion in this.migrationsVersions[dbIdentifier]) {
                if (!highestVersion || migrationVersion > highestVersion) {
                    highestVersion = migrationVersion;
                }
            }
        }
        return highestVersion;
    }
    /**
     * Runs run migration file.
     * @param {object} args - Options object.
     * @param {import("./migrator/types.js").MigrationObjectType} args.migration - Migration.
     * @param {import("./migrator/types.js").RequireMigrationType} args.requireMigration - Require migration.
     * @param {string} [args.direction] - Direction.
     * @returns {Promise<boolean>} - Whether the migration ran on at least one database (false if skipped as already-run everywhere).
     */
    async runMigrationFile({ migration, requireMigration, direction = "up" }) {
        if (!this.configuration)
            throw new Error("No configuration set");
        if (!this.configuration.isDatabasePoolInitialized())
            await this.configuration.initializeDatabasePool();
        if (!this.migrationsVersions)
            await this.loadMigrationsVersions();
        let applied = false;
        const dbs = await this.configuration.getCurrentConnections();
        /**
         * Db identifiers needing migration versions.
         * @type {string[]} */
        const dbIdentifiersNeedingMigrationVersions = [];
        // migrateFiles() wraps execution in ensureConnections(), so the current
        // async context can expose DB identifiers not loaded by prepare().
        for (const dbIdentifier in dbs) {
            if (!this.handlesDatabaseIdentifier(dbIdentifier))
                continue;
            const databaseConfiguration = this.configuration.getDatabaseIdentifier(dbIdentifier);
            if (!databaseConfiguration.migrations)
                continue;
            if (this.migrationsVersions[dbIdentifier])
                continue;
            dbIdentifiersNeedingMigrationVersions.push(dbIdentifier);
        }
        for (const dbIdentifier of dbIdentifiersNeedingMigrationVersions) {
            const db = dbs[dbIdentifier];
            await this.createMigrationsTableForDatabase({ dbIdentifier, db });
            await this.loadMigrationsVersionsForDatabase({ dbIdentifier, db });
        }
        const migrationClass = await requireMigration();
        if (!migrationClass || typeof migrationClass !== "function") {
            throw new Error(`Migration ${migration.file} must export a default migration class. Type: ${typeof migrationClass}`);
        }
        if (direction == "up" && !migrationRunsInExecutionPhase(migrationClass, this.executionPhase))
            return false;
        const migrationDatabaseIdentifiers = migrationClass.getDatabaseIdentifiers() || ["default"];
        for (const dbIdentifier in dbs) {
            if (!this.handlesDatabaseIdentifier(dbIdentifier))
                continue;
            const databaseConfiguration = this.configuration.getDatabaseIdentifier(dbIdentifier);
            if (!databaseConfiguration.migrations) {
                this.logger.debug(`${dbIdentifier} isn't configured for migrations - skipping migration ${digg(migration, "date")}`);
                continue;
            }
            if (!migrationDatabaseIdentifiers.includes(dbIdentifier)) {
                this.logger.debug(`${dbIdentifier} shouldn't run migration ${migration.file}`, { migrationDatabaseIdentifiers });
                continue;
            }
            if (direction == "up") {
                if (this.hasRunMigrationVersion(dbIdentifier, migration.date)) {
                    this.logger.debug(`${dbIdentifier} has already run migration ${migration.file}`);
                    continue;
                }
            }
            else if (direction == "down") {
                if (!this.hasRunMigrationVersion(dbIdentifier, migration.date)) {
                    this.logger.debug(`${dbIdentifier} hasn't run migration ${migration.file}`);
                    continue;
                }
            }
            else {
                throw new Error(`Unknown direction: ${direction}`);
            }
            this.logger.debug(`Running migration on ${dbIdentifier}: ${migration.file}`, { migrationDatabaseIdentifiers });
            applied = true;
            const db = dbs[dbIdentifier];
            const MigrationClass = migrationClass;
            const migrationInstance = new MigrationClass({
                configuration: this.configuration,
                databaseIdentifier: dbIdentifier,
                db
            });
            const dateString = `${digg(migration, "date")}`;
            if (direction == "up") {
                try {
                    await migrationInstance.change();
                }
                catch (changeError) {
                    if (changeError instanceof NotImplementedError) {
                        try {
                            await migrationInstance.up();
                        }
                        catch (upError) {
                            if (upError instanceof NotImplementedError) {
                                throw new Error(`'change' or 'up' didn't exist on migration: ${migration.file}`, { cause: upError });
                            }
                            else {
                                throw upError;
                            }
                        }
                    }
                    else {
                        throw changeError;
                    }
                }
                await MigrationsLedger.recordVersion(db, dateString);
            }
            else if (direction == "down") {
                try {
                    await migrationInstance.down();
                }
                catch (downError) {
                    if (downError instanceof NotImplementedError) {
                        throw new Error(`'down' didn't exist on migration: ${migration.file} or migrating down with a change method isn't currently supported`, { cause: downError });
                    }
                    else {
                        throw downError;
                    }
                }
                await MigrationsLedger.removeVersion(db, dateString);
            }
            else {
                throw new Error(`Unknown direction: ${direction}`);
            }
        }
        return applied;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWlncmF0b3IuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZGF0YWJhc2UvbWlncmF0b3IuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sRUFBQyxJQUFJLEVBQUMsTUFBTSxXQUFXLENBQUE7QUFDOUIsT0FBTyxLQUFLLFVBQVUsTUFBTSxZQUFZLENBQUE7QUFDeEMsT0FBTyxNQUFNLE1BQU0sY0FBYyxDQUFBO0FBQ2pDLE9BQU8sZ0JBQWdCLE1BQU0sd0JBQXdCLENBQUE7QUFDckQsT0FBTyxFQUFDLG1CQUFtQixFQUFDLE1BQU0sc0JBQXNCLENBQUE7QUFDeEQsT0FBTyxFQUFFLHVCQUF1QixFQUFFLDZCQUE2QixFQUFFLE1BQU0sZ0NBQWdDLENBQUE7QUFDdkcsT0FBTyxhQUFhLE1BQU0sNkJBQTZCLENBQUE7QUFFdkQsTUFBTSxDQUFDLE9BQU8sT0FBTyx5QkFBeUI7SUFDNUM7O3lEQUVxRDtJQUNyRCxrQkFBa0IsR0FBRyxFQUFFLENBQUE7SUFFdkI7Ozs7OztPQU1HO0lBQ0gsWUFBWSxFQUFDLGFBQWEsRUFBRSxtQkFBbUIsRUFBRSxjQUFjLEVBQUUsR0FBRyxRQUFRLEVBQUM7UUFDM0UsYUFBYSxDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBRXZCLElBQUksQ0FBQyxhQUFhO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxvQ0FBb0MsQ0FBQyxDQUFBO1FBRXpFLElBQUksQ0FBQyxhQUFhLEdBQUcsYUFBYSxDQUFBO1FBQ2xDLElBQUksQ0FBQyxtQkFBbUIsR0FBRyxtQkFBbUIsQ0FBQTtRQUM5QyxJQUFJLENBQUMsY0FBYyxHQUFHLGNBQWMsS0FBSyxTQUFTLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsdUJBQXVCLENBQUMsY0FBYyxDQUFDLENBQUE7UUFDeEcsSUFBSSxDQUFDLE1BQU0sR0FBRyxJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQTtJQUNoQyxDQUFD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QUFDO2lDQUFNLENBQUM7Z0NBQ04sTUFBTSxPQUFPLENBQUE7NEJBQ2YsQ0FBQzt3QkFDSCxDQUFDO29CQUNILENBQUM7eUJBQU0sQ0FBQzt3QkFDTixNQUFNLFdBQVcsQ0FBQTtvQkFDbkIsQ0FBQztnQkFDSCxDQUFDO2dCQUVELE1BQU0sZ0JBQWdCLENBQUMsYUFBYSxDQUFDLEVBQUUsRUFBRSxVQUFVLENBQUMsQ0FBQTtZQUN0RCxDQUFDO2lCQUFNLElBQUksU0FBUyxJQUFJLE1BQU0sRUFBRSxDQUFDO2dCQUMvQixJQUFJLENBQUM7b0JBQ0gsTUFBTSxpQkFBaUIsQ0FBQyxJQUFJLEVBQUUsQ0FBQTtnQkFDaEMsQ0FBQztnQkFBQyxPQUFPLFNBQVMsRUFBRSxDQUFDO29CQUNuQixJQUFJLFNBQVMsWUFBWSxtQkFBbUIsRUFBRSxDQUFDO3dCQUM3QyxNQUFNLElBQUksS0FBSyxDQUFDLHFDQUFxQyxTQUFTLENBQUMsSUFBSSxtRUFBbUUsRUFBRSxFQUFDLEtBQUssRUFBRSxTQUFTLEVBQUMsQ0FBQyxDQUFBO29CQUM3SixDQUFDO3lCQUFNLENBQUM7d0JBQ04sTUFBTSxTQUFTLENBQUE7b0JBQ2pCLENBQUM7Z0JBQ0gsQ0FBQztnQkFFRCxNQUFNLGdCQUFnQixDQUFDLGFBQWEsQ0FBQyxFQUFFLEVBQUUsVUFBVSxDQUFDLENBQUE7WUFDdEQsQ0FBQztpQkFBTSxDQUFDO2dCQUNOLE1BQU0sSUFBSSxLQUFLLENBQUMsc0JBQXNCLFNBQVMsRUFBRSxDQUFDLENBQUE7WUFDcEQsQ0FBQztRQUNILENBQUM7UUFFRCxPQUFPLE9BQU8sQ0FBQTtJQUNoQixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHtkaWdnfSBmcm9tIFwiZGlnZ2VyaXplXCJcbmltcG9ydCAqIGFzIGluZmxlY3Rpb24gZnJvbSBcImluZmxlY3Rpb25cIlxuaW1wb3J0IExvZ2dlciBmcm9tIFwiLi4vbG9nZ2VyLmpzXCJcbmltcG9ydCBNaWdyYXRpb25zTGVkZ2VyIGZyb20gXCIuL21pZ3JhdGlvbnMtbGVkZ2VyLmpzXCJcbmltcG9ydCB7Tm90SW1wbGVtZW50ZWRFcnJvcn0gZnJvbSBcIi4vbWlncmF0aW9uL2luZGV4LmpzXCJcbmltcG9ydCB7IG1pZ3JhdGlvbkV4ZWN1dGlvblBoYXNlLCBtaWdyYXRpb25SdW5zSW5FeGVjdXRpb25QaGFzZSB9IGZyb20gXCIuL21pZ3JhdGlvbi1leGVjdXRpb24tcGhhc2UuanNcIlxuaW1wb3J0IHJlc3RBcmdzRXJyb3IgZnJvbSBcIi4uL3V0aWxzL3Jlc3QtYXJncy1lcnJvci5qc1wiXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0RhdGFiYXNlTWlncmF0b3Ige1xuICAvKipcbiAgICogTWlncmF0aW9ucyB2ZXJzaW9ucy5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJlY29yZDxzdHJpbmcsIGJvb2xlYW4+Pn0gKi9cbiAgbWlncmF0aW9uc1ZlcnNpb25zID0ge31cblxuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGFyZ3MuY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IFthcmdzLmRhdGFiYXNlSWRlbnRpZmllcnNdIC0gT3B0aW9uYWwgZGF0YWJhc2UgaWRlbnRpZmllcnMgdG8gbWlncmF0ZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL21pZ3JhdGlvbi1leGVjdXRpb24tcGhhc2UuanNcIikuTWlncmF0aW9uRXhlY3V0aW9uUGhhc2V9IFthcmdzLmV4ZWN1dGlvblBoYXNlXSAtIE9wdGlvbmFsIG1pZ3JhdGlvbiBleGVjdXRpb24gcGhhc2UgdG8gc2VsZWN0LlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2NvbmZpZ3VyYXRpb24sIGRhdGFiYXNlSWRlbnRpZmllcnMsIGV4ZWN1dGlvblBoYXNlLCAuLi5yZXN0QXJnc30pIHtcbiAgICByZXN0QXJnc0Vycm9yKHJlc3RBcmdzKVxuXG4gICAgaWYgKCFjb25maWd1cmF0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJjb25maWd1cmF0aW9uIGFyZ3VtZW50IGlzIHJlcXVpcmVkXCIpXG5cbiAgICB0aGlzLmNvbmZpZ3VyYXRpb24gPSBjb25maWd1cmF0aW9uXG4gICAgdGhpcy5kYXRhYmFzZUlkZW50aWZpZXJzID0gZGF0YWJhc2VJZGVudGlmaWVyc1xuICAgIHRoaXMuZXhlY3V0aW9uUGhhc2UgPSBleGVjdXRpb25QaGFzZSA9PT0gdW5kZWZpbmVkID8gdW5kZWZpbmVkIDogbWlncmF0aW9uRXhlY3V0aW9uUGhhc2UoZXhlY3V0aW9uUGhhc2UpXG4gICAgdGhpcy5sb2dnZXIgPSBuZXcgTG9nZ2VyKHRoaXMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYW5kbGVzIGRhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBkYklkZW50aWZpZXIgLSBEYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoaXMgbWlncmF0b3Igc2hvdWxkIHRvdWNoIHRoZSBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKi9cbiAgaGFuZGxlc0RhdGFiYXNlSWRlbnRpZmllcihkYklkZW50aWZpZXIpIHtcbiAgICBpZiAoIXRoaXMuZGF0YWJhc2VJZGVudGlmaWVycykgcmV0dXJuIHRydWVcblxuICAgIHJldHVybiB0aGlzLmRhdGFiYXNlSWRlbnRpZmllcnMuaW5jbHVkZXMoZGJJZGVudGlmaWVyKVxuICB9XG5cblxuICAvKipcbiAgICogUnVucyBwcmVwYXJlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgcHJlcGFyZSgpIHtcbiAgICBhd2FpdCB0aGlzLmNyZWF0ZU1pZ3JhdGlvbnNUYWJsZSgpXG4gICAgYXdhaXQgdGhpcy5sb2FkTWlncmF0aW9uc1ZlcnNpb25zKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNyZWF0ZSBtaWdyYXRpb25zIHRhYmxlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgY3JlYXRlTWlncmF0aW9uc1RhYmxlKCkge1xuICAgIGNvbnN0IGRicyA9IGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5nZXRDdXJyZW50Q29ubmVjdGlvbnMoKVxuXG4gICAgZm9yIChjb25zdCBkYklkZW50aWZpZXIgaW4gZGJzKSB7XG4gICAgICBpZiAoIXRoaXMuaGFuZGxlc0RhdGFiYXNlSWRlbnRpZmllcihkYklkZW50aWZpZXIpKSBjb250aW51ZVxuXG4gICAgICBhd2FpdCB0aGlzLmNyZWF0ZU1pZ3JhdGlvbnNUYWJsZUZvckRhdGFiYXNlKHtkYklkZW50aWZpZXIsIGRiOiBkYnNbZGJJZGVudGlmaWVyXX0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY3JlYXRlIG1pZ3JhdGlvbnMgdGFibGUgZm9yIGRhdGFiYXNlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5kYklkZW50aWZpZXIgLSBEYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGFyZ3MuZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgY3JlYXRlTWlncmF0aW9uc1RhYmxlRm9yRGF0YWJhc2Uoe2RiSWRlbnRpZmllciwgZGJ9KSB7XG4gICAgY29uc3QgZGF0YWJhc2VDb25maWd1cmF0aW9uID0gdGhpcy5jb25maWd1cmF0aW9uLmdldERhdGFiYXNlSWRlbnRpZmllcihkYklkZW50aWZpZXIpXG5cbiAgICBpZiAoIWRhdGFiYXNlQ29uZmlndXJhdGlvbi5taWdyYXRpb25zKSB7XG4gICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgJHtkYklkZW50aWZpZXJ9IGlzbid0IGNvbmZpZ3VyZWQgZm9yIG1pZ3JhdGlvbnMgLSBza2lwcGluZyBjcmVhdGluZyBtaWdyYXRpb25zIHRhYmxlIGZvciBpdGApXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAoYXdhaXQgdGhpcy5taWdyYXRpb25zVGFibGVFeGlzdChkYikpIHtcbiAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGAke2RiSWRlbnRpZmllcn0gbWlncmF0aW9ucyB0YWJsZSBhbHJlYWR5IGV4aXN0cyAtIHNraXBwaW5nYClcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJDcmVhdGluZyBzY2hlbWFfbWlncmF0aW9ucyB0YWJsZSB2aWEgTWlncmF0aW9uc0xlZGdlclwiKVxuICAgICAgYXdhaXQgTWlncmF0aW9uc0xlZGdlci5lbnN1cmVUYWJsZShkYilcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYXMgcnVuIG1pZ3JhdGlvbiB2ZXJzaW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZGJJZGVudGlmaWVyIC0gRGIgaWRlbnRpZmllci5cbiAgICogQHBhcmFtIHtudW1iZXJ9IHZlcnNpb24gLSBWZXJzaW9uLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGl0IGhhcyBydW4gbWlncmF0aW9uIHZlcnNpb24uXG4gICAqL1xuICBoYXNSdW5NaWdyYXRpb25WZXJzaW9uKGRiSWRlbnRpZmllciwgdmVyc2lvbikge1xuICAgIGlmICghdGhpcy5taWdyYXRpb25zVmVyc2lvbnMpIHRocm93IG5ldyBFcnJvcihcIk1pZ3JhdGlvbnMgdmVyc2lvbnMgaGFzbid0IGJlZW4gbG9hZGVkIHlldFwiKVxuICAgIGlmICghdGhpcy5taWdyYXRpb25zVmVyc2lvbnNbZGJJZGVudGlmaWVyXSkgdGhyb3cgbmV3IEVycm9yKGBNaWdyYXRpb25zIHZlcnNpb25zIGhhc24ndCBiZWVuIGxvYWRlZCB5ZXQgZm9yIGRiOiAke2RiSWRlbnRpZmllcn1gKVxuXG4gICAgaWYgKHZlcnNpb24gaW4gdGhpcy5taWdyYXRpb25zVmVyc2lvbnNbZGJJZGVudGlmaWVyXSkge1xuICAgICAgcmV0dXJuIHRydWVcbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1pZ3JhdGUgZmlsZXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9taWdyYXRvci90eXBlcy5qc1wiKS5NaWdyYXRpb25PYmplY3RUeXBlW119IGZpbGVzIC0gRmlsZXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9taWdyYXRvci90eXBlcy5qc1wiKS5JbXBvcnRGdWxscGF0aENhbGxiYWNrVHlwZX0gaW1wb3J0Q2FsbGJhY2sgLSBJbXBvcnQgY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IC0gTnVtYmVyIG9mIG1pZ3JhdGlvbnMgYWN0dWFsbHkgYXBwbGllZCAobm90IHNraXBwZWQgYXMgYWxyZWFkeS1ydW4pLlxuICAgKi9cbiAgYXN5bmMgbWlncmF0ZUZpbGVzKGZpbGVzLCBpbXBvcnRDYWxsYmFjaykge1xuICAgIGxldCBhcHBsaWVkQ291bnQgPSAwXG5cbiAgICBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24uZW5zdXJlQ29ubmVjdGlvbnMoe2RhdGFiYXNlSWRlbnRpZmllcnM6IHRoaXMuZGF0YWJhc2VJZGVudGlmaWVycywgbmFtZTogXCJEYXRhYmFzZSBtaWdyYXRvcjogbWlncmF0ZSBmaWxlc1wifSwgYXN5bmMgKCkgPT4ge1xuICAgICAgZm9yIChjb25zdCBtaWdyYXRpb24gb2YgZmlsZXMpIHtcbiAgICAgICAgY29uc3QgYXBwbGllZCA9IGF3YWl0IHRoaXMucnVuTWlncmF0aW9uRmlsZSh7XG4gICAgICAgICAgbWlncmF0aW9uLFxuICAgICAgICAgIHJlcXVpcmVNaWdyYXRpb246IGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIGlmICghbWlncmF0aW9uLmZ1bGxQYXRoKSB0aHJvdyBuZXcgRXJyb3IoYE1pZ3JhdGlvbiBkaWRuJ3QgaGF2ZSBhIGZ1bGxQYXRoIGtleTogJHtPYmplY3Qua2V5cyhtaWdyYXRpb24pLmpvaW4oXCIsIFwiKX1gKVxuXG4gICAgICAgICAgICBjb25zdCBtaWdyYXRpb25JbXBvcnQgPSBhd2FpdCBpbXBvcnRDYWxsYmFjayhtaWdyYXRpb24uZnVsbFBhdGgpXG5cbiAgICAgICAgICAgIGlmICghbWlncmF0aW9uSW1wb3J0KSB7XG4gICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgTWlncmF0aW9uIGZpbGUgbXVzdCBleHBvcnQgbWlncmF0aW9uIGNsYXNzOiAke21pZ3JhdGlvbi5mdWxsUGF0aH1gKVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZXR1cm4gbWlncmF0aW9uSW1wb3J0XG4gICAgICAgICAgfVxuICAgICAgICB9KVxuXG4gICAgICAgIGlmIChhcHBsaWVkKSBhcHBsaWVkQ291bnQrK1xuICAgICAgfVxuXG4gICAgICBhd2FpdCB0aGlzLl9hZnRlck1pZ3JhdGlvbnMoKVxuICAgIH0pXG5cbiAgICByZXR1cm4gYXBwbGllZENvdW50XG4gIH1cblxuICAvKipcbiAgICogUnVucyBtaWdyYXRlIGZpbGVzIGZyb20gcmVxdWlyZSBjb250ZXh0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vbWlncmF0b3IvdHlwZXMuanNcIikuUmVxdWlyZU1pZ3JhdGlvbkNvbnRleHRUeXBlfSByZXF1aXJlQ29udGV4dCAtIFJlcXVpcmUgY29udGV4dC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIG1pZ3JhdGVGaWxlc0Zyb21SZXF1aXJlQ29udGV4dChyZXF1aXJlQ29udGV4dCkge1xuICAgIGNvbnN0IGZpbGVzID0gdGhpcy5taWdyYXRpb25zRnJvbVJlcXVpcmVDb250ZXh0KHJlcXVpcmVDb250ZXh0KVxuXG4gICAgYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLmVuc3VyZUNvbm5lY3Rpb25zKHtkYXRhYmFzZUlkZW50aWZpZXJzOiB0aGlzLmRhdGFiYXNlSWRlbnRpZmllcnMsIG5hbWU6IFwiRGF0YWJhc2UgbWlncmF0b3I6IG1pZ3JhdGUgcmVxdWlyZS1jb250ZXh0IGZpbGVzXCJ9LCBhc3luYyAoKSA9PiB7XG4gICAgICBmb3IgKGNvbnN0IG1pZ3JhdGlvbiBvZiBmaWxlcykge1xuICAgICAgICBhd2FpdCB0aGlzLnJ1bk1pZ3JhdGlvbkZpbGUoe1xuICAgICAgICAgIG1pZ3JhdGlvbixcbiAgICAgICAgICByZXF1aXJlTWlncmF0aW9uOiBhc3luYyAoKSA9PiByZXF1aXJlQ29udGV4dChtaWdyYXRpb24uZmlsZSkuZGVmYXVsdFxuICAgICAgICB9KVxuICAgICAgfVxuXG4gICAgICBhd2FpdCB0aGlzLl9hZnRlck1pZ3JhdGlvbnMoKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogTWlncmF0ZXMgZXhhY3RseSBvbmUgYWxyZWFkeS1jYXB0dXJlZCBwaHlzaWNhbCBkYXRhYmFzZS4gVGhpcyBpcyB0aGVcbiAgICogZnJvbnRlbmQvdGVuYW50IGNvdW50ZXJwYXJ0IHRvIHRoZSBhbWJpZW50IG11bHRpLWRhdGFiYXNlIGVudHJ5cG9pbnRzOlxuICAgKiBjYWxsZXJzIG93biB0aGUgY2FwdHVyZWQgY29ubmVjdGlvbiBhbmQgbm8gY29uZmlndXJhdGlvbiBmYWxsYmFjayBpcyByZWFkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIENhcHR1cmVkIG1pZ3JhdGlvbiBhcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlfSBhcmdzLmRhdGFiYXNlQ29uZmlndXJhdGlvbiAtIENhcHR1cmVkIHBoeXNpY2FsIGRhdGFiYXNlIGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmRhdGFiYXNlSWRlbnRpZmllciAtIExvZ2ljYWwgZGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBhcmdzLmRiIC0gQ2FwdHVyZWQgcGh5c2ljYWwgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL21pZ3JhdG9yL3R5cGVzLmpzXCIpLlJlcXVpcmVNaWdyYXRpb25Db250ZXh0VHlwZX0gYXJncy5yZXF1aXJlQ29udGV4dCAtIEZyb250ZW5kIG1pZ3JhdGlvbiByZXF1aXJlIGNvbnRleHQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IC0gTnVtYmVyIG9mIG5ld2x5IGFwcGxpZWQgbWlncmF0aW9ucy5cbiAgICovXG4gIGFzeW5jIG1pZ3JhdGVSZXF1aXJlQ29udGV4dEZvckRhdGFiYXNlKHtkYXRhYmFzZUNvbmZpZ3VyYXRpb24sIGRhdGFiYXNlSWRlbnRpZmllciwgZGIsIHJlcXVpcmVDb250ZXh0fSkge1xuICAgIGlmICghZGF0YWJhc2VDb25maWd1cmF0aW9uLm1pZ3JhdGlvbnMpIHJldHVybiAwXG5cbiAgICBhd2FpdCBNaWdyYXRpb25zTGVkZ2VyLmVuc3VyZVRhYmxlKGRiKVxuICAgIGNvbnN0IGFwcGxpZWRWZXJzaW9ucyA9IG5ldyBTZXQoYXdhaXQgTWlncmF0aW9uc0xlZGdlci5hcHBsaWVkVmVyc2lvbnMoZGIpKVxuICAgIGNvbnN0IG1pZ3JhdGlvbnMgPSB0aGlzLm1pZ3JhdGlvbnNGcm9tUmVxdWlyZUNvbnRleHQocmVxdWlyZUNvbnRleHQpXG4gICAgbGV0IGFwcGxpZWRDb3VudCA9IDBcblxuICAgIGZvciAoY29uc3QgbWlncmF0aW9uIG9mIG1pZ3JhdGlvbnMpIHtcbiAgICAgIGNvbnN0IHZlcnNpb24gPSBgJHttaWdyYXRpb24uZGF0ZX1gXG5cbiAgICAgIGlmIChhcHBsaWVkVmVyc2lvbnMuaGFzKHZlcnNpb24pKSBjb250aW51ZVxuXG4gICAgICBjb25zdCBNaWdyYXRpb25DbGFzcyA9IHJlcXVpcmVDb250ZXh0KG1pZ3JhdGlvbi5maWxlKS5kZWZhdWx0XG5cbiAgICAgIGlmICghTWlncmF0aW9uQ2xhc3MgfHwgdHlwZW9mIE1pZ3JhdGlvbkNsYXNzICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBNaWdyYXRpb24gJHttaWdyYXRpb24uZmlsZX0gbXVzdCBleHBvcnQgYSBkZWZhdWx0IG1pZ3JhdGlvbiBjbGFzcy4gVHlwZTogJHt0eXBlb2YgTWlncmF0aW9uQ2xhc3N9YClcbiAgICAgIH1cbiAgICAgIGlmICghbWlncmF0aW9uUnVuc0luRXhlY3V0aW9uUGhhc2UoTWlncmF0aW9uQ2xhc3MsIHRoaXMuZXhlY3V0aW9uUGhhc2UpKSBjb250aW51ZVxuICAgICAgaWYgKCEoTWlncmF0aW9uQ2xhc3MuZ2V0RGF0YWJhc2VJZGVudGlmaWVycygpIHx8IFtcImRlZmF1bHRcIl0pLmluY2x1ZGVzKGRhdGFiYXNlSWRlbnRpZmllcikpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IG1pZ3JhdGlvbkluc3RhbmNlID0gbmV3IE1pZ3JhdGlvbkNsYXNzKHtjb25maWd1cmF0aW9uOiB0aGlzLmNvbmZpZ3VyYXRpb24sIGRhdGFiYXNlSWRlbnRpZmllciwgZGJ9KVxuXG4gICAgICBhd2FpdCB0aGlzLnJ1bk1pZ3JhdGlvblVwKHttaWdyYXRpb24sIG1pZ3JhdGlvbkluc3RhbmNlfSlcbiAgICAgIGF3YWl0IE1pZ3JhdGlvbnNMZWRnZXIucmVjb3JkVmVyc2lvbihkYiwgdmVyc2lvbilcbiAgICAgIGFwcGxpZWRWZXJzaW9ucy5hZGQodmVyc2lvbilcbiAgICAgIGFwcGxpZWRDb3VudCsrXG4gICAgfVxuXG4gICAgcmV0dXJuIGFwcGxpZWRDb3VudFxuICB9XG5cbiAgLyoqXG4gICAqIFBhcnNlcyBhbmQgb3JkZXJzIG1pZ3JhdGlvbnMgZnJvbSBhIGJyb3dzZXIvbmF0aXZlIHJlcXVpcmUgY29udGV4dC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL21pZ3JhdG9yL3R5cGVzLmpzXCIpLlJlcXVpcmVNaWdyYXRpb25Db250ZXh0VHlwZX0gcmVxdWlyZUNvbnRleHQgLSBNaWdyYXRpb24gcmVxdWlyZSBjb250ZXh0LlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9taWdyYXRvci90eXBlcy5qc1wiKS5NaWdyYXRpb25PYmplY3RUeXBlW119IC0gT3JkZXJlZCBtaWdyYXRpb25zLlxuICAgKi9cbiAgbWlncmF0aW9uc0Zyb21SZXF1aXJlQ29udGV4dChyZXF1aXJlQ29udGV4dCkge1xuICAgIGNvbnN0IG1pZ3JhdGlvbnMgPSBbXVxuXG4gICAgZm9yIChjb25zdCBmaWxlIG9mIHJlcXVpcmVDb250ZXh0LmtleXMoKSkge1xuICAgICAgY29uc3QgbWF0Y2ggPSBmaWxlLm1hdGNoKC8oXFxkezEzLDE0fSktKC4rKVxcLmpzJC8pXG5cbiAgICAgIGlmICghbWF0Y2gpIGNvbnRpbnVlXG5cbiAgICAgIGxldCBmaWxlTmFtZSA9IGZpbGVcbiAgICAgIGxldCBkYXRlTnVtYmVyID0gbWF0Y2hbMV1cblxuICAgICAgaWYgKGRhdGVOdW1iZXIubGVuZ3RoID09IDEzKSB7XG4gICAgICAgIGRhdGVOdW1iZXIgPSBgMiR7ZGF0ZU51bWJlcn1gXG4gICAgICAgIGZpbGVOYW1lID0gYDIke2ZpbGVOYW1lfWBcbiAgICAgIH1cblxuICAgICAgbWlncmF0aW9ucy5wdXNoKHtcbiAgICAgICAgZGF0ZTogcGFyc2VJbnQoZGF0ZU51bWJlciksXG4gICAgICAgIGZpbGU6IGZpbGVOYW1lLFxuICAgICAgICBtaWdyYXRpb25DbGFzc05hbWU6IGluZmxlY3Rpb24uY2FtZWxpemUobWF0Y2hbMl0ucmVwbGFjZUFsbChcIi1cIiwgXCJfXCIpKVxuICAgICAgfSlcbiAgICB9XG5cbiAgICByZXR1cm4gbWlncmF0aW9ucy5zb3J0KChtaWdyYXRpb24xLCBtaWdyYXRpb24yKSA9PiBtaWdyYXRpb24xLmRhdGUgLSBtaWdyYXRpb24yLmRhdGUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBvbmUgbWlncmF0aW9uJ3MgdXB3YXJkIGltcGxlbWVudGF0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE1pZ3JhdGlvbiBhcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9taWdyYXRvci90eXBlcy5qc1wiKS5NaWdyYXRpb25PYmplY3RUeXBlfSBhcmdzLm1pZ3JhdGlvbiAtIE1pZ3JhdGlvbiBkZXNjcmlwdG9yLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vbWlncmF0aW9uL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubWlncmF0aW9uSW5zdGFuY2UgLSBNaWdyYXRpb24gaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHRoZSBtaWdyYXRpb24gc3VjY2VlZHMuXG4gICAqL1xuICBhc3luYyBydW5NaWdyYXRpb25VcCh7bWlncmF0aW9uLCBtaWdyYXRpb25JbnN0YW5jZX0pIHtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgbWlncmF0aW9uSW5zdGFuY2UuY2hhbmdlKClcbiAgICB9IGNhdGNoIChjaGFuZ2VFcnJvcikge1xuICAgICAgaWYgKCEoY2hhbmdlRXJyb3IgaW5zdGFuY2VvZiBOb3RJbXBsZW1lbnRlZEVycm9yKSkgdGhyb3cgY2hhbmdlRXJyb3JcblxuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgbWlncmF0aW9uSW5zdGFuY2UudXAoKVxuICAgICAgfSBjYXRjaCAodXBFcnJvcikge1xuICAgICAgICBpZiAodXBFcnJvciBpbnN0YW5jZW9mIE5vdEltcGxlbWVudGVkRXJyb3IpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYCdjaGFuZ2UnIG9yICd1cCcgZGlkbid0IGV4aXN0IG9uIG1pZ3JhdGlvbjogJHttaWdyYXRpb24uZmlsZX1gLCB7Y2F1c2U6IHVwRXJyb3J9KVxuICAgICAgICB9XG5cbiAgICAgICAgdGhyb3cgdXBFcnJvclxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFmdGVyIG1pZ3JhdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfYWZ0ZXJNaWdyYXRpb25zKCkge1xuICAgIGNvbnN0IGVudmlyb25tZW50SGFuZGxlciA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKVxuICAgIGNvbnN0IGRicyA9IGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5nZXRDdXJyZW50Q29ubmVjdGlvbnMoKVxuICAgIGNvbnN0IGZpbHRlcmVkRGJzID0gT2JqZWN0LmZyb21FbnRyaWVzKFxuICAgICAgT2JqZWN0LmVudHJpZXMoZGJzKS5maWx0ZXIoKFtkYklkZW50aWZpZXJdKSA9PiB7XG4gICAgICAgIGlmICghdGhpcy5oYW5kbGVzRGF0YWJhc2VJZGVudGlmaWVyKGRiSWRlbnRpZmllcikpIHJldHVybiBmYWxzZVxuXG4gICAgICAgIHJldHVybiBCb29sZWFuKHRoaXMuY29uZmlndXJhdGlvbi5nZXREYXRhYmFzZUlkZW50aWZpZXIoZGJJZGVudGlmaWVyKS5taWdyYXRpb25zKVxuICAgICAgfSlcbiAgICApXG5cbiAgICBpZiAoIWVudmlyb25tZW50SGFuZGxlciB8fCBPYmplY3Qua2V5cyhmaWx0ZXJlZERicykubGVuZ3RoID09IDApIHJldHVyblxuXG4gICAgLy8gRW5zdXJlIFZlbG9jaW91cycgb3duIGZyYW1ld29yayBzY2hlbWEgYmVmb3JlIHRoZSBzdHJ1Y3R1cmUgZHVtcC4gVGhlIGR1bXAgaXNcbiAgICAvLyBnYXRlZCB0byBlbmFibGVkIGVudmlyb25tZW50cywgYnV0IG1pZ3JhdGlvbi1lbmFibGVkIGRhdGFiYXNlcyBtdXN0IGluY2x1ZGVcbiAgICAvLyBmcmFtZXdvcmsgdGFibGVzIHNvIGBkYjptaWdyYXRlYCBhbmQgc2NoZW1hOmxvYWQgcHJvZHVjZSBhIGNvbXBsZXRlIGRhdGFiYXNlLlxuICAgIGF3YWl0IGVudmlyb25tZW50SGFuZGxlci5lbnN1cmVGcmFtZXdvcmtTY2hlbWEoe2RiczogZmlsdGVyZWREYnN9KVxuICAgIGF3YWl0IGVudmlyb25tZW50SGFuZGxlci5hZnRlck1pZ3JhdGlvbnMoe2RiczogZmlsdGVyZWREYnN9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbG9hZCBtaWdyYXRpb25zIHZlcnNpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgbG9hZE1pZ3JhdGlvbnNWZXJzaW9ucygpIHtcbiAgICB0aGlzLm1pZ3JhdGlvbnNWZXJzaW9ucyA9IHt9XG5cbiAgICBjb25zdCBkYnMgPSBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0Q3VycmVudENvbm5lY3Rpb25zKClcblxuICAgIGZvciAoY29uc3QgZGJJZGVudGlmaWVyIGluIGRicykge1xuICAgICAgaWYgKCF0aGlzLmhhbmRsZXNEYXRhYmFzZUlkZW50aWZpZXIoZGJJZGVudGlmaWVyKSkgY29udGludWVcblxuICAgICAgYXdhaXQgdGhpcy5sb2FkTWlncmF0aW9uc1ZlcnNpb25zRm9yRGF0YWJhc2Uoe2RiSWRlbnRpZmllciwgZGI6IGRic1tkYklkZW50aWZpZXJdfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBsb2FkIG1pZ3JhdGlvbnMgdmVyc2lvbnMgZm9yIGRhdGFiYXNlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5kYklkZW50aWZpZXIgLSBEYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGFyZ3MuZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgbG9hZE1pZ3JhdGlvbnNWZXJzaW9uc0ZvckRhdGFiYXNlKHtkYklkZW50aWZpZXIsIGRifSkge1xuICAgIGNvbnN0IGRhdGFiYXNlQ29uZmlndXJhdGlvbiA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXREYXRhYmFzZUlkZW50aWZpZXIoZGJJZGVudGlmaWVyKVxuXG4gICAgaWYgKCFkYXRhYmFzZUNvbmZpZ3VyYXRpb24ubWlncmF0aW9ucykge1xuICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYCR7ZGJJZGVudGlmaWVyfSBpc24ndCBjb25maWd1cmVkIGZvciBtaWdyYXRpb25zIC0gc2tpcHBpbmcgbG9hZGluZyBtaWdyYXRpb25zIHZlcnNpb25zIGZvciBpdGApXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAoIWF3YWl0IHRoaXMubWlncmF0aW9uc1RhYmxlRXhpc3QoZGIpKSB7XG4gICAgICB0aGlzLmxvZ2dlci5pbmZvKGBNaWdyYXRpb24gdGFibGUgZG9lcyBub3QgZXhpc3QgZm9yICR7ZGJJZGVudGlmaWVyfSAtIHNraXBwaW5nIGxvYWRpbmcgbWlncmF0aW9ucyB2ZXJzaW9ucyBmb3IgaXRgKVxuICAgICAgZGVsZXRlIHRoaXMubWlncmF0aW9uc1ZlcnNpb25zW2RiSWRlbnRpZmllcl1cbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IHZlcnNpb25zID0gYXdhaXQgTWlncmF0aW9uc0xlZGdlci5hcHBsaWVkVmVyc2lvbnMoZGIpXG5cbiAgICB0aGlzLm1pZ3JhdGlvbnNWZXJzaW9uc1tkYklkZW50aWZpZXJdID0ge31cblxuICAgIGZvciAoY29uc3QgdmVyc2lvbiBvZiB2ZXJzaW9ucykge1xuICAgICAgdGhpcy5taWdyYXRpb25zVmVyc2lvbnNbZGJJZGVudGlmaWVyXVt2ZXJzaW9uXSA9IHRydWVcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBtaWdyYXRpb25zIHRhYmxlIGV4aXN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gUmVzb2x2ZXMgd2l0aCBXaGV0aGVyIG1pZ3JhdGlvbnMgdGFibGUgZXhpc3QuXG4gICAqL1xuICBhc3luYyBtaWdyYXRpb25zVGFibGVFeGlzdChkYikge1xuICAgIHJldHVybiBhd2FpdCBNaWdyYXRpb25zTGVkZ2VyLnRhYmxlRXhpc3RzKGRiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZXhlY3V0ZSByZXF1aXJlIGNvbnRleHQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9taWdyYXRvci90eXBlcy5qc1wiKS5SZXF1aXJlTWlncmF0aW9uQ29udGV4dFR5cGV9IHJlcXVpcmVDb250ZXh0IC0gUmVxdWlyZSBjb250ZXh0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgZXhlY3V0ZVJlcXVpcmVDb250ZXh0KHJlcXVpcmVDb250ZXh0KSB7XG4gICAgY29uc3QgbWlncmF0aW9uRmlsZXMgPSByZXF1aXJlQ29udGV4dC5rZXlzKClcblxuICAgIC8qKlxuICAgICAqIEZpbGVzLlxuICAgICAqIEB0eXBlIHtpbXBvcnQoXCIuL21pZ3JhdG9yL3R5cGVzLmpzXCIpLk1pZ3JhdGlvbk9iamVjdFR5cGVbXX0gKi9cbiAgICBsZXQgZmlsZXMgPSBbXVxuXG4gICAgZm9yIChjb25zdCBmaWxlIG9mIG1pZ3JhdGlvbkZpbGVzKSB7XG4gICAgICBjb25zdCBtYXRjaCA9IGZpbGUubWF0Y2goL14oXFxkezE0fSktKC4rKVxcLmpzJC8pXG5cbiAgICAgIGlmICghbWF0Y2gpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IGRhdGUgPSBwYXJzZUludChtYXRjaFsxXSlcbiAgICAgIGNvbnN0IG1pZ3JhdGlvbk5hbWUgPSBtYXRjaFsyXVxuICAgICAgY29uc3QgbWlncmF0aW9uQ2xhc3NOYW1lID0gaW5mbGVjdGlvbi5jYW1lbGl6ZShtaWdyYXRpb25OYW1lKVxuXG4gICAgICBjb25zdCBtaWdyYXRpb25PYmplY3QgPSAvKiogQHR5cGUge2ltcG9ydChcIi4vbWlncmF0b3IvdHlwZXMuanNcIikuTWlncmF0aW9uT2JqZWN0VHlwZX0gKi8gKHtcbiAgICAgICAgZmlsZSxcbiAgICAgICAgZGF0ZSxcbiAgICAgICAgbWlncmF0aW9uQ2xhc3NOYW1lXG4gICAgICB9KVxuXG4gICAgICBmaWxlcy5wdXNoKG1pZ3JhdGlvbk9iamVjdClcbiAgICB9XG5cbiAgICBmaWxlcyA9IGZpbGVzLnNvcnQoKG1pZ3JhdGlvbjEsIG1pZ3JhdGlvbjIpID0+IG1pZ3JhdGlvbjEuZGF0ZSAtIG1pZ3JhdGlvbjIuZGF0ZSlcblxuICAgIGZvciAoY29uc3QgbWlncmF0aW9uIG9mIGZpbGVzKSB7XG4gICAgICBhd2FpdCB0aGlzLnJ1bk1pZ3JhdGlvbkZpbGUoe1xuICAgICAgICBtaWdyYXRpb24sXG4gICAgICAgIHJlcXVpcmVNaWdyYXRpb246IGFzeW5jICgpID0+IHJlcXVpcmVDb250ZXh0KG1pZ3JhdGlvbi5maWxlKS5kZWZhdWx0XG4gICAgICB9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlc2V0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgcmVzZXQoKSB7XG4gICAgY29uc3QgZGJzID0gYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLmdldEN1cnJlbnRDb25uZWN0aW9ucygpXG5cbiAgICBmb3IgKGNvbnN0IGRiSWRlbnRpZmllciBpbiBkYnMpIHtcbiAgICAgIGlmICghdGhpcy5oYW5kbGVzRGF0YWJhc2VJZGVudGlmaWVyKGRiSWRlbnRpZmllcikpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IGRiID0gZGJzW2RiSWRlbnRpZmllcl1cblxuICAgICAgYXdhaXQgZGIud2l0aERpc2FibGVkRm9yZWlnbktleXMoYXN5bmMgKCkgPT4ge1xuICAgICAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgICAgIGNvbnN0IGVycm9ycyA9IFtdXG4gICAgICAgICAgbGV0IGFueVRhYmxlRHJvcHBlZCA9IGZhbHNlXG5cbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgZm9yIChjb25zdCB0YWJsZSBvZiBhd2FpdCBkYi5nZXRUYWJsZXMoKSkge1xuICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBEcm9wcGluZyB0YWJsZSAke3RhYmxlLmdldE5hbWUoKX1gKVxuXG4gICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgYXdhaXQgZGIuZHJvcFRhYmxlKHRhYmxlLmdldE5hbWUoKSwge2Nhc2NhZGU6IHRydWV9KVxuICAgICAgICAgICAgICAgIGFueVRhYmxlRHJvcHBlZCA9IHRydWVcbiAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICBlcnJvcnMucHVzaChlcnJvcilcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBicmVha1xuICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tdW51c2VkLXZhcnNcbiAgICAgICAgICAgIGlmIChlcnJvcnMubGVuZ3RoID4gMCAmJiBhbnlUYWJsZURyb3BwZWQpIHtcbiAgICAgICAgICAgICAgLy8gUmV0cnlcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIHRocm93IGVycm9yc1swXVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyByb2xsYmFjay5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL21pZ3JhdG9yL3R5cGVzLmpzXCIpLk1pZ3JhdGlvbk9iamVjdFR5cGVbXX0gZmlsZXMgLSBGaWxlcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL21pZ3JhdG9yL3R5cGVzLmpzXCIpLkltcG9ydEZ1bGxwYXRoQ2FsbGJhY2tUeXBlfSBpbXBvcnRDYWxsYmFjayBGdW5jdGlvbiB0byBpbXBvcnQgYSBmaWxlXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyByb2xsYmFjayhmaWxlcywgaW1wb3J0Q2FsbGJhY2spIHtcbiAgICBjb25zdCBsYXRlc3RNaWdyYXRpb25WZXJzaW9uID0gYXdhaXQgdGhpcy5fbGF0ZXN0TWlncmF0aW9uVmVyc2lvbigpXG5cbiAgICBpZiAoIWxhdGVzdE1pZ3JhdGlvblZlcnNpb24pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIk5vIG1pZ3JhdGlvbnMgaGF2ZSBiZWVuIHJ1biB5ZXRcIilcbiAgICB9XG5cbiAgICBjb25zdCBsYXRlc3RNaWdyYXRpb25WZXJzaW9uTnVtYmVyID0gcGFyc2VJbnQobGF0ZXN0TWlncmF0aW9uVmVyc2lvbilcbiAgICBjb25zdCBtaWdyYXRpb24gPSBmaWxlcy5maW5kKChmaWxlKSA9PiBmaWxlLmRhdGUgPT0gbGF0ZXN0TWlncmF0aW9uVmVyc2lvbk51bWJlcilcblxuICAgIGlmICghbWlncmF0aW9uKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE1pZ3JhdGlvbiBmaWxlIGZvciB2ZXJzaW9uICR7bGF0ZXN0TWlncmF0aW9uVmVyc2lvbk51bWJlcn0gbm90IGZvdW5kYClcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnJ1bk1pZ3JhdGlvbkZpbGUoe1xuICAgICAgbWlncmF0aW9uLFxuICAgICAgcmVxdWlyZU1pZ3JhdGlvbjogYXN5bmMgKCkgPT4ge1xuICAgICAgICBpZiAoIW1pZ3JhdGlvbi5mdWxsUGF0aCkgdGhyb3cgbmV3IEVycm9yKGBNaWdyYXRpb24gZGlkbid0IGhhdmUgYSBmdWxsUGF0aCBrZXk6ICR7T2JqZWN0LmtleXMobWlncmF0aW9uKS5qb2luKFwiLCBcIil9YClcblxuICAgICAgICByZXR1cm4gYXdhaXQgaW1wb3J0Q2FsbGJhY2sobWlncmF0aW9uLmZ1bGxQYXRoKVxuICAgICAgfSxcbiAgICAgIGRpcmVjdGlvbjogXCJkb3duXCJcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbGF0ZXN0IG1pZ3JhdGlvbiB2ZXJzaW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmcgfCB1bmRlZmluZWQ+fSBUaGUgbGF0ZXN0IG1pZ3JhdGlvbiB2ZXJzaW9uXG4gICAqL1xuICBhc3luYyBfbGF0ZXN0TWlncmF0aW9uVmVyc2lvbigpIHtcbiAgICBpZiAoIXRoaXMubWlncmF0aW9uc1ZlcnNpb25zKSBhd2FpdCB0aGlzLmxvYWRNaWdyYXRpb25zVmVyc2lvbnMoKVxuXG4gICAgLyoqXG4gICAgICogRGVmaW5lcyBoaWdoZXN0VmVyc2lvbi5cbiAgICAgKiBAdHlwZSB7c3RyaW5nIHwgdW5kZWZpbmVkfSAqL1xuICAgIGxldCBoaWdoZXN0VmVyc2lvblxuXG4gICAgZm9yIChjb25zdCBkYklkZW50aWZpZXIgaW4gdGhpcy5taWdyYXRpb25zVmVyc2lvbnMpIHtcbiAgICAgIGZvciAoY29uc3QgbWlncmF0aW9uVmVyc2lvbiBpbiB0aGlzLm1pZ3JhdGlvbnNWZXJzaW9uc1tkYklkZW50aWZpZXJdKSB7XG4gICAgICAgIGlmICghaGlnaGVzdFZlcnNpb24gfHwgbWlncmF0aW9uVmVyc2lvbiA+IGhpZ2hlc3RWZXJzaW9uKSB7XG4gICAgICAgICAgaGlnaGVzdFZlcnNpb24gPSBtaWdyYXRpb25WZXJzaW9uXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gaGlnaGVzdFZlcnNpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1biBtaWdyYXRpb24gZmlsZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL21pZ3JhdG9yL3R5cGVzLmpzXCIpLk1pZ3JhdGlvbk9iamVjdFR5cGV9IGFyZ3MubWlncmF0aW9uIC0gTWlncmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vbWlncmF0b3IvdHlwZXMuanNcIikuUmVxdWlyZU1pZ3JhdGlvblR5cGV9IGFyZ3MucmVxdWlyZU1pZ3JhdGlvbiAtIFJlcXVpcmUgbWlncmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuZGlyZWN0aW9uXSAtIERpcmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgbWlncmF0aW9uIHJhbiBvbiBhdCBsZWFzdCBvbmUgZGF0YWJhc2UgKGZhbHNlIGlmIHNraXBwZWQgYXMgYWxyZWFkeS1ydW4gZXZlcnl3aGVyZSkuXG4gICAqL1xuICBhc3luYyBydW5NaWdyYXRpb25GaWxlKHttaWdyYXRpb24sIHJlcXVpcmVNaWdyYXRpb24sIGRpcmVjdGlvbiA9IFwidXBcIn0pIHtcbiAgICBpZiAoIXRoaXMuY29uZmlndXJhdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiTm8gY29uZmlndXJhdGlvbiBzZXRcIilcbiAgICBpZiAoIXRoaXMuY29uZmlndXJhdGlvbi5pc0RhdGFiYXNlUG9vbEluaXRpYWxpemVkKCkpIGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5pbml0aWFsaXplRGF0YWJhc2VQb29sKClcbiAgICBpZiAoIXRoaXMubWlncmF0aW9uc1ZlcnNpb25zKSBhd2FpdCB0aGlzLmxvYWRNaWdyYXRpb25zVmVyc2lvbnMoKVxuXG4gICAgbGV0IGFwcGxpZWQgPSBmYWxzZVxuICAgIGNvbnN0IGRicyA9IGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5nZXRDdXJyZW50Q29ubmVjdGlvbnMoKVxuXG4gICAgLyoqXG4gICAgICogRGIgaWRlbnRpZmllcnMgbmVlZGluZyBtaWdyYXRpb24gdmVyc2lvbnMuXG4gICAgICogQHR5cGUge3N0cmluZ1tdfSAqL1xuICAgIGNvbnN0IGRiSWRlbnRpZmllcnNOZWVkaW5nTWlncmF0aW9uVmVyc2lvbnMgPSBbXVxuXG4gICAgLy8gbWlncmF0ZUZpbGVzKCkgd3JhcHMgZXhlY3V0aW9uIGluIGVuc3VyZUNvbm5lY3Rpb25zKCksIHNvIHRoZSBjdXJyZW50XG4gICAgLy8gYXN5bmMgY29udGV4dCBjYW4gZXhwb3NlIERCIGlkZW50aWZpZXJzIG5vdCBsb2FkZWQgYnkgcHJlcGFyZSgpLlxuICAgIGZvciAoY29uc3QgZGJJZGVudGlmaWVyIGluIGRicykge1xuICAgICAgaWYgKCF0aGlzLmhhbmRsZXNEYXRhYmFzZUlkZW50aWZpZXIoZGJJZGVudGlmaWVyKSkgY29udGludWVcblxuICAgICAgY29uc3QgZGF0YWJhc2VDb25maWd1cmF0aW9uID0gdGhpcy5jb25maWd1cmF0aW9uLmdldERhdGFiYXNlSWRlbnRpZmllcihkYklkZW50aWZpZXIpXG5cbiAgICAgIGlmICghZGF0YWJhc2VDb25maWd1cmF0aW9uLm1pZ3JhdGlvbnMpIGNvbnRpbnVlXG4gICAgICBpZiAodGhpcy5taWdyYXRpb25zVmVyc2lvbnNbZGJJZGVudGlmaWVyXSkgY29udGludWVcblxuICAgICAgZGJJZGVudGlmaWVyc05lZWRpbmdNaWdyYXRpb25WZXJzaW9ucy5wdXNoKGRiSWRlbnRpZmllcilcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGRiSWRlbnRpZmllciBvZiBkYklkZW50aWZpZXJzTmVlZGluZ01pZ3JhdGlvblZlcnNpb25zKSB7XG4gICAgICBjb25zdCBkYiA9IGRic1tkYklkZW50aWZpZXJdXG5cbiAgICAgIGF3YWl0IHRoaXMuY3JlYXRlTWlncmF0aW9uc1RhYmxlRm9yRGF0YWJhc2Uoe2RiSWRlbnRpZmllciwgZGJ9KVxuICAgICAgYXdhaXQgdGhpcy5sb2FkTWlncmF0aW9uc1ZlcnNpb25zRm9yRGF0YWJhc2Uoe2RiSWRlbnRpZmllciwgZGJ9KVxuICAgIH1cblxuICAgIGNvbnN0IG1pZ3JhdGlvbkNsYXNzID0gYXdhaXQgcmVxdWlyZU1pZ3JhdGlvbigpXG5cbiAgICBpZiAoIW1pZ3JhdGlvbkNsYXNzIHx8IHR5cGVvZiBtaWdyYXRpb25DbGFzcyAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE1pZ3JhdGlvbiAke21pZ3JhdGlvbi5maWxlfSBtdXN0IGV4cG9ydCBhIGRlZmF1bHQgbWlncmF0aW9uIGNsYXNzLiBUeXBlOiAke3R5cGVvZiBtaWdyYXRpb25DbGFzc31gKVxuICAgIH1cbiAgICBpZiAoZGlyZWN0aW9uID09IFwidXBcIiAmJiAhbWlncmF0aW9uUnVuc0luRXhlY3V0aW9uUGhhc2UobWlncmF0aW9uQ2xhc3MsIHRoaXMuZXhlY3V0aW9uUGhhc2UpKSByZXR1cm4gZmFsc2VcblxuICAgIGNvbnN0IG1pZ3JhdGlvbkRhdGFiYXNlSWRlbnRpZmllcnMgPSBtaWdyYXRpb25DbGFzcy5nZXREYXRhYmFzZUlkZW50aWZpZXJzKCkgfHwgW1wiZGVmYXVsdFwiXVxuXG4gICAgZm9yIChjb25zdCBkYklkZW50aWZpZXIgaW4gZGJzKSB7XG4gICAgICBpZiAoIXRoaXMuaGFuZGxlc0RhdGFiYXNlSWRlbnRpZmllcihkYklkZW50aWZpZXIpKSBjb250aW51ZVxuXG4gICAgICBjb25zdCBkYXRhYmFzZUNvbmZpZ3VyYXRpb24gPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RGF0YWJhc2VJZGVudGlmaWVyKGRiSWRlbnRpZmllcilcblxuICAgICAgaWYgKCFkYXRhYmFzZUNvbmZpZ3VyYXRpb24ubWlncmF0aW9ucykge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgJHtkYklkZW50aWZpZXJ9IGlzbid0IGNvbmZpZ3VyZWQgZm9yIG1pZ3JhdGlvbnMgLSBza2lwcGluZyBtaWdyYXRpb24gJHtkaWdnKG1pZ3JhdGlvbiwgXCJkYXRlXCIpfWApXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmICghbWlncmF0aW9uRGF0YWJhc2VJZGVudGlmaWVycy5pbmNsdWRlcyhkYklkZW50aWZpZXIpKSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGAke2RiSWRlbnRpZmllcn0gc2hvdWxkbid0IHJ1biBtaWdyYXRpb24gJHttaWdyYXRpb24uZmlsZX1gLCB7bWlncmF0aW9uRGF0YWJhc2VJZGVudGlmaWVyc30pXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChkaXJlY3Rpb24gPT0gXCJ1cFwiKSB7XG4gICAgICAgIGlmICh0aGlzLmhhc1J1bk1pZ3JhdGlvblZlcnNpb24oZGJJZGVudGlmaWVyLCBtaWdyYXRpb24uZGF0ZSkpIHtcbiAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgJHtkYklkZW50aWZpZXJ9IGhhcyBhbHJlYWR5IHJ1biBtaWdyYXRpb24gJHttaWdyYXRpb24uZmlsZX1gKVxuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZiAoZGlyZWN0aW9uID09IFwiZG93blwiKSB7XG4gICAgICAgIGlmICghdGhpcy5oYXNSdW5NaWdyYXRpb25WZXJzaW9uKGRiSWRlbnRpZmllciwgbWlncmF0aW9uLmRhdGUpKSB7XG4gICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYCR7ZGJJZGVudGlmaWVyfSBoYXNuJ3QgcnVuIG1pZ3JhdGlvbiAke21pZ3JhdGlvbi5maWxlfWApXG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIGRpcmVjdGlvbjogJHtkaXJlY3Rpb259YClcbiAgICAgIH1cblxuICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYFJ1bm5pbmcgbWlncmF0aW9uIG9uICR7ZGJJZGVudGlmaWVyfTogJHttaWdyYXRpb24uZmlsZX1gLCB7bWlncmF0aW9uRGF0YWJhc2VJZGVudGlmaWVyc30pXG5cbiAgICAgIGFwcGxpZWQgPSB0cnVlXG4gICAgICBjb25zdCBkYiA9IGRic1tkYklkZW50aWZpZXJdXG4gICAgICBjb25zdCBNaWdyYXRpb25DbGFzcyA9IG1pZ3JhdGlvbkNsYXNzXG4gICAgICBjb25zdCBtaWdyYXRpb25JbnN0YW5jZSA9IG5ldyBNaWdyYXRpb25DbGFzcyh7XG4gICAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuY29uZmlndXJhdGlvbixcbiAgICAgICAgZGF0YWJhc2VJZGVudGlmaWVyOiBkYklkZW50aWZpZXIsXG4gICAgICAgIGRiXG4gICAgICB9KVxuICAgICAgY29uc3QgZGF0ZVN0cmluZyA9IGAke2RpZ2cobWlncmF0aW9uLCBcImRhdGVcIil9YFxuXG4gICAgICBpZiAoZGlyZWN0aW9uID09IFwidXBcIikge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGF3YWl0IG1pZ3JhdGlvbkluc3RhbmNlLmNoYW5nZSgpXG4gICAgICAgIH0gY2F0Y2ggKGNoYW5nZUVycm9yKSB7XG4gICAgICAgICAgaWYgKGNoYW5nZUVycm9yIGluc3RhbmNlb2YgTm90SW1wbGVtZW50ZWRFcnJvcikge1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgYXdhaXQgbWlncmF0aW9uSW5zdGFuY2UudXAoKVxuICAgICAgICAgICAgfSBjYXRjaCAodXBFcnJvcikge1xuICAgICAgICAgICAgICBpZiAodXBFcnJvciBpbnN0YW5jZW9mIE5vdEltcGxlbWVudGVkRXJyb3IpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYCdjaGFuZ2UnIG9yICd1cCcgZGlkbid0IGV4aXN0IG9uIG1pZ3JhdGlvbjogJHttaWdyYXRpb24uZmlsZX1gLCB7Y2F1c2U6IHVwRXJyb3J9KVxuICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHRocm93IHVwRXJyb3JcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aHJvdyBjaGFuZ2VFcnJvclxuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGF3YWl0IE1pZ3JhdGlvbnNMZWRnZXIucmVjb3JkVmVyc2lvbihkYiwgZGF0ZVN0cmluZylcbiAgICAgIH0gZWxzZSBpZiAoZGlyZWN0aW9uID09IFwiZG93blwiKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXdhaXQgbWlncmF0aW9uSW5zdGFuY2UuZG93bigpXG4gICAgICAgIH0gY2F0Y2ggKGRvd25FcnJvcikge1xuICAgICAgICAgIGlmIChkb3duRXJyb3IgaW5zdGFuY2VvZiBOb3RJbXBsZW1lbnRlZEVycm9yKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYCdkb3duJyBkaWRuJ3QgZXhpc3Qgb24gbWlncmF0aW9uOiAke21pZ3JhdGlvbi5maWxlfSBvciBtaWdyYXRpbmcgZG93biB3aXRoIGEgY2hhbmdlIG1ldGhvZCBpc24ndCBjdXJyZW50bHkgc3VwcG9ydGVkYCwge2NhdXNlOiBkb3duRXJyb3J9KVxuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aHJvdyBkb3duRXJyb3JcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBhd2FpdCBNaWdyYXRpb25zTGVkZ2VyLnJlbW92ZVZlcnNpb24oZGIsIGRhdGVTdHJpbmcpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gZGlyZWN0aW9uOiAke2RpcmVjdGlvbn1gKVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBhcHBsaWVkXG4gIH1cbn1cbiJdfQ==