// @ts-check
import BackgroundJobsAdapterClient from "../background-jobs/adapter-client.js";
import { validateTimeZone } from "../time-zone.js";
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
export class TestDatabaseAccessRevokedError extends Error {
}
export default class VelociousEnvironmentHandlerBase {
    /**
     * Resolves the configured database pool type for the current runtime context.
     * Browser and ordinary server contexts retain the application configuration.
     * @param {{configuredPoolType: typeof import("../database/pool/base.js").default, databaseIdentifier: string}} args - Configured pool and logical database identifier.
     * @returns {typeof import("../database/pool/base.js").default} - Pool type for this context.
     */
    resolveTestSharedTransactionPoolType({ configuredPoolType }) { return configuredPoolType; }
    /**
     * Node test runtimes may replace a physical child connection with a broker
     * proxy. Other environments never participate in this test-only protocol.
     * @param {{DriverClass: typeof import("../database/drivers/base.js").default, config: import("../configuration-types.js").DatabaseConfigurationType, configuration: import("../configuration.js").default, databaseIdentifier: string, reuseKey?: string}} _args - Connection details.
     * @returns {Promise<import("../database/drivers/base.js").default | undefined>} - Optional proxy.
     */
    async createTestSharedTransactionConnection(_args) { return undefined; }
    /**
     * Gets the active shared-transaction coordinator owner for a connection.
     * @param {object} connection - Parent physical connection.
     * @returns {symbol | undefined} - Active coordinator owner.
     */
    getSharedTransactionCoordinatorOwner(connection) {
        return this._sharedTransactionCoordinatorOwnerStorage?.getStore()?.get(connection);
    }
    /**
     * Runs work as the current shared-transaction coordinator owner.
     * @template T
     * @param {object} connection - Parent physical connection.
     * @param {symbol} owner - Coordinator owner.
     * @param {() => T} callback - Owned work.
     * @returns {T} - Callback result.
     */
    runWithSharedTransactionCoordinatorOwner(connection, owner, callback) {
        const storage = this._sharedTransactionCoordinatorOwnerStorage;
        if (!storage)
            return callback();
        const owners = new Map(storage.getStore());
        owners.set(connection, owner);
        return storage.run(owners, callback);
    }
    /**
     * Runs work without inherited shared-transaction ownership for one connection.
     * @template T
     * @param {import("../database/drivers/base.js").default} connection - Physical connection whose owner is cleared.
     * @param {() => T} callback - Physical connection work.
     * @returns {T} - Callback result.
     */
    runWithoutSharedTransactionCoordinatorOwner(connection, callback) {
        const storage = this._sharedTransactionCoordinatorOwnerStorage;
        if (!storage)
            return callback();
        const owners = new Map(storage.getStore());
        owners.delete(connection);
        return storage.run(owners, callback);
    }
    /**
     * Runs work without inherited shared-transaction coordinator ownership.
     * @template T
     * @param {() => T} callback - Detached work.
     * @returns {T} - Callback result.
     */
    runWithoutSharedTransactionCoordinatorOwners(callback) {
        const storage = this._sharedTransactionCoordinatorOwnerStorage;
        if (!storage)
            return callback();
        return storage.run(new Map(), callback);
    }
    /**
     * Installs async-context storage when this handler is driven by the Node test runner.
     * @param {import("node:async_hooks").AsyncLocalStorage<Map<object, symbol>>} storage - Coordinator owner storage.
     */
    installSharedTransactionCoordinatorOwnerStorage(storage) {
        this._sharedTransactionCoordinatorOwnerStorage ??= storage;
    }
    /** @type {import("node:async_hooks").AsyncLocalStorage<Map<object, symbol>> | undefined} */
    _sharedTransactionCoordinatorOwnerStorage = undefined;
    /**
     * Runs work with test-profile attribution. Runtimes without async-context
     * storage execute the callback without installing ambient attribution.
     * @template T
     * @param {import("../testing/test-profiler.js").TestProfileAsyncContext | undefined} _context - Captured profile context, or an explicit absence of attribution.
     * @param {() => T} callback - Profiled work.
     * @returns {T} - Callback result.
     */
    runWithTestProfileContext(_context, callback) { return callback(); }
    /**
     * Gets the current test-profile attribution context.
     * @returns {import("../testing/test-profiler.js").TestProfileAsyncContext | undefined} - Active context.
     */
    getCurrentTestProfileContext() { return undefined; }
    /**
     * Runs work in a revocable test database-access scope.
     * @template T
     * @param {{revoked: boolean}} scope - Attempt-owned access scope.
     * @param {() => T | Promise<T>} callback - Attempt work.
     * @returns {Promise<T>} - Callback result.
     */
    async runWithTestDatabaseAccessScope(scope, callback) {
        return await this.runWithCapturedTestDatabaseAccessScope(scope, callback);
    }
    /**
     * Runs work with an explicitly captured test database-access scope.
     * @template T
     * @param {{revoked: boolean} | undefined} scope - Captured access scope.
     * @param {() => T | Promise<T>} callback - Work to run.
     * @returns {Promise<T>} - Callback result.
     */
    async runWithCapturedTestDatabaseAccessScope(scope, callback) {
        if (this._testDatabaseAccessScopeStorage) {
            return await this._testDatabaseAccessScopeStorage.run(scope, callback);
        }
        const entry = { owner: Symbol("test-database-access-scope"), scope };
        this._testDatabaseAccessScopes.push(entry);
        try {
            return await callback();
        }
        finally {
            const index = this._testDatabaseAccessScopes.findIndex((candidate) => candidate.owner === entry.owner);
            if (index !== -1)
                this._testDatabaseAccessScopes.splice(index, 1);
        }
    }
    /**
     * Gets the current test database-access scope.
     * @returns {{revoked: boolean} | undefined} - Current scope.
     */
    currentTestDatabaseAccessScope() {
        if (this._testDatabaseAccessScopeStorage)
            return this._testDatabaseAccessScopeStorage.getStore();
        return this._testDatabaseAccessScopes[this._testDatabaseAccessScopes.length - 1]?.scope;
    }
    /** Throws when the current test attempt no longer owns database access. */
    assertTestDatabaseAccessAllowed() {
        const scope = this.currentTestDatabaseAccessScope();
        if (scope?.revoked) {
            throw new TestDatabaseAccessRevokedError("Database access is no longer allowed for this test attempt");
        }
    }
    /**
     * Installs async-context storage owned by the first Node test runner.
     * @param {TestDatabaseAccessScopeStorage} storage - Scope storage.
     */
    installTestDatabaseAccessScopeStorage(storage) {
        this._testDatabaseAccessScopeStorage ??= storage;
    }
    /** @type {Array<{owner: symbol, scope: {revoked: boolean} | undefined}>} */
    _testDatabaseAccessScopes = [];
    /** @type {TestDatabaseAccessScopeStorage | undefined} */
    _testDatabaseAccessScopeStorage = undefined;
    /**
     * Mutable ambient tenant used by runtimes without async-context storage.
     * @type {ReturnType<typeof JSON.parse> | undefined}
     */
    _currentTenant = undefined;
    /**
     * Active ambient scopes in start order. This prevents a scope that completes
     * out of order from restoring a tenant belonging to an already-completed scope.
     * Ambient reads are still shared in browser runtimes; immutable handles remain
     * the concurrency-safe database API.
     * @type {Array<{owner: symbol, tenant: ReturnType<typeof JSON.parse>}>}
     */
    _tenantScopes = [];
    /**
     * Runs debug endpoint token matches.
     * @param {string} providedToken - Token from the request.
     * @param {string} expectedToken - Configured token.
     * @returns {boolean} - Whether both tokens match.
     */
    debugEndpointTokenMatches(providedToken, expectedToken) {
        let difference = providedToken.length ^ expectedToken.length;
        const maxLength = Math.max(providedToken.length, expectedToken.length);
        for (let index = 0; index < maxLength; index++) {
            difference |= (providedToken.charCodeAt(index) || 0) ^ (expectedToken.charCodeAt(index) || 0);
        }
        return difference === 0;
    }
    /**
     * Runs get framework source directory.
     * @returns {string | undefined} - Velocious source directory used to filter framework stack frames.
     */
    getFrameworkSourceDirectory() {
        return undefined;
    }
    /**
     * Auto-discovers resource classes. No-op in base handler; overridden in Node handler.
     * @param {import("../configuration.js").default} _configuration - Configuration instance.
     * @returns {Promise<void>}
     */
    async autoDiscoverResources(_configuration) { }
    /**
     * Runs run with timezone offset.
     * @param {number} _offsetMinutes - Offset in minutes (Date#getTimezoneOffset).
     * @param {() => Promise<ReturnType<typeof JSON.parse>>} callback - Callback to run.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Result of the callback.
     */
    async runWithTimezoneOffset(_offsetMinutes, callback) {
        if (!this.configuration)
            throw new Error("Configuration hasn't been set");
        const previousOffsetMinutes = this.configuration._timezoneOffsetMinutes;
        this.configuration._timezoneOffsetMinutes = _offsetMinutes;
        try {
            return await callback();
        }
        finally {
            this.configuration._timezoneOffsetMinutes = previousOffsetMinutes;
        }
    }
    /**
     * Runs run with timezone.
     * @param {string} timeZone - IANA timezone identifier.
     * @param {() => Promise<ReturnType<typeof JSON.parse>>} callback - Callback to run.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Result of the callback.
     */
    async runWithTimezone(timeZone, callback) {
        if (!this.configuration)
            throw new Error("Configuration hasn't been set");
        const previousTimeZone = this.configuration._timeZone;
        this.configuration._timeZone = validateTimeZone(timeZone, "timeZone");
        try {
            return await callback();
        }
        finally {
            this.configuration._timeZone = previousTimeZone;
        }
    }
    /**
     * Runs set timezone offset.
     * @param {number} _offsetMinutes - Offset in minutes (Date#getTimezoneOffset).
     * @returns {void} - No return value.
     */
    setTimezoneOffset(_offsetMinutes) {
        if (!this.configuration)
            throw new Error("Configuration hasn't been set");
        /**
         * Narrows the runtime value to the documented type.
         * @type {number} */
        this.configuration._timezoneOffsetMinutes = _offsetMinutes;
    }
    /**
     * Runs set timezone.
     * @param {string} timeZone - IANA timezone identifier.
     * @returns {void} - No return value.
     */
    setTimezone(timeZone) {
        if (!this.configuration)
            throw new Error("Configuration hasn't been set");
        this.configuration._timeZone = validateTimeZone(timeZone, "timeZone");
    }
    /**
     * Runs get timezone offset minutes.
     * @param {import("../configuration.js").default | undefined} configuration - Configuration instance.
     * @returns {number} - Offset in minutes.
     */
    getTimezoneOffsetMinutes(configuration) {
        const activeConfiguration = configuration || this.configuration;
        if (!activeConfiguration)
            throw new Error("Configuration hasn't been set");
        if (typeof activeConfiguration._timezoneOffsetMinutes === "number") {
            return activeConfiguration._timezoneOffsetMinutes;
        }
        return /** @type {number} */ (activeConfiguration.getTimezoneOffsetMinutes());
    }
    /**
     * Runs get timezone.
     * @param {import("../configuration.js").default | undefined} configuration - Configuration instance.
     * @returns {string | undefined} - Timezone identifier.
     */
    getTimeZone(configuration) {
        const activeConfiguration = configuration || this.configuration;
        if (!activeConfiguration)
            throw new Error("Configuration hasn't been set");
        return activeConfiguration.getTimeZone();
    }
    /**
     * Runs run with request timing.
     * @param {import("../http-server/client/request-timing.js").default | undefined} requestTiming - Request timing collector.
     * @param {() => Promise<ReturnType<typeof JSON.parse>>} callback - Callback.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Callback result.
     */
    async runWithRequestTiming(requestTiming, callback) {
        this._currentRequestTiming = requestTiming;
        try {
            return await callback();
        }
        finally {
            this._currentRequestTiming = undefined;
        }
    }
    /**
     * Runs get current request timing.
     * @returns {import("../http-server/client/request-timing.js").default | undefined} - Current request timing collector.
     */
    getCurrentRequestTiming() {
        return this._currentRequestTiming;
    }
    /**
     * Runs run with ability.
     * @param {import("../authorization/ability.js").default | undefined} ability - Ability to set for callback scope.
     * @param {() => Promise<ReturnType<typeof JSON.parse>>} callback - Callback.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Callback result.
     */
    async runWithAbility(ability, callback) {
        this._currentAbility = ability;
        try {
            return await callback();
        }
        finally {
            this._currentAbility = undefined;
        }
    }
    /**
     * Runs set current ability.
     * @param {import("../authorization/ability.js").default | undefined} ability - Ability to set.
     * @returns {void} - No return value.
     */
    setCurrentAbility(ability) {
        this._currentAbility = ability;
    }
    /**
     * Runs get current ability.
     * @returns {import("../authorization/ability.js").default | undefined} - Current ability.
     */
    getCurrentAbility() {
        return this._currentAbility;
    }
    /**
     * Runs run with tenant.
     * @param {ReturnType<typeof JSON.parse>} tenant - Tenant to set for callback scope.
     * @param {() => Promise<ReturnType<typeof JSON.parse>>} callback - Callback.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Callback result.
     */
    async runWithTenant(tenant, callback) {
        const scope = { owner: Symbol("browser-tenant-scope"), tenant };
        this._tenantScopes.push(scope);
        try {
            return await callback();
        }
        finally {
            const scopeIndex = this._tenantScopes.findIndex((candidate) => candidate.owner === scope.owner);
            if (scopeIndex !== -1)
                this._tenantScopes.splice(scopeIndex, 1);
        }
    }
    /**
     * Runs set current tenant.
     * @param {ReturnType<typeof JSON.parse>} tenant - Tenant to set.
     * @returns {void} - No return value.
     */
    setCurrentTenant(tenant) {
        this._currentTenant = tenant;
    }
    /**
     * Runs get current tenant.
     * @returns {ReturnType<typeof JSON.parse>} - Current tenant.
     */
    getCurrentTenant() {
        return this._tenantScopes[this._tenantScopes.length - 1]?.tenant ?? this._currentTenant;
    }
    /**
     * Runs cli commands generate base models.
     * @param {import("../cli/base-command.js").default} _command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    async cliCommandsGenerateBaseModels(_command) {
        throw new Error("cliCommandsGenerateBaseModels not implemented");
    }
    /**
     * Runs cli commands generate frontend models.
     * @param {import("../cli/base-command.js").default} _command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    async cliCommandsGenerateFrontendModels(_command) {
        throw new Error("cliCommandsGenerateFrontendModels not implemented");
    }
    /**
     * Runs cli commands init.
     * @param {import("../cli/base-command.js").default} command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    async cliCommandsInit(command) {
        throw new Error("cliCommandsInit not implemented");
    }
    /**
     * Runs cli commands migration generate.
     * @param {import("../cli/base-command.js").default} _command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    async cliCommandsMigrationGenerate(_command) {
        throw new Error("cliCommandsMigrationGenerate not implemented");
    }
    /**
     * Runs cli commands migration destroy.
     * @param {import("../cli/base-command.js").default} _command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    async cliCommandsMigrationDestroy(_command) {
        throw new Error("cliCommandsMigrationDestroy not implemented");
    }
    /**
     * Runs cli commands generate model.
     * @param {import("../cli/base-command.js").default} _command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    async cliCommandsGenerateModel(_command) {
        throw new Error("cliCommandsGenerateModel not implemented");
    }
    /**
     * Runs cli commands lint relationships.
     * @abstract
     * @param {import("../cli/base-command.js").default} _command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    async cliCommandsLintRelationships(_command) {
        throw new Error("cliCommandsLintRelationships not implemented");
    }
    /**
     * Runs cli commands routes.
     * @abstract
     * @param {import("../cli/base-command.js").default} _command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    async cliCommandsRoutes(_command) {
        throw new Error("cliCommandsRoutes not implemented");
    }
    /**
     * Runs cli commands console.
     * @param {import("../cli/base-command.js").default} _command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    async cliCommandsConsole(_command) {
        throw new Error("cliCommandsConsole not implemented");
    }
    /**
     * Runs cli commands server.
     * @param {import("../cli/base-command.js").default} _command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    async cliCommandsServer(_command) {
        throw new Error("cliCommandsServer not implemented");
    }
    /**
     * Runs cli commands test.
     * @param {import("../cli/base-command.js").default} _command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    async cliCommandsTest(_command) {
        throw new Error("cliCommandsTest not implemented");
    }
    /**
     * Runs cli commands test timing manifest merge.
     * @param {import("../cli/base-command.js").default} _command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    async cliCommandsTestTimingManifestMerge(_command) {
        throw new Error("cliCommandsTestTimingManifestMerge not implemented");
    }
    /**
     * Runs cli commands background jobs main.
     * @param {import("../cli/base-command.js").default} _command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    async cliCommandsBackgroundJobsMain(_command) {
        throw new Error("cliCommandsBackgroundJobsMain not implemented");
    }
    /**
     * Runs CLI background-jobs activation.
     * @param {import("../cli/base-command.js").default} _command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Result.
     */
    async cliCommandsBackgroundJobsActivate(_command) {
        throw new Error("cliCommandsBackgroundJobsActivate not implemented");
    }
    /**
     * Runs CLI background-jobs retirement.
     * @param {import("../cli/base-command.js").default} _command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Result.
     */
    async cliCommandsBackgroundJobsRetire(_command) {
        throw new Error("cliCommandsBackgroundJobsRetire not implemented");
    }
    /**
     * Runs cli commands background jobs worker.
     * @param {import("../cli/base-command.js").default} _command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    async cliCommandsBackgroundJobsWorker(_command) {
        throw new Error("cliCommandsBackgroundJobsWorker not implemented");
    }
    /**
     * Runs cli commands background jobs runner.
     * @param {import("../cli/base-command.js").default} _command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    async cliCommandsBackgroundJobsRunner(_command) {
        throw new Error("cliCommandsBackgroundJobsRunner not implemented");
    }
    /**
     * Runs cli commands beacon.
     * @param {import("../cli/base-command.js").default} _command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    async cliCommandsBeacon(_command) {
        throw new Error("cliCommandsBeacon not implemented");
    }
    /**
     * Loads the TCP-backed Beacon client class. Routed through the
     * environment handler so the dynamic `import("../beacon/client.js")`
     * call lives on the Node-only path — keeps Beacon's `node:net` /
     * `node:crypto` deps out of browser bundles that statically reach
     * `Configuration` (and therefore previously reached the dynamic
     * imports).
     * @returns {Promise<typeof import("../beacon/client.js").default>} - Beacon client class.
     */
    async loadBeaconClient() {
        throw new Error("loadBeaconClient not implemented by this environment handler");
    }
    /**
     * Loads the in-process Beacon client class. Same indirection rationale
     * as `loadBeaconClient`.
     * @returns {Promise<typeof import("../beacon/in-process-client.js").default>} - In-process client class.
     */
    async loadInProcessBeaconClient() {
        throw new Error("loadInProcessBeaconClient not implemented by this environment handler");
    }
    /**
     * Runs cli commands db schema dump.
     * @param {import("../cli/base-command.js").default} _command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    async cliCommandsDbSchemaDump(_command) {
        throw new Error("cliCommandsDbSchemaDump not implemented");
    }
    /**
     * Runs cli commands db schema load.
     * @param {import("../cli/base-command.js").default} _command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    async cliCommandsDbSchemaLoad(_command) {
        throw new Error("cliCommandsDbSchemaLoad not implemented");
    }
    /**
     * Runs cli commands db seed.
     * @param {import("../cli/base-command.js").default} _command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    async cliCommandsDbSeed(_command) {
        throw new Error("cliCommandsDbSeed not implemented");
    }
    /**
     * Runs cli commands runner.
     * @param {import("../cli/base-command.js").default} _command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    async cliCommandsRunner(_command) {
        throw new Error("cliCommandsRunner not implemented");
    }
    /**
     * Runs cli commands run script.
     * @param {import("../cli/base-command.js").default} _command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    async cliCommandsRunScript(_command) {
        throw new Error("cliCommandsRunScript not implemented");
    }
    /**
     * Runs find commands.
     * @abstract
     * @returns {Promise<CommandFileObjectType[]>} - Resolves with the commands.
     */
    async findCommands() { throw new Error("findCommands not implemented"); }
    /**
     * Runs find migrations.
     * @abstract
     * @returns {Promise<Array<MigrationObjectType>>} - Resolves with the migrations.
     */
    async findMigrations() { throw new Error("findMigrations not implemneted"); }
    /**
     * Runs forward command.
     * @param {import("../cli/base-command.js").default} command - Command.
     * @param {typeof import("../cli/base-command.js").default} CommandClass - Command class.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    async forwardCommand(command, CommandClass) {
        const newCommand = new CommandClass({
            args: command.args,
            cli: command.cli
        });
        return await newCommand.execute();
    }
    /**
     * Runs get velocious path.
     * @abstract
     * @returns {Promise<string>} - Resolves with the velocious path.
     */
    getVelociousPath() { throw new Error("getVelociousPath not implemented"); }
    /**
     * Runs import application routes.
     * @abstract
     * @returns {Promise<import("../routes/index.js").default>} - Resolves with the import application routes.
     */
    async importApplicationRoutes() { throw new Error("importApplicationRoutes not implemented"); }
    /**
     * Runs import test files.
     * @abstract
     * @param {string[]} _testFiles - Test files.
     * @returns {Promise<void>} - Resolves when complete.
     */
    importTestFiles(_testFiles) { throw new Error("'importTestFiles' not implemented"); }
    /**
     * Runs import testing config path.
     * @abstract
     * @returns {Promise<void>} - Resolves when complete.
     */
    importTestingConfigPath() { throw new Error(`'importTestingConfigPath' not implemented`); }
    /**
     * Runs after migrations.
     * @param {object} args - Options object.
     * @param {Record<string, import("../database/drivers/base.js").default>} args.dbs - Dbs.
     * @param {"migration" | "schemaDump"} [args.reason] - Why the structure write hook is being invoked.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async afterMigrations(args) {
        return;
    }
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
    async ensureFrameworkSchema(args) {
        return;
    }
    /**
     * Creates the environment's default persistence adapter.
     * @abstract
     * @param {{configuration: import("../configuration.js").default}} _args - Adapter options.
     * @returns {import("../background-jobs/adapter.js").default} - Default adapter.
     */
    createBackgroundJobsAdapter(_args) {
        throw new Error("This environment requires an explicit backgroundJobs.adapter");
    }
    /**
     * Creates the platform-neutral producer path for an explicit adapter.
     * @param {{configuration: import("../configuration.js").default}} args - Client options.
     * @returns {import("../background-jobs/types.js").BackgroundJobsProducer} - Adapter-backed producer.
     */
    backgroundJobsClient(args) {
        return new BackgroundJobsAdapterClient(args);
    }
    /**
     * Runs require command.
     * @abstract
     * @param {object} args - Options object.
     * @param {string[]} args.commandParts - Command parts.
     * @returns {Promise<typeof import ("../cli/base-command.js").default>} - Resolves with the require command.
     */
    async requireCommand({ commandParts }) { throw new Error("'requireCommand' not implemented"); } // eslint-disable-line no-unused-vars
    /**
     * Runs set args.
     * @param {object} newArgs - New args.
     * @returns {void} - No return value.
     */
    setArgs(newArgs) { this.args = newArgs; }
    /**
     * Runs set configuration.
     * @param {import("../configuration.js").default} newConfiguration - New configuration.
     * @returns {void} - No return value.
     */
    setConfiguration(newConfiguration) { this.configuration = newConfiguration; }
    /**
     * Runs read attachment input file.
     * @param {string} _filePath - File path.
     * @returns {Promise<Buffer>} - File bytes.
     */
    async readAttachmentInputFile(_filePath) {
        throw new Error("Attachment file reads are not supported in this environment");
    }
    /**
     * Runs resolve attachment input path.
     * @param {object} _args - Args.
     * @param {string[]} _args.allowedPathPrefixes - Allowed path prefixes.
     * @param {string} _args.inputPath - Input path.
     * @returns {Promise<import("../database/record/attachments/normalize-input.js").AttachmentPathSource>} - Opened path source.
     */
    async resolveAttachmentInputPath(_args) {
        throw new Error("Attachment path input is not supported in this environment");
    }
    /**
     * Runs get configuration.
     * @returns {import("../configuration.js").default} - The configuration.
     */
    getConfiguration() {
        if (!this.configuration)
            throw new Error("Configuration hasn't been set");
        return this.configuration;
    }
    /**
     * Runs set process args.
     * @param {string[]} newProcessArgs - New process args.
     * @returns {void} - No return value.
     */
    setProcessArgs(newProcessArgs) { this.processArgs = newProcessArgs; }
    /**
     * Runs get default log directory.
     * @param {object} _args - Options object.
     * @param {import("../configuration.js").default} _args.configuration - Configuration instance.
     * @returns {string | undefined} - The default log directory.
     */
    getDefaultLogDirectory(_args) {
        return undefined;
    }
    /**
     * Runs get log file path.
     * @param {object} _args - Options object.
     * @param {import("../configuration.js").default} _args.configuration - Configuration instance.
     * @param {string | undefined} _args.directory - Directory path.
     * @param {string} _args.environment - Environment.
     * @returns {string | undefined} - The log file path.
     */
    getLogFilePath(_args) {
        return undefined;
    }
    /**
     * Runs write log to file.
     * @param {object} _args - Options object.
     * @param {string} _args.filePath - File path.
     * @param {string} _args.message - Message text.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async writeLogToFile(_args) {
        return;
    }
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
    async initializeFrontendModelWebsocketPublishers(_configuration) {
        // No-op in base handler; Node handler does the real registration.
    }
    /**
     * Loads models contributed by registered packages.
     * @param {import("../configuration.js").default} _configuration - Configuration instance.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async initializePackageModels(_configuration) {
        // No-op in base handler; Node handler loads package models from the filesystem.
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9lbnZpcm9ubWVudC1oYW5kbGVycy9iYXNlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLDJCQUEyQixNQUFNLHNDQUFzQyxDQUFBO0FBQzlFLE9BQU8sRUFBRSxnQkFBZ0IsRUFBRSxNQUFNLGlCQUFpQixDQUFBO0FBRWxEOzs7OztHQUtHO0FBRUg7Ozs7Ozs7R0FPRztBQUNIOzs7OztHQUtHO0FBRUgsTUFBTSxPQUFPLDhCQUErQixTQUFRLEtBQUs7Q0FBRztBQUU1RCxNQUFNLENBQUMsT0FBTyxPQUFPLCtCQUErQjtJQUNsRDs7Ozs7T0FLRztJQUNILG9DQUFvQyxDQUFDLEVBQUMsa0JBQWtCLEVBQUMsSUFBSSxPQUFPLGtCQUFrQixDQUFBLENBQUMsQ0FBQztJQUV4Rjs7Ozs7T0FLRztJQUNILEtBQUssQ0FBQyxxQ0FBcUMsQ0FBQyxLQUFLLElBQUksT0FBTyxTQUFTLENBQUEsQ0FBQyxDQUFDO0lBRXZFOzs7O09BSUc7SUFDSCxvQ0FBb0MsQ0FBQyxVQUFVO1FBQzdDLE9BQU8sSUFBSSxDQUFDLHlDQUF5QyxFQUFFLFFBQVEsRUFBRSxFQUFFLEdBQUcsQ0FBQyxVQUFVLENBQUMsQ0FBQTtJQUNwRixDQUFDO0lBRUQ7Ozs7Ozs7T0FPRztJQUNILHdDQUF3QyxDQUFDLFVBQVUsRUFBRSxLQUFLLEVBQUUsUUFBUTtRQUNsRSxNQUFNLE9BQU8sR0FBRyxJQUFJLENBQUMseUNBQXlDLENBQUE7UUFFOUQsSUFBSSxDQUFDLE9BQU87WUFBRSxPQUFPLFFBQVEsRUFBRSxDQUFBO1FBRS9CLE1BQU0sTUFBTSxHQUFHLElBQUksR0FBRyxDQUFDLE9BQU8sQ0FBQyxRQUFRLEVBQUUsQ0FBQyxDQUFBO1FBRTFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsVUFBVSxFQUFFLEtBQUssQ0FBQyxDQUFBO1FBQzdCLE9BQU8sT0FBTyxDQUFDLEdBQUcsQ0FB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SSxJQUFJLENBQUMsV0FBVyxHQUFHLGNBQWMsQ0FBQSxDQUFDLENBQUM7SUFFcEU7Ozs7O09BS0c7SUFDSCxzQkFBc0IsQ0FBQyxLQUFLO1FBQzFCLE9BQU8sU0FBUyxDQUFBO0lBQ2xCLENBQUM7SUFFRDs7Ozs7OztPQU9HO0lBQ0gsY0FBYyxDQUFDLEtBQUs7UUFDbEIsT0FBTyxTQUFTLENBQUE7SUFDbEIsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILEtBQUssQ0FBQyxjQUFjLENBQUMsS0FBSztRQUN4QixPQUFNO0lBQ1IsQ0FBQztJQUVEOzs7Ozs7Ozs7T0FTRztJQUNILEtBQUssQ0FBQywwQ0FBMEMsQ0FBQyxjQUFjO1FBQzdELGtFQUFrRTtJQUNwRSxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyx1QkFBdUIsQ0FBQyxjQUFjO1FBQzFDLGdGQUFnRjtJQUNsRixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IEJhY2tncm91bmRKb2JzQWRhcHRlckNsaWVudCBmcm9tIFwiLi4vYmFja2dyb3VuZC1qb2JzL2FkYXB0ZXItY2xpZW50LmpzXCJcbmltcG9ydCB7IHZhbGlkYXRlVGltZVpvbmUgfSBmcm9tIFwiLi4vdGltZS16b25lLmpzXCJcblxuLyoqXG4gKiBDb21tYW5kRmlsZU9iamVjdFR5cGUgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IENvbW1hbmRGaWxlT2JqZWN0VHlwZVxuICogQHByb3BlcnR5IHtzdHJpbmd9IG5hbWUgLSBDb21tYW5kIG5hbWUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gZmlsZSAtIENvbW1hbmQgZmlsZSBwYXRoLlxuICovXG5cbi8qKlxuICogTWlncmF0aW9uT2JqZWN0VHlwZSB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gTWlncmF0aW9uT2JqZWN0VHlwZVxuICogQHByb3BlcnR5IHtudW1iZXJ9IGRhdGUgLSBNaWdyYXRpb24gdGltZXN0YW1wIHBhcnNlZCBmcm9tIGZpbGVuYW1lLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtmdWxsUGF0aF0gLSBBYnNvbHV0ZSBwYXRoIHRvIHRoZSBtaWdyYXRpb24gZmlsZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBtaWdyYXRpb25DbGFzc05hbWUgLSBFeHBvcnRlZCBtaWdyYXRpb24gY2xhc3MgbmFtZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBmaWxlIC0gTWlncmF0aW9uIGZpbGVuYW1lLlxuICovXG4vKipcbiAqIFRlc3REYXRhYmFzZUFjY2Vzc1Njb3BlU3RvcmFnZSB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gVGVzdERhdGFiYXNlQWNjZXNzU2NvcGVTdG9yYWdlXG4gKiBAcHJvcGVydHkgeygpID0+ICh7cmV2b2tlZDogYm9vbGVhbn0gfCB1bmRlZmluZWQpfSBnZXRTdG9yZSAtIEdldHMgdGhlIGluaGVyaXRlZCBzY29wZS5cbiAqIEBwcm9wZXJ0eSB7KHNjb3BlOiB7cmV2b2tlZDogYm9vbGVhbn0gfCB1bmRlZmluZWQsIGNhbGxiYWNrOiAoKSA9PiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPikgPT4gUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHJ1biAtIFJ1bnMgaW4gdGhlIHNjb3BlLlxuICovXG5cbmV4cG9ydCBjbGFzcyBUZXN0RGF0YWJhc2VBY2Nlc3NSZXZva2VkRXJyb3IgZXh0ZW5kcyBFcnJvciB7fVxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNFbnZpcm9ubWVudEhhbmRsZXJCYXNlIHtcbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBjb25maWd1cmVkIGRhdGFiYXNlIHBvb2wgdHlwZSBmb3IgdGhlIGN1cnJlbnQgcnVudGltZSBjb250ZXh0LlxuICAgKiBCcm93c2VyIGFuZCBvcmRpbmFyeSBzZXJ2ZXIgY29udGV4dHMgcmV0YWluIHRoZSBhcHBsaWNhdGlvbiBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge3tjb25maWd1cmVkUG9vbFR5cGU6IHR5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9wb29sL2Jhc2UuanNcIikuZGVmYXVsdCwgZGF0YWJhc2VJZGVudGlmaWVyOiBzdHJpbmd9fSBhcmdzIC0gQ29uZmlndXJlZCBwb29sIGFuZCBsb2dpY2FsIGRhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqIEByZXR1cm5zIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcG9vbC9iYXNlLmpzXCIpLmRlZmF1bHR9IC0gUG9vbCB0eXBlIGZvciB0aGlzIGNvbnRleHQuXG4gICAqL1xuICByZXNvbHZlVGVzdFNoYXJlZFRyYW5zYWN0aW9uUG9vbFR5cGUoe2NvbmZpZ3VyZWRQb29sVHlwZX0pIHsgcmV0dXJuIGNvbmZpZ3VyZWRQb29sVHlwZSB9XG5cbiAgLyoqXG4gICAqIE5vZGUgdGVzdCBydW50aW1lcyBtYXkgcmVwbGFjZSBhIHBoeXNpY2FsIGNoaWxkIGNvbm5lY3Rpb24gd2l0aCBhIGJyb2tlclxuICAgKiBwcm94eS4gT3RoZXIgZW52aXJvbm1lbnRzIG5ldmVyIHBhcnRpY2lwYXRlIGluIHRoaXMgdGVzdC1vbmx5IHByb3RvY29sLlxuICAgKiBAcGFyYW0ge3tEcml2ZXJDbGFzczogdHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0LCBjb25maWc6IGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRGF0YWJhc2VDb25maWd1cmF0aW9uVHlwZSwgY29uZmlndXJhdGlvbjogaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0LCBkYXRhYmFzZUlkZW50aWZpZXI6IHN0cmluZywgcmV1c2VLZXk/OiBzdHJpbmd9fSBfYXJncyAtIENvbm5lY3Rpb24gZGV0YWlscy5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWQ+fSAtIE9wdGlvbmFsIHByb3h5LlxuICAgKi9cbiAgYXN5bmMgY3JlYXRlVGVzdFNoYXJlZFRyYW5zYWN0aW9uQ29ubmVjdGlvbihfYXJncykgeyByZXR1cm4gdW5kZWZpbmVkIH1cblxuICAvKipcbiAgICogR2V0cyB0aGUgYWN0aXZlIHNoYXJlZC10cmFuc2FjdGlvbiBjb29yZGluYXRvciBvd25lciBmb3IgYSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gY29ubmVjdGlvbiAtIFBhcmVudCBwaHlzaWNhbCBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7c3ltYm9sIHwgdW5kZWZpbmVkfSAtIEFjdGl2ZSBjb29yZGluYXRvciBvd25lci5cbiAgICovXG4gIGdldFNoYXJlZFRyYW5zYWN0aW9uQ29vcmRpbmF0b3JPd25lcihjb25uZWN0aW9uKSB7XG4gICAgcmV0dXJuIHRoaXMuX3NoYXJlZFRyYW5zYWN0aW9uQ29vcmRpbmF0b3JPd25lclN0b3JhZ2U/LmdldFN0b3JlKCk/LmdldChjb25uZWN0aW9uKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd29yayBhcyB0aGUgY3VycmVudCBzaGFyZWQtdHJhbnNhY3Rpb24gY29vcmRpbmF0b3Igb3duZXIuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBjb25uZWN0aW9uIC0gUGFyZW50IHBoeXNpY2FsIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7c3ltYm9sfSBvd25lciAtIENvb3JkaW5hdG9yIG93bmVyLlxuICAgKiBAcGFyYW0geygpID0+IFR9IGNhbGxiYWNrIC0gT3duZWQgd29yay5cbiAgICogQHJldHVybnMge1R9IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgcnVuV2l0aFNoYXJlZFRyYW5zYWN0aW9uQ29vcmRpbmF0b3JPd25lcihjb25uZWN0aW9uLCBvd25lciwgY2FsbGJhY2spIHtcbiAgICBjb25zdCBzdG9yYWdlID0gdGhpcy5fc2hhcmVkVHJhbnNhY3Rpb25Db29yZGluYXRvck93bmVyU3RvcmFnZVxuXG4gICAgaWYgKCFzdG9yYWdlKSByZXR1cm4gY2FsbGJhY2soKVxuXG4gICAgY29uc3Qgb3duZXJzID0gbmV3IE1hcChzdG9yYWdlLmdldFN0b3JlKCkpXG5cbiAgICBvd25lcnMuc2V0KGNvbm5lY3Rpb24sIG93bmVyKVxuICAgIHJldHVybiBzdG9yYWdlLnJ1bihvd25lcnMsIGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd29yayB3aXRob3V0IGluaGVyaXRlZCBzaGFyZWQtdHJhbnNhY3Rpb24gb3duZXJzaGlwIGZvciBvbmUgY29ubmVjdGlvbi5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gY29ubmVjdGlvbiAtIFBoeXNpY2FsIGNvbm5lY3Rpb24gd2hvc2Ugb3duZXIgaXMgY2xlYXJlZC5cbiAgICogQHBhcmFtIHsoKSA9PiBUfSBjYWxsYmFjayAtIFBoeXNpY2FsIGNvbm5lY3Rpb24gd29yay5cbiAgICogQHJldHVybnMge1R9IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgcnVuV2l0aG91dFNoYXJlZFRyYW5zYWN0aW9uQ29vcmRpbmF0b3JPd25lcihjb25uZWN0aW9uLCBjYWxsYmFjaykge1xuICAgIGNvbnN0IHN0b3JhZ2UgPSB0aGlzLl9zaGFyZWRUcmFuc2FjdGlvbkNvb3JkaW5hdG9yT3duZXJTdG9yYWdlXG5cbiAgICBpZiAoIXN0b3JhZ2UpIHJldHVybiBjYWxsYmFjaygpXG5cbiAgICBjb25zdCBvd25lcnMgPSBuZXcgTWFwKHN0b3JhZ2UuZ2V0U3RvcmUoKSlcblxuICAgIG93bmVycy5kZWxldGUoY29ubmVjdGlvbilcbiAgICByZXR1cm4gc3RvcmFnZS5ydW4ob3duZXJzLCBjYWxsYmFjaylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdvcmsgd2l0aG91dCBpbmhlcml0ZWQgc2hhcmVkLXRyYW5zYWN0aW9uIGNvb3JkaW5hdG9yIG93bmVyc2hpcC5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHsoKSA9PiBUfSBjYWxsYmFjayAtIERldGFjaGVkIHdvcmsuXG4gICAqIEByZXR1cm5zIHtUfSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIHJ1bldpdGhvdXRTaGFyZWRUcmFuc2FjdGlvbkNvb3JkaW5hdG9yT3duZXJzKGNhbGxiYWNrKSB7XG4gICAgY29uc3Qgc3RvcmFnZSA9IHRoaXMuX3NoYXJlZFRyYW5zYWN0aW9uQ29vcmRpbmF0b3JPd25lclN0b3JhZ2VcblxuICAgIGlmICghc3RvcmFnZSkgcmV0dXJuIGNhbGxiYWNrKClcblxuICAgIHJldHVybiBzdG9yYWdlLnJ1bihuZXcgTWFwKCksIGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIEluc3RhbGxzIGFzeW5jLWNvbnRleHQgc3RvcmFnZSB3aGVuIHRoaXMgaGFuZGxlciBpcyBkcml2ZW4gYnkgdGhlIE5vZGUgdGVzdCBydW5uZXIuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwibm9kZTphc3luY19ob29rc1wiKS5Bc3luY0xvY2FsU3RvcmFnZTxNYXA8b2JqZWN0LCBzeW1ib2w+Pn0gc3RvcmFnZSAtIENvb3JkaW5hdG9yIG93bmVyIHN0b3JhZ2UuXG4gICAqL1xuICBpbnN0YWxsU2hhcmVkVHJhbnNhY3Rpb25Db29yZGluYXRvck93bmVyU3RvcmFnZShzdG9yYWdlKSB7XG4gICAgdGhpcy5fc2hhcmVkVHJhbnNhY3Rpb25Db29yZGluYXRvck93bmVyU3RvcmFnZSA/Pz0gc3RvcmFnZVxuICB9XG5cbiAgLyoqIEB0eXBlIHtpbXBvcnQoXCJub2RlOmFzeW5jX2hvb2tzXCIpLkFzeW5jTG9jYWxTdG9yYWdlPE1hcDxvYmplY3QsIHN5bWJvbD4+IHwgdW5kZWZpbmVkfSAqL1xuICBfc2hhcmVkVHJhbnNhY3Rpb25Db29yZGluYXRvck93bmVyU3RvcmFnZSA9IHVuZGVmaW5lZFxuXG4gIC8qKlxuICAgKiBSdW5zIHdvcmsgd2l0aCB0ZXN0LXByb2ZpbGUgYXR0cmlidXRpb24uIFJ1bnRpbWVzIHdpdGhvdXQgYXN5bmMtY29udGV4dFxuICAgKiBzdG9yYWdlIGV4ZWN1dGUgdGhlIGNhbGxiYWNrIHdpdGhvdXQgaW5zdGFsbGluZyBhbWJpZW50IGF0dHJpYnV0aW9uLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3Rlc3RpbmcvdGVzdC1wcm9maWxlci5qc1wiKS5UZXN0UHJvZmlsZUFzeW5jQ29udGV4dCB8IHVuZGVmaW5lZH0gX2NvbnRleHQgLSBDYXB0dXJlZCBwcm9maWxlIGNvbnRleHQsIG9yIGFuIGV4cGxpY2l0IGFic2VuY2Ugb2YgYXR0cmlidXRpb24uXG4gICAqIEBwYXJhbSB7KCkgPT4gVH0gY2FsbGJhY2sgLSBQcm9maWxlZCB3b3JrLlxuICAgKiBAcmV0dXJucyB7VH0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBydW5XaXRoVGVzdFByb2ZpbGVDb250ZXh0KF9jb250ZXh0LCBjYWxsYmFjaykgeyByZXR1cm4gY2FsbGJhY2soKSB9XG5cbiAgLyoqXG4gICAqIEdldHMgdGhlIGN1cnJlbnQgdGVzdC1wcm9maWxlIGF0dHJpYnV0aW9uIGNvbnRleHQuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi90ZXN0aW5nL3Rlc3QtcHJvZmlsZXIuanNcIikuVGVzdFByb2ZpbGVBc3luY0NvbnRleHQgfCB1bmRlZmluZWR9IC0gQWN0aXZlIGNvbnRleHQuXG4gICAqL1xuICBnZXRDdXJyZW50VGVzdFByb2ZpbGVDb250ZXh0KCkgeyByZXR1cm4gdW5kZWZpbmVkIH1cblxuICAvKipcbiAgICogUnVucyB3b3JrIGluIGEgcmV2b2NhYmxlIHRlc3QgZGF0YWJhc2UtYWNjZXNzIHNjb3BlLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge3tyZXZva2VkOiBib29sZWFufX0gc2NvcGUgLSBBdHRlbXB0LW93bmVkIGFjY2VzcyBzY29wZS5cbiAgICogQHBhcmFtIHsoKSA9PiBUIHwgUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBBdHRlbXB0IHdvcmsuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHJ1bldpdGhUZXN0RGF0YWJhc2VBY2Nlc3NTY29wZShzY29wZSwgY2FsbGJhY2spIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5ydW5XaXRoQ2FwdHVyZWRUZXN0RGF0YWJhc2VBY2Nlc3NTY29wZShzY29wZSwgY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogUnVucyB3b3JrIHdpdGggYW4gZXhwbGljaXRseSBjYXB0dXJlZCB0ZXN0IGRhdGFiYXNlLWFjY2VzcyBzY29wZS5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHt7cmV2b2tlZDogYm9vbGVhbn0gfCB1bmRlZmluZWR9IHNjb3BlIC0gQ2FwdHVyZWQgYWNjZXNzIHNjb3BlLlxuICAgKiBAcGFyYW0geygpID0+IFQgfCBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIFdvcmsgdG8gcnVuLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBydW5XaXRoQ2FwdHVyZWRUZXN0RGF0YWJhc2VBY2Nlc3NTY29wZShzY29wZSwgY2FsbGJhY2spIHtcbiAgICBpZiAodGhpcy5fdGVzdERhdGFiYXNlQWNjZXNzU2NvcGVTdG9yYWdlKSB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5fdGVzdERhdGFiYXNlQWNjZXNzU2NvcGVTdG9yYWdlLnJ1bihzY29wZSwgY2FsbGJhY2spXG4gICAgfVxuXG4gICAgY29uc3QgZW50cnkgPSB7b3duZXI6IFN5bWJvbChcInRlc3QtZGF0YWJhc2UtYWNjZXNzLXNjb3BlXCIpLCBzY29wZX1cblxuICAgIHRoaXMuX3Rlc3REYXRhYmFzZUFjY2Vzc1Njb3Blcy5wdXNoKGVudHJ5KVxuXG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBhd2FpdCBjYWxsYmFjaygpXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGNvbnN0IGluZGV4ID0gdGhpcy5fdGVzdERhdGFiYXNlQWNjZXNzU2NvcGVzLmZpbmRJbmRleCgoY2FuZGlkYXRlKSA9PiBjYW5kaWRhdGUub3duZXIgPT09IGVudHJ5Lm93bmVyKVxuXG4gICAgICBpZiAoaW5kZXggIT09IC0xKSB0aGlzLl90ZXN0RGF0YWJhc2VBY2Nlc3NTY29wZXMuc3BsaWNlKGluZGV4LCAxKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBHZXRzIHRoZSBjdXJyZW50IHRlc3QgZGF0YWJhc2UtYWNjZXNzIHNjb3BlLlxuICAgKiBAcmV0dXJucyB7e3Jldm9rZWQ6IGJvb2xlYW59IHwgdW5kZWZpbmVkfSAtIEN1cnJlbnQgc2NvcGUuXG4gICAqL1xuICBjdXJyZW50VGVzdERhdGFiYXNlQWNjZXNzU2NvcGUoKSB7XG4gICAgaWYgKHRoaXMuX3Rlc3REYXRhYmFzZUFjY2Vzc1Njb3BlU3RvcmFnZSkgcmV0dXJuIHRoaXMuX3Rlc3REYXRhYmFzZUFjY2Vzc1Njb3BlU3RvcmFnZS5nZXRTdG9yZSgpXG5cbiAgICByZXR1cm4gdGhpcy5fdGVzdERhdGFiYXNlQWNjZXNzU2NvcGVzW3RoaXMuX3Rlc3REYXRhYmFzZUFjY2Vzc1Njb3Blcy5sZW5ndGggLSAxXT8uc2NvcGVcbiAgfVxuXG4gIC8qKiBUaHJvd3Mgd2hlbiB0aGUgY3VycmVudCB0ZXN0IGF0dGVtcHQgbm8gbG9uZ2VyIG93bnMgZGF0YWJhc2UgYWNjZXNzLiAqL1xuICBhc3NlcnRUZXN0RGF0YWJhc2VBY2Nlc3NBbGxvd2VkKCkge1xuICAgIGNvbnN0IHNjb3BlID0gdGhpcy5jdXJyZW50VGVzdERhdGFiYXNlQWNjZXNzU2NvcGUoKVxuXG4gICAgaWYgKHNjb3BlPy5yZXZva2VkKSB7XG4gICAgICB0aHJvdyBuZXcgVGVzdERhdGFiYXNlQWNjZXNzUmV2b2tlZEVycm9yKFwiRGF0YWJhc2UgYWNjZXNzIGlzIG5vIGxvbmdlciBhbGxvd2VkIGZvciB0aGlzIHRlc3QgYXR0ZW1wdFwiKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBJbnN0YWxscyBhc3luYy1jb250ZXh0IHN0b3JhZ2Ugb3duZWQgYnkgdGhlIGZpcnN0IE5vZGUgdGVzdCBydW5uZXIuXG4gICAqIEBwYXJhbSB7VGVzdERhdGFiYXNlQWNjZXNzU2NvcGVTdG9yYWdlfSBzdG9yYWdlIC0gU2NvcGUgc3RvcmFnZS5cbiAgICovXG4gIGluc3RhbGxUZXN0RGF0YWJhc2VBY2Nlc3NTY29wZVN0b3JhZ2Uoc3RvcmFnZSkge1xuICAgIHRoaXMuX3Rlc3REYXRhYmFzZUFjY2Vzc1Njb3BlU3RvcmFnZSA/Pz0gc3RvcmFnZVxuICB9XG5cbiAgLyoqIEB0eXBlIHtBcnJheTx7b3duZXI6IHN5bWJvbCwgc2NvcGU6IHtyZXZva2VkOiBib29sZWFufSB8IHVuZGVmaW5lZH0+fSAqL1xuICBfdGVzdERhdGFiYXNlQWNjZXNzU2NvcGVzID0gW11cblxuICAvKiogQHR5cGUge1Rlc3REYXRhYmFzZUFjY2Vzc1Njb3BlU3RvcmFnZSB8IHVuZGVmaW5lZH0gKi9cbiAgX3Rlc3REYXRhYmFzZUFjY2Vzc1Njb3BlU3RvcmFnZSA9IHVuZGVmaW5lZFxuXG4gIC8qKlxuICAgKiBNdXRhYmxlIGFtYmllbnQgdGVuYW50IHVzZWQgYnkgcnVudGltZXMgd2l0aG91dCBhc3luYy1jb250ZXh0IHN0b3JhZ2UuXG4gICAqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiB8IHVuZGVmaW5lZH1cbiAgICovXG4gIF9jdXJyZW50VGVuYW50ID0gdW5kZWZpbmVkXG5cbiAgLyoqXG4gICAqIEFjdGl2ZSBhbWJpZW50IHNjb3BlcyBpbiBzdGFydCBvcmRlci4gVGhpcyBwcmV2ZW50cyBhIHNjb3BlIHRoYXQgY29tcGxldGVzXG4gICAqIG91dCBvZiBvcmRlciBmcm9tIHJlc3RvcmluZyBhIHRlbmFudCBiZWxvbmdpbmcgdG8gYW4gYWxyZWFkeS1jb21wbGV0ZWQgc2NvcGUuXG4gICAqIEFtYmllbnQgcmVhZHMgYXJlIHN0aWxsIHNoYXJlZCBpbiBicm93c2VyIHJ1bnRpbWVzOyBpbW11dGFibGUgaGFuZGxlcyByZW1haW5cbiAgICogdGhlIGNvbmN1cnJlbmN5LXNhZmUgZGF0YWJhc2UgQVBJLlxuICAgKiBAdHlwZSB7QXJyYXk8e293bmVyOiBzeW1ib2wsIHRlbmFudDogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59Pn1cbiAgICovXG4gIF90ZW5hbnRTY29wZXMgPSBbXVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlYnVnIGVuZHBvaW50IHRva2VuIG1hdGNoZXMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBwcm92aWRlZFRva2VuIC0gVG9rZW4gZnJvbSB0aGUgcmVxdWVzdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGV4cGVjdGVkVG9rZW4gLSBDb25maWd1cmVkIHRva2VuLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGJvdGggdG9rZW5zIG1hdGNoLlxuICAgKi9cbiAgZGVidWdFbmRwb2ludFRva2VuTWF0Y2hlcyhwcm92aWRlZFRva2VuLCBleHBlY3RlZFRva2VuKSB7XG4gICAgbGV0IGRpZmZlcmVuY2UgPSBwcm92aWRlZFRva2VuLmxlbmd0aCBeIGV4cGVjdGVkVG9rZW4ubGVuZ3RoXG4gICAgY29uc3QgbWF4TGVuZ3RoID0gTWF0aC5tYXgocHJvdmlkZWRUb2tlbi5sZW5ndGgsIGV4cGVjdGVkVG9rZW4ubGVuZ3RoKVxuXG4gICAgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IG1heExlbmd0aDsgaW5kZXgrKykge1xuICAgICAgZGlmZmVyZW5jZSB8PSAocHJvdmlkZWRUb2tlbi5jaGFyQ29kZUF0KGluZGV4KSB8fCAwKSBeIChleHBlY3RlZFRva2VuLmNoYXJDb2RlQXQoaW5kZXgpIHx8IDApXG4gICAgfVxuXG4gICAgcmV0dXJuIGRpZmZlcmVuY2UgPT09IDBcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBmcmFtZXdvcmsgc291cmNlIGRpcmVjdG9yeS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBWZWxvY2lvdXMgc291cmNlIGRpcmVjdG9yeSB1c2VkIHRvIGZpbHRlciBmcmFtZXdvcmsgc3RhY2sgZnJhbWVzLlxuICAgKi9cbiAgZ2V0RnJhbWV3b3JrU291cmNlRGlyZWN0b3J5KCkge1xuICAgIHJldHVybiB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBBdXRvLWRpc2NvdmVycyByZXNvdXJjZSBjbGFzc2VzLiBOby1vcCBpbiBiYXNlIGhhbmRsZXI7IG92ZXJyaWRkZW4gaW4gTm9kZSBoYW5kbGVyLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gX2NvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIGF1dG9EaXNjb3ZlclJlc291cmNlcyhfY29uZmlndXJhdGlvbikge31cblxuICAvKipcbiAgICogUnVucyBydW4gd2l0aCB0aW1lem9uZSBvZmZzZXQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBfb2Zmc2V0TWludXRlcyAtIE9mZnNldCBpbiBtaW51dGVzIChEYXRlI2dldFRpbWV6b25lT2Zmc2V0KS5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY2FsbGJhY2sgLSBDYWxsYmFjayB0byBydW4uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXN1bHQgb2YgdGhlIGNhbGxiYWNrLlxuICAgKi9cbiAgYXN5bmMgcnVuV2l0aFRpbWV6b25lT2Zmc2V0KF9vZmZzZXRNaW51dGVzLCBjYWxsYmFjaykge1xuICAgIGlmICghdGhpcy5jb25maWd1cmF0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJDb25maWd1cmF0aW9uIGhhc24ndCBiZWVuIHNldFwiKVxuXG4gICAgY29uc3QgcHJldmlvdXNPZmZzZXRNaW51dGVzID0gdGhpcy5jb25maWd1cmF0aW9uLl90aW1lem9uZU9mZnNldE1pbnV0ZXNcblxuICAgIHRoaXMuY29uZmlndXJhdGlvbi5fdGltZXpvbmVPZmZzZXRNaW51dGVzID0gX29mZnNldE1pbnV0ZXNcblxuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soKVxuICAgIH0gZmluYWxseSB7XG4gICAgICB0aGlzLmNvbmZpZ3VyYXRpb24uX3RpbWV6b25lT2Zmc2V0TWludXRlcyA9IHByZXZpb3VzT2Zmc2V0TWludXRlc1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1biB3aXRoIHRpbWV6b25lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGltZVpvbmUgLSBJQU5BIHRpbWV6b25lIGlkZW50aWZpZXIuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgdG8gcnVuLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzdWx0IG9mIHRoZSBjYWxsYmFjay5cbiAgICovXG4gIGFzeW5jIHJ1bldpdGhUaW1lem9uZSh0aW1lWm9uZSwgY2FsbGJhY2spIHtcbiAgICBpZiAoIXRoaXMuY29uZmlndXJhdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiQ29uZmlndXJhdGlvbiBoYXNuJ3QgYmVlbiBzZXRcIilcblxuICAgIGNvbnN0IHByZXZpb3VzVGltZVpvbmUgPSB0aGlzLmNvbmZpZ3VyYXRpb24uX3RpbWVab25lXG5cbiAgICB0aGlzLmNvbmZpZ3VyYXRpb24uX3RpbWVab25lID0gdmFsaWRhdGVUaW1lWm9uZSh0aW1lWm9uZSwgXCJ0aW1lWm9uZVwiKVxuXG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBhd2FpdCBjYWxsYmFjaygpXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMuY29uZmlndXJhdGlvbi5fdGltZVpvbmUgPSBwcmV2aW91c1RpbWVab25lXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHRpbWV6b25lIG9mZnNldC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IF9vZmZzZXRNaW51dGVzIC0gT2Zmc2V0IGluIG1pbnV0ZXMgKERhdGUjZ2V0VGltZXpvbmVPZmZzZXQpLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRUaW1lem9uZU9mZnNldChfb2Zmc2V0TWludXRlcykge1xuICAgIGlmICghdGhpcy5jb25maWd1cmF0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJDb25maWd1cmF0aW9uIGhhc24ndCBiZWVuIHNldFwiKVxuXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtudW1iZXJ9ICovXG4gICAgdGhpcy5jb25maWd1cmF0aW9uLl90aW1lem9uZU9mZnNldE1pbnV0ZXMgPSBfb2Zmc2V0TWludXRlc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHRpbWV6b25lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGltZVpvbmUgLSBJQU5BIHRpbWV6b25lIGlkZW50aWZpZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldFRpbWV6b25lKHRpbWVab25lKSB7XG4gICAgaWYgKCF0aGlzLmNvbmZpZ3VyYXRpb24pIHRocm93IG5ldyBFcnJvcihcIkNvbmZpZ3VyYXRpb24gaGFzbid0IGJlZW4gc2V0XCIpXG5cbiAgICB0aGlzLmNvbmZpZ3VyYXRpb24uX3RpbWVab25lID0gdmFsaWRhdGVUaW1lWm9uZSh0aW1lWm9uZSwgXCJ0aW1lWm9uZVwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRpbWV6b25lIG9mZnNldCBtaW51dGVzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gT2Zmc2V0IGluIG1pbnV0ZXMuXG4gICAqL1xuICBnZXRUaW1lem9uZU9mZnNldE1pbnV0ZXMoY29uZmlndXJhdGlvbikge1xuICAgIGNvbnN0IGFjdGl2ZUNvbmZpZ3VyYXRpb24gPSBjb25maWd1cmF0aW9uIHx8IHRoaXMuY29uZmlndXJhdGlvblxuXG4gICAgaWYgKCFhY3RpdmVDb25maWd1cmF0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJDb25maWd1cmF0aW9uIGhhc24ndCBiZWVuIHNldFwiKVxuXG4gICAgaWYgKHR5cGVvZiBhY3RpdmVDb25maWd1cmF0aW9uLl90aW1lem9uZU9mZnNldE1pbnV0ZXMgPT09IFwibnVtYmVyXCIpIHtcbiAgICAgIHJldHVybiBhY3RpdmVDb25maWd1cmF0aW9uLl90aW1lem9uZU9mZnNldE1pbnV0ZXNcbiAgICB9XG5cbiAgICByZXR1cm4gLyoqIEB0eXBlIHtudW1iZXJ9ICovIChhY3RpdmVDb25maWd1cmF0aW9uLmdldFRpbWV6b25lT2Zmc2V0TWludXRlcygpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRpbWV6b25lLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gVGltZXpvbmUgaWRlbnRpZmllci5cbiAgICovXG4gIGdldFRpbWVab25lKGNvbmZpZ3VyYXRpb24pIHtcbiAgICBjb25zdCBhY3RpdmVDb25maWd1cmF0aW9uID0gY29uZmlndXJhdGlvbiB8fCB0aGlzLmNvbmZpZ3VyYXRpb25cblxuICAgIGlmICghYWN0aXZlQ29uZmlndXJhdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiQ29uZmlndXJhdGlvbiBoYXNuJ3QgYmVlbiBzZXRcIilcblxuICAgIHJldHVybiBhY3RpdmVDb25maWd1cmF0aW9uLmdldFRpbWVab25lKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1biB3aXRoIHJlcXVlc3QgdGltaW5nLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2h0dHAtc2VydmVyL2NsaWVudC9yZXF1ZXN0LXRpbWluZy5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSByZXF1ZXN0VGltaW5nIC0gUmVxdWVzdCB0aW1pbmcgY29sbGVjdG9yLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjYWxsYmFjayAtIENhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgcnVuV2l0aFJlcXVlc3RUaW1pbmcocmVxdWVzdFRpbWluZywgY2FsbGJhY2spIHtcbiAgICB0aGlzLl9jdXJyZW50UmVxdWVzdFRpbWluZyA9IHJlcXVlc3RUaW1pbmdcblxuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soKVxuICAgIH0gZmluYWxseSB7XG4gICAgICB0aGlzLl9jdXJyZW50UmVxdWVzdFRpbWluZyA9IHVuZGVmaW5lZFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBjdXJyZW50IHJlcXVlc3QgdGltaW5nLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3JlcXVlc3QtdGltaW5nLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IC0gQ3VycmVudCByZXF1ZXN0IHRpbWluZyBjb2xsZWN0b3IuXG4gICAqL1xuICBnZXRDdXJyZW50UmVxdWVzdFRpbWluZygpIHtcbiAgICByZXR1cm4gdGhpcy5fY3VycmVudFJlcXVlc3RUaW1pbmdcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1biB3aXRoIGFiaWxpdHkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IGFiaWxpdHkgLSBBYmlsaXR5IHRvIHNldCBmb3IgY2FsbGJhY2sgc2NvcGUuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGNhbGxiYWNrIC0gQ2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBydW5XaXRoQWJpbGl0eShhYmlsaXR5LCBjYWxsYmFjaykge1xuICAgIHRoaXMuX2N1cnJlbnRBYmlsaXR5ID0gYWJpbGl0eVxuXG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBhd2FpdCBjYWxsYmFjaygpXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMuX2N1cnJlbnRBYmlsaXR5ID0gdW5kZWZpbmVkXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGN1cnJlbnQgYWJpbGl0eS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9hdXRob3JpemF0aW9uL2FiaWxpdHkuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gYWJpbGl0eSAtIEFiaWxpdHkgdG8gc2V0LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRDdXJyZW50QWJpbGl0eShhYmlsaXR5KSB7XG4gICAgdGhpcy5fY3VycmVudEFiaWxpdHkgPSBhYmlsaXR5XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgY3VycmVudCBhYmlsaXR5LlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IC0gQ3VycmVudCBhYmlsaXR5LlxuICAgKi9cbiAgZ2V0Q3VycmVudEFiaWxpdHkoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2N1cnJlbnRBYmlsaXR5XG4gIH1cblxuICAvKipcbiAgICogUnVucyBydW4gd2l0aCB0ZW5hbnQuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHRlbmFudCAtIFRlbmFudCB0byBzZXQgZm9yIGNhbGxiYWNrIHNjb3BlLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjYWxsYmFjayAtIENhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgcnVuV2l0aFRlbmFudCh0ZW5hbnQsIGNhbGxiYWNrKSB7XG4gICAgY29uc3Qgc2NvcGUgPSB7b3duZXI6IFN5bWJvbChcImJyb3dzZXItdGVuYW50LXNjb3BlXCIpLCB0ZW5hbnR9XG5cbiAgICB0aGlzLl90ZW5hbnRTY29wZXMucHVzaChzY29wZSlcblxuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soKVxuICAgIH0gZmluYWxseSB7XG4gICAgICBjb25zdCBzY29wZUluZGV4ID0gdGhpcy5fdGVuYW50U2NvcGVzLmZpbmRJbmRleCgoY2FuZGlkYXRlKSA9PiBjYW5kaWRhdGUub3duZXIgPT09IHNjb3BlLm93bmVyKVxuXG4gICAgICBpZiAoc2NvcGVJbmRleCAhPT0gLTEpIHRoaXMuX3RlbmFudFNjb3Blcy5zcGxpY2Uoc2NvcGVJbmRleCwgMSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgY3VycmVudCB0ZW5hbnQuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHRlbmFudCAtIFRlbmFudCB0byBzZXQuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldEN1cnJlbnRUZW5hbnQodGVuYW50KSB7XG4gICAgdGhpcy5fY3VycmVudFRlbmFudCA9IHRlbmFudFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGN1cnJlbnQgdGVuYW50LlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gQ3VycmVudCB0ZW5hbnQuXG4gICAqL1xuICBnZXRDdXJyZW50VGVuYW50KCkge1xuICAgIHJldHVybiB0aGlzLl90ZW5hbnRTY29wZXNbdGhpcy5fdGVuYW50U2NvcGVzLmxlbmd0aCAtIDFdPy50ZW5hbnQgPz8gdGhpcy5fY3VycmVudFRlbmFudFxuICB9XG4gIC8qKlxuICAgKiBSdW5zIGNsaSBjb21tYW5kcyBnZW5lcmF0ZSBiYXNlIG1vZGVscy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jbGkvYmFzZS1jb21tYW5kLmpzXCIpLmRlZmF1bHR9IF9jb21tYW5kIC0gQ29tbWFuZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNvbW1hbmQgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgY2xpQ29tbWFuZHNHZW5lcmF0ZUJhc2VNb2RlbHMoX2NvbW1hbmQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJjbGlDb21tYW5kc0dlbmVyYXRlQmFzZU1vZGVscyBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsaSBjb21tYW5kcyBnZW5lcmF0ZSBmcm9udGVuZCBtb2RlbHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiKS5kZWZhdWx0fSBfY29tbWFuZCAtIENvbW1hbmQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjb21tYW5kIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGNsaUNvbW1hbmRzR2VuZXJhdGVGcm9udGVuZE1vZGVscyhfY29tbWFuZCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcImNsaUNvbW1hbmRzR2VuZXJhdGVGcm9udGVuZE1vZGVscyBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsaSBjb21tYW5kcyBpbml0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NsaS9iYXNlLWNvbW1hbmQuanNcIikuZGVmYXVsdH0gY29tbWFuZCAtIENvbW1hbmQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjb21tYW5kIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGNsaUNvbW1hbmRzSW5pdChjb21tYW5kKSB7IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tdW51c2VkLXZhcnNcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJjbGlDb21tYW5kc0luaXQgbm90IGltcGxlbWVudGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGkgY29tbWFuZHMgbWlncmF0aW9uIGdlbmVyYXRlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NsaS9iYXNlLWNvbW1hbmQuanNcIikuZGVmYXVsdH0gX2NvbW1hbmQgLSBDb21tYW5kLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY29tbWFuZCByZXN1bHQuXG4gICAqL1xuICBhc3luYyBjbGlDb21tYW5kc01pZ3JhdGlvbkdlbmVyYXRlKF9jb21tYW5kKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiY2xpQ29tbWFuZHNNaWdyYXRpb25HZW5lcmF0ZSBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsaSBjb21tYW5kcyBtaWdyYXRpb24gZGVzdHJveS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jbGkvYmFzZS1jb21tYW5kLmpzXCIpLmRlZmF1bHR9IF9jb21tYW5kIC0gQ29tbWFuZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNvbW1hbmQgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgY2xpQ29tbWFuZHNNaWdyYXRpb25EZXN0cm95KF9jb21tYW5kKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiY2xpQ29tbWFuZHNNaWdyYXRpb25EZXN0cm95IG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xpIGNvbW1hbmRzIGdlbmVyYXRlIG1vZGVsLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NsaS9iYXNlLWNvbW1hbmQuanNcIikuZGVmYXVsdH0gX2NvbW1hbmQgLSBDb21tYW5kLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY29tbWFuZCByZXN1bHQuXG4gICAqL1xuICBhc3luYyBjbGlDb21tYW5kc0dlbmVyYXRlTW9kZWwoX2NvbW1hbmQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJjbGlDb21tYW5kc0dlbmVyYXRlTW9kZWwgbm90IGltcGxlbWVudGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGkgY29tbWFuZHMgbGludCByZWxhdGlvbnNoaXBzLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jbGkvYmFzZS1jb21tYW5kLmpzXCIpLmRlZmF1bHR9IF9jb21tYW5kIC0gQ29tbWFuZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNvbW1hbmQgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgY2xpQ29tbWFuZHNMaW50UmVsYXRpb25zaGlwcyhfY29tbWFuZCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcImNsaUNvbW1hbmRzTGludFJlbGF0aW9uc2hpcHMgbm90IGltcGxlbWVudGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGkgY29tbWFuZHMgcm91dGVzLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jbGkvYmFzZS1jb21tYW5kLmpzXCIpLmRlZmF1bHR9IF9jb21tYW5kIC0gQ29tbWFuZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNvbW1hbmQgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgY2xpQ29tbWFuZHNSb3V0ZXMoX2NvbW1hbmQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJjbGlDb21tYW5kc1JvdXRlcyBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsaSBjb21tYW5kcyBjb25zb2xlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NsaS9iYXNlLWNvbW1hbmQuanNcIikuZGVmYXVsdH0gX2NvbW1hbmQgLSBDb21tYW5kLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY29tbWFuZCByZXN1bHQuXG4gICAqL1xuICBhc3luYyBjbGlDb21tYW5kc0NvbnNvbGUoX2NvbW1hbmQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJjbGlDb21tYW5kc0NvbnNvbGUgbm90IGltcGxlbWVudGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGkgY29tbWFuZHMgc2VydmVyLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NsaS9iYXNlLWNvbW1hbmQuanNcIikuZGVmYXVsdH0gX2NvbW1hbmQgLSBDb21tYW5kLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY29tbWFuZCByZXN1bHQuXG4gICAqL1xuICBhc3luYyBjbGlDb21tYW5kc1NlcnZlcihfY29tbWFuZCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcImNsaUNvbW1hbmRzU2VydmVyIG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xpIGNvbW1hbmRzIHRlc3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiKS5kZWZhdWx0fSBfY29tbWFuZCAtIENvbW1hbmQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjb21tYW5kIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGNsaUNvbW1hbmRzVGVzdChfY29tbWFuZCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcImNsaUNvbW1hbmRzVGVzdCBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsaSBjb21tYW5kcyB0ZXN0IHRpbWluZyBtYW5pZmVzdCBtZXJnZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jbGkvYmFzZS1jb21tYW5kLmpzXCIpLmRlZmF1bHR9IF9jb21tYW5kIC0gQ29tbWFuZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNvbW1hbmQgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgY2xpQ29tbWFuZHNUZXN0VGltaW5nTWFuaWZlc3RNZXJnZShfY29tbWFuZCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcImNsaUNvbW1hbmRzVGVzdFRpbWluZ01hbmlmZXN0TWVyZ2Ugbm90IGltcGxlbWVudGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGkgY29tbWFuZHMgYmFja2dyb3VuZCBqb2JzIG1haW4uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiKS5kZWZhdWx0fSBfY29tbWFuZCAtIENvbW1hbmQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjb21tYW5kIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGNsaUNvbW1hbmRzQmFja2dyb3VuZEpvYnNNYWluKF9jb21tYW5kKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiY2xpQ29tbWFuZHNCYWNrZ3JvdW5kSm9ic01haW4gbm90IGltcGxlbWVudGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBDTEkgYmFja2dyb3VuZC1qb2JzIGFjdGl2YXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiKS5kZWZhdWx0fSBfY29tbWFuZCAtIENvbW1hbmQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXN1bHQuXG4gICAqL1xuICBhc3luYyBjbGlDb21tYW5kc0JhY2tncm91bmRKb2JzQWN0aXZhdGUoX2NvbW1hbmQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJjbGlDb21tYW5kc0JhY2tncm91bmRKb2JzQWN0aXZhdGUgbm90IGltcGxlbWVudGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBDTEkgYmFja2dyb3VuZC1qb2JzIHJldGlyZW1lbnQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiKS5kZWZhdWx0fSBfY29tbWFuZCAtIENvbW1hbmQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXN1bHQuXG4gICAqL1xuICBhc3luYyBjbGlDb21tYW5kc0JhY2tncm91bmRKb2JzUmV0aXJlKF9jb21tYW5kKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiY2xpQ29tbWFuZHNCYWNrZ3JvdW5kSm9ic1JldGlyZSBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsaSBjb21tYW5kcyBiYWNrZ3JvdW5kIGpvYnMgd29ya2VyLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NsaS9iYXNlLWNvbW1hbmQuanNcIikuZGVmYXVsdH0gX2NvbW1hbmQgLSBDb21tYW5kLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY29tbWFuZCByZXN1bHQuXG4gICAqL1xuICBhc3luYyBjbGlDb21tYW5kc0JhY2tncm91bmRKb2JzV29ya2VyKF9jb21tYW5kKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiY2xpQ29tbWFuZHNCYWNrZ3JvdW5kSm9ic1dvcmtlciBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsaSBjb21tYW5kcyBiYWNrZ3JvdW5kIGpvYnMgcnVubmVyLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NsaS9iYXNlLWNvbW1hbmQuanNcIikuZGVmYXVsdH0gX2NvbW1hbmQgLSBDb21tYW5kLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY29tbWFuZCByZXN1bHQuXG4gICAqL1xuICBhc3luYyBjbGlDb21tYW5kc0JhY2tncm91bmRKb2JzUnVubmVyKF9jb21tYW5kKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiY2xpQ29tbWFuZHNCYWNrZ3JvdW5kSm9ic1J1bm5lciBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsaSBjb21tYW5kcyBiZWFjb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiKS5kZWZhdWx0fSBfY29tbWFuZCAtIENvbW1hbmQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjb21tYW5kIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGNsaUNvbW1hbmRzQmVhY29uKF9jb21tYW5kKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiY2xpQ29tbWFuZHNCZWFjb24gbm90IGltcGxlbWVudGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogTG9hZHMgdGhlIFRDUC1iYWNrZWQgQmVhY29uIGNsaWVudCBjbGFzcy4gUm91dGVkIHRocm91Z2ggdGhlXG4gICAqIGVudmlyb25tZW50IGhhbmRsZXIgc28gdGhlIGR5bmFtaWMgYGltcG9ydChcIi4uL2JlYWNvbi9jbGllbnQuanNcIilgXG4gICAqIGNhbGwgbGl2ZXMgb24gdGhlIE5vZGUtb25seSBwYXRoIOKAlCBrZWVwcyBCZWFjb24ncyBgbm9kZTpuZXRgIC9cbiAgICogYG5vZGU6Y3J5cHRvYCBkZXBzIG91dCBvZiBicm93c2VyIGJ1bmRsZXMgdGhhdCBzdGF0aWNhbGx5IHJlYWNoXG4gICAqIGBDb25maWd1cmF0aW9uYCAoYW5kIHRoZXJlZm9yZSBwcmV2aW91c2x5IHJlYWNoZWQgdGhlIGR5bmFtaWNcbiAgICogaW1wb3J0cykuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHR5cGVvZiBpbXBvcnQoXCIuLi9iZWFjb24vY2xpZW50LmpzXCIpLmRlZmF1bHQ+fSAtIEJlYWNvbiBjbGllbnQgY2xhc3MuXG4gICAqL1xuICBhc3luYyBsb2FkQmVhY29uQ2xpZW50KCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcImxvYWRCZWFjb25DbGllbnQgbm90IGltcGxlbWVudGVkIGJ5IHRoaXMgZW52aXJvbm1lbnQgaGFuZGxlclwiKVxuICB9XG5cbiAgLyoqXG4gICAqIExvYWRzIHRoZSBpbi1wcm9jZXNzIEJlYWNvbiBjbGllbnQgY2xhc3MuIFNhbWUgaW5kaXJlY3Rpb24gcmF0aW9uYWxlXG4gICAqIGFzIGBsb2FkQmVhY29uQ2xpZW50YC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dHlwZW9mIGltcG9ydChcIi4uL2JlYWNvbi9pbi1wcm9jZXNzLWNsaWVudC5qc1wiKS5kZWZhdWx0Pn0gLSBJbi1wcm9jZXNzIGNsaWVudCBjbGFzcy5cbiAgICovXG4gIGFzeW5jIGxvYWRJblByb2Nlc3NCZWFjb25DbGllbnQoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwibG9hZEluUHJvY2Vzc0JlYWNvbkNsaWVudCBub3QgaW1wbGVtZW50ZWQgYnkgdGhpcyBlbnZpcm9ubWVudCBoYW5kbGVyXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGkgY29tbWFuZHMgZGIgc2NoZW1hIGR1bXAuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiKS5kZWZhdWx0fSBfY29tbWFuZCAtIENvbW1hbmQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjb21tYW5kIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGNsaUNvbW1hbmRzRGJTY2hlbWFEdW1wKF9jb21tYW5kKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiY2xpQ29tbWFuZHNEYlNjaGVtYUR1bXAgbm90IGltcGxlbWVudGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGkgY29tbWFuZHMgZGIgc2NoZW1hIGxvYWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiKS5kZWZhdWx0fSBfY29tbWFuZCAtIENvbW1hbmQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjb21tYW5kIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGNsaUNvbW1hbmRzRGJTY2hlbWFMb2FkKF9jb21tYW5kKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiY2xpQ29tbWFuZHNEYlNjaGVtYUxvYWQgbm90IGltcGxlbWVudGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGkgY29tbWFuZHMgZGIgc2VlZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jbGkvYmFzZS1jb21tYW5kLmpzXCIpLmRlZmF1bHR9IF9jb21tYW5kIC0gQ29tbWFuZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNvbW1hbmQgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgY2xpQ29tbWFuZHNEYlNlZWQoX2NvbW1hbmQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJjbGlDb21tYW5kc0RiU2VlZCBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsaSBjb21tYW5kcyBydW5uZXIuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiKS5kZWZhdWx0fSBfY29tbWFuZCAtIENvbW1hbmQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjb21tYW5kIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGNsaUNvbW1hbmRzUnVubmVyKF9jb21tYW5kKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiY2xpQ29tbWFuZHNSdW5uZXIgbm90IGltcGxlbWVudGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGkgY29tbWFuZHMgcnVuIHNjcmlwdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jbGkvYmFzZS1jb21tYW5kLmpzXCIpLmRlZmF1bHR9IF9jb21tYW5kIC0gQ29tbWFuZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNvbW1hbmQgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgY2xpQ29tbWFuZHNSdW5TY3JpcHQoX2NvbW1hbmQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJjbGlDb21tYW5kc1J1blNjcmlwdCBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQgY29tbWFuZHMuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxDb21tYW5kRmlsZU9iamVjdFR5cGVbXT59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY29tbWFuZHMuXG4gICAqL1xuICBhc3luYyBmaW5kQ29tbWFuZHMoKSB7IHRocm93IG5ldyBFcnJvcihcImZpbmRDb21tYW5kcyBub3QgaW1wbGVtZW50ZWRcIikgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQgbWlncmF0aW9ucy5cbiAgICogQGFic3RyYWN0XG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5PE1pZ3JhdGlvbk9iamVjdFR5cGU+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBtaWdyYXRpb25zLlxuICAgKi9cbiAgYXN5bmMgZmluZE1pZ3JhdGlvbnMoKSB7IHRocm93IG5ldyBFcnJvcihcImZpbmRNaWdyYXRpb25zIG5vdCBpbXBsZW1uZXRlZFwiKSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZm9yd2FyZCBjb21tYW5kLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NsaS9iYXNlLWNvbW1hbmQuanNcIikuZGVmYXVsdH0gY29tbWFuZCAtIENvbW1hbmQuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL2NsaS9iYXNlLWNvbW1hbmQuanNcIikuZGVmYXVsdH0gQ29tbWFuZENsYXNzIC0gQ29tbWFuZCBjbGFzcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNvbW1hbmQgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgZm9yd2FyZENvbW1hbmQoY29tbWFuZCwgQ29tbWFuZENsYXNzKSB7XG4gICAgY29uc3QgbmV3Q29tbWFuZCA9IG5ldyBDb21tYW5kQ2xhc3Moe1xuICAgICAgYXJnczogY29tbWFuZC5hcmdzLFxuICAgICAgY2xpOiBjb21tYW5kLmNsaVxuICAgIH0pXG5cbiAgICByZXR1cm4gYXdhaXQgbmV3Q29tbWFuZC5leGVjdXRlKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB2ZWxvY2lvdXMgcGF0aC5cbiAgICogQGFic3RyYWN0XG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgdmVsb2Npb3VzIHBhdGguXG4gICAqL1xuICBnZXRWZWxvY2lvdXNQYXRoKCkgeyB0aHJvdyBuZXcgRXJyb3IoXCJnZXRWZWxvY2lvdXNQYXRoIG5vdCBpbXBsZW1lbnRlZFwiKSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaW1wb3J0IGFwcGxpY2F0aW9uIHJvdXRlcy5cbiAgICogQGFic3RyYWN0XG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4uL3JvdXRlcy9pbmRleC5qc1wiKS5kZWZhdWx0Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBpbXBvcnQgYXBwbGljYXRpb24gcm91dGVzLlxuICAgKi9cbiAgYXN5bmMgaW1wb3J0QXBwbGljYXRpb25Sb3V0ZXMoKSB7IHRocm93IG5ldyBFcnJvcihcImltcG9ydEFwcGxpY2F0aW9uUm91dGVzIG5vdCBpbXBsZW1lbnRlZFwiKSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaW1wb3J0IHRlc3QgZmlsZXMuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBfdGVzdEZpbGVzIC0gVGVzdCBmaWxlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGltcG9ydFRlc3RGaWxlcyhfdGVzdEZpbGVzKSB7IHRocm93IG5ldyBFcnJvcihcIidpbXBvcnRUZXN0RmlsZXMnIG5vdCBpbXBsZW1lbnRlZFwiKSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaW1wb3J0IHRlc3RpbmcgY29uZmlnIHBhdGguXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgaW1wb3J0VGVzdGluZ0NvbmZpZ1BhdGgoKSB7IHRocm93IG5ldyBFcnJvcihgJ2ltcG9ydFRlc3RpbmdDb25maWdQYXRoJyBub3QgaW1wbGVtZW50ZWRgKSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWZ0ZXIgbWlncmF0aW9ucy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdD59IGFyZ3MuZGJzIC0gRGJzLlxuICAgKiBAcGFyYW0ge1wibWlncmF0aW9uXCIgfCBcInNjaGVtYUR1bXBcIn0gW2FyZ3MucmVhc29uXSAtIFdoeSB0aGUgc3RydWN0dXJlIHdyaXRlIGhvb2sgaXMgYmVpbmcgaW52b2tlZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGFmdGVyTWlncmF0aW9ucyhhcmdzKSB7IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tdW51c2VkLXZhcnNcbiAgICByZXR1cm5cbiAgfVxuXG4gIC8qKlxuICAgKiBFbnN1cmVzIHZlbG9jaW91cycgb3duIGZyYW1ld29yay1vd25lZCBzY2hlbWEgKGUuZy4gdGhlIGJhY2tncm91bmQtam9ic1xuICAgKiB0YWJsZXMpIGV4aXN0cyBhZnRlciBhcHAgbWlncmF0aW9ucyBydW4sIHNvIGBkYjptaWdyYXRlYCBwcm9kdWNlcyBhIGNvbXBsZXRlXG4gICAqIHNjaGVtYSBkZXRlcm1pbmlzdGljYWxseSBpbnN0ZWFkIG9mIGl0IG9ubHkgYXBwZWFyaW5nIG9uY2UgYSBydW50aW1lIHN0b3JlXG4gICAqIGJvb3RzLiBSdW5zIGJlZm9yZSB0aGUgc3RydWN0dXJlIGR1bXAuIE5vLW9wIGJ5IGRlZmF1bHQ7IHRoZSBub2RlIGhhbmRsZXJcbiAgICogb3ZlcnJpZGVzIGl0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0Pn0gYXJncy5kYnMgLSBEYnMgYmVpbmcgbWlncmF0ZWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBlbnN1cmVGcmFtZXdvcmtTY2hlbWEoYXJncykgeyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIG5vLXVudXNlZC12YXJzXG4gICAgcmV0dXJuXG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlcyB0aGUgZW52aXJvbm1lbnQncyBkZWZhdWx0IHBlcnNpc3RlbmNlIGFkYXB0ZXIuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcGFyYW0ge3tjb25maWd1cmF0aW9uOiBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9fSBfYXJncyAtIEFkYXB0ZXIgb3B0aW9ucy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2JhY2tncm91bmQtam9icy9hZGFwdGVyLmpzXCIpLmRlZmF1bHR9IC0gRGVmYXVsdCBhZGFwdGVyLlxuICAgKi9cbiAgY3JlYXRlQmFja2dyb3VuZEpvYnNBZGFwdGVyKF9hcmdzKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiVGhpcyBlbnZpcm9ubWVudCByZXF1aXJlcyBhbiBleHBsaWNpdCBiYWNrZ3JvdW5kSm9icy5hZGFwdGVyXCIpXG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlcyB0aGUgcGxhdGZvcm0tbmV1dHJhbCBwcm9kdWNlciBwYXRoIGZvciBhbiBleHBsaWNpdCBhZGFwdGVyLlxuICAgKiBAcGFyYW0ge3tjb25maWd1cmF0aW9uOiBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9fSBhcmdzIC0gQ2xpZW50IG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9iYWNrZ3JvdW5kLWpvYnMvdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYnNQcm9kdWNlcn0gLSBBZGFwdGVyLWJhY2tlZCBwcm9kdWNlci5cbiAgICovXG4gIGJhY2tncm91bmRKb2JzQ2xpZW50KGFyZ3MpIHtcbiAgICByZXR1cm4gbmV3IEJhY2tncm91bmRKb2JzQWRhcHRlckNsaWVudChhcmdzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVxdWlyZSBjb21tYW5kLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gYXJncy5jb21tYW5kUGFydHMgLSBDb21tYW5kIHBhcnRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx0eXBlb2YgaW1wb3J0IChcIi4uL2NsaS9iYXNlLWNvbW1hbmQuanNcIikuZGVmYXVsdD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgcmVxdWlyZSBjb21tYW5kLlxuICAgKi9cbiAgYXN5bmMgcmVxdWlyZUNvbW1hbmQoe2NvbW1hbmRQYXJ0c30pIHsgdGhyb3cgbmV3IEVycm9yKFwiJ3JlcXVpcmVDb21tYW5kJyBub3QgaW1wbGVtZW50ZWRcIikgfSAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIG5vLXVudXNlZC12YXJzXG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGFyZ3MuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBuZXdBcmdzIC0gTmV3IGFyZ3MuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldEFyZ3MobmV3QXJncykgeyB0aGlzLmFyZ3MgPSBuZXdBcmdzIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IG5ld0NvbmZpZ3VyYXRpb24gLSBOZXcgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0Q29uZmlndXJhdGlvbihuZXdDb25maWd1cmF0aW9uKSB7IHRoaXMuY29uZmlndXJhdGlvbiA9IG5ld0NvbmZpZ3VyYXRpb24gfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlYWQgYXR0YWNobWVudCBpbnB1dCBmaWxlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gX2ZpbGVQYXRoIC0gRmlsZSBwYXRoLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxCdWZmZXI+fSAtIEZpbGUgYnl0ZXMuXG4gICAqL1xuICBhc3luYyByZWFkQXR0YWNobWVudElucHV0RmlsZShfZmlsZVBhdGgpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJBdHRhY2htZW50IGZpbGUgcmVhZHMgYXJlIG5vdCBzdXBwb3J0ZWQgaW4gdGhpcyBlbnZpcm9ubWVudFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVzb2x2ZSBhdHRhY2htZW50IGlucHV0IHBhdGguXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBfYXJncyAtIEFyZ3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IF9hcmdzLmFsbG93ZWRQYXRoUHJlZml4ZXMgLSBBbGxvd2VkIHBhdGggcHJlZml4ZXMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBfYXJncy5pbnB1dFBhdGggLSBJbnB1dCBwYXRoLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuLi9kYXRhYmFzZS9yZWNvcmQvYXR0YWNobWVudHMvbm9ybWFsaXplLWlucHV0LmpzXCIpLkF0dGFjaG1lbnRQYXRoU291cmNlPn0gLSBPcGVuZWQgcGF0aCBzb3VyY2UuXG4gICAqL1xuICBhc3luYyByZXNvbHZlQXR0YWNobWVudElucHV0UGF0aChfYXJncykge1xuICAgIHRocm93IG5ldyBFcnJvcihcIkF0dGFjaG1lbnQgcGF0aCBpbnB1dCBpcyBub3Qgc3VwcG9ydGVkIGluIHRoaXMgZW52aXJvbm1lbnRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSAtIFRoZSBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgZ2V0Q29uZmlndXJhdGlvbigpIHtcbiAgICBpZiAoIXRoaXMuY29uZmlndXJhdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiQ29uZmlndXJhdGlvbiBoYXNuJ3QgYmVlbiBzZXRcIilcblxuICAgIHJldHVybiB0aGlzLmNvbmZpZ3VyYXRpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBwcm9jZXNzIGFyZ3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IG5ld1Byb2Nlc3NBcmdzIC0gTmV3IHByb2Nlc3MgYXJncy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0UHJvY2Vzc0FyZ3MobmV3UHJvY2Vzc0FyZ3MpIHsgdGhpcy5wcm9jZXNzQXJncyA9IG5ld1Byb2Nlc3NBcmdzIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZGVmYXVsdCBsb2cgZGlyZWN0b3J5LlxuICAgKiBAcGFyYW0ge29iamVjdH0gX2FyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IF9hcmdzLmNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSAtIFRoZSBkZWZhdWx0IGxvZyBkaXJlY3RvcnkuXG4gICAqL1xuICBnZXREZWZhdWx0TG9nRGlyZWN0b3J5KF9hcmdzKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGxvZyBmaWxlIHBhdGguXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBfYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gX2FyZ3MuY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBfYXJncy5kaXJlY3RvcnkgLSBEaXJlY3RvcnkgcGF0aC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IF9hcmdzLmVudmlyb25tZW50IC0gRW52aXJvbm1lbnQuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gVGhlIGxvZyBmaWxlIHBhdGguXG4gICAqL1xuICBnZXRMb2dGaWxlUGF0aChfYXJncykge1xuICAgIHJldHVybiB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdyaXRlIGxvZyB0byBmaWxlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gX2FyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IF9hcmdzLmZpbGVQYXRoIC0gRmlsZSBwYXRoLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gX2FyZ3MubWVzc2FnZSAtIE1lc3NhZ2UgdGV4dC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHdyaXRlTG9nVG9GaWxlKF9hcmdzKSB7XG4gICAgcmV0dXJuXG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIGZyb250ZW5kLW1vZGVsIHdlYnNvY2tldCBjaGFubmVsIHB1Ymxpc2hlcnMgc28gbGlmZWN5Y2xlXG4gICAqIGV2ZW50IGhvb2tzIChjcmVhdGUvdXBkYXRlL2Rlc3Ryb3kpIGJyb2FkY2FzdCBvdmVyIHRoZSBzaGFyZWRcbiAgICogXCJmcm9udGVuZC1tb2RlbHNcIiBjaGFubmVsLiBUaGUgYmFzZSBoYW5kbGVyIGlzIGEgbm8tb3Ag4oCUIG9ubHkgdGhlXG4gICAqIE5vZGUgaGFuZGxlciBwZXJmb3JtcyB0aGUgcmVnaXN0cmF0aW9uIGJlY2F1c2UgdGhlIHJlcXVpcmVkXG4gICAqIGBmcm9udGVuZC1tb2RlbC1jb250cm9sbGVyYCBhbmQgYHJvdXRlcy9yZXNvbHZlcmAgaW1wb3J0cyBwdWxsIGluXG4gICAqIHNlcnZlci1vbmx5IG1vZHVsZXMgdGhhdCBicmVhayBicm93c2VyIGJ1bmRsZXJzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gX2NvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgaW5pdGlhbGl6ZUZyb250ZW5kTW9kZWxXZWJzb2NrZXRQdWJsaXNoZXJzKF9jb25maWd1cmF0aW9uKSB7XG4gICAgLy8gTm8tb3AgaW4gYmFzZSBoYW5kbGVyOyBOb2RlIGhhbmRsZXIgZG9lcyB0aGUgcmVhbCByZWdpc3RyYXRpb24uXG4gIH1cblxuICAvKipcbiAgICogTG9hZHMgbW9kZWxzIGNvbnRyaWJ1dGVkIGJ5IHJlZ2lzdGVyZWQgcGFja2FnZXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBfY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBpbml0aWFsaXplUGFja2FnZU1vZGVscyhfY29uZmlndXJhdGlvbikge1xuICAgIC8vIE5vLW9wIGluIGJhc2UgaGFuZGxlcjsgTm9kZSBoYW5kbGVyIGxvYWRzIHBhY2thZ2UgbW9kZWxzIGZyb20gdGhlIGZpbGVzeXN0ZW0uXG4gIH1cbn1cbiJdfQ==