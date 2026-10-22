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
     * Creates the file-tier advisory-lock backend (STC-213). Only filesystem
     * capable environments (the Node handler) can provide this tier; browser
     * and Expo configurations have no `fs`, so the default refuses loudly
     * instead of half-working when a deployment explicitly enables
     * `advisoryLocks.backends.file.enabled`.
     * @param {{directory: string, leaseMs: number, renewIntervalMs: number}} _args - Backend options.
     * @returns {Promise<import("../database/advisory-lock-file-backend.js").default>} - Resolves with the created backend in filesystem-capable handlers.
     */
    async createAdvisoryLockFileBackend(_args) {
        throw new Error("The advisory-lock file tier requires a filesystem-capable environment handler (Node)");
    }
    /**
     * Creates the centralized lock-server advisory-lock backend (tier (b)). Only
     * the Node environment handler provides it: the backend's websocket transport
     * depends on the Node-only `ws` package, which browser/Expo bundlers cannot
     * resolve (Metro fails on `ws`'s Node core `stream` dependency), so the module
     * must never be statically reachable from a browser bundle. A browser/Expo
     * configuration that enables the tier fails loudly here instead of breaking
     * the bundle.
     * @param {{authToken: string, connectTimeoutMs: number, leaseMs: number, onError: (error: Error) => void, reprobeCooldownMs: number, url: string}} _args - Backend options.
     * @returns {Promise<import("../database/advisory-lock-lock-server-backend.js").default>} - Resolves with the created backend in Node-capable handlers.
     */
    async createAdvisoryLockLockServerBackend(_args) {
        throw new Error("The advisory-lock lock-server tier requires the Node environment handler");
    }
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9lbnZpcm9ubWVudC1oYW5kbGVycy9iYXNlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLDJCQUEyQixNQUFNLHNDQUFzQyxDQUFBO0FBQzlFLE9BQU8sRUFBRSxnQkFBZ0IsRUFBRSxNQUFNLGlCQUFpQixDQUFBO0FBRWxEOzs7OztHQUtHO0FBRUg7Ozs7Ozs7R0FPRztBQUNIOzs7OztHQUtHO0FBRUgsTUFBTSxPQUFPLDhCQUErQixTQUFRLEtBQUs7Q0FBRztBQUU1RCxNQUFNLENBQUMsT0FBTyxPQUFPLCtCQUErQjtJQUNsRDs7Ozs7T0FLRztJQUNILG9DQUFvQyxDQUFDLEVBQUMsa0JBQWtCLEVBQUMsSUFBSSxPQUFPLGtCQUFrQixDQUFBLENBQUMsQ0FBQztJQUV4Rjs7Ozs7Ozs7T0FRRztJQUNILEtBQUssQ0FBQyw2QkFBNkIsQ0FBQyxLQUFLO1FBQ3ZDLE1BQU0sSUFBSSxLQUFLLENBQUMsc0ZBQXNGLENBQUMsQ0FBQTtJQUN6RyxDQUFDO0lBRUQ7Ozs7Ozs7Ozs7T0FVRztJQUNILEtBQUssQ0FBQyxtQ0FBbUMsQ0FBQyxLQUFLO1FBQzdDLE1BQU0sSUFBSSxLQUFLLENBQUMsMEVBQTBFLENBQUMsQ0FBQTtJQUM3RixDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxLQUFLLENBQUMscUNBQXFDLENBQUMsS0FBSyxJQUFJLE9BQU8sU0FBUyxDQUFBLENBQUMsQ0FBQztJQUV2RTs7OztPQUlHO0lBQ0gsb0NBQW9DLENBQUMsVUFBVTtRQUM3QyxPQUFPLElBQUksQ0FBQyx5Q0FBeUMsRUFBRSxRQUFRLEVBQUUsRUFBRSxHQUFHLENBQUMsVUFBVSxDQUFDLENBQUE7SUFDcEYsQ0FBQztJQUVEOzs7Ozs7O09BT0c7SUFDSCx3Q0FBd0MsQ0FBQyxVQUFVLEVBQUUsS0FBSyxFQUFFLFFBQVE7UUFDbEUsTUFBTSxPQUFPLEdBQUcsSUFBSSxD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Qyw2REFBNkQsQ0FBQyxDQUFBO0lBQ2hGLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxLQUFLLENBQUMsMEJBQTBCLENBQUMsS0FBSztRQUNwQyxNQUFNLElBQUksS0FBSyxDQUFDLDREQUE0RCxDQUFDLENBQUE7SUFDL0UsQ0FBQztJQUVEOzs7T0FHRztJQUNILGdCQUFnQjtRQUNkLElBQUksQ0FBQyxJQUFJLENBQUMsYUFBYTtZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsK0JBQStCLENBQUMsQ0FBQTtRQUV6RSxPQUFPLElBQUksQ0FBQyxhQUFhLENBQUE7SUFDM0IsQ0FBQztJQUVEOzs7O09BSUc7SUFDSCxjQUFjLENBQUMsY0FBYyxJQUFJLElBQUksQ0FBQyxXQUFXLEdBQUcsY0FBYyxDQUFBLENBQUMsQ0FBQztJQUVwRTs7Ozs7T0FLRztJQUNILHNCQUFzQixDQUFDLEtBQUs7UUFDMUIsT0FBTyxTQUFTLENBQUE7SUFDbEIsQ0FBQztJQUVEOzs7Ozs7O09BT0c7SUFDSCxjQUFjLENBQUMsS0FBSztRQUNsQixPQUFPLFNBQVMsQ0FBQTtJQUNsQixDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsS0FBSyxDQUFDLGNBQWMsQ0FBQyxLQUFLO1FBQ3hCLE9BQU07SUFDUixDQUFDO0lBRUQ7Ozs7Ozs7OztPQVNHO0lBQ0gsS0FBSyxDQUFDLDBDQUEwQyxDQUFDLGNBQWM7UUFDN0Qsa0VBQWtFO0lBQ3BFLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLHVCQUF1QixDQUFDLGNBQWM7UUFDMUMsZ0ZBQWdGO0lBQ2xGLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgQmFja2dyb3VuZEpvYnNBZGFwdGVyQ2xpZW50IGZyb20gXCIuLi9iYWNrZ3JvdW5kLWpvYnMvYWRhcHRlci1jbGllbnQuanNcIlxuaW1wb3J0IHsgdmFsaWRhdGVUaW1lWm9uZSB9IGZyb20gXCIuLi90aW1lLXpvbmUuanNcIlxuXG4vKipcbiAqIENvbW1hbmRGaWxlT2JqZWN0VHlwZSB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gQ29tbWFuZEZpbGVPYmplY3RUeXBlXG4gKiBAcHJvcGVydHkge3N0cmluZ30gbmFtZSAtIENvbW1hbmQgbmFtZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBmaWxlIC0gQ29tbWFuZCBmaWxlIHBhdGguXG4gKi9cblxuLyoqXG4gKiBNaWdyYXRpb25PYmplY3RUeXBlIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBNaWdyYXRpb25PYmplY3RUeXBlXG4gKiBAcHJvcGVydHkge251bWJlcn0gZGF0ZSAtIE1pZ3JhdGlvbiB0aW1lc3RhbXAgcGFyc2VkIGZyb20gZmlsZW5hbWUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW2Z1bGxQYXRoXSAtIEFic29sdXRlIHBhdGggdG8gdGhlIG1pZ3JhdGlvbiBmaWxlLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IG1pZ3JhdGlvbkNsYXNzTmFtZSAtIEV4cG9ydGVkIG1pZ3JhdGlvbiBjbGFzcyBuYW1lLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGZpbGUgLSBNaWdyYXRpb24gZmlsZW5hbWUuXG4gKi9cbi8qKlxuICogVGVzdERhdGFiYXNlQWNjZXNzU2NvcGVTdG9yYWdlIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBUZXN0RGF0YWJhc2VBY2Nlc3NTY29wZVN0b3JhZ2VcbiAqIEBwcm9wZXJ0eSB7KCkgPT4gKHtyZXZva2VkOiBib29sZWFufSB8IHVuZGVmaW5lZCl9IGdldFN0b3JlIC0gR2V0cyB0aGUgaW5oZXJpdGVkIHNjb3BlLlxuICogQHByb3BlcnR5IHsoc2NvcGU6IHtyZXZva2VkOiBib29sZWFufSB8IHVuZGVmaW5lZCwgY2FsbGJhY2s6ICgpID0+IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+KSA9PiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gcnVuIC0gUnVucyBpbiB0aGUgc2NvcGUuXG4gKi9cblxuZXhwb3J0IGNsYXNzIFRlc3REYXRhYmFzZUFjY2Vzc1Jldm9rZWRFcnJvciBleHRlbmRzIEVycm9yIHt9XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0Vudmlyb25tZW50SGFuZGxlckJhc2Uge1xuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIGNvbmZpZ3VyZWQgZGF0YWJhc2UgcG9vbCB0eXBlIGZvciB0aGUgY3VycmVudCBydW50aW1lIGNvbnRleHQuXG4gICAqIEJyb3dzZXIgYW5kIG9yZGluYXJ5IHNlcnZlciBjb250ZXh0cyByZXRhaW4gdGhlIGFwcGxpY2F0aW9uIGNvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7e2NvbmZpZ3VyZWRQb29sVHlwZTogdHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3Bvb2wvYmFzZS5qc1wiKS5kZWZhdWx0LCBkYXRhYmFzZUlkZW50aWZpZXI6IHN0cmluZ319IGFyZ3MgLSBDb25maWd1cmVkIHBvb2wgYW5kIGxvZ2ljYWwgZGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICogQHJldHVybnMge3R5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9wb29sL2Jhc2UuanNcIikuZGVmYXVsdH0gLSBQb29sIHR5cGUgZm9yIHRoaXMgY29udGV4dC5cbiAgICovXG4gIHJlc29sdmVUZXN0U2hhcmVkVHJhbnNhY3Rpb25Qb29sVHlwZSh7Y29uZmlndXJlZFBvb2xUeXBlfSkgeyByZXR1cm4gY29uZmlndXJlZFBvb2xUeXBlIH1cblxuICAvKipcbiAgICogQ3JlYXRlcyB0aGUgZmlsZS10aWVyIGFkdmlzb3J5LWxvY2sgYmFja2VuZCAoU1RDLTIxMykuIE9ubHkgZmlsZXN5c3RlbVxuICAgKiBjYXBhYmxlIGVudmlyb25tZW50cyAodGhlIE5vZGUgaGFuZGxlcikgY2FuIHByb3ZpZGUgdGhpcyB0aWVyOyBicm93c2VyXG4gICAqIGFuZCBFeHBvIGNvbmZpZ3VyYXRpb25zIGhhdmUgbm8gYGZzYCwgc28gdGhlIGRlZmF1bHQgcmVmdXNlcyBsb3VkbHlcbiAgICogaW5zdGVhZCBvZiBoYWxmLXdvcmtpbmcgd2hlbiBhIGRlcGxveW1lbnQgZXhwbGljaXRseSBlbmFibGVzXG4gICAqIGBhZHZpc29yeUxvY2tzLmJhY2tlbmRzLmZpbGUuZW5hYmxlZGAuXG4gICAqIEBwYXJhbSB7e2RpcmVjdG9yeTogc3RyaW5nLCBsZWFzZU1zOiBudW1iZXIsIHJlbmV3SW50ZXJ2YWxNczogbnVtYmVyfX0gX2FyZ3MgLSBCYWNrZW5kIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4uL2RhdGFiYXNlL2Fkdmlzb3J5LWxvY2stZmlsZS1iYWNrZW5kLmpzXCIpLmRlZmF1bHQ+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNyZWF0ZWQgYmFja2VuZCBpbiBmaWxlc3lzdGVtLWNhcGFibGUgaGFuZGxlcnMuXG4gICAqL1xuICBhc3luYyBjcmVhdGVBZHZpc29yeUxvY2tGaWxlQmFja2VuZChfYXJncykge1xuICAgIHRocm93IG5ldyBFcnJvcihcIlRoZSBhZHZpc29yeS1sb2NrIGZpbGUgdGllciByZXF1aXJlcyBhIGZpbGVzeXN0ZW0tY2FwYWJsZSBlbnZpcm9ubWVudCBoYW5kbGVyIChOb2RlKVwiKVxuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZXMgdGhlIGNlbnRyYWxpemVkIGxvY2stc2VydmVyIGFkdmlzb3J5LWxvY2sgYmFja2VuZCAodGllciAoYikpLiBPbmx5XG4gICAqIHRoZSBOb2RlIGVudmlyb25tZW50IGhhbmRsZXIgcHJvdmlkZXMgaXQ6IHRoZSBiYWNrZW5kJ3Mgd2Vic29ja2V0IHRyYW5zcG9ydFxuICAgKiBkZXBlbmRzIG9uIHRoZSBOb2RlLW9ubHkgYHdzYCBwYWNrYWdlLCB3aGljaCBicm93c2VyL0V4cG8gYnVuZGxlcnMgY2Fubm90XG4gICAqIHJlc29sdmUgKE1ldHJvIGZhaWxzIG9uIGB3c2AncyBOb2RlIGNvcmUgYHN0cmVhbWAgZGVwZW5kZW5jeSksIHNvIHRoZSBtb2R1bGVcbiAgICogbXVzdCBuZXZlciBiZSBzdGF0aWNhbGx5IHJlYWNoYWJsZSBmcm9tIGEgYnJvd3NlciBidW5kbGUuIEEgYnJvd3Nlci9FeHBvXG4gICAqIGNvbmZpZ3VyYXRpb24gdGhhdCBlbmFibGVzIHRoZSB0aWVyIGZhaWxzIGxvdWRseSBoZXJlIGluc3RlYWQgb2YgYnJlYWtpbmdcbiAgICogdGhlIGJ1bmRsZS5cbiAgICogQHBhcmFtIHt7YXV0aFRva2VuOiBzdHJpbmcsIGNvbm5lY3RUaW1lb3V0TXM6IG51bWJlciwgbGVhc2VNczogbnVtYmVyLCBvbkVycm9yOiAoZXJyb3I6IEVycm9yKSA9PiB2b2lkLCByZXByb2JlQ29vbGRvd25NczogbnVtYmVyLCB1cmw6IHN0cmluZ319IF9hcmdzIC0gQmFja2VuZCBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuLi9kYXRhYmFzZS9hZHZpc29yeS1sb2NrLWxvY2stc2VydmVyLWJhY2tlbmQuanNcIikuZGVmYXVsdD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY3JlYXRlZCBiYWNrZW5kIGluIE5vZGUtY2FwYWJsZSBoYW5kbGVycy5cbiAgICovXG4gIGFzeW5jIGNyZWF0ZUFkdmlzb3J5TG9ja0xvY2tTZXJ2ZXJCYWNrZW5kKF9hcmdzKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiVGhlIGFkdmlzb3J5LWxvY2sgbG9jay1zZXJ2ZXIgdGllciByZXF1aXJlcyB0aGUgTm9kZSBlbnZpcm9ubWVudCBoYW5kbGVyXCIpXG4gIH1cblxuICAvKipcbiAgICogTm9kZSB0ZXN0IHJ1bnRpbWVzIG1heSByZXBsYWNlIGEgcGh5c2ljYWwgY2hpbGQgY29ubmVjdGlvbiB3aXRoIGEgYnJva2VyXG4gICAqIHByb3h5LiBPdGhlciBlbnZpcm9ubWVudHMgbmV2ZXIgcGFydGljaXBhdGUgaW4gdGhpcyB0ZXN0LW9ubHkgcHJvdG9jb2wuXG4gICAqIEBwYXJhbSB7e0RyaXZlckNsYXNzOiB0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQsIGNvbmZpZzogaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlLCBjb25maWd1cmF0aW9uOiBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHQsIGRhdGFiYXNlSWRlbnRpZmllcjogc3RyaW5nLCByZXVzZUtleT86IHN0cmluZ319IF9hcmdzIC0gQ29ubmVjdGlvbiBkZXRhaWxzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZD59IC0gT3B0aW9uYWwgcHJveHkuXG4gICAqL1xuICBhc3luYyBjcmVhdGVUZXN0U2hhcmVkVHJhbnNhY3Rpb25Db25uZWN0aW9uKF9hcmdzKSB7IHJldHVybiB1bmRlZmluZWQgfVxuXG4gIC8qKlxuICAgKiBHZXRzIHRoZSBhY3RpdmUgc2hhcmVkLXRyYW5zYWN0aW9uIGNvb3JkaW5hdG9yIG93bmVyIGZvciBhIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBjb25uZWN0aW9uIC0gUGFyZW50IHBoeXNpY2FsIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtzeW1ib2wgfCB1bmRlZmluZWR9IC0gQWN0aXZlIGNvb3JkaW5hdG9yIG93bmVyLlxuICAgKi9cbiAgZ2V0U2hhcmVkVHJhbnNhY3Rpb25Db29yZGluYXRvck93bmVyKGNvbm5lY3Rpb24pIHtcbiAgICByZXR1cm4gdGhpcy5fc2hhcmVkVHJhbnNhY3Rpb25Db29yZGluYXRvck93bmVyU3RvcmFnZT8uZ2V0U3RvcmUoKT8uZ2V0KGNvbm5lY3Rpb24pXG4gIH1cblxuICAvKipcbiAgICogUnVucyB3b3JrIGFzIHRoZSBjdXJyZW50IHNoYXJlZC10cmFuc2FjdGlvbiBjb29yZGluYXRvciBvd25lci5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHtvYmplY3R9IGNvbm5lY3Rpb24gLSBQYXJlbnQgcGh5c2ljYWwgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzeW1ib2x9IG93bmVyIC0gQ29vcmRpbmF0b3Igb3duZXIuXG4gICAqIEBwYXJhbSB7KCkgPT4gVH0gY2FsbGJhY2sgLSBPd25lZCB3b3JrLlxuICAgKiBAcmV0dXJucyB7VH0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBydW5XaXRoU2hhcmVkVHJhbnNhY3Rpb25Db29yZGluYXRvck93bmVyKGNvbm5lY3Rpb24sIG93bmVyLCBjYWxsYmFjaykge1xuICAgIGNvbnN0IHN0b3JhZ2UgPSB0aGlzLl9zaGFyZWRUcmFuc2FjdGlvbkNvb3JkaW5hdG9yT3duZXJTdG9yYWdlXG5cbiAgICBpZiAoIXN0b3JhZ2UpIHJldHVybiBjYWxsYmFjaygpXG5cbiAgICBjb25zdCBvd25lcnMgPSBuZXcgTWFwKHN0b3JhZ2UuZ2V0U3RvcmUoKSlcblxuICAgIG93bmVycy5zZXQoY29ubmVjdGlvbiwgb3duZXIpXG4gICAgcmV0dXJuIHN0b3JhZ2UucnVuKG93bmVycywgY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogUnVucyB3b3JrIHdpdGhvdXQgaW5oZXJpdGVkIHNoYXJlZC10cmFuc2FjdGlvbiBvd25lcnNoaXAgZm9yIG9uZSBjb25uZWN0aW9uLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBjb25uZWN0aW9uIC0gUGh5c2ljYWwgY29ubmVjdGlvbiB3aG9zZSBvd25lciBpcyBjbGVhcmVkLlxuICAgKiBAcGFyYW0geygpID0+IFR9IGNhbGxiYWNrIC0gUGh5c2ljYWwgY29ubmVjdGlvbiB3b3JrLlxuICAgKiBAcmV0dXJucyB7VH0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBydW5XaXRob3V0U2hhcmVkVHJhbnNhY3Rpb25Db29yZGluYXRvck93bmVyKGNvbm5lY3Rpb24sIGNhbGxiYWNrKSB7XG4gICAgY29uc3Qgc3RvcmFnZSA9IHRoaXMuX3NoYXJlZFRyYW5zYWN0aW9uQ29vcmRpbmF0b3JPd25lclN0b3JhZ2VcblxuICAgIGlmICghc3RvcmFnZSkgcmV0dXJuIGNhbGxiYWNrKClcblxuICAgIGNvbnN0IG93bmVycyA9IG5ldyBNYXAoc3RvcmFnZS5nZXRTdG9yZSgpKVxuXG4gICAgb3duZXJzLmRlbGV0ZShjb25uZWN0aW9uKVxuICAgIHJldHVybiBzdG9yYWdlLnJ1bihvd25lcnMsIGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd29yayB3aXRob3V0IGluaGVyaXRlZCBzaGFyZWQtdHJhbnNhY3Rpb24gY29vcmRpbmF0b3Igb3duZXJzaGlwLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0geygpID0+IFR9IGNhbGxiYWNrIC0gRGV0YWNoZWQgd29yay5cbiAgICogQHJldHVybnMge1R9IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgcnVuV2l0aG91dFNoYXJlZFRyYW5zYWN0aW9uQ29vcmRpbmF0b3JPd25lcnMoY2FsbGJhY2spIHtcbiAgICBjb25zdCBzdG9yYWdlID0gdGhpcy5fc2hhcmVkVHJhbnNhY3Rpb25Db29yZGluYXRvck93bmVyU3RvcmFnZVxuXG4gICAgaWYgKCFzdG9yYWdlKSByZXR1cm4gY2FsbGJhY2soKVxuXG4gICAgcmV0dXJuIHN0b3JhZ2UucnVuKG5ldyBNYXAoKSwgY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogSW5zdGFsbHMgYXN5bmMtY29udGV4dCBzdG9yYWdlIHdoZW4gdGhpcyBoYW5kbGVyIGlzIGRyaXZlbiBieSB0aGUgTm9kZSB0ZXN0IHJ1bm5lci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJub2RlOmFzeW5jX2hvb2tzXCIpLkFzeW5jTG9jYWxTdG9yYWdlPE1hcDxvYmplY3QsIHN5bWJvbD4+fSBzdG9yYWdlIC0gQ29vcmRpbmF0b3Igb3duZXIgc3RvcmFnZS5cbiAgICovXG4gIGluc3RhbGxTaGFyZWRUcmFuc2FjdGlvbkNvb3JkaW5hdG9yT3duZXJTdG9yYWdlKHN0b3JhZ2UpIHtcbiAgICB0aGlzLl9zaGFyZWRUcmFuc2FjdGlvbkNvb3JkaW5hdG9yT3duZXJTdG9yYWdlID8/PSBzdG9yYWdlXG4gIH1cblxuICAvKiogQHR5cGUge2ltcG9ydChcIm5vZGU6YXN5bmNfaG9va3NcIikuQXN5bmNMb2NhbFN0b3JhZ2U8TWFwPG9iamVjdCwgc3ltYm9sPj4gfCB1bmRlZmluZWR9ICovXG4gIF9zaGFyZWRUcmFuc2FjdGlvbkNvb3JkaW5hdG9yT3duZXJTdG9yYWdlID0gdW5kZWZpbmVkXG5cbiAgLyoqXG4gICAqIFJ1bnMgd29yayB3aXRoIHRlc3QtcHJvZmlsZSBhdHRyaWJ1dGlvbi4gUnVudGltZXMgd2l0aG91dCBhc3luYy1jb250ZXh0XG4gICAqIHN0b3JhZ2UgZXhlY3V0ZSB0aGUgY2FsbGJhY2sgd2l0aG91dCBpbnN0YWxsaW5nIGFtYmllbnQgYXR0cmlidXRpb24uXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vdGVzdGluZy90ZXN0LXByb2ZpbGVyLmpzXCIpLlRlc3RQcm9maWxlQXN5bmNDb250ZXh0IHwgdW5kZWZpbmVkfSBfY29udGV4dCAtIENhcHR1cmVkIHByb2ZpbGUgY29udGV4dCwgb3IgYW4gZXhwbGljaXQgYWJzZW5jZSBvZiBhdHRyaWJ1dGlvbi5cbiAgICogQHBhcmFtIHsoKSA9PiBUfSBjYWxsYmFjayAtIFByb2ZpbGVkIHdvcmsuXG4gICAqIEByZXR1cm5zIHtUfSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIHJ1bldpdGhUZXN0UHJvZmlsZUNvbnRleHQoX2NvbnRleHQsIGNhbGxiYWNrKSB7IHJldHVybiBjYWxsYmFjaygpIH1cblxuICAvKipcbiAgICogR2V0cyB0aGUgY3VycmVudCB0ZXN0LXByb2ZpbGUgYXR0cmlidXRpb24gY29udGV4dC5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL3Rlc3RpbmcvdGVzdC1wcm9maWxlci5qc1wiKS5UZXN0UHJvZmlsZUFzeW5jQ29udGV4dCB8IHVuZGVmaW5lZH0gLSBBY3RpdmUgY29udGV4dC5cbiAgICovXG4gIGdldEN1cnJlbnRUZXN0UHJvZmlsZUNvbnRleHQoKSB7IHJldHVybiB1bmRlZmluZWQgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdvcmsgaW4gYSByZXZvY2FibGUgdGVzdCBkYXRhYmFzZS1hY2Nlc3Mgc2NvcGUuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7e3Jldm9rZWQ6IGJvb2xlYW59fSBzY29wZSAtIEF0dGVtcHQtb3duZWQgYWNjZXNzIHNjb3BlLlxuICAgKiBAcGFyYW0geygpID0+IFQgfCBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIEF0dGVtcHQgd29yay5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgcnVuV2l0aFRlc3REYXRhYmFzZUFjY2Vzc1Njb3BlKHNjb3BlLCBjYWxsYmFjaykge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLnJ1bldpdGhDYXB0dXJlZFRlc3REYXRhYmFzZUFjY2Vzc1Njb3BlKHNjb3BlLCBjYWxsYmFjaylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdvcmsgd2l0aCBhbiBleHBsaWNpdGx5IGNhcHR1cmVkIHRlc3QgZGF0YWJhc2UtYWNjZXNzIHNjb3BlLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge3tyZXZva2VkOiBib29sZWFufSB8IHVuZGVmaW5lZH0gc2NvcGUgLSBDYXB0dXJlZCBhY2Nlc3Mgc2NvcGUuXG4gICAqIEBwYXJhbSB7KCkgPT4gVCB8IFByb21pc2U8VD59IGNhbGxiYWNrIC0gV29yayB0byBydW4uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHJ1bldpdGhDYXB0dXJlZFRlc3REYXRhYmFzZUFjY2Vzc1Njb3BlKHNjb3BlLCBjYWxsYmFjaykge1xuICAgIGlmICh0aGlzLl90ZXN0RGF0YWJhc2VBY2Nlc3NTY29wZVN0b3JhZ2UpIHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLl90ZXN0RGF0YWJhc2VBY2Nlc3NTY29wZVN0b3JhZ2UucnVuKHNjb3BlLCBjYWxsYmFjaylcbiAgICB9XG5cbiAgICBjb25zdCBlbnRyeSA9IHtvd25lcjogU3ltYm9sKFwidGVzdC1kYXRhYmFzZS1hY2Nlc3Mtc2NvcGVcIiksIHNjb3BlfVxuXG4gICAgdGhpcy5fdGVzdERhdGFiYXNlQWNjZXNzU2NvcGVzLnB1c2goZW50cnkpXG5cbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKClcbiAgICB9IGZpbmFsbHkge1xuICAgICAgY29uc3QgaW5kZXggPSB0aGlzLl90ZXN0RGF0YWJhc2VBY2Nlc3NTY29wZXMuZmluZEluZGV4KChjYW5kaWRhdGUpID0+IGNhbmRpZGF0ZS5vd25lciA9PT0gZW50cnkub3duZXIpXG5cbiAgICAgIGlmIChpbmRleCAhPT0gLTEpIHRoaXMuX3Rlc3REYXRhYmFzZUFjY2Vzc1Njb3Blcy5zcGxpY2UoaW5kZXgsIDEpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEdldHMgdGhlIGN1cnJlbnQgdGVzdCBkYXRhYmFzZS1hY2Nlc3Mgc2NvcGUuXG4gICAqIEByZXR1cm5zIHt7cmV2b2tlZDogYm9vbGVhbn0gfCB1bmRlZmluZWR9IC0gQ3VycmVudCBzY29wZS5cbiAgICovXG4gIGN1cnJlbnRUZXN0RGF0YWJhc2VBY2Nlc3NTY29wZSgpIHtcbiAgICBpZiAodGhpcy5fdGVzdERhdGFiYXNlQWNjZXNzU2NvcGVTdG9yYWdlKSByZXR1cm4gdGhpcy5fdGVzdERhdGFiYXNlQWNjZXNzU2NvcGVTdG9yYWdlLmdldFN0b3JlKClcblxuICAgIHJldHVybiB0aGlzLl90ZXN0RGF0YWJhc2VBY2Nlc3NTY29wZXNbdGhpcy5fdGVzdERhdGFiYXNlQWNjZXNzU2NvcGVzLmxlbmd0aCAtIDFdPy5zY29wZVxuICB9XG5cbiAgLyoqIFRocm93cyB3aGVuIHRoZSBjdXJyZW50IHRlc3QgYXR0ZW1wdCBubyBsb25nZXIgb3ducyBkYXRhYmFzZSBhY2Nlc3MuICovXG4gIGFzc2VydFRlc3REYXRhYmFzZUFjY2Vzc0FsbG93ZWQoKSB7XG4gICAgY29uc3Qgc2NvcGUgPSB0aGlzLmN1cnJlbnRUZXN0RGF0YWJhc2VBY2Nlc3NTY29wZSgpXG5cbiAgICBpZiAoc2NvcGU/LnJldm9rZWQpIHtcbiAgICAgIHRocm93IG5ldyBUZXN0RGF0YWJhc2VBY2Nlc3NSZXZva2VkRXJyb3IoXCJEYXRhYmFzZSBhY2Nlc3MgaXMgbm8gbG9uZ2VyIGFsbG93ZWQgZm9yIHRoaXMgdGVzdCBhdHRlbXB0XCIpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEluc3RhbGxzIGFzeW5jLWNvbnRleHQgc3RvcmFnZSBvd25lZCBieSB0aGUgZmlyc3QgTm9kZSB0ZXN0IHJ1bm5lci5cbiAgICogQHBhcmFtIHtUZXN0RGF0YWJhc2VBY2Nlc3NTY29wZVN0b3JhZ2V9IHN0b3JhZ2UgLSBTY29wZSBzdG9yYWdlLlxuICAgKi9cbiAgaW5zdGFsbFRlc3REYXRhYmFzZUFjY2Vzc1Njb3BlU3RvcmFnZShzdG9yYWdlKSB7XG4gICAgdGhpcy5fdGVzdERhdGFiYXNlQWNjZXNzU2NvcGVTdG9yYWdlID8/PSBzdG9yYWdlXG4gIH1cblxuICAvKiogQHR5cGUge0FycmF5PHtvd25lcjogc3ltYm9sLCBzY29wZToge3Jldm9rZWQ6IGJvb2xlYW59IHwgdW5kZWZpbmVkfT59ICovXG4gIF90ZXN0RGF0YWJhc2VBY2Nlc3NTY29wZXMgPSBbXVxuXG4gIC8qKiBAdHlwZSB7VGVzdERhdGFiYXNlQWNjZXNzU2NvcGVTdG9yYWdlIHwgdW5kZWZpbmVkfSAqL1xuICBfdGVzdERhdGFiYXNlQWNjZXNzU2NvcGVTdG9yYWdlID0gdW5kZWZpbmVkXG5cbiAgLyoqXG4gICAqIE11dGFibGUgYW1iaWVudCB0ZW5hbnQgdXNlZCBieSBydW50aW1lcyB3aXRob3V0IGFzeW5jLWNvbnRleHQgc3RvcmFnZS5cbiAgICogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+IHwgdW5kZWZpbmVkfVxuICAgKi9cbiAgX2N1cnJlbnRUZW5hbnQgPSB1bmRlZmluZWRcblxuICAvKipcbiAgICogQWN0aXZlIGFtYmllbnQgc2NvcGVzIGluIHN0YXJ0IG9yZGVyLiBUaGlzIHByZXZlbnRzIGEgc2NvcGUgdGhhdCBjb21wbGV0ZXNcbiAgICogb3V0IG9mIG9yZGVyIGZyb20gcmVzdG9yaW5nIGEgdGVuYW50IGJlbG9uZ2luZyB0byBhbiBhbHJlYWR5LWNvbXBsZXRlZCBzY29wZS5cbiAgICogQW1iaWVudCByZWFkcyBhcmUgc3RpbGwgc2hhcmVkIGluIGJyb3dzZXIgcnVudGltZXM7IGltbXV0YWJsZSBoYW5kbGVzIHJlbWFpblxuICAgKiB0aGUgY29uY3VycmVuY3ktc2FmZSBkYXRhYmFzZSBBUEkuXG4gICAqIEB0eXBlIHtBcnJheTx7b3duZXI6IHN5bWJvbCwgdGVuYW50OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0+fVxuICAgKi9cbiAgX3RlbmFudFNjb3BlcyA9IFtdXG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVidWcgZW5kcG9pbnQgdG9rZW4gbWF0Y2hlcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHByb3ZpZGVkVG9rZW4gLSBUb2tlbiBmcm9tIHRoZSByZXF1ZXN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZXhwZWN0ZWRUb2tlbiAtIENvbmZpZ3VyZWQgdG9rZW4uXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgYm90aCB0b2tlbnMgbWF0Y2guXG4gICAqL1xuICBkZWJ1Z0VuZHBvaW50VG9rZW5NYXRjaGVzKHByb3ZpZGVkVG9rZW4sIGV4cGVjdGVkVG9rZW4pIHtcbiAgICBsZXQgZGlmZmVyZW5jZSA9IHByb3ZpZGVkVG9rZW4ubGVuZ3RoIF4gZXhwZWN0ZWRUb2tlbi5sZW5ndGhcbiAgICBjb25zdCBtYXhMZW5ndGggPSBNYXRoLm1heChwcm92aWRlZFRva2VuLmxlbmd0aCwgZXhwZWN0ZWRUb2tlbi5sZW5ndGgpXG5cbiAgICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgbWF4TGVuZ3RoOyBpbmRleCsrKSB7XG4gICAgICBkaWZmZXJlbmNlIHw9IChwcm92aWRlZFRva2VuLmNoYXJDb2RlQXQoaW5kZXgpIHx8IDApIF4gKGV4cGVjdGVkVG9rZW4uY2hhckNvZGVBdChpbmRleCkgfHwgMClcbiAgICB9XG5cbiAgICByZXR1cm4gZGlmZmVyZW5jZSA9PT0gMFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGZyYW1ld29yayBzb3VyY2UgZGlyZWN0b3J5LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSAtIFZlbG9jaW91cyBzb3VyY2UgZGlyZWN0b3J5IHVzZWQgdG8gZmlsdGVyIGZyYW1ld29yayBzdGFjayBmcmFtZXMuXG4gICAqL1xuICBnZXRGcmFtZXdvcmtTb3VyY2VEaXJlY3RvcnkoKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIEF1dG8tZGlzY292ZXJzIHJlc291cmNlIGNsYXNzZXMuIE5vLW9wIGluIGJhc2UgaGFuZGxlcjsgb3ZlcnJpZGRlbiBpbiBOb2RlIGhhbmRsZXIuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBfY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgYXV0b0Rpc2NvdmVyUmVzb3VyY2VzKF9jb25maWd1cmF0aW9uKSB7fVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1biB3aXRoIHRpbWV6b25lIG9mZnNldC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IF9vZmZzZXRNaW51dGVzIC0gT2Zmc2V0IGluIG1pbnV0ZXMgKERhdGUjZ2V0VGltZXpvbmVPZmZzZXQpLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjYWxsYmFjayAtIENhbGxiYWNrIHRvIHJ1bi5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc3VsdCBvZiB0aGUgY2FsbGJhY2suXG4gICAqL1xuICBhc3luYyBydW5XaXRoVGltZXpvbmVPZmZzZXQoX29mZnNldE1pbnV0ZXMsIGNhbGxiYWNrKSB7XG4gICAgaWYgKCF0aGlzLmNvbmZpZ3VyYXRpb24pIHRocm93IG5ldyBFcnJvcihcIkNvbmZpZ3VyYXRpb24gaGFzbid0IGJlZW4gc2V0XCIpXG5cbiAgICBjb25zdCBwcmV2aW91c09mZnNldE1pbnV0ZXMgPSB0aGlzLmNvbmZpZ3VyYXRpb24uX3RpbWV6b25lT2Zmc2V0TWludXRlc1xuXG4gICAgdGhpcy5jb25maWd1cmF0aW9uLl90aW1lem9uZU9mZnNldE1pbnV0ZXMgPSBfb2Zmc2V0TWludXRlc1xuXG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBhd2FpdCBjYWxsYmFjaygpXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMuY29uZmlndXJhdGlvbi5fdGltZXpvbmVPZmZzZXRNaW51dGVzID0gcHJldmlvdXNPZmZzZXRNaW51dGVzXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcnVuIHdpdGggdGltZXpvbmUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0aW1lWm9uZSAtIElBTkEgdGltZXpvbmUgaWRlbnRpZmllci5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY2FsbGJhY2sgLSBDYWxsYmFjayB0byBydW4uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXN1bHQgb2YgdGhlIGNhbGxiYWNrLlxuICAgKi9cbiAgYXN5bmMgcnVuV2l0aFRpbWV6b25lKHRpbWVab25lLCBjYWxsYmFjaykge1xuICAgIGlmICghdGhpcy5jb25maWd1cmF0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJDb25maWd1cmF0aW9uIGhhc24ndCBiZWVuIHNldFwiKVxuXG4gICAgY29uc3QgcHJldmlvdXNUaW1lWm9uZSA9IHRoaXMuY29uZmlndXJhdGlvbi5fdGltZVpvbmVcblxuICAgIHRoaXMuY29uZmlndXJhdGlvbi5fdGltZVpvbmUgPSB2YWxpZGF0ZVRpbWVab25lKHRpbWVab25lLCBcInRpbWVab25lXCIpXG5cbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKClcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdGhpcy5jb25maWd1cmF0aW9uLl90aW1lWm9uZSA9IHByZXZpb3VzVGltZVpvbmVcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgdGltZXpvbmUgb2Zmc2V0LlxuICAgKiBAcGFyYW0ge251bWJlcn0gX29mZnNldE1pbnV0ZXMgLSBPZmZzZXQgaW4gbWludXRlcyAoRGF0ZSNnZXRUaW1lem9uZU9mZnNldCkuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldFRpbWV6b25lT2Zmc2V0KF9vZmZzZXRNaW51dGVzKSB7XG4gICAgaWYgKCF0aGlzLmNvbmZpZ3VyYXRpb24pIHRocm93IG5ldyBFcnJvcihcIkNvbmZpZ3VyYXRpb24gaGFzbid0IGJlZW4gc2V0XCIpXG5cbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge251bWJlcn0gKi9cbiAgICB0aGlzLmNvbmZpZ3VyYXRpb24uX3RpbWV6b25lT2Zmc2V0TWludXRlcyA9IF9vZmZzZXRNaW51dGVzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgdGltZXpvbmUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0aW1lWm9uZSAtIElBTkEgdGltZXpvbmUgaWRlbnRpZmllci5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0VGltZXpvbmUodGltZVpvbmUpIHtcbiAgICBpZiAoIXRoaXMuY29uZmlndXJhdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiQ29uZmlndXJhdGlvbiBoYXNuJ3QgYmVlbiBzZXRcIilcblxuICAgIHRoaXMuY29uZmlndXJhdGlvbi5fdGltZVpvbmUgPSB2YWxpZGF0ZVRpbWVab25lKHRpbWVab25lLCBcInRpbWVab25lXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdGltZXpvbmUgb2Zmc2V0IG1pbnV0ZXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSBjb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBPZmZzZXQgaW4gbWludXRlcy5cbiAgICovXG4gIGdldFRpbWV6b25lT2Zmc2V0TWludXRlcyhjb25maWd1cmF0aW9uKSB7XG4gICAgY29uc3QgYWN0aXZlQ29uZmlndXJhdGlvbiA9IGNvbmZpZ3VyYXRpb24gfHwgdGhpcy5jb25maWd1cmF0aW9uXG5cbiAgICBpZiAoIWFjdGl2ZUNvbmZpZ3VyYXRpb24pIHRocm93IG5ldyBFcnJvcihcIkNvbmZpZ3VyYXRpb24gaGFzbid0IGJlZW4gc2V0XCIpXG5cbiAgICBpZiAodHlwZW9mIGFjdGl2ZUNvbmZpZ3VyYXRpb24uX3RpbWV6b25lT2Zmc2V0TWludXRlcyA9PT0gXCJudW1iZXJcIikge1xuICAgICAgcmV0dXJuIGFjdGl2ZUNvbmZpZ3VyYXRpb24uX3RpbWV6b25lT2Zmc2V0TWludXRlc1xuICAgIH1cblxuICAgIHJldHVybiAvKiogQHR5cGUge251bWJlcn0gKi8gKGFjdGl2ZUNvbmZpZ3VyYXRpb24uZ2V0VGltZXpvbmVPZmZzZXRNaW51dGVzKCkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdGltZXpvbmUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSBjb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBUaW1lem9uZSBpZGVudGlmaWVyLlxuICAgKi9cbiAgZ2V0VGltZVpvbmUoY29uZmlndXJhdGlvbikge1xuICAgIGNvbnN0IGFjdGl2ZUNvbmZpZ3VyYXRpb24gPSBjb25maWd1cmF0aW9uIHx8IHRoaXMuY29uZmlndXJhdGlvblxuXG4gICAgaWYgKCFhY3RpdmVDb25maWd1cmF0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJDb25maWd1cmF0aW9uIGhhc24ndCBiZWVuIHNldFwiKVxuXG4gICAgcmV0dXJuIGFjdGl2ZUNvbmZpZ3VyYXRpb24uZ2V0VGltZVpvbmUoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcnVuIHdpdGggcmVxdWVzdCB0aW1pbmcuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3JlcXVlc3QtdGltaW5nLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IHJlcXVlc3RUaW1pbmcgLSBSZXF1ZXN0IHRpbWluZyBjb2xsZWN0b3IuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGNhbGxiYWNrIC0gQ2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBydW5XaXRoUmVxdWVzdFRpbWluZyhyZXF1ZXN0VGltaW5nLCBjYWxsYmFjaykge1xuICAgIHRoaXMuX2N1cnJlbnRSZXF1ZXN0VGltaW5nID0gcmVxdWVzdFRpbWluZ1xuXG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBhd2FpdCBjYWxsYmFjaygpXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMuX2N1cnJlbnRSZXF1ZXN0VGltaW5nID0gdW5kZWZpbmVkXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGN1cnJlbnQgcmVxdWVzdCB0aW1pbmcuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9odHRwLXNlcnZlci9jbGllbnQvcmVxdWVzdC10aW1pbmcuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gLSBDdXJyZW50IHJlcXVlc3QgdGltaW5nIGNvbGxlY3Rvci5cbiAgICovXG4gIGdldEN1cnJlbnRSZXF1ZXN0VGltaW5nKCkge1xuICAgIHJldHVybiB0aGlzLl9jdXJyZW50UmVxdWVzdFRpbWluZ1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcnVuIHdpdGggYWJpbGl0eS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9hdXRob3JpemF0aW9uL2FiaWxpdHkuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gYWJpbGl0eSAtIEFiaWxpdHkgdG8gc2V0IGZvciBjYWxsYmFjayBzY29wZS5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY2FsbGJhY2sgLSBDYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHJ1bldpdGhBYmlsaXR5KGFiaWxpdHksIGNhbGxiYWNrKSB7XG4gICAgdGhpcy5fY3VycmVudEFiaWxpdHkgPSBhYmlsaXR5XG5cbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKClcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdGhpcy5fY3VycmVudEFiaWxpdHkgPSB1bmRlZmluZWRcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgY3VycmVudCBhYmlsaXR5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSBhYmlsaXR5IC0gQWJpbGl0eSB0byBzZXQuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldEN1cnJlbnRBYmlsaXR5KGFiaWxpdHkpIHtcbiAgICB0aGlzLl9jdXJyZW50QWJpbGl0eSA9IGFiaWxpdHlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBjdXJyZW50IGFiaWxpdHkuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9hdXRob3JpemF0aW9uL2FiaWxpdHkuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gLSBDdXJyZW50IGFiaWxpdHkuXG4gICAqL1xuICBnZXRDdXJyZW50QWJpbGl0eSgpIHtcbiAgICByZXR1cm4gdGhpcy5fY3VycmVudEFiaWxpdHlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1biB3aXRoIHRlbmFudC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdGVuYW50IC0gVGVuYW50IHRvIHNldCBmb3IgY2FsbGJhY2sgc2NvcGUuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGNhbGxiYWNrIC0gQ2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBydW5XaXRoVGVuYW50KHRlbmFudCwgY2FsbGJhY2spIHtcbiAgICBjb25zdCBzY29wZSA9IHtvd25lcjogU3ltYm9sKFwiYnJvd3Nlci10ZW5hbnQtc2NvcGVcIiksIHRlbmFudH1cblxuICAgIHRoaXMuX3RlbmFudFNjb3Blcy5wdXNoKHNjb3BlKVxuXG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBhd2FpdCBjYWxsYmFjaygpXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGNvbnN0IHNjb3BlSW5kZXggPSB0aGlzLl90ZW5hbnRTY29wZXMuZmluZEluZGV4KChjYW5kaWRhdGUpID0+IGNhbmRpZGF0ZS5vd25lciA9PT0gc2NvcGUub3duZXIpXG5cbiAgICAgIGlmIChzY29wZUluZGV4ICE9PSAtMSkgdGhpcy5fdGVuYW50U2NvcGVzLnNwbGljZShzY29wZUluZGV4LCAxKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBjdXJyZW50IHRlbmFudC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdGVuYW50IC0gVGVuYW50IHRvIHNldC5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0Q3VycmVudFRlbmFudCh0ZW5hbnQpIHtcbiAgICB0aGlzLl9jdXJyZW50VGVuYW50ID0gdGVuYW50XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgY3VycmVudCB0ZW5hbnQuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBDdXJyZW50IHRlbmFudC5cbiAgICovXG4gIGdldEN1cnJlbnRUZW5hbnQoKSB7XG4gICAgcmV0dXJuIHRoaXMuX3RlbmFudFNjb3Blc1t0aGlzLl90ZW5hbnRTY29wZXMubGVuZ3RoIC0gMV0/LnRlbmFudCA/PyB0aGlzLl9jdXJyZW50VGVuYW50XG4gIH1cbiAgLyoqXG4gICAqIFJ1bnMgY2xpIGNvbW1hbmRzIGdlbmVyYXRlIGJhc2UgbW9kZWxzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NsaS9iYXNlLWNvbW1hbmQuanNcIikuZGVmYXVsdH0gX2NvbW1hbmQgLSBDb21tYW5kLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY29tbWFuZCByZXN1bHQuXG4gICAqL1xuICBhc3luYyBjbGlDb21tYW5kc0dlbmVyYXRlQmFzZU1vZGVscyhfY29tbWFuZCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcImNsaUNvbW1hbmRzR2VuZXJhdGVCYXNlTW9kZWxzIG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xpIGNvbW1hbmRzIGdlbmVyYXRlIGZyb250ZW5kIG1vZGVscy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jbGkvYmFzZS1jb21tYW5kLmpzXCIpLmRlZmF1bHR9IF9jb21tYW5kIC0gQ29tbWFuZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNvbW1hbmQgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgY2xpQ29tbWFuZHNHZW5lcmF0ZUZyb250ZW5kTW9kZWxzKF9jb21tYW5kKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiY2xpQ29tbWFuZHNHZW5lcmF0ZUZyb250ZW5kTW9kZWxzIG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xpIGNvbW1hbmRzIGluaXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiKS5kZWZhdWx0fSBjb21tYW5kIC0gQ29tbWFuZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNvbW1hbmQgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgY2xpQ29tbWFuZHNJbml0KGNvbW1hbmQpIHsgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby11bnVzZWQtdmFyc1xuICAgIHRocm93IG5ldyBFcnJvcihcImNsaUNvbW1hbmRzSW5pdCBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsaSBjb21tYW5kcyBtaWdyYXRpb24gZ2VuZXJhdGUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiKS5kZWZhdWx0fSBfY29tbWFuZCAtIENvbW1hbmQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjb21tYW5kIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGNsaUNvbW1hbmRzTWlncmF0aW9uR2VuZXJhdGUoX2NvbW1hbmQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJjbGlDb21tYW5kc01pZ3JhdGlvbkdlbmVyYXRlIG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xpIGNvbW1hbmRzIG1pZ3JhdGlvbiBkZXN0cm95LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NsaS9iYXNlLWNvbW1hbmQuanNcIikuZGVmYXVsdH0gX2NvbW1hbmQgLSBDb21tYW5kLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY29tbWFuZCByZXN1bHQuXG4gICAqL1xuICBhc3luYyBjbGlDb21tYW5kc01pZ3JhdGlvbkRlc3Ryb3koX2NvbW1hbmQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJjbGlDb21tYW5kc01pZ3JhdGlvbkRlc3Ryb3kgbm90IGltcGxlbWVudGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGkgY29tbWFuZHMgZ2VuZXJhdGUgbW9kZWwuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiKS5kZWZhdWx0fSBfY29tbWFuZCAtIENvbW1hbmQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjb21tYW5kIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGNsaUNvbW1hbmRzR2VuZXJhdGVNb2RlbChfY29tbWFuZCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcImNsaUNvbW1hbmRzR2VuZXJhdGVNb2RlbCBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsaSBjb21tYW5kcyBsaW50IHJlbGF0aW9uc2hpcHMuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NsaS9iYXNlLWNvbW1hbmQuanNcIikuZGVmYXVsdH0gX2NvbW1hbmQgLSBDb21tYW5kLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY29tbWFuZCByZXN1bHQuXG4gICAqL1xuICBhc3luYyBjbGlDb21tYW5kc0xpbnRSZWxhdGlvbnNoaXBzKF9jb21tYW5kKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiY2xpQ29tbWFuZHNMaW50UmVsYXRpb25zaGlwcyBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsaSBjb21tYW5kcyByb3V0ZXMuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NsaS9iYXNlLWNvbW1hbmQuanNcIikuZGVmYXVsdH0gX2NvbW1hbmQgLSBDb21tYW5kLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY29tbWFuZCByZXN1bHQuXG4gICAqL1xuICBhc3luYyBjbGlDb21tYW5kc1JvdXRlcyhfY29tbWFuZCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcImNsaUNvbW1hbmRzUm91dGVzIG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xpIGNvbW1hbmRzIGNvbnNvbGUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiKS5kZWZhdWx0fSBfY29tbWFuZCAtIENvbW1hbmQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjb21tYW5kIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGNsaUNvbW1hbmRzQ29uc29sZShfY29tbWFuZCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcImNsaUNvbW1hbmRzQ29uc29sZSBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsaSBjb21tYW5kcyBtY3AuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiKS5kZWZhdWx0fSBfY29tbWFuZCAtIENvbW1hbmQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIGNvbW1hbmQgY29tcGxldGVzLlxuICAgKi9cbiAgYXN5bmMgY2xpQ29tbWFuZHNNY3AoX2NvbW1hbmQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJjbGlDb21tYW5kc01jcCBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsaSBjb21tYW5kcyBzZXJ2ZXIuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiKS5kZWZhdWx0fSBfY29tbWFuZCAtIENvbW1hbmQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjb21tYW5kIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGNsaUNvbW1hbmRzU2VydmVyKF9jb21tYW5kKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiY2xpQ29tbWFuZHNTZXJ2ZXIgbm90IGltcGxlbWVudGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGkgY29tbWFuZHMgdGVzdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jbGkvYmFzZS1jb21tYW5kLmpzXCIpLmRlZmF1bHR9IF9jb21tYW5kIC0gQ29tbWFuZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNvbW1hbmQgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgY2xpQ29tbWFuZHNUZXN0KF9jb21tYW5kKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiY2xpQ29tbWFuZHNUZXN0IG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xpIGNvbW1hbmRzIHRlc3QgdGltaW5nIG1hbmlmZXN0IG1lcmdlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NsaS9iYXNlLWNvbW1hbmQuanNcIikuZGVmYXVsdH0gX2NvbW1hbmQgLSBDb21tYW5kLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY29tbWFuZCByZXN1bHQuXG4gICAqL1xuICBhc3luYyBjbGlDb21tYW5kc1Rlc3RUaW1pbmdNYW5pZmVzdE1lcmdlKF9jb21tYW5kKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiY2xpQ29tbWFuZHNUZXN0VGltaW5nTWFuaWZlc3RNZXJnZSBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsaSBjb21tYW5kcyBiYWNrZ3JvdW5kIGpvYnMgbWFpbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jbGkvYmFzZS1jb21tYW5kLmpzXCIpLmRlZmF1bHR9IF9jb21tYW5kIC0gQ29tbWFuZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNvbW1hbmQgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgY2xpQ29tbWFuZHNCYWNrZ3JvdW5kSm9ic01haW4oX2NvbW1hbmQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJjbGlDb21tYW5kc0JhY2tncm91bmRKb2JzTWFpbiBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIENMSSBiYWNrZ3JvdW5kLWpvYnMgYWN0aXZhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jbGkvYmFzZS1jb21tYW5kLmpzXCIpLmRlZmF1bHR9IF9jb21tYW5kIC0gQ29tbWFuZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGNsaUNvbW1hbmRzQmFja2dyb3VuZEpvYnNBY3RpdmF0ZShfY29tbWFuZCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcImNsaUNvbW1hbmRzQmFja2dyb3VuZEpvYnNBY3RpdmF0ZSBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIENMSSBiYWNrZ3JvdW5kLWpvYnMgcmV0aXJlbWVudC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jbGkvYmFzZS1jb21tYW5kLmpzXCIpLmRlZmF1bHR9IF9jb21tYW5kIC0gQ29tbWFuZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGNsaUNvbW1hbmRzQmFja2dyb3VuZEpvYnNSZXRpcmUoX2NvbW1hbmQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJjbGlDb21tYW5kc0JhY2tncm91bmRKb2JzUmV0aXJlIG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xpIGNvbW1hbmRzIGJhY2tncm91bmQgam9icyB3b3JrZXIuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiKS5kZWZhdWx0fSBfY29tbWFuZCAtIENvbW1hbmQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjb21tYW5kIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGNsaUNvbW1hbmRzQmFja2dyb3VuZEpvYnNXb3JrZXIoX2NvbW1hbmQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJjbGlDb21tYW5kc0JhY2tncm91bmRKb2JzV29ya2VyIG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xpIGNvbW1hbmRzIGJhY2tncm91bmQgam9icyBydW5uZXIuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiKS5kZWZhdWx0fSBfY29tbWFuZCAtIENvbW1hbmQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjb21tYW5kIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGNsaUNvbW1hbmRzQmFja2dyb3VuZEpvYnNSdW5uZXIoX2NvbW1hbmQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJjbGlDb21tYW5kc0JhY2tncm91bmRKb2JzUnVubmVyIG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xpIGNvbW1hbmRzIGJlYWNvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jbGkvYmFzZS1jb21tYW5kLmpzXCIpLmRlZmF1bHR9IF9jb21tYW5kIC0gQ29tbWFuZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNvbW1hbmQgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgY2xpQ29tbWFuZHNCZWFjb24oX2NvbW1hbmQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJjbGlDb21tYW5kc0JlYWNvbiBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBMb2FkcyB0aGUgVENQLWJhY2tlZCBCZWFjb24gY2xpZW50IGNsYXNzLiBSb3V0ZWQgdGhyb3VnaCB0aGVcbiAgICogZW52aXJvbm1lbnQgaGFuZGxlciBzbyB0aGUgZHluYW1pYyBgaW1wb3J0KFwiLi4vYmVhY29uL2NsaWVudC5qc1wiKWBcbiAgICogY2FsbCBsaXZlcyBvbiB0aGUgTm9kZS1vbmx5IHBhdGgg4oCUIGtlZXBzIEJlYWNvbidzIGBub2RlOm5ldGAgL1xuICAgKiBgbm9kZTpjcnlwdG9gIGRlcHMgb3V0IG9mIGJyb3dzZXIgYnVuZGxlcyB0aGF0IHN0YXRpY2FsbHkgcmVhY2hcbiAgICogYENvbmZpZ3VyYXRpb25gIChhbmQgdGhlcmVmb3JlIHByZXZpb3VzbHkgcmVhY2hlZCB0aGUgZHluYW1pY1xuICAgKiBpbXBvcnRzKS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dHlwZW9mIGltcG9ydChcIi4uL2JlYWNvbi9jbGllbnQuanNcIikuZGVmYXVsdD59IC0gQmVhY29uIGNsaWVudCBjbGFzcy5cbiAgICovXG4gIGFzeW5jIGxvYWRCZWFjb25DbGllbnQoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwibG9hZEJlYWNvbkNsaWVudCBub3QgaW1wbGVtZW50ZWQgYnkgdGhpcyBlbnZpcm9ubWVudCBoYW5kbGVyXCIpXG4gIH1cblxuICAvKipcbiAgICogTG9hZHMgdGhlIGluLXByb2Nlc3MgQmVhY29uIGNsaWVudCBjbGFzcy4gU2FtZSBpbmRpcmVjdGlvbiByYXRpb25hbGVcbiAgICogYXMgYGxvYWRCZWFjb25DbGllbnRgLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx0eXBlb2YgaW1wb3J0KFwiLi4vYmVhY29uL2luLXByb2Nlc3MtY2xpZW50LmpzXCIpLmRlZmF1bHQ+fSAtIEluLXByb2Nlc3MgY2xpZW50IGNsYXNzLlxuICAgKi9cbiAgYXN5bmMgbG9hZEluUHJvY2Vzc0JlYWNvbkNsaWVudCgpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJsb2FkSW5Qcm9jZXNzQmVhY29uQ2xpZW50IG5vdCBpbXBsZW1lbnRlZCBieSB0aGlzIGVudmlyb25tZW50IGhhbmRsZXJcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsaSBjb21tYW5kcyBkYiBzY2hlbWEgZHVtcC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jbGkvYmFzZS1jb21tYW5kLmpzXCIpLmRlZmF1bHR9IF9jb21tYW5kIC0gQ29tbWFuZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNvbW1hbmQgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgY2xpQ29tbWFuZHNEYlNjaGVtYUR1bXAoX2NvbW1hbmQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJjbGlDb21tYW5kc0RiU2NoZW1hRHVtcCBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsaSBjb21tYW5kcyBkYiBzY2hlbWEgbG9hZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jbGkvYmFzZS1jb21tYW5kLmpzXCIpLmRlZmF1bHR9IF9jb21tYW5kIC0gQ29tbWFuZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNvbW1hbmQgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgY2xpQ29tbWFuZHNEYlNjaGVtYUxvYWQoX2NvbW1hbmQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJjbGlDb21tYW5kc0RiU2NoZW1hTG9hZCBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsaSBjb21tYW5kcyBkYiBzZWVkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NsaS9iYXNlLWNvbW1hbmQuanNcIikuZGVmYXVsdH0gX2NvbW1hbmQgLSBDb21tYW5kLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY29tbWFuZCByZXN1bHQuXG4gICAqL1xuICBhc3luYyBjbGlDb21tYW5kc0RiU2VlZChfY29tbWFuZCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcImNsaUNvbW1hbmRzRGJTZWVkIG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xpIGNvbW1hbmRzIHJ1bm5lci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jbGkvYmFzZS1jb21tYW5kLmpzXCIpLmRlZmF1bHR9IF9jb21tYW5kIC0gQ29tbWFuZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNvbW1hbmQgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgY2xpQ29tbWFuZHNSdW5uZXIoX2NvbW1hbmQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJjbGlDb21tYW5kc1J1bm5lciBub3QgaW1wbGVtZW50ZWRcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsaSBjb21tYW5kcyBydW4gc2NyaXB0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NsaS9iYXNlLWNvbW1hbmQuanNcIikuZGVmYXVsdH0gX2NvbW1hbmQgLSBDb21tYW5kLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY29tbWFuZCByZXN1bHQuXG4gICAqL1xuICBhc3luYyBjbGlDb21tYW5kc1J1blNjcmlwdChfY29tbWFuZCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcImNsaUNvbW1hbmRzUnVuU2NyaXB0IG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmluZCBjb21tYW5kcy5cbiAgICogQGFic3RyYWN0XG4gICAqIEByZXR1cm5zIHtQcm9taXNlPENvbW1hbmRGaWxlT2JqZWN0VHlwZVtdPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjb21tYW5kcy5cbiAgICovXG4gIGFzeW5jIGZpbmRDb21tYW5kcygpIHsgdGhyb3cgbmV3IEVycm9yKFwiZmluZENvbW1hbmRzIG5vdCBpbXBsZW1lbnRlZFwiKSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmluZCBtaWdyYXRpb25zLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHJldHVybnMge1Byb21pc2U8QXJyYXk8TWlncmF0aW9uT2JqZWN0VHlwZT4+fSAtIFJlc29sdmVzIHdpdGggdGhlIG1pZ3JhdGlvbnMuXG4gICAqL1xuICBhc3luYyBmaW5kTWlncmF0aW9ucygpIHsgdGhyb3cgbmV3IEVycm9yKFwiZmluZE1pZ3JhdGlvbnMgbm90IGltcGxlbW5ldGVkXCIpIH1cblxuICAvKipcbiAgICogUnVucyBmb3J3YXJkIGNvbW1hbmQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiKS5kZWZhdWx0fSBjb21tYW5kIC0gQ29tbWFuZC5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiKS5kZWZhdWx0fSBDb21tYW5kQ2xhc3MgLSBDb21tYW5kIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY29tbWFuZCByZXN1bHQuXG4gICAqL1xuICBhc3luYyBmb3J3YXJkQ29tbWFuZChjb21tYW5kLCBDb21tYW5kQ2xhc3MpIHtcbiAgICBjb25zdCBuZXdDb21tYW5kID0gbmV3IENvbW1hbmRDbGFzcyh7XG4gICAgICBhcmdzOiBjb21tYW5kLmFyZ3MsXG4gICAgICBjbGk6IGNvbW1hbmQuY2xpXG4gICAgfSlcblxuICAgIHJldHVybiBhd2FpdCBuZXdDb21tYW5kLmV4ZWN1dGUoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHZlbG9jaW91cyBwYXRoLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSB2ZWxvY2lvdXMgcGF0aC5cbiAgICovXG4gIGdldFZlbG9jaW91c1BhdGgoKSB7IHRocm93IG5ldyBFcnJvcihcImdldFZlbG9jaW91c1BhdGggbm90IGltcGxlbWVudGVkXCIpIH1cblxuICAvKipcbiAgICogUnVucyBpbXBvcnQgYXBwbGljYXRpb24gcm91dGVzLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi4vcm91dGVzL2luZGV4LmpzXCIpLmRlZmF1bHQ+fSAtIFJlc29sdmVzIHdpdGggdGhlIGltcG9ydCBhcHBsaWNhdGlvbiByb3V0ZXMuXG4gICAqL1xuICBhc3luYyBpbXBvcnRBcHBsaWNhdGlvblJvdXRlcygpIHsgdGhyb3cgbmV3IEVycm9yKFwiaW1wb3J0QXBwbGljYXRpb25Sb3V0ZXMgbm90IGltcGxlbWVudGVkXCIpIH1cblxuICAvKipcbiAgICogUnVucyBpbXBvcnQgdGVzdCBmaWxlcy5cbiAgICogQGFic3RyYWN0XG4gICAqIEBwYXJhbSB7c3RyaW5nW119IF90ZXN0RmlsZXMgLSBUZXN0IGZpbGVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgaW1wb3J0VGVzdEZpbGVzKF90ZXN0RmlsZXMpIHsgdGhyb3cgbmV3IEVycm9yKFwiJ2ltcG9ydFRlc3RGaWxlcycgbm90IGltcGxlbWVudGVkXCIpIH1cblxuICAvKipcbiAgICogUnVucyBpbXBvcnQgdGVzdGluZyBjb25maWcgcGF0aC5cbiAgICogQGFic3RyYWN0XG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBpbXBvcnRUZXN0aW5nQ29uZmlnUGF0aCgpIHsgdGhyb3cgbmV3IEVycm9yKGAnaW1wb3J0VGVzdGluZ0NvbmZpZ1BhdGgnIG5vdCBpbXBsZW1lbnRlZGApIH1cblxuICAvKipcbiAgICogUnVucyBhZnRlciBtaWdyYXRpb25zLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0Pn0gYXJncy5kYnMgLSBEYnMuXG4gICAqIEBwYXJhbSB7XCJtaWdyYXRpb25cIiB8IFwic2NoZW1hRHVtcFwifSBbYXJncy5yZWFzb25dIC0gV2h5IHRoZSBzdHJ1Y3R1cmUgd3JpdGUgaG9vayBpcyBiZWluZyBpbnZva2VkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgYWZ0ZXJNaWdyYXRpb25zKGFyZ3MpIHsgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby11bnVzZWQtdmFyc1xuICAgIHJldHVyblxuICB9XG5cbiAgLyoqXG4gICAqIEVuc3VyZXMgdmVsb2Npb3VzJyBvd24gZnJhbWV3b3JrLW93bmVkIHNjaGVtYSAoZS5nLiB0aGUgYmFja2dyb3VuZC1qb2JzXG4gICAqIHRhYmxlcykgZXhpc3RzIGFmdGVyIGFwcCBtaWdyYXRpb25zIHJ1biwgc28gYGRiOm1pZ3JhdGVgIHByb2R1Y2VzIGEgY29tcGxldGVcbiAgICogc2NoZW1hIGRldGVybWluaXN0aWNhbGx5IGluc3RlYWQgb2YgaXQgb25seSBhcHBlYXJpbmcgb25jZSBhIHJ1bnRpbWUgc3RvcmVcbiAgICogYm9vdHMuIFJ1bnMgYmVmb3JlIHRoZSBzdHJ1Y3R1cmUgZHVtcC4gTm8tb3AgYnkgZGVmYXVsdDsgdGhlIG5vZGUgaGFuZGxlclxuICAgKiBvdmVycmlkZXMgaXQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQ+fSBhcmdzLmRicyAtIERicyBiZWluZyBtaWdyYXRlZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGVuc3VyZUZyYW1ld29ya1NjaGVtYShhcmdzKSB7IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tdW51c2VkLXZhcnNcbiAgICByZXR1cm5cbiAgfVxuXG4gIC8qKlxuICAgKiBDcmVhdGVzIHRoZSBlbnZpcm9ubWVudCdzIGRlZmF1bHQgcGVyc2lzdGVuY2UgYWRhcHRlci5cbiAgICogQGFic3RyYWN0XG4gICAqIEBwYXJhbSB7e2NvbmZpZ3VyYXRpb246IGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH19IF9hcmdzIC0gQWRhcHRlciBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vYmFja2dyb3VuZC1qb2JzL2FkYXB0ZXIuanNcIikuZGVmYXVsdH0gLSBEZWZhdWx0IGFkYXB0ZXIuXG4gICAqL1xuICBjcmVhdGVCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIoX2FyZ3MpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJUaGlzIGVudmlyb25tZW50IHJlcXVpcmVzIGFuIGV4cGxpY2l0IGJhY2tncm91bmRKb2JzLmFkYXB0ZXJcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBDcmVhdGVzIHRoZSBwbGF0Zm9ybS1uZXV0cmFsIHByb2R1Y2VyIHBhdGggZm9yIGFuIGV4cGxpY2l0IGFkYXB0ZXIuXG4gICAqIEBwYXJhbSB7e2NvbmZpZ3VyYXRpb246IGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH19IGFyZ3MgLSBDbGllbnQgb3B0aW9ucy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2JhY2tncm91bmQtam9icy90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9ic1Byb2R1Y2VyfSAtIEFkYXB0ZXItYmFja2VkIHByb2R1Y2VyLlxuICAgKi9cbiAgYmFja2dyb3VuZEpvYnNDbGllbnQoYXJncykge1xuICAgIHJldHVybiBuZXcgQmFja2dyb3VuZEpvYnNBZGFwdGVyQ2xpZW50KGFyZ3MpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXF1aXJlIGNvbW1hbmQuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBhcmdzLmNvbW1hbmRQYXJ0cyAtIENvbW1hbmQgcGFydHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHR5cGVvZiBpbXBvcnQgKFwiLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiKS5kZWZhdWx0Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSByZXF1aXJlIGNvbW1hbmQuXG4gICAqL1xuICBhc3luYyByZXF1aXJlQ29tbWFuZCh7Y29tbWFuZFBhcnRzfSkgeyB0aHJvdyBuZXcgRXJyb3IoXCIncmVxdWlyZUNvbW1hbmQnIG5vdCBpbXBsZW1lbnRlZFwiKSB9IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tdW51c2VkLXZhcnNcblxuICAvKipcbiAgICogUnVucyBzZXQgYXJncy5cbiAgICogQHBhcmFtIHtvYmplY3R9IG5ld0FyZ3MgLSBOZXcgYXJncy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0QXJncyhuZXdBcmdzKSB7IHRoaXMuYXJncyA9IG5ld0FyZ3MgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gbmV3Q29uZmlndXJhdGlvbiAtIE5ldyBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRDb25maWd1cmF0aW9uKG5ld0NvbmZpZ3VyYXRpb24pIHsgdGhpcy5jb25maWd1cmF0aW9uID0gbmV3Q29uZmlndXJhdGlvbiB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVhZCBhdHRhY2htZW50IGlucHV0IGZpbGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBfZmlsZVBhdGggLSBGaWxlIHBhdGguXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEJ1ZmZlcj59IC0gRmlsZSBieXRlcy5cbiAgICovXG4gIGFzeW5jIHJlYWRBdHRhY2htZW50SW5wdXRGaWxlKF9maWxlUGF0aCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcIkF0dGFjaG1lbnQgZmlsZSByZWFkcyBhcmUgbm90IHN1cHBvcnRlZCBpbiB0aGlzIGVudmlyb25tZW50XCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXNvbHZlIGF0dGFjaG1lbnQgaW5wdXQgcGF0aC5cbiAgICogQHBhcmFtIHtvYmplY3R9IF9hcmdzIC0gQXJncy5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gX2FyZ3MuYWxsb3dlZFBhdGhQcmVmaXhlcyAtIEFsbG93ZWQgcGF0aCBwcmVmaXhlcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IF9hcmdzLmlucHV0UGF0aCAtIElucHV0IHBhdGguXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4uL2RhdGFiYXNlL3JlY29yZC9hdHRhY2htZW50cy9ub3JtYWxpemUtaW5wdXQuanNcIikuQXR0YWNobWVudFBhdGhTb3VyY2U+fSAtIE9wZW5lZCBwYXRoIHNvdXJjZS5cbiAgICovXG4gIGFzeW5jIHJlc29sdmVBdHRhY2htZW50SW5wdXRQYXRoKF9hcmdzKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiQXR0YWNobWVudCBwYXRoIGlucHV0IGlzIG5vdCBzdXBwb3J0ZWQgaW4gdGhpcyBlbnZpcm9ubWVudFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IC0gVGhlIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBnZXRDb25maWd1cmF0aW9uKCkge1xuICAgIGlmICghdGhpcy5jb25maWd1cmF0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJDb25maWd1cmF0aW9uIGhhc24ndCBiZWVuIHNldFwiKVxuXG4gICAgcmV0dXJuIHRoaXMuY29uZmlndXJhdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHByb2Nlc3MgYXJncy5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gbmV3UHJvY2Vzc0FyZ3MgLSBOZXcgcHJvY2VzcyBhcmdzLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRQcm9jZXNzQXJncyhuZXdQcm9jZXNzQXJncykgeyB0aGlzLnByb2Nlc3NBcmdzID0gbmV3UHJvY2Vzc0FyZ3MgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBkZWZhdWx0IGxvZyBkaXJlY3RvcnkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBfYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gX2FyZ3MuY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gVGhlIGRlZmF1bHQgbG9nIGRpcmVjdG9yeS5cbiAgICovXG4gIGdldERlZmF1bHRMb2dEaXJlY3RvcnkoX2FyZ3MpIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgbG9nIGZpbGUgcGF0aC5cbiAgICogQHBhcmFtIHtvYmplY3R9IF9hcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBfYXJncy5jb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IF9hcmdzLmRpcmVjdG9yeSAtIERpcmVjdG9yeSBwYXRoLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gX2FyZ3MuZW52aXJvbm1lbnQgLSBFbnZpcm9ubWVudC5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBUaGUgbG9nIGZpbGUgcGF0aC5cbiAgICovXG4gIGdldExvZ0ZpbGVQYXRoKF9hcmdzKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd3JpdGUgbG9nIHRvIGZpbGUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBfYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gX2FyZ3MuZmlsZVBhdGggLSBGaWxlIHBhdGguXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBfYXJncy5tZXNzYWdlIC0gTWVzc2FnZSB0ZXh0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgd3JpdGVMb2dUb0ZpbGUoX2FyZ3MpIHtcbiAgICByZXR1cm5cbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgZnJvbnRlbmQtbW9kZWwgd2Vic29ja2V0IGNoYW5uZWwgcHVibGlzaGVycyBzbyBsaWZlY3ljbGVcbiAgICogZXZlbnQgaG9va3MgKGNyZWF0ZS91cGRhdGUvZGVzdHJveSkgYnJvYWRjYXN0IG92ZXIgdGhlIHNoYXJlZFxuICAgKiBcImZyb250ZW5kLW1vZGVsc1wiIGNoYW5uZWwuIFRoZSBiYXNlIGhhbmRsZXIgaXMgYSBuby1vcCDigJQgb25seSB0aGVcbiAgICogTm9kZSBoYW5kbGVyIHBlcmZvcm1zIHRoZSByZWdpc3RyYXRpb24gYmVjYXVzZSB0aGUgcmVxdWlyZWRcbiAgICogYGZyb250ZW5kLW1vZGVsLWNvbnRyb2xsZXJgIGFuZCBgcm91dGVzL3Jlc29sdmVyYCBpbXBvcnRzIHB1bGwgaW5cbiAgICogc2VydmVyLW9ubHkgbW9kdWxlcyB0aGF0IGJyZWFrIGJyb3dzZXIgYnVuZGxlcnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBfY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBpbml0aWFsaXplRnJvbnRlbmRNb2RlbFdlYnNvY2tldFB1Ymxpc2hlcnMoX2NvbmZpZ3VyYXRpb24pIHtcbiAgICAvLyBOby1vcCBpbiBiYXNlIGhhbmRsZXI7IE5vZGUgaGFuZGxlciBkb2VzIHRoZSByZWFsIHJlZ2lzdHJhdGlvbi5cbiAgfVxuXG4gIC8qKlxuICAgKiBMb2FkcyBtb2RlbHMgY29udHJpYnV0ZWQgYnkgcmVnaXN0ZXJlZCBwYWNrYWdlcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IF9jb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGluaXRpYWxpemVQYWNrYWdlTW9kZWxzKF9jb25maWd1cmF0aW9uKSB7XG4gICAgLy8gTm8tb3AgaW4gYmFzZSBoYW5kbGVyOyBOb2RlIGhhbmRsZXIgbG9hZHMgcGFja2FnZSBtb2RlbHMgZnJvbSB0aGUgZmlsZXN5c3RlbS5cbiAgfVxufVxuIl19