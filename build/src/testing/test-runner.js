// @ts-check
import fs from "node:fs/promises";
import path from "path";
import { AsyncLocalStorage } from "node:async_hooks";
import { createTestContext, defaultTestContext } from "@velocious/testing";
import { slowestTestResults } from "@velocious/testing/reporters";
import { TestRunner as PackageTestRunner } from "@velocious/testing/runner";
import Application from "../../src/application.js";
import RequestClient from "./request-client.js";
import Tenant from "../tenants/tenant.js";
import picocolors from "picocolors";
import restArgsError from "../utils/rest-args-error.js";
import { testConfig } from "./test.js";
import { fileURLToPath, pathToFileURL } from "url";
import SharedTransactionBroker from "./shared-transaction-broker.js";
import { SHARED_TRANSACTION_BROKER_ENV } from "./shared-transaction-proxy-driver.js";
import VelociousAttemptExecutor from "./velocious-attempt-executor.js";
import VelociousRunnerReporter, { AbortRemainingTestsError } from "./velocious-runner-reporter.js";
import VelociousSuiteHookExecutor from "./velocious-suite-hook-executor.js";
import TestTenantDatabasePool from "./test-tenant-database-pool.js";
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
 * @property {(args?: {databaseIdentifier?: string, tenant?: object}) => Promise<TestTenantPoolLease>} [acquireTestTenant] - Leases one member of the configured test tenant database pool for this attempt (opt-in `testTenantPools` configuration).
 * @property {(args: {databaseIdentifier: string, tenant: object}) => void} [registerTenantForCleanup] - Registers one active tenant database for the framework-owned end-of-attempt cleanup (drop + provider hooks) without hand-rolled afterEach bookkeeping.
 */
/**
 * TestTenantPoolLease type (re-exported from the pool for TestArgs consumers).
 * @typedef {import("./test-tenant-database-pool.js").TestTenantPoolLease} TestTenantPoolLease
 */
/**
 * TenantCleanupRegistration type.
 * @typedef {object} TenantCleanupRegistration
 * @property {string} databaseIdentifier - Tenant database identifier to drop at attempt end.
 * @property {ReturnType<typeof JSON.parse>} tenant - Tenant descriptor whose database must be dropped.
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
const testingPackageDirectory = path.dirname(fileURLToPath(import.meta.resolve("@velocious/testing/package.json")));
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
     * @param {number} [args.retries] - Default retry count.
     * @param {string[]} [args.setupFiles] - Setup files imported before test files.
     * @param {number} [args.timeoutMs] - Default lifecycle timeout.
     */
    constructor({ configuration, context = defaultTestContext, excludeTags, includeTags, testFiles, lineFilters, examplePatterns, profiler, retries, setupFiles, timeoutMs, ...restArgs }) {
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
        this._retries = retries;
        this._setupFiles = setupFiles || [];
        this._timeoutMs = timeoutMs;
        this._abortRemainingTests = false;
        /** @type {Map<string, TestTenantDatabasePool>} */
        this._testTenantPools = new Map();
        /** @type {Promise<void> | undefined} */
        this._testTenantPoolTeardownPromise = undefined;
        this._failedTests = 0;
        this._successfulTests = 0;
        this._testsCount = 0;
        this._failedTestDetails = [];
        /** @type {import("@velocious/testing/runner").NonRunTestResult[]} */
        this._notRunTestDetails = [];
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
     * Resolves the pool identifier when exactly one `testTenantPools` entry is
     * configured, so `acquireTestTenant()` can omit it. Ambiguous or missing
     * configuration fails loudly instead of guessing.
     * @returns {string} - The single configured pool identifier.
     */
    singleTestTenantPoolIdentifier() {
        const identifiers = Object.keys(this.getConfiguration().getTestTenantPools() || {});
        if (identifiers.length === 0) {
            throw new Error("acquireTestTenant requires a databaseIdentifier when no testTenantPools configuration is present");
        }
        if (identifiers.length > 1) {
            throw new Error(`acquireTestTenant requires a databaseIdentifier when multiple testTenantPools are configured: ${identifiers.join(", ")}`);
        }
        return identifiers[0];
    }
    /**
     * Returns the test tenant database pool for one configured `testTenantPools`
     * identifier, creating it on first use. Throws when the identifier has no pool
     * configuration — the pool stays strictly opt-in.
     * @param {string} databaseIdentifier - Tenant database identifier.
     * @returns {TestTenantDatabasePool} - The runner-owned pool.
     */
    getTestTenantPool(databaseIdentifier) {
        const existingPool = this._testTenantPools.get(databaseIdentifier);
        if (existingPool)
            return existingPool;
        const poolConfiguration = this.getConfiguration().getTestTenantPools()?.[databaseIdentifier];
        if (!poolConfiguration) {
            throw new Error(`No testTenantPools configuration for database identifier: ${databaseIdentifier}`);
        }
        const pool = new TestTenantDatabasePool({
            configuration: this.getConfiguration(),
            databaseIdentifier,
            poolConfiguration
        });
        this._testTenantPools.set(databaseIdentifier, pool);
        return pool;
    }
    /**
     * Tears down every test tenant database pool created during this run, exactly once.
     * Safe to call from afterAll-style teardown and from the runner's own cleanup; the
     * same promise is shared by concurrent callers.
     * @returns {Promise<void>} - Resolves after all pools dropped their databases.
     */
    teardownTestTenantPools() {
        this._testTenantPoolTeardownPromise ??= (async () => {
            const pools = [...this._testTenantPools.values()];
            this._testTenantPools.clear();
            const errors = [];
            for (const pool of pools) {
                try {
                    await pool.teardown();
                }
                catch (error) {
                    errors.push(error);
                }
            }
            if (errors.length === 1)
                throw errors[0];
            if (errors.length > 1)
                throw new AggregateError(errors, "Failed to tear down test tenant database pools");
        })();
        return this._testTenantPoolTeardownPromise;
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
     * Registers one tenant database for framework-owned end-of-attempt cleanup. The
     * registration drops the tenant's database through the provider's `dropDatabase`
     * hook (or the framework default) after the attempt's afterEach hooks and
     * transactional tenant rollbacks finished, so consuming apps do not hand-roll a
     * Map/afterEach bookkeeping layer for DDL that a test transaction cannot roll back.
     * @param {{databaseIdentifier: string, tenant: object}} args - Tenant database identifier and tenant descriptor to drop at attempt end.
     * @param {TenantCleanupRegistration[]} registrations - Current attempt registrations.
     * @returns {void} - No return value.
     */
    registerTenantForCleanup({ databaseIdentifier, tenant, ...restArgs }, registrations) {
        restArgsError(restArgs);
        if (!databaseIdentifier)
            throw new Error("registerTenantForCleanup requires a databaseIdentifier");
        if (!tenant)
            throw new Error("registerTenantForCleanup requires a tenant");
        const databaseConfiguration = this.getConfiguration().resolveDatabaseConfiguration(databaseIdentifier, tenant);
        if (!databaseConfiguration.tenantOnly) {
            throw new Error(`registerTenantForCleanup requires a tenantOnly database: ${databaseIdentifier}`);
        }
        registrations.push({ databaseIdentifier, tenant });
    }
    /**
     * Drops every tenant database registered for this attempt, in registration order.
     * Each drop is attempted even when an earlier one failed; failures are surfaced
     * (single error or AggregateError), never swallowed.
     * @param {TenantCleanupRegistration[]} registrations - Attempt-owned registrations.
     * @returns {Promise<void>} - Resolves after all registered tenants were dropped.
     */
    async cleanupTenantRegistrations(registrations) {
        const errors = [];
        for (const { databaseIdentifier, tenant } of registrations) {
            try {
                await Tenant.drop({ identifier: databaseIdentifier, tenant, configuration: this.getConfiguration() });
            }
            catch (error) {
                errors.push(error);
            }
        }
        if (errors.length === 1)
            throw errors[0];
        if (errors.length > 1)
            throw new AggregateError(errors, "Failed to drop tenant databases registered for cleanup");
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
     * Counts selected tests blocked by a terminal resource.
     * @returns {number} - Selected tests not executed because a shared resource failed.
     */
    getNotRunTests() { return this._notRunTestDetails.length; }
    /**
     * Returns runtime non-run attribution.
     * @returns {import("@velocious/testing/runner").NonRunTestResult[]} - Runtime non-run details with the originating failure.
     */
    getNotRunTestDetails() { return this._notRunTestDetails; }
    /**
     * Records a selected test that did not execute.
     * @param {import("@velocious/testing/runner").NonRunTestResult} result - Terminal-resource non-run record.
     * @returns {void}
     */
    recordNotRunTest(result) { this._notRunTestDetails.push(result); }
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
     * Distinguishes an empty selection from a failure before selected cases execute.
     * @returns {boolean} - Whether selection matched no declarations.
     */
    hasNoMatches() {
        return this._packageResult?.noMatches === true;
    }
    /**
     * Returns the tests recorded during the run, slowest first.
     * @param {number} [limit] - Maximum number of tests to return (0 returns all).
     * @returns {Array<{fullDescription: string, filePath: string, line: number, durationMs: number}>} - Slowest tests, slowest first.
     */
    getSlowestTests(limit = 10) {
        if (this._packageResult) {
            return slowestTestResults(this._packageResult, { limit }).map((result) => ({
                fullDescription: result.fullName,
                filePath: result.filePath ?? "<unknown>",
                line: result.line ?? 0,
                durationMs: result.durationMs
            }));
        }
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
        this._notRunTestDetails = [];
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
            if (this._setupFiles.length > 0) {
                await this.runProfileSpan({ phase: "testing config/global setup" }, async () => {
                    await this.getConfiguration().getEnvironmentHandler().importTestFiles(this._setupFiles);
                });
            }
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
            if (resolvedFilePath.startsWith(`${testingPackageDirectory}${path.sep}`))
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
            try {
                await this.teardownTestTenantPools();
            }
            catch (error) {
                this.recordTimeoutCleanupFailure(error, "test tenant pool teardown");
            }
        }
    }
    /**
     * Runs run after alls for active scopes.
     * @returns {Promise<void>} - Resolves when cleanup hooks finish.
     */
    async runAfterAllsForActiveScopes() {
        const failureStart = this._suiteHookFailures.length;
        await this._packageRunner?.cleanupActiveSuites();
        try {
            await this.teardownTestTenantPools();
        }
        catch (error) {
            this.recordTimeoutCleanupFailure(error, "test tenant pool teardown");
        }
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
        const value = test.options.retries ?? test.options.retry ?? this._retries ?? this.getTestContext().config.retries;
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
            reporter: this._runnerReporter,
            retries: this._retries,
            timeoutMs: this._timeoutMs
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGVzdC1ydW5uZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvdGVzdGluZy90ZXN0LXJ1bm5lci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxFQUFFLE1BQU0sa0JBQWtCLENBQUE7QUFDakMsT0FBTyxJQUFJLE1BQU0sTUFBTSxDQUFBO0FBQ3ZCLE9BQU8sRUFBRSxpQkFBaUIsRUFBRSxNQUFNLGtCQUFrQixDQUFBO0FBQ3BELE9BQU8sRUFBRSxpQkFBaUIsRUFBRSxrQkFBa0IsRUFBRSxNQUFNLG9CQUFvQixDQUFBO0FBQzFFLE9BQU8sRUFBRSxrQkFBa0IsRUFBRSxNQUFNLDhCQUE4QixDQUFBO0FBQ2pFLE9BQU8sRUFBRSxVQUFVLElBQUksaUJBQWlCLEVBQUUsTUFBTSwyQkFBMkIsQ0FBQTtBQUMzRSxPQUFPLFdBQVcsTUFBTSwwQkFBMEIsQ0FBQTtBQUNsRCxPQUFPLGFBQWEsTUFBTSxxQkFBcUIsQ0FBQTtBQUMvQyxPQUFPLE1BQU0sTUFBTSxzQkFBc0IsQ0FBQTtBQUN6QyxPQUFPLFVBQVUsTUFBTSxZQUFZLENBQUE7QUFDbkMsT0FBTyxhQUFhLE1BQU0sNkJBQTZCLENBQUE7QUFDdkQsT0FBTyxFQUFFLFVBQVUsRUFBRSxNQUFNLFdBQVcsQ0FBQTtBQUN0QyxPQUFPLEVBQUUsYUFBYSxFQUFFLGFBQWEsRUFBRSxNQUFNLEtBQUssQ0FBQTtBQUNsRCxPQUFPLHVCQUF1QixNQUFNLGdDQUFnQyxDQUFBO0FBQ3BFLE9BQU8sRUFBRSw2QkFBNkIsRUFBRSxNQUFNLHNDQUFzQyxDQUFBO0FBQ3BGLE9BQU8sd0JBQXdCLE1BQU0saUNBQWlDLENBQUE7QUFDdEUsT0FBTyx1QkFBdUIsRUFBRSxFQUFFLHdCQUF3QixFQUFFLE1BQU0sZ0NBQWdDLENBQUE7QUFDbEcsT0FBTywwQkFBMEIsTUFBTSxvQ0FBb0MsQ0FBQTtBQUMzRSxPQUFPLHNCQUFzQixNQUFNLGdDQUFnQyxDQUFBO0FB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QUFLLENBQUMsTUFBTSxLQUFLLENBQUM7WUFBRSxPQUFNO1FBRTlCLE9BQU8sQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDLEdBQUcsQ0FBQyxHQUFHLFdBQVcsbUJBQW1CLENBQUMsQ0FBQyxDQUFBO1FBRWhFLEtBQUssTUFBTSxJQUFJLElBQUksS0FBSyxFQUFFLENBQUM7WUFDekIsT0FBTyxDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsR0FBRyxDQUFDLEdBQUcsV0FBVyxPQUFPLElBQUksRUFBRSxDQUFDLENBQUMsQ0FBQTtRQUM1RCxDQUFDO0lBQ0gsQ0FBQztDQUVGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCBmcyBmcm9tIFwibm9kZTpmcy9wcm9taXNlc1wiXG5pbXBvcnQgcGF0aCBmcm9tIFwicGF0aFwiXG5pbXBvcnQgeyBBc3luY0xvY2FsU3RvcmFnZSB9IGZyb20gXCJub2RlOmFzeW5jX2hvb2tzXCJcbmltcG9ydCB7IGNyZWF0ZVRlc3RDb250ZXh0LCBkZWZhdWx0VGVzdENvbnRleHQgfSBmcm9tIFwiQHZlbG9jaW91cy90ZXN0aW5nXCJcbmltcG9ydCB7IHNsb3dlc3RUZXN0UmVzdWx0cyB9IGZyb20gXCJAdmVsb2Npb3VzL3Rlc3RpbmcvcmVwb3J0ZXJzXCJcbmltcG9ydCB7IFRlc3RSdW5uZXIgYXMgUGFja2FnZVRlc3RSdW5uZXIgfSBmcm9tIFwiQHZlbG9jaW91cy90ZXN0aW5nL3J1bm5lclwiXG5pbXBvcnQgQXBwbGljYXRpb24gZnJvbSBcIi4uLy4uL3NyYy9hcHBsaWNhdGlvbi5qc1wiXG5pbXBvcnQgUmVxdWVzdENsaWVudCBmcm9tIFwiLi9yZXF1ZXN0LWNsaWVudC5qc1wiXG5pbXBvcnQgVGVuYW50IGZyb20gXCIuLi90ZW5hbnRzL3RlbmFudC5qc1wiXG5pbXBvcnQgcGljb2NvbG9ycyBmcm9tIFwicGljb2NvbG9yc1wiXG5pbXBvcnQgcmVzdEFyZ3NFcnJvciBmcm9tIFwiLi4vdXRpbHMvcmVzdC1hcmdzLWVycm9yLmpzXCJcbmltcG9ydCB7IHRlc3RDb25maWcgfSBmcm9tIFwiLi90ZXN0LmpzXCJcbmltcG9ydCB7IGZpbGVVUkxUb1BhdGgsIHBhdGhUb0ZpbGVVUkwgfSBmcm9tIFwidXJsXCJcbmltcG9ydCBTaGFyZWRUcmFuc2FjdGlvbkJyb2tlciBmcm9tIFwiLi9zaGFyZWQtdHJhbnNhY3Rpb24tYnJva2VyLmpzXCJcbmltcG9ydCB7IFNIQVJFRF9UUkFOU0FDVElPTl9CUk9LRVJfRU5WIH0gZnJvbSBcIi4vc2hhcmVkLXRyYW5zYWN0aW9uLXByb3h5LWRyaXZlci5qc1wiXG5pbXBvcnQgVmVsb2Npb3VzQXR0ZW1wdEV4ZWN1dG9yIGZyb20gXCIuL3ZlbG9jaW91cy1hdHRlbXB0LWV4ZWN1dG9yLmpzXCJcbmltcG9ydCBWZWxvY2lvdXNSdW5uZXJSZXBvcnRlciwgeyBBYm9ydFJlbWFpbmluZ1Rlc3RzRXJyb3IgfSBmcm9tIFwiLi92ZWxvY2lvdXMtcnVubmVyLXJlcG9ydGVyLmpzXCJcbmltcG9ydCBWZWxvY2lvdXNTdWl0ZUhvb2tFeGVjdXRvciBmcm9tIFwiLi92ZWxvY2lvdXMtc3VpdGUtaG9vay1leGVjdXRvci5qc1wiXG5pbXBvcnQgVGVzdFRlbmFudERhdGFiYXNlUG9vbCBmcm9tIFwiLi90ZXN0LXRlbmFudC1kYXRhYmFzZS1wb29sLmpzXCJcbmltcG9ydCBWZWxvY2lvdXNUZXN0QXJndW1lbnRzIGZyb20gXCIuL3ZlbG9jaW91cy10ZXN0LWFyZ3VtZW50cy5qc1wiXG5cbi8qKiBAdHlwZWRlZiB7dHlwZW9mIGRlZmF1bHRUZXN0Q29udGV4dH0gUGFja2FnZVRlc3RDb250ZXh0ICovXG4vKiogQHR5cGVkZWYgeyh0eXBlb2YgZGVmYXVsdFRlc3RDb250ZXh0LnJlZ2lzdHJ5LnN1aXRlcylbbnVtYmVyXX0gUGFja2FnZVN1aXRlRGVjbGFyYXRpb24gKi9cbi8qKiBAdHlwZWRlZiB7UGFja2FnZVN1aXRlRGVjbGFyYXRpb25bXCJ0ZXN0c1wiXVtudW1iZXJdfSBQYWNrYWdlVGVzdERlY2xhcmF0aW9uICovXG4vKiogQHR5cGVkZWYge1BhY2thZ2VTdWl0ZURlY2xhcmF0aW9uW1wiaG9va3NcIl1bXCJiZWZvcmVBbGxcIl1bbnVtYmVyXX0gUGFja2FnZUhvb2tEZWNsYXJhdGlvbiAqL1xuLyoqIEB0eXBlZGVmIHtQYWNrYWdlU3VpdGVEZWNsYXJhdGlvbiB8IFBhY2thZ2VUZXN0RGVjbGFyYXRpb24gfCBQYWNrYWdlSG9va0RlY2xhcmF0aW9ufSBQYWNrYWdlUmVnaXN0cmF0aW9uICovXG4vKiogQHR5cGVkZWYge3toYWRSZXRyaWVzOiBib29sZWFuLCBvcHRpb25zOiBQYWNrYWdlVGVzdERlY2xhcmF0aW9uW1wib3B0aW9uc1wiXSwgcmV0cmllczogbnVtYmVyIHwgdW5kZWZpbmVkfX0gUGFja2FnZVJldHJ5T3B0aW9uUmVzdG9yYXRpb24gKi9cblxuLyoqXG4gKiBBdHRlbXB0Q29uc29sZU91dHB1dCB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gQXR0ZW1wdENvbnNvbGVPdXRwdXRcbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBhdHRlbXB0TnVtYmVyIC0gQXR0ZW1wdCBudW1iZXIuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gb3V0cHV0IC0gQ2FwdHVyZWQgY29uc29sZSBvdXRwdXQuXG4gKi9cbi8qKlxuICogVGVzdEFyZ3MgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFRlc3RBcmdzXG4gKiBAcHJvcGVydHkge0FwcGxpY2F0aW9ufSBbYXBwbGljYXRpb25dIC0gQXBwbGljYXRpb24gaW5zdGFuY2UgZm9yIGludGVncmF0aW9uIHRlc3RzLlxuICogQHByb3BlcnR5IHtSZXF1ZXN0Q2xpZW50fSBbY2xpZW50XSAtIEhUVFAgY2xpZW50IGZvciByZXF1ZXN0IHRlc3RzLlxuICogQHByb3BlcnR5IHtvYmplY3R9IFtkYXRhYmFzZUNsZWFuaW5nXSAtIERhdGFiYXNlIGNsZWFudXAgb3B0aW9ucyBmb3IgdGVzdHMuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFtkYXRhYmFzZUNsZWFuaW5nLnRyYW5zYWN0aW9uXSAtIFVzZSB0cmFuc2FjdGlvbnMgdG8gcm9sbGJhY2sgYmV0d2VlbiB0ZXN0cy5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW2RhdGFiYXNlQ2xlYW5pbmcudHJ1bmNhdGVdIC0gVHJ1bmNhdGUgdGFibGVzIGJldHdlZW4gdGVzdHMuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IFtkYXRhYmFzZUNsZWFuaW5nLnRydW5jYXRlQmVmb3JlXSAtIFRydW5jYXRlIHRhYmxlcyBiZWZvcmUgZWFjaCB0ZXN0LCBpbiBhZGRpdGlvbiB0byB0aGUgZGVmYXVsdCBjbGVhbnVwLlxuICogQHByb3BlcnR5IHtib29sZWFufSBbZm9jdXNdIC0gV2hldGhlciB0aGlzIHRlc3QgaXMgZm9jdXNlZC5cbiAqIEBwcm9wZXJ0eSB7KCkgPT4gKHZvaWR8UHJvbWlzZTx2b2lkPil9IFtmdW5jdGlvbl0gLSBUZXN0IGNhbGxiYWNrIGZ1bmN0aW9uLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IFtyZXRyeV0gLSBOdW1iZXIgb2YgcmV0cmllcyB3aGVuIGEgdGVzdCBmYWlscy5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nW10gfCBzdHJpbmd9IFt0YWdzXSAtIFRhZ3MgZm9yIGZpbHRlcmluZy5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBbdGltZW91dFNlY29uZHNdIC0gVGltZW91dCBpbiBzZWNvbmRzIGZvciB0aGUgdGVzdC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbdHlwZV0gLSBUZXN0IHR5cGUgaWRlbnRpZmllci5cbiAqIEBwcm9wZXJ0eSB7KGFyZ3M6IHtkYXRhYmFzZUlkZW50aWZpZXI6IHN0cmluZywgdGVuYW50OiBvYmplY3R9KSA9PiBQcm9taXNlPHZvaWQ+fSBbcmVnaXN0ZXJUcmFuc2FjdGlvbmFsVGVuYW50XSAtIFJlZ2lzdGVycyBvbmUgcmVzb2x2ZWQgdGVuYW50IGRhdGFiYXNlIHRyYW5zYWN0aW9uIGZvciB0aGlzIGF0dGVtcHQuXG4gKiBAcHJvcGVydHkgeyhhcmdzPzoge2RhdGFiYXNlSWRlbnRpZmllcj86IHN0cmluZywgdGVuYW50Pzogb2JqZWN0fSkgPT4gUHJvbWlzZTxUZXN0VGVuYW50UG9vbExlYXNlPn0gW2FjcXVpcmVUZXN0VGVuYW50XSAtIExlYXNlcyBvbmUgbWVtYmVyIG9mIHRoZSBjb25maWd1cmVkIHRlc3QgdGVuYW50IGRhdGFiYXNlIHBvb2wgZm9yIHRoaXMgYXR0ZW1wdCAob3B0LWluIGB0ZXN0VGVuYW50UG9vbHNgIGNvbmZpZ3VyYXRpb24pLlxuICogQHByb3BlcnR5IHsoYXJnczoge2RhdGFiYXNlSWRlbnRpZmllcjogc3RyaW5nLCB0ZW5hbnQ6IG9iamVjdH0pID0+IHZvaWR9IFtyZWdpc3RlclRlbmFudEZvckNsZWFudXBdIC0gUmVnaXN0ZXJzIG9uZSBhY3RpdmUgdGVuYW50IGRhdGFiYXNlIGZvciB0aGUgZnJhbWV3b3JrLW93bmVkIGVuZC1vZi1hdHRlbXB0IGNsZWFudXAgKGRyb3AgKyBwcm92aWRlciBob29rcykgd2l0aG91dCBoYW5kLXJvbGxlZCBhZnRlckVhY2ggYm9va2tlZXBpbmcuXG4gKi9cbi8qKlxuICogVGVzdFRlbmFudFBvb2xMZWFzZSB0eXBlIChyZS1leHBvcnRlZCBmcm9tIHRoZSBwb29sIGZvciBUZXN0QXJncyBjb25zdW1lcnMpLlxuICogQHR5cGVkZWYge2ltcG9ydChcIi4vdGVzdC10ZW5hbnQtZGF0YWJhc2UtcG9vbC5qc1wiKS5UZXN0VGVuYW50UG9vbExlYXNlfSBUZXN0VGVuYW50UG9vbExlYXNlXG4gKi9cbi8qKlxuICogVGVuYW50Q2xlYW51cFJlZ2lzdHJhdGlvbiB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gVGVuYW50Q2xlYW51cFJlZ2lzdHJhdGlvblxuICogQHByb3BlcnR5IHtzdHJpbmd9IGRhdGFiYXNlSWRlbnRpZmllciAtIFRlbmFudCBkYXRhYmFzZSBpZGVudGlmaWVyIHRvIGRyb3AgYXQgYXR0ZW1wdCBlbmQuXG4gKiBAcHJvcGVydHkge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB0ZW5hbnQgLSBUZW5hbnQgZGVzY3JpcHRvciB3aG9zZSBkYXRhYmFzZSBtdXN0IGJlIGRyb3BwZWQuXG4gKi9cbi8qKlxuICogQnJvd3NlckR1bW15Q29ubmVjdGlvblJlZ2lzdHJhdGlvbiB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gQnJvd3NlckR1bW15Q29ubmVjdGlvblJlZ2lzdHJhdGlvblxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBBdHRlbXB0LW93bmVkIGNvbm5lY3Rpb24uXG4gKiBAcHJvcGVydHkge3N0cmluZ30gZGF0YWJhc2VJZGVudGlmaWVyIC0gQ29uZmlndXJlZCBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICogQHByb3BlcnR5IHtQcm9taXNlPHZvaWQ+fSBbcXVhcmFudGluZVByb21pc2VdIC0gU2hhcmVkIGNvbm5lY3Rpb24tZGlzY2FyZCBwcm9taXNlLlxuICogQHByb3BlcnR5IHtib29sZWFufSBxdWFyYW50aW5lZCAtIFdoZXRoZXIgdGhlIGNvbm5lY3Rpb24gaXMgdW5zYWZlIHRvIHJldXNlLlxuICogQHByb3BlcnR5IHtQcm9taXNlPHZvaWQ+fSBbcm9sbGJhY2tQcm9taXNlXSAtIFNoYXJlZCByb2xsYmFjayBwcm9taXNlLlxuICogQHByb3BlcnR5IHtQcm9taXNlPHZvaWQ+fSBbc3RhcnRQcm9taXNlXSAtIFRyYW5zYWN0aW9uIHN0YXJ0dXAgcHJvbWlzZSB3aGVuIHRyYW5zYWN0aW9uIGNsZWFuaW5nIGlzIGVuYWJsZWQuXG4gKi9cbi8qKlxuICogVGVzdERhdGEgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFRlc3REYXRhXG4gKiBAcHJvcGVydHkge1Rlc3RBcmdzfSBhcmdzIC0gQXJndW1lbnRzIHBhc3NlZCB0byB0aGUgdGVzdC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbZmlsZVBhdGhdIC0gU291cmNlIGZpbGUgcGF0aC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBbbGluZV0gLSBTb3VyY2UgbGluZSBudW1iZXIuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW293bmVyRmlsZVBhdGhdIC0gRGV0ZXJtaW5pc3RpYyBpbXBvcnRpbmcgdGVzdCBmaWxlLlxuICogQHByb3BlcnR5IHsoYXJnOiBUZXN0QXJncykgPT4gKHZvaWR8UHJvbWlzZTx2b2lkPil9IGZ1bmN0aW9uIC0gVGVzdCBjYWxsYmFjayB0byBleGVjdXRlLlxuICogQHByb3BlcnR5IHtQYWNrYWdlVGVzdERlY2xhcmF0aW9ufSBbZGVjbGFyYXRpb25dIC0gUGFja2FnZSBkZWNsYXJhdGlvbi5cbiAqL1xuLyoqXG4gKiBGYWlsZWRUZXN0RGV0YWlsIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBGYWlsZWRUZXN0RGV0YWlsXG4gKiBAcHJvcGVydHkge3N0cmluZ30gZnVsbERlc2NyaXB0aW9uIC0gRnVsbCB0ZXN0IGRlc2NyaXB0aW9uLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtmaWxlUGF0aF0gLSBTb3VyY2UgZmlsZSBwYXRoLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IFtsaW5lXSAtIFNvdXJjZSBsaW5lIG51bWJlci5cbiAqIEBwcm9wZXJ0eSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGVycm9yIC0gRmFpbHVyZSBlcnJvci5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbY29uc29sZU91dHB1dF0gLSBDYXB0dXJlZCBjb25zb2xlIG91dHB1dCB3aGlsZSB0ZXN0IHJhbi5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbY29uc29sZUxvZ1BhdGhdIC0gU2F2ZWQgY29uc29sZSBsb2cgcGF0aC5cbiAqL1xuLyoqXG4gKiBEZWZpbmVzIHRoaXMgdHlwZWRlZi5cbiAqIEB0eXBlZGVmIHsoYXJnczoge2NvbmZpZ3VyYXRpb246IGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdCwgdGVzdEFyZ3M6IFRlc3RBcmdzLCB0ZXN0RGF0YTogVGVzdERhdGF9KSA9PiAodm9pZHxQcm9taXNlPHZvaWQ+KX0gQWZ0ZXJCZWZvcmVFYWNoQ2FsbGJhY2tUeXBlXG4gKi9cbi8qKlxuICogQWZ0ZXJCZWZvcmVFYWNoQ2FsbGJhY2tPYmplY3RUeXBlIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBBZnRlckJlZm9yZUVhY2hDYWxsYmFja09iamVjdFR5cGVcbiAqIEBwcm9wZXJ0eSB7QWZ0ZXJCZWZvcmVFYWNoQ2FsbGJhY2tUeXBlfSBjYWxsYmFjayAtIEhvb2sgY2FsbGJhY2sgdG8gZXhlY3V0ZS5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBbZGVjbGFyYXRpb25JbmRleF0gLSBIb29rIGluZGV4IHdpdGhpbiBpdHMgZGVjbGFyYXRpb24gc2NvcGUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW2RlY2xhcmF0aW9uU2NvcGVJZF0gLSBPcGFxdWUgcHJvZmlsZSBzY29wZSBpZGVudGlmaWVyLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtvd25lckZpbGVQYXRoXSAtIERldGVybWluaXN0aWMgaW1wb3J0aW5nIHRlc3QgZmlsZS5cbiAqL1xuLyoqXG4gKiBEZWZpbmVzIHRoaXMgdHlwZWRlZi5cbiAqIEB0eXBlZGVmIHsoYXJnczoge2NvbmZpZ3VyYXRpb246IGltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0pID0+ICh2b2lkfFByb21pc2U8dm9pZD4pfSBCZWZvcmVBZnRlckFsbENhbGxiYWNrVHlwZVxuICovXG4vKipcbiAqIEJlZm9yZUFmdGVyQWxsQ2FsbGJhY2tPYmplY3RUeXBlIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBCZWZvcmVBZnRlckFsbENhbGxiYWNrT2JqZWN0VHlwZVxuICogQHByb3BlcnR5IHtCZWZvcmVBZnRlckFsbENhbGxiYWNrVHlwZX0gY2FsbGJhY2sgLSBIb29rIGNhbGxiYWNrIHRvIGV4ZWN1dGUuXG4gKiBAcHJvcGVydHkge251bWJlcn0gW2RlY2xhcmF0aW9uSW5kZXhdIC0gSG9vayBpbmRleCB3aXRoaW4gaXRzIGRlY2xhcmF0aW9uIHNjb3BlLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IFtkZWNsYXJhdGlvblNjb3BlSWRdIC0gT3BhcXVlIHByb2ZpbGUgc2NvcGUgaWRlbnRpZmllci5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbb3duZXJGaWxlUGF0aF0gLSBEZXRlcm1pbmlzdGljIGltcG9ydGluZyB0ZXN0IGZpbGUuXG4gKi9cbi8qKlxuICogVGVzdHNBcmd1bWVudCB0eXBlLlxuICogQHR5cGVkZWYge29iamVjdH0gVGVzdHNBcmd1bWVudFxuICogQHByb3BlcnR5IHtUZXN0QXJnc30gYXJncyAtIEFyZ3VtZW50cyBpbmhlcml0ZWQgYnkgdGVzdHMgaW4gdGhpcyBzY29wZS5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW2FueVRlc3RzRm9jdXNzZWRdIC0gV2hldGhlciBhbnkgdGVzdHMgaW4gdGhlIHRyZWUgYXJlIGZvY3VzZWQuXG4gKiBAcHJvcGVydHkge0FmdGVyQmVmb3JlRWFjaENhbGxiYWNrT2JqZWN0VHlwZVtdfSBhZnRlckVhY2hlcyAtIEFmdGVyLWVhY2ggaG9va3MgZm9yIHRoaXMgc2NvcGUuXG4gKiBAcHJvcGVydHkge0JlZm9yZUFmdGVyQWxsQ2FsbGJhY2tPYmplY3RUeXBlW119IGFmdGVyQWxscyAtIEFmdGVyLWFsbCBob29rcyBmb3IgdGhpcyBzY29wZS5cbiAqIEBwcm9wZXJ0eSB7QmVmb3JlQWZ0ZXJBbGxDYWxsYmFja09iamVjdFR5cGVbXX0gYmVmb3JlQWxscyAtIEJlZm9yZS1hbGwgaG9va3MgZm9yIHRoaXMgc2NvcGUuXG4gKiBAcHJvcGVydHkge0FmdGVyQmVmb3JlRWFjaENhbGxiYWNrT2JqZWN0VHlwZVtdfSBiZWZvcmVFYWNoZXMgLSBCZWZvcmUtZWFjaCBob29rcyBmb3IgdGhpcyBzY29wZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbZmlsZVBhdGhdIC0gU291cmNlIGZpbGUgcGF0aC5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBbbGluZV0gLSBTb3VyY2UgbGluZSBudW1iZXIuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gW293bmVyRmlsZVBhdGhdIC0gRGV0ZXJtaW5pc3RpYyBpbXBvcnRpbmcgdGVzdCBmaWxlLlxuICogQHByb3BlcnR5IHtSZWNvcmQ8c3RyaW5nLCBUZXN0RGF0YT59IHRlc3RzIC0gQSB1bmlxdWUgaWRlbnRpZmllciBmb3IgdGhlIG5vZGUuXG4gKiBAcHJvcGVydHkge1JlY29yZDxzdHJpbmcsIFRlc3RzQXJndW1lbnQ+fSBzdWJzIC0gT3B0aW9uYWwgY2hpbGQgbm9kZXMuIEVhY2ggaXRlbSBpcyBhbm90aGVyIGBOb2RlYCwgYWxsb3dpbmcgcmVjdXJzaW9uLlxuICovXG4vKipcbiAqIE1hcmtzIHRoZSBlcnJvciB0aHJvd24gYnkgdGhlIGF0dGVtcHQgdGltZW91dCBzbyB0aGUgcnVubmVyIGNhbiBkaXN0aW5ndWlzaFxuICogZGV0YWNoZWQgbGlmZWN5Y2xlIGNsZWFudXAgZnJvbSBhbiBvcmRpbmFyeSB0ZXN0IGZhaWx1cmUuXG4gKiBAdHlwZWRlZiB7RXJyb3IgJiB7dmVsb2Npb3VzVGVzdFRpbWVvdXQ/OiB0cnVlfX0gVGVzdFRpbWVvdXRFcnJvclxuICovXG4vKipcbiAqIFNoYXJlZFRyYW5zYWN0aW9uQnJva2VyUmVnaXN0cmF0aW9uIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBTaGFyZWRUcmFuc2FjdGlvbkJyb2tlclJlZ2lzdHJhdGlvblxuICogQHByb3BlcnR5IHtTaGFyZWRUcmFuc2FjdGlvbkJyb2tlcn0gYnJva2VyIC0gQXR0ZW1wdCBicm9rZXIgYW5kIGNvbm5lY3Rpb24gY29vcmRpbmF0b3IuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IGVudmlyb25tZW50UHVibGlzaGVkIC0gV2hldGhlciBjaGlsZC1wcm9jZXNzIGNvb3JkaW5hdGVzIHdlcmUgcHVibGlzaGVkLlxuICogQHByb3BlcnR5IHtzdHJpbmcgfCB1bmRlZmluZWR9IHByZXZpb3VzRW52aXJvbm1lbnQgLSBFbnZpcm9ubWVudCB2YWx1ZSB0byByZXN0b3JlIGFmdGVyIHB1YmxpY2F0aW9uLlxuICovXG4vKipcbiAqIFRyYW5zYWN0aW9uYWxUZW5hbnRSZWdpc3RyYXRpb24gdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IFRyYW5zYWN0aW9uYWxUZW5hbnRSZWdpc3RyYXRpb25cbiAqIEBwcm9wZXJ0eSB7UHJvbWlzZTx7Y29ubmVjdGlvbjogaW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWQsIGVycm9yOiBFcnJvciB8IHVuZGVmaW5lZH0+IHwgdW5kZWZpbmVkfSBbY2hlY2tvdXRQcm9taXNlXSAtIEF0dGVtcHQtb3duZWQgcGh5c2ljYWwgY2hlY2tvdXQgb3V0Y29tZS5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IGNvbm5lY3Rpb24gLSBBdHRlbXB0LW93bmVkIHBoeXNpY2FsIGNvbm5lY3Rpb24gb25jZSBjaGVja291dCByZXNvbHZlcy5cbiAqIEBwcm9wZXJ0eSB7UHJvbWlzZTx2b2lkPiB8IHVuZGVmaW5lZH0gW2NsZWFudXBQcm9taXNlXSAtIFNpbmdsZSBjbGVhbnVwIG9wZXJhdGlvbiBzaGFyZWQgYnkgZW1lcmdlbmN5IGFuZCBldmVudHVhbCBsaWZlY3ljbGUgY2xlYW51cC5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbiB8IHVuZGVmaW5lZH0gW2Rpc2NhcmRPbkNsZWFudXBdIC0gV2hldGhlciB0aW1lb3V0IGVtZXJnZW5jeSBjbGVhbnVwIG11c3QgcXVhcmFudGluZSB0aGlzIGNvbm5lY3Rpb24uXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4uL2RhdGFiYXNlL3Bvb2wvYmFzZS5qc1wiKS5kZWZhdWx0fSBwb29sIC0gT3duaW5nIGxvZ2ljYWwgcG9vbC5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gcmV2b2tlZCAtIFdoZXRoZXIgdGhpcyBhdHRlbXB0IG1heSBzdGlsbCBwdWJsaXNoIHRoZSBwaHlzaWNhbCByZWdpc3RyYXRpb24uXG4gKiBAcHJvcGVydHkge3N0cmluZ30gcmV1c2VLZXkgLSBSZXNvbHZlZCBwaHlzaWNhbCBjb25maWd1cmF0aW9uIGlkZW50aXR5LlxuICogQHByb3BlcnR5IHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9wb29sL2Jhc2UuanNcIikuVGVzdFNoYXJlZENvbm5lY3Rpb25SZWdpc3RyYXRpb24gfCB1bmRlZmluZWR9IHNoYXJlZFJlZ2lzdHJhdGlvbiAtIFBoeXNpY2FsLWtleSBzaGFyZWQgcmVnaXN0cmF0aW9uIG9uY2UgcHVibGlzaGVkLlxuICovXG5cbmNvbnN0IHRlc3RpbmdQYWNrYWdlRGlyZWN0b3J5ID0gcGF0aC5kaXJuYW1lKGZpbGVVUkxUb1BhdGgoaW1wb3J0Lm1ldGEucmVzb2x2ZShcIkB2ZWxvY2lvdXMvdGVzdGluZy9wYWNrYWdlLmpzb25cIikpKVxuXG4vKipcbiAqIFJ1bnMgdG8gZmlsZSBzbHVnLlxuICogQHBhcmFtIHtzdHJpbmd9IHZhbHVlIC0gVmFsdWUgdG8gc2FuaXRpemUuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNsdWctc2FmZSB2YWx1ZS5cbiAqL1xuZnVuY3Rpb24gdG9GaWxlU2x1Zyh2YWx1ZSkge1xuICByZXR1cm4gdmFsdWVcbiAgICAudG9Mb3dlckNhc2UoKVxuICAgIC5yZXBsYWNlKC9bXmEtejAtOV0rL2csIFwiLVwiKVxuICAgIC5yZXBsYWNlKC9eLSt8LSskL2csIFwiXCIpXG4gICAgLnNsaWNlKDAsIDgwKSB8fCBcImZhaWxlZC10ZXN0XCJcbn1cblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVGVzdFJ1bm5lciB7XG4gIC8qKiBAdHlwZSB7UGFja2FnZVRlc3RDb250ZXh0fSAqL1xuICBfY29udGV4dFxuXG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAqIEB0eXBlIHtGYWlsZWRUZXN0RGV0YWlsW119ICovXG4gIF9mYWlsZWRUZXN0RGV0YWlsc1xuXG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gYXJncy5jb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtQYWNrYWdlVGVzdENvbnRleHR9IFthcmdzLmNvbnRleHRdIC0gRGVjbGFyYXRpb24gY29udGV4dC5cbiAgICogQHBhcmFtIHtzdHJpbmdbXSB8IHN0cmluZ30gW2FyZ3MuZXhjbHVkZVRhZ3NdIC0gVGFncyB0byBleGNsdWRlLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdIHwgc3RyaW5nfSBbYXJncy5pbmNsdWRlVGFnc10gLSBUYWdzIHRvIGluY2x1ZGUuXG4gICAqIEBwYXJhbSB7QXJyYXk8c3RyaW5nPn0gYXJncy50ZXN0RmlsZXMgLSBUZXN0IGZpbGVzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIG51bWJlcltdPn0gW2FyZ3MubGluZUZpbHRlcnNdIC0gTGluZSBmaWx0ZXJzIGJ5IGZpbGUuXG4gICAqIEBwYXJhbSB7UmVnRXhwW119IFthcmdzLmV4YW1wbGVQYXR0ZXJuc10gLSBFeGFtcGxlIHBhdHRlcm5zLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vdGVzdC1wcm9maWxlci5qc1wiKS5kZWZhdWx0fSBbYXJncy5wcm9maWxlcl0gLSBPcHQtaW4gcHJvZmlsZXIuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5yZXRyaWVzXSAtIERlZmF1bHQgcmV0cnkgY291bnQuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IFthcmdzLnNldHVwRmlsZXNdIC0gU2V0dXAgZmlsZXMgaW1wb3J0ZWQgYmVmb3JlIHRlc3QgZmlsZXMuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy50aW1lb3V0TXNdIC0gRGVmYXVsdCBsaWZlY3ljbGUgdGltZW91dC5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHtjb25maWd1cmF0aW9uLCBjb250ZXh0ID0gZGVmYXVsdFRlc3RDb250ZXh0LCBleGNsdWRlVGFncywgaW5jbHVkZVRhZ3MsIHRlc3RGaWxlcywgbGluZUZpbHRlcnMsIGV4YW1wbGVQYXR0ZXJucywgcHJvZmlsZXIsIHJldHJpZXMsIHNldHVwRmlsZXMsIHRpbWVvdXRNcywgLi4ucmVzdEFyZ3N9KSB7XG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcblxuICAgIGlmICghY29uZmlndXJhdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiY29uZmlndXJhdGlvbiBpcyByZXF1aXJlZFwiKVxuXG4gICAgdGhpcy5fY29uZmlndXJhdGlvbiA9IGNvbmZpZ3VyYXRpb25cbiAgICB0aGlzLl9jb250ZXh0ID0gY29udGV4dFxuICAgIHRoaXMuX3NoYXJlZFRyYW5zYWN0aW9uQ29vcmRpbmF0b3JPd25lclN0b3JhZ2UgPSBuZXcgQXN5bmNMb2NhbFN0b3JhZ2UoKVxuICAgIHRoaXMuX3Rlc3REYXRhYmFzZUFjY2Vzc1Njb3BlU3RvcmFnZSA9IG5ldyBBc3luY0xvY2FsU3RvcmFnZSgpXG4gICAgdGhpcy5fZXhjbHVkZVRhZ3MgPSB0aGlzLm5vcm1hbGl6ZVRhZ3MoZXhjbHVkZVRhZ3MpXG4gICAgdGhpcy5faW5jbHVkZVRhZ3MgPSB0aGlzLm5vcm1hbGl6ZVRhZ3MoaW5jbHVkZVRhZ3MpXG4gICAgdGhpcy5fdGVzdEZpbGVzID0gdGVzdEZpbGVzXG4gICAgdGhpcy5fbGluZUZpbHRlcnMgPSBsaW5lRmlsdGVycyB8fCB7fVxuICAgIHRoaXMuX2V4YW1wbGVQYXR0ZXJucyA9IGV4YW1wbGVQYXR0ZXJucyB8fCBbXVxuICAgIHRoaXMuX3Byb2ZpbGVyID0gcHJvZmlsZXJcbiAgICB0aGlzLl9yZXRyaWVzID0gcmV0cmllc1xuICAgIHRoaXMuX3NldHVwRmlsZXMgPSBzZXR1cEZpbGVzIHx8IFtdXG4gICAgdGhpcy5fdGltZW91dE1zID0gdGltZW91dE1zXG4gICAgdGhpcy5fYWJvcnRSZW1haW5pbmdUZXN0cyA9IGZhbHNlXG4gICAgLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCBUZXN0VGVuYW50RGF0YWJhc2VQb29sPn0gKi9cbiAgICB0aGlzLl90ZXN0VGVuYW50UG9vbHMgPSBuZXcgTWFwKClcbiAgICAvKiogQHR5cGUge1Byb21pc2U8dm9pZD4gfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5fdGVzdFRlbmFudFBvb2xUZWFyZG93blByb21pc2UgPSB1bmRlZmluZWRcblxuICAgIHRoaXMuX2ZhaWxlZFRlc3RzID0gMFxuICAgIHRoaXMuX3N1Y2Nlc3NmdWxUZXN0cyA9IDBcbiAgICB0aGlzLl90ZXN0c0NvdW50ID0gMFxuICAgIHRoaXMuX2ZhaWxlZFRlc3REZXRhaWxzID0gW11cbiAgICAvKiogQHR5cGUge2ltcG9ydChcIkB2ZWxvY2lvdXMvdGVzdGluZy9ydW5uZXJcIikuTm9uUnVuVGVzdFJlc3VsdFtdfSAqL1xuICAgIHRoaXMuX25vdFJ1blRlc3REZXRhaWxzID0gW11cbiAgICAvKiogQHR5cGUge3tmdWxsRGVzY3JpcHRpb246IHN0cmluZywgZmlsZVBhdGg6IHN0cmluZywgbGluZTogbnVtYmVyfSB8IG51bGx9ICovXG4gICAgdGhpcy5fbGFzdFRlc3RDb250ZXh0ID0gbnVsbFxuICAgIC8qKiBAdHlwZSB7QXJyYXk8e2Z1bGxEZXNjcmlwdGlvbjogc3RyaW5nLCBmaWxlUGF0aDogc3RyaW5nLCBsaW5lOiBudW1iZXIsIGR1cmF0aW9uTXM6IG51bWJlcn0+fSAqL1xuICAgIHRoaXMuX3Rlc3REdXJhdGlvbnMgPSBbXVxuICAgIC8qKiBAdHlwZSB7V2Vha01hcDxQYWNrYWdlVGVzdERlY2xhcmF0aW9uLCB7dGVzdEFyZ3M6IFRlc3RBcmdzLCB0ZXN0RGF0YTogVGVzdERhdGF9Pn0gKi9cbiAgICB0aGlzLl90ZXN0Q29tcGF0aWJpbGl0eSA9IG5ldyBXZWFrTWFwKClcbiAgICAvKiogQHR5cGUge1dlYWtTZXQ8UGFja2FnZVRlc3REZWNsYXJhdGlvbj59ICovXG4gICAgdGhpcy5faW5qZWN0ZWRUZXN0cyA9IG5ldyBXZWFrU2V0KClcbiAgICAvKiogQHR5cGUge1dlYWtTZXQ8UGFja2FnZVRlc3REZWNsYXJhdGlvbj59ICovXG4gICAgdGhpcy5fY29tcGxldGVkVGVzdHMgPSBuZXcgV2Vha1NldCgpXG4gICAgLyoqIEB0eXBlIHtXZWFrTWFwPFBhY2thZ2VUZXN0RGVjbGFyYXRpb24sIHtkZXNjcmlwdGlvbnM6IHN0cmluZ1tdLCB0ZXN0RGVzY3JpcHRpb246IHN0cmluZywgZnVsbERlc2NyaXB0aW9uOiBzdHJpbmcsIG93bmVyRmlsZVBhdGg6IHN0cmluZyB8IHVuZGVmaW5lZCwgc3VpdGVzOiBQYWNrYWdlU3VpdGVEZWNsYXJhdGlvbltdfT59ICovXG4gICAgdGhpcy5fdGVzdE1ldGFkYXRhID0gbmV3IFdlYWtNYXAoKVxuICAgIC8qKiBAdHlwZSB7V2Vha01hcDxQYWNrYWdlSG9va0RlY2xhcmF0aW9uLCB7ZGVjbGFyYXRpb25JbmRleDogbnVtYmVyLCBkZWNsYXJhdGlvblNjb3BlSWQ6IHN0cmluZyB8IHVuZGVmaW5lZCwgb3duZXJGaWxlUGF0aDogc3RyaW5nIHwgdW5kZWZpbmVkfT59ICovXG4gICAgdGhpcy5faG9va01ldGFkYXRhID0gbmV3IFdlYWtNYXAoKVxuICAgIC8qKiBAdHlwZSB7V2Vha01hcDxQYWNrYWdlVGVzdERlY2xhcmF0aW9uLCBNYXA8bnVtYmVyLCB7YWJvcnRSZW1haW5pbmdUZXN0czogYm9vbGVhbiwgZXJyb3I6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBmYWlsZWQ6IGJvb2xlYW59Pj59ICovXG4gICAgdGhpcy5fYXR0ZW1wdE91dGNvbWVzID0gbmV3IFdlYWtNYXAoKVxuICAgIC8qKiBAdHlwZSB7QXJyYXk8e3N1aXRlOiBQYWNrYWdlU3VpdGVEZWNsYXJhdGlvbiwgcGhhc2U6IFwiYmVmb3JlQWxsXCIgfCBcImFmdGVyQWxsXCIsIGVycm9yOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0+fSAqL1xuICAgIHRoaXMuX3N1aXRlSG9va0ZhaWx1cmVzID0gW11cbiAgICAvKiogQHR5cGUge01hcDxzdHJpbmcsIFBhY2thZ2VUZXN0RGVjbGFyYXRpb25bXT59ICovXG4gICAgdGhpcy5fdGVzdHNCeUZ1bGxOYW1lID0gbmV3IE1hcCgpXG4gICAgLyoqIEB0eXBlIHtXZWFrTWFwPFBhY2thZ2VSZWdpc3RyYXRpb24sIHN0cmluZz59ICovXG4gICAgdGhpcy5fZGVjbGFyYXRpb25Pd25lcnMgPSBuZXcgV2Vha01hcCgpXG4gICAgLyoqIEB0eXBlIHtQYWNrYWdlVGVzdFJ1bm5lciB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLl9wYWNrYWdlUnVubmVyID0gdW5kZWZpbmVkXG4gICAgLyoqIEB0eXBlIHtpbXBvcnQoXCJAdmVsb2Npb3VzL3Rlc3RpbmcvcnVubmVyXCIpLlRlc3RSdW5SZXN1bHQgfCB1bmRlZmluZWR9ICovXG4gICAgdGhpcy5fcGFja2FnZVJlc3VsdCA9IHVuZGVmaW5lZFxuICAgIC8qKiBAdHlwZSB7TWFwPHN0cmluZywgVGVzdERhdGE+IHwgdW5kZWZpbmVkfSAqL1xuICAgIHRoaXMuX2xlZ2FjeUZpeHR1cmVEYXRhQnlGdWxsTmFtZSA9IHVuZGVmaW5lZFxuICAgIC8qKiBAdHlwZSB7e2ZpbGVQYXRoPzogc3RyaW5nLCBsaW5lPzogbnVtYmVyfX0gKi9cbiAgICB0aGlzLl9sZWdhY3lGaXh0dXJlTG9jYXRpb24gPSB7fVxuICAgIHRoaXMuX2F0dGVtcHRFeGVjdXRvciA9IG5ldyBWZWxvY2lvdXNBdHRlbXB0RXhlY3V0b3Ioe3Rlc3RSdW5uZXI6IHRoaXN9KVxuICAgIHRoaXMuX3J1bm5lclJlcG9ydGVyID0gbmV3IFZlbG9jaW91c1J1bm5lclJlcG9ydGVyKHt0ZXN0UnVubmVyOiB0aGlzfSlcbiAgICB0aGlzLl9zdWl0ZUhvb2tFeGVjdXRvciA9IG5ldyBWZWxvY2lvdXNTdWl0ZUhvb2tFeGVjdXRvcih7dGVzdFJ1bm5lcjogdGhpc30pXG4gICAgdGhpcy5fdGVzdEFyZ3VtZW50cyA9IG5ldyBWZWxvY2lvdXNUZXN0QXJndW1lbnRzKHt0ZXN0UnVubmVyOiB0aGlzfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXRzIHRoZSBwYWNrYWdlIGRlY2xhcmF0aW9uIGNvbnRleHQuXG4gICAqIEByZXR1cm5zIHtQYWNrYWdlVGVzdENvbnRleHR9IC0gUGFja2FnZSBkZWNsYXJhdGlvbiBjb250ZXh0LlxuICAgKi9cbiAgZ2V0VGVzdENvbnRleHQoKSB7IHJldHVybiB0aGlzLl9jb250ZXh0IH1cblxuICAvKipcbiAgICogUnVucyBnZXQgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gLSBUaGUgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIGdldENvbmZpZ3VyYXRpb24oKSB7IHJldHVybiB0aGlzLl9jb25maWd1cmF0aW9uIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdGVzdCBmaWxlcy5cbiAgICogQHJldHVybnMge3N0cmluZ1tdfSAtIFRoZSB0ZXN0IGZpbGVzLlxuICAgKi9cbiAgZ2V0VGVzdEZpbGVzKCkgeyByZXR1cm4gdGhpcy5fdGVzdEZpbGVzIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgbGluZSBmaWx0ZXJzLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgbnVtYmVyW10+fSAtIExpbmUgZmlsdGVycy5cbiAgICovXG4gIGdldExpbmVGaWx0ZXJzKCkgeyByZXR1cm4gdGhpcy5fbGluZUZpbHRlcnMgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBleGFtcGxlIHBhdHRlcm5zLlxuICAgKiBAcmV0dXJucyB7UmVnRXhwW119IC0gRXhhbXBsZSBwYXR0ZXJucy5cbiAgICovXG4gIGdldEV4YW1wbGVQYXR0ZXJucygpIHsgcmV0dXJuIHRoaXMuX2V4YW1wbGVQYXR0ZXJucyB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYSBwcm9maWxlciBzcGFuIG9ubHkgd2hlbiBwcm9maWxpbmcgd2FzIGV4cGxpY2l0bHkgZW5hYmxlZC5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHtvYmplY3R9IG1ldGFkYXRhIC0gU3BhbiBtZXRhZGF0YS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG1ldGFkYXRhLnBoYXNlIC0gUGhhc2UgbmFtZS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFttZXRhZGF0YS5kZWNsYXJhdGlvbkluZGV4XSAtIEhvb2sgZGVjbGFyYXRpb24gaW5kZXguXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbbWV0YWRhdGEuZGVjbGFyYXRpb25TY29wZUlkXSAtIEhvb2sgZGVjbGFyYXRpb24gc2NvcGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbbWV0YWRhdGEuZmlsZVBhdGhdIC0gU291cmNlIG93bmVyc2hpcC5cbiAgICogQHBhcmFtIHsoKSA9PiAoVCB8IFByb21pc2U8VD4pfSBjYWxsYmFjayAtIFRpbWVkIGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBDYWxsYmFjayByZXN1bHQuXG4gICAqL1xuICBhc3luYyBydW5Qcm9maWxlU3BhbihtZXRhZGF0YSwgY2FsbGJhY2spIHtcbiAgICBpZiAoIXRoaXMuX3Byb2ZpbGVyKSByZXR1cm4gYXdhaXQgY2FsbGJhY2soKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX3Byb2ZpbGVyLnJ1blNwYW4obWV0YWRhdGEsIGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIHRhZ3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nW10gfCBzdHJpbmcgfCB1bmRlZmluZWR9IHRhZ3MgLSBUYWdzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nW119IC0gTm9ybWFsaXplZCB0YWdzLlxuICAgKi9cbiAgbm9ybWFsaXplVGFncyh0YWdzKSB7XG4gICAgaWYgKCF0YWdzKSByZXR1cm4gW11cblxuICAgIGNvbnN0IHZhbHVlcyA9IFtdXG4gICAgY29uc3QgcmF3VGFncyA9IEFycmF5LmlzQXJyYXkodGFncykgPyB0YWdzIDogW3RhZ3NdXG5cbiAgICBmb3IgKGNvbnN0IHJhd1RhZyBvZiByYXdUYWdzKSB7XG4gICAgICBpZiAocmF3VGFnID09PSB1bmRlZmluZWQgfHwgcmF3VGFnID09PSBudWxsKSBjb250aW51ZVxuXG4gICAgICBjb25zdCBwYXJ0cyA9IFN0cmluZyhyYXdUYWcpLnNwbGl0KFwiLFwiKVxuXG4gICAgICBmb3IgKGNvbnN0IHBhcnQgb2YgcGFydHMpIHtcbiAgICAgICAgY29uc3QgdHJpbW1lZCA9IHBhcnQudHJpbSgpXG5cbiAgICAgICAgaWYgKHRyaW1tZWQpIHZhbHVlcy5wdXNoKHRyaW1tZWQpXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIEFycmF5LmZyb20obmV3IFNldCh2YWx1ZXMpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFzIHRhZy5cbiAgICogQHBhcmFtIHtUZXN0QXJnc30gdGVzdEFyZ3MgLSBUZXN0IGFyZ3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0YWcgLSBUYWcgdG8gY2hlY2sgZm9yLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRhZyBpcyBwcmVzZW50LlxuICAgKi9cbiAgaGFzVGFnKHRlc3RBcmdzLCB0YWcpIHtcbiAgICByZXR1cm4gdGhpcy5ub3JtYWxpemVUYWdzKHRlc3RBcmdzPy50YWdzKS5pbmNsdWRlcyh0YWcpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyBicm93c2VyIHRlc3QgbW9kZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBydW5uaW5nIGJyb3dzZXIgdGVzdHMuXG4gICAqL1xuICBpc0Jyb3dzZXJUZXN0TW9kZSgpIHtcbiAgICByZXR1cm4gcHJvY2Vzcy5lbnYuVkVMT0NJT1VTX0JST1dTRVJfVEVTVFMgPT09IFwidHJ1ZVwiXG4gIH1cblxuICAvKipcbiAgICogUnVucyBydW4gd2l0aCBkdW1teSBpZiBuZWVkZWQuXG4gICAqIEBwYXJhbSB7VGVzdEFyZ3N9IHRlc3RBcmdzIC0gVGVzdCBhcmdzLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8dm9pZD59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgdG8gcnVuLlxuICAgKiBAcGFyYW0ge0Jyb3dzZXJEdW1teUNvbm5lY3Rpb25SZWdpc3RyYXRpb25bXX0gW2Jyb3dzZXJEdW1teUNvbm5lY3Rpb25SZWdpc3RyYXRpb25zXSAtIEF0dGVtcHQtb3duZWQgYnJvd3NlciBjb25uZWN0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHJ1bldpdGhEdW1teUlmTmVlZGVkKHRlc3RBcmdzLCBjYWxsYmFjaywgYnJvd3NlckR1bW15Q29ubmVjdGlvblJlZ2lzdHJhdGlvbnMgPSBbXSkge1xuICAgIGlmICghdGhpcy5oYXNUYWcodGVzdEFyZ3MsIFwiZHVtbXlcIikpIHtcbiAgICAgIGF3YWl0IGNhbGxiYWNrKClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmICh0aGlzLmlzQnJvd3NlclRlc3RNb2RlKCkpIHtcbiAgICAgIGF3YWl0IHRoaXMucnVuQnJvd3NlckR1bW15KHRlc3RBcmdzLCBjYWxsYmFjaywgYnJvd3NlckR1bW15Q29ubmVjdGlvblJlZ2lzdHJhdGlvbnMpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnJ1bk5vZGVEdW1teShjYWxsYmFjaylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1biBub2RlIGR1bW15LlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8dm9pZD59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgdG8gcnVuLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgcnVuTm9kZUR1bW15KGNhbGxiYWNrKSB7XG4gICAgY29uc3QgZHVtbXlQYXRoID0gcHJvY2Vzcy5lbnYuVkVMT0NJT1VTX0RVTU1ZX1BBVEggfHwgdGhpcy5kZWZhdWx0RHVtbXlQYXRoKClcbiAgICBjb25zdCBkdW1teUltcG9ydCA9IGF3YWl0IGltcG9ydChwYXRoVG9GaWxlVVJMKGR1bW15UGF0aCkuaHJlZilcbiAgICBjb25zdCBEdW1teSA9IGR1bW15SW1wb3J0LmRlZmF1bHRcblxuICAgIGlmICghRHVtbXk/LnJ1bikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBEdW1teSBoZWxwZXIgbm90IGZvdW5kIGF0ICR7ZHVtbXlQYXRofWApXG4gICAgfVxuXG4gICAgLy8gUGVyc2lzdGVudCBzZXJ2ZXIgcmVzb3VyY2VzIG11c3Qgbm90IGluaGVyaXQgYW4gYXR0ZW1wdCBzY29wZSB0aGF0IHdpbGwgYmUgcmV2b2tlZC5cbiAgICBhd2FpdCB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5ydW5XaXRoQ2FwdHVyZWRUZXN0RGF0YWJhc2VBY2Nlc3NTY29wZSh1bmRlZmluZWQsIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IER1bW15LnJ1bihhc3luYyAoKSA9PiB7fSlcbiAgICB9KVxuICAgIHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmFzc2VydERhdGFiYXNlQWNjZXNzQWxsb3dlZCgpXG4gICAgYXdhaXQgY2FsbGJhY2soKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVmYXVsdCBkdW1teSBwYXRoLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIERlZmF1bHQgZHVtbXkgaGVscGVyIHBhdGguXG4gICAqL1xuICBkZWZhdWx0RHVtbXlQYXRoKCkge1xuICAgIGNvbnN0IGN3ZCA9IHBhdGgucmVzb2x2ZShwcm9jZXNzLmN3ZCgpKVxuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSBjd2Quc3BsaXQocGF0aC5zZXApLmpvaW4oXCIvXCIpXG5cbiAgICBpZiAobm9ybWFsaXplZC5lbmRzV2l0aChcIi9zcGVjL2R1bW15XCIpKSB7XG4gICAgICByZXR1cm4gcGF0aC5qb2luKGN3ZCwgXCJpbmRleC5qc1wiKVxuICAgIH1cblxuICAgIHJldHVybiBwYXRoLmpvaW4oY3dkLCBcInNwZWMvZHVtbXkvaW5kZXguanNcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1biBicm93c2VyIGR1bW15LlxuICAgKiBAcGFyYW0ge1Rlc3RBcmdzfSB0ZXN0QXJncyAtIFRlc3QgYXJncy5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPHZvaWQ+fSBjYWxsYmFjayAtIENhbGxiYWNrIHRvIHJ1bi5cbiAgICogQHBhcmFtIHtCcm93c2VyRHVtbXlDb25uZWN0aW9uUmVnaXN0cmF0aW9uW119IGNvbm5lY3Rpb25SZWdpc3RyYXRpb25zIC0gQXR0ZW1wdC1vd25lZCBicm93c2VyIGNvbm5lY3Rpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgcnVuQnJvd3NlckR1bW15KHRlc3RBcmdzLCBjYWxsYmFjaywgY29ubmVjdGlvblJlZ2lzdHJhdGlvbnMpIHtcbiAgICBjb25zdCB1c2VUcmFuc2FjdGlvbiA9IHRlc3RBcmdzLmRhdGFiYXNlQ2xlYW5pbmc/LnRyYW5zYWN0aW9uID09PSB0cnVlXG4gICAgY29uc3QgdHJ1bmNhdGUgPSB0ZXN0QXJncy5kYXRhYmFzZUNsZWFuaW5nPy50cnVuY2F0ZVxuICAgIGNvbnN0IHNob3VsZFRydW5jYXRlID0gdHJ1bmNhdGUgPT09IHVuZGVmaW5lZCA/ICF1c2VUcmFuc2FjdGlvbiA6IHRydW5jYXRlXG5cbiAgICBpZiAoIXVzZVRyYW5zYWN0aW9uICYmICFzaG91bGRUcnVuY2F0ZSkge1xuICAgICAgYXdhaXQgY2FsbGJhY2soKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZW5zdXJlQ29ubmVjdGlvbnMoe25hbWU6IFwiVGVzdCBydW5uZXIgYnJvd3NlciBkdW1teVwifSwgYXN5bmMgKGRicykgPT4ge1xuICAgICAgY29uc3QgbmV3UmVnaXN0cmF0aW9ucyA9IE9iamVjdC5lbnRyaWVzKGRicykubWFwKChbZGF0YWJhc2VJZGVudGlmaWVyLCBkYl0pID0+IHtcbiAgICAgICAgLyoqIEB0eXBlIHtCcm93c2VyRHVtbXlDb25uZWN0aW9uUmVnaXN0cmF0aW9ufSAqL1xuICAgICAgICBjb25zdCByZWdpc3RyYXRpb24gPSB7XG4gICAgICAgICAgZGF0YWJhc2VJZGVudGlmaWVyLFxuICAgICAgICAgIGRiLFxuICAgICAgICAgIHF1YXJhbnRpbmVkOiBmYWxzZVxuICAgICAgICB9XG5cbiAgICAgICAgY29ubmVjdGlvblJlZ2lzdHJhdGlvbnMucHVzaChyZWdpc3RyYXRpb24pXG5cbiAgICAgICAgcmV0dXJuIHJlZ2lzdHJhdGlvblxuICAgICAgfSlcblxuICAgICAgaWYgKHNob3VsZFRydW5jYXRlKSB7XG4gICAgICAgIHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmFzc2VydERhdGFiYXNlQWNjZXNzQWxsb3dlZCgpXG4gICAgICAgIGF3YWl0IHRoaXMudHJ1bmNhdGVEYXRhYmFzZXMoZGJzKVxuICAgICAgfVxuICAgICAgLyoqIEB0eXBlIHt1bmtub3duW119ICovXG4gICAgICBjb25zdCBsaWZlY3ljbGVFcnJvcnMgPSBbXVxuXG4gICAgICB0cnkge1xuICAgICAgICBpZiAodXNlVHJhbnNhY3Rpb24pIHtcbiAgICAgICAgICBjb25zdCBzdGFydFByb21pc2VzID0gbmV3UmVnaXN0cmF0aW9ucy5tYXAoKHJlZ2lzdHJhdGlvbikgPT4ge1xuICAgICAgICAgICAgY29uc3Qgc3RhcnRQcm9taXNlID0gcmVnaXN0cmF0aW9uLmRiLnN0YXJ0VHJhbnNhY3Rpb24oKVxuXG4gICAgICAgICAgICByZWdpc3RyYXRpb24uc3RhcnRQcm9taXNlID0gc3RhcnRQcm9taXNlXG4gICAgICAgICAgICByZXR1cm4gc3RhcnRQcm9taXNlXG4gICAgICAgICAgfSlcbiAgICAgICAgICBjb25zdCBzdGFydFJlc3VsdHMgPSBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQoc3RhcnRQcm9taXNlcylcbiAgICAgICAgICBjb25zdCBzdGFydEVycm9ycyA9IHN0YXJ0UmVzdWx0c1xuICAgICAgICAgICAgLmZpbHRlcigocmVzdWx0KSA9PiByZXN1bHQuc3RhdHVzID09PSBcInJlamVjdGVkXCIpXG4gICAgICAgICAgICAubWFwKChyZXN1bHQpID0+IHJlc3VsdC5yZWFzb24pXG5cbiAgICAgICAgICBpZiAoc3RhcnRFcnJvcnMubGVuZ3RoID09IDEpIHRocm93IHN0YXJ0RXJyb3JzWzBdXG4gICAgICAgICAgaWYgKHN0YXJ0RXJyb3JzLmxlbmd0aCA+IDEpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihzdGFydEVycm9ycywgXCJCcm93c2VyIGR1bW15IHRyYW5zYWN0aW9uIHN0YXJ0dXAgZmFpbGVkXCIsIHtjYXVzZTogc3RhcnRFcnJvcnNbMF19KVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmFzc2VydERhdGFiYXNlQWNjZXNzQWxsb3dlZCgpXG4gICAgICAgIGF3YWl0IGNhbGxiYWNrKClcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGxpZmVjeWNsZUVycm9ycy5wdXNoKGVycm9yKVxuICAgICAgfVxuXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLnJvbGxiYWNrQnJvd3NlckR1bW15VHJhbnNhY3Rpb25zKGNvbm5lY3Rpb25SZWdpc3RyYXRpb25zKVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgQWdncmVnYXRlRXJyb3IpIHtcbiAgICAgICAgICBsaWZlY3ljbGVFcnJvcnMucHVzaCguLi5lcnJvci5lcnJvcnMpXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgbGlmZWN5Y2xlRXJyb3JzLnB1c2goZXJyb3IpXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgdHJ5IHtcbiAgICAgICAgaWYgKHNob3VsZFRydW5jYXRlKSB7XG4gICAgICAgICAgdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuYXNzZXJ0RGF0YWJhc2VBY2Nlc3NBbGxvd2VkKClcbiAgICAgICAgICBhd2FpdCB0aGlzLnRydW5jYXRlRGF0YWJhc2VzKGRicylcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgbGlmZWN5Y2xlRXJyb3JzLnB1c2goZXJyb3IpXG4gICAgICB9XG5cbiAgICAgIGlmIChsaWZlY3ljbGVFcnJvcnMubGVuZ3RoID09IDEpIHRocm93IGxpZmVjeWNsZUVycm9yc1swXVxuICAgICAgaWYgKGxpZmVjeWNsZUVycm9ycy5sZW5ndGggPiAxKSB7XG4gICAgICAgIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihsaWZlY3ljbGVFcnJvcnMsIFwiQnJvd3NlciBkdW1teSBsaWZlY3ljbGUgYW5kIGNsZWFudXAgZmFpbGVkXCIsIHtjYXVzZTogbGlmZWN5Y2xlRXJyb3JzWzBdfSlcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJvbGxzIGJhY2sgZXZlcnkgYXR0ZW1wdC1vd25lZCBicm93c2VyIHRyYW5zYWN0aW9uIGV4YWN0bHkgb25jZS5cbiAgICogQHBhcmFtIHtCcm93c2VyRHVtbXlDb25uZWN0aW9uUmVnaXN0cmF0aW9uW119IHJlZ2lzdHJhdGlvbnMgLSBCcm93c2VyIGNvbm5lY3Rpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyBhZnRlciBhbGwgcm9sbGJhY2tzIHNldHRsZS5cbiAgICovXG4gIGFzeW5jIHJvbGxiYWNrQnJvd3NlckR1bW15VHJhbnNhY3Rpb25zKHJlZ2lzdHJhdGlvbnMpIHtcbiAgICBjb25zdCByb2xsYmFja1Jlc3VsdHMgPSBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQoWy4uLnJlZ2lzdHJhdGlvbnNdLnJldmVyc2UoKS5tYXAoKHJlZ2lzdHJhdGlvbikgPT4ge1xuICAgICAgY29uc3Qgc3RhcnRQcm9taXNlID0gcmVnaXN0cmF0aW9uLnN0YXJ0UHJvbWlzZVxuXG4gICAgICBpZiAoIXN0YXJ0UHJvbWlzZSkgcmV0dXJuXG5cbiAgICAgIHJlZ2lzdHJhdGlvbi5yb2xsYmFja1Byb21pc2UgPz89IChhc3luYyAoKSA9PiB7XG4gICAgICAgIGlmIChyZWdpc3RyYXRpb24ucXVhcmFudGluZWQpIHJldHVyblxuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXdhaXQgc3RhcnRQcm9taXNlXG4gICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnF1YXJhbnRpbmVCcm93c2VyRHVtbXlDb25uZWN0aW9uKHJlZ2lzdHJhdGlvbilcbiAgICAgICAgICB9IGNhdGNoIChxdWFyYW50aW5lRXJyb3IpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRmFpbGVkIHRvIHF1YXJhbnRpbmUgYnJvd3NlciBkdW1teSBkYXRhYmFzZSBhZnRlciB0cmFuc2FjdGlvbiBzdGFydHVwIGZhaWxlZDogJHtyZWdpc3RyYXRpb24uZGF0YWJhc2VJZGVudGlmaWVyfWAsIHtjYXVzZTogcXVhcmFudGluZUVycm9yfSlcbiAgICAgICAgICB9XG4gICAgICAgICAgcmV0dXJuXG4gICAgICAgIH1cbiAgICAgICAgaWYgKHJlZ2lzdHJhdGlvbi5xdWFyYW50aW5lZCkgcmV0dXJuXG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBhd2FpdCByZWdpc3RyYXRpb24uZGIucm9sbGJhY2tUcmFuc2FjdGlvbigpXG4gICAgICAgIH0gY2F0Y2ggKHJvbGxiYWNrRXJyb3IpIHtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5xdWFyYW50aW5lQnJvd3NlckR1bW15Q29ubmVjdGlvbihyZWdpc3RyYXRpb24pXG4gICAgICAgICAgfSBjYXRjaCAocXVhcmFudGluZUVycm9yKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoXG4gICAgICAgICAgICAgIFtyb2xsYmFja0Vycm9yLCBxdWFyYW50aW5lRXJyb3JdLFxuICAgICAgICAgICAgICBgRmFpbGVkIHRvIHJvbGwgYmFjayBhbmQgcXVhcmFudGluZSBicm93c2VyIGR1bW15IGRhdGFiYXNlOiAke3JlZ2lzdHJhdGlvbi5kYXRhYmFzZUlkZW50aWZpZXJ9YCxcbiAgICAgICAgICAgICAge2NhdXNlOiBxdWFyYW50aW5lRXJyb3J9XG4gICAgICAgICAgICApXG4gICAgICAgICAgfVxuICAgICAgICAgIHRocm93IHJvbGxiYWNrRXJyb3JcbiAgICAgICAgfVxuICAgICAgfSkoKVxuXG4gICAgICByZXR1cm4gcmVnaXN0cmF0aW9uLnJvbGxiYWNrUHJvbWlzZVxuICAgIH0pKVxuICAgIGNvbnN0IGVycm9ycyA9IHJvbGxiYWNrUmVzdWx0c1xuICAgICAgLmZpbHRlcigocmVzdWx0KSA9PiByZXN1bHQuc3RhdHVzID09PSBcInJlamVjdGVkXCIpXG4gICAgICAubWFwKChyZXN1bHQpID0+IHJlc3VsdC5yZWFzb24pXG5cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA9PSAxKSB0aHJvdyBlcnJvcnNbMF1cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA+IDEpIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihlcnJvcnMsIFwiQnJvd3NlciBkdW1teSB0cmFuc2FjdGlvbiBjbGVhbnVwIGZhaWxlZFwiLCB7Y2F1c2U6IGVycm9yc1swXX0pXG4gIH1cblxuICAvKipcbiAgICogUGVybWFuZW50bHkgcmVtb3ZlcyBvbmUgYnJvd3NlciBjb25uZWN0aW9uIHRoYXQgY2Fubm90IGJlIHNoYXJlZCBzYWZlbHkuXG4gICAqIEBwYXJhbSB7QnJvd3NlckR1bW15Q29ubmVjdGlvblJlZ2lzdHJhdGlvbn0gcmVnaXN0cmF0aW9uIC0gQnJvd3NlciBjb25uZWN0aW9uIHJlZ2lzdHJhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgdGhlIGNvbm5lY3Rpb24gaXMgZGlzY2FyZGVkLlxuICAgKi9cbiAgYXN5bmMgcXVhcmFudGluZUJyb3dzZXJEdW1teUNvbm5lY3Rpb24ocmVnaXN0cmF0aW9uKSB7XG4gICAgcmVnaXN0cmF0aW9uLnF1YXJhbnRpbmVkID0gdHJ1ZVxuICAgIHJlZ2lzdHJhdGlvbi5xdWFyYW50aW5lUHJvbWlzZSA/Pz0gdGhpcy5kaXNjYXJkQnJvd3NlckR1bW15Q29ubmVjdGlvbihyZWdpc3RyYXRpb24uZGF0YWJhc2VJZGVudGlmaWVyLCByZWdpc3RyYXRpb24uZGIpXG4gICAgYXdhaXQgcmVnaXN0cmF0aW9uLnF1YXJhbnRpbmVQcm9taXNlXG4gIH1cblxuICAvKipcbiAgICogRGlzY2FyZHMgb25lIGJyb3dzZXIgZHVtbXkgY29ubmVjdGlvbiB0aHJvdWdoIGl0cyBvd25pbmcgcG9vbC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGRhdGFiYXNlSWRlbnRpZmllciAtIENvbmZpZ3VyZWQgZGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gZGIgLSBVbnNhZmUgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgZGlzY2FyZC5cbiAgICovXG4gIGFzeW5jIGRpc2NhcmRCcm93c2VyRHVtbXlDb25uZWN0aW9uKGRhdGFiYXNlSWRlbnRpZmllciwgZGIpIHtcbiAgICBhd2FpdCB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXREYXRhYmFzZVBvb2woZGF0YWJhc2VJZGVudGlmaWVyKS5kaXNjYXJkKGRiKVxuICB9XG5cbiAgLyoqXG4gICAqIFF1YXJhbnRpbmVzIGFsbCBicm93c2VyIGNvbm5lY3Rpb25zIGNvbmN1cnJlbnRseS5cbiAgICogQHBhcmFtIHtCcm93c2VyRHVtbXlDb25uZWN0aW9uUmVnaXN0cmF0aW9uW119IHJlZ2lzdHJhdGlvbnMgLSBCcm93c2VyIGNvbm5lY3Rpb24gcmVnaXN0cmF0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgZXZlcnkgY29ubmVjdGlvbiBpcyBkaXNjYXJkZWQuXG4gICAqL1xuICBhc3luYyBxdWFyYW50aW5lQnJvd3NlckR1bW15Q29ubmVjdGlvbnMocmVnaXN0cmF0aW9ucykge1xuICAgIGNvbnN0IHF1YXJhbnRpbmVSZXN1bHRzID0gYXdhaXQgUHJvbWlzZS5hbGxTZXR0bGVkKHJlZ2lzdHJhdGlvbnMubWFwKGFzeW5jIChyZWdpc3RyYXRpb24pID0+IHtcbiAgICAgIGF3YWl0IHRoaXMucXVhcmFudGluZUJyb3dzZXJEdW1teUNvbm5lY3Rpb24ocmVnaXN0cmF0aW9uKVxuICAgIH0pKVxuICAgIGNvbnN0IGVycm9ycyA9IHF1YXJhbnRpbmVSZXN1bHRzXG4gICAgICAuZmlsdGVyKChyZXN1bHQpID0+IHJlc3VsdC5zdGF0dXMgPT09IFwicmVqZWN0ZWRcIilcbiAgICAgIC5tYXAoKHJlc3VsdCkgPT4gcmVzdWx0LnJlYXNvbilcblxuICAgIGlmIChlcnJvcnMubGVuZ3RoID09IDEpIHRocm93IGVycm9yc1swXVxuICAgIGlmIChlcnJvcnMubGVuZ3RoID4gMSkgdGhyb3cgbmV3IEFnZ3JlZ2F0ZUVycm9yKGVycm9ycywgXCJCcm93c2VyIGR1bW15IGNvbm5lY3Rpb24gcXVhcmFudGluZSBmYWlsZWRcIiwge2NhdXNlOiBlcnJvcnNbMF19KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdHJ1bmNhdGUgZGF0YWJhc2VzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0Pn0gZGJzIC0gRGF0YWJhc2UgY29ubmVjdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyB0cnVuY2F0ZURhdGFiYXNlcyhkYnMpIHtcbiAgICBmb3IgKGNvbnN0IGlkZW50aWZpZXIgb2YgT2JqZWN0LmtleXMoZGJzKSkge1xuICAgICAgYXdhaXQgZGJzW2lkZW50aWZpZXJdLnRydW5jYXRlQWxsVGFibGVzKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZXhjbHVkZSB0YWcgc2V0LlxuICAgKiBAcmV0dXJucyB7U2V0PHN0cmluZz59IC0gRXhjbHVkZSB0YWcgc2V0LlxuICAgKi9cbiAgZ2V0RXhjbHVkZVRhZ1NldCgpIHtcbiAgICAvKipcbiAgICAgKiBDb25maWcgdGFncy5cbiAgICAgKiBAdHlwZSB7c3RyaW5nW119ICovXG4gICAgY29uc3QgY29uZmlnVGFncyA9IEFycmF5LmlzQXJyYXkodGVzdENvbmZpZy5leGNsdWRlVGFncykgPyB0ZXN0Q29uZmlnLmV4Y2x1ZGVUYWdzIDogW11cblxuICAgIHJldHVybiBuZXcgU2V0KFsuLi50aGlzLl9leGNsdWRlVGFncywgLi4uY29uZmlnVGFnc10pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBidWlsZCBmdWxsIGRlc2NyaXB0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBkZXNjcmlwdGlvbnMgLSBEZXNjcmlwdGlvbiBzdGFjay5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRlc3REZXNjcmlwdGlvbiAtIFRlc3QgZGVzY3JpcHRpb24uXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gRnVsbCBkZXNjcmlwdGlvbi5cbiAgICovXG4gIGJ1aWxkRnVsbERlc2NyaXB0aW9uKGRlc2NyaXB0aW9ucywgdGVzdERlc2NyaXB0aW9uKSB7XG4gICAgY29uc3QgcGFydHMgPSBkZXNjcmlwdGlvbnMuY29uY2F0KFt0ZXN0RGVzY3JpcHRpb25dKVxuXG4gICAgcmV0dXJuIHBhcnRzLmpvaW4oXCIgXCIpLnRyaW0oKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXBwbGljYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFwcGxpY2F0aW9uPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBhcHBsaWNhdGlvbi5cbiAgICovXG4gIGFzeW5jIGFwcGxpY2F0aW9uKCkge1xuICAgIGlmICghdGhpcy5fYXBwbGljYXRpb24pIHtcbiAgICAgIHRoaXMuX2FwcGxpY2F0aW9uID0gbmV3IEFwcGxpY2F0aW9uKHtcbiAgICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5nZXRDb25maWd1cmF0aW9uKCksXG4gICAgICAgIC8vIFJ1biByZXF1ZXN0IGhhbmRsZXJzIGluIHRoZSBtYWluIHRocmVhZCAobm90IHdvcmtlciB0aHJlYWRzKSBzbyB0aGV5XG4gICAgICAgIC8vIHJlc29sdmUgREIgd29yayB0byB0aGUgcGVyLXRlc3Qgc2hhcmVkIGNvbm5lY3Rpb24gc2V0IGJ5XG4gICAgICAgIC8vIHtAbGluayBhY3RpdmF0ZVRlc3RTaGFyZWRDb25uZWN0aW9uc30uIFRoaXMgbGV0cyByZXF1ZXN0LXR5cGUgc3BlY3MgdXNlXG4gICAgICAgIC8vIHRyYW5zYWN0aW9uLWJhc2VkIGNsZWFuaW5nICh0aGVpciB3cml0ZXMgbGFuZCBpbnNpZGUgdGhlIHRlc3Qnc1xuICAgICAgICAvLyB0cmFuc2FjdGlvbiBhbmQgcm9sbCBiYWNrKSBpbnN0ZWFkIG9mIHRydW5jYXRpbmcgZXZlcnkgdGFibGUuXG4gICAgICAgIGh0dHBTZXJ2ZXI6IHtpblByb2Nlc3M6IHRydWUsIHBvcnQ6IDMxMDA2fSxcbiAgICAgICAgdHlwZTogXCJ0ZXN0LXJ1bm5lclwiXG4gICAgICB9KVxuXG4gICAgICBhd2FpdCB0aGlzLl9hcHBsaWNhdGlvbi5pbml0aWFsaXplKClcbiAgICAgIGF3YWl0IHRoaXMuX2FwcGxpY2F0aW9uLnN0YXJ0SHR0cFNlcnZlcigpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2FwcGxpY2F0aW9uXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIHBvb2wgaWRlbnRpZmllciB3aGVuIGV4YWN0bHkgb25lIGB0ZXN0VGVuYW50UG9vbHNgIGVudHJ5IGlzXG4gICAqIGNvbmZpZ3VyZWQsIHNvIGBhY3F1aXJlVGVzdFRlbmFudCgpYCBjYW4gb21pdCBpdC4gQW1iaWd1b3VzIG9yIG1pc3NpbmdcbiAgICogY29uZmlndXJhdGlvbiBmYWlscyBsb3VkbHkgaW5zdGVhZCBvZiBndWVzc2luZy5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgc2luZ2xlIGNvbmZpZ3VyZWQgcG9vbCBpZGVudGlmaWVyLlxuICAgKi9cbiAgc2luZ2xlVGVzdFRlbmFudFBvb2xJZGVudGlmaWVyKCkge1xuICAgIGNvbnN0IGlkZW50aWZpZXJzID0gT2JqZWN0LmtleXModGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZ2V0VGVzdFRlbmFudFBvb2xzKCkgfHwge30pXG5cbiAgICBpZiAoaWRlbnRpZmllcnMubGVuZ3RoID09PSAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJhY3F1aXJlVGVzdFRlbmFudCByZXF1aXJlcyBhIGRhdGFiYXNlSWRlbnRpZmllciB3aGVuIG5vIHRlc3RUZW5hbnRQb29scyBjb25maWd1cmF0aW9uIGlzIHByZXNlbnRcIilcbiAgICB9XG4gICAgaWYgKGlkZW50aWZpZXJzLmxlbmd0aCA+IDEpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgYWNxdWlyZVRlc3RUZW5hbnQgcmVxdWlyZXMgYSBkYXRhYmFzZUlkZW50aWZpZXIgd2hlbiBtdWx0aXBsZSB0ZXN0VGVuYW50UG9vbHMgYXJlIGNvbmZpZ3VyZWQ6ICR7aWRlbnRpZmllcnMuam9pbihcIiwgXCIpfWApXG4gICAgfVxuXG4gICAgcmV0dXJuIGlkZW50aWZpZXJzWzBdXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgdGVzdCB0ZW5hbnQgZGF0YWJhc2UgcG9vbCBmb3Igb25lIGNvbmZpZ3VyZWQgYHRlc3RUZW5hbnRQb29sc2BcbiAgICogaWRlbnRpZmllciwgY3JlYXRpbmcgaXQgb24gZmlyc3QgdXNlLiBUaHJvd3Mgd2hlbiB0aGUgaWRlbnRpZmllciBoYXMgbm8gcG9vbFxuICAgKiBjb25maWd1cmF0aW9uIOKAlCB0aGUgcG9vbCBzdGF5cyBzdHJpY3RseSBvcHQtaW4uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBkYXRhYmFzZUlkZW50aWZpZXIgLSBUZW5hbnQgZGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICogQHJldHVybnMge1Rlc3RUZW5hbnREYXRhYmFzZVBvb2x9IC0gVGhlIHJ1bm5lci1vd25lZCBwb29sLlxuICAgKi9cbiAgZ2V0VGVzdFRlbmFudFBvb2woZGF0YWJhc2VJZGVudGlmaWVyKSB7XG4gICAgY29uc3QgZXhpc3RpbmdQb29sID0gdGhpcy5fdGVzdFRlbmFudFBvb2xzLmdldChkYXRhYmFzZUlkZW50aWZpZXIpXG5cbiAgICBpZiAoZXhpc3RpbmdQb29sKSByZXR1cm4gZXhpc3RpbmdQb29sXG5cbiAgICBjb25zdCBwb29sQ29uZmlndXJhdGlvbiA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldFRlc3RUZW5hbnRQb29scygpPy5bZGF0YWJhc2VJZGVudGlmaWVyXVxuXG4gICAgaWYgKCFwb29sQ29uZmlndXJhdGlvbikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyB0ZXN0VGVuYW50UG9vbHMgY29uZmlndXJhdGlvbiBmb3IgZGF0YWJhc2UgaWRlbnRpZmllcjogJHtkYXRhYmFzZUlkZW50aWZpZXJ9YClcbiAgICB9XG5cbiAgICBjb25zdCBwb29sID0gbmV3IFRlc3RUZW5hbnREYXRhYmFzZVBvb2woe1xuICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5nZXRDb25maWd1cmF0aW9uKCksXG4gICAgICBkYXRhYmFzZUlkZW50aWZpZXIsXG4gICAgICBwb29sQ29uZmlndXJhdGlvblxuICAgIH0pXG4gICAgdGhpcy5fdGVzdFRlbmFudFBvb2xzLnNldChkYXRhYmFzZUlkZW50aWZpZXIsIHBvb2wpXG5cbiAgICByZXR1cm4gcG9vbFxuICB9XG5cbiAgLyoqXG4gICAqIFRlYXJzIGRvd24gZXZlcnkgdGVzdCB0ZW5hbnQgZGF0YWJhc2UgcG9vbCBjcmVhdGVkIGR1cmluZyB0aGlzIHJ1biwgZXhhY3RseSBvbmNlLlxuICAgKiBTYWZlIHRvIGNhbGwgZnJvbSBhZnRlckFsbC1zdHlsZSB0ZWFyZG93biBhbmQgZnJvbSB0aGUgcnVubmVyJ3Mgb3duIGNsZWFudXA7IHRoZVxuICAgKiBzYW1lIHByb21pc2UgaXMgc2hhcmVkIGJ5IGNvbmN1cnJlbnQgY2FsbGVycy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgYWxsIHBvb2xzIGRyb3BwZWQgdGhlaXIgZGF0YWJhc2VzLlxuICAgKi9cbiAgdGVhcmRvd25UZXN0VGVuYW50UG9vbHMoKSB7XG4gICAgdGhpcy5fdGVzdFRlbmFudFBvb2xUZWFyZG93blByb21pc2UgPz89IChhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBwb29scyA9IFsuLi50aGlzLl90ZXN0VGVuYW50UG9vbHMudmFsdWVzKCldXG4gICAgICB0aGlzLl90ZXN0VGVuYW50UG9vbHMuY2xlYXIoKVxuXG4gICAgICBjb25zdCBlcnJvcnMgPSBbXVxuXG4gICAgICBmb3IgKGNvbnN0IHBvb2wgb2YgcG9vbHMpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBhd2FpdCBwb29sLnRlYXJkb3duKClcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICBlcnJvcnMucHVzaChlcnJvcilcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBpZiAoZXJyb3JzLmxlbmd0aCA9PT0gMSkgdGhyb3cgZXJyb3JzWzBdXG4gICAgICBpZiAoZXJyb3JzLmxlbmd0aCA+IDEpIHRocm93IG5ldyBBZ2dyZWdhdGVFcnJvcihlcnJvcnMsIFwiRmFpbGVkIHRvIHRlYXIgZG93biB0ZXN0IHRlbmFudCBkYXRhYmFzZSBwb29sc1wiKVxuICAgIH0pKClcblxuICAgIHJldHVybiB0aGlzLl90ZXN0VGVuYW50UG9vbFRlYXJkb3duUHJvbWlzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyBlYWNoIG5vbi10ZW5hbnQgcGVyLXRlc3QgY29ubmVjdGlvbiBhcyBhIGR5bmFtaWMgY2FuZGlkYXRlIGZvciBpbi1wcm9jZXNzXG4gICAqIHJlcXVlc3Qgc2hhcmluZy4gVGhlIHBvb2wgZXZhbHVhdGVzIHRyYW5zYWN0aW9uIHN0YXRlIHdoZW4gZWFjaCByZXF1ZXN0IGlzIGRpc3BhdGNoZWQsXG4gICAqIHNvIGEgdHJhbnNhY3Rpb24gc3RhcnRlZCBvciBlbmRlZCBkdXJpbmcgYSBob29rIGNhbGxiYWNrIHRha2VzIGVmZmVjdCBpbW1lZGlhdGVseS5cbiAgICogSW5hY3RpdmUgYW5kIHRlbmFudC1vbmx5IGNvbm5lY3Rpb25zIHJlbWFpbiBpbmRlcGVuZGVudGx5IHBvb2xlZC4gUGFpciB3aXRoXG4gICAqIHtAbGluayBjbGVhclRlc3RTaGFyZWRDb25uZWN0aW9uc30gaW4gYSBmaW5hbGx5LlxuICAgKiBAcmV0dXJucyB7e3Bvb2w6IGltcG9ydChcIi4uL2RhdGFiYXNlL3Bvb2wvYmFzZS5qc1wiKS5kZWZhdWx0LCByZWdpc3RyYXRpb246IGltcG9ydChcIi4uL2RhdGFiYXNlL3Bvb2wvYmFzZS5qc1wiKS5UZXN0U2hhcmVkQ29ubmVjdGlvblJlZ2lzdHJhdGlvbn1bXX0gLSBMaWZlY3ljbGUtb3duZWQgcmVnaXN0cmF0aW9ucy5cbiAgICovXG4gIGFjdGl2YXRlVGVzdFNoYXJlZENvbm5lY3Rpb25zKCkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKVxuICAgIGNvbnN0IGN1cnJlbnRDb25uZWN0aW9ucyA9IGNvbmZpZ3VyYXRpb24uZ2V0Q3VycmVudENvbm5lY3Rpb25zKClcbiAgICAvKiogQHR5cGUge3twb29sOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9wb29sL2Jhc2UuanNcIikuZGVmYXVsdCwgcmVnaXN0cmF0aW9uOiBpbXBvcnQoXCIuLi9kYXRhYmFzZS9wb29sL2Jhc2UuanNcIikuVGVzdFNoYXJlZENvbm5lY3Rpb25SZWdpc3RyYXRpb259W119ICovXG4gICAgY29uc3QgcmVnaXN0cmF0aW9ucyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IGlkZW50aWZpZXIgb2YgT2JqZWN0LmtleXMoY3VycmVudENvbm5lY3Rpb25zKSkge1xuICAgICAgY29uc3QgcG9vbCA9IGNvbmZpZ3VyYXRpb24uZ2V0RGF0YWJhc2VQb29sKGlkZW50aWZpZXIpXG5cbiAgICAgIC8vIFRlbmFudC1zY29wZWQgcG9vbHMgcmVzb2x2ZSBhIGRpZmZlcmVudCBjb25uZWN0aW9uIHBlciByZXF1ZXN0IHRlbmFudFxuICAgICAgLy8gKHZpYSBydW5XaXRoVGVuYW50KSwgc28gZm9yY2luZyBhIHNpbmdsZSBzaGFyZWQgY29ubmVjdGlvbiB3b3VsZCBicmVha1xuICAgICAgLy8gcGVyLXJlcXVlc3QgdGVuYW50IHJlc29sdXRpb24uIE9ubHkgc2hhcmUgbm9uLXRlbmFudCBwb29sczsgdGhlIHRlbmFudFxuICAgICAgLy8gcG9vbCBrZWVwcyByZXNvbHZpbmcgaXRzIG93biBjb25uZWN0aW9uIHBlciByZXF1ZXN0LlxuICAgICAgaWYgKHBvb2wuZ2V0Q29uZmlndXJhdGlvbigpLnRlbmFudE9ubHkpIHtcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgY29uc3QgY29ubmVjdGlvbiA9IGN1cnJlbnRDb25uZWN0aW9uc1tpZGVudGlmaWVyXVxuXG4gICAgICBjb25zdCByZWdpc3RyYXRpb24gPSBwb29sLnNldFRlc3RTaGFyZWRDb25uZWN0aW9uUHJvdmlkZXIoKCkgPT4ge1xuICAgICAgICByZXR1cm4gY29ubmVjdGlvbi5pbnNpZGVUcmFuc2FjdGlvbigpID8gY29ubmVjdGlvbiA6IHVuZGVmaW5lZFxuICAgICAgfSlcblxuICAgICAgaWYgKHJlZ2lzdHJhdGlvbikgcmVnaXN0cmF0aW9ucy5wdXNoKHtwb29sLCByZWdpc3RyYXRpb259KVxuICAgIH1cblxuICAgIHJldHVybiByZWdpc3RyYXRpb25zXG4gIH1cblxuICAvKipcbiAgICogQ2xlYXJzIHRoZSBpbi1wcm9jZXNzIHRlc3Qgc2hhcmVkIGNvbm5lY3Rpb24gb24gZXZlcnkgY29uZmlndXJlZCBwb29sLiBJZGVtcG90ZW50IGFuZFxuICAgKiBzYWZlIHRvIGNhbGwgd2hlbiBub25lIHdhcyBzZXQuXG4gICAqIEBwYXJhbSB7e3Bvb2w6IGltcG9ydChcIi4uL2RhdGFiYXNlL3Bvb2wvYmFzZS5qc1wiKS5kZWZhdWx0LCByZWdpc3RyYXRpb246IGltcG9ydChcIi4uL2RhdGFiYXNlL3Bvb2wvYmFzZS5qc1wiKS5UZXN0U2hhcmVkQ29ubmVjdGlvblJlZ2lzdHJhdGlvbn1bXX0gW3JlZ2lzdHJhdGlvbnNdIC0gTGlmZWN5Y2xlLW93bmVkIHJlZ2lzdHJhdGlvbnMgdG8gY2xlYXIgY29uZGl0aW9uYWxseS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBjbGVhclRlc3RTaGFyZWRDb25uZWN0aW9ucyhyZWdpc3RyYXRpb25zKSB7XG4gICAgaWYgKHJlZ2lzdHJhdGlvbnMpIHtcbiAgICAgIGZvciAoY29uc3Qge3Bvb2wsIHJlZ2lzdHJhdGlvbn0gb2YgcmVnaXN0cmF0aW9ucykge1xuICAgICAgICBwb29sLmNsZWFyVGVzdFNoYXJlZENvbm5lY3Rpb24ocmVnaXN0cmF0aW9uKVxuICAgICAgfVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpXG5cbiAgICBmb3IgKGNvbnN0IGlkZW50aWZpZXIgb2YgY29uZmlndXJhdGlvbi5nZXREYXRhYmFzZUlkZW50aWZpZXJzKCkpIHtcbiAgICAgIGNvbmZpZ3VyYXRpb24uZ2V0RGF0YWJhc2VQb29sKGlkZW50aWZpZXIpLmNsZWFyVGVzdFNoYXJlZENvbm5lY3Rpb24oKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVja3Mgb3V0IGFuZCByZWdpc3RlcnMgb25lIHBoeXNpY2FsIHRlbmFudCB0cmFuc2FjdGlvbiBmb3IgdGhlIGN1cnJlbnQgYXR0ZW1wdC5cbiAgICogQHBhcmFtIHt7ZGF0YWJhc2VJZGVudGlmaWVyOiBzdHJpbmcsIHRlbmFudDogb2JqZWN0fX0gYXJncyAtIExvZ2ljYWwgaWRlbnRpZmllciBhbmQgdGVuYW50IGRlc2NyaXB0b3IuXG4gICAqIEBwYXJhbSB7VHJhbnNhY3Rpb25hbFRlbmFudFJlZ2lzdHJhdGlvbltdfSByZWdpc3RyYXRpb25zIC0gQ3VycmVudCBhdHRlbXB0IHJlZ2lzdHJhdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgcmVnaXN0ZXJUcmFuc2FjdGlvbmFsVGVuYW50KHtkYXRhYmFzZUlkZW50aWZpZXIsIHRlbmFudCwgLi4ucmVzdEFyZ3N9LCByZWdpc3RyYXRpb25zKSB7XG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcbiAgICBpZiAoIWRhdGFiYXNlSWRlbnRpZmllcikgdGhyb3cgbmV3IEVycm9yKFwicmVnaXN0ZXJUcmFuc2FjdGlvbmFsVGVuYW50IHJlcXVpcmVzIGEgZGF0YWJhc2VJZGVudGlmaWVyXCIpXG4gICAgaWYgKCF0ZW5hbnQpIHRocm93IG5ldyBFcnJvcihcInJlZ2lzdGVyVHJhbnNhY3Rpb25hbFRlbmFudCByZXF1aXJlcyBhIHRlbmFudFwiKVxuXG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpXG4gICAgY29uc3QgcG9vbCA9IGNvbmZpZ3VyYXRpb24uZ2V0RGF0YWJhc2VQb29sKGRhdGFiYXNlSWRlbnRpZmllcilcbiAgICBjb25zdCBkYXRhYmFzZUNvbmZpZ3VyYXRpb24gPSBjb25maWd1cmF0aW9uLnJlc29sdmVEYXRhYmFzZUNvbmZpZ3VyYXRpb24oZGF0YWJhc2VJZGVudGlmaWVyLCB0ZW5hbnQpXG4gICAgaWYgKCFkYXRhYmFzZUNvbmZpZ3VyYXRpb24udGVuYW50T25seSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGByZWdpc3RlclRyYW5zYWN0aW9uYWxUZW5hbnQgcmVxdWlyZXMgYSB0ZW5hbnRPbmx5IGRhdGFiYXNlOiAke2RhdGFiYXNlSWRlbnRpZmllcn1gKVxuICAgIH1cbiAgICBjb25zdCByZXVzZUtleSA9IHBvb2wuZ2V0Q29uZmlndXJhdGlvblJldXNlS2V5KGRhdGFiYXNlQ29uZmlndXJhdGlvbilcbiAgICBpZiAocmVnaXN0cmF0aW9ucy5zb21lKChyZWdpc3RyYXRpb24pID0+IHJlZ2lzdHJhdGlvbi5wb29sID09PSBwb29sICYmIHJlZ2lzdHJhdGlvbi5yZXVzZUtleSA9PT0gcmV1c2VLZXkpKSByZXR1cm5cblxuICAgIC8qKiBAdHlwZSB7VHJhbnNhY3Rpb25hbFRlbmFudFJlZ2lzdHJhdGlvbn0gKi9cbiAgICBjb25zdCByZWdpc3RyYXRpb24gPSB7XG4gICAgICBjb25uZWN0aW9uOiB1bmRlZmluZWQsXG4gICAgICBwb29sLFxuICAgICAgcmV1c2VLZXksXG4gICAgICByZXZva2VkOiBmYWxzZSxcbiAgICAgIHNoYXJlZFJlZ2lzdHJhdGlvbjogdW5kZWZpbmVkXG4gICAgfVxuXG4gICAgcmVnaXN0cmF0aW9ucy5wdXNoKHJlZ2lzdHJhdGlvbilcbiAgICByZWdpc3RyYXRpb24uY2hlY2tvdXRQcm9taXNlID0gcG9vbFxuICAgICAgLmNoZWNrb3V0Rm9yQ29uZmlndXJhdGlvbihkYXRhYmFzZUNvbmZpZ3VyYXRpb24sIHtuYW1lOiBcIlRyYW5zYWN0aW9uYWwgdGVuYW50IHRlc3QgcmVnaXN0cmF0aW9uXCJ9KVxuICAgICAgLnRoZW4oXG4gICAgICAgIChjb25uZWN0aW9uKSA9PiAoe2Nvbm5lY3Rpb24sIGVycm9yOiB1bmRlZmluZWR9KSxcbiAgICAgICAgKGVycm9yKSA9PiAoe1xuICAgICAgICAgIGNvbm5lY3Rpb246IHVuZGVmaW5lZCxcbiAgICAgICAgICBlcnJvcjogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFwiVHJhbnNhY3Rpb25hbCB0ZW5hbnQgY29ubmVjdGlvbiBjaGVja291dCBmYWlsZWRcIiwge2NhdXNlOiBlcnJvcn0pXG4gICAgICAgIH0pXG4gICAgICApXG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgY2hlY2tvdXRPdXRjb21lID0gYXdhaXQgcmVnaXN0cmF0aW9uLmNoZWNrb3V0UHJvbWlzZVxuXG4gICAgICBpZiAoY2hlY2tvdXRPdXRjb21lLmVycm9yKSB0aHJvdyBjaGVja291dE91dGNvbWUuZXJyb3JcbiAgICAgIGlmICghY2hlY2tvdXRPdXRjb21lLmNvbm5lY3Rpb24pIHRocm93IG5ldyBFcnJvcihcIlRyYW5zYWN0aW9uYWwgdGVuYW50IGNvbm5lY3Rpb24gY2hlY2tvdXQgcmV0dXJuZWQgbm8gY29ubmVjdGlvblwiKVxuICAgICAgcmVnaXN0cmF0aW9uLmNvbm5lY3Rpb24gPSBjaGVja291dE91dGNvbWUuY29ubmVjdGlvblxuICAgICAgaWYgKHJlZ2lzdHJhdGlvbi5yZXZva2VkKSB0aHJvdyBuZXcgRXJyb3IoXCJUcmFuc2FjdGlvbmFsIHRlbmFudCB0ZXN0IHJlZ2lzdHJhdGlvbiBhdHRlbXB0IGlzIG5vIGxvbmdlciBhY3RpdmVcIilcblxuICAgICAgYXdhaXQgcmVnaXN0cmF0aW9uLmNvbm5lY3Rpb24uc3RhcnRUcmFuc2FjdGlvbigpXG4gICAgICBpZiAocmVnaXN0cmF0aW9uLnJldm9rZWQpIHRocm93IG5ldyBFcnJvcihcIlRyYW5zYWN0aW9uYWwgdGVuYW50IHRlc3QgcmVnaXN0cmF0aW9uIGF0dGVtcHQgaXMgbm8gbG9uZ2VyIGFjdGl2ZVwiKVxuXG4gICAgICBjb25zdCBzaGFyZWRSZWdpc3RyYXRpb24gPSBwb29sLnNldFRlc3RTaGFyZWRDb25uZWN0aW9uRm9yQ29uZmlndXJhdGlvbihyZWdpc3RyYXRpb24uY29ubmVjdGlvbiwgcmV1c2VLZXkpXG4gICAgICBpZiAoIXNoYXJlZFJlZ2lzdHJhdGlvbikgdGhyb3cgbmV3IEVycm9yKGBEYXRhYmFzZSBwb29sIGRvZXMgbm90IHN1cHBvcnQgdHJhbnNhY3Rpb25hbCB0ZW5hbnQgdGVzdCBjb25uZWN0aW9uczogJHtkYXRhYmFzZUlkZW50aWZpZXJ9YClcbiAgICAgIHJlZ2lzdHJhdGlvbi5zaGFyZWRSZWdpc3RyYXRpb24gPSBzaGFyZWRSZWdpc3RyYXRpb25cbiAgICAgIGlmIChyZWdpc3RyYXRpb24ucmV2b2tlZCkge1xuICAgICAgICBwb29sLmNsZWFyVGVzdFNoYXJlZENvbm5lY3Rpb24oc2hhcmVkUmVnaXN0cmF0aW9uKVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJUcmFuc2FjdGlvbmFsIHRlbmFudCB0ZXN0IHJlZ2lzdHJhdGlvbiBhdHRlbXB0IGlzIG5vIGxvbmdlciBhY3RpdmVcIilcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgcmVnaXN0cmF0aW9uLnJldm9rZWQgPSB0cnVlXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLmNsZWFudXBUcmFuc2FjdGlvbmFsVGVuYW50cyhbcmVnaXN0cmF0aW9uXSwge2Rpc2NhcmQ6IHJlZ2lzdHJhdGlvbi5kaXNjYXJkT25DbGVhbnVwID09PSB0cnVlfSlcbiAgICAgIH0gY2F0Y2ggKGNsZWFudXBFcnJvcikge1xuICAgICAgICB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoW2Vycm9yLCBjbGVhbnVwRXJyb3JdLCBcIkZhaWxlZCB0byByZWdpc3RlciBhbmQgY2xlYW4gdXAgYSB0cmFuc2FjdGlvbmFsIHRlbmFudCB0ZXN0IGNvbm5lY3Rpb25cIiwge2NhdXNlOiBjbGVhbnVwRXJyb3J9KVxuICAgICAgfVxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmV2b2tlcyBhdHRlbXB0IHJlZ2lzdHJhdGlvbnMgYmVmb3JlIHJvbGxpbmcgYmFjayBhbmQgcmVsZWFzaW5nIHRoZWlyIGNvbm5lY3Rpb25zLlxuICAgKiBAcGFyYW0ge1RyYW5zYWN0aW9uYWxUZW5hbnRSZWdpc3RyYXRpb25bXX0gcmVnaXN0cmF0aW9ucyAtIEF0dGVtcHQgcmVnaXN0cmF0aW9ucy5cbiAgICogQHBhcmFtIHt7ZGlzY2FyZD86IGJvb2xlYW59fSBbb3B0aW9uc10gLSBXaGV0aGVyIGNvbm5lY3Rpb25zIG11c3QgYmUgZGlzY2FyZGVkIGluc3RlYWQgb2YgcmV0dXJuZWQgdG8gdGhlIHBvb2wuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgY2xlYW51cFRyYW5zYWN0aW9uYWxUZW5hbnRzKHJlZ2lzdHJhdGlvbnMsIHtkaXNjYXJkID0gZmFsc2V9ID0ge30pIHtcbiAgICBmb3IgKGNvbnN0IHJlZ2lzdHJhdGlvbiBvZiByZWdpc3RyYXRpb25zKSB7XG4gICAgICByZWdpc3RyYXRpb24ucmV2b2tlZCA9IHRydWVcbiAgICAgIGlmIChkaXNjYXJkKSByZWdpc3RyYXRpb24uZGlzY2FyZE9uQ2xlYW51cCA9IHRydWVcbiAgICAgIGlmIChyZWdpc3RyYXRpb24uc2hhcmVkUmVnaXN0cmF0aW9uKSByZWdpc3RyYXRpb24ucG9vbC5jbGVhclRlc3RTaGFyZWRDb25uZWN0aW9uKHJlZ2lzdHJhdGlvbi5zaGFyZWRSZWdpc3RyYXRpb24pXG4gICAgfVxuICAgIGNvbnN0IGNsZWFudXBSZXN1bHRzID0gYXdhaXQgUHJvbWlzZS5hbGxTZXR0bGVkKFsuLi5yZWdpc3RyYXRpb25zXS5yZXZlcnNlKCkubWFwKChyZWdpc3RyYXRpb24pID0+IHtcbiAgICAgIHJlZ2lzdHJhdGlvbi5jbGVhbnVwUHJvbWlzZSA/Pz0gdGhpcy5jbGVhbnVwVHJhbnNhY3Rpb25hbFRlbmFudFJlZ2lzdHJhdGlvbihyZWdpc3RyYXRpb24pXG5cbiAgICAgIHJldHVybiByZWdpc3RyYXRpb24uY2xlYW51cFByb21pc2VcbiAgICB9KSlcbiAgICBjb25zdCBlcnJvcnMgPSBjbGVhbnVwUmVzdWx0c1xuICAgICAgLmZpbHRlcigocmVzdWx0KSA9PiByZXN1bHQuc3RhdHVzID09PSBcInJlamVjdGVkXCIpXG4gICAgICAubWFwKChyZXN1bHQpID0+IHJlc3VsdC5yZWFzb24pXG5cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA9PT0gMSkgdGhyb3cgZXJyb3JzWzBdXG4gICAgaWYgKGVycm9ycy5sZW5ndGggPiAxKSB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoZXJyb3JzLCBcIkZhaWxlZCB0byBjbGVhbiB1cCB0cmFuc2FjdGlvbmFsIHRlbmFudCB0ZXN0IGNvbm5lY3Rpb25zXCIpXG4gIH1cblxuICAvKipcbiAgICogQ2xlYW5zIG9uZSBhdHRlbXB0IHJlZ2lzdHJhdGlvbiBleGFjdGx5IG9uY2UsIGluY2x1ZGluZyBhIGNoZWNrb3V0IHRoYXQgd2FzIHN0aWxsIHBlbmRpbmcgYXQgcmV2b2NhdGlvbi5cbiAgICogQHBhcmFtIHtUcmFuc2FjdGlvbmFsVGVuYW50UmVnaXN0cmF0aW9ufSByZWdpc3RyYXRpb24gLSBBdHRlbXB0LW93bmVkIHJlZ2lzdHJhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgYWZ0ZXIgcm9sbGJhY2sgYW5kIHJlbGVhc2Ugb3IgcXVhcmFudGluZS5cbiAgICovXG4gIGFzeW5jIGNsZWFudXBUcmFuc2FjdGlvbmFsVGVuYW50UmVnaXN0cmF0aW9uKHJlZ2lzdHJhdGlvbikge1xuICAgIGxldCBjb25uZWN0aW9uID0gcmVnaXN0cmF0aW9uLmNvbm5lY3Rpb25cblxuICAgIGlmICghY29ubmVjdGlvbiAmJiByZWdpc3RyYXRpb24uY2hlY2tvdXRQcm9taXNlKSB7XG4gICAgICBjb25zdCBjaGVja291dE91dGNvbWUgPSBhd2FpdCByZWdpc3RyYXRpb24uY2hlY2tvdXRQcm9taXNlXG5cbiAgICAgIGlmIChjaGVja291dE91dGNvbWUuZXJyb3IpIHJldHVyblxuICAgICAgY29ubmVjdGlvbiA9IGNoZWNrb3V0T3V0Y29tZS5jb25uZWN0aW9uXG4gICAgICByZWdpc3RyYXRpb24uY29ubmVjdGlvbiA9IGNvbm5lY3Rpb25cbiAgICB9XG4gICAgaWYgKCFjb25uZWN0aW9uKSByZXR1cm5cblxuICAgIGNvbnN0IGVycm9ycyA9IFtdXG5cbiAgICB0cnkge1xuICAgICAgaWYgKGNvbm5lY3Rpb24uaW5zaWRlVHJhbnNhY3Rpb24oKSkgYXdhaXQgY29ubmVjdGlvbi5yb2xsYmFja1RyYW5zYWN0aW9uKClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgZXJyb3JzLnB1c2goZXJyb3IpXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGlmIChyZWdpc3RyYXRpb24uZGlzY2FyZE9uQ2xlYW51cCkge1xuICAgICAgICAgIGF3YWl0IHJlZ2lzdHJhdGlvbi5wb29sLmRpc2NhcmQoY29ubmVjdGlvbilcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBhd2FpdCByZWdpc3RyYXRpb24ucG9vbC5jaGVja2luKGNvbm5lY3Rpb24pXG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGVycm9ycy5wdXNoKGVycm9yKVxuICAgICAgfVxuICAgIH1cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA9PT0gMSkgdGhyb3cgZXJyb3JzWzBdXG4gICAgaWYgKGVycm9ycy5sZW5ndGggPiAxKSB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoZXJyb3JzLCBcIkZhaWxlZCB0byBjbGVhbiB1cCBhIHRyYW5zYWN0aW9uYWwgdGVuYW50IHRlc3QgY29ubmVjdGlvblwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyBvbmUgdGVuYW50IGRhdGFiYXNlIGZvciBmcmFtZXdvcmstb3duZWQgZW5kLW9mLWF0dGVtcHQgY2xlYW51cC4gVGhlXG4gICAqIHJlZ2lzdHJhdGlvbiBkcm9wcyB0aGUgdGVuYW50J3MgZGF0YWJhc2UgdGhyb3VnaCB0aGUgcHJvdmlkZXIncyBgZHJvcERhdGFiYXNlYFxuICAgKiBob29rIChvciB0aGUgZnJhbWV3b3JrIGRlZmF1bHQpIGFmdGVyIHRoZSBhdHRlbXB0J3MgYWZ0ZXJFYWNoIGhvb2tzIGFuZFxuICAgKiB0cmFuc2FjdGlvbmFsIHRlbmFudCByb2xsYmFja3MgZmluaXNoZWQsIHNvIGNvbnN1bWluZyBhcHBzIGRvIG5vdCBoYW5kLXJvbGwgYVxuICAgKiBNYXAvYWZ0ZXJFYWNoIGJvb2trZWVwaW5nIGxheWVyIGZvciBEREwgdGhhdCBhIHRlc3QgdHJhbnNhY3Rpb24gY2Fubm90IHJvbGwgYmFjay5cbiAgICogQHBhcmFtIHt7ZGF0YWJhc2VJZGVudGlmaWVyOiBzdHJpbmcsIHRlbmFudDogb2JqZWN0fX0gYXJncyAtIFRlbmFudCBkYXRhYmFzZSBpZGVudGlmaWVyIGFuZCB0ZW5hbnQgZGVzY3JpcHRvciB0byBkcm9wIGF0IGF0dGVtcHQgZW5kLlxuICAgKiBAcGFyYW0ge1RlbmFudENsZWFudXBSZWdpc3RyYXRpb25bXX0gcmVnaXN0cmF0aW9ucyAtIEN1cnJlbnQgYXR0ZW1wdCByZWdpc3RyYXRpb25zLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICByZWdpc3RlclRlbmFudEZvckNsZWFudXAoe2RhdGFiYXNlSWRlbnRpZmllciwgdGVuYW50LCAuLi5yZXN0QXJnc30sIHJlZ2lzdHJhdGlvbnMpIHtcbiAgICByZXN0QXJnc0Vycm9yKHJlc3RBcmdzKVxuICAgIGlmICghZGF0YWJhc2VJZGVudGlmaWVyKSB0aHJvdyBuZXcgRXJyb3IoXCJyZWdpc3RlclRlbmFudEZvckNsZWFudXAgcmVxdWlyZXMgYSBkYXRhYmFzZUlkZW50aWZpZXJcIilcbiAgICBpZiAoIXRlbmFudCkgdGhyb3cgbmV3IEVycm9yKFwicmVnaXN0ZXJUZW5hbnRGb3JDbGVhbnVwIHJlcXVpcmVzIGEgdGVuYW50XCIpXG5cbiAgICBjb25zdCBkYXRhYmFzZUNvbmZpZ3VyYXRpb24gPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5yZXNvbHZlRGF0YWJhc2VDb25maWd1cmF0aW9uKGRhdGFiYXNlSWRlbnRpZmllciwgdGVuYW50KVxuXG4gICAgaWYgKCFkYXRhYmFzZUNvbmZpZ3VyYXRpb24udGVuYW50T25seSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGByZWdpc3RlclRlbmFudEZvckNsZWFudXAgcmVxdWlyZXMgYSB0ZW5hbnRPbmx5IGRhdGFiYXNlOiAke2RhdGFiYXNlSWRlbnRpZmllcn1gKVxuICAgIH1cblxuICAgIHJlZ2lzdHJhdGlvbnMucHVzaCh7ZGF0YWJhc2VJZGVudGlmaWVyLCB0ZW5hbnR9KVxuICB9XG5cbiAgLyoqXG4gICAqIERyb3BzIGV2ZXJ5IHRlbmFudCBkYXRhYmFzZSByZWdpc3RlcmVkIGZvciB0aGlzIGF0dGVtcHQsIGluIHJlZ2lzdHJhdGlvbiBvcmRlci5cbiAgICogRWFjaCBkcm9wIGlzIGF0dGVtcHRlZCBldmVuIHdoZW4gYW4gZWFybGllciBvbmUgZmFpbGVkOyBmYWlsdXJlcyBhcmUgc3VyZmFjZWRcbiAgICogKHNpbmdsZSBlcnJvciBvciBBZ2dyZWdhdGVFcnJvciksIG5ldmVyIHN3YWxsb3dlZC5cbiAgICogQHBhcmFtIHtUZW5hbnRDbGVhbnVwUmVnaXN0cmF0aW9uW119IHJlZ2lzdHJhdGlvbnMgLSBBdHRlbXB0LW93bmVkIHJlZ2lzdHJhdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGFsbCByZWdpc3RlcmVkIHRlbmFudHMgd2VyZSBkcm9wcGVkLlxuICAgKi9cbiAgYXN5bmMgY2xlYW51cFRlbmFudFJlZ2lzdHJhdGlvbnMocmVnaXN0cmF0aW9ucykge1xuICAgIGNvbnN0IGVycm9ycyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IHtkYXRhYmFzZUlkZW50aWZpZXIsIHRlbmFudH0gb2YgcmVnaXN0cmF0aW9ucykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgVGVuYW50LmRyb3Aoe2lkZW50aWZpZXI6IGRhdGFiYXNlSWRlbnRpZmllciwgdGVuYW50LCBjb25maWd1cmF0aW9uOiB0aGlzLmdldENvbmZpZ3VyYXRpb24oKX0pXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBlcnJvcnMucHVzaChlcnJvcilcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA9PT0gMSkgdGhyb3cgZXJyb3JzWzBdXG4gICAgaWYgKGVycm9ycy5sZW5ndGggPiAxKSB0aHJvdyBuZXcgQWdncmVnYXRlRXJyb3IoZXJyb3JzLCBcIkZhaWxlZCB0byBkcm9wIHRlbmFudCBkYXRhYmFzZXMgcmVnaXN0ZXJlZCBmb3IgY2xlYW51cFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFNlbGVjdHMgdGhlIGN1cnJlbnQgbm9uLXRlbmFudCBjb25uZWN0aW9ucyBlbGlnaWJsZSBmb3Igc2hhcmVkIHRyYW5zYWN0aW9uIHdvcmsuXG4gICAqIEBwYXJhbSB7e3RyYW5zYWN0aW9uc09ubHk6IGJvb2xlYW59fSBhcmdzIC0gU2VsZWN0aW9uIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9kYXRhYmFzZS9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdD59IC0gRWxpZ2libGUgY29ubmVjdGlvbnMgYnkgaWRlbnRpZmllci5cbiAgICovXG4gIHNoYXJlZFRyYW5zYWN0aW9uQ29ubmVjdGlvbnMoe3RyYW5zYWN0aW9uc09ubHl9KSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpXG4gICAgY29uc3QgY3VycmVudENvbm5lY3Rpb25zID0gY29uZmlndXJhdGlvbi5nZXRDdXJyZW50Q29ubmVjdGlvbnMoKVxuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQ+fSAqL1xuICAgIGNvbnN0IGNvbm5lY3Rpb25zID0ge31cblxuICAgIGZvciAoY29uc3QgW2lkZW50aWZpZXIsIGNvbm5lY3Rpb25dIG9mIE9iamVjdC5lbnRyaWVzKGN1cnJlbnRDb25uZWN0aW9ucykpIHtcbiAgICAgIGNvbnN0IHBvb2wgPSBjb25maWd1cmF0aW9uLmdldERhdGFiYXNlUG9vbChpZGVudGlmaWVyKVxuXG4gICAgICBpZiAocG9vbC5nZXRDb25maWd1cmF0aW9uKCkudGVuYW50T25seSkgY29udGludWVcbiAgICAgIGlmICh0cmFuc2FjdGlvbnNPbmx5ICYmICFjb25uZWN0aW9uLmluc2lkZVRyYW5zYWN0aW9uKCkpIGNvbnRpbnVlXG4gICAgICBjb25uZWN0aW9uc1tpZGVudGlmaWVyXSA9IGNvbm5lY3Rpb25cbiAgICB9XG5cbiAgICByZXR1cm4gY29ubmVjdGlvbnNcbiAgfVxuXG4gIC8qKlxuICAgKiBJbnN0YWxscyBwaHlzaWNhbC1jb25uZWN0aW9uIGNvb3JkaW5hdGlvbiBiZWZvcmUgYSB0cmFuc2FjdGlvbi1vcGVuaW5nIGhvb2tcbiAgICogY2FuIGV4cG9zZSB0aGUgc2hhcmVkIGNvbm5lY3Rpb24gdG8gYSBsb25nLWxpdmVkIGluLXByb2Nlc3Mgc2VydmljZS5cbiAgICogQ2hpbGQtcHJvY2VzcyBjb29yZGluYXRlcyByZW1haW4gdW5wdWJsaXNoZWQgdW50aWwgdGhlIHRyYW5zYWN0aW9uIGV4aXN0cy5cbiAgICogQHJldHVybnMge1Byb21pc2U8U2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJSZWdpc3RyYXRpb24gfCB1bmRlZmluZWQ+fSAtIFByZXBhcmVkIGNvb3JkaW5hdG9yLlxuICAgKi9cbiAgYXN5bmMgcHJlcGFyZVNoYXJlZFRyYW5zYWN0aW9uQnJva2VyKCkge1xuICAgIGNvbnN0IGNvbm5lY3Rpb25zID0gdGhpcy5zaGFyZWRUcmFuc2FjdGlvbkNvbm5lY3Rpb25zKHt0cmFuc2FjdGlvbnNPbmx5OiBmYWxzZX0pXG5cbiAgICBpZiAoT2JqZWN0LmtleXMoY29ubmVjdGlvbnMpLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHVuZGVmaW5lZFxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGJyb2tlcjogYXdhaXQgU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXIuc3RhcnQoe2Nvbm5lY3Rpb25zfSksXG4gICAgICBlbnZpcm9ubWVudFB1Ymxpc2hlZDogZmFsc2UsXG4gICAgICBwcmV2aW91c0Vudmlyb25tZW50OiB1bmRlZmluZWRcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ2hlY2tzIHdoZXRoZXIgYSBwcmVwYXJlZCBicm9rZXIgY29vcmRpbmF0ZXMgZXhhY3RseSB0aGUgc2VsZWN0ZWQgcGh5c2ljYWwgY29ubmVjdGlvbnMuXG4gICAqIEBwYXJhbSB7U2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJSZWdpc3RyYXRpb24gfCB1bmRlZmluZWR9IHJlZ2lzdHJhdGlvbiAtIFByZXBhcmVkIGNvb3JkaW5hdG9yLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2RhdGFiYXNlL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0Pn0gY29ubmVjdGlvbnMgLSBTZWxlY3RlZCBjb25uZWN0aW9ucy5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgaWRlbnRpZmllciBzZXQgYW5kIHBoeXNpY2FsIGNvbm5lY3Rpb25zIG1hdGNoIGV4YWN0bHkuXG4gICAqL1xuICBzaGFyZWRUcmFuc2FjdGlvbkJyb2tlck1hdGNoZXNDb25uZWN0aW9ucyhyZWdpc3RyYXRpb24sIGNvbm5lY3Rpb25zKSB7XG4gICAgY29uc3QgaWRlbnRpZmllcnMgPSBPYmplY3Qua2V5cyhjb25uZWN0aW9ucylcblxuICAgIGlmICghcmVnaXN0cmF0aW9uIHx8IGlkZW50aWZpZXJzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIGZhbHNlXG4gICAgaWYgKE9iamVjdC5rZXlzKHJlZ2lzdHJhdGlvbi5icm9rZXIuY29ubmVjdGlvbnMpLmxlbmd0aCAhPT0gaWRlbnRpZmllcnMubGVuZ3RoKSByZXR1cm4gZmFsc2VcblxuICAgIGZvciAoY29uc3QgW2lkZW50aWZpZXIsIGNvbm5lY3Rpb25dIG9mIE9iamVjdC5lbnRyaWVzKGNvbm5lY3Rpb25zKSkge1xuICAgICAgaWYgKHJlZ2lzdHJhdGlvbi5icm9rZXIuY29ubmVjdGlvbnNbaWRlbnRpZmllcl0gIT09IGNvbm5lY3Rpb24pIHJldHVybiBmYWxzZVxuICAgIH1cblxuICAgIHJldHVybiB0cnVlXG4gIH1cblxuICAvKipcbiAgICogU3RhcnRzIGEgY2FwYWJpbGl0eS1zY29wZWQgYnJva2VyIGZvciB0aGUgYWN0aXZlIG5vbi10ZW5hbnQgcGh5c2ljYWxcbiAgICogdHJhbnNhY3Rpb24gY29ubmVjdGlvbnMuIE5vIGJyb2tlci9lbnYgaXMgaW5zdGFsbGVkIGZvciB0cnVuY2F0aW9uLW9ubHkgb3JcbiAgICogb3RoZXIgdHJhbnNhY3Rpb24tZGlzYWJsZWQgYXR0ZW1wdHMuXG4gICAqIEBwYXJhbSB7U2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXJSZWdpc3RyYXRpb259IFtwcmVwYXJlZFJlZ2lzdHJhdGlvbl0gLSBDb29yZGluYXRvciBwcmVwYXJlZCBiZWZvcmUgaG9va3MuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vZGF0YWJhc2UvZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQ+fSBbc2VsZWN0ZWRDb25uZWN0aW9uc10gLSBQb3N0LWhvb2sgYWN0aXZlIGNvbm5lY3Rpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxTaGFyZWRUcmFuc2FjdGlvbkJyb2tlclJlZ2lzdHJhdGlvbiB8IHVuZGVmaW5lZD59IC0gQXR0ZW1wdCByZWdpc3RyYXRpb24uXG4gICAqL1xuICBhc3luYyBzdGFydFNoYXJlZFRyYW5zYWN0aW9uQnJva2VyKHByZXBhcmVkUmVnaXN0cmF0aW9uLCBzZWxlY3RlZENvbm5lY3Rpb25zKSB7XG4gICAgY29uc3QgY29ubmVjdGlvbnMgPSBzZWxlY3RlZENvbm5lY3Rpb25zIHx8IHRoaXMuc2hhcmVkVHJhbnNhY3Rpb25Db25uZWN0aW9ucyh7dHJhbnNhY3Rpb25zT25seTogdHJ1ZX0pXG5cbiAgICBjb25zdCBkYXRhYmFzZUlkZW50aWZpZXJzID0gT2JqZWN0LmtleXMoY29ubmVjdGlvbnMpXG4gICAgaWYgKGRhdGFiYXNlSWRlbnRpZmllcnMubGVuZ3RoID09PSAwKSB7XG4gICAgICBhd2FpdCB0aGlzLnN0b3BTaGFyZWRUcmFuc2FjdGlvbkJyb2tlcihwcmVwYXJlZFJlZ2lzdHJhdGlvbilcbiAgICAgIHJldHVybiB1bmRlZmluZWRcbiAgICB9XG5cbiAgICBsZXQgYnJva2VyXG5cbiAgICBpZiAocHJlcGFyZWRSZWdpc3RyYXRpb24gJiYgdGhpcy5zaGFyZWRUcmFuc2FjdGlvbkJyb2tlck1hdGNoZXNDb25uZWN0aW9ucyhwcmVwYXJlZFJlZ2lzdHJhdGlvbiwgY29ubmVjdGlvbnMpKSB7XG4gICAgICBicm9rZXIgPSBwcmVwYXJlZFJlZ2lzdHJhdGlvbi5icm9rZXJcbiAgICB9IGVsc2Uge1xuICAgICAgYXdhaXQgdGhpcy5zdG9wU2hhcmVkVHJhbnNhY3Rpb25Ccm9rZXIocHJlcGFyZWRSZWdpc3RyYXRpb24pXG4gICAgICBicm9rZXIgPSBhd2FpdCBTaGFyZWRUcmFuc2FjdGlvbkJyb2tlci5zdGFydCh7Y29ubmVjdGlvbnN9KVxuICAgIH1cblxuICAgIGNvbnN0IHByZXZpb3VzRW52aXJvbm1lbnQgPSBwcm9jZXNzLmVudltTSEFSRURfVFJBTlNBQ1RJT05fQlJPS0VSX0VOVl1cbiAgICBwcm9jZXNzLmVudltTSEFSRURfVFJBTlNBQ1RJT05fQlJPS0VSX0VOVl0gPSBCdWZmZXIuZnJvbShKU09OLnN0cmluZ2lmeSh7XG4gICAgICBhZGRyZXNzOiBicm9rZXIuYWRkcmVzcygpLFxuICAgICAgY2FwYWJpbGl0eTogYnJva2VyLmNhcGFiaWxpdHkoKSxcbiAgICAgIGRhdGFiYXNlSWRlbnRpZmllcnMsXG4gICAgICBleHBlY3RlZDogdHJ1ZVxuICAgIH0pKS50b1N0cmluZyhcImJhc2U2NHVybFwiKVxuXG4gICAgcmV0dXJuIHticm9rZXIsIGVudmlyb25tZW50UHVibGlzaGVkOiB0cnVlLCBwcmV2aW91c0Vudmlyb25tZW50fVxuICB9XG5cbiAgLyoqXG4gICAqIFJldm9rZXMgYW4gYXR0ZW1wdCBicm9rZXIgYmVmb3JlIGRhdGFiYXNlIHJvbGxiYWNrIGhvb2tzIHJ1biBhbmQgcmVzdG9yZXNcbiAgICogdGhlIGNhbGxlcidzIGVudmlyb25tZW50IHNvIGxhdGVyIHBvb2xlZC9zcGF3bmVkIGNoaWxkcmVuIGNhbm5vdCBpbmhlcml0IGl0LlxuICAgKiBAcGFyYW0ge1NoYXJlZFRyYW5zYWN0aW9uQnJva2VyUmVnaXN0cmF0aW9uIHwgdW5kZWZpbmVkfSByZWdpc3RyYXRpb24gLSBBdHRlbXB0IHJlZ2lzdHJhdGlvbi5cbiAgICovXG4gIGFzeW5jIHN0b3BTaGFyZWRUcmFuc2FjdGlvbkJyb2tlcihyZWdpc3RyYXRpb24pIHtcbiAgICBpZiAoIXJlZ2lzdHJhdGlvbikgcmV0dXJuXG5cbiAgICBpZiAocmVnaXN0cmF0aW9uLmVudmlyb25tZW50UHVibGlzaGVkKSB7XG4gICAgICBpZiAocmVnaXN0cmF0aW9uLnByZXZpb3VzRW52aXJvbm1lbnQgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICBkZWxldGUgcHJvY2Vzcy5lbnZbU0hBUkVEX1RSQU5TQUNUSU9OX0JST0tFUl9FTlZdXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBwcm9jZXNzLmVudltTSEFSRURfVFJBTlNBQ1RJT05fQlJPS0VSX0VOVl0gPSByZWdpc3RyYXRpb24ucHJldmlvdXNFbnZpcm9ubWVudFxuICAgICAgfVxuICAgIH1cbiAgICBhd2FpdCByZWdpc3RyYXRpb24uYnJva2VyLmNsb3NlKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlcXVlc3QgY2xpZW50LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXF1ZXN0Q2xpZW50Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSByZXF1ZXN0IGNsaWVudC5cbiAgICovXG4gIGFzeW5jIHJlcXVlc3RDbGllbnQoKSB7XG4gICAgaWYgKCF0aGlzLl9yZXF1ZXN0Q2xpZW50KSB7XG4gICAgICB0aGlzLl9yZXF1ZXN0Q2xpZW50ID0gbmV3IFJlcXVlc3RDbGllbnQoKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9yZXF1ZXN0Q2xpZW50XG4gIH1cblxuICAvKipcbiAgICogUnVucyBpbXBvcnQgdGVzdCBmaWxlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIGltcG9ydFRlc3RGaWxlcygpIHtcbiAgICBjb25zdCBlbnZpcm9ubWVudEhhbmRsZXIgPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKVxuXG4gICAgaWYgKCF0aGlzLl9wcm9maWxlcikge1xuICAgICAgYXdhaXQgZW52aXJvbm1lbnRIYW5kbGVyLmltcG9ydFRlc3RGaWxlcyh0aGlzLmdldFRlc3RGaWxlcygpKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCB0ZXN0RmlsZSBvZiB0aGlzLmdldFRlc3RGaWxlcygpKSB7XG4gICAgICBjb25zdCBleGlzdGluZ1JlZ2lzdHJhdGlvbnMgPSB0aGlzLnRlc3RSZWdpc3RyYXRpb25PYmplY3RzKClcblxuICAgICAgYXdhaXQgdGhpcy5fcHJvZmlsZXIubWVhc3VyZVBoYXNlKFwiaW1wb3J0c1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IGVudmlyb25tZW50SGFuZGxlci5pbXBvcnRUZXN0RmlsZXMoW3Rlc3RGaWxlXSlcbiAgICAgIH0sIHtmaWxlUGF0aDogdGVzdEZpbGV9KVxuICAgICAgdGhpcy5hc3NpZ25UZXN0UmVnaXN0cmF0aW9uT3duZXJzaGlwKGV4aXN0aW5nUmVnaXN0cmF0aW9ucywgdGVzdEZpbGUpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENvbGxlY3RzIHBhY2thZ2UgZGVjbGFyYXRpb24gb2JqZWN0cyBieSBpZGVudGl0eS5cbiAgICogQHBhcmFtIHtTZXQ8UGFja2FnZVJlZ2lzdHJhdGlvbj59IFtyZWdpc3RyYXRpb25zXSAtIEFjY3VtdWxhdGVkIGlkZW50aXRpZXMuXG4gICAqIEByZXR1cm5zIHtTZXQ8UGFja2FnZVJlZ2lzdHJhdGlvbj59IC0gUmVnaXN0cmF0aW9uIGlkZW50aXRpZXMuXG4gICAqL1xuICB0ZXN0UmVnaXN0cmF0aW9uT2JqZWN0cyhyZWdpc3RyYXRpb25zID0gbmV3IFNldCgpKSB7XG4gICAgY29uc3QgdmlzaXQgPSAoLyoqIEB0eXBlIHtQYWNrYWdlU3VpdGVEZWNsYXJhdGlvbn0gKi8gc3VpdGUpID0+IHtcbiAgICAgIHJlZ2lzdHJhdGlvbnMuYWRkKHN1aXRlKVxuICAgICAgZm9yIChjb25zdCBob29rIG9mIFsuLi5zdWl0ZS5ob29rcy5iZWZvcmVBbGwsIC4uLnN1aXRlLmhvb2tzLmJlZm9yZUVhY2gsIC4uLnN1aXRlLmhvb2tzLmFmdGVyRWFjaCwgLi4uc3VpdGUuaG9va3MuYWZ0ZXJBbGxdKSB7XG4gICAgICAgIHJlZ2lzdHJhdGlvbnMuYWRkKGhvb2spXG4gICAgICB9XG4gICAgICBmb3IgKGNvbnN0IHRlc3REZWNsYXJhdGlvbiBvZiBzdWl0ZS50ZXN0cykgcmVnaXN0cmF0aW9ucy5hZGQodGVzdERlY2xhcmF0aW9uKVxuICAgICAgZm9yIChjb25zdCBjaGlsZFN1aXRlIG9mIHN1aXRlLnN1aXRlcykgdmlzaXQoY2hpbGRTdWl0ZSlcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IHN1aXRlIG9mIHRoaXMuZ2V0VGVzdENvbnRleHQoKS5yZWdpc3RyeS5zdWl0ZXMpIHZpc2l0KHN1aXRlKVxuXG4gICAgcmV0dXJuIHJlZ2lzdHJhdGlvbnNcbiAgfVxuXG4gIC8qKlxuICAgKiBBc3NpZ25zIGRldGVybWluaXN0aWMgb3duZXJzaGlwIHRvIHBhY2thZ2UgZGVjbGFyYXRpb25zIGFkZGVkIGJ5IG9uZSBlbnRyeSBmaWxlLlxuICAgKiBAcGFyYW0ge1NldDxQYWNrYWdlUmVnaXN0cmF0aW9uPn0gcHJldmlvdXNSZWdpc3RyYXRpb25zIC0gSWRlbnRpdGllcyBwcmVzZW50IGJlZm9yZSBpbXBvcnQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBvd25lckZpbGVQYXRoIC0gSW1wb3J0aW5nIGVudHJ5IGZpbGUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgYXNzaWduVGVzdFJlZ2lzdHJhdGlvbk93bmVyc2hpcChwcmV2aW91c1JlZ2lzdHJhdGlvbnMsIG93bmVyRmlsZVBhdGgpIHtcbiAgICBmb3IgKGNvbnN0IHJlZ2lzdHJhdGlvbiBvZiB0aGlzLnRlc3RSZWdpc3RyYXRpb25PYmplY3RzKCkpIHtcbiAgICAgIGlmICghcHJldmlvdXNSZWdpc3RyYXRpb25zLmhhcyhyZWdpc3RyYXRpb24pKSB0aGlzLl9kZWNsYXJhdGlvbk93bmVycy5zZXQocmVnaXN0cmF0aW9uLCBvd25lckZpbGVQYXRoKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlzIGZhaWxlZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBmYWlsZWQuXG4gICAqL1xuICBpc0ZhaWxlZCgpIHsgcmV0dXJuIHRoaXMuX2ZhaWxlZFRlc3RzICE9PSB1bmRlZmluZWQgJiYgKHRoaXMuX2ZhaWxlZFRlc3RzID4gMCB8fCB0aGlzLl9wYWNrYWdlUmVzdWx0Py5zdGF0dXMgPT09IFwiZmFpbGVkXCIpIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZmFpbGVkIHRlc3RzLlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIFRoZSBmYWlsZWQgdGVzdHMuXG4gICAqL1xuICBnZXRGYWlsZWRUZXN0cygpIHtcbiAgICBpZiAodGhpcy5fZmFpbGVkVGVzdHMgPT09IHVuZGVmaW5lZCkgdGhyb3cgbmV3IEVycm9yKFwiVGVzdHMgaGFzbid0IGJlZW4gcnVuIHlldFwiKVxuXG4gICAgcmV0dXJuIHRoaXMuX2ZhaWxlZFRlc3RzXG4gIH1cblxuICAvKipcbiAgICogQ291bnRzIHNlbGVjdGVkIHRlc3RzIGJsb2NrZWQgYnkgYSB0ZXJtaW5hbCByZXNvdXJjZS5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBTZWxlY3RlZCB0ZXN0cyBub3QgZXhlY3V0ZWQgYmVjYXVzZSBhIHNoYXJlZCByZXNvdXJjZSBmYWlsZWQuXG4gICAqL1xuICBnZXROb3RSdW5UZXN0cygpIHsgcmV0dXJuIHRoaXMuX25vdFJ1blRlc3REZXRhaWxzLmxlbmd0aCB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgcnVudGltZSBub24tcnVuIGF0dHJpYnV0aW9uLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiQHZlbG9jaW91cy90ZXN0aW5nL3J1bm5lclwiKS5Ob25SdW5UZXN0UmVzdWx0W119IC0gUnVudGltZSBub24tcnVuIGRldGFpbHMgd2l0aCB0aGUgb3JpZ2luYXRpbmcgZmFpbHVyZS5cbiAgICovXG4gIGdldE5vdFJ1blRlc3REZXRhaWxzKCkgeyByZXR1cm4gdGhpcy5fbm90UnVuVGVzdERldGFpbHMgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmRzIGEgc2VsZWN0ZWQgdGVzdCB0aGF0IGRpZCBub3QgZXhlY3V0ZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJAdmVsb2Npb3VzL3Rlc3RpbmcvcnVubmVyXCIpLk5vblJ1blRlc3RSZXN1bHR9IHJlc3VsdCAtIFRlcm1pbmFsLXJlc291cmNlIG5vbi1ydW4gcmVjb3JkLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHJlY29yZE5vdFJ1blRlc3QocmVzdWx0KSB7IHRoaXMuX25vdFJ1blRlc3REZXRhaWxzLnB1c2gocmVzdWx0KSB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGZhaWxlZCB0ZXN0IGRldGFpbHMuXG4gICAqIEByZXR1cm5zIHtGYWlsZWRUZXN0RGV0YWlsW119IC0gRmFpbGVkIHRlc3QgZGV0YWlscy5cbiAgICovXG4gIGdldEZhaWxlZFRlc3REZXRhaWxzKCkge1xuICAgIHJldHVybiB0aGlzLl9mYWlsZWRUZXN0RGV0YWlsc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcGVyc2lzdCBmYWlsZWQgdGVzdCBjb25zb2xlIG91dHB1dHMgdG8gYXNzZXRzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbYXJncy5hc3NldHNQYXRoXSAtIEFzc2V0cyBkaXJlY3RvcnkgcGF0aC5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fSAtIFdyaXR0ZW4gbG9nIGZpbGUgcGF0aHMuXG4gICAqL1xuICBhc3luYyBwZXJzaXN0RmFpbGVkVGVzdENvbnNvbGVPdXRwdXRzVG9Bc3NldHMoe2Fzc2V0c1BhdGggPSBwYXRoLmpvaW4ocHJvY2Vzcy5jd2QoKSwgXCJ0bXAvc2NyZWVuc2hvdHNcIil9ID0ge30pIHtcbiAgICBjb25zdCBmYWlsZWRUZXN0RGV0YWlscyA9IHRoaXMuZ2V0RmFpbGVkVGVzdERldGFpbHMoKVxuICAgIGNvbnN0IHdyaXR0ZW5Mb2dQYXRocyA9IFtdXG4gICAgbGV0IGNyZWF0ZWREaXJlY3RvcnkgPSBmYWxzZVxuXG4gICAgZm9yIChsZXQgaW5kZXggPSAwOyBpbmRleCA8IGZhaWxlZFRlc3REZXRhaWxzLmxlbmd0aDsgaW5kZXgrKykge1xuICAgICAgY29uc3QgZmFpbGVkVGVzdERldGFpbCA9IGZhaWxlZFRlc3REZXRhaWxzW2luZGV4XVxuICAgICAgY29uc3QgY29uc29sZU91dHB1dCA9IGZhaWxlZFRlc3REZXRhaWwuY29uc29sZU91dHB1dFxuXG4gICAgICBpZiAoIWNvbnNvbGVPdXRwdXQpIGNvbnRpbnVlXG5cbiAgICAgIGlmICghY3JlYXRlZERpcmVjdG9yeSkge1xuICAgICAgICBhd2FpdCBmcy5ta2Rpcihhc3NldHNQYXRoLCB7cmVjdXJzaXZlOiB0cnVlfSlcbiAgICAgICAgY3JlYXRlZERpcmVjdG9yeSA9IHRydWVcbiAgICAgIH1cblxuICAgICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKVxuICAgICAgY29uc3QgdGltZXN0YW1wID0gW1xuICAgICAgICBTdHJpbmcobm93LmdldEZ1bGxZZWFyKCkpLFxuICAgICAgICBTdHJpbmcobm93LmdldE1vbnRoKCkgKyAxKS5wYWRTdGFydCgyLCBcIjBcIiksXG4gICAgICAgIFN0cmluZyhub3cuZ2V0RGF0ZSgpKS5wYWRTdGFydCgyLCBcIjBcIiksXG4gICAgICAgIFN0cmluZyhub3cuZ2V0SG91cnMoKSkucGFkU3RhcnQoMiwgXCIwXCIpLFxuICAgICAgICBTdHJpbmcobm93LmdldE1pbnV0ZXMoKSkucGFkU3RhcnQoMiwgXCIwXCIpLFxuICAgICAgICBTdHJpbmcobm93LmdldFNlY29uZHMoKSkucGFkU3RhcnQoMiwgXCIwXCIpLFxuICAgICAgICBTdHJpbmcobm93LmdldE1pbGxpc2Vjb25kcygpKS5wYWRTdGFydCgzLCBcIjBcIilcbiAgICAgIF0uam9pbihcIlwiKVxuICAgICAgY29uc3Qgc2x1ZyA9IHRvRmlsZVNsdWcoZmFpbGVkVGVzdERldGFpbC5mdWxsRGVzY3JpcHRpb24pXG4gICAgICBjb25zdCBmaWxlTmFtZSA9IGAke3RpbWVzdGFtcH0tJHtTdHJpbmcoaW5kZXggKyAxKS5wYWRTdGFydCgyLCBcIjBcIil9LSR7c2x1Z30uY29uc29sZS5sb2dgXG4gICAgICBjb25zdCBmaWxlUGF0aCA9IHBhdGguam9pbihhc3NldHNQYXRoLCBmaWxlTmFtZSlcblxuICAgICAgYXdhaXQgZnMud3JpdGVGaWxlKGZpbGVQYXRoLCBjb25zb2xlT3V0cHV0LCBcInV0ZjhcIilcbiAgICAgIGZhaWxlZFRlc3REZXRhaWwuY29uc29sZUxvZ1BhdGggPSBmaWxlUGF0aFxuICAgICAgd3JpdHRlbkxvZ1BhdGhzLnB1c2goZmlsZVBhdGgpXG4gICAgfVxuXG4gICAgcmV0dXJuIHdyaXR0ZW5Mb2dQYXRoc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHN1Y2Nlc3NmdWwgdGVzdHMuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gVGhlIHN1Y2Nlc3NmdWwgdGVzdHMuXG4gICAqL1xuICBnZXRTdWNjZXNzZnVsVGVzdHMoKSB7XG4gICAgaWYgKHRoaXMuX3N1Y2Nlc3NmdWxUZXN0cyA9PT0gdW5kZWZpbmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJUZXN0cyBoYXNuJ3QgYmVlbiBydW4geWV0XCIpXG5cbiAgICByZXR1cm4gdGhpcy5fc3VjY2Vzc2Z1bFRlc3RzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdGVzdHMgY291bnQuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gVGhlIHRlc3RzIGNvdW50LlxuICAgKi9cbiAgZ2V0VGVzdHNDb3VudCgpIHtcbiAgICBpZiAodGhpcy5fdGVzdHNDb3VudCA9PT0gdW5kZWZpbmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJUZXN0cyBoYXNuJ3QgYmVlbiBydW4geWV0XCIpXG5cbiAgICByZXR1cm4gdGhpcy5fdGVzdHNDb3VudFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGV4ZWN1dGVkIHRlc3RzIGNvdW50LlxuICAgKiBAcmV0dXJucyB7bnVtYmVyfSAtIFRoZSBleGVjdXRlZCB0ZXN0cyBjb3VudC5cbiAgICovXG4gIGdldEV4ZWN1dGVkVGVzdHNDb3VudCgpIHtcbiAgICByZXR1cm4gdGhpcy5fcGFja2FnZVJlc3VsdD8udGVzdHMubGVuZ3RoID8/IHRoaXMuX3Rlc3REdXJhdGlvbnMubGVuZ3RoXG4gIH1cblxuICAvKipcbiAgICogRGlzdGluZ3Vpc2hlcyBhbiBlbXB0eSBzZWxlY3Rpb24gZnJvbSBhIGZhaWx1cmUgYmVmb3JlIHNlbGVjdGVkIGNhc2VzIGV4ZWN1dGUuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgc2VsZWN0aW9uIG1hdGNoZWQgbm8gZGVjbGFyYXRpb25zLlxuICAgKi9cbiAgaGFzTm9NYXRjaGVzKCkge1xuICAgIHJldHVybiB0aGlzLl9wYWNrYWdlUmVzdWx0Py5ub01hdGNoZXMgPT09IHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSB0ZXN0cyByZWNvcmRlZCBkdXJpbmcgdGhlIHJ1biwgc2xvd2VzdCBmaXJzdC5cbiAgICogQHBhcmFtIHtudW1iZXJ9IFtsaW1pdF0gLSBNYXhpbXVtIG51bWJlciBvZiB0ZXN0cyB0byByZXR1cm4gKDAgcmV0dXJucyBhbGwpLlxuICAgKiBAcmV0dXJucyB7QXJyYXk8e2Z1bGxEZXNjcmlwdGlvbjogc3RyaW5nLCBmaWxlUGF0aDogc3RyaW5nLCBsaW5lOiBudW1iZXIsIGR1cmF0aW9uTXM6IG51bWJlcn0+fSAtIFNsb3dlc3QgdGVzdHMsIHNsb3dlc3QgZmlyc3QuXG4gICAqL1xuICBnZXRTbG93ZXN0VGVzdHMobGltaXQgPSAxMCkge1xuICAgIGlmICh0aGlzLl9wYWNrYWdlUmVzdWx0KSB7XG4gICAgICByZXR1cm4gc2xvd2VzdFRlc3RSZXN1bHRzKHRoaXMuX3BhY2thZ2VSZXN1bHQsIHtsaW1pdH0pLm1hcCgocmVzdWx0KSA9PiAoe1xuICAgICAgICBmdWxsRGVzY3JpcHRpb246IHJlc3VsdC5mdWxsTmFtZSxcbiAgICAgICAgZmlsZVBhdGg6IHJlc3VsdC5maWxlUGF0aCA/PyBcIjx1bmtub3duPlwiLFxuICAgICAgICBsaW5lOiByZXN1bHQubGluZSA/PyAwLFxuICAgICAgICBkdXJhdGlvbk1zOiByZXN1bHQuZHVyYXRpb25Nc1xuICAgICAgfSkpXG4gICAgfVxuXG4gICAgY29uc3Qgc29ydGVkID0gWy4uLnRoaXMuX3Rlc3REdXJhdGlvbnNdLnNvcnQoKHRlc3RBLCB0ZXN0QikgPT4gdGVzdEIuZHVyYXRpb25NcyAtIHRlc3RBLmR1cmF0aW9uTXMpXG5cbiAgICByZXR1cm4gbGltaXQgPiAwID8gc29ydGVkLnNsaWNlKDAsIGxpbWl0KSA6IHNvcnRlZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcHJlcGFyZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHByZXBhcmUoKSB7XG4gICAgdGhpcy5hbnlUZXN0c0ZvY3Vzc2VkID0gZmFsc2VcbiAgICB0aGlzLl9mYWlsZWRUZXN0cyA9IDBcbiAgICB0aGlzLl9ub3RSdW5UZXN0RGV0YWlscyA9IFtdXG4gICAgdGhpcy5fc3VjY2Vzc2Z1bFRlc3RzID0gMFxuICAgIHRoaXMuX3Rlc3RzQ291bnQgPSAwXG4gICAgdGhpcy5fYWJvcnRSZW1haW5pbmdUZXN0cyA9IGZhbHNlXG4gICAgdGhpcy5fZmFpbGVkVGVzdERldGFpbHMgPSBbXVxuICAgIHRoaXMuX3Rlc3REdXJhdGlvbnMgPSBbXVxuICAgIHRoaXMuX3Rlc3RDb21wYXRpYmlsaXR5ID0gbmV3IFdlYWtNYXAoKVxuICAgIHRoaXMuX2luamVjdGVkVGVzdHMgPSBuZXcgV2Vha1NldCgpXG4gICAgdGhpcy5fY29tcGxldGVkVGVzdHMgPSBuZXcgV2Vha1NldCgpXG4gICAgdGhpcy5fdGVzdE1ldGFkYXRhID0gbmV3IFdlYWtNYXAoKVxuICAgIHRoaXMuX2hvb2tNZXRhZGF0YSA9IG5ldyBXZWFrTWFwKClcbiAgICB0aGlzLl9hdHRlbXB0T3V0Y29tZXMgPSBuZXcgV2Vha01hcCgpXG4gICAgdGhpcy5fc3VpdGVIb29rRmFpbHVyZXMgPSBbXVxuICAgIHRoaXMuX3Rlc3RzQnlGdWxsTmFtZSA9IG5ldyBNYXAoKVxuICAgIHRoaXMuX3BhY2thZ2VSZXN1bHQgPSB1bmRlZmluZWRcbiAgICBjb25zdCBjb250ZXh0ID0gdGhpcy5nZXRUZXN0Q29udGV4dCgpXG4gICAgLyoqIEB0eXBlIHtzdHJpbmcgfCB1bmRlZmluZWR9ICovXG4gICAgbGV0IG93bmVyRmlsZVBhdGhcblxuICAgIGNvbnRleHQucmVzZXQoe2NvbmZpZzogdHJ1ZX0pXG4gICAgY29udGV4dC5zZXREZWNsYXJhdGlvbkxvY2F0b3IoKCkgPT4gdGhpcy5jYXB0dXJlVGVzdERlY2xhcmF0aW9uTG9jYXRpb24ob3duZXJGaWxlUGF0aCkpXG4gICAgY29uc3QgdGVzdGluZ0NvbmZpZ1BhdGggPSB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXRUZXN0aW5nKClcblxuICAgIGF3YWl0IGNvbnRleHQuZGVzY3JpYmUoXCJcIiwge2RhdGFiYXNlQ2xlYW5pbmc6IHt0cmFuc2FjdGlvbjogdHJ1ZX19LCBhc3luYyAoKSA9PiB7XG4gICAgICBpZiAodGhpcy5fc2V0dXBGaWxlcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGF3YWl0IHRoaXMucnVuUHJvZmlsZVNwYW4oe3BoYXNlOiBcInRlc3RpbmcgY29uZmlnL2dsb2JhbCBzZXR1cFwifSwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGF3YWl0IHRoaXMuZ2V0Q29uZmlndXJhdGlvbigpLmdldEVudmlyb25tZW50SGFuZGxlcigpLmltcG9ydFRlc3RGaWxlcyh0aGlzLl9zZXR1cEZpbGVzKVxuICAgICAgICB9KVxuICAgICAgfVxuXG4gICAgICBpZiAodGVzdGluZ0NvbmZpZ1BhdGgpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5ydW5Qcm9maWxlU3Bhbih7cGhhc2U6IFwidGVzdGluZyBjb25maWcvZ2xvYmFsIHNldHVwXCJ9LCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuaW1wb3J0VGVzdGluZ0NvbmZpZ1BhdGgoKVxuICAgICAgICB9KVxuICAgICAgfVxuXG4gICAgICBpZiAoIXRoaXMuX3Byb2ZpbGVyKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuaW1wb3J0VGVzdEZpbGVzKClcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGZvciAoY29uc3QgdGVzdEZpbGUgb2YgdGhpcy5nZXRUZXN0RmlsZXMoKSkge1xuICAgICAgICAgIG93bmVyRmlsZVBhdGggPSB0ZXN0RmlsZVxuICAgICAgICAgIGNvbnN0IGV4aXN0aW5nUmVnaXN0cmF0aW9ucyA9IHRoaXMudGVzdFJlZ2lzdHJhdGlvbk9iamVjdHMoKVxuXG4gICAgICAgICAgYXdhaXQgdGhpcy5fcHJvZmlsZXIubWVhc3VyZVBoYXNlKFwiaW1wb3J0c1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmdldENvbmZpZ3VyYXRpb24oKS5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5pbXBvcnRUZXN0RmlsZXMoW3Rlc3RGaWxlXSlcbiAgICAgICAgICB9LCB7ZmlsZVBhdGg6IHRlc3RGaWxlfSlcbiAgICAgICAgICB0aGlzLmFzc2lnblRlc3RSZWdpc3RyYXRpb25Pd25lcnNoaXAoZXhpc3RpbmdSZWdpc3RyYXRpb25zLCB0ZXN0RmlsZSlcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0pXG4gICAgb3duZXJGaWxlUGF0aCA9IHVuZGVmaW5lZFxuICAgIHRoaXMuYW5hbHl6ZURlY2xhcmF0aW9ucygpXG4gIH1cblxuICAvKipcbiAgICogQ2FwdHVyZXMgYSB0ZXN0IHNvdXJjZSBsb2NhdGlvbiB3aXRob3V0IGF0dHJpYnV0aW5nIHBhY2thZ2UvZmFjYWRlIGZyYW1lcy5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IG93bmVyRmlsZVBhdGggLSBJbXBvcnRpbmcgZW50cnkgZmlsZSBmYWxsYmFjay5cbiAgICogQHJldHVybnMge3tmaWxlUGF0aD86IHN0cmluZywgbGluZT86IG51bWJlcn19IC0gRGVjbGFyYXRpb24gbG9jYXRpb24uXG4gICAqL1xuICBjYXB0dXJlVGVzdERlY2xhcmF0aW9uTG9jYXRpb24ob3duZXJGaWxlUGF0aCkge1xuICAgIGNvbnN0IHN0YWNrID0gbmV3IEVycm9yKCkuc3RhY2s/LnNwbGl0KFwiXFxuXCIpIHx8IFtdXG5cbiAgICBmb3IgKGNvbnN0IHN0YWNrTGluZSBvZiBzdGFjaykge1xuICAgICAgY29uc3QgbWF0Y2ggPSBzdGFja0xpbmUubWF0Y2goLyg/OlxcKHxcXHMpKGZpbGU6XFwvXFwvLio/fFxcL1teXCJdKj8pOihcXGQrKTooXFxkKylcXCk/JC91KVxuICAgICAgaWYgKCFtYXRjaCkgY29udGludWVcblxuICAgICAgbGV0IGZpbGVQYXRoID0gbWF0Y2hbMV1cbiAgICAgIGlmIChmaWxlUGF0aC5zdGFydHNXaXRoKFwiZmlsZTovL1wiKSkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGZpbGVQYXRoID0gZmlsZVVSTFRvUGF0aChmaWxlUGF0aClcbiAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgY29uc3QgcmVzb2x2ZWRGaWxlUGF0aCA9IHBhdGgucmVzb2x2ZShmaWxlUGF0aClcbiAgICAgIGNvbnN0IHBvcnRhYmxlUGF0aCA9IHJlc29sdmVkRmlsZVBhdGgucmVwbGFjZUFsbChwYXRoLnNlcCwgXCIvXCIpXG5cbiAgICAgIGlmIChwb3J0YWJsZVBhdGguZW5kc1dpdGgoXCIvc3JjL3Rlc3RpbmcvdGVzdC1ydW5uZXIuanNcIikpIGNvbnRpbnVlXG4gICAgICBpZiAocG9ydGFibGVQYXRoLmVuZHNXaXRoKFwiL3NyYy90ZXN0aW5nL3Rlc3QuanNcIikpIGNvbnRpbnVlXG4gICAgICBpZiAocmVzb2x2ZWRGaWxlUGF0aC5zdGFydHNXaXRoKGAke3Rlc3RpbmdQYWNrYWdlRGlyZWN0b3J5fSR7cGF0aC5zZXB9YCkpIGNvbnRpbnVlXG5cbiAgICAgIHJldHVybiB7ZmlsZVBhdGg6IHJlc29sdmVkRmlsZVBhdGgsIGxpbmU6IE51bWJlcihtYXRjaFsyXSl9XG4gICAgfVxuXG4gICAgcmV0dXJuIG93bmVyRmlsZVBhdGggPyB7ZmlsZVBhdGg6IG93bmVyRmlsZVBhdGh9IDoge31cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFyZSBhbnkgdGVzdHMgZm9jdXNzZWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgYW55IHRlc3RzIGZvY3Vzc2VkLlxuICAgKi9cbiAgYXJlQW55VGVzdHNGb2N1c3NlZCgpIHtcbiAgICBpZiAodGhpcy5hbnlUZXN0c0ZvY3Vzc2VkID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkhhc24ndCBiZWVuIGRldGVjdGVkIHlldFwiKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLmFueVRlc3RzRm9jdXNzZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1bi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIC8qKlxuICAgKiBSZWNvcmRzIGFuIGFzeW5jaHJvbm91cyBjcmFzaCAoYW4gdW5oYW5kbGVkIHByb21pc2UgcmVqZWN0aW9uIGRldGFjaGVkIGZyb21cbiAgICogYW55IGF3YWl0LCBlLmcuIGEgYHZvaWQgY29ubmVjdGlvbi5hZnRlckNvbW1pdChhc3luYyAoKSA9PiBicm9hZGNhc3QoLi4uKSlgXG4gICAqIGZyb250ZW5kLW1vZGVsIHB1Ymxpc2gg4oCUIG9yIGEgc3luY2hyb25vdXMgdGhyb3cgaW5zaWRlIGEgZGV0YWNoZWQgY2FsbGJhY2tcbiAgICogc3VjaCBhcyBhIGRyaXZlciBzb2NrZXQgb3IgdGltZXIgY2FsbGJhY2spIGFzIGEgcmVhbCwgdmlzaWJsZSwgYXR0cmlidXRlZFxuICAgKiB0ZXN0IGZhaWx1cmUuXG4gICAqXG4gICAqIFdpdGhvdXQgdGhpcywgc3VjaCBhIHJlamVjdGlvbi9leGNlcHRpb24gaGFzIG5vIGhhbmRsZXIsIHNvIG9uIG1vZGVybiBOb2RlXG4gICAqIHRoZSBwcm9jZXNzIGlzIFRFUk1JTkFURUQg4oCUIHRoZSBydW4gZW5kcyB3aXRoIG5vIHJlcG9ydGVkIGZhaWx1cmVzIGFuZCBDSVxuICAgKiBqdXN0IHNlZXMgYSBjcmFzaGVkL3JldHJpZWQgc2hhcmQgd2l0aCBhbiBlbXB0eSByZXN1bHQgKHRoZSByZWN1cnJpbmdcbiAgICogXCJzaWxlbnQgdGVzdC1ydW5uZXIgZGVhdGhcIjogaW52aXNpYmxlIGFuZCBpbXBvc3NpYmxlIHRvIGRpYWdub3NlKS4gVHVybmluZ1xuICAgKiBpdCBpbnRvIGEgZmFpbHVyZSBtYWtlcyB0aGUgcnVuIGdvIHJlZCB3aXRoIHNvbWV0aGluZyBkZWJ1Z2dhYmxlIGluc3RlYWQgb2ZcbiAgICogdmFuaXNoaW5nLlxuICAgKiBAcGFyYW0ge1widW5jYXVnaHRFeGNlcHRpb25cIiB8IFwidW5oYW5kbGVkUmVqZWN0aW9uXCJ9IGtpbmQgLSBBc3luYy1jcmFzaCBraW5kLlxuICAgKiBAcGFyYW0ge3Vua25vd259IHJlYXNvbiAtIFJlamVjdGlvbiByZWFzb24gb3IgdGhyb3duIGVycm9yLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHJlY29yZEFzeW5jQ3Jhc2goa2luZCwgcmVhc29uKSB7XG4gICAgY29uc3QgZXJyb3IgPSByZWFzb24gaW5zdGFuY2VvZiBFcnJvciA/IHJlYXNvbiA6IG5ldyBFcnJvcihgJHtraW5kfTogJHtTdHJpbmcocmVhc29uKX1gKVxuICAgIGNvbnN0IG5lYXIgPSB0aGlzLl9sYXN0VGVzdENvbnRleHRcbiAgICBjb25zdCBhdHRyaWJ1dGlvbiA9IG5lYXIgPyBgLCBuZWFyIHRlc3Q6ICR7bmVhci5mdWxsRGVzY3JpcHRpb259ICgke25lYXIuZmlsZVBhdGh9OiR7bmVhci5saW5lfSlgIDogXCJcIlxuXG4gICAgdGhpcy5fZmFpbGVkVGVzdHMgPSAodGhpcy5fZmFpbGVkVGVzdHMgfHwgMCkgKyAxXG4gICAgdGhpcy5fZmFpbGVkVGVzdERldGFpbHMucHVzaCh7XG4gICAgICBmdWxsRGVzY3JpcHRpb246IGA8JHtraW5kfSBkdXJpbmcgdGVzdCBydW4ke2F0dHJpYnV0aW9ufT5gLFxuICAgICAgZmlsZVBhdGg6IG5lYXIgPyBuZWFyLmZpbGVQYXRoIDogXCI8dGVzdCBydW5uZXI+XCIsXG4gICAgICBsaW5lOiBuZWFyID8gbmVhci5saW5lIDogMCxcbiAgICAgIGVycm9yLFxuICAgICAgY29uc29sZU91dHB1dDogdW5kZWZpbmVkXG4gICAgfSlcblxuICAgIGNvbnNvbGUuZXJyb3IocGljb2NvbG9ycy5yZWQoYFxcblt0ZXN0LXJ1bm5lcl0gJHtraW5kfSBkdXJpbmcgdGhlIHRlc3QgcnVuIOKAlCB0aGlzIHdvdWxkIG90aGVyd2lzZSB0ZXJtaW5hdGUgdGhlIHByb2Nlc3Mgc2lsZW50bHkgYW5kIHN1cmZhY2Ugb25seSBhcyBhIGNyYXNoZWQvcmV0cmllZCBzaGFyZCB3aXRoIHplcm8gcmVwb3J0ZWQgZmFpbHVyZXMuJHthdHRyaWJ1dGlvbn1gKSlcbiAgICBjb25zb2xlLmVycm9yKGVycm9yKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgYSBjbGVhbnVwIGZhaWx1cmUgYWZ0ZXIgdGltZW91dCBoYW5kbGluZyBoYXMgYmVndW4uXG4gICAqIEBwYXJhbSB7dW5rbm93bn0gcmVhc29uIC0gRGV0YWNoZWQgY2xlYW51cCByZWplY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjbGVhbnVwTmFtZSAtIENsZWFudXAgb3BlcmF0aW9uIG5hbWUuXG4gICAqIEBwYXJhbSB7U2V0PEVycm9yPn0gW3JlY29yZGVkRXJyb3JzXSAtIEF0dGVtcHQtb3duZWQgY2xlYW51cCBlcnJvcnMgYWxyZWFkeSByZXBvcnRlZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICByZWNvcmRUaW1lb3V0Q2xlYW51cEZhaWx1cmUocmVhc29uLCBjbGVhbnVwTmFtZSwgcmVjb3JkZWRFcnJvcnMpIHtcbiAgICBjb25zdCBlcnJvciA9IHJlYXNvbiBpbnN0YW5jZW9mIEVycm9yID8gcmVhc29uIDogbmV3IEVycm9yKGAke2NsZWFudXBOYW1lfSBjbGVhbnVwIGZhaWxlZDogJHtTdHJpbmcocmVhc29uKX1gKVxuXG4gICAgaWYgKHJlY29yZGVkRXJyb3JzKSB7XG4gICAgICAvLyBNdWx0aXBsZSBib3VuZGVkIG9ic2VydmVycyBjYW4gcmVjZWl2ZSB0aGUgc2FtZSBkZXRhY2hlZCBjbGVhbnVwIHJlamVjdGlvbi5cbiAgICAgIGlmIChyZWNvcmRlZEVycm9ycy5oYXMoZXJyb3IpKSByZXR1cm5cbiAgICAgIHJlY29yZGVkRXJyb3JzLmFkZChlcnJvcilcbiAgICB9XG5cbiAgICBjb25zdCBuZWFyID0gdGhpcy5fbGFzdFRlc3RDb250ZXh0XG4gICAgY29uc3QgYXR0cmlidXRpb24gPSBuZWFyID8gYCwgbmVhciB0ZXN0OiAke25lYXIuZnVsbERlc2NyaXB0aW9ufSAoJHtuZWFyLmZpbGVQYXRofToke25lYXIubGluZX0pYCA6IFwiXCJcblxuICAgIHRoaXMuX2ZhaWxlZFRlc3RzID0gKHRoaXMuX2ZhaWxlZFRlc3RzIHx8IDApICsgMVxuICAgIHRoaXMuX2ZhaWxlZFRlc3REZXRhaWxzLnB1c2goe1xuICAgICAgZnVsbERlc2NyaXB0aW9uOiBgPCR7Y2xlYW51cE5hbWV9IGVtZXJnZW5jeSBjbGVhbnVwIGZhaWx1cmUke2F0dHJpYnV0aW9ufT5gLFxuICAgICAgZmlsZVBhdGg6IG5lYXIgPyBuZWFyLmZpbGVQYXRoIDogXCI8dGVzdCBydW5uZXI+XCIsXG4gICAgICBsaW5lOiBuZWFyID8gbmVhci5saW5lIDogMCxcbiAgICAgIGVycm9yLFxuICAgICAgY29uc29sZU91dHB1dDogdW5kZWZpbmVkXG4gICAgfSlcblxuICAgIGNvbnNvbGUuZXJyb3IocGljb2NvbG9ycy5yZWQoYFxcblt0ZXN0LXJ1bm5lcl0gJHtjbGVhbnVwTmFtZX0gY2xlYW51cCBmYWlsZWQgYWZ0ZXIgdGltZW91dCBoYW5kbGluZyBiZWdhbi4ke2F0dHJpYnV0aW9ufWApKVxuICAgIGNvbnNvbGUuZXJyb3IoZXJyb3IpXG4gIH1cblxuICBhc3luYyBydW4oKSB7XG4gICAgLyoqXG4gICAgICogSGFuZGxlcyBhIHByb2Nlc3MtbGV2ZWwgdW5oYW5kbGVkIHJlamVjdGlvbiBkdXJpbmcgdGhlIHJ1bi5cbiAgICAgKiBAcGFyYW0ge3Vua25vd259IHJlYXNvbiAtIFJlamVjdGlvbiByZWFzb24uXG4gICAgICogQHJldHVybnMge3ZvaWR9XG4gICAgICovXG4gICAgY29uc3Qgb25VbmhhbmRsZWRSZWplY3Rpb24gPSAocmVhc29uKSA9PiB7XG4gICAgICAvLyBJZiBhIHRlc3QgYXR0YWNoZWQgaXRzIE9XTiB1bmhhbmRsZWRSZWplY3Rpb24gbGlzdGVuZXIsIGl0IGlzXG4gICAgICAvLyBpbnRlbnRpb25hbGx5IG9ic2VydmluZy90cmlnZ2VyaW5nIHRoZSByZWplY3Rpb24gKGUuZy4gYmVhY29uXG4gICAgICAvLyBlcnJvci1yZXBvcnRpbmctc3BlYy5qcykg4oCUIE5vZGUgZGlzcGF0Y2hlcyB0byBFVkVSWSBsaXN0ZW5lciwgc28gYWxzb1xuICAgICAgLy8gZmFpbGluZyB0aGUgc3VpdGUgaGVyZSB3b3VsZCBicmVhayB0aG9zZSB0ZXN0cy4gRGVmZXIgdG8gdGhlIHRlc3Qnc1xuICAgICAgLy8gaGFuZGxlcjsgb25seSB0cmVhdCBhIHJlamVjdGlvbiBhcyBhIHNpbGVudC1kZWF0aCBjcmFzaCB3aGVuIG91cnMgaXMgdGhlXG4gICAgICAvLyBzb2xlIGxpc3RlbmVyIChubyBwZXJzaXN0ZW50IGZyYW1ld29yayBsaXN0ZW5lciBleGlzdHMgdG8gbWFzayB0aGlzKS5cbiAgICAgIGlmIChwcm9jZXNzLmxpc3RlbmVyQ291bnQoXCJ1bmhhbmRsZWRSZWplY3Rpb25cIikgPiAxKSByZXR1cm5cblxuICAgICAgdGhpcy5yZWNvcmRBc3luY0NyYXNoKFwidW5oYW5kbGVkUmVqZWN0aW9uXCIsIHJlYXNvbilcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBIYW5kbGVzIGEgcHJvY2Vzcy1sZXZlbCB1bmNhdWdodCBleGNlcHRpb24gZHVyaW5nIHRoZSBydW4g4oCUIGFcbiAgICAgKiBzeW5jaHJvbm91cyB0aHJvdyBpbnNpZGUgYSBkZXRhY2hlZCBjYWxsYmFjayAoZHJpdmVyIHNvY2tldCwgdGltZXIsXG4gICAgICogZXZlbnQgZW1pdHRlcikgdGhhdCBubyB0ZXN0IGF3YWl0IG9ic2VydmVzLiBTYW1lIHNpbGVudC1kZWF0aCBtb2RlIGFzXG4gICAgICogdW5oYW5kbGVkIHJlamVjdGlvbnM6IHdpdGhvdXQgYSBoYW5kbGVyIHRoZSBwcm9jZXNzIGRpZXMgbWlkLXJ1biBhbmQgQ0lcbiAgICAgKiBzZWVzIGEgY3Jhc2hlZCBzaGFyZCB3aXRoIHplcm8gcmVwb3J0ZWQgZmFpbHVyZXMuXG4gICAgICogQHBhcmFtIHt1bmtub3dufSBlcnJvciAtIFRocm93biBlcnJvci5cbiAgICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICAgKi9cbiAgICBjb25zdCBvblVuY2F1Z2h0RXhjZXB0aW9uID0gKGVycm9yKSA9PiB7XG4gICAgICAvLyBNaXJyb3IgdGhlIHVuaGFuZGxlZFJlamVjdGlvbiBkZWZlcnJhbDogYSB0ZXN0IG9ic2VydmluZy90cmlnZ2VyaW5nXG4gICAgICAvLyB1bmNhdWdodCBleGNlcHRpb25zIHdpdGggaXRzIG93biBsaXN0ZW5lciBvd25zIHRoZW0uXG4gICAgICBpZiAocHJvY2Vzcy5saXN0ZW5lckNvdW50KFwidW5jYXVnaHRFeGNlcHRpb25cIikgPiAxKSByZXR1cm5cblxuICAgICAgdGhpcy5yZWNvcmRBc3luY0NyYXNoKFwidW5jYXVnaHRFeGNlcHRpb25cIiwgZXJyb3IpXG4gICAgfVxuXG4gICAgcHJvY2Vzcy5vbihcInVuaGFuZGxlZFJlamVjdGlvblwiLCBvblVuaGFuZGxlZFJlamVjdGlvbilcbiAgICBwcm9jZXNzLm9uKFwidW5jYXVnaHRFeGNlcHRpb25cIiwgb25VbmNhdWdodEV4Y2VwdGlvbilcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLnJ1blBhY2thZ2VUZXN0cygpXG5cbiAgICAgIC8vIEEgcmVqZWN0aW9uIHNjaGVkdWxlZCBieSB0aGUgZmluYWwgdGVzdCAoYSBkZXRhY2hlZCByZWplY3RlZCBwcm9taXNlLFxuICAgICAgLy8gb3IgYW4gYWZ0ZXJDb21taXQgY2FsbGJhY2sgcmVqZWN0aW5nIGFzIHRoZSBzdWl0ZSBkcmFpbnMpIGlzIHJlcG9ydGVkXG4gICAgICAvLyBieSBOb2RlIG9uIGEgTEFURVIgdHVybi4gRHJhaW4gYSBmZXcgdHVybnMgd2hpbGUgdGhlIGhhbmRsZXIgaXMgc3RpbGxcbiAgICAgIC8vIGF0dGFjaGVkIHNvIHRob3NlIGxhdGUgcmVqZWN0aW9ucyBhcmUgcmVjb3JkZWQgaW5zdGVhZCBvZiBlc2NhcGluZyB0b1xuICAgICAgLy8gdGhlIGRlZmF1bHQgY3Jhc2ggcGF0aCBhZnRlciBjbGVhbnVwLlxuICAgICAgZm9yIChsZXQgZHJhaW5UdXJuID0gMDsgZHJhaW5UdXJuIDwgMzsgZHJhaW5UdXJuKyspIHtcbiAgICAgICAgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHNldEltbWVkaWF0ZShyZXNvbHZlKSlcbiAgICAgIH1cbiAgICB9IGZpbmFsbHkge1xuICAgICAgcHJvY2Vzcy5vZmYoXCJ1bmhhbmRsZWRSZWplY3Rpb25cIiwgb25VbmhhbmRsZWRSZWplY3Rpb24pXG4gICAgICBwcm9jZXNzLm9mZihcInVuY2F1Z2h0RXhjZXB0aW9uXCIsIG9uVW5jYXVnaHRFeGNlcHRpb24pXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMudGVhcmRvd25UZXN0VGVuYW50UG9vbHMoKVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgdGhpcy5yZWNvcmRUaW1lb3V0Q2xlYW51cEZhaWx1cmUoZXJyb3IsIFwidGVzdCB0ZW5hbnQgcG9vbCB0ZWFyZG93blwiKVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1biBhZnRlciBhbGxzIGZvciBhY3RpdmUgc2NvcGVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNsZWFudXAgaG9va3MgZmluaXNoLlxuICAgKi9cbiAgYXN5bmMgcnVuQWZ0ZXJBbGxzRm9yQWN0aXZlU2NvcGVzKCkge1xuICAgIGNvbnN0IGZhaWx1cmVTdGFydCA9IHRoaXMuX3N1aXRlSG9va0ZhaWx1cmVzLmxlbmd0aFxuXG4gICAgYXdhaXQgdGhpcy5fcGFja2FnZVJ1bm5lcj8uY2xlYW51cEFjdGl2ZVN1aXRlcygpXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy50ZWFyZG93blRlc3RUZW5hbnRQb29scygpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMucmVjb3JkVGltZW91dENsZWFudXBGYWlsdXJlKGVycm9yLCBcInRlc3QgdGVuYW50IHBvb2wgdGVhcmRvd25cIilcbiAgICB9XG5cbiAgICB0aGlzLnRocm93QWZ0ZXJBbGxGYWlsdXJlcyh0aGlzLl9zdWl0ZUhvb2tGYWlsdXJlcy5zbGljZShmYWlsdXJlU3RhcnQpKVxuICB9XG5cbiAgLyoqIEJ1aWxkcyBkZWNsYXJhdGlvbiBtZXRhZGF0YSB1c2VkIG9ubHkgYnkgZnJhbWV3b3JrIGFkYXB0ZXJzIGFuZCBwcm9qZWN0aW9ucy4gKi9cbiAgYW5hbHl6ZURlY2xhcmF0aW9ucygpIHtcbiAgICBjb25zdCB2aXNpdCA9ICgvKiogQHR5cGUge1BhY2thZ2VTdWl0ZURlY2xhcmF0aW9ufSAqLyBzdWl0ZSwgLyoqIEB0eXBlIHtQYWNrYWdlU3VpdGVEZWNsYXJhdGlvbltdfSAqLyBhbmNlc3RvcnMsIC8qKiBAdHlwZSB7c3RyaW5nIHwgdW5kZWZpbmVkfSAqLyBwYXJlbnRQcm9maWxlU2NvcGVJZCkgPT4ge1xuICAgICAgY29uc3Qgc3VpdGVzID0gWy4uLmFuY2VzdG9ycywgc3VpdGVdXG4gICAgICBjb25zdCBkZXNjcmlwdGlvbnMgPSBzdWl0ZXMubWFwKChlbnRyeSkgPT4gZW50cnkubmFtZSkuZmlsdGVyKChuYW1lKSA9PiBuYW1lICE9PSBcIlwiKVxuICAgICAgY29uc3Qgb3duZXJGaWxlUGF0aCA9IHRoaXMuX2RlY2xhcmF0aW9uT3duZXJzLmdldChzdWl0ZSkgPz8gc3VpdGUubG9jYXRpb24uZmlsZVBhdGhcbiAgICAgIGNvbnN0IHByb2ZpbGVTY29wZUlkID0gdGhpcy5fcHJvZmlsZXI/LnNjb3BlSWQoc3VpdGUsIHtcbiAgICAgICAgZGVzY3JpcHRpb25zLFxuICAgICAgICBmaWxlUGF0aDogb3duZXJGaWxlUGF0aCxcbiAgICAgICAgbGluZTogc3VpdGUubG9jYXRpb24ubGluZSxcbiAgICAgICAgcGFyZW50SWQ6IHBhcmVudFByb2ZpbGVTY29wZUlkXG4gICAgICB9KVxuXG4gICAgICBmb3IgKGNvbnN0IGhvb2tzIG9mIE9iamVjdC52YWx1ZXMoc3VpdGUuaG9va3MpKSB7XG4gICAgICAgIGhvb2tzLmZvckVhY2goKGhvb2ssIGRlY2xhcmF0aW9uSW5kZXgpID0+IHtcbiAgICAgICAgICB0aGlzLl9ob29rTWV0YWRhdGEuc2V0KGhvb2ssIHtcbiAgICAgICAgICAgIGRlY2xhcmF0aW9uSW5kZXgsXG4gICAgICAgICAgICBkZWNsYXJhdGlvblNjb3BlSWQ6IHByb2ZpbGVTY29wZUlkLFxuICAgICAgICAgICAgb3duZXJGaWxlUGF0aDogdGhpcy5fZGVjbGFyYXRpb25Pd25lcnMuZ2V0KGhvb2spID8/IGhvb2subG9jYXRpb24uZmlsZVBhdGggPz8gb3duZXJGaWxlUGF0aFxuICAgICAgICAgIH0pXG4gICAgICAgIH0pXG4gICAgICB9XG5cbiAgICAgIGZvciAoY29uc3QgdGVzdERlY2xhcmF0aW9uIG9mIHN1aXRlLnRlc3RzKSB7XG4gICAgICAgIGNvbnN0IGZ1bGxEZXNjcmlwdGlvbiA9IHRoaXMuYnVpbGRGdWxsRGVzY3JpcHRpb24oZGVzY3JpcHRpb25zLCB0ZXN0RGVjbGFyYXRpb24ubmFtZSlcbiAgICAgICAgY29uc3QgZGVjbGFyYXRpb25zID0gdGhpcy5fdGVzdHNCeUZ1bGxOYW1lLmdldChmdWxsRGVzY3JpcHRpb24pIHx8IFtdXG5cbiAgICAgICAgZGVjbGFyYXRpb25zLnB1c2godGVzdERlY2xhcmF0aW9uKVxuICAgICAgICB0aGlzLl90ZXN0c0J5RnVsbE5hbWUuc2V0KGZ1bGxEZXNjcmlwdGlvbiwgZGVjbGFyYXRpb25zKVxuICAgICAgICB0aGlzLl90ZXN0TWV0YWRhdGEuc2V0KHRlc3REZWNsYXJhdGlvbiwge1xuICAgICAgICAgIGRlc2NyaXB0aW9ucyxcbiAgICAgICAgICB0ZXN0RGVzY3JpcHRpb246IHRlc3REZWNsYXJhdGlvbi5uYW1lLFxuICAgICAgICAgIGZ1bGxEZXNjcmlwdGlvbixcbiAgICAgICAgICBvd25lckZpbGVQYXRoOiB0aGlzLl9kZWNsYXJhdGlvbk93bmVycy5nZXQodGVzdERlY2xhcmF0aW9uKSA/PyB0ZXN0RGVjbGFyYXRpb24ubG9jYXRpb24uZmlsZVBhdGggPz8gb3duZXJGaWxlUGF0aCxcbiAgICAgICAgICBzdWl0ZXNcbiAgICAgICAgfSlcbiAgICAgICAgY29uc3QgbGVnYWN5VGVzdERhdGEgPSB0aGlzLl9sZWdhY3lGaXh0dXJlRGF0YUJ5RnVsbE5hbWU/LmdldChmdWxsRGVzY3JpcHRpb24pXG4gICAgICAgIGlmIChsZWdhY3lUZXN0RGF0YSkge1xuICAgICAgICAgIHRoaXMuX3Rlc3RDb21wYXRpYmlsaXR5LnNldCh0ZXN0RGVjbGFyYXRpb24sIHtcbiAgICAgICAgICAgIHRlc3RBcmdzOiB0aGlzLl90ZXN0QXJndW1lbnRzLmNvcHkodGVzdERlY2xhcmF0aW9uKSxcbiAgICAgICAgICAgIHRlc3REYXRhOiBsZWdhY3lUZXN0RGF0YVxuICAgICAgICAgIH0pXG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5fdGVzdHNDb3VudCsrXG4gICAgICAgIGlmICh0ZXN0RGVjbGFyYXRpb24uc3RhdGUgPT09IFwicnVuXCIgJiYgKHRlc3REZWNsYXJhdGlvbi5mb2N1cyB8fCBzdWl0ZXMuc29tZSgoZW50cnkpID0+IGVudHJ5LmZvY3VzKSkpIHtcbiAgICAgICAgICB0aGlzLmFueVRlc3RzRm9jdXNzZWQgPSB0cnVlXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgZm9yIChjb25zdCBjaGlsZFN1aXRlIG9mIHN1aXRlLnN1aXRlcykgdmlzaXQoY2hpbGRTdWl0ZSwgc3VpdGVzLCBwcm9maWxlU2NvcGVJZClcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IHN1aXRlIG9mIHRoaXMuZ2V0VGVzdENvbnRleHQoKS5yZWdpc3RyeS5zdWl0ZXMpIHZpc2l0KHN1aXRlLCBbXSwgdW5kZWZpbmVkKVxuICB9XG5cbiAgLyoqXG4gICAqIEdldHMgcGFja2FnZSBob29rIGNvbXBhdGliaWxpdHkgbWV0YWRhdGEuXG4gICAqIEBwYXJhbSB7UGFja2FnZUhvb2tEZWNsYXJhdGlvbn0gaG9vayAtIFBhY2thZ2UgaG9vayBkZWNsYXJhdGlvbi5cbiAgICogQHJldHVybnMge3tkZWNsYXJhdGlvbkluZGV4OiBudW1iZXIsIGRlY2xhcmF0aW9uU2NvcGVJZDogc3RyaW5nIHwgdW5kZWZpbmVkLCBvd25lckZpbGVQYXRoOiBzdHJpbmcgfCB1bmRlZmluZWR9fSAtIEhvb2sgbWV0YWRhdGEuXG4gICAqL1xuICBob29rTWV0YWRhdGEoaG9vaykge1xuICAgIHJldHVybiB0aGlzLl9ob29rTWV0YWRhdGEuZ2V0KGhvb2spIHx8IHtkZWNsYXJhdGlvbkluZGV4OiAwLCBkZWNsYXJhdGlvblNjb3BlSWQ6IHVuZGVmaW5lZCwgb3duZXJGaWxlUGF0aDogaG9vay5sb2NhdGlvbi5maWxlUGF0aH1cbiAgfVxuXG4gIC8qKlxuICAgKiBHZXRzIHBhY2thZ2UgdGVzdCBjb21wYXRpYmlsaXR5IG1ldGFkYXRhLlxuICAgKiBAcGFyYW0ge1BhY2thZ2VUZXN0RGVjbGFyYXRpb259IHRlc3QgLSBQYWNrYWdlIHRlc3QgZGVjbGFyYXRpb24uXG4gICAqIEByZXR1cm5zIHt7ZGVzY3JpcHRpb25zOiBzdHJpbmdbXSwgdGVzdERlc2NyaXB0aW9uOiBzdHJpbmcsIGZ1bGxEZXNjcmlwdGlvbjogc3RyaW5nLCBvd25lckZpbGVQYXRoOiBzdHJpbmcgfCB1bmRlZmluZWQsIHN1aXRlczogUGFja2FnZVN1aXRlRGVjbGFyYXRpb25bXX19IC0gRGVjbGFyYXRpb24gbWV0YWRhdGEuXG4gICAqL1xuICB0ZXN0TWV0YWRhdGEodGVzdCkge1xuICAgIGNvbnN0IG1ldGFkYXRhID0gdGhpcy5fdGVzdE1ldGFkYXRhLmdldCh0ZXN0KVxuICAgIGlmICghbWV0YWRhdGEpIHRocm93IG5ldyBFcnJvcihgTWlzc2luZyBwYWNrYWdlIHRlc3QgbWV0YWRhdGE6ICR7dGVzdC5uYW1lfWApXG4gICAgcmV0dXJuIG1ldGFkYXRhXG4gIH1cblxuICAvKipcbiAgICogR2V0cyBzdGFibGUgY29tcGF0aWJpbGl0eSBkYXRhIGZvciBhIHBhY2thZ2UgZGVjbGFyYXRpb24uXG4gICAqIEBwYXJhbSB7UGFja2FnZVRlc3REZWNsYXJhdGlvbn0gdGVzdCAtIFBhY2thZ2UgdGVzdCBkZWNsYXJhdGlvbi5cbiAgICogQHJldHVybnMge3t0ZXN0QXJnczogVGVzdEFyZ3MsIHRlc3REYXRhOiBUZXN0RGF0YX19IC0gU3RhYmxlIGNvbXBhdGliaWxpdHkgZGF0YS5cbiAgICovXG4gIHRlc3REYXRhKHRlc3QpIHtcbiAgICBsZXQgY29tcGF0aWJpbGl0eSA9IHRoaXMuX3Rlc3RDb21wYXRpYmlsaXR5LmdldCh0ZXN0KVxuXG4gICAgaWYgKCFjb21wYXRpYmlsaXR5KSB7XG4gICAgICBjb25zdCB0ZXN0QXJncyA9IHRoaXMuX3Rlc3RBcmd1bWVudHMuY29weSh0ZXN0KVxuICAgICAgY29uc3QgbWV0YWRhdGEgPSB0aGlzLnRlc3RNZXRhZGF0YSh0ZXN0KVxuICAgICAgY29uc3QgdGVzdERhdGEgPSB7XG4gICAgICAgIGFyZ3M6IHRlc3RBcmdzLFxuICAgICAgICBkZWNsYXJhdGlvbjogdGVzdCxcbiAgICAgICAgZmlsZVBhdGg6IHRlc3QubG9jYXRpb24uZmlsZVBhdGgsXG4gICAgICAgIGZ1bmN0aW9uOiB0ZXN0LmNhbGxiYWNrLFxuICAgICAgICBsaW5lOiB0ZXN0LmxvY2F0aW9uLmxpbmUsXG4gICAgICAgIG93bmVyRmlsZVBhdGg6IG1ldGFkYXRhLm93bmVyRmlsZVBhdGhcbiAgICAgIH1cbiAgICAgIGNvbXBhdGliaWxpdHkgPSB7dGVzdEFyZ3MsIHRlc3REYXRhfVxuICAgICAgdGhpcy5fdGVzdENvbXBhdGliaWxpdHkuc2V0KHRlc3QsIGNvbXBhdGliaWxpdHkpXG4gICAgfVxuXG4gICAgcmV0dXJuIGNvbXBhdGliaWxpdHlcbiAgfVxuXG4gIC8qKlxuICAgKiBJbmplY3RzIGZyYW1ld29yayBjb2xsYWJvcmF0b3JzIGludG8gc3RhYmxlIGNvbXBhdGliaWxpdHkgZGF0YSBvbmNlLlxuICAgKiBAcGFyYW0ge1BhY2thZ2VUZXN0RGVjbGFyYXRpb259IHRlc3QgLSBQYWNrYWdlIHRlc3QgZGVjbGFyYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHt0ZXN0QXJnczogVGVzdEFyZ3MsIHRlc3REYXRhOiBUZXN0RGF0YX0+fSAtIEluamVjdGVkIGNvbXBhdGliaWxpdHkgZGF0YS5cbiAgICovXG4gIGFzeW5jIHRlc3RDb21wYXRpYmlsaXR5KHRlc3QpIHtcbiAgICBjb25zdCBjb21wYXRpYmlsaXR5ID0gdGhpcy50ZXN0RGF0YSh0ZXN0KVxuXG4gICAgaWYgKCF0aGlzLl9pbmplY3RlZFRlc3RzLmhhcyh0ZXN0KSkge1xuICAgICAgYXdhaXQgdGhpcy5fdGVzdEFyZ3VtZW50cy5pbmplY3QoY29tcGF0aWJpbGl0eS50ZXN0QXJncylcbiAgICAgIHRoaXMuX2luamVjdGVkVGVzdHMuYWRkKHRlc3QpXG4gICAgfVxuXG4gICAgcmV0dXJuIGNvbXBhdGliaWxpdHlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmRzIGEgcmF3IGZyYW1ld29yayBhdHRlbXB0IG91dGNvbWUuXG4gICAqIEBwYXJhbSB7UGFja2FnZVRlc3REZWNsYXJhdGlvbn0gdGVzdCAtIFBhY2thZ2UgdGVzdCBkZWNsYXJhdGlvbi5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGF0dGVtcHROdW1iZXIgLSBPbmUtYmFzZWQgYXR0ZW1wdCBudW1iZXIuXG4gICAqIEBwYXJhbSB7e2Fib3J0UmVtYWluaW5nVGVzdHM6IGJvb2xlYW4sIGVycm9yOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgZmFpbGVkOiBib29sZWFufX0gb3V0Y29tZSAtIFJhdyBhdHRlbXB0IG91dGNvbWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgcmVjb3JkQXR0ZW1wdE91dGNvbWUodGVzdCwgYXR0ZW1wdE51bWJlciwgb3V0Y29tZSkge1xuICAgIGNvbnN0IG91dGNvbWVzID0gdGhpcy5fYXR0ZW1wdE91dGNvbWVzLmdldCh0ZXN0KSB8fCBuZXcgTWFwKClcbiAgICBvdXRjb21lcy5zZXQoYXR0ZW1wdE51bWJlciwgb3V0Y29tZSlcbiAgICB0aGlzLl9hdHRlbXB0T3V0Y29tZXMuc2V0KHRlc3QsIG91dGNvbWVzKVxuICAgIGlmIChvdXRjb21lLmFib3J0UmVtYWluaW5nVGVzdHMpIHRoaXMuX2Fib3J0UmVtYWluaW5nVGVzdHMgPSB0cnVlXG4gIH1cblxuICAvKipcbiAgICogR2V0cyBhIHJhdyBmcmFtZXdvcmsgYXR0ZW1wdCBvdXRjb21lLlxuICAgKiBAcGFyYW0ge1BhY2thZ2VUZXN0RGVjbGFyYXRpb259IHRlc3QgLSBQYWNrYWdlIHRlc3QgZGVjbGFyYXRpb24uXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBhdHRlbXB0TnVtYmVyIC0gT25lLWJhc2VkIGF0dGVtcHQgbnVtYmVyLlxuICAgKiBAcmV0dXJucyB7e2Fib3J0UmVtYWluaW5nVGVzdHM6IGJvb2xlYW4sIGVycm9yOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgZmFpbGVkOiBib29sZWFufSB8IHVuZGVmaW5lZH0gLSBSYXcgYXR0ZW1wdCBvdXRjb21lLlxuICAgKi9cbiAgYXR0ZW1wdE91dGNvbWUodGVzdCwgYXR0ZW1wdE51bWJlcikgeyByZXR1cm4gdGhpcy5fYXR0ZW1wdE91dGNvbWVzLmdldCh0ZXN0KT8uZ2V0KGF0dGVtcHROdW1iZXIpIH1cblxuICAvKipcbiAgICogUmVjb3JkcyBhIHJhdyBzdWl0ZS1ob29rIGZhaWx1cmUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBmYWlsdXJlIC0gU3VpdGUtaG9vayBmYWlsdXJlLlxuICAgKiBAcGFyYW0ge1BhY2thZ2VTdWl0ZURlY2xhcmF0aW9ufSBmYWlsdXJlLnN1aXRlIC0gT3duaW5nIHBhY2thZ2Ugc3VpdGUuXG4gICAqIEBwYXJhbSB7XCJiZWZvcmVBbGxcIiB8IFwiYWZ0ZXJBbGxcIn0gZmFpbHVyZS5waGFzZSAtIEhvb2sgcGhhc2UuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGZhaWx1cmUuZXJyb3IgLSBSYXcgaG9vayBmYWlsdXJlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHJlY29yZFN1aXRlSG9va0ZhaWx1cmUoZmFpbHVyZSkgeyB0aGlzLl9zdWl0ZUhvb2tGYWlsdXJlcy5wdXNoKGZhaWx1cmUpIH1cblxuICAvKipcbiAgICogR2V0cyB0aGUgcmF3IGFuY2VzdG9yIHNldHVwIGZhaWx1cmUgb3V0Y29tZSBmb3IgYSBwYWNrYWdlIHRlc3QuXG4gICAqIEBwYXJhbSB7UGFja2FnZVRlc3REZWNsYXJhdGlvbn0gdGVzdCAtIFBhY2thZ2UgdGVzdCBkZWNsYXJhdGlvbi5cbiAgICogQHJldHVybnMge3tmYWlsZWQ6IGZhbHNlfSB8IHtmYWlsZWQ6IHRydWUsIGVycm9yOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn19IC0gUmF3IHNldHVwIGZhaWx1cmUgb3V0Y29tZS5cbiAgICovXG4gIHNldHVwRmFpbHVyZU91dGNvbWVGb3IodGVzdCkge1xuICAgIGNvbnN0IHN1aXRlcyA9IHRoaXMudGVzdE1ldGFkYXRhKHRlc3QpLnN1aXRlc1xuICAgIGNvbnN0IGZhaWx1cmUgPSB0aGlzLl9zdWl0ZUhvb2tGYWlsdXJlcy5maW5kKChlbnRyeSkgPT4gZW50cnkucGhhc2UgPT09IFwiYmVmb3JlQWxsXCIgJiYgc3VpdGVzLmluY2x1ZGVzKGVudHJ5LnN1aXRlKSlcblxuICAgIHJldHVybiBmYWlsdXJlID8ge2ZhaWxlZDogdHJ1ZSwgZXJyb3I6IGZhaWx1cmUuZXJyb3J9IDoge2ZhaWxlZDogZmFsc2V9XG4gIH1cblxuICAvKipcbiAgICogRmluZHMgdGhlIG5leHQgaW5jb21wbGV0ZSBkZWNsYXJhdGlvbiB3aXRoIGEgcGFja2FnZSBmdWxsIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBmdWxsTmFtZSAtIFBhY2thZ2UgZnVsbCBuYW1lLlxuICAgKiBAcmV0dXJucyB7UGFja2FnZVRlc3REZWNsYXJhdGlvbiB8IHVuZGVmaW5lZH0gLSBOZXh0IG1hdGNoaW5nIGRlY2xhcmF0aW9uLlxuICAgKi9cbiAgZmluZFRlc3REZWNsYXJhdGlvbihmdWxsTmFtZSkge1xuICAgIHJldHVybiB0aGlzLl90ZXN0c0J5RnVsbE5hbWUuZ2V0KGZ1bGxOYW1lKT8uZmluZCgodGVzdCkgPT4gIXRoaXMuX2NvbXBsZXRlZFRlc3RzLmhhcyh0ZXN0KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBNYXJrcyBhIHBhY2thZ2UgZGVjbGFyYXRpb24gY29tcGxldGUuXG4gICAqIEBwYXJhbSB7UGFja2FnZVRlc3REZWNsYXJhdGlvbn0gdGVzdCAtIENvbXBsZXRlZCBkZWNsYXJhdGlvbi5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBjb21wbGV0ZVRlc3REZWNsYXJhdGlvbih0ZXN0KSB7IHRoaXMuX2NvbXBsZXRlZFRlc3RzLmFkZCh0ZXN0KSB9XG5cbiAgLyoqXG4gICAqIEdldHMgdGhlIGVmZmVjdGl2ZSBwYWNrYWdlIHJldHJ5IGNvdW50LlxuICAgKiBAcGFyYW0ge1BhY2thZ2VUZXN0RGVjbGFyYXRpb259IHRlc3QgLSBQYWNrYWdlIHRlc3QgZGVjbGFyYXRpb24uXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gRWZmZWN0aXZlIHJldHJ5IGNvdW50LlxuICAgKi9cbiAgcmV0cnlDb3VudCh0ZXN0KSB7XG4gICAgY29uc3QgdmFsdWUgPSB0ZXN0Lm9wdGlvbnMucmV0cmllcyA/PyB0ZXN0Lm9wdGlvbnMucmV0cnkgPz8gdGhpcy5fcmV0cmllcyA/PyB0aGlzLmdldFRlc3RDb250ZXh0KCkuY29uZmlnLnJldHJpZXNcbiAgICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZSh2YWx1ZSkgPyBNYXRoLm1heCgwLCBNYXRoLmZsb29yKHZhbHVlKSkgOiAwXG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplcyByZXRyeSBpbnB1dHMgZm9yIHRoZSBwYWNrYWdlIGV4ZWN1dGlvbiBib3VuZGFyeSB3aGlsZSByZXRhaW5pbmdcbiAgICogdGhlIGRlY2xhcmF0aW9ucycgb3JpZ2luYWwgcHVibGljIG9wdGlvbnMgYWZ0ZXIgdGhlIHJ1bi5cbiAgICogQHJldHVybnMgeygpID0+IHZvaWR9IC0gUmVzdG9yZXMgb3JpZ2luYWwgZGVjbGFyYXRpb24gb3B0aW9ucy5cbiAgICovXG4gIG5vcm1hbGl6ZVBhY2thZ2VSZXRyaWVzRm9yRXhlY3V0aW9uKCkge1xuICAgIC8qKiBAdHlwZSB7UGFja2FnZVJldHJ5T3B0aW9uUmVzdG9yYXRpb25bXX0gKi9cbiAgICBjb25zdCByZXN0b3JhdGlvbnMgPSBbXVxuICAgIC8qKlxuICAgICAqIE5vcm1hbGl6ZXMgZGVjbGFyYXRpb25zIGluIG9uZSBzdWl0ZS5cbiAgICAgKiBAcGFyYW0ge1BhY2thZ2VTdWl0ZURlY2xhcmF0aW9ufSBzdWl0ZSAtIFN1aXRlIHdob3NlIHRlc3RzIGFyZSBub3JtYWxpemVkLlxuICAgICAqL1xuICAgIGNvbnN0IHZpc2l0ID0gKHN1aXRlKSA9PiB7XG4gICAgICBmb3IgKGNvbnN0IHRlc3Qgb2Ygc3VpdGUudGVzdHMpIHtcbiAgICAgICAgLy8gQ2FwdHVyZSBjb21wYXRpYmlsaXR5IGFyZ3VtZW50cyBiZWZvcmUgdGVtcG9yYXJpbHkgYWRhcHRpbmcgcGFja2FnZVxuICAgICAgICAvLyBleGVjdXRpb24gb3B0aW9ucyBzbyBjYWxsYmFja3MgcmV0YWluIHRoZWlyIGRlY2xhcmVkIHZhbHVlcy9pZGVudGl0eS5cbiAgICAgICAgdGhpcy50ZXN0RGF0YSh0ZXN0KVxuICAgICAgICByZXN0b3JhdGlvbnMucHVzaCh7XG4gICAgICAgICAgaGFkUmV0cmllczogT2JqZWN0Lmhhc093bih0ZXN0Lm9wdGlvbnMsIFwicmV0cmllc1wiKSxcbiAgICAgICAgICBvcHRpb25zOiB0ZXN0Lm9wdGlvbnMsXG4gICAgICAgICAgcmV0cmllczogdGVzdC5vcHRpb25zLnJldHJpZXNcbiAgICAgICAgfSlcbiAgICAgICAgdGVzdC5vcHRpb25zLnJldHJpZXMgPSB0aGlzLnJldHJ5Q291bnQodGVzdClcbiAgICAgIH1cblxuICAgICAgZm9yIChjb25zdCBjaGlsZFN1aXRlIG9mIHN1aXRlLnN1aXRlcykgdmlzaXQoY2hpbGRTdWl0ZSlcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IHN1aXRlIG9mIHRoaXMuZ2V0VGVzdENvbnRleHQoKS5yZWdpc3RyeS5zdWl0ZXMpIHZpc2l0KHN1aXRlKVxuXG4gICAgcmV0dXJuICgpID0+IHtcbiAgICAgIGZvciAoY29uc3QgcmVzdG9yYXRpb24gb2YgcmVzdG9yYXRpb25zKSB7XG4gICAgICAgIGlmIChyZXN0b3JhdGlvbi5oYWRSZXRyaWVzKSByZXN0b3JhdGlvbi5vcHRpb25zLnJldHJpZXMgPSByZXN0b3JhdGlvbi5yZXRyaWVzXG4gICAgICAgIGVsc2UgZGVsZXRlIHJlc3RvcmF0aW9uLm9wdGlvbnMucmV0cmllc1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmRzIG9uZSBjb21wbGV0ZWQgdGVzdCBkdXJhdGlvbi5cbiAgICogQHBhcmFtIHt7ZHVyYXRpb25NczogbnVtYmVyLCBmaWxlUGF0aDogc3RyaW5nLCBmdWxsRGVzY3JpcHRpb246IHN0cmluZywgbGluZTogbnVtYmVyfX0gZHVyYXRpb24gLSBDb21wbGV0ZWQgdGVzdCBkdXJhdGlvbi5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICByZWNvcmRUZXN0RHVyYXRpb24oZHVyYXRpb24pIHsgdGhpcy5fdGVzdER1cmF0aW9ucy5wdXNoKGR1cmF0aW9uKSB9XG5cbiAgLyoqIFJlY29yZHMgb25lIHN1Y2Nlc3NmdWwgcGFja2FnZSByZXN1bHQuICovXG4gIHJlY29yZFN1Y2Nlc3NmdWxUZXN0KCkgeyB0aGlzLl9zdWNjZXNzZnVsVGVzdHMrKyB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgb25lIGZhaWxlZCBwYWNrYWdlIHRlc3QgaW4gdGhlIGxlZ2FjeSByZXN1bHQgcHJvamVjdGlvbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBGYWlsZWQgdGVzdCBtZXRhZGF0YS5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gYXJncy5kZXNjcmlwdGlvbnMgLSBQYXJlbnQgZGVzY3JpcHRpb25zLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLmVycm9yIC0gUmF3IGZhaWx1cmUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNvbnNvbGVPdXRwdXQgLSBDYXB0dXJlZCBjb25zb2xlIG91dHB1dC5cbiAgICogQHBhcmFtIHtUZXN0RGF0YX0gYXJncy50ZXN0RGF0YSAtIENvbXBhdGliaWxpdHkgdGVzdCBkYXRhLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy50ZXN0RGVzY3JpcHRpb24gLSBUZXN0IGRlc2NyaXB0aW9uLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHJlY29yZEZhaWxlZFRlc3Qoe2Rlc2NyaXB0aW9ucywgZXJyb3IsIGNvbnNvbGVPdXRwdXQsIHRlc3REYXRhLCB0ZXN0RGVzY3JpcHRpb259KSB7XG4gICAgdGhpcy5fZmFpbGVkVGVzdHMrK1xuICAgIHRoaXMuX2ZhaWxlZFRlc3REZXRhaWxzLnB1c2goe1xuICAgICAgZnVsbERlc2NyaXB0aW9uOiB0aGlzLmJ1aWxkRnVsbERlc2NyaXB0aW9uKGRlc2NyaXB0aW9ucywgdGVzdERlc2NyaXB0aW9uKSxcbiAgICAgIGZpbGVQYXRoOiB0ZXN0RGF0YS5maWxlUGF0aCxcbiAgICAgIGxpbmU6IHRlc3REYXRhLmxpbmUsXG4gICAgICBlcnJvcixcbiAgICAgIGNvbnNvbGVPdXRwdXQ6IGNvbnNvbGVPdXRwdXQgfHwgdW5kZWZpbmVkXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBTdG9yZXMgdGhlIGNvbXBsZXRlZCBwYWNrYWdlIHJlc3VsdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCJAdmVsb2Npb3VzL3Rlc3RpbmcvcnVubmVyXCIpLlRlc3RSdW5SZXN1bHR9IHJlc3VsdCAtIFBhY2thZ2UgcmVzdWx0LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHJlY29yZFBhY2thZ2VSZXN1bHQocmVzdWx0KSB7IHRoaXMuX3BhY2thZ2VSZXN1bHQgPSByZXN1bHQgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRoZSBwYWNrYWdlIGtlcm5lbCB3aXRoIFZlbG9jaW91cyBmcmFtZXdvcmsgYWRhcHRlcnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIGV4ZWN1dGlvbiBhbmQgdGVhcmRvd24uXG4gICAqL1xuICBhc3luYyBydW5QYWNrYWdlVGVzdHMoKSB7XG4gICAgY29uc3QgZW52aXJvbm1lbnRIYW5kbGVyID0gdGhpcy5nZXRDb25maWd1cmF0aW9uKCkuZ2V0RW52aXJvbm1lbnRIYW5kbGVyKClcbiAgICBlbnZpcm9ubWVudEhhbmRsZXIuaW5zdGFsbFNoYXJlZFRyYW5zYWN0aW9uQ29vcmRpbmF0b3JPd25lclN0b3JhZ2UodGhpcy5fc2hhcmVkVHJhbnNhY3Rpb25Db29yZGluYXRvck93bmVyU3RvcmFnZSlcbiAgICBlbnZpcm9ubWVudEhhbmRsZXIuaW5zdGFsbFRlc3REYXRhYmFzZUFjY2Vzc1Njb3BlU3RvcmFnZSh0aGlzLl90ZXN0RGF0YWJhc2VBY2Nlc3NTY29wZVN0b3JhZ2UpXG4gICAgdGhpcy5fcGFja2FnZVJ1bm5lciA9IG5ldyBQYWNrYWdlVGVzdFJ1bm5lcih7XG4gICAgICBjb250ZXh0OiB0aGlzLmdldFRlc3RDb250ZXh0KCksXG4gICAgICBpbmNsdWRlVGFnczogdGhpcy5faW5jbHVkZVRhZ3MsXG4gICAgICBleGNsdWRlVGFnczogWy4uLnRoaXMuZ2V0RXhjbHVkZVRhZ1NldCgpLCAuLi4odGhpcy5pc0Jyb3dzZXJUZXN0TW9kZSgpID8gW10gOiBbXCJicm93c2VyLW9ubHlcIl0pXSxcbiAgICAgIGV4YW1wbGVzOiB0aGlzLmdldEV4YW1wbGVQYXR0ZXJucygpLFxuICAgICAgbGluZUZpbHRlcnM6IHRoaXMuZ2V0TGluZUZpbHRlcnMoKSxcbiAgICAgIGluY2x1ZGVUYWdNb2RlOiBcImFueVwiLFxuICAgICAgZm9jdXNlZFRlc3RzQnlwYXNzSW5jbHVkZVRhZ3M6IHRydWUsXG4gICAgICBvbWl0RW1wdHlTdWl0ZU5hbWVzOiB0cnVlLFxuICAgICAgYXR0ZW1wdEV4ZWN1dG9yT3duc1RpbWVvdXQ6IHRydWUsXG4gICAgICBhdHRlbXB0RXhlY3V0b3I6IChpbnB1dCkgPT4gdGhpcy5fYXR0ZW1wdEV4ZWN1dG9yLmV4ZWN1dGUoaW5wdXQpLFxuICAgICAgdGVzdEFyZ3VtZW50UmVzb2x2ZXI6IChpbnB1dCkgPT4gdGhpcy5fdGVzdEFyZ3VtZW50cy5yZXNvbHZlKGlucHV0KSxcbiAgICAgIHN1aXRlSG9va0V4ZWN1dG9yOiAoaW5wdXQpID0+IHRoaXMuX3N1aXRlSG9va0V4ZWN1dG9yLmV4ZWN1dGUoaW5wdXQpLFxuICAgICAgcmVwb3J0ZXI6IHRoaXMuX3J1bm5lclJlcG9ydGVyLFxuICAgICAgcmV0cmllczogdGhpcy5fcmV0cmllcyxcbiAgICAgIHRpbWVvdXRNczogdGhpcy5fdGltZW91dE1zXG4gICAgfSlcbiAgICBjb25zdCBmYWlsdXJlU3RhcnQgPSB0aGlzLl9zdWl0ZUhvb2tGYWlsdXJlcy5sZW5ndGhcbiAgICBjb25zdCByZXN0b3JlUmV0cnlPcHRpb25zID0gdGhpcy5ub3JtYWxpemVQYWNrYWdlUmV0cmllc0ZvckV4ZWN1dGlvbigpXG4gICAgbGV0IHJlc3VsdFxuXG4gICAgdHJ5IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIHJlc3VsdCA9IGF3YWl0IHRoaXMuX3BhY2thZ2VSdW5uZXIucnVuKClcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGlmICghKGVycm9yIGluc3RhbmNlb2YgQWJvcnRSZW1haW5pbmdUZXN0c0Vycm9yKSkgdGhyb3cgZXJyb3JcblxuICAgICAgICBjb25zdCBhZnRlckFsbCA9IHRoaXMuYWZ0ZXJBbGxPdXRjb21lKHRoaXMuX3N1aXRlSG9va0ZhaWx1cmVzLnNsaWNlKGZhaWx1cmVTdGFydCkpXG4gICAgICAgIGlmIChhZnRlckFsbC5mYWlsZWQpIHRoaXMucmVjb3JkVGltZW91dENsZWFudXBGYWlsdXJlKGFmdGVyQWxsLmVycm9yLCBcImFmdGVyQWxsXCIpXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICB0aGlzLnJlY29yZFBhY2thZ2VSZXN1bHQocmVzdWx0KVxuICAgICAgdGhpcy50aHJvd0FmdGVyQWxsRmFpbHVyZXModGhpcy5fc3VpdGVIb29rRmFpbHVyZXMuc2xpY2UoZmFpbHVyZVN0YXJ0KSlcbiAgICB9IGZpbmFsbHkge1xuICAgICAgcmVzdG9yZVJldHJ5T3B0aW9ucygpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEFnZ3JlZ2F0ZXMgcmF3IGFmdGVyLWFsbCBmYWlsdXJlcyB3aXRob3V0IHVzaW5nIGVycm9yIHRydXRoaW5lc3MuXG4gICAqIEBwYXJhbSB7QXJyYXk8e3BoYXNlOiBcImJlZm9yZUFsbFwiIHwgXCJhZnRlckFsbFwiLCBlcnJvcjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59Pn0gZmFpbHVyZXMgLSBIb29rIGZhaWx1cmVzLlxuICAgKiBAcmV0dXJucyB7e2ZhaWxlZDogZmFsc2V9IHwge2ZhaWxlZDogdHJ1ZSwgZXJyb3I6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fX0gLSBFeHBsaWNpdCBhZnRlckFsbCBvdXRjb21lLlxuICAgKi9cbiAgYWZ0ZXJBbGxPdXRjb21lKGZhaWx1cmVzKSB7XG4gICAgY29uc3QgYWZ0ZXJBbGxFcnJvcnMgPSBmYWlsdXJlcy5maWx0ZXIoKGZhaWx1cmUpID0+IGZhaWx1cmUucGhhc2UgPT09IFwiYWZ0ZXJBbGxcIikubWFwKChmYWlsdXJlKSA9PiBmYWlsdXJlLmVycm9yKVxuXG4gICAgaWYgKGFmdGVyQWxsRXJyb3JzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHtmYWlsZWQ6IGZhbHNlfVxuICAgIGlmIChhZnRlckFsbEVycm9ycy5sZW5ndGggPT09IDEpIHJldHVybiB7ZmFpbGVkOiB0cnVlLCBlcnJvcjogYWZ0ZXJBbGxFcnJvcnNbMF19XG4gICAgcmV0dXJuIHtcbiAgICAgIGZhaWxlZDogdHJ1ZSxcbiAgICAgIGVycm9yOiBuZXcgQWdncmVnYXRlRXJyb3IoYWZ0ZXJBbGxFcnJvcnMsIFwiTXVsdGlwbGUgYWN0aXZlIGFmdGVyQWxsIHNjb3BlcyBmYWlsZWRcIiwge2NhdXNlOiBhZnRlckFsbEVycm9yc1swXX0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFRocm93cyBvbmUgcmF3IG9yIGFnZ3JlZ2F0ZWQgYWZ0ZXItYWxsIGZhaWx1cmUuXG4gICAqIEBwYXJhbSB7QXJyYXk8e3BoYXNlOiBcImJlZm9yZUFsbFwiIHwgXCJhZnRlckFsbFwiLCBlcnJvcjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59Pn0gZmFpbHVyZXMgLSBIb29rIGZhaWx1cmVzLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHRocm93QWZ0ZXJBbGxGYWlsdXJlcyhmYWlsdXJlcykge1xuICAgIGNvbnN0IGFmdGVyQWxsID0gdGhpcy5hZnRlckFsbE91dGNvbWUoZmFpbHVyZXMpXG5cbiAgICBpZiAoYWZ0ZXJBbGwuZmFpbGVkKSB0aHJvdyBhZnRlckFsbC5lcnJvclxuICB9XG5cbiAgLyoqXG4gICAqIENvbXBhdGliaWxpdHkgaGVscGVyIGZvciBmb2N1c2VkIGZyYW1ld29yayBsaWZlY3ljbGUgc3BlY3MuIEl0IGNvbnZlcnRzIGFuXG4gICAqIGV4cGxpY2l0IGxlZ2FjeSBmaXh0dXJlIGludG8gaXNvbGF0ZWQgcGFja2FnZSBkZWNsYXJhdGlvbnM7IHRoZSBwYWNrYWdlXG4gICAqIHJ1bm5lciByZW1haW5zIHRoZSBzb2xlIGV4ZWN1dGlvbiBlbmdpbmUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gTGVnYWN5IGZpeHR1cmUgYXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge1Rlc3RzQXJndW1lbnR9IGFyZ3MudGVzdHMgLSBGaXh0dXJlIHRyZWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIGFmdGVyIHBhY2thZ2UgZXhlY3V0aW9uLlxuICAgKi9cbiAgYXN5bmMgcnVuVGVzdHMoe3Rlc3RzfSkge1xuICAgIGNvbnN0IGNvbnRleHQgPSBjcmVhdGVUZXN0Q29udGV4dCgpXG4gICAgY29uc3Qgb3JpZ2luYWxDb250ZXh0ID0gdGhpcy5fY29udGV4dFxuICAgIGNvbnRleHQuY29uZmlndXJlVGVzdHMoe1xuICAgICAgY29uc29sZU91dHB1dDogb3JpZ2luYWxDb250ZXh0LmNvbmZpZy5jb25zb2xlT3V0cHV0LFxuICAgICAgZGVmYXVsdFRpbWVvdXRNczogb3JpZ2luYWxDb250ZXh0LmNvbmZpZy5kZWZhdWx0VGltZW91dE1zLFxuICAgICAgZXhjbHVkZVRhZ3M6IG9yaWdpbmFsQ29udGV4dC5jb25maWcuZXhjbHVkZVRhZ3MsXG4gICAgICBmYWlsZWRDb25zb2xlT3V0cHV0TWF4TGluZXM6IG9yaWdpbmFsQ29udGV4dC5jb25maWcuZmFpbGVkQ29uc29sZU91dHB1dE1heExpbmVzLFxuICAgICAgcmV0cmllczogb3JpZ2luYWxDb250ZXh0LmNvbmZpZy5yZXRyaWVzXG4gICAgfSlcbiAgICB0aGlzLl9jb250ZXh0ID0gY29udGV4dFxuICAgIHRoaXMuX3Rlc3RzQ291bnQgPSAwXG4gICAgdGhpcy5fdGVzdENvbXBhdGliaWxpdHkgPSBuZXcgV2Vha01hcCgpXG4gICAgdGhpcy5faW5qZWN0ZWRUZXN0cyA9IG5ldyBXZWFrU2V0KClcbiAgICB0aGlzLl9jb21wbGV0ZWRUZXN0cyA9IG5ldyBXZWFrU2V0KClcbiAgICB0aGlzLl90ZXN0TWV0YWRhdGEgPSBuZXcgV2Vha01hcCgpXG4gICAgdGhpcy5faG9va01ldGFkYXRhID0gbmV3IFdlYWtNYXAoKVxuICAgIHRoaXMuX2F0dGVtcHRPdXRjb21lcyA9IG5ldyBXZWFrTWFwKClcbiAgICB0aGlzLl9zdWl0ZUhvb2tGYWlsdXJlcyA9IFtdXG4gICAgdGhpcy5fdGVzdHNCeUZ1bGxOYW1lID0gbmV3IE1hcCgpXG4gICAgdGhpcy5fbGVnYWN5Rml4dHVyZURhdGFCeUZ1bGxOYW1lID0gbmV3IE1hcCgpXG4gICAgY29udGV4dC5zZXREZWNsYXJhdGlvbkxvY2F0b3IoKCkgPT4gdGhpcy5fbGVnYWN5Rml4dHVyZUxvY2F0aW9uKVxuICAgIHRoaXMuZGVjbGFyZUxlZ2FjeUZpeHR1cmUoY29udGV4dCwgXCJcIiwgdGVzdHMsIFtdKVxuICAgIHRoaXMuYW5hbHl6ZURlY2xhcmF0aW9ucygpXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5ydW5QYWNrYWdlVGVzdHMoKVxuICAgIH0gZmluYWxseSB7XG4gICAgICB0aGlzLl9jb250ZXh0ID0gb3JpZ2luYWxDb250ZXh0XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIERlY2xhcmVzIGFuIGlzb2xhdGVkIGxlZ2FjeS1zaGFwZWQgdGVzdCBmaXh0dXJlIGludG8gYSBwYWNrYWdlIGNvbnRleHQuXG4gICAqIEBwYXJhbSB7UGFja2FnZVRlc3RDb250ZXh0fSBjb250ZXh0IC0gSXNvbGF0ZWQgcGFja2FnZSBjb250ZXh0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIFN1aXRlIG5hbWUuXG4gICAqIEBwYXJhbSB7VGVzdHNBcmd1bWVudH0gc2NvcGUgLSBMZWdhY3kgZml4dHVyZSBzY29wZS5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gZGVzY3JpcHRpb25zIC0gQW5jZXN0b3IgZGVzY3JpcHRpb25zLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGRlY2xhcmVMZWdhY3lGaXh0dXJlKGNvbnRleHQsIG5hbWUsIHNjb3BlLCBkZXNjcmlwdGlvbnMpIHtcbiAgICB0aGlzLl9sZWdhY3lGaXh0dXJlTG9jYXRpb24gPSB7ZmlsZVBhdGg6IHNjb3BlLmZpbGVQYXRoLCBsaW5lOiBzY29wZS5saW5lfVxuICAgIGNvbnRleHQuZGVzY3JpYmUobmFtZSwgc2NvcGUuYXJncyB8fCB7fSwgKCkgPT4ge1xuICAgICAgZm9yIChjb25zdCBob29rIG9mIHNjb3BlLmJlZm9yZUFsbHMgfHwgW10pIGNvbnRleHQuYmVmb3JlQWxsKGhvb2suY2FsbGJhY2spXG4gICAgICBmb3IgKGNvbnN0IGhvb2sgb2Ygc2NvcGUuYmVmb3JlRWFjaGVzIHx8IFtdKSBjb250ZXh0LmJlZm9yZUVhY2goaG9vay5jYWxsYmFjaylcbiAgICAgIGZvciAoY29uc3QgaG9vayBvZiBzY29wZS5hZnRlckVhY2hlcyB8fCBbXSkgY29udGV4dC5hZnRlckVhY2goaG9vay5jYWxsYmFjaylcbiAgICAgIGZvciAoY29uc3QgaG9vayBvZiBzY29wZS5hZnRlckFsbHMgfHwgW10pIGNvbnRleHQuYWZ0ZXJBbGwoaG9vay5jYWxsYmFjaylcbiAgICAgIGNvbnN0IG5leHREZXNjcmlwdGlvbnMgPSBuYW1lID09PSBcIlwiID8gZGVzY3JpcHRpb25zIDogWy4uLmRlc2NyaXB0aW9ucywgbmFtZV1cbiAgICAgIGZvciAoY29uc3QgW3Rlc3ROYW1lLCB0ZXN0RGF0YV0gb2YgT2JqZWN0LmVudHJpZXMoc2NvcGUudGVzdHMgfHwge30pKSB7XG4gICAgICAgIHRoaXMuX2xlZ2FjeUZpeHR1cmVMb2NhdGlvbiA9IHtmaWxlUGF0aDogdGVzdERhdGEuZmlsZVBhdGgsIGxpbmU6IHRlc3REYXRhLmxpbmV9XG4gICAgICAgIHRoaXMuX2xlZ2FjeUZpeHR1cmVEYXRhQnlGdWxsTmFtZT8uc2V0KHRoaXMuYnVpbGRGdWxsRGVzY3JpcHRpb24obmV4dERlc2NyaXB0aW9ucywgdGVzdE5hbWUpLCB0ZXN0RGF0YSlcbiAgICAgICAgY29udGV4dC5pdCh0ZXN0TmFtZSwgdGVzdERhdGEuYXJncywgdGVzdERhdGEuZnVuY3Rpb24pXG4gICAgICB9XG4gICAgICBmb3IgKGNvbnN0IFtzdWl0ZU5hbWUsIGNoaWxkU2NvcGVdIG9mIE9iamVjdC5lbnRyaWVzKHNjb3BlLnN1YnMgfHwge30pKSB7XG4gICAgICAgIHRoaXMuZGVjbGFyZUxlZ2FjeUZpeHR1cmUoY29udGV4dCwgc3VpdGVOYW1lLCBjaGlsZFNjb3BlLCBuZXh0RGVzY3JpcHRpb25zKVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBlbWl0IGV2ZW50LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZXZlbnROYW1lIC0gRXZlbnQgbmFtZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IHBheWxvYWQgLSBFdmVudCBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGFsbCBsaXN0ZW5lcnMgY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBlbWl0RXZlbnQoZXZlbnROYW1lLCBwYXlsb2FkKSB7XG4gICAgYXdhaXQgdGhpcy5fcnVubmVyUmVwb3J0ZXIuZW1pdEV2ZW50KGV2ZW50TmFtZSwgcGF5bG9hZClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHByaW50IHJlcnVuIGNvbW1hbmQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IGFyZ3MuZGVzY3JpcHRpb25zIC0gRGVzY3JpcHRpb24gc3RhY2suXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnRlc3REZXNjcmlwdGlvbiAtIFRlc3QgZGVzY3JpcHRpb24uXG4gICAqIEBwYXJhbSB7VGVzdERhdGF9IGFyZ3MudGVzdERhdGEgLSBUZXN0IGRhdGEuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmxlZnRQYWRkaW5nIC0gTGVmdCBwYWRkaW5nLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBwcmludFJlcnVuQ29tbWFuZCh7ZGVzY3JpcHRpb25zLCB0ZXN0RGVzY3JpcHRpb24sIHRlc3REYXRhLCBsZWZ0UGFkZGluZ30pIHtcbiAgICBjb25zdCByZXJ1biA9IHRoaXMuYnVpbGRSZXJ1bkNvbW1hbmQoe2Rlc2NyaXB0aW9ucywgdGVzdERlc2NyaXB0aW9uLCB0ZXN0RGF0YX0pXG5cbiAgICBpZiAocmVydW4pIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoYCR7bGVmdFBhZGRpbmd9ICBSZS1ydW46ICR7cmVydW59YClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBidWlsZCByZXJ1biBjb21tYW5kLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ1tdfSBhcmdzLmRlc2NyaXB0aW9ucyAtIERlc2NyaXB0aW9uIHN0YWNrLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy50ZXN0RGVzY3JpcHRpb24gLSBUZXN0IGRlc2NyaXB0aW9uLlxuICAgKiBAcGFyYW0ge1Rlc3REYXRhfSBhcmdzLnRlc3REYXRhIC0gVGVzdCBkYXRhLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSAtIFJlcnVuIGNvbW1hbmQuXG4gICAqL1xuICBidWlsZFJlcnVuQ29tbWFuZCh7ZGVzY3JpcHRpb25zLCB0ZXN0RGVzY3JpcHRpb24sIHRlc3REYXRhfSkge1xuICAgIGNvbnN0IGJhc2VDb21tYW5kID0gXCJucHggdmVsb2Npb3VzIHRlc3RcIlxuICAgIGNvbnN0IGZpbGVQYXRoID0gdGVzdERhdGEuZmlsZVBhdGhcbiAgICBjb25zdCBsaW5lID0gdGVzdERhdGEubGluZVxuXG4gICAgaWYgKGZpbGVQYXRoICYmIGxpbmUpIHtcbiAgICAgIGNvbnN0IHJlbGF0aXZlUGF0aCA9IHBhdGgucmVsYXRpdmUocHJvY2Vzcy5jd2QoKSwgZmlsZVBhdGgpXG4gICAgICByZXR1cm4gYCR7YmFzZUNvbW1hbmR9ICR7cmVsYXRpdmVQYXRofToke2xpbmV9YFxuICAgIH1cblxuICAgIGNvbnN0IGZ1bGxEZXNjcmlwdGlvbiA9IHRoaXMuYnVpbGRGdWxsRGVzY3JpcHRpb24oZGVzY3JpcHRpb25zLCB0ZXN0RGVzY3JpcHRpb24pXG5cbiAgICBpZiAoZnVsbERlc2NyaXB0aW9uKSB7XG4gICAgICByZXR1cm4gYCR7YmFzZUNvbW1hbmR9IC0tZXhhbXBsZSAke0pTT04uc3RyaW5naWZ5KGZ1bGxEZXNjcmlwdGlvbil9YFxuICAgIH1cblxuICAgIHJldHVybiB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJ1aWxkIGNvbnNvbGUgb3V0cHV0LlxuICAgKiBAcGFyYW0ge0F0dGVtcHRDb25zb2xlT3V0cHV0W119IGF0dGVtcHRDb25zb2xlT3V0cHV0cyAtIEF0dGVtcHQgb3V0cHV0IGVudHJpZXMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gQ29tYmluZWQgY29uc29sZSBvdXRwdXQuXG4gICAqL1xuICBidWlsZENvbnNvbGVPdXRwdXQoYXR0ZW1wdENvbnNvbGVPdXRwdXRzKSB7XG4gICAgaWYgKGF0dGVtcHRDb25zb2xlT3V0cHV0cy5sZW5ndGggPT09IDApIHJldHVybiBcIlwiXG4gICAgaWYgKGF0dGVtcHRDb25zb2xlT3V0cHV0cy5sZW5ndGggPT09IDEpIHJldHVybiBhdHRlbXB0Q29uc29sZU91dHB1dHNbMF0ub3V0cHV0XG5cbiAgICByZXR1cm4gYXR0ZW1wdENvbnNvbGVPdXRwdXRzLm1hcCgoYXR0ZW1wdENvbnNvbGVPdXRwdXQpID0+IHtcbiAgICAgIHJldHVybiBgLS0tIEF0dGVtcHQgJHthdHRlbXB0Q29uc29sZU91dHB1dC5hdHRlbXB0TnVtYmVyfSAtLS1cXG4ke2F0dGVtcHRDb25zb2xlT3V0cHV0Lm91dHB1dH1gXG4gICAgfSkuam9pbihcIlxcblwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGZhaWxlZCBjb25zb2xlIG91dHB1dCBtYXggbGluZXMuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gTWF4aW11bSBmYWlsZWQgY29uc29sZSBsaW5lcy5cbiAgICovXG4gIGdldEZhaWxlZENvbnNvbGVPdXRwdXRNYXhMaW5lcygpIHtcbiAgICBjb25zdCBtYXhMaW5lcyA9IHRlc3RDb25maWcuZmFpbGVkQ29uc29sZU91dHB1dE1heExpbmVzXG5cbiAgICBpZiAodHlwZW9mIG1heExpbmVzICE9PSBcIm51bWJlclwiIHx8ICFOdW1iZXIuaXNGaW5pdGUobWF4TGluZXMpKSByZXR1cm4gMjAwXG5cbiAgICByZXR1cm4gTWF0aC5tYXgoMCwgTWF0aC5mbG9vcihtYXhMaW5lcykpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0cnVuY2F0ZSBmYWlsZWQgY29uc29sZSBvdXRwdXQgbGluZXMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjb25zb2xlT3V0cHV0IC0gQ29uc29sZSBvdXRwdXQuXG4gICAqIEByZXR1cm5zIHtzdHJpbmdbXX0gLSBMaW5lcyBmb3IgaW5saW5lIG91dHB1dC5cbiAgICovXG4gIHRydW5jYXRlRmFpbGVkQ29uc29sZU91dHB1dExpbmVzKGNvbnNvbGVPdXRwdXQpIHtcbiAgICBjb25zdCBsaW5lcyA9IGNvbnNvbGVPdXRwdXQuc3BsaXQoXCJcXG5cIilcbiAgICBjb25zdCBtYXhMaW5lcyA9IHRoaXMuZ2V0RmFpbGVkQ29uc29sZU91dHB1dE1heExpbmVzKClcblxuICAgIGlmIChtYXhMaW5lcyA9PT0gMCkgcmV0dXJuIFtdXG4gICAgaWYgKGxpbmVzLmxlbmd0aCA8PSBtYXhMaW5lcykgcmV0dXJuIGxpbmVzXG5cbiAgICBjb25zdCBvbWl0dGVkTGluZXMgPSBsaW5lcy5sZW5ndGggLSBtYXhMaW5lc1xuICAgIGNvbnN0IHBsdXJhbCA9IG9taXR0ZWRMaW5lcyA9PT0gMSA/IFwiXCIgOiBcInNcIlxuXG4gICAgcmV0dXJuIFtcbiAgICAgIGAuLi4gJHtvbWl0dGVkTGluZXN9IGNvbnNvbGUgb3V0cHV0IGxpbmUke3BsdXJhbH0gb21pdHRlZCAuLi5gLFxuICAgICAgLi4ubGluZXMuc2xpY2UoLW1heExpbmVzKVxuICAgIF1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHByaW50IGZhaWxlZCBjb25zb2xlIG91dHB1dC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuY29uc29sZU91dHB1dCAtIENvbnNvbGUgb3V0cHV0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5sZWZ0UGFkZGluZyAtIExlZnQgcGFkZGluZy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgcHJpbnRGYWlsZWRDb25zb2xlT3V0cHV0KHtjb25zb2xlT3V0cHV0LCBsZWZ0UGFkZGluZ30pIHtcbiAgICBpZiAodGVzdENvbmZpZy5jb25zb2xlT3V0cHV0ICE9PSBcImZhaWx1cmVcIikgcmV0dXJuXG4gICAgaWYgKCFjb25zb2xlT3V0cHV0KSByZXR1cm5cblxuICAgIGNvbnN0IGxpbmVzID0gdGhpcy50cnVuY2F0ZUZhaWxlZENvbnNvbGVPdXRwdXRMaW5lcyhjb25zb2xlT3V0cHV0KVxuXG4gICAgaWYgKGxpbmVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuXG5cbiAgICBjb25zb2xlLmVycm9yKHBpY29jb2xvcnMucmVkKGAke2xlZnRQYWRkaW5nfSAgQ29uc29sZSBvdXRwdXQ6YCkpXG5cbiAgICBmb3IgKGNvbnN0IGxpbmUgb2YgbGluZXMpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IocGljb2NvbG9ycy5yZWQoYCR7bGVmdFBhZGRpbmd9ICAgICR7bGluZX1gKSlcbiAgICB9XG4gIH1cblxufVxuIl19