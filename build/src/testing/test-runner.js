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
     * Gets the raw ancestor setup failure outcome for a package test.
     * @param {PackageTestDeclaration} test - Package test declaration.
     * @returns {{failed: false} | {failed: true, error: ReturnType<typeof JSON.parse>}} - Raw setup failure outcome.
     */
    setupFailureOutcomeFor(test) {
        const suites = this.testMetadata(test).suites;
        const failure = this._suiteHookFailures.find((entry) => entry.phase === "beforeAll" && suites.includes(entry.suite));
        return failure ? { failed: true, error: failure.error } : { failed: false };
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGVzdC1ydW5uZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvdGVzdGluZy90ZXN0LXJ1bm5lci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxFQUFFLE1BQU0sa0JBQWtCLENBQUE7QUFDakMsT0FBTyxJQUFJLE1BQU0sTUFBTSxDQUFBO0FBQ3ZCLE9BQU8sRUFBQyxpQkFBaUIsRUFBQyxNQUFNLGtCQUFrQixDQUFBO0FBQ2xELE9BQU8sRUFBQyxpQkFBaUIsRUFBRSxrQkFBa0IsRUFBQyxNQUFNLG9CQUFvQixDQUFBO0FBQ3hFLE9BQU8sRUFBQyxVQUFVLElBQUksaUJBQWlCLEVBQUMsTUFBTSwyQkFBMkIsQ0FBQTtBQUN6RSxPQUFPLFdBQVcsTUFBTSwwQkFBMEIsQ0FBQTtBQUNsRCxPQUFPLGFBQWEsTUFBTSxxQkFBcUIsQ0FBQTtBQUMvQyxPQUFPLFVBQVUsTUFBTSxZQUFZLENBQUE7QUFDbkMsT0FBTyxhQUFhLE1BQU0sNkJBQTZCLENBQUE7QUFDdkQsT0FBTyxFQUFDLFVBQVUsRUFBQyxNQUFNLFdBQVcsQ0FBQTtBQUNwQyxPQUFPLEVBQUMsYUFBYSxFQUFFLGFBQWEsRUFBQyxNQUFNLEtBQUssQ0FBQTtBQUNoRCxPQUFPLHVCQUF1QixNQUFNLGdDQUFnQyxDQUFBO0FBQ3BFLE9BQU8sRUFBRSw2QkFBNkIsRUFBRSxNQUFNLHNDQUFzQyxDQUFBO0FBQ3BGLE9BQU8sd0JBQXdCLE1BQU0saUNBQWlDLENBQUE7QUFDdEUsT0FBTyx1QkFBdUIsRUFBRSxFQUFDLHdCQUF3QixFQUFDLE1BQU0sZ0NBQWdDLENBQUE7QUFDaEcsT0FBTywwQkFBMEIsTUFBTSxvQ0FBb0MsQ0FBQTtBQUMzRSxPQUFPLHNCQUFzQixNQUFNLCtCQUErQixDQUFBO0FBRWxFLDhEQUE4RDtBQUM5RCw2RkFBNkY7QUFDN0YsaUZBQWlGO0FBQ2pGLDhGQUE4RjtBQUM5RiwrR0FBK0c7QUFDL0csOElBQThJO0FB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Q0FBQyxRQUFRLEVBQUUsSUFBSSxFQUFFLEtBQUssQ0FBQyxJQUFJLEVBQUMsQ0FBQTtRQUMxRSxPQUFPLENBQUMsUUFBUSxDQUFDLElBQUksRUFBRSxLQUFLLENBQUMsSUFBSSxJQUFJLEVBQUUsRUFBRSxHQUFHLEVBQUU7WUFDNUMsS0FBSyxNQUFNLElBQUksSUFBSSxLQUFLLENBQUMsVUFBVSxJQUFJLEVBQUU7Z0JBQUUsT0FBTyxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUE7WUFDM0UsS0FBSyxNQUFNLElBQUksSUFBSSxLQUFLLENBQUMsWUFBWSxJQUFJLEVBQUU7Z0JBQUUsT0FBTyxDQUFDLFVBQVUsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUE7WUFDOUUsS0FBSyxNQUFNLElBQUksSUFBSSxLQUFLLENBQUMsV0FBVyxJQUFJLEVBQUU7Z0JBQUUsT0FBTyxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUE7WUFDNUUsS0FBSyxNQUFNLElBQUksSUFBSSxLQUFLLENBQUMsU0FBUyxJQUFJLEVBQUU7Z0JBQUUsT0FBTyxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUE7WUFDekUsTUFBTSxnQkFBZ0IsR0FBRyxJQUFJLEtBQUssRUFBRSxDQUFDLENBQUMsQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxZQUFZLEVBQUUsSUFBSSxDQUFDLENBQUE7WUFDN0UsS0FBSyxNQUFNLENBQUMsUUFBUSxFQUFFLFFBQVEsQ0FBQyxJQUFJLE1BQU0sQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLEtBQUssSUFBSSxFQUFFLENBQUMsRUFBRSxDQUFDO2dCQUNyRSxJQUFJLENBQUMsc0JBQXNCLEdBQUcsRUFBQyxRQUFRLEVBQUUsUUFBUSxDQUFDLFFBQVEsRUFBRSxJQUFJLEVBQUUsUUFBUSxDQUFDLElBQUksRUFBQyxDQUFBO2dCQUNoRixJQUFJLENBQUMsNEJBQTRCLEVBQUUsR0FBRyxDQUFDLElBQUksQ0FBQyxvQkFB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LENBQUMsR0FBRyxXQUFXLG1CQUFtQixDQUFDLENBQUMsQ0FBQTtRQUVoRSxLQUFLLE1BQU0sSUFBSSxJQUFJLEtBQUssRUFBRSxDQUFDO1lBQ3pCLE9BQU8sQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDLEdBQUcsQ0FBQyxHQUFHLFdBQVcsT0FBTyxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUE7UUFDNUQsQ0FBQztJQUNILENBQUM7Q0FFRiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgZnMgZnJvbSBcIm5vZGU6ZnMvcHJvbWlzZXNcIlxuaW1wb3J0IHBhdGggZnJvbSBcInBhdGhcIlxuaW1wb3J0IHtBc3luY0xvY2FsU3RvcmFnZX0gZnJvbSBcIm5vZGU6YXN5bmNfaG9va3NcIlxuaW1wb3J0IHtjcmVhdGVUZXN0Q29udGV4dCwgZGVmYXVsdFRlc3RDb250ZXh0fSBmcm9tIFwiQHZlbG9jaW91cy90ZXN0aW5nXCJcbmltcG9ydCB7VGVzdFJ1bm5lciBhcyBQYWNrYWdlVGVzdFJ1bm5lcn0gZnJvbSBcIkB2ZWxvY2lvdXMvdGVzdGluZy9ydW5uZXJcIlxuaW1wb3J0IEFwcGxpY2F0aW9uIGZyb20gXCIuLi8uLi9zcmMvYXBwbGljYXRpb24uanNcIlxuaW1wb3J0IFJlcXVlc3RDbGllbnQgZnJvbSBcIi4vcmVxdWVzdC1jbGllbnQuanNcIlxuaW1wb3J0IHBpY29jb2xvcnMgZnJvbSBcInBpY29jb2xvcnNcIlxuaW1wb3J0IHJlc3RBcmdzRXJyb3IgZnJvbSBcIi4uL3V0aWxzL3Jlc3QtYXJncy1lcnJvci5qc1wiXG5pbXBvcnQge3Rlc3RDb25maWd9IGZyb20gXCIuL3Rlc3QuanNcIlxuaW1wb3J0IHtmaWxlVVJMVG9QYXRoLCBwYXRoVG9GaWxlVVJMfSBmcm9tIFwidXJsXCJcbmltcG9ydCBTaGFyZWRUcmFuc2FjdGlvbkJyb2tlciBmcm9tIFwiLi9zaGFyZWQtdHJhbnNhY3Rpb24tYnJva2VyLmpzXCJcbmltcG9ydCB7IFNIQVJFRF9UUkFOU0FDVElPTl9CUk9LRVJfRU5WIH0gZnJvbSBcIi4vc2hhcmVkLXRyYW5zYWN0aW9uLXByb3h5LWRyaXZlci5qc1wiXG5pbXBvcnQgVmVsb2Npb3VzQXR0ZW1wdEV4ZWN1dG9yIGZyb20gXCIuL3ZlbG9jaW91cy1hdHRlbXB0LWV4ZWN1dG9yLmpzXCJcbmltcG9ydCBWZWxvY2lvdXNSdW5uZXJSZXBvcnRlciwge0Fib3J0UmVtYWluaW5nVGVzdHNFcnJvcn0gZnJvbSBcIi4vdmVsb2Npb3VzLXJ1bm5lci1yZXBvcnRlci5qc1wiXG5pbXBvcnQgVmVsb2Npb3VzU3VpdGVIb29rRXhlY3V0b3IgZnJvbSBcIi4vdmVsb2Npb3VzLXN1aXRlLWhvb2stZXhlY3V0b3IuanNcIlxuaW1wb3J0IFZlbG9jaW91c1Rlc3RBcmd1bWVudHMgZnJvbSBcIi4vdmVsb2Npb3VzLXRlc3QtYXJndW1lbnRzLmpzXCJcblxuLyoqIEB0eXBlZGVmIHt0eXBlb2YgZGVmYXVsdFRlc3RDb250ZXh0fSBQYWNrYWdlVGVzdENvbnRleHQgKi9cbi8qKiBAdHlwZWRlZiB7KHR5cGVvZiBkZWZhdWx0VGVzdENvbnRleHQucmVnaXN0cnkuc3VpdGVzKVtudW1iZXJdfSBQYWNrYWdlU3VpdGVEZWNsYXJhdGlvbiAqL1xuLyoqIEB0eXBlZGVmIHtQYWNrYWdlU3VpdGVEZWNsYXJhdGlvbltcInRlc3RzXCJdW251bWJlcl19IFBhY2thZ2VUZXN0RGVjbGFyYXRpb24gKi9cbi8qKiBAdHlwZWRlZiB7UGFja2FnZVN1aXRlRGVjbGFyYXRpb25bXCJob29rc1wiXVtcImJlZm9yZUFsbFwiXVtudW1iZXJdfSBQYWNrYWdlSG9va0RlY2xhcmF0aW9uICovXG4vKiogQHR5cGVkZWYge1BhY2thZ2VTdWl0ZURlY2xhcmF0aW9uIHwgUGFja2FnZVRlc3REZWNsYXJhdGlvbiB8IFBhY2thZ2VIb29rRGVjbGFyYXRpb259IFBhY2thZ2VSZWdpc3RyYXRpb24gKi9cbi8qKiBAdHlwZWRlZiB7e2hhZFJldHJpZXM6IGJvb2xlYW4sIG9wdGlvbnM6IFBhY2thZ2VUZXN0RGVjbGFyYXRpb25bXCJvcHRpb25zXCJdLCByZXRyaWVzOiBudW1iZXIgfCB1bmRlZmluZWR9fSBQYWNrYWdlUmV0cnlPcHRpb25SZXN0b3JhdGlvbiAqL1xuXG4vKipcbiAqIEF0dGVtcHRDb25zb2xlT3V0cHV0IHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBBdHRlbXB0Q29uc29sZU91dHB1dFxuICogQHByb3BlcnR5IHtudW1iZXJ9IGF0dGVtcHROdW1iZXIgLSBBdHRlbXB0IG51bWJlci5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBvdXRwdXQgLSBDYXB0dXJlZCBjb25zb2xlIG91dHB1dC5cbiAqL1xuLyoqXG4gKiBUZXN0QXJncyB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gVGVzdEFyZ3NcbiAqIEBwcm9wZXJ0eSB7QXBwbGljYXRpb259IFthcHBsaWNhdGlvbl0gLSBBcHBsaWNhdGlvbiBpbnN0YW5jZSBmb3IgaW50ZWdyYXRpb24gdGVzdHMuXG4gKiBAcHJvcGVydHkge1JlcXVlc3RDbGllbnR9IFtjbGllbnRdIC0gSFRUUCBjbGllbnQgZm9yIHJlcXVlc3QgdGVzdHMuXG4gKiBAcHJvcGVydHkge29iamVjdH0gW2RhdGFiYXNlQ2xlYW5pbmddIC0gRGF0YWJhc2UgY2xlYW51cCBvcHRpb25zIGZvciB0ZXN0cy5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW2RhdGFiYXNlQ2xlYW5pbmcudHJhbnNhY3Rpb25dIC0gVXNlIHRyYW5zYWN0aW9ucyB0byByb2xsYmFjayBiZXR3ZWVuIHRlc3RzLlxuICogQHByb3BlcnR5IHtib29sZWFufSBbZGF0YWJhc2VDbGVhbmluZy50cnVuY2F0ZV0gLSBUcnVuY2F0ZSB0YWJsZXMgYmV0d2VlbiB0ZXN0cy5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW2RhdGFiYXNlQ2xlYW5pbmcudHJ1bmNhdGVCZWZvcmVdIC0gVHJ1bmNhdGUgdGFibGVzIGJlZm9yZSBlYWNoIHRlc3QsIGluIGFkZGl0aW9uIHRvIHRoZSBkZWZhdWx0IGNsZWFudXAuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFtmb2N1c10gLSBXaGV0aGVyIHRoaXMgdGVzdCBpcyBmb2N1c2VkLlxuICogQHByb3BlcnR5IHsoKSA9PiAodm9pZHxQcm9taXNlPHZvaWQ+KX0gW2Z1bmN0aW9uXSAtIFRlc3QgY2FsbGJhY2sgZnVuY3Rpb24uXG4gKiBAcHJvcGVydHkge251bWJlcn0gW3JldHJ5XSAtIE51bWJlciBvZiByZXRyaWVzIHdoZW4gYSB0ZXN0IGZhaWxzLlxuICogQHByb3BlcnR5IHtzdHJpbmdbXSB8IHN0cmluZ30gW3RhZ3NdIC0gVGFncyBmb3IgZmlsdGVyaW5nLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IFt0aW1lb3V0U2Vjb25kc10gLSBUaW1lb3V0IGluIHNlY29uZHMgZm9yIHRoZSB0ZXN0LlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFt0eXBlXSAtIFRlc3QgdHlwZSBpZGVudGlmaWVyLlxuICogQHByb3BlcnR5IHsoYXJnczoge2RhdGFiYXNlSWRlbnRpZmllcjogc3RyaW5nLCB0ZW5hbnQ6IG9iamVjdH0pID0+IFByb21pc2U8dm9pZD59IFtyZWdpc3RlclRyYW5zYWN0aW9uYWxUZW5hbnRdIC0gUmVnaXN0ZXJzIG9uZSByZXNvbHZlZCB0ZW5hbnQgZGF0YWJhc2UgdHJhbnNhY3Rpb24gZm9yIHRoaXMgYXR0ZW1wdC5cbiAqL1xuLyoqXG4gKiBCcm93c2VyRHVtbXlDb25uZWN0aW9uUmVnaXN0cmF0aW9uIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBCcm93c2VyRHVtbXlDb25uZWN0aW9uUmVnaXN0cmF0aW9uXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBkYiAtIEF0dGVtcHQtb3duZWQgY29ubmVjdGlvbi5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBkYXRhYmFzZUlkZW50aWZpZXIgLSBDb25maWd1cmVkIGRhdGFiYXNlIGlkZW50aWZpZXIuXG4gKiBAcHJvcGVydHkge1Byb21pc2U8dm9pZD59IFtxdWFyYW50aW5lUHJvbWlzZV0gLSBTaGFyZWQgY29ubmVjdGlvbi1kaXNjYXJkIHByb21pc2UuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IHF1YXJhbnRpbmVkIC0gV2hldGhlciB0aGUgY29ubmVjdGlvbiBpcyB1bnNhZmUgdG8gcmV1c2UuXG4gKiBAcHJvcGVydHkge1Byb21pc2U8dm9pZD59IFtyb2xsYmFja1Byb21pc2VdIC0gU2hhcmVkIHJvbGxiYWNrIHByb21pc2UuXG4gKiBAcHJvcGVydHkge1Byb21pc2U8dm9pZD59IFtzdGFydFByb21pc2VdIC0gVHJhbnNhY3Rpb24gc3RhcnR1cCBwcm9taXNlIHdoZW4gdHJhbnNhY3Rpb24gY2xlYW5pbmcgaXMgZW5hYmxlZC5cbiAqL1xuLyoqXG4gKiBUZXN0RGF0YSB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gVGVzdERhdGFcbiAqIEBwcm9wZXJ0eSB7VGVzdEFyZ3N9IGFyZ3MgLSBBcmd1bWVudHMgcGFzc2VkIHRvIHRoZSB0ZXN0LlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtmaWxlUGF0aF0gLSBTb3VyY2UgZmlsZSBwYXRoLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IFtsaW5lXSAtIFNvdXJjZSBsaW5lIG51bWJlci5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbb3duZXJGaWxlUGF0aF0gLSBEZXRlcm1pbmlzdGljIGltcG9ydGluZyB0ZXN0IGZpbGUuXG4gKiBAcHJvcGVydHkgeyhhcmc6IFRlc3RBcmdzKSA9PiAodm9pZHxQcm9taXNlPHZvaWQ+KX0gZnVuY3Rpb24gLSBUZXN0IGNhbGxiYWNrIHRvIGV4ZWN1dGUuXG4gKiBAcHJvcGVydHkge1BhY2thZ2VUZXN0RGVjbGFyYXRpb259IFtkZWNsYXJhdGlvbl0gLSBQYWNrYWdlIGRlY2xhcmF0aW9uLlxuICovXG4vKipcbiAqIEZhaWxlZFRlc3REZXRhaWwgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEZhaWxlZFRlc3REZXRhaWxcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBmdWxsRGVzY3JpcHRpb24gLSBGdWxsIHRlc3QgZGVzY3JpcHRpb24uXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW2ZpbGVQYXRoXSAtIFNvdXJjZSBmaWxlIHBhdGguXG4gKiBAcHJvcGVydHkge251bWJlcn0gW2xpbmVdIC0gU291cmNlIGxpbmUgbnVtYmVyLlxuICogQHByb3BlcnR5IHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gZXJyb3IgLSBGYWlsdXJlIGVycm9yLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtjb25zb2xlT3V0cHV0XSAtIENhcHR1cmVkIGNvbnNvbGUgb3V0cHV0IHdoaWxlIHRlc3QgcmFuLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtjb25zb2xlTG9nUGF0aF0gLSBTYXZlZCBjb25zb2xlIGxvZyBwYXRoLlxuICovXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYgeyhhcmdzOiB7Y29uZmlndXJhdGlvbjogaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0LCB0ZXN0QXJnczogVGVzdEFyZ3MsIHRlc3REYXRhOiBUZXN0RGF0YX0pID0+ICh2b2lkfFByb21pc2U8dm9pZD4pfSBBZnRlckJlZm9yZUVhY2hDYWxsYmFja1R5cGVcbiAqL1xuLyoqXG4gKiBBZnRlckJlZm9yZUVhY2hDYWxsYmFja09iamVjdFR5cGUgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEFmdGVyQmVmb3JlRWFjaENhbGxiYWNrT2JqZWN0VHlwZVxuICogQHByb3BlcnR5IHtBZnRlckJlZm9yZUVhY2hDYWxsYmFja1R5cGV9IGNhbGxiYWNrIC0gSG9vayBjYWxsYmFjayB0byBleGVjdXRlLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IFtkZWNsYXJhdGlvbkluZGV4XSAtIEhvb2sgaW5kZXggd2l0aGluIGl0cyBkZWNsYXJhdGlvbiBzY29wZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbZGVjbGFyYXRpb25TY29wZUlkXSAtIE9wYXF1ZSBwcm9maWxlIHNjb3BlIGlkZW50aWZpZXIuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW293bmVyRmlsZVBhdGhdIC0gRGV0ZXJtaW5pc3RpYyBpbXBvcnRpbmcgdGVzdCBmaWxlLlxuICovXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYgeyhhcmdzOiB7Y29uZmlndXJhdGlvbjogaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSkgPT4gKHZvaWR8UHJvbWlzZTx2b2lkPil9IEJlZm9yZUFmdGVyQWxsQ2FsbGJhY2tUeXBlXG4gKi9cbi8qKlxuICogQmVmb3JlQWZ0ZXJBbGxDYWxsYmFja09iamVjdFR5cGUgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEJlZm9yZUFmdGVyQWxsQ2FsbGJhY2tPYmplY3RUeXBlXG4gKiBAcHJvcGVydHkge0JlZm9yZUFmdGVyQWxsQ2FsbGJhY2tUeXBlfSBjYWxsYmFjayAtIEhvb2sgY2FsbGJhY2sgdG8gZXhlY3V0ZS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBbZGVjbGFyYXRpb25JbmRleF0gLSBIb29rIGluZGV4IHdpdGhpbiBpdHMgZGVjbGFyYXRpb24gc2NvcGUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW2RlY2xhcmF0aW9uU2NvcGVJZF0gLSBPcGFxdWUgcHJvZmlsZSBzY29wZSBpZGVudGlmaWVyLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtvd25lckZpbGVQYXRoXSAtIERldGVybWluaXN0aWMgaW1wb3J0aW5nIHRlc3QgZmlsZS5cbiAqL1xuLyoqXG4gKiBUZXN0c0FyZ3VtZW50IHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBUZXN0c0FyZ3VtZW50XG4gKiBAcHJvcGVydHkge1Rlc3RBcmdzfSBhcmdzIC0gQXJndW1lbnRzIGluaGVyaXRlZCBieSB0ZXN0cyBpbiB0aGlzIHNjb3BlLlxuICogQHByb3BlcnR5IHtib29sZWFufSBbYW55VGVzdHNGb2N1c3NlZF0gLSBXaGV0aGVyIGFueSB0ZXN0cyBpbiB0aGUgdHJlZSBhcmUgZm9jdXNlZC5cbiAqIEBwcm9wZXJ0eSB7QWZ0ZXJCZWZvcmVFYWNoQ2FsbGJhY2tPYmplY3RUeXBlW119IGFmdGVyRWFjaGVzIC0gQWZ0ZXItZWFjaCBob29rcyBmb3IgdGhpcyBzY29wZS5cbiAqIEBwcm9wZXJ0eSB7QmVmb3JlQWZ0ZXJBbGxDYWxsYmFja09iamVjdFR5cGVbXX0gYWZ0ZXJBbGxzIC0gQWZ0ZXItYWxsIGhvb2tzIGZvciB0aGlzIHNjb3BlLlxuICogQHByb3BlcnR5IHtCZWZvcmVBZnRlckFsbENhbGxiYWNrT2JqZWN0VHlwZVtdfSBiZWZvcmVBbGxzIC0gQmVmb3JlLWFsbCBob29rcyBmb3IgdGhpcyBzY29wZS5cbiAqIEBwcm9wZXJ0eSB7QWZ0ZXJCZWZvcmVFYWNoQ2FsbGJhY2tPYmplY3RUeXBlW119IGJlZm9yZUVhY2hlcyAtIEJlZm9yZS1lYWNoIGhvb2tzIGZvciB0aGlzIHNjb3BlLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtmaWxlUGF0aF0gLSBTb3VyY2UgZmlsZSBwYXRoLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IFtsaW5lXSAtIFNvdXJjZSBsaW5lIG51bWJlci5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbb3duZXJGaWxlUGF0aF0gLSBEZXRlcm1pbmlzdGljIGltcG9ydGluZyB0ZXN0IGZpbGUuXG4gKiBAcHJvcGVydHkge1JlY29yZDxzdHJpbmcsIFRlc3REYXRhPn0gdGVzdHMgLSBBIHVuaXF1ZSBpZGVudGlmaWVyIGZvciB0aGUgbm9kZS5cbiAqIEBwcm9wZXJ0eSB7UmVjb3JkPHN0cmluZywgVGVzdHNBcmd1bWVudD59IHN1YnMgLSBPcHRpb25hbCBjaGlsZCBub2Rlcy4gRWFjaCBpdGVtIGlzIGFub3RoZXIgYE5vZGVgLCBhbGxvd2luZyByZWN1cnNpb24uXG4gKi9cbi8qKlxuICogTWFya3MgdGhlIGVycm9yIHRocm93biBieSB0aGUgYXR0ZW1wdCB0aW1lb3V0IHNvIHRoZSBydW5uZXIgY2FuIGRpc3Rpbmd1aXNoXG4gKiBkZXRhY2hlZCBsaWZlY3ljbGUgY2xlYW51cCBmcm9tIGFuIG9yZGluYXJ5IHRlc3QgZmFpbHVyZS5cbiAqIEB0eXBlZGVmIHtFcnJvciAmIHt2ZWxvY2lvdXNUZXN0VGltZW91dD86IHRydWV9fSBUZXN0VGltZW91dEVycm9yXG4gKi9cbi8qKlxuICogU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJSZWdpc3RyYXRpb24gdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFNoYXJlZFRyYW5zYWN0aW9uQnJva2VyUmVnaXN0cmF0aW9uXG4gKiBAcHJvcGVydHkge1NoYXJlZFRyYW5zYWN0aW9uQnJva2VyfSBicm9rZXIgLSBBdHRlbXB0IGJyb2tlciBhbmQgY29ubmVjdGlvbiBjb29yZGluYXRvci5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gZW52aXJvbm1lbnRQdWJsaXNoZWQgLSBXaGV0aGVyIGNoaWxkLXByb2Nlc3MgY29vcmRpbmF0ZXMgd2VyZSBwdWJsaXNoZWQuXG4gKiBAcHJvcGVydHkge3N0cmluZyB8IHVuZGVmaW5lZH0gcHJldmlvdXNFbnZpcm9ubWVudCAtIEVudmlyb25tZW50IHZhbHVlIHRvIHJlc3RvcmUgYWZ0ZXIgcHVibGljYXRpb24uXG4gKi9cbi8qKlxuICogVHJhbnNhY3Rpb25hbFRlbmFudFJlZ2lzdHJhdGlvbiB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gVHJhbnNhY3Rpb25hbFRlbmFudFJlZ2lzdHJhdGlvblxuICogQHByb3BlcnR5IHtQcm9taXNlPHtjb25uZWN0aW9uOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZCwgZXJyb3I6IEVycm9yIHwgdW5kZWZpbmVkfT4gfCB1bmRlZmluZWR9IFtjaGVja291dFByb21pc2VdIC0gQXR0ZW1wdC1vd25lZCBwaHlzaWNhbCBjaGVja291dCBvdXRjb21lLlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gY29ubmVjdGlvbiAtIEF0dGVtcHQtb3duZWQgcGh5c2ljYWwgY29ubmVjdGlvbiBvbmNlIGNoZWNrb3V0IHJlc29sdmVzLlxuICogQHByb3BlcnR5IHtQcm9taXNlPHZvaWQ+IHwgdW5kZWZpbmVkfSBbY2xlYW51cFByb21pc2VdIC0gU2luZ2xlIGNsZWFudXAgb3BlcmF0aW9uIHNoYXJlZCBieSBlbWVyZ2VuY3kgYW5kIGV2ZW50dWFsIGxpZmVjeWNsZSBjbGVhbnVwLlxuICogQHByb3BlcnR5IHtib29sZWFuIHwgdW5kZWZpbmVkfSBbZGlzY2FyZE9uQ2xlYW51cF0gLSBXaGV0aGVyIHRpbWVvdXQgZW1lcmdlbmN5IGNsZWFudXAgbXVzdCBxdWFyYW50aW5lIHRoaXMgY29ubmVjdGlvbi5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvcG9vbC9iYXNlLmpzXCIpLmRlZmF1bHR9IHBvb2wgLSBPd25pbmcgbG9naWNhbCBwb29sLlxuICogQHByb3BlcnR5IHtib29sZWFufSByZXZva2VkIC0gV2hldGhlciB0aGlzIGF0dGVtcHQgbWF5IHN0aWxsIHB1Ymxpc2ggdGhlIHBoeXNpY2FsIHJlZ2lzdHJhdGlvbi5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSByZXVzZUtleSAtIFJlc29sdmVkIHBoeXNpY2FsIGNvbmZpZ3VyYXRpb24gaWRlbnRpdHkuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uL2RhdGFiYXNlL3Bvb2wvYmFzZS5qc1wiKS5UZXN0U2hhcmVkQ29ubmVjdGlvblJlZ2lzdHJhdGlvbiB8IHVuZGVmaW5lZH0gc2hhcmVkUmVnaXN0cmF0aW9uIC0gUGh5c2ljYWwta2V5IHNoYXJlZCByZWdpc3RyYXRpb24gb25jZSBwdWJsaXNoZWQuXG4gKi9cblxuLyoqXG4gKiBSdW5zIHRvIGZpbGUgc2x1Zy5cbiAqIEBwYXJhbSB7c3RyaW5nfSB2YWx1ZSAtIFZhbHVlIHRvIHNhbml0aXplLlxuICogQHJldHVybnMge3N0cmluZ30gLSBTbHVnLXNhZmUgdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIHRvRmlsZVNsdWcodmFsdWUpIHtcbiAgcmV0dXJuIHZhbHVlXG4gICAgLnRvTG93ZXJDYXNlKClcbiAgICAucmVwbGFjZSgvW15hLXowLTldKy9nLCBcIi1cIilcbiAgICAucmVwbGFjZSgvXi0rfC0rJC9nLCBcIlwiKVxuICAgIC5zbGljZSgwLCA4MCkgfHwgXCJmYWlsZWQtdGVzdFwiXG59XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFRlc3RSdW5uZXIge1xuICAvKiogQHR5cGUge1BhY2thZ2VUZXN0Q29udGV4dH0gKi9cbiAgX2NvbnRleHRcblxuICAvKipcbiAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgKiBAdHlwZSB7RmFpbGVkVGVzdERldGFpbFtdfSAqL1xuICBfZmFpbGVkVGVzdERldGFpbHNcblxuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGFyZ3MuY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7UGFja2FnZVRlc3RDb250ZXh0fSBbYXJncy5jb250ZXh0XSAtIERlY2xhcmF0aW9uIGNvbnRleHQuXG4gICAqIEBwYXJhbSB7c3RyaW5nW10gfCBzdHJpbmd9IFthcmdzLmV4Y2x1ZGVUYWdzXSAtIFRhZ3MgdG8gZXhjbHVkZS5cbiAgICogQHBhcmFtIHtzdHJpbmdbXSB8IHN0cmluZ30gW2FyZ3MuaW5jbHVkZVRhZ3NdIC0gVGFncyB0byBpbmNsdWRlLlxuICAgKiBAcGFyYW0ge0FycmF5PHN0cmluZz59IGFyZ3MudGVzdEZpbGVzIC0gVGVzdCBmaWxlcy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBudW1iZXJbXT59IFthcmdzLmxpbmVGaWx0ZXJzXSAtIExpbmUgZmlsdGVycyBieSBmaWxlLlxuICAgKiBAcGFyYW0ge1JlZ0V4cFtdfSBbYXJncy5leGFtcGxlUGF0dGVybnNdIC0gRXhhbXBsZSBwYXR0ZXJucy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL3Rlc3QtcHJvZmlsZXIuanNcIikuZGVmYXVsdH0gW2FyZ3MucHJvZmlsZXJdIC0gT3B0LWluIHByb2ZpbGVyLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe2NvbmZpZ3VyYXRpb24sIGNvbnRleHQgPSBkZWZhdWx0VGVzdENvbnRleHQsIGV4Y2x1ZGVUYWdzLCBpbmNsdWRlVGFncywgdGVzdEZpbGVzLCBsaW5lRmlsdGVycywgZXhhbXBsZVBhdHRlcm5zLCBwcm9maWxlciwgLi4ucmVzdEFyZ3N9KSB7XG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcblxuICAgIGlmICghY29uZmlndXJhdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiY29uZmlndXJhdGlvbiBpcyByZXF1aXJlZFwiKVxuXG4gICAgdGhpcy5fY29uZmlndXJhdGlvbiA9IGNvbmZpZ3VyYXRpb25cbiAgICB0aGlzLl9jb250ZXh0ID0gY29udGV4dFxuICAgIHRoaXMuX3NoYXJlZFRyYW5zYWN0aW9uQ29vcmRpbmF0b3JPd25lclN0b3JhZ2UgPSBuZXcgQXN5bmNMb2NhbFN0b3JhZ2UoKVxuICAgIHRoaXMuX3Rlc3REYXRhYmFzZUFjY2Vzc1Njb3BlU3RvcmFnZSA9IG5ldyBBc3luY0xvY2FsU3RvcmFnZSgpXG4gICAgdGhpcy5fZXhjbHVkZVRhZ3MgPSB0aGlzLm5vcm1hbGl6ZVRhZ3MoZXhjbHVkZVRhZ3MpXG4gICAgdGhpcy5faW5jbHVkZVRhZ3MgPSB0aGlzLm5vcm1hbGl6ZVRhZ3MoaW5jbHVkZVRhZ3MpXG4gICAgdGhpcy5fdGVzdEZpbGVzID0gdGVzdEZpbGVzXG4gICAgdGhpcy5fbGluZUZpbHRlcnMgPSBsaW5lRmlsdGVycyB8fCB7fVxuICAgIHRoaXMuX2V4YW1wbGVQYXR0ZXJucyA9IGV4YW1wbGVQYXR0ZXJucyB8fCBbXVxuICAgIHRoaXMuX3Byb2ZpbGVyID0gcHJvZmlsZXJcbiAgICB0aGlzLl9hYm9ydFJlbWFpbmluZ1Rlc3RzID0gZmFsc2VcblxuICAgIHRoaXMuX2ZhaWxlZFRlc3RzID0gMFxuICAgIHRoaXMuX3N1Y2Nlc3NmdWxUZXN0cyA9IDBcbiAgICB0aGlzLl90ZXN0c0NvdW50ID0gMFxuICAgIHRoaXMuX2ZhaWxlZFRlc3REZXRhaWxzID0gW11cbiAgICAvKiogQHR5cGUge3tmdWxsRGVzY3JpcHRpb246IHN0cmluZywgZmlsZVBhdGg6IHN0cmluZywgbGluZTogbnVtYmVyfSB8IG51bGx9ICovXG4gICAgdGhpcy5fbGFzdFRlc3RDb250ZXh0ID0gbnVsbFxuICAgIC8qKiBAdHlwZSB7QXJyYXk8e2Z1bGxEZXNjcmlwdGlvbjogc3RyaW5nLCBmaWxlUGF0aDogc3RyaW5nLCBsaW5lOiBudW1iZXIsIGR1cmF0aW9uTXM6IG51bWJlcn0+fSAqL1xuICAgIHRoaXMuX3Rlc3REdXJhdGlvbnMgPSBbXVxuICAgIC8qKiBAdHlwZSB7V2Vha01hcDxQYWNrYWdlVGVzdERlY2xhcmF0aW9uLCB7dGVzdEFyZ3M6IFRlc3RBcmdzLCB0ZXN0RGF0YTogVGVzdERhdGF9Pn0gKi9cbiAgICB0aGlzLl90ZXN0Q29tcGF0aWJpbGl0eSA9IG5ldyBXZWFrTWFwKClcbiAgICAvKiogQHR5cGUge1dlYWtTZXQ8UGFja2FnZVRlc3REZWNsYXJhdGlvbj59ICovXG4gICAgdGhpcy5faW5qZWN0ZWRUZXN0cyA9IG5ldyBXZWFrU2V0KClcbiAgICAvKiogQHR5cGUge1dlYWtTZXQ8UGFja2FnZVRlc3REZWNsYXJhdGlvbj59ICovXG4gICAgdGhpcy5fY29tcGxldGVkVGVzdHMgPSBuZXcgV2Vha1NldCgpXG4gICAgLyoqIEB0eXBlIHtXZWFrTWFwPFBhY2thZ2VUZXN0RGVjbGFyYXRpb24sIHtkZXNjcmlwdGlvbnM6IHN0cmluZ1tdLCB0ZXN0RGVzY3JpcHRpb246IHN0cmluZywgZnVsbERlc2NyaXB0aW9uOiBzdHJpbmcsIG93bmVyRmlsZVBhdGg6IHN0cmluZyB8IHVuZGVmaW5lZCwgc3VpdGVzOiBQYWNrYWdlU3VpdGVEZWNsYXJhdGlvbltdfT59ICovXG4gICAgdGhpcy5fdGVzdE1ldGFkYXRhID0gbmV3IFdlYWtNYXAoKVxuICAgIC8qKiBAdHlwZSB7V2Vha01hcDxQYWNrYWdlSG9va0RlY2xhcmF0aW9uLCB7ZGVjbGFyYXRpb25JbmRleDogbnVtYmVyLCBkZWNsYXJhdGlvblNjb3BlSWQ6IHN0cmluZyB8IHVuZGVmaW5lZCwgb3duZXJGaWxlUGF0aDogc3RyaW5nIHwgdW5kZWZpbmVkfT59ICovXG4gICAgdGhpcy5faG9va01ldGFkYXRhID0gbmV3IFdlYWtNYXAoKVxuICAgIC8qKiBAdHlwZSB7V2Vha01hcDxQYWNrYWdlVGVzdERlY2xhcmF0aW9uLCBNYXA8bnVtYmVyLCB7YWJvcnRSZW1haW5pbmdUZXN0czogYm9vbGVhbiwgZXJyb3I6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBmYWlsZWQ6IGJvb2xlYW59Pj59ICovXG4gICAgdGhpcy5fYXR0ZW1wdE91dGNvbWVzID0gbmV3IFdlYWtNYXAoKVxuICAgIC8qKiBAdHlwZSB7QXJyYXk8e3N1aXRlOiBQYWNrYWdlU3VpdGVEZWNsYXJhdGlvbiwgcGhhc2U6IFwiYmVmb3JlQWxsXCIgfCBcImFmdGVyQWxsXCIsIGVycm9yOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0+fSAqL1xuICAgIHRoaXMuX3N1aXRlSG9va0ZhaWx1cmVzID0gW11cbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIFBhY2thZ2VUZXN0RGVjbGFyYXRpb25bXT59ICovXG4gICAgdGhpcy5fdGVzdHNCeUZ1bGxOYW1lID0gbmV3IE1hcCgpXG4gICAgLyoqIEB0eXBlIHtXZWFrTWFwPFBhY2thZ2VSZWdpc3RyYXRpb24sIHN0cmluZz59ICovXG4gICAgdGhpcy5fZGVjbGFyYXRpb25Pd25lcnMgPSBuZXcgV2Vha01hcCgpXG4gICAgLyoqIEB0eXBlIHtQYWNrYWdlVGVzdFJ1bm5lciB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9wYWNrYWdlUnVubmVyID0gdW5kZWZpbmVkXG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCJAdmVsb2Npb3VzL3Rlc3RpbmcvcnVubmVyXCIpLlRlc3RSdW5SZXN1bHQgfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5fcGFja2FnZVJlc3VsdCA9IHVuZGVmaW5lZFxuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgVGVzdERhdGE+IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX2xlZ2FjeUZpeHR1cmVEYXRhQnlGdWxsTmFtZSA9IHVuZGVmaW5lZFxuICAgIC8qKiBAdHlwZSB7e2ZpbGVQYXRoPzogc3RyaW5nLCBsaW5lPzogbnVtYmVyfX0gKi9cbiAgICB0aGlzLl9sZWdhY3lGaXh0dXJlTG9jYXRpb24gPSB7fVxuICAgIHRoaXMuX2F0dGVtcHRFeGVjdXRvciA9IG5ldyBWZWxvY2lvdXNBdHRlbXB0RXhlY3V0b3Ioe3Rlc3RSdW5uZXI6IHRoaXN9KVxuICAgIHRoaXMuX3J1bm5lclJlcG9ydGVyID0gbmV3IFZlbG9jaW91c1J1bm5lclJlcG9ydGVyKHt0ZXN0UnVubmVyOiB0aGlzfSlcbiAgICB0aGlzLl9zdWl0ZUhvb2tFeGVjdXRvciA9IG5ldyBWZWxvY2lvdXNTdWl0ZUhvb2tFeGVjdXRvcih7dGVzdFJ1bm5lcjogdGhpc30pXG4gICAgdGhpcy5fdGVzdEFyZ3VtZW50cyA9IG5ldyBWZWxvY2lvdXNUZXN0QXJndW1lbnRzKHt0ZXN0UnVubmVyOiB0aGlzfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXRzIHRoZSBwYWNrYWdlIGRlY2xhcmF0aW9uIGNvbnRleHQuXG4gICAqIEByZXR1cm5zIHtQYWNrYWdlVGVzdENvbnRleHR9IC0gUGFja2FnZSBkZWNsYXJhdGlvbiBjb250ZXh0LlxuICAgKi9cbiAgZ2V0VGVzdENvbnRleHQoKSB7IHJldHVybiB0aGlzLl9jb250ZXh0IH1cblxuICAvKipcbiAgICogUnVucyBnZXQgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gLSBUaGUgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIGdldENvbmZpZ3VyYXRpb24oKSB7IHJldHVybiB0aGlzLl9jb25maWd1cmF0aW9uIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdGVzdCBmaWxlcy5cbiAgICogQHJldHVybnMge3N0cmluZ1tdfSAtIFRoZSB0ZXN0IGZpbGVzLlxuICAgKi9cbiAgZ2V0VGVzdEZpbGVzKCkgeyByZXR1cm4gdGhpcy5fdGVzdEZpbGVzIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgbGluZSBmaWx0ZXJzLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgbnVtYmVyW10+fSAtIExpbmUgZmlsdGVycy5cbiAgICovXG4gIGdldExpbmVGaWx0ZXJzKCkgeyByZXR1cm4gdGhpcy5fbGluZUZpbHRlcnMgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBleGFtcGxlIHBhdHRlcm5zLlxuICAgKiBAcmV0dXJucyB7UmVnRXhwW119IC0gRXhhbXBsZSBwYXR0ZXJucy5cbiAgICovXG4gIGdldEV4YW1wbGVQYXR0ZXJucygpIHsgcmV0dXJuIHRoaXMuX2V4YW1wbGVQYXR0ZXJucyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYSBwcm9maWxlciBzcGFuIG9ubHkgd2hlbiBwcm9maWxpbmcgd2FzIGV4cGxpY2l0bHkgZW5hYmxlZC5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHtvYmplY3R9IG1ldGFkYXRhIC0gU3BhbiBtZXRhZGF0YS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG1ldGFkYXRhLnBoYXNlIC0gUGhhc2UgbmFtZS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFttZXRhZGF0YS5kZWNsYXJhdGlvbkluZGV4XSAtIEhvb2sgZGVjbGFyYXRpb24gaW5kZXguXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbbWV0YWRhdGEuZGVjbGFyYXRpb25TY29wZUlkXSAtIEhvb2sgZGVjbGFyYXRpb24gc2NvcGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbbWV0YWRhdGEuZmlsZVBhdGhdIC0gU291cmNlIG93bmVyc2hpcC5cbiAgICogQHBhcmFtIHsoKSA9PiAoVCB8IFByb21pc2U8VD4pfSBjYWxsYmFjayAtIFRpbWVkIGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBydW5Qcm9maWxlU3BhbihtZXRhZGF0YSwgY2FsbGJhY2spIHtcbiAgICBpZiAoIXRoaXMuX3Byb2ZpbGVyKSByZXR1cm4gYXdhaXQgY2FsbGJhY2soKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3Byb2ZpbGVyLnJ1blNwYW4obWV0YWRhdGEsIGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIHRhZ3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nW10gfCBzdHJpbmcgfCB1bmRlZmluZWR9IHRhZ3MgLSBUYWdzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nW119IC0gTm9ybWFsaXplZCB0YWdzLlxuICAgKi9cbiAgbm9ybWFsaXplVGFncyh0YWdzKSB7XG4gICAgaWYgKCF0YWdzKSByZXR1cm4gW11cblxuICAgIGNvbnN0IHZhbHVlcyA9IFtdXG4gICAgY29uc3QgcmF3VGFncyA9IEFycmF5LmlzQXJyYXkodGFncykgPyB0YWdzIDogW3RhZ3NdXG5cbiAgICBmb3IgKGNvbnN0IHJhd1RhZyBvZiByYXdUYWdzKSB7XG4gICAgICBpZiAocmF3VGFnID09PSB1bmRlZmluZWQgfHwgcmF3VGFnID09PSBudWxsKSBjb250aW51ZVxuXG4gICAgICBjb25zdCBwYXJ0cyA9IFN0cmluZyhyYXdUYWcpLnNwbGl0KFwiLFwiKVxuXG4gICAgICBmb3IgKGNvbnN0IHBhcnQgb2YgcGFydHMpIHtcbiAgICAgICAgY29uc3QgdHJpbW1lZCA9IHBhcnQudHJpbSgpXG5cbiAgICAgICAgaWYgKHRyaW1tZWQpIHZhbHVlcy5wdXNoKHRyaW1tZWQpXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIEFycmF5LmZyb20obmV3IFNldCh2YWx1ZXMpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFzIHRhZy5cbiAgICogQHBhcmFtIHtUZXN0QXJnc30gdGVzdEFyZ3MgLSBUZXN0IGFyZ3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0YWcgLSBUYWcgdG8gY2hlY2sgZm9yLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRhZyBpcyBwcmVzZW50LlxuICAgKi9cbiAgaGFzVGFnKHRlc3RBcmdzLCB0YWcpIHtcbiAgICByZXR1cm4gdGhpcy5ub3JtYWxpemVUYWdzKHRlc3RBcmdzPy50YWdzKS5pbmNsdWRlcyh0YWcpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyBicm93c2VyIHRlc3QgbW9kZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBydW5uaW5nIGJyb3dzZXIgdGVzdHMuXG4gICAqL1xuICBpc0Jyb3dzZXJUZXN0TW9kZSgpIHtcbiAgICByZXR1cm4gcHJvY2Vzcy5lbnYuVkVMT0NJT1VTX0JST1dTRVJfVEVTVFMgPT09IFwidHJ1ZVwiXG4gIH1cblxuICAvKipcbiAgICogUnVucyBydW4gd2l0aCBkdW1teSBpZiBuZWVkZWQuXG4gICAqIEBwYXJhbSB7VGVzdEFyZ3N9IHRlc3RBcmdzIC0gVGVzdCBhcmdzLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8dm9pZD59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgdG8gcnVuLlxuICAgKiBAcGFyYW0ge0Jyb3dzZXJEdW1teUNvbm5lY3Rpb25SZWdpc3RyYXRpb25bXX0gW2Jyb3dzZXJEdW1teUNvbm5lY3Rpb25SZWdpc3RyYXRpb25zXSAtIEF0dGVtcHQtb3duZWQgYnJvd3NlciBjb25uZWN0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHJ1bldpdGhEdW1teUlmTmVlZGVkKHRlc3RBcmdzLCBjYWxsYmFjaywgYnJvd3NlckR1bW15Q29ubmVjdGlvblJlZ2lzdHJhdGlvbnMgPSBbXSkge1xuICAgIGlmICghdGhpcy5oYXNUYWcodGVzdEFyZ3MsIFwiZHVtbXlcIikpIHtcbiAgICAgIGF3YWl0IGNhbGxiYWNrKClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmICh0aGlzLmlzQnJvd3NlclRlc3RNb2RlKCkpIHtcbiAgICAgIGF3YWl0IHRoaXMucnVuQnJvd3NlckR1bW15KHRlc3RBcmdzLCBjYWxsYmFjaywgYnJvd3NlckR1bW15Q29ubmVjdGlvblJlZ2lzdHJhdGlvbnMpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnJ1bk5vZGVEdW1teShjYWxsYmFjaylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1biBub2RlIGR1bW15LlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8dm9pZD59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgdG8gcnVuLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgcnVuTm9kZUR1bW15KGNhbGxiYWNrKSB7XG4gICAgY29uc3QgZHVtbXlQYXRoID0gcHJvY2Vzcy5lbnYuVkVMT0NJT1VTX0RVTU1ZX1BBVEggfHwgdGhpcy5kZWZhdWx0RHVtbXlQYXRoKClcbiAgICBjb25zdCBkdW1teUltcG9ydCA9IGF3YWl0IGltcG9ydChwYXRoVG9GaWxlVVJMKGR1bW15UGF0aCkuaHJlZilcbiAgICBjb25zdCBEdW1teSA9IGR1bW15SW1wb3J0LmRlZmF1bHRcblxuICAgIGlmICghRHVtbXk/LnJ1bikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBEdW1teSBoZWxwZXIgbm90IGZvdW5kIGF0ICR7ZHVtbXlQYXRofWApXG4gICAgfVxuXG4gICAgLy8gUGVyc2lzdGVudCBzZXJ2ZXIgcmVzb3VyY2VzIG11c3Qgbm90IGluaGVyaXQgYW4gYXR0ZW1wdCBzY29wZSB0aGF0IHdpbGwgYmUgcmV2b2tlZC5cbiAgICBhd2FpdCB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5ydW5XaXRoQ2FwdHVyZWRUZXN0RGF0YWJhc2VBY2Nlc3NTY29wZSh1bmRlZmluZWQsIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IER1bW15LnJ1bihhc3luYyAoKSA9PiB7fSlcbiAgICB9KVxuICAgIHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmFzc2VydERhdGFiYXNlQWNjZXNzQWxsb3dlZCgpXG4gICAgYXdhaXQgY2FsbGJhY2soKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVmYXVsdCBkdW1teSBwYXRoLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIERlZmF1bHQgZHVtbXkgaGVscGVyIHBhdGguXG4gICAqL1xuICBkZWZhdWx0RHVtbXlQYXRoKCkge1xuICAgIGNvbnN0IGN3ZCA9IHBhdGgucmVzb2x2ZShwcm9jZXNzLmN3ZCgpKVxuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSBjd2Quc3BsaXQocGF0aC5zZXApLmpvaW4oXCIvXCIpXG5cbiAgICBpZiAobm9ybWFsaXplZC5lbmRzV2l0aChcIi9zcGVjL2R1bW15XCIpKSB7XG4gICAgICByZXR1cm4gcGF0aC5qb2luKGN3ZCwgXCJpbmRleC5qc1wiKVxuICAgIH1cblxuICAgIHJldHVybiBwYXRoLmpvaW4oY3dkLCBcInNwZWMvZHVtbXkvaW5kZXguanNcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1biBicm93c2VyIGR1bW15LlxuICAgKiBAcGFyYW0ge1Rlc3RBcmdzfSB0ZXN0QXJncyAtIFRlc3QgYXJncy5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPHZvaWQ+fSBjYWxsYmFjayAtIENhbGxiYWNrIHRvIHJ1bi5cbiAgICogQHBhcmFtIHtCcm93c2VyRHVtbXlDb25uZWN0aW9uUmVnaXN0cmF0aW9uW119IGNvbm5lY3Rpb25SZWdpc3RyYXRpb25zIC0gQXR0ZW1wdC1vd25lZCBicm93c2VyIGNvbm5lY3Rpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgcnVuQnJvd3NlckR1bW15KHRlc3RBcmdzLCBjYWxsYmFjaywgY29ubmVjdGlvblJlZ2lzdHJhdGlvbnMpIHtcbiAgICBjb25zdCB1c2VUcmFuc2FjdGlvbiA9IHRlc3RBcmdzLmRhdGFiYXNlQ2xlYW5pbmc/LnRyYW5zYWN0aW9uID09PSB0cnVlXG4gICAgY29uc3QgdHJ1bmNhdGUgPSB0ZXN0QXJncy5kYXRhYmFzZUNsZWFuaW5nPy50cnVuY2F0ZVxuICAgIGNvbnN0IHNob3VsZFRydW5jYXRlID0gdHJ1bmNhdGUgPT09IHVuZGVmaW5lZCA/ICF1c2VUcmFuc2FjdGlvbiA6IHRydW5jYXRlXG5cbiAgICBpZiAoIXVzZVRyYW5zYWN0aW9uICYmICFzaG91bGRUcnVuY2F0ZSkge1xuICAgICAgYXdhaXQgY2FsbGJhY2soKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZW5zdXJlQ29ubmVjdGlvbnMoe25hbWU6IFwiVGVzdCBydW5uZXIgYnJvd3NlciBkdW1teVwifSwgYXN5bmMgKGRicykgPT4ge1xuICAgICAgY29uc3QgbmV3UmVnaXN0cmF0aW9ucyA9IE9iamVjdC5lbnRyaWVzKGRicykubWFwKChbZGF0YWJhc2VJZGVudGlmaWVyLCBkYl0pID0+IHtcbiAgICAgICAgLyoqIEB0eXBlIHtCcm93c2VyRHVtbXlDb25uZWN0aW9uUmVnaXN0cmF0aW9ufSAqL1xuICAgICAgICBjb25zdCByZWdpc3RyYXRpb24gPSB7XG4gICAgICAgICAgZGF0YWJhc2VJZGVudGlmaWVyLFxuICAgICAgICAgIGRiLFxuICAgICAgICAgIHF1YXJhbnRpbmVkOiBmYWxzZVxuICAgICAgICB9XG5cbiAgICAgICAgY29ubmVjdGlvblJlZ2lzdHJhdGlvbnMucHVzaChyZWdpc3RyYXRpb24pXG5cbiAgICAgICAgcmV0dXJuIHJlZ2lzdHJhdGlvblxuICAgICAgfSlcblxuICAgICAgaWYgKHNob3VsZFRydW5jYXRlKSB7XG4gICAgICAgIHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmFzc2VydERhdGFiYXNlQWNjZXNzQWxsb3dlZCgpXG4gICAgICAgIGF3YWl0IHRoaXMudHJ1bmNhdGVEYXRhYmFzZXMoZGJzKVxuICAgICAgfVxuICAgICAgLyoqIEB0eXBlIHt1bmtub3duW119ICovXG4gICAgICBjb25zdCBsaWZlY3ljbGVFcnJvcnMgPSBbXVxuXG4gICAgICB0cnkge1xuICAgICAgICBpZiAodXNlVHJhbnNhY3Rpb24pIHtcbiAgICAgICAgICBjb25zdCBzdGFydFByb21pc2VzID0gbmV3UmVnaXN0cmF0aW9ucy5tYXAoKHJlZ2lzdHJhdGlvbikgPT4ge1xuICAgICAgICAgICAgY29uc3Qgc3RhcnRQcm9taXNlID0gcmVnaXN0cmF0aW9uLmRiLnN0YXJ0VHJhbnNhY3Rpb24oKVxuXG4gICAgICAgICAgICByZWdpc3RyYXRpb24uc3RhcnRQcm9taXNlID0gc3RhcnRQcm9taXNlXG4gICAgICAgICAgICByZXR1cm4gc3RhcnRQcm9taXNlXG4gICAgICAgICAgfSlcbiAgICAgICAgICBjb25zdCBzdGFydFJlc3VsdHMgPSBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQoc3RhcnRQcm9taXNlcylcbiAgICAgICAgICBjb25zdCBzdGFydEVycm9ycyA9IHN0YXJ0UmVzdWx0c1xuICAgICAgICAgICAgLmZpbHRlcigocmVzdWx0KSA9PiByZXN1bHQuc3RhdHVzID09PSBcInJlamVjdGVkXCIpXG4gICAgICAgICAgICAubWFwKChyZXN1bHQpID0+IHJlc3VsdC5yZWFzb24pXG5cbiAgICAgICAgICBpZiAoc3RhcnRFcnJvcnMubGVuZ3RoID09IDEpIHRocm93IHN0YXJ0RXJyb3JzWzBdXG4gICAgICAgICAgaWYgKHN0YXJ0RXJyb3JzLmxlbmd0aCA+IDEpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihzdGFydEVycm9ycywgXCJCcm93c2VyIGR1bW15IHRyYW5zYWN0aW9uIHN0YXJ0dXAgZmFpbGVkXCIsIHtjYXVzZTogc3RhcnRFcnJvcnNbMF19KVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmFzc2VydERhdGFiYXNlQWNjZXNzQWxsb3dlZCgpXG4gICAgICAgIGF3YWl0IGNhbGxiYWNrKClcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGxpZmVjeWNsZUVycm9ycy5wdXNoKGVycm9yKVxuICAgICAgfVxuXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLnJvbGxiYWNrQnJvd3NlckR1bW15VHJhbnNhY3Rpb25zKGNvbm5lY3Rpb25SZWdpc3RyYXRpb25zKVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgQWdncmVnYXRlRXJyb3IpIHtcbiAgICAgICAgICBsaWZlY3ljbGVFcnJvcnMucHVzaCguLi5lcnJvci5lcnJvcnMpXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgbGlmZWN5Y2xlRXJyb3JzLnB1c2goZXJyb3IpXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgdHJ5IHtcbiAgICAgICAgaWYgKHNob3VsZFRydW5jYXRlKSB7XG4gICAgICAgICAgdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuYXNzZXJ0RGF0YWJhc2VBY2Nlc3NBbGxvd2VkKClcbiAgICAgICAgICBhd2FpdCB0aGlzLnRydW5jYXRlRGF0YWJhc2VzKGRicylcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgbGlmZWN5Y2xlRXJyb3JzLnB1c2goZXJyb3IpXG4gICAgICB9XG5cbiAgICAgIGlmIChsaWZlY3ljbGVFcnJvcnMubGVuZ3RoID09IDEpIHRocm93IGxpZmVjeWNsZUVycm9yc1swXVxuICAgICAgaWYgKGxpZmVjeWNsZUVycm9ycy5sZW5ndGggPiAxKSB7XG4gICAgICAgIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihsaWZlY3ljbGVFcnJvcnMsIFwiQnJvd3NlciBkdW1teSBsaWZlY3ljbGUgYW5kIGNsZWFudXAgZmFpbGVkXCIsIHtjYXVzZTogbGlmZWN5Y2xlRXJyb3JzWzBdfSlcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJvbGxzIGJhY2sgZXZlcnkgYXR0ZW1wdC1vd25lZCBicm93c2VyIHRyYW5zYWN0aW9uIGV4YWN0bHkgb25jZS5cbiAgICogQHBhcmFtIHtCcm93c2VyRHVtbXlDb25uZWN0aW9uUmVnaXN0cmF0aW9uW119IHJlZ2lzdHJhdGlvbnMgLSBCcm93c2VyIGNvbm5lY3Rpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBhbGwgcm9sbGJhY2tzIHNldHRsZS5cbiAgICovXG4gIGFzeW5jIHJvbGxiYWNrQnJvd3NlckR1bW15VHJhbnNhY3Rpb25zKHJlZ2lzdHJhdGlvbnMpIHtcbiAgICBjb25zdCByb2xsYmFja1Jlc3VsdHMgPSBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQoWy4uLnJlZ2lzdHJhdGlvbnNdLnJldmVyc2UoKS5tYXAoKHJlZ2lzdHJhdGlvbikgPT4ge1xuICAgICAgY29uc3Qgc3RhcnRQcm9taXNlID0gcmVnaXN0cmF0aW9uLnN0YXJ0UHJvbWlzZVxuXG4gICAgICBpZiAoIXN0YXJ0UHJvbWlzZSkgcmV0dXJuXG5cbiAgICAgIHJlZ2lzdHJhdGlvbi5yb2xsYmFja1Byb21pc2UgPz89IChhc3luYyAoKSA9PiB7XG4gICAgICAgIGlmIChyZWdpc3RyYXRpb24ucXVhcmFudGluZWQpIHJldHVyblxuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXdhaXQgc3RhcnRQcm9taXNlXG4gICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnF1YXJhbnRpbmVCcm93c2VyRHVtbXlDb25uZWN0aW9uKHJlZ2lzdHJhdGlvbilcbiAgICAgICAgICB9IGNhdGNoIChxdWFyYW50aW5lRXJyb3IpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRmFpbGVkIHRvIHF1YXJhbnRpbmUgYnJvd3NlciBkdW1teSBkYXRhYmFzZSBhZnRlciB0cmFuc2FjdGlvbiBzdGFydHVwIGZhaWxlZDogJHtyZWdpc3RyYXRpb24uZGF0YWJhc2VJZGVudGlmaWVyfWAsIHtjYXVzZTogcXVhcmFudGluZUVycm9yfSlcbiAgICAgICAgICB9XG4gICAgICAgICAgcmV0dXJuXG4gICAgICAgIH1cbiAgICAgICAgaWYgKHJlZ2lzdHJhdGlvbi5xdWFyYW50aW5lZCkgcmV0dXJuXG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBhd2FpdCByZWdpc3RyYXRpb24uZGIucm9sbGJhY2tUcmFuc2FjdGlvbigpXG4gICAgICAgIH0gY2F0Y2ggKHJvbGxiYWNrRXJyb3IpIHtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5xdWFyYW50aW5lQnJvd3NlckR1bW15Q29ubmVjdGlvbihyZWdpc3RyYXRpb24pXG4gICAgICAgICAgfSBjYXRjaCAocXVhcmFudGluZUVycm9yKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoXG4gICAgICAgICAgICAgIFtyb2xsYmFja0Vycm9yLCBxdWFyYW50aW5lRXJyb3JdLFxuICAgICAgICAgICAgICBgRmFpbGVkIHRvIHJvbGwgYmFjayBhbmQgcXVhcmFudGluZSBicm93c2VyIGR1bW15IGRhdGFiYXNlOiAke3JlZ2lzdHJhdGlvbi5kYXRhYmFzZUlkZW50aWZpZXJ9YCxcbiAgICAgICAgICAgICAge2NhdXNlOiBxdWFyYW50aW5lRXJyb3J9XG4gICAgICAgICAgICApXG4gICAgICAgICAgfVxuICAgICAgICAgIHRocm93IHJvbGxiYWNrRXJyb3JcbiAgICAgICAgfVxuICAgICAgfSkoKVxuXG4gICAgICByZXR1cm4gcmVnaXN0cmF0aW9uLnJvbGxiYWNrUHJvbWlzZVxuICAgIH0pKVxuICAgIGNvbnN0IGVycm9ycyA9IHJvbGxiYWNrUmVzdWx0c1xuICAgICAgLmZpbHRlcigocmVzdWx0KSA9PiByZXN1bHQuc3RhdHVzID09PSBcInJlamVjdGVkXCIpXG4gICAgICAubWFwKChyZXN1bHQpID0+IHJlc3VsdC5yZWFzb24pXG5cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA9PSAxKSB0aHJvdyBlcnJvcnNbMF1cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA+IDEpIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihlcnJvcnMsIFwiQnJvd3NlciBkdW1teSB0cmFuc2FjdGlvbiBjbGVhbnVwIGZhaWxlZFwiLCB7Y2F1c2U6IGVycm9yc1swXX0pXG4gIH1cblxuICAvKipcbiAgICogUGVybWFuZW50bHkgcmVtb3ZlcyBvbmUgYnJvd3NlciBjb25uZWN0aW9uIHRoYXQgY2Fubm90IGJlIHNoYXJlZCBzYWZlbHkuXG4gICAqIEBwYXJhbSB7QnJvd3NlckR1bW15Q29ubmVjdGlvblJlZ2lzdHJhdGlvbn0gcmVnaXN0cmF0aW9uIC0gQnJvd3NlciBjb25uZWN0aW9uIHJlZ2lzdHJhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIGNvbm5lY3Rpb24gaXMgZGlzY2FyZGVkLlxuICAgKi9cbiAgYXN5bmMgcXVhcmFudGluZUJyb3dzZXJEdW1teUNvbm5lY3Rpb24ocmVnaXN0cmF0aW9uKSB7XG4gICAgcmVnaXN0cmF0aW9uLnF1YXJhbnRpbmVkID0gdHJ1ZVxuICAgIHJlZ2lzdHJhdGlvbi5xdWFyYW50aW5lUHJvbWlzZSA/Pz0gdGhpcy5kaXNjYXJkQnJvd3NlckR1bW15Q29ubmVjdGlvbihyZWdpc3RyYXRpb24uZGF0YWJhc2VJZGVudGlmaWVyLCByZWdpc3RyYXRpb24uZGIpXG4gICAgYXdhaXQgcmVnaXN0cmF0aW9uLnF1YXJhbnRpbmVQcm9taXNlXG4gIH1cblxuICAvKipcbiAgICogRGlzY2FyZHMgb25lIGJyb3dzZXIgZHVtbXkgY29ubmVjdGlvbiB0aHJvdWdoIGl0cyBvd25pbmcgcG9vbC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGRhdGFiYXNlSWRlbnRpZmllciAtIENvbmZpZ3VyZWQgZGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBVbnNhZmUgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgZGlzY2FyZC5cbiAgICovXG4gIGFzeW5jIGRpc2NhcmRCcm93c2VyRHVtbXlDb25uZWN0aW9uKGRhdGFiYXNlSWRlbnRpZmllciwgZGIpIHtcbiAgICBhd2FpdCB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXREYXRhYmFzZVBvb2woZGF0YWJhc2VJZGVudGlmaWVyKS5kaXNjYXJkKGRiKVxuICB9XG5cbiAgLyoqXG4gICAqIFF1YXJhbnRpbmVzIGFsbCBicm93c2VyIGNvbm5lY3Rpb25zIGNvbmN1cnJlbnRseS5cbiAgICogQHBhcmFtIHtCcm93c2VyRHVtbXlDb25uZWN0aW9uUmVnaXN0cmF0aW9uW119IHJlZ2lzdHJhdGlvbnMgLSBCcm93c2VyIGNvbm5lY3Rpb24gcmVnaXN0cmF0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgZXZlcnkgY29ubmVjdGlvbiBpcyBkaXNjYXJkZWQuXG4gICAqL1xuICBhc3luYyBxdWFyYW50aW5lQnJvd3NlckR1bW15Q29ubmVjdGlvbnMocmVnaXN0cmF0aW9ucykge1xuICAgIGNvbnN0IHF1YXJhbnRpbmVSZXN1bHRzID0gYXdhaXQgUHJvbWlzZS5hbGxTZXR0bGVkKHJlZ2lzdHJhdGlvbnMubWFwKGFzeW5jIChyZWdpc3RyYXRpb24pID0+IHtcbiAgICAgIGF3YWl0IHRoaXMucXVhcmFudGluZUJyb3dzZXJEdW1teUNvbm5lY3Rpb24ocmVnaXN0cmF0aW9uKVxuICAgIH0pKVxuICAgIGNvbnN0IGVycm9ycyA9IHF1YXJhbnRpbmVSZXN1bHRzXG4gICAgICAuZmlsdGVyKChyZXN1bHQpID0+IHJlc3VsdC5zdGF0dXMgPT09IFwicmVqZWN0ZWRcIilcbiAgICAgIC5tYXAoKHJlc3VsdCkgPT4gcmVzdWx0LnJlYXNvbilcblxuICAgIGlmIChlcnJvcnMubGVuZ3RoID09IDEpIHRocm93IGVycm9yc1swXVxuICAgIGlmIChlcnJvcnMubGVuZ3RoID4gMSkgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKGVycm9ycywgXCJCcm93c2VyIGR1bW15IGNvbm5lY3Rpb24gcXVhcmFudGluZSBmYWlsZWRcIiwge2NhdXNlOiBlcnJvcnNbMF19KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdHJ1bmNhdGUgZGF0YWJhc2VzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0Pn0gZGJzIC0gRGF0YWJhc2UgY29ubmVjdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyB0cnVuY2F0ZURhdGFiYXNlcyhkYnMpIHtcbiAgICBmb3IgKGNvbnN0IGlkZW50aWZpZXIgb2YgT2JqZWN0LmtleXMoZGJzKSkge1xuICAgICAgYXdhaXQgZGJzW2lkZW50aWZpZXJdLnRydW5jYXRlQWxsVGFibGVzKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZXhjbHVkZSB0YWcgc2V0LlxuICAgKiBAcmV0dXJucyB7U2V0PHN0cmluZz59IC0gRXhjbHVkZSB0YWcgc2V0LlxuICAgKi9cbiAgZ2V0RXhjbHVkZVRhZ1NldCgpIHtcbiAgICAvKipcbiAgICAgKiBDb25maWcgdGFncy5cbiAgICAgKiBAdHlwZSB7c3RyaW5nW119ICovXG4gICAgY29uc3QgY29uZmlnVGFncyA9IEFycmF5LmlzQXJyYXkodGVzdENvbmZpZy5leGNsdWRlVGFncykgPyB0ZXN0Q29uZmlnLmV4Y2x1ZGVUYWdzIDogW11cblxuICAgIHJldHVybiBuZXcgU2V0KFsuLi50aGlzLl9leGNsdWRlVGFncywgLi4uY29uZmlnVGFnc10pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBidWlsZCBmdWxsIGRlc2NyaXB0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBkZXNjcmlwdGlvbnMgLSBEZXNjcmlwdGlvbiBzdGFjay5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRlc3REZXNjcmlwdGlvbiAtIFRlc3QgZGVzY3JpcHRpb24uXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gRnVsbCBkZXNjcmlwdGlvbi5cbiAgICovXG4gIGJ1aWxkRnVsbERlc2NyaXB0aW9uKGRlc2NyaXB0aW9ucywgdGVzdERlc2NyaXB0aW9uKSB7XG4gICAgY29uc3QgcGFydHMgPSBkZXNjcmlwdGlvbnMuY29uY2F0KFt0ZXN0RGVzY3JpcHRpb25dKVxuXG4gICAgcmV0dXJuIHBhcnRzLmpvaW4oXCIgXCIpLnRyaW0oKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXBwbGljYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFwcGxpY2F0aW9uPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBhcHBsaWNhdGlvbi5cbiAgICovXG4gIGFzeW5jIGFwcGxpY2F0aW9uKCkge1xuICAgIGlmICghdGhpcy5fYXBwbGljYXRpb24pIHtcbiAgICAgIHRoaXMuX2FwcGxpY2F0aW9uID0gbmV3IEFwcGxpY2F0aW9uKHtcbiAgICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5nZXRDb25maWd1cmF0aW9uKCksXG4gICAgICAgIC8vIFJ1biByZXF1ZXN0IGhhbmRsZXJzIGluIHRoZSBtYWluIHRocmVhZCAobm90IHdvcmtlciB0aHJlYWRzKSBzbyB0aGV5XG4gICAgICAgIC8vIHJlc29sdmUgREIgd29yayB0byB0aGUgcGVyLXRlc3Qgc2hhcmVkIGNvbm5lY3Rpb24gc2V0IGJ5XG4gICAgICAgIC8vIHtAbGluayBhY3RpdmF0ZVRlc3RTaGFyZWRDb25uZWN0aW9uc30uIFRoaXMgbGV0cyByZXF1ZXN0LXR5cGUgc3BlY3MgdXNlXG4gICAgICAgIC8vIHRyYW5zYWN0aW9uLWJhc2VkIGNsZWFuaW5nICh0aGVpciB3cml0ZXMgbGFuZCBpbnNpZGUgdGhlIHRlc3Qnc1xuICAgICAgICAvLyB0cmFuc2FjdGlvbiBhbmQgcm9sbCBiYWNrKSBpbnN0ZWFkIG9mIHRydW5jYXRpbmcgZXZlcnkgdGFibGUuXG4gICAgICAgIGh0dHBTZXJ2ZXI6IHtpblByb2Nlc3M6IHRydWUsIHBvcnQ6IDMxMDA2fSxcbiAgICAgICAgdHlwZTogXCJ0ZXN0LXJ1bm5lclwiXG4gICAgICB9KVxuXG4gICAgICBhd2FpdCB0aGlzLl9hcHBsaWNhdGlvbi5pbml0aWFsaXplKClcbiAgICAgIGF3YWl0IHRoaXMuX2FwcGxpY2F0aW9uLnN0YXJ0SHR0cFNlcnZlcigpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2FwcGxpY2F0aW9uXG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIGVhY2ggbm9uLXRlbmFudCBwZXItdGVzdCBjb25uZWN0aW9uIGFzIGEgZHluYW1pYyBjYW5kaWRhdGUgZm9yIGluLXByb2Nlc3NcbiAgICogcmVxdWVzdCBzaGFyaW5nLiBUaGUgcG9vbCBldmFsdWF0ZXMgdHJhbnNhY3Rpb24gc3RhdGUgd2hlbiBlYWNoIHJlcXVlc3QgaXMgZGlzcGF0Y2hlZCxcbiAgICogc28gYSB0cmFuc2FjdGlvbiBzdGFydGVkIG9yIGVuZGVkIGR1cmluZyBhIGhvb2sgY2FsbGJhY2sgdGFrZXMgZWZmZWN0IGltbWVkaWF0ZWx5LlxuICAgKiBJbmFjdGl2ZSBhbmQgdGVuYW50LW9ubHkgY29ubmVjdGlvbnMgcmVtYWluIGluZGVwZW5kZW50bHkgcG9vbGVkLiBQYWlyIHdpdGhcbiAgICoge0BsaW5rIGNsZWFyVGVzdFNoYXJlZENvbm5lY3Rpb25zfSBpbiBhIGZpbmFsbHkuXG4gICAqIEByZXR1cm5zIHt7cG9vbDogaW1wb3J0KFwiLi4vZGF0YWJhc2UvcG9vbC9iYXNlLmpzXCIpLmRlZmF1bHQsIHJlZ2lzdHJhdGlvbjogaW1wb3J0KFwiLi4vZGF0YWJhc2UvcG9vbC9iYXNlLmpzXCIpLlRlc3RTaGFyZWRDb25uZWN0aW9uUmVnaXN0cmF0aW9ufVtdfSAtIExpZmVjeWNsZS1vd25lZCByZWdpc3RyYXRpb25zLlxuICAgKi9cbiAgYWN0aXZhdGVUZXN0U2hhcmVkQ29ubmVjdGlvbnMoKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpXG4gICAgY29uc3QgY3VycmVudENvbm5lY3Rpb25zID0gY29uZmlndXJhdGlvbi5nZXRDdXJyZW50Q29ubmVjdGlvbnMoKVxuICAgIC8qKiBAdHlwZSB7e3Bvb2w6IGltcG9ydChcIi4uL2RhdGFiYXNlL3Bvb2wvYmFzZS5qc1wiKS5kZWZhdWx0LCByZWdpc3RyYXRpb246IGltcG9ydChcIi4uL2RhdGFiYXNlL3Bvb2wvYmFzZS5qc1wiKS5UZXN0U2hhcmVkQ29ubmVjdGlvblJlZ2lzdHJhdGlvbn1bXX0gKi9cbiAgICBjb25zdCByZWdpc3RyYXRpb25zID0gW11cblxuICAgIGZvciAoY29uc3QgaWRlbnRpZmllciBvZiBPYmplY3Qua2V5cyhjdXJyZW50Q29ubmVjdGlvbnMpKSB7XG4gICAgICBjb25zdCBwb29sID0gY29uZmlndXJhdGlvbi5nZXREYXRhYmFzZVBvb2woaWRlbnRpZmllcilcblxuICAgICAgLy8gVGVuYW50LXNjb3BlZCBwb29scyByZXNvbHZlIGEgZGlmZmVyZW50IGNvbm5lY3Rpb24gcGVyIHJlcXVlc3QgdGVuYW50XG4gICAgICAvLyAodmlhIHJ1bldpdGhUZW5hbnQpLCBzbyBmb3JjaW5nIGEgc2luZ2xlIHNoYXJlZCBjb25uZWN0aW9uIHdvdWxkIGJyZWFrXG4gICAgICAvLyBwZXItcmVxdWVzdCB0ZW5hbnQgcmVzb2x1dGlvbi4gT25seSBzaGFyZSBub24tdGVuYW50IHBvb2xzOyB0aGUgdGVuYW50XG4gICAgICAvLyBwb29sIGtlZXBzIHJlc29sdmluZyBpdHMgb3duIGNvbm5lY3Rpb24gcGVyIHJlcXVlc3QuXG4gICAgICBpZiAocG9vbC5nZXRDb25maWd1cmF0aW9uKCkudGVuYW50T25seSkge1xuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBjb25zdCBjb25uZWN0aW9uID0gY3VycmVudENvbm5lY3Rpb25zW2lkZW50aWZpZXJdXG5cbiAgICAgIGNvbnN0IHJlZ2lzdHJhdGlvbiA9IHBvb2wuc2V0VGVzdFNoYXJlZENvbm5lY3Rpb25Qcm92aWRlcigoKSA9PiB7XG4gICAgICAgIHJldHVybiBjb25uZWN0aW9uLmluc2lkZVRyYW5zYWN0aW9uKCkgPyBjb25uZWN0aW9uIDogdW5kZWZpbmVkXG4gICAgICB9KVxuXG4gICAgICBpZiAocmVnaXN0cmF0aW9uKSByZWdpc3RyYXRpb25zLnB1c2goe3Bvb2wsIHJlZ2lzdHJhdGlvbn0pXG4gICAgfVxuXG4gICAgcmV0dXJuIHJlZ2lzdHJhdGlvbnNcbiAgfVxuXG4gIC8qKlxuICAgKiBDbGVhcnMgdGhlIGluLXByb2Nlc3MgdGVzdCBzaGFyZWQgY29ubmVjdGlvbiBvbiBldmVyeSBjb25maWd1cmVkIHBvb2wuIElkZW1wb3RlbnQgYW5kXG4gICAqIHNhZmUgdG8gY2FsbCB3aGVuIG5vbmUgd2FzIHNldC5cbiAgICogQHBhcmFtIHt7cG9vbDogaW1wb3J0KFwiLi4vZGF0YWJhc2UvcG9vbC9iYXNlLmpzXCIpLmRlZmF1bHQsIHJlZ2lzdHJhdGlvbjogaW1wb3J0KFwiLi4vZGF0YWJhc2UvcG9vbC9iYXNlLmpzXCIpLlRlc3RTaGFyZWRDb25uZWN0aW9uUmVnaXN0cmF0aW9ufVtdfSBbcmVnaXN0cmF0aW9uc10gLSBMaWZlY3ljbGUtb3duZWQgcmVnaXN0cmF0aW9ucyB0byBjbGVhciBjb25kaXRpb25hbGx5LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGNsZWFyVGVzdFNoYXJlZENvbm5lY3Rpb25zKHJlZ2lzdHJhdGlvbnMpIHtcbiAgICBpZiAocmVnaXN0cmF0aW9ucykge1xuICAgICAgZm9yIChjb25zdCB7cG9vbCwgcmVnaXN0cmF0aW9ufSBvZiByZWdpc3RyYXRpb25zKSB7XG4gICAgICAgIHBvb2wuY2xlYXJUZXN0U2hhcmVkQ29ubmVjdGlvbihyZWdpc3RyYXRpb24pXG4gICAgICB9XG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKClcblxuICAgIGZvciAoY29uc3QgaWRlbnRpZmllciBvZiBjb25maWd1cmF0aW9uLmdldERhdGFiYXNlSWRlbnRpZmllcnMoKSkge1xuICAgICAgY29uZmlndXJhdGlvbi5nZXREYXRhYmFzZVBvb2woaWRlbnRpZmllcikuY2xlYXJUZXN0U2hhcmVkQ29ubmVjdGlvbigpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrcyBvdXQgYW5kIHJlZ2lzdGVycyBvbmUgcGh5c2ljYWwgdGVuYW50IHRyYW5zYWN0aW9uIGZvciB0aGUgY3VycmVudCBhdHRlbXB0LlxuICAgKiBAcGFyYW0ge3tkYXRhYmFzZUlkZW50aWZpZXI6IHN0cmluZywgdGVuYW50OiBvYmplY3R9fSBhcmdzIC0gTG9naWNhbCBpZGVudGlmaWVyIGFuZCB0ZW5hbnQgZGVzY3JpcHRvci5cbiAgICogQHBhcmFtIHtUcmFuc2FjdGlvbmFsVGVuYW50UmVnaXN0cmF0aW9uW119IHJlZ2lzdHJhdGlvbnMgLSBDdXJyZW50IGF0dGVtcHQgcmVnaXN0cmF0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyByZWdpc3RlclRyYW5zYWN0aW9uYWxUZW5hbnQoe2RhdGFiYXNlSWRlbnRpZmllciwgdGVuYW50LCAuLi5yZXN0QXJnc30sIHJlZ2lzdHJhdGlvbnMpIHtcbiAgICByZXN0QXJnc0Vycm9yKHJlc3RBcmdzKVxuICAgIGlmICghZGF0YWJhc2VJZGVudGlmaWVyKSB0aHJvdyBuZXcgRXJyb3IoXCJyZWdpc3RlclRyYW5zYWN0aW9uYWxUZW5hbnQgcmVxdWlyZXMgYSBkYXRhYmFzZUlkZW50aWZpZXJcIilcbiAgICBpZiAoIXRlbmFudCkgdGhyb3cgbmV3IEVycm9yKFwicmVnaXN0ZXJUcmFuc2FjdGlvbmFsVGVuYW50IHJlcXVpcmVzIGEgdGVuYW50XCIpXG5cbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKClcbiAgICBjb25zdCBwb29sID0gY29uZmlndXJhdGlvbi5nZXREYXRhYmFzZVBvb2woZGF0YWJhc2VJZGVudGlmaWVyKVxuICAgIGNvbnN0IGRhdGFiYXNlQ29uZmlndXJhdGlvbiA9IGNvbmZpZ3VyYXRpb24ucmVzb2x2ZURhdGFiYXNlQ29uZmlndXJhdGlvbihkYXRhYmFzZUlkZW50aWZpZXIsIHRlbmFudClcbiAgICBpZiAoIWRhdGFiYXNlQ29uZmlndXJhdGlvbi50ZW5hbnRPbmx5KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYHJlZ2lzdGVyVHJhbnNhY3Rpb25hbFRlbmFudCByZXF1aXJlcyBhIHRlbmFudE9ubHkgZGF0YWJhc2U6ICR7ZGF0YWJhc2VJZGVudGlmaWVyfWApXG4gICAgfVxuICAgIGNvbnN0IHJldXNlS2V5ID0gcG9vbC5nZXRDb25maWd1cmF0aW9uUmV1c2VLZXkoZGF0YWJhc2VDb25maWd1cmF0aW9uKVxuICAgIGlmIChyZWdpc3RyYXRpb25zLnNvbWUoKHJlZ2lzdHJhdGlvbikgPT4gcmVnaXN0cmF0aW9uLnBvb2wgPT09IHBvb2wgJiYgcmVnaXN0cmF0aW9uLnJldXNlS2V5ID09PSByZXVzZUtleSkpIHJldHVyblxuXG4gICAgLyoqIEB0eXBlIHtUcmFuc2FjdGlvbmFsVGVuYW50UmVnaXN0cmF0aW9ufSAqL1xuICAgIGNvbnN0IHJlZ2lzdHJhdGlvbiA9IHtcbiAgICAgIGNvbm5lY3Rpb246IHVuZGVmaW5lZCxcbiAgICAgIHBvb2wsXG4gICAgICByZXVzZUtleSxcbiAgICAgIHJldm9rZWQ6IGZhbHNlLFxuICAgICAgc2hhcmVkUmVnaXN0cmF0aW9uOiB1bmRlZmluZWRcbiAgICB9XG5cbiAgICByZWdpc3RyYXRpb25zLnB1c2gocmVnaXN0cmF0aW9uKVxuICAgIHJlZ2lzdHJhdGlvbi5jaGVja291dFByb21pc2UgPSBwb29sXG4gICAgICAuY2hlY2tvdXRGb3JDb25maWd1cmF0aW9uKGRhdGFiYXNlQ29uZmlndXJhdGlvbiwge25hbWU6IFwiVHJhbnNhY3Rpb25hbCB0ZW5hbnQgdGVzdCByZWdpc3RyYXRpb25cIn0pXG4gICAgICAudGhlbihcbiAgICAgICAgKGNvbm5lY3Rpb24pID0+ICh7Y29ubmVjdGlvbiwgZXJyb3I6IHVuZGVmaW5lZH0pLFxuICAgICAgICAoZXJyb3IpID0+ICh7XG4gICAgICAgICAgY29ubmVjdGlvbjogdW5kZWZpbmVkLFxuICAgICAgICAgIGVycm9yOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoXCJUcmFuc2FjdGlvbmFsIHRlbmFudCBjb25uZWN0aW9uIGNoZWNrb3V0IGZhaWxlZFwiLCB7Y2F1c2U6IGVycm9yfSlcbiAgICAgICAgfSlcbiAgICAgIClcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBjaGVja291dE91dGNvbWUgPSBhd2FpdCByZWdpc3RyYXRpb24uY2hlY2tvdXRQcm9taXNlXG5cbiAgICAgIGlmIChjaGVja291dE91dGNvbWUuZXJyb3IpIHRocm93IGNoZWNrb3V0T3V0Y29tZS5lcnJvclxuICAgICAgaWYgKCFjaGVja291dE91dGNvbWUuY29ubmVjdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiVHJhbnNhY3Rpb25hbCB0ZW5hbnQgY29ubmVjdGlvbiBjaGVja291dCByZXR1cm5lZCBubyBjb25uZWN0aW9uXCIpXG4gICAgICByZWdpc3RyYXRpb24uY29ubmVjdGlvbiA9IGNoZWNrb3V0T3V0Y29tZS5jb25uZWN0aW9uXG4gICAgICBpZiAocmVnaXN0cmF0aW9uLnJldm9rZWQpIHRocm93IG5ldyBFcnJvcihcIlRyYW5zYWN0aW9uYWwgdGVuYW50IHRlc3QgcmVnaXN0cmF0aW9uIGF0dGVtcHQgaXMgbm8gbG9uZ2VyIGFjdGl2ZVwiKVxuXG4gICAgICBhd2FpdCByZWdpc3RyYXRpb24uY29ubmVjdGlvbi5zdGFydFRyYW5zYWN0aW9uKClcbiAgICAgIGlmIChyZWdpc3RyYXRpb24ucmV2b2tlZCkgdGhyb3cgbmV3IEVycm9yKFwiVHJhbnNhY3Rpb25hbCB0ZW5hbnQgdGVzdCByZWdpc3RyYXRpb24gYXR0ZW1wdCBpcyBubyBsb25nZXIgYWN0aXZlXCIpXG5cbiAgICAgIGNvbnN0IHNoYXJlZFJlZ2lzdHJhdGlvbiA9IHBvb2wuc2V0VGVzdFNoYXJlZENvbm5lY3Rpb25Gb3JDb25maWd1cmF0aW9uKHJlZ2lzdHJhdGlvbi5jb25uZWN0aW9uLCByZXVzZUtleSlcbiAgICAgIGlmICghc2hhcmVkUmVnaXN0cmF0aW9uKSB0aHJvdyBuZXcgRXJyb3IoYERhdGFiYXNlIHBvb2wgZG9lcyBub3Qgc3VwcG9ydCB0cmFuc2FjdGlvbmFsIHRlbmFudCB0ZXN0IGNvbm5lY3Rpb25zOiAke2RhdGFiYXNlSWRlbnRpZmllcn1gKVxuICAgICAgcmVnaXN0cmF0aW9uLnNoYXJlZFJlZ2lzdHJhdGlvbiA9IHNoYXJlZFJlZ2lzdHJhdGlvblxuICAgICAgaWYgKHJlZ2lzdHJhdGlvbi5yZXZva2VkKSB7XG4gICAgICAgIHBvb2wuY2xlYXJUZXN0U2hhcmVkQ29ubmVjdGlvbihzaGFyZWRSZWdpc3RyYXRpb24pXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIlRyYW5zYWN0aW9uYWwgdGVuYW50IHRlc3QgcmVnaXN0cmF0aW9uIGF0dGVtcHQgaXMgbm8gbG9uZ2VyIGFjdGl2ZVwiKVxuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICByZWdpc3RyYXRpb24ucmV2b2tlZCA9IHRydWVcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMuY2xlYW51cFRyYW5zYWN0aW9uYWxUZW5hbnRzKFtyZWdpc3RyYXRpb25dLCB7ZGlzY2FyZDogcmVnaXN0cmF0aW9uLmRpc2NhcmRPbkNsZWFudXAgPT09IHRydWV9KVxuICAgICAgfSBjYXRjaCAoY2xlYW51cEVycm9yKSB7XG4gICAgICAgIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihbZXJyb3IsIGNsZWFudXBFcnJvcl0sIFwiRmFpbGVkIHRvIHJlZ2lzdGVyIGFuZCBjbGVhbiB1cCBhIHRyYW5zYWN0aW9uYWwgdGVuYW50IHRlc3QgY29ubmVjdGlvblwiLCB7Y2F1c2U6IGNsZWFudXBFcnJvcn0pXG4gICAgICB9XG4gICAgICB0aHJvdyBlcnJvclxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXZva2VzIGF0dGVtcHQgcmVnaXN0cmF0aW9ucyBiZWZvcmUgcm9sbGluZyBiYWNrIGFuZCByZWxlYXNpbmcgdGhlaXIgY29ubmVjdGlvbnMuXG4gICAqIEBwYXJhbSB7VHJhbnNhY3Rpb25hbFRlbmFudFJlZ2lzdHJhdGlvbltdfSByZWdpc3RyYXRpb25zIC0gQXR0ZW1wdCByZWdpc3RyYXRpb25zLlxuICAgKiBAcGFyYW0ge3tkaXNjYXJkPzogYm9vbGVhbn19IFtvcHRpb25zXSAtIFdoZXRoZXIgY29ubmVjdGlvbnMgbXVzdCBiZSBkaXNjYXJkZWQgaW5zdGVhZCBvZiByZXR1cm5lZCB0byB0aGUgcG9vbC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBjbGVhbnVwVHJhbnNhY3Rpb25hbFRlbmFudHMocmVnaXN0cmF0aW9ucywge2Rpc2NhcmQgPSBmYWxzZX0gPSB7fSkge1xuICAgIGZvciAoY29uc3QgcmVnaXN0cmF0aW9uIG9mIHJlZ2lzdHJhdGlvbnMpIHtcbiAgICAgIHJlZ2lzdHJhdGlvbi5yZXZva2VkID0gdHJ1ZVxuICAgICAgaWYgKGRpc2NhcmQpIHJlZ2lzdHJhdGlvbi5kaXNjYXJkT25DbGVhbnVwID0gdHJ1ZVxuICAgICAgaWYgKHJlZ2lzdHJhdGlvbi5zaGFyZWRSZWdpc3RyYXRpb24pIHJlZ2lzdHJhdGlvbi5wb29sLmNsZWFyVGVzdFNoYXJlZENvbm5lY3Rpb24ocmVnaXN0cmF0aW9uLnNoYXJlZFJlZ2lzdHJhdGlvbilcbiAgICB9XG4gICAgY29uc3QgY2xlYW51cFJlc3VsdHMgPSBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQoWy4uLnJlZ2lzdHJhdGlvbnNdLnJldmVyc2UoKS5tYXAoKHJlZ2lzdHJhdGlvbikgPT4ge1xuICAgICAgcmVnaXN0cmF0aW9uLmNsZWFudXBQcm9taXNlID8/PSB0aGlzLmNsZWFudXBUcmFuc2FjdGlvbmFsVGVuYW50UmVnaXN0cmF0aW9uKHJlZ2lzdHJhdGlvbilcblxuICAgICAgcmV0dXJuIHJlZ2lzdHJhdGlvbi5jbGVhbnVwUHJvbWlzZVxuICAgIH0pKVxuICAgIGNvbnN0IGVycm9ycyA9IGNsZWFudXBSZXN1bHRzXG4gICAgICAuZmlsdGVyKChyZXN1bHQpID0+IHJlc3VsdC5zdGF0dXMgPT09IFwicmVqZWN0ZWRcIilcbiAgICAgIC5tYXAoKHJlc3VsdCkgPT4gcmVzdWx0LnJlYXNvbilcblxuICAgIGlmIChlcnJvcnMubGVuZ3RoID09PSAxKSB0aHJvdyBlcnJvcnNbMF1cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA+IDEpIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihlcnJvcnMsIFwiRmFpbGVkIHRvIGNsZWFuIHVwIHRyYW5zYWN0aW9uYWwgdGVuYW50IHRlc3QgY29ubmVjdGlvbnNcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBDbGVhbnMgb25lIGF0dGVtcHQgcmVnaXN0cmF0aW9uIGV4YWN0bHkgb25jZSwgaW5jbHVkaW5nIGEgY2hlY2tvdXQgdGhhdCB3YXMgc3RpbGwgcGVuZGluZyBhdCByZXZvY2F0aW9uLlxuICAgKiBAcGFyYW0ge1RyYW5zYWN0aW9uYWxUZW5hbnRSZWdpc3RyYXRpb259IHJlZ2lzdHJhdGlvbiAtIEF0dGVtcHQtb3duZWQgcmVnaXN0cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciByb2xsYmFjayBhbmQgcmVsZWFzZSBvciBxdWFyYW50aW5lLlxuICAgKi9cbiAgYXN5bmMgY2xlYW51cFRyYW5zYWN0aW9uYWxUZW5hbnRSZWdpc3RyYXRpb24ocmVnaXN0cmF0aW9uKSB7XG4gICAgbGV0IGNvbm5lY3Rpb24gPSByZWdpc3RyYXRpb24uY29ubmVjdGlvblxuXG4gICAgaWYgKCFjb25uZWN0aW9uICYmIHJlZ2lzdHJhdGlvbi5jaGVja291dFByb21pc2UpIHtcbiAgICAgIGNvbnN0IGNoZWNrb3V0T3V0Y29tZSA9IGF3YWl0IHJlZ2lzdHJhdGlvbi5jaGVja291dFByb21pc2VcblxuICAgICAgaWYgKGNoZWNrb3V0T3V0Y29tZS5lcnJvcikgcmV0dXJuXG4gICAgICBjb25uZWN0aW9uID0gY2hlY2tvdXRPdXRjb21lLmNvbm5lY3Rpb25cbiAgICAgIHJlZ2lzdHJhdGlvbi5jb25uZWN0aW9uID0gY29ubmVjdGlvblxuICAgIH1cbiAgICBpZiAoIWNvbm5lY3Rpb24pIHJldHVyblxuXG4gICAgY29uc3QgZXJyb3JzID0gW11cblxuICAgIHRyeSB7XG4gICAgICBpZiAoY29ubmVjdGlvbi5pbnNpZGVUcmFuc2FjdGlvbigpKSBhd2FpdCBjb25uZWN0aW9uLnJvbGxiYWNrVHJhbnNhY3Rpb24oKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBlcnJvcnMucHVzaChlcnJvcilcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgaWYgKHJlZ2lzdHJhdGlvbi5kaXNjYXJkT25DbGVhbnVwKSB7XG4gICAgICAgICAgYXdhaXQgcmVnaXN0cmF0aW9uLnBvb2wuZGlzY2FyZChjb25uZWN0aW9uKVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGF3YWl0IHJlZ2lzdHJhdGlvbi5wb29sLmNoZWNraW4oY29ubmVjdGlvbilcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgZXJyb3JzLnB1c2goZXJyb3IpXG4gICAgICB9XG4gICAgfVxuICAgIGlmIChlcnJvcnMubGVuZ3RoID09PSAxKSB0aHJvdyBlcnJvcnNbMF1cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA+IDEpIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihlcnJvcnMsIFwiRmFpbGVkIHRvIGNsZWFuIHVwIGEgdHJhbnNhY3Rpb25hbCB0ZW5hbnQgdGVzdCBjb25uZWN0aW9uXCIpXG4gIH1cblxuICAvKipcbiAgICogU2VsZWN0cyB0aGUgY3VycmVudCBub24tdGVuYW50IGNvbm5lY3Rpb25zIGVsaWdpYmxlIGZvciBzaGFyZWQgdHJhbnNhY3Rpb24gd29yay5cbiAgICogQHBhcmFtIHt7dHJhbnNhY3Rpb25zT25seTogYm9vbGVhbn19IGFyZ3MgLSBTZWxlY3Rpb24gb3B0aW9ucy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0Pn0gLSBFbGlnaWJsZSBjb25uZWN0aW9ucyBieSBpZGVudGlmaWVyLlxuICAgKi9cbiAgc2hhcmVkVHJhbnNhY3Rpb25Db25uZWN0aW9ucyh7dHJhbnNhY3Rpb25zT25seX0pIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKClcbiAgICBjb25zdCBjdXJyZW50Q29ubmVjdGlvbnMgPSBjb25maWd1cmF0aW9uLmdldEN1cnJlbnRDb25uZWN0aW9ucygpXG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdD59ICovXG4gICAgY29uc3QgY29ubmVjdGlvbnMgPSB7fVxuXG4gICAgZm9yIChjb25zdCBbaWRlbnRpZmllciwgY29ubmVjdGlvbl0gb2YgT2JqZWN0LmVudHJpZXMoY3VycmVudENvbm5lY3Rpb25zKSkge1xuICAgICAgY29uc3QgcG9vbCA9IGNvbmZpZ3VyYXRpb24uZ2V0RGF0YWJhc2VQb29sKGlkZW50aWZpZXIpXG5cbiAgICAgIGlmIChwb29sLmdldENvbmZpZ3VyYXRpb24oKS50ZW5hbnRPbmx5KSBjb250aW51ZVxuICAgICAgaWYgKHRyYW5zYWN0aW9uc09ubHkgJiYgIWNvbm5lY3Rpb24uaW5zaWRlVHJhbnNhY3Rpb24oKSkgY29udGludWVcbiAgICAgIGNvbm5lY3Rpb25zW2lkZW50aWZpZXJdID0gY29ubmVjdGlvblxuICAgIH1cblxuICAgIHJldHVybiBjb25uZWN0aW9uc1xuICB9XG5cbiAgLyoqXG4gICAqIEluc3RhbGxzIHBoeXNpY2FsLWNvbm5lY3Rpb24gY29vcmRpbmF0aW9uIGJlZm9yZSBhIHRyYW5zYWN0aW9uLW9wZW5pbmcgaG9va1xuICAgKiBjYW4gZXhwb3NlIHRoZSBzaGFyZWQgY29ubmVjdGlvbiB0byBhIGxvbmctbGl2ZWQgaW4tcHJvY2VzcyBzZXJ2aWNlLlxuICAgKiBDaGlsZC1wcm9jZXNzIGNvb3JkaW5hdGVzIHJlbWFpbiB1bnB1Ymxpc2hlZCB1bnRpbCB0aGUgdHJhbnNhY3Rpb24gZXhpc3RzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxTaGFyZWRUcmFuc2FjdGlvbkJyb2tlclJlZ2lzdHJhdGlvbiB8IHVuZGVmaW5lZD59IC0gUHJlcGFyZWQgY29vcmRpbmF0b3IuXG4gICAqL1xuICBhc3luYyBwcmVwYXJlU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXIoKSB7XG4gICAgY29uc3QgY29ubmVjdGlvbnMgPSB0aGlzLnNoYXJlZFRyYW5zYWN0aW9uQ29ubmVjdGlvbnMoe3RyYW5zYWN0aW9uc09ubHk6IGZhbHNlfSlcblxuICAgIGlmIChPYmplY3Qua2V5cyhjb25uZWN0aW9ucykubGVuZ3RoID09PSAwKSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgICByZXR1cm4ge1xuICAgICAgYnJva2VyOiBhd2FpdCBTaGFyZWRUcmFuc2FjdGlvbkJyb2tlci5zdGFydCh7Y29ubmVjdGlvbnN9KSxcbiAgICAgIGVudmlyb25tZW50UHVibGlzaGVkOiBmYWxzZSxcbiAgICAgIHByZXZpb3VzRW52aXJvbm1lbnQ6IHVuZGVmaW5lZFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVja3Mgd2hldGhlciBhIHByZXBhcmVkIGJyb2tlciBjb29yZGluYXRlcyBleGFjdGx5IHRoZSBzZWxlY3RlZCBwaHlzaWNhbCBjb25uZWN0aW9ucy5cbiAgICogQHBhcmFtIHtTaGFyZWRUcmFuc2FjdGlvbkJyb2tlclJlZ2lzdHJhdGlvbiB8IHVuZGVmaW5lZH0gcmVnaXN0cmF0aW9uIC0gUHJlcGFyZWQgY29vcmRpbmF0b3IuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQ+fSBjb25uZWN0aW9ucyAtIFNlbGVjdGVkIGNvbm5lY3Rpb25zLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBpZGVudGlmaWVyIHNldCBhbmQgcGh5c2ljYWwgY29ubmVjdGlvbnMgbWF0Y2ggZXhhY3RseS5cbiAgICovXG4gIHNoYXJlZFRyYW5zYWN0aW9uQnJva2VyTWF0Y2hlc0Nvbm5lY3Rpb25zKHJlZ2lzdHJhdGlvbiwgY29ubmVjdGlvbnMpIHtcbiAgICBjb25zdCBpZGVudGlmaWVycyA9IE9iamVjdC5rZXlzKGNvbm5lY3Rpb25zKVxuXG4gICAgaWYgKCFyZWdpc3RyYXRpb24gfHwgaWRlbnRpZmllcnMubGVuZ3RoID09PSAwKSByZXR1cm4gZmFsc2VcbiAgICBpZiAoT2JqZWN0LmtleXMocmVnaXN0cmF0aW9uLmJyb2tlci5jb25uZWN0aW9ucykubGVuZ3RoICE9PSBpZGVudGlmaWVycy5sZW5ndGgpIHJldHVybiBmYWxzZVxuXG4gICAgZm9yIChjb25zdCBbaWRlbnRpZmllciwgY29ubmVjdGlvbl0gb2YgT2JqZWN0LmVudHJpZXMoY29ubmVjdGlvbnMpKSB7XG4gICAgICBpZiAocmVnaXN0cmF0aW9uLmJyb2tlci5jb25uZWN0aW9uc1tpZGVudGlmaWVyXSAhPT0gY29ubmVjdGlvbikgcmV0dXJuIGZhbHNlXG4gICAgfVxuXG4gICAgcmV0dXJuIHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBTdGFydHMgYSBjYXBhYmlsaXR5LXNjb3BlZCBicm9rZXIgZm9yIHRoZSBhY3RpdmUgbm9uLXRlbmFudCBwaHlzaWNhbFxuICAgKiB0cmFuc2FjdGlvbiBjb25uZWN0aW9ucy4gTm8gYnJva2VyL2VudiBpcyBpbnN0YWxsZWQgZm9yIHRydW5jYXRpb24tb25seSBvclxuICAgKiBvdGhlciB0cmFuc2FjdGlvbi1kaXNhYmxlZCBhdHRlbXB0cy5cbiAgICogQHBhcmFtIHtTaGFyZWRUcmFuc2FjdGlvbkJyb2tlclJlZ2lzdHJhdGlvbn0gW3ByZXBhcmVkUmVnaXN0cmF0aW9uXSAtIENvb3JkaW5hdG9yIHByZXBhcmVkIGJlZm9yZSBob29rcy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdD59IFtzZWxlY3RlZENvbm5lY3Rpb25zXSAtIFBvc3QtaG9vayBhY3RpdmUgY29ubmVjdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFNoYXJlZFRyYW5zYWN0aW9uQnJva2VyUmVnaXN0cmF0aW9uIHwgdW5kZWZpbmVkPn0gLSBBdHRlbXB0IHJlZ2lzdHJhdGlvbi5cbiAgICovXG4gIGFzeW5jIHN0YXJ0U2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXIocHJlcGFyZWRSZWdpc3RyYXRpb24sIHNlbGVjdGVkQ29ubmVjdGlvbnMpIHtcbiAgICBjb25zdCBjb25uZWN0aW9ucyA9IHNlbGVjdGVkQ29ubmVjdGlvbnMgfHwgdGhpcy5zaGFyZWRUcmFuc2FjdGlvbkNvbm5lY3Rpb25zKHt0cmFuc2FjdGlvbnNPbmx5OiB0cnVlfSlcblxuICAgIGNvbnN0IGRhdGFiYXNlSWRlbnRpZmllcnMgPSBPYmplY3Qua2V5cyhjb25uZWN0aW9ucylcbiAgICBpZiAoZGF0YWJhc2VJZGVudGlmaWVycy5sZW5ndGggPT09IDApIHtcbiAgICAgIGF3YWl0IHRoaXMuc3RvcFNoYXJlZFRyYW5zYWN0aW9uQnJva2VyKHByZXBhcmVkUmVnaXN0cmF0aW9uKVxuICAgICAgcmV0dXJuIHVuZGVmaW5lZFxuICAgIH1cblxuICAgIGxldCBicm9rZXJcblxuICAgIGlmIChwcmVwYXJlZFJlZ2lzdHJhdGlvbiAmJiB0aGlzLnNoYXJlZFRyYW5zYWN0aW9uQnJva2VyTWF0Y2hlc0Nvbm5lY3Rpb25zKHByZXBhcmVkUmVnaXN0cmF0aW9uLCBjb25uZWN0aW9ucykpIHtcbiAgICAgIGJyb2tlciA9IHByZXBhcmVkUmVnaXN0cmF0aW9uLmJyb2tlclxuICAgIH0gZWxzZSB7XG4gICAgICBhd2FpdCB0aGlzLnN0b3BTaGFyZWRUcmFuc2FjdGlvbkJyb2tlcihwcmVwYXJlZFJlZ2lzdHJhdGlvbilcbiAgICAgIGJyb2tlciA9IGF3YWl0IFNoYXJlZFRyYW5zYWN0aW9uQnJva2VyLnN0YXJ0KHtjb25uZWN0aW9uc30pXG4gICAgfVxuXG4gICAgY29uc3QgcHJldmlvdXNFbnZpcm9ubWVudCA9IHByb2Nlc3MuZW52W1NIQVJFRF9UUkFOU0FDVElPTl9CUk9LRVJfRU5WXVxuICAgIHByb2Nlc3MuZW52W1NIQVJFRF9UUkFOU0FDVElPTl9CUk9LRVJfRU5WXSA9IEJ1ZmZlci5mcm9tKEpTT04uc3RyaW5naWZ5KHtcbiAgICAgIGFkZHJlc3M6IGJyb2tlci5hZGRyZXNzKCksXG4gICAgICBjYXBhYmlsaXR5OiBicm9rZXIuY2FwYWJpbGl0eSgpLFxuICAgICAgZGF0YWJhc2VJZGVudGlmaWVycyxcbiAgICAgIGV4cGVjdGVkOiB0cnVlXG4gICAgfSkpLnRvU3RyaW5nKFwiYmFzZTY0dXJsXCIpXG5cbiAgICByZXR1cm4ge2Jyb2tlciwgZW52aXJvbm1lbnRQdWJsaXNoZWQ6IHRydWUsIHByZXZpb3VzRW52aXJvbm1lbnR9XG4gIH1cblxuICAvKipcbiAgICogUmV2b2tlcyBhbiBhdHRlbXB0IGJyb2tlciBiZWZvcmUgZGF0YWJhc2Ugcm9sbGJhY2sgaG9va3MgcnVuIGFuZCByZXN0b3Jlc1xuICAgKiB0aGUgY2FsbGVyJ3MgZW52aXJvbm1lbnQgc28gbGF0ZXIgcG9vbGVkL3NwYXduZWQgY2hpbGRyZW4gY2Fubm90IGluaGVyaXQgaXQuXG4gICAqIEBwYXJhbSB7U2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJSZWdpc3RyYXRpb24gfCB1bmRlZmluZWR9IHJlZ2lzdHJhdGlvbiAtIEF0dGVtcHQgcmVnaXN0cmF0aW9uLlxuICAgKi9cbiAgYXN5bmMgc3RvcFNoYXJlZFRyYW5zYWN0aW9uQnJva2VyKHJlZ2lzdHJhdGlvbikge1xuICAgIGlmICghcmVnaXN0cmF0aW9uKSByZXR1cm5cblxuICAgIGlmIChyZWdpc3RyYXRpb24uZW52aXJvbm1lbnRQdWJsaXNoZWQpIHtcbiAgICAgIGlmIChyZWdpc3RyYXRpb24ucHJldmlvdXNFbnZpcm9ubWVudCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGRlbGV0ZSBwcm9jZXNzLmVudltTSEFSRURfVFJBTlNBQ1RJT05fQlJPS0VSX0VOVl1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHByb2Nlc3MuZW52W1NIQVJFRF9UUkFOU0FDVElPTl9CUk9LRVJfRU5WXSA9IHJlZ2lzdHJhdGlvbi5wcmV2aW91c0Vudmlyb25tZW50XG4gICAgICB9XG4gICAgfVxuICAgIGF3YWl0IHJlZ2lzdHJhdGlvbi5icm9rZXIuY2xvc2UoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVxdWVzdCBjbGllbnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJlcXVlc3RDbGllbnQ+fSAtIFJlc29sdmVzIHdpdGggdGhlIHJlcXVlc3QgY2xpZW50LlxuICAgKi9cbiAgYXN5bmMgcmVxdWVzdENsaWVudCgpIHtcbiAgICBpZiAoIXRoaXMuX3JlcXVlc3RDbGllbnQpIHtcbiAgICAgIHRoaXMuX3JlcXVlc3RDbGllbnQgPSBuZXcgUmVxdWVzdENsaWVudCgpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX3JlcXVlc3RDbGllbnRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGltcG9ydCB0ZXN0IGZpbGVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgaW1wb3J0VGVzdEZpbGVzKCkge1xuICAgIGNvbnN0IGVudmlyb25tZW50SGFuZGxlciA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldEVudmlyb25tZW50SGFuZGxlcigpXG5cbiAgICBpZiAoIXRoaXMuX3Byb2ZpbGVyKSB7XG4gICAgICBhd2FpdCBlbnZpcm9ubWVudEhhbmRsZXIuaW1wb3J0VGVzdEZpbGVzKHRoaXMuZ2V0VGVzdEZpbGVzKCkpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IHRlc3RGaWxlIG9mIHRoaXMuZ2V0VGVzdEZpbGVzKCkpIHtcbiAgICAgIGNvbnN0IGV4aXN0aW5nUmVnaXN0cmF0aW9ucyA9IHRoaXMudGVzdFJlZ2lzdHJhdGlvbk9iamVjdHMoKVxuXG4gICAgICBhd2FpdCB0aGlzLl9wcm9maWxlci5tZWFzdXJlUGhhc2UoXCJpbXBvcnRzXCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgZW52aXJvbm1lbnRIYW5kbGVyLmltcG9ydFRlc3RGaWxlcyhbdGVzdEZpbGVdKVxuICAgICAgfSwge2ZpbGVQYXRoOiB0ZXN0RmlsZX0pXG4gICAgICB0aGlzLmFzc2lnblRlc3RSZWdpc3RyYXRpb25Pd25lcnNoaXAoZXhpc3RpbmdSZWdpc3RyYXRpb25zLCB0ZXN0RmlsZSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ29sbGVjdHMgcGFja2FnZSBkZWNsYXJhdGlvbiBvYmplY3RzIGJ5IGlkZW50aXR5LlxuICAgKiBAcGFyYW0ge1NldDxQYWNrYWdlUmVnaXN0cmF0aW9uPn0gW3JlZ2lzdHJhdGlvbnNdIC0gQWNjdW11bGF0ZWQgaWRlbnRpdGllcy5cbiAgICogQHJldHVybnMge1NldDxQYWNrYWdlUmVnaXN0cmF0aW9uPn0gLSBSZWdpc3RyYXRpb24gaWRlbnRpdGllcy5cbiAgICovXG4gIHRlc3RSZWdpc3RyYXRpb25PYmplY3RzKHJlZ2lzdHJhdGlvbnMgPSBuZXcgU2V0KCkpIHtcbiAgICBjb25zdCB2aXNpdCA9ICgvKiogQHR5cGUge1BhY2thZ2VTdWl0ZURlY2xhcmF0aW9ufSAqLyBzdWl0ZSkgPT4ge1xuICAgICAgcmVnaXN0cmF0aW9ucy5hZGQoc3VpdGUpXG4gICAgICBmb3IgKGNvbnN0IGhvb2sgb2YgWy4uLnN1aXRlLmhvb2tzLmJlZm9yZUFsbCwgLi4uc3VpdGUuaG9va3MuYmVmb3JlRWFjaCwgLi4uc3VpdGUuaG9va3MuYWZ0ZXJFYWNoLCAuLi5zdWl0ZS5ob29rcy5hZnRlckFsbF0pIHtcbiAgICAgICAgcmVnaXN0cmF0aW9ucy5hZGQoaG9vaylcbiAgICAgIH1cbiAgICAgIGZvciAoY29uc3QgdGVzdERlY2xhcmF0aW9uIG9mIHN1aXRlLnRlc3RzKSByZWdpc3RyYXRpb25zLmFkZCh0ZXN0RGVjbGFyYXRpb24pXG4gICAgICBmb3IgKGNvbnN0IGNoaWxkU3VpdGUgb2Ygc3VpdGUuc3VpdGVzKSB2aXNpdChjaGlsZFN1aXRlKVxuICAgIH1cblxuICAgIGZvciAoY29uc3Qgc3VpdGUgb2YgdGhpcy5nZXRUZXN0Q29udGV4dCgpLnJlZ2lzdHJ5LnN1aXRlcykgdmlzaXQoc3VpdGUpXG5cbiAgICByZXR1cm4gcmVnaXN0cmF0aW9uc1xuICB9XG5cbiAgLyoqXG4gICAqIEFzc2lnbnMgZGV0ZXJtaW5pc3RpYyBvd25lcnNoaXAgdG8gcGFja2FnZSBkZWNsYXJhdGlvbnMgYWRkZWQgYnkgb25lIGVudHJ5IGZpbGUuXG4gICAqIEBwYXJhbSB7U2V0PFBhY2thZ2VSZWdpc3RyYXRpb24+fSBwcmV2aW91c1JlZ2lzdHJhdGlvbnMgLSBJZGVudGl0aWVzIHByZXNlbnQgYmVmb3JlIGltcG9ydC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG93bmVyRmlsZVBhdGggLSBJbXBvcnRpbmcgZW50cnkgZmlsZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBhc3NpZ25UZXN0UmVnaXN0cmF0aW9uT3duZXJzaGlwKHByZXZpb3VzUmVnaXN0cmF0aW9ucywgb3duZXJGaWxlUGF0aCkge1xuICAgIGZvciAoY29uc3QgcmVnaXN0cmF0aW9uIG9mIHRoaXMudGVzdFJlZ2lzdHJhdGlvbk9iamVjdHMoKSkge1xuICAgICAgaWYgKCFwcmV2aW91c1JlZ2lzdHJhdGlvbnMuaGFzKHJlZ2lzdHJhdGlvbikpIHRoaXMuX2RlY2xhcmF0aW9uT3duZXJzLnNldChyZWdpc3RyYXRpb24sIG93bmVyRmlsZVBhdGgpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaXMgZmFpbGVkLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGZhaWxlZC5cbiAgICovXG4gIGlzRmFpbGVkKCkgeyByZXR1cm4gdGhpcy5fZmFpbGVkVGVzdHMgIT09IHVuZGVmaW5lZCAmJiAodGhpcy5fZmFpbGVkVGVzdHMgPiAwIHx8IHRoaXMuX3BhY2thZ2VSZXN1bHQ/LnN0YXR1cyA9PT0gXCJmYWlsZWRcIikgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBmYWlsZWQgdGVzdHMuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gVGhlIGZhaWxlZCB0ZXN0cy5cbiAgICovXG4gIGdldEZhaWxlZFRlc3RzKCkge1xuICAgIGlmICh0aGlzLl9mYWlsZWRUZXN0cyA9PT0gdW5kZWZpbmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJUZXN0cyBoYXNuJ3QgYmVlbiBydW4geWV0XCIpXG5cbiAgICByZXR1cm4gdGhpcy5fZmFpbGVkVGVzdHNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBmYWlsZWQgdGVzdCBkZXRhaWxzLlxuICAgKiBAcmV0dXJucyB7RmFpbGVkVGVzdERldGFpbFtdfSAtIEZhaWxlZCB0ZXN0IGRldGFpbHMuXG4gICAqL1xuICBnZXRGYWlsZWRUZXN0RGV0YWlscygpIHtcbiAgICByZXR1cm4gdGhpcy5fZmFpbGVkVGVzdERldGFpbHNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHBlcnNpc3QgZmFpbGVkIHRlc3QgY29uc29sZSBvdXRwdXRzIHRvIGFzc2V0cy5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuYXNzZXRzUGF0aF0gLSBBc3NldHMgZGlyZWN0b3J5IHBhdGguXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZ1tdPn0gLSBXcml0dGVuIGxvZyBmaWxlIHBhdGhzLlxuICAgKi9cbiAgYXN5bmMgcGVyc2lzdEZhaWxlZFRlc3RDb25zb2xlT3V0cHV0c1RvQXNzZXRzKHthc3NldHNQYXRoID0gcGF0aC5qb2luKHByb2Nlc3MuY3dkKCksIFwidG1wL3NjcmVlbnNob3RzXCIpfSA9IHt9KSB7XG4gICAgY29uc3QgZmFpbGVkVGVzdERldGFpbHMgPSB0aGlzLmdldEZhaWxlZFRlc3REZXRhaWxzKClcbiAgICBjb25zdCB3cml0dGVuTG9nUGF0aHMgPSBbXVxuICAgIGxldCBjcmVhdGVkRGlyZWN0b3J5ID0gZmFsc2VcblxuICAgIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBmYWlsZWRUZXN0RGV0YWlscy5sZW5ndGg7IGluZGV4KyspIHtcbiAgICAgIGNvbnN0IGZhaWxlZFRlc3REZXRhaWwgPSBmYWlsZWRUZXN0RGV0YWlsc1tpbmRleF1cbiAgICAgIGNvbnN0IGNvbnNvbGVPdXRwdXQgPSBmYWlsZWRUZXN0RGV0YWlsLmNvbnNvbGVPdXRwdXRcblxuICAgICAgaWYgKCFjb25zb2xlT3V0cHV0KSBjb250aW51ZVxuXG4gICAgICBpZiAoIWNyZWF0ZWREaXJlY3RvcnkpIHtcbiAgICAgICAgYXdhaXQgZnMubWtkaXIoYXNzZXRzUGF0aCwge3JlY3Vyc2l2ZTogdHJ1ZX0pXG4gICAgICAgIGNyZWF0ZWREaXJlY3RvcnkgPSB0cnVlXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKClcbiAgICAgIGNvbnN0IHRpbWVzdGFtcCA9IFtcbiAgICAgICAgU3RyaW5nKG5vdy5nZXRGdWxsWWVhcigpKSxcbiAgICAgICAgU3RyaW5nKG5vdy5nZXRNb250aCgpICsgMSkucGFkU3RhcnQoMiwgXCIwXCIpLFxuICAgICAgICBTdHJpbmcobm93LmdldERhdGUoKSkucGFkU3RhcnQoMiwgXCIwXCIpLFxuICAgICAgICBTdHJpbmcobm93LmdldEhvdXJzKCkpLnBhZFN0YXJ0KDIsIFwiMFwiKSxcbiAgICAgICAgU3RyaW5nKG5vdy5nZXRNaW51dGVzKCkpLnBhZFN0YXJ0KDIsIFwiMFwiKSxcbiAgICAgICAgU3RyaW5nKG5vdy5nZXRTZWNvbmRzKCkpLnBhZFN0YXJ0KDIsIFwiMFwiKSxcbiAgICAgICAgU3RyaW5nKG5vdy5nZXRNaWxsaXNlY29uZHMoKSkucGFkU3RhcnQoMywgXCIwXCIpXG4gICAgICBdLmpvaW4oXCJcIilcbiAgICAgIGNvbnN0IHNsdWcgPSB0b0ZpbGVTbHVnKGZhaWxlZFRlc3REZXRhaWwuZnVsbERlc2NyaXB0aW9uKVxuICAgICAgY29uc3QgZmlsZU5hbWUgPSBgJHt0aW1lc3RhbXB9LSR7U3RyaW5nKGluZGV4ICsgMSkucGFkU3RhcnQoMiwgXCIwXCIpfS0ke3NsdWd9LmNvbnNvbGUubG9nYFxuICAgICAgY29uc3QgZmlsZVBhdGggPSBwYXRoLmpvaW4oYXNzZXRzUGF0aCwgZmlsZU5hbWUpXG5cbiAgICAgIGF3YWl0IGZzLndyaXRlRmlsZShmaWxlUGF0aCwgY29uc29sZU91dHB1dCwgXCJ1dGY4XCIpXG4gICAgICBmYWlsZWRUZXN0RGV0YWlsLmNvbnNvbGVMb2dQYXRoID0gZmlsZVBhdGhcbiAgICAgIHdyaXR0ZW5Mb2dQYXRocy5wdXNoKGZpbGVQYXRoKVxuICAgIH1cblxuICAgIHJldHVybiB3cml0dGVuTG9nUGF0aHNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBzdWNjZXNzZnVsIHRlc3RzLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIFRoZSBzdWNjZXNzZnVsIHRlc3RzLlxuICAgKi9cbiAgZ2V0U3VjY2Vzc2Z1bFRlc3RzKCkge1xuICAgIGlmICh0aGlzLl9zdWNjZXNzZnVsVGVzdHMgPT09IHVuZGVmaW5lZCkgdGhyb3cgbmV3IEVycm9yKFwiVGVzdHMgaGFzbid0IGJlZW4gcnVuIHlldFwiKVxuXG4gICAgcmV0dXJuIHRoaXMuX3N1Y2Nlc3NmdWxUZXN0c1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRlc3RzIGNvdW50LlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIFRoZSB0ZXN0cyBjb3VudC5cbiAgICovXG4gIGdldFRlc3RzQ291bnQoKSB7XG4gICAgaWYgKHRoaXMuX3Rlc3RzQ291bnQgPT09IHVuZGVmaW5lZCkgdGhyb3cgbmV3IEVycm9yKFwiVGVzdHMgaGFzbid0IGJlZW4gcnVuIHlldFwiKVxuXG4gICAgcmV0dXJuIHRoaXMuX3Rlc3RzQ291bnRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBleGVjdXRlZCB0ZXN0cyBjb3VudC5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBUaGUgZXhlY3V0ZWQgdGVzdHMgY291bnQuXG4gICAqL1xuICBnZXRFeGVjdXRlZFRlc3RzQ291bnQoKSB7XG4gICAgcmV0dXJuIHRoaXMuX3BhY2thZ2VSZXN1bHQ/LnRlc3RzLmxlbmd0aCA/PyB0aGlzLl90ZXN0RHVyYXRpb25zLmxlbmd0aFxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIHRlc3RzIHJlY29yZGVkIGR1cmluZyB0aGUgcnVuLCBzbG93ZXN0IGZpcnN0LlxuICAgKiBAcGFyYW0ge251bWJlcn0gW2xpbWl0XSAtIE1heGltdW0gbnVtYmVyIG9mIHRlc3RzIHRvIHJldHVybiAoMCByZXR1cm5zIGFsbCkuXG4gICAqIEByZXR1cm5zIHtBcnJheTx7ZnVsbERlc2NyaXB0aW9uOiBzdHJpbmcsIGZpbGVQYXRoOiBzdHJpbmcsIGxpbmU6IG51bWJlciwgZHVyYXRpb25NczogbnVtYmVyfT59IC0gU2xvd2VzdCB0ZXN0cywgc2xvd2VzdCBmaXJzdC5cbiAgICovXG4gIGdldFNsb3dlc3RUZXN0cyhsaW1pdCA9IDEwKSB7XG4gICAgY29uc3Qgc29ydGVkID0gWy4uLnRoaXMuX3Rlc3REdXJhdGlvbnNdLnNvcnQoKHRlc3RBLCB0ZXN0QikgPT4gdGVzdEIuZHVyYXRpb25NcyAtIHRlc3RBLmR1cmF0aW9uTXMpXG5cbiAgICByZXR1cm4gbGltaXQgPiAwID8gc29ydGVkLnNsaWNlKDAsIGxpbWl0KSA6IHNvcnRlZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcHJlcGFyZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHByZXBhcmUoKSB7XG4gICAgdGhpcy5hbnlUZXN0c0ZvY3Vzc2VkID0gZmFsc2VcbiAgICB0aGlzLl9mYWlsZWRUZXN0cyA9IDBcbiAgICB0aGlzLl9zdWNjZXNzZnVsVGVzdHMgPSAwXG4gICAgdGhpcy5fdGVzdHNDb3VudCA9IDBcbiAgICB0aGlzLl9hYm9ydFJlbWFpbmluZ1Rlc3RzID0gZmFsc2VcbiAgICB0aGlzLl9mYWlsZWRUZXN0RGV0YWlscyA9IFtdXG4gICAgdGhpcy5fdGVzdER1cmF0aW9ucyA9IFtdXG4gICAgdGhpcy5fdGVzdENvbXBhdGliaWxpdHkgPSBuZXcgV2Vha01hcCgpXG4gICAgdGhpcy5faW5qZWN0ZWRUZXN0cyA9IG5ldyBXZWFrU2V0KClcbiAgICB0aGlzLl9jb21wbGV0ZWRUZXN0cyA9IG5ldyBXZWFrU2V0KClcbiAgICB0aGlzLl90ZXN0TWV0YWRhdGEgPSBuZXcgV2Vha01hcCgpXG4gICAgdGhpcy5faG9va01ldGFkYXRhID0gbmV3IFdlYWtNYXAoKVxuICAgIHRoaXMuX2F0dGVtcHRPdXRjb21lcyA9IG5ldyBXZWFrTWFwKClcbiAgICB0aGlzLl9zdWl0ZUhvb2tGYWlsdXJlcyA9IFtdXG4gICAgdGhpcy5fdGVzdHNCeUZ1bGxOYW1lID0gbmV3IE1hcCgpXG4gICAgdGhpcy5fcGFja2FnZVJlc3VsdCA9IHVuZGVmaW5lZFxuICAgIGNvbnN0IGNvbnRleHQgPSB0aGlzLmdldFRlc3RDb250ZXh0KClcbiAgICAvKiogQHR5cGUge3N0cmluZyB8IHVuZGVmaW5lZH0gKi9cbiAgICBsZXQgb3duZXJGaWxlUGF0aFxuXG4gICAgY29udGV4dC5yZXNldCh7Y29uZmlnOiB0cnVlfSlcbiAgICBjb250ZXh0LnNldERlY2xhcmF0aW9uTG9jYXRvcigoKSA9PiB0aGlzLmNhcHR1cmVUZXN0RGVjbGFyYXRpb25Mb2NhdGlvbihvd25lckZpbGVQYXRoKSlcbiAgICBjb25zdCB0ZXN0aW5nQ29uZmlnUGF0aCA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldFRlc3RpbmcoKVxuXG4gICAgYXdhaXQgY29udGV4dC5kZXNjcmliZShcIlwiLCB7ZGF0YWJhc2VDbGVhbmluZzoge3RyYW5zYWN0aW9uOiB0cnVlfX0sIGFzeW5jICgpID0+IHtcbiAgICAgIGlmICh0ZXN0aW5nQ29uZmlnUGF0aCkge1xuICAgICAgICBhd2FpdCB0aGlzLnJ1blByb2ZpbGVTcGFuKHtwaGFzZTogXCJ0ZXN0aW5nIGNvbmZpZy9nbG9iYWwgc2V0dXBcIn0sIGFzeW5jICgpID0+IHtcbiAgICAgICAgICBhd2FpdCB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5pbXBvcnRUZXN0aW5nQ29uZmlnUGF0aCgpXG4gICAgICAgIH0pXG4gICAgICB9XG5cbiAgICAgIGlmICghdGhpcy5fcHJvZmlsZXIpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5pbXBvcnRUZXN0RmlsZXMoKVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZm9yIChjb25zdCB0ZXN0RmlsZSBvZiB0aGlzLmdldFRlc3RGaWxlcygpKSB7XG4gICAgICAgICAgb3duZXJGaWxlUGF0aCA9IHRlc3RGaWxlXG4gICAgICAgICAgY29uc3QgZXhpc3RpbmdSZWdpc3RyYXRpb25zID0gdGhpcy50ZXN0UmVnaXN0cmF0aW9uT2JqZWN0cygpXG5cbiAgICAgICAgICBhd2FpdCB0aGlzLl9wcm9maWxlci5tZWFzdXJlUGhhc2UoXCJpbXBvcnRzXCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldEVudmlyb25tZW50SGFuZGxlcigpLmltcG9ydFRlc3RGaWxlcyhbdGVzdEZpbGVdKVxuICAgICAgICAgIH0sIHtmaWxlUGF0aDogdGVzdEZpbGV9KVxuICAgICAgICAgIHRoaXMuYXNzaWduVGVzdFJlZ2lzdHJhdGlvbk93bmVyc2hpcChleGlzdGluZ1JlZ2lzdHJhdGlvbnMsIHRlc3RGaWxlKVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfSlcbiAgICBvd25lckZpbGVQYXRoID0gdW5kZWZpbmVkXG4gICAgdGhpcy5hbmFseXplRGVjbGFyYXRpb25zKClcbiAgfVxuXG4gIC8qKlxuICAgKiBDYXB0dXJlcyBhIHRlc3Qgc291cmNlIGxvY2F0aW9uIHdpdGhvdXQgYXR0cmlidXRpbmcgcGFja2FnZS9mYWNhZGUgZnJhbWVzLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IHVuZGVmaW5lZH0gb3duZXJGaWxlUGF0aCAtIEltcG9ydGluZyBlbnRyeSBmaWxlIGZhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7e2ZpbGVQYXRoPzogc3RyaW5nLCBsaW5lPzogbnVtYmVyfX0gLSBEZWNsYXJhdGlvbiBsb2NhdGlvbi5cbiAgICovXG4gIGNhcHR1cmVUZXN0RGVjbGFyYXRpb25Mb2NhdGlvbihvd25lckZpbGVQYXRoKSB7XG4gICAgY29uc3Qgc3RhY2sgPSBuZXcgRXJyb3IoKS5zdGFjaz8uc3BsaXQoXCJcXG5cIikgfHwgW11cblxuICAgIGZvciAoY29uc3Qgc3RhY2tMaW5lIG9mIHN0YWNrKSB7XG4gICAgICBjb25zdCBtYXRjaCA9IHN0YWNrTGluZS5tYXRjaCgvKD86XFwofFxccykoZmlsZTpcXC9cXC8uKj98XFwvW15cIl0qPyk6KFxcZCspOihcXGQrKVxcKT8kL3UpXG4gICAgICBpZiAoIW1hdGNoKSBjb250aW51ZVxuXG4gICAgICBsZXQgZmlsZVBhdGggPSBtYXRjaFsxXVxuICAgICAgaWYgKGZpbGVQYXRoLnN0YXJ0c1dpdGgoXCJmaWxlOi8vXCIpKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgZmlsZVBhdGggPSBmaWxlVVJMVG9QYXRoKGZpbGVQYXRoKVxuICAgICAgICB9IGNhdGNoIHtcbiAgICAgICAgICBjb250aW51ZVxuICAgICAgICB9XG4gICAgICB9XG4gICAgICBjb25zdCByZXNvbHZlZEZpbGVQYXRoID0gcGF0aC5yZXNvbHZlKGZpbGVQYXRoKVxuICAgICAgY29uc3QgcG9ydGFibGVQYXRoID0gcmVzb2x2ZWRGaWxlUGF0aC5yZXBsYWNlQWxsKHBhdGguc2VwLCBcIi9cIilcblxuICAgICAgaWYgKHBvcnRhYmxlUGF0aC5lbmRzV2l0aChcIi9zcmMvdGVzdGluZy90ZXN0LXJ1bm5lci5qc1wiKSkgY29udGludWVcbiAgICAgIGlmIChwb3J0YWJsZVBhdGguZW5kc1dpdGgoXCIvc3JjL3Rlc3RpbmcvdGVzdC5qc1wiKSkgY29udGludWVcbiAgICAgIGlmIChwb3J0YWJsZVBhdGguaW5jbHVkZXMoXCIvbm9kZV9tb2R1bGVzL0B2ZWxvY2lvdXMvdGVzdGluZy9cIikpIGNvbnRpbnVlXG5cbiAgICAgIHJldHVybiB7ZmlsZVBhdGg6IHJlc29sdmVkRmlsZVBhdGgsIGxpbmU6IE51bWJlcihtYXRjaFsyXSl9XG4gICAgfVxuXG4gICAgcmV0dXJuIG93bmVyRmlsZVBhdGggPyB7ZmlsZVBhdGg6IG93bmVyRmlsZVBhdGh9IDoge31cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFyZSBhbnkgdGVzdHMgZm9jdXNzZWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgYW55IHRlc3RzIGZvY3Vzc2VkLlxuICAgKi9cbiAgYXJlQW55VGVzdHNGb2N1c3NlZCgpIHtcbiAgICBpZiAodGhpcy5hbnlUZXN0c0ZvY3Vzc2VkID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkhhc24ndCBiZWVuIGRldGVjdGVkIHlldFwiKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLmFueVRlc3RzRm9jdXNzZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1bi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIC8qKlxuICAgKiBSZWNvcmRzIGFuIGFzeW5jaHJvbm91cyBjcmFzaCAoYW4gdW5oYW5kbGVkIHByb21pc2UgcmVqZWN0aW9uIGRldGFjaGVkIGZyb21cbiAgICogYW55IGF3YWl0LCBlLmcuIGEgYHZvaWQgY29ubmVjdGlvbi5hZnRlckNvbW1pdChhc3luYyAoKSA9PiBicm9hZGNhc3QoLi4uKSlgXG4gICAqIGZyb250ZW5kLW1vZGVsIHB1Ymxpc2gg4oCUIG9yIGEgc3luY2hyb25vdXMgdGhyb3cgaW5zaWRlIGEgZGV0YWNoZWQgY2FsbGJhY2tcbiAgICogc3VjaCBhcyBhIGRyaXZlciBzb2NrZXQgb3IgdGltZXIgY2FsbGJhY2spIGFzIGEgcmVhbCwgdmlzaWJsZSwgYXR0cmlidXRlZFxuICAgKiB0ZXN0IGZhaWx1cmUuXG4gICAqXG4gICAqIFdpdGhvdXQgdGhpcywgc3VjaCBhIHJlamVjdGlvbi9leGNlcHRpb24gaGFzIG5vIGhhbmRsZXIsIHNvIG9uIG1vZGVybiBOb2RlXG4gICAqIHRoZSBwcm9jZXNzIGlzIFRFUk1JTkFURUQg4oCUIHRoZSBydW4gZW5kcyB3aXRoIG5vIHJlcG9ydGVkIGZhaWx1cmVzIGFuZCBDSVxuICAgKiBqdXN0IHNlZXMgYSBjcmFzaGVkL3JldHJpZWQgc2hhcmQgd2l0aCBhbiBlbXB0eSByZXN1bHQgKHRoZSByZWN1cnJpbmdcbiAgICogXCJzaWxlbnQgdGVzdC1ydW5uZXIgZGVhdGhcIjogaW52aXNpYmxlIGFuZCBpbXBvc3NpYmxlIHRvIGRpYWdub3NlKS4gVHVybmluZ1xuICAgKiBpdCBpbnRvIGEgZmFpbHVyZSBtYWtlcyB0aGUgcnVuIGdvIHJlZCB3aXRoIHNvbWV0aGluZyBkZWJ1Z2dhYmxlIGluc3RlYWQgb2ZcbiAgICogdmFuaXNoaW5nLlxuICAgKiBAcGFyYW0ge1widW5jYXVnaHRFeGNlcHRpb25cIiB8IFwidW5oYW5kbGVkUmVqZWN0aW9uXCJ9IGtpbmQgLSBBc3luYy1jcmFzaCBraW5kLlxuICAgKiBAcGFyYW0ge3Vua25vd259IHJlYXNvbiAtIFJlamVjdGlvbiByZWFzb24gb3IgdGhyb3duIGVycm9yLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHJlY29yZEFzeW5jQ3Jhc2goa2luZCwgcmVhc29uKSB7XG4gICAgY29uc3QgZXJyb3IgPSByZWFzb24gaW5zdGFuY2VvZiBFcnJvciA/IHJlYXNvbiA6IG5ldyBFcnJvcihgJHtraW5kfTogJHtTdHJpbmcocmVhc29uKX1gKVxuICAgIGNvbnN0IG5lYXIgPSB0aGlzLl9sYXN0VGVzdENvbnRleHRcbiAgICBjb25zdCBhdHRyaWJ1dGlvbiA9IG5lYXIgPyBgLCBuZWFyIHRlc3Q6ICR7bmVhci5mdWxsRGVzY3JpcHRpb259ICgke25lYXIuZmlsZVBhdGh9OiR7bmVhci5saW5lfSlgIDogXCJcIlxuXG4gICAgdGhpcy5fZmFpbGVkVGVzdHMgPSAodGhpcy5fZmFpbGVkVGVzdHMgfHwgMCkgKyAxXG4gICAgdGhpcy5fZmFpbGVkVGVzdERldGFpbHMucHVzaCh7XG4gICAgICBmdWxsRGVzY3JpcHRpb246IGA8JHtraW5kfSBkdXJpbmcgdGVzdCBydW4ke2F0dHJpYnV0aW9ufT5gLFxuICAgICAgZmlsZVBhdGg6IG5lYXIgPyBuZWFyLmZpbGVQYXRoIDogXCI8dGVzdCBydW5uZXI+XCIsXG4gICAgICBsaW5lOiBuZWFyID8gbmVhci5saW5lIDogMCxcbiAgICAgIGVycm9yLFxuICAgICAgY29uc29sZU91dHB1dDogdW5kZWZpbmVkXG4gICAgfSlcblxuICAgIGNvbnNvbGUuZXJyb3IocGljb2NvbG9ycy5yZWQoYFxcblt0ZXN0LXJ1bm5lcl0gJHtraW5kfSBkdXJpbmcgdGhlIHRlc3QgcnVuIOKAlCB0aGlzIHdvdWxkIG90aGVyd2lzZSB0ZXJtaW5hdGUgdGhlIHByb2Nlc3Mgc2lsZW50bHkgYW5kIHN1cmZhY2Ugb25seSBhcyBhIGNyYXNoZWQvcmV0cmllZCBzaGFyZCB3aXRoIHplcm8gcmVwb3J0ZWQgZmFpbHVyZXMuJHthdHRyaWJ1dGlvbn1gKSlcbiAgICBjb25zb2xlLmVycm9yKGVycm9yKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgYSBjbGVhbnVwIGZhaWx1cmUgYWZ0ZXIgdGltZW91dCBoYW5kbGluZyBoYXMgYmVndW4uXG4gICAqIEBwYXJhbSB7dW5rbm93bn0gcmVhc29uIC0gRGV0YWNoZWQgY2xlYW51cCByZWplY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjbGVhbnVwTmFtZSAtIENsZWFudXAgb3BlcmF0aW9uIG5hbWUuXG4gICAqIEBwYXJhbSB7U2V0PEVycm9yPn0gW3JlY29yZGVkRXJyb3JzXSAtIEF0dGVtcHQtb3duZWQgY2xlYW51cCBlcnJvcnMgYWxyZWFkeSByZXBvcnRlZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICByZWNvcmRUaW1lb3V0Q2xlYW51cEZhaWx1cmUocmVhc29uLCBjbGVhbnVwTmFtZSwgcmVjb3JkZWRFcnJvcnMpIHtcbiAgICBjb25zdCBlcnJvciA9IHJlYXNvbiBpbnN0YW5jZW9mIEVycm9yID8gcmVhc29uIDogbmV3IEVycm9yKGAke2NsZWFudXBOYW1lfSBjbGVhbnVwIGZhaWxlZDogJHtTdHJpbmcocmVhc29uKX1gKVxuXG4gICAgaWYgKHJlY29yZGVkRXJyb3JzKSB7XG4gICAgICAvLyBNdWx0aXBsZSBib3VuZGVkIG9ic2VydmVycyBjYW4gcmVjZWl2ZSB0aGUgc2FtZSBkZXRhY2hlZCBjbGVhbnVwIHJlamVjdGlvbi5cbiAgICAgIGlmIChyZWNvcmRlZEVycm9ycy5oYXMoZXJyb3IpKSByZXR1cm5cbiAgICAgIHJlY29yZGVkRXJyb3JzLmFkZChlcnJvcilcbiAgICB9XG5cbiAgICBjb25zdCBuZWFyID0gdGhpcy5fbGFzdFRlc3RDb250ZXh0XG4gICAgY29uc3QgYXR0cmlidXRpb24gPSBuZWFyID8gYCwgbmVhciB0ZXN0OiAke25lYXIuZnVsbERlc2NyaXB0aW9ufSAoJHtuZWFyLmZpbGVQYXRofToke25lYXIubGluZX0pYCA6IFwiXCJcblxuICAgIHRoaXMuX2ZhaWxlZFRlc3RzID0gKHRoaXMuX2ZhaWxlZFRlc3RzIHx8IDApICsgMVxuICAgIHRoaXMuX2ZhaWxlZFRlc3REZXRhaWxzLnB1c2goe1xuICAgICAgZnVsbERlc2NyaXB0aW9uOiBgPCR7Y2xlYW51cE5hbWV9IGVtZXJnZW5jeSBjbGVhbnVwIGZhaWx1cmUke2F0dHJpYnV0aW9ufT5gLFxuICAgICAgZmlsZVBhdGg6IG5lYXIgPyBuZWFyLmZpbGVQYXRoIDogXCI8dGVzdCBydW5uZXI+XCIsXG4gICAgICBsaW5lOiBuZWFyID8gbmVhci5saW5lIDogMCxcbiAgICAgIGVycm9yLFxuICAgICAgY29uc29sZU91dHB1dDogdW5kZWZpbmVkXG4gICAgfSlcblxuICAgIGNvbnNvbGUuZXJyb3IocGljb2NvbG9ycy5yZWQoYFxcblt0ZXN0LXJ1bm5lcl0gJHtjbGVhbnVwTmFtZX0gY2xlYW51cCBmYWlsZWQgYWZ0ZXIgdGltZW91dCBoYW5kbGluZyBiZWdhbi4ke2F0dHJpYnV0aW9ufWApKVxuICAgIGNvbnNvbGUuZXJyb3IoZXJyb3IpXG4gIH1cblxuICBhc3luYyBydW4oKSB7XG4gICAgLyoqXG4gICAgICogSGFuZGxlcyBhIHByb2Nlc3MtbGV2ZWwgdW5oYW5kbGVkIHJlamVjdGlvbiBkdXJpbmcgdGhlIHJ1bi5cbiAgICAgKiBAcGFyYW0ge3Vua25vd259IHJlYXNvbiAtIFJlamVjdGlvbiByZWFzb24uXG4gICAgICogQHJldHVybnMge3ZvaWR9XG4gICAgICovXG4gICAgY29uc3Qgb25VbmhhbmRsZWRSZWplY3Rpb24gPSAocmVhc29uKSA9PiB7XG4gICAgICAvLyBJZiBhIHRlc3QgYXR0YWNoZWQgaXRzIE9XTiB1bmhhbmRsZWRSZWplY3Rpb24gbGlzdGVuZXIsIGl0IGlzXG4gICAgICAvLyBpbnRlbnRpb25hbGx5IG9ic2VydmluZy90cmlnZ2VyaW5nIHRoZSByZWplY3Rpb24gKGUuZy4gYmVhY29uXG4gICAgICAvLyBlcnJvci1yZXBvcnRpbmctc3BlYy5qcykg4oCUIE5vZGUgZGlzcGF0Y2hlcyB0byBFVkVSWSBsaXN0ZW5lciwgc28gYWxzb1xuICAgICAgLy8gZmFpbGluZyB0aGUgc3VpdGUgaGVyZSB3b3VsZCBicmVhayB0aG9zZSB0ZXN0cy4gRGVmZXIgdG8gdGhlIHRlc3Qnc1xuICAgICAgLy8gaGFuZGxlcjsgb25seSB0cmVhdCBhIHJlamVjdGlvbiBhcyBhIHNpbGVudC1kZWF0aCBjcmFzaCB3aGVuIG91cnMgaXMgdGhlXG4gICAgICAvLyBzb2xlIGxpc3RlbmVyIChubyBwZXJzaXN0ZW50IGZyYW1ld29yayBsaXN0ZW5lciBleGlzdHMgdG8gbWFzayB0aGlzKS5cbiAgICAgIGlmIChwcm9jZXNzLmxpc3RlbmVyQ291bnQoXCJ1bmhhbmRsZWRSZWplY3Rpb25cIikgPiAxKSByZXR1cm5cblxuICAgICAgdGhpcy5yZWNvcmRBc3luY0NyYXNoKFwidW5oYW5kbGVkUmVqZWN0aW9uXCIsIHJlYXNvbilcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBIYW5kbGVzIGEgcHJvY2Vzcy1sZXZlbCB1bmNhdWdodCBleGNlcHRpb24gZHVyaW5nIHRoZSBydW4g4oCUIGFcbiAgICAgKiBzeW5jaHJvbm91cyB0aHJvdyBpbnNpZGUgYSBkZXRhY2hlZCBjYWxsYmFjayAoZHJpdmVyIHNvY2tldCwgdGltZXIsXG4gICAgICogZXZlbnQgZW1pdHRlcikgdGhhdCBubyB0ZXN0IGF3YWl0IG9ic2VydmVzLiBTYW1lIHNpbGVudC1kZWF0aCBtb2RlIGFzXG4gICAgICogdW5oYW5kbGVkIHJlamVjdGlvbnM6IHdpdGhvdXQgYSBoYW5kbGVyIHRoZSBwcm9jZXNzIGRpZXMgbWlkLXJ1biBhbmQgQ0lcbiAgICAgKiBzZWVzIGEgY3Jhc2hlZCBzaGFyZCB3aXRoIHplcm8gcmVwb3J0ZWQgZmFpbHVyZXMuXG4gICAgICogQHBhcmFtIHt1bmtub3dufSBlcnJvciAtIFRocm93biBlcnJvci5cbiAgICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICAgKi9cbiAgICBjb25zdCBvblVuY2F1Z2h0RXhjZXB0aW9uID0gKGVycm9yKSA9PiB7XG4gICAgICAvLyBNaXJyb3IgdGhlIHVuaGFuZGxlZFJlamVjdGlvbiBkZWZlcnJhbDogYSB0ZXN0IG9ic2VydmluZy90cmlnZ2VyaW5nXG4gICAgICAvLyB1bmNhdWdodCBleGNlcHRpb25zIHdpdGggaXRzIG93biBsaXN0ZW5lciBvd25zIHRoZW0uXG4gICAgICBpZiAocHJvY2Vzcy5saXN0ZW5lckNvdW50KFwidW5jYXVnaHRFeGNlcHRpb25cIikgPiAxKSByZXR1cm5cblxuICAgICAgdGhpcy5yZWNvcmRBc3luY0NyYXNoKFwidW5jYXVnaHRFeGNlcHRpb25cIiwgZXJyb3IpXG4gICAgfVxuXG4gICAgcHJvY2Vzcy5vbihcInVuaGFuZGxlZFJlamVjdGlvblwiLCBvblVuaGFuZGxlZFJlamVjdGlvbilcbiAgICBwcm9jZXNzLm9uKFwidW5jYXVnaHRFeGNlcHRpb25cIiwgb25VbmNhdWdodEV4Y2VwdGlvbilcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLnJ1blBhY2thZ2VUZXN0cygpXG5cbiAgICAgIC8vIEEgcmVqZWN0aW9uIHNjaGVkdWxlZCBieSB0aGUgZmluYWwgdGVzdCAoYSBkZXRhY2hlZCByZWplY3RlZCBwcm9taXNlLFxuICAgICAgLy8gb3IgYW4gYWZ0ZXJDb21taXQgY2FsbGJhY2sgcmVqZWN0aW5nIGFzIHRoZSBzdWl0ZSBkcmFpbnMpIGlzIHJlcG9ydGVkXG4gICAgICAvLyBieSBOb2RlIG9uIGEgTEFURVIgdHVybi4gRHJhaW4gYSBmZXcgdHVybnMgd2hpbGUgdGhlIGhhbmRsZXIgaXMgc3RpbGxcbiAgICAgIC8vIGF0dGFjaGVkIHNvIHRob3NlIGxhdGUgcmVqZWN0aW9ucyBhcmUgcmVjb3JkZWQgaW5zdGVhZCBvZiBlc2NhcGluZyB0b1xuICAgICAgLy8gdGhlIGRlZmF1bHQgY3Jhc2ggcGF0aCBhZnRlciBjbGVhbnVwLlxuICAgICAgZm9yIChsZXQgZHJhaW5UdXJuID0gMDsgZHJhaW5UdXJuIDwgMzsgZHJhaW5UdXJuKyspIHtcbiAgICAgICAgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHNldEltbWVkaWF0ZShyZXNvbHZlKSlcbiAgICAgIH1cbiAgICB9IGZpbmFsbHkge1xuICAgICAgcHJvY2Vzcy5vZmYoXCJ1bmhhbmRsZWRSZWplY3Rpb25cIiwgb25VbmhhbmRsZWRSZWplY3Rpb24pXG4gICAgICBwcm9jZXNzLm9mZihcInVuY2F1Z2h0RXhjZXB0aW9uXCIsIG9uVW5jYXVnaHRFeGNlcHRpb24pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcnVuIGFmdGVyIGFsbHMgZm9yIGFjdGl2ZSBzY29wZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY2xlYW51cCBob29rcyBmaW5pc2guXG4gICAqL1xuICBhc3luYyBydW5BZnRlckFsbHNGb3JBY3RpdmVTY29wZXMoKSB7XG4gICAgY29uc3QgZmFpbHVyZVN0YXJ0ID0gdGhpcy5fc3VpdGVIb29rRmFpbHVyZXMubGVuZ3RoXG5cbiAgICBhd2FpdCB0aGlzLl9wYWNrYWdlUnVubmVyPy5jbGVhbnVwQWN0aXZlU3VpdGVzKClcbiAgICB0aGlzLnRocm93QWZ0ZXJBbGxGYWlsdXJlcyh0aGlzLl9zdWl0ZUhvb2tGYWlsdXJlcy5zbGljZShmYWlsdXJlU3RhcnQpKVxuICB9XG5cbiAgLyoqIEJ1aWxkcyBkZWNsYXJhdGlvbiBtZXRhZGF0YSB1c2VkIG9ubHkgYnkgZnJhbWV3b3JrIGFkYXB0ZXJzIGFuZCBwcm9qZWN0aW9ucy4gKi9cbiAgYW5hbHl6ZURlY2xhcmF0aW9ucygpIHtcbiAgICBjb25zdCB2aXNpdCA9ICgvKiogQHR5cGUge1BhY2thZ2VTdWl0ZURlY2xhcmF0aW9ufSAqLyBzdWl0ZSwgLyoqIEB0eXBlIHtQYWNrYWdlU3VpdGVEZWNsYXJhdGlvbltdfSAqLyBhbmNlc3RvcnMsIC8qKiBAdHlwZSB7c3RyaW5nIHwgdW5kZWZpbmVkfSAqLyBwYXJlbnRQcm9maWxlU2NvcGVJZCkgPT4ge1xuICAgICAgY29uc3Qgc3VpdGVzID0gWy4uLmFuY2VzdG9ycywgc3VpdGVdXG4gICAgICBjb25zdCBkZXNjcmlwdGlvbnMgPSBzdWl0ZXMubWFwKChlbnRyeSkgPT4gZW50cnkubmFtZSkuZmlsdGVyKChuYW1lKSA9PiBuYW1lICE9PSBcIlwiKVxuICAgICAgY29uc3Qgb3duZXJGaWxlUGF0aCA9IHRoaXMuX2RlY2xhcmF0aW9uT3duZXJzLmdldChzdWl0ZSkgPz8gc3VpdGUubG9jYXRpb24uZmlsZVBhdGhcbiAgICAgIGNvbnN0IHByb2ZpbGVTY29wZUlkID0gdGhpcy5fcHJvZmlsZXI/LnNjb3BlSWQoc3VpdGUsIHtcbiAgICAgICAgZGVzY3JpcHRpb25zLFxuICAgICAgICBmaWxlUGF0aDogb3duZXJGaWxlUGF0aCxcbiAgICAgICAgbGluZTogc3VpdGUubG9jYXRpb24ubGluZSxcbiAgICAgICAgcGFyZW50SWQ6IHBhcmVudFByb2ZpbGVTY29wZUlkXG4gICAgICB9KVxuXG4gICAgICBmb3IgKGNvbnN0IGhvb2tzIG9mIE9iamVjdC52YWx1ZXMoc3VpdGUuaG9va3MpKSB7XG4gICAgICAgIGhvb2tzLmZvckVhY2goKGhvb2ssIGRlY2xhcmF0aW9uSW5kZXgpID0+IHtcbiAgICAgICAgICB0aGlzLl9ob29rTWV0YWRhdGEuc2V0KGhvb2ssIHtcbiAgICAgICAgICAgIGRlY2xhcmF0aW9uSW5kZXgsXG4gICAgICAgICAgICBkZWNsYXJhdGlvblNjb3BlSWQ6IHByb2ZpbGVTY29wZUlkLFxuICAgICAgICAgICAgb3duZXJGaWxlUGF0aDogdGhpcy5fZGVjbGFyYXRpb25Pd25lcnMuZ2V0KGhvb2spID8/IGhvb2subG9jYXRpb24uZmlsZVBhdGggPz8gb3duZXJGaWxlUGF0aFxuICAgICAgICAgIH0pXG4gICAgICAgIH0pXG4gICAgICB9XG5cbiAgICAgIGZvciAoY29uc3QgdGVzdERlY2xhcmF0aW9uIG9mIHN1aXRlLnRlc3RzKSB7XG4gICAgICAgIGNvbnN0IGZ1bGxEZXNjcmlwdGlvbiA9IHRoaXMuYnVpbGRGdWxsRGVzY3JpcHRpb24oZGVzY3JpcHRpb25zLCB0ZXN0RGVjbGFyYXRpb24ubmFtZSlcbiAgICAgICAgY29uc3QgZGVjbGFyYXRpb25zID0gdGhpcy5fdGVzdHNCeUZ1bGxOYW1lLmdldChmdWxsRGVzY3JpcHRpb24pIHx8IFtdXG5cbiAgICAgICAgZGVjbGFyYXRpb25zLnB1c2godGVzdERlY2xhcmF0aW9uKVxuICAgICAgICB0aGlzLl90ZXN0c0J5RnVsbE5hbWUuc2V0KGZ1bGxEZXNjcmlwdGlvbiwgZGVjbGFyYXRpb25zKVxuICAgICAgICB0aGlzLl90ZXN0TWV0YWRhdGEuc2V0KHRlc3REZWNsYXJhdGlvbiwge1xuICAgICAgICAgIGRlc2NyaXB0aW9ucyxcbiAgICAgICAgICB0ZXN0RGVzY3JpcHRpb246IHRlc3REZWNsYXJhdGlvbi5uYW1lLFxuICAgICAgICAgIGZ1bGxEZXNjcmlwdGlvbixcbiAgICAgICAgICBvd25lckZpbGVQYXRoOiB0aGlzLl9kZWNsYXJhdGlvbk93bmVycy5nZXQodGVzdERlY2xhcmF0aW9uKSA/PyB0ZXN0RGVjbGFyYXRpb24ubG9jYXRpb24uZmlsZVBhdGggPz8gb3duZXJGaWxlUGF0aCxcbiAgICAgICAgICBzdWl0ZXNcbiAgICAgICAgfSlcbiAgICAgICAgY29uc3QgbGVnYWN5VGVzdERhdGEgPSB0aGlzLl9sZWdhY3lGaXh0dXJlRGF0YUJ5RnVsbE5hbWU/LmdldChmdWxsRGVzY3JpcHRpb24pXG4gICAgICAgIGlmIChsZWdhY3lUZXN0RGF0YSkge1xuICAgICAgICAgIHRoaXMuX3Rlc3RDb21wYXRpYmlsaXR5LnNldCh0ZXN0RGVjbGFyYXRpb24sIHtcbiAgICAgICAgICAgIHRlc3RBcmdzOiB0aGlzLl90ZXN0QXJndW1lbnRzLmNvcHkodGVzdERlY2xhcmF0aW9uKSxcbiAgICAgICAgICAgIHRlc3REYXRhOiBsZWdhY3lUZXN0RGF0YVxuICAgICAgICAgIH0pXG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5fdGVzdHNDb3VudCsrXG4gICAgICAgIGlmICh0ZXN0RGVjbGFyYXRpb24uc3RhdGUgPT09IFwicnVuXCIgJiYgKHRlc3REZWNsYXJhdGlvbi5mb2N1cyB8fCBzdWl0ZXMuc29tZSgoZW50cnkpID0+IGVudHJ5LmZvY3VzKSkpIHtcbiAgICAgICAgICB0aGlzLmFueVRlc3RzRm9jdXNzZWQgPSB0cnVlXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgZm9yIChjb25zdCBjaGlsZFN1aXRlIG9mIHN1aXRlLnN1aXRlcykgdmlzaXQoY2hpbGRTdWl0ZSwgc3VpdGVzLCBwcm9maWxlU2NvcGVJZClcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IHN1aXRlIG9mIHRoaXMuZ2V0VGVzdENvbnRleHQoKS5yZWdpc3RyeS5zdWl0ZXMpIHZpc2l0KHN1aXRlLCBbXSwgdW5kZWZpbmVkKVxuICB9XG5cbiAgLyoqXG4gICAqIEdldHMgcGFja2FnZSBob29rIGNvbXBhdGliaWxpdHkgbWV0YWRhdGEuXG4gICAqIEBwYXJhbSB7UGFja2FnZUhvb2tEZWNsYXJhdGlvbn0gaG9vayAtIFBhY2thZ2UgaG9vayBkZWNsYXJhdGlvbi5cbiAgICogQHJldHVybnMge3tkZWNsYXJhdGlvbkluZGV4OiBudW1iZXIsIGRlY2xhcmF0aW9uU2NvcGVJZDogc3RyaW5nIHwgdW5kZWZpbmVkLCBvd25lckZpbGVQYXRoOiBzdHJpbmcgfCB1bmRlZmluZWR9fSAtIEhvb2sgbWV0YWRhdGEuXG4gICAqL1xuICBob29rTWV0YWRhdGEoaG9vaykge1xuICAgIHJldHVybiB0aGlzLl9ob29rTWV0YWRhdGEuZ2V0KGhvb2spIHx8IHtkZWNsYXJhdGlvbkluZGV4OiAwLCBkZWNsYXJhdGlvblNjb3BlSWQ6IHVuZGVmaW5lZCwgb3duZXJGaWxlUGF0aDogaG9vay5sb2NhdGlvbi5maWxlUGF0aH1cbiAgfVxuXG4gIC8qKlxuICAgKiBHZXRzIHBhY2thZ2UgdGVzdCBjb21wYXRpYmlsaXR5IG1ldGFkYXRhLlxuICAgKiBAcGFyYW0ge1BhY2thZ2VUZXN0RGVjbGFyYXRpb259IHRlc3QgLSBQYWNrYWdlIHRlc3QgZGVjbGFyYXRpb24uXG4gICAqIEByZXR1cm5zIHt7ZGVzY3JpcHRpb25zOiBzdHJpbmdbXSwgdGVzdERlc2NyaXB0aW9uOiBzdHJpbmcsIGZ1bGxEZXNjcmlwdGlvbjogc3RyaW5nLCBvd25lckZpbGVQYXRoOiBzdHJpbmcgfCB1bmRlZmluZWQsIHN1aXRlczogUGFja2FnZVN1aXRlRGVjbGFyYXRpb25bXX19IC0gRGVjbGFyYXRpb24gbWV0YWRhdGEuXG4gICAqL1xuICB0ZXN0TWV0YWRhdGEodGVzdCkge1xuICAgIGNvbnN0IG1ldGFkYXRhID0gdGhpcy5fdGVzdE1ldGFkYXRhLmdldCh0ZXN0KVxuICAgIGlmICghbWV0YWRhdGEpIHRocm93IG5ldyBFcnJvcihgTWlzc2luZyBwYWNrYWdlIHRlc3QgbWV0YWRhdGE6ICR7dGVzdC5uYW1lfWApXG4gICAgcmV0dXJuIG1ldGFkYXRhXG4gIH1cblxuICAvKipcbiAgICogR2V0cyBzdGFibGUgY29tcGF0aWJpbGl0eSBkYXRhIGZvciBhIHBhY2thZ2UgZGVjbGFyYXRpb24uXG4gICAqIEBwYXJhbSB7UGFja2FnZVRlc3REZWNsYXJhdGlvbn0gdGVzdCAtIFBhY2thZ2UgdGVzdCBkZWNsYXJhdGlvbi5cbiAgICogQHJldHVybnMge3t0ZXN0QXJnczogVGVzdEFyZ3MsIHRlc3REYXRhOiBUZXN0RGF0YX19IC0gU3RhYmxlIGNvbXBhdGliaWxpdHkgZGF0YS5cbiAgICovXG4gIHRlc3REYXRhKHRlc3QpIHtcbiAgICBsZXQgY29tcGF0aWJpbGl0eSA9IHRoaXMuX3Rlc3RDb21wYXRpYmlsaXR5LmdldCh0ZXN0KVxuXG4gICAgaWYgKCFjb21wYXRpYmlsaXR5KSB7XG4gICAgICBjb25zdCB0ZXN0QXJncyA9IHRoaXMuX3Rlc3RBcmd1bWVudHMuY29weSh0ZXN0KVxuICAgICAgY29uc3QgbWV0YWRhdGEgPSB0aGlzLnRlc3RNZXRhZGF0YSh0ZXN0KVxuICAgICAgY29uc3QgdGVzdERhdGEgPSB7XG4gICAgICAgIGFyZ3M6IHRlc3RBcmdzLFxuICAgICAgICBkZWNsYXJhdGlvbjogdGVzdCxcbiAgICAgICAgZmlsZVBhdGg6IHRlc3QubG9jYXRpb24uZmlsZVBhdGgsXG4gICAgICAgIGZ1bmN0aW9uOiB0ZXN0LmNhbGxiYWNrLFxuICAgICAgICBsaW5lOiB0ZXN0LmxvY2F0aW9uLmxpbmUsXG4gICAgICAgIG93bmVyRmlsZVBhdGg6IG1ldGFkYXRhLm93bmVyRmlsZVBhdGhcbiAgICAgIH1cbiAgICAgIGNvbXBhdGliaWxpdHkgPSB7dGVzdEFyZ3MsIHRlc3REYXRhfVxuICAgICAgdGhpcy5fdGVzdENvbXBhdGliaWxpdHkuc2V0KHRlc3QsIGNvbXBhdGliaWxpdHkpXG4gICAgfVxuXG4gICAgcmV0dXJuIGNvbXBhdGliaWxpdHlcbiAgfVxuXG4gIC8qKlxuICAgKiBJbmplY3RzIGZyYW1ld29yayBjb2xsYWJvcmF0b3JzIGludG8gc3RhYmxlIGNvbXBhdGliaWxpdHkgZGF0YSBvbmNlLlxuICAgKiBAcGFyYW0ge1BhY2thZ2VUZXN0RGVjbGFyYXRpb259IHRlc3QgLSBQYWNrYWdlIHRlc3QgZGVjbGFyYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHt0ZXN0QXJnczogVGVzdEFyZ3MsIHRlc3REYXRhOiBUZXN0RGF0YX0+fSAtIEluamVjdGVkIGNvbXBhdGliaWxpdHkgZGF0YS5cbiAgICovXG4gIGFzeW5jIHRlc3RDb21wYXRpYmlsaXR5KHRlc3QpIHtcbiAgICBjb25zdCBjb21wYXRpYmlsaXR5ID0gdGhpcy50ZXN0RGF0YSh0ZXN0KVxuXG4gICAgaWYgKCF0aGlzLl9pbmplY3RlZFRlc3RzLmhhcyh0ZXN0KSkge1xuICAgICAgYXdhaXQgdGhpcy5fdGVzdEFyZ3VtZW50cy5pbmplY3QoY29tcGF0aWJpbGl0eS50ZXN0QXJncylcbiAgICAgIHRoaXMuX2luamVjdGVkVGVzdHMuYWRkKHRlc3QpXG4gICAgfVxuXG4gICAgcmV0dXJuIGNvbXBhdGliaWxpdHlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmRzIGEgcmF3IGZyYW1ld29yayBhdHRlbXB0IG91dGNvbWUuXG4gICAqIEBwYXJhbSB7UGFja2FnZVRlc3REZWNsYXJhdGlvbn0gdGVzdCAtIFBhY2thZ2UgdGVzdCBkZWNsYXJhdGlvbi5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGF0dGVtcHROdW1iZXIgLSBPbmUtYmFzZWQgYXR0ZW1wdCBudW1iZXIuXG4gICAqIEBwYXJhbSB7e2Fib3J0UmVtYWluaW5nVGVzdHM6IGJvb2xlYW4sIGVycm9yOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgZmFpbGVkOiBib29sZWFufX0gb3V0Y29tZSAtIFJhdyBhdHRlbXB0IG91dGNvbWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgcmVjb3JkQXR0ZW1wdE91dGNvbWUodGVzdCwgYXR0ZW1wdE51bWJlciwgb3V0Y29tZSkge1xuICAgIGNvbnN0IG91dGNvbWVzID0gdGhpcy5fYXR0ZW1wdE91dGNvbWVzLmdldCh0ZXN0KSB8fCBuZXcgTWFwKClcbiAgICBvdXRjb21lcy5zZXQoYXR0ZW1wdE51bWJlciwgb3V0Y29tZSlcbiAgICB0aGlzLl9hdHRlbXB0T3V0Y29tZXMuc2V0KHRlc3QsIG91dGNvbWVzKVxuICAgIGlmIChvdXRjb21lLmFib3J0UmVtYWluaW5nVGVzdHMpIHRoaXMuX2Fib3J0UmVtYWluaW5nVGVzdHMgPSB0cnVlXG4gIH1cblxuICAvKipcbiAgICogR2V0cyBhIHJhdyBmcmFtZXdvcmsgYXR0ZW1wdCBvdXRjb21lLlxuICAgKiBAcGFyYW0ge1BhY2thZ2VUZXN0RGVjbGFyYXRpb259IHRlc3QgLSBQYWNrYWdlIHRlc3QgZGVjbGFyYXRpb24uXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhdHRlbXB0TnVtYmVyIC0gT25lLWJhc2VkIGF0dGVtcHQgbnVtYmVyLlxuICAgKiBAcmV0dXJucyB7e2Fib3J0UmVtYWluaW5nVGVzdHM6IGJvb2xlYW4sIGVycm9yOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgZmFpbGVkOiBib29sZWFufSB8IHVuZGVmaW5lZH0gLSBSYXcgYXR0ZW1wdCBvdXRjb21lLlxuICAgKi9cbiAgYXR0ZW1wdE91dGNvbWUodGVzdCwgYXR0ZW1wdE51bWJlcikgeyByZXR1cm4gdGhpcy5fYXR0ZW1wdE91dGNvbWVzLmdldCh0ZXN0KT8uZ2V0KGF0dGVtcHROdW1iZXIpIH1cblxuICAvKipcbiAgICogUmVjb3JkcyBhIHJhdyBzdWl0ZS1ob29rIGZhaWx1cmUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBmYWlsdXJlIC0gU3VpdGUtaG9vayBmYWlsdXJlLlxuICAgKiBAcGFyYW0ge1BhY2thZ2VTdWl0ZURlY2xhcmF0aW9ufSBmYWlsdXJlLnN1aXRlIC0gT3duaW5nIHBhY2thZ2Ugc3VpdGUuXG4gICAqIEBwYXJhbSB7XCJiZWZvcmVBbGxcIiB8IFwiYWZ0ZXJBbGxcIn0gZmFpbHVyZS5waGFzZSAtIEhvb2sgcGhhc2UuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGZhaWx1cmUuZXJyb3IgLSBSYXcgaG9vayBmYWlsdXJlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHJlY29yZFN1aXRlSG9va0ZhaWx1cmUoZmFpbHVyZSkgeyB0aGlzLl9zdWl0ZUhvb2tGYWlsdXJlcy5wdXNoKGZhaWx1cmUpIH1cblxuICAvKipcbiAgICogR2V0cyB0aGUgcmF3IGFuY2VzdG9yIHNldHVwIGZhaWx1cmUgb3V0Y29tZSBmb3IgYSBwYWNrYWdlIHRlc3QuXG4gICAqIEBwYXJhbSB7UGFja2FnZVRlc3REZWNsYXJhdGlvbn0gdGVzdCAtIFBhY2thZ2UgdGVzdCBkZWNsYXJhdGlvbi5cbiAgICogQHJldHVybnMge3tmYWlsZWQ6IGZhbHNlfSB8IHtmYWlsZWQ6IHRydWUsIGVycm9yOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn19IC0gUmF3IHNldHVwIGZhaWx1cmUgb3V0Y29tZS5cbiAgICovXG4gIHNldHVwRmFpbHVyZU91dGNvbWVGb3IodGVzdCkge1xuICAgIGNvbnN0IHN1aXRlcyA9IHRoaXMudGVzdE1ldGFkYXRhKHRlc3QpLnN1aXRlc1xuICAgIGNvbnN0IGZhaWx1cmUgPSB0aGlzLl9zdWl0ZUhvb2tGYWlsdXJlcy5maW5kKChlbnRyeSkgPT4gZW50cnkucGhhc2UgPT09IFwiYmVmb3JlQWxsXCIgJiYgc3VpdGVzLmluY2x1ZGVzKGVudHJ5LnN1aXRlKSlcblxuICAgIHJldHVybiBmYWlsdXJlID8ge2ZhaWxlZDogdHJ1ZSwgZXJyb3I6IGZhaWx1cmUuZXJyb3J9IDoge2ZhaWxlZDogZmFsc2V9XG4gIH1cblxuICAvKipcbiAgICogRmluZHMgdGhlIG5leHQgaW5jb21wbGV0ZSBkZWNsYXJhdGlvbiB3aXRoIGEgcGFja2FnZSBmdWxsIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBmdWxsTmFtZSAtIFBhY2thZ2UgZnVsbCBuYW1lLlxuICAgKiBAcmV0dXJucyB7UGFja2FnZVRlc3REZWNsYXJhdGlvbiB8IHVuZGVmaW5lZH0gLSBOZXh0IG1hdGNoaW5nIGRlY2xhcmF0aW9uLlxuICAgKi9cbiAgZmluZFRlc3REZWNsYXJhdGlvbihmdWxsTmFtZSkge1xuICAgIHJldHVybiB0aGlzLl90ZXN0c0J5RnVsbE5hbWUuZ2V0KGZ1bGxOYW1lKT8uZmluZCgodGVzdCkgPT4gIXRoaXMuX2NvbXBsZXRlZFRlc3RzLmhhcyh0ZXN0KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBNYXJrcyBhIHBhY2thZ2UgZGVjbGFyYXRpb24gY29tcGxldGUuXG4gICAqIEBwYXJhbSB7UGFja2FnZVRlc3REZWNsYXJhdGlvbn0gdGVzdCAtIENvbXBsZXRlZCBkZWNsYXJhdGlvbi5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBjb21wbGV0ZVRlc3REZWNsYXJhdGlvbih0ZXN0KSB7IHRoaXMuX2NvbXBsZXRlZFRlc3RzLmFkZCh0ZXN0KSB9XG5cbiAgLyoqXG4gICAqIEdldHMgdGhlIGVmZmVjdGl2ZSBwYWNrYWdlIHJldHJ5IGNvdW50LlxuICAgKiBAcGFyYW0ge1BhY2thZ2VUZXN0RGVjbGFyYXRpb259IHRlc3QgLSBQYWNrYWdlIHRlc3QgZGVjbGFyYXRpb24uXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gRWZmZWN0aXZlIHJldHJ5IGNvdW50LlxuICAgKi9cbiAgcmV0cnlDb3VudCh0ZXN0KSB7XG4gICAgY29uc3QgdmFsdWUgPSB0ZXN0Lm9wdGlvbnMucmV0cmllcyA/PyB0ZXN0Lm9wdGlvbnMucmV0cnkgPz8gdGhpcy5nZXRUZXN0Q29udGV4dCgpLmNvbmZpZy5yZXRyaWVzXG4gICAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUodmFsdWUpID8gTWF0aC5tYXgoMCwgTWF0aC5mbG9vcih2YWx1ZSkpIDogMFxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZXMgcmV0cnkgaW5wdXRzIGZvciB0aGUgcGFja2FnZSBleGVjdXRpb24gYm91bmRhcnkgd2hpbGUgcmV0YWluaW5nXG4gICAqIHRoZSBkZWNsYXJhdGlvbnMnIG9yaWdpbmFsIHB1YmxpYyBvcHRpb25zIGFmdGVyIHRoZSBydW4uXG4gICAqIEByZXR1cm5zIHsoKSA9PiB2b2lkfSAtIFJlc3RvcmVzIG9yaWdpbmFsIGRlY2xhcmF0aW9uIG9wdGlvbnMuXG4gICAqL1xuICBub3JtYWxpemVQYWNrYWdlUmV0cmllc0ZvckV4ZWN1dGlvbigpIHtcbiAgICAvKiogQHR5cGUge1BhY2thZ2VSZXRyeU9wdGlvblJlc3RvcmF0aW9uW119ICovXG4gICAgY29uc3QgcmVzdG9yYXRpb25zID0gW11cbiAgICAvKipcbiAgICAgKiBOb3JtYWxpemVzIGRlY2xhcmF0aW9ucyBpbiBvbmUgc3VpdGUuXG4gICAgICogQHBhcmFtIHtQYWNrYWdlU3VpdGVEZWNsYXJhdGlvbn0gc3VpdGUgLSBTdWl0ZSB3aG9zZSB0ZXN0cyBhcmUgbm9ybWFsaXplZC5cbiAgICAgKi9cbiAgICBjb25zdCB2aXNpdCA9IChzdWl0ZSkgPT4ge1xuICAgICAgZm9yIChjb25zdCB0ZXN0IG9mIHN1aXRlLnRlc3RzKSB7XG4gICAgICAgIC8vIENhcHR1cmUgY29tcGF0aWJpbGl0eSBhcmd1bWVudHMgYmVmb3JlIHRlbXBvcmFyaWx5IGFkYXB0aW5nIHBhY2thZ2VcbiAgICAgICAgLy8gZXhlY3V0aW9uIG9wdGlvbnMgc28gY2FsbGJhY2tzIHJldGFpbiB0aGVpciBkZWNsYXJlZCB2YWx1ZXMvaWRlbnRpdHkuXG4gICAgICAgIHRoaXMudGVzdERhdGEodGVzdClcbiAgICAgICAgcmVzdG9yYXRpb25zLnB1c2goe1xuICAgICAgICAgIGhhZFJldHJpZXM6IE9iamVjdC5oYXNPd24odGVzdC5vcHRpb25zLCBcInJldHJpZXNcIiksXG4gICAgICAgICAgb3B0aW9uczogdGVzdC5vcHRpb25zLFxuICAgICAgICAgIHJldHJpZXM6IHRlc3Qub3B0aW9ucy5yZXRyaWVzXG4gICAgICAgIH0pXG4gICAgICAgIHRlc3Qub3B0aW9ucy5yZXRyaWVzID0gdGhpcy5yZXRyeUNvdW50KHRlc3QpXG4gICAgICB9XG5cbiAgICAgIGZvciAoY29uc3QgY2hpbGRTdWl0ZSBvZiBzdWl0ZS5zdWl0ZXMpIHZpc2l0KGNoaWxkU3VpdGUpXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBzdWl0ZSBvZiB0aGlzLmdldFRlc3RDb250ZXh0KCkucmVnaXN0cnkuc3VpdGVzKSB2aXNpdChzdWl0ZSlcblxuICAgIHJldHVybiAoKSA9PiB7XG4gICAgICBmb3IgKGNvbnN0IHJlc3RvcmF0aW9uIG9mIHJlc3RvcmF0aW9ucykge1xuICAgICAgICBpZiAocmVzdG9yYXRpb24uaGFkUmV0cmllcykgcmVzdG9yYXRpb24ub3B0aW9ucy5yZXRyaWVzID0gcmVzdG9yYXRpb24ucmV0cmllc1xuICAgICAgICBlbHNlIGRlbGV0ZSByZXN0b3JhdGlvbi5vcHRpb25zLnJldHJpZXNcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkcyBvbmUgY29tcGxldGVkIHRlc3QgZHVyYXRpb24uXG4gICAqIEBwYXJhbSB7e2R1cmF0aW9uTXM6IG51bWJlciwgZmlsZVBhdGg6IHN0cmluZywgZnVsbERlc2NyaXB0aW9uOiBzdHJpbmcsIGxpbmU6IG51bWJlcn19IGR1cmF0aW9uIC0gQ29tcGxldGVkIHRlc3QgZHVyYXRpb24uXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgcmVjb3JkVGVzdER1cmF0aW9uKGR1cmF0aW9uKSB7IHRoaXMuX3Rlc3REdXJhdGlvbnMucHVzaChkdXJhdGlvbikgfVxuXG4gIC8qKiBSZWNvcmRzIG9uZSBzdWNjZXNzZnVsIHBhY2thZ2UgcmVzdWx0LiAqL1xuICByZWNvcmRTdWNjZXNzZnVsVGVzdCgpIHsgdGhpcy5fc3VjY2Vzc2Z1bFRlc3RzKysgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmRzIG9uZSBmYWlsZWQgcGFja2FnZSB0ZXN0IGluIHRoZSBsZWdhY3kgcmVzdWx0IHByb2plY3Rpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gRmFpbGVkIHRlc3QgbWV0YWRhdGEuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGFyZ3MuZGVzY3JpcHRpb25zIC0gUGFyZW50IGRlc2NyaXB0aW9ucy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5lcnJvciAtIFJhdyBmYWlsdXJlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jb25zb2xlT3V0cHV0IC0gQ2FwdHVyZWQgY29uc29sZSBvdXRwdXQuXG4gICAqIEBwYXJhbSB7VGVzdERhdGF9IGFyZ3MudGVzdERhdGEgLSBDb21wYXRpYmlsaXR5IHRlc3QgZGF0YS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MudGVzdERlc2NyaXB0aW9uIC0gVGVzdCBkZXNjcmlwdGlvbi5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICByZWNvcmRGYWlsZWRUZXN0KHtkZXNjcmlwdGlvbnMsIGVycm9yLCBjb25zb2xlT3V0cHV0LCB0ZXN0RGF0YSwgdGVzdERlc2NyaXB0aW9ufSkge1xuICAgIHRoaXMuX2ZhaWxlZFRlc3RzKytcbiAgICB0aGlzLl9mYWlsZWRUZXN0RGV0YWlscy5wdXNoKHtcbiAgICAgIGZ1bGxEZXNjcmlwdGlvbjogdGhpcy5idWlsZEZ1bGxEZXNjcmlwdGlvbihkZXNjcmlwdGlvbnMsIHRlc3REZXNjcmlwdGlvbiksXG4gICAgICBmaWxlUGF0aDogdGVzdERhdGEuZmlsZVBhdGgsXG4gICAgICBsaW5lOiB0ZXN0RGF0YS5saW5lLFxuICAgICAgZXJyb3IsXG4gICAgICBjb25zb2xlT3V0cHV0OiBjb25zb2xlT3V0cHV0IHx8IHVuZGVmaW5lZFxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogU3RvcmVzIHRoZSBjb21wbGV0ZWQgcGFja2FnZSByZXN1bHQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiQHZlbG9jaW91cy90ZXN0aW5nL3J1bm5lclwiKS5UZXN0UnVuUmVzdWx0fSByZXN1bHQgLSBQYWNrYWdlIHJlc3VsdC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICByZWNvcmRQYWNrYWdlUmVzdWx0KHJlc3VsdCkgeyB0aGlzLl9wYWNrYWdlUmVzdWx0ID0gcmVzdWx0IH1cblxuICAvKipcbiAgICogUnVucyB0aGUgcGFja2FnZSBrZXJuZWwgd2l0aCBWZWxvY2lvdXMgZnJhbWV3b3JrIGFkYXB0ZXJzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBleGVjdXRpb24gYW5kIHRlYXJkb3duLlxuICAgKi9cbiAgYXN5bmMgcnVuUGFja2FnZVRlc3RzKCkge1xuICAgIGNvbnN0IGVudmlyb25tZW50SGFuZGxlciA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldEVudmlyb25tZW50SGFuZGxlcigpXG4gICAgZW52aXJvbm1lbnRIYW5kbGVyLmluc3RhbGxTaGFyZWRUcmFuc2FjdGlvbkNvb3JkaW5hdG9yT3duZXJTdG9yYWdlKHRoaXMuX3NoYXJlZFRyYW5zYWN0aW9uQ29vcmRpbmF0b3JPd25lclN0b3JhZ2UpXG4gICAgZW52aXJvbm1lbnRIYW5kbGVyLmluc3RhbGxUZXN0RGF0YWJhc2VBY2Nlc3NTY29wZVN0b3JhZ2UodGhpcy5fdGVzdERhdGFiYXNlQWNjZXNzU2NvcGVTdG9yYWdlKVxuICAgIHRoaXMuX3BhY2thZ2VSdW5uZXIgPSBuZXcgUGFja2FnZVRlc3RSdW5uZXIoe1xuICAgICAgY29udGV4dDogdGhpcy5nZXRUZXN0Q29udGV4dCgpLFxuICAgICAgaW5jbHVkZVRhZ3M6IHRoaXMuX2luY2x1ZGVUYWdzLFxuICAgICAgZXhjbHVkZVRhZ3M6IFsuLi50aGlzLmdldEV4Y2x1ZGVUYWdTZXQoKSwgLi4uKHRoaXMuaXNCcm93c2VyVGVzdE1vZGUoKSA/IFtdIDogW1wiYnJvd3Nlci1vbmx5XCJdKV0sXG4gICAgICBleGFtcGxlczogdGhpcy5nZXRFeGFtcGxlUGF0dGVybnMoKSxcbiAgICAgIGxpbmVGaWx0ZXJzOiB0aGlzLmdldExpbmVGaWx0ZXJzKCksXG4gICAgICBpbmNsdWRlVGFnTW9kZTogXCJhbnlcIixcbiAgICAgIGZvY3VzZWRUZXN0c0J5cGFzc0luY2x1ZGVUYWdzOiB0cnVlLFxuICAgICAgb21pdEVtcHR5U3VpdGVOYW1lczogdHJ1ZSxcbiAgICAgIGF0dGVtcHRFeGVjdXRvck93bnNUaW1lb3V0OiB0cnVlLFxuICAgICAgYXR0ZW1wdEV4ZWN1dG9yOiAoaW5wdXQpID0+IHRoaXMuX2F0dGVtcHRFeGVjdXRvci5leGVjdXRlKGlucHV0KSxcbiAgICAgIHRlc3RBcmd1bWVudFJlc29sdmVyOiAoaW5wdXQpID0+IHRoaXMuX3Rlc3RBcmd1bWVudHMucmVzb2x2ZShpbnB1dCksXG4gICAgICBzdWl0ZUhvb2tFeGVjdXRvcjogKGlucHV0KSA9PiB0aGlzLl9zdWl0ZUhvb2tFeGVjdXRvci5leGVjdXRlKGlucHV0KSxcbiAgICAgIHJlcG9ydGVyOiB0aGlzLl9ydW5uZXJSZXBvcnRlclxuICAgIH0pXG4gICAgY29uc3QgZmFpbHVyZVN0YXJ0ID0gdGhpcy5fc3VpdGVIb29rRmFpbHVyZXMubGVuZ3RoXG4gICAgY29uc3QgcmVzdG9yZVJldHJ5T3B0aW9ucyA9IHRoaXMubm9ybWFsaXplUGFja2FnZVJldHJpZXNGb3JFeGVjdXRpb24oKVxuICAgIGxldCByZXN1bHRcblxuICAgIHRyeSB7XG4gICAgICB0cnkge1xuICAgICAgICByZXN1bHQgPSBhd2FpdCB0aGlzLl9wYWNrYWdlUnVubmVyLnJ1bigpXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBpZiAoIShlcnJvciBpbnN0YW5jZW9mIEFib3J0UmVtYWluaW5nVGVzdHNFcnJvcikpIHRocm93IGVycm9yXG5cbiAgICAgICAgY29uc3QgYWZ0ZXJBbGwgPSB0aGlzLmFmdGVyQWxsT3V0Y29tZSh0aGlzLl9zdWl0ZUhvb2tGYWlsdXJlcy5zbGljZShmYWlsdXJlU3RhcnQpKVxuICAgICAgICBpZiAoYWZ0ZXJBbGwuZmFpbGVkKSB0aGlzLnJlY29yZFRpbWVvdXRDbGVhbnVwRmFpbHVyZShhZnRlckFsbC5lcnJvciwgXCJhZnRlckFsbFwiKVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cblxuICAgICAgdGhpcy5yZWNvcmRQYWNrYWdlUmVzdWx0KHJlc3VsdClcbiAgICAgIHRoaXMudGhyb3dBZnRlckFsbEZhaWx1cmVzKHRoaXMuX3N1aXRlSG9va0ZhaWx1cmVzLnNsaWNlKGZhaWx1cmVTdGFydCkpXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHJlc3RvcmVSZXRyeU9wdGlvbnMoKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBBZ2dyZWdhdGVzIHJhdyBhZnRlci1hbGwgZmFpbHVyZXMgd2l0aG91dCB1c2luZyBlcnJvciB0cnV0aGluZXNzLlxuICAgKiBAcGFyYW0ge0FycmF5PHtwaGFzZTogXCJiZWZvcmVBbGxcIiB8IFwiYWZ0ZXJBbGxcIiwgZXJyb3I6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fT59IGZhaWx1cmVzIC0gSG9vayBmYWlsdXJlcy5cbiAgICogQHJldHVybnMge3tmYWlsZWQ6IGZhbHNlfSB8IHtmYWlsZWQ6IHRydWUsIGVycm9yOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn19IC0gRXhwbGljaXQgYWZ0ZXJBbGwgb3V0Y29tZS5cbiAgICovXG4gIGFmdGVyQWxsT3V0Y29tZShmYWlsdXJlcykge1xuICAgIGNvbnN0IGFmdGVyQWxsRXJyb3JzID0gZmFpbHVyZXMuZmlsdGVyKChmYWlsdXJlKSA9PiBmYWlsdXJlLnBoYXNlID09PSBcImFmdGVyQWxsXCIpLm1hcCgoZmFpbHVyZSkgPT4gZmFpbHVyZS5lcnJvcilcblxuICAgIGlmIChhZnRlckFsbEVycm9ycy5sZW5ndGggPT09IDApIHJldHVybiB7ZmFpbGVkOiBmYWxzZX1cbiAgICBpZiAoYWZ0ZXJBbGxFcnJvcnMubGVuZ3RoID09PSAxKSByZXR1cm4ge2ZhaWxlZDogdHJ1ZSwgZXJyb3I6IGFmdGVyQWxsRXJyb3JzWzBdfVxuICAgIHJldHVybiB7XG4gICAgICBmYWlsZWQ6IHRydWUsXG4gICAgICBlcnJvcjogbmV3IEFnZ3JlZ2F0ZUVycm9yKGFmdGVyQWxsRXJyb3JzLCBcIk11bHRpcGxlIGFjdGl2ZSBhZnRlckFsbCBzY29wZXMgZmFpbGVkXCIsIHtjYXVzZTogYWZ0ZXJBbGxFcnJvcnNbMF19KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBUaHJvd3Mgb25lIHJhdyBvciBhZ2dyZWdhdGVkIGFmdGVyLWFsbCBmYWlsdXJlLlxuICAgKiBAcGFyYW0ge0FycmF5PHtwaGFzZTogXCJiZWZvcmVBbGxcIiB8IFwiYWZ0ZXJBbGxcIiwgZXJyb3I6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fT59IGZhaWx1cmVzIC0gSG9vayBmYWlsdXJlcy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICB0aHJvd0FmdGVyQWxsRmFpbHVyZXMoZmFpbHVyZXMpIHtcbiAgICBjb25zdCBhZnRlckFsbCA9IHRoaXMuYWZ0ZXJBbGxPdXRjb21lKGZhaWx1cmVzKVxuXG4gICAgaWYgKGFmdGVyQWxsLmZhaWxlZCkgdGhyb3cgYWZ0ZXJBbGwuZXJyb3JcbiAgfVxuXG4gIC8qKlxuICAgKiBDb21wYXRpYmlsaXR5IGhlbHBlciBmb3IgZm9jdXNlZCBmcmFtZXdvcmsgbGlmZWN5Y2xlIHNwZWNzLiBJdCBjb252ZXJ0cyBhblxuICAgKiBleHBsaWNpdCBsZWdhY3kgZml4dHVyZSBpbnRvIGlzb2xhdGVkIHBhY2thZ2UgZGVjbGFyYXRpb25zOyB0aGUgcGFja2FnZVxuICAgKiBydW5uZXIgcmVtYWlucyB0aGUgc29sZSBleGVjdXRpb24gZW5naW5lLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIExlZ2FjeSBmaXh0dXJlIGFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtUZXN0c0FyZ3VtZW50fSBhcmdzLnRlc3RzIC0gRml4dHVyZSB0cmVlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBwYWNrYWdlIGV4ZWN1dGlvbi5cbiAgICovXG4gIGFzeW5jIHJ1blRlc3RzKHt0ZXN0c30pIHtcbiAgICBjb25zdCBjb250ZXh0ID0gY3JlYXRlVGVzdENvbnRleHQoKVxuICAgIGNvbnN0IG9yaWdpbmFsQ29udGV4dCA9IHRoaXMuX2NvbnRleHRcbiAgICBjb250ZXh0LmNvbmZpZ3VyZVRlc3RzKHtcbiAgICAgIGNvbnNvbGVPdXRwdXQ6IG9yaWdpbmFsQ29udGV4dC5jb25maWcuY29uc29sZU91dHB1dCxcbiAgICAgIGRlZmF1bHRUaW1lb3V0TXM6IG9yaWdpbmFsQ29udGV4dC5jb25maWcuZGVmYXVsdFRpbWVvdXRNcyxcbiAgICAgIGV4Y2x1ZGVUYWdzOiBvcmlnaW5hbENvbnRleHQuY29uZmlnLmV4Y2x1ZGVUYWdzLFxuICAgICAgZmFpbGVkQ29uc29sZU91dHB1dE1heExpbmVzOiBvcmlnaW5hbENvbnRleHQuY29uZmlnLmZhaWxlZENvbnNvbGVPdXRwdXRNYXhMaW5lcyxcbiAgICAgIHJldHJpZXM6IG9yaWdpbmFsQ29udGV4dC5jb25maWcucmV0cmllc1xuICAgIH0pXG4gICAgdGhpcy5fY29udGV4dCA9IGNvbnRleHRcbiAgICB0aGlzLl90ZXN0c0NvdW50ID0gMFxuICAgIHRoaXMuX3Rlc3RDb21wYXRpYmlsaXR5ID0gbmV3IFdlYWtNYXAoKVxuICAgIHRoaXMuX2luamVjdGVkVGVzdHMgPSBuZXcgV2Vha1NldCgpXG4gICAgdGhpcy5fY29tcGxldGVkVGVzdHMgPSBuZXcgV2Vha1NldCgpXG4gICAgdGhpcy5fdGVzdE1ldGFkYXRhID0gbmV3IFdlYWtNYXAoKVxuICAgIHRoaXMuX2hvb2tNZXRhZGF0YSA9IG5ldyBXZWFrTWFwKClcbiAgICB0aGlzLl9hdHRlbXB0T3V0Y29tZXMgPSBuZXcgV2Vha01hcCgpXG4gICAgdGhpcy5fc3VpdGVIb29rRmFpbHVyZXMgPSBbXVxuICAgIHRoaXMuX3Rlc3RzQnlGdWxsTmFtZSA9IG5ldyBNYXAoKVxuICAgIHRoaXMuX2xlZ2FjeUZpeHR1cmVEYXRhQnlGdWxsTmFtZSA9IG5ldyBNYXAoKVxuICAgIGNvbnRleHQuc2V0RGVjbGFyYXRpb25Mb2NhdG9yKCgpID0+IHRoaXMuX2xlZ2FjeUZpeHR1cmVMb2NhdGlvbilcbiAgICB0aGlzLmRlY2xhcmVMZWdhY3lGaXh0dXJlKGNvbnRleHQsIFwiXCIsIHRlc3RzLCBbXSlcbiAgICB0aGlzLmFuYWx5emVEZWNsYXJhdGlvbnMoKVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMucnVuUGFja2FnZVRlc3RzKClcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdGhpcy5fY29udGV4dCA9IG9yaWdpbmFsQ29udGV4dFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBEZWNsYXJlcyBhbiBpc29sYXRlZCBsZWdhY3ktc2hhcGVkIHRlc3QgZml4dHVyZSBpbnRvIGEgcGFja2FnZSBjb250ZXh0LlxuICAgKiBAcGFyYW0ge1BhY2thZ2VUZXN0Q29udGV4dH0gY29udGV4dCAtIElzb2xhdGVkIHBhY2thZ2UgY29udGV4dC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBTdWl0ZSBuYW1lLlxuICAgKiBAcGFyYW0ge1Rlc3RzQXJndW1lbnR9IHNjb3BlIC0gTGVnYWN5IGZpeHR1cmUgc2NvcGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGRlc2NyaXB0aW9ucyAtIEFuY2VzdG9yIGRlc2NyaXB0aW9ucy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBkZWNsYXJlTGVnYWN5Rml4dHVyZShjb250ZXh0LCBuYW1lLCBzY29wZSwgZGVzY3JpcHRpb25zKSB7XG4gICAgdGhpcy5fbGVnYWN5Rml4dHVyZUxvY2F0aW9uID0ge2ZpbGVQYXRoOiBzY29wZS5maWxlUGF0aCwgbGluZTogc2NvcGUubGluZX1cbiAgICBjb250ZXh0LmRlc2NyaWJlKG5hbWUsIHNjb3BlLmFyZ3MgfHwge30sICgpID0+IHtcbiAgICAgIGZvciAoY29uc3QgaG9vayBvZiBzY29wZS5iZWZvcmVBbGxzIHx8IFtdKSBjb250ZXh0LmJlZm9yZUFsbChob29rLmNhbGxiYWNrKVxuICAgICAgZm9yIChjb25zdCBob29rIG9mIHNjb3BlLmJlZm9yZUVhY2hlcyB8fCBbXSkgY29udGV4dC5iZWZvcmVFYWNoKGhvb2suY2FsbGJhY2spXG4gICAgICBmb3IgKGNvbnN0IGhvb2sgb2Ygc2NvcGUuYWZ0ZXJFYWNoZXMgfHwgW10pIGNvbnRleHQuYWZ0ZXJFYWNoKGhvb2suY2FsbGJhY2spXG4gICAgICBmb3IgKGNvbnN0IGhvb2sgb2Ygc2NvcGUuYWZ0ZXJBbGxzIHx8IFtdKSBjb250ZXh0LmFmdGVyQWxsKGhvb2suY2FsbGJhY2spXG4gICAgICBjb25zdCBuZXh0RGVzY3JpcHRpb25zID0gbmFtZSA9PT0gXCJcIiA/IGRlc2NyaXB0aW9ucyA6IFsuLi5kZXNjcmlwdGlvbnMsIG5hbWVdXG4gICAgICBmb3IgKGNvbnN0IFt0ZXN0TmFtZSwgdGVzdERhdGFdIG9mIE9iamVjdC5lbnRyaWVzKHNjb3BlLnRlc3RzIHx8IHt9KSkge1xuICAgICAgICB0aGlzLl9sZWdhY3lGaXh0dXJlTG9jYXRpb24gPSB7ZmlsZVBhdGg6IHRlc3REYXRhLmZpbGVQYXRoLCBsaW5lOiB0ZXN0RGF0YS5saW5lfVxuICAgICAgICB0aGlzLl9sZWdhY3lGaXh0dXJlRGF0YUJ5RnVsbE5hbWU/LnNldCh0aGlzLmJ1aWxkRnVsbERlc2NyaXB0aW9uKG5leHREZXNjcmlwdGlvbnMsIHRlc3ROYW1lKSwgdGVzdERhdGEpXG4gICAgICAgIGNvbnRleHQuaXQodGVzdE5hbWUsIHRlc3REYXRhLmFyZ3MsIHRlc3REYXRhLmZ1bmN0aW9uKVxuICAgICAgfVxuICAgICAgZm9yIChjb25zdCBbc3VpdGVOYW1lLCBjaGlsZFNjb3BlXSBvZiBPYmplY3QuZW50cmllcyhzY29wZS5zdWJzIHx8IHt9KSkge1xuICAgICAgICB0aGlzLmRlY2xhcmVMZWdhY3lGaXh0dXJlKGNvbnRleHQsIHN1aXRlTmFtZSwgY2hpbGRTY29wZSwgbmV4dERlc2NyaXB0aW9ucylcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZW1pdCBldmVudC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGV2ZW50TmFtZSAtIEV2ZW50IG5hbWUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBwYXlsb2FkIC0gRXZlbnQgcGF5bG9hZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBhbGwgbGlzdGVuZXJzIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgZW1pdEV2ZW50KGV2ZW50TmFtZSwgcGF5bG9hZCkge1xuICAgIGF3YWl0IHRoaXMuX3J1bm5lclJlcG9ydGVyLmVtaXRFdmVudChldmVudE5hbWUsIHBheWxvYWQpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwcmludCByZXJ1biBjb21tYW5kLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBhcmdzLmRlc2NyaXB0aW9ucyAtIERlc2NyaXB0aW9uIHN0YWNrLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy50ZXN0RGVzY3JpcHRpb24gLSBUZXN0IGRlc2NyaXB0aW9uLlxuICAgKiBAcGFyYW0ge1Rlc3REYXRhfSBhcmdzLnRlc3REYXRhIC0gVGVzdCBkYXRhLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5sZWZ0UGFkZGluZyAtIExlZnQgcGFkZGluZy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgcHJpbnRSZXJ1bkNvbW1hbmQoe2Rlc2NyaXB0aW9ucywgdGVzdERlc2NyaXB0aW9uLCB0ZXN0RGF0YSwgbGVmdFBhZGRpbmd9KSB7XG4gICAgY29uc3QgcmVydW4gPSB0aGlzLmJ1aWxkUmVydW5Db21tYW5kKHtkZXNjcmlwdGlvbnMsIHRlc3REZXNjcmlwdGlvbiwgdGVzdERhdGF9KVxuXG4gICAgaWYgKHJlcnVuKSB7XG4gICAgICBjb25zb2xlLmVycm9yKGAke2xlZnRQYWRkaW5nfSAgUmUtcnVuOiAke3JlcnVufWApXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYnVpbGQgcmVydW4gY29tbWFuZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gYXJncy5kZXNjcmlwdGlvbnMgLSBEZXNjcmlwdGlvbiBzdGFjay5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MudGVzdERlc2NyaXB0aW9uIC0gVGVzdCBkZXNjcmlwdGlvbi5cbiAgICogQHBhcmFtIHtUZXN0RGF0YX0gYXJncy50ZXN0RGF0YSAtIFRlc3QgZGF0YS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBSZXJ1biBjb21tYW5kLlxuICAgKi9cbiAgYnVpbGRSZXJ1bkNvbW1hbmQoe2Rlc2NyaXB0aW9ucywgdGVzdERlc2NyaXB0aW9uLCB0ZXN0RGF0YX0pIHtcbiAgICBjb25zdCBiYXNlQ29tbWFuZCA9IFwibnB4IHZlbG9jaW91cyB0ZXN0XCJcbiAgICBjb25zdCBmaWxlUGF0aCA9IHRlc3REYXRhLmZpbGVQYXRoXG4gICAgY29uc3QgbGluZSA9IHRlc3REYXRhLmxpbmVcblxuICAgIGlmIChmaWxlUGF0aCAmJiBsaW5lKSB7XG4gICAgICBjb25zdCByZWxhdGl2ZVBhdGggPSBwYXRoLnJlbGF0aXZlKHByb2Nlc3MuY3dkKCksIGZpbGVQYXRoKVxuICAgICAgcmV0dXJuIGAke2Jhc2VDb21tYW5kfSAke3JlbGF0aXZlUGF0aH06JHtsaW5lfWBcbiAgICB9XG5cbiAgICBjb25zdCBmdWxsRGVzY3JpcHRpb24gPSB0aGlzLmJ1aWxkRnVsbERlc2NyaXB0aW9uKGRlc2NyaXB0aW9ucywgdGVzdERlc2NyaXB0aW9uKVxuXG4gICAgaWYgKGZ1bGxEZXNjcmlwdGlvbikge1xuICAgICAgcmV0dXJuIGAke2Jhc2VDb21tYW5kfSAtLWV4YW1wbGUgJHtKU09OLnN0cmluZ2lmeShmdWxsRGVzY3JpcHRpb24pfWBcbiAgICB9XG5cbiAgICByZXR1cm4gdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBidWlsZCBjb25zb2xlIG91dHB1dC5cbiAgICogQHBhcmFtIHtBdHRlbXB0Q29uc29sZU91dHB1dFtdfSBhdHRlbXB0Q29uc29sZU91dHB1dHMgLSBBdHRlbXB0IG91dHB1dCBlbnRyaWVzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIENvbWJpbmVkIGNvbnNvbGUgb3V0cHV0LlxuICAgKi9cbiAgYnVpbGRDb25zb2xlT3V0cHV0KGF0dGVtcHRDb25zb2xlT3V0cHV0cykge1xuICAgIGlmIChhdHRlbXB0Q29uc29sZU91dHB1dHMubGVuZ3RoID09PSAwKSByZXR1cm4gXCJcIlxuICAgIGlmIChhdHRlbXB0Q29uc29sZU91dHB1dHMubGVuZ3RoID09PSAxKSByZXR1cm4gYXR0ZW1wdENvbnNvbGVPdXRwdXRzWzBdLm91dHB1dFxuXG4gICAgcmV0dXJuIGF0dGVtcHRDb25zb2xlT3V0cHV0cy5tYXAoKGF0dGVtcHRDb25zb2xlT3V0cHV0KSA9PiB7XG4gICAgICByZXR1cm4gYC0tLSBBdHRlbXB0ICR7YXR0ZW1wdENvbnNvbGVPdXRwdXQuYXR0ZW1wdE51bWJlcn0gLS0tXFxuJHthdHRlbXB0Q29uc29sZU91dHB1dC5vdXRwdXR9YFxuICAgIH0pLmpvaW4oXCJcXG5cIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBmYWlsZWQgY29uc29sZSBvdXRwdXQgbWF4IGxpbmVzLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIE1heGltdW0gZmFpbGVkIGNvbnNvbGUgbGluZXMuXG4gICAqL1xuICBnZXRGYWlsZWRDb25zb2xlT3V0cHV0TWF4TGluZXMoKSB7XG4gICAgY29uc3QgbWF4TGluZXMgPSB0ZXN0Q29uZmlnLmZhaWxlZENvbnNvbGVPdXRwdXRNYXhMaW5lc1xuXG4gICAgaWYgKHR5cGVvZiBtYXhMaW5lcyAhPT0gXCJudW1iZXJcIiB8fCAhTnVtYmVyLmlzRmluaXRlKG1heExpbmVzKSkgcmV0dXJuIDIwMFxuXG4gICAgcmV0dXJuIE1hdGgubWF4KDAsIE1hdGguZmxvb3IobWF4TGluZXMpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdHJ1bmNhdGUgZmFpbGVkIGNvbnNvbGUgb3V0cHV0IGxpbmVzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY29uc29sZU91dHB1dCAtIENvbnNvbGUgb3V0cHV0LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nW119IC0gTGluZXMgZm9yIGlubGluZSBvdXRwdXQuXG4gICAqL1xuICB0cnVuY2F0ZUZhaWxlZENvbnNvbGVPdXRwdXRMaW5lcyhjb25zb2xlT3V0cHV0KSB7XG4gICAgY29uc3QgbGluZXMgPSBjb25zb2xlT3V0cHV0LnNwbGl0KFwiXFxuXCIpXG4gICAgY29uc3QgbWF4TGluZXMgPSB0aGlzLmdldEZhaWxlZENvbnNvbGVPdXRwdXRNYXhMaW5lcygpXG5cbiAgICBpZiAobWF4TGluZXMgPT09IDApIHJldHVybiBbXVxuICAgIGlmIChsaW5lcy5sZW5ndGggPD0gbWF4TGluZXMpIHJldHVybiBsaW5lc1xuXG4gICAgY29uc3Qgb21pdHRlZExpbmVzID0gbGluZXMubGVuZ3RoIC0gbWF4TGluZXNcbiAgICBjb25zdCBwbHVyYWwgPSBvbWl0dGVkTGluZXMgPT09IDEgPyBcIlwiIDogXCJzXCJcblxuICAgIHJldHVybiBbXG4gICAgICBgLi4uICR7b21pdHRlZExpbmVzfSBjb25zb2xlIG91dHB1dCBsaW5lJHtwbHVyYWx9IG9taXR0ZWQgLi4uYCxcbiAgICAgIC4uLmxpbmVzLnNsaWNlKC1tYXhMaW5lcylcbiAgICBdXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwcmludCBmYWlsZWQgY29uc29sZSBvdXRwdXQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNvbnNvbGVPdXRwdXQgLSBDb25zb2xlIG91dHB1dC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MubGVmdFBhZGRpbmcgLSBMZWZ0IHBhZGRpbmcuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHByaW50RmFpbGVkQ29uc29sZU91dHB1dCh7Y29uc29sZU91dHB1dCwgbGVmdFBhZGRpbmd9KSB7XG4gICAgaWYgKHRlc3RDb25maWcuY29uc29sZU91dHB1dCAhPT0gXCJmYWlsdXJlXCIpIHJldHVyblxuICAgIGlmICghY29uc29sZU91dHB1dCkgcmV0dXJuXG5cbiAgICBjb25zdCBsaW5lcyA9IHRoaXMudHJ1bmNhdGVGYWlsZWRDb25zb2xlT3V0cHV0TGluZXMoY29uc29sZU91dHB1dClcblxuICAgIGlmIChsaW5lcy5sZW5ndGggPT09IDApIHJldHVyblxuXG4gICAgY29uc29sZS5lcnJvcihwaWNvY29sb3JzLnJlZChgJHtsZWZ0UGFkZGluZ30gIENvbnNvbGUgb3V0cHV0OmApKVxuXG4gICAgZm9yIChjb25zdCBsaW5lIG9mIGxpbmVzKSB7XG4gICAgICBjb25zb2xlLmVycm9yKHBpY29jb2xvcnMucmVkKGAke2xlZnRQYWRkaW5nfSAgICAke2xpbmV9YCkpXG4gICAgfVxuICB9XG5cbn1cbiJdfQ==