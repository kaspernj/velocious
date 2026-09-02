export type CommandFileObjectType = {
    /**
     * - Command name.
     */
    name: string;
    /**
     * - Command file path.
     */
    file: string;
};
export type MigrationObjectType = {
    /**
     * - Migration timestamp parsed from filename.
     */
    date: number;
    /**
     * - Absolute path to the migration file.
     */
    fullPath?: string;
    /**
     * - Exported migration class name.
     */
    migrationClassName: string;
    /**
     * - Migration filename.
     */
    file: string;
};
export type TestDatabaseAccessScopeStorage = {
    /**
     * - Gets the inherited scope.
     */
    getStore: () => ({
        revoked: boolean;
    } | undefined);
    /**
     * - Runs in the scope.
     */
    run: (scope: {
        revoked: boolean;
    } | undefined, callback: () => ReturnType<typeof JSON.parse>) => ReturnType<typeof JSON.parse>;
};
/**
 * CommandFileObjectType type.
 * @typedef {object} CommandFileObjectType
 * @property {string} name - Command name.
 * @property {string} file - Command file path.
 */
/**
 * MigrationObjectType type.
 * @typedef {object} MigrationObjectType
 * @property {number} date - Migration timestamp parsed from filename.
 * @property {string} [fullPath] - Absolute path to the migration file.
 * @property {string} migrationClassName - Exported migration class name.
 * @property {string} file - Migration filename.
 */
/**
 * TestDatabaseAccessScopeStorage type.
 * @typedef {object} TestDatabaseAccessScopeStorage
 * @property {() => ({revoked: boolean} | undefined)} getStore - Gets the inherited scope.
 * @property {(scope: {revoked: boolean} | undefined, callback: () => ReturnType<typeof JSON.parse>) => ReturnType<typeof JSON.parse>} run - Runs in the scope.
 */
export declare class TestDatabaseAccessRevokedError extends Error {
}
export default class VelociousEnvironmentHandlerBase {
    _currentRequestTiming: import("../http-server/client/request-timing.js").default | undefined;
    _currentAbility: import("../authorization/ability.js").default | undefined;
    args: object | undefined;
    configuration: import("../configuration.js").default | undefined;
    processArgs: string[] | undefined;
    /**
     * Resolves the configured database pool type for the current runtime context.
     * Browser and ordinary server contexts retain the application configuration.
     * @param {{configuredPoolType: typeof import("../database/pool/base.js").default, databaseIdentifier: string}} args - Configured pool and logical database identifier.
     * @returns {typeof import("../database/pool/base.js").default} - Pool type for this context.
     */
    resolveTestSharedTransactionPoolType({ configuredPoolType }: {
        configuredPoolType: typeof import("../database/pool/base.js").default;
        databaseIdentifier: string;
    }): typeof import("../database/pool/base.js").default;
    /**
     * Node test runtimes may replace a physical child connection with a broker
     * proxy. Other environments never participate in this test-only protocol.
     * @param {{DriverClass: typeof import("../database/drivers/base.js").default, config: import("../configuration-types.js").DatabaseConfigurationType, configuration: import("../configuration.js").default, databaseIdentifier: string, reuseKey?: string}} _args - Connection details.
     * @returns {Promise<import("../database/drivers/base.js").default | undefined>} - Optional proxy.
     */
    createTestSharedTransactionConnection(_args: {
        DriverClass: typeof import("../database/drivers/base.js").default;
        config: import("../configuration-types.js").DatabaseConfigurationType;
        configuration: import("../configuration.js").default;
        databaseIdentifier: string;
        reuseKey?: string;
    }): Promise<import("../database/drivers/base.js").default | undefined>;
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
     * Installs async-context storage when this handler is driven by the Node test runner.
     * @param {import("node:async_hooks").AsyncLocalStorage<Map<object, symbol>>} storage - Coordinator owner storage.
     */
    installSharedTransactionCoordinatorOwnerStorage(storage: import("node:async_hooks").AsyncLocalStorage<Map<object, symbol>>): void;
    /** @type {import("node:async_hooks").AsyncLocalStorage<Map<object, symbol>> | undefined} */
    _sharedTransactionCoordinatorOwnerStorage: import("node:async_hooks").AsyncLocalStorage<Map<object, symbol>> | undefined;
    /**
     * Runs work with test-profile attribution. Runtimes without async-context
     * storage execute the callback without installing ambient attribution.
     * @template T
     * @param {import("../testing/test-profiler.js").TestProfileAsyncContext | undefined} _context - Captured profile context, or an explicit absence of attribution.
     * @param {() => T} callback - Profiled work.
     * @returns {T} - Callback result.
     */
    runWithTestProfileContext<T>(_context: import("../testing/test-profiler.js").TestProfileAsyncContext | undefined, callback: () => T): T;
    /**
     * Gets the current test-profile attribution context.
     * @returns {import("../testing/test-profiler.js").TestProfileAsyncContext | undefined} - Active context.
     */
    getCurrentTestProfileContext(): import("../testing/test-profiler.js").TestProfileAsyncContext | undefined;
    /**
     * Runs work in a revocable test database-access scope.
     * @template T
     * @param {{revoked: boolean}} scope - Attempt-owned access scope.
     * @param {() => T | Promise<T>} callback - Attempt work.
     * @returns {Promise<T>} - Callback result.
     */
    runWithTestDatabaseAccessScope<T>(scope: {
        revoked: boolean;
    }, callback: () => T | Promise<T>): Promise<T>;
    /**
     * Runs work with an explicitly captured test database-access scope.
     * @template T
     * @param {{revoked: boolean} | undefined} scope - Captured access scope.
     * @param {() => T | Promise<T>} callback - Work to run.
     * @returns {Promise<T>} - Callback result.
     */
    runWithCapturedTestDatabaseAccessScope<T>(scope: {
        revoked: boolean;
    } | undefined, callback: () => T | Promise<T>): Promise<T>;
    /**
     * Gets the current test database-access scope.
     * @returns {{revoked: boolean} | undefined} - Current scope.
     */
    currentTestDatabaseAccessScope(): {
        revoked: boolean;
    } | undefined;
    /** Throws when the current test attempt no longer owns database access. */
    assertTestDatabaseAccessAllowed(): void;
    /**
     * Installs async-context storage owned by the first Node test runner.
     * @param {TestDatabaseAccessScopeStorage} storage - Scope storage.
     */
    installTestDatabaseAccessScopeStorage(storage: TestDatabaseAccessScopeStorage): void;
    /** @type {Array<{owner: symbol, scope: {revoked: boolean} | undefined}>} */
    _testDatabaseAccessScopes: Array<{
        owner: symbol;
        scope: {
            revoked: boolean;
        } | undefined;
    }>;
    /** @type {TestDatabaseAccessScopeStorage | undefined} */
    _testDatabaseAccessScopeStorage: TestDatabaseAccessScopeStorage | undefined;
    /**
     * Mutable ambient tenant used by runtimes without async-context storage.
     * @type {ReturnType<typeof JSON.parse> | undefined}
     */
    _currentTenant: ReturnType<typeof JSON.parse> | undefined;
    /**
     * Active ambient scopes in start order. This prevents a scope that completes
     * out of order from restoring a tenant belonging to an already-completed scope.
     * Ambient reads are still shared in browser runtimes; immutable handles remain
     * the concurrency-safe database API.
     * @type {Array<{owner: symbol, tenant: ReturnType<typeof JSON.parse>}>}
     */
    _tenantScopes: Array<{
        owner: symbol;
        tenant: ReturnType<typeof JSON.parse>;
    }>;
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
     * Auto-discovers resource classes. No-op in base handler; overridden in Node handler.
     * @param {import("../configuration.js").default} _configuration - Configuration instance.
     * @returns {Promise<void>}
     */
    autoDiscoverResources(_configuration: import("../configuration.js").default): Promise<void>;
    /**
     * Runs run with timezone offset.
     * @param {number} _offsetMinutes - Offset in minutes (Date#getTimezoneOffset).
     * @param {() => Promise<ReturnType<typeof JSON.parse>>} callback - Callback to run.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Result of the callback.
     */
    runWithTimezoneOffset(_offsetMinutes: number, callback: () => Promise<ReturnType<typeof JSON.parse>>): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs run with timezone.
     * @param {string} timeZone - IANA timezone identifier.
     * @param {() => Promise<ReturnType<typeof JSON.parse>>} callback - Callback to run.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Result of the callback.
     */
    runWithTimezone(timeZone: string, callback: () => Promise<ReturnType<typeof JSON.parse>>): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs set timezone offset.
     * @param {number} _offsetMinutes - Offset in minutes (Date#getTimezoneOffset).
     * @returns {void} - No return value.
     */
    setTimezoneOffset(_offsetMinutes: number): void;
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
     * Runs cli commands generate base models.
     * @param {import("../cli/base-command.js").default} _command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    cliCommandsGenerateBaseModels(_command: import("../cli/base-command.js").default): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs cli commands generate frontend models.
     * @param {import("../cli/base-command.js").default} _command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    cliCommandsGenerateFrontendModels(_command: import("../cli/base-command.js").default): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs cli commands init.
     * @param {import("../cli/base-command.js").default} command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    cliCommandsInit(command: import("../cli/base-command.js").default): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs cli commands migration generate.
     * @param {import("../cli/base-command.js").default} _command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    cliCommandsMigrationGenerate(_command: import("../cli/base-command.js").default): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs cli commands migration destroy.
     * @param {import("../cli/base-command.js").default} _command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    cliCommandsMigrationDestroy(_command: import("../cli/base-command.js").default): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs cli commands generate model.
     * @param {import("../cli/base-command.js").default} _command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    cliCommandsGenerateModel(_command: import("../cli/base-command.js").default): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs cli commands lint relationships.
     * @abstract
     * @param {import("../cli/base-command.js").default} _command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    cliCommandsLintRelationships(_command: import("../cli/base-command.js").default): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs cli commands routes.
     * @abstract
     * @param {import("../cli/base-command.js").default} _command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    cliCommandsRoutes(_command: import("../cli/base-command.js").default): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs cli commands console.
     * @param {import("../cli/base-command.js").default} _command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    cliCommandsConsole(_command: import("../cli/base-command.js").default): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs cli commands server.
     * @param {import("../cli/base-command.js").default} _command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    cliCommandsServer(_command: import("../cli/base-command.js").default): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs cli commands test.
     * @param {import("../cli/base-command.js").default} _command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    cliCommandsTest(_command: import("../cli/base-command.js").default): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs cli commands test timing manifest merge.
     * @param {import("../cli/base-command.js").default} _command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    cliCommandsTestTimingManifestMerge(_command: import("../cli/base-command.js").default): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs cli commands background jobs main.
     * @param {import("../cli/base-command.js").default} _command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    cliCommandsBackgroundJobsMain(_command: import("../cli/base-command.js").default): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs CLI background-jobs activation.
     * @param {import("../cli/base-command.js").default} _command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Result.
     */
    cliCommandsBackgroundJobsActivate(_command: import("../cli/base-command.js").default): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs CLI background-jobs retirement.
     * @param {import("../cli/base-command.js").default} _command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Result.
     */
    cliCommandsBackgroundJobsRetire(_command: import("../cli/base-command.js").default): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs cli commands background jobs worker.
     * @param {import("../cli/base-command.js").default} _command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    cliCommandsBackgroundJobsWorker(_command: import("../cli/base-command.js").default): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs cli commands background jobs runner.
     * @param {import("../cli/base-command.js").default} _command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    cliCommandsBackgroundJobsRunner(_command: import("../cli/base-command.js").default): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs cli commands beacon.
     * @param {import("../cli/base-command.js").default} _command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    cliCommandsBeacon(_command: import("../cli/base-command.js").default): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Loads the TCP-backed Beacon client class. Routed through the
     * environment handler so the dynamic `import("../beacon/client.js")`
     * call lives on the Node-only path — keeps Beacon's `node:net` /
     * `node:crypto` deps out of browser bundles that statically reach
     * `Configuration` (and therefore previously reached the dynamic
     * imports).
     * @returns {Promise<typeof import("../beacon/client.js").default>} - Beacon client class.
     */
    loadBeaconClient(): Promise<typeof import("../beacon/client.js").default>;
    /**
     * Loads the in-process Beacon client class. Same indirection rationale
     * as `loadBeaconClient`.
     * @returns {Promise<typeof import("../beacon/in-process-client.js").default>} - In-process client class.
     */
    loadInProcessBeaconClient(): Promise<typeof import("../beacon/in-process-client.js").default>;
    /**
     * Runs cli commands db schema dump.
     * @param {import("../cli/base-command.js").default} _command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    cliCommandsDbSchemaDump(_command: import("../cli/base-command.js").default): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs cli commands db schema load.
     * @param {import("../cli/base-command.js").default} _command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    cliCommandsDbSchemaLoad(_command: import("../cli/base-command.js").default): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs cli commands db seed.
     * @param {import("../cli/base-command.js").default} _command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    cliCommandsDbSeed(_command: import("../cli/base-command.js").default): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs cli commands runner.
     * @param {import("../cli/base-command.js").default} _command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    cliCommandsRunner(_command: import("../cli/base-command.js").default): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs cli commands run script.
     * @param {import("../cli/base-command.js").default} _command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    cliCommandsRunScript(_command: import("../cli/base-command.js").default): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs find commands.
     * @abstract
     * @returns {Promise<CommandFileObjectType[]>} - Resolves with the commands.
     */
    findCommands(): Promise<CommandFileObjectType[]>;
    /**
     * Runs find migrations.
     * @abstract
     * @returns {Promise<Array<MigrationObjectType>>} - Resolves with the migrations.
     */
    findMigrations(): Promise<Array<MigrationObjectType>>;
    /**
     * Runs forward command.
     * @param {import("../cli/base-command.js").default} command - Command.
     * @param {typeof import("../cli/base-command.js").default} CommandClass - Command class.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    forwardCommand(command: import("../cli/base-command.js").default, CommandClass: typeof import("../cli/base-command.js").default): Promise<ReturnType<typeof JSON.parse>>;
    /**
     * Runs get velocious path.
     * @abstract
     * @returns {Promise<string>} - Resolves with the velocious path.
     */
    getVelociousPath(): Promise<string>;
    /**
     * Runs import application routes.
     * @abstract
     * @returns {Promise<import("../routes/index.js").default>} - Resolves with the import application routes.
     */
    importApplicationRoutes(): Promise<import("../routes/index.js").default>;
    /**
     * Runs import test files.
     * @abstract
     * @param {string[]} _testFiles - Test files.
     * @returns {Promise<void>} - Resolves when complete.
     */
    importTestFiles(_testFiles: string[]): Promise<void>;
    /**
     * Runs import testing config path.
     * @abstract
     * @returns {Promise<void>} - Resolves when complete.
     */
    importTestingConfigPath(): Promise<void>;
    /**
     * Runs after migrations.
     * @param {object} args - Options object.
     * @param {Record<string, import("../database/drivers/base.js").default>} args.dbs - Dbs.
     * @param {"migration" | "schemaDump"} [args.reason] - Why the structure write hook is being invoked.
     * @returns {Promise<void>} - Resolves when complete.
     */
    afterMigrations(args: {
        dbs: Record<string, import("../database/drivers/base.js").default>;
        reason?: "migration" | "schemaDump";
    }): Promise<void>;
    /**
     * Ensures velocious' own framework-owned schema (e.g. the background-jobs
     * tables) exists after app migrations run, so `db:migrate` produces a complete
     * schema deterministically instead of it only appearing once a runtime store
     * boots. Runs before the structure dump. No-op by default; the node handler
     * overrides it.
     * @param {object} args - Options object.
     * @param {Record<string, import("../database/drivers/base.js").default>} args.dbs - Dbs being migrated.
     * @returns {Promise<void>} - Resolves when complete.
     */
    ensureFrameworkSchema(args: {
        dbs: Record<string, import("../database/drivers/base.js").default>;
    }): Promise<void>;
    /**
     * Creates the environment's default persistence adapter.
     * @abstract
     * @param {{configuration: import("../configuration.js").default}} _args - Adapter options.
     * @returns {import("../background-jobs/adapter.js").default} - Default adapter.
     */
    createBackgroundJobsAdapter(_args: {
        configuration: import("../configuration.js").default;
    }): import("../background-jobs/adapter.js").default;
    /**
     * Creates the platform-neutral producer path for an explicit adapter.
     * @param {{configuration: import("../configuration.js").default}} args - Client options.
     * @returns {import("../background-jobs/types.js").BackgroundJobsProducer} - Adapter-backed producer.
     */
    backgroundJobsClient(args: {
        configuration: import("../configuration.js").default;
    }): import("../background-jobs/types.js").BackgroundJobsProducer;
    /**
     * Runs require command.
     * @abstract
     * @param {object} args - Options object.
     * @param {string[]} args.commandParts - Command parts.
     * @returns {Promise<typeof import ("../cli/base-command.js").default>} - Resolves with the require command.
     */
    requireCommand({ commandParts }: {
        commandParts: string[];
    }): Promise<typeof import("../cli/base-command.js").default>;
    /**
     * Runs set args.
     * @param {object} newArgs - New args.
     * @returns {void} - No return value.
     */
    setArgs(newArgs: object): void;
    /**
     * Runs set configuration.
     * @param {import("../configuration.js").default} newConfiguration - New configuration.
     * @returns {void} - No return value.
     */
    setConfiguration(newConfiguration: import("../configuration.js").default): void;
    /**
     * Runs read attachment input file.
     * @param {string} _filePath - File path.
     * @returns {Promise<Buffer>} - File bytes.
     */
    readAttachmentInputFile(_filePath: string): Promise<Buffer>;
    /**
     * Runs resolve attachment input path.
     * @param {object} _args - Args.
     * @param {string[]} _args.allowedPathPrefixes - Allowed path prefixes.
     * @param {string} _args.inputPath - Input path.
     * @returns {Promise<import("../database/record/attachments/normalize-input.js").AttachmentPathSource>} - Opened path source.
     */
    resolveAttachmentInputPath(_args: {
        allowedPathPrefixes: string[];
        inputPath: string;
    }): Promise<import("../database/record/attachments/normalize-input.js").AttachmentPathSource>;
    /**
     * Runs get configuration.
     * @returns {import("../configuration.js").default} - The configuration.
     */
    getConfiguration(): import("../configuration.js").default;
    /**
     * Runs set process args.
     * @param {string[]} newProcessArgs - New process args.
     * @returns {void} - No return value.
     */
    setProcessArgs(newProcessArgs: string[]): void;
    /**
     * Runs get default log directory.
     * @param {object} _args - Options object.
     * @param {import("../configuration.js").default} _args.configuration - Configuration instance.
     * @returns {string | undefined} - The default log directory.
     */
    getDefaultLogDirectory(_args: {
        configuration: import("../configuration.js").default;
    }): string | undefined;
    /**
     * Runs get log file path.
     * @param {object} _args - Options object.
     * @param {import("../configuration.js").default} _args.configuration - Configuration instance.
     * @param {string | undefined} _args.directory - Directory path.
     * @param {string} _args.environment - Environment.
     * @returns {string | undefined} - The log file path.
     */
    getLogFilePath(_args: {
        configuration: import("../configuration.js").default;
        directory: string | undefined;
        environment: string;
    }): string | undefined;
    /**
     * Runs write log to file.
     * @param {object} _args - Options object.
     * @param {string} _args.filePath - File path.
     * @param {string} _args.message - Message text.
     * @returns {Promise<void>} - Resolves when complete.
     */
    writeLogToFile(_args: {
        filePath: string;
        message: string;
    }): Promise<void>;
    /**
     * Registers frontend-model websocket channel publishers so lifecycle
     * event hooks (create/update/destroy) broadcast over the shared
     * "frontend-models" channel. The base handler is a no-op — only the
     * Node handler performs the registration because the required
     * `frontend-model-controller` and `routes/resolver` imports pull in
     * server-only modules that break browser bundlers.
     * @param {import("../configuration.js").default} _configuration - Configuration instance.
     * @returns {Promise<void>} - Resolves when complete.
     */
    initializeFrontendModelWebsocketPublishers(_configuration: import("../configuration.js").default): Promise<void>;
    /**
     * Loads models contributed by registered packages.
     * @param {import("../configuration.js").default} _configuration - Configuration instance.
     * @returns {Promise<void>} - Resolves when complete.
     */
    initializePackageModels(_configuration: import("../configuration.js").default): Promise<void>;
}
//# sourceMappingURL=base.d.ts.map