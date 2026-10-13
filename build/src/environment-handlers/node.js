// @ts-check
import "../database/annotations-async-hooks.js";
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibm9kZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9lbnZpcm9ubWVudC1oYW5kbGVycy9ub2RlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLHdDQUF3QyxDQUFBO0FBQy9DLE9BQU8sSUFBSSxNQUFNLFdBQVcsQ0FBQTtBQUM1QixPQUFPLG9CQUFvQixNQUFNLDhCQUE4QixDQUFBO0FBQy9ELE9BQU8sd0JBQXdCLE1BQU0sbUNBQW1DLENBQUE7QUFDeEUsT0FBTywyQkFBMkIsTUFBTSwwQ0FBMEMsQ0FBQTtBQUNsRixPQUFPLGVBQWUsTUFBTSw2QkFBNkIsQ0FBQTtBQUN6RCxPQUFPLDZCQUE2QixNQUFNLDZDQUE2QyxDQUFBO0FBQ3ZGLE9BQU8saUNBQWlDLE1BQU0saURBQWlELENBQUE7QUFDL0YsT0FBTyw0QkFBNEIsTUFBTSwyQ0FBMkMsQ0FBQTtBQUNwRixPQUFPLHdCQUF3QixNQUFNLHVDQUF1QyxDQUFBO0FBQzVFLE9BQU8sNEJBQTRCLE1BQU0sMkNBQTJDLENBQUE7QUFDcEYsT0FBTyxjQUFjLE1BQU0sNEJBQTRCLENBQUE7QUFDdkQsT0FBTyxpQkFBaUIsTUFBTSwrQkFBK0IsQ0FBQTtBQUM3RCxPQUFPLGlCQUFpQixNQUFNLCtCQUErQixDQUFBO0FBQzdELE9BQU8sZUFBZSxNQUFNLDZCQUE2QixDQUFBO0FBQ3pELE9BQU8sa0NBQWtDLE1BQU0sbURBQW1ELENBQUE7QUFDbEcsT0FBTyw2QkFBNkIsTUFBTSw2Q0FBNkMsQ0FBQTtBQUN2RixPQUFPLGlDQUFpQyxNQUFNLGlEQUFpRCxDQUFBO0FBQy9GLE9BQU8sK0JBQStCLE1BQU0sK0NBQStDLENBQUE7QUFDM0YsT0FBTywrQkFBK0IsTUFBTSwrQ0FBK0MsQ0FBQTtBQUMzRixPQUFPLCtCQUErQixNQUFNLCtDQUErQyxDQUFBO0FBQzNGLE9BQU8saUJBQWlCLE1BQU0sK0JBQStCLENBQUE7QUFDN0QsT0FBTyxrQkFBa0Is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SCxDQUFDO0lBRUQ7Ozs7Ozs7O09BUUc7SUFDSCxLQUFLLENBQUMsMENBQTBDLENBQUMsYUFBYTtRQUM1RCw4RkFBOEY7UUFDOUYsaUdBQWlHO1FBQ2pHLCtGQUErRjtRQUMvRixrR0FBa0c7UUFDbEcsNkZBQTZGO1FBQzdGLDBGQUEwRjtRQUMxRiw4RkFBOEY7UUFDOUYsaUZBQWlGO1FBQ2pGLE1BQU0sSUFBSSxDQUFDLHFCQUFxQixDQUFDLGFBQWEsQ0FBQyxDQUFBO1FBRS9DLE1BQU0sRUFBQyxnREFBZ0QsRUFBQyxHQUFHLE1BQU0sTUFBTSxDQUFDLDRDQUE0QyxDQUFDLENBQUE7UUFFckgsTUFBTSxnREFBZ0QsQ0FBQyxhQUFhLENBQUMsQ0FBQTtJQUN2RSxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IFwiLi4vZGF0YWJhc2UvYW5ub3RhdGlvbnMtYXN5bmMtaG9va3MuanNcIlxuaW1wb3J0IEJhc2UgZnJvbSBcIi4vYmFzZS5qc1wiXG5pbXBvcnQgQmFja2dyb3VuZEpvYnNDbGllbnQgZnJvbSBcIi4uL2JhY2tncm91bmQtam9icy9jbGllbnQuanNcIlxuaW1wb3J0IFNxbEJhY2tncm91bmRKb2JzQWRhcHRlciBmcm9tIFwiLi4vYmFja2dyb3VuZC1qb2JzL3NxbC1hZGFwdGVyLmpzXCJcbmltcG9ydCBDbGlDb21tYW5kc0Rlc3Ryb3lNaWdyYXRpb24gZnJvbSBcIi4vbm9kZS9jbGkvY29tbWFuZHMvZGVzdHJveS9taWdyYXRpb24uanNcIlxuaW1wb3J0IENsaUNvbW1hbmRzSW5pdCBmcm9tIFwiLi9ub2RlL2NsaS9jb21tYW5kcy9pbml0LmpzXCJcbmltcG9ydCBDbGlDb21tYW5kc0dlbmVyYXRlQmFzZU1vZGVscyBmcm9tIFwiLi9ub2RlL2NsaS9jb21tYW5kcy9nZW5lcmF0ZS9iYXNlLW1vZGVscy5qc1wiXG5pbXBvcnQgQ2xpQ29tbWFuZHNHZW5lcmF0ZUZyb250ZW5kTW9kZWxzIGZyb20gXCIuL25vZGUvY2xpL2NvbW1hbmRzL2dlbmVyYXRlL2Zyb250ZW5kLW1vZGVscy5qc1wiXG5pbXBvcnQgQ2xpQ29tbWFuZHNHZW5lcmF0ZU1pZ3JhdGlvbiBmcm9tIFwiLi9ub2RlL2NsaS9jb21tYW5kcy9nZW5lcmF0ZS9taWdyYXRpb24uanNcIlxuaW1wb3J0IENsaUNvbW1hbmRzR2VuZXJhdGVNb2RlbCBmcm9tIFwiLi9ub2RlL2NsaS9jb21tYW5kcy9nZW5lcmF0ZS9tb2RlbC5qc1wiXG5pbXBvcnQgQ2xpQ29tbWFuZHNMaW50UmVsYXRpb25zaGlwcyBmcm9tIFwiLi9ub2RlL2NsaS9jb21tYW5kcy9saW50L3JlbGF0aW9uc2hpcHMuanNcIlxuaW1wb3J0IENsaUNvbW1hbmRzTWNwIGZyb20gXCIuL25vZGUvY2xpL2NvbW1hbmRzL21jcC5qc1wiXG5pbXBvcnQgQ2xpQ29tbWFuZHNSb3V0ZXMgZnJvbSBcIi4vbm9kZS9jbGkvY29tbWFuZHMvcm91dGVzLmpzXCJcbmltcG9ydCBDbGlDb21tYW5kc1NlcnZlciBmcm9tIFwiLi9ub2RlL2NsaS9jb21tYW5kcy9zZXJ2ZXIuanNcIlxuaW1wb3J0IENsaUNvbW1hbmRzVGVzdCBmcm9tIFwiLi9ub2RlL2NsaS9jb21tYW5kcy90ZXN0LmpzXCJcbmltcG9ydCBDbGlDb21tYW5kc1Rlc3RUaW1pbmdNYW5pZmVzdE1lcmdlIGZyb20gXCIuL25vZGUvY2xpL2NvbW1hbmRzL3Rlc3QvdGltaW5nLW1hbmlmZXN0L21lcmdlLmpzXCJcbmltcG9ydCBDbGlDb21tYW5kc0JhY2tncm91bmRKb2JzTWFpbiBmcm9tIFwiLi9ub2RlL2NsaS9jb21tYW5kcy9iYWNrZ3JvdW5kLWpvYnMtbWFpbi5qc1wiXG5pbXBvcnQgQ2xpQ29tbWFuZHNCYWNrZ3JvdW5kSm9ic0FjdGl2YXRlIGZyb20gXCIuL25vZGUvY2xpL2NvbW1hbmRzL2JhY2tncm91bmQtam9icy1hY3RpdmF0ZS5qc1wiXG5pbXBvcnQgQ2xpQ29tbWFuZHNCYWNrZ3JvdW5kSm9ic1JldGlyZSBmcm9tIFwiLi9ub2RlL2NsaS9jb21tYW5kcy9iYWNrZ3JvdW5kLWpvYnMtcmV0aXJlLmpzXCJcbmltcG9ydCBDbGlDb21tYW5kc0JhY2tncm91bmRKb2JzV29ya2VyIGZyb20gXCIuL25vZGUvY2xpL2NvbW1hbmRzL2JhY2tncm91bmQtam9icy13b3JrZXIuanNcIlxuaW1wb3J0IENsaUNvbW1hbmRzQmFja2dyb3VuZEpvYnNSdW5uZXIgZnJvbSBcIi4vbm9kZS9jbGkvY29tbWFuZHMvYmFja2dyb3VuZC1qb2JzLXJ1bm5lci5qc1wiXG5pbXBvcnQgQ2xpQ29tbWFuZHNCZWFjb24gZnJvbSBcIi4vbm9kZS9jbGkvY29tbWFuZHMvYmVhY29uLmpzXCJcbmltcG9ydCBDbGlDb21tYW5kc0NvbnNvbGUgZnJvbSBcIi4vbm9kZS9jbGkvY29tbWFuZHMvY29uc29sZS5qc1wiXG5pbXBvcnQgQ2xpQ29tbWFuZHNEYlNjaGVtYUR1bXAgZnJvbSBcIi4vbm9kZS9jbGkvY29tbWFuZHMvZGIvc2NoZW1hL2R1bXAuanNcIlxuaW1wb3J0IENsaUNvbW1hbmRzRGJTY2hlbWFMb2FkIGZyb20gXCIuL25vZGUvY2xpL2NvbW1hbmRzL2RiL3NjaGVtYS9sb2FkLmpzXCJcbmltcG9ydCBDbGlDb21tYW5kc0RiU2VlZCBmcm9tIFwiLi9ub2RlL2NsaS9jb21tYW5kcy9kYi9zZWVkLmpzXCJcbmltcG9ydCBDbGlDb21tYW5kc1J1bm5lciBmcm9tIFwiLi9ub2RlL2NsaS9jb21tYW5kcy9ydW5uZXIuanNcIlxuaW1wb3J0IENsaUNvbW1hbmRzUnVuU2NyaXB0IGZyb20gXCIuL25vZGUvY2xpL2NvbW1hbmRzL3J1bi1zY3JpcHQuanNcIlxuaW1wb3J0IGZyb250ZW5kTW9kZWxDb21tYW5kUm91dGVIb29rIGZyb20gXCIuLi9yb3V0ZXMvaG9va3MvZnJvbnRlbmQtbW9kZWwtY29tbWFuZC1yb3V0ZS1ob29rLmpzXCJcbmltcG9ydCB7IEZSQU1FV09SS19TT1VSQ0VfRElSRUNUT1JZIH0gZnJvbSBcIi4uL3V0aWxzL2JhY2t0cmFjZS1jbGVhbmVyLW5vZGUuanNcIlxuaW1wb3J0IHsgZGlybmFtZSB9IGZyb20gXCJwYXRoXCJcbmltcG9ydCB7IGZpbGVVUkxUb1BhdGggfSBmcm9tIFwidXJsXCJcbmltcG9ydCBmcyBmcm9tIFwiZnMvcHJvbWlzZXNcIlxuaW1wb3J0ICogYXMgaW5mbGVjdGlvbiBmcm9tIFwiaW5mbGVjdGlvblwiXG5pbXBvcnQgcGF0aCBmcm9tIFwicGF0aFwiXG5pbXBvcnQgeyBBc3luY0xvY2FsU3RvcmFnZSBhcyBOb2RlQXN5bmNMb2NhbFN0b3JhZ2UgfSBmcm9tIFwibm9kZTphc3luY19ob29rc1wiXG5pbXBvcnQgeyB0aW1pbmdTYWZlRXF1YWwgfSBmcm9tIFwibm9kZTpjcnlwdG9cIlxuaW1wb3J0IHJlcXVpcmVDb250ZXh0IGZyb20gXCJyZXF1aXJlLWNvbnRleHRcIlxuaW1wb3J0IEFzeW5jVHJhY2tlZE11bHRpQ29ubmVjdGlvblBvb2wgZnJvbSBcIi4uL2RhdGFiYXNlL3Bvb2wvYXN5bmMtdHJhY2tlZC1tdWx0aS1jb25uZWN0aW9uLmpzXCJcbmltcG9ydCBJbml0aWFsaXplckZyb21SZXF1aXJlQ29udGV4dCBmcm9tIFwiLi4vZGF0YWJhc2UvaW5pdGlhbGl6ZXItZnJvbS1yZXF1aXJlLWNvbnRleHQuanNcIlxuaW1wb3J0IFJlY29yZEF0dGFjaG1lbnRzU3RvcmUgZnJvbSBcIi4uL2RhdGFiYXNlL3JlY29yZC9hdHRhY2htZW50cy9zdG9yZS5qc1wiXG5pbXBvcnQgdG9JbXBvcnRTcGVjaWZpZXIgZnJvbSBcIi4uL3V0aWxzL3RvLWltcG9ydC1zcGVjaWZpZXIuanNcIlxuaW1wb3J0IHsgdmFsaWRhdGVUaW1lWm9uZSB9IGZyb20gXCIuLi90aW1lLXpvbmUuanNcIlxuaW1wb3J0IEF0dGFjaG1lbnRQYXRoU291cmNlIGZyb20gXCIuL25vZGUvYXR0YWNobWVudC1wYXRoLXNvdXJjZS5qc1wiXG5pbXBvcnQgeyBhdXRvbWF0aWNTaGFyZWRUcmFuc2FjdGlvbkJyb2tlck9taXRzLCBjcmVhdGVTaGFyZWRUcmFuc2FjdGlvblByb3h5RHJpdmVyLCBzaGFyZWRUcmFuc2FjdGlvbkJyb2tlckNvbmZpZyB9IGZyb20gXCIuLi90ZXN0aW5nL3NoYXJlZC10cmFuc2FjdGlvbi1wcm94eS1kcml2ZXIuanNcIlxuXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYge3thYmlsaXR5PzogaW1wb3J0KFwiLi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHQsIG9mZnNldE1pbnV0ZXM6IG51bWJlciwgcmVxdWVzdFRpbWluZz86IGltcG9ydChcIi4uL2h0dHAtc2VydmVyL2NsaWVudC9yZXF1ZXN0LXRpbWluZy5qc1wiKS5kZWZhdWx0LCB0ZW5hbnQ/OiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgdGVzdFByb2ZpbGVDb250ZXh0PzogaW1wb3J0KFwiLi4vdGVzdGluZy90ZXN0LXByb2ZpbGVyLmpzXCIpLlRlc3RQcm9maWxlQXN5bmNDb250ZXh0LCB0aW1lWm9uZT86IHN0cmluZ319IFRpbWV6b25lU3RvcmUgKi9cblxuLyoqXG4gKiBSdW5zIHBhdGggd2l0aGluIGFsbG93ZWQgcHJlZml4ZXMuXG4gKiBAcGFyYW0ge3N0cmluZ30gZmlsZVBhdGggLSBJbnB1dCBmaWxlIHBhdGguXG4gKiBAcGFyYW0ge3N0cmluZ1tdfSBhbGxvd2VkUGF0aFByZWZpeGVzIC0gQWxsb3dlZCBwYXRoIHByZWZpeGVzLlxuICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBpbnB1dCBwYXRoIGlzIGluc2lkZSBhbiBhbGxvd2VkIHByZWZpeC5cbiAqL1xuZnVuY3Rpb24gcGF0aFdpdGhpbkFsbG93ZWRQcmVmaXhlcyhmaWxlUGF0aCwgYWxsb3dlZFBhdGhQcmVmaXhlcykge1xuICBjb25zdCByZXNvbHZlZFBhdGggPSBwYXRoLnJlc29sdmUoZmlsZVBhdGgpXG5cbiAgcmV0dXJuIGFsbG93ZWRQYXRoUHJlZml4ZXMuc29tZSgoYWxsb3dlZFByZWZpeCkgPT4ge1xuICAgIGNvbnN0IHJlc29sdmVkUHJlZml4ID0gcGF0aC5yZXNvbHZlKGFsbG93ZWRQcmVmaXgpXG4gICAgY29uc3QgcmVsYXRpdmVQYXRoID0gcGF0aC5yZWxhdGl2ZShyZXNvbHZlZFByZWZpeCwgcmVzb2x2ZWRQYXRoKVxuXG4gICAgaWYgKCFyZWxhdGl2ZVBhdGgpIHJldHVybiB0cnVlXG4gICAgaWYgKHJlbGF0aXZlUGF0aC5zdGFydHNXaXRoKFwiLi5cIikpIHJldHVybiBmYWxzZVxuICAgIGlmIChwYXRoLmlzQWJzb2x1dGUocmVsYXRpdmVQYXRoKSkgcmV0dXJuIGZhbHNlXG5cbiAgICByZXR1cm4gdHJ1ZVxuICB9KVxufVxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBWZWxvY2lvdXNFbnZpcm9ubWVudEhhbmRsZXJOb2RlIGV4dGVuZHMgQmFzZXtcbiAgLyoqXG4gICAqIENyZWF0ZXMgdGhlIGJ1aWx0LWluIFNRTCBwZXJzaXN0ZW5jZSBhZGFwdGVyLlxuICAgKiBAcGFyYW0ge3tjb25maWd1cmF0aW9uOiBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9fSBhcmdzIC0gQWRhcHRlciBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7U3FsQmFja2dyb3VuZEpvYnNBZGFwdGVyfSAtIFNRTCBhZGFwdGVyLlxuICAgKi9cbiAgY3JlYXRlQmFja2dyb3VuZEpvYnNBZGFwdGVyKHtjb25maWd1cmF0aW9ufSkge1xuICAgIHJldHVybiBuZXcgU3FsQmFja2dyb3VuZEpvYnNBZGFwdGVyKHtjb25maWd1cmF0aW9ufSlcbiAgfVxuXG4gIC8qKlxuICAgKiBQcmVzZXJ2ZXMgdGhlIE5vZGUgVENQIHByb2R1Y2VyIGFuZCBtYWluLXByb2Nlc3Mgd2FrZS11cCBwYXRoLiBUaGUgbWFpblxuICAgKiBvd25zIHRoZSBjb25maWd1cmVkIHBlcnNpc3RlbmNlIGFkYXB0ZXI7IE5vZGUgcHJvZHVjZXJzIG5ldmVyIGJ5cGFzcyBpdC5cbiAgICogQHBhcmFtIHt7Y29uZmlndXJhdGlvbjogaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fX0gYXJncyAtIENsaWVudCBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vYmFja2dyb3VuZC1qb2JzL3R5cGVzLmpzXCIpLkJhY2tncm91bmRKb2JzUHJvZHVjZXJ9IC0gUHJvZHVjZXIgY2xpZW50LlxuICAgKi9cbiAgYmFja2dyb3VuZEpvYnNDbGllbnQoe2NvbmZpZ3VyYXRpb259KSB7XG4gICAgcmV0dXJuIG5ldyBCYWNrZ3JvdW5kSm9ic0NsaWVudCh7Y29uZmlndXJhdGlvbn0pXG4gIH1cblxuICAvKipcbiAgICogR2l2ZXMgY29uY3VycmVudCBzaGFyZWQtdHJhbnNhY3Rpb24gY2hpbGQgam9icyBpbmRlcGVuZGVudCBwcm94eSBzZXNzaW9ucy5cbiAgICogQSBjb25maWd1cmVkIHNpbmdsZS1jb25uZWN0aW9uIHBvb2wgc2hhcmVzIG11dGFibGUgdHJhbnNhY3Rpb24gc3RhdGUgYmV0d2VlblxuICAgKiBhc3luYyBqb2JzLCB3aGlsZSB0aGUgYnJva2VyIHJlcXVpcmVzIG9uZSByb290LXRyYW5zYWN0aW9uIGxlYXNlIHBlciBzb2NrZXQuXG4gICAqIEBwYXJhbSB7e2NvbmZpZ3VyZWRQb29sVHlwZTogdHlwZW9mIGltcG9ydChcIi4uL2RhdGFiYXNlL3Bvb2wvYmFzZS5qc1wiKS5kZWZhdWx0LCBkYXRhYmFzZUlkZW50aWZpZXI6IHN0cmluZ319IGFyZ3MgLSBDb25maWd1cmVkIHBvb2wgYW5kIGxvZ2ljYWwgZGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICogQHJldHVybnMge3R5cGVvZiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9wb29sL2Jhc2UuanNcIikuZGVmYXVsdH0gLSBQb29sIHR5cGUgZm9yIHRoaXMgY29udGV4dC5cbiAgICovXG4gIHJlc29sdmVUZXN0U2hhcmVkVHJhbnNhY3Rpb25Qb29sVHlwZSh7Y29uZmlndXJlZFBvb2xUeXBlLCBkYXRhYmFzZUlkZW50aWZpZXJ9KSB7XG4gICAgY29uc3QgZGF0YWJhc2VDb25maWd1cmF0aW9uID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZ2V0RGF0YWJhc2VJZGVudGlmaWVyKGRhdGFiYXNlSWRlbnRpZmllcilcbiAgICBpZiAoZGF0YWJhc2VDb25maWd1cmF0aW9uLnRlbmFudE9ubHkgJiYgYXV0b21hdGljU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJPbWl0cyhkYXRhYmFzZUlkZW50aWZpZXIpKSByZXR1cm4gY29uZmlndXJlZFBvb2xUeXBlXG4gICAgaWYgKCFzaGFyZWRUcmFuc2FjdGlvbkJyb2tlckNvbmZpZyhkYXRhYmFzZUlkZW50aWZpZXIpKSByZXR1cm4gY29uZmlndXJlZFBvb2xUeXBlXG5cbiAgICByZXR1cm4gQXN5bmNUcmFja2VkTXVsdGlDb25uZWN0aW9uUG9vbFxuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZXMgYSB0ZXN0LW9ubHkgY2hpbGQgcHJveHkgd2hlbiBUZXN0UnVubmVyIHN1cHBsaWVkIGFuIGFjdGl2ZSBicm9rZXIuXG4gICAqIEBwYXJhbSB7e0RyaXZlckNsYXNzOiB0eXBlb2YgaW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQsIGNvbmZpZzogaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5EYXRhYmFzZUNvbmZpZ3VyYXRpb25UeXBlLCBjb25maWd1cmF0aW9uOiBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHQsIGRhdGFiYXNlSWRlbnRpZmllcjogc3RyaW5nLCByZXVzZUtleT86IHN0cmluZ319IGFyZ3MgLSBDb25uZWN0aW9uIGRldGFpbHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkPn0gLSBPcHRpb25hbCBwcm94eS5cbiAgICovXG4gIGFzeW5jIGNyZWF0ZVRlc3RTaGFyZWRUcmFuc2FjdGlvbkNvbm5lY3Rpb24oe0RyaXZlckNsYXNzLCBjb25maWcsIGNvbmZpZ3VyYXRpb24sIGRhdGFiYXNlSWRlbnRpZmllciwgcmV1c2VLZXl9KSB7XG4gICAgaWYgKGNvbmZpZy50ZW5hbnRPbmx5ICYmIGF1dG9tYXRpY1NoYXJlZFRyYW5zYWN0aW9uQnJva2VyT21pdHMoZGF0YWJhc2VJZGVudGlmaWVyKSkgcmV0dXJuIHVuZGVmaW5lZFxuICAgIGNvbnN0IGJyb2tlckNvbmZpZyA9IHNoYXJlZFRyYW5zYWN0aW9uQnJva2VyQ29uZmlnKGRhdGFiYXNlSWRlbnRpZmllcilcbiAgICBpZiAoIWJyb2tlckNvbmZpZykgcmV0dXJuIHVuZGVmaW5lZFxuICAgIHJldHVybiBjcmVhdGVTaGFyZWRUcmFuc2FjdGlvblByb3h5RHJpdmVyKERyaXZlckNsYXNzLCBjb25maWcsIGNvbmZpZ3VyYXRpb24sIGRhdGFiYXNlSWRlbnRpZmllciwge1xuICAgICAgLi4uYnJva2VyQ29uZmlnLFxuICAgICAgcmV1c2VLZXk6IGJyb2tlckNvbmZpZy5hbGxvd0R5bmFtaWNJZGVudGl0aWVzID8gcmV1c2VLZXkgOiB1bmRlZmluZWRcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFRpbWV6b25lIGFzeW5jIGxvY2FsIHN0b3JhZ2UuXG4gICAqIEB0eXBlIHtpbXBvcnQoXCJub2RlOmFzeW5jX2hvb2tzXCIpLkFzeW5jTG9jYWxTdG9yYWdlPFRpbWV6b25lU3RvcmU+IHwgdW5kZWZpbmVkfSAqL1xuICBfdGltZXpvbmVBc3luY0xvY2FsU3RvcmFnZSA9IE5vZGVBc3luY0xvY2FsU3RvcmFnZSA/IG5ldyBOb2RlQXN5bmNMb2NhbFN0b3JhZ2UoKSA6IHVuZGVmaW5lZFxuXG4gIC8qKlxuICAgKiBTaGFyZWQtdHJhbnNhY3Rpb24gY29vcmRpbmF0b3Igb3duZXJzaGlwIGJ5IHBoeXNpY2FsIGNvbm5lY3Rpb24uXG4gICAqIEB0eXBlIHtpbXBvcnQoXCJub2RlOmFzeW5jX2hvb2tzXCIpLkFzeW5jTG9jYWxTdG9yYWdlPE1hcDxvYmplY3QsIHN5bWJvbD4+IHwgdW5kZWZpbmVkfVxuICAgKi9cbiAgX3NoYXJlZFRyYW5zYWN0aW9uQ29vcmRpbmF0b3JBc3luY0xvY2FsU3RvcmFnZSA9IE5vZGVBc3luY0xvY2FsU3RvcmFnZSA/IG5ldyBOb2RlQXN5bmNMb2NhbFN0b3JhZ2UoKSA6IHVuZGVmaW5lZFxuXG4gIC8qKlxuICAgKiBHZXRzIHRoZSBhY3RpdmUgc2hhcmVkLXRyYW5zYWN0aW9uIGNvb3JkaW5hdG9yIG93bmVyIGZvciBhIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBjb25uZWN0aW9uIC0gUGFyZW50IHBoeXNpY2FsIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtzeW1ib2wgfCB1bmRlZmluZWR9IC0gQWN0aXZlIGNvb3JkaW5hdG9yIG93bmVyLlxuICAgKi9cbiAgZ2V0U2hhcmVkVHJhbnNhY3Rpb25Db29yZGluYXRvck93bmVyKGNvbm5lY3Rpb24pIHtcbiAgICByZXR1cm4gdGhpcy5fc2hhcmVkVHJhbnNhY3Rpb25Db29yZGluYXRvckFzeW5jTG9jYWxTdG9yYWdlPy5nZXRTdG9yZSgpPy5nZXQoY29ubmVjdGlvbilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdvcmsgYXMgdGhlIGN1cnJlbnQgc2hhcmVkLXRyYW5zYWN0aW9uIGNvb3JkaW5hdG9yIG93bmVyLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge29iamVjdH0gY29ubmVjdGlvbiAtIFBhcmVudCBwaHlzaWNhbCBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3N5bWJvbH0gb3duZXIgLSBDb29yZGluYXRvciBvd25lci5cbiAgICogQHBhcmFtIHsoKSA9PiBUfSBjYWxsYmFjayAtIE93bmVkIHdvcmsuXG4gICAqIEByZXR1cm5zIHtUfSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIHJ1bldpdGhTaGFyZWRUcmFuc2FjdGlvbkNvb3JkaW5hdG9yT3duZXIoY29ubmVjdGlvbiwgb3duZXIsIGNhbGxiYWNrKSB7XG4gICAgaWYgKCF0aGlzLl9zaGFyZWRUcmFuc2FjdGlvbkNvb3JkaW5hdG9yQXN5bmNMb2NhbFN0b3JhZ2UpIHJldHVybiBjYWxsYmFjaygpXG5cbiAgICBjb25zdCBvd25lcnMgPSBuZXcgTWFwKHRoaXMuX3NoYXJlZFRyYW5zYWN0aW9uQ29vcmRpbmF0b3JBc3luY0xvY2FsU3RvcmFnZS5nZXRTdG9yZSgpKVxuXG4gICAgb3duZXJzLnNldChjb25uZWN0aW9uLCBvd25lcilcbiAgICByZXR1cm4gdGhpcy5fc2hhcmVkVHJhbnNhY3Rpb25Db29yZGluYXRvckFzeW5jTG9jYWxTdG9yYWdlLnJ1bihvd25lcnMsIGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd29yayB3aXRob3V0IGluaGVyaXRlZCBzaGFyZWQtdHJhbnNhY3Rpb24gb3duZXJzaGlwIGZvciBvbmUgY29ubmVjdGlvbi5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gY29ubmVjdGlvbiAtIFBoeXNpY2FsIGNvbm5lY3Rpb24gd2hvc2Ugb3duZXIgaXMgY2xlYXJlZC5cbiAgICogQHBhcmFtIHsoKSA9PiBUfSBjYWxsYmFjayAtIFBoeXNpY2FsIGNvbm5lY3Rpb24gd29yay5cbiAgICogQHJldHVybnMge1R9IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgcnVuV2l0aG91dFNoYXJlZFRyYW5zYWN0aW9uQ29vcmRpbmF0b3JPd25lcihjb25uZWN0aW9uLCBjYWxsYmFjaykge1xuICAgIGlmICghdGhpcy5fc2hhcmVkVHJhbnNhY3Rpb25Db29yZGluYXRvckFzeW5jTG9jYWxTdG9yYWdlKSByZXR1cm4gY2FsbGJhY2soKVxuXG4gICAgY29uc3Qgb3duZXJzID0gbmV3IE1hcCh0aGlzLl9zaGFyZWRUcmFuc2FjdGlvbkNvb3JkaW5hdG9yQXN5bmNMb2NhbFN0b3JhZ2UuZ2V0U3RvcmUoKSlcblxuICAgIG93bmVycy5kZWxldGUoY29ubmVjdGlvbilcbiAgICByZXR1cm4gdGhpcy5fc2hhcmVkVHJhbnNhY3Rpb25Db29yZGluYXRvckFzeW5jTG9jYWxTdG9yYWdlLnJ1bihvd25lcnMsIGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd29yayB3aXRob3V0IGluaGVyaXRlZCBzaGFyZWQtdHJhbnNhY3Rpb24gY29vcmRpbmF0b3Igb3duZXJzaGlwLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0geygpID0+IFR9IGNhbGxiYWNrIC0gRGV0YWNoZWQgd29yay5cbiAgICogQHJldHVybnMge1R9IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgcnVuV2l0aG91dFNoYXJlZFRyYW5zYWN0aW9uQ29vcmRpbmF0b3JPd25lcnMoY2FsbGJhY2spIHtcbiAgICBpZiAoIXRoaXMuX3NoYXJlZFRyYW5zYWN0aW9uQ29vcmRpbmF0b3JBc3luY0xvY2FsU3RvcmFnZSkgcmV0dXJuIGNhbGxiYWNrKClcblxuICAgIHJldHVybiB0aGlzLl9zaGFyZWRUcmFuc2FjdGlvbkNvb3JkaW5hdG9yQXN5bmNMb2NhbFN0b3JhZ2UucnVuKG5ldyBNYXAoKSwgY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogUnVucyB3b3JrIHdpdGggYXN5bmMtc2FmZSB0ZXN0IHByb2ZpbGUgYXR0cmlidXRpb24uXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vdGVzdGluZy90ZXN0LXByb2ZpbGVyLmpzXCIpLlRlc3RQcm9maWxlQXN5bmNDb250ZXh0IHwgdW5kZWZpbmVkfSBjb250ZXh0IC0gQ2FwdHVyZWQgcHJvZmlsZSBjb250ZXh0LCBvciBhbiBleHBsaWNpdCBhYnNlbmNlIG9mIGF0dHJpYnV0aW9uLlxuICAgKiBAcGFyYW0geygpID0+IFR9IGNhbGxiYWNrIC0gUHJvZmlsZWQgd29yay5cbiAgICogQHJldHVybnMge1R9IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgcnVuV2l0aFRlc3RQcm9maWxlQ29udGV4dChjb250ZXh0LCBjYWxsYmFjaykge1xuICAgIGlmICghdGhpcy5fdGltZXpvbmVBc3luY0xvY2FsU3RvcmFnZSkgcmV0dXJuIGNhbGxiYWNrKClcblxuICAgIGNvbnN0IGV4aXN0aW5nU3RvcmUgPSB0aGlzLl90aW1lem9uZUFzeW5jTG9jYWxTdG9yYWdlLmdldFN0b3JlKClcblxuICAgIHJldHVybiB0aGlzLl90aW1lem9uZUFzeW5jTG9jYWxTdG9yYWdlLnJ1bih7XG4gICAgICBhYmlsaXR5OiBleGlzdGluZ1N0b3JlPy5hYmlsaXR5LFxuICAgICAgb2Zmc2V0TWludXRlczogZXhpc3RpbmdTdG9yZT8ub2Zmc2V0TWludXRlcyA/PyB0aGlzLmdldFRpbWV6b25lT2Zmc2V0TWludXRlcyh0aGlzLmdldENvbmZpZ3VyYXRpb24oKSksXG4gICAgICByZXF1ZXN0VGltaW5nOiBleGlzdGluZ1N0b3JlPy5yZXF1ZXN0VGltaW5nLFxuICAgICAgdGVuYW50OiBleGlzdGluZ1N0b3JlPy50ZW5hbnQsXG4gICAgICB0ZXN0UHJvZmlsZUNvbnRleHQ6IGNvbnRleHQsXG4gICAgICB0aW1lWm9uZTogZXhpc3RpbmdTdG9yZT8udGltZVpvbmUgPz8gdGhpcy5nZXRUaW1lWm9uZSh0aGlzLmdldENvbmZpZ3VyYXRpb24oKSlcbiAgICB9LCBjYWxsYmFjaylcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXRzIHRoZSBjdXJyZW50IGFzeW5jLXNhZmUgdGVzdCBwcm9maWxlIGF0dHJpYnV0aW9uIGNvbnRleHQuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi90ZXN0aW5nL3Rlc3QtcHJvZmlsZXIuanNcIikuVGVzdFByb2ZpbGVBc3luY0NvbnRleHQgfCB1bmRlZmluZWR9IC0gQ3VycmVudCBjb250ZXh0LlxuICAgKi9cbiAgZ2V0Q3VycmVudFRlc3RQcm9maWxlQ29udGV4dCgpIHtcbiAgICByZXR1cm4gdGhpcy5fdGltZXpvbmVBc3luY0xvY2FsU3RvcmFnZT8uZ2V0U3RvcmUoKT8udGVzdFByb2ZpbGVDb250ZXh0XG4gIH1cblxuICAvKipcbiAgICogRmluZCBjb21tYW5kcyByZXN1bHQuXG4gICAqIEB0eXBlIHtpbXBvcnQoXCIuL2Jhc2UuanNcIikuQ29tbWFuZEZpbGVPYmplY3RUeXBlW10gfCB1bmRlZmluZWR9ICovXG4gIF9maW5kQ29tbWFuZHNSZXN1bHQgPSB1bmRlZmluZWRcblxuICAvKipcbiAgICogUnVucyBkZWJ1ZyBlbmRwb2ludCB0b2tlbiBtYXRjaGVzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcHJvdmlkZWRUb2tlbiAtIFRva2VuIGZyb20gdGhlIHJlcXVlc3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBleHBlY3RlZFRva2VuIC0gQ29uZmlndXJlZCB0b2tlbi5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBib3RoIHRva2VucyBtYXRjaC5cbiAgICovXG4gIGRlYnVnRW5kcG9pbnRUb2tlbk1hdGNoZXMocHJvdmlkZWRUb2tlbiwgZXhwZWN0ZWRUb2tlbikge1xuICAgIGNvbnN0IHByb3ZpZGVkID0gQnVmZmVyLmZyb20ocHJvdmlkZWRUb2tlbilcbiAgICBjb25zdCBleHBlY3RlZCA9IEJ1ZmZlci5mcm9tKGV4cGVjdGVkVG9rZW4pXG5cbiAgICByZXR1cm4gcHJvdmlkZWQubGVuZ3RoID09PSBleHBlY3RlZC5sZW5ndGggJiYgdGltaW5nU2FmZUVxdWFsKHByb3ZpZGVkLCBleHBlY3RlZClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBmcmFtZXdvcmsgc291cmNlIGRpcmVjdG9yeS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBWZWxvY2lvdXMgc291cmNlIGRpcmVjdG9yeSB1c2VkIHRvIGZpbHRlciBmcmFtZXdvcmsgc3RhY2sgZnJhbWVzLlxuICAgKi9cbiAgZ2V0RnJhbWV3b3JrU291cmNlRGlyZWN0b3J5KCkge1xuICAgIHJldHVybiBGUkFNRVdPUktfU09VUkNFX0RJUkVDVE9SWVxuICB9XG5cbiAgLyoqXG4gICAqIEF1dG8tZGlzY292ZXJzIHJlc291cmNlIGNsYXNzZXMgZnJvbSBzcmMvcmVzb3VyY2VzLyBpbiBlYWNoIGJhY2tlbmQgcHJvamVjdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIGF1dG9EaXNjb3ZlclJlc291cmNlcyhjb25maWd1cmF0aW9uKSB7XG4gICAgY29uc3Qge2Zyb250ZW5kTW9kZWxSZXNvdXJjZURlZmluaXRpb25Jc0NsYXNzfSA9IGF3YWl0IGltcG9ydChcIi4uL2Zyb250ZW5kLW1vZGVscy9yZXNvdXJjZS1kZWZpbml0aW9uLmpzXCIpXG4gICAgY29uc3Qge2RlZmF1bHQ6IEF1dGhvcml6YXRpb25CYXNlUmVzb3VyY2V9ID0gYXdhaXQgaW1wb3J0KFwiLi4vYXV0aG9yaXphdGlvbi9iYXNlLXJlc291cmNlLmpzXCIpXG4gICAgY29uc3QgYmFja2VuZFByb2plY3RzID0gY29uZmlndXJhdGlvbi5nZXRCYWNrZW5kUHJvamVjdHMoKVxuXG4gICAgZm9yIChjb25zdCBiYWNrZW5kUHJvamVjdCBvZiBiYWNrZW5kUHJvamVjdHMpIHtcbiAgICAgIGlmIChiYWNrZW5kUHJvamVjdC5hYmlsaXR5UmVzb3VyY2VzKSBjb250aW51ZVxuXG4gICAgICBjb25zdCByZXNvdXJjZXNEaXIgPSBiYWNrZW5kUHJvamVjdC5yZXNvdXJjZXNQYXRoIHx8IHBhdGguam9pbihiYWNrZW5kUHJvamVjdC5wYXRoLCBcInNyY1wiLCBcInJlc291cmNlc1wiKVxuICAgICAgbGV0IGZpbGVzXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGZpbGVzID0gYXdhaXQgZnMucmVhZGRpcihyZXNvdXJjZXNEaXIpXG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgLyoqXG4gICAgICAgKiBEaXNjb3ZlcmVkIGZyb250ZW5kLW1vZGVsIHJlc291cmNlcyBrZXllZCBieSBtb2RlbCBuYW1lLlxuICAgICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICAgIGNvbnN0IGRpc2NvdmVyZWQgPSB7fVxuICAgICAgLyoqXG4gICAgICAgKiBFdmVyeSBkaXNjb3ZlcmVkIGFiaWxpdHkgcmVzb3VyY2UgY2xhc3MgKGZyb250ZW5kLW1vZGVsIGFuZCBhdXRob3JpemF0aW9uKS5cbiAgICAgICAqIEB0eXBlIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgICBjb25zdCBhYmlsaXR5UmVzb3VyY2VDbGFzc2VzID0gW11cblxuICAgICAgZm9yIChjb25zdCBmaWxlIG9mIGZpbGVzKSB7XG4gICAgICAgIGlmICghZmlsZS5lbmRzV2l0aChcIi5qc1wiKSAmJiAhZmlsZS5lbmRzV2l0aChcIi5tanNcIikpIGNvbnRpbnVlXG4gICAgICAgIGlmIChmaWxlLnN0YXJ0c1dpdGgoXCJmcm9udGVuZC1tb2RlbC1yZXNvdXJjZXNcIikpIGNvbnRpbnVlXG5cbiAgICAgICAgY29uc3QgZmlsZVBhdGggPSBwYXRoLmpvaW4ocmVzb3VyY2VzRGlyLCBmaWxlKVxuICAgICAgICBjb25zdCBpbXBvcnRlZCA9IGF3YWl0IGltcG9ydChmaWxlUGF0aClcbiAgICAgICAgY29uc3QgUmVzb3VyY2VDbGFzcyA9IGltcG9ydGVkLmRlZmF1bHRcblxuICAgICAgICAvLyBBbnkgYXV0aG9yaXphdGlvbiByZXNvdXJjZSAoZnJvbnRlbmQtbW9kZWwgcmVzb3VyY2VzIGFsc28gZXh0ZW5kIGl0KSB0aGF0XG4gICAgICAgIC8vIGRlY2xhcmVzIGEgYE1vZGVsQ2xhc3NgOyBza2lwIGFic3RyYWN0L2NvbW1vbiBiYXNlIHJlc291cmNlcyB3aXRob3V0IG9uZS5cbiAgICAgICAgY29uc3QgaXNBYmlsaXR5UmVzb3VyY2UgPSB0eXBlb2YgUmVzb3VyY2VDbGFzcyA9PT0gXCJmdW5jdGlvblwiXG4gICAgICAgICAgJiYgKFJlc291cmNlQ2xhc3MgPT09IEF1dGhvcml6YXRpb25CYXNlUmVzb3VyY2UgfHwgUmVzb3VyY2VDbGFzcy5wcm90b3R5cGUgaW5zdGFuY2VvZiBBdXRob3JpemF0aW9uQmFzZVJlc291cmNlKVxuXG4gICAgICAgIGlmICghaXNBYmlsaXR5UmVzb3VyY2UgfHwgIVJlc291cmNlQ2xhc3MuTW9kZWxDbGFzcykgY29udGludWVcblxuICAgICAgICBhYmlsaXR5UmVzb3VyY2VDbGFzc2VzLnB1c2goUmVzb3VyY2VDbGFzcylcblxuICAgICAgICAvLyBPbmx5IGZyb250ZW5kLW1vZGVsIHJlc291cmNlcyBkcml2ZSByb3V0aW5nL2dlbmVyYXRpb24vcHVibGlzaGVyIGRpc2NvdmVyeS5cbiAgICAgICAgaWYgKCFmcm9udGVuZE1vZGVsUmVzb3VyY2VEZWZpbml0aW9uSXNDbGFzcyhSZXNvdXJjZUNsYXNzKSkgY29udGludWVcblxuICAgICAgICBjb25zdCBiYXNlTmFtZSA9IGZpbGUucmVwbGFjZSgvXFwuKGpzfG1qcykkLywgXCJcIilcbiAgICAgICAgY29uc3QgbW9kZWxOYW1lID0gYmFzZU5hbWUucmVwbGFjZSgvLXJlc291cmNlJC8sIFwiXCIpXG4gICAgICAgICAgLnNwbGl0KFwiLVwiKVxuICAgICAgICAgIC5tYXAoKC8qKiBAdHlwZSB7c3RyaW5nfSAqLyBwYXJ0KSA9PiBwYXJ0LmNoYXJBdCgwKS50b1VwcGVyQ2FzZSgpICsgcGFydC5zbGljZSgxKSlcbiAgICAgICAgICAuam9pbihcIlwiKVxuXG4gICAgICAgIGRpc2NvdmVyZWRbbW9kZWxOYW1lXSA9IFJlc291cmNlQ2xhc3NcbiAgICAgIH1cblxuICAgICAgaWYgKCFiYWNrZW5kUHJvamVjdC5mcm9udGVuZE1vZGVscyAmJiBPYmplY3Qua2V5cyhkaXNjb3ZlcmVkKS5sZW5ndGggPiAwKSB7XG4gICAgICAgIGJhY2tlbmRQcm9qZWN0LmZyb250ZW5kTW9kZWxzID0gZGlzY292ZXJlZFxuICAgICAgfVxuXG4gICAgICBpZiAoYWJpbGl0eVJlc291cmNlQ2xhc3Nlcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGJhY2tlbmRQcm9qZWN0LmFiaWxpdHlSZXNvdXJjZXMgPSBhYmlsaXR5UmVzb3VyY2VDbGFzc2VzXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIExvYWRzIG1vZGVscyBjb250cmlidXRlZCBieSByZWdpc3RlcmVkIHBhY2thZ2VzIGludG8gdGhlIG1vZGVsIHJlZ2lzdHJ5LFxuICAgKiBhZnRlciB0aGUgYXBwJ3Mgb3duIGBpbml0aWFsaXplTW9kZWxzYCBob29rLiBBIHBhY2thZ2Ugd2hvc2UgbW9kZWxzIGRpcmVjdG9yeVxuICAgKiBpcyBhYnNlbnQgaXMgc2tpcHBlZDsgYSBwYWNrYWdlIG1vZGVsIHdob3NlIG5hbWUgY29sbGlkZXMgd2l0aCBhblxuICAgKiBhbHJlYWR5LXJlZ2lzdGVyZWQgZGlmZmVyZW50IGNsYXNzIHRocm93cy4gTm9kZS1vbmx5ICh1c2VzIHRoZSBmaWxlc3lzdGVtKSwgc29cbiAgICogaXQgbGl2ZXMgaGVyZSByYXRoZXIgdGhhbiBpbiB0aGUgYnJvd3Nlci1idW5kbGVkIENvbmZpZ3VyYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBjb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGluaXRpYWxpemVQYWNrYWdlTW9kZWxzKGNvbmZpZ3VyYXRpb24pIHtcbiAgICBmb3IgKGNvbnN0IHZlbG9jaW91c1BhY2thZ2Ugb2YgY29uZmlndXJhdGlvbi5nZXRQYWNrYWdlcygpKSB7XG4gICAgICBjb25zdCBtb2RlbHNQYXRoID0gdmVsb2Npb3VzUGFja2FnZS5nZXRNb2RlbHNQYXRoKClcblxuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgZnMuYWNjZXNzKG1vZGVsc1BhdGgpXG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgY29uc3QgcGFja2FnZVJlcXVpcmVDb250ZXh0ID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9pbml0aWFsaXplci1mcm9tLXJlcXVpcmUtY29udGV4dC5qc1wiKS5Nb2RlbENsYXNzUmVxdWlyZUNvbnRleHRUeXBlfSAqLyAocmVxdWlyZUNvbnRleHQobW9kZWxzUGF0aCwgdHJ1ZSwgL14oLispXFwuanMkLykpXG4gICAgICBjb25zdCBtb2RlbENsYXNzZXMgPSBjb25maWd1cmF0aW9uLmdldE1vZGVsQ2xhc3NlcygpXG5cbiAgICAgIGZvciAoY29uc3QgZmlsZU5hbWUgb2YgcGFja2FnZVJlcXVpcmVDb250ZXh0LmtleXMoKSkge1xuICAgICAgICBjb25zdCBtb2RlbENsYXNzID0gcGFja2FnZVJlcXVpcmVDb250ZXh0KGZpbGVOYW1lKT8uZGVmYXVsdFxuICAgICAgICBjb25zdCBleGlzdGluZyA9IG1vZGVsQ2xhc3MgJiYgbW9kZWxDbGFzc2VzW21vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCldXG5cbiAgICAgICAgaWYgKGV4aXN0aW5nICYmIGV4aXN0aW5nICE9PSBtb2RlbENsYXNzKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBQYWNrYWdlIFwiJHt2ZWxvY2lvdXNQYWNrYWdlLmdldE5hbWUoKX1cIiBtb2RlbCBcIiR7bW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKX1cIiBjb2xsaWRlcyB3aXRoIGFuIGFscmVhZHktcmVnaXN0ZXJlZCBtb2RlbC5gKVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGF3YWl0IGNvbmZpZ3VyYXRpb24uZW5zdXJlQ29ubmVjdGlvbnMoe25hbWU6IGBJbml0aWFsaXplICR7dmVsb2Npb3VzUGFja2FnZS5nZXROYW1lKCl9IHBhY2thZ2UgbW9kZWxzYH0sIGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgbmV3IEluaXRpYWxpemVyRnJvbVJlcXVpcmVDb250ZXh0KHtyZXF1aXJlQ29udGV4dDogcGFja2FnZVJlcXVpcmVDb250ZXh0fSkuaW5pdGlhbGl6ZSh7Y29uZmlndXJhdGlvbn0pXG4gICAgICB9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBjb25maWd1cmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gbmV3Q29uZmlndXJhdGlvbiAtIE5ldyBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRDb25maWd1cmF0aW9uKG5ld0NvbmZpZ3VyYXRpb24pIHtcbiAgICBzdXBlci5zZXRDb25maWd1cmF0aW9uKG5ld0NvbmZpZ3VyYXRpb24pXG5cbiAgICBpZiAoIW5ld0NvbmZpZ3VyYXRpb24uZ2V0Um91dGVSZXNvbHZlckhvb2tzKCkuaW5jbHVkZXMoZnJvbnRlbmRNb2RlbENvbW1hbmRSb3V0ZUhvb2spKSB7XG4gICAgICBuZXdDb25maWd1cmF0aW9uLmFkZFJvdXRlUmVzb2x2ZXJIb29rKGZyb250ZW5kTW9kZWxDb21tYW5kUm91dGVIb29rKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlYWQgYXR0YWNobWVudCBpbnB1dCBmaWxlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZmlsZVBhdGggLSBGaWxlIHBhdGguXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEJ1ZmZlcj59IC0gRmlsZSBieXRlcy5cbiAgICovXG4gIGFzeW5jIHJlYWRBdHRhY2htZW50SW5wdXRGaWxlKGZpbGVQYXRoKSB7XG4gICAgcmV0dXJuIGF3YWl0IGZzLnJlYWRGaWxlKGZpbGVQYXRoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVzb2x2ZSBhdHRhY2htZW50IGlucHV0IHBhdGguXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJncy5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gYXJncy5hbGxvd2VkUGF0aFByZWZpeGVzIC0gQWxsb3dlZCBwYXRoIHByZWZpeGVzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5pbnB1dFBhdGggLSBJbnB1dCBwYXRoLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBdHRhY2htZW50UGF0aFNvdXJjZT59IC0gT3BlbmVkIHJlZ3VsYXItZmlsZSBwYXRoIHNvdXJjZS5cbiAgICovXG4gIGFzeW5jIHJlc29sdmVBdHRhY2htZW50SW5wdXRQYXRoKHthbGxvd2VkUGF0aFByZWZpeGVzLCBpbnB1dFBhdGh9KSB7XG4gICAgY29uc3QgZmlsZVBhdGggPSBwYXRoLnJlc29sdmUoaW5wdXRQYXRoKVxuICAgIGNvbnN0IHByZWZpeGVzID0gQXJyYXkuaXNBcnJheShhbGxvd2VkUGF0aFByZWZpeGVzKVxuICAgICAgPyBhbGxvd2VkUGF0aFByZWZpeGVzLmZpbHRlcigoZW50cnkpID0+IHR5cGVvZiBlbnRyeSA9PT0gXCJzdHJpbmdcIiAmJiBlbnRyeS5sZW5ndGggPiAwKVxuICAgICAgOiBbXVxuXG4gICAgaWYgKHByZWZpeGVzLmxlbmd0aCA+IDAgJiYgIXBhdGhXaXRoaW5BbGxvd2VkUHJlZml4ZXMoZmlsZVBhdGgsIHByZWZpeGVzKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQXR0YWNobWVudCBwYXRoIGlzIG91dHNpZGUgYWxsb3dlZCBkaXJlY3Rvcmllc1wiKVxuICAgIH1cblxuICAgIGNvbnN0IGZpbGVIYW5kbGUgPSBhd2FpdCBmcy5vcGVuKGZpbGVQYXRoLCBcInJcIilcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBmaWxlU3RhdHMgPSBhd2FpdCBmaWxlSGFuZGxlLnN0YXQoKVxuXG4gICAgICBpZiAoIWZpbGVTdGF0cy5pc0ZpbGUoKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJBdHRhY2htZW50IHBhdGggbXVzdCByZWZlcmVuY2UgYSByZWd1bGFyIGZpbGVcIilcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIG5ldyBBdHRhY2htZW50UGF0aFNvdXJjZSh7XG4gICAgICAgIGJ5dGVTaXplOiBmaWxlU3RhdHMuc2l6ZSxcbiAgICAgICAgZmlsZUhhbmRsZSxcbiAgICAgICAgZmlsZVBhdGhcbiAgICAgIH0pXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IGZpbGVIYW5kbGUuY2xvc2UoKVxuICAgICAgfSBjYXRjaCAoY2xvc2VFcnJvcikge1xuICAgICAgICB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoXG4gICAgICAgICAgW2Vycm9yLCBjbG9zZUVycm9yXSxcbiAgICAgICAgICBgQXR0YWNobWVudCBwYXRoIHZhbGlkYXRpb24gYW5kIHNvdXJjZSBjbG9zZSBib3RoIGZhaWxlZCBmb3IgJHtmaWxlUGF0aH1gLFxuICAgICAgICAgIHtjYXVzZTogY2xvc2VFcnJvcn1cbiAgICAgICAgKVxuICAgICAgfVxuXG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQgY29tbWFuZHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5PGltcG9ydChcIi4vYmFzZS5qc1wiKS5Db21tYW5kRmlsZU9iamVjdFR5cGU+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjb21tYW5kcy5cbiAgICovXG4gIGFzeW5jIGZpbmRDb21tYW5kcygpIHtcbiAgICB0aGlzLl9maW5kQ29tbWFuZHNSZXN1bHQgfHw9IGF3YWl0IHRoaXMuX2FjdHVhbEZpbmRDb21tYW5kcygpXG5cbiAgICBpZiAoIXRoaXMuX2ZpbmRDb21tYW5kc1Jlc3VsdCkgdGhyb3cgbmV3IEVycm9yKFwiQ291bGQgbm90IGdldCBjb21tYW5kc1wiKVxuXG4gICAgcmV0dXJuIHRoaXMuX2ZpbmRDb21tYW5kc1Jlc3VsdFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcnVuIHdpdGggdGltZXpvbmUgb2Zmc2V0LlxuICAgKiBAcGFyYW0ge251bWJlcn0gb2Zmc2V0TWludXRlcyAtIE9mZnNldCBpbiBtaW51dGVzIChEYXRlI2dldFRpbWV6b25lT2Zmc2V0KS5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY2FsbGJhY2sgLSBDYWxsYmFjayB0byBydW4uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXN1bHQgb2YgdGhlIGNhbGxiYWNrLlxuICAgKi9cbiAgYXN5bmMgcnVuV2l0aFRpbWV6b25lT2Zmc2V0KG9mZnNldE1pbnV0ZXMsIGNhbGxiYWNrKSB7XG4gICAgaWYgKCF0aGlzLl90aW1lem9uZUFzeW5jTG9jYWxTdG9yYWdlKSB7XG4gICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soKVxuICAgIH1cblxuICAgIGNvbnN0IGV4aXN0aW5nU3RvcmUgPSB0aGlzLl90aW1lem9uZUFzeW5jTG9jYWxTdG9yYWdlLmdldFN0b3JlKClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl90aW1lem9uZUFzeW5jTG9jYWxTdG9yYWdlLnJ1bih7XG4gICAgICBhYmlsaXR5OiBleGlzdGluZ1N0b3JlPy5hYmlsaXR5LFxuICAgICAgb2Zmc2V0TWludXRlcyxcbiAgICAgIHJlcXVlc3RUaW1pbmc6IGV4aXN0aW5nU3RvcmU/LnJlcXVlc3RUaW1pbmcsXG4gICAgICB0ZW5hbnQ6IGV4aXN0aW5nU3RvcmU/LnRlbmFudCxcbiAgICAgIHRlc3RQcm9maWxlQ29udGV4dDogZXhpc3RpbmdTdG9yZT8udGVzdFByb2ZpbGVDb250ZXh0LFxuICAgICAgdGltZVpvbmU6IGV4aXN0aW5nU3RvcmU/LnRpbWVab25lID8/IHRoaXMuZ2V0VGltZVpvbmUodGhpcy5nZXRDb25maWd1cmF0aW9uKCkpXG4gICAgfSwgY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogUnVucyBydW4gd2l0aCB0aW1lem9uZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRpbWVab25lIC0gSUFOQSB0aW1lem9uZSBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjYWxsYmFjayAtIENhbGxiYWNrIHRvIHJ1bi5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc3VsdCBvZiB0aGUgY2FsbGJhY2suXG4gICAqL1xuICBhc3luYyBydW5XaXRoVGltZXpvbmUodGltZVpvbmUsIGNhbGxiYWNrKSB7XG4gICAgaWYgKCF0aGlzLl90aW1lem9uZUFzeW5jTG9jYWxTdG9yYWdlKSB7XG4gICAgICByZXR1cm4gYXdhaXQgc3VwZXIucnVuV2l0aFRpbWV6b25lKHRpbWVab25lLCBjYWxsYmFjaylcbiAgICB9XG5cbiAgICBjb25zdCBleGlzdGluZ1N0b3JlID0gdGhpcy5fdGltZXpvbmVBc3luY0xvY2FsU3RvcmFnZS5nZXRTdG9yZSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fdGltZXpvbmVBc3luY0xvY2FsU3RvcmFnZS5ydW4oe1xuICAgICAgYWJpbGl0eTogZXhpc3RpbmdTdG9yZT8uYWJpbGl0eSxcbiAgICAgIG9mZnNldE1pbnV0ZXM6IGV4aXN0aW5nU3RvcmU/Lm9mZnNldE1pbnV0ZXMgPz8gdGhpcy5nZXRUaW1lem9uZU9mZnNldE1pbnV0ZXModGhpcy5nZXRDb25maWd1cmF0aW9uKCkpLFxuICAgICAgcmVxdWVzdFRpbWluZzogZXhpc3RpbmdTdG9yZT8ucmVxdWVzdFRpbWluZyxcbiAgICAgIHRlbmFudDogZXhpc3RpbmdTdG9yZT8udGVuYW50LFxuICAgICAgdGVzdFByb2ZpbGVDb250ZXh0OiBleGlzdGluZ1N0b3JlPy50ZXN0UHJvZmlsZUNvbnRleHQsXG4gICAgICB0aW1lWm9uZTogdmFsaWRhdGVUaW1lWm9uZSh0aW1lWm9uZSwgXCJ0aW1lWm9uZVwiKVxuICAgIH0sIGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHRpbWV6b25lIG9mZnNldC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IG9mZnNldE1pbnV0ZXMgLSBPZmZzZXQgaW4gbWludXRlcyAoRGF0ZSNnZXRUaW1lem9uZU9mZnNldCkuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldFRpbWV6b25lT2Zmc2V0KG9mZnNldE1pbnV0ZXMpIHtcbiAgICBpZiAoIXRoaXMuX3RpbWV6b25lQXN5bmNMb2NhbFN0b3JhZ2UpIHJldHVyblxuXG4gICAgY29uc3Qgc3RvcmUgPSB0aGlzLl90aW1lem9uZUFzeW5jTG9jYWxTdG9yYWdlLmdldFN0b3JlKClcblxuICAgIGlmIChzdG9yZSkge1xuICAgICAgc3RvcmUub2Zmc2V0TWludXRlcyA9IG9mZnNldE1pbnV0ZXNcbiAgICB9IGVsc2Uge1xuICAgICAgY29uc3QgZXhpc3RpbmdTdG9yZSA9IHRoaXMuX3RpbWV6b25lQXN5bmNMb2NhbFN0b3JhZ2UuZ2V0U3RvcmUoKVxuXG4gICAgICB0aGlzLl90aW1lem9uZUFzeW5jTG9jYWxTdG9yYWdlLmVudGVyV2l0aCh7XG4gICAgICAgIGFiaWxpdHk6IGV4aXN0aW5nU3RvcmU/LmFiaWxpdHksXG4gICAgICAgIG9mZnNldE1pbnV0ZXMsXG4gICAgICAgIHJlcXVlc3RUaW1pbmc6IGV4aXN0aW5nU3RvcmU/LnJlcXVlc3RUaW1pbmcsXG4gICAgICAgIHRlbmFudDogZXhpc3RpbmdTdG9yZT8udGVuYW50LFxuICAgICAgICB0ZXN0UHJvZmlsZUNvbnRleHQ6IGV4aXN0aW5nU3RvcmU/LnRlc3RQcm9maWxlQ29udGV4dCxcbiAgICAgICAgdGltZVpvbmU6IGV4aXN0aW5nU3RvcmU/LnRpbWVab25lID8/IHRoaXMuZ2V0VGltZVpvbmUodGhpcy5nZXRDb25maWd1cmF0aW9uKCkpXG4gICAgICB9KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCB0aW1lem9uZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRpbWVab25lIC0gSUFOQSB0aW1lem9uZSBpZGVudGlmaWVyLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRUaW1lem9uZSh0aW1lWm9uZSkge1xuICAgIGlmICghdGhpcy5fdGltZXpvbmVBc3luY0xvY2FsU3RvcmFnZSkge1xuICAgICAgc3VwZXIuc2V0VGltZXpvbmUodGltZVpvbmUpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBub3JtYWxpemVkVGltZVpvbmUgPSB2YWxpZGF0ZVRpbWVab25lKHRpbWVab25lLCBcInRpbWVab25lXCIpXG4gICAgY29uc3Qgc3RvcmUgPSB0aGlzLl90aW1lem9uZUFzeW5jTG9jYWxTdG9yYWdlLmdldFN0b3JlKClcblxuICAgIGlmIChzdG9yZSkge1xuICAgICAgc3RvcmUudGltZVpvbmUgPSBub3JtYWxpemVkVGltZVpvbmVcbiAgICB9IGVsc2Uge1xuICAgICAgY29uc3QgZXhpc3RpbmdTdG9yZSA9IHRoaXMuX3RpbWV6b25lQXN5bmNMb2NhbFN0b3JhZ2UuZ2V0U3RvcmUoKVxuXG4gICAgICB0aGlzLl90aW1lem9uZUFzeW5jTG9jYWxTdG9yYWdlLmVudGVyV2l0aCh7XG4gICAgICAgIGFiaWxpdHk6IGV4aXN0aW5nU3RvcmU/LmFiaWxpdHksXG4gICAgICAgIG9mZnNldE1pbnV0ZXM6IGV4aXN0aW5nU3RvcmU/Lm9mZnNldE1pbnV0ZXMgPz8gdGhpcy5nZXRUaW1lem9uZU9mZnNldE1pbnV0ZXModGhpcy5nZXRDb25maWd1cmF0aW9uKCkpLFxuICAgICAgICByZXF1ZXN0VGltaW5nOiBleGlzdGluZ1N0b3JlPy5yZXF1ZXN0VGltaW5nLFxuICAgICAgICB0ZW5hbnQ6IGV4aXN0aW5nU3RvcmU/LnRlbmFudCxcbiAgICAgICAgdGVzdFByb2ZpbGVDb250ZXh0OiBleGlzdGluZ1N0b3JlPy50ZXN0UHJvZmlsZUNvbnRleHQsXG4gICAgICAgIHRpbWVab25lOiBub3JtYWxpemVkVGltZVpvbmVcbiAgICAgIH0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRpbWV6b25lIG9mZnNldCBtaW51dGVzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gT2Zmc2V0IGluIG1pbnV0ZXMuXG4gICAqL1xuICBnZXRUaW1lem9uZU9mZnNldE1pbnV0ZXMoY29uZmlndXJhdGlvbikge1xuICAgIGlmICh0aGlzLl90aW1lem9uZUFzeW5jTG9jYWxTdG9yYWdlKSB7XG4gICAgICBjb25zdCBzdG9yZSA9IHRoaXMuX3RpbWV6b25lQXN5bmNMb2NhbFN0b3JhZ2UuZ2V0U3RvcmUoKVxuXG4gICAgICBpZiAoc3RvcmUgJiYgdHlwZW9mIHN0b3JlLm9mZnNldE1pbnV0ZXMgPT09IFwibnVtYmVyXCIpIHtcbiAgICAgICAgcmV0dXJuIHN0b3JlLm9mZnNldE1pbnV0ZXNcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gc3VwZXIuZ2V0VGltZXpvbmVPZmZzZXRNaW51dGVzKGNvbmZpZ3VyYXRpb24pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdGltZXpvbmUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSBjb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBUaW1lem9uZSBpZGVudGlmaWVyLlxuICAgKi9cbiAgZ2V0VGltZVpvbmUoY29uZmlndXJhdGlvbikge1xuICAgIGlmICh0aGlzLl90aW1lem9uZUFzeW5jTG9jYWxTdG9yYWdlKSB7XG4gICAgICBjb25zdCBzdG9yZSA9IHRoaXMuX3RpbWV6b25lQXN5bmNMb2NhbFN0b3JhZ2UuZ2V0U3RvcmUoKVxuXG4gICAgICBpZiAoc3RvcmUgJiYgdHlwZW9mIHN0b3JlLnRpbWVab25lID09PSBcInN0cmluZ1wiKSB7XG4gICAgICAgIHJldHVybiBzdG9yZS50aW1lWm9uZVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBzdXBlci5nZXRUaW1lWm9uZShjb25maWd1cmF0aW9uKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcnVuIHdpdGggYWJpbGl0eS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9hdXRob3JpemF0aW9uL2FiaWxpdHkuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gYWJpbGl0eSAtIEFiaWxpdHkgdG8gc2V0IGZvciBjYWxsYmFjayBzY29wZS5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY2FsbGJhY2sgLSBDYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHJ1bldpdGhBYmlsaXR5KGFiaWxpdHksIGNhbGxiYWNrKSB7XG4gICAgaWYgKCF0aGlzLl90aW1lem9uZUFzeW5jTG9jYWxTdG9yYWdlKSB7XG4gICAgICByZXR1cm4gYXdhaXQgc3VwZXIucnVuV2l0aEFiaWxpdHkoYWJpbGl0eSwgY2FsbGJhY2spXG4gICAgfVxuXG4gICAgY29uc3QgZXhpc3RpbmdTdG9yZSA9IHRoaXMuX3RpbWV6b25lQXN5bmNMb2NhbFN0b3JhZ2UuZ2V0U3RvcmUoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3RpbWV6b25lQXN5bmNMb2NhbFN0b3JhZ2UucnVuKHtcbiAgICAgIGFiaWxpdHksXG4gICAgICBvZmZzZXRNaW51dGVzOiBleGlzdGluZ1N0b3JlPy5vZmZzZXRNaW51dGVzID8/IHRoaXMuZ2V0VGltZXpvbmVPZmZzZXRNaW51dGVzKHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpKSxcbiAgICAgIHJlcXVlc3RUaW1pbmc6IGV4aXN0aW5nU3RvcmU/LnJlcXVlc3RUaW1pbmcsXG4gICAgICB0ZW5hbnQ6IGV4aXN0aW5nU3RvcmU/LnRlbmFudCxcbiAgICAgIHRlc3RQcm9maWxlQ29udGV4dDogZXhpc3RpbmdTdG9yZT8udGVzdFByb2ZpbGVDb250ZXh0LFxuICAgICAgdGltZVpvbmU6IGV4aXN0aW5nU3RvcmU/LnRpbWVab25lID8/IHRoaXMuZ2V0VGltZVpvbmUodGhpcy5nZXRDb25maWd1cmF0aW9uKCkpXG4gICAgfSwgY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgY3VycmVudCBhYmlsaXR5LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2F1dGhvcml6YXRpb24vYWJpbGl0eS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSBhYmlsaXR5IC0gQWJpbGl0eSB0byBzZXQuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldEN1cnJlbnRBYmlsaXR5KGFiaWxpdHkpIHtcbiAgICBpZiAoIXRoaXMuX3RpbWV6b25lQXN5bmNMb2NhbFN0b3JhZ2UpIHtcbiAgICAgIHN1cGVyLnNldEN1cnJlbnRBYmlsaXR5KGFiaWxpdHkpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBleGlzdGluZ1N0b3JlID0gdGhpcy5fdGltZXpvbmVBc3luY0xvY2FsU3RvcmFnZS5nZXRTdG9yZSgpXG5cbiAgICBpZiAoZXhpc3RpbmdTdG9yZSkge1xuICAgICAgZXhpc3RpbmdTdG9yZS5hYmlsaXR5ID0gYWJpbGl0eVxuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLl90aW1lem9uZUFzeW5jTG9jYWxTdG9yYWdlLmVudGVyV2l0aCh7XG4gICAgICAgIGFiaWxpdHksXG4gICAgICAgIG9mZnNldE1pbnV0ZXM6IHRoaXMuZ2V0VGltZXpvbmVPZmZzZXRNaW51dGVzKHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpKSxcbiAgICAgICAgcmVxdWVzdFRpbWluZzogdW5kZWZpbmVkLFxuICAgICAgICB0ZW5hbnQ6IHVuZGVmaW5lZCxcbiAgICAgICAgdGVzdFByb2ZpbGVDb250ZXh0OiB1bmRlZmluZWQsXG4gICAgICAgIHRpbWVab25lOiB0aGlzLmdldFRpbWVab25lKHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpKVxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgY3VycmVudCBhYmlsaXR5LlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IC0gQ3VycmVudCBhYmlsaXR5LlxuICAgKi9cbiAgZ2V0Q3VycmVudEFiaWxpdHkoKSB7XG4gICAgaWYgKCF0aGlzLl90aW1lem9uZUFzeW5jTG9jYWxTdG9yYWdlKSB7XG4gICAgICByZXR1cm4gc3VwZXIuZ2V0Q3VycmVudEFiaWxpdHkoKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl90aW1lem9uZUFzeW5jTG9jYWxTdG9yYWdlLmdldFN0b3JlKCk/LmFiaWxpdHlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1biB3aXRoIHJlcXVlc3QgdGltaW5nLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2h0dHAtc2VydmVyL2NsaWVudC9yZXF1ZXN0LXRpbWluZy5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSByZXF1ZXN0VGltaW5nIC0gUmVxdWVzdCB0aW1pbmcgY29sbGVjdG9yLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBjYWxsYmFjayAtIENhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gQ2FsbGJhY2sgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgcnVuV2l0aFJlcXVlc3RUaW1pbmcocmVxdWVzdFRpbWluZywgY2FsbGJhY2spIHtcbiAgICBpZiAoIXRoaXMuX3RpbWV6b25lQXN5bmNMb2NhbFN0b3JhZ2UpIHtcbiAgICAgIHJldHVybiBhd2FpdCBzdXBlci5ydW5XaXRoUmVxdWVzdFRpbWluZyhyZXF1ZXN0VGltaW5nLCBjYWxsYmFjaylcbiAgICB9XG5cbiAgICBjb25zdCBleGlzdGluZ1N0b3JlID0gdGhpcy5fdGltZXpvbmVBc3luY0xvY2FsU3RvcmFnZS5nZXRTdG9yZSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fdGltZXpvbmVBc3luY0xvY2FsU3RvcmFnZS5ydW4oe1xuICAgICAgYWJpbGl0eTogZXhpc3RpbmdTdG9yZT8uYWJpbGl0eSxcbiAgICAgIG9mZnNldE1pbnV0ZXM6IGV4aXN0aW5nU3RvcmU/Lm9mZnNldE1pbnV0ZXMgPz8gdGhpcy5nZXRUaW1lem9uZU9mZnNldE1pbnV0ZXModGhpcy5nZXRDb25maWd1cmF0aW9uKCkpLFxuICAgICAgcmVxdWVzdFRpbWluZyxcbiAgICAgIHRlbmFudDogZXhpc3RpbmdTdG9yZT8udGVuYW50LFxuICAgICAgdGVzdFByb2ZpbGVDb250ZXh0OiBleGlzdGluZ1N0b3JlPy50ZXN0UHJvZmlsZUNvbnRleHQsXG4gICAgICB0aW1lWm9uZTogZXhpc3RpbmdTdG9yZT8udGltZVpvbmUgPz8gdGhpcy5nZXRUaW1lWm9uZSh0aGlzLmdldENvbmZpZ3VyYXRpb24oKSlcbiAgICB9LCBjYWxsYmFjaylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBjdXJyZW50IHJlcXVlc3QgdGltaW5nLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vaHR0cC1zZXJ2ZXIvY2xpZW50L3JlcXVlc3QtdGltaW5nLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IC0gQ3VycmVudCByZXF1ZXN0IHRpbWluZyBjb2xsZWN0b3IuXG4gICAqL1xuICBnZXRDdXJyZW50UmVxdWVzdFRpbWluZygpIHtcbiAgICBpZiAoIXRoaXMuX3RpbWV6b25lQXN5bmNMb2NhbFN0b3JhZ2UpIHtcbiAgICAgIHJldHVybiBzdXBlci5nZXRDdXJyZW50UmVxdWVzdFRpbWluZygpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX3RpbWV6b25lQXN5bmNMb2NhbFN0b3JhZ2UuZ2V0U3RvcmUoKT8ucmVxdWVzdFRpbWluZ1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcnVuIHdpdGggdGVuYW50LlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB0ZW5hbnQgLSBUZW5hbnQgdG8gc2V0IGZvciBjYWxsYmFjayBzY29wZS5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gY2FsbGJhY2sgLSBDYWxsYmFjay5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHJ1bldpdGhUZW5hbnQodGVuYW50LCBjYWxsYmFjaykge1xuICAgIGlmICghdGhpcy5fdGltZXpvbmVBc3luY0xvY2FsU3RvcmFnZSkge1xuICAgICAgcmV0dXJuIGF3YWl0IHN1cGVyLnJ1bldpdGhUZW5hbnQodGVuYW50LCBjYWxsYmFjaylcbiAgICB9XG5cbiAgICBjb25zdCBleGlzdGluZ1N0b3JlID0gdGhpcy5fdGltZXpvbmVBc3luY0xvY2FsU3RvcmFnZS5nZXRTdG9yZSgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fdGltZXpvbmVBc3luY0xvY2FsU3RvcmFnZS5ydW4oe1xuICAgICAgYWJpbGl0eTogZXhpc3RpbmdTdG9yZT8uYWJpbGl0eSxcbiAgICAgIG9mZnNldE1pbnV0ZXM6IGV4aXN0aW5nU3RvcmU/Lm9mZnNldE1pbnV0ZXMgPz8gdGhpcy5nZXRUaW1lem9uZU9mZnNldE1pbnV0ZXModGhpcy5nZXRDb25maWd1cmF0aW9uKCkpLFxuICAgICAgcmVxdWVzdFRpbWluZzogZXhpc3RpbmdTdG9yZT8ucmVxdWVzdFRpbWluZyxcbiAgICAgIHRlbmFudCxcbiAgICAgIHRlc3RQcm9maWxlQ29udGV4dDogZXhpc3RpbmdTdG9yZT8udGVzdFByb2ZpbGVDb250ZXh0LFxuICAgICAgdGltZVpvbmU6IGV4aXN0aW5nU3RvcmU/LnRpbWVab25lID8/IHRoaXMuZ2V0VGltZVpvbmUodGhpcy5nZXRDb25maWd1cmF0aW9uKCkpXG4gICAgfSwgY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgY3VycmVudCB0ZW5hbnQuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHRlbmFudCAtIFRlbmFudCB0byBzZXQuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldEN1cnJlbnRUZW5hbnQodGVuYW50KSB7XG4gICAgaWYgKCF0aGlzLl90aW1lem9uZUFzeW5jTG9jYWxTdG9yYWdlKSB7XG4gICAgICBzdXBlci5zZXRDdXJyZW50VGVuYW50KHRlbmFudClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IGV4aXN0aW5nU3RvcmUgPSB0aGlzLl90aW1lem9uZUFzeW5jTG9jYWxTdG9yYWdlLmdldFN0b3JlKClcblxuICAgIGlmIChleGlzdGluZ1N0b3JlKSB7XG4gICAgICBleGlzdGluZ1N0b3JlLnRlbmFudCA9IHRlbmFudFxuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLl90aW1lem9uZUFzeW5jTG9jYWxTdG9yYWdlLmVudGVyV2l0aCh7XG4gICAgICAgIGFiaWxpdHk6IHVuZGVmaW5lZCxcbiAgICAgICAgb2Zmc2V0TWludXRlczogdGhpcy5nZXRUaW1lem9uZU9mZnNldE1pbnV0ZXModGhpcy5nZXRDb25maWd1cmF0aW9uKCkpLFxuICAgICAgICByZXF1ZXN0VGltaW5nOiB1bmRlZmluZWQsXG4gICAgICAgIHRlbmFudCxcbiAgICAgICAgdGVzdFByb2ZpbGVDb250ZXh0OiB1bmRlZmluZWQsXG4gICAgICAgIHRpbWVab25lOiB0aGlzLmdldFRpbWVab25lKHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpKVxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgY3VycmVudCB0ZW5hbnQuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBDdXJyZW50IHRlbmFudC5cbiAgICovXG4gIGdldEN1cnJlbnRUZW5hbnQoKSB7XG4gICAgaWYgKCF0aGlzLl90aW1lem9uZUFzeW5jTG9jYWxTdG9yYWdlKSB7XG4gICAgICByZXR1cm4gc3VwZXIuZ2V0Q3VycmVudFRlbmFudCgpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX3RpbWV6b25lQXN5bmNMb2NhbFN0b3JhZ2UuZ2V0U3RvcmUoKT8udGVuYW50XG4gIH1cblxuICAvKipcbiAgICogUnVucyBhY3R1YWwgZmluZCBjb21tYW5kcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8QXJyYXk8aW1wb3J0KFwiLi9iYXNlLmpzXCIpLkNvbW1hbmRGaWxlT2JqZWN0VHlwZT4+fSAtIFJlc29sdmVzIHdpdGggZGlzY292ZXJlZCBjb21tYW5kIGZpbGVzLlxuICAgKi9cbiAgYXN5bmMgX2FjdHVhbEZpbmRDb21tYW5kcygpIHtcbiAgICBjb25zdCBiYXNlUGF0aCA9IGF3YWl0IHRoaXMuZ2V0QmFzZVBhdGgoKVxuICAgIGNvbnN0IGNvbW1hbmRGaWxlcyA9IGZzLmdsb2IoYCR7YmFzZVBhdGh9L3NyYy9jbGkvY29tbWFuZHMvKiovKi5qc2ApXG4gICAgY29uc3QgY29tbWFuZHMgPSBbXVxuXG4gICAgZm9yIGF3YWl0IChjb25zdCBhRmlsZVBhdGggb2YgY29tbWFuZEZpbGVzKSB7XG4gICAgICBjb25zdCBjb21tYW5kTmFtZSA9IHRoaXMuY29tbWFuZE5hbWVGcm9tRmlsZVBhdGgoYUZpbGVQYXRoKVxuXG4gICAgICBjb21tYW5kcy5wdXNoKHtuYW1lOiBjb21tYW5kTmFtZSwgZmlsZTogYUZpbGVQYXRofSlcbiAgICB9XG5cbiAgICByZXR1cm4gY29tbWFuZHNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbW1hbmQgbmFtZSBmcm9tIGZpbGUgcGF0aC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGZpbGVQYXRoIC0gRnVsbCBjb21tYW5kIGZpbGUgcGF0aC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBQYXJzZWQgY29tbWFuZCBuYW1lLlxuICAgKi9cbiAgY29tbWFuZE5hbWVGcm9tRmlsZVBhdGgoZmlsZVBhdGgpIHtcbiAgICBjb25zdCBhRmlsZVBhdGhQYXJ0cyA9IGZpbGVQYXRoLnNwbGl0KC9bXFxcXC9dLylcbiAgICBjb25zdCBjb21tYW5kUGF0aExvY2F0aW9uID0gYUZpbGVQYXRoUGFydHMuaW5kZXhPZihcImNvbW1hbmRzXCIpXG5cbiAgICBpZiAoY29tbWFuZFBhdGhMb2NhdGlvbiA9PT0gLTEpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQ291bGQgbm90IHBhcnNlIGNvbW1hbmQgZmlsZSBwYXRoOiAke2ZpbGVQYXRofWApXG4gICAgfVxuXG4gICAgY29uc3QgY29tbWFuZFBhcnRzID0gYUZpbGVQYXRoUGFydHMuc2xpY2UoY29tbWFuZFBhdGhMb2NhdGlvbiArIDEpXG4gICAgY29uc3QgbGFzdFBhcnQgPSBjb21tYW5kUGFydHNbY29tbWFuZFBhcnRzLmxlbmd0aCAtIDFdXG4gICAgbGV0IG5hbWUsIHBhdGhzXG5cbiAgICBpZiAobGFzdFBhcnQgPT0gXCJpbmRleC5qc1wiKSB7XG4gICAgICBuYW1lID0gY29tbWFuZFBhcnRzW2NvbW1hbmRQYXJ0cy5sZW5ndGggLSAyXVxuICAgICAgcGF0aHMgPSBjb21tYW5kUGFydHMuc2xpY2UoMCwgLTIpXG4gICAgfSBlbHNlIHtcbiAgICAgIG5hbWUgPSBsYXN0UGFydC5yZXBsYWNlKFwiLmpzXCIsIFwiXCIpXG4gICAgICBwYXRocyA9IGNvbW1hbmRQYXJ0cy5zbGljZSgwLCAtMSlcbiAgICB9XG5cbiAgICByZXR1cm4gYCR7cGF0aHMuam9pbihcIjpcIil9JHtwYXRocy5sZW5ndGggPiAwID8gXCI6XCIgOiBcIlwifSR7bmFtZX1gXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGkgY29tbWFuZHMgaW5pdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jbGkvYmFzZS1jb21tYW5kLmpzXCIpLmRlZmF1bHR9IGNvbW1hbmQgLSBDb21tYW5kLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY29tbWFuZCByZXN1bHQuXG4gICAqL1xuICBhc3luYyBjbGlDb21tYW5kc0luaXQoY29tbWFuZCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmZvcndhcmRDb21tYW5kKGNvbW1hbmQsIENsaUNvbW1hbmRzSW5pdClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsaSBjb21tYW5kcyBtaWdyYXRpb24gZ2VuZXJhdGUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiKS5kZWZhdWx0fSBjb21tYW5kIC0gQ29tbWFuZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNvbW1hbmQgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgY2xpQ29tbWFuZHNNaWdyYXRpb25HZW5lcmF0ZShjb21tYW5kKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZm9yd2FyZENvbW1hbmQoY29tbWFuZCwgQ2xpQ29tbWFuZHNHZW5lcmF0ZU1pZ3JhdGlvbilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsaSBjb21tYW5kcyBtaWdyYXRpb24gZGVzdHJveS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jbGkvYmFzZS1jb21tYW5kLmpzXCIpLmRlZmF1bHR9IGNvbW1hbmQgLSBDb21tYW5kLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY29tbWFuZCByZXN1bHQuXG4gICAqL1xuICBhc3luYyBjbGlDb21tYW5kc01pZ3JhdGlvbkRlc3Ryb3koY29tbWFuZCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmZvcndhcmRDb21tYW5kKGNvbW1hbmQsIENsaUNvbW1hbmRzRGVzdHJveU1pZ3JhdGlvbilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsaSBjb21tYW5kcyBnZW5lcmF0ZSBiYXNlIG1vZGVscy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jbGkvYmFzZS1jb21tYW5kLmpzXCIpLmRlZmF1bHR9IGNvbW1hbmQgLSBDb21tYW5kLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY29tbWFuZCByZXN1bHQuXG4gICAqL1xuICBhc3luYyBjbGlDb21tYW5kc0dlbmVyYXRlQmFzZU1vZGVscyhjb21tYW5kKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZm9yd2FyZENvbW1hbmQoY29tbWFuZCwgQ2xpQ29tbWFuZHNHZW5lcmF0ZUJhc2VNb2RlbHMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGkgY29tbWFuZHMgZ2VuZXJhdGUgZnJvbnRlbmQgbW9kZWxzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NsaS9iYXNlLWNvbW1hbmQuanNcIikuZGVmYXVsdH0gY29tbWFuZCAtIENvbW1hbmQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjb21tYW5kIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGNsaUNvbW1hbmRzR2VuZXJhdGVGcm9udGVuZE1vZGVscyhjb21tYW5kKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZm9yd2FyZENvbW1hbmQoY29tbWFuZCwgQ2xpQ29tbWFuZHNHZW5lcmF0ZUZyb250ZW5kTW9kZWxzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xpIGNvbW1hbmRzIGdlbmVyYXRlIG1vZGVsLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NsaS9iYXNlLWNvbW1hbmQuanNcIikuZGVmYXVsdH0gY29tbWFuZCAtIENvbW1hbmQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjb21tYW5kIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGNsaUNvbW1hbmRzR2VuZXJhdGVNb2RlbChjb21tYW5kKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZm9yd2FyZENvbW1hbmQoY29tbWFuZCwgQ2xpQ29tbWFuZHNHZW5lcmF0ZU1vZGVsKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xpIGNvbW1hbmRzIGxpbnQgcmVsYXRpb25zaGlwcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jbGkvYmFzZS1jb21tYW5kLmpzXCIpLmRlZmF1bHR9IGNvbW1hbmQgLSBDb21tYW5kLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY29tbWFuZCByZXN1bHQuXG4gICAqL1xuICBhc3luYyBjbGlDb21tYW5kc0xpbnRSZWxhdGlvbnNoaXBzKGNvbW1hbmQpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5mb3J3YXJkQ29tbWFuZChjb21tYW5kLCBDbGlDb21tYW5kc0xpbnRSZWxhdGlvbnNoaXBzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xpIGNvbW1hbmRzIHJvdXRlcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jbGkvYmFzZS1jb21tYW5kLmpzXCIpLmRlZmF1bHR9IGNvbW1hbmQgLSBDb21tYW5kLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY29tbWFuZCByZXN1bHQuXG4gICAqL1xuICBhc3luYyBjbGlDb21tYW5kc1JvdXRlcyhjb21tYW5kKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZm9yd2FyZENvbW1hbmQoY29tbWFuZCwgQ2xpQ29tbWFuZHNSb3V0ZXMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGkgY29tbWFuZHMgY29uc29sZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jbGkvYmFzZS1jb21tYW5kLmpzXCIpLmRlZmF1bHR9IGNvbW1hbmQgLSBDb21tYW5kLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY29tbWFuZCByZXN1bHQuXG4gICAqL1xuICBhc3luYyBjbGlDb21tYW5kc0NvbnNvbGUoY29tbWFuZCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmZvcndhcmRDb21tYW5kKGNvbW1hbmQsIENsaUNvbW1hbmRzQ29uc29sZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsaSBjb21tYW5kcyBzZXJ2ZXIuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiKS5kZWZhdWx0fSBjb21tYW5kIC0gQ29tbWFuZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNvbW1hbmQgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgY2xpQ29tbWFuZHNTZXJ2ZXIoY29tbWFuZCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmZvcndhcmRDb21tYW5kKGNvbW1hbmQsIENsaUNvbW1hbmRzU2VydmVyKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xpIGNvbW1hbmRzIG1jcC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jbGkvYmFzZS1jb21tYW5kLmpzXCIpLmRlZmF1bHR9IGNvbW1hbmQgLSBDb21tYW5kLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBjb21tYW5kIGNvbXBsZXRlcy5cbiAgICovXG4gIGFzeW5jIGNsaUNvbW1hbmRzTWNwKGNvbW1hbmQpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5mb3J3YXJkQ29tbWFuZChjb21tYW5kLCBDbGlDb21tYW5kc01jcClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsaSBjb21tYW5kcyB0ZXN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NsaS9iYXNlLWNvbW1hbmQuanNcIikuZGVmYXVsdH0gY29tbWFuZCAtIENvbW1hbmQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjb21tYW5kIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGNsaUNvbW1hbmRzVGVzdChjb21tYW5kKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZm9yd2FyZENvbW1hbmQoY29tbWFuZCwgQ2xpQ29tbWFuZHNUZXN0KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xpIGNvbW1hbmRzIHRlc3QgdGltaW5nIG1hbmlmZXN0IG1lcmdlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NsaS9iYXNlLWNvbW1hbmQuanNcIikuZGVmYXVsdH0gY29tbWFuZCAtIENvbW1hbmQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjb21tYW5kIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGNsaUNvbW1hbmRzVGVzdFRpbWluZ01hbmlmZXN0TWVyZ2UoY29tbWFuZCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmZvcndhcmRDb21tYW5kKGNvbW1hbmQsIENsaUNvbW1hbmRzVGVzdFRpbWluZ01hbmlmZXN0TWVyZ2UpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGkgY29tbWFuZHMgYmFja2dyb3VuZCBqb2JzIG1haW4uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiKS5kZWZhdWx0fSBjb21tYW5kIC0gQ29tbWFuZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNvbW1hbmQgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgY2xpQ29tbWFuZHNCYWNrZ3JvdW5kSm9ic01haW4oY29tbWFuZCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmZvcndhcmRDb21tYW5kKGNvbW1hbmQsIENsaUNvbW1hbmRzQmFja2dyb3VuZEpvYnNNYWluKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgQ0xJIGJhY2tncm91bmQtam9icyBhY3RpdmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NsaS9iYXNlLWNvbW1hbmQuanNcIikuZGVmYXVsdH0gY29tbWFuZCAtIENvbW1hbmQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXN1bHQuXG4gICAqL1xuICBhc3luYyBjbGlDb21tYW5kc0JhY2tncm91bmRKb2JzQWN0aXZhdGUoY29tbWFuZCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmZvcndhcmRDb21tYW5kKGNvbW1hbmQsIENsaUNvbW1hbmRzQmFja2dyb3VuZEpvYnNBY3RpdmF0ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIENMSSBiYWNrZ3JvdW5kLWpvYnMgcmV0aXJlbWVudC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jbGkvYmFzZS1jb21tYW5kLmpzXCIpLmRlZmF1bHR9IGNvbW1hbmQgLSBDb21tYW5kLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgY2xpQ29tbWFuZHNCYWNrZ3JvdW5kSm9ic1JldGlyZShjb21tYW5kKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZm9yd2FyZENvbW1hbmQoY29tbWFuZCwgQ2xpQ29tbWFuZHNCYWNrZ3JvdW5kSm9ic1JldGlyZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsaSBjb21tYW5kcyBiYWNrZ3JvdW5kIGpvYnMgd29ya2VyLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NsaS9iYXNlLWNvbW1hbmQuanNcIikuZGVmYXVsdH0gY29tbWFuZCAtIENvbW1hbmQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjb21tYW5kIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGNsaUNvbW1hbmRzQmFja2dyb3VuZEpvYnNXb3JrZXIoY29tbWFuZCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmZvcndhcmRDb21tYW5kKGNvbW1hbmQsIENsaUNvbW1hbmRzQmFja2dyb3VuZEpvYnNXb3JrZXIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGkgY29tbWFuZHMgYmFja2dyb3VuZCBqb2JzIHJ1bm5lci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jbGkvYmFzZS1jb21tYW5kLmpzXCIpLmRlZmF1bHR9IGNvbW1hbmQgLSBDb21tYW5kLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY29tbWFuZCByZXN1bHQuXG4gICAqL1xuICBhc3luYyBjbGlDb21tYW5kc0JhY2tncm91bmRKb2JzUnVubmVyKGNvbW1hbmQpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5mb3J3YXJkQ29tbWFuZChjb21tYW5kLCBDbGlDb21tYW5kc0JhY2tncm91bmRKb2JzUnVubmVyKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xpIGNvbW1hbmRzIGJlYWNvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jbGkvYmFzZS1jb21tYW5kLmpzXCIpLmRlZmF1bHR9IGNvbW1hbmQgLSBDb21tYW5kLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY29tbWFuZCByZXN1bHQuXG4gICAqL1xuICBhc3luYyBjbGlDb21tYW5kc0JlYWNvbihjb21tYW5kKSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZm9yd2FyZENvbW1hbmQoY29tbWFuZCwgQ2xpQ29tbWFuZHNCZWFjb24pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBsb2FkIGJlYWNvbiBjbGllbnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHR5cGVvZiBpbXBvcnQoXCIuLi9iZWFjb24vY2xpZW50LmpzXCIpLmRlZmF1bHQ+fSAtIEJlYWNvbiBjbGllbnQgY2xhc3MuXG4gICAqL1xuICBhc3luYyBsb2FkQmVhY29uQ2xpZW50KCkge1xuICAgIGNvbnN0IHtkZWZhdWx0OiBCZWFjb25DbGllbnR9ID0gYXdhaXQgaW1wb3J0KFwiLi4vYmVhY29uL2NsaWVudC5qc1wiKVxuXG4gICAgcmV0dXJuIEJlYWNvbkNsaWVudFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbG9hZCBpbiBwcm9jZXNzIGJlYWNvbiBjbGllbnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHR5cGVvZiBpbXBvcnQoXCIuLi9iZWFjb24vaW4tcHJvY2Vzcy1jbGllbnQuanNcIikuZGVmYXVsdD59IC0gSW4tcHJvY2VzcyBjbGllbnQgY2xhc3MuXG4gICAqL1xuICBhc3luYyBsb2FkSW5Qcm9jZXNzQmVhY29uQ2xpZW50KCkge1xuICAgIGNvbnN0IHtkZWZhdWx0OiBJblByb2Nlc3NCZWFjb25DbGllbnR9ID0gYXdhaXQgaW1wb3J0KFwiLi4vYmVhY29uL2luLXByb2Nlc3MtY2xpZW50LmpzXCIpXG5cbiAgICByZXR1cm4gSW5Qcm9jZXNzQmVhY29uQ2xpZW50XG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGkgY29tbWFuZHMgZGIgc2NoZW1hIGR1bXAuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiKS5kZWZhdWx0fSBjb21tYW5kIC0gQ29tbWFuZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNvbW1hbmQgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgY2xpQ29tbWFuZHNEYlNjaGVtYUR1bXAoY29tbWFuZCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmZvcndhcmRDb21tYW5kKGNvbW1hbmQsIENsaUNvbW1hbmRzRGJTY2hlbWFEdW1wKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xpIGNvbW1hbmRzIGRiIHNjaGVtYSBsb2FkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NsaS9iYXNlLWNvbW1hbmQuanNcIikuZGVmYXVsdH0gY29tbWFuZCAtIENvbW1hbmQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjb21tYW5kIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGNsaUNvbW1hbmRzRGJTY2hlbWFMb2FkKGNvbW1hbmQpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5mb3J3YXJkQ29tbWFuZChjb21tYW5kLCBDbGlDb21tYW5kc0RiU2NoZW1hTG9hZClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsaSBjb21tYW5kcyBkYiBzZWVkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NsaS9iYXNlLWNvbW1hbmQuanNcIikuZGVmYXVsdH0gY29tbWFuZCAtIENvbW1hbmQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjb21tYW5kIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIGNsaUNvbW1hbmRzRGJTZWVkKGNvbW1hbmQpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5mb3J3YXJkQ29tbWFuZChjb21tYW5kLCBDbGlDb21tYW5kc0RiU2VlZClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsaSBjb21tYW5kcyBydW5uZXIuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiKS5kZWZhdWx0fSBjb21tYW5kIC0gQ29tbWFuZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNvbW1hbmQgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgY2xpQ29tbWFuZHNSdW5uZXIoY29tbWFuZCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmZvcndhcmRDb21tYW5kKGNvbW1hbmQsIENsaUNvbW1hbmRzUnVubmVyKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2xpIGNvbW1hbmRzIHJ1biBzY3JpcHQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiKS5kZWZhdWx0fSBjb21tYW5kIC0gQ29tbWFuZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNvbW1hbmQgcmVzdWx0LlxuICAgKi9cbiAgYXN5bmMgY2xpQ29tbWFuZHNSdW5TY3JpcHQoY29tbWFuZCkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmZvcndhcmRDb21tYW5kKGNvbW1hbmQsIENsaUNvbW1hbmRzUnVuU2NyaXB0KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVxdWlyZSBjb21tYW5kLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBhcmdzLmNvbW1hbmRQYXJ0cyAtIENvbW1hbmQgcGFydHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHR5cGVvZiBpbXBvcnQgKFwiLi4vY2xpL2Jhc2UtY29tbWFuZC5qc1wiKS5kZWZhdWx0Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSByZXF1aXJlIGNvbW1hbmQuXG4gICAqL1xuICBhc3luYyByZXF1aXJlQ29tbWFuZCh7Y29tbWFuZFBhcnRzfSkge1xuICAgIGNvbnN0IGNvbW1hbmRzID0gYXdhaXQgdGhpcy5maW5kQ29tbWFuZHMoKVxuICAgIGNvbnN0IGNvbW1hbmROYW1lID0gY29tbWFuZFBhcnRzLmpvaW4oXCI6XCIpXG4gICAgY29uc3QgY29tbWFuZCA9IGNvbW1hbmRzLmZpbmQoKGFDb21tYW5kKSA9PiBhQ29tbWFuZC5uYW1lID09PSBjb21tYW5kTmFtZSlcblxuICAgIGlmICghY29tbWFuZCkge1xuICAgICAgY29uc3QgcG9zc2libGVDb21tYW5kcyA9IGNvbW1hbmRzLm1hcChhQ29tbWFuZCA9PiBhQ29tbWFuZC5uYW1lKVxuXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gY29tbWFuZDogJHtjb21tYW5kUGFydHMuam9pbihcIjpcIil9IHdoaWNoIHNob3VsZCBoYXZlIGJlZW4gb25lIG9mOiAke3Bvc3NpYmxlQ29tbWFuZHMuc29ydCgpLmpvaW4oXCIsIFwiKX1gKVxuICAgIH1cblxuICAgIGNvbnN0IGNvbW1hbmRDbGFzc0ltcG9ydCA9IGF3YWl0IGltcG9ydCh0b0ltcG9ydFNwZWNpZmllcihjb21tYW5kLmZpbGUpKVxuICAgIGNvbnN0IENvbW1hbmRDbGFzcyA9IGNvbW1hbmRDbGFzc0ltcG9ydC5kZWZhdWx0XG5cbiAgICByZXR1cm4gQ29tbWFuZENsYXNzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5kIG1pZ3JhdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5PGltcG9ydChcIi4vYmFzZS5qc1wiKS5NaWdyYXRpb25PYmplY3RUeXBlPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgbWlncmF0aW9ucy5cbiAgICovXG4gIGFzeW5jIGZpbmRNaWdyYXRpb25zKCkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKVxuICAgIGNvbnN0IG1pZ3JhdGlvbkRpcmVjdG9yaWVzID0gW2Ake2NvbmZpZ3VyYXRpb24uZ2V0RGlyZWN0b3J5KCl9L3NyYy9kYXRhYmFzZS9taWdyYXRpb25zYF1cblxuICAgIGZvciAoY29uc3QgdmVsb2Npb3VzUGFja2FnZSBvZiBjb25maWd1cmF0aW9uLmdldFBhY2thZ2VzKCkpIHtcbiAgICAgIG1pZ3JhdGlvbkRpcmVjdG9yaWVzLnB1c2godmVsb2Npb3VzUGFja2FnZS5nZXRNaWdyYXRpb25zUGF0aCgpKVxuICAgIH1cblxuICAgIC8qKiBAdHlwZSB7QXJyYXk8aW1wb3J0KFwiLi9iYXNlLmpzXCIpLk1pZ3JhdGlvbk9iamVjdFR5cGU+fSAqL1xuICAgIGNvbnN0IGZpbGVzID0gW11cblxuICAgIGZvciAoY29uc3QgbWlncmF0aW9uc1BhdGggb2YgbWlncmF0aW9uRGlyZWN0b3JpZXMpIHtcbiAgICAgIGF3YWl0IHRoaXMuX2NvbGxlY3RNaWdyYXRpb25zRnJvbURpcmVjdG9yeShtaWdyYXRpb25zUGF0aCwgZmlsZXMpXG4gICAgfVxuXG4gICAgdGhpcy5fZW5zdXJlTm9NaWdyYXRpb25UaW1lc3RhbXBDb2xsaXNpb25zKGZpbGVzKVxuXG4gICAgcmV0dXJuIGZpbGVzLnNvcnQoKG1pZ3JhdGlvbjEsIG1pZ3JhdGlvbjIpID0+IG1pZ3JhdGlvbjEuZGF0ZSAtIG1pZ3JhdGlvbjIuZGF0ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBDb2xsZWN0cyBtaWdyYXRpb24gZmlsZXMgZnJvbSBvbmUgZGlyZWN0b3J5IGludG8gYGZpbGVzYCwgcHJlc2VydmluZyBlYWNoXG4gICAqIGZpbGUncyByZWFsIGFic29sdXRlIHBhdGggKHNvIGFwcCBhbmQgcGFja2FnZSBtaWdyYXRpb25zIGtlZXAgdGhlaXIgb3duXG4gICAqIHNvdXJjZSBsb2NhdGlvbikuIEEgbWlzc2luZyBkaXJlY3RvcnkgaXMgc2tpcHBlZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG1pZ3JhdGlvbnNQYXRoIC0gRGlyZWN0b3J5IHRvIHNjYW4uXG4gICAqIEBwYXJhbSB7QXJyYXk8aW1wb3J0KFwiLi9iYXNlLmpzXCIpLk1pZ3JhdGlvbk9iamVjdFR5cGU+fSBmaWxlcyAtIEFjY3VtdWxhdG9yIHRvIHB1c2ggaW50by5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9jb2xsZWN0TWlncmF0aW9uc0Zyb21EaXJlY3RvcnkobWlncmF0aW9uc1BhdGgsIGZpbGVzKSB7XG4gICAgY29uc3QgZ2xvYiA9IGF3YWl0IGZzLmdsb2IoYCR7bWlncmF0aW9uc1BhdGh9LyoqLyouanNgKVxuXG4gICAgdHJ5IHtcbiAgICAgIGZvciBhd2FpdCAoY29uc3QgZnVsbFBhdGggb2YgZ2xvYikge1xuICAgICAgICBjb25zdCBmaWxlID0gYXdhaXQgcGF0aC5iYXNlbmFtZShmdWxsUGF0aClcbiAgICAgICAgY29uc3QgbWF0Y2ggPSBmaWxlLm1hdGNoKC9eKFxcZHsxNH0pLSguKylcXC5qcyQvKVxuXG4gICAgICAgIGlmICghbWF0Y2gpIGNvbnRpbnVlXG5cbiAgICAgICAgY29uc3QgZGF0ZSA9IHBhcnNlSW50KG1hdGNoWzFdKVxuICAgICAgICBjb25zdCBtaWdyYXRpb25OYW1lID0gbWF0Y2hbMl1cbiAgICAgICAgY29uc3QgbWlncmF0aW9uQ2xhc3NOYW1lID0gaW5mbGVjdGlvbi5jYW1lbGl6ZShtaWdyYXRpb25OYW1lLnJlcGxhY2VBbGwoXCItXCIsIFwiX1wiKSlcblxuICAgICAgICBmaWxlcy5wdXNoKHtmaWxlLCBmdWxsUGF0aCwgZGF0ZSwgbWlncmF0aW9uQ2xhc3NOYW1lfSlcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKC8qKiBAdHlwZSB7RXJyb3IgJiB7Y29kZT86IHN0cmluZ319ICovIChlcnJvcik/LmNvZGUgIT09IFwiRU5PRU5UXCIpIHtcbiAgICAgICAgdGhyb3cgZXJyb3JcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogVGhyb3dzIGlmIHR3byBtaWdyYXRpb25zIGZyb20gZGlmZmVyZW50IGZpbGVzIHNoYXJlIHRoZSBzYW1lIDE0LWRpZ2l0XG4gICAqIHRpbWVzdGFtcC4gVGhlIGBzY2hlbWFfbWlncmF0aW9uc2AgbGVkZ2VyIGtleXMgb24gdGhlIHRpbWVzdGFtcCwgc28gYSBzaWxlbnRcbiAgICogY29sbGlzaW9uIChlLmcuIGJldHdlZW4gdGhlIGFwcCBhbmQgYSBwYWNrYWdlLCBvciB0d28gcGFja2FnZXMpIHdvdWxkIGxlYXZlXG4gICAqIHRoZSBzZWNvbmQgbWlncmF0aW9uIHVuLXJ1biDigJQgYSBkYXRhIGJ1Zy4gRmFpbCBsb3VkbHkgaW5zdGVhZC5cbiAgICogQHBhcmFtIHtBcnJheTxpbXBvcnQoXCIuL2Jhc2UuanNcIikuTWlncmF0aW9uT2JqZWN0VHlwZT59IGZpbGVzIC0gQ29sbGVjdGVkIG1pZ3JhdGlvbnMuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIF9lbnN1cmVOb01pZ3JhdGlvblRpbWVzdGFtcENvbGxpc2lvbnMoZmlsZXMpIHtcbiAgICAvKiogQHR5cGUge01hcDxudW1iZXIsIHN0cmluZz59ICovXG4gICAgY29uc3QgcGF0aHNCeURhdGUgPSBuZXcgTWFwKClcblxuICAgIGZvciAoY29uc3QgbWlncmF0aW9uIG9mIGZpbGVzKSB7XG4gICAgICBpZiAoIW1pZ3JhdGlvbi5mdWxsUGF0aCkgY29udGludWVcblxuICAgICAgY29uc3QgZXhpc3RpbmcgPSBwYXRoc0J5RGF0ZS5nZXQobWlncmF0aW9uLmRhdGUpXG5cbiAgICAgIGlmIChleGlzdGluZyAmJiBleGlzdGluZyAhPT0gbWlncmF0aW9uLmZ1bGxQYXRoKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgVHdvIG1pZ3JhdGlvbnMgc2hhcmUgdGhlIHRpbWVzdGFtcCAke21pZ3JhdGlvbi5kYXRlfTogJHtleGlzdGluZ30gYW5kICR7bWlncmF0aW9uLmZ1bGxQYXRofS4gTWlncmF0aW9uIHRpbWVzdGFtcHMgbXVzdCBiZSB1bmlxdWUgYWNyb3NzIHRoZSBhcHAgYW5kIGFsbCBwYWNrYWdlcy5gKVxuICAgICAgfVxuXG4gICAgICBwYXRoc0J5RGF0ZS5zZXQobWlncmF0aW9uLmRhdGUsIG1pZ3JhdGlvbi5mdWxsUGF0aClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBpbXBvcnQgYXBwbGljYXRpb24gcm91dGVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuLi9yb3V0ZXMvaW5kZXguanNcIikuZGVmYXVsdD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgaW1wb3J0IGFwcGxpY2F0aW9uIHJvdXRlcy5cbiAgICovXG4gIGFzeW5jIGltcG9ydEFwcGxpY2F0aW9uUm91dGVzKCkge1xuICAgIGNvbnN0IHJvdXRlc0ltcG9ydCA9IGF3YWl0IGltcG9ydCh0b0ltcG9ydFNwZWNpZmllcihgJHt0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXREaXJlY3RvcnkoKX0vc3JjL2NvbmZpZy9yb3V0ZXMuanNgKSlcblxuICAgIHJldHVybiByb3V0ZXNJbXBvcnQuZGVmYXVsdFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHZlbG9jaW91cyBwYXRoLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSAtIFJlc29sdmVzIHdpdGggdGhlIHZlbG9jaW91cyBwYXRoLlxuICAgKi9cbiAgYXN5bmMgZ2V0VmVsb2Npb3VzUGF0aCgpIHtcbiAgICBpZiAoIXRoaXMuX3ZlbG9jaW91c1BhdGgpIHtcbiAgICAgIGNvbnN0IF9fZmlsZW5hbWUgPSBmaWxlVVJMVG9QYXRoKGltcG9ydC5tZXRhLnVybClcbiAgICAgIGNvbnN0IF9fZGlybmFtZSA9IGRpcm5hbWUoX19maWxlbmFtZSlcblxuICAgICAgdGhpcy5fdmVsb2Npb3VzUGF0aCA9IGF3YWl0IGZzLnJlYWxwYXRoKGAke19fZGlybmFtZX0vLi4vLi5gKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl92ZWxvY2lvdXNQYXRoXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpbXBvcnQgdGVzdCBmaWxlcy5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gdGVzdEZpbGVzIC0gVGVzdCBmaWxlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGltcG9ydFRlc3RGaWxlcyh0ZXN0RmlsZXMpIHtcbiAgICBmb3IgKGNvbnN0IHRlc3RGaWxlIG9mIHRlc3RGaWxlcykge1xuICAgICAgYXdhaXQgaW1wb3J0KHRvSW1wb3J0U3BlY2lmaWVyKHRlc3RGaWxlKSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZGVmYXVsdCBsb2cgZGlyZWN0b3J5LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gYXJncy5jb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgZGVmYXVsdCBsb2cgZGlyZWN0b3J5LlxuICAgKi9cbiAgZ2V0RGVmYXVsdExvZ0RpcmVjdG9yeSh7Y29uZmlndXJhdGlvbn0pIHtcbiAgICByZXR1cm4gcGF0aC5qb2luKGNvbmZpZ3VyYXRpb24uZ2V0RGlyZWN0b3J5KCksIFwibG9nXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgbG9nIGZpbGUgcGF0aC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGFyZ3MuY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBhcmdzLmRpcmVjdG9yeSAtIERpcmVjdG9yeSBwYXRoLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5lbnZpcm9ubWVudCAtIEVudmlyb25tZW50LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSAtIFRoZSBsb2cgZmlsZSBwYXRoLlxuICAgKi9cbiAgZ2V0TG9nRmlsZVBhdGgoe2NvbmZpZ3VyYXRpb24sIGRpcmVjdG9yeSwgZW52aXJvbm1lbnR9KSB7XG4gICAgY29uc3QgYWN0dWFsRGlyZWN0b3J5ID0gZGlyZWN0b3J5IHx8IGNvbmZpZ3VyYXRpb24/LmdldERpcmVjdG9yeT8uKClcblxuICAgIGlmICghYWN0dWFsRGlyZWN0b3J5KSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgICByZXR1cm4gcGF0aC5qb2luKGFjdHVhbERpcmVjdG9yeSwgYCR7ZW52aXJvbm1lbnR9LmxvZ2ApXG4gIH1cblxuICAvKipcbiAgICogUnVucyB3cml0ZSBsb2cgdG8gZmlsZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuZmlsZVBhdGggLSBGaWxlIHBhdGguXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLm1lc3NhZ2UgLSBNZXNzYWdlIHRleHQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyB3cml0ZUxvZ1RvRmlsZSh7ZmlsZVBhdGgsIG1lc3NhZ2V9KSB7XG4gICAgYXdhaXQgZnMubWtkaXIocGF0aC5kaXJuYW1lKGZpbGVQYXRoKSwge3JlY3Vyc2l2ZTogdHJ1ZX0pXG4gICAgYXdhaXQgZnMuYXBwZW5kRmlsZShmaWxlUGF0aCwgYCR7bWVzc2FnZX1cXG5gLCBcInV0ZjhcIilcbiAgfVxuXG4gIGFzeW5jIGltcG9ydFRlc3RpbmdDb25maWdQYXRoKCkge1xuICAgIGNvbnN0IHRlc3RpbmdDb25maWdQYXRoID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZ2V0VGVzdGluZygpXG5cbiAgICBpZiAoIXRlc3RpbmdDb25maWdQYXRoKSByZXR1cm5cblxuICAgIGNvbnN0IHRlc3RpbmdJbXBvcnQgPSBhd2FpdCBpbXBvcnQodG9JbXBvcnRTcGVjaWZpZXIodGVzdGluZ0NvbmZpZ1BhdGgpKVxuICAgIGNvbnN0IHRlc3RpbmdEZWZhdWx0ID0gdGVzdGluZ0ltcG9ydC5kZWZhdWx0XG5cbiAgICBpZiAoIXRlc3RpbmdEZWZhdWx0KSB0aHJvdyBuZXcgRXJyb3IoXCJUZXN0aW5nIGNvbmZpZyBtdXN0IGV4cG9ydCBhIGRlZmF1bHQgZnVuY3Rpb25cIilcbiAgICBpZiAodHlwZW9mIHRlc3RpbmdEZWZhdWx0ICE9PSBcImZ1bmN0aW9uXCIpIHRocm93IG5ldyBFcnJvcihcIlRlc3RpbmcgY29uZmlnIGRlZmF1bHQgZXhwb3J0IGlzbid0IGEgZnVuY3Rpb25cIilcblxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRlc3RpbmdEZWZhdWx0KClcblxuICAgIGlmICh0eXBlb2YgcmVzdWx0ID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIGF3YWl0IHJlc3VsdCgpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVxdWlyZSBtaWdyYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBmaWxlUGF0aCAtIEZpbGUgcGF0aC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi4vZGF0YWJhc2UvbWlncmF0aW9uL2luZGV4LmpzXCIpLmRlZmF1bHQ+fSAtIFJlc29sdmVzIHdpdGggdGhlIHJlcXVpcmUgbWlncmF0aW9uLlxuICAgKi9cbiAgYXN5bmMgcmVxdWlyZU1pZ3JhdGlvbihmaWxlUGF0aCkge1xuICAgIGNvbnN0IG1pZ3JhdGlvbkltcG9ydCA9IGF3YWl0IGltcG9ydCh0b0ltcG9ydFNwZWNpZmllcihmaWxlUGF0aCkpXG4gICAgY29uc3QgbWlncmF0aW9uSW1wb3J0RGVmYXVsdCA9IG1pZ3JhdGlvbkltcG9ydC5kZWZhdWx0XG5cbiAgICBpZiAoIW1pZ3JhdGlvbkltcG9ydERlZmF1bHQpIHRocm93IG5ldyBFcnJvcihcIk1pZ3JhdGlvbiBmaWxlIG11c3QgZXhwb3J0IGEgZGVmYXVsdCBtaWdyYXRpb24gY2xhc3NcIilcbiAgICBpZiAodHlwZW9mIG1pZ3JhdGlvbkltcG9ydERlZmF1bHQgIT09IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IEVycm9yKFwiTWlncmF0aW9uIGRlZmF1bHQgZXhwb3J0IGlzbid0IGEgZnVuY3Rpb24gKHNob3VsZCBiZSBhIGNsYXNzIHdoaWNoIGlzIGEgZnVuY3Rpb24gaW4gSlMpXCIpXG5cbiAgICByZXR1cm4gbWlncmF0aW9uSW1wb3J0RGVmYXVsdFxuICB9XG5cbiAgYXN5bmMgZ2V0QmFzZVBhdGgoKSB7XG4gICAgY29uc3QgX19maWxlbmFtZSA9IGZpbGVVUkxUb1BhdGgoaW1wb3J0Lm1ldGEudXJsKVxuICAgIGNvbnN0IGJhc2VQYXRoID0gYXdhaXQgZnMucmVhbHBhdGgoYCR7ZGlybmFtZShfX2ZpbGVuYW1lKX0vLi4vLi5gKVxuXG4gICAgcmV0dXJuIGJhc2VQYXRoXG4gIH1cblxuICAvKipcbiAgICogRW5zdXJlcyBWZWxvY2lvdXMgZnJhbWV3b3JrIHNjaGVtYSBleGlzdHMgYXMgcGFydCBvZiBgZGI6bWlncmF0ZWAsIHNvIGludGVybmFsXG4gICAqIHRhYmxlcyBhcmUgY3JlYXRlZCBkZXRlcm1pbmlzdGljYWxseSBhbG9uZ3NpZGUgYXBwIG1pZ3JhdGlvbnMgYW5kIGNhcHR1cmVkIGluXG4gICAqIHRoZSBkdW1wZWQgc3RydWN0dXJlIFNRTCBpbnN0ZWFkIG9mIGFwcGVhcmluZyBvbmx5IHdoZW4gcnVudGltZSBzdG9yZXMgYm9vdC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdD59IGFyZ3MuZGJzIC0gRGJzIGJlaW5nIG1pZ3JhdGVkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgZW5zdXJlRnJhbWV3b3JrU2NoZW1hKHtkYnN9KSB7XG4gICAgLy8gTWlncmF0aW9uIHBhc3NlcyBpdHMgYWxyZWFkeSBjaGVja2VkLW91dCBEQiBpbnRvIHRoZSBhZGFwdGVyIGhvb2suIERvIG5vdFxuICAgIC8vIHJ1biBydW50aW1lIHJlYWRpbmVzcyBoZXJlOiBpdCB3b3VsZCBvcGVuIGEgbmVzdGVkIGNoZWNrb3V0IGFuZCBjYW4gZGVhZGxvY2tcbiAgICAvLyBhIHNpbmdsZS1jb25uZWN0aW9uIG1pZ3JhdGlvbiBwb29sLlxuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKVxuXG4gICAgZm9yIChjb25zdCBbZGF0YWJhc2VJZGVudGlmaWVyLCBkYl0gb2YgT2JqZWN0LmVudHJpZXMoZGJzKSkge1xuICAgICAgY29uc3QgYXR0YWNobWVudFN0b3JlID0gbmV3IFJlY29yZEF0dGFjaG1lbnRzU3RvcmUoe2NvbmZpZ3VyYXRpb24sIGRhdGFiYXNlSWRlbnRpZmllcn0pXG5cbiAgICAgIGF3YWl0IGF0dGFjaG1lbnRTdG9yZS5lbnN1cmVTY2hlbWEoZGIpXG4gICAgfVxuXG4gICAgY29uc3QgYWRhcHRlciA9IGNvbmZpZ3VyYXRpb24uZ2V0QmFja2dyb3VuZEpvYnNBZGFwdGVyKClcblxuICAgIGF3YWl0IGFkYXB0ZXIuZW5zdXJlRnJhbWV3b3JrU2NoZW1hKHtkYnN9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWZ0ZXIgbWlncmF0aW9ucy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdD59IGFyZ3MuZGJzIC0gRGJzLlxuICAgKiBAcGFyYW0ge1wibWlncmF0aW9uXCIgfCBcInNjaGVtYUR1bXBcIn0gW2FyZ3MucmVhc29uXSAtIFdoeSB0aGUgc3RydWN0dXJlIHdyaXRlIGlzIGJlaW5nIHRyaWdnZXJlZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGFmdGVyTWlncmF0aW9ucyh7ZGJzLCByZWFzb24gPSBcIm1pZ3JhdGlvblwifSkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKVxuXG4gICAgaWYgKCFjb25maWd1cmF0aW9uLnNob3VsZFdyaXRlU3RydWN0dXJlU3FsKHtyZWFzb259KSkgcmV0dXJuXG5cbiAgICBjb25zdCBkYkRpciA9IHBhdGguam9pbihjb25maWd1cmF0aW9uLmdldERpcmVjdG9yeSgpLCBcImRiXCIpXG4gICAgY29uc3Qgc3RydWN0dXJlU3FsQnlJZGVudGlmaWVyID0gYXdhaXQgdGhpcy5fc3RydWN0dXJlU3FsQnlJZGVudGlmaWVyKHtkYnN9KVxuXG4gICAgYXdhaXQgZnMubWtkaXIoZGJEaXIsIHtyZWN1cnNpdmU6IHRydWV9KVxuXG4gICAgZm9yIChjb25zdCBpZGVudGlmaWVyIG9mIE9iamVjdC5rZXlzKHN0cnVjdHVyZVNxbEJ5SWRlbnRpZmllcikpIHtcbiAgICAgIGNvbnN0IHN0cnVjdHVyZVNxbCA9IHN0cnVjdHVyZVNxbEJ5SWRlbnRpZmllcltpZGVudGlmaWVyXVxuXG4gICAgICBpZiAoIXN0cnVjdHVyZVNxbCkgY29udGludWVcblxuICAgICAgY29uc3QgZmlsZVBhdGggPSBwYXRoLmpvaW4oZGJEaXIsIGBzdHJ1Y3R1cmUtJHtpZGVudGlmaWVyfS5zcWxgKVxuXG4gICAgICBhd2FpdCBmcy53cml0ZUZpbGUoZmlsZVBhdGgsIHN0cnVjdHVyZVNxbClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdHJ1Y3R1cmUgc3FsIGJ5IGlkZW50aWZpZXIuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQ+fSBhcmdzLmRicyAtIERicy5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVjb3JkPHN0cmluZywgc3RyaW5nPj59IC0gUmVzb2x2ZXMgd2l0aCBTUUwgc3RyaW5nLlxuICAgKi9cbiAgYXN5bmMgX3N0cnVjdHVyZVNxbEJ5SWRlbnRpZmllcih7ZGJzfSkge1xuICAgIGNvbnN0IHNxbEJ5SWRlbnRpZmllciA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn0gKi8gKHt9KVxuXG4gICAgZm9yIChjb25zdCBpZGVudGlmaWVyIG9mIE9iamVjdC5rZXlzKGRicykpIHtcbiAgICAgIGNvbnN0IGRiID0gZGJzW2lkZW50aWZpZXJdXG5cbiAgICAgIGlmICh0eXBlb2YgZGIuc3RydWN0dXJlU3FsICE9PSBcImZ1bmN0aW9uXCIpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IHN0cnVjdHVyZVNxbCA9IGF3YWl0IGRiLnN0cnVjdHVyZVNxbCgpXG5cbiAgICAgIGlmIChzdHJ1Y3R1cmVTcWwpIHtcbiAgICAgICAgY29uc3QgbWlncmF0aW9uSW5zZXJ0cyA9IGF3YWl0IHRoaXMuX3NjaGVtYU1pZ3JhdGlvbnNJbnNlcnRTcWwoe2RifSlcblxuICAgICAgICBzcWxCeUlkZW50aWZpZXJbaWRlbnRpZmllcl0gPSBzdHJ1Y3R1cmVTcWwgKyBtaWdyYXRpb25JbnNlcnRzXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHNxbEJ5SWRlbnRpZmllclxuICB9XG5cbiAgLyoqXG4gICAqIEdlbmVyYXRlcyBJTlNFUlQgc3RhdGVtZW50cyBmb3IgZXZlcnkgcm93IGluIGBzY2hlbWFfbWlncmF0aW9uc2Agc28gdGhlXG4gICAqIHN0cnVjdHVyZSBzbmFwc2hvdCBjYXJyaWVzIHRoZSBtaWdyYXRpb24gbGVkZ2VyIGFsb25nIHdpdGggdGhlIERETC4gIFdpdGhvdXRcbiAgICogdGhlc2Ugcm93cyBhIGZyZXNoIERCIGxvYWRlZCBmcm9tIHRoZSBzbmFwc2hvdCB3aWxsIHJlLXJ1biBldmVyeSBtaWdyYXRpb24sXG4gICAqIHdoaWNoIGZhaWxzIHdoZW4gdGhlIHNuYXBzaG90IGFscmVhZHkgY29udGFpbnMgdGhlIHBvc3QtbWlncmF0aW9uIHNjaGVtYS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gYXJncy5kYiAtIERhdGFiYXNlIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IC0gSU5TRVJUIHN0YXRlbWVudHMgKGVtcHR5IHN0cmluZyB3aGVuIG5vbmUpLlxuICAgKi9cbiAgYXN5bmMgX3NjaGVtYU1pZ3JhdGlvbnNJbnNlcnRTcWwoe2RifSkge1xuICAgIGNvbnN0IHtkZWZhdWx0OiBNaWdyYXRpb25zTGVkZ2VyfSA9IGF3YWl0IGltcG9ydChcIi4uL2RhdGFiYXNlL21pZ3JhdGlvbnMtbGVkZ2VyLmpzXCIpXG5cbiAgICBpZiAoIWF3YWl0IE1pZ3JhdGlvbnNMZWRnZXIudGFibGVFeGlzdHMoZGIpKSByZXR1cm4gXCJcIlxuXG4gICAgY29uc3QgdmVyc2lvbnMgPSBhd2FpdCBNaWdyYXRpb25zTGVkZ2VyLmFwcGxpZWRWZXJzaW9ucyhkYilcblxuICAgIGlmICh2ZXJzaW9ucy5sZW5ndGggPT0gMCkgcmV0dXJuIFwiXCJcblxuICAgIHJldHVybiB2ZXJzaW9ucy5tYXAoKHZlcnNpb24pID0+IGBJTlNFUlQgSU5UTyBzY2hlbWFfbWlncmF0aW9ucyAodmVyc2lvbikgVkFMVUVTICgke2RiLnF1b3RlKHZlcnNpb24pfSk7YCkuam9pbihcIlxcblwiKSArIFwiXFxuXCJcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgZnJvbnRlbmQtbW9kZWwgd2Vic29ja2V0IGNoYW5uZWwgcHVibGlzaGVycyBzbyBsaWZlY3ljbGVcbiAgICogZXZlbnQgaG9va3MgYnJvYWRjYXN0IG92ZXIgdGhlIHNoYXJlZCBcImZyb250ZW5kLW1vZGVsc1wiIGNoYW5uZWwuXG4gICAqIFRoaXMgaXMgb25seSBpbXBsZW1lbnRlZCBieSB0aGUgTm9kZSBoYW5kbGVyIGJlY2F1c2UgdGhlIHJlcXVpcmVkXG4gICAqIG1vZHVsZXMgKGBmcm9udGVuZC1tb2RlbC1jb250cm9sbGVyYCwgYHJvdXRlcy9yZXNvbHZlcmApIHB1bGwgaW5cbiAgICogc2VydmVyLW9ubHkgTm9kZSBBUElzIHRoYXQgYnJlYWsgYnJvd3NlciBidW5kbGVycy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgaW5pdGlhbGl6ZUZyb250ZW5kTW9kZWxXZWJzb2NrZXRQdWJsaXNoZXJzKGNvbmZpZ3VyYXRpb24pIHtcbiAgICAvLyBEaXNjb3ZlciBlYWNoIGJhY2tlbmQgcHJvamVjdCdzIHJlc291cmNlcyBiZWZvcmUgcmVnaXN0ZXJpbmcgcHVibGlzaGVycy4gVGhlIHB1Ymxpc2hlcnMgYXJlXG4gICAgLy8gZGVyaXZlZCBmcm9tIGBiYWNrZW5kUHJvamVjdC5mcm9udGVuZE1vZGVsc2AsIHdoaWNoIGBhdXRvRGlzY292ZXJSZXNvdXJjZXNgIHBvcHVsYXRlcy4gV2l0aG91dFxuICAgIC8vIHRoaXMsIHJlZ2lzdHJhdGlvbiBydW5zIGFnYWluc3QgYW4gZW1wdHkvcGFydGlhbCByZXNvdXJjZSBzZXQgKG9ubHkgYnVpbHQtaW5zKSwgc28gYXBwcyB0aGF0XG4gICAgLy8gcmVzb2x2ZSByZXNvdXJjZXMgdGhyb3VnaCBhbiBgYWJpbGl0eVJlc29sdmVyYCByYXRoZXIgdGhhbiBhIHN0YXRpYyBhYmlsaXR5LXJlc291cmNlIGxpc3QgbmV2ZXJcbiAgICAvLyByZWdpc3RlciBsaWZlY3ljbGUgcHVibGlzaGVycyBhbmQgdGhlaXIgcmVhbHRpbWUgZnJvbnRlbmQtbW9kZWwgdXBkYXRlcyBzaWxlbnRseSBzdG9wLiBUaGVcbiAgICAvLyBsaWZlY3ljbGUgaG9va3MgYXJlIGRlZHVwZWQgcGVyIG1vZGVsIGNsYXNzIHZpYSBhIHByb2Nlc3MtZ2xvYmFsIHNldCwgc28gYSBsYXRlciwgZnVsbHlcbiAgICAvLyBkaXNjb3ZlcmVkIHBhc3MgY2Fubm90IHJldHJvYWN0aXZlbHkgYWRkIHRoZSBtaXNzaW5nIHB1Ymxpc2hlcnMuIGBhdXRvRGlzY292ZXJSZXNvdXJjZXNgIGlzXG4gICAgLy8gaWRlbXBvdGVudCAoaXQgc2tpcHMgYmFja2VuZCBwcm9qZWN0cyB3aG9zZSBgZnJvbnRlbmRNb2RlbHNgIGFyZSBhbHJlYWR5IHNldCkuXG4gICAgYXdhaXQgdGhpcy5hdXRvRGlzY292ZXJSZXNvdXJjZXMoY29uZmlndXJhdGlvbilcblxuICAgIGNvbnN0IHtlbnN1cmVGcm9udGVuZE1vZGVsV2Vic29ja2V0UHVibGlzaGVyc1JlZ2lzdGVyZWR9ID0gYXdhaXQgaW1wb3J0KFwiLi4vZnJvbnRlbmQtbW9kZWxzL3dlYnNvY2tldC1wdWJsaXNoZXJzLmpzXCIpXG5cbiAgICBhd2FpdCBlbnN1cmVGcm9udGVuZE1vZGVsV2Vic29ja2V0UHVibGlzaGVyc1JlZ2lzdGVyZWQoY29uZmlndXJhdGlvbilcbiAgfVxufVxuIl19