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
     * Application migrations belong to the schema-owning lifecycle. HTTP worker
     * threads (`processContext.type === "worker-handler"`) each run the
     * application's `initializeModels` hook, so an app that migrates from that hook
     * would apply the pending set (and write the structure dump) once per worker.
     * The server process and deploy migration tasks migrate before workers start,
     * so workers skip here instead of repeating that work.
     * @returns {Promise<boolean>} - Whether this lifecycle must skip application migrations.
     */
    async _skipApplicationMigrationsInWorkerLifecycle() {
        const processContext = this.configuration.getApplicationProcessContext();
        if (processContext?.type !== "worker-handler")
            return false;
        await this.logger.debug("Skipping application migrations in an HTTP worker thread - the schema-owning process migrates before workers start", {
            instanceId: processContext.instanceId,
            processType: processContext.type
        });
        return true;
    }
    /**
     * Runs migrate files.
     * @param {import("./migrator/types.js").MigrationObjectType[]} files - Files.
     * @param {import("./migrator/types.js").ImportFullpathCallbackType} importCallback - Import callback.
     * @returns {Promise<number>} - Number of migrations actually applied (not skipped as already-run).
     */
    async migrateFiles(files, importCallback) {
        if (await this._skipApplicationMigrationsInWorkerLifecycle())
            return 0;
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
     *
     * Application migrations belong to the schema-owning lifecycle; see
     * {@link VelociousDatabaseMigrator#_skipApplicationMigrationsInWorkerLifecycle}.
     * @param {import("./migrator/types.js").RequireMigrationContextType} requireContext - Require context.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async migrateFilesFromRequireContext(requireContext) {
        if (await this._skipApplicationMigrationsInWorkerLifecycle())
            return;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWlncmF0b3IuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZGF0YWJhc2UvbWlncmF0b3IuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sRUFBQyxJQUFJLEVBQUMsTUFBTSxXQUFXLENBQUE7QUFDOUIsT0FBTyxLQUFLLFVBQVUsTUFBTSxZQUFZLENBQUE7QUFDeEMsT0FBTyxNQUFNLE1BQU0sY0FBYyxDQUFBO0FBQ2pDLE9BQU8sZ0JBQWdCLE1BQU0sd0JBQXdCLENBQUE7QUFDckQsT0FBTyxrQkFBa0IsTUFBTSwyQkFBMkIsQ0FBQTtBQUMxRCxPQUFPLEVBQUMsbUJBQW1CLEVBQUMsTUFBTSxzQkFBc0IsQ0FBQTtBQUN4RCxPQUFPLEVBQUUsdUJBQXVCLEVBQUUsNkJBQTZCLEVBQUUsTUFBTSxnQ0FBZ0MsQ0FBQTtBQUN2RyxPQUFPLGFBQWEsTUFBTSw2QkFBNkIsQ0FBQTtBQUV2RDs7Ozs7Ozs7R0FRRztBQUNILFNBQVMsMEJBQTBCLENBQUMsWUFBWTtJQUM5QyxPQUFPLHdCQUF3QixZQUFZLEVBQUUsQ0FBQTtBQUMvQyxDQUFDO0FBRUQsTUFBTSxDQUFDLE9BQU8sT0FBTyx5QkFBeUI7SUFDNUM7O3lEQUVxRDtJQUNyRCxrQkFBa0IsR0FBRyxFQUFFLENBQUE7SUFFdkI7Ozs7OztPQU1HO0lBQ0gsWUFBWSxFQUFDLGFBQWEsRUFBRSxtQkFBbUIsRUFBRSxjQUFjLEVBQUUsR0FBRyxRQUFRLEVBQUM7UUFDM0UsYUFBYSxDQUFDLFFBQVEsQ0FBQyxDQUFBO1FBRXZCLElBQUksQ0FBQyxhQUFhO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxvQ0FBb0MsQ0FBQyxDQUFBO1FBRXpFLElBQUksQ0FBQyxhQUFhLEdBQUcsYUFBYSxDQUFBO1FBQ2xDLElBQUksQ0FBQyxtQkFBbUIsR0FBRyxtQkFBbUIsQ0FBQTtRQUM5QyxJQUFJLENBQUMsY0FBYyxHQUFHLGNBQWMsS0FBSyxTQUFTLENBQUMs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d0JBQ0gsQ0FBQzs2QkFBTSxDQUFDOzRCQUNOLE1BQU0sV0FBVyxDQUFBO3dCQUNuQixDQUFDO29CQUNILENBQUM7b0JBRUQsTUFBTSxnQkFBZ0IsQ0FBQyxhQUFhLENBQUMsRUFBRSxFQUFFLFVBQVUsQ0FBQyxDQUFBO2dCQUN0RCxDQUFDO3FCQUFNLENBQUM7b0JBQ04sSUFBSSxDQUFDO3dCQUNILE1BQU0saUJBQWlCLENBQUMsSUFBSSxFQUFFLENBQUE7b0JBQ2hDLENBQUM7b0JBQUMsT0FBTyxTQUFTLEVBQUUsQ0FBQzt3QkFDbkIsSUFBSSxTQUFTLFlBQVksbUJBQW1CLEVBQUUsQ0FBQzs0QkFDN0MsTUFBTSxJQUFJLEtBQUssQ0FBQyxxQ0FBcUMsU0FBUyxDQUFDLElBQUksbUVBQW1FLEVBQUUsRUFBQyxLQUFLLEVBQUUsU0FBUyxFQUFDLENBQUMsQ0FBQTt3QkFDN0osQ0FBQzs2QkFBTSxDQUFDOzRCQUNOLE1BQU0sU0FBUyxDQUFBO3dCQUNqQixDQUFDO29CQUNILENBQUM7b0JBRUQsTUFBTSxnQkFBZ0IsQ0FBQyxhQUFhLENBQUMsRUFBRSxFQUFFLFVBQVUsQ0FBQyxDQUFBO2dCQUN0RCxDQUFDO2dCQUVELE9BQU8sSUFBSSxDQUFBO1lBQ2IsQ0FBQztZQUNELDBFQUEwRTtZQUMxRSwyRUFBMkU7WUFDM0UsMEVBQTBFO1lBQzFFLEVBQUMsbUJBQW1CLEVBQUUsSUFBSSxFQUFDLENBQzVCLENBQUE7WUFFRCxJQUFJLENBQUMsYUFBYTtnQkFBRSxTQUFRO1lBRTVCLE9BQU8sR0FBRyxJQUFJLENBQUE7UUFDaEIsQ0FBQztRQUVELE9BQU8sT0FBTyxDQUFBO0lBQ2hCLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQge2RpZ2d9IGZyb20gXCJkaWdnZXJpemVcIlxuaW1wb3J0ICogYXMgaW5mbGVjdGlvbiBmcm9tIFwiaW5mbGVjdGlvblwiXG5pbXBvcnQgTG9nZ2VyIGZyb20gXCIuLi9sb2dnZXIuanNcIlxuaW1wb3J0IE1pZ3JhdGlvbnNMZWRnZXIgZnJvbSBcIi4vbWlncmF0aW9ucy1sZWRnZXIuanNcIlxuaW1wb3J0IEFkdmlzb3J5TG9ja1J1bm5lciBmcm9tIFwiLi9hZHZpc29yeS1sb2NrLXJ1bm5lci5qc1wiXG5pbXBvcnQge05vdEltcGxlbWVudGVkRXJyb3J9IGZyb20gXCIuL21pZ3JhdGlvbi9pbmRleC5qc1wiXG5pbXBvcnQgeyBtaWdyYXRpb25FeGVjdXRpb25QaGFzZSwgbWlncmF0aW9uUnVuc0luRXhlY3V0aW9uUGhhc2UgfSBmcm9tIFwiLi9taWdyYXRpb24tZXhlY3V0aW9uLXBoYXNlLmpzXCJcbmltcG9ydCByZXN0QXJnc0Vycm9yIGZyb20gXCIuLi91dGlscy9yZXN0LWFyZ3MtZXJyb3IuanNcIlxuXG4vKipcbiAqIEJ1aWxkcyB0aGUgYWR2aXNvcnktbG9jayBuYW1lIHRoYXQgc2VyaWFsaXNlcyBtaWdyYXRpb25zIGZvciBvbmUgZGF0YWJhc2UgaWRlbnRpZmllci5cbiAqXG4gKiBUaGUgbmFtZSBpcyBkZXJpdmVkIGZyb20gdGhlIGRhdGFiYXNlIGlkZW50aWZpZXIgb25seSAobm90IHRoZSBtaWdyYXRpb24pIHNvIHRoYXRcbiAqIGNvbmN1cnJlbnQgcHJvY2Vzc2VzIHF1ZXVlIG9uIG9uZSBsb2NrIHdoaWxlIGFwcGx5aW5nIHRoZSBwZW5kaW5nIHNldCwgaW5zdGVhZCBvZlxuICogcmFjaW5nIG9uIGluZGl2aWR1YWwgRERMIHN0YXRlbWVudHMuXG4gKiBAcGFyYW0ge3N0cmluZ30gZGJJZGVudGlmaWVyIC0gRGF0YWJhc2UgaWRlbnRpZmllciBiZWluZyBtaWdyYXRlZC5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gQWR2aXNvcnkgbG9jayBuYW1lLlxuICovXG5mdW5jdGlvbiBtaWdyYXRpb25zQWR2aXNvcnlMb2NrTmFtZShkYklkZW50aWZpZXIpIHtcbiAgcmV0dXJuIGB2ZWxvY2lvdXM6bWlncmF0aW9uczoke2RiSWRlbnRpZmllcn1gXG59XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0RhdGFiYXNlTWlncmF0b3Ige1xuICAvKipcbiAgICogTWlncmF0aW9ucyB2ZXJzaW9ucy5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJlY29yZDxzdHJpbmcsIGJvb2xlYW4+Pn0gKi9cbiAgbWlncmF0aW9uc1ZlcnNpb25zID0ge31cblxuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGFyZ3MuY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IFthcmdzLmRhdGFiYXNlSWRlbnRpZmllcnNdIC0gT3B0aW9uYWwgZGF0YWJhc2UgaWRlbnRpZmllcnMgdG8gbWlncmF0ZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL21pZ3JhdGlvbi1leGVjdXRpb24tcGhhc2UuanNcIikuTWlncmF0aW9uRXhlY3V0aW9uUGhhc2V9IFthcmdzLmV4ZWN1dGlvblBoYXNlXSAtIE9wdGlvbmFsIG1pZ3JhdGlvbiBleGVjdXRpb24gcGhhc2UgdG8gc2VsZWN0LlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2NvbmZpZ3VyYXRpb24sIGRhdGFiYXNlSWRlbnRpZmllcnMsIGV4ZWN1dGlvblBoYXNlLCAuLi5yZXN0QXJnc30pIHtcbiAgICByZXN0QXJnc0Vycm9yKHJlc3RBcmdzKVxuXG4gICAgaWYgKCFjb25maWd1cmF0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJjb25maWd1cmF0aW9uIGFyZ3VtZW50IGlzIHJlcXVpcmVkXCIpXG5cbiAgICB0aGlzLmNvbmZpZ3VyYXRpb24gPSBjb25maWd1cmF0aW9uXG4gICAgdGhpcy5kYXRhYmFzZUlkZW50aWZpZXJzID0gZGF0YWJhc2VJZGVudGlmaWVyc1xuICAgIHRoaXMuZXhlY3V0aW9uUGhhc2UgPSBleGVjdXRpb25QaGFzZSA9PT0gdW5kZWZpbmVkID8gdW5kZWZpbmVkIDogbWlncmF0aW9uRXhlY3V0aW9uUGhhc2UoZXhlY3V0aW9uUGhhc2UpXG4gICAgdGhpcy5sb2dnZXIgPSBuZXcgTG9nZ2VyKHRoaXMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYW5kbGVzIGRhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBkYklkZW50aWZpZXIgLSBEYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoaXMgbWlncmF0b3Igc2hvdWxkIHRvdWNoIHRoZSBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKi9cbiAgaGFuZGxlc0RhdGFiYXNlSWRlbnRpZmllcihkYklkZW50aWZpZXIpIHtcbiAgICBpZiAoIXRoaXMuZGF0YWJhc2VJZGVudGlmaWVycykgcmV0dXJuIHRydWVcblxuICAgIHJldHVybiB0aGlzLmRhdGFiYXNlSWRlbnRpZmllcnMuaW5jbHVkZXMoZGJJZGVudGlmaWVyKVxuICB9XG5cblxuICAvKipcbiAgICogUnVucyBwcmVwYXJlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgcHJlcGFyZSgpIHtcbiAgICBjb25zb2xlLmVycm9yKFwiW01JRy1ERUJVR10gcHJlcGFyZSgpIHN0YXJ0XCIpXG4gICAgYXdhaXQgdGhpcy5jcmVhdGVNaWdyYXRpb25zVGFibGUoKVxuICAgIGNvbnNvbGUuZXJyb3IoXCJbTUlHLURFQlVHXSBjcmVhdGVNaWdyYXRpb25zVGFibGUgZG9uZVwiKVxuICAgIGF3YWl0IHRoaXMubG9hZE1pZ3JhdGlvbnNWZXJzaW9ucygpXG4gICAgY29uc29sZS5lcnJvcihcIltNSUctREVCVUddIHByZXBhcmUoKSBkb25lXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjcmVhdGUgbWlncmF0aW9ucyB0YWJsZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGNyZWF0ZU1pZ3JhdGlvbnNUYWJsZSgpIHtcbiAgICBjb25zdCBkYnMgPSBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0Q3VycmVudENvbm5lY3Rpb25zKClcblxuICAgIGZvciAoY29uc3QgZGJJZGVudGlmaWVyIGluIGRicykge1xuICAgICAgaWYgKCF0aGlzLmhhbmRsZXNEYXRhYmFzZUlkZW50aWZpZXIoZGJJZGVudGlmaWVyKSkgY29udGludWVcblxuICAgICAgYXdhaXQgdGhpcy5jcmVhdGVNaWdyYXRpb25zVGFibGVGb3JEYXRhYmFzZSh7ZGJJZGVudGlmaWVyLCBkYjogZGJzW2RiSWRlbnRpZmllcl19KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNyZWF0ZSBtaWdyYXRpb25zIHRhYmxlIGZvciBkYXRhYmFzZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuZGJJZGVudGlmaWVyIC0gRGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBhcmdzLmRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGNyZWF0ZU1pZ3JhdGlvbnNUYWJsZUZvckRhdGFiYXNlKHtkYklkZW50aWZpZXIsIGRifSkge1xuICAgIGNvbnN0IGRhdGFiYXNlQ29uZmlndXJhdGlvbiA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXREYXRhYmFzZUlkZW50aWZpZXIoZGJJZGVudGlmaWVyKVxuXG4gICAgaWYgKCFkYXRhYmFzZUNvbmZpZ3VyYXRpb24ubWlncmF0aW9ucykge1xuICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYCR7ZGJJZGVudGlmaWVyfSBpc24ndCBjb25maWd1cmVkIGZvciBtaWdyYXRpb25zIC0gc2tpcHBpbmcgY3JlYXRpbmcgbWlncmF0aW9ucyB0YWJsZSBmb3IgaXRgKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKGF3YWl0IHRoaXMubWlncmF0aW9uc1RhYmxlRXhpc3QoZGIpKSB7XG4gICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgJHtkYklkZW50aWZpZXJ9IG1pZ3JhdGlvbnMgdGFibGUgYWxyZWFkeSBleGlzdHMgLSBza2lwcGluZ2ApXG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKFwiQ3JlYXRpbmcgc2NoZW1hX21pZ3JhdGlvbnMgdGFibGUgdmlhIE1pZ3JhdGlvbnNMZWRnZXJcIilcbiAgICAgIGF3YWl0IE1pZ3JhdGlvbnNMZWRnZXIuZW5zdXJlVGFibGUoZGIpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFzIHJ1biBtaWdyYXRpb24gdmVyc2lvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGRiSWRlbnRpZmllciAtIERiIGlkZW50aWZpZXIuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSB2ZXJzaW9uIC0gVmVyc2lvbi5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBpdCBoYXMgcnVuIG1pZ3JhdGlvbiB2ZXJzaW9uLlxuICAgKi9cbiAgaGFzUnVuTWlncmF0aW9uVmVyc2lvbihkYklkZW50aWZpZXIsIHZlcnNpb24pIHtcbiAgICBpZiAoIXRoaXMubWlncmF0aW9uc1ZlcnNpb25zKSB0aHJvdyBuZXcgRXJyb3IoXCJNaWdyYXRpb25zIHZlcnNpb25zIGhhc24ndCBiZWVuIGxvYWRlZCB5ZXRcIilcbiAgICBpZiAoIXRoaXMubWlncmF0aW9uc1ZlcnNpb25zW2RiSWRlbnRpZmllcl0pIHRocm93IG5ldyBFcnJvcihgTWlncmF0aW9ucyB2ZXJzaW9ucyBoYXNuJ3QgYmVlbiBsb2FkZWQgeWV0IGZvciBkYjogJHtkYklkZW50aWZpZXJ9YClcblxuICAgIGlmICh2ZXJzaW9uIGluIHRoaXMubWlncmF0aW9uc1ZlcnNpb25zW2RiSWRlbnRpZmllcl0pIHtcbiAgICAgIHJldHVybiB0cnVlXG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogQXBwbGljYXRpb24gbWlncmF0aW9ucyBiZWxvbmcgdG8gdGhlIHNjaGVtYS1vd25pbmcgbGlmZWN5Y2xlLiBIVFRQIHdvcmtlclxuICAgKiB0aHJlYWRzIChgcHJvY2Vzc0NvbnRleHQudHlwZSA9PT0gXCJ3b3JrZXItaGFuZGxlclwiYCkgZWFjaCBydW4gdGhlXG4gICAqIGFwcGxpY2F0aW9uJ3MgYGluaXRpYWxpemVNb2RlbHNgIGhvb2ssIHNvIGFuIGFwcCB0aGF0IG1pZ3JhdGVzIGZyb20gdGhhdCBob29rXG4gICAqIHdvdWxkIGFwcGx5IHRoZSBwZW5kaW5nIHNldCAoYW5kIHdyaXRlIHRoZSBzdHJ1Y3R1cmUgZHVtcCkgb25jZSBwZXIgd29ya2VyLlxuICAgKiBUaGUgc2VydmVyIHByb2Nlc3MgYW5kIGRlcGxveSBtaWdyYXRpb24gdGFza3MgbWlncmF0ZSBiZWZvcmUgd29ya2VycyBzdGFydCxcbiAgICogc28gd29ya2VycyBza2lwIGhlcmUgaW5zdGVhZCBvZiByZXBlYXRpbmcgdGhhdCB3b3JrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBXaGV0aGVyIHRoaXMgbGlmZWN5Y2xlIG11c3Qgc2tpcCBhcHBsaWNhdGlvbiBtaWdyYXRpb25zLlxuICAgKi9cbiAgYXN5bmMgX3NraXBBcHBsaWNhdGlvbk1pZ3JhdGlvbnNJbldvcmtlckxpZmVjeWNsZSgpIHtcbiAgICBjb25zdCBwcm9jZXNzQ29udGV4dCA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXRBcHBsaWNhdGlvblByb2Nlc3NDb250ZXh0KClcblxuICAgIGlmIChwcm9jZXNzQ29udGV4dD8udHlwZSAhPT0gXCJ3b3JrZXItaGFuZGxlclwiKSByZXR1cm4gZmFsc2VcblxuICAgIGF3YWl0IHRoaXMubG9nZ2VyLmRlYnVnKFwiU2tpcHBpbmcgYXBwbGljYXRpb24gbWlncmF0aW9ucyBpbiBhbiBIVFRQIHdvcmtlciB0aHJlYWQgLSB0aGUgc2NoZW1hLW93bmluZyBwcm9jZXNzIG1pZ3JhdGVzIGJlZm9yZSB3b3JrZXJzIHN0YXJ0XCIsIHtcbiAgICAgIGluc3RhbmNlSWQ6IHByb2Nlc3NDb250ZXh0Lmluc3RhbmNlSWQsXG4gICAgICBwcm9jZXNzVHlwZTogcHJvY2Vzc0NvbnRleHQudHlwZVxuICAgIH0pXG5cbiAgICByZXR1cm4gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbWlncmF0ZSBmaWxlcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL21pZ3JhdG9yL3R5cGVzLmpzXCIpLk1pZ3JhdGlvbk9iamVjdFR5cGVbXX0gZmlsZXMgLSBGaWxlcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL21pZ3JhdG9yL3R5cGVzLmpzXCIpLkltcG9ydEZ1bGxwYXRoQ2FsbGJhY2tUeXBlfSBpbXBvcnRDYWxsYmFjayAtIEltcG9ydCBjYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBOdW1iZXIgb2YgbWlncmF0aW9ucyBhY3R1YWxseSBhcHBsaWVkIChub3Qgc2tpcHBlZCBhcyBhbHJlYWR5LXJ1bikuXG4gICAqL1xuICBhc3luYyBtaWdyYXRlRmlsZXMoZmlsZXMsIGltcG9ydENhbGxiYWNrKSB7XG4gICAgaWYgKGF3YWl0IHRoaXMuX3NraXBBcHBsaWNhdGlvbk1pZ3JhdGlvbnNJbldvcmtlckxpZmVjeWNsZSgpKSByZXR1cm4gMFxuXG4gICAgbGV0IGFwcGxpZWRDb3VudCA9IDBcblxuICAgIGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5lbnN1cmVDb25uZWN0aW9ucyh7ZGF0YWJhc2VJZGVudGlmaWVyczogdGhpcy5kYXRhYmFzZUlkZW50aWZpZXJzLCBuYW1lOiBcIkRhdGFiYXNlIG1pZ3JhdG9yOiBtaWdyYXRlIGZpbGVzXCJ9LCBhc3luYyAoKSA9PiB7XG4gICAgICBmb3IgKGNvbnN0IG1pZ3JhdGlvbiBvZiBmaWxlcykge1xuICAgICAgICBjb25zdCBhcHBsaWVkID0gYXdhaXQgdGhpcy5ydW5NaWdyYXRpb25GaWxlKHtcbiAgICAgICAgICBtaWdyYXRpb24sXG4gICAgICAgICAgcmVxdWlyZU1pZ3JhdGlvbjogYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgaWYgKCFtaWdyYXRpb24uZnVsbFBhdGgpIHRocm93IG5ldyBFcnJvcihgTWlncmF0aW9uIGRpZG4ndCBoYXZlIGEgZnVsbFBhdGgga2V5OiAke09iamVjdC5rZXlzKG1pZ3JhdGlvbikuam9pbihcIiwgXCIpfWApXG5cbiAgICAgICAgICAgIGNvbnN0IG1pZ3JhdGlvbkltcG9ydCA9IGF3YWl0IGltcG9ydENhbGxiYWNrKG1pZ3JhdGlvbi5mdWxsUGF0aClcblxuICAgICAgICAgICAgaWYgKCFtaWdyYXRpb25JbXBvcnQpIHtcbiAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBNaWdyYXRpb24gZmlsZSBtdXN0IGV4cG9ydCBtaWdyYXRpb24gY2xhc3M6ICR7bWlncmF0aW9uLmZ1bGxQYXRofWApXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJldHVybiBtaWdyYXRpb25JbXBvcnRcbiAgICAgICAgICB9XG4gICAgICAgIH0pXG5cbiAgICAgICAgaWYgKGFwcGxpZWQpIGFwcGxpZWRDb3VudCsrXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IHRoaXMuX2FmdGVyTWlncmF0aW9ucygpXG4gICAgfSlcblxuICAgIHJldHVybiBhcHBsaWVkQ291bnRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG1pZ3JhdGUgZmlsZXMgZnJvbSByZXF1aXJlIGNvbnRleHQuXG4gICAqXG4gICAqIEFwcGxpY2F0aW9uIG1pZ3JhdGlvbnMgYmVsb25nIHRvIHRoZSBzY2hlbWEtb3duaW5nIGxpZmVjeWNsZTsgc2VlXG4gICAqIHtAbGluayBWZWxvY2lvdXNEYXRhYmFzZU1pZ3JhdG9yI19za2lwQXBwbGljYXRpb25NaWdyYXRpb25zSW5Xb3JrZXJMaWZlY3ljbGV9LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vbWlncmF0b3IvdHlwZXMuanNcIikuUmVxdWlyZU1pZ3JhdGlvbkNvbnRleHRUeXBlfSByZXF1aXJlQ29udGV4dCAtIFJlcXVpcmUgY29udGV4dC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIG1pZ3JhdGVGaWxlc0Zyb21SZXF1aXJlQ29udGV4dChyZXF1aXJlQ29udGV4dCkge1xuICAgIGlmIChhd2FpdCB0aGlzLl9za2lwQXBwbGljYXRpb25NaWdyYXRpb25zSW5Xb3JrZXJMaWZlY3ljbGUoKSkgcmV0dXJuXG5cbiAgICBjb25zdCBmaWxlcyA9IHRoaXMubWlncmF0aW9uc0Zyb21SZXF1aXJlQ29udGV4dChyZXF1aXJlQ29udGV4dClcblxuICAgIGF3YWl0IHRoaXMuY29uZmlndXJhdGlvbi5lbnN1cmVDb25uZWN0aW9ucyh7ZGF0YWJhc2VJZGVudGlmaWVyczogdGhpcy5kYXRhYmFzZUlkZW50aWZpZXJzLCBuYW1lOiBcIkRhdGFiYXNlIG1pZ3JhdG9yOiBtaWdyYXRlIHJlcXVpcmUtY29udGV4dCBmaWxlc1wifSwgYXN5bmMgKCkgPT4ge1xuICAgICAgZm9yIChjb25zdCBtaWdyYXRpb24gb2YgZmlsZXMpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5ydW5NaWdyYXRpb25GaWxlKHtcbiAgICAgICAgICBtaWdyYXRpb24sXG4gICAgICAgICAgcmVxdWlyZU1pZ3JhdGlvbjogYXN5bmMgKCkgPT4gcmVxdWlyZUNvbnRleHQobWlncmF0aW9uLmZpbGUpLmRlZmF1bHRcbiAgICAgICAgfSlcbiAgICAgIH1cblxuICAgICAgYXdhaXQgdGhpcy5fYWZ0ZXJNaWdyYXRpb25zKClcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIE1pZ3JhdGVzIGV4YWN0bHkgb25lIGFscmVhZHktY2FwdHVyZWQgcGh5c2ljYWwgZGF0YWJhc2UuIFRoaXMgaXMgdGhlXG4gICAqIGZyb250ZW5kL3RlbmFudCBjb3VudGVycGFydCB0byB0aGUgYW1iaWVudCBtdWx0aS1kYXRhYmFzZSBlbnRyeXBvaW50czpcbiAgICogY2FsbGVycyBvd24gdGhlIGNhcHR1cmVkIGNvbm5lY3Rpb24gYW5kIG5vIGNvbmZpZ3VyYXRpb24gZmFsbGJhY2sgaXMgcmVhZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBDYXB0dXJlZCBtaWdyYXRpb24gYXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRGF0YWJhc2VDb25maWd1cmF0aW9uVHlwZX0gYXJncy5kYXRhYmFzZUNvbmZpZ3VyYXRpb24gLSBDYXB0dXJlZCBwaHlzaWNhbCBkYXRhYmFzZSBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5kYXRhYmFzZUlkZW50aWZpZXIgLSBMb2dpY2FsIGRhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gYXJncy5kYiAtIENhcHR1cmVkIHBoeXNpY2FsIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9taWdyYXRvci90eXBlcy5qc1wiKS5SZXF1aXJlTWlncmF0aW9uQ29udGV4dFR5cGV9IGFyZ3MucmVxdWlyZUNvbnRleHQgLSBGcm9udGVuZCBtaWdyYXRpb24gcmVxdWlyZSBjb250ZXh0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIE51bWJlciBvZiBuZXdseSBhcHBsaWVkIG1pZ3JhdGlvbnMuXG4gICAqL1xuICBhc3luYyBtaWdyYXRlUmVxdWlyZUNvbnRleHRGb3JEYXRhYmFzZSh7ZGF0YWJhc2VDb25maWd1cmF0aW9uLCBkYXRhYmFzZUlkZW50aWZpZXIsIGRiLCByZXF1aXJlQ29udGV4dH0pIHtcbiAgICBpZiAoIWRhdGFiYXNlQ29uZmlndXJhdGlvbi5taWdyYXRpb25zKSByZXR1cm4gMFxuXG4gICAgYXdhaXQgTWlncmF0aW9uc0xlZGdlci5lbnN1cmVUYWJsZShkYilcbiAgICBjb25zdCBhcHBsaWVkVmVyc2lvbnMgPSBuZXcgU2V0KGF3YWl0IE1pZ3JhdGlvbnNMZWRnZXIuYXBwbGllZFZlcnNpb25zKGRiKSlcbiAgICBjb25zdCBtaWdyYXRpb25zID0gdGhpcy5taWdyYXRpb25zRnJvbVJlcXVpcmVDb250ZXh0KHJlcXVpcmVDb250ZXh0KVxuICAgIGxldCBhcHBsaWVkQ291bnQgPSAwXG5cbiAgICBmb3IgKGNvbnN0IG1pZ3JhdGlvbiBvZiBtaWdyYXRpb25zKSB7XG4gICAgICBjb25zdCB2ZXJzaW9uID0gYCR7bWlncmF0aW9uLmRhdGV9YFxuXG4gICAgICBpZiAoYXBwbGllZFZlcnNpb25zLmhhcyh2ZXJzaW9uKSkgY29udGludWVcblxuICAgICAgY29uc3QgTWlncmF0aW9uQ2xhc3MgPSByZXF1aXJlQ29udGV4dChtaWdyYXRpb24uZmlsZSkuZGVmYXVsdFxuXG4gICAgICBpZiAoIU1pZ3JhdGlvbkNsYXNzIHx8IHR5cGVvZiBNaWdyYXRpb25DbGFzcyAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgTWlncmF0aW9uICR7bWlncmF0aW9uLmZpbGV9IG11c3QgZXhwb3J0IGEgZGVmYXVsdCBtaWdyYXRpb24gY2xhc3MuIFR5cGU6ICR7dHlwZW9mIE1pZ3JhdGlvbkNsYXNzfWApXG4gICAgICB9XG4gICAgICBpZiAoIW1pZ3JhdGlvblJ1bnNJbkV4ZWN1dGlvblBoYXNlKE1pZ3JhdGlvbkNsYXNzLCB0aGlzLmV4ZWN1dGlvblBoYXNlKSkgY29udGludWVcbiAgICAgIGlmICghKE1pZ3JhdGlvbkNsYXNzLmdldERhdGFiYXNlSWRlbnRpZmllcnMoKSB8fCBbXCJkZWZhdWx0XCJdKS5pbmNsdWRlcyhkYXRhYmFzZUlkZW50aWZpZXIpKSBjb250aW51ZVxuXG4gICAgICBjb25zdCBtaWdyYXRpb25JbnN0YW5jZSA9IG5ldyBNaWdyYXRpb25DbGFzcyh7Y29uZmlndXJhdGlvbjogdGhpcy5jb25maWd1cmF0aW9uLCBkYXRhYmFzZUlkZW50aWZpZXIsIGRifSlcblxuICAgICAgYXdhaXQgdGhpcy5ydW5NaWdyYXRpb25VcCh7bWlncmF0aW9uLCBtaWdyYXRpb25JbnN0YW5jZX0pXG4gICAgICBhd2FpdCBNaWdyYXRpb25zTGVkZ2VyLnJlY29yZFZlcnNpb24oZGIsIHZlcnNpb24pXG4gICAgICBhcHBsaWVkVmVyc2lvbnMuYWRkKHZlcnNpb24pXG4gICAgICBhcHBsaWVkQ291bnQrK1xuICAgIH1cblxuICAgIHJldHVybiBhcHBsaWVkQ291bnRcbiAgfVxuXG4gIC8qKlxuICAgKiBQYXJzZXMgYW5kIG9yZGVycyBtaWdyYXRpb25zIGZyb20gYSBicm93c2VyL25hdGl2ZSByZXF1aXJlIGNvbnRleHQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9taWdyYXRvci90eXBlcy5qc1wiKS5SZXF1aXJlTWlncmF0aW9uQ29udGV4dFR5cGV9IHJlcXVpcmVDb250ZXh0IC0gTWlncmF0aW9uIHJlcXVpcmUgY29udGV4dC5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vbWlncmF0b3IvdHlwZXMuanNcIikuTWlncmF0aW9uT2JqZWN0VHlwZVtdfSAtIE9yZGVyZWQgbWlncmF0aW9ucy5cbiAgICovXG4gIG1pZ3JhdGlvbnNGcm9tUmVxdWlyZUNvbnRleHQocmVxdWlyZUNvbnRleHQpIHtcbiAgICBjb25zdCBtaWdyYXRpb25zID0gW11cblxuICAgIGZvciAoY29uc3QgZmlsZSBvZiByZXF1aXJlQ29udGV4dC5rZXlzKCkpIHtcbiAgICAgIGNvbnN0IG1hdGNoID0gZmlsZS5tYXRjaCgvKFxcZHsxMywxNH0pLSguKylcXC5qcyQvKVxuXG4gICAgICBpZiAoIW1hdGNoKSBjb250aW51ZVxuXG4gICAgICBsZXQgZmlsZU5hbWUgPSBmaWxlXG4gICAgICBsZXQgZGF0ZU51bWJlciA9IG1hdGNoWzFdXG5cbiAgICAgIGlmIChkYXRlTnVtYmVyLmxlbmd0aCA9PSAxMykge1xuICAgICAgICBkYXRlTnVtYmVyID0gYDIke2RhdGVOdW1iZXJ9YFxuICAgICAgICBmaWxlTmFtZSA9IGAyJHtmaWxlTmFtZX1gXG4gICAgICB9XG5cbiAgICAgIG1pZ3JhdGlvbnMucHVzaCh7XG4gICAgICAgIGRhdGU6IHBhcnNlSW50KGRhdGVOdW1iZXIpLFxuICAgICAgICBmaWxlOiBmaWxlTmFtZSxcbiAgICAgICAgbWlncmF0aW9uQ2xhc3NOYW1lOiBpbmZsZWN0aW9uLmNhbWVsaXplKG1hdGNoWzJdLnJlcGxhY2VBbGwoXCItXCIsIFwiX1wiKSlcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgcmV0dXJuIG1pZ3JhdGlvbnMuc29ydCgobWlncmF0aW9uMSwgbWlncmF0aW9uMikgPT4gbWlncmF0aW9uMS5kYXRlIC0gbWlncmF0aW9uMi5kYXRlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgb25lIG1pZ3JhdGlvbidzIHVwd2FyZCBpbXBsZW1lbnRhdGlvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBNaWdyYXRpb24gYXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vbWlncmF0b3IvdHlwZXMuanNcIikuTWlncmF0aW9uT2JqZWN0VHlwZX0gYXJncy5taWdyYXRpb24gLSBNaWdyYXRpb24gZGVzY3JpcHRvci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL21pZ3JhdGlvbi9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1pZ3JhdGlvbkluc3RhbmNlIC0gTWlncmF0aW9uIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciB0aGUgbWlncmF0aW9uIHN1Y2NlZWRzLlxuICAgKi9cbiAgYXN5bmMgcnVuTWlncmF0aW9uVXAoe21pZ3JhdGlvbiwgbWlncmF0aW9uSW5zdGFuY2V9KSB7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IG1pZ3JhdGlvbkluc3RhbmNlLmNoYW5nZSgpXG4gICAgfSBjYXRjaCAoY2hhbmdlRXJyb3IpIHtcbiAgICAgIGlmICghKGNoYW5nZUVycm9yIGluc3RhbmNlb2YgTm90SW1wbGVtZW50ZWRFcnJvcikpIHRocm93IGNoYW5nZUVycm9yXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IG1pZ3JhdGlvbkluc3RhbmNlLnVwKClcbiAgICAgIH0gY2F0Y2ggKHVwRXJyb3IpIHtcbiAgICAgICAgaWYgKHVwRXJyb3IgaW5zdGFuY2VvZiBOb3RJbXBsZW1lbnRlZEVycm9yKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGAnY2hhbmdlJyBvciAndXAnIGRpZG4ndCBleGlzdCBvbiBtaWdyYXRpb246ICR7bWlncmF0aW9uLmZpbGV9YCwge2NhdXNlOiB1cEVycm9yfSlcbiAgICAgICAgfVxuXG4gICAgICAgIHRocm93IHVwRXJyb3JcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBhZnRlciBtaWdyYXRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX2FmdGVyTWlncmF0aW9ucygpIHtcbiAgICBjb25zdCBlbnZpcm9ubWVudEhhbmRsZXIgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RW52aXJvbm1lbnRIYW5kbGVyKClcbiAgICBjb25zdCBkYnMgPSBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0Q3VycmVudENvbm5lY3Rpb25zKClcbiAgICBjb25zdCBmaWx0ZXJlZERicyA9IE9iamVjdC5mcm9tRW50cmllcyhcbiAgICAgIE9iamVjdC5lbnRyaWVzKGRicykuZmlsdGVyKChbZGJJZGVudGlmaWVyXSkgPT4ge1xuICAgICAgICBpZiAoIXRoaXMuaGFuZGxlc0RhdGFiYXNlSWRlbnRpZmllcihkYklkZW50aWZpZXIpKSByZXR1cm4gZmFsc2VcblxuICAgICAgICByZXR1cm4gQm9vbGVhbih0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RGF0YWJhc2VJZGVudGlmaWVyKGRiSWRlbnRpZmllcikubWlncmF0aW9ucylcbiAgICAgIH0pXG4gICAgKVxuXG4gICAgaWYgKCFlbnZpcm9ubWVudEhhbmRsZXIgfHwgT2JqZWN0LmtleXMoZmlsdGVyZWREYnMpLmxlbmd0aCA9PSAwKSByZXR1cm5cblxuICAgIC8vIFNlcmlhbGlzZSB0aGUgZnJhbWV3b3JrLXNjaGVtYSBib290c3RyYXAgYWNyb3NzIHByb2Nlc3Nlcy4gVGhpcyBjcmVhdGVzIHRoZSBhdHRhY2htZW50c1xuICAgIC8vIGFuZCBiYWNrZ3JvdW5kLWpvYnMgdGFibGVzLCBhbmQgaXQgcnVucyBvbmNlIHBlciBwcm9jZXNzIG91dHNpZGUgdGhlIHBlci1taWdyYXRpb24gbG9vcDpcbiAgICAvLyB3aXRob3V0IHRoaXMgbG9jaywgdHdvIHByb2Nlc3NlcyBib290c3RyYXBwaW5nIG9uZSBkYXRhYmFzZSByYWNlIG9uIENSRUFURSBUQUJMRSAvXG4gICAgLy8gQ1JFQVRFIElOREVYIGFuZCBvbmUgZGllcyBtaWQtYm9vdCAoZHVwbGljYXRlIG9iamVjdC9pbmRleCkuXG4gICAgZm9yIChjb25zdCBbZGJJZGVudGlmaWVyLCBkYl0gb2YgT2JqZWN0LmVudHJpZXMoZmlsdGVyZWREYnMpKSB7XG4gICAgICBjb25zdCBydW5uZXIgPSBuZXcgQWR2aXNvcnlMb2NrUnVubmVyKHtcbiAgICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5jb25maWd1cmF0aW9uLFxuICAgICAgICBjb25uZWN0aW9uUHJvdmlkZXI6ICgpID0+IGRiLFxuICAgICAgICBkYXRhYmFzZUlkZW50aWZpZXI6IGRiSWRlbnRpZmllclxuICAgICAgfSlcblxuICAgICAgYXdhaXQgcnVubmVyLndpdGhBZHZpc29yeUxvY2soXG4gICAgICAgIG1pZ3JhdGlvbnNBZHZpc29yeUxvY2tOYW1lKGRiSWRlbnRpZmllciksXG4gICAgICAgIGFzeW5jICgpID0+IHtcbiAgICAgICAgICBhd2FpdCBlbnZpcm9ubWVudEhhbmRsZXIuZW5zdXJlRnJhbWV3b3JrU2NoZW1hKHtkYnM6IHtbZGJJZGVudGlmaWVyXTogZGJ9fSlcbiAgICAgICAgfSxcbiAgICAgICAge2RlZGljYXRlZENvbm5lY3Rpb246IHRydWV9XG4gICAgICApXG4gICAgfVxuXG4gICAgLy8gRW5zdXJlIFZlbG9jaW91cycgb3duIGZyYW1ld29yayBzY2hlbWEgYmVmb3JlIHRoZSBzdHJ1Y3R1cmUgZHVtcC4gVGhlIGR1bXAgaXNcbiAgICAvLyBnYXRlZCB0byBlbmFibGVkIGVudmlyb25tZW50cywgYnV0IG1pZ3JhdGlvbi1lbmFibGVkIGRhdGFiYXNlcyBtdXN0IGluY2x1ZGVcbiAgICAvLyBmcmFtZXdvcmsgdGFibGVzIHNvIGBkYjptaWdyYXRlYCBhbmQgc2NoZW1hOmxvYWQgcHJvZHVjZSBhIGNvbXBsZXRlIGRhdGFiYXNlLlxuICAgIGF3YWl0IGVudmlyb25tZW50SGFuZGxlci5hZnRlck1pZ3JhdGlvbnMoe2RiczogZmlsdGVyZWREYnN9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbG9hZCBtaWdyYXRpb25zIHZlcnNpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgbG9hZE1pZ3JhdGlvbnNWZXJzaW9ucygpIHtcbiAgICB0aGlzLm1pZ3JhdGlvbnNWZXJzaW9ucyA9IHt9XG5cbiAgICBjb25zdCBkYnMgPSBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0Q3VycmVudENvbm5lY3Rpb25zKClcblxuICAgIGZvciAoY29uc3QgZGJJZGVudGlmaWVyIGluIGRicykge1xuICAgICAgaWYgKCF0aGlzLmhhbmRsZXNEYXRhYmFzZUlkZW50aWZpZXIoZGJJZGVudGlmaWVyKSkgY29udGludWVcblxuICAgICAgYXdhaXQgdGhpcy5sb2FkTWlncmF0aW9uc1ZlcnNpb25zRm9yRGF0YWJhc2Uoe2RiSWRlbnRpZmllciwgZGI6IGRic1tkYklkZW50aWZpZXJdfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBsb2FkIG1pZ3JhdGlvbnMgdmVyc2lvbnMgZm9yIGRhdGFiYXNlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5kYklkZW50aWZpZXIgLSBEYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGFyZ3MuZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgbG9hZE1pZ3JhdGlvbnNWZXJzaW9uc0ZvckRhdGFiYXNlKHtkYklkZW50aWZpZXIsIGRifSkge1xuICAgIGNvbnN0IGRhdGFiYXNlQ29uZmlndXJhdGlvbiA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXREYXRhYmFzZUlkZW50aWZpZXIoZGJJZGVudGlmaWVyKVxuXG4gICAgaWYgKCFkYXRhYmFzZUNvbmZpZ3VyYXRpb24ubWlncmF0aW9ucykge1xuICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYCR7ZGJJZGVudGlmaWVyfSBpc24ndCBjb25maWd1cmVkIGZvciBtaWdyYXRpb25zIC0gc2tpcHBpbmcgbG9hZGluZyBtaWdyYXRpb25zIHZlcnNpb25zIGZvciBpdGApXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAoIWF3YWl0IHRoaXMubWlncmF0aW9uc1RhYmxlRXhpc3QoZGIpKSB7XG4gICAgICB0aGlzLmxvZ2dlci5pbmZvKGBNaWdyYXRpb24gdGFibGUgZG9lcyBub3QgZXhpc3QgZm9yICR7ZGJJZGVudGlmaWVyfSAtIHNraXBwaW5nIGxvYWRpbmcgbWlncmF0aW9ucyB2ZXJzaW9ucyBmb3IgaXRgKVxuICAgICAgZGVsZXRlIHRoaXMubWlncmF0aW9uc1ZlcnNpb25zW2RiSWRlbnRpZmllcl1cbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IHZlcnNpb25zID0gYXdhaXQgTWlncmF0aW9uc0xlZGdlci5hcHBsaWVkVmVyc2lvbnMoZGIpXG5cbiAgICB0aGlzLm1pZ3JhdGlvbnNWZXJzaW9uc1tkYklkZW50aWZpZXJdID0ge31cblxuICAgIGZvciAoY29uc3QgdmVyc2lvbiBvZiB2ZXJzaW9ucykge1xuICAgICAgdGhpcy5taWdyYXRpb25zVmVyc2lvbnNbZGJJZGVudGlmaWVyXVt2ZXJzaW9uXSA9IHRydWVcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBtaWdyYXRpb25zIHRhYmxlIGV4aXN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gRGF0YWJhc2UgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gUmVzb2x2ZXMgd2l0aCBXaGV0aGVyIG1pZ3JhdGlvbnMgdGFibGUgZXhpc3QuXG4gICAqL1xuICBhc3luYyBtaWdyYXRpb25zVGFibGVFeGlzdChkYikge1xuICAgIHJldHVybiBhd2FpdCBNaWdyYXRpb25zTGVkZ2VyLnRhYmxlRXhpc3RzKGRiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZXhlY3V0ZSByZXF1aXJlIGNvbnRleHQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9taWdyYXRvci90eXBlcy5qc1wiKS5SZXF1aXJlTWlncmF0aW9uQ29udGV4dFR5cGV9IHJlcXVpcmVDb250ZXh0IC0gUmVxdWlyZSBjb250ZXh0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgZXhlY3V0ZVJlcXVpcmVDb250ZXh0KHJlcXVpcmVDb250ZXh0KSB7XG4gICAgY29uc3QgbWlncmF0aW9uRmlsZXMgPSByZXF1aXJlQ29udGV4dC5rZXlzKClcblxuICAgIC8qKlxuICAgICAqIEZpbGVzLlxuICAgICAqIEB0eXBlIHtpbXBvcnQoXCIuL21pZ3JhdG9yL3R5cGVzLmpzXCIpLk1pZ3JhdGlvbk9iamVjdFR5cGVbXX0gKi9cbiAgICBsZXQgZmlsZXMgPSBbXVxuXG4gICAgZm9yIChjb25zdCBmaWxlIG9mIG1pZ3JhdGlvbkZpbGVzKSB7XG4gICAgICBjb25zdCBtYXRjaCA9IGZpbGUubWF0Y2goL14oXFxkezE0fSktKC4rKVxcLmpzJC8pXG5cbiAgICAgIGlmICghbWF0Y2gpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IGRhdGUgPSBwYXJzZUludChtYXRjaFsxXSlcbiAgICAgIGNvbnN0IG1pZ3JhdGlvbk5hbWUgPSBtYXRjaFsyXVxuICAgICAgY29uc3QgbWlncmF0aW9uQ2xhc3NOYW1lID0gaW5mbGVjdGlvbi5jYW1lbGl6ZShtaWdyYXRpb25OYW1lKVxuXG4gICAgICBjb25zdCBtaWdyYXRpb25PYmplY3QgPSAvKiogQHR5cGUge2ltcG9ydChcIi4vbWlncmF0b3IvdHlwZXMuanNcIikuTWlncmF0aW9uT2JqZWN0VHlwZX0gKi8gKHtcbiAgICAgICAgZmlsZSxcbiAgICAgICAgZGF0ZSxcbiAgICAgICAgbWlncmF0aW9uQ2xhc3NOYW1lXG4gICAgICB9KVxuXG4gICAgICBmaWxlcy5wdXNoKG1pZ3JhdGlvbk9iamVjdClcbiAgICB9XG5cbiAgICBmaWxlcyA9IGZpbGVzLnNvcnQoKG1pZ3JhdGlvbjEsIG1pZ3JhdGlvbjIpID0+IG1pZ3JhdGlvbjEuZGF0ZSAtIG1pZ3JhdGlvbjIuZGF0ZSlcblxuICAgIGZvciAoY29uc3QgbWlncmF0aW9uIG9mIGZpbGVzKSB7XG4gICAgICBhd2FpdCB0aGlzLnJ1bk1pZ3JhdGlvbkZpbGUoe1xuICAgICAgICBtaWdyYXRpb24sXG4gICAgICAgIHJlcXVpcmVNaWdyYXRpb246IGFzeW5jICgpID0+IHJlcXVpcmVDb250ZXh0KG1pZ3JhdGlvbi5maWxlKS5kZWZhdWx0XG4gICAgICB9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlc2V0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgcmVzZXQoKSB7XG4gICAgY29uc3QgZGJzID0gYXdhaXQgdGhpcy5jb25maWd1cmF0aW9uLmdldEN1cnJlbnRDb25uZWN0aW9ucygpXG5cbiAgICBmb3IgKGNvbnN0IGRiSWRlbnRpZmllciBpbiBkYnMpIHtcbiAgICAgIGlmICghdGhpcy5oYW5kbGVzRGF0YWJhc2VJZGVudGlmaWVyKGRiSWRlbnRpZmllcikpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IGRiID0gZGJzW2RiSWRlbnRpZmllcl1cblxuICAgICAgYXdhaXQgZGIud2l0aERpc2FibGVkRm9yZWlnbktleXMoYXN5bmMgKCkgPT4ge1xuICAgICAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgICAgIGNvbnN0IGVycm9ycyA9IFtdXG4gICAgICAgICAgbGV0IGFueVRhYmxlRHJvcHBlZCA9IGZhbHNlXG5cbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgZm9yIChjb25zdCB0YWJsZSBvZiBhd2FpdCBkYi5nZXRUYWJsZXMoKSkge1xuICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBEcm9wcGluZyB0YWJsZSAke3RhYmxlLmdldE5hbWUoKX1gKVxuXG4gICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgYXdhaXQgZGIuZHJvcFRhYmxlKHRhYmxlLmdldE5hbWUoKSwge2Nhc2NhZGU6IHRydWV9KVxuICAgICAgICAgICAgICAgIGFueVRhYmxlRHJvcHBlZCA9IHRydWVcbiAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICBlcnJvcnMucHVzaChlcnJvcilcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBicmVha1xuICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tdW51c2VkLXZhcnNcbiAgICAgICAgICAgIGlmIChlcnJvcnMubGVuZ3RoID4gMCAmJiBhbnlUYWJsZURyb3BwZWQpIHtcbiAgICAgICAgICAgICAgLy8gUmV0cnlcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIHRocm93IGVycm9yc1swXVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyByb2xsYmFjay5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL21pZ3JhdG9yL3R5cGVzLmpzXCIpLk1pZ3JhdGlvbk9iamVjdFR5cGVbXX0gZmlsZXMgLSBGaWxlcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL21pZ3JhdG9yL3R5cGVzLmpzXCIpLkltcG9ydEZ1bGxwYXRoQ2FsbGJhY2tUeXBlfSBpbXBvcnRDYWxsYmFjayBGdW5jdGlvbiB0byBpbXBvcnQgYSBmaWxlXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyByb2xsYmFjayhmaWxlcywgaW1wb3J0Q2FsbGJhY2spIHtcbiAgICBjb25zdCBsYXRlc3RNaWdyYXRpb25WZXJzaW9uID0gYXdhaXQgdGhpcy5fbGF0ZXN0TWlncmF0aW9uVmVyc2lvbigpXG5cbiAgICBpZiAoIWxhdGVzdE1pZ3JhdGlvblZlcnNpb24pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIk5vIG1pZ3JhdGlvbnMgaGF2ZSBiZWVuIHJ1biB5ZXRcIilcbiAgICB9XG5cbiAgICBjb25zdCBsYXRlc3RNaWdyYXRpb25WZXJzaW9uTnVtYmVyID0gcGFyc2VJbnQobGF0ZXN0TWlncmF0aW9uVmVyc2lvbilcbiAgICBjb25zdCBtaWdyYXRpb24gPSBmaWxlcy5maW5kKChmaWxlKSA9PiBmaWxlLmRhdGUgPT0gbGF0ZXN0TWlncmF0aW9uVmVyc2lvbk51bWJlcilcblxuICAgIGlmICghbWlncmF0aW9uKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE1pZ3JhdGlvbiBmaWxlIGZvciB2ZXJzaW9uICR7bGF0ZXN0TWlncmF0aW9uVmVyc2lvbk51bWJlcn0gbm90IGZvdW5kYClcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnJ1bk1pZ3JhdGlvbkZpbGUoe1xuICAgICAgbWlncmF0aW9uLFxuICAgICAgcmVxdWlyZU1pZ3JhdGlvbjogYXN5bmMgKCkgPT4ge1xuICAgICAgICBpZiAoIW1pZ3JhdGlvbi5mdWxsUGF0aCkgdGhyb3cgbmV3IEVycm9yKGBNaWdyYXRpb24gZGlkbid0IGhhdmUgYSBmdWxsUGF0aCBrZXk6ICR7T2JqZWN0LmtleXMobWlncmF0aW9uKS5qb2luKFwiLCBcIil9YClcblxuICAgICAgICByZXR1cm4gYXdhaXQgaW1wb3J0Q2FsbGJhY2sobWlncmF0aW9uLmZ1bGxQYXRoKVxuICAgICAgfSxcbiAgICAgIGRpcmVjdGlvbjogXCJkb3duXCJcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbGF0ZXN0IG1pZ3JhdGlvbiB2ZXJzaW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmcgfCB1bmRlZmluZWQ+fSBUaGUgbGF0ZXN0IG1pZ3JhdGlvbiB2ZXJzaW9uXG4gICAqL1xuICBhc3luYyBfbGF0ZXN0TWlncmF0aW9uVmVyc2lvbigpIHtcbiAgICBpZiAoIXRoaXMubWlncmF0aW9uc1ZlcnNpb25zKSBhd2FpdCB0aGlzLmxvYWRNaWdyYXRpb25zVmVyc2lvbnMoKVxuXG4gICAgLyoqXG4gICAgICogRGVmaW5lcyBoaWdoZXN0VmVyc2lvbi5cbiAgICAgKiBAdHlwZSB7c3RyaW5nIHwgdW5kZWZpbmVkfSAqL1xuICAgIGxldCBoaWdoZXN0VmVyc2lvblxuXG4gICAgZm9yIChjb25zdCBkYklkZW50aWZpZXIgaW4gdGhpcy5taWdyYXRpb25zVmVyc2lvbnMpIHtcbiAgICAgIGZvciAoY29uc3QgbWlncmF0aW9uVmVyc2lvbiBpbiB0aGlzLm1pZ3JhdGlvbnNWZXJzaW9uc1tkYklkZW50aWZpZXJdKSB7XG4gICAgICAgIGlmICghaGlnaGVzdFZlcnNpb24gfHwgbWlncmF0aW9uVmVyc2lvbiA+IGhpZ2hlc3RWZXJzaW9uKSB7XG4gICAgICAgICAgaGlnaGVzdFZlcnNpb24gPSBtaWdyYXRpb25WZXJzaW9uXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gaGlnaGVzdFZlcnNpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1biBtaWdyYXRpb24gZmlsZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL21pZ3JhdG9yL3R5cGVzLmpzXCIpLk1pZ3JhdGlvbk9iamVjdFR5cGV9IGFyZ3MubWlncmF0aW9uIC0gTWlncmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vbWlncmF0b3IvdHlwZXMuanNcIikuUmVxdWlyZU1pZ3JhdGlvblR5cGV9IGFyZ3MucmVxdWlyZU1pZ3JhdGlvbiAtIFJlcXVpcmUgbWlncmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuZGlyZWN0aW9uXSAtIERpcmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgbWlncmF0aW9uIHJhbiBvbiBhdCBsZWFzdCBvbmUgZGF0YWJhc2UgKGZhbHNlIGlmIHNraXBwZWQgYXMgYWxyZWFkeS1ydW4gZXZlcnl3aGVyZSkuXG4gICAqL1xuICBhc3luYyBydW5NaWdyYXRpb25GaWxlKHttaWdyYXRpb24sIHJlcXVpcmVNaWdyYXRpb24sIGRpcmVjdGlvbiA9IFwidXBcIn0pIHtcbiAgICBpZiAoIXRoaXMuY29uZmlndXJhdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiTm8gY29uZmlndXJhdGlvbiBzZXRcIilcbiAgICBjb25zb2xlLmVycm9yKFwiW01JRy1ERUJVR10gcnVuTWlncmF0aW9uRmlsZSBmaWxlPVwiICsgKG1pZ3JhdGlvbiAmJiBtaWdyYXRpb24uZmlsZSkpXG4gICAgaWYgKCF0aGlzLmNvbmZpZ3VyYXRpb24uaXNEYXRhYmFzZVBvb2xJbml0aWFsaXplZCgpKSBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24uaW5pdGlhbGl6ZURhdGFiYXNlUG9vbCgpXG4gICAgaWYgKCF0aGlzLm1pZ3JhdGlvbnNWZXJzaW9ucykgYXdhaXQgdGhpcy5sb2FkTWlncmF0aW9uc1ZlcnNpb25zKClcblxuICAgIGxldCBhcHBsaWVkID0gZmFsc2VcbiAgICBjb25zdCBkYnMgPSBhd2FpdCB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0Q3VycmVudENvbm5lY3Rpb25zKClcblxuICAgIC8qKlxuICAgICAqIERiIGlkZW50aWZpZXJzIG5lZWRpbmcgbWlncmF0aW9uIHZlcnNpb25zLlxuICAgICAqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgICBjb25zdCBkYklkZW50aWZpZXJzTmVlZGluZ01pZ3JhdGlvblZlcnNpb25zID0gW11cblxuICAgIC8vIG1pZ3JhdGVGaWxlcygpIHdyYXBzIGV4ZWN1dGlvbiBpbiBlbnN1cmVDb25uZWN0aW9ucygpLCBzbyB0aGUgY3VycmVudFxuICAgIC8vIGFzeW5jIGNvbnRleHQgY2FuIGV4cG9zZSBEQiBpZGVudGlmaWVycyBub3QgbG9hZGVkIGJ5IHByZXBhcmUoKS5cbiAgICBmb3IgKGNvbnN0IGRiSWRlbnRpZmllciBpbiBkYnMpIHtcbiAgICAgIGlmICghdGhpcy5oYW5kbGVzRGF0YWJhc2VJZGVudGlmaWVyKGRiSWRlbnRpZmllcikpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IGRhdGFiYXNlQ29uZmlndXJhdGlvbiA9IHRoaXMuY29uZmlndXJhdGlvbi5nZXREYXRhYmFzZUlkZW50aWZpZXIoZGJJZGVudGlmaWVyKVxuXG4gICAgICBpZiAoIWRhdGFiYXNlQ29uZmlndXJhdGlvbi5taWdyYXRpb25zKSBjb250aW51ZVxuICAgICAgaWYgKHRoaXMubWlncmF0aW9uc1ZlcnNpb25zW2RiSWRlbnRpZmllcl0pIGNvbnRpbnVlXG5cbiAgICAgIGRiSWRlbnRpZmllcnNOZWVkaW5nTWlncmF0aW9uVmVyc2lvbnMucHVzaChkYklkZW50aWZpZXIpXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBkYklkZW50aWZpZXIgb2YgZGJJZGVudGlmaWVyc05lZWRpbmdNaWdyYXRpb25WZXJzaW9ucykge1xuICAgICAgY29uc3QgZGIgPSBkYnNbZGJJZGVudGlmaWVyXVxuXG4gICAgICBhd2FpdCB0aGlzLmNyZWF0ZU1pZ3JhdGlvbnNUYWJsZUZvckRhdGFiYXNlKHtkYklkZW50aWZpZXIsIGRifSlcbiAgICAgIGF3YWl0IHRoaXMubG9hZE1pZ3JhdGlvbnNWZXJzaW9uc0ZvckRhdGFiYXNlKHtkYklkZW50aWZpZXIsIGRifSlcbiAgICB9XG5cbiAgICBjb25zdCBtaWdyYXRpb25DbGFzcyA9IGF3YWl0IHJlcXVpcmVNaWdyYXRpb24oKVxuXG4gICAgaWYgKCFtaWdyYXRpb25DbGFzcyB8fCB0eXBlb2YgbWlncmF0aW9uQ2xhc3MgIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBNaWdyYXRpb24gJHttaWdyYXRpb24uZmlsZX0gbXVzdCBleHBvcnQgYSBkZWZhdWx0IG1pZ3JhdGlvbiBjbGFzcy4gVHlwZTogJHt0eXBlb2YgbWlncmF0aW9uQ2xhc3N9YClcbiAgICB9XG4gICAgaWYgKGRpcmVjdGlvbiA9PSBcInVwXCIgJiYgIW1pZ3JhdGlvblJ1bnNJbkV4ZWN1dGlvblBoYXNlKG1pZ3JhdGlvbkNsYXNzLCB0aGlzLmV4ZWN1dGlvblBoYXNlKSkgcmV0dXJuIGZhbHNlXG5cbiAgICBjb25zdCBtaWdyYXRpb25EYXRhYmFzZUlkZW50aWZpZXJzID0gbWlncmF0aW9uQ2xhc3MuZ2V0RGF0YWJhc2VJZGVudGlmaWVycygpIHx8IFtcImRlZmF1bHRcIl1cblxuICAgIGZvciAoY29uc3QgZGJJZGVudGlmaWVyIGluIGRicykge1xuICAgICAgaWYgKCF0aGlzLmhhbmRsZXNEYXRhYmFzZUlkZW50aWZpZXIoZGJJZGVudGlmaWVyKSkgY29udGludWVcblxuICAgICAgY29uc3QgZGF0YWJhc2VDb25maWd1cmF0aW9uID0gdGhpcy5jb25maWd1cmF0aW9uLmdldERhdGFiYXNlSWRlbnRpZmllcihkYklkZW50aWZpZXIpXG5cbiAgICAgIGlmICghZGF0YWJhc2VDb25maWd1cmF0aW9uLm1pZ3JhdGlvbnMpIHtcbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYCR7ZGJJZGVudGlmaWVyfSBpc24ndCBjb25maWd1cmVkIGZvciBtaWdyYXRpb25zIC0gc2tpcHBpbmcgbWlncmF0aW9uICR7ZGlnZyhtaWdyYXRpb24sIFwiZGF0ZVwiKX1gKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoIW1pZ3JhdGlvbkRhdGFiYXNlSWRlbnRpZmllcnMuaW5jbHVkZXMoZGJJZGVudGlmaWVyKSkge1xuICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgJHtkYklkZW50aWZpZXJ9IHNob3VsZG4ndCBydW4gbWlncmF0aW9uICR7bWlncmF0aW9uLmZpbGV9YCwge21pZ3JhdGlvbkRhdGFiYXNlSWRlbnRpZmllcnN9KVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBjb25zdCBkYiA9IGRic1tkYklkZW50aWZpZXJdXG4gICAgICBjb25zdCBkYXRlU3RyaW5nID0gYCR7ZGlnZyhtaWdyYXRpb24sIFwiZGF0ZVwiKX1gXG5cbiAgICAgIC8vIFNlcmlhbGlzZSB0aGUgY2hlY2stdGhlbi1hcHBseSBhY3Jvc3MgcHJvY2Vzc2VzLiBXaXRob3V0IHRoaXMsIHR3byBzaGFyZHMgY2FuIGJvdGhcbiAgICAgIC8vIG9ic2VydmUgdGhlIG1pZ3JhdGlvbiBhcyB1bmFwcGxpZWQgYW5kIGJvdGggZXhlY3V0ZSBpdHMgRERMOyB0aGUgbG9zZXIgZGllcyB3aXRoIHRoZVxuICAgICAgLy8gZHJpdmVyJ3MgZHVwbGljYXRlLW9iamVjdCBlcnJvciBtaWQtYm9vdC5cbiAgICAgIC8vXG4gICAgICAvLyBUaGUgdmVyc2lvbiBpcyByZS1yZWFkICppbnNpZGUqIHRoZSBsb2NrOiB3aGlsZSB0aGlzIHByb2Nlc3Mgd2FpdGVkLCBhbm90aGVyIHByb2Nlc3NcbiAgICAgIC8vIG1heSBhbHJlYWR5IGhhdmUgYXBwbGllZCB0aGUgbWlncmF0aW9uLCBpbiB3aGljaCBjYXNlIHRoaXMgb25lIG11c3QgYmVjb21lIGEgbm8tb3AuXG4gICAgICBjb25zb2xlLmVycm9yKFwiW01JRy1ERUJVR10gYWNxdWlyaW5nIGxvY2sgZGI9XCIgKyBkYklkZW50aWZpZXIgKyBcIiBmaWxlPVwiICsgbWlncmF0aW9uLmZpbGUpXG4gICAgICBjb25zdCBydW5uZXIgPSBuZXcgQWR2aXNvcnlMb2NrUnVubmVyKHtcbiAgICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5jb25maWd1cmF0aW9uLFxuICAgICAgICBjb25uZWN0aW9uUHJvdmlkZXI6ICgpID0+IGRiLFxuICAgICAgICBkYXRhYmFzZUlkZW50aWZpZXI6IGRiSWRlbnRpZmllclxuICAgICAgfSlcblxuICAgICAgY29uc3QgYXBwbGllZEluTG9jayA9IGF3YWl0IHJ1bm5lci53aXRoQWR2aXNvcnlMb2NrKFxuICAgICAgICBtaWdyYXRpb25zQWR2aXNvcnlMb2NrTmFtZShkYklkZW50aWZpZXIpLFxuICAgICAgICBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgLy8gUmUtcmVhZCB0aGUgYXBwbGllZCBzZXQgZnJvbSB0aGUgZGF0YWJhc2Ugd2hpbGUgaG9sZGluZyB0aGUgbG9jay4gVGhlIHZlcnNpb25cbiAgICAgICAgICAvLyBsaXN0IHdhcyBsb2FkZWQgZHVyaW5nIHByZXBhcmUoKSwgYmVmb3JlIGFueSBvdGhlciBwcm9jZXNzIG1heSBoYXZlIGZpbmlzaGVkXG4gICAgICAgICAgLy8gYXBwbHlpbmcgbWlncmF0aW9ucywgc28gdHJ1c3RpbmcgdGhhdCBjYWNoZWQgc25hcHNob3QgaGVyZSB3b3VsZCBsZXQgdGhpc1xuICAgICAgICAgIC8vIHByb2Nlc3MgcmUtcnVuIERETCB0aGF0IGFub3RoZXIgcHJvY2VzcyBoYXMgYWxyZWFkeSBjb21taXR0ZWQuXG4gICAgICAgICAgYXdhaXQgdGhpcy5sb2FkTWlncmF0aW9uc1ZlcnNpb25zRm9yRGF0YWJhc2Uoe2RiSWRlbnRpZmllciwgZGJ9KVxuXG4gICAgICAgICAgaWYgKGRpcmVjdGlvbiA9PSBcInVwXCIpIHtcbiAgICAgICAgICAgIGlmICh0aGlzLmhhc1J1bk1pZ3JhdGlvblZlcnNpb24oZGJJZGVudGlmaWVyLCBtaWdyYXRpb24uZGF0ZSkpIHtcbiAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYCR7ZGJJZGVudGlmaWVyfSBoYXMgYWxyZWFkeSBydW4gbWlncmF0aW9uICR7bWlncmF0aW9uLmZpbGV9YClcbiAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSBlbHNlIGlmIChkaXJlY3Rpb24gPT0gXCJkb3duXCIpIHtcbiAgICAgICAgICAgIGlmICghdGhpcy5oYXNSdW5NaWdyYXRpb25WZXJzaW9uKGRiSWRlbnRpZmllciwgbWlncmF0aW9uLmRhdGUpKSB7XG4gICAgICAgICAgICAgIHRoaXMubG9nZ2VyLmRlYnVnKGAke2RiSWRlbnRpZmllcn0gaGFzbid0IHJ1biBtaWdyYXRpb24gJHttaWdyYXRpb24uZmlsZX1gKVxuICAgICAgICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIGRpcmVjdGlvbjogJHtkaXJlY3Rpb259YClcbiAgICAgICAgICB9XG5cbiAgICAgICAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhgUnVubmluZyBtaWdyYXRpb24gb24gJHtkYklkZW50aWZpZXJ9OiAke21pZ3JhdGlvbi5maWxlfWAsIHttaWdyYXRpb25EYXRhYmFzZUlkZW50aWZpZXJzfSlcblxuICAgICAgICAgIGNvbnN0IE1pZ3JhdGlvbkNsYXNzID0gbWlncmF0aW9uQ2xhc3NcbiAgICAgICAgICBjb25zdCBtaWdyYXRpb25JbnN0YW5jZSA9IG5ldyBNaWdyYXRpb25DbGFzcyh7XG4gICAgICAgICAgICBjb25maWd1cmF0aW9uOiB0aGlzLmNvbmZpZ3VyYXRpb24sXG4gICAgICAgICAgICBkYXRhYmFzZUlkZW50aWZpZXI6IGRiSWRlbnRpZmllcixcbiAgICAgICAgICAgIGRiXG4gICAgICAgICAgfSlcblxuICAgICAgICAgIGlmIChkaXJlY3Rpb24gPT0gXCJ1cFwiKSB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICBhd2FpdCBtaWdyYXRpb25JbnN0YW5jZS5jaGFuZ2UoKVxuICAgICAgICAgICAgfSBjYXRjaCAoY2hhbmdlRXJyb3IpIHtcbiAgICAgICAgICAgICAgaWYgKGNoYW5nZUVycm9yIGluc3RhbmNlb2YgTm90SW1wbGVtZW50ZWRFcnJvcikge1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICBhd2FpdCBtaWdyYXRpb25JbnN0YW5jZS51cCgpXG4gICAgICAgICAgICAgICAgfSBjYXRjaCAodXBFcnJvcikge1xuICAgICAgICAgICAgICAgICAgaWYgKHVwRXJyb3IgaW5zdGFuY2VvZiBOb3RJbXBsZW1lbnRlZEVycm9yKSB7XG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgJ2NoYW5nZScgb3IgJ3VwJyBkaWRuJ3QgZXhpc3Qgb24gbWlncmF0aW9uOiAke21pZ3JhdGlvbi5maWxlfWAsIHtjYXVzZTogdXBFcnJvcn0pXG4gICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICB0aHJvdyB1cEVycm9yXG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHRocm93IGNoYW5nZUVycm9yXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgYXdhaXQgTWlncmF0aW9uc0xlZGdlci5yZWNvcmRWZXJzaW9uKGRiLCBkYXRlU3RyaW5nKVxuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICBhd2FpdCBtaWdyYXRpb25JbnN0YW5jZS5kb3duKClcbiAgICAgICAgICAgIH0gY2F0Y2ggKGRvd25FcnJvcikge1xuICAgICAgICAgICAgICBpZiAoZG93bkVycm9yIGluc3RhbmNlb2YgTm90SW1wbGVtZW50ZWRFcnJvcikge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgJ2Rvd24nIGRpZG4ndCBleGlzdCBvbiBtaWdyYXRpb246ICR7bWlncmF0aW9uLmZpbGV9IG9yIG1pZ3JhdGluZyBkb3duIHdpdGggYSBjaGFuZ2UgbWV0aG9kIGlzbid0IGN1cnJlbnRseSBzdXBwb3J0ZWRgLCB7Y2F1c2U6IGRvd25FcnJvcn0pXG4gICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgZG93bkVycm9yXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgYXdhaXQgTWlncmF0aW9uc0xlZGdlci5yZW1vdmVWZXJzaW9uKGRiLCBkYXRlU3RyaW5nKVxuICAgICAgICAgIH1cblxuICAgICAgICAgIHJldHVybiB0cnVlXG4gICAgICAgIH0sXG4gICAgICAgIC8vIFBpbiB0aGUgbG9jayB0byBvbmUgcGh5c2ljYWwgc2Vzc2lvbjogTVNTUUwvZXhwbGljaXQgYWR2aXNvcnkgbG9ja3MgYXJlXG4gICAgICAgIC8vIHNlc3Npb24tc2NvcGVkLCBhbmQgYSBwb29sZWQgY29ubmVjdGlvbiBjYW4gcm91dGUgYWNxdWlyZSBhbmQgcmVsZWFzZSB0b1xuICAgICAgICAvLyBkaWZmZXJlbnQgc2Vzc2lvbnMsIHdoaWNoIHdvdWxkIGxldCB0d28gcHJvY2Vzc2VzIGJvdGggXCJob2xkXCIgdGhlIGxvY2suXG4gICAgICAgIHtkZWRpY2F0ZWRDb25uZWN0aW9uOiB0cnVlfVxuICAgICAgKVxuXG4gICAgICBpZiAoIWFwcGxpZWRJbkxvY2spIGNvbnRpbnVlXG5cbiAgICAgIGFwcGxpZWQgPSB0cnVlXG4gICAgfVxuXG4gICAgcmV0dXJuIGFwcGxpZWRcbiAgfVxufVxuIl19