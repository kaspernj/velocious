// @ts-check
import { digg } from "diggerize";
import * as inflection from "inflection";
import Logger from "../logger.js";
import MigrationsLedger from "./migrations-ledger.js";
import { NotImplementedError } from "./migration/index.js";
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
     */
    constructor({ configuration, databaseIdentifiers, ...restArgs }) {
        restArgsError(restArgs);
        if (!configuration)
            throw new Error("configuration argument is required");
        this.configuration = configuration;
        this.databaseIdentifiers = databaseIdentifiers;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWlncmF0b3IuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZGF0YWJhc2UvbWlncmF0b3IuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sRUFBQyxJQUFJLEVBQUMsTUFBTSxXQUFXLENBQUE7QUFDOUIsT0FBTyxLQUFLLFVBQVUsTUFBTSxZQUFZLENBQUE7QUFDeEMsT0FBTyxNQUFNLE1BQU0sY0FBYyxDQUFBO0FBQ2pDLE9BQU8sZ0JBQWdCLE1BQU0sd0JBQXdCLENBQUE7QUFDckQsT0FBTyxFQUFDLG1CQUFtQixFQUFDLE1BQU0sc0JBQXNCLENBQUE7QUFDeEQsT0FBTyxhQUFhLE1BQU0sNkJBQTZCLENBQUE7QUFFdkQsTUFBTSxDQUFDLE9BQU8sT0FBTyx5QkFBeUI7SUFDNUM7O3lEQUVxRDtJQUNyRCxrQkFBa0IsR0FBRyxFQUFFLENBQUE7SUFFdkI7Ozs7O09BS0c7SUFDSCxZQUFZLEVBQUMsYUFBYSxFQUFFLG1CQUFtQixFQUFFLEdBQUcsUUFBUSxFQUFDO1FBQzNELGFBQWEsQ0FBQyxRQUFRLENBQUMsQ0FBQTtRQUV2QixJQUFJLENBQUMsYUFBYTtZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsb0NBQW9DLENBQUMsQ0FBQTtRQUV6RSxJQUFJLENBQUMsYUFBYSxHQUFHLGFBQWEsQ0FBQTtRQUNsQyxJQUFJLENBQUMsbUJBQW1CLEdBQUcsbUJBQW1CLENBQUE7UUFDOUMsSUFBSSxDQUFDLE1BQU0sR0FBRyxJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQTtJQUNoQyxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILHlCQUF5QixDQUFDLFlBQVk7UUFDcEMsSUFBSSxDQUFDLElBQUksQ0FBQyxtQkFBbUI7WUFBRSxPQUFPLElBQUksQ0FBQTtRQUUxQyxPQUFPLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxRQUFRLENBQUMsWUFBWSxDQUFDLENBQUE7SUFDeEQsQ0FBQztJQUdEOzs7T0FHRztJ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LFlBQVksbUJBQW1CLEVBQUUsQ0FBQzt3QkFDN0MsTUFBTSxJQUFJLEtBQUssQ0FBQyxxQ0FBcUMsU0FBUyxDQUFDLElBQUksbUVBQW1FLEVBQUUsRUFBQyxLQUFLLEVBQUUsU0FBUyxFQUFDLENBQUMsQ0FBQTtvQkFDN0osQ0FBQzt5QkFBTSxDQUFDO3dCQUNOLE1BQU0sU0FBUyxDQUFBO29CQUNqQixDQUFDO2dCQUNILENBQUM7Z0JBRUQsTUFBTSxnQkFBZ0IsQ0FBQyxhQUFhLENBQUMsRUFBRSxFQUFFLFVBQVUsQ0FBQyxDQUFBO1lBQ3RELENBQUM7aUJBQU0sQ0FBQztnQkFDTixNQUFNLElBQUksS0FBSyxDQUFDLHNCQUFzQixTQUFTLEVBQUUsQ0FBQyxDQUFBO1lBQ3BELENBQUM7UUFDSCxDQUFDO1FBRUQsT0FBTyxPQUFPLENBQUE7SUFDaEIsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCB7ZGlnZ30gZnJvbSBcImRpZ2dlcml6ZVwiXG5pbXBvcnQgKiBhcyBpbmZsZWN0aW9uIGZyb20gXCJpbmZsZWN0aW9uXCJcbmltcG9ydCBMb2dnZXIgZnJvbSBcIi4uL2xvZ2dlci5qc1wiXG5pbXBvcnQgTWlncmF0aW9uc0xlZGdlciBmcm9tIFwiLi9taWdyYXRpb25zLWxlZGdlci5qc1wiXG5pbXBvcnQge05vdEltcGxlbWVudGVkRXJyb3J9IGZyb20gXCIuL21pZ3JhdGlvbi9pbmRleC5qc1wiXG5pbXBvcnQgcmVzdEFyZ3NFcnJvciBmcm9tIFwiLi4vdXRpbHMvcmVzdC1hcmdzLWVycm9yLmpzXCJcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzRGF0YWJhc2VNaWdyYXRvciB7XG4gIC8qKlxuICAgKiBNaWdyYXRpb25zIHZlcnNpb25zLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmVjb3JkPHN0cmluZywgYm9vbGVhbj4+fSAqL1xuICBtaWdyYXRpb25zVmVyc2lvbnMgPSB7fVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gYXJncy5jb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gW2FyZ3MuZGF0YWJhc2VJZGVudGlmaWVyc10gLSBPcHRpb25hbCBkYXRhYmFzZSBpZGVudGlmaWVycyB0byBtaWdyYXRlLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2NvbmZpZ3VyYXRpb24sIGRhdGFiYXNlSWRlbnRpZmllcnMsIC4uLnJlc3RBcmdzfSkge1xuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG5cbiAgICBpZiAoIWNvbmZpZ3VyYXRpb24pIHRocm93IG5ldyBFcnJvcihcImNvbmZpZ3VyYXRpb24gYXJndW1lbnQgaXMgcmVxdWlyZWRcIilcblxuICAgIHRoaXMuY29uZmlndXJhdGlvbiA9IGNvbmZpZ3VyYXRpb25cbiAgICB0aGlzLmRhdGFiYXNlSWRlbnRpZmllcnMgPSBkYXRhYmFzZUlkZW50aWZpZXJzXG4gICAgdGhpcy5sb2dnZXIgPSBuZXcgTG9nZ2VyKHRoaXMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYW5kbGVzIGRhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBkYklkZW50aWZpZXIgLSBEYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoaXMgbWlncmF0b3Igc2hvdWxkIHRvdWNoIHRoZSBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKi9cbiAgaGFuZGxlc0RhdGFiYXNlSWRlbnRpZmllcihkYklkZW50aWZpZXIpIHtcbiAgICBpZiAoIXRoaXMuZGF0YWJhc2VJZGVudGlmaWVycykgcmV0dXJuIHRydWVcblxuICAgIHJldHVybiB0aGlzLmRhdGFiYXNlSWRlbnRpZmllcnMuaW5jbHVkZXMoZGJJZGVudGlmaWVyKVxuICB9XG5cblxuICAvKipcbiAgICogUnVucyBwcmVwYXJlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgcHJlcGFyZSgpIHtcbiAgICBhd2FpdCB0aGlzLmNyZWF0ZU1pZ3JhdGlvbnNUYWJsZSgpXG4gICAgYXdhaXQgdGhpcy5sb2FkTWlncmF0aW9uc1ZlcnNpb25zKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNyZWF0ZSBtaWdyYXRpb25zIHRhYmxlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgY3JlYXRlTWlncmF0aW9uc1RhYmxlKCkge1xuICAgIGNvbnN0IGRicyA9IGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5nZXRDdXJyZW50Q29ubmVjdGlvbnMoKVxuXG4gICAgZm9yIChjb25zdCBkYklkZW50aWZpZXIgaW4gZGJzKSB7XG4gICAgICBpZiAoIXRoaXMuaGFuZGxlc0RhdGFiYXNlSWRlbnRpZmllcihkYklkZW50aWZpZXIpKSBjb250aW51ZVxuXG4gICAgICBhd2FpdCB0aGlzLmNyZWF0ZU1pZ3JhdGlvbnNUYWJsZUZvckRhdGFiYXNlKHtkYklkZW50aWZpZXIsIGRiOiBkYnNbZGJJZGVudGlmaWVyXX0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY3JlYXRlIG1pZ3JhdGlvbnMgdGFibGUgZm9yIGRhdGFiYXNlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5kYklkZW50aWZpZXIgLSBEYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGFyZ3MuZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgY3JlYXRlTWlncmF0aW9uc1RhYmxlRm9yRGF0YWJhc2Uoe2RiSWRlbnRpZmllciwgZGJ9KSB7XG4gICAgY29uc3QgZGF0YWJhc2VDb25maWd1cmF0aW9uID0gdGhpcy5jb25maWd1cmF0aW9uLmdldERhdGFiYXNlSWRlbnRpZmllcihkYklkZW50aWZpZXIpXG5cbiAgICBpZiAoIWRhdGFiYXNlQ29uZmlndXJhdGlvbi5taWdyYXRpb25zKSB7XG4gICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgJHtkYklkZW50aWZpZXJ9IGlzbid0IGNvbmZpZ3VyZWQgZm9yIG1pZ3JhdGlvbnMgLSBza2lwcGluZyBjcmVhdGluZyBtaWdyYXRpb25zIHRhYmxlIGZvciBpdGApXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAoYXdhaXQgdGhpcy5taWdyYXRpb25zVGFibGVFeGlzdChkYikpIHtcbiAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGAke2RiSWRlbnRpZmllcn0gbWlncmF0aW9ucyB0YWJsZSBhbHJlYWR5IGV4aXN0cyAtIHNraXBwaW5nYClcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJDcmVhdGluZyBzY2hlbWFfbWlncmF0aW9ucyB0YWJsZSB2aWEgTWlncmF0aW9uc0xlZGdlclwiKVxuICAgICAgYXdhaXQgTWlncmF0aW9uc0xlZGdlci5lbnN1cmVUYWJsZShkYilcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYXMgcnVuIG1pZ3JhdGlvbiB2ZXJzaW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZGJJZGVudGlmaWVyIC0gRGIgaWRlbnRpZmllci5cbiAgICogQHBhcmFtIHtudW1iZXJ9IHZlcnNpb24gLSBWZXJzaW9uLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGl0IGhhcyBydW4gbWlncmF0aW9uIHZlcnNpb24uXG4gICAqL1xuICBoYXNSdW5NaWdyYXRpb25WZXJzaW9uKGRiSWRlbnRpZmllciwgdmVyc2lvbikge1xuICAgIGlmICghdGhpcy5taWdyYXRpb25zVmVyc2lvbnMpIHRocm93IG5ldyBFcnJvcihcIk1pZ3JhdGlvbnMgdmVyc2lvbnMgaGFzbid0IGJlZW4gbG9hZGVkIHlldFwiKVxuICAgIGlmICghdGhpcy5taWdyYXRpb25zVmVyc2lvbnNbZGJJZGVudGlmaWVyXSkgdGhyb3cgbmV3IEVycm9yKGBNaWdyYXRpb25zIHZlcnNpb25zIGhhc24ndCBiZWVuIGxvYWRlZCB5ZXQgZm9yIGRiOiAke2RiSWRlbnRpZmllcn1gKVxuXG4gICAgaWYgKHZlcnNpb24gaW4gdGhpcy5taWdyYXRpb25zVmVyc2lvbnNbZGJJZGVudGlmaWVyXSkge1xuICAgICAgcmV0dXJuIHRydWVcbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1pZ3JhdGUgZmlsZXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9taWdyYXRvci90eXBlcy5qc1wiKS5NaWdyYXRpb25PYmplY3RUeXBlW119IGZpbGVzIC0gRmlsZXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9taWdyYXRvci90eXBlcy5qc1wiKS5JbXBvcnRGdWxscGF0aENhbGxiYWNrVHlwZX0gaW1wb3J0Q2FsbGJhY2sgLSBJbXBvcnQgY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IC0gTnVtYmVyIG9mIG1pZ3JhdGlvbnMgYWN0dWFsbHkgYXBwbGllZCAobm90IHNraXBwZWQgYXMgYWxyZWFkeS1ydW4pLlxuICAgKi9cbiAgYXN5bmMgbWlncmF0ZUZpbGVzKGZpbGVzLCBpbXBvcnRDYWxsYmFjaykge1xuICAgIGxldCBhcHBsaWVkQ291bnQgPSAwXG5cbiAgICBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24uZW5zdXJlQ29ubmVjdGlvbnMoe2RhdGFiYXNlSWRlbnRpZmllcnM6IHRoaXMuZGF0YWJhc2VJZGVudGlmaWVycywgbmFtZTogXCJEYXRhYmFzZSBtaWdyYXRvcjogbWlncmF0ZSBmaWxlc1wifSwgYXN5bmMgKCkgPT4ge1xuICAgICAgZm9yIChjb25zdCBtaWdyYXRpb24gb2YgZmlsZXMpIHtcbiAgICAgICAgY29uc3QgYXBwbGllZCA9IGF3YWl0IHRoaXMucnVuTWlncmF0aW9uRmlsZSh7XG4gICAgICAgICAgbWlncmF0aW9uLFxuICAgICAgICAgIHJlcXVpcmVNaWdyYXRpb246IGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIGlmICghbWlncmF0aW9uLmZ1bGxQYXRoKSB0aHJvdyBuZXcgRXJyb3IoYE1pZ3JhdGlvbiBkaWRuJ3QgaGF2ZSBhIGZ1bGxQYXRoIGtleTogJHtPYmplY3Qua2V5cyhtaWdyYXRpb24pLmpvaW4oXCIsIFwiKX1gKVxuXG4gICAgICAgICAgICBjb25zdCBtaWdyYXRpb25JbXBvcnQgPSBhd2FpdCBpbXBvcnRDYWxsYmFjayhtaWdyYXRpb24uZnVsbFBhdGgpXG5cbiAgICAgICAgICAgIGlmICghbWlncmF0aW9uSW1wb3J0KSB7XG4gICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgTWlncmF0aW9uIGZpbGUgbXVzdCBleHBvcnQgbWlncmF0aW9uIGNsYXNzOiAke21pZ3JhdGlvbi5mdWxsUGF0aH1gKVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZXR1cm4gbWlncmF0aW9uSW1wb3J0XG4gICAgICAgICAgfVxuICAgICAgICB9KVxuXG4gICAgICAgIGlmIChhcHBsaWVkKSBhcHBsaWVkQ291bnQrK1xuICAgICAgfVxuXG4gICAgICBhd2FpdCB0aGlzLl9hZnRlck1pZ3JhdGlvbnMoKVxuICAgIH0pXG5cbiAgICByZXR1cm4gYXBwbGllZENvdW50XG4gIH1cblxuICAvKipcbiAgICogUnVucyBtaWdyYXRlIGZpbGVzIGZyb20gcmVxdWlyZSBjb250ZXh0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vbWlncmF0b3IvdHlwZXMuanNcIikuUmVxdWlyZU1pZ3JhdGlvbkNvbnRleHRUeXBlfSByZXF1aXJlQ29udGV4dCAtIFJlcXVpcmUgY29udGV4dC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIG1pZ3JhdGVGaWxlc0Zyb21SZXF1aXJlQ29udGV4dChyZXF1aXJlQ29udGV4dCkge1xuICAgIGNvbnN0IGZpbGVzID0gdGhpcy5taWdyYXRpb25zRnJvbVJlcXVpcmVDb250ZXh0KHJlcXVpcmVDb250ZXh0KVxuXG4gICAgYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLmVuc3VyZUNvbm5lY3Rpb25zKHtkYXRhYmFzZUlkZW50aWZpZXJzOiB0aGlzLmRhdGFiYXNlSWRlbnRpZmllcnMsIG5hbWU6IFwiRGF0YWJhc2UgbWlncmF0b3I6IG1pZ3JhdGUgcmVxdWlyZS1jb250ZXh0IGZpbGVzXCJ9LCBhc3luYyAoKSA9PiB7XG4gICAgICBmb3IgKGNvbnN0IG1pZ3JhdGlvbiBvZiBmaWxlcykge1xuICAgICAgICBhd2FpdCB0aGlzLnJ1bk1pZ3JhdGlvbkZpbGUoe1xuICAgICAgICAgIG1pZ3JhdGlvbixcbiAgICAgICAgICByZXF1aXJlTWlncmF0aW9uOiBhc3luYyAoKSA9PiByZXF1aXJlQ29udGV4dChtaWdyYXRpb24uZmlsZSkuZGVmYXVsdFxuICAgICAgICB9KVxuICAgICAgfVxuXG4gICAgICBhd2FpdCB0aGlzLl9hZnRlck1pZ3JhdGlvbnMoKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogTWlncmF0ZXMgZXhhY3RseSBvbmUgYWxyZWFkeS1jYXB0dXJlZCBwaHlzaWNhbCBkYXRhYmFzZS4gVGhpcyBpcyB0aGVcbiAgICogZnJvbnRlbmQvdGVuYW50IGNvdW50ZXJwYXJ0IHRvIHRoZSBhbWJpZW50IG11bHRpLWRhdGFiYXNlIGVudHJ5cG9pbnRzOlxuICAgKiBjYWxsZXJzIG93biB0aGUgY2FwdHVyZWQgY29ubmVjdGlvbiBhbmQgbm8gY29uZmlndXJhdGlvbiBmYWxsYmFjayBpcyByZWFkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIENhcHR1cmVkIG1pZ3JhdGlvbiBhcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlfSBhcmdzLmRhdGFiYXNlQ29uZmlndXJhdGlvbiAtIENhcHR1cmVkIHBoeXNpY2FsIGRhdGFiYXNlIGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmRhdGFiYXNlSWRlbnRpZmllciAtIExvZ2ljYWwgZGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBhcmdzLmRiIC0gQ2FwdHVyZWQgcGh5c2ljYWwgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL21pZ3JhdG9yL3R5cGVzLmpzXCIpLlJlcXVpcmVNaWdyYXRpb25Db250ZXh0VHlwZX0gYXJncy5yZXF1aXJlQ29udGV4dCAtIEZyb250ZW5kIG1pZ3JhdGlvbiByZXF1aXJlIGNvbnRleHQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IC0gTnVtYmVyIG9mIG5ld2x5IGFwcGxpZWQgbWlncmF0aW9ucy5cbiAgICovXG4gIGFzeW5jIG1pZ3JhdGVSZXF1aXJlQ29udGV4dEZvckRhdGFiYXNlKHtkYXRhYmFzZUNvbmZpZ3VyYXRpb24sIGRhdGFiYXNlSWRlbnRpZmllciwgZGIsIHJlcXVpcmVDb250ZXh0fSkge1xuICAgIGlmICghZGF0YWJhc2VDb25maWd1cmF0aW9uLm1pZ3JhdGlvbnMpIHJldHVybiAwXG5cbiAgICBhd2FpdCBNaWdyYXRpb25zTGVkZ2VyLmVuc3VyZVRhYmxlKGRiKVxuICAgIGNvbnN0IGFwcGxpZWRWZXJzaW9ucyA9IG5ldyBTZXQoYXdhaXQgTWlncmF0aW9uc0xlZGdlci5hcHBsaWVkVmVyc2lvbnMoZGIpKVxuICAgIGNvbnN0IG1pZ3JhdGlvbnMgPSB0aGlzLm1pZ3JhdGlvbnNGcm9tUmVxdWlyZUNvbnRleHQocmVxdWlyZUNvbnRleHQpXG4gICAgbGV0IGFwcGxpZWRDb3VudCA9IDBcblxuICAgIGZvciAoY29uc3QgbWlncmF0aW9uIG9mIG1pZ3JhdGlvbnMpIHtcbiAgICAgIGNvbnN0IHZlcnNpb24gPSBgJHttaWdyYXRpb24uZGF0ZX1gXG5cbiAgICAgIGlmIChhcHBsaWVkVmVyc2lvbnMuaGFzKHZlcnNpb24pKSBjb250aW51ZVxuXG4gICAgICBjb25zdCBNaWdyYXRpb25DbGFzcyA9IHJlcXVpcmVDb250ZXh0KG1pZ3JhdGlvbi5maWxlKS5kZWZhdWx0XG5cbiAgICAgIGlmICghTWlncmF0aW9uQ2xhc3MgfHwgdHlwZW9mIE1pZ3JhdGlvbkNsYXNzICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBNaWdyYXRpb24gJHttaWdyYXRpb24uZmlsZX0gbXVzdCBleHBvcnQgYSBkZWZhdWx0IG1pZ3JhdGlvbiBjbGFzcy4gVHlwZTogJHt0eXBlb2YgTWlncmF0aW9uQ2xhc3N9YClcbiAgICAgIH1cbiAgICAgIGlmICghKE1pZ3JhdGlvbkNsYXNzLmdldERhdGFiYXNlSWRlbnRpZmllcnMoKSB8fCBbXCJkZWZhdWx0XCJdKS5pbmNsdWRlcyhkYXRhYmFzZUlkZW50aWZpZXIpKSBjb250aW51ZVxuXG4gICAgICBjb25zdCBtaWdyYXRpb25JbnN0YW5jZSA9IG5ldyBNaWdyYXRpb25DbGFzcyh7Y29uZmlndXJhdGlvbjogdGhpcy5jb25maWd1cmF0aW9uLCBkYXRhYmFzZUlkZW50aWZpZXIsIGRifSlcblxuICAgICAgYXdhaXQgdGhpcy5ydW5NaWdyYXRpb25VcCh7bWlncmF0aW9uLCBtaWdyYXRpb25JbnN0YW5jZX0pXG4gICAgICBhd2FpdCBNaWdyYXRpb25zTGVkZ2VyLnJlY29yZFZlcnNpb24oZGIsIHZlcnNpb24pXG4gICAgICBhcHBsaWVkVmVyc2lvbnMuYWRkKHZlcnNpb24pXG4gICAgICBhcHBsaWVkQ291bnQrK1xuICAgIH1cblxuICAgIHJldHVybiBhcHBsaWVkQ291bnRcbiAgfVxuXG4gIC8qKlxuICAgKiBQYXJzZXMgYW5kIG9yZGVycyBtaWdyYXRpb25zIGZyb20gYSBicm93c2VyL25hdGl2ZSByZXF1aXJlIGNvbnRleHQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9taWdyYXRvci90eXBlcy5qc1wiKS5SZXF1aXJlTWlncmF0aW9uQ29udGV4dFR5cGV9IHJlcXVpcmVDb250ZXh0IC0gTWlncmF0aW9uIHJlcXVpcmUgY29udGV4dC5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vbWlncmF0b3IvdHlwZXMuanNcIikuTWlncmF0aW9uT2JqZWN0VHlwZVtdfSAtIE9yZGVyZWQgbWlncmF0aW9ucy5cbiAgICovXG4gIG1pZ3JhdGlvbnNGcm9tUmVxdWlyZUNvbnRleHQocmVxdWlyZUNvbnRleHQpIHtcbiAgICBjb25zdCBtaWdyYXRpb25zID0gW11cblxuICAgIGZvciAoY29uc3QgZmlsZSBvZiByZXF1aXJlQ29udGV4dC5rZXlzKCkpIHtcbiAgICAgIGNvbnN0IG1hdGNoID0gZmlsZS5tYXRjaCgvKFxcZHsxMywxNH0pLSguKylcXC5qcyQvKVxuXG4gICAgICBpZiAoIW1hdGNoKSBjb250aW51ZVxuXG4gICAgICBsZXQgZmlsZU5hbWUgPSBmaWxlXG4gICAgICBsZXQgZGF0ZU51bWJlciA9IG1hdGNoWzFdXG5cbiAgICAgIGlmIChkYXRlTnVtYmVyLmxlbmd0aCA9PSAxMykge1xuICAgICAgICBkYXRlTnVtYmVyID0gYDIke2RhdGVOdW1iZXJ9YFxuICAgICAgICBmaWxlTmFtZSA9IGAyJHtmaWxlTmFtZX1gXG4gICAgICB9XG5cbiAgICAgIG1pZ3JhdGlvbnMucHVzaCh7XG4gICAgICAgIGRhdGU6IHBhcnNlSW50KGRhdGVOdW1iZXIpLFxuICAgICAgICBmaWxlOiBmaWxlTmFtZSxcbiAgICAgICAgbWlncmF0aW9uQ2xhc3NOYW1lOiBpbmZsZWN0aW9uLmNhbWVsaXplKG1hdGNoWzJdLnJlcGxhY2VBbGwoXCItXCIsIFwiX1wiKSlcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgcmV0dXJuIG1pZ3JhdGlvbnMuc29ydCgobWlncmF0aW9uMSwgbWlncmF0aW9uMikgPT4gbWlncmF0aW9uMS5kYXRlIC0gbWlncmF0aW9uMi5kYXRlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgb25lIG1pZ3JhdGlvbidzIHVwd2FyZCBpbXBsZW1lbnRhdGlvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBNaWdyYXRpb24gYXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vbWlncmF0b3IvdHlwZXMuanNcIikuTWlncmF0aW9uT2JqZWN0VHlwZX0gYXJncy5taWdyYXRpb24gLSBNaWdyYXRpb24gZGVzY3JpcHRvci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL21pZ3JhdGlvbi9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1pZ3JhdGlvbkluc3RhbmNlIC0gTWlncmF0aW9uIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciB0aGUgbWlncmF0aW9uIHN1Y2NlZWRzLlxuICAgKi9cbiAgYXN5bmMgcnVuTWlncmF0aW9uVXAoe21pZ3JhdGlvbiwgbWlncmF0aW9uSW5zdGFuY2V9KSB7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IG1pZ3JhdGlvbkluc3RhbmNlLmNoYW5nZSgpXG4gICAgfSBjYXRjaCAoY2hhbmdlRXJyb3IpIHtcbiAgICAgIGlmICghKGNoYW5nZUVycm9yIGluc3RhbmNlb2YgTm90SW1wbGVtZW50ZWRFcnJvcikpIHRocm93IGNoYW5nZUVycm9yXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IG1pZ3JhdGlvbkluc3RhbmNlLnVwKClcbiAgICAgIH0gY2F0Y2ggKHVwRXJyb3IpIHtcbiAgICAgICAgaWYgKHVwRXJyb3IgaW5zdGFuY2VvZiBOb3RJbXBsZW1lbnRlZEVycm9yKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGAnY2hhbmdlJyBvciAndXAnIGRpZG4ndCBleGlzdCBvbiBtaWdyYXRpb246ICR7bWlncmF0aW9uLmZpbGV9YCwge2NhdXNlOiB1cEVycm9yfSlcbiAgICAgICAgfVxuXG4gICAgICAgIHRocm93IHVwRXJyb3JcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBhZnRlciBtaWdyYXRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX2FmdGVyTWlncmF0aW9ucygpIHtcbiAgICBjb25zdCBlbnZpcm9ubWVudEhhbmRsZXIgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RW52aXJvbm1lbnRIYW5kbGVyKClcbiAgICBjb25zdCBkYnMgPSBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0Q3VycmVudENvbm5lY3Rpb25zKClcbiAgICBjb25zdCBmaWx0ZXJlZERicyA9IE9iamVjdC5mcm9tRW50cmllcyhcbiAgICAgIE9iamVjdC5lbnRyaWVzKGRicykuZmlsdGVyKChbZGJJZGVudGlmaWVyXSkgPT4ge1xuICAgICAgICBpZiAoIXRoaXMuaGFuZGxlc0RhdGFiYXNlSWRlbnRpZmllcihkYklkZW50aWZpZXIpKSByZXR1cm4gZmFsc2VcblxuICAgICAgICByZXR1cm4gQm9vbGVhbih0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RGF0YWJhc2VJZGVudGlmaWVyKGRiSWRlbnRpZmllcikubWlncmF0aW9ucylcbiAgICAgIH0pXG4gICAgKVxuXG4gICAgaWYgKCFlbnZpcm9ubWVudEhhbmRsZXIgfHwgT2JqZWN0LmtleXMoZmlsdGVyZWREYnMpLmxlbmd0aCA9PSAwKSByZXR1cm5cblxuICAgIC8vIEVuc3VyZSBWZWxvY2lvdXMnIG93biBmcmFtZXdvcmsgc2NoZW1hIGJlZm9yZSB0aGUgc3RydWN0dXJlIGR1bXAuIFRoZSBkdW1wIGlzXG4gICAgLy8gZ2F0ZWQgdG8gZW5hYmxlZCBlbnZpcm9ubWVudHMsIGJ1dCBtaWdyYXRpb24tZW5hYmxlZCBkYXRhYmFzZXMgbXVzdCBpbmNsdWRlXG4gICAgLy8gZnJhbWV3b3JrIHRhYmxlcyBzbyBgZGI6bWlncmF0ZWAgYW5kIHNjaGVtYTpsb2FkIHByb2R1Y2UgYSBjb21wbGV0ZSBkYXRhYmFzZS5cbiAgICBhd2FpdCBlbnZpcm9ubWVudEhhbmRsZXIuZW5zdXJlRnJhbWV3b3JrU2NoZW1hKHtkYnM6IGZpbHRlcmVkRGJzfSlcbiAgICBhd2FpdCBlbnZpcm9ubWVudEhhbmRsZXIuYWZ0ZXJNaWdyYXRpb25zKHtkYnM6IGZpbHRlcmVkRGJzfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGxvYWQgbWlncmF0aW9ucyB2ZXJzaW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGxvYWRNaWdyYXRpb25zVmVyc2lvbnMoKSB7XG4gICAgdGhpcy5taWdyYXRpb25zVmVyc2lvbnMgPSB7fVxuXG4gICAgY29uc3QgZGJzID0gYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLmdldEN1cnJlbnRDb25uZWN0aW9ucygpXG5cbiAgICBmb3IgKGNvbnN0IGRiSWRlbnRpZmllciBpbiBkYnMpIHtcbiAgICAgIGlmICghdGhpcy5oYW5kbGVzRGF0YWJhc2VJZGVudGlmaWVyKGRiSWRlbnRpZmllcikpIGNvbnRpbnVlXG5cbiAgICAgIGF3YWl0IHRoaXMubG9hZE1pZ3JhdGlvbnNWZXJzaW9uc0ZvckRhdGFiYXNlKHtkYklkZW50aWZpZXIsIGRiOiBkYnNbZGJJZGVudGlmaWVyXX0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbG9hZCBtaWdyYXRpb25zIHZlcnNpb25zIGZvciBkYXRhYmFzZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuZGJJZGVudGlmaWVyIC0gRGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBhcmdzLmRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGxvYWRNaWdyYXRpb25zVmVyc2lvbnNGb3JEYXRhYmFzZSh7ZGJJZGVudGlmaWVyLCBkYn0pIHtcbiAgICBjb25zdCBkYXRhYmFzZUNvbmZpZ3VyYXRpb24gPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RGF0YWJhc2VJZGVudGlmaWVyKGRiSWRlbnRpZmllcilcblxuICAgIGlmICghZGF0YWJhc2VDb25maWd1cmF0aW9uLm1pZ3JhdGlvbnMpIHtcbiAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGAke2RiSWRlbnRpZmllcn0gaXNuJ3QgY29uZmlndXJlZCBmb3IgbWlncmF0aW9ucyAtIHNraXBwaW5nIGxvYWRpbmcgbWlncmF0aW9ucyB2ZXJzaW9ucyBmb3IgaXRgKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKCFhd2FpdCB0aGlzLm1pZ3JhdGlvbnNUYWJsZUV4aXN0KGRiKSkge1xuICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgTWlncmF0aW9uIHRhYmxlIGRvZXMgbm90IGV4aXN0IGZvciAke2RiSWRlbnRpZmllcn0gLSBza2lwcGluZyBsb2FkaW5nIG1pZ3JhdGlvbnMgdmVyc2lvbnMgZm9yIGl0YClcbiAgICAgIGRlbGV0ZSB0aGlzLm1pZ3JhdGlvbnNWZXJzaW9uc1tkYklkZW50aWZpZXJdXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCB2ZXJzaW9ucyA9IGF3YWl0IE1pZ3JhdGlvbnNMZWRnZXIuYXBwbGllZFZlcnNpb25zKGRiKVxuXG4gICAgdGhpcy5taWdyYXRpb25zVmVyc2lvbnNbZGJJZGVudGlmaWVyXSA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IHZlcnNpb24gb2YgdmVyc2lvbnMpIHtcbiAgICAgIHRoaXMubWlncmF0aW9uc1ZlcnNpb25zW2RiSWRlbnRpZmllcl1bdmVyc2lvbl0gPSB0cnVlXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbWlncmF0aW9ucyB0YWJsZSBleGlzdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFJlc29sdmVzIHdpdGggV2hldGhlciBtaWdyYXRpb25zIHRhYmxlIGV4aXN0LlxuICAgKi9cbiAgYXN5bmMgbWlncmF0aW9uc1RhYmxlRXhpc3QoZGIpIHtcbiAgICByZXR1cm4gYXdhaXQgTWlncmF0aW9uc0xlZGdlci50YWJsZUV4aXN0cyhkYilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGV4ZWN1dGUgcmVxdWlyZSBjb250ZXh0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vbWlncmF0b3IvdHlwZXMuanNcIikuUmVxdWlyZU1pZ3JhdGlvbkNvbnRleHRUeXBlfSByZXF1aXJlQ29udGV4dCAtIFJlcXVpcmUgY29udGV4dC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGV4ZWN1dGVSZXF1aXJlQ29udGV4dChyZXF1aXJlQ29udGV4dCkge1xuICAgIGNvbnN0IG1pZ3JhdGlvbkZpbGVzID0gcmVxdWlyZUNvbnRleHQua2V5cygpXG5cbiAgICAvKipcbiAgICAgKiBGaWxlcy5cbiAgICAgKiBAdHlwZSB7aW1wb3J0KFwiLi9taWdyYXRvci90eXBlcy5qc1wiKS5NaWdyYXRpb25PYmplY3RUeXBlW119ICovXG4gICAgbGV0IGZpbGVzID0gW11cblxuICAgIGZvciAoY29uc3QgZmlsZSBvZiBtaWdyYXRpb25GaWxlcykge1xuICAgICAgY29uc3QgbWF0Y2ggPSBmaWxlLm1hdGNoKC9eKFxcZHsxNH0pLSguKylcXC5qcyQvKVxuXG4gICAgICBpZiAoIW1hdGNoKSBjb250aW51ZVxuXG4gICAgICBjb25zdCBkYXRlID0gcGFyc2VJbnQobWF0Y2hbMV0pXG4gICAgICBjb25zdCBtaWdyYXRpb25OYW1lID0gbWF0Y2hbMl1cbiAgICAgIGNvbnN0IG1pZ3JhdGlvbkNsYXNzTmFtZSA9IGluZmxlY3Rpb24uY2FtZWxpemUobWlncmF0aW9uTmFtZSlcblxuICAgICAgY29uc3QgbWlncmF0aW9uT2JqZWN0ID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuL21pZ3JhdG9yL3R5cGVzLmpzXCIpLk1pZ3JhdGlvbk9iamVjdFR5cGV9ICovICh7XG4gICAgICAgIGZpbGUsXG4gICAgICAgIGRhdGUsXG4gICAgICAgIG1pZ3JhdGlvbkNsYXNzTmFtZVxuICAgICAgfSlcblxuICAgICAgZmlsZXMucHVzaChtaWdyYXRpb25PYmplY3QpXG4gICAgfVxuXG4gICAgZmlsZXMgPSBmaWxlcy5zb3J0KChtaWdyYXRpb24xLCBtaWdyYXRpb24yKSA9PiBtaWdyYXRpb24xLmRhdGUgLSBtaWdyYXRpb24yLmRhdGUpXG5cbiAgICBmb3IgKGNvbnN0IG1pZ3JhdGlvbiBvZiBmaWxlcykge1xuICAgICAgYXdhaXQgdGhpcy5ydW5NaWdyYXRpb25GaWxlKHtcbiAgICAgICAgbWlncmF0aW9uLFxuICAgICAgICByZXF1aXJlTWlncmF0aW9uOiBhc3luYyAoKSA9PiByZXF1aXJlQ29udGV4dChtaWdyYXRpb24uZmlsZSkuZGVmYXVsdFxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXNldC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHJlc2V0KCkge1xuICAgIGNvbnN0IGRicyA9IGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5nZXRDdXJyZW50Q29ubmVjdGlvbnMoKVxuXG4gICAgZm9yIChjb25zdCBkYklkZW50aWZpZXIgaW4gZGJzKSB7XG4gICAgICBpZiAoIXRoaXMuaGFuZGxlc0RhdGFiYXNlSWRlbnRpZmllcihkYklkZW50aWZpZXIpKSBjb250aW51ZVxuXG4gICAgICBjb25zdCBkYiA9IGRic1tkYklkZW50aWZpZXJdXG5cbiAgICAgIGF3YWl0IGRiLndpdGhEaXNhYmxlZEZvcmVpZ25LZXlzKGFzeW5jICgpID0+IHtcbiAgICAgICAgd2hpbGUgKHRydWUpIHtcbiAgICAgICAgICBjb25zdCBlcnJvcnMgPSBbXVxuICAgICAgICAgIGxldCBhbnlUYWJsZURyb3BwZWQgPSBmYWxzZVxuXG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGZvciAoY29uc3QgdGFibGUgb2YgYXdhaXQgZGIuZ2V0VGFibGVzKCkpIHtcbiAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgRHJvcHBpbmcgdGFibGUgJHt0YWJsZS5nZXROYW1lKCl9YClcblxuICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIGF3YWl0IGRiLmRyb3BUYWJsZSh0YWJsZS5nZXROYW1lKCksIHtjYXNjYWRlOiB0cnVlfSlcbiAgICAgICAgICAgICAgICBhbnlUYWJsZURyb3BwZWQgPSB0cnVlXG4gICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgZXJyb3JzLnB1c2goZXJyb3IpXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgYnJlYWtcbiAgICAgICAgICB9IGNhdGNoIChlcnJvcikgeyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIG5vLXVudXNlZC12YXJzXG4gICAgICAgICAgICBpZiAoZXJyb3JzLmxlbmd0aCA+IDAgJiYgYW55VGFibGVEcm9wcGVkKSB7XG4gICAgICAgICAgICAgIC8vIFJldHJ5XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICB0aHJvdyBlcnJvcnNbMF1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcm9sbGJhY2suXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9taWdyYXRvci90eXBlcy5qc1wiKS5NaWdyYXRpb25PYmplY3RUeXBlW119IGZpbGVzIC0gRmlsZXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9taWdyYXRvci90eXBlcy5qc1wiKS5JbXBvcnRGdWxscGF0aENhbGxiYWNrVHlwZX0gaW1wb3J0Q2FsbGJhY2sgRnVuY3Rpb24gdG8gaW1wb3J0IGEgZmlsZVxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgcm9sbGJhY2soZmlsZXMsIGltcG9ydENhbGxiYWNrKSB7XG4gICAgY29uc3QgbGF0ZXN0TWlncmF0aW9uVmVyc2lvbiA9IGF3YWl0IHRoaXMuX2xhdGVzdE1pZ3JhdGlvblZlcnNpb24oKVxuXG4gICAgaWYgKCFsYXRlc3RNaWdyYXRpb25WZXJzaW9uKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJObyBtaWdyYXRpb25zIGhhdmUgYmVlbiBydW4geWV0XCIpXG4gICAgfVxuXG4gICAgY29uc3QgbGF0ZXN0TWlncmF0aW9uVmVyc2lvbk51bWJlciA9IHBhcnNlSW50KGxhdGVzdE1pZ3JhdGlvblZlcnNpb24pXG4gICAgY29uc3QgbWlncmF0aW9uID0gZmlsZXMuZmluZCgoZmlsZSkgPT4gZmlsZS5kYXRlID09IGxhdGVzdE1pZ3JhdGlvblZlcnNpb25OdW1iZXIpXG5cbiAgICBpZiAoIW1pZ3JhdGlvbikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBNaWdyYXRpb24gZmlsZSBmb3IgdmVyc2lvbiAke2xhdGVzdE1pZ3JhdGlvblZlcnNpb25OdW1iZXJ9IG5vdCBmb3VuZGApXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5ydW5NaWdyYXRpb25GaWxlKHtcbiAgICAgIG1pZ3JhdGlvbixcbiAgICAgIHJlcXVpcmVNaWdyYXRpb246IGFzeW5jICgpID0+IHtcbiAgICAgICAgaWYgKCFtaWdyYXRpb24uZnVsbFBhdGgpIHRocm93IG5ldyBFcnJvcihgTWlncmF0aW9uIGRpZG4ndCBoYXZlIGEgZnVsbFBhdGgga2V5OiAke09iamVjdC5rZXlzKG1pZ3JhdGlvbikuam9pbihcIiwgXCIpfWApXG5cbiAgICAgICAgcmV0dXJuIGF3YWl0IGltcG9ydENhbGxiYWNrKG1pZ3JhdGlvbi5mdWxsUGF0aClcbiAgICAgIH0sXG4gICAgICBkaXJlY3Rpb246IFwiZG93blwiXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGxhdGVzdCBtaWdyYXRpb24gdmVyc2lvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nIHwgdW5kZWZpbmVkPn0gVGhlIGxhdGVzdCBtaWdyYXRpb24gdmVyc2lvblxuICAgKi9cbiAgYXN5bmMgX2xhdGVzdE1pZ3JhdGlvblZlcnNpb24oKSB7XG4gICAgaWYgKCF0aGlzLm1pZ3JhdGlvbnNWZXJzaW9ucykgYXdhaXQgdGhpcy5sb2FkTWlncmF0aW9uc1ZlcnNpb25zKClcblxuICAgIC8qKlxuICAgICAqIERlZmluZXMgaGlnaGVzdFZlcnNpb24uXG4gICAgICogQHR5cGUge3N0cmluZyB8IHVuZGVmaW5lZH0gKi9cbiAgICBsZXQgaGlnaGVzdFZlcnNpb25cblxuICAgIGZvciAoY29uc3QgZGJJZGVudGlmaWVyIGluIHRoaXMubWlncmF0aW9uc1ZlcnNpb25zKSB7XG4gICAgICBmb3IgKGNvbnN0IG1pZ3JhdGlvblZlcnNpb24gaW4gdGhpcy5taWdyYXRpb25zVmVyc2lvbnNbZGJJZGVudGlmaWVyXSkge1xuICAgICAgICBpZiAoIWhpZ2hlc3RWZXJzaW9uIHx8IG1pZ3JhdGlvblZlcnNpb24gPiBoaWdoZXN0VmVyc2lvbikge1xuICAgICAgICAgIGhpZ2hlc3RWZXJzaW9uID0gbWlncmF0aW9uVmVyc2lvblxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGhpZ2hlc3RWZXJzaW9uXG4gIH1cblxuICAvKipcbiAgICogUnVucyBydW4gbWlncmF0aW9uIGZpbGUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9taWdyYXRvci90eXBlcy5qc1wiKS5NaWdyYXRpb25PYmplY3RUeXBlfSBhcmdzLm1pZ3JhdGlvbiAtIE1pZ3JhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL21pZ3JhdG9yL3R5cGVzLmpzXCIpLlJlcXVpcmVNaWdyYXRpb25UeXBlfSBhcmdzLnJlcXVpcmVNaWdyYXRpb24gLSBSZXF1aXJlIG1pZ3JhdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFthcmdzLmRpcmVjdGlvbl0gLSBEaXJlY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgdGhlIG1pZ3JhdGlvbiByYW4gb24gYXQgbGVhc3Qgb25lIGRhdGFiYXNlIChmYWxzZSBpZiBza2lwcGVkIGFzIGFscmVhZHktcnVuIGV2ZXJ5d2hlcmUpLlxuICAgKi9cbiAgYXN5bmMgcnVuTWlncmF0aW9uRmlsZSh7bWlncmF0aW9uLCByZXF1aXJlTWlncmF0aW9uLCBkaXJlY3Rpb24gPSBcInVwXCJ9KSB7XG4gICAgaWYgKCF0aGlzLmNvbmZpZ3VyYXRpb24pIHRocm93IG5ldyBFcnJvcihcIk5vIGNvbmZpZ3VyYXRpb24gc2V0XCIpXG4gICAgaWYgKCF0aGlzLmNvbmZpZ3VyYXRpb24uaXNEYXRhYmFzZVBvb2xJbml0aWFsaXplZCgpKSBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24uaW5pdGlhbGl6ZURhdGFiYXNlUG9vbCgpXG4gICAgaWYgKCF0aGlzLm1pZ3JhdGlvbnNWZXJzaW9ucykgYXdhaXQgdGhpcy5sb2FkTWlncmF0aW9uc1ZlcnNpb25zKClcblxuICAgIGxldCBhcHBsaWVkID0gZmFsc2VcbiAgICBjb25zdCBkYnMgPSBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0Q3VycmVudENvbm5lY3Rpb25zKClcblxuICAgIC8qKlxuICAgICAqIERiIGlkZW50aWZpZXJzIG5lZWRpbmcgbWlncmF0aW9uIHZlcnNpb25zLlxuICAgICAqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgICBjb25zdCBkYklkZW50aWZpZXJzTmVlZGluZ01pZ3JhdGlvblZlcnNpb25zID0gW11cblxuICAgIC8vIG1pZ3JhdGVGaWxlcygpIHdyYXBzIGV4ZWN1dGlvbiBpbiBlbnN1cmVDb25uZWN0aW9ucygpLCBzbyB0aGUgY3VycmVudFxuICAgIC8vIGFzeW5jIGNvbnRleHQgY2FuIGV4cG9zZSBEQiBpZGVudGlmaWVycyBub3QgbG9hZGVkIGJ5IHByZXBhcmUoKS5cbiAgICBmb3IgKGNvbnN0IGRiSWRlbnRpZmllciBpbiBkYnMpIHtcbiAgICAgIGlmICghdGhpcy5oYW5kbGVzRGF0YWJhc2VJZGVudGlmaWVyKGRiSWRlbnRpZmllcikpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IGRhdGFiYXNlQ29uZmlndXJhdGlvbiA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXREYXRhYmFzZUlkZW50aWZpZXIoZGJJZGVudGlmaWVyKVxuXG4gICAgICBpZiAoIWRhdGFiYXNlQ29uZmlndXJhdGlvbi5taWdyYXRpb25zKSBjb250aW51ZVxuICAgICAgaWYgKHRoaXMubWlncmF0aW9uc1ZlcnNpb25zW2RiSWRlbnRpZmllcl0pIGNvbnRpbnVlXG5cbiAgICAgIGRiSWRlbnRpZmllcnNOZWVkaW5nTWlncmF0aW9uVmVyc2lvbnMucHVzaChkYklkZW50aWZpZXIpXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBkYklkZW50aWZpZXIgb2YgZGJJZGVudGlmaWVyc05lZWRpbmdNaWdyYXRpb25WZXJzaW9ucykge1xuICAgICAgY29uc3QgZGIgPSBkYnNbZGJJZGVudGlmaWVyXVxuXG4gICAgICBhd2FpdCB0aGlzLmNyZWF0ZU1pZ3JhdGlvbnNUYWJsZUZvckRhdGFiYXNlKHtkYklkZW50aWZpZXIsIGRifSlcbiAgICAgIGF3YWl0IHRoaXMubG9hZE1pZ3JhdGlvbnNWZXJzaW9uc0ZvckRhdGFiYXNlKHtkYklkZW50aWZpZXIsIGRifSlcbiAgICB9XG5cbiAgICBjb25zdCBtaWdyYXRpb25DbGFzcyA9IGF3YWl0IHJlcXVpcmVNaWdyYXRpb24oKVxuXG4gICAgaWYgKCFtaWdyYXRpb25DbGFzcyB8fCB0eXBlb2YgbWlncmF0aW9uQ2xhc3MgIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBNaWdyYXRpb24gJHttaWdyYXRpb24uZmlsZX0gbXVzdCBleHBvcnQgYSBkZWZhdWx0IG1pZ3JhdGlvbiBjbGFzcy4gVHlwZTogJHt0eXBlb2YgbWlncmF0aW9uQ2xhc3N9YClcbiAgICB9XG5cbiAgICBjb25zdCBtaWdyYXRpb25EYXRhYmFzZUlkZW50aWZpZXJzID0gbWlncmF0aW9uQ2xhc3MuZ2V0RGF0YWJhc2VJZGVudGlmaWVycygpIHx8IFtcImRlZmF1bHRcIl1cblxuICAgIGZvciAoY29uc3QgZGJJZGVudGlmaWVyIGluIGRicykge1xuICAgICAgaWYgKCF0aGlzLmhhbmRsZXNEYXRhYmFzZUlkZW50aWZpZXIoZGJJZGVudGlmaWVyKSkgY29udGludWVcblxuICAgICAgY29uc3QgZGF0YWJhc2VDb25maWd1cmF0aW9uID0gdGhpcy5jb25maWd1cmF0aW9uLmdldERhdGFiYXNlSWRlbnRpZmllcihkYklkZW50aWZpZXIpXG5cbiAgICAgIGlmICghZGF0YWJhc2VDb25maWd1cmF0aW9uLm1pZ3JhdGlvbnMpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYCR7ZGJJZGVudGlmaWVyfSBpc24ndCBjb25maWd1cmVkIGZvciBtaWdyYXRpb25zIC0gc2tpcHBpbmcgbWlncmF0aW9uICR7ZGlnZyhtaWdyYXRpb24sIFwiZGF0ZVwiKX1gKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoIW1pZ3JhdGlvbkRhdGFiYXNlSWRlbnRpZmllcnMuaW5jbHVkZXMoZGJJZGVudGlmaWVyKSkge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgJHtkYklkZW50aWZpZXJ9IHNob3VsZG4ndCBydW4gbWlncmF0aW9uICR7bWlncmF0aW9uLmZpbGV9YCwge21pZ3JhdGlvbkRhdGFiYXNlSWRlbnRpZmllcnN9KVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoZGlyZWN0aW9uID09IFwidXBcIikge1xuICAgICAgICBpZiAodGhpcy5oYXNSdW5NaWdyYXRpb25WZXJzaW9uKGRiSWRlbnRpZmllciwgbWlncmF0aW9uLmRhdGUpKSB7XG4gICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYCR7ZGJJZGVudGlmaWVyfSBoYXMgYWxyZWFkeSBydW4gbWlncmF0aW9uICR7bWlncmF0aW9uLmZpbGV9YClcbiAgICAgICAgICBjb250aW51ZVxuICAgICAgICB9XG4gICAgICB9IGVsc2UgaWYgKGRpcmVjdGlvbiA9PSBcImRvd25cIikge1xuICAgICAgICBpZiAoIXRoaXMuaGFzUnVuTWlncmF0aW9uVmVyc2lvbihkYklkZW50aWZpZXIsIG1pZ3JhdGlvbi5kYXRlKSkge1xuICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGAke2RiSWRlbnRpZmllcn0gaGFzbid0IHJ1biBtaWdyYXRpb24gJHttaWdyYXRpb24uZmlsZX1gKVxuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBkaXJlY3Rpb246ICR7ZGlyZWN0aW9ufWApXG4gICAgICB9XG5cbiAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGBSdW5uaW5nIG1pZ3JhdGlvbiBvbiAke2RiSWRlbnRpZmllcn06ICR7bWlncmF0aW9uLmZpbGV9YCwge21pZ3JhdGlvbkRhdGFiYXNlSWRlbnRpZmllcnN9KVxuXG4gICAgICBhcHBsaWVkID0gdHJ1ZVxuICAgICAgY29uc3QgZGIgPSBkYnNbZGJJZGVudGlmaWVyXVxuICAgICAgY29uc3QgTWlncmF0aW9uQ2xhc3MgPSBtaWdyYXRpb25DbGFzc1xuICAgICAgY29uc3QgbWlncmF0aW9uSW5zdGFuY2UgPSBuZXcgTWlncmF0aW9uQ2xhc3Moe1xuICAgICAgICBjb25maWd1cmF0aW9uOiB0aGlzLmNvbmZpZ3VyYXRpb24sXG4gICAgICAgIGRhdGFiYXNlSWRlbnRpZmllcjogZGJJZGVudGlmaWVyLFxuICAgICAgICBkYlxuICAgICAgfSlcbiAgICAgIGNvbnN0IGRhdGVTdHJpbmcgPSBgJHtkaWdnKG1pZ3JhdGlvbiwgXCJkYXRlXCIpfWBcblxuICAgICAgaWYgKGRpcmVjdGlvbiA9PSBcInVwXCIpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBhd2FpdCBtaWdyYXRpb25JbnN0YW5jZS5jaGFuZ2UoKVxuICAgICAgICB9IGNhdGNoIChjaGFuZ2VFcnJvcikge1xuICAgICAgICAgIGlmIChjaGFuZ2VFcnJvciBpbnN0YW5jZW9mIE5vdEltcGxlbWVudGVkRXJyb3IpIHtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgIGF3YWl0IG1pZ3JhdGlvbkluc3RhbmNlLnVwKClcbiAgICAgICAgICAgIH0gY2F0Y2ggKHVwRXJyb3IpIHtcbiAgICAgICAgICAgICAgaWYgKHVwRXJyb3IgaW5zdGFuY2VvZiBOb3RJbXBsZW1lbnRlZEVycm9yKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGAnY2hhbmdlJyBvciAndXAnIGRpZG4ndCBleGlzdCBvbiBtaWdyYXRpb246ICR7bWlncmF0aW9uLmZpbGV9YCwge2NhdXNlOiB1cEVycm9yfSlcbiAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB0aHJvdyB1cEVycm9yXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhyb3cgY2hhbmdlRXJyb3JcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBhd2FpdCBNaWdyYXRpb25zTGVkZ2VyLnJlY29yZFZlcnNpb24oZGIsIGRhdGVTdHJpbmcpXG4gICAgICB9IGVsc2UgaWYgKGRpcmVjdGlvbiA9PSBcImRvd25cIikge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGF3YWl0IG1pZ3JhdGlvbkluc3RhbmNlLmRvd24oKVxuICAgICAgICB9IGNhdGNoIChkb3duRXJyb3IpIHtcbiAgICAgICAgICBpZiAoZG93bkVycm9yIGluc3RhbmNlb2YgTm90SW1wbGVtZW50ZWRFcnJvcikge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGAnZG93bicgZGlkbid0IGV4aXN0IG9uIG1pZ3JhdGlvbjogJHttaWdyYXRpb24uZmlsZX0gb3IgbWlncmF0aW5nIGRvd24gd2l0aCBhIGNoYW5nZSBtZXRob2QgaXNuJ3QgY3VycmVudGx5IHN1cHBvcnRlZGAsIHtjYXVzZTogZG93bkVycm9yfSlcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhyb3cgZG93bkVycm9yXG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgYXdhaXQgTWlncmF0aW9uc0xlZGdlci5yZW1vdmVWZXJzaW9uKGRiLCBkYXRlU3RyaW5nKVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIGRpcmVjdGlvbjogJHtkaXJlY3Rpb259YClcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gYXBwbGllZFxuICB9XG59XG4iXX0=