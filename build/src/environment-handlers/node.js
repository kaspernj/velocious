// @ts-check
import "../database/annotations-async-hooks.js";
import AdvisoryLockFileBackend from "../database/advisory-lock-file-backend.js";
import AdvisoryLockLockServerBackend from "../database/advisory-lock-lock-server-backend.js";
import Base from "./base.js";
import BackgroundJobsClient from "../background-jobs/client.js";
import SqlBackgroundJobsAdapter from "../background-jobs/sql-adapter.js";
import CliCommandsDestroyMigration from "./node/cli/commands/destroy/migration.js";
import CliCommandsInit from "./node/cli/commands/init.js";
import CliCommandsGenerateBaseModels from "./node/cli/commands/generate/base-models.js";
import CliCommandsGenerateFrontendModels from "./node/cli/commands/generate/frontend-models.js";
import CliCommandsGenerateMigration from "./node/cli/commands/generate/migration.js";
import CliCommandsGenerateModel from "./node/cli/commands/generate/model.js";
import CliCommandsLintRelationships from "./node/cli/commands/lint/relationships.js";
import CliCommandsMcp from "./node/cli/commands/mcp.js";
import CliCommandsRoutes from "./node/cli/commands/routes.js";
import CliCommandsServer from "./node/cli/commands/server.js";
import CliCommandsTest from "./node/cli/commands/test.js";
import CliCommandsTestTimingManifestMerge from "./node/cli/commands/test/timing-manifest/merge.js";
import CliCommandsBackgroundJobsMain from "./node/cli/commands/background-jobs-main.js";
import CliCommandsBackgroundJobsActivate from "./node/cli/commands/background-jobs-activate.js";
import CliCommandsBackgroundJobsRetire from "./node/cli/commands/background-jobs-retire.js";
import CliCommandsBackgroundJobsWorker from "./node/cli/commands/background-jobs-worker.js";
import CliCommandsBackgroundJobsRunner from "./node/cli/commands/background-jobs-runner.js";
import CliCommandsBeacon from "./node/cli/commands/beacon.js";
import CliCommandsConsole from "./node/cli/commands/console.js";
import CliCommandsDbSchemaDump from "./node/cli/commands/db/schema/dump.js";
import CliCommandsDbSchemaLoad from "./node/cli/commands/db/schema/load.js";
import CliCommandsDbSeed from "./node/cli/commands/db/seed.js";
import CliCommandsRunner from "./node/cli/commands/runner.js";
import CliCommandsRunScript from "./node/cli/commands/run-script.js";
import frontendModelCommandRouteHook from "../routes/hooks/frontend-model-command-route-hook.js";
import { FRAMEWORK_SOURCE_DIRECTORY } from "../utils/backtrace-cleaner-node.js";
import { dirname } from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";
import * as inflection from "inflection";
import path from "path";
import { AsyncLocalStorage as NodeAsyncLocalStorage } from "node:async_hooks";
import { timingSafeEqual } from "node:crypto";
import requireContext from "require-context";
import AsyncTrackedMultiConnectionPool from "../database/pool/async-tracked-multi-connection.js";
import InitializerFromRequireContext from "../database/initializer-from-require-context.js";
import RecordAttachmentsStore from "../database/record/attachments/store.js";
import toImportSpecifier from "../utils/to-import-specifier.js";
import { validateTimeZone } from "../time-zone.js";
import AttachmentPathSource from "./node/attachment-path-source.js";
import { automaticSharedTransactionBrokerOmits, createSharedTransactionProxyDriver, sharedTransactionBrokerConfig } from "../testing/shared-transaction-proxy-driver.js";
/**
 * Defines this typedef.
 * @typedef {{ability?: import("../authorization/ability.js").default, offsetMinutes: number, requestTiming?: import("../http-server/client/request-timing.js").default, tenant?: ReturnType<typeof JSON.parse>, testProfileContext?: import("../testing/test-profiler.js").TestProfileAsyncContext, timeZone?: string}} TimezoneStore */
/**
 * Runs path within allowed prefixes.
 * @param {string} filePath - Input file path.
 * @param {string[]} allowedPathPrefixes - Allowed path prefixes.
 * @returns {boolean} - Whether input path is inside an allowed prefix.
 */
function pathWithinAllowedPrefixes(filePath, allowedPathPrefixes) {
    const resolvedPath = path.resolve(filePath);
    return allowedPathPrefixes.some((allowedPrefix) => {
        const resolvedPrefix = path.resolve(allowedPrefix);
        const relativePath = path.relative(resolvedPrefix, resolvedPath);
        if (!relativePath)
            return true;
        if (relativePath.startsWith(".."))
            return false;
        if (path.isAbsolute(relativePath))
            return false;
        return true;
    });
}
export default class VelociousEnvironmentHandlerNode extends Base {
    /**
     * Creates the built-in SQL persistence adapter.
     * @param {{configuration: import("../configuration.js").default}} args - Adapter options.
     * @returns {SqlBackgroundJobsAdapter} - SQL adapter.
     */
    createBackgroundJobsAdapter({ configuration }) {
        return new SqlBackgroundJobsAdapter({ configuration });
    }
    /**
     * Preserves the Node TCP producer and main-process wake-up path. The main
     * owns the configured persistence adapter; Node producers never bypass it.
     * @param {{configuration: import("../configuration.js").default}} args - Client options.
     * @returns {import("../background-jobs/types.js").BackgroundJobsProducer} - Producer client.
     */
    backgroundJobsClient({ configuration }) {
        return new BackgroundJobsClient({ configuration });
    }
    /**
     * Gives concurrent shared-transaction child jobs independent proxy sessions.
     * A configured single-connection pool shares mutable transaction state between
     * async jobs, while the broker requires one root-transaction lease per socket.
     * @param {{configuredPoolType: typeof import("../database/pool/base.js").default, databaseIdentifier: string}} args - Configured pool and logical database identifier.
     * @returns {typeof import("../database/pool/base.js").default} - Pool type for this context.
     */
    resolveTestSharedTransactionPoolType({ configuredPoolType, databaseIdentifier }) {
        const databaseConfiguration = this.getConfiguration().getDatabaseIdentifier(databaseIdentifier);
        if (databaseConfiguration.tenantOnly && automaticSharedTransactionBrokerOmits(databaseIdentifier))
            return configuredPoolType;
        if (!sharedTransactionBrokerConfig(databaseIdentifier))
            return configuredPoolType;
        return AsyncTrackedMultiConnectionPool;
    }
    /**
     * Creates the filesystem-backed advisory-lock backend for the file tier
     * (STC-213). The Node handler is the only filesystem-capable environment.
     * @param {{directory: string, leaseMs: number, renewIntervalMs: number}} args - Backend options.
     * @returns {Promise<import("../database/advisory-lock-file-backend.js").default>} - Resolves with the created backend.
     */
    async createAdvisoryLockFileBackend(args) {
        return new AdvisoryLockFileBackend(args);
    }
    /**
     * Creates the lock-server advisory-lock backend over the Node websocket transport.
     * @param {ConstructorParameters<typeof AdvisoryLockLockServerBackend>[0]} args - Backend options.
     * @returns {Promise<import("../database/advisory-lock-lock-server-backend.js").default>} - Created backend.
     */
    async createAdvisoryLockLockServerBackend(args) {
        return new AdvisoryLockLockServerBackend(args);
    }
    /**
     * Creates a test-only child proxy when TestRunner supplied an active broker.
     * @param {{DriverClass: typeof import("../database/drivers/base.js").default, config: import("../configuration-types.js").DatabaseConfigurationType, configuration: import("../configuration.js").default, databaseIdentifier: string, reuseKey?: string}} args - Connection details.
     * @returns {Promise<import("../database/drivers/base.js").default | undefined>} - Optional proxy.
     */
    async createTestSharedTransactionConnection({ DriverClass, config, configuration, databaseIdentifier, reuseKey }) {
        if (config.tenantOnly && automaticSharedTransactionBrokerOmits(databaseIdentifier))
            return undefined;
        const brokerConfig = sharedTransactionBrokerConfig(databaseIdentifier);
        if (!brokerConfig)
            return undefined;
        return createSharedTransactionProxyDriver(DriverClass, config, configuration, databaseIdentifier, {
            ...brokerConfig,
            reuseKey: brokerConfig.allowDynamicIdentities ? reuseKey : undefined
        });
    }
    /**
     * Timezone async local storage.
     * @type {import("node:async_hooks").AsyncLocalStorage<TimezoneStore> | undefined} */
    _timezoneAsyncLocalStorage = NodeAsyncLocalStorage ? new NodeAsyncLocalStorage() : undefined;
    /**
     * Shared-transaction coordinator ownership by physical connection.
     * @type {import("node:async_hooks").AsyncLocalStorage<Map<object, symbol>> | undefined}
     */
    _sharedTransactionCoordinatorAsyncLocalStorage = NodeAsyncLocalStorage ? new NodeAsyncLocalStorage() : undefined;
    /**
     * Gets the active shared-transaction coordinator owner for a connection.
     * @param {object} connection - Parent physical connection.
     * @returns {symbol | undefined} - Active coordinator owner.
     */
    getSharedTransactionCoordinatorOwner(connection) {
        return this._sharedTransactionCoordinatorAsyncLocalStorage?.getStore()?.get(connection);
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
        if (!this._sharedTransactionCoordinatorAsyncLocalStorage)
            return callback();
        const owners = new Map(this._sharedTransactionCoordinatorAsyncLocalStorage.getStore());
        owners.set(connection, owner);
        return this._sharedTransactionCoordinatorAsyncLocalStorage.run(owners, callback);
    }
    /**
     * Runs work without inherited shared-transaction ownership for one connection.
     * @template T
     * @param {import("../database/drivers/base.js").default} connection - Physical connection whose owner is cleared.
     * @param {() => T} callback - Physical connection work.
     * @returns {T} - Callback result.
     */
    runWithoutSharedTransactionCoordinatorOwner(connection, callback) {
        if (!this._sharedTransactionCoordinatorAsyncLocalStorage)
            return callback();
        const owners = new Map(this._sharedTransactionCoordinatorAsyncLocalStorage.getStore());
        owners.delete(connection);
        return this._sharedTransactionCoordinatorAsyncLocalStorage.run(owners, callback);
    }
    /**
     * Runs work without inherited shared-transaction coordinator ownership.
     * @template T
     * @param {() => T} callback - Detached work.
     * @returns {T} - Callback result.
     */
    runWithoutSharedTransactionCoordinatorOwners(callback) {
        if (!this._sharedTransactionCoordinatorAsyncLocalStorage)
            return callback();
        return this._sharedTransactionCoordinatorAsyncLocalStorage.run(new Map(), callback);
    }
    /**
     * Runs work with async-safe test profile attribution.
     * @template T
     * @param {import("../testing/test-profiler.js").TestProfileAsyncContext | undefined} context - Captured profile context, or an explicit absence of attribution.
     * @param {() => T} callback - Profiled work.
     * @returns {T} - Callback result.
     */
    runWithTestProfileContext(context, callback) {
        if (!this._timezoneAsyncLocalStorage)
            return callback();
        const existingStore = this._timezoneAsyncLocalStorage.getStore();
        return this._timezoneAsyncLocalStorage.run({
            ability: existingStore?.ability,
            offsetMinutes: existingStore?.offsetMinutes ?? this.getTimezoneOffsetMinutes(this.getConfiguration()),
            requestTiming: existingStore?.requestTiming,
            tenant: existingStore?.tenant,
            testProfileContext: context,
            timeZone: existingStore?.timeZone ?? this.getTimeZone(this.getConfiguration())
        }, callback);
    }
    /**
     * Gets the current async-safe test profile attribution context.
     * @returns {import("../testing/test-profiler.js").TestProfileAsyncContext | undefined} - Current context.
     */
    getCurrentTestProfileContext() {
        return this._timezoneAsyncLocalStorage?.getStore()?.testProfileContext;
    }
    /**
     * Find commands result.
     * @type {import("./base.js").CommandFileObjectType[] | undefined} */
    _findCommandsResult = undefined;
    /**
     * Runs debug endpoint token matches.
     * @param {string} providedToken - Token from the request.
     * @param {string} expectedToken - Configured token.
     * @returns {boolean} - Whether both tokens match.
     */
    debugEndpointTokenMatches(providedToken, expectedToken) {
        const provided = Buffer.from(providedToken);
        const expected = Buffer.from(expectedToken);
        return provided.length === expected.length && timingSafeEqual(provided, expected);
    }
    /**
     * Runs get framework source directory.
     * @returns {string | undefined} - Velocious source directory used to filter framework stack frames.
     */
    getFrameworkSourceDirectory() {
        return FRAMEWORK_SOURCE_DIRECTORY;
    }
    /**
     * Auto-discovers resource classes from src/resources/ in each backend project.
     * @param {import("../configuration.js").default} configuration - Configuration instance.
     * @returns {Promise<void>}
     */
    async autoDiscoverResources(configuration) {
        const { frontendModelResourceDefinitionIsClass } = await import("../frontend-models/resource-definition.js");
        const { default: AuthorizationBaseResource } = await import("../authorization/base-resource.js");
        const backendProjects = configuration.getBackendProjects();
        for (const backendProject of backendProjects) {
            if (backendProject.abilityResources)
                continue;
            const resourcesDir = backendProject.resourcesPath || path.join(backendProject.path, "src", "resources");
            let files;
            try {
                files = await fs.readdir(resourcesDir);
            }
            catch {
                continue;
            }
            /**
             * Discovered frontend-model resources keyed by model name.
             * @type {Record<string, ReturnType<typeof JSON.parse>>} */
            const discovered = {};
            /**
             * Every discovered ability resource class (frontend-model and authorization).
             * @type {Array<ReturnType<typeof JSON.parse>>} */
            const abilityResourceClasses = [];
            for (const file of files) {
                if (!file.endsWith(".js") && !file.endsWith(".mjs"))
                    continue;
                if (file.startsWith("frontend-model-resources"))
                    continue;
                const filePath = path.join(resourcesDir, file);
                const imported = await import(filePath);
                const ResourceClass = imported.default;
                // Any authorization resource (frontend-model resources also extend it) that
                // declares a `ModelClass`; skip abstract/common base resources without one.
                const isAbilityResource = typeof ResourceClass === "function"
                    && (ResourceClass === AuthorizationBaseResource || ResourceClass.prototype instanceof AuthorizationBaseResource);
                if (!isAbilityResource || !ResourceClass.ModelClass)
                    continue;
                abilityResourceClasses.push(ResourceClass);
                // Only frontend-model resources drive routing/generation/publisher discovery.
                if (!frontendModelResourceDefinitionIsClass(ResourceClass))
                    continue;
                const baseName = file.replace(/\.(js|mjs)$/, "");
                const modelName = baseName.replace(/-resource$/, "")
                    .split("-")
                    .map((/** @type {string} */ part) => part.charAt(0).toUpperCase() + part.slice(1))
                    .join("");
                discovered[modelName] = ResourceClass;
            }
            if (!backendProject.frontendModels && Object.keys(discovered).length > 0) {
                backendProject.frontendModels = discovered;
            }
            if (abilityResourceClasses.length > 0) {
                backendProject.abilityResources = abilityResourceClasses;
            }
        }
    }
    /**
     * Loads models contributed by registered packages into the model registry,
     * after the app's own `initializeModels` hook. A package whose models directory
     * is absent is skipped; a package model whose name collides with an
     * already-registered different class throws. Node-only (uses the filesystem), so
     * it lives here rather than in the browser-bundled Configuration.
     * @param {import("../configuration.js").default} configuration - Configuration instance.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async initializePackageModels(configuration) {
        for (const velociousPackage of configuration.getPackages()) {
            const modelsPath = velociousPackage.getModelsPath();
            try {
                await fs.access(modelsPath);
            }
            catch {
                continue;
            }
            const packageRequireContext = /** @type {import("../database/initializer-from-require-context.js").ModelClassRequireContextType} */ (requireContext(modelsPath, true, /^(.+)\.js$/));
            const modelClasses = configuration.getModelClasses();
            for (const fileName of packageRequireContext.keys()) {
                const modelClass = packageRequireContext(fileName)?.default;
                const existing = modelClass && modelClasses[modelClass.getModelName()];
                if (existing && existing !== modelClass) {
                    throw new Error(`Package "${velociousPackage.getName()}" model "${modelClass.getModelName()}" collides with an already-registered model.`);
                }
            }
            await configuration.ensureConnections({ name: `Initialize ${velociousPackage.getName()} package models` }, async () => {
                await new InitializerFromRequireContext({ requireContext: packageRequireContext }).initialize({ configuration });
            });
        }
    }
    /**
     * Runs set configuration.
     * @param {import("../configuration.js").default} newConfiguration - New configuration.
     * @returns {void} - No return value.
     */
    setConfiguration(newConfiguration) {
        super.setConfiguration(newConfiguration);
        if (!newConfiguration.getRouteResolverHooks().includes(frontendModelCommandRouteHook)) {
            newConfiguration.addRouteResolverHook(frontendModelCommandRouteHook);
        }
    }
    /**
     * Runs read attachment input file.
     * @param {string} filePath - File path.
     * @returns {Promise<Buffer>} - File bytes.
     */
    async readAttachmentInputFile(filePath) {
        return await fs.readFile(filePath);
    }
    /**
     * Runs resolve attachment input path.
     * @param {object} args - Args.
     * @param {string[]} args.allowedPathPrefixes - Allowed path prefixes.
     * @param {string} args.inputPath - Input path.
     * @returns {Promise<AttachmentPathSource>} - Opened regular-file path source.
     */
    async resolveAttachmentInputPath({ allowedPathPrefixes, inputPath }) {
        const filePath = path.resolve(inputPath);
        const prefixes = Array.isArray(allowedPathPrefixes)
            ? allowedPathPrefixes.filter((entry) => typeof entry === "string" && entry.length > 0)
            : [];
        if (prefixes.length > 0 && !pathWithinAllowedPrefixes(filePath, prefixes)) {
            throw new Error("Attachment path is outside allowed directories");
        }
        const fileHandle = await fs.open(filePath, "r");
        try {
            const fileStats = await fileHandle.stat();
            if (!fileStats.isFile()) {
                throw new Error("Attachment path must reference a regular file");
            }
            return new AttachmentPathSource({
                byteSize: fileStats.size,
                fileHandle,
                filePath
            });
        }
        catch (error) {
            try {
                await fileHandle.close();
            }
            catch (closeError) {
                throw new AggregateError([error, closeError], `Attachment path validation and source close both failed for ${filePath}`, { cause: closeError });
            }
            throw error;
        }
    }
    /**
     * Runs find commands.
     * @returns {Promise<Array<import("./base.js").CommandFileObjectType>>} - Resolves with the commands.
     */
    async findCommands() {
        this._findCommandsResult ||= await this._actualFindCommands();
        if (!this._findCommandsResult)
            throw new Error("Could not get commands");
        return this._findCommandsResult;
    }
    /**
     * Runs run with timezone offset.
     * @param {number} offsetMinutes - Offset in minutes (Date#getTimezoneOffset).
     * @param {() => Promise<ReturnType<typeof JSON.parse>>} callback - Callback to run.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Result of the callback.
     */
    async runWithTimezoneOffset(offsetMinutes, callback) {
        if (!this._timezoneAsyncLocalStorage) {
            return await callback();
        }
        const existingStore = this._timezoneAsyncLocalStorage.getStore();
        return await this._timezoneAsyncLocalStorage.run({
            ability: existingStore?.ability,
            offsetMinutes,
            requestTiming: existingStore?.requestTiming,
            tenant: existingStore?.tenant,
            testProfileContext: existingStore?.testProfileContext,
            timeZone: existingStore?.timeZone ?? this.getTimeZone(this.getConfiguration())
        }, callback);
    }
    /**
     * Runs run with timezone.
     * @param {string} timeZone - IANA timezone identifier.
     * @param {() => Promise<ReturnType<typeof JSON.parse>>} callback - Callback to run.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Result of the callback.
     */
    async runWithTimezone(timeZone, callback) {
        if (!this._timezoneAsyncLocalStorage) {
            return await super.runWithTimezone(timeZone, callback);
        }
        const existingStore = this._timezoneAsyncLocalStorage.getStore();
        return await this._timezoneAsyncLocalStorage.run({
            ability: existingStore?.ability,
            offsetMinutes: existingStore?.offsetMinutes ?? this.getTimezoneOffsetMinutes(this.getConfiguration()),
            requestTiming: existingStore?.requestTiming,
            tenant: existingStore?.tenant,
            testProfileContext: existingStore?.testProfileContext,
            timeZone: validateTimeZone(timeZone, "timeZone")
        }, callback);
    }
    /**
     * Runs set timezone offset.
     * @param {number} offsetMinutes - Offset in minutes (Date#getTimezoneOffset).
     * @returns {void} - No return value.
     */
    setTimezoneOffset(offsetMinutes) {
        if (!this._timezoneAsyncLocalStorage)
            return;
        const store = this._timezoneAsyncLocalStorage.getStore();
        if (store) {
            store.offsetMinutes = offsetMinutes;
        }
        else {
            const existingStore = this._timezoneAsyncLocalStorage.getStore();
            this._timezoneAsyncLocalStorage.enterWith({
                ability: existingStore?.ability,
                offsetMinutes,
                requestTiming: existingStore?.requestTiming,
                tenant: existingStore?.tenant,
                testProfileContext: existingStore?.testProfileContext,
                timeZone: existingStore?.timeZone ?? this.getTimeZone(this.getConfiguration())
            });
        }
    }
    /**
     * Runs set timezone.
     * @param {string} timeZone - IANA timezone identifier.
     * @returns {void} - No return value.
     */
    setTimezone(timeZone) {
        if (!this._timezoneAsyncLocalStorage) {
            super.setTimezone(timeZone);
            return;
        }
        const normalizedTimeZone = validateTimeZone(timeZone, "timeZone");
        const store = this._timezoneAsyncLocalStorage.getStore();
        if (store) {
            store.timeZone = normalizedTimeZone;
        }
        else {
            const existingStore = this._timezoneAsyncLocalStorage.getStore();
            this._timezoneAsyncLocalStorage.enterWith({
                ability: existingStore?.ability,
                offsetMinutes: existingStore?.offsetMinutes ?? this.getTimezoneOffsetMinutes(this.getConfiguration()),
                requestTiming: existingStore?.requestTiming,
                tenant: existingStore?.tenant,
                testProfileContext: existingStore?.testProfileContext,
                timeZone: normalizedTimeZone
            });
        }
    }
    /**
     * Runs get timezone offset minutes.
     * @param {import("../configuration.js").default | undefined} configuration - Configuration instance.
     * @returns {number} - Offset in minutes.
     */
    getTimezoneOffsetMinutes(configuration) {
        if (this._timezoneAsyncLocalStorage) {
            const store = this._timezoneAsyncLocalStorage.getStore();
            if (store && typeof store.offsetMinutes === "number") {
                return store.offsetMinutes;
            }
        }
        return super.getTimezoneOffsetMinutes(configuration);
    }
    /**
     * Runs get timezone.
     * @param {import("../configuration.js").default | undefined} configuration - Configuration instance.
     * @returns {string | undefined} - Timezone identifier.
     */
    getTimeZone(configuration) {
        if (this._timezoneAsyncLocalStorage) {
            const store = this._timezoneAsyncLocalStorage.getStore();
            if (store && typeof store.timeZone === "string") {
                return store.timeZone;
            }
        }
        return super.getTimeZone(configuration);
    }
    /**
     * Runs run with ability.
     * @param {import("../authorization/ability.js").default | undefined} ability - Ability to set for callback scope.
     * @param {() => Promise<ReturnType<typeof JSON.parse>>} callback - Callback.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Callback result.
     */
    async runWithAbility(ability, callback) {
        if (!this._timezoneAsyncLocalStorage) {
            return await super.runWithAbility(ability, callback);
        }
        const existingStore = this._timezoneAsyncLocalStorage.getStore();
        return await this._timezoneAsyncLocalStorage.run({
            ability,
            offsetMinutes: existingStore?.offsetMinutes ?? this.getTimezoneOffsetMinutes(this.getConfiguration()),
            requestTiming: existingStore?.requestTiming,
            tenant: existingStore?.tenant,
            testProfileContext: existingStore?.testProfileContext,
            timeZone: existingStore?.timeZone ?? this.getTimeZone(this.getConfiguration())
        }, callback);
    }
    /**
     * Runs set current ability.
     * @param {import("../authorization/ability.js").default | undefined} ability - Ability to set.
     * @returns {void} - No return value.
     */
    setCurrentAbility(ability) {
        if (!this._timezoneAsyncLocalStorage) {
            super.setCurrentAbility(ability);
            return;
        }
        const existingStore = this._timezoneAsyncLocalStorage.getStore();
        if (existingStore) {
            existingStore.ability = ability;
        }
        else {
            this._timezoneAsyncLocalStorage.enterWith({
                ability,
                offsetMinutes: this.getTimezoneOffsetMinutes(this.getConfiguration()),
                requestTiming: undefined,
                tenant: undefined,
                testProfileContext: undefined,
                timeZone: this.getTimeZone(this.getConfiguration())
            });
        }
    }
    /**
     * Runs get current ability.
     * @returns {import("../authorization/ability.js").default | undefined} - Current ability.
     */
    getCurrentAbility() {
        if (!this._timezoneAsyncLocalStorage) {
            return super.getCurrentAbility();
        }
        return this._timezoneAsyncLocalStorage.getStore()?.ability;
    }
    /**
     * Runs run with request timing.
     * @param {import("../http-server/client/request-timing.js").default | undefined} requestTiming - Request timing collector.
     * @param {() => Promise<ReturnType<typeof JSON.parse>>} callback - Callback.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Callback result.
     */
    async runWithRequestTiming(requestTiming, callback) {
        if (!this._timezoneAsyncLocalStorage) {
            return await super.runWithRequestTiming(requestTiming, callback);
        }
        const existingStore = this._timezoneAsyncLocalStorage.getStore();
        return await this._timezoneAsyncLocalStorage.run({
            ability: existingStore?.ability,
            offsetMinutes: existingStore?.offsetMinutes ?? this.getTimezoneOffsetMinutes(this.getConfiguration()),
            requestTiming,
            tenant: existingStore?.tenant,
            testProfileContext: existingStore?.testProfileContext,
            timeZone: existingStore?.timeZone ?? this.getTimeZone(this.getConfiguration())
        }, callback);
    }
    /**
     * Runs get current request timing.
     * @returns {import("../http-server/client/request-timing.js").default | undefined} - Current request timing collector.
     */
    getCurrentRequestTiming() {
        if (!this._timezoneAsyncLocalStorage) {
            return super.getCurrentRequestTiming();
        }
        return this._timezoneAsyncLocalStorage.getStore()?.requestTiming;
    }
    /**
     * Runs run with tenant.
     * @param {ReturnType<typeof JSON.parse>} tenant - Tenant to set for callback scope.
     * @param {() => Promise<ReturnType<typeof JSON.parse>>} callback - Callback.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Callback result.
     */
    async runWithTenant(tenant, callback) {
        if (!this._timezoneAsyncLocalStorage) {
            return await super.runWithTenant(tenant, callback);
        }
        const existingStore = this._timezoneAsyncLocalStorage.getStore();
        return await this._timezoneAsyncLocalStorage.run({
            ability: existingStore?.ability,
            offsetMinutes: existingStore?.offsetMinutes ?? this.getTimezoneOffsetMinutes(this.getConfiguration()),
            requestTiming: existingStore?.requestTiming,
            tenant,
            testProfileContext: existingStore?.testProfileContext,
            timeZone: existingStore?.timeZone ?? this.getTimeZone(this.getConfiguration())
        }, callback);
    }
    /**
     * Runs set current tenant.
     * @param {ReturnType<typeof JSON.parse>} tenant - Tenant to set.
     * @returns {void} - No return value.
     */
    setCurrentTenant(tenant) {
        if (!this._timezoneAsyncLocalStorage) {
            super.setCurrentTenant(tenant);
            return;
        }
        const existingStore = this._timezoneAsyncLocalStorage.getStore();
        if (existingStore) {
            existingStore.tenant = tenant;
        }
        else {
            this._timezoneAsyncLocalStorage.enterWith({
                ability: undefined,
                offsetMinutes: this.getTimezoneOffsetMinutes(this.getConfiguration()),
                requestTiming: undefined,
                tenant,
                testProfileContext: undefined,
                timeZone: this.getTimeZone(this.getConfiguration())
            });
        }
    }
    /**
     * Runs get current tenant.
     * @returns {ReturnType<typeof JSON.parse>} - Current tenant.
     */
    getCurrentTenant() {
        if (!this._timezoneAsyncLocalStorage) {
            return super.getCurrentTenant();
        }
        return this._timezoneAsyncLocalStorage.getStore()?.tenant;
    }
    /**
     * Runs actual find commands.
     * @returns {Promise<Array<import("./base.js").CommandFileObjectType>>} - Resolves with discovered command files.
     */
    async _actualFindCommands() {
        const basePath = await this.getBasePath();
        const commandFiles = fs.glob(`${basePath}/src/cli/commands/**/*.js`);
        const commands = [];
        for await (const aFilePath of commandFiles) {
            const commandName = this.commandNameFromFilePath(aFilePath);
            commands.push({ name: commandName, file: aFilePath });
        }
        return commands;
    }
    /**
     * Runs command name from file path.
     * @param {string} filePath - Full command file path.
     * @returns {string} - Parsed command name.
     */
    commandNameFromFilePath(filePath) {
        const aFilePathParts = filePath.split(/[\\/]/);
        const commandPathLocation = aFilePathParts.indexOf("commands");
        if (commandPathLocation === -1) {
            throw new Error(`Could not parse command file path: ${filePath}`);
        }
        const commandParts = aFilePathParts.slice(commandPathLocation + 1);
        const lastPart = commandParts[commandParts.length - 1];
        let name, paths;
        if (lastPart == "index.js") {
            name = commandParts[commandParts.length - 2];
            paths = commandParts.slice(0, -2);
        }
        else {
            name = lastPart.replace(".js", "");
            paths = commandParts.slice(0, -1);
        }
        return `${paths.join(":")}${paths.length > 0 ? ":" : ""}${name}`;
    }
    /**
     * Runs cli commands init.
     * @param {import("../cli/base-command.js").default} command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    async cliCommandsInit(command) {
        return await this.forwardCommand(command, CliCommandsInit);
    }
    /**
     * Runs cli commands migration generate.
     * @param {import("../cli/base-command.js").default} command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    async cliCommandsMigrationGenerate(command) {
        return await this.forwardCommand(command, CliCommandsGenerateMigration);
    }
    /**
     * Runs cli commands migration destroy.
     * @param {import("../cli/base-command.js").default} command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    async cliCommandsMigrationDestroy(command) {
        return await this.forwardCommand(command, CliCommandsDestroyMigration);
    }
    /**
     * Runs cli commands generate base models.
     * @param {import("../cli/base-command.js").default} command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    async cliCommandsGenerateBaseModels(command) {
        return await this.forwardCommand(command, CliCommandsGenerateBaseModels);
    }
    /**
     * Runs cli commands generate frontend models.
     * @param {import("../cli/base-command.js").default} command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    async cliCommandsGenerateFrontendModels(command) {
        return await this.forwardCommand(command, CliCommandsGenerateFrontendModels);
    }
    /**
     * Runs cli commands generate model.
     * @param {import("../cli/base-command.js").default} command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    async cliCommandsGenerateModel(command) {
        return await this.forwardCommand(command, CliCommandsGenerateModel);
    }
    /**
     * Runs cli commands lint relationships.
     * @param {import("../cli/base-command.js").default} command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    async cliCommandsLintRelationships(command) {
        return await this.forwardCommand(command, CliCommandsLintRelationships);
    }
    /**
     * Runs cli commands routes.
     * @param {import("../cli/base-command.js").default} command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    async cliCommandsRoutes(command) {
        return await this.forwardCommand(command, CliCommandsRoutes);
    }
    /**
     * Runs cli commands console.
     * @param {import("../cli/base-command.js").default} command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    async cliCommandsConsole(command) {
        return await this.forwardCommand(command, CliCommandsConsole);
    }
    /**
     * Runs cli commands server.
     * @param {import("../cli/base-command.js").default} command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    async cliCommandsServer(command) {
        return await this.forwardCommand(command, CliCommandsServer);
    }
    /**
     * Runs cli commands mcp.
     * @param {import("../cli/base-command.js").default} command - Command.
     * @returns {Promise<void>} - Resolves when the command completes.
     */
    async cliCommandsMcp(command) {
        return await this.forwardCommand(command, CliCommandsMcp);
    }
    /**
     * Runs cli commands test.
     * @param {import("../cli/base-command.js").default} command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    async cliCommandsTest(command) {
        return await this.forwardCommand(command, CliCommandsTest);
    }
    /**
     * Runs cli commands test timing manifest merge.
     * @param {import("../cli/base-command.js").default} command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    async cliCommandsTestTimingManifestMerge(command) {
        return await this.forwardCommand(command, CliCommandsTestTimingManifestMerge);
    }
    /**
     * Runs cli commands background jobs main.
     * @param {import("../cli/base-command.js").default} command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    async cliCommandsBackgroundJobsMain(command) {
        return await this.forwardCommand(command, CliCommandsBackgroundJobsMain);
    }
    /**
     * Runs CLI background-jobs activation.
     * @param {import("../cli/base-command.js").default} command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Result.
     */
    async cliCommandsBackgroundJobsActivate(command) {
        return await this.forwardCommand(command, CliCommandsBackgroundJobsActivate);
    }
    /**
     * Runs CLI background-jobs retirement.
     * @param {import("../cli/base-command.js").default} command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Result.
     */
    async cliCommandsBackgroundJobsRetire(command) {
        return await this.forwardCommand(command, CliCommandsBackgroundJobsRetire);
    }
    /**
     * Runs cli commands background jobs worker.
     * @param {import("../cli/base-command.js").default} command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    async cliCommandsBackgroundJobsWorker(command) {
        return await this.forwardCommand(command, CliCommandsBackgroundJobsWorker);
    }
    /**
     * Runs cli commands background jobs runner.
     * @param {import("../cli/base-command.js").default} command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    async cliCommandsBackgroundJobsRunner(command) {
        return await this.forwardCommand(command, CliCommandsBackgroundJobsRunner);
    }
    /**
     * Runs cli commands beacon.
     * @param {import("../cli/base-command.js").default} command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    async cliCommandsBeacon(command) {
        return await this.forwardCommand(command, CliCommandsBeacon);
    }
    /**
     * Runs load beacon client.
     * @returns {Promise<typeof import("../beacon/client.js").default>} - Beacon client class.
     */
    async loadBeaconClient() {
        const { default: BeaconClient } = await import("../beacon/client.js");
        return BeaconClient;
    }
    /**
     * Runs load in process beacon client.
     * @returns {Promise<typeof import("../beacon/in-process-client.js").default>} - In-process client class.
     */
    async loadInProcessBeaconClient() {
        const { default: InProcessBeaconClient } = await import("../beacon/in-process-client.js");
        return InProcessBeaconClient;
    }
    /**
     * Runs cli commands db schema dump.
     * @param {import("../cli/base-command.js").default} command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    async cliCommandsDbSchemaDump(command) {
        return await this.forwardCommand(command, CliCommandsDbSchemaDump);
    }
    /**
     * Runs cli commands db schema load.
     * @param {import("../cli/base-command.js").default} command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    async cliCommandsDbSchemaLoad(command) {
        return await this.forwardCommand(command, CliCommandsDbSchemaLoad);
    }
    /**
     * Runs cli commands db seed.
     * @param {import("../cli/base-command.js").default} command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    async cliCommandsDbSeed(command) {
        return await this.forwardCommand(command, CliCommandsDbSeed);
    }
    /**
     * Runs cli commands runner.
     * @param {import("../cli/base-command.js").default} command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    async cliCommandsRunner(command) {
        return await this.forwardCommand(command, CliCommandsRunner);
    }
    /**
     * Runs cli commands run script.
     * @param {import("../cli/base-command.js").default} command - Command.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Resolves with the command result.
     */
    async cliCommandsRunScript(command) {
        return await this.forwardCommand(command, CliCommandsRunScript);
    }
    /**
     * Runs require command.
     * @param {object} args - Options object.
     * @param {string[]} args.commandParts - Command parts.
     * @returns {Promise<typeof import ("../cli/base-command.js").default>} - Resolves with the require command.
     */
    async requireCommand({ commandParts }) {
        const commands = await this.findCommands();
        const commandName = commandParts.join(":");
        const command = commands.find((aCommand) => aCommand.name === commandName);
        if (!command) {
            const possibleCommands = commands.map(aCommand => aCommand.name);
            throw new Error(`Unknown command: ${commandParts.join(":")} which should have been one of: ${possibleCommands.sort().join(", ")}`);
        }
        const commandClassImport = await import(toImportSpecifier(command.file));
        const CommandClass = commandClassImport.default;
        return CommandClass;
    }
    /**
     * Runs find migrations.
     * @returns {Promise<Array<import("./base.js").MigrationObjectType>>} - Resolves with the migrations.
     */
    async findMigrations() {
        const configuration = this.getConfiguration();
        const migrationDirectories = [`${configuration.getDirectory()}/src/database/migrations`];
        for (const velociousPackage of configuration.getPackages()) {
            migrationDirectories.push(velociousPackage.getMigrationsPath());
        }
        /** @type {Array<import("./base.js").MigrationObjectType>} */
        const files = [];
        for (const migrationsPath of migrationDirectories) {
            await this._collectMigrationsFromDirectory(migrationsPath, files);
        }
        this._ensureNoMigrationTimestampCollisions(files);
        return files.sort((migration1, migration2) => migration1.date - migration2.date);
    }
    /**
     * Collects migration files from one directory into `files`, preserving each
     * file's real absolute path (so app and package migrations keep their own
     * source location). A missing directory is skipped.
     * @param {string} migrationsPath - Directory to scan.
     * @param {Array<import("./base.js").MigrationObjectType>} files - Accumulator to push into.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async _collectMigrationsFromDirectory(migrationsPath, files) {
        const glob = await fs.glob(`${migrationsPath}/**/*.js`);
        try {
            for await (const fullPath of glob) {
                const file = await path.basename(fullPath);
                const match = file.match(/^(\d{14})-(.+)\.js$/);
                if (!match)
                    continue;
                const date = parseInt(match[1]);
                const migrationName = match[2];
                const migrationClassName = inflection.camelize(migrationName.replaceAll("-", "_"));
                files.push({ file, fullPath, date, migrationClassName });
            }
        }
        catch (error) {
            if ( /** @type {Error & {code?: string}} */(error)?.code !== "ENOENT") {
                throw error;
            }
        }
    }
    /**
     * Throws if two migrations from different files share the same 14-digit
     * timestamp. The `schema_migrations` ledger keys on the timestamp, so a silent
     * collision (e.g. between the app and a package, or two packages) would leave
     * the second migration un-run — a data bug. Fail loudly instead.
     * @param {Array<import("./base.js").MigrationObjectType>} files - Collected migrations.
     * @returns {void} - No return value.
     */
    _ensureNoMigrationTimestampCollisions(files) {
        /** @type {Map<number, string>} */
        const pathsByDate = new Map();
        for (const migration of files) {
            if (!migration.fullPath)
                continue;
            const existing = pathsByDate.get(migration.date);
            if (existing && existing !== migration.fullPath) {
                throw new Error(`Two migrations share the timestamp ${migration.date}: ${existing} and ${migration.fullPath}. Migration timestamps must be unique across the app and all packages.`);
            }
            pathsByDate.set(migration.date, migration.fullPath);
        }
    }
    /**
     * Runs import application routes.
     * @returns {Promise<import("../routes/index.js").default>} - Resolves with the import application routes.
     */
    async importApplicationRoutes() {
        const routesImport = await import(toImportSpecifier(`${this.getConfiguration().getDirectory()}/src/config/routes.js`));
        return routesImport.default;
    }
    /**
     * Runs get velocious path.
     * @returns {Promise<string>} - Resolves with the velocious path.
     */
    async getVelociousPath() {
        if (!this._velociousPath) {
            const __filename = fileURLToPath(import.meta.url);
            const __dirname = dirname(__filename);
            this._velociousPath = await fs.realpath(`${__dirname}/../..`);
        }
        return this._velociousPath;
    }
    /**
     * Runs import test files.
     * @param {string[]} testFiles - Test files.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async importTestFiles(testFiles) {
        for (const testFile of testFiles) {
            await import(toImportSpecifier(testFile));
        }
    }
    /**
     * Runs get default log directory.
     * @param {object} args - Options object.
     * @param {import("../configuration.js").default} args.configuration - Configuration instance.
     * @returns {string} - The default log directory.
     */
    getDefaultLogDirectory({ configuration }) {
        return path.join(configuration.getDirectory(), "log");
    }
    /**
     * Runs get log file path.
     * @param {object} args - Options object.
     * @param {import("../configuration.js").default} args.configuration - Configuration instance.
     * @param {string | undefined} args.directory - Directory path.
     * @param {string} args.environment - Environment.
     * @returns {string | undefined} - The log file path.
     */
    getLogFilePath({ configuration, directory, environment }) {
        const actualDirectory = directory || configuration?.getDirectory?.();
        if (!actualDirectory)
            return undefined;
        return path.join(actualDirectory, `${environment}.log`);
    }
    /**
     * Runs write log to file.
     * @param {object} args - Options object.
     * @param {string} args.filePath - File path.
     * @param {string} args.message - Message text.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async writeLogToFile({ filePath, message }) {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.appendFile(filePath, `${message}\n`, "utf8");
    }
    async importTestingConfigPath() {
        const testingConfigPath = this.getConfiguration().getTesting();
        if (!testingConfigPath)
            return;
        const testingImport = await import(toImportSpecifier(testingConfigPath));
        const testingDefault = testingImport.default;
        if (!testingDefault)
            throw new Error("Testing config must export a default function");
        if (typeof testingDefault !== "function")
            throw new Error("Testing config default export isn't a function");
        const result = await testingDefault();
        if (typeof result === "function") {
            await result();
        }
    }
    /**
     * Runs require migration.
     * @param {string} filePath - File path.
     * @returns {Promise<import("../database/migration/index.js").default>} - Resolves with the require migration.
     */
    async requireMigration(filePath) {
        const migrationImport = await import(toImportSpecifier(filePath));
        const migrationImportDefault = migrationImport.default;
        if (!migrationImportDefault)
            throw new Error("Migration file must export a default migration class");
        if (typeof migrationImportDefault !== "function")
            throw new Error("Migration default export isn't a function (should be a class which is a function in JS)");
        return migrationImportDefault;
    }
    async getBasePath() {
        const __filename = fileURLToPath(import.meta.url);
        const basePath = await fs.realpath(`${dirname(__filename)}/../..`);
        return basePath;
    }
    /**
     * Ensures Velocious framework schema exists as part of `db:migrate`, so internal
     * tables are created deterministically alongside app migrations and captured in
     * the dumped structure SQL instead of appearing only when runtime stores boot.
     * @param {object} args - Options object.
     * @param {Record<string, import("../database/drivers/base.js").default>} args.dbs - Dbs being migrated.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async ensureFrameworkSchema({ dbs }) {
        // Migration passes its already checked-out DB into the adapter hook. Do not
        // run runtime readiness here: it would open a nested checkout and can deadlock
        // a single-connection migration pool.
        const configuration = this.getConfiguration();
        for (const [databaseIdentifier, db] of Object.entries(dbs)) {
            const attachmentStore = new RecordAttachmentsStore({ configuration, databaseIdentifier });
            await attachmentStore.ensureSchema(db);
        }
        const adapter = configuration.getBackgroundJobsAdapter();
        await adapter.ensureFrameworkSchema({ dbs });
    }
    /**
     * Runs after migrations.
     * @param {object} args - Options object.
     * @param {Record<string, import("../database/drivers/base.js").default>} args.dbs - Dbs.
     * @param {"migration" | "schemaDump"} [args.reason] - Why the structure write is being triggered.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async afterMigrations({ dbs, reason = "migration" }) {
        const configuration = this.getConfiguration();
        if (!configuration.shouldWriteStructureSql({ reason }))
            return;
        const dbDir = path.join(configuration.getDirectory(), "db");
        const structureSqlByIdentifier = await this._structureSqlByIdentifier({ dbs });
        await fs.mkdir(dbDir, { recursive: true });
        for (const identifier of Object.keys(structureSqlByIdentifier)) {
            const structureSql = structureSqlByIdentifier[identifier];
            if (!structureSql)
                continue;
            const filePath = path.join(dbDir, `structure-${identifier}.sql`);
            await fs.writeFile(filePath, structureSql);
        }
    }
    /**
     * Runs structure sql by identifier.
     * @param {object} args - Options object.
     * @param {Record<string, import("../database/drivers/base.js").default>} args.dbs - Dbs.
     * @returns {Promise<Record<string, string>>} - Resolves with SQL string.
     */
    async _structureSqlByIdentifier({ dbs }) {
        const sqlByIdentifier = /** @type {Record<string, string>} */ ({});
        for (const identifier of Object.keys(dbs)) {
            const db = dbs[identifier];
            if (typeof db.structureSql !== "function")
                continue;
            const structureSql = await db.structureSql();
            if (structureSql) {
                const migrationInserts = await this._schemaMigrationsInsertSql({ db });
                sqlByIdentifier[identifier] = structureSql + migrationInserts;
            }
        }
        return sqlByIdentifier;
    }
    /**
     * Generates INSERT statements for every row in `schema_migrations` so the
     * structure snapshot carries the migration ledger along with the DDL.  Without
     * these rows a fresh DB loaded from the snapshot will re-run every migration,
     * which fails when the snapshot already contains the post-migration schema.
     * @param {object} args - Options object.
     * @param {import("../database/drivers/base.js").default} args.db - Database connection.
     * @returns {Promise<string>} - INSERT statements (empty string when none).
     */
    async _schemaMigrationsInsertSql({ db }) {
        const { default: MigrationsLedger } = await import("../database/migrations-ledger.js");
        if (!await MigrationsLedger.tableExists(db))
            return "";
        const versions = await MigrationsLedger.appliedVersions(db);
        if (versions.length == 0)
            return "";
        return versions.map((version) => `INSERT INTO schema_migrations (version) VALUES (${db.quote(version)});`).join("\n") + "\n";
    }
    /**
     * Registers frontend-model websocket channel publishers so lifecycle
     * event hooks broadcast over the shared "frontend-models" channel.
     * This is only implemented by the Node handler because the required
     * modules (`frontend-model-controller`, `routes/resolver`) pull in
     * server-only Node APIs that break browser bundlers.
     * @param {import("../configuration.js").default} configuration - Configuration instance.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async initializeFrontendModelWebsocketPublishers(configuration) {
        // Discover each backend project's resources before registering publishers. The publishers are
        // derived from `backendProject.frontendModels`, which `autoDiscoverResources` populates. Without
        // this, registration runs against an empty/partial resource set (only built-ins), so apps that
        // resolve resources through an `abilityResolver` rather than a static ability-resource list never
        // register lifecycle publishers and their realtime frontend-model updates silently stop. The
        // lifecycle hooks are deduped per model class via a process-global set, so a later, fully
        // discovered pass cannot retroactively add the missing publishers. `autoDiscoverResources` is
        // idempotent (it skips backend projects whose `frontendModels` are already set).
        await this.autoDiscoverResources(configuration);
        const { ensureFrontendModelWebsocketPublishersRegistered } = await import("../frontend-models/websocket-publishers.js");
        await ensureFrontendModelWebsocketPublishersRegistered(configuration);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibm9kZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9lbnZpcm9ubWVudC1oYW5kbGVycy9ub2RlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLHdDQUF3QyxDQUFBO0FBQy9DLE9BQU8sdUJBQXVCLE1BQU0sMkNBQTJDLENBQUE7QUFDL0UsT0FBTyw2QkFBNkIsTUFBTSxrREFBa0QsQ0FBQTtBQUM1RixPQUFPLElBQUksTUFBTSxXQUFXLENBQUE7QUFDNUIsT0FBTyxvQkFBb0IsTUFBTSw4QkFBOEIsQ0FBQTtBQUMvRCxPQUFPLHdCQUF3QixNQUFNLG1DQUFtQyxDQUFBO0FBQ3hFLE9BQU8sMkJBQTJCLE1BQU0sMENBQTBDLENBQUE7QUFDbEYsT0FBTyxlQUFlLE1BQU0sNkJBQTZCLENBQUE7QUFDekQsT0FBTyw2QkFBNkIsTUFBTSw2Q0FBNkMsQ0FBQTtBQUN2RixPQUFPLGlDQUFpQyxNQUFNLGlEQUFpRCxDQUFBO0FBQy9GLE9BQU8sNEJBQTRCLE1BQU0sMkNBQTJDLENBQUE7QUFDcEYsT0FBTyx3QkFBd0IsTUFBTSx1Q0FBdUMsQ0FBQTtBQUM1RSxPQUFPLDRCQUE0QixNQUFNLDJDQUEyQyxDQUFBO0FBQ3BGLE9BQU8sY0FBYyxNQUFNLDRCQUE0QixDQUFBO0FBQ3ZELE9BQU8saUJBQWlCLE1BQU0sK0JBQStCLENBQUE7QUFDN0QsT0FBTyxpQkFBaUIsTUFBTSwrQkFBK0IsQ0FBQTtBQUM3RCxPQUFPLGVBQWUsTUFBTSw2QkFBNkIsQ0FBQTtBQUN6RCxPQUFPLGtDQUFrQyxNQUFNLG1EQUFtRCxDQUFBO0FBQ2xHLE9BQU8sNkJBQTZCLE1BQU0sNkNBQTZDLENBQUE7QUFDdkYsT0FBTyxpQ0FBaUMsTUFBTSxpREFBaUQsQ0FBQTtBQUMvRixPQUFPLCtCQUErQixNQUFNLCtDQUErQyxDQUFBO0FBQzNGLE9BQU8sK0JBQStCLE1BQU0sK0NBQStDLENBQUE7QUFDM0YsT0FBTywrQkFBK0Is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QUE7UUFFdEQsTUFBTSxRQUFRLEdBQUcsTUFBTSxnQkFBZ0IsQ0FBQyxlQUFlLENBQUMsRUFBRSxDQUFDLENBQUE7UUFFM0QsSUFBSSxRQUFRLENBQUMsTUFBTSxJQUFJLENBQUM7WUFBRSxPQUFPLEVBQUUsQ0FBQTtRQUVuQyxPQUFPLFFBQVEsQ0FBQyxHQUFHLENBQUMsQ0FBQyxPQUFPLEVBQUUsRUFBRSxDQUFDLG1EQUFtRCxFQUFFLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEdBQUcsSUFBSSxDQUFBO0lBQzlILENBQUM7SUFFRDs7Ozs7Ozs7T0FRRztJQUNILEtBQUssQ0FBQywwQ0FBMEMsQ0FBQyxhQUFhO1FBQzVELDhGQUE4RjtRQUM5RixpR0FBaUc7UUFDakcsK0ZBQStGO1FBQy9GLGtHQUFrRztRQUNsRyw2RkFBNkY7UUFDN0YsMEZBQTBGO1FBQzFGLDhGQUE4RjtRQUM5RixpRkFBaUY7UUFDakYsTUFBTSxJQUFJLENBQUMscUJBQXFCLENBQUMsYUFBYSxDQUFDLENBQUE7UUFFL0MsTUFBTSxFQUFDLGdEQUFnRCxFQUFDLEdBQUcsTUFBTSxNQUFNLENBQUMsNENBQTRDLENBQUMsQ0FBQTtRQUVySCxNQUFNLGdEQUFnRCxDQUFDLGFBQWEsQ0FBQyxDQUFBO0lBQ3ZFLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgXCIuLi9kYXRhYmFzZS9hbm5vdGF0aW9ucy1hc3luYy1ob29rcy5qc1wiXG5pbXBvcnQgQWR2aXNvcnlMb2NrRmlsZUJhY2tlbmQgZnJvbSBcIi4uL2RhdGFiYXNlL2Fkdmlzb3J5LWxvY2stZmlsZS1iYWNrZW5kLmpzXCJcbmltcG9ydCBBZHZpc29yeUxvY2tMb2NrU2VydmVyQmFja2VuZCBmcm9tIFwiLi4vZGF0YWJhc2UvYWR2aXNvcnktbG9jay1sb2NrLXNlcnZlci1iYWNrZW5kLmpzXCJcbmltcG9ydCBCYXNlIGZyb20gXCIuL2Jhc2UuanNcIlxuaW1wb3J0IEJhY2tncm91bmRKb2JzQ2xpZW50IGZyb20gXCIuLi9iYWNrZ3JvdW5kLWpvYnMvY2xpZW50LmpzXCJcbmltcG9ydCBTcWxCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIgZnJvbSBcIi4uL2JhY2tncm91bmQtam9icy9zcWwtYWRhcHRlci5qc1wiXG5pbXBvcnQgQ2xpQ29tbWFuZHNEZXN0cm95TWlncmF0aW9uIGZyb20gXCIuL25vZGUvY2xpL2NvbW1hbmRzL2Rlc3Ryb3kvbWlncmF0aW9uLmpzXCJcbmltcG9ydCBDbGlDb21tYW5kc0luaXQgZnJvbSBcIi4vbm9kZS9jbGkvY29tbWFuZHMvaW5pdC5qc1wiXG5pbXBvcnQgQ2xpQ29tbWFuZHNHZW5lcmF0ZUJhc2VNb2RlbHMgZnJvbSBcIi4vbm9kZS9jbGkvY29tbWFuZHMvZ2VuZXJhdGUvYmFzZS1tb2RlbHMuanNcIlxuaW1wb3J0IENsaUNvbW1hbmRzR2VuZXJhdGVGcm9udGVuZE1vZGVscyBmcm9tIFwiLi9ub2RlL2NsaS9jb21tYW5kcy9nZW5lcmF0ZS9mcm9udGVuZC1tb2RlbHMuanNcIlxuaW1wb3J0IENsaUNvbW1hbmRzR2VuZXJhdGVNaWdyYXRpb24gZnJvbSBcIi4vbm9kZS9jbGkvY29tbWFuZHMvZ2VuZXJhdGUvbWlncmF0aW9uLmpzXCJcbmltcG9ydCBDbGlDb21tYW5kc0dlbmVyYXRlTW9kZWwgZnJvbSBcIi4vbm9kZS9jbGkvY29tbWFuZHMvZ2VuZXJhdGUvbW9kZWwuanNcIlxuaW1wb3J0IENsaUNvbW1hbmRzTGludFJlbGF0aW9uc2hpcHMgZnJvbSBcIi4vbm9kZS9jbGkvY29tbWFuZHMvbGludC9yZWxhdGlvbnNoaXBzLmpzXCJcbmltcG9ydCBDbGlDb21tYW5kc01jcCBmcm9tIFwiLi9ub2RlL2NsaS9jb21tYW5kcy9tY3AuanNcIlxuaW1wb3J0IENsaUNvbW1hbmRzUm91dGVzIGZyb20gXCIuL25vZGUvY2xpL2NvbW1hbmRzL3JvdXRlcy5qc1wiXG5pbXBvcnQgQ2xpQ29tbWFuZHNTZXJ2ZXIgZnJvbSBcIi4vbm9kZS9jbGkvY29tbWFuZHMvc2VydmVyLmpzXCJcbmltcG9ydCBDbGlDb21tYW5kc1Rlc3QgZnJvbSBcIi4vbm9kZS9jbGkvY29tbWFuZHMvdGVzdC5qc1wiXG5pbXBvcnQgQ2xpQ29tbWFuZHNUZXN0VGltaW5nTWFuaWZlc3RNZXJnZSBmcm9tIFwiLi9ub2RlL2NsaS9jb21tYW5kcy90ZXN0L3RpbWluZy1tYW5pZmVzdC9tZXJnZS5qc1wiXG5pbXBvcnQgQ2xpQ29tbWFuZHNCYWNrZ3JvdW5kSm9ic01haW4gZnJvbSBcIi4vbm9kZS9jbGkvY29tbWFuZHMvYmFja2dyb3VuZC1qb2JzLW1haW4uanNcIlxuaW1wb3J0IENsaUNvbW1hbmRzQmFja2dyb3VuZEpvYnNBY3RpdmF0ZSBmcm9tIFwiLi9ub2RlL2NsaS9jb21tYW5kcy9iYWNrZ3JvdW5kLWpvYnMtYWN0aXZhdGUuanNcIlxuaW1wb3J0IENsaUNvbW1hbmRzQmFja2dyb3VuZEpvYnNSZXRpcmUgZnJvbSBcIi4vbm9kZS9jbGkvY29tbWFuZHMvYmFja2dyb3VuZC1qb2JzLXJldGlyZS5qc1wiXG5pbXBvcnQgQ2xpQ29tbWFuZHNCYWNrZ3JvdW5kSm9ic1dvcmtlciBmcm9tIFwiLi9ub2RlL2NsaS9jb21tYW5kcy9iYWNrZ3JvdW5kLWpvYnMtd29ya2VyLmpzXCJcbmltcG9ydCBDbGlDb21tYW5kc0JhY2tncm91bmRKb2JzUnVubmVyIGZyb20gXCIuL25vZGUvY2xpL2NvbW1hbmRzL2JhY2tncm91bmQtam9icy1ydW5uZXIuanNcIlxuaW1wb3J0IENsaUNvbW1hbmRzQmVhY29uIGZyb20gXCIuL25vZGUvY2xpL2NvbW1hbmRzL2JlYWNvbi5qc1wiXG5pbXBvcnQgQ2xpQ29tbWFuZHNDb25zb2xlIGZyb20gXCIuL25vZGUvY2xpL2NvbW1hbmRzL2NvbnNvbGUuanNcIlxuaW1wb3J0IENsaUNvbW1hbmRzRGJTY2hlbWFEdW1wIGZyb20gXCIuL25vZGUvY2xpL2NvbW1hbmRzL2RiL3NjaGVtYS9kdW1wLmpzXCJcbmltcG9ydCBDbGlDb21tYW5kc0RiU2NoZW1hTG9hZCBmcm9tIFwiLi9ub2RlL2NsaS9jb21tYW5kcy9kYi9zY2hlbWEvbG9hZC5qc1wiXG5pbXBvcnQgQ2xpQ29tbWFuZHNEYlNlZWQgZnJvbSBcIi4vbm9kZS9jbGkvY29tbWFuZHMvZGIvc2VlZC5qc1wiXG5pbXBvcnQgQ2xpQ29tbWFuZHNSdW5uZXIgZnJvbSBcIi4vbm9kZS9jbGkvY29tbWFuZHMvcnVubmVyLmpzXCJcbmltcG9ydCBDbGlDb21tYW5kc1J1blNjcmlwdCBmcm9tIFwiLi9ub2RlL2NsaS9jb21tYW5kcy9ydW4tc2NyaXB0LmpzXCJcbmltcG9ydCBmcm9udGVuZE1vZGVsQ29tbWFuZFJvdXRlSG9vayBmcm9tIFwiLi4vcm91dGVzL2hvb2tzL2Zyb250ZW5kLW1vZGVsLWNvbW1hbmQtcm91dGUtaG9vay5qc1wiXG5pbXBvcnQgeyBGUkFNRVdPUktfU09VUkNFX0RJUkVDVE9SWSB9IGZyb20gXCIuLi91dGlscy9iYWNrdHJhY2UtY2xlYW5lci1ub2RlLmpzXCJcbmltcG9ydCB7IGRpcm5hbWUgfSBmcm9tIFwicGF0aFwiXG5pbXBvcnQgeyBmaWxlVVJMVG9QYXRoIH0gZnJvbSBcInVybFwiXG5pbXBvcnQgZnMgZnJvbSBcImZzL3Byb21pc2VzXCJcbmltcG9ydCAqIGFzIGluZmxlY3Rpb24gZnJvbSBcImluZmxlY3Rpb25cIlxuaW1wb3J0IHBhdGggZnJvbSBcInBhdGhcIlxuaW1wb3J0IHsgQXN5bmNMb2NhbFN0b3JhZ2UgYXMgTm9kZUFzeW5jTG9jYWxTdG9yYWdlIH0gZnJvbSBcIm5vZGU6YXN5bmNfaG9va3NcIlxuaW1wb3J0IHsgdGltaW5nU2FmZUVxdWFsIH0gZnJvbSBcIm5vZGU6Y3J5cHRvXCJcbmltcG9ydCByZXF1aXJlQ29udGV4dCBmcm9tIFwicmVxdWlyZS1jb250ZXh0XCJcbmltcG9ydCBBc3luY1RyYWNrZWRNdWx0aUNvbm5lY3Rpb25Qb29sIGZyb20gXCIuLi9kYXRhYmFzZS9wb29sL2FzeW5jLXRyYWNrZWQtbXVsdGktY29ubmVjdGlvbi5qc1wiXG5pbXBvcnQgSW5pdGlhbGl6ZXJGcm9tUmVxdWlyZUNvbnRleHQgZnJvbSBcIi4uL2RhdGFiYXNlL2luaXRpYWxpemVyLWZyb20tcmVxdWlyZS1jb250ZXh0LmpzXCJcbmltcG9ydCBSZWNvcmRBdHRhY2htZW50c1N0b3JlIGZyb20gXCIuLi9kYXRhYmFzZS9yZWNvcmQvYXR0YWNobWVudHMvc3RvcmUuanNcIlxuaW1wb3J0IHRvSW1wb3J0U3BlY2lmaWVyIGZyb20gXCIuLi91dGlscy90by1pbXBvcnQtc3BlY2lmaWVyLmpzXCJcbmltcG9ydCB7IHZhbGlkYXRlVGltZVpvbmUgfSBmcm9tIFwiLi4vdGltZS16b25lLmpzXCJcbmltcG9ydCBBdHRhY2htZW50UGF0aFNvdXJjZSBmcm9tIFwiLi9ub2RlL2F0dGFjaG1lbnQtcGF0aC1zb3VyY2UuanNcIlxuaW1wb3J0IHsgYXV0b21hdGljU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJPbWl0cywgY3JlYXRlU2hhcmVkVHJhbnNhY3Rpb25Qcm94eURyaXZlciwgc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJDb25maWcgfSBmcm9tIFwiLi4vdGVzdGluZy9zaGFyZWQtdHJhbnNhY3Rpb24tcHJveHktZHJpdmVyLmpzXCJcblxuLyoqXG4gKiBEZWZpbmVzIHRoaXMgdHlwZWRlZi5cbiAqIEB0eXBlZGVmIHt7YWJpbGl0eT86IGltcG9ydChcIi4uL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0LCBvZmZzZXRNaW51dGVzOiBudW1iZXIsIHJlcXVlc3RUaW1pbmc/OiBpbXBvcnQoXCIuLi9odHRwLXNlcnZlci9jbGllbnQvcmVxdWVzdC10aW1pbmcuanNcIikuZGVmYXVsdCwgdGVuYW50PzogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIHRlc3RQcm9maWxlQ29udGV4dD86IGltcG9ydChcIi4uL3Rlc3RpbmcvdGVzdC1wcm9maWxlci5qc1wiKS5UZXN0UHJvZmlsZUFzeW5jQ29udGV4dCwgdGltZVpvbmU/OiBzdHJpbmd9fSBUaW1lem9uZVN0b3JlICovXG5cbi8qKlxuICogUnVucyBwYXRoIHdpdGhpbiBhbGxvd2VkIHByZWZpeGVzLlxuICogQHBhcmFtIHtzdHJpbmd9IGZpbGVQYXRoIC0gSW5wdXQgZmlsZSBwYXRoLlxuICogQHBhcmFtIHtzdHJpbmdbXX0gYWxsb3dlZFBhdGhQcmVmaXhlcyAtIEFsbG93ZWQgcGF0aCBwcmVmaXhlcy5cbiAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgaW5wdXQgcGF0aCBpcyBpbnNpZGUgYW4gYWxsb3dlZCBwcmVmaXguXG4gKi9cbmZ1bmN0aW9uIHBhdGhXaXRoaW5BbGxvd2VkUHJlZml4ZXMoZmlsZVBhdGgsIGFsbG93ZWRQYXRoUHJlZml4ZXMpIHtcbiAgY29uc3QgcmVzb2x2ZWRQYXRoID0gcGF0aC5yZXNvbHZlKGZpbGVQYXRoKVxuXG4gIHJldHVybiBhbGxvd2VkUGF0aFByZWZpeGVzLnNvbWUoKGFsbG93ZWRQcmVmaXgpID0+IHtcbiAgICBjb25zdCByZXNvbHZlZFByZWZpeCA9IHBhdGgucmVzb2x2ZShhbGxvd2VkUHJlZml4KVxuICAgIGNvbnN0IHJlbGF0aXZlUGF0aCA9IHBhdGgucmVsYXRpdmUocmVzb2x2ZWRQcmVmaXgsIHJlc29sdmVkUGF0aClcblxuICAgIGlmICghcmVsYXRpdmVQYXRoKSByZXR1cm4gdHJ1ZVxuICAgIGlmIChyZWxhdGl2ZVBhdGguc3RhcnRzV2l0aChcIi4uXCIpKSByZXR1cm4gZmFsc2VcbiAgICBpZiAocGF0aC5pc0Fic29sdXRlKHJlbGF0aXZlUGF0aCkpIHJldHVybiBmYWxzZVxuXG4gICAgcmV0dXJuIHRydWVcbiAgfSlcbn1cblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzRW52aXJvbm1lbnRIYW5kbGVyTm9kZSBleHRlbmRzIEJhc2V7XG4gIC8qKlxuICAgKiBDcmVhdGVzIHRoZSBidWlsdC1pbiBTUUwgcGVyc2lzdGVuY2UgYWRhcHRlci5cbiAgICogQHBhcmFtIHt7Y29uZmlndXJhdGlvbjogaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fX0gYXJncyAtIEFkYXB0ZXIgb3B0aW9ucy5cbiAgICogQHJldHVybnMge1NxbEJhY2tncm91bmRKb2JzQWRhcHRlcn0gLSBTUUwgYWRhcHRlci5cbiAgICovXG4gIGNyZWF0ZUJhY2tncm91bmRKb2JzQWRhcHRlcih7Y29uZmlndXJhdGlvbn0pIHtcbiAgICByZXR1cm4gbmV3IFNxbEJhY2tncm91bmRKb2JzQWRhcHRlcih7Y29uZmlndXJhdGlvbn0pXG4gIH1cblxuICAvKipcbiAgICogUHJlc2VydmVzIHRoZSBOb2RlIFRDUCBwcm9kdWNlciBhbmQgbWFpbi1wcm9jZXNzIHdha2UtdXAgcGF0aC4gVGhlIG1haW5cbiAgICogb3ducyB0aGUgY29uZmlndXJlZCBwZXJzaXN0ZW5jZSBhZGFwdGVyOyBOb2RlIHByb2R1Y2VycyBuZXZlciBieXBhc3MgaXQuXG4gICAqIEBwYXJhbSB7e2NvbmZpZ3VyYXRpb246IGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH19IGFyZ3MgLSBDbGllbnQgb3B0aW9ucy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2JhY2tncm91bmQtam9icy90eXBlcy5qc1wiKS5CYWNrZ3JvdW5kSm9ic1Byb2R1Y2VyfSAtIFByb2R1Y2VyIGNsaWVudC5cbiAgICovXG4gIGJhY2tncm91bmRKb2JzQ2xpZW50KHtjb25maWd1cmF0aW9ufSkge1xuICAgIHJldHVybiBuZXcgQmFja2dyb3VuZEpvYnNDbGllbnQoe2NvbmZpZ3VyYXRpb259KVxuICB9XG5cbiAgLyoqXG4gICAqIEdpdmVzIGNvbmN1cnJlbnQgc2hhcmVkLXRyYW5zYWN0aW9uIGNoaWxkIGpvYnMgaW5kZXBlbmRlbnQgcHJveHkgc2Vzc2lvbnMuXG4gICAqIEEgY29uZmlndXJlZCBzaW5nbGUtY29ubmVjdGlvbiBwb29sIHNoYXJlcyBtdXRhYmxlIHRyYW5zYWN0aW9uIHN0YXRlIGJldHdlZW5cbiAgICogYXN5bmMgam9icywgd2hpbGUgdGhlIGJyb2tlciByZXF1aXJlcyBvbmUgcm9vdC10cmFuc2FjdGlvbiBsZWFzZSBwZXIgc29ja2V0LlxuICAgKiBAcGFyYW0ge3tjb25maWd1cmVkUG9vbFR5cGU6IHR5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9wb29sL2Jhc2UuanNcIikuZGVmYXVsdCwgZGF0YWJhc2VJZGVudGlmaWVyOiBzdHJpbmd9fSBhcmdzIC0gQ29uZmlndXJlZCBwb29sIGFuZCBsb2dpY2FsIGRhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqIEByZXR1cm5zIHt0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcG9vbC9iYXNlLmpzXCIpLmRlZmF1bHR9IC0gUG9vbCB0eXBlIGZvciB0aGlzIGNvbnRleHQuXG4gICAqL1xuICByZXNvbHZlVGVzdFNoYXJlZFRyYW5zYWN0aW9uUG9vbFR5cGUoe2NvbmZpZ3VyZWRQb29sVHlwZSwgZGF0YWJhc2VJZGVudGlmaWVyfSkge1xuICAgIGNvbnN0IGRhdGFiYXNlQ29uZmlndXJhdGlvbiA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldERhdGFiYXNlSWRlbnRpZmllcihkYXRhYmFzZUlkZW50aWZpZXIpXG4gICAgaWYgKGRhdGFiYXNlQ29uZmlndXJhdGlvbi50ZW5hbnRPbmx5ICYmIGF1dG9tYXRpY1NoYXJlZFRyYW5zYWN0aW9uQnJva2VyT21pdHMoZGF0YWJhc2VJZGVudGlmaWVyKSkgcmV0dXJuIGNvbmZpZ3VyZWRQb29sVHlwZVxuICAgIGlmICghc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJDb25maWcoZGF0YWJhc2VJZGVudGlmaWVyKSkgcmV0dXJuIGNvbmZpZ3VyZWRQb29sVHlwZVxuXG4gICAgcmV0dXJuIEFzeW5jVHJhY2tlZE11bHRpQ29ubmVjdGlvblBvb2xcbiAgfVxuXG4gIC8qKlxuICAgKiBDcmVhdGVzIHRoZSBmaWxlc3lzdGVtLWJhY2tlZCBhZHZpc29yeS1sb2NrIGJhY2tlbmQgZm9yIHRoZSBmaWxlIHRpZXJcbiAgICogKFNUQy0yMTMpLiBUaGUgTm9kZSBoYW5kbGVyIGlzIHRoZSBvbmx5IGZpbGVzeXN0ZW0tY2FwYWJsZSBlbnZpcm9ubWVudC5cbiAgICogQHBhcmFtIHt7ZGlyZWN0b3J5OiBzdHJpbmcsIGxlYXNlTXM6IG51bWJlciwgcmVuZXdJbnRlcnZhbE1zOiBudW1iZXJ9fSBhcmdzIC0gQmFja2VuZCBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuLi9kYXRhYmFzZS9hZHZpc29yeS1sb2NrLWZpbGUtYmFja2VuZC5qc1wiKS5kZWZhdWx0Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjcmVhdGVkIGJhY2tlbmQuXG4gICAqL1xuICBhc3luYyBjcmVhdGVBZHZpc29yeUxvY2tGaWxlQmFja2VuZChhcmdzKSB7XG4gICAgcmV0dXJuIG5ldyBBZHZpc29yeUxvY2tGaWxlQmFja2VuZChhcmdzKVxuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZXMgdGhlIGxvY2stc2VydmVyIGFkdmlzb3J5LWxvY2sgYmFja2VuZCBvdmVyIHRoZSBOb2RlIHdlYnNvY2tldCB0cmFuc3BvcnQuXG4gICAqIEBwYXJhbSB7Q29uc3RydWN0b3JQYXJhbWV0ZXJzPHR5cGVvZiBBZHZpc29yeUxvY2tMb2NrU2VydmVyQmFja2VuZD5bMF19IGFyZ3MgLSBCYWNrZW5kIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4uL2RhdGFiYXNlL2Fkdmlzb3J5LWxvY2stbG9jay1zZXJ2ZXItYmFja2VuZC5qc1wiKS5kZWZhdWx0Pn0gLSBDcmVhdGVkIGJhY2tlbmQuXG4gICAqL1xuICBhc3luYyBjcmVhdGVBZHZpc29yeUxvY2tMb2NrU2VydmVyQmFja2VuZChhcmdzKSB7XG4gICAgcmV0dXJuIG5ldyBBZHZpc29yeUxvY2tMb2NrU2VydmVyQmFja2VuZChhcmdzKVxuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZXMgYSB0ZXN0LW9ubHkgY2hpbGQgcHJveHkgd2hlbiBUZXN0UnVubmVyIHN1cHBsaWVkIGFuIGFjdGl2ZSBicm9rZXIuXG4gICAqIEBwYXJhbSB7e0RyaXZlckNsYXNzOiB0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQsIGNvbmZpZzogaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlLCBjb25maWd1cmF0aW9uOiBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHQsIGRhdGFiYXNlSWRlbnRpZmllcjogc3RyaW5nLCByZXVzZUtleT86IHN0cmluZ319IGFyZ3MgLSBDb25uZWN0aW9uIGRldGFpbHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkPn0gLSBPcHRpb25hbCBwcm94eS5cbiAgICovXG4gIGFzeW5jIGNyZWF0ZVRlc3RTaGFyZWRUcmFuc2FjdGlvbkNvbm5lY3Rpb24oe0RyaXZlckNsYXNzLCBjb25maWcsIGNvbmZpZ3VyYXRpb24sIGRhdGFiYXNlSWRlbnRpZmllciwgcmV1c2VLZXl9KSB7XG4gICAgaWYgKGNvbmZpZy50ZW5hbnRPbmx5ICYmIGF1dG9tYXRpY1NoYXJlZFRyYW5zYWN0aW9uQnJva2VyT21pdHMoZGF0YWJhc2VJZGVudGlmaWVyKSkgcmV0dXJuIHVuZGVmaW5lZFxuICAgIGNvbnN0IGJyb2tlckNvbmZpZyA9IHNoYXJlZFRyYW5zYWN0aW9uQnJva2VyQ29uZmlnKGRhdGFiYXNlSWRlbnRpZmllcilcbiAgICBpZiAoIWJyb2tlckNvbmZpZykgcmV0dXJuIHVuZGVmaW5lZFxuICAgIHJldHVybiBjcmVhdGVTaGFyZWRUcmFuc2FjdGlvblByb3h5RHJpdmVyKERyaXZlckNsYXNzLCBjb25maWcsIGNvbmZpZ3VyYXRpb24sIGRhdGFiYXNlSWRlbnRpZmllciwge1xuICAgICAgLi4uYnJva2VyQ29uZmlnLFxuICAgICAgcmV1c2VLZXk6IGJyb2tlckNvbmZpZy5hbGxvd0R5bmFtaWNJZGVudGl0aWVzID8gcmV1c2VLZXkgOiB1bmRlZmluZWRcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFRpbWV6b25lIGFzeW5jIGxvY2FsIHN0b3JhZ2UuXG4gICAqIEB0eXBlIHtpbXBvcnQoXCJub2RlOmFzeW5jX2hvb2tzXCIpLkFzeW5jTG9jYWxTdG9yYWdlPFRpbWV6b25lU3RvcmU+IHwgdW5kZWZpbmVkfSAqL1xuICBfdGltZXpvbmVBc3luY0xvY2FsU3RvcmFnZSA9IE5vZGVBc3luY0xvY2FsU3RvcmFnZSA/IG5ldyBOb2RlQXN5bmNMb2NhbFN0b3JhZ2UoKSA6IHVuZGVmaW5lZFxuXG4gIC8qKlxuICAgKiBTaGFyZWQtdHJhbnNhY3Rpb24gY29vcmRpbmF0b3Igb3duZXJzaGlwIGJ5IHBoeXNpY2FsIGNvbm5lY3Rpb24uXG4gICAqIEB0eXBlIHtpbXBvcnQoXCJub2RlOmFzeW5jX2hvb2tzXCIpLkFzeW5jTG9jYWxTdG9yYWdlPE1hcDxvYmplY3QsIHN5bWJvbD4+IHwgdW5kZWZpbmVkfVxuICAgKi9cbiAgX3NoYXJlZFRyYW5zYWN0aW9uQ29vcmRpbmF0b3JBc3luY0xvY2FsU3RvcmFnZSA9IE5vZGVBc3luY0xvY2FsU3RvcmFnZSA/IG5ldyBOb2RlQXN5bmNMb2NhbFN0b3JhZ2UoKSA6IHVuZGVmaW5lZFxuXG4gIC8qKlxuICAgKiBHZXRzIHRoZSBhY3RpdmUgc2hhcmVkLXRyYW5zYWN0aW9uIGNvb3JkaW5hdG9yIG93bmVyIGZvciBhIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBjb25uZWN0aW9uIC0gUGFyZW50IHBoeXNpY2FsIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtzeW1ib2wgfCB1bmRlZmluZWR9IC0gQWN0aXZlIGNvb3JkaW5hdG9yIG93bmVyLlxuICAgKi9cbiAgZ2V0U2hhcmVkVHJhbnNhY3Rpb25Db29yZGluYXRvck93bmVyKGNvbm5lY3Rpb24pIHtcbiAgICByZXR1cm4gdGhpcy5fc2hhcmVkVHJhbnNhY3Rpb25Db29yZGluYXRvckFzeW5jTG9jYWxTdG9yYWdlPy5nZXRTdG9yZSgpPy5nZXQoY29ubmVjdGlvbilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdvcmsgYXMgdGhlIGN1cnJlbnQgc2hhcmVkLXRyYW5zYWN0aW9uIGNvb3JkaW5hdG9yIG93bmVyLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge29iamVjdH0gY29ubmVjdGlvbiAtIFBhcmVudCBwaHlzaWNhbCBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N5bWJvbH0gb3duZXIgLSBDb29yZGluYXRvciBvd25lci5cbiAgICogQHBhcmFtIHsoKSA9PiBUfSBjYWxsYmFjayAtIE93bmVkIHdvcmsuXG4gICAqIEByZXR1cm5zIHtUfSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIHJ1bldpdGhTaGFyZWRUcmFuc2FjdGlvbkNvb3JkaW5hdG9yT3duZXIoY29ubmVjdGlvbiwgb3duZXIsIGNhbGxiYWNrKSB7XG4gICAgaWYgKCF0aGlzLl9zaGFyZWRUcmFuc2FjdGlvbkNvb3JkaW5hdG9yQXN5bmNMb2NhbFN0b3JhZ2UpIHJldHVybiBjYWxsYmFjaygpXG5cbiAgICBjb25zdCBvd25lcnMgPSBuZXcgTWFwKHRoaXMuX3NoYXJlZFRyYW5zYWN0aW9uQ29vcmRpbmF0b3JBc3luY0xvY2FsU3RvcmFnZS5nZXRTdG9yZSgpKVxuXG4gICAgb3duZXJzLnNldChjb25uZWN0aW9uLCBvd25lcilcbiAgICByZXR1cm4gdGhpcy5fc2hhcmVkVHJhbnNhY3Rpb25Db29yZGluYXRvckFzeW5jTG9jYWxTdG9yYWdlLnJ1bihvd25lcnMsIGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd29yayB3aXRob3V0IGluaGVyaXRlZCBzaGFyZWQtdHJhbnNhY3Rpb24gb3duZXJzaGlwIGZvciBvbmUgY29ubmVjdGlvbi5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gY29ubmVjdGlvbiAtIFBoeXNpY2FsIGNvbm5lY3Rpb24gd2hvc2Ugb3duZXIgaXMgY2xlYXJlZC5cbiAgICogQHBhcmFtIHsoKSA9PiBUfSBjYWxsYmFjayAtIFBoeXNpY2FsIGNvbm5lY3Rpb24gd29yay5cbiAgICogQHJldHVybnMge1R9IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgcnVuV2l0aG91dFNoYXJlZFRyYW5zYWN0aW9uQ29vcmRpbmF0b3JPd25lcihjb25uZWN0aW9uLCBjYWxsYmFjaykge1xuICAgIGlmICghdGhpcy5fc2hhcmVkVHJhbnNhY3Rpb25Db29yZGluYXRvckFzeW5jTG9jYWxTdG9yYWdlKSByZXR1cm4gY2FsbGJhY2soKVxuXG4gICAgY29uc3Qgb3duZXJzID0gbmV3IE1hcCh0aGlzLl9zaGFyZWRUcmFuc2FjdGlvbkNvb3JkaW5hdG9yQXN5bmNMb2NhbFN0b3JhZ2UuZ2V0U3RvcmUoKSlcblxuICAgIG93bmVycy5kZWxldGUoY29ubmVjdGlvbilcbiAgICByZXR1cm4gdGhpcy5fc2hhcmVkVHJhbnNhY3Rpb25Db29yZGluYXRvckFzeW5jTG9jYWxTdG9yYWdlLnJ1bihvd25lcnMsIGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd29yayB3aXRob3V0IGluaGVyaXRlZCBzaGFyZWQtdHJhbnNhY3Rpb24gY29vcmRpbmF0b3Igb3duZXJzaGlwLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0geygpID0+IFR9IGNhbGxiYWNrIC0gRGV0YWNoZWQgd29yay5cbiAgICogQHJldHVybnMge1R9IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgcnVuV2l0aG91dFNoYXJlZFRyYW5zYWN0aW9uQ29vcmRpbmF0b3JPd25lcnMoY2FsbGJhY2spIHtcbiAgICBpZiAoIXRoaXMuX3NoYXJlZFRyYW5zYWN0aW9uQ29vcmRpbmF0b3JBc3luY0xvY2FsU3RvcmFnZSkgcmV0dXJuIGNhbGxiYWNrKClcblxuICAgIHJldHVybiB0aGlzLl9zaGFyZWRUcmFuc2FjdGlvbkNvb3JkaW5hdG9yQXN5bmNMb2NhbFN0b3JhZ2UucnVuKG5ldyBNYXAoKSwgY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogUnVucyB3b3JrIHdpdGggYXN5bmMtc2FmZSB0ZXN0IHByb2ZpbGUgYXR0cmlidXRpb24uXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vdGVzdGluZy90ZXN0LXByb2ZpbGVyLmpzXCIpLlRlc3RQcm9maWxlQXN5bmNDb250ZXh0IHwgdW5kZWZpbmVkfSBjb250ZXh0IC0gQ2FwdHVyZWQgcHJvZmlsZSBjb250ZXh0LCBvciBhbiBleHBsaWNpdCBhYnNlbmNlIG9mIGF0dHJpYnV0aW9uLlxuICAgKiBAcGFyYW0geygpID0+IFR9IGNhbGxiYWNrIC0gUHJvZmlsZWQgd29yay5cbiAgICogQHJldHVybnMge1R9IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgcnVuV2l0aFRlc3RQcm9maWxlQ29udGV4dChjb250ZXh0LCBjYWxsYmFjaykge1xuICAgIGlmICghdGhpcy5fdGltZXpvbmVBc3luY0xvY2FsU3RvcmFnZSkgcmV0dXJuIGNhbGxiYWNrKClcblxuICAgIGNvbnN0IGV4aXN0aW5nU3RvcmUgPSB0aGlzLl90aW1lem9uZUFzeW5jTG9jYWxTdG9yYWdlLmdldFN0b3JlKClcblxuICAgIHJldHVybiB0aGlzLl90aW1lem9uZUFzeW5jTG9jYWxTdG9yYWdlLnJ1bih7XG4gICAgICBhYmlsaXR5OiBleGlzdGluZ1N0b3JlPy5hYmlsaXR5LFxuICAgICAgb2Zmc2V0TWludXRlczogZXhpc3RpbmdTdG9yZT8ub2Zmc2V0TWludXRlcyA/PyB0aGlzLmdldFRpbWV6b25lT2Zmc2V0TWludXRlcyh0aGlzLmdldENvbmZpZ3VyYXRpb24oKSksXG4gICAgICByZXF1ZXN0VGltaW5nOiBleGlzdGluZ1N0b3JlPy5yZXF1ZXN0VGltaW5nLFxuICAgICAgdGVuYW50OiBleGlzdGluZ1N0b3JlPy50ZW5hbnQsXG4gICAgICB0ZXN0UHJvZmlsZUNvbnRleHQ6IGNvbnRleHQsXG4gICAgICB0aW1lWm9uZTogZXhpc3RpbmdTdG9yZT8udGltZVpvbmUgPz8gdGhpcy5nZXRUaW1lWm9uZSh0aGlzLmdldENvbmZpZ3VyYXRpb24oKSlcbiAgICB9LCBjYWxsYmFjaylcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXRzIHRoZSBjdXJyZW50IGFzeW5jLXNhZmUgdGVzdCBwcm9maWxlIGF0dHJpYnV0aW9uIGNvbnRleHQuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi90ZXN0aW5nL3Rlc3QtcHJvZmlsZXIuanNcIikuVGVzdFByb2ZpbGVBc3luY0NvbnRleHQgfCB1bmRlZmluZWR9IC0gQ3VycmVudCBjb250ZXh0LlxuICAgKi9cbiAgZ2V0Q3VycmVudFRlc3RQcm9maWxlQ29udGV4dCgpIHtcbiAgICByZXR1cm4gdGhpcy5fdGltZXpvbmVBc3luY0xvY2FsU3RvcmFnZT8uZ2V0U3RvcmUoKT8udGVzdFByb2ZpbGVDb250ZXh0XG4gIH1cblxuICAvKipcbiAgICogRmluZCBjb21tYW5kcyByZXN1bHQuXG4gICAqIEB0eXBlIHtpbXBvcnQoXCIuL2Jhc2UuanNcIikuQ29tbWFuZEZpbGVPYmplY3RUeXBlW10gfCB1bmRlZmluZWR9ICovXG4gIF9maW5kQ29tbWFuZHNSZXN1bHQgPSB1bmRlZmluZWRcblxuICAvKipcbiAgICogUnVucyBkZWJ1ZyBlbmRwb2ludCB0b2tlbiBtYXRjaGVzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcHJvdmlkZWRUb2tlbiAtIFRva2VuIGZyb20gdGhlIHJlcXVlc3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBleHBlY3RlZFRva2VuIC0gQ29uZmlndXJlZCB0b2tlbi5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBib3RoIHRva2VucyBtYXRjaC5cbiAgICovXG4gIGRlYnVnRW5kcG9pbnRUb2tlbk1hdGNoZXMocHJvdmlkZWRUb2tlbiwgZXhwZWN0ZWRUb2tlbikge1xuICAgIGNvbnN0IHByb3ZpZGVkID0gQnVmZmVyLmZyb20ocHJvdmlkZWRUb2tlbilcbiAgICBjb25zdCBleHBlY3RlZCA9IEJ1ZmZlci5mcm9tKGV4cGVjdGVkVG9rZW4pXG5cbiAgICByZXR1cm4gcHJvdmlkZWQubGVuZ3RoID09PSBleHBlY3RlZC5sZW5ndGggJiYgdGltaW5nU2FmZUVxdWFsKHByb3ZpZGVkLCBleHBlY3RlZClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBmcmFtZXdvcmsgc291cmNlIGRpcmVjdG9yeS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBWZWxvY2lvdXMgc291cmNlIGRpcmVjdG9yeSB1c2VkIHRvIGZpbHRlciBmcmFtZXdvcmsgc3RhY2sgZnJhbWVzLlxuICAgKi9cbiAgZ2V0RnJhbWV3b3JrU291cmNlRGlyZWN0b3J5KCkge1xuICAgIHJldHVybiBGUkFNRVdPUktfU09VUkNFX0RJUkVDVE9SWVxuICB9XG5cbiAgLyoqXG4gICAqIEF1dG8tZGlzY292ZXJzIHJlc291cmNlIGNsYXNzZXMgZnJvbSBzcmMvcmVzb3VyY2VzLyBpbiBlYWNoIGJhY2tlbmQgcHJvamVjdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIGF1dG9EaXNjb3ZlclJlc291cmNlcyhjb25maWd1cmF0aW9uKSB7XG4gICAgY29uc3Qge2Zyb250ZW5kTW9kZWxSZXNvdXJjZURlZmluaXRpb25Jc0NsYXNzfSA9IGF3YWl0IGltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVscy9yZXNvdXJjZS1kZWZpbml0aW9uLmpzXCIpXG4gICAgY29uc3Qge2RlZmF1bHQ6IEF1dGhvcml6YXRpb25CYXNlUmVzb3VyY2V9ID0gYXdhaXQgaW1wb3J0KFwiLi4vYXV0aG9yaXphdGlvbi9iYXNlLXJlc291cmNlLmpzXCIpXG4gICAgY29uc3QgYmFja2VuZFByb2plY3RzID0gY29uZmlndXJhdGlvbi5nZXRCYWNrZW5kUHJvamVjdHMoKVxuXG4gICAgZm9yIChjb25zdCBiYWNrZW5kUHJvamVjdCBvZiBiYWNrZW5kUHJvamVjdHMpIHtcbiAgICAgIGlmIChiYWNrZW5kUHJvamVjdC5hYmlsaXR5UmVzb3VyY2VzKSBjb250aW51ZVxuXG4gICAgICBjb25zdCByZXNvdXJjZXNEaXIgPSBiYWNrZW5kUHJvamVjdC5yZXNvdXJjZXNQYXRoIHx8IHBhdGguam9pbihiYWNrZW5kUHJvamVjdC5wYXRoLCBcInNyY1wiLCBcInJlc291cmNlc1wiKVxuICAgICAgbGV0IGZpbGVzXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGZpbGVzID0gYXdhaXQgZnMucmVhZGRpcihyZXNvdXJjZXNEaXIpXG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgLyoqXG4gICAgICAgKiBEaXNjb3ZlcmVkIGZyb250ZW5kLW1vZGVsIHJlc291cmNlcyBrZXllZCBieSBtb2RlbCBuYW1lLlxuICAgICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICAgIGNvbnN0IGRpc2NvdmVyZWQgPSB7fVxuICAgICAgLyoqXG4gICAgICAgKiBFdmVyeSBkaXNjb3ZlcmVkIGFiaWxpdHkgcmVzb3VyY2UgY2xhc3MgKGZyb250ZW5kLW1vZGVsIGFuZCBhdXRob3JpemF0aW9uKS5cbiAgICAgICAqIEB0eXBlIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgICBjb25zdCBhYmlsaXR5UmVzb3VyY2VDbGFzc2VzID0gW11cblxuICAgICAgZm9yIChjb25zdCBmaWxlIG9mIGZpbGVzKSB7XG4gICAgICAgIGlmICghZmlsZS5lbmRzV2l0aChcIi5qc1wiKSAmJiAhZmlsZS5lbmRzV2l0aChcIi5tanNcIikpIGNvbnRpbnVlXG4gICAgICAgIGlmIChmaWxlLnN0YXJ0c1dpdGgoXCJmcm9udGVuZC1tb2RlbC1yZXNvdXJjZXNcIikpIGNvbnRpbnVlXG5cbiAgICAgICAgY29uc3QgZmlsZVBhdGggPSBwYXRoLmpvaW4ocmVzb3VyY2VzRGlyLCBmaWxlKVxuICAgICAgICBjb25zdCBpbXBvcnRlZCA9IGF3YWl0IGltcG9ydChmaWxlUGF0aClcbiAgICAgICAgY29uc3QgUmVzb3VyY2VDbGFzcyA9IGltcG9ydGVkLmRlZmF1bHRcblxuICAgICAgICAvLyBBbnkgYXV0aG9yaXphdGlvbiByZXNvdXJjZSAoZnJvbnRlbmQtbW9kZWwgcmVzb3VyY2VzIGFsc28gZXh0ZW5kIGl0KSB0aGF0XG4gICAgICAgIC8vIGRlY2xhcmVzIGEgYE1vZGVsQ2xhc3NgOyBza2lwIGFic3RyYWN0L2NvbW1vbiBiYXNlIHJlc291cmNlcyB3aXRob3V0IG9uZS5cbiAgICAgICAgY29uc3QgaXNBYmlsaXR5UmVzb3VyY2UgPSB0eXBlb2YgUmVzb3VyY2VDbGFzcyA9PT0gXCJmdW5jdGlvblwiXG4gICAgICAgICAgJiYgKFJlc291cmNlQ2xhc3MgPT09IEF1dGhvcml6YXRpb25CYXNlUmVzb3VyY2UgfHwgUmVzb3VyY2VDbGFzcy5wcm90b3R5cGUgaW5zdGFuY2VvZiBBdXRob3JpemF0aW9uQmFzZVJlc291cmNlKVxuXG4gICAgICAgIGlmICghaXNBYmlsaXR5UmVzb3VyY2UgfHwgIVJlc291cmNlQ2xhc3MuTW9kZWxDbGFzcykgY29udGludWVcblxuICAgICAgICBhYmlsaXR5UmVzb3VyY2VDbGFzc2VzLnB1c2goUmVzb3VyY2VDbGFzcylcblxuICAgICAgICAvLyBPbmx5IGZyb250ZW5kLW1vZGVsIHJlc291cmNlcyBkcml2ZSByb3V0aW5nL2dlbmVyYXRpb24vcHVibGlzaGVyIGRpc2NvdmVyeS5cbiAgICAgICAgaWYgKCFmcm9udGVuZE1vZGVsUmVzb3VyY2VEZWZpbml0aW9uSXNDbGFzcyhSZXNvdXJjZUNsYXNzKSkgY29udGludWVcblxuICAgICAgICBjb25zdCBiYXNlTmFtZSA9IGZpbGUucmVwbGFjZSgvXFwuKGpzfG1qcykkLywgXCJcIilcbiAgICAgICAgY29uc3QgbW9kZWxOYW1lID0gYmFzZU5hbWUucmVwbGFjZSgvLXJlc291cmNlJC8sIFwiXCIpXG4gICAgICAgICAgLnNwbGl0KFwiLVwiKVxuICAgICAgICAgIC5tYXAoKC8qKiBAdHlwZSB7c3RyaW5nfSAqLyBwYXJ0KSA9PiBwYXJ0LmNoYXJBdCgwKS50b1VwcGVyQ2FzZSgpICsgcGFydC5zbGljZSgxKSlcbiAgICAgICAgICAuam9pbihcIlwiKVxuXG4gICAgICAgIGRpc2NvdmVyZWRbbW9kZWxOYW1lXSA9IFJlc291cmNlQ2xhc3NcbiAgICAgIH1cblxuICAgICAgaWYgKCFiYWNrZW5kUHJvamVjdC5mcm9udGVuZE1vZGVscyAmJiBPYmplY3Qua2V5cyhkaXNjb3ZlcmVkKS5sZW5ndGggPiAwKSB7XG4gICAgICAgIGJhY2tlbmRQcm9qZWN0LmZyb250ZW5kTW9kZWxzID0gZGlzY292ZXJlZFxuICAgICAgfVxuXG4gICAgICBpZiAoYWJpbGl0eVJlc291cmNlQ2xhc3Nlcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGJhY2tlbmRQcm9qZWN0LmFiaWxpdHlSZXNvdXJjZXMgPSBhYmlsaXR5UmVzb3VyY2VDbGFzc2VzXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIExvYWRzIG1vZGVscyBjb250cmlidXRlZCBieSByZWdpc3RlcmVkIHBhY2thZ2VzIGludG8gdGhlIG1vZGVsIHJlZ2lzdHJ5LFxuICAgKiBhZnRlciB0aGUgYXBwJ3Mgb3duIGBpbml0aWFsaXplTW9kZWxzYCBob29rLiBBIHBhY2thZ2Ugd2hvc2UgbW9kZWxzIGRpcmVjdG9yeVxuICAgKiBpcyBhYnNlbnQgaXMgc2tpcHBlZDsgYSBwYWNrYWdlIG1vZGVsIHdob3NlIG5hbWUgY29sbGlkZXMgd2l0aCBhblxuICAgKiBhbHJlYWR5LXJlZ2lzdGVyZWQgZGlmZmVyZW50IGNsYXNzIHRocm93cy4gTm9kZS1vbmx5ICh1c2VzIHRoZSBmaWxlc3lzdGVtKSwgc29cbiAgICogaXQgbGl2ZXMgaGVyZSByYXRoZXIgdGhhbiBpbiB0aGUgYnJvd3Nlci1idW5kbGVkIENvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBjb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGluaXRpYWxpemVQYWNrYWdlTW9kZWxzKGNvbmZpZ3VyYXRpb24pIHtcbiAgICBmb3IgKGNvbnN0IHZlbG9jaW91c1BhY2thZ2Ugb2YgY29uZmlndXJhdGlvbi5nZXRQYWNrYWdlcygpKSB7XG4gICAgICBjb25zdCBtb2RlbHNQYXRoID0gdmVsb2Npb3VzUGFja2FnZS5nZXRNb2RlbHNQYXRoKClcblxuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgZnMuYWNjZXNzKG1vZGVsc1BhdGgpXG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgY29uc3QgcGFja2FnZVJlcXVpcmVDb250ZXh0ID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9pbml0aWFsaXplci1mcm9tLXJlcXVpcmUtY29udGV4dC5qc1wiKS5Nb2RlbENsYXNzUmVxdWlyZUNvbnRleHRUeXBlfSAqLyAocmVxdWlyZUNvbnRleHQobW9kZWxzUGF0aCwgdHJ1ZSwgL14oLispXFwuanMkLykpXG4gICAgICBjb25zdCBtb2RlbENsYXNzZXMgPSBjb25maWd1cmF0aW9uLmdldE1vZGVsQ2xhc3NlcygpXG5cbiAgICAgIGZvciAoY29uc3QgZmlsZU5hbWUgb2YgcGFja2FnZVJlcXVpcmVDb250ZXh0LmtleXMoKSkge1xuICAgICAgICBjb25zdCBtb2RlbENsYXNzID0gcGFja2FnZVJlcXVpcmVDb250ZXh0KGZpbGVOYW1lKT8uZGVmYXVsdFxuICAgICAgICBjb25zdCBleGlzdGluZyA9IG1vZGVsQ2xhc3MgJiYgbW9kZWxDbGFzc2VzW21vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCldXG5cbiAgICAgICAgaWYgKGV4aXN0aW5nICYmIGV4aXN0aW5nICE9PSBtb2RlbENsYXNzKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBQYWNrYWdlIFwiJHt2ZWxvY2lvdXNQYWNrYWdlLmdldE5hbWUoKX1cIiBtb2RlbCBcIiR7bW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKX1cIiBjb2xsaWRlcyB3aXRoIGFuIGFscmVhZHktcmVnaXN0ZXJlZCBtb2RlbC5gKVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGF3YWl0IGNvbmZpZ3VyYXRpb24uZW5zdXJlQ29ubmVjdGlvbnMoe25hbWU6IGBJbml0aWFsaXplICR7dmVsb2Npb3VzUGFja2FnZS5nZXROYW1lKCl9IHBhY2thZ2UgbW9kZWxzYH0sIGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgbmV3IEluaXRpYWxpemVyRnJvbVJlcXVpcmVDb250ZXh0KHtyZXF1aXJlQ29udGV4dDogcGFja2FnZVJlcXVpcmVDb250ZXh0fSkuaW5pdGlhbGl6ZSh7Y29uZmlndXJhdGlvbn0pXG4gICAgICB9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gbmV3Q29uZmlndXJhdGlvbiAtIE5ldyBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRDb25maWd1cmF0aW9uKG5ld0NvbmZpZ3VyYXRpb24pIHtcbiAgICBzdXBlci5zZXRDb25maWd1cmF0aW9uKG5ld0NvbmZpZ3VyYXRpb24pXG5cbiAgICBpZiAoIW5ld0NvbmZpZ3VyYXRpb24uZ2V0Um91dGVSZXNvbHZlckhvb2tzKCkuaW5jbHVkZXMoZnJvbnRlbmRNb2RlbENvbW1hbmRSb3V0ZUhvb2spKSB7XG4gICAgICBuZXdDb25maWd1cmF0aW9uLmFkZFJvdXRlUmVzb2x2ZXJIb29rKGZyb250ZW5kTW9kZWxDb21tYW5kUm91dGVIb29rKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlYWQgYXR0YWNobWVudCBpbnB1dCBmaWxlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZmlsZVBhdGggLSBGaWxlIHBhdGguXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEJ1ZmZlcj59IC0gRmlsZSBieXRlcy5cbiAgICovXG4gIGFzeW5jIHJlYWRBdHRhY2htZW50SW5wdXRGaWxlKGZpbGVQYXRoKSB7XG4gICAgcmV0dXJuIGF3YWl0IGZzLnJlYWRGaWxlKGZpbGVQYXRoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVzb2x2ZSBhdHRhY2htZW50IGlucHV0IHBhdGguXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJncy5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gYXJncy5hbGxvd2VkUGF0aFByZWZpeGVzIC0gQWxsb3dlZCBwYXRoIHByZWZpeGVzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5pbnB1dFBhdGggLSBJbnB1dCBwYXRoLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBdHRhY2htZW50UGF0aFNvdXJjZT59IC0gT3BlbmVkIHJlZ3VsYXItZmlsZSBwYXRoIHNvdXJjZS5cbiAgICovXG4gIGFzeW5jIHJlc29sdmVBdHRhY2htZW50SW5wdXRQYXRoKHthbGxvd2VkUGF0aFByZWZpeGVzLCBpbnB1dFBhdGh9KSB7XG4gICAgY29uc3QgZmlsZVBhdGggPSBwYXRoLnJlc29sdmUoaW5wdXRQYXRoKVxuICAgIGNvbnN0IHByZWZpeGVzID0gQXJyYXkuaXNBcnJheShhbGxvd2VkUGF0aFByZWZpeGVzKVxuICAgICAgPyBhbGxvd2VkUGF0aFByZWZpeGVzLmZpbHRlcigoZW50cnkpID0+IHR5cGVvZiBlbnRyeSA9PT0gXCJzdHJpbmdcIiAmJiBlbnRyeS5sZW5ndGggPiAwKVxuICAgICAgOiBbXVxuXG4gICAgaWYgKHByZWZpeGVzLmxlbmd0aCA+IDAgJiYgIXBhdGhXaXRoaW5BbGxvd2VkUHJlZml4ZXMoZmlsZVBhdGgsIHByZWZpeGVzKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQXR0YWNobWVudCBwYXRoIGlzIG91dHNpZGUgYWxsb3dlZCBkaXJlY3Rvcmllc1wiKVxuICAgIH1cblxuICAgIGNvbnN0IGZpbGVIYW5kbGUgPSBhd2FpdCBmcy5vcGVuKGZpbGVQYXRoLCBcInJcIilcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBmaWxlU3RhdHMgPSBhd2FpdCBmaWxlSGFuZGxlLnN0YXQoKVxuXG4gICAgICBpZiAoIWZpbGVTdGF0cy5pc0ZpbGUoKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJBdHRhY2htZW50IHBhdGggbXVzdCByZWZlcmVuY2UgYSByZWd1bGFyIGZpbGVcIilcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIG5ldyBBdHRhY2htZW50UGF0aFNvdXJjZSh7XG4gICAgICAgIGJ5dGVTaXplOiBmaWxlU3RhdHMuc2l6ZSxcbiAgICAgICAgZmlsZUhhbmRsZSxcbiAgICAgICAgZmlsZVBhdGhcbiAgICAgIH0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IGZpbGVIYW5kbGUuY2xvc2UoKVxuICAgICAgfSBjYXRjaCAoY2xvc2VFcnJvcikge1xuICAgICAgICB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoXG4gICAgICAgICAgW2Vycm9yLCBjbG9zZUVycm9yXSxcbiAgICAgICAgICBgQXR0YWNobWVudCBwYXRoIHZhbGlkYXRpb24gYW5kIHNvdXJjZSBjbG9zZSBib3RoIGZhaWxlZCBmb3IgJHtmaWxlUGF0aH1gLFxuICAgICAgICAgIHtjYXVzZTogY2xvc2VFcnJvcn1cbiAgICAgICAgKVxuICAgICAgfVxuXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQgY29tbWFuZHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5PGltcG9ydChcIi4vYmFzZS5qc1wiKS5Db21tYW5kRmlsZU9iamVjdFR5cGU+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjb21tYW5kcy5cbiAgICovXG4gIGFzeW5jIGZpbmRDb21tYW5kcygpIHtcbiAgICB0aGlzLl9maW5kQ29tbWFuZHNSZXN1bHQgfHw9IGF3YWl0IHRoaXMuX2FjdHVhbEZpbmRDb21tYW5kcygpXG5cbiAgICBpZiAoIXRoaXMuX2ZpbmRDb21tYW5kc1Jlc3VsdCkgdGhyb3cgbmV3IEVycm9yKFwiQ291bGQgbm90IGdldCBjb21tYW5kc1wiKVxuXG4gICAgcmV0dXJuIHRoaXMuX2ZpbmRDb21tYW5kc1Jlc3VsdFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcnVuIHdpdGggdGltZXpvbmUgb2Zmc2V0LlxuICAgKiBAcGFyYW0ge251bWJlcn0gb2Zmc2V0TWludXRlcyAtIE9mZnNldCBpbiBtaW51dGVzIChEYXRlI2dldFRpbWV6b25lT2Zmc2V0KS5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY2FsbGJhY2sgLSBDYWxsYmFjayB0byBydW4uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXN1bHQgb2YgdGhlIGNhbGxiYWNrLlxuICAgKi9cbiAgYXN5bmMgcnVuV2l0aFRpbWV6b25lT2Zmc2V0KG9mZnNldE1pbnV0ZXMsIGNhbGxiYWNrKSB7XG4gICAgaWYgKCF0aGlzLl90aW1lem9uZUFzeW5jTG9jYWxTdG9yYWdlKSB7XG4gICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soKVxuICAgIH1cblxuICAgIGNvbnN0IGV4aXN0aW5nU3RvcmUgPSB0aGlzLl90aW1lem9uZUFzeW5jTG9jYWxTdG9yYWdlLmdldFN0b3JlKClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl90aW1lem9uZUFzeW5jTG9jYWxTdG9yYWdlLnJ1bih7XG4gICAgICBhYmlsaXR5OiBleGlzdGluZ1N0b3JlPy5hYmlsaXR5LFxuICAgICAgb2Zmc2V0TWludXRlcyxcbiAgICAgIHJlcXVlc3RUaW1pbmc6IGV4aXN0aW5nU3RvcmU/LnJlcXVlc3RUaW1pbmcsXG4gICAgICB0ZW5hbnQ6IGV4aXN0aW5nU3RvcmU/LnRlbmFudCxcbiAgICAgIHRlc3RQcm9maWxlQ29udGV4dDogZXhpc3RpbmdTdG9yZT8udGVzdFByb2ZpbGVDb250ZXh0LFxuICAgICAgdGltZVpvbmU6IGV4aXN0aW5nU3RvcmU/LnRpbWVab25lID8/IHRoaXMuZ2V0VGltZVpvbmUodGhpcy5nZXRDb25maWd1cmF0aW9uKCkpXG4gICAgfSwgY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogUnVucyBydW4gd2l0aCB0aW1lem9uZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRpbWVab25lIC0gSUFOQSB0aW1lem9uZSBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjYWxsYmFjayAtIENhbGxiYWNrIHRvIHJ1bi5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc3VsdCBvZiB0aGUgY2FsbGJhY2suXG4gICAqL1xuICBhc3luYyBydW5XaXRoVGltZXpvbmUodGltZVpvbmUsIGNhbGxiYWNrKSB7XG4gICAgaWYgKCF0aGlzLl90aW1lem9uZUFzeW5jTG9jYWxTdG9yYWdlKSB7XG4gICAgICByZXR1cm4gYXdhaXQgc3VwZXIucnVuV2l0aFRpbWV6b25lKHRpbWVab25lLCBjYWxsYmFjaylcbiAgICB9XG5cbiAgICBjb25zdCBleGlzdGluZ1N0b3JlID0gdGhpcy5fdGltZXpvbmVBc3luY0xvY2FsU3RvcmFnZS5nZXRTdG9yZSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fdGltZXpvbmVBc3luY0xvY2FsU3RvcmFnZS5ydW4oe1xuICAgICAgYWJpbGl0eTogZXhpc3RpbmdTdG9yZT8uYWJpbGl0eSxcbiAgICAgIG9mZnNldE1pbnV0ZXM6IGV4aXN0aW5nU3RvcmU/Lm9mZnNldE1pbnV0ZXMgPz8gdGhpcy5nZXRUaW1lem9uZU9mZnNldE1pbnV0ZXModGhpcy5nZXRDb25maWd1cmF0aW9uKCkpLFxuICAgICAgcmVxdWVzdFRpbWluZzogZXhpc3RpbmdTdG9yZT8ucmVxdWVzdFRpbWluZyxcbiAgICAgIHRlbmFudDogZXhpc3RpbmdTdG9yZT8udGVuYW50LFxuICAgICAgdGVzdFByb2ZpbGVDb250ZXh0OiBleGlzdGluZ1N0b3JlPy50ZXN0UHJvZmlsZUNvbnRleHQsXG4gICAgICB0aW1lWm9uZTogdmFsaWRhdGVUaW1lWm9uZSh0aW1lWm9uZSwgXCJ0aW1lWm9uZVwiKVxuICAgIH0sIGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHRpbWV6b25lIG9mZnNldC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IG9mZnNldE1pbnV0ZXMgLSBPZmZzZXQgaW4gbWludXRlcyAoRGF0ZSNnZXRUaW1lem9uZU9mZnNldCkuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldFRpbWV6b25lT2Zmc2V0KG9mZnNldE1pbnV0ZXMpIHtcbiAgICBpZiAoIXRoaXMuX3RpbWV6b25lQXN5bmNMb2NhbFN0b3JhZ2UpIHJldHVyblxuXG4gICAgY29uc3Qgc3RvcmUgPSB0aGlzLl90aW1lem9uZUFzeW5jTG9jYWxTdG9yYWdlLmdldFN0b3JlKClcblxuICAgIGlmIChzdG9yZSkge1xuICAgICAgc3RvcmUub2Zmc2V0TWludXRlcyA9IG9mZnNldE1pbnV0ZXNcbiAgICB9IGVsc2Uge1xuICAgICAgY29uc3QgZXhpc3RpbmdTdG9yZSA9IHRoaXMuX3RpbWV6b25lQXN5bmNMb2NhbFN0b3JhZ2UuZ2V0U3RvcmUoKVxuXG4gICAgICB0aGlzLl90aW1lem9uZUFzeW5jTG9jYWxTdG9yYWdlLmVudGVyV2l0aCh7XG4gICAgICAgIGFiaWxpdHk6IGV4aXN0aW5nU3RvcmU/LmFiaWxpdHksXG4gICAgICAgIG9mZnNldE1pbnV0ZXMsXG4gICAgICAgIHJlcXVlc3RUaW1pbmc6IGV4aXN0aW5nU3RvcmU/LnJlcXVlc3RUaW1pbmcsXG4gICAgICAgIHRlbmFudDogZXhpc3RpbmdTdG9yZT8udGVuYW50LFxuICAgICAgICB0ZXN0UHJvZmlsZUNvbnRleHQ6IGV4aXN0aW5nU3RvcmU/LnRlc3RQcm9maWxlQ29udGV4dCxcbiAgICAgICAgdGltZVpvbmU6IGV4aXN0aW5nU3RvcmU/LnRpbWVab25lID8/IHRoaXMuZ2V0VGltZVpvbmUodGhpcy5nZXRDb25maWd1cmF0aW9uKCkpXG4gICAgICB9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCB0aW1lem9uZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRpbWVab25lIC0gSUFOQSB0aW1lem9uZSBpZGVudGlmaWVyLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRUaW1lem9uZSh0aW1lWm9uZSkge1xuICAgIGlmICghdGhpcy5fdGltZXpvbmVBc3luY0xvY2FsU3RvcmFnZSkge1xuICAgICAgc3VwZXIuc2V0VGltZXpvbmUodGltZVpvbmUpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBub3JtYWxpemVkVGltZVpvbmUgPSB2YWxpZGF0ZVRpbWVab25lKHRpbWVab25lLCBcInRpbWVab25lXCIpXG4gICAgY29uc3Qgc3RvcmUgPSB0aGlzLl90aW1lem9uZUFzeW5jTG9jYWxTdG9yYWdlLmdldFN0b3JlKClcblxuICAgIGlmIChzdG9yZSkge1xuICAgICAgc3RvcmUudGltZVpvbmUgPSBub3JtYWxpemVkVGltZVpvbmVcbiAgICB9IGVsc2Uge1xuICAgICAgY29uc3QgZXhpc3RpbmdTdG9yZSA9IHRoaXMuX3RpbWV6b25lQXN5bmNMb2NhbFN0b3JhZ2UuZ2V0U3RvcmUoKVxuXG4gICAgICB0aGlzLl90aW1lem9uZUFzeW5jTG9jYWxTdG9yYWdlLmVudGVyV2l0aCh7XG4gICAgICAgIGFiaWxpdHk6IGV4aXN0aW5nU3RvcmU/LmFiaWxpdHksXG4gICAgICAgIG9mZnNldE1pbnV0ZXM6IGV4aXN0aW5nU3RvcmU/Lm9mZnNldE1pbnV0ZXMgPz8gdGhpcy5nZXRUaW1lem9uZU9mZnNldE1pbnV0ZXModGhpcy5nZXRDb25maWd1cmF0aW9uKCkpLFxuICAgICAgICByZXF1ZXN0VGltaW5nOiBleGlzdGluZ1N0b3JlPy5yZXF1ZXN0VGltaW5nLFxuICAgICAgICB0ZW5hbnQ6IGV4aXN0aW5nU3RvcmU/LnRlbmFudCxcbiAgICAgICAgdGVzdFByb2ZpbGVDb250ZXh0OiBleGlzdGluZ1N0b3JlPy50ZXN0UHJvZmlsZUNvbnRleHQsXG4gICAgICAgIHRpbWVab25lOiBub3JtYWxpemVkVGltZVpvbmVcbiAgICAgIH0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRpbWV6b25lIG9mZnNldCBtaW51dGVzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gT2Zmc2V0IGluIG1pbnV0ZXMuXG4gICAqL1xuICBnZXRUaW1lem9uZU9mZnNldE1pbnV0ZXMoY29uZmlndXJhdGlvbikge1xuICAgIGlmICh0aGlzLl90aW1lem9uZUFzeW5jTG9jYWxTdG9yYWdlKSB7XG4gICAgICBjb25zdCBzdG9yZSA9IHRoaXMuX3RpbWV6b25lQXN5bmNMb2NhbFN0b3JhZ2UuZ2V0U3RvcmUoKVxuXG4gICAgICBpZiAoc3RvcmUgJiYgdHlwZW9mIHN0b3JlLm9mZnNldE1pbnV0ZXMgPT09IFwibnVtYmVyXCIpIHtcbiAgICAgICAgcmV0dXJuIHN0b3JlLm9mZnNldE1pbnV0ZXNcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gc3VwZXIuZ2V0VGltZXpvbmVPZmZzZXRNaW51dGVzKGNvbmZpZ3VyYXRpb24pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdGltZXpvbmUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSBjb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBUaW1lem9uZSBpZGVudGlmaWVyLlxuICAgKi9cbiAgZ2V0VGltZVpvbmUoY29uZmlndXJhdGlvbikge1xuICAgIGlmICh0aGlzLl90aW1lem9uZUFzeW5jTG9jYWxTdG9yYWdlKSB7XG4gICAgICBjb25zdCBzdG9yZSA9IHRoaXMuX3RpbWV6b25lQXN5bmNMb2NhbFN0b3JhZ2UuZ2V0U3RvcmUoKVxuXG4gICAgICBpZiAoc3RvcmUgJiYgdHlwZW9mIHN0b3JlLnRpbWVab25lID09PSBcInN0cmluZ1wiKSB7XG4gICAgICAgIHJldHVybiBzdG9yZS50aW1lWm9uZVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBzdXBlci5nZXRUaW1lWm9uZShjb25maWd1cmF0aW9uKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcnVuIHdpdGggYWJpbGl0eS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9hdXRob3JpemF0aW9uL2FiaWxpdHkuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gYWJpbGl0eSAtIEFiaWxpdHkgdG8gc2V0IGZvciBjYWxsYmFjayBzY29wZS5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY2FsbGJhY2sgLSBDYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHJ1bldpdGhBYmlsaXR5KGFiaWxpdHksIGNhbGxiYWNrKSB7XG4gICAgaWYgKCF0aGlzLl90aW1lem9uZUFzeW5jTG9jYWxTdG9yYWdlKSB7XG4gICAgICByZXR1cm4gYXdhaXQgc3VwZXIucnVuV2l0aEFiaWxpdHkoYWJpbGl0eSwgY2FsbGJhY2spXG4gICAgfVxuXG4gICAgY29uc3QgZXhpc3RpbmdTdG9yZSA9IHRoaXMuX3RpbWV6b25lQXN5bmNMb2NhbFN0b3JhZ2UuZ2V0U3RvcmUoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3RpbWV6b25lQXN5bmNMb2NhbFN0b3JhZ2UucnVuKHtcbiAgICAgIGFiaWxpdHksXG4gICAgICBvZmZzZXRNaW51dGVzOiBleGlzdGluZ1N0b3JlPy5vZmZzZXRNaW51dGVzID8/IHRoaXMuZ2V0VGltZXpvbmVPZmZzZXRNaW51dGVzKHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpKSxcbiAgICAgIHJlcXVlc3RUaW1pbmc6IGV4aXN0aW5nU3RvcmU/LnJlcXVlc3RUaW1pbmcsXG4gICAgICB0ZW5hbnQ6IGV4aXN0aW5nU3RvcmU/LnRlbmFudCxcbiAgICAgIHRlc3RQcm9maWxlQ29udGV4dDogZXhpc3RpbmdTdG9yZT8udGVzdFByb2ZpbGVDb250ZXh0LFxuICAgICAgdGltZVpvbmU6IGV4aXN0aW5nU3RvcmU/LnRpbWVab25lID8/IHRoaXMuZ2V0VGltZVpvbmUodGhpcy5nZXRDb25maWd1cmF0aW9uKCkpXG4gICAgfSwgY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgY3VycmVudCBhYmlsaXR5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSBhYmlsaXR5IC0gQWJpbGl0eSB0byBzZXQuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldEN1cnJlbnRBYmlsaXR5KGFiaWxpdHkpIHtcbiAgICBpZiAoIXRoaXMuX3RpbWV6b25lQXN5bmNMb2NhbFN0b3JhZ2UpIHtcbiAgICAgIHN1cGVyLnNldEN1cnJlbnRBYmlsaXR5KGFiaWxpdHkpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBleGlzdGluZ1N0b3JlID0gdGhpcy5fdGltZXpvbmVBc3luY0xvY2FsU3RvcmFnZS5nZXRTdG9yZSgpXG5cbiAgICBpZiAoZXhpc3RpbmdTdG9yZSkge1xuICAgICAgZXhpc3RpbmdTdG9yZS5hYmlsaXR5ID0gYWJpbGl0eVxuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLl90aW1lem9uZUFzeW5jTG9jYWxTdG9yYWdlLmVudGVyV2l0aCh7XG4gICAgICAgIGFiaWxpdHksXG4gICAgICAgIG9mZnNldE1pbnV0ZXM6IHRoaXMuZ2V0VGltZXpvbmVPZmZzZXRNaW51dGVzKHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpKSxcbiAgICAgICAgcmVxdWVzdFRpbWluZzogdW5kZWZpbmVkLFxuICAgICAgICB0ZW5hbnQ6IHVuZGVmaW5lZCxcbiAgICAgICAgdGVzdFByb2ZpbGVDb250ZXh0OiB1bmRlZmluZWQsXG4gICAgICAgIHRpbWVab25lOiB0aGlzLmdldFRpbWVab25lKHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpKVxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgY3VycmVudCBhYmlsaXR5LlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IC0gQ3VycmVudCBhYmlsaXR5LlxuICAgKi9cbiAgZ2V0Q3VycmVudEFiaWxpdHkoKSB7XG4gICAgaWYgKCF0aGlzLl90aW1lem9uZUFzeW5jTG9jYWxTdG9yYWdlKSB7XG4gICAgICByZXR1cm4gc3VwZXIuZ2V0Q3VycmVudEFiaWxpdHkoKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl90aW1lem9uZUFzeW5jTG9jYWxTdG9yYWdlLmdldFN0b3JlKCk/LmFiaWxpdHlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1biB3aXRoIHJlcXVlc3QgdGltaW5nLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2h0dHAtc2VydmVyL2NsaWVudC9yZXF1ZXN0LXRpbWluZy5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSByZXF1ZXN0VGltaW5nIC0gUmVxdWVzdCB0aW1pbmcgY29sbGVjdG9yLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjYWxsYmFjayAtIENhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgcnVuV2l0aFJlcXVlc3RUaW1pbmcocmVxdWVzdFRpbWluZywgY2FsbGJhY2spIHtcbiAgICBpZiAoIXRoaXMuX3RpbWV6b25lQXN5bmNMb2NhbFN0b3JhZ2UpIHtcbiAgICAgIHJldHVybiBhd2FpdCBzdXBlci5ydW5XaXRoUmVxdWVzdFRpbWluZyhyZXF1ZXN0VGltaW5nLCBjYWxsYmFjaylcbiAgICB9XG5cbiAgICBjb25zdCBleGlzdGluZ1N0b3JlID0gdGhpcy5fdGltZXpvbmVBc3luY0xvY2FsU3RvcmFnZS5nZXRTdG9yZSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fdGltZXpvbmVBc3luY0xvY2FsU3RvcmFnZS5ydW4oe1xuICAgICAgYWJpbGl0eTogZXhpc3RpbmdTdG9yZT8uYWJpbGl0eSxcbiAgICAgIG9mZnNldE1pbnV0ZXM6IGV4aXN0aW5nU3RvcmU/Lm9mZnNldE1pbnV0ZXMgPz8gdGhpcy5nZXRUaW1lem9uZU9mZnNldE1pbnV0ZXModGhpcy5nZXRDb25maWd1cmF0aW9uKCkpLFxuICAgICAgcmVxdWVzdFRpbWluZyxcbiAgICAgIHRlbmFudDogZXhpc3RpbmdTdG9yZT8udGVuYW50LFxuICAgICAgdGVzdFByb2ZpbGVDb250ZXh0OiBleGlzdGluZ1N0b3JlPy50ZXN0UHJvZmlsZUNvbnRleHQsXG4gICAgICB0aW1lWm9uZTogZXhpc3RpbmdTdG9yZT8udGltZVpvbmUgPz8gdGhpcy5nZXRUaW1lWm9uZSh0aGlzLmdldENvbmZpZ3VyYXRpb24oKSlcbiAgICB9LCBjYWxsYmFjaylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBjdXJyZW50IHJlcXVlc3QgdGltaW5nLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3JlcXVlc3QtdGltaW5nLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IC0gQ3VycmVudCByZXF1ZXN0IHRpbWluZyBjb2xsZWN0b3IuXG4gICAqL1xuICBnZXRDdXJyZW50UmVxdWVzdFRpbWluZygpIHtcbiAgICBpZiAoIXRoaXMuX3RpbWV6b25lQXN5bmNMb2NhbFN0b3JhZ2UpIHtcbiAgICAgIHJldHVybiBzdXBlci5nZXRDdXJyZW50UmVxdWVzdFRpbWluZygpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX3RpbWV6b25lQXN5bmNMb2NhbFN0b3JhZ2UuZ2V0U3RvcmUoKT8ucmVxdWVzdFRpbWluZ1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcnVuIHdpdGggdGVuYW50LlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB0ZW5hbnQgLSBUZW5hbnQgdG8gc2V0IGZvciBjYWxsYmFjayBzY29wZS5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY2FsbGJhY2sgLSBDYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHJ1bldpdGhUZW5hbnQodGVuYW50LCBjYWxsYmFjaykge1xuICAgIGlmICghdGhpcy5fdGltZXpvbmVBc3luY0xvY2FsU3RvcmFnZSkge1xuICAgICAgcmV0dXJuIGF3YWl0IHN1cGVyLnJ1bldpdGhUZW5hbnQodGVuYW50LCBjYWxsYmFjaylcbiAgICB9XG5cbiAgICBjb25zdCBleGlzdGluZ1N0b3JlID0gdGhpcy5fdGltZXpvbmVBc3luY0xvY2FsU3RvcmFnZS5nZXRTdG9yZSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fdGltZXpvbmVBc3luY0xvY2FsU3RvcmFnZS5ydW4oe1xuICAgICAgYWJpbGl0eTogZXhpc3RpbmdTdG9yZT8uYWJpbGl0eSxcbiAgICAgIG9mZnNldE1pbnV0ZXM6IGV4aXN0aW5nU3RvcmU/Lm9mZnNldE1pbnV0ZXMgPz8gdGhpcy5nZXRUaW1lem9uZU9mZnNldE1pbnV0ZXModGhpcy5nZXRDb25maWd1cmF0aW9uKCkpLFxuICAgICAgcmVxdWVzdFRpbWluZzogZXhpc3RpbmdTdG9yZT8ucmVxdWVzdFRpbWluZyxcbiAgICAgIHRlbmFudCxcbiAgICAgIHRlc3RQcm9maWxlQ29udGV4dDogZXhpc3RpbmdTdG9yZT8udGVzdFByb2ZpbGVDb250ZXh0LFxuICAgICAgdGltZVpvbmU6IGV4aXN0aW5nU3RvcmU/LnRpbWVab25lID8/IHRoaXMuZ2V0VGltZVpvbmUodGhpcy5nZXRDb25maWd1cmF0aW9uKCkpXG4gICAgfSwgY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgY3VycmVudCB0ZW5hbnQuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHRlbmFudCAtIFRlbmFudCB0byBzZXQuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldEN1cnJlbnRUZW5hbnQodGVuYW50KSB7XG4gICAgaWYgKCF0aGlzLl90aW1lem9uZUFzeW5jTG9jYWxTdG9yYWdlKSB7XG4gICAgICBzdXBlci5zZXRDdXJyZW50VGVuYW50KHRlbmFudClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IGV4aXN0aW5nU3RvcmUgPSB0aGlzLl90aW1lem9uZUFzeW5jTG9jYWxTdG9yYWdlLmdldFN0b3JlKClcblxuICAgIGlmIChleGlzdGluZ1N0b3JlKSB7XG4gICAgICBleGlzdGluZ1N0b3JlLnRlbmFudCA9IHRlbmFudFxuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLl90aW1lem9uZUFzeW5jTG9jYWxTdG9yYWdlLmVudGVyV2l0aCh7XG4gICAgICAgIGFiaWxpdHk6IHVuZGVmaW5lZCxcbiAgICAgICAgb2Zmc2V0TWludXRlczogdGhpcy5nZXRUaW1lem9uZU9mZnNldE1pbnV0ZXModGhpcy5nZXRDb25maWd1cmF0aW9uKCkpLFxuICAgICAgICByZXF1ZXN0VGltaW5nOiB1bmRlZmluZWQsXG4gICAgICAgIHRlbmFudCxcbiAgICAgICAgdGVzdFByb2ZpbGVDb250ZXh0OiB1bmRlZmluZWQsXG4gICAgICAgIHRpbWVab25lOiB0aGlzLmdldFRpbWVab25lKHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpKVxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgY3VycmVudCB0ZW5hbnQuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBDdXJyZW50IHRlbmFudC5cbiAgICovXG4gIGdldEN1cnJlbnRUZW5hbnQoKSB7XG4gICAgaWYgKCF0aGlzLl90aW1lem9uZUFzeW5jTG9jYWxTdG9yYWdlKSB7XG4gICAgICByZXR1cm4gc3VwZXIuZ2V0Q3VycmVudFRlbmFudCgpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX3RpbWV6b25lQXN5bmNMb2NhbFN0b3JhZ2UuZ2V0U3RvcmUoKT8udGVuYW50XG4gIH1cblxuICAvKipcbiAgICogUnVucyBhY3R1YWwgZmluZCBjb21tYW5kcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8QXJyYXk8aW1wb3J0KFwiLi9iYXNlLmpzXCIpLkNvbW1hbmRGaWxlT2JqZWN0VHlwZT4+fSAtIFJlc29sdmVzIHdpdGggZGlzY292ZXJlZCBjb21tYW5kIGZpbGVzLlxuICAgKi9cbiAgYXN5bmMgX2FjdHVhbEZpbmRDb21tYW5kcygpIHtcbiAgICBjb25zdCBiYXNlUGF0aCA9IGF3YWl0IHRoaXMuZ2V0QmFzZVBhdGgoKVxuICAgIGNvbnN0IGNvbW1hbmRGaWxlcyA9IGZzLmdsb2IoYCR7YmFzZVBhdGh9L3NyYy9jbGkvY29tbWFuZHMvKiovKi5qc2ApXG4gICAgY29uc3QgY29tbWFuZHMgPSBbXVxuXG4gICAgZm9yIGF3YWl0IChjb25zdCBhRmlsZVBhdGggb2YgY29tbWFuZEZpbGVzKSB7XG4gICAgICBjb25zdCBjb21tYW5kTmFtZSA9IHRoaXMuY29tbWFuZE5hbWVGcm9tRmlsZVBhdGgoYUZpbGVQYXRoKVxuXG4gICAgICBjb21tYW5kcy5wdXNoKHtuYW1lOiBjb21tYW5kTmFtZSwgZmlsZTogYUZpbGVQYXRofSlcbiAgICB9XG5cbiAgICByZXR1cm4gY29tbWFuZHNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbW1hbmQgbmFtZSBmcm9tIGZpbGUgcGF0aC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGZpbGVQYXRoIC0gRnVsbCBjb21tYW5kIGZpbGUgcGF0aC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBQYXJzZWQgY29tbWFuZCBuYW1lLlxuICAgKi9cbiAgY29tbWFuZE5hbWVGcm9tRmlsZVBhdGgoZmlsZVBhdGgpIHtcbiAgICBjb25zdCBhRmlsZVBhdGhQYXJ0cyA9IGZpbGVQYXRoLnNwbGl0KC9bXFxcXC9dLylcbiAgICBjb25zdCBjb21tYW5kUGF0aExvY2F0aW9uID0gYUZpbGVQYXRoUGFydHMuaW5kZXhPZihcImNvbW1hbmRzXCIpXG5cbiAgICBpZiAoY29tbWFuZFBhdGhMb2NhdGlvbiA9PT0gLTEpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQ291bGQgbm90IHBhcnNlIGNvbW1hbmQgZmlsZSBwYXRoOiAke2ZpbGVQYXRofWApXG4gICAgfVxuXG4gICAgY29uc3QgY29tbWFuZFBhcnRzID0gYUZpbGVQYXRoUGFydHMuc2xpY2UoY29tbWFuZFBhdGhMb2NhdGlvbiArIDEpXG4gICAgY29uc3QgbGFzdFBhcnQgPSBjb21tYW5kUGFydHNbY29tbWFuZFBhcnRzLmxlbmd0aCAtIDFdXG4gICAgbGV0IG5hbWUsIHBhdGhzXG5cbiAgICBpZiAobGFzdFBhcnQgPT0gXCJpbmRleC5qc1wiKSB7XG4gICAgICBuYW1lID0gY29tbWFuZFBhcnRzW2NvbW1hbmRQYXJ0cy5sZW5ndGggLSAyXVxuICAgICAgcGF0aHMgPSBjb21tYW5kUGFydHMuc2xpY2UoMCwgLTIpXG4gICAgfSBlbHNlIHtcbiAgICAgIG5hbWUgPSBsYXN0UGFydC5yZXBsYWNlKFwiLmpzXCIsIFwiXCIpXG4gICAgICBwYXRocyA9IGNvbW1hbmRQYXJ0cy5zbGljZSgwLCAtMSlcbiAgICB9XG5cbiAgICByZXR1cm4gYCR7cGF0aHMuam9pbihcIjpcIil9JHtwYXRocy5sZW5ndGggPiAwID8gXCI6XCIgOiBcIlwifSR7bmFtZX1gXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGkgY29tbWFuZHMgaW5pdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jbGkvYmFzZS1jb21tYW5kLmpzXCIpLmRlZmF1bHR9IGNvbW1hbmQgLSBDb21tYW5kLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY29tbWFuZCByZXN1bHQuXG4gICAqL1xuICBhc3luYyBjbGlDb21tYW5kc0luaXQoY29tbWFuZCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmZvcndhcmRDb21tYW5kKGNvbW1hbmQsIENsaUNvbW1hbmRzSW5pdClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsaSBjb21tYW5kcyBtaWdyYXRpb24gZ2VuZXJhdGUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiKS5kZWZhdWx0fSBjb21tYW5kIC0gQ29tbWFuZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNvbW1hbmQgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgY2xpQ29tbWFuZHNNaWdyYXRpb25HZW5lcmF0ZShjb21tYW5kKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZm9yd2FyZENvbW1hbmQoY29tbWFuZCwgQ2xpQ29tbWFuZHNHZW5lcmF0ZU1pZ3JhdGlvbilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsaSBjb21tYW5kcyBtaWdyYXRpb24gZGVzdHJveS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jbGkvYmFzZS1jb21tYW5kLmpzXCIpLmRlZmF1bHR9IGNvbW1hbmQgLSBDb21tYW5kLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY29tbWFuZCByZXN1bHQuXG4gICAqL1xuICBhc3luYyBjbGlDb21tYW5kc01pZ3JhdGlvbkRlc3Ryb3koY29tbWFuZCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmZvcndhcmRDb21tYW5kKGNvbW1hbmQsIENsaUNvbW1hbmRzRGVzdHJveU1pZ3JhdGlvbilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsaSBjb21tYW5kcyBnZW5lcmF0ZSBiYXNlIG1vZGVscy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jbGkvYmFzZS1jb21tYW5kLmpzXCIpLmRlZmF1bHR9IGNvbW1hbmQgLSBDb21tYW5kLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY29tbWFuZCByZXN1bHQuXG4gICAqL1xuICBhc3luYyBjbGlDb21tYW5kc0dlbmVyYXRlQmFzZU1vZGVscyhjb21tYW5kKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZm9yd2FyZENvbW1hbmQoY29tbWFuZCwgQ2xpQ29tbWFuZHNHZW5lcmF0ZUJhc2VNb2RlbHMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGkgY29tbWFuZHMgZ2VuZXJhdGUgZnJvbnRlbmQgbW9kZWxzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NsaS9iYXNlLWNvbW1hbmQuanNcIikuZGVmYXVsdH0gY29tbWFuZCAtIENvbW1hbmQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjb21tYW5kIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGNsaUNvbW1hbmRzR2VuZXJhdGVGcm9udGVuZE1vZGVscyhjb21tYW5kKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZm9yd2FyZENvbW1hbmQoY29tbWFuZCwgQ2xpQ29tbWFuZHNHZW5lcmF0ZUZyb250ZW5kTW9kZWxzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xpIGNvbW1hbmRzIGdlbmVyYXRlIG1vZGVsLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NsaS9iYXNlLWNvbW1hbmQuanNcIikuZGVmYXVsdH0gY29tbWFuZCAtIENvbW1hbmQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjb21tYW5kIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGNsaUNvbW1hbmRzR2VuZXJhdGVNb2RlbChjb21tYW5kKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZm9yd2FyZENvbW1hbmQoY29tbWFuZCwgQ2xpQ29tbWFuZHNHZW5lcmF0ZU1vZGVsKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xpIGNvbW1hbmRzIGxpbnQgcmVsYXRpb25zaGlwcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jbGkvYmFzZS1jb21tYW5kLmpzXCIpLmRlZmF1bHR9IGNvbW1hbmQgLSBDb21tYW5kLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY29tbWFuZCByZXN1bHQuXG4gICAqL1xuICBhc3luYyBjbGlDb21tYW5kc0xpbnRSZWxhdGlvbnNoaXBzKGNvbW1hbmQpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5mb3J3YXJkQ29tbWFuZChjb21tYW5kLCBDbGlDb21tYW5kc0xpbnRSZWxhdGlvbnNoaXBzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xpIGNvbW1hbmRzIHJvdXRlcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jbGkvYmFzZS1jb21tYW5kLmpzXCIpLmRlZmF1bHR9IGNvbW1hbmQgLSBDb21tYW5kLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY29tbWFuZCByZXN1bHQuXG4gICAqL1xuICBhc3luYyBjbGlDb21tYW5kc1JvdXRlcyhjb21tYW5kKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZm9yd2FyZENvbW1hbmQoY29tbWFuZCwgQ2xpQ29tbWFuZHNSb3V0ZXMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGkgY29tbWFuZHMgY29uc29sZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jbGkvYmFzZS1jb21tYW5kLmpzXCIpLmRlZmF1bHR9IGNvbW1hbmQgLSBDb21tYW5kLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY29tbWFuZCByZXN1bHQuXG4gICAqL1xuICBhc3luYyBjbGlDb21tYW5kc0NvbnNvbGUoY29tbWFuZCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmZvcndhcmRDb21tYW5kKGNvbW1hbmQsIENsaUNvbW1hbmRzQ29uc29sZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsaSBjb21tYW5kcyBzZXJ2ZXIuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiKS5kZWZhdWx0fSBjb21tYW5kIC0gQ29tbWFuZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNvbW1hbmQgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgY2xpQ29tbWFuZHNTZXJ2ZXIoY29tbWFuZCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmZvcndhcmRDb21tYW5kKGNvbW1hbmQsIENsaUNvbW1hbmRzU2VydmVyKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xpIGNvbW1hbmRzIG1jcC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jbGkvYmFzZS1jb21tYW5kLmpzXCIpLmRlZmF1bHR9IGNvbW1hbmQgLSBDb21tYW5kLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBjb21tYW5kIGNvbXBsZXRlcy5cbiAgICovXG4gIGFzeW5jIGNsaUNvbW1hbmRzTWNwKGNvbW1hbmQpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5mb3J3YXJkQ29tbWFuZChjb21tYW5kLCBDbGlDb21tYW5kc01jcClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsaSBjb21tYW5kcyB0ZXN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NsaS9iYXNlLWNvbW1hbmQuanNcIikuZGVmYXVsdH0gY29tbWFuZCAtIENvbW1hbmQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjb21tYW5kIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGNsaUNvbW1hbmRzVGVzdChjb21tYW5kKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZm9yd2FyZENvbW1hbmQoY29tbWFuZCwgQ2xpQ29tbWFuZHNUZXN0KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xpIGNvbW1hbmRzIHRlc3QgdGltaW5nIG1hbmlmZXN0IG1lcmdlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NsaS9iYXNlLWNvbW1hbmQuanNcIikuZGVmYXVsdH0gY29tbWFuZCAtIENvbW1hbmQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjb21tYW5kIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGNsaUNvbW1hbmRzVGVzdFRpbWluZ01hbmlmZXN0TWVyZ2UoY29tbWFuZCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmZvcndhcmRDb21tYW5kKGNvbW1hbmQsIENsaUNvbW1hbmRzVGVzdFRpbWluZ01hbmlmZXN0TWVyZ2UpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGkgY29tbWFuZHMgYmFja2dyb3VuZCBqb2JzIG1haW4uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiKS5kZWZhdWx0fSBjb21tYW5kIC0gQ29tbWFuZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNvbW1hbmQgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgY2xpQ29tbWFuZHNCYWNrZ3JvdW5kSm9ic01haW4oY29tbWFuZCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmZvcndhcmRDb21tYW5kKGNvbW1hbmQsIENsaUNvbW1hbmRzQmFja2dyb3VuZEpvYnNNYWluKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgQ0xJIGJhY2tncm91bmQtam9icyBhY3RpdmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NsaS9iYXNlLWNvbW1hbmQuanNcIikuZGVmYXVsdH0gY29tbWFuZCAtIENvbW1hbmQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXN1bHQuXG4gICAqL1xuICBhc3luYyBjbGlDb21tYW5kc0JhY2tncm91bmRKb2JzQWN0aXZhdGUoY29tbWFuZCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmZvcndhcmRDb21tYW5kKGNvbW1hbmQsIENsaUNvbW1hbmRzQmFja2dyb3VuZEpvYnNBY3RpdmF0ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIENMSSBiYWNrZ3JvdW5kLWpvYnMgcmV0aXJlbWVudC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jbGkvYmFzZS1jb21tYW5kLmpzXCIpLmRlZmF1bHR9IGNvbW1hbmQgLSBDb21tYW5kLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgY2xpQ29tbWFuZHNCYWNrZ3JvdW5kSm9ic1JldGlyZShjb21tYW5kKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZm9yd2FyZENvbW1hbmQoY29tbWFuZCwgQ2xpQ29tbWFuZHNCYWNrZ3JvdW5kSm9ic1JldGlyZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsaSBjb21tYW5kcyBiYWNrZ3JvdW5kIGpvYnMgd29ya2VyLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NsaS9iYXNlLWNvbW1hbmQuanNcIikuZGVmYXVsdH0gY29tbWFuZCAtIENvbW1hbmQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjb21tYW5kIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGNsaUNvbW1hbmRzQmFja2dyb3VuZEpvYnNXb3JrZXIoY29tbWFuZCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmZvcndhcmRDb21tYW5kKGNvbW1hbmQsIENsaUNvbW1hbmRzQmFja2dyb3VuZEpvYnNXb3JrZXIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGkgY29tbWFuZHMgYmFja2dyb3VuZCBqb2JzIHJ1bm5lci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jbGkvYmFzZS1jb21tYW5kLmpzXCIpLmRlZmF1bHR9IGNvbW1hbmQgLSBDb21tYW5kLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY29tbWFuZCByZXN1bHQuXG4gICAqL1xuICBhc3luYyBjbGlDb21tYW5kc0JhY2tncm91bmRKb2JzUnVubmVyKGNvbW1hbmQpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5mb3J3YXJkQ29tbWFuZChjb21tYW5kLCBDbGlDb21tYW5kc0JhY2tncm91bmRKb2JzUnVubmVyKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xpIGNvbW1hbmRzIGJlYWNvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jbGkvYmFzZS1jb21tYW5kLmpzXCIpLmRlZmF1bHR9IGNvbW1hbmQgLSBDb21tYW5kLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY29tbWFuZCByZXN1bHQuXG4gICAqL1xuICBhc3luYyBjbGlDb21tYW5kc0JlYWNvbihjb21tYW5kKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZm9yd2FyZENvbW1hbmQoY29tbWFuZCwgQ2xpQ29tbWFuZHNCZWFjb24pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBsb2FkIGJlYWNvbiBjbGllbnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHR5cGVvZiBpbXBvcnQoXCIuLi9iZWFjb24vY2xpZW50LmpzXCIpLmRlZmF1bHQ+fSAtIEJlYWNvbiBjbGllbnQgY2xhc3MuXG4gICAqL1xuICBhc3luYyBsb2FkQmVhY29uQ2xpZW50KCkge1xuICAgIGNvbnN0IHtkZWZhdWx0OiBCZWFjb25DbGllbnR9ID0gYXdhaXQgaW1wb3J0KFwiLi4vYmVhY29uL2NsaWVudC5qc1wiKVxuXG4gICAgcmV0dXJuIEJlYWNvbkNsaWVudFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbG9hZCBpbiBwcm9jZXNzIGJlYWNvbiBjbGllbnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHR5cGVvZiBpbXBvcnQoXCIuLi9iZWFjb24vaW4tcHJvY2Vzcy1jbGllbnQuanNcIikuZGVmYXVsdD59IC0gSW4tcHJvY2VzcyBjbGllbnQgY2xhc3MuXG4gICAqL1xuICBhc3luYyBsb2FkSW5Qcm9jZXNzQmVhY29uQ2xpZW50KCkge1xuICAgIGNvbnN0IHtkZWZhdWx0OiBJblByb2Nlc3NCZWFjb25DbGllbnR9ID0gYXdhaXQgaW1wb3J0KFwiLi4vYmVhY29uL2luLXByb2Nlc3MtY2xpZW50LmpzXCIpXG5cbiAgICByZXR1cm4gSW5Qcm9jZXNzQmVhY29uQ2xpZW50XG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGkgY29tbWFuZHMgZGIgc2NoZW1hIGR1bXAuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiKS5kZWZhdWx0fSBjb21tYW5kIC0gQ29tbWFuZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNvbW1hbmQgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgY2xpQ29tbWFuZHNEYlNjaGVtYUR1bXAoY29tbWFuZCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmZvcndhcmRDb21tYW5kKGNvbW1hbmQsIENsaUNvbW1hbmRzRGJTY2hlbWFEdW1wKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xpIGNvbW1hbmRzIGRiIHNjaGVtYSBsb2FkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NsaS9iYXNlLWNvbW1hbmQuanNcIikuZGVmYXVsdH0gY29tbWFuZCAtIENvbW1hbmQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjb21tYW5kIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGNsaUNvbW1hbmRzRGJTY2hlbWFMb2FkKGNvbW1hbmQpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5mb3J3YXJkQ29tbWFuZChjb21tYW5kLCBDbGlDb21tYW5kc0RiU2NoZW1hTG9hZClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsaSBjb21tYW5kcyBkYiBzZWVkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NsaS9iYXNlLWNvbW1hbmQuanNcIikuZGVmYXVsdH0gY29tbWFuZCAtIENvbW1hbmQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjb21tYW5kIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGNsaUNvbW1hbmRzRGJTZWVkKGNvbW1hbmQpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5mb3J3YXJkQ29tbWFuZChjb21tYW5kLCBDbGlDb21tYW5kc0RiU2VlZClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsaSBjb21tYW5kcyBydW5uZXIuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiKS5kZWZhdWx0fSBjb21tYW5kIC0gQ29tbWFuZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNvbW1hbmQgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgY2xpQ29tbWFuZHNSdW5uZXIoY29tbWFuZCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmZvcndhcmRDb21tYW5kKGNvbW1hbmQsIENsaUNvbW1hbmRzUnVubmVyKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xpIGNvbW1hbmRzIHJ1biBzY3JpcHQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiKS5kZWZhdWx0fSBjb21tYW5kIC0gQ29tbWFuZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNvbW1hbmQgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgY2xpQ29tbWFuZHNSdW5TY3JpcHQoY29tbWFuZCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmZvcndhcmRDb21tYW5kKGNvbW1hbmQsIENsaUNvbW1hbmRzUnVuU2NyaXB0KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVxdWlyZSBjb21tYW5kLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBhcmdzLmNvbW1hbmRQYXJ0cyAtIENvbW1hbmQgcGFydHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHR5cGVvZiBpbXBvcnQgKFwiLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiKS5kZWZhdWx0Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSByZXF1aXJlIGNvbW1hbmQuXG4gICAqL1xuICBhc3luYyByZXF1aXJlQ29tbWFuZCh7Y29tbWFuZFBhcnRzfSkge1xuICAgIGNvbnN0IGNvbW1hbmRzID0gYXdhaXQgdGhpcy5maW5kQ29tbWFuZHMoKVxuICAgIGNvbnN0IGNvbW1hbmROYW1lID0gY29tbWFuZFBhcnRzLmpvaW4oXCI6XCIpXG4gICAgY29uc3QgY29tbWFuZCA9IGNvbW1hbmRzLmZpbmQoKGFDb21tYW5kKSA9PiBhQ29tbWFuZC5uYW1lID09PSBjb21tYW5kTmFtZSlcblxuICAgIGlmICghY29tbWFuZCkge1xuICAgICAgY29uc3QgcG9zc2libGVDb21tYW5kcyA9IGNvbW1hbmRzLm1hcChhQ29tbWFuZCA9PiBhQ29tbWFuZC5uYW1lKVxuXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gY29tbWFuZDogJHtjb21tYW5kUGFydHMuam9pbihcIjpcIil9IHdoaWNoIHNob3VsZCBoYXZlIGJlZW4gb25lIG9mOiAke3Bvc3NpYmxlQ29tbWFuZHMuc29ydCgpLmpvaW4oXCIsIFwiKX1gKVxuICAgIH1cblxuICAgIGNvbnN0IGNvbW1hbmRDbGFzc0ltcG9ydCA9IGF3YWl0IGltcG9ydCh0b0ltcG9ydFNwZWNpZmllcihjb21tYW5kLmZpbGUpKVxuICAgIGNvbnN0IENvbW1hbmRDbGFzcyA9IGNvbW1hbmRDbGFzc0ltcG9ydC5kZWZhdWx0XG5cbiAgICByZXR1cm4gQ29tbWFuZENsYXNzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5kIG1pZ3JhdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5PGltcG9ydChcIi4vYmFzZS5qc1wiKS5NaWdyYXRpb25PYmplY3RUeXBlPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgbWlncmF0aW9ucy5cbiAgICovXG4gIGFzeW5jIGZpbmRNaWdyYXRpb25zKCkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKVxuICAgIGNvbnN0IG1pZ3JhdGlvbkRpcmVjdG9yaWVzID0gW2Ake2NvbmZpZ3VyYXRpb24uZ2V0RGlyZWN0b3J5KCl9L3NyYy9kYXRhYmFzZS9taWdyYXRpb25zYF1cblxuICAgIGZvciAoY29uc3QgdmVsb2Npb3VzUGFja2FnZSBvZiBjb25maWd1cmF0aW9uLmdldFBhY2thZ2VzKCkpIHtcbiAgICAgIG1pZ3JhdGlvbkRpcmVjdG9yaWVzLnB1c2godmVsb2Npb3VzUGFja2FnZS5nZXRNaWdyYXRpb25zUGF0aCgpKVxuICAgIH1cblxuICAgIC8qKiBAdHlwZSB7QXJyYXk8aW1wb3J0KFwiLi9iYXNlLmpzXCIpLk1pZ3JhdGlvbk9iamVjdFR5cGU+fSAqL1xuICAgIGNvbnN0IGZpbGVzID0gW11cblxuICAgIGZvciAoY29uc3QgbWlncmF0aW9uc1BhdGggb2YgbWlncmF0aW9uRGlyZWN0b3JpZXMpIHtcbiAgICAgIGF3YWl0IHRoaXMuX2NvbGxlY3RNaWdyYXRpb25zRnJvbURpcmVjdG9yeShtaWdyYXRpb25zUGF0aCwgZmlsZXMpXG4gICAgfVxuXG4gICAgdGhpcy5fZW5zdXJlTm9NaWdyYXRpb25UaW1lc3RhbXBDb2xsaXNpb25zKGZpbGVzKVxuXG4gICAgcmV0dXJuIGZpbGVzLnNvcnQoKG1pZ3JhdGlvbjEsIG1pZ3JhdGlvbjIpID0+IG1pZ3JhdGlvbjEuZGF0ZSAtIG1pZ3JhdGlvbjIuZGF0ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBDb2xsZWN0cyBtaWdyYXRpb24gZmlsZXMgZnJvbSBvbmUgZGlyZWN0b3J5IGludG8gYGZpbGVzYCwgcHJlc2VydmluZyBlYWNoXG4gICAqIGZpbGUncyByZWFsIGFic29sdXRlIHBhdGggKHNvIGFwcCBhbmQgcGFja2FnZSBtaWdyYXRpb25zIGtlZXAgdGhlaXIgb3duXG4gICAqIHNvdXJjZSBsb2NhdGlvbikuIEEgbWlzc2luZyBkaXJlY3RvcnkgaXMgc2tpcHBlZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG1pZ3JhdGlvbnNQYXRoIC0gRGlyZWN0b3J5IHRvIHNjYW4uXG4gICAqIEBwYXJhbSB7QXJyYXk8aW1wb3J0KFwiLi9iYXNlLmpzXCIpLk1pZ3JhdGlvbk9iamVjdFR5cGU+fSBmaWxlcyAtIEFjY3VtdWxhdG9yIHRvIHB1c2ggaW50by5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9jb2xsZWN0TWlncmF0aW9uc0Zyb21EaXJlY3RvcnkobWlncmF0aW9uc1BhdGgsIGZpbGVzKSB7XG4gICAgY29uc3QgZ2xvYiA9IGF3YWl0IGZzLmdsb2IoYCR7bWlncmF0aW9uc1BhdGh9LyoqLyouanNgKVxuXG4gICAgdHJ5IHtcbiAgICAgIGZvciBhd2FpdCAoY29uc3QgZnVsbFBhdGggb2YgZ2xvYikge1xuICAgICAgICBjb25zdCBmaWxlID0gYXdhaXQgcGF0aC5iYXNlbmFtZShmdWxsUGF0aClcbiAgICAgICAgY29uc3QgbWF0Y2ggPSBmaWxlLm1hdGNoKC9eKFxcZHsxNH0pLSguKylcXC5qcyQvKVxuXG4gICAgICAgIGlmICghbWF0Y2gpIGNvbnRpbnVlXG5cbiAgICAgICAgY29uc3QgZGF0ZSA9IHBhcnNlSW50KG1hdGNoWzFdKVxuICAgICAgICBjb25zdCBtaWdyYXRpb25OYW1lID0gbWF0Y2hbMl1cbiAgICAgICAgY29uc3QgbWlncmF0aW9uQ2xhc3NOYW1lID0gaW5mbGVjdGlvbi5jYW1lbGl6ZShtaWdyYXRpb25OYW1lLnJlcGxhY2VBbGwoXCItXCIsIFwiX1wiKSlcblxuICAgICAgICBmaWxlcy5wdXNoKHtmaWxlLCBmdWxsUGF0aCwgZGF0ZSwgbWlncmF0aW9uQ2xhc3NOYW1lfSlcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKC8qKiBAdHlwZSB7RXJyb3IgJiB7Y29kZT86IHN0cmluZ319ICovIChlcnJvcik/LmNvZGUgIT09IFwiRU5PRU5UXCIpIHtcbiAgICAgICAgdGhyb3cgZXJyb3JcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogVGhyb3dzIGlmIHR3byBtaWdyYXRpb25zIGZyb20gZGlmZmVyZW50IGZpbGVzIHNoYXJlIHRoZSBzYW1lIDE0LWRpZ2l0XG4gICAqIHRpbWVzdGFtcC4gVGhlIGBzY2hlbWFfbWlncmF0aW9uc2AgbGVkZ2VyIGtleXMgb24gdGhlIHRpbWVzdGFtcCwgc28gYSBzaWxlbnRcbiAgICogY29sbGlzaW9uIChlLmcuIGJldHdlZW4gdGhlIGFwcCBhbmQgYSBwYWNrYWdlLCBvciB0d28gcGFja2FnZXMpIHdvdWxkIGxlYXZlXG4gICAqIHRoZSBzZWNvbmQgbWlncmF0aW9uIHVuLXJ1biDigJQgYSBkYXRhIGJ1Zy4gRmFpbCBsb3VkbHkgaW5zdGVhZC5cbiAgICogQHBhcmFtIHtBcnJheTxpbXBvcnQoXCIuL2Jhc2UuanNcIikuTWlncmF0aW9uT2JqZWN0VHlwZT59IGZpbGVzIC0gQ29sbGVjdGVkIG1pZ3JhdGlvbnMuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIF9lbnN1cmVOb01pZ3JhdGlvblRpbWVzdGFtcENvbGxpc2lvbnMoZmlsZXMpIHtcbiAgICAvKiogQHR5cGUge01hcDxudW1iZXIsIHN0cmluZz59ICovXG4gICAgY29uc3QgcGF0aHNCeURhdGUgPSBuZXcgTWFwKClcblxuICAgIGZvciAoY29uc3QgbWlncmF0aW9uIG9mIGZpbGVzKSB7XG4gICAgICBpZiAoIW1pZ3JhdGlvbi5mdWxsUGF0aCkgY29udGludWVcblxuICAgICAgY29uc3QgZXhpc3RpbmcgPSBwYXRoc0J5RGF0ZS5nZXQobWlncmF0aW9uLmRhdGUpXG5cbiAgICAgIGlmIChleGlzdGluZyAmJiBleGlzdGluZyAhPT0gbWlncmF0aW9uLmZ1bGxQYXRoKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgVHdvIG1pZ3JhdGlvbnMgc2hhcmUgdGhlIHRpbWVzdGFtcCAke21pZ3JhdGlvbi5kYXRlfTogJHtleGlzdGluZ30gYW5kICR7bWlncmF0aW9uLmZ1bGxQYXRofS4gTWlncmF0aW9uIHRpbWVzdGFtcHMgbXVzdCBiZSB1bmlxdWUgYWNyb3NzIHRoZSBhcHAgYW5kIGFsbCBwYWNrYWdlcy5gKVxuICAgICAgfVxuXG4gICAgICBwYXRoc0J5RGF0ZS5zZXQobWlncmF0aW9uLmRhdGUsIG1pZ3JhdGlvbi5mdWxsUGF0aClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBpbXBvcnQgYXBwbGljYXRpb24gcm91dGVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuLi9yb3V0ZXMvaW5kZXguanNcIikuZGVmYXVsdD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgaW1wb3J0IGFwcGxpY2F0aW9uIHJvdXRlcy5cbiAgICovXG4gIGFzeW5jIGltcG9ydEFwcGxpY2F0aW9uUm91dGVzKCkge1xuICAgIGNvbnN0IHJvdXRlc0ltcG9ydCA9IGF3YWl0IGltcG9ydCh0b0ltcG9ydFNwZWNpZmllcihgJHt0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXREaXJlY3RvcnkoKX0vc3JjL2NvbmZpZy9yb3V0ZXMuanNgKSlcblxuICAgIHJldHVybiByb3V0ZXNJbXBvcnQuZGVmYXVsdFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHZlbG9jaW91cyBwYXRoLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSAtIFJlc29sdmVzIHdpdGggdGhlIHZlbG9jaW91cyBwYXRoLlxuICAgKi9cbiAgYXN5bmMgZ2V0VmVsb2Npb3VzUGF0aCgpIHtcbiAgICBpZiAoIXRoaXMuX3ZlbG9jaW91c1BhdGgpIHtcbiAgICAgIGNvbnN0IF9fZmlsZW5hbWUgPSBmaWxlVVJMVG9QYXRoKGltcG9ydC5tZXRhLnVybClcbiAgICAgIGNvbnN0IF9fZGlybmFtZSA9IGRpcm5hbWUoX19maWxlbmFtZSlcblxuICAgICAgdGhpcy5fdmVsb2Npb3VzUGF0aCA9IGF3YWl0IGZzLnJlYWxwYXRoKGAke19fZGlybmFtZX0vLi4vLi5gKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl92ZWxvY2lvdXNQYXRoXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpbXBvcnQgdGVzdCBmaWxlcy5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gdGVzdEZpbGVzIC0gVGVzdCBmaWxlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGltcG9ydFRlc3RGaWxlcyh0ZXN0RmlsZXMpIHtcbiAgICBmb3IgKGNvbnN0IHRlc3RGaWxlIG9mIHRlc3RGaWxlcykge1xuICAgICAgYXdhaXQgaW1wb3J0KHRvSW1wb3J0U3BlY2lmaWVyKHRlc3RGaWxlKSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZGVmYXVsdCBsb2cgZGlyZWN0b3J5LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gYXJncy5jb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgZGVmYXVsdCBsb2cgZGlyZWN0b3J5LlxuICAgKi9cbiAgZ2V0RGVmYXVsdExvZ0RpcmVjdG9yeSh7Y29uZmlndXJhdGlvbn0pIHtcbiAgICByZXR1cm4gcGF0aC5qb2luKGNvbmZpZ3VyYXRpb24uZ2V0RGlyZWN0b3J5KCksIFwibG9nXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgbG9nIGZpbGUgcGF0aC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGFyZ3MuY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBhcmdzLmRpcmVjdG9yeSAtIERpcmVjdG9yeSBwYXRoLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5lbnZpcm9ubWVudCAtIEVudmlyb25tZW50LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSAtIFRoZSBsb2cgZmlsZSBwYXRoLlxuICAgKi9cbiAgZ2V0TG9nRmlsZVBhdGgoe2NvbmZpZ3VyYXRpb24sIGRpcmVjdG9yeSwgZW52aXJvbm1lbnR9KSB7XG4gICAgY29uc3QgYWN0dWFsRGlyZWN0b3J5ID0gZGlyZWN0b3J5IHx8IGNvbmZpZ3VyYXRpb24/LmdldERpcmVjdG9yeT8uKClcblxuICAgIGlmICghYWN0dWFsRGlyZWN0b3J5KSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgICByZXR1cm4gcGF0aC5qb2luKGFjdHVhbERpcmVjdG9yeSwgYCR7ZW52aXJvbm1lbnR9LmxvZ2ApXG4gIH1cblxuICAvKipcbiAgICogUnVucyB3cml0ZSBsb2cgdG8gZmlsZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuZmlsZVBhdGggLSBGaWxlIHBhdGguXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLm1lc3NhZ2UgLSBNZXNzYWdlIHRleHQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyB3cml0ZUxvZ1RvRmlsZSh7ZmlsZVBhdGgsIG1lc3NhZ2V9KSB7XG4gICAgYXdhaXQgZnMubWtkaXIocGF0aC5kaXJuYW1lKGZpbGVQYXRoKSwge3JlY3Vyc2l2ZTogdHJ1ZX0pXG4gICAgYXdhaXQgZnMuYXBwZW5kRmlsZShmaWxlUGF0aCwgYCR7bWVzc2FnZX1cXG5gLCBcInV0ZjhcIilcbiAgfVxuXG4gIGFzeW5jIGltcG9ydFRlc3RpbmdDb25maWdQYXRoKCkge1xuICAgIGNvbnN0IHRlc3RpbmdDb25maWdQYXRoID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZ2V0VGVzdGluZygpXG5cbiAgICBpZiAoIXRlc3RpbmdDb25maWdQYXRoKSByZXR1cm5cblxuICAgIGNvbnN0IHRlc3RpbmdJbXBvcnQgPSBhd2FpdCBpbXBvcnQodG9JbXBvcnRTcGVjaWZpZXIodGVzdGluZ0NvbmZpZ1BhdGgpKVxuICAgIGNvbnN0IHRlc3RpbmdEZWZhdWx0ID0gdGVzdGluZ0ltcG9ydC5kZWZhdWx0XG5cbiAgICBpZiAoIXRlc3RpbmdEZWZhdWx0KSB0aHJvdyBuZXcgRXJyb3IoXCJUZXN0aW5nIGNvbmZpZyBtdXN0IGV4cG9ydCBhIGRlZmF1bHQgZnVuY3Rpb25cIilcbiAgICBpZiAodHlwZW9mIHRlc3RpbmdEZWZhdWx0ICE9PSBcImZ1bmN0aW9uXCIpIHRocm93IG5ldyBFcnJvcihcIlRlc3RpbmcgY29uZmlnIGRlZmF1bHQgZXhwb3J0IGlzbid0IGEgZnVuY3Rpb25cIilcblxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRlc3RpbmdEZWZhdWx0KClcblxuICAgIGlmICh0eXBlb2YgcmVzdWx0ID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIGF3YWl0IHJlc3VsdCgpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVxdWlyZSBtaWdyYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBmaWxlUGF0aCAtIEZpbGUgcGF0aC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi4vZGF0YWJhc2UvbWlncmF0aW9uL2luZGV4LmpzXCIpLmRlZmF1bHQ+fSAtIFJlc29sdmVzIHdpdGggdGhlIHJlcXVpcmUgbWlncmF0aW9uLlxuICAgKi9cbiAgYXN5bmMgcmVxdWlyZU1pZ3JhdGlvbihmaWxlUGF0aCkge1xuICAgIGNvbnN0IG1pZ3JhdGlvbkltcG9ydCA9IGF3YWl0IGltcG9ydCh0b0ltcG9ydFNwZWNpZmllcihmaWxlUGF0aCkpXG4gICAgY29uc3QgbWlncmF0aW9uSW1wb3J0RGVmYXVsdCA9IG1pZ3JhdGlvbkltcG9ydC5kZWZhdWx0XG5cbiAgICBpZiAoIW1pZ3JhdGlvbkltcG9ydERlZmF1bHQpIHRocm93IG5ldyBFcnJvcihcIk1pZ3JhdGlvbiBmaWxlIG11c3QgZXhwb3J0IGEgZGVmYXVsdCBtaWdyYXRpb24gY2xhc3NcIilcbiAgICBpZiAodHlwZW9mIG1pZ3JhdGlvbkltcG9ydERlZmF1bHQgIT09IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IEVycm9yKFwiTWlncmF0aW9uIGRlZmF1bHQgZXhwb3J0IGlzbid0IGEgZnVuY3Rpb24gKHNob3VsZCBiZSBhIGNsYXNzIHdoaWNoIGlzIGEgZnVuY3Rpb24gaW4gSlMpXCIpXG5cbiAgICByZXR1cm4gbWlncmF0aW9uSW1wb3J0RGVmYXVsdFxuICB9XG5cbiAgYXN5bmMgZ2V0QmFzZVBhdGgoKSB7XG4gICAgY29uc3QgX19maWxlbmFtZSA9IGZpbGVVUkxUb1BhdGgoaW1wb3J0Lm1ldGEudXJsKVxuICAgIGNvbnN0IGJhc2VQYXRoID0gYXdhaXQgZnMucmVhbHBhdGgoYCR7ZGlybmFtZShfX2ZpbGVuYW1lKX0vLi4vLi5gKVxuXG4gICAgcmV0dXJuIGJhc2VQYXRoXG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyBWZWxvY2lvdXMgZnJhbWV3b3JrIHNjaGVtYSBleGlzdHMgYXMgcGFydCBvZiBgZGI6bWlncmF0ZWAsIHNvIGludGVybmFsXG4gICAqIHRhYmxlcyBhcmUgY3JlYXRlZCBkZXRlcm1pbmlzdGljYWxseSBhbG9uZ3NpZGUgYXBwIG1pZ3JhdGlvbnMgYW5kIGNhcHR1cmVkIGluXG4gICAqIHRoZSBkdW1wZWQgc3RydWN0dXJlIFNRTCBpbnN0ZWFkIG9mIGFwcGVhcmluZyBvbmx5IHdoZW4gcnVudGltZSBzdG9yZXMgYm9vdC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdD59IGFyZ3MuZGJzIC0gRGJzIGJlaW5nIG1pZ3JhdGVkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgZW5zdXJlRnJhbWV3b3JrU2NoZW1hKHtkYnN9KSB7XG4gICAgLy8gTWlncmF0aW9uIHBhc3NlcyBpdHMgYWxyZWFkeSBjaGVja2VkLW91dCBEQiBpbnRvIHRoZSBhZGFwdGVyIGhvb2suIERvIG5vdFxuICAgIC8vIHJ1biBydW50aW1lIHJlYWRpbmVzcyBoZXJlOiBpdCB3b3VsZCBvcGVuIGEgbmVzdGVkIGNoZWNrb3V0IGFuZCBjYW4gZGVhZGxvY2tcbiAgICAvLyBhIHNpbmdsZS1jb25uZWN0aW9uIG1pZ3JhdGlvbiBwb29sLlxuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKVxuXG4gICAgZm9yIChjb25zdCBbZGF0YWJhc2VJZGVudGlmaWVyLCBkYl0gb2YgT2JqZWN0LmVudHJpZXMoZGJzKSkge1xuICAgICAgY29uc3QgYXR0YWNobWVudFN0b3JlID0gbmV3IFJlY29yZEF0dGFjaG1lbnRzU3RvcmUoe2NvbmZpZ3VyYXRpb24sIGRhdGFiYXNlSWRlbnRpZmllcn0pXG5cbiAgICAgIGF3YWl0IGF0dGFjaG1lbnRTdG9yZS5lbnN1cmVTY2hlbWEoZGIpXG4gICAgfVxuXG4gICAgY29uc3QgYWRhcHRlciA9IGNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNBZGFwdGVyKClcblxuICAgIGF3YWl0IGFkYXB0ZXIuZW5zdXJlRnJhbWV3b3JrU2NoZW1hKHtkYnN9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWZ0ZXIgbWlncmF0aW9ucy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdD59IGFyZ3MuZGJzIC0gRGJzLlxuICAgKiBAcGFyYW0ge1wibWlncmF0aW9uXCIgfCBcInNjaGVtYUR1bXBcIn0gW2FyZ3MucmVhc29uXSAtIFdoeSB0aGUgc3RydWN0dXJlIHdyaXRlIGlzIGJlaW5nIHRyaWdnZXJlZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGFmdGVyTWlncmF0aW9ucyh7ZGJzLCByZWFzb24gPSBcIm1pZ3JhdGlvblwifSkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKVxuXG4gICAgaWYgKCFjb25maWd1cmF0aW9uLnNob3VsZFdyaXRlU3RydWN0dXJlU3FsKHtyZWFzb259KSkgcmV0dXJuXG5cbiAgICBjb25zdCBkYkRpciA9IHBhdGguam9pbihjb25maWd1cmF0aW9uLmdldERpcmVjdG9yeSgpLCBcImRiXCIpXG4gICAgY29uc3Qgc3RydWN0dXJlU3FsQnlJZGVudGlmaWVyID0gYXdhaXQgdGhpcy5fc3RydWN0dXJlU3FsQnlJZGVudGlmaWVyKHtkYnN9KVxuXG4gICAgYXdhaXQgZnMubWtkaXIoZGJEaXIsIHtyZWN1cnNpdmU6IHRydWV9KVxuXG4gICAgZm9yIChjb25zdCBpZGVudGlmaWVyIG9mIE9iamVjdC5rZXlzKHN0cnVjdHVyZVNxbEJ5SWRlbnRpZmllcikpIHtcbiAgICAgIGNvbnN0IHN0cnVjdHVyZVNxbCA9IHN0cnVjdHVyZVNxbEJ5SWRlbnRpZmllcltpZGVudGlmaWVyXVxuXG4gICAgICBpZiAoIXN0cnVjdHVyZVNxbCkgY29udGludWVcblxuICAgICAgY29uc3QgZmlsZVBhdGggPSBwYXRoLmpvaW4oZGJEaXIsIGBzdHJ1Y3R1cmUtJHtpZGVudGlmaWVyfS5zcWxgKVxuXG4gICAgICBhd2FpdCBmcy53cml0ZUZpbGUoZmlsZVBhdGgsIHN0cnVjdHVyZVNxbClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdHJ1Y3R1cmUgc3FsIGJ5IGlkZW50aWZpZXIuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQ+fSBhcmdzLmRicyAtIERicy5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgc3RyaW5nPj59IC0gUmVzb2x2ZXMgd2l0aCBTUUwgc3RyaW5nLlxuICAgKi9cbiAgYXN5bmMgX3N0cnVjdHVyZVNxbEJ5SWRlbnRpZmllcih7ZGJzfSkge1xuICAgIGNvbnN0IHNxbEJ5SWRlbnRpZmllciA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn0gKi8gKHt9KVxuXG4gICAgZm9yIChjb25zdCBpZGVudGlmaWVyIG9mIE9iamVjdC5rZXlzKGRicykpIHtcbiAgICAgIGNvbnN0IGRiID0gZGJzW2lkZW50aWZpZXJdXG5cbiAgICAgIGlmICh0eXBlb2YgZGIuc3RydWN0dXJlU3FsICE9PSBcImZ1bmN0aW9uXCIpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IHN0cnVjdHVyZVNxbCA9IGF3YWl0IGRiLnN0cnVjdHVyZVNxbCgpXG5cbiAgICAgIGlmIChzdHJ1Y3R1cmVTcWwpIHtcbiAgICAgICAgY29uc3QgbWlncmF0aW9uSW5zZXJ0cyA9IGF3YWl0IHRoaXMuX3NjaGVtYU1pZ3JhdGlvbnNJbnNlcnRTcWwoe2RifSlcblxuICAgICAgICBzcWxCeUlkZW50aWZpZXJbaWRlbnRpZmllcl0gPSBzdHJ1Y3R1cmVTcWwgKyBtaWdyYXRpb25JbnNlcnRzXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHNxbEJ5SWRlbnRpZmllclxuICB9XG5cbiAgLyoqXG4gICAqIEdlbmVyYXRlcyBJTlNFUlQgc3RhdGVtZW50cyBmb3IgZXZlcnkgcm93IGluIGBzY2hlbWFfbWlncmF0aW9uc2Agc28gdGhlXG4gICAqIHN0cnVjdHVyZSBzbmFwc2hvdCBjYXJyaWVzIHRoZSBtaWdyYXRpb24gbGVkZ2VyIGFsb25nIHdpdGggdGhlIERETC4gIFdpdGhvdXRcbiAgICogdGhlc2Ugcm93cyBhIGZyZXNoIERCIGxvYWRlZCBmcm9tIHRoZSBzbmFwc2hvdCB3aWxsIHJlLXJ1biBldmVyeSBtaWdyYXRpb24sXG4gICAqIHdoaWNoIGZhaWxzIHdoZW4gdGhlIHNuYXBzaG90IGFscmVhZHkgY29udGFpbnMgdGhlIHBvc3QtbWlncmF0aW9uIHNjaGVtYS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gYXJncy5kYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IC0gSU5TRVJUIHN0YXRlbWVudHMgKGVtcHR5IHN0cmluZyB3aGVuIG5vbmUpLlxuICAgKi9cbiAgYXN5bmMgX3NjaGVtYU1pZ3JhdGlvbnNJbnNlcnRTcWwoe2RifSkge1xuICAgIGNvbnN0IHtkZWZhdWx0OiBNaWdyYXRpb25zTGVkZ2VyfSA9IGF3YWl0IGltcG9ydChcIi4uL2RhdGFiYXNlL21pZ3JhdGlvbnMtbGVkZ2VyLmpzXCIpXG5cbiAgICBpZiAoIWF3YWl0IE1pZ3JhdGlvbnNMZWRnZXIudGFibGVFeGlzdHMoZGIpKSByZXR1cm4gXCJcIlxuXG4gICAgY29uc3QgdmVyc2lvbnMgPSBhd2FpdCBNaWdyYXRpb25zTGVkZ2VyLmFwcGxpZWRWZXJzaW9ucyhkYilcblxuICAgIGlmICh2ZXJzaW9ucy5sZW5ndGggPT0gMCkgcmV0dXJuIFwiXCJcblxuICAgIHJldHVybiB2ZXJzaW9ucy5tYXAoKHZlcnNpb24pID0+IGBJTlNFUlQgSU5UTyBzY2hlbWFfbWlncmF0aW9ucyAodmVyc2lvbikgVkFMVUVTICgke2RiLnF1b3RlKHZlcnNpb24pfSk7YCkuam9pbihcIlxcblwiKSArIFwiXFxuXCJcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgZnJvbnRlbmQtbW9kZWwgd2Vic29ja2V0IGNoYW5uZWwgcHVibGlzaGVycyBzbyBsaWZlY3ljbGVcbiAgICogZXZlbnQgaG9va3MgYnJvYWRjYXN0IG92ZXIgdGhlIHNoYXJlZCBcImZyb250ZW5kLW1vZGVsc1wiIGNoYW5uZWwuXG4gICAqIFRoaXMgaXMgb25seSBpbXBsZW1lbnRlZCBieSB0aGUgTm9kZSBoYW5kbGVyIGJlY2F1c2UgdGhlIHJlcXVpcmVkXG4gICAqIG1vZHVsZXMgKGBmcm9udGVuZC1tb2RlbC1jb250cm9sbGVyYCwgYHJvdXRlcy9yZXNvbHZlcmApIHB1bGwgaW5cbiAgICogc2VydmVyLW9ubHkgTm9kZSBBUElzIHRoYXQgYnJlYWsgYnJvd3NlciBidW5kbGVycy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgaW5pdGlhbGl6ZUZyb250ZW5kTW9kZWxXZWJzb2NrZXRQdWJsaXNoZXJzKGNvbmZpZ3VyYXRpb24pIHtcbiAgICAvLyBEaXNjb3ZlciBlYWNoIGJhY2tlbmQgcHJvamVjdCdzIHJlc291cmNlcyBiZWZvcmUgcmVnaXN0ZXJpbmcgcHVibGlzaGVycy4gVGhlIHB1Ymxpc2hlcnMgYXJlXG4gICAgLy8gZGVyaXZlZCBmcm9tIGBiYWNrZW5kUHJvamVjdC5mcm9udGVuZE1vZGVsc2AsIHdoaWNoIGBhdXRvRGlzY292ZXJSZXNvdXJjZXNgIHBvcHVsYXRlcy4gV2l0aG91dFxuICAgIC8vIHRoaXMsIHJlZ2lzdHJhdGlvbiBydW5zIGFnYWluc3QgYW4gZW1wdHkvcGFydGlhbCByZXNvdXJjZSBzZXQgKG9ubHkgYnVpbHQtaW5zKSwgc28gYXBwcyB0aGF0XG4gICAgLy8gcmVzb2x2ZSByZXNvdXJjZXMgdGhyb3VnaCBhbiBgYWJpbGl0eVJlc29sdmVyYCByYXRoZXIgdGhhbiBhIHN0YXRpYyBhYmlsaXR5LXJlc291cmNlIGxpc3QgbmV2ZXJcbiAgICAvLyByZWdpc3RlciBsaWZlY3ljbGUgcHVibGlzaGVycyBhbmQgdGhlaXIgcmVhbHRpbWUgZnJvbnRlbmQtbW9kZWwgdXBkYXRlcyBzaWxlbnRseSBzdG9wLiBUaGVcbiAgICAvLyBsaWZlY3ljbGUgaG9va3MgYXJlIGRlZHVwZWQgcGVyIG1vZGVsIGNsYXNzIHZpYSBhIHByb2Nlc3MtZ2xvYmFsIHNldCwgc28gYSBsYXRlciwgZnVsbHlcbiAgICAvLyBkaXNjb3ZlcmVkIHBhc3MgY2Fubm90IHJldHJvYWN0aXZlbHkgYWRkIHRoZSBtaXNzaW5nIHB1Ymxpc2hlcnMuIGBhdXRvRGlzY292ZXJSZXNvdXJjZXNgIGlzXG4gICAgLy8gaWRlbXBvdGVudCAoaXQgc2tpcHMgYmFja2VuZCBwcm9qZWN0cyB3aG9zZSBgZnJvbnRlbmRNb2RlbHNgIGFyZSBhbHJlYWR5IHNldCkuXG4gICAgYXdhaXQgdGhpcy5hdXRvRGlzY292ZXJSZXNvdXJjZXMoY29uZmlndXJhdGlvbilcblxuICAgIGNvbnN0IHtlbnN1cmVGcm9udGVuZE1vZGVsV2Vic29ja2V0UHVibGlzaGVyc1JlZ2lzdGVyZWR9ID0gYXdhaXQgaW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWxzL3dlYnNvY2tldC1wdWJsaXNoZXJzLmpzXCIpXG5cbiAgICBhd2FpdCBlbnN1cmVGcm9udGVuZE1vZGVsV2Vic29ja2V0UHVibGlzaGVyc1JlZ2lzdGVyZWQoY29uZmlndXJhdGlvbilcbiAgfVxufVxuIl19