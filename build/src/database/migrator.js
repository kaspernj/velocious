// @ts-check
import { digg } from "diggerize";
import * as inflection from "inflection";
import Logger from "../logger.js";
import MigrationsLedger from "./migrations-ledger.js";
import AdvisoryLockRunner from "./advisory-lock-runner.js";
import { NotImplementedError } from "./migration/index.js";
import { migrationExecutionPhase, migrationRunsInExecutionPhase } from "./migration-execution-phase.js";
import restArgsError from "../utils/rest-args-error.js";
/**
 * Builds the advisory-lock name that serialises migrations for one database identifier.
 *
 * The name is derived from the database identifier only (not the migration) so that
 * concurrent processes queue on one lock while applying the pending set, instead of
 * racing on individual DDL statements.
 * @param {string} dbIdentifier - Database identifier being migrated.
 * @returns {string} - Advisory lock name.
 */
function migrationsAdvisoryLockName(dbIdentifier) {
    return `velocious:migrations:${dbIdentifier}`;
}
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
        console.error("[MIG-DEBUG] prepare() start");
        await this.createMigrationsTable();
        console.error("[MIG-DEBUG] createMigrationsTable done");
        await this.loadMigrationsVersions();
        console.error("[MIG-DEBUG] prepare() done");
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
        console.error("[MIG-DEBUG] migrateFiles count=" + files.length);
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
     *
     * Application migrations belong to the schema-owning lifecycle. HTTP worker
     * threads (`processContext.type === "worker-handler"`) each run the
     * application's `initializeModels` hook, so an app that migrates from that hook
     * would apply the pending set (and write the structure dump) once per worker.
     * The server process and deploy migration tasks migrate before workers start,
     * so workers skip here instead of repeating that work.
     * @param {import("./migrator/types.js").RequireMigrationContextType} requireContext - Require context.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async migrateFilesFromRequireContext(requireContext) {
        const processContext = this.configuration.getApplicationProcessContext();
        if (processContext?.type === "worker-handler") {
            await this.logger.debug("Skipping application migrations in an HTTP worker thread - the schema-owning process migrates before workers start", {
                instanceId: processContext.instanceId,
                processType: processContext.type
            });
            return;
        }
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
        // Serialise the framework-schema bootstrap across processes. This creates the attachments
        // and background-jobs tables, and it runs once per process outside the per-migration loop:
        // without this lock, two processes bootstrapping one database race on CREATE TABLE /
        // CREATE INDEX and one dies mid-boot (duplicate object/index).
        for (const [dbIdentifier, db] of Object.entries(filteredDbs)) {
            const runner = new AdvisoryLockRunner({
                configuration: this.configuration,
                connectionProvider: () => db,
                databaseIdentifier: dbIdentifier
            });
            await runner.withAdvisoryLock(migrationsAdvisoryLockName(dbIdentifier), async () => {
                await environmentHandler.ensureFrameworkSchema({ dbs: { [dbIdentifier]: db } });
            }, { dedicatedConnection: true });
        }
        // Ensure Velocious' own framework schema before the structure dump. The dump is
        // gated to enabled environments, but migration-enabled databases must include
        // framework tables so `db:migrate` and schema:load produce a complete database.
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
        console.error("[MIG-DEBUG] runMigrationFile file=" + (migration && migration.file));
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
            const db = dbs[dbIdentifier];
            const dateString = `${digg(migration, "date")}`;
            // Serialise the check-then-apply across processes. Without this, two shards can both
            // observe the migration as unapplied and both execute its DDL; the loser dies with the
            // driver's duplicate-object error mid-boot.
            //
            // The version is re-read *inside* the lock: while this process waited, another process
            // may already have applied the migration, in which case this one must become a no-op.
            console.error("[MIG-DEBUG] acquiring lock db=" + dbIdentifier + " file=" + migration.file);
            const runner = new AdvisoryLockRunner({
                configuration: this.configuration,
                connectionProvider: () => db,
                databaseIdentifier: dbIdentifier
            });
            const appliedInLock = await runner.withAdvisoryLock(migrationsAdvisoryLockName(dbIdentifier), async () => {
                // Re-read the applied set from the database while holding the lock. The version
                // list was loaded during prepare(), before any other process may have finished
                // applying migrations, so trusting that cached snapshot here would let this
                // process re-run DDL that another process has already committed.
                await this.loadMigrationsVersionsForDatabase({ dbIdentifier, db });
                if (direction == "up") {
                    if (this.hasRunMigrationVersion(dbIdentifier, migration.date)) {
                        this.logger.debug(`${dbIdentifier} has already run migration ${migration.file}`);
                        return false;
                    }
                }
                else if (direction == "down") {
                    if (!this.hasRunMigrationVersion(dbIdentifier, migration.date)) {
                        this.logger.debug(`${dbIdentifier} hasn't run migration ${migration.file}`);
                        return false;
                    }
                }
                else {
                    throw new Error(`Unknown direction: ${direction}`);
                }
                this.logger.debug(`Running migration on ${dbIdentifier}: ${migration.file}`, { migrationDatabaseIdentifiers });
                const MigrationClass = migrationClass;
                const migrationInstance = new MigrationClass({
                    configuration: this.configuration,
                    databaseIdentifier: dbIdentifier,
                    db
                });
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
                else {
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
                return true;
            }, 
            // Pin the lock to one physical session: MSSQL/explicit advisory locks are
            // session-scoped, and a pooled connection can route acquire and release to
            // different sessions, which would let two processes both "hold" the lock.
            { dedicatedConnection: true });
            if (!appliedInLock)
                continue;
            applied = true;
        }
        return applied;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWlncmF0b3IuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZGF0YWJhc2UvbWlncmF0b3IuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sRUFBQyxJQUFJLEVBQUMsTUFBTSxXQUFXLENBQUE7QUFDOUIsT0FBTyxLQUFLLFVBQVUsTUFBTSxZQUFZLENBQUE7QUFDeEMsT0FBTyxNQUFNLE1BQU0sY0FBYyxDQUFBO0FBQ2pDLE9BQU8sZ0JBQWdCLE1BQU0sd0JBQXdCLENBQUE7QUFDckQsT0FBTyxrQkFBa0IsTUFBTSwyQkFBMkIsQ0FBQTtBQUMxRCxPQUFPLEVBQUMsbUJBQW1CLEVBQUMsTUFBTSxzQkFBc0IsQ0FBQTtBQUN4RCxPQUFPLEVBQUUsdUJBQXVCLEVBQUUsNkJBQTZCLEVBQUUsTUFBTSxnQ0FBZ0MsQ0FBQTtBQUN2RyxPQUFPLGFBQWEsTUFBTSw2QkFBNkIsQ0FBQTtBQUV2RDs7Ozs7Ozs7R0FRRztBQUNILFNBQVMsMEJBQTBCLENBQUMsWUFBWTtJQUM5QyxPQUFPLHdCQUF3QixZQUFZLEVBQUUsQ0FBQTtBQUMvQyxDQUFDO0FBRUQsTUFBTSxDQUFDLE9BQU8sT0FBTyx5QkFBeUI7SUFDNUM7O3lEQUVxRDtJQUNyRCxrQkFBa0IsR0FBRyxFQUFFLENBQUE7SUFFdkI7Ozs7OztPQU1HO0lBQ0gsWUFBWSxFQUFDLGFBQWEsRUFBRSxtQkFBbUIsRUFBRSxjQUFjLEVBQUUsR0FBRyxRQUFRLEVBQUM7UUFDM0UsYUFBYSxDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBRXZCLElBQUksQ0FBQyxhQUFhO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxvQ0FBb0MsQ0FBQyxDQUFBO1FBRXpFLElBQUksQ0FBQyxhQUFhLEdBQUcsYUFBYSxDQUFBO1FBQ2xDLElBQUksQ0FBQyxtQkFBbUIsR0FBRyxtQkFBbUIsQ0FBQTtRQUM5QyxJQUFJLENBQUMsY0FBYyxHQUFHLGNBQWMsS0FBSyxTQUFTLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsdUJBQXVCLENBQUMsY0FBYyxDQUFDLENBQUE7UUFDeEcsSUFBSSxDQUFDLE1BQU0sR0FBRyxJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQTtJQUNoQyxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILHlCQUF5QixDQUFDLFlBQVk7UUFDcEMsSUFBSSxDQUFDLElBQUksQ0FBQyxtQkFBbUI7WUFBRSxPQUFPLElBQUksQ0FBQTtRQUUxQyxPQUFPLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxRQUFRLENBQUMsWUFBWSxDQUFDLENBQUE7SUFDeEQsQ0FBQztJQUdEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxPQUFPO1FBQ1gsT0FBTyxDQUFDLEtBQUssQ0FBQyw2QkFBNkIsQ0FBQyxDQUFBO1FBQzVDLE1BQU0sSUFBSSxDQUFDLHFCQUFxQixFQUFFLENBQUE7UUFDbEMsT0FBTyxDQUFDLEtBQUssQ0FBQyx3Q0FBd0MsQ0FBQyxDQUFBO1FBQ3ZELE1BQU0sSUFBSSxDQUFDLHNCQUFzQixFQUFFLENBQUE7UUFDbkMsT0FBTyxDQUFDLEtBQUssQ0FBQyw0QkFBNEIsQ0FBQyxDQUFBO0lBQzdDLENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLLENBQUMscUJBQXFCO1FBQ3pCLE1BQU0sR0FBRyxHQUFHLE1BQU0sSUFBSSxDQUFDLGFBQWEsQ0FBQyxxQkFBcUIsRUFBRSxDQUFBO1FBRTVELEtBQUssTUFBTSxZQUFZLElBQUksR0FBRyxFQUFFLENBQUM7WUFDL0IsSUFBSSxDQUFDLElBQUksQ0FBQyx5QkFBeUIsQ0FBQyxZQUFZLENBQUM7Z0JBQUUsU0FBUTtZQUUzRCxNQUFNLElBQUksQ0FBQyxnQ0FBZ0MsQ0FBQyxFQUFDLFlBQVksRUFBRSxFQUFFLEVBQUUsR0FBRyxDQUFDLFlBQVksQ0FBQyxFQUFDLENBQUMsQ0FBQTtRQUNwRixDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILEtBQUssQ0FBQyxnQ0FBZ0MsQ0FBQyxFQUFDLFlBQVksRUFBRSxFQUFFLEVBQUM7UUFDdkQsTUFBTSxxQkFBcUIsR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFDLHFCQUFxQixDQUFDLFlBQVksQ0FBQyxDQUFBO1FBRXBGLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxVQUFVLEVBQUUsQ0FBQztZQUN0QyxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxHQUFHLFlBQVksOEVBQThFLENBQUMsQ0FBQTtZQUNoSCxPQUFNO1FBQ1IsQ0FBQztRQUVELElBQUksTUFBTSxJQUFJLENBQUMsb0JBQW9CLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQztZQUN4QyxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxHQUFHLFlBQVksNkNBQTZDLENBQUMsQ0FBQTtRQUNqRixDQUFDO2FBQU0sQ0FBQztZQUNOLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLHVEQUF1RCxDQUFDLENBQUE7WUFDMUUsTUFBTSxnQkFBZ0IsQ0FBQyxXQUFXLENBQUMsRUFBRSxDQUFDLENBQUE7UUFDeEMsQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILHNCQUFzQixDQUFDLFlBQVksRUFBRSxPQUFPO1FBQzFDLElBQUksQ0FBQyxJQUFJLENBQUMsa0JBQWtCO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyw0Q0FBNEMsQ0FBQyxDQUFBO1FBQzNGLElBQUksQ0FBQyxJQUFJLENBQUMsa0JBQWtCLENBQUMsWUFBWSxDQUFDO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxzREFBc0QsWUFBWSxFQUFFLENBQUMsQ0FBQTtRQUVqSSxJQUFJLE9BQU8sSUFBSSxJQUFJLENBQUMsa0JBQWtCLENBQUMsWUFBWSxDQUFDLEVBQUUsQ0FBQztZQUNyRCxPQUFPLElBQUksQ0FBQTtRQUNiLENBQUM7UUFFRCxPQUFPLEtBQUssQ0FBQTtJQUNkLENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILEtBQUssQ0FBQyxZQUFZLENBQUMsS0FBSyxFQUFFLGNBQWM7UUFDdEMsSUFBSSxZQUFZLEdBQUcsQ0FBQyxDQUFBO1FBQ3BCLE9BQU8sQ0FBQyxLQUFLLENBQUMsaUNBQWlDLEdBQUcsS0FBSyxDQUFDLE1BQU0sQ0FBQyxDQUFBO1FBRS9ELE1BQU0sSUFBSSxDQUFDLGFBQWEsQ0FBQyxpQkFBaUIsQ0FBQyxFQUFDLG1CQUFtQixFQUFFLElBQUksQ0FBQyxtQkFBbUIsRUFBRSxJQUFJLEVBQUUsa0NBQWtDLEVBQUMsRUFBRSxLQUFLLElBQUksRUFBRTtZQUMvSSxLQUFLLE1BQU0sU0FBUyxJQUFJLEtBQUssRUFBRSxDQUFDO2dCQUM5QixNQUFNLE9BQU8sR0FBRyxNQUFNLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQztvQkFDMUMsU0FBUztvQkFDVCxnQkFBZ0IsRUFBRSxLQUFLLElBQUksRUFBRTt3QkFDM0IsSUFBSSxDQUFDLFNBQVMsQ0FBQyxRQUFROzRCQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMseUNBQXlDLE1BQU0sQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsQ0FBQTt3QkFFdEgsTUFBTSxlQUFlLEdBQUcsTUFBTSxjQUFjLENBQUMsU0FBUyxDQUFDLFFBQVEsQ0FBQyxDQUFBO3dCQUVoRSxJQUFJLENBQUMsZUFBZSxFQUFFLENBQUM7NEJBQ3JCLE1BQU0sSUFBSSxLQUFLLENBQUMsK0NBQStDLFNBQVMsQ0FBQyxRQUFRLEVBQUUsQ0FBQyxDQUFBO3dCQUN0RixDQUFDO3dCQUVELE9BQU8sZUFBZSxDQUFBO29CQUN4QixDQUFDO2lCQUNGLENBQUMsQ0FBQTtnQkFFRixJQUFJLE9BQU87b0JBQUUsWUFBWSxFQUFFLENBQUE7WUFDN0IsQ0FBQztZQUVELE1BQU0sSUFBSSxDQUFDLGdCQUFnQixFQUFFLENBQUE7UUFDL0IsQ0FBQyxDQUFDLENBQUE7UUFFRixPQUFPLFlBQVksQ0FBQTtJQUNyQixDQUFDO0lBRUQ7Ozs7Ozs7Ozs7O09BV0c7SUFDSCxLQUFLLENBQUMsOEJBQThCLENBQUMsY0FBYztRQUNqRCxNQUFNLGNBQWMsR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFDLDRCQUE0QixFQUFFLENBQUE7UUFFeEUsSUFBSSxjQUFjLEVBQUUsSUFBSSxLQUFLLGdCQUFnQixFQUFFLENBQUM7WUFDOUMsTUFBTSxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxvSEFBb0gsRUFBRTtnQkFDNUksVUFBVSxFQUFFLGNBQWMsQ0FBQyxVQUFVO2dCQUNyQyxXQUFXLEVBQUUsY0FBYyxDQUFDLElBQUk7YUFDakMsQ0FBQyxDQUFBO1lBRUYsT0FBTTtRQUNSLENBQUM7UUFFRCxNQUFNLEtBQUssR0FBRyxJQUFJLENBQUMsNEJBQTRCLENBQUMsY0FBYyxDQUFDLENBQUE7UUFFL0QsTUFBTSxJQUFJLENBQUMsYUFBYSxDQUFDLGlCQUFpQixDQUFDLEVBQUMsbUJBQW1CLEVBQUUsSUFBSSxDQUFDLG1CQUFtQixFQUFFLElBQUksRUFBRSxrREFBa0QsRUFBQyxFQUFFLEtBQUssSUFBSSxFQUFFO1lBQy9KLEtBQUssTUFBTSxTQUFTLElBQUksS0FBSyxFQUFFLENBQUM7Z0JBQzlCLE1BQU0sSUFBSSxDQUFDLGdCQUFnQixDQUFDO29CQUMxQixTQUFTO29CQUNULGdCQUFnQixFQUFFLEtBQUssSUFBSSxFQUFFLENBQUMsY0FBYyxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxPQUFPO2lCQUNyRSxDQUFDLENBQUE7WUFDSixDQUFDO1lBRUQsTUFBTSxJQUFJLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQTtRQUMvQixDQUFDLENBQUMsQ0FBQTtJQUNKLENBQUM7SUFFRDs7Ozs7Ozs7OztPQVVHO0lBQ0gsS0FBSyxDQUFDLGdDQUFnQyxDQUFDLEVBQUMscUJBQXFCLEVBQUUsa0JBQWtCLEVBQUUsRUFBRSxFQUFFLGNBQWMsRUFBQztRQUNwRyxJQUFJLENBQUMscUJBQXFCLENBQUMsVUFBVTtZQUFFLE9BQU8sQ0FBQyxDQUFBO1FBRS9DLE1BQU0sZ0JBQWdCLENBQUMsV0FBVyxDQUFDLEVBQUUsQ0FBQyxDQUFBO1FBQ3RDLE1BQU0sZUFBZSxHQUFHLElBQUksR0FBRyxDQUFDLE1BQU0sZ0JBQWdCLENBQUMsZUFBZSxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUE7UUFDM0UsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLDRCQUE0QixDQUFDLGNBQWMsQ0FBQyxDQUFBO1FBQ3BFLElBQUksWUFBWSxHQUFHLENBQUMsQ0FBQTtRQUVwQixLQUFLLE1BQU0sU0FBUyxJQUFJLFVBQVUsRUFBRSxDQUFDO1lBQ25DLE1BQU0sT0FBTyxHQUFHLEdBQUcsU0FBUyxDQUFDLElBQUksRUFBRSxDQUFBO1lBRW5DLElBQUksZUFBZSxDQUFDLEdBQUcsQ0FBQyxPQUFPLENBQUM7Z0JBQUUsU0FBUTtZQUUxQyxNQUFNLGNBQWMsR0FBRyxjQUFjLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxDQUFDLE9BQU8sQ0FBQTtZQUU3RCxJQUFJLENBQUMsY0FBYyxJQUFJLE9BQU8sY0FBYyxLQUFLLFVBQVUsRUFBRSxDQUFDO2dCQUM1RCxNQUFNLElBQUksS0FBSyxDQUFDLGFBQWEsU0FBUyxDQUFDLElBQUksaURBQWlELE9BQU8sY0FBYyxFQUFFLENBQUMsQ0FBQTtZQUN0SCxDQUFDO1lBQ0QsSUFBSSxDQUFDLDZCQUE2QixDQUFDLGNBQWMsRUFBRSxJQUFJLENBQUMsY0FBYyxDQUFDO2dCQUFFLFNBQVE7WUFDakYsSUFBSSxDQUFDLENBQUMsY0FBYyxDQUFDLHNCQUFzQixFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxrQkFBa0IsQ0FBQztnQkFBRSxTQUFRO1lBRXBHLE1BQU0saUJBQWlCLEdBQUcsSUFBSSxjQUFjLENBQUMsRUFBQyxhQUFhLEVBQUUsSUFBSSxDQUFDLGFBQWEsRUFBRSxrQkFBa0IsRUFBRSxFQUFFLEVBQUMsQ0FBQyxDQUFBO1lBRXpHLE1BQU0sSUFBSSxDQUFDLGNBQWMsQ0FBQyxFQUFDLFNBQVMsRUFBRSxpQkFBaUIsRUFBQyxDQUFDLENBQUE7WUFDekQsTUFBTSxnQkFBZ0IsQ0FBQyxhQUFhLENBQUMsRUFBRSxFQUFFLE9BQU8sQ0FBQyxDQUFBO1lBQ2pELGVBQWUsQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDLENBQUE7WUFDNUIsWUFBWSxFQUFFLENBQUE7UUFDaEIsQ0FBQztRQUVELE9BQU8sWUFBWSxDQUFBO0lBQ3JCLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsNEJBQTRCLENBQUMsY0FBYztRQUN6QyxNQUFNLFVBQVUsR0FBRyxFQUFFLENBQUE7UUFFckIsS0FBSyxNQUFNLElBQUksSUFBSSxjQUFjLENBQUMsSUFBSSxFQUFFLEVBQUUsQ0FBQztZQUN6QyxNQUFNLEtBQUssR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLHVCQUF1QixDQUFDLENBQUE7WUFFakQsSUFBSSxDQUFDLEtBQUs7Z0JBQUUsU0FBUTtZQUVwQixJQUFJLFFBQVEsR0FBRyxJQUFJLENBQUE7WUFDbkIsSUFBSSxVQUFVLEdBQUcsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFBO1lBRXpCLElBQUksVUFBVSxDQUFDLE1BQU0sSUFBSSxFQUFFLEVBQUUsQ0FBQztnQkFDNUIsVUFBVSxHQUFHLElBQUksVUFBVSxFQUFFLENBQUE7Z0JBQzdCLFFBQVEsR0FBRyxJQUFJLFFBQVEsRUFBRSxDQUFBO1lBQzNCLENBQUM7WUFFRCxVQUFVLENBQUMsSUFBSSxDQUFDO2dCQUNkLElBQUksRUFBRSxRQUFRLENBQUMsVUFBVSxDQUFDO2dCQUMxQixJQUFJLEVBQUUsUUFBUTtnQkFDZCxrQkFBa0IsRUFBRSxVQUFVLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxVQUFVLENBQUMsR0FBRyxFQUFFLEdBQUcsQ0FBQyxDQUFDO2FBQ3ZFLENBQUMsQ0FBQTtRQUNKLENBQUM7UUFFRCxPQUFPLFVBQVUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxVQUFVLEVBQUUsVUFBVSxFQUFFLEVBQUUsQ0FBQyxVQUFVLENBQUMsSUFBSSxHQUFHLFVBQVUsQ0FBQyxJQUFJLENBQUMsQ0FBQTtJQUN2RixDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsS0FBSyxDQUFDLGNBQWMsQ0FBQyxFQUFDLFNBQVMsRUFBRSxpQkFBaUIsRUFBQztRQUNqRCxJQUFJLENBQUM7WUFDSCxNQUFNLGlCQUFpQixDQUFDLE1BQU0sRUFBRSxDQUFBO1FBQ2xDLENBQUM7UUFBQyxPQUFPLFdBQVcsRUFBRSxDQUFDO1lBQ3JCLElBQUksQ0FBQyxDQUFDLFdBQVcsWUFBWSxtQkFBbUIsQ0FBQztnQkFBRSxNQUFNLFdBQVcsQ0FBQTtZQUVwRSxJQUFJLENBQUM7Z0JBQ0gsTUFBTSxpQkFBaUIsQ0FBQyxFQUFFLEVBQUUsQ0FBQTtZQUM5QixDQUFDO1lBQUMsT0FBTyxPQUFPLEVBQUUsQ0FBQztnQkFDakIsSUFBSSxPQUFPLFlBQVksbUJBQW1CLEVBQUUsQ0FBQztvQkFDM0MsTUFBTSxJQUFJLEtBQUssQ0FBQywrQ0FBK0MsU0FBUyxDQUFDLElBQUksRUFBRSxFQUFFLEVBQUMsS0FBSyxFQUFFLE9BQU8sRUFBQyxDQUFDLENBQUE7Z0JBQ3BHLENBQUM7Z0JBRUQsTUFBTSxPQUFPLENBQUE7WUFDZixDQUFDO1FBQ0gsQ0FBQztJQUNILENBQUM7SUFFRDs7O09BR0c7SUFDSCxLQUFLLENBQUMsZ0JBQWdCO1FBQ3BCLE1BQU0sa0JBQWtCLEdBQUcsSUFBSSxDQUFDLGFBQWEsQ0FBQyxxQkFBcUIsRUFBRSxDQUFBO1FBQ3JFLE1BQU0sR0FBRyxHQUFHLE1BQU0sSUFBSSxDQUFDLGFBQWEsQ0FBQyxxQkFBcUIsRUFBRSxDQUFBO1FBQzVELE1BQU0sV0FBVyxHQUFHLE1BQU0sQ0FBQyxXQUFXLENBQ3BDLE1BQU0sQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxZQUFZLENBQUMsRUFBRSxFQUFFO1lBQzVDLElBQUksQ0FBQyxJQUFJLENBQUMseUJBQXlCLENBQUMsWUFBWSxDQUFDO2dCQUFFLE9BQU8sS0FBSyxDQUFBO1lBRS9ELE9BQU8sT0FBTyxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMscUJBQXFCLENBQUMsWUFBWSxDQUFDLENBQUMsVUFBVSxDQUFDLENBQUE7UUFDbkYsQ0FBQyxDQUFDLENBQ0gsQ0FBQTtRQUVELElBQUksQ0FBQyxrQkFBa0IsSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxDQUFDLE1BQU0sSUFBSSxDQUFDO1lBQUUsT0FBTTtRQUV2RSwwRkFBMEY7UUFDMUYsMkZBQTJGO1FBQzNGLHFGQUFxRjtRQUNyRiwrREFBK0Q7UUFDL0QsS0FBSyxNQUFNLENBQUMsWUFBWSxFQUFFLEVBQUUsQ0FBQyxJQUFJLE1BQU0sQ0FBQyxPQUFPLENBQUMsV0FBVyxDQUFDLEVBQUUsQ0FBQztZQUM3RCxNQUFNLE1BQU0sR0FBRyxJQUFJLGtCQUFrQixDQUFDO2dCQUNwQyxhQUFhLEVBQUUsSUFBSSxDQUFDLGFBQWE7Z0JBQ2pDLGtCQUFrQixFQUFFLEdBQUcsRUFBRSxDQUFDLEVBQUU7Z0JBQzVCLGtCQUFrQixFQUFFLFlBQVk7YUFDakMsQ0FBQyxDQUFBO1lBRUYsTUFBTSxNQUFNLENBQUMsZ0JBQWdCLENBQzNCLDBCQUEwQixDQUFDLFlBQVksQ0FBQyxFQUN4QyxLQUFLLElBQUksRUFBRTtnQkFDVCxNQUFNLGtCQUFrQixDQUFDLHFCQUFxQixDQUFDLEVBQUMsR0FBRyxFQUFFLEVBQUMsQ0FBQyxZQUFZLENBQUMsRUFBRSxFQUFFLEVBQUMsRUFBQyxDQUFDLENBQUE7WUFDN0UsQ0FBQyxFQUNELEVBQUMsbUJBQW1CLEVBQUUsSUFBSSxFQUFDLENBQzVCLENBQUE7UUFDSCxDQUFDO1FBRUQsZ0ZBQWdGO1FBQ2hGLDhFQUE4RTtRQUM5RSxnRkFBZ0Y7UUFDaEYsTUFBTSxrQkFBa0IsQ0FBQyxlQUFlLENBQUMsRUFBQyxHQUFHLEVBQUUsV0FBVyxFQUFDLENBQUMsQ0FBQTtJQUM5RCxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLHNCQUFzQjtRQUMxQixJQUFJLENBQUMsa0JBQWtCLEdBQUcsRUFBRSxDQUFBO1FBRTVCLE1BQU0sR0FBRyxHQUFHLE1BQU0sSUFBSSxDQUFDLGFBQWEsQ0FBQyxxQkFBcUIsRUFBRSxDQUFBO1FBRTVELEtBQUssTUFBTSxZQUFZLElBQUksR0FBRyxFQUFFLENBQUM7WUFDL0IsSUFBSSxDQUFDLElBQUksQ0FBQyx5QkFBeUIsQ0FBQyxZQUFZLENBQUM7Z0JBQUUsU0FBUTtZQUUzRCxNQUFNLElBQUksQ0FBQyxpQ0FBaUMsQ0FBQyxFQUFDLFlBQVksRUFBRSxFQUFFLEVBQUUsR0FBRyxDQUFDLFlBQVksQ0FBQyxFQUFDLENBQUMsQ0FBQTtRQUNyRixDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILEtBQUssQ0FBQyxpQ0FBaUMsQ0FBQyxFQUFDLFlBQVksRUFBRSxFQUFFLEVBQUM7UUFDeEQsTUFBTSxxQkFBcUIsR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFDLHFCQUFxQixDQUFDLFlBQVksQ0FBQyxDQUFBO1FBRXBGLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxVQUFVLEVBQUUsQ0FBQztZQUN0QyxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxHQUFHLFlBQVksZ0ZBQWdGLENBQUMsQ0FBQTtZQUNsSCxPQUFNO1FBQ1IsQ0FBQztRQUVELElBQUksQ0FBQyxNQUFNLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDO1lBQ3pDLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLHNDQUFzQyxZQUFZLGdEQUFnRCxDQUFDLENBQUE7WUFDcEgsT0FBTyxJQUFJLENBQUMsa0JBQWtCLENBQUMsWUFBWSxDQUFDLENBQUE7WUFDNUMsT0FBTTtRQUNSLENBQUM7UUFFRCxNQUFNLFFBQVEsR0FBRyxNQUFNLGdCQUFnQixDQUFDLGVBQWUsQ0FBQyxFQUFFLENBQUMsQ0FBQTtRQUUzRCxJQUFJLENBQUMsa0JBQWtCLENBQUMsWUFBWSxDQUFDLEdBQUcsRUFBRSxDQUFBO1FBRTFDLEtBQUssTUFBTSxPQUFPLElBQUksUUFBUSxFQUFFLENBQUM7WUFDL0IsSUFBSSxDQUFDLGtCQUFrQixDQUFDLFlBQVksQ0FBQyxDQUFDLE9BQU8sQ0FBQyxHQUFHLElBQUksQ0FBQTtRQUN2RCxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsb0JBQW9CLENBQUMsRUFBRTtRQUMzQixPQUFPLE1BQU0sZ0JBQWdCLENBQUMsV0FBVyxDQUFDLEVBQUUsQ0FBQyxDQUFBO0lBQy9DLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLHFCQUFxQixDQUFDLGNBQWM7UUFDeEMsTUFBTSxjQUFjLEdBQUcsY0FBYyxDQUFDLElBQUksRUFBRSxDQUFBO1FBRTVDOzt5RUFFaUU7UUFDakUsSUFBSSxLQUFLLEdBQUcsRUFBRSxDQUFBO1FBRWQsS0FBSyxNQUFNLElBQUksSUFBSSxjQUFjLEVBQUUsQ0FBQztZQUNsQyxNQUFNLEtBQUssR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLHFCQUFxQixDQUFDLENBQUE7WUFFL0MsSUFBSSxDQUFDLEtBQUs7Z0JBQUUsU0FBUTtZQUVwQixNQUFNLElBQUksR0FBRyxRQUFRLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUE7WUFDL0IsTUFBTSxhQUFhLEdBQUcsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFBO1lBQzlCLE1BQU0sa0JBQWtCLEdBQUcsVUFBVSxDQUFDLFFBQVEsQ0FBQyxhQUFhLENBQUMsQ0FBQTtZQUU3RCxNQUFNLGVBQWUsR0FBRyxnRUFBZ0UsQ0FBQyxDQUFDO2dCQUN4RixJQUFJO2dCQUNKLElBQUk7Z0JBQ0osa0JBQWtCO2FBQ25CLENBQUMsQ0FBQTtZQUVGLEtBQUssQ0FBQyxJQUFJLENBQUMsZUFBZSxDQUFDLENBQUE7UUFDN0IsQ0FBQztRQUVELEtBQUssR0FBRyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUMsVUFBVSxFQUFFLFVBQVUsRUFBRSxFQUFFLENBQUMsVUFBVSxDQUFDLElBQUksR0FBRyxVQUFVLENBQUMsSUFBSSxDQUFDLENBQUE7UUFFakYsS0FBSyxNQUFNLFNBQVMsSUFBSSxLQUFLLEVBQUUsQ0FBQztZQUM5QixNQUFNLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQztnQkFDMUIsU0FBUztnQkFDVCxnQkFBZ0IsRUFBRSxLQUFLLElBQUksRUFBRSxDQUFDLGNBQWMsQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLENBQUMsT0FBTzthQUNyRSxDQUFDLENBQUE7UUFDSixDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxLQUFLO1FBQ1QsTUFBTSxHQUFHLEdBQUcsTUFBTSxJQUFJLENBQUMsYUFBYSxDQUFDLHFCQUFxQixFQUFFLENBQUE7UUFFNUQsS0FBSyxNQUFNLFlBQVksSUFBSSxHQUFHLEVBQUUsQ0FBQztZQUMvQixJQUFJLENBQUMsSUFBSSxDQUFDLHlCQUF5QixDQUFDLFlBQVksQ0FBQztnQkFBRSxTQUFRO1lBRTNELE1BQU0sRUFBRSxHQUFHLEdBQUcsQ0FBQyxZQUFZLENBQUMsQ0FBQTtZQUU1QixNQUFNLEVBQUUsQ0FBQyx1QkFBdUIsQ0FBQyxLQUFLLElBQUksRUFBRTtnQkFDMUMsT0FBTyxJQUFJLEVBQUUsQ0FBQztvQkFDWixNQUFNLE1BQU0sR0FBRyxFQUFFLENBQUE7b0JBQ2pCLElBQUksZUFBZSxHQUFHLEtBQUssQ0FBQTtvQkFFM0IsSUFBSSxDQUFDO3dCQUNILEtBQUssTUFBTSxLQUFLLElBQUksTUFBTSxFQUFFLENBQUMsU0FBUyxFQUFFLEVBQUUsQ0FBQzs0QkFDekMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsa0JBQWtCLEtBQUssQ0FBQyxPQUFPLEVBQUUsRUFBRSxDQUFDLENBQUE7NEJBRXJELElBQUksQ0FBQztnQ0FDSCxNQUFNLEVBQUUsQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDLE9BQU8sRUFBRSxFQUFFLEVBQUMsT0FBTyxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7Z0NBQ3BELGVBQWUsR0FBRyxJQUFJLENBQUE7NEJBQ3hCLENBQUM7NEJBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztnQ0FDZixNQUFNLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFBOzRCQUNwQixDQUFDO3dCQUNILENBQUM7d0JBRUQsTUFBSztvQkFDUCxDQUFDO29CQUFDLE9BQU8sS0FBSyxFQUFFLENBQUMsQ0FBQyxxQ0FBcUM7d0JBQ3JELElBQUksTUFBTSxDQUFDLE1BQU0sR0FBRyxDQUFDLElBQUksZUFBZSxFQUFFLENBQUM7NEJBQ3pDLFFBQVE7d0JBQ1YsQ0FBQzs2QkFBTSxDQUFDOzRCQUNOLE1BQU0sTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFBO3dCQUNqQixDQUFDO29CQUNILENBQUM7Z0JBQ0gsQ0FBQztZQUNILENBQUMsQ0FBQyxDQUFBO1FBQ0osQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7T0FLRztJQUNILEtBQUssQ0FBQyxRQUFRLENBQUMsS0FBSyxFQUFFLGNBQWM7UUFDbEMsTUFBTSxzQkFBc0IsR0FBRyxNQUFNLElBQUksQ0FBQyx1QkFBdUIsRUFBRSxDQUFBO1FBRW5FLElBQUksQ0FBQyxzQkFBc0IsRUFBRSxDQUFDO1lBQzVCLE1BQU0sSUFBSSxLQUFLLENBQUMsaUNBQWlDLENBQUMsQ0FBQTtRQUNwRCxDQUFDO1FBRUQsTUFBTSw0QkFBNEIsR0FBRyxRQUFRLENBQUMsc0JBQXNCLENBQUMsQ0FBQTtRQUNyRSxNQUFNLFNBQVMsR0FBRyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUMsSUFBSSxFQUFFLEVBQUUsQ0FBQyxJQUFJLENBQUMsSUFBSSxJQUFJLDRCQUE0QixDQUFDLENBQUE7UUFFakYsSUFBSSxDQUFDLFNBQVMsRUFBRSxDQUFDO1lBQ2YsTUFBTSxJQUFJLEtBQUssQ0FBQyw4QkFBOEIsNEJBQTRCLFlBQVksQ0FBQyxDQUFBO1FBQ3pGLENBQUM7UUFFRCxNQUFNLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQztZQUMxQixTQUFTO1lBQ1QsZ0JBQWdCLEVBQUUsS0FBSyxJQUFJLEVBQUU7Z0JBQzNCLElBQUksQ0FBQyxTQUFTLENBQUMsUUFBUTtvQkFBRSxNQUFNLElBQUksS0FBSyxDQUFDLHlDQUF5QyxNQUFNLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLENBQUE7Z0JBRXRILE9BQU8sTUFBTSxjQUFjLENBQUMsU0FBUyxDQUFDLFFBQVEsQ0FBQyxDQUFBO1lBQ2pELENBQUM7WUFDRCxTQUFTLEVBQUUsTUFBTTtTQUNsQixDQUFDLENBQUE7SUFDSixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLHVCQUF1QjtRQUMzQixJQUFJLENBQUMsSUFBSSxDQUFDLGtCQUFrQjtZQUFFLE1BQU0sSUFBSSxDQUFDLHNCQUFzQixFQUFFLENBQUE7UUFFakU7O3dDQUVnQztRQUNoQyxJQUFJLGNBQWMsQ0FBQTtRQUVsQixLQUFLLE1BQU0sWUFBWSxJQUFJLElBQUksQ0FBQyxrQkFBa0IsRUFBRSxDQUFDO1lBQ25ELEtBQUssTUFBTSxnQkFBZ0IsSUFBSSxJQUFJLENBQUMsa0JBQWtCLENBQUMsWUFBWSxDQUFDLEVBQUUsQ0FBQztnQkFDckUsSUFBSSxDQUFDLGNBQWMsSUFBSSxnQkFBZ0IsR0FBRyxjQUFjLEVBQUUsQ0FBQztvQkFDekQsY0FBYyxHQUFHLGdCQUFnQixDQUFBO2dCQUNuQyxDQUFDO1lBQ0gsQ0FBQztRQUNILENBQUM7UUFFRCxPQUFPLGNBQWMsQ0FBQTtJQUN2QixDQUFDO0lBRUQ7Ozs7Ozs7T0FPRztJQUNILEtBQUssQ0FBQyxnQkFBZ0IsQ0FBQyxFQUFDLFNBQVMsRUFBRSxnQkFBZ0IsRUFBRSxTQUFTLEdBQUcsSUFBSSxFQUFDO1FBQ3BFLElBQUksQ0FBQyxJQUFJLENBQUMsYUFBYTtZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsc0JBQXNCLENBQUMsQ0FBQTtRQUNoRSxPQUFPLENBQUMsS0FBSyxDQUFDLG9DQUFvQyxHQUFHLENBQUMsU0FBUyxJQUFJLFNBQVMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFBO1FBQ25GLElBQUksQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLHlCQUF5QixFQUFFO1lBQUUsTUFBTSxJQUFJLENBQUMsYUFBYSxDQUFDLHNCQUFzQixFQUFFLENBQUE7UUFDdEcsSUFBSSxDQUFDLElBQUksQ0FBQyxrQkFBa0I7WUFBRSxNQUFNLElBQUksQ0FBQyxzQkFBc0IsRUFBRSxDQUFBO1FBRWpFLElBQUksT0FBTyxHQUFHLEtBQUssQ0FBQTtRQUNuQixNQUFNLEdBQUcsR0FBRyxNQUFNLElBQUksQ0FBQyxhQUFhLENBQUMscUJBQXFCLEVBQUUsQ0FBQTtRQUU1RDs7OEJBRXNCO1FBQ3RCLE1BQU0scUNBQXFDLEdBQUcsRUFBRSxDQUFBO1FBRWhELHdFQUF3RTtRQUN4RSxtRUFBbUU7UUFDbkUsS0FBSyxNQUFNLFlBQVksSUFBSSxHQUFHLEVBQUUsQ0FBQztZQUMvQixJQUFJLENBQUMsSUFBSSxDQUFDLHlCQUF5QixDQUFDLFlBQVksQ0FBQztnQkFBRSxTQUFRO1lBRTNELE1BQU0scUJBQXFCLEdBQUcsSUFBSSxDQUFDLGFBQWEsQ0FBQyxxQkFBcUIsQ0FBQyxZQUFZLENBQUMsQ0FBQTtZQUVwRixJQUFJLENBQUMscUJBQXFCLENBQUMsVUFBVTtnQkFBRSxTQUFRO1lBQy9DLElBQUksSUFBSSxDQUFDLGtCQUFrQixDQUFDLFlBQVksQ0FBQztnQkFBRSxTQUFRO1lBRW5ELHFDQUFxQyxDQUFDLElBQUksQ0FBQyxZQUFZLENBQUMsQ0FBQTtRQUMxRCxDQUFDO1FBRUQsS0FBSyxNQUFNLFlBQVksSUFBSSxxQ0FBcUMsRUFBRSxDQUFDO1lBQ2pFLE1BQU0sRUFBRSxHQUFHLEdBQUcsQ0FBQyxZQUFZLENBQUMsQ0FBQTtZQUU1QixNQUFNLElBQUksQ0FBQyxnQ0FBZ0MsQ0FBQyxFQUFDLFlBQVksRUFBRSxFQUFFLEVBQUMsQ0FBQyxDQUFBO1lBQy9ELE1BQU0sSUFBSSxDQUFDLGlDQUFpQyxDQUFDLEVBQUMsWUFBWSxFQUFFLEVBQUUsRUFBQyxDQUFDLENBQUE7UUFDbEUsQ0FBQztRQUVELE1BQU0sY0FBYyxHQUFHLE1BQU0sZ0JBQWdCLEVBQUUsQ0FBQTtRQUUvQyxJQUFJLENBQUMsY0FBYyxJQUFJLE9BQU8sY0FBYyxLQUFLLFVBQVUsRUFBRSxDQUFDO1lBQzVELE1BQU0sSUFBSSxLQUFLLENBQUMsYUFBYSxTQUFTLENBQUMsSUFBSSxpREFBaUQsT0FBTyxjQUFjLEVBQUUsQ0FBQyxDQUFBO1FBQ3RILENBQUM7UUFDRCxJQUFJLFNBQVMsSUFBSSxJQUFJLElBQUksQ0FBQyw2QkFBNkIsQ0FBQyxjQUFjLEVBQUUsSUFBSSxDQUFDLGNBQWMsQ0FBQztZQUFFLE9BQU8sS0FBSyxDQUFBO1FBRTFHLE1BQU0sNEJBQTRCLEdBQUcsY0FBYyxDQUFDLHNCQUFzQixFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQTtRQUUzRixLQUFLLE1BQU0sWUFBWSxJQUFJLEdBQUcsRUFBRSxDQUFDO1lBQy9CLElBQUksQ0FBQyxJQUFJLENBQUMseUJBQXlCLENBQUMsWUFBWSxDQUFDO2dCQUFFLFNBQVE7WUFFM0QsTUFBTSxxQkFBcUIsR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFDLHFCQUFxQixDQUFDLFlBQVksQ0FBQyxDQUFBO1lBRXBGLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxVQUFVLEVBQUUsQ0FBQztnQkFDdEMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsR0FBRyxZQUFZLHlEQUF5RCxJQUFJLENBQUMsU0FBUyxFQUFFLE1BQU0sQ0FBQyxFQUFFLENBQUMsQ0FBQTtnQkFDcEgsU0FBUTtZQUNWLENBQUM7WUFFRCxJQUFJLENBQUMsNEJBQTRCLENBQUMsUUFBUSxDQUFDLFlBQVksQ0FBQyxFQUFFLENBQUM7Z0JBQ3pELElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEdBQUcsWUFBWSw0QkFBNEIsU0FBUyxDQUFDLElBQUksRUFBRSxFQUFFLEVBQUMsNEJBQTRCLEVBQUMsQ0FBQyxDQUFBO2dCQUM5RyxTQUFRO1lBQ1YsQ0FBQztZQUVELE1BQU0sRUFBRSxHQUFHLEdBQUcsQ0FBQyxZQUFZLENBQUMsQ0FBQTtZQUM1QixNQUFNLFVBQVUsR0FBRyxHQUFHLElBQUksQ0FBQyxTQUFTLEVBQUUsTUFBTSxDQUFDLEVBQUUsQ0FBQTtZQUUvQyxxRkFBcUY7WUFDckYsdUZBQXVGO1lBQ3ZGLDRDQUE0QztZQUM1QyxFQUFFO1lBQ0YsdUZBQXVGO1lBQ3ZGLHNGQUFzRjtZQUN0RixPQUFPLENBQUMsS0FBSyxDQUFDLGdDQUFnQyxHQUFHLFlBQVksR0FBRyxRQUFRLEdBQUcsU0FBUyxDQUFDLElBQUksQ0FBQyxDQUFBO1lBQzFGLE1BQU0sTUFBTSxHQUFHLElBQUksa0JBQWtCLENBQUM7Z0JBQ3BDLGFBQWEsRUFBRSxJQUFJLENBQUMsYUFBYTtnQkFDakMsa0JBQWtCLEVBQUUsR0FBRyxFQUFFLENBQUMsRUFBRTtnQkFDNUIsa0JBQWtCLEVBQUUsWUFBWTthQUNqQyxDQUFDLENBQUE7WUFFRixNQUFNLGFBQWEsR0FBRyxNQUFNLE1BQU0sQ0FBQyxnQkFBZ0IsQ0FDakQsMEJBQTBCLENBQUMsWUFBWSxDQUFDLEVBQ3hDLEtBQUssSUFBSSxFQUFFO2dCQUNULGdGQUFnRjtnQkFDaEYsK0VBQStFO2dCQUMvRSw0RUFBNEU7Z0JBQzVFLGlFQUFpRTtnQkFDakUsTUFBTSxJQUFJLENBQUMsaUNBQWlDLENBQUMsRUFBQyxZQUFZLEVBQUUsRUFBRSxFQUFDLENBQUMsQ0FBQTtnQkFFaEUsSUFBSSxTQUFTLElBQUksSUFBSSxFQUFFLENBQUM7b0JBQ3RCLElBQUksSUFBSSxDQUFDLHNCQUFzQixDQUFDLFlBQVksRUFBRSxTQUFTLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQzt3QkFDOUQsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsR0FBRyxZQUFZLDhCQUE4QixTQUFTLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQTt3QkFDaEYsT0FBTyxLQUFLLENBQUE7b0JBQ2QsQ0FBQztnQkFDSCxDQUFDO3FCQUFNLElBQUksU0FBUyxJQUFJLE1BQU0sRUFBRSxDQUFDO29CQUMvQixJQUFJLENBQUMsSUFBSSxDQUFDLHNCQUFzQixDQUFDLFlBQVksRUFBRSxTQUFTLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQzt3QkFDL0QsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsR0FBRyxZQUFZLHlCQUF5QixTQUFTLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQTt3QkFDM0UsT0FBTyxLQUFLLENBQUE7b0JBQ2QsQ0FBQztnQkFDSCxDQUFDO3FCQUFNLENBQUM7b0JBQ04sTUFBTSxJQUFJLEtBQUssQ0FBQyxzQkFBc0IsU0FBUyxFQUFFLENBQUMsQ0FBQTtnQkFDcEQsQ0FBQztnQkFFRCxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyx3QkFBd0IsWUFBWSxLQUFLLFNBQVMsQ0FBQyxJQUFJLEVBQUUsRUFBRSxFQUFDLDRCQUE0QixFQUFDLENBQUMsQ0FBQTtnQkFFNUcsTUFBTSxjQUFjLEdBQUcsY0FBYyxDQUFBO2dCQUNyQyxNQUFNLGlCQUFpQixHQUFHLElBQUksY0FBYyxDQUFDO29CQUMzQyxhQUFhLEVBQUUsSUFBSSxDQUFDLGFBQWE7b0JBQ2pDLGtCQUFrQixFQUFFLFlBQVk7b0JBQ2hDLEVBQUU7aUJBQ0gsQ0FBQyxDQUFBO2dCQUVGLElBQUksU0FBUyxJQUFJLElBQUksRUFBRSxDQUFDO29CQUN0QixJQUFJLENBQUM7d0JBQ0gsTUFBTSxpQkFBaUIsQ0FBQyxNQUFNLEVBQUUsQ0FBQTtvQkFDbEMsQ0FBQztvQkFBQyxPQUFPLFdBQVcsRUFBRSxDQUFDO3dCQUNyQixJQUFJLFdBQVcsWUFBWSxtQkFBbUIsRUFBRSxDQUFDOzRCQUMvQyxJQUFJLENBQUM7Z0NBQ0gsTUFBTSxpQkFBaUIsQ0FBQyxFQUFFLEVBQUUsQ0FBQTs0QkFDOUIsQ0FBQzs0QkFBQyxPQUFPLE9BQU8sRUFBRSxDQUFDO2dDQUNqQixJQUFJLE9BQU8sWUFBWSxtQkFBbUIsRUFBRSxDQUFDO29DQUMzQyxNQUFNLElBQUksS0FBSyxDQUFDLCtDQUErQyxTQUFTLENBQUMsSUFBSSxFQUFFLEVBQUUsRUFBQyxLQUFLLEVBQUUsT0FBTyxFQUFDLENBQUMsQ0FBQTtnQ0FDcEcsQ0FBQztxQ0FBTSxDQUFDO29DQUNOLE1BQU0sT0FBTyxDQUFBO2dDQUNmLENBQUM7NEJBQ0gsQ0FBQzt3QkFDSCxDQUFDOzZCQUFNLENBQUM7NEJBQ04sTUFBTSxXQUFXLENBQUE7d0JBQ25CLENBQUM7b0JBQ0gsQ0FBQztvQkFFRCxNQUFNLGdCQUFnQixDQUFDLGFBQWEsQ0FBQyxFQUFFLEVBQUUsVUFBVSxDQUFDLENBQUE7Z0JBQ3RELENBQUM7cUJBQU0sQ0FBQztvQkFDTixJQUFJLENBQUM7d0JBQ0gsTUFBTSxpQkFBaUIsQ0FBQyxJQUFJLEVBQUUsQ0FBQTtvQkFDaEMsQ0FBQztvQkFBQyxPQUFPLFNBQVMsRUFBRSxDQUFDO3dCQUNuQixJQUFJLFNBQVMsWUFBWSxtQkFBbUIsRUFBRSxDQUFDOzRCQUM3QyxNQUFNLElBQUksS0FBSyxDQUFDLHFDQUFxQyxTQUFTLENBQUMsSUFBSSxtRUFBbUUsRUFBRSxFQUFDLEtBQUssRUFBRSxTQUFTLEVBQUMsQ0FBQyxDQUFBO3dCQUM3SixDQUFDOzZCQUFNLENBQUM7NEJBQ04sTUFBTSxTQUFTLENBQUE7d0JBQ2pCLENBQUM7b0JBQ0gsQ0FBQztvQkFFRCxNQUFNLGdCQUFnQixDQUFDLGFBQWEsQ0FBQyxFQUFFLEVBQUUsVUFBVSxDQUFDLENBQUE7Z0JBQ3RELENBQUM7Z0JBRUQsT0FBTyxJQUFJLENBQUE7WUFDYixDQUFDO1lBQ0QsMEVBQTBFO1lBQzFFLDJFQUEyRTtZQUMzRSwwRUFBMEU7WUFDMUUsRUFBQyxtQkFBbUIsRUFBRSxJQUFJLEVBQUMsQ0FDNUIsQ0FBQTtZQUVELElBQUksQ0FBQyxhQUFhO2dCQUFFLFNBQVE7WUFFNUIsT0FBTyxHQUFHLElBQUksQ0FBQTtRQUNoQixDQUFDO1FBRUQsT0FBTyxPQUFPLENBQUE7SUFDaEIsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCB7ZGlnZ30gZnJvbSBcImRpZ2dlcml6ZVwiXG5pbXBvcnQgKiBhcyBpbmZsZWN0aW9uIGZyb20gXCJpbmZsZWN0aW9uXCJcbmltcG9ydCBMb2dnZXIgZnJvbSBcIi4uL2xvZ2dlci5qc1wiXG5pbXBvcnQgTWlncmF0aW9uc0xlZGdlciBmcm9tIFwiLi9taWdyYXRpb25zLWxlZGdlci5qc1wiXG5pbXBvcnQgQWR2aXNvcnlMb2NrUnVubmVyIGZyb20gXCIuL2Fkdmlzb3J5LWxvY2stcnVubmVyLmpzXCJcbmltcG9ydCB7Tm90SW1wbGVtZW50ZWRFcnJvcn0gZnJvbSBcIi4vbWlncmF0aW9uL2luZGV4LmpzXCJcbmltcG9ydCB7IG1pZ3JhdGlvbkV4ZWN1dGlvblBoYXNlLCBtaWdyYXRpb25SdW5zSW5FeGVjdXRpb25QaGFzZSB9IGZyb20gXCIuL21pZ3JhdGlvbi1leGVjdXRpb24tcGhhc2UuanNcIlxuaW1wb3J0IHJlc3RBcmdzRXJyb3IgZnJvbSBcIi4uL3V0aWxzL3Jlc3QtYXJncy1lcnJvci5qc1wiXG5cbi8qKlxuICogQnVpbGRzIHRoZSBhZHZpc29yeS1sb2NrIG5hbWUgdGhhdCBzZXJpYWxpc2VzIG1pZ3JhdGlvbnMgZm9yIG9uZSBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICpcbiAqIFRoZSBuYW1lIGlzIGRlcml2ZWQgZnJvbSB0aGUgZGF0YWJhc2UgaWRlbnRpZmllciBvbmx5IChub3QgdGhlIG1pZ3JhdGlvbikgc28gdGhhdFxuICogY29uY3VycmVudCBwcm9jZXNzZXMgcXVldWUgb24gb25lIGxvY2sgd2hpbGUgYXBwbHlpbmcgdGhlIHBlbmRpbmcgc2V0LCBpbnN0ZWFkIG9mXG4gKiByYWNpbmcgb24gaW5kaXZpZHVhbCBEREwgc3RhdGVtZW50cy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBkYklkZW50aWZpZXIgLSBEYXRhYmFzZSBpZGVudGlmaWVyIGJlaW5nIG1pZ3JhdGVkLlxuICogQHJldHVybnMge3N0cmluZ30gLSBBZHZpc29yeSBsb2NrIG5hbWUuXG4gKi9cbmZ1bmN0aW9uIG1pZ3JhdGlvbnNBZHZpc29yeUxvY2tOYW1lKGRiSWRlbnRpZmllcikge1xuICByZXR1cm4gYHZlbG9jaW91czptaWdyYXRpb25zOiR7ZGJJZGVudGlmaWVyfWBcbn1cblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzRGF0YWJhc2VNaWdyYXRvciB7XG4gIC8qKlxuICAgKiBNaWdyYXRpb25zIHZlcnNpb25zLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmVjb3JkPHN0cmluZywgYm9vbGVhbj4+fSAqL1xuICBtaWdyYXRpb25zVmVyc2lvbnMgPSB7fVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gYXJncy5jb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gW2FyZ3MuZGF0YWJhc2VJZGVudGlmaWVyc10gLSBPcHRpb25hbCBkYXRhYmFzZSBpZGVudGlmaWVycyB0byBtaWdyYXRlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vbWlncmF0aW9uLWV4ZWN1dGlvbi1waGFzZS5qc1wiKS5NaWdyYXRpb25FeGVjdXRpb25QaGFzZX0gW2FyZ3MuZXhlY3V0aW9uUGhhc2VdIC0gT3B0aW9uYWwgbWlncmF0aW9uIGV4ZWN1dGlvbiBwaGFzZSB0byBzZWxlY3QuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Y29uZmlndXJhdGlvbiwgZGF0YWJhc2VJZGVudGlmaWVycywgZXhlY3V0aW9uUGhhc2UsIC4uLnJlc3RBcmdzfSkge1xuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG5cbiAgICBpZiAoIWNvbmZpZ3VyYXRpb24pIHRocm93IG5ldyBFcnJvcihcImNvbmZpZ3VyYXRpb24gYXJndW1lbnQgaXMgcmVxdWlyZWRcIilcblxuICAgIHRoaXMuY29uZmlndXJhdGlvbiA9IGNvbmZpZ3VyYXRpb25cbiAgICB0aGlzLmRhdGFiYXNlSWRlbnRpZmllcnMgPSBkYXRhYmFzZUlkZW50aWZpZXJzXG4gICAgdGhpcy5leGVjdXRpb25QaGFzZSA9IGV4ZWN1dGlvblBoYXNlID09PSB1bmRlZmluZWQgPyB1bmRlZmluZWQgOiBtaWdyYXRpb25FeGVjdXRpb25QaGFzZShleGVjdXRpb25QaGFzZSlcbiAgICB0aGlzLmxvZ2dlciA9IG5ldyBMb2dnZXIodGhpcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhbmRsZXMgZGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGRiSWRlbnRpZmllciAtIERhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhpcyBtaWdyYXRvciBzaG91bGQgdG91Y2ggdGhlIGRhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqL1xuICBoYW5kbGVzRGF0YWJhc2VJZGVudGlmaWVyKGRiSWRlbnRpZmllcikge1xuICAgIGlmICghdGhpcy5kYXRhYmFzZUlkZW50aWZpZXJzKSByZXR1cm4gdHJ1ZVxuXG4gICAgcmV0dXJuIHRoaXMuZGF0YWJhc2VJZGVudGlmaWVycy5pbmNsdWRlcyhkYklkZW50aWZpZXIpXG4gIH1cblxuXG4gIC8qKlxuICAgKiBSdW5zIHByZXBhcmUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBwcmVwYXJlKCkge1xuICAgIGNvbnNvbGUuZXJyb3IoXCJbTUlHLURFQlVHXSBwcmVwYXJlKCkgc3RhcnRcIilcbiAgICBhd2FpdCB0aGlzLmNyZWF0ZU1pZ3JhdGlvbnNUYWJsZSgpXG4gICAgY29uc29sZS5lcnJvcihcIltNSUctREVCVUddIGNyZWF0ZU1pZ3JhdGlvbnNUYWJsZSBkb25lXCIpXG4gICAgYXdhaXQgdGhpcy5sb2FkTWlncmF0aW9uc1ZlcnNpb25zKClcbiAgICBjb25zb2xlLmVycm9yKFwiW01JRy1ERUJVR10gcHJlcGFyZSgpIGRvbmVcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNyZWF0ZSBtaWdyYXRpb25zIHRhYmxlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgY3JlYXRlTWlncmF0aW9uc1RhYmxlKCkge1xuICAgIGNvbnN0IGRicyA9IGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5nZXRDdXJyZW50Q29ubmVjdGlvbnMoKVxuXG4gICAgZm9yIChjb25zdCBkYklkZW50aWZpZXIgaW4gZGJzKSB7XG4gICAgICBpZiAoIXRoaXMuaGFuZGxlc0RhdGFiYXNlSWRlbnRpZmllcihkYklkZW50aWZpZXIpKSBjb250aW51ZVxuXG4gICAgICBhd2FpdCB0aGlzLmNyZWF0ZU1pZ3JhdGlvbnNUYWJsZUZvckRhdGFiYXNlKHtkYklkZW50aWZpZXIsIGRiOiBkYnNbZGJJZGVudGlmaWVyXX0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY3JlYXRlIG1pZ3JhdGlvbnMgdGFibGUgZm9yIGRhdGFiYXNlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5kYklkZW50aWZpZXIgLSBEYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGFyZ3MuZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgY3JlYXRlTWlncmF0aW9uc1RhYmxlRm9yRGF0YWJhc2Uoe2RiSWRlbnRpZmllciwgZGJ9KSB7XG4gICAgY29uc3QgZGF0YWJhc2VDb25maWd1cmF0aW9uID0gdGhpcy5jb25maWd1cmF0aW9uLmdldERhdGFiYXNlSWRlbnRpZmllcihkYklkZW50aWZpZXIpXG5cbiAgICBpZiAoIWRhdGFiYXNlQ29uZmlndXJhdGlvbi5taWdyYXRpb25zKSB7XG4gICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgJHtkYklkZW50aWZpZXJ9IGlzbid0IGNvbmZpZ3VyZWQgZm9yIG1pZ3JhdGlvbnMgLSBza2lwcGluZyBjcmVhdGluZyBtaWdyYXRpb25zIHRhYmxlIGZvciBpdGApXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAoYXdhaXQgdGhpcy5taWdyYXRpb25zVGFibGVFeGlzdChkYikpIHtcbiAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGAke2RiSWRlbnRpZmllcn0gbWlncmF0aW9ucyB0YWJsZSBhbHJlYWR5IGV4aXN0cyAtIHNraXBwaW5nYClcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5sb2dnZXIuZGVidWcoXCJDcmVhdGluZyBzY2hlbWFfbWlncmF0aW9ucyB0YWJsZSB2aWEgTWlncmF0aW9uc0xlZGdlclwiKVxuICAgICAgYXdhaXQgTWlncmF0aW9uc0xlZGdlci5lbnN1cmVUYWJsZShkYilcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYXMgcnVuIG1pZ3JhdGlvbiB2ZXJzaW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZGJJZGVudGlmaWVyIC0gRGIgaWRlbnRpZmllci5cbiAgICogQHBhcmFtIHtudW1iZXJ9IHZlcnNpb24gLSBWZXJzaW9uLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGl0IGhhcyBydW4gbWlncmF0aW9uIHZlcnNpb24uXG4gICAqL1xuICBoYXNSdW5NaWdyYXRpb25WZXJzaW9uKGRiSWRlbnRpZmllciwgdmVyc2lvbikge1xuICAgIGlmICghdGhpcy5taWdyYXRpb25zVmVyc2lvbnMpIHRocm93IG5ldyBFcnJvcihcIk1pZ3JhdGlvbnMgdmVyc2lvbnMgaGFzbid0IGJlZW4gbG9hZGVkIHlldFwiKVxuICAgIGlmICghdGhpcy5taWdyYXRpb25zVmVyc2lvbnNbZGJJZGVudGlmaWVyXSkgdGhyb3cgbmV3IEVycm9yKGBNaWdyYXRpb25zIHZlcnNpb25zIGhhc24ndCBiZWVuIGxvYWRlZCB5ZXQgZm9yIGRiOiAke2RiSWRlbnRpZmllcn1gKVxuXG4gICAgaWYgKHZlcnNpb24gaW4gdGhpcy5taWdyYXRpb25zVmVyc2lvbnNbZGJJZGVudGlmaWVyXSkge1xuICAgICAgcmV0dXJuIHRydWVcbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1pZ3JhdGUgZmlsZXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9taWdyYXRvci90eXBlcy5qc1wiKS5NaWdyYXRpb25PYmplY3RUeXBlW119IGZpbGVzIC0gRmlsZXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9taWdyYXRvci90eXBlcy5qc1wiKS5JbXBvcnRGdWxscGF0aENhbGxiYWNrVHlwZX0gaW1wb3J0Q2FsbGJhY2sgLSBJbXBvcnQgY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IC0gTnVtYmVyIG9mIG1pZ3JhdGlvbnMgYWN0dWFsbHkgYXBwbGllZCAobm90IHNraXBwZWQgYXMgYWxyZWFkeS1ydW4pLlxuICAgKi9cbiAgYXN5bmMgbWlncmF0ZUZpbGVzKGZpbGVzLCBpbXBvcnRDYWxsYmFjaykge1xuICAgIGxldCBhcHBsaWVkQ291bnQgPSAwXG4gICAgY29uc29sZS5lcnJvcihcIltNSUctREVCVUddIG1pZ3JhdGVGaWxlcyBjb3VudD1cIiArIGZpbGVzLmxlbmd0aClcblxuICAgIGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5lbnN1cmVDb25uZWN0aW9ucyh7ZGF0YWJhc2VJZGVudGlmaWVyczogdGhpcy5kYXRhYmFzZUlkZW50aWZpZXJzLCBuYW1lOiBcIkRhdGFiYXNlIG1pZ3JhdG9yOiBtaWdyYXRlIGZpbGVzXCJ9LCBhc3luYyAoKSA9PiB7XG4gICAgICBmb3IgKGNvbnN0IG1pZ3JhdGlvbiBvZiBmaWxlcykge1xuICAgICAgICBjb25zdCBhcHBsaWVkID0gYXdhaXQgdGhpcy5ydW5NaWdyYXRpb25GaWxlKHtcbiAgICAgICAgICBtaWdyYXRpb24sXG4gICAgICAgICAgcmVxdWlyZU1pZ3JhdGlvbjogYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgaWYgKCFtaWdyYXRpb24uZnVsbFBhdGgpIHRocm93IG5ldyBFcnJvcihgTWlncmF0aW9uIGRpZG4ndCBoYXZlIGEgZnVsbFBhdGgga2V5OiAke09iamVjdC5rZXlzKG1pZ3JhdGlvbikuam9pbihcIiwgXCIpfWApXG5cbiAgICAgICAgICAgIGNvbnN0IG1pZ3JhdGlvbkltcG9ydCA9IGF3YWl0IGltcG9ydENhbGxiYWNrKG1pZ3JhdGlvbi5mdWxsUGF0aClcblxuICAgICAgICAgICAgaWYgKCFtaWdyYXRpb25JbXBvcnQpIHtcbiAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBNaWdyYXRpb24gZmlsZSBtdXN0IGV4cG9ydCBtaWdyYXRpb24gY2xhc3M6ICR7bWlncmF0aW9uLmZ1bGxQYXRofWApXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJldHVybiBtaWdyYXRpb25JbXBvcnRcbiAgICAgICAgICB9XG4gICAgICAgIH0pXG5cbiAgICAgICAgaWYgKGFwcGxpZWQpIGFwcGxpZWRDb3VudCsrXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHRoaXMuX2FmdGVyTWlncmF0aW9ucygpXG4gICAgfSlcblxuICAgIHJldHVybiBhcHBsaWVkQ291bnRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1pZ3JhdGUgZmlsZXMgZnJvbSByZXF1aXJlIGNvbnRleHQuXG4gICAqXG4gICAqIEFwcGxpY2F0aW9uIG1pZ3JhdGlvbnMgYmVsb25nIHRvIHRoZSBzY2hlbWEtb3duaW5nIGxpZmVjeWNsZS4gSFRUUCB3b3JrZXJcbiAgICogdGhyZWFkcyAoYHByb2Nlc3NDb250ZXh0LnR5cGUgPT09IFwid29ya2VyLWhhbmRsZXJcImApIGVhY2ggcnVuIHRoZVxuICAgKiBhcHBsaWNhdGlvbidzIGBpbml0aWFsaXplTW9kZWxzYCBob29rLCBzbyBhbiBhcHAgdGhhdCBtaWdyYXRlcyBmcm9tIHRoYXQgaG9va1xuICAgKiB3b3VsZCBhcHBseSB0aGUgcGVuZGluZyBzZXQgKGFuZCB3cml0ZSB0aGUgc3RydWN0dXJlIGR1bXApIG9uY2UgcGVyIHdvcmtlci5cbiAgICogVGhlIHNlcnZlciBwcm9jZXNzIGFuZCBkZXBsb3kgbWlncmF0aW9uIHRhc2tzIG1pZ3JhdGUgYmVmb3JlIHdvcmtlcnMgc3RhcnQsXG4gICAqIHNvIHdvcmtlcnMgc2tpcCBoZXJlIGluc3RlYWQgb2YgcmVwZWF0aW5nIHRoYXQgd29yay5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL21pZ3JhdG9yL3R5cGVzLmpzXCIpLlJlcXVpcmVNaWdyYXRpb25Db250ZXh0VHlwZX0gcmVxdWlyZUNvbnRleHQgLSBSZXF1aXJlIGNvbnRleHQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBtaWdyYXRlRmlsZXNGcm9tUmVxdWlyZUNvbnRleHQocmVxdWlyZUNvbnRleHQpIHtcbiAgICBjb25zdCBwcm9jZXNzQ29udGV4dCA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRBcHBsaWNhdGlvblByb2Nlc3NDb250ZXh0KClcblxuICAgIGlmIChwcm9jZXNzQ29udGV4dD8udHlwZSA9PT0gXCJ3b3JrZXItaGFuZGxlclwiKSB7XG4gICAgICBhd2FpdCB0aGlzLmxvZ2dlci5kZWJ1ZyhcIlNraXBwaW5nIGFwcGxpY2F0aW9uIG1pZ3JhdGlvbnMgaW4gYW4gSFRUUCB3b3JrZXIgdGhyZWFkIC0gdGhlIHNjaGVtYS1vd25pbmcgcHJvY2VzcyBtaWdyYXRlcyBiZWZvcmUgd29ya2VycyBzdGFydFwiLCB7XG4gICAgICAgIGluc3RhbmNlSWQ6IHByb2Nlc3NDb250ZXh0Lmluc3RhbmNlSWQsXG4gICAgICAgIHByb2Nlc3NUeXBlOiBwcm9jZXNzQ29udGV4dC50eXBlXG4gICAgICB9KVxuXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBmaWxlcyA9IHRoaXMubWlncmF0aW9uc0Zyb21SZXF1aXJlQ29udGV4dChyZXF1aXJlQ29udGV4dClcblxuICAgIGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5lbnN1cmVDb25uZWN0aW9ucyh7ZGF0YWJhc2VJZGVudGlmaWVyczogdGhpcy5kYXRhYmFzZUlkZW50aWZpZXJzLCBuYW1lOiBcIkRhdGFiYXNlIG1pZ3JhdG9yOiBtaWdyYXRlIHJlcXVpcmUtY29udGV4dCBmaWxlc1wifSwgYXN5bmMgKCkgPT4ge1xuICAgICAgZm9yIChjb25zdCBtaWdyYXRpb24gb2YgZmlsZXMpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5ydW5NaWdyYXRpb25GaWxlKHtcbiAgICAgICAgICBtaWdyYXRpb24sXG4gICAgICAgICAgcmVxdWlyZU1pZ3JhdGlvbjogYXN5bmMgKCkgPT4gcmVxdWlyZUNvbnRleHQobWlncmF0aW9uLmZpbGUpLmRlZmF1bHRcbiAgICAgICAgfSlcbiAgICAgIH1cblxuICAgICAgYXdhaXQgdGhpcy5fYWZ0ZXJNaWdyYXRpb25zKClcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIE1pZ3JhdGVzIGV4YWN0bHkgb25lIGFscmVhZHktY2FwdHVyZWQgcGh5c2ljYWwgZGF0YWJhc2UuIFRoaXMgaXMgdGhlXG4gICAqIGZyb250ZW5kL3RlbmFudCBjb3VudGVycGFydCB0byB0aGUgYW1iaWVudCBtdWx0aS1kYXRhYmFzZSBlbnRyeXBvaW50czpcbiAgICogY2FsbGVycyBvd24gdGhlIGNhcHR1cmVkIGNvbm5lY3Rpb24gYW5kIG5vIGNvbmZpZ3VyYXRpb24gZmFsbGJhY2sgaXMgcmVhZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBDYXB0dXJlZCBtaWdyYXRpb24gYXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRGF0YWJhc2VDb25maWd1cmF0aW9uVHlwZX0gYXJncy5kYXRhYmFzZUNvbmZpZ3VyYXRpb24gLSBDYXB0dXJlZCBwaHlzaWNhbCBkYXRhYmFzZSBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5kYXRhYmFzZUlkZW50aWZpZXIgLSBMb2dpY2FsIGRhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gYXJncy5kYiAtIENhcHR1cmVkIHBoeXNpY2FsIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9taWdyYXRvci90eXBlcy5qc1wiKS5SZXF1aXJlTWlncmF0aW9uQ29udGV4dFR5cGV9IGFyZ3MucmVxdWlyZUNvbnRleHQgLSBGcm9udGVuZCBtaWdyYXRpb24gcmVxdWlyZSBjb250ZXh0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIE51bWJlciBvZiBuZXdseSBhcHBsaWVkIG1pZ3JhdGlvbnMuXG4gICAqL1xuICBhc3luYyBtaWdyYXRlUmVxdWlyZUNvbnRleHRGb3JEYXRhYmFzZSh7ZGF0YWJhc2VDb25maWd1cmF0aW9uLCBkYXRhYmFzZUlkZW50aWZpZXIsIGRiLCByZXF1aXJlQ29udGV4dH0pIHtcbiAgICBpZiAoIWRhdGFiYXNlQ29uZmlndXJhdGlvbi5taWdyYXRpb25zKSByZXR1cm4gMFxuXG4gICAgYXdhaXQgTWlncmF0aW9uc0xlZGdlci5lbnN1cmVUYWJsZShkYilcbiAgICBjb25zdCBhcHBsaWVkVmVyc2lvbnMgPSBuZXcgU2V0KGF3YWl0IE1pZ3JhdGlvbnNMZWRnZXIuYXBwbGllZFZlcnNpb25zKGRiKSlcbiAgICBjb25zdCBtaWdyYXRpb25zID0gdGhpcy5taWdyYXRpb25zRnJvbVJlcXVpcmVDb250ZXh0KHJlcXVpcmVDb250ZXh0KVxuICAgIGxldCBhcHBsaWVkQ291bnQgPSAwXG5cbiAgICBmb3IgKGNvbnN0IG1pZ3JhdGlvbiBvZiBtaWdyYXRpb25zKSB7XG4gICAgICBjb25zdCB2ZXJzaW9uID0gYCR7bWlncmF0aW9uLmRhdGV9YFxuXG4gICAgICBpZiAoYXBwbGllZFZlcnNpb25zLmhhcyh2ZXJzaW9uKSkgY29udGludWVcblxuICAgICAgY29uc3QgTWlncmF0aW9uQ2xhc3MgPSByZXF1aXJlQ29udGV4dChtaWdyYXRpb24uZmlsZSkuZGVmYXVsdFxuXG4gICAgICBpZiAoIU1pZ3JhdGlvbkNsYXNzIHx8IHR5cGVvZiBNaWdyYXRpb25DbGFzcyAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgTWlncmF0aW9uICR7bWlncmF0aW9uLmZpbGV9IG11c3QgZXhwb3J0IGEgZGVmYXVsdCBtaWdyYXRpb24gY2xhc3MuIFR5cGU6ICR7dHlwZW9mIE1pZ3JhdGlvbkNsYXNzfWApXG4gICAgICB9XG4gICAgICBpZiAoIW1pZ3JhdGlvblJ1bnNJbkV4ZWN1dGlvblBoYXNlKE1pZ3JhdGlvbkNsYXNzLCB0aGlzLmV4ZWN1dGlvblBoYXNlKSkgY29udGludWVcbiAgICAgIGlmICghKE1pZ3JhdGlvbkNsYXNzLmdldERhdGFiYXNlSWRlbnRpZmllcnMoKSB8fCBbXCJkZWZhdWx0XCJdKS5pbmNsdWRlcyhkYXRhYmFzZUlkZW50aWZpZXIpKSBjb250aW51ZVxuXG4gICAgICBjb25zdCBtaWdyYXRpb25JbnN0YW5jZSA9IG5ldyBNaWdyYXRpb25DbGFzcyh7Y29uZmlndXJhdGlvbjogdGhpcy5jb25maWd1cmF0aW9uLCBkYXRhYmFzZUlkZW50aWZpZXIsIGRifSlcblxuICAgICAgYXdhaXQgdGhpcy5ydW5NaWdyYXRpb25VcCh7bWlncmF0aW9uLCBtaWdyYXRpb25JbnN0YW5jZX0pXG4gICAgICBhd2FpdCBNaWdyYXRpb25zTGVkZ2VyLnJlY29yZFZlcnNpb24oZGIsIHZlcnNpb24pXG4gICAgICBhcHBsaWVkVmVyc2lvbnMuYWRkKHZlcnNpb24pXG4gICAgICBhcHBsaWVkQ291bnQrK1xuICAgIH1cblxuICAgIHJldHVybiBhcHBsaWVkQ291bnRcbiAgfVxuXG4gIC8qKlxuICAgKiBQYXJzZXMgYW5kIG9yZGVycyBtaWdyYXRpb25zIGZyb20gYSBicm93c2VyL25hdGl2ZSByZXF1aXJlIGNvbnRleHQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9taWdyYXRvci90eXBlcy5qc1wiKS5SZXF1aXJlTWlncmF0aW9uQ29udGV4dFR5cGV9IHJlcXVpcmVDb250ZXh0IC0gTWlncmF0aW9uIHJlcXVpcmUgY29udGV4dC5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vbWlncmF0b3IvdHlwZXMuanNcIikuTWlncmF0aW9uT2JqZWN0VHlwZVtdfSAtIE9yZGVyZWQgbWlncmF0aW9ucy5cbiAgICovXG4gIG1pZ3JhdGlvbnNGcm9tUmVxdWlyZUNvbnRleHQocmVxdWlyZUNvbnRleHQpIHtcbiAgICBjb25zdCBtaWdyYXRpb25zID0gW11cblxuICAgIGZvciAoY29uc3QgZmlsZSBvZiByZXF1aXJlQ29udGV4dC5rZXlzKCkpIHtcbiAgICAgIGNvbnN0IG1hdGNoID0gZmlsZS5tYXRjaCgvKFxcZHsxMywxNH0pLSguKylcXC5qcyQvKVxuXG4gICAgICBpZiAoIW1hdGNoKSBjb250aW51ZVxuXG4gICAgICBsZXQgZmlsZU5hbWUgPSBmaWxlXG4gICAgICBsZXQgZGF0ZU51bWJlciA9IG1hdGNoWzFdXG5cbiAgICAgIGlmIChkYXRlTnVtYmVyLmxlbmd0aCA9PSAxMykge1xuICAgICAgICBkYXRlTnVtYmVyID0gYDIke2RhdGVOdW1iZXJ9YFxuICAgICAgICBmaWxlTmFtZSA9IGAyJHtmaWxlTmFtZX1gXG4gICAgICB9XG5cbiAgICAgIG1pZ3JhdGlvbnMucHVzaCh7XG4gICAgICAgIGRhdGU6IHBhcnNlSW50KGRhdGVOdW1iZXIpLFxuICAgICAgICBmaWxlOiBmaWxlTmFtZSxcbiAgICAgICAgbWlncmF0aW9uQ2xhc3NOYW1lOiBpbmZsZWN0aW9uLmNhbWVsaXplKG1hdGNoWzJdLnJlcGxhY2VBbGwoXCItXCIsIFwiX1wiKSlcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgcmV0dXJuIG1pZ3JhdGlvbnMuc29ydCgobWlncmF0aW9uMSwgbWlncmF0aW9uMikgPT4gbWlncmF0aW9uMS5kYXRlIC0gbWlncmF0aW9uMi5kYXRlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgb25lIG1pZ3JhdGlvbidzIHVwd2FyZCBpbXBsZW1lbnRhdGlvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBNaWdyYXRpb24gYXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vbWlncmF0b3IvdHlwZXMuanNcIikuTWlncmF0aW9uT2JqZWN0VHlwZX0gYXJncy5taWdyYXRpb24gLSBNaWdyYXRpb24gZGVzY3JpcHRvci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL21pZ3JhdGlvbi9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1pZ3JhdGlvbkluc3RhbmNlIC0gTWlncmF0aW9uIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciB0aGUgbWlncmF0aW9uIHN1Y2NlZWRzLlxuICAgKi9cbiAgYXN5bmMgcnVuTWlncmF0aW9uVXAoe21pZ3JhdGlvbiwgbWlncmF0aW9uSW5zdGFuY2V9KSB7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IG1pZ3JhdGlvbkluc3RhbmNlLmNoYW5nZSgpXG4gICAgfSBjYXRjaCAoY2hhbmdlRXJyb3IpIHtcbiAgICAgIGlmICghKGNoYW5nZUVycm9yIGluc3RhbmNlb2YgTm90SW1wbGVtZW50ZWRFcnJvcikpIHRocm93IGNoYW5nZUVycm9yXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IG1pZ3JhdGlvbkluc3RhbmNlLnVwKClcbiAgICAgIH0gY2F0Y2ggKHVwRXJyb3IpIHtcbiAgICAgICAgaWYgKHVwRXJyb3IgaW5zdGFuY2VvZiBOb3RJbXBsZW1lbnRlZEVycm9yKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGAnY2hhbmdlJyBvciAndXAnIGRpZG4ndCBleGlzdCBvbiBtaWdyYXRpb246ICR7bWlncmF0aW9uLmZpbGV9YCwge2NhdXNlOiB1cEVycm9yfSlcbiAgICAgICAgfVxuXG4gICAgICAgIHRocm93IHVwRXJyb3JcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBhZnRlciBtaWdyYXRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX2FmdGVyTWlncmF0aW9ucygpIHtcbiAgICBjb25zdCBlbnZpcm9ubWVudEhhbmRsZXIgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RW52aXJvbm1lbnRIYW5kbGVyKClcbiAgICBjb25zdCBkYnMgPSBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0Q3VycmVudENvbm5lY3Rpb25zKClcbiAgICBjb25zdCBmaWx0ZXJlZERicyA9IE9iamVjdC5mcm9tRW50cmllcyhcbiAgICAgIE9iamVjdC5lbnRyaWVzKGRicykuZmlsdGVyKChbZGJJZGVudGlmaWVyXSkgPT4ge1xuICAgICAgICBpZiAoIXRoaXMuaGFuZGxlc0RhdGFiYXNlSWRlbnRpZmllcihkYklkZW50aWZpZXIpKSByZXR1cm4gZmFsc2VcblxuICAgICAgICByZXR1cm4gQm9vbGVhbih0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RGF0YWJhc2VJZGVudGlmaWVyKGRiSWRlbnRpZmllcikubWlncmF0aW9ucylcbiAgICAgIH0pXG4gICAgKVxuXG4gICAgaWYgKCFlbnZpcm9ubWVudEhhbmRsZXIgfHwgT2JqZWN0LmtleXMoZmlsdGVyZWREYnMpLmxlbmd0aCA9PSAwKSByZXR1cm5cblxuICAgIC8vIFNlcmlhbGlzZSB0aGUgZnJhbWV3b3JrLXNjaGVtYSBib290c3RyYXAgYWNyb3NzIHByb2Nlc3Nlcy4gVGhpcyBjcmVhdGVzIHRoZSBhdHRhY2htZW50c1xuICAgIC8vIGFuZCBiYWNrZ3JvdW5kLWpvYnMgdGFibGVzLCBhbmQgaXQgcnVucyBvbmNlIHBlciBwcm9jZXNzIG91dHNpZGUgdGhlIHBlci1taWdyYXRpb24gbG9vcDpcbiAgICAvLyB3aXRob3V0IHRoaXMgbG9jaywgdHdvIHByb2Nlc3NlcyBib290c3RyYXBwaW5nIG9uZSBkYXRhYmFzZSByYWNlIG9uIENSRUFURSBUQUJMRSAvXG4gICAgLy8gQ1JFQVRFIElOREVYIGFuZCBvbmUgZGllcyBtaWQtYm9vdCAoZHVwbGljYXRlIG9iamVjdC9pbmRleCkuXG4gICAgZm9yIChjb25zdCBbZGJJZGVudGlmaWVyLCBkYl0gb2YgT2JqZWN0LmVudHJpZXMoZmlsdGVyZWREYnMpKSB7XG4gICAgICBjb25zdCBydW5uZXIgPSBuZXcgQWR2aXNvcnlMb2NrUnVubmVyKHtcbiAgICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5jb25maWd1cmF0aW9uLFxuICAgICAgICBjb25uZWN0aW9uUHJvdmlkZXI6ICgpID0+IGRiLFxuICAgICAgICBkYXRhYmFzZUlkZW50aWZpZXI6IGRiSWRlbnRpZmllclxuICAgICAgfSlcblxuICAgICAgYXdhaXQgcnVubmVyLndpdGhBZHZpc29yeUxvY2soXG4gICAgICAgIG1pZ3JhdGlvbnNBZHZpc29yeUxvY2tOYW1lKGRiSWRlbnRpZmllciksXG4gICAgICAgIGFzeW5jICgpID0+IHtcbiAgICAgICAgICBhd2FpdCBlbnZpcm9ubWVudEhhbmRsZXIuZW5zdXJlRnJhbWV3b3JrU2NoZW1hKHtkYnM6IHtbZGJJZGVudGlmaWVyXTogZGJ9fSlcbiAgICAgICAgfSxcbiAgICAgICAge2RlZGljYXRlZENvbm5lY3Rpb246IHRydWV9XG4gICAgICApXG4gICAgfVxuXG4gICAgLy8gRW5zdXJlIFZlbG9jaW91cycgb3duIGZyYW1ld29yayBzY2hlbWEgYmVmb3JlIHRoZSBzdHJ1Y3R1cmUgZHVtcC4gVGhlIGR1bXAgaXNcbiAgICAvLyBnYXRlZCB0byBlbmFibGVkIGVudmlyb25tZW50cywgYnV0IG1pZ3JhdGlvbi1lbmFibGVkIGRhdGFiYXNlcyBtdXN0IGluY2x1ZGVcbiAgICAvLyBmcmFtZXdvcmsgdGFibGVzIHNvIGBkYjptaWdyYXRlYCBhbmQgc2NoZW1hOmxvYWQgcHJvZHVjZSBhIGNvbXBsZXRlIGRhdGFiYXNlLlxuICAgIGF3YWl0IGVudmlyb25tZW50SGFuZGxlci5hZnRlck1pZ3JhdGlvbnMoe2RiczogZmlsdGVyZWREYnN9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbG9hZCBtaWdyYXRpb25zIHZlcnNpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgbG9hZE1pZ3JhdGlvbnNWZXJzaW9ucygpIHtcbiAgICB0aGlzLm1pZ3JhdGlvbnNWZXJzaW9ucyA9IHt9XG5cbiAgICBjb25zdCBkYnMgPSBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0Q3VycmVudENvbm5lY3Rpb25zKClcblxuICAgIGZvciAoY29uc3QgZGJJZGVudGlmaWVyIGluIGRicykge1xuICAgICAgaWYgKCF0aGlzLmhhbmRsZXNEYXRhYmFzZUlkZW50aWZpZXIoZGJJZGVudGlmaWVyKSkgY29udGludWVcblxuICAgICAgYXdhaXQgdGhpcy5sb2FkTWlncmF0aW9uc1ZlcnNpb25zRm9yRGF0YWJhc2Uoe2RiSWRlbnRpZmllciwgZGI6IGRic1tkYklkZW50aWZpZXJdfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBsb2FkIG1pZ3JhdGlvbnMgdmVyc2lvbnMgZm9yIGRhdGFiYXNlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5kYklkZW50aWZpZXIgLSBEYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGFyZ3MuZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgbG9hZE1pZ3JhdGlvbnNWZXJzaW9uc0ZvckRhdGFiYXNlKHtkYklkZW50aWZpZXIsIGRifSkge1xuICAgIGNvbnN0IGRhdGFiYXNlQ29uZmlndXJhdGlvbiA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXREYXRhYmFzZUlkZW50aWZpZXIoZGJJZGVudGlmaWVyKVxuXG4gICAgaWYgKCFkYXRhYmFzZUNvbmZpZ3VyYXRpb24ubWlncmF0aW9ucykge1xuICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYCR7ZGJJZGVudGlmaWVyfSBpc24ndCBjb25maWd1cmVkIGZvciBtaWdyYXRpb25zIC0gc2tpcHBpbmcgbG9hZGluZyBtaWdyYXRpb25zIHZlcnNpb25zIGZvciBpdGApXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAoIWF3YWl0IHRoaXMubWlncmF0aW9uc1RhYmxlRXhpc3QoZGIpKSB7XG4gICAgICB0aGlzLmxvZ2dlci5pbmZvKGBNaWdyYXRpb24gdGFibGUgZG9lcyBub3QgZXhpc3QgZm9yICR7ZGJJZGVudGlmaWVyfSAtIHNraXBwaW5nIGxvYWRpbmcgbWlncmF0aW9ucyB2ZXJzaW9ucyBmb3IgaXRgKVxuICAgICAgZGVsZXRlIHRoaXMubWlncmF0aW9uc1ZlcnNpb25zW2RiSWRlbnRpZmllcl1cbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IHZlcnNpb25zID0gYXdhaXQgTWlncmF0aW9uc0xlZGdlci5hcHBsaWVkVmVyc2lvbnMoZGIpXG5cbiAgICB0aGlzLm1pZ3JhdGlvbnNWZXJzaW9uc1tkYklkZW50aWZpZXJdID0ge31cblxuICAgIGZvciAoY29uc3QgdmVyc2lvbiBvZiB2ZXJzaW9ucykge1xuICAgICAgdGhpcy5taWdyYXRpb25zVmVyc2lvbnNbZGJJZGVudGlmaWVyXVt2ZXJzaW9uXSA9IHRydWVcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBtaWdyYXRpb25zIHRhYmxlIGV4aXN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gUmVzb2x2ZXMgd2l0aCBXaGV0aGVyIG1pZ3JhdGlvbnMgdGFibGUgZXhpc3QuXG4gICAqL1xuICBhc3luYyBtaWdyYXRpb25zVGFibGVFeGlzdChkYikge1xuICAgIHJldHVybiBhd2FpdCBNaWdyYXRpb25zTGVkZ2VyLnRhYmxlRXhpc3RzKGRiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZXhlY3V0ZSByZXF1aXJlIGNvbnRleHQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9taWdyYXRvci90eXBlcy5qc1wiKS5SZXF1aXJlTWlncmF0aW9uQ29udGV4dFR5cGV9IHJlcXVpcmVDb250ZXh0IC0gUmVxdWlyZSBjb250ZXh0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgZXhlY3V0ZVJlcXVpcmVDb250ZXh0KHJlcXVpcmVDb250ZXh0KSB7XG4gICAgY29uc3QgbWlncmF0aW9uRmlsZXMgPSByZXF1aXJlQ29udGV4dC5rZXlzKClcblxuICAgIC8qKlxuICAgICAqIEZpbGVzLlxuICAgICAqIEB0eXBlIHtpbXBvcnQoXCIuL21pZ3JhdG9yL3R5cGVzLmpzXCIpLk1pZ3JhdGlvbk9iamVjdFR5cGVbXX0gKi9cbiAgICBsZXQgZmlsZXMgPSBbXVxuXG4gICAgZm9yIChjb25zdCBmaWxlIG9mIG1pZ3JhdGlvbkZpbGVzKSB7XG4gICAgICBjb25zdCBtYXRjaCA9IGZpbGUubWF0Y2goL14oXFxkezE0fSktKC4rKVxcLmpzJC8pXG5cbiAgICAgIGlmICghbWF0Y2gpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IGRhdGUgPSBwYXJzZUludChtYXRjaFsxXSlcbiAgICAgIGNvbnN0IG1pZ3JhdGlvbk5hbWUgPSBtYXRjaFsyXVxuICAgICAgY29uc3QgbWlncmF0aW9uQ2xhc3NOYW1lID0gaW5mbGVjdGlvbi5jYW1lbGl6ZShtaWdyYXRpb25OYW1lKVxuXG4gICAgICBjb25zdCBtaWdyYXRpb25PYmplY3QgPSAvKiogQHR5cGUge2ltcG9ydChcIi4vbWlncmF0b3IvdHlwZXMuanNcIikuTWlncmF0aW9uT2JqZWN0VHlwZX0gKi8gKHtcbiAgICAgICAgZmlsZSxcbiAgICAgICAgZGF0ZSxcbiAgICAgICAgbWlncmF0aW9uQ2xhc3NOYW1lXG4gICAgICB9KVxuXG4gICAgICBmaWxlcy5wdXNoKG1pZ3JhdGlvbk9iamVjdClcbiAgICB9XG5cbiAgICBmaWxlcyA9IGZpbGVzLnNvcnQoKG1pZ3JhdGlvbjEsIG1pZ3JhdGlvbjIpID0+IG1pZ3JhdGlvbjEuZGF0ZSAtIG1pZ3JhdGlvbjIuZGF0ZSlcblxuICAgIGZvciAoY29uc3QgbWlncmF0aW9uIG9mIGZpbGVzKSB7XG4gICAgICBhd2FpdCB0aGlzLnJ1bk1pZ3JhdGlvbkZpbGUoe1xuICAgICAgICBtaWdyYXRpb24sXG4gICAgICAgIHJlcXVpcmVNaWdyYXRpb246IGFzeW5jICgpID0+IHJlcXVpcmVDb250ZXh0KG1pZ3JhdGlvbi5maWxlKS5kZWZhdWx0XG4gICAgICB9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlc2V0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgcmVzZXQoKSB7XG4gICAgY29uc3QgZGJzID0gYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLmdldEN1cnJlbnRDb25uZWN0aW9ucygpXG5cbiAgICBmb3IgKGNvbnN0IGRiSWRlbnRpZmllciBpbiBkYnMpIHtcbiAgICAgIGlmICghdGhpcy5oYW5kbGVzRGF0YWJhc2VJZGVudGlmaWVyKGRiSWRlbnRpZmllcikpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IGRiID0gZGJzW2RiSWRlbnRpZmllcl1cblxuICAgICAgYXdhaXQgZGIud2l0aERpc2FibGVkRm9yZWlnbktleXMoYXN5bmMgKCkgPT4ge1xuICAgICAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgICAgIGNvbnN0IGVycm9ycyA9IFtdXG4gICAgICAgICAgbGV0IGFueVRhYmxlRHJvcHBlZCA9IGZhbHNlXG5cbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgZm9yIChjb25zdCB0YWJsZSBvZiBhd2FpdCBkYi5nZXRUYWJsZXMoKSkge1xuICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBEcm9wcGluZyB0YWJsZSAke3RhYmxlLmdldE5hbWUoKX1gKVxuXG4gICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgYXdhaXQgZGIuZHJvcFRhYmxlKHRhYmxlLmdldE5hbWUoKSwge2Nhc2NhZGU6IHRydWV9KVxuICAgICAgICAgICAgICAgIGFueVRhYmxlRHJvcHBlZCA9IHRydWVcbiAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICBlcnJvcnMucHVzaChlcnJvcilcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBicmVha1xuICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tdW51c2VkLXZhcnNcbiAgICAgICAgICAgIGlmIChlcnJvcnMubGVuZ3RoID4gMCAmJiBhbnlUYWJsZURyb3BwZWQpIHtcbiAgICAgICAgICAgICAgLy8gUmV0cnlcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIHRocm93IGVycm9yc1swXVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyByb2xsYmFjay5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL21pZ3JhdG9yL3R5cGVzLmpzXCIpLk1pZ3JhdGlvbk9iamVjdFR5cGVbXX0gZmlsZXMgLSBGaWxlcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL21pZ3JhdG9yL3R5cGVzLmpzXCIpLkltcG9ydEZ1bGxwYXRoQ2FsbGJhY2tUeXBlfSBpbXBvcnRDYWxsYmFjayBGdW5jdGlvbiB0byBpbXBvcnQgYSBmaWxlXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyByb2xsYmFjayhmaWxlcywgaW1wb3J0Q2FsbGJhY2spIHtcbiAgICBjb25zdCBsYXRlc3RNaWdyYXRpb25WZXJzaW9uID0gYXdhaXQgdGhpcy5fbGF0ZXN0TWlncmF0aW9uVmVyc2lvbigpXG5cbiAgICBpZiAoIWxhdGVzdE1pZ3JhdGlvblZlcnNpb24pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIk5vIG1pZ3JhdGlvbnMgaGF2ZSBiZWVuIHJ1biB5ZXRcIilcbiAgICB9XG5cbiAgICBjb25zdCBsYXRlc3RNaWdyYXRpb25WZXJzaW9uTnVtYmVyID0gcGFyc2VJbnQobGF0ZXN0TWlncmF0aW9uVmVyc2lvbilcbiAgICBjb25zdCBtaWdyYXRpb24gPSBmaWxlcy5maW5kKChmaWxlKSA9PiBmaWxlLmRhdGUgPT0gbGF0ZXN0TWlncmF0aW9uVmVyc2lvbk51bWJlcilcblxuICAgIGlmICghbWlncmF0aW9uKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE1pZ3JhdGlvbiBmaWxlIGZvciB2ZXJzaW9uICR7bGF0ZXN0TWlncmF0aW9uVmVyc2lvbk51bWJlcn0gbm90IGZvdW5kYClcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnJ1bk1pZ3JhdGlvbkZpbGUoe1xuICAgICAgbWlncmF0aW9uLFxuICAgICAgcmVxdWlyZU1pZ3JhdGlvbjogYXN5bmMgKCkgPT4ge1xuICAgICAgICBpZiAoIW1pZ3JhdGlvbi5mdWxsUGF0aCkgdGhyb3cgbmV3IEVycm9yKGBNaWdyYXRpb24gZGlkbid0IGhhdmUgYSBmdWxsUGF0aCBrZXk6ICR7T2JqZWN0LmtleXMobWlncmF0aW9uKS5qb2luKFwiLCBcIil9YClcblxuICAgICAgICByZXR1cm4gYXdhaXQgaW1wb3J0Q2FsbGJhY2sobWlncmF0aW9uLmZ1bGxQYXRoKVxuICAgICAgfSxcbiAgICAgIGRpcmVjdGlvbjogXCJkb3duXCJcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbGF0ZXN0IG1pZ3JhdGlvbiB2ZXJzaW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmcgfCB1bmRlZmluZWQ+fSBUaGUgbGF0ZXN0IG1pZ3JhdGlvbiB2ZXJzaW9uXG4gICAqL1xuICBhc3luYyBfbGF0ZXN0TWlncmF0aW9uVmVyc2lvbigpIHtcbiAgICBpZiAoIXRoaXMubWlncmF0aW9uc1ZlcnNpb25zKSBhd2FpdCB0aGlzLmxvYWRNaWdyYXRpb25zVmVyc2lvbnMoKVxuXG4gICAgLyoqXG4gICAgICogRGVmaW5lcyBoaWdoZXN0VmVyc2lvbi5cbiAgICAgKiBAdHlwZSB7c3RyaW5nIHwgdW5kZWZpbmVkfSAqL1xuICAgIGxldCBoaWdoZXN0VmVyc2lvblxuXG4gICAgZm9yIChjb25zdCBkYklkZW50aWZpZXIgaW4gdGhpcy5taWdyYXRpb25zVmVyc2lvbnMpIHtcbiAgICAgIGZvciAoY29uc3QgbWlncmF0aW9uVmVyc2lvbiBpbiB0aGlzLm1pZ3JhdGlvbnNWZXJzaW9uc1tkYklkZW50aWZpZXJdKSB7XG4gICAgICAgIGlmICghaGlnaGVzdFZlcnNpb24gfHwgbWlncmF0aW9uVmVyc2lvbiA+IGhpZ2hlc3RWZXJzaW9uKSB7XG4gICAgICAgICAgaGlnaGVzdFZlcnNpb24gPSBtaWdyYXRpb25WZXJzaW9uXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gaGlnaGVzdFZlcnNpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1biBtaWdyYXRpb24gZmlsZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL21pZ3JhdG9yL3R5cGVzLmpzXCIpLk1pZ3JhdGlvbk9iamVjdFR5cGV9IGFyZ3MubWlncmF0aW9uIC0gTWlncmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vbWlncmF0b3IvdHlwZXMuanNcIikuUmVxdWlyZU1pZ3JhdGlvblR5cGV9IGFyZ3MucmVxdWlyZU1pZ3JhdGlvbiAtIFJlcXVpcmUgbWlncmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuZGlyZWN0aW9uXSAtIERpcmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgbWlncmF0aW9uIHJhbiBvbiBhdCBsZWFzdCBvbmUgZGF0YWJhc2UgKGZhbHNlIGlmIHNraXBwZWQgYXMgYWxyZWFkeS1ydW4gZXZlcnl3aGVyZSkuXG4gICAqL1xuICBhc3luYyBydW5NaWdyYXRpb25GaWxlKHttaWdyYXRpb24sIHJlcXVpcmVNaWdyYXRpb24sIGRpcmVjdGlvbiA9IFwidXBcIn0pIHtcbiAgICBpZiAoIXRoaXMuY29uZmlndXJhdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiTm8gY29uZmlndXJhdGlvbiBzZXRcIilcbiAgICBjb25zb2xlLmVycm9yKFwiW01JRy1ERUJVR10gcnVuTWlncmF0aW9uRmlsZSBmaWxlPVwiICsgKG1pZ3JhdGlvbiAmJiBtaWdyYXRpb24uZmlsZSkpXG4gICAgaWYgKCF0aGlzLmNvbmZpZ3VyYXRpb24uaXNEYXRhYmFzZVBvb2xJbml0aWFsaXplZCgpKSBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24uaW5pdGlhbGl6ZURhdGFiYXNlUG9vbCgpXG4gICAgaWYgKCF0aGlzLm1pZ3JhdGlvbnNWZXJzaW9ucykgYXdhaXQgdGhpcy5sb2FkTWlncmF0aW9uc1ZlcnNpb25zKClcblxuICAgIGxldCBhcHBsaWVkID0gZmFsc2VcbiAgICBjb25zdCBkYnMgPSBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0Q3VycmVudENvbm5lY3Rpb25zKClcblxuICAgIC8qKlxuICAgICAqIERiIGlkZW50aWZpZXJzIG5lZWRpbmcgbWlncmF0aW9uIHZlcnNpb25zLlxuICAgICAqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgICBjb25zdCBkYklkZW50aWZpZXJzTmVlZGluZ01pZ3JhdGlvblZlcnNpb25zID0gW11cblxuICAgIC8vIG1pZ3JhdGVGaWxlcygpIHdyYXBzIGV4ZWN1dGlvbiBpbiBlbnN1cmVDb25uZWN0aW9ucygpLCBzbyB0aGUgY3VycmVudFxuICAgIC8vIGFzeW5jIGNvbnRleHQgY2FuIGV4cG9zZSBEQiBpZGVudGlmaWVycyBub3QgbG9hZGVkIGJ5IHByZXBhcmUoKS5cbiAgICBmb3IgKGNvbnN0IGRiSWRlbnRpZmllciBpbiBkYnMpIHtcbiAgICAgIGlmICghdGhpcy5oYW5kbGVzRGF0YWJhc2VJZGVudGlmaWVyKGRiSWRlbnRpZmllcikpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IGRhdGFiYXNlQ29uZmlndXJhdGlvbiA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXREYXRhYmFzZUlkZW50aWZpZXIoZGJJZGVudGlmaWVyKVxuXG4gICAgICBpZiAoIWRhdGFiYXNlQ29uZmlndXJhdGlvbi5taWdyYXRpb25zKSBjb250aW51ZVxuICAgICAgaWYgKHRoaXMubWlncmF0aW9uc1ZlcnNpb25zW2RiSWRlbnRpZmllcl0pIGNvbnRpbnVlXG5cbiAgICAgIGRiSWRlbnRpZmllcnNOZWVkaW5nTWlncmF0aW9uVmVyc2lvbnMucHVzaChkYklkZW50aWZpZXIpXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBkYklkZW50aWZpZXIgb2YgZGJJZGVudGlmaWVyc05lZWRpbmdNaWdyYXRpb25WZXJzaW9ucykge1xuICAgICAgY29uc3QgZGIgPSBkYnNbZGJJZGVudGlmaWVyXVxuXG4gICAgICBhd2FpdCB0aGlzLmNyZWF0ZU1pZ3JhdGlvbnNUYWJsZUZvckRhdGFiYXNlKHtkYklkZW50aWZpZXIsIGRifSlcbiAgICAgIGF3YWl0IHRoaXMubG9hZE1pZ3JhdGlvbnNWZXJzaW9uc0ZvckRhdGFiYXNlKHtkYklkZW50aWZpZXIsIGRifSlcbiAgICB9XG5cbiAgICBjb25zdCBtaWdyYXRpb25DbGFzcyA9IGF3YWl0IHJlcXVpcmVNaWdyYXRpb24oKVxuXG4gICAgaWYgKCFtaWdyYXRpb25DbGFzcyB8fCB0eXBlb2YgbWlncmF0aW9uQ2xhc3MgIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBNaWdyYXRpb24gJHttaWdyYXRpb24uZmlsZX0gbXVzdCBleHBvcnQgYSBkZWZhdWx0IG1pZ3JhdGlvbiBjbGFzcy4gVHlwZTogJHt0eXBlb2YgbWlncmF0aW9uQ2xhc3N9YClcbiAgICB9XG4gICAgaWYgKGRpcmVjdGlvbiA9PSBcInVwXCIgJiYgIW1pZ3JhdGlvblJ1bnNJbkV4ZWN1dGlvblBoYXNlKG1pZ3JhdGlvbkNsYXNzLCB0aGlzLmV4ZWN1dGlvblBoYXNlKSkgcmV0dXJuIGZhbHNlXG5cbiAgICBjb25zdCBtaWdyYXRpb25EYXRhYmFzZUlkZW50aWZpZXJzID0gbWlncmF0aW9uQ2xhc3MuZ2V0RGF0YWJhc2VJZGVudGlmaWVycygpIHx8IFtcImRlZmF1bHRcIl1cblxuICAgIGZvciAoY29uc3QgZGJJZGVudGlmaWVyIGluIGRicykge1xuICAgICAgaWYgKCF0aGlzLmhhbmRsZXNEYXRhYmFzZUlkZW50aWZpZXIoZGJJZGVudGlmaWVyKSkgY29udGludWVcblxuICAgICAgY29uc3QgZGF0YWJhc2VDb25maWd1cmF0aW9uID0gdGhpcy5jb25maWd1cmF0aW9uLmdldERhdGFiYXNlSWRlbnRpZmllcihkYklkZW50aWZpZXIpXG5cbiAgICAgIGlmICghZGF0YWJhc2VDb25maWd1cmF0aW9uLm1pZ3JhdGlvbnMpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYCR7ZGJJZGVudGlmaWVyfSBpc24ndCBjb25maWd1cmVkIGZvciBtaWdyYXRpb25zIC0gc2tpcHBpbmcgbWlncmF0aW9uICR7ZGlnZyhtaWdyYXRpb24sIFwiZGF0ZVwiKX1gKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoIW1pZ3JhdGlvbkRhdGFiYXNlSWRlbnRpZmllcnMuaW5jbHVkZXMoZGJJZGVudGlmaWVyKSkge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgJHtkYklkZW50aWZpZXJ9IHNob3VsZG4ndCBydW4gbWlncmF0aW9uICR7bWlncmF0aW9uLmZpbGV9YCwge21pZ3JhdGlvbkRhdGFiYXNlSWRlbnRpZmllcnN9KVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBjb25zdCBkYiA9IGRic1tkYklkZW50aWZpZXJdXG4gICAgICBjb25zdCBkYXRlU3RyaW5nID0gYCR7ZGlnZyhtaWdyYXRpb24sIFwiZGF0ZVwiKX1gXG5cbiAgICAgIC8vIFNlcmlhbGlzZSB0aGUgY2hlY2stdGhlbi1hcHBseSBhY3Jvc3MgcHJvY2Vzc2VzLiBXaXRob3V0IHRoaXMsIHR3byBzaGFyZHMgY2FuIGJvdGhcbiAgICAgIC8vIG9ic2VydmUgdGhlIG1pZ3JhdGlvbiBhcyB1bmFwcGxpZWQgYW5kIGJvdGggZXhlY3V0ZSBpdHMgRERMOyB0aGUgbG9zZXIgZGllcyB3aXRoIHRoZVxuICAgICAgLy8gZHJpdmVyJ3MgZHVwbGljYXRlLW9iamVjdCBlcnJvciBtaWQtYm9vdC5cbiAgICAgIC8vXG4gICAgICAvLyBUaGUgdmVyc2lvbiBpcyByZS1yZWFkICppbnNpZGUqIHRoZSBsb2NrOiB3aGlsZSB0aGlzIHByb2Nlc3Mgd2FpdGVkLCBhbm90aGVyIHByb2Nlc3NcbiAgICAgIC8vIG1heSBhbHJlYWR5IGhhdmUgYXBwbGllZCB0aGUgbWlncmF0aW9uLCBpbiB3aGljaCBjYXNlIHRoaXMgb25lIG11c3QgYmVjb21lIGEgbm8tb3AuXG4gICAgICBjb25zb2xlLmVycm9yKFwiW01JRy1ERUJVR10gYWNxdWlyaW5nIGxvY2sgZGI9XCIgKyBkYklkZW50aWZpZXIgKyBcIiBmaWxlPVwiICsgbWlncmF0aW9uLmZpbGUpXG4gICAgICBjb25zdCBydW5uZXIgPSBuZXcgQWR2aXNvcnlMb2NrUnVubmVyKHtcbiAgICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5jb25maWd1cmF0aW9uLFxuICAgICAgICBjb25uZWN0aW9uUHJvdmlkZXI6ICgpID0+IGRiLFxuICAgICAgICBkYXRhYmFzZUlkZW50aWZpZXI6IGRiSWRlbnRpZmllclxuICAgICAgfSlcblxuICAgICAgY29uc3QgYXBwbGllZEluTG9jayA9IGF3YWl0IHJ1bm5lci53aXRoQWR2aXNvcnlMb2NrKFxuICAgICAgICBtaWdyYXRpb25zQWR2aXNvcnlMb2NrTmFtZShkYklkZW50aWZpZXIpLFxuICAgICAgICBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgLy8gUmUtcmVhZCB0aGUgYXBwbGllZCBzZXQgZnJvbSB0aGUgZGF0YWJhc2Ugd2hpbGUgaG9sZGluZyB0aGUgbG9jay4gVGhlIHZlcnNpb25cbiAgICAgICAgICAvLyBsaXN0IHdhcyBsb2FkZWQgZHVyaW5nIHByZXBhcmUoKSwgYmVmb3JlIGFueSBvdGhlciBwcm9jZXNzIG1heSBoYXZlIGZpbmlzaGVkXG4gICAgICAgICAgLy8gYXBwbHlpbmcgbWlncmF0aW9ucywgc28gdHJ1c3RpbmcgdGhhdCBjYWNoZWQgc25hcHNob3QgaGVyZSB3b3VsZCBsZXQgdGhpc1xuICAgICAgICAgIC8vIHByb2Nlc3MgcmUtcnVuIERETCB0aGF0IGFub3RoZXIgcHJvY2VzcyBoYXMgYWxyZWFkeSBjb21taXR0ZWQuXG4gICAgICAgICAgYXdhaXQgdGhpcy5sb2FkTWlncmF0aW9uc1ZlcnNpb25zRm9yRGF0YWJhc2Uoe2RiSWRlbnRpZmllciwgZGJ9KVxuXG4gICAgICAgICAgaWYgKGRpcmVjdGlvbiA9PSBcInVwXCIpIHtcbiAgICAgICAgICAgIGlmICh0aGlzLmhhc1J1bk1pZ3JhdGlvblZlcnNpb24oZGJJZGVudGlmaWVyLCBtaWdyYXRpb24uZGF0ZSkpIHtcbiAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYCR7ZGJJZGVudGlmaWVyfSBoYXMgYWxyZWFkeSBydW4gbWlncmF0aW9uICR7bWlncmF0aW9uLmZpbGV9YClcbiAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSBlbHNlIGlmIChkaXJlY3Rpb24gPT0gXCJkb3duXCIpIHtcbiAgICAgICAgICAgIGlmICghdGhpcy5oYXNSdW5NaWdyYXRpb25WZXJzaW9uKGRiSWRlbnRpZmllciwgbWlncmF0aW9uLmRhdGUpKSB7XG4gICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGAke2RiSWRlbnRpZmllcn0gaGFzbid0IHJ1biBtaWdyYXRpb24gJHttaWdyYXRpb24uZmlsZX1gKVxuICAgICAgICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIGRpcmVjdGlvbjogJHtkaXJlY3Rpb259YClcbiAgICAgICAgICB9XG5cbiAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgUnVubmluZyBtaWdyYXRpb24gb24gJHtkYklkZW50aWZpZXJ9OiAke21pZ3JhdGlvbi5maWxlfWAsIHttaWdyYXRpb25EYXRhYmFzZUlkZW50aWZpZXJzfSlcblxuICAgICAgICAgIGNvbnN0IE1pZ3JhdGlvbkNsYXNzID0gbWlncmF0aW9uQ2xhc3NcbiAgICAgICAgICBjb25zdCBtaWdyYXRpb25JbnN0YW5jZSA9IG5ldyBNaWdyYXRpb25DbGFzcyh7XG4gICAgICAgICAgICBjb25maWd1cmF0aW9uOiB0aGlzLmNvbmZpZ3VyYXRpb24sXG4gICAgICAgICAgICBkYXRhYmFzZUlkZW50aWZpZXI6IGRiSWRlbnRpZmllcixcbiAgICAgICAgICAgIGRiXG4gICAgICAgICAgfSlcblxuICAgICAgICAgIGlmIChkaXJlY3Rpb24gPT0gXCJ1cFwiKSB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICBhd2FpdCBtaWdyYXRpb25JbnN0YW5jZS5jaGFuZ2UoKVxuICAgICAgICAgICAgfSBjYXRjaCAoY2hhbmdlRXJyb3IpIHtcbiAgICAgICAgICAgICAgaWYgKGNoYW5nZUVycm9yIGluc3RhbmNlb2YgTm90SW1wbGVtZW50ZWRFcnJvcikge1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICBhd2FpdCBtaWdyYXRpb25JbnN0YW5jZS51cCgpXG4gICAgICAgICAgICAgICAgfSBjYXRjaCAodXBFcnJvcikge1xuICAgICAgICAgICAgICAgICAgaWYgKHVwRXJyb3IgaW5zdGFuY2VvZiBOb3RJbXBsZW1lbnRlZEVycm9yKSB7XG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgJ2NoYW5nZScgb3IgJ3VwJyBkaWRuJ3QgZXhpc3Qgb24gbWlncmF0aW9uOiAke21pZ3JhdGlvbi5maWxlfWAsIHtjYXVzZTogdXBFcnJvcn0pXG4gICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICB0aHJvdyB1cEVycm9yXG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHRocm93IGNoYW5nZUVycm9yXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgYXdhaXQgTWlncmF0aW9uc0xlZGdlci5yZWNvcmRWZXJzaW9uKGRiLCBkYXRlU3RyaW5nKVxuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICBhd2FpdCBtaWdyYXRpb25JbnN0YW5jZS5kb3duKClcbiAgICAgICAgICAgIH0gY2F0Y2ggKGRvd25FcnJvcikge1xuICAgICAgICAgICAgICBpZiAoZG93bkVycm9yIGluc3RhbmNlb2YgTm90SW1wbGVtZW50ZWRFcnJvcikge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgJ2Rvd24nIGRpZG4ndCBleGlzdCBvbiBtaWdyYXRpb246ICR7bWlncmF0aW9uLmZpbGV9IG9yIG1pZ3JhdGluZyBkb3duIHdpdGggYSBjaGFuZ2UgbWV0aG9kIGlzbid0IGN1cnJlbnRseSBzdXBwb3J0ZWRgLCB7Y2F1c2U6IGRvd25FcnJvcn0pXG4gICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgZG93bkVycm9yXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgYXdhaXQgTWlncmF0aW9uc0xlZGdlci5yZW1vdmVWZXJzaW9uKGRiLCBkYXRlU3RyaW5nKVxuICAgICAgICAgIH1cblxuICAgICAgICAgIHJldHVybiB0cnVlXG4gICAgICAgIH0sXG4gICAgICAgIC8vIFBpbiB0aGUgbG9jayB0byBvbmUgcGh5c2ljYWwgc2Vzc2lvbjogTVNTUUwvZXhwbGljaXQgYWR2aXNvcnkgbG9ja3MgYXJlXG4gICAgICAgIC8vIHNlc3Npb24tc2NvcGVkLCBhbmQgYSBwb29sZWQgY29ubmVjdGlvbiBjYW4gcm91dGUgYWNxdWlyZSBhbmQgcmVsZWFzZSB0b1xuICAgICAgICAvLyBkaWZmZXJlbnQgc2Vzc2lvbnMsIHdoaWNoIHdvdWxkIGxldCB0d28gcHJvY2Vzc2VzIGJvdGggXCJob2xkXCIgdGhlIGxvY2suXG4gICAgICAgIHtkZWRpY2F0ZWRDb25uZWN0aW9uOiB0cnVlfVxuICAgICAgKVxuXG4gICAgICBpZiAoIWFwcGxpZWRJbkxvY2spIGNvbnRpbnVlXG5cbiAgICAgIGFwcGxpZWQgPSB0cnVlXG4gICAgfVxuXG4gICAgcmV0dXJuIGFwcGxpZWRcbiAgfVxufVxuIl19