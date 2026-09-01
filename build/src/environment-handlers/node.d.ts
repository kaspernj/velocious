import "../database/annotations-async-hooks.js";
import Base from "./base.js";
import SqlBackgroundJobsAdapter from "../background-jobs/sql-adapter.js";
import AttachmentPathSource from "./node/attachment-path-source.js";
export type TimezoneStore = {
    ability?: import("../authorization/ability.js").default;
    offsetMinutes: number;
    requestTiming?: import("../http-server/client/request-timing.js").default;
    tenant?: ReturnType<typeof JSON.parse>;
    testProfileContext?: import("../testing/test-profiler.js").TestProfileAsyncContext;
    timeZone?: string;
};
export default class VelociousEnvironmentHandlerNode extends Base {
    _velociousPath: string | undefined;
    /**
     * Creates the built-in SQL persistence adapter.
     * @param {{configuration: import("../configuration.js").default}} args - Adapter options.
     * @returns {SqlBackgroundJobsAdapter} - SQL adapter.
     */
    createBackgroundJobsAdapter({ configuration }: {
        configuration: import("../configuration.js").default;
    }): SqlBackgroundJobsAdapter;
    /**
     * Preserves the Node TCP producer and main-process wake-up path. The main
     * owns the configured persistence adapter; Node producers never bypass it.
     * @param {{configuration: import("../configuration.js").default}} args - Client options.
     * @returns {import("../background-jobs/types.js").BackgroundJobsProducer} - Producer client.
     */
    backgroundJobsClient({ configuration }: {
        configuration: import("../configuration.js").default;
    }): import("../background-jobs/types.js").BackgroundJobsProducer;
    /**
     * Gives concurrent shared-transaction child jobs independent proxy sessions.
     * A configured single-connection pool shares mutable transaction state between
     * async jobs, while the broker requires one root-transaction lease per socket.
     * @param {{configuredPoolType: typeof import("../database/pool/base.js").default, databaseIdentifier: string}} args - Configured pool and logical database identifier.
     * @returns {typeof import("../database/pool/base.js").default} - Pool type for this context.
     */
    resolveTestSharedTransactionPoolType({ configuredPoolType, databaseIdentifier }: {
        configuredPoolType: typeof import("../database/pool/base.js").default;
        databaseIdentifier: string;
    }): typeof import("../database/pool/base.js").default;
    /**
     * Creates a test-only child proxy when TestRunner supplied an active broker.
     * @param {{DriverClass: typeof import("../database/drivers/base.js").default, config: import("../configuration-types.js").DatabaseConfigurationType, configuration: import("../configuration.js").default, databaseIdentifier: string, reuseKey?: string}} args - Connection details.
     * @returns {Promise<import("../database/drivers/base.js").default | undefined>} - Optional proxy.
     */
    createTestSharedTransactionConnection({ DriverClass, config, configuration, databaseIdentifier, reuseKey }: {
        DriverClass: typeof import("../database/drivers/base.js").default;
        config: import("../configuration-types.js").DatabaseConfigurationType;
        configuration: import("../configuration.js").default;
        databaseIdentifier: string;
        reuseKey?: string;
    }): Promise<import("../database/drivers/base.js").default | undefined>;
    /**
     * Timezone async local storage.
     * @type {import("node:async_hooks").AsyncLocalStorage<TimezoneStore> | undefined} */
    _timezoneAsyncLocalStorage: import("node:async_hooks").AsyncLocalStorage<TimezoneStore> | undefined;
    /**
     * Shared-transaction coordinator ownership by physical connection.
     * @type {import("node:async_hooks").AsyncLocalStorage<Map<object, symbol>> | undefined}
     */
    _sharedTransactionCoordinatorAsyncLocalStorage: import("node:async_hooks").AsyncLocalStorage<Map<object, symbol>> | undefined;
    /**
     * Gets the active shared-transaction coordinator owner for a connection.
     * @param {object} connection - Parent physical connection.
     * @returns {symbol | undefined} - Active coordinator owner.
     */
    getSharedTransactionCoordinatorOwner(connection: object): symbol | undefined;
    /**
     * Runs work as the current shared-transaction coordinator owner.
     * @template T
     * @param {object} connection - Parent physical connection.
     * @param {symbol} owner - Coordinator owner.
     * @param {() => T} callback - Owned work.
     * @returns {T} - Callback result.
     */
    runWithSharedTransactionCoordinatorOwner<T>(connection: object, owner: symbol, callback: () => T): T;
    /**
     * Runs work without inherited shared-transaction ownership for one connection.
     * @template T
     * @param {import("../database/drivers/base.js").default} connection - Physical connection whose owner is cleared.
     * @param {() => T} callback - Physical connection work.
     * @returns {T} - Callback result.
     */
    runWithoutSharedTransactionCoordinatorOwner<T>(connection: import("../database/drivers/base.js").default, callback: () => T): T;
    /**
     * Runs work without inherited shared-transaction coordinator ownership.
     * @template T
     * @param {() => T} callback - Detached work.
     * @returns {T} - Callback result.
     */
    runWithoutSharedTransactionCoordinatorOwners<T>(callback: () => T): T;
    /**
     * Runs work with async-safe test profile attribution.
     * @template T
     * @param {import("../testing/test-profiler.js").TestProfileAsyncContext | undefined} context - Captured profile context, or an explicit absence of attribution.
     * @param {() => T} callback - Profiled work.
     * @returns {T} - Callback result.
     */
    runWithTestProfileContext<T>(context: import("../testing/test-profiler.js").TestProfileAsyncContext | undefined, callback: () => T): T;
    /**
     * Gets the current async-safe test profile attribution context.
     * @returns {import("../testing/test-profiler.js").TestProfileAsyncContext | undefined} - Current context.
     */
    getCurrentTestProfileContext(): import("../testing/test-profiler.js").TestProfileAsyncContext | undefined;
    /**
     * Find commands result.
     * @type {import("./base.js").CommandFileObjectType[] | undefined} */
    _findCommandsResult: import("./base.js").CommandFileObjectType[] | undefined;
    /**
     * Runs debug endpoint token matches.
     * @param {string} providedToken - Token from the request.
     * @param {string} expectedToken - Configured token.
     * @returns {boolean} - Whether both tokens match.
     */
    debugEndpointTokenMatches(providedToken: string, expectedToken: string): boolean;
    /**
     * Runs get framework source directory.
     * @returns {string | undefined} - Velocious source directory used to filter framework stack frames.
     */
    getFrameworkSourceDirectory(): string | undefined;
    /**
     * Auto-discovers resource classes from src/resources/ in each backend project.
     * @param {import("../configuration.js").default} configuration - Configuration instance.
     * @returns {Promise<void>}
     */
    autoDiscoverResources(configuration: import("../configuration.js").default): Promise<void>;
    /**
     * Loads models contributed by registered packages into the model registry,
     * after the app's own `initializeModels` hook. A package whose models directory
     * is absent is skipped; a package model whose name collides with an
     * already-registered different class throws. Node-only (uses the filesystem), so
     * it lives here rather than in the browser-bundled Configuration.
     * @param {import("../configuration.js").default} configuration - Configuration instance.
     * @returns {Promise<void>} - Resolves when complete.
     */
    initializePackageModels(configuration: import("../configuration.js").default): Promise<void>;
    /**
     * Runs set configuration.
     * @param {import("../configuration.js").default} newConfiguration - New configuration.
     * @returns {void} - No return value.
     */
    setConfiguration(newConfiguration: import("../configuration.js").default): void;
    /**
     * Runs read attachment input file.
     * @param {string} filePath - File path.
     * @returns {Promise<Buffer>} - File bytes.
     */
    readAttachmentInputFile(filePath: string): Promise<Buffer>;
    /**
     * Runs resolve attachment input path.
     * @param {object} args - Args.
     * @param {string[]} args.allowedPathPrefixes - Allowed path prefixes.
     * @param {string} args.inputPath - Input path.
     * @returns {Promise<AttachmentPathSource>} - Opened regular-file path source.
     */
    resolveAttachmentInputPath({ allowedPathPrefixes, inputPath }: {
        allowedPathPrefixes: string[];
        inputPath: string;
    }): Promise<AttachmentPathSource>;
    /**
     * Runs find commands.
     * @returns {Promise<Array<import("./base.js").CommandFileObjectType>>} - Resolves with the commands.
     */
    findCommands(): Promise<Array<import("./base.js").CommandFileObjectType>>;
    /**
     * Runs run with timezone offset.
     * @param {number} offsetMinutes - Offset in minutes (Date#getTimezoneOffset).
     * @param {() => Promise<ReturnType<typeof JSON.parse>>} callback - Callback to run.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Result of the callback.
     */
    runWithTimezoneOffset(offsetMinutes: number, callback: () => Promise<ReturnType<typeof JSON.parse>>): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs run with timezone.
     * @param {string} timeZone - IANA timezone identifier.
     * @param {() => Promise<ReturnType<typeof JSON.parse>>} callback - Callback to run.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Result of the callback.
     */
    runWithTimezone(timeZone: string, callback: () => Promise<ReturnType<typeof JSON.parse>>): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs set timezone offset.
     * @param {number} offsetMinutes - Offset in minutes (Date#getTimezoneOffset).
     * @returns {void} - No return value.
     */
    setTimezoneOffset(offsetMinutes: number): void;
    /**
     * Runs set timezone.
     * @param {string} timeZone - IANA timezone identifier.
     * @returns {void} - No return value.
     */
    setTimezone(timeZone: string): void;
    /**
     * Runs get timezone offset minutes.
     * @param {import("../configuration.js").default | undefined} configuration - Configuration instance.
     * @returns {number} - Offset in minutes.
     */
    getTimezoneOffsetMinutes(configuration: import("../configuration.js").default | undefined): number;
    /**
     * Runs get timezone.
     * @param {import("../configuration.js").default | undefined} configuration - Configuration instance.
     * @returns {string | undefined} - Timezone identifier.
     */
    getTimeZone(configuration: import("../configuration.js").default | undefined): string | undefined;
    /**
     * Runs run with ability.
     * @param {import("../authorization/ability.js").default | undefined} ability - Ability to set for callback scope.
     * @param {() => Promise<ReturnType<typeof JSON.parse>>} callback - Callback.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Callback result.
     */
    runWithAbility(ability: import("../authorization/ability.js").default | undefined, callback: () => Promise<ReturnType<typeof JSON.parse>>): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs set current ability.
     * @param {import("../authorization/ability.js").default | undefined} ability - Ability to set.
     * @returns {void} - No return value.
     */
    setCurrentAbility(ability: import("../authorization/ability.js").default | undefined): void;
    /**
     * Runs get current ability.
     * @returns {import("../authorization/ability.js").default | undefined} - Current ability.
     */
    getCurrentAbility(): import("../authorization/ability.js").default | undefined;
    /**
     * Runs run with request timing.
     * @param {import("../http-server/client/request-timing.js").default | undefined} requestTiming - Request timing collector.
     * @param {() => Promise<ReturnType<typeof JSON.parse>>} callback - Callback.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Callback result.
     */
    runWithRequestTiming(requestTiming: import("../http-server/client/request-timing.js").default | undefined, callback: () => Promise<ReturnType<typeof JSON.parse>>): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs get current request timing.
     * @returns {import("../http-server/client/request-timing.js").default | undefined} - Current request timing collector.
     */
    getCurrentRequestTiming(): import("../http-server/client/request-timing.js").default | undefined;
    /**
     * Runs run with tenant.
     * @param {ReturnType<typeof JSON.parse>} tenant - Tenant to set for callback scope.
     * @param {() => Promise<ReturnType<typeof JSON.parse>>} callback - Callback.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Callback result.
     */
    runWithTenant(tenant: ReturnType<typeof JSON.parse>, callback: () => Promise<ReturnType<typeof JSON.parse>>): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs set current tenant.
     * @param {ReturnType<typeof JSON.parse>} tenant - Tenant to set.
     * @returns {void} - No return value.
     */
    setCurrentTenant(tenant: ReturnType<typeof JSON.parse>): void;
    /**
     * Runs get current tenant.
     * @returns {ReturnType<typeof JSON.parse>} - Current tenant.
     */
    getCurrentTenant(): ReturnType<typeof JSON.parse>;
    /**
     * Runs actual find commands.
     * @returns {Promise<Array<import("./base.js").CommandFileObjectType>>} - Resolves with discovered command files.
     */
    _actualFindCommands(): Promise<Array<import("./base.js").CommandFileObjectType>>;
    /**
     * Runs command name from file path.
     * @param {string} filePath - Full command file path.
     * @returns {string} - Parsed command name.
     */
    commandNameFromFilePath(filePath: string): string;
    /**
     * Runs cli commands init.
     * @param {import("../cli/base-command.js").default} command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    cliCommandsInit(command: import("../cli/base-command.js").default): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs cli commands migration generate.
     * @param {import("../cli/base-command.js").default} command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    cliCommandsMigrationGenerate(command: import("../cli/base-command.js").default): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs cli commands migration destroy.
     * @param {import("../cli/base-command.js").default} command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    cliCommandsMigrationDestroy(command: import("../cli/base-command.js").default): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs cli commands generate base models.
     * @param {import("../cli/base-command.js").default} command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    cliCommandsGenerateBaseModels(command: import("../cli/base-command.js").default): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs cli commands generate frontend models.
     * @param {import("../cli/base-command.js").default} command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    cliCommandsGenerateFrontendModels(command: import("../cli/base-command.js").default): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs cli commands generate model.
     * @param {import("../cli/base-command.js").default} command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    cliCommandsGenerateModel(command: import("../cli/base-command.js").default): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs cli commands lint relationships.
     * @param {import("../cli/base-command.js").default} command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    cliCommandsLintRelationships(command: import("../cli/base-command.js").default): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs cli commands routes.
     * @param {import("../cli/base-command.js").default} command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    cliCommandsRoutes(command: import("../cli/base-command.js").default): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs cli commands console.
     * @param {import("../cli/base-command.js").default} command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    cliCommandsConsole(command: import("../cli/base-command.js").default): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs cli commands server.
     * @param {import("../cli/base-command.js").default} command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    cliCommandsServer(command: import("../cli/base-command.js").default): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs cli commands test.
     * @param {import("../cli/base-command.js").default} command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    cliCommandsTest(command: import("../cli/base-command.js").default): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs cli commands test timing manifest merge.
     * @param {import("../cli/base-command.js").default} command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    cliCommandsTestTimingManifestMerge(command: import("../cli/base-command.js").default): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs cli commands background jobs main.
     * @param {import("../cli/base-command.js").default} command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    cliCommandsBackgroundJobsMain(command: import("../cli/base-command.js").default): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs CLI background-jobs activation.
     * @param {import("../cli/base-command.js").default} command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Result.
     */
    cliCommandsBackgroundJobsActivate(command: import("../cli/base-command.js").default): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs CLI background-jobs retirement.
     * @param {import("../cli/base-command.js").default} command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Result.
     */
    cliCommandsBackgroundJobsRetire(command: import("../cli/base-command.js").default): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs cli commands background jobs worker.
     * @param {import("../cli/base-command.js").default} command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    cliCommandsBackgroundJobsWorker(command: import("../cli/base-command.js").default): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs cli commands background jobs runner.
     * @param {import("../cli/base-command.js").default} command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    cliCommandsBackgroundJobsRunner(command: import("../cli/base-command.js").default): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs cli commands beacon.
     * @param {import("../cli/base-command.js").default} command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    cliCommandsBeacon(command: import("../cli/base-command.js").default): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs load beacon client.
     * @returns {Promise<typeof import("../beacon/client.js").default>} - Beacon client class.
     */
    loadBeaconClient(): Promise<typeof import("../beacon/client.js").default>;
    /**
     * Runs load in process beacon client.
     * @returns {Promise<typeof import("../beacon/in-process-client.js").default>} - In-process client class.
     */
    loadInProcessBeaconClient(): Promise<typeof import("../beacon/in-process-client.js").default>;
    /**
     * Runs cli commands db schema dump.
     * @param {import("../cli/base-command.js").default} command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    cliCommandsDbSchemaDump(command: import("../cli/base-command.js").default): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs cli commands db schema load.
     * @param {import("../cli/base-command.js").default} command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    cliCommandsDbSchemaLoad(command: import("../cli/base-command.js").default): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs cli commands db seed.
     * @param {import("../cli/base-command.js").default} command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    cliCommandsDbSeed(command: import("../cli/base-command.js").default): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs cli commands runner.
     * @param {import("../cli/base-command.js").default} command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    cliCommandsRunner(command: import("../cli/base-command.js").default): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs cli commands run script.
     * @param {import("../cli/base-command.js").default} command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    cliCommandsRunScript(command: import("../cli/base-command.js").default): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs require command.
     * @param {object} args - Options object.
     * @param {string[]} args.commandParts - Command parts.
     * @returns {Promise<typeof import ("../cli/base-command.js").default>} - Resolves with the require command.
     */
    requireCommand({ commandParts }: {
        commandParts: string[];
    }): Promise<typeof import("../cli/base-command.js").default>;
    /**
     * Runs find migrations.
     * @returns {Promise<Array<import("./base.js").MigrationObjectType>>} - Resolves with the migrations.
     */
    findMigrations(): Promise<Array<import("./base.js").MigrationObjectType>>;
    /**
     * Collects migration files from one directory into `files`, preserving each
     * file's real absolute path (so app and package migrations keep their own
     * source location). A missing directory is skipped.
     * @param {string} migrationsPath - Directory to scan.
     * @param {Array<import("./base.js").MigrationObjectType>} files - Accumulator to push into.
     * @returns {Promise<void>} - Resolves when complete.
     */
    _collectMigrationsFromDirectory(migrationsPath: string, files: Array<import("./base.js").MigrationObjectType>): Promise<void>;
    /**
     * Throws if two migrations from different files share the same 14-digit
     * timestamp. The `schema_migrations` ledger keys on the timestamp, so a silent
     * collision (e.g. between the app and a package, or two packages) would leave
     * the second migration un-run — a data bug. Fail loudly instead.
     * @param {Array<import("./base.js").MigrationObjectType>} files - Collected migrations.
     * @returns {void} - No return value.
     */
    _ensureNoMigrationTimestampCollisions(files: Array<import("./base.js").MigrationObjectType>): void;
    /**
     * Runs import application routes.
     * @returns {Promise<import("../routes/index.js").default>} - Resolves with the import application routes.
     */
    importApplicationRoutes(): Promise<import("../routes/index.js").default>;
    /**
     * Runs get velocious path.
     * @returns {Promise<string>} - Resolves with the velocious path.
     */
    getVelociousPath(): Promise<string>;
    /**
     * Runs import test files.
     * @param {string[]} testFiles - Test files.
     * @returns {Promise<void>} - Resolves when complete.
     */
    importTestFiles(testFiles: string[]): Promise<void>;
    /**
     * Runs get default log directory.
     * @param {object} args - Options object.
     * @param {import("../configuration.js").default} args.configuration - Configuration instance.
     * @returns {string} - The default log directory.
     */
    getDefaultLogDirectory({ configuration }: {
        configuration: import("../configuration.js").default;
    }): string;
    /**
     * Runs get log file path.
     * @param {object} args - Options object.
     * @param {import("../configuration.js").default} args.configuration - Configuration instance.
     * @param {string | undefined} args.directory - Directory path.
     * @param {string} args.environment - Environment.
     * @returns {string | undefined} - The log file path.
     */
    getLogFilePath({ configuration, directory, environment }: {
        configuration: import("../configuration.js").default;
        directory: string | undefined;
        environment: string;
    }): string | undefined;
    /**
     * Runs write log to file.
     * @param {object} args - Options object.
     * @param {string} args.filePath - File path.
     * @param {string} args.message - Message text.
     * @returns {Promise<void>} - Resolves when complete.
     */
    writeLogToFile({ filePath, message }: {
        filePath: string;
        message: string;
    }): Promise<void>;
    importTestingConfigPath(): Promise<void>;
    /**
     * Runs require migration.
     * @param {string} filePath - File path.
     * @returns {Promise<import("../database/migration/index.js").default>} - Resolves with the require migration.
     */
    requireMigration(filePath: string): Promise<import("../database/migration/index.js").default>;
    getBasePath(): Promise<string>;
    /**
     * Ensures Velocious framework schema exists as part of `db:migrate`, so internal
     * tables are created deterministically alongside app migrations and captured in
     * the dumped structure SQL instead of appearing only when runtime stores boot.
     * @param {object} args - Options object.
     * @param {Record<string, import("../database/drivers/base.js").default>} args.dbs - Dbs being migrated.
     * @returns {Promise<void>} - Resolves when complete.
     */
    ensureFrameworkSchema({ dbs }: {
        dbs: Record<string, import("../database/drivers/base.js").default>;
    }): Promise<void>;
    /**
     * Runs after migrations.
     * @param {object} args - Options object.
     * @param {Record<string, import("../database/drivers/base.js").default>} args.dbs - Dbs.
     * @param {"migration" | "schemaDump"} [args.reason] - Why the structure write is being triggered.
     * @returns {Promise<void>} - Resolves when complete.
     */
    afterMigrations({ dbs, reason }: {
        dbs: Record<string, import("../database/drivers/base.js").default>;
        reason?: "migration" | "schemaDump";
    }): Promise<void>;
    /**
     * Runs structure sql by identifier.
     * @param {object} args - Options object.
     * @param {Record<string, import("../database/drivers/base.js").default>} args.dbs - Dbs.
     * @returns {Promise<Record<string, string>>} - Resolves with SQL string.
     */
    _structureSqlByIdentifier({ dbs }: {
        dbs: Record<string, import("../database/drivers/base.js").default>;
    }): Promise<Record<string, string>>;
    /**
     * Generates INSERT statements for every row in `schema_migrations` so the
     * structure snapshot carries the migration ledger along with the DDL.  Without
     * these rows a fresh DB loaded from the snapshot will re-run every migration,
     * which fails when the snapshot already contains the post-migration schema.
     * @param {object} args - Options object.
     * @param {import("../database/drivers/base.js").default} args.db - Database connection.
     * @returns {Promise<string>} - INSERT statements (empty string when none).
     */
    _schemaMigrationsInsertSql({ db }: {
        db: import("../database/drivers/base.js").default;
    }): Promise<string>;
    /**
     * Registers frontend-model websocket channel publishers so lifecycle
     * event hooks broadcast over the shared "frontend-models" channel.
     * This is only implemented by the Node handler because the required
     * modules (`frontend-model-controller`, `routes/resolver`) pull in
     * server-only Node APIs that break browser bundlers.
     * @param {import("../configuration.js").default} configuration - Configuration instance.
     * @returns {Promise<void>} - Resolves when complete.
     */
    initializeFrontendModelWebsocketPublishers(configuration: import("../configuration.js").default): Promise<void>;
}
//# sourceMappingURL=node.d.ts.map