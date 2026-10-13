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
     * Runs cli commands mcp.
     * @param {import("../cli/base-command.js").default} _command - Command.
     * @returns {Promise<void>} - Resolves when the command completes.
     */
    async cliCommandsMcp(_command) {
        throw new Error("cliCommandsMcp not implemented");
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9lbnZpcm9ubWVudC1oYW5kbGVycy9iYXNlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLDJCQUEyQixNQUFNLHNDQUFzQyxDQUFBO0FBQzlFLE9BQU8sRUFBRSxnQkFBZ0IsRUFBRSxNQUFNLGlCQUFpQixDQUFBO0FBRWxEOzs7OztHQUtHO0FBRUg7Ozs7Ozs7R0FPRztBQUNIOzs7OztHQUtHO0FBRUgsTUFBTSxPQUFPLDhCQUErQixTQUFRLEtBQUs7Q0FBRztBQUU1RCxNQUFNLENBQUMsT0FBTyxPQUFPLCtCQUErQjtJQUNsRDs7Ozs7T0FLRztJQUNILG9DQUFvQyxDQUFDLEVBQUMsa0JBQWtCLEVBQUMsSUFBSSxPQUFPLGtCQUFrQixDQUFBLENBQUMsQ0FBQztJQUV4Rjs7Ozs7T0FLRztJQUNILEtBQUssQ0FBQyxxQ0FBcUMsQ0FBQyxLQUFLLElBQUksT0FBTyxTQUFTLENBQUEsQ0FBQyxDQUFDO0lBRXZFOzs7O09BSUc7SUFDSCxvQ0FBb0MsQ0FBQyxVQUFVO1FBQzdDLE9BQU8sSUFBSSxDQUFDLHlDQUF5QyxFQUFFLFFBQVEsRUFBRSxFQUFFLEdBQUcsQ0FBQyxVQUFVLENBQUMsQ0FBQTtJQUNwRixDQUFDO0lBRUQ7Ozs7Ozs7T0FPRztJQUNILHdDQUF3QyxDQUFDLFVBQVUsRUFBRSxLQUFLLEVBQUUsUUFBUTtRQUNsRSxNQUFNLE9BQU8sR0FBRyxJQUFJLENBQUMseUNBQXlDLENBQUE7UUFFOUQsSUFBSSxDQUFDLE9BQU87WUFBRSxPQUFPLFFBQVEsRUFBRSxDQUFBO1FBRS9CLE1BQU0sTUFBTSxHQUFHLElBQUksR0FBRyxDQUFDLE9BQU8sQ0FBQyxRQUFRLEVBQUUsQ0FBQyxDQUFBO1FBRTFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsVUFBVSxFQUFFLEtBQUssQ0FBQyxDQUFBO1FBQzdCLE9BQU8sT0FBTyxDQUFDLEdBQUcsQ0FB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QywrQkFBK0IsQ0FBQyxDQUFBO1FBRXpFLE9BQU8sSUFBSSxDQUFDLGFBQWEsQ0FBQTtJQUMzQixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILGNBQWMsQ0FBQyxjQUFjLElBQUksSUFBSSxDQUFDLFdBQVcsR0FBRyxjQUFjLENBQUEsQ0FBQyxDQUFDO0lBRXBFOzs7OztPQUtHO0lBQ0gsc0JBQXNCLENBQUMsS0FBSztRQUMxQixPQUFPLFNBQVMsQ0FBQTtJQUNsQixDQUFDO0lBRUQ7Ozs7Ozs7T0FPRztJQUNILGNBQWMsQ0FBQyxLQUFLO1FBQ2xCLE9BQU8sU0FBUyxDQUFBO0lBQ2xCLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxLQUFLLENBQUMsY0FBYyxDQUFDLEtBQUs7UUFDeEIsT0FBTTtJQUNSLENBQUM7SUFFRDs7Ozs7Ozs7O09BU0c7SUFDSCxLQUFLLENBQUMsMENBQTBDLENBQUMsY0FBYztRQUM3RCxrRUFBa0U7SUFDcEUsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxLQUFLLENBQUMsdUJBQXVCLENBQUMsY0FBYztRQUMxQyxnRkFBZ0Y7SUFDbEYsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBCYWNrZ3JvdW5kSm9ic0FkYXB0ZXJDbGllbnQgZnJvbSBcIi4uL2JhY2tncm91bmQtam9icy9hZGFwdGVyLWNsaWVudC5qc1wiXG5pbXBvcnQgeyB2YWxpZGF0ZVRpbWVab25lIH0gZnJvbSBcIi4uL3RpbWUtem9uZS5qc1wiXG5cbi8qKlxuICogQ29tbWFuZEZpbGVPYmplY3RUeXBlIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBDb21tYW5kRmlsZU9iamVjdFR5cGVcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBuYW1lIC0gQ29tbWFuZCBuYW1lLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGZpbGUgLSBDb21tYW5kIGZpbGUgcGF0aC5cbiAqL1xuXG4vKipcbiAqIE1pZ3JhdGlvbk9iamVjdFR5cGUgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IE1pZ3JhdGlvbk9iamVjdFR5cGVcbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBkYXRlIC0gTWlncmF0aW9uIHRpbWVzdGFtcCBwYXJzZWQgZnJvbSBmaWxlbmFtZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbZnVsbFBhdGhdIC0gQWJzb2x1dGUgcGF0aCB0byB0aGUgbWlncmF0aW9uIGZpbGUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gbWlncmF0aW9uQ2xhc3NOYW1lIC0gRXhwb3J0ZWQgbWlncmF0aW9uIGNsYXNzIG5hbWUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gZmlsZSAtIE1pZ3JhdGlvbiBmaWxlbmFtZS5cbiAqL1xuLyoqXG4gKiBUZXN0RGF0YWJhc2VBY2Nlc3NTY29wZVN0b3JhZ2UgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFRlc3REYXRhYmFzZUFjY2Vzc1Njb3BlU3RvcmFnZVxuICogQHByb3BlcnR5IHsoKSA9PiAoe3Jldm9rZWQ6IGJvb2xlYW59IHwgdW5kZWZpbmVkKX0gZ2V0U3RvcmUgLSBHZXRzIHRoZSBpbmhlcml0ZWQgc2NvcGUuXG4gKiBAcHJvcGVydHkgeyhzY29wZToge3Jldm9rZWQ6IGJvb2xlYW59IHwgdW5kZWZpbmVkLCBjYWxsYmFjazogKCkgPT4gUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4pID0+IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBydW4gLSBSdW5zIGluIHRoZSBzY29wZS5cbiAqL1xuXG5leHBvcnQgY2xhc3MgVGVzdERhdGFiYXNlQWNjZXNzUmV2b2tlZEVycm9yIGV4dGVuZHMgRXJyb3Ige31cblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzRW52aXJvbm1lbnRIYW5kbGVyQmFzZSB7XG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgY29uZmlndXJlZCBkYXRhYmFzZSBwb29sIHR5cGUgZm9yIHRoZSBjdXJyZW50IHJ1bnRpbWUgY29udGV4dC5cbiAgICogQnJvd3NlciBhbmQgb3JkaW5hcnkgc2VydmVyIGNvbnRleHRzIHJldGFpbiB0aGUgYXBwbGljYXRpb24gY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHt7Y29uZmlndXJlZFBvb2xUeXBlOiB0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcG9vbC9iYXNlLmpzXCIpLmRlZmF1bHQsIGRhdGFiYXNlSWRlbnRpZmllcjogc3RyaW5nfX0gYXJncyAtIENvbmZpZ3VyZWQgcG9vbCBhbmQgbG9naWNhbCBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcmV0dXJucyB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3Bvb2wvYmFzZS5qc1wiKS5kZWZhdWx0fSAtIFBvb2wgdHlwZSBmb3IgdGhpcyBjb250ZXh0LlxuICAgKi9cbiAgcmVzb2x2ZVRlc3RTaGFyZWRUcmFuc2FjdGlvblBvb2xUeXBlKHtjb25maWd1cmVkUG9vbFR5cGV9KSB7IHJldHVybiBjb25maWd1cmVkUG9vbFR5cGUgfVxuXG4gIC8qKlxuICAgKiBOb2RlIHRlc3QgcnVudGltZXMgbWF5IHJlcGxhY2UgYSBwaHlzaWNhbCBjaGlsZCBjb25uZWN0aW9uIHdpdGggYSBicm9rZXJcbiAgICogcHJveHkuIE90aGVyIGVudmlyb25tZW50cyBuZXZlciBwYXJ0aWNpcGF0ZSBpbiB0aGlzIHRlc3Qtb25seSBwcm90b2NvbC5cbiAgICogQHBhcmFtIHt7RHJpdmVyQ2xhc3M6IHR5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCwgY29uZmlnOiBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkRhdGFiYXNlQ29uZmlndXJhdGlvblR5cGUsIGNvbmZpZ3VyYXRpb246IGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdCwgZGF0YWJhc2VJZGVudGlmaWVyOiBzdHJpbmcsIHJldXNlS2V5Pzogc3RyaW5nfX0gX2FyZ3MgLSBDb25uZWN0aW9uIGRldGFpbHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkPn0gLSBPcHRpb25hbCBwcm94eS5cbiAgICovXG4gIGFzeW5jIGNyZWF0ZVRlc3RTaGFyZWRUcmFuc2FjdGlvbkNvbm5lY3Rpb24oX2FyZ3MpIHsgcmV0dXJuIHVuZGVmaW5lZCB9XG5cbiAgLyoqXG4gICAqIEdldHMgdGhlIGFjdGl2ZSBzaGFyZWQtdHJhbnNhY3Rpb24gY29vcmRpbmF0b3Igb3duZXIgZm9yIGEgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGNvbm5lY3Rpb24gLSBQYXJlbnQgcGh5c2ljYWwgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge3N5bWJvbCB8IHVuZGVmaW5lZH0gLSBBY3RpdmUgY29vcmRpbmF0b3Igb3duZXIuXG4gICAqL1xuICBnZXRTaGFyZWRUcmFuc2FjdGlvbkNvb3JkaW5hdG9yT3duZXIoY29ubmVjdGlvbikge1xuICAgIHJldHVybiB0aGlzLl9zaGFyZWRUcmFuc2FjdGlvbkNvb3JkaW5hdG9yT3duZXJTdG9yYWdlPy5nZXRTdG9yZSgpPy5nZXQoY29ubmVjdGlvbilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdvcmsgYXMgdGhlIGN1cnJlbnQgc2hhcmVkLXRyYW5zYWN0aW9uIGNvb3JkaW5hdG9yIG93bmVyLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge29iamVjdH0gY29ubmVjdGlvbiAtIFBhcmVudCBwaHlzaWNhbCBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N5bWJvbH0gb3duZXIgLSBDb29yZGluYXRvciBvd25lci5cbiAgICogQHBhcmFtIHsoKSA9PiBUfSBjYWxsYmFjayAtIE93bmVkIHdvcmsuXG4gICAqIEByZXR1cm5zIHtUfSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIHJ1bldpdGhTaGFyZWRUcmFuc2FjdGlvbkNvb3JkaW5hdG9yT3duZXIoY29ubmVjdGlvbiwgb3duZXIsIGNhbGxiYWNrKSB7XG4gICAgY29uc3Qgc3RvcmFnZSA9IHRoaXMuX3NoYXJlZFRyYW5zYWN0aW9uQ29vcmRpbmF0b3JPd25lclN0b3JhZ2VcblxuICAgIGlmICghc3RvcmFnZSkgcmV0dXJuIGNhbGxiYWNrKClcblxuICAgIGNvbnN0IG93bmVycyA9IG5ldyBNYXAoc3RvcmFnZS5nZXRTdG9yZSgpKVxuXG4gICAgb3duZXJzLnNldChjb25uZWN0aW9uLCBvd25lcilcbiAgICByZXR1cm4gc3RvcmFnZS5ydW4ob3duZXJzLCBjYWxsYmFjaylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdvcmsgd2l0aG91dCBpbmhlcml0ZWQgc2hhcmVkLXRyYW5zYWN0aW9uIG93bmVyc2hpcCBmb3Igb25lIGNvbm5lY3Rpb24uXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGNvbm5lY3Rpb24gLSBQaHlzaWNhbCBjb25uZWN0aW9uIHdob3NlIG93bmVyIGlzIGNsZWFyZWQuXG4gICAqIEBwYXJhbSB7KCkgPT4gVH0gY2FsbGJhY2sgLSBQaHlzaWNhbCBjb25uZWN0aW9uIHdvcmsuXG4gICAqIEByZXR1cm5zIHtUfSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIHJ1bldpdGhvdXRTaGFyZWRUcmFuc2FjdGlvbkNvb3JkaW5hdG9yT3duZXIoY29ubmVjdGlvbiwgY2FsbGJhY2spIHtcbiAgICBjb25zdCBzdG9yYWdlID0gdGhpcy5fc2hhcmVkVHJhbnNhY3Rpb25Db29yZGluYXRvck93bmVyU3RvcmFnZVxuXG4gICAgaWYgKCFzdG9yYWdlKSByZXR1cm4gY2FsbGJhY2soKVxuXG4gICAgY29uc3Qgb3duZXJzID0gbmV3IE1hcChzdG9yYWdlLmdldFN0b3JlKCkpXG5cbiAgICBvd25lcnMuZGVsZXRlKGNvbm5lY3Rpb24pXG4gICAgcmV0dXJuIHN0b3JhZ2UucnVuKG93bmVycywgY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogUnVucyB3b3JrIHdpdGhvdXQgaW5oZXJpdGVkIHNoYXJlZC10cmFuc2FjdGlvbiBjb29yZGluYXRvciBvd25lcnNoaXAuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7KCkgPT4gVH0gY2FsbGJhY2sgLSBEZXRhY2hlZCB3b3JrLlxuICAgKiBAcmV0dXJucyB7VH0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBydW5XaXRob3V0U2hhcmVkVHJhbnNhY3Rpb25Db29yZGluYXRvck93bmVycyhjYWxsYmFjaykge1xuICAgIGNvbnN0IHN0b3JhZ2UgPSB0aGlzLl9zaGFyZWRUcmFuc2FjdGlvbkNvb3JkaW5hdG9yT3duZXJTdG9yYWdlXG5cbiAgICBpZiAoIXN0b3JhZ2UpIHJldHVybiBjYWxsYmFjaygpXG5cbiAgICByZXR1cm4gc3RvcmFnZS5ydW4obmV3IE1hcCgpLCBjYWxsYmFjaylcbiAgfVxuXG4gIC8qKlxuICAgKiBJbnN0YWxscyBhc3luYy1jb250ZXh0IHN0b3JhZ2Ugd2hlbiB0aGlzIGhhbmRsZXIgaXMgZHJpdmVuIGJ5IHRoZSBOb2RlIHRlc3QgcnVubmVyLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIm5vZGU6YXN5bmNfaG9va3NcIikuQXN5bmNMb2NhbFN0b3JhZ2U8TWFwPG9iamVjdCwgc3ltYm9sPj59IHN0b3JhZ2UgLSBDb29yZGluYXRvciBvd25lciBzdG9yYWdlLlxuICAgKi9cbiAgaW5zdGFsbFNoYXJlZFRyYW5zYWN0aW9uQ29vcmRpbmF0b3JPd25lclN0b3JhZ2Uoc3RvcmFnZSkge1xuICAgIHRoaXMuX3NoYXJlZFRyYW5zYWN0aW9uQ29vcmRpbmF0b3JPd25lclN0b3JhZ2UgPz89IHN0b3JhZ2VcbiAgfVxuXG4gIC8qKiBAdHlwZSB7aW1wb3J0KFwibm9kZTphc3luY19ob29rc1wiKS5Bc3luY0xvY2FsU3RvcmFnZTxNYXA8b2JqZWN0LCBzeW1ib2w+PiB8IHVuZGVmaW5lZH0gKi9cbiAgX3NoYXJlZFRyYW5zYWN0aW9uQ29vcmRpbmF0b3JPd25lclN0b3JhZ2UgPSB1bmRlZmluZWRcblxuICAvKipcbiAgICogUnVucyB3b3JrIHdpdGggdGVzdC1wcm9maWxlIGF0dHJpYnV0aW9uLiBSdW50aW1lcyB3aXRob3V0IGFzeW5jLWNvbnRleHRcbiAgICogc3RvcmFnZSBleGVjdXRlIHRoZSBjYWxsYmFjayB3aXRob3V0IGluc3RhbGxpbmcgYW1iaWVudCBhdHRyaWJ1dGlvbi5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi90ZXN0aW5nL3Rlc3QtcHJvZmlsZXIuanNcIikuVGVzdFByb2ZpbGVBc3luY0NvbnRleHQgfCB1bmRlZmluZWR9IF9jb250ZXh0IC0gQ2FwdHVyZWQgcHJvZmlsZSBjb250ZXh0LCBvciBhbiBleHBsaWNpdCBhYnNlbmNlIG9mIGF0dHJpYnV0aW9uLlxuICAgKiBAcGFyYW0geygpID0+IFR9IGNhbGxiYWNrIC0gUHJvZmlsZWQgd29yay5cbiAgICogQHJldHVybnMge1R9IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgcnVuV2l0aFRlc3RQcm9maWxlQ29udGV4dChfY29udGV4dCwgY2FsbGJhY2spIHsgcmV0dXJuIGNhbGxiYWNrKCkgfVxuXG4gIC8qKlxuICAgKiBHZXRzIHRoZSBjdXJyZW50IHRlc3QtcHJvZmlsZSBhdHRyaWJ1dGlvbiBjb250ZXh0LlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vdGVzdGluZy90ZXN0LXByb2ZpbGVyLmpzXCIpLlRlc3RQcm9maWxlQXN5bmNDb250ZXh0IHwgdW5kZWZpbmVkfSAtIEFjdGl2ZSBjb250ZXh0LlxuICAgKi9cbiAgZ2V0Q3VycmVudFRlc3RQcm9maWxlQ29udGV4dCgpIHsgcmV0dXJuIHVuZGVmaW5lZCB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd29yayBpbiBhIHJldm9jYWJsZSB0ZXN0IGRhdGFiYXNlLWFjY2VzcyBzY29wZS5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHt7cmV2b2tlZDogYm9vbGVhbn19IHNjb3BlIC0gQXR0ZW1wdC1vd25lZCBhY2Nlc3Mgc2NvcGUuXG4gICAqIEBwYXJhbSB7KCkgPT4gVCB8IFByb21pc2U8VD59IGNhbGxiYWNrIC0gQXR0ZW1wdCB3b3JrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBydW5XaXRoVGVzdERhdGFiYXNlQWNjZXNzU2NvcGUoc2NvcGUsIGNhbGxiYWNrKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMucnVuV2l0aENhcHR1cmVkVGVzdERhdGFiYXNlQWNjZXNzU2NvcGUoc2NvcGUsIGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd29yayB3aXRoIGFuIGV4cGxpY2l0bHkgY2FwdHVyZWQgdGVzdCBkYXRhYmFzZS1hY2Nlc3Mgc2NvcGUuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7e3Jldm9rZWQ6IGJvb2xlYW59IHwgdW5kZWZpbmVkfSBzY29wZSAtIENhcHR1cmVkIGFjY2VzcyBzY29wZS5cbiAgICogQHBhcmFtIHsoKSA9PiBUIHwgUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBXb3JrIHRvIHJ1bi5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgcnVuV2l0aENhcHR1cmVkVGVzdERhdGFiYXNlQWNjZXNzU2NvcGUoc2NvcGUsIGNhbGxiYWNrKSB7XG4gICAgaWYgKHRoaXMuX3Rlc3REYXRhYmFzZUFjY2Vzc1Njb3BlU3RvcmFnZSkge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuX3Rlc3REYXRhYmFzZUFjY2Vzc1Njb3BlU3RvcmFnZS5ydW4oc2NvcGUsIGNhbGxiYWNrKVxuICAgIH1cblxuICAgIGNvbnN0IGVudHJ5ID0ge293bmVyOiBTeW1ib2woXCJ0ZXN0LWRhdGFiYXNlLWFjY2Vzcy1zY29wZVwiKSwgc2NvcGV9XG5cbiAgICB0aGlzLl90ZXN0RGF0YWJhc2VBY2Nlc3NTY29wZXMucHVzaChlbnRyeSlcblxuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soKVxuICAgIH0gZmluYWxseSB7XG4gICAgICBjb25zdCBpbmRleCA9IHRoaXMuX3Rlc3REYXRhYmFzZUFjY2Vzc1Njb3Blcy5maW5kSW5kZXgoKGNhbmRpZGF0ZSkgPT4gY2FuZGlkYXRlLm93bmVyID09PSBlbnRyeS5vd25lcilcblxuICAgICAgaWYgKGluZGV4ICE9PSAtMSkgdGhpcy5fdGVzdERhdGFiYXNlQWNjZXNzU2NvcGVzLnNwbGljZShpbmRleCwgMSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogR2V0cyB0aGUgY3VycmVudCB0ZXN0IGRhdGFiYXNlLWFjY2VzcyBzY29wZS5cbiAgICogQHJldHVybnMge3tyZXZva2VkOiBib29sZWFufSB8IHVuZGVmaW5lZH0gLSBDdXJyZW50IHNjb3BlLlxuICAgKi9cbiAgY3VycmVudFRlc3REYXRhYmFzZUFjY2Vzc1Njb3BlKCkge1xuICAgIGlmICh0aGlzLl90ZXN0RGF0YWJhc2VBY2Nlc3NTY29wZVN0b3JhZ2UpIHJldHVybiB0aGlzLl90ZXN0RGF0YWJhc2VBY2Nlc3NTY29wZVN0b3JhZ2UuZ2V0U3RvcmUoKVxuXG4gICAgcmV0dXJuIHRoaXMuX3Rlc3REYXRhYmFzZUFjY2Vzc1Njb3Blc1t0aGlzLl90ZXN0RGF0YWJhc2VBY2Nlc3NTY29wZXMubGVuZ3RoIC0gMV0/LnNjb3BlXG4gIH1cblxuICAvKiogVGhyb3dzIHdoZW4gdGhlIGN1cnJlbnQgdGVzdCBhdHRlbXB0IG5vIGxvbmdlciBvd25zIGRhdGFiYXNlIGFjY2Vzcy4gKi9cbiAgYXNzZXJ0VGVzdERhdGFiYXNlQWNjZXNzQWxsb3dlZCgpIHtcbiAgICBjb25zdCBzY29wZSA9IHRoaXMuY3VycmVudFRlc3REYXRhYmFzZUFjY2Vzc1Njb3BlKClcblxuICAgIGlmIChzY29wZT8ucmV2b2tlZCkge1xuICAgICAgdGhyb3cgbmV3IFRlc3REYXRhYmFzZUFjY2Vzc1Jldm9rZWRFcnJvcihcIkRhdGFiYXNlIGFjY2VzcyBpcyBubyBsb25nZXIgYWxsb3dlZCBmb3IgdGhpcyB0ZXN0IGF0dGVtcHRcIilcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogSW5zdGFsbHMgYXN5bmMtY29udGV4dCBzdG9yYWdlIG93bmVkIGJ5IHRoZSBmaXJzdCBOb2RlIHRlc3QgcnVubmVyLlxuICAgKiBAcGFyYW0ge1Rlc3REYXRhYmFzZUFjY2Vzc1Njb3BlU3RvcmFnZX0gc3RvcmFnZSAtIFNjb3BlIHN0b3JhZ2UuXG4gICAqL1xuICBpbnN0YWxsVGVzdERhdGFiYXNlQWNjZXNzU2NvcGVTdG9yYWdlKHN0b3JhZ2UpIHtcbiAgICB0aGlzLl90ZXN0RGF0YWJhc2VBY2Nlc3NTY29wZVN0b3JhZ2UgPz89IHN0b3JhZ2VcbiAgfVxuXG4gIC8qKiBAdHlwZSB7QXJyYXk8e293bmVyOiBzeW1ib2wsIHNjb3BlOiB7cmV2b2tlZDogYm9vbGVhbn0gfCB1bmRlZmluZWR9Pn0gKi9cbiAgX3Rlc3REYXRhYmFzZUFjY2Vzc1Njb3BlcyA9IFtdXG5cbiAgLyoqIEB0eXBlIHtUZXN0RGF0YWJhc2VBY2Nlc3NTY29wZVN0b3JhZ2UgfCB1bmRlZmluZWR9ICovXG4gIF90ZXN0RGF0YWJhc2VBY2Nlc3NTY29wZVN0b3JhZ2UgPSB1bmRlZmluZWRcblxuICAvKipcbiAgICogTXV0YWJsZSBhbWJpZW50IHRlbmFudCB1c2VkIGJ5IHJ1bnRpbWVzIHdpdGhvdXQgYXN5bmMtY29udGV4dCBzdG9yYWdlLlxuICAgKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4gfCB1bmRlZmluZWR9XG4gICAqL1xuICBfY3VycmVudFRlbmFudCA9IHVuZGVmaW5lZFxuXG4gIC8qKlxuICAgKiBBY3RpdmUgYW1iaWVudCBzY29wZXMgaW4gc3RhcnQgb3JkZXIuIFRoaXMgcHJldmVudHMgYSBzY29wZSB0aGF0IGNvbXBsZXRlc1xuICAgKiBvdXQgb2Ygb3JkZXIgZnJvbSByZXN0b3JpbmcgYSB0ZW5hbnQgYmVsb25naW5nIHRvIGFuIGFscmVhZHktY29tcGxldGVkIHNjb3BlLlxuICAgKiBBbWJpZW50IHJlYWRzIGFyZSBzdGlsbCBzaGFyZWQgaW4gYnJvd3NlciBydW50aW1lczsgaW1tdXRhYmxlIGhhbmRsZXMgcmVtYWluXG4gICAqIHRoZSBjb25jdXJyZW5jeS1zYWZlIGRhdGFiYXNlIEFQSS5cbiAgICogQHR5cGUge0FycmF5PHtvd25lcjogc3ltYm9sLCB0ZW5hbnQ6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fT59XG4gICAqL1xuICBfdGVuYW50U2NvcGVzID0gW11cblxuICAvKipcbiAgICogUnVucyBkZWJ1ZyBlbmRwb2ludCB0b2tlbiBtYXRjaGVzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcHJvdmlkZWRUb2tlbiAtIFRva2VuIGZyb20gdGhlIHJlcXVlc3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBleHBlY3RlZFRva2VuIC0gQ29uZmlndXJlZCB0b2tlbi5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBib3RoIHRva2VucyBtYXRjaC5cbiAgICovXG4gIGRlYnVnRW5kcG9pbnRUb2tlbk1hdGNoZXMocHJvdmlkZWRUb2tlbiwgZXhwZWN0ZWRUb2tlbikge1xuICAgIGxldCBkaWZmZXJlbmNlID0gcHJvdmlkZWRUb2tlbi5sZW5ndGggXiBleHBlY3RlZFRva2VuLmxlbmd0aFxuICAgIGNvbnN0IG1heExlbmd0aCA9IE1hdGgubWF4KHByb3ZpZGVkVG9rZW4ubGVuZ3RoLCBleHBlY3RlZFRva2VuLmxlbmd0aClcblxuICAgIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBtYXhMZW5ndGg7IGluZGV4KyspIHtcbiAgICAgIGRpZmZlcmVuY2UgfD0gKHByb3ZpZGVkVG9rZW4uY2hhckNvZGVBdChpbmRleCkgfHwgMCkgXiAoZXhwZWN0ZWRUb2tlbi5jaGFyQ29kZUF0KGluZGV4KSB8fCAwKVxuICAgIH1cblxuICAgIHJldHVybiBkaWZmZXJlbmNlID09PSAwXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZnJhbWV3b3JrIHNvdXJjZSBkaXJlY3RvcnkuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gVmVsb2Npb3VzIHNvdXJjZSBkaXJlY3RvcnkgdXNlZCB0byBmaWx0ZXIgZnJhbWV3b3JrIHN0YWNrIGZyYW1lcy5cbiAgICovXG4gIGdldEZyYW1ld29ya1NvdXJjZURpcmVjdG9yeSgpIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogQXV0by1kaXNjb3ZlcnMgcmVzb3VyY2UgY2xhc3Nlcy4gTm8tb3AgaW4gYmFzZSBoYW5kbGVyOyBvdmVycmlkZGVuIGluIE5vZGUgaGFuZGxlci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IF9jb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBhdXRvRGlzY292ZXJSZXNvdXJjZXMoX2NvbmZpZ3VyYXRpb24pIHt9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcnVuIHdpdGggdGltZXpvbmUgb2Zmc2V0LlxuICAgKiBAcGFyYW0ge251bWJlcn0gX29mZnNldE1pbnV0ZXMgLSBPZmZzZXQgaW4gbWludXRlcyAoRGF0ZSNnZXRUaW1lem9uZU9mZnNldCkuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgdG8gcnVuLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzdWx0IG9mIHRoZSBjYWxsYmFjay5cbiAgICovXG4gIGFzeW5jIHJ1bldpdGhUaW1lem9uZU9mZnNldChfb2Zmc2V0TWludXRlcywgY2FsbGJhY2spIHtcbiAgICBpZiAoIXRoaXMuY29uZmlndXJhdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiQ29uZmlndXJhdGlvbiBoYXNuJ3QgYmVlbiBzZXRcIilcblxuICAgIGNvbnN0IHByZXZpb3VzT2Zmc2V0TWludXRlcyA9IHRoaXMuY29uZmlndXJhdGlvbi5fdGltZXpvbmVPZmZzZXRNaW51dGVzXG5cbiAgICB0aGlzLmNvbmZpZ3VyYXRpb24uX3RpbWV6b25lT2Zmc2V0TWludXRlcyA9IF9vZmZzZXRNaW51dGVzXG5cbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKClcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdGhpcy5jb25maWd1cmF0aW9uLl90aW1lem9uZU9mZnNldE1pbnV0ZXMgPSBwcmV2aW91c09mZnNldE1pbnV0ZXNcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBydW4gd2l0aCB0aW1lem9uZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRpbWVab25lIC0gSUFOQSB0aW1lem9uZSBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjYWxsYmFjayAtIENhbGxiYWNrIHRvIHJ1bi5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc3VsdCBvZiB0aGUgY2FsbGJhY2suXG4gICAqL1xuICBhc3luYyBydW5XaXRoVGltZXpvbmUodGltZVpvbmUsIGNhbGxiYWNrKSB7XG4gICAgaWYgKCF0aGlzLmNvbmZpZ3VyYXRpb24pIHRocm93IG5ldyBFcnJvcihcIkNvbmZpZ3VyYXRpb24gaGFzbid0IGJlZW4gc2V0XCIpXG5cbiAgICBjb25zdCBwcmV2aW91c1RpbWVab25lID0gdGhpcy5jb25maWd1cmF0aW9uLl90aW1lWm9uZVxuXG4gICAgdGhpcy5jb25maWd1cmF0aW9uLl90aW1lWm9uZSA9IHZhbGlkYXRlVGltZVpvbmUodGltZVpvbmUsIFwidGltZVpvbmVcIilcblxuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soKVxuICAgIH0gZmluYWxseSB7XG4gICAgICB0aGlzLmNvbmZpZ3VyYXRpb24uX3RpbWVab25lID0gcHJldmlvdXNUaW1lWm9uZVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCB0aW1lem9uZSBvZmZzZXQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBfb2Zmc2V0TWludXRlcyAtIE9mZnNldCBpbiBtaW51dGVzIChEYXRlI2dldFRpbWV6b25lT2Zmc2V0KS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0VGltZXpvbmVPZmZzZXQoX29mZnNldE1pbnV0ZXMpIHtcbiAgICBpZiAoIXRoaXMuY29uZmlndXJhdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiQ29uZmlndXJhdGlvbiBoYXNuJ3QgYmVlbiBzZXRcIilcblxuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7bnVtYmVyfSAqL1xuICAgIHRoaXMuY29uZmlndXJhdGlvbi5fdGltZXpvbmVPZmZzZXRNaW51dGVzID0gX29mZnNldE1pbnV0ZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCB0aW1lem9uZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRpbWVab25lIC0gSUFOQSB0aW1lem9uZSBpZGVudGlmaWVyLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRUaW1lem9uZSh0aW1lWm9uZSkge1xuICAgIGlmICghdGhpcy5jb25maWd1cmF0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJDb25maWd1cmF0aW9uIGhhc24ndCBiZWVuIHNldFwiKVxuXG4gICAgdGhpcy5jb25maWd1cmF0aW9uLl90aW1lWm9uZSA9IHZhbGlkYXRlVGltZVpvbmUodGltZVpvbmUsIFwidGltZVpvbmVcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0aW1lem9uZSBvZmZzZXQgbWludXRlcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IGNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIE9mZnNldCBpbiBtaW51dGVzLlxuICAgKi9cbiAgZ2V0VGltZXpvbmVPZmZzZXRNaW51dGVzKGNvbmZpZ3VyYXRpb24pIHtcbiAgICBjb25zdCBhY3RpdmVDb25maWd1cmF0aW9uID0gY29uZmlndXJhdGlvbiB8fCB0aGlzLmNvbmZpZ3VyYXRpb25cblxuICAgIGlmICghYWN0aXZlQ29uZmlndXJhdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiQ29uZmlndXJhdGlvbiBoYXNuJ3QgYmVlbiBzZXRcIilcblxuICAgIGlmICh0eXBlb2YgYWN0aXZlQ29uZmlndXJhdGlvbi5fdGltZXpvbmVPZmZzZXRNaW51dGVzID09PSBcIm51bWJlclwiKSB7XG4gICAgICByZXR1cm4gYWN0aXZlQ29uZmlndXJhdGlvbi5fdGltZXpvbmVPZmZzZXRNaW51dGVzXG4gICAgfVxuXG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7bnVtYmVyfSAqLyAoYWN0aXZlQ29uZmlndXJhdGlvbi5nZXRUaW1lem9uZU9mZnNldE1pbnV0ZXMoKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0aW1lem9uZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IGNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSAtIFRpbWV6b25lIGlkZW50aWZpZXIuXG4gICAqL1xuICBnZXRUaW1lWm9uZShjb25maWd1cmF0aW9uKSB7XG4gICAgY29uc3QgYWN0aXZlQ29uZmlndXJhdGlvbiA9IGNvbmZpZ3VyYXRpb24gfHwgdGhpcy5jb25maWd1cmF0aW9uXG5cbiAgICBpZiAoIWFjdGl2ZUNvbmZpZ3VyYXRpb24pIHRocm93IG5ldyBFcnJvcihcIkNvbmZpZ3VyYXRpb24gaGFzbid0IGJlZW4gc2V0XCIpXG5cbiAgICByZXR1cm4gYWN0aXZlQ29uZmlndXJhdGlvbi5nZXRUaW1lWm9uZSgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBydW4gd2l0aCByZXF1ZXN0IHRpbWluZy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9odHRwLXNlcnZlci9jbGllbnQvcmVxdWVzdC10aW1pbmcuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gcmVxdWVzdFRpbWluZyAtIFJlcXVlc3QgdGltaW5nIGNvbGxlY3Rvci5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY2FsbGJhY2sgLSBDYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHJ1bldpdGhSZXF1ZXN0VGltaW5nKHJlcXVlc3RUaW1pbmcsIGNhbGxiYWNrKSB7XG4gICAgdGhpcy5fY3VycmVudFJlcXVlc3RUaW1pbmcgPSByZXF1ZXN0VGltaW5nXG5cbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKClcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdGhpcy5fY3VycmVudFJlcXVlc3RUaW1pbmcgPSB1bmRlZmluZWRcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgY3VycmVudCByZXF1ZXN0IHRpbWluZy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2h0dHAtc2VydmVyL2NsaWVudC9yZXF1ZXN0LXRpbWluZy5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAtIEN1cnJlbnQgcmVxdWVzdCB0aW1pbmcgY29sbGVjdG9yLlxuICAgKi9cbiAgZ2V0Q3VycmVudFJlcXVlc3RUaW1pbmcoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2N1cnJlbnRSZXF1ZXN0VGltaW5nXG4gIH1cblxuICAvKipcbiAgICogUnVucyBydW4gd2l0aCBhYmlsaXR5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSBhYmlsaXR5IC0gQWJpbGl0eSB0byBzZXQgZm9yIGNhbGxiYWNrIHNjb3BlLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjYWxsYmFjayAtIENhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgcnVuV2l0aEFiaWxpdHkoYWJpbGl0eSwgY2FsbGJhY2spIHtcbiAgICB0aGlzLl9jdXJyZW50QWJpbGl0eSA9IGFiaWxpdHlcblxuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soKVxuICAgIH0gZmluYWxseSB7XG4gICAgICB0aGlzLl9jdXJyZW50QWJpbGl0eSA9IHVuZGVmaW5lZFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBjdXJyZW50IGFiaWxpdHkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IGFiaWxpdHkgLSBBYmlsaXR5IHRvIHNldC5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0Q3VycmVudEFiaWxpdHkoYWJpbGl0eSkge1xuICAgIHRoaXMuX2N1cnJlbnRBYmlsaXR5ID0gYWJpbGl0eVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGN1cnJlbnQgYWJpbGl0eS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAtIEN1cnJlbnQgYWJpbGl0eS5cbiAgICovXG4gIGdldEN1cnJlbnRBYmlsaXR5KCkge1xuICAgIHJldHVybiB0aGlzLl9jdXJyZW50QWJpbGl0eVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcnVuIHdpdGggdGVuYW50LlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB0ZW5hbnQgLSBUZW5hbnQgdG8gc2V0IGZvciBjYWxsYmFjayBzY29wZS5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY2FsbGJhY2sgLSBDYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHJ1bldpdGhUZW5hbnQodGVuYW50LCBjYWxsYmFjaykge1xuICAgIGNvbnN0IHNjb3BlID0ge293bmVyOiBTeW1ib2woXCJicm93c2VyLXRlbmFudC1zY29wZVwiKSwgdGVuYW50fVxuXG4gICAgdGhpcy5fdGVuYW50U2NvcGVzLnB1c2goc2NvcGUpXG5cbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKClcbiAgICB9IGZpbmFsbHkge1xuICAgICAgY29uc3Qgc2NvcGVJbmRleCA9IHRoaXMuX3RlbmFudFNjb3Blcy5maW5kSW5kZXgoKGNhbmRpZGF0ZSkgPT4gY2FuZGlkYXRlLm93bmVyID09PSBzY29wZS5vd25lcilcblxuICAgICAgaWYgKHNjb3BlSW5kZXggIT09IC0xKSB0aGlzLl90ZW5hbnRTY29wZXMuc3BsaWNlKHNjb3BlSW5kZXgsIDEpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGN1cnJlbnQgdGVuYW50LlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB0ZW5hbnQgLSBUZW5hbnQgdG8gc2V0LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRDdXJyZW50VGVuYW50KHRlbmFudCkge1xuICAgIHRoaXMuX2N1cnJlbnRUZW5hbnQgPSB0ZW5hbnRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBjdXJyZW50IHRlbmFudC5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIEN1cnJlbnQgdGVuYW50LlxuICAgKi9cbiAgZ2V0Q3VycmVudFRlbmFudCgpIHtcbiAgICByZXR1cm4gdGhpcy5fdGVuYW50U2NvcGVzW3RoaXMuX3RlbmFudFNjb3Blcy5sZW5ndGggLSAxXT8udGVuYW50ID8/IHRoaXMuX2N1cnJlbnRUZW5hbnRcbiAgfVxuICAvKipcbiAgICogUnVucyBjbGkgY29tbWFuZHMgZ2VuZXJhdGUgYmFzZSBtb2RlbHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiKS5kZWZhdWx0fSBfY29tbWFuZCAtIENvbW1hbmQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjb21tYW5kIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGNsaUNvbW1hbmRzR2VuZXJhdGVCYXNlTW9kZWxzKF9jb21tYW5kKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiY2xpQ29tbWFuZHNHZW5lcmF0ZUJhc2VNb2RlbHMgbm90IGltcGxlbWVudGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGkgY29tbWFuZHMgZ2VuZXJhdGUgZnJvbnRlbmQgbW9kZWxzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NsaS9iYXNlLWNvbW1hbmQuanNcIikuZGVmYXVsdH0gX2NvbW1hbmQgLSBDb21tYW5kLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY29tbWFuZCByZXN1bHQuXG4gICAqL1xuICBhc3luYyBjbGlDb21tYW5kc0dlbmVyYXRlRnJvbnRlbmRNb2RlbHMoX2NvbW1hbmQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJjbGlDb21tYW5kc0dlbmVyYXRlRnJvbnRlbmRNb2RlbHMgbm90IGltcGxlbWVudGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGkgY29tbWFuZHMgaW5pdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jbGkvYmFzZS1jb21tYW5kLmpzXCIpLmRlZmF1bHR9IGNvbW1hbmQgLSBDb21tYW5kLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY29tbWFuZCByZXN1bHQuXG4gICAqL1xuICBhc3luYyBjbGlDb21tYW5kc0luaXQoY29tbWFuZCkgeyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIG5vLXVudXNlZC12YXJzXG4gICAgdGhyb3cgbmV3IEVycm9yKFwiY2xpQ29tbWFuZHNJbml0IG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xpIGNvbW1hbmRzIG1pZ3JhdGlvbiBnZW5lcmF0ZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jbGkvYmFzZS1jb21tYW5kLmpzXCIpLmRlZmF1bHR9IF9jb21tYW5kIC0gQ29tbWFuZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNvbW1hbmQgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgY2xpQ29tbWFuZHNNaWdyYXRpb25HZW5lcmF0ZShfY29tbWFuZCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcImNsaUNvbW1hbmRzTWlncmF0aW9uR2VuZXJhdGUgbm90IGltcGxlbWVudGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGkgY29tbWFuZHMgbWlncmF0aW9uIGRlc3Ryb3kuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiKS5kZWZhdWx0fSBfY29tbWFuZCAtIENvbW1hbmQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjb21tYW5kIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGNsaUNvbW1hbmRzTWlncmF0aW9uRGVzdHJveShfY29tbWFuZCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcImNsaUNvbW1hbmRzTWlncmF0aW9uRGVzdHJveSBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsaSBjb21tYW5kcyBnZW5lcmF0ZSBtb2RlbC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jbGkvYmFzZS1jb21tYW5kLmpzXCIpLmRlZmF1bHR9IF9jb21tYW5kIC0gQ29tbWFuZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNvbW1hbmQgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgY2xpQ29tbWFuZHNHZW5lcmF0ZU1vZGVsKF9jb21tYW5kKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiY2xpQ29tbWFuZHNHZW5lcmF0ZU1vZGVsIG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xpIGNvbW1hbmRzIGxpbnQgcmVsYXRpb25zaGlwcy5cbiAgICogQGFic3RyYWN0XG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiKS5kZWZhdWx0fSBfY29tbWFuZCAtIENvbW1hbmQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjb21tYW5kIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGNsaUNvbW1hbmRzTGludFJlbGF0aW9uc2hpcHMoX2NvbW1hbmQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJjbGlDb21tYW5kc0xpbnRSZWxhdGlvbnNoaXBzIG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xpIGNvbW1hbmRzIHJvdXRlcy5cbiAgICogQGFic3RyYWN0XG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiKS5kZWZhdWx0fSBfY29tbWFuZCAtIENvbW1hbmQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjb21tYW5kIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGNsaUNvbW1hbmRzUm91dGVzKF9jb21tYW5kKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiY2xpQ29tbWFuZHNSb3V0ZXMgbm90IGltcGxlbWVudGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGkgY29tbWFuZHMgY29uc29sZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jbGkvYmFzZS1jb21tYW5kLmpzXCIpLmRlZmF1bHR9IF9jb21tYW5kIC0gQ29tbWFuZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNvbW1hbmQgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgY2xpQ29tbWFuZHNDb25zb2xlKF9jb21tYW5kKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiY2xpQ29tbWFuZHNDb25zb2xlIG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xpIGNvbW1hbmRzIG1jcC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jbGkvYmFzZS1jb21tYW5kLmpzXCIpLmRlZmF1bHR9IF9jb21tYW5kIC0gQ29tbWFuZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgY29tbWFuZCBjb21wbGV0ZXMuXG4gICAqL1xuICBhc3luYyBjbGlDb21tYW5kc01jcChfY29tbWFuZCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcImNsaUNvbW1hbmRzTWNwIG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xpIGNvbW1hbmRzIHNlcnZlci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jbGkvYmFzZS1jb21tYW5kLmpzXCIpLmRlZmF1bHR9IF9jb21tYW5kIC0gQ29tbWFuZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNvbW1hbmQgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgY2xpQ29tbWFuZHNTZXJ2ZXIoX2NvbW1hbmQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJjbGlDb21tYW5kc1NlcnZlciBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsaSBjb21tYW5kcyB0ZXN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NsaS9iYXNlLWNvbW1hbmQuanNcIikuZGVmYXVsdH0gX2NvbW1hbmQgLSBDb21tYW5kLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY29tbWFuZCByZXN1bHQuXG4gICAqL1xuICBhc3luYyBjbGlDb21tYW5kc1Rlc3QoX2NvbW1hbmQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJjbGlDb21tYW5kc1Rlc3Qgbm90IGltcGxlbWVudGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGkgY29tbWFuZHMgdGVzdCB0aW1pbmcgbWFuaWZlc3QgbWVyZ2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiKS5kZWZhdWx0fSBfY29tbWFuZCAtIENvbW1hbmQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjb21tYW5kIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGNsaUNvbW1hbmRzVGVzdFRpbWluZ01hbmlmZXN0TWVyZ2UoX2NvbW1hbmQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJjbGlDb21tYW5kc1Rlc3RUaW1pbmdNYW5pZmVzdE1lcmdlIG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xpIGNvbW1hbmRzIGJhY2tncm91bmQgam9icyBtYWluLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NsaS9iYXNlLWNvbW1hbmQuanNcIikuZGVmYXVsdH0gX2NvbW1hbmQgLSBDb21tYW5kLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY29tbWFuZCByZXN1bHQuXG4gICAqL1xuICBhc3luYyBjbGlDb21tYW5kc0JhY2tncm91bmRKb2JzTWFpbihfY29tbWFuZCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcImNsaUNvbW1hbmRzQmFja2dyb3VuZEpvYnNNYWluIG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgQ0xJIGJhY2tncm91bmQtam9icyBhY3RpdmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NsaS9iYXNlLWNvbW1hbmQuanNcIikuZGVmYXVsdH0gX2NvbW1hbmQgLSBDb21tYW5kLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgY2xpQ29tbWFuZHNCYWNrZ3JvdW5kSm9ic0FjdGl2YXRlKF9jb21tYW5kKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiY2xpQ29tbWFuZHNCYWNrZ3JvdW5kSm9ic0FjdGl2YXRlIG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgQ0xJIGJhY2tncm91bmQtam9icyByZXRpcmVtZW50LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NsaS9iYXNlLWNvbW1hbmQuanNcIikuZGVmYXVsdH0gX2NvbW1hbmQgLSBDb21tYW5kLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgY2xpQ29tbWFuZHNCYWNrZ3JvdW5kSm9ic1JldGlyZShfY29tbWFuZCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcImNsaUNvbW1hbmRzQmFja2dyb3VuZEpvYnNSZXRpcmUgbm90IGltcGxlbWVudGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGkgY29tbWFuZHMgYmFja2dyb3VuZCBqb2JzIHdvcmtlci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jbGkvYmFzZS1jb21tYW5kLmpzXCIpLmRlZmF1bHR9IF9jb21tYW5kIC0gQ29tbWFuZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNvbW1hbmQgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgY2xpQ29tbWFuZHNCYWNrZ3JvdW5kSm9ic1dvcmtlcihfY29tbWFuZCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcImNsaUNvbW1hbmRzQmFja2dyb3VuZEpvYnNXb3JrZXIgbm90IGltcGxlbWVudGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGkgY29tbWFuZHMgYmFja2dyb3VuZCBqb2JzIHJ1bm5lci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jbGkvYmFzZS1jb21tYW5kLmpzXCIpLmRlZmF1bHR9IF9jb21tYW5kIC0gQ29tbWFuZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNvbW1hbmQgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgY2xpQ29tbWFuZHNCYWNrZ3JvdW5kSm9ic1J1bm5lcihfY29tbWFuZCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcImNsaUNvbW1hbmRzQmFja2dyb3VuZEpvYnNSdW5uZXIgbm90IGltcGxlbWVudGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGkgY29tbWFuZHMgYmVhY29uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NsaS9iYXNlLWNvbW1hbmQuanNcIikuZGVmYXVsdH0gX2NvbW1hbmQgLSBDb21tYW5kLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY29tbWFuZCByZXN1bHQuXG4gICAqL1xuICBhc3luYyBjbGlDb21tYW5kc0JlYWNvbihfY29tbWFuZCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcImNsaUNvbW1hbmRzQmVhY29uIG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIExvYWRzIHRoZSBUQ1AtYmFja2VkIEJlYWNvbiBjbGllbnQgY2xhc3MuIFJvdXRlZCB0aHJvdWdoIHRoZVxuICAgKiBlbnZpcm9ubWVudCBoYW5kbGVyIHNvIHRoZSBkeW5hbWljIGBpbXBvcnQoXCIuLi9iZWFjb24vY2xpZW50LmpzXCIpYFxuICAgKiBjYWxsIGxpdmVzIG9uIHRoZSBOb2RlLW9ubHkgcGF0aCDigJQga2VlcHMgQmVhY29uJ3MgYG5vZGU6bmV0YCAvXG4gICAqIGBub2RlOmNyeXB0b2AgZGVwcyBvdXQgb2YgYnJvd3NlciBidW5kbGVzIHRoYXQgc3RhdGljYWxseSByZWFjaFxuICAgKiBgQ29uZmlndXJhdGlvbmAgKGFuZCB0aGVyZWZvcmUgcHJldmlvdXNseSByZWFjaGVkIHRoZSBkeW5hbWljXG4gICAqIGltcG9ydHMpLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx0eXBlb2YgaW1wb3J0KFwiLi4vYmVhY29uL2NsaWVudC5qc1wiKS5kZWZhdWx0Pn0gLSBCZWFjb24gY2xpZW50IGNsYXNzLlxuICAgKi9cbiAgYXN5bmMgbG9hZEJlYWNvbkNsaWVudCgpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJsb2FkQmVhY29uQ2xpZW50IG5vdCBpbXBsZW1lbnRlZCBieSB0aGlzIGVudmlyb25tZW50IGhhbmRsZXJcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBMb2FkcyB0aGUgaW4tcHJvY2VzcyBCZWFjb24gY2xpZW50IGNsYXNzLiBTYW1lIGluZGlyZWN0aW9uIHJhdGlvbmFsZVxuICAgKiBhcyBgbG9hZEJlYWNvbkNsaWVudGAuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHR5cGVvZiBpbXBvcnQoXCIuLi9iZWFjb24vaW4tcHJvY2Vzcy1jbGllbnQuanNcIikuZGVmYXVsdD59IC0gSW4tcHJvY2VzcyBjbGllbnQgY2xhc3MuXG4gICAqL1xuICBhc3luYyBsb2FkSW5Qcm9jZXNzQmVhY29uQ2xpZW50KCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcImxvYWRJblByb2Nlc3NCZWFjb25DbGllbnQgbm90IGltcGxlbWVudGVkIGJ5IHRoaXMgZW52aXJvbm1lbnQgaGFuZGxlclwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xpIGNvbW1hbmRzIGRiIHNjaGVtYSBkdW1wLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NsaS9iYXNlLWNvbW1hbmQuanNcIikuZGVmYXVsdH0gX2NvbW1hbmQgLSBDb21tYW5kLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY29tbWFuZCByZXN1bHQuXG4gICAqL1xuICBhc3luYyBjbGlDb21tYW5kc0RiU2NoZW1hRHVtcChfY29tbWFuZCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcImNsaUNvbW1hbmRzRGJTY2hlbWFEdW1wIG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xpIGNvbW1hbmRzIGRiIHNjaGVtYSBsb2FkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NsaS9iYXNlLWNvbW1hbmQuanNcIikuZGVmYXVsdH0gX2NvbW1hbmQgLSBDb21tYW5kLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY29tbWFuZCByZXN1bHQuXG4gICAqL1xuICBhc3luYyBjbGlDb21tYW5kc0RiU2NoZW1hTG9hZChfY29tbWFuZCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcImNsaUNvbW1hbmRzRGJTY2hlbWFMb2FkIG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xpIGNvbW1hbmRzIGRiIHNlZWQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiKS5kZWZhdWx0fSBfY29tbWFuZCAtIENvbW1hbmQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjb21tYW5kIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGNsaUNvbW1hbmRzRGJTZWVkKF9jb21tYW5kKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiY2xpQ29tbWFuZHNEYlNlZWQgbm90IGltcGxlbWVudGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGkgY29tbWFuZHMgcnVubmVyLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NsaS9iYXNlLWNvbW1hbmQuanNcIikuZGVmYXVsdH0gX2NvbW1hbmQgLSBDb21tYW5kLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY29tbWFuZCByZXN1bHQuXG4gICAqL1xuICBhc3luYyBjbGlDb21tYW5kc1J1bm5lcihfY29tbWFuZCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcImNsaUNvbW1hbmRzUnVubmVyIG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xpIGNvbW1hbmRzIHJ1biBzY3JpcHQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiKS5kZWZhdWx0fSBfY29tbWFuZCAtIENvbW1hbmQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjb21tYW5kIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGNsaUNvbW1hbmRzUnVuU2NyaXB0KF9jb21tYW5kKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiY2xpQ29tbWFuZHNSdW5TY3JpcHQgbm90IGltcGxlbWVudGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5kIGNvbW1hbmRzLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHJldHVybnMge1Byb21pc2U8Q29tbWFuZEZpbGVPYmplY3RUeXBlW10+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNvbW1hbmRzLlxuICAgKi9cbiAgYXN5bmMgZmluZENvbW1hbmRzKCkgeyB0aHJvdyBuZXcgRXJyb3IoXCJmaW5kQ29tbWFuZHMgbm90IGltcGxlbWVudGVkXCIpIH1cblxuICAvKipcbiAgICogUnVucyBmaW5kIG1pZ3JhdGlvbnMuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcnJheTxNaWdyYXRpb25PYmplY3RUeXBlPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgbWlncmF0aW9ucy5cbiAgICovXG4gIGFzeW5jIGZpbmRNaWdyYXRpb25zKCkgeyB0aHJvdyBuZXcgRXJyb3IoXCJmaW5kTWlncmF0aW9ucyBub3QgaW1wbGVtbmV0ZWRcIikgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZvcndhcmQgY29tbWFuZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jbGkvYmFzZS1jb21tYW5kLmpzXCIpLmRlZmF1bHR9IGNvbW1hbmQgLSBDb21tYW5kLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9jbGkvYmFzZS1jb21tYW5kLmpzXCIpLmRlZmF1bHR9IENvbW1hbmRDbGFzcyAtIENvbW1hbmQgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjb21tYW5kIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGZvcndhcmRDb21tYW5kKGNvbW1hbmQsIENvbW1hbmRDbGFzcykge1xuICAgIGNvbnN0IG5ld0NvbW1hbmQgPSBuZXcgQ29tbWFuZENsYXNzKHtcbiAgICAgIGFyZ3M6IGNvbW1hbmQuYXJncyxcbiAgICAgIGNsaTogY29tbWFuZC5jbGlcbiAgICB9KVxuXG4gICAgcmV0dXJuIGF3YWl0IG5ld0NvbW1hbmQuZXhlY3V0ZSgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdmVsb2Npb3VzIHBhdGguXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSAtIFJlc29sdmVzIHdpdGggdGhlIHZlbG9jaW91cyBwYXRoLlxuICAgKi9cbiAgZ2V0VmVsb2Npb3VzUGF0aCgpIHsgdGhyb3cgbmV3IEVycm9yKFwiZ2V0VmVsb2Npb3VzUGF0aCBub3QgaW1wbGVtZW50ZWRcIikgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGltcG9ydCBhcHBsaWNhdGlvbiByb3V0ZXMuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuLi9yb3V0ZXMvaW5kZXguanNcIikuZGVmYXVsdD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgaW1wb3J0IGFwcGxpY2F0aW9uIHJvdXRlcy5cbiAgICovXG4gIGFzeW5jIGltcG9ydEFwcGxpY2F0aW9uUm91dGVzKCkgeyB0aHJvdyBuZXcgRXJyb3IoXCJpbXBvcnRBcHBsaWNhdGlvblJvdXRlcyBub3QgaW1wbGVtZW50ZWRcIikgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGltcG9ydCB0ZXN0IGZpbGVzLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gX3Rlc3RGaWxlcyAtIFRlc3QgZmlsZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBpbXBvcnRUZXN0RmlsZXMoX3Rlc3RGaWxlcykgeyB0aHJvdyBuZXcgRXJyb3IoXCInaW1wb3J0VGVzdEZpbGVzJyBub3QgaW1wbGVtZW50ZWRcIikgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGltcG9ydCB0ZXN0aW5nIGNvbmZpZyBwYXRoLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGltcG9ydFRlc3RpbmdDb25maWdQYXRoKCkgeyB0aHJvdyBuZXcgRXJyb3IoYCdpbXBvcnRUZXN0aW5nQ29uZmlnUGF0aCcgbm90IGltcGxlbWVudGVkYCkgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFmdGVyIG1pZ3JhdGlvbnMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQ+fSBhcmdzLmRicyAtIERicy5cbiAgICogQHBhcmFtIHtcIm1pZ3JhdGlvblwiIHwgXCJzY2hlbWFEdW1wXCJ9IFthcmdzLnJlYXNvbl0gLSBXaHkgdGhlIHN0cnVjdHVyZSB3cml0ZSBob29rIGlzIGJlaW5nIGludm9rZWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBhZnRlck1pZ3JhdGlvbnMoYXJncykgeyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIG5vLXVudXNlZC12YXJzXG4gICAgcmV0dXJuXG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyB2ZWxvY2lvdXMnIG93biBmcmFtZXdvcmstb3duZWQgc2NoZW1hIChlLmcuIHRoZSBiYWNrZ3JvdW5kLWpvYnNcbiAgICogdGFibGVzKSBleGlzdHMgYWZ0ZXIgYXBwIG1pZ3JhdGlvbnMgcnVuLCBzbyBgZGI6bWlncmF0ZWAgcHJvZHVjZXMgYSBjb21wbGV0ZVxuICAgKiBzY2hlbWEgZGV0ZXJtaW5pc3RpY2FsbHkgaW5zdGVhZCBvZiBpdCBvbmx5IGFwcGVhcmluZyBvbmNlIGEgcnVudGltZSBzdG9yZVxuICAgKiBib290cy4gUnVucyBiZWZvcmUgdGhlIHN0cnVjdHVyZSBkdW1wLiBOby1vcCBieSBkZWZhdWx0OyB0aGUgbm9kZSBoYW5kbGVyXG4gICAqIG92ZXJyaWRlcyBpdC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdD59IGFyZ3MuZGJzIC0gRGJzIGJlaW5nIG1pZ3JhdGVkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgZW5zdXJlRnJhbWV3b3JrU2NoZW1hKGFyZ3MpIHsgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby11bnVzZWQtdmFyc1xuICAgIHJldHVyblxuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZXMgdGhlIGVudmlyb25tZW50J3MgZGVmYXVsdCBwZXJzaXN0ZW5jZSBhZGFwdGVyLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHBhcmFtIHt7Y29uZmlndXJhdGlvbjogaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fX0gX2FyZ3MgLSBBZGFwdGVyIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9iYWNrZ3JvdW5kLWpvYnMvYWRhcHRlci5qc1wiKS5kZWZhdWx0fSAtIERlZmF1bHQgYWRhcHRlci5cbiAgICovXG4gIGNyZWF0ZUJhY2tncm91bmRKb2JzQWRhcHRlcihfYXJncykge1xuICAgIHRocm93IG5ldyBFcnJvcihcIlRoaXMgZW52aXJvbm1lbnQgcmVxdWlyZXMgYW4gZXhwbGljaXQgYmFja2dyb3VuZEpvYnMuYWRhcHRlclwiKVxuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZXMgdGhlIHBsYXRmb3JtLW5ldXRyYWwgcHJvZHVjZXIgcGF0aCBmb3IgYW4gZXhwbGljaXQgYWRhcHRlci5cbiAgICogQHBhcmFtIHt7Y29uZmlndXJhdGlvbjogaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fX0gYXJncyAtIENsaWVudCBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vYmFja2dyb3VuZC1qb2JzL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JzUHJvZHVjZXJ9IC0gQWRhcHRlci1iYWNrZWQgcHJvZHVjZXIuXG4gICAqL1xuICBiYWNrZ3JvdW5kSm9ic0NsaWVudChhcmdzKSB7XG4gICAgcmV0dXJuIG5ldyBCYWNrZ3JvdW5kSm9ic0FkYXB0ZXJDbGllbnQoYXJncylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlcXVpcmUgY29tbWFuZC5cbiAgICogQGFic3RyYWN0XG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGFyZ3MuY29tbWFuZFBhcnRzIC0gQ29tbWFuZCBwYXJ0cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dHlwZW9mIGltcG9ydCAoXCIuLi9jbGkvYmFzZS1jb21tYW5kLmpzXCIpLmRlZmF1bHQ+fSAtIFJlc29sdmVzIHdpdGggdGhlIHJlcXVpcmUgY29tbWFuZC5cbiAgICovXG4gIGFzeW5jIHJlcXVpcmVDb21tYW5kKHtjb21tYW5kUGFydHN9KSB7IHRocm93IG5ldyBFcnJvcihcIidyZXF1aXJlQ29tbWFuZCcgbm90IGltcGxlbWVudGVkXCIpIH0gLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby11bnVzZWQtdmFyc1xuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBhcmdzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gbmV3QXJncyAtIE5ldyBhcmdzLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRBcmdzKG5ld0FyZ3MpIHsgdGhpcy5hcmdzID0gbmV3QXJncyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBuZXdDb25maWd1cmF0aW9uIC0gTmV3IGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldENvbmZpZ3VyYXRpb24obmV3Q29uZmlndXJhdGlvbikgeyB0aGlzLmNvbmZpZ3VyYXRpb24gPSBuZXdDb25maWd1cmF0aW9uIH1cblxuICAvKipcbiAgICogUnVucyByZWFkIGF0dGFjaG1lbnQgaW5wdXQgZmlsZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IF9maWxlUGF0aCAtIEZpbGUgcGF0aC5cbiAgICogQHJldHVybnMge1Byb21pc2U8QnVmZmVyPn0gLSBGaWxlIGJ5dGVzLlxuICAgKi9cbiAgYXN5bmMgcmVhZEF0dGFjaG1lbnRJbnB1dEZpbGUoX2ZpbGVQYXRoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiQXR0YWNobWVudCBmaWxlIHJlYWRzIGFyZSBub3Qgc3VwcG9ydGVkIGluIHRoaXMgZW52aXJvbm1lbnRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlc29sdmUgYXR0YWNobWVudCBpbnB1dCBwYXRoLlxuICAgKiBAcGFyYW0ge29iamVjdH0gX2FyZ3MgLSBBcmdzLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBfYXJncy5hbGxvd2VkUGF0aFByZWZpeGVzIC0gQWxsb3dlZCBwYXRoIHByZWZpeGVzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gX2FyZ3MuaW5wdXRQYXRoIC0gSW5wdXQgcGF0aC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi4vZGF0YWJhc2UvcmVjb3JkL2F0dGFjaG1lbnRzL25vcm1hbGl6ZS1pbnB1dC5qc1wiKS5BdHRhY2htZW50UGF0aFNvdXJjZT59IC0gT3BlbmVkIHBhdGggc291cmNlLlxuICAgKi9cbiAgYXN5bmMgcmVzb2x2ZUF0dGFjaG1lbnRJbnB1dFBhdGgoX2FyZ3MpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJBdHRhY2htZW50IHBhdGggaW5wdXQgaXMgbm90IHN1cHBvcnRlZCBpbiB0aGlzIGVudmlyb25tZW50XCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gLSBUaGUgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIGdldENvbmZpZ3VyYXRpb24oKSB7XG4gICAgaWYgKCF0aGlzLmNvbmZpZ3VyYXRpb24pIHRocm93IG5ldyBFcnJvcihcIkNvbmZpZ3VyYXRpb24gaGFzbid0IGJlZW4gc2V0XCIpXG5cbiAgICByZXR1cm4gdGhpcy5jb25maWd1cmF0aW9uXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgcHJvY2VzcyBhcmdzLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBuZXdQcm9jZXNzQXJncyAtIE5ldyBwcm9jZXNzIGFyZ3MuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldFByb2Nlc3NBcmdzKG5ld1Byb2Nlc3NBcmdzKSB7IHRoaXMucHJvY2Vzc0FyZ3MgPSBuZXdQcm9jZXNzQXJncyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGRlZmF1bHQgbG9nIGRpcmVjdG9yeS5cbiAgICogQHBhcmFtIHtvYmplY3R9IF9hcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBfYXJncy5jb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBUaGUgZGVmYXVsdCBsb2cgZGlyZWN0b3J5LlxuICAgKi9cbiAgZ2V0RGVmYXVsdExvZ0RpcmVjdG9yeShfYXJncykge1xuICAgIHJldHVybiB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBsb2cgZmlsZSBwYXRoLlxuICAgKiBAcGFyYW0ge29iamVjdH0gX2FyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IF9hcmdzLmNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IHVuZGVmaW5lZH0gX2FyZ3MuZGlyZWN0b3J5IC0gRGlyZWN0b3J5IHBhdGguXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBfYXJncy5lbnZpcm9ubWVudCAtIEVudmlyb25tZW50LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSAtIFRoZSBsb2cgZmlsZSBwYXRoLlxuICAgKi9cbiAgZ2V0TG9nRmlsZVBhdGgoX2FyZ3MpIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogUnVucyB3cml0ZSBsb2cgdG8gZmlsZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IF9hcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBfYXJncy5maWxlUGF0aCAtIEZpbGUgcGF0aC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IF9hcmdzLm1lc3NhZ2UgLSBNZXNzYWdlIHRleHQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyB3cml0ZUxvZ1RvRmlsZShfYXJncykge1xuICAgIHJldHVyblxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyBmcm9udGVuZC1tb2RlbCB3ZWJzb2NrZXQgY2hhbm5lbCBwdWJsaXNoZXJzIHNvIGxpZmVjeWNsZVxuICAgKiBldmVudCBob29rcyAoY3JlYXRlL3VwZGF0ZS9kZXN0cm95KSBicm9hZGNhc3Qgb3ZlciB0aGUgc2hhcmVkXG4gICAqIFwiZnJvbnRlbmQtbW9kZWxzXCIgY2hhbm5lbC4gVGhlIGJhc2UgaGFuZGxlciBpcyBhIG5vLW9wIOKAlCBvbmx5IHRoZVxuICAgKiBOb2RlIGhhbmRsZXIgcGVyZm9ybXMgdGhlIHJlZ2lzdHJhdGlvbiBiZWNhdXNlIHRoZSByZXF1aXJlZFxuICAgKiBgZnJvbnRlbmQtbW9kZWwtY29udHJvbGxlcmAgYW5kIGByb3V0ZXMvcmVzb2x2ZXJgIGltcG9ydHMgcHVsbCBpblxuICAgKiBzZXJ2ZXItb25seSBtb2R1bGVzIHRoYXQgYnJlYWsgYnJvd3NlciBidW5kbGVycy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IF9jb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGluaXRpYWxpemVGcm9udGVuZE1vZGVsV2Vic29ja2V0UHVibGlzaGVycyhfY29uZmlndXJhdGlvbikge1xuICAgIC8vIE5vLW9wIGluIGJhc2UgaGFuZGxlcjsgTm9kZSBoYW5kbGVyIGRvZXMgdGhlIHJlYWwgcmVnaXN0cmF0aW9uLlxuICB9XG5cbiAgLyoqXG4gICAqIExvYWRzIG1vZGVscyBjb250cmlidXRlZCBieSByZWdpc3RlcmVkIHBhY2thZ2VzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gX2NvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgaW5pdGlhbGl6ZVBhY2thZ2VNb2RlbHMoX2NvbmZpZ3VyYXRpb24pIHtcbiAgICAvLyBOby1vcCBpbiBiYXNlIGhhbmRsZXI7IE5vZGUgaGFuZGxlciBsb2FkcyBwYWNrYWdlIG1vZGVscyBmcm9tIHRoZSBmaWxlc3lzdGVtLlxuICB9XG59XG4iXX0=