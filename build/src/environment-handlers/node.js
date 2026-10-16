// @ts-check
import "../database/annotations-async-hooks.js";
import AdvisoryLockFileBackend from "../database/advisory-lock-file-backend.js";
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibm9kZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9lbnZpcm9ubWVudC1oYW5kbGVycy9ub2RlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLHdDQUF3QyxDQUFBO0FBQy9DLE9BQU8sdUJBQXVCLE1BQU0sMkNBQTJDLENBQUE7QUFDL0UsT0FBTyxJQUFJLE1BQU0sV0FBVyxDQUFBO0FBQzVCLE9BQU8sb0JBQW9CLE1BQU0sOEJBQThCLENBQUE7QUFDL0QsT0FBTyx3QkFBd0IsTUFBTSxtQ0FBbUMsQ0FBQTtBQUN4RSxPQUFPLDJCQUEyQixNQUFNLDBDQUEwQyxDQUFBO0FBQ2xGLE9BQU8sZUFBZSxNQUFNLDZCQUE2QixDQUFBO0FBQ3pELE9BQU8sNkJBQTZCLE1BQU0sNkNBQTZDLENBQUE7QUFDdkYsT0FBTyxpQ0FBaUMsTUFBTSxpREFBaUQsQ0FBQTtBQUMvRixPQUFPLDRCQUE0QixNQUFNLDJDQUEyQyxDQUFBO0FBQ3BGLE9BQU8sd0JBQXdCLE1BQU0sdUNBQXVDLENBQUE7QUFDNUUsT0FBTyw0QkFBNEIsTUFBTSwyQ0FBMkMsQ0FBQTtBQUNwRixPQUFPLGNBQWMsTUFBTSw0QkFBNEIsQ0FBQTtBQUN2RCxPQUFPLGlCQUFpQixNQUFNLCtCQUErQixDQUFBO0FBQzdELE9BQU8saUJBQWlCLE1BQU0sK0JBQStCLENBQUE7QUFDN0QsT0FBTyxlQUFlLE1BQU0sNkJBQTZCLENBQUE7QUFDekQsT0FBTyxrQ0FBa0MsTUFBTSxtREFBbUQsQ0FBQTtBQUNsRyxPQUFPLDZCQUE2QixNQUFNLDZDQUE2QyxDQUFBO0FBQ3ZGLE9BQU8saUNBQWlDLE1BQU0saURBQWlELENBQUE7QUFDL0YsT0FBTywrQkFBK0IsTUFBTSwrQ0FBK0MsQ0FBQTtBQUMzRixPQUFPLCtCQUErQixNQUFNLCtDQUErQyxDQUFBO0FBQzNGLE9BQU8sK0JBQStCLE1BQU0sK0NBQStDLENBQUE7QUFDM0YsT0FBTyxpQkFBaUIs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QUFRLENBQUMsR0FBRyxDQUFDLENBQUMsT0FBTyxFQUFFLEVBQUUsQ0FBQyxtREFBbUQsRUFBRSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxHQUFHLElBQUksQ0FBQTtJQUM5SCxDQUFDO0lBRUQ7Ozs7Ozs7O09BUUc7SUFDSCxLQUFLLENBQUMsMENBQTBDLENBQUMsYUFBYTtRQUM1RCw4RkFBOEY7UUFDOUYsaUdBQWlHO1FBQ2pHLCtGQUErRjtRQUMvRixrR0FBa0c7UUFDbEcsNkZBQTZGO1FBQzdGLDBGQUEwRjtRQUMxRiw4RkFBOEY7UUFDOUYsaUZBQWlGO1FBQ2pGLE1BQU0sSUFBSSxDQUFDLHFCQUFxQixDQUFDLGFBQWEsQ0FBQyxDQUFBO1FBRS9DLE1BQU0sRUFBQyxnREFBZ0QsRUFBQyxHQUFHLE1BQU0sTUFBTSxDQUFDLDRDQUE0QyxDQUFDLENBQUE7UUFFckgsTUFBTSxnREFBZ0QsQ0FBQyxhQUFhLENBQUMsQ0FBQTtJQUN2RSxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IFwiLi4vZGF0YWJhc2UvYW5ub3RhdGlvbnMtYXN5bmMtaG9va3MuanNcIlxuaW1wb3J0IEFkdmlzb3J5TG9ja0ZpbGVCYWNrZW5kIGZyb20gXCIuLi9kYXRhYmFzZS9hZHZpc29yeS1sb2NrLWZpbGUtYmFja2VuZC5qc1wiXG5pbXBvcnQgQmFzZSBmcm9tIFwiLi9iYXNlLmpzXCJcbmltcG9ydCBCYWNrZ3JvdW5kSm9ic0NsaWVudCBmcm9tIFwiLi4vYmFja2dyb3VuZC1qb2JzL2NsaWVudC5qc1wiXG5pbXBvcnQgU3FsQmFja2dyb3VuZEpvYnNBZGFwdGVyIGZyb20gXCIuLi9iYWNrZ3JvdW5kLWpvYnMvc3FsLWFkYXB0ZXIuanNcIlxuaW1wb3J0IENsaUNvbW1hbmRzRGVzdHJveU1pZ3JhdGlvbiBmcm9tIFwiLi9ub2RlL2NsaS9jb21tYW5kcy9kZXN0cm95L21pZ3JhdGlvbi5qc1wiXG5pbXBvcnQgQ2xpQ29tbWFuZHNJbml0IGZyb20gXCIuL25vZGUvY2xpL2NvbW1hbmRzL2luaXQuanNcIlxuaW1wb3J0IENsaUNvbW1hbmRzR2VuZXJhdGVCYXNlTW9kZWxzIGZyb20gXCIuL25vZGUvY2xpL2NvbW1hbmRzL2dlbmVyYXRlL2Jhc2UtbW9kZWxzLmpzXCJcbmltcG9ydCBDbGlDb21tYW5kc0dlbmVyYXRlRnJvbnRlbmRNb2RlbHMgZnJvbSBcIi4vbm9kZS9jbGkvY29tbWFuZHMvZ2VuZXJhdGUvZnJvbnRlbmQtbW9kZWxzLmpzXCJcbmltcG9ydCBDbGlDb21tYW5kc0dlbmVyYXRlTWlncmF0aW9uIGZyb20gXCIuL25vZGUvY2xpL2NvbW1hbmRzL2dlbmVyYXRlL21pZ3JhdGlvbi5qc1wiXG5pbXBvcnQgQ2xpQ29tbWFuZHNHZW5lcmF0ZU1vZGVsIGZyb20gXCIuL25vZGUvY2xpL2NvbW1hbmRzL2dlbmVyYXRlL21vZGVsLmpzXCJcbmltcG9ydCBDbGlDb21tYW5kc0xpbnRSZWxhdGlvbnNoaXBzIGZyb20gXCIuL25vZGUvY2xpL2NvbW1hbmRzL2xpbnQvcmVsYXRpb25zaGlwcy5qc1wiXG5pbXBvcnQgQ2xpQ29tbWFuZHNNY3AgZnJvbSBcIi4vbm9kZS9jbGkvY29tbWFuZHMvbWNwLmpzXCJcbmltcG9ydCBDbGlDb21tYW5kc1JvdXRlcyBmcm9tIFwiLi9ub2RlL2NsaS9jb21tYW5kcy9yb3V0ZXMuanNcIlxuaW1wb3J0IENsaUNvbW1hbmRzU2VydmVyIGZyb20gXCIuL25vZGUvY2xpL2NvbW1hbmRzL3NlcnZlci5qc1wiXG5pbXBvcnQgQ2xpQ29tbWFuZHNUZXN0IGZyb20gXCIuL25vZGUvY2xpL2NvbW1hbmRzL3Rlc3QuanNcIlxuaW1wb3J0IENsaUNvbW1hbmRzVGVzdFRpbWluZ01hbmlmZXN0TWVyZ2UgZnJvbSBcIi4vbm9kZS9jbGkvY29tbWFuZHMvdGVzdC90aW1pbmctbWFuaWZlc3QvbWVyZ2UuanNcIlxuaW1wb3J0IENsaUNvbW1hbmRzQmFja2dyb3VuZEpvYnNNYWluIGZyb20gXCIuL25vZGUvY2xpL2NvbW1hbmRzL2JhY2tncm91bmQtam9icy1tYWluLmpzXCJcbmltcG9ydCBDbGlDb21tYW5kc0JhY2tncm91bmRKb2JzQWN0aXZhdGUgZnJvbSBcIi4vbm9kZS9jbGkvY29tbWFuZHMvYmFja2dyb3VuZC1qb2JzLWFjdGl2YXRlLmpzXCJcbmltcG9ydCBDbGlDb21tYW5kc0JhY2tncm91bmRKb2JzUmV0aXJlIGZyb20gXCIuL25vZGUvY2xpL2NvbW1hbmRzL2JhY2tncm91bmQtam9icy1yZXRpcmUuanNcIlxuaW1wb3J0IENsaUNvbW1hbmRzQmFja2dyb3VuZEpvYnNXb3JrZXIgZnJvbSBcIi4vbm9kZS9jbGkvY29tbWFuZHMvYmFja2dyb3VuZC1qb2JzLXdvcmtlci5qc1wiXG5pbXBvcnQgQ2xpQ29tbWFuZHNCYWNrZ3JvdW5kSm9ic1J1bm5lciBmcm9tIFwiLi9ub2RlL2NsaS9jb21tYW5kcy9iYWNrZ3JvdW5kLWpvYnMtcnVubmVyLmpzXCJcbmltcG9ydCBDbGlDb21tYW5kc0JlYWNvbiBmcm9tIFwiLi9ub2RlL2NsaS9jb21tYW5kcy9iZWFjb24uanNcIlxuaW1wb3J0IENsaUNvbW1hbmRzQ29uc29sZSBmcm9tIFwiLi9ub2RlL2NsaS9jb21tYW5kcy9jb25zb2xlLmpzXCJcbmltcG9ydCBDbGlDb21tYW5kc0RiU2NoZW1hRHVtcCBmcm9tIFwiLi9ub2RlL2NsaS9jb21tYW5kcy9kYi9zY2hlbWEvZHVtcC5qc1wiXG5pbXBvcnQgQ2xpQ29tbWFuZHNEYlNjaGVtYUxvYWQgZnJvbSBcIi4vbm9kZS9jbGkvY29tbWFuZHMvZGIvc2NoZW1hL2xvYWQuanNcIlxuaW1wb3J0IENsaUNvbW1hbmRzRGJTZWVkIGZyb20gXCIuL25vZGUvY2xpL2NvbW1hbmRzL2RiL3NlZWQuanNcIlxuaW1wb3J0IENsaUNvbW1hbmRzUnVubmVyIGZyb20gXCIuL25vZGUvY2xpL2NvbW1hbmRzL3J1bm5lci5qc1wiXG5pbXBvcnQgQ2xpQ29tbWFuZHNSdW5TY3JpcHQgZnJvbSBcIi4vbm9kZS9jbGkvY29tbWFuZHMvcnVuLXNjcmlwdC5qc1wiXG5pbXBvcnQgZnJvbnRlbmRNb2RlbENvbW1hbmRSb3V0ZUhvb2sgZnJvbSBcIi4uL3JvdXRlcy9ob29rcy9mcm9udGVuZC1tb2RlbC1jb21tYW5kLXJvdXRlLWhvb2suanNcIlxuaW1wb3J0IHsgRlJBTUVXT1JLX1NPVVJDRV9ESVJFQ1RPUlkgfSBmcm9tIFwiLi4vdXRpbHMvYmFja3RyYWNlLWNsZWFuZXItbm9kZS5qc1wiXG5pbXBvcnQgeyBkaXJuYW1lIH0gZnJvbSBcInBhdGhcIlxuaW1wb3J0IHsgZmlsZVVSTFRvUGF0aCB9IGZyb20gXCJ1cmxcIlxuaW1wb3J0IGZzIGZyb20gXCJmcy9wcm9taXNlc1wiXG5pbXBvcnQgKiBhcyBpbmZsZWN0aW9uIGZyb20gXCJpbmZsZWN0aW9uXCJcbmltcG9ydCBwYXRoIGZyb20gXCJwYXRoXCJcbmltcG9ydCB7IEFzeW5jTG9jYWxTdG9yYWdlIGFzIE5vZGVBc3luY0xvY2FsU3RvcmFnZSB9IGZyb20gXCJub2RlOmFzeW5jX2hvb2tzXCJcbmltcG9ydCB7IHRpbWluZ1NhZmVFcXVhbCB9IGZyb20gXCJub2RlOmNyeXB0b1wiXG5pbXBvcnQgcmVxdWlyZUNvbnRleHQgZnJvbSBcInJlcXVpcmUtY29udGV4dFwiXG5pbXBvcnQgQXN5bmNUcmFja2VkTXVsdGlDb25uZWN0aW9uUG9vbCBmcm9tIFwiLi4vZGF0YWJhc2UvcG9vbC9hc3luYy10cmFja2VkLW11bHRpLWNvbm5lY3Rpb24uanNcIlxuaW1wb3J0IEluaXRpYWxpemVyRnJvbVJlcXVpcmVDb250ZXh0IGZyb20gXCIuLi9kYXRhYmFzZS9pbml0aWFsaXplci1mcm9tLXJlcXVpcmUtY29udGV4dC5qc1wiXG5pbXBvcnQgUmVjb3JkQXR0YWNobWVudHNTdG9yZSBmcm9tIFwiLi4vZGF0YWJhc2UvcmVjb3JkL2F0dGFjaG1lbnRzL3N0b3JlLmpzXCJcbmltcG9ydCB0b0ltcG9ydFNwZWNpZmllciBmcm9tIFwiLi4vdXRpbHMvdG8taW1wb3J0LXNwZWNpZmllci5qc1wiXG5pbXBvcnQgeyB2YWxpZGF0ZVRpbWVab25lIH0gZnJvbSBcIi4uL3RpbWUtem9uZS5qc1wiXG5pbXBvcnQgQXR0YWNobWVudFBhdGhTb3VyY2UgZnJvbSBcIi4vbm9kZS9hdHRhY2htZW50LXBhdGgtc291cmNlLmpzXCJcbmltcG9ydCB7IGF1dG9tYXRpY1NoYXJlZFRyYW5zYWN0aW9uQnJva2VyT21pdHMsIGNyZWF0ZVNoYXJlZFRyYW5zYWN0aW9uUHJveHlEcml2ZXIsIHNoYXJlZFRyYW5zYWN0aW9uQnJva2VyQ29uZmlnIH0gZnJvbSBcIi4uL3Rlc3Rpbmcvc2hhcmVkLXRyYW5zYWN0aW9uLXByb3h5LWRyaXZlci5qc1wiXG5cbi8qKlxuICogRGVmaW5lcyB0aGlzIHR5cGVkZWYuXG4gKiBAdHlwZWRlZiB7e2FiaWxpdHk/OiBpbXBvcnQoXCIuLi9hdXRob3JpemF0aW9uL2FiaWxpdHkuanNcIikuZGVmYXVsdCwgb2Zmc2V0TWludXRlczogbnVtYmVyLCByZXF1ZXN0VGltaW5nPzogaW1wb3J0KFwiLi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3JlcXVlc3QtdGltaW5nLmpzXCIpLmRlZmF1bHQsIHRlbmFudD86IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCB0ZXN0UHJvZmlsZUNvbnRleHQ/OiBpbXBvcnQoXCIuLi90ZXN0aW5nL3Rlc3QtcHJvZmlsZXIuanNcIikuVGVzdFByb2ZpbGVBc3luY0NvbnRleHQsIHRpbWVab25lPzogc3RyaW5nfX0gVGltZXpvbmVTdG9yZSAqL1xuXG4vKipcbiAqIFJ1bnMgcGF0aCB3aXRoaW4gYWxsb3dlZCBwcmVmaXhlcy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBmaWxlUGF0aCAtIElucHV0IGZpbGUgcGF0aC5cbiAqIEBwYXJhbSB7c3RyaW5nW119IGFsbG93ZWRQYXRoUHJlZml4ZXMgLSBBbGxvd2VkIHBhdGggcHJlZml4ZXMuXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGlucHV0IHBhdGggaXMgaW5zaWRlIGFuIGFsbG93ZWQgcHJlZml4LlxuICovXG5mdW5jdGlvbiBwYXRoV2l0aGluQWxsb3dlZFByZWZpeGVzKGZpbGVQYXRoLCBhbGxvd2VkUGF0aFByZWZpeGVzKSB7XG4gIGNvbnN0IHJlc29sdmVkUGF0aCA9IHBhdGgucmVzb2x2ZShmaWxlUGF0aClcblxuICByZXR1cm4gYWxsb3dlZFBhdGhQcmVmaXhlcy5zb21lKChhbGxvd2VkUHJlZml4KSA9PiB7XG4gICAgY29uc3QgcmVzb2x2ZWRQcmVmaXggPSBwYXRoLnJlc29sdmUoYWxsb3dlZFByZWZpeClcbiAgICBjb25zdCByZWxhdGl2ZVBhdGggPSBwYXRoLnJlbGF0aXZlKHJlc29sdmVkUHJlZml4LCByZXNvbHZlZFBhdGgpXG5cbiAgICBpZiAoIXJlbGF0aXZlUGF0aCkgcmV0dXJuIHRydWVcbiAgICBpZiAocmVsYXRpdmVQYXRoLnN0YXJ0c1dpdGgoXCIuLlwiKSkgcmV0dXJuIGZhbHNlXG4gICAgaWYgKHBhdGguaXNBYnNvbHV0ZShyZWxhdGl2ZVBhdGgpKSByZXR1cm4gZmFsc2VcblxuICAgIHJldHVybiB0cnVlXG4gIH0pXG59XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0Vudmlyb25tZW50SGFuZGxlck5vZGUgZXh0ZW5kcyBCYXNle1xuICAvKipcbiAgICogQ3JlYXRlcyB0aGUgYnVpbHQtaW4gU1FMIHBlcnNpc3RlbmNlIGFkYXB0ZXIuXG4gICAqIEBwYXJhbSB7e2NvbmZpZ3VyYXRpb246IGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH19IGFyZ3MgLSBBZGFwdGVyIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtTcWxCYWNrZ3JvdW5kSm9ic0FkYXB0ZXJ9IC0gU1FMIGFkYXB0ZXIuXG4gICAqL1xuICBjcmVhdGVCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIoe2NvbmZpZ3VyYXRpb259KSB7XG4gICAgcmV0dXJuIG5ldyBTcWxCYWNrZ3JvdW5kSm9ic0FkYXB0ZXIoe2NvbmZpZ3VyYXRpb259KVxuICB9XG5cbiAgLyoqXG4gICAqIFByZXNlcnZlcyB0aGUgTm9kZSBUQ1AgcHJvZHVjZXIgYW5kIG1haW4tcHJvY2VzcyB3YWtlLXVwIHBhdGguIFRoZSBtYWluXG4gICAqIG93bnMgdGhlIGNvbmZpZ3VyZWQgcGVyc2lzdGVuY2UgYWRhcHRlcjsgTm9kZSBwcm9kdWNlcnMgbmV2ZXIgYnlwYXNzIGl0LlxuICAgKiBAcGFyYW0ge3tjb25maWd1cmF0aW9uOiBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9fSBhcmdzIC0gQ2xpZW50IG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9iYWNrZ3JvdW5kLWpvYnMvdHlwZXMuanNcIikuQmFja2dyb3VuZEpvYnNQcm9kdWNlcn0gLSBQcm9kdWNlciBjbGllbnQuXG4gICAqL1xuICBiYWNrZ3JvdW5kSm9ic0NsaWVudCh7Y29uZmlndXJhdGlvbn0pIHtcbiAgICByZXR1cm4gbmV3IEJhY2tncm91bmRKb2JzQ2xpZW50KHtjb25maWd1cmF0aW9ufSlcbiAgfVxuXG4gIC8qKlxuICAgKiBHaXZlcyBjb25jdXJyZW50IHNoYXJlZC10cmFuc2FjdGlvbiBjaGlsZCBqb2JzIGluZGVwZW5kZW50IHByb3h5IHNlc3Npb25zLlxuICAgKiBBIGNvbmZpZ3VyZWQgc2luZ2xlLWNvbm5lY3Rpb24gcG9vbCBzaGFyZXMgbXV0YWJsZSB0cmFuc2FjdGlvbiBzdGF0ZSBiZXR3ZWVuXG4gICAqIGFzeW5jIGpvYnMsIHdoaWxlIHRoZSBicm9rZXIgcmVxdWlyZXMgb25lIHJvb3QtdHJhbnNhY3Rpb24gbGVhc2UgcGVyIHNvY2tldC5cbiAgICogQHBhcmFtIHt7Y29uZmlndXJlZFBvb2xUeXBlOiB0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvcG9vbC9iYXNlLmpzXCIpLmRlZmF1bHQsIGRhdGFiYXNlSWRlbnRpZmllcjogc3RyaW5nfX0gYXJncyAtIENvbmZpZ3VyZWQgcG9vbCBhbmQgbG9naWNhbCBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcmV0dXJucyB7dHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3Bvb2wvYmFzZS5qc1wiKS5kZWZhdWx0fSAtIFBvb2wgdHlwZSBmb3IgdGhpcyBjb250ZXh0LlxuICAgKi9cbiAgcmVzb2x2ZVRlc3RTaGFyZWRUcmFuc2FjdGlvblBvb2xUeXBlKHtjb25maWd1cmVkUG9vbFR5cGUsIGRhdGFiYXNlSWRlbnRpZmllcn0pIHtcbiAgICBjb25zdCBkYXRhYmFzZUNvbmZpZ3VyYXRpb24gPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXREYXRhYmFzZUlkZW50aWZpZXIoZGF0YWJhc2VJZGVudGlmaWVyKVxuICAgIGlmIChkYXRhYmFzZUNvbmZpZ3VyYXRpb24udGVuYW50T25seSAmJiBhdXRvbWF0aWNTaGFyZWRUcmFuc2FjdGlvbkJyb2tlck9taXRzKGRhdGFiYXNlSWRlbnRpZmllcikpIHJldHVybiBjb25maWd1cmVkUG9vbFR5cGVcbiAgICBpZiAoIXNoYXJlZFRyYW5zYWN0aW9uQnJva2VyQ29uZmlnKGRhdGFiYXNlSWRlbnRpZmllcikpIHJldHVybiBjb25maWd1cmVkUG9vbFR5cGVcblxuICAgIHJldHVybiBBc3luY1RyYWNrZWRNdWx0aUNvbm5lY3Rpb25Qb29sXG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlcyB0aGUgZmlsZXN5c3RlbS1iYWNrZWQgYWR2aXNvcnktbG9jayBiYWNrZW5kIGZvciB0aGUgZmlsZSB0aWVyXG4gICAqIChTVEMtMjEzKS4gVGhlIE5vZGUgaGFuZGxlciBpcyB0aGUgb25seSBmaWxlc3lzdGVtLWNhcGFibGUgZW52aXJvbm1lbnQuXG4gICAqIEBwYXJhbSB7e2RpcmVjdG9yeTogc3RyaW5nLCBsZWFzZU1zOiBudW1iZXIsIHJlbmV3SW50ZXJ2YWxNczogbnVtYmVyfX0gYXJncyAtIEJhY2tlbmQgb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi4vZGF0YWJhc2UvYWR2aXNvcnktbG9jay1maWxlLWJhY2tlbmQuanNcIikuZGVmYXVsdD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY3JlYXRlZCBiYWNrZW5kLlxuICAgKi9cbiAgYXN5bmMgY3JlYXRlQWR2aXNvcnlMb2NrRmlsZUJhY2tlbmQoYXJncykge1xuICAgIHJldHVybiBuZXcgQWR2aXNvcnlMb2NrRmlsZUJhY2tlbmQoYXJncylcbiAgfVxuXG4gIC8qKlxuICAgKiBDcmVhdGVzIGEgdGVzdC1vbmx5IGNoaWxkIHByb3h5IHdoZW4gVGVzdFJ1bm5lciBzdXBwbGllZCBhbiBhY3RpdmUgYnJva2VyLlxuICAgKiBAcGFyYW0ge3tEcml2ZXJDbGFzczogdHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0LCBjb25maWc6IGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuRGF0YWJhc2VDb25maWd1cmF0aW9uVHlwZSwgY29uZmlndXJhdGlvbjogaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0LCBkYXRhYmFzZUlkZW50aWZpZXI6IHN0cmluZywgcmV1c2VLZXk/OiBzdHJpbmd9fSBhcmdzIC0gQ29ubmVjdGlvbiBkZXRhaWxzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZD59IC0gT3B0aW9uYWwgcHJveHkuXG4gICAqL1xuICBhc3luYyBjcmVhdGVUZXN0U2hhcmVkVHJhbnNhY3Rpb25Db25uZWN0aW9uKHtEcml2ZXJDbGFzcywgY29uZmlnLCBjb25maWd1cmF0aW9uLCBkYXRhYmFzZUlkZW50aWZpZXIsIHJldXNlS2V5fSkge1xuICAgIGlmIChjb25maWcudGVuYW50T25seSAmJiBhdXRvbWF0aWNTaGFyZWRUcmFuc2FjdGlvbkJyb2tlck9taXRzKGRhdGFiYXNlSWRlbnRpZmllcikpIHJldHVybiB1bmRlZmluZWRcbiAgICBjb25zdCBicm9rZXJDb25maWcgPSBzaGFyZWRUcmFuc2FjdGlvbkJyb2tlckNvbmZpZyhkYXRhYmFzZUlkZW50aWZpZXIpXG4gICAgaWYgKCFicm9rZXJDb25maWcpIHJldHVybiB1bmRlZmluZWRcbiAgICByZXR1cm4gY3JlYXRlU2hhcmVkVHJhbnNhY3Rpb25Qcm94eURyaXZlcihEcml2ZXJDbGFzcywgY29uZmlnLCBjb25maWd1cmF0aW9uLCBkYXRhYmFzZUlkZW50aWZpZXIsIHtcbiAgICAgIC4uLmJyb2tlckNvbmZpZyxcbiAgICAgIHJldXNlS2V5OiBicm9rZXJDb25maWcuYWxsb3dEeW5hbWljSWRlbnRpdGllcyA/IHJldXNlS2V5IDogdW5kZWZpbmVkXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBUaW1lem9uZSBhc3luYyBsb2NhbCBzdG9yYWdlLlxuICAgKiBAdHlwZSB7aW1wb3J0KFwibm9kZTphc3luY19ob29rc1wiKS5Bc3luY0xvY2FsU3RvcmFnZTxUaW1lem9uZVN0b3JlPiB8IHVuZGVmaW5lZH0gKi9cbiAgX3RpbWV6b25lQXN5bmNMb2NhbFN0b3JhZ2UgPSBOb2RlQXN5bmNMb2NhbFN0b3JhZ2UgPyBuZXcgTm9kZUFzeW5jTG9jYWxTdG9yYWdlKCkgOiB1bmRlZmluZWRcblxuICAvKipcbiAgICogU2hhcmVkLXRyYW5zYWN0aW9uIGNvb3JkaW5hdG9yIG93bmVyc2hpcCBieSBwaHlzaWNhbCBjb25uZWN0aW9uLlxuICAgKiBAdHlwZSB7aW1wb3J0KFwibm9kZTphc3luY19ob29rc1wiKS5Bc3luY0xvY2FsU3RvcmFnZTxNYXA8b2JqZWN0LCBzeW1ib2w+PiB8IHVuZGVmaW5lZH1cbiAgICovXG4gIF9zaGFyZWRUcmFuc2FjdGlvbkNvb3JkaW5hdG9yQXN5bmNMb2NhbFN0b3JhZ2UgPSBOb2RlQXN5bmNMb2NhbFN0b3JhZ2UgPyBuZXcgTm9kZUFzeW5jTG9jYWxTdG9yYWdlKCkgOiB1bmRlZmluZWRcblxuICAvKipcbiAgICogR2V0cyB0aGUgYWN0aXZlIHNoYXJlZC10cmFuc2FjdGlvbiBjb29yZGluYXRvciBvd25lciBmb3IgYSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gY29ubmVjdGlvbiAtIFBhcmVudCBwaHlzaWNhbCBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7c3ltYm9sIHwgdW5kZWZpbmVkfSAtIEFjdGl2ZSBjb29yZGluYXRvciBvd25lci5cbiAgICovXG4gIGdldFNoYXJlZFRyYW5zYWN0aW9uQ29vcmRpbmF0b3JPd25lcihjb25uZWN0aW9uKSB7XG4gICAgcmV0dXJuIHRoaXMuX3NoYXJlZFRyYW5zYWN0aW9uQ29vcmRpbmF0b3JBc3luY0xvY2FsU3RvcmFnZT8uZ2V0U3RvcmUoKT8uZ2V0KGNvbm5lY3Rpb24pXG4gIH1cblxuICAvKipcbiAgICogUnVucyB3b3JrIGFzIHRoZSBjdXJyZW50IHNoYXJlZC10cmFuc2FjdGlvbiBjb29yZGluYXRvciBvd25lci5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHtvYmplY3R9IGNvbm5lY3Rpb24gLSBQYXJlbnQgcGh5c2ljYWwgY29ubmVjdGlvbi5cbiAgICogQHBhcmFtIHtzeW1ib2x9IG93bmVyIC0gQ29vcmRpbmF0b3Igb3duZXIuXG4gICAqIEBwYXJhbSB7KCkgPT4gVH0gY2FsbGJhY2sgLSBPd25lZCB3b3JrLlxuICAgKiBAcmV0dXJucyB7VH0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBydW5XaXRoU2hhcmVkVHJhbnNhY3Rpb25Db29yZGluYXRvck93bmVyKGNvbm5lY3Rpb24sIG93bmVyLCBjYWxsYmFjaykge1xuICAgIGlmICghdGhpcy5fc2hhcmVkVHJhbnNhY3Rpb25Db29yZGluYXRvckFzeW5jTG9jYWxTdG9yYWdlKSByZXR1cm4gY2FsbGJhY2soKVxuXG4gICAgY29uc3Qgb3duZXJzID0gbmV3IE1hcCh0aGlzLl9zaGFyZWRUcmFuc2FjdGlvbkNvb3JkaW5hdG9yQXN5bmNMb2NhbFN0b3JhZ2UuZ2V0U3RvcmUoKSlcblxuICAgIG93bmVycy5zZXQoY29ubmVjdGlvbiwgb3duZXIpXG4gICAgcmV0dXJuIHRoaXMuX3NoYXJlZFRyYW5zYWN0aW9uQ29vcmRpbmF0b3JBc3luY0xvY2FsU3RvcmFnZS5ydW4ob3duZXJzLCBjYWxsYmFjaylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdvcmsgd2l0aG91dCBpbmhlcml0ZWQgc2hhcmVkLXRyYW5zYWN0aW9uIG93bmVyc2hpcCBmb3Igb25lIGNvbm5lY3Rpb24uXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGNvbm5lY3Rpb24gLSBQaHlzaWNhbCBjb25uZWN0aW9uIHdob3NlIG93bmVyIGlzIGNsZWFyZWQuXG4gICAqIEBwYXJhbSB7KCkgPT4gVH0gY2FsbGJhY2sgLSBQaHlzaWNhbCBjb25uZWN0aW9uIHdvcmsuXG4gICAqIEByZXR1cm5zIHtUfSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIHJ1bldpdGhvdXRTaGFyZWRUcmFuc2FjdGlvbkNvb3JkaW5hdG9yT3duZXIoY29ubmVjdGlvbiwgY2FsbGJhY2spIHtcbiAgICBpZiAoIXRoaXMuX3NoYXJlZFRyYW5zYWN0aW9uQ29vcmRpbmF0b3JBc3luY0xvY2FsU3RvcmFnZSkgcmV0dXJuIGNhbGxiYWNrKClcblxuICAgIGNvbnN0IG93bmVycyA9IG5ldyBNYXAodGhpcy5fc2hhcmVkVHJhbnNhY3Rpb25Db29yZGluYXRvckFzeW5jTG9jYWxTdG9yYWdlLmdldFN0b3JlKCkpXG5cbiAgICBvd25lcnMuZGVsZXRlKGNvbm5lY3Rpb24pXG4gICAgcmV0dXJuIHRoaXMuX3NoYXJlZFRyYW5zYWN0aW9uQ29vcmRpbmF0b3JBc3luY0xvY2FsU3RvcmFnZS5ydW4ob3duZXJzLCBjYWxsYmFjaylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdvcmsgd2l0aG91dCBpbmhlcml0ZWQgc2hhcmVkLXRyYW5zYWN0aW9uIGNvb3JkaW5hdG9yIG93bmVyc2hpcC5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHsoKSA9PiBUfSBjYWxsYmFjayAtIERldGFjaGVkIHdvcmsuXG4gICAqIEByZXR1cm5zIHtUfSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIHJ1bldpdGhvdXRTaGFyZWRUcmFuc2FjdGlvbkNvb3JkaW5hdG9yT3duZXJzKGNhbGxiYWNrKSB7XG4gICAgaWYgKCF0aGlzLl9zaGFyZWRUcmFuc2FjdGlvbkNvb3JkaW5hdG9yQXN5bmNMb2NhbFN0b3JhZ2UpIHJldHVybiBjYWxsYmFjaygpXG5cbiAgICByZXR1cm4gdGhpcy5fc2hhcmVkVHJhbnNhY3Rpb25Db29yZGluYXRvckFzeW5jTG9jYWxTdG9yYWdlLnJ1bihuZXcgTWFwKCksIGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd29yayB3aXRoIGFzeW5jLXNhZmUgdGVzdCBwcm9maWxlIGF0dHJpYnV0aW9uLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3Rlc3RpbmcvdGVzdC1wcm9maWxlci5qc1wiKS5UZXN0UHJvZmlsZUFzeW5jQ29udGV4dCB8IHVuZGVmaW5lZH0gY29udGV4dCAtIENhcHR1cmVkIHByb2ZpbGUgY29udGV4dCwgb3IgYW4gZXhwbGljaXQgYWJzZW5jZSBvZiBhdHRyaWJ1dGlvbi5cbiAgICogQHBhcmFtIHsoKSA9PiBUfSBjYWxsYmFjayAtIFByb2ZpbGVkIHdvcmsuXG4gICAqIEByZXR1cm5zIHtUfSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIHJ1bldpdGhUZXN0UHJvZmlsZUNvbnRleHQoY29udGV4dCwgY2FsbGJhY2spIHtcbiAgICBpZiAoIXRoaXMuX3RpbWV6b25lQXN5bmNMb2NhbFN0b3JhZ2UpIHJldHVybiBjYWxsYmFjaygpXG5cbiAgICBjb25zdCBleGlzdGluZ1N0b3JlID0gdGhpcy5fdGltZXpvbmVBc3luY0xvY2FsU3RvcmFnZS5nZXRTdG9yZSgpXG5cbiAgICByZXR1cm4gdGhpcy5fdGltZXpvbmVBc3luY0xvY2FsU3RvcmFnZS5ydW4oe1xuICAgICAgYWJpbGl0eTogZXhpc3RpbmdTdG9yZT8uYWJpbGl0eSxcbiAgICAgIG9mZnNldE1pbnV0ZXM6IGV4aXN0aW5nU3RvcmU/Lm9mZnNldE1pbnV0ZXMgPz8gdGhpcy5nZXRUaW1lem9uZU9mZnNldE1pbnV0ZXModGhpcy5nZXRDb25maWd1cmF0aW9uKCkpLFxuICAgICAgcmVxdWVzdFRpbWluZzogZXhpc3RpbmdTdG9yZT8ucmVxdWVzdFRpbWluZyxcbiAgICAgIHRlbmFudDogZXhpc3RpbmdTdG9yZT8udGVuYW50LFxuICAgICAgdGVzdFByb2ZpbGVDb250ZXh0OiBjb250ZXh0LFxuICAgICAgdGltZVpvbmU6IGV4aXN0aW5nU3RvcmU/LnRpbWVab25lID8/IHRoaXMuZ2V0VGltZVpvbmUodGhpcy5nZXRDb25maWd1cmF0aW9uKCkpXG4gICAgfSwgY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogR2V0cyB0aGUgY3VycmVudCBhc3luYy1zYWZlIHRlc3QgcHJvZmlsZSBhdHRyaWJ1dGlvbiBjb250ZXh0LlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vdGVzdGluZy90ZXN0LXByb2ZpbGVyLmpzXCIpLlRlc3RQcm9maWxlQXN5bmNDb250ZXh0IHwgdW5kZWZpbmVkfSAtIEN1cnJlbnQgY29udGV4dC5cbiAgICovXG4gIGdldEN1cnJlbnRUZXN0UHJvZmlsZUNvbnRleHQoKSB7XG4gICAgcmV0dXJuIHRoaXMuX3RpbWV6b25lQXN5bmNMb2NhbFN0b3JhZ2U/LmdldFN0b3JlKCk/LnRlc3RQcm9maWxlQ29udGV4dFxuICB9XG5cbiAgLyoqXG4gICAqIEZpbmQgY29tbWFuZHMgcmVzdWx0LlxuICAgKiBAdHlwZSB7aW1wb3J0KFwiLi9iYXNlLmpzXCIpLkNvbW1hbmRGaWxlT2JqZWN0VHlwZVtdIHwgdW5kZWZpbmVkfSAqL1xuICBfZmluZENvbW1hbmRzUmVzdWx0ID0gdW5kZWZpbmVkXG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVidWcgZW5kcG9pbnQgdG9rZW4gbWF0Y2hlcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHByb3ZpZGVkVG9rZW4gLSBUb2tlbiBmcm9tIHRoZSByZXF1ZXN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZXhwZWN0ZWRUb2tlbiAtIENvbmZpZ3VyZWQgdG9rZW4uXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgYm90aCB0b2tlbnMgbWF0Y2guXG4gICAqL1xuICBkZWJ1Z0VuZHBvaW50VG9rZW5NYXRjaGVzKHByb3ZpZGVkVG9rZW4sIGV4cGVjdGVkVG9rZW4pIHtcbiAgICBjb25zdCBwcm92aWRlZCA9IEJ1ZmZlci5mcm9tKHByb3ZpZGVkVG9rZW4pXG4gICAgY29uc3QgZXhwZWN0ZWQgPSBCdWZmZXIuZnJvbShleHBlY3RlZFRva2VuKVxuXG4gICAgcmV0dXJuIHByb3ZpZGVkLmxlbmd0aCA9PT0gZXhwZWN0ZWQubGVuZ3RoICYmIHRpbWluZ1NhZmVFcXVhbChwcm92aWRlZCwgZXhwZWN0ZWQpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZnJhbWV3b3JrIHNvdXJjZSBkaXJlY3RvcnkuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gVmVsb2Npb3VzIHNvdXJjZSBkaXJlY3RvcnkgdXNlZCB0byBmaWx0ZXIgZnJhbWV3b3JrIHN0YWNrIGZyYW1lcy5cbiAgICovXG4gIGdldEZyYW1ld29ya1NvdXJjZURpcmVjdG9yeSgpIHtcbiAgICByZXR1cm4gRlJBTUVXT1JLX1NPVVJDRV9ESVJFQ1RPUllcbiAgfVxuXG4gIC8qKlxuICAgKiBBdXRvLWRpc2NvdmVycyByZXNvdXJjZSBjbGFzc2VzIGZyb20gc3JjL3Jlc291cmNlcy8gaW4gZWFjaCBiYWNrZW5kIHByb2plY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBjb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBhdXRvRGlzY292ZXJSZXNvdXJjZXMoY29uZmlndXJhdGlvbikge1xuICAgIGNvbnN0IHtmcm9udGVuZE1vZGVsUmVzb3VyY2VEZWZpbml0aW9uSXNDbGFzc30gPSBhd2FpdCBpbXBvcnQoXCIuLi9mcm9udGVuZC1tb2RlbHMvcmVzb3VyY2UtZGVmaW5pdGlvbi5qc1wiKVxuICAgIGNvbnN0IHtkZWZhdWx0OiBBdXRob3JpemF0aW9uQmFzZVJlc291cmNlfSA9IGF3YWl0IGltcG9ydChcIi4uL2F1dGhvcml6YXRpb24vYmFzZS1yZXNvdXJjZS5qc1wiKVxuICAgIGNvbnN0IGJhY2tlbmRQcm9qZWN0cyA9IGNvbmZpZ3VyYXRpb24uZ2V0QmFja2VuZFByb2plY3RzKClcblxuICAgIGZvciAoY29uc3QgYmFja2VuZFByb2plY3Qgb2YgYmFja2VuZFByb2plY3RzKSB7XG4gICAgICBpZiAoYmFja2VuZFByb2plY3QuYWJpbGl0eVJlc291cmNlcykgY29udGludWVcblxuICAgICAgY29uc3QgcmVzb3VyY2VzRGlyID0gYmFja2VuZFByb2plY3QucmVzb3VyY2VzUGF0aCB8fCBwYXRoLmpvaW4oYmFja2VuZFByb2plY3QucGF0aCwgXCJzcmNcIiwgXCJyZXNvdXJjZXNcIilcbiAgICAgIGxldCBmaWxlc1xuXG4gICAgICB0cnkge1xuICAgICAgICBmaWxlcyA9IGF3YWl0IGZzLnJlYWRkaXIocmVzb3VyY2VzRGlyKVxuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIC8qKlxuICAgICAgICogRGlzY292ZXJlZCBmcm9udGVuZC1tb2RlbCByZXNvdXJjZXMga2V5ZWQgYnkgbW9kZWwgbmFtZS5cbiAgICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgICBjb25zdCBkaXNjb3ZlcmVkID0ge31cbiAgICAgIC8qKlxuICAgICAgICogRXZlcnkgZGlzY292ZXJlZCBhYmlsaXR5IHJlc291cmNlIGNsYXNzIChmcm9udGVuZC1tb2RlbCBhbmQgYXV0aG9yaXphdGlvbikuXG4gICAgICAgKiBAdHlwZSB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgICAgY29uc3QgYWJpbGl0eVJlc291cmNlQ2xhc3NlcyA9IFtdXG5cbiAgICAgIGZvciAoY29uc3QgZmlsZSBvZiBmaWxlcykge1xuICAgICAgICBpZiAoIWZpbGUuZW5kc1dpdGgoXCIuanNcIikgJiYgIWZpbGUuZW5kc1dpdGgoXCIubWpzXCIpKSBjb250aW51ZVxuICAgICAgICBpZiAoZmlsZS5zdGFydHNXaXRoKFwiZnJvbnRlbmQtbW9kZWwtcmVzb3VyY2VzXCIpKSBjb250aW51ZVxuXG4gICAgICAgIGNvbnN0IGZpbGVQYXRoID0gcGF0aC5qb2luKHJlc291cmNlc0RpciwgZmlsZSlcbiAgICAgICAgY29uc3QgaW1wb3J0ZWQgPSBhd2FpdCBpbXBvcnQoZmlsZVBhdGgpXG4gICAgICAgIGNvbnN0IFJlc291cmNlQ2xhc3MgPSBpbXBvcnRlZC5kZWZhdWx0XG5cbiAgICAgICAgLy8gQW55IGF1dGhvcml6YXRpb24gcmVzb3VyY2UgKGZyb250ZW5kLW1vZGVsIHJlc291cmNlcyBhbHNvIGV4dGVuZCBpdCkgdGhhdFxuICAgICAgICAvLyBkZWNsYXJlcyBhIGBNb2RlbENsYXNzYDsgc2tpcCBhYnN0cmFjdC9jb21tb24gYmFzZSByZXNvdXJjZXMgd2l0aG91dCBvbmUuXG4gICAgICAgIGNvbnN0IGlzQWJpbGl0eVJlc291cmNlID0gdHlwZW9mIFJlc291cmNlQ2xhc3MgPT09IFwiZnVuY3Rpb25cIlxuICAgICAgICAgICYmIChSZXNvdXJjZUNsYXNzID09PSBBdXRob3JpemF0aW9uQmFzZVJlc291cmNlIHx8IFJlc291cmNlQ2xhc3MucHJvdG90eXBlIGluc3RhbmNlb2YgQXV0aG9yaXphdGlvbkJhc2VSZXNvdXJjZSlcblxuICAgICAgICBpZiAoIWlzQWJpbGl0eVJlc291cmNlIHx8ICFSZXNvdXJjZUNsYXNzLk1vZGVsQ2xhc3MpIGNvbnRpbnVlXG5cbiAgICAgICAgYWJpbGl0eVJlc291cmNlQ2xhc3Nlcy5wdXNoKFJlc291cmNlQ2xhc3MpXG5cbiAgICAgICAgLy8gT25seSBmcm9udGVuZC1tb2RlbCByZXNvdXJjZXMgZHJpdmUgcm91dGluZy9nZW5lcmF0aW9uL3B1Ymxpc2hlciBkaXNjb3ZlcnkuXG4gICAgICAgIGlmICghZnJvbnRlbmRNb2RlbFJlc291cmNlRGVmaW5pdGlvbklzQ2xhc3MoUmVzb3VyY2VDbGFzcykpIGNvbnRpbnVlXG5cbiAgICAgICAgY29uc3QgYmFzZU5hbWUgPSBmaWxlLnJlcGxhY2UoL1xcLihqc3xtanMpJC8sIFwiXCIpXG4gICAgICAgIGNvbnN0IG1vZGVsTmFtZSA9IGJhc2VOYW1lLnJlcGxhY2UoLy1yZXNvdXJjZSQvLCBcIlwiKVxuICAgICAgICAgIC5zcGxpdChcIi1cIilcbiAgICAgICAgICAubWFwKCgvKiogQHR5cGUge3N0cmluZ30gKi8gcGFydCkgPT4gcGFydC5jaGFyQXQoMCkudG9VcHBlckNhc2UoKSArIHBhcnQuc2xpY2UoMSkpXG4gICAgICAgICAgLmpvaW4oXCJcIilcblxuICAgICAgICBkaXNjb3ZlcmVkW21vZGVsTmFtZV0gPSBSZXNvdXJjZUNsYXNzXG4gICAgICB9XG5cbiAgICAgIGlmICghYmFja2VuZFByb2plY3QuZnJvbnRlbmRNb2RlbHMgJiYgT2JqZWN0LmtleXMoZGlzY292ZXJlZCkubGVuZ3RoID4gMCkge1xuICAgICAgICBiYWNrZW5kUHJvamVjdC5mcm9udGVuZE1vZGVscyA9IGRpc2NvdmVyZWRcbiAgICAgIH1cblxuICAgICAgaWYgKGFiaWxpdHlSZXNvdXJjZUNsYXNzZXMubGVuZ3RoID4gMCkge1xuICAgICAgICBiYWNrZW5kUHJvamVjdC5hYmlsaXR5UmVzb3VyY2VzID0gYWJpbGl0eVJlc291cmNlQ2xhc3Nlc1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBMb2FkcyBtb2RlbHMgY29udHJpYnV0ZWQgYnkgcmVnaXN0ZXJlZCBwYWNrYWdlcyBpbnRvIHRoZSBtb2RlbCByZWdpc3RyeSxcbiAgICogYWZ0ZXIgdGhlIGFwcCdzIG93biBgaW5pdGlhbGl6ZU1vZGVsc2AgaG9vay4gQSBwYWNrYWdlIHdob3NlIG1vZGVscyBkaXJlY3RvcnlcbiAgICogaXMgYWJzZW50IGlzIHNraXBwZWQ7IGEgcGFja2FnZSBtb2RlbCB3aG9zZSBuYW1lIGNvbGxpZGVzIHdpdGggYW5cbiAgICogYWxyZWFkeS1yZWdpc3RlcmVkIGRpZmZlcmVudCBjbGFzcyB0aHJvd3MuIE5vZGUtb25seSAodXNlcyB0aGUgZmlsZXN5c3RlbSksIHNvXG4gICAqIGl0IGxpdmVzIGhlcmUgcmF0aGVyIHRoYW4gaW4gdGhlIGJyb3dzZXItYnVuZGxlZCBDb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBpbml0aWFsaXplUGFja2FnZU1vZGVscyhjb25maWd1cmF0aW9uKSB7XG4gICAgZm9yIChjb25zdCB2ZWxvY2lvdXNQYWNrYWdlIG9mIGNvbmZpZ3VyYXRpb24uZ2V0UGFja2FnZXMoKSkge1xuICAgICAgY29uc3QgbW9kZWxzUGF0aCA9IHZlbG9jaW91c1BhY2thZ2UuZ2V0TW9kZWxzUGF0aCgpXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IGZzLmFjY2Vzcyhtb2RlbHNQYXRoKVxuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHBhY2thZ2VSZXF1aXJlQ29udGV4dCA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvaW5pdGlhbGl6ZXItZnJvbS1yZXF1aXJlLWNvbnRleHQuanNcIikuTW9kZWxDbGFzc1JlcXVpcmVDb250ZXh0VHlwZX0gKi8gKHJlcXVpcmVDb250ZXh0KG1vZGVsc1BhdGgsIHRydWUsIC9eKC4rKVxcLmpzJC8pKVxuICAgICAgY29uc3QgbW9kZWxDbGFzc2VzID0gY29uZmlndXJhdGlvbi5nZXRNb2RlbENsYXNzZXMoKVxuXG4gICAgICBmb3IgKGNvbnN0IGZpbGVOYW1lIG9mIHBhY2thZ2VSZXF1aXJlQ29udGV4dC5rZXlzKCkpIHtcbiAgICAgICAgY29uc3QgbW9kZWxDbGFzcyA9IHBhY2thZ2VSZXF1aXJlQ29udGV4dChmaWxlTmFtZSk/LmRlZmF1bHRcbiAgICAgICAgY29uc3QgZXhpc3RpbmcgPSBtb2RlbENsYXNzICYmIG1vZGVsQ2xhc3Nlc1ttb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpXVxuXG4gICAgICAgIGlmIChleGlzdGluZyAmJiBleGlzdGluZyAhPT0gbW9kZWxDbGFzcykge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgUGFja2FnZSBcIiR7dmVsb2Npb3VzUGFja2FnZS5nZXROYW1lKCl9XCIgbW9kZWwgXCIke21vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCl9XCIgY29sbGlkZXMgd2l0aCBhbiBhbHJlYWR5LXJlZ2lzdGVyZWQgbW9kZWwuYClcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBhd2FpdCBjb25maWd1cmF0aW9uLmVuc3VyZUNvbm5lY3Rpb25zKHtuYW1lOiBgSW5pdGlhbGl6ZSAke3ZlbG9jaW91c1BhY2thZ2UuZ2V0TmFtZSgpfSBwYWNrYWdlIG1vZGVsc2B9LCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IG5ldyBJbml0aWFsaXplckZyb21SZXF1aXJlQ29udGV4dCh7cmVxdWlyZUNvbnRleHQ6IHBhY2thZ2VSZXF1aXJlQ29udGV4dH0pLmluaXRpYWxpemUoe2NvbmZpZ3VyYXRpb259KVxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgY29uZmlndXJhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IG5ld0NvbmZpZ3VyYXRpb24gLSBOZXcgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0Q29uZmlndXJhdGlvbihuZXdDb25maWd1cmF0aW9uKSB7XG4gICAgc3VwZXIuc2V0Q29uZmlndXJhdGlvbihuZXdDb25maWd1cmF0aW9uKVxuXG4gICAgaWYgKCFuZXdDb25maWd1cmF0aW9uLmdldFJvdXRlUmVzb2x2ZXJIb29rcygpLmluY2x1ZGVzKGZyb250ZW5kTW9kZWxDb21tYW5kUm91dGVIb29rKSkge1xuICAgICAgbmV3Q29uZmlndXJhdGlvbi5hZGRSb3V0ZVJlc29sdmVySG9vayhmcm9udGVuZE1vZGVsQ29tbWFuZFJvdXRlSG9vaylcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWFkIGF0dGFjaG1lbnQgaW5wdXQgZmlsZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGZpbGVQYXRoIC0gRmlsZSBwYXRoLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxCdWZmZXI+fSAtIEZpbGUgYnl0ZXMuXG4gICAqL1xuICBhc3luYyByZWFkQXR0YWNobWVudElucHV0RmlsZShmaWxlUGF0aCkge1xuICAgIHJldHVybiBhd2FpdCBmcy5yZWFkRmlsZShmaWxlUGF0aClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlc29sdmUgYXR0YWNobWVudCBpbnB1dCBwYXRoLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGFyZ3MuYWxsb3dlZFBhdGhQcmVmaXhlcyAtIEFsbG93ZWQgcGF0aCBwcmVmaXhlcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuaW5wdXRQYXRoIC0gSW5wdXQgcGF0aC5cbiAgICogQHJldHVybnMge1Byb21pc2U8QXR0YWNobWVudFBhdGhTb3VyY2U+fSAtIE9wZW5lZCByZWd1bGFyLWZpbGUgcGF0aCBzb3VyY2UuXG4gICAqL1xuICBhc3luYyByZXNvbHZlQXR0YWNobWVudElucHV0UGF0aCh7YWxsb3dlZFBhdGhQcmVmaXhlcywgaW5wdXRQYXRofSkge1xuICAgIGNvbnN0IGZpbGVQYXRoID0gcGF0aC5yZXNvbHZlKGlucHV0UGF0aClcbiAgICBjb25zdCBwcmVmaXhlcyA9IEFycmF5LmlzQXJyYXkoYWxsb3dlZFBhdGhQcmVmaXhlcylcbiAgICAgID8gYWxsb3dlZFBhdGhQcmVmaXhlcy5maWx0ZXIoKGVudHJ5KSA9PiB0eXBlb2YgZW50cnkgPT09IFwic3RyaW5nXCIgJiYgZW50cnkubGVuZ3RoID4gMClcbiAgICAgIDogW11cblxuICAgIGlmIChwcmVmaXhlcy5sZW5ndGggPiAwICYmICFwYXRoV2l0aGluQWxsb3dlZFByZWZpeGVzKGZpbGVQYXRoLCBwcmVmaXhlcykpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkF0dGFjaG1lbnQgcGF0aCBpcyBvdXRzaWRlIGFsbG93ZWQgZGlyZWN0b3JpZXNcIilcbiAgICB9XG5cbiAgICBjb25zdCBmaWxlSGFuZGxlID0gYXdhaXQgZnMub3BlbihmaWxlUGF0aCwgXCJyXCIpXG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgZmlsZVN0YXRzID0gYXdhaXQgZmlsZUhhbmRsZS5zdGF0KClcblxuICAgICAgaWYgKCFmaWxlU3RhdHMuaXNGaWxlKCkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQXR0YWNobWVudCBwYXRoIG11c3QgcmVmZXJlbmNlIGEgcmVndWxhciBmaWxlXCIpXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBuZXcgQXR0YWNobWVudFBhdGhTb3VyY2Uoe1xuICAgICAgICBieXRlU2l6ZTogZmlsZVN0YXRzLnNpemUsXG4gICAgICAgIGZpbGVIYW5kbGUsXG4gICAgICAgIGZpbGVQYXRoXG4gICAgICB9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCBmaWxlSGFuZGxlLmNsb3NlKClcbiAgICAgIH0gY2F0Y2ggKGNsb3NlRXJyb3IpIHtcbiAgICAgICAgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKFxuICAgICAgICAgIFtlcnJvciwgY2xvc2VFcnJvcl0sXG4gICAgICAgICAgYEF0dGFjaG1lbnQgcGF0aCB2YWxpZGF0aW9uIGFuZCBzb3VyY2UgY2xvc2UgYm90aCBmYWlsZWQgZm9yICR7ZmlsZVBhdGh9YCxcbiAgICAgICAgICB7Y2F1c2U6IGNsb3NlRXJyb3J9XG4gICAgICAgIClcbiAgICAgIH1cblxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5kIGNvbW1hbmRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcnJheTxpbXBvcnQoXCIuL2Jhc2UuanNcIikuQ29tbWFuZEZpbGVPYmplY3RUeXBlPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY29tbWFuZHMuXG4gICAqL1xuICBhc3luYyBmaW5kQ29tbWFuZHMoKSB7XG4gICAgdGhpcy5fZmluZENvbW1hbmRzUmVzdWx0IHx8PSBhd2FpdCB0aGlzLl9hY3R1YWxGaW5kQ29tbWFuZHMoKVxuXG4gICAgaWYgKCF0aGlzLl9maW5kQ29tbWFuZHNSZXN1bHQpIHRocm93IG5ldyBFcnJvcihcIkNvdWxkIG5vdCBnZXQgY29tbWFuZHNcIilcblxuICAgIHJldHVybiB0aGlzLl9maW5kQ29tbWFuZHNSZXN1bHRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1biB3aXRoIHRpbWV6b25lIG9mZnNldC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IG9mZnNldE1pbnV0ZXMgLSBPZmZzZXQgaW4gbWludXRlcyAoRGF0ZSNnZXRUaW1lem9uZU9mZnNldCkuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgdG8gcnVuLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzdWx0IG9mIHRoZSBjYWxsYmFjay5cbiAgICovXG4gIGFzeW5jIHJ1bldpdGhUaW1lem9uZU9mZnNldChvZmZzZXRNaW51dGVzLCBjYWxsYmFjaykge1xuICAgIGlmICghdGhpcy5fdGltZXpvbmVBc3luY0xvY2FsU3RvcmFnZSkge1xuICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKClcbiAgICB9XG5cbiAgICBjb25zdCBleGlzdGluZ1N0b3JlID0gdGhpcy5fdGltZXpvbmVBc3luY0xvY2FsU3RvcmFnZS5nZXRTdG9yZSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fdGltZXpvbmVBc3luY0xvY2FsU3RvcmFnZS5ydW4oe1xuICAgICAgYWJpbGl0eTogZXhpc3RpbmdTdG9yZT8uYWJpbGl0eSxcbiAgICAgIG9mZnNldE1pbnV0ZXMsXG4gICAgICByZXF1ZXN0VGltaW5nOiBleGlzdGluZ1N0b3JlPy5yZXF1ZXN0VGltaW5nLFxuICAgICAgdGVuYW50OiBleGlzdGluZ1N0b3JlPy50ZW5hbnQsXG4gICAgICB0ZXN0UHJvZmlsZUNvbnRleHQ6IGV4aXN0aW5nU3RvcmU/LnRlc3RQcm9maWxlQ29udGV4dCxcbiAgICAgIHRpbWVab25lOiBleGlzdGluZ1N0b3JlPy50aW1lWm9uZSA/PyB0aGlzLmdldFRpbWVab25lKHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpKVxuICAgIH0sIGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcnVuIHdpdGggdGltZXpvbmUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0aW1lWm9uZSAtIElBTkEgdGltZXpvbmUgaWRlbnRpZmllci5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY2FsbGJhY2sgLSBDYWxsYmFjayB0byBydW4uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXN1bHQgb2YgdGhlIGNhbGxiYWNrLlxuICAgKi9cbiAgYXN5bmMgcnVuV2l0aFRpbWV6b25lKHRpbWVab25lLCBjYWxsYmFjaykge1xuICAgIGlmICghdGhpcy5fdGltZXpvbmVBc3luY0xvY2FsU3RvcmFnZSkge1xuICAgICAgcmV0dXJuIGF3YWl0IHN1cGVyLnJ1bldpdGhUaW1lem9uZSh0aW1lWm9uZSwgY2FsbGJhY2spXG4gICAgfVxuXG4gICAgY29uc3QgZXhpc3RpbmdTdG9yZSA9IHRoaXMuX3RpbWV6b25lQXN5bmNMb2NhbFN0b3JhZ2UuZ2V0U3RvcmUoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3RpbWV6b25lQXN5bmNMb2NhbFN0b3JhZ2UucnVuKHtcbiAgICAgIGFiaWxpdHk6IGV4aXN0aW5nU3RvcmU/LmFiaWxpdHksXG4gICAgICBvZmZzZXRNaW51dGVzOiBleGlzdGluZ1N0b3JlPy5vZmZzZXRNaW51dGVzID8/IHRoaXMuZ2V0VGltZXpvbmVPZmZzZXRNaW51dGVzKHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpKSxcbiAgICAgIHJlcXVlc3RUaW1pbmc6IGV4aXN0aW5nU3RvcmU/LnJlcXVlc3RUaW1pbmcsXG4gICAgICB0ZW5hbnQ6IGV4aXN0aW5nU3RvcmU/LnRlbmFudCxcbiAgICAgIHRlc3RQcm9maWxlQ29udGV4dDogZXhpc3RpbmdTdG9yZT8udGVzdFByb2ZpbGVDb250ZXh0LFxuICAgICAgdGltZVpvbmU6IHZhbGlkYXRlVGltZVpvbmUodGltZVpvbmUsIFwidGltZVpvbmVcIilcbiAgICB9LCBjYWxsYmFjaylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCB0aW1lem9uZSBvZmZzZXQuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBvZmZzZXRNaW51dGVzIC0gT2Zmc2V0IGluIG1pbnV0ZXMgKERhdGUjZ2V0VGltZXpvbmVPZmZzZXQpLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRUaW1lem9uZU9mZnNldChvZmZzZXRNaW51dGVzKSB7XG4gICAgaWYgKCF0aGlzLl90aW1lem9uZUFzeW5jTG9jYWxTdG9yYWdlKSByZXR1cm5cblxuICAgIGNvbnN0IHN0b3JlID0gdGhpcy5fdGltZXpvbmVBc3luY0xvY2FsU3RvcmFnZS5nZXRTdG9yZSgpXG5cbiAgICBpZiAoc3RvcmUpIHtcbiAgICAgIHN0b3JlLm9mZnNldE1pbnV0ZXMgPSBvZmZzZXRNaW51dGVzXG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IGV4aXN0aW5nU3RvcmUgPSB0aGlzLl90aW1lem9uZUFzeW5jTG9jYWxTdG9yYWdlLmdldFN0b3JlKClcblxuICAgICAgdGhpcy5fdGltZXpvbmVBc3luY0xvY2FsU3RvcmFnZS5lbnRlcldpdGgoe1xuICAgICAgICBhYmlsaXR5OiBleGlzdGluZ1N0b3JlPy5hYmlsaXR5LFxuICAgICAgICBvZmZzZXRNaW51dGVzLFxuICAgICAgICByZXF1ZXN0VGltaW5nOiBleGlzdGluZ1N0b3JlPy5yZXF1ZXN0VGltaW5nLFxuICAgICAgICB0ZW5hbnQ6IGV4aXN0aW5nU3RvcmU/LnRlbmFudCxcbiAgICAgICAgdGVzdFByb2ZpbGVDb250ZXh0OiBleGlzdGluZ1N0b3JlPy50ZXN0UHJvZmlsZUNvbnRleHQsXG4gICAgICAgIHRpbWVab25lOiBleGlzdGluZ1N0b3JlPy50aW1lWm9uZSA/PyB0aGlzLmdldFRpbWVab25lKHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpKVxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgdGltZXpvbmUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0aW1lWm9uZSAtIElBTkEgdGltZXpvbmUgaWRlbnRpZmllci5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0VGltZXpvbmUodGltZVpvbmUpIHtcbiAgICBpZiAoIXRoaXMuX3RpbWV6b25lQXN5bmNMb2NhbFN0b3JhZ2UpIHtcbiAgICAgIHN1cGVyLnNldFRpbWV6b25lKHRpbWVab25lKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3Qgbm9ybWFsaXplZFRpbWVab25lID0gdmFsaWRhdGVUaW1lWm9uZSh0aW1lWm9uZSwgXCJ0aW1lWm9uZVwiKVxuICAgIGNvbnN0IHN0b3JlID0gdGhpcy5fdGltZXpvbmVBc3luY0xvY2FsU3RvcmFnZS5nZXRTdG9yZSgpXG5cbiAgICBpZiAoc3RvcmUpIHtcbiAgICAgIHN0b3JlLnRpbWVab25lID0gbm9ybWFsaXplZFRpbWVab25lXG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IGV4aXN0aW5nU3RvcmUgPSB0aGlzLl90aW1lem9uZUFzeW5jTG9jYWxTdG9yYWdlLmdldFN0b3JlKClcblxuICAgICAgdGhpcy5fdGltZXpvbmVBc3luY0xvY2FsU3RvcmFnZS5lbnRlcldpdGgoe1xuICAgICAgICBhYmlsaXR5OiBleGlzdGluZ1N0b3JlPy5hYmlsaXR5LFxuICAgICAgICBvZmZzZXRNaW51dGVzOiBleGlzdGluZ1N0b3JlPy5vZmZzZXRNaW51dGVzID8/IHRoaXMuZ2V0VGltZXpvbmVPZmZzZXRNaW51dGVzKHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpKSxcbiAgICAgICAgcmVxdWVzdFRpbWluZzogZXhpc3RpbmdTdG9yZT8ucmVxdWVzdFRpbWluZyxcbiAgICAgICAgdGVuYW50OiBleGlzdGluZ1N0b3JlPy50ZW5hbnQsXG4gICAgICAgIHRlc3RQcm9maWxlQ29udGV4dDogZXhpc3RpbmdTdG9yZT8udGVzdFByb2ZpbGVDb250ZXh0LFxuICAgICAgICB0aW1lWm9uZTogbm9ybWFsaXplZFRpbWVab25lXG4gICAgICB9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0aW1lem9uZSBvZmZzZXQgbWludXRlcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IGNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIE9mZnNldCBpbiBtaW51dGVzLlxuICAgKi9cbiAgZ2V0VGltZXpvbmVPZmZzZXRNaW51dGVzKGNvbmZpZ3VyYXRpb24pIHtcbiAgICBpZiAodGhpcy5fdGltZXpvbmVBc3luY0xvY2FsU3RvcmFnZSkge1xuICAgICAgY29uc3Qgc3RvcmUgPSB0aGlzLl90aW1lem9uZUFzeW5jTG9jYWxTdG9yYWdlLmdldFN0b3JlKClcblxuICAgICAgaWYgKHN0b3JlICYmIHR5cGVvZiBzdG9yZS5vZmZzZXRNaW51dGVzID09PSBcIm51bWJlclwiKSB7XG4gICAgICAgIHJldHVybiBzdG9yZS5vZmZzZXRNaW51dGVzXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHN1cGVyLmdldFRpbWV6b25lT2Zmc2V0TWludXRlcyhjb25maWd1cmF0aW9uKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRpbWV6b25lLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gVGltZXpvbmUgaWRlbnRpZmllci5cbiAgICovXG4gIGdldFRpbWVab25lKGNvbmZpZ3VyYXRpb24pIHtcbiAgICBpZiAodGhpcy5fdGltZXpvbmVBc3luY0xvY2FsU3RvcmFnZSkge1xuICAgICAgY29uc3Qgc3RvcmUgPSB0aGlzLl90aW1lem9uZUFzeW5jTG9jYWxTdG9yYWdlLmdldFN0b3JlKClcblxuICAgICAgaWYgKHN0b3JlICYmIHR5cGVvZiBzdG9yZS50aW1lWm9uZSA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgICByZXR1cm4gc3RvcmUudGltZVpvbmVcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gc3VwZXIuZ2V0VGltZVpvbmUoY29uZmlndXJhdGlvbilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1biB3aXRoIGFiaWxpdHkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IGFiaWxpdHkgLSBBYmlsaXR5IHRvIHNldCBmb3IgY2FsbGJhY2sgc2NvcGUuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGNhbGxiYWNrIC0gQ2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBydW5XaXRoQWJpbGl0eShhYmlsaXR5LCBjYWxsYmFjaykge1xuICAgIGlmICghdGhpcy5fdGltZXpvbmVBc3luY0xvY2FsU3RvcmFnZSkge1xuICAgICAgcmV0dXJuIGF3YWl0IHN1cGVyLnJ1bldpdGhBYmlsaXR5KGFiaWxpdHksIGNhbGxiYWNrKVxuICAgIH1cblxuICAgIGNvbnN0IGV4aXN0aW5nU3RvcmUgPSB0aGlzLl90aW1lem9uZUFzeW5jTG9jYWxTdG9yYWdlLmdldFN0b3JlKClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl90aW1lem9uZUFzeW5jTG9jYWxTdG9yYWdlLnJ1bih7XG4gICAgICBhYmlsaXR5LFxuICAgICAgb2Zmc2V0TWludXRlczogZXhpc3RpbmdTdG9yZT8ub2Zmc2V0TWludXRlcyA/PyB0aGlzLmdldFRpbWV6b25lT2Zmc2V0TWludXRlcyh0aGlzLmdldENvbmZpZ3VyYXRpb24oKSksXG4gICAgICByZXF1ZXN0VGltaW5nOiBleGlzdGluZ1N0b3JlPy5yZXF1ZXN0VGltaW5nLFxuICAgICAgdGVuYW50OiBleGlzdGluZ1N0b3JlPy50ZW5hbnQsXG4gICAgICB0ZXN0UHJvZmlsZUNvbnRleHQ6IGV4aXN0aW5nU3RvcmU/LnRlc3RQcm9maWxlQ29udGV4dCxcbiAgICAgIHRpbWVab25lOiBleGlzdGluZ1N0b3JlPy50aW1lWm9uZSA/PyB0aGlzLmdldFRpbWVab25lKHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpKVxuICAgIH0sIGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGN1cnJlbnQgYWJpbGl0eS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9hdXRob3JpemF0aW9uL2FiaWxpdHkuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gYWJpbGl0eSAtIEFiaWxpdHkgdG8gc2V0LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRDdXJyZW50QWJpbGl0eShhYmlsaXR5KSB7XG4gICAgaWYgKCF0aGlzLl90aW1lem9uZUFzeW5jTG9jYWxTdG9yYWdlKSB7XG4gICAgICBzdXBlci5zZXRDdXJyZW50QWJpbGl0eShhYmlsaXR5KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgZXhpc3RpbmdTdG9yZSA9IHRoaXMuX3RpbWV6b25lQXN5bmNMb2NhbFN0b3JhZ2UuZ2V0U3RvcmUoKVxuXG4gICAgaWYgKGV4aXN0aW5nU3RvcmUpIHtcbiAgICAgIGV4aXN0aW5nU3RvcmUuYWJpbGl0eSA9IGFiaWxpdHlcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5fdGltZXpvbmVBc3luY0xvY2FsU3RvcmFnZS5lbnRlcldpdGgoe1xuICAgICAgICBhYmlsaXR5LFxuICAgICAgICBvZmZzZXRNaW51dGVzOiB0aGlzLmdldFRpbWV6b25lT2Zmc2V0TWludXRlcyh0aGlzLmdldENvbmZpZ3VyYXRpb24oKSksXG4gICAgICAgIHJlcXVlc3RUaW1pbmc6IHVuZGVmaW5lZCxcbiAgICAgICAgdGVuYW50OiB1bmRlZmluZWQsXG4gICAgICAgIHRlc3RQcm9maWxlQ29udGV4dDogdW5kZWZpbmVkLFxuICAgICAgICB0aW1lWm9uZTogdGhpcy5nZXRUaW1lWm9uZSh0aGlzLmdldENvbmZpZ3VyYXRpb24oKSlcbiAgICAgIH0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGN1cnJlbnQgYWJpbGl0eS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAtIEN1cnJlbnQgYWJpbGl0eS5cbiAgICovXG4gIGdldEN1cnJlbnRBYmlsaXR5KCkge1xuICAgIGlmICghdGhpcy5fdGltZXpvbmVBc3luY0xvY2FsU3RvcmFnZSkge1xuICAgICAgcmV0dXJuIHN1cGVyLmdldEN1cnJlbnRBYmlsaXR5KClcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fdGltZXpvbmVBc3luY0xvY2FsU3RvcmFnZS5nZXRTdG9yZSgpPy5hYmlsaXR5XG4gIH1cblxuICAvKipcbiAgICogUnVucyBydW4gd2l0aCByZXF1ZXN0IHRpbWluZy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9odHRwLXNlcnZlci9jbGllbnQvcmVxdWVzdC10aW1pbmcuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gcmVxdWVzdFRpbWluZyAtIFJlcXVlc3QgdGltaW5nIGNvbGxlY3Rvci5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY2FsbGJhY2sgLSBDYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHJ1bldpdGhSZXF1ZXN0VGltaW5nKHJlcXVlc3RUaW1pbmcsIGNhbGxiYWNrKSB7XG4gICAgaWYgKCF0aGlzLl90aW1lem9uZUFzeW5jTG9jYWxTdG9yYWdlKSB7XG4gICAgICByZXR1cm4gYXdhaXQgc3VwZXIucnVuV2l0aFJlcXVlc3RUaW1pbmcocmVxdWVzdFRpbWluZywgY2FsbGJhY2spXG4gICAgfVxuXG4gICAgY29uc3QgZXhpc3RpbmdTdG9yZSA9IHRoaXMuX3RpbWV6b25lQXN5bmNMb2NhbFN0b3JhZ2UuZ2V0U3RvcmUoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3RpbWV6b25lQXN5bmNMb2NhbFN0b3JhZ2UucnVuKHtcbiAgICAgIGFiaWxpdHk6IGV4aXN0aW5nU3RvcmU/LmFiaWxpdHksXG4gICAgICBvZmZzZXRNaW51dGVzOiBleGlzdGluZ1N0b3JlPy5vZmZzZXRNaW51dGVzID8/IHRoaXMuZ2V0VGltZXpvbmVPZmZzZXRNaW51dGVzKHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpKSxcbiAgICAgIHJlcXVlc3RUaW1pbmcsXG4gICAgICB0ZW5hbnQ6IGV4aXN0aW5nU3RvcmU/LnRlbmFudCxcbiAgICAgIHRlc3RQcm9maWxlQ29udGV4dDogZXhpc3RpbmdTdG9yZT8udGVzdFByb2ZpbGVDb250ZXh0LFxuICAgICAgdGltZVpvbmU6IGV4aXN0aW5nU3RvcmU/LnRpbWVab25lID8/IHRoaXMuZ2V0VGltZVpvbmUodGhpcy5nZXRDb25maWd1cmF0aW9uKCkpXG4gICAgfSwgY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgY3VycmVudCByZXF1ZXN0IHRpbWluZy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2h0dHAtc2VydmVyL2NsaWVudC9yZXF1ZXN0LXRpbWluZy5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAtIEN1cnJlbnQgcmVxdWVzdCB0aW1pbmcgY29sbGVjdG9yLlxuICAgKi9cbiAgZ2V0Q3VycmVudFJlcXVlc3RUaW1pbmcoKSB7XG4gICAgaWYgKCF0aGlzLl90aW1lem9uZUFzeW5jTG9jYWxTdG9yYWdlKSB7XG4gICAgICByZXR1cm4gc3VwZXIuZ2V0Q3VycmVudFJlcXVlc3RUaW1pbmcoKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl90aW1lem9uZUFzeW5jTG9jYWxTdG9yYWdlLmdldFN0b3JlKCk/LnJlcXVlc3RUaW1pbmdcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1biB3aXRoIHRlbmFudC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdGVuYW50IC0gVGVuYW50IHRvIHNldCBmb3IgY2FsbGJhY2sgc2NvcGUuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGNhbGxiYWNrIC0gQ2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBydW5XaXRoVGVuYW50KHRlbmFudCwgY2FsbGJhY2spIHtcbiAgICBpZiAoIXRoaXMuX3RpbWV6b25lQXN5bmNMb2NhbFN0b3JhZ2UpIHtcbiAgICAgIHJldHVybiBhd2FpdCBzdXBlci5ydW5XaXRoVGVuYW50KHRlbmFudCwgY2FsbGJhY2spXG4gICAgfVxuXG4gICAgY29uc3QgZXhpc3RpbmdTdG9yZSA9IHRoaXMuX3RpbWV6b25lQXN5bmNMb2NhbFN0b3JhZ2UuZ2V0U3RvcmUoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3RpbWV6b25lQXN5bmNMb2NhbFN0b3JhZ2UucnVuKHtcbiAgICAgIGFiaWxpdHk6IGV4aXN0aW5nU3RvcmU/LmFiaWxpdHksXG4gICAgICBvZmZzZXRNaW51dGVzOiBleGlzdGluZ1N0b3JlPy5vZmZzZXRNaW51dGVzID8/IHRoaXMuZ2V0VGltZXpvbmVPZmZzZXRNaW51dGVzKHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpKSxcbiAgICAgIHJlcXVlc3RUaW1pbmc6IGV4aXN0aW5nU3RvcmU/LnJlcXVlc3RUaW1pbmcsXG4gICAgICB0ZW5hbnQsXG4gICAgICB0ZXN0UHJvZmlsZUNvbnRleHQ6IGV4aXN0aW5nU3RvcmU/LnRlc3RQcm9maWxlQ29udGV4dCxcbiAgICAgIHRpbWVab25lOiBleGlzdGluZ1N0b3JlPy50aW1lWm9uZSA/PyB0aGlzLmdldFRpbWVab25lKHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpKVxuICAgIH0sIGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGN1cnJlbnQgdGVuYW50LlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB0ZW5hbnQgLSBUZW5hbnQgdG8gc2V0LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRDdXJyZW50VGVuYW50KHRlbmFudCkge1xuICAgIGlmICghdGhpcy5fdGltZXpvbmVBc3luY0xvY2FsU3RvcmFnZSkge1xuICAgICAgc3VwZXIuc2V0Q3VycmVudFRlbmFudCh0ZW5hbnQpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBleGlzdGluZ1N0b3JlID0gdGhpcy5fdGltZXpvbmVBc3luY0xvY2FsU3RvcmFnZS5nZXRTdG9yZSgpXG5cbiAgICBpZiAoZXhpc3RpbmdTdG9yZSkge1xuICAgICAgZXhpc3RpbmdTdG9yZS50ZW5hbnQgPSB0ZW5hbnRcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5fdGltZXpvbmVBc3luY0xvY2FsU3RvcmFnZS5lbnRlcldpdGgoe1xuICAgICAgICBhYmlsaXR5OiB1bmRlZmluZWQsXG4gICAgICAgIG9mZnNldE1pbnV0ZXM6IHRoaXMuZ2V0VGltZXpvbmVPZmZzZXRNaW51dGVzKHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpKSxcbiAgICAgICAgcmVxdWVzdFRpbWluZzogdW5kZWZpbmVkLFxuICAgICAgICB0ZW5hbnQsXG4gICAgICAgIHRlc3RQcm9maWxlQ29udGV4dDogdW5kZWZpbmVkLFxuICAgICAgICB0aW1lWm9uZTogdGhpcy5nZXRUaW1lWm9uZSh0aGlzLmdldENvbmZpZ3VyYXRpb24oKSlcbiAgICAgIH0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGN1cnJlbnQgdGVuYW50LlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gQ3VycmVudCB0ZW5hbnQuXG4gICAqL1xuICBnZXRDdXJyZW50VGVuYW50KCkge1xuICAgIGlmICghdGhpcy5fdGltZXpvbmVBc3luY0xvY2FsU3RvcmFnZSkge1xuICAgICAgcmV0dXJuIHN1cGVyLmdldEN1cnJlbnRUZW5hbnQoKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl90aW1lem9uZUFzeW5jTG9jYWxTdG9yYWdlLmdldFN0b3JlKCk/LnRlbmFudFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWN0dWFsIGZpbmQgY29tbWFuZHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5PGltcG9ydChcIi4vYmFzZS5qc1wiKS5Db21tYW5kRmlsZU9iamVjdFR5cGU+Pn0gLSBSZXNvbHZlcyB3aXRoIGRpc2NvdmVyZWQgY29tbWFuZCBmaWxlcy5cbiAgICovXG4gIGFzeW5jIF9hY3R1YWxGaW5kQ29tbWFuZHMoKSB7XG4gICAgY29uc3QgYmFzZVBhdGggPSBhd2FpdCB0aGlzLmdldEJhc2VQYXRoKClcbiAgICBjb25zdCBjb21tYW5kRmlsZXMgPSBmcy5nbG9iKGAke2Jhc2VQYXRofS9zcmMvY2xpL2NvbW1hbmRzLyoqLyouanNgKVxuICAgIGNvbnN0IGNvbW1hbmRzID0gW11cblxuICAgIGZvciBhd2FpdCAoY29uc3QgYUZpbGVQYXRoIG9mIGNvbW1hbmRGaWxlcykge1xuICAgICAgY29uc3QgY29tbWFuZE5hbWUgPSB0aGlzLmNvbW1hbmROYW1lRnJvbUZpbGVQYXRoKGFGaWxlUGF0aClcblxuICAgICAgY29tbWFuZHMucHVzaCh7bmFtZTogY29tbWFuZE5hbWUsIGZpbGU6IGFGaWxlUGF0aH0pXG4gICAgfVxuXG4gICAgcmV0dXJuIGNvbW1hbmRzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjb21tYW5kIG5hbWUgZnJvbSBmaWxlIHBhdGguXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBmaWxlUGF0aCAtIEZ1bGwgY29tbWFuZCBmaWxlIHBhdGguXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gUGFyc2VkIGNvbW1hbmQgbmFtZS5cbiAgICovXG4gIGNvbW1hbmROYW1lRnJvbUZpbGVQYXRoKGZpbGVQYXRoKSB7XG4gICAgY29uc3QgYUZpbGVQYXRoUGFydHMgPSBmaWxlUGF0aC5zcGxpdCgvW1xcXFwvXS8pXG4gICAgY29uc3QgY29tbWFuZFBhdGhMb2NhdGlvbiA9IGFGaWxlUGF0aFBhcnRzLmluZGV4T2YoXCJjb21tYW5kc1wiKVxuXG4gICAgaWYgKGNvbW1hbmRQYXRoTG9jYXRpb24gPT09IC0xKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENvdWxkIG5vdCBwYXJzZSBjb21tYW5kIGZpbGUgcGF0aDogJHtmaWxlUGF0aH1gKVxuICAgIH1cblxuICAgIGNvbnN0IGNvbW1hbmRQYXJ0cyA9IGFGaWxlUGF0aFBhcnRzLnNsaWNlKGNvbW1hbmRQYXRoTG9jYXRpb24gKyAxKVxuICAgIGNvbnN0IGxhc3RQYXJ0ID0gY29tbWFuZFBhcnRzW2NvbW1hbmRQYXJ0cy5sZW5ndGggLSAxXVxuICAgIGxldCBuYW1lLCBwYXRoc1xuXG4gICAgaWYgKGxhc3RQYXJ0ID09IFwiaW5kZXguanNcIikge1xuICAgICAgbmFtZSA9IGNvbW1hbmRQYXJ0c1tjb21tYW5kUGFydHMubGVuZ3RoIC0gMl1cbiAgICAgIHBhdGhzID0gY29tbWFuZFBhcnRzLnNsaWNlKDAsIC0yKVxuICAgIH0gZWxzZSB7XG4gICAgICBuYW1lID0gbGFzdFBhcnQucmVwbGFjZShcIi5qc1wiLCBcIlwiKVxuICAgICAgcGF0aHMgPSBjb21tYW5kUGFydHMuc2xpY2UoMCwgLTEpXG4gICAgfVxuXG4gICAgcmV0dXJuIGAke3BhdGhzLmpvaW4oXCI6XCIpfSR7cGF0aHMubGVuZ3RoID4gMCA/IFwiOlwiIDogXCJcIn0ke25hbWV9YFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xpIGNvbW1hbmRzIGluaXQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiKS5kZWZhdWx0fSBjb21tYW5kIC0gQ29tbWFuZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNvbW1hbmQgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgY2xpQ29tbWFuZHNJbml0KGNvbW1hbmQpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5mb3J3YXJkQ29tbWFuZChjb21tYW5kLCBDbGlDb21tYW5kc0luaXQpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGkgY29tbWFuZHMgbWlncmF0aW9uIGdlbmVyYXRlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NsaS9iYXNlLWNvbW1hbmQuanNcIikuZGVmYXVsdH0gY29tbWFuZCAtIENvbW1hbmQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjb21tYW5kIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGNsaUNvbW1hbmRzTWlncmF0aW9uR2VuZXJhdGUoY29tbWFuZCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmZvcndhcmRDb21tYW5kKGNvbW1hbmQsIENsaUNvbW1hbmRzR2VuZXJhdGVNaWdyYXRpb24pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGkgY29tbWFuZHMgbWlncmF0aW9uIGRlc3Ryb3kuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiKS5kZWZhdWx0fSBjb21tYW5kIC0gQ29tbWFuZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNvbW1hbmQgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgY2xpQ29tbWFuZHNNaWdyYXRpb25EZXN0cm95KGNvbW1hbmQpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5mb3J3YXJkQ29tbWFuZChjb21tYW5kLCBDbGlDb21tYW5kc0Rlc3Ryb3lNaWdyYXRpb24pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGkgY29tbWFuZHMgZ2VuZXJhdGUgYmFzZSBtb2RlbHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiKS5kZWZhdWx0fSBjb21tYW5kIC0gQ29tbWFuZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNvbW1hbmQgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgY2xpQ29tbWFuZHNHZW5lcmF0ZUJhc2VNb2RlbHMoY29tbWFuZCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmZvcndhcmRDb21tYW5kKGNvbW1hbmQsIENsaUNvbW1hbmRzR2VuZXJhdGVCYXNlTW9kZWxzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xpIGNvbW1hbmRzIGdlbmVyYXRlIGZyb250ZW5kIG1vZGVscy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jbGkvYmFzZS1jb21tYW5kLmpzXCIpLmRlZmF1bHR9IGNvbW1hbmQgLSBDb21tYW5kLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY29tbWFuZCByZXN1bHQuXG4gICAqL1xuICBhc3luYyBjbGlDb21tYW5kc0dlbmVyYXRlRnJvbnRlbmRNb2RlbHMoY29tbWFuZCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmZvcndhcmRDb21tYW5kKGNvbW1hbmQsIENsaUNvbW1hbmRzR2VuZXJhdGVGcm9udGVuZE1vZGVscylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsaSBjb21tYW5kcyBnZW5lcmF0ZSBtb2RlbC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jbGkvYmFzZS1jb21tYW5kLmpzXCIpLmRlZmF1bHR9IGNvbW1hbmQgLSBDb21tYW5kLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY29tbWFuZCByZXN1bHQuXG4gICAqL1xuICBhc3luYyBjbGlDb21tYW5kc0dlbmVyYXRlTW9kZWwoY29tbWFuZCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmZvcndhcmRDb21tYW5kKGNvbW1hbmQsIENsaUNvbW1hbmRzR2VuZXJhdGVNb2RlbClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsaSBjb21tYW5kcyBsaW50IHJlbGF0aW9uc2hpcHMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiKS5kZWZhdWx0fSBjb21tYW5kIC0gQ29tbWFuZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNvbW1hbmQgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgY2xpQ29tbWFuZHNMaW50UmVsYXRpb25zaGlwcyhjb21tYW5kKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZm9yd2FyZENvbW1hbmQoY29tbWFuZCwgQ2xpQ29tbWFuZHNMaW50UmVsYXRpb25zaGlwcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsaSBjb21tYW5kcyByb3V0ZXMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiKS5kZWZhdWx0fSBjb21tYW5kIC0gQ29tbWFuZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNvbW1hbmQgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgY2xpQ29tbWFuZHNSb3V0ZXMoY29tbWFuZCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmZvcndhcmRDb21tYW5kKGNvbW1hbmQsIENsaUNvbW1hbmRzUm91dGVzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xpIGNvbW1hbmRzIGNvbnNvbGUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiKS5kZWZhdWx0fSBjb21tYW5kIC0gQ29tbWFuZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNvbW1hbmQgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgY2xpQ29tbWFuZHNDb25zb2xlKGNvbW1hbmQpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5mb3J3YXJkQ29tbWFuZChjb21tYW5kLCBDbGlDb21tYW5kc0NvbnNvbGUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGkgY29tbWFuZHMgc2VydmVyLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NsaS9iYXNlLWNvbW1hbmQuanNcIikuZGVmYXVsdH0gY29tbWFuZCAtIENvbW1hbmQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjb21tYW5kIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGNsaUNvbW1hbmRzU2VydmVyKGNvbW1hbmQpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5mb3J3YXJkQ29tbWFuZChjb21tYW5kLCBDbGlDb21tYW5kc1NlcnZlcilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsaSBjb21tYW5kcyBtY3AuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiKS5kZWZhdWx0fSBjb21tYW5kIC0gQ29tbWFuZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0aGUgY29tbWFuZCBjb21wbGV0ZXMuXG4gICAqL1xuICBhc3luYyBjbGlDb21tYW5kc01jcChjb21tYW5kKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZm9yd2FyZENvbW1hbmQoY29tbWFuZCwgQ2xpQ29tbWFuZHNNY3ApXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGkgY29tbWFuZHMgdGVzdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jbGkvYmFzZS1jb21tYW5kLmpzXCIpLmRlZmF1bHR9IGNvbW1hbmQgLSBDb21tYW5kLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY29tbWFuZCByZXN1bHQuXG4gICAqL1xuICBhc3luYyBjbGlDb21tYW5kc1Rlc3QoY29tbWFuZCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmZvcndhcmRDb21tYW5kKGNvbW1hbmQsIENsaUNvbW1hbmRzVGVzdClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsaSBjb21tYW5kcyB0ZXN0IHRpbWluZyBtYW5pZmVzdCBtZXJnZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jbGkvYmFzZS1jb21tYW5kLmpzXCIpLmRlZmF1bHR9IGNvbW1hbmQgLSBDb21tYW5kLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY29tbWFuZCByZXN1bHQuXG4gICAqL1xuICBhc3luYyBjbGlDb21tYW5kc1Rlc3RUaW1pbmdNYW5pZmVzdE1lcmdlKGNvbW1hbmQpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5mb3J3YXJkQ29tbWFuZChjb21tYW5kLCBDbGlDb21tYW5kc1Rlc3RUaW1pbmdNYW5pZmVzdE1lcmdlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xpIGNvbW1hbmRzIGJhY2tncm91bmQgam9icyBtYWluLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NsaS9iYXNlLWNvbW1hbmQuanNcIikuZGVmYXVsdH0gY29tbWFuZCAtIENvbW1hbmQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjb21tYW5kIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGNsaUNvbW1hbmRzQmFja2dyb3VuZEpvYnNNYWluKGNvbW1hbmQpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5mb3J3YXJkQ29tbWFuZChjb21tYW5kLCBDbGlDb21tYW5kc0JhY2tncm91bmRKb2JzTWFpbilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIENMSSBiYWNrZ3JvdW5kLWpvYnMgYWN0aXZhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jbGkvYmFzZS1jb21tYW5kLmpzXCIpLmRlZmF1bHR9IGNvbW1hbmQgLSBDb21tYW5kLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgY2xpQ29tbWFuZHNCYWNrZ3JvdW5kSm9ic0FjdGl2YXRlKGNvbW1hbmQpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5mb3J3YXJkQ29tbWFuZChjb21tYW5kLCBDbGlDb21tYW5kc0JhY2tncm91bmRKb2JzQWN0aXZhdGUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBDTEkgYmFja2dyb3VuZC1qb2JzIHJldGlyZW1lbnQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiKS5kZWZhdWx0fSBjb21tYW5kIC0gQ29tbWFuZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGNsaUNvbW1hbmRzQmFja2dyb3VuZEpvYnNSZXRpcmUoY29tbWFuZCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmZvcndhcmRDb21tYW5kKGNvbW1hbmQsIENsaUNvbW1hbmRzQmFja2dyb3VuZEpvYnNSZXRpcmUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGkgY29tbWFuZHMgYmFja2dyb3VuZCBqb2JzIHdvcmtlci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jbGkvYmFzZS1jb21tYW5kLmpzXCIpLmRlZmF1bHR9IGNvbW1hbmQgLSBDb21tYW5kLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY29tbWFuZCByZXN1bHQuXG4gICAqL1xuICBhc3luYyBjbGlDb21tYW5kc0JhY2tncm91bmRKb2JzV29ya2VyKGNvbW1hbmQpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5mb3J3YXJkQ29tbWFuZChjb21tYW5kLCBDbGlDb21tYW5kc0JhY2tncm91bmRKb2JzV29ya2VyKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xpIGNvbW1hbmRzIGJhY2tncm91bmQgam9icyBydW5uZXIuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiKS5kZWZhdWx0fSBjb21tYW5kIC0gQ29tbWFuZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNvbW1hbmQgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgY2xpQ29tbWFuZHNCYWNrZ3JvdW5kSm9ic1J1bm5lcihjb21tYW5kKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZm9yd2FyZENvbW1hbmQoY29tbWFuZCwgQ2xpQ29tbWFuZHNCYWNrZ3JvdW5kSm9ic1J1bm5lcilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsaSBjb21tYW5kcyBiZWFjb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiKS5kZWZhdWx0fSBjb21tYW5kIC0gQ29tbWFuZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNvbW1hbmQgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgY2xpQ29tbWFuZHNCZWFjb24oY29tbWFuZCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmZvcndhcmRDb21tYW5kKGNvbW1hbmQsIENsaUNvbW1hbmRzQmVhY29uKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbG9hZCBiZWFjb24gY2xpZW50LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx0eXBlb2YgaW1wb3J0KFwiLi4vYmVhY29uL2NsaWVudC5qc1wiKS5kZWZhdWx0Pn0gLSBCZWFjb24gY2xpZW50IGNsYXNzLlxuICAgKi9cbiAgYXN5bmMgbG9hZEJlYWNvbkNsaWVudCgpIHtcbiAgICBjb25zdCB7ZGVmYXVsdDogQmVhY29uQ2xpZW50fSA9IGF3YWl0IGltcG9ydChcIi4uL2JlYWNvbi9jbGllbnQuanNcIilcblxuICAgIHJldHVybiBCZWFjb25DbGllbnRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGxvYWQgaW4gcHJvY2VzcyBiZWFjb24gY2xpZW50LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx0eXBlb2YgaW1wb3J0KFwiLi4vYmVhY29uL2luLXByb2Nlc3MtY2xpZW50LmpzXCIpLmRlZmF1bHQ+fSAtIEluLXByb2Nlc3MgY2xpZW50IGNsYXNzLlxuICAgKi9cbiAgYXN5bmMgbG9hZEluUHJvY2Vzc0JlYWNvbkNsaWVudCgpIHtcbiAgICBjb25zdCB7ZGVmYXVsdDogSW5Qcm9jZXNzQmVhY29uQ2xpZW50fSA9IGF3YWl0IGltcG9ydChcIi4uL2JlYWNvbi9pbi1wcm9jZXNzLWNsaWVudC5qc1wiKVxuXG4gICAgcmV0dXJuIEluUHJvY2Vzc0JlYWNvbkNsaWVudFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xpIGNvbW1hbmRzIGRiIHNjaGVtYSBkdW1wLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NsaS9iYXNlLWNvbW1hbmQuanNcIikuZGVmYXVsdH0gY29tbWFuZCAtIENvbW1hbmQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjb21tYW5kIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGNsaUNvbW1hbmRzRGJTY2hlbWFEdW1wKGNvbW1hbmQpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5mb3J3YXJkQ29tbWFuZChjb21tYW5kLCBDbGlDb21tYW5kc0RiU2NoZW1hRHVtcClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsaSBjb21tYW5kcyBkYiBzY2hlbWEgbG9hZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jbGkvYmFzZS1jb21tYW5kLmpzXCIpLmRlZmF1bHR9IGNvbW1hbmQgLSBDb21tYW5kLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY29tbWFuZCByZXN1bHQuXG4gICAqL1xuICBhc3luYyBjbGlDb21tYW5kc0RiU2NoZW1hTG9hZChjb21tYW5kKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZm9yd2FyZENvbW1hbmQoY29tbWFuZCwgQ2xpQ29tbWFuZHNEYlNjaGVtYUxvYWQpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGkgY29tbWFuZHMgZGIgc2VlZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jbGkvYmFzZS1jb21tYW5kLmpzXCIpLmRlZmF1bHR9IGNvbW1hbmQgLSBDb21tYW5kLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY29tbWFuZCByZXN1bHQuXG4gICAqL1xuICBhc3luYyBjbGlDb21tYW5kc0RiU2VlZChjb21tYW5kKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZm9yd2FyZENvbW1hbmQoY29tbWFuZCwgQ2xpQ29tbWFuZHNEYlNlZWQpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGkgY29tbWFuZHMgcnVubmVyLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NsaS9iYXNlLWNvbW1hbmQuanNcIikuZGVmYXVsdH0gY29tbWFuZCAtIENvbW1hbmQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjb21tYW5kIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGNsaUNvbW1hbmRzUnVubmVyKGNvbW1hbmQpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5mb3J3YXJkQ29tbWFuZChjb21tYW5kLCBDbGlDb21tYW5kc1J1bm5lcilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsaSBjb21tYW5kcyBydW4gc2NyaXB0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NsaS9iYXNlLWNvbW1hbmQuanNcIikuZGVmYXVsdH0gY29tbWFuZCAtIENvbW1hbmQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjb21tYW5kIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGNsaUNvbW1hbmRzUnVuU2NyaXB0KGNvbW1hbmQpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5mb3J3YXJkQ29tbWFuZChjb21tYW5kLCBDbGlDb21tYW5kc1J1blNjcmlwdClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlcXVpcmUgY29tbWFuZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gYXJncy5jb21tYW5kUGFydHMgLSBDb21tYW5kIHBhcnRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx0eXBlb2YgaW1wb3J0IChcIi4uL2NsaS9iYXNlLWNvbW1hbmQuanNcIikuZGVmYXVsdD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgcmVxdWlyZSBjb21tYW5kLlxuICAgKi9cbiAgYXN5bmMgcmVxdWlyZUNvbW1hbmQoe2NvbW1hbmRQYXJ0c30pIHtcbiAgICBjb25zdCBjb21tYW5kcyA9IGF3YWl0IHRoaXMuZmluZENvbW1hbmRzKClcbiAgICBjb25zdCBjb21tYW5kTmFtZSA9IGNvbW1hbmRQYXJ0cy5qb2luKFwiOlwiKVxuICAgIGNvbnN0IGNvbW1hbmQgPSBjb21tYW5kcy5maW5kKChhQ29tbWFuZCkgPT4gYUNvbW1hbmQubmFtZSA9PT0gY29tbWFuZE5hbWUpXG5cbiAgICBpZiAoIWNvbW1hbmQpIHtcbiAgICAgIGNvbnN0IHBvc3NpYmxlQ29tbWFuZHMgPSBjb21tYW5kcy5tYXAoYUNvbW1hbmQgPT4gYUNvbW1hbmQubmFtZSlcblxuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIGNvbW1hbmQ6ICR7Y29tbWFuZFBhcnRzLmpvaW4oXCI6XCIpfSB3aGljaCBzaG91bGQgaGF2ZSBiZWVuIG9uZSBvZjogJHtwb3NzaWJsZUNvbW1hbmRzLnNvcnQoKS5qb2luKFwiLCBcIil9YClcbiAgICB9XG5cbiAgICBjb25zdCBjb21tYW5kQ2xhc3NJbXBvcnQgPSBhd2FpdCBpbXBvcnQodG9JbXBvcnRTcGVjaWZpZXIoY29tbWFuZC5maWxlKSlcbiAgICBjb25zdCBDb21tYW5kQ2xhc3MgPSBjb21tYW5kQ2xhc3NJbXBvcnQuZGVmYXVsdFxuXG4gICAgcmV0dXJuIENvbW1hbmRDbGFzc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmluZCBtaWdyYXRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcnJheTxpbXBvcnQoXCIuL2Jhc2UuanNcIikuTWlncmF0aW9uT2JqZWN0VHlwZT4+fSAtIFJlc29sdmVzIHdpdGggdGhlIG1pZ3JhdGlvbnMuXG4gICAqL1xuICBhc3luYyBmaW5kTWlncmF0aW9ucygpIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKClcbiAgICBjb25zdCBtaWdyYXRpb25EaXJlY3RvcmllcyA9IFtgJHtjb25maWd1cmF0aW9uLmdldERpcmVjdG9yeSgpfS9zcmMvZGF0YWJhc2UvbWlncmF0aW9uc2BdXG5cbiAgICBmb3IgKGNvbnN0IHZlbG9jaW91c1BhY2thZ2Ugb2YgY29uZmlndXJhdGlvbi5nZXRQYWNrYWdlcygpKSB7XG4gICAgICBtaWdyYXRpb25EaXJlY3Rvcmllcy5wdXNoKHZlbG9jaW91c1BhY2thZ2UuZ2V0TWlncmF0aW9uc1BhdGgoKSlcbiAgICB9XG5cbiAgICAvKiogQHR5cGUge0FycmF5PGltcG9ydChcIi4vYmFzZS5qc1wiKS5NaWdyYXRpb25PYmplY3RUeXBlPn0gKi9cbiAgICBjb25zdCBmaWxlcyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IG1pZ3JhdGlvbnNQYXRoIG9mIG1pZ3JhdGlvbkRpcmVjdG9yaWVzKSB7XG4gICAgICBhd2FpdCB0aGlzLl9jb2xsZWN0TWlncmF0aW9uc0Zyb21EaXJlY3RvcnkobWlncmF0aW9uc1BhdGgsIGZpbGVzKVxuICAgIH1cblxuICAgIHRoaXMuX2Vuc3VyZU5vTWlncmF0aW9uVGltZXN0YW1wQ29sbGlzaW9ucyhmaWxlcylcblxuICAgIHJldHVybiBmaWxlcy5zb3J0KChtaWdyYXRpb24xLCBtaWdyYXRpb24yKSA9PiBtaWdyYXRpb24xLmRhdGUgLSBtaWdyYXRpb24yLmRhdGUpXG4gIH1cblxuICAvKipcbiAgICogQ29sbGVjdHMgbWlncmF0aW9uIGZpbGVzIGZyb20gb25lIGRpcmVjdG9yeSBpbnRvIGBmaWxlc2AsIHByZXNlcnZpbmcgZWFjaFxuICAgKiBmaWxlJ3MgcmVhbCBhYnNvbHV0ZSBwYXRoIChzbyBhcHAgYW5kIHBhY2thZ2UgbWlncmF0aW9ucyBrZWVwIHRoZWlyIG93blxuICAgKiBzb3VyY2UgbG9jYXRpb24pLiBBIG1pc3NpbmcgZGlyZWN0b3J5IGlzIHNraXBwZWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtaWdyYXRpb25zUGF0aCAtIERpcmVjdG9yeSB0byBzY2FuLlxuICAgKiBAcGFyYW0ge0FycmF5PGltcG9ydChcIi4vYmFzZS5qc1wiKS5NaWdyYXRpb25PYmplY3RUeXBlPn0gZmlsZXMgLSBBY2N1bXVsYXRvciB0byBwdXNoIGludG8uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfY29sbGVjdE1pZ3JhdGlvbnNGcm9tRGlyZWN0b3J5KG1pZ3JhdGlvbnNQYXRoLCBmaWxlcykge1xuICAgIGNvbnN0IGdsb2IgPSBhd2FpdCBmcy5nbG9iKGAke21pZ3JhdGlvbnNQYXRofS8qKi8qLmpzYClcblxuICAgIHRyeSB7XG4gICAgICBmb3IgYXdhaXQgKGNvbnN0IGZ1bGxQYXRoIG9mIGdsb2IpIHtcbiAgICAgICAgY29uc3QgZmlsZSA9IGF3YWl0IHBhdGguYmFzZW5hbWUoZnVsbFBhdGgpXG4gICAgICAgIGNvbnN0IG1hdGNoID0gZmlsZS5tYXRjaCgvXihcXGR7MTR9KS0oLispXFwuanMkLylcblxuICAgICAgICBpZiAoIW1hdGNoKSBjb250aW51ZVxuXG4gICAgICAgIGNvbnN0IGRhdGUgPSBwYXJzZUludChtYXRjaFsxXSlcbiAgICAgICAgY29uc3QgbWlncmF0aW9uTmFtZSA9IG1hdGNoWzJdXG4gICAgICAgIGNvbnN0IG1pZ3JhdGlvbkNsYXNzTmFtZSA9IGluZmxlY3Rpb24uY2FtZWxpemUobWlncmF0aW9uTmFtZS5yZXBsYWNlQWxsKFwiLVwiLCBcIl9cIikpXG5cbiAgICAgICAgZmlsZXMucHVzaCh7ZmlsZSwgZnVsbFBhdGgsIGRhdGUsIG1pZ3JhdGlvbkNsYXNzTmFtZX0pXG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmICgvKiogQHR5cGUge0Vycm9yICYge2NvZGU/OiBzdHJpbmd9fSAqLyAoZXJyb3IpPy5jb2RlICE9PSBcIkVOT0VOVFwiKSB7XG4gICAgICAgIHRocm93IGVycm9yXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFRocm93cyBpZiB0d28gbWlncmF0aW9ucyBmcm9tIGRpZmZlcmVudCBmaWxlcyBzaGFyZSB0aGUgc2FtZSAxNC1kaWdpdFxuICAgKiB0aW1lc3RhbXAuIFRoZSBgc2NoZW1hX21pZ3JhdGlvbnNgIGxlZGdlciBrZXlzIG9uIHRoZSB0aW1lc3RhbXAsIHNvIGEgc2lsZW50XG4gICAqIGNvbGxpc2lvbiAoZS5nLiBiZXR3ZWVuIHRoZSBhcHAgYW5kIGEgcGFja2FnZSwgb3IgdHdvIHBhY2thZ2VzKSB3b3VsZCBsZWF2ZVxuICAgKiB0aGUgc2Vjb25kIG1pZ3JhdGlvbiB1bi1ydW4g4oCUIGEgZGF0YSBidWcuIEZhaWwgbG91ZGx5IGluc3RlYWQuXG4gICAqIEBwYXJhbSB7QXJyYXk8aW1wb3J0KFwiLi9iYXNlLmpzXCIpLk1pZ3JhdGlvbk9iamVjdFR5cGU+fSBmaWxlcyAtIENvbGxlY3RlZCBtaWdyYXRpb25zLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBfZW5zdXJlTm9NaWdyYXRpb25UaW1lc3RhbXBDb2xsaXNpb25zKGZpbGVzKSB7XG4gICAgLyoqIEB0eXBlIHtNYXA8bnVtYmVyLCBzdHJpbmc+fSAqL1xuICAgIGNvbnN0IHBhdGhzQnlEYXRlID0gbmV3IE1hcCgpXG5cbiAgICBmb3IgKGNvbnN0IG1pZ3JhdGlvbiBvZiBmaWxlcykge1xuICAgICAgaWYgKCFtaWdyYXRpb24uZnVsbFBhdGgpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IGV4aXN0aW5nID0gcGF0aHNCeURhdGUuZ2V0KG1pZ3JhdGlvbi5kYXRlKVxuXG4gICAgICBpZiAoZXhpc3RpbmcgJiYgZXhpc3RpbmcgIT09IG1pZ3JhdGlvbi5mdWxsUGF0aCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFR3byBtaWdyYXRpb25zIHNoYXJlIHRoZSB0aW1lc3RhbXAgJHttaWdyYXRpb24uZGF0ZX06ICR7ZXhpc3Rpbmd9IGFuZCAke21pZ3JhdGlvbi5mdWxsUGF0aH0uIE1pZ3JhdGlvbiB0aW1lc3RhbXBzIG11c3QgYmUgdW5pcXVlIGFjcm9zcyB0aGUgYXBwIGFuZCBhbGwgcGFja2FnZXMuYClcbiAgICAgIH1cblxuICAgICAgcGF0aHNCeURhdGUuc2V0KG1pZ3JhdGlvbi5kYXRlLCBtaWdyYXRpb24uZnVsbFBhdGgpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaW1wb3J0IGFwcGxpY2F0aW9uIHJvdXRlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi4vcm91dGVzL2luZGV4LmpzXCIpLmRlZmF1bHQ+fSAtIFJlc29sdmVzIHdpdGggdGhlIGltcG9ydCBhcHBsaWNhdGlvbiByb3V0ZXMuXG4gICAqL1xuICBhc3luYyBpbXBvcnRBcHBsaWNhdGlvblJvdXRlcygpIHtcbiAgICBjb25zdCByb3V0ZXNJbXBvcnQgPSBhd2FpdCBpbXBvcnQodG9JbXBvcnRTcGVjaWZpZXIoYCR7dGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZ2V0RGlyZWN0b3J5KCl9L3NyYy9jb25maWcvcm91dGVzLmpzYCkpXG5cbiAgICByZXR1cm4gcm91dGVzSW1wb3J0LmRlZmF1bHRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB2ZWxvY2lvdXMgcGF0aC5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSB2ZWxvY2lvdXMgcGF0aC5cbiAgICovXG4gIGFzeW5jIGdldFZlbG9jaW91c1BhdGgoKSB7XG4gICAgaWYgKCF0aGlzLl92ZWxvY2lvdXNQYXRoKSB7XG4gICAgICBjb25zdCBfX2ZpbGVuYW1lID0gZmlsZVVSTFRvUGF0aChpbXBvcnQubWV0YS51cmwpXG4gICAgICBjb25zdCBfX2Rpcm5hbWUgPSBkaXJuYW1lKF9fZmlsZW5hbWUpXG5cbiAgICAgIHRoaXMuX3ZlbG9jaW91c1BhdGggPSBhd2FpdCBmcy5yZWFscGF0aChgJHtfX2Rpcm5hbWV9Ly4uLy4uYClcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fdmVsb2Npb3VzUGF0aFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaW1wb3J0IHRlc3QgZmlsZXMuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IHRlc3RGaWxlcyAtIFRlc3QgZmlsZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBpbXBvcnRUZXN0RmlsZXModGVzdEZpbGVzKSB7XG4gICAgZm9yIChjb25zdCB0ZXN0RmlsZSBvZiB0ZXN0RmlsZXMpIHtcbiAgICAgIGF3YWl0IGltcG9ydCh0b0ltcG9ydFNwZWNpZmllcih0ZXN0RmlsZSkpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGRlZmF1bHQgbG9nIGRpcmVjdG9yeS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGFyZ3MuY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIGRlZmF1bHQgbG9nIGRpcmVjdG9yeS5cbiAgICovXG4gIGdldERlZmF1bHRMb2dEaXJlY3Rvcnkoe2NvbmZpZ3VyYXRpb259KSB7XG4gICAgcmV0dXJuIHBhdGguam9pbihjb25maWd1cmF0aW9uLmdldERpcmVjdG9yeSgpLCBcImxvZ1wiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGxvZyBmaWxlIHBhdGguXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IHVuZGVmaW5lZH0gYXJncy5kaXJlY3RvcnkgLSBEaXJlY3RvcnkgcGF0aC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuZW52aXJvbm1lbnQgLSBFbnZpcm9ubWVudC5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBUaGUgbG9nIGZpbGUgcGF0aC5cbiAgICovXG4gIGdldExvZ0ZpbGVQYXRoKHtjb25maWd1cmF0aW9uLCBkaXJlY3RvcnksIGVudmlyb25tZW50fSkge1xuICAgIGNvbnN0IGFjdHVhbERpcmVjdG9yeSA9IGRpcmVjdG9yeSB8fCBjb25maWd1cmF0aW9uPy5nZXREaXJlY3Rvcnk/LigpXG5cbiAgICBpZiAoIWFjdHVhbERpcmVjdG9yeSkgcmV0dXJuIHVuZGVmaW5lZFxuXG4gICAgcmV0dXJuIHBhdGguam9pbihhY3R1YWxEaXJlY3RvcnksIGAke2Vudmlyb25tZW50fS5sb2dgKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd3JpdGUgbG9nIHRvIGZpbGUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmZpbGVQYXRoIC0gRmlsZSBwYXRoLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5tZXNzYWdlIC0gTWVzc2FnZSB0ZXh0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgd3JpdGVMb2dUb0ZpbGUoe2ZpbGVQYXRoLCBtZXNzYWdlfSkge1xuICAgIGF3YWl0IGZzLm1rZGlyKHBhdGguZGlybmFtZShmaWxlUGF0aCksIHtyZWN1cnNpdmU6IHRydWV9KVxuICAgIGF3YWl0IGZzLmFwcGVuZEZpbGUoZmlsZVBhdGgsIGAke21lc3NhZ2V9XFxuYCwgXCJ1dGY4XCIpXG4gIH1cblxuICBhc3luYyBpbXBvcnRUZXN0aW5nQ29uZmlnUGF0aCgpIHtcbiAgICBjb25zdCB0ZXN0aW5nQ29uZmlnUGF0aCA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldFRlc3RpbmcoKVxuXG4gICAgaWYgKCF0ZXN0aW5nQ29uZmlnUGF0aCkgcmV0dXJuXG5cbiAgICBjb25zdCB0ZXN0aW5nSW1wb3J0ID0gYXdhaXQgaW1wb3J0KHRvSW1wb3J0U3BlY2lmaWVyKHRlc3RpbmdDb25maWdQYXRoKSlcbiAgICBjb25zdCB0ZXN0aW5nRGVmYXVsdCA9IHRlc3RpbmdJbXBvcnQuZGVmYXVsdFxuXG4gICAgaWYgKCF0ZXN0aW5nRGVmYXVsdCkgdGhyb3cgbmV3IEVycm9yKFwiVGVzdGluZyBjb25maWcgbXVzdCBleHBvcnQgYSBkZWZhdWx0IGZ1bmN0aW9uXCIpXG4gICAgaWYgKHR5cGVvZiB0ZXN0aW5nRGVmYXVsdCAhPT0gXCJmdW5jdGlvblwiKSB0aHJvdyBuZXcgRXJyb3IoXCJUZXN0aW5nIGNvbmZpZyBkZWZhdWx0IGV4cG9ydCBpc24ndCBhIGZ1bmN0aW9uXCIpXG5cbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0ZXN0aW5nRGVmYXVsdCgpXG5cbiAgICBpZiAodHlwZW9mIHJlc3VsdCA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICBhd2FpdCByZXN1bHQoKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlcXVpcmUgbWlncmF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZmlsZVBhdGggLSBGaWxlIHBhdGguXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4uL2RhdGFiYXNlL21pZ3JhdGlvbi9pbmRleC5qc1wiKS5kZWZhdWx0Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSByZXF1aXJlIG1pZ3JhdGlvbi5cbiAgICovXG4gIGFzeW5jIHJlcXVpcmVNaWdyYXRpb24oZmlsZVBhdGgpIHtcbiAgICBjb25zdCBtaWdyYXRpb25JbXBvcnQgPSBhd2FpdCBpbXBvcnQodG9JbXBvcnRTcGVjaWZpZXIoZmlsZVBhdGgpKVxuICAgIGNvbnN0IG1pZ3JhdGlvbkltcG9ydERlZmF1bHQgPSBtaWdyYXRpb25JbXBvcnQuZGVmYXVsdFxuXG4gICAgaWYgKCFtaWdyYXRpb25JbXBvcnREZWZhdWx0KSB0aHJvdyBuZXcgRXJyb3IoXCJNaWdyYXRpb24gZmlsZSBtdXN0IGV4cG9ydCBhIGRlZmF1bHQgbWlncmF0aW9uIGNsYXNzXCIpXG4gICAgaWYgKHR5cGVvZiBtaWdyYXRpb25JbXBvcnREZWZhdWx0ICE9PSBcImZ1bmN0aW9uXCIpIHRocm93IG5ldyBFcnJvcihcIk1pZ3JhdGlvbiBkZWZhdWx0IGV4cG9ydCBpc24ndCBhIGZ1bmN0aW9uIChzaG91bGQgYmUgYSBjbGFzcyB3aGljaCBpcyBhIGZ1bmN0aW9uIGluIEpTKVwiKVxuXG4gICAgcmV0dXJuIG1pZ3JhdGlvbkltcG9ydERlZmF1bHRcbiAgfVxuXG4gIGFzeW5jIGdldEJhc2VQYXRoKCkge1xuICAgIGNvbnN0IF9fZmlsZW5hbWUgPSBmaWxlVVJMVG9QYXRoKGltcG9ydC5tZXRhLnVybClcbiAgICBjb25zdCBiYXNlUGF0aCA9IGF3YWl0IGZzLnJlYWxwYXRoKGAke2Rpcm5hbWUoX19maWxlbmFtZSl9Ly4uLy4uYClcblxuICAgIHJldHVybiBiYXNlUGF0aFxuICB9XG5cbiAgLyoqXG4gICAqIEVuc3VyZXMgVmVsb2Npb3VzIGZyYW1ld29yayBzY2hlbWEgZXhpc3RzIGFzIHBhcnQgb2YgYGRiOm1pZ3JhdGVgLCBzbyBpbnRlcm5hbFxuICAgKiB0YWJsZXMgYXJlIGNyZWF0ZWQgZGV0ZXJtaW5pc3RpY2FsbHkgYWxvbmdzaWRlIGFwcCBtaWdyYXRpb25zIGFuZCBjYXB0dXJlZCBpblxuICAgKiB0aGUgZHVtcGVkIHN0cnVjdHVyZSBTUUwgaW5zdGVhZCBvZiBhcHBlYXJpbmcgb25seSB3aGVuIHJ1bnRpbWUgc3RvcmVzIGJvb3QuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQ+fSBhcmdzLmRicyAtIERicyBiZWluZyBtaWdyYXRlZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGVuc3VyZUZyYW1ld29ya1NjaGVtYSh7ZGJzfSkge1xuICAgIC8vIE1pZ3JhdGlvbiBwYXNzZXMgaXRzIGFscmVhZHkgY2hlY2tlZC1vdXQgREIgaW50byB0aGUgYWRhcHRlciBob29rLiBEbyBub3RcbiAgICAvLyBydW4gcnVudGltZSByZWFkaW5lc3MgaGVyZTogaXQgd291bGQgb3BlbiBhIG5lc3RlZCBjaGVja291dCBhbmQgY2FuIGRlYWRsb2NrXG4gICAgLy8gYSBzaW5nbGUtY29ubmVjdGlvbiBtaWdyYXRpb24gcG9vbC5cbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKClcblxuICAgIGZvciAoY29uc3QgW2RhdGFiYXNlSWRlbnRpZmllciwgZGJdIG9mIE9iamVjdC5lbnRyaWVzKGRicykpIHtcbiAgICAgIGNvbnN0IGF0dGFjaG1lbnRTdG9yZSA9IG5ldyBSZWNvcmRBdHRhY2htZW50c1N0b3JlKHtjb25maWd1cmF0aW9uLCBkYXRhYmFzZUlkZW50aWZpZXJ9KVxuXG4gICAgICBhd2FpdCBhdHRhY2htZW50U3RvcmUuZW5zdXJlU2NoZW1hKGRiKVxuICAgIH1cblxuICAgIGNvbnN0IGFkYXB0ZXIgPSBjb25maWd1cmF0aW9uLmdldEJhY2tncm91bmRKb2JzQWRhcHRlcigpXG5cbiAgICBhd2FpdCBhZGFwdGVyLmVuc3VyZUZyYW1ld29ya1NjaGVtYSh7ZGJzfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFmdGVyIG1pZ3JhdGlvbnMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQ+fSBhcmdzLmRicyAtIERicy5cbiAgICogQHBhcmFtIHtcIm1pZ3JhdGlvblwiIHwgXCJzY2hlbWFEdW1wXCJ9IFthcmdzLnJlYXNvbl0gLSBXaHkgdGhlIHN0cnVjdHVyZSB3cml0ZSBpcyBiZWluZyB0cmlnZ2VyZWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBhZnRlck1pZ3JhdGlvbnMoe2RicywgcmVhc29uID0gXCJtaWdyYXRpb25cIn0pIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKClcblxuICAgIGlmICghY29uZmlndXJhdGlvbi5zaG91bGRXcml0ZVN0cnVjdHVyZVNxbCh7cmVhc29ufSkpIHJldHVyblxuXG4gICAgY29uc3QgZGJEaXIgPSBwYXRoLmpvaW4oY29uZmlndXJhdGlvbi5nZXREaXJlY3RvcnkoKSwgXCJkYlwiKVxuICAgIGNvbnN0IHN0cnVjdHVyZVNxbEJ5SWRlbnRpZmllciA9IGF3YWl0IHRoaXMuX3N0cnVjdHVyZVNxbEJ5SWRlbnRpZmllcih7ZGJzfSlcblxuICAgIGF3YWl0IGZzLm1rZGlyKGRiRGlyLCB7cmVjdXJzaXZlOiB0cnVlfSlcblxuICAgIGZvciAoY29uc3QgaWRlbnRpZmllciBvZiBPYmplY3Qua2V5cyhzdHJ1Y3R1cmVTcWxCeUlkZW50aWZpZXIpKSB7XG4gICAgICBjb25zdCBzdHJ1Y3R1cmVTcWwgPSBzdHJ1Y3R1cmVTcWxCeUlkZW50aWZpZXJbaWRlbnRpZmllcl1cblxuICAgICAgaWYgKCFzdHJ1Y3R1cmVTcWwpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IGZpbGVQYXRoID0gcGF0aC5qb2luKGRiRGlyLCBgc3RydWN0dXJlLSR7aWRlbnRpZmllcn0uc3FsYClcblxuICAgICAgYXdhaXQgZnMud3JpdGVGaWxlKGZpbGVQYXRoLCBzdHJ1Y3R1cmVTcWwpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc3RydWN0dXJlIHNxbCBieSBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0Pn0gYXJncy5kYnMgLSBEYnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlY29yZDxzdHJpbmcsIHN0cmluZz4+fSAtIFJlc29sdmVzIHdpdGggU1FMIHN0cmluZy5cbiAgICovXG4gIGFzeW5jIF9zdHJ1Y3R1cmVTcWxCeUlkZW50aWZpZXIoe2Ric30pIHtcbiAgICBjb25zdCBzcWxCeUlkZW50aWZpZXIgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZz59ICovICh7fSlcblxuICAgIGZvciAoY29uc3QgaWRlbnRpZmllciBvZiBPYmplY3Qua2V5cyhkYnMpKSB7XG4gICAgICBjb25zdCBkYiA9IGRic1tpZGVudGlmaWVyXVxuXG4gICAgICBpZiAodHlwZW9mIGRiLnN0cnVjdHVyZVNxbCAhPT0gXCJmdW5jdGlvblwiKSBjb250aW51ZVxuXG4gICAgICBjb25zdCBzdHJ1Y3R1cmVTcWwgPSBhd2FpdCBkYi5zdHJ1Y3R1cmVTcWwoKVxuXG4gICAgICBpZiAoc3RydWN0dXJlU3FsKSB7XG4gICAgICAgIGNvbnN0IG1pZ3JhdGlvbkluc2VydHMgPSBhd2FpdCB0aGlzLl9zY2hlbWFNaWdyYXRpb25zSW5zZXJ0U3FsKHtkYn0pXG5cbiAgICAgICAgc3FsQnlJZGVudGlmaWVyW2lkZW50aWZpZXJdID0gc3RydWN0dXJlU3FsICsgbWlncmF0aW9uSW5zZXJ0c1xuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBzcWxCeUlkZW50aWZpZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBHZW5lcmF0ZXMgSU5TRVJUIHN0YXRlbWVudHMgZm9yIGV2ZXJ5IHJvdyBpbiBgc2NoZW1hX21pZ3JhdGlvbnNgIHNvIHRoZVxuICAgKiBzdHJ1Y3R1cmUgc25hcHNob3QgY2FycmllcyB0aGUgbWlncmF0aW9uIGxlZGdlciBhbG9uZyB3aXRoIHRoZSBEREwuICBXaXRob3V0XG4gICAqIHRoZXNlIHJvd3MgYSBmcmVzaCBEQiBsb2FkZWQgZnJvbSB0aGUgc25hcHNob3Qgd2lsbCByZS1ydW4gZXZlcnkgbWlncmF0aW9uLFxuICAgKiB3aGljaCBmYWlscyB3aGVuIHRoZSBzbmFwc2hvdCBhbHJlYWR5IGNvbnRhaW5zIHRoZSBwb3N0LW1pZ3JhdGlvbiBzY2hlbWEuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGFyZ3MuZGIgLSBEYXRhYmFzZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSAtIElOU0VSVCBzdGF0ZW1lbnRzIChlbXB0eSBzdHJpbmcgd2hlbiBub25lKS5cbiAgICovXG4gIGFzeW5jIF9zY2hlbWFNaWdyYXRpb25zSW5zZXJ0U3FsKHtkYn0pIHtcbiAgICBjb25zdCB7ZGVmYXVsdDogTWlncmF0aW9uc0xlZGdlcn0gPSBhd2FpdCBpbXBvcnQoXCIuLi9kYXRhYmFzZS9taWdyYXRpb25zLWxlZGdlci5qc1wiKVxuXG4gICAgaWYgKCFhd2FpdCBNaWdyYXRpb25zTGVkZ2VyLnRhYmxlRXhpc3RzKGRiKSkgcmV0dXJuIFwiXCJcblxuICAgIGNvbnN0IHZlcnNpb25zID0gYXdhaXQgTWlncmF0aW9uc0xlZGdlci5hcHBsaWVkVmVyc2lvbnMoZGIpXG5cbiAgICBpZiAodmVyc2lvbnMubGVuZ3RoID09IDApIHJldHVybiBcIlwiXG5cbiAgICByZXR1cm4gdmVyc2lvbnMubWFwKCh2ZXJzaW9uKSA9PiBgSU5TRVJUIElOVE8gc2NoZW1hX21pZ3JhdGlvbnMgKHZlcnNpb24pIFZBTFVFUyAoJHtkYi5xdW90ZSh2ZXJzaW9uKX0pO2ApLmpvaW4oXCJcXG5cIikgKyBcIlxcblwiXG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIGZyb250ZW5kLW1vZGVsIHdlYnNvY2tldCBjaGFubmVsIHB1Ymxpc2hlcnMgc28gbGlmZWN5Y2xlXG4gICAqIGV2ZW50IGhvb2tzIGJyb2FkY2FzdCBvdmVyIHRoZSBzaGFyZWQgXCJmcm9udGVuZC1tb2RlbHNcIiBjaGFubmVsLlxuICAgKiBUaGlzIGlzIG9ubHkgaW1wbGVtZW50ZWQgYnkgdGhlIE5vZGUgaGFuZGxlciBiZWNhdXNlIHRoZSByZXF1aXJlZFxuICAgKiBtb2R1bGVzIChgZnJvbnRlbmQtbW9kZWwtY29udHJvbGxlcmAsIGByb3V0ZXMvcmVzb2x2ZXJgKSBwdWxsIGluXG4gICAqIHNlcnZlci1vbmx5IE5vZGUgQVBJcyB0aGF0IGJyZWFrIGJyb3dzZXIgYnVuZGxlcnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBjb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGluaXRpYWxpemVGcm9udGVuZE1vZGVsV2Vic29ja2V0UHVibGlzaGVycyhjb25maWd1cmF0aW9uKSB7XG4gICAgLy8gRGlzY292ZXIgZWFjaCBiYWNrZW5kIHByb2plY3QncyByZXNvdXJjZXMgYmVmb3JlIHJlZ2lzdGVyaW5nIHB1Ymxpc2hlcnMuIFRoZSBwdWJsaXNoZXJzIGFyZVxuICAgIC8vIGRlcml2ZWQgZnJvbSBgYmFja2VuZFByb2plY3QuZnJvbnRlbmRNb2RlbHNgLCB3aGljaCBgYXV0b0Rpc2NvdmVyUmVzb3VyY2VzYCBwb3B1bGF0ZXMuIFdpdGhvdXRcbiAgICAvLyB0aGlzLCByZWdpc3RyYXRpb24gcnVucyBhZ2FpbnN0IGFuIGVtcHR5L3BhcnRpYWwgcmVzb3VyY2Ugc2V0IChvbmx5IGJ1aWx0LWlucyksIHNvIGFwcHMgdGhhdFxuICAgIC8vIHJlc29sdmUgcmVzb3VyY2VzIHRocm91Z2ggYW4gYGFiaWxpdHlSZXNvbHZlcmAgcmF0aGVyIHRoYW4gYSBzdGF0aWMgYWJpbGl0eS1yZXNvdXJjZSBsaXN0IG5ldmVyXG4gICAgLy8gcmVnaXN0ZXIgbGlmZWN5Y2xlIHB1Ymxpc2hlcnMgYW5kIHRoZWlyIHJlYWx0aW1lIGZyb250ZW5kLW1vZGVsIHVwZGF0ZXMgc2lsZW50bHkgc3RvcC4gVGhlXG4gICAgLy8gbGlmZWN5Y2xlIGhvb2tzIGFyZSBkZWR1cGVkIHBlciBtb2RlbCBjbGFzcyB2aWEgYSBwcm9jZXNzLWdsb2JhbCBzZXQsIHNvIGEgbGF0ZXIsIGZ1bGx5XG4gICAgLy8gZGlzY292ZXJlZCBwYXNzIGNhbm5vdCByZXRyb2FjdGl2ZWx5IGFkZCB0aGUgbWlzc2luZyBwdWJsaXNoZXJzLiBgYXV0b0Rpc2NvdmVyUmVzb3VyY2VzYCBpc1xuICAgIC8vIGlkZW1wb3RlbnQgKGl0IHNraXBzIGJhY2tlbmQgcHJvamVjdHMgd2hvc2UgYGZyb250ZW5kTW9kZWxzYCBhcmUgYWxyZWFkeSBzZXQpLlxuICAgIGF3YWl0IHRoaXMuYXV0b0Rpc2NvdmVyUmVzb3VyY2VzKGNvbmZpZ3VyYXRpb24pXG5cbiAgICBjb25zdCB7ZW5zdXJlRnJvbnRlbmRNb2RlbFdlYnNvY2tldFB1Ymxpc2hlcnNSZWdpc3RlcmVkfSA9IGF3YWl0IGltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVscy93ZWJzb2NrZXQtcHVibGlzaGVycy5qc1wiKVxuXG4gICAgYXdhaXQgZW5zdXJlRnJvbnRlbmRNb2RlbFdlYnNvY2tldFB1Ymxpc2hlcnNSZWdpc3RlcmVkKGNvbmZpZ3VyYXRpb24pXG4gIH1cbn1cbiJdfQ==