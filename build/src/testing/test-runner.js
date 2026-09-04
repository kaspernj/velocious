// @ts-check
import fs from "node:fs/promises";
import path from "path";
import { AsyncLocalStorage } from "node:async_hooks";
import { createTestContext, defaultTestContext } from "@velocious/testing";
import { TestRunner as PackageTestRunner } from "@velocious/testing/runner";
import Application from "../../src/application.js";
import RequestClient from "./request-client.js";
import picocolors from "picocolors";
import restArgsError from "../utils/rest-args-error.js";
import { testConfig } from "./test.js";
import { fileURLToPath, pathToFileURL } from "url";
import SharedTransactionBroker from "./shared-transaction-broker.js";
import { SHARED_TRANSACTION_BROKER_ENV } from "./shared-transaction-proxy-driver.js";
import VelociousAttemptExecutor from "./velocious-attempt-executor.js";
import VelociousRunnerReporter, { AbortRemainingTestsError } from "./velocious-runner-reporter.js";
import VelociousSuiteHookExecutor from "./velocious-suite-hook-executor.js";
import VelociousTestArguments from "./velocious-test-arguments.js";
/** @typedef {typeof defaultTestContext} PackageTestContext */
/** @typedef {(typeof defaultTestContext.registry.suites)[number]} PackageSuiteDeclaration */
/** @typedef {PackageSuiteDeclaration["tests"][number]} PackageTestDeclaration */
/** @typedef {PackageSuiteDeclaration["hooks"]["beforeAll"][number]} PackageHookDeclaration */
/** @typedef {PackageSuiteDeclaration | PackageTestDeclaration | PackageHookDeclaration} PackageRegistration */
/** @typedef {{hadRetries: boolean, options: PackageTestDeclaration["options"], retries: number | undefined}} PackageRetryOptionRestoration */
/**
 * AttemptConsoleOutput type.
 * @typedef {object} AttemptConsoleOutput
 * @property {number} attemptNumber - Attempt number.
 * @property {string} output - Captured console output.
 */
/**
 * TestArgs type.
 * @typedef {object} TestArgs
 * @property {Application} [application] - Application instance for integration tests.
 * @property {RequestClient} [client] - HTTP client for request tests.
 * @property {object} [databaseCleaning] - Database cleanup options for tests.
 * @property {boolean} [databaseCleaning.transaction] - Use transactions to rollback between tests.
 * @property {boolean} [databaseCleaning.truncate] - Truncate tables between tests.
 * @property {boolean} [databaseCleaning.truncateBefore] - Truncate tables before each test, in addition to the default cleanup.
 * @property {boolean} [focus] - Whether this test is focused.
 * @property {() => (void|Promise<void>)} [function] - Test callback function.
 * @property {number} [retry] - Number of retries when a test fails.
 * @property {string[] | string} [tags] - Tags for filtering.
 * @property {number} [timeoutSeconds] - Timeout in seconds for the test.
 * @property {string} [type] - Test type identifier.
 * @property {(args: {databaseIdentifier: string, tenant: object}) => Promise<void>} [registerTransactionalTenant] - Registers one resolved tenant database transaction for this attempt.
 */
/**
 * BrowserDummyConnectionRegistration type.
 * @typedef {object} BrowserDummyConnectionRegistration
 * @property {import("../database/drivers/base.js").default} db - Attempt-owned connection.
 * @property {string} databaseIdentifier - Configured database identifier.
 * @property {Promise<void>} [quarantinePromise] - Shared connection-discard promise.
 * @property {boolean} quarantined - Whether the connection is unsafe to reuse.
 * @property {Promise<void>} [rollbackPromise] - Shared rollback promise.
 * @property {Promise<void>} [startPromise] - Transaction startup promise when transaction cleaning is enabled.
 */
/**
 * TestData type.
 * @typedef {object} TestData
 * @property {TestArgs} args - Arguments passed to the test.
 * @property {string} [filePath] - Source file path.
 * @property {number} [line] - Source line number.
 * @property {string} [ownerFilePath] - Deterministic importing test file.
 * @property {(arg: TestArgs) => (void|Promise<void>)} function - Test callback to execute.
 * @property {PackageTestDeclaration} [declaration] - Package declaration.
 */
/**
 * FailedTestDetail type.
 * @typedef {object} FailedTestDetail
 * @property {string} fullDescription - Full test description.
 * @property {string} [filePath] - Source file path.
 * @property {number} [line] - Source line number.
 * @property {ReturnType<typeof JSON.parse>} error - Failure error.
 * @property {string} [consoleOutput] - Captured console output while test ran.
 * @property {string} [consoleLogPath] - Saved console log path.
 */
/**
 * Defines this typedef.
 * @typedef {(args: {configuration: import("../configuration.js").default, testArgs: TestArgs, testData: TestData}) => (void|Promise<void>)} AfterBeforeEachCallbackType
 */
/**
 * AfterBeforeEachCallbackObjectType type.
 * @typedef {object} AfterBeforeEachCallbackObjectType
 * @property {AfterBeforeEachCallbackType} callback - Hook callback to execute.
 * @property {number} [declarationIndex] - Hook index within its declaration scope.
 * @property {string} [declarationScopeId] - Opaque profile scope identifier.
 * @property {string} [ownerFilePath] - Deterministic importing test file.
 */
/**
 * Defines this typedef.
 * @typedef {(args: {configuration: import("../configuration.js").default}) => (void|Promise<void>)} BeforeAfterAllCallbackType
 */
/**
 * BeforeAfterAllCallbackObjectType type.
 * @typedef {object} BeforeAfterAllCallbackObjectType
 * @property {BeforeAfterAllCallbackType} callback - Hook callback to execute.
 * @property {number} [declarationIndex] - Hook index within its declaration scope.
 * @property {string} [declarationScopeId] - Opaque profile scope identifier.
 * @property {string} [ownerFilePath] - Deterministic importing test file.
 */
/**
 * TestsArgument type.
 * @typedef {object} TestsArgument
 * @property {TestArgs} args - Arguments inherited by tests in this scope.
 * @property {boolean} [anyTestsFocussed] - Whether any tests in the tree are focused.
 * @property {AfterBeforeEachCallbackObjectType[]} afterEaches - After-each hooks for this scope.
 * @property {BeforeAfterAllCallbackObjectType[]} afterAlls - After-all hooks for this scope.
 * @property {BeforeAfterAllCallbackObjectType[]} beforeAlls - Before-all hooks for this scope.
 * @property {AfterBeforeEachCallbackObjectType[]} beforeEaches - Before-each hooks for this scope.
 * @property {string} [filePath] - Source file path.
 * @property {number} [line] - Source line number.
 * @property {string} [ownerFilePath] - Deterministic importing test file.
 * @property {Record<string, TestData>} tests - A unique identifier for the node.
 * @property {Record<string, TestsArgument>} subs - Optional child nodes. Each item is another `Node`, allowing recursion.
 */
/**
 * Marks the error thrown by the attempt timeout so the runner can distinguish
 * detached lifecycle cleanup from an ordinary test failure.
 * @typedef {Error & {velociousTestTimeout?: true}} TestTimeoutError
 */
/**
 * SharedTransactionBrokerRegistration type.
 * @typedef {object} SharedTransactionBrokerRegistration
 * @property {SharedTransactionBroker} broker - Attempt broker and connection coordinator.
 * @property {boolean} environmentPublished - Whether child-process coordinates were published.
 * @property {string | undefined} previousEnvironment - Environment value to restore after publication.
 */
/**
 * TransactionalTenantRegistration type.
 * @typedef {object} TransactionalTenantRegistration
 * @property {Promise<{connection: import("../database/drivers/base.js").default | undefined, error: Error | undefined}> | undefined} [checkoutPromise] - Attempt-owned physical checkout outcome.
 * @property {import("../database/drivers/base.js").default | undefined} connection - Attempt-owned physical connection once checkout resolves.
 * @property {Promise<void> | undefined} [cleanupPromise] - Single cleanup operation shared by emergency and eventual lifecycle cleanup.
 * @property {boolean | undefined} [discardOnCleanup] - Whether timeout emergency cleanup must quarantine this connection.
 * @property {import("../database/pool/base.js").default} pool - Owning logical pool.
 * @property {boolean} revoked - Whether this attempt may still publish the physical registration.
 * @property {string} reuseKey - Resolved physical configuration identity.
 * @property {import("../database/pool/base.js").TestSharedConnectionRegistration | undefined} sharedRegistration - Physical-key shared registration once published.
 */
/**
 * Runs to file slug.
 * @param {string} value - Value to sanitize.
 * @returns {string} - Slug-safe value.
 */
function toFileSlug(value) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80) || "failed-test";
}
export default class TestRunner {
    /** @type {PackageTestContext} */
    _context;
    /**
     * Narrows the runtime value to the documented type.
     * @type {FailedTestDetail[]} */
    _failedTestDetails;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("../configuration.js").default} args.configuration - Configuration instance.
     * @param {PackageTestContext} [args.context] - Declaration context.
     * @param {string[] | string} [args.excludeTags] - Tags to exclude.
     * @param {string[] | string} [args.includeTags] - Tags to include.
     * @param {Array<string>} args.testFiles - Test files.
     * @param {Record<string, number[]>} [args.lineFilters] - Line filters by file.
     * @param {RegExp[]} [args.examplePatterns] - Example patterns.
     * @param {import("./test-profiler.js").default} [args.profiler] - Opt-in profiler.
     */
    constructor({ configuration, context = defaultTestContext, excludeTags, includeTags, testFiles, lineFilters, examplePatterns, profiler, ...restArgs }) {
        restArgsError(restArgs);
        if (!configuration)
            throw new Error("configuration is required");
        this._configuration = configuration;
        this._context = context;
        this._sharedTransactionCoordinatorOwnerStorage = new AsyncLocalStorage();
        this._testDatabaseAccessScopeStorage = new AsyncLocalStorage();
        this._excludeTags = this.normalizeTags(excludeTags);
        this._includeTags = this.normalizeTags(includeTags);
        this._testFiles = testFiles;
        this._lineFilters = lineFilters || {};
        this._examplePatterns = examplePatterns || [];
        this._profiler = profiler;
        this._abortRemainingTests = false;
        this._failedTests = 0;
        this._successfulTests = 0;
        this._testsCount = 0;
        this._failedTestDetails = [];
        /** @type {{fullDescription: string, filePath: string, line: number} | null} */
        this._lastTestContext = null;
        /** @type {Array<{fullDescription: string, filePath: string, line: number, durationMs: number}>} */
        this._testDurations = [];
        /** @type {WeakMap<PackageTestDeclaration, {testArgs: TestArgs, testData: TestData}>} */
        this._testCompatibility = new WeakMap();
        /** @type {WeakSet<PackageTestDeclaration>} */
        this._injectedTests = new WeakSet();
        /** @type {WeakSet<PackageTestDeclaration>} */
        this._completedTests = new WeakSet();
        /** @type {WeakMap<PackageTestDeclaration, {descriptions: string[], testDescription: string, fullDescription: string, ownerFilePath: string | undefined, suites: PackageSuiteDeclaration[]}>} */
        this._testMetadata = new WeakMap();
        /** @type {WeakMap<PackageHookDeclaration, {declarationIndex: number, declarationScopeId: string | undefined, ownerFilePath: string | undefined}>} */
        this._hookMetadata = new WeakMap();
        /** @type {WeakMap<PackageTestDeclaration, Map<number, {abortRemainingTests: boolean, error: ReturnType<typeof JSON.parse>, failed: boolean}>>} */
        this._attemptOutcomes = new WeakMap();
        /** @type {Array<{suite: PackageSuiteDeclaration, phase: "beforeAll" | "afterAll", error: ReturnType<typeof JSON.parse>}>} */
        this._suiteHookFailures = [];
        /** @type {Map<string, PackageTestDeclaration[]>} */
        this._testsByFullName = new Map();
        /** @type {WeakMap<PackageRegistration, string>} */
        this._declarationOwners = new WeakMap();
        /** @type {PackageTestRunner | undefined} */
        this._packageRunner = undefined;
        /** @type {import("@velocious/testing/runner").TestRunResult | undefined} */
        this._packageResult = undefined;
        /** @type {Map<string, TestData> | undefined} */
        this._legacyFixtureDataByFullName = undefined;
        /** @type {{filePath?: string, line?: number}} */
        this._legacyFixtureLocation = {};
        this._attemptExecutor = new VelociousAttemptExecutor({ testRunner: this });
        this._runnerReporter = new VelociousRunnerReporter({ testRunner: this });
        this._suiteHookExecutor = new VelociousSuiteHookExecutor({ testRunner: this });
        this._testArguments = new VelociousTestArguments({ testRunner: this });
    }
    /**
     * Gets the package declaration context.
     * @returns {PackageTestContext} - Package declaration context.
     */
    getTestContext() { return this._context; }
    /**
     * Runs get configuration.
     * @returns {import("../configuration.js").default} - The configuration.
     */
    getConfiguration() { return this._configuration; }
    /**
     * Runs get test files.
     * @returns {string[]} - The test files.
     */
    getTestFiles() { return this._testFiles; }
    /**
     * Runs get line filters.
     * @returns {Record<string, number[]>} - Line filters.
     */
    getLineFilters() { return this._lineFilters; }
    /**
     * Runs get example patterns.
     * @returns {RegExp[]} - Example patterns.
     */
    getExamplePatterns() { return this._examplePatterns; }
    /**
     * Runs a profiler span only when profiling was explicitly enabled.
     * @template T
     * @param {object} metadata - Span metadata.
     * @param {string} metadata.phase - Phase name.
     * @param {number} [metadata.declarationIndex] - Hook declaration index.
     * @param {string} [metadata.declarationScopeId] - Hook declaration scope.
     * @param {string} [metadata.filePath] - Source ownership.
     * @param {() => (T | Promise<T>)} callback - Timed callback.
     * @returns {Promise<T>} - Callback result.
     */
    async runProfileSpan(metadata, callback) {
        if (!this._profiler)
            return await callback();
        return await this._profiler.runSpan(metadata, callback);
    }
    /**
     * Runs normalize tags.
     * @param {string[] | string | undefined} tags - Tags.
     * @returns {string[]} - Normalized tags.
     */
    normalizeTags(tags) {
        if (!tags)
            return [];
        const values = [];
        const rawTags = Array.isArray(tags) ? tags : [tags];
        for (const rawTag of rawTags) {
            if (rawTag === undefined || rawTag === null)
                continue;
            const parts = String(rawTag).split(",");
            for (const part of parts) {
                const trimmed = part.trim();
                if (trimmed)
                    values.push(trimmed);
            }
        }
        return Array.from(new Set(values));
    }
    /**
     * Runs has tag.
     * @param {TestArgs} testArgs - Test args.
     * @param {string} tag - Tag to check for.
     * @returns {boolean} - Whether tag is present.
     */
    hasTag(testArgs, tag) {
        return this.normalizeTags(testArgs?.tags).includes(tag);
    }
    /**
     * Runs is browser test mode.
     * @returns {boolean} - Whether running browser tests.
     */
    isBrowserTestMode() {
        return process.env.VELOCIOUS_BROWSER_TESTS === "true";
    }
    /**
     * Runs run with dummy if needed.
     * @param {TestArgs} testArgs - Test args.
     * @param {() => Promise<void>} callback - Callback to run.
     * @param {BrowserDummyConnectionRegistration[]} [browserDummyConnectionRegistrations] - Attempt-owned browser connections.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async runWithDummyIfNeeded(testArgs, callback, browserDummyConnectionRegistrations = []) {
        if (!this.hasTag(testArgs, "dummy")) {
            await callback();
            return;
        }
        if (this.isBrowserTestMode()) {
            await this.runBrowserDummy(testArgs, callback, browserDummyConnectionRegistrations);
            return;
        }
        await this.runNodeDummy(callback);
    }
    /**
     * Runs run node dummy.
     * @param {() => Promise<void>} callback - Callback to run.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async runNodeDummy(callback) {
        const dummyPath = process.env.VELOCIOUS_DUMMY_PATH || this.defaultDummyPath();
        const dummyImport = await import(pathToFileURL(dummyPath).href);
        const Dummy = dummyImport.default;
        if (!Dummy?.run) {
            throw new Error(`Dummy helper not found at ${dummyPath}`);
        }
        // Persistent server resources must not inherit an attempt scope that will be revoked.
        await this.getConfiguration().getEnvironmentHandler().runWithCapturedTestDatabaseAccessScope(undefined, async () => {
            await Dummy.run(async () => { });
        });
        this.getConfiguration().assertDatabaseAccessAllowed();
        await callback();
    }
    /**
     * Runs default dummy path.
     * @returns {string} - Default dummy helper path.
     */
    defaultDummyPath() {
        const cwd = path.resolve(process.cwd());
        const normalized = cwd.split(path.sep).join("/");
        if (normalized.endsWith("/spec/dummy")) {
            return path.join(cwd, "index.js");
        }
        return path.join(cwd, "spec/dummy/index.js");
    }
    /**
     * Runs run browser dummy.
     * @param {TestArgs} testArgs - Test args.
     * @param {() => Promise<void>} callback - Callback to run.
     * @param {BrowserDummyConnectionRegistration[]} connectionRegistrations - Attempt-owned browser connections.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async runBrowserDummy(testArgs, callback, connectionRegistrations) {
        const useTransaction = testArgs.databaseCleaning?.transaction === true;
        const truncate = testArgs.databaseCleaning?.truncate;
        const shouldTruncate = truncate === undefined ? !useTransaction : truncate;
        if (!useTransaction && !shouldTruncate) {
            await callback();
            return;
        }
        await this.getConfiguration().ensureConnections({ name: "Test runner browser dummy" }, async (dbs) => {
            const newRegistrations = Object.entries(dbs).map(([databaseIdentifier, db]) => {
                /** @type {BrowserDummyConnectionRegistration} */
                const registration = {
                    databaseIdentifier,
                    db,
                    quarantined: false
                };
                connectionRegistrations.push(registration);
                return registration;
            });
            if (shouldTruncate) {
                this.getConfiguration().assertDatabaseAccessAllowed();
                await this.truncateDatabases(dbs);
            }
            /** @type {unknown[]} */
            const lifecycleErrors = [];
            try {
                if (useTransaction) {
                    const startPromises = newRegistrations.map((registration) => {
                        const startPromise = registration.db.startTransaction();
                        registration.startPromise = startPromise;
                        return startPromise;
                    });
                    const startResults = await Promise.allSettled(startPromises);
                    const startErrors = startResults
                        .filter((result) => result.status === "rejected")
                        .map((result) => result.reason);
                    if (startErrors.length == 1)
                        throw startErrors[0];
                    if (startErrors.length > 1) {
                        throw new AggregateError(startErrors, "Browser dummy transaction startup failed", { cause: startErrors[0] });
                    }
                }
                this.getConfiguration().assertDatabaseAccessAllowed();
                await callback();
            }
            catch (error) {
                lifecycleErrors.push(error);
            }
            try {
                await this.rollbackBrowserDummyTransactions(connectionRegistrations);
            }
            catch (error) {
                if (error instanceof AggregateError) {
                    lifecycleErrors.push(...error.errors);
                }
                else {
                    lifecycleErrors.push(error);
                }
            }
            try {
                if (shouldTruncate) {
                    this.getConfiguration().assertDatabaseAccessAllowed();
                    await this.truncateDatabases(dbs);
                }
            }
            catch (error) {
                lifecycleErrors.push(error);
            }
            if (lifecycleErrors.length == 1)
                throw lifecycleErrors[0];
            if (lifecycleErrors.length > 1) {
                throw new AggregateError(lifecycleErrors, "Browser dummy lifecycle and cleanup failed", { cause: lifecycleErrors[0] });
            }
        });
    }
    /**
     * Rolls back every attempt-owned browser transaction exactly once.
     * @param {BrowserDummyConnectionRegistration[]} registrations - Browser connections.
     * @returns {Promise<void>} - Resolves after all rollbacks settle.
     */
    async rollbackBrowserDummyTransactions(registrations) {
        const rollbackResults = await Promise.allSettled([...registrations].reverse().map((registration) => {
            const startPromise = registration.startPromise;
            if (!startPromise)
                return;
            registration.rollbackPromise ??= (async () => {
                if (registration.quarantined)
                    return;
                try {
                    await startPromise;
                }
                catch {
                    try {
                        await this.quarantineBrowserDummyConnection(registration);
                    }
                    catch (quarantineError) {
                        throw new Error(`Failed to quarantine browser dummy database after transaction startup failed: ${registration.databaseIdentifier}`, { cause: quarantineError });
                    }
                    return;
                }
                if (registration.quarantined)
                    return;
                try {
                    await registration.db.rollbackTransaction();
                }
                catch (rollbackError) {
                    try {
                        await this.quarantineBrowserDummyConnection(registration);
                    }
                    catch (quarantineError) {
                        throw new AggregateError([rollbackError, quarantineError], `Failed to roll back and quarantine browser dummy database: ${registration.databaseIdentifier}`, { cause: quarantineError });
                    }
                    throw rollbackError;
                }
            })();
            return registration.rollbackPromise;
        }));
        const errors = rollbackResults
            .filter((result) => result.status === "rejected")
            .map((result) => result.reason);
        if (errors.length == 1)
            throw errors[0];
        if (errors.length > 1)
            throw new AggregateError(errors, "Browser dummy transaction cleanup failed", { cause: errors[0] });
    }
    /**
     * Permanently removes one browser connection that cannot be shared safely.
     * @param {BrowserDummyConnectionRegistration} registration - Browser connection registration.
     * @returns {Promise<void>} - Resolves after the connection is discarded.
     */
    async quarantineBrowserDummyConnection(registration) {
        registration.quarantined = true;
        registration.quarantinePromise ??= this.discardBrowserDummyConnection(registration.databaseIdentifier, registration.db);
        await registration.quarantinePromise;
    }
    /**
     * Discards one browser dummy connection through its owning pool.
     * @param {string} databaseIdentifier - Configured database identifier.
     * @param {import("../database/drivers/base.js").default} db - Unsafe connection.
     * @returns {Promise<void>} - Resolves after discard.
     */
    async discardBrowserDummyConnection(databaseIdentifier, db) {
        await this.getConfiguration().getDatabasePool(databaseIdentifier).discard(db);
    }
    /**
     * Quarantines all browser connections concurrently.
     * @param {BrowserDummyConnectionRegistration[]} registrations - Browser connection registrations.
     * @returns {Promise<void>} - Resolves after every connection is discarded.
     */
    async quarantineBrowserDummyConnections(registrations) {
        const quarantineResults = await Promise.allSettled(registrations.map(async (registration) => {
            await this.quarantineBrowserDummyConnection(registration);
        }));
        const errors = quarantineResults
            .filter((result) => result.status === "rejected")
            .map((result) => result.reason);
        if (errors.length == 1)
            throw errors[0];
        if (errors.length > 1)
            throw new AggregateError(errors, "Browser dummy connection quarantine failed", { cause: errors[0] });
    }
    /**
     * Runs truncate databases.
     * @param {Record<string, import("../database/drivers/base.js").default>} dbs - Database connections.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async truncateDatabases(dbs) {
        for (const identifier of Object.keys(dbs)) {
            await dbs[identifier].truncateAllTables();
        }
    }
    /**
     * Runs get exclude tag set.
     * @returns {Set<string>} - Exclude tag set.
     */
    getExcludeTagSet() {
        /**
         * Config tags.
         * @type {string[]} */
        const configTags = Array.isArray(testConfig.excludeTags) ? testConfig.excludeTags : [];
        return new Set([...this._excludeTags, ...configTags]);
    }
    /**
     * Runs build full description.
     * @param {string[]} descriptions - Description stack.
     * @param {string} testDescription - Test description.
     * @returns {string} - Full description.
     */
    buildFullDescription(descriptions, testDescription) {
        const parts = descriptions.concat([testDescription]);
        return parts.join(" ").trim();
    }
    /**
     * Runs application.
     * @returns {Promise<Application>} - Resolves with the application.
     */
    async application() {
        if (!this._application) {
            this._application = new Application({
                configuration: this.getConfiguration(),
                // Run request handlers in the main thread (not worker threads) so they
                // resolve DB work to the per-test shared connection set by
                // {@link activateTestSharedConnections}. This lets request-type specs use
                // transaction-based cleaning (their writes land inside the test's
                // transaction and roll back) instead of truncating every table.
                httpServer: { inProcess: true, port: 31006 },
                type: "test-runner"
            });
            await this._application.initialize();
            await this._application.startHttpServer();
        }
        return this._application;
    }
    /**
     * Registers each non-tenant per-test connection as a dynamic candidate for in-process
     * request sharing. The pool evaluates transaction state when each request is dispatched,
     * so a transaction started or ended during a hook callback takes effect immediately.
     * Inactive and tenant-only connections remain independently pooled. Pair with
     * {@link clearTestSharedConnections} in a finally.
     * @returns {{pool: import("../database/pool/base.js").default, registration: import("../database/pool/base.js").TestSharedConnectionRegistration}[]} - Lifecycle-owned registrations.
     */
    activateTestSharedConnections() {
        const configuration = this.getConfiguration();
        const currentConnections = configuration.getCurrentConnections();
        /** @type {{pool: import("../database/pool/base.js").default, registration: import("../database/pool/base.js").TestSharedConnectionRegistration}[]} */
        const registrations = [];
        for (const identifier of Object.keys(currentConnections)) {
            const pool = configuration.getDatabasePool(identifier);
            // Tenant-scoped pools resolve a different connection per request tenant
            // (via runWithTenant), so forcing a single shared connection would break
            // per-request tenant resolution. Only share non-tenant pools; the tenant
            // pool keeps resolving its own connection per request.
            if (pool.getConfiguration().tenantOnly) {
                continue;
            }
            const connection = currentConnections[identifier];
            const registration = pool.setTestSharedConnectionProvider(() => {
                return connection.insideTransaction() ? connection : undefined;
            });
            if (registration)
                registrations.push({ pool, registration });
        }
        return registrations;
    }
    /**
     * Clears the in-process test shared connection on every configured pool. Idempotent and
     * safe to call when none was set.
     * @param {{pool: import("../database/pool/base.js").default, registration: import("../database/pool/base.js").TestSharedConnectionRegistration}[]} [registrations] - Lifecycle-owned registrations to clear conditionally.
     * @returns {void}
     */
    clearTestSharedConnections(registrations) {
        if (registrations) {
            for (const { pool, registration } of registrations) {
                pool.clearTestSharedConnection(registration);
            }
            return;
        }
        const configuration = this.getConfiguration();
        for (const identifier of configuration.getDatabaseIdentifiers()) {
            configuration.getDatabasePool(identifier).clearTestSharedConnection();
        }
    }
    /**
     * Checks out and registers one physical tenant transaction for the current attempt.
     * @param {{databaseIdentifier: string, tenant: object}} args - Logical identifier and tenant descriptor.
     * @param {TransactionalTenantRegistration[]} registrations - Current attempt registrations.
     * @returns {Promise<void>}
     */
    async registerTransactionalTenant({ databaseIdentifier, tenant, ...restArgs }, registrations) {
        restArgsError(restArgs);
        if (!databaseIdentifier)
            throw new Error("registerTransactionalTenant requires a databaseIdentifier");
        if (!tenant)
            throw new Error("registerTransactionalTenant requires a tenant");
        const configuration = this.getConfiguration();
        const pool = configuration.getDatabasePool(databaseIdentifier);
        const databaseConfiguration = configuration.resolveDatabaseConfiguration(databaseIdentifier, tenant);
        if (!databaseConfiguration.tenantOnly) {
            throw new Error(`registerTransactionalTenant requires a tenantOnly database: ${databaseIdentifier}`);
        }
        const reuseKey = pool.getConfigurationReuseKey(databaseConfiguration);
        if (registrations.some((registration) => registration.pool === pool && registration.reuseKey === reuseKey))
            return;
        /** @type {TransactionalTenantRegistration} */
        const registration = {
            connection: undefined,
            pool,
            reuseKey,
            revoked: false,
            sharedRegistration: undefined
        };
        registrations.push(registration);
        registration.checkoutPromise = pool
            .checkoutForConfiguration(databaseConfiguration, { name: "Transactional tenant test registration" })
            .then((connection) => ({ connection, error: undefined }), (error) => ({
            connection: undefined,
            error: error instanceof Error ? error : new Error("Transactional tenant connection checkout failed", { cause: error })
        }));
        try {
            const checkoutOutcome = await registration.checkoutPromise;
            if (checkoutOutcome.error)
                throw checkoutOutcome.error;
            if (!checkoutOutcome.connection)
                throw new Error("Transactional tenant connection checkout returned no connection");
            registration.connection = checkoutOutcome.connection;
            if (registration.revoked)
                throw new Error("Transactional tenant test registration attempt is no longer active");
            await registration.connection.startTransaction();
            if (registration.revoked)
                throw new Error("Transactional tenant test registration attempt is no longer active");
            const sharedRegistration = pool.setTestSharedConnectionForConfiguration(registration.connection, reuseKey);
            if (!sharedRegistration)
                throw new Error(`Database pool does not support transactional tenant test connections: ${databaseIdentifier}`);
            registration.sharedRegistration = sharedRegistration;
            if (registration.revoked) {
                pool.clearTestSharedConnection(sharedRegistration);
                throw new Error("Transactional tenant test registration attempt is no longer active");
            }
        }
        catch (error) {
            registration.revoked = true;
            try {
                await this.cleanupTransactionalTenants([registration], { discard: registration.discardOnCleanup === true });
            }
            catch (cleanupError) {
                throw new AggregateError([error, cleanupError], "Failed to register and clean up a transactional tenant test connection", { cause: cleanupError });
            }
            throw error;
        }
    }
    /**
     * Revokes attempt registrations before rolling back and releasing their connections.
     * @param {TransactionalTenantRegistration[]} registrations - Attempt registrations.
     * @param {{discard?: boolean}} [options] - Whether connections must be discarded instead of returned to the pool.
     * @returns {Promise<void>}
     */
    async cleanupTransactionalTenants(registrations, { discard = false } = {}) {
        for (const registration of registrations) {
            registration.revoked = true;
            if (discard)
                registration.discardOnCleanup = true;
            if (registration.sharedRegistration)
                registration.pool.clearTestSharedConnection(registration.sharedRegistration);
        }
        const cleanupResults = await Promise.allSettled([...registrations].reverse().map((registration) => {
            registration.cleanupPromise ??= this.cleanupTransactionalTenantRegistration(registration);
            return registration.cleanupPromise;
        }));
        const errors = cleanupResults
            .filter((result) => result.status === "rejected")
            .map((result) => result.reason);
        if (errors.length === 1)
            throw errors[0];
        if (errors.length > 1)
            throw new AggregateError(errors, "Failed to clean up transactional tenant test connections");
    }
    /**
     * Cleans one attempt registration exactly once, including a checkout that was still pending at revocation.
     * @param {TransactionalTenantRegistration} registration - Attempt-owned registration.
     * @returns {Promise<void>} - Resolves after rollback and release or quarantine.
     */
    async cleanupTransactionalTenantRegistration(registration) {
        let connection = registration.connection;
        if (!connection && registration.checkoutPromise) {
            const checkoutOutcome = await registration.checkoutPromise;
            if (checkoutOutcome.error)
                return;
            connection = checkoutOutcome.connection;
            registration.connection = connection;
        }
        if (!connection)
            return;
        const errors = [];
        try {
            if (connection.insideTransaction())
                await connection.rollbackTransaction();
        }
        catch (error) {
            errors.push(error);
        }
        finally {
            try {
                if (registration.discardOnCleanup) {
                    await registration.pool.discard(connection);
                }
                else {
                    await registration.pool.checkin(connection);
                }
            }
            catch (error) {
                errors.push(error);
            }
        }
        if (errors.length === 1)
            throw errors[0];
        if (errors.length > 1)
            throw new AggregateError(errors, "Failed to clean up a transactional tenant test connection");
    }
    /**
     * Selects the current non-tenant connections eligible for shared transaction work.
     * @param {{transactionsOnly: boolean}} args - Selection options.
     * @returns {Record<string, import("../database/drivers/base.js").default>} - Eligible connections by identifier.
     */
    sharedTransactionConnections({ transactionsOnly }) {
        const configuration = this.getConfiguration();
        const currentConnections = configuration.getCurrentConnections();
        /** @type {Record<string, import("../database/drivers/base.js").default>} */
        const connections = {};
        for (const [identifier, connection] of Object.entries(currentConnections)) {
            const pool = configuration.getDatabasePool(identifier);
            if (pool.getConfiguration().tenantOnly)
                continue;
            if (transactionsOnly && !connection.insideTransaction())
                continue;
            connections[identifier] = connection;
        }
        return connections;
    }
    /**
     * Installs physical-connection coordination before a transaction-opening hook
     * can expose the shared connection to a long-lived in-process service.
     * Child-process coordinates remain unpublished until the transaction exists.
     * @returns {Promise<SharedTransactionBrokerRegistration | undefined>} - Prepared coordinator.
     */
    async prepareSharedTransactionBroker() {
        const connections = this.sharedTransactionConnections({ transactionsOnly: false });
        if (Object.keys(connections).length === 0)
            return undefined;
        return {
            broker: await SharedTransactionBroker.start({ connections }),
            environmentPublished: false,
            previousEnvironment: undefined
        };
    }
    /**
     * Checks whether a prepared broker coordinates exactly the selected physical connections.
     * @param {SharedTransactionBrokerRegistration | undefined} registration - Prepared coordinator.
     * @param {Record<string, import("../database/drivers/base.js").default>} connections - Selected connections.
     * @returns {boolean} - Whether the identifier set and physical connections match exactly.
     */
    sharedTransactionBrokerMatchesConnections(registration, connections) {
        const identifiers = Object.keys(connections);
        if (!registration || identifiers.length === 0)
            return false;
        if (Object.keys(registration.broker.connections).length !== identifiers.length)
            return false;
        for (const [identifier, connection] of Object.entries(connections)) {
            if (registration.broker.connections[identifier] !== connection)
                return false;
        }
        return true;
    }
    /**
     * Starts a capability-scoped broker for the active non-tenant physical
     * transaction connections. No broker/env is installed for truncation-only or
     * other transaction-disabled attempts.
     * @param {SharedTransactionBrokerRegistration} [preparedRegistration] - Coordinator prepared before hooks.
     * @param {Record<string, import("../database/drivers/base.js").default>} [selectedConnections] - Post-hook active connections.
     * @returns {Promise<SharedTransactionBrokerRegistration | undefined>} - Attempt registration.
     */
    async startSharedTransactionBroker(preparedRegistration, selectedConnections) {
        const connections = selectedConnections || this.sharedTransactionConnections({ transactionsOnly: true });
        const databaseIdentifiers = Object.keys(connections);
        if (databaseIdentifiers.length === 0) {
            await this.stopSharedTransactionBroker(preparedRegistration);
            return undefined;
        }
        let broker;
        if (preparedRegistration && this.sharedTransactionBrokerMatchesConnections(preparedRegistration, connections)) {
            broker = preparedRegistration.broker;
        }
        else {
            await this.stopSharedTransactionBroker(preparedRegistration);
            broker = await SharedTransactionBroker.start({ connections });
        }
        const previousEnvironment = process.env[SHARED_TRANSACTION_BROKER_ENV];
        process.env[SHARED_TRANSACTION_BROKER_ENV] = Buffer.from(JSON.stringify({
            address: broker.address(),
            capability: broker.capability(),
            databaseIdentifiers,
            expected: true
        })).toString("base64url");
        return { broker, environmentPublished: true, previousEnvironment };
    }
    /**
     * Revokes an attempt broker before database rollback hooks run and restores
     * the caller's environment so later pooled/spawned children cannot inherit it.
     * @param {SharedTransactionBrokerRegistration | undefined} registration - Attempt registration.
     */
    async stopSharedTransactionBroker(registration) {
        if (!registration)
            return;
        if (registration.environmentPublished) {
            if (registration.previousEnvironment === undefined) {
                delete process.env[SHARED_TRANSACTION_BROKER_ENV];
            }
            else {
                process.env[SHARED_TRANSACTION_BROKER_ENV] = registration.previousEnvironment;
            }
        }
        await registration.broker.close();
    }
    /**
     * Runs request client.
     * @returns {Promise<RequestClient>} - Resolves with the request client.
     */
    async requestClient() {
        if (!this._requestClient) {
            this._requestClient = new RequestClient();
        }
        return this._requestClient;
    }
    /**
     * Runs import test files.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async importTestFiles() {
        const environmentHandler = this.getConfiguration().getEnvironmentHandler();
        if (!this._profiler) {
            await environmentHandler.importTestFiles(this.getTestFiles());
            return;
        }
        for (const testFile of this.getTestFiles()) {
            const existingRegistrations = this.testRegistrationObjects();
            await this._profiler.measurePhase("imports", async () => {
                await environmentHandler.importTestFiles([testFile]);
            }, { filePath: testFile });
            this.assignTestRegistrationOwnership(existingRegistrations, testFile);
        }
    }
    /**
     * Collects package declaration objects by identity.
     * @param {Set<PackageRegistration>} [registrations] - Accumulated identities.
     * @returns {Set<PackageRegistration>} - Registration identities.
     */
    testRegistrationObjects(registrations = new Set()) {
        const visit = (/** @type {PackageSuiteDeclaration} */ suite) => {
            registrations.add(suite);
            for (const hook of [...suite.hooks.beforeAll, ...suite.hooks.beforeEach, ...suite.hooks.afterEach, ...suite.hooks.afterAll]) {
                registrations.add(hook);
            }
            for (const testDeclaration of suite.tests)
                registrations.add(testDeclaration);
            for (const childSuite of suite.suites)
                visit(childSuite);
        };
        for (const suite of this.getTestContext().registry.suites)
            visit(suite);
        return registrations;
    }
    /**
     * Assigns deterministic ownership to package declarations added by one entry file.
     * @param {Set<PackageRegistration>} previousRegistrations - Identities present before import.
     * @param {string} ownerFilePath - Importing entry file.
     * @returns {void}
     */
    assignTestRegistrationOwnership(previousRegistrations, ownerFilePath) {
        for (const registration of this.testRegistrationObjects()) {
            if (!previousRegistrations.has(registration))
                this._declarationOwners.set(registration, ownerFilePath);
        }
    }
    /**
     * Runs is failed.
     * @returns {boolean} - Whether failed.
     */
    isFailed() { return this._failedTests !== undefined && (this._failedTests > 0 || this._packageResult?.status === "failed"); }
    /**
     * Runs get failed tests.
     * @returns {number} - The failed tests.
     */
    getFailedTests() {
        if (this._failedTests === undefined)
            throw new Error("Tests hasn't been run yet");
        return this._failedTests;
    }
    /**
     * Runs get failed test details.
     * @returns {FailedTestDetail[]} - Failed test details.
     */
    getFailedTestDetails() {
        return this._failedTestDetails;
    }
    /**
     * Runs persist failed test console outputs to assets.
     * @param {object} [args] - Options object.
     * @param {string} [args.assetsPath] - Assets directory path.
     * @returns {Promise<string[]>} - Written log file paths.
     */
    async persistFailedTestConsoleOutputsToAssets({ assetsPath = path.join(process.cwd(), "tmp/screenshots") } = {}) {
        const failedTestDetails = this.getFailedTestDetails();
        const writtenLogPaths = [];
        let createdDirectory = false;
        for (let index = 0; index < failedTestDetails.length; index++) {
            const failedTestDetail = failedTestDetails[index];
            const consoleOutput = failedTestDetail.consoleOutput;
            if (!consoleOutput)
                continue;
            if (!createdDirectory) {
                await fs.mkdir(assetsPath, { recursive: true });
                createdDirectory = true;
            }
            const now = new Date();
            const timestamp = [
                String(now.getFullYear()),
                String(now.getMonth() + 1).padStart(2, "0"),
                String(now.getDate()).padStart(2, "0"),
                String(now.getHours()).padStart(2, "0"),
                String(now.getMinutes()).padStart(2, "0"),
                String(now.getSeconds()).padStart(2, "0"),
                String(now.getMilliseconds()).padStart(3, "0")
            ].join("");
            const slug = toFileSlug(failedTestDetail.fullDescription);
            const fileName = `${timestamp}-${String(index + 1).padStart(2, "0")}-${slug}.console.log`;
            const filePath = path.join(assetsPath, fileName);
            await fs.writeFile(filePath, consoleOutput, "utf8");
            failedTestDetail.consoleLogPath = filePath;
            writtenLogPaths.push(filePath);
        }
        return writtenLogPaths;
    }
    /**
     * Runs get successful tests.
     * @returns {number} - The successful tests.
     */
    getSuccessfulTests() {
        if (this._successfulTests === undefined)
            throw new Error("Tests hasn't been run yet");
        return this._successfulTests;
    }
    /**
     * Runs get tests count.
     * @returns {number} - The tests count.
     */
    getTestsCount() {
        if (this._testsCount === undefined)
            throw new Error("Tests hasn't been run yet");
        return this._testsCount;
    }
    /**
     * Runs get executed tests count.
     * @returns {number} - The executed tests count.
     */
    getExecutedTestsCount() {
        return this._packageResult?.tests.length ?? this._testDurations.length;
    }
    /**
     * Returns the tests recorded during the run, slowest first.
     * @param {number} [limit] - Maximum number of tests to return (0 returns all).
     * @returns {Array<{fullDescription: string, filePath: string, line: number, durationMs: number}>} - Slowest tests, slowest first.
     */
    getSlowestTests(limit = 10) {
        const sorted = [...this._testDurations].sort((testA, testB) => testB.durationMs - testA.durationMs);
        return limit > 0 ? sorted.slice(0, limit) : sorted;
    }
    /**
     * Runs prepare.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async prepare() {
        this.anyTestsFocussed = false;
        this._failedTests = 0;
        this._successfulTests = 0;
        this._testsCount = 0;
        this._abortRemainingTests = false;
        this._failedTestDetails = [];
        this._testDurations = [];
        this._testCompatibility = new WeakMap();
        this._injectedTests = new WeakSet();
        this._completedTests = new WeakSet();
        this._testMetadata = new WeakMap();
        this._hookMetadata = new WeakMap();
        this._attemptOutcomes = new WeakMap();
        this._suiteHookFailures = [];
        this._testsByFullName = new Map();
        this._packageResult = undefined;
        const context = this.getTestContext();
        /** @type {string | undefined} */
        let ownerFilePath;
        context.reset({ config: true });
        context.setDeclarationLocator(() => this.captureTestDeclarationLocation(ownerFilePath));
        const testingConfigPath = this.getConfiguration().getTesting();
        await context.describe("", { databaseCleaning: { transaction: true } }, async () => {
            if (testingConfigPath) {
                await this.runProfileSpan({ phase: "testing config/global setup" }, async () => {
                    await this.getConfiguration().getEnvironmentHandler().importTestingConfigPath();
                });
            }
            if (!this._profiler) {
                await this.importTestFiles();
            }
            else {
                for (const testFile of this.getTestFiles()) {
                    ownerFilePath = testFile;
                    const existingRegistrations = this.testRegistrationObjects();
                    await this._profiler.measurePhase("imports", async () => {
                        await this.getConfiguration().getEnvironmentHandler().importTestFiles([testFile]);
                    }, { filePath: testFile });
                    this.assignTestRegistrationOwnership(existingRegistrations, testFile);
                }
            }
        });
        ownerFilePath = undefined;
        this.analyzeDeclarations();
    }
    /**
     * Captures a test source location without attributing package/facade frames.
     * @param {string | undefined} ownerFilePath - Importing entry file fallback.
     * @returns {{filePath?: string, line?: number}} - Declaration location.
     */
    captureTestDeclarationLocation(ownerFilePath) {
        const stack = new Error().stack?.split("\n") || [];
        for (const stackLine of stack) {
            const match = stackLine.match(/(?:\(|\s)(file:\/\/.*?|\/[^"]*?):(\d+):(\d+)\)?$/u);
            if (!match)
                continue;
            let filePath = match[1];
            if (filePath.startsWith("file://")) {
                try {
                    filePath = fileURLToPath(filePath);
                }
                catch {
                    continue;
                }
            }
            const resolvedFilePath = path.resolve(filePath);
            const portablePath = resolvedFilePath.replaceAll(path.sep, "/");
            if (portablePath.endsWith("/src/testing/test-runner.js"))
                continue;
            if (portablePath.endsWith("/src/testing/test.js"))
                continue;
            if (portablePath.includes("/node_modules/@velocious/testing/"))
                continue;
            return { filePath: resolvedFilePath, line: Number(match[2]) };
        }
        return ownerFilePath ? { filePath: ownerFilePath } : {};
    }
    /**
     * Runs are any tests focussed.
     * @returns {boolean} - Whether any tests focussed.
     */
    areAnyTestsFocussed() {
        if (this.anyTestsFocussed === undefined) {
            throw new Error("Hasn't been detected yet");
        }
        return this.anyTestsFocussed;
    }
    /**
     * Runs run.
     * @returns {Promise<void>} - Resolves when complete.
     */
    /**
     * Records an asynchronous crash (an unhandled promise rejection detached from
     * any await, e.g. a `void connection.afterCommit(async () => broadcast(...))`
     * frontend-model publish — or a synchronous throw inside a detached callback
     * such as a driver socket or timer callback) as a real, visible, attributed
     * test failure.
     *
     * Without this, such a rejection/exception has no handler, so on modern Node
     * the process is TERMINATED — the run ends with no reported failures and CI
     * just sees a crashed/retried shard with an empty result (the recurring
     * "silent test-runner death": invisible and impossible to diagnose). Turning
     * it into a failure makes the run go red with something debuggable instead of
     * vanishing.
     * @param {"uncaughtException" | "unhandledRejection"} kind - Async-crash kind.
     * @param {unknown} reason - Rejection reason or thrown error.
     * @returns {void}
     */
    recordAsyncCrash(kind, reason) {
        const error = reason instanceof Error ? reason : new Error(`${kind}: ${String(reason)}`);
        const near = this._lastTestContext;
        const attribution = near ? `, near test: ${near.fullDescription} (${near.filePath}:${near.line})` : "";
        this._failedTests = (this._failedTests || 0) + 1;
        this._failedTestDetails.push({
            fullDescription: `<${kind} during test run${attribution}>`,
            filePath: near ? near.filePath : "<test runner>",
            line: near ? near.line : 0,
            error,
            consoleOutput: undefined
        });
        console.error(picocolors.red(`\n[test-runner] ${kind} during the test run — this would otherwise terminate the process silently and surface only as a crashed/retried shard with zero reported failures.${attribution}`));
        console.error(error);
    }
    /**
     * Records a cleanup failure after timeout handling has begun.
     * @param {unknown} reason - Detached cleanup rejection.
     * @param {string} cleanupName - Cleanup operation name.
     * @param {Set<Error>} [recordedErrors] - Attempt-owned cleanup errors already reported.
     * @returns {void}
     */
    recordTimeoutCleanupFailure(reason, cleanupName, recordedErrors) {
        const error = reason instanceof Error ? reason : new Error(`${cleanupName} cleanup failed: ${String(reason)}`);
        if (recordedErrors) {
            // Multiple bounded observers can receive the same detached cleanup rejection.
            if (recordedErrors.has(error))
                return;
            recordedErrors.add(error);
        }
        const near = this._lastTestContext;
        const attribution = near ? `, near test: ${near.fullDescription} (${near.filePath}:${near.line})` : "";
        this._failedTests = (this._failedTests || 0) + 1;
        this._failedTestDetails.push({
            fullDescription: `<${cleanupName} emergency cleanup failure${attribution}>`,
            filePath: near ? near.filePath : "<test runner>",
            line: near ? near.line : 0,
            error,
            consoleOutput: undefined
        });
        console.error(picocolors.red(`\n[test-runner] ${cleanupName} cleanup failed after timeout handling began.${attribution}`));
        console.error(error);
    }
    async run() {
        /**
         * Handles a process-level unhandled rejection during the run.
         * @param {unknown} reason - Rejection reason.
         * @returns {void}
         */
        const onUnhandledRejection = (reason) => {
            // If a test attached its OWN unhandledRejection listener, it is
            // intentionally observing/triggering the rejection (e.g. beacon
            // error-reporting-spec.js) — Node dispatches to EVERY listener, so also
            // failing the suite here would break those tests. Defer to the test's
            // handler; only treat a rejection as a silent-death crash when ours is the
            // sole listener (no persistent framework listener exists to mask this).
            if (process.listenerCount("unhandledRejection") > 1)
                return;
            this.recordAsyncCrash("unhandledRejection", reason);
        };
        /**
         * Handles a process-level uncaught exception during the run — a
         * synchronous throw inside a detached callback (driver socket, timer,
         * event emitter) that no test await observes. Same silent-death mode as
         * unhandled rejections: without a handler the process dies mid-run and CI
         * sees a crashed shard with zero reported failures.
         * @param {unknown} error - Thrown error.
         * @returns {void}
         */
        const onUncaughtException = (error) => {
            // Mirror the unhandledRejection deferral: a test observing/triggering
            // uncaught exceptions with its own listener owns them.
            if (process.listenerCount("uncaughtException") > 1)
                return;
            this.recordAsyncCrash("uncaughtException", error);
        };
        process.on("unhandledRejection", onUnhandledRejection);
        process.on("uncaughtException", onUncaughtException);
        try {
            await this.runPackageTests();
            // A rejection scheduled by the final test (a detached rejected promise,
            // or an afterCommit callback rejecting as the suite drains) is reported
            // by Node on a LATER turn. Drain a few turns while the handler is still
            // attached so those late rejections are recorded instead of escaping to
            // the default crash path after cleanup.
            for (let drainTurn = 0; drainTurn < 3; drainTurn++) {
                await new Promise((resolve) => setImmediate(resolve));
            }
        }
        finally {
            process.off("unhandledRejection", onUnhandledRejection);
            process.off("uncaughtException", onUncaughtException);
        }
    }
    /**
     * Runs run after alls for active scopes.
     * @returns {Promise<void>} - Resolves when cleanup hooks finish.
     */
    async runAfterAllsForActiveScopes() {
        const failureStart = this._suiteHookFailures.length;
        await this._packageRunner?.cleanupActiveSuites();
        this.throwAfterAllFailures(this._suiteHookFailures.slice(failureStart));
    }
    /** Builds declaration metadata used only by framework adapters and projections. */
    analyzeDeclarations() {
        const visit = (/** @type {PackageSuiteDeclaration} */ suite, /** @type {PackageSuiteDeclaration[]} */ ancestors, /** @type {string | undefined} */ parentProfileScopeId) => {
            const suites = [...ancestors, suite];
            const descriptions = suites.map((entry) => entry.name).filter((name) => name !== "");
            const ownerFilePath = this._declarationOwners.get(suite) ?? suite.location.filePath;
            const profileScopeId = this._profiler?.scopeId(suite, {
                descriptions,
                filePath: ownerFilePath,
                line: suite.location.line,
                parentId: parentProfileScopeId
            });
            for (const hooks of Object.values(suite.hooks)) {
                hooks.forEach((hook, declarationIndex) => {
                    this._hookMetadata.set(hook, {
                        declarationIndex,
                        declarationScopeId: profileScopeId,
                        ownerFilePath: this._declarationOwners.get(hook) ?? hook.location.filePath ?? ownerFilePath
                    });
                });
            }
            for (const testDeclaration of suite.tests) {
                const fullDescription = this.buildFullDescription(descriptions, testDeclaration.name);
                const declarations = this._testsByFullName.get(fullDescription) || [];
                declarations.push(testDeclaration);
                this._testsByFullName.set(fullDescription, declarations);
                this._testMetadata.set(testDeclaration, {
                    descriptions,
                    testDescription: testDeclaration.name,
                    fullDescription,
                    ownerFilePath: this._declarationOwners.get(testDeclaration) ?? testDeclaration.location.filePath ?? ownerFilePath,
                    suites
                });
                const legacyTestData = this._legacyFixtureDataByFullName?.get(fullDescription);
                if (legacyTestData) {
                    this._testCompatibility.set(testDeclaration, {
                        testArgs: this._testArguments.copy(testDeclaration),
                        testData: legacyTestData
                    });
                }
                this._testsCount++;
                if (testDeclaration.state === "run" && (testDeclaration.focus || suites.some((entry) => entry.focus))) {
                    this.anyTestsFocussed = true;
                }
            }
            for (const childSuite of suite.suites)
                visit(childSuite, suites, profileScopeId);
        };
        for (const suite of this.getTestContext().registry.suites)
            visit(suite, [], undefined);
    }
    /**
     * Gets package hook compatibility metadata.
     * @param {PackageHookDeclaration} hook - Package hook declaration.
     * @returns {{declarationIndex: number, declarationScopeId: string | undefined, ownerFilePath: string | undefined}} - Hook metadata.
     */
    hookMetadata(hook) {
        return this._hookMetadata.get(hook) || { declarationIndex: 0, declarationScopeId: undefined, ownerFilePath: hook.location.filePath };
    }
    /**
     * Gets package test compatibility metadata.
     * @param {PackageTestDeclaration} test - Package test declaration.
     * @returns {{descriptions: string[], testDescription: string, fullDescription: string, ownerFilePath: string | undefined, suites: PackageSuiteDeclaration[]}} - Declaration metadata.
     */
    testMetadata(test) {
        const metadata = this._testMetadata.get(test);
        if (!metadata)
            throw new Error(`Missing package test metadata: ${test.name}`);
        return metadata;
    }
    /**
     * Gets stable compatibility data for a package declaration.
     * @param {PackageTestDeclaration} test - Package test declaration.
     * @returns {{testArgs: TestArgs, testData: TestData}} - Stable compatibility data.
     */
    testData(test) {
        let compatibility = this._testCompatibility.get(test);
        if (!compatibility) {
            const testArgs = this._testArguments.copy(test);
            const metadata = this.testMetadata(test);
            const testData = {
                args: testArgs,
                declaration: test,
                filePath: test.location.filePath,
                function: test.callback,
                line: test.location.line,
                ownerFilePath: metadata.ownerFilePath
            };
            compatibility = { testArgs, testData };
            this._testCompatibility.set(test, compatibility);
        }
        return compatibility;
    }
    /**
     * Injects framework collaborators into stable compatibility data once.
     * @param {PackageTestDeclaration} test - Package test declaration.
     * @returns {Promise<{testArgs: TestArgs, testData: TestData}>} - Injected compatibility data.
     */
    async testCompatibility(test) {
        const compatibility = this.testData(test);
        if (!this._injectedTests.has(test)) {
            await this._testArguments.inject(compatibility.testArgs);
            this._injectedTests.add(test);
        }
        return compatibility;
    }
    /**
     * Records a raw framework attempt outcome.
     * @param {PackageTestDeclaration} test - Package test declaration.
     * @param {number} attemptNumber - One-based attempt number.
     * @param {{abortRemainingTests: boolean, error: ReturnType<typeof JSON.parse>, failed: boolean}} outcome - Raw attempt outcome.
     * @returns {void}
     */
    recordAttemptOutcome(test, attemptNumber, outcome) {
        const outcomes = this._attemptOutcomes.get(test) || new Map();
        outcomes.set(attemptNumber, outcome);
        this._attemptOutcomes.set(test, outcomes);
        if (outcome.abortRemainingTests)
            this._abortRemainingTests = true;
    }
    /**
     * Gets a raw framework attempt outcome.
     * @param {PackageTestDeclaration} test - Package test declaration.
     * @param {number} attemptNumber - One-based attempt number.
     * @returns {{abortRemainingTests: boolean, error: ReturnType<typeof JSON.parse>, failed: boolean} | undefined} - Raw attempt outcome.
     */
    attemptOutcome(test, attemptNumber) { return this._attemptOutcomes.get(test)?.get(attemptNumber); }
    /**
     * Records a raw suite-hook failure.
     * @param {object} failure - Suite-hook failure.
     * @param {PackageSuiteDeclaration} failure.suite - Owning package suite.
     * @param {"beforeAll" | "afterAll"} failure.phase - Hook phase.
     * @param {ReturnType<typeof JSON.parse>} failure.error - Raw hook failure.
     * @returns {void}
     */
    recordSuiteHookFailure(failure) { this._suiteHookFailures.push(failure); }
    /**
     * Gets the raw ancestor setup failure for a package test.
     * @param {PackageTestDeclaration} test - Package test declaration.
     * @returns {ReturnType<typeof JSON.parse>} - Raw setup failure.
     */
    setupFailureFor(test) {
        const suites = this.testMetadata(test).suites;
        return this._suiteHookFailures.find((failure) => failure.phase === "beforeAll" && suites.includes(failure.suite))?.error;
    }
    /**
     * Finds the next incomplete declaration with a package full name.
     * @param {string} fullName - Package full name.
     * @returns {PackageTestDeclaration | undefined} - Next matching declaration.
     */
    findTestDeclaration(fullName) {
        return this._testsByFullName.get(fullName)?.find((test) => !this._completedTests.has(test));
    }
    /**
     * Marks a package declaration complete.
     * @param {PackageTestDeclaration} test - Completed declaration.
     * @returns {void}
     */
    completeTestDeclaration(test) { this._completedTests.add(test); }
    /**
     * Gets the effective package retry count.
     * @param {PackageTestDeclaration} test - Package test declaration.
     * @returns {number} - Effective retry count.
     */
    retryCount(test) {
        const value = test.options.retries ?? test.options.retry ?? this.getTestContext().config.retries;
        return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
    }
    /**
     * Normalizes retry inputs for the package execution boundary while retaining
     * the declarations' original public options after the run.
     * @returns {() => void} - Restores original declaration options.
     */
    normalizePackageRetriesForExecution() {
        /** @type {PackageRetryOptionRestoration[]} */
        const restorations = [];
        /**
         * Normalizes declarations in one suite.
         * @param {PackageSuiteDeclaration} suite - Suite whose tests are normalized.
         */
        const visit = (suite) => {
            for (const test of suite.tests) {
                // Capture compatibility arguments before temporarily adapting package
                // execution options so callbacks retain their declared values/identity.
                this.testData(test);
                restorations.push({
                    hadRetries: Object.hasOwn(test.options, "retries"),
                    options: test.options,
                    retries: test.options.retries
                });
                test.options.retries = this.retryCount(test);
            }
            for (const childSuite of suite.suites)
                visit(childSuite);
        };
        for (const suite of this.getTestContext().registry.suites)
            visit(suite);
        return () => {
            for (const restoration of restorations) {
                if (restoration.hadRetries)
                    restoration.options.retries = restoration.retries;
                else
                    delete restoration.options.retries;
            }
        };
    }
    /**
     * Records one completed test duration.
     * @param {{durationMs: number, filePath: string, fullDescription: string, line: number}} duration - Completed test duration.
     * @returns {void}
     */
    recordTestDuration(duration) { this._testDurations.push(duration); }
    /** Records one successful package result. */
    recordSuccessfulTest() { this._successfulTests++; }
    /**
     * Records one failed package test in the legacy result projection.
     * @param {object} args - Failed test metadata.
     * @param {string[]} args.descriptions - Parent descriptions.
     * @param {ReturnType<typeof JSON.parse>} args.error - Raw failure.
     * @param {string} args.consoleOutput - Captured console output.
     * @param {TestData} args.testData - Compatibility test data.
     * @param {string} args.testDescription - Test description.
     * @returns {void}
     */
    recordFailedTest({ descriptions, error, consoleOutput, testData, testDescription }) {
        this._failedTests++;
        this._failedTestDetails.push({
            fullDescription: this.buildFullDescription(descriptions, testDescription),
            filePath: testData.filePath,
            line: testData.line,
            error,
            consoleOutput: consoleOutput || undefined
        });
    }
    /**
     * Stores the completed package result.
     * @param {import("@velocious/testing/runner").TestRunResult} result - Package result.
     * @returns {void}
     */
    recordPackageResult(result) { this._packageResult = result; }
    /**
     * Runs the package kernel with Velocious framework adapters.
     * @returns {Promise<void>} - Resolves after execution and teardown.
     */
    async runPackageTests() {
        const environmentHandler = this.getConfiguration().getEnvironmentHandler();
        environmentHandler.installSharedTransactionCoordinatorOwnerStorage(this._sharedTransactionCoordinatorOwnerStorage);
        environmentHandler.installTestDatabaseAccessScopeStorage(this._testDatabaseAccessScopeStorage);
        this._packageRunner = new PackageTestRunner({
            context: this.getTestContext(),
            includeTags: this._includeTags,
            excludeTags: [...this.getExcludeTagSet(), ...(this.isBrowserTestMode() ? [] : ["browser-only"])],
            examples: this.getExamplePatterns(),
            lineFilters: this.getLineFilters(),
            includeTagMode: "any",
            focusedTestsBypassIncludeTags: true,
            omitEmptySuiteNames: true,
            attemptExecutorOwnsTimeout: true,
            attemptExecutor: (input) => this._attemptExecutor.execute(input),
            testArgumentResolver: (input) => this._testArguments.resolve(input),
            suiteHookExecutor: (input) => this._suiteHookExecutor.execute(input),
            reporter: this._runnerReporter
        });
        const failureStart = this._suiteHookFailures.length;
        const restoreRetryOptions = this.normalizePackageRetriesForExecution();
        let result;
        try {
            try {
                result = await this._packageRunner.run();
            }
            catch (error) {
                if (!(error instanceof AbortRemainingTestsError))
                    throw error;
                const afterAll = this.afterAllOutcome(this._suiteHookFailures.slice(failureStart));
                if (afterAll.failed)
                    this.recordTimeoutCleanupFailure(afterAll.error, "afterAll");
                return;
            }
            this.recordPackageResult(result);
            this.throwAfterAllFailures(this._suiteHookFailures.slice(failureStart));
        }
        finally {
            restoreRetryOptions();
        }
    }
    /**
     * Aggregates raw after-all failures without using error truthiness.
     * @param {Array<{phase: "beforeAll" | "afterAll", error: ReturnType<typeof JSON.parse>}>} failures - Hook failures.
     * @returns {{failed: false} | {failed: true, error: ReturnType<typeof JSON.parse>}} - Explicit afterAll outcome.
     */
    afterAllOutcome(failures) {
        const afterAllErrors = failures.filter((failure) => failure.phase === "afterAll").map((failure) => failure.error);
        if (afterAllErrors.length === 0)
            return { failed: false };
        if (afterAllErrors.length === 1)
            return { failed: true, error: afterAllErrors[0] };
        return {
            failed: true,
            error: new AggregateError(afterAllErrors, "Multiple active afterAll scopes failed", { cause: afterAllErrors[0] })
        };
    }
    /**
     * Throws one raw or aggregated after-all failure.
     * @param {Array<{phase: "beforeAll" | "afterAll", error: ReturnType<typeof JSON.parse>}>} failures - Hook failures.
     * @returns {void}
     */
    throwAfterAllFailures(failures) {
        const afterAll = this.afterAllOutcome(failures);
        if (afterAll.failed)
            throw afterAll.error;
    }
    /**
     * Compatibility helper for focused framework lifecycle specs. It converts an
     * explicit legacy fixture into isolated package declarations; the package
     * runner remains the sole execution engine.
     * @param {object} args - Legacy fixture arguments.
     * @param {TestsArgument} args.tests - Fixture tree.
     * @returns {Promise<void>} - Resolves after package execution.
     */
    async runTests({ tests }) {
        const context = createTestContext();
        const originalContext = this._context;
        context.configureTests({
            consoleOutput: originalContext.config.consoleOutput,
            defaultTimeoutMs: originalContext.config.defaultTimeoutMs,
            excludeTags: originalContext.config.excludeTags,
            failedConsoleOutputMaxLines: originalContext.config.failedConsoleOutputMaxLines,
            retries: originalContext.config.retries
        });
        this._context = context;
        this._testsCount = 0;
        this._testCompatibility = new WeakMap();
        this._injectedTests = new WeakSet();
        this._completedTests = new WeakSet();
        this._testMetadata = new WeakMap();
        this._hookMetadata = new WeakMap();
        this._attemptOutcomes = new WeakMap();
        this._suiteHookFailures = [];
        this._testsByFullName = new Map();
        this._legacyFixtureDataByFullName = new Map();
        context.setDeclarationLocator(() => this._legacyFixtureLocation);
        this.declareLegacyFixture(context, "", tests, []);
        this.analyzeDeclarations();
        try {
            await this.runPackageTests();
        }
        finally {
            this._context = originalContext;
        }
    }
    /**
     * Declares an isolated legacy-shaped test fixture into a package context.
     * @param {PackageTestContext} context - Isolated package context.
     * @param {string} name - Suite name.
     * @param {TestsArgument} scope - Legacy fixture scope.
     * @param {string[]} descriptions - Ancestor descriptions.
     * @returns {void}
     */
    declareLegacyFixture(context, name, scope, descriptions) {
        this._legacyFixtureLocation = { filePath: scope.filePath, line: scope.line };
        context.describe(name, scope.args || {}, () => {
            for (const hook of scope.beforeAlls || [])
                context.beforeAll(hook.callback);
            for (const hook of scope.beforeEaches || [])
                context.beforeEach(hook.callback);
            for (const hook of scope.afterEaches || [])
                context.afterEach(hook.callback);
            for (const hook of scope.afterAlls || [])
                context.afterAll(hook.callback);
            const nextDescriptions = name === "" ? descriptions : [...descriptions, name];
            for (const [testName, testData] of Object.entries(scope.tests || {})) {
                this._legacyFixtureLocation = { filePath: testData.filePath, line: testData.line };
                this._legacyFixtureDataByFullName?.set(this.buildFullDescription(nextDescriptions, testName), testData);
                context.it(testName, testData.args, testData.function);
            }
            for (const [suiteName, childScope] of Object.entries(scope.subs || {})) {
                this.declareLegacyFixture(context, suiteName, childScope, nextDescriptions);
            }
        });
    }
    /**
     * Runs emit event.
     * @param {string} eventName - Event name.
     * @param {object} payload - Event payload.
     * @returns {Promise<void>} - Resolves when all listeners complete.
     */
    async emitEvent(eventName, payload) {
        await this._runnerReporter.emitEvent(eventName, payload);
    }
    /**
     * Runs print rerun command.
     * @param {object} args - Options object.
     * @param {string[]} args.descriptions - Description stack.
     * @param {string} args.testDescription - Test description.
     * @param {TestData} args.testData - Test data.
     * @param {string} args.leftPadding - Left padding.
     * @returns {void} - No return value.
     */
    printRerunCommand({ descriptions, testDescription, testData, leftPadding }) {
        const rerun = this.buildRerunCommand({ descriptions, testDescription, testData });
        if (rerun) {
            console.error(`${leftPadding}  Re-run: ${rerun}`);
        }
    }
    /**
     * Runs build rerun command.
     * @param {object} args - Options object.
     * @param {string[]} args.descriptions - Description stack.
     * @param {string} args.testDescription - Test description.
     * @param {TestData} args.testData - Test data.
     * @returns {string | undefined} - Rerun command.
     */
    buildRerunCommand({ descriptions, testDescription, testData }) {
        const baseCommand = "npx velocious test";
        const filePath = testData.filePath;
        const line = testData.line;
        if (filePath && line) {
            const relativePath = path.relative(process.cwd(), filePath);
            return `${baseCommand} ${relativePath}:${line}`;
        }
        const fullDescription = this.buildFullDescription(descriptions, testDescription);
        if (fullDescription) {
            return `${baseCommand} --example ${JSON.stringify(fullDescription)}`;
        }
        return undefined;
    }
    /**
     * Runs build console output.
     * @param {AttemptConsoleOutput[]} attemptConsoleOutputs - Attempt output entries.
     * @returns {string} - Combined console output.
     */
    buildConsoleOutput(attemptConsoleOutputs) {
        if (attemptConsoleOutputs.length === 0)
            return "";
        if (attemptConsoleOutputs.length === 1)
            return attemptConsoleOutputs[0].output;
        return attemptConsoleOutputs.map((attemptConsoleOutput) => {
            return `--- Attempt ${attemptConsoleOutput.attemptNumber} ---\n${attemptConsoleOutput.output}`;
        }).join("\n");
    }
    /**
     * Runs get failed console output max lines.
     * @returns {number} - Maximum failed console lines.
     */
    getFailedConsoleOutputMaxLines() {
        const maxLines = testConfig.failedConsoleOutputMaxLines;
        if (typeof maxLines !== "number" || !Number.isFinite(maxLines))
            return 200;
        return Math.max(0, Math.floor(maxLines));
    }
    /**
     * Runs truncate failed console output lines.
     * @param {string} consoleOutput - Console output.
     * @returns {string[]} - Lines for inline output.
     */
    truncateFailedConsoleOutputLines(consoleOutput) {
        const lines = consoleOutput.split("\n");
        const maxLines = this.getFailedConsoleOutputMaxLines();
        if (maxLines === 0)
            return [];
        if (lines.length <= maxLines)
            return lines;
        const omittedLines = lines.length - maxLines;
        const plural = omittedLines === 1 ? "" : "s";
        return [
            `... ${omittedLines} console output line${plural} omitted ...`,
            ...lines.slice(-maxLines)
        ];
    }
    /**
     * Runs print failed console output.
     * @param {object} args - Options object.
     * @param {string} args.consoleOutput - Console output.
     * @param {string} args.leftPadding - Left padding.
     * @returns {void} - No return value.
     */
    printFailedConsoleOutput({ consoleOutput, leftPadding }) {
        if (testConfig.consoleOutput !== "failure")
            return;
        if (!consoleOutput)
            return;
        const lines = this.truncateFailedConsoleOutputLines(consoleOutput);
        if (lines.length === 0)
            return;
        console.error(picocolors.red(`${leftPadding}  Console output:`));
        for (const line of lines) {
            console.error(picocolors.red(`${leftPadding}    ${line}`));
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGVzdC1ydW5uZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvdGVzdGluZy90ZXN0LXJ1bm5lci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxFQUFFLE1BQU0sa0JBQWtCLENBQUE7QUFDakMsT0FBTyxJQUFJLE1BQU0sTUFBTSxDQUFBO0FBQ3ZCLE9BQU8sRUFBQyxpQkFBaUIsRUFBQyxNQUFNLGtCQUFrQixDQUFBO0FBQ2xELE9BQU8sRUFBQyxpQkFBaUIsRUFBRSxrQkFBa0IsRUFBQyxNQUFNLG9CQUFvQixDQUFBO0FBQ3hFLE9BQU8sRUFBQyxVQUFVLElBQUksaUJBQWlCLEVBQUMsTUFBTSwyQkFBMkIsQ0FBQTtBQUN6RSxPQUFPLFdBQVcsTUFBTSwwQkFBMEIsQ0FBQTtBQUNsRCxPQUFPLGFBQWEsTUFBTSxxQkFBcUIsQ0FBQTtBQUMvQyxPQUFPLFVBQVUsTUFBTSxZQUFZLENBQUE7QUFDbkMsT0FBTyxhQUFhLE1BQU0sNkJBQTZCLENBQUE7QUFDdkQsT0FBTyxFQUFDLFVBQVUsRUFBQyxNQUFNLFdBQVcsQ0FBQTtBQUNwQyxPQUFPLEVBQUMsYUFBYSxFQUFFLGFBQWEsRUFBQyxNQUFNLEtBQUssQ0FBQTtBQUNoRCxPQUFPLHVCQUF1QixNQUFNLGdDQUFnQyxDQUFBO0FBQ3BFLE9BQU8sRUFBRSw2QkFBNkIsRUFBRSxNQUFNLHNDQUFzQyxDQUFBO0FBQ3BGLE9BQU8sd0JBQXdCLE1BQU0saUNBQWlDLENBQUE7QUFDdEUsT0FBTyx1QkFBdUIsRUFBRSxFQUFDLHdCQUF3QixFQUFDLE1BQU0sZ0NBQWdDLENBQUE7QUFDaEcsT0FBTywwQkFBMEIsTUFBTSxvQ0FBb0MsQ0FBQTtBQUMzRSxPQUFPLHNCQUFzQixNQUFNLCtCQUErQixDQUFBO0FBRWxFLDhEQUE4RDtBQUM5RCw2RkFBNkY7QUFDN0YsaUZBQWlGO0FBQ2pGLDhGQUE4RjtBQUM5RiwrR0FBK0c7QUFDL0csOElBQThJO0FB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VyxPQUFPLElBQUksRUFBRSxDQUFDLENBQUMsQ0FBQTtRQUM1RCxDQUFDO0lBQ0gsQ0FBQztDQUVGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBmcyBmcm9tIFwibm9kZTpmcy9wcm9taXNlc1wiXG5pbXBvcnQgcGF0aCBmcm9tIFwicGF0aFwiXG5pbXBvcnQge0FzeW5jTG9jYWxTdG9yYWdlfSBmcm9tIFwibm9kZTphc3luY19ob29rc1wiXG5pbXBvcnQge2NyZWF0ZVRlc3RDb250ZXh0LCBkZWZhdWx0VGVzdENvbnRleHR9IGZyb20gXCJAdmVsb2Npb3VzL3Rlc3RpbmdcIlxuaW1wb3J0IHtUZXN0UnVubmVyIGFzIFBhY2thZ2VUZXN0UnVubmVyfSBmcm9tIFwiQHZlbG9jaW91cy90ZXN0aW5nL3J1bm5lclwiXG5pbXBvcnQgQXBwbGljYXRpb24gZnJvbSBcIi4uLy4uL3NyYy9hcHBsaWNhdGlvbi5qc1wiXG5pbXBvcnQgUmVxdWVzdENsaWVudCBmcm9tIFwiLi9yZXF1ZXN0LWNsaWVudC5qc1wiXG5pbXBvcnQgcGljb2NvbG9ycyBmcm9tIFwicGljb2NvbG9yc1wiXG5pbXBvcnQgcmVzdEFyZ3NFcnJvciBmcm9tIFwiLi4vdXRpbHMvcmVzdC1hcmdzLWVycm9yLmpzXCJcbmltcG9ydCB7dGVzdENvbmZpZ30gZnJvbSBcIi4vdGVzdC5qc1wiXG5pbXBvcnQge2ZpbGVVUkxUb1BhdGgsIHBhdGhUb0ZpbGVVUkx9IGZyb20gXCJ1cmxcIlxuaW1wb3J0IFNoYXJlZFRyYW5zYWN0aW9uQnJva2VyIGZyb20gXCIuL3NoYXJlZC10cmFuc2FjdGlvbi1icm9rZXIuanNcIlxuaW1wb3J0IHsgU0hBUkVEX1RSQU5TQUNUSU9OX0JST0tFUl9FTlYgfSBmcm9tIFwiLi9zaGFyZWQtdHJhbnNhY3Rpb24tcHJveHktZHJpdmVyLmpzXCJcbmltcG9ydCBWZWxvY2lvdXNBdHRlbXB0RXhlY3V0b3IgZnJvbSBcIi4vdmVsb2Npb3VzLWF0dGVtcHQtZXhlY3V0b3IuanNcIlxuaW1wb3J0IFZlbG9jaW91c1J1bm5lclJlcG9ydGVyLCB7QWJvcnRSZW1haW5pbmdUZXN0c0Vycm9yfSBmcm9tIFwiLi92ZWxvY2lvdXMtcnVubmVyLXJlcG9ydGVyLmpzXCJcbmltcG9ydCBWZWxvY2lvdXNTdWl0ZUhvb2tFeGVjdXRvciBmcm9tIFwiLi92ZWxvY2lvdXMtc3VpdGUtaG9vay1leGVjdXRvci5qc1wiXG5pbXBvcnQgVmVsb2Npb3VzVGVzdEFyZ3VtZW50cyBmcm9tIFwiLi92ZWxvY2lvdXMtdGVzdC1hcmd1bWVudHMuanNcIlxuXG4vKiogQHR5cGVkZWYge3R5cGVvZiBkZWZhdWx0VGVzdENvbnRleHR9IFBhY2thZ2VUZXN0Q29udGV4dCAqL1xuLyoqIEB0eXBlZGVmIHsodHlwZW9mIGRlZmF1bHRUZXN0Q29udGV4dC5yZWdpc3RyeS5zdWl0ZXMpW251bWJlcl19IFBhY2thZ2VTdWl0ZURlY2xhcmF0aW9uICovXG4vKiogQHR5cGVkZWYge1BhY2thZ2VTdWl0ZURlY2xhcmF0aW9uW1widGVzdHNcIl1bbnVtYmVyXX0gUGFja2FnZVRlc3REZWNsYXJhdGlvbiAqL1xuLyoqIEB0eXBlZGVmIHtQYWNrYWdlU3VpdGVEZWNsYXJhdGlvbltcImhvb2tzXCJdW1wiYmVmb3JlQWxsXCJdW251bWJlcl19IFBhY2thZ2VIb29rRGVjbGFyYXRpb24gKi9cbi8qKiBAdHlwZWRlZiB7UGFja2FnZVN1aXRlRGVjbGFyYXRpb24gfCBQYWNrYWdlVGVzdERlY2xhcmF0aW9uIHwgUGFja2FnZUhvb2tEZWNsYXJhdGlvbn0gUGFja2FnZVJlZ2lzdHJhdGlvbiAqL1xuLyoqIEB0eXBlZGVmIHt7aGFkUmV0cmllczogYm9vbGVhbiwgb3B0aW9uczogUGFja2FnZVRlc3REZWNsYXJhdGlvbltcIm9wdGlvbnNcIl0sIHJldHJpZXM6IG51bWJlciB8IHVuZGVmaW5lZH19IFBhY2thZ2VSZXRyeU9wdGlvblJlc3RvcmF0aW9uICovXG5cbi8qKlxuICogQXR0ZW1wdENvbnNvbGVPdXRwdXQgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEF0dGVtcHRDb25zb2xlT3V0cHV0XG4gKiBAcHJvcGVydHkge251bWJlcn0gYXR0ZW1wdE51bWJlciAtIEF0dGVtcHQgbnVtYmVyLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IG91dHB1dCAtIENhcHR1cmVkIGNvbnNvbGUgb3V0cHV0LlxuICovXG4vKipcbiAqIFRlc3RBcmdzIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBUZXN0QXJnc1xuICogQHByb3BlcnR5IHtBcHBsaWNhdGlvbn0gW2FwcGxpY2F0aW9uXSAtIEFwcGxpY2F0aW9uIGluc3RhbmNlIGZvciBpbnRlZ3JhdGlvbiB0ZXN0cy5cbiAqIEBwcm9wZXJ0eSB7UmVxdWVzdENsaWVudH0gW2NsaWVudF0gLSBIVFRQIGNsaWVudCBmb3IgcmVxdWVzdCB0ZXN0cy5cbiAqIEBwcm9wZXJ0eSB7b2JqZWN0fSBbZGF0YWJhc2VDbGVhbmluZ10gLSBEYXRhYmFzZSBjbGVhbnVwIG9wdGlvbnMgZm9yIHRlc3RzLlxuICogQHByb3BlcnR5IHtib29sZWFufSBbZGF0YWJhc2VDbGVhbmluZy50cmFuc2FjdGlvbl0gLSBVc2UgdHJhbnNhY3Rpb25zIHRvIHJvbGxiYWNrIGJldHdlZW4gdGVzdHMuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFtkYXRhYmFzZUNsZWFuaW5nLnRydW5jYXRlXSAtIFRydW5jYXRlIHRhYmxlcyBiZXR3ZWVuIHRlc3RzLlxuICogQHByb3BlcnR5IHtib29sZWFufSBbZGF0YWJhc2VDbGVhbmluZy50cnVuY2F0ZUJlZm9yZV0gLSBUcnVuY2F0ZSB0YWJsZXMgYmVmb3JlIGVhY2ggdGVzdCwgaW4gYWRkaXRpb24gdG8gdGhlIGRlZmF1bHQgY2xlYW51cC5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW2ZvY3VzXSAtIFdoZXRoZXIgdGhpcyB0ZXN0IGlzIGZvY3VzZWQuXG4gKiBAcHJvcGVydHkgeygpID0+ICh2b2lkfFByb21pc2U8dm9pZD4pfSBbZnVuY3Rpb25dIC0gVGVzdCBjYWxsYmFjayBmdW5jdGlvbi5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBbcmV0cnldIC0gTnVtYmVyIG9mIHJldHJpZXMgd2hlbiBhIHRlc3QgZmFpbHMuXG4gKiBAcHJvcGVydHkge3N0cmluZ1tdIHwgc3RyaW5nfSBbdGFnc10gLSBUYWdzIGZvciBmaWx0ZXJpbmcuXG4gKiBAcHJvcGVydHkge251bWJlcn0gW3RpbWVvdXRTZWNvbmRzXSAtIFRpbWVvdXQgaW4gc2Vjb25kcyBmb3IgdGhlIHRlc3QuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW3R5cGVdIC0gVGVzdCB0eXBlIGlkZW50aWZpZXIuXG4gKiBAcHJvcGVydHkgeyhhcmdzOiB7ZGF0YWJhc2VJZGVudGlmaWVyOiBzdHJpbmcsIHRlbmFudDogb2JqZWN0fSkgPT4gUHJvbWlzZTx2b2lkPn0gW3JlZ2lzdGVyVHJhbnNhY3Rpb25hbFRlbmFudF0gLSBSZWdpc3RlcnMgb25lIHJlc29sdmVkIHRlbmFudCBkYXRhYmFzZSB0cmFuc2FjdGlvbiBmb3IgdGhpcyBhdHRlbXB0LlxuICovXG4vKipcbiAqIEJyb3dzZXJEdW1teUNvbm5lY3Rpb25SZWdpc3RyYXRpb24gdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJyb3dzZXJEdW1teUNvbm5lY3Rpb25SZWdpc3RyYXRpb25cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGRiIC0gQXR0ZW1wdC1vd25lZCBjb25uZWN0aW9uLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGRhdGFiYXNlSWRlbnRpZmllciAtIENvbmZpZ3VyZWQgZGF0YWJhc2UgaWRlbnRpZmllci5cbiAqIEBwcm9wZXJ0eSB7UHJvbWlzZTx2b2lkPn0gW3F1YXJhbnRpbmVQcm9taXNlXSAtIFNoYXJlZCBjb25uZWN0aW9uLWRpc2NhcmQgcHJvbWlzZS5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gcXVhcmFudGluZWQgLSBXaGV0aGVyIHRoZSBjb25uZWN0aW9uIGlzIHVuc2FmZSB0byByZXVzZS5cbiAqIEBwcm9wZXJ0eSB7UHJvbWlzZTx2b2lkPn0gW3JvbGxiYWNrUHJvbWlzZV0gLSBTaGFyZWQgcm9sbGJhY2sgcHJvbWlzZS5cbiAqIEBwcm9wZXJ0eSB7UHJvbWlzZTx2b2lkPn0gW3N0YXJ0UHJvbWlzZV0gLSBUcmFuc2FjdGlvbiBzdGFydHVwIHByb21pc2Ugd2hlbiB0cmFuc2FjdGlvbiBjbGVhbmluZyBpcyBlbmFibGVkLlxuICovXG4vKipcbiAqIFRlc3REYXRhIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBUZXN0RGF0YVxuICogQHByb3BlcnR5IHtUZXN0QXJnc30gYXJncyAtIEFyZ3VtZW50cyBwYXNzZWQgdG8gdGhlIHRlc3QuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW2ZpbGVQYXRoXSAtIFNvdXJjZSBmaWxlIHBhdGguXG4gKiBAcHJvcGVydHkge251bWJlcn0gW2xpbmVdIC0gU291cmNlIGxpbmUgbnVtYmVyLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtvd25lckZpbGVQYXRoXSAtIERldGVybWluaXN0aWMgaW1wb3J0aW5nIHRlc3QgZmlsZS5cbiAqIEBwcm9wZXJ0eSB7KGFyZzogVGVzdEFyZ3MpID0+ICh2b2lkfFByb21pc2U8dm9pZD4pfSBmdW5jdGlvbiAtIFRlc3QgY2FsbGJhY2sgdG8gZXhlY3V0ZS5cbiAqIEBwcm9wZXJ0eSB7UGFja2FnZVRlc3REZWNsYXJhdGlvbn0gW2RlY2xhcmF0aW9uXSAtIFBhY2thZ2UgZGVjbGFyYXRpb24uXG4gKi9cbi8qKlxuICogRmFpbGVkVGVzdERldGFpbCB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gRmFpbGVkVGVzdERldGFpbFxuICogQHByb3BlcnR5IHtzdHJpbmd9IGZ1bGxEZXNjcmlwdGlvbiAtIEZ1bGwgdGVzdCBkZXNjcmlwdGlvbi5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbZmlsZVBhdGhdIC0gU291cmNlIGZpbGUgcGF0aC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBbbGluZV0gLSBTb3VyY2UgbGluZSBudW1iZXIuXG4gKiBAcHJvcGVydHkge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBlcnJvciAtIEZhaWx1cmUgZXJyb3IuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW2NvbnNvbGVPdXRwdXRdIC0gQ2FwdHVyZWQgY29uc29sZSBvdXRwdXQgd2hpbGUgdGVzdCByYW4uXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW2NvbnNvbGVMb2dQYXRoXSAtIFNhdmVkIGNvbnNvbGUgbG9nIHBhdGguXG4gKi9cbi8qKlxuICogRGVmaW5lcyB0aGlzIHR5cGVkZWYuXG4gKiBAdHlwZWRlZiB7KGFyZ3M6IHtjb25maWd1cmF0aW9uOiBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHQsIHRlc3RBcmdzOiBUZXN0QXJncywgdGVzdERhdGE6IFRlc3REYXRhfSkgPT4gKHZvaWR8UHJvbWlzZTx2b2lkPil9IEFmdGVyQmVmb3JlRWFjaENhbGxiYWNrVHlwZVxuICovXG4vKipcbiAqIEFmdGVyQmVmb3JlRWFjaENhbGxiYWNrT2JqZWN0VHlwZSB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gQWZ0ZXJCZWZvcmVFYWNoQ2FsbGJhY2tPYmplY3RUeXBlXG4gKiBAcHJvcGVydHkge0FmdGVyQmVmb3JlRWFjaENhbGxiYWNrVHlwZX0gY2FsbGJhY2sgLSBIb29rIGNhbGxiYWNrIHRvIGV4ZWN1dGUuXG4gKiBAcHJvcGVydHkge251bWJlcn0gW2RlY2xhcmF0aW9uSW5kZXhdIC0gSG9vayBpbmRleCB3aXRoaW4gaXRzIGRlY2xhcmF0aW9uIHNjb3BlLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtkZWNsYXJhdGlvblNjb3BlSWRdIC0gT3BhcXVlIHByb2ZpbGUgc2NvcGUgaWRlbnRpZmllci5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbb3duZXJGaWxlUGF0aF0gLSBEZXRlcm1pbmlzdGljIGltcG9ydGluZyB0ZXN0IGZpbGUuXG4gKi9cbi8qKlxuICogRGVmaW5lcyB0aGlzIHR5cGVkZWYuXG4gKiBAdHlwZWRlZiB7KGFyZ3M6IHtjb25maWd1cmF0aW9uOiBpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9KSA9PiAodm9pZHxQcm9taXNlPHZvaWQ+KX0gQmVmb3JlQWZ0ZXJBbGxDYWxsYmFja1R5cGVcbiAqL1xuLyoqXG4gKiBCZWZvcmVBZnRlckFsbENhbGxiYWNrT2JqZWN0VHlwZSB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gQmVmb3JlQWZ0ZXJBbGxDYWxsYmFja09iamVjdFR5cGVcbiAqIEBwcm9wZXJ0eSB7QmVmb3JlQWZ0ZXJBbGxDYWxsYmFja1R5cGV9IGNhbGxiYWNrIC0gSG9vayBjYWxsYmFjayB0byBleGVjdXRlLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IFtkZWNsYXJhdGlvbkluZGV4XSAtIEhvb2sgaW5kZXggd2l0aGluIGl0cyBkZWNsYXJhdGlvbiBzY29wZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbZGVjbGFyYXRpb25TY29wZUlkXSAtIE9wYXF1ZSBwcm9maWxlIHNjb3BlIGlkZW50aWZpZXIuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW293bmVyRmlsZVBhdGhdIC0gRGV0ZXJtaW5pc3RpYyBpbXBvcnRpbmcgdGVzdCBmaWxlLlxuICovXG4vKipcbiAqIFRlc3RzQXJndW1lbnQgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFRlc3RzQXJndW1lbnRcbiAqIEBwcm9wZXJ0eSB7VGVzdEFyZ3N9IGFyZ3MgLSBBcmd1bWVudHMgaW5oZXJpdGVkIGJ5IHRlc3RzIGluIHRoaXMgc2NvcGUuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFthbnlUZXN0c0ZvY3Vzc2VkXSAtIFdoZXRoZXIgYW55IHRlc3RzIGluIHRoZSB0cmVlIGFyZSBmb2N1c2VkLlxuICogQHByb3BlcnR5IHtBZnRlckJlZm9yZUVhY2hDYWxsYmFja09iamVjdFR5cGVbXX0gYWZ0ZXJFYWNoZXMgLSBBZnRlci1lYWNoIGhvb2tzIGZvciB0aGlzIHNjb3BlLlxuICogQHByb3BlcnR5IHtCZWZvcmVBZnRlckFsbENhbGxiYWNrT2JqZWN0VHlwZVtdfSBhZnRlckFsbHMgLSBBZnRlci1hbGwgaG9va3MgZm9yIHRoaXMgc2NvcGUuXG4gKiBAcHJvcGVydHkge0JlZm9yZUFmdGVyQWxsQ2FsbGJhY2tPYmplY3RUeXBlW119IGJlZm9yZUFsbHMgLSBCZWZvcmUtYWxsIGhvb2tzIGZvciB0aGlzIHNjb3BlLlxuICogQHByb3BlcnR5IHtBZnRlckJlZm9yZUVhY2hDYWxsYmFja09iamVjdFR5cGVbXX0gYmVmb3JlRWFjaGVzIC0gQmVmb3JlLWVhY2ggaG9va3MgZm9yIHRoaXMgc2NvcGUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW2ZpbGVQYXRoXSAtIFNvdXJjZSBmaWxlIHBhdGguXG4gKiBAcHJvcGVydHkge251bWJlcn0gW2xpbmVdIC0gU291cmNlIGxpbmUgbnVtYmVyLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtvd25lckZpbGVQYXRoXSAtIERldGVybWluaXN0aWMgaW1wb3J0aW5nIHRlc3QgZmlsZS5cbiAqIEBwcm9wZXJ0eSB7UmVjb3JkPHN0cmluZywgVGVzdERhdGE+fSB0ZXN0cyAtIEEgdW5pcXVlIGlkZW50aWZpZXIgZm9yIHRoZSBub2RlLlxuICogQHByb3BlcnR5IHtSZWNvcmQ8c3RyaW5nLCBUZXN0c0FyZ3VtZW50Pn0gc3VicyAtIE9wdGlvbmFsIGNoaWxkIG5vZGVzLiBFYWNoIGl0ZW0gaXMgYW5vdGhlciBgTm9kZWAsIGFsbG93aW5nIHJlY3Vyc2lvbi5cbiAqL1xuLyoqXG4gKiBNYXJrcyB0aGUgZXJyb3IgdGhyb3duIGJ5IHRoZSBhdHRlbXB0IHRpbWVvdXQgc28gdGhlIHJ1bm5lciBjYW4gZGlzdGluZ3Vpc2hcbiAqIGRldGFjaGVkIGxpZmVjeWNsZSBjbGVhbnVwIGZyb20gYW4gb3JkaW5hcnkgdGVzdCBmYWlsdXJlLlxuICogQHR5cGVkZWYge0Vycm9yICYge3ZlbG9jaW91c1Rlc3RUaW1lb3V0PzogdHJ1ZX19IFRlc3RUaW1lb3V0RXJyb3JcbiAqL1xuLyoqXG4gKiBTaGFyZWRUcmFuc2FjdGlvbkJyb2tlclJlZ2lzdHJhdGlvbiB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJSZWdpc3RyYXRpb25cbiAqIEBwcm9wZXJ0eSB7U2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJ9IGJyb2tlciAtIEF0dGVtcHQgYnJva2VyIGFuZCBjb25uZWN0aW9uIGNvb3JkaW5hdG9yLlxuICogQHByb3BlcnR5IHtib29sZWFufSBlbnZpcm9ubWVudFB1Ymxpc2hlZCAtIFdoZXRoZXIgY2hpbGQtcHJvY2VzcyBjb29yZGluYXRlcyB3ZXJlIHB1Ymxpc2hlZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBwcmV2aW91c0Vudmlyb25tZW50IC0gRW52aXJvbm1lbnQgdmFsdWUgdG8gcmVzdG9yZSBhZnRlciBwdWJsaWNhdGlvbi5cbiAqL1xuLyoqXG4gKiBUcmFuc2FjdGlvbmFsVGVuYW50UmVnaXN0cmF0aW9uIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBUcmFuc2FjdGlvbmFsVGVuYW50UmVnaXN0cmF0aW9uXG4gKiBAcHJvcGVydHkge1Byb21pc2U8e2Nvbm5lY3Rpb246IGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkLCBlcnJvcjogRXJyb3IgfCB1bmRlZmluZWR9PiB8IHVuZGVmaW5lZH0gW2NoZWNrb3V0UHJvbWlzZV0gLSBBdHRlbXB0LW93bmVkIHBoeXNpY2FsIGNoZWNrb3V0IG91dGNvbWUuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSBjb25uZWN0aW9uIC0gQXR0ZW1wdC1vd25lZCBwaHlzaWNhbCBjb25uZWN0aW9uIG9uY2UgY2hlY2tvdXQgcmVzb2x2ZXMuXG4gKiBAcHJvcGVydHkge1Byb21pc2U8dm9pZD4gfCB1bmRlZmluZWR9IFtjbGVhbnVwUHJvbWlzZV0gLSBTaW5nbGUgY2xlYW51cCBvcGVyYXRpb24gc2hhcmVkIGJ5IGVtZXJnZW5jeSBhbmQgZXZlbnR1YWwgbGlmZWN5Y2xlIGNsZWFudXAuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW4gfCB1bmRlZmluZWR9IFtkaXNjYXJkT25DbGVhbnVwXSAtIFdoZXRoZXIgdGltZW91dCBlbWVyZ2VuY3kgY2xlYW51cCBtdXN0IHF1YXJhbnRpbmUgdGhpcyBjb25uZWN0aW9uLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9wb29sL2Jhc2UuanNcIikuZGVmYXVsdH0gcG9vbCAtIE93bmluZyBsb2dpY2FsIHBvb2wuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IHJldm9rZWQgLSBXaGV0aGVyIHRoaXMgYXR0ZW1wdCBtYXkgc3RpbGwgcHVibGlzaCB0aGUgcGh5c2ljYWwgcmVnaXN0cmF0aW9uLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHJldXNlS2V5IC0gUmVzb2x2ZWQgcGh5c2ljYWwgY29uZmlndXJhdGlvbiBpZGVudGl0eS5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcG9vbC9iYXNlLmpzXCIpLlRlc3RTaGFyZWRDb25uZWN0aW9uUmVnaXN0cmF0aW9uIHwgdW5kZWZpbmVkfSBzaGFyZWRSZWdpc3RyYXRpb24gLSBQaHlzaWNhbC1rZXkgc2hhcmVkIHJlZ2lzdHJhdGlvbiBvbmNlIHB1Ymxpc2hlZC5cbiAqL1xuXG4vKipcbiAqIFJ1bnMgdG8gZmlsZSBzbHVnLlxuICogQHBhcmFtIHtzdHJpbmd9IHZhbHVlIC0gVmFsdWUgdG8gc2FuaXRpemUuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNsdWctc2FmZSB2YWx1ZS5cbiAqL1xuZnVuY3Rpb24gdG9GaWxlU2x1Zyh2YWx1ZSkge1xuICByZXR1cm4gdmFsdWVcbiAgICAudG9Mb3dlckNhc2UoKVxuICAgIC5yZXBsYWNlKC9bXmEtejAtOV0rL2csIFwiLVwiKVxuICAgIC5yZXBsYWNlKC9eLSt8LSskL2csIFwiXCIpXG4gICAgLnNsaWNlKDAsIDgwKSB8fCBcImZhaWxlZC10ZXN0XCJcbn1cblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVGVzdFJ1bm5lciB7XG4gIC8qKiBAdHlwZSB7UGFja2FnZVRlc3RDb250ZXh0fSAqL1xuICBfY29udGV4dFxuXG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAqIEB0eXBlIHtGYWlsZWRUZXN0RGV0YWlsW119ICovXG4gIF9mYWlsZWRUZXN0RGV0YWlsc1xuXG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gYXJncy5jb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtQYWNrYWdlVGVzdENvbnRleHR9IFthcmdzLmNvbnRleHRdIC0gRGVjbGFyYXRpb24gY29udGV4dC5cbiAgICogQHBhcmFtIHtzdHJpbmdbXSB8IHN0cmluZ30gW2FyZ3MuZXhjbHVkZVRhZ3NdIC0gVGFncyB0byBleGNsdWRlLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdIHwgc3RyaW5nfSBbYXJncy5pbmNsdWRlVGFnc10gLSBUYWdzIHRvIGluY2x1ZGUuXG4gICAqIEBwYXJhbSB7QXJyYXk8c3RyaW5nPn0gYXJncy50ZXN0RmlsZXMgLSBUZXN0IGZpbGVzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIG51bWJlcltdPn0gW2FyZ3MubGluZUZpbHRlcnNdIC0gTGluZSBmaWx0ZXJzIGJ5IGZpbGUuXG4gICAqIEBwYXJhbSB7UmVnRXhwW119IFthcmdzLmV4YW1wbGVQYXR0ZXJuc10gLSBFeGFtcGxlIHBhdHRlcm5zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdGVzdC1wcm9maWxlci5qc1wiKS5kZWZhdWx0fSBbYXJncy5wcm9maWxlcl0gLSBPcHQtaW4gcHJvZmlsZXIuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Y29uZmlndXJhdGlvbiwgY29udGV4dCA9IGRlZmF1bHRUZXN0Q29udGV4dCwgZXhjbHVkZVRhZ3MsIGluY2x1ZGVUYWdzLCB0ZXN0RmlsZXMsIGxpbmVGaWx0ZXJzLCBleGFtcGxlUGF0dGVybnMsIHByb2ZpbGVyLCAuLi5yZXN0QXJnc30pIHtcbiAgICByZXN0QXJnc0Vycm9yKHJlc3RBcmdzKVxuXG4gICAgaWYgKCFjb25maWd1cmF0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJjb25maWd1cmF0aW9uIGlzIHJlcXVpcmVkXCIpXG5cbiAgICB0aGlzLl9jb25maWd1cmF0aW9uID0gY29uZmlndXJhdGlvblxuICAgIHRoaXMuX2NvbnRleHQgPSBjb250ZXh0XG4gICAgdGhpcy5fc2hhcmVkVHJhbnNhY3Rpb25Db29yZGluYXRvck93bmVyU3RvcmFnZSA9IG5ldyBBc3luY0xvY2FsU3RvcmFnZSgpXG4gICAgdGhpcy5fdGVzdERhdGFiYXNlQWNjZXNzU2NvcGVTdG9yYWdlID0gbmV3IEFzeW5jTG9jYWxTdG9yYWdlKClcbiAgICB0aGlzLl9leGNsdWRlVGFncyA9IHRoaXMubm9ybWFsaXplVGFncyhleGNsdWRlVGFncylcbiAgICB0aGlzLl9pbmNsdWRlVGFncyA9IHRoaXMubm9ybWFsaXplVGFncyhpbmNsdWRlVGFncylcbiAgICB0aGlzLl90ZXN0RmlsZXMgPSB0ZXN0RmlsZXNcbiAgICB0aGlzLl9saW5lRmlsdGVycyA9IGxpbmVGaWx0ZXJzIHx8IHt9XG4gICAgdGhpcy5fZXhhbXBsZVBhdHRlcm5zID0gZXhhbXBsZVBhdHRlcm5zIHx8IFtdXG4gICAgdGhpcy5fcHJvZmlsZXIgPSBwcm9maWxlclxuICAgIHRoaXMuX2Fib3J0UmVtYWluaW5nVGVzdHMgPSBmYWxzZVxuXG4gICAgdGhpcy5fZmFpbGVkVGVzdHMgPSAwXG4gICAgdGhpcy5fc3VjY2Vzc2Z1bFRlc3RzID0gMFxuICAgIHRoaXMuX3Rlc3RzQ291bnQgPSAwXG4gICAgdGhpcy5fZmFpbGVkVGVzdERldGFpbHMgPSBbXVxuICAgIC8qKiBAdHlwZSB7e2Z1bGxEZXNjcmlwdGlvbjogc3RyaW5nLCBmaWxlUGF0aDogc3RyaW5nLCBsaW5lOiBudW1iZXJ9IHwgbnVsbH0gKi9cbiAgICB0aGlzLl9sYXN0VGVzdENvbnRleHQgPSBudWxsXG4gICAgLyoqIEB0eXBlIHtBcnJheTx7ZnVsbERlc2NyaXB0aW9uOiBzdHJpbmcsIGZpbGVQYXRoOiBzdHJpbmcsIGxpbmU6IG51bWJlciwgZHVyYXRpb25NczogbnVtYmVyfT59ICovXG4gICAgdGhpcy5fdGVzdER1cmF0aW9ucyA9IFtdXG4gICAgLyoqIEB0eXBlIHtXZWFrTWFwPFBhY2thZ2VUZXN0RGVjbGFyYXRpb24sIHt0ZXN0QXJnczogVGVzdEFyZ3MsIHRlc3REYXRhOiBUZXN0RGF0YX0+fSAqL1xuICAgIHRoaXMuX3Rlc3RDb21wYXRpYmlsaXR5ID0gbmV3IFdlYWtNYXAoKVxuICAgIC8qKiBAdHlwZSB7V2Vha1NldDxQYWNrYWdlVGVzdERlY2xhcmF0aW9uPn0gKi9cbiAgICB0aGlzLl9pbmplY3RlZFRlc3RzID0gbmV3IFdlYWtTZXQoKVxuICAgIC8qKiBAdHlwZSB7V2Vha1NldDxQYWNrYWdlVGVzdERlY2xhcmF0aW9uPn0gKi9cbiAgICB0aGlzLl9jb21wbGV0ZWRUZXN0cyA9IG5ldyBXZWFrU2V0KClcbiAgICAvKiogQHR5cGUge1dlYWtNYXA8UGFja2FnZVRlc3REZWNsYXJhdGlvbiwge2Rlc2NyaXB0aW9uczogc3RyaW5nW10sIHRlc3REZXNjcmlwdGlvbjogc3RyaW5nLCBmdWxsRGVzY3JpcHRpb246IHN0cmluZywgb3duZXJGaWxlUGF0aDogc3RyaW5nIHwgdW5kZWZpbmVkLCBzdWl0ZXM6IFBhY2thZ2VTdWl0ZURlY2xhcmF0aW9uW119Pn0gKi9cbiAgICB0aGlzLl90ZXN0TWV0YWRhdGEgPSBuZXcgV2Vha01hcCgpXG4gICAgLyoqIEB0eXBlIHtXZWFrTWFwPFBhY2thZ2VIb29rRGVjbGFyYXRpb24sIHtkZWNsYXJhdGlvbkluZGV4OiBudW1iZXIsIGRlY2xhcmF0aW9uU2NvcGVJZDogc3RyaW5nIHwgdW5kZWZpbmVkLCBvd25lckZpbGVQYXRoOiBzdHJpbmcgfCB1bmRlZmluZWR9Pn0gKi9cbiAgICB0aGlzLl9ob29rTWV0YWRhdGEgPSBuZXcgV2Vha01hcCgpXG4gICAgLyoqIEB0eXBlIHtXZWFrTWFwPFBhY2thZ2VUZXN0RGVjbGFyYXRpb24sIE1hcDxudW1iZXIsIHthYm9ydFJlbWFpbmluZ1Rlc3RzOiBib29sZWFuLCBlcnJvcjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4sIGZhaWxlZDogYm9vbGVhbn0+Pn0gKi9cbiAgICB0aGlzLl9hdHRlbXB0T3V0Y29tZXMgPSBuZXcgV2Vha01hcCgpXG4gICAgLyoqIEB0eXBlIHtBcnJheTx7c3VpdGU6IFBhY2thZ2VTdWl0ZURlY2xhcmF0aW9uLCBwaGFzZTogXCJiZWZvcmVBbGxcIiB8IFwiYWZ0ZXJBbGxcIiwgZXJyb3I6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fT59ICovXG4gICAgdGhpcy5fc3VpdGVIb29rRmFpbHVyZXMgPSBbXVxuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgUGFja2FnZVRlc3REZWNsYXJhdGlvbltdPn0gKi9cbiAgICB0aGlzLl90ZXN0c0J5RnVsbE5hbWUgPSBuZXcgTWFwKClcbiAgICAvKiogQHR5cGUge1dlYWtNYXA8UGFja2FnZVJlZ2lzdHJhdGlvbiwgc3RyaW5nPn0gKi9cbiAgICB0aGlzLl9kZWNsYXJhdGlvbk93bmVycyA9IG5ldyBXZWFrTWFwKClcbiAgICAvKiogQHR5cGUge1BhY2thZ2VUZXN0UnVubmVyIHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX3BhY2thZ2VSdW5uZXIgPSB1bmRlZmluZWRcbiAgICAvKiogQHR5cGUge2ltcG9ydChcIkB2ZWxvY2lvdXMvdGVzdGluZy9ydW5uZXJcIikuVGVzdFJ1blJlc3VsdCB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9wYWNrYWdlUmVzdWx0ID0gdW5kZWZpbmVkXG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBUZXN0RGF0YT4gfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5fbGVnYWN5Rml4dHVyZURhdGFCeUZ1bGxOYW1lID0gdW5kZWZpbmVkXG4gICAgLyoqIEB0eXBlIHt7ZmlsZVBhdGg/OiBzdHJpbmcsIGxpbmU/OiBudW1iZXJ9fSAqL1xuICAgIHRoaXMuX2xlZ2FjeUZpeHR1cmVMb2NhdGlvbiA9IHt9XG4gICAgdGhpcy5fYXR0ZW1wdEV4ZWN1dG9yID0gbmV3IFZlbG9jaW91c0F0dGVtcHRFeGVjdXRvcih7dGVzdFJ1bm5lcjogdGhpc30pXG4gICAgdGhpcy5fcnVubmVyUmVwb3J0ZXIgPSBuZXcgVmVsb2Npb3VzUnVubmVyUmVwb3J0ZXIoe3Rlc3RSdW5uZXI6IHRoaXN9KVxuICAgIHRoaXMuX3N1aXRlSG9va0V4ZWN1dG9yID0gbmV3IFZlbG9jaW91c1N1aXRlSG9va0V4ZWN1dG9yKHt0ZXN0UnVubmVyOiB0aGlzfSlcbiAgICB0aGlzLl90ZXN0QXJndW1lbnRzID0gbmV3IFZlbG9jaW91c1Rlc3RBcmd1bWVudHMoe3Rlc3RSdW5uZXI6IHRoaXN9KVxuICB9XG5cbiAgLyoqXG4gICAqIEdldHMgdGhlIHBhY2thZ2UgZGVjbGFyYXRpb24gY29udGV4dC5cbiAgICogQHJldHVybnMge1BhY2thZ2VUZXN0Q29udGV4dH0gLSBQYWNrYWdlIGRlY2xhcmF0aW9uIGNvbnRleHQuXG4gICAqL1xuICBnZXRUZXN0Q29udGV4dCgpIHsgcmV0dXJuIHRoaXMuX2NvbnRleHQgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSAtIFRoZSBjb25maWd1cmF0aW9uLlxuICAgKi9cbiAgZ2V0Q29uZmlndXJhdGlvbigpIHsgcmV0dXJuIHRoaXMuX2NvbmZpZ3VyYXRpb24gfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0ZXN0IGZpbGVzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nW119IC0gVGhlIHRlc3QgZmlsZXMuXG4gICAqL1xuICBnZXRUZXN0RmlsZXMoKSB7IHJldHVybiB0aGlzLl90ZXN0RmlsZXMgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBsaW5lIGZpbHRlcnMuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBudW1iZXJbXT59IC0gTGluZSBmaWx0ZXJzLlxuICAgKi9cbiAgZ2V0TGluZUZpbHRlcnMoKSB7IHJldHVybiB0aGlzLl9saW5lRmlsdGVycyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGV4YW1wbGUgcGF0dGVybnMuXG4gICAqIEByZXR1cm5zIHtSZWdFeHBbXX0gLSBFeGFtcGxlIHBhdHRlcm5zLlxuICAgKi9cbiAgZ2V0RXhhbXBsZVBhdHRlcm5zKCkgeyByZXR1cm4gdGhpcy5fZXhhbXBsZVBhdHRlcm5zIH1cblxuICAvKipcbiAgICogUnVucyBhIHByb2ZpbGVyIHNwYW4gb25seSB3aGVuIHByb2ZpbGluZyB3YXMgZXhwbGljaXRseSBlbmFibGVkLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge29iamVjdH0gbWV0YWRhdGEgLSBTcGFuIG1ldGFkYXRhLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbWV0YWRhdGEucGhhc2UgLSBQaGFzZSBuYW1lLlxuICAgKiBAcGFyYW0ge251bWJlcn0gW21ldGFkYXRhLmRlY2xhcmF0aW9uSW5kZXhdIC0gSG9vayBkZWNsYXJhdGlvbiBpbmRleC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFttZXRhZGF0YS5kZWNsYXJhdGlvblNjb3BlSWRdIC0gSG9vayBkZWNsYXJhdGlvbiBzY29wZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFttZXRhZGF0YS5maWxlUGF0aF0gLSBTb3VyY2Ugb3duZXJzaGlwLlxuICAgKiBAcGFyYW0geygpID0+IChUIHwgUHJvbWlzZTxUPil9IGNhbGxiYWNrIC0gVGltZWQgY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJlc3VsdC5cbiAgICovXG4gIGFzeW5jIHJ1blByb2ZpbGVTcGFuKG1ldGFkYXRhLCBjYWxsYmFjaykge1xuICAgIGlmICghdGhpcy5fcHJvZmlsZXIpIHJldHVybiBhd2FpdCBjYWxsYmFjaygpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fcHJvZmlsZXIucnVuU3BhbihtZXRhZGF0YSwgY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgdGFncy5cbiAgICogQHBhcmFtIHtzdHJpbmdbXSB8IHN0cmluZyB8IHVuZGVmaW5lZH0gdGFncyAtIFRhZ3MuXG4gICAqIEByZXR1cm5zIHtzdHJpbmdbXX0gLSBOb3JtYWxpemVkIHRhZ3MuXG4gICAqL1xuICBub3JtYWxpemVUYWdzKHRhZ3MpIHtcbiAgICBpZiAoIXRhZ3MpIHJldHVybiBbXVxuXG4gICAgY29uc3QgdmFsdWVzID0gW11cbiAgICBjb25zdCByYXdUYWdzID0gQXJyYXkuaXNBcnJheSh0YWdzKSA/IHRhZ3MgOiBbdGFnc11cblxuICAgIGZvciAoY29uc3QgcmF3VGFnIG9mIHJhd1RhZ3MpIHtcbiAgICAgIGlmIChyYXdUYWcgPT09IHVuZGVmaW5lZCB8fCByYXdUYWcgPT09IG51bGwpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IHBhcnRzID0gU3RyaW5nKHJhd1RhZykuc3BsaXQoXCIsXCIpXG5cbiAgICAgIGZvciAoY29uc3QgcGFydCBvZiBwYXJ0cykge1xuICAgICAgICBjb25zdCB0cmltbWVkID0gcGFydC50cmltKClcblxuICAgICAgICBpZiAodHJpbW1lZCkgdmFsdWVzLnB1c2godHJpbW1lZClcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gQXJyYXkuZnJvbShuZXcgU2V0KHZhbHVlcykpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYXMgdGFnLlxuICAgKiBAcGFyYW0ge1Rlc3RBcmdzfSB0ZXN0QXJncyAtIFRlc3QgYXJncy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRhZyAtIFRhZyB0byBjaGVjayBmb3IuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGFnIGlzIHByZXNlbnQuXG4gICAqL1xuICBoYXNUYWcodGVzdEFyZ3MsIHRhZykge1xuICAgIHJldHVybiB0aGlzLm5vcm1hbGl6ZVRhZ3ModGVzdEFyZ3M/LnRhZ3MpLmluY2x1ZGVzKHRhZylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlzIGJyb3dzZXIgdGVzdCBtb2RlLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHJ1bm5pbmcgYnJvd3NlciB0ZXN0cy5cbiAgICovXG4gIGlzQnJvd3NlclRlc3RNb2RlKCkge1xuICAgIHJldHVybiBwcm9jZXNzLmVudi5WRUxPQ0lPVVNfQlJPV1NFUl9URVNUUyA9PT0gXCJ0cnVlXCJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1biB3aXRoIGR1bW15IGlmIG5lZWRlZC5cbiAgICogQHBhcmFtIHtUZXN0QXJnc30gdGVzdEFyZ3MgLSBUZXN0IGFyZ3MuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTx2b2lkPn0gY2FsbGJhY2sgLSBDYWxsYmFjayB0byBydW4uXG4gICAqIEBwYXJhbSB7QnJvd3NlckR1bW15Q29ubmVjdGlvblJlZ2lzdHJhdGlvbltdfSBbYnJvd3NlckR1bW15Q29ubmVjdGlvblJlZ2lzdHJhdGlvbnNdIC0gQXR0ZW1wdC1vd25lZCBicm93c2VyIGNvbm5lY3Rpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgcnVuV2l0aER1bW15SWZOZWVkZWQodGVzdEFyZ3MsIGNhbGxiYWNrLCBicm93c2VyRHVtbXlDb25uZWN0aW9uUmVnaXN0cmF0aW9ucyA9IFtdKSB7XG4gICAgaWYgKCF0aGlzLmhhc1RhZyh0ZXN0QXJncywgXCJkdW1teVwiKSkge1xuICAgICAgYXdhaXQgY2FsbGJhY2soKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKHRoaXMuaXNCcm93c2VyVGVzdE1vZGUoKSkge1xuICAgICAgYXdhaXQgdGhpcy5ydW5Ccm93c2VyRHVtbXkodGVzdEFyZ3MsIGNhbGxiYWNrLCBicm93c2VyRHVtbXlDb25uZWN0aW9uUmVnaXN0cmF0aW9ucylcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMucnVuTm9kZUR1bW15KGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcnVuIG5vZGUgZHVtbXkuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTx2b2lkPn0gY2FsbGJhY2sgLSBDYWxsYmFjayB0byBydW4uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBydW5Ob2RlRHVtbXkoY2FsbGJhY2spIHtcbiAgICBjb25zdCBkdW1teVBhdGggPSBwcm9jZXNzLmVudi5WRUxPQ0lPVVNfRFVNTVlfUEFUSCB8fCB0aGlzLmRlZmF1bHREdW1teVBhdGgoKVxuICAgIGNvbnN0IGR1bW15SW1wb3J0ID0gYXdhaXQgaW1wb3J0KHBhdGhUb0ZpbGVVUkwoZHVtbXlQYXRoKS5ocmVmKVxuICAgIGNvbnN0IER1bW15ID0gZHVtbXlJbXBvcnQuZGVmYXVsdFxuXG4gICAgaWYgKCFEdW1teT8ucnVuKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYER1bW15IGhlbHBlciBub3QgZm91bmQgYXQgJHtkdW1teVBhdGh9YClcbiAgICB9XG5cbiAgICAvLyBQZXJzaXN0ZW50IHNlcnZlciByZXNvdXJjZXMgbXVzdCBub3QgaW5oZXJpdCBhbiBhdHRlbXB0IHNjb3BlIHRoYXQgd2lsbCBiZSByZXZva2VkLlxuICAgIGF3YWl0IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldEVudmlyb25tZW50SGFuZGxlcigpLnJ1bldpdGhDYXB0dXJlZFRlc3REYXRhYmFzZUFjY2Vzc1Njb3BlKHVuZGVmaW5lZCwgYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgRHVtbXkucnVuKGFzeW5jICgpID0+IHt9KVxuICAgIH0pXG4gICAgdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuYXNzZXJ0RGF0YWJhc2VBY2Nlc3NBbGxvd2VkKClcbiAgICBhd2FpdCBjYWxsYmFjaygpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZWZhdWx0IGR1bW15IHBhdGguXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gRGVmYXVsdCBkdW1teSBoZWxwZXIgcGF0aC5cbiAgICovXG4gIGRlZmF1bHREdW1teVBhdGgoKSB7XG4gICAgY29uc3QgY3dkID0gcGF0aC5yZXNvbHZlKHByb2Nlc3MuY3dkKCkpXG4gICAgY29uc3Qgbm9ybWFsaXplZCA9IGN3ZC5zcGxpdChwYXRoLnNlcCkuam9pbihcIi9cIilcblxuICAgIGlmIChub3JtYWxpemVkLmVuZHNXaXRoKFwiL3NwZWMvZHVtbXlcIikpIHtcbiAgICAgIHJldHVybiBwYXRoLmpvaW4oY3dkLCBcImluZGV4LmpzXCIpXG4gICAgfVxuXG4gICAgcmV0dXJuIHBhdGguam9pbihjd2QsIFwic3BlYy9kdW1teS9pbmRleC5qc1wiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcnVuIGJyb3dzZXIgZHVtbXkuXG4gICAqIEBwYXJhbSB7VGVzdEFyZ3N9IHRlc3RBcmdzIC0gVGVzdCBhcmdzLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8dm9pZD59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgdG8gcnVuLlxuICAgKiBAcGFyYW0ge0Jyb3dzZXJEdW1teUNvbm5lY3Rpb25SZWdpc3RyYXRpb25bXX0gY29ubmVjdGlvblJlZ2lzdHJhdGlvbnMgLSBBdHRlbXB0LW93bmVkIGJyb3dzZXIgY29ubmVjdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBydW5Ccm93c2VyRHVtbXkodGVzdEFyZ3MsIGNhbGxiYWNrLCBjb25uZWN0aW9uUmVnaXN0cmF0aW9ucykge1xuICAgIGNvbnN0IHVzZVRyYW5zYWN0aW9uID0gdGVzdEFyZ3MuZGF0YWJhc2VDbGVhbmluZz8udHJhbnNhY3Rpb24gPT09IHRydWVcbiAgICBjb25zdCB0cnVuY2F0ZSA9IHRlc3RBcmdzLmRhdGFiYXNlQ2xlYW5pbmc/LnRydW5jYXRlXG4gICAgY29uc3Qgc2hvdWxkVHJ1bmNhdGUgPSB0cnVuY2F0ZSA9PT0gdW5kZWZpbmVkID8gIXVzZVRyYW5zYWN0aW9uIDogdHJ1bmNhdGVcblxuICAgIGlmICghdXNlVHJhbnNhY3Rpb24gJiYgIXNob3VsZFRydW5jYXRlKSB7XG4gICAgICBhd2FpdCBjYWxsYmFjaygpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5lbnN1cmVDb25uZWN0aW9ucyh7bmFtZTogXCJUZXN0IHJ1bm5lciBicm93c2VyIGR1bW15XCJ9LCBhc3luYyAoZGJzKSA9PiB7XG4gICAgICBjb25zdCBuZXdSZWdpc3RyYXRpb25zID0gT2JqZWN0LmVudHJpZXMoZGJzKS5tYXAoKFtkYXRhYmFzZUlkZW50aWZpZXIsIGRiXSkgPT4ge1xuICAgICAgICAvKiogQHR5cGUge0Jyb3dzZXJEdW1teUNvbm5lY3Rpb25SZWdpc3RyYXRpb259ICovXG4gICAgICAgIGNvbnN0IHJlZ2lzdHJhdGlvbiA9IHtcbiAgICAgICAgICBkYXRhYmFzZUlkZW50aWZpZXIsXG4gICAgICAgICAgZGIsXG4gICAgICAgICAgcXVhcmFudGluZWQ6IGZhbHNlXG4gICAgICAgIH1cblxuICAgICAgICBjb25uZWN0aW9uUmVnaXN0cmF0aW9ucy5wdXNoKHJlZ2lzdHJhdGlvbilcblxuICAgICAgICByZXR1cm4gcmVnaXN0cmF0aW9uXG4gICAgICB9KVxuXG4gICAgICBpZiAoc2hvdWxkVHJ1bmNhdGUpIHtcbiAgICAgICAgdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuYXNzZXJ0RGF0YWJhc2VBY2Nlc3NBbGxvd2VkKClcbiAgICAgICAgYXdhaXQgdGhpcy50cnVuY2F0ZURhdGFiYXNlcyhkYnMpXG4gICAgICB9XG4gICAgICAvKiogQHR5cGUge3Vua25vd25bXX0gKi9cbiAgICAgIGNvbnN0IGxpZmVjeWNsZUVycm9ycyA9IFtdXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGlmICh1c2VUcmFuc2FjdGlvbikge1xuICAgICAgICAgIGNvbnN0IHN0YXJ0UHJvbWlzZXMgPSBuZXdSZWdpc3RyYXRpb25zLm1hcCgocmVnaXN0cmF0aW9uKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBzdGFydFByb21pc2UgPSByZWdpc3RyYXRpb24uZGIuc3RhcnRUcmFuc2FjdGlvbigpXG5cbiAgICAgICAgICAgIHJlZ2lzdHJhdGlvbi5zdGFydFByb21pc2UgPSBzdGFydFByb21pc2VcbiAgICAgICAgICAgIHJldHVybiBzdGFydFByb21pc2VcbiAgICAgICAgICB9KVxuICAgICAgICAgIGNvbnN0IHN0YXJ0UmVzdWx0cyA9IGF3YWl0IFByb21pc2UuYWxsU2V0dGxlZChzdGFydFByb21pc2VzKVxuICAgICAgICAgIGNvbnN0IHN0YXJ0RXJyb3JzID0gc3RhcnRSZXN1bHRzXG4gICAgICAgICAgICAuZmlsdGVyKChyZXN1bHQpID0+IHJlc3VsdC5zdGF0dXMgPT09IFwicmVqZWN0ZWRcIilcbiAgICAgICAgICAgIC5tYXAoKHJlc3VsdCkgPT4gcmVzdWx0LnJlYXNvbilcblxuICAgICAgICAgIGlmIChzdGFydEVycm9ycy5sZW5ndGggPT0gMSkgdGhyb3cgc3RhcnRFcnJvcnNbMF1cbiAgICAgICAgICBpZiAoc3RhcnRFcnJvcnMubGVuZ3RoID4gMSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKHN0YXJ0RXJyb3JzLCBcIkJyb3dzZXIgZHVtbXkgdHJhbnNhY3Rpb24gc3RhcnR1cCBmYWlsZWRcIiwge2NhdXNlOiBzdGFydEVycm9yc1swXX0pXG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuYXNzZXJ0RGF0YWJhc2VBY2Nlc3NBbGxvd2VkKClcbiAgICAgICAgYXdhaXQgY2FsbGJhY2soKVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgbGlmZWN5Y2xlRXJyb3JzLnB1c2goZXJyb3IpXG4gICAgICB9XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMucm9sbGJhY2tCcm93c2VyRHVtbXlUcmFuc2FjdGlvbnMoY29ubmVjdGlvblJlZ2lzdHJhdGlvbnMpXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBBZ2dyZWdhdGVFcnJvcikge1xuICAgICAgICAgIGxpZmVjeWNsZUVycm9ycy5wdXNoKC4uLmVycm9yLmVycm9ycylcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBsaWZlY3ljbGVFcnJvcnMucHVzaChlcnJvcilcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICB0cnkge1xuICAgICAgICBpZiAoc2hvdWxkVHJ1bmNhdGUpIHtcbiAgICAgICAgICB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5hc3NlcnREYXRhYmFzZUFjY2Vzc0FsbG93ZWQoKVxuICAgICAgICAgIGF3YWl0IHRoaXMudHJ1bmNhdGVEYXRhYmFzZXMoZGJzKVxuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBsaWZlY3ljbGVFcnJvcnMucHVzaChlcnJvcilcbiAgICAgIH1cblxuICAgICAgaWYgKGxpZmVjeWNsZUVycm9ycy5sZW5ndGggPT0gMSkgdGhyb3cgbGlmZWN5Y2xlRXJyb3JzWzBdXG4gICAgICBpZiAobGlmZWN5Y2xlRXJyb3JzLmxlbmd0aCA+IDEpIHtcbiAgICAgICAgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKGxpZmVjeWNsZUVycm9ycywgXCJCcm93c2VyIGR1bW15IGxpZmVjeWNsZSBhbmQgY2xlYW51cCBmYWlsZWRcIiwge2NhdXNlOiBsaWZlY3ljbGVFcnJvcnNbMF19KVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUm9sbHMgYmFjayBldmVyeSBhdHRlbXB0LW93bmVkIGJyb3dzZXIgdHJhbnNhY3Rpb24gZXhhY3RseSBvbmNlLlxuICAgKiBAcGFyYW0ge0Jyb3dzZXJEdW1teUNvbm5lY3Rpb25SZWdpc3RyYXRpb25bXX0gcmVnaXN0cmF0aW9ucyAtIEJyb3dzZXIgY29ubmVjdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGFsbCByb2xsYmFja3Mgc2V0dGxlLlxuICAgKi9cbiAgYXN5bmMgcm9sbGJhY2tCcm93c2VyRHVtbXlUcmFuc2FjdGlvbnMocmVnaXN0cmF0aW9ucykge1xuICAgIGNvbnN0IHJvbGxiYWNrUmVzdWx0cyA9IGF3YWl0IFByb21pc2UuYWxsU2V0dGxlZChbLi4ucmVnaXN0cmF0aW9uc10ucmV2ZXJzZSgpLm1hcCgocmVnaXN0cmF0aW9uKSA9PiB7XG4gICAgICBjb25zdCBzdGFydFByb21pc2UgPSByZWdpc3RyYXRpb24uc3RhcnRQcm9taXNlXG5cbiAgICAgIGlmICghc3RhcnRQcm9taXNlKSByZXR1cm5cblxuICAgICAgcmVnaXN0cmF0aW9uLnJvbGxiYWNrUHJvbWlzZSA/Pz0gKGFzeW5jICgpID0+IHtcbiAgICAgICAgaWYgKHJlZ2lzdHJhdGlvbi5xdWFyYW50aW5lZCkgcmV0dXJuXG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBhd2FpdCBzdGFydFByb21pc2VcbiAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucXVhcmFudGluZUJyb3dzZXJEdW1teUNvbm5lY3Rpb24ocmVnaXN0cmF0aW9uKVxuICAgICAgICAgIH0gY2F0Y2ggKHF1YXJhbnRpbmVFcnJvcikge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBGYWlsZWQgdG8gcXVhcmFudGluZSBicm93c2VyIGR1bW15IGRhdGFiYXNlIGFmdGVyIHRyYW5zYWN0aW9uIHN0YXJ0dXAgZmFpbGVkOiAke3JlZ2lzdHJhdGlvbi5kYXRhYmFzZUlkZW50aWZpZXJ9YCwge2NhdXNlOiBxdWFyYW50aW5lRXJyb3J9KVxuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm5cbiAgICAgICAgfVxuICAgICAgICBpZiAocmVnaXN0cmF0aW9uLnF1YXJhbnRpbmVkKSByZXR1cm5cblxuICAgICAgICB0cnkge1xuICAgICAgICAgIGF3YWl0IHJlZ2lzdHJhdGlvbi5kYi5yb2xsYmFja1RyYW5zYWN0aW9uKClcbiAgICAgICAgfSBjYXRjaCAocm9sbGJhY2tFcnJvcikge1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnF1YXJhbnRpbmVCcm93c2VyRHVtbXlDb25uZWN0aW9uKHJlZ2lzdHJhdGlvbilcbiAgICAgICAgICB9IGNhdGNoIChxdWFyYW50aW5lRXJyb3IpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihcbiAgICAgICAgICAgICAgW3JvbGxiYWNrRXJyb3IsIHF1YXJhbnRpbmVFcnJvcl0sXG4gICAgICAgICAgICAgIGBGYWlsZWQgdG8gcm9sbCBiYWNrIGFuZCBxdWFyYW50aW5lIGJyb3dzZXIgZHVtbXkgZGF0YWJhc2U6ICR7cmVnaXN0cmF0aW9uLmRhdGFiYXNlSWRlbnRpZmllcn1gLFxuICAgICAgICAgICAgICB7Y2F1c2U6IHF1YXJhbnRpbmVFcnJvcn1cbiAgICAgICAgICAgIClcbiAgICAgICAgICB9XG4gICAgICAgICAgdGhyb3cgcm9sbGJhY2tFcnJvclxuICAgICAgICB9XG4gICAgICB9KSgpXG5cbiAgICAgIHJldHVybiByZWdpc3RyYXRpb24ucm9sbGJhY2tQcm9taXNlXG4gICAgfSkpXG4gICAgY29uc3QgZXJyb3JzID0gcm9sbGJhY2tSZXN1bHRzXG4gICAgICAuZmlsdGVyKChyZXN1bHQpID0+IHJlc3VsdC5zdGF0dXMgPT09IFwicmVqZWN0ZWRcIilcbiAgICAgIC5tYXAoKHJlc3VsdCkgPT4gcmVzdWx0LnJlYXNvbilcblxuICAgIGlmIChlcnJvcnMubGVuZ3RoID09IDEpIHRocm93IGVycm9yc1swXVxuICAgIGlmIChlcnJvcnMubGVuZ3RoID4gMSkgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKGVycm9ycywgXCJCcm93c2VyIGR1bW15IHRyYW5zYWN0aW9uIGNsZWFudXAgZmFpbGVkXCIsIHtjYXVzZTogZXJyb3JzWzBdfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBQZXJtYW5lbnRseSByZW1vdmVzIG9uZSBicm93c2VyIGNvbm5lY3Rpb24gdGhhdCBjYW5ub3QgYmUgc2hhcmVkIHNhZmVseS5cbiAgICogQHBhcmFtIHtCcm93c2VyRHVtbXlDb25uZWN0aW9uUmVnaXN0cmF0aW9ufSByZWdpc3RyYXRpb24gLSBCcm93c2VyIGNvbm5lY3Rpb24gcmVnaXN0cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciB0aGUgY29ubmVjdGlvbiBpcyBkaXNjYXJkZWQuXG4gICAqL1xuICBhc3luYyBxdWFyYW50aW5lQnJvd3NlckR1bW15Q29ubmVjdGlvbihyZWdpc3RyYXRpb24pIHtcbiAgICByZWdpc3RyYXRpb24ucXVhcmFudGluZWQgPSB0cnVlXG4gICAgcmVnaXN0cmF0aW9uLnF1YXJhbnRpbmVQcm9taXNlID8/PSB0aGlzLmRpc2NhcmRCcm93c2VyRHVtbXlDb25uZWN0aW9uKHJlZ2lzdHJhdGlvbi5kYXRhYmFzZUlkZW50aWZpZXIsIHJlZ2lzdHJhdGlvbi5kYilcbiAgICBhd2FpdCByZWdpc3RyYXRpb24ucXVhcmFudGluZVByb21pc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBEaXNjYXJkcyBvbmUgYnJvd3NlciBkdW1teSBjb25uZWN0aW9uIHRocm91Z2ggaXRzIG93bmluZyBwb29sLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZGF0YWJhc2VJZGVudGlmaWVyIC0gQ29uZmlndXJlZCBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIFVuc2FmZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBkaXNjYXJkLlxuICAgKi9cbiAgYXN5bmMgZGlzY2FyZEJyb3dzZXJEdW1teUNvbm5lY3Rpb24oZGF0YWJhc2VJZGVudGlmaWVyLCBkYikge1xuICAgIGF3YWl0IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldERhdGFiYXNlUG9vbChkYXRhYmFzZUlkZW50aWZpZXIpLmRpc2NhcmQoZGIpXG4gIH1cblxuICAvKipcbiAgICogUXVhcmFudGluZXMgYWxsIGJyb3dzZXIgY29ubmVjdGlvbnMgY29uY3VycmVudGx5LlxuICAgKiBAcGFyYW0ge0Jyb3dzZXJEdW1teUNvbm5lY3Rpb25SZWdpc3RyYXRpb25bXX0gcmVnaXN0cmF0aW9ucyAtIEJyb3dzZXIgY29ubmVjdGlvbiByZWdpc3RyYXRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBldmVyeSBjb25uZWN0aW9uIGlzIGRpc2NhcmRlZC5cbiAgICovXG4gIGFzeW5jIHF1YXJhbnRpbmVCcm93c2VyRHVtbXlDb25uZWN0aW9ucyhyZWdpc3RyYXRpb25zKSB7XG4gICAgY29uc3QgcXVhcmFudGluZVJlc3VsdHMgPSBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQocmVnaXN0cmF0aW9ucy5tYXAoYXN5bmMgKHJlZ2lzdHJhdGlvbikgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5xdWFyYW50aW5lQnJvd3NlckR1bW15Q29ubmVjdGlvbihyZWdpc3RyYXRpb24pXG4gICAgfSkpXG4gICAgY29uc3QgZXJyb3JzID0gcXVhcmFudGluZVJlc3VsdHNcbiAgICAgIC5maWx0ZXIoKHJlc3VsdCkgPT4gcmVzdWx0LnN0YXR1cyA9PT0gXCJyZWplY3RlZFwiKVxuICAgICAgLm1hcCgocmVzdWx0KSA9PiByZXN1bHQucmVhc29uKVxuXG4gICAgaWYgKGVycm9ycy5sZW5ndGggPT0gMSkgdGhyb3cgZXJyb3JzWzBdXG4gICAgaWYgKGVycm9ycy5sZW5ndGggPiAxKSB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoZXJyb3JzLCBcIkJyb3dzZXIgZHVtbXkgY29ubmVjdGlvbiBxdWFyYW50aW5lIGZhaWxlZFwiLCB7Y2F1c2U6IGVycm9yc1swXX0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0cnVuY2F0ZSBkYXRhYmFzZXMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQ+fSBkYnMgLSBEYXRhYmFzZSBjb25uZWN0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHRydW5jYXRlRGF0YWJhc2VzKGRicykge1xuICAgIGZvciAoY29uc3QgaWRlbnRpZmllciBvZiBPYmplY3Qua2V5cyhkYnMpKSB7XG4gICAgICBhd2FpdCBkYnNbaWRlbnRpZmllcl0udHJ1bmNhdGVBbGxUYWJsZXMoKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBleGNsdWRlIHRhZyBzZXQuXG4gICAqIEByZXR1cm5zIHtTZXQ8c3RyaW5nPn0gLSBFeGNsdWRlIHRhZyBzZXQuXG4gICAqL1xuICBnZXRFeGNsdWRlVGFnU2V0KCkge1xuICAgIC8qKlxuICAgICAqIENvbmZpZyB0YWdzLlxuICAgICAqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgICBjb25zdCBjb25maWdUYWdzID0gQXJyYXkuaXNBcnJheSh0ZXN0Q29uZmlnLmV4Y2x1ZGVUYWdzKSA/IHRlc3RDb25maWcuZXhjbHVkZVRhZ3MgOiBbXVxuXG4gICAgcmV0dXJuIG5ldyBTZXQoWy4uLnRoaXMuX2V4Y2x1ZGVUYWdzLCAuLi5jb25maWdUYWdzXSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJ1aWxkIGZ1bGwgZGVzY3JpcHRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGRlc2NyaXB0aW9ucyAtIERlc2NyaXB0aW9uIHN0YWNrLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGVzdERlc2NyaXB0aW9uIC0gVGVzdCBkZXNjcmlwdGlvbi5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBGdWxsIGRlc2NyaXB0aW9uLlxuICAgKi9cbiAgYnVpbGRGdWxsRGVzY3JpcHRpb24oZGVzY3JpcHRpb25zLCB0ZXN0RGVzY3JpcHRpb24pIHtcbiAgICBjb25zdCBwYXJ0cyA9IGRlc2NyaXB0aW9ucy5jb25jYXQoW3Rlc3REZXNjcmlwdGlvbl0pXG5cbiAgICByZXR1cm4gcGFydHMuam9pbihcIiBcIikudHJpbSgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhcHBsaWNhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8QXBwbGljYXRpb24+fSAtIFJlc29sdmVzIHdpdGggdGhlIGFwcGxpY2F0aW9uLlxuICAgKi9cbiAgYXN5bmMgYXBwbGljYXRpb24oKSB7XG4gICAgaWYgKCF0aGlzLl9hcHBsaWNhdGlvbikge1xuICAgICAgdGhpcy5fYXBwbGljYXRpb24gPSBuZXcgQXBwbGljYXRpb24oe1xuICAgICAgICBjb25maWd1cmF0aW9uOiB0aGlzLmdldENvbmZpZ3VyYXRpb24oKSxcbiAgICAgICAgLy8gUnVuIHJlcXVlc3QgaGFuZGxlcnMgaW4gdGhlIG1haW4gdGhyZWFkIChub3Qgd29ya2VyIHRocmVhZHMpIHNvIHRoZXlcbiAgICAgICAgLy8gcmVzb2x2ZSBEQiB3b3JrIHRvIHRoZSBwZXItdGVzdCBzaGFyZWQgY29ubmVjdGlvbiBzZXQgYnlcbiAgICAgICAgLy8ge0BsaW5rIGFjdGl2YXRlVGVzdFNoYXJlZENvbm5lY3Rpb25zfS4gVGhpcyBsZXRzIHJlcXVlc3QtdHlwZSBzcGVjcyB1c2VcbiAgICAgICAgLy8gdHJhbnNhY3Rpb24tYmFzZWQgY2xlYW5pbmcgKHRoZWlyIHdyaXRlcyBsYW5kIGluc2lkZSB0aGUgdGVzdCdzXG4gICAgICAgIC8vIHRyYW5zYWN0aW9uIGFuZCByb2xsIGJhY2spIGluc3RlYWQgb2YgdHJ1bmNhdGluZyBldmVyeSB0YWJsZS5cbiAgICAgICAgaHR0cFNlcnZlcjoge2luUHJvY2VzczogdHJ1ZSwgcG9ydDogMzEwMDZ9LFxuICAgICAgICB0eXBlOiBcInRlc3QtcnVubmVyXCJcbiAgICAgIH0pXG5cbiAgICAgIGF3YWl0IHRoaXMuX2FwcGxpY2F0aW9uLmluaXRpYWxpemUoKVxuICAgICAgYXdhaXQgdGhpcy5fYXBwbGljYXRpb24uc3RhcnRIdHRwU2VydmVyKClcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fYXBwbGljYXRpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgZWFjaCBub24tdGVuYW50IHBlci10ZXN0IGNvbm5lY3Rpb24gYXMgYSBkeW5hbWljIGNhbmRpZGF0ZSBmb3IgaW4tcHJvY2Vzc1xuICAgKiByZXF1ZXN0IHNoYXJpbmcuIFRoZSBwb29sIGV2YWx1YXRlcyB0cmFuc2FjdGlvbiBzdGF0ZSB3aGVuIGVhY2ggcmVxdWVzdCBpcyBkaXNwYXRjaGVkLFxuICAgKiBzbyBhIHRyYW5zYWN0aW9uIHN0YXJ0ZWQgb3IgZW5kZWQgZHVyaW5nIGEgaG9vayBjYWxsYmFjayB0YWtlcyBlZmZlY3QgaW1tZWRpYXRlbHkuXG4gICAqIEluYWN0aXZlIGFuZCB0ZW5hbnQtb25seSBjb25uZWN0aW9ucyByZW1haW4gaW5kZXBlbmRlbnRseSBwb29sZWQuIFBhaXIgd2l0aFxuICAgKiB7QGxpbmsgY2xlYXJUZXN0U2hhcmVkQ29ubmVjdGlvbnN9IGluIGEgZmluYWxseS5cbiAgICogQHJldHVybnMge3twb29sOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9wb29sL2Jhc2UuanNcIikuZGVmYXVsdCwgcmVnaXN0cmF0aW9uOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9wb29sL2Jhc2UuanNcIikuVGVzdFNoYXJlZENvbm5lY3Rpb25SZWdpc3RyYXRpb259W119IC0gTGlmZWN5Y2xlLW93bmVkIHJlZ2lzdHJhdGlvbnMuXG4gICAqL1xuICBhY3RpdmF0ZVRlc3RTaGFyZWRDb25uZWN0aW9ucygpIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKClcbiAgICBjb25zdCBjdXJyZW50Q29ubmVjdGlvbnMgPSBjb25maWd1cmF0aW9uLmdldEN1cnJlbnRDb25uZWN0aW9ucygpXG4gICAgLyoqIEB0eXBlIHt7cG9vbDogaW1wb3J0KFwiLi4vZGF0YWJhc2UvcG9vbC9iYXNlLmpzXCIpLmRlZmF1bHQsIHJlZ2lzdHJhdGlvbjogaW1wb3J0KFwiLi4vZGF0YWJhc2UvcG9vbC9iYXNlLmpzXCIpLlRlc3RTaGFyZWRDb25uZWN0aW9uUmVnaXN0cmF0aW9ufVtdfSAqL1xuICAgIGNvbnN0IHJlZ2lzdHJhdGlvbnMgPSBbXVxuXG4gICAgZm9yIChjb25zdCBpZGVudGlmaWVyIG9mIE9iamVjdC5rZXlzKGN1cnJlbnRDb25uZWN0aW9ucykpIHtcbiAgICAgIGNvbnN0IHBvb2wgPSBjb25maWd1cmF0aW9uLmdldERhdGFiYXNlUG9vbChpZGVudGlmaWVyKVxuXG4gICAgICAvLyBUZW5hbnQtc2NvcGVkIHBvb2xzIHJlc29sdmUgYSBkaWZmZXJlbnQgY29ubmVjdGlvbiBwZXIgcmVxdWVzdCB0ZW5hbnRcbiAgICAgIC8vICh2aWEgcnVuV2l0aFRlbmFudCksIHNvIGZvcmNpbmcgYSBzaW5nbGUgc2hhcmVkIGNvbm5lY3Rpb24gd291bGQgYnJlYWtcbiAgICAgIC8vIHBlci1yZXF1ZXN0IHRlbmFudCByZXNvbHV0aW9uLiBPbmx5IHNoYXJlIG5vbi10ZW5hbnQgcG9vbHM7IHRoZSB0ZW5hbnRcbiAgICAgIC8vIHBvb2wga2VlcHMgcmVzb2x2aW5nIGl0cyBvd24gY29ubmVjdGlvbiBwZXIgcmVxdWVzdC5cbiAgICAgIGlmIChwb29sLmdldENvbmZpZ3VyYXRpb24oKS50ZW5hbnRPbmx5KSB7XG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGNvbm5lY3Rpb24gPSBjdXJyZW50Q29ubmVjdGlvbnNbaWRlbnRpZmllcl1cblxuICAgICAgY29uc3QgcmVnaXN0cmF0aW9uID0gcG9vbC5zZXRUZXN0U2hhcmVkQ29ubmVjdGlvblByb3ZpZGVyKCgpID0+IHtcbiAgICAgICAgcmV0dXJuIGNvbm5lY3Rpb24uaW5zaWRlVHJhbnNhY3Rpb24oKSA/IGNvbm5lY3Rpb24gOiB1bmRlZmluZWRcbiAgICAgIH0pXG5cbiAgICAgIGlmIChyZWdpc3RyYXRpb24pIHJlZ2lzdHJhdGlvbnMucHVzaCh7cG9vbCwgcmVnaXN0cmF0aW9ufSlcbiAgICB9XG5cbiAgICByZXR1cm4gcmVnaXN0cmF0aW9uc1xuICB9XG5cbiAgLyoqXG4gICAqIENsZWFycyB0aGUgaW4tcHJvY2VzcyB0ZXN0IHNoYXJlZCBjb25uZWN0aW9uIG9uIGV2ZXJ5IGNvbmZpZ3VyZWQgcG9vbC4gSWRlbXBvdGVudCBhbmRcbiAgICogc2FmZSB0byBjYWxsIHdoZW4gbm9uZSB3YXMgc2V0LlxuICAgKiBAcGFyYW0ge3twb29sOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9wb29sL2Jhc2UuanNcIikuZGVmYXVsdCwgcmVnaXN0cmF0aW9uOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9wb29sL2Jhc2UuanNcIikuVGVzdFNoYXJlZENvbm5lY3Rpb25SZWdpc3RyYXRpb259W119IFtyZWdpc3RyYXRpb25zXSAtIExpZmVjeWNsZS1vd25lZCByZWdpc3RyYXRpb25zIHRvIGNsZWFyIGNvbmRpdGlvbmFsbHkuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgY2xlYXJUZXN0U2hhcmVkQ29ubmVjdGlvbnMocmVnaXN0cmF0aW9ucykge1xuICAgIGlmIChyZWdpc3RyYXRpb25zKSB7XG4gICAgICBmb3IgKGNvbnN0IHtwb29sLCByZWdpc3RyYXRpb259IG9mIHJlZ2lzdHJhdGlvbnMpIHtcbiAgICAgICAgcG9vbC5jbGVhclRlc3RTaGFyZWRDb25uZWN0aW9uKHJlZ2lzdHJhdGlvbilcbiAgICAgIH1cbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKVxuXG4gICAgZm9yIChjb25zdCBpZGVudGlmaWVyIG9mIGNvbmZpZ3VyYXRpb24uZ2V0RGF0YWJhc2VJZGVudGlmaWVycygpKSB7XG4gICAgICBjb25maWd1cmF0aW9uLmdldERhdGFiYXNlUG9vbChpZGVudGlmaWVyKS5jbGVhclRlc3RTaGFyZWRDb25uZWN0aW9uKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ2hlY2tzIG91dCBhbmQgcmVnaXN0ZXJzIG9uZSBwaHlzaWNhbCB0ZW5hbnQgdHJhbnNhY3Rpb24gZm9yIHRoZSBjdXJyZW50IGF0dGVtcHQuXG4gICAqIEBwYXJhbSB7e2RhdGFiYXNlSWRlbnRpZmllcjogc3RyaW5nLCB0ZW5hbnQ6IG9iamVjdH19IGFyZ3MgLSBMb2dpY2FsIGlkZW50aWZpZXIgYW5kIHRlbmFudCBkZXNjcmlwdG9yLlxuICAgKiBAcGFyYW0ge1RyYW5zYWN0aW9uYWxUZW5hbnRSZWdpc3RyYXRpb25bXX0gcmVnaXN0cmF0aW9ucyAtIEN1cnJlbnQgYXR0ZW1wdCByZWdpc3RyYXRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIHJlZ2lzdGVyVHJhbnNhY3Rpb25hbFRlbmFudCh7ZGF0YWJhc2VJZGVudGlmaWVyLCB0ZW5hbnQsIC4uLnJlc3RBcmdzfSwgcmVnaXN0cmF0aW9ucykge1xuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG4gICAgaWYgKCFkYXRhYmFzZUlkZW50aWZpZXIpIHRocm93IG5ldyBFcnJvcihcInJlZ2lzdGVyVHJhbnNhY3Rpb25hbFRlbmFudCByZXF1aXJlcyBhIGRhdGFiYXNlSWRlbnRpZmllclwiKVxuICAgIGlmICghdGVuYW50KSB0aHJvdyBuZXcgRXJyb3IoXCJyZWdpc3RlclRyYW5zYWN0aW9uYWxUZW5hbnQgcmVxdWlyZXMgYSB0ZW5hbnRcIilcblxuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKVxuICAgIGNvbnN0IHBvb2wgPSBjb25maWd1cmF0aW9uLmdldERhdGFiYXNlUG9vbChkYXRhYmFzZUlkZW50aWZpZXIpXG4gICAgY29uc3QgZGF0YWJhc2VDb25maWd1cmF0aW9uID0gY29uZmlndXJhdGlvbi5yZXNvbHZlRGF0YWJhc2VDb25maWd1cmF0aW9uKGRhdGFiYXNlSWRlbnRpZmllciwgdGVuYW50KVxuICAgIGlmICghZGF0YWJhc2VDb25maWd1cmF0aW9uLnRlbmFudE9ubHkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgcmVnaXN0ZXJUcmFuc2FjdGlvbmFsVGVuYW50IHJlcXVpcmVzIGEgdGVuYW50T25seSBkYXRhYmFzZTogJHtkYXRhYmFzZUlkZW50aWZpZXJ9YClcbiAgICB9XG4gICAgY29uc3QgcmV1c2VLZXkgPSBwb29sLmdldENvbmZpZ3VyYXRpb25SZXVzZUtleShkYXRhYmFzZUNvbmZpZ3VyYXRpb24pXG4gICAgaWYgKHJlZ2lzdHJhdGlvbnMuc29tZSgocmVnaXN0cmF0aW9uKSA9PiByZWdpc3RyYXRpb24ucG9vbCA9PT0gcG9vbCAmJiByZWdpc3RyYXRpb24ucmV1c2VLZXkgPT09IHJldXNlS2V5KSkgcmV0dXJuXG5cbiAgICAvKiogQHR5cGUge1RyYW5zYWN0aW9uYWxUZW5hbnRSZWdpc3RyYXRpb259ICovXG4gICAgY29uc3QgcmVnaXN0cmF0aW9uID0ge1xuICAgICAgY29ubmVjdGlvbjogdW5kZWZpbmVkLFxuICAgICAgcG9vbCxcbiAgICAgIHJldXNlS2V5LFxuICAgICAgcmV2b2tlZDogZmFsc2UsXG4gICAgICBzaGFyZWRSZWdpc3RyYXRpb246IHVuZGVmaW5lZFxuICAgIH1cblxuICAgIHJlZ2lzdHJhdGlvbnMucHVzaChyZWdpc3RyYXRpb24pXG4gICAgcmVnaXN0cmF0aW9uLmNoZWNrb3V0UHJvbWlzZSA9IHBvb2xcbiAgICAgIC5jaGVja291dEZvckNvbmZpZ3VyYXRpb24oZGF0YWJhc2VDb25maWd1cmF0aW9uLCB7bmFtZTogXCJUcmFuc2FjdGlvbmFsIHRlbmFudCB0ZXN0IHJlZ2lzdHJhdGlvblwifSlcbiAgICAgIC50aGVuKFxuICAgICAgICAoY29ubmVjdGlvbikgPT4gKHtjb25uZWN0aW9uLCBlcnJvcjogdW5kZWZpbmVkfSksXG4gICAgICAgIChlcnJvcikgPT4gKHtcbiAgICAgICAgICBjb25uZWN0aW9uOiB1bmRlZmluZWQsXG4gICAgICAgICAgZXJyb3I6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihcIlRyYW5zYWN0aW9uYWwgdGVuYW50IGNvbm5lY3Rpb24gY2hlY2tvdXQgZmFpbGVkXCIsIHtjYXVzZTogZXJyb3J9KVxuICAgICAgICB9KVxuICAgICAgKVxuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGNoZWNrb3V0T3V0Y29tZSA9IGF3YWl0IHJlZ2lzdHJhdGlvbi5jaGVja291dFByb21pc2VcblxuICAgICAgaWYgKGNoZWNrb3V0T3V0Y29tZS5lcnJvcikgdGhyb3cgY2hlY2tvdXRPdXRjb21lLmVycm9yXG4gICAgICBpZiAoIWNoZWNrb3V0T3V0Y29tZS5jb25uZWN0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJUcmFuc2FjdGlvbmFsIHRlbmFudCBjb25uZWN0aW9uIGNoZWNrb3V0IHJldHVybmVkIG5vIGNvbm5lY3Rpb25cIilcbiAgICAgIHJlZ2lzdHJhdGlvbi5jb25uZWN0aW9uID0gY2hlY2tvdXRPdXRjb21lLmNvbm5lY3Rpb25cbiAgICAgIGlmIChyZWdpc3RyYXRpb24ucmV2b2tlZCkgdGhyb3cgbmV3IEVycm9yKFwiVHJhbnNhY3Rpb25hbCB0ZW5hbnQgdGVzdCByZWdpc3RyYXRpb24gYXR0ZW1wdCBpcyBubyBsb25nZXIgYWN0aXZlXCIpXG5cbiAgICAgIGF3YWl0IHJlZ2lzdHJhdGlvbi5jb25uZWN0aW9uLnN0YXJ0VHJhbnNhY3Rpb24oKVxuICAgICAgaWYgKHJlZ2lzdHJhdGlvbi5yZXZva2VkKSB0aHJvdyBuZXcgRXJyb3IoXCJUcmFuc2FjdGlvbmFsIHRlbmFudCB0ZXN0IHJlZ2lzdHJhdGlvbiBhdHRlbXB0IGlzIG5vIGxvbmdlciBhY3RpdmVcIilcblxuICAgICAgY29uc3Qgc2hhcmVkUmVnaXN0cmF0aW9uID0gcG9vbC5zZXRUZXN0U2hhcmVkQ29ubmVjdGlvbkZvckNvbmZpZ3VyYXRpb24ocmVnaXN0cmF0aW9uLmNvbm5lY3Rpb24sIHJldXNlS2V5KVxuICAgICAgaWYgKCFzaGFyZWRSZWdpc3RyYXRpb24pIHRocm93IG5ldyBFcnJvcihgRGF0YWJhc2UgcG9vbCBkb2VzIG5vdCBzdXBwb3J0IHRyYW5zYWN0aW9uYWwgdGVuYW50IHRlc3QgY29ubmVjdGlvbnM6ICR7ZGF0YWJhc2VJZGVudGlmaWVyfWApXG4gICAgICByZWdpc3RyYXRpb24uc2hhcmVkUmVnaXN0cmF0aW9uID0gc2hhcmVkUmVnaXN0cmF0aW9uXG4gICAgICBpZiAocmVnaXN0cmF0aW9uLnJldm9rZWQpIHtcbiAgICAgICAgcG9vbC5jbGVhclRlc3RTaGFyZWRDb25uZWN0aW9uKHNoYXJlZFJlZ2lzdHJhdGlvbilcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiVHJhbnNhY3Rpb25hbCB0ZW5hbnQgdGVzdCByZWdpc3RyYXRpb24gYXR0ZW1wdCBpcyBubyBsb25nZXIgYWN0aXZlXCIpXG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHJlZ2lzdHJhdGlvbi5yZXZva2VkID0gdHJ1ZVxuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5jbGVhbnVwVHJhbnNhY3Rpb25hbFRlbmFudHMoW3JlZ2lzdHJhdGlvbl0sIHtkaXNjYXJkOiByZWdpc3RyYXRpb24uZGlzY2FyZE9uQ2xlYW51cCA9PT0gdHJ1ZX0pXG4gICAgICB9IGNhdGNoIChjbGVhbnVwRXJyb3IpIHtcbiAgICAgICAgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKFtlcnJvciwgY2xlYW51cEVycm9yXSwgXCJGYWlsZWQgdG8gcmVnaXN0ZXIgYW5kIGNsZWFuIHVwIGEgdHJhbnNhY3Rpb25hbCB0ZW5hbnQgdGVzdCBjb25uZWN0aW9uXCIsIHtjYXVzZTogY2xlYW51cEVycm9yfSlcbiAgICAgIH1cbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJldm9rZXMgYXR0ZW1wdCByZWdpc3RyYXRpb25zIGJlZm9yZSByb2xsaW5nIGJhY2sgYW5kIHJlbGVhc2luZyB0aGVpciBjb25uZWN0aW9ucy5cbiAgICogQHBhcmFtIHtUcmFuc2FjdGlvbmFsVGVuYW50UmVnaXN0cmF0aW9uW119IHJlZ2lzdHJhdGlvbnMgLSBBdHRlbXB0IHJlZ2lzdHJhdGlvbnMuXG4gICAqIEBwYXJhbSB7e2Rpc2NhcmQ/OiBib29sZWFufX0gW29wdGlvbnNdIC0gV2hldGhlciBjb25uZWN0aW9ucyBtdXN0IGJlIGRpc2NhcmRlZCBpbnN0ZWFkIG9mIHJldHVybmVkIHRvIHRoZSBwb29sLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIGNsZWFudXBUcmFuc2FjdGlvbmFsVGVuYW50cyhyZWdpc3RyYXRpb25zLCB7ZGlzY2FyZCA9IGZhbHNlfSA9IHt9KSB7XG4gICAgZm9yIChjb25zdCByZWdpc3RyYXRpb24gb2YgcmVnaXN0cmF0aW9ucykge1xuICAgICAgcmVnaXN0cmF0aW9uLnJldm9rZWQgPSB0cnVlXG4gICAgICBpZiAoZGlzY2FyZCkgcmVnaXN0cmF0aW9uLmRpc2NhcmRPbkNsZWFudXAgPSB0cnVlXG4gICAgICBpZiAocmVnaXN0cmF0aW9uLnNoYXJlZFJlZ2lzdHJhdGlvbikgcmVnaXN0cmF0aW9uLnBvb2wuY2xlYXJUZXN0U2hhcmVkQ29ubmVjdGlvbihyZWdpc3RyYXRpb24uc2hhcmVkUmVnaXN0cmF0aW9uKVxuICAgIH1cbiAgICBjb25zdCBjbGVhbnVwUmVzdWx0cyA9IGF3YWl0IFByb21pc2UuYWxsU2V0dGxlZChbLi4ucmVnaXN0cmF0aW9uc10ucmV2ZXJzZSgpLm1hcCgocmVnaXN0cmF0aW9uKSA9PiB7XG4gICAgICByZWdpc3RyYXRpb24uY2xlYW51cFByb21pc2UgPz89IHRoaXMuY2xlYW51cFRyYW5zYWN0aW9uYWxUZW5hbnRSZWdpc3RyYXRpb24ocmVnaXN0cmF0aW9uKVxuXG4gICAgICByZXR1cm4gcmVnaXN0cmF0aW9uLmNsZWFudXBQcm9taXNlXG4gICAgfSkpXG4gICAgY29uc3QgZXJyb3JzID0gY2xlYW51cFJlc3VsdHNcbiAgICAgIC5maWx0ZXIoKHJlc3VsdCkgPT4gcmVzdWx0LnN0YXR1cyA9PT0gXCJyZWplY3RlZFwiKVxuICAgICAgLm1hcCgocmVzdWx0KSA9PiByZXN1bHQucmVhc29uKVxuXG4gICAgaWYgKGVycm9ycy5sZW5ndGggPT09IDEpIHRocm93IGVycm9yc1swXVxuICAgIGlmIChlcnJvcnMubGVuZ3RoID4gMSkgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKGVycm9ycywgXCJGYWlsZWQgdG8gY2xlYW4gdXAgdHJhbnNhY3Rpb25hbCB0ZW5hbnQgdGVzdCBjb25uZWN0aW9uc1wiKVxuICB9XG5cbiAgLyoqXG4gICAqIENsZWFucyBvbmUgYXR0ZW1wdCByZWdpc3RyYXRpb24gZXhhY3RseSBvbmNlLCBpbmNsdWRpbmcgYSBjaGVja291dCB0aGF0IHdhcyBzdGlsbCBwZW5kaW5nIGF0IHJldm9jYXRpb24uXG4gICAqIEBwYXJhbSB7VHJhbnNhY3Rpb25hbFRlbmFudFJlZ2lzdHJhdGlvbn0gcmVnaXN0cmF0aW9uIC0gQXR0ZW1wdC1vd25lZCByZWdpc3RyYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHJvbGxiYWNrIGFuZCByZWxlYXNlIG9yIHF1YXJhbnRpbmUuXG4gICAqL1xuICBhc3luYyBjbGVhbnVwVHJhbnNhY3Rpb25hbFRlbmFudFJlZ2lzdHJhdGlvbihyZWdpc3RyYXRpb24pIHtcbiAgICBsZXQgY29ubmVjdGlvbiA9IHJlZ2lzdHJhdGlvbi5jb25uZWN0aW9uXG5cbiAgICBpZiAoIWNvbm5lY3Rpb24gJiYgcmVnaXN0cmF0aW9uLmNoZWNrb3V0UHJvbWlzZSkge1xuICAgICAgY29uc3QgY2hlY2tvdXRPdXRjb21lID0gYXdhaXQgcmVnaXN0cmF0aW9uLmNoZWNrb3V0UHJvbWlzZVxuXG4gICAgICBpZiAoY2hlY2tvdXRPdXRjb21lLmVycm9yKSByZXR1cm5cbiAgICAgIGNvbm5lY3Rpb24gPSBjaGVja291dE91dGNvbWUuY29ubmVjdGlvblxuICAgICAgcmVnaXN0cmF0aW9uLmNvbm5lY3Rpb24gPSBjb25uZWN0aW9uXG4gICAgfVxuICAgIGlmICghY29ubmVjdGlvbikgcmV0dXJuXG5cbiAgICBjb25zdCBlcnJvcnMgPSBbXVxuXG4gICAgdHJ5IHtcbiAgICAgIGlmIChjb25uZWN0aW9uLmluc2lkZVRyYW5zYWN0aW9uKCkpIGF3YWl0IGNvbm5lY3Rpb24ucm9sbGJhY2tUcmFuc2FjdGlvbigpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGVycm9ycy5wdXNoKGVycm9yKVxuICAgIH0gZmluYWxseSB7XG4gICAgICB0cnkge1xuICAgICAgICBpZiAocmVnaXN0cmF0aW9uLmRpc2NhcmRPbkNsZWFudXApIHtcbiAgICAgICAgICBhd2FpdCByZWdpc3RyYXRpb24ucG9vbC5kaXNjYXJkKGNvbm5lY3Rpb24pXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgYXdhaXQgcmVnaXN0cmF0aW9uLnBvb2wuY2hlY2tpbihjb25uZWN0aW9uKVxuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBlcnJvcnMucHVzaChlcnJvcilcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKGVycm9ycy5sZW5ndGggPT09IDEpIHRocm93IGVycm9yc1swXVxuICAgIGlmIChlcnJvcnMubGVuZ3RoID4gMSkgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKGVycm9ycywgXCJGYWlsZWQgdG8gY2xlYW4gdXAgYSB0cmFuc2FjdGlvbmFsIHRlbmFudCB0ZXN0IGNvbm5lY3Rpb25cIilcbiAgfVxuXG4gIC8qKlxuICAgKiBTZWxlY3RzIHRoZSBjdXJyZW50IG5vbi10ZW5hbnQgY29ubmVjdGlvbnMgZWxpZ2libGUgZm9yIHNoYXJlZCB0cmFuc2FjdGlvbiB3b3JrLlxuICAgKiBAcGFyYW0ge3t0cmFuc2FjdGlvbnNPbmx5OiBib29sZWFufX0gYXJncyAtIFNlbGVjdGlvbiBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQ+fSAtIEVsaWdpYmxlIGNvbm5lY3Rpb25zIGJ5IGlkZW50aWZpZXIuXG4gICAqL1xuICBzaGFyZWRUcmFuc2FjdGlvbkNvbm5lY3Rpb25zKHt0cmFuc2FjdGlvbnNPbmx5fSkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKVxuICAgIGNvbnN0IGN1cnJlbnRDb25uZWN0aW9ucyA9IGNvbmZpZ3VyYXRpb24uZ2V0Q3VycmVudENvbm5lY3Rpb25zKClcbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0Pn0gKi9cbiAgICBjb25zdCBjb25uZWN0aW9ucyA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IFtpZGVudGlmaWVyLCBjb25uZWN0aW9uXSBvZiBPYmplY3QuZW50cmllcyhjdXJyZW50Q29ubmVjdGlvbnMpKSB7XG4gICAgICBjb25zdCBwb29sID0gY29uZmlndXJhdGlvbi5nZXREYXRhYmFzZVBvb2woaWRlbnRpZmllcilcblxuICAgICAgaWYgKHBvb2wuZ2V0Q29uZmlndXJhdGlvbigpLnRlbmFudE9ubHkpIGNvbnRpbnVlXG4gICAgICBpZiAodHJhbnNhY3Rpb25zT25seSAmJiAhY29ubmVjdGlvbi5pbnNpZGVUcmFuc2FjdGlvbigpKSBjb250aW51ZVxuICAgICAgY29ubmVjdGlvbnNbaWRlbnRpZmllcl0gPSBjb25uZWN0aW9uXG4gICAgfVxuXG4gICAgcmV0dXJuIGNvbm5lY3Rpb25zXG4gIH1cblxuICAvKipcbiAgICogSW5zdGFsbHMgcGh5c2ljYWwtY29ubmVjdGlvbiBjb29yZGluYXRpb24gYmVmb3JlIGEgdHJhbnNhY3Rpb24tb3BlbmluZyBob29rXG4gICAqIGNhbiBleHBvc2UgdGhlIHNoYXJlZCBjb25uZWN0aW9uIHRvIGEgbG9uZy1saXZlZCBpbi1wcm9jZXNzIHNlcnZpY2UuXG4gICAqIENoaWxkLXByb2Nlc3MgY29vcmRpbmF0ZXMgcmVtYWluIHVucHVibGlzaGVkIHVudGlsIHRoZSB0cmFuc2FjdGlvbiBleGlzdHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFNoYXJlZFRyYW5zYWN0aW9uQnJva2VyUmVnaXN0cmF0aW9uIHwgdW5kZWZpbmVkPn0gLSBQcmVwYXJlZCBjb29yZGluYXRvci5cbiAgICovXG4gIGFzeW5jIHByZXBhcmVTaGFyZWRUcmFuc2FjdGlvbkJyb2tlcigpIHtcbiAgICBjb25zdCBjb25uZWN0aW9ucyA9IHRoaXMuc2hhcmVkVHJhbnNhY3Rpb25Db25uZWN0aW9ucyh7dHJhbnNhY3Rpb25zT25seTogZmFsc2V9KVxuXG4gICAgaWYgKE9iamVjdC5rZXlzKGNvbm5lY3Rpb25zKS5sZW5ndGggPT09IDApIHJldHVybiB1bmRlZmluZWRcblxuICAgIHJldHVybiB7XG4gICAgICBicm9rZXI6IGF3YWl0IFNoYXJlZFRyYW5zYWN0aW9uQnJva2VyLnN0YXJ0KHtjb25uZWN0aW9uc30pLFxuICAgICAgZW52aXJvbm1lbnRQdWJsaXNoZWQ6IGZhbHNlLFxuICAgICAgcHJldmlvdXNFbnZpcm9ubWVudDogdW5kZWZpbmVkXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrcyB3aGV0aGVyIGEgcHJlcGFyZWQgYnJva2VyIGNvb3JkaW5hdGVzIGV4YWN0bHkgdGhlIHNlbGVjdGVkIHBoeXNpY2FsIGNvbm5lY3Rpb25zLlxuICAgKiBAcGFyYW0ge1NoYXJlZFRyYW5zYWN0aW9uQnJva2VyUmVnaXN0cmF0aW9uIHwgdW5kZWZpbmVkfSByZWdpc3RyYXRpb24gLSBQcmVwYXJlZCBjb29yZGluYXRvci5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdD59IGNvbm5lY3Rpb25zIC0gU2VsZWN0ZWQgY29ubmVjdGlvbnMuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGlkZW50aWZpZXIgc2V0IGFuZCBwaHlzaWNhbCBjb25uZWN0aW9ucyBtYXRjaCBleGFjdGx5LlxuICAgKi9cbiAgc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJNYXRjaGVzQ29ubmVjdGlvbnMocmVnaXN0cmF0aW9uLCBjb25uZWN0aW9ucykge1xuICAgIGNvbnN0IGlkZW50aWZpZXJzID0gT2JqZWN0LmtleXMoY29ubmVjdGlvbnMpXG5cbiAgICBpZiAoIXJlZ2lzdHJhdGlvbiB8fCBpZGVudGlmaWVycy5sZW5ndGggPT09IDApIHJldHVybiBmYWxzZVxuICAgIGlmIChPYmplY3Qua2V5cyhyZWdpc3RyYXRpb24uYnJva2VyLmNvbm5lY3Rpb25zKS5sZW5ndGggIT09IGlkZW50aWZpZXJzLmxlbmd0aCkgcmV0dXJuIGZhbHNlXG5cbiAgICBmb3IgKGNvbnN0IFtpZGVudGlmaWVyLCBjb25uZWN0aW9uXSBvZiBPYmplY3QuZW50cmllcyhjb25uZWN0aW9ucykpIHtcbiAgICAgIGlmIChyZWdpc3RyYXRpb24uYnJva2VyLmNvbm5lY3Rpb25zW2lkZW50aWZpZXJdICE9PSBjb25uZWN0aW9uKSByZXR1cm4gZmFsc2VcbiAgICB9XG5cbiAgICByZXR1cm4gdHJ1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFN0YXJ0cyBhIGNhcGFiaWxpdHktc2NvcGVkIGJyb2tlciBmb3IgdGhlIGFjdGl2ZSBub24tdGVuYW50IHBoeXNpY2FsXG4gICAqIHRyYW5zYWN0aW9uIGNvbm5lY3Rpb25zLiBObyBicm9rZXIvZW52IGlzIGluc3RhbGxlZCBmb3IgdHJ1bmNhdGlvbi1vbmx5IG9yXG4gICAqIG90aGVyIHRyYW5zYWN0aW9uLWRpc2FibGVkIGF0dGVtcHRzLlxuICAgKiBAcGFyYW0ge1NoYXJlZFRyYW5zYWN0aW9uQnJva2VyUmVnaXN0cmF0aW9ufSBbcHJlcGFyZWRSZWdpc3RyYXRpb25dIC0gQ29vcmRpbmF0b3IgcHJlcGFyZWQgYmVmb3JlIGhvb2tzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0Pn0gW3NlbGVjdGVkQ29ubmVjdGlvbnNdIC0gUG9zdC1ob29rIGFjdGl2ZSBjb25uZWN0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8U2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJSZWdpc3RyYXRpb24gfCB1bmRlZmluZWQ+fSAtIEF0dGVtcHQgcmVnaXN0cmF0aW9uLlxuICAgKi9cbiAgYXN5bmMgc3RhcnRTaGFyZWRUcmFuc2FjdGlvbkJyb2tlcihwcmVwYXJlZFJlZ2lzdHJhdGlvbiwgc2VsZWN0ZWRDb25uZWN0aW9ucykge1xuICAgIGNvbnN0IGNvbm5lY3Rpb25zID0gc2VsZWN0ZWRDb25uZWN0aW9ucyB8fCB0aGlzLnNoYXJlZFRyYW5zYWN0aW9uQ29ubmVjdGlvbnMoe3RyYW5zYWN0aW9uc09ubHk6IHRydWV9KVxuXG4gICAgY29uc3QgZGF0YWJhc2VJZGVudGlmaWVycyA9IE9iamVjdC5rZXlzKGNvbm5lY3Rpb25zKVxuICAgIGlmIChkYXRhYmFzZUlkZW50aWZpZXJzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgYXdhaXQgdGhpcy5zdG9wU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXIocHJlcGFyZWRSZWdpc3RyYXRpb24pXG4gICAgICByZXR1cm4gdW5kZWZpbmVkXG4gICAgfVxuXG4gICAgbGV0IGJyb2tlclxuXG4gICAgaWYgKHByZXBhcmVkUmVnaXN0cmF0aW9uICYmIHRoaXMuc2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJNYXRjaGVzQ29ubmVjdGlvbnMocHJlcGFyZWRSZWdpc3RyYXRpb24sIGNvbm5lY3Rpb25zKSkge1xuICAgICAgYnJva2VyID0gcHJlcGFyZWRSZWdpc3RyYXRpb24uYnJva2VyXG4gICAgfSBlbHNlIHtcbiAgICAgIGF3YWl0IHRoaXMuc3RvcFNoYXJlZFRyYW5zYWN0aW9uQnJva2VyKHByZXBhcmVkUmVnaXN0cmF0aW9uKVxuICAgICAgYnJva2VyID0gYXdhaXQgU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXIuc3RhcnQoe2Nvbm5lY3Rpb25zfSlcbiAgICB9XG5cbiAgICBjb25zdCBwcmV2aW91c0Vudmlyb25tZW50ID0gcHJvY2Vzcy5lbnZbU0hBUkVEX1RSQU5TQUNUSU9OX0JST0tFUl9FTlZdXG4gICAgcHJvY2Vzcy5lbnZbU0hBUkVEX1RSQU5TQUNUSU9OX0JST0tFUl9FTlZdID0gQnVmZmVyLmZyb20oSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgYWRkcmVzczogYnJva2VyLmFkZHJlc3MoKSxcbiAgICAgIGNhcGFiaWxpdHk6IGJyb2tlci5jYXBhYmlsaXR5KCksXG4gICAgICBkYXRhYmFzZUlkZW50aWZpZXJzLFxuICAgICAgZXhwZWN0ZWQ6IHRydWVcbiAgICB9KSkudG9TdHJpbmcoXCJiYXNlNjR1cmxcIilcblxuICAgIHJldHVybiB7YnJva2VyLCBlbnZpcm9ubWVudFB1Ymxpc2hlZDogdHJ1ZSwgcHJldmlvdXNFbnZpcm9ubWVudH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXZva2VzIGFuIGF0dGVtcHQgYnJva2VyIGJlZm9yZSBkYXRhYmFzZSByb2xsYmFjayBob29rcyBydW4gYW5kIHJlc3RvcmVzXG4gICAqIHRoZSBjYWxsZXIncyBlbnZpcm9ubWVudCBzbyBsYXRlciBwb29sZWQvc3Bhd25lZCBjaGlsZHJlbiBjYW5ub3QgaW5oZXJpdCBpdC5cbiAgICogQHBhcmFtIHtTaGFyZWRUcmFuc2FjdGlvbkJyb2tlclJlZ2lzdHJhdGlvbiB8IHVuZGVmaW5lZH0gcmVnaXN0cmF0aW9uIC0gQXR0ZW1wdCByZWdpc3RyYXRpb24uXG4gICAqL1xuICBhc3luYyBzdG9wU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXIocmVnaXN0cmF0aW9uKSB7XG4gICAgaWYgKCFyZWdpc3RyYXRpb24pIHJldHVyblxuXG4gICAgaWYgKHJlZ2lzdHJhdGlvbi5lbnZpcm9ubWVudFB1Ymxpc2hlZCkge1xuICAgICAgaWYgKHJlZ2lzdHJhdGlvbi5wcmV2aW91c0Vudmlyb25tZW50ID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgZGVsZXRlIHByb2Nlc3MuZW52W1NIQVJFRF9UUkFOU0FDVElPTl9CUk9LRVJfRU5WXVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcHJvY2Vzcy5lbnZbU0hBUkVEX1RSQU5TQUNUSU9OX0JST0tFUl9FTlZdID0gcmVnaXN0cmF0aW9uLnByZXZpb3VzRW52aXJvbm1lbnRcbiAgICAgIH1cbiAgICB9XG4gICAgYXdhaXQgcmVnaXN0cmF0aW9uLmJyb2tlci5jbG9zZSgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXF1ZXN0IGNsaWVudC5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmVxdWVzdENsaWVudD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgcmVxdWVzdCBjbGllbnQuXG4gICAqL1xuICBhc3luYyByZXF1ZXN0Q2xpZW50KCkge1xuICAgIGlmICghdGhpcy5fcmVxdWVzdENsaWVudCkge1xuICAgICAgdGhpcy5fcmVxdWVzdENsaWVudCA9IG5ldyBSZXF1ZXN0Q2xpZW50KClcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fcmVxdWVzdENsaWVudFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaW1wb3J0IHRlc3QgZmlsZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBpbXBvcnRUZXN0RmlsZXMoKSB7XG4gICAgY29uc3QgZW52aXJvbm1lbnRIYW5kbGVyID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKClcblxuICAgIGlmICghdGhpcy5fcHJvZmlsZXIpIHtcbiAgICAgIGF3YWl0IGVudmlyb25tZW50SGFuZGxlci5pbXBvcnRUZXN0RmlsZXModGhpcy5nZXRUZXN0RmlsZXMoKSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGZvciAoY29uc3QgdGVzdEZpbGUgb2YgdGhpcy5nZXRUZXN0RmlsZXMoKSkge1xuICAgICAgY29uc3QgZXhpc3RpbmdSZWdpc3RyYXRpb25zID0gdGhpcy50ZXN0UmVnaXN0cmF0aW9uT2JqZWN0cygpXG5cbiAgICAgIGF3YWl0IHRoaXMuX3Byb2ZpbGVyLm1lYXN1cmVQaGFzZShcImltcG9ydHNcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCBlbnZpcm9ubWVudEhhbmRsZXIuaW1wb3J0VGVzdEZpbGVzKFt0ZXN0RmlsZV0pXG4gICAgICB9LCB7ZmlsZVBhdGg6IHRlc3RGaWxlfSlcbiAgICAgIHRoaXMuYXNzaWduVGVzdFJlZ2lzdHJhdGlvbk93bmVyc2hpcChleGlzdGluZ1JlZ2lzdHJhdGlvbnMsIHRlc3RGaWxlKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDb2xsZWN0cyBwYWNrYWdlIGRlY2xhcmF0aW9uIG9iamVjdHMgYnkgaWRlbnRpdHkuXG4gICAqIEBwYXJhbSB7U2V0PFBhY2thZ2VSZWdpc3RyYXRpb24+fSBbcmVnaXN0cmF0aW9uc10gLSBBY2N1bXVsYXRlZCBpZGVudGl0aWVzLlxuICAgKiBAcmV0dXJucyB7U2V0PFBhY2thZ2VSZWdpc3RyYXRpb24+fSAtIFJlZ2lzdHJhdGlvbiBpZGVudGl0aWVzLlxuICAgKi9cbiAgdGVzdFJlZ2lzdHJhdGlvbk9iamVjdHMocmVnaXN0cmF0aW9ucyA9IG5ldyBTZXQoKSkge1xuICAgIGNvbnN0IHZpc2l0ID0gKC8qKiBAdHlwZSB7UGFja2FnZVN1aXRlRGVjbGFyYXRpb259ICovIHN1aXRlKSA9PiB7XG4gICAgICByZWdpc3RyYXRpb25zLmFkZChzdWl0ZSlcbiAgICAgIGZvciAoY29uc3QgaG9vayBvZiBbLi4uc3VpdGUuaG9va3MuYmVmb3JlQWxsLCAuLi5zdWl0ZS5ob29rcy5iZWZvcmVFYWNoLCAuLi5zdWl0ZS5ob29rcy5hZnRlckVhY2gsIC4uLnN1aXRlLmhvb2tzLmFmdGVyQWxsXSkge1xuICAgICAgICByZWdpc3RyYXRpb25zLmFkZChob29rKVxuICAgICAgfVxuICAgICAgZm9yIChjb25zdCB0ZXN0RGVjbGFyYXRpb24gb2Ygc3VpdGUudGVzdHMpIHJlZ2lzdHJhdGlvbnMuYWRkKHRlc3REZWNsYXJhdGlvbilcbiAgICAgIGZvciAoY29uc3QgY2hpbGRTdWl0ZSBvZiBzdWl0ZS5zdWl0ZXMpIHZpc2l0KGNoaWxkU3VpdGUpXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBzdWl0ZSBvZiB0aGlzLmdldFRlc3RDb250ZXh0KCkucmVnaXN0cnkuc3VpdGVzKSB2aXNpdChzdWl0ZSlcblxuICAgIHJldHVybiByZWdpc3RyYXRpb25zXG4gIH1cblxuICAvKipcbiAgICogQXNzaWducyBkZXRlcm1pbmlzdGljIG93bmVyc2hpcCB0byBwYWNrYWdlIGRlY2xhcmF0aW9ucyBhZGRlZCBieSBvbmUgZW50cnkgZmlsZS5cbiAgICogQHBhcmFtIHtTZXQ8UGFja2FnZVJlZ2lzdHJhdGlvbj59IHByZXZpb3VzUmVnaXN0cmF0aW9ucyAtIElkZW50aXRpZXMgcHJlc2VudCBiZWZvcmUgaW1wb3J0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gb3duZXJGaWxlUGF0aCAtIEltcG9ydGluZyBlbnRyeSBmaWxlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGFzc2lnblRlc3RSZWdpc3RyYXRpb25Pd25lcnNoaXAocHJldmlvdXNSZWdpc3RyYXRpb25zLCBvd25lckZpbGVQYXRoKSB7XG4gICAgZm9yIChjb25zdCByZWdpc3RyYXRpb24gb2YgdGhpcy50ZXN0UmVnaXN0cmF0aW9uT2JqZWN0cygpKSB7XG4gICAgICBpZiAoIXByZXZpb3VzUmVnaXN0cmF0aW9ucy5oYXMocmVnaXN0cmF0aW9uKSkgdGhpcy5fZGVjbGFyYXRpb25Pd25lcnMuc2V0KHJlZ2lzdHJhdGlvbiwgb3duZXJGaWxlUGF0aClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyBmYWlsZWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgZmFpbGVkLlxuICAgKi9cbiAgaXNGYWlsZWQoKSB7IHJldHVybiB0aGlzLl9mYWlsZWRUZXN0cyAhPT0gdW5kZWZpbmVkICYmICh0aGlzLl9mYWlsZWRUZXN0cyA+IDAgfHwgdGhpcy5fcGFja2FnZVJlc3VsdD8uc3RhdHVzID09PSBcImZhaWxlZFwiKSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGZhaWxlZCB0ZXN0cy5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBUaGUgZmFpbGVkIHRlc3RzLlxuICAgKi9cbiAgZ2V0RmFpbGVkVGVzdHMoKSB7XG4gICAgaWYgKHRoaXMuX2ZhaWxlZFRlc3RzID09PSB1bmRlZmluZWQpIHRocm93IG5ldyBFcnJvcihcIlRlc3RzIGhhc24ndCBiZWVuIHJ1biB5ZXRcIilcblxuICAgIHJldHVybiB0aGlzLl9mYWlsZWRUZXN0c1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGZhaWxlZCB0ZXN0IGRldGFpbHMuXG4gICAqIEByZXR1cm5zIHtGYWlsZWRUZXN0RGV0YWlsW119IC0gRmFpbGVkIHRlc3QgZGV0YWlscy5cbiAgICovXG4gIGdldEZhaWxlZFRlc3REZXRhaWxzKCkge1xuICAgIHJldHVybiB0aGlzLl9mYWlsZWRUZXN0RGV0YWlsc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcGVyc2lzdCBmYWlsZWQgdGVzdCBjb25zb2xlIG91dHB1dHMgdG8gYXNzZXRzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5hc3NldHNQYXRoXSAtIEFzc2V0cyBkaXJlY3RvcnkgcGF0aC5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fSAtIFdyaXR0ZW4gbG9nIGZpbGUgcGF0aHMuXG4gICAqL1xuICBhc3luYyBwZXJzaXN0RmFpbGVkVGVzdENvbnNvbGVPdXRwdXRzVG9Bc3NldHMoe2Fzc2V0c1BhdGggPSBwYXRoLmpvaW4ocHJvY2Vzcy5jd2QoKSwgXCJ0bXAvc2NyZWVuc2hvdHNcIil9ID0ge30pIHtcbiAgICBjb25zdCBmYWlsZWRUZXN0RGV0YWlscyA9IHRoaXMuZ2V0RmFpbGVkVGVzdERldGFpbHMoKVxuICAgIGNvbnN0IHdyaXR0ZW5Mb2dQYXRocyA9IFtdXG4gICAgbGV0IGNyZWF0ZWREaXJlY3RvcnkgPSBmYWxzZVxuXG4gICAgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IGZhaWxlZFRlc3REZXRhaWxzLmxlbmd0aDsgaW5kZXgrKykge1xuICAgICAgY29uc3QgZmFpbGVkVGVzdERldGFpbCA9IGZhaWxlZFRlc3REZXRhaWxzW2luZGV4XVxuICAgICAgY29uc3QgY29uc29sZU91dHB1dCA9IGZhaWxlZFRlc3REZXRhaWwuY29uc29sZU91dHB1dFxuXG4gICAgICBpZiAoIWNvbnNvbGVPdXRwdXQpIGNvbnRpbnVlXG5cbiAgICAgIGlmICghY3JlYXRlZERpcmVjdG9yeSkge1xuICAgICAgICBhd2FpdCBmcy5ta2Rpcihhc3NldHNQYXRoLCB7cmVjdXJzaXZlOiB0cnVlfSlcbiAgICAgICAgY3JlYXRlZERpcmVjdG9yeSA9IHRydWVcbiAgICAgIH1cblxuICAgICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKVxuICAgICAgY29uc3QgdGltZXN0YW1wID0gW1xuICAgICAgICBTdHJpbmcobm93LmdldEZ1bGxZZWFyKCkpLFxuICAgICAgICBTdHJpbmcobm93LmdldE1vbnRoKCkgKyAxKS5wYWRTdGFydCgyLCBcIjBcIiksXG4gICAgICAgIFN0cmluZyhub3cuZ2V0RGF0ZSgpKS5wYWRTdGFydCgyLCBcIjBcIiksXG4gICAgICAgIFN0cmluZyhub3cuZ2V0SG91cnMoKSkucGFkU3RhcnQoMiwgXCIwXCIpLFxuICAgICAgICBTdHJpbmcobm93LmdldE1pbnV0ZXMoKSkucGFkU3RhcnQoMiwgXCIwXCIpLFxuICAgICAgICBTdHJpbmcobm93LmdldFNlY29uZHMoKSkucGFkU3RhcnQoMiwgXCIwXCIpLFxuICAgICAgICBTdHJpbmcobm93LmdldE1pbGxpc2Vjb25kcygpKS5wYWRTdGFydCgzLCBcIjBcIilcbiAgICAgIF0uam9pbihcIlwiKVxuICAgICAgY29uc3Qgc2x1ZyA9IHRvRmlsZVNsdWcoZmFpbGVkVGVzdERldGFpbC5mdWxsRGVzY3JpcHRpb24pXG4gICAgICBjb25zdCBmaWxlTmFtZSA9IGAke3RpbWVzdGFtcH0tJHtTdHJpbmcoaW5kZXggKyAxKS5wYWRTdGFydCgyLCBcIjBcIil9LSR7c2x1Z30uY29uc29sZS5sb2dgXG4gICAgICBjb25zdCBmaWxlUGF0aCA9IHBhdGguam9pbihhc3NldHNQYXRoLCBmaWxlTmFtZSlcblxuICAgICAgYXdhaXQgZnMud3JpdGVGaWxlKGZpbGVQYXRoLCBjb25zb2xlT3V0cHV0LCBcInV0ZjhcIilcbiAgICAgIGZhaWxlZFRlc3REZXRhaWwuY29uc29sZUxvZ1BhdGggPSBmaWxlUGF0aFxuICAgICAgd3JpdHRlbkxvZ1BhdGhzLnB1c2goZmlsZVBhdGgpXG4gICAgfVxuXG4gICAgcmV0dXJuIHdyaXR0ZW5Mb2dQYXRoc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHN1Y2Nlc3NmdWwgdGVzdHMuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gVGhlIHN1Y2Nlc3NmdWwgdGVzdHMuXG4gICAqL1xuICBnZXRTdWNjZXNzZnVsVGVzdHMoKSB7XG4gICAgaWYgKHRoaXMuX3N1Y2Nlc3NmdWxUZXN0cyA9PT0gdW5kZWZpbmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJUZXN0cyBoYXNuJ3QgYmVlbiBydW4geWV0XCIpXG5cbiAgICByZXR1cm4gdGhpcy5fc3VjY2Vzc2Z1bFRlc3RzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdGVzdHMgY291bnQuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gVGhlIHRlc3RzIGNvdW50LlxuICAgKi9cbiAgZ2V0VGVzdHNDb3VudCgpIHtcbiAgICBpZiAodGhpcy5fdGVzdHNDb3VudCA9PT0gdW5kZWZpbmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJUZXN0cyBoYXNuJ3QgYmVlbiBydW4geWV0XCIpXG5cbiAgICByZXR1cm4gdGhpcy5fdGVzdHNDb3VudFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGV4ZWN1dGVkIHRlc3RzIGNvdW50LlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIFRoZSBleGVjdXRlZCB0ZXN0cyBjb3VudC5cbiAgICovXG4gIGdldEV4ZWN1dGVkVGVzdHNDb3VudCgpIHtcbiAgICByZXR1cm4gdGhpcy5fcGFja2FnZVJlc3VsdD8udGVzdHMubGVuZ3RoID8/IHRoaXMuX3Rlc3REdXJhdGlvbnMubGVuZ3RoXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgdGVzdHMgcmVjb3JkZWQgZHVyaW5nIHRoZSBydW4sIHNsb3dlc3QgZmlyc3QuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbbGltaXRdIC0gTWF4aW11bSBudW1iZXIgb2YgdGVzdHMgdG8gcmV0dXJuICgwIHJldHVybnMgYWxsKS5cbiAgICogQHJldHVybnMge0FycmF5PHtmdWxsRGVzY3JpcHRpb246IHN0cmluZywgZmlsZVBhdGg6IHN0cmluZywgbGluZTogbnVtYmVyLCBkdXJhdGlvbk1zOiBudW1iZXJ9Pn0gLSBTbG93ZXN0IHRlc3RzLCBzbG93ZXN0IGZpcnN0LlxuICAgKi9cbiAgZ2V0U2xvd2VzdFRlc3RzKGxpbWl0ID0gMTApIHtcbiAgICBjb25zdCBzb3J0ZWQgPSBbLi4udGhpcy5fdGVzdER1cmF0aW9uc10uc29ydCgodGVzdEEsIHRlc3RCKSA9PiB0ZXN0Qi5kdXJhdGlvbk1zIC0gdGVzdEEuZHVyYXRpb25NcylcblxuICAgIHJldHVybiBsaW1pdCA+IDAgPyBzb3J0ZWQuc2xpY2UoMCwgbGltaXQpIDogc29ydGVkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwcmVwYXJlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgcHJlcGFyZSgpIHtcbiAgICB0aGlzLmFueVRlc3RzRm9jdXNzZWQgPSBmYWxzZVxuICAgIHRoaXMuX2ZhaWxlZFRlc3RzID0gMFxuICAgIHRoaXMuX3N1Y2Nlc3NmdWxUZXN0cyA9IDBcbiAgICB0aGlzLl90ZXN0c0NvdW50ID0gMFxuICAgIHRoaXMuX2Fib3J0UmVtYWluaW5nVGVzdHMgPSBmYWxzZVxuICAgIHRoaXMuX2ZhaWxlZFRlc3REZXRhaWxzID0gW11cbiAgICB0aGlzLl90ZXN0RHVyYXRpb25zID0gW11cbiAgICB0aGlzLl90ZXN0Q29tcGF0aWJpbGl0eSA9IG5ldyBXZWFrTWFwKClcbiAgICB0aGlzLl9pbmplY3RlZFRlc3RzID0gbmV3IFdlYWtTZXQoKVxuICAgIHRoaXMuX2NvbXBsZXRlZFRlc3RzID0gbmV3IFdlYWtTZXQoKVxuICAgIHRoaXMuX3Rlc3RNZXRhZGF0YSA9IG5ldyBXZWFrTWFwKClcbiAgICB0aGlzLl9ob29rTWV0YWRhdGEgPSBuZXcgV2Vha01hcCgpXG4gICAgdGhpcy5fYXR0ZW1wdE91dGNvbWVzID0gbmV3IFdlYWtNYXAoKVxuICAgIHRoaXMuX3N1aXRlSG9va0ZhaWx1cmVzID0gW11cbiAgICB0aGlzLl90ZXN0c0J5RnVsbE5hbWUgPSBuZXcgTWFwKClcbiAgICB0aGlzLl9wYWNrYWdlUmVzdWx0ID0gdW5kZWZpbmVkXG4gICAgY29uc3QgY29udGV4dCA9IHRoaXMuZ2V0VGVzdENvbnRleHQoKVxuICAgIC8qKiBAdHlwZSB7c3RyaW5nIHwgdW5kZWZpbmVkfSAqL1xuICAgIGxldCBvd25lckZpbGVQYXRoXG5cbiAgICBjb250ZXh0LnJlc2V0KHtjb25maWc6IHRydWV9KVxuICAgIGNvbnRleHQuc2V0RGVjbGFyYXRpb25Mb2NhdG9yKCgpID0+IHRoaXMuY2FwdHVyZVRlc3REZWNsYXJhdGlvbkxvY2F0aW9uKG93bmVyRmlsZVBhdGgpKVxuICAgIGNvbnN0IHRlc3RpbmdDb25maWdQYXRoID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZ2V0VGVzdGluZygpXG5cbiAgICBhd2FpdCBjb250ZXh0LmRlc2NyaWJlKFwiXCIsIHtkYXRhYmFzZUNsZWFuaW5nOiB7dHJhbnNhY3Rpb246IHRydWV9fSwgYXN5bmMgKCkgPT4ge1xuICAgICAgaWYgKHRlc3RpbmdDb25maWdQYXRoKSB7XG4gICAgICAgIGF3YWl0IHRoaXMucnVuUHJvZmlsZVNwYW4oe3BoYXNlOiBcInRlc3RpbmcgY29uZmlnL2dsb2JhbCBzZXR1cFwifSwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGF3YWl0IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldEVudmlyb25tZW50SGFuZGxlcigpLmltcG9ydFRlc3RpbmdDb25maWdQYXRoKClcbiAgICAgICAgfSlcbiAgICAgIH1cblxuICAgICAgaWYgKCF0aGlzLl9wcm9maWxlcikge1xuICAgICAgICBhd2FpdCB0aGlzLmltcG9ydFRlc3RGaWxlcygpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBmb3IgKGNvbnN0IHRlc3RGaWxlIG9mIHRoaXMuZ2V0VGVzdEZpbGVzKCkpIHtcbiAgICAgICAgICBvd25lckZpbGVQYXRoID0gdGVzdEZpbGVcbiAgICAgICAgICBjb25zdCBleGlzdGluZ1JlZ2lzdHJhdGlvbnMgPSB0aGlzLnRlc3RSZWdpc3RyYXRpb25PYmplY3RzKClcblxuICAgICAgICAgIGF3YWl0IHRoaXMuX3Byb2ZpbGVyLm1lYXN1cmVQaGFzZShcImltcG9ydHNcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuaW1wb3J0VGVzdEZpbGVzKFt0ZXN0RmlsZV0pXG4gICAgICAgICAgfSwge2ZpbGVQYXRoOiB0ZXN0RmlsZX0pXG4gICAgICAgICAgdGhpcy5hc3NpZ25UZXN0UmVnaXN0cmF0aW9uT3duZXJzaGlwKGV4aXN0aW5nUmVnaXN0cmF0aW9ucywgdGVzdEZpbGUpXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KVxuICAgIG93bmVyRmlsZVBhdGggPSB1bmRlZmluZWRcbiAgICB0aGlzLmFuYWx5emVEZWNsYXJhdGlvbnMoKVxuICB9XG5cbiAgLyoqXG4gICAqIENhcHR1cmVzIGEgdGVzdCBzb3VyY2UgbG9jYXRpb24gd2l0aG91dCBhdHRyaWJ1dGluZyBwYWNrYWdlL2ZhY2FkZSBmcmFtZXMuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBvd25lckZpbGVQYXRoIC0gSW1wb3J0aW5nIGVudHJ5IGZpbGUgZmFsbGJhY2suXG4gICAqIEByZXR1cm5zIHt7ZmlsZVBhdGg/OiBzdHJpbmcsIGxpbmU/OiBudW1iZXJ9fSAtIERlY2xhcmF0aW9uIGxvY2F0aW9uLlxuICAgKi9cbiAgY2FwdHVyZVRlc3REZWNsYXJhdGlvbkxvY2F0aW9uKG93bmVyRmlsZVBhdGgpIHtcbiAgICBjb25zdCBzdGFjayA9IG5ldyBFcnJvcigpLnN0YWNrPy5zcGxpdChcIlxcblwiKSB8fCBbXVxuXG4gICAgZm9yIChjb25zdCBzdGFja0xpbmUgb2Ygc3RhY2spIHtcbiAgICAgIGNvbnN0IG1hdGNoID0gc3RhY2tMaW5lLm1hdGNoKC8oPzpcXCh8XFxzKShmaWxlOlxcL1xcLy4qP3xcXC9bXlwiXSo/KTooXFxkKyk6KFxcZCspXFwpPyQvdSlcbiAgICAgIGlmICghbWF0Y2gpIGNvbnRpbnVlXG5cbiAgICAgIGxldCBmaWxlUGF0aCA9IG1hdGNoWzFdXG4gICAgICBpZiAoZmlsZVBhdGguc3RhcnRzV2l0aChcImZpbGU6Ly9cIikpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBmaWxlUGF0aCA9IGZpbGVVUkxUb1BhdGgoZmlsZVBhdGgpXG4gICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGNvbnN0IHJlc29sdmVkRmlsZVBhdGggPSBwYXRoLnJlc29sdmUoZmlsZVBhdGgpXG4gICAgICBjb25zdCBwb3J0YWJsZVBhdGggPSByZXNvbHZlZEZpbGVQYXRoLnJlcGxhY2VBbGwocGF0aC5zZXAsIFwiL1wiKVxuXG4gICAgICBpZiAocG9ydGFibGVQYXRoLmVuZHNXaXRoKFwiL3NyYy90ZXN0aW5nL3Rlc3QtcnVubmVyLmpzXCIpKSBjb250aW51ZVxuICAgICAgaWYgKHBvcnRhYmxlUGF0aC5lbmRzV2l0aChcIi9zcmMvdGVzdGluZy90ZXN0LmpzXCIpKSBjb250aW51ZVxuICAgICAgaWYgKHBvcnRhYmxlUGF0aC5pbmNsdWRlcyhcIi9ub2RlX21vZHVsZXMvQHZlbG9jaW91cy90ZXN0aW5nL1wiKSkgY29udGludWVcblxuICAgICAgcmV0dXJuIHtmaWxlUGF0aDogcmVzb2x2ZWRGaWxlUGF0aCwgbGluZTogTnVtYmVyKG1hdGNoWzJdKX1cbiAgICB9XG5cbiAgICByZXR1cm4gb3duZXJGaWxlUGF0aCA/IHtmaWxlUGF0aDogb3duZXJGaWxlUGF0aH0gOiB7fVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXJlIGFueSB0ZXN0cyBmb2N1c3NlZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBhbnkgdGVzdHMgZm9jdXNzZWQuXG4gICAqL1xuICBhcmVBbnlUZXN0c0ZvY3Vzc2VkKCkge1xuICAgIGlmICh0aGlzLmFueVRlc3RzRm9jdXNzZWQgPT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiSGFzbid0IGJlZW4gZGV0ZWN0ZWQgeWV0XCIpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuYW55VGVzdHNGb2N1c3NlZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcnVuLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgLyoqXG4gICAqIFJlY29yZHMgYW4gYXN5bmNocm9ub3VzIGNyYXNoIChhbiB1bmhhbmRsZWQgcHJvbWlzZSByZWplY3Rpb24gZGV0YWNoZWQgZnJvbVxuICAgKiBhbnkgYXdhaXQsIGUuZy4gYSBgdm9pZCBjb25uZWN0aW9uLmFmdGVyQ29tbWl0KGFzeW5jICgpID0+IGJyb2FkY2FzdCguLi4pKWBcbiAgICogZnJvbnRlbmQtbW9kZWwgcHVibGlzaCDigJQgb3IgYSBzeW5jaHJvbm91cyB0aHJvdyBpbnNpZGUgYSBkZXRhY2hlZCBjYWxsYmFja1xuICAgKiBzdWNoIGFzIGEgZHJpdmVyIHNvY2tldCBvciB0aW1lciBjYWxsYmFjaykgYXMgYSByZWFsLCB2aXNpYmxlLCBhdHRyaWJ1dGVkXG4gICAqIHRlc3QgZmFpbHVyZS5cbiAgICpcbiAgICogV2l0aG91dCB0aGlzLCBzdWNoIGEgcmVqZWN0aW9uL2V4Y2VwdGlvbiBoYXMgbm8gaGFuZGxlciwgc28gb24gbW9kZXJuIE5vZGVcbiAgICogdGhlIHByb2Nlc3MgaXMgVEVSTUlOQVRFRCDigJQgdGhlIHJ1biBlbmRzIHdpdGggbm8gcmVwb3J0ZWQgZmFpbHVyZXMgYW5kIENJXG4gICAqIGp1c3Qgc2VlcyBhIGNyYXNoZWQvcmV0cmllZCBzaGFyZCB3aXRoIGFuIGVtcHR5IHJlc3VsdCAodGhlIHJlY3VycmluZ1xuICAgKiBcInNpbGVudCB0ZXN0LXJ1bm5lciBkZWF0aFwiOiBpbnZpc2libGUgYW5kIGltcG9zc2libGUgdG8gZGlhZ25vc2UpLiBUdXJuaW5nXG4gICAqIGl0IGludG8gYSBmYWlsdXJlIG1ha2VzIHRoZSBydW4gZ28gcmVkIHdpdGggc29tZXRoaW5nIGRlYnVnZ2FibGUgaW5zdGVhZCBvZlxuICAgKiB2YW5pc2hpbmcuXG4gICAqIEBwYXJhbSB7XCJ1bmNhdWdodEV4Y2VwdGlvblwiIHwgXCJ1bmhhbmRsZWRSZWplY3Rpb25cIn0ga2luZCAtIEFzeW5jLWNyYXNoIGtpbmQuXG4gICAqIEBwYXJhbSB7dW5rbm93bn0gcmVhc29uIC0gUmVqZWN0aW9uIHJlYXNvbiBvciB0aHJvd24gZXJyb3IuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgcmVjb3JkQXN5bmNDcmFzaChraW5kLCByZWFzb24pIHtcbiAgICBjb25zdCBlcnJvciA9IHJlYXNvbiBpbnN0YW5jZW9mIEVycm9yID8gcmVhc29uIDogbmV3IEVycm9yKGAke2tpbmR9OiAke1N0cmluZyhyZWFzb24pfWApXG4gICAgY29uc3QgbmVhciA9IHRoaXMuX2xhc3RUZXN0Q29udGV4dFxuICAgIGNvbnN0IGF0dHJpYnV0aW9uID0gbmVhciA/IGAsIG5lYXIgdGVzdDogJHtuZWFyLmZ1bGxEZXNjcmlwdGlvbn0gKCR7bmVhci5maWxlUGF0aH06JHtuZWFyLmxpbmV9KWAgOiBcIlwiXG5cbiAgICB0aGlzLl9mYWlsZWRUZXN0cyA9ICh0aGlzLl9mYWlsZWRUZXN0cyB8fCAwKSArIDFcbiAgICB0aGlzLl9mYWlsZWRUZXN0RGV0YWlscy5wdXNoKHtcbiAgICAgIGZ1bGxEZXNjcmlwdGlvbjogYDwke2tpbmR9IGR1cmluZyB0ZXN0IHJ1biR7YXR0cmlidXRpb259PmAsXG4gICAgICBmaWxlUGF0aDogbmVhciA/IG5lYXIuZmlsZVBhdGggOiBcIjx0ZXN0IHJ1bm5lcj5cIixcbiAgICAgIGxpbmU6IG5lYXIgPyBuZWFyLmxpbmUgOiAwLFxuICAgICAgZXJyb3IsXG4gICAgICBjb25zb2xlT3V0cHV0OiB1bmRlZmluZWRcbiAgICB9KVxuXG4gICAgY29uc29sZS5lcnJvcihwaWNvY29sb3JzLnJlZChgXFxuW3Rlc3QtcnVubmVyXSAke2tpbmR9IGR1cmluZyB0aGUgdGVzdCBydW4g4oCUIHRoaXMgd291bGQgb3RoZXJ3aXNlIHRlcm1pbmF0ZSB0aGUgcHJvY2VzcyBzaWxlbnRseSBhbmQgc3VyZmFjZSBvbmx5IGFzIGEgY3Jhc2hlZC9yZXRyaWVkIHNoYXJkIHdpdGggemVybyByZXBvcnRlZCBmYWlsdXJlcy4ke2F0dHJpYnV0aW9ufWApKVxuICAgIGNvbnNvbGUuZXJyb3IoZXJyb3IpXG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkcyBhIGNsZWFudXAgZmFpbHVyZSBhZnRlciB0aW1lb3V0IGhhbmRsaW5nIGhhcyBiZWd1bi5cbiAgICogQHBhcmFtIHt1bmtub3dufSByZWFzb24gLSBEZXRhY2hlZCBjbGVhbnVwIHJlamVjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNsZWFudXBOYW1lIC0gQ2xlYW51cCBvcGVyYXRpb24gbmFtZS5cbiAgICogQHBhcmFtIHtTZXQ8RXJyb3I+fSBbcmVjb3JkZWRFcnJvcnNdIC0gQXR0ZW1wdC1vd25lZCBjbGVhbnVwIGVycm9ycyBhbHJlYWR5IHJlcG9ydGVkLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHJlY29yZFRpbWVvdXRDbGVhbnVwRmFpbHVyZShyZWFzb24sIGNsZWFudXBOYW1lLCByZWNvcmRlZEVycm9ycykge1xuICAgIGNvbnN0IGVycm9yID0gcmVhc29uIGluc3RhbmNlb2YgRXJyb3IgPyByZWFzb24gOiBuZXcgRXJyb3IoYCR7Y2xlYW51cE5hbWV9IGNsZWFudXAgZmFpbGVkOiAke1N0cmluZyhyZWFzb24pfWApXG5cbiAgICBpZiAocmVjb3JkZWRFcnJvcnMpIHtcbiAgICAgIC8vIE11bHRpcGxlIGJvdW5kZWQgb2JzZXJ2ZXJzIGNhbiByZWNlaXZlIHRoZSBzYW1lIGRldGFjaGVkIGNsZWFudXAgcmVqZWN0aW9uLlxuICAgICAgaWYgKHJlY29yZGVkRXJyb3JzLmhhcyhlcnJvcikpIHJldHVyblxuICAgICAgcmVjb3JkZWRFcnJvcnMuYWRkKGVycm9yKVxuICAgIH1cblxuICAgIGNvbnN0IG5lYXIgPSB0aGlzLl9sYXN0VGVzdENvbnRleHRcbiAgICBjb25zdCBhdHRyaWJ1dGlvbiA9IG5lYXIgPyBgLCBuZWFyIHRlc3Q6ICR7bmVhci5mdWxsRGVzY3JpcHRpb259ICgke25lYXIuZmlsZVBhdGh9OiR7bmVhci5saW5lfSlgIDogXCJcIlxuXG4gICAgdGhpcy5fZmFpbGVkVGVzdHMgPSAodGhpcy5fZmFpbGVkVGVzdHMgfHwgMCkgKyAxXG4gICAgdGhpcy5fZmFpbGVkVGVzdERldGFpbHMucHVzaCh7XG4gICAgICBmdWxsRGVzY3JpcHRpb246IGA8JHtjbGVhbnVwTmFtZX0gZW1lcmdlbmN5IGNsZWFudXAgZmFpbHVyZSR7YXR0cmlidXRpb259PmAsXG4gICAgICBmaWxlUGF0aDogbmVhciA/IG5lYXIuZmlsZVBhdGggOiBcIjx0ZXN0IHJ1bm5lcj5cIixcbiAgICAgIGxpbmU6IG5lYXIgPyBuZWFyLmxpbmUgOiAwLFxuICAgICAgZXJyb3IsXG4gICAgICBjb25zb2xlT3V0cHV0OiB1bmRlZmluZWRcbiAgICB9KVxuXG4gICAgY29uc29sZS5lcnJvcihwaWNvY29sb3JzLnJlZChgXFxuW3Rlc3QtcnVubmVyXSAke2NsZWFudXBOYW1lfSBjbGVhbnVwIGZhaWxlZCBhZnRlciB0aW1lb3V0IGhhbmRsaW5nIGJlZ2FuLiR7YXR0cmlidXRpb259YCkpXG4gICAgY29uc29sZS5lcnJvcihlcnJvcilcbiAgfVxuXG4gIGFzeW5jIHJ1bigpIHtcbiAgICAvKipcbiAgICAgKiBIYW5kbGVzIGEgcHJvY2Vzcy1sZXZlbCB1bmhhbmRsZWQgcmVqZWN0aW9uIGR1cmluZyB0aGUgcnVuLlxuICAgICAqIEBwYXJhbSB7dW5rbm93bn0gcmVhc29uIC0gUmVqZWN0aW9uIHJlYXNvbi5cbiAgICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICAgKi9cbiAgICBjb25zdCBvblVuaGFuZGxlZFJlamVjdGlvbiA9IChyZWFzb24pID0+IHtcbiAgICAgIC8vIElmIGEgdGVzdCBhdHRhY2hlZCBpdHMgT1dOIHVuaGFuZGxlZFJlamVjdGlvbiBsaXN0ZW5lciwgaXQgaXNcbiAgICAgIC8vIGludGVudGlvbmFsbHkgb2JzZXJ2aW5nL3RyaWdnZXJpbmcgdGhlIHJlamVjdGlvbiAoZS5nLiBiZWFjb25cbiAgICAgIC8vIGVycm9yLXJlcG9ydGluZy1zcGVjLmpzKSDigJQgTm9kZSBkaXNwYXRjaGVzIHRvIEVWRVJZIGxpc3RlbmVyLCBzbyBhbHNvXG4gICAgICAvLyBmYWlsaW5nIHRoZSBzdWl0ZSBoZXJlIHdvdWxkIGJyZWFrIHRob3NlIHRlc3RzLiBEZWZlciB0byB0aGUgdGVzdCdzXG4gICAgICAvLyBoYW5kbGVyOyBvbmx5IHRyZWF0IGEgcmVqZWN0aW9uIGFzIGEgc2lsZW50LWRlYXRoIGNyYXNoIHdoZW4gb3VycyBpcyB0aGVcbiAgICAgIC8vIHNvbGUgbGlzdGVuZXIgKG5vIHBlcnNpc3RlbnQgZnJhbWV3b3JrIGxpc3RlbmVyIGV4aXN0cyB0byBtYXNrIHRoaXMpLlxuICAgICAgaWYgKHByb2Nlc3MubGlzdGVuZXJDb3VudChcInVuaGFuZGxlZFJlamVjdGlvblwiKSA+IDEpIHJldHVyblxuXG4gICAgICB0aGlzLnJlY29yZEFzeW5jQ3Jhc2goXCJ1bmhhbmRsZWRSZWplY3Rpb25cIiwgcmVhc29uKVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEhhbmRsZXMgYSBwcm9jZXNzLWxldmVsIHVuY2F1Z2h0IGV4Y2VwdGlvbiBkdXJpbmcgdGhlIHJ1biDigJQgYVxuICAgICAqIHN5bmNocm9ub3VzIHRocm93IGluc2lkZSBhIGRldGFjaGVkIGNhbGxiYWNrIChkcml2ZXIgc29ja2V0LCB0aW1lcixcbiAgICAgKiBldmVudCBlbWl0dGVyKSB0aGF0IG5vIHRlc3QgYXdhaXQgb2JzZXJ2ZXMuIFNhbWUgc2lsZW50LWRlYXRoIG1vZGUgYXNcbiAgICAgKiB1bmhhbmRsZWQgcmVqZWN0aW9uczogd2l0aG91dCBhIGhhbmRsZXIgdGhlIHByb2Nlc3MgZGllcyBtaWQtcnVuIGFuZCBDSVxuICAgICAqIHNlZXMgYSBjcmFzaGVkIHNoYXJkIHdpdGggemVybyByZXBvcnRlZCBmYWlsdXJlcy5cbiAgICAgKiBAcGFyYW0ge3Vua25vd259IGVycm9yIC0gVGhyb3duIGVycm9yLlxuICAgICAqIEByZXR1cm5zIHt2b2lkfVxuICAgICAqL1xuICAgIGNvbnN0IG9uVW5jYXVnaHRFeGNlcHRpb24gPSAoZXJyb3IpID0+IHtcbiAgICAgIC8vIE1pcnJvciB0aGUgdW5oYW5kbGVkUmVqZWN0aW9uIGRlZmVycmFsOiBhIHRlc3Qgb2JzZXJ2aW5nL3RyaWdnZXJpbmdcbiAgICAgIC8vIHVuY2F1Z2h0IGV4Y2VwdGlvbnMgd2l0aCBpdHMgb3duIGxpc3RlbmVyIG93bnMgdGhlbS5cbiAgICAgIGlmIChwcm9jZXNzLmxpc3RlbmVyQ291bnQoXCJ1bmNhdWdodEV4Y2VwdGlvblwiKSA+IDEpIHJldHVyblxuXG4gICAgICB0aGlzLnJlY29yZEFzeW5jQ3Jhc2goXCJ1bmNhdWdodEV4Y2VwdGlvblwiLCBlcnJvcilcbiAgICB9XG5cbiAgICBwcm9jZXNzLm9uKFwidW5oYW5kbGVkUmVqZWN0aW9uXCIsIG9uVW5oYW5kbGVkUmVqZWN0aW9uKVxuICAgIHByb2Nlc3Mub24oXCJ1bmNhdWdodEV4Y2VwdGlvblwiLCBvblVuY2F1Z2h0RXhjZXB0aW9uKVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMucnVuUGFja2FnZVRlc3RzKClcblxuICAgICAgLy8gQSByZWplY3Rpb24gc2NoZWR1bGVkIGJ5IHRoZSBmaW5hbCB0ZXN0IChhIGRldGFjaGVkIHJlamVjdGVkIHByb21pc2UsXG4gICAgICAvLyBvciBhbiBhZnRlckNvbW1pdCBjYWxsYmFjayByZWplY3RpbmcgYXMgdGhlIHN1aXRlIGRyYWlucykgaXMgcmVwb3J0ZWRcbiAgICAgIC8vIGJ5IE5vZGUgb24gYSBMQVRFUiB0dXJuLiBEcmFpbiBhIGZldyB0dXJucyB3aGlsZSB0aGUgaGFuZGxlciBpcyBzdGlsbFxuICAgICAgLy8gYXR0YWNoZWQgc28gdGhvc2UgbGF0ZSByZWplY3Rpb25zIGFyZSByZWNvcmRlZCBpbnN0ZWFkIG9mIGVzY2FwaW5nIHRvXG4gICAgICAvLyB0aGUgZGVmYXVsdCBjcmFzaCBwYXRoIGFmdGVyIGNsZWFudXAuXG4gICAgICBmb3IgKGxldCBkcmFpblR1cm4gPSAwOyBkcmFpblR1cm4gPCAzOyBkcmFpblR1cm4rKykge1xuICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4gc2V0SW1tZWRpYXRlKHJlc29sdmUpKVxuICAgICAgfVxuICAgIH0gZmluYWxseSB7XG4gICAgICBwcm9jZXNzLm9mZihcInVuaGFuZGxlZFJlamVjdGlvblwiLCBvblVuaGFuZGxlZFJlamVjdGlvbilcbiAgICAgIHByb2Nlc3Mub2ZmKFwidW5jYXVnaHRFeGNlcHRpb25cIiwgb25VbmNhdWdodEV4Y2VwdGlvbilcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBydW4gYWZ0ZXIgYWxscyBmb3IgYWN0aXZlIHNjb3Blcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjbGVhbnVwIGhvb2tzIGZpbmlzaC5cbiAgICovXG4gIGFzeW5jIHJ1bkFmdGVyQWxsc0ZvckFjdGl2ZVNjb3BlcygpIHtcbiAgICBjb25zdCBmYWlsdXJlU3RhcnQgPSB0aGlzLl9zdWl0ZUhvb2tGYWlsdXJlcy5sZW5ndGhcblxuICAgIGF3YWl0IHRoaXMuX3BhY2thZ2VSdW5uZXI/LmNsZWFudXBBY3RpdmVTdWl0ZXMoKVxuICAgIHRoaXMudGhyb3dBZnRlckFsbEZhaWx1cmVzKHRoaXMuX3N1aXRlSG9va0ZhaWx1cmVzLnNsaWNlKGZhaWx1cmVTdGFydCkpXG4gIH1cblxuICAvKiogQnVpbGRzIGRlY2xhcmF0aW9uIG1ldGFkYXRhIHVzZWQgb25seSBieSBmcmFtZXdvcmsgYWRhcHRlcnMgYW5kIHByb2plY3Rpb25zLiAqL1xuICBhbmFseXplRGVjbGFyYXRpb25zKCkge1xuICAgIGNvbnN0IHZpc2l0ID0gKC8qKiBAdHlwZSB7UGFja2FnZVN1aXRlRGVjbGFyYXRpb259ICovIHN1aXRlLCAvKiogQHR5cGUge1BhY2thZ2VTdWl0ZURlY2xhcmF0aW9uW119ICovIGFuY2VzdG9ycywgLyoqIEB0eXBlIHtzdHJpbmcgfCB1bmRlZmluZWR9ICovIHBhcmVudFByb2ZpbGVTY29wZUlkKSA9PiB7XG4gICAgICBjb25zdCBzdWl0ZXMgPSBbLi4uYW5jZXN0b3JzLCBzdWl0ZV1cbiAgICAgIGNvbnN0IGRlc2NyaXB0aW9ucyA9IHN1aXRlcy5tYXAoKGVudHJ5KSA9PiBlbnRyeS5uYW1lKS5maWx0ZXIoKG5hbWUpID0+IG5hbWUgIT09IFwiXCIpXG4gICAgICBjb25zdCBvd25lckZpbGVQYXRoID0gdGhpcy5fZGVjbGFyYXRpb25Pd25lcnMuZ2V0KHN1aXRlKSA/PyBzdWl0ZS5sb2NhdGlvbi5maWxlUGF0aFxuICAgICAgY29uc3QgcHJvZmlsZVNjb3BlSWQgPSB0aGlzLl9wcm9maWxlcj8uc2NvcGVJZChzdWl0ZSwge1xuICAgICAgICBkZXNjcmlwdGlvbnMsXG4gICAgICAgIGZpbGVQYXRoOiBvd25lckZpbGVQYXRoLFxuICAgICAgICBsaW5lOiBzdWl0ZS5sb2NhdGlvbi5saW5lLFxuICAgICAgICBwYXJlbnRJZDogcGFyZW50UHJvZmlsZVNjb3BlSWRcbiAgICAgIH0pXG5cbiAgICAgIGZvciAoY29uc3QgaG9va3Mgb2YgT2JqZWN0LnZhbHVlcyhzdWl0ZS5ob29rcykpIHtcbiAgICAgICAgaG9va3MuZm9yRWFjaCgoaG9vaywgZGVjbGFyYXRpb25JbmRleCkgPT4ge1xuICAgICAgICAgIHRoaXMuX2hvb2tNZXRhZGF0YS5zZXQoaG9vaywge1xuICAgICAgICAgICAgZGVjbGFyYXRpb25JbmRleCxcbiAgICAgICAgICAgIGRlY2xhcmF0aW9uU2NvcGVJZDogcHJvZmlsZVNjb3BlSWQsXG4gICAgICAgICAgICBvd25lckZpbGVQYXRoOiB0aGlzLl9kZWNsYXJhdGlvbk93bmVycy5nZXQoaG9vaykgPz8gaG9vay5sb2NhdGlvbi5maWxlUGF0aCA/PyBvd25lckZpbGVQYXRoXG4gICAgICAgICAgfSlcbiAgICAgICAgfSlcbiAgICAgIH1cblxuICAgICAgZm9yIChjb25zdCB0ZXN0RGVjbGFyYXRpb24gb2Ygc3VpdGUudGVzdHMpIHtcbiAgICAgICAgY29uc3QgZnVsbERlc2NyaXB0aW9uID0gdGhpcy5idWlsZEZ1bGxEZXNjcmlwdGlvbihkZXNjcmlwdGlvbnMsIHRlc3REZWNsYXJhdGlvbi5uYW1lKVxuICAgICAgICBjb25zdCBkZWNsYXJhdGlvbnMgPSB0aGlzLl90ZXN0c0J5RnVsbE5hbWUuZ2V0KGZ1bGxEZXNjcmlwdGlvbikgfHwgW11cblxuICAgICAgICBkZWNsYXJhdGlvbnMucHVzaCh0ZXN0RGVjbGFyYXRpb24pXG4gICAgICAgIHRoaXMuX3Rlc3RzQnlGdWxsTmFtZS5zZXQoZnVsbERlc2NyaXB0aW9uLCBkZWNsYXJhdGlvbnMpXG4gICAgICAgIHRoaXMuX3Rlc3RNZXRhZGF0YS5zZXQodGVzdERlY2xhcmF0aW9uLCB7XG4gICAgICAgICAgZGVzY3JpcHRpb25zLFxuICAgICAgICAgIHRlc3REZXNjcmlwdGlvbjogdGVzdERlY2xhcmF0aW9uLm5hbWUsXG4gICAgICAgICAgZnVsbERlc2NyaXB0aW9uLFxuICAgICAgICAgIG93bmVyRmlsZVBhdGg6IHRoaXMuX2RlY2xhcmF0aW9uT3duZXJzLmdldCh0ZXN0RGVjbGFyYXRpb24pID8/IHRlc3REZWNsYXJhdGlvbi5sb2NhdGlvbi5maWxlUGF0aCA/PyBvd25lckZpbGVQYXRoLFxuICAgICAgICAgIHN1aXRlc1xuICAgICAgICB9KVxuICAgICAgICBjb25zdCBsZWdhY3lUZXN0RGF0YSA9IHRoaXMuX2xlZ2FjeUZpeHR1cmVEYXRhQnlGdWxsTmFtZT8uZ2V0KGZ1bGxEZXNjcmlwdGlvbilcbiAgICAgICAgaWYgKGxlZ2FjeVRlc3REYXRhKSB7XG4gICAgICAgICAgdGhpcy5fdGVzdENvbXBhdGliaWxpdHkuc2V0KHRlc3REZWNsYXJhdGlvbiwge1xuICAgICAgICAgICAgdGVzdEFyZ3M6IHRoaXMuX3Rlc3RBcmd1bWVudHMuY29weSh0ZXN0RGVjbGFyYXRpb24pLFxuICAgICAgICAgICAgdGVzdERhdGE6IGxlZ2FjeVRlc3REYXRhXG4gICAgICAgICAgfSlcbiAgICAgICAgfVxuICAgICAgICB0aGlzLl90ZXN0c0NvdW50KytcbiAgICAgICAgaWYgKHRlc3REZWNsYXJhdGlvbi5zdGF0ZSA9PT0gXCJydW5cIiAmJiAodGVzdERlY2xhcmF0aW9uLmZvY3VzIHx8IHN1aXRlcy5zb21lKChlbnRyeSkgPT4gZW50cnkuZm9jdXMpKSkge1xuICAgICAgICAgIHRoaXMuYW55VGVzdHNGb2N1c3NlZCA9IHRydWVcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBmb3IgKGNvbnN0IGNoaWxkU3VpdGUgb2Ygc3VpdGUuc3VpdGVzKSB2aXNpdChjaGlsZFN1aXRlLCBzdWl0ZXMsIHByb2ZpbGVTY29wZUlkKVxuICAgIH1cblxuICAgIGZvciAoY29uc3Qgc3VpdGUgb2YgdGhpcy5nZXRUZXN0Q29udGV4dCgpLnJlZ2lzdHJ5LnN1aXRlcykgdmlzaXQoc3VpdGUsIFtdLCB1bmRlZmluZWQpXG4gIH1cblxuICAvKipcbiAgICogR2V0cyBwYWNrYWdlIGhvb2sgY29tcGF0aWJpbGl0eSBtZXRhZGF0YS5cbiAgICogQHBhcmFtIHtQYWNrYWdlSG9va0RlY2xhcmF0aW9ufSBob29rIC0gUGFja2FnZSBob29rIGRlY2xhcmF0aW9uLlxuICAgKiBAcmV0dXJucyB7e2RlY2xhcmF0aW9uSW5kZXg6IG51bWJlciwgZGVjbGFyYXRpb25TY29wZUlkOiBzdHJpbmcgfCB1bmRlZmluZWQsIG93bmVyRmlsZVBhdGg6IHN0cmluZyB8IHVuZGVmaW5lZH19IC0gSG9vayBtZXRhZGF0YS5cbiAgICovXG4gIGhvb2tNZXRhZGF0YShob29rKSB7XG4gICAgcmV0dXJuIHRoaXMuX2hvb2tNZXRhZGF0YS5nZXQoaG9vaykgfHwge2RlY2xhcmF0aW9uSW5kZXg6IDAsIGRlY2xhcmF0aW9uU2NvcGVJZDogdW5kZWZpbmVkLCBvd25lckZpbGVQYXRoOiBob29rLmxvY2F0aW9uLmZpbGVQYXRofVxuICB9XG5cbiAgLyoqXG4gICAqIEdldHMgcGFja2FnZSB0ZXN0IGNvbXBhdGliaWxpdHkgbWV0YWRhdGEuXG4gICAqIEBwYXJhbSB7UGFja2FnZVRlc3REZWNsYXJhdGlvbn0gdGVzdCAtIFBhY2thZ2UgdGVzdCBkZWNsYXJhdGlvbi5cbiAgICogQHJldHVybnMge3tkZXNjcmlwdGlvbnM6IHN0cmluZ1tdLCB0ZXN0RGVzY3JpcHRpb246IHN0cmluZywgZnVsbERlc2NyaXB0aW9uOiBzdHJpbmcsIG93bmVyRmlsZVBhdGg6IHN0cmluZyB8IHVuZGVmaW5lZCwgc3VpdGVzOiBQYWNrYWdlU3VpdGVEZWNsYXJhdGlvbltdfX0gLSBEZWNsYXJhdGlvbiBtZXRhZGF0YS5cbiAgICovXG4gIHRlc3RNZXRhZGF0YSh0ZXN0KSB7XG4gICAgY29uc3QgbWV0YWRhdGEgPSB0aGlzLl90ZXN0TWV0YWRhdGEuZ2V0KHRlc3QpXG4gICAgaWYgKCFtZXRhZGF0YSkgdGhyb3cgbmV3IEVycm9yKGBNaXNzaW5nIHBhY2thZ2UgdGVzdCBtZXRhZGF0YTogJHt0ZXN0Lm5hbWV9YClcbiAgICByZXR1cm4gbWV0YWRhdGFcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXRzIHN0YWJsZSBjb21wYXRpYmlsaXR5IGRhdGEgZm9yIGEgcGFja2FnZSBkZWNsYXJhdGlvbi5cbiAgICogQHBhcmFtIHtQYWNrYWdlVGVzdERlY2xhcmF0aW9ufSB0ZXN0IC0gUGFja2FnZSB0ZXN0IGRlY2xhcmF0aW9uLlxuICAgKiBAcmV0dXJucyB7e3Rlc3RBcmdzOiBUZXN0QXJncywgdGVzdERhdGE6IFRlc3REYXRhfX0gLSBTdGFibGUgY29tcGF0aWJpbGl0eSBkYXRhLlxuICAgKi9cbiAgdGVzdERhdGEodGVzdCkge1xuICAgIGxldCBjb21wYXRpYmlsaXR5ID0gdGhpcy5fdGVzdENvbXBhdGliaWxpdHkuZ2V0KHRlc3QpXG5cbiAgICBpZiAoIWNvbXBhdGliaWxpdHkpIHtcbiAgICAgIGNvbnN0IHRlc3RBcmdzID0gdGhpcy5fdGVzdEFyZ3VtZW50cy5jb3B5KHRlc3QpXG4gICAgICBjb25zdCBtZXRhZGF0YSA9IHRoaXMudGVzdE1ldGFkYXRhKHRlc3QpXG4gICAgICBjb25zdCB0ZXN0RGF0YSA9IHtcbiAgICAgICAgYXJnczogdGVzdEFyZ3MsXG4gICAgICAgIGRlY2xhcmF0aW9uOiB0ZXN0LFxuICAgICAgICBmaWxlUGF0aDogdGVzdC5sb2NhdGlvbi5maWxlUGF0aCxcbiAgICAgICAgZnVuY3Rpb246IHRlc3QuY2FsbGJhY2ssXG4gICAgICAgIGxpbmU6IHRlc3QubG9jYXRpb24ubGluZSxcbiAgICAgICAgb3duZXJGaWxlUGF0aDogbWV0YWRhdGEub3duZXJGaWxlUGF0aFxuICAgICAgfVxuICAgICAgY29tcGF0aWJpbGl0eSA9IHt0ZXN0QXJncywgdGVzdERhdGF9XG4gICAgICB0aGlzLl90ZXN0Q29tcGF0aWJpbGl0eS5zZXQodGVzdCwgY29tcGF0aWJpbGl0eSlcbiAgICB9XG5cbiAgICByZXR1cm4gY29tcGF0aWJpbGl0eVxuICB9XG5cbiAgLyoqXG4gICAqIEluamVjdHMgZnJhbWV3b3JrIGNvbGxhYm9yYXRvcnMgaW50byBzdGFibGUgY29tcGF0aWJpbGl0eSBkYXRhIG9uY2UuXG4gICAqIEBwYXJhbSB7UGFja2FnZVRlc3REZWNsYXJhdGlvbn0gdGVzdCAtIFBhY2thZ2UgdGVzdCBkZWNsYXJhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8e3Rlc3RBcmdzOiBUZXN0QXJncywgdGVzdERhdGE6IFRlc3REYXRhfT59IC0gSW5qZWN0ZWQgY29tcGF0aWJpbGl0eSBkYXRhLlxuICAgKi9cbiAgYXN5bmMgdGVzdENvbXBhdGliaWxpdHkodGVzdCkge1xuICAgIGNvbnN0IGNvbXBhdGliaWxpdHkgPSB0aGlzLnRlc3REYXRhKHRlc3QpXG5cbiAgICBpZiAoIXRoaXMuX2luamVjdGVkVGVzdHMuaGFzKHRlc3QpKSB7XG4gICAgICBhd2FpdCB0aGlzLl90ZXN0QXJndW1lbnRzLmluamVjdChjb21wYXRpYmlsaXR5LnRlc3RBcmdzKVxuICAgICAgdGhpcy5faW5qZWN0ZWRUZXN0cy5hZGQodGVzdClcbiAgICB9XG5cbiAgICByZXR1cm4gY29tcGF0aWJpbGl0eVxuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgYSByYXcgZnJhbWV3b3JrIGF0dGVtcHQgb3V0Y29tZS5cbiAgICogQHBhcmFtIHtQYWNrYWdlVGVzdERlY2xhcmF0aW9ufSB0ZXN0IC0gUGFja2FnZSB0ZXN0IGRlY2xhcmF0aW9uLlxuICAgKiBAcGFyYW0ge251bWJlcn0gYXR0ZW1wdE51bWJlciAtIE9uZS1iYXNlZCBhdHRlbXB0IG51bWJlci5cbiAgICogQHBhcmFtIHt7YWJvcnRSZW1haW5pbmdUZXN0czogYm9vbGVhbiwgZXJyb3I6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBmYWlsZWQ6IGJvb2xlYW59fSBvdXRjb21lIC0gUmF3IGF0dGVtcHQgb3V0Y29tZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICByZWNvcmRBdHRlbXB0T3V0Y29tZSh0ZXN0LCBhdHRlbXB0TnVtYmVyLCBvdXRjb21lKSB7XG4gICAgY29uc3Qgb3V0Y29tZXMgPSB0aGlzLl9hdHRlbXB0T3V0Y29tZXMuZ2V0KHRlc3QpIHx8IG5ldyBNYXAoKVxuICAgIG91dGNvbWVzLnNldChhdHRlbXB0TnVtYmVyLCBvdXRjb21lKVxuICAgIHRoaXMuX2F0dGVtcHRPdXRjb21lcy5zZXQodGVzdCwgb3V0Y29tZXMpXG4gICAgaWYgKG91dGNvbWUuYWJvcnRSZW1haW5pbmdUZXN0cykgdGhpcy5fYWJvcnRSZW1haW5pbmdUZXN0cyA9IHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXRzIGEgcmF3IGZyYW1ld29yayBhdHRlbXB0IG91dGNvbWUuXG4gICAqIEBwYXJhbSB7UGFja2FnZVRlc3REZWNsYXJhdGlvbn0gdGVzdCAtIFBhY2thZ2UgdGVzdCBkZWNsYXJhdGlvbi5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGF0dGVtcHROdW1iZXIgLSBPbmUtYmFzZWQgYXR0ZW1wdCBudW1iZXIuXG4gICAqIEByZXR1cm5zIHt7YWJvcnRSZW1haW5pbmdUZXN0czogYm9vbGVhbiwgZXJyb3I6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBmYWlsZWQ6IGJvb2xlYW59IHwgdW5kZWZpbmVkfSAtIFJhdyBhdHRlbXB0IG91dGNvbWUuXG4gICAqL1xuICBhdHRlbXB0T3V0Y29tZSh0ZXN0LCBhdHRlbXB0TnVtYmVyKSB7IHJldHVybiB0aGlzLl9hdHRlbXB0T3V0Y29tZXMuZ2V0KHRlc3QpPy5nZXQoYXR0ZW1wdE51bWJlcikgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmRzIGEgcmF3IHN1aXRlLWhvb2sgZmFpbHVyZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGZhaWx1cmUgLSBTdWl0ZS1ob29rIGZhaWx1cmUuXG4gICAqIEBwYXJhbSB7UGFja2FnZVN1aXRlRGVjbGFyYXRpb259IGZhaWx1cmUuc3VpdGUgLSBPd25pbmcgcGFja2FnZSBzdWl0ZS5cbiAgICogQHBhcmFtIHtcImJlZm9yZUFsbFwiIHwgXCJhZnRlckFsbFwifSBmYWlsdXJlLnBoYXNlIC0gSG9vayBwaGFzZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gZmFpbHVyZS5lcnJvciAtIFJhdyBob29rIGZhaWx1cmUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgcmVjb3JkU3VpdGVIb29rRmFpbHVyZShmYWlsdXJlKSB7IHRoaXMuX3N1aXRlSG9va0ZhaWx1cmVzLnB1c2goZmFpbHVyZSkgfVxuXG4gIC8qKlxuICAgKiBHZXRzIHRoZSByYXcgYW5jZXN0b3Igc2V0dXAgZmFpbHVyZSBmb3IgYSBwYWNrYWdlIHRlc3QuXG4gICAqIEBwYXJhbSB7UGFja2FnZVRlc3REZWNsYXJhdGlvbn0gdGVzdCAtIFBhY2thZ2UgdGVzdCBkZWNsYXJhdGlvbi5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIFJhdyBzZXR1cCBmYWlsdXJlLlxuICAgKi9cbiAgc2V0dXBGYWlsdXJlRm9yKHRlc3QpIHtcbiAgICBjb25zdCBzdWl0ZXMgPSB0aGlzLnRlc3RNZXRhZGF0YSh0ZXN0KS5zdWl0ZXNcbiAgICByZXR1cm4gdGhpcy5fc3VpdGVIb29rRmFpbHVyZXMuZmluZCgoZmFpbHVyZSkgPT4gZmFpbHVyZS5waGFzZSA9PT0gXCJiZWZvcmVBbGxcIiAmJiBzdWl0ZXMuaW5jbHVkZXMoZmFpbHVyZS5zdWl0ZSkpPy5lcnJvclxuICB9XG5cbiAgLyoqXG4gICAqIEZpbmRzIHRoZSBuZXh0IGluY29tcGxldGUgZGVjbGFyYXRpb24gd2l0aCBhIHBhY2thZ2UgZnVsbCBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZnVsbE5hbWUgLSBQYWNrYWdlIGZ1bGwgbmFtZS5cbiAgICogQHJldHVybnMge1BhY2thZ2VUZXN0RGVjbGFyYXRpb24gfCB1bmRlZmluZWR9IC0gTmV4dCBtYXRjaGluZyBkZWNsYXJhdGlvbi5cbiAgICovXG4gIGZpbmRUZXN0RGVjbGFyYXRpb24oZnVsbE5hbWUpIHtcbiAgICByZXR1cm4gdGhpcy5fdGVzdHNCeUZ1bGxOYW1lLmdldChmdWxsTmFtZSk/LmZpbmQoKHRlc3QpID0+ICF0aGlzLl9jb21wbGV0ZWRUZXN0cy5oYXModGVzdCkpXG4gIH1cblxuICAvKipcbiAgICogTWFya3MgYSBwYWNrYWdlIGRlY2xhcmF0aW9uIGNvbXBsZXRlLlxuICAgKiBAcGFyYW0ge1BhY2thZ2VUZXN0RGVjbGFyYXRpb259IHRlc3QgLSBDb21wbGV0ZWQgZGVjbGFyYXRpb24uXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgY29tcGxldGVUZXN0RGVjbGFyYXRpb24odGVzdCkgeyB0aGlzLl9jb21wbGV0ZWRUZXN0cy5hZGQodGVzdCkgfVxuXG4gIC8qKlxuICAgKiBHZXRzIHRoZSBlZmZlY3RpdmUgcGFja2FnZSByZXRyeSBjb3VudC5cbiAgICogQHBhcmFtIHtQYWNrYWdlVGVzdERlY2xhcmF0aW9ufSB0ZXN0IC0gUGFja2FnZSB0ZXN0IGRlY2xhcmF0aW9uLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIEVmZmVjdGl2ZSByZXRyeSBjb3VudC5cbiAgICovXG4gIHJldHJ5Q291bnQodGVzdCkge1xuICAgIGNvbnN0IHZhbHVlID0gdGVzdC5vcHRpb25zLnJldHJpZXMgPz8gdGVzdC5vcHRpb25zLnJldHJ5ID8/IHRoaXMuZ2V0VGVzdENvbnRleHQoKS5jb25maWcucmV0cmllc1xuICAgIHJldHVybiB0eXBlb2YgdmFsdWUgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKHZhbHVlKSA/IE1hdGgubWF4KDAsIE1hdGguZmxvb3IodmFsdWUpKSA6IDBcbiAgfVxuXG4gIC8qKlxuICAgKiBOb3JtYWxpemVzIHJldHJ5IGlucHV0cyBmb3IgdGhlIHBhY2thZ2UgZXhlY3V0aW9uIGJvdW5kYXJ5IHdoaWxlIHJldGFpbmluZ1xuICAgKiB0aGUgZGVjbGFyYXRpb25zJyBvcmlnaW5hbCBwdWJsaWMgb3B0aW9ucyBhZnRlciB0aGUgcnVuLlxuICAgKiBAcmV0dXJucyB7KCkgPT4gdm9pZH0gLSBSZXN0b3JlcyBvcmlnaW5hbCBkZWNsYXJhdGlvbiBvcHRpb25zLlxuICAgKi9cbiAgbm9ybWFsaXplUGFja2FnZVJldHJpZXNGb3JFeGVjdXRpb24oKSB7XG4gICAgLyoqIEB0eXBlIHtQYWNrYWdlUmV0cnlPcHRpb25SZXN0b3JhdGlvbltdfSAqL1xuICAgIGNvbnN0IHJlc3RvcmF0aW9ucyA9IFtdXG4gICAgLyoqXG4gICAgICogTm9ybWFsaXplcyBkZWNsYXJhdGlvbnMgaW4gb25lIHN1aXRlLlxuICAgICAqIEBwYXJhbSB7UGFja2FnZVN1aXRlRGVjbGFyYXRpb259IHN1aXRlIC0gU3VpdGUgd2hvc2UgdGVzdHMgYXJlIG5vcm1hbGl6ZWQuXG4gICAgICovXG4gICAgY29uc3QgdmlzaXQgPSAoc3VpdGUpID0+IHtcbiAgICAgIGZvciAoY29uc3QgdGVzdCBvZiBzdWl0ZS50ZXN0cykge1xuICAgICAgICAvLyBDYXB0dXJlIGNvbXBhdGliaWxpdHkgYXJndW1lbnRzIGJlZm9yZSB0ZW1wb3JhcmlseSBhZGFwdGluZyBwYWNrYWdlXG4gICAgICAgIC8vIGV4ZWN1dGlvbiBvcHRpb25zIHNvIGNhbGxiYWNrcyByZXRhaW4gdGhlaXIgZGVjbGFyZWQgdmFsdWVzL2lkZW50aXR5LlxuICAgICAgICB0aGlzLnRlc3REYXRhKHRlc3QpXG4gICAgICAgIHJlc3RvcmF0aW9ucy5wdXNoKHtcbiAgICAgICAgICBoYWRSZXRyaWVzOiBPYmplY3QuaGFzT3duKHRlc3Qub3B0aW9ucywgXCJyZXRyaWVzXCIpLFxuICAgICAgICAgIG9wdGlvbnM6IHRlc3Qub3B0aW9ucyxcbiAgICAgICAgICByZXRyaWVzOiB0ZXN0Lm9wdGlvbnMucmV0cmllc1xuICAgICAgICB9KVxuICAgICAgICB0ZXN0Lm9wdGlvbnMucmV0cmllcyA9IHRoaXMucmV0cnlDb3VudCh0ZXN0KVxuICAgICAgfVxuXG4gICAgICBmb3IgKGNvbnN0IGNoaWxkU3VpdGUgb2Ygc3VpdGUuc3VpdGVzKSB2aXNpdChjaGlsZFN1aXRlKVxuICAgIH1cblxuICAgIGZvciAoY29uc3Qgc3VpdGUgb2YgdGhpcy5nZXRUZXN0Q29udGV4dCgpLnJlZ2lzdHJ5LnN1aXRlcykgdmlzaXQoc3VpdGUpXG5cbiAgICByZXR1cm4gKCkgPT4ge1xuICAgICAgZm9yIChjb25zdCByZXN0b3JhdGlvbiBvZiByZXN0b3JhdGlvbnMpIHtcbiAgICAgICAgaWYgKHJlc3RvcmF0aW9uLmhhZFJldHJpZXMpIHJlc3RvcmF0aW9uLm9wdGlvbnMucmV0cmllcyA9IHJlc3RvcmF0aW9uLnJldHJpZXNcbiAgICAgICAgZWxzZSBkZWxldGUgcmVzdG9yYXRpb24ub3B0aW9ucy5yZXRyaWVzXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgb25lIGNvbXBsZXRlZCB0ZXN0IGR1cmF0aW9uLlxuICAgKiBAcGFyYW0ge3tkdXJhdGlvbk1zOiBudW1iZXIsIGZpbGVQYXRoOiBzdHJpbmcsIGZ1bGxEZXNjcmlwdGlvbjogc3RyaW5nLCBsaW5lOiBudW1iZXJ9fSBkdXJhdGlvbiAtIENvbXBsZXRlZCB0ZXN0IGR1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHJlY29yZFRlc3REdXJhdGlvbihkdXJhdGlvbikgeyB0aGlzLl90ZXN0RHVyYXRpb25zLnB1c2goZHVyYXRpb24pIH1cblxuICAvKiogUmVjb3JkcyBvbmUgc3VjY2Vzc2Z1bCBwYWNrYWdlIHJlc3VsdC4gKi9cbiAgcmVjb3JkU3VjY2Vzc2Z1bFRlc3QoKSB7IHRoaXMuX3N1Y2Nlc3NmdWxUZXN0cysrIH1cblxuICAvKipcbiAgICogUmVjb3JkcyBvbmUgZmFpbGVkIHBhY2thZ2UgdGVzdCBpbiB0aGUgbGVnYWN5IHJlc3VsdCBwcm9qZWN0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEZhaWxlZCB0ZXN0IG1ldGFkYXRhLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBhcmdzLmRlc2NyaXB0aW9ucyAtIFBhcmVudCBkZXNjcmlwdGlvbnMuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MuZXJyb3IgLSBSYXcgZmFpbHVyZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuY29uc29sZU91dHB1dCAtIENhcHR1cmVkIGNvbnNvbGUgb3V0cHV0LlxuICAgKiBAcGFyYW0ge1Rlc3REYXRhfSBhcmdzLnRlc3REYXRhIC0gQ29tcGF0aWJpbGl0eSB0ZXN0IGRhdGEuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnRlc3REZXNjcmlwdGlvbiAtIFRlc3QgZGVzY3JpcHRpb24uXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgcmVjb3JkRmFpbGVkVGVzdCh7ZGVzY3JpcHRpb25zLCBlcnJvciwgY29uc29sZU91dHB1dCwgdGVzdERhdGEsIHRlc3REZXNjcmlwdGlvbn0pIHtcbiAgICB0aGlzLl9mYWlsZWRUZXN0cysrXG4gICAgdGhpcy5fZmFpbGVkVGVzdERldGFpbHMucHVzaCh7XG4gICAgICBmdWxsRGVzY3JpcHRpb246IHRoaXMuYnVpbGRGdWxsRGVzY3JpcHRpb24oZGVzY3JpcHRpb25zLCB0ZXN0RGVzY3JpcHRpb24pLFxuICAgICAgZmlsZVBhdGg6IHRlc3REYXRhLmZpbGVQYXRoLFxuICAgICAgbGluZTogdGVzdERhdGEubGluZSxcbiAgICAgIGVycm9yLFxuICAgICAgY29uc29sZU91dHB1dDogY29uc29sZU91dHB1dCB8fCB1bmRlZmluZWRcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFN0b3JlcyB0aGUgY29tcGxldGVkIHBhY2thZ2UgcmVzdWx0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIkB2ZWxvY2lvdXMvdGVzdGluZy9ydW5uZXJcIikuVGVzdFJ1blJlc3VsdH0gcmVzdWx0IC0gUGFja2FnZSByZXN1bHQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgcmVjb3JkUGFja2FnZVJlc3VsdChyZXN1bHQpIHsgdGhpcy5fcGFja2FnZVJlc3VsdCA9IHJlc3VsdCB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdGhlIHBhY2thZ2Uga2VybmVsIHdpdGggVmVsb2Npb3VzIGZyYW1ld29yayBhZGFwdGVycy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgZXhlY3V0aW9uIGFuZCB0ZWFyZG93bi5cbiAgICovXG4gIGFzeW5jIHJ1blBhY2thZ2VUZXN0cygpIHtcbiAgICBjb25zdCBlbnZpcm9ubWVudEhhbmRsZXIgPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKVxuICAgIGVudmlyb25tZW50SGFuZGxlci5pbnN0YWxsU2hhcmVkVHJhbnNhY3Rpb25Db29yZGluYXRvck93bmVyU3RvcmFnZSh0aGlzLl9zaGFyZWRUcmFuc2FjdGlvbkNvb3JkaW5hdG9yT3duZXJTdG9yYWdlKVxuICAgIGVudmlyb25tZW50SGFuZGxlci5pbnN0YWxsVGVzdERhdGFiYXNlQWNjZXNzU2NvcGVTdG9yYWdlKHRoaXMuX3Rlc3REYXRhYmFzZUFjY2Vzc1Njb3BlU3RvcmFnZSlcbiAgICB0aGlzLl9wYWNrYWdlUnVubmVyID0gbmV3IFBhY2thZ2VUZXN0UnVubmVyKHtcbiAgICAgIGNvbnRleHQ6IHRoaXMuZ2V0VGVzdENvbnRleHQoKSxcbiAgICAgIGluY2x1ZGVUYWdzOiB0aGlzLl9pbmNsdWRlVGFncyxcbiAgICAgIGV4Y2x1ZGVUYWdzOiBbLi4udGhpcy5nZXRFeGNsdWRlVGFnU2V0KCksIC4uLih0aGlzLmlzQnJvd3NlclRlc3RNb2RlKCkgPyBbXSA6IFtcImJyb3dzZXItb25seVwiXSldLFxuICAgICAgZXhhbXBsZXM6IHRoaXMuZ2V0RXhhbXBsZVBhdHRlcm5zKCksXG4gICAgICBsaW5lRmlsdGVyczogdGhpcy5nZXRMaW5lRmlsdGVycygpLFxuICAgICAgaW5jbHVkZVRhZ01vZGU6IFwiYW55XCIsXG4gICAgICBmb2N1c2VkVGVzdHNCeXBhc3NJbmNsdWRlVGFnczogdHJ1ZSxcbiAgICAgIG9taXRFbXB0eVN1aXRlTmFtZXM6IHRydWUsXG4gICAgICBhdHRlbXB0RXhlY3V0b3JPd25zVGltZW91dDogdHJ1ZSxcbiAgICAgIGF0dGVtcHRFeGVjdXRvcjogKGlucHV0KSA9PiB0aGlzLl9hdHRlbXB0RXhlY3V0b3IuZXhlY3V0ZShpbnB1dCksXG4gICAgICB0ZXN0QXJndW1lbnRSZXNvbHZlcjogKGlucHV0KSA9PiB0aGlzLl90ZXN0QXJndW1lbnRzLnJlc29sdmUoaW5wdXQpLFxuICAgICAgc3VpdGVIb29rRXhlY3V0b3I6IChpbnB1dCkgPT4gdGhpcy5fc3VpdGVIb29rRXhlY3V0b3IuZXhlY3V0ZShpbnB1dCksXG4gICAgICByZXBvcnRlcjogdGhpcy5fcnVubmVyUmVwb3J0ZXJcbiAgICB9KVxuICAgIGNvbnN0IGZhaWx1cmVTdGFydCA9IHRoaXMuX3N1aXRlSG9va0ZhaWx1cmVzLmxlbmd0aFxuICAgIGNvbnN0IHJlc3RvcmVSZXRyeU9wdGlvbnMgPSB0aGlzLm5vcm1hbGl6ZVBhY2thZ2VSZXRyaWVzRm9yRXhlY3V0aW9uKClcbiAgICBsZXQgcmVzdWx0XG5cbiAgICB0cnkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgcmVzdWx0ID0gYXdhaXQgdGhpcy5fcGFja2FnZVJ1bm5lci5ydW4oKVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgaWYgKCEoZXJyb3IgaW5zdGFuY2VvZiBBYm9ydFJlbWFpbmluZ1Rlc3RzRXJyb3IpKSB0aHJvdyBlcnJvclxuXG4gICAgICAgIGNvbnN0IGFmdGVyQWxsID0gdGhpcy5hZnRlckFsbE91dGNvbWUodGhpcy5fc3VpdGVIb29rRmFpbHVyZXMuc2xpY2UoZmFpbHVyZVN0YXJ0KSlcbiAgICAgICAgaWYgKGFmdGVyQWxsLmZhaWxlZCkgdGhpcy5yZWNvcmRUaW1lb3V0Q2xlYW51cEZhaWx1cmUoYWZ0ZXJBbGwuZXJyb3IsIFwiYWZ0ZXJBbGxcIilcbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG5cbiAgICAgIHRoaXMucmVjb3JkUGFja2FnZVJlc3VsdChyZXN1bHQpXG4gICAgICB0aGlzLnRocm93QWZ0ZXJBbGxGYWlsdXJlcyh0aGlzLl9zdWl0ZUhvb2tGYWlsdXJlcy5zbGljZShmYWlsdXJlU3RhcnQpKVxuICAgIH0gZmluYWxseSB7XG4gICAgICByZXN0b3JlUmV0cnlPcHRpb25zKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQWdncmVnYXRlcyByYXcgYWZ0ZXItYWxsIGZhaWx1cmVzIHdpdGhvdXQgdXNpbmcgZXJyb3IgdHJ1dGhpbmVzcy5cbiAgICogQHBhcmFtIHtBcnJheTx7cGhhc2U6IFwiYmVmb3JlQWxsXCIgfCBcImFmdGVyQWxsXCIsIGVycm9yOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0+fSBmYWlsdXJlcyAtIEhvb2sgZmFpbHVyZXMuXG4gICAqIEByZXR1cm5zIHt7ZmFpbGVkOiBmYWxzZX0gfCB7ZmFpbGVkOiB0cnVlLCBlcnJvcjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59fSAtIEV4cGxpY2l0IGFmdGVyQWxsIG91dGNvbWUuXG4gICAqL1xuICBhZnRlckFsbE91dGNvbWUoZmFpbHVyZXMpIHtcbiAgICBjb25zdCBhZnRlckFsbEVycm9ycyA9IGZhaWx1cmVzLmZpbHRlcigoZmFpbHVyZSkgPT4gZmFpbHVyZS5waGFzZSA9PT0gXCJhZnRlckFsbFwiKS5tYXAoKGZhaWx1cmUpID0+IGZhaWx1cmUuZXJyb3IpXG5cbiAgICBpZiAoYWZ0ZXJBbGxFcnJvcnMubGVuZ3RoID09PSAwKSByZXR1cm4ge2ZhaWxlZDogZmFsc2V9XG4gICAgaWYgKGFmdGVyQWxsRXJyb3JzLmxlbmd0aCA9PT0gMSkgcmV0dXJuIHtmYWlsZWQ6IHRydWUsIGVycm9yOiBhZnRlckFsbEVycm9yc1swXX1cbiAgICByZXR1cm4ge1xuICAgICAgZmFpbGVkOiB0cnVlLFxuICAgICAgZXJyb3I6IG5ldyBBZ2dyZWdhdGVFcnJvcihhZnRlckFsbEVycm9ycywgXCJNdWx0aXBsZSBhY3RpdmUgYWZ0ZXJBbGwgc2NvcGVzIGZhaWxlZFwiLCB7Y2F1c2U6IGFmdGVyQWxsRXJyb3JzWzBdfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogVGhyb3dzIG9uZSByYXcgb3IgYWdncmVnYXRlZCBhZnRlci1hbGwgZmFpbHVyZS5cbiAgICogQHBhcmFtIHtBcnJheTx7cGhhc2U6IFwiYmVmb3JlQWxsXCIgfCBcImFmdGVyQWxsXCIsIGVycm9yOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0+fSBmYWlsdXJlcyAtIEhvb2sgZmFpbHVyZXMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgdGhyb3dBZnRlckFsbEZhaWx1cmVzKGZhaWx1cmVzKSB7XG4gICAgY29uc3QgYWZ0ZXJBbGwgPSB0aGlzLmFmdGVyQWxsT3V0Y29tZShmYWlsdXJlcylcblxuICAgIGlmIChhZnRlckFsbC5mYWlsZWQpIHRocm93IGFmdGVyQWxsLmVycm9yXG4gIH1cblxuICAvKipcbiAgICogQ29tcGF0aWJpbGl0eSBoZWxwZXIgZm9yIGZvY3VzZWQgZnJhbWV3b3JrIGxpZmVjeWNsZSBzcGVjcy4gSXQgY29udmVydHMgYW5cbiAgICogZXhwbGljaXQgbGVnYWN5IGZpeHR1cmUgaW50byBpc29sYXRlZCBwYWNrYWdlIGRlY2xhcmF0aW9uczsgdGhlIHBhY2thZ2VcbiAgICogcnVubmVyIHJlbWFpbnMgdGhlIHNvbGUgZXhlY3V0aW9uIGVuZ2luZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBMZWdhY3kgZml4dHVyZSBhcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7VGVzdHNBcmd1bWVudH0gYXJncy50ZXN0cyAtIEZpeHR1cmUgdHJlZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgcGFja2FnZSBleGVjdXRpb24uXG4gICAqL1xuICBhc3luYyBydW5UZXN0cyh7dGVzdHN9KSB7XG4gICAgY29uc3QgY29udGV4dCA9IGNyZWF0ZVRlc3RDb250ZXh0KClcbiAgICBjb25zdCBvcmlnaW5hbENvbnRleHQgPSB0aGlzLl9jb250ZXh0XG4gICAgY29udGV4dC5jb25maWd1cmVUZXN0cyh7XG4gICAgICBjb25zb2xlT3V0cHV0OiBvcmlnaW5hbENvbnRleHQuY29uZmlnLmNvbnNvbGVPdXRwdXQsXG4gICAgICBkZWZhdWx0VGltZW91dE1zOiBvcmlnaW5hbENvbnRleHQuY29uZmlnLmRlZmF1bHRUaW1lb3V0TXMsXG4gICAgICBleGNsdWRlVGFnczogb3JpZ2luYWxDb250ZXh0LmNvbmZpZy5leGNsdWRlVGFncyxcbiAgICAgIGZhaWxlZENvbnNvbGVPdXRwdXRNYXhMaW5lczogb3JpZ2luYWxDb250ZXh0LmNvbmZpZy5mYWlsZWRDb25zb2xlT3V0cHV0TWF4TGluZXMsXG4gICAgICByZXRyaWVzOiBvcmlnaW5hbENvbnRleHQuY29uZmlnLnJldHJpZXNcbiAgICB9KVxuICAgIHRoaXMuX2NvbnRleHQgPSBjb250ZXh0XG4gICAgdGhpcy5fdGVzdHNDb3VudCA9IDBcbiAgICB0aGlzLl90ZXN0Q29tcGF0aWJpbGl0eSA9IG5ldyBXZWFrTWFwKClcbiAgICB0aGlzLl9pbmplY3RlZFRlc3RzID0gbmV3IFdlYWtTZXQoKVxuICAgIHRoaXMuX2NvbXBsZXRlZFRlc3RzID0gbmV3IFdlYWtTZXQoKVxuICAgIHRoaXMuX3Rlc3RNZXRhZGF0YSA9IG5ldyBXZWFrTWFwKClcbiAgICB0aGlzLl9ob29rTWV0YWRhdGEgPSBuZXcgV2Vha01hcCgpXG4gICAgdGhpcy5fYXR0ZW1wdE91dGNvbWVzID0gbmV3IFdlYWtNYXAoKVxuICAgIHRoaXMuX3N1aXRlSG9va0ZhaWx1cmVzID0gW11cbiAgICB0aGlzLl90ZXN0c0J5RnVsbE5hbWUgPSBuZXcgTWFwKClcbiAgICB0aGlzLl9sZWdhY3lGaXh0dXJlRGF0YUJ5RnVsbE5hbWUgPSBuZXcgTWFwKClcbiAgICBjb250ZXh0LnNldERlY2xhcmF0aW9uTG9jYXRvcigoKSA9PiB0aGlzLl9sZWdhY3lGaXh0dXJlTG9jYXRpb24pXG4gICAgdGhpcy5kZWNsYXJlTGVnYWN5Rml4dHVyZShjb250ZXh0LCBcIlwiLCB0ZXN0cywgW10pXG4gICAgdGhpcy5hbmFseXplRGVjbGFyYXRpb25zKClcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLnJ1blBhY2thZ2VUZXN0cygpXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMuX2NvbnRleHQgPSBvcmlnaW5hbENvbnRleHRcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRGVjbGFyZXMgYW4gaXNvbGF0ZWQgbGVnYWN5LXNoYXBlZCB0ZXN0IGZpeHR1cmUgaW50byBhIHBhY2thZ2UgY29udGV4dC5cbiAgICogQHBhcmFtIHtQYWNrYWdlVGVzdENvbnRleHR9IGNvbnRleHQgLSBJc29sYXRlZCBwYWNrYWdlIGNvbnRleHQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gU3VpdGUgbmFtZS5cbiAgICogQHBhcmFtIHtUZXN0c0FyZ3VtZW50fSBzY29wZSAtIExlZ2FjeSBmaXh0dXJlIHNjb3BlLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBkZXNjcmlwdGlvbnMgLSBBbmNlc3RvciBkZXNjcmlwdGlvbnMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgZGVjbGFyZUxlZ2FjeUZpeHR1cmUoY29udGV4dCwgbmFtZSwgc2NvcGUsIGRlc2NyaXB0aW9ucykge1xuICAgIHRoaXMuX2xlZ2FjeUZpeHR1cmVMb2NhdGlvbiA9IHtmaWxlUGF0aDogc2NvcGUuZmlsZVBhdGgsIGxpbmU6IHNjb3BlLmxpbmV9XG4gICAgY29udGV4dC5kZXNjcmliZShuYW1lLCBzY29wZS5hcmdzIHx8IHt9LCAoKSA9PiB7XG4gICAgICBmb3IgKGNvbnN0IGhvb2sgb2Ygc2NvcGUuYmVmb3JlQWxscyB8fCBbXSkgY29udGV4dC5iZWZvcmVBbGwoaG9vay5jYWxsYmFjaylcbiAgICAgIGZvciAoY29uc3QgaG9vayBvZiBzY29wZS5iZWZvcmVFYWNoZXMgfHwgW10pIGNvbnRleHQuYmVmb3JlRWFjaChob29rLmNhbGxiYWNrKVxuICAgICAgZm9yIChjb25zdCBob29rIG9mIHNjb3BlLmFmdGVyRWFjaGVzIHx8IFtdKSBjb250ZXh0LmFmdGVyRWFjaChob29rLmNhbGxiYWNrKVxuICAgICAgZm9yIChjb25zdCBob29rIG9mIHNjb3BlLmFmdGVyQWxscyB8fCBbXSkgY29udGV4dC5hZnRlckFsbChob29rLmNhbGxiYWNrKVxuICAgICAgY29uc3QgbmV4dERlc2NyaXB0aW9ucyA9IG5hbWUgPT09IFwiXCIgPyBkZXNjcmlwdGlvbnMgOiBbLi4uZGVzY3JpcHRpb25zLCBuYW1lXVxuICAgICAgZm9yIChjb25zdCBbdGVzdE5hbWUsIHRlc3REYXRhXSBvZiBPYmplY3QuZW50cmllcyhzY29wZS50ZXN0cyB8fCB7fSkpIHtcbiAgICAgICAgdGhpcy5fbGVnYWN5Rml4dHVyZUxvY2F0aW9uID0ge2ZpbGVQYXRoOiB0ZXN0RGF0YS5maWxlUGF0aCwgbGluZTogdGVzdERhdGEubGluZX1cbiAgICAgICAgdGhpcy5fbGVnYWN5Rml4dHVyZURhdGFCeUZ1bGxOYW1lPy5zZXQodGhpcy5idWlsZEZ1bGxEZXNjcmlwdGlvbihuZXh0RGVzY3JpcHRpb25zLCB0ZXN0TmFtZSksIHRlc3REYXRhKVxuICAgICAgICBjb250ZXh0Lml0KHRlc3ROYW1lLCB0ZXN0RGF0YS5hcmdzLCB0ZXN0RGF0YS5mdW5jdGlvbilcbiAgICAgIH1cbiAgICAgIGZvciAoY29uc3QgW3N1aXRlTmFtZSwgY2hpbGRTY29wZV0gb2YgT2JqZWN0LmVudHJpZXMoc2NvcGUuc3VicyB8fCB7fSkpIHtcbiAgICAgICAgdGhpcy5kZWNsYXJlTGVnYWN5Rml4dHVyZShjb250ZXh0LCBzdWl0ZU5hbWUsIGNoaWxkU2NvcGUsIG5leHREZXNjcmlwdGlvbnMpXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGVtaXQgZXZlbnQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBldmVudE5hbWUgLSBFdmVudCBuYW1lLlxuICAgKiBAcGFyYW0ge29iamVjdH0gcGF5bG9hZCAtIEV2ZW50IHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gYWxsIGxpc3RlbmVycyBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGVtaXRFdmVudChldmVudE5hbWUsIHBheWxvYWQpIHtcbiAgICBhd2FpdCB0aGlzLl9ydW5uZXJSZXBvcnRlci5lbWl0RXZlbnQoZXZlbnROYW1lLCBwYXlsb2FkKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcHJpbnQgcmVydW4gY29tbWFuZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gYXJncy5kZXNjcmlwdGlvbnMgLSBEZXNjcmlwdGlvbiBzdGFjay5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MudGVzdERlc2NyaXB0aW9uIC0gVGVzdCBkZXNjcmlwdGlvbi5cbiAgICogQHBhcmFtIHtUZXN0RGF0YX0gYXJncy50ZXN0RGF0YSAtIFRlc3QgZGF0YS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubGVmdFBhZGRpbmcgLSBMZWZ0IHBhZGRpbmcuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHByaW50UmVydW5Db21tYW5kKHtkZXNjcmlwdGlvbnMsIHRlc3REZXNjcmlwdGlvbiwgdGVzdERhdGEsIGxlZnRQYWRkaW5nfSkge1xuICAgIGNvbnN0IHJlcnVuID0gdGhpcy5idWlsZFJlcnVuQ29tbWFuZCh7ZGVzY3JpcHRpb25zLCB0ZXN0RGVzY3JpcHRpb24sIHRlc3REYXRhfSlcblxuICAgIGlmIChyZXJ1bikge1xuICAgICAgY29uc29sZS5lcnJvcihgJHtsZWZ0UGFkZGluZ30gIFJlLXJ1bjogJHtyZXJ1bn1gKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJ1aWxkIHJlcnVuIGNvbW1hbmQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGFyZ3MuZGVzY3JpcHRpb25zIC0gRGVzY3JpcHRpb24gc3RhY2suXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnRlc3REZXNjcmlwdGlvbiAtIFRlc3QgZGVzY3JpcHRpb24uXG4gICAqIEBwYXJhbSB7VGVzdERhdGF9IGFyZ3MudGVzdERhdGEgLSBUZXN0IGRhdGEuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gUmVydW4gY29tbWFuZC5cbiAgICovXG4gIGJ1aWxkUmVydW5Db21tYW5kKHtkZXNjcmlwdGlvbnMsIHRlc3REZXNjcmlwdGlvbiwgdGVzdERhdGF9KSB7XG4gICAgY29uc3QgYmFzZUNvbW1hbmQgPSBcIm5weCB2ZWxvY2lvdXMgdGVzdFwiXG4gICAgY29uc3QgZmlsZVBhdGggPSB0ZXN0RGF0YS5maWxlUGF0aFxuICAgIGNvbnN0IGxpbmUgPSB0ZXN0RGF0YS5saW5lXG5cbiAgICBpZiAoZmlsZVBhdGggJiYgbGluZSkge1xuICAgICAgY29uc3QgcmVsYXRpdmVQYXRoID0gcGF0aC5yZWxhdGl2ZShwcm9jZXNzLmN3ZCgpLCBmaWxlUGF0aClcbiAgICAgIHJldHVybiBgJHtiYXNlQ29tbWFuZH0gJHtyZWxhdGl2ZVBhdGh9OiR7bGluZX1gXG4gICAgfVxuXG4gICAgY29uc3QgZnVsbERlc2NyaXB0aW9uID0gdGhpcy5idWlsZEZ1bGxEZXNjcmlwdGlvbihkZXNjcmlwdGlvbnMsIHRlc3REZXNjcmlwdGlvbilcblxuICAgIGlmIChmdWxsRGVzY3JpcHRpb24pIHtcbiAgICAgIHJldHVybiBgJHtiYXNlQ29tbWFuZH0gLS1leGFtcGxlICR7SlNPTi5zdHJpbmdpZnkoZnVsbERlc2NyaXB0aW9uKX1gXG4gICAgfVxuXG4gICAgcmV0dXJuIHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYnVpbGQgY29uc29sZSBvdXRwdXQuXG4gICAqIEBwYXJhbSB7QXR0ZW1wdENvbnNvbGVPdXRwdXRbXX0gYXR0ZW1wdENvbnNvbGVPdXRwdXRzIC0gQXR0ZW1wdCBvdXRwdXQgZW50cmllcy5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBDb21iaW5lZCBjb25zb2xlIG91dHB1dC5cbiAgICovXG4gIGJ1aWxkQ29uc29sZU91dHB1dChhdHRlbXB0Q29uc29sZU91dHB1dHMpIHtcbiAgICBpZiAoYXR0ZW1wdENvbnNvbGVPdXRwdXRzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFwiXCJcbiAgICBpZiAoYXR0ZW1wdENvbnNvbGVPdXRwdXRzLmxlbmd0aCA9PT0gMSkgcmV0dXJuIGF0dGVtcHRDb25zb2xlT3V0cHV0c1swXS5vdXRwdXRcblxuICAgIHJldHVybiBhdHRlbXB0Q29uc29sZU91dHB1dHMubWFwKChhdHRlbXB0Q29uc29sZU91dHB1dCkgPT4ge1xuICAgICAgcmV0dXJuIGAtLS0gQXR0ZW1wdCAke2F0dGVtcHRDb25zb2xlT3V0cHV0LmF0dGVtcHROdW1iZXJ9IC0tLVxcbiR7YXR0ZW1wdENvbnNvbGVPdXRwdXQub3V0cHV0fWBcbiAgICB9KS5qb2luKFwiXFxuXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZmFpbGVkIGNvbnNvbGUgb3V0cHV0IG1heCBsaW5lcy5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBNYXhpbXVtIGZhaWxlZCBjb25zb2xlIGxpbmVzLlxuICAgKi9cbiAgZ2V0RmFpbGVkQ29uc29sZU91dHB1dE1heExpbmVzKCkge1xuICAgIGNvbnN0IG1heExpbmVzID0gdGVzdENvbmZpZy5mYWlsZWRDb25zb2xlT3V0cHV0TWF4TGluZXNcblxuICAgIGlmICh0eXBlb2YgbWF4TGluZXMgIT09IFwibnVtYmVyXCIgfHwgIU51bWJlci5pc0Zpbml0ZShtYXhMaW5lcykpIHJldHVybiAyMDBcblxuICAgIHJldHVybiBNYXRoLm1heCgwLCBNYXRoLmZsb29yKG1heExpbmVzKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRydW5jYXRlIGZhaWxlZCBjb25zb2xlIG91dHB1dCBsaW5lcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbnNvbGVPdXRwdXQgLSBDb25zb2xlIG91dHB1dC5cbiAgICogQHJldHVybnMge3N0cmluZ1tdfSAtIExpbmVzIGZvciBpbmxpbmUgb3V0cHV0LlxuICAgKi9cbiAgdHJ1bmNhdGVGYWlsZWRDb25zb2xlT3V0cHV0TGluZXMoY29uc29sZU91dHB1dCkge1xuICAgIGNvbnN0IGxpbmVzID0gY29uc29sZU91dHB1dC5zcGxpdChcIlxcblwiKVxuICAgIGNvbnN0IG1heExpbmVzID0gdGhpcy5nZXRGYWlsZWRDb25zb2xlT3V0cHV0TWF4TGluZXMoKVxuXG4gICAgaWYgKG1heExpbmVzID09PSAwKSByZXR1cm4gW11cbiAgICBpZiAobGluZXMubGVuZ3RoIDw9IG1heExpbmVzKSByZXR1cm4gbGluZXNcblxuICAgIGNvbnN0IG9taXR0ZWRMaW5lcyA9IGxpbmVzLmxlbmd0aCAtIG1heExpbmVzXG4gICAgY29uc3QgcGx1cmFsID0gb21pdHRlZExpbmVzID09PSAxID8gXCJcIiA6IFwic1wiXG5cbiAgICByZXR1cm4gW1xuICAgICAgYC4uLiAke29taXR0ZWRMaW5lc30gY29uc29sZSBvdXRwdXQgbGluZSR7cGx1cmFsfSBvbWl0dGVkIC4uLmAsXG4gICAgICAuLi5saW5lcy5zbGljZSgtbWF4TGluZXMpXG4gICAgXVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcHJpbnQgZmFpbGVkIGNvbnNvbGUgb3V0cHV0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jb25zb2xlT3V0cHV0IC0gQ29uc29sZSBvdXRwdXQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmxlZnRQYWRkaW5nIC0gTGVmdCBwYWRkaW5nLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBwcmludEZhaWxlZENvbnNvbGVPdXRwdXQoe2NvbnNvbGVPdXRwdXQsIGxlZnRQYWRkaW5nfSkge1xuICAgIGlmICh0ZXN0Q29uZmlnLmNvbnNvbGVPdXRwdXQgIT09IFwiZmFpbHVyZVwiKSByZXR1cm5cbiAgICBpZiAoIWNvbnNvbGVPdXRwdXQpIHJldHVyblxuXG4gICAgY29uc3QgbGluZXMgPSB0aGlzLnRydW5jYXRlRmFpbGVkQ29uc29sZU91dHB1dExpbmVzKGNvbnNvbGVPdXRwdXQpXG5cbiAgICBpZiAobGluZXMubGVuZ3RoID09PSAwKSByZXR1cm5cblxuICAgIGNvbnNvbGUuZXJyb3IocGljb2NvbG9ycy5yZWQoYCR7bGVmdFBhZGRpbmd9ICBDb25zb2xlIG91dHB1dDpgKSlcblxuICAgIGZvciAoY29uc3QgbGluZSBvZiBsaW5lcykge1xuICAgICAgY29uc29sZS5lcnJvcihwaWNvY29sb3JzLnJlZChgJHtsZWZ0UGFkZGluZ30gICAgJHtsaW5lfWApKVxuICAgIH1cbiAgfVxuXG59XG4iXX0=